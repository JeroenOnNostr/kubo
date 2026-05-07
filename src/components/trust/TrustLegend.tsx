import { cn } from '@/lib/utils';

type Scope = 'people' | 'places';

/**
 * Vertical legend explaining the three Kubo trust levels, used at the top of
 * Trust · People and Trust · Places. Order matches semantic strength:
 * View (weakest) → Interact → Extend (strongest).
 */
export function TrustLegend({
  className,
}: {
  kidName?: string;
  scope?: Scope;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 text-[11px] text-muted-foreground px-1',
        className,
      )}
    >
      <p className="leading-snug">
        Assign trust levels to decide what can happen outside of your kid's
        feed.
      </p>
      <ul className="flex flex-col gap-1 pl-1">
        <LegendItem
          color="bg-[#EF4444]"
          label="View"
          description="appears in feed and comments"
        />
        <LegendItem
          color="bg-primary"
          label="Interact"
          description="allows replies and reactions"
        />
        <LegendItem
          color="bg-[#22C55E]"
          label="Extend"
          description="adopts their trusted people and places as View"
        />
      </ul>
    </div>
  );
}

function LegendItem({
  color,
  label,
  description,
}: {
  color: string;
  label: string;
  description: string;
}) {
  return (
    <li className="flex items-center gap-1.5 leading-snug">
      <span className={cn('size-1.5 rounded-full shrink-0', color)} aria-hidden />
      <span>
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground"> — {description}</span>
      </span>
    </li>
  );
}
