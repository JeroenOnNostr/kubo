import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * Source-category tile used on /parent/feed. Renders an icon, title,
 * one-line description, a count badge, and a horizontal strip of up to
 * 5 chips previewing enabled items. Empty state shows "Tap to add".
 *
 * Chips deliberately take `avatarUrl` pre-resolved — this component does
 * NOT fetch metadata. Callers must pass already-resolved chip data so we
 * keep one batched metadata query per source type (M1), not one per chip.
 */
export interface FeedSourceChip {
  key: string;
  label: string;
  avatarUrl?: string;
}

export interface FeedSourceTileProps {
  icon: ReactNode;
  title: string;
  description: string;
  enabledCount: number;
  /**
   * Pre-resolved chip data. Use when chip metadata is already in hand (e.g.
   * a synchronous lookup). For async metadata (NIP-11 for relays, kind-0 for
   * profiles, kind-34550 for communities), pass `chipRenderer` instead —
   * the parent page is responsible for batching those fetches (M1).
   */
  chips: FeedSourceChip[];
  /**
   * Optional custom chip strip. When provided, this replaces the default
   * chip rendering — callers are expected to emit up to 5 chip-shaped
   * spans themselves (see RelayChipItem for the shape).
   */
  chipRenderer?: ReactNode;
  onClick: () => void;
}

const MAX_VISIBLE_CHIPS = 5;

export function FeedSourceTile({
  icon,
  title,
  description,
  enabledCount,
  chips,
  chipRenderer,
  onClick,
}: FeedSourceTileProps) {
  const visible = chips.slice(0, MAX_VISIBLE_CHIPS);
  const overflow = Math.max(0, enabledCount - Math.max(visible.length, chipRenderer ? Math.min(enabledCount, MAX_VISIBLE_CHIPS) : 0));

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex flex-col gap-2 p-3 rounded-xl bg-card hover:bg-card/80 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">{title}</span>
            {enabledCount > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                {enabledCount}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{description}</div>
        </div>
        <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" aria-hidden />
      </div>

      {enabledCount === 0 ? (
        <div className="pl-[52px] text-[11px] text-muted-foreground italic">
          Tap to add
        </div>
      ) : (
        <div className="pl-[52px] flex items-center gap-1.5 overflow-hidden">
          {chipRenderer ? (
            chipRenderer
          ) : (
            visible.map((chip) => (
              <span
                key={chip.key}
                className="flex items-center gap-1 h-6 pl-1 pr-2 rounded-full bg-muted text-[11px] max-w-[8rem]"
                title={chip.label}
              >
                {chip.avatarUrl ? (
                  <img
                    src={chip.avatarUrl}
                    alt=""
                    className="size-4 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <span className="size-4 rounded-full bg-primary/20 flex-shrink-0" />
                )}
                <span className="truncate">{chip.label}</span>
              </span>
            ))
          )}
          {overflow > 0 && (
            <span className="h-6 px-2 rounded-full bg-muted text-[11px] text-muted-foreground flex items-center">
              +{overflow}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
