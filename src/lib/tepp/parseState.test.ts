import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools/core'

/**
 * KUBO-174 item 1 — first dedicated tests for the kind-34700 state parser and
 * the `pickCurrentState` replaceable-conflict picker.
 *
 * Real nostr-tools signing/verification does not work under vitest (two
 * nostr-tools copies resolve; hashing throws — see parse.test.ts). We mock
 * `verifyEvent`: an event is validly signed iff its sig is all-`f`. That lets
 * each test opt a candidate in or out of the picker's signature filter.
 */
vi.mock('nostr-tools/pure', () => ({
  verifyEvent: (ev: Event) => ev.sig === 'f'.repeat(128),
}))

const { parseState, pickCurrentState } = await import('./parseState')
const { KIND_STATE, KIND_PERMISSION_VIEW_NPUB_A } = await import('./kinds')

const KID = 'a'.repeat(64)
const OTHER_KID = 'a'.repeat(63) + 'b'
const GUARDIAN = 'b'.repeat(64)
const OTHER_GUARDIAN = 'c'.repeat(64)
const SIG_OK = 'f'.repeat(128)
const SIG_BAD = '0'.repeat(128)

interface StateOpts {
  pubkey?: string
  subject?: string | null
  dTag?: string | null
  createdAt?: number
  id?: string
  signed?: boolean
  blacklistRef?: string
  globalRef?: string
  assoc?: string
  permissions?: Array<[string, number]>
}

function state(opts: StateOpts = {}): Event {
  const {
    pubkey = GUARDIAN,
    subject = KID,
    dTag = KID,
    createdAt = 1_700_000_000,
    id = '0'.repeat(64),
    signed = true,
    blacklistRef,
    globalRef,
    assoc,
    permissions = [],
  } = opts

  const tags: string[][] = []
  if (dTag !== null) tags.push(['d', dTag])
  if (subject !== null) tags.push(['subject', subject])
  if (assoc) tags.push(['assoc', assoc])
  if (blacklistRef) tags.push(['blacklist', blacklistRef])
  if (globalRef) tags.push(['global', globalRef])
  for (const [pid, kind] of permissions) tags.push(['permission', pid, String(kind)])

  return {
    id,
    pubkey,
    kind: KIND_STATE,
    created_at: createdAt,
    content: '',
    tags,
    sig: signed ? SIG_OK : SIG_BAD,
  } as unknown as Event
}

describe('parseState — structural parsing', () => {
  it('parses a well-formed state: guardian, subject, refs, permissions', () => {
    const p = parseState(
      state({
        blacklistRef: 'd'.repeat(64),
        globalRef: 'e'.repeat(64),
        assoc: 'aa',
        permissions: [['1'.repeat(64), KIND_PERMISSION_VIEW_NPUB_A]],
      }),
    )
    expect(p.guardian).toBe(GUARDIAN)
    expect(p.subject).toBe(KID)
    expect(p.publicBlacklistRef).toBe('d'.repeat(64))
    expect(p.publicGlobalRef).toBe('e'.repeat(64))
    expect(p.publicAssoc).toBe('aa')
    expect(p.publicPermissions).toEqual([
      { id: '1'.repeat(64), kind: KIND_PERMISSION_VIEW_NPUB_A, relayHint: undefined },
    ])
    expect(p.signatureValid).toBe(true)
    expect(p.parseProblems).toEqual([])
  })

  it('flags the wrong kind', () => {
    const ev = state()
    ;(ev as { kind: number }).kind = 1
    const p = parseState(ev)
    expect(p.parseProblems.some((m) => m.includes('Wrong kind'))).toBe(true)
  })

  it('flags a missing d tag', () => {
    const p = parseState(state({ dTag: null }))
    expect(p.parseProblems).toContain('Missing required d tag')
  })

  it('flags a missing subject tag', () => {
    const p = parseState(state({ subject: null }))
    expect(p.parseProblems).toContain('Missing required subject tag')
  })

  it('falls back to the d tag for subject when only d is present', () => {
    const p = parseState(state({ subject: null, dTag: KID }))
    // subject derived from d, but the missing-subject-tag problem is still raised.
    expect(p.subject).toBe(KID)
    expect(p.parseProblems).toContain('Missing required subject tag')
  })

  it('subject ≠ d mismatch: parser keeps the subject tag value, not the d value', () => {
    // A state whose subject tag names a DIFFERENT kid than its d tag. The
    // construct pipeline rejects this downstream (pin subject==kid); the parser
    // itself surfaces the subject-tag value so that check can fire.
    const p = parseState(state({ subject: OTHER_KID, dTag: KID }))
    expect(p.subject).toBe(OTHER_KID)
  })

  it('flags a subject that is not a 64-hex pubkey', () => {
    const p = parseState(state({ subject: 'not-a-pubkey' }))
    expect(p.parseProblems.some((m) => m.includes('not a 64-char hex pubkey'))).toBe(true)
  })

  it('lowercases the subject', () => {
    const p = parseState(state({ subject: KID.toUpperCase() }))
    expect(p.subject).toBe(KID)
  })

  it('drops permission tags missing an id or kind', () => {
    const ev = state()
    ev.tags.push(['permission', 'only-id']) // no kind
    ev.tags.push(['permission', '', '8712']) // empty id
    const p = parseState(ev)
    expect(p.publicPermissions).toEqual([])
  })

  it('drops a permission whose kind is non-numeric (Number → NaN, not finite)', () => {
    const ev = state()
    ev.tags.push(['permission', '2'.repeat(64), 'abc'])
    const p = parseState(ev)
    expect(p.publicPermissions).toEqual([])
  })

  it('captures a permission relay hint at index 3', () => {
    const ev = state()
    ev.tags.push(['permission', '3'.repeat(64), '8712', 'wss://relay.example'])
    const p = parseState(ev)
    expect(p.publicPermissions[0].relayHint).toBe('wss://relay.example')
  })

  it('an unsigned event parses but is flagged signatureValid:false', () => {
    const p = parseState(state({ signed: false }))
    expect(p.signatureValid).toBe(false)
  })
})

