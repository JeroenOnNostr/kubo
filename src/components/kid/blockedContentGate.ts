/**
 * KUBO-163 — pure read-side gating decisions for the kid surfaces.
 *
 * Kept in a non-component module (separate from `BlockedContent.tsx`) so the
 * component file stays Fast-Refresh-clean (no mixed component + helper exports)
 * and so the gate logic is trivially unit-testable without rendering the
 * hook-heavy pages.
 */

/**
 * Render-gate decision for the kid post-detail page.
 *
 * Inputs are the resolved TEPP verdict for the post's author/event and whether
 * TEPP is enforced for the active kid:
 *  - `'pass'`     — not enforced (parent surface) OR verdict settled-visible →
 *                   render the real content.
 *  - `'skeleton'` — enforced + verdict not yet settled (construct/closure still
 *                   loading, or construct-unavailable) → show the loading
 *                   skeleton, NEVER the content. This honours KUBO-154
 *                   construct-unavailable semantics (skeleton/notice, not
 *                   content).
 *  - `'blocked'`  — enforced + a concrete deny → render <BlockedContent/>.
 *
 * `verdictSettled` distinguishes "no construct loaded yet / closure resolving"
 * (false → skeleton) from "construct loaded and decided" (true → use `visible`).
 * Pass-through verdicts (no construct because TEPP is off) are handled by
 * `enforced` being false.
 */
export type PostDetailGate = 'pass' | 'skeleton' | 'blocked';

export function resolvePostDetailGate(
  enforced: boolean,
  verdictSettled: boolean,
  visible: boolean,
): PostDetailGate {
  if (!enforced) return 'pass';
  if (!verdictSettled) return 'skeleton';
  return visible ? 'pass' : 'blocked';
}

/**
 * Author-block decision shared by the profile gate and the comment-row filter
 * (both hide on a concrete author deny, fail open while the verdict is
 * unsettled, and never block when TEPP isn't enforced).
 *
 * `authorVisible` is `useKuboTeppEvaluateAuthor(...).visible`, which is `true`
 * pass-through both when TEPP is off AND while the verdict is still resolving —
 * so the only block condition is `enforced && !authorVisible`.
 */
export function isAuthorBlocked(enforced: boolean, authorVisible: boolean): boolean {
  return enforced && !authorVisible;
}
