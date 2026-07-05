import { nip19 } from 'nostr-tools';

/**
 * A parsed token from a chat message body. Deliberately a small subset of
 * NoteContent's token set: chat bubbles render mentions, hashtags and inline
 * links, but NOT heavy media embeds (video players, link-preview cards, quoted
 * notes). Keeping the surface tight preserves the compact bubble layout — a
 * pasted image URL stays a clickable link rather than blowing the bubble open
 * into a gallery.
 *
 * The one exception is images the sender intentionally attached: passing their
 * URLs (from the message's NIP-92 `imeta` tags) as `imageUrls` to
 * `tokenizeChat` turns just those into inline `image-embed` tokens, so uploaded
 * screenshots render in the bubble while arbitrary pasted links do not.
 */
export type ChatToken =
  | { type: 'text'; value: string }
  | { type: 'mention'; pubkey: string; raw: string }
  | { type: 'link'; url: string }
  | { type: 'image-embed'; url: string }
  | { type: 'hashtag'; tag: string; raw: string }
  | { type: 'nostr-link'; id: string; raw: string };

/**
 * Match, in one pass: URLs | `nostr:`-prefixed or bare NIP-19 identifiers
 * (with an optional leading `@`) | hashtags. Mirrors the relevant arms of
 * NoteContent's tokenizer so mentions resolve identically in chat.
 */
const TOKEN_REGEX =
  /((?:https?|wss?):\/\/[^\s]+)|nostr:(npub1|note1|nprofile1|nevent1|naddr1)([023456789acdefghjklmnpqrstuvwxyz]+)|@?(npub1|note1|nprofile1|nevent1|naddr1)([023456789acdefghjklmnpqrstuvwxyz]+)|(#[\p{L}\p{N}_]+)/giu;

/** Trailing punctuation likely not part of a URL (e.g. "see https://x.com)."). */
const TRAILING_PUNCT_REGEX = /^(.*?)([.,;:!?)\]]+)$/;

/**
 * Tokenize a chat message body into render-ready tokens. `imageUrls` is the set
 * of URLs the event's `imeta` tags describe as images; those become
 * `image-embed` tokens, everything else stays a `link` (see the type doc).
 */
export function tokenizeChat(text: string, imageUrls: Set<string> = new Set()): ChatToken[] {
  const result: ChatToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_REGEX.lastIndex = 0;

  while ((match = TOKEN_REGEX.exec(text)) !== null) {
    let [fullMatch] = match;
    let url = match[1];
    const { 2: nostrPrefix, 3: nostrData, 4: barePrefix, 5: bareData, 6: hashtag } = match;
    const index = match.index;

    if (index > lastIndex) {
      result.push({ type: 'text', value: text.substring(lastIndex, index) });
    }

    if (url) {
      // Strip common trailing punctuation that's unlikely to be part of the URL.
      const trailing = url.match(TRAILING_PUNCT_REGEX);
      if (trailing && trailing[1] && trailing[1].length > 10) {
        url = trailing[1];
        fullMatch = trailing[1];
      }
      // Embed as an inline image only for intentional uploads (URL described by
      // an imeta tag → present in `imageUrls`); arbitrary pasted image URLs stay
      // plain links to keep the bubble compact.
      result.push(imageUrls.has(url) ? { type: 'image-embed', url } : { type: 'link', url });
    } else if ((nostrPrefix && nostrData) || (barePrefix && bareData)) {
      const prefix = nostrPrefix || barePrefix;
      const data = nostrData || bareData;
      const nostrId = `${prefix}${data}`;
      try {
        const decoded = nip19.decode(nostrId);
        if (decoded.type === 'npub') {
          result.push({ type: 'mention', pubkey: decoded.data, raw: fullMatch });
        } else if (decoded.type === 'nprofile') {
          result.push({ type: 'mention', pubkey: decoded.data.pubkey, raw: fullMatch });
        } else {
          // note / nevent / naddr — link to the in-app route rather than
          // embedding a card (cards don't belong in a chat bubble).
          result.push({ type: 'nostr-link', id: nostrId, raw: fullMatch });
        }
      } catch {
        result.push({ type: 'text', value: fullMatch });
      }
    } else if (hashtag) {
      result.push({ type: 'hashtag', tag: hashtag.slice(1), raw: hashtag });
    }

    lastIndex = index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    result.push({ type: 'text', value: text.substring(lastIndex) });
  }

  return result.filter((t) => !(t.type === 'text' && t.value === ''));
}

/**
 * Collapse `nostr:`/bare NIP-19 mention & reference URIs in a message body to
 * a short `@npub1abc…` style placeholder, for one-line previews (reply
 * excerpts, conversation snippets) that can't host the async ChatContent
 * renderer. Without this, a 63-char raw `nostr:npub1…` dominates or garbles
 * the truncated preview line. Links and hashtags are left as-is.
 */
export function collapseMentionsForPreview(content: string): string {
  return content.replace(
    TOKEN_REGEX,
    (full, url, nostrPrefix, nostrData, barePrefix, bareData) => {
      // Leave URLs and hashtags untouched (capture groups 1 and 6).
      if (url || (!nostrPrefix && !barePrefix)) return full;
      const prefix = nostrPrefix || barePrefix;
      const data = nostrData || bareData;
      if (prefix === 'npub1' || prefix === 'nprofile1') {
        // Compact, recognizable handle — first chars of the identifier.
        return `@${prefix}${data.slice(0, 6)}…`;
      }
      // note/nevent/naddr references → short placeholder too.
      return `${prefix}${data.slice(0, 6)}…`;
    },
  );
}
