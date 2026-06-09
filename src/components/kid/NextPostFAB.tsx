import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { selectionChanged } from '@/lib/haptics';
import { KID_FEED_PEEK_PX } from '@/components/feed/KidFeedList';

/**
 * Floating "Next post" button for the kid feed (KUBO-063).
 *
 * Sits above KuboKidBottomNav (bottom-nav is z-40 h-14 fixed). On tap,
 * advances the scroll-cap by one post and smooth-scrolls the feed so the
 * newly-unlocked post's top edge sits `KID_FEED_PEEK_PX` below the
 * viewport top.
 *
 * The hard-wall scroll-cap itself is implemented by clipping the feed list
 * (see `KidFeedList` + `capAtIndex`), which shortens the document so the
 * browser's end-of-page IS the cap — there's no scroll listener fighting
 * the user, so no flicker, no snap-back.
 *
 * Cooldown: after each tap the button disables itself for `COOLDOWN_MS`.
 * An SVG ring animates the remaining time around the FAB. This is the
 * anti-doomscroll brake — the whole feature is pointless if a kid can
 * just hammer the button as fast as they could've swiped.
 */
interface NextPostFABProps {
  onAdvance: () => void;
  /** Current cap index (= index of the next locked post, also the count of unlocked posts). */
  unlockedCount: number;
  /** Resolve the DOM element for a given feed index. Returns null if not rendered yet. */
  getPostElement: (idx: number) => HTMLElement | null;
}

const COOLDOWN_MS = 2000;

export function NextPostFAB({
  onAdvance,
  unlockedCount,
  getPostElement,
}: NextPostFABProps) {
  // When non-null, a cooldown is active and the button is disabled. The
  // value is the wall-clock timestamp when the cooldown started, used to
  // drive the progress-ring animation via a CSS keyframe.
  const [cooldownStartedAt, setCooldownStartedAt] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (cooldownStartedAt === null) return;
    const t = window.setTimeout(() => {
      setCooldownStartedAt(null);
    }, COOLDOWN_MS);
    return () => window.clearTimeout(t);
  }, [cooldownStartedAt]);

  const isCoolingDown = cooldownStartedAt !== null;

  const handleTap = () => {
    if (isCoolingDown) return;
    selectionChanged();
    onAdvance();
    setCooldownStartedAt(Date.now());
    // Double-rAF: wait for React to commit the new cap (which paints the
    // newly-unlocked posts at full height) before measuring position.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // KidHomePage advances by 2 posts per tap; we land on the SECOND
        // newly-unlocked post (idx = pre-advance unlockedCount + 1) so the
        // first one sits just above the viewport, ready to scroll back to.
        const el = getPostElement(unlockedCount + 1);
        if (!el) return;
        const target =
          el.getBoundingClientRect().top + window.scrollY - KID_FEED_PEEK_PX;
        window.scrollTo({ top: target, behavior: 'smooth' });
      });
    });
  };

  return (
    <button
      type="button"
      onClick={handleTap}
      disabled={isCoolingDown}
      aria-label="Next post"
      aria-busy={isCoolingDown}
      className="fixed right-4 z-50 size-14 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform disabled:active:scale-100"
      style={{
        bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
        background: '#F97316',
        opacity: isCoolingDown ? 0.6 : 1,
      }}
    >
      {/* Cooldown ring: stroke-dasharray animates from full circumference
          down to 0 over COOLDOWN_MS. Only rendered while cooling down so
          the idle state has no SVG overhead. */}
      {isCoolingDown && (
        <svg
          className="absolute inset-0 size-full -rotate-90 pointer-events-none"
          viewBox="0 0 56 56"
          aria-hidden
        >
          <circle
            cx="28"
            cy="28"
            r="26"
            fill="none"
            stroke="rgba(255,255,255,0.9)"
            strokeWidth="3"
            strokeLinecap="round"
            style={{
              strokeDasharray: 2 * Math.PI * 26,
              animation: `kubo-next-post-cooldown ${COOLDOWN_MS}ms linear forwards`,
            }}
          />
        </svg>
      )}
      <ChevronDown className="size-7 text-white" strokeWidth={2.5} />
    </button>
  );
}
