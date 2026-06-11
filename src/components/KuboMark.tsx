import { cn } from '@/lib/utils';

interface KuboMarkProps {
  size?: number;
  className?: string;
}

/**
 * Kubo logo mark — four rounded squares.
 *
 * Rendered as an INLINE <svg> (not <img src="/logo-color.svg">) so it paints
 * synchronously with the rest of the DOM. A freshly-inserted <img> isn't
 * guaranteed to decode within the same frame, which made the boot loading
 * screen show its halo with the logo missing for ~2 frames, then pop in
 * (KUBO-140). Inline markup removes that decode gap entirely.
 *
 * NOTE: public/logo-color.svg must stay on disk — the favicon and the
 * pre-React #preloader in index.html still reference it as a file. Keep this
 * markup in sync with that file AND with the #preloader's inline copy. The
 * React loading splash (KuboLoadingScreen.tsx) reuses THIS component, so it
 * needs no separate copy.
 */
export function KuboMark({ size = 48, className }: KuboMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 70 70"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('block', className)}
      aria-hidden="true"
    >
      <rect x="70" y="34.0001" width="34.0001" height="34.0001" rx="9" transform="rotate(-180 70 34.0001)" fill="#06B6D4" />
      <rect x="70" y="70.0001" width="34.0001" height="34.0001" rx="9" transform="rotate(-180 70 70.0001)" fill="#22C55E" />
      <rect x="34" y="34.0001" width="34.0001" height="34.0001" rx="9" transform="rotate(-180 34 34.0001)" fill="#F97316" />
      <rect x="34" y="70.0001" width="34.0001" height="34.0001" rx="9" transform="rotate(-180 34 70.0001)" fill="#6366F1" />
    </svg>
  );
}
