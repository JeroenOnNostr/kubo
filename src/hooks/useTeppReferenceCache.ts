import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  prefetchReferenceClosure,
  DEFAULT_CLOSURE_DEPTH,
} from '@/lib/tepp-adapters/referenceClosure';

export interface TeppReferenceCache {
  /** event id -> event for every reference resolved so far (empty until first fetch lands). */
  cache: Map<string, NostrEvent>;
  /**
   * True while the closure for the current batch is still being fetched. The
   * feed filter / gate fail OPEN while this is true so allowed posts never
   * vanish mid-fetch; once it flips false, denied references resolve to hidden.
   */
  isResolving: boolean;
}

const EMPTY: Map<string, NostrEvent> = new Map();

/**
 * Drives the reference-closure prefetch for a batch of feed events so the
 * synchronous TEPP evaluator (`evaluateEvent`) sees a populated `eventCache`
 * instead of returning `pending` for every reply/quote/repost.
 *
 * Keyed on the sorted seed-id set + construct fingerprint: a new page of feed
 * events, or a construct change, triggers a fresh closure fetch; React Query
 * dedupes and caches the result. Pass `enabled: false` (flag off / not a kid /
 * no construct) to make this a no-op that returns an empty cache.
 */
export function useTeppReferenceCache(
  events: NostrEvent[] | undefined,
  fingerprint: string | null,
  enabled: boolean,
): TeppReferenceCache {
  const { nostr } = useNostr();

  // Stable, sorted seed-id signature for the query key. The closure fetch
  // batches by id, so the cost is one round-trip per depth hop regardless of
  // batch size.
  const seedIds = useMemo(() => {
    if (!enabled || !events?.length) return [];
    return events.map((e) => e.id).sort();
  }, [enabled, events]);

  const seedKey = seedIds.join(',');

  const query = useQuery<Map<string, NostrEvent>>({
    queryKey: ['tepp-ref-closure', fingerprint ?? null, seedKey],
    enabled: enabled && seedIds.length > 0,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const seeds = (events ?? []).filter((e) => e);
      const { cache } = await prefetchReferenceClosure(seeds, nostr.query.bind(nostr), {
        maxDepth: DEFAULT_CLOSURE_DEPTH,
        signal,
      });
      return cache;
    },
  });

  const cache = query.data ?? EMPTY;
  const isResolving = enabled && seedIds.length > 0 && query.isLoading;

  return useMemo(() => ({ cache, isResolving }), [cache, isResolving]);
}
