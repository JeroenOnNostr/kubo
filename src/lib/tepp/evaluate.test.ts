import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools/core'

import { evaluateEvent } from './evaluate'
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_RELAY,
} from './kinds'
import type { Construct, ConstructEntry, ParsedBlacklist } from './types'

/**
 * Regression coverage for the KUBO-102 interact-gate fix.
 *
 * The bug: `evaluateEvent` only pushed the outer event's author as a reference
 * in the `incoming` direction, so an `outgoing` evaluation of a plain note by a
 * view-only author had zero references and defaulted to `permit-interaction` —
 * which made the kid-feed action bar show reply/react/repost/zap buttons for
 * view-only authors. The fix pushes the author in both directions; the
 * subject-self short-circuit keeps the write-gate (kid's own draft) unaffected.
 */

const KID = 'a'.repeat(64) // construct.subject — the kid
const INTERACT_AUTHOR = 'b'.repeat(64)
const VIEW_AUTHOR = 'c'.repeat(64)

function npubEntry(kind: number, pubkey: string): ConstructEntry {
  return {
    kind,
    sourceEventId: `${kind}-${pubkey.slice(0, 8)}`,
    source: 'direct',
    items: [{ pubkey }],
    restrictions: [],
    monitorRelays: [],
  }
}

function makeConstruct(entries: ConstructEntry[], blacklist?: ParsedBlacklist): Construct {
  return {
    subject: KID,
    guardians: ['9'.repeat(64)],
    entries,
    blacklist,
    extensionTraces: [],
    inertAuditFindings: [],
  }
}

function relayEntry(kind: number, urls: string[]): ConstructEntry {
  return {
    kind,
    sourceEventId: `${kind}-relay`,
    source: 'direct',
    items: urls,
    restrictions: [],
    monitorRelays: [],
  }
}

function blacklist(opts: { relays?: string[]; pubkeys?: string[] } = {}): ParsedBlacklist {
  return {
    raw: { id: 'b'.repeat(64) } as unknown as Event,
    guardian: '9'.repeat(64),
    blockedPubkeys: opts.pubkeys ?? [],
    blockedRelays: opts.relays ?? [],
    blockedEvents: [],
    signatureValid: true,
    parseProblems: [],
  }
}

/** Minimal note event of the shape the evaluator's reference walker expects. */
function note(author: string, tags: string[][] = [], content = ''): Event {
  return {
    id: '0'.repeat(64),
    sig: '0'.repeat(128),
    pubkey: author,
    kind: 1,
    content,
    tags,
    created_at: 1_700_000_000,
  } as unknown as Event
}

describe('evaluateEvent — author interact-gate (KUBO-102)', () => {
  it('outgoing: a plain note by a view-only author is denied (the regression)', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR),
    ])
    const verdict = evaluateEvent(note(VIEW_AUTHOR), construct, 'outgoing')
    expect(verdict.result).toBe('deny')
  })

  it('outgoing: a plain note by an interact author permits interaction', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, INTERACT_AUTHOR),
    ])
    const verdict = evaluateEvent(note(INTERACT_AUTHOR), construct, 'outgoing')
    expect(verdict.result).toBe('permit-interaction')
  })

  it('incoming: a view-only author note remains visible (visibility unchanged)', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR),
    ])
    const verdict = evaluateEvent(note(VIEW_AUTHOR), construct, 'incoming')
    expect(verdict.result).toBe('permit-view-only')
  })

  it('outgoing: subject-self note (the kid posting a plain note) permits', () => {
    const construct = makeConstruct([])
    const verdict = evaluateEvent(note(KID), construct, 'outgoing')
    expect(verdict.result).toBe('permit-interaction')
  })
})

describe('evaluateEvent — write-gate draft (kid replying)', () => {
  it("outgoing: kid's reply to an interact author is permitted", () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, INTERACT_AUTHOR),
    ])
    // The kid's draft reply: authored by KID (subject-self), p-tagging the
    // interact author and e-tagging their note.
    const parentId = 'd'.repeat(64)
    const draft = note(KID, [
      ['e', parentId, '', 'root', INTERACT_AUTHOR],
      ['p', INTERACT_AUTHOR],
    ])
    const eventCache = new Map<string, Event>([
      [parentId, note(INTERACT_AUTHOR)],
    ])
    const verdict = evaluateEvent(draft, construct, 'outgoing', { eventCache })
    expect(verdict.result).not.toBe('deny')
  })

  it("outgoing: kid's reply to a view-only author is denied via the p-tag", () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR),
    ])
    const parentId = 'e'.repeat(64)
    const draft = note(KID, [
      ['e', parentId, '', 'root', VIEW_AUTHOR],
      ['p', VIEW_AUTHOR],
    ])
    const eventCache = new Map<string, Event>([
      [parentId, note(VIEW_AUTHOR)],
    ])
    const verdict = evaluateEvent(draft, construct, 'outgoing', { eventCache })
    expect(verdict.result).toBe('deny')
  })
})

