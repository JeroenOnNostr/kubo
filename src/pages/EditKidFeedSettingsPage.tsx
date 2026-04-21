import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ContentSettings } from '@/components/ContentSettings';
import { NoKidSelected } from '@/components/NoKidSelected';
import { useSelectedKid } from '@/hooks/useSelectedKid';

/**
 * /parent/feed-settings — edit the active kid's feedSettings.
 *
 * The active Nostr signer IS the kid (parent picks via the top-right gear
 * dropdown), so Ditto's <ContentSettings /> reads/writes under the kid's
 * pubkey without any signer-swap gymnastics.
 */
export function EditKidFeedSettingsPage() {
  const nav = useNavigate();
  const kid = useSelectedKid();

  if (!kid) {
    return <NoKidSelected title="Feed settings" />;
  }

  return (
    <main className="flex flex-col">
      <Header
        title={`Feed settings · ${kid.displayName}`}
        onBack={() => nav('/parent/home')}
      />
      <div className="p-4">
        <ContentSettings />
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
