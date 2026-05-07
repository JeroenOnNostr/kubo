import { useNavigate } from 'react-router-dom';
import { LogIn, LogOut, UserMinus, UserPlus } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import type { GroupSystemEvent } from '@/hooks/useGroupSystemEvents';

interface SystemRowProps extends GroupSystemEvent {
  /** Parent pubkey, so the row can render "You …" for self-actions. */
  selfPubkey?: string;
}

const ICON: Record<GroupSystemEvent['variant'], typeof LogIn> = {
  joined: LogIn,
  left: LogOut,
  added: UserPlus,
  removed: UserMinus,
};

const VERB: Record<GroupSystemEvent['variant'], string> = {
  joined: 'joined the group',
  left: 'left the group',
  added: 'was added to the group',
  removed: 'was removed from the group',
};

function shortName(name: string): string {
  if (name.length <= 24) return name;
  return `${name.slice(0, 21)}…`;
}

export function SystemRow({
  variant,
  actorPubkey,
  byPubkey,
  selfPubkey,
}: SystemRowProps) {
  const navigate = useNavigate();
  const author = useAuthor(actorPubkey);
  const byAuthor = useAuthor(byPubkey);

  const isSelf = !!selfPubkey && actorPubkey === selfPubkey;
  const meta = author.data?.metadata;
  const displayName = isSelf
    ? 'You'
    : shortName(meta?.name || meta?.display_name || genUserName(actorPubkey));

  const tooltip = byPubkey
    ? `${variant === 'added' ? 'Added' : 'Removed'} by ${
        byAuthor.data?.metadata?.name ||
        byAuthor.data?.metadata?.display_name ||
        genUserName(byPubkey)
      }`
    : undefined;

  const Icon = ICON[variant];

  const goToProfile = () => {
    try {
      const npub = nip19.npubEncode(actorPubkey);
      navigate(`/parent/profile/${npub}`);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="flex items-center justify-center gap-2 py-2 text-[12px] text-muted-foreground"
      title={tooltip}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        <button
          type="button"
          onClick={goToProfile}
          className="font-medium text-foreground/80 hover:underline focus:outline-none focus:underline"
        >
          {displayName}
        </button>{' '}
        {VERB[variant]}
      </span>
    </div>
  );
}
