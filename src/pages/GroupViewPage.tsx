import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { GroupAboutTab } from '@/components/groups/GroupAboutTab';
import { GroupChatTab } from '@/components/groups/GroupChatTab';
import { GroupMembersTab } from '@/components/groups/GroupMembersTab';
import { useGroup } from '@/hooks/useGroup';
import { cn } from '@/lib/utils';

/**
 * /parent/groups/:addr — single NIP-29 group view (chat / members / about).
 *
 * The route param is a URL-encoded full group address `<host>'<gid>`,
 * e.g. `groups.0xchat.com'kubo-testers`. All data is sourced from the
 * group's host relay via {@link useGroup} / {@link useGroupMessages};
 * admin actions are gated by `group.isAdmin`.
 */
type Tab = 'chat' | 'members' | 'about';

export function GroupViewPage() {
  const nav = useNavigate();
  const params = useParams<{ addr: string }>();
  const addr = params.addr ? decodeURIComponent(params.addr) : undefined;

  const { data: group, isLoading } = useGroup(addr);
  const [tab, setTab] = useState<Tab>('chat');
  const qc = useQueryClient();

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
          onClick={() => nav('/parent/trust/people')}
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
    </div>
  );
}
