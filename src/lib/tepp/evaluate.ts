/**
 * Comprehensive event evaluation per NIP §Action evaluation:
 *
 * Walks every reference of an event (extractReferences) and runs the
 * deny-fast layered check on each. Whole-event verdict is the conjunction:
 * permit only if every reference passes; otherwise deny pointing at the
 * first failing reference.
 *
 * Direction selects the threshold:
 * - outgoing  → reference must be admitted by an interaction-mode entry
 * - incoming  → reference must be admitted by at least a view-only entry
 *
 * Recursion: event references resolve via either an event-list permission
 * for that exact event id OR (recursively) the referenced event's author
 * being admitted as a pubkey reference AND every reference of the inner
 * event clearing the same threshold. Cycles are broken by deduplicating
 * on event id.
 */

import type { Event } from 'nostr-tools/core'
import type {
  Construct,
  ConstructEntry,
  Direction,
  FullEventVerdict,
  ReferenceVerdict,
} from './types'
import { evaluateRestrictions, nowContext } from './restrictions'
import {
  INTERACTION_KINDS,
  KIND_PERMISSION_INTERACTION_EVENT,
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_VIEW_EVENT,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_B,
  KIND_PERMISSION_VIEW_RELAY,
  VIEW_KINDS,
} from './kinds'
import {
  extractReferences,
  type Reference,
} from './references'

const NPUB_INTERACTION_KINDS = [KIND_PERMISSION_INTERACTION_NPUB_A, KIND_PERMISSION_INTERACTION_NPUB_B]
const NPUB_VIEW_KINDS = [KIND_PERMISSION_VIEW_NPUB_A, KIND_PERMISSION_VIEW_NPUB_B]
const RELAY_INTERACTION_KIND = KIND_PERMISSION_INTERACTION_RELAY
const RELAY_VIEW_KIND = KIND_PERMISSION_VIEW_RELAY
const EVENT_INTERACTION_KIND = KIND_PERMISSION_INTERACTION_EVENT
const EVENT_VIEW_KIND = KIND_PERMISSION_VIEW_EVENT

export interface EvaluateOptions {
  /** Cache of fetched referenced events. Caller should pre-fetch via prefetchReferenceClosure. */
  eventCache?: Map<string, Event>
  /** Maximum recursion depth. Default 4. */
  maxDepth?: number
  /** Internal: visited event ids for cycle break. */
  visitedEventIds?: Set<string>
  /** Internal: depth tracker. */
  depth?: number
}

export function evaluateEvent(
  event: Event,
  construct: Construct,
  direction: Direction,
  opts: EvaluateOptions = {},
): FullEventVerdict {
  const eventCache = opts.eventCache ?? new Map<string, Event>()
  const visited = opts.visitedEventIds ?? new Set<string>()
  const depth = opts.depth ?? 0

  visited.add(event.id)

  const ctx = nowContext(event.kind)

  // -- Layer 2: global restrictions are evaluated once for the whole event.
  let globalDeny: ReferenceVerdict | null = null
  if (construct.global) {
    const globalEv = evaluateRestrictions(construct.global.restrictions, ctx)
    if (globalEv.verdict === 'deny') {
      globalDeny = {
        refType: 'pubkey',
        surface: 'event-action',
        raw: `kind ${event.kind} @ ${ctx.minutesOfDay}min`,
        decoded: '*',
        outcome: 'deny',
        layer: 'global',
        decidingEntryId: construct.global.raw.id,
        decidingTag: globalEv.decidingTag,
        message: `global restriction event ${construct.global.raw.id.slice(0, 12)}… denies — ${globalEv.reason}`,
      }
    }
  }

  // Extract references from the event.
  const refs = extractReferences(event)
  const verdicts: ReferenceVerdict[] = []

  // Author of the outer event is itself a reference (the most fundamental one).
  // For inbound: author must be admitted at view-only or better.
  // For outgoing: author admission is implicitly the subject's own pubkey if signing as the subject; otherwise a pubkey ref.
  if (direction === 'incoming') {
    verdicts.push(
      evaluatePubkeyReference(
        event.pubkey.toLowerCase(),
        'event-author',
        event.pubkey,
        construct,
        direction,
        ctx,
      ),
    )
  }

  // If global denies, prepend that and shortcut everything else.
  if (globalDeny) {
    return finalize([globalDeny, ...verdicts], direction, ctx)
  }

  // Walk each reference.
  for (const ref of refs) {
    const v = evaluateReference(
      ref,
      event,
      construct,
      direction,
      ctx,
      eventCache,
      visited,
      depth,
      opts.maxDepth ?? 4,
    )
    verdicts.push(v)
  }

  return finalize(verdicts, direction, ctx)
}

