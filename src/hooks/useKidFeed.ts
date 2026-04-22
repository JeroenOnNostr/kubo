import { useNostr } from '@nostrify/react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useFeedSettings } from './useFeedSettings';
import { useFollowList } from './useFollowActions';
import { fetchPacksByAtags } from './useFollowPacks';
import { useKidFeedSourcesSelector } from './useKidFeedSources';
import { useSelectedKid } from './useSelectedKid';
import { getEnabledFeedKinds } from '@/lib/extraKinds';
import {
  getPaginationCursor,
  isRepostKind,
  parseRepostContent,
  type FeedItem,
} from '@/lib/feedUtils';
import { isReplyEvent } from '@/lib/nostrEvents';

/**
 * Shared feed driver for the kid home screen (`/kid`) and the parent feed
 * preview (`/parent/feed/preview`).
 *
 * Stage 2: true aggregator. The feed is the UNION of:
 *   (A) Kid's kind-3 follow list + own posts + pack members (author leg)
 *   (B) Firehose from each enabled relay                    (relay leg)
 *   (C) Posts tagged `#a` into each enabled NIP-72 community (community leg)
 *
 * Pagination uses a single global `until` cursor: each page fans out all
 * legs in parallel with the same `until`, merges them, dedupes by event id,
 * sorts by `created_at` desc, and computes the next cursor from the merged
 * set via `getPaginationCursor` (6-hour-gap outlier skip).
 *
 * Tradeoff: a sparse source contributes nothing in busy time windows — the
 * dominant source "wins". Matches standard aggregator behaviour.
 *
 * When no relays/communities/packs are enabled, legs B and C short-circuit
 * to empty arrays and the feed collapses to "follows + own posts" — same
 * observable behaviour as Stage 1's `useFeed('follows')` wrapper.
 */

export type { FeedItem };

const PAGE_SIZE = 15;
const OVER_FETCH_MULTIPLIER = 3;
const MAX_PACK_AUTHORS = 500;

interface FeedPage {
  items: FeedItem[];
  oldestQueryTimestamp: number;
  rawCount: number;
}

