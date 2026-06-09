import { useMemo } from 'react';
import type { NUser } from '@nostrify/react/login';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useKuboFamily } from '@/hooks/useKuboFamily';

/**
 * Return the NUser whose pubkey matches the given kid, regardless of which
 * login is active in the kid switcher. Used **only** for signing the kid's
 * association event (kind 17700). Mirrors `useParentSigner`'s lookup pattern.
 *
 * Reasons:
 *  - `no-family`: no parental setup is configured.
 *  - `not-a-kid`: the pubkey isn't in `family.kids`.
 *  - `kid-not-logged-in`: the kid is in the family record but has no matching
 *    login record (i.e. the kid hasn't been logged in via the kid switcher
 *    on this device). Caller should surface "log in as <kid name> to publish
 *    or rotate their TEPP association."
 */
export function useKidSigner(kidPubkey: string | undefined): {
  user: NUser | undefined;
  reason?: 'no-family' | 'not-a-kid' | 'kid-not-logged-in';
} {
  const { users } = useCurrentUser();
  const { family } = useKuboFamily();

  return useMemo(() => {
    if (!kidPubkey) return { user: undefined, reason: 'not-a-kid' };
    if (!family) return { user: undefined, reason: 'no-family' };
    const isKid = family.kids.some((k) => k.pubkey === kidPubkey);
    if (!isKid) return { user: undefined, reason: 'not-a-kid' };
    const kid = users.find((u) => u.pubkey === kidPubkey);
    if (!kid) return { user: undefined, reason: 'kid-not-logged-in' };
    return { user: kid };
  }, [users, family, kidPubkey]);
}
