import { describe, it, expect, vi } from 'vitest';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import type {
  NostrRelayEVENT,
  NostrRelayEOSE,
  NostrRelayCLOSED,
} from '@nostrify/types';
import { searchQuery } from './searchQuery';

type ReqMsg = NostrRelayEVENT | NostrRelayEOSE | NostrRelayCLOSED;

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    kind: 0,
    pubkey: 'pk0',
    created_at: 1000,
    content: '',
    tags: [],
    sig: 'sig',
    ...overrides,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Build a fake `ReqCapable` whose `req` replays a scripted sequence of messages,
 * mirroring NPool's contract: it yields EVENTs as they arrive across relays and
 * a SINGLE EOSE only once every routed relay has EOSEd (so the consumer should
 * keep reading until that combined EOSE). `delays` lets us interleave a slow
 * relay's event after the fast relay would have EOSEd.
 */
function fakeNostr(
  script: Array<{ msg: ReqMsg; delayBefore?: number }>,
  capture?: { opts?: { signal?: AbortSignal; eoseTimeout?: number }; filters?: NostrFilter[] },
) {
  return {
    req(
      filters: NostrFilter[],
      opts?: { signal?: AbortSignal; eoseTimeout?: number },
    ): AsyncIterable<ReqMsg> {
      if (capture) {
        capture.opts = opts;
        capture.filters = filters;
      }
      return (async function* () {
        for (const step of script) {
          if (step.delayBefore) await sleep(step.delayBefore);
          if (opts?.signal?.aborted) return; // model abort honouring
          yield step.msg;
        }
      })();
    },
  };
}

describe('searchQuery', () => {
  it('includes a slow relay match that arrives after the first relay would EOSE', async () => {
    // This is the exact KUBO-194 regression: a 300ms eoseTimeout (what query()
    // uses) would have aborted before the slow relay's match. Because NPool only
    // yields the combined EOSE at the very end, the helper must keep reading.
    const fast = makeEvent({ id: 'fast', pubkey: 'pkFast' });
    const slow = makeEvent({ id: 'slow', pubkey: 'pkSlow' });

    const nostr = fakeNostr([
      { msg: ['EVENT', 'sub', fast] },
      // ~longer than the old 300ms truncation, shorter than our 2500ms grace
      { msg: ['EVENT', 'sub', slow], delayBefore: 350 },
      { msg: ['EOSE', 'sub'] },
    ]);

    const result = await searchQuery(nostr, [{ kinds: [0], search: 'x' }]);

    const ids = result.map((e) => e.id).sort();
    expect(ids).toEqual(['fast', 'slow']);
  });

  it('keeps only the latest version of a replaceable (kind 0) event per pubkey', async () => {
    const older = makeEvent({ id: 'older', pubkey: 'pkA', created_at: 1000 });
    const newer = makeEvent({ id: 'newer', pubkey: 'pkA', created_at: 2000 });

    const nostr = fakeNostr([
      { msg: ['EVENT', 'sub', older] },
      { msg: ['EVENT', 'sub', newer] },
      { msg: ['EOSE', 'sub'] },
    ]);

    const result = await searchQuery(nostr, [{ kinds: [0], search: 'x' }]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('newer');
  });

  it('dedupes addressable (30000-39999) events by kind:pubkey:d-tag, keeping latest', async () => {
    const older = makeEvent({ id: 'a1', kind: 34550, pubkey: 'pkA', created_at: 1, tags: [['d', 'g']] });
    const newer = makeEvent({ id: 'a2', kind: 34550, pubkey: 'pkA', created_at: 2, tags: [['d', 'g']] });
    const other = makeEvent({ id: 'b1', kind: 34550, pubkey: 'pkA', created_at: 5, tags: [['d', 'h']] });

    const nostr = fakeNostr([
      { msg: ['EVENT', 'sub', older] },
      { msg: ['EVENT', 'sub', newer] },
      { msg: ['EVENT', 'sub', other] },
      { msg: ['EOSE', 'sub'] },
    ]);

    const result = await searchQuery(nostr, [{ kinds: [34550], search: 'x' }]);
    const ids = result.map((e) => e.id).sort();
    expect(ids).toEqual(['a2', 'b1']);
  });

  it('returns partial results and does not throw on an already-aborted signal', async () => {
    const ev = makeEvent({ id: 'one', pubkey: 'pkA' });
    const nostr = fakeNostr([
      { msg: ['EVENT', 'sub', ev] },
      { msg: ['EVENT', 'sub', makeEvent({ id: 'two', pubkey: 'pkB' })], delayBefore: 50 },
      { msg: ['EOSE', 'sub'] },
    ]);

    const controller = new AbortController();
    controller.abort();

    const result = await searchQuery(nostr, [{ kinds: [0], search: 'x' }], {
      signal: controller.signal,
    });
    // Aborted before/at first yield → empty, but never throws.
    expect(Array.isArray(result)).toBe(true);
  });

  it('stops at CLOSED and returns what arrived', async () => {
    const ev = makeEvent({ id: 'one', pubkey: 'pkA' });
    const nostr = fakeNostr([
      { msg: ['EVENT', 'sub', ev] },
      { msg: ['CLOSED', 'sub', 'rate-limited'] },
      { msg: ['EVENT', 'sub', makeEvent({ id: 'after', pubkey: 'pkB' })] },
    ]);

    const result = await searchQuery(nostr, [{ kinds: [0], search: 'x' }]);
    expect(result.map((e) => e.id)).toEqual(['one']);
  });

  it('passes a search-appropriate eoseTimeout through to req (not the 300ms global)', async () => {
    const capture: { opts?: { signal?: AbortSignal; eoseTimeout?: number } } = {};
    const nostr = fakeNostr([{ msg: ['EOSE', 'sub'] }], capture);

    await searchQuery(nostr, [{ kinds: [0], search: 'x' }]);
    expect(capture.opts?.eoseTimeout).toBe(2500);

    await searchQuery(nostr, [{ kinds: [0], search: 'x' }], { eoseTimeout: 1500 });
    expect(capture.opts?.eoseTimeout).toBe(1500);
  });

  it('forwards a composed AbortSignal to req', async () => {
    const capture: { opts?: { signal?: AbortSignal; eoseTimeout?: number } } = {};
    const nostr = fakeNostr([{ msg: ['EOSE', 'sub'] }], capture);

    const outer = new AbortController();
    await searchQuery(nostr, [{ kinds: [0], search: 'x' }], { signal: outer.signal });
    expect(capture.opts?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not throw when req itself rejects mid-iteration', async () => {
    const nostr = {
      req(): AsyncIterable<ReqMsg> {
        return (async function* () {
          yield ['EVENT', 'sub', makeEvent({ id: 'one', pubkey: 'pkA' })] as ReqMsg;
          throw new Error('relay exploded');
        })();
      },
    };
    const spy = vi.fn();
    const result = await searchQuery(nostr, [{ kinds: [0], search: 'x' }]).catch(spy);
    expect(spy).not.toHaveBeenCalled();
    expect((result as NostrEvent[]).map((e) => e.id)).toEqual(['one']);
  });
});
