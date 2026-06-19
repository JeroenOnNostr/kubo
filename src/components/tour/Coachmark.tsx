import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { Button } from '@/components/ui/button';
import { useTourAnchor } from '@/contexts/TourAnchorContext';
import { usePortalContainer } from '@/hooks/usePortalContainer';
import { cn } from '@/lib/utils';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';

export interface CoachmarkProps {
  /**
   * Name registered via useRegisterTourAnchor in some other component.
   * Pass `null` to render a centered floating card (no anchor, no arrow) —
   * used by step 1, which is a statement about the whole screen rather than
   * about a specific element.
   */
  anchorName: string | null;
  /** Title rendered as the popover heading. */
  title: string;
  /** Body text or rich content. Plain text gets a default `<p>`. */
  body: ReactNode;
  /**
   * Label of the primary advance CTA. Omit (`undefined`) to render no Next
   * button — used by step 2 where the parent must physically tap the gear.
   */
  nextLabel?: string;
  /** Called when the parent taps the Next/Done CTA. */
  onNext?: () => void;
  /** Called when the parent taps Skip tour. */
  onSkip: () => void;
  /** Popover side relative to the anchor. Default: 'bottom'. Ignored when anchorName is null. */
  side?: Side;
  /** Popover alignment along the anchor edge. Default: 'center'. Ignored when anchorName is null. */
  align?: Align;
  /** Optional className passthrough to the popover content / centered card. */
  className?: string;
}

// Tour-specific surface: white card, dark slate text, soft shadow, no ring.
// Stronger contrast than the default popover against both the deep-blue kid
// view and the dark parent dashboard.
//
// Visual chrome ONLY — no width, no height, no overflow. Width + max-height
// are mode-specific (anchored and centered have different vertical budgets)
// and are applied by each mode below. `flex flex-col` makes the card the flex
// container so CoachmarkCardBody can give itself a scrolling body and a pinned
// Skip/Next footer that never scrolls off the bottom (the Galaxy S20 cutoff).
const TOUR_SURFACE =
  'flex flex-col rounded-xl border-0 bg-white text-slate-900 p-4 shadow-[0_8px_24px_rgba(0,0,0,0.25)] outline-none focus-visible:outline-none focus-visible:ring-0';

// Single source of truth for the card width across both modes. Caps at 20rem
// (320px) on normal screens but never exceeds the viewport minus ~40px of
// margin, so it can't run off the edges of a 360px phone. NOTE: this is the
// only place width is set — do NOT add a per-step `w-*` override (tailwind-merge
// would clobber this and re-break narrow screens).
const TOUR_WIDTH = 'w-[min(20rem,calc(100vw-2.5rem))]';

// Anchored max-height: the dynamic viewport minus the top bar, bottom nav, and
// both safe-area insets, plus a little breathing room. Uses dvh (like the rest
// of the app) so the mobile URL/system bars are accounted for. The body scrolls
// inside this cap; collisionPadding keeps Radix from parking the card under the
// chrome in the first place.
const TOUR_ANCHORED_MAX_H =
  'max-h-[calc(100dvh-var(--top-bar-height)-var(--bottom-nav-height)-var(--safe-area-inset-top,env(safe-area-inset-top,0px))-var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))-1.5rem)]';

// Centered (step 1) max-height: subtracts the overlay's own 15dvh top pad and
// the bottom nav + inset so the card + its paddings always fit the viewport.
const TOUR_CENTERED_MAX_H =
  'max-h-[calc(100dvh-15dvh-var(--bottom-nav-height)-var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))-2rem)]';

/**
 * One step of the first-run parent tour.
 *
 * Two render modes:
 *   - **Anchored (default)**: a Radix popover attached to a named DOM element
 *     registered via TourAnchorContext. Used by steps 2-5.
 *   - **Centered (anchorName === null)**: a non-modal floating card centered
 *     on the viewport with no backdrop. The page underneath stays fully
 *     visible and interactive everywhere except over the card itself. Used
 *     by step 1.
 *
 * Both modes share the same inner chrome: title, body, Skip on the left,
 * optional Next/Done on the right.
 */
export function Coachmark({
  anchorName,
  title,
  body,
  nextLabel,
  onNext,
  onSkip,
  side = 'bottom',
  align = 'center',
  className,
}: CoachmarkProps) {
  if (anchorName === null) {
    return (
      <CenteredCoachmark
        title={title}
        body={body}
        nextLabel={nextLabel}
        onNext={onNext}
        onSkip={onSkip}
        className={className}
      />
    );
  }

  return (
    <AnchoredCoachmark
      anchorName={anchorName}
      title={title}
      body={body}
      nextLabel={nextLabel}
      onNext={onNext}
      onSkip={onSkip}
      side={side}
      align={align}
      className={className}
    />
  );
}

interface AnchoredCoachmarkProps extends Omit<CoachmarkProps, 'anchorName' | 'side' | 'align'> {
  anchorName: string;
  side: Side;
  align: Align;
}

