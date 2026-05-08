import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useParentSigner } from './useParentSigner';
import { useGroup } from './useGroup';
import { useGroupActions } from './useGroupActions';
import { NIP29_KINDS, parseGroupAddr } from '@/lib/nip29';

export interface GroupJoinRequest {
  /** Hex id of the kind-9021 event — used as the React key + reject target. */
  eventId: string;
  /** Pubkey of the user requesting to join. */
  pubkey: string;
  /** Optional message attached to the join request. */
  content?: string;
  /** Unix seconds. */
  createdAt: number;
}

const PAGE_LIMIT = 100;

/**
 * Reads outstanding join-request events (kind 9021) for the group, and
 * provides admin mutations to approve (publishes a kind 9000 add-user
 * via {@link useGroupActions.putUser}) or reject (publishes a kind 5
 * delete on the 9021).
 *
 * Filters out requests whose pubkey already appears in the group's
 * kind-39002 members list — those have been accepted and the relay just
 * hasn't garbage-collected the original 9021. Also drops requests
 * deleted by an admin (we look for any matching kind-5 from admins).
 *
 * Like every other Kubo group mutation, sign-time uses the parent
 * identity even when a kid is the active account.
 */
export function useGroupJoinRequests(addr: string | undefined) {
  const { nostr } = useNostr();
  const { user: parentUser, reason: parentReason } = useParentSigner();
  const { data: group } = useGroup(addr);
  const { putUser, pending: actionPending } = useGroupActions();
  const qc = useQueryClient();

  const queryKey = ['nip29-join-requests', addr ?? '', parentUser?.pubkey ?? ''] as const;

  const requireParent = () => {
    if (parentUser) return parentUser;
    throw new Error(
      parentReason === 'parent-logged-out'
        ? 'Parent must be logged in to manage join requests.'
        : 'Not logged in',
    );
  };

  const query = useQuery({
    queryKey,
    enabled: !!addr,
    staleTime: 15_000,
    queryFn: async ({ signal }): Promise<GroupJoinRequest[]> => {
      if (!addr) return [];
      const { gid, relay } = parseGroupAddr(addr);
      // Pull both the 9021s and any kind-5 deletions referencing them so
      // we can locally drop rejected requests without an extra round-trip.
      const events = await nostr.relay(relay).query(
        [
          { kinds: [NIP29_KINDS.JOIN], '#h': [gid], limit: PAGE_LIMIT },
          { kinds: [5], '#h': [gid], limit: PAGE_LIMIT },
        ],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) },
      );
      const deleted = new Set<string>();
      for (const ev of events) {
        if (ev.kind !== 5) continue;
        for (const tag of ev.tags) {
          if (tag[0] === 'e' && tag[1]) deleted.add(tag[1]);
        }
      }
      const memberSet = new Set(group?.members ?? []);
      const requests: GroupJoinRequest[] = [];
      for (const ev of events) {
        if (ev.kind !== NIP29_KINDS.JOIN) continue;
        if (deleted.has(ev.id)) continue;
        if (memberSet.has(ev.pubkey)) continue;
        requests.push({
          eventId: ev.id,
          pubkey: ev.pubkey,
          content: ev.content?.trim() || undefined,
          createdAt: ev.created_at,
        });
      }
      return requests.sort((a, b) => b.createdAt - a.createdAt);
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
          [{ kinds: [NIP29_KINDS.JOIN], '#h': [gid], since }],
          { signal: ac.signal },
        )) {
          if (!alive) break;
          if (msg[0] === 'EVENT') {
            qc.invalidateQueries({ queryKey });
          } else if (msg[0] === 'CLOSED') {
            break;
          }
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr]);

  const approve = useMutation<NostrEvent, Error, { pubkey: string }>({
    mutationFn: async ({ pubkey }) => {
      if (!addr) throw new Error('No group');
      // requireParent throws on parent-logged-out so admins on a kid account get a clear error.
      requireParent();
      const ev = await putUser(addr, pubkey);
      qc.invalidateQueries({ queryKey });
      return ev;
    },
  });

  const reject = useMutation<NostrEvent, Error, { eventId: string }>({
    mutationFn: async ({ eventId }) => {
      if (!addr) throw new Error('No group');
      const parent = requireParent();
      const { gid, relay } = parseGroupAddr(addr);
      const event = await parent.signer.signEvent({
        kind: 5,
        content: '',
        tags: [['e', eventId], ['k', String(NIP29_KINDS.JOIN)], ['h', gid]],
        created_at: Math.floor(Date.now() / 1000),
      });
      await nostr.relay(relay).event(event, { signal: AbortSignal.timeout(6000) });
      qc.setQueryData<GroupJoinRequest[]>(queryKey, (prev = []) =>
        prev.filter((p) => p.eventId !== eventId),
      );
      return event;
    },
  });

  return {
    ...query,
    requests: query.data ?? [],
    approve: (pubkey: string) => approve.mutateAsync({ pubkey }),
    reject: (eventId: string) => reject.mutateAsync({ eventId }),
    pending: {
      approve: approve.isPending || actionPending.putUser,
      reject: reject.isPending,
    },
  };
}
