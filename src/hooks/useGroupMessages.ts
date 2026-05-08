import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useParentSigner } from './useParentSigner';
import { NIP29_KINDS, buildPreviousTag, parseGroupAddr } from '@/lib/nip29';

export interface GroupMessage extends NostrEvent {
  /** Optimistic-only flag: true while the relay hasn't echoed the event yet. */
  _pending?: boolean;
  /** Optimistic-only flag: true when publish failed. */
  _failed?: boolean;
  /** Error message attached to a failed publish. */
  _error?: string;
}

const PAGE_LIMIT = 200;

function dedupAndSort(events: GroupMessage[]): GroupMessage[] {
  const seen = new Map<string, GroupMessage>();
  for (const e of events) {
    const existing = seen.get(e.id);
    // Prefer the relay-confirmed event over the optimistic one with the same id.
    if (!existing || (existing._pending && !e._pending)) {
      seen.set(e.id, e);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.created_at - b.created_at);
}

/**
 * Hook for chat messages in a NIP-29 group.
 *
 * - Initial fetch: most recent {@link PAGE_LIMIT} kind-9/11 events from
 *   the group's host relay.
 * - Live updates: a long-running subscription (`nostr.relay(url).req()`)
 *   merges new events into the TanStack Query cache.
 * - Optimistic send: a sent message is appended with `_pending: true`
 *   and replaced by the relay's echo (matched by id).
 *
 * The cache key is `["group-messages", addr]` so all mutations and
 * subscriptions can share state without prop-drilling.
 */
export function useGroupMessages(addr: string | undefined) {
  const { nostr } = useNostr();
  // Group chat must be attributed to the parent identity even when a kid is
  // the active account (NIP-29 group membership is parent-level — see
  // useParentSigner). When no family is configured this falls back to the
  // active user, so solo installs are unaffected.
  const { user: parentUser, reason: parentReason } = useParentSigner();
  const qc = useQueryClient();

  const queryKey = ['group-messages', addr ?? ''] as const;

  const query = useQuery({
    queryKey,
    enabled: !!addr,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<GroupMessage[]> => {
      if (!addr) return [];
      const { gid, relay } = parseGroupAddr(addr);
      const events = await nostr.relay(relay).query(
        [{
          kinds: [NIP29_KINDS.CHAT, NIP29_KINDS.REPLY],
          '#h': [gid],
          limit: PAGE_LIMIT,
        }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) },
      );
      return dedupAndSort(events);
    },
  });

  // Live subscription: merge incoming events into the cache. Bypasses the
  // pool's eoseTimeout by going through `nostr.relay()` directly (see
  // useStreamPosts.ts for the same pattern).
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
          [{ kinds: [NIP29_KINDS.CHAT, NIP29_KINDS.REPLY], '#h': [gid], since }],
          { signal: ac.signal },
        )) {
          if (!alive) break;
          if (msg[0] === 'EVENT') {
            const ev = msg[2] as GroupMessage;
            qc.setQueryData<GroupMessage[]>(queryKey, (prev = []) =>
              dedupAndSort([...prev, ev]),
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
    // queryKey is derived from addr; nostr/qc are stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr]);

  const sendMessage = useMutation<NostrEvent, Error, { content: string; replyTo?: NostrEvent }>({
    mutationFn: async ({ content, replyTo }) => {
      if (!addr) throw new Error('No group selected');
      if (!parentUser) {
        throw new Error(
          parentReason === 'parent-logged-out'
            ? 'Parent must be logged in to post in a group on this device.'
            : 'Not logged in',
        );
      }
      const trimmed = content.trim();
      if (!trimmed) throw new Error('Empty message');

      const { gid, relay } = parseGroupAddr(addr);
      const tags: string[][] = [['h', gid]];

      if (replyTo) {
        tags.push(['e', replyTo.id, relay, 'reply']);
        tags.push(['p', replyTo.pubkey]);
      }

      // `previous` references the sender's own most-recent message in the
      // group — must be keyed on the signing pubkey (parent), not the
      // active account.
      const current = qc.getQueryData<GroupMessage[]>(queryKey) ?? [];
      const previous = buildPreviousTag(current.filter(m => !m._pending), parentUser.pubkey);
      if (previous) tags.push(previous);

      const created_at = Math.floor(Date.now() / 1000);
      const event = await parentUser.signer.signEvent({
        kind: replyTo ? NIP29_KINDS.CHAT : NIP29_KINDS.CHAT, // both use kind 9; replies are e-tagged
        content: trimmed,
        tags,
        created_at,
      });

      // Optimistic insert. The live subscription will merge the relay
      // echo by id and clear the pending flag.
      qc.setQueryData<GroupMessage[]>(queryKey, (prev = []) =>
        dedupAndSort([...prev, { ...event, _pending: true }]),
      );

      try {
        await nostr.relay(relay).event(event, { signal: AbortSignal.timeout(6000) });
        // Relay accepted — strip the pending flag eagerly so the bubble
        // is shown as confirmed even if the subscription echo lags.
        qc.setQueryData<GroupMessage[]>(queryKey, (prev = []) =>
          dedupAndSort(prev.map(m => (m.id === event.id ? { ...m, _pending: false } : m))),
        );
        return event;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Send failed';
        qc.setQueryData<GroupMessage[]>(queryKey, (prev = []) =>
          prev.map(m =>
            m.id === event.id ? { ...m, _pending: false, _failed: true, _error: message } : m,
          ),
        );
        throw err instanceof Error ? err : new Error(message);
      }
    },
  });

  return {
    ...query,
    messages: query.data ?? [],
    sendMessage: (content: string, replyTo?: NostrEvent) =>
      sendMessage.mutateAsync({ content, replyTo }),
    isSending: sendMessage.isPending,
  };
}
