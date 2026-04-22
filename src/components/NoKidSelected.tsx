import { useNavigate } from 'react-router-dom';
import { UserRound, Plus } from 'lucide-react';
import { useNostrLogin } from '@nostrify/react/login';

import { Button } from '@/components/ui/button';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { toast } from '@/hooks/useToast';

/**
 * Shown on kid-scoped parent pages when the active Nostr signer isn't one
 * of the registered kids (e.g. parent just logged in, or no kid has been
 * picked yet from the Select-kid pill in the top-right header).
 *
 * Offers a one-tap primary action instead of stale "open the gear menu"
 * copy: if the family has exactly one kid, selecting them is the only thing
 * a parent could want to do here; if more than one, guide them to the
 * persistent selector pill in the header.
 */
export function NoKidSelected({ title }: { title: string }) {
  const nav = useNavigate();
  const { family } = useKuboFamily();
  const { logins, setLogin } = useNostrLogin();
  const kids = family?.kids ?? [];

  const selectKid = (pubkey: string) => {
    const loginId = logins.find((l) => l.pubkey === pubkey)?.id;
    if (!loginId) {
      toast({
        title: "That kid's key isn't loaded",
        description: 'Re-add the kid from the parent dashboard.',
        variant: 'destructive',
      });
      return;
    }
    setLogin(loginId);
  };

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
      <h1 className="text-base font-semibold">{title}</h1>
      <div className="rounded-2xl bg-card p-6 flex flex-col items-center gap-4 text-center">
        <div className="size-12 rounded-full bg-muted flex items-center justify-center">
          <UserRound className="size-6 text-muted-foreground" />
        </div>

        {kids.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground max-w-xs">
              You haven't added any kids yet. Add one to start configuring their
              feed and trust settings.
            </p>
            <Button size="sm" className="rounded-full" onClick={() => nav('/onboard/add-kid')}>
              <Plus className="size-4 mr-1.5" />
              Add a kid
            </Button>
          </>
        ) : kids.length === 1 ? (
          <>
            <p className="text-sm text-muted-foreground max-w-xs">
              Select {kids[0].displayName} to view and edit their settings.
            </p>
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => selectKid(kids[0].pubkey)}
            >
              Select {kids[0].displayName}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground max-w-xs">
              Pick a kid to continue. Tap <span className="font-medium text-foreground">Select kid</span> in the top-right.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {kids.map((k) => (
                <Button
                  key={k.pubkey}
                  size="sm"
                  variant="secondary"
                  className="rounded-full"
                  onClick={() => selectKid(k.pubkey)}
                >
                  {k.displayName}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
