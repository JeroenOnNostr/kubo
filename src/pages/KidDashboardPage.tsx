import { useNavigate } from 'react-router-dom';
import { Settings, SlidersHorizontal } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
} from 'recharts';

import { NavTile } from '@/components/NavTile';
import { NoKidSelected } from '@/components/NoKidSelected';
import { KidAvatar } from '@/components/KidAvatar';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSelectedKid } from '@/hooks/useSelectedKid';

const ACTIVITY_DATA = [
  { day: 'M', james: 40, maya: 55, kevin: 20 },
  { day: 'T', james: 25, maya: 60, kevin: 30 },
  { day: 'W', james: 20, maya: 15, kevin: 35 },
  { day: 'T', james: 45, maya: 70, kevin: 15 },
  { day: 'F', james: 30, maya: 40, kevin: 25 },
  { day: 'S', james: 50, maya: 45, kevin: 30 },
  { day: 'S', james: 35, maya: 55, kevin: 30 },
];

const KID_COLORS = {
  james: '#F97316',
  maya: '#6366F1',
  kevin: '#22C55E',
};

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
        <KidAvatar
          pubkey={kid.pubkey}
          className="size-14"
          fallbackInitial={kid.displayName[0]?.toUpperCase()}
        />
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
      </nav>

      {/* Kids watch history — placeholder */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Kids watch history</h2>
          <span className="text-[12px] text-muted-foreground">Watch full history</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2 shrink-0 w-40">
              <div className="aspect-video w-full rounded-xl bg-muted" aria-hidden />
              <div className="text-[12px] font-medium leading-tight">Lorem ipsum dolor sit amet</div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-3 rounded-full bg-muted-foreground/30" aria-hidden />
                tanel
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Kids activity — placeholder */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Kids activity</h2>
        <Tabs defaultValue="week" className="flex flex-col gap-3">
          <TabsList className="self-center">
            <TabsTrigger value="week" className="px-6">Week</TabsTrigger>
            <TabsTrigger value="day" className="px-6">Day</TabsTrigger>
          </TabsList>
          <TabsContent value="week" className="mt-0">
            <ActivityChartCard />
          </TabsContent>
          <TabsContent value="day" className="mt-0">
            <ActivityChartCard />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

function ActivityChartCard() {
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ACTIVITY_DATA} barGap={2} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="hsl(var(--muted))" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            />
            <Bar dataKey="james" fill={KID_COLORS.james} radius={[4, 4, 0, 0]} />
            <Bar dataKey="maya" fill={KID_COLORS.maya} radius={[4, 4, 0, 0]} />
            <Bar dataKey="kevin" fill={KID_COLORS.kevin} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-around text-[12px]">
        <LegendItem color={KID_COLORS.james} name="James" time="1h 40m" />
        <LegendItem color={KID_COLORS.maya} name="Maya" time="2h 30m" />
        <LegendItem color={KID_COLORS.kevin} name="Kevin" time="45m" />
      </div>
    </Card>
  );
}

function LegendItem({ color, name, time }: { color: string; name: string; time: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-semibold" style={{ color }}>{name}</span>
      <span className="text-muted-foreground">{time}</span>
    </div>
  );
}
