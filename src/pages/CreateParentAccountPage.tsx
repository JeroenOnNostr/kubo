import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useNostr } from '@nostrify/react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/useToast';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useAppContext } from '@/hooks/useAppContext';
import { onboardIdentity } from '@/lib/kuboOnboarding';
import { setOnboardingParent } from '@/lib/onboardingParent';

/**
 * /onboard/create-parent — one-screen signup (no scary "save your 24 words").
 *
 * Generates the parent's Nostr identity, persists the nsec via the platform
 * credential manager, publishes a kind 0, and adds the login to Nostrify's
 * store. The parent's pubkey + display name are forwarded to AddKidPage via
 * router state; the family mapping is only committed once the kid is added.
 */
export function CreateParentAccountPage() {
  const nav = useNavigate();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const login = useLoginActions();

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showMinHint, setShowMinHint] = useState(false);

  const NAME_MAX = 50;
  const trimmedLength = name.trim().length;
  const canSubmit = trimmedLength >= 2 && trimmedLength <= NAME_MAX && !submitting;

  const handleCreate = async () => {
    if (trimmedLength < 2) {
      setShowMinHint(true);
      return;
    }
    if (!canSubmit) return;
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
      setOnboardingParent({
        parentPubkey: identity.pubkey,
        parentDisplayName: trimmed,
      });
      nav('/onboard/add-kid', {
        state: {
          parentPubkey: identity.pubkey,
          parentDisplayName: trimmed,
        },
      });
    } catch (err) {
      console.error('Parent onboarding failed:', err);
      toast({
        title: 'Could not create account',
        description: 'Something went wrong while setting up your account. Please try again.',
        variant: 'destructive',
      });
      setSubmitting(false);
    }
  };

  return (
    <form
      className="flex-1 flex flex-col max-w-sm mx-auto w-full pt-4 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        handleCreate();
      }}
    >
      <div className="flex-1 flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="parent-name">Your name</Label>
            {name.length > 0 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {name.length}/{NAME_MAX}
              </span>
            )}
          </div>
          <Input
            id="parent-name"
            autoFocus
            autoComplete="name"
            enterKeyHint="go"
            placeholder="Sam Rivera"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim().length >= 2) setShowMinHint(false);
            }}
            maxLength={NAME_MAX}
            className="h-12 rounded-xl text-base"
            disabled={submitting}
            aria-describedby={showMinHint ? 'parent-name-hint' : undefined}
          />
          {showMinHint && trimmedLength < 2 && (
            <p id="parent-name-hint" className="text-[11px] text-muted-foreground">
              At least 2 characters
            </p>
          )}
        </div>
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full h-12 rounded-full"
        disabled={!canSubmit}
      >
        {submitting
          ? <><Loader2 className="size-4 mr-2 animate-spin" /> Creating…</>
          : 'Continue'}
      </Button>
    </form>
  );
}
