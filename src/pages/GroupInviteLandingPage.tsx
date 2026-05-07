import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Loader2, LogIn } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useGroup } from '@/hooks/useGroup';
import { useGroupActions } from '@/hooks/useGroupActions';
import { useParentSigner } from '@/hooks/useParentSigner';
import { formatGroupAddr } from '@/lib/nip29';

/**
 * /parent/groups/invite/:host/:gid/:code — landing page for an invite
 * URL minted by {@link InviteCodesDialog}. Shows the group's identity
 * and a "Join group" button that publishes a kind-9021 with the code,
 * then redirects to the group view.
 *
 * The landing page sits under `KuboParentLayout`, so the kid selector
 * is visible at the top — a parent who's "logged out" (kid-only on this
 * device) gets a clear message + a way back.
 */
export function GroupInviteLandingPage() {
  const nav = useNavigate();
  const params = useParams<{ host: string; gid: string; code: string }>();
  const host = params.host ? decodeURIComponent(params.host) : undefined;
  const gid = params.gid ? decodeURIComponent(params.gid) : undefined;
  const code = params.code ? decodeURIComponent(params.code) : undefined;

  const addr = host && gid ? formatGroupAddr(host, gid) : undefined;
  const { data: group, isLoading } = useGroup(addr);
  const { join, pending } = useGroupActions();
  const { reason: parentReason } = useParentSigner();
  const [error, setError] = useState<string | null>(null);

  const onJoin = async () => {
    if (!addr || !code) return;
    setError(null);
    try {
      await join(addr, code);
      nav(`/parent/groups/${encodeURIComponent(addr)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join group.');
    }
  };

  if (!addr || !code) {
    return (
      <div className="px-4 pt-6 text-[13px] text-muted-foreground">
        Invite link is malformed.
      </div>
    );
  }

  const groupName = group?.name ?? gid ?? '';

  return (
    <div className="flex flex-col items-center px-4 pt-6 pb-10 gap-4">
      <Button
        variant="ghost"
        size="icon"
        className="self-start size-9 rounded-full"
        onClick={() => nav('/parent/trust/people')}
        aria-label="Back"
      >
        <ChevronLeft className="size-5" />
      </Button>

      <div className="w-full max-w-sm flex flex-col items-center gap-4 mt-2">
        <div
          className="size-20 rounded-full overflow-hidden bg-primary flex items-center justify-center text-primary-foreground text-[24px] font-semibold"
          aria-hidden
        >
          {group?.picture ? (
            <img src={group.picture} alt="" className="size-full object-cover" />
          ) : (
            groupName.slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="text-[18px] font-semibold text-center">
          You&apos;re invited to join {groupName ? <span className="text-primary">{groupName}</span> : 'this group'}
        </div>
        {group?.about && (
          <p className="text-[13px] text-muted-foreground text-center leading-relaxed">
            {group.about}
          </p>
        )}
        <div className="text-[11px] text-muted-foreground">{host}</div>

        {parentReason === 'parent-logged-out' ? (
          <div className="w-full p-3 rounded-xl bg-card/60 text-[12px] text-muted-foreground flex flex-col gap-1.5 items-start">
            <div className="font-semibold text-foreground flex items-center gap-2">
              <LogIn className="size-4" /> Sign in as parent
            </div>
            <p>
              Group membership is tracked on the parent identity. Switch to
              the parent account in the kid selector at the top of the
              screen, then come back to this link.
            </p>
          </div>
        ) : (
          <Button
            type="button"
            onClick={onJoin}
            disabled={isLoading || pending.join}
            className="w-full rounded-full"
          >
            {pending.join ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : null}
            {pending.join ? 'Joining…' : 'Join group'}
          </Button>
        )}

        {error && (
          <div className="text-[12px] text-destructive text-center">{error}</div>
        )}
      </div>
    </div>
  );
}
