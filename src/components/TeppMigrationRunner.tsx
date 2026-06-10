import { useTeppMigration } from '@/hooks/useTeppMigration';
import { useTeppDefaultOnMigration } from '@/hooks/useTeppDefaultOnMigration';

/**
 * Mounted once inside the Nostr provider tree to drive TEPP migrations.
 * Renders nothing. Drives two one-shot, idempotent migrations:
 *
 *  - `useTeppDefaultOnMigration` (KUBO-151 default-ON; KUBO-152/168 reshape):
 *    enforcement now lives in the family flag (`family.teppEnforced`, initialized
 *    once by `useTeppEnforced`). This hook's only remaining job is to mirror
 *    `featureTepp:true` into the PARENT's synced settings once, so the parent UI
 *    and cross-device sync agree with the default-ON family flag — no per-account
 *    flip loop and no within-boot retry hot-loop.
 *  - `useTeppMigration` (Phase 6): once `featureTepp` is on and a family with
 *    kids exists, converts on-device trust assignments into published TEPP
 *    events (association/state/permission), resumable across boots.
 */
export function TeppMigrationRunner(): null {
  useTeppDefaultOnMigration();
  useTeppMigration();
  return null;
}
