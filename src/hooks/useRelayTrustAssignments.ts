import { useCallback, useMemo } from 'react';

import { type KuboTrustLevel, useKuboFamily } from './useKuboFamily';
import { normalizeRelayUrl } from '@/lib/relayUrl';

export interface RelayTrustAssignmentsApi {
  get: (relayUrl: string) => KuboTrustLevel | undefined;
  setLevel: (relayUrl: string, level: KuboTrustLevel) => Promise<void>;
  clear: (relayUrl: string) => Promise<void>;
  /** All assigned URLs for this kid, for list/page rendering. */
  assigned: { [relayUrl: string]: KuboTrustLevel };
}

/**
 * Scoped read/write view of relay trust assignments for a single kid.
 * Mirrors useTrustAssignments but keys by normalized relay URL (wss://…/)
 * instead of pubkey. Visual-only assignment — does not influence routing
 * or content selection (TEPP, future).
 *
 * When `kidPubkey` is undefined, `get` returns undefined, `assigned` is
 * empty, and the mutators throw. Callers should guard on useSelectedKid().
 */
export function useRelayTrustAssignments(
  kidPubkey: string | undefined,
): RelayTrustAssignmentsApi {
  const { family, setRelayTrustLevel, clearRelayTrustLevel } = useKuboFamily();

  const assigned = useMemo(() => {
    if (!kidPubkey) return {};
    return family?.relayTrustAssignments?.[kidPubkey] ?? {};
  }, [kidPubkey, family?.relayTrustAssignments]);

  const get = useCallback(
    (relayUrl: string): KuboTrustLevel | undefined => {
      const url = normalizeRelayUrl(relayUrl);
      return url ? assigned[url] : undefined;
    },
    [assigned],
  );

  const setLevel = useCallback(
    async (relayUrl: string, level: KuboTrustLevel) => {
      if (!kidPubkey) throw new Error('useRelayTrustAssignments: no kid selected');
      const url = normalizeRelayUrl(relayUrl);
      if (!url) throw new Error('useRelayTrustAssignments: invalid relay URL');
      await setRelayTrustLevel(kidPubkey, url, level);
    },
    [kidPubkey, setRelayTrustLevel],
  );

  const clear = useCallback(
    async (relayUrl: string) => {
      if (!kidPubkey) throw new Error('useRelayTrustAssignments: no kid selected');
      const url = normalizeRelayUrl(relayUrl);
      if (!url) return;
      await clearRelayTrustLevel(kidPubkey, url);
    },
    [kidPubkey, clearRelayTrustLevel],
  );

  return { get, setLevel, clear, assigned };
}
