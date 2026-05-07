import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TrustSection } from '@/components/trust/TrustSection';
import { useGroupActions } from '@/hooks/useGroupActions';
import type { GroupSnapshot } from '@/hooks/useGroup';
import { parseGroupAddr } from '@/lib/nip29';

interface GroupAboutTabProps {
  addr: string;
  group: GroupSnapshot;
}

/**
 * About tab — read-only summary for everyone (admins reach the editing
 * surface via the header overflow menu's "Edit group" item, which opens
 * {@link EditGroupDialog}). Keeps a single "Leave group" affordance
 * here for members; admins also see Leave in the header menu.
 *
 * Visual rhythm matches Trust > People: TrustSection headings,
 * card-tinted rows, 12-13px body text.
 */
export function GroupAboutTab({ addr, group }: GroupAboutTabProps) {
  const nav = useNavigate();
  const { leave, pending } = useGroupActions();
  const { gid, host } = parseGroupAddr(addr);

  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  return (
    <div className="flex-1 flex flex-col gap-3 pt-3 pb-6 overflow-y-auto">
      {/* Identity strip */}
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

      {group.about && (
        <p className="text-[13px] leading-relaxed text-muted-foreground px-4 mt-1">
          {group.about}
        </p>
      )}

      <div className="px-4 mt-1">
        <TrustSection title="Group info" />
      </div>
      <div className="flex flex-col gap-2 px-4">
        <Fact
          label="Group id"
          value={gid}
          action={
            <button
              type="button"
              onClick={copyAddr}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
              aria-label="Copy address"
            >
              <Copy className="size-3" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          }
        />
        <Fact label="Relay" value={host} />
        <Fact label="Members" value={String(group.members.length)} />
        <Fact label="Admins" value={String(group.admins.length)} />
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
