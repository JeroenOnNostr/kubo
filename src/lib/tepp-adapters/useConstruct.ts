import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useParentSigner } from '@/hooks/useParentSigner';
import { isTeppEnforced } from './useTeppEnforced';
import { parseAssociation, pickCurrentAssociation } from '@/lib/tepp/parse';
import { pickCurrentState } from '@/lib/tepp/parseState';
import { parsePermission } from '@/lib/tepp/parsePermission';
import { parseBlacklist } from '@/lib/tepp/parseBlacklist';
import { parseGlobal } from '@/lib/tepp/parseGlobal';
import {
  KIND_ASSOCIATION,
  KIND_BLACKLIST,
  KIND_GLOBAL_RESTRICTION,
  KIND_STATE,
  PERMISSION_KINDS,
} from '@/lib/tepp/kinds';
import type {
  Construct,
  ParsedAssociation,
  ParsedBlacklist,
  ParsedGlobal,
  ParsedPermission,
  ParsedState,
  PermissionRef,
} from '@/lib/tepp/types';

import { assembleConstruct } from './construct';
import { constructFingerprintSync } from './fingerprint';

export interface UseKuboTeppConstructResult {
  /** Assembled construct, or null when unavailable (flag off, no kid, no assoc, error). */
  construct: Construct | null;
  /** Stable cache-key fingerprint, or null when no construct. */
  fingerprint: string | null;
  /** True while any underlying query is loading. */
  loading: boolean;
  /** Free-form reason when construct is null but a kid pubkey was given. */
  reason?:
    | 'flag-off'
    | 'no-kid'
    | 'no-association'
    | 'no-state-event'
    | 'parent-logged-out'
    | 'decrypt-failed'
    | 'fetch-failed';
  /** Error message attached when reason === 'fetch-failed' or 'decrypt-failed'. */
  errorMessage?: string;
}

/** 10-minute clock-skew allowance for association `created_at` (KUBO-157). */
export const ASSOC_CREATED_AT_SKEW_SECONDS = 600;

/** Base interval for the transient construct poll, in ms (KUBO-175). */
export const TRANSIENT_POLL_BASE_MS = 1_500;
/** Upper bound for the exponential transient-poll backoff, in ms (KUBO-175). */
export const TRANSIENT_POLL_MAX_MS = 30_000;
/**
 * After this many consecutive `decrypt-failed` results we stop polling: a
 * decrypt failure is almost always a stable key/format mismatch, not a relay
 * propagation race, so endless retries just burn battery (KUBO-175).
 */
export const DECRYPT_FAILED_MAX_RETRIES = 5;

/**
 * Exponential backoff for the transient construct poll (KUBO-175). Starts at
 * `TRANSIENT_POLL_BASE_MS` and doubles per consecutive failure, capped at
 * `TRANSIENT_POLL_MAX_MS`. `failureCount` is 0 on the first poll.
 */
export function transientPollDelayMs(failureCount: number): number {
  const n = Math.max(0, failureCount);
  const delay = TRANSIENT_POLL_BASE_MS * 2 ** n;
  return Math.min(delay, TRANSIENT_POLL_MAX_MS);
}

/**
 * Per-query consecutive `decrypt-failed` counter. Keyed by `kid:parent`.
 * Reset whenever a construct loads or a non-decrypt reason is reached. Lives at
 * module scope because the count must survive React re-renders / query refetches
 * (the TanStack query data itself can't track "how many times in a row").
 */
const decryptFailureCounts = new Map<string, number>();

/**
 * KUBO-155: last-known-GOOD construct per `kid:parent`. On a TRANSIENT failure
 * (a relay flap that withholds the association/state/permission events for a
 * few seconds — `no-association` / `no-state-event` / `fetch-failed`) we serve
 * the most recent successfully-assembled construct rather than collapsing to a
 * null construct, which would otherwise blank the kid feed and (with the
 * KUBO-155 fail-closed filter/feed) flip every item to hidden during the flap.
 *
 * This is the explicit equivalent of TanStack's `keepPreviousData`, but it
 * survives the queryFn returning a *settled* null (which `keepPreviousData`
 * does NOT cover — that only bridges the in-flight/key-change gap). We never
 * cache across a `decrypt-failed` (stable key/format problem, not a flap) and
 * never resurrect a construct once a TERMINAL reason (flag-off / parent
 * logged out) is reached — those are handled by the hook's early returns and
 * by clearing the cache below.
 */
