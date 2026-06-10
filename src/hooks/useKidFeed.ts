import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useFeedSettings } from './useFeedSettings';
import { useFollowList } from './useFollowActions';
import { fetchPacksByAtags } from './useFollowPacks';
import { useKidFeedSourcesSelector } from './useKidFeedSources';
import { useKuboTeppConstruct } from './useKuboTeppConstruct';
import { useTeppEnforced } from '@/lib/tepp-adapters/useTeppEnforced';
import { useSelectedKid } from './useSelectedKid';
import { getTeppAllowedAuthors } from '@/lib/tepp-adapters/allowedAuthors';
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

/**
 * KUBO-155 fail-closed read-path hold reason. When TEPP is enforced for the kid
 * but no construct can be assembled, the feed is HELD (empty + notice) rather
 * than falling through to the unscoped firehose.
 *  - `'parent-logged-out'` — the parent (guardian) isn't signed in on this
 *    device; the kid should ask their grown-up to log in.
 *  - `'construct-unavailable'` — the construct can't be assembled right now
 *    (relay withholding the state event, no association yet, decrypt failure).
 *  - `null` — not held (not enforced, construct loaded, or still loading).
 */
export type TeppFeedHold = 'parent-logged-out' | 'construct-unavailable' | null;

/**
 * KUBO-155 pure hold-decision (unit-testable). Returns the hold reason the kid
 * feed must surface, or null when the feed may proceed (either not enforced, a
 * construct is loaded, or the construct is still loading within the boot-splash
 * window — loading is NOT a hold).
 *
 * The critical fail-closed property: when `enforced` is true and there is no
 * construct and we're not loading, the result is ALWAYS a hold — never null —
 * so the caller can never fall through to the unscoped firehose. In particular
 * `parent-logged-out` (KUBO-155's headline case) holds rather than running the
 * feed unscoped on a shared device.
 */
export function computeTeppHold(
  enforced: boolean,
  hasConstruct: boolean,
  loading: boolean,
  reason: string | undefined,
): TeppFeedHold {
  if (!enforced || hasConstruct) return null;
  if (loading) return null; // splash/skeleton covers it
  if (reason === 'parent-logged-out') return 'parent-logged-out';
  // Any other null-construct reason while enforced → hold (fail-closed).
  return 'construct-unavailable';
}

/**
 * KUBO-159 — pure repost-author admission check (unit-testable).
 *
 * Reposts (kind 6/16) embed (or reference-by-id) an ORIGINAL event authored by
 * someone OTHER than the reposter. The query-time author allowlist only scopes
 * the reposter (the event's own `pubkey`), so an allowlisted account reposting a
 * blacklisted/unadmitted author would smuggle that author's content onto the
 * kid's screen. This closes the leak at the source.
 *
 * Returns true when the original author is allowed to be shown:
 *  - `allowSet === null` → TEPP not active for this feed → always allowed.
 *  - otherwise → only when the original author's lowercased pubkey is in the set.
 */
export function isRepostOriginalAllowed(
  originalAuthorPubkey: string,
  allowSet: Set<string> | null,
): boolean {
  if (!allowSet) return true;
  return allowSet.has(originalAuthorPubkey.toLowerCase());
}

const PAGE_SIZE = 15;
const OVER_FETCH_MULTIPLIER = 3;
/**
 * Cap on how many pack members we expand. Shared with the feed-source
 * auto-trust grant (useAddFeedPack, KUBO-147) so a pack never grants trust to
 * more members than it actually contributes to the feed.
 */
