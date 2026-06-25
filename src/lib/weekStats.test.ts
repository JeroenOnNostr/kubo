import { describe, it, expect } from 'vitest';

import {
  buildWeekStats,
  localDateKey,
  parseLocalDateKey,
  weekStartFor,
  formatMinutes,
} from './weekStats';
import type { ScreenTimeEntry } from './screenTimeStore';

// A fixed "now" so every test is deterministic regardless of the wall clock.
// Wed 2026-06-24 14:30 local. That week is Mon 2026-06-22 → Sun 2026-06-28.
const WED = new Date(2026, 5, 24, 14, 30, 0);

const min = (m: number) => m * 60; // minutes → seconds helper

describe('localDateKey / parseLocalDateKey', () => {
  it('formats a local date as zero-padded YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('round-trips local Y/M/D without timezone drift', () => {
    const d = new Date(2026, 5, 24);
    const back = parseLocalDateKey(localDateKey(d));
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(5);
    expect(back.getDate()).toBe(24);
  });
});

describe('formatMinutes', () => {
  it('renders minutes and hours', () => {
    expect(formatMinutes(min(0))).toBe('0m');
    expect(formatMinutes(min(11))).toBe('11m');
    expect(formatMinutes(min(60))).toBe('1h');
    expect(formatMinutes(min(72))).toBe('1h 12m');
  });
});

describe('weekStartFor', () => {
  it('returns the Monday of the current week and offsets by whole weeks', () => {
    expect(localDateKey(weekStartFor(0, WED))).toBe('2026-06-22'); // Monday
    expect(localDateKey(weekStartFor(-1, WED))).toBe('2026-06-15');
    expect(localDateKey(weekStartFor(-2, WED))).toBe('2026-06-08');
  });
});

describe('buildWeekStats', () => {
  it('lays out 7 contiguous days Mon→Sun with correct labels', () => {
    const stats = buildWeekStats([], 0, WED);
    expect(stats.days).toHaveLength(7);
    expect(stats.days.map((d) => d.label)).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ]);
    expect(stats.days.map((d) => d.date)).toEqual([
      '2026-06-22', '2026-06-23', '2026-06-24',
      '2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28',
    ]);
  });

  it('weekly total equals the sum of the bars and ignores entries outside the week', () => {
    const log: ScreenTimeEntry[] = [
      { date: '2026-06-22', usedSeconds: min(3) },  // Mon, in-week
      { date: '2026-06-24', usedSeconds: min(8) },  // Wed (today), in-week
      { date: '2026-06-12', usedSeconds: min(99) }, // earlier week — must be ignored
    ];
    const stats = buildWeekStats(log, 0, WED);

    const barSeconds = stats.days.reduce((s, d) => s + d.minutes * 60, 0);
    expect(stats.totalSeconds).toBe(min(3) + min(8));
    expect(barSeconds).toBe(stats.totalSeconds);
  });

  it('zeroes future days and excludes them from the total', () => {
    const log: ScreenTimeEntry[] = [
      { date: '2026-06-24', usedSeconds: min(8) },  // today (Wed)
      { date: '2026-06-26', usedSeconds: min(50) }, // Fri — future, must not count
    ];
    const stats = buildWeekStats(log, 0, WED);

    const fri = stats.days.find((d) => d.date === '2026-06-26')!;
    expect(fri.isFuture).toBe(true);
    expect(fri.minutes).toBe(0);

    const wed = stats.days.find((d) => d.date === '2026-06-24')!;
    expect(wed.isToday).toBe(true);
    expect(wed.isFuture).toBe(false);
    expect(stats.totalSeconds).toBe(min(8));
  });

  it('marks exactly one isToday in the current week and none in a past week', () => {
    const cur = buildWeekStats([], 0, WED);
    expect(cur.days.filter((d) => d.isToday)).toHaveLength(1);
    expect(cur.days.find((d) => d.isToday)!.date).toBe(localDateKey(WED));
    expect(cur.isCurrentWeek).toBe(true);

    const past = buildWeekStats([], -1, WED);
    expect(past.days.some((d) => d.isToday)).toBe(false);
    expect(past.isCurrentWeek).toBe(false);
  });

  it('navigates whole weeks with disjoint, contiguous day sets', () => {
    const cur = buildWeekStats([], 0, WED);
    const prev = buildWeekStats([], -1, WED);

    const dayMs = 24 * 60 * 60 * 1000;
    expect(cur.weekStart.getTime() - prev.weekStart.getTime()).toBe(7 * dayMs);

    const overlap = prev.days.map((d) => d.date).filter((dt) =>
      cur.days.some((c) => c.date === dt),
    );
    expect(overlap).toHaveLength(0);
    // prev Sunday is the day immediately before cur Monday.
    expect(prev.days[6].date).toBe('2026-06-21');
    expect(cur.days[0].date).toBe('2026-06-22');
  });

  it('handles a week that straddles a month boundary', () => {
    // Viewed from Wed Jul 8 2026, the *previous* week is Mon Jun 29 .. Sun Jul 5,
    // which straddles the June/July boundary. Using a past week keeps the range
    // label populated (the current week would just read 'This week').
    const wedJul8 = new Date(2026, 6, 8, 12, 0, 0);
    const stats = buildWeekStats([], -1, wedJul8);
    expect(stats.days[0].date).toBe('2026-06-29');
    expect(stats.days[6].date).toBe('2026-07-05');
    expect(stats.days.map((d) => d.label)).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ]);
    expect(stats.rangeLabel).toBe('Jun 29 – Jul 5');
  });

  it('labels the current week and past weeks distinctly', () => {
    expect(buildWeekStats([], 0, WED).rangeLabel).toBe('This week');
    expect(buildWeekStats([], -1, WED).rangeLabel).toBe('Jun 15 – Jun 21');
  });

  it('produces 7 zero bars and zero total for an empty log', () => {
    const stats = buildWeekStats([], 0, WED);
    expect(stats.days.every((d) => d.minutes === 0)).toBe(true);
    expect(stats.totalSeconds).toBe(0);
    expect(stats.days).toHaveLength(7);
  });
});
