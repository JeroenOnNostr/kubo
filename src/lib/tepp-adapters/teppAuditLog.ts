/**
 * Append-only local log of every TEPP event signature event. Useful for
 * diagnosing "why was this signed under that identity." Capped at 500
 * entries with FIFO eviction; module-level singleton (not React state).
 *
 * Persistence: best-effort to localStorage. Survives page reloads but not
 * "Clear site data." Not synced to relays.
 */

const STORAGE_KEY = 'kubo:tepp:audit-log';
const CAP = 500;

export interface TeppAuditEntry {
  /** Unix-ms timestamp. */
  ts: number;
  /** Event kind that was signed. */
  kind: number;
  /** Pubkey that did the signing. */
  signerPubkey: string;
  /** TEPP subject pubkey (the kid the event refers to), if applicable. */
  subjectPubkey?: string;
  /** Event id of the signed event, if known. */
  eventId?: string;
  /** Optional human-readable note ("association rotation", "permission upsert", etc.). */
  note?: string;
}

let cache: TeppAuditEntry[] | null = null;

function load(): TeppAuditEntry[] {
  if (cache !== null) return cache;
  if (typeof localStorage === 'undefined') {
    cache = [];
    return cache;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = [];
      return cache;
    }
    const parsed = JSON.parse(raw) as TeppAuditEntry[];
    if (Array.isArray(parsed)) {
      cache = parsed.slice(-CAP);
      return cache;
    }
  } catch {
    // fall through to empty
  }
  cache = [];
  return cache;
}

function persist(entries: TeppAuditEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full or disabled — drop silently. Audit log is diagnostic.
  }
}

export function appendTeppAuditEntry(entry: Omit<TeppAuditEntry, 'ts'> & { ts?: number }): void {
  const entries = load();
  // Spread first, then default `ts` — otherwise a spread `entry` with an
  // undefined `ts` field clobbers the computed default back to undefined.
  const full: TeppAuditEntry = { ...entry, ts: entry.ts ?? Date.now() };
  entries.push(full);
  if (entries.length > CAP) entries.splice(0, entries.length - CAP);
  cache = entries;
  persist(entries);
}

export function readTeppAuditLog(): TeppAuditEntry[] {
  return load().slice();
}

export function clearTeppAuditLog(): void {
  cache = [];
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