/* -------------------------------------------------------------------------- */
/* Per-reference dispatch                                                      */
/* -------------------------------------------------------------------------- */

function evaluateReference(
  ref: Reference,
  outerEvent: Event,
  construct: Construct,
  direction: Direction,
  ctx: ReturnType<typeof nowContext>,
  cache: Map<string, Event>,
  visited: Set<string>,
  depth: number,
  maxDepth: number,
): ReferenceVerdict {
  if (ref.type === 'pubkey') {
    return evaluatePubkeyReference(ref.pubkey, ref.surface, ref.raw, construct, direction, ctx)
  }
  if (ref.type === 'relay') {
    return evaluateRelayReference(ref.url, ref.surface, ref.raw, construct, direction, ctx)
  }
  if (ref.type === 'hex-ambiguous') {
    return evaluateHexAmbiguous(ref.hex, ref.surface, ref.raw, outerEvent, construct, direction, ctx, cache, visited, depth, maxDepth)
  }
  return evaluateEventReference(ref.eventId, ref.surface, ref.raw, outerEvent, construct, direction, ctx, cache, visited, depth, maxDepth, ref.addressable)
}

/* -------------------------------------------------------------------------- */
/* Pubkey reference                                                            */
/* -------------------------------------------------------------------------- */

function evaluatePubkeyReference(
  pubkey: string,
  surface: string,
  raw: string,
  construct: Construct,
  direction: Direction,
  ctx: ReturnType<typeof nowContext>,
): ReferenceVerdict {
  const lower = pubkey.toLowerCase()

  // Subject's own pubkey: implicitly admitted (admission only — blacklist still applies).
  const isSubjectSelf = lower === construct.subject.toLowerCase()

  // 1. Blacklist
  if (construct.blacklist?.blockedPubkeys.includes(lower)) {
    return {
      refType: 'pubkey',
      surface,
      raw,
      decoded: lower,
      outcome: 'deny',
      layer: 'blacklist',
      decidingEntryId: construct.blacklist.raw.id,
      decidingTag: ['p', lower],
      message: `pubkey ${lower.slice(0, 10)}… is blacklisted by ${construct.blacklist.raw.id.slice(0, 12)}…`,
    }
  }

  // Subject self-admission (after blacklist).
  if (isSubjectSelf) {
    return {
      refType: 'pubkey',
      surface,
      raw,
      decoded: lower,
      outcome: 'admit-implicit-subject',
      layer: 'subject-self',
      message: `subject's own pubkey is implicitly admitted`,
    }
  }

  // 2. Per-reference admission: find construct entries whose items contain this pubkey.
  const candidateEntries = construct.entries.filter((e) =>
    isNpubPermissionEntry(e) && entryAdmitsPubkey(e, lower),
  )
  return decideFromCandidates(candidateEntries, surface, 'pubkey', raw, lower, construct, direction, ctx)
}

function isNpubPermissionEntry(e: ConstructEntry): boolean {
  return [
    KIND_PERMISSION_INTERACTION_NPUB_A,
    KIND_PERMISSION_INTERACTION_NPUB_B,
    KIND_PERMISSION_VIEW_NPUB_A,
    KIND_PERMISSION_VIEW_NPUB_B,
  ].includes(e.kind)
}

