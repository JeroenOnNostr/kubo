/**
 * Kid-mode click-eaters covering YouTube's player UI tap targets that would let
 * the kid escape the parent-approved video: the share / chain-icon button
 * (bottom-left), the "More videos" button (bottom-centre), and the YouTube
 * wordmark (bottom-right), which all surface on tap/pause along the bottom row
 * of the player. Same defense layer as the Android nav guard, just client-side
 * for the actions that don't go through navigation (clipboard write, in-iframe
 * video swap).
 *
 * After the KUBO-142 scale trick the chrome lays out across the full bottom
 * band (see KUBO-143), so the masks are percentage-based to track it — which
 * also means they are size-agnostic and work identically inline AND in the
 * rotate-to-fullscreen overlay. We mask the whole bottom ~28% of the frame
 * EXCEPT the extreme bottom-right corner, which stays open for the fullscreen
 * toggle. The centre play/pause button sits at ~50% height, well above this
 * band, so it stays tappable. Transparent + cursor-default so the masks don't
 * read as broken UI.
 *
 * Shared by {@link YouTubeEmbed} (inline) and {@link RotateFullscreenOverlay}
 * (landscape fullscreen) so the geometry never drifts between the two.
 */
export function YouTubeClickEaters() {
  return (
    <>
      {/* Bottom band minus the bottom-right fullscreen corner: covers
          chain icon, "More videos", and the wordmark. */}
      <div
        className="absolute left-0 right-[18%] bottom-0 h-[28%] z-10 cursor-default"
        onClick={(e) => e.stopPropagation()}
        aria-hidden
      />
      {/* Right edge above the fullscreen corner: covers the upper part
          of the wordmark without blocking the fullscreen toggle. */}
      <div
        className="absolute right-0 w-[18%] bottom-[12%] h-[16%] z-10 cursor-default"
        onClick={(e) => e.stopPropagation()}
        aria-hidden
      />
    </>
  );
}
