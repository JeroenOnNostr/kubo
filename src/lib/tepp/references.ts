/**
 * Reference extraction per NIP §Reference extraction. Every referenceable
 * surface of an event is enumerated:
 *   - p/q tag pubkeys
 *   - e/q/a tag event references
 *   - r tag relays + relay hints on p/e tags
 *   - NIP-21 `nostr:` tokens in content (npub, nprofile, nevent, naddr)
 *   - bare bech32 in content at word boundaries
 *   - bare 64-char hex at word boundaries (ambiguous: pubkey or event id)
 *
 * The author-pubkey of any referenced event becomes a recursive reference
 * during evaluation, not at extraction time.
 */

import type { Event } from 'nostr-tools/core'
import * as nip19 from 'nostr-tools/nip19'

export type ReferenceSurface =
  | 'p-tag'
  | 'q-tag-pubkey'
  | 'e-tag'
  | 'q-tag-event'
  | 'a-tag-event'
  | 'a-tag-pubkey'
  | 'r-tag'
  | 'p-tag-relay-hint'
  | 'e-tag-relay-hint'
  | 'content:nostr:npub'
  | 'content:nostr:nprofile'
  | 'content:nostr:nevent'
  | 'content:nostr:naddr'
  | 'content:bare-bech32-npub'
  | 'content:bare-bech32-nprofile'
  | 'content:bare-bech32-nevent'
  | 'content:bare-bech32-naddr'
  | 'content:hex'
  | 'recursive:referenced-event-author'

export interface PubkeyReference {
  type: 'pubkey'
  pubkey: string // hex lowercase
  surface: ReferenceSurface
  raw: string
}

export interface EventReference {
  type: 'event'
  eventId: string // hex lowercase (or addressable a-tag value as raw)
  surface: ReferenceSurface
  raw: string
  addressable?: { kind: number; pubkey: string; identifier: string }
}

export interface RelayReference {
  type: 'relay'
  url: string
  surface: ReferenceSurface
  raw: string
}

/**
 * Hex-ambiguous: a 64-char hex string in content. Could be a pubkey or an
 * event id. The evaluator tries to admit it as either; if neither, denies
 * with reason `hex-string ...: not admitted as pubkey or event id`.
 */
export interface HexAmbiguousReference {
  type: 'hex-ambiguous'
  hex: string
  surface: ReferenceSurface
  raw: string
}

export type Reference = PubkeyReference | EventReference | RelayReference | HexAmbiguousReference

const HEX64 = /^[a-f0-9]{64}$/i
const BECH32_NPUB = /\bnpub1[02-9ac-hj-np-z]{50,}\b/g
const BECH32_NPROFILE = /\bnprofile1[02-9ac-hj-np-z]{50,}\b/g
const BECH32_NEVENT = /\bnevent1[02-9ac-hj-np-z]{50,}\b/g
const BECH32_NADDR = /\bnaddr1[02-9ac-hj-np-z]{50,}\b/g
const HEX_BARE = /\b[a-f0-9]{64}\b/g

/** Extract every reference of an event. Pure, deterministic. */
export function extractReferences(event: Event): Reference[] {
  const refs: Reference[] = []

  /* Tags ------------------------------------------------------------------ */

  for (const tag of event.tags) {
    const [name, v1, v2, v3] = tag
    if (name === 'p' && typeof v1 === 'string' && HEX64.test(v1)) {
      refs.push({ type: 'pubkey', pubkey: v1.toLowerCase(), surface: 'p-tag', raw: v1 })
      if (typeof v2 === 'string' && /^wss?:\/\//.test(v2)) {
        refs.push({ type: 'relay', url: v2, surface: 'p-tag-relay-hint', raw: v2 })
      }
    } else if (name === 'e' && typeof v1 === 'string' && HEX64.test(v1)) {
      refs.push({ type: 'event', eventId: v1.toLowerCase(), surface: 'e-tag', raw: v1 })
      if (typeof v2 === 'string' && /^wss?:\/\//.test(v2)) {
        refs.push({ type: 'relay', url: v2, surface: 'e-tag-relay-hint', raw: v2 })
      }
    } else if (name === 'q' && typeof v1 === 'string' && HEX64.test(v1)) {
      refs.push({ type: 'event', eventId: v1.toLowerCase(), surface: 'q-tag-event', raw: v1 })
      if (typeof v3 === 'string' && HEX64.test(v3)) {
        refs.push({ type: 'pubkey', pubkey: v3.toLowerCase(), surface: 'q-tag-pubkey', raw: v3 })
      }
    } else if (name === 'a' && typeof v1 === 'string') {
      const parts = v1.split(':')
      if (parts.length >= 3 && /^\d+$/.test(parts[0]) && HEX64.test(parts[1])) {
        refs.push({
          type: 'event',
          eventId: v1.toLowerCase(),
          surface: 'a-tag-event',
          raw: v1,
          addressable: {
            kind: Number(parts[0]),
            pubkey: parts[1].toLowerCase(),
            identifier: parts.slice(2).join(':'),
          },
        })
        refs.push({
          type: 'pubkey',
          pubkey: parts[1].toLowerCase(),
          surface: 'a-tag-pubkey',
          raw: parts[1],
        })
      }
    } else if (name === 'r' && typeof v1 === 'string' && /^wss?:\/\//.test(v1)) {
      refs.push({ type: 'relay', url: v1, surface: 'r-tag', raw: v1 })
    }
  }

  /* Content --------------------------------------------------------------- */

  const content = event.content || ''
  const claimedSpans: Array<[number, number]> = []

  // NIP-21 nostr: tokens
  const nostrTokenRe =
    /\bnostr:(npub1[02-9ac-hj-np-z]{50,}|nprofile1[02-9ac-hj-np-z]{50,}|nevent1[02-9ac-hj-np-z]{50,}|naddr1[02-9ac-hj-np-z]{50,})\b/g
  for (const m of content.matchAll(nostrTokenRe)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    claimedSpans.push([start, end])
    const bech = m[1]
    extractFromBech32(bech, m[0], 'nostr', refs)
  }

  // Bare bech32 forms (npub, nprofile, nevent, naddr) at word boundaries.
  // Skip any whose start overlaps an already-claimed nostr: token.
  function tryBareMatches(re: RegExp, kind: 'npub' | 'nprofile' | 'nevent' | 'naddr') {
    for (const m of content.matchAll(re)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (claimedSpans.some(([s, e]) => start >= s && end <= e)) continue
      claimedSpans.push([start, end])
      extractFromBech32(m[0], m[0], 'bare', refs, kind)
    }
  }
  tryBareMatches(BECH32_NPUB, 'npub')
  tryBareMatches(BECH32_NPROFILE, 'nprofile')
  tryBareMatches(BECH32_NEVENT, 'nevent')
  tryBareMatches(BECH32_NADDR, 'naddr')

  // Bare 64-char hex strings at word boundaries — ambiguous.
  for (const m of content.matchAll(HEX_BARE)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (claimedSpans.some(([s, e]) => start >= s && end <= e)) continue
    claimedSpans.push([start, end])
    refs.push({
      type: 'hex-ambiguous',
      hex: m[0].toLowerCase(),
      surface: 'content:hex',
      raw: m[0],
    })
  }

  return dedupeReferences(refs)
}

