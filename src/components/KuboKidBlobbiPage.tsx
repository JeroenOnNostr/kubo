import { lazy, Suspense, useMemo } from 'react';
import { Navigate } from 'react-router-dom';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { LayoutStore, LayoutStoreContext } from '@/contexts/LayoutContext';
import { KuboKidBottomNav } from '@/components/KuboKidBottomNav';

import '@/styles/kubo-kid-blobbi.css';

// Lazy-load Ditto's BlobbiPage so its ~hundreds-of-KB of blobbi assets
// don't bloat the kid-app entry chunk.
const BlobbiPage = lazy(() =>
  import('@/pages/BlobbiPage').then((m) => ({ default: m.BlobbiPage })),
);

/**
 * /kid/blobbi — Ditto's Blobbi (virtual-pet tamagotchi) surfaced in the kid app.
 *
 * Strategy: render upstream Ditto's <BlobbiPage /> VERBATIM so any future
 * upstream improvement flows in for free. The only Kubo-side glue is:
 *
 *   1. A throwaway LayoutStoreContext provider. Ditto's BlobbiPage calls
 *      useLayoutOptions(...) which normally drives MainLayout; the kid app
 *      doesn't mount MainLayout, so we provide an unobserved LayoutStore to
 *      make the call a harmless no-op. If we didn't, the hook would throw
 *      (LayoutContext.ts:useLayoutStore).
 *
 *   2. A per-kid gate: hides the route unless the parent has opted the kid
 *      into the Blobbi tab (KidSettings.showBlobbiTab). When off, redirect
 *      to /kid.
 *
 *   3. The kid's own bottom nav, so the three-tab chrome is consistent.
 *
 * Visual mismatch between BlobbiPage's light palette and the kid app's
 * deep-blue background is addressed by a CSS-only skin scoped under
 * `.kubo-kid-blobbi` — see src/styles/kubo-kid-blobbi.css.
 */
export function KuboKidBlobbiPage() {
  const { user } = useCurrentUser();
  const { family } = useKuboFamily();

  // Stable store — created once per page mount. Pages that call
  // useLayoutOptions will write into it, but nothing is subscribed, so
  // the writes are no-ops.
  const layoutStore = useMemo(() => new LayoutStore(), []);

  const enabled = !!(user && family?.kidSettings?.[user.pubkey]?.showBlobbiTab);
  if (!enabled) {
    return <Navigate to="/kid" replace />;
  }

  return (
    <div className="kubo-kid-blobbi min-h-dvh pb-14">
      <LayoutStoreContext.Provider value={layoutStore}>
        <Suspense fallback={<div className="min-h-dvh" />}>
          <BlobbiPage />
        </Suspense>
      </LayoutStoreContext.Provider>
      <KuboKidBottomNav showBlobbi />
    </div>
  );
}
