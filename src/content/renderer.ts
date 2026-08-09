/**
 * Status line + rolling-window rendering of the cue list.
 *
 * On every `timeupdate` a binary search finds the active cue (most recent cue
 * with `startTime ≤ currentTime`). It stays active through the silent gap until
 * the next cue starts, so the current line never disappears between subtitles.
 * The visible window is re-rendered only when its contents or translation
 * states change, and the active line auto-scrolls to the centre.
 */

import { ROLL } from "./config";
import { detectSourceLang, isTranslationActive, settings, state } from "./state";
import { cueText, escapeHtml, formatTime } from "./utils";
import { listEl, statusEl, syncFooterTip } from "./overlay";
import {
  setNativeCueHidden,
  setNativeCaptionOverride,
  clearNativeCaptionOverride,
  setSingleRefreshHandler,
} from "./native-subtitles";
import { enqueueTranslate, getTranslation } from "./translator";
import { readDisplayedCaption } from "./dom-subtitles";
import { t } from "./i18n";

export function setStatus(text: string): void {
  statusEl.textContent = text;
}

export function updateStatus(): void {
  if (!isTranslationActive()) {
    setStatus(state.track?.language || state.track?.label || "");
  } else {
    setStatus(`${detectSourceLang()} → ${settings.targetLang}`);
  }
}

/** Force the next render() to rebuild even if the window signature matches. */
export function invalidateRender(): void {
  (listEl as any).__nsrSig = null;
}

