import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TrustLegend } from '@/components/trust/TrustLegend';
import { TrustRow, type TrustLevel } from '@/components/trust/TrustRow';
import { TrustSection } from '@/components/trust/TrustSection';
import { useKidDisplayName } from '@/hooks/useKidDisplayName';

/**
 * /parent/kid/:id/trust/people — People tab of the Trust domain.
 *
 * Visual only. Fixed placeholder data matches contact-sheet screen 09.
 * A separate data-layer PR will swap these arrays for queries against
 * trust-people + NIP-72 group follows.
 */
type Person = {
  id: string;
  name: string;
  subtitle?: string;
  level: TrustLevel;
  avatar: React.ReactNode;
  avatarBg?: string;
};

const INNER_CIRCLE: Person[] = [
  { id: 'p1', name: 'Mommy Marie',  level: 'extend', avatar: 'M', avatarBg: '#6366F1' },
  { id: 'p2', name: 'Aunt Mallory', level: 'extend', avatar: 'A', avatarBg: '#F97316' },
  { id: 'p3', name: 'Uncle Jason',  level: 'extend', avatar: 'J', avatarBg: '#475569' },
];

const GROUPS: Person[] = [
  { id: 'g1', name: 'Soccer team B3',     subtitle: 'St. Pete Elementary Soccer club', level: 'interact', avatar: 'S', avatarBg: '#64748B' },
  { id: 'g2', name: 'Elementary class 4B', subtitle: 'Kids in class 4B',                level: 'interact', avatar: 'C', avatarBg: '#64748B' },
];

const OTHER: Person[] = [
  { id: 'o1', name: 'James White',     subtitle: 'via Kindergarten Parents', level: 'interact', avatar: 'J', avatarBg: '#64748B' },
  { id: 'o2', name: 'Sebastian H',     subtitle: 'via Soccer team B3',       level: 'view',     avatar: 'S', avatarBg: '#64748B' },
  { id: 'o3', name: 'Mr. Beast YT',    subtitle: 'Extended by Aunt Mallory', level: 'view',     avatar: 'B', avatarBg: '#64748B' },
];

export function TrustPeoplePage() {
  const { id = 'ellie' } = useParams<{ id: string }>();
  const kidName = useKidDisplayName(id);

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-6">
      <TrustHeader kidId={id} active="people" />

      <TrustLegend className="mt-1" />
      <p className="text-[11px] text-muted-foreground px-1 -mt-1">
        {`Who ${kidName} can see, interact with, and learn from.`}
      </p>

      <TrustSection title="Inner circle" note="extend trust" />
      {INNER_CIRCLE.map((p) => <TrustRow key={p.id} {...p} />)}

      <TrustSection title="Groups" />
      {GROUPS.map((p) => <TrustRow key={p.id} {...p} />)}

      <TrustSection title="Other" />
      {OTHER.map((p) => <TrustRow key={p.id} {...p} />)}

      <Button variant="secondary" size="lg" className="w-full h-11 rounded-full mt-2 gap-2">
        <Plus className="size-4" /> Add person
      </Button>
    </div>
  );
}

/**
 * Shared header for the Trust screens: back button, search pill, and
 * People/Places segmented control. Factored out so Places can reuse it
 * without duplicating 30 lines of markup.
 */
export function TrustHeader({
  kidId, active,
}: { kidId: string; active: 'people' | 'places' }) {
  const nav = useNavigate();

  return (
    <>
      {/* Top row */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav(`/parent/kid/${kidId}`)}
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <div className="flex-1 flex items-center gap-2 h-9 px-3 rounded-full bg-card text-[12px] text-muted-foreground">
          <Search className="size-4" aria-hidden />
          <span>Search…</span>
        </div>
      </div>

      <h1 className="text-center text-base font-semibold -mt-1">Trust domain</h1>

      {/* Segmented control */}
      <div className="h-9 p-1 rounded-full bg-card grid grid-cols-2 gap-1 text-[12px] font-medium">
        <SegButton
          active={active === 'people'}
          onClick={() => nav(`/parent/kid/${kidId}/trust/people`)}
        >
          People
        </SegButton>
        <SegButton
          active={active === 'places'}
          onClick={() => nav(`/parent/kid/${kidId}/trust/places`)}
        >
          Places
        </SegButton>
      </div>
    </>
  );
}

function SegButton({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        'h-full rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
