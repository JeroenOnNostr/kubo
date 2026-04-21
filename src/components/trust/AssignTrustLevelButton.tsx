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
import { useToast } from '@/hooks/useToast';
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
 * the given pubkey. Ships the UI shell only — the mutation is a KUBO-013
 * follow-up (trust-people list kind is not yet defined). Selecting a level
 * currently toasts and closes the sheet without publishing any event.
 *
 * Hides itself on own-profile and when logged out, matching FollowButton.
 */
export function AssignTrustLevelButton({
  pubkey,
  className,
  size = 'sm',
}: AssignTrustLevelButtonProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  if (!user || user.pubkey === pubkey) return null;

  const handleSelect = (level: TrustLevel) => {
    setOpen(false);
    toast({
      title: `Trust level: ${level}`,
      description: 'Trust levels not yet wired — KUBO-013.',
    });
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
            {LEVEL_OPTIONS.map((opt) => (
              <button
                key={opt.level}
                type="button"
                onClick={() => handleSelect(opt.level)}
                className={cn(
                  'w-full flex items-center gap-3 p-3 rounded-xl bg-card/60',
                  'hover:bg-card active:bg-card transition-colors text-left',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
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
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
