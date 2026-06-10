import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools/core'
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify'

import {
  KIND_ASSOCIATION,
  KIND_STATE,
  KIND_BLACKLIST,
  KIND_GLOBAL_RESTRICTION,
  KIND_PERMISSION_VIEW_NPUB_A,
} from '@/lib/tepp/kinds'

/**
 * KUBO-156 — subject pinning + fail-closed deny-lists in the construct-assembly
 * pipeline (`assembleConstructFromRelay`).
 *
 * Real nostr-tools signing/verification does not work under vitest (two
 * nostr-tools copies; hashing throws — see parse.test.ts). We mock
 * `verifyEvent`: an event is validly signed iff its sig is all-`f`. Every event
 * built here is "signed" that way unless a test explicitly forges the signer or
 * sig, which lets us isolate the new subject/guardian gates.
 */
vi.mock('nostr-tools/pure', () => ({
  verifyEvent: (ev: Event) => ev.sig === 'f'.repeat(128),
}))

const { assembleConstructFromRelay } = await import('./useConstruct')

const KID = 'a'.repeat(64)
const OTHER_KID = 'a'.repeat(63) + 'b'
const PARENT = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64)
const SIG_OK = 'f'.repeat(128)
const SIG_BAD = '0'.repeat(128)
const ALLOWED = 'e'.repeat(64)
const NOW = Math.floor(Date.now() / 1000)

let idCounter = 0
function freshId(): string {
  idCounter += 1
  return idCounter.toString(16).padStart(64, '0')
}

function evt(p: Partial<NostrEvent> & { kind: number; pubkey: string }): NostrEvent {
  return {
    id: freshId(),
    created_at: NOW,
    content: '',
    tags: [],
    sig: SIG_OK,
    ...p,
  } as NostrEvent
}

function assocEvent(opts: { subject?: string; pubkey?: string } = {}): NostrEvent {
  return evt({
    kind: KIND_ASSOCIATION,
    pubkey: opts.pubkey ?? KID,
    tags: [
      ['d', 'tepp-assoc'],
      ['subject', opts.subject ?? KID],
      ['guardian', PARENT],
      ['expiration', String(NOW + 365 * 24 * 60 * 60)],
    ],
  })
}

function stateEvent(opts: { subject?: string; blacklistRef?: string; globalRef?: string; permRefs?: string[] } = {}): NostrEvent {
  const tags: string[][] = [
    ['d', KID],
    ['subject', opts.subject ?? KID],
  ]
  if (opts.blacklistRef) tags.push(['blacklist', opts.blacklistRef])
  if (opts.globalRef) tags.push(['global', opts.globalRef])
  for (const id of opts.permRefs ?? []) {
    tags.push(['permission', id, String(KIND_PERMISSION_VIEW_NPUB_A)])
  }
  return evt({ kind: KIND_STATE, pubkey: PARENT, tags })
}

function permEvent(opts: { id: string; subject?: string }): NostrEvent {
  return evt({
    id: opts.id,
    kind: KIND_PERMISSION_VIEW_NPUB_A,
    pubkey: PARENT,
    tags: [['subject', opts.subject ?? KID], ['p', ALLOWED]],
  })
}

function blacklistEvent(opts: { id: string; guardian?: string; sig?: string; subject?: string }): NostrEvent {
  return evt({
    id: opts.id,
    kind: KIND_BLACKLIST,
    pubkey: opts.guardian ?? PARENT,
    sig: opts.sig ?? SIG_OK,
    tags: [['subject', opts.subject ?? KID], ['p', 'd'.repeat(64)]],
  })
}

function globalEvent(opts: { id: string; guardian?: string; sig?: string }): NostrEvent {
  return evt({
    id: opts.id,
    kind: KIND_GLOBAL_RESTRICTION,
    pubkey: opts.guardian ?? PARENT,
    sig: opts.sig ?? SIG_OK,
    tags: [['subject', KID], ['restriction', 'deny', '*', '*', '*']],
  })
}

/**
 * Build a `query` that dispatches each filter to the matching event bucket.
 * - assoc query: `kinds:[17700]`
 * - state query: `kinds:[34700]`
 * - ref fetch:   `ids:[...]`
 */
function makeQuery(buckets: { assoc: NostrEvent[]; state: NostrEvent[]; refs: NostrEvent[] }) {
  return async (filters: NostrFilter[]): Promise<NostrEvent[]> => {
    const f = filters[0]
    if (f.kinds?.includes(KIND_ASSOCIATION)) return buckets.assoc
    if (f.kinds?.includes(KIND_STATE)) return buckets.state
    if (f.ids) return buckets.refs.filter((e) => f.ids!.includes(e.id))
    return []
  }
}

