import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { TrustAssignmentBar } from '@/components/trust/TrustAssignmentBar';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { cn } from '@/lib/utils';

interface AssignTrustLevelButtonProps {
  /** The pubkey whose trust level is being assigned. */
  pubkey: string;
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

/**
 * Pill button that toggles an inline TrustAssignmentBar (Extend / Interact /
 * View / Remove) directly below the Follow + Assign-trust row, mirroring the
 * Trust → People row-expand pattern for cross-app consistency.
 *
 * The parent flex container must be `flex flex-wrap` so the `w-full` panel
 * wraps onto its own line beneath the buttons.
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
  const [expanded, setExpanded] = useState(false);

  if (!user || user.pubkey === pubkey || !kid) return null;

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={size}
        aria-expanded={expanded}
        className={cn('rounded-full font-bold', className)}
        onClick={() => setExpanded((e) => !e)}
      >
        Assign trust
      </Button>

      {expanded && (
        <div className="w-full">
          <TrustAssignmentBar
            kidPubkey={kid.pubkey}
            pubkey={pubkey}
            onDone={() => setExpanded(false)}
          />
        </div>
      )}
    </>
  );
}
