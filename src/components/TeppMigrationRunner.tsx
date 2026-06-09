import { useTeppMigration } from '@/hooks/useTeppMigration';

/**
 * Mounted once inside the Nostr provider tree to drive Phase-6 TEPP
 * migration. Renders nothing — its sole job is to call `useTeppMigration()`,
 * which triggers a one-shot, idempotent, resumable migration when
 * `featureTepp` is on, the family record exists, and migration hasn't
 * completed yet.
 */
export function TeppMigrationRunner(): null {
  useTeppMigration();
  return null;
}
