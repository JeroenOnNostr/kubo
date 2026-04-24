import { useNavigate } from 'react-router-dom';
import { Settings } from 'lucide-react';
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
import { useScreenTime, useScreenTimeLog } from '@/hooks/useScreenTime';
import { getKidSettings } from '@/hooks/useKuboFamily';
import type { ScreenTimeEntry } from '@/lib/screenTimeStore';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function formatMinutes(totalSeconds: number): string {
  const mins = Math.round(totalSeconds / 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

/** Build last-7-days chart data from the screen time log. */
function buildWeekData(log: ScreenTimeEntry[]): { day: string; minutes: number }[] {
  const today = new Date();
  const result: { day: string; minutes: number }[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = log.find((e) => e.date === dateStr);
    result.push({
      day: DAY_LABELS[d.getDay()],
      minutes: entry ? Math.round(entry.usedSeconds / 60) : 0,
    });
  }

  return result;
}

/** Sum all seconds in the log entries. */
function totalSeconds(log: ScreenTimeEntry[]): number {
  return log.reduce((sum, e) => sum + e.usedSeconds, 0);
}

/**
 * /parent/home — per-kid dashboard for whichever kid is currently the
 * active Nostr signer. Parents swap kids via the KuboKidSelector dropdown;
 * this page then re-renders for the newly-selected kid.
 *
 * Usage stats, progress bar, and activity chart are driven by real screen
 * time data from the family record.
 */
export function KidDashboardPage() {
  const kid = useSelectedKid();

  if (!kid) {
    return <NoKidSelected title="Home" />;
  }

  return <DashboardContent kidPubkey={kid.pubkey} kidDisplayName={kid.displayName} />;
}

function DashboardContent({ kidPubkey, kidDisplayName }: { kidPubkey: string; kidDisplayName: string }) {
  const nav = useNavigate();
  const { usedSeconds, remainingMinutes, dailyLimitMin, percentUsed } = useScreenTime(kidPubkey);
  const settings = getKidSettings(kidPubkey);
  const log = useScreenTimeLog(kidPubkey);
  const weekData = buildWeekData(log);
  const usedMinutes = Math.round(usedSeconds / 60);

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
      {/* Title */}
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold flex-1">Home</h1>
      </div>

      {/* Kid summary */}
      <div className="flex items-center gap-3 px-1">
        <KidAvatar
          pubkey={kidPubkey}
          className="size-14"
          fallbackInitial={kidDisplayName[0]?.toUpperCase()}
        />
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold truncate">{kidDisplayName}</div>
        </div>
      </div>

      {/* Kid settings */}
      <NavTile
        icon={<Settings className="size-5" />}
        title="Edit kid settings"
        subtitle="Age, time limits, post actions"
        onClick={() => nav('/parent/kid-settings')}
      />

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

      {/* Kids activity */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Kids activity</h2>
        <Tabs defaultValue="week" className="flex flex-col gap-3">
          <TabsList className="self-center">
            <TabsTrigger value="week" className="px-6">Week</TabsTrigger>
            <TabsTrigger value="day" className="px-6">Day</TabsTrigger>
          </TabsList>
          <TabsContent value="week" className="mt-0">
            <ActivityChartCard
              data={weekData}
              kidName={kidDisplayName}
              totalLabel={formatMinutes(totalSeconds(log))}
            />
          </TabsContent>
          <TabsContent value="day" className="mt-0">
            <Card className="p-4 flex flex-col items-center gap-3">
              <div className="flex flex-col items-center gap-0.5">
                <div className="text-3xl font-bold">{formatMinutes(usedSeconds)}</div>
                <div className="text-[12px] text-muted-foreground">
                  {usedMinutes} / {dailyLimitMin} min today
                </div>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${percentUsed}%` }}
                  aria-label={`${percentUsed}% of daily limit used`}
                />
              </div>
              <div className="text-[11px] text-muted-foreground">
                {remainingMinutes} min remaining · window closes {settings.windowEnd}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

function ActivityChartCard({
  data,
  kidName,
  totalLabel,
}: {
  data: { day: string; minutes: number }[];
  kidName: string;
  totalLabel: string;
}) {
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="hsl(var(--muted))" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            />
            <Bar dataKey="minutes" fill="#F97316" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-center text-[12px]">
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-semibold" style={{ color: '#F97316' }}>{kidName}</span>
          <span className="text-muted-foreground">{totalLabel} this week</span>
        </div>
      </div>
    </Card>
  );
}
