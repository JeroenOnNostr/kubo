import { useCallback, useSyncExternalStore } from 'react';

import { KUBO_DEFAULT_KID_PACK_ATAG } from '@/lib/helpContent';
import { secureStorage } from '@/lib/secureStorage';

/**
 * Family mapping for a single-device Kubo install: which login is the parent,
 * and the full list of kids associated with it. This is *local* state
 * (secureStorage on native, localStorage on web) — intentionally not a Nostr
 * event yet. KUBO-004 will define a guardian-list kind that replaces this.
 */
export interface KuboKid {
  pubkey: string;
  displayName: string;
}

export type KuboTrustLevel = 'extend' | 'interact' | 'view';

export interface KidSettings {
  dailyLimitMin: number;        // 15-180
  windowStart: string;           // "HH:MM"
  windowEnd: string;             // "HH:MM"
  age: number;
  viewOnly?: boolean;
  /** When true, the kid's bottom nav shows a "Blobbi" tab (Ditto's virtual pet). */
  showBlobbiTab?: boolean;
  // Per-kid post-action visibility. When undefined, the corresponding global
  // FeedSettings flag applies (so kids that predate this field inherit the
  // parent's global choices). When set, overrides the global flag for this kid.
  showReplyAction?: boolean;
  showRepostAction?: boolean;
  showReactionAction?: boolean;
  /** @deprecated KUBO-102 — favorite is now always-on for kids; no longer read. */
  showFavoriteAction?: boolean;
  showZapAction?: boolean;
  showShareAction?: boolean;
  showMoreAction?: boolean;
  // Per-kid note-tile byline visibility (NIP-05 handle + relative timestamp).
  // Same inherit-when-undefined semantics as the post-action flags above.
  showNip05?: boolean;
  showPostTimestamp?: boolean;
  // Per-kid hashtag chip-row visibility on media tiles (kind 20 photo,
  // 21/22 NIP-71 video, 34236 Divine). Inline `#…` hashtags inside kind-1
  // text content are unaffected — those stay readable as part of the prose.
  showHashtags?: boolean;
  /**
   * When true, the kid feed is scroll-capped: only the first post is
   * visible initially, and a "Next post" FAB unlocks one more post per tap.
   * Cap grows monotonically — the kid can always scroll back up, but never
   * further down than the most recently unlocked post.
   */
  nextPostButton?: boolean;
}

export interface KidFeedSources {
  /** Normalized wss:// URLs enabled as relay firehoses. */
  relays: string[];
  /** NIP-33 a-tags for enabled NIP-72 communities: `34550:<pubkey>:<d-tag>`. */
  communities: string[];
  /** NIP-33 a-tags for enabled follow packs/sets: `<kind>:<pubkey>:<d-tag>` (30000|39089). */
  packs: string[];
}

export const EMPTY_FEED_SOURCES: KidFeedSources = {
  relays: [],
  communities: [],
  packs: [],
};

export interface KuboTrustRequest {
  /** Unix-ms when the kid created the request. */
  createdAt: number;
}

