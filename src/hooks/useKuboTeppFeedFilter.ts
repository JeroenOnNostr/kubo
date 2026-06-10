import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { Event as NostrToolsEvent } from 'nostr-tools/core';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useKuboTeppConstruct } from '@/hooks/useKuboTeppConstruct';
import { useTeppEnforced } from '@/lib/tepp-adapters/useTeppEnforced';
import { useTeppReferenceCache } from '@/hooks/useTeppReferenceCache';
import { evaluateEvent } from '@/lib/tepp/evaluate';
import {
  getCachedVerdict,
  setCachedVerdict,
  timeBucketedFingerprint,
} from '@/lib/tepp-adapters/verdictCache';
import type { Construct, FullEventVerdict } from '@/lib/tepp/types';

/** The vendored evaluator keys its cache by nostr-tools `Event`; our events
 *  are structurally compatible, so cast through `unknown` at the boundary. */
function toEvalCache(cache: Map<string, NostrEvent>): Map<string, NostrToolsEvent> {
  return cache as unknown as Map<string, NostrToolsEvent>;
}

export interface KuboTeppFeedFilter {
  /** True when the filter should be applied (flag on + active kid + construct loaded). */
  enabled: boolean;
  /**
   * Returns false to skip the event from the feed. Returns true (pass-through)
   * when disabled. Cheap to call repeatedly — verdict cache memoizes per
   * `(constructFingerprint, eventId, 'incoming')`.
   */
  shouldShow: (event: NostrEvent) => boolean;
}

const PASS: KuboTeppFeedFilter = { enabled: false, shouldShow: () => true };

/**
 * KUBO-155 pure mode decision (unit-testable):
 *  - `'pass'`     — TEPP not enforced; show everything (no filtering).
 *  - `'hide-all'` — enforced but no construct/fingerprint → fail-closed: hide
 *                   every item rather than fall through to the firehose.
 *  - `'evaluate'` — enforced + construct loaded → per-event evaluation.
 */
export function resolveFeedFilterMode(
  enforced: boolean,
  hasConstruct: boolean,
  hasFingerprint: boolean,
): 'pass' | 'hide-all' | 'evaluate' {
  if (!enforced) return 'pass';
  if (!hasConstruct || !hasFingerprint) return 'hide-all';
  return 'evaluate';
}

/**
 * Render-side TEPP feed filter. Detects whether the active user is a kid
 * with a loaded construct; if so, returns a predicate that drops events
 * whose authors (or referenced surfaces) are *denied* by the kid's construct.
 * Pass-through otherwise.
 *
 * Pass the events currently in the feed so the hook can pre-fetch their
 * reference closure (replies/quotes/reposts point at other events the
 * evaluator must see). While that closure is still loading — or a reference
 * genuinely can't be fetched — the post is shown (fail-open); only a concrete
 * `deny` hides it. Without the closure the evaluator returns `pending` for
 * every referencing post, which is what previously emptied the kid feed.
 */
export function useKuboTeppFeedFilter(
  events?: NostrEvent[],
): KuboTeppFeedFilter {
  const { user } = useCurrentUser();
  const activePubkey = user?.pubkey;
  // KUBO-152: enforcement is the parent-controlled family flag, not the
  // kid-writable feedSettings.
  const enforced = useTeppEnforced(activePubkey);
  const { construct, fingerprint } = useKuboTeppConstruct(
    enforced ? activePubkey : undefined,
  );

  const active = !!(enforced && construct && fingerprint);
  const { cache, isResolving } = useTeppReferenceCache(events, fingerprint, active);

  return useMemo<KuboTeppFeedFilter>(() => {
    // KUBO-155 fail-closed: PASS (show everything) ONLY when TEPP is not
    // enforced for this user. When enforced but the construct is null (relay
    // withholding the state event, cold start, parent logged out, …) we HIDE
    // every item rather than fall through to the unscoped firehose.
    const mode = resolveFeedFilterMode(enforced, !!construct, !!fingerprint);
    if (mode === 'pass') return PASS;
    if (mode === 'hide-all') {
      return { enabled: true, shouldShow: () => false };
    }
    return {
      enabled: true,
      shouldShow: (event: NostrEvent) =>
        isVisible(event, construct!, fingerprint!, cache, isResolving),
    };
  }, [enforced, construct, fingerprint, cache, isResolving]);
}

function isVisible(
  event: NostrEvent,
  construct: Construct,
  fingerprint: string,
  eventCache: Map<string, NostrEvent>,
  isResolving: boolean,
): boolean {
  // While the reference closure is still loading, fail open — never blank out
  // an allowed post just because its referenced events haven't arrived yet.
  if (isResolving) return true;

  // KUBO-175: time-bucket the cache key for constructs with timed restrictions.
  const cacheFp = timeBucketedFingerprint(fingerprint, construct);
  let cached = getCachedVerdict<FullEventVerdict>(cacheFp, event.id, 'incoming');
  if (!cached) {
    cached = evaluateEvent(
      event as unknown as Parameters<typeof evaluateEvent>[0],
      construct,
      'incoming',
      { eventCache: toEvalCache(eventCache) },
    );
    // Only cache settled verdicts. A `pending` verdict means a reference is
    // still unresolved on this pass; don't memoize it, or a later closure
    // fetch wouldn't be reflected.
    if (cached.result !== 'pending') {
      setCachedVerdict(cacheFp, event.id, 'incoming', cached);
    }
  }
  // Show on any permit, and fail open on `pending` (reference unavailable —
  // we don't punish the kid for relay gaps). Hide only on a concrete deny.
  return cached.result !== 'deny';
}
