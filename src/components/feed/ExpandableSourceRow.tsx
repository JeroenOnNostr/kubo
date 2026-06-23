import type { ReactNode } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { SourceActionButton } from '@/components/feed/SourceActionButton';

/**
 * Shared row used by the three feed-source browse pages (Relays,
 * Communities, Packs). Click the row body to expand the accordion
 * (reveals `description` + optional `footer`). The Add/Remove button sits
 * OUTSIDE the AccordionTrigger so adding/removing never expands/collapses.
 *
 * Each row is its own one-item Accordion (type="multiple" so multiple
 * rows can be open). This keeps rows independent across multiple
 * parent sections ("Enabled" above, "Browse all" below) without having
 * to share a single Accordion root.
 */
export interface ExpandableSourceRowProps {
  /** Stable identifier — used for AccordionItem `value`. */
  rowKey: string;
  /** Square avatar/icon on the left. */
  avatar: ReactNode;
  /** Main title (e.g. relay name, community name, pack title). */
  title: string;
  /** Muted subtitle (e.g. URL, member count, hostname). */
  subtitle?: string;
  /** Optional row of small badges under the subtitle (NIPs, etc.). */
  badges?: ReactNode;
  /** Shown in the expanded body. Falls back to placeholder text if empty. */
  description?: string;
  /** Additional content below the description (links, buttons). */
  footer?: ReactNode;
  /** Current enabled state. */
  enabled: boolean;
  /** Toggle handler. */
  onToggle: () => void;
  /**
   * Fired when the accordion opens/closes. Use to lazy-load expensive
   * metadata (e.g. NIP-11 HTTP fetches) only for rows the user actually
   * inspects — KUBO-054 perf fix.
   */
  onOpenChange?: (open: boolean) => void;
}

export function ExpandableSourceRow({
  rowKey,
  avatar,
  title,
  subtitle,
  badges,
  description,
  footer,
  enabled,
  onToggle,
  onOpenChange,
}: ExpandableSourceRowProps) {
  return (
    <Accordion
      type="multiple"
      className="rounded-xl bg-card"
      onValueChange={
        onOpenChange
          ? (values) => onOpenChange(values.includes(rowKey))
          : undefined
      }
    >
      <AccordionItem value={rowKey} className="border-none">
        {/*
          Outer flex row. AccordionTrigger renders as `<h3 class="flex"> >
          <button>…</button></h3>`; Tailwind classes passed to <AccordionTrigger />
          apply to the inner button, NOT the <h3> wrapper. Without an explicit
          `flex-1` on the wrapping <h3>, the header sizes to its content and
          the Switch drifts left/right as titles vary. We force the header to
          grow with `[&>h3]:flex-1 [&>h3]:min-w-0` so the Switch slot is
          consistently pushed to the right edge across all rows.
        */}
        <div className="flex items-stretch pr-3 [&>h3]:flex-1 [&>h3]:min-w-0">
          <AccordionTrigger
            className="flex-1 min-w-0 px-3 py-3 hover:no-underline"
            aria-label={`Expand ${title}`}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 text-left">
              <div className="shrink-0">{avatar}</div>
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-sm font-medium leading-tight"
                  title={title}
                >
                  {title}
                </div>
                {subtitle && (
                  <div
                    className="truncate text-[11px] text-muted-foreground"
                    title={subtitle}
                  >
                    {subtitle}
                  </div>
                )}
                {badges && <div className="mt-1">{badges}</div>}
              </div>
            </div>
          </AccordionTrigger>
          <div className="shrink-0 flex items-center justify-end pl-2">
            <SourceActionButton
              action={enabled ? 'remove' : 'add'}
              onClick={onToggle}
              itemLabel={title}
            />
          </div>
        </div>
        <AccordionContent className="px-3 pb-3 pt-0">
          <div className="text-[12px] text-muted-foreground leading-relaxed">
            {description?.trim() || (
              <span className="italic">No description provided.</span>
            )}
          </div>
          {footer && <div className="mt-2">{footer}</div>}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
