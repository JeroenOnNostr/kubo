import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { NIP29_KINDS, parseGroupAddr } from '@/lib/nip29';

export interface GroupRole {
  pubkey: string;
  /** First role assigned in the kind-39001 admin entry (e.g. "admin"). */
  role: string;
  /** All roles for the user. */
  roles: string[];
}

export interface GroupSnapshot {
  metadata?: NostrEvent;
  admins: GroupRole[];
  members: string[];
  /** Roles supported by the relay (kind 39003). */
  supportedRoles: { name: string; description?: string }[];
  name?: string;
  about?: string;
  picture?: string;
  isPrivate: boolean;
  isClosed: boolean;
  /** True iff the current user is in the kind-39002 members list. */
  isMember: boolean;
  /** True iff the current user appears in kind-39001. */
  isAdmin: boolean;
  /** Current user's first role from kind-39001, if any. */
  role?: string;
}

const empty: GroupSnapshot = {
  admins: [],
  members: [],
  supportedRoles: [],
  isPrivate: false,
  isClosed: false,
  isMember: false,
  isAdmin: false,
};

/**
 * Hook for a single NIP-29 group's relay-side state. Pulls kind
 * 39000-39003 from the group's host relay (the source of truth for
 * managed groups).
 */
export function useGroup(addr: string | undefined) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['nip29-group', addr ?? ''],
    enabled: !!addr,
    staleTime: 15_000,
    queryFn: async ({ signal }): Promise<GroupSnapshot> => {
      if (!addr) return empty;
      const { gid, relay } = parseGroupAddr(addr);

      const events = await nostr.relay(relay).query(
        [{
          kinds: [NIP29_KINDS.META, NIP29_KINDS.ADMINS, NIP29_KINDS.MEMBERS, NIP29_KINDS.ROLES],
          '#d': [gid],
        }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) },
      );

      const latest = (kind: number): NostrEvent | undefined =>
        events
          .filter(e => e.kind === kind)
          .sort((a, b) => b.created_at - a.created_at)[0];

      const metadata = latest(NIP29_KINDS.META);
      const adminsEv = latest(NIP29_KINDS.ADMINS);
      const membersEv = latest(NIP29_KINDS.MEMBERS);
      const rolesEv = latest(NIP29_KINDS.ROLES);

      const admins: GroupRole[] = [];
      for (const tag of adminsEv?.tags ?? []) {
        if (tag[0] !== 'p' || !tag[1]) continue;
        const roles = tag.slice(2).filter(Boolean);
        admins.push({
          pubkey: tag[1],
          role: roles[0] ?? 'admin',
          roles: roles.length ? roles : ['admin'],
        });
      }

      const members: string[] = [];
      for (const tag of membersEv?.tags ?? []) {
        if (tag[0] === 'p' && tag[1]) members.push(tag[1]);
      }

      const supportedRoles: { name: string; description?: string }[] = [];
      for (const tag of rolesEv?.tags ?? []) {
        if (tag[0] === 'role' && tag[1]) {
          supportedRoles.push({ name: tag[1], description: tag[2] });
        }
      }

      const tagVal = (n: string) => metadata?.tags.find(([t]) => t === n)?.[1];
      const hasFlag = (n: string) => !!metadata?.tags.find(([t]) => t === n);

      const adminEntry = user ? admins.find(a => a.pubkey === user.pubkey) : undefined;
      const isMember = !!user && members.includes(user.pubkey);
      const isAdmin = !!adminEntry;

      return {
        metadata,
        admins,
        members,
        supportedRoles,
        name: tagVal('name'),
        about: tagVal('about'),
        picture: tagVal('picture'),
        isPrivate: hasFlag('private'),
        isClosed: hasFlag('closed'),
        isMember: isMember || isAdmin, // admins always count as members
        isAdmin,
        role: adminEntry?.role,
      };
    },
  });
}
