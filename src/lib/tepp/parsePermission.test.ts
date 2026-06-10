import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools/core'

/**
 * KUBO-174 item 1 — first dedicated tests for the permission-list parser
 * (kinds 8710–8717), focused on the validation rules the construct engine
 * leans on: mode-B/extend target validation, monitor-relay placement,
 * single-extend-tag, and per-category item harvesting.
 */
vi.mock('nostr-tools/pure', () => ({
  verifyEvent: (ev: Event) => ev.sig === 'f'.repeat(128),
}))

const { parsePermission } = await import('./parsePermission')
const {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_B,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_VIEW_RELAY,
  KIND_PERMISSION_INTERACTION_EVENT,
  KIND_PERMISSION_VIEW_EVENT,
} = await import('./kinds')

const KID = 'a'.repeat(64)
const GUARDIAN = 'b'.repeat(64)
const NPUB1 = 'c'.repeat(64)
const NPUB2 = 'd'.repeat(64)
const SIG_OK = 'f'.repeat(128)

function perm(kind: number, tags: string[][], opts: { subject?: string; pubkey?: string } = {}): Event {
  return {
    id: '0'.repeat(64),
    pubkey: opts.pubkey ?? GUARDIAN,
    kind,
    created_at: 1_700_000_000,
    content: '',
    tags: [['subject', opts.subject ?? KID], ...tags],
    sig: SIG_OK,
  } as unknown as Event
}

describe('parsePermission — kind discrimination', () => {
  it('flags a non-permission kind', () => {
    const p = parsePermission(perm(1, []))
    expect(p.parseProblems.some((m) => m.includes('Not a TEPP permission kind'))).toBe(true)
  })

  it('reads guardian + subject (lowercased)', () => {
    const p = parsePermission(perm(KIND_PERMISSION_VIEW_NPUB_A, [['p', NPUB1]], { subject: KID.toUpperCase() }))
    expect(p.guardian).toBe(GUARDIAN)
    expect(p.subject).toBe(KID)
  })
})

describe('parsePermission — npub-list harvesting', () => {
  it('collects valid p-tag pubkeys (lowercased)', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_VIEW_NPUB_A, [['p', NPUB1.toUpperCase()], ['p', NPUB2]]),
    )
    expect(p.npubItems.map((i) => i.pubkey)).toEqual([NPUB1, NPUB2])
  })

  it('flags a malformed p-tag pubkey and skips it', () => {
    const p = parsePermission(perm(KIND_PERMISSION_VIEW_NPUB_A, [['p', 'short'], ['p', NPUB1]]))
    expect(p.npubItems.map((i) => i.pubkey)).toEqual([NPUB1])
    expect(p.parseProblems.some((m) => m.includes('Bad p-tag pubkey'))).toBe(true)
  })

  it('captures an interaction relay hint on interaction kinds only', () => {
    const interact = parsePermission(
      perm(KIND_PERMISSION_INTERACTION_NPUB_A, [['p', NPUB1, 'wss://r.example']]),
    )
    expect(interact.npubItems[0].interactionRelayHint).toBe('wss://r.example')

    const view = parsePermission(
      perm(KIND_PERMISSION_VIEW_NPUB_A, [['p', NPUB1, 'wss://r.example']]),
    )
    // View kinds carry no interaction relay hint.
    expect(view.npubItems[0].interactionRelayHint).toBeUndefined()
  })

  it('parses mode-B npub kinds the same as mode-A for item harvesting', () => {
    const pB = parsePermission(perm(KIND_PERMISSION_VIEW_NPUB_B, [['p', NPUB1]]))
    expect(pB.npubItems.map((i) => i.pubkey)).toEqual([NPUB1])
    expect(pB.parseProblems).toEqual([])
  })
})

describe('parsePermission — relay & event lists', () => {
  it('collects r-tag relays', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_VIEW_RELAY, [['r', 'wss://a.example'], ['r', 'wss://b.example']]),
    )
    expect(p.relayItems).toEqual(['wss://a.example', 'wss://b.example'])
  })

  it('collects e-tag events (lowercased) with relay hints', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_VIEW_EVENT, [['e', 'E'.repeat(64), 'wss://hint.example']]),
    )
    expect(p.eventItems).toEqual([{ eventId: 'e'.repeat(64), relayHint: 'wss://hint.example' }])
  })

  it('does not harvest p-tags on a relay-list kind', () => {
    const p = parsePermission(perm(KIND_PERMISSION_VIEW_RELAY, [['p', NPUB1], ['r', 'wss://a.example']]))
    expect(p.npubItems).toEqual([])
    expect(p.relayItems).toEqual(['wss://a.example'])
  })
})

