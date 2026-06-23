import { useCallback, useMemo } from 'react';
import { UserRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SourceActionButton } from '@/components/feed/SourceActionButton';
import { NoKidSelected } from '@/components/NoKidSelected';
import { ProfileSearchDropdown } from '@/components/ProfileSearchDropdown';
import { useAddFeedProfile } from '@/hooks/useAddFeedProfile';
import { useAuthor } from '@/hooks/useAuthor';
import { useFollowList } from '@/hooks/useFollowActions';
import type { SearchProfile } from '@/hooks/useSearchProfiles';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import {
  excludeChannelPubkeys,
  useYouTubeChannelPubkeys,
} from '@/hooks/useYouTubeChannelPubkeys';
import { genUserName } from '@/lib/genUserName';

import { FeedSourceHeader } from './_FeedSourceHeader';

/**
 * /parent/feed/profiles — follow and unfollow individual profiles for the
 * active kid. Writes directly to the kid's kind-3 follow list (the kid is
 * the active signer on this screen).
 *
 * Search uses Ditto's shared ProfileSearchDropdown so npub/nprofile/hex/nip05
 * inputs resolve to the exact profile via Ditto's detectIdentifier + useAuthor
 * pipeline. Picking any result — text-search or identifier — follows the
 * pubkey in place (additive). Unfollows happen via the Remove button on each
 * Following row below.
 */
export function ProfilesSourcePage() {
  const nav = useNavigate();
  const kid = useSelectedKid();
  const { data: followData } = useFollowList();
  const { addProfile, removeProfile, isPending } = useAddFeedProfile(kid?.pubkey);
  const queryClient = useQueryClient();

  // The "already followed?" check (for the add flow) must consider EVERY follow,
  // including channel npubs, so searching for a channel doesn't re-follow it.
  const allFollowed = useMemo(() => followData?.pubkeys ?? [], [followData?.pubkeys]);
  const followedSet = useMemo(() => new Set(allFollowed), [allFollowed]);
  // KUBO-207: but the displayed "Following" list excludes YouTube channels —
  // those are managed under the YouTube Channels source, not here.
  const channelPubkeys = useYouTubeChannelPubkeys(kid?.pubkey);
  const followedPubkeys = useMemo(
    () => excludeChannelPubkeys(allFollowed, channelPubkeys),
    [allFollowed, channelPubkeys],
  );

  const handlePick = useCallback((profile: SearchProfile) => {
    if (!followedSet.has(profile.pubkey)) {
      // addProfile follows the kid's kind-3 AND grants view-only trust (KUBO-147).
      addProfile(profile.pubkey);
      queryClient.invalidateQueries({ queryKey: ['kid-feed'] });
      queryClient.invalidateQueries({ queryKey: ['feed', 'follows'] });
    }
  }, [followedSet, addProfile, queryClient]);

  if (!kid) return <NoKidSelected title="Profiles" />;

  const handleToggle = async (pubkey: string) => {
    const wasFollowed = followedSet.has(pubkey);
    if (wasFollowed) {
      await removeProfile(pubkey);
    } else {
      await addProfile(pubkey);
    }
    // useFollowActions invalidates ['follow-list'], but useKidFeed and
    // useFeed('follows') both deliberately exclude the follow list from
    // their query keys, so without explicit invalidation the kid feed
    // and the parent preview tile would serve stale pages for ~60s.
    queryClient.invalidateQueries({ queryKey: ['kid-feed'] });
    queryClient.invalidateQueries({ queryKey: ['feed', 'follows'] });
  };

  return (
    <main className="flex flex-col">
      <FeedSourceHeader title={`Profiles · ${kid.displayName}`} />
      <div className="p-4 flex flex-col gap-4">
        <p className="text-[12px] text-muted-foreground px-1">
          Added profiles appear in {kid.displayName}'s feed right away.
        </p>

        <ProfileSearchDropdown
          placeholder="Search by name…"
          onSelect={handlePick}
          onSelectIdentifier={handlePick}
          hideCountry
          hideWikipedia
          hideArchive
          hideNavItems
          inputClassName="rounded-full bg-card h-11 text-[13px]"
          className="w-full"
        />

        <FollowedList
          pubkeys={followedPubkeys}
          onToggle={handleToggle}
          onProfileClick={(pubkey) => nav(`/parent/profile/${nip19.npubEncode(pubkey)}`)}
          disabled={isPending}
        />
      </div>
    </main>
  );
}

function FollowedList({
  pubkeys,
  onToggle,
  onProfileClick,
  disabled,
}: {
  pubkeys: string[];
  onToggle: (pubkey: string) => void;
  onProfileClick: (pubkey: string) => void;
  disabled: boolean;
}) {
  if (pubkeys.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground">
        No profiles followed yet. Search above to add someone.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
        Following · {pubkeys.length}
      </div>
      {pubkeys.map((pubkey) => (
        <FollowedRow
          key={pubkey}
          pubkey={pubkey}
          onToggle={() => onToggle(pubkey)}
          onProfileClick={() => onProfileClick(pubkey)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function FollowedRow({
  pubkey,
  onToggle,
  onProfileClick,
  disabled,
}: {
  pubkey: string;
  onToggle: () => void;
  onProfileClick: () => void;
  disabled: boolean;
}) {
  const { data: author } = useAuthor(pubkey);
  const metadata = author?.metadata;
  const name = metadata?.display_name || metadata?.name || genUserName(pubkey);
  const npub = nip19.npubEncode(pubkey);
  const subtitle = metadata?.nip05
    ? (metadata.nip05.startsWith('_@') ? metadata.nip05.slice(2) : metadata.nip05)
    : `${npub.slice(0, 12)}…${npub.slice(-4)}`;
  return (
    <ProfileRow
      picture={metadata?.picture}
      name={name}
      subtitle={subtitle}
      enabled={true}
      onToggle={onToggle}
      onProfileClick={onProfileClick}
      disabled={disabled}
    />
  );
}

function ProfileRow({
  picture,
  name,
  subtitle,
  enabled,
  onToggle,
  onProfileClick,
  disabled,
}: {
  picture?: string;
  name: string;
  subtitle: string;
  enabled: boolean;
  onToggle: () => void;
  onProfileClick: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-card hover:bg-card/80 transition-colors">
      <button
        type="button"
        onClick={onProfileClick}
        className="flex items-center gap-3 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg"
        aria-label={`Open ${name}'s profile`}
      >
        <Avatar className="size-9 shrink-0 border border-border/70">
          <AvatarImage src={picture} alt="" />
          <AvatarFallback>
            <UserRound className="size-4 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight" title={name}>
            {name}
          </div>
          <div className="truncate text-[11px] text-muted-foreground" title={subtitle}>
            {subtitle}
          </div>
        </div>
      </button>
      <SourceActionButton
        action={enabled ? 'remove' : 'add'}
        onClick={onToggle}
        disabled={disabled}
        itemLabel={name}
      />
    </div>
  );
}
