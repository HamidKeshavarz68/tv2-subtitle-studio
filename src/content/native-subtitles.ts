/**
 * Hiding / replacing the player's own on-video captions.
 *
 * Two jobs live here:
 *
 * 1. ROLLING mode — suppress TV 2 Play's native caption while the extension's
 *    rolling overlay window owns subtitle display.
 * 2. SINGLE mode — when the user wants a single on-video line but with a
 *    translation, render our own styled caption in the same spot WITHOUT
 *    touching the player's caption text nodes.
 *
 * IMPORTANT constraints (both learned the hard way):
 *  - We must NOT flip the subtitle `track.mode` to hide it. The TV 2 Play player
 *    (Canal+ RxPlayer, HLS/DASH segmented) only *streams* subtitle segments while
 *    its text track is visible, so forcing the track to 'hidden' makes cue
 *    loading stop dead and the caption freezes. All hiding here is CSS/visual and
 *    fully reversible.
 *  - We must NOT overwrite the player's caption text node. RxPlayer re-renders its
 *    caption subtree (and after a SEEK), so replacing its innerHTML/textContent
 *    breaks its own rendering and freezes the caption. Instead we hide the native
 *    caption visually (a stylesheet) and draw our own absolutely-positioned
 *    overlay in the player's video-sized box.
 */

import { FONT, TV2 } from "./config";
import { settings, state } from "./state";

const CUE_HIDE_STYLE_ID = "nsr-native-cue-hide";

/**
 * Toggle a single stylesheet that suppresses the player's own captions. Covers
 * both the browser's native `::cue` renderer and RxPlayer's DOM subtitle regions
 * (`[class*="rxp-texttrack"]`). A static CSS rule hides each caption node the
 * moment it is inserted — no per-frame JS — so the original subtitle never
 * flashes at the bottom of the video before we hide it. It only ever targets the
 * player's own caption containers, never a player ancestor, so the video can't be
 * hidden.
 *
 * `opacity:0` (not just `visibility:hidden`) is essential: RxPlayer sets an
 * explicit `visibility` on the caption's child spans, which would override a
 * parent's `visibility:hidden`. A parent's group `opacity` cannot be undone by a
 * descendant, so it reliably hides the whole caption.
 */
export function setNativeCueHidden(hidden: boolean): void {
  const existing = document.getElementById(CUE_HIDE_STYLE_ID);
  if (hidden) {
    if (existing) return;
    const style = document.createElement("style");
    style.id = CUE_HIDE_STYLE_ID;
    style.textContent =
      "video::cue{opacity:0!important;visibility:hidden!important;}" +
      "[class*=\"rxp-texttrack\"]{opacity:0!important;visibility:hidden!important;}";
    (document.head || document.documentElement).appendChild(style);
  } else if (existing) {
    existing.remove();
  }
}

/**
 * Apply the current view mode to native caption rendering. We never change
 * `track.mode`. In "rolling" mode the overlay owns subtitle display, so we hide
 * the native caption; in "single" mode TV 2's own caption is used, so we reveal
 * it (the renderer re-suppresses it and draws our overlay when a translation is
 * shown).
 */
export function applyNativeSubtitleVisibility(): void {
  if (!state.video) return;
  clearNativeCaptionOverride();
  if (settings.viewMode === "rolling") {
    setNativeCueHidden(true);
  } else {
    // Single mode: reveal TV 2's own caption. renderSingleModeNative() will
    // re-suppress it and mount our overlay when a translation is active.
    setNativeCueHidden(false);
  }
}

/** Remove all native-caption suppression (used when tearing the overlay down). */
export function clearNativeSubtitleHiding(): void {
  clearNativeCaptionOverride();
  setNativeCueHidden(false);
}

/* ------------------------------------------------------------------ *
 * Single mode: show a styled translated / bilingual caption in place of
 * TV 2's own, WITHOUT touching TV 2's caption text nodes.
 *
 * RxPlayer paints each cue into `.rxp-texttrack-*` nodes. Rewriting those breaks
 * its rendering (and freezes after a seek), so instead we:
 *   - keep the native caption suppressed via the reversible stylesheet above
 *     (setNativeCueHidden), and
 *   - append our own absolutely-positioned overlay element into the player's
 *     video-sized box and render the styled lines there.
 * The renderer drives our overlay's content from the video's current time. A
 * MutationObserver on the player box re-mounts our overlay if the player rebuilds
 * the subtree (e.g. across a re-render).
 * ------------------------------------------------------------------ */

const OVERLAY_CLASS = "nsr-cap-overlay";
const ROOT_REL_CLASS = "nsr-cap-root-rel";
const LIFT_CLASS = "nsr-cap-lift";

let captionObserver: MutationObserver | null = null;
let overrideEl: HTMLDivElement | null = null;
let rootEl: HTMLElement | null = null;
let overrideActive = false;
let lastHtml: string | null = null;
let liftTimer: number | null = null;

let singleRefreshCb: (() => void) | null = null;
let refreshScheduled = false;

/** Renderer registers its single-mode recompute here (avoids an import cycle). */
export function setSingleRefreshHandler(cb: () => void): void {
  singleRefreshCb = cb;
}