describe('parsePermission — monitor-relay placement', () => {
  it('accepts monitor-relay on an interaction kind', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_INTERACTION_NPUB_A, [['p', NPUB1], ['monitor-relay', 'wss://mon.example']]),
    )
    expect(p.monitorRelays).toEqual(['wss://mon.example'])
    expect(p.parseProblems).toEqual([])
  })

  it('flags monitor-relay on a view-only kind and drops it', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_VIEW_NPUB_A, [['p', NPUB1], ['monitor-relay', 'wss://mon.example']]),
    )
    expect(p.monitorRelays).toEqual([])
    expect(p.parseProblems.some((m) => m.includes('monitor-relay'))).toBe(true)
  })
})

describe('parsePermission — extend tag validation', () => {
  it('accepts a single valid as-is extend pair on a mode-A target', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_INTERACTION_NPUB_A, [
        ['p', NPUB1],
        ['extend', `${KIND_PERMISSION_INTERACTION_NPUB_A}:as-is`],
      ]),
    )
    expect(p.extendPairs).toEqual([{ kind: KIND_PERMISSION_INTERACTION_NPUB_A, mutation: 'as-is' }])
    expect(p.parseProblems).toEqual([])
  })

  it('accepts a to-view extend pair on an interaction (mode-A) target', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_INTERACTION_NPUB_A, [
        ['p', NPUB1],
        ['extend', `${KIND_PERMISSION_INTERACTION_NPUB_A}:to-view`],
      ]),
    )
    expect(p.extendPairs).toEqual([{ kind: KIND_PERMISSION_INTERACTION_NPUB_A, mutation: 'to-view' }])
  })

  it('rejects a mode-B target kind (8711/8713 forbidden) and drops it', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_INTERACTION_NPUB_A, [
        ['p', NPUB1],
        ['extend', `${KIND_PERMISSION_INTERACTION_NPUB_B}:as-is`],
      ]),
    )
    expect(p.extendPairs).toEqual([])
    expect(p.parseProblems.some((m) => m.includes('not a mode-A target'))).toBe(true)
  })

  it('rejects to-view applied to a view-only kind and drops it', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_INTERACTION_NPUB_A, [
        ['p', NPUB1],
        ['extend', `${KIND_PERMISSION_VIEW_NPUB_A}:to-view`],
      ]),
    )
    expect(p.extendPairs).toEqual([])
    expect(p.parseProblems.some((m) => m.includes('to-view applied to view-only'))).toBe(true)
  })

  it('rejects a malformed extend pair', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_INTERACTION_NPUB_A, [['p', NPUB1], ['extend', 'garbage']]),
    )
    expect(p.extendPairs).toEqual([])
    expect(p.parseProblems.some((m) => m.includes('Bad extend pair'))).toBe(true)
  })

  it('flags more than one extend tag', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_INTERACTION_NPUB_A, [
        ['p', NPUB1],
        ['extend', `${KIND_PERMISSION_INTERACTION_NPUB_A}:as-is`],
        ['extend', `${KIND_PERMISSION_VIEW_NPUB_A}:as-is`],
      ]),
    )
    expect(p.parseProblems.some((m) => m.includes('Multiple extend tags'))).toBe(true)
  })

  it('harvests multiple valid pairs from one extend tag', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_INTERACTION_NPUB_A, [
        ['p', NPUB1],
        [
          'extend',
          `${KIND_PERMISSION_INTERACTION_NPUB_A}:as-is`,
          `${KIND_PERMISSION_VIEW_NPUB_A}:as-is`,
        ],
      ]),
    )
    expect(p.extendPairs).toEqual([
      { kind: KIND_PERMISSION_INTERACTION_NPUB_A, mutation: 'as-is' },
      { kind: KIND_PERMISSION_VIEW_NPUB_A, mutation: 'as-is' },
    ])
  })
})

describe('parsePermission — restriction tags', () => {
  it('parses a valid restriction tag', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_VIEW_NPUB_A, [['p', NPUB1], ['restriction', 'allow', '*', '*', '*']]),
    )
    expect(p.restrictions).toHaveLength(1)
    expect(p.restrictions[0].polarity).toBe('allow')
  })

  it('flags a bad restriction tag', () => {
    const p = parsePermission(
      perm(KIND_PERMISSION_VIEW_NPUB_A, [['p', NPUB1], ['restriction', 'maybe', '*', '*', '*']]),
    )
    expect(p.restrictions).toEqual([])
    expect(p.parseProblems.some((m) => m.includes('Bad restriction tag'))).toBe(true)
  })
})
