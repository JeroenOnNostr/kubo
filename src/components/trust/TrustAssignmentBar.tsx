import { useState } from 'react';

import { useToast } from '@/hooks/useToast';
import { type KuboTrustLevel } from '@/hooks/useKuboFamily';
import { useTrustAssignments } from '@/hooks/useTrustAssignments';
import { cn } from '@/lib/utils';

interface TrustAssignmentBarProps {
  kidPubkey: string;
  pubkey: string;
  /** Called after any action so the parent can collapse the row. */
  onDone?: () => void;
}

type LevelConfig = {
  level: KuboTrustLevel;
  label: string;
  activeClass: string;
};

const LEVELS: LevelConfig[] = [
  { level: 'extend',   label: 'Extend',   activeClass: 'bg-[#22C55E] text-white shadow-[0_0_0_3px_rgba(34,197,94,0.2)]' },
  { level: 'interact', label: 'Interact', activeClass: 'bg-primary text-primary-foreground shadow-[0_0_0_3px_rgba(249,115,22,0.2)]' },
  { level: 'view',     label: 'View',     activeClass: 'bg-[#EF4444] text-white shadow-[0_0_0_3px_rgba(239,68,68,0.2)]' },
];

/**
 * Inline trust-level action bar. Rendered directly under a TrustRow when the
 * row is expanded. Writes to local trustAssignments via useTrustAssignments —
 * no Nostr event published (KUBO-013 will define the kind later).
 */
export function TrustAssignmentBar({
  kidPubkey,
  pubkey,
  onDone,
}: TrustAssignmentBarProps) {
  const { get, setLevel, clear } = useTrustAssignments(kidPubkey);
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const current = get(pubkey);

  const handleSet = async (level: KuboTrustLevel) => {
    if (pending) return;
    setPending(true);
    try {
      await setLevel(pubkey, level);
      onDone?.();
    } catch (err) {
      toast({
        title: 'Could not save trust level',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setPending(false);
    }
  };

  const handleRemove = async () => {
    if (pending) return;
    setPending(true);
    try {
      await clear(pubkey);
      onDone?.();
    } catch (err) {
      toast({
        title: 'Could not clear trust level',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <TrustAssignmentBarVisual
      currentLevel={current}
      pending={pending}
      onSetLevel={handleSet}
      onClear={handleRemove}
    />
  );
}

/**
 * Pure-visual variant of TrustAssignmentBar — same buttons, no persistence.
 * Used by TrustPlacesPage where we render the trust-level UI but don't yet
 * have a data model for "trusted relays" (TEPP, future feature).
 */
interface TrustAssignmentBarVisualProps {
  currentLevel: KuboTrustLevel | undefined;
  onSetLevel: (level: KuboTrustLevel) => void;
  onClear: () => void;
  pending?: boolean;
}

export function TrustAssignmentBarVisual({
  currentLevel,
  onSetLevel,
  onClear,
  pending = false,
}: TrustAssignmentBarVisualProps) {
  return (
    <div className="flex items-center gap-2 pt-1">
      {LEVELS.map((opt) => {
        const active = currentLevel === opt.level;
        return (
          <button
            key={opt.level}
            type="button"
            onClick={() => onSetLevel(opt.level)}
            disabled={pending}
            aria-pressed={active}
            className={cn(
              'flex-1 h-9 rounded-full text-[13px] font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              'disabled:opacity-60',
              active
                ? opt.activeClass
                : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-card',
            )}
          >
            {opt.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onClear}
        disabled={pending}
        className={cn(
          'h-9 px-3 rounded-full text-[13px] font-semibold',
          'text-destructive hover:bg-destructive/10 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40',
          'disabled:opacity-60',
        )}
      >
        Remove
      </button>
    </div>
  );
}
