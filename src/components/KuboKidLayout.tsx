import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Lock } from 'lucide-react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useScreenTime } from '@/hooks/useScreenTime';
import { start, stopTracker } from '@/lib/screenTimeTracker';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { KuboKidErrorFallback } from '@/components/KuboErrorFallbacks';
import { ParentGateDialog } from '@/components/kid/ParentGateDialog';

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
 */
export function KuboKidLayout() {
  const { user } = useCurrentUser();
  const { isLocked, isOutsideWindow, settings } = useScreenTime();
  const [gateOpen, setGateOpen] = useState(false);

  useEffect(() => {
    if (user?.pubkey) {
      start(user.pubkey);
    }
    return () => {
      stopTracker();
    };
  }, [user?.pubkey]);

  return (
    <div
      className="min-h-dvh text-white safe-area-top"
      style={{ background: '#1E3A8A' }}
    >
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
          <ParentGateDialog open={gateOpen} onOpenChange={setGateOpen} />
          <button
            type="button"
            onClick={() => setGateOpen(true)}
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
          <Outlet />
        </ErrorBoundary>
      )}
    </div>
  );
}
