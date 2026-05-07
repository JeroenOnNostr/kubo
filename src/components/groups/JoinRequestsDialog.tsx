import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuthor } from '@/hooks/useAuthor';
import { usePortalDarkTheme } from '@/hooks/usePortalDarkTheme';
import { useGroupJoinRequests, type GroupJoinRequest } from '@/hooks/useGroupJoinRequests';
import { genUserName } from '@/lib/genUserName';

interface JoinRequestsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addr: string;
}

export function JoinRequestsDialog({ open, onOpenChange, addr }: JoinRequestsDialogProps) {
  const themeStyle = usePortalDarkTheme();
  const { requests, isLoading, approve, reject, pending } = useGroupJoinRequests(addr);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const onApprove = async (req: GroupJoinRequest) => {
    setError(null);
    setBusyId(req.eventId);
    try {
      await approve(req.pubkey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve.');
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (req: GroupJoinRequest) => {
    setError(null);
    setBusyId(req.eventId);
    try {
      await reject(req.eventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md bg-background text-foreground max-h-[80vh] flex flex-col"
        style={themeStyle}
        data-theme-mode="dark"
      >
        <DialogHeader>
          <DialogTitle>Join requests</DialogTitle>
          <DialogDescription>
            Approve to add the user to the group, or reject to dismiss the
            request.
          </DialogDescription>
        </DialogHeader>

        {error && <div className="text-[12px] text-destructive">{error}</div>}

        <div className="flex-1 overflow-y-auto -mx-2 px-2 flex flex-col gap-2 mt-1">
          {isLoading && requests.length === 0 && (
            <div className="text-[12px] text-muted-foreground py-4 text-center">
              Loading requests…
            </div>
          )}
          {!isLoading && requests.length === 0 && (
            <div className="text-[12px] text-muted-foreground py-4 text-center">
              No pending requests.
            </div>
          )}
          {requests.map((req) => (
            <RequestRow
              key={req.eventId}
              request={req}
              busy={busyId === req.eventId || pending.approve || pending.reject}
              onApprove={() => onApprove(req)}
              onReject={() => onReject(req)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RequestRow({
  request,
  busy,
  onApprove,
  onReject,
}: {
  request: GroupJoinRequest;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const nav = useNavigate();
  const author = useAuthor(request.pubkey);
  const meta = author.data?.metadata;
  const displayName =
    meta?.display_name || meta?.name || genUserName(request.pubkey);
  const picture = meta?.picture;

  return (
    <div className="flex items-start gap-3 p-2.5 rounded-xl bg-card/60">
      <button
        type="button"
        onClick={() => nav(`/parent/profile/${nip19.npubEncode(request.pubkey)}`)}
        className="size-9 rounded-full flex-shrink-0 overflow-hidden bg-slate-500 flex items-center justify-center text-white text-[12px] font-semibold"
        aria-label={`Open ${displayName}'s profile`}
      >
        {picture ? (
          <img src={picture} alt="" className="size-full object-cover" />
        ) : (
          displayName.slice(0, 1).toUpperCase()
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{displayName}</div>
        {request.content && (
          <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
            {request.content}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 sm:flex-row flex-shrink-0">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive size-8 p-0"
          onClick={onReject}
          disabled={busy}
          aria-label="Reject"
        >
          <X className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          className="size-8 p-0"
          onClick={onApprove}
          disabled={busy}
          aria-label="Approve"
        >
          <Check className="size-4" />
        </Button>
      </div>
    </div>
  );
}
