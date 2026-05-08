import { useNostr } from '@nostrify/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';

import { useNostrPublish } from './useNostrPublish';
import { useParentSigner } from './useParentSigner';
import { fetchGroupListEvent, nextGroupListTags, type JoinedGroup } from './useGroups';
import {
  NIP29_KINDS,
  formatGroupAddr,
  parseGroupAddr,
  slugifyGroupId,
} from '@/lib/nip29';

export interface CreateGroupInput {
  /** Bare host of the target NIP-29 relay, e.g. `groups.0xchat.com`. */
  host: string;
  name: string;
  isPrivate: boolean;
  isClosed: boolean;
}

export interface EditMetadataInput {
  name?: string;
  about?: string;
  picture?: string;
  isPrivate?: boolean;
  isClosed?: boolean;
}

/**
 * All NIP-29 mutations except chat send (which lives in
 * {@link useGroupMessages} so it can update its cache directly).
 *
 * Every mutation signs with the **parent identity** via
 * {@link useParentSigner}. NIP-29 group membership and moderation are
 * parent-level concerns in Kubo — a kid being silently treated as an
 * admin (or kicked from a group) just because they're the active
 * account in the switcher would be a privacy/safety bug. The hook
 * publishes to a SINGLE relay — the host of the group's address — via
 * `nostr.relay(url).event(...)`. The default eventRouter in
 * NostrProvider explicitly skips NIP-29 events with an `h` tag, so
 * there's no double-publish.
 */
