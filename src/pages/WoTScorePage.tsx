import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WoTDial } from '@/components/wot/WoTDial';
import { useKidDisplayName } from '@/hooks/useKidDisplayName';

/**
 * /parent/kid/:id/wot — web-of-trust score for this kid.
 *
 * Visual only. Score + contributor list are hard-coded placeholders.
 * The data-layer PR derives score client-side from the kid's
 * trust-people list + NIP-02 follow graphs — nothing is published.
 */
type Contributor = {
  id: string;
  name: string;
  points: number;
  level: 'extend' | 'interact' | 'view';
  bg: string;
};

const CONTRIBUTORS: Contributor[] = [
  { id: 'c1', name: 'MarineKids',  points: 12, level: 'extend',   bg: '#6366F1' },
  { id: 'c2', name: 'CozyKitchen', points:  8, level: 'interact', bg: '#F97316' },
  { id: 'c3', name: 'StoryTime',   points:  6, level: 'interact', bg: '#6366F1' },
  { id: 'c4', name: 'CraftyKids',  points:  4, level: 'view',     bg: '#22C55E' },
];

const LEVEL_PILL: Record<Contributor['level'], { label: string; className: string }> = {
  extend:   { label: 'Extend',   className: 'bg-[#22C55E]/15 text-[#22C55E]' },
  interact: { label: 'Interact', className: 'bg-primary/15 text-primary' },
  view:     { label: 'View',     className: 'bg-[#EF4444]/15 text-[#EF4444]' },
};

export function WoTScorePage() {
  const nav = useNavigate();
  const { id = 'ellie' } = useParams<{ id: string }>();
  const kidName = useKidDisplayName(id);

  const score = 72;

  return (
    <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
      {/* Top bar */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav(`/parent/kid/${id}`)}
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-[12px] text-muted-foreground">{kidName}</span>
      </div>

      <h1 className="text-center text-lg font-semibold">Web-of-trust score</h1>

      {/* Dial */}
      <div className="flex justify-center">
        <WoTDial score={score} />
      </div>

      <p className="text-center text-[12px] text-muted-foreground -mt-1">
        Strong. Based on 18 trusted sources.
      </p>

      {/* Top contributors */}
      <section className="flex flex-col gap-2 mt-2">
        <h2 className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold px-1">
          Top contributors
        </h2>
        {CONTRIBUTORS.map((c) => {
          const pill = LEVEL_PILL[c.level];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => nav(`/parent/profile/${c.id}`)}
              className={cn(
                'w-full flex items-center gap-3 p-2.5 rounded-xl bg-card/60',
                'hover:bg-card transition-colors text-left',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              )}
            >
              <div
                className="size-9 rounded-full flex-shrink-0"
                style={{ backgroundColor: c.bg }}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate">{c.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  +{c.points} pts
                </div>
              </div>
              <span
                className={cn(
                  'px-2.5 py-1 rounded-full text-[10px] font-semibold',
                  pill.className,
                )}
              >
                {pill.label}
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}
