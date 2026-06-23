import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Ban } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGroupActions } from '@/hooks/useGroupActions';
import { hostFromRelayUrl } from '@/lib/nip29';
import { NIP29_RELAYS } from '@/lib/appRelays';
import { builtinThemes, coreToTokens, toThemeVar } from '@/themes';

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Compact create-group form modeled after nostrord's dialog. Trimmed
 * to the essentials: name, relay, and the two access toggles.
 * Description / picture / id are post-create from the About tab.
 */
export function CreateGroupDialog({ open, onOpenChange }: CreateGroupDialogProps) {
  const nav = useNavigate();
  const { create, pending } = useGroupActions();

  const [name, setName] = useState('');
  const [relayUrl, setRelayUrl] = useState<string>(NIP29_RELAYS[0]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-compute Kubo's dark CSS variables once so we can apply them
  // as inline style on the portalled DialogContent.
  const themeStyle = useMemo(() => {
    const tokens = coreToTokens(builtinThemes.dark);
    const vars: Record<string, string> = {};
    for (const [key, val] of Object.entries(tokens) as [string, string][]) {
      vars[toThemeVar(key)] = val;
    }
    return vars as React.CSSProperties;
  }, []);

  const reset = () => {
    setName('');
    setRelayUrl(NIP29_RELAYS[0]);
    setIsPrivate(false);
    setIsClosed(false);
    setError(null);
  };

  const handleClose = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Group name is required.');
      return;
    }
    setError(null);
    try {
      const { addr } = await create({
        host: hostFromRelayUrl(relayUrl),
        name: name.trim(),
        isPrivate,
        isClosed,
      });
      handleClose(false);
      nav(`/parent/groups/${encodeURIComponent(addr)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the group.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {/*
        Radix portals dialog content out of the React tree to <body>,
        which sits OUTSIDE the parent layout's ScopedTheme wrapper. As
        a result, dialog descendants fall back to the global (light)
        shadcn defaults — so the dialog renders white-on-white. We
        re-apply Kubo's dark theme tokens inline on DialogContent so
        every descendant (including the absolute-positioned close X
        rendered by the Dialog primitive) resolves them.
      */}
      <DialogContent
        className="sm:max-w-md bg-background text-foreground"
        style={themeStyle}
        data-theme-mode="dark"
      >
        <DialogHeader>
          <DialogTitle>Create a group</DialogTitle>
          <DialogDescription>
            Give your group a name and pick a place to host it. You can add a
            description and picture from the About tab after it's created.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              autoFocus
              placeholder="e.g. Soccer team B3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-relay">Place</Label>
            <Select value={relayUrl} onValueChange={setRelayUrl}>
              <SelectTrigger id="group-relay">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NIP29_RELAYS.map((url) => (
                  <SelectItem key={url} value={url}>
                    {hostFromRelayUrl(url)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              The place hosts the group. You can&apos;t move it later.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mt-1">
              Access
            </p>
            <ToggleRow
              icon={<Lock className="size-4" />}
              title="Private"
              subtitle="Only members can read group messages"
              checked={isPrivate}
              onChange={setIsPrivate}
            />
            <ToggleRow
              icon={<Ban className="size-4" />}
              title="Closed"
              subtitle="Join requests are ignored (invite-only)"
              checked={isClosed}
              onChange={setIsClosed}
            />
          </div>

          {error && (
            <div className="text-[12px] text-destructive">{error}</div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleClose(false)}
              disabled={pending.create}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending.create}>
              {pending.create ? 'Creating…' : 'Create group'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  icon,
  title,
  subtitle,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 p-2.5 rounded-xl bg-card/60 cursor-pointer">
      <div className="size-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0" aria-hidden>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