function scheduleSingleRefresh(): void {
  if (refreshScheduled || !singleRefreshCb) return;
  refreshScheduled = true;
  requestAnimationFrame(() => {
    refreshScheduled = false;
    singleRefreshCb?.();
  });
}

/**
 * The containing block the player itself uses to position its caption: the
 * closest positioned ancestor of the <video>. This element is sized to the video
 * (the player's aspect-ratio box), so an absolutely-positioned overlay in it
 * lines up with the bottom of the picture — unlike a page-level container (which
 * can be a full-height element and make `bottom:6%` resolve far off-screen).
 */
function captionAnchor(): { el: HTMLElement; wasStatic: boolean } | null {
  const video = state.video;
  if (!video) return null;
  let el: HTMLElement | null = video.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    if (getComputedStyle(el).position !== "static") return { el, wasStatic: false };
    el = el.parentElement;
  }
  // No positioned ancestor found — fall back to the video's direct parent and
  // make it a positioning context ourselves.
  const fallback = (video.parentElement as HTMLElement | null) ?? video;
  return { el: fallback, wasStatic: true };
}

/**
 * Ensure our overlay is mounted in the video-sized player box, positioned over
 * the bottom of the picture. Returns false if no anchor is available yet.
 */
function ensureOverrideMounted(): boolean {
  const anchor = captionAnchor();
  if (!anchor) return false;
  const root = anchor.el;
  if (anchor.wasStatic && !root.classList.contains(ROOT_REL_CLASS)) root.classList.add(ROOT_REL_CLASS);
  rootEl = root;

  if (!overrideEl) {
    overrideEl = document.createElement("div");
    overrideEl.className = OVERLAY_CLASS;
  }
  if (overrideEl.parentElement !== root) root.appendChild(overrideEl);
  return true;
}

function ensureCaptionObserver(): void {
  if (captionObserver) return;
  const root = rootEl;
  if (!root) return;
  captionObserver = new MutationObserver(() => {
    if (!overrideActive) return;
    // The player may rebuild its subtree (new cue, resize, etc.), which can drop
    // our overlay. Re-mount it, then let the renderer refresh its content.
    if (!overrideEl || !overrideEl.parentElement) {
      ensureOverrideMounted();
      scheduleSingleRefresh();
    }
  });
  captionObserver.observe(root, { childList: true, subtree: true });
}

function stopCaptionObserver(): void {
  captionObserver?.disconnect();
  captionObserver = null;
}

/**
 * Whether the player's controls (scrubber / control bar) are currently visible.
 * TV 2 fades the controls in/out via opacity, so we lift our caption to clear the
 * control bar only while they're showing.
 */
function controlsVisible(): boolean {
  let bar: HTMLElement | null = null;
  for (const sel of TV2.scrubberSelectors) {
    bar = document.querySelector<HTMLElement>(sel);
    if (bar) break;
  }
  if (!bar) return false;
  const anyEl = bar as unknown as {
    checkVisibility?: (opts?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean;
  };
  if (typeof anyEl.checkVisibility === "function") {
    return anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  const r = bar.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Toggle the "lift" class so the caption clears the control bar when shown. */
function updateLift(): void {
  if (!overrideEl) return;
  overrideEl.classList.toggle(LIFT_CLASS, controlsVisible());
}

function startLiftPolling(): void {
  if (liftTimer !== null) return;
  liftTimer = window.setInterval(updateLift, 200);
}

function stopLiftPolling(): void {
  if (liftTimer !== null) {
    clearInterval(liftTimer);
    liftTimer = null;
  }
}

function nativeCaptionEl(): HTMLElement | null {
  for (const sel of TV2.captionTextSelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

function syncOverlayFontSize(): void {
  if (!overrideEl) return;
  const el = nativeCaptionEl();
  const nativePx = el ? parseFloat(getComputedStyle(el).fontSize) : NaN;
  const scale = settings.fontSize / FONT.default;
  if (Number.isFinite(nativePx) && nativePx > 0) {
    overrideEl.style.fontSize = `${nativePx * scale}px`;
  } else {
    // Fallback if TV 2's caption isn't measurable yet: scale a sensible base.
    overrideEl.style.fontSize = `${18 * scale}px`;
  }
}

/**
 * Show `html` as the on-video caption in place of TV 2's own, for single mode.
 * `html` is the styled markup (a translated line, or original + translated lines
 * for bilingual). TV 2's own caption text is hidden via CSS (setNativeCueHidden),
 * never edited; this only manages our overlay element.
 */
export function setNativeCaptionOverride(html: string): void {
  overrideActive = true;
  if (!ensureOverrideMounted()) return;
  if (html !== lastHtml) {
    overrideEl!.innerHTML = html;
    lastHtml = html;
  }
  syncOverlayFontSize();
  updateLift();
  startLiftPolling();
  ensureCaptionObserver();
}

/** Drop any active caption override (removes our overlay only). */
export function clearNativeCaptionOverride(): void {
  overrideActive = false;
  lastHtml = null;
  if (rootEl) {
    rootEl.classList.remove(ROOT_REL_CLASS);
    rootEl = null;
  }
  if (overrideEl) {
    overrideEl.parentElement?.removeChild(overrideEl);
    overrideEl.innerHTML = "";
    overrideEl.classList.remove(LIFT_CLASS);
  }
  stopLiftPolling();
  stopCaptionObserver();
}
