import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Lock } from 'lucide-react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useScreenTime } from '@/hooks/useScreenTime';
import { start, stopTracker } from '@/lib/screenTimeTracker';
import { getTourStep, setPinFlowActive, setTourStep } from '@/lib/tourState';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { KuboKidErrorFallback } from '@/components/KuboErrorFallbacks';
import {
  KuboKidTopBar,
  KuboKidScrollAwareTopBar,
} from '@/components/KuboKidTopBar';
import { ParentGateDialog } from '@/components/kid/ParentGateDialog';
import { ParentTour } from '@/components/tour/ParentTour';
import { TourAnchorProvider } from '@/components/tour/TourAnchorProvider';
import {
  KuboKidLayoutContext,
  type KuboKidLayoutOptions,
} from '@/contexts/KuboKidLayoutContext';
import { useKidBackGuard } from '@/hooks/useKidBackGuard';

/**
 * Layout shell for all /kid/* routes.
 *
 * Distinct from KuboParentLayout:
 * - Deep-blue (#1E3A8A) full-bleed background signals "this is the kid app"
 * - No bottom nav here — each kid page renders its own bar
 *   (Home/Favorites/optionally Blobbi) because the locked /
 *   fullscreen-player states are chromeless
 * - Text is white, safe-area handled at the page level
 *
 * Starts the screen time tracker when the kid enters /kid routes and stops it
 * when they leave. Usage is keyed to the kid's pubkey.
 *
 * The lock screen lives here (not on individual pages) so /kid, /kid/blobbi,
 * and /kid/favorites all show the same "see you tomorrow" fallback when the
 * daily limit is hit or the allowed window is closed — nothing past the
 * layout renders while `isLocked`.
 *
 * Provides a tiny KuboKidLayoutContext so pages can opt into a scroll-aware
 * top bar via useKidLayoutOptions({ scrollAware: true }) — Home and
 * Favorites do; Blobbi (which doesn't window-scroll) leaves it pinned.
 */
export function KuboKidLayout() {
  const { user } = useCurrentUser();
  const { family } = useKuboFamily();
  const { isLocked, isOutsideWindow, settings } = useScreenTime();
  const [gateOpen, setGateOpen] = useState(false);

  // First-run tour trigger (KUBO-092). Fires once when this layout mounts
  // with a family record that has at least one kid but no completion flag —
  // i.e. the parent has just finished AddKidPage and landed on /kid for the
  // first time. The flag in the family record is the "never show again" gate;
  // once written, subsequent visits to /kid (including kid-handoff sessions
  // initiated from the kid-selector pill) won't re-trigger.
  useEffect(() => {
    if (!family) return;
    if (family.coachmarksCompletedAt) return;
    if (family.kids.length === 0) return;
    if (getTourStep() !== 0) return;
    setTourStep(1);
  }, [family]);

  const [options, setOptions] = useState<KuboKidLayoutOptions>({});
  // Stable identity so useEffect in useKidLayoutOptions doesn't loop.
  const setOptionsStable = useCallback(
    (next: KuboKidLayoutOptions) => setOptions(next),
    [],
  );
  const ctxValue = useMemo(
    () => ({ setOptions: setOptionsStable }),
    [setOptionsStable],
  );

  useEffect(() => {
    if (user?.pubkey) {
      start(user.pubkey);
    }
    return () => {
      stopTracker();
    };
  }, [user?.pubkey]);

  // Android hardware back / gesture: route in-tree back to React Router and
  // surface ParentGateDialog at the kid-mode boundary so a swipe can never
  // pop into /parent/* without the PIN. The back-gesture path also bumps
  // the tour's pinFlowActive flag so step 2's popover hides if the tour is
  // mid-flow when the swipe happens.
  useKidBackGuard({
    onRequestExit: () => {
      setPinFlowActive(true);
      setGateOpen(true);
    },
  });

  return (
    <div
      className="min-h-dvh text-white safe-area-top"
      style={{
        background: '#1E3A8A',
        // Single source of truth for the top bar height — KuboKidTopBar
        // reads this, and the kubo-kid-blobbi.css skin maps it onto
        // Ditto's --top-bar-height so BlobbiPage internals align below.
        ['--kubo-kid-top-bar-height' as string]: '3rem',
      }}
    >
      {/*
        Mounted at layout level so the back-gesture guard can open it from
        any /kid/* route (unlocked feed and locked screen alike). The
        gear-button inside KuboKidTopBar still uses its own local copy for
        the unlocked path; both eventually converge on the same dialog.
      */}
      <ParentGateDialog
        open={gateOpen}
        onOpenChange={(o) => {
          setGateOpen(o);
          // Mirror the gear button's wiring in KuboKidTopBar — clear the
          // tour's pinFlowActive flag whenever this dialog closes so step 2's
          // popover can re-anchor on the gear if the parent backed out
          // without setting a PIN.
          if (!o) setPinFlowActive(false);
        }}
      />
      {isLocked ? (
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
          <button
            type="button"
            onClick={() => {
              setPinFlowActive(true);
              setGateOpen(true);
            }}
            className="mt-4 h-10 px-6 rounded-full text-[12px] text-white/60 border border-white/20 active:scale-95 transition-transform"
          >
            I'm a parent
          </button>
        </div>
      ) : (
        /*
          Kid-themed fallback — a crash here must NOT show Ditto's onboarding-
          beige error screen (the shared ErrorBoundary default uses the global
          palette, which in this layout would clash badly with #1E3A8A). We
          pass a Kubo-themed fallback rather than editing the shared boundary,
          so upstream Ditto merges stay conflict-free.
        */
        <ErrorBoundary fallback={<KuboKidErrorFallback />}>
          <TourAnchorProvider>
            <KuboKidLayoutContext.Provider value={ctxValue}>
              {options.scrollAware ? (
                <KuboKidScrollAwareTopBar />
              ) : (
                <KuboKidTopBar />
              )}
              <Outlet />
              <ParentTour />
            </KuboKidLayoutContext.Provider>
          </TourAnchorProvider>
        </ErrorBoundary>
      )}
    </div>
  );
}