export interface KuboFamily {
  parentPubkey: string;
  parentDisplayName: string;
  kids: KuboKid[];
  /** Per-kid pubkey-keyed trust assignments. Missing entry = unassigned. */
  trustAssignments?: {
    [kidPubkey: string]: {
      [targetPubkey: string]: KuboTrustLevel;
    };
  };
  /**
   * Per-kid relay-URL-keyed trust assignments for /parent/trust/places.
   * Same shape as trustAssignments but keyed by normalized relay URL
   * (wss://…/) instead of pubkey. Missing entry = unassigned. Visual-only
   * for now — does not influence routing or content selection (TEPP, future).
   */
  relayTrustAssignments?: {
    [kidPubkey: string]: {
      [relayUrl: string]: KuboTrustLevel;
    };
  };
  /**
   * Pending kid → parent requests to upgrade a creator's trust level to
   * Interact. Same shape as trustAssignments. Missing entry = no pending
   * request. Local-only for now; KUBO-013/TEPP will replace this with a
   * gift-wrapped Nostr event.
   */
  trustRequests?: {
    [kidPubkey: string]: {
      [targetPubkey: string]: KuboTrustRequest;
    };
  };
  /** Per-kid settings (time limits, age, post-action visibility). */
  kidSettings?: { [kidPubkey: string]: KidSettings };
  /**
   * Per-kid enabled feed sources for relays/communities/packs. Profiles are
   * NOT stored here — they live in the kid's kind-3 follow list. Stage-1 is
   * persist-only for these three; Stage-2 wires them into the feed aggregator.
   */
  feedSources?: { [kidPubkey: string]: KidFeedSources };
  /**
   * Unix-ms timestamp of when the parent finished (or skipped) the first-run
   * coachmark tour. Unset = tour has not run yet.
   */
  coachmarksCompletedAt?: number;
  /**
   * KUBO-152: the AUTHORITATIVE, parent-controlled TEPP enforcement flag.
   *
   * This is the single source of truth for "is TEPP enforced for the kids in
   * this family". It lives in the family record (device-local secureStorage,
   * only the parent can edit it via the EditKidSettingsPage toggle) precisely
   * BECAUSE it must NOT be authorable by a kid: `feedSettings.featureTepp` is
   * synced as the *active user's own* encrypted kind-30078, so when a kid is
   * the active account the kid's own key authors that flag — making the kid's
   * account state the master switch for its own protection (the KUBO-152
   * fail-open). `feedSettings.featureTepp` is now only a parent-UI-visible
   * MIRROR kept for sync/migration compatibility; enforcement reads THIS field
   * via `useTeppEnforced` (`src/lib/tepp-adapters/useTeppEnforced.ts`).
   *
   * Semantics: `true` → enforce; `false` → explicitly off; `undefined` → never
   * set on this device. On first run with KUBO-152 code, a family record whose
   * `teppEnforced` is still `undefined` adopts the current parent-side
   * `config.feedSettings.featureTepp` value once (see `adoptTeppEnforcedFromMirror`).
   */
  teppEnforced?: boolean;
  /**
   * TEPP integration (feedSettings.featureTepp). Unix-ms timestamp of when
   * the migration completed for this family. Unset = migration has not
   * finished yet (will run on next boot when featureTepp is on).
   */
  teppMigratedAt?: number;
  /**
   * Persisted migration plan so partial migrations resume on reload. Cleared
   * once `teppMigratedAt` is set.
   */
  teppMigrationPlan?: import('@/lib/teppMigration').TeppMigrationPlan;
  /**
   * Per-kid, per-tier event ids of the most recently published TEPP
   * permission events. Used by `useTrustAssignments.setLevel/clear` to
   * re-publish the kid's state event with the current set of public-ref
   * permissions. Without this, a new permission event is on the wire but
   * the construct's permission walk only sees old refs.
   */
  teppLatestPermissionIds?: {
    [kidPubkey: string]: {
      view?: string;
      interact?: string;
      extend?: string;
      viewRelay?: string;
      interactRelay?: string;
    };
  };
}

/**
 * Legacy single-kid shape written by earlier versions of onboarding. Detected
 * by the presence of `kidPubkey` and migrated to the array shape on read.
 */
interface LegacyKuboFamily {
  parentPubkey: string;
  parentDisplayName: string;
  kidPubkey: string;
  kidDisplayName: string;
}

const STORAGE_KEY = 'kubo:family';

function isLegacy(raw: unknown): raw is LegacyKuboFamily {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'kidPubkey' in raw &&
    typeof (raw as LegacyKuboFamily).kidPubkey === 'string'
  );
}

function migrateLegacy(legacy: LegacyKuboFamily): KuboFamily {
  return {
    parentPubkey: legacy.parentPubkey,
    parentDisplayName: legacy.parentDisplayName,
    kids: [{ pubkey: legacy.kidPubkey, displayName: legacy.kidDisplayName }],
  };
}

// ─── Module-level singleton store ─────────────────────────────────────────────
// Shared across all useKuboFamily() callers so that writes in one component
// (e.g. TrustAssignmentBar.setLevel) are immediately visible to every other
// component (e.g. TrustPeoplePage's partitioning). Follows the same
// useSyncExternalStore pattern as src/blobbi/actions/lib/item-cooldown.ts.

