/**
 * YouTube Bridge DVM client (Kubo side).
 *
 * Talks to the external YouTube bridge DVM over the relays Kubo already uses —
 * NOT over HTTP. Follows the publish-then-await-response shape of
 * `src/lib/nostrPush.ts`: publish a signed NIP-90 job request, then subscribe
 * for the `e`-tagged result event and resolve on the first match.
 *
 * Job kinds (see nostr-youtube-bridge/docs/dvm-contract.md — v1):
 *   - Search: request 5392 → result 6392 (status 7000)
 *   - Watch:  request 5393 → result 6393 (status 7000)
 *
 * These are ephemeral events (< 10000 not applicable — 5392/5393/6392/6393 sit
 * in the 5000-6999 range, which NPool routes like any other), correlated to the
 * request by an `["e", <request-id>]` tag on the result. We publish through
 * `useNostrPublish` (which auto-stamps the NIP-89 `client` tag and signs with
 * the explicit parent signer) and subscribe via `nostr.req()`.
 */

import { useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import type { NUser } from '@nostrify/react/login';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useNostrPublish, type EventTemplate } from '@/hooks/useNostrPublish';
import { useParentSigner } from '@/hooks/useParentSigner';

// ─── Job kinds ──────────────────────────────────────────────────────────────

export const KIND_YT_SEARCH_REQUEST = 5392;
export const KIND_YT_SEARCH_RESULT = 6392;
export const KIND_YT_WATCH_REQUEST = 5393;
export const KIND_YT_WATCH_RESULT = 6393;
export const KIND_DVM_STATUS = 7000;

// ─── Timeouts ─────────────────────────────────────────────────────────────────

/** Hard ceiling on a single search attempt before we retry / give up. */
const SEARCH_TIMEOUT_MS = 20_000;
/** Hard ceiling on a single watch attempt (backfill can be slow) before retry. */
const WATCH_TIMEOUT_MS = 60_000;

// ─── Result types (mirror the contract doc's content JSON) ────────────────────

/** One entry of the 6392 search result `content` JSON array. */
export interface SearchResult {
  channelId: string;
  title: string;
  /** Rehosted (or raw YouTube) thumbnail URL; may be flaky → Avatar falls back. */
  thumbnail?: string;
  /** Derived per-channel npub (public key only). Follow this to get videos. */
  npub: string;
  /** True when the channel is already being watched (videos already flow). */
  watching: boolean;
}

/** The 6393 watch result `content` JSON object. */
export interface WatchResult {
  channelId: string;
  /** Follow THIS to get the channel's videos. */
  npub: string;
  title: string;
  picture?: string;
  /** How many long-form kind:21 events the DVM published this call. */
  backfilled: number;
  alreadyWatched: boolean;
}

