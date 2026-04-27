import { useNavigate } from 'react-router-dom';
import {
  Eye,
  Radio,
  Search,
  SlidersHorizontal,
  Users,
  UsersRound,
  UserPlus,
} from 'lucide-react';

import { FeedSourceTile } from '@/components/feed/FeedSourceTile';
import { NavTile } from '@/components/NavTile';
import { NoKidSelected } from '@/components/NoKidSelected';
import { useAuthor } from '@/hooks/useAuthor';
import { useCommunitiesByAtags } from '@/hooks/useCommunities';
import { useFollowList } from '@/hooks/useFollowActions';
import { usePacksByAtags } from '@/hooks/useFollowPacks';
import { useKidFeedSourcesSelector } from '@/hooks/useKidFeedSources';
import { useRelayInfo } from '@/hooks/useRelayInfo';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { genUserName } from '@/lib/genUserName';

/**
 * /parent/feed — source-picker screen. Renders two top tiles (edit feed
 * settings + preview) and four source-category tiles (relays, communities,
 * follow packs, profiles) that each open their own browse screen.
 *
 * Each tile reads only its own count via useKidFeedSourcesSelector (M4) so
 * toggling a relay doesn't re-render the communities/packs tiles. Chip
 * metadata rendering is added incrementally when the per-source pages
 * (KUBO-043..046) land with their batch helpers (M1).
 */
export function ParentFeedPage() {
  const nav = useNavigate();
  const kid = useSelectedKid();

  if (!kid) {
    return <NoKidSelected title="Feed" />;
  }

  return (
    <div className="flex flex-col gap-4 pt-2 pb-6">
      <div className="px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Feed · {kid.displayName}
      </div>

      {/* Top row: edit settings + preview */}
      <div className="px-4 grid grid-cols-2 gap-3">
        <NavTile
          icon={<SlidersHorizontal className="size-5" />}
          title="Edit feed settings"
          onClick={() => nav('/parent/feed-settings')}
        />
        <NavTile
          icon={<Eye className="size-5" />}
          title="Feed preview"
          onClick={() => nav('/parent/feed/preview')}
        />
      </div>

      {/* Search pill — placeholder, wired in a later pass */}
      <div className="mx-4 flex items-center gap-2 h-11 px-4 rounded-full bg-card">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-[13px] text-muted-foreground">
          Search sources…
        </span>
      </div>

      {/* Source tiles */}
      <div className="px-4 flex flex-col gap-3">
        <RelaysTile kidPubkey={kid.pubkey} onClick={() => nav('/parent/feed/relays')} />
        <CommunitiesTile kidPubkey={kid.pubkey} onClick={() => nav('/parent/feed/communities')} />
        <PacksTile kidPubkey={kid.pubkey} onClick={() => nav('/parent/feed/packs')} />
        <ProfilesTile onClick={() => nav('/parent/feed/profiles')} />
      </div>
    </div>
  );
}