function entryAdmitsPubkey(e: ConstructEntry, pubkey: string): boolean {
  if (!isNpubPermissionEntry(e)) return false
  const items = e.items as { pubkey: string }[]
  return Array.isArray(items) && items.some((i) => i.pubkey === pubkey)
}

/* -------------------------------------------------------------------------- */
/* Relay reference                                                             */
/* -------------------------------------------------------------------------- */

function evaluateRelayReference(
  url: string,
  surface: string,
  raw: string,
  construct: Construct,
  direction: Direction,
  ctx: ReturnType<typeof nowContext>,
): ReferenceVerdict {
  if (construct.blacklist?.blockedRelays.includes(url)) {
    return {
      refType: 'relay',
      surface,
      raw,
      decoded: url,
      outcome: 'deny',
      layer: 'blacklist',
      decidingEntryId: construct.blacklist.raw.id,
      decidingTag: ['r', url],
      message: `relay ${url} is blacklisted`,
    }
  }
  const candidates = construct.entries.filter(
    (e) => (e.kind === RELAY_INTERACTION_KIND || e.kind === RELAY_VIEW_KIND) && Array.isArray(e.items) && (e.items as string[]).includes(url),
  )
  return decideFromCandidates(candidates, surface, 'relay', raw, url, construct, direction, ctx)
}

/* -------------------------------------------------------------------------- */
/* Event reference (with recursion)                                            */
/* -------------------------------------------------------------------------- */

function evaluateEventReference(
  eventId: string,
  surface: string,
  raw: string,
  _outerEvent: Event,
  construct: Construct,
  direction: Direction,
  ctx: ReturnType<typeof nowContext>,
  cache: Map<string, Event>,
  visited: Set<string>,
  depth: number,
  maxDepth: number,
  addressable?: { kind: number; pubkey: string; identifier: string },
): ReferenceVerdict {
  // Blacklist check
  if (!addressable && construct.blacklist?.blockedEvents.includes(eventId)) {
    return {
      refType: 'event',
      surface,
      raw,
      decoded: eventId,
      outcome: 'deny',
      layer: 'blacklist',
      decidingEntryId: construct.blacklist.raw.id,
      decidingTag: ['e', eventId],
      message: `event ${eventId.slice(0, 12)}… is blacklisted`,
    }
  }

  // Try event-list permission first (Option C: event-list OR author OR recursion)
  const eventListMatch = construct.entries.find(
    (e) => (e.kind === EVENT_INTERACTION_KIND || e.kind === EVENT_VIEW_KIND) &&
      Array.isArray(e.items) &&
      (e.items as { eventId: string }[]).some((i) => i.eventId === eventId),
  )
  if (eventListMatch) {
    const verdict = decideFromCandidates([eventListMatch], surface, 'event', raw, eventId, construct, direction, ctx)
    if (verdict.outcome !== 'deny') return verdict
    // else fall through to author/recursion
  }

  // Cycle break / depth bound
  if (visited.has(eventId)) {
    return {
      refType: 'event',
      surface,
      raw,
      decoded: eventId,
      outcome: direction === 'incoming' ? 'admit-view-only' : 'admit-interaction',
      layer: 'recursion-inner-refs',
      message: `referenced event ${eventId.slice(0, 12)}… already evaluated upstream — cycle break`,
    }
  }
  if (depth >= maxDepth) {
    return {
      refType: 'event',
      surface,
      raw,
      decoded: eventId,
      outcome: 'deny',
      layer: 'recursion-inner-refs',
      message: `recursion depth ${maxDepth} exceeded at event ${eventId.slice(0, 12)}…`,
    }
  }

  // Need the inner event to evaluate by author + recursion.
  const inner = cache.get(eventId)
  if (!inner) {
    return {
      refType: 'event',
      surface,
      raw,
      decoded: eventId,
      outcome: 'pending-fetch',
      layer: 'event-not-fetched',
      message: `referenced event ${eventId.slice(0, 12)}… not yet fetched — verdict pending`,
    }
  }

  const innerVerdict = evaluateEvent(inner, construct, direction, {
    eventCache: cache,
    visitedEventIds: new Set([...visited, eventId]),
    depth: depth + 1,
    maxDepth,
  })

  if (innerVerdict.result === 'deny') {
    return {
      refType: 'event',
      surface,
      raw,
      decoded: eventId,
      outcome: 'deny',
      layer: 'recursion-inner-refs',
      message: `referenced event ${eventId.slice(0, 12)}… denies via ${innerVerdict.message}`,
      nested: innerVerdict,
    }
  }
  if (innerVerdict.result === 'pending') {
    return {
      refType: 'event',
      surface,
      raw,
      decoded: eventId,
      outcome: 'pending-fetch',
      layer: 'recursion-inner-refs',
      message: `referenced event ${eventId.slice(0, 12)}… has unfetched references`,
      nested: innerVerdict,
    }
  }
  // permit — match outcome to the result.
  return {
    refType: 'event',
    surface,
    raw,
    decoded: eventId,
    outcome: innerVerdict.result === 'permit-interaction' ? 'admit-interaction' : 'admit-view-only',
    layer: 'recursion-author',
    message: `referenced event ${eventId.slice(0, 12)}… admitted: ${innerVerdict.message}`,
    nested: innerVerdict,
  }
}

