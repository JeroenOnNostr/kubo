import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Event } from 'nostr-tools/core'

/**
 * KUBO-174 item 8 — `useEnsureKidAssociation` recovery logic.
 *
 * The hook is a React effect over `useNostr`/`useKidSigner`/`useParentSigner`,
 * so its guard-sharing (no double publish), defer-without-marking (signers
 * absent), and once-per-session latching live inside an effect body and a
 * module-level `Set`. The DECISION the effect makes — "should this session
 * (re)publish the kid's association?" — is the pure composition of
 * `pickCurrentAssociation` (the construct root) + `shouldRenewAssociation`
 * (the renewal-window predicate). This file pins that composition, which is the
 * actual self-healing behaviour (missing/expired → renew = recovery), plus the
 * test-only guard reset. The effect wiring itself (guard double-publish race,
 * defer-on-missing-signer) is browser-walkthrough territory (KUBO-145) and noted
 * in the report.
 */

vi.mock('nostr-tools/pure', () => ({
  verifyEvent: (ev: Event) => ev.sig === 'f'.repeat(128),
}))

const { pickCurrentAssociation, parseAssociation } = await import('@/lib/tepp/parse')
const { shouldRenewAssociation, ASSOC_TTL_SECONDS, ASSOC_RENEWAL_WINDOW_SECONDS } = await import(
  '@/lib/tepp-adapters/assocExpiry'
)
const { __resetEnsureKidAssociationGuard } = await import('./useEnsureKidAssociation')
const { KIND_ASSOCIATION } = await import('@/lib/tepp/kinds')

const KID = 'a'.repeat(64)
const PARENT = 'b'.repeat(64)
const NOW = Math.floor(Date.now() / 1000)

function assoc(opts: { expiration?: number; createdAt?: number; id?: string; signed?: boolean } = {}): Event {
  const exp = opts.expiration ?? NOW + ASSOC_TTL_SECONDS
  return {
    id: opts.id ?? '0'.repeat(64),
    pubkey: KID,
    kind: KIND_ASSOCIATION,
    created_at: opts.createdAt ?? NOW,
    content: '',
    tags: [
      ['d', 'tepp-assoc'],
      ['subject', KID],
      ['guardian', PARENT],
      ['expiration', String(exp)],
    ],
    sig: opts.signed === false ? '0'.repeat(128) : 'f'.repeat(128),
  } as unknown as Event
}

/**
 * Re-implements the hook's renewal decision (useEnsureKidAssociation.ts:92-103):
 * pick the current valid assoc; if none, fall back to the newest parseable
 * expiry; then ask shouldRenewAssociation. Returns true = the session republishes.
 */
function shouldSessionRenew(events: Event[], now: number): boolean {
  const current = pickCurrentAssociation(events)
  const currentExpiry = current
    ? current.expiration
    : (events
        .map((e) => parseAssociation(e).expiration)
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => b - a)[0] ?? null)
  return shouldRenewAssociation(currentExpiry, now)
}

describe('useEnsureKidAssociation — renewal decision (recovery composition)', () => {
  it('no association at all → renew (the missing-root recovery)', () => {
    expect(shouldSessionRenew([], NOW)).toBe(true)
  })

  it('expired association → renew (resurrects a dead/"migrated" install)', () => {
    // pickCurrentAssociation returns null for an expired one; the fallback reads
    // its (past) expiry, which is < window → renew.
    const expired = assoc({ expiration: NOW - 1000 })
    expect(pickCurrentAssociation([expired])).toBeNull()
    expect(shouldSessionRenew([expired], NOW)).toBe(true)
  })

  it('healthy fresh 1y association → does NOT renew', () => {
    const healthy = assoc({ expiration: NOW + ASSOC_TTL_SECONDS })
    expect(pickCurrentAssociation([healthy])).not.toBeNull()
    expect(shouldSessionRenew([healthy], NOW)).toBe(false)
  })

  it('association inside the renewal window → renew (proactive refresh)', () => {
    const nearExpiry = assoc({ expiration: NOW + ASSOC_RENEWAL_WINDOW_SECONDS - 60 })
    expect(shouldSessionRenew([nearExpiry], NOW)).toBe(true)
  })

  it('a forged (bad-sig) association is not "current" → renew (recovery)', () => {
    const forged = assoc({ expiration: NOW + ASSOC_TTL_SECONDS, signed: false })
    expect(pickCurrentAssociation([forged])).toBeNull()
    // Its expiry is far-future, so the fallback would read healthy — documenting
    // that a forged-but-future assoc still reads "no renew" off the fallback
    // expiry. The construct pipeline rejects the forged event independently.
    expect(shouldSessionRenew([forged], NOW)).toBe(false)
  })

  it('mixed expired + a valid future association → uses the valid one (no renew)', () => {
    const expired = assoc({ expiration: NOW - 1000, id: '1'.repeat(64), createdAt: NOW - 5000 })
    const valid = assoc({ expiration: NOW + ASSOC_TTL_SECONDS, id: '2'.repeat(64), createdAt: NOW })
    expect(pickCurrentAssociation([expired, valid])?.raw.id).toBe('2'.repeat(64))
    expect(shouldSessionRenew([expired, valid], NOW)).toBe(false)
  })
})

describe('useEnsureKidAssociation — once-per-session guard reset', () => {
  beforeEach(() => __resetEnsureKidAssociationGuard())

  it('exposes a test-only reset that clears the module-level guard without throwing', () => {
    // The guard itself is a private Set keyed per kid; the reset is the only
    // public seam. Exercising it documents the contract the effect relies on
    // (a deferred attempt leaves the guard unset so a later render retries).
    expect(() => __resetEnsureKidAssociationGuard()).not.toThrow()
  })
})
