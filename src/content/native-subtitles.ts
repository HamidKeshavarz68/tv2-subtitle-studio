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
 *  - matching the player's bespoke DOM caption nodes by text and `visibility:hidden`.
 */

import { OVERLAY_ID } from "./config";
import { state, ui } from "./state";
import { cueText, normalizeWhitespace } from "./utils";

const hiddenDomEls = new Set<HTMLElement>();

/**
 * Walk up to the largest ancestor still ~the size of the video (not the whole
 * page) — typically the player root.
 */
function findPlayerContainer(video: HTMLVideoElement): HTMLElement {
  let el: HTMLElement | null = video.parentElement;
  let best: HTMLElement | null = el;
  const vw = video.clientWidth || 1;
  while (el && el !== document.body && el !== document.documentElement) {
    const r = el.getBoundingClientRect();
    if (r.width > vw * 4) break; // grown well beyond the video's footprint
    best = el;
    el = el.parentElement;
  }
  return best || video.parentElement || document.body;
}

export function restoreHiddenNativeDom(): void {
  hiddenDomEls.forEach((el) => {
    el.style.visibility = "";
  });
  hiddenDomEls.clear();
}

/** Hide the player's DOM-rendered subtitle that matches the active cue at time `t`. */
export function hideNativeDomSubtitles(cue: VTTCue | null, t: number): void {
  // Always start by restoring whatever we hid last frame.
  restoreHiddenNativeDom();

  if (!ui.isExpanded || !state.video || !cue) return;

  // The native renderer only draws while the cue overlaps the current time.
  if (t < cue.startTime || t > cue.endTime) return;

  const raw = cueText(cue);
  const lines = raw.split(/\n+/).map(normalizeWhitespace).filter((l) => l.length >= 2);
  if (!lines.length) return;
  const joined = normalizeWhitespace(raw.replace(/\n+/g, " "));

  const root = findPlayerContainer(state.video);

  // Walk descendants; only hide leaf-ish text nodes, never our overlay or
  // interactive controls.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      if (el.closest(`#${OVERLAY_ID}`)) return NodeFilter.FILTER_REJECT;
      const tag = el.tagName;
      if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const el = node as HTMLElement;
    // Likely a subtitle line, not an entire panel.
    if (el.childElementCount > 4) continue;
    const txt = normalizeWhitespace(el.textContent || "");
    if (!txt || txt.length > joined.length + 80) continue;

    const matches =
      txt === joined ||
      lines.some((l) => txt === l) ||
      // Some renderers wrap each line in its own element AND have a wrapper
      // containing both lines glued together with a space.
      (lines.length > 1 && txt === lines.join(" "));

    if (matches) {
      if (el.style.visibility !== "hidden") {
        el.style.visibility = "hidden";
      }
      hiddenDomEls.add(el);
    }
  }
}

/**
 * Apply the expand/collapse policy to native caption rendering. We never change
 * `track.mode` (that would stop the player streaming cues). When expanded we add
 * a `::cue` hide style; when collapsed we remove it and un-hide any DOM nodes.
 */
const CUE_HIDE_STYLE_ID = "nsr-native-cue-hide";

function setNativeCueHidden(hidden: boolean): void {
  const existing = document.getElementById(CUE_HIDE_STYLE_ID);
  if (hidden) {
    if (existing) return;
    const style = document.createElement("style");
    style.id = CUE_HIDE_STYLE_ID;
    // Hide the browser's native cue renderer for every video on the page. The
    // overlay only mounts on video pages and only while expanded, so this is
    // scoped in practice and fully removed on collapse.
    style.textContent = "video::cue{opacity:0!important;visibility:hidden!important;}";
    (document.head || document.documentElement).appendChild(style);
  } else if (existing) {
    existing.remove();
  }
}

export function applyNativeSubtitleVisibility(): void {
  if (!state.video) return;
  if (ui.isExpanded) {
    setNativeCueHidden(true);
  } else {
    setNativeCueHidden(false);
    restoreHiddenNativeDom();
  }
}

/** Remove all native-caption suppression (used when tearing the overlay down). */
export function clearNativeSubtitleHiding(): void {
  setNativeCueHidden(false);
  restoreHiddenNativeDom();
}
