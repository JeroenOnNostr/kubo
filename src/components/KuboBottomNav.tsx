import { NavLink, useLocation } from 'react-router-dom';
import { Home, Upload, Users, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { selectionChanged } from '@/lib/haptics';
import { ArcBackground } from '@/components/ArcBackground';

/**
 * Kubo parent-app bottom nav: Home · Upload · Trust · Alerts.
 *
 * Replaces MobileBottomNav within KuboParentLayout routes. Uses the same
 * ArcBackground as the Ditto nav so the visual language carries over while
 * the IA is Kubo-specific.
 */
const TABS = [
  { to: '/parent/home',   icon: Home,   label: 'Home',
    match: (p: string) => p === '/parent/home' || p.startsWith('/parent/home/') ||
      (p.startsWith('/parent/kid/') && !/^\/parent\/kid\/[^/]+\/trust(\/|$)/.test(p)) },
  { to: '/parent/upload', icon: Upload, label: 'Upload',
    match: (p: string) => p === '/parent/upload' || p.startsWith('/parent/upload/') },
  { to: '/parent/trust',  icon: Users,  label: 'Trust',
    match: (p: string) => p === '/parent/trust' || p.startsWith('/parent/trust/') || /^\/parent\/kid\/[^/]+\/trust(\/|$)/.test(p) },
  { to: '/parent/alerts', icon: Bell,   label: 'Alerts',
    match: (p: string) => p === '/parent/alerts' || p.startsWith('/parent/alerts/') },
] as const;

export function KuboBottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 sidebar:hidden">
      <div className="relative">
        <ArcBackground variant="up" />
        <div className="h-11 flex items-center relative">
          {TABS.map(({ to, icon: Icon, label, match }) => {
            const active = match(location.pathname);
            return (
              <NavLink
                key={to}
                to={to}
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
