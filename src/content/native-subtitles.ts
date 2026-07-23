/**
 * Hiding the player's own on-video captions while the overlay is expanded.
 *
 * IMPORTANT: we must NOT flip the subtitle `track.mode` to hide it. The TV 2
 * Play player only *streams* subtitle segments while its text track is visible,
 * so forcing the track to 'hidden' makes cue loading stop dead — the overlay
 * then freezes on the last-loaded cue while the video plays on. Instead we leave
 * the user-selected track exactly as it is and suppress the *visual* output two
 * ways, both fully reversible:
 *  - a `::cue` stylesheet (covers the browser's native cue renderer), and
 *  - a `.rxp-texttrack-region` rule (covers the player's bespoke DOM captions).
 *
 * Using a static stylesheet rather than per-frame JS is deliberate: RxPlayer
 * paints a new caption node the instant it appears, so toggling `visibility`
 * from our render loop left a brief flash of the original subtitle before JS
 * caught up. A CSS rule hides the node the moment it is inserted, with no blink,
 * and never touches a player ancestor (so the video itself can't be hidden).
 */

import { state, ui } from "./state";

const CUE_HIDE_STYLE_ID = "nsr-native-cue-hide";

/**
 * Toggle a single stylesheet that suppresses the player's own captions. Covers
 * both the browser's native `::cue` renderer and RxPlayer's DOM subtitle regions
 * (`.rxp-texttrack-region`). A static CSS rule hides each caption node the moment
 * it is inserted — no per-frame JS — so the original subtitle never flashes at
 * the bottom of the video before we hide it. It only ever targets the player's
 * own caption containers, never a player ancestor, so the video can't be hidden.
 */
function setNativeCueHidden(hidden: boolean): void {
  const existing = document.getElementById(CUE_HIDE_STYLE_ID);
  if (hidden) {
    if (existing) return;
    const style = document.createElement("style");
    style.id = CUE_HIDE_STYLE_ID;
    // The overlay only mounts on video pages and only while expanded, so this is
    // scoped in practice and fully removed on collapse. Our overlay never uses
    // the `rxp-texttrack` class prefix, so it is unaffected.
    //
    // `opacity:0` (not just `visibility:hidden`) is essential: RxPlayer sets an
    // explicit `visibility` on the caption's child spans, which would override a
    // parent's `visibility:hidden`. A parent's group `opacity` cannot be undone
    // by a descendant, so it reliably hides the whole caption. The broad
    // `[class*="rxp-texttrack"]` selector covers the region, paragraph and span
    // nodes regardless of which one carries the visible styling.
    style.textContent =
      "video::cue{opacity:0!important;visibility:hidden!important;}" +
      "[class*=\"rxp-texttrack\"]{opacity:0!important;visibility:hidden!important;}";
    (document.head || document.documentElement).appendChild(style);
  } else if (existing) {
    existing.remove();
  }
}

export function applyNativeSubtitleVisibility(): void {
  if (!state.video) return;
  setNativeCueHidden(ui.isExpanded);
}

/** Remove all native-caption suppression (used when tearing the overlay down). */
export function clearNativeSubtitleHiding(): void {
  setNativeCueHidden(false);
}
