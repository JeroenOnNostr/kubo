import {
  Inbox,
  LogOut,
  MoreVertical,
  Pencil,
  Share2,
  Ticket,
  Users,
  UserPlus,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { GroupSnapshot } from '@/hooks/useGroup';
import { usePortalDarkTheme } from '@/hooks/usePortalDarkTheme';

interface GroupHeaderMenuProps {
  group: GroupSnapshot;
  /** Number of pending join requests, shown as a badge on the menu item. */
  joinRequestCount?: number;
  onEditGroup: () => void;
  onManageMembers: () => void;
  onAddMember: () => void;
  onInviteCodes: () => void;
  onJoinRequests: () => void;
  onShare: () => void;
  onLeave: () => void;
}

/**
 * Overflow menu in the group header. Visible to all viewers; admin
 * actions are hidden when `group.isAdmin` is false. `isAdmin` is
 * evaluated against the parent identity in {@link useGroup}, so the
 * gating respects Kubo's parental model regardless of which kid is
 * active in the switcher.
 */
export function GroupHeaderMenu({
  group,
  joinRequestCount = 0,
  onEditGroup,
  onManageMembers,
  onAddMember,
  onInviteCodes,
  onJoinRequests,
  onShare,
  onLeave,
}: GroupHeaderMenuProps) {
  const showInviteCodes = group.isAdmin && group.isClosed;
  const showJoinRequests = group.isAdmin && group.isClosed;
  const themeStyle = usePortalDarkTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="size-9 rounded-full flex items-center justify-center hover:bg-card transition-colors flex-shrink-0"
          aria-label="Group menu"
        >
          <MoreVertical className="size-5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="bg-popover text-popover-foreground"
        style={themeStyle}
        data-theme-mode="dark"
      >
        {group.isAdmin && (
          <>
            <DropdownMenuItem onClick={onEditGroup}>
              <Pencil className="size-4 mr-2" /> Edit group
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onManageMembers}>
              <Users className="size-4 mr-2" /> Manage members
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAddMember}>
              <UserPlus className="size-4 mr-2" /> Add member
            </DropdownMenuItem>
            {showInviteCodes && (
              <DropdownMenuItem onClick={onInviteCodes}>
                <Ticket className="size-4 mr-2" /> Invite codes
              </DropdownMenuItem>
            )}
            {showJoinRequests && (
              <DropdownMenuItem onClick={onJoinRequests}>
                <Inbox className="size-4 mr-2" />
                <span className="flex-1">Join requests</span>
                {joinRequestCount > 0 && (
                  <span className="ml-2 text-[10px] font-semibold rounded-full bg-primary text-primary-foreground px-1.5 py-px min-w-[18px] text-center">
                    {joinRequestCount}
                  </span>
                )}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={onShare}>
          <Share2 className="size-4 mr-2" /> Share group
        </DropdownMenuItem>
        {group.isMember && (
          <DropdownMenuItem onClick={onLeave} className="text-destructive">
            <LogOut className="size-4 mr-2" /> Leave group
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
