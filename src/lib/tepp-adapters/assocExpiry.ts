/**
 * Single source of truth for the kid TEPP association event (kind 17700)
 * lifetime. Both publish sites — the first-boot migration
 * (`src/lib/teppMigration.ts`) and the renewal/rotate hook
 * (`useKuboTeppPublishAssociation` in `src/hooks/useKuboTeppPublish.ts`) —
 * import from here so the TTL and renewal window can never drift apart.
 *
 * **Why an expiration at all?** TEPP's vendored parser treats the NIP-40
 * `expiration` tag as *required* on kind 17700 (`parse.ts` flags a missing
 * tag as a parse problem). So the association must carry one. The number,
 * though, is a Kubo product decision: in our parental model a parent's
 * guardianship over their own kid lasts until the parent *actively* changes
 * it (removes the kid, rotates keys, revokes trust), NOT on a rolling clock.
 *
 * So the TTL is a **backstop**, not the primary lifetime mechanism:
 *  - A long TTL (1 year) means an active family's association is governed by
 *    active rotation (`useEnsureKidAssociation` republishes well before
 *    expiry on any session where the kid is the active signer), not the clock.
 *  - The TTL only ever fires for a genuinely abandoned install (kid never
 *    opens the app for over a year), which is the one case where letting a
 *    stale guardianship lapse is the correct behaviour.
 *
 * Mirrors the 1-year horizon already used by the zapstore identity proof
 * (see `docs/zapstore-publish.md`).
 *
 * KUBO-149. **Revisit this 365-day value after colleague feedback** — see
 * the TODO entry. If the consensus is "no expiry," the cleaner path is to
 * patch the vendored parser to treat a missing tag as "no expiry" rather
 * than dropping the tag and eating a permanent spec-warning.
 */

const DAY_SECONDS = 24 * 60 * 60;

/** Association TTL: 1 year. A backstop, not the primary lifetime mechanism. */
export const ASSOC_TTL_SECONDS = 365 * DAY_SECONDS;

/**
 * Renew when fewer than this many seconds remain before expiry (60 days), so
 * an active kid's association is refreshed long before the TTL backstop fires.
 */
export const ASSOC_RENEWAL_WINDOW_SECONDS = 60 * DAY_SECONDS;

/** Absolute unix-seconds expiration for a freshly published association. */
export function assocExpirationAt(nowSeconds: number): number {
  return nowSeconds + ASSOC_TTL_SECONDS;
}

/**
 * Should the kid's association be (re)published? True when there is no current
 * valid association at all (missing/expired), or when the current one is
 * within the renewal window of its expiry.
 *
 * @param currentExpiration unix-seconds expiration of the current valid
 *   association, or `null`/`undefined` when there is none (missing or expired).
 * @param nowSeconds current unix seconds.
 */
export function shouldRenewAssociation(
  currentExpiration: number | null | undefined,
  nowSeconds: number,
): boolean {
  if (currentExpiration == null || Number.isNaN(currentExpiration)) return true;
  return currentExpiration - nowSeconds < ASSOC_RENEWAL_WINDOW_SECONDS;
}
