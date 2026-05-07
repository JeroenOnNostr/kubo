import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-29 (managed groups) protocol helpers.
 *
 * Group address format: `<host>'<group-id>` (e.g.
 * `groups.0xchat.com'kubo-testers`). The host is bare (no scheme,
 * no path); we expand it to `wss://<host>/` when connecting.
 */

export const NIP29_KINDS = {
  CHAT: 9,
  REPLY: 11,
  PUT: 9000,
  REMOVE: 9001,
  EDIT: 9002,
  DELETE: 9005,
  CREATE: 9007,
  JOIN: 9021,
  LEAVE: 9022,
  META: 39000,
  ADMINS: 39001,
  MEMBERS: 39002,
  ROLES: 39003,
  SELF_LIST: 10009,
} as const;

export interface ParsedGroupAddr {
  /** Bare host, e.g. `groups.0xchat.com`. */
  host: string;
  /** Group id, e.g. `kubo-testers`. */
  gid: string;
  /** Connection URL, e.g. `wss://groups.0xchat.com/`. */
  relay: string;
}

/** Expand a bare host to the canonical wss URL we use for connection. */
export function relayFromHost(host: string): string {
  return `wss://${host.toLowerCase()}/`;
}

/** Split `<host>'<gid>` into its parts. Throws on malformed input. */
export function parseGroupAddr(addr: string): ParsedGroupAddr {
  const idx = addr.indexOf("'");
  if (idx <= 0 || idx === addr.length - 1) {
    throw new Error(`Invalid NIP-29 group address: ${addr}`);
  }
  const host = addr.slice(0, idx);
  const gid = addr.slice(idx + 1);
  return { host, gid, relay: relayFromHost(host) };
}

export function formatGroupAddr(host: string, gid: string): string {
  return `${host}'${gid}`;
}

/**
 * Slugify a group name into a NIP-29-safe id. NIP-29 allows
 * `a-z0-9-_`. We append 6 random chars so two groups with the same
 * name don't collide.
 */
export function slugifyGroupId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'group';
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}-${rand}`;
}

/**
 * Build the `previous` tag for a chat message per NIP-29: up to 8
 * 8-char id prefixes drawn from the last 50 events in the group,
 * excluding the sender's own. Returns null if fewer than 3
 * candidates exist (relay is expected to accept the first messages
 * in an empty group without a previous tag).
 */
export function buildPreviousTag(
  messages: NostrEvent[],
  selfPubkey: string,
): string[] | null {
  const ids = messages
    .filter(m => m.pubkey !== selfPubkey)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 50)
    .slice(0, 8)
    .map(m => m.id.slice(0, 8));
  return ids.length >= 3 ? ['previous', ...ids] : null;
}

/** Extract the host from a `wss://host/` URL; inverse of relayFromHost. */
export function hostFromRelayUrl(url: string): string {
  return url.replace(/^wss:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
}

export interface ReplyTarget {
  /** Hex event id of the parent message. */
  id: string;
  /** Optional relay hint from the `e` tag. */
  relay?: string;
  /** Optional pubkey of the parent author, from the matching `p` tag. */
  pubkey?: string;
}

/**
 * Resolve which message a NIP-29 chat event is replying to.
 *
 * Looks at tags in priority order: `e` with marker `reply` (Kubo's own
 * outgoing convention + NIP-10 modern), `e` with marker `root` (lone
 * root → treat as the reply target for chat), `q` (defensive — some
 * clients use the NIP-18 quote tag for in-chat replies), then the first
 * positional `e` with no marker (NIP-10 legacy). Returns null when no
 * candidate exists.
 */
export function getReplyTarget(event: NostrEvent): ReplyTarget | null {
  const eTags = event.tags.filter(t => t[0] === 'e' && t[1]);
  const pTags = event.tags.filter(t => t[0] === 'p' && t[1]);
  const qTag = event.tags.find(t => t[0] === 'q' && t[1]);

  const pickByMarker = (marker: string) =>
    eTags.find(t => t[3] === marker);

  const candidate =
    pickByMarker('reply') ??
    pickByMarker('root') ??
    qTag ??
    eTags.find(t => !t[3]);

  if (!candidate) return null;

  // The `p` tag for the reply target isn't ordered, so prefer one whose
  // pubkey matches a `p` tag if available; otherwise just take the first
  // `p` tag as a hint (chat replies typically have only one).
  const pubkey = pTags[0]?.[1];

  return {
    id: candidate[1],
    relay: candidate[2] || undefined,
    pubkey: pubkey || undefined,
  };
}
