import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { useToast } from '@/hooks/useToast';
import { useTrustAssignments } from '@/hooks/useTrustAssignments';
import { cn } from '@/lib/utils';
import type { TrustLevel } from '@/components/trust/TrustRow';

interface AssignTrustLevelButtonProps {
  /** The pubkey whose trust level is being assigned. */
  pubkey: string;
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

interface LevelOption {
  level: TrustLevel;
  label: string;
  description: string;
  dotClass: string;
}

// Dot colors mirror TrustRow's LEVEL_DOT map. Duplicated (not imported) to avoid
// an upstream edit — the three strings are stable and live next to their usage.
const LEVEL_OPTIONS: LevelOption[] = [
  {
    level: 'extend',
    label: 'Extend',
    description: 'Inner circle — widest access, trusted to introduce others.',
    dotClass: 'bg-[#22C55E] shadow-[0_0_0_3px_rgba(34,197,94,0.2)]',
  },
  {
    level: 'interact',
    label: 'Interact',
    description: 'Can interact — visible in feeds and replies.',
    dotClass: 'bg-primary shadow-[0_0_0_3px_rgba(249,115,22,0.2)]',
  },
  {
    level: 'view',
    label: 'View',
    description: 'View-only — appears in feeds, no interaction.',
    dotClass: 'bg-[#EF4444] shadow-[0_0_0_3px_rgba(239,68,68,0.2)]',
  },
];

/**
 * Opens a bottom sheet to pick a trust level (Extend / Interact / View) for
 * the given pubkey. Persists to local trustAssignments (scoped to the active
 * kid) via useTrustAssignments. No Nostr event yet — KUBO-013 will define the
 * kind.
 *
 * Hides itself on own-profile, when logged out, and when no kid is selected
 * (trust assignments are always kid-scoped).
 */
export function AssignTrustLevelButton({
  pubkey,
  className,
  size = 'sm',
}: AssignTrustLevelButtonProps) {
  const { user } = useCurrentUser();
  const kid = useSelectedKid();
  const { get, setLevel, clear } = useTrustAssignments(kid?.pubkey);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  if (!user || user.pubkey === pubkey || !kid) return null;

  const current = get(pubkey);

  const handleSelect = async (level: TrustLevel) => {
    setOpen(false);
    try {
      await setLevel(pubkey, level);
      toast({ title: `Trust level set: ${level}` });
    } catch (err) {
      toast({
        title: 'Could not save trust level',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  const handleRemove = async () => {
    setOpen(false);
    try {
      await clear(pubkey);
      toast({ title: 'Trust level cleared' });
    } catch (err) {
      toast({
        title: 'Could not clear trust level',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={size}
        className={cn('rounded-full font-bold', className)}
        onClick={() => setOpen(true)}
      >
        Assign trust
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-left mb-3">
            <SheetTitle>Assign trust level</SheetTitle>
            <SheetDescription>
              Pick how freely this creator can reach your kid.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-2">
            {LEVEL_OPTIONS.map((opt) => {
              const active = current === opt.level;
              return (
                <button
                  key={opt.level}
                  type="button"
                  onClick={() => handleSelect(opt.level)}
                  aria-pressed={active}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-xl bg-card/60',
                    'hover:bg-card active:bg-card transition-colors text-left',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    active && 'ring-2 ring-primary bg-card',
                  )}
                >
                  <span
                    className={cn(
                      'size-3 rounded-full flex-shrink-0',
                      opt.dotClass,
                    )}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {opt.description}
                    </div>
                  </div>
                  <ChevronRight
                    className="size-4 text-muted-foreground flex-shrink-0"
                    aria-hidden
                  />
                </button>
              );
            })}
            {current !== undefined && (
              <button
                type="button"
                onClick={handleRemove}
                className={cn(
                  'w-full flex items-center justify-center gap-2 p-3 rounded-xl',
                  'text-destructive font-semibold text-sm',
                  'hover:bg-destructive/10 active:bg-destructive/10 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40',
                )}
              >
                Remove
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
