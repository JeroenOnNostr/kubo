import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from './useCurrentUser';
import { useSearchEvents } from './useSearchEvents';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

export interface FollowPack {
  /** d-tag identifier */
  id: string;
  title: string;
  pubkeys: string[];
  /** The underlying Nostr event (needed for re-publishing mutations) */
  event: NostrEvent;
}

function parsePackEvent(event: NostrEvent): FollowPack {
  const id = event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
  const title = event.tags.find((t) => t[0] === 'title')?.[1]
    || event.tags.find((t) => t[0] === 'name')?.[1]
    || 'Untitled Pack';
  const pubkeys = event.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]);
  return { id, title, pubkeys, event };
}

export interface UseFollowPacksOptions {
  /**
   * Override the authors the query fetches packs from. When omitted, the
   * current signed-in user is used. Pass an array to browse packs authored
   * by other people (e.g. Kubo's /parent/feed/packs screen).
   */
  authors?: string[];
}

export function useFollowPacks(options?: UseFollowPacksOptions) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const effectiveAuthors = options?.authors ?? (user ? [user.pubkey] : []);
  const authorsKey = [...effectiveAuthors].sort().join(',');
  const isOverride = options?.authors !== undefined;

  return useQuery({
    // Preserve the original query key for the default (own-packs) case so
    // existing consumers keep their cache entries across this change.
    queryKey: isOverride
      ? ['follow-packs', authorsKey]
      : ['own-follow-packs', user?.pubkey],
    queryFn: async ({ signal }) => {
      if (effectiveAuthors.length === 0) return [];
      const events = await nostr.query(
        [{ kinds: [39089], authors: effectiveAuthors, limit: 100 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
      );
      const byAddress = new Map<string, NostrEvent>();
      for (const event of events) {
        const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
        const key = `${event.pubkey}:${d}`;
        const existing = byAddress.get(key);
        if (!existing || event.created_at > existing.created_at) byAddress.set(key, event);
      }
      return Array.from(byAddress.values()).map(parsePackEvent);
    },
    enabled: effectiveAuthors.length > 0,
    staleTime: 30_000,
  });
}

// ─── Batch lookup for pack-tile chips (plan M1) ──────────────────────────────

export interface PackByAtag {
  atag: string;     // "<kind>:<pubkey>:<d-tag>"
  kind: number;     // 30000 or 39089
  pubkey: string;
  dTag: string;
  title: string;
  image?: string;
  event: NostrEvent;
}

function parsePackByAtag(event: NostrEvent): PackByAtag | null {
  if (event.kind !== 30000 && event.kind !== 39089) return null;
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
  if (dTag === undefined) return null;
  const title = event.tags.find((t) => t[0] === 'title')?.[1]
    || event.tags.find((t) => t[0] === 'name')?.[1]
    || dTag || 'Untitled Pack';
  const image = event.tags.find((t) => t[0] === 'image')?.[1]
    || event.tags.find((t) => t[0] === 'thumb')?.[1];
  return {
    atag: `${event.kind}:${event.pubkey}:${dTag}`,
    kind: event.kind,
    pubkey: event.pubkey,
    dTag,
    title,
    image,
    event,
  };
}

type NostrQuerier = {
  query: (
    filters: NostrFilter[],
    opts?: { signal?: AbortSignal; relays?: string[] },
  ) => Promise<NostrEvent[]>;
};

export function packsByAtagsQueryKey(atags: string[]): [string, string] {
  return ['packs-by-atags', [...atags].sort().join(',')];
}

export async function fetchPacksByAtags(
  nostr: NostrQuerier,
  atags: string[],
  signal?: AbortSignal,
): Promise<Map<string, PackByAtag>> {
  if (atags.length === 0) return new Map();

  const wanted = new Set(atags);
  const kindsSet = new Set<number>();
  const authors = new Set<string>();
  const dTags = new Set<string>();
  for (const atag of atags) {
    const parts = atag.split(':');
    if (parts.length < 3) continue;
    const kind = Number.parseInt(parts[0], 10);
    if (kind !== 30000 && kind !== 39089) continue;
    kindsSet.add(kind);
    authors.add(parts[1]);
    dTags.add(parts.slice(2).join(':'));
  }
  if (authors.size === 0) return new Map();

  const events = await nostr.query(
    [{
      kinds: Array.from(kindsSet),
      authors: Array.from(authors),
      '#d': Array.from(dTags),
      limit: Math.max(atags.length * 2, 20),
    }],
    { signal: signal ?? AbortSignal.timeout(6000) },
  );

  const out = new Map<string, PackByAtag>();
  for (const event of events) {
    const parsed = parsePackByAtag(event);
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
 * Batched lookup — takes a list of a-tag strings and returns a map
 * keyed by a-tag. One relay query regardless of list size (plan M1).
 * Works across kinds 30000 (follow sets) and 39089 (follow packs).
 */
export function usePacksByAtags(atags: string[]) {
  const { nostr } = useNostr();
  const queryKey = useMemo(() => packsByAtagsQueryKey(atags), [atags]);

  return useQuery<Map<string, PackByAtag>>({
    queryKey,
    queryFn: ({ signal }) =>
      fetchPacksByAtags(
        nostr,
        atags,
        AbortSignal.any([signal, AbortSignal.timeout(6000)]),
      ),
    enabled: atags.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Global pack discovery (Stage 2, KUBO-049) ───────────────────────────────

/**
 * Global follow-pack browse + search. NIP-50 search on the relay pool
 * against kind 39089; empty query falls back to a top-100 firehose of
 * recently-published packs. Mirrors the `useCommunities` pattern.
 *
 * Note: relay.ditto.pub may not index kind 39089 for NIP-50 search. A
 * non-empty query that returns 0 events is an acceptable state — the UI
 * shows "no packs match" and the user can clear the query to see recent
 * packs.
 */
export function usePacks(query: string) {
  const result = useSearchEvents({ kinds: [39089], query, limit: 100 });

  const packs = useMemo<PackByAtag[]>(() => {
    const parsed: PackByAtag[] = [];
    for (const event of result.data ?? []) {
      const p = parsePackByAtag(event);
      if (p) parsed.push(p);
    }
    // Sort by recency; NIP-50 result order is relay-implementation-dependent.
    parsed.sort((a, b) => b.event.created_at - a.event.created_at);
    return parsed;
  }, [result.data]);

  return { ...result, packs };
}