export function useGroupActions() {
  const { nostr } = useNostr();
  const { user: parentUser, reason: parentReason } = useParentSigner();
  const { mutateAsync: publishToWriteRelays } = useNostrPublish();
  const qc = useQueryClient();

  /**
   * Returns the parent identity for signing. Throws explicitly if the
   * parent is logged out — never silently falls back to the active kid,
   * because that is exactly the regression this guard exists to prevent.
   */
  const requireParent = (): NUser => {
    if (parentUser) return parentUser;
    throw new Error(
      parentReason === 'parent-logged-out'
        ? 'Parent must be logged in to manage this group on this device.'
        : 'Not logged in',
    );
  };

  /** Sign + publish to the group's host relay only. */
  const sendToGroupRelay = async (
    template: { kind: number; content: string; tags: string[][] },
    relay: string,
    signerUser: NUser,
  ) => {
    const event = await signerUser.signer.signEvent({
      ...template,
      created_at: Math.floor(Date.now() / 1000),
    });
    await nostr.relay(relay).event(event, { signal: AbortSignal.timeout(6000) });
    return event;
  };

  /**
   * Read-modify-write the given signer's kind-10009 list, publishing to
   * write relays. The kind-10009 list is per-pubkey, so passing
   * `signerUser` ensures both the read (`fetchGroupListEvent`) and the
   * sign-and-publish target the same identity.
   *
   * Updates the `['nip29-groups', signerUser.pubkey]` cache optimistically
   * so the UI flips on the same tick as the click, then invalidates after
   * publish so a relay round-trip can enrich the entry with metadata.
   * Rolls back the cache if the publish throws.
   */
  const updateGroupList = async (
    op: { kind: 'join' | 'leave'; addr: string },
    signerUser: NUser,
  ) => {
    const prev = await fetchGroupListEvent(nostr, signerUser.pubkey);
    const tags = nextGroupListTags(prev, op);

    const queryKey = ['nip29-groups', signerUser.pubkey] as const;
    const snapshot = qc.getQueryData<JoinedGroup[]>(queryKey);
    const { gid, host, relay } = parseGroupAddr(op.addr);
    qc.setQueryData<JoinedGroup[]>(queryKey, (current = []) =>
      op.kind === 'join'
        ? (current.some(g => g.addr === op.addr)
            ? current
            : [...current, { addr: op.addr, host, gid, relay }])
        : current.filter(g => g.addr !== op.addr),
    );

    try {
      await publishToWriteRelays({
        kind: NIP29_KINDS.SELF_LIST,
        content: '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
        prev,
        signer: signerUser,
      });
    } catch (err) {
      qc.setQueryData<JoinedGroup[]>(queryKey, snapshot);
      throw err;
    }

    qc.invalidateQueries({ queryKey });
  };

  const join = useMutation<NostrEvent | null, Error, { addr: string; code?: string }>({
    mutationFn: async ({ addr, code }) => {
      const parent = requireParent();
      const { gid, relay } = parseGroupAddr(addr);
      const tags: string[][] = [['h', gid]];
      if (code) tags.push(['code', code]);
      let ev: NostrEvent | null = null;
      try {
        ev = await sendToGroupRelay(
          { kind: NIP29_KINDS.JOIN, content: 'joining', tags },
          relay,
          parent,
        );
      } catch (err) {
        // NIP-29 relays use the `duplicate:` reason prefix when the user
        // is already in the group. That's not an error from the user's
        // perspective — they joined elsewhere or this is a retry. Quietly
        // sync local state and continue. Any other rejection bubbles up.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/duplicate:/i.test(msg)) throw err;
      }
      await updateGroupList({ kind: 'join', addr }, parent);
      qc.invalidateQueries({ queryKey: ['nip29-group', addr] });
      return ev;
    },
  });

  const leave = useMutation<NostrEvent, Error, { addr: string }>({
    mutationFn: async ({ addr }) => {
      const parent = requireParent();
      const { gid, relay } = parseGroupAddr(addr);
      const ev = await sendToGroupRelay(
        { kind: NIP29_KINDS.LEAVE, content: 'leaving', tags: [['h', gid]] },
        relay,
        parent,
      );
      await updateGroupList({ kind: 'leave', addr }, parent);
      qc.invalidateQueries({ queryKey: ['nip29-group', addr] });
      return ev;
    },
  });

  const create = useMutation<{ addr: string }, Error, CreateGroupInput>({
    mutationFn: async ({ host, name, isPrivate, isClosed }) => {
      const parent = requireParent();
      const gid = slugifyGroupId(name);
      const relay = `wss://${host.toLowerCase()}/`;
      const addr = formatGroupAddr(host, gid);

      // 9007 create — relay reads the `h` tag and registers the group.
      await sendToGroupRelay(
        { kind: NIP29_KINDS.CREATE, content: '', tags: [['h', gid]] },
        relay,
        parent,
      );

      // 9002 edit — set name + access flags. Some relays accept the
      // gid as supplied; others may override it. We still send the
      // metadata against the gid we picked; if the relay overrode it
      // the user will see the discrepancy on the About tab.
      const metaTags: string[][] = [['h', gid], ['name', name]];
      if (isPrivate) metaTags.push(['private']);
      if (isClosed) metaTags.push(['closed']);
      await sendToGroupRelay(
        { kind: NIP29_KINDS.EDIT, content: '', tags: metaTags },
        relay,
        parent,
      );

      // Add to the parent's joined-groups list so it shows up in the
      // section without needing to re-join. Pinned to the parent for
      // the same reason the create event is — group membership is a
      // parent-level concern. updateGroupList already invalidates the
      // ['nip29-groups', parent.pubkey] query.
      await updateGroupList({ kind: 'join', addr }, parent);

      return { addr };
    },
  });

  const editMetadata = useMutation<NostrEvent, Error, { addr: string; patch: EditMetadataInput }>({
    mutationFn: async ({ addr, patch }) => {
      const { gid, relay } = parseGroupAddr(addr);
      const tags: string[][] = [['h', gid]];
      if (patch.name !== undefined) tags.push(['name', patch.name]);
      if (patch.about !== undefined) tags.push(['about', patch.about]);
      if (patch.picture !== undefined) tags.push(['picture', patch.picture]);
      if (patch.isPrivate) tags.push(['private']);
      if (patch.isClosed) tags.push(['closed']);
      const ev = await sendToGroupRelay(
        { kind: NIP29_KINDS.EDIT, content: '', tags },
        relay,
        requireParent(),
      );
      qc.invalidateQueries({ queryKey: ['nip29-group', addr] });
      qc.invalidateQueries({ queryKey: ['nip29-groups'] });
      return ev;
    },
  });

  const putUser = useMutation<NostrEvent, Error, { addr: string; pubkey: string; role?: string }>({
    mutationFn: async ({ addr, pubkey, role }) => {
      const { gid, relay } = parseGroupAddr(addr);
      // NIP-29: a `p` tag with no role means "member". Pass an explicit
      // role like 'admin' to promote.
      const pTag = role ? ['p', pubkey, role] : ['p', pubkey];
      const ev = await sendToGroupRelay(
        { kind: NIP29_KINDS.PUT, content: '', tags: [['h', gid], pTag] },
        relay,
        requireParent(),
      );
      qc.invalidateQueries({ queryKey: ['nip29-group', addr] });
      return ev;
    },
  });

  const removeUser = useMutation<NostrEvent, Error, { addr: string; pubkey: string }>({
    mutationFn: async ({ addr, pubkey }) => {
      const { gid, relay } = parseGroupAddr(addr);
      const ev = await sendToGroupRelay(
        { kind: NIP29_KINDS.REMOVE, content: '', tags: [['h', gid], ['p', pubkey]] },
        relay,
        requireParent(),
      );
      qc.invalidateQueries({ queryKey: ['nip29-group', addr] });
      return ev;
    },
  });

  const deleteMessage = useMutation<NostrEvent, Error, { addr: string; eventId: string }>({
    mutationFn: async ({ addr, eventId }) => {
      const { gid, relay } = parseGroupAddr(addr);
      const ev = await sendToGroupRelay(
        { kind: NIP29_KINDS.DELETE, content: '', tags: [['h', gid], ['e', eventId]] },
        relay,
        requireParent(),
      );
      // Remove the message from the local cache so the bubble disappears
      // immediately (in addition to whatever the live subscription does).
      qc.setQueryData<NostrEvent[]>(['group-messages', addr], (prev = []) =>
        prev.filter(m => m.id !== eventId),
      );
      return ev;
    },
  });

  const deleteGroup = useMutation<NostrEvent, Error, { addr: string }>({
    mutationFn: async ({ addr }) => {
      const parent = requireParent();
      const { gid, relay } = parseGroupAddr(addr);
      const ev = await sendToGroupRelay(
        { kind: NIP29_KINDS.DELETE_GROUP, content: '', tags: [['h', gid]] },
        relay,
        parent,
      );
      // Locally drop the group from the joined-groups list so the UI
      // doesn't keep showing it after the relay tombstones the group.
      await updateGroupList({ kind: 'leave', addr }, parent);
      qc.invalidateQueries({ queryKey: ['nip29-group', addr] });
      return ev;
    },
  });

  return {
    join: (addr: string, code?: string) => join.mutateAsync({ addr, code }),
    leave: (addr: string) => leave.mutateAsync({ addr }),
    create: (input: CreateGroupInput) => create.mutateAsync(input),
    editMetadata: (addr: string, patch: EditMetadataInput) =>
      editMetadata.mutateAsync({ addr, patch }),
    putUser: (addr: string, pubkey: string, role?: string) =>
      putUser.mutateAsync({ addr, pubkey, role }),
    removeUser: (addr: string, pubkey: string) =>
      removeUser.mutateAsync({ addr, pubkey }),
    deleteMessage: (addr: string, eventId: string) =>
      deleteMessage.mutateAsync({ addr, eventId }),
    deleteGroup: (addr: string) => deleteGroup.mutateAsync({ addr }),
    /** Per-mutation pending flags for UI affordances. */
    pending: {
      join: join.isPending,
      leave: leave.isPending,
      create: create.isPending,
      editMetadata: editMetadata.isPending,
      putUser: putUser.isPending,
      removeUser: removeUser.isPending,
      deleteMessage: deleteMessage.isPending,
      deleteGroup: deleteGroup.isPending,
    },
  };
}
