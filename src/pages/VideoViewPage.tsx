import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Share2, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * /parent/video/:id — single video view.
 *
 * Visual only. Hard-coded metadata; the "Following" / "Follow" button
 * is just a label — tapping does nothing. Later PR swaps the gradient
 * for a real <VideoPlayer> + kind 0 metadata lookup + follow mutation.
 */
export function VideoViewPage() {
  const nav = useNavigate();
  useParams(); // :id — reserved for the data-layer PR

  return (
    <div className="flex flex-col gap-3 pt-2 pb-6">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav(-1)}
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          aria-label="Share"
        >
          <Share2 className="size-5" />
        </Button>
      </div>

      {/* Player placeholder */}
      <div
        className="mx-4 aspect-video rounded-2xl flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #334155, #1E293B)' }}
      >
        <div className="size-14 rounded-full bg-white/90 flex items-center justify-center">
          <Play className="size-6 text-neutral-900 fill-neutral-900 ml-0.5" />
        </div>
      </div>

      {/* Title */}
      <h1 className="px-4 text-[17px] font-semibold leading-snug text-balance">
        How do octopuses change colour?
      </h1>

      {/* Creator row */}
      <button
        type="button"
        onClick={() => nav('/parent/profile/marinekids')}
        className={cn(
          'mx-4 flex items-center gap-3 p-2 -ml-2 rounded-xl',
          'hover:bg-card/60 transition-colors text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        )}
      >
        <div className="size-10 rounded-full bg-[#6366F1] flex-shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold">MarineKids</div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-[#22C55E]" aria-hidden />
            Trust: High
          </div>
        </div>
        <span className="h-8 px-3 rounded-full bg-primary text-primary-foreground text-[12px] font-semibold flex items-center">
          Following
        </span>
      </button>

      {/* Description */}
      <p className="px-4 text-[12px] text-muted-foreground leading-relaxed">
        Today we meet a common octopus and see how he blends into his environment
        — and discover the cells under his skin that make it all possible.
      </p>

      {/* Related rail */}
      <section className="flex flex-col gap-2 mt-2">
        <h2 className="px-4 text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">
          More like this
        </h2>
        <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-2">
          {[
            { id: 'r1', title: 'Meet the giant squid', grad: 'linear-gradient(135deg, #7C3AED, #4C1D95)' },
            { id: 'r2', title: 'Coral reef fish ABC',  grad: 'linear-gradient(135deg, #0891B2, #164E63)' },
            { id: 'r3', title: 'Seahorse secrets',      grad: 'linear-gradient(135deg, #334155, #1E293B)' },
          ].map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => nav(`/parent/video/${r.id}`)}
              className="flex-shrink-0 w-44 text-left"
            >
              <div
                className="aspect-video w-full rounded-xl mb-2"
                style={{ background: r.grad }}
              />
              <div className="text-[12px] font-medium line-clamp-2">{r.title}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
