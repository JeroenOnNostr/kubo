import { UserPlus } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { GroupMemberList } from '@/components/groups/GroupMemberList';
import { usePortalDarkTheme } from '@/hooks/usePortalDarkTheme';
import type { GroupSnapshot } from '@/hooks/useGroup';

interface ManageMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addr: string;
  group: GroupSnapshot;
  /** Called when the user clicks "Add member" — closes this dialog and opens the add-member dialog. */
  onAddMember: () => void;
}

export function ManageMembersDialog({
  open,
  onOpenChange,
  addr,
  group,
  onAddMember,
}: ManageMembersDialogProps) {
  const themeStyle = usePortalDarkTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md bg-background text-foreground max-h-[80vh] flex flex-col"
        style={themeStyle}
        data-theme-mode="dark"
      >
        <DialogHeader>
          <DialogTitle>Manage members</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          <GroupMemberList addr={addr} group={group} />
        </div>

        <Button
          type="button"
          variant="outline"
          className="rounded-full w-full"
          onClick={onAddMember}
        >
          <UserPlus className="size-4 mr-2" />
          Add member
        </Button>
      </DialogContent>
    </Dialog>
  );
}