function AnchoredCoachmark({
  anchorName,
  title,
  body,
  nextLabel,
  onNext,
  onSkip,
  side,
  align,
  className,
}: AnchoredCoachmarkProps) {
  const portalContainer = usePortalContainer();
  const anchorRef = useTourAnchor(anchorName);
  // Re-check anchor.current after the registry changes. Refs don't notify on
  // .current assignment, so we tick a microtask after the registry update to
  // catch the post-render assignment from ref-callbacks.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    Promise.resolve().then(() => setTick((t) => t + 1));
  }, [anchorRef]);
  void tick;

  if (!anchorRef?.current) return null;

  return (
    <PopoverPrimitive.Root open>
      <PopoverPrimitive.Anchor virtualRef={anchorRef as React.RefObject<HTMLElement>} />
      <PopoverPrimitive.Portal container={portalContainer}>
        <PopoverPrimitive.Content
          side={side}
          align={align}
          sideOffset={12}
          // Asymmetric keep-out so Radix never parks the card over the top bar
          // or under the bottom nav (where Skip/Next would be hidden). Static px
          // over-estimates — Radix rejects calc(); the precise fit comes from the
          // dvh max-height. top ≈ 40px top bar + breathing; bottom ≈ 44px nav +
          // gesture inset + breathing.
          collisionPadding={{ top: 56, bottom: 76, left: 16, right: 16 }}
          className={cn(
            'z-[260]',
            TOUR_SURFACE,
            TOUR_WIDTH,
            TOUR_ANCHORED_MAX_H,
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            className,
          )}
          // Non-modal: don't trap focus, don't block outside interaction. The
          // parent must be able to tap the anchor element behind the popover
          // (especially step 2 — the gear).
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <CoachmarkCardBody
            title={title}
            body={body}
            nextLabel={nextLabel}
            onNext={onNext}
            onSkip={onSkip}
          />
          <PopoverPrimitive.Arrow
            className="fill-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.15)]"
            width={14}
            height={8}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function CenteredCoachmark({
  title,
  body,
  nextLabel,
  onNext,
  onSkip,
  className,
}: Omit<CoachmarkProps, 'anchorName' | 'side' | 'align'>) {
  return (
    // Full-viewport overlay that doesn't intercept pointer events anywhere
    // except inside the card itself, so the kid view behind stays
    // interactive (and visible — no backdrop dim).
    //
    // Card sits ~15dvh from the top (rather than mathematically centered) so
    // the sticky top bar doesn't push the perceived center too low. Lands
    // where the eye expects an "intro" element on a phone-sized viewport. The
    // bottom pad clears the nav + safe area so the card never overlaps it; the
    // dvh max-height on the card itself guarantees it fits between the two pads.
    <div
      className="fixed inset-x-0 top-0 bottom-0 z-[260] flex justify-center items-start pt-[max(15dvh,calc(var(--top-bar-height)+var(--safe-area-inset-top,env(safe-area-inset-top,0px))+1rem))] pb-[calc(var(--bottom-nav-height)+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))+1rem)] pointer-events-none"
      aria-live="polite"
    >
      <div className={cn('pointer-events-auto', TOUR_WIDTH, TOUR_CENTERED_MAX_H, TOUR_SURFACE, className)}>
        <CoachmarkCardBody
          title={title}
          body={body}
          nextLabel={nextLabel}
          onNext={onNext}
          onSkip={onSkip}
        />
      </div>
    </div>
  );
}

function CoachmarkCardBody({
  title,
  body,
  nextLabel,
  onNext,
  onSkip,
}: Pick<CoachmarkProps, 'title' | 'body' | 'nextLabel' | 'onNext' | 'onSkip'>) {
  // The card surface (TOUR_SURFACE) is the flex column + height cap, so these
  // three are direct flex children of it:
  //   - title: fixed
  //   - body:  the ONLY scroller. `min-h-0` is mandatory — without it the flex
  //            child refuses to shrink below its content height and the card
  //            overflows the cap regardless.
  //   - footer: fixed, so Skip/Next stay visible even on tall bodies (the
  //            Galaxy S20 cutoff was the footer scrolling off the card).
  return (
    <>
      <h3 className="shrink-0 text-sm font-semibold">{title}</h3>
      <div className="flex-1 min-h-0 overflow-y-auto text-[13px] leading-snug text-slate-600 mt-3">
        {typeof body === 'string' ? <p>{body}</p> : body}
      </div>
      <div className="shrink-0 flex items-center justify-between gap-2 pt-3 mt-1 border-t border-slate-100">
        <button
          type="button"
          onClick={onSkip}
          className="text-[12px] text-slate-500 underline-offset-2 hover:underline"
        >
          Skip tour
        </button>
        {nextLabel && onNext && (
          <Button
            type="button"
            size="sm"
            onClick={onNext}
            className="rounded-full"
          >
            {nextLabel}
          </Button>
        )}
      </div>
    </>
  );
}
