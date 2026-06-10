import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

interface KidNavigationInterceptorProps {
  /** Author of the wrapped post — fallback for ActorRow links that may render before metadata resolves. */
  pubkey: string;
  /** Event id of the wrapped post — used for the bare card-body click rewrite. */
  eventId: string;
  /** When true, the bare card-body click is left to NoteCard's own short-circuit. */
  viewOnly: boolean;
  children: React.ReactNode;
}

const NPUB_PATH    = /^\/(npub1[023456789acdefghjklmnpqrstuvwxyz]+)/;
const NEVENT_PATH  = /^\/(nevent1[023456789acdefghjklmnpqrstuvwxyz]+)/;
const NOTE_PATH    = /^\/(note1[023456789acdefghjklmnpqrstuvwxyz]+)/;
const NADDR_PATH   = /^\/(naddr1[023456789acdefghjklmnpqrstuvwxyz]+)/;
// Matches /<user>@<domain> AND /<bare-domain> (single segment with a dot, no @).
// The bare-domain branch covers verified `_@<domain>` NIP-05 identities — useProfileUrl
// strips the `_@` prefix, so the rendered href is /<domain> with no @ in the path.
// Single-segment + must-have-dot keeps Ditto's top-level fixed routes (/settings,
// /notifications, /letters/compose, etc.) safely out of scope.
const NIP05_PATH   = /^\/([^/?#]+@[^/?#]+|[^/?#@]+\.[^/?#@]+)$/;

// KUBO-158: the kid shell's own route subtree. The only same-origin paths the kid
// app legitimately navigates to (see renderKuboKidRoutes in src/kuboKidRoutes.tsx:
// /kid, /kid/blobbi, /kid/favorites, /kid/profile/:npub, /kid/post/:id). The
// interceptor rewrites recognized npub/note/nip05 anchors into /kid/profile|post
// itself, so any anchor that already points at /kid is a legitimate in-shell link
// and is allowed through unchanged. Everything else (/t/, /r/, /search,
// /notifications, /, unknown) is default-DENIED below.
const KID_SHELL_PATH = /^\/kid(\/|$)/;

/**
 * Intercepts profile/note/card clicks inside a kid-rendered NoteCard and rewrites
 * them to /kid/profile/:npub or /kid/post/:id so the kid stays inside KuboKidLayout.
 *
 * The rewrites happen in the capture phase, before React Router's <Link> handler
 * runs, so we never have to touch upstream NoteCard / NoteContent / useProfileUrl.
 *
 * - Profile anchors: ActorRow's avatar+name <Link> and inline @mentions in NoteContent.
 *   Recognized by an href matching /npub1... or /<nip05>. Routes to /kid/profile/<npub>.
 *   For NIP-05-form hrefs we don't have the pubkey from the URL alone; fall back to
 *   the wrapper's `pubkey` prop (correct for ActorRow on the post itself; for inline
 *   NIP-05 mentions we'd need richer DOM hints, which Ditto doesn't add — covered by
 *   the npub case in practice since useProfileUrl only emits NIP-05 form when verified).
 *
 * - Note anchors: inline nevent/note/naddr links rendered by NoteContent. Routes to
 *   /kid/post/<eventId>. naddr links target addressable events; we route to the
 *   bare encoded form and let KidPostDetailPage decode it.
 *
 * - Bare card-body click (no anchor ancestor) routes to /kid/post/<eventId> only when
 *   view-only is OFF. NoteCard.handleCardClick already returns early in view-only,
 *   so leaving the bare-click branch alone in that mode is correct.
 *
 * View-only mode also blocks profile and note anchor clicks entirely — no
 * navigation to /kid/profile or /kid/post from the feed. Profile viewer is
 * still reachable when view-only is OFF.
 *
 * - KUBO-158 default-DENY: every OTHER same-origin anchor is BLOCKED. Inline
 *   #hashtag links (/t/:tag), relay links (/r/...), and any /search,
 *   /notifications, global-feed, or unknown path are shell escapes — one tap
 *   would land the kid in the ungated Ditto MainLayout. Only paths inside the
 *   kid shell (/kid/...) pass through. External (cross-origin) links are left
 *   untouched so they open normally.
 */
export function KidNavigationInterceptor({
  pubkey,
  eventId,
  viewOnly,
  children,
}: KidNavigationInterceptorProps) {
  const nav = useNavigate();

  const handleClickCapture = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only intercept primary-button clicks. Middle/right click stays untouched
      // so opening in a new tab still works for the parent if they ever land here.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Clicks inside the inline video player belong to the player — don't
      // intercept. VideoPlayer's own bubble-phase stopPropagation runs too late
      // to shield against onClickCapture, so we short-circuit here instead.
      if (target.closest('[data-kubo-video]')) return;

      const anchor = target.closest('a') as HTMLAnchorElement | null;
      if (anchor) {
        // Normalize to a path so we don't mis-match absolute URLs to other origins.
        const url = new URL(anchor.href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        const path = url.pathname;

        const npubMatch  = NPUB_PATH.exec(path);
        const nip05Match = !npubMatch ? NIP05_PATH.exec(path) : null;
        const noteMatch  = !npubMatch && !nip05Match
          ? NEVENT_PATH.exec(path) ?? NOTE_PATH.exec(path) ?? NADDR_PATH.exec(path)
          : null;

        // View-only blocks profile and note navigation outright — no jump to
        // /kid/profile or /kid/post. Card-body click is already short-circuited
        // by NoteCard's own viewOnly handler, so only anchor clicks need this.
        if (viewOnly && (npubMatch || nip05Match || noteMatch)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (npubMatch) {
          e.preventDefault();
          e.stopPropagation();
          nav(`/kid/profile/${npubMatch[1]}`);
          return;
        }

        if (nip05Match) {
          // NIP-05 form: derive the npub from the wrapper's known pubkey. This is
          // correct for the post's own ActorRow (the only place useProfileUrl
          // emits a NIP-05 path), which is the same pubkey we were handed.
          e.preventDefault();
          e.stopPropagation();
          try {
            nav(`/kid/profile/${nip19.npubEncode(pubkey)}`);
          } catch {
            // pubkey malformed — drop the navigation rather than letting the
            // parent route handle it.
          }
          return;
        }

        if (noteMatch) {
          e.preventDefault();
          e.stopPropagation();
          nav(`/kid/post/${noteMatch[1]}`);
          return;
        }

        // KUBO-158: default-DENY. Any remaining same-origin anchor that is NOT
        // a kid-shell path (/kid/...) is a shell-escape — hashtag (/t/), relay
        // (/r/), /search, /notifications, the global feed (/), and any unknown
        // route would drop the kid into the ungated Ditto MainLayout. Block it
        // outright (quiet no-op, matching the view-only block above). Anchors
        // that already point inside the kid shell are legitimate and pass
        // through to React Router unchanged.
        if (KID_SHELL_PATH.test(path)) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // No anchor under the click. NoteCard's own card-click would route to
      // /:eventId via useOpenPost. Rewrite to /kid/post/:eventId — but only
      // when view-only is OFF (in view-only NoteCard returns early itself).
      if (viewOnly) return;

      // Skip if the click landed on a button, dialog, or other interactive
      // element NoteCard.handleCardClick would also skip — otherwise we'd
      // navigate when the user just opened a menu.
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
      nav(`/kid/post/${eventId}`);
    },
    [eventId, nav, pubkey, viewOnly],
  );

  // The `data-kid-view-only` attribute triggers a global CSS rule in
  // src/index.css that disables pointer events on profile-link / note-link
  // anchors inside the wrapper. This defeats Ditto's <ProfileHoverCard>
  // (a Radix HoverCard whose trigger fires on pointerenter) AND any
  // tap-to-navigate path in one rule. Click-capture above still handles
  // the bare card-body case.
  return (
    <div
      onClickCapture={handleClickCapture}
      data-kid-view-only={viewOnly ? 'true' : undefined}
    >
      {children}
    </div>
  );
}