/* -------------------------------------------------------------------------- */
/* Hex-ambiguous reference                                                     */
/* -------------------------------------------------------------------------- */

function evaluateHexAmbiguous(
  hex: string,
  surface: string,
  raw: string,
  outerEvent: Event,
  construct: Construct,
  direction: Direction,
  ctx: ReturnType<typeof nowContext>,
  cache: Map<string, Event>,
  visited: Set<string>,
  depth: number,
  maxDepth: number,
): ReferenceVerdict {
  // Per NIP §Reference extraction → Hex disambiguation:
  // 1. If the construct contains the hex as a known pubkey, evaluate as pubkey.
  // 2. Else if the construct contains it as a known event id, evaluate as event.
  // 3. Else → deny ambiguous-and-unknown.
  //
  // A "known pubkey" is anything in some permission entry's npub items, in
  // the blacklist, or = the subject. A "known event id" is anything in some
  // event-list permission entry's items, in the blacklist's blocked events,
  // OR already in the local event cache (because something else fetched it).
  const isKnownPubkey = isHexKnownAsPubkey(hex, construct)
  if (isKnownPubkey) {
    const asPubkey = evaluatePubkeyReference(hex, surface, raw, construct, direction, ctx)
    return asPubkey
  }
  const isKnownEventId = isHexKnownAsEventId(hex, construct, cache)
  if (isKnownEventId) {
    const asEvent = evaluateEventReference(hex, surface, raw, outerEvent, construct, direction, ctx, cache, visited, depth, maxDepth)
    return asEvent
  }

  // Ambiguous and unknown.
  return {
    refType: 'hex-ambiguous',
    surface,
    raw,
    decoded: hex,
    outcome: 'deny',
    layer: 'unadmitted',
    message: `hex string ${hex.slice(0, 10)}…: not admitted as pubkey or event id`,
  }
}

/* -------------------------------------------------------------------------- */
/* Candidate-entry decision (applies restrictions)                             */
/* -------------------------------------------------------------------------- */

