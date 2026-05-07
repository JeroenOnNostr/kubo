import { useState } from 'react';
import { Copy, Link2, Loader2, Plus, Trash2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePortalDarkTheme } from '@/hooks/usePortalDarkTheme';
import { useGroupInvites } from '@/hooks/useGroupInvites';
import { buildInviteUrl, parseGroupAddr } from '@/lib/nip29';

interface InviteCodesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addr: string;
}

export function InviteCodesDialog({ open, onOpenChange, addr }: InviteCodesDialogProps) {
  const themeStyle = usePortalDarkTheme();
  const { invites, isLoading, createCode, revokeCode, pending } = useGroupInvites(addr);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { host, gid } = parseGroupAddr(addr);

  const onCreate = async () => {
    setError(null);
    try {
      await createCode();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate code.');
    }
  };

  const onRevoke = async (eventId: string) => {
    setError(null);
    try {
      await revokeCode(eventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke code.');
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      // ignore — clipboard may be denied
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
          <DialogTitle>Invite codes</DialogTitle>
          <DialogDescription>
            Closed groups need an invite code or admin approval to join. Share
            a code or its URL with someone you want in.
          </DialogDescription>
        </DialogHeader>

        <Button
          type="button"
          onClick={onCreate}
          disabled={pending.create}
          className="rounded-full"
        >
          {pending.create ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Plus className="size-4 mr-2" />
          )}
          {pending.create ? 'Generating…' : 'Generate code'}
        </Button>

        {error && <div className="text-[12px] text-destructive">{error}</div>}

        <div className="flex-1 overflow-y-auto -mx-2 px-2 flex flex-col gap-2 mt-1">
          {isLoading && invites.length === 0 && (
            <div className="text-[12px] text-muted-foreground py-4 text-center">
              Loading codes…
            </div>
          )}
          {!isLoading && invites.length === 0 && (
            <div className="text-[12px] text-muted-foreground py-4 text-center">
              No active invite codes.
            </div>
          )}
          {invites.map((inv) => {
            const url = buildInviteUrl(host, gid, inv.code);
            const codeKey = `code-${inv.eventId}`;
            const urlKey = `url-${inv.eventId}`;
            return (
              <div
                key={inv.eventId}
                className="flex items-center gap-2 p-2.5 rounded-xl bg-card/60"
              >
                <code className="flex-1 min-w-0 text-[12px] font-mono truncate">
                  {inv.code}
                </code>
                <button
                  type="button"
                  onClick={() => copy(inv.code, codeKey)}
                  className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                  aria-label="Copy code"
                  title="Copy code"
                >
                  <Copy className="size-3.5" />
                  {copied === codeKey ? 'Copied' : 'Code'}
                </button>
                <button
                  type="button"
                  onClick={() => copy(url, urlKey)}
                  className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                  aria-label="Copy URL"
                  title="Copy URL"
                >
                  <Link2 className="size-3.5" />
                  {copied === urlKey ? 'Copied' : 'URL'}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="size-7 rounded-full flex items-center justify-center hover:bg-card transition-colors flex-shrink-0"
                      aria-label="Code actions"
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => onRevoke(inv.eventId)}
                      className="text-destructive"
                      disabled={pending.revoke}
                    >
                      <Trash2 className="size-4 mr-2" />
                      Revoke code
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
