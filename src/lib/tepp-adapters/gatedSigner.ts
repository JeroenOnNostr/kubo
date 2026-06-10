import type { QueryClient } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';

import { evaluateEvent } from '@/lib/tepp/evaluate';
import { prefetchReferenceClosure } from '@/lib/tepp-adapters/referenceClosure';
import { assembleConstructFromRelay } from '@/lib/tepp-adapters/useConstruct';
import { KIND_ASSOCIATION } from '@/lib/tepp/kinds';
import type { Construct } from '@/lib/tepp/types';
import {
  TeppDeniedError,
  buildDeltaEventForRecordList,
  readCachedFollowPubkeys,
} from '@/hooks/useKuboTeppGate';

/**
 * KUBO-160 — TEPP enforcement at the SIGNER SEAM.
 *
 * The hook-level gate (`useKuboTeppGate` consumed by `useNostrPublish` / `useZaps`)
 * only covers the two publish paths that route through those hooks. Many other
 * code paths call `signer.signEvent(...)` directly (group chat, trust requests,
 * request-to-vanish, kid profile admin, etc.). To make TEPP enforcement a true
 * GUARANTEE rather than a per-call-site convention, we wrap each KID user's
 * signer in a proxy whose `signEvent` runs the SAME outbound TEPP evaluation as
 * the hook gate before delegating, throwing `TeppDeniedError` on deny.
 *
 * Decision logic is shared with the hook gate, not forked:
 *  - record/list (kind-3 follow) delta evaluation: `buildDeltaEventForRecordList`
 *    + `readCachedFollowPubkeys` (KUBO-164) — imported from `useKuboTeppGate`.
 *  - reference-closure prefetch with pending fail-open (`prefetchReferenceClosure`).
 *  - construct resolution OUTSIDE React via the shared TanStack cache + queryFn
 *    (`assembleConstructFromRelay`), under the SAME query key the hook uses
 *    (`['kubo-tepp-construct', kid, parent]`), so the cache is shared and no
 *    second relay fetch happens when the construct is already warm.
 *  - fail-closed when enforced-but-no-construct (KUBO-154), identical to the hook.
 */

// ─── Exemption list (shared constant) ────────────────────────────────────────

/**
 * Event kinds a KID may always sign, regardless of construct verdict. These are
 * protocol / self-attestation / parent-channel events that the gate must never
 * block — blocking them would brick TEPP itself or the kid↔parent escape hatch.
 *
 * Per kind:
 *  - 17700 (KIND_ASSOCIATION): the kid-signed TEPP association naming the
 *    guardian. It p-tags the guardian; if the guardian isn't yet admitted in the
 *    construct (cold start / renewal) the evaluator would deny it and the kid
 *    could never (re)establish or rotate their own association. Always exempt.
 *  - 13 (NIP-59 seal): the kid signs a kind-13 seal addressed to the PARENT for
 *    "request-to-interact" (`useTrustRequests`). The kid asking their grown-up
 *    for permission must always work — that's the entire escape hatch. The real
 *    rumor is encrypted inside; the seal itself carries no public references.
 *  - 1059 (NIP-59 gift wrap): the request-to-interact wrap. In practice the wrap
 *    is signed by an EPHEMERAL key (never the kid's wrapped signer), but we
 *    exempt it defensively so any future kid-signed wrap-to-parent also passes.
 *  - 30078 (NIP-78 app-specific settings): the kid's own encrypted synced
 *    settings (`useEncryptedSettings` / `NostrSync`). Post-KUBO-152 these are
 *    still authored by the active user (the kid, when a kid is active); gating
 *    them would break the kid's settings sync. The authoritative enforcement
 *    flag lives in the parent-controlled family record, NOT in this event, so
 *    exempting it cannot let a kid disable their own protection (KUBO-152).
 *  - 0 (kind-0 metadata): a kid self-profile. The parent admin flow
 *    (`lib/kidProfile.ts`) signs the kid's kind-0 to edit their profile; a kid
 *    self-publishing their own profile is the subject attesting their own
 *    metadata, not an interaction with anyone. A kind-0 that p-tagged an
 *    unadmitted author would otherwise hard-deny. Exempt deliberately as a
 *    parent-driven / self-attestation admin flow.
 */
