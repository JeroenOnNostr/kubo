import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * Chrome for /onboard/* routes: a 3-dot progress indicator at the top,
 * the onboarding page via <Outlet />, no bottom nav.
 *
 * Progress is inferred from the path rather than passed via context —
 * keeps the layout dumb and the steps independently routable for deep
 * links / back-nav.
 */
const STEPS = [
  { path: '/onboard/welcome',       label: 'Welcome' },
  { path: '/onboard/create-parent', label: 'Create account' },
  { path: '/onboard/add-kid',       label: 'Add a kid' },
] as const;

export function KuboOnboardLayout() {
  const { pathname } = useLocation();
  const currentIndex = Math.max(0, STEPS.findIndex((s) => s.path === pathname));

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      <header
        className="flex items-center justify-center gap-2 pt-[calc(env(safe-area-inset-top,0px)+16px)] pb-4"
        aria-label={`Step ${currentIndex + 1} of ${STEPS.length}`}
      >
        {STEPS.map((s, i) => (
          <span
            key={s.path}
            className={cn(
              'size-2 rounded-full transition-colors',
              i < currentIndex && 'bg-primary/60',
              i === currentIndex && 'bg-primary w-8',
              i > currentIndex && 'bg-muted',
            )}
            aria-hidden
          />
        ))}
      </header>

      <main className="flex-1 flex flex-col px-6 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
        <Outlet />
      </main>
    </div>
  );
}
