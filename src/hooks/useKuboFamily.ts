import { useCallback, useEffect, useState } from 'react';

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

export interface KuboFamily {
  parentPubkey: string;
  parentDisplayName: string;
  kids: KuboKid[];
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

export function useKuboFamily() {
  const [family, setFamilyState] = useState<KuboFamily | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    secureStorage.getItem(STORAGE_KEY).then(async (raw) => {
      if (cancelled) return;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (isLegacy(parsed)) {
            const migrated = migrateLegacy(parsed);
            await secureStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
            if (!cancelled) setFamilyState(migrated);
          } else {
            setFamilyState(parsed as KuboFamily);
          }
        } catch {
          setFamilyState(null);
        }
      }
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const setFamily = useCallback(async (next: KuboFamily) => {
    await secureStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setFamilyState(next);
  }, []);

  // Read the latest family record from storage, falling back to a migration
  // step for legacy single-kid records. Used by mutators that need the
  // ground-truth state regardless of where React's `family` state currently
  // sits (it may still be null during the initial load effect, or the hook
  // instance in the calling component may be behind a separate instance that
  // just wrote).
  const readLatest = useCallback(async (): Promise<KuboFamily | null> => {
    const raw = await secureStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return isLegacy(parsed) ? migrateLegacy(parsed) : (parsed as KuboFamily);
    } catch {
      return null;
    }
  }, []);

  const addKid = useCallback(async (kid: KuboKid) => {
    const current = await readLatest();
    if (!current) {
      throw new Error('Cannot add a kid: no family record exists yet.');
    }
    const existing = current.kids.find((k) => k.pubkey === kid.pubkey);
    const kids = existing
      ? current.kids.map((k) => (k.pubkey === kid.pubkey ? kid : k))
      : [...current.kids, kid];
    const next: KuboFamily = { ...current, kids };
    await secureStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setFamilyState(next);
  }, [readLatest]);

  const removeKid = useCallback(async (pubkey: string) => {
    const current = await readLatest();
    if (!current) return;
    const next: KuboFamily = {
      ...current,
      kids: current.kids.filter((k) => k.pubkey !== pubkey),
    };
    await secureStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setFamilyState(next);
  }, [readLatest]);

  const clearFamily = useCallback(async () => {
    await secureStorage.removeItem(STORAGE_KEY);
    setFamilyState(null);
  }, []);

  return { family, isLoading, setFamily, addKid, removeKid, clearFamily };
}
