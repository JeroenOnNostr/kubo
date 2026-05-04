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
 * While auth is resolving we render nothing to avoid a flash of the welcome
 * screen followed by an immediate redirect into the kid app.
 */
export function KuboBootGate() {
  const { user, isLoading } = useCurrentUser();
  const { family } = useKuboFamily();

  if (isLoading) return null;

  if (!user) return <Navigate to="/onboard/welcome" replace />;

  if (!family || family.kids.length === 0) {
    return <Navigate to="/onboard/add-kid" replace />;
  }

  return <Navigate to="/kid" replace />;
}
