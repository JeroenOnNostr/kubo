/**
 * Single-screen boot loader control.
 *
 * Kubo shows ONE loading screen: the static `#preloader` in index.html. It is
 * on screen from the very first paint (before React boots) and stays there —
 * React renders nothing (returns null) on the boot/loading paths, so the
 * preloader shows through with no second element to transition to. We remove
 * the preloader exactly once, when real content has painted underneath it
 * (the kid feed is ready, or a non-loading screen has mounted).
 *
 * This is why there is no "two loading screens" flash and no font swap: there
 * is only one loading element for the entire boot, and it is never swapped for
 * a React-rendered twin — it is simply removed when we're done.
 */

let dismissed = false;

/**
 * Fade out and remove the `#preloader`. Idempotent — safe to call from
 * multiple ready-signals (kid feed ready, app content mounted, safety timeout).
 */
export function dismissPreloader(): void {
  if (dismissed) return;
  dismissed = true;

  const el = document.getElementById("preloader");
  if (!el) return;

  // Quick fade so the reveal of the content underneath isn't an abrupt cut.
  el.style.transition = "opacity 200ms ease-out";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";

  const remove = () => el.remove();
  el.addEventListener("transitionend", remove, { once: true });
  // Fallback in case transitionend doesn't fire (element already opacity:0,
  // reduced-motion, etc.) — remove shortly after the fade would have ended.
  setTimeout(remove, 260);
}

/**
 * Safety net: if no ready-signal has dismissed the preloader within this
 * window, dismiss it anyway so a user can never be stuck behind it (e.g. an
 * unexpected route, a hung query). Armed once at module load.
 */
// Slightly above KidHomePage's own 10s feed-timeout so the kid path stays
// authoritative; this only fires for unusual non-kid routes that don't go
// through KuboBootGate / the questionnaire.
const SAFETY_MS = 11_000;
setTimeout(dismissPreloader, SAFETY_MS);
