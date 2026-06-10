import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { EventTemplate } from 'nostr-tools/pure';
import type { Event as NostrToolsEvent } from 'nostr-tools/core';
import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useParentSigner } from '@/hooks/useParentSigner';
import { useKuboTeppConstruct } from '@/hooks/useKuboTeppConstruct';
import { useTeppEnforced } from '@/lib/tepp-adapters/useTeppEnforced';
import { evaluateEvent } from '@/lib/tepp/evaluate';
import { prefetchReferenceClosure } from '@/lib/tepp-adapters/referenceClosure';
import type { Construct, FullEventVerdict } from '@/lib/tepp/types';

/**
 * Outbound TEPP gate for kid-authored events. Returns a `gate(template)`
 * function the publish path can call (and await) before signing.
 *
 * When the active user is a kid AND a construct is loaded, the template's
 * reference closure is pre-fetched and the template is fed through
 * `evaluateEvent(..., 'outgoing')`. On a concrete deny the gate throws a
 * `TeppDeniedError` carrying the verdict + offending references for the UI
 * to surface. A `pending` verdict (a referenced event we couldn't fetch)
 * fails OPEN — a kid is not blocked from replying just because the reply's
 * parent couldn't be loaded.
 *
 * When inactive (flag off, no kid, no construct), `gate()` is a no-op.
 */
/**
 * Event kinds that are RECORDS, not interactions, when authored by the kid.
 * A kind-3 follow list merely records who the kid follows — publishing it does
 * not interact with those people (no reply, reaction, repost, or zap reaches
 * them). Per the trust model, a kid may follow anyone admitted at view-or-better,
 * so these kinds are evaluated at the VIEW threshold (`'incoming'`) rather than
 * the interaction threshold (`'outgoing'`). Genuine interactions (kind 1 replies,
 * 6/16 reposts, 7 reactions, 9734 zap requests) are NOT in this set and stay
 * gated at interaction level. (KUBO-147)
 */
const RECORD_LIST_KINDS = new Set<number>([3]);

/**
 * KUBO-164: pure delta between the kid's previous published kind-3 follow list
 * and the one being published. Returns the pubkeys that are NEWLY ADDED (present
 * in `next`, absent from `prev`). Removals are intentionally ignored — a kid may
 * always shrink their own list, and pre-existing entries are carried regardless
 * of current admission (they were admitted when added; a later trust-clear must
 * not brick the whole list).
 *
 * Inputs are the `p`-tag pubkey columns (`tag[1]`) of each event. A missing
 * previous list (`prevPubkeys === null`) means EVERY entry is treated as new —
 * the first follow-list publish is fully evaluated.
 *
 * Exported for unit testing.
 */
export function computeFollowListDelta(
  prevPubkeys: string[] | null,
  nextPubkeys: string[],
): { added: string[] } {
  if (prevPubkeys === null) {
    // No prior list on record — evaluate the whole thing.
    return { added: [...new Set(nextPubkeys.filter(Boolean))] };
  }
  const prevSet = new Set(prevPubkeys.filter(Boolean));
  const added = [...new Set(nextPubkeys.filter(Boolean))].filter((pk) => !prevSet.has(pk));
  return { added };
}

/**
 * KUBO-164: build the synthetic event the gate feeds to the evaluator for a
 * record/list kind. We keep all non-`p` tags as-is, but replace the `p` tags
 * with ONLY the newly-added entries (per `computeFollowListDelta`). This means
 * the evaluator decides solely on the delta: a stale, now-unadmitted follow that
 * predates this publish is no longer present in the evaluated event, so it can't
 * hard-deny the whole list — while a newly-added unadmitted follow still does.
 *
 * Exported for unit testing.
 */
export function buildDeltaEventForRecordList(
  draft: NostrEvent,
  prevPubkeys: string[] | null,
): NostrEvent {
  const nextPubkeys = draft.tags.filter(([name]) => name === 'p').map(([, pk]) => pk);
  const { added } = computeFollowListDelta(prevPubkeys, nextPubkeys);
  const addedSet = new Set(added);
  const nonPTags = draft.tags.filter(([name]) => name !== 'p');
  // Carry only the added p-tags through; preserve their original tag shape
  // (relay hints / petnames) by selecting from the draft's own p-tags.
  const addedPTags = draft.tags.filter(([name, pk]) => name === 'p' && addedSet.has(pk));
  return { ...draft, tags: [...nonPTags, ...addedPTags] };
}

/**
 * KUBO-164: read the kid's previous published kind-3 follow pubkeys from the
 * TanStack cache populated by `useFollowList` (`['follow-list', pubkey]`).
 * Returns `null` when no list is cached (treated as "all entries are new" by
 * `computeFollowListDelta`). We prefer the cache over a fresh relay query so the
 * gate stays synchronous-ish and a relay flap can't brick a follow publish; the
 * cache is kept warm by the UI's `useFollowList` read on every kid session.
 * Exported for unit testing.
 */
