import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { useTrustAssignments } from '@/hooks/useTrustAssignments';
import { useTrustRequests } from '@/hooks/useTrustRequests';
import { cn } from '@/lib/utils';

interface RequestInteractButtonProps {
  /** The creator pubkey the kid is asking to interact with. */
  pubkey: string;
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

/**
 * Kid-side counterpart to AssignTrustLevelButton. Visible on the kid's view of
 * a creator profile only when:
 *   - the creator is unassigned, OR
 *   - the creator is currently assigned trust level "view"
 *
 * Tapping fires a kid → parent in-device request (stored on `KuboFamily.
 * trustRequests`) that the parent approves or denies in the Alerts section of
 * the parent Home dashboard (KUBO-185). While pending, the button flips to
 * "Request pending" and a second tap cancels.
 *
 * Hidden on own-profile, when logged out, and when the creator is already
 * Interact or Extend (no upgrade to ask for).
 */
export function RequestInteractButton({
  pubkey,
  className,
  size = 'default',
}: RequestInteractButtonProps) {
  const { user } = useCurrentUser();
  const kidPubkey = user?.pubkey;
  const { get } = useTrustAssignments(kidPubkey);
  const { hasPending, request, cancel } = useTrustRequests(kidPubkey);
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  if (!user || pubkey === user.pubkey) return null;

  const level = get(pubkey);
  // Only show when there's a meaningful upgrade to ask for. Render an
  // invisible placeholder so the parent flex row keeps Follow at half-width
  // (rather than letting it stretch to fill the gap).
  if (level === 'interact' || level === 'extend') {
    return <div className={cn('invisible', className)} aria-hidden />;
  }

  const isPending = hasPending(pubkey);

  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      if (isPending) {
        await cancel(pubkey);
        toast({ title: 'Request canceled' });
      } else {
        await request(pubkey);
        toast({
          title: 'Request sent',
          description: 'Your parent will see this in Alerts.',
        });
      }
    } catch (err) {
      toast({
        title: 'Could not update request',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant={isPending ? 'secondary' : 'default'}
      size={size}
      disabled={pending}
      onClick={handleClick}
      aria-pressed={isPending}
      className={cn('rounded-full font-bold', className)}
    >
      {isPending ? 'Request pending' : 'Request to interact'}
    </Button>
  );
}
