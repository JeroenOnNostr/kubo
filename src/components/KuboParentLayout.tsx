import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useNostr } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';

import { KuboBottomNav } from '@/components/KuboBottomNav';
import { KuboKidSelector } from '@/components/KuboKidSelector';
import { KuboWordmark } from '@/components/KuboWordmark';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { KuboParentErrorFallback } from '@/components/KuboErrorFallbacks';
import { ScopedTheme } from '@/components/ScopedTheme';
import { ParentTour } from '@/components/tour/ParentTour';
import { TourAnchorProvider } from '@/components/tour/TourAnchorProvider';
import { EMPTY_FEED_SOURCES, useKuboFamily } from '@/hooks/useKuboFamily';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { primeFeedSourcesCache } from '@/lib/primeFeedSourcesCache';
import { builtinThemes } from '@/themes';

/**
 * Layout shell for all /parent/* routes.
 *
 * Minimal chrome: a slim top header (wordmark + persistent kid selector) and
 * the Kubo bottom nav. Individual pages render their own page-level headers
 * (back buttons, titles, search bars) directly inside the outlet.
 *
 * Wrapped in ScopedTheme so the parent app always renders in Kubo's dark
 * blue-gray palette regardless of the user's global (Ditto) theme choice.
 */
export function KuboParentLayout() {
  useFeedSourcesPrime();

  return (
    <ScopedTheme colors={builtinThemes.dark} className="min-h-dvh bg-background text-foreground">
      <TourAnchorProvider>
        <header className="sticky top-0 z-20 bg-background safe-area-top flex items-center justify-between px-4 pt-2 pb-1">
          <KuboWordmark className="h-6 text-foreground" />
          <KuboKidSelector />
        </header>
        <main className="pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px))]">
          {/*
            Kubo-themed fallback. Wraps the route outlet only — header + nav
            stay alive on crash so the user can navigate away. Shared
            ErrorBoundary is Ditto-owned; we pass a fallback rather than
            editing it (forward-compat with upstream merges).
          */}
          <ErrorBoundary fallback={<KuboParentErrorFallback />}>
            <Outlet />
          </ErrorBoundary>
        </main>
        <KuboBottomNav />
        <ParentTour />
      </TourAnchorProvider>
    </ScopedTheme>
  );
}

/**
 * Plan mitigation M3 — prime the React Query cache at boot for the selected
 * kid's enabled communities/packs chips, so /parent/feed renders those
 * tiles from cache instead of firing a per-chip query cascade on first
 * paint. Runs once per kid-switch; idempotent.
 */
function useFeedSourcesPrime() {
  const kid = useSelectedKid();
  const { family } = useKuboFamily();
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!kid) return;
    const sources = family?.feedSources?.[kid.pubkey] ?? EMPTY_FEED_SOURCES;
    if (sources.communities.length === 0 && sources.packs.length === 0) return;
    void primeFeedSourcesCache({ queryClient, nostr, sources });
  }, [kid, family, nostr, queryClient]);
}
