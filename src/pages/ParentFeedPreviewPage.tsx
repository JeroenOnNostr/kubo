import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { KidFeedList } from '@/components/feed/KidFeedList';
import { NoKidSelected } from '@/components/NoKidSelected';
import { useSelectedKid } from '@/hooks/useSelectedKid';

/**
 * /parent/feed/preview — dedicated preview of the selected kid's feed.
 * Moved out of ParentFeedPage when that page was redesigned as a feed-
 * source picker.
 */
export function ParentFeedPreviewPage() {
  const nav = useNavigate();
  const kid = useSelectedKid();

  if (!kid) {
    return <NoKidSelected title="Feed preview" />;
  }

  return (
    <main className="flex flex-col">
      <div className="flex items-center gap-2 px-4 pt-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav('/parent/feed')}
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <h1 className="text-base font-semibold flex-1 truncate">
          Feed preview · {kid.displayName}
        </h1>
      </div>
      <div className="p-4">
        <KidFeedList
          variant="parent"
          emptyMessage="Nothing here yet. This kid isn't following anyone whose posts match the enabled kinds."
        />
      </div>
    </main>
  );
}