const lastKnownGoodConstructs = new Map<
  string,
  { construct: Construct; fingerprint: string | null }
>();

/** Reasons treated as TRANSIENT relay flaps eligible for last-known-good fallback. */
const TRANSIENT_FALLBACK_REASONS: ReadonlySet<string> = new Set([
  'no-association',
  'no-state-event',
  'fetch-failed',
]);

/**
 * KUBO-155 pure fallback decision (unit-testable). Given the query's settled
 * data and a last-known-good entry, decide what to serve:
 *  - fresh construct present → serve it (and the caller caches it).
 *  - null + transient reason + a cached LKG → serve the cached construct (flap).
 *  - otherwise → serve the data as-is (null).
 *
 * `decrypt-failed` is intentionally NOT transient (stable key/format problem),
 * so it never resurrects a stale construct.
 */
export function pickConstructWithFallback(
  data: { construct: Construct | null; fingerprint: string | null; reason?: string },
  lkg: { construct: Construct; fingerprint: string | null } | undefined,
): { construct: Construct | null; fingerprint: string | null; usedFallback: boolean } {
  if (data.construct) {
    return { construct: data.construct, fingerprint: data.fingerprint, usedFallback: false };
  }
  if (lkg && data.reason && TRANSIENT_FALLBACK_REASONS.has(data.reason)) {
    return { construct: lkg.construct, fingerprint: lkg.fingerprint, usedFallback: true };
  }
  return { construct: null, fingerprint: data.fingerprint, usedFallback: false };
}

/**
 * KUBO-157: pick the current valid association for a specific family, applying
 * Kubo-side integrity checks the vendored picker can't (it has no knowledge of
 * who the real parent is):
 *
 * 1. Future-dating clamp — drop candidates whose `created_at` is more than
 *    `ASSOC_CREATED_AT_SKEW_SECONDS` ahead of `now`. Without this a kid-signed
 *    17700 dated years ahead permanently wins `pickCurrentAssociation`'s
 *    max-`created_at` sort.
 * 2. Structural rejection — drop candidates whose parse flags a missing subject
 *    or missing guardian tag (we accept missing *expiration* deliberately: Kubo
 *    always emits one and the picker fails-closed on a present-but-invalid one).
 * 3. Guardian pinning — after picking, require the winning association's guardian
 *    set to include the family's known parent pubkey. Otherwise a kid could name
 *    their own second key as guardian and self-govern; treat as no-association.
 *
 * Returns the picked `ParsedAssociation`, or `null` (→ caller reports
 * `no-association`). Pure and React-free so it's unit-testable directly.
 */
export function pickAssociationForFamily(
  events: NostrEvent[],
  parentPubkey: string,
  now: number = Math.floor(Date.now() / 1000),
): ParsedAssociation | null {
  const skewCutoff = now + ASSOC_CREATED_AT_SKEW_SECONDS;
  const candidates = events.filter((e) => {
    if (e.created_at > skewCutoff) return false; // future-dated — drop
    const parsed = (() => {
      try {
        return parseAssociation(e);
      } catch {
        return null;
      }
    })();
    if (!parsed) return false;
    const { parseProblems } = parsed.validity;
    if (parseProblems.includes('Missing required subject tag')) return false;
    if (parseProblems.includes('No guardian tags found')) return false;
    return true;
  });

  const picked = pickCurrentAssociation(candidates);
  if (!picked) return null;

  // Guardian pinning: the family's real parent must be among the guardians.
  const parentLower = parentPubkey.toLowerCase();
  const namesParent = picked.guardians.some((g) => g.pubkey.toLowerCase() === parentLower);
  if (!namesParent) return null;

  return picked;
}

