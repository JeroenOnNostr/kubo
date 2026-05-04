import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { KuboOnboardErrorFallback } from '@/components/KuboErrorFallbacks';

/**
 * Chrome for /onboard/* routes: a 3-dot progress indicator at the top,
 * the onboarding page via <Outlet />, no bottom nav.
 *
 * Progress is inferred from the path rather than passed via context —
 * keeps the layout dumb and the steps independently routable for deep
 * links / back-nav.
 */
// Each step matches one or more pathnames. The fresh-signup branch
// (`/onboard/create-parent`) and the existing-account branch
// (`/onboard/login`) collapse onto the same step-2 dot so the progress
// indicator stays at 3 dots regardless of which path the parent took.
const STEPS = [
  { paths: ['/onboard/welcome'],                          label: 'Welcome' },
  { paths: ['/onboard/create-parent', '/onboard/login'],  label: 'Create account' },
  { paths: ['/onboard/add-kid'],                          label: 'Add a kid' },
] as const;

export function KuboOnboardLayout() {
  const { pathname } = useLocation();
  const currentIndex = Math.max(
    0,
    STEPS.findIndex((s) => (s.paths as readonly string[]).includes(pathname)),
  );

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      <header
        className="flex items-center justify-center gap-2 pt-[calc(var(--safe-area-inset-top,env(safe-area-inset-top,0px))+16px)] pb-4"
        aria-label={`Step ${currentIndex + 1} of ${STEPS.length}`}
      >
        {STEPS.map((s, i) => (
          <span
            key={s.paths[0]}
            className={cn(
              // Animate width + color so the active pill grows into place
              // when the user advances a step (≈200ms feels snappy, not
              // sluggish). Width collapses back on step-back too.
              'h-2 rounded-full transition-[width,background-color] duration-300 ease-out',
              i < currentIndex && 'bg-primary/60 w-2',
              i === currentIndex && 'bg-primary w-8',
              i > currentIndex && 'bg-muted w-2',
            )}
            aria-hidden
          />
        ))}
      </header>

      <main className="flex-1 flex flex-col px-6 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
        {/*
          Onboarding-themed fallback — keeps the beige palette consistent
          if something crashes mid-flow (e.g., relay publish failure).
        */}
        <ErrorBoundary fallback={<KuboOnboardErrorFallback />}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