export const TEPP_SIGNER_EXEMPT_KINDS: ReadonlySet<number> = new Set<number>([
  0, // kid self-profile (parent admin flow / self-attestation)
  13, // NIP-59 seal (request-to-interact to parent)
  KIND_ASSOCIATION, // 17700 — kid-signed TEPP association
  1059, // NIP-59 gift wrap to parent (defensive; usually ephemeral-signed)
  30078, // NIP-78 settings sync
]);

/** Record/list kinds evaluated by delta (kept in sync with `useKuboTeppGate`). */
const RECORD_LIST_KINDS: ReadonlySet<number> = new Set<number>([3]);

// ─── Construct resolution outside React ──────────────────────────────────────

/** Query surface the seam needs (matches `nostr.query`). */
export type SeamQueryFn = (
  filters: NostrFilter[],
  opts?: { signal?: AbortSignal },
) => Promise<NostrEvent[]>;

/** Optional NIP-44 decrypt for the construct's private section (parent signer). */
export type SeamNip44Decrypt = (pubkey: string, ciphertext: string) => Promise<string>;

/** Stable query key — MUST match `useKuboTeppConstruct` so the cache is shared. */
export function constructQueryKey(kidPubkey: string, parentPubkey: string) {
  return ['kubo-tepp-construct', kidPubkey, parentPubkey] as const;
}

/**
 * Resolve the construct for `(kid, parent)` using the SHARED TanStack cache via
 * `fetchQuery` under the same query key `useKuboTeppConstruct` uses. When the
 * construct is already warm (the kid's feed keeps it fresh), this is a cache hit
 * with zero relay traffic; otherwise it assembles via the same pure pipeline
 * (`assembleConstructFromRelay`) the hook's queryFn uses, so there is no second,
 * divergent construct path.
 */
export async function resolveConstructViaCache(args: {
  queryClient: QueryClient;
  kidPubkey: string;
  parentPubkey: string;
  query: SeamQueryFn;
  nip44Decrypt?: SeamNip44Decrypt;
}): Promise<Construct | null> {
  const { queryClient, kidPubkey, parentPubkey, query, nip44Decrypt } = args;
  const data = await queryClient.fetchQuery({
    queryKey: constructQueryKey(kidPubkey, parentPubkey),
    // Reuse a warm construct (5s, mirroring useKuboTeppConstruct.staleTime) so
    // we don't refetch on every signed event during a burst of publishes.
    staleTime: 5_000,
    queryFn: ({ signal }) =>
      assembleConstructFromRelay({
        kidPubkey,
        parentPubkey,
        query: (filters, opts) => query(filters, { signal: opts?.signal ?? signal }),
        nip44Decrypt,
        signal,
      }),
  });
  return data.construct;
}

// ─── Shared outbound evaluation (used by BOTH the seam and the hook) ──────────

/**
 * Pure-ish outbound TEPP evaluation shared by the signer seam and the hook gate.
 * Given an already-resolved (non-null) construct, a full draft event, the kid's
 * cached follow list, and a reference-closure prefetcher, it applies the
 * identical decision logic the hook gate uses: record-list delta for kind-3,
 * closure prefetch (pending fail-open), `evaluateEvent(..., direction)`, and a
 * throw on concrete `deny`. Exemptions are applied by the CALLER (the seam) /
 * the hook's own enabled-gating — this function assumes the event is gateable.
 *
 * Throws `TeppDeniedError(verdict)` on a concrete deny; resolves otherwise.
 */
export async function evaluateOutboundDraft(args: {
  draft: NostrEvent;
  prevFollowPubkeys: string[] | null;
  query: SeamQueryFn;
  construct: Construct;
}): Promise<void> {
  const { draft: fullDraft, prevFollowPubkeys, query, construct } = args;

  const isRecordList = RECORD_LIST_KINDS.has(fullDraft.kind);
  const draft = isRecordList
    ? buildDeltaEventForRecordList(fullDraft, prevFollowPubkeys)
    : fullDraft;

  // Pre-fetch the reference closure so a reply/quote resolves concretely instead
  // of `pending`. A failed prefetch fails OPEN — identical to the hook gate.
  let eventCache: Map<string, NostrEvent> | undefined;
  try {
    const { cache } = await prefetchReferenceClosure([draft], query);
    eventCache = cache;
  } catch {
    eventCache = undefined;
  }

  const direction = isRecordList ? 'incoming' : 'outgoing';
  const verdict = evaluateEvent(
    draft as unknown as Parameters<typeof evaluateEvent>[0],
    construct,
    direction,
    eventCache
      ? { eventCache: eventCache as unknown as Map<string, never> }
      : {},
  );
  // Only a concrete deny blocks. `pending` (unfetchable reference) fails open —
  // the same per-reference fail-open on a LOADED construct the hook gate keeps.
  if (verdict.result === 'deny') {
    throw new TeppDeniedError(verdict);
  }
}

