import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, LogOut, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TrustSection } from '@/components/trust/TrustSection';
import { useGroupActions } from '@/hooks/useGroupActions';
import type { GroupSnapshot } from '@/hooks/useGroup';
import { parseGroupAddr } from '@/lib/nip29';

interface GroupAboutTabProps {
  addr: string;
  group: GroupSnapshot;
}

/**
 * About tab. Renders an editable form when the current user is an
 * admin; a read-only summary otherwise. The `Leave group` action lives
 * here for both views, matching where users expect to find it.
 *
 * Visual rhythm matches Trust > People: TrustSection headings,
 * card-tinted rows, 12-13px body text.
 */
export function GroupAboutTab({ addr, group }: GroupAboutTabProps) {
  const nav = useNavigate();
  const { editMetadata, leave, pending } = useGroupActions();
  const { gid, host } = parseGroupAddr(addr);

  const [name, setName] = useState(group.name ?? '');
  const [about, setAbout] = useState(group.about ?? '');
  const [picture, setPicture] = useState(group.picture ?? '');
  const [isPrivate, setIsPrivate] = useState(group.isPrivate);
  const [isClosed, setIsClosed] = useState(group.isClosed);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sync local form state when the upstream snapshot changes (e.g. after
  // a successful save the relay echoes a new 39000).
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  const onLeave = async () => {
    setError(null);
    try {
      await leave(addr);
      nav('/parent/trust/people');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not leave.');
    }
  };

  const copyAddr = async () => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be denied — silent fall-through is fine.
    }
  };

  // ─── Identity strip — shown on both admin & non-admin ────────────────────
  const identity = (
    <div className="flex items-center gap-3 px-4">
      <div
        className="size-12 rounded-full overflow-hidden flex-shrink-0 bg-primary flex items-center justify-center text-primary-foreground text-[16px] font-semibold"
        aria-hidden
      >
        {group.picture ? (
          <img src={group.picture} alt="" className="size-full object-cover" />
        ) : (
          (group.name ?? gid).slice(0, 1).toUpperCase()
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold truncate">{group.name ?? gid}</div>
        <div className="text-[11px] text-muted-foreground truncate">{host}</div>
      </div>
    </div>
  );

  if (group.isAdmin) {
    return (
      <form onSubmit={onSave} className="flex-1 flex flex-col gap-3 pt-3 pb-6 overflow-y-auto">
        {identity}

        <div className="px-4 mt-2">
          <TrustSection title="Group details" />
        </div>

        <div className="flex flex-col gap-3 px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-name" className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-semibold">
              Name
            </Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-about" className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-semibold">
              Description
            </Label>
            <Textarea
              id="group-about"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="What is this group about?"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-picture" className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-semibold">
              Picture URL
            </Label>
            <Input
              id="group-picture"
              type="url"
              placeholder="https://…"
              value={picture}
              onChange={(e) => setPicture(e.target.value)}
            />
          </div>
        </div>

        <div className="px-4 mt-1">
          <TrustSection title="Access" />
        </div>
        <div className="flex flex-col gap-2 px-4">
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

        {error && <div className="text-[12px] text-destructive px-4">{error}</div>}
        {saved && !dirty && (
          <div className="text-[12px] text-muted-foreground px-4">Saved.</div>
        )}

        <div className="flex flex-col gap-3 px-4 mt-2">
          <Button
            type="submit"
            disabled={!dirty || pending.editMetadata}
            className="w-full rounded-full"
          >
            <Save className="size-4 mr-2" />
            {pending.editMetadata ? 'Saving…' : 'Save changes'}
          </Button>
        </div>

        <div className="px-4 mt-2">
          <TrustSection title="Group info" />
        </div>
        <div className="flex flex-col gap-2 px-4">
          <Fact label="Group id" value={gid} action={
            <button
              type="button"
              onClick={copyAddr}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
              aria-label="Copy address"
            >
              <Copy className="size-3" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          } />
          <Fact label="Relay" value={host} />
          <Fact label="Members" value={String(group.members.length)} />
          <Fact label="Admins" value={String(group.admins.length)} />
        </div>

        <div className="px-4 mt-3">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive justify-start w-full hover:text-destructive hover:bg-destructive/10"
            onClick={onLeave}
            disabled={pending.leave}
          >
            <LogOut className="size-4 mr-2" />
            {pending.leave ? 'Leaving…' : 'Leave group'}
          </Button>
        </div>
      </form>
    );
  }

  // ─── Non-admin read-only view ────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col gap-3 pt-3 pb-6 overflow-y-auto">
      {identity}

      {group.about && (
        <p className="text-[13px] leading-relaxed text-muted-foreground px-4 mt-1">
          {group.about}
        </p>
      )}

      <div className="px-4 mt-1">
        <TrustSection title="Group info" />
      </div>
      <div className="flex flex-col gap-2 px-4">
        <Fact label="Group id" value={gid} action={
          <button
            type="button"
            onClick={copyAddr}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            aria-label="Copy address"
          >
            <Copy className="size-3" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        } />
        <Fact label="Relay" value={host} />
        <Fact label="Members" value={String(group.members.length)} />
        <Fact label="Privacy" value={group.isPrivate ? 'Private' : 'Public'} />
        <Fact label="Joining" value={group.isClosed ? 'Invite-only' : 'Open'} />
      </div>

      {error && <div className="text-[12px] text-destructive px-4">{error}</div>}

      {group.isMember && (
        <div className="px-4 mt-3">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive justify-start w-full hover:text-destructive hover:bg-destructive/10"
            onClick={onLeave}
            disabled={pending.leave}
          >
            <LogOut className="size-4 mr-2" />
            {pending.leave ? 'Leaving…' : 'Leave group'}
          </Button>
        </div>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-card/60">
      <span className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-semibold">
        {label}
      </span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12px] truncate">{value}</span>
        {action}
      </div>
    </div>
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
