import { describe, expect, it } from 'vitest';

import { hasUnreadMessages } from './useHasUnreadTestersGroup';
import type { GroupMessage } from './useGroupMessages';

/**
 * KUBO-191 — the Support tab's unread-dot decision. We test the pure
 * `hasUnreadMessages` seam the hook delegates to (the React glue is just
 * useMemo over this), covering the cursor, own-message, and optimistic cases.
 */

const PEER = 'a'.repeat(64);
const OWN = 'b'.repeat(64);

function msg(over: Partial<GroupMessage>): GroupMessage {
  return {
    id: Math.random().toString(36).slice(2),
    pubkey: PEER,
    created_at: 1000,
    kind: 9,
    tags: [],
    content: 'hi',
    sig: '',
    ...over,
  } as GroupMessage;
}

describe('hasUnreadMessages', () => {
  it('returns false when the cursor is undefined (never read → no backlog dot)', () => {
    const messages = [msg({ created_at: 5000 })];
    expect(hasUnreadMessages(messages, undefined, OWN)).toBe(false);
  });

  it('returns true for a peer message newer than the cursor', () => {
    const messages = [msg({ pubkey: PEER, created_at: 2000 })];
    expect(hasUnreadMessages(messages, 1000, OWN)).toBe(true);
  });

  it('returns false when all messages are at or before the cursor', () => {
    const messages = [
      msg({ created_at: 1000 }),
      msg({ created_at: 500 }),
    ];
    expect(hasUnreadMessages(messages, 1000, OWN)).toBe(false);
  });

  it("ignores the user's own messages (no dot from your own post)", () => {
    const messages = [msg({ pubkey: OWN, created_at: 9999 })];
    expect(hasUnreadMessages(messages, 1000, OWN)).toBe(false);
  });

  it('still lights for a peer message even when an own message is also unread', () => {
    const messages = [
      msg({ pubkey: OWN, created_at: 9999 }),
      msg({ pubkey: PEER, created_at: 2000 }),
    ];
    expect(hasUnreadMessages(messages, 1000, OWN)).toBe(true);
  });

  it('ignores optimistic (pending) messages — only relay-confirmed count', () => {
    const messages = [msg({ pubkey: PEER, created_at: 5000, _pending: true })];
    expect(hasUnreadMessages(messages, 1000, OWN)).toBe(false);
  });

  it('returns false for an empty message list', () => {
    expect(hasUnreadMessages([], 1000, OWN)).toBe(false);
  });

  it('treats a message exactly at the cursor as read (strict >)', () => {
    const messages = [msg({ pubkey: PEER, created_at: 1000 })];
    expect(hasUnreadMessages(messages, 1000, OWN)).toBe(false);
  });
});
