import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useParentSigner } from './useParentSigner';
import {
  NIP29_KINDS,
  formatGroupAddr,
  hostFromRelayUrl,
  parseGroupAddr,
} from '@/lib/nip29';

export interface JoinedGroup {
  /** Full address `<host>'<gid>`. */
  addr: string;
  host: string;
  gid: string;
  relay: string;
  /** kind 39000 metadata, if the relay returned it. */
  metadata?: NostrEvent;
  name?: string;
  about?: string;
  picture?: string;
  /** True iff the kind 39000 had a `["private"]` tag. */
  isPrivate?: boolean;
  isClosed?: boolean;
}

interface ListEntry {
  gid: string;
  relay: string;
}

/**
 * Parse the user's NIP-51 kind-10009 list into `(gid, relay)` pairs.
 * NIP-29 list tags use the form `["group", gid, relay]`.
 */
function parseGroupList(event: NostrEvent | undefined): ListEntry[] {
  if (!event) return [];
  const out: ListEntry[] = [];
  for (const tag of event.tags) {
    if (tag[0] === 'group' && tag[1] && tag[2]) {
      out.push({ gid: tag[1], relay: tag[2] });
    }
  }
  return out;
}

/**
 * Hook for the joined NIP-29 groups of the **parent** identity.
 *
 * Group membership is parent-owned: join/create/leave all sign with
 * `useParentSigner()` and write the kind-10009 list under the parent's
 * pubkey. Keying this query the same way means a kid switching to their
 * own login still sees the family's groups, and the cache invalidation
 * fired by `useGroupActions` always matches.
 *
 * Reads kind 10009 from the parent's read relays, then fetches each
 * group's kind 39000 metadata from the group's host relay.
 */
export function useGroups() {
  const { nostr } = useNostr();
  const { user: parentUser } = useParentSigner();

  return useQuery({
    queryKey: ['nip29-groups', parentUser?.pubkey ?? ''],
    enabled: !!parentUser,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<JoinedGroup[]> => {
      if (!parentUser) return [];

      // 1) Pull the parent's joined-groups list from their normal read relays.
      const listEvents = await nostr.query(
        [{ kinds: [NIP29_KINDS.SELF_LIST], authors: [parentUser.pubkey], limit: 1 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      const listEvent = listEvents.sort((a, b) => b.created_at - a.created_at)[0];
      const entries = parseGroupList(listEvent);
      if (entries.length === 0) return [];

      // 2) For each unique relay, ask once for the metadata of every group
      //    we have on it. Each group lives on exactly one relay so we never
      //    have to dedupe across hosts.
      const byRelay = new Map<string, ListEntry[]>();
      for (const e of entries) {
        const list = byRelay.get(e.relay) ?? [];
        list.push(e);
        byRelay.set(e.relay, list);
      }

      const metadataByAddr = new Map<string, NostrEvent>();
      await Promise.all(
        Array.from(byRelay.entries()).map(async ([relay, list]) => {
          try {
            const events = await nostr.relay(relay).query(
              [{ kinds: [NIP29_KINDS.META], '#d': list.map(l => l.gid) }],
              { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
            );
            for (const ev of events) {
              const dTag = ev.tags.find(([t]) => t === 'd')?.[1];
              if (!dTag) continue;
              const host = hostFromRelayUrl(relay);
              const addr = formatGroupAddr(host, dTag);
              const existing = metadataByAddr.get(addr);
              if (!existing || ev.created_at > existing.created_at) {
                metadataByAddr.set(addr, ev);
              }
            }
          } catch {
            // Relay unreachable or rejected — leave entries metadata-less.
          }
        }),
      );

      return entries.map(({ gid, relay }) => {
        const host = hostFromRelayUrl(relay);
        const addr = formatGroupAddr(host, gid);
        const metadata = metadataByAddr.get(addr);
        const tagVal = (n: string) => metadata?.tags.find(([t]) => t === n)?.[1];
        return {
          addr,
          host,
          gid,
          relay,
          metadata,
          name: tagVal('name'),
          about: tagVal('about'),
          picture: tagVal('picture'),
          isPrivate: !!metadata?.tags.find(([t]) => t === 'private'),
          isClosed: !!metadata?.tags.find(([t]) => t === 'closed'),
        };
      });
    },
  });
}

/** Helper: read the user's current kind-10009 list for read-modify-write. */
export async function fetchGroupListEvent(
  nostr: ReturnType<typeof useNostr>['nostr'],
  pubkey: string,
  signal?: AbortSignal,
): Promise<NostrEvent | undefined> {
  const events = await nostr.query(
    [{ kinds: [NIP29_KINDS.SELF_LIST], authors: [pubkey], limit: 1 }],
    { signal: AbortSignal.any([signal ?? AbortSignal.timeout(5000)]) },
  );
  return events.sort((a, b) => b.created_at - a.created_at)[0];
}

/** Compute the next set of `["group", gid, relay]` tags after a join/leave. */
export function nextGroupListTags(
  prev: NostrEvent | undefined,
  op: { kind: 'join' | 'leave'; addr: string },
): string[][] {
  const { gid, relay } = parseGroupAddr(op.addr);
  const otherTags = (prev?.tags ?? []).filter(t => {
    if (t[0] !== 'group') return true;
    return !(t[1] === gid && t[2] === relay);
  });
  if (op.kind === 'leave') return otherTags;
  return [...otherTags, ['group', gid, relay]];
}
