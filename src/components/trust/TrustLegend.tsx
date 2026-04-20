import { cn } from '@/lib/utils';

/**
 * Horizontal legend explaining the three Kubo trust levels.
 *
 * Used at the top of both Trust · People and Trust · Places so parents
 * can decode the colored dot without having to tap a row. Order matches
 * semantic strength: Extend (strongest) → Interact → View (weakest).
 */
export function TrustLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground px-1',
        className,
      )}
    >
      <LegendItem color="bg-[#22C55E]" label="Extend" />
      <LegendItem color="bg-primary" label="Interact" />
      <LegendItem color="bg-[#EF4444]" label="View" />
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-1.5 rounded-full', color)} aria-hidden />
      {label}
    </span>
  );
}
