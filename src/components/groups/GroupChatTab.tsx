import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MessageBubble,
  ReplyPreviewStrip,
  type ReplyPreviewData,
} from '@/components/chat/MessageBubble';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEvent } from '@/hooks/useEvent';
import { useGroupMessages, type GroupMessage } from '@/hooks/useGroupMessages';
import { useParentSigner } from '@/hooks/useParentSigner';
import { formatConversationTime } from '@/lib/dmUtils';
import { genUserName } from '@/lib/genUserName';
import { getReplyTarget, parseGroupAddr } from '@/lib/nip29';
import { cn } from '@/lib/utils';

interface GroupChatTabProps {
  addr: string;
  /**
   * Reserved for future admin-only actions (e.g. moderation surfaces).
   * Currently unused.
   */
  isAdmin: boolean;
}

/** Format a calendar-day label for inter-day separators. */
function formatDaySeparator(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = (startOf(today).getTime() - startOf(d).getTime()) / 86_400_000;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  if (d.getFullYear() === today.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Same calendar day? */
function sameDay(a: number, b: number): boolean {
  const da = new Date(a * 1000);
  const db = new Date(b * 1000);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** First 80 chars of a message, collapsed to one line. */
function buildExcerpt(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
}

export function GroupChatTab({ addr, isAdmin: _isAdmin }: GroupChatTabProps) {
  const { user } = useCurrentUser();
  // Group chat is signed by the parent (see useGroupMessages), so "is this my
  // message?" must compare against the parent pubkey, not the active kid.
  // Falls back to the active user when no family is configured.
  const { user: parentUser } = useParentSigner();
  const ownPubkey = parentUser?.pubkey ?? user?.pubkey;
  const { messages, sendMessage, isSending, isLoading } = useGroupMessages(addr);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Keep the latest message in view as new ones arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const messageById = useMemo(() => {
    const map = new Map<string, GroupMessage>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const getMessageById = useCallback(
    (id: string) => messageById.get(id),
    [messageById],
  );

  const groupRelay = useMemo(() => {
    try {
      return parseGroupAddr(addr).relay;
    } catch {
      return undefined;
    }
  }, [addr]);

  const scrollToMessage = useCallback((id: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const escaped = (window as unknown as { CSS?: typeof CSS }).CSS?.escape?.(id) ?? id;
    const el = root.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.dataset.highlight = 'true';
    window.setTimeout(() => {
      delete el.dataset.highlight;
    }, 1500);
  }, []);

  const handleRequestReply = useCallback((m: GroupMessage) => {
    if (m._pending || m._failed) return;
    setReplyTo(m);
  }, []);

  // Pre-compute groupings: consecutive messages from the same author within
  // the same calendar day collapse into a single visual cluster (single
  // author label + smaller gap), matching most messaging apps.
  const grouped = useMemo(() => {
    type Item =
      | { kind: 'separator'; key: string; label: string }
      | {
          kind: 'message';
          message: GroupMessage;
          showAuthor: boolean;
          showTimestamp: boolean;
          isClusterStart: boolean;
        };
    const out: Item[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const prev = messages[i - 1];
      const next = messages[i + 1];

      if (!prev || !sameDay(prev.created_at, m.created_at)) {
        out.push({ kind: 'separator', key: `sep-${m.id}`, label: formatDaySeparator(m.created_at) });
      }

      // New cluster when author changes or there's a >5-min gap.
      const isClusterStart =
        !prev ||
        prev.pubkey !== m.pubkey ||
        m.created_at - prev.created_at > 5 * 60 ||
        !sameDay(prev.created_at, m.created_at);
      // End of cluster when author changes, gap >5min, or it's the last message.
      const isClusterEnd =
        !next ||
        next.pubkey !== m.pubkey ||
        next.created_at - m.created_at > 5 * 60 ||
        !sameDay(next.created_at, m.created_at);

      // For own messages, suppress the repeated author label across any
      // same-author run on the same day — even with long gaps — because
      // there's no ambiguity about who sent it. Incoming messages keep
      // the time-gap rule so the label re-appears after a long pause.
      const isOwn = !!ownPubkey && m.pubkey === ownPubkey;
      const showAuthor = isOwn
        ? !prev || prev.pubkey !== m.pubkey || !sameDay(prev.created_at, m.created_at)
        : isClusterStart;

      out.push({
        kind: 'message',
        message: m,
        showAuthor,
        showTimestamp: isClusterEnd,
        isClusterStart,
      });
    }
    return out;
  }, [messages, ownPubkey]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || isSending) return;
    setError(null);
    const parent = replyTo ?? undefined;
    setDraft('');
    try {
      await sendMessage(body, parent);
      setReplyTo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed.');
    }
  };

  const onInputKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'Escape' && replyTo) {
      e.preventDefault();
      setReplyTo(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={scrollRef} className="flex-1 flex flex-col gap-1 px-4 pt-4 pb-2 overflow-y-auto">
        {isLoading && messages.length === 0 && (
          <div className="flex items-center justify-center gap-2 text-[12px] text-muted-foreground py-8">
            <Loader2 className="size-3.5 animate-spin" />
            Loading messages…
          </div>
        )}
        {!isLoading && messages.length === 0 && (
          <div className="text-[12px] text-muted-foreground text-center py-8">
            No messages yet. Say hi 👋
          </div>
        )}
        {grouped.map((item) =>
          item.kind === 'separator' ? (
            <DaySeparator key={item.key} label={item.label} />
          ) : (
            <ChatRow
              key={item.message.id}
              message={item.message}
              isOwn={!!ownPubkey && item.message.pubkey === ownPubkey}
              showAuthor={item.showAuthor}
              showTimestamp={item.showTimestamp}
              isClusterStart={item.isClusterStart}
              groupRelay={groupRelay}
              getMessageById={getMessageById}
              onScrollToMessage={scrollToMessage}
              onRequestReply={handleRequestReply}
            />
          ),
        )}
      </div>

      {error && (
        <div className="px-4 py-1 text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="size-3" />
          {error}
        </div>
      )}

      {replyTo && (
        <ReplyChip
          message={replyTo}
          onCancel={() => setReplyTo(null)}
        />
      )}

      <form className="px-4 pt-2 flex items-center gap-2 flex-shrink-0" onSubmit={onSubmit}>
        <Input
          placeholder={replyTo ? 'Reply…' : 'Type a message…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onInputKeyDown}
          className="h-11 rounded-full flex-1"
          disabled={!user}
        />
        <Button
          type="submit"
          size="icon"
          className="size-11 rounded-full flex-shrink-0"
          disabled={!draft.trim() || isSending || !user}
          aria-label="Send"
        >
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-2 px-2" role="separator" aria-label={label}>
      <div className="flex-1 h-px bg-border/50" />
      <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

function ChatRow({
  message,
  isOwn,
  showAuthor,
  showTimestamp,
  isClusterStart,
  groupRelay,
  getMessageById,
  onScrollToMessage,
  onRequestReply,
}: {
  message: GroupMessage;
  isOwn: boolean;
  showAuthor: boolean;
  showTimestamp: boolean;
  isClusterStart: boolean;
  groupRelay: string | undefined;
  getMessageById: (id: string) => GroupMessage | undefined;
  onScrollToMessage: (id: string) => void;
  onRequestReply: (m: GroupMessage) => void;
}) {
  // Resolve kind 0 for every author including the parent's own messages, so
  // we can render the parent's name above outgoing bubbles. The parent eye
  // uses this label to confirm a message was sent under their identity (not
  // a kid's). Kind 0 for the active user is typically already cached.
  const author = useAuthor(message.pubkey);
  const displayName =
    author.data?.metadata?.display_name ||
    author.data?.metadata?.name ||
    genUserName(message.pubkey);
  const picture = author.data?.metadata?.picture;

  // Tighter gap inside a cluster, normal gap when starting one.
  const rowGap = isClusterStart ? 'mt-1.5' : 'mt-0.5';

  const replyTarget = useMemo(() => getReplyTarget(message), [message]);
  const inListParent = replyTarget ? getMessageById(replyTarget.id) : undefined;

  // Only fetch the parent over the wire when it isn't already in our
  // loaded message page. Hint with the group's host relay first, then
  // the parent author's pubkey.
  const remoteRelays = useMemo(
    () => (replyTarget?.relay ? [replyTarget.relay, ...(groupRelay ? [groupRelay] : [])] : groupRelay ? [groupRelay] : undefined),
    [replyTarget?.relay, groupRelay],
  );
  const fetchedParent = useEvent(
    replyTarget && !inListParent ? replyTarget.id : undefined,
    remoteRelays,
    replyTarget?.pubkey,
  );

  const parent = inListParent ?? fetchedParent.data ?? null;
  const parentAuthor = useAuthor(parent ? parent.pubkey : undefined);

  const replyPreview: ReplyPreviewData | undefined = replyTarget
    ? parent
      ? {
          author:
            parentAuthor.data?.metadata?.display_name ||
            parentAuthor.data?.metadata?.name ||
            genUserName(parent.pubkey),
          excerpt: buildExcerpt(parent.content),
          onClick: inListParent ? () => onScrollToMessage(parent.id) : undefined,
        }
      : { author: '', excerpt: '', isMissing: true }
    : undefined;

  // Long-press handling for touch devices.
  const longPressTimer = useRef<number | null>(null);
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);
  useEffect(() => () => cancelLongPress(), [cancelLongPress]);

  const onTouchStart: React.TouchEventHandler<HTMLDivElement> = () => {
    cancelLongPress();
    longPressTimer.current = window.setTimeout(() => {
      onRequestReply(message);
      navigator.vibrate?.(10);
      longPressTimer.current = null;
    }, 500);
  };

  const onContextMenu: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    onRequestReply(message);
  };

  return (
    <div
      data-message-id={message.id}
      className={cn(
        'flex items-end gap-2 transition-colors duration-500',
        'data-[highlight=true]:bg-primary/15 data-[highlight=true]:rounded-lg',
        isOwn ? 'flex-row-reverse' : '',
        rowGap,
      )}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onTouchCancel={cancelLongPress}
    >
      {/* Avatar slot — only renders on the cluster start of incoming messages,
          so consecutive bubbles from the same person stack neatly. Keep an
          equal-sized spacer when hidden so bubbles align across rows. */}
      {!isOwn && (
        <div className="size-7 flex-shrink-0">
          {showAuthor ? (
            picture ? (
              <img src={picture} alt="" className="size-7 rounded-full object-cover" />
            ) : (
              <div
                className="size-7 rounded-full bg-slate-500 flex items-center justify-center text-white text-[10px] font-semibold"
                aria-hidden
              >
                {displayName.slice(0, 1).toUpperCase()}
              </div>
            )
          ) : null}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <MessageBubble
          align={isOwn ? 'end' : 'start'}
          author={showAuthor ? displayName : undefined}
          timestamp={
            showTimestamp && !message._pending && !message._failed
              ? formatConversationTime(message.created_at)
              : undefined
          }
          replyPreview={replyPreview}
          meta={
            <>
              {message._pending && <Loader2 className="size-3 animate-spin" />}
              {message._failed && <AlertCircle className="size-3 text-destructive" />}
            </>
          }
        >
          <span
            className={cn(
              message._pending && 'opacity-70',
              message._failed && 'opacity-70 line-through',
            )}
          >
            {message.content}
          </span>
        </MessageBubble>
      </div>
    </div>
  );
}

function ReplyChip({
  message,
  onCancel,
}: {
  message: GroupMessage;
  onCancel: () => void;
}) {
  const author = useAuthor(message.pubkey);
  const name =
    author.data?.metadata?.display_name ||
    author.data?.metadata?.name ||
    genUserName(message.pubkey);

  return (
    <div className="px-4 pt-2 flex-shrink-0">
      <ReplyPreviewStrip
        tone="standalone"
        data={{ author: `Replying to ${name}`, excerpt: buildExcerpt(message.content) }}
        onDismiss={onCancel}
      />
    </div>
  );
}