/* Helpers ----------------------------------------------------------------- */

function extractFromBech32(
  bech32: string,
  raw: string,
  origin: 'nostr' | 'bare',
  out: Reference[],
  hintKind?: 'npub' | 'nprofile' | 'nevent' | 'naddr',
) {
  let decoded
  try {
    decoded = nip19.decode(bech32)
  } catch {
    return
  }
  const surfacePrefix = origin === 'nostr' ? 'content:nostr' : 'content:bare-bech32'
  switch (decoded.type) {
    case 'npub': {
      out.push({
        type: 'pubkey',
        pubkey: decoded.data.toLowerCase(),
        surface: `${surfacePrefix}-npub` as ReferenceSurface,
        raw,
      })
      break
    }
    case 'nprofile': {
      out.push({
        type: 'pubkey',
        pubkey: decoded.data.pubkey.toLowerCase(),
        surface: `${surfacePrefix}-nprofile` as ReferenceSurface,
        raw,
      })
      for (const r of decoded.data.relays ?? []) {
        out.push({ type: 'relay', url: r, surface: 'p-tag-relay-hint', raw: r })
      }
      break
    }
    case 'nevent': {
      out.push({
        type: 'event',
        eventId: decoded.data.id.toLowerCase(),
        surface: `${surfacePrefix}-nevent` as ReferenceSurface,
        raw,
      })
      if (decoded.data.author) {
        out.push({
          type: 'pubkey',
          pubkey: decoded.data.author.toLowerCase(),
          surface: `${surfacePrefix}-nevent` as ReferenceSurface,
          raw,
        })
      }
      break
    }
    case 'naddr': {
      out.push({
        type: 'event',
        eventId: `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`,
        surface: `${surfacePrefix}-naddr` as ReferenceSurface,
        raw,
        addressable: {
          kind: decoded.data.kind,
          pubkey: decoded.data.pubkey.toLowerCase(),
          identifier: decoded.data.identifier,
        },
      })
      out.push({
        type: 'pubkey',
        pubkey: decoded.data.pubkey.toLowerCase(),
        surface: `${surfacePrefix}-naddr` as ReferenceSurface,
        raw,
      })
      break
    }
    default:
      void hintKind
  }
}

function dedupeReferences(refs: Reference[]): Reference[] {
  const seen = new Set<string>()
  const out: Reference[] = []
  for (const r of refs) {
    let key: string
    if (r.type === 'pubkey') key = `p:${r.pubkey}:${r.surface}`
    else if (r.type === 'event') key = `e:${r.eventId}:${r.surface}`
    else if (r.type === 'relay') key = `r:${r.url}:${r.surface}`
    else key = `h:${r.hex}:${r.surface}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

/** Test helper: list distinct pubkey hexes referenced. */
export function referencedPubkeys(refs: Reference[]): Set<string> {
  const out = new Set<string>()
  for (const r of refs) {
    if (r.type === 'pubkey') out.add(r.pubkey)
  }
  return out
}

/** Test helper: list distinct event ids referenced. */
export function referencedEventIds(refs: Reference[]): Set<string> {
  const out = new Set<string>()
  for (const r of refs) {
    if (r.type === 'event' && !r.addressable) out.add(r.eventId)
  }
  return out
}