/**
 * KUBO-147: a kid's kind-3 follow list is a RECORD, not an interaction.
 * The gate (useKuboTeppGate) evaluates kind 3 at the VIEW threshold
 * (`'incoming'`), so the kid may follow anyone admitted at view-or-better.
 * Genuine interactions (kind 1/6/7) stay at the interaction threshold.
 *
 * These tests assert the evaluator behaviour the gate relies on; the gate's
 * kind→direction mapping is exercised separately.
 */
function followList(author: string, follows: string[]): Event {
  return {
    id: '0'.repeat(64),
    sig: '0'.repeat(128),
    pubkey: author,
    kind: 3,
    content: '',
    tags: follows.map((pk) => ['p', pk]),
    created_at: 1_700_000_000,
  } as unknown as Event
}

describe('evaluateEvent — kid follow list at view threshold (KUBO-147)', () => {
  it("incoming: kid's follow list p-tagging a view-only person is permitted", () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR),
    ])
    const verdict = evaluateEvent(followList(KID, [VIEW_AUTHOR]), construct, 'incoming')
    expect(verdict.result).not.toBe('deny')
  })

  it('incoming: a follow list mixing view + interact people is permitted', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR),
      npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, INTERACT_AUTHOR),
    ])
    const verdict = evaluateEvent(
      followList(KID, [VIEW_AUTHOR, INTERACT_AUTHOR]),
      construct,
      'incoming',
    )
    expect(verdict.result).not.toBe('deny')
  })

  it('incoming: following an entirely UNTRUSTED person is still denied', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR),
    ])
    const stranger = 'f'.repeat(64)
    const verdict = evaluateEvent(followList(KID, [stranger]), construct, 'incoming')
    expect(verdict.result).toBe('deny')
  })

  it("safety: the SAME view-only p-tag is denied for a kind-1 reply (outgoing)", () => {
    // Proves only the threshold differs — a real interaction with a view-only
    // person stays blocked even though the follow-list reference is allowed.
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR),
    ])
    const reply = note(KID, [['p', VIEW_AUTHOR]])
    expect(evaluateEvent(reply, construct, 'outgoing').result).toBe('deny')
  })
})

/**
 * KUBO-161: relay-hint references must not hard-deny.
 *
 * The seeded Kubo construct emits only npub-list permissions (no relay lists),
 * yet nearly every real note carries a relay hint on its p/e tags. Without this
 * fix, an admitted author's note hard-denies on the hint and the feed blanks.
 */
const DAMUS = 'wss://relay.damus.io'

describe('evaluateEvent — relay-hint over-deny (KUBO-161)', () => {
  it('incoming: admitted author + relay hint + zero relay lists → permit', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR),
    ])
    const ev = note(VIEW_AUTHOR, [['p', KID, DAMUS]])
    const verdict = evaluateEvent(ev, construct, 'incoming')
    expect(verdict.result).not.toBe('deny')
    expect(verdict.result).toBe('permit-view-only')
  })

  it('outgoing: subject reply + relay hint + zero relay lists → permit', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, INTERACT_AUTHOR),
    ])
    const ev = note(KID, [['p', INTERACT_AUTHOR, DAMUS]])
    const verdict = evaluateEvent(ev, construct, 'outgoing')
    expect(verdict.result).not.toBe('deny')
  })

  it('relay-blacklisted hint → deny even with zero relay permission lists', () => {
    const construct = makeConstruct(
      [npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR)],
      blacklist({ relays: [DAMUS] }),
    )
    const ev = note(VIEW_AUTHOR, [['p', KID, DAMUS]])
    expect(evaluateEvent(ev, construct, 'incoming').result).toBe('deny')
  })

  it('relay allow-list present + non-listed relay → incoming permit-with-redactions', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR),
      relayEntry(KIND_PERMISSION_VIEW_RELAY, ['wss://allowed.example']),
    ])
    const ev = note(VIEW_AUTHOR, [['p', KID, DAMUS]])
    const verdict = evaluateEvent(ev, construct, 'incoming')
    expect(verdict.result).toBe('permit-with-redactions')
  })

  it('relay allow-list present + non-listed relay → outgoing deny', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, INTERACT_AUTHOR),
      relayEntry(KIND_PERMISSION_VIEW_RELAY, ['wss://allowed.example']),
    ])
    // Outgoing draft by the kid referencing an interact author via a hint to a
    // non-listed relay.
    const ev = note(KID, [['p', INTERACT_AUTHOR, DAMUS]])
    expect(evaluateEvent(ev, construct, 'outgoing').result).toBe('deny')
  })
})

