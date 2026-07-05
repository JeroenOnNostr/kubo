import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Settings, Play, Inbox, Star } from 'lucide-react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getKidSettings, useKuboFamily } from '@/hooks/useKuboFamily';
import { useKidFavorites } from '@/hooks/useKidFavorites';
import { useKuboTeppFeedFilter } from '@/hooks/useKuboTeppFeedFilter';
import { useKidLayoutOptions } from '@/contexts/KuboKidLayoutContext';
import { KuboKidBottomNav } from '@/components/KuboKidBottomNav';
import { ParentGateDialog } from '@/components/kid/ParentGateDialog';
import { NextPostFAB } from '@/components/kid/NextPostFAB';
import { KidFeedList } from '@/components/feed/KidFeedList';
import { useKidFeedColumns } from '@/hooks/useKidFeedColumns';
import { cn } from '@/lib/utils';
import { KidNavigationInterceptor } from '@/components/feed/KidNavigationInterceptor';
import { KuboLoadingScreen } from '@/components/KuboLoadingScreen';
import { NoteCard } from '@/components/NoteCard';
import { Skeleton } from '@/components/ui/skeleton';
import { dismissPreloader } from '@/lib/preloader';
import { usePrefetchKidThumbnails } from '@/hooks/usePrefetchKidThumbnails';
import type { FeedItem } from '@/lib/feedUtils';

/**
 * /kid — the kid app entry point.
 *
 * Five states, selected via ?state= query param so stakeholders can
 * preview each without data (?state=loaded|locked|playing|inbox). The
 * request-to-watch modal is an overlay on the loaded state, toggled by
 * tapping "ask" on the big card.
 *
 * Loaded (default):
 *   - "Hi <name>!" + time-remaining pill + parent-gate gear
 *   - Scrollable feed of Nostr events from the kid's follow list, kinds
 *     driven by Ditto's feedSettings (see `useKidFeed` → `useFeed`).
 *     Each event renders via `NoteCard`, so videos play inline in their
 *     tile (no navigation) while other kinds follow Ditto's default tap
 *     behavior. View-only mode (KUBO-031), when enabled in kid settings,
 *     suppresses card-click navigation via the `viewOnly` prop on NoteCard.
 *   - 2-tab bottom bar
 *
 * Playing: fullscreen player placeholder, no chrome, single "Done" pill.
 *
 * Locked: padlock, "See you tomorrow!", no nav.
 *
 * Inbox (shared-from-group): scrollable list of items teachers / family
 * shared into groups the kid belongs to.
 *
 * The parent-gate gear opens ParentGateDialog; entering any 6-digit code
 * routes to /parent/home.
 */
type KidState = 'loaded' | 'locked' | 'playing' | 'inbox';

