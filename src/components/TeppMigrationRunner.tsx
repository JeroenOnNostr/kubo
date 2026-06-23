import { useTeppMigration } from '@/hooks/useTeppMigration';

/**
 * Mounted once inside the Nostr provider tree to drive the TEPP migration.
 * Renders nothing.
 *
 *  - `useTeppMigration` (Phase 6): TEPP is a core, non-optional protection
 *    (KUBO-209), so for every family with kids this converts on-device trust
 *    assignments into published TEPP events (association/state/permission),
 *    resumable across boots. There is no enable flag and therefore no
 *    default-on mirror migration to run.
 */
export function TeppMigrationRunner(): null {
  useTeppMigration();
  return null;
}
