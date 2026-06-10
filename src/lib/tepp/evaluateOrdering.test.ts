import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools/core'

import { evaluateEvent } from './evaluate'
import { KIND_PERMISSION_VIEW_NPUB_A, KIND_PERMISSION_INTERACTION_NPUB_A } from './kinds'
import type { Construct, ConstructEntry, ParsedBlacklist, ParsedGlobal } from './types'

/**
 * KUBO-174 item 9 — evaluator ordering pins. The whole fail-open-on-`pending`
 * design (incoming content whose author is admitted may read `pending` while
 * references fetch) leans on one invariant: a HARD deny on any surface beats a
 * `pending` reference in `finalize`. If that ever regressed, a denied author or
 * blacklisted reference could ride in under a `pending` verdict and render.
 *
 * Also pins: blacklist precedence (a blacklisted pubkey denies even if admitted
 * by a permission list) and the global-restriction short-circuit (a denying
 * global short-circuits the whole event before any reference — including a
 * would-be `pending` one — is walked).
 */

const KID = 'a'.repeat(64) // construct.subject
const ADMITTED = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64) // not in any permission list
const GUARDIAN = '9'.repeat(64)
const UNCACHED_EVENT = '1'.repeat(64) // e-tagged but never fetched → pending

function npubEntry(kind: number, pubkey: string): ConstructEntry {
  return {
    kind,
    sourceEventId: `${kind}-${pubkey.slice(0, 8)}`,
    source: 'direct',
    items: [{ pubkey }],
    restrictions: [],
    monitorRelays: [],
  }
}

function blacklist(opts: { pubkeys?: string[] } = {}): ParsedBlacklist {
  return {
    raw: { id: 'd'.repeat(64) } as unknown as Event,
    guardian: GUARDIAN,
    blockedPubkeys: opts.pubkeys ?? [],
    blockedRelays: [],
    blockedEvents: [],
    signatureValid: true,
    parseProblems: [],
  }
}

function globalDenyAll(): ParsedGlobal {
  return {
    raw: { id: 'e'.repeat(64) } as unknown as Event,
    guardian: GUARDIAN,
    subject: KID,
    restrictions: [
      { polarity: 'deny', kindList: 'any', weekdays: 'any', timeRange: 'any', raw: ['restriction', 'deny', '*', '*', '*'] },
    ],
    signatureValid: true,
    parseProblems: [],
  }
}

function makeConstruct(opts: {
  entries?: ConstructEntry[]
  blacklist?: ParsedBlacklist
  global?: ParsedGlobal
}): Construct {
  return {
    subject: KID,
    guardians: [GUARDIAN],
    entries: opts.entries ?? [],
    blacklist: opts.blacklist,
    global: opts.global,
    extensionTraces: [],
    inertAuditFindings: [],
  }
}

function note(author: string, tags: string[][] = []): Event {
  return {
    id: '0'.repeat(64),
    sig: '0'.repeat(128),
    pubkey: author,
    kind: 1,
    content: '',
    tags,
    created_at: 1_700_000_000,
  } as unknown as Event
}

describe('finalize ordering — hard deny beats pending', () => {
  it('incoming: unadmitted author + an uncached e-tag (pending) → DENY, not pending', () => {
    // Author STRANGER is in no permission list → hard author deny. The e-tag to
    // an uncached event would, on its own, read pending-fetch. finalize must
    // return the hard deny, never the pending.
    const construct = makeConstruct({
      entries: [npubEntry(KIND_PERMISSION_VIEW_NPUB_A, ADMITTED)],
    })
    const ev = note(STRANGER, [['e', UNCACHED_EVENT]])
    const verdict = evaluateEvent(ev, construct, 'incoming')
    expect(verdict.result).toBe('deny')
  })

  it('control: admitted author + uncached e-tag (pending) → pending (fail-open path intact)', () => {
    // With an ADMITTED author, there is no hard deny, so the uncached e-tag
    // surfaces as pending — the documented fail-open path the ordering pin guards.
    const construct = makeConstruct({
      entries: [npubEntry(KIND_PERMISSION_VIEW_NPUB_A, ADMITTED)],
    })
    const ev = note(ADMITTED, [['e', UNCACHED_EVENT]])
    const verdict = evaluateEvent(ev, construct, 'incoming')
    expect(verdict.result).toBe('pending')
  })

  it('incoming: blacklisted author + uncached e-tag (pending) → DENY, not pending', () => {
    // ADMITTED is both permission-admitted AND blacklisted: blacklist wins, and
    // that hard deny still beats the pending e-tag.
    const construct = makeConstruct({
      entries: [npubEntry(KIND_PERMISSION_VIEW_NPUB_A, ADMITTED)],
      blacklist: blacklist({ pubkeys: [ADMITTED] }),
    })
    const ev = note(ADMITTED, [['e', UNCACHED_EVENT]])
    const verdict = evaluateEvent(ev, construct, 'incoming')
    expect(verdict.result).toBe('deny')
  })
})

describe('blacklist precedence over admission', () => {
  it('incoming: a blacklisted author denies even though a permission list admits them', () => {
    const construct = makeConstruct({
      entries: [npubEntry(KIND_PERMISSION_VIEW_NPUB_A, ADMITTED)],
      blacklist: blacklist({ pubkeys: [ADMITTED] }),
    })
    const verdict = evaluateEvent(note(ADMITTED), construct, 'incoming')
    expect(verdict.result).toBe('deny')
  })

  it('a NON-blacklisted admitted author still permits (control)', () => {
    const construct = makeConstruct({
      entries: [npubEntry(KIND_PERMISSION_VIEW_NPUB_A, ADMITTED)],
      blacklist: blacklist({ pubkeys: [STRANGER] }),
    })
    const verdict = evaluateEvent(note(ADMITTED), construct, 'incoming')
    expect(verdict.result).toBe('permit-view-only')
  })
})

describe('global-restriction short-circuit', () => {
  it('incoming: a deny-all global short-circuits even an otherwise-admitted author', () => {
    const construct = makeConstruct({
      entries: [npubEntry(KIND_PERMISSION_VIEW_NPUB_A, ADMITTED)],
      global: globalDenyAll(),
    })
    const verdict = evaluateEvent(note(ADMITTED), construct, 'incoming')
    expect(verdict.result).toBe('deny')
    expect(verdict.message).toContain('global restriction')
  })

  it('a deny-all global short-circuits BEFORE a pending reference is ever walked', () => {
    // The pending e-tag never enters the verdict set: the global deny returns
    // immediately. The result is a hard global deny, not pending.
    const construct = makeConstruct({
      entries: [npubEntry(KIND_PERMISSION_VIEW_NPUB_A, ADMITTED)],
      global: globalDenyAll(),
    })
    const ev = note(ADMITTED, [['e', UNCACHED_EVENT]])
    const verdict = evaluateEvent(ev, construct, 'incoming')
    expect(verdict.result).toBe('deny')
    expect(verdict.message).toContain('global restriction')
  })

  it('outgoing: a deny-all global denies the kid an interaction', () => {
    const construct = makeConstruct({
      entries: [npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, ADMITTED)],
      global: globalDenyAll(),
    })
    const verdict = evaluateEvent(note(ADMITTED), construct, 'outgoing')
    expect(verdict.result).toBe('deny')
  })
})
