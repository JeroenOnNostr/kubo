import { afterEach, describe, expect, it } from 'vitest';

import {
  appendTeppAuditEntry,
  clearTeppAuditLog,
  readTeppAuditLog,
} from './teppAuditLog';

afterEach(() => {
  clearTeppAuditLog();
});

describe('teppAuditLog', () => {
  it('appends and reads back entries in insertion order', () => {
    appendTeppAuditEntry({ kind: 17700, signerPubkey: 'kid', subjectPubkey: 'kid' });
    appendTeppAuditEntry({ kind: 34700, signerPubkey: 'parent', subjectPubkey: 'kid' });
    const entries = readTeppAuditLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toEqual(17700);
    expect(entries[1].kind).toEqual(34700);
  });

  it('records ts when not provided', () => {
    const before = Date.now();
    appendTeppAuditEntry({ kind: 8710, signerPubkey: 'parent' });
    const [entry] = readTeppAuditLog();
    expect(entry.ts).toBeGreaterThanOrEqual(before);
    expect(entry.ts).toBeLessThanOrEqual(Date.now() + 1);
  });

  it('clearTeppAuditLog drops all entries', () => {
    appendTeppAuditEntry({ kind: 1, signerPubkey: 'x' });
    expect(readTeppAuditLog()).toHaveLength(1);
    clearTeppAuditLog();
    expect(readTeppAuditLog()).toHaveLength(0);
  });
});
