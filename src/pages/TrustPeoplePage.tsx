import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Plus, Search } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { NoKidSelected } from '@/components/NoKidSelected';
import { TrustLegend } from '@/components/trust/TrustLegend';
import { TrustRow, type TrustLevel } from '@/components/trust/TrustRow';
import { TrustSection } from '@/components/trust/TrustSection';
import { useSearchProfiles, type SearchProfile } from '@/hooks/useSearchProfiles';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { genUserName } from '@/lib/genUserName';

/**
 * /parent/trust/people — People tab of the Trust domain for the active kid.
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
  const nav = useNavigate();
  const kid = useSelectedKid();
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const { data: searchResults, isFetching } = useSearchProfiles(query);

  if (!kid) {
    return <NoKidSelected title="Trust · People" />;
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-6">
      <TrustHeader active="people" search={{ query, onQueryChange: setQuery }} />

      {trimmed.length === 0 ? (
        <>
          <TrustLegend className="mt-1" />
          <p className="text-[11px] text-muted-foreground px-1 -mt-1">
            {`Who ${kid.displayName} can see, interact with, and learn from.`}
          </p>

          <TrustSection title="Inner circle" note="extend trust" />
          {INNER_CIRCLE.map((p) => <TrustRow key={p.id} {...p} />)}

          <TrustSection title="Groups" />
          {GROUPS.map((p) => (
            <TrustRow
              key={p.id}
              {...p}
              onClick={() => nav(`/parent/groups/${p.id}`)}
            />
          ))}

          <TrustSection title="Other" />
          {OTHER.map((p) => <TrustRow key={p.id} {...p} />)}

          <Button variant="secondary" size="lg" className="w-full h-11 rounded-full mt-2 gap-2">
            <Plus className="size-4" /> Add person
          </Button>
        </>
      ) : (
        <TrustSearchResults
          results={searchResults ?? []}
          isFetching={isFetching}
          onSelect={(profile) =>
            nav(`/parent/profile/${nip19.npubEncode(profile.pubkey)}`)
          }
        />
      )}
    </div>
  );
}

/**
 * Renders profile search results as TrustRows. Shown in place of the
 * hardcoded sections when the search input has a non-empty query.
 *
 * New profiles have no trust level yet, so every row is rendered at
 * 'view' (the lowest level) — tapping navigates to the parent-profile
 * page where the user will eventually be able to assign a level.
 */
function TrustSearchResults({
  results, isFetching, onSelect,
}: {
  results: SearchProfile[];
  isFetching: boolean;
  onSelect: (profile: SearchProfile) => void;
}) {
  if (isFetching && results.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground px-1 mt-1">Searching…</p>
    );
  }

  if (results.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground px-1 mt-1">No people found.</p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 mt-1">
      {results.map((profile) => {
        const { pubkey, metadata } = profile;
        const displayName = metadata.display_name || metadata.name || genUserName(pubkey);
        const nip05 = metadata.nip05;
        const npub = nip19.npubEncode(pubkey);
        const subtitle = nip05
          ? (nip05.startsWith('_@') ? nip05.slice(2) : nip05)
          : `${npub.slice(0, 12)}…${npub.slice(-4)}`;
        const avatar = metadata.picture ? (
          <img
            src={metadata.picture}
            alt=""
            className="size-8 rounded-full object-cover"
          />
        ) : (
          displayName[0]?.toUpperCase() || '?'
        );

        return (
          <TrustRow
            key={pubkey}
            avatar={avatar}
            avatarBg={metadata.picture ? undefined : '#64748B'}
            name={displayName}
            subtitle={subtitle}
            level="view"
            onClick={() => onSelect(profile)}
          />
        );
      })}
    </div>
  );
}

/**
 * Shared header for the Trust screens: back button, search pill, and
 * People/Places segmented control. Factored out so Places can reuse it
 * without duplicating 30 lines of markup.
 */
export function TrustHeader({
  active, search,
}: {
  active: 'people' | 'places';
  /** Controlled search input. Omit to render the back button + segmented control only. */
  search?: { query: string; onQueryChange: (q: string) => void };
}) {
  const nav = useNavigate();

  return (
    <>
      {/* Top row */}
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
        {search && (
          <div className="flex-1 flex items-center gap-2 h-9 px-3 rounded-full bg-card">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input
              value={search.query}
              onChange={(e) => search.onQueryChange(e.target.value)}
              placeholder="Search…"
              className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Search people"
            />
          </div>
        )}
      </div>

      <h1 className="text-center text-base font-semibold -mt-1">Trust domain</h1>

      {/* Segmented control */}
      <div className="h-9 p-1 rounded-full bg-card grid grid-cols-2 gap-1 text-[12px] font-medium">
        <SegButton
          active={active === 'people'}
          onClick={() => nav('/parent/trust/people')}
        >
          People
        </SegButton>
        <SegButton
          active={active === 'places'}
          onClick={() => nav('/parent/trust/places')}
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
