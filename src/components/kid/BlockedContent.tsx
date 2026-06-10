import { ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * KUBO-163 — kid-friendly "blocked by your grown-up" card.
 *
 * Rendered in place of denied content on read-side surfaces (post detail,
 * profile) when the active kid's TEPP construct denies visibility. Deliberately
 * non-alarming: it doesn't say "blacklisted" or expose who/why, just that a
 * grown-up has it set aside — matching the deep-blue KuboKidLayout aesthetic.
 *
 * This is a render-GATE card: callers must return it BEFORE painting the denied
 * content (never a post-render bounce), so denied content never flashes.
 */
export function BlockedContent({
  message = "Your grown-up has this set aside, so it's not here right now.",
  className,
}: {
  /** Override the default kid-friendly copy. */
  message?: string;
  className?: string;
}) {
  return (
    <div
      data-kubo-tepp-blocked
      className={cn(
        'mx-4 flex flex-col items-center gap-3 rounded-2xl bg-white/10 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-2xl bg-white/15">
        <ShieldCheck className="size-7 text-white" strokeWidth={2.25} aria-hidden />
      </div>
      <p className="max-w-[260px] text-[13px] leading-relaxed text-white/80">
        {message}
      </p>
    </div>
  );
}
