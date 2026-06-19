/**
 * YouTube bridge HTTP "fast lane" (Kubo side).
 *
 * The bridge exposes the same channel search/watch logic its DVM uses over plain
 * HTTPS (`GET /v1/search`, `POST /v1/watch`). Calling it directly skips the
 * DVM's ~3s poll-drain latency floor (the bridge runs on Cloudflare, where a
 * Durable Object can't hold a live relay subscription — see
 * nostr-youtube-bridge/src/dvm.ts). The DVM-over-Nostr path in `youtubeDvm.ts`
 * stays as the automatic fallback when this HTTP path is unreachable.
 *
 * These calls need no signer: the bridge resolves the channel and the per-channel
 * npub is deterministic. Watching still publishes the channel's kind:0/kind:21
 * events to relays on the bridge side; only the *request* moves to HTTPS.
 *
 * Result shapes mirror `youtubeDvm.ts` (SearchResult / WatchResult) so the page
 * and the HTTP-first wrapper stay type-compatible. On timeout/network failure we
 * throw `YouTubeDvmTimeoutError` so the caller falls back to the relay path.
 */

import { YOUTUBE_BRIDGE_BASE } from '@/lib/appRelays';
import {
  YouTubeDvmError,
  YouTubeDvmTimeoutError,
  type SearchResult,
  type WatchResult,
} from '@/lib/youtubeDvm';

/** Search times out fast — the bridge answers in well under this when reachable. */
const SEARCH_TIMEOUT_MS = 4_000;
/** Watch returns as soon as kind:0 is published (backfill is backgrounded). */
const WATCH_TIMEOUT_MS = 6_000;

/** Module-level results cache (normalized query → results). Mirrors the bridge's
 *  own 1h KV cache so re-typing / back-navigation is instant on the client too. */
const searchCache = new Map<string, SearchResult[]>();

function normalize(query: string): string {
  return query.trim().toLowerCase();
}

/** True when the bridge base URL is configured to a real host (not a placeholder). */
export function isBridgeHttpConfigured(): boolean {
  return /^https?:\/\//i.test(YOUTUBE_BRIDGE_BASE);
}

/**
 * Search channels over HTTPS. Returns the same `SearchResult[]` shape as the DVM
 * path. Throws `YouTubeDvmTimeoutError` on timeout/network error (so the caller
 * can fall back to the relay DVM) and `YouTubeDvmError` on a non-OK HTTP status.
 */
export async function httpSearch(query: string): Promise<SearchResult[]> {
  const key = normalize(query);
  const cached = searchCache.get(key);
  if (cached) return cached;

  let resp: Response;
  try {
    resp = await fetch(`${YOUTUBE_BRIDGE_BASE}/v1/search?q=${encodeURIComponent(query.trim())}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch {
    // Timeout / DNS / network — let the caller fall back to the relay DVM.
    throw new YouTubeDvmTimeoutError('search');
  }
  if (!resp.ok) {
    throw new YouTubeDvmError(`bridge search returned ${resp.status}`);
  }
  const data = (await resp.json()) as SearchResult[];
  const results = Array.isArray(data) ? data : [];
  searchCache.set(key, results);
  return results;
}

export interface HttpWatchOpts {
  channelId: string;
  backfillLong?: number;
  /** Raw search thumbnail, returned as the picture until the bridge rehosts it. */
  thumbnail?: string;
}

/**
 * Start watching a channel over HTTPS. Returns as soon as the bridge has enrolled
 * the channel (the kind:0 publish + video backfill run in the background on the
 * bridge); the returned `npub` is what the client follows. Throws
 * `YouTubeDvmTimeoutError` on timeout/network error, `YouTubeDvmError` on a
 * non-OK status (e.g. 400 unresolvable, 429 rate-limited).
 */
export async function httpWatch({ channelId, backfillLong, thumbnail }: HttpWatchOpts): Promise<WatchResult> {
  let resp: Response;
  try {
    resp = await fetch(`${YOUTUBE_BRIDGE_BASE}/v1/watch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ channelId, backfillLong, thumbnail }),
      signal: AbortSignal.timeout(WATCH_TIMEOUT_MS),
    });
  } catch {
    throw new YouTubeDvmTimeoutError('watch');
  }
  if (!resp.ok) {
    let message = `bridge watch returned ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* keep the status-code message */
    }
    throw new YouTubeDvmError(message);
  }
  return (await resp.json()) as WatchResult;
}