describe('pickCurrentState — replaceable-conflict resolution', () => {
  const guardianSet = new Set([GUARDIAN])

  it('returns null when there are no candidates', () => {
    expect(pickCurrentState([], guardianSet)).toBeNull()
  })

  it('returns null when the only candidate is signed by a non-guardian', () => {
    const result = pickCurrentState([state({ pubkey: OTHER_GUARDIAN })], guardianSet)
    expect(result).toBeNull()
  })

  it('returns null when the only candidate is unsigned (forged) even from a guardian', () => {
    const result = pickCurrentState([state({ signed: false })], guardianSet)
    expect(result).toBeNull()
  })

  it('picks the only valid candidate; nothing rejected', () => {
    const ev = state({ id: '1'.repeat(64) })
    const result = pickCurrentState([ev], guardianSet)
    expect(result?.current.raw.id).toBe('1'.repeat(64))
    expect(result?.rejected).toEqual([])
  })

  it('picks the latest by created_at among valid guardian candidates', () => {
    const older = state({ id: '1'.repeat(64), createdAt: 1000 })
    const newer = state({ id: '2'.repeat(64), createdAt: 2000 })
    const result = pickCurrentState([older, newer], guardianSet)
    expect(result?.current.raw.id).toBe('2'.repeat(64))
  })

  it('tie-break on equal created_at: lex-smaller event id wins (NIP-01)', () => {
    const evHi = state({ id: 'f'.repeat(64), createdAt: 5000 })
    const evLo = state({ id: '0'.repeat(64), createdAt: 5000 })
    // Feed in hi-then-lo to prove the sort, not insertion order, decides.
    const result = pickCurrentState([evHi, evLo], guardianSet)
    expect(result?.current.raw.id).toBe('0'.repeat(64))
  })

  it('rejects a forged sibling but still picks the valid one', () => {
    const forged = state({ id: '1'.repeat(64), pubkey: OTHER_GUARDIAN, createdAt: 9999 })
    const valid = state({ id: '2'.repeat(64), createdAt: 1000 })
    const result = pickCurrentState([forged, valid], guardianSet)
    expect(result?.current.raw.id).toBe('2'.repeat(64))
    expect(result?.rejected.map((r) => r.raw.id)).toContain('1'.repeat(64))
  })

  it('evaluates guardianship NOW: a state from a since-removed guardian is rejected', () => {
    // Even though it is newest, a state authored by a pubkey no longer in the
    // current guardian set is excluded (Q-2: guardianship evaluated NOW).
    const removedGuardianState = state({ id: '1'.repeat(64), pubkey: OTHER_GUARDIAN, createdAt: 9999 })
    const currentGuardianState = state({ id: '2'.repeat(64), createdAt: 1000 })
    const result = pickCurrentState(
      [removedGuardianState, currentGuardianState],
      new Set([GUARDIAN]),
    )
    expect(result?.current.raw.id).toBe('2'.repeat(64))
  })

  it('two guardians: picks the newest across both guardians', () => {
    const fromA = state({ id: '1'.repeat(64), pubkey: GUARDIAN, createdAt: 1000 })
    const fromB = state({ id: '2'.repeat(64), pubkey: OTHER_GUARDIAN, createdAt: 2000 })
    const result = pickCurrentState([fromA, fromB], new Set([GUARDIAN, OTHER_GUARDIAN]))
    expect(result?.current.raw.id).toBe('2'.repeat(64))
  })
})
