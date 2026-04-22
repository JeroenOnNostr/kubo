import { useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Clock, Settings, Play, Lock, Inbox, Star } from 'lucide-react';

import { getDisplayName } from '@/lib/getDisplayName';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useScreenTime } from '@/hooks/useScreenTime';
import { KuboKidBottomNav } from '@/components/KuboKidBottomNav';
import { ParentGateDialog } from '@/components/kid/ParentGateDialog';
import { KidRequestSheet } from '@/components/kid/KidRequestSheet';
import { KidFeedList } from '@/components/feed/KidFeedList';

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
 *   - "Ask a grown-up" footer pill
 *   - 2-tab bottom bar
 *
 * Request: same as loaded, but KidRequestSheet is open.
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

  const [params, setParams] = useSearchParams();
  const stateParam = params.get('state') as KidState | null;
  const state: KidState = stateParam && ['loaded','locked','playing','inbox'].includes(stateParam)
    ? stateParam
    : 'loaded';

  const [gateOpen, setGateOpen]       = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  const { user, metadata } = useCurrentUser();
  const kidName = user ? getDisplayName(metadata, user.pubkey) : '';
  const { remainingMinutes, isLocked, isOutsideWindow, settings } = useScreenTime();

  // Data-driven lock — overrides any ?state= param and favorites view.
  if (isLocked) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div
          className="size-16 rounded-2xl flex items-center justify-center"
          style={{ background: '#F97316' }}
        >
          <Lock className="size-8 text-white" strokeWidth={2.5} />
        </div>
        <h1 className="text-xl font-bold">
          {isOutsideWindow ? 'Not right now!' : 'See you tomorrow!'}
        </h1>
        <p className="text-[14px] text-white/70 max-w-[260px] leading-relaxed">
          {isOutsideWindow
            ? `Come back at ${settings?.windowStart ?? '4:00 pm'}.`
            : 'Your watch time is done for today.'}
        </p>
        <ParentGateDialog open={gateOpen} onOpenChange={setGateOpen} />
        <button
          type="button"
          onClick={() => setGateOpen(true)}
          className="mt-4 h-10 px-6 rounded-full text-[12px] text-white/60 border border-white/20 active:scale-95 transition-transform"
        >
          I'm a parent
        </button>
      </div>
    );
  }

  if (isFavorites) {
    return (
      <div className="min-h-dvh pb-24 flex flex-col gap-4 px-5 pt-4">
        <header className="flex items-center justify-between">
          <h1 className="text-[24px] font-bold leading-none">Favorites</h1>
          <button
            type="button"
            onClick={() => setGateOpen(true)}
            aria-label="Parent access"
            className="size-9 rounded-full flex items-center justify-center active:scale-95 transition-transform"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          >
            <Settings className="size-5" />
          </button>
        </header>

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

        <ParentGateDialog open={gateOpen} onOpenChange={setGateOpen} />
        <KuboKidBottomNav />
      </div>
    );
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
        <KuboKidBottomNav />
      </div>
    );
  }

  // Loaded (default)
  return (
    <div className="min-h-dvh pb-[calc(4.5rem+56px)] flex flex-col gap-3 px-5 pt-12">
      <header className="flex items-center justify-between">
        <h1 className="text-[24px] font-bold leading-none">Hi {kidName}!</h1>
        <div className="flex items-center gap-2">
          <div
            className="h-9 px-3 rounded-full flex items-center gap-1.5 text-[13px] font-semibold"
            style={{ background: 'rgba(255,255,255,0.2)' }}
          >
            <Clock className="size-4" />
            {remainingMinutes}
          </div>
          <button
            type="button"
            onClick={() => setGateOpen(true)}
            aria-label="Parent access"
            className="size-9 rounded-full flex items-center justify-center active:scale-95 transition-transform"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          >
            <Settings className="size-5" />
          </button>
        </div>
      </header>

      {/* Scrollable feed — Nostr events from the kid's follow list, kinds
          driven by feedSettings. Videos play inline via NoteCard + VideoPlayer. */}
      <div className="flex-1">
        <KidFeedList
          variant="kid"
          emptyMessage="Nothing here yet — ask a grown-up!"
        />
      </div>

      {/* Pinned footer — "Ask a grown-up" pill sits above the bottom nav */}
      <div
        className="fixed left-0 right-0 z-30 px-5"
        style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px) + 8px)' }}
      >
        <button
          type="button"
          onClick={() => setRequestOpen(true)}
          className="w-full h-11 rounded-full border border-white/20 bg-[#0C2463]/80 text-white/90 text-[12px] active:scale-[0.98] transition-transform backdrop-blur"
        >
          Something else? Ask a grown-up
        </button>
      </div>

      <ParentGateDialog open={gateOpen} onOpenChange={setGateOpen} />
      <KidRequestSheet open={requestOpen} onOpenChange={setRequestOpen} />

      <KuboKidBottomNav />
    </div>
  );
}
