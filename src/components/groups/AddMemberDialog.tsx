import { useEffect, useMemo, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { nip19 } from 'nostr-tools';

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
import { useAuthor } from '@/hooks/useAuthor';
import { usePortalDarkTheme } from '@/hooks/usePortalDarkTheme';
import { useGroupActions } from '@/hooks/useGroupActions';
import { useNip05Resolve } from '@/hooks/useNip05Resolve';
import { genUserName } from '@/lib/genUserName';

interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addr: string;
  /** Pubkeys already in the group, used to short-circuit re-adds. */
  existing?: Set<string>;
}

const HEX_RE = /^[0-9a-f]{64}$/i;

/**
 * Resolve a free-text input (npub / hex / NIP-05) to a hex pubkey, with
 * a 250 ms debounce so we don't spam NIP-05 lookups on every keystroke.
 */
function useResolvedPubkey(input: string): {
  pubkey?: string;
  isResolving: boolean;
  error?: string;
} {
  const [debounced, setDebounced] = useState(input);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(input), 250);
    return () => window.clearTimeout(t);
  }, [input]);

  // Synchronous resolution paths (npub / hex). Only fall through to
  // NIP-05 when neither matches.
  const sync = useMemo<{ pubkey?: string; error?: string; isNip05: boolean }>(() => {
    const trimmed = debounced.trim();
    if (!trimmed) return { isNip05: false };
    if (trimmed.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(trimmed);
        if (decoded.type === 'npub') return { pubkey: decoded.data, isNip05: false };
      } catch {
        // fallthrough
      }
      return { error: 'Invalid npub.', isNip05: false };
    }
    if (HEX_RE.test(trimmed)) return { pubkey: trimmed.toLowerCase(), isNip05: false };
    if (trimmed.includes('.')) return { isNip05: true };
    return { error: 'Enter an npub, NIP-05, or 64-char hex pubkey.', isNip05: false };
  }, [debounced]);

  const nip05 = useNip05Resolve(sync.isNip05 ? debounced.trim() : undefined);

  if (sync.pubkey) return { pubkey: sync.pubkey, isResolving: false };
  if (sync.error) return { isResolving: false, error: sync.error };
  if (sync.isNip05) {
    if (nip05.isLoading) return { isResolving: true };
    if (nip05.data) return { pubkey: nip05.data, isResolving: false };
    return { isResolving: false, error: 'NIP-05 not found.' };
  }
  return { isResolving: false };
}

export function AddMemberDialog({ open, onOpenChange, addr, existing }: AddMemberDialogProps) {
  const themeStyle = usePortalDarkTheme();
  const { putUser, pending } = useGroupActions();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { pubkey, isResolving, error: resolveError } = useResolvedPubkey(input);
  const author = useAuthor(pubkey);

  const alreadyMember = !!pubkey && !!existing?.has(pubkey);

  const reset = () => {
    setInput('');
    setError(null);
  };

  const handleClose = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pubkey) return;
    setError(null);
    try {
      await putUser(addr, pubkey);
      handleClose(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add member.');
    }
  };

  const meta = author.data?.metadata;
  const previewName =
    meta?.display_name || meta?.name || (pubkey ? genUserName(pubkey) : '');

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-md bg-background text-foreground"
        style={themeStyle}
        data-theme-mode="dark"
      >
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Paste an npub, a NIP-05 (e.g. <code>alice@example.com</code>), or a
            64-character hex pubkey.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-member-input">Identifier</Label>
            <Input
              id="add-member-input"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="npub1… / alice@example.com / hex"
            />
            {isResolving && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Resolving…
              </div>
            )}
            {resolveError && !isResolving && (
              <div className="text-[12px] text-destructive">{resolveError}</div>
            )}
          </div>

          {pubkey && (
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-card/60">
              <div
                className="size-9 rounded-full flex-shrink-0 overflow-hidden bg-slate-500 flex items-center justify-center text-white text-[12px] font-semibold"
                aria-hidden
              >
                {meta?.picture ? (
                  <img src={meta.picture} alt="" className="size-full object-cover" />
                ) : (
                  previewName.slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{previewName}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {nip19.npubEncode(pubkey)}
                </div>
              </div>
            </div>
          )}

          {alreadyMember && (
            <div className="text-[12px] text-muted-foreground">
              This user is already in the group.
            </div>
          )}
          {error && <div className="text-[12px] text-destructive">{error}</div>}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleClose(false)}
              disabled={pending.putUser}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!pubkey || alreadyMember || pending.putUser}
            >
              <UserPlus className="size-4 mr-2" />
              {pending.putUser ? 'Adding…' : 'Add member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
