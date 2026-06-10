import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools/core'

/**
 * KUBO-174 item 1 — first dedicated tests for the kind-8720 blacklist parser.
 * The blacklist is a fail-CLOSED deny-list: the construct pipeline withholds the
 * whole construct if a referenced blacklist is forged/missing (see
 * assembleConstructFromRelay.test.ts). These tests pin the parser's harvesting
 * + signature/subject surface that those checks read.
 */
vi.mock('nostr-tools/pure', () => ({
  verifyEvent: (ev: Event) => ev.sig === 'f'.repeat(128),
}))

const { parseBlacklist } = await import('./parseBlacklist')
const { KIND_BLACKLIST } = await import('./kinds')

const KID = 'a'.repeat(64)
const GUARDIAN = 'b'.repeat(64)
const BLOCKED_PK = 'c'.repeat(64)
const BLOCKED_EV = 'd'.repeat(64)
const SIG_OK = 'f'.repeat(128)
const SIG_BAD = '0'.repeat(128)

function blacklistEvent(
  tags: string[][],
  opts: { subject?: string; pubkey?: string; signed?: boolean } = {},
): Event {
  return {
    id: '0'.repeat(64),
    pubkey: opts.pubkey ?? GUARDIAN,
    kind: KIND_BLACKLIST,
    created_at: 1_700_000_000,
    content: '',
    tags: [['subject', opts.subject ?? KID], ...tags],
    sig: opts.signed === false ? SIG_BAD : SIG_OK,
  } as unknown as Event
}

describe('parseBlacklist', () => {
  it('flags the wrong kind', () => {
    const ev = blacklistEvent([])
    ;(ev as { kind: number }).kind = 8721
    const p = parseBlacklist(ev)
    expect(p.parseProblems.some((m) => m.includes('Wrong kind'))).toBe(true)
  })

  it('harvests blocked pubkeys, relays, and events (lowercased)', () => {
    const p = parseBlacklist(
      blacklistEvent([
        ['p', BLOCKED_PK.toUpperCase()],
        ['r', 'wss://bad.example'],
        ['e', BLOCKED_EV.toUpperCase()],
      ]),
    )
    expect(p.blockedPubkeys).toEqual([BLOCKED_PK])
    expect(p.blockedRelays).toEqual(['wss://bad.example'])
    expect(p.blockedEvents).toEqual([BLOCKED_EV])
    expect(p.guardian).toBe(GUARDIAN)
    expect(p.subject).toBe(KID)
    expect(p.signatureValid).toBe(true)
  })

  it('skips a malformed p-tag (not 64-hex) — the deny-list never grows on junk', () => {
    const p = parseBlacklist(blacklistEvent([['p', 'short'], ['p', BLOCKED_PK]]))
    expect(p.blockedPubkeys).toEqual([BLOCKED_PK])
  })

  it('skips a malformed e-tag (not 64-hex)', () => {
    const p = parseBlacklist(blacklistEvent([['e', 'short'], ['e', BLOCKED_EV]]))
    expect(p.blockedEvents).toEqual([BLOCKED_EV])
  })

  it('lowercases the subject', () => {
    const p = parseBlacklist(blacklistEvent([['p', BLOCKED_PK]], { subject: KID.toUpperCase() }))
    expect(p.subject).toBe(KID)
  })

  it('an unsigned blacklist parses but is flagged signatureValid:false', () => {
    const p = parseBlacklist(blacklistEvent([['p', BLOCKED_PK]], { signed: false }))
    expect(p.signatureValid).toBe(false)
    // The deny-list content is still harvested; the construct pipeline is what
    // rejects an unsigned/forged blacklist (fail-closed).
    expect(p.blockedPubkeys).toEqual([BLOCKED_PK])
  })

  it('an empty blacklist has no blocked items but no parse problems', () => {
    const p = parseBlacklist(blacklistEvent([]))
    expect(p.blockedPubkeys).toEqual([])
    expect(p.blockedRelays).toEqual([])
    expect(p.blockedEvents).toEqual([])
    expect(p.parseProblems).toEqual([])
  })
})
