import { useAuthor } from '@/hooks/useAuthor';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface KidAvatarProps {
  pubkey: string;
  className?: string;
  fallbackInitial?: string;
}

/**
 * Shared display component for a kid's avatar. Reads the kid's kind 0 via
 * `useAuthor` (parent-side read — no signer swap, no KUBO-016 risk) and
 * renders `metadata.picture` when set, or an indigo fallback circle otherwise.
 *
 * Used by KidDashboardPage, KidKeysPage, and the ParentFeedPage kid picker.
 */
export function KidAvatar({ pubkey, className, fallbackInitial }: KidAvatarProps) {
  const { data } = useAuthor(pubkey);
  const picture = data?.metadata?.picture;

  return (
    <Avatar className={cn('shrink-0', className)}>
      {picture && <AvatarImage src={picture} />}
      <AvatarFallback className="bg-[#6366F1] text-white text-xs font-semibold">
        {fallbackInitial}
      </AvatarFallback>
    </Avatar>
  );
}
