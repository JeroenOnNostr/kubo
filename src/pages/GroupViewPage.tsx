import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AddMemberDialog } from '@/components/groups/AddMemberDialog';
import { EditGroupDialog } from '@/components/groups/EditGroupDialog';
import { GroupAboutTab } from '@/components/groups/GroupAboutTab';
import { GroupChatTab } from '@/components/groups/GroupChatTab';
import { GroupHeaderMenu } from '@/components/groups/GroupHeaderMenu';
import { GroupMembersTab } from '@/components/groups/GroupMembersTab';
import { InviteCodesDialog } from '@/components/groups/InviteCodesDialog';
import { JoinRequestsDialog } from '@/components/groups/JoinRequestsDialog';
import { ManageMembersDialog } from '@/components/groups/ManageMembersDialog';
import { useGroup } from '@/hooks/useGroup';
import { useGroupActions } from '@/hooks/useGroupActions';
import { useGroupJoinRequests } from '@/hooks/useGroupJoinRequests';
import { useGroupMessages } from '@/hooks/useGroupMessages';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { buildInviteUrl, parseGroupAddr } from '@/lib/nip29';
import { groupHomePath } from '@/lib/appRelays';
import { cn } from '@/lib/utils';

/**
 * /parent/groups/:addr — single NIP-29 group view (chat / members / about).
 *
 * The route param is a URL-encoded full group address `<host>'<gid>`,
 * e.g. `relay.kubo.watch'meycharghge`. All data is sourced from the
 * group's host relay via {@link useGroup} / {@link useGroupMessages};
 * admin actions are gated by `group.isAdmin`.
 */
type Tab = 'chat' | 'members' | 'about';

