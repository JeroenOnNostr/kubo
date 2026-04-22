import { Outlet } from 'react-router-dom';
import { KuboBottomNav } from '@/components/KuboBottomNav';
import { KuboKidSelector } from '@/components/KuboKidSelector';
import { KuboWordmark } from '@/components/KuboWordmark';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { KuboParentErrorFallback } from '@/components/KuboErrorFallbacks';
import { ScopedTheme } from '@/components/ScopedTheme';
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
  return (
    <ScopedTheme colors={builtinThemes.dark} className="min-h-dvh bg-background text-foreground">
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
    </ScopedTheme>
  );
}
