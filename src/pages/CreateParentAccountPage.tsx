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

  const canSubmit = name.trim().length >= 2 && !submitting;

  const handleCreate = async () => {
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
    <div className="flex-1 flex flex-col max-w-sm mx-auto w-full pt-4 pb-2">
      <div className="flex-1 flex flex-col gap-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted-foreground">
            Just your name for now. You can add a photo and more from the profile screen later.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="parent-name">Your name</Label>
          <Input
            id="parent-name"
            autoFocus
            autoComplete="name"
            placeholder="Sam Rivera"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-12 rounded-xl text-base"
            disabled={submitting}
          />
        </div>
      </div>

      <Button
        size="lg"
        className="w-full h-12 rounded-full"
        disabled={!canSubmit}
        onClick={handleCreate}
      >
        {submitting
          ? <><Loader2 className="size-4 mr-2 animate-spin" /> Creating…</>
          : 'Continue'}
      </Button>
    </div>
  );
}
