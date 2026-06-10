import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools/core'

import { parseAssociation, pickCurrentAssociation } from './parse'
import { KIND_ASSOCIATION } from './kinds'

/**
 * KUBO-157 — association integrity.
 *
 * Real nostr-tools signing/verification does not work under vitest (two
 * nostr-tools copies resolve, hashing throws an unrelated crypto error — see
 * the note in seedKidConstruct.test.ts). We mock `verifyEvent` so the picker's
 * signature filter is controllable per test, which lets us isolate the
 * overflow-crash and picker-robustness behaviour this task targets.
 */
vi.mock('nostr-tools/pure', () => ({
  // Treat any event whose sig is all-`f` as validly signed; everything else
  // fails verification. Lets tests opt a candidate in/out of the sig filter.
  verifyEvent: (ev: Event) => ev.sig === 'f'.repeat(128),
}))

const KID = 'a'.repeat(64)

interface AssocOpts {
  pubkey?: string
  subject?: string | null
  guardian?: string | null
  expiration?: string | null
  createdAt?: number
  id?: string
  signed?: boolean
}

/** Build a kind-17700 association event with controllable fields. */
function assoc(opts: AssocOpts = {}): Event {
  const {
    pubkey = KID,
    subject = KID,
    guardian = 'b'.repeat(64),
    expiration = String(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60),
    createdAt = 1_700_000_000,
    id = '0'.repeat(64),
    signed = true,
  } = opts

  const tags: string[][] = [['d', 'tepp-assoc']]
  if (subject !== null) tags.push(['subject', subject])
  if (guardian !== null) tags.push(['guardian', guardian])
  if (expiration !== null) tags.push(['expiration', expiration])

  return {
    id,
    pubkey,
    kind: KIND_ASSOCIATION,
    created_at: createdAt,
    content: '',
    tags,
    sig: signed ? 'f'.repeat(128) : '0'.repeat(128),
  } as unknown as Event
}

describe('parseAssociation — KUBO-157 expiration overflow', () => {
  it('does not throw on a finite-but-huge expiration (the verified crash input)', () => {
    expect(() =>
      parseAssociation(assoc({ expiration: '99999999999999999999' })),
    ).not.toThrow()
  })

  it('treats the overflow expiration as expired (fail-closed) with a dash ISO', () => {
    const parsed = parseAssociation(assoc({ expiration: '99999999999999999999' }))
    expect(parsed.validity.expired).toBe(true)
    expect(parsed.validity.expiresAtIso).toBe('—')
  })

  it('treats a non-numeric expiration as expired (fail-closed)', () => {
    const parsed = parseAssociation(assoc({ expiration: 'not-a-number' }))
    expect(parsed.validity.expired).toBe(true)
    expect(parsed.validity.expiresAtIso).toBe('—')
  })

  it('keeps a missing expiration as not-expired (accepted, dash ISO)', () => {
    const parsed = parseAssociation(assoc({ expiration: null }))
    expect(parsed.validity.expired).toBe(false)
    expect(parsed.validity.expiresAtIso).toBe('—')
  })

  it('parses a valid future expiration into a real ISO string and not expired', () => {
    const future = Math.floor(Date.now() / 1000) + 1000
    const parsed = parseAssociation(assoc({ expiration: String(future) }))
    expect(parsed.validity.expired).toBe(false)
    expect(parsed.validity.expiresAtIso).toBe(new Date(future * 1000).toISOString())
  })

  it('flags a past expiration as expired', () => {
    const past = Math.floor(Date.now() / 1000) - 1000
    const parsed = parseAssociation(assoc({ expiration: String(past) }))
    expect(parsed.validity.expired).toBe(true)
  })
})

describe('pickCurrentAssociation — KUBO-157 robustness', () => {
  it('survives the crash input among candidates and picks the valid sibling', () => {
    const crash = assoc({
      id: '1'.repeat(64),
      expiration: '99999999999999999999',
      createdAt: 1_700_000_500, // newer — would win the sort if it qualified
    })
    const good = assoc({
      id: '2'.repeat(64),
      createdAt: 1_700_000_000,
    })

    let picked = null as ReturnType<typeof pickCurrentAssociation>
    expect(() => {
      picked = pickCurrentAssociation([crash, good])
    }).not.toThrow()
    expect(picked).not.toBeNull()
    expect(picked!.raw.id).toBe('2'.repeat(64))
  })

  it('returns null when the only candidate is the (now-expired) crash input', () => {
    expect(pickCurrentAssociation([assoc({ expiration: '99999999999999999999' })])).toBeNull()
  })

  it('skips an unsigned candidate', () => {
    expect(pickCurrentAssociation([assoc({ signed: false })])).toBeNull()
  })

  it('skips a candidate whose subject does not match the pubkey', () => {
    expect(
      pickCurrentAssociation([assoc({ subject: 'c'.repeat(64) })]),
    ).toBeNull()
  })
})
