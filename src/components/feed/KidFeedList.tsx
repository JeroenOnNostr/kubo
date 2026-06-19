import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';

import { KidNavigationInterceptor } from '@/components/feed/KidNavigationInterceptor';
import { ParentNavigationInterceptor } from '@/components/feed/ParentNavigationInterceptor';
import { NoteCard } from '@/components/NoteCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useKidFeed } from '@/hooks/useKidFeed';
import { useKuboTeppFeedFilter } from '@/hooks/useKuboTeppFeedFilter';
import { getKidSettings } from '@/hooks/useKuboFamily';
import { useMuteList } from '@/hooks/useMuteList';
import { shouldHideFeedEvent } from '@/lib/feedUtils';
import { KID_TILE_ROUNDING } from '@/lib/kidFeedLayout';
import { isEventMuted } from '@/lib/muteHelpers';
import { cn } from '@/lib/utils';
import type { FeedItem } from '@/lib/feedUtils';

/**
 * Pixel gap between the top of the viewport and the top of the
 * most-recently-unlocked post when the scroll-cap is active.
 * Also the height of the "peek" strip shown for the next locked post.
 * The `NextPostFAB` smooth-scroll target uses this same constant.
 */
export const KID_FEED_PEEK_PX = 12;

/**
 * Shared feed list for the kid home screen (`/kid`) and the parent feed
 * preview (`/parent/feed`).
 *
 * Queries via `useKidFeed` (thin wrapper over `useFeed('follows')`) and
 * renders every item through Ditto's universal `NoteCard`. `NoteCard`
 * dispatches on `event.kind` — kind 21/22 embed a real `VideoPlayer`
 * (inline playback, no navigation), kind 1 renders as a text note, kind
 * 30023 as an article card, music/podcast kinds get their own players,
 * and so on. Kinds are driven entirely by `feedSettings`, so toggling the
 * kind checkboxes on /parent/kid/:id/feed-settings flows through here
 * automatically.
 *
 * Mirrors the flatten + dedupe + mute/hide pipeline from
 * `src/components/Feed.tsx:186-223` so Kubo inherits the same filter
 * semantics Ditto already applies to the main home feed.
 */
interface KidFeedListProps {
  /**
   * Visual variant:
   *  - `'kid'` — deep-blue translucent card background (for `/kid` inside
   *    KuboKidLayout).
   *  - `'parent'` — default card chrome (for `/parent/feed`).
   *
   * The wrapper around each `NoteCard` differs; the card itself stays
   * stock Ditto.
   */
  variant: 'kid' | 'parent';
  /** Empty-state message when no events come back. */
  emptyMessage: string;
  /**
   * When set, cap the feed at this number of fully-visible posts:
   *  - posts 0..capAtIndex-1 render normally
   *  - post at index `capAtIndex` shows only a KID_FEED_PEEK_PX peek (the next locked post)
   *  - posts past that are hidden entirely
   * This is how the "Next post" FAB limits the kid's scroll distance —
   * the page itself becomes shorter, so the browser can't scroll past the
   * end. No scroll-clamping fight, no flicker.
   */
  capAtIndex?: number;
  /**
   * Optional array ref populated with each rendered post's wrapper
   * element, keyed by feed index. Used by `NextPostFAB` to resolve the
   * scroll target for the newly-unlocked post without DOM string queries.
   */
  postRefs?: MutableRefObject<(HTMLElement | null)[]>;
  /**
   * Fired exactly once, the first time the feed's initial page settles
   * (whether or not it has any items). Lets `KidHomePage` hold the boot
   * loading screen until the feed is actually populated, so the kid sees
   * one continuous load instead of a sync spinner followed by a feed
   * skeleton. Re-arms if the component remounts (e.g. a kid swap).
   */
  onFirstLoadSettled?: () => void;
  /**
   * Called with the current (deduped, filtered) feed items whenever they
   * change. Lets `KidHomePage` prefetch the first few video thumbnails to hold
   * the boot splash until they're ready, without re-running the feed query.
   */
  onFeedItems?: (items: FeedItem[]) => void;
}

