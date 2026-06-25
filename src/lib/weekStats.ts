import {
  addWeeks,
  eachDayOfInterval,
  endOfWeek,
  format,
  startOfWeek,
} from 'date-fns';

import type { ScreenTimeEntry } from '@/lib/screenTimeStore';

/**
 * Pure week-bucketing utilities for the parent screen-time dashboard.
 *
 * This module is the single source of truth that keeps the weekly total in sync
 * with the rendered bars: the total is always summed over the same Mon–Sun array
 * the chart draws, so the daily/weekly figures can never drift apart.
 *
 * Weeks run **Monday → Sunday** (`weekStartsOn: 1`).
 *
 * Timezone rule: `ScreenTimeEntry.date` is a LOCAL-tz `YYYY-MM-DD` string (see
 * `todayDateStr` in formatTime.ts). All bucketing stays in local time — we never
 * parse those strings with `new Date('YYYY-MM-DD')`, which would be UTC midnight
 * and shift the day backward in negative-offset zones. Instead we format local
 * `Date`s to the same key and compare strings.
 */

/** Local-tz `YYYY-MM-DD` for a Date (matches `todayDateStr`'s recipe). */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse a local `YYYY-MM-DD` key back to a local Date (NOT `new Date(key)`). */
export function parseLocalDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Format a seconds total to "Xm" or "Xh Ym". */
export function formatMinutes(totalSeconds: number): string {
  const mins = Math.round(totalSeconds / 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

export interface WeekDay {
  /** Local `YYYY-MM-DD`. */
  date: string;
  /** Weekday label, e.g. 'Mon'..'Sun'. */
  label: string;
  /** Rounded minutes for the day; 0 for empty or future days. */
  minutes: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface WeekStats {
  /** Exactly 7 days, Monday → Sunday, left-to-right. */
  days: WeekDay[];
  /** Sum of seconds over the (non-future) days shown — equals the bar total. */
  totalSeconds: number;
  /** Monday 00:00 (local) of the viewed week. */
  weekStart: Date;
  /** Sunday of the viewed week. */
  weekEnd: Date;
  /** 'This week' for the current week, else e.g. 'Jun 16 – Jun 22'. */
  rangeLabel: string;
  isCurrentWeek: boolean;
}

/**
 * Monday 00:00 (local) of the week `weekOffset` weeks from the current week.
 * 0 = this week, -1 = last week, etc.
 */
export function weekStartFor(weekOffset: number, now: Date = new Date()): Date {
  return addWeeks(startOfWeek(now, { weekStartsOn: 1 }), weekOffset);
}

/** Human label for a week range. Current week → 'This week'. */
export function weekRangeLabel(weekStart: Date, now: Date = new Date()): string {
  const currentStart = startOfWeek(now, { weekStartsOn: 1 });
  if (localDateKey(weekStart) === localDateKey(currentStart)) return 'This week';
  const end = endOfWeek(weekStart, { weekStartsOn: 1 });
  return `${format(weekStart, 'MMM d')} – ${format(end, 'MMM d')}`;
}

/**
 * Bucket the screen-time log into a Monday→Sunday array for the given week.
 * `weekOffset` 0 = current week, negative = earlier weeks.
 */
export function buildWeekStats(
  log: ScreenTimeEntry[],
  weekOffset: number,
  now: Date = new Date(),
): WeekStats {
  const weekStart = weekStartFor(weekOffset, now);
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const todayKey = localDateKey(now);

  // Index the log once for O(1) lookups.
  const byDate = new Map(log.map((e) => [e.date, e.usedSeconds]));

  let totalSeconds = 0;
  const days: WeekDay[] = eachDayOfInterval({ start: weekStart, end: weekEnd }).map(
    (d) => {
      const date = localDateKey(d);
      const isFuture = date > todayKey; // string compare on fixed-width local key
      const usedSeconds = isFuture ? 0 : (byDate.get(date) ?? 0);
      if (!isFuture) totalSeconds += usedSeconds;
      return {
        date,
        label: format(d, 'EEE'), // 'Mon'..'Sun'
        minutes: Math.round(usedSeconds / 60),
        isToday: date === todayKey,
        isFuture,
      };
    },
  );

  const currentStart = startOfWeek(now, { weekStartsOn: 1 });
  return {
    days,
    totalSeconds,
    weekStart,
    weekEnd,
    rangeLabel: weekRangeLabel(weekStart, now),
    isCurrentWeek: localDateKey(weekStart) === localDateKey(currentStart),
  };
}
