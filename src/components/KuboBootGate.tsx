import { Navigate } from 'react-router-dom';
import { dismissPreloader } from '@/lib/preloader';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useKuboFamily } from '@/hooks/useKuboFamily';

/**
 * Root-route gate for Kubo.
 *
 * - No active login                 → /onboard/welcome
 * - Logged in, no kid yet           → /onboard/add-kid (existing-account
 *                                     parent backgrounded the app between
 *                                     login and adding their first kid;
 *                                     reopens land back on the kid step)
 * - Logged in with at least one kid → /kid (kid app)
 *
 * While auth or the family record are still resolving we render nothing — the
 * static #preloader (index.html) is still on screen and shows through, so the
 * boot is one continuous loading screen with no React-rendered twin to flash
 * to. Family bootstrap is async (Android KeyStore on native, localStorage on
 * web), so reading `family` synchronously on the first render returns `null`
 * even for users with a fully-populated record; waiting on `isBootstrapped`
 * prevents the cold-start redirect-to-add-kid trap.
 */
export function KuboBootGate() {
  const { user, isLoading } = useCurrentUser();
  const { family, isBootstrapped } = useKuboFamily();

  // Still resolving — render nothing; the #preloader covers the screen.
  if (isLoading || !isBootstrapped) return null;

  // For the kid app, KidHomePage dismisses the preloader once the feed is
  // painted underneath it. For non-kid destinations (onboarding/parent),
  // dismiss now — those screens are the real content, no feed gate applies.
  if (!user) {
    dismissPreloader();
    return <Navigate to="/onboard/welcome" replace />;
  }

  if (!family || family.kids.length === 0) {
    dismissPreloader();
    return <Navigate to="/onboard/add-kid" replace />;
  }

  return <Navigate to="/kid" replace />;
}