let family: KuboFamily | null = null;
// Guards re-execution of bootstrap(). Set to true at the top of the function
// before the first await, so concurrent subscribers don't all kick off their
// own KeyStore reads.
let hasBootstrapped = false;
// Flips to true only after bootstrap() resolves. KuboBootGate reads this to
// avoid mistaking a still-loading family for a missing family — without it
// a cold-start race redirects to /onboard/add-kid before secureStorage has
// returned, trapping users with completed onboarding (KUBO-XXX).
let bootstrapCompleted = false;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}

async function bootstrap(): Promise<void> {
  if (hasBootstrapped) return;
  hasBootstrapped = true;
  try {
    const raw = await secureStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (isLegacy(parsed)) {
          const migrated = migrateLegacy(parsed);
          await secureStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
          family = migrated;
        } else {
          family = parsed as KuboFamily;
        }
      } catch {
        family = null;
      }
    }
  } finally {
    bootstrapCompleted = true;
    notify();
  }
}

export async function readLatest(): Promise<KuboFamily | null> {
  const raw = await secureStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isLegacy(parsed) ? migrateLegacy(parsed) : (parsed as KuboFamily);
  } catch {
    return null;
  }
}

async function writeAndNotify(next: KuboFamily): Promise<void> {
  await secureStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  family = next;
  notify();
}

export async function setFamily(next: KuboFamily): Promise<void> {
  await writeAndNotify(next);
}

export async function addKid(kid: KuboKid): Promise<void> {
  const current = await readLatest();
  if (!current) {
    throw new Error('Cannot add a kid: no family record exists yet.');
  }
  const existing = current.kids.find((k) => k.pubkey === kid.pubkey);
  const kids = existing
    ? current.kids.map((k) => (k.pubkey === kid.pubkey ? kid : k))
    : [...current.kids, kid];
  // Seed the default kid-friendly Follow pack on genuinely new kids, so a
  // fresh install opens with a non-empty feed (KUBO-064). Skip if the kid
  // already has a feedSources entry — respects an explicit untoggle.
  let feedSources = current.feedSources;
  if (!existing && !feedSources?.[kid.pubkey]) {
    feedSources = {
      ...current.feedSources,
      [kid.pubkey]: { relays: [], communities: [], packs: [KUBO_DEFAULT_KID_PACK_ATAG] },
    };
  }
  // KUBO-147: the parent always belongs in the kid's trust domain at
  // `interact`. Seed it on genuinely new kids alongside the default feed
  // pack. It's a normal (removable) entry — the parent can later downgrade
  // or remove themselves; useEnsureParentTrust only backfills when missing.
  let trustAssignments = current.trustAssignments;
  if (!existing && current.parentPubkey && !trustAssignments?.[kid.pubkey]?.[current.parentPubkey]) {
    trustAssignments = {
      ...current.trustAssignments,
      [kid.pubkey]: {
        ...(current.trustAssignments?.[kid.pubkey] ?? {}),
        [current.parentPubkey]: 'interact',
      },
    };
  }
  await writeAndNotify({ ...current, kids, feedSources, trustAssignments });
}

export async function removeKid(pubkey: string): Promise<void> {
  const current = await readLatest();
  if (!current) return;
  const next: KuboFamily = {
    ...current,
    kids: current.kids.filter((k) => k.pubkey !== pubkey),
  };
  if (current.trustAssignments && pubkey in current.trustAssignments) {
    const { [pubkey]: _removedTrust, ...restTrust } = current.trustAssignments;
    next.trustAssignments = restTrust;
  }
  if (current.trustRequests && pubkey in current.trustRequests) {
    const { [pubkey]: _removedReq, ...restReq } = current.trustRequests;
    next.trustRequests = restReq;
  }
  if (current.kidSettings && pubkey in current.kidSettings) {
    const { [pubkey]: _removedKid, ...restKid } = current.kidSettings;
    next.kidSettings = restKid;
  }
  if (current.feedSources && pubkey in current.feedSources) {
    const { [pubkey]: _removedFs, ...restFs } = current.feedSources;
    next.feedSources = restFs;
  }
  await writeAndNotify(next);
}

