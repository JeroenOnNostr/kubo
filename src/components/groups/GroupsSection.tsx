import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { TrustRow } from '@/components/trust/TrustRow';
import { TrustSection } from '@/components/trust/TrustSection';
import { useGroups, type JoinedGroup } from '@/hooks/useGroups';

import { CreateGroupDialog } from './CreateGroupDialog';

/**
 * Groups slot inside the Trust > People page. Lists the user's joined
 * NIP-29 groups and offers "New group" / Create.
 *
 * The Kubo Testers suggestion + the `groupsSection` tour anchor moved to
 * the Support page (KUBO-191) — this section now only manages the user's
 * own groups.
 */
export function GroupsSection() {
  const nav = useNavigate();
  const { data: groups, isLoading } = useGroups();
  const [createOpen, setCreateOpen] = useState(false);

  const joined = groups ?? [];

  return (
    <div className="flex flex-col gap-2">
      <TrustSection
        title="Groups"
        action={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="text-[10px] uppercase tracking-[0.1em] font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Plus className="size-2.5" />
            New group
          </button>
        }
      />

      {joined.map((g) => (
        <GroupListRow
          key={g.addr}
          group={g}
          onClick={() => nav(`/parent/groups/${encodeURIComponent(g.addr)}`)}
        />
      ))}

      {joined.length === 0 && !isLoading && (
        <div className="text-[12px] text-muted-foreground px-1 py-2">
          No groups yet — tap Create to start one.
        </div>
      )}

      <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function GroupListRow({ group, onClick }: { group: JoinedGroup; onClick: () => void }) {
  const name = group.name ?? group.gid;
  const initial = name.slice(0, 1).toUpperCase();
  const avatar = group.picture ? (
    <img
      src={group.picture}
      alt=""
      className="size-8 rounded-full object-cover"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = 'none';
      }}
    />
  ) : initial;

  return (
    <TrustRow
      avatar={avatar}
      avatarBg={group.picture ? undefined : '#64748B'}
      name={name}
      subtitle={group.about ?? group.host}
      onClick={onClick}
    />
  );
}
