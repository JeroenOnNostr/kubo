import { useTeppMigration } from '@/hooks/useTeppMigration';
import { useTeppDefaultOnMigration } from '@/hooks/useTeppDefaultOnMigration';

/**
 * Mounted once inside the Nostr provider tree to drive TEPP migrations.
 * Renders nothing. Drives two one-shot, idempotent migrations:
 *
 *  - `useTeppDefaultOnMigration` (KUBO-150): turns `featureTepp` ON once for
 *    installs that predate TEPP-on-by-default, writing the flag into the
 *    user's synced settings so a Zapstore update can't have NostrSync re-apply
 *    a stale `false`.
 *  - `useTeppMigration` (Phase 6): once `featureTepp` is on and a family with
 *    kids exists, converts on-device trust assignments into published TEPP
 *    events (association/state/permission), resumable across boots.
 */
export function TeppMigrationRunner(): null {
  useTeppDefaultOnMigration();
  useTeppMigration();
  return null;
}
