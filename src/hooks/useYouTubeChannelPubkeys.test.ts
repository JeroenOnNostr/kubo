import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';

import {
  collectChannelPubkeys,
  excludeChannelPubkeys,
} from './useYouTubeChannelPubkeys';
import type { YouTubeChannelRef } from '@/hooks/useKuboFamily';

/**
 * KUBO-207 — the hook's React glue (useSyncExternalStore over the family store)
 * isn't unit-testable without renderHook, so per repo idiom we pin the pure
 * cores it delegates to: `collectChannelPubkeys` (npub → pubkey set) and
 * `excludeChannelPubkeys` (the "real Profiles" filter).
 */

const PERSON = 'a'.repeat(64); // a directly-followed person
const CHAN_1 = 'b'.repeat(64); // a YouTube channel's bridge pubkey
const CHAN_2 = 'c'.repeat(64); // another YouTube channel's bridge pubkey

function chanRef(hexPubkey: string, title: string): YouTubeChannelRef {
  return {
    npub: nip19.npubEncode(hexPubkey),
    channelId: `UC_${title}`,
    title,
  };
}

describe('collectChannelPubkeys', () => {
  it('decodes channel npubs to the hex pubkeys used in the follow list', () => {
    const set = collectChannelPubkeys([
      chanRef(CHAN_1, 'MrBeast'),
      chanRef(CHAN_2, 'Brew'),
    ]);
    expect(set.has(CHAN_1)).toBe(true);
    expect(set.has(CHAN_2)).toBe(true);
    expect(set.size).toBe(2);
  });

  it('returns an empty set for no channels', () => {
    expect(collectChannelPubkeys([]).size).toBe(0);
  });

  it('skips refs with an undecodable npub instead of throwing', () => {
    const set = collectChannelPubkeys([
      { npub: 'not-an-npub', channelId: 'UC_x', title: 'Broken' },
      chanRef(CHAN_1, 'MrBeast'),
    ]);
    expect(set.has(CHAN_1)).toBe(true);
    expect(set.size).toBe(1);
  });
});

describe('excludeChannelPubkeys (the Profiles filter)', () => {
  it('removes YouTube channels from the follow list — the core bug', () => {
    // Kid follows a person AND two channels (channels are followed so videos
    // flow). Profiles must show ONLY the person.
    const followed = [PERSON, CHAN_1, CHAN_2];
    const channels = collectChannelPubkeys([
      chanRef(CHAN_1, 'MrBeast'),
      chanRef(CHAN_2, 'Brew'),
    ]);
    expect(excludeChannelPubkeys(followed, channels)).toEqual([PERSON]);
  });

  it('still excludes a channel whose ref is disabled but follow lingers', () => {
    // A disabled channel keeps its persisted ref, so it stays recognised as a
    // channel and out of Profiles even if its kind-3 follow hasn't been dropped.
    const followed = [CHAN_1, PERSON];
    const channels = collectChannelPubkeys([chanRef(CHAN_1, 'MrBeast')]);
    expect(excludeChannelPubkeys(followed, channels)).toEqual([PERSON]);
  });

  it('is a no-op when no channels are followed', () => {
    const followed = [PERSON];
    expect(excludeChannelPubkeys(followed, new Set())).toEqual([PERSON]);
  });

  it('preserves follow order for the Following list', () => {
    const p2 = 'd'.repeat(64);
    const followed = [PERSON, CHAN_1, p2];
    const channels = collectChannelPubkeys([chanRef(CHAN_1, 'MrBeast')]);
    expect(excludeChannelPubkeys(followed, channels)).toEqual([PERSON, p2]);
  });
});
