import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import { useWatchHistory } from '@/hooks/useWatchHistory';
import type { WatchEntry } from '@/lib/watchHistoryStore';

interface WatchHistoryStripProps {
  kidPubkey: string;
}

/**
 * Horizontal scroller of recently-watched videos for /parent/home.
 * Reads from the local watch-history store (snapshot-at-write so renders
 * are zero-network), capped to 10 items. The whole header row is tappable
 * — it's the entry point to the full history page, so it should look like
 * a navigation affordance, not a quiet text link.
 *
 * Page-local because this is wired into exactly one screen and shares the
 * dashboard's section visual language; promoting it to /components/ would
 * just create false reuse.
 */
export function WatchHistoryStrip({ kidPubkey }: WatchHistoryStripProps) {
  const navigate = useNavigate();
  const entries = useWatchHistory(kidPubkey, 10);

  const goToFullHistory = () => navigate('/parent/watch-history');

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={goToFullHistory}
        className="flex items-center gap-2 -mx-1 px-1 py-1 rounded text-left hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <h2 className="text-sm font-semibold flex-1">Kids watch history</h2>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </button>
      {entries.length === 0 ? (
        <div className="text-[12px] text-muted-foreground py-4">
          No videos watched yet.
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4">
          {entries.map((entry) => (
            <WatchHistoryCard key={entry.eventId} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

function WatchHistoryCard({ entry }: { entry: WatchEntry }) {
  const navigate = useNavigate();
  const path = `/parent/video/${entry.naddr ?? entry.eventId}`;

  return (
    <button
      type="button"
      onClick={() => navigate(path)}
      className="flex flex-col gap-2 shrink-0 w-40 text-left focus:outline-none focus:ring-2 focus:ring-ring rounded-xl"
    >
      <div className="aspect-video w-full rounded-xl bg-muted overflow-hidden">
        {entry.thumbnailUrl ? (
          <img
            src={entry.thumbnailUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : null}
      </div>
      <div className="text-[12px] font-medium leading-tight line-clamp-2">
        {entry.title || 'Untitled video'}
      </div>
      <div className="text-[11px] text-muted-foreground truncate">
        {entry.authorName || 'unknown'}
      </div>
    </button>
  );
}