/** DVM status updates surfaced to callers while a job is processing. */
export interface DvmStatus {
  status: 'processing' | 'error' | 'success';
  message?: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when the DVM never answers (relays are best-effort). */
export class YouTubeDvmTimeoutError extends Error {
  constructor(job: 'search' | 'watch') {
    super(
      job === 'search'
        ? "Couldn't reach the YouTube service. Please try again."
        : "Couldn't add the channel right now. Please try again.",
    );
    this.name = 'YouTubeDvmTimeoutError';
  }
}

/** Thrown when the DVM replies with a 7000 `error` status. */
export class YouTubeDvmError extends Error {
  constructor(message: string) {
    super(message || 'The YouTube service returned an error.');
    this.name = 'YouTubeDvmError';
  }
}

// ─── Minimal interface over the app's nostr pool ──────────────────────────────

interface ReqCapable {
  req(
    filters: NostrFilter[],
    opts?: { signal?: AbortSignal; eoseTimeout?: number },
  ): AsyncIterable<['EVENT', string, NostrEvent] | ['EOSE', string] | ['CLOSED', string, string]>;
}

/** Publish signature compatible with `useNostrPublish().mutateAsync`. */
export type PublishFn = (template: EventTemplate) => Promise<NostrEvent>;

// ─── Core round-trip ──────────────────────────────────────────────────────────

interface RoundTripOpts<T> {
  nostr: ReqCapable;
  publish: PublishFn;
  parentSigner: NUser;
  template: EventTemplate;
  /** The result kind to resolve on (6392 / 6393). */
  resultKind: number;
  /** Parse the first matching result event's content into T. */
  parse: (event: NostrEvent) => T;
  timeoutMs: number;
  onStatus?: (status: DvmStatus) => void;
}

/**
 * Publish the request (signed by the parent), then subscribe by its `e`-tag and
 * resolve with the parsed `content` of the first matching result. Surfaces 7000
 * status events via `onStatus`. Rejects with `YouTubeDvmError` on a 7000 `error`
 * status, or `YouTubeDvmTimeoutError` when the ceiling fires with no result.
 *
 * One attempt; the retry/backoff lives in the public functions below.
 */
async function dvmRoundTrip<T>(opts: RoundTripOpts<T>): Promise<T> {
  const { nostr, publish, parentSigner, template, resultKind, parse, timeoutMs, onStatus } = opts;

  // Publish first — the signed event's id is what the result `e`-tags. (We
  // can't subscribe before we know the id; the DVM only acts on a request it
  // received, and `since: now-5s` covers the brief publish→subscribe gap.)
  const request = await publish({ ...template, signer: parentSigner });

  const ceiling = AbortSignal.timeout(timeoutMs);
  const since = Math.floor(Date.now() / 1000) - 5;
  const filter: NostrFilter = {
    kinds: [resultKind, KIND_DVM_STATUS],
    '#e': [request.id],
    since,
  };

  for await (const msg of nostr.req([filter], { signal: ceiling })) {
    if (msg[0] === 'EVENT') {
      const event = msg[2];
      if (event.kind === resultKind) {
        return parse(event);
      }
      if (event.kind === KIND_DVM_STATUS) {
        const statusTag = event.tags.find(([name]) => name === 'status');
        const status = statusTag?.[1] as DvmStatus['status'] | undefined;
        if (status === 'error') {
          throw new YouTubeDvmError(statusTag?.[2] ?? '');
        }
        if (status) {
          onStatus?.({ status, message: statusTag?.[2] });
        }
      }
    } else if (msg[0] === 'CLOSED') {
      break;
    }
    // EOSE is ignored: results are published AFTER the DVM processes the
    // request, so they arrive post-EOSE — we keep the subscription open until
    // the result lands or the ceiling aborts.
  }

  // The loop only exits without returning on abort (ceiling) or CLOSED.
  throw new YouTubeDvmTimeoutError(resultKind === KIND_YT_SEARCH_RESULT ? 'search' : 'watch');
}

/** Run `attempt` once, and one retry if it times out. Other errors propagate. */
async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    if (err instanceof YouTubeDvmTimeoutError) {
      return await attempt();
    }
    throw err;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Search YouTube channels via the bridge DVM. `query` is free text, a YouTube
 * URL, or an @handle — the DVM resolves any of them. Returns the parsed,
 * best-match-first `SearchResult[]` (empty array = no matches). Times out after
 * ~20s with one retry, then throws `YouTubeDvmTimeoutError`.
 */
export async function searchYouTubeChannels(
  nostr: ReqCapable,
  publish: PublishFn,
  parentSigner: NUser,
  query: string,
): Promise<SearchResult[]> {
  const template: EventTemplate = {
    kind: KIND_YT_SEARCH_REQUEST,
    content: '',
    tags: [['i', query, 'text']],
    created_at: Math.floor(Date.now() / 1000),
  };
  return withRetry(() =>
    dvmRoundTrip<SearchResult[]>({
      nostr,
      publish,
      parentSigner,
      template,
      resultKind: KIND_YT_SEARCH_RESULT,
      parse: (event) => {
        const parsed = JSON.parse(event.content) as SearchResult[];
        return Array.isArray(parsed) ? parsed : [];
      },
      timeoutMs: SEARCH_TIMEOUT_MS,
    }),
  );
}

export interface RequestWatchOpts {
  /** UC… channel id (preferred) or a URL/@handle the DVM resolves. */
  channelId: string;
  /** How many long-form videos to backfill. Default 20. */
  backfillLong?: number;
  /** Progress callback for 7000 `processing` status events. */
  onStatus?: (status: DvmStatus) => void;
}

/**
 * Ask the bridge DVM to watch a channel (ensures the channel, publishes kind-0,
 * backfills the last N long-form videos as kind:21). Returns the parsed
 * `WatchResult` (idempotent: re-requesting a watched channel returns the same
 * npub with `alreadyWatched:true`). Times out after ~60s with one retry.
 */
export async function requestWatchChannel(
  nostr: ReqCapable,
  publish: PublishFn,
  parentSigner: NUser,
  { channelId, backfillLong = 20, onStatus }: RequestWatchOpts,
): Promise<WatchResult> {
  const template: EventTemplate = {
    kind: KIND_YT_WATCH_REQUEST,
    content: '',
    tags: [
      ['i', channelId, 'text'],
      ['param', 'backfillLong', String(backfillLong)],
      ['param', 'shorts', 'false'],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };
  return withRetry(() =>
    dvmRoundTrip<WatchResult>({
      nostr,
      publish,
      parentSigner,
      template,
      resultKind: KIND_YT_WATCH_RESULT,
      parse: (event) => JSON.parse(event.content) as WatchResult,
      timeoutMs: WATCH_TIMEOUT_MS,
      onStatus,
    }),
  );
}

// ─── React hook ───────────────────────────────────────────────────────────────

export interface UseYouTubeDvmReturn {
  /** True when the parent identity is available to sign DVM requests. */
  ready: boolean;
  /** Why the DVM is unavailable (parent logged out), if any. */
  reason?: 'no-family' | 'parent-logged-out';
  search: (query: string) => Promise<SearchResult[]>;
  watch: (opts: RequestWatchOpts) => Promise<WatchResult>;
}

/**
 * Hook wrapping the DVM client with the app's nostr pool, publish mutation, and
 * parent signer. `search`/`watch` throw `parent-logged-out` if the parent isn't
 * signed in (the DVM requests MUST be parent-signed, per the contract's auth).
 */
export function useYouTubeDvm(): UseYouTubeDvmReturn {
  const { nostr } = useNostr();
  const { mutateAsync: publish } = useNostrPublish();
  const { user: parentSigner, reason } = useParentSigner();

  const search = useCallback(
    (query: string) => {
      if (!parentSigner) throw new Error(reason ?? 'parent-logged-out');
      return searchYouTubeChannels(nostr as ReqCapable, publish, parentSigner, query);
    },
    [nostr, publish, parentSigner, reason],
  );

  const watch = useCallback(
    (opts: RequestWatchOpts) => {
      if (!parentSigner) throw new Error(reason ?? 'parent-logged-out');
      return requestWatchChannel(nostr as ReqCapable, publish, parentSigner, opts);
    },
    [nostr, publish, parentSigner, reason],
  );

  return { ready: !!parentSigner, reason, search, watch };
}
