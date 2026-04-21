import { useNavigate } from 'react-router-dom';
import { UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useKuboFamily } from '@/hooks/useKuboFamily';

/**
 * Shown on kid-scoped parent pages when the active Nostr signer isn't one
 * of the registered kids (e.g. parent just logged in, or no kid has been
 * picked yet from the top-right gear menu).
 */
export function NoKidSelected({ title }: { title: string }) {
  const nav = useNavigate();
  const { family } = useKuboFamily();
  const hasKids = (family?.kids.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
      <h1 className="text-base font-semibold">{title}</h1>
      <div className="rounded-2xl bg-card p-6 flex flex-col items-center gap-3 text-center">
        <div className="size-12 rounded-full bg-muted flex items-center justify-center">
          <UserRound className="size-6 text-muted-foreground" />
        </div>
        {hasKids ? (
          <>
            <p className="text-sm text-muted-foreground">
              No kid selected. Open the gear menu in the top-right and pick a kid under
              “Switch to parent view”.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              You haven't added any kids yet.
            </p>
            <Button size="sm" onClick={() => nav('/onboard/add-kid')}>
              Add a kid
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
