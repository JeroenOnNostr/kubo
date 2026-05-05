import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

interface BrowseSectionShellProps {
  /** Section title shown in the header (e.g. "Browse all"). */
  title?: string;
  /** Result count shown next to the title when expanded. Hidden when 0. */
  count?: number;
  /**
   * Force-open the section regardless of user toggle. Used to auto-expand
   * when the user has typed a search query so matches are immediately
   * visible without an extra click.
   */
  forceOpen?: boolean;
  /** Disclosure body — typically the list of rows or an EmptyState. */
  children: React.ReactNode;
}

/**
 * Collapsible "Browse all" section header used by Trust→Places and the three
 * feed-source pages (Relays, Communities, Follow packs). Default-collapsed
 * to reduce visual clutter on first open of each page; auto-expands when the
 * caller passes `forceOpen` (e.g. while a search query is non-empty) and
 * collapses again when forceOpen flips back to false.
 *
 * The user's manual toggle persists across forceOpen transitions: if they
 * explicitly opened the section, it stays open after they clear the search.
 */
export function BrowseSectionShell({
  title = 'Browse all',
  count,
  forceOpen = false,
  children,
}: BrowseSectionShellProps) {
  const [userOpen, setUserOpen] = useState(false);
  const open = forceOpen || userOpen;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setUserOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1.5 px-1 py-1 -mx-1 rounded',
          'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
          'hover:text-foreground transition-colors text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        )}
      >
        <ChevronRight
          className={cn('size-3 transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        <span>
          {title}
          {open && typeof count === 'number' && count > 0 ? ` · ${count}` : ''}
        </span>
      </button>
      {open && children}
    </div>
  );
}
