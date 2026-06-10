import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools/core'
import * as nip19 from 'nostr-tools/nip19'

import { extractReferences, referencedEventIds, referencedPubkeys } from './references'

/**
 * KUBO-174 item 6 — the reference-extraction "smuggling corpus". These tests
 * DOCUMENT current behaviour (no production change): what `extractReferences`
 * catches and — equally important — the known limits it does NOT catch, so a
 * future change that alters either is caught here. Comments mark each known
 * limit (see the plan's "Known-accepted limitations": URL-embedded ids).
 */

const PUBKEY_A = 'a'.repeat(63) + '1'
const PUBKEY_B = 'b'.repeat(63) + '2'
const EVENT_A = 'c'.repeat(63) + '3'
const EVENT_B = 'd'.repeat(63) + '4'

const npubA = nip19.npubEncode(PUBKEY_A)
const neventA = nip19.neventEncode({ id: EVENT_A })
const neventWithAuthor = nip19.neventEncode({ id: EVENT_B, author: PUBKEY_B })
const naddr = nip19.naddrEncode({ kind: 30023, pubkey: PUBKEY_A, identifier: 'my-article' })

function note(tags: string[][] = [], content = ''): Event {
  return {
    id: '0'.repeat(64),
    sig: '0'.repeat(128),
    pubkey: 'e'.repeat(64),
    kind: 1,
    content,
    tags,
    created_at: 1_700_000_000,
  } as unknown as Event
}

describe('smuggling corpus — nested quotes', () => {
  it('a q-tag with the quoted author at index 3 extracts BOTH the event and its author', () => {
    const refs = extractReferences(note([['q', EVENT_A, 'wss://r.example', PUBKEY_B]]))
    expect(referencedEventIds(refs).has(EVENT_A)).toBe(true)
    expect(referencedPubkeys(refs).has(PUBKEY_B)).toBe(true)
  })

  it('a nevent in content carrying an author extracts both the event id and the author', () => {
    const refs = extractReferences(note([], `check this nostr:${neventWithAuthor}`))
    expect(referencedEventIds(refs).has(EVENT_B)).toBe(true)
    // The embedded author is harvested so a quoted denied author can be gated
    // without fetching the quoted event.
    expect(referencedPubkeys(refs).has(PUBKEY_B)).toBe(true)
  })

  it('a bare nevent (no nostr: prefix) at a word boundary is still extracted', () => {
    const refs = extractReferences(note([], `look ${neventA} ok`))
    expect(referencedEventIds(refs).has(EVENT_A)).toBe(true)
  })
})

describe('smuggling corpus — naddr', () => {
  it('an naddr in content extracts the addressable pubkey (author) as a pubkey reference', () => {
    const refs = extractReferences(note([], `read nostr:${naddr}`))
    // Addressable a-tag-style events are not surfaced via referencedEventIds
    // (that helper skips addressable), but the author pubkey IS extracted so a
    // denied author's long-form post can be gated.
    expect(referencedPubkeys(refs).has(PUBKEY_A)).toBe(true)
  })

  it('an a-tag (kind:pubkey:identifier) extracts the author pubkey', () => {
    const refs = extractReferences(note([['a', `30023:${PUBKEY_A}:my-article`]]))
    expect(referencedPubkeys(refs).has(PUBKEY_A)).toBe(true)
  })
})

describe('smuggling corpus — case folding', () => {
  it('an uppercase NOSTR:NPUB token extracts the same pubkey as lowercase', () => {
    const refs = extractReferences(note([], `NOSTR:${npubA.toUpperCase()}`))
    expect(referencedPubkeys(refs).has(PUBKEY_A)).toBe(true)
  })
})

describe('smuggling corpus — KNOWN LIMITS (documented, not fixed)', () => {
  it('SURPRISE (documented): an npub after a `?ref=` URL query boundary IS extracted', () => {
    // The `=` is a regex word boundary, so a bech32 token after `?ref=` still
    // matches `\bnpub1…\b` and IS harvested. The documented "URL-embedded ids
    // not extracted" limit is therefore NARROWER than "anything inside a URL":
    // it only bites when no word boundary precedes the token (next case).
    const refs = extractReferences(note([], `https://evil.example/page?ref=${npubA}`))
    expect(referencedPubkeys(refs).has(PUBKEY_A)).toBe(true)
  })

  it('KNOWN LIMIT: an npub glued to a preceding word char (no boundary) is NOT extracted', () => {
    // `xnpub1…` — the leading `x` means there is no `\b` before `npub1`, so the
    // token is not matched. This is the real shape of the URL/media-target gap:
    // bech32/hex with no separating boundary slips through (fail-open). Full
    // URL-content extraction is an upstream design change (plan known-limit).
    const refs = extractReferences(note([], `https://evil.example/x${npubA}`))
    expect(referencedPubkeys(refs).has(PUBKEY_A)).toBe(false)
  })

  it('SURPRISE (documented): a 64-hex id in a `/media/<hex>.jpg` path IS extracted (as hex-ambiguous)', () => {
    // `/` before and `.` after the 64-hex are both word boundaries, so the bare
    // 64-hex IS matched — but as a `hex-ambiguous` reference (could be a pubkey
    // OR an event id), which `referencedEventIds` (event-only) does NOT count.
    // The id therefore IS gated by the evaluator (tried as both pubkey & event),
    // contrary to the naive "media-target ids leak" assumption.
    const refs = extractReferences(note([], `https://cdn.example/media/${EVENT_A}.jpg`))
    expect(referencedEventIds(refs).has(EVENT_A)).toBe(false) // not counted as an *event* ref
    expect(refs.some((r) => r.type === 'hex-ambiguous' && r.raw.toLowerCase() === EVENT_A)).toBe(true)
  })

  it('KNOWN LIMIT: a 64-hex glued to surrounding word chars (no boundary) is NOT extracted', () => {
    // `media${EVENT_A}123` — letters/digits flush against the hex on both sides
    // mean no `\b`, so the would-be id slips through (fail-open). This is the
    // genuine URL/path smuggling gap.
    const refs = extractReferences(note([], `https://cdn.example/media${EVENT_A}123`))
    expect(refs.some((r) => r.type === 'hex-ambiguous' && r.raw.toLowerCase().includes(EVENT_A))).toBe(false)
  })

  it('CONTRAST: the same npub standing alone in content IS extracted', () => {
    // Proves the limit above is about the URL embedding, not the token itself.
    const refs = extractReferences(note([], `follow ${npubA} please`))
    expect(referencedPubkeys(refs).has(PUBKEY_A)).toBe(true)
  })
})
