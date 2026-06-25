import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * KidDashboardPage — the "Kids activity" panel was rebuilt (see weekStats.ts) to
 * fix a daily/weekly discrepancy and to show a real Monday→Sunday week with
 * prev/next navigation and per-day minutes merged into the chart.
 *
 * These render tests pin the user-facing behaviour: the weekly total always
 * matches the sum of the bars, the compact footer shows name · total · window,
 * and the nav buttons disable at the right edges. recharts is stubbed so the
 * chart renders deterministically in jsdom (ResponsiveContainer is 0×0
 * otherwise) while still exercising the days/labels/total wiring.
 */

import type { ScreenTimeEntry } from '@/lib/screenTimeStore';
import { localDateKey } from '@/lib/weekStats';

const KID_PUBKEY = 'k'.repeat(64);

// Build a deterministic "this week" log: today + two earlier weekdays.
const today = new Date();
const dayKey = (offsetDays: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - offsetDays);
  return localDateKey(d);
};
const LOG: ScreenTimeEntry[] = [
  { date: dayKey(40), usedSeconds: 99 * 60 }, // far past — must not count this week
  { date: dayKey(2), usedSeconds: 3 * 60 },
  { date: dayKey(0), usedSeconds: 8 * 60 },   // today
];

vi.mock('@/hooks/useSelectedKid', () => ({
  useSelectedKid: () => ({ pubkey: KID_PUBKEY, displayName: 'Robin' }),
}));

vi.mock('@/hooks/useScreenTime', () => ({
  useScreenTime: () => ({
    usedSeconds: 8 * 60,
    remainingMinutes: 52,
    dailyLimitMin: 60,
    percentUsed: 13,
  }),
  useScreenTimeLog: () => LOG,
}));

vi.mock('@/hooks/useKuboFamily', () => ({
  getKidSettings: () => ({ dailyLimitMin: 60, windowStart: '08:00', windowEnd: '21:00' }),
}));

// Stub heavy/irrelevant children so the test stays focused on the activity panel.
vi.mock('@/pages/KidDashboardPage.WatchHistoryStrip', () => ({
  WatchHistoryStrip: () => null,
}));
vi.mock('@/components/AlertsSection', () => ({ AlertsSection: () => null }));

// Deterministic recharts stub: render each datum's minute value as text.
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const BarChart = ({ data, children }: { data: { minutes: number }[]; children?: React.ReactNode }) => (
    <div data-testid="bars">
      {data.map((d, i) => (
        <span key={i} data-testid="bar">{d.minutes}</span>
      ))}
      {children}
    </div>
  );
  return {
    ResponsiveContainer: Pass,
    BarChart,
    Bar: Pass,
    Cell: () => null,
    LabelList: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
  };
});

import { KidDashboardPage } from './KidDashboardPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <KidDashboardPage />
    </MemoryRouter>,
  );

describe('KidDashboardPage — Kids activity panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the current week and a single-row footer (name · total · window)', () => {
    renderPage();
    // Nav header labels the current week.
    expect(screen.getByText('This week')).toBeInTheDocument();
    // Compact footer: kid name, weekly total, and the allowed time window.
    // The daily "Today" tile was removed — that info lives in the weekly view
    // and kid settings now.
    expect(screen.getByText('Robin')).toBeInTheDocument();
    expect(screen.getByText('11m this week')).toBeInTheDocument();
    expect(screen.getByText('08:00–21:00')).toBeInTheDocument();
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
    expect(screen.queryByText(/window closes/)).not.toBeInTheDocument();
  });

  it('weekly total equals the sum of the rendered bars (the fixed bug)', () => {
    renderPage();
    const barMinutes = screen
      .getAllByTestId('bar')
      .map((el) => Number(el.textContent));
    const sum = barMinutes.reduce((a, b) => a + b, 0);
    expect(sum).toBe(3 + 8); // this-week entries only; the 40-day-old 99m excluded
    // Footer total mirrors that sum, NOT the whole log.
    expect(screen.getByText(/^11m this week$/)).toBeInTheDocument();
  });

  it('disables Next on the current week and enables Previous when data exists', () => {
    renderPage();
    expect(screen.getByLabelText('Next week')).toBeDisabled();
    expect(screen.getByLabelText('Previous week')).toBeEnabled();
  });

  it('paging back labels the past week range in the header only', () => {
    renderPage();
    fireEvent.click(screen.getByLabelText('Previous week'));
    // Next becomes enabled once we're off the current week.
    expect(screen.getByLabelText('Next week')).toBeEnabled();
    // Range header now shows a date span rather than "This week".
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
    // The footer no longer repeats the range on past weeks (it's redundant with
    // the nav header), so the "Mon d – Mon d" span appears exactly once.
    expect(screen.getAllByText(/\w{3} \d+ – \w{3} \d+/)).toHaveLength(1);
    // Footer total for a past week is the bare usage, with no "this week" suffix.
    expect(screen.queryByText(/this week/)).not.toBeInTheDocument();
  });

  it('renders all seven Mon→Sun bars', () => {
    renderPage();
    expect(within(screen.getByTestId('bars')).getAllByTestId('bar')).toHaveLength(7);
  });
});