export function GroupViewPage() {
  const nav = useNavigate();
  const params = useParams<{ addr: string }>();
  const addr = params.addr ? decodeURIComponent(params.addr) : undefined;

  const { data: group, isLoading } = useGroup(addr);
  // Where Back / Leave return to: Support for the Kubo Testers group (it's
  // reached from the Support tab), Trust → People for every other group.
  const homePath = groupHomePath(addr);
  const [tab, setTab] = useState<Tab>('chat');
  const qc = useQueryClient();
  const { leave } = useGroupActions();
  const { requests: joinRequests } = useGroupJoinRequests(
    group?.isAdmin && group?.isClosed ? addr : undefined,
  );

  // Mark this group read while its chat is on screen: advance the per-group
  // cursor to the newest message so the Support unread dot (Kubo Testers)
  // clears. Shares useGroupMessages' cache key with GroupChatTab, so this is
  // a free read, not a second fetch.
  //
  // Loop-safety: writing the cursor re-publishes the kind-30078 settings
  // event, which gives `settings` a new identity on every save. The live
  // message subscription also re-publishes `messages` on every echo. So we do
  // NOT depend on settings identity or gate on it (a re-parse can churn).
  // Instead a ref records the highest timestamp we've already written for this
  // addr, and we only write when `newest` exceeds BOTH that ref and the stored
  // cursor — making repeat writes idempotent no-ops and breaking the loop.
  const { messages } = useGroupMessages(tab === 'chat' ? addr : undefined);
  const { settings, updateSettings } = useEncryptedSettings();
  const writtenCursorRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (tab !== 'chat' || !addr || messages.length === 0) return;
    const newest = messages.reduce(
      (max, m) => (m._pending ? max : Math.max(max, m.created_at)),
      0,
    );
    const stored = settings?.groupCursors?.[addr] ?? 0;
    const alreadyWritten = writtenCursorRef.current[addr] ?? 0;
    if (newest <= stored || newest <= alreadyWritten) return;
    writtenCursorRef.current[addr] = newest;
    updateSettings
      .mutateAsync({ groupCursors: { ...settings?.groupCursors, [addr]: newest } })
      .catch(() => {
        // Let a failed write retry on the next message/tab change.
        if (writtenCursorRef.current[addr] === newest) {
          delete writtenCursorRef.current[addr];
        }
      });
    // Depend on the timestamp value, not object identities, so a settings
    // re-publish/re-parse can't retrigger this. updateSettings is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, addr, messages, settings?.groupCursors?.[addr ?? '']]);

  // Header-menu dialogs: a single discriminated state so two of them
  // can't be open at once and the menu's onSelect is straightforward.
  const [openDialog, setOpenDialog] = useState<
    null | 'edit' | 'manage' | 'add' | 'invites' | 'requests'
  >(null);

  const onShare = async () => {
    if (!addr) return;
    try {
      const { host, gid } = parseGroupAddr(addr);
      // Bare invite URL with no code — works for open groups; for closed
      // groups the recipient will need to either request to join or be
      // sent a coded URL via the Invite codes dialog.
      const url = buildInviteUrl(host, gid, '');
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
  };

  const onLeaveFromMenu = async () => {
    if (!addr) return;
    try {
      await leave(addr);
      nav(homePath);
    } catch {
      // The About tab also exposes Leave with its own error UI; menu
      // failure is silent here.
    }
  };

  // Re-fetch the relay-side group state shortly after entering, then
  // periodically. Joining via kind 9021 only flips us into the members
  // list once the relay re-emits 39002 — without a refetch the header
  // and member list stay stale (e.g. "3 members" instead of "4 members").
  useEffect(() => {
    if (!addr) return;
    const t1 = setTimeout(() => qc.invalidateQueries({ queryKey: ['nip29-group', addr] }), 1500);
    const t2 = setTimeout(() => qc.invalidateQueries({ queryKey: ['nip29-group', addr] }), 5000);
    const interval = setInterval(
      () => qc.invalidateQueries({ queryKey: ['nip29-group', addr] }),
      30_000,
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(interval);
    };
  }, [addr, qc]);

  if (!addr) {
    return (
      <div className="px-4 pt-6 text-[13px] text-muted-foreground">
        Group not found.
      </div>
    );
  }

  const name = group?.name ?? addr.split("'")[1] ?? addr;
  const memberCount = group?.members.length ?? 0;

  // Layout strategy: take the page out of <main>'s normal flow with
  // position: fixed so we can lock its height to the visible viewport
  // area. This avoids the height-propagation problem where placing a
  // tall flex page inside <main> extends <main>, which in turn pushes
  // the composer behind the fixed bottom nav.
  //
  // Top edge: under the sticky parent header (its height varies with
  // safe-area; we use a CSS calc that includes it and the inner pt-2
  // pb-1 + ~24px wordmark for ~3rem total).
  // Bottom edge: above the fixed bottom nav + its 28px upward arc overhang
  // (see ArcBackground) + iOS safe area, so the composer clears the curve.
  // Z-index sits below the nav (40) and below dialogs (250).
  return (
    <div
      className="fixed inset-x-0 flex flex-col bg-background pt-2 z-10"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + 3rem)',
        bottom: 'calc(var(--bottom-nav-height, 2.75rem) + 28px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav(homePath)}
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <div
          className="size-9 rounded-full flex-shrink-0 overflow-hidden bg-primary flex items-center justify-center text-primary-foreground text-[12px] font-semibold"
          aria-hidden
        >
          {group?.picture ? (
            <img
              src={group.picture}
              alt=""
              className="size-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            name.slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold truncate">{name}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {isLoading
              ? 'Loading…'
              : `${memberCount} member${memberCount === 1 ? '' : 's'}`}
            {group?.isPrivate && ' · private'}
            {group?.isClosed && ' · invite-only'}
          </div>
        </div>
        {group && (
          <GroupHeaderMenu
            group={group}
            joinRequestCount={joinRequests.length}
            onEditGroup={() => setOpenDialog('edit')}
            onManageMembers={() => setOpenDialog('manage')}
            onAddMember={() => setOpenDialog('add')}
            onInviteCodes={() => setOpenDialog('invites')}
            onJoinRequests={() => setOpenDialog('requests')}
            onShare={onShare}
            onLeave={onLeaveFromMenu}
          />
        )}
      </div>

      {/* Tabs */}
      <div className="px-4 flex items-center gap-2 mt-3 flex-shrink-0" role="tablist">
        {(['chat', 'members', 'about'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'h-8 px-4 rounded-full text-[12px] font-medium capitalize transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              tab === t
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'chat' && (
        <GroupChatTab addr={addr} isAdmin={group?.isAdmin ?? false} />
      )}
      {tab === 'members' && group && (
        <GroupMembersTab addr={addr} group={group} />
      )}
      {tab === 'about' && group && (
        <GroupAboutTab addr={addr} group={group} />
      )}
      {tab !== 'chat' && !group && (
        <div className="px-4 pt-6 text-[12px] text-muted-foreground">
          Loading…
        </div>
      )}

      {group && (
        <>
          <EditGroupDialog
            open={openDialog === 'edit'}
            onOpenChange={(o) => setOpenDialog(o ? 'edit' : null)}
            addr={addr}
            group={group}
          />
          <ManageMembersDialog
            open={openDialog === 'manage'}
            onOpenChange={(o) => setOpenDialog(o ? 'manage' : null)}
            addr={addr}
            group={group}
            onAddMember={() => setOpenDialog('add')}
          />
          <AddMemberDialog
            open={openDialog === 'add'}
            onOpenChange={(o) => setOpenDialog(o ? 'add' : null)}
            addr={addr}
            existing={new Set([
              ...group.admins.map((a) => a.pubkey),
              ...group.members,
            ])}
          />
          <InviteCodesDialog
            open={openDialog === 'invites'}
            onOpenChange={(o) => setOpenDialog(o ? 'invites' : null)}
            addr={addr}
          />
          <JoinRequestsDialog
            open={openDialog === 'requests'}
            onOpenChange={(o) => setOpenDialog(o ? 'requests' : null)}
            addr={addr}
          />
        </>
      )}
    </div>
  );
}
