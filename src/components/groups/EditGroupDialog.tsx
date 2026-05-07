import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GroupMetadataForm } from '@/components/groups/GroupMetadataForm';
import { usePortalDarkTheme } from '@/hooks/usePortalDarkTheme';
import type { GroupSnapshot } from '@/hooks/useGroup';

interface EditGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addr: string;
  group: GroupSnapshot;
}

export function EditGroupDialog({ open, onOpenChange, addr, group }: EditGroupDialogProps) {
  const themeStyle = usePortalDarkTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md bg-background text-foreground"
        style={themeStyle}
        data-theme-mode="dark"
      >
        <DialogHeader>
          <DialogTitle>Edit group</DialogTitle>
          <DialogDescription>
            Change the group&apos;s name, description, picture, or who can read
            and join.
          </DialogDescription>
        </DialogHeader>

        <GroupMetadataForm
          addr={addr}
          group={group}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
