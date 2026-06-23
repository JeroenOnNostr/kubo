import { describe, expect, it } from 'vitest';

import { composeBrowseRelays } from './useBrowseRelays';
import type { DiscoveredRelay } from '@/hooks/useRelayDiscovery';

/**
 * KUBO-211 — Trust → Places and Feed → Sources → Places share this browse-list
 * composition. The bug: Trust → Places listed ONLY the NIP-66 discovery
 * catalogue, so relays the monitor hadn't recently announced (e.g.
 * relay.damus.io) never surfaced — even though they live in APP_RELAYS and are
 * searchable under Feed → Places. composeBrowseRelays merges the baseline
 * (NIP-65 + APP_RELAYS) so both pages surface the same relays.
 */

const DAMUS = 'wss://relay.damus.io/';
const KUBO = 'wss://relay.kubo.watch/';
const DISCOVERED_ONLY = 'wss://relay.nostr.watch/';

function discovered(url: string): DiscoveredRelay {
  return { url, info: { name: `info:${url}` }, network: 'clearnet', monitoredAt: 1 };
}

describe('composeBrowseRelays', () => {
  it('surfaces a baseline relay (relay.damus.io) absent from discovery — the KUBO-211 fix', () => {
    const entries = composeBrowseRelays({
      query: 'damus',
      pastedUrl: null,
      discoveredRelays: [], // monitor did NOT announce relay.damus.io
      baselineRelays: [DAMUS, KUBO],
      excludeUrls: [],
    });
    expect(entries.map((e) => e.url)).toContain(DAMUS);
  });

  it('substring-filters the baseline by query', () => {
    const entries = composeBrowseRelays({
      query: 'damus',
      pastedUrl: null,
      discoveredRelays: [],
      baselineRelays: [DAMUS, KUBO],
      excludeUrls: [],
    });
    expect(entries.map((e) => e.url)).toEqual([DAMUS]); // kubo.watch filtered out
  });

  it('orders pasted URL first, then discovered (with inline info), then baseline', () => {
    const entries = composeBrowseRelays({
      query: '',
      pastedUrl: 'wss://pasted.example.com/',
      discoveredRelays: [discovered(DISCOVERED_ONLY)],
      baselineRelays: [DAMUS],
      excludeUrls: [],
    });
    expect(entries.map((e) => e.url)).toEqual([
      'wss://pasted.example.com/',
      DISCOVERED_ONLY,
      DAMUS,
    ]);
    // Discovered rows carry inline NIP-11; baseline rows do not.
    expect(entries.find((e) => e.url === DISCOVERED_ONLY)?.info).toBeDefined();
    expect(entries.find((e) => e.url === DAMUS)?.info).toBeUndefined();
  });

  it('excludes already-assigned/enabled relays so they render elsewhere', () => {
    const entries = composeBrowseRelays({
      query: '',
      pastedUrl: null,
      discoveredRelays: [discovered(DAMUS)],
      baselineRelays: [DAMUS, KUBO],
      excludeUrls: [DAMUS],
    });
    expect(entries.map((e) => e.url)).toEqual([KUBO]); // damus excluded both as discovered and baseline
  });

  it('dedupes a relay present in both discovered and baseline (discovered wins, keeps info)', () => {
    const entries = composeBrowseRelays({
      query: '',
      pastedUrl: null,
      discoveredRelays: [discovered(DAMUS)],
      baselineRelays: [DAMUS],
      excludeUrls: [],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe(DAMUS);
    expect(entries[0].info).toBeDefined(); // first-seen (discovered) wins, so inline info is kept
  });

  it('empty query returns the full baseline plus discovered', () => {
    const entries = composeBrowseRelays({
      query: '',
      pastedUrl: null,
      discoveredRelays: [discovered(DISCOVERED_ONLY)],
      baselineRelays: [DAMUS, KUBO],
      excludeUrls: [],
    });
    expect(entries.map((e) => e.url)).toEqual([DISCOVERED_ONLY, DAMUS, KUBO]);
  });
});
