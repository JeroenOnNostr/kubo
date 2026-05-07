/**
 * NIP-66 (Relay Discovery) constants. Used by useRelayDiscovery to fetch a
 * fresh global relay catalogue from monitor relays — replaces the broken
 * NIP-50 search-on-kind-10002 approach (relays don't index r-tags inside
 * relay-list events, so search returned 0 results).
 *
 * Monitor publishes kind 30166 events. The `d` tag is the relay URL,
 * `N` tags are supported NIPs, `n` tags carry the network (clearnet/tor/i2p),
 * and `content` is the full NIP-11 doc — so we get name/description/icon
 * inline without per-row HTTP fetches.
 */

export const NIP66_DISCOVERY_RELAYS = [
  'wss://relay.nostr.watch',
  'wss://monitorlizard.nostr1.com',
] as const;

// Trusted monitor pubkey — same seed nostrudel uses (operator of nostr.watch).
// Extend this list as more monitors come online.
export const NIP66_TRUSTED_MONITORS = [
  '9b85d54cc4bc886d60782f80d676e41bc637ed3ecc73d2bb5aabadc499d6a340',
] as const;

export const NIP66_KIND = 30166;
export const NIP66_MAX_AGE_SEC = 86400; // 24h
export const NIP66_FETCH_LIMIT = 1000;  // measured: ~1.2s EOSE, ~1.8MB; 2000+ times out
