import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import { Button } from '@/components/ui/button';
import { NoKidSelected } from '@/components/NoKidSelected';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { useWatchHistory } from '@/hooks/useWatchHistory';
import type { WatchEntry } from '@/lib/watchHistoryStore';

function timeAgo(viewedAt: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - viewedAt);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * /parent/watch-history — full per-kid scrollable watch history (up to 100
 * entries). Kid context comes from useSelectedKid, matching the rest of the
 * parent kid-scoped pages. Tap a row to jump to the post detail.
 */
export function KidWatchHistoryPage() {
  const kid = useSelectedKid();

  if (!kid) {
    return <NoKidSelected title="Watch history" />;
  }

  return <Content kidPubkey={kid.pubkey} kidDisplayName={kid.displayName} />;
}

function Content({ kidPubkey, kidDisplayName }: { kidPubkey: string; kidDisplayName: string }) {
  const nav = useNavigate();
  const entries = useWatchHistory(kidPubkey);

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav('/parent/home')}
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <h1 className="text-base font-semibold flex-1">Watch history</h1>
      </div>

      <p className="text-[12px] text-muted-foreground px-1">
        Videos {kidDisplayName} has watched on this device.
      </p>

      {entries.length === 0 ? (
        <div className="rounded-2xl bg-muted/50 p-8 text-center text-sm text-muted-foreground">
          No videos watched yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <WatchHistoryRow key={entry.eventId} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

function WatchHistoryRow({ entry }: { entry: WatchEntry }) {
  const navigate = useNavigate();
  const path = `/${nip19.neventEncode({ id: entry.eventId, author: entry.authorPubkey })}`;

  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(path)}
        className="w-full flex items-start gap-3 p-2 rounded-xl text-left hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <div className="aspect-video w-32 shrink-0 rounded-lg bg-muted overflow-hidden">
          {entry.thumbnailUrl ? (
            <img
              src={entry.thumbnailUrl}
              alt=""
              className="size-full object-cover"
              loading="lazy"
            />
          ) : null}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="text-[13px] font-medium leading-tight line-clamp-2">
            {entry.title || 'Untitled video'}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {entry.authorName || 'unknown'}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {timeAgo(entry.viewedAt)}
          </div>
        </div>
      </button>
    </li>
  );
}
