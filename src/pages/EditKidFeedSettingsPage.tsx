import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ContentSettings } from '@/components/ContentSettings';
import { useEditAsKid } from '@/hooks/useEditAsKid';
import { useKidDisplayName } from '@/hooks/useKidDisplayName';

/**
 * /parent/kid/:id/feed-settings — edit a kid's feedSettings.
 *
 * Reuses Ditto's existing <ContentSettings /> by briefly switching the active
 * signer to the kid via `useEditAsKid`. See that hook for the lifecycle and
 * known best-effort restore limits.
 */
export function EditKidFeedSettingsPage() {
  const nav = useNavigate();
  const { id = '' } = useParams<{ id: string }>();
  const kidName = useKidDisplayName(id);
  const edit = useEditAsKid(id);

  if (edit.status === 'unavailable') {
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
        {edit.status === 'ready' ? (
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
