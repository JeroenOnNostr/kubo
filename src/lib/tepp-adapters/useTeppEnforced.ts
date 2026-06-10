import { useEffect } from 'react';

import {
  useKuboFamily,
  adoptTeppEnforcedFromMirror,
  type KuboFamily,
} from '@/hooks/useKuboFamily';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';

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
 * KUBO-151 release epoch — `2026-06-10T00:00:00Z` as Unix SECONDS.
 *
 * TEPP became ON-by-default in KUBO-151. A synced settings event carrying
 * `featureTepp:false` authored BEFORE this instant is a stale pre-release
 * legacy value (the user never deliberately chose to turn the new default off —
 * it predates the default existing), so default-ON wins. A `featureTepp:false`
 * authored AT OR AFTER this instant is a deliberate post-release choice and must
 * be respected. See `resolveInitialTeppEnforced`.
 */
export const KUBO_151_RELEASE_EPOCH_SECONDS = Math.floor(
  Date.parse('2026-06-10T00:00:00Z') / 1000,
);

/**
 * KUBO-168 — pure decision for the ONE-TIME initialization of the family-level
 * `teppEnforced` flag on an install that predates the field (i.e. it is still
 * `undefined`). This is the single coherent initialization path: both the
 * `useTeppEnforced` adopt effect and the migration hook route through it, so
 * there are no two racing initializers.
 *
 * KUBO-151 intent is TEPP ON by default. The only thing that overrides that is a
 * DELIBERATE post-release opt-out: a synced settings event carrying
 * `featureTepp:false` whose `created_at` is at/after the KUBO-151 release epoch.
 *
 * Decision table (mirror value × event age → resulting flag):
 *
 *   mirror `true`              → ON   (explicit on; trivially honoured)
 *   mirror `false`, no event   → ON   (no synced opt-out exists; default wins)
 *   mirror `false`, pre-epoch  → ON   (stale legacy false; default-ON wins — the
 *                                       KUBO-168 fix for the legacy-user case)
 *   mirror `false`, post-epoch → OFF  (deliberate post-release choice wins)
 *
 * @param mirrorFeatureTepp  the parent-side `config.feedSettings.featureTepp` mirror.
 * @param settingsEventCreatedAt  `created_at` (Unix SECONDS) of the user's synced
 *   kind-30078 settings event, or `undefined` if none exists.
 * @param epochSeconds  the KUBO-151 release epoch in Unix seconds.
 */
export function resolveInitialTeppEnforced(
  mirrorFeatureTepp: boolean,
  settingsEventCreatedAt: number | undefined,
  epochSeconds: number,
): boolean {
  // An explicit ON mirror is honoured directly — nothing to reconcile.
  if (mirrorFeatureTepp) return true;
  // mirror is false: only a deliberate POST-release opt-out keeps us off. A
  // false authored at/after the epoch is deliberate; anything older (or no
  // event at all) is treated as the absence of a deliberate choice → default ON.
  if (
    typeof settingsEventCreatedAt === 'number' &&
    settingsEventCreatedAt >= epochSeconds
  ) {
    return false;
  }
  return true;
}

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
 * `teppEnforced` field has never been set, this initializes it exactly once via
 * `resolveInitialTeppEnforced` — the single coherent initialization path for the
 * KUBO-152 family flag, applying the KUBO-151 default-ON intent while honouring a
 * deliberate post-release opt-out (KUBO-168). `adoptTeppEnforcedFromMirror` is
 * idempotent (no-op once the field is defined) and writes through the family
 * store, which re-renders this hook with the adopted value.
 */
export function useTeppEnforced(kidPubkey?: string): boolean {
  const { family } = useKuboFamily();
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { settingsEventCreatedAt } = useEncryptedSettings();

  const target = kidPubkey ?? user?.pubkey;

  // KUBO-152/168 single initialization path: on the first render where a family
  // record exists with an unset `teppEnforced`, resolve the flag from the
  // KUBO-151 default-ON intent (mirror + synced-event age) and adopt it once.
  // `adoptTeppEnforcedFromMirror` is idempotent, so subsequent renders are no-ops.
  useEffect(() => {
    if (family && family.teppEnforced === undefined) {
      const resolved = resolveInitialTeppEnforced(
        !!config.feedSettings.featureTepp,
        settingsEventCreatedAt,
        KUBO_151_RELEASE_EPOCH_SECONDS,
      );
      void adoptTeppEnforcedFromMirror(resolved);
    }
  }, [family, config.feedSettings.featureTepp, settingsEventCreatedAt]);

  return isTeppEnforced(family, target);
}
