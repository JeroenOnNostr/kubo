import { useMemo } from 'react';
import type { NUser } from '@nostrify/react/login';

import { useCurrentUser } from './useCurrentUser';
import { useKuboFamily } from './useKuboFamily';

/**
 * Returns the NUser whose pubkey matches `family.parentPubkey`, regardless of
 * which login is active in the kid switcher. Use this for any operation that
 * must be attributed to the parent identity — currently NIP-29 group join,
 * create, the kind-10009 group list, and group chat sends.
 *
 * Fallback semantics:
 *  - No parental setup (`family` null): returns the active user. Drop-in for
 *    solo installs that never onboarded as a family.
 *  - Parental setup exists but the parent login is missing from `logins`
 *    (parent logged out while a kid is still signed in): returns `undefined`
 *    so the caller can surface a "log in as parent" error rather than
 *    silently signing with the kid (which is exactly the bug this hook fixes).
 */
export function useParentSigner(): {
  user: NUser | undefined;
  reason?: 'no-family' | 'parent-logged-out';
} {
  const { users, user: activeUser } = useCurrentUser();
  const { family } = useKuboFamily();

  return useMemo(() => {
    if (!family) return { user: activeUser, reason: 'no-family' };
    const parent = users.find((u) => u.pubkey === family.parentPubkey);
    if (!parent) return { user: undefined, reason: 'parent-logged-out' };
    return { user: parent };
  }, [users, activeUser, family]);
}
