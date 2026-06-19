import { describe, it, expect } from 'vitest';
import { NPool } from '@nostrify/nostrify';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import type {
  NostrRelayEVENT,
  NostrRelayEOSE,
  NostrRelayCLOSED,
} from '@nostrify/types';
import { searchQuery } from './searchQuery';

type ReqMsg = NostrRelayEVENT | NostrRelayEOSE | NostrRelayCLOSED;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

/**
 * A fake relay that emits scripted EVENT(s) then EOSE, each after a delay.
 * Honours the AbortSignal NPool passes in (so the pool's eoseTimeout abort
 * actually cuts this relay off mid-stream, exactly like a real slow relay).
 */
function fakeRelay(script: Array<{ msg: ReqMsg; delay: number }>) {
  return {
    req(_filters: NostrFilter[], opts?: { signal?: AbortSignal }): AsyncIterable<ReqMsg> {
      return (async function* () {
        for (const step of script) {
          await sleep(step.delay);
          if (opts?.signal?.aborted) return;
          yield step.msg;
        }
      })();
    },
    async query() { return []; },
    async event() {},
    async close() {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Build a real NPool fronting two fake relays — a FAST one that EOSEs empty
 * immediately, and a SLOW one that yields the matching profile ~350ms later
 * (past the old 300ms global cutoff, within the 2500ms search grace). This is
 * the exact KUBO-194 race condition, run through the REAL pool abort logic.
 */
function racePool(eoseTimeout: number, match: NostrEvent) {
  const fast = fakeRelay([
    { msg: ['EOSE', 'fast'], delay: 20 }, // fast relay: no match, EOSEs early
  ]);
  const slow = fakeRelay([
    { msg: ['EVENT', 'slow', match], delay: 350 }, // slow relay: HAS the match
    { msg: ['EOSE', 'slow'], delay: 5 },
  ]);

  const relays = new Map([
    ['wss://fast.example/', fast],
    ['wss://slow.example/', slow],
  ]);

  return new NPool({
    open: (url) => relays.get(url)!,
    reqRouter: (filters) =>
      new Map([
        ['wss://fast.example/', filters],
        ['wss://slow.example/', filters],
      ]),
    eventRouter: () => [],
    eoseTimeout,
  });
}

describe('searchQuery — real NPool two-relay race (KUBO-194 sandwich)', () => {
  it('REPRODUCES the bug: with the old 300ms eoseTimeout the slow match is DROPPED', async () => {
    // Sanity floor — proves the harness genuinely reproduces the original bug,
    // so the passing case below is meaningful and not green-by-construction.
    const match = makeEvent({ id: 'me', pubkey: 'jeroen', content: '{"name":"Jeroen"}' });
    const pool = racePool(300, match);

    // searchQuery passes eoseTimeout:2500, which would mask the bug — so for THIS
    // sanity check we drive the pool the way the OLD query() did: its own 300ms,
    // including query()'s try/catch that swallows the eoseTimeout AbortError and
    // returns partial results (NPool.ts:248-256).
    const events: NostrEvent[] = [];
    try {
      for await (const msg of pool.req([{ kinds: [0], search: 'Jeroen' }], { eoseTimeout: 300 })) {
        if (msg[0] === 'EOSE') break;
        if (msg[0] === 'EVENT') events.push(msg[2]);
      }
    } catch {
      // The 300ms abort fires mid-stream — exactly the bug. query() swallows it.
    }

    // The slow relay's match arrives at ~350ms, after the 300ms abort → dropped.
    expect(events.find((e) => e.id === 'me')).toBeUndefined();
  });

  it('FIXES the bug: searchQuery (2500ms grace) KEEPS the slow match', async () => {
    const match = makeEvent({ id: 'me', pubkey: 'jeroen', content: '{"name":"Jeroen"}' });
    const pool = racePool(300, match); // pool global stays 300ms — the FEED setting

    // searchQuery overrides eoseTimeout per-call to 2500ms via nostr.req.
    const result = await searchQuery(pool, [{ kinds: [0], search: 'Jeroen' }]);

    expect(result.find((e) => e.id === 'me')).toBeDefined();
  });

  it('is stable across repeated runs (non-deterministic bug must not flake back)', async () => {
    for (let i = 0; i < 12; i++) {
      const match = makeEvent({ id: `me-${i}`, pubkey: 'jeroen' });
      const pool = racePool(300, match);
      const result = await searchQuery(pool, [{ kinds: [0], search: 'Jeroen' }]);
      expect(result.find((e) => e.id === `me-${i}`), `run ${i}`).toBeDefined();
    }
  });
});
