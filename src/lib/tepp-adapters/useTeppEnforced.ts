import {
  useKuboFamily,
  type KuboFamily,
} from '@/hooks/useKuboFamily';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/**
 * KUBO-209 — the single derived predicate that decides whether TEPP is
 * enforced for a given user.
 *
 * TEPP is now a CORE, non-optional protection: it is ON for every kid in a
 * family and cannot be turned off. There is no parent-facing toggle and no
 * stored enable/disable flag consulted here. The old `family.teppEnforced`
 * field (and the kid-writable `feedSettings.featureTepp` mirror) play NO part
 * in this decision — enforcement is decided solely by family membership.
 *
 * Background on why the flag is gone: enforcement used to short-circuit on
 * `config.feedSettings.featureTepp` (the KUBO-152 fail-open: a kid could author
 * `featureTepp:false` in their own synced kind-30078 and disable their own
 * protection), which was hardened to the parent-controlled `family.teppEnforced`
 * flag. KUBO-209 removes the opt-out entirely — child protection should not be
 * something a parent (or kid) can switch off — so the predicate no longer reads
 * any flag at all.
 *
 * Definition: TEPP is enforced for `targetPubkey` when BOTH hold:
 *   1. the family record exists, AND
 *   2. `targetPubkey` is a kid in that family.
 */

/**
 * Pure form of the enforcement predicate. React-free and unit-testable. Takes
 * the family record (or null) and the target user's pubkey; returns whether
 * TEPP enforcement is active for that user.
 *
 * Enforcement is unconditional for kids: there is no flag to consult. Only
 * family existence and family membership decide. The parent themselves and any
 * non-kid (stranger) are never enforced.
 */
export function isTeppEnforced(
  family: KuboFamily | null | undefined,
  targetPubkey: string | undefined | null,
): boolean {
  if (!family) return false;
  if (!targetPubkey) return false;
  return family.kids.some((k) => k.pubkey === targetPubkey);
}

/**
 * Hook form. When `kidPubkey` is omitted it falls back to the active user
 * (`useCurrentUser`), so callers that just want "is the active session a
 * TEPP-enforced kid" can call `useTeppEnforced()` with no argument.
 *
 * No side effects: TEPP is unconditional for kids (KUBO-209), so there is no
 * flag to initialize and no opt-out to resolve.
 */
export function useTeppEnforced(kidPubkey?: string): boolean {
  const { family } = useKuboFamily();
  const { user } = useCurrentUser();

  const target = kidPubkey ?? user?.pubkey;

  return isTeppEnforced(family, target);
}
