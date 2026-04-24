import { useCallback, useSyncExternalStore } from 'react';

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
  // Per-kid post-action visibility. When undefined, the corresponding global
  // FeedSettings flag applies (so kids that predate this field inherit the
  // parent's global choices). When set, overrides the global flag for this kid.
  showReplyAction?: boolean;
  showRepostAction?: boolean;
  showReactionAction?: boolean;
  showZapAction?: boolean;
  showShareAction?: boolean;
  showMoreAction?: boolean;
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
  /** Per-kid settings (time limits, age, post-action visibility). */
  kidSettings?: { [kidPubkey: string]: KidSettings };
  /**
   * Per-kid enabled feed sources for relays/communities/packs. Profiles are
   * NOT stored here — they live in the kid's kind-3 follow list. Stage-1 is
   * persist-only for these three; Stage-2 wires them into the feed aggregator.
   */
  feedSources?: { [kidPubkey: string]: KidFeedSources };
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
let hasBootstrapped = false;
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
    notify();
  }
}

async function readLatest(): Promise<KuboFamily | null> {
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
  await writeAndNotify({ ...current, kids });
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

// ─── Kid settings ────────────────────────────────────────────────────────────

export const DEFAULT_KID_SETTINGS: KidSettings = {
  dailyLimitMin: 45,
  windowStart: '16:00',
  windowEnd: '19:00',
  age: 6,
  // Safe-by-default parental posture: on a fresh install a kid can see their
  // feed but can't tap into threads, comment, repost, react, zap, share, or
  // open the more menu. Parents opt in to more interactivity per-kid on
  // /parent/kid-settings.
  viewOnly: true,
  showReplyAction: false,
  showRepostAction: false,
  showReactionAction: false,
  showZapAction: false,
  showShareAction: false,
  showMoreAction: false,
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

// Exported bindings so per-slice hooks (e.g. useKidFeedSources) can subscribe
// to the same underlying store without duplicating its module-level state.
export const subscribeFamily = subscribe;
export const getFamilySnapshot = getSnapshot;

export function useKuboFamily() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Stable async wrappers — identity doesn't change between renders, so
  // consumers that use these as useEffect dependencies don't thrash.
  const setFamilyCb = useCallback(setFamily, []);
  const addKidCb = useCallback(addKid, []);
  const removeKidCb = useCallback(removeKid, []);
  const clearFamilyCb = useCallback(clearFamily, []);
  const setTrustLevelCb = useCallback(setTrustLevel, []);
  const clearTrustLevelCb = useCallback(clearTrustLevel, []);
  const setKidSettingsCb = useCallback(setKidSettings, []);

  return {
    family: current,
    setFamily: setFamilyCb,
    addKid: addKidCb,
    removeKid: removeKidCb,
    clearFamily: clearFamilyCb,
    setTrustLevel: setTrustLevelCb,
    clearTrustLevel: clearTrustLevelCb,
    setKidSettings: setKidSettingsCb,
  };
}
