import { Navigate } from 'react-router-dom';

/**
 * /parent/trust — landing page for the Trust bottom-nav tab.
 *
 * Redirects to the People sub-tab scoped to the currently-selected kid
 * (the active Nostr signer, picked via the top-right gear dropdown).
 */
export function ParentTrustIndexPage() {
  return <Navigate to="/parent/trust/people" replace />;
}