export async function clearFamily(): Promise<void> {
  await secureStorage.removeItem(STORAGE_KEY);
  family = null;
  notify();
}

export async function setTrustLevel(
  kidPubkey: string,
  targetPubkey: string,
  level: KuboTrustLevel,
): Promise<void> {
  const current = await readLatest();
  if (!current) {
    throw new Error('Cannot set trust level: no family record exists yet.');
  }
  const assignments = current.trustAssignments ?? {};
  const kidAssignments = assignments[kidPubkey] ?? {};
  await writeAndNotify({
    ...current,
    trustAssignments: {
      ...assignments,
      [kidPubkey]: { ...kidAssignments, [targetPubkey]: level },
    },
  });
}

export async function clearTrustLevel(
  kidPubkey: string,
  targetPubkey: string,
): Promise<void> {
  const current = await readLatest();
  if (!current) return;
  const assignments = current.trustAssignments ?? {};
  const kidAssignments = assignments[kidPubkey];
  if (!kidAssignments || !(targetPubkey in kidAssignments)) return;
  const { [targetPubkey]: _removed, ...rest } = kidAssignments;
  await writeAndNotify({
    ...current,
    trustAssignments: { ...assignments, [kidPubkey]: rest },
  });
}

/**
 * Batch-assign many targets to one trust level in a SINGLE writeAndNotify.
 *
 * Used by the feed-source auto-grant flows (KUBO-147): enabling a follow pack
 * grants every member `view`-only trust. Doing that with N `setTrustLevel`
 * calls would be N disk writes (and, in useTrustAssignments, N relay
 * publishes). This collapses the localStorage side to one write.
 *
 * No-downgrade invariant: targets that ALREADY have any assignment are skipped
 * (we never reduce an existing `interact`/`extend` — or the parent — to a
 * lower tier). Returns the list of pubkeys that were genuinely newly assigned,
 * so the caller knows exactly which to fold into the published permission
 * event (and can skip the publish entirely when nothing changed).
 */
export async function setTrustLevelsBatch(
  kidPubkey: string,
  targetPubkeys: string[],
  level: KuboTrustLevel,
): Promise<string[]> {
  const current = await readLatest();
  if (!current) {
    throw new Error('Cannot set trust levels: no family record exists yet.');
  }
  const assignments = current.trustAssignments ?? {};
  const kidAssignments = assignments[kidPubkey] ?? {};
  // Only assign targets with no existing entry, deduped.
  const newlyAssigned = [
    ...new Set(targetPubkeys.filter((pk) => pk && !(pk in kidAssignments))),
  ];
  if (newlyAssigned.length === 0) return [];
  const nextKidAssignments = { ...kidAssignments };
  for (const pk of newlyAssigned) {
    nextKidAssignments[pk] = level;
  }
  await writeAndNotify({
    ...current,
    trustAssignments: { ...assignments, [kidPubkey]: nextKidAssignments },
  });
  return newlyAssigned;
}

/** Permission-id tiers tracked under `family.teppLatestPermissionIds[kid]`. */
export type TeppPermissionTier =
  | 'view'
  | 'interact'
  | 'extend'
  | 'viewRelay'
  | 'interactRelay';

/**
 * Atomically record the latest TEPP permission event id for a kid/tier.
 *
 * Reads the LATEST persisted family (via `readLatest`) and merges onto it,
 * rather than a caller-supplied closure-captured snapshot. The trust-assignment
 * flow writes `trustAssignments` first (setTrustLevel/clearTrustLevel) and then
 * records the published permission id; merging onto a stale render snapshot
 * here would clobber that just-written assignment back to its pre-write state
 * (localStorage `trustAssignments` ends up undefined → the People list shows
 * nothing and `clear`'s `previousLevel` guard then publishes no revocation).
 * Going through `readLatest` also closes the two-rapid-clicks concurrent-write
 * race that a memory-snapshot read would leave open. (KUBO-134 / KUBO-135)
 */