/** Index of the last cue whose startTime ≤ t (binary search), or -1. */
function findActiveIndex(t: number): number {
  let lo = 0;
  let hi = state.cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (state.cues[mid].startTime <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx;
}

function translatedHtmlFor(idx: number): string {
  enqueueTranslate(idx);
  const tr = getTranslation(idx);
  if (tr?.state === "done") return escapeHtml(tr.text).replace(/\n/g, "<br/>");
  if (tr?.state === "error") {
    return `<span class="nsr-warn" title="${escapeHtml(t("translation_failed"))}">⚠</span>`;
  }
  return `<span class="nsr-pending">…</span>`;
}

function cueInnerHtml(idx: number, original: string): string {
  if (!isTranslationActive()) {
    return `<span class="nsr-orig">${original}</span>`;
  }
  const translated = translatedHtmlFor(idx);
  if (settings.displayMode === "translated") {
    return `<span class="nsr-trans">${translated}</span>`;
  }
  return (
    `<span class="nsr-orig">${original}</span>` +
    `<span class="nsr-trans">${translated}</span>`
  );
}

/**
 * Single-mode display: TV 2 Play's own native single-line caption is used.
 *  - Original (or translation off): leave TV 2's caption exactly as it renders.
 *  - Translated: once ready, show a single translated line in the same spot.
 *  - Bilingual: show two styled lines — original on top, translation below. The
 *    translation line reserves its space immediately and is revealed in place
 *    once ready, so the original never jumps. Upcoming cues are pre-translated so
 *    the translation is usually ready before its cue even appears.
 */
const SINGLE_PREFETCH = 4;

function capLine(cls: string, inner: string): string {
  return `<span class="nsr-cap-line"><span class="${cls}">${inner}</span></span>`;
}

const normKey = (s: string): string => s.replace(/\s+/g, "").toLowerCase();

/**
 * Resolve the cue index for the caption TV 2 is painting right now, matching by
 * TEXT rather than time. TTML cues sit on TV 2's DASH timeline and only line up
 * with `video.currentTime` after calibration locks (which needs a seek/repaint),
 * so a time search returns nothing on autoplay. Matching the live on-screen text
 * to a cue gives us the right entry immediately — and its index drives the
 * translation lookup. Returns -1 when no cue matches yet.
 */
function cueIndexForDisplayed(displayed: string): number {
  const key = normKey(displayed);
  if (!key) return -1;
  // Prefer the display-anchored cue (the scraper already disambiguated repeats).
  if (state.activeCue && normKey(cueText(state.activeCue as VTTCue)) === key) {
    const i = state.cues.indexOf(state.activeCue as VTTCue);
    if (i >= 0) return i;
  }
  const now = state.video?.currentTime ?? 0;
  let best = -1;
  let bestErr = Infinity;
  for (let i = 0; i < state.cues.length; i++) {
    const c = state.cues[i] as VTTCue;
    if (normKey(cueText(c)) !== key) continue;
    const err = Math.abs(c.startTime - now);
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  return best;
}

function renderSingleModeNative(): void {
  // Translation off / Original → let TV 2 render its own caption untouched.
  if (!isTranslationActive()) {
    clearNativeCaptionOverride();
    setNativeCueHidden(false);
    return;
  }

  // Translation active: keep TV 2's native caption suppressed for the whole
  // duration (not just when we have a cue). Removing the suppression during the
  // gap between cues made TV 2's original flash for a frame when the next cue
  // painted, before our overlay caught up. Now only the overlay CONTENT changes;
  // TV 2's text stays hidden throughout, so there is no flash.
  setNativeCueHidden(true);

  // Drive the overlay from the caption TV 2 is actually painting right now, not
  // from the cue list's time window: on autoplay the TTML timeline is not yet
  // calibrated to the video clock, so a time search shows nothing until a seek.
  // The live scraped text is always correct, so the styled line appears at once.
  const displayed = readDisplayedCaption();
  if (!displayed) {
    setNativeCaptionOverride(""); // in the gap: suppressed, nothing shown
    return;
  }

  const active = cueIndexForDisplayed(displayed);

  // Pre-translate the active cue and the next few so the translation is ready
  // before each cue appears — removes the "original shows first, translation
  // pops in" flash for the common case.
  if (active >= 0) {
    const lookahead = Math.min(state.cues.length, active + 1 + SINGLE_PREFETCH);
    for (let i = active; i < lookahead; i++) enqueueTranslate(i);
  }

  // Fall back to the live scraped text as the original when no cue matches yet
  // (TTML not delivered), so the caption is never blank on autoplay.
  const original = active >= 0 ? cueText(state.cues[active] as VTTCue) : displayed;
  const tr = active >= 0 ? getTranslation(active) : undefined;
  const origHtml = escapeHtml(original).replace(/\n/g, "<br/>");
  const transReady = tr?.state === "done";
  const transHtml = transReady ? escapeHtml(tr!.text).replace(/\n/g, "<br/>") : "";

  if (settings.displayMode === "translated") {
    // Single translated line. Until the translation resolves, show the original
    // in our own overlay (same position/style) so the caption is never blank and
    // TV 2's native text never flashes; the text swaps to the translation in
    // place once ready.
    const inner = transReady ? transHtml : origHtml;
    setNativeCaptionOverride(capLine("nsr-cap-trans", inner));
    return;
  }

  // Bilingual: always two lines so the layout never reflows when the
  // translation arrives.
  const origLine = capLine("nsr-cap-orig", origHtml);
  let transLine: string;
  if (transReady) {
    transLine = capLine("nsr-cap-trans", transHtml);
  } else if (tr?.state === "error") {
    transLine = capLine("nsr-cap-trans nsr-cap-warn", "⚠");
  } else {
    // Reserve the translation line's height (hidden) so it can be filled in
    // place without shifting the original upward.
    transLine = capLine("nsr-cap-trans nsr-cap-pending", "…");
  }
  setNativeCaptionOverride(origLine + transLine);
}

export function render(): void {
  // In single mode TV 2's own captions are shown (Original) or replaced by our
  // single line (Translated / Bilingual); the rolling overlay window is hidden.
  if (settings.viewMode === "single") {
    renderSingleModeNative();
    return;
  }

  syncFooterTip();
  if (!state.cues.length) {
    listEl.innerHTML = `<div class="nsr-empty">${t("empty")}</div>`;
    return;
  }

  const now = state.video?.currentTime ?? 0;
  const anchored = state.activeCue ? state.cues.indexOf(state.activeCue) : -1;
  const active = anchored >= 0 ? anchored : findActiveIndex(now);

  const anchor = active >= 0 ? active : Math.max(0, active + 1);
  const start = Math.max(0, anchor - ROLL.past);
  const end = Math.min(state.cues.length, anchor + ROLL.future);

  // Re-render only when window, active state, or visible translation states change.
  let trSig = "";
  if (isTranslationActive()) {
    for (let i = start; i < end; i++) {
      const tr = getTranslation(i);
      trSig += tr ? (tr.state === "done" ? "d" : tr.state === "error" ? "e" : "p") : "_";
    }
  }
  const sig = `${start}|${end}|${active}|${settings.targetLang}|${settings.displayMode}|${trSig}`;
  if ((listEl as any).__nsrSig === sig) return;
  (listEl as any).__nsrSig = sig;

  const parts: string[] = [];
  for (let i = start; i < end; i++) {
    const c = state.cues[i] as VTTCue;
    // A cue is "past" only once the NEXT cue has started (or, for the last cue,
    // once its own endTime has passed) — keeps the active line lit through gaps.
    const next = state.cues[i + 1] as VTTCue | undefined;
    const isPast = anchored >= 0
      ? i < active
      : next ? next.startTime <= now : c.endTime < now;
    const cls =
      i === active ? "nsr-cue nsr-active" :
      isPast ? "nsr-cue nsr-past" :
      "nsr-cue nsr-future";
    const original = escapeHtml(cueText(c)).replace(/\n/g, "<br/>");

    parts.push(
      `<div class="${cls}" data-start="${c.startTime}">
         <span class="nsr-t">${formatTime(c.startTime)}</span>
         <span class="nsr-x">${cueInnerHtml(i, original)}</span>
       </div>`
    );
  }
  listEl.innerHTML = parts.join("");

  const activeEl = listEl.querySelector(".nsr-active") as HTMLElement | null;
  if (activeEl) {
    // Pin the active cue's TOP at a fixed offset inside the list so its
    // on-screen Y stays put when:
    //   - cues above/below change height (translations arriving, new cues
    //     appended) — scrollTop is recomputed from offsetTop so the active
    //     line is re-anchored to the same screen position.
    //   - the active cue itself grows (e.g. a translation appears beneath
    //     the original) — pinning the TOP (not the centre) means the
    //     original line doesn't move; new content extends downward.
    // Snap instantly on re-renders to avoid visible bobbing; only animate
    // when the active cue index actually changes (a true line transition).
    const prevActive = (listEl as any).__nsrActive as number | undefined;
    const offsetFromTop = Math.round(listEl.clientHeight * 0.4);
    const target = Math.max(0, activeEl.offsetTop - offsetFromTop);
    if (prevActive === active) {
      // Direct assignment bypasses the CSS `scroll-behavior: smooth` rule
      // (which would otherwise animate every adjustment and cause shake).
      listEl.scrollTop = target;
    } else {
      listEl.scrollTo({ top: target, behavior: "smooth" });
    }
    (listEl as any).__nsrActive = active;
  }
}

// Let native-subtitles re-drive single-mode rendering the instant the player
// repaints its caption (a new cue), so the styled/translated line appears
// without lag.
setSingleRefreshHandler(render);
