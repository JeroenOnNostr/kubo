import { Outlet } from 'react-router-dom';
import { KuboBottomNav } from '@/components/KuboBottomNav';

/**
 * Layout shell for all /parent/* routes.
 *
 * Deliberately minimal: no sidebars, no Ditto chrome. Just the page outlet
 * plus the Kubo 4-tab bottom nav. Further shells (kid-app wrapper, onboarding
 * progress bar) will be separate layouts so each flow keeps its own chrome.
 */
export function KuboParentLayout() {
  return (
    <div className="min-h-dvh bg-background text-foreground safe-area-top">
      <main className="pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px))]">
        <Outlet />
      </main>
      <KuboBottomNav />
    </div>
  );
}
