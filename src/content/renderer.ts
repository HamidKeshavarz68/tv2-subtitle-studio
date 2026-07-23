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
import { listEl, statusEl } from "./overlay";
import { hideNativeDomSubtitles } from "./native-subtitles";
import { enqueueTranslate, getTranslation } from "./translator";
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

export function render(): void {
  if (!state.cues.length) {
    listEl.innerHTML = `<div class="nsr-empty">${t("empty")}</div>`;
    return;
  }

  const now = state.video?.currentTime ?? 0;
  const active = findActiveIndex(now);

  // Hide the player's DOM-rendered subtitle for the active cue. Must run every render,
  // not gated by the window-change cache below.
  hideNativeDomSubtitles(active >= 0 ? (state.cues[active] as VTTCue) : null, now);

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
    const isPast = next ? next.startTime <= now : c.endTime < now;
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
