import { useMemo, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, PlaySquare, Upload, Users, LifeBuoy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { selectionChanged } from '@/lib/haptics';
import { ArcBackground } from '@/components/ArcBackground';
import { useRegisterTourAnchor } from '@/contexts/TourAnchorContext';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useHasUnreadTestersGroup } from '@/hooks/useHasUnreadTestersGroup';
import { isTestersGroupAddr } from '@/lib/appRelays';

/**
 * Kubo parent-app bottom nav: Home · Feed · Trust · Upload · Support.
 *
 * - Home  → per-kid dashboard (KidDashboardPage) for the currently-selected
 *           kid signer. Tiles link to the kid-settings / feed-settings /
 *           trust / keys pages. Alerts (kid → parent requests) now live inline
 *           on this dashboard (KUBO-185), and the pending-request dot badge
 *           rides on this tab.
 * - Feed  → preview feed of what the selected kid will see (ParentFeedPage).
 * - Trust → kid-scoped trust-people / trust-places.
 * - Upload → content uploader.
 * - Support → get help / give support (KUBO-186), replacing the old Alerts tab.
 */
const HOME_PATHS = new Set([
  '/parent/home',
  '/parent/kid-settings',
  '/parent/keys',
  '/parent/wot',
]);

/**
 * Pull the (still URL-encoded) group address out of a `/parent/groups/:addr`
 * path, or null if it isn't a group-view route. Used to route the single group
 * view to the correct bottom-nav tab — the Kubo Testers group belongs to
 * Support, every other group to Trust.
 */
function groupAddrFromPath(p: string): string | null {
  const m = p.match(/^\/parent\/groups\/([^/]+)$/);
  return m ? m[1] : null;
}

const TABS = [
  { to: '/parent/home',   icon: Home,       label: 'Home',
    match: (p: string) => HOME_PATHS.has(p) },
  { to: '/parent/feed',   icon: PlaySquare, label: 'Feed',
    match: (p: string) => p === '/parent/feed' || p === '/parent/feed-settings' || p.startsWith('/parent/feed/') },
  { to: '/parent/trust',  icon: Users,      label: 'Trust',
    match: (p: string) => {
      if (p.startsWith('/parent/trust')) return true;
      // Group views belong to Trust — except the Kubo Testers group, which is
      // reached from (and highlights) Support.
      const addr = groupAddrFromPath(p);
      return addr !== null && !isTestersGroupAddr(addr);
    } },
  { to: '/parent/upload', icon: Upload,     label: 'Upload',
    match: (p: string) => p === '/parent/upload' },
  { to: '/parent/support', icon: LifeBuoy,  label: 'Support',
    match: (p: string) => {
      if (p === '/parent/support') return true;
      // The testers group view is part of the Support flow.
      return isTestersGroupAddr(groupAddrFromPath(p) ?? undefined);
    } },
] as const;

export function KuboBottomNav() {
  const location = useLocation();
  const { family } = useKuboFamily();

  // KUBO-092 tour anchors: the whole nav (step 3 — five-tab orientation) and
  // the Feed tab specifically (step 4 — source-types primer).
  const navRef = useRef<HTMLElement | null>(null);
  const feedTabRef = useRef<HTMLAnchorElement | null>(null);
  useRegisterTourAnchor('parentBottomNav', navRef);
  useRegisterTourAnchor('parentFeedTab', feedTabRef);

  // KUBO-098/185: badge the Home tab when there's at least one pending kid →
  // parent trust request. Alerts moved onto the Home dashboard, so its
  // "something needs you" dot rides the Home tab now. Counts across all kids —
  // single-device, single-family scope means a dot is enough; no count.
  const hasAlerts = useMemo(() => {
    const requests = family?.trustRequests;
    if (!requests) return false;
    for (const byKid of Object.values(requests)) {
      if (Object.keys(byKid).length > 0) return true;
    }
    return false;
  }, [family]);

  // KUBO-191: badge the Support tab when there are unread messages in the
  // Kubo Testers group (the support chat now lives on /parent/support).
  const hasUnreadTesters = useHasUnreadTestersGroup();

  return (
    <nav ref={navRef} className="fixed bottom-0 left-0 right-0 z-40 sidebar:hidden">
      <div className="relative">
        <ArcBackground variant="up" />
        <div className="h-11 flex items-center relative">
          {TABS.map(({ to, icon: Icon, label, match }) => {
            const active = match(location.pathname);
            const showAlertDot =
              (to === '/parent/home' && hasAlerts) ||
              (to === '/parent/support' && hasUnreadTesters);
            return (
              <NavLink
                key={to}
                to={to}
                ref={to === '/parent/feed' ? feedTabRef : undefined}
                onClick={() => selectionChanged()}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <span className="relative">
                  <Icon className="size-5" />
                  {showAlertDot && (
                    <span
                      className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive ring-2 ring-background"
                      aria-label={to === '/parent/support' ? 'New messages' : 'Pending alerts'}
                    />
                  )}
                </span>
                <span className="text-[10px] font-medium">{label}</span>
              </NavLink>
            );
          })}
        </div>
      </div>
      <div className="safe-area-bottom bg-background/85" />
    </nav>
  );
}
