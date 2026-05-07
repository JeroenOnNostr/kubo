import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { TrustRow } from '@/components/trust/TrustRow';
import { TrustSection } from '@/components/trust/TrustSection';
import { useGroups, type JoinedGroup } from '@/hooks/useGroups';
import { useRegisterTourAnchor } from '@/contexts/TourAnchorContext';
import { KUBO_TESTERS_GROUP } from '@/lib/appRelays';

import { CreateGroupDialog } from './CreateGroupDialog';
import { SuggestedGroupTile } from './SuggestedGroupTile';

/**
 * Groups slot inside the Trust > People page. Replaces the previous
 * hardcoded GROUPS array. Lists the user's joined NIP-29 groups, plus
 * a "Suggested" tile for the Kubo Testers default group when the user
 * isn't a member yet.
 *
 * Registers itself as the `groupsSection` tour anchor so the
 * onboarding coachmark can point at it.
 */
export function GroupsSection() {
  const nav = useNavigate();
  const { data: groups, isLoading } = useGroups();
  const [createOpen, setCreateOpen] = useState(false);

  const sectionRef = useRef<HTMLDivElement>(null);
  useRegisterTourAnchor('groupsSection', sectionRef);

  const joined = groups ?? [];
  const showSuggested = !joined.some(g => g.addr === KUBO_TESTERS_GROUP);

  return (
    <div ref={sectionRef} className="flex flex-col gap-2">
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

      {showSuggested && (
        <SuggestedGroupTile
          addr={KUBO_TESTERS_GROUP}
          title="Kubo Testers"
          subtitle="Chat with the Kubo team and other early testers"
        />
      )}

      {joined.map((g) => (
        <GroupListRow
          key={g.addr}
          group={g}
          onClick={() => nav(`/parent/groups/${encodeURIComponent(g.addr)}`)}
        />
      ))}

      {!showSuggested && joined.length === 0 && !isLoading && (
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
