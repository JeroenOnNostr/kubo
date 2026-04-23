import { NavLink, useLocation } from 'react-router-dom';
import { Home, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { selectionChanged } from '@/lib/haptics';

/**
 * Kid-app bottom nav: 2 tabs only (Home · Favorites).
 *
 * Intentionally NOT the KuboBottomNav — the kid app has a different palette
 * (deep-blue chrome instead of card-gray), a larger hit target, and only
 * two destinations so it never overwhelms. Rendered only on feed states;
 * hidden on Locked and Fullscreen.
 */
const TABS = [
  { to: '/kid',           icon: Home, label: 'Home'      },
  { to: '/kid/favorites', icon: Star, label: 'Favorites' },
] as const;

export function KuboKidBottomNav() {
  const location = useLocation();

  return (
    <nav
      className="max-w-sm mx-auto fixed bottom-0 left-0 right-0 z-40"
      style={{ background: '#142E6B', borderTop: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="h-14 flex items-center">
        {TABS.map(({ to, icon: Icon, label }) => {
          const active = location.pathname === to;
          return (
            <NavLink
              key={to}
              to={to}
              onClick={() => selectionChanged()}
              end={to === '/kid'}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors',
                active ? 'text-white' : 'text-white/60',
              )}
            >
              <Icon className="size-6" />
              <span className="text-[11px] font-semibold">{label}</span>
            </NavLink>
          );
        })}
      </div>
      <div className="safe-area-bottom" />
    </nav>
  );
}
