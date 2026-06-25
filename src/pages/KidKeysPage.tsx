import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, KeyRound, Eye, EyeOff, Copy, Check, Download, Loader2,
} from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { type NLoginType } from '@nostrify/react/login';
import { useNostrLogin } from '@nostrify/react/login';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KidAvatar } from '@/components/KidAvatar';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useAppContext } from '@/hooks/useAppContext';
import { useToast } from '@/hooks/useToast';
import { saveNsec } from '@/lib/credentialManager';
import { possessive } from '@/lib/getDisplayName';

interface FamilyAccount {
  pubkey: string;
  displayName: string;
  role: 'parent' | 'kid';
}

/**
 * /parent/keys — backup keys page for the whole family.
 *
 * Lists every account associated with this Kubo install: the parent first,
 * then each kid. Each card shows the npub (always) and, for accounts whose
 * secret key is held locally as an `nsec` login, the nsec with copy / reveal /
 * back-up controls. Accounts whose key isn't on this device (extension,
 * remote signer, or kid not yet loaded into the signer pool) get an
 * explanatory note instead — so the parent can still copy any npub from one
 * place.
 */
export function KidKeysPage() {
  const nav = useNavigate();

  const { logins } = useNostrLogin();
  const { family } = useKuboFamily();

  const accounts: FamilyAccount[] = family
    ? [
        {
          pubkey: family.parentPubkey,
          displayName: family.parentDisplayName || 'Parent',
          role: 'parent',
        },
        ...family.kids.map<FamilyAccount>((k) => ({
          pubkey: k.pubkey,
          displayName: k.displayName,
          role: 'kid',
        })),
      ]
    : [];

  const header = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-full"
        onClick={() => nav('/parent/home')}
        aria-label="Back"
      >
        <ChevronLeft className="size-5" />
      </Button>
      <h1 className="text-base font-semibold flex-1">Backup keys</h1>
    </div>
  );

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        {header}
        <div className="rounded-2xl bg-card p-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            No family record on this device yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
      {header}
      <p className="text-xs text-muted-foreground leading-relaxed px-1">
        Public keys (npub) are safe to share — they identify each account on Nostr.
        Secret keys (nsec) control the account and must be kept private.
      </p>
      {accounts.map((account) => (
        <AccountKeyCard
          key={account.pubkey}
          account={account}
          login={logins.find((l) => l.pubkey === account.pubkey)}
        />
      ))}
    </div>
  );
}

interface AccountKeyCardProps {
  account: FamilyAccount;
  login: NLoginType | undefined;
}

function AccountKeyCard({ account, login }: AccountKeyCardProps) {
  const { config } = useAppContext();
  const { toast } = useToast();

  const [showKey, setShowKey] = useState(false);
  const [copiedNpub, setCopiedNpub] = useState(false);
  const [copiedNsec, setCopiedNsec] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const npub = nip19.npubEncode(account.pubkey);
  const initial = account.displayName[0]?.toUpperCase();
  const roleLabel = account.role === 'parent' ? 'Parent' : 'Kid';

  const handleCopyNpub = async () => {
    try {
      await navigator.clipboard.writeText(npub);
      setCopiedNpub(true);
      setTimeout(() => setCopiedNpub(false), 1500);
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Could not access the clipboard.',
        variant: 'destructive',
      });
    }
  };

  const nsec = login?.type === 'nsec' ? login.data.nsec : null;

  const handleCopyNsec = async () => {
    if (!nsec) return;
    try {
      await navigator.clipboard.writeText(nsec);
      setCopiedNsec(true);
      setTimeout(() => setCopiedNsec(false), 1500);
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Could not access the clipboard. Reveal the key and copy it manually.',
        variant: 'destructive',
      });
    }
  };

  const handleBackup = async () => {
    if (!nsec || isSaving) return;
    setIsSaving(true);
    try {
      const result = await saveNsec(npub, nsec, `${config.appName} - ${account.displayName}`);
      if (result === 'saved-to-file') {
        toast({
          title: 'Secret key saved',
          description: 'The secret key was saved to the Documents folder on your device.',
        });
      } else if (result === 'saved') {
        toast({ title: 'Secret key saved' });
      }
    } catch {
      toast({
        title: 'Save failed',
        description: 'Could not save the key. Please copy it manually.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const unavailableMessage = (() => {
    if (nsec) return null;
    if (!login) {
      return `${account.displayName}'s key isn't loaded on this device. Sign in with their key to back it up here.`;
    }
    if (login.type === 'extension') {
      return `${account.displayName} is signed in with a browser extension (NIP-07). The secret key is stored there — manage or export it from the extension itself.`;
    }
    if (login.type === 'bunker') {
      return `${account.displayName} is signed in with a remote signer (NIP-46). The secret key is held by that signer and cannot be exported from ${config.appName}.`;
    }
    return `${account.displayName}'s secret key isn't available on this device.`;
  })();

  return (
    <div className="rounded-2xl bg-card p-4 flex flex-col gap-3">
      {/* Identity */}
      <div className="flex items-center gap-3">
        <KidAvatar
          pubkey={account.pubkey}
          className="size-10"
          fallbackInitial={initial}
        />
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{account.displayName}</div>
          <div className="text-[11px] text-muted-foreground">{roleLabel}</div>
        </div>
      </div>

      {/* npub */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <KeyRound className="size-3.5 text-primary/70" />
          <span className="text-xs font-medium">Public key (npub)</span>
        </div>
        <div className="relative">
          <Input
            type="text"
            value={npub}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
            className="pr-12 font-mono text-base md:text-sm"
            aria-label={`${possessive(account.displayName)} public key`}
          />
          <div className="absolute right-0 top-0 h-full flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full px-2 hover:bg-transparent"
              onClick={handleCopyNpub}
              aria-label={`Copy ${possessive(account.displayName)} public key`}
            >
              {copiedNpub ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Copy className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* nsec */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <KeyRound className="size-3.5 text-primary/70" />
          <span className="text-xs font-medium">Secret key (nsec)</span>
        </div>

        {nsec ? (
          <>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={nsec}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.currentTarget.select()}
                className="pr-20 font-mono text-base md:text-sm"
                aria-label={`${possessive(account.displayName)} secret key`}
              />
              <div className="absolute right-0 top-0 h-full flex items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-full px-2 hover:bg-transparent"
                  onClick={handleCopyNsec}
                  aria-label={`Copy ${possessive(account.displayName)} secret key`}
                >
                  {copiedNsec ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-full px-2 hover:bg-transparent"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? `Hide ${possessive(account.displayName)} secret key` : `Reveal ${possessive(account.displayName)} secret key`}
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>

            {showKey && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800 animate-in fade-in slide-in-from-top-1 duration-200">
                <p className="text-xs text-amber-900 dark:text-amber-300 leading-relaxed">
                  NEVER share this secret key. Anyone with it can post as {account.displayName}, read their DMs, and impersonate them.
                </p>
              </div>
            )}

            <Button
              type="button"
              size="sm"
              className="w-full gap-2 rounded-full h-10"
              onClick={handleBackup}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" /> Back up key
                </>
              )}
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {unavailableMessage}
          </p>
        )}
      </div>
    </div>
  );
}
