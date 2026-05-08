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
import { useGroupActions } from '@/hooks/useGroupActions';
import { useParentSigner } from '@/hooks/useParentSigner';
import { usePortalDarkTheme } from '@/hooks/usePortalDarkTheme';
import type { GroupSnapshot } from '@/hooks/useGroup';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

interface GroupMemberListProps {
  addr: string;
  group: GroupSnapshot;
  /** When false, suppresses the "Admins" / "Members" section headers (useful in tight Dialog layouts). */
  showSectionHeaders?: boolean;
  /** Optional class on the outer container. */
  className?: string;
}

/**
 * Shared member list — used by both the "Members" tab and the
 * "Manage members" dialog. Admins surface a crown badge; the parent
 * identity's row is non-actionable (we don't promote/demote ourselves
 * from this UI). Tapping a member's main area opens their profile.
 *
 * "Can manage" tracks `group.isAdmin`, which `useGroup` evaluates
 * against the parent pubkey — so the menu surfaces correctly even when
 * a kid is the active account in the switcher.
 */
export function GroupMemberList({
  addr,
  group,
  showSectionHeaders = true,
  className,
}: GroupMemberListProps) {
  const { user: parentUser } = useParentSigner();
  const { putUser, removeUser, pending } = useGroupActions();
  const [error, setError] = useState<string | null>(null);

  const adminPubkeys = new Set(group.admins.map(a => a.pubkey));
  const memberPubkeys = group.members
    .filter(pk => !adminPubkeys.has(pk))
    .sort((a, b) => a.localeCompare(b));
  const totalCount = group.admins.length + memberPubkeys.length;

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

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {error && <div className="text-[12px] text-destructive">{error}</div>}

      {showSectionHeaders && group.admins.length > 0 && (
        <TrustSection title="Admins" note={`${group.admins.length}`} />
      )}
      {group.admins.map(({ pubkey, role }) => (
        <MemberRow
          key={pubkey}
          pubkey={pubkey}
          role={role}
          isSelf={!!parentUser && pubkey === parentUser.pubkey}
          canManage={group.isAdmin && !!parentUser && pubkey !== parentUser.pubkey}
          isAdmin
          onPromote={() => onPromote(pubkey)}
          onRemove={() => onRemove(pubkey)}
          pending={pending.putUser || pending.removeUser}
        />
      ))}

      {showSectionHeaders && memberPubkeys.length > 0 && (
        <TrustSection
          title="Members"
          note={`${memberPubkeys.length}`}
          className="mt-2"
        />
      )}
      {memberPubkeys.map((pubkey) => (
        <MemberRow
          key={pubkey}
          pubkey={pubkey}
          isSelf={!!parentUser && pubkey === parentUser.pubkey}
          canManage={group.isAdmin && !!parentUser && pubkey !== parentUser.pubkey}
          isAdmin={false}
          onPromote={() => onPromote(pubkey)}
          onRemove={() => onRemove(pubkey)}
          pending={pending.putUser || pending.removeUser}
        />
      ))}

      {totalCount === 0 && (
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

      {canManage && <MemberActionsMenu isAdmin={isAdmin} onPromote={onPromote} onRemove={onRemove} pending={pending} />}
    </div>
  );
}

function MemberActionsMenu({
  isAdmin,
  onPromote,
  onRemove,
  pending,
}: {
  isAdmin: boolean;
  onPromote: () => void;
  onRemove: () => void;
  pending: boolean;
}) {
  const themeStyle = usePortalDarkTheme();
  return (
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
      <DropdownMenuContent
        align="end"
        className="bg-popover text-popover-foreground"
        style={themeStyle}
        data-theme-mode="dark"
      >
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
  );
}
