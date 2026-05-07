import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useParentSigner } from './useParentSigner';
import {
  NIP29_KINDS,
  parseGroupAddr,
  randomInviteCode,
} from '@/lib/nip29';

export interface GroupInvite {
  /** The invite code as published in the kind-9009 event. */
  code: string;
  /** Hex id of the kind-9009 event — used for revoke (kind 5). */
  eventId: string;
  /** Pubkey of the admin who created the code. */
  authorPubkey: string;
  /** Unix seconds. */
  createdAt: number;
}

const PAGE_LIMIT = 100;

function classify(events: NostrEvent[]): GroupInvite[] {
  const out: GroupInvite[] = [];
  for (const ev of events) {
    if (ev.kind !== NIP29_KINDS.INVITE) continue;
    const code = ev.tags.find(t => t[0] === 'code' && t[1])?.[1];
    if (!code) continue;
    out.push({
      code,
      eventId: ev.id,
      authorPubkey: ev.pubkey,
      createdAt: ev.created_at,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Manages NIP-29 invite codes (kind 9009) for a group: read all
 * outstanding codes, create a new one, revoke an existing one (kind 5
 * delete on the 9009 event).
 *
 * All mutations sign with the parent identity via {@link useParentSigner};
 * the relay rejects 9009/5 events from non-admins, but pre-flight gating
 * by `group.isAdmin` keeps the affordances hidden for non-admins anyway.
 */
export function useGroupInvites(addr: string | undefined) {
  const { nostr } = useNostr();
  const { user: parentUser, reason: parentReason } = useParentSigner();
  const qc = useQueryClient();
  const queryKey = ['nip29-invites', addr ?? '', parentUser?.pubkey ?? ''] as const;

  const requireParent = () => {
    if (parentUser) return parentUser;
    throw new Error(
      parentReason === 'parent-logged-out'
        ? 'Parent must be logged in to manage invite codes.'
        : 'Not logged in',
    );
  };

  const query = useQuery({
    queryKey,
    enabled: !!addr,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<GroupInvite[]> => {
      if (!addr) return [];
      const { gid, relay } = parseGroupAddr(addr);
      const events = await nostr.relay(relay).query(
        [{ kinds: [NIP29_KINDS.INVITE], '#h': [gid], limit: PAGE_LIMIT }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) },
      );
      return classify(events);
    },
  });

  // Live subscription so a freshly minted code shows up everywhere.
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
          [{ kinds: [NIP29_KINDS.INVITE], '#h': [gid], since }],
          { signal: ac.signal },
        )) {
          if (!alive) break;
          if (msg[0] === 'EVENT') {
            qc.setQueryData<GroupInvite[]>(queryKey, (prev = []) => {
              const merged = classify([
                ...prev.map((p) => ({
                  // Synthesize a NostrEvent-shaped object the dedupe expects;
                  // we only keep the fields classify reads.
                  id: p.eventId,
                  kind: NIP29_KINDS.INVITE,
                  pubkey: p.authorPubkey,
                  created_at: p.createdAt,
                  content: '',
                  tags: [['code', p.code]],
                  sig: '',
                } as NostrEvent)),
                msg[2] as NostrEvent,
              ]);
              return merged;
            });
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

  const createCode = useMutation<GroupInvite, Error, void>({
    mutationFn: async () => {
      if (!addr) throw new Error('No group');
      const parent = requireParent();
      const { gid, relay } = parseGroupAddr(addr);
      const code = randomInviteCode(12);
      const event = await parent.signer.signEvent({
        kind: NIP29_KINDS.INVITE,
        content: '',
        tags: [['h', gid], ['code', code]],
        created_at: Math.floor(Date.now() / 1000),
      });
      await nostr.relay(relay).event(event, { signal: AbortSignal.timeout(6000) });
      qc.invalidateQueries({ queryKey });
      return {
        code,
        eventId: event.id,
        authorPubkey: parent.pubkey,
        createdAt: event.created_at,
      };
    },
  });

  const revokeCode = useMutation<NostrEvent, Error, { eventId: string }>({
    mutationFn: async ({ eventId }) => {
      if (!addr) throw new Error('No group');
      const parent = requireParent();
      const { gid, relay } = parseGroupAddr(addr);
      const event = await parent.signer.signEvent({
        // Kind-5 delete event scoped to a single 9009 (`k` tag is a hint
        // for relays that filter by kind).
        kind: 5,
        content: '',
        tags: [['e', eventId], ['k', String(NIP29_KINDS.INVITE)], ['h', gid]],
        created_at: Math.floor(Date.now() / 1000),
      });
      await nostr.relay(relay).event(event, { signal: AbortSignal.timeout(6000) });
      qc.setQueryData<GroupInvite[]>(queryKey, (prev = []) =>
        prev.filter((p) => p.eventId !== eventId),
      );
      return event;
    },
  });

  return {
    ...query,
    invites: query.data ?? [],
    createCode: () => createCode.mutateAsync(),
    revokeCode: (eventId: string) => revokeCode.mutateAsync({ eventId }),
    pending: {
      create: createCode.isPending,
      revoke: revokeCode.isPending,
    },
  };
}
