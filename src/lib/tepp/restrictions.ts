import type { RestrictionTag, TimeRange } from './types'

/**
 * Parse a single restriction tag from wire form:
 *   ["restriction", "allow"|"deny", "<kind-list>", "<weekday>", "<time-range>"]
 *
 * Throws if the tag is structurally invalid.
 */
export function parseRestrictionTag(tag: string[]): RestrictionTag {
  if (tag[0] !== 'restriction') throw new Error('Not a restriction tag')
  const polarity = tag[1]
  if (polarity !== 'allow' && polarity !== 'deny') {
    throw new Error(`restriction polarity must be allow|deny, got ${polarity}`)
  }
  const kindList = parseKindList(tag[2] ?? '*')
  const weekdays = parseWeekdayList(tag[3] ?? '*')
  const timeRange = parseTimeRange(tag[4] ?? '*')
  return {
    polarity,
    kindList,
    weekdays,
    timeRange,
    raw: tag.slice(),
  }
}

export function tryParseRestrictionTag(tag: string[]): RestrictionTag | null {
  try {
    return parseRestrictionTag(tag)
  } catch {
    return null
  }
}

function parseKindList(s: string): number[] | 'any' {
  if (s === '*') return 'any'
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
  const nums = parts.map((p) => Number(p)).filter((n) => Number.isFinite(n))
  if (nums.length === 0) throw new Error(`empty kind-list: ${s}`)
  return nums
}

function parseWeekdayList(s: string): number[] | 'any' {
  if (s === '*') return 'any'
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
  const nums = parts
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7)
  if (nums.length === 0) throw new Error(`empty weekday-list: ${s}`)
  return nums
}

function parseTimeRange(s: string): TimeRange | 'any' {
  if (s === '*') return 'any'
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) throw new Error(`bad time range: ${s}`)
  const h1 = Number(m[1]),
    m1 = Number(m[2]),
    h2 = Number(m[3]),
    m2 = Number(m[4])
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) throw new Error(`time out of range: ${s}`)
  return { startMinutes: h1 * 60 + m1, endMinutes: h2 * 60 + m2 }
}

/**
 * Does this restriction tag match the given action?
 */
export function restrictionMatches(
  tag: RestrictionTag,
  ctx: { kind: number; weekday: number; minutesOfDay: number },
): boolean {
  // Kind list
  if (tag.kindList !== 'any') {
    if (!tag.kindList.includes(ctx.kind)) return false
  }
  // Weekday
  if (tag.weekdays !== 'any') {
    if (!tag.weekdays.includes(ctx.weekday)) return false
  }
  // Time range
  if (tag.timeRange !== 'any') {
    const { startMinutes, endMinutes } = tag.timeRange
    if (startMinutes <= endMinutes) {
      if (ctx.minutesOfDay < startMinutes || ctx.minutesOfDay >= endMinutes) return false
    } else {
      // overnight wrap: in window if BEFORE end OR AT-OR-AFTER start
      if (ctx.minutesOfDay >= endMinutes && ctx.minutesOfDay < startMinutes) return false
    }
  }
  return true
}

/**
 * Four-regime evaluation of a whole restriction set against an action.
 *
 * 1. Any deny-tag matches → deny.
 * 2. Else, any allow-tag matches → allow.
 * 3. Else, no allow-tags exist at all → allow (no whitelist filter).
 * 4. Else (allow-tags exist but none match) → deny.
 */
export type RestrictionVerdict = 'allow' | 'deny'

export interface RestrictionEvaluation {
  verdict: RestrictionVerdict
  reason: string
  decidingTag?: string[]
}

export function evaluateRestrictions(
  set: RestrictionTag[],
  ctx: { kind: number; weekday: number; minutesOfDay: number },
): RestrictionEvaluation {
  const denies = set.filter((r) => r.polarity === 'deny')
  const allows = set.filter((r) => r.polarity === 'allow')

  for (const d of denies) {
    if (restrictionMatches(d, ctx)) {
      return {
        verdict: 'deny',
        reason: 'deny-tag matches',
        decidingTag: d.raw,
      }
    }
  }
  for (const a of allows) {
    if (restrictionMatches(a, ctx)) {
      return {
        verdict: 'allow',
        reason: 'allow-tag matches and no deny-tag matched',
        decidingTag: a.raw,
      }
    }
  }
  if (allows.length === 0) {
    return {
      verdict: 'allow',
      reason: 'no allow-tags present (no whitelist) and no deny-tag matched',
    }
  }
  return {
    verdict: 'deny',
    reason: 'allow-tags present but none matched',
  }
}

/** Get current evaluation context (now in subject's local time). */
export function nowContext(kind: number, date: Date = new Date()) {
  // ISO weekday: 1=Mon..7=Sun
  const dow = date.getDay() // 0=Sun..6=Sat
  const isoWeekday = dow === 0 ? 7 : dow
  const minutesOfDay = date.getHours() * 60 + date.getMinutes()
  return { kind, weekday: isoWeekday, minutesOfDay }
}
