import { useEffect, useSyncExternalStore } from 'react';
import { Outlet } from 'react-router-dom';

import { ParentGateDialog } from '@/components/kid/ParentGateDialog';
import {
  isParentUnlocked,
  lockParent,
  subscribeParentUnlock,
} from '@/lib/parentUnlockStore';

/**
 * KUBO-153: route guard wrapping the entire /parent/* subtree.
 *
 * The /parent pages (kid-settings with the TEPP toggle, trust, keys) used to
 * be one URL away from the kid app — direct navigation to /parent/kid-settings
 * rendered the page with no PIN check. This element gates the whole subtree on
 * an IN-MEMORY `parentUnlocked` flag (see parentUnlockStore — deliberately not
 * localStorage, which a kid can edit).
 *
 * Behaviour:
 *   - Unlocked → render the matched /parent/* route (<Outlet/>). Because this
 *     wraps the subtree, EVERY path into /parent/* is covered regardless of
 *     how navigation happens (gear button, back-gesture, deep link, raw URL).
 *   - Locked → render the PIN dialog IN PLACE (navigateOnSuccess=false) so the
 *     original deep link the parent was reaching for opens after unlock,
 *     rather than bouncing them to /parent/home.
 *
 * Lock triggers (all clear the flag):
 *   1. Navigation OUT of /parent/* — this component unmounts, cleanup locks.
 *   2. App backgrounding — visibilitychange → 'hidden' while mounted.
 *   3. A 10-minute expiry timer (owned by parentUnlockStore).
 *
 * First-run: if no PIN is configured yet, ParentGateDialog opens in setup mode
 * (matching the kid-app gear behaviour) and a completed setup unlocks the gate
 * too — so a parent setting up for the first time is never locked out of their
 * own /parent pages.
 */
export function RequireParentGate() {
  const unlocked = useSyncExternalStore(
    subscribeParentUnlock,
    isParentUnlocked,
    () => false,
  );

  // Lock trigger 2: background the app. While these /parent pages are mounted,
  // hiding the tab/app (e.g. handing the phone back to the kid) clears the
  // unlock so returning re-prompts for the PIN.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') lockParent();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Lock trigger 1: leaving /parent/* unmounts this guard → re-lock so a later
  // return to any /parent page must re-enter the PIN.
  useEffect(() => {
    return () => {
      lockParent();
    };
  }, []);

  if (unlocked) {
    return <Outlet />;
  }

  // Locked: render the PIN gate in place. open is forced true; onOpenChange is
  // a no-op (no cancel path here — there's nothing behind it to reveal, and
  // dismissing would just leave a blank guarded shell). navigateOnSuccess is
  // false so the deep link the parent was reaching for renders on unlock.
  return (
    <ParentGateDialog
      open
      onOpenChange={() => {}}
      navigateOnSuccess={false}
    />
  );
}

export default RequireParentGate;
