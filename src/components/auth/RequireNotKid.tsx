import { Navigate, Outlet } from 'react-router-dom';

import { useSelectedKid } from '@/hooks/useSelectedKid';

/**
 * KUBO-158 — backstop guard around the Ditto MainLayout route group.
 *
 * Layer 1 (KidNavigationInterceptor) blocks in-feed shell-escape taps, but it
 * only covers anchors rendered inside a kid NoteCard. This guard is Layer 2: it
 * covers raw URL entry on web (typing /t/foo, /search, /notifications, or any
 * MainLayout route while a kid is the active session) and any future
 * interceptor gap. A kid must never land in the ungated MainLayout.
 *
 * Source of truth: `useSelectedKid()` — the active Nostr signer (logins[0]) is a
 * kid in the family record. This is the same "active user is a kid in the
 * family" predicate the kid-vs-parent shell routing already uses (see
 * KuboParentLayout's kid-selector), and it is deliberately INDEPENDENT of
 * whether TEPP enforcement is on: a kid should never reach MainLayout regardless
 * of the TEPP flag. Returns null for the parent / any non-kid account / before
 * family state loads, so parents and logged-out visitors see MainLayout
 * normally.
 *
 * When a kid is active → redirect to /kid (their shell). `replace` keeps the
 * blocked URL out of history so a back-gesture can't re-enter it.
 */
export function RequireNotKid() {
  const kid = useSelectedKid();

  if (kid) {
    return <Navigate to="/kid" replace />;
  }

  return <Outlet />;
}

export default RequireNotKid;
