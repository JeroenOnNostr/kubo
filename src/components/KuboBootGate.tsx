import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { HomePage } from '@/pages/HomePage';

/**
 * Root-route gate for Kubo.
 *
 * - Authenticated user  → redirect to /kid (Kubo kid app)
 * - Unauthenticated     → keep rendering Ditto's existing HomePage.
 *
 * PR 2 will replace the unauthenticated branch with /onboard/welcome once
 * the Kubo onboarding flow is live. Until then, unauth users see the
 * existing landing page so login still works.
 */
export function KuboBootGate() {
  const { user, isLoading } = useCurrentUser();

  // While auth state is resolving, keep the current HomePage visible.
  // HomePage handles its own loading UI; we don't want to flash to a
  // redirect and back.
  if (isLoading) return <HomePage />;

  if (user) return <Navigate to="/kid" replace />;

  return <HomePage />;
}
