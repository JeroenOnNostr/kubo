import { describe, it, expect } from 'vitest';
import { tokenizeChat, collapseMentionsForPreview } from './chatTokens';

const NPUB = 'npub1zg69v7ys40x77y352eufp27daufrg4ncjz4ummcjx3t83y9tehhsqepuh0';
// nprofile for the same pubkey (1234…cdef), no relays.
const NPROFILE = 'nprofile1qqspydzk0zg2hn00zg69v7ys40x77y352eufp27daufrg4ncjz4ummct58nn9';
const PUBKEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

describe('tokenizeChat', () => {
  it('decodes a nostr:npub mention to a pubkey, separate from trailing punctuation', () => {
    const tokens = tokenizeChat(`hi nostr:${NPUB}, welcome`);
    const mention = tokens.find((t) => t.type === 'mention');
    expect(mention).toEqual({ type: 'mention', pubkey: PUBKEY, raw: `nostr:${NPUB}` });
    // The comma must NOT be swallowed into the mention — it stays as text.
    const text = tokens.filter((t) => t.type === 'text').map((t: { value: string }) => t.value).join('');
    expect(text).toContain(',');
  });

  it('decodes a bare npub (no nostr: prefix) and strips a leading @', () => {
    const tokens = tokenizeChat(`cc @${NPUB}`);
    const mention = tokens.find((t) => t.type === 'mention');
    expect(mention?.type).toBe('mention');
    expect((mention as { pubkey: string }).pubkey).toBe(PUBKEY);
  });

  it('decodes an nprofile mention to its pubkey', () => {
    const tokens = tokenizeChat(`yo nostr:${NPROFILE}`);
    const mention = tokens.find((t) => t.type === 'mention');
    expect((mention as { pubkey: string }).pubkey).toBe(PUBKEY);
  });

  it('treats note/nevent/naddr as a nostr-link, not a mention', () => {
    const note = 'note1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq2x3hwl';
    const tokens = tokenizeChat(`see nostr:${note}`);
    expect(tokens.some((t) => t.type === 'mention')).toBe(false);
    // It still produces a token (link); decode may or may not succeed, but it
    // must never be classified as a mention.
  });

  it('emits link and hashtag tokens', () => {
    const tokens = tokenizeChat('gm #nostr see https://example.com');
    expect(tokens.some((t) => t.type === 'hashtag' && t.tag === 'nostr')).toBe(true);
    expect(tokens.some((t) => t.type === 'link' && t.url === 'https://example.com')).toBe(true);
  });

  it('leaves an invalid bech32-shaped token as plain text', () => {
    // npub1 + too-short / invalid body → decode throws → falls back to text.
    const tokens = tokenizeChat('nostr:npub1zzzz');
    expect(tokens.every((t) => t.type === 'text')).toBe(true);
  });

  it('returns the whole string as one text token when there is nothing to match', () => {
    const tokens = tokenizeChat('just a normal message');
    expect(tokens).toEqual([{ type: 'text', value: 'just a normal message' }]);
  });
});

describe('collapseMentionsForPreview', () => {
  it('shortens a nostr:npub mention to a compact @handle', () => {
    const out = collapseMentionsForPreview(`hey nostr:${NPUB} welcome`);
    expect(out).not.toContain(NPUB);
    expect(out).toMatch(/@npub1\w{6}…/);
  });

  it('shortens a bare npub mention too', () => {
    const out = collapseMentionsForPreview(`cc @${NPUB}`);
    expect(out).not.toContain(NPUB);
    expect(out).toMatch(/@npub1\w{6}…/);
  });

  it('shortens an nprofile mention', () => {
    const out = collapseMentionsForPreview(`thanks nostr:${NPROFILE}`);
    expect(out).not.toContain(NPROFILE);
    expect(out).toMatch(/@nprofile1\w{6}…/);
  });

  it('leaves URLs and hashtags untouched', () => {
    const input = 'gm #nostr see https://example.com';
    expect(collapseMentionsForPreview(input)).toBe(input);
  });

  it('leaves plain text untouched', () => {
    const input = 'just a normal message';
    expect(collapseMentionsForPreview(input)).toBe(input);
  });
});
