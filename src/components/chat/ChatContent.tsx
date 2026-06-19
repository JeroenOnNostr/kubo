import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useAuthor } from '@/hooks/useAuthor';
import { useProfileUrl } from '@/hooks/useProfileUrl';
import { genUserName } from '@/lib/genUserName';
import { ProfileHoverCard } from '@/components/ProfileHoverCard';
import { EmojifiedText } from '@/components/CustomEmoji';
import { tokenizeChat } from '@/lib/chatTokens';
import { cn } from '@/lib/utils';

interface ChatContentProps {
  /** Raw message body (kind 9/11 content). */
  content: string;
  className?: string;
}

/**
 * Renders a chat message body with Nostr mentions resolved to profile names,
 * plus clickable hashtags and links. Used by NIP-29 group chat (and reusable
 * by any future chat surface) so that a `nostr:npub1…` someone typed shows up
 * as `@Alice`, not a raw key.
 */
export function ChatContent({ content, className }: ChatContentProps) {
  const tokens = useMemo(() => tokenizeChat(content), [content]);

  return (
    <span className={cn('whitespace-pre-wrap break-words [overflow-wrap:anywhere]', className)}>
      {tokens.map((token, i): ReactNode => {
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
        }
      })}
    </span>
  );
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
