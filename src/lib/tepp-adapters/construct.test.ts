import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools/core'

import {
  KIND_ASSOCIATION,
  KIND_STATE,
  KIND_BLACKLIST,
  KIND_GLOBAL_RESTRICTION,
  KIND_PERMISSION_VIEW_NPUB_A,
} from '@/lib/tepp/kinds'

/**
 * KUBO-156 — blacklist/global verification in the Kubo-owned `assembleConstruct`.
 *
 * Real nostr-tools signing/verification does not work under vitest (two
 * nostr-tools copies resolve; hashing throws — see parse.test.ts /
 * seedKidConstruct.test.ts). We mock `verifyEvent`: an event is "validly
 * signed" iff its sig is all-`f`. That lets each test opt a deny-list event in
 * or out of the signature filter and isolate the guardian/sig gate this task
 * adds (the fields were previously dead code — blacklist/global were forwarded
 * unconditionally).
 */
vi.mock('nostr-tools/pure', () => ({
  verifyEvent: (ev: Event) => ev.sig === 'f'.repeat(128),
}))

// Import AFTER the mock so the parsers pick up the mocked verifyEvent.
const { assembleConstruct } = await import('./construct')
const { parseAssociation } = await import('@/lib/tepp/parse')
const { parseState } = await import('@/lib/tepp/parseState')
const { parsePermission } = await import('@/lib/tepp/parsePermission')
const { parseBlacklist } = await import('@/lib/tepp/parseBlacklist')
const { parseGlobal } = await import('@/lib/tepp/parseGlobal')

const KID = 'a'.repeat(64)
const PARENT = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64)
const BLOCKED = 'd'.repeat(64)
const ALLOWED = 'e'.repeat(64)
const SIG_OK = 'f'.repeat(128)
const SIG_BAD = '0'.repeat(128)
const NOW = Math.floor(Date.now() / 1000)

function ev(partial: Partial<Event> & { kind: number; pubkey: string }): Event {
  return {
    id: '1'.repeat(64),
    created_at: NOW,
    content: '',
    tags: [],
    sig: SIG_OK,
    ...partial,
  } as Event
}

function assocEvt() {
  return parseAssociation(
    ev({
      kind: KIND_ASSOCIATION,
      pubkey: KID,
      tags: [
        ['d', 'tepp-assoc'],
        ['subject', KID],
        ['guardian', PARENT],
        ['expiration', String(NOW + 365 * 24 * 60 * 60)],
      ],
    }),
  )
}

function stateEvt() {
  return parseState(
    ev({
      kind: KIND_STATE,
      pubkey: PARENT,
      tags: [['d', KID], ['subject', KID]],
    }),
  )
}

function permEvt() {
  return parsePermission(
    ev({
      kind: KIND_PERMISSION_VIEW_NPUB_A,
      pubkey: PARENT,
      tags: [['subject', KID], ['p', ALLOWED]],
    }),
  )
}

/** Blacklist event blocking BLOCKED; controllable signer + sig. */
function blacklistEvt(opts: { guardian?: string; sig?: string } = {}) {
  return parseBlacklist(
    ev({
      kind: KIND_BLACKLIST,
      pubkey: opts.guardian ?? PARENT,
      sig: opts.sig ?? SIG_OK,
      tags: [['subject', KID], ['p', BLOCKED]],
    }),
  )
}

function globalEvt(opts: { guardian?: string; sig?: string } = {}) {
  return parseGlobal(
    ev({
      kind: KIND_GLOBAL_RESTRICTION,
      pubkey: opts.guardian ?? PARENT,
      sig: opts.sig ?? SIG_OK,
      tags: [['subject', KID], ['restriction', 'deny', '*', '*', '*']],
    }),
  )
}

describe('assembleConstruct — KUBO-156 deny-list verification', () => {
  it('honours a guardian-signed blacklist', () => {
    const c = assembleConstruct({
      assoc: assocEvt(),
      state: stateEvt(),
      permissions: [permEvt()],
      blacklist: blacklistEvt(),
    })
    expect(c.blacklist).toBeDefined()
    expect(c.blacklist!.blockedPubkeys).toContain(BLOCKED)
  })

  it('drops a non-guardian (forged signer) blacklist', () => {
    const c = assembleConstruct({
      assoc: assocEvt(),
      state: stateEvt(),
      permissions: [permEvt()],
      blacklist: blacklistEvt({ guardian: STRANGER }),
    })
    expect(c.blacklist).toBeUndefined()
  })

  it('drops a bad-signature blacklist', () => {
    const c = assembleConstruct({
      assoc: assocEvt(),
      state: stateEvt(),
      permissions: [permEvt()],
      blacklist: blacklistEvt({ sig: SIG_BAD }),
    })
    expect(c.blacklist).toBeUndefined()
  })

  it('honours a guardian-signed global, drops a forged one', () => {
    const ok = assembleConstruct({
      assoc: assocEvt(),
      state: stateEvt(),
      permissions: [permEvt()],
      global: globalEvt(),
    })
    expect(ok.global).toBeDefined()

    const forged = assembleConstruct({
      assoc: assocEvt(),
      state: stateEvt(),
      permissions: [permEvt()],
      global: globalEvt({ guardian: STRANGER }),
    })
    expect(forged.global).toBeUndefined()
  })

  it('does not raise inert audit findings from a forged blacklist', () => {
    // A blocked pubkey that IS in the permission list would normally surface an
    // inert finding — but only against a *verified* blacklist.
    const permBlocked = parsePermission(
      ev({
        kind: KIND_PERMISSION_VIEW_NPUB_A,
        pubkey: PARENT,
        tags: [['subject', KID], ['p', BLOCKED]],
      }),
    )
    const forged = assembleConstruct({
      assoc: assocEvt(),
      state: stateEvt(),
      permissions: [permBlocked],
      blacklist: blacklistEvt({ guardian: STRANGER }),
    })
    expect(forged.inertAuditFindings).toHaveLength(0)

    const verified = assembleConstruct({
      assoc: assocEvt(),
      state: stateEvt(),
      permissions: [permBlocked],
      blacklist: blacklistEvt(),
    })
    expect(verified.inertAuditFindings.length).toBeGreaterThan(0)
  })

  it('happy path: includes guardian-signed permissions', () => {
    const c = assembleConstruct({
      assoc: assocEvt(),
      state: stateEvt(),
      permissions: [permEvt()],
    })
    expect(c.entries).toHaveLength(1)
    expect(c.subject).toBe(KID)
  })
})
