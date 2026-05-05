import { useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, PlaySquare, Upload, Users, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { selectionChanged } from '@/lib/haptics';
import { ArcBackground } from '@/components/ArcBackground';
import { useRegisterTourAnchor } from '@/contexts/TourAnchorContext';

/**
 * Kubo parent-app bottom nav: Home · Feed · Trust · Upload · Alerts.
 *
 * - Home  → per-kid dashboard (KidDashboardPage) for the currently-selected
 *           kid signer. Tiles link to the kid-settings / feed-settings /
 *           trust / keys / alerts pages.
 * - Feed  → preview feed of what the selected kid will see (ParentFeedPage).
 * - Trust → kid-scoped trust-people / trust-places.
 * - Upload → content uploader.
 * - Alerts → watch-requests and safety notifications.
 */
const HOME_PATHS = new Set([
  '/parent/home',
  '/parent/kid-settings',
  '/parent/keys',
  '/parent/wot',
]);

const TABS = [
  { to: '/parent/home',   icon: Home,       label: 'Home',
    match: (p: string) => HOME_PATHS.has(p) },
  { to: '/parent/feed',   icon: PlaySquare, label: 'Feed',
    match: (p: string) => p === '/parent/feed' || p === '/parent/feed-settings' },
  { to: '/parent/trust',  icon: Users,      label: 'Trust',
    match: (p: string) => p.startsWith('/parent/trust') || p.startsWith('/parent/groups/') },
  { to: '/parent/upload', icon: Upload,     label: 'Upload',
    match: (p: string) => p === '/parent/upload' },
  { to: '/parent/alerts', icon: Bell,       label: 'Alerts',
    match: (p: string) => p === '/parent/alerts' },
] as const;

export function KuboBottomNav() {
  const location = useLocation();

  // KUBO-092 tour anchors: the whole nav (step 3 — five-tab orientation) and
  // the Feed tab specifically (step 4 — source-types primer).
  const navRef = useRef<HTMLElement | null>(null);
  const feedTabRef = useRef<HTMLAnchorElement | null>(null);
  useRegisterTourAnchor('parentBottomNav', navRef);
  useRegisterTourAnchor('parentFeedTab', feedTabRef);

  return (
    <nav ref={navRef} className="fixed bottom-0 left-0 right-0 z-40 sidebar:hidden">
      <div className="relative">
        <ArcBackground variant="up" />
        <div className="h-11 flex items-center relative">
          {TABS.map(({ to, icon: Icon, label, match }) => {
            const active = match(location.pathname);
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
                <Icon className="size-5" />
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
