import { useCallback } from 'react';

import { type KuboTrustLevel, useKuboFamily } from './useKuboFamily';

export interface TrustAssignmentsApi {
  get: (targetPubkey: string) => KuboTrustLevel | undefined;
  setLevel: (targetPubkey: string, level: KuboTrustLevel) => Promise<void>;
  clear: (targetPubkey: string) => Promise<void>;
}

/**
 * Scoped read/write view of trust assignments for a single kid. Thin wrapper
 * over `useKuboFamily` — callers pass the kid pubkey once and don't have to
 * re-thread it through every read/write.
 *
 * When `kidPubkey` is undefined, `get` always returns undefined and the
 * mutators throw. Callers should guard on `useSelectedKid()` first.
 */
export function useTrustAssignments(kidPubkey: string | undefined): TrustAssignmentsApi {
  const { family, setTrustLevel, clearTrustLevel } = useKuboFamily();

  const kidAssignments =
    kidPubkey && family?.trustAssignments
      ? family.trustAssignments[kidPubkey]
      : undefined;

  const get = useCallback(
    (targetPubkey: string): KuboTrustLevel | undefined => {
      return kidAssignments?.[targetPubkey];
    },
    [kidAssignments],
  );

  const setLevel = useCallback(
    async (targetPubkey: string, level: KuboTrustLevel) => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      await setTrustLevel(kidPubkey, targetPubkey, level);
    },
    [kidPubkey, setTrustLevel],
  );

  const clear = useCallback(
    async (targetPubkey: string) => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      await clearTrustLevel(kidPubkey, targetPubkey);
    },
    [kidPubkey, clearTrustLevel],
  );

  return { get, setLevel, clear };
}
