import { Outlet } from 'react-router-dom';
import { KuboBottomNav } from '@/components/KuboBottomNav';
import { KuboKidSelector } from '@/components/KuboKidSelector';
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
    <ScopedTheme colors={builtinThemes.dark} className="min-h-dvh bg-background text-foreground safe-area-top">
      <header className="flex items-center justify-between px-4 pt-2 pb-1">
        <img src="/wordmark.svg" alt="Kubo" className="h-6" />
        <KuboKidSelector />
      </header>
      <main className="pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px))]">
        <Outlet />
      </main>
      <KuboBottomNav />
    </ScopedTheme>
  );
}
