import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { type RelayInfoDocument } from '@/hooks/useRelayInfo';
import { normalizeRelayUrl } from '@/lib/relayUrl';
import {
  NIP66_DISCOVERY_RELAYS,
  NIP66_FETCH_LIMIT,
  NIP66_KIND,
  NIP66_MAX_AGE_SEC,
  NIP66_TRUSTED_MONITORS,
} from '@/lib/relayDiscovery';

export interface DiscoveredRelay {
  url: string;
  /** Parsed NIP-11 doc from the kind-30166 event content. May be partial. */
  info: RelayInfoDocument;
  /** Network from `n` tag. */
  network: 'clearnet' | 'tor' | 'i2p' | 'unknown';
  /** Event created_at — used as a recency tiebreak and for cache freshness. */
  monitoredAt: number;
}

const STORAGE_KEY = 'kubo:relay-discovery:v1';
const MAX_STORAGE_BYTES = 2 * 1024 * 1024;

interface PersistedPayload {
  fetchedAt: number;
  relays: DiscoveredRelay[];
}

function loadFromStorage(): DiscoveredRelay[] | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PersistedPayload;
    if (!parsed || !Array.isArray(parsed.relays)) return undefined;
    const ageMs = Date.now() - parsed.fetchedAt;
    if (ageMs > NIP66_MAX_AGE_SEC * 1000) return undefined;
    return parsed.relays;
  } catch {
    return undefined;
  }
}

function saveToStorage(relays: DiscoveredRelay[]) {
  try {
    const payload: PersistedPayload = { fetchedAt: Date.now(), relays };
    let serialized = JSON.stringify(payload);
    if (serialized.length > MAX_STORAGE_BYTES) {
      const trimmed: PersistedPayload = {
        fetchedAt: payload.fetchedAt,
        relays: relays.slice(0, Math.floor(relays.length * (MAX_STORAGE_BYTES / serialized.length))),
      };
      serialized = JSON.stringify(trimmed);
    }
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Quota exceeded or storage unavailable — silently skip; next session refetches.
  }
}

function parseEvent(event: NostrEvent): DiscoveredRelay | null {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
  if (!dTag) return null;

  const url = normalizeRelayUrl(dTag);
  if (!url) return null;

  let info: RelayInfoDocument = {};
  if (event.content) {
    try {
      const parsed = JSON.parse(event.content);
      if (parsed && typeof parsed === 'object') info = parsed as RelayInfoDocument;
    } catch {
      // Fall through with empty info
    }
  }

  // Augment from tags when content is missing/partial.
  const supportedFromTags = event.tags
    .filter((t) => t[0] === 'N' && t[1])
    .map((t) => Number(t[1]))
    .filter((n) => Number.isFinite(n));
  if (supportedFromTags.length && !info.supported_nips) {
    info.supported_nips = supportedFromTags;
  }

  const networkTag = event.tags.find((t) => t[0] === 'n')?.[1];
  const network: DiscoveredRelay['network'] =
    networkTag === 'clearnet' || networkTag === 'tor' || networkTag === 'i2p'
      ? networkTag
      : 'unknown';

  return { url, info, network, monitoredAt: event.created_at };
}

/**
 * Fetches the global relay catalogue from NIP-66 monitor relays. Cached for
 * 1h in TanStack Query, persisted to localStorage for cross-session warmth.
 *
 * Result is keyed only by the constant ['relay-discovery'] so all callers
 * share one fetch — typing in a search box does NOT trigger refetches.
 */
export function useRelayDiscovery() {
  const { nostr } = useNostr();

  return useQuery<DiscoveredRelay[]>({
    queryKey: ['relay-discovery'],
    queryFn: async ({ signal }) => {
      const since = Math.floor(Date.now() / 1000) - NIP66_MAX_AGE_SEC;
      const filter = {
        kinds: [NIP66_KIND],
        authors: [...NIP66_TRUSTED_MONITORS],
        since,
        limit: NIP66_FETCH_LIMIT,
      };

      const events = await nostr.group([...NIP66_DISCOVERY_RELAYS]).query([filter], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });

      // Newest event per d-tag (URL is the addressable identifier).
      const byUrl = new Map<string, DiscoveredRelay>();
      for (const event of events) {
        const parsed = parseEvent(event);
        if (!parsed) continue;
        const existing = byUrl.get(parsed.url);
        if (!existing || parsed.monitoredAt > existing.monitoredAt) {
          byUrl.set(parsed.url, parsed);
        }
      }

      const relays = [...byUrl.values()].sort((a, b) => b.monitoredAt - a.monitoredAt);
      saveToStorage(relays);
      return relays;
    },
    initialData: loadFromStorage,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    retry: 1,
  });
}
