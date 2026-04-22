import { useMemo } from 'react';

import { NoteCard } from '@/components/NoteCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useKidFeed } from '@/hooks/useKidFeed';
import { getKidSettings } from '@/hooks/useKuboFamily';
import { useMuteList } from '@/hooks/useMuteList';
import { shouldHideFeedEvent } from '@/lib/feedUtils';
import { isEventMuted } from '@/lib/muteHelpers';
import { cn } from '@/lib/utils';
import type { FeedItem } from '@/lib/feedUtils';

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
}

export function KidFeedList({ variant, emptyMessage }: KidFeedListProps) {
  const { user } = useCurrentUser();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isLoading,
  } = useKidFeed();
  const { muteItems } = useMuteList();

  // View-only mode: read from the active kid's settings. Applies to both
  // variants — on /kid the signer *is* the kid, and on /parent/feed the
  // parent has swapped the signer to the selected kid via useSelectedKid,
  // so logins[0].pubkey resolves to the same kid in both cases.
  const isViewOnly = !!user?.pubkey
    && getKidSettings(user.pubkey).viewOnly === true;

  const feedItems = useMemo<FeedItem[]>(() => {
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

  const { scrollRef } = useInfiniteScroll({
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    pageCount: data?.pages.length,
  });

  const showSkeleton = isPending || (isLoading && !data);

  // Wrapper classes for the per-card chrome. NoteCard stays stock Ditto;
  // we only control the outer surround so the kid view can use its
  // translucent-white-on-deep-blue aesthetic.
  const cardWrapperClass =
    variant === 'kid'
      ? 'rounded-2xl overflow-hidden bg-white/10'
      : 'rounded-2xl overflow-hidden bg-card';

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

  return (
    <div className="flex flex-col gap-3">
      {feedItems.map((item) => (
        <div
          key={
            item.repostedBy
              ? `repost-${item.repostedBy}-${item.event.id}`
              : item.event.id
          }
          className={cardWrapperClass}
        >
          <NoteCard event={item.event} repostedBy={item.repostedBy} viewOnly={isViewOnly} compact={isViewOnly} />
        </div>
      ))}
      {/* Infinite-scroll sentinel */}
      <div ref={scrollRef} className="h-1" aria-hidden />
      {isFetchingNextPage && (
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
