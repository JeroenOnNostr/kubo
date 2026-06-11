import { useMemo, useRef } from 'react';
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
import { useRegisterTourAnchor } from '@/contexts/TourAnchorContext';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { toast } from '@/hooks/useToast';
import { isDarkTheme } from '@/lib/colorUtils';
import { cn } from '@/lib/utils';
import { builtinThemes, coreToTokens, toThemeVar } from '@/themes';

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

  // KUBO-092 tour step 5 anchor — the pill in the parent header.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useRegisterTourAnchor('kidSelectorPill', triggerRef);

  const kids = family?.kids ?? [];
  const label = selectedKid?.displayName ?? 'Select kid';
  const initial = selectedKid?.displayName?.charAt(0).toUpperCase() ?? '';

  // The selector only renders inside KuboParentLayout, so the active view is
  // always the parent view of `selectedKid`. Never offer a destination that's
  // the view we're already on: hide the currently-selected kid from the
  // "Switch to parent view" list (jumping into a kid's *kid app* is always a
  // real navigation, so the "kid view" list stays complete). A section with no
  // remaining entries — and its separator — is dropped entirely.
  const parentTargets = kids.filter((k) => k.pubkey !== selectedKid?.pubkey);

  // The menu renders through a Radix Portal at document.body — outside the
  // ScopedTheme wrapper in KuboParentLayout — so it'd otherwise inherit the
  // global (light) theme variables and render off-white. Apply Kubo's dark
  // palette as CSS variables directly on the content element so its own
  // `bg-popover`/`text-popover-foreground` resolve against the dark theme.
  // (Wrapping the menu's children doesn't work: vars cascade downward, and
  // the content's background is painted on the element itself, not a child.)
  const darkThemeVars = useMemo(() => {
    const tokens = coreToTokens(builtinThemes.dark);
    const vars: Record<string, string> = {};
    for (const [key, val] of Object.entries(tokens) as [string, string][]) {
      vars[toThemeVar(key)] = val;
    }
    return vars;
  }, []);
  const darkThemeMode = isDarkTheme(builtinThemes.dark.background) ? 'dark' : 'light';

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
          ref={triggerRef}
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
      <DropdownMenuContent
        align="end"
        className="w-56"
        style={darkThemeVars}
        data-theme-mode={darkThemeMode}
      >
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

        {parentTargets.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Switch to parent view</DropdownMenuLabel>
            {parentTargets.map((k) => (
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
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => nav('/onboard/add-kid')}>
          Add a kid…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
