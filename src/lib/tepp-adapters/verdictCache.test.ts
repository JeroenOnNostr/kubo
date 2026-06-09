import { afterEach, describe, expect, it } from 'vitest';

import {
  clearVerdictCache,
  getCachedVerdict,
  setCachedVerdict,
  verdictCacheSize,
} from './verdictCache';

afterEach(() => {
  clearVerdictCache();
});

describe('verdictCache', () => {
  it('round-trips a verdict by (fingerprint, eventId, direction)', () => {
    setCachedVerdict('fp1', 'event1', 'incoming', { visible: true });
    expect(getCachedVerdict('fp1', 'event1', 'incoming')).toEqual({ visible: true });
  });

  it('partitions by direction', () => {
    setCachedVerdict('fp', 'e', 'incoming', 'in');
    setCachedVerdict('fp', 'e', 'outgoing', 'out');
    expect(getCachedVerdict('fp', 'e', 'incoming')).toEqual('in');
    expect(getCachedVerdict('fp', 'e', 'outgoing')).toEqual('out');
  });

  it('partitions by fingerprint (rotating assoc invalidates)', () => {
    setCachedVerdict('fp1', 'e', 'incoming', 'old');
    setCachedVerdict('fp2', 'e', 'incoming', 'new');
    expect(getCachedVerdict('fp1', 'e', 'incoming')).toEqual('old');
    expect(getCachedVerdict('fp2', 'e', 'incoming')).toEqual('new');
  });

  it('returns undefined on miss', () => {
    expect(getCachedVerdict('nope', 'nope', 'incoming')).toBeUndefined();
  });

  it('LRU-touches on get so frequently-read entries survive eviction', () => {
    // Tiny smoke: insert two, read the older one, insert a third — both should still be present.
    setCachedVerdict('fp', 'a', 'incoming', 1);
    setCachedVerdict('fp', 'b', 'incoming', 2);
    expect(getCachedVerdict('fp', 'a', 'incoming')).toEqual(1); // touch
    setCachedVerdict('fp', 'c', 'incoming', 3);
    // Cache cap is 5000; this scenario only checks state, not eviction at cap.
    expect(verdictCacheSize()).toEqual(3);
  });
});
