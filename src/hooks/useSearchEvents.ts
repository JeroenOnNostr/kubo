import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useDebounce } from '@/hooks/useDebounce';

/**
 * Generic NIP-50 event search. Mirrors useSearchProfiles' debounce + stale
 * semantics but accepts any kinds array and returns raw NostrEvents.
 *
 * When `query` is empty we fall back to a plain `{kinds, limit}` firehose
 * so the caller can show a "discover" list without typing.
 */
export interface UseSearchEventsOptions {
  kinds: number[];
  /** Free-text search query. Empty string triggers the firehose fallback. */
  query: string;
  /** Default 100. */
  limit?: number;
  /** Default true. Pass false to skip the query entirely. */
  enabled?: boolean;
}

export function useSearchEvents({
  kinds,
  query,
  limit = 100,
  enabled = true,
}: UseSearchEventsOptions) {
  const { nostr } = useNostr();
  const debounced = useDebounce(query, 300);
  const kindsKey = [...kinds].sort().join(',');

  return useQuery<NostrEvent[]>({
    queryKey: ['search-events', kindsKey, debounced.trim(), limit],
    queryFn: async ({ signal }) => {
      const filter: Record<string, unknown> = { kinds, limit };
      const trimmed = debounced.trim();
      if (trimmed) filter.search = trimmed;

      const events = await nostr.query([filter as { kinds: number[]; limit: number }], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
      });

      // Deduplicate by `d`-tag for addressable kinds, otherwise by id.
      const isAddressable = kinds.every((k) => k >= 30000 && k < 40000);
      if (!isAddressable) {
        const byId = new Map<string, NostrEvent>();
        for (const e of events) byId.set(e.id, e);
        return Array.from(byId.values());
      }

      const byAddress = new Map<string, NostrEvent>();
      for (const e of events) {
        const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
        const key = `${e.kind}:${e.pubkey}:${d}`;
        const existing = byAddress.get(key);
        if (!existing || e.created_at > existing.created_at) {
          byAddress.set(key, e);
        }
      }
      return Array.from(byAddress.values());
    },
    enabled,
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
  });
}
