import { useMemo } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { useRelayDiscovery, type DiscoveredRelay } from '@/hooks/useRelayDiscovery';
import { APP_RELAYS } from '@/lib/appRelays';
import { normalizeRelayUrl } from '@/lib/relayUrl';

/**
 * Relay discovery + search. Backed by NIP-66 monitor relays via
 * useRelayDiscovery (one fetch per session, localStorage-persisted across
 * sessions). The `query` arg filters the cached catalogue client-side by URL
 * substring — no per-keystroke network round-trip.
 *
 * Personal-relevance ranking: relays that are already in the parent's NIP-65
 * list (or APP_RELAYS when useAppRelays is true) sort to the top so "their"
 * relays appear first regardless of search term.
 *
 * Cap at MAX_RESULTS=50 after substring + sort (kept from KUBO-050/051: each
 * row may still trigger lazy NIP-11 fallback when info is missing).
 */

const MAX_RESULTS = 50;

export function useRelays(
  query: string,
  { limit = MAX_RESULTS }: { limit?: number } = {},
) {
  const { data, isFetching, isError } = useRelayDiscovery();
  const { config } = useAppContext();

  const personalSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of config.relayMetadata.relays) {
      const n = normalizeRelayUrl(r.url);
      if (n) s.add(n);
    }
    if (config.useAppRelays) {
      for (const r of APP_RELAYS.relays) {
        const n = normalizeRelayUrl(r.url);
        if (n) s.add(n);
      }
    }
    return s;
  }, [config.relayMetadata.relays, config.useAppRelays]);

  const filtered = useMemo<DiscoveredRelay[]>(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const matching = q
      ? data.filter((r) => r.url.toLowerCase().includes(q))
      : data;
    const sorted = [...matching].sort((a, b) => {
      const ap = personalSet.has(a.url) ? 0 : 1;
      const bp = personalSet.has(b.url) ? 0 : 1;
      return ap - bp;
    });
    return sorted.slice(0, limit);
  }, [data, query, limit, personalSet]);

  return { relays: filtered, isFetching, isError };
}