export function KidHomePage() {
  const { pathname } = useLocation();
  const isFavorites = pathname === '/kid/favorites';

  // Home scrolls vertically through the feed; the shared top bar should
  // hide on scroll-down and reappear on scroll-up.
  useKidLayoutOptions({ scrollAware: true });

  const [params, setParams] = useSearchParams();
  const stateParam = params.get('state') as KidState | null;
  const state: KidState = stateParam && ['loaded','locked','playing','inbox'].includes(stateParam)
    ? stateParam
    : 'loaded';

  const [gateOpen, setGateOpen] = useState(false);

  const { user } = useCurrentUser();
  // Subscribe to the family store so this page re-renders when settings change
  // (signer swap, parent edits a toggle). The actual setting values are read
  // via getKidSettings() below, which applies DEFAULT_KID_SETTINGS — a
  // freshly-onboarded kid has NO kidSettings entry yet (addKid seeds
  // feedSources/trustAssignments only), so reading family.kidSettings[pubkey]
  // raw would yield undefined and silently drop the defaults (showBlobbiTab +
  // nextPostButton are default-ON). getKidSettings() is the single source of
  // truth every other consumer uses (KidFeedList, useScreenTime, …); KidHomePage
  // must not diverge from it (KUBO-189).
  useKuboFamily();
  const kidSettings = user ? getKidSettings(user.pubkey) : undefined;
  const showBlobbiTab = !!kidSettings?.showBlobbiTab;
  const nextPostButtonOn = !!kidSettings?.nextPostButton;

  // Tiles per row — 1 in the default single-column mode, 2–3 in tablet mode.
  const columns = useKidFeedColumns();

  // KUBO-063: scroll-cap for the "Next post" FAB. We track the running count in
  // TILES (not rows), then snap it to a whole number of rows for the current
  // column count — nearest full row, ties rounding down. Tracking tiles is what
  // preserves the visible count across rotation: 9 tiles in a 3-col landscape
  // become 8 (not 6) in a 2-col portrait — the MINIMUM change needed to keep
  // rows full — and it's reversible (rotate back → 9). `capIndex` is the count
  // of unlocked posts / the index of the next locked one, passed to KidFeedList
  // as `capAtIndex`. The tile count starts at 2 and is grown to fill the
  // viewport by the layout effect below; each tap unlocks one more row, built on
  // the DISPLAYED `capIndex` (not the raw total) so it stays reversible across
  // rotations — a tap after a rotate doesn't inherit that rotate's rounding slack.
  const [unlockedTiles, setUnlockedTiles] = useState(2);
  const capIndex = Math.max(1, Math.ceil(unlockedTiles / columns - 0.5)) * columns;
  // Re-armed per kid so the viewport-fill measurement runs once per feed load.
  const filledRef = useRef(false);

  // KUBO-140: the kid app holds a loading splash while the feed loads
  // underneath, dismissed once BOTH (a) the feed's first notes page has settled
  // AND (b) the first few visible video thumbnails are warmed — so the feed
  // reveals already painted, no thumbnail pop-in. KidFeedList surfaces the items
  // via onFeedItems; usePrefetchKidThumbnails warms them (and has its own
  // timeouts so a slow/missing thumbnail never hangs boot).
  //
  // KUBO-xxx: the splash is now the re-armable React <KuboLoadingScreen/>
  // overlay (rendered below), not just the one-shot static #preloader. Because
  // KidHomePage remounts fresh on every entry — cold boot, finishing
  // onboarding, and a parent swapping back into the kid feed — `feedSettled`
  // starts false and the overlay covers all three uniformly. The static
  // #preloader stays only as the pre-React first paint; KuboLoadingScreen
  // dismisses it on mount.
  const [feedSettled, setFeedSettled] = useState(false);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const thumbsReady = usePrefetchKidThumbnails(feedItems, {
    n: 3,
    enabled: feedSettled,
  });

  // Safety override: force the splash down even if the gate never satisfies
  // (notes never arrive). Re-armed per kid in the pubkey-change effect below.
  const [forceHidden, setForceHidden] = useState(false);

  // The overlay is shown whenever the feed isn't ready yet — the exact inverse
  // of the condition that used to dismiss the static preloader.
  const showLoadingScreen = !forceHidden && !(feedSettled && thumbsReady);

  useEffect(() => {
    if (feedSettled && thumbsReady) dismissPreloader();
  }, [feedSettled, thumbsReady]);

  // Reset the scroll cap AND re-arm the splash gate whenever the active signer
  // changes (parent swaps kid via signer-swap, or a kid logs in). Without this
  // the next kid starts with the previous kid's progress unlocked and the
  // gate wouldn't re-arm for the new feed.
  //
  // The 10s safety timer is armed HERE (keyed on user?.pubkey) rather than on
  // mount, so a kid swap >10s into a session gets a fresh 10s budget instead of
  // an already-expired one. Never keep the splash up longer than the feed
  // query's own 10s timeout (AbortSignal.timeout(10_000) in useKidFeed); if
  // notes never arrive, force it down. (lib/preloader has an 11s backstop for
  // the static node; this is the tighter one for the React overlay, and the
  // prefetch hook caps at ~2.5s once notes do arrive.)
  useEffect(() => {
    setUnlockedTiles(2);
    filledRef.current = false;
    setFeedSettled(false);
    setFeedItems([]);
    setForceHidden(false);
    window.scrollTo(0, 0);

    const t = setTimeout(() => {
      setForceHidden(true);
      dismissPreloader();
    }, 10_000);
    return () => clearTimeout(t);
  }, [user?.pubkey]);
  const postRefs = useRef<(HTMLElement | null)[]>([]);
  const getPostElement = useCallback(
    (idx: number) => postRefs.current[idx] ?? null,
    [],
  );

  // Fill the first screen: once real tiles have painted, measure one and unlock
  // enough ROWS to cover the viewport — so the kid never lands on a half-empty
  // screen above the cap, on any device/size. Runs once per feed load (guarded),
  // at the top of the feed (the kid-change reset scrolls to 0), so the measured
  // rect isn't thrown off by scroll. Rotation keeps the row count (capIndex ×
  // columns stays full rows). No-op when the cap is off — infinite scroll fills
  // the screen on its own.
  useLayoutEffect(() => {
    if (!nextPostButtonOn || filledRef.current) return;
    const tile = postRefs.current[0];
    if (!tile) return;
    const rect = tile.getBoundingClientRect();
    const rowHeight = rect.height + 12; // + gap-3
    if (rowHeight <= 0) return;
    // From the first tile's top down to just above the fixed bottom nav (the
    // container reserves it with pb-24 = 96px).
    const available = window.innerHeight - rect.top - 96;
    const rowsToFill = Math.max(2, Math.round(available / rowHeight));
    filledRef.current = true;
    setUnlockedTiles((t) => Math.max(t, rowsToFill * columns));
  }, [nextPostButtonOn, feedSettled, feedItems.length, columns]);

  // Lock screen is handled at the layout level (KuboKidLayout) so it covers
  // every /kid/* route uniformly.

  if (isFavorites) {
    return <KidFavoritesView showBlobbiTab={showBlobbiTab} />;
  }

  if (state === 'playing') {
    return (
      <div className="min-h-dvh relative">
        {/* Fullscreen player placeholder */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#F97316,#EA580C)' }}
          aria-label="Video player (placeholder)"
        >
          <div className="size-20 rounded-full bg-white/90 flex items-center justify-center">
            <Play className="size-8 fill-[#0F172A] text-[#0F172A]" />
          </div>
        </div>
        {/* Exit */}
        <button
          type="button"
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set('state', 'loaded');
            setParams(next, { replace: true });
          }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 h-12 px-8 rounded-full bg-white text-[#0F172A] font-semibold active:scale-95 transition-transform"
        >
          Done
        </button>
      </div>
    );
  }

  if (state === 'inbox') {
    const items = [
      { id: '1', from: 'Ms Tanel',   group: 'Classroom 2B',   title: 'Our field-trip recap',     color: '#F97316' },
      { id: '2', from: 'Coach Dee',  group: 'Soccer team B3', title: 'Warm-up drills for Sunday', color: '#22C55E' },
      { id: '3', from: 'Aunt Mal',   group: 'Family',         title: 'Grandma says hi 👋',        color: '#6366F1' },
    ];
    return (
      <div className="min-h-dvh pb-24 flex flex-col gap-4 px-5 pt-4">
        <header className="flex items-center justify-between">
          <div>
            <div className="text-[22px] font-bold leading-none">Shared with you</div>
            <div className="text-[12px] text-white/60 mt-1">{items.length} new</div>
          </div>
          <button
            type="button"
            onClick={() => setGateOpen(true)}
            aria-label="Parent access"
            className="size-11 rounded-full flex items-center justify-center active:scale-95 transition-transform"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          >
            <Settings className="size-5" />
          </button>
        </header>

        <div className="flex flex-col gap-3">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              className="flex items-center gap-3 p-3 rounded-2xl text-left active:scale-[0.99] transition-transform"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              <div className="size-14 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: it.color }}>
                <Inbox className="size-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold truncate">{it.title}</div>
                <div className="text-[11px] text-white/60 truncate">
                  {it.from} · {it.group}
                </div>
              </div>
            </button>
          ))}
        </div>

        <ParentGateDialog open={gateOpen} onOpenChange={setGateOpen} />
        <KuboKidBottomNav showBlobbi={showBlobbiTab} />
      </div>
    );
  }

  // Loaded (default). The top bar (Hi {name}! + time + gear) is rendered
  // by KuboKidLayout — pt-2 is just enough breathing room below it.
  return (
    <div className="min-h-dvh pb-24 flex flex-col gap-3 px-5 pt-2">
      {/* Scrollable feed — Nostr events from the kid's follow list, kinds
          driven by feedSettings. Videos play inline via NoteCard + VideoPlayer.
          KidFeedList is mounted immediately so its query runs; the loading
          overlay below stays on top until onFirstLoadSettled fires and the
          first thumbnails warm, then it fades to reveal the already-painted
          feed. */}
      <div className="flex-1 w-full max-w-5xl mx-auto">
        <KidFeedList
          variant="kid"
          emptyMessage="Nothing here yet — ask a grown-up!"
          capAtIndex={nextPostButtonOn ? capIndex : undefined}
          postRefs={nextPostButtonOn ? postRefs : undefined}
          onFirstLoadSettled={() => setFeedSettled(true)}
          onFeedItems={setFeedItems}
        />
      </div>

      <KuboKidBottomNav showBlobbi={showBlobbiTab} />

      {nextPostButtonOn && (
        <NextPostFAB
          unlockedCount={capIndex}
          onAdvance={() => setUnlockedTiles(capIndex + columns)}
          getPostElement={getPostElement}
        />
      )}

      {/* Re-armable loading splash. Covers the feed (and top bar / bottom nav
          via z-index:9999) on cold boot, after finishing onboarding, and when a
          parent swaps back into a kid's feed — held until feedSettled &&
          thumbsReady. A TEPP hold counts as settled, so a held feed reveals its
          notice instead of hanging behind the splash. Only the loaded branch
          renders it; favorites/playing/inbox have their own states. */}
      {showLoadingScreen && <KuboLoadingScreen />}
    </div>
  );
}

