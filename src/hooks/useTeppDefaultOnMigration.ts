import { useEffect, useRef } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFeedSettings } from '@/hooks/useFeedSettings';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import {
  resolveInitialTeppEnforced,
  KUBO_151_RELEASE_EPOCH_SECONDS,
} from '@/lib/tepp-adapters/useTeppEnforced';

/**
 * One-time migration that keeps the PARENT account's synced `featureTepp` mirror
 * consistent with the KUBO-151 "TEPP on by default" intent.
 *
 * **Post-KUBO-152 shape.** KUBO-152 moved the AUTHORITATIVE enforcement flag out
 * of the kid-writable, per-account `feedSettings.featureTepp` and into the
 * parent-controlled, device-local family record (`family.teppEnforced`, consumed
 * by `useTeppEnforced`). That flag is initialized exactly once by the single
 * coherent path in `useTeppEnforced` (`adoptTeppEnforcedFromMirror` ←
 * `resolveInitialTeppEnforced`). So enforcement no longer depends on this
 * migration at all.
 *
 * This hook therefore no longer does the old per-account `featureTepp` flip loop
 * that caused the KUBO-168 oscillation (per-device guard vs per-account synced
 * settings → only the active login got flipped, others re-applied `false` on
 * every account switch). Instead its ONLY remaining job is to write
 * `featureTepp:true` into the PARENT's synced settings once, so the parent UI and
 * cross-device sync agree with the (default-ON) family flag. It never writes the
 * mirror for a kid account (a kid's synced `featureTepp` is irrelevant to
 * enforcement and must not be authored by us), and it never re-flips a deliberate
 * post-KUBO-151 opt-out.
 *
 * **Guard.** Keyed on the family flag itself: the presence of
 * `family.teppEnforced !== undefined` (set by `useTeppEnforced`) is the real
 * guard, and the mirror write is skipped once the parent's synced mirror already
 * agrees. There is no per-device localStorage flag any more (the old
 * `kubo:tepp-default-on-migrated` flag is obsolete; legacy installs that still
 * have it set are simply ignored — its presence no longer changes behaviour).
 *
 * **No hot-loop.** A failed synced write leaves `ranRef.current = true`, so it is
 * NOT retried within the same boot; the family-flag guard plus a fresh mount on
 * the next boot give the next-launch retry the old code promised.
 */
/** Inputs for the pure parent-mirror gating decision (KUBO-168). */
export interface MirrorDecisionInput {
  /** Active user's pubkey, or undefined when not signed in / no NIP-44. */
  activePubkey: string | undefined;
  /** Family's parent pubkey, or undefined when no family record. */
  parentPubkey: string | undefined;
  /** The current `config.feedSettings.featureTepp` mirror. */
  mirrorFeatureTepp: boolean;
  /** `created_at` (Unix s) of the user's synced settings event, if any. */
  settingsEventCreatedAt: number | undefined;
}

/**
 * Pure decision: should the migration write `featureTepp:true` into the PARENT's
 * synced settings? React-free and unit-testable (repo pure-helper pattern).
 *
 * Returns `true` only when ALL hold:
 *   - the active account IS the family parent (never mirror for a kid),
 *   - the KUBO-151 resolved decision is ON (no deliberate post-epoch opt-out),
 *   - the mirror isn't already `true` (idempotent — no churn once consistent).
 */
export function shouldMirrorTeppOn(input: MirrorDecisionInput): boolean {
  const { activePubkey, parentPubkey, mirrorFeatureTepp, settingsEventCreatedAt } = input;
  if (!activePubkey || !parentPubkey) return false;
  if (activePubkey !== parentPubkey) return false; // parent-only
  if (mirrorFeatureTepp === true) return false; // already consistent
  return resolveInitialTeppEnforced(
    mirrorFeatureTepp,
    settingsEventCreatedAt,
    KUBO_151_RELEASE_EPOCH_SECONDS,
  );
}

export function useTeppDefaultOnMigration(): void {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { family } = useKuboFamily();
  const { feedSettings, updateFeedSettings } = useFeedSettings();
  const {
    updateSettings: updateEncryptedSettings,
    settingsEventCreatedAt,
  } = useEncryptedSettings();

  // Latch so the async run fires at most once per mount. On failure it STAYS
  // true (no within-boot retry → no hot-loop); a fresh mount next boot retries.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;

    // Need a signed-in user with NIP-44 — featureTepp lives in the encrypted
    // kind-30078 event and there's no plaintext fallback. Wait for it.
    if (!user?.signer.nip44) return;

    // Pure gate: parent-only, default-ON resolved, and not already consistent.
    // Returning early WITHOUT latching ranRef lets the effect re-run when its
    // inputs resolve (e.g. family or settings load after first render); it only
    // latches once it has decided to act (below), so there's no per-render churn
    // and, crucially, no hot-loop on write failure.
    if (
      !shouldMirrorTeppOn({
        activePubkey: user.pubkey,
        parentPubkey: family?.parentPubkey,
        mirrorFeatureTepp: !!config.feedSettings.featureTepp,
        settingsEventCreatedAt,
      })
    ) {
      return;
    }

    ranRef.current = true;

    const run = async () => {
      // Local config first so the running session reflects it immediately,
      // mirroring the EditKidSettingsPage toggle's dual-write.
      updateFeedSettings({ featureTepp: true });

      try {
        await updateEncryptedSettings.mutateAsync({
          feedSettings: { ...feedSettings, featureTepp: true },
        });
      } catch (err) {
        // No within-boot retry (ranRef stays true → no hot-loop). The local
        // config flip above still takes effect this session, and a fresh mount
        // on the next boot will retry the synced write.
        console.warn('TEPP default-on mirror: synced write failed, will retry next boot', err);
      }
    };

    void run();
  }, [
    user,
    family,
    config.feedSettings.featureTepp,
    settingsEventCreatedAt,
    feedSettings,
    updateFeedSettings,
    updateEncryptedSettings,
  ]);
}
