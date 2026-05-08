import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Chat-bubble primitive shared by the Group view (and reusable for any
 * future chat surface).
 *
 * Visual: both outgoing (`align="end"`) and incoming bubbles use the
 * same card token so the conversation reads as a single thread; only
 * the asymmetric corner and column alignment differ. The optional
 * `timestamp` (already-formatted string) renders below the message
 * text in a muted color, mirroring the DM chat style.
 */
export interface ReplyPreviewData {
  author: string;
  excerpt: string;
  onClick?: () => void;
  /** Parent not yet resolved — show an italic placeholder instead. */
  isMissing?: boolean;
}

export function MessageBubble({
  align,
  children,
  author,
  timestamp,
  meta,
  replyPreview,
}: {
  align: 'start' | 'end';
  children: React.ReactNode;
  /**
   * Optional author label shown above the bubble. Renders on either side
   * depending on `align` — for outgoing group-chat messages it shows the
   * parent's name so a parent eye can confirm a message was sent under
   * their identity (not a kid's, even when a kid is the active account).
   */
  author?: string;
  /** Pre-formatted timestamp string (e.g. "2:45 PM"). */
  timestamp?: string;
  /** Optional trailing icon slot — e.g. a "sending" spinner or "failed" warning. */
  meta?: React.ReactNode;
  /** When set, renders a "replying to <author>" strip above the message. */
  replyPreview?: ReplyPreviewData;
}) {
  const isEnd = align === 'end';
  return (
    <div className={cn('w-full flex flex-col gap-0.5', isEnd ? 'items-end' : 'items-start')}>
      {author && (
        <span className={cn('text-[10px] text-muted-foreground', isEnd ? 'pr-3' : 'pl-3')}>
          {author}
        </span>
      )}
      <div
        className={cn(
          'max-w-[80%] px-3 py-2 text-[13px] leading-snug',
          isEnd
            ? 'bg-card text-foreground rounded-2xl rounded-tr-sm'
            : 'bg-card text-foreground rounded-2xl rounded-tl-sm',
        )}
      >
        {replyPreview && (
          <ReplyPreviewStrip
            data={replyPreview}
            tone={isEnd ? 'on-primary' : 'on-card'}
            className="mb-1.5"
          />
        )}
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {children}
        </div>
        {(timestamp || meta) && (
          <div
            className={cn(
              'flex items-center gap-1 mt-1 text-[10px]',
              isEnd ? 'justify-end opacity-60' : 'opacity-60',
            )}
          >
            {timestamp && <span>{timestamp}</span>}
            {meta}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "Replying to <author>" strip. Used both inside an outgoing/incoming
 * bubble (compact, themed against the bubble background) and above the
 * input bar as a standalone chip with a dismiss button.
 */
export function ReplyPreviewStrip({
  data,
  tone,
  onDismiss,
  className,
}: {
  data: ReplyPreviewData;
  /** `on-primary` = sitting on an outgoing bubble; `on-card` = on an incoming bubble; `standalone` = chip above the input. (Outgoing and incoming now share the same card tone, but the prop is kept for forward-compat in case the outgoing bubble re-skins.) */
  tone: 'on-primary' | 'on-card' | 'standalone';
  /** When provided, renders a small × on the right that cancels the reply. */
  onDismiss?: () => void;
  className?: string;
}) {
  const { author, excerpt, onClick, isMissing } = data;

  const palette =
    tone === 'on-primary' || tone === 'on-card'
      ? {
          wrapper: 'bg-muted/40 text-muted-foreground',
          accent: 'bg-primary',
          authorTone: 'text-foreground',
          excerptTone: 'text-muted-foreground',
          hover: 'hover:bg-muted/60',
        }
      : {
          wrapper: 'bg-card text-muted-foreground border border-border/60',
          accent: 'bg-primary',
          authorTone: 'text-foreground',
          excerptTone: 'text-muted-foreground',
          hover: 'hover:bg-card/80',
        };

  const interactive = !!onClick;
  const Wrapper: 'button' | 'div' = interactive ? 'button' : 'div';

  return (
    <div className={cn('flex items-stretch gap-2 rounded-md overflow-hidden', palette.wrapper, className)}>
      <Wrapper
        type={interactive ? 'button' : undefined}
        onClick={onClick}
        className={cn(
          'flex-1 min-w-0 flex items-stretch gap-2 px-2 py-1 text-left',
          interactive && cn('cursor-pointer', palette.hover),
        )}
      >
        <span className={cn('w-[3px] flex-shrink-0 rounded-full', palette.accent)} aria-hidden />
        <span className="flex-1 min-w-0 flex flex-col justify-center">
          <span className={cn('text-[11px] font-semibold truncate', palette.authorTone)}>
            {author}
          </span>
          <span
            className={cn(
              'text-[11px] truncate',
              palette.excerptTone,
              isMissing && 'italic opacity-80',
            )}
          >
            {isMissing ? 'Replied message' : excerpt}
          </span>
        </span>
      </Wrapper>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cancel reply"
          className={cn('flex-shrink-0 px-2 flex items-center', palette.hover)}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