export function useKidFeed() {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { data: followData } = useFollowList();
  const followList = followData?.pubkeys;
  const { feedSettings } = useFeedSettings();

  const kid = useSelectedKid();
  const kidPubkey = kid?.pubkey ?? null;
  const sources = useKidFeedSourcesSelector(
    kidPubkey,
    (s) => s,
    (a, b) =>
      a.relays.length === b.relays.length &&
      a.communities.length === b.communities.length &&
      a.packs.length === b.packs.length &&
      a.relays.every((v, i) => v === b.relays[i]) &&
      a.communities.every((v, i) => v === b.communities[i]) &&
      a.packs.every((v, i) => v === b.packs[i]),
  );

  const allKinds = getEnabledFeedKinds(feedSettings);
  const postKinds = allKinds.filter((k) => !isRepostKind(k));
  const kindsKey = [...allKinds].sort().join(',');
  const relaysKey = [...sources.relays].sort().join(',');
  const communitiesKey = [...sources.communities].sort().join(',');
  const packsKey = [...sources.packs].sort().join(',');

  const followsReady = !!user && followList !== undefined;

  return useInfiniteQuery<FeedPage, Error>({
    // `followList` deliberately excluded — we invalidate explicitly on
    // follow/unfollow from the Profiles tile (plan M2 from Stage 1).
    queryKey: [
      'kid-feed',
      user?.pubkey ?? '',
      kindsKey,
      feedSettings.followsFeedShowReplies,
      relaysKey,
      communitiesKey,
      packsKey,
    ],
    queryFn: async ({ pageParam }) => {
      const signal = AbortSignal.timeout(10_000);
      const now = Math.floor(Date.now() / 1000);
      const until = typeof pageParam === 'number' ? pageParam : now;
      const limit = !feedSettings.followsFeedShowReplies
        ? PAGE_SIZE * OVER_FETCH_MULTIPLIER
        : PAGE_SIZE;

      function cacheEvents(events: NostrEvent[]): void {
        for (const event of events) {
          if (!queryClient.getQueryData(['event', event.id])) {
            queryClient.setQueryData(['event', event.id], event);
          }
        }
      }

      // ── Resolve pack members (one batched relay query, cached 5 min) ───
      let packAuthors: string[] = [];
      if (sources.packs.length > 0) {
        try {
          const packMap = await fetchPacksByAtags(nostr, sources.packs, signal);
          const dedup = new Set<string>();
          outer: for (const pack of packMap.values()) {
            for (const [name, value] of pack.event.tags) {
              if (name === 'p' && value) {
                dedup.add(value);
                if (dedup.size >= MAX_PACK_AUTHORS) break outer;
              }
            }
          }
          packAuthors = Array.from(dedup);
        } catch {
          packAuthors = [];
        }
      }

      // ── Fan out up to three legs in parallel ───────────────────────────
      const legA = (async (): Promise<NostrEvent[]> => {
        if (!user) return [];
        const follows = followList ?? [];
        const authors = Array.from(
          new Set([...follows, user.pubkey, ...packAuthors]),
        );
        if (authors.length === 0 || allKinds.length === 0) return [];
        try {
          return await nostr.query(
            [{ kinds: allKinds, authors, until, limit }],
            { signal },
          );
        } catch {
          return [];
        }
      })();

      const legB = (async (): Promise<NostrEvent[]> => {
        if (sources.relays.length === 0 || postKinds.length === 0) return [];
        try {
          const group = nostr.group(sources.relays);
          return await group.query(
            [{ kinds: postKinds, until, limit }],
            { signal },
          );
        } catch {
          return [];
        }
      })();

      const legC = (async (): Promise<NostrEvent[]> => {
        if (sources.communities.length === 0) return [];
        const communityKinds = [1, 1111].filter((k) => postKinds.includes(k));
        if (communityKinds.length === 0) return [];
        try {
          return await nostr.query(
            [{
              kinds: communityKinds,
              '#a': sources.communities,
              until,
              limit,
            }],
            { signal },
          );
        } catch {
          return [];
        }
      })();

      const [aRes, bRes, cRes] = await Promise.allSettled([legA, legB, legC]);
      const legAEvents = aRes.status === 'fulfilled' ? aRes.value : [];
      const legBEvents = bRes.status === 'fulfilled' ? bRes.value : [];
      const legCEvents = cRes.status === 'fulfilled' ? cRes.value : [];

      // ── Merge + dedupe raw events by id ────────────────────────────────
      const rawById = new Map<string, NostrEvent>();
      for (const ev of [...legAEvents, ...legBEvents, ...legCEvents]) {
        if (ev.created_at > now) continue;
        rawById.set(ev.id, ev);
      }
      const validEvents = Array.from(rawById.values());
      const oldestQueryTimestamp = getPaginationCursor(validEvents);

      // ── Repost-parsing pipeline (mirrors useFeed.ts:264-305) ───────────
      const items: FeedItem[] = [];
      const repostMissingIds: string[] = [];
      const repostMap = new Map<string, NostrEvent>();
      for (const ev of validEvents) {
        if (isRepostKind(ev.kind)) {
          const embedded = parseRepostContent(ev);
          if (embedded && embedded.created_at <= now) {
            items.push({
              event: embedded,
              repostedBy: ev.pubkey,
              sortTimestamp: ev.created_at,
            });
          } else {
            const repostedId = ev.tags.find(([name]) => name === 'e')?.[1];
            if (repostedId) {
              repostMissingIds.push(repostedId);
              repostMap.set(repostedId, ev);
            }
          }
        } else {
          items.push({ event: ev, sortTimestamp: ev.created_at });
        }
      }

      if (repostMissingIds.length > 0) {
        try {
          const originals = await nostr.query(
            [{ ids: repostMissingIds, limit: repostMissingIds.length }],
            { signal },
          );
          for (const original of originals) {
            const repost = repostMap.get(original.id);
            if (repost && original.created_at <= now) {
              items.push({
                event: original,
                repostedBy: repost.pubkey,
                sortTimestamp: repost.created_at,
              });
            }
          }
        } catch {
          // Timeout — skip the missing reposts.
        }
      }

      // Dedupe FeedItems by event id (prefer non-repost over repost).
      const seen = new Map<string, FeedItem>();
      for (const item of items) {
        const existing = seen.get(item.event.id);
        if (!existing) {
          seen.set(item.event.id, item);
        } else if (!item.repostedBy && existing.repostedBy) {
          seen.set(item.event.id, item);
        }
      }
      let dedupedItems = Array.from(seen.values()).sort(
        (a, b) => b.sortTimestamp - a.sortTimestamp,
      );

      if (!feedSettings.followsFeedShowReplies) {
        dedupedItems = dedupedItems.filter(
          (item) => item.repostedBy || !isReplyEvent(item.event),
        );
      }

      cacheEvents(dedupedItems.map((i) => i.event));

      return {
        items: dedupedItems,
        oldestQueryTimestamp,
        rawCount: validEvents.length,
      };
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.rawCount === 0) return undefined;
      return lastPage.oldestQueryTimestamp - 1;
    },
    initialPageParam: undefined as number | undefined,
    enabled: followsReady,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
