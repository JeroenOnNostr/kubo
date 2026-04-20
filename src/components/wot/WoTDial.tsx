import { cn } from '@/lib/utils';

/**
 * Conic-gradient scoring dial used on the WoT score page.
 *
 * Visual only. Renders a circular gauge filled from 0° to
 * `score/max * 360°`, with the score centered in the cutout. Color
 * gradates green → orange → red at score bands so the dial reads at a
 * glance without labels.
 */
export function WoTDial({
  score,
  max = 100,
  size = 180,
  thickness = 14,
  className,
}: {
  score: number;
  max?: number;
  size?: number;
  thickness?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(max, score));
  const pct     = clamped / max;
  const angle   = Math.round(pct * 360);

  // Score-band color for the filled arc.
  const color =
    pct >= 0.66 ? '#22C55E' :
    pct >= 0.33 ? '#F97316' :
                  '#EF4444';

  return (
    <div
      className={cn('relative flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Web of trust score ${clamped} out of ${max}`}
    >
      {/* Arc */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(${color} 0deg ${angle}deg, hsl(var(--muted)) ${angle}deg 360deg)`,
        }}
        aria-hidden
      />
      {/* Cutout */}
      <div
        className="absolute rounded-full bg-background"
        style={{ inset: thickness }}
        aria-hidden
      />
      {/* Label */}
      <div className="relative z-10 flex flex-col items-center text-center">
        <span className="text-4xl font-bold tabular-nums leading-none">{clamped}</span>
        <span className="text-[11px] text-muted-foreground mt-1">out of {max}</span>
      </div>
    </div>
  );
}
