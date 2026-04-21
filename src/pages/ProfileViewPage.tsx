import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';

/**
 * /parent/profile/:npub — creator profile.
 *
 * Reads kind-0 metadata via useAuthor. `Follow` and `Assign trust` are
 * still local-state only — a later PR wires the follow mutation and the
 * AssignTrustLevelButton (sheet → updates kid's trust-people list).
 */
export function ProfileViewPage() {
  const nav = useNavigate();
  const { npub } = useParams<{ npub: string }>();

  // Decode :npub → hex pubkey. Accepts an npub or raw hex (lenient so
  // older routes that passed a slug don't hard-fail — they just fall
  // through to the hardcoded shell below).
  const pubkey = useMemo(() => {
    if (!npub) return undefined;
    try {
      const decoded = nip19.decode(npub);
      return decoded.type === 'npub' ? decoded.data : undefined;
    } catch {
      return /^[0-9a-f]{64}$/i.test(npub) ? npub.toLowerCase() : undefined;
    }
  }, [npub]);

  const { data: author } = useAuthor(pubkey);
  const metadata = author?.metadata;
  const displayName = metadata?.display_name || metadata?.name
    || (pubkey ? genUserName(pubkey) : 'MarineKids');
  const handle = metadata?.nip05
    ? (metadata.nip05.startsWith('_@') ? metadata.nip05.slice(2) : metadata.nip05)
    : (metadata?.name ? `@${metadata.name}` : '@marinekids');
  const bio = metadata?.about
    ?? 'Ocean science for little explorers. 4+ years old. New video every Thursday. 🐙';
  const picture = metadata?.picture;
  const banner = metadata?.banner;

  const [tab, setTab] = useState<'videos' | 'about'>('videos');
  const [following, setFollowing] = useState(false);

  return (
    <div className="flex flex-col gap-3 pt-0 pb-6">
      {/* Banner */}
      <div
        className="relative h-32 mx-4 rounded-2xl mt-2 overflow-hidden"
        style={banner
          ? { backgroundImage: `url(${banner})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: 'linear-gradient(135deg, #F97316, #EA580C)' }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-2 top-2 size-9 rounded-full bg-black/30 hover:bg-black/40 text-white"
          onClick={() => nav(-1)}
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Button>
      </div>

      {/* Avatar + name */}
      <div className="px-5 -mt-10 flex items-end gap-3">
        <div
          className="size-20 rounded-full border-4 flex-shrink-0 overflow-hidden flex items-center justify-center text-2xl font-semibold text-white"
          style={{
            backgroundColor: picture ? 'transparent' : '#6366F1',
            borderColor: 'hsl(var(--background))',
          }}
          aria-hidden
        >
          {picture ? (
            <img src={picture} alt="" className="size-full object-cover" />
          ) : (
            displayName[0]?.toUpperCase() || '?'
          )}
        </div>
        <div className="flex-1 min-w-0 pb-1">
          <div className="text-lg font-semibold leading-tight truncate">{displayName}</div>
          <div className="text-[12px] text-muted-foreground truncate">{handle}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 grid grid-cols-2 gap-2 mt-1">
        <Button
          variant={following ? 'secondary' : 'default'}
          className="h-10 rounded-full"
          onClick={() => setFollowing((v) => !v)}
        >
          {following ? 'Following' : 'Follow'}
        </Button>
        <Button variant="secondary" className="h-10 rounded-full">
          Assign trust
        </Button>
      </div>

      {/* Bio */}
      <p className="px-5 text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
        {bio}
      </p>

      {/* Tabs */}
      <div className="px-4 flex items-center gap-2 mt-1" role="tablist">
        <TabButton active={tab === 'videos'} onClick={() => setTab('videos')}>
          Videos
        </TabButton>
        <TabButton active={tab === 'about'} onClick={() => setTab('about')}>
          About
        </TabButton>
      </div>

      {/* Tab content */}
      {tab === 'videos' ? (
        <div className="px-4 grid grid-cols-3 gap-2">
          {[
            'linear-gradient(135deg, #334155, #1E293B)',
            'linear-gradient(135deg, #475569, #1E293B)',
            'linear-gradient(135deg, #0891B2, #164E63)',
            'linear-gradient(135deg, #7C3AED, #4C1D95)',
            'linear-gradient(135deg, #F97316, #9A3412)',
            'linear-gradient(135deg, #22C55E, #166534)',
          ].map((grad, i) => (
            <button
              key={i}
              type="button"
              onClick={() => nav(`/parent/video/profile-${i}`)}
              className="aspect-square rounded-lg overflow-hidden"
              style={{ background: grad }}
              aria-label={`Video ${i + 1}`}
            />
          ))}
        </div>
      ) : (
        <div className="px-5 flex flex-col gap-3 text-[13px] leading-relaxed">
          <Fact label="Joined" value="Jan 2024" />
          <Fact label="Videos" value="42" />
          <Fact label="Languages" value="English, Spanish" />
          <Fact label="Links" value="marinekids.example" />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'h-8 px-4 rounded-full text-[12px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-semibold">
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}
