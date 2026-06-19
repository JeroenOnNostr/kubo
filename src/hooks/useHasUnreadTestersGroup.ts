import { useMemo } from 'react';

import { useEncryptedSettings } from './useEncryptedSettings';
import { useGroupMessages, type GroupMessage } from './useGroupMessages';
import { useParentSigner } from './useParentSigner';
import { KUBO_TESTERS_GROUP } from '@/lib/appRelays';

/**
 * Pure unread decision (extracted so it's unit-testable without renderHook).
 *
 * A message counts as unread when it is relay-confirmed (not optimistic),
 * authored by someone other than the user, and newer than the read cursor.
 * `cursor === undefined` means "never read" → nothing is unread yet, so a
 * fresh install doesn't badge the whole backlog.
 */
export function hasUnreadMessages(
  messages: GroupMessage[],
  cursor: number | undefined,
  ownPubkey: string | undefined,
): boolean {
  if (cursor === undefined) return false;
  return messages.some(
    (m) => !m._pending && m.pubkey !== ownPubkey && m.created_at > cursor,
  );
}

/**
 * True when the Kubo Testers group has chat messages newer than the user's
 * last-read cursor — drives the unread dot on the Support nav tab (KUBO-191).
 *
 * Cold-start: until the user has opened the group once (no stored cursor), we
 * return `false`. Otherwise a fresh install would show a permanent dot for the
 * whole pre-existing backlog. Opening the group writes the cursor
 * (GroupViewPage), after which any genuinely-new message lights the dot.
 *
 * Own messages don't count: a chat badge shouldn't light from the user's own
 * post (same rule as useHasUnreadNotifications). Group messages are
 * parent-attributed, so we compare against the *parent* pubkey — matching how
 * GroupChatTab computes `isOwn` via useParentSigner.
 *
 * Reuses `useGroupMessages`, which already fetches kind-9/11 and keeps a live
 * subscription open, so the dot updates in near-real-time without extra polling.
 */
export function useHasUnreadTestersGroup(): boolean {
  const { settings } = useEncryptedSettings();
  const { messages } = useGroupMessages(KUBO_TESTERS_GROUP);
  const { user: parentUser } = useParentSigner();

  const cursor = settings?.groupCursors?.[KUBO_TESTERS_GROUP];
  const ownPubkey = parentUser?.pubkey;

  return useMemo(
    () => hasUnreadMessages(messages, cursor, ownPubkey),
    [messages, cursor, ownPubkey],
  );
}
