/**
 * Shared layout constants for the kid feed (`/kid`).
 *
 * Lives in `lib/` (a leaf module) rather than on `KidFeedList` or `NoteCard`
 * so both can import it without creating a component import cycle
 * (`KidFeedList` already imports `NoteCard`).
 */

/**
 * Tailwind rounding utility for the kid-feed note tile's corners.
 *
 * Single source of truth shared by:
 *  - the tile wrapper in `KidFeedList` (the light-blue card), and
 *  - the full-bleed video player in `NoteCard`'s `VideoContent`, whose corners
 *    must line up exactly with the tile's when the player sits flush to the
 *    tile bottom.
 *
 * Keep these two in lockstep: if the tile radius changes, the player follows
 * automatically. `rounded-2xl` is Tailwind's default 16px (1rem).
 */
export const KID_TILE_ROUNDING = 'rounded-2xl';