// ─── The wrapped signer ──────────────────────────────────────────────────────

/** Minimal NUser signer surface we must preserve on the proxy. */
type NUserSigner = NUser['signer'];

/** Inputs the wrapper closes over to evaluate a kid's outbound event. */
export interface GatedSignerContext {
  /** The kid this signer belongs to (its pubkey). */
  kidPubkey: string;
  /** The family's parent pubkey (construct guardian + NIP-44 conversation key). */
  parentPubkey: string;
  /** Shared TanStack client — gives the seam the same construct cache as the hook. */
  queryClient: QueryClient;
  /** Relay query surface (`nostr.query`). */
  query: SeamQueryFn;
  /** Parent signer's NIP-44 decrypt, for the construct's private section. */
  nip44Decrypt?: SeamNip44Decrypt;
  /**
   * Read the kid's previously-published follow pubkeys for kind-3 delta
   * evaluation. Defaults to the shared TanStack `['follow-list', kid]` cache via
   * `readCachedFollowPubkeys`.
   */
  readPrevFollowPubkeys?: () => string[] | null;
}

/**
 * Wrap a KID NUser's signer so every `signEvent` is TEPP-gated at the seam.
 *
 * The full signer surface (`nip04`, `nip44`, `getPublicKey`, and any other
 * members) is preserved via a `Proxy` that only intercepts `signEvent`; every
 * other property/method delegates straight through to the underlying signer.
 * Only `signEvent` runs the gate, then forwards to the real signer.
 *
 * Exempt kinds (`TEPP_SIGNER_EXEMPT_KINDS`) and the fail-closed/-open semantics
 * mirror the hook gate exactly (shared via `evaluateOutboundDraft` /
 * `resolveConstructViaCache`).
 */
export function wrapKidSigner(
  signer: NUserSigner,
  ctx: GatedSignerContext,
): NUserSigner {
  const gatedSignEvent = async (
    template: EventTemplate,
  ): Promise<VerifiedEvent> => {
    const kind = template.kind;

    // Exempt protocol / self / parent-channel / settings kinds outright.
    if (!TEPP_SIGNER_EXEMPT_KINDS.has(kind)) {
      // KUBO-154 fail-closed: an enforced kid must never sign ungated. Resolve
      // the construct via the shared cache; null → deny (construct-unavailable).
      const construct = await resolveConstructViaCache({
        queryClient: ctx.queryClient,
        kidPubkey: ctx.kidPubkey,
        parentPubkey: ctx.parentPubkey,
        query: ctx.query,
        nip44Decrypt: ctx.nip44Decrypt,
      });
      if (!construct) {
        throw TeppDeniedError.constructUnavailable();
      }

      const draft: NostrEvent = {
        id: '0'.repeat(64),
        sig: '0'.repeat(128),
        pubkey: ctx.kidPubkey,
        kind: template.kind,
        content: template.content ?? '',
        tags: template.tags ?? [],
        created_at:
          (template as { created_at?: number }).created_at ??
          Math.floor(Date.now() / 1000),
      };

      const prevFollowPubkeys = ctx.readPrevFollowPubkeys
        ? ctx.readPrevFollowPubkeys()
        : readCachedFollowPubkeys(ctx.queryClient, ctx.kidPubkey);

      await evaluateOutboundDraft({
        draft,
        prevFollowPubkeys,
        query: ctx.query,
        construct,
      });
    }

    return signer.signEvent(template) as Promise<VerifiedEvent>;
  };

  return new Proxy(signer, {
    get(target, prop, receiver) {
      if (prop === 'signEvent') return gatedSignEvent;
      const value = Reflect.get(target, prop, receiver);
      // Bind methods (nip04/nip44 objects, getPublicKey) to the real signer so
      // `this` stays correct when called through the proxy.
      if (typeof value === 'function') return value.bind(target);
      return value;
    },
  }) as NUserSigner;
}
