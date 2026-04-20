import { cn } from '@/lib/utils';

/**
 * Uppercase section heading used inside Trust People / Places to break
 * the list into "Inner circle", "Groups", "Other", etc.
 *
 * The optional trailing note ("· extend trust") describes what that
 * section's membership implies, without making the heading wrap.
 */
export function TrustSection({
  title,
  note,
  action,
  className,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-2 mt-1 mb-0.5 px-1',
        className,
      )}
    >
      <h3 className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">
        {title}
        {note && (
          <span className="ml-1.5 normal-case tracking-normal font-normal text-muted-foreground/80">
            · {note}
          </span>
        )}
      </h3>
      {action && <div>{action}</div>}
    </div>
  );
}