/**
 * Kubo-owned reimplementation of TEPP's `useConstruct`, rebuilt on TanStack
 * Query so it shares cache invariants with the rest of the app. The query key
 * is `['kubo-tepp-construct', kidPubkey, parentPubkey]` — it does NOT include
 * the association event id (the assoc is fetched inside the query fn). A
 * rotated association is picked up by the short `staleTime` / transient
 * `refetchInterval` poll, and the resulting construct fingerprint (which DOES
 * fold in `assoc.raw.id`) re-keys every downstream verdict cache.
 *
 * When TEPP is NOT enforced for this kid (KUBO-152: the parent-controlled
 * family flag `family.teppEnforced` is off, or the target isn't a kid in the
 * family) OR no kidPubkey is provided, returns
 * `{construct: null, fingerprint: null, loading: false, reason: 'flag-off'|'no-kid'}`
 * early without any relay traffic.
 *
 * KUBO-152: enforcement is derived from the parent-controlled family flag via
 * `isTeppEnforced`, NOT from `config.feedSettings.featureTepp` (which is a
 * kid-writable synced setting and must never be able to disable a kid's own
 * protection).
 */
export function useKuboTeppConstruct(kidPubkey: string | undefined): UseKuboTeppConstructResult {
  const { nostr } = useNostr();
  const { family } = useKuboFamily();
  const { user: parent, reason: parentReason } = useParentSigner();

  // KUBO-152: enforcement comes from the family flag, not feedSettings.
  const enforced = isTeppEnforced(family, kidPubkey);

  const enabled = Boolean(
    enforced && kidPubkey && parent,
  );

  const query = useQuery<{
    construct: Construct | null;
    fingerprint: string | null;
    reason?: UseKuboTeppConstructResult['reason'];
    errorMessage?: string;
  }>({
    queryKey: ['kubo-tepp-construct', kidPubkey ?? null, parent?.pubkey ?? null],
    enabled,
    // Short staleTime so a fresh trust assignment is reflected in the kid
    // feed within seconds. Fetch is cheap (small filter on a small relay
    // set); the verdict cache absorbs per-event evaluation cost.
    staleTime: 5_000,
    gcTime: 5 * 60_000,
    // KUBO-155: keep serving the previous query result while a refetch is in
    // flight (relay flap), so the construct doesn't momentarily read as
    // loading/null between polls. The module-level last-known-good cache above
    // additionally bridges the case where the queryFn SETTLES to a transient
    // null (which keepPreviousData alone does not cover).
    placeholderData: keepPreviousData,
    // KUBO-152: while the construct is null for a TRANSIENT reason (the
    // association/state/permission events exist but haven't propagated to the
    // queried relays yet — common in the seconds right after onboarding seeds
    // them), poll so the kid feed's hold-until-ready gate resolves quickly
    // instead of waiting for the next staleTime window or a manual
    // invalidation. Stops the moment a construct loads OR a terminal reason
    // (flag-off / no-kid / parent-logged-out) is reached.
    refetchInterval: (query) => {
      const data = query.state.data;
      const countKey = `${kidPubkey ?? ''}:${parent?.pubkey ?? ''}`;
      // `fetchFailureCount` counts thrown queryFn rejections (now only truly
      // unexpected errors, since assoc/state/fetch throws are mapped to data
      // reasons below). Use it to back off the first-fetch retry too.
      const failureCount = query.state.fetchFailureCount;
      if (!data) {
        // first fetch in flight / threw — keep trying with backoff
        return transientPollDelayMs(failureCount);
      }
      if (data.construct) {
        decryptFailureCounts.delete(countKey); // loaded — reset + stop polling
        return false;
      }
      // Cap consecutive decrypt failures: a decrypt failure is a stable
      // key/format problem, not a propagation race — stop hammering.
      if (data.reason === 'decrypt-failed') {
        const next = (decryptFailureCounts.get(countKey) ?? 0) + 1;
        decryptFailureCounts.set(countKey, next);
        if (next >= DECRYPT_FAILED_MAX_RETRIES) return false;
        return transientPollDelayMs(next - 1);
      }
      decryptFailureCounts.delete(countKey);
      const transient =
        data.reason === 'no-association' ||
        data.reason === 'no-state-event' ||
        data.reason === 'fetch-failed';
      return transient ? transientPollDelayMs(failureCount) : false;
    },
    queryFn: async ({ signal }) => {
      // Re-check guards inside the query (TS narrowing + safety):
      if (!kidPubkey || !parent) {
        return { construct: null, fingerprint: null, reason: 'no-kid' as const };
      }

      // 1. Association — kid-signed kind 17700 with subject = kidPubkey.
      // KUBO-175: a relay/query failure here must become reason 'fetch-failed'
      // (transient, keeps polling) rather than a reason-less thrown error.
      let assocEvents: NostrEvent[];
      try {
        assocEvents = await nostr.query(
          [{ kinds: [KIND_ASSOCIATION], authors: [kidPubkey], limit: 10 }],
          { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
        );
      } catch (err) {
        return {
          construct: null,
          fingerprint: null,
          reason: 'fetch-failed' as const,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
      // KUBO-157: future-dating clamp, structural rejection, and guardian
      // pinning against the family's known parent (parent.pubkey). A winning
      // association that does not name the real parent as a guardian is treated
      // as no-association (a kid cannot self-govern by naming their own key).
      const assoc = pickAssociationForFamily(assocEvents, parent.pubkey);
      if (!assoc) {
        return { construct: null, fingerprint: null, reason: 'no-association' as const };
      }

      // 2. State — parent-signed kind 34700 with d=kidPubkey, authored by a guardian.
      // KUBO-175: same fetch-failed mapping as the association query above.
      const guardianPubkeys = assoc.guardians.map((g) => g.pubkey);
      let stateEvents: NostrEvent[];
      try {
        stateEvents = await nostr.query(
          [{
            kinds: [KIND_STATE],
            authors: guardianPubkeys,
            '#d': [kidPubkey.toLowerCase()],
            limit: 50,
          }],
          { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
        );
      } catch (err) {
        return {
          construct: null,
          fingerprint: null,
          reason: 'fetch-failed' as const,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
      if (stateEvents.length === 0) {
        return { construct: null, fingerprint: null, reason: 'no-state-event' as const };
      }
      const guardianSet = new Set(guardianPubkeys.map((p) => p.toLowerCase()));
      const picked = pickCurrentState(stateEvents.map((e) => e), guardianSet);
      if (!picked) {
        return { construct: null, fingerprint: null, reason: 'no-state-event' as const };
      }
      const state: ParsedState = picked.current;

      // 3. Decrypt the private section (NIP-44 v2).
      let decryptedPermissions: PermissionRef[] = [];
      let decryptedBlacklistRef: string | undefined;
      let decryptedGlobalRef: string | undefined;
      const nip44 = (parent.signer as unknown as {
        nip44?: { decrypt: (pubkey: string, ciphertext: string) => Promise<string> };
      }).nip44;
      if (state.raw.content && nip44) {
        try {
          // The state event's private section is encrypted by the parent
          // *to the kid* (subject) per `useKuboTeppPublishState`. NIP-44 v2
          // conversation keys are symmetric, so the parent decrypts the
          // same content by passing the kid pubkey as the other party.
          // Earlier this passed `state.guardian` (= parent's own pubkey),
          // which produced "invalid MAC" because the conversation key
          // was self↔self instead of parent↔kid.
          const plaintext = await nip44.decrypt(kidPubkey, state.raw.content);
          const parsed = JSON.parse(plaintext) as {
            blacklist?: string;
            global?: string;
            permissions?: Array<{ id: string; kind: number }>;
          };
          decryptedBlacklistRef = parsed.blacklist;
          decryptedGlobalRef = parsed.global;
          decryptedPermissions = (parsed.permissions ?? []).map((p) => ({
            id: p.id,
            kind: p.kind,
          }));
        } catch (err) {
          return {
            construct: null,
            fingerprint: null,
            reason: 'decrypt-failed' as const,
            errorMessage: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // 4. Combine public + private refs; private overrides public for blacklist + global.
      const refs: PermissionRef[] = [...state.publicPermissions, ...decryptedPermissions];
      const seen = new Set<string>();
      const uniqRefs = refs.filter((r) =>
        seen.has(r.id) ? false : (seen.add(r.id), true),
      );
      const blacklistId = decryptedBlacklistRef ?? state.publicBlacklistRef;
      const globalId = decryptedGlobalRef ?? state.publicGlobalRef;

      // 5. Fetch referenced events.
      const allRefIds = [
        ...uniqRefs.map((r) => r.id),
        ...(blacklistId ? [blacklistId] : []),
        ...(globalId ? [globalId] : []),
      ];

      let fetched: NostrEvent[] = [];
      if (allRefIds.length > 0) {
        try {
          const filter: NostrFilter = { ids: allRefIds };
          fetched = await nostr.query([filter], {
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          });
        } catch (err) {
          return {
            construct: null,
            fingerprint: null,
            reason: 'fetch-failed' as const,
            errorMessage: err instanceof Error ? err.message : String(err),
          };
        }
      }

      const fetchedById = new Map(fetched.map((e) => [e.id, e]));
      const permissions: ParsedPermission[] = [];
      for (const ref of uniqRefs) {
        const ev = fetchedById.get(ref.id);
        if (!ev) continue;
        if (!(PERMISSION_KINDS as readonly number[]).includes(ev.kind)) continue;
        permissions.push(parsePermission(ev));
      }

      let blacklist: ParsedBlacklist | undefined;
      if (blacklistId) {
        const ev = fetchedById.get(blacklistId);
        if (ev && ev.kind === KIND_BLACKLIST) blacklist = parseBlacklist(ev);
      }

      let globalEvt: ParsedGlobal | undefined;
      if (globalId) {
        const ev = fetchedById.get(globalId);
        if (ev && ev.kind === KIND_GLOBAL_RESTRICTION) globalEvt = parseGlobal(ev);
      }

      // 6. Assemble.
      const construct = assembleConstruct({
        assoc,
        state,
        permissions,
        blacklist,
        global: globalEvt,
      });

      const fingerprint = constructFingerprintSync(construct, assoc.raw.id);
      return { construct, fingerprint };
    },
  });

  const lkgKey = `${kidPubkey ?? ''}:${parent?.pubkey ?? ''}`;

  if (!enforced) {
    // Enforcement off — drop any stale last-known-good so a later re-enable
    // starts clean and can't resurrect a construct for a different family.
    lastKnownGoodConstructs.delete(lkgKey);
    return { construct: null, fingerprint: null, loading: false, reason: 'flag-off' };
  }
  if (!kidPubkey) {
    return { construct: null, fingerprint: null, loading: false, reason: 'no-kid' };
  }
  if (parentReason === 'parent-logged-out') {
    // Terminal + fail-closed: do NOT serve last-known-good. With the parent
    // logged out we can't verify anything; KUBO-155's read path holds the feed.
    lastKnownGoodConstructs.delete(lkgKey);
    return { construct: null, fingerprint: null, loading: false, reason: 'parent-logged-out' };
  }

  if (query.isLoading) return { construct: null, fingerprint: null, loading: true };
  const data = query.data;
  if (!data) return { construct: null, fingerprint: null, loading: false };

  // KUBO-155: cache the last successfully-assembled construct so we can serve
  // it across TRANSIENT failures (a brief relay flap) instead of blanking the
  // feed / flipping every item to hidden under the fail-closed filter.
  if (data.construct) {
    lastKnownGoodConstructs.set(lkgKey, {
      construct: data.construct,
      fingerprint: data.fingerprint,
    });
  }

  const picked = pickConstructWithFallback(data, lastKnownGoodConstructs.get(lkgKey));
  return {
    construct: picked.construct,
    fingerprint: picked.fingerprint,
    loading: false,
    reason: data.reason,
    errorMessage: data.errorMessage,
  };
}
