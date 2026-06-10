import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools/core'

/**
 * KUBO-174 item 1 — first dedicated tests for the kind-8721 global-restriction
 * parser. Like the blacklist, the global is a fail-closed deny surface; the
 * construct pipeline rejects a forged/missing referenced global. These tests
 * pin restriction harvesting + the signature/subject surface those checks read,
 * and document that client-restriction tags are silently ignored (Q-7).
 */
vi.mock('nostr-tools/pure', () => ({
  verifyEvent: (ev: Event) => ev.sig === 'f'.repeat(128),
}))

const { parseGlobal } = await import('./parseGlobal')
const { KIND_GLOBAL_RESTRICTION } = await import('./kinds')

const KID = 'a'.repeat(64)
const GUARDIAN = 'b'.repeat(64)
const SIG_OK = 'f'.repeat(128)
const SIG_BAD = '0'.repeat(128)

function globalEvent(
  tags: string[][],
  opts: { subject?: string; pubkey?: string; signed?: boolean } = {},
): Event {
  return {
    id: '0'.repeat(64),
    pubkey: opts.pubkey ?? GUARDIAN,
    kind: KIND_GLOBAL_RESTRICTION,
    created_at: 1_700_000_000,
    content: '',
    tags: [['subject', opts.subject ?? KID], ...tags],
    sig: opts.signed === false ? SIG_BAD : SIG_OK,
  } as unknown as Event
}

describe('parseGlobal', () => {
  it('flags the wrong kind', () => {
    const ev = globalEvent([])
    ;(ev as { kind: number }).kind = 8720
    const p = parseGlobal(ev)
    expect(p.parseProblems.some((m) => m.includes('Wrong kind'))).toBe(true)
  })

  it('harvests valid restriction tags', () => {
    const p = parseGlobal(
      globalEvent([
        ['restriction', 'deny', '*', '*', '18:00-22:00'],
        ['restriction', 'allow', '1', '1,2,3,4,5', '*'],
      ]),
    )
    expect(p.restrictions).toHaveLength(2)
    expect(p.restrictions[0].polarity).toBe('deny')
    expect(p.restrictions[1].polarity).toBe('allow')
    expect(p.guardian).toBe(GUARDIAN)
    expect(p.subject).toBe(KID)
    expect(p.signatureValid).toBe(true)
  })

  it('flags a bad restriction tag and drops it', () => {
    const p = parseGlobal(
      globalEvent([
        ['restriction', 'allow', '*', '*', '*'],
        ['restriction', 'maybe', '*', '*', '*'],
      ]),
    )
    expect(p.restrictions).toHaveLength(1)
    expect(p.parseProblems.some((m) => m.includes('Bad restriction tag'))).toBe(true)
  })

  it('silently ignores client-restriction tags (Q-7 scoped out)', () => {
    const p = parseGlobal(
      globalEvent([
        ['restriction', 'deny', '*', '*', '*'],
        ['client-restriction', 'no-zaps'],
      ]),
    )
    expect(p.restrictions).toHaveLength(1)
    // No parse problem raised for the ignored client-restriction tag.
    expect(p.parseProblems).toEqual([])
  })

  it('lowercases the subject', () => {
    const p = parseGlobal(globalEvent([['restriction', 'deny', '*', '*', '*']], { subject: KID.toUpperCase() }))
    expect(p.subject).toBe(KID)
  })

  it('an unsigned global parses but is flagged signatureValid:false', () => {
    const p = parseGlobal(globalEvent([['restriction', 'deny', '*', '*', '*']], { signed: false }))
    expect(p.signatureValid).toBe(false)
  })

  it('an empty global has no restrictions and no parse problems', () => {
    const p = parseGlobal(globalEvent([]))
    expect(p.restrictions).toEqual([])
    expect(p.parseProblems).toEqual([])
  })
})
