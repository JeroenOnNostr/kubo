// Shared URL-shape patterns for the feed navigation interceptors
// (KidNavigationInterceptor, ParentNavigationInterceptor). Both interceptors
// inspect a clicked anchor's pathname in the capture phase and rewrite it to
// their own shell's routes — they only need to agree on what each path SHAPE
// means, not on where it routes. Keeping the regexes in one module is the
// single source of truth for that shape knowledge; the routing decisions stay
// in each interceptor (they are deliberately separate components — the kid one
// is a KUBO-158 security boundary, the parent one is a routing-context fix).

export const NPUB_PATH   = /^\/(npub1[023456789acdefghjklmnpqrstuvwxyz]+)/;
export const NEVENT_PATH = /^\/(nevent1[023456789acdefghjklmnpqrstuvwxyz]+)/;
export const NOTE_PATH   = /^\/(note1[023456789acdefghjklmnpqrstuvwxyz]+)/;
export const NADDR_PATH  = /^\/(naddr1[023456789acdefghjklmnpqrstuvwxyz]+)/;

// Matches /<user>@<domain> AND /<bare-domain> (single segment with a dot, no @).
// The bare-domain branch covers verified `_@<domain>` NIP-05 identities —
// useProfileUrl strips the `_@` prefix, so the rendered href is /<domain> with
// no @ in the path. Single-segment + must-have-dot keeps Ditto's top-level
// fixed routes (/settings, /notifications, /letters/compose, etc.) safely out
// of scope.
export const NIP05_PATH  = /^\/([^/?#]+@[^/?#]+|[^/?#@]+\.[^/?#@]+)$/;

// KUBO-158: the kid shell's own route subtree (used only by
// KidNavigationInterceptor). The only same-origin paths the kid app
// legitimately navigates to (see renderKuboKidRoutes in src/kuboKidRoutes.tsx:
// /kid, /kid/blobbi, /kid/favorites, /kid/profile/:npub, /kid/post/:id). Any
// anchor already pointing inside /kid is a legitimate in-shell link and is
// allowed through; everything else is default-DENIED.
export const KID_SHELL_PATH = /^\/kid(\/|$)/;
