import { Outlet } from 'react-router-dom';

/**
 * Layout shell for all /kid/* routes.
 *
 * Distinct from KuboParentLayout:
 * - Deep-blue (#1E3A8A) full-bleed background signals "this is the kid app"
 * - No bottom nav here — KidHomePage renders its own 2-tab bar (Home · Favorites)
 *   because the locked / fullscreen-player states are chromeless
 * - Text is white, safe-area handled at the page level
 */
export function KuboKidLayout() {
  return (
    <div
      className="min-h-dvh text-white safe-area-top"
      style={{ background: '#1E3A8A' }}
    >
      <Outlet />
    </div>
  );
}
