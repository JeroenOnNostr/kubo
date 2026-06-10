import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools/core'

import { evaluateEvent } from './evaluate'
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_A,
} from './kinds'
import type { Construct, ConstructEntry } from './types'

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

function makeConstruct(entries: ConstructEntry[]): Construct {
  return {
    subject: KID,
    guardians: ['9'.repeat(64)],
    entries,
    extensionTraces: [],
    inertAuditFindings: [],
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
