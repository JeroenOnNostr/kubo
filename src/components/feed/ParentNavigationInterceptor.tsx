import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

import {
  NPUB_PATH,
  NEVENT_PATH,
  NOTE_PATH,
  NADDR_PATH,
  NIP05_PATH,
} from '@/components/feed/navInterceptorPatterns';

interface ParentNavigationInterceptorProps {
  /** Author of the wrapped post — fallback for NIP-05-form profile anchors. */
  pubkey: string;
  /** Event id of the wrapped post — target for the bare card-body click rewrite. */
  eventId: string;
  children: React.ReactNode;
}

// The parent shell's own route subtree. Anchors already pointing inside
// /parent are legitimate in-shell links and pass through to React Router
// unchanged (mirrors KID_SHELL_PATH for the kid interceptor).
const PARENT_SHELL_PATH = /^\/parent(\/|$)/;

/**
 * KUBO-198 — parent counterpart of KidNavigationInterceptor.
 *
 * The parent feed preview (/parent/feed/preview → KidFeedList variant="parent")
 * renders the upstream NoteCard, whose profile/note links are context-agnostic
 * (useProfileUrl emits /npub1... or /<nip05>; NoteContent emits /nevent1...,
 * /note1..., /naddr1...). Without interception those resolve to the bare
 * /:nip19 route under MainLayout/RequireNotKid, EJECTING the parent out of the
 * /parent/* shell. This wrapper rewrites those clicks in the capture phase
 * (before React Router's <Link> handler) so the parent stays inside the parent
 * shell:
 *   - profile anchors → /parent/profile/:npub (ProfileViewPage — view + assign
 *     trust level, the same surface the Trust domain opens)
 *   - note anchors    → /parent/video/:id (VideoViewPage — its decodePostId
 *     accepts note1/nevent1/naddr1/raw hex)
 *   - bare card-body click → /parent/video/:eventId
 *
 * This is a routing-context fix, NOT a security boundary — it is deliberately a
 * separate component from KidNavigationInterceptor (which is the KUBO-158
 * kid-safety boundary with default-DENY and view-only blocking). It still
 * default-DENIES every OTHER same-origin anchor (hashtag /t/, relay /r/,
 * /search, the global feed /, unknown routes) so a stray inline link can't
 * eject the parent into MainLayout. External (cross-origin) links pass through
 * untouched.
 *
 * No view-only concept: the parent is an adult and must always be able to open
 * a profile (to assign a trust level) or a post.
 */
export function ParentNavigationInterceptor({
  pubkey,
  eventId,
  children,
}: ParentNavigationInterceptorProps) {
  const nav = useNavigate();

  const handleClickCapture = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only intercept primary-button clicks. Middle/right/modified clicks
      // (open-in-new-tab) stay untouched.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Inline video player clicks belong to the player — VideoPlayer's own
      // bubble-phase stopPropagation runs too late to shield onClickCapture.
      if (target.closest('[data-kubo-video]')) return;

      const anchor = target.closest('a') as HTMLAnchorElement | null;
      if (anchor) {
        // Normalize so we don't mis-match absolute URLs to other origins.
        const url = new URL(anchor.href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        const path = url.pathname;

        const npubMatch  = NPUB_PATH.exec(path);
        const nip05Match = !npubMatch ? NIP05_PATH.exec(path) : null;
        const noteMatch  = !npubMatch && !nip05Match
          ? NEVENT_PATH.exec(path) ?? NOTE_PATH.exec(path) ?? NADDR_PATH.exec(path)
          : null;

        if (npubMatch) {
          e.preventDefault();
          e.stopPropagation();
          nav(`/parent/profile/${npubMatch[1]}`);
          return;
        }

        if (nip05Match) {
          // NIP-05 form: derive the npub from the wrapper's known pubkey. This
          // is correct for the post's own ActorRow — the only place
          // useProfileUrl emits a NIP-05 path — which is the same pubkey we
          // were handed.
          e.preventDefault();
          e.stopPropagation();
          try {
            nav(`/parent/profile/${nip19.npubEncode(pubkey)}`);
          } catch {
            // pubkey malformed — drop the navigation rather than letting the
            // bare route eject the parent.
          }
          return;
        }

        if (noteMatch) {
          e.preventDefault();
          e.stopPropagation();
          nav(`/parent/video/${noteMatch[1]}`);
          return;
        }

        // Anchors already inside the parent shell are legitimate — let React
        // Router handle them.
        if (PARENT_SHELL_PATH.test(path)) {
          return;
        }

        // default-DENY: any remaining same-origin anchor (/t/, /r/, /search,
        // global feed /, unknown) would eject the parent into MainLayout.
        // Block it outright (quiet no-op).
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // No anchor under the click. NoteCard's own card-click would route to
      // /:eventId via useOpenPost (a bare route → ejects). Rewrite to
      // /parent/video/:eventId — skipping interactive elements NoteCard's own
      // handleCardClick also skips, so we don't navigate when a menu opens.
      if (
        target.closest('button') ||
        target.closest('[role="dialog"]') ||
        target.closest('[data-radix-dialog-overlay]') ||
        target.closest('[data-radix-dialog-content]') ||
        target.closest('[data-vaul-drawer]') ||
        target.closest('[data-vaul-drawer-overlay]') ||
        target.closest('[data-testid="zap-modal"]')
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      nav(`/parent/video/${eventId}`);
    },
    [eventId, nav, pubkey],
  );

  return <div onClickCapture={handleClickCapture}>{children}</div>;
}
