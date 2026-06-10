import { useMemo } from 'react';
import type { NUser } from '@nostrify/react/login';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useKuboFamily } from '@/hooks/useKuboFamily';

/** Typed reasons a kid signer can't be resolved. */
export type KidSignerReason = 'no-family' | 'not-a-kid' | 'kid-not-logged-in';

/** Minimal shape needed to identify a kid in the family record. */
interface KidFamily {
  kids: ReadonlyArray<{ pubkey: string }>;
}

/**
 * Pure kid-signer resolution (KUBO-175): the single source of truth for "which
 * logged-in user can sign as this kid, and if none, why?" — shared between the
 * React hook `useKidSigner` and the non-React migration path
 * (`useTeppMigration` order-6) so both produce the same typed reason taxonomy.
 *
 * Reasons:
 *  - `no-family`: no parental setup is configured.
 *  - `not-a-kid`: the pubkey is missing or isn't in `family.kids`.
 *  - `kid-not-logged-in`: the kid is in the family record but has no matching
 *    login on this device. Caller should surface "log in as <kid name> to
 *    publish or rotate their TEPP association."
 */
export function resolveKidSigner<U extends { pubkey: string }>(
  users: ReadonlyArray<U>,
  family: KidFamily | null | undefined,
  kidPubkey: string | undefined,
): { user: U | undefined; reason?: KidSignerReason } {
  if (!kidPubkey) return { user: undefined, reason: 'not-a-kid' };
  if (!family) return { user: undefined, reason: 'no-family' };
  const isKid = family.kids.some((k) => k.pubkey === kidPubkey);
  if (!isKid) return { user: undefined, reason: 'not-a-kid' };
  const kid = users.find((u) => u.pubkey === kidPubkey);
  if (!kid) return { user: undefined, reason: 'kid-not-logged-in' };
  return { user: kid };
}

/**
 * Return the NUser whose pubkey matches the given kid, regardless of which
 * login is active in the kid switcher. Used **only** for signing the kid's
 * association event (kind 17700). Mirrors `useParentSigner`'s lookup pattern.
 * Thin React wrapper around {@link resolveKidSigner}.
 */
export function useKidSigner(kidPubkey: string | undefined): {
  user: NUser | undefined;
  reason?: KidSignerReason;
} {
  const { users } = useCurrentUser();
  const { family } = useKuboFamily();

  return useMemo(
    () => resolveKidSigner(users, family, kidPubkey),
    [users, family, kidPubkey],
  );
}
