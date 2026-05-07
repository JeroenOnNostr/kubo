import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, MoreVertical, UserMinus, UserPlus } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TrustSection } from '@/components/trust/TrustSection';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGroupActions } from '@/hooks/useGroupActions';
import type { GroupSnapshot } from '@/hooks/useGroup';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

interface GroupMembersTabProps {
  addr: string;
  group: GroupSnapshot;
}

/**
 * Members tab. Visually mirrors TrustRow density (avatar 32px, name +
 * subtitle, trailing affordance) so it sits coherently next to the
 * Trust > People list. Admins surface a crown badge; the current
 * user's row is non-actionable. Tapping a member's main area opens
 * their profile.
 */
export function GroupMembersTab({ addr, group }: GroupMembersTabProps) {
  const { user } = useCurrentUser();
  const { putUser, removeUser, pending } = useGroupActions();
  const [error, setError] = useState<string | null>(null);

  const adminPubkeys = new Set(group.admins.map(a => a.pubkey));

  // Render admins first, then plain members (alphabetical by pubkey for
  // a stable order before display names resolve).
  const memberPubkeys = group.members
    .filter(pk => !adminPubkeys.has(pk))
    .sort((a, b) => a.localeCompare(b));
  const ordered = [
    ...group.admins.map(a => ({ pubkey: a.pubkey, role: a.role })),
    ...memberPubkeys.map(pk => ({ pubkey: pk, role: undefined as string | undefined })),
  ];

  const onPromote = async (pk: string) => {
    setError(null);
    try {
      await putUser(addr, pk, 'admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not promote.');
    }
  };
  const onRemove = async (pk: string) => {
    setError(null);
    try {
      await removeUser(addr, pk);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove.');
    }
  };

  const adminCount = group.admins.length;
  const memberCount = group.members.length;

  return (
    <div className="flex-1 flex flex-col gap-2 px-4 pt-3 pb-6 overflow-y-auto">
      {error && <div className="text-[12px] text-destructive">{error}</div>}

      {adminCount > 0 && (
        <TrustSection title="Admins" note={`${adminCount}`} />
      )}
      {group.admins.map(({ pubkey, role }) => (
        <MemberRow
          key={pubkey}
          pubkey={pubkey}
          role={role}
          isSelf={!!user && pubkey === user.pubkey}
          canManage={group.isAdmin && !!user && pubkey !== user.pubkey}
          isAdmin
          onPromote={() => onPromote(pubkey)}
          onRemove={() => onRemove(pubkey)}
          pending={pending.putUser || pending.removeUser}
        />
      ))}

      {memberPubkeys.length > 0 && (
        <TrustSection
          title="Members"
          note={`${memberCount - adminCount}`}
          className="mt-2"
        />
      )}
      {memberPubkeys.map((pubkey) => (
        <MemberRow
          key={pubkey}
          pubkey={pubkey}
          isSelf={!!user && pubkey === user.pubkey}
          canManage={group.isAdmin && !!user && pubkey !== user.pubkey}
          isAdmin={false}
          onPromote={() => onPromote(pubkey)}
          onRemove={() => onRemove(pubkey)}
          pending={pending.putUser || pending.removeUser}
        />
      ))}

      {ordered.length === 0 && (
        <div className="text-[12px] text-muted-foreground py-2 px-1">
          No members listed yet.
        </div>
      )}
    </div>
  );
}

function MemberRow({
  pubkey,
  role,
  isSelf,
  canManage,
  isAdmin,
  onPromote,
  onRemove,
  pending,
}: {
  pubkey: string;
  role?: string;
  isSelf: boolean;
  canManage: boolean;
  isAdmin: boolean;
  onPromote: () => void;
  onRemove: () => void;
  pending: boolean;
}) {
  const nav = useNavigate();
  const author = useAuthor(pubkey);
  const displayName =
    author.data?.metadata?.display_name ||
    author.data?.metadata?.name ||
    genUserName(pubkey);
  const picture = author.data?.metadata?.picture;

  const subtitle = isAdmin
    ? role && role !== 'admin'
      ? `Admin · ${role}`
      : 'Admin'
    : 'Member';

  const openProfile = () => {
    nav(`/parent/profile/${nip19.npubEncode(pubkey)}`);
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-2.5 bg-card/60 rounded-xl',
        'transition-colors',
      )}
      role="group"
    >
      <button
        type="button"
        onClick={openProfile}
        className={cn(
          'flex items-center gap-3 min-w-0 flex-1 text-left',
          'hover:opacity-80 transition-opacity',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg',
        )}
      >
        <div
          className="size-8 rounded-full flex-shrink-0 overflow-hidden bg-slate-500 flex items-center justify-center text-white text-[11px] font-semibold"
          aria-hidden
        >
          {picture ? (
            <img src={picture} alt="" className="size-full object-cover" />
          ) : (
            displayName.slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate flex items-center gap-1.5">
            <span className="truncate">{displayName}</span>
            {isSelf && (
              <span className="text-[10px] text-muted-foreground font-normal">(you)</span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            {isAdmin && <Crown className="size-3 text-primary" aria-hidden />}
            {subtitle}
          </div>
        </div>
      </button>

      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="size-8 rounded-full flex items-center justify-center hover:bg-card transition-colors flex-shrink-0"
              aria-label="Member actions"
              disabled={pending}
            >
              <MoreVertical className="size-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isAdmin && (
              <DropdownMenuItem onClick={onPromote}>
                <UserPlus className="size-4 mr-2" /> Make admin
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onRemove} className="text-destructive">
              <UserMinus className="size-4 mr-2" /> Remove from group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