export async function recordTeppPermissionId(
  kidPubkey: string,
  tier: TeppPermissionTier,
  eventId: string,
): Promise<KuboFamily | null> {
  const current = await readLatest();
  if (!current) return null;
  const next: KuboFamily = {
    ...current,
    teppLatestPermissionIds: {
      ...(current.teppLatestPermissionIds ?? {}),
      [kidPubkey]: {
        ...(current.teppLatestPermissionIds?.[kidPubkey] ?? {}),
        [tier]: eventId,
      },
    },
  };
  await writeAndNotify(next);
  return next;
}

export async function setRelayTrustLevel(
  kidPubkey: string,
  relayUrl: string,
  level: KuboTrustLevel,
): Promise<void> {
  const current = await readLatest();
  if (!current) {
    throw new Error('Cannot set relay trust level: no family record exists yet.');
  }
  const assignments = current.relayTrustAssignments ?? {};
  const kidAssignments = assignments[kidPubkey] ?? {};
  await writeAndNotify({
    ...current,
    relayTrustAssignments: {
      ...assignments,
      [kidPubkey]: { ...kidAssignments, [relayUrl]: level },
    },
  });
}

export async function clearRelayTrustLevel(
  kidPubkey: string,
  relayUrl: string,
): Promise<void> {
  const current = await readLatest();
  if (!current) return;
  const assignments = current.relayTrustAssignments ?? {};
  const kidAssignments = assignments[kidPubkey];
  if (!kidAssignments || !(relayUrl in kidAssignments)) return;
  const { [relayUrl]: _removed, ...rest } = kidAssignments;
  await writeAndNotify({
    ...current,
    relayTrustAssignments: { ...assignments, [kidPubkey]: rest },
  });
}

// ─── Trust requests (kid → parent) ───────────────────────────────────────────

export async function addTrustRequest(
  kidPubkey: string,
  targetPubkey: string,
): Promise<void> {
  const current = await readLatest();
  if (!current) {
    throw new Error('Cannot create trust request: no family record exists yet.');
  }
  const requests = current.trustRequests ?? {};
  const kidRequests = requests[kidPubkey] ?? {};
  // Idempotent: re-tapping the kid button shouldn't bump createdAt.
  if (targetPubkey in kidRequests) return;
  await writeAndNotify({
    ...current,
    trustRequests: {
      ...requests,
      [kidPubkey]: { ...kidRequests, [targetPubkey]: { createdAt: Date.now() } },
    },
  });
}

export async function clearTrustRequest(
  kidPubkey: string,
  targetPubkey: string,
): Promise<void> {
  const current = await readLatest();
  if (!current) return;
  const requests = current.trustRequests ?? {};
  const kidRequests = requests[kidPubkey];
  if (!kidRequests || !(targetPubkey in kidRequests)) return;
  const { [targetPubkey]: _removed, ...rest } = kidRequests;
  await writeAndNotify({
    ...current,
    trustRequests: { ...requests, [kidPubkey]: rest },
  });
}

/**
 * Atomic approval: clears the request AND sets trustAssignments[kid][target]
 * to 'interact' in a single writeAndNotify so subscribers see one consistent
 * transition (no flicker where the row is briefly neither pending nor
 * assigned).
 */
export async function approveTrustRequest(
  kidPubkey: string,
  targetPubkey: string,
): Promise<void> {
  const current = await readLatest();
  if (!current) {
    throw new Error('Cannot approve trust request: no family record exists yet.');
  }
  const assignments = current.trustAssignments ?? {};
  const kidAssignments = assignments[kidPubkey] ?? {};
  const requests = current.trustRequests ?? {};
  const kidRequests = requests[kidPubkey] ?? {};
  const { [targetPubkey]: _removed, ...restRequests } = kidRequests;
  await writeAndNotify({
    ...current,
    trustAssignments: {
      ...assignments,
      [kidPubkey]: { ...kidAssignments, [targetPubkey]: 'interact' },
    },
    trustRequests: { ...requests, [kidPubkey]: restRequests },
  });
}

// ─── TEPP enforcement flag (KUBO-152) ────────────────────────────────────────

