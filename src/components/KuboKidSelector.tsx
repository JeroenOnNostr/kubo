import { useNavigate } from 'react-router-dom';
import { ChevronDown, UserRound } from 'lucide-react';
import { useNostrLogin } from '@nostrify/react/login';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { KidAvatar } from '@/components/KidAvatar';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

/**
 * Persistent kid selector shown in the parent chrome header. Displays the
 * currently selected kid (from useSelectedKid) as a pill, and opens a
 * dropdown to swap the active signer to any other kid — either staying in
 * the parent view or jumping into the kid view.
 */
export function KuboKidSelector() {
  const nav = useNavigate();
  const { family } = useKuboFamily();
  const { logins, setLogin } = useNostrLogin();
  const selectedKid = useSelectedKid();

  const kids = family?.kids ?? [];
  const label = selectedKid?.displayName ?? 'Select kid';
  const initial = selectedKid?.displayName?.charAt(0).toUpperCase() ?? '';

  const pickKid = (kidPubkey: string, destination: '/kid' | '/parent/home') => {
    const loginId = logins.find((l) => l.pubkey === kidPubkey)?.id;
    if (!loginId) {
      toast({
        title: "That kid's key isn't loaded",
        description: 'Re-add the kid from the parent dashboard.',
        variant: 'destructive',
      });
      return;
    }
    setLogin(loginId);
    nav(destination);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-10 rounded-full gap-2 pl-1 pr-3"
          aria-label={selectedKid ? `Selected kid: ${label}` : 'Select a kid'}
        >
          {selectedKid ? (
            <KidAvatar
              pubkey={selectedKid.pubkey}
              className="size-8"
              fallbackInitial={initial}
            />
          ) : (
            <Avatar className="size-8">
              <AvatarFallback className="bg-muted text-[13px] font-medium text-foreground">
                <UserRound className="size-4 text-muted-foreground" />
              </AvatarFallback>
            </Avatar>
          )}
          <span className={cn('text-sm', !selectedKid && 'text-muted-foreground')}>
            {label}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Switch to kid view</DropdownMenuLabel>
        {kids.map((k) => (
          <DropdownMenuItem
            key={`kid-${k.pubkey}`}
            onClick={() => pickKid(k.pubkey, '/kid')}
            className="gap-2.5"
          >
            <KidAvatar
              pubkey={k.pubkey}
              className="size-6"
              fallbackInitial={k.displayName.charAt(0).toUpperCase()}
            />
            <span className="flex-1">{k.displayName}</span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Switch to parent view</DropdownMenuLabel>
        {kids.map((k) => (
          <DropdownMenuItem
            key={`parent-${k.pubkey}`}
            onClick={() => pickKid(k.pubkey, '/parent/home')}
            className="gap-2.5"
          >
            <KidAvatar
              pubkey={k.pubkey}
              className="size-6"
              fallbackInitial={k.displayName.charAt(0).toUpperCase()}
            />
            <span className="flex-1">{k.displayName}</span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => nav('/onboard/add-kid')}>
          Add a kid…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
