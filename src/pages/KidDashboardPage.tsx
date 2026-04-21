import { useNavigate } from 'react-router-dom';
import { ChevronRight, Settings, Shield, Clock, AlertTriangle, KeyRound, SlidersHorizontal } from 'lucide-react';

import { NoKidSelected } from '@/components/NoKidSelected';
import { useSelectedKid } from '@/hooks/useSelectedKid';

/**
 * /parent/home — per-kid dashboard for whichever kid is currently the
 * active Nostr signer. Parents swap kids via the top-right gear dropdown
 * on the Feed tab; this page then re-renders for the newly-selected kid.
 *
 * Visual only. Counters and progress values are hard-coded placeholders;
 * a data-layer PR will swap them for live readings from kid-settings /
 * trust-people / trust-relays.
 */
export function KidDashboardPage() {
  const nav = useNavigate();
  const kid = useSelectedKid();

  if (!kid) {
    return <NoKidSelected title="Home" />;
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
      {/* Title */}
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold flex-1">Home</h1>
      </div>

      {/* Kid summary */}
      <div className="flex items-center gap-3 px-1">
        <div className="size-14 rounded-full bg-[#6366F1]" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold truncate">{kid.displayName}</div>
          <div className="text-[12px] text-muted-foreground">age 6 · paired device</div>
        </div>
      </div>

      {/* Today's usage */}
      <div className="rounded-2xl bg-card p-4 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground font-semibold">
            Today
          </span>
          <span className="text-xs text-muted-foreground">18 / 45 min</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full"
            style={{ width: '40%' }}
            aria-label="40% of daily limit used"
          />
        </div>
        <div className="text-[11px] text-muted-foreground">
          27 min remaining · window closes 19:00
        </div>
      </div>

      {/* Nav tiles */}
      <nav className="flex flex-col gap-2">
        <NavTile
          icon={<Settings className="size-5" />}
          title="Edit kid settings"
          subtitle="Age, time limits, moderation"
          onClick={() => nav('/parent/kid-settings')}
        />
        <NavTile
          icon={<SlidersHorizontal className="size-5" />}
          title="Edit feed settings"
          subtitle="Content types in this kid's feed"
          onClick={() => nav('/parent/feed-settings')}
        />
        <NavTile
          icon={<Shield className="size-5" />}
          title="Trust · People"
          subtitle="12 in inner circle · 38 others"
          onClick={() => nav('/parent/trust/people')}
        />
        <NavTile
          icon={<Clock className="size-5" />}
          title="Trust · Places"
          subtitle="4 relays"
          onClick={() => nav('/parent/trust/places')}
        />
        <NavTile
          icon={<KeyRound className="size-5" />}
          title="Backup keys"
          subtitle="View and save this kid's Nostr key"
          onClick={() => nav('/parent/keys')}
        />
        <NavTile
          icon={<AlertTriangle className="size-5" />}
          title="Activity & alerts"
          subtitle="2 pending watch requests"
          onClick={() => nav('/parent/alerts')}
        />
      </nav>
    </div>
  );
}

function NavTile({
  icon, title, subtitle, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-card hover:bg-card/80 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" aria-hidden />
    </button>
  );
}
