import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useNostrLogin } from '@nostrify/react/login';

import { Button } from '@/components/ui/button';
import { ContentSettings } from '@/components/ContentSettings';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useKidDisplayName } from '@/hooks/useKidDisplayName';

/**
 * /parent/kid/:id/feed-settings — edit a kid's feedSettings.
 *
 * Reuses Ditto's existing <ContentSettings /> by briefly switching the active
 * signer to the kid. On unmount we restore the original login so the parent
 * lands back on their own account. This is a best-effort restore — browser
 * back or tab close while editing leaves the kid as the active signer, which
 * the parent can correct via the account switcher. A visible "editing as
 * {kid}" banner + hardened restore is a planned follow-up.
 */
export function EditKidFeedSettingsPage() {
  const nav = useNavigate();
  const { id = '' } = useParams<{ id: string }>();
  const kidName = useKidDisplayName(id);
  const { logins, setLogin } = useNostrLogin();
  const { user } = useCurrentUser();

  // Capture the non-kid login id once, on mount. After setLogin swaps the kid
  // to logins[0], logins[0].id would point at the kid — too late to remember
  // who to restore. If the parent is already logged in as the kid for some
  // reason, fall back to any other available login.
  const kidLoginIdInit = `nsec:${id}`;
  const originalLoginId = useRef<string | null>(
    logins.find((l) => l.id !== kidLoginIdInit)?.id ?? null,
  );

  const kidLoginId = `nsec:${id}`;
  const kidLoginExists = logins.some((l) => l.id === kidLoginId);

  // Track whether we've switched yet so the rendered ContentSettings reads
  // the kid's feedSettings (not the parent's, even for a frame).
  const [switched, setSwitched] = useState(user?.pubkey === id);

  useEffect(() => {
    if (!kidLoginExists) return;
    if (user?.pubkey === id) {
      setSwitched(true);
      return;
    }
    setLogin(kidLoginId);
  }, [kidLoginExists, kidLoginId, id, user?.pubkey, setLogin]);

  useEffect(() => {
    if (user?.pubkey === id) setSwitched(true);
  }, [user?.pubkey, id]);

  useEffect(() => {
    const parentId = originalLoginId.current;
    return () => {
      if (parentId && parentId !== kidLoginId) {
        setLogin(parentId);
      }
    };
  }, [kidLoginId, setLogin]);

  if (!kidLoginExists) {
    return (
      <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
        <Header title="Feed settings" onBack={() => nav(`/parent/kid/${id}`)} />
        <p className="px-1 text-sm text-muted-foreground">
          This kid's key isn't stored on this device, so feed settings can't be edited here.
        </p>
      </div>
    );
  }

  return (
    <main className="flex flex-col">
      <Header
        title={kidName ? `Feed settings · ${kidName}` : 'Feed settings'}
        onBack={() => nav(`/parent/kid/${id}`)}
      />
      <div className="p-4">
        {switched ? (
          <ContentSettings />
        ) : (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
      </div>
    </main>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-full"
        onClick={onBack}
        aria-label="Back"
      >
        <ChevronLeft className="size-5" />
      </Button>
      <h1 className="text-base font-semibold flex-1 truncate">{title}</h1>
    </div>
  );
}
