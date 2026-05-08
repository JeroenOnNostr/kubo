import { GroupMemberList } from '@/components/groups/GroupMemberList';
import type { GroupSnapshot } from '@/hooks/useGroup';

interface GroupMembersTabProps {
  addr: string;
  group: GroupSnapshot;
}

/**
 * Members tab. Thin wrapper around {@link GroupMemberList} so the same
 * surface can also be embedded in the "Manage members" dialog.
 */
export function GroupMembersTab({ addr, group }: GroupMembersTabProps) {
  return (
    <div className="flex-1 flex flex-col gap-2 px-4 pt-3 pb-6 overflow-y-auto">
      <GroupMemberList addr={addr} group={group} />
    </div>
  );
}
