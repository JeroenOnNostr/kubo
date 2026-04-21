import { useFeed } from './useFeed';

/**
 * Shared feed driver for the kid home screen (`/kid`) and the parent feed
 * preview (`/parent/feed`).
 *
 * Thin pass-through to Ditto's `useFeed('follows')` — no kind or tag
 * overrides. `useFeed` internally reads `feedSettings` via
 * `getEnabledFeedKinds`, so the parent's "Edit Feed Settings" toggles on
 * `/parent/kid/:id/feed-settings` drive exactly what the kid sees.
 *
 * Intentionally a wrapper (not an inline call at each page) so later Kubo
 * additions — e.g. web-of-trust author filtering, relay-group selection —
 * land in one place. No forks of Ditto behavior.
 */
export function useKidFeed() {
  return useFeed('follows');
}
