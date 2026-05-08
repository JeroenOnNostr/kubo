import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TrustSection } from '@/components/trust/TrustSection';
import { useGroupActions } from '@/hooks/useGroupActions';
import type { GroupSnapshot } from '@/hooks/useGroup';

interface GroupMetadataFormProps {
  addr: string;
  group: GroupSnapshot;
  /** Called once a save round-trips successfully. */
  onSaved?: () => void;
}

/**
 * Reusable group-metadata form: name / description / picture / private
 * / closed. Used by the "Edit group" dialog opened from the header
 * overflow menu.
 */
export function GroupMetadataForm({ addr, group, onSaved }: GroupMetadataFormProps) {
  const { editMetadata, pending } = useGroupActions();

  const [name, setName] = useState(group.name ?? '');
  const [about, setAbout] = useState(group.about ?? '');
  const [picture, setPicture] = useState(group.picture ?? '');
  const [isPrivate, setIsPrivate] = useState(group.isPrivate);
  const [isClosed, setIsClosed] = useState(group.isClosed);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(group.name ?? '');
    setAbout(group.about ?? '');
    setPicture(group.picture ?? '');
    setIsPrivate(group.isPrivate);
    setIsClosed(group.isClosed);
  }, [group.name, group.about, group.picture, group.isPrivate, group.isClosed]);

  const dirty =
    name !== (group.name ?? '') ||
    about !== (group.about ?? '') ||
    picture !== (group.picture ?? '') ||
    isPrivate !== group.isPrivate ||
    isClosed !== group.isClosed;

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await editMetadata(addr, {
        name: name.trim(),
        about: about.trim(),
        picture: picture.trim(),
        isPrivate,
        isClosed,
      });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  return (
    <form onSubmit={onSave} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="group-meta-name" className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-semibold">
            Name
          </Label>
          <Input
            id="group-meta-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="group-meta-about" className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-semibold">
            Description
          </Label>
          <Textarea
            id="group-meta-about"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="What is this group about?"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="group-meta-picture" className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-semibold">
            Picture URL
          </Label>
          <Input
            id="group-meta-picture"
            type="url"
            placeholder="https://…"
            value={picture}
            onChange={(e) => setPicture(e.target.value)}
          />
        </div>
      </div>

      <TrustSection title="Access" />
      <div className="flex flex-col gap-2">
        <ToggleRow
          title="Private"
          subtitle="Only members can read messages"
          checked={isPrivate}
          onChange={setIsPrivate}
        />
        <ToggleRow
          title="Closed"
          subtitle="Join requests are ignored (invite-only)"
          checked={isClosed}
          onChange={setIsClosed}
        />
      </div>

      {error && <div className="text-[12px] text-destructive">{error}</div>}
      {saved && !dirty && (
        <div className="text-[12px] text-muted-foreground">Saved.</div>
      )}

      <Button
        type="submit"
        disabled={!dirty || pending.editMetadata}
        className="w-full rounded-full"
      >
        <Save className="size-4 mr-2" />
        {pending.editMetadata ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}

function ToggleRow({
  title,
  subtitle,
  checked,
  onChange,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-card/60 cursor-pointer">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