/**
 * KUBO-162: outgoing denies are never redactable.
 *
 * Verified bypass repro: a kid draft quoting a blocked note (the blocked note
 * present in cache) evaluated to `permit-with-redactions` and the write-gate
 * (which blocks only on `'deny'`) let it through — but you cannot redact an
 * event you are publishing. This turns the review's scratch repro into a
 * permanent test: outgoing → hard deny; the same input incoming → still
 * permit-with-redactions.
 */
describe('evaluateEvent — outgoing denies never redactable (KUBO-162)', () => {
  const STRANGER = 'f'.repeat(64) // unadmitted author of the blocked note
  const blockedId = '7'.repeat(64)

  function quoteOf(author: string): Event {
    // The kid's draft quote-posting the blocked note by its id.
    return note(author, [['q', blockedId]])
  }

  it('outgoing: kid quote of denied cached content → deny', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, INTERACT_AUTHOR),
    ])
    const eventCache = new Map<string, Event>([
      [blockedId, note(STRANGER)], // blocked: author not admitted
    ])
    const verdict = evaluateEvent(quoteOf(KID), construct, 'outgoing', { eventCache })
    expect(verdict.result).toBe('deny')
  })

  it('incoming: the SAME quote of denied cached content → permit-with-redactions', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR),
    ])
    const eventCache = new Map<string, Event>([
      [blockedId, note(STRANGER)],
    ])
    // Authored by an admitted (view-only) author so the outer admits, only the
    // nested quote denies → redactable on incoming.
    const verdict = evaluateEvent(quoteOf(VIEW_AUTHOR), construct, 'incoming', { eventCache })
    expect(verdict.result).toBe('permit-with-redactions')
  })
})

/**
 * KUBO-165: reference-extraction hardening at the evaluator boundary.
 *  - a random 64-hex (txid/commit hash) in a normal note must not hide the
 *    whole note → redactable on incoming.
 *  - an outgoing reply e-tagging an unadmitted author via index 4 is denied
 *    WITHOUT needing the parent event fetched.
 */
describe('evaluateEvent — extraction hardening (KUBO-165)', () => {
  it('incoming: a note with a random 64-hex txid stays visible (redactions allowed)', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_VIEW_NPUB_A, VIEW_AUTHOR),
    ])
    const txid = '3'.repeat(64) // not a known pubkey or event id
    const ev = note(VIEW_AUTHOR, [], `built from commit ${txid}`)
    const verdict = evaluateEvent(ev, construct, 'incoming')
    expect(verdict.result).toBe('permit-with-redactions')
  })

  it('outgoing: a note with a random 64-hex txid still hard-denies', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, INTERACT_AUTHOR),
    ])
    const txid = '3'.repeat(64)
    const ev = note(KID, [], `commit ${txid}`)
    expect(evaluateEvent(ev, construct, 'outgoing').result).toBe('deny')
  })

  it('outgoing: kid reply e-tagging an unadmitted author at index 4 → deny WITHOUT parent fetched', () => {
    const construct = makeConstruct([
      npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, INTERACT_AUTHOR),
    ])
    const stranger = 'f'.repeat(64) // unadmitted
    const parentId = 'e'.repeat(64)
    // No p-tag, parent NOT in cache — only the index-4 author guards this.
    const draft = note(KID, [['e', parentId, 'wss://relay.example', 'root', stranger]])
    const verdict = evaluateEvent(draft, construct, 'outgoing') // empty cache
    expect(verdict.result).toBe('deny')
  })
})
