import { memo, useState } from 'react';

import { TrustAssignmentBar } from '@/components/trust/TrustAssignmentBar';
import { TrustRow, type TrustLevel } from '@/components/trust/TrustRow';
import { useAuthor } from '@/hooks/useAuthor';
import { type KuboTrustLevel } from '@/hooks/useKuboFamily';
import { genUserName } from '@/lib/genUserName';

interface TrustFollowRowProps {
  /** The followed pubkey being rendered. */
  pubkey: string;
  /** The kid whose trust-assignment map owns this assignment. */
  kidPubkey: string;
  /** Current trust assignment, or undefined if unassigned. */
  assigned: KuboTrustLevel | undefined;
}

/**
 * One row of a kid's follow list, with inline-expand trust-level action bar.
 *
 * Mirrors Ditto's FollowingUserRow (ProfilePage.tsx): calls useAuthor(pubkey)
 * per row so cached profiles render instantly from IndexedDB. The trust
 * assignment is passed in as a prop from the page, which owns the partition.
 *
 * Memoized to skip re-renders when a sibling row's assignment changes — the
 * row only re-renders when its own props change (which includes `assigned`
 * flipping for this specific pubkey).
 */
export const TrustFollowRow = memo(function TrustFollowRow({
  pubkey,
  kidPubkey,
  assigned,
}: TrustFollowRowProps) {
  const { data: author } = useAuthor(pubkey);
  const [expanded, setExpanded] = useState(false);

  const metadata = author?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(pubkey);
  const displayLevel: TrustLevel = assigned ?? 'view';

  const avatar = metadata?.picture ? (
    <img
      src={metadata.picture}
      alt=""
      className="size-8 rounded-full object-cover"
    />
  ) : (
    displayName[0]?.toUpperCase() || '?'
  );

  return (
    <div className="flex flex-col">
      <TrustRow
        avatar={avatar}
        avatarBg={metadata?.picture ? undefined : '#64748B'}
        name={displayName}
        level={displayLevel}
        expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      />
      {expanded && (
        <div className="px-2.5 pb-2.5 rounded-b-xl bg-card/60">
          <TrustAssignmentBar
            kidPubkey={kidPubkey}
            pubkey={pubkey}
            onDone={() => setExpanded(false)}
          />
        </div>
      )}
    </div>
  );
});