export function readCachedFollowPubkeys(
  queryClient: QueryClient,
  pubkey: string,
): string[] | null {
  const data = queryClient.getQueryData<{ pubkeys?: string[] }>(['follow-list', pubkey]);
  if (data && Array.isArray(data.pubkeys)) return data.pubkeys;
  return null;
}

/**
 * Distinct denial reasons the UI can map to different copy.
 * - `'deny'`: a concrete construct verdict denied the action (the default).
 * - `'construct-unavailable'`: KUBO-154 fail-closed — TEPP is enforced for
 *   this kid but the construct couldn't be loaded (cold-start / no-association
 *   / fetch-failed / decrypt-failed / parent-logged-out). The action wasn't
 *   evaluated; we deny rather than let an ungated publish slip through.
 */
export type TeppDeniedReason = 'deny' | 'construct-unavailable';

/** Kid-friendly copy for the fail-closed construct-unavailable case (KUBO-154). */
export const CONSTRUCT_UNAVAILABLE_MESSAGE =
  "Hold on, still checking with your grown-up — try again in a moment";

export class TeppDeniedError extends Error {
  /** The full construct verdict, when the denial came from an actual evaluation. */
  verdict?: FullEventVerdict;
  /** Why the action was denied — lets the UI pick the right toast copy. */
  reason: TeppDeniedReason;
  layer?: string;
  offendingReferences: string[];
  constructor(verdict: FullEventVerdict) {
    super(`TEPP denied this action: ${verdict.message}`);
    this.name = 'TeppDeniedError';
    this.reason = 'deny';
    this.verdict = verdict;
    this.layer =
      typeof verdict.decidingIndex === 'number'
        ? verdict.references[verdict.decidingIndex]?.layer
        : undefined;
    this.offendingReferences = verdict.references
      .filter((r) => r.outcome === 'deny')
      .map((r) => r.raw);
  }

  /**
   * KUBO-154: build a fail-closed denial for the "construct unavailable while
   * enforced" case — no verdict, distinct reason, kid-friendly message.
   */
  static constructUnavailable(): TeppDeniedError {
    const err: TeppDeniedError = Object.create(TeppDeniedError.prototype);
    Error.call(err, CONSTRUCT_UNAVAILABLE_MESSAGE);
    err.name = 'TeppDeniedError';
    err.message = CONSTRUCT_UNAVAILABLE_MESSAGE;
    err.reason = 'construct-unavailable';
    err.verdict = undefined;
    err.layer = undefined;
    err.offendingReferences = [];
    return err;
  }
}

export interface KuboTeppGate {
  /** True when the gate is actively evaluating; false when inactive (no-op). */
  enabled: boolean;
  /**
   * Throws `TeppDeniedError` if the construct denies this template; resolves
   * silently otherwise (including when the gate is inactive). Awaited by the
   * publish path so the reference closure can be fetched first.
   */
  gate: (template: EventTemplate | Omit<NostrEvent, 'id' | 'sig'>) => Promise<void>;
}

/**
 * Max time `gate()` waits for an in-flight construct query to settle before
 * failing closed (KUBO-154). Covers normal cold-start propagation so a kid's
 * first publish after launch doesn't error spuriously.
 */
export const CONSTRUCT_WAIT_TIMEOUT_MS = 5_000;
/** Poll interval while waiting for the construct query to settle (KUBO-154). */
const CONSTRUCT_WAIT_POLL_MS = 150;

