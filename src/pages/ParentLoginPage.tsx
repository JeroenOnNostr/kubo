import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useNostr } from '@nostrify/react';
import { nip19 } from 'nostr-tools';
import { Button } from '@/components/ui/button';
import { LoginForm } from '@/components/auth/LoginForm';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { setOnboardingParent } from '@/lib/onboardingParent';
import { genUserName } from '@/lib/genUserName';
import { parseAuthorEvent } from '@/hooks/useAuthor';

/**
 * /onboard/login — existing-account login for parents.
 *
 * Renders the login form (extension / remote signer / nsec) inline as part
 * of the onboarding step — not as a modal-on-empty-page. After a successful
 * login, looks up the user's existing kind-0 with a short timeout to extract
 * a display name, then forwards them straight to /onboard/add-kid. There's
 * no separate "what's your name?" step for existing-account parents because
 * their kind-0 already has one (and we won't overwrite their public profile).
 *
 * If kind-0 lookup hasn't returned in 5s, falls back to a deterministic
 * placeholder (npub-shortened) so the flow doesn't hang on offline /
 * unreachable relays.
 */
export function ParentLoginPage() {
  const nav = useNavigate();
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const [loggedIn, setLoggedIn] = useState(false);
  const [resolving, setResolving] = useState(false);
  const handledRef = useRef(false);

  // The login form fires onLogin when Nostrify's login store has accepted
  // the new login. Flip a flag and let the effect below pick up the change
  // once useCurrentUser() reflects the same login as logins[0].
  const handleLogin = () => setLoggedIn(true);

  useEffect(() => {
    if (!loggedIn || !user?.pubkey || handledRef.current) return;
    handledRef.current = true;
    setResolving(true);

    const pubkey = user.pubkey;

    const fallbackName = (): string => {
      try {
        const npub = nip19.npubEncode(pubkey);
        return `${npub.slice(0, 12)}…`;
      } catch {
        return genUserName(pubkey);
      }
    };

    (async () => {
      let parentDisplayName = '';
      try {
        const events = await nostr.query(
          [{ kinds: [0], authors: [pubkey], limit: 1 }],
          { signal: AbortSignal.timeout(5000) },
        );
        const event = events[0];
        if (event) {
          const { metadata } = parseAuthorEvent(event);
          parentDisplayName =
            (metadata?.name && metadata.name.trim()) ||
            (metadata?.display_name && metadata.display_name.trim()) ||
            '';
        }
      } catch {
        // Timeout / relay error — fall through to placeholder.
      }

      if (!parentDisplayName) {
        parentDisplayName = fallbackName();
      }

      setOnboardingParent({ parentPubkey: pubkey, parentDisplayName });
      nav('/onboard/add-kid', {
        replace: true,
        state: { parentPubkey: pubkey, parentDisplayName },
      });
    })();
  }, [loggedIn, user?.pubkey, nostr, nav]);

  return (
    <div className="flex-1 flex flex-col max-w-sm mx-auto w-full pt-4 pb-2">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="text-sm text-muted-foreground">
          Use a Nostr extension, a remote signer, or your secret key. After
          logging in, you'll add your first kid.
        </p>
      </div>

      <div className="flex-1">
        <LoginForm onLogin={handleLogin} autoTryCredential />
      </div>

      <Button
        variant="ghost"
        size="lg"
        className="w-full h-12 mt-6"
        onClick={() => nav('/onboard/welcome')}
        disabled={resolving}
      >
        Back
      </Button>

      {resolving && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Setting things up…
          </div>
        </div>
      )}
    </div>
  );
}
