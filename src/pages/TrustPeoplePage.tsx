import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

import { cn } from '@/lib/utils';
import { GroupsSection } from '@/components/groups/GroupsSection';
import { NoKidSelected } from '@/components/NoKidSelected';
import { ProfileSearchDropdown } from '@/components/ProfileSearchDropdown';
import { TrustFollowRow } from '@/components/trust/TrustFollowRow';
import { TrustLegend } from '@/components/trust/TrustLegend';
import { TrustSection } from '@/components/trust/TrustSection';
import { useAppContext } from '@/hooks/useAppContext';
import { useAuthors } from '@/hooks/useAuthors';
import { useKuboFamily, type KuboTrustLevel } from '@/hooks/useKuboFamily';
import type { SearchProfile } from '@/hooks/useSearchProfiles';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { genUserName } from '@/lib/genUserName';

/**
 * /parent/trust/people — People tab of the Trust domain for the active kid.
 *
 * Lists the profiles that have a local trust level assigned for the active
 * kid (independent of the kid's kind-3 follow list): 'extend' → INNER CIRCLE,
 * 'interact' / 'view' → OTHER. Profiles with no assignment do not appear.
 * Groups are NIP-29 managed groups (parent-scoped), rendered by GroupsSection.
 */

export function TrustPeoplePage() {
  const nav = useNavigate();
  const kid = useSelectedKid();
  const { family } = useKuboFamily();

  const handlePick = useCallback((profile: SearchProfile) => {
    nav(`/parent/profile/${nip19.npubEncode(profile.pubkey)}`);
  }, [nav]);

  // Read the kid's trust assignments once at the page level and pass each
  // row's assigned level down as a prop. Rows are memoized and won't re-render
  // when sibling assignments change.
  const kidAssignments = kid && family?.trustAssignments
    ? family.trustAssignments[kid.pubkey]
    : undefined;

  const assignedPubkeys = useMemo(
    () => (kidAssignments ? Object.keys(kidAssignments) : []),
    [kidAssignments],
  );

  // Batch-fetch metadata *only* to drive the alphabetical sort — rows still
  // call useAuthor individually for their display (cache-first). The batch
  // does not gate rendering; rows appear immediately and re-sort once
  // authorsMap resolves.
  const { data: authorsMap } = useAuthors(assignedPubkeys);

  const { innerCircle, other } = useMemo(() => {
    type Entry = { pubkey: string; assigned: KuboTrustLevel; sortKey: string };

    const nameFor = (pk: string): string => {
      const m = authorsMap?.get(pk)?.metadata;
      return (m?.display_name || m?.name || genUserName(pk)).toLowerCase();
    };

    // Rank for OTHER ordering: interact before view.
    const otherRank: Record<'interact' | 'view', number> = {
      interact: 0,
      view: 1,
    };

    const inner: Entry[] = [];
    const rest:  Entry[] = [];
    for (const pk of assignedPubkeys) {
      const assigned = kidAssignments![pk];
      const sortKey = nameFor(pk);
      if (assigned === 'extend') {
        inner.push({ pubkey: pk, assigned, sortKey });
      } else {
        rest.push({ pubkey: pk, assigned, sortKey });
      }
    }

    // INNER CIRCLE: alphabetical by display name.
    inner.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    // OTHER: group by level (interact → view), then alphabetical within each
    // group.
    rest.sort((a, b) => {
      const ra = otherRank[a.assigned as 'interact' | 'view'];
      const rb = otherRank[b.assigned as 'interact' | 'view'];
      if (ra !== rb) return ra - rb;
      return a.sortKey.localeCompare(b.sortKey);
    });

    return { innerCircle: inner, other: rest };
  }, [assignedPubkeys, kidAssignments, authorsMap]);

  if (!kid) {
    return <NoKidSelected title="Trust · People" />;
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-6">
      <TrustHeader active="people" />

      <TrustLegend kidName={kid.displayName} scope="people" className="mt-1" />

      <ProfileSearchDropdown
        placeholder="Search by name or npub…"
        onSelect={handlePick}
        onSelectIdentifier={handlePick}
        hideCountry
        hideWikipedia
        hideArchive
        hideNavItems
        inputClassName="rounded-full bg-card h-9 text-[12px]"
        className="w-full"
        renderProfileItem={(profile) => (
          <TrustFollowRow
            key={profile.pubkey}
            pubkey={profile.pubkey}
            kidPubkey={kid.pubkey}
            assigned={kidAssignments?.[profile.pubkey]}
          />
        )}
      />

      <TrustSection title="Inner circle" />
      {innerCircle.length === 0 ? (
        <EmptySection text="No one yet." />
      ) : (
        innerCircle.map(({ pubkey, assigned }) => (
          <TrustFollowRow
            key={pubkey}
            pubkey={pubkey}
            kidPubkey={kid.pubkey}
            assigned={assigned}
          />
        ))
      )}

      <GroupsSection />

      <TrustSection title="Other" />
      {other.length === 0 ? (
        <EmptySection text="No one yet." />
      ) : (
        other.map(({ pubkey, assigned }) => (
          <TrustFollowRow
            key={pubkey}
            pubkey={pubkey}
            kidPubkey={kid.pubkey}
            assigned={assigned}
          />
        ))
      )}
    </div>
  );
}

function EmptySection({ text }: { text: string }) {
  return (
    <div className="text-[12px] text-muted-foreground px-1 py-2">{text}</div>
  );
}

/**
 * Shared header for the Trust screens: title + People/Places segmented
 * control. Factored out so Places can reuse it without duplicating markup.
 */
export function TrustHeader({
  active,
}: {
  active: 'people' | 'places';
}) {
  const nav = useNavigate();
  const { config } = useAppContext();
  const { family } = useKuboFamily();

  // KUBO-182: show the Diagnostics link off the AUTHORITATIVE enforcement flag
  // (`family.teppEnforced`), not the `config.feedSettings.featureTepp` mirror.
  // Per KUBO-152 the mirror is device-local and parent-UI-only; it gets
  // clobbered to `false` when the active session flips to a freshly-added kid
  // whose synced settings omit `featureTepp` (adding a 2nd/3rd kid). That made
  // the button vanish even though TEPP was still enforced for the family. Use
  // the same predicate the EditKidSettingsPage toggle reflects so the two agree.
  const teppOn = family?.teppEnforced ?? !!config.feedSettings.featureTepp;

  return (
    <>
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
      {/* Diagnostics link — only when TEPP is on. Helps the parent see why
          trust assignments aren't filtering the kid feed. */}
      {teppOn && (
        <button
          type="button"
          onClick={() => nav('/parent/trust/diagnostics')}
          className="self-end text-[11px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
        >
          Diagnostics →
        </button>
      )}
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
