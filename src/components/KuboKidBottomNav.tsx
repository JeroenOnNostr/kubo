import { NavLink, useLocation } from 'react-router-dom';
import { Home, Star, Egg } from 'lucide-react';
import { cn } from '@/lib/utils';
import { selectionChanged } from '@/lib/haptics';

/**
 * Kid-app bottom nav: 2 or 3 tabs (Home · [Blobbi] · Favorites).
 *
 * Intentionally NOT the KuboBottomNav — the kid app has a different palette
 * (deep-blue chrome instead of card-gray), a larger hit target, and only
 * a handful of destinations so it never overwhelms. Rendered only on feed
 * states; hidden on Locked and Fullscreen.
 *
 * The middle "Blobbi" tab is opt-in per-kid (KidSettings.showBlobbiTab) —
 * when off, the nav reverts to the original 2-tab shape.
 */
interface KuboKidBottomNavProps {
  /** Show the Blobbi tab between Home and Favorites. Defaults to false. */
  showBlobbi?: boolean;
}

export function KuboKidBottomNav({ showBlobbi = false }: KuboKidBottomNavProps) {
  const location = useLocation();

  const tabs = [
    { to: '/kid',           icon: Home, label: 'Home'      },
    ...(showBlobbi ? [{ to: '/kid/blobbi', icon: Egg, label: 'Blobbi' }] : []),
    { to: '/kid/favorites', icon: Star, label: 'Favorites' },
  ] as const;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{ background: '#142E6B', borderTop: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="h-14 flex items-center">
        {tabs.map(({ to, icon: Icon, label }) => {
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
