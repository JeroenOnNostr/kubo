import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * /onboard/add-kid — final onboarding step.
 *
 * Purely visual in this PR. The "Add kid" button simulates a short async
 * with setTimeout and then navigates to /parent/home. The real flow (kid
 * identity + whatever persistence the data-layer agent chooses) is wired
 * later.
 */
export function AddKidPage() {
  const nav = useNavigate();

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length >= 1 && !submitting;

  const handleAdd = () => {
    if (!canSubmit) return;
    setSubmitting(true);
    // Simulate async kid creation. Replaced in the data-layer PR.
    setTimeout(() => nav('/parent/home', { replace: true }), 600);
  };

  return (
    <div className="flex-1 flex flex-col max-w-sm mx-auto w-full pt-4 pb-2">
      <div className="flex-1 flex flex-col gap-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Add your first kid</h1>
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