function run(buckets: { assoc: NostrEvent[]; state: NostrEvent[]; refs: NostrEvent[] }) {
  return assembleConstructFromRelay({
    kidPubkey: KID,
    parentPubkey: PARENT,
    query: makeQuery(buckets),
    now: NOW,
  })
}

describe('assembleConstructFromRelay — KUBO-156 subject pinning', () => {
  it('happy path assembles a construct', async () => {
    const permId = freshId()
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ permRefs: [permId] })],
      refs: [permEvent({ id: permId })],
    })
    expect(res.construct).not.toBeNull()
    expect(res.construct!.subject).toBe(KID)
    expect(res.construct!.entries).toHaveLength(1)
  })

  it('rejects an association whose subject is a different kid (no-association)', async () => {
    // Author still = KID (parser requires subject==pubkey, so a mismatched
    // subject is also a different author); the family pin then fails it.
    const res = await run({
      assoc: [assocEvent({ subject: OTHER_KID, pubkey: OTHER_KID })],
      state: [stateEvent()],
      refs: [],
    })
    expect(res.construct).toBeNull()
    expect(res.reason).toBe('no-association')
  })

  it('rejects a state whose subject is a different kid (no-state-event)', async () => {
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ subject: OTHER_KID })],
      refs: [],
    })
    expect(res.construct).toBeNull()
    expect(res.reason).toBe('no-state-event')
  })

  it('excludes a permission whose subject is a different kid', async () => {
    const goodId = freshId()
    const wrongId = freshId()
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ permRefs: [goodId, wrongId] })],
      refs: [
        permEvent({ id: goodId }),
        permEvent({ id: wrongId, subject: OTHER_KID }),
      ],
    })
    expect(res.construct).not.toBeNull()
    // Only the correctly-subjected permission becomes an entry.
    expect(res.construct!.entries).toHaveLength(1)
    expect(res.construct!.entries[0].sourceEventId).toBe(goodId)
  })
})

describe('assembleConstructFromRelay — KUBO-156 fail-closed deny-lists', () => {
  it('referenced-but-unfetched blacklist → fetch-failed, NO construct', async () => {
    const blId = freshId()
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ blacklistRef: blId })],
      refs: [], // blacklist withheld by the relay
    })
    expect(res.construct).toBeNull()
    expect(res.reason).toBe('fetch-failed')
  })

  it('forged (non-guardian) blacklist → fetch-failed, NO construct', async () => {
    const blId = freshId()
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ blacklistRef: blId })],
      refs: [blacklistEvent({ id: blId, guardian: STRANGER })],
    })
    expect(res.construct).toBeNull()
    expect(res.reason).toBe('fetch-failed')
  })

  it('bad-signature blacklist → fetch-failed, NO construct', async () => {
    const blId = freshId()
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ blacklistRef: blId })],
      refs: [blacklistEvent({ id: blId, sig: SIG_BAD })],
    })
    expect(res.construct).toBeNull()
    expect(res.reason).toBe('fetch-failed')
  })

  it('wrong-subject blacklist → fetch-failed, NO construct', async () => {
    const blId = freshId()
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ blacklistRef: blId })],
      refs: [blacklistEvent({ id: blId, subject: OTHER_KID })],
    })
    expect(res.construct).toBeNull()
    expect(res.reason).toBe('fetch-failed')
  })

  it('guardian-signed blacklist → assembled with the deny-list', async () => {
    const blId = freshId()
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ blacklistRef: blId })],
      refs: [blacklistEvent({ id: blId })],
    })
    expect(res.construct).not.toBeNull()
    expect(res.construct!.blacklist).toBeDefined()
  })

  it('referenced-but-unfetched global → fetch-failed, NO construct', async () => {
    const gId = freshId()
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ globalRef: gId })],
      refs: [],
    })
    expect(res.construct).toBeNull()
    expect(res.reason).toBe('fetch-failed')
  })

  it('forged global → fetch-failed, NO construct', async () => {
    const gId = freshId()
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ globalRef: gId })],
      refs: [globalEvent({ id: gId, guardian: STRANGER })],
    })
    expect(res.construct).toBeNull()
    expect(res.reason).toBe('fetch-failed')
  })

  it('guardian-signed global → assembled with the global restrictions', async () => {
    const gId = freshId()
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ globalRef: gId })],
      refs: [globalEvent({ id: gId })],
    })
    expect(res.construct).not.toBeNull()
    expect(res.construct!.global).toBeDefined()
  })

  it('missing PERMISSION (not a deny-list) stays fail-closed-per-entry, still assembles', async () => {
    const permId = freshId()
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ permRefs: [permId] })],
      refs: [], // permission withheld — narrows the kid's grants, not fatal
    })
    expect(res.construct).not.toBeNull()
    expect(res.construct!.entries).toHaveLength(0)
  })
})
