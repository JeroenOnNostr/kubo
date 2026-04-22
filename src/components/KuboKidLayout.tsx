import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { start, stopTracker } from '@/lib/screenTimeTracker';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { KuboKidErrorFallback } from '@/components/KuboErrorFallbacks';

/**
 * Layout shell for all /kid/* routes.
 *
 * Distinct from KuboParentLayout:
 * - Deep-blue (#1E3A8A) full-bleed background signals "this is the kid app"
 * - No bottom nav here — KidHomePage renders its own 2-tab bar (Home · Favorites)
 *   because the locked / fullscreen-player states are chromeless
 * - Text is white, safe-area handled at the page level
 *
 * Starts the screen time tracker when the kid enters /kid routes and stops it
 * when they leave. Usage is keyed to the kid's pubkey.
 */
export function KuboKidLayout() {
  const { user } = useCurrentUser();

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
      {/*
        Kid-themed fallback — a crash here must NOT show Ditto's onboarding-
        beige error screen (the shared ErrorBoundary default uses the global
        palette, which in this layout would clash badly with #1E3A8A). We
        pass a Kubo-themed fallback rather than editing the shared boundary,
        so upstream Ditto merges stay conflict-free.
      */}
      <ErrorBoundary fallback={<KuboKidErrorFallback />}>
        <Outlet />
      </ErrorBoundary>
    </div>
  );
}
