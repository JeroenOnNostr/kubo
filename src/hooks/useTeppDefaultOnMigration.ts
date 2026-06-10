import { useEffect, useRef } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFeedSettings } from '@/hooks/useFeedSettings';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';

/**
 * One-time migration that turns `featureTepp` ON for installs that predate
 * TEPP-on-by-default (KUBO-150).
 *
 * **Why this exists.** Setting `featureTepp: true` in kubo.json only changes
 * the build-time default, which the merge order
 * `{ ...hardcoded, ...kubo.json, ...localStorage }` plus NostrSync overrides
 * for any user who already published encrypted settings (kind 30078) carrying
 * `featureTepp: false`. On a Zapstore update such a user would have their
 * synced `false` re-applied over the new default and TEPP would stay off —
 * exactly the hazard KUBO-144 flagged ("a kubo.json default that disagrees
 * with synced kind-30078 settings"). The fix is not to fight the sync: instead
 * we write `featureTepp: true` INTO the user's synced settings once, so the
 * synced snapshot and the build default agree and there is nothing to oscillate.
 *
 * **Idempotency.** Guarded by a versioned localStorage flag. It fires exactly
 * once per install. After it runs, the in-app toggle in EditKidSettingsPage
 * remains fully authoritative — a parent who later turns TEPP off keeps it off,
 * because this migration never runs a second time.
 *
 * **Fresh installs** don't need the synced write (kubo.json already defaults
 * true and onboarding bakes that into the first published settings), but
 * running here is harmless and idempotent: it flips an already-true flag and
 * sets the guard.
 */

const MIGRATION_FLAG = 'kubo:tepp-default-on-migrated';

function alreadyMigrated(): boolean {
  try {
    return localStorage.getItem(MIGRATION_FLAG) === '1';
  } catch {
    // localStorage unavailable — treat as migrated so we never loop.
    return true;
  }
}

function markMigrated(): void {
  try {
    localStorage.setItem(MIGRATION_FLAG, '1');
  } catch {
    // ignore — worst case the migration retries next boot, still idempotent.
  }
}

export function useTeppDefaultOnMigration(): void {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { feedSettings, updateFeedSettings } = useFeedSettings();
  const { updateSettings: updateEncryptedSettings } = useEncryptedSettings();

  // Latch so the async run fires at most once per mount even before the
  // localStorage flag is set (the flag is the cross-session guard; this ref is
  // the within-session guard against React 18 effect double-invoke / churn).
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    if (alreadyMigrated()) return;

    // Wait for a signed-in user with NIP-44 before writing synced settings —
    // featureTepp lives in the encrypted kind-30078 event and there's no
    // plaintext fallback. Until then, do nothing and let the effect re-run when
    // `user` resolves. (Fresh local config still defaults from kubo.json.)
    if (!user?.signer.nip44) return;

    ranRef.current = true;

    const run = async () => {
      // Local config first so the running session reflects it immediately,
      // mirroring the EditKidSettingsPage toggle's dual-write.
      if (config.feedSettings.featureTepp !== true) {
        updateFeedSettings({ featureTepp: true });
      }

      try {
        await updateEncryptedSettings.mutateAsync({
          feedSettings: { ...feedSettings, featureTepp: true },
        });
        // Only mark migrated once the synced write succeeded, so a transient
        // publish failure retries on next boot instead of silently leaving the
        // synced snapshot at `false`.
        markMigrated();
      } catch (err) {
        // Leave the flag unset → retry next launch. The local config flip above
        // still takes effect this session.
        console.warn('TEPP default-on migration: synced write failed, will retry', err);
        ranRef.current = false;
      }
    };

    void run();
  }, [user, config.feedSettings.featureTepp, feedSettings, updateFeedSettings, updateEncryptedSettings]);
}
