import { useState } from 'react';
import { Search, UserRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { NoKidSelected } from '@/components/NoKidSelected';
import { useAuthor } from '@/hooks/useAuthor';
import { useFollowActions, useFollowList } from '@/hooks/useFollowActions';
import { useSearchProfiles, type SearchProfile } from '@/hooks/useSearchProfiles';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { genUserName } from '@/lib/genUserName';

import { FeedSourceHeader } from './_FeedSourceHeader';

/**
 * /parent/feed/profiles — follow and unfollow individual profiles for the
 * active kid. Writes directly to the kid's kind-3 follow list (the kid is
 * the active signer on this screen).
 *
 * No separate storage — enabled = "in the kid's kind 3". Toggling here
 * affects the kid feed immediately (M2: we invalidate ['feed', 'follows']
 * after each mutation so the preview reflects the change without waiting
 * for the 60s stale timer).
 */
export function ProfilesSourcePage() {
  const kid = useSelectedKid();
  const [query, setQuery] = useState('');
  const { data: searchResults = [], isFetching } = useSearchProfiles(query);
  const { data: followData } = useFollowList();
  const { follow, unfollow, isPending } = useFollowActions();
  const queryClient = useQueryClient();

  const followedPubkeys = followData?.pubkeys ?? [];
  const followedSet = new Set(followedPubkeys);

  if (!kid) return <NoKidSelected title="Profiles" />;

  const handleToggle = async (pubkey: string) => {
    const wasFollowed = followedSet.has(pubkey);
    if (wasFollowed) {
      await unfollow(pubkey);
    } else {
      await follow(pubkey);
    }
    // M2: useFollowActions invalidates ['follow-list'] but the feed query
    // key deliberately excludes the follow list, so without this the
    // preview wouldn't reflect the new follow for ~60s.
    queryClient.invalidateQueries({ queryKey: ['feed', 'follows'] });
  };

  const trimmedQuery = query.trim();
  const showSearch = trimmedQuery.length > 0;

  return (
    <main className="flex flex-col">
      <FeedSourceHeader title={`Profiles · ${kid.displayName}`} />
      <div className="p-4 flex flex-col gap-4">
        <p className="text-[12px] text-muted-foreground px-1">
          Added profiles appear in {kid.displayName}'s feed right away.
        </p>

        <div className="flex items-center gap-2 h-11 px-4 rounded-full bg-card">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted-foreground"
            aria-label="Search people"
          />
        </div>

        {showSearch ? (
          <SearchResults
            results={searchResults}
            isFetching={isFetching}
            followedSet={followedSet}
            onToggle={handleToggle}
            disabled={isPending}
          />
        ) : (
          <FollowedList
            pubkeys={followedPubkeys}
            onToggle={handleToggle}
            disabled={isPending}
          />
        )}
      </div>
    </main>
  );
}

function SearchResults({
  results,
  isFetching,
  followedSet,
  onToggle,
  disabled,
}: {
  results: SearchProfile[];
  isFetching: boolean;
  followedSet: Set<string>;
  onToggle: (pubkey: string) => void;
  disabled: boolean;
}) {
  if (isFetching && results.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground">
        Searching…
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground">
        No people found.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {results.map((profile) => (
        <SearchResultRow
          key={profile.pubkey}
          profile={profile}
          enabled={followedSet.has(profile.pubkey)}
          onToggle={() => onToggle(profile.pubkey)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function SearchResultRow({
  profile,
  enabled,
  onToggle,
  disabled,
}: {
  profile: SearchProfile;
  enabled: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const { metadata, pubkey } = profile;
  const name = metadata.display_name || metadata.name || genUserName(pubkey);
  const npub = nip19.npubEncode(pubkey);
  const subtitle = metadata.nip05
    ? (metadata.nip05.startsWith('_@') ? metadata.nip05.slice(2) : metadata.nip05)
    : `${npub.slice(0, 12)}…${npub.slice(-4)}`;
  return (
    <ProfileRow
      picture={metadata.picture}
      name={name}
      subtitle={subtitle}
      enabled={enabled}
      onToggle={onToggle}
      disabled={disabled}
    />
  );
}

function FollowedList({
  pubkeys,
  onToggle,
  disabled,
}: {
  pubkeys: string[];
  onToggle: (pubkey: string) => void;
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
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function FollowedRow({
  pubkey,
  onToggle,
  disabled,
}: {
  pubkey: string;
  onToggle: () => void;
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
  disabled,
}: {
  picture?: string;
  name: string;
  subtitle: string;
  enabled: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-3 p-3 rounded-xl bg-card hover:bg-card/80 transition-colors cursor-pointer">
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
      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        disabled={disabled}
        aria-label={`Toggle ${name}`}
      />
    </label>
  );
}
