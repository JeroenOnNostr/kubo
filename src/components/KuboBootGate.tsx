import { Navigate } from 'react-router-dom';
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
 * While auth or the family record are still resolving we render nothing.
 * Family bootstrap is async (Android KeyStore on native, localStorage on web),
 * so reading `family` synchronously on the first render returns `null` even
 * for users with a fully-populated record. Waiting on `isBootstrapped`
 * prevents the cold-start redirect-to-add-kid trap that otherwise forces
 * existing parents to re-add a kid on every reopen.
 */
export function KuboBootGate() {
  const { user, isLoading } = useCurrentUser();
  const { family, isBootstrapped } = useKuboFamily();

  if (isLoading || !isBootstrapped) return null;

  if (!user) return <Navigate to="/onboard/welcome" replace />;

  if (!family || family.kids.length === 0) {
    return <Navigate to="/onboard/add-kid" replace />;
  }

  return <Navigate to="/kid" replace />;
}
