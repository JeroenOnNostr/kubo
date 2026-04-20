import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FeedVideo {
  id: string;
  title: string;
  creator: string;
  duration: string;
  /** Gradient string applied as the placeholder thumb background. */
  thumbGradient: string;
  avatarBg: string;
  /** "High" / "Mid" / "Low" — kept as a pure display string here. */
  trust: 'High' | 'Mid' | 'Low';
}

const TRUST_DOT: Record<FeedVideo['trust'], string> = {
  High: 'bg-[#22C55E]',
  Mid:  'bg-primary',
  Low:  'bg-[#EF4444]',
};

/**
 * Card used in the Home feed grid.
 *
 * Visual only — the thumb is a gradient placeholder. Wraps a button so
 * the entire card is tappable (navigates via `onClick`). A future PR
 * replaces this with a real <VideoPlayer /> preview + Blossom-hosted
 * image poster.
 */
export function VideoFeedCard({
  video,
  onClick,
}: {
  video: FeedVideo;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-2xl overflow-hidden bg-card',
        'hover:bg-card/80 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      {/* Thumb */}
      <div
        className="aspect-video w-full relative flex items-center justify-center"
        style={{ background: video.thumbGradient }}
      >
        <div className="size-12 rounded-full bg-white/90 flex items-center justify-center">
          <Play className="size-5 text-neutral-900 fill-neutral-900 ml-0.5" />
        </div>
        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] tabular-nums">
          {video.duration}
        </span>
      </div>

      {/* Meta */}
      <div className="flex items-start gap-2.5 p-3">
        <div
          className="size-8 rounded-full flex-shrink-0"
          style={{ backgroundColor: video.avatarBg }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold leading-tight line-clamp-2">
            {video.title}
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
            <span className="truncate">{video.creator}</span>
            <span aria-hidden>·</span>
            <span className={cn('size-1.5 rounded-full', TRUST_DOT[video.trust])} aria-hidden />
            <span>Trust {video.trust}</span>
          </div>
        </div>
      </div>
    </button>
  );
}
