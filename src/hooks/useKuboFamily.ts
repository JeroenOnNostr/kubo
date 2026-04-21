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

export type KuboModeration = 'low' | 'mid' | 'high';

export interface KidSettings {
  dailyLimitMin: number;        // 15-180
  windowStart: string;           // "HH:MM"
  windowEnd: string;             // "HH:MM"
  age: number;
  moderation: KuboModeration;
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
  /** Per-kid settings (time limits, moderation, age). */
  kidSettings?: { [kidPubkey: string]: KidSettings };
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
  await writeAndNotify({
    ...current,
    kids: current.kids.filter((k) => k.pubkey !== pubkey),
  });
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
  moderation: 'mid',
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
