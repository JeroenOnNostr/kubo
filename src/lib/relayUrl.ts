/**
 * Normalizes a relay URL for dedup / equality comparisons. Accepts bare
 * hostnames (adds `wss://`), lowercases the hostname, strips trailing
 * slashes. Returns null for anything that isn't a valid ws/wss URL.
 */
export function normalizeRelayUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return null;
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/+$/, '/');
  } catch {
    return null;
  }
}

/** Returns host+path (without scheme / trailing slash) for compact display. */
export function relayHostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname);
  } catch {
    return url;
  }
}
