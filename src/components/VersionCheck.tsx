/**
 * VersionCheck — DISABLED in Kubo (KUBO-193).
 *
 * Upstream Ditto showed a "What's new in v{version}" toast on every version bump, with a
 * "See all" action linking to the /changelog route. In Kubo that route still renders upstream
 * Ditto release notes and links out to gitlab.com/soapbox-pub/ditto, so the popup was acting as
 * an escape hatch out of the Kubo-branded experience.
 *
 * The component is unmounted from AppRouter; this no-op stub remains so the import site (if any
 * is reintroduced) and the /changelog route's history stay greppable. It renders nothing and
 * performs no side effects. Do NOT re-enable without first rebranding ChangelogPage off Ditto.
 */
export function VersionCheck() {
  return null;
}
