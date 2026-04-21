import type { NostrEvent } from '@nostrify/nostrify';

/** Get the first value of a top-level tag by name. */
export function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

/**
 * Parse an `imeta` tag block out of a NIP-71 video event.
 *
 * Falls back to top-level `thumb`/`image`/`url` tags when no imeta is present.
 * Returns the same shape regardless of source so call sites don't branch.
 */
export function parseVideoImeta(tags: string[][]): {
  url?: string;
  thumbnail?: string;
  duration?: string;
  blurhash?: string;
} {
  const standaloneThumb = getTag(tags, 'thumb') ?? getTag(tags, 'image');

  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue;
    const parts: Record<string, string> = {};
    for (let i = 1; i < tag.length; i++) {
      const p = tag[i];
      const sp = p.indexOf(' ');
      if (sp !== -1) parts[p.slice(0, sp)] = p.slice(sp + 1);
    }
    if (parts.url) {
      return {
        url: parts.url,
        thumbnail: parts.image ?? parts.thumb ?? standaloneThumb,
        duration: parts.duration,
        blurhash: parts.blurhash,
      };
    }
  }
  return { url: getTag(tags, 'url'), thumbnail: standaloneThumb };
}

/** Format a seconds string as `m:ss` or `h:mm:ss`. Returns undefined for invalid input. */
export function fmtDuration(s: string | undefined): string | undefined {
  const n = parseFloat(s ?? '');
  if (isNaN(n) || n <= 0) return undefined;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = Math.floor(n % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** True when the event is a NIP-71 video event with a parseable media URL. */
export function isPlayableVideoEvent(event: NostrEvent): boolean {
  if (event.kind !== 21 && event.kind !== 22) return false;
  return !!parseVideoImeta(event.tags).url;
}
