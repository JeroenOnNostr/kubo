import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/**
 * Root-route gate for Kubo.
 *
 * - Authenticated user  → /kid (Kubo kid app)
 * - Unauthenticated     → /onboard/welcome
 *
 * While auth is resolving we render nothing to avoid a flash of the welcome
 * screen followed by an immediate redirect into the kid app.
 */
export function KuboBootGate() {
  const { user, isLoading } = useCurrentUser();

  if (isLoading) return null;

  return <Navigate to={user ? '/kid' : '/onboard/welcome'} replace />;
}