export function KidFeedList({ variant, emptyMessage, capAtIndex, postRefs, onFirstLoadSettled, onFeedItems }: KidFeedListProps) {
  const { user } = useCurrentUser();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isLoading,
    teppHold,
  } = useKidFeed();
  const { muteItems } = useMuteList();

  // View-only mode: read from the active kid's settings. Applies to both
  // variants — on /kid the signer *is* the kid, and on /parent/feed the
  // parent has swapped the signer to the selected kid via useSelectedKid,
  // so logins[0].pubkey resolves to the same kid in both cases.
  const isViewOnly = !!user?.pubkey
    && getKidSettings(user.pubkey).viewOnly === true;

  // First pass: dedupe + Ditto mute/hide. This is the candidate set fed to the
  // render-side TEPP filter (KUBO-159) so it can pre-fetch each item's
  // reference closure before deciding visibility.
  const candidateItems = useMemo<FeedItem[]>(() => {
    if (!data?.pages) return [];
    const seen = new Set<string>();
    const out: FeedItem[] = [];
    for (const page of data.pages) {
      for (const item of page.items) {
        const key = item.repostedBy
          ? `repost-${item.repostedBy}-${item.event.id}`
          : item.event.id;
        if (seen.has(key)) continue;
        seen.add(key);
        if (shouldHideFeedEvent(item.event)) continue;
        if (muteItems.length > 0 && isEventMuted(item.event, muteItems)) continue;
        out.push(item);
      }
    }
    return out;
  }, [data?.pages, muteItems]);

  // KUBO-159: render-side TEPP filter as defense-in-depth. The query-time
  // author allowlist (useKidFeed) can't express event-list/relay-list
  // permissions (allowedAuthors.ts:29-32); the per-event evaluator can. Pass
  // the candidate events so the filter pre-fetches their reference closure; it
  // fails open while that closure resolves and hides only on a concrete deny.
  // No-op when TEPP isn't enforced for this kid (parent surfaces unchanged).
  const candidateEvents = useMemo(
    () => candidateItems.map((i) => i.event),
    [candidateItems],
  );
  const teppFilter = useKuboTeppFeedFilter(candidateEvents);
  const feedItems = useMemo<FeedItem[]>(() => {
    if (!teppFilter.enabled) return candidateItems;
    return candidateItems.filter((item) => teppFilter.shouldShow(item.event));
  }, [candidateItems, teppFilter]);

  // Surface the current feed items so KidHomePage can prefetch the first few
  // video thumbnails (boot-splash gate) without re-running the feed query.
  useEffect(() => {
    onFeedItems?.(feedItems);
  }, [feedItems, onFeedItems]);

  const { scrollRef } = useInfiniteScroll({
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    pageCount: data?.pages.length,
  });

  // In tap-to-advance mode the IntersectionObserver sentinel is unmounted
  // (no more infinite scroll), so page-fetching is driven by the cap itself:
  // prefetch when the kid is within 3 posts of the edge of loaded data.
  // The FAB advances by 2 posts per tap, so a step-1 buffer would let the
  // cap leap past the trigger; widening to 3 keeps a one-tap-ahead buffer.
  useEffect(() => {
    if (typeof capAtIndex !== 'number') return;
    if (!hasNextPage || isFetchingNextPage) return;
    if (capAtIndex >= feedItems.length - 3) {
      fetchNextPage();
    }
  }, [capAtIndex, feedItems.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // KUBO-155: when the feed is HELD (TEPP enforced but no construct), the
  // underlying query is disabled — so `isPending` stays true forever. The hold
  // notice must take precedence over the skeleton, and the boot splash must
  // dismiss, so treat a hold as "settled" (not a skeleton).
  const showSkeleton = !teppHold && (isPending || (isLoading && !data));

  // Signal the first settle of the initial page exactly once. Guarded by a
  // ref so background refetches (which can briefly re-raise the loading
  // flags) never re-fire it. See `onFirstLoadSettled` prop docs. A hold also
  // counts as settled so KidHomePage's boot splash dismisses to the notice.
  const settledFired = useRef(false);
  useEffect(() => {
    if (settledFired.current) return;
    if (!showSkeleton) {
      settledFired.current = true;
      onFirstLoadSettled?.();
    }
  }, [showSkeleton, onFirstLoadSettled]);

  // Wrapper classes for the per-card chrome. NoteCard stays stock Ditto;
  // we only control the outer surround so the kid view can use its
  // translucent-white-on-deep-blue aesthetic. The kid tile's rounding comes
  // from KID_TILE_ROUNDING (shared with NoteCard's full-bleed video player so
  // their corners stay in lockstep).
  const cardWrapperClass =
    variant === 'kid'
      ? cn(KID_TILE_ROUNDING, 'overflow-hidden bg-white/10')
      : 'rounded-2xl overflow-hidden bg-card';

  // KUBO-155: fail-closed hold — never the firehose. Show a kid-friendly
  // notice (empty feed) when TEPP is enforced but the construct is unavailable.
  if (teppHold) {
    const noticeText =
      teppHold === 'parent-logged-out'
        ? 'Ask your grown-up to log in so you can see your feed.'
        : 'Hold on — still checking with your grown-up. Your feed will be back in a moment.';
    return (
      <div
        className={cn(
          'rounded-2xl p-8 text-center text-sm',
          variant === 'kid'
            ? 'bg-white/10 text-white/80'
            : 'bg-card text-muted-foreground',
        )}
        data-kubo-tepp-hold={teppHold}
      >
        {noticeText}
      </div>
    );
  }

  if (showSkeleton) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={cardWrapperClass}>
            <Skeleton className="aspect-video w-full" />
            <div className="p-3 flex gap-2.5">
              <Skeleton className="size-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (feedItems.length === 0) {
    return (
      <div
        className={cn(
          'rounded-2xl p-8 text-center text-sm',
          variant === 'kid'
            ? 'bg-white/10 text-white/70'
            : 'bg-card text-muted-foreground',
        )}
      >
        {emptyMessage}
      </div>
    );
  }

  const isCapped = capAtIndex !== undefined;

  return (
    <div className="flex flex-col gap-3">
      {feedItems.map((item, idx) => {
        // When the "Next post" FAB is on, only posts 0..capAtIndex-1 render
        // at full height. The post at capAtIndex shows a KID_FEED_PEEK_PX
        // peek so the scroll-cap lands with the next locked post's top just
        // visible. Anything beyond is cut entirely — shrinking the document
        // so the browser's own end-of-page is the scroll wall (no
        // listener-based clamping, no flicker).
        let capStyle: React.CSSProperties | undefined;
        let ariaHidden: true | undefined;
        if (capAtIndex !== undefined) {
          if (idx > capAtIndex) {
            capStyle = { display: 'none' };
            ariaHidden = true;
          } else if (idx === capAtIndex) {
            capStyle = {
              maxHeight: KID_FEED_PEEK_PX,
              overflow: 'hidden',
              pointerEvents: 'none',
            };
            ariaHidden = true;
          }
        }
        return (
          <div
            key={
              item.repostedBy
                ? `repost-${item.repostedBy}-${item.event.id}`
                : item.event.id
            }
            ref={(el) => {
              if (postRefs) postRefs.current[idx] = el;
            }}
            data-kid-feed-item={idx}
            data-kubo-hide-video-desc
            className={cardWrapperClass}
            style={capStyle}
            aria-hidden={ariaHidden}
          >
            {variant === 'kid' ? (
              <KidNavigationInterceptor
                pubkey={item.event.pubkey}
                eventId={item.event.id}
                viewOnly={isViewOnly}
              >
                <NoteCard event={item.event} repostedBy={item.repostedBy} viewOnly={isViewOnly} className="border-b-0" />
              </KidNavigationInterceptor>
            ) : (
              <ParentNavigationInterceptor pubkey={item.event.pubkey} eventId={item.event.id}>
                <NoteCard event={item.event} repostedBy={item.repostedBy} viewOnly={isViewOnly} className="border-b-0" />
              </ParentNavigationInterceptor>
            )}
          </div>
        );
      })}
      {/* Infinite-scroll sentinel. Hidden when capped — in tap-to-advance
          mode pagination is driven explicitly by the FAB, not by scroll. */}
      {!isCapped && <div ref={scrollRef} className="h-1" aria-hidden />}
      {isFetchingNextPage && !isCapped && (
        <div
          className={cn(
            'text-center text-xs py-2',
            variant === 'kid' ? 'text-white/50' : 'text-muted-foreground',
          )}
        >
          Loading more…
        </div>
      )}
    </div>
  );
}