export function useKuboTeppGate(): KuboTeppGate {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { user: parent } = useParentSigner();
  const activePubkey = user?.pubkey;
  // KUBO-152: enforcement is the parent-controlled family flag, not the
  // kid-writable feedSettings. `useTeppEnforced()` defaults to the active user.
  const enforced = useTeppEnforced(activePubkey);
  const queryClient = useQueryClient();
  const { construct, fingerprint, loading } = useKuboTeppConstruct(
    enforced ? activePubkey : undefined,
  );

  // The gate is "enabled" (will actually evaluate) only when a construct is
  // loaded. When enforced-but-unloaded, the gate is NOT enabled in the UX
  // sense, but `gate()` still FAILS CLOSED (KUBO-154) rather than no-op.
  const enabled = !!(enforced && construct && fingerprint);

  const gate = useCallback<KuboTeppGate['gate']>(
    async (template) => {
      // Not enforced at all → genuine no-op (parent publishing, flag off, etc).
      if (!enforced) return;

      // KUBO-154 fail-closed: resolve a loaded construct or throw
      // construct-unavailable. Bounded-waits the in-flight query first.
      const activeConstruct = await resolveEnforcedConstruct({
        construct,
        loading,
        wait:
          activePubkey && parent?.pubkey
            ? () => waitForConstruct(queryClient, activePubkey, parent.pubkey)
            : undefined,
      });

      const fullDraft = templateToEvent(template, activePubkey ?? '');

      // KUBO-164: for record/list kinds (the kid's own kind-3 follow list),
      // evaluate ONLY the delta versus the kid's previously-published list.
      // Newly-added p-tags must clear the view threshold; pre-existing entries
      // are carried regardless of current admission (they were admitted when
      // added — a later parent trust-clear must not brick every follow/unfollow
      // publish). Removals are always allowed (they shrink the evaluated set).
      // No previous list on record → every entry is treated as new.
      const isRecordList = RECORD_LIST_KINDS.has(fullDraft.kind);
      const draft = isRecordList
        ? buildDeltaEventForRecordList(
            fullDraft,
            activePubkey ? readCachedFollowPubkeys(queryClient, activePubkey) : null,
          )
        : fullDraft;

      // Pre-fetch the draft's reference closure so a reply/quote resolves to a
      // concrete admit/deny instead of `pending`. Failure to fetch fails open.
      let eventCache: Map<string, NostrEvent> | undefined;
      try {
        const { cache } = await prefetchReferenceClosure([draft], nostr.query.bind(nostr));
        eventCache = cache;
      } catch {
        eventCache = undefined;
      }

      // Record/list kinds (the kid's own follow list) only require each
      // referenced pubkey to be admitted at view-or-better — the same
      // threshold as an incoming event. Real interactions stay 'outgoing'
      // (interaction-level required).
      const direction = isRecordList ? 'incoming' : 'outgoing';

      const verdict = evaluateEvent(
        draft as unknown as Parameters<typeof evaluateEvent>[0],
        activeConstruct as Construct,
        direction,
        eventCache
          ? { eventCache: eventCache as unknown as Map<string, NostrToolsEvent> }
          : {},
      );
      // Only block on a concrete deny. `pending` (unfetchable reference) fails
      // open so relay gaps don't silently stop a kid from posting — this
      // per-reference fail-open on a LOADED construct is intentional and stays
      // exactly as-is (KUBO-154 only fail-closes the unloaded-construct case).
      if (verdict.result === 'deny') {
        throw new TeppDeniedError(verdict);
      }
    },
    [enforced, construct, loading, activePubkey, parent?.pubkey, queryClient, nostr],
  );

  return { enabled, gate };
}

/**
 * KUBO-154 fail-closed decision (pure, unit-testable). Given the current
 * construct + loading state and an optional bounded-wait function:
 *
 *  - construct already loaded → return it (proceed to evaluation).
 *  - construct null + query in flight (`loading`) + a wait fn → await the
 *    bounded wait; if it yields a construct, return it; else throw.
 *  - construct null + settled (not loading, or no wait fn) → throw immediately.
 *
 * The throw is always `TeppDeniedError.constructUnavailable()` — an enforced
 * kid must never publish ungated, regardless of WHICH null reason applies
 * (no-association / fetch-failed / decrypt-failed / parent-logged-out).
 */
export async function resolveEnforcedConstruct(args: {
  construct: Construct | null;
  loading: boolean;
  wait?: () => Promise<Construct | null>;
}): Promise<Construct> {
  const { construct, loading, wait } = args;
  if (construct) return construct;
  let resolved: Construct | null = null;
  if (loading && wait) {
    resolved = await wait();
  }
  if (!resolved) {
    throw TeppDeniedError.constructUnavailable();
  }
  return resolved;
}

/**
 * KUBO-154: poll the construct query in the TanStack cache for up to
 * `CONSTRUCT_WAIT_TIMEOUT_MS`, returning the loaded `Construct` the moment it
 * appears, or `null` if the wait elapses / the query settles to a null
 * construct. The query key mirrors `useKuboTeppConstruct`'s
 * (`['kubo-tepp-construct', kid, parent]`). We poll rather than await a single
 * promise so a query that settles to a *null-construct* data value (e.g.
 * `fetch-failed`) ends the wait immediately instead of blocking the full
 * timeout. Exported for unit testing.
 */
export async function waitForConstruct(
  queryClient: QueryClient,
  kidPubkey: string,
  parentPubkey: string,
  timeoutMs: number = CONSTRUCT_WAIT_TIMEOUT_MS,
  pollMs: number = CONSTRUCT_WAIT_POLL_MS,
): Promise<Construct | null> {
  const queryKey = ['kubo-tepp-construct', kidPubkey, parentPubkey];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const data = queryClient.getQueryData<{ construct: Construct | null }>(queryKey);
    // A construct loaded — done.
    if (data?.construct) return data.construct;
    // The query has SETTLED to data with a null construct (some null reason) —
    // no point waiting further; fail closed now.
    if (data && data.construct === null) return null;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Synthesise a fully-formed (unsigned) NostrEvent from a template so the
 * evaluator's reference walker has a real event shape to operate on. The
 * id/sig fields are placeholders — they don't affect reference extraction.
 */
function templateToEvent(
  template: EventTemplate | Omit<NostrEvent, 'id' | 'sig'>,
  pubkey: string,
): NostrEvent {
  const created_at = (template as { created_at?: number }).created_at ?? Math.floor(Date.now() / 1000);
  return {
    id: '0'.repeat(64),
    sig: '0'.repeat(128),
    pubkey,
    kind: template.kind,
    content: template.content ?? '',
    tags: template.tags ?? [],
    created_at,
  };
}