export const MAX_PACK_AUTHORS = 500;

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

  // TEPP allowlist (KUBO-102). When featureTepp is on and the active kid has a
  // loaded construct, the feed is scoped at QUERY time to the authors the
  // parent assigned view/interact (plus the kid's own pubkey). The relay does
  // the filtering, so disallowed authors are never fetched — no firehose, no
  // client-side reference-closure walk, no fail-open window. When the flag is
  // off / no construct, `allowedAuthors` is null and the legs behave as before
  // (relay firehose, follows union).
  // KUBO-152: enforcement is the parent-controlled family flag, not the
  // kid-writable feedSettings mirror.
  const teppEnforced = useTeppEnforced(kidPubkey ?? undefined);
  const { construct: teppConstruct, loading: teppLoading, reason: teppReason } =
    useKuboTeppConstruct(kidPubkey ?? undefined);
  const allowedAuthors = useMemo(
    () => (teppConstruct ? getTeppAllowedAuthors(teppConstruct) : null),
    [teppConstruct],
  );
  const allowedKey = allowedAuthors ? [...allowedAuthors].sort().join(',') : '';

  // When TEPP is on, hold the feed query until the construct is actually
  // LOADED — not merely "settled". (KUBO-152)
  //
  // The old gate (`!teppLoading`) released the feed the moment the construct
  // query settled to ANYTHING, including a transient null (e.g. the seeded
  // association/state events hadn't propagated to the queried relays yet). In
  // that window `allowedAuthors` is null, so the feed runs UNSCOPED and flashes
  // the full pack firehose — then, once the construct loads a beat later, the
  // query re-runs scoped and the just-shown notes vanish. That is exactly the
  // "loads then disappears" behaviour.
  //
  // Now we hold (the kid stays on the boot loading screen — see KidHomePage's
  // preloader gate) until either:
  //   • a construct is loaded (the normal path; the feed opens correctly
  //     scoped on first paint), OR
  //   • TEPP is NOT enforced for this kid (flag-off / no-kid — i.e. the
  //     family flag is off or this isn't a kid) — then proceed unscoped.
  //
  // KUBO-155 fail-closed read path: when TEPP IS enforced and the construct
  // cannot be assembled, we MUST NOT proceed unscoped (that is the
  // firehose-on-logout fail-open). Instead we HOLD with an empty feed and a
  // kid-friendly notice. The terminal-but-enforced reasons are:
  //   • parent-logged-out — "ask your grown-up to log in" (held indefinitely).
  //   • no-state-event / fetch-failed — held; the construct query keeps polling
  //     (refetchInterval) so a transient relay flap recovers on its own. The
  //     last-known-good cache in useKuboTeppConstruct serves a prior construct
  //     across brief flaps, so these only surface as a hold when there has
  //     never been a good construct (e.g. a relay persistently withholding the
  //     state event).
  //   • no-association / decrypt-failed — also held (no scoped authors yet).
  //
  // `teppEnforced` is the gate: only when NOT enforced do we ever run unscoped.
  const teppReady = !teppEnforced || !!teppConstruct;

  // The hold reason the UI renders as a notice (empty feed, not the firehose).
  // Null = no hold (either not enforced, construct loaded, or still loading
  // within the boot splash window). Loading is NOT a hold — KidHomePage's boot
  // splash / KidFeedList skeleton covers it.
  const teppHold: TeppFeedHold = computeTeppHold(
    teppEnforced,
    !!teppConstruct,
    teppLoading,
    teppReason,
  );

  // When enforced but we have no construct, the feed is held: never enable the
  // query (no firehose), regardless of follow/sync readiness.
  const enforcedHold = teppEnforced && !teppConstruct && !teppLoading;
  const followsReady =
    !!user && followList !== undefined && teppReady && !enforcedHold;

  const query = useInfiniteQuery<FeedPage, Error>({
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
      allowedKey,
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
      // TEPP allowlist set for this query (null = flag off / no construct).
      const allowSet = allowedAuthors ? new Set(allowedAuthors) : null;

      const legA = (async (): Promise<NostrEvent[]> => {
        if (!user) return [];
        const follows = followList ?? [];
        let authors = Array.from(
          new Set([...follows, user.pubkey, ...packAuthors]),
        );
        // When TEPP is active, the kid only sees assigned authors — intersect
        // the follows/pack union with the allowlist so unassigned follows
        // don't leak into the feed.
        if (allowSet) authors = authors.filter((a) => allowSet.has(a.toLowerCase()));
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
        // TEPP allowlist: scope the relay query to assigned authors so the
        // relay does the filtering — no firehose, no client-side hiding.
        // An empty allowlist means "nobody assigned" → skip the relay leg
        // entirely (querying with authors:[] would match everything on some
        // relays).
        if (allowSet && allowSet.size === 0) return [];
        const filter: NostrFilter = allowSet
          ? { kinds: postKinds, authors: [...allowSet], until, limit }
          : { kinds: postKinds, until, limit };
        try {
          const group = nostr.group(sources.relays);
          return await group.query([filter], { signal });
        } catch {
          return [];
        }
      })();

      const legC = (async (): Promise<NostrEvent[]> => {
        if (sources.communities.length === 0) return [];
        const communityKinds = [1, 1111].filter((k) => postKinds.includes(k));
        if (communityKinds.length === 0) return [];
        if (allowSet && allowSet.size === 0) return [];
        const filter: NostrFilter = {
          kinds: communityKinds,
          '#a': sources.communities,
          ...(allowSet ? { authors: [...allowSet] } : {}),
          until,
          limit,
        };
        try {
          return await nostr.query([filter], { signal });
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
            // KUBO-159: the reposter is allowlisted (relay leg scoped to
            // allowSet) but the ORIGINAL author is not — drop the smuggled-in
            // content rather than render it on the kid's screen.
            if (!isRepostOriginalAllowed(embedded.pubkey, allowSet)) continue;
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
              // KUBO-159: originals are fetched by id with NO author
              // constraint (the verified leak) — re-check the original author
              // against the allowlist before showing it.
              if (!isRepostOriginalAllowed(original.pubkey, allowSet)) continue;
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

  // KUBO-155: expose the hold status so the UI (KidFeedList) can render a
  // kid-friendly notice instead of an empty-feed message or a spinner. The
  // query itself is disabled while held (no firehose).
  return { ...query, teppHold };
}