/**
 * Set the authoritative, parent-controlled TEPP enforcement flag on the family
 * record. Written by the EditKidSettingsPage toggle. This is the single source
 * of truth consumed by `useTeppEnforced`; `feedSettings.featureTepp` is only a
 * mirror for parent-UI/sync compatibility.
 */
export async function setTeppEnforced(enforced: boolean): Promise<void> {
  const current = await readLatest();
  if (!current) {
    throw new Error('Cannot set TEPP enforcement: no family record exists yet.');
  }
  if (current.teppEnforced === enforced) return; // no-op write
  await writeAndNotify({ ...current, teppEnforced: enforced });
}

/**
 * KUBO-152 one-time migration: existing installs only carried the flag in
 * `feedSettings.featureTepp`. On first run with the new code, a family record
 * whose `teppEnforced` is still `undefined` adopts the current parent-side
 * mirror value exactly once, so enforcement doesn't silently flip when the
 * authoritative field moves into the family record.
 *
 * Idempotent: once `teppEnforced` is defined (even `false`), this is a no-op.
 * Returns the (possibly unchanged) family.
 */
export async function adoptTeppEnforcedFromMirror(
  mirrorFeatureTepp: boolean,
): Promise<KuboFamily | null> {
  const current = await readLatest();
  if (!current) return null;
  if (current.teppEnforced !== undefined) return current; // already migrated
  const next: KuboFamily = { ...current, teppEnforced: mirrorFeatureTepp };
  await writeAndNotify(next);
  return next;
}

// ─── Coachmark tour completion ───────────────────────────────────────────────

export async function markCoachmarksComplete(): Promise<void> {
  const current = await readLatest();
  if (!current) return;
  if (current.coachmarksCompletedAt) return;
  await writeAndNotify({ ...current, coachmarksCompletedAt: Date.now() });
}

// ─── Kid settings ────────────────────────────────────────────────────────────

export const DEFAULT_KID_SETTINGS: KidSettings = {
  dailyLimitMin: 60,
  windowStart: '08:00',
  windowEnd: '21:00',
  age: 6,
  // Safe-by-default parental posture: on a fresh install a kid can see their
  // feed but can't tap into threads, comment, repost, react, zap, share, or
  // open the more menu. Blobbi tab and tap-to-advance (next-post) are on so
  // the kid has something interactive that isn't infinite scroll. Parents opt
  // in to more interactivity per-kid on /parent/kid-settings.
  viewOnly: true,
  showBlobbiTab: true,
  showReplyAction: false,
  showRepostAction: false,
  showReactionAction: false,
  // @deprecated KUBO-102 — favorite is now unconditionally on for kids (the
  // star is a private NIP-44 list, exempt from the TEPP interact-gate). This
  // field is no longer read by useActionVisibility; kept true for back-compat.
  showFavoriteAction: true,
  showZapAction: false,
  showShareAction: false,
  showMoreAction: false,
  showNip05: false,
  showPostTimestamp: false,
  showHashtags: false,
  nextPostButton: true,
};

export async function setKidSettings(
  kidPubkey: string,
  settings: KidSettings,
): Promise<void> {
  const current = await readLatest();
  if (!current) {
    throw new Error('Cannot set kid settings: no family record exists yet.');
  }
  await writeAndNotify({
    ...current,
    kidSettings: { ...current.kidSettings, [kidPubkey]: settings },
  });
}

export function getKidSettings(kidPubkey: string): KidSettings {
  return family?.kidSettings?.[kidPubkey] ?? DEFAULT_KID_SETTINGS;
}

// ─── Feed sources ────────────────────────────────────────────────────────────

