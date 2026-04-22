import type { QueryClient } from '@tanstack/react-query';

import {
  communitiesByAtagsQueryKey,
  fetchCommunitiesByAtags,
} from '@/hooks/useCommunities';
import {
  fetchPacksByAtags,
  packsByAtagsQueryKey,
} from '@/hooks/useFollowPacks';
import type { KidFeedSources } from '@/hooks/useKuboFamily';

/**
 * Boot-time priming for the parent feed tiles (plan M3).
 *
 * On fresh mount of KuboParentLayout, fire ONE batched query per source
 * type for the selected kid's enabled items. Seeds the React Query cache
 * with the EXACT same query keys that useCommunitiesByAtags /
 * usePacksByAtags use, so when /parent/feed mounts shortly after the
 * tiles serve from cache instead of firing 15–30 parallel queries on first
 * paint.
 *
 * Idempotent: React Query's prefetchQuery no-ops when the cache entry is
 * present and not stale.
 *
 * Skips:
 *  - Relays: useRelayInfo has a 12h HTTP cache per-URL; cheap enough.
 *  - Profiles: useAuthor reads synchronously from profileCache (IndexedDB)
 *    via initialData, so the first render is already a cache hit.
 */

type NostrQuerier = Parameters<typeof fetchCommunitiesByAtags>[0];

export async function primeFeedSourcesCache({
  queryClient,
  nostr,
  sources,
}: {
  queryClient: QueryClient;
  nostr: NostrQuerier;
  sources: KidFeedSources;
}): Promise<void> {
  const MAX_PRIME = 5; // only the chips are eagerly primed
  const tasks: Promise<unknown>[] = [];

  if (sources.communities.length > 0) {
    const atags = sources.communities.slice(0, MAX_PRIME);
    tasks.push(
      queryClient.prefetchQuery({
        queryKey: communitiesByAtagsQueryKey(atags),
        queryFn: ({ signal }) =>
          fetchCommunitiesByAtags(nostr, atags, signal),
        staleTime: 5 * 60 * 1000,
      }),
    );
  }

  if (sources.packs.length > 0) {
    const atags = sources.packs.slice(0, MAX_PRIME);
    tasks.push(
      queryClient.prefetchQuery({
        queryKey: packsByAtagsQueryKey(atags),
        queryFn: ({ signal }) => fetchPacksByAtags(nostr, atags, signal),
        staleTime: 5 * 60 * 1000,
      }),
    );
  }

  await Promise.allSettled(tasks);
}
