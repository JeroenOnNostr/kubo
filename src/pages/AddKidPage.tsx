import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useNostr } from '@nostrify/react';
import { useNostrLogin } from '@nostrify/react/login';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/useToast';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useAppContext } from '@/hooks/useAppContext';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { onboardIdentity } from '@/lib/kuboOnboarding';

interface ParentHandoffState {
  parentPubkey?: string;
  parentDisplayName?: string;
}

/**
 * /onboard/add-kid — kid onboarding screen, reused for:
 *   • The initial onboarding flow (parent handoff via router state).
 *   • Adding further kids from the parent dashboard (parent read from
 *     kubo:family).
 *
 * After creating the kid, this page flips the active signer to the new kid so
 * the parent can immediately configure them — the parent dashboard scopes its
 * settings (follows, feed, relays) to whichever kid is logins[0].
 */
export function AddKidPage() {
  const nav = useNavigate();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const location = useLocation();
  const login = useLoginActions();
  const { setLogin } = useNostrLogin();
  const { family, setFamily, addKid } = useKuboFamily();

  const handoff = (location.state ?? {}) as ParentHandoffState;
  const parentPubkey = handoff.parentPubkey ?? family?.parentPubkey;
  const parentDisplayName = handoff.parentDisplayName ?? family?.parentDisplayName;

  const isFirstKid = (family?.kids.length ?? 0) === 0;

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length >= 1 && !submitting;

  const handleAdd = async () => {
    if (!canSubmit) return;
    if (!parentPubkey || !parentDisplayName) {
      // Genuinely unbound — no handoff state and no saved family. Bounce.
      nav('/onboard/welcome', { replace: true });
      return;
    }
    setSubmitting(true);
    try {
      const trimmed = name.trim();
      const identity = await onboardIdentity({
        nostr,
        name: trimmed,
        clientTagName: config.clientName ?? config.appName,
        clientNaddr: config.client,
      });
      login.nsec(identity.nsec);

      if (isFirstKid) {
        await setFamily({
          parentPubkey,
          parentDisplayName,
          kids: [{ pubkey: identity.pubkey, displayName: trimmed }],
        });
      } else {
        await addKid({ pubkey: identity.pubkey, displayName: trimmed });
      }

      // Make the freshly-created kid the active signer so the parent lands on
      // /parent/home already scoped to them. Nostrify's login id for an nsec
      // login is deterministic (`nsec:<pubkey>`), so we can reconstruct it
      // without reading `logins` (which would be stale in this same handler).
      setLogin(`nsec:${identity.pubkey}`);

      nav('/parent/home', { replace: true });
    } catch (err) {
      console.error('Kid onboarding failed:', err);
      toast({
        title: 'Could not add kid',
        description: 'Something went wrong while setting up the kid account. Please try again.',
        variant: 'destructive',
      });
      setSubmitting(false);
    }
  };

  const title = isFirstKid ? 'Add your first kid' : 'Add a kid';

  return (
    <div className="flex-1 flex flex-col max-w-sm mx-auto w-full pt-4 pb-2">
      <div className="flex-1 flex flex-col gap-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            We'll set up a Kubo identity for them. You'll manage who they
            follow and who can reach them from your parent dashboard.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="kid-name">Kid's name</Label>
          <Input
            id="kid-name"
            autoFocus
            placeholder="Mia"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-12 rounded-xl text-base"
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            Just a display name — you can change it anytime.
          </p>
        </div>
      </div>

      <Button
        size="lg"
        className="w-full h-12 rounded-full"
        disabled={!canSubmit}
        onClick={handleAdd}
      >
        {submitting
          ? <><Loader2 className="size-4 mr-2 animate-spin" /> Adding…</>
          : 'Add kid'}
      </Button>
    </div>
  );
}
