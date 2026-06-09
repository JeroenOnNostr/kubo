import type { Construct } from '@/lib/tepp/types';

/**
 * Stable hash of a construct's identity for cache keying. Anything that
 * could alter an event's verdict goes into the hash:
 *  - subject pubkey
 *  - latest association event id
 *  - sorted permission/blacklist/global event ids referenced by the construct
 *
 * Returns a short string (32 hex chars from SHA-256 truncated). Cheap to
 * compute and stable across re-renders so `useMemo`/`Map` lookups dedupe.
 */
export async function constructFingerprint(c: Construct, assocEventId: string): Promise<string> {
  const sourceIds: string[] = [];
  for (const e of c.entries) sourceIds.push(e.sourceEventId);
  if (c.blacklist) sourceIds.push(c.blacklist.raw.id);
  if (c.global) sourceIds.push(c.global.raw.id);
  sourceIds.sort();
  const payload = [c.subject, assocEventId, ...sourceIds].join('|');

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < 16; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
  // Fallback for non-DOM/test environments — DJB2 hash of the payload.
  let h = 5381;
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) + h) ^ payload.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(16, '0');
}

/**
 * Synchronous fingerprint variant (DJB2). Used in hot paths and tests where
 * the async crypto.subtle call is overkill. Stable and deterministic per
 * payload; not cryptographically strong (we don't need it to be — the
 * construct ids it hashes are themselves event ids).
 */
export function constructFingerprintSync(c: Construct, assocEventId: string): string {
  const sourceIds: string[] = [];
  for (const e of c.entries) sourceIds.push(e.sourceEventId);
  if (c.blacklist) sourceIds.push(c.blacklist.raw.id);
  if (c.global) sourceIds.push(c.global.raw.id);
  sourceIds.sort();
  const payload = [c.subject, assocEventId, ...sourceIds].join('|');
  let h = 5381;
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) + h) ^ payload.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(16, '0');
}
