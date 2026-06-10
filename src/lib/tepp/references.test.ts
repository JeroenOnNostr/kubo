import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools/core'
import * as nip19 from 'nostr-tools/nip19'

import { extractReferences, referencedEventIds, referencedPubkeys } from './references'

/**
 * KUBO-165: reference-extraction hardening.
 *
 * Confirmed false negatives (unextracted = un-deniable = fail-open):
 *  1. content regexes were lowercase-only — `NOSTR:NPUB1…`, all-caps bare
 *     bech32, and all-caps 64-hex extracted NOTHING (bech32 is case-insensitive
 *     per BIP-173).
 *  2. NIP-10 marked `e`-tags carry the parent author at index 4; it was never
 *     extracted, so a reply omitting the p-tag relied on fetch-dependent
 *     recursion that fails open on `pending`.
 */

const PUBKEY = 'a'.repeat(63) + '1' // hex pubkey
const EVENTID = 'b'.repeat(63) + '2'

const npub = nip19.npubEncode(PUBKEY)
const nevent = nip19.neventEncode({ id: EVENTID })

function note(tags: string[][] = [], content = ''): Event {
  return {
    id: '0'.repeat(64),
    sig: '0'.repeat(128),
    pubkey: 'd'.repeat(64),
    kind: 1,
    content,
    tags,
    created_at: 1_700_000_000,
  } as unknown as Event
}

describe('extractReferences — case-insensitivity (KUBO-165)', () => {
  it('uppercase NOSTR:NPUB1… extracts the same pubkey as lowercase', () => {
    const lower = referencedPubkeys(extractReferences(note([], `hi nostr:${npub} bye`)))
    const upper = referencedPubkeys(
      extractReferences(note([], `hi NOSTR:${npub.toUpperCase()} bye`)),
    )
    expect(lower.has(PUBKEY)).toBe(true)
    expect(upper).toEqual(lower)
  })

  it('uppercase bare bech32 npub extracts the same pubkey as lowercase', () => {
    const lower = referencedPubkeys(extractReferences(note([], npub)))
    const upper = referencedPubkeys(extractReferences(note([], npub.toUpperCase())))
    expect(lower.has(PUBKEY)).toBe(true)
    expect(upper).toEqual(lower)
  })

  it('uppercase bare bech32 nevent extracts the same event id as lowercase', () => {
    const lower = referencedEventIds(extractReferences(note([], nevent)))
    const upper = referencedEventIds(extractReferences(note([], nevent.toUpperCase())))
    expect(lower.has(EVENTID)).toBe(true)
    expect(upper).toEqual(lower)
  })

  it('uppercase bare 64-hex is extracted as a hex-ambiguous reference', () => {
    const HEX = 'c'.repeat(64)
    const refs = extractReferences(note([], HEX.toUpperCase()))
    const hexRefs = refs.filter((r) => r.type === 'hex-ambiguous')
    expect(hexRefs).toHaveLength(1)
    // hex is normalised to lowercase regardless of input case.
    expect(hexRefs[0].type === 'hex-ambiguous' && hexRefs[0].hex).toBe(HEX)
  })
})

describe('extractReferences — NIP-10 e-tag index-4 author (KUBO-165)', () => {
  it('extracts the author pubkey at index 4 of a marked e-tag', () => {
    const parentId = '5'.repeat(64)
    const author = '6'.repeat(64)
    const refs = extractReferences(
      note([['e', parentId, 'wss://relay.example', 'root', author]]),
    )
    const pubkeys = referencedPubkeys(refs)
    expect(pubkeys.has(author)).toBe(true)
    expect(referencedEventIds(refs).has(parentId)).toBe(true)
  })

  it('does not push a pubkey when index 4 is absent', () => {
    const parentId = '5'.repeat(64)
    const refs = extractReferences(note([['e', parentId, '', 'root']]))
    expect(referencedPubkeys(refs).size).toBe(0)
  })

  it('does not push a pubkey when index 4 is not 64-hex', () => {
    const parentId = '5'.repeat(64)
    const refs = extractReferences(note([['e', parentId, '', 'root', 'not-a-pubkey']]))
    expect(referencedPubkeys(refs).size).toBe(0)
  })
})
