import { useEffect } from 'react';

import {
  useKuboFamily,
  adoptTeppEnforcedFromMirror,
  type KuboFamily,
} from '@/hooks/useKuboFamily';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/**
 * KUBO-152 — the single derived predicate that decides whether TEPP is
 * enforced for a given user.
 *
 * Background: enforcement used to short-circuit on `config.feedSettings.featureTepp`
 * (`useKuboTeppGate`, `useConstruct`, `useKuboTeppFeedFilter`). That flag is
 * synced as the *active user's own* encrypted kind-30078 — so when a kid is the
 * active account, the KID's own key authors the master switch for its own
 * protection. A kid (or anyone) flipping their synced `featureTepp:false` would
 * disable the gate, the read filter, and even the construct fetch for that kid.
 * That is the KUBO-152 fail-open.
 *
 * The authoritative flag now lives in the parent-controlled, device-local
 * family record (`family.teppEnforced`, written by the EditKidSettingsPage
 * toggle). `feedSettings.featureTepp` survives only as the parent-UI-visible
 * mirror for sync/migration compatibility — it may turn enforcement ON for the
 * parent's own UI, but it must NEVER turn it OFF for a kid when the family flag
 * is on.
 *
 * Definition: TEPP is enforced for `targetPubkey` when ALL hold:
 *   1. the family record exists,
 *   2. the family-level flag `family.teppEnforced` is `true`, AND
 *   3. `targetPubkey` is a kid in that family.
 */

/**
 * Pure form of the enforcement predicate. React-free and unit-testable. Takes
 * the family record (or null) and the target user's pubkey; returns whether
 * TEPP enforcement is active for that user.
 *
 * Critically: the kid's (or any account's) synced `featureTepp` value plays NO
 * part here. Only `family.teppEnforced` (parent-controlled) and family
 * membership decide enforcement.
 */
export function isTeppEnforced(
  family: KuboFamily | null | undefined,
  targetPubkey: string | undefined | null,
): boolean {
  if (!family) return false;
  if (family.teppEnforced !== true) return false;
  if (!targetPubkey) return false;
  return family.kids.some((k) => k.pubkey === targetPubkey);
}

/**
 * Hook form. When `kidPubkey` is omitted it falls back to the active user
 * (`useCurrentUser`), so callers that just want "is the active session a
 * TEPP-enforced kid" can call `useTeppEnforced()` with no argument.
 *
 * Side effect (one-time, idempotent): if the family record exists but its
 * `teppEnforced` field has never been set, this adopts the current parent-side
 * `config.feedSettings.featureTepp` mirror exactly once — the KUBO-152
 * migration so existing installs don't silently flip enforcement when the
 * authoritative flag moves into the family record. See
 * `adoptTeppEnforcedFromMirror`.
 */
export function useTeppEnforced(kidPubkey?: string): boolean {
  const { family } = useKuboFamily();
  const { config } = useAppContext();
  const { user } = useCurrentUser();

  const target = kidPubkey ?? user?.pubkey;

  // KUBO-152 migration: adopt the mirror value once, on the first render where
  // a family record exists with an unset `teppEnforced`. `adoptTeppEnforcedFromMirror`
  // is idempotent (no-op once the field is defined) and writes through the
  // family store, which re-renders this hook with the adopted value.
  useEffect(() => {
    if (family && family.teppEnforced === undefined) {
      void adoptTeppEnforcedFromMirror(!!config.feedSettings.featureTepp);
    }
  }, [family, config.feedSettings.featureTepp]);

  return isTeppEnforced(family, target);
}
