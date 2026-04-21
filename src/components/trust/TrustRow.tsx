import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TrustLevel = 'extend' | 'interact' | 'view';

interface TrustRowProps {
  /** Leading avatar content — image URL, initial, or any ReactNode. */
  avatar: React.ReactNode;
  /** Hex for the avatar fallback background when `avatar` is a string/initial. */
  avatarBg?: string;
  name: string;
  /** Optional subtitle ("via Soccer team B3", "18 members"…). */
  subtitle?: string;
  level: TrustLevel;
  onClick?: () => void;
  /**
   * When true, rotates the chevron to point down and drops the bottom border
   * radius so an expand panel rendered directly below reads as a continuation.
   */
  expanded?: boolean;
}

const LEVEL_DOT: Record<TrustLevel, string> = {
  extend:   'bg-[#22C55E] shadow-[0_0_0_3px_rgba(34,197,94,0.2)]',
  interact: 'bg-primary    shadow-[0_0_0_3px_rgba(249,115,22,0.2)]',
  view:     'bg-[#EF4444] shadow-[0_0_0_3px_rgba(239,68,68,0.2)]',
};

/**
 * Option-C trust row — dot + expand.
 *
 * The dot encodes current level at rest (low noise). Tapping the whole
 * row opens a detail sheet/expanded state where the parent picks a level
 * — deliberate, not cycle-on-tap (avoids accidents). The expanded state
 * itself lives in a separate component (later PR); this row is the
 * collapsed presentation.
 *
 * Visual only: `onClick` is wired through so a parent screen can hook it
 * up later, but this file does not own any state.
 */
export function TrustRow({
  avatar, avatarBg, name, subtitle, level, onClick, expanded = false,
}: TrustRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={cn(
        'w-full flex items-center gap-3 p-2.5 bg-card/60',
        'hover:bg-card active:bg-card transition-colors text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        expanded ? 'rounded-t-xl' : 'rounded-xl',
      )}
    >
      <div
        className="size-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0"
        style={avatarBg ? { backgroundColor: avatarBg } : undefined}
        aria-hidden
      >
        {avatar}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{name}</div>
        {subtitle && (
          <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
        )}
      </div>
      <span
        className={cn('size-2.5 rounded-full flex-shrink-0', LEVEL_DOT[level])}
        aria-label={`Trust level: ${level}`}
      />
      <ChevronRight
        className={cn(
          'size-4 text-muted-foreground flex-shrink-0 transition-transform',
          expanded && 'rotate-90',
        )}
        aria-hidden
      />
    </button>
  );
}
