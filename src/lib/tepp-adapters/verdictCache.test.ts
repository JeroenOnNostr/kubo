import { afterEach, describe, expect, it } from 'vitest';

import {
  clearVerdictCache,
  constructHasTimedRestrictions,
  getCachedVerdict,
  setCachedVerdict,
  timeBucketedFingerprint,
  verdictCacheSize,
  VERDICT_TIME_BUCKET_MS,
} from './verdictCache';
import type { Construct, ConstructEntry, RestrictionTag } from '@/lib/tepp/types';

afterEach(() => {
  clearVerdictCache();
});

function restriction(partial: Partial<RestrictionTag>): RestrictionTag {
  return {
    polarity: 'allow',
    kindList: 'any',
    weekdays: 'any',
    timeRange: 'any',
    raw: ['restriction'],
    ...partial,
  };
}

function makeConstruct(opts: {
  globalRestrictions?: RestrictionTag[];
  entryRestrictions?: RestrictionTag[];
  harvestedRestrictions?: RestrictionTag[];
} = {}): Construct {
  const entry: ConstructEntry = {
    kind: 8712,
    sourceEventId: 'src',
    source: 'direct',
    items: [],
    restrictions: opts.entryRestrictions ?? [],
    monitorRelays: [],
    harvestedRestrictions: opts.harvestedRestrictions,
  };
  const global = opts.globalRestrictions
    ? ({
        raw: {} as never,
        guardian: 'parent',
        restrictions: opts.globalRestrictions,
        signatureValid: true,
        parseProblems: [],
      } as unknown as NonNullable<Construct['global']>)
    : undefined;
  return {
    subject: 'kid',
    guardians: ['parent'],
    global,
    entries: [entry],
    extensionTraces: [],
    inertAuditFindings: [],
  };
}

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

describe('constructHasTimedRestrictions (KUBO-175)', () => {
  it('false when no restrictions are timed', () => {
    expect(constructHasTimedRestrictions(makeConstruct())).toBe(false);
    expect(
      constructHasTimedRestrictions(
        makeConstruct({ entryRestrictions: [restriction({ kindList: [1] })] }),
      ),
    ).toBe(false);
  });

  it('true for a time-range restriction on the global', () => {
    const c = makeConstruct({
      globalRestrictions: [restriction({ timeRange: { startMinutes: 960, endMinutes: 1080 } })],
    });
    expect(constructHasTimedRestrictions(c)).toBe(true);
  });

  it('true for a weekday restriction on an entry', () => {
    const c = makeConstruct({ entryRestrictions: [restriction({ weekdays: [1, 2, 3] })] });
    expect(constructHasTimedRestrictions(c)).toBe(true);
  });

  it('true for a timed harvested restriction', () => {
    const c = makeConstruct({
      harvestedRestrictions: [restriction({ timeRange: { startMinutes: 0, endMinutes: 60 } })],
    });
    expect(constructHasTimedRestrictions(c)).toBe(true);
  });
});

describe('timeBucketedFingerprint (KUBO-175)', () => {
  it('returns the fingerprint unchanged when no timed restriction exists', () => {
    const c = makeConstruct();
    expect(timeBucketedFingerprint('fp', c, 0)).toEqual('fp');
    expect(timeBucketedFingerprint('fp', c, 999_999_999)).toEqual('fp');
  });

  it('appends a 15-min bucket suffix when a timed restriction exists', () => {
    const c = makeConstruct({
      globalRestrictions: [restriction({ timeRange: { startMinutes: 960, endMinutes: 1080 } })],
    });
    const t = 5 * VERDICT_TIME_BUCKET_MS + 1234; // bucket 5
    expect(timeBucketedFingerprint('fp', c, t)).toEqual('fp@t5');
  });

  it('keeps the same key within a bucket and changes across buckets', () => {
    const c = makeConstruct({ entryRestrictions: [restriction({ weekdays: [1] })] });
    const inBucketA1 = timeBucketedFingerprint('fp', c, 0);
    const inBucketA2 = timeBucketedFingerprint('fp', c, VERDICT_TIME_BUCKET_MS - 1);
    const inBucketB = timeBucketedFingerprint('fp', c, VERDICT_TIME_BUCKET_MS);
    expect(inBucketA1).toEqual(inBucketA2);
    expect(inBucketA1).not.toEqual(inBucketB);
  });

  it('a verdict cached in one window is not served in the next (integration)', () => {
    const c = makeConstruct({
      globalRestrictions: [restriction({ timeRange: { startMinutes: 960, endMinutes: 1080 } })],
    });
    const t1 = 0;
    const t2 = VERDICT_TIME_BUCKET_MS; // next bucket
    setCachedVerdict(timeBucketedFingerprint('fp', c, t1), 'e', 'incoming', 'permit-at-1');
    expect(getCachedVerdict(timeBucketedFingerprint('fp', c, t1), 'e', 'incoming')).toEqual('permit-at-1');
    // Next bucket → cache miss, forcing a re-evaluation against the new clock.
    expect(getCachedVerdict(timeBucketedFingerprint('fp', c, t2), 'e', 'incoming')).toBeUndefined();
  });
});
