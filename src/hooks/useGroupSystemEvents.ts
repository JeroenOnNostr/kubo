import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { NIP29_KINDS, parseGroupAddr } from '@/lib/nip29';

/**
 * Membership-change events the Chat tab renders inline as "system rows"
 * (e.g. "Alice joined the group", "Bob was added to the group").
 *
 * Kept in a cache separate from `group-messages` so the chat-message
 * dedup/optimistic logic stays focused on actual chat (kind 9/11) and
 * doesn't have to special-case system-event ids.
 */
export interface GroupSystemEvent {
  /** Chronologically classified variant. */
  variant: 'joined' | 'left' | 'added' | 'removed';
  /** Underlying nostr event id; used as the React key. */
  eventId: string;
  /** Unix seconds — used for chronological merge in the chat stream. */
  created_at: number;
  /** Pubkey the row is "about" — joiner / leaver / target of put/remove. */
  actorPubkey: string;
  /** Admin who performed the action, when applicable (added / removed). */
  byPubkey?: string;
}

const PAGE_LIMIT = 200;

function classify(ev: NostrEvent): GroupSystemEvent | null {
  const pTag = ev.tags.find(t => t[0] === 'p' && t[1])?.[1];
  switch (ev.kind) {
    case NIP29_KINDS.JOIN:
      return { variant: 'joined', eventId: ev.id, created_at: ev.created_at, actorPubkey: ev.pubkey };
    case NIP29_KINDS.LEAVE:
      return { variant: 'left', eventId: ev.id, created_at: ev.created_at, actorPubkey: ev.pubkey };
    case NIP29_KINDS.PUT:
      if (!pTag) return null;
      return { variant: 'added', eventId: ev.id, created_at: ev.created_at, actorPubkey: pTag, byPubkey: ev.pubkey };
    case NIP29_KINDS.REMOVE:
      if (!pTag) return null;
      return { variant: 'removed', eventId: ev.id, created_at: ev.created_at, actorPubkey: pTag, byPubkey: ev.pubkey };
    default:
      return null;
  }
}

function dedupAndSort(events: GroupSystemEvent[]): GroupSystemEvent[] {
  const seen = new Map<string, GroupSystemEvent>();
  for (const e of events) seen.set(e.eventId, e);
  return Array.from(seen.values()).sort((a, b) => a.created_at - b.created_at);
}

/**
 * Collapse approval echoes: when an admin publishes a kind-9000
 * `put-user` within ±60 s of the joiner's own kind-9021 `join-request`
 * for the same actor, the put-user is just bookkeeping — render only
 * the join-request row. Same for kind-9001 vs kind-9022.
 */
function dedupApprovalEchoes(events: GroupSystemEvent[]): GroupSystemEvent[] {
  const WINDOW = 60;
  return events.filter((e, _i, all) => {
    if (e.variant === 'added') {
      return !all.some(o =>
        o.variant === 'joined' &&
        o.actorPubkey === e.actorPubkey &&
        Math.abs(o.created_at - e.created_at) <= WINDOW,
      );
    }
    if (e.variant === 'removed') {
      return !all.some(o =>
        o.variant === 'left' &&
        o.actorPubkey === e.actorPubkey &&
        Math.abs(o.created_at - e.created_at) <= WINDOW,
      );
    }
    return true;
  });
}

/**
 * Reads NIP-29 membership-change events (9000/9001/9021/9022) from the
 * group's host relay. Used by the Chat tab to interleave "system rows"
 * with chat messages.
 */
export function useGroupSystemEvents(addr: string | undefined) {
  const { nostr } = useNostr();
  const qc = useQueryClient();
  const queryKey = ['group-system-events', addr ?? ''] as const;

  const query = useQuery({
    queryKey,
    enabled: !!addr,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<GroupSystemEvent[]> => {
      if (!addr) return [];
      const { gid, relay } = parseGroupAddr(addr);
      const events = await nostr.relay(relay).query(
        [{
          kinds: [NIP29_KINDS.PUT, NIP29_KINDS.REMOVE, NIP29_KINDS.JOIN, NIP29_KINDS.LEAVE],
          '#h': [gid],
          limit: PAGE_LIMIT,
        }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) },
      );
      const classified = events.map(classify).filter((x): x is GroupSystemEvent => !!x);
      return dedupApprovalEchoes(dedupAndSort(classified));
    },
  });

  useEffect(() => {
    if (!addr) return;
    let alive = true;
    const ac = new AbortController();
    const { gid, relay } = parseGroupAddr(addr);

    (async () => {
      try {
        const since = Math.floor(Date.now() / 1000);
        const r = nostr.relay(relay);
        for await (const msg of r.req(
          [{
            kinds: [NIP29_KINDS.PUT, NIP29_KINDS.REMOVE, NIP29_KINDS.JOIN, NIP29_KINDS.LEAVE],
            '#h': [gid],
            since,
          }],
          { signal: ac.signal },
        )) {
          if (!alive) break;
          if (msg[0] === 'EVENT') {
            const sys = classify(msg[2] as NostrEvent);
            if (!sys) continue;
            qc.setQueryData<GroupSystemEvent[]>(queryKey, (prev = []) =>
              dedupApprovalEchoes(dedupAndSort([...prev, sys])),
            );
          } else if (msg[0] === 'CLOSED') {
            break;
          }
        }
      } catch {
        // Subscription aborted on unmount or relay disconnect — fine.
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr]);

  return {
    ...query,
    events: query.data ?? [],
  };
}