async function mutateFeedSources(
  kidPubkey: string,
  mutate: (current: KidFeedSources) => KidFeedSources,
): Promise<void> {
  const current = await readLatest();
  if (!current) {
    throw new Error('Cannot update feed sources: no family record exists yet.');
  }
  const existing = current.feedSources?.[kidPubkey] ?? EMPTY_FEED_SOURCES;
  const next = mutate(existing);
  // Skip the disk write + notify if nothing actually changed. Toggles on the
  // same source are common and the equality check keeps the re-render budget
  // tight (per M4 plan goal of not invalidating unrelated consumers).
  if (
    next.relays === existing.relays &&
    next.communities === existing.communities &&
    next.packs === existing.packs
  ) {
    return;
  }
  await writeAndNotify({
    ...current,
    feedSources: { ...current.feedSources, [kidPubkey]: next },
  });
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export async function toggleFeedRelay(
  kidPubkey: string,
  url: string,
): Promise<void> {
  await mutateFeedSources(kidPubkey, (fs) => ({
    ...fs,
    relays: toggleInList(fs.relays, url),
  }));
}

export async function toggleFeedCommunity(
  kidPubkey: string,
  atag: string,
): Promise<void> {
  await mutateFeedSources(kidPubkey, (fs) => ({
    ...fs,
    communities: toggleInList(fs.communities, atag),
  }));
}

export async function toggleFeedPack(
  kidPubkey: string,
  atag: string,
): Promise<void> {
  await mutateFeedSources(kidPubkey, (fs) => ({
    ...fs,
    packs: toggleInList(fs.packs, atag),
  }));
}

export function getFeedSources(kidPubkey: string): KidFeedSources {
  return family?.feedSources?.[kidPubkey] ?? EMPTY_FEED_SOURCES;
}

// ─── React binding ────────────────────────────────────────────────────────────

function subscribe(onStoreChange: () => void): () => void {
  // Kick off bootstrap on the first subscriber. Cheap: `hasBootstrapped` guards
  // against repeated execution.
  void bootstrap();
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
}

function getSnapshot(): KuboFamily | null {
  return family;
}

function getBootstrappedSnapshot(): boolean {
  return bootstrapCompleted;
}

// Exported bindings so per-slice hooks (e.g. useKidFeedSources) can subscribe
// to the same underlying store without duplicating its module-level state.
export const subscribeFamily = subscribe;
export const getFamilySnapshot = getSnapshot;

export function useKuboFamily() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isBootstrapped = useSyncExternalStore(
    subscribe,
    getBootstrappedSnapshot,
    getBootstrappedSnapshot,
  );

  // Stable async wrappers — identity doesn't change between renders, so
  // consumers that use these as useEffect dependencies don't thrash.
  const setFamilyCb = useCallback(setFamily, []);
  const addKidCb = useCallback(addKid, []);
  const removeKidCb = useCallback(removeKid, []);
  const clearFamilyCb = useCallback(clearFamily, []);
  const setTrustLevelCb = useCallback(setTrustLevel, []);
  const setTrustLevelsBatchCb = useCallback(setTrustLevelsBatch, []);
  const clearTrustLevelCb = useCallback(clearTrustLevel, []);
  const setRelayTrustLevelCb = useCallback(setRelayTrustLevel, []);
  const clearRelayTrustLevelCb = useCallback(clearRelayTrustLevel, []);
  const addTrustRequestCb = useCallback(addTrustRequest, []);
  const clearTrustRequestCb = useCallback(clearTrustRequest, []);
  const approveTrustRequestCb = useCallback(approveTrustRequest, []);
  const setKidSettingsCb = useCallback(setKidSettings, []);
  const setTeppEnforcedCb = useCallback(setTeppEnforced, []);
  const markCoachmarksCompleteCb = useCallback(markCoachmarksComplete, []);

  return {
    family: current,
    isBootstrapped,
    setFamily: setFamilyCb,
    addKid: addKidCb,
    removeKid: removeKidCb,
    clearFamily: clearFamilyCb,
    setTrustLevel: setTrustLevelCb,
    setTrustLevelsBatch: setTrustLevelsBatchCb,
    clearTrustLevel: clearTrustLevelCb,
    setRelayTrustLevel: setRelayTrustLevelCb,
    clearRelayTrustLevel: clearRelayTrustLevelCb,
    addTrustRequest: addTrustRequestCb,
    clearTrustRequest: clearTrustRequestCb,
    approveTrustRequest: approveTrustRequestCb,
    setKidSettings: setKidSettingsCb,
    setTeppEnforced: setTeppEnforcedCb,
    markCoachmarksComplete: markCoachmarksCompleteCb,
  };
}
