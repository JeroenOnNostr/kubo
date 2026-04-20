import { cn } from '@/lib/utils';

/**
 * Chat-bubble primitive used by the Group view.
 *
 * Visual only: tail + background depend on `align`. Outgoing messages
 * (`align="end"`) use the primary (orange) fill; incoming messages use
 * the card token so they sit quietly on the dark background.
 */
export function MessageBubble({
  align,
  children,
  author,
}: {
  align: 'start' | 'end';
  children: React.ReactNode;
  /** Optional author label shown above the bubble (incoming only). */
  author?: string;
}) {
  const isEnd = align === 'end';
  return (
    <div className={cn('flex flex-col gap-1', isEnd ? 'items-end' : 'items-start')}>
      {author && !isEnd && (
        <span className="text-[10px] text-muted-foreground pl-3">{author}</span>
      )}
      <div
        className={cn(
          'max-w-[80%] px-3 py-2 text-[13px] leading-snug',
          isEnd
            ? 'bg-primary text-primary-foreground rounded-2xl rounded-tr-sm'
            : 'bg-card text-foreground rounded-2xl rounded-tl-sm',
        )}
      >
        {children}
      </div>
    </div>
  );
}
