import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { KidFeedList } from '@/components/feed/KidFeedList';
import { useSelectedKid } from '@/hooks/useSelectedKid';

/**
 * /parent/feed — Feed preview. Renders the exact same Nostr feed the
 * currently-selected kid sees on /kid, so the parent can review the kid's
 * experience without leaving the parent view.
 *
 * Kid switching lives in the shared KuboKidSelector in KuboParentLayout —
 * when the parent picks a different kid, `setLogin` swaps `logins[0]` and
 * `KidFeedList` re-renders with that kid's follow graph automatically.
 *
 * Event kinds are driven by Ditto's feedSettings (see `useKidFeed`). The
 * parent toggles them on /parent/kid/:id/feed-settings.
 */
export function ParentFeedPage() {
  const nav = useNavigate();
  const selectedKid = useSelectedKid();

  const previewHeading = selectedKid
    ? `Feed preview · ${selectedKid.displayName}`
    : 'Feed preview';

  return (
    <div className="flex flex-col gap-4 pt-2 pb-6">
      {/* Preview heading — tells the parent this mirrors the kid view */}
      <div className="px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {previewHeading}
      </div>

      {/* Search pill */}
      <div className="mx-4 flex items-center gap-2 h-11 px-4 rounded-full bg-card">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-[13px] text-muted-foreground">
          Search videos, creators…
        </span>
      </div>

      {/* Feed */}
      <div className="px-4">
        {selectedKid ? (
          <KidFeedList
            variant="parent"
            emptyMessage="Nothing here yet. This kid isn't following anyone whose posts match the enabled kinds."
          />
        ) : (
          <div className="rounded-2xl bg-card p-8 text-center text-sm text-muted-foreground">
            Pick a kid to preview their feed.
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        type="button"
        onClick={() => nav('/parent/upload')}
        aria-label="Upload a video"
        className={cn(
          'fixed right-5 bottom-[calc(env(safe-area-inset-bottom,0px)+80px)]',
          'size-14 rounded-full bg-primary text-primary-foreground shadow-lg',
          'flex items-center justify-center',
          'hover:bg-primary/90 active:scale-95 transition-transform',
        )}
      >
        <Plus className="size-6" />
      </button>
    </div>
  );
}
