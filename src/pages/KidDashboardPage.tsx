import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Settings, Shield, Clock, AlertTriangle, KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * /parent/kid/:id — per-kid dashboard.
 *
 * Visual only. Shows a kid header (avatar, name, age, daily-usage bar)
 * and a list of navigation tiles that deep-link into the kid-scoped
 * routes (settings, trust people, trust places). Counters and progress
 * values are hard-coded placeholders; the data-layer PR will swap them
 * for live readings from kid-settings / trust-people / trust-relays.
 */
export function KidDashboardPage() {
  const nav = useNavigate();
  const { id = 'ellie' } = useParams<{ id: string }>();

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
      {/* Back + title */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav('/parent/home')}
          aria-label="Back to home"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <h1 className="text-base font-semibold flex-1">Kid</h1>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav(`/parent/kid/${id}/settings`)}
          aria-label="Kid settings"
        >
          <Settings className="size-5" />
        </Button>
      </div>

      {/* Kid summary */}
      <div className="flex items-center gap-3 px-1">
        <div className="size-14 rounded-full bg-[#6366F1]" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold truncate">Ellie</div>
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
          onClick={() => nav(`/parent/kid/${id}/settings`)}
        />
        <NavTile
          icon={<Shield className="size-5" />}
          title="Trust · People"
          subtitle="12 in inner circle · 38 others"
          onClick={() => nav(`/parent/kid/${id}/trust/people`)}
        />
        <NavTile
          icon={<Clock className="size-5" />}
          title="Trust · Places"
          subtitle="4 relays"
          onClick={() => nav(`/parent/kid/${id}/trust/places`)}
        />
        <NavTile
          icon={<KeyRound className="size-5" />}
          title="Backup keys"
          subtitle="View and save this kid's Nostr key"
          onClick={() => nav(`/parent/kid/${id}/keys`)}
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