function decideFromCandidates(
  candidates: ConstructEntry[],
  surface: string,
  refType: 'pubkey' | 'event' | 'relay',
  raw: string,
  decoded: string,
  construct: Construct,
  direction: Direction,
  ctx: ReturnType<typeof nowContext>,
): ReferenceVerdict {
  if (candidates.length === 0) {
    return {
      refType,
      surface,
      raw,
      decoded,
      outcome: 'deny',
      layer: 'unadmitted',
      message: `no permission admits ${refType} ${decoded.slice(0, 12)}…`,
    }
  }

  // Try interaction-mode candidates first (so outgoing prefers interaction).
  const interactionCandidates = candidates.filter((e) => isInteractionKind(e.kind))
  const viewCandidates = candidates.filter((e) => isViewKind(e.kind))

  // For outgoing, we MUST admit via an interaction entry.
  const orderedTry = direction === 'outgoing' ? interactionCandidates : [...interactionCandidates, ...viewCandidates]

  let firstRestrictionDeny: { entry: ConstructEntry; reason: string; tag?: string[] } | null = null

  for (const entry of orderedTry) {
    const ev = evaluateEntryRestrictions(entry, ctx)
    if (ev.verdict === 'allow') {
      const interaction = isInteractionKind(entry.kind)
      return {
        refType,
        surface,
        raw,
        decoded,
        outcome: interaction ? 'admit-interaction' : 'admit-view-only',
        layer: refType === 'event' ? 'permission-event-list' : refType === 'relay' ? 'permission-relay-list' : 'permission-pubkey-list',
        decidingEntryId: entry.sourceEventId,
        message: interaction
          ? `admitted (interaction) by ${entry.source} entry ${entry.sourceEventId.slice(0, 12)}…`
          : `admitted (view-only) by ${entry.source} entry ${entry.sourceEventId.slice(0, 12)}…`,
      }
    }
    if (!firstRestrictionDeny) {
      firstRestrictionDeny = {
        entry,
        reason: ev.reason,
        tag: ev.decidingTag,
      }
    }
  }

  // For outgoing direction, if we exhausted interaction candidates without admit
  // and there are view-only candidates, the answer is still deny (can't sign with
  // view-only). If for inbound and we exhausted everything, deny.
  if (direction === 'outgoing' && interactionCandidates.length === 0 && viewCandidates.length > 0) {
    return {
      refType,
      surface,
      raw,
      decoded,
      outcome: 'deny',
      layer: 'unadmitted',
      message: `${decoded.slice(0, 12)}… is admitted only at view-only — cannot sign outgoing`,
    }
  }

  if (firstRestrictionDeny) {
    return {
      refType,
      surface,
      raw,
      decoded,
      outcome: 'deny',
      layer: 'permission-pubkey-list',
      decidingEntryId: firstRestrictionDeny.entry.sourceEventId,
      decidingTag: firstRestrictionDeny.tag,
      message: `restriction on ${firstRestrictionDeny.entry.sourceEventId.slice(0, 12)}… denies — ${firstRestrictionDeny.reason}`,
    }
  }

  return {
    refType,
    surface,
    raw,
    decoded,
    outcome: 'deny',
    layer: 'unadmitted',
    message: `no permission admits ${refType} ${decoded.slice(0, 12)}…`,
  }
}

/** True if the hex is recognised somewhere in the construct as a pubkey. */
function isHexKnownAsPubkey(hex: string, construct: Construct): boolean {
  const lower = hex.toLowerCase()
  if (construct.subject.toLowerCase() === lower) return true
  if (construct.guardians.some((g) => g.toLowerCase() === lower)) return true
  if (construct.blacklist?.blockedPubkeys.some((p) => p.toLowerCase() === lower)) return true
  for (const e of construct.entries) {
    if (
      e.kind === KIND_PERMISSION_INTERACTION_NPUB_A ||
      e.kind === KIND_PERMISSION_INTERACTION_NPUB_B ||
      e.kind === KIND_PERMISSION_VIEW_NPUB_A ||
      // KIND_PERMISSION_VIEW_NPUB_B intentionally omitted as we use only A/B variants for now
      e.kind === 8713
    ) {
      const items = e.items as { pubkey: string }[]
      if (Array.isArray(items) && items.some((i) => i.pubkey === lower)) return true
    }
  }
  return false
}

/** True if the hex is recognised somewhere in the construct as an event id. */
function isHexKnownAsEventId(hex: string, construct: Construct, cache: Map<string, Event>): boolean {
  const lower = hex.toLowerCase()
  if (construct.blacklist?.blockedEvents.some((e) => e.toLowerCase() === lower)) return true
  for (const e of construct.entries) {
    if (e.kind === EVENT_INTERACTION_KIND || e.kind === EVENT_VIEW_KIND) {
      const items = e.items as { eventId: string }[]
      if (Array.isArray(items) && items.some((i) => i.eventId === lower)) return true
    }
  }
  if (cache.has(lower)) return true
  return false
}

