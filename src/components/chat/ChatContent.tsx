import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useAuthor } from '@/hooks/useAuthor';
import { useProfileUrl } from '@/hooks/useProfileUrl';
import { genUserName } from '@/lib/genUserName';
import { ProfileHoverCard } from '@/components/ProfileHoverCard';
import { EmojifiedText } from '@/components/CustomEmoji';
import { ImageGallery } from '@/components/ImageGallery';
import { tokenizeChat, type ChatToken } from '@/lib/chatTokens';
import { parseImetaMap } from '@/lib/imeta';
import { IMAGE_URL_REGEX } from '@/lib/mediaUrls';
import { cn } from '@/lib/utils';

interface ChatContentProps {
  /** Raw message body (kind 9/11 content). */
  content: string;
  /**
   * The message event's tags. `imeta` entries here gate which URLs in `content`
   * render as inline images (intentional uploads) rather than plain links.
   */
  tags?: string[][];
  className?: string;
}

const INLINE_CLASS = 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]';

/**
 * Renders a chat message body with Nostr mentions resolved to profile names,
 * plus clickable hashtags and links. Used by NIP-29 group chat (and reusable
 * by any future chat surface) so that a `nostr:npub1…` someone typed shows up
 * as `@Alice`, not a raw key.
 *
 * Images the sender attached (their URLs described by the event's `imeta` tags)
 * render as an inline gallery below the text; arbitrary pasted image URLs stay
 * plain links, keeping the bubble compact.
 */
export function ChatContent({ content, tags, className }: ChatContentProps) {
  const imetaMap = useMemo(() => parseImetaMap(tags ?? []), [tags]);
  // URLs the sender attached as images — imeta declares image/*, or the URL
  // itself has an image extension. Only these become inline images.
  const imageUrls = useMemo(
    () =>
      new Set(
        Array.from(imetaMap.values())
          .filter((e) => e.mime?.startsWith('image/') || IMAGE_URL_REGEX.test(e.url))
          .map((e) => e.url),
      ),
    [imetaMap],
  );
  const tokens = useMemo(() => tokenizeChat(content, imageUrls), [content, imageUrls]);

  const embeddedImageUrls = tokens.flatMap((t) => (t.type === 'image-embed' ? [t.url] : []));
  const inlineTokens = tokens.filter((t) => t.type !== 'image-embed');
  // Trim trailing whitespace-only text left behind when the appended image URL
  // (on its own line) is lifted into the image block below — avoids a blank gap.
  while (inlineTokens.length > 0) {
    const last = inlineTokens[inlineTokens.length - 1];
    if (last.type === 'text' && last.value.trim() === '') inlineTokens.pop();
    else break;
  }

  // No attachments → a single inline span, exactly as before.
  if (embeddedImageUrls.length === 0) {
    return <span className={cn(INLINE_CLASS, className)}>{inlineTokens.map(renderInlineToken)}</span>;
  }

  // With attachments → the caption span (if any) above an inline image gallery.
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {inlineTokens.length > 0 && (
        <span className={INLINE_CLASS}>{inlineTokens.map(renderInlineToken)}</span>
      )}
      <div className="w-60 max-w-full">
        <ImageGallery images={embeddedImageUrls} imetaMap={imetaMap} className="!mt-0 !rounded-xl" />
      </div>
    </div>
  );
}

/** Render one inline (non-image) chat token. */
function renderInlineToken(token: ChatToken, i: number): ReactNode {
  switch (token.type) {
    case 'text':
      return <span key={i}>{token.value}</span>;
    case 'mention':
      return <ChatMention key={i} pubkey={token.pubkey} />;
    case 'link':
      return (
        <a
          key={i}
          href={token.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {token.url}
        </a>
      );
    case 'hashtag':
      return (
        <Link
          key={i}
          to={`/t/${token.tag}`}
          className="text-primary hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {token.raw}
        </Link>
      );
    case 'nostr-link':
      return (
        <Link
          key={i}
          to={`/${token.id}`}
          className="text-primary hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {token.raw}
        </Link>
      );
    case 'image-embed':
      // Rendered as a block gallery below the text, not inline.
      return null;
  }
}

/** Inline `@name` mention, resolved via kind-0 and linked to the profile. */
function ChatMention({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const hasRealName = !!author.data?.metadata?.name;
  const displayName = author.data?.metadata?.name ?? genUserName(pubkey);
  const profileUrl = useProfileUrl(pubkey, author.data?.metadata);

  return (
    <ProfileHoverCard pubkey={pubkey} asChild>
      <Link
        to={profileUrl}
        className={cn(
          'font-medium hover:underline',
          hasRealName ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        @{author.data?.event ? (
          <EmojifiedText tags={author.data.event.tags}>{displayName}</EmojifiedText>
        ) : displayName}
      </Link>
    </ProfileHoverCard>
  );
}
