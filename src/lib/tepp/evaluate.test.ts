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