function isInteractionKind(kind: number): boolean {
  return (INTERACTION_KINDS as readonly number[]).includes(kind)
}

function isViewKind(kind: number): boolean {
  return (VIEW_KINDS as readonly number[]).includes(kind)
}

function evaluateEntryRestrictions(
  entry: ConstructEntry,
  ctx: ReturnType<typeof nowContext>,
) {
  const r1 = evaluateRestrictions(entry.restrictions, ctx)
  if (r1.verdict === 'deny') return r1
  if (entry.source === 'extension' && entry.harvestedRestrictions) {
    const r2 = evaluateRestrictions(entry.harvestedRestrictions, ctx)
    if (r2.verdict === 'deny') return { ...r2, reason: `R_harvested denies — ${r2.reason}` }
    return { ...r1, reason: `R_issuing and R_harvested both allow — ${r1.reason}` }
  }
  return r1
}

/* -------------------------------------------------------------------------- */
/* Finalisation                                                                */
/* -------------------------------------------------------------------------- */

function finalize(
  verdicts: ReferenceVerdict[],
  direction: Direction,
  ctx: ReturnType<typeof nowContext>,
): FullEventVerdict {
  if (verdicts.length === 0) {
    return {
      result: direction === 'outgoing' ? 'permit-interaction' : 'permit-view-only',
      direction,
      references: [],
      message: 'event has no referenceable surfaces; admit by default',
      evaluatedAt: ctx,
    }
  }

  // Partition denies into "redactable" (nested-event recursion failed —
  // renderer can mask the reference and still display the outer) and
  // "hard" (the outer event itself fails admission at some surface).
  // Per F-3 / NIP §Partial rendering, redactable denies don't deny the
  // outer; they downgrade it to permit-with-redactions.
  const denyIndices = verdicts
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v.outcome === 'deny')

  const redactableIndices = denyIndices
    .filter(
      (x) =>
        (x.v.refType === 'event' || x.v.refType === 'hex-ambiguous') &&
        (x.v.layer === 'recursion-inner-refs' || x.v.layer === 'recursion-author'),
    )
    .map((x) => x.i)
  const redactableSet = new Set(redactableIndices)

  const hardDeny = denyIndices.find((x) => !redactableSet.has(x.i))
  if (hardDeny) {
    return {
      result: 'deny',
      direction,
      references: verdicts,
      decidingIndex: hardDeny.i,
      message: hardDeny.v.message,
      evaluatedAt: ctx,
    }
  }

  // Pending fetches → pending overall (we'll re-evaluate after fetch).
  const pendingIdx = verdicts.findIndex((v) => v.outcome === 'pending-fetch')
  if (pendingIdx >= 0) {
    return {
      result: 'pending',
      direction,
      references: verdicts,
      decidingIndex: pendingIdx,
      message: `${verdicts.filter((v) => v.outcome === 'pending-fetch').length} reference(s) pending fetch`,
      evaluatedAt: ctx,
    }
  }

  // Redactable denies present but no hard denies and no pending → outer
  // admits, but some nested recursion failed. Permit-with-redactions.
  if (redactableIndices.length > 0) {
    const first = verdicts[redactableIndices[0]]
    return {
      result: 'permit-with-redactions',
      direction,
      references: verdicts,
      decidingIndex: redactableIndices[0],
      redactedIndices: redactableIndices,
      message: `outer admits; ${redactableIndices.length} nested reference${redactableIndices.length === 1 ? '' : 's'} denied — render up to deny boundary (first failure: ${first.message})`,
      evaluatedAt: ctx,
    }
  }

  const anyViewOnly = verdicts.some((v) => v.outcome === 'admit-view-only')
  const result = direction === 'outgoing' || !anyViewOnly ? 'permit-interaction' : 'permit-view-only'
  return {
    result,
    direction,
    references: verdicts,
    message:
      result === 'permit-interaction'
        ? 'every reference admitted at interaction threshold'
        : 'every reference admitted at view-only or better',
    evaluatedAt: ctx,
  }
}
