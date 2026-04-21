import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, KeyRound, Eye, EyeOff, Copy, Check, Download, Loader2,
} from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { useNostrLogin } from '@nostrify/react/login';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KidAvatar } from '@/components/KidAvatar';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useAppContext } from '@/hooks/useAppContext';
import { useToast } from '@/hooks/useToast';
import { saveNsec } from '@/lib/credentialManager';

/**
 * /parent/keys — backup keys page for the currently-selected kid.
 *
 * Reads from `logins[0]` (the active signer). The parent picks the kid
 * via the top-right gear dropdown, which calls setLogin() to make that
 * kid's account the active signer — so `logins[0]` is the kid whose
 * keys we want.
 *
 * Mirrors the `BackupKeySection` pattern from `ProfileSettings.tsx`.
 */
export function KidKeysPage() {
  const nav = useNavigate();

  const { logins } = useNostrLogin();
  const current = logins[0];
  const { family } = useKuboFamily();
  const kid = family?.kids.find((k) => k.pubkey === current?.pubkey);
  const displayName = kid?.displayName ?? 'This kid';
  const { config } = useAppContext();
  const { toast } = useToast();

  const [showKey, setShowKey] = useState(false);
  const [copiedNpub, setCopiedNpub] = useState(false);
  const [copiedNsec, setCopiedNsec] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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

  // Guard: no active login at all.
  if (!current) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        {header}
        <div className="rounded-2xl bg-card p-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Not signed in to a kid account. Switch to a kid view from the parent home menu.
          </p>
        </div>
      </div>
    );
  }

  const npub = nip19.npubEncode(current.pubkey);

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

  const identityBlock = (
    <div className="flex items-center gap-3 px-1">
      <KidAvatar
        pubkey={current.pubkey}
        className="size-12"
        fallbackInitial={displayName[0]?.toUpperCase()}
      />
      <div className="min-w-0">
        <div className="text-base font-semibold truncate">{displayName}</div>
        <div className="text-[11px] text-muted-foreground">Nostr keypair</div>
      </div>
    </div>
  );

  const npubSection = (
    <div className="rounded-2xl bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-primary/70" />
        <h2 className="text-sm font-semibold">Public key (npub)</h2>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Safe to share. This identifies your kid on Nostr.
      </p>
      <div className="relative">
        <Input
          type="text"
          value={npub}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
          className="pr-12 font-mono text-base md:text-sm"
          aria-label="Public key"
        />
        <div className="absolute right-0 top-0 h-full flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-full px-2 hover:bg-transparent"
            onClick={handleCopyNpub}
            aria-label="Copy public key"
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
  );

  // Guard: login type can't be exported (extension / bunker / unknown).
  if (current.type !== 'nsec') {
    const message =
      current.type === 'extension'
        ? `${displayName} is signed in with a browser extension (NIP-07). The secret key is stored there — manage or export it from the extension itself.`
        : current.type === 'bunker'
          ? `${displayName} is signed in with a remote signer (NIP-46). The secret key is held by that signer and cannot be exported from ${config.appName}.`
          : null;

    return (
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        {header}
        {identityBlock}
        {npubSection}
        {message && (
          <div className="rounded-2xl bg-card p-4">
            <div className="flex items-center gap-2 pb-2">
              <KeyRound className="size-4 text-primary/70" />
              <h2 className="text-sm font-semibold">Secret key (nsec)</h2>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{message}</p>
          </div>
        )}
      </div>
    );
  }

  const nsec = current.data.nsec;

  const handleCopyNsec = async () => {
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
    if (isSaving) return;
    setIsSaving(true);
    try {
      const result = await saveNsec(npub, nsec, config.appName);
      if (result === 'saved-to-file') {
        toast({
          title: 'Secret key saved',
          description: 'The secret key was saved to the Documents folder on your device.',
        });
      } else if (result === 'saved') {
        toast({ title: 'Secret key saved' });
      }
      // 'dismissed' is a deliberate user choice — no toast.
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

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
      {header}
      {identityBlock}
      {npubSection}

      {/* Secret key (nsec) section */}
      <div className="rounded-2xl bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary/70" />
          <h2 className="text-sm font-semibold">Secret key (nsec)</h2>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          This secret key controls <span className="font-semibold">{displayName}</span>'s account on {config.appName}. Anyone with it can post as them, read their DMs, and impersonate them. Store it in a password manager or somewhere else only you can access.
        </p>

        <div className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            value={nsec}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
            className="pr-20 font-mono text-base md:text-sm"
            aria-label="Secret key"
          />
          <div className="absolute right-0 top-0 h-full flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full px-2 hover:bg-transparent"
              onClick={handleCopyNsec}
              aria-label="Copy secret key"
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
              aria-label={showKey ? 'Hide secret key' : 'Reveal secret key'}
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
              NEVER share this secret key with anyone. Avoid screenshotting it or pasting it anywhere except a password manager. If shared, others will be able to access your kid's account.
            </p>
          </div>
        )}

        <Button
          type="button"
          size="lg"
          className="w-full gap-2 rounded-full h-12"
          onClick={handleBackup}
          disabled={isSaving}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Download className="w-4 h-4" /> Back Up Key
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
