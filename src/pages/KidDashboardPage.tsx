import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock, Settings } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
} from 'recharts';

import { NavTile } from '@/components/NavTile';
import { NoKidSelected } from '@/components/NoKidSelected';
import { AlertsSection } from '@/components/AlertsSection';
import { WatchHistoryStrip } from '@/pages/KidDashboardPage.WatchHistoryStrip';
import { Card } from '@/components/ui/card';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { useScreenTimeLog } from '@/hooks/useScreenTime';
import { getKidSettings } from '@/hooks/useKuboFamily';
import { buildWeekStats, formatMinutes, type WeekDay } from '@/lib/weekStats';
import { possessive } from '@/lib/getDisplayName';

const BAR_FILL = '#F97316';

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
  const settings = getKidSettings(kidPubkey);
  const log = useScreenTimeLog(kidPubkey);

  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week
  const stats = useMemo(() => buildWeekStats(log, weekOffset), [log, weekOffset]);

  // Don't let the parent page back into weeks that predate any recorded data.
  const oldestDate = log.length > 0 ? log[0].date : null;
  const weekEndKey = `${stats.weekEnd.getFullYear()}-${String(stats.weekEnd.getMonth() + 1).padStart(2, '0')}-${String(stats.weekEnd.getDate()).padStart(2, '0')}`;
  const canGoPrev = oldestDate !== null && weekEndKey > oldestDate;

  const goPrev = () => { if (canGoPrev) setWeekOffset((o) => o - 1); };
  const goNext = () => setWeekOffset((o) => Math.min(0, o + 1));

  // The week range already shows in the nav header above, so the footer only
  // needs the usage total ("this week" suffix kept just for the current week).
  const totalLabel = stats.isCurrentWeek
    ? `${formatMinutes(stats.totalSeconds)} this week`
    : formatMinutes(stats.totalSeconds);

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
      {/* Kid settings */}
      <NavTile
        icon={<Settings className="size-5" />}
        title={`Edit ${possessive(kidDisplayName)} settings`}
        subtitle="Time limits, post actions"
        onClick={() => nav('/parent/kid-settings')}
      />

      <WatchHistoryStrip kidPubkey={kidPubkey} />

      {/* Kids activity */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Kids activity</h2>

        {/* Week navigation: ‹ range › — next disabled on the current week, prev
            disabled once the viewed week predates the earliest recorded day. */}
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={goPrev}
            disabled={!canGoPrev}
            aria-label="Previous week"
            className="p-1 rounded-md hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-[13px] font-medium">{stats.rangeLabel}</span>
          <button
            type="button"
            onClick={goNext}
            disabled={stats.isCurrentWeek}
            aria-label="Next week"
            className="p-1 rounded-md hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <ActivityChartCard
          days={stats.days}
          kidName={kidDisplayName}
          totalLabel={totalLabel}
          windowLabel={`${settings.windowStart}–${settings.windowEnd}`}
        />
      </section>

      {/* Alerts — KUBO-185: folded in from the former /parent/alerts tab so
          kid → parent requests live one tap away on Home. Reuses the shared
          <AlertsSection /> (same Approve/Deny path), with the compact `home`
          empty state so this block stays quiet when nothing's pending. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Alerts</h2>
        <AlertsSection variant="home" />
      </section>
    </div>
  );
}

/** Hide the "Xm" label on empty/future bars; otherwise show the minutes. */
function renderMinuteLabel(value: unknown): string {
  return typeof value === 'number' && value > 0 ? `${value}m` : '';
}

function ActivityChartCard({
  days,
  kidName,
  totalLabel,
  windowLabel,
}: {
  days: WeekDay[];
  kidName: string;
  totalLabel: string;
  windowLabel: string;
}) {
  return (
    <Card className="p-4 flex flex-col gap-3">
      {/* h-40: the daily tile that once sat below this card is gone, and the
          footer is a single row, so the chart reclaims the vertical space.
          Top margin leaves room for the always-on per-day minute labels. */}
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={days} barCategoryGap="20%" margin={{ top: 16 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--muted))" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            />
            <Bar dataKey="minutes" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {days.map((day) => (
                <Cell
                  key={day.date}
                  fill={BAR_FILL}
                  fillOpacity={day.isFuture ? 0.25 : 1}
                />
              ))}
              <LabelList
                dataKey="minutes"
                position="top"
                formatter={renderMinuteLabel}
                style={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Single-row footer (name · total · window) so the chart above keeps
          most of the card height. */}
      <div className="flex flex-wrap items-baseline justify-center gap-x-1.5 text-[12px]">
        <span className="font-semibold" style={{ color: BAR_FILL }}>{kidName}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{totalLabel}</span>
        <span className="text-muted-foreground">·</span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3 shrink-0" aria-label="Allowed hours" />
          {windowLabel}
        </span>
      </div>
    </Card>
  );
}
