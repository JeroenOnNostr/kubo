import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools/core'
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify'

import {
  KIND_ASSOCIATION,
  KIND_STATE,
  KIND_PERMISSION_VIEW_NPUB_A,
} from '@/lib/tepp/kinds'

/**
 * KUBO-174 item 2 — construct adversarial gaps not already covered by
 * construct.test.ts / assembleConstructFromRelay.test.ts:
 *   (a) forged / non-guardian / bad-signature STATE is rejected (the existing
 *       suite covers wrong-SUBJECT state and forged deny-lists, but not a state
 *       signed by a non-guardian or with a broken signature).
 *   (b) flooding: a relay handing back many state candidates (the `limit: 50`
 *       firehose) still resolves to the single valid guardian-signed state, and
 *       a flood of forged states never admits one.
 *
 * Same idiom as assembleConstructFromRelay.test.ts: `verifyEvent` returns true
 * iff sig === all-`f`, so a test forges a signer or breaks a signature to opt a
 * candidate out of the picker's signature filter.
 */
vi.mock('nostr-tools/pure', () => ({
  verifyEvent: (ev: Event) => ev.sig === 'f'.repeat(128),
}))

const { assembleConstructFromRelay } = await import('./useConstruct')

const KID = 'a'.repeat(64)
const PARENT = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64)
const ALLOWED = 'e'.repeat(64)
const SIG_OK = 'f'.repeat(128)
const SIG_BAD = '0'.repeat(128)
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

function assocEvent(): NostrEvent {
  return evt({
    kind: KIND_ASSOCIATION,
    pubkey: KID,
    tags: [
      ['d', 'tepp-assoc'],
      ['subject', KID],
      ['guardian', PARENT],
      ['expiration', String(NOW + 365 * 24 * 60 * 60)],
    ],
  })
}

function stateEvent(opts: {
  pubkey?: string
  sig?: string
  createdAt?: number
  permRefs?: string[]
} = {}): NostrEvent {
  const tags: string[][] = [['d', KID], ['subject', KID]]
  for (const id of opts.permRefs ?? []) {
    tags.push(['permission', id, String(KIND_PERMISSION_VIEW_NPUB_A)])
  }
  return evt({
    kind: KIND_STATE,
    pubkey: opts.pubkey ?? PARENT,
    sig: opts.sig ?? SIG_OK,
    created_at: opts.createdAt ?? NOW,
    tags,
  })
}

function permEvent(id: string): NostrEvent {
  return evt({
    id,
    kind: KIND_PERMISSION_VIEW_NPUB_A,
    pubkey: PARENT,
    tags: [['subject', KID], ['p', ALLOWED]],
  })
}

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

describe('assembleConstructFromRelay — forged / non-guardian STATE', () => {
  it('rejects a state signed by a non-guardian stranger (no-state-event)', async () => {
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ pubkey: STRANGER })],
      refs: [],
    })
    expect(res.construct).toBeNull()
    expect(res.reason).toBe('no-state-event')
  })

  it('rejects a bad-signature state even when authored by the guardian (no-state-event)', async () => {
    const res = await run({
      assoc: [assocEvent()],
      state: [stateEvent({ sig: SIG_BAD })],
      refs: [],
    })
    expect(res.construct).toBeNull()
    expect(res.reason).toBe('no-state-event')
  })

  it('a newer forged state never clobbers an older valid guardian state', async () => {
    const permId = freshId()
    const forgedNewer = stateEvent({ pubkey: STRANGER, createdAt: NOW + 5000 })
    const validOlder = stateEvent({ createdAt: NOW - 5000, permRefs: [permId] })
    const res = await run({
      assoc: [assocEvent()],
      state: [forgedNewer, validOlder],
      refs: [permEvent(permId)],
    })
    // The forged newer state is filtered out by guardianship; the valid one governs.
    expect(res.construct).not.toBeNull()
    expect(res.construct!.entries).toHaveLength(1)
    expect(res.construct!.entries[0].sourceEventId).toBe(permId)
  })
})

describe('assembleConstructFromRelay — state flooding', () => {
  it('resolves the single valid state out of a flood of forged candidates', async () => {
    const permId = freshId()
    // 49 forged states (stranger-signed) + 1 valid — the relay firehose cap is 50.
    const flood: NostrEvent[] = []
    for (let i = 0; i < 49; i += 1) {
      flood.push(stateEvent({ pubkey: STRANGER, createdAt: NOW + 1000 + i }))
    }
    const valid = stateEvent({ createdAt: NOW, permRefs: [permId] })
    const res = await run({
      assoc: [assocEvent()],
      state: [...flood, valid],
      refs: [permEvent(permId)],
    })
    expect(res.construct).not.toBeNull()
    expect(res.construct!.entries[0].sourceEventId).toBe(permId)
  })

  it('a flood of ONLY forged states admits none (no-state-event)', async () => {
    const flood: NostrEvent[] = []
    for (let i = 0; i < 50; i += 1) {
      flood.push(stateEvent({ pubkey: STRANGER, createdAt: NOW + i }))
    }
    const res = await run({ assoc: [assocEvent()], state: flood, refs: [] })
    expect(res.construct).toBeNull()
    expect(res.reason).toBe('no-state-event')
  })

  it('with multiple VALID guardian states, the newest by created_at governs', async () => {
    const oldPerm = freshId()
    const newPerm = freshId()
    const older = stateEvent({ createdAt: NOW - 100, permRefs: [oldPerm] })
    const newer = stateEvent({ createdAt: NOW, permRefs: [newPerm] })
    const res = await run({
      assoc: [assocEvent()],
      state: [older, newer],
      refs: [permEvent(oldPerm), permEvent(newPerm)],
    })
    expect(res.construct).not.toBeNull()
    // Only the newest state's refs are honoured (replaceable semantics).
    expect(res.construct!.entries.map((e) => e.sourceEventId)).toEqual([newPerm])
  })
})
