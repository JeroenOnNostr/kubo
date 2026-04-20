import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * /onboard/create-parent — one-screen signup (no scary "save your 24 words").
 *
 * Purely visual in this PR. The "Continue" button simulates a short
 * async with setTimeout and then navigates to /onboard/add-kid. The real
 * flow (key generation via nostr-tools, `useLoginActions.nsec`, saveNsec,
 * publishing a kind 0) is wired by the data-layer agent using Ditto's
 * existing SignupDialog code as reference.
 */
export function CreateParentAccountPage() {
  const nav = useNavigate();

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length >= 2 && !submitting;

  const handleCreate = () => {
    if (!canSubmit) return;
    setSubmitting(true);
    // Simulate async account creation. Replaced in the data-layer PR.
    setTimeout(() => nav('/onboard/add-kid'), 600);
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
