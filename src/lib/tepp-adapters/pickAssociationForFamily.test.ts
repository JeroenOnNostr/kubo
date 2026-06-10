import { describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from '@nostrify/nostrify'

import { KIND_ASSOCIATION } from '@/lib/tepp/kinds'

/**
 * KUBO-157 — Kubo-side association integrity in `pickAssociationForFamily`.
 *
 * As in parse.test.ts, real signing does not work under vitest, so we mock
 * `verifyEvent`: an event is "validly signed" iff its sig is all-`f`. This lets
 * each test control whether a candidate clears the picker's signature filter,
 * isolating the future-dating clamp, structural rejection, and guardian-pinning
 * logic this task adds.
 */
vi.mock('nostr-tools/pure', () => ({
  verifyEvent: (ev: NostrEvent) => ev.sig === 'f'.repeat(128),
}))

// Import AFTER the mock is registered.
const { pickAssociationForFamily, ASSOC_CREATED_AT_SKEW_SECONDS } = await import(
  './useConstruct'
)

const KID = 'a'.repeat(64)
const PARENT = 'b'.repeat(64)
// Use a real "now" so parseAssociation's own Date.now()-based expiry check
// (which ignores our injected `now`) agrees with the picker's clamp logic.
const NOW = Math.floor(Date.now() / 1000)

interface AssocOpts {
  subject?: string | null
  guardian?: string | null
  guardians?: string[]
  expiration?: string | null
  createdAt?: number
  id?: string
  signed?: boolean
}

function assoc(opts: AssocOpts = {}): NostrEvent {
  const {
    subject = KID,
    guardian = PARENT,
    guardians,
    expiration = String(NOW + 365 * 24 * 60 * 60),
    createdAt = NOW - 1000,
    id = '0'.repeat(64),
    signed = true,
  } = opts

  const tags: string[][] = [['d', 'tepp-assoc']]
  if (subject !== null) tags.push(['subject', subject])
  const guardianList = guardians ?? (guardian !== null ? [guardian] : [])
  for (const g of guardianList) tags.push(['guardian', g])
  if (expiration !== null) tags.push(['expiration', expiration])

  return {
    id,
    pubkey: KID,
    kind: KIND_ASSOCIATION,
    created_at: createdAt,
    content: '',
    tags,
    sig: signed ? 'f'.repeat(128) : '0'.repeat(128),
  } as unknown as NostrEvent
}

describe('pickAssociationForFamily — KUBO-157', () => {
  it('picks a valid, parent-guarded association', () => {
    const picked = pickAssociationForFamily([assoc()], PARENT, NOW)
    expect(picked).not.toBeNull()
    expect(picked!.subject).toBe(KID)
  })

  it('drops a future-dated candidate beyond the skew allowance', () => {
    const future = assoc({
      id: '1'.repeat(64),
      createdAt: NOW + ASSOC_CREATED_AT_SKEW_SECONDS + 1,
    })
    expect(pickAssociationForFamily([future], PARENT, NOW)).toBeNull()
  })

  it('still picks a present-dated sibling when a future-dated candidate exists', () => {
    const future = assoc({
      id: '1'.repeat(64),
      createdAt: NOW + 10 * 365 * 24 * 60 * 60, // years ahead
    })
    const present = assoc({ id: '2'.repeat(64), createdAt: NOW - 1000 })
    const picked = pickAssociationForFamily([future, present], PARENT, NOW)
    expect(picked).not.toBeNull()
    expect(picked!.raw.id).toBe('2'.repeat(64))
  })

  it('accepts a candidate dated within the 10-minute skew allowance', () => {
    const slightlyAhead = assoc({
      id: '3'.repeat(64),
      createdAt: NOW + ASSOC_CREATED_AT_SKEW_SECONDS - 1,
    })
    expect(pickAssociationForFamily([slightlyAhead], PARENT, NOW)).not.toBeNull()
  })

  it('treats an association naming a non-parent guardian as no-association', () => {
    const selfGoverned = assoc({ guardian: 'c'.repeat(64) }) // kid's own second key, not the parent
    expect(pickAssociationForFamily([selfGoverned], PARENT, NOW)).toBeNull()
  })

  it('accepts when the parent is one of several guardians', () => {
    const multi = assoc({ guardians: ['c'.repeat(64), PARENT] })
    expect(pickAssociationForFamily([multi], PARENT, NOW)).not.toBeNull()
  })

  it('rejects a candidate missing its subject tag', () => {
    expect(pickAssociationForFamily([assoc({ subject: null })], PARENT, NOW)).toBeNull()
  })

  it('rejects a candidate missing its guardian tag', () => {
    expect(pickAssociationForFamily([assoc({ guardian: null })], PARENT, NOW)).toBeNull()
  })

  it('rejects the overflow-expiration crash input without throwing', () => {
    const crash = assoc({ expiration: '99999999999999999999' })
    let picked
    expect(() => {
      picked = pickAssociationForFamily([crash], PARENT, NOW)
    }).not.toThrow()
    expect(picked).toBeNull()
  })

  it('is case-insensitive on the parent pubkey match', () => {
    const picked = pickAssociationForFamily([assoc()], PARENT.toUpperCase(), NOW)
    expect(picked).not.toBeNull()
  })
})