/**
 * /kid/favorites — kid's saved-favorites tab.
 *
 * Reads the kid's NIP-51 kind-30003 list addressed by `d='favorites'`. Items
 * live NIP-44-encrypted in `content` (see useKidFavorites). Empty state is
 * preserved from the original placeholder. View-only mode follows the same
 * resolution as KidFeedList — getKidSettings(user.pubkey).viewOnly === true
 * suppresses card-click navigation on each NoteCard.
 */
function KidFavoritesView({
  showBlobbiTab,
}: {
  showBlobbiTab: boolean;
}) {
  // Favorites scrolls through saved posts — match Home's hide-on-scroll bar.
  useKidLayoutOptions({ scrollAware: true });

  const { user } = useCurrentUser();
  const { events: allEvents, isLoading, isLoadingEvents, favoritedIds } = useKidFavorites();
  const isViewOnly = !!user?.pubkey && getKidSettings(user.pubkey).viewOnly === true;

  // KUBO-163: re-check saved favorites against the kid's CURRENT construct. A
  // favorite saved while an author was trusted must disappear once the parent
  // revokes/blacklists that author. The render-side TEPP filter does the same
  // author/reference evaluation the feed uses; no-op for parents / non-enforced
  // kids, and fails open while the reference closure resolves.
  const teppFilter = useKuboTeppFeedFilter(allEvents);
  const events = useMemo(
    () => (teppFilter.enabled ? allEvents.filter((e) => teppFilter.shouldShow(e)) : allEvents),
    [allEvents, teppFilter],
  );

  // Three render states. The list-but-refetching case keeps showing cached
  // events instead of flashing skeletons over them, so we only show the
  // loader while there are no events to show.
  const viewState: 'loading' | 'list' | 'empty' =
    (isLoading || (favoritedIds.length > 0 && isLoadingEvents)) && events.length === 0 ? 'loading'
    : events.length > 0                                                                ? 'list'
    :                                                                                    'empty';

  // Match the home feed's responsive layout: grid in tablet mode, otherwise a
  // centered phone-width single column.
  const columns = useKidFeedColumns();
  const useGrid = columns > 1;
  const listClass = useGrid
    ? cn('grid gap-3 items-start w-full max-w-5xl mx-auto', columns === 3 ? 'grid-cols-3' : 'grid-cols-2')
    : 'flex flex-col gap-3 w-full max-w-md mx-auto';

  return (
    <div className="min-h-dvh pb-24 flex flex-col gap-4 px-5 pt-2">
      {viewState === 'loading' && (
        <div className={listClass}>
          {Array.from({ length: useGrid ? 6 : 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl p-3"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              <div className="flex gap-3">
                <Skeleton className="size-11 rounded-full shrink-0 bg-white/20" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32 bg-white/20" />
                  <Skeleton className="h-4 w-full bg-white/20" />
                  <Skeleton className="h-32 w-full rounded-xl bg-white/20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewState === 'list' && (
        <div className={listClass}>
          {events.map((event) => (
            <div
              key={event.id}
              className="rounded-2xl overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.1)' }}
              data-kubo-hide-video-desc
            >
              <KidNavigationInterceptor
                pubkey={event.pubkey}
                eventId={event.id}
                viewOnly={isViewOnly}
              >
                <NoteCard event={event} viewOnly={isViewOnly} className="border-b-0" />
              </KidNavigationInterceptor>
            </div>
          ))}
        </div>
      )}

      {viewState === 'empty' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 px-4">
          <div
            className="size-16 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          >
            <Star className="size-8 text-white" strokeWidth={2.5} />
          </div>
          <h2 className="text-[18px] font-bold">No favorites yet</h2>
          <p className="text-[13px] text-white/70 max-w-[260px] leading-relaxed">
            Tap the star on a video you love and it'll show up here.
          </p>
        </div>
      )}

      <KuboKidBottomNav showBlobbi={showBlobbiTab} />
    </div>
  );
}
