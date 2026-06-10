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
import { useEnsureKidAssociation } from '@/hooks/useEnsureKidAssociation';
import { useEnsureParentTrust } from '@/hooks/useEnsureParentTrust';
import { EMPTY_FEED_SOURCES, useKuboFamily } from '@/hooks/useKuboFamily';
import { useRelayDiscovery } from '@/hooks/useRelayDiscovery';
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
  const selectedKid = useSelectedKid();
  useFeedSourcesPrime();
  // Warm the NIP-66 relay catalogue while the user browses other parent
  // pages, so Trust→Places and Feed→Relays open with results already loaded.
  useRelayDiscovery();
  // Ensure the parent is in the selected kid's trust domain at `interact`
  // (KUBO-147) — backfills pre-existing families and triggers the TEPP publish
  // once featureTepp is on.
  useEnsureParentTrust(selectedKid?.pubkey);
  // KUBO-149: also renew/recover the selected kid's TEPP association from the
  // parent shell (e.g. when the parent opens Trust → Diagnostics). The kid
  // typically stays logged in alongside the parent, so `useKidSigner` can sign
  // the association here too; the renewal hook shares a per-kid session guard
  // with the kid-app mount, so this never double-publishes.
  useEnsureKidAssociation(selectedKid?.pubkey);

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
