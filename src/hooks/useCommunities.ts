import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useSearchEvents } from '@/hooks/useSearchEvents';

type NostrQuerier = {
  query: (
    filters: NostrFilter[],
    opts?: { signal?: AbortSignal; relays?: string[] },
  ) => Promise<NostrEvent[]>;
};

/**
 * NIP-72 community (kind 34550) discovery and lookup.
 *
 * - `useCommunities(query)` — NIP-50 search on the relay pool for browsing.
 *   Empty query returns the top-100 firehose.
 * - `useCommunitiesByAtags(atags)` — batched lookup by a-tag
 *   (`34550:<pubkey>:<d-tag>`). One relay query regardless of list size, so
 *   the parent tile's chip strip never fans out per-chip (M1).
 */

export interface ParsedCommunity {
  atag: string;       // "34550:<pubkey>:<d-tag>"
  pubkey: string;     // community author
  dTag: string;
  name: string;
  description?: string;
  image?: string;
  event: NostrEvent;
}

function parseCommunity(event: NostrEvent): ParsedCommunity | null {
  if (event.kind !== 34550) return null;
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
  if (dTag === undefined) return null;
  const name = event.tags.find((t) => t[0] === 'name')?.[1]?.trim() || dTag;
  const description = event.tags.find((t) => t[0] === 'description')?.[1]?.trim();
  const image = event.tags.find((t) => t[0] === 'image')?.[1]?.trim();
  return {
    atag: `34550:${event.pubkey}:${dTag}`,
    pubkey: event.pubkey,
    dTag,
    name,
    description,
    image,
    event,
  };
}

export function useCommunities(query: string) {
  const result = useSearchEvents({ kinds: [34550], query, limit: 100 });

  const communities = useMemo<ParsedCommunity[]>(() => {
    const events = result.data ?? [];
    const parsed: ParsedCommunity[] = [];
    for (const event of events) {
      const community = parseCommunity(event);
      if (community) parsed.push(community);
    }
    // Most-recent first — a rough proxy for "actively maintained".
    parsed.sort((a, b) => b.event.created_at - a.event.created_at);
    return parsed;
  }, [result.data]);

  return { ...result, communities };
}

/**
 * Shared query-key builder so boot-time priming (M3) and the hook itself
 * use the same cache slot.
 */
export function communitiesByAtagsQueryKey(atags: string[]): [string, string] {
  return ['communities-by-atags', [...atags].sort().join(',')];
}

/**
 * Shared fetcher for boot-time priming and the React hook. Takes a list of
 * a-tags, issues ONE relay query (author ∈ authors AND `d` ∈ dTags), then
 * post-filters by exact a-tag membership.
 */
export async function fetchCommunitiesByAtags(
  nostr: NostrQuerier,
  atags: string[],
  signal?: AbortSignal,
): Promise<Map<string, ParsedCommunity>> {
  if (atags.length === 0) return new Map();

  const wanted = new Set(atags);
  const authors = new Set<string>();
  const dTags = new Set<string>();
  for (const atag of atags) {
    const parts = atag.split(':');
    if (parts.length >= 3 && parts[0] === '34550') {
      authors.add(parts[1]);
      dTags.add(parts.slice(2).join(':'));
    }
  }
  if (authors.size === 0) return new Map();

  const events = await nostr.query(
    [{
      kinds: [34550],
      authors: Array.from(authors),
      '#d': Array.from(dTags),
      limit: Math.max(atags.length * 2, 20),
    }],
    { signal: signal ?? AbortSignal.timeout(6000) },
  );

  const out = new Map<string, ParsedCommunity>();
  for (const event of events) {
    const parsed = parseCommunity(event);
    if (!parsed) continue;
    if (!wanted.has(parsed.atag)) continue;
    const existing = out.get(parsed.atag);
    if (!existing || parsed.event.created_at > existing.event.created_at) {
      out.set(parsed.atag, parsed);
    }
  }
  return out;
}

/**
 * Batched lookup for the ParentFeedPage communities tile. One relay query
 * that asks for every enabled a-tag at once rather than one query per chip.
 */
export function useCommunitiesByAtags(atags: string[]) {
  const { nostr } = useNostr();
  const queryKey = useMemo(() => communitiesByAtagsQueryKey(atags), [atags]);

  return useQuery<Map<string, ParsedCommunity>>({
    queryKey,
    queryFn: ({ signal }) =>
      fetchCommunitiesByAtags(
        nostr,
        atags,
        AbortSignal.any([signal, AbortSignal.timeout(6000)]),
      ),
    enabled: atags.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