function RelaysTile({ kidPubkey, onClick }: { kidPubkey: string; onClick: () => void }) {
  // Using a stable referential-equal selector keeps this tile from re-rendering
  // on unrelated KuboFamily writes (M4). The selector returns a new array every
  // call, so we compare by join() to keep isEqual meaningful.
  const relays = useKidFeedSourcesSelector(
    kidPubkey,
    (s) => s.relays,
    (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  );
  return (
    <FeedSourceTile
      icon={<Radio className="size-5" />}
      title="Relays"
      description="Pull posts from specific relay firehoses."
      enabledCount={relays.length}
      chips={[]}
      onClick={onClick}
      chipRenderer={<RelayChips urls={relays} />}
    />
  );
}

function RelayChips({ urls }: { urls: string[] }) {
  // We cap at 5 hooks regardless of enabled count — overflow is counted by
  // the tile itself. useRelayInfo has staleTime: 12h, so repeat renders are
  // cache hits.
  const visible = urls.slice(0, 5);
  return (
    <>
      {visible.map((url) => (
        <RelayChipItem key={url} url={url} />
      ))}
    </>
  );
}

function RelayChipItem({ url }: { url: string }) {
  const { data } = useRelayInfo(url);
  const label = data?.name?.trim() || hostOf(url);
  return (
    <span
      className="flex items-center gap-1 h-6 pl-1 pr-2 rounded-full bg-muted text-[11px] max-w-[8rem]"
      title={label}
    >
      {data?.icon ? (
        <img src={data.icon} alt="" className="size-4 rounded-full object-cover flex-shrink-0" />
      ) : (
        <span className="size-4 rounded-full bg-primary/20 flex-shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function CommunitiesTile({ kidPubkey, onClick }: { kidPubkey: string; onClick: () => void }) {
  const communities = useKidFeedSourcesSelector(
    kidPubkey,
    (s) => s.communities,
    (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  );
  const { data: byAtag } = useCommunitiesByAtags(communities.slice(0, 5));
  const chips = communities.slice(0, 5).map((atag) => {
    const community = byAtag?.get(atag);
    return {
      key: atag,
      label: community?.name ?? (atag.split(':').slice(2).join(':') || 'Community'),
      avatarUrl: community?.image,
    };
  });
  return (
    <FeedSourceTile
      icon={<UsersRound className="size-5" />}
      title="Communities"
      description="Posts from moderated NIP-72 communities."
      enabledCount={communities.length}
      chips={chips}
      onClick={onClick}
    />
  );
}

function PacksTile({ kidPubkey, onClick }: { kidPubkey: string; onClick: () => void }) {
  const packs = useKidFeedSourcesSelector(
    kidPubkey,
    (s) => s.packs,
    (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  );
  const { data: byAtag } = usePacksByAtags(packs.slice(0, 5));
  const chips = packs.slice(0, 5).map((atag) => {
    const pack = byAtag?.get(atag);
    return {
      key: atag,
      label: pack?.title ?? (atag.split(':').slice(2).join(':') || 'List'),
      avatarUrl: pack?.image,
    };
  });
  return (
    <FeedSourceTile
      icon={<Users className="size-5" />}
      title="Follow packs"
      description="Curated people lists others have shared."
      enabledCount={packs.length}
      chips={chips}
      onClick={onClick}
    />
  );
}

function ProfilesTile({ onClick }: { onClick: () => void }) {
  // Profiles = the kid's kind-3 follow list. The kid is the active signer on
  // this screen, so useFollowList reads their own follows.
  const { data } = useFollowList();
  const pubkeys = data?.pubkeys ?? [];
  return (
    <FeedSourceTile
      icon={<UserPlus className="size-5" />}
      title="Profiles"
      description="Individual people you follow directly."
      enabledCount={pubkeys.length}
      chips={[]}
      chipRenderer={<ProfileChips pubkeys={pubkeys} />}
      onClick={onClick}
    />
  );
}

function ProfileChips({ pubkeys }: { pubkeys: string[] }) {
  // useAuthor hydrates synchronously from profileCache (IndexedDB, 7d TTL),
  // so repeat renders of the same pubkey are cache hits. Cap at 5 hooks.
  const visible = pubkeys.slice(0, 5);
  return (
    <>
      {visible.map((pubkey) => (
        <ProfileChipItem key={pubkey} pubkey={pubkey} />
      ))}
    </>
  );
}

function ProfileChipItem({ pubkey }: { pubkey: string }) {
  const { data } = useAuthor(pubkey);
  const meta = data?.metadata;
  const label = meta?.display_name || meta?.name || genUserName(pubkey);
  return (
    <span
      className="flex items-center gap-1 h-6 pl-1 pr-2 rounded-full bg-muted text-[11px] max-w-[8rem]"
      title={label}
    >
      {meta?.picture ? (
        <img src={meta.picture} alt="" className="size-4 rounded-full object-cover flex-shrink-0" />
      ) : (
        <span className="size-4 rounded-full bg-primary/20 flex-shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}
