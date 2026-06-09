import { describe, expect, it } from 'vitest';

import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_RELAY,
} from '@/lib/tepp/kinds';
import type { Construct, ConstructEntry, ParsedBlacklist } from '@/lib/tepp/types';

import { getTeppAllowedAuthors } from './allowedAuthors';

const KID = 'a'.repeat(64);
const VIEW_A = 'b'.repeat(64);
const VIEW_B = 'c'.repeat(64);
const INTERACT = 'd'.repeat(64);
const BLOCKED = 'e'.repeat(64);

function npubEntry(kind: number, pubkeys: string[]): ConstructEntry {
  return {
    kind,
    sourceEventId: `${kind}`,
    source: 'direct',
    items: pubkeys.map((pubkey) => ({ pubkey })),
    restrictions: [],
    monitorRelays: [],
  };
}

function construct(entries: ConstructEntry[], blacklist?: ParsedBlacklist): Construct {
  return {
    subject: KID,
    guardians: ['9'.repeat(64)],
    entries,
    blacklist,
    extensionTraces: [],
    inertAuditFindings: [],
  };
}

describe('getTeppAllowedAuthors', () => {
  it('always includes the subject (kid sees their own posts)', () => {
    const authors = getTeppAllowedAuthors(construct([]));
    expect(authors).toEqual([KID]);
  });

  it('unions view + interact npub entries with the subject', () => {
    const authors = getTeppAllowedAuthors(
      construct([
        npubEntry(KIND_PERMISSION_VIEW_NPUB_A, [VIEW_A, VIEW_B]),
        npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, [INTERACT]),
      ]),
    );
    expect(new Set(authors)).toEqual(new Set([KID, VIEW_A, VIEW_B, INTERACT]));
  });

  it('ignores relay-list (and other non-npub) permission entries', () => {
    const relayEntry: ConstructEntry = {
      kind: KIND_PERMISSION_VIEW_RELAY,
      sourceEventId: 'r',
      source: 'direct',
      items: ['wss://relay.example'],
      restrictions: [],
      monitorRelays: [],
    };
    const authors = getTeppAllowedAuthors(
      construct([relayEntry, npubEntry(KIND_PERMISSION_VIEW_NPUB_A, [VIEW_A])]),
    );
    expect(new Set(authors)).toEqual(new Set([KID, VIEW_A]));
  });

  it('removes blacklisted pubkeys even if they were view-listed', () => {
    const blacklist: ParsedBlacklist = {
      raw: { id: 'bl' } as ParsedBlacklist['raw'],
      guardian: '9'.repeat(64),
      blockedPubkeys: [BLOCKED],
      blockedRelays: [],
      blockedEvents: [],
      signatureValid: true,
      parseProblems: [],
    };
    const authors = getTeppAllowedAuthors(
      construct([npubEntry(KIND_PERMISSION_VIEW_NPUB_A, [VIEW_A, BLOCKED])], blacklist),
    );
    expect(new Set(authors)).toEqual(new Set([KID, VIEW_A]));
    expect(authors).not.toContain(BLOCKED);
  });

  it('lowercases pubkeys', () => {
    const upper = 'F'.repeat(64);
    const authors = getTeppAllowedAuthors(
      construct([npubEntry(KIND_PERMISSION_VIEW_NPUB_A, [upper])]),
    );
    expect(authors).toContain('f'.repeat(64));
  });
});
