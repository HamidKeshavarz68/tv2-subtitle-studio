/**
 * Shared, start-ordered cue store for player-agnostic subtitle capture.
 *
 * TV 2 Play never exposes native HTML5 TextTracks, so cues arrive from two
 * capture paths that both feed this single store:
 *   - ttml-subtitles.ts : parses the DASH TTML segments RxPlayer downloads. These
 *     carry accurate begin/end times AND are buffered a bit AHEAD of the playhead,
 *     which is what gives the overlay real look-ahead (upcoming lines).
 *   - dom-subtitles.ts  : scrapes the on-screen caption node as a fallback (only
 *     ever knows the current line).
 *
 * Cues are merged by (start, text) within a small tolerance, so the same line
 * seen by both paths — or re-fetched after a seek — collapses to one entry. The
 * store owns pushing the sorted list into `state.cues` and refreshing the
 * render / translate pipeline.
 */

import { state } from "../core/state";
import { updateStatus, invalidateRender, render } from "../ui/renderer";
import { onTranslationConfigChanged } from "../translation/translator";
import { normalizeCueKey } from "../core/utils";

/** Two cues with equal text starting within this window are the same cue. */
const DEDUP_START_TOLERANCE = 0.6;
/** Equal-text cues whose time ranges touch within this gap are also merged
 *  (handles a caption that spans a segment boundary and is emitted twice). */
const MERGE_GAP = 0.35;

/** Where a cue came from, so DOM-scraped noise can be dropped once TTML wins. */
type CueSource = "ttml" | "dom";

let cues: VTTCue[] = [];
let reindexPending = false;
/**
 * Once the TTML path (accurate, look-ahead) has delivered cues it becomes the
 * authoritative source: the DOM scraper stops adding cues and any it added
 * before TTML kicked in are dropped. This removes the duplicate/flicker the
 * scraper produces for multi-line captions that render incrementally.
 */
let ttmlActive = false;

/**
 * TV 2's DASH media timeline is offset from `video.currentTime` (a DASH
 * presentation-time offset), so raw TTML `begin`/`end` values do NOT line up
 * with the video clock. We learn the offset at runtime by matching the caption
 * the player is actually showing (the DOM scraper knows its true `currentTime`)
 * to the TTML cue with the same text: `offset = currentTime - rawTtmlBegin`.
 * Stored TTML cue times already have `ttmlOffset` folded in; on the raw side we
 * keep a text -> raw-begin index purely to resolve that match.
 */
let ttmlOffset = 0;
let offsetLocked = false;
const offsetSamples: number[] = [];
const textIndex = new Map<string, number[]>();

/** Console debug gated behind `localStorage.tv2sub_debug = "1"`. */
export function subDebug(): boolean {
  try {
    return localStorage.getItem("tv2sub_debug") === "1";
  } catch {
    return false;
  }
}
function dlog(...args: unknown[]): void {
  if (subDebug()) console.log("[tv2sub]", ...args);
}

/** True once TTML cues have arrived; the DOM scraper should then stand down. */
export function isTtmlActive(): boolean {
  return ttmlActive;
}

/** Discard everything (called when a new video is attached). */
export function resetSubtitleStore(): void {
  cues = [];
  reindexPending = false;
  ttmlActive = false;
  state.activeCue = null;
  ttmlOffset = 0;
  offsetLocked = false;
  offsetSamples.length = 0;
  textIndex.clear();
}

export function subtitleStoreSize(): number {
  return cues.length;
}

/** Index of the first cue with startTime >= t (binary search). */
function lowerBound(t: number): number {
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].startTime < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Insert a cue, or update a near-identical existing one (same text, start within
 * tolerance) by extending its end time. Returns the stored cue in either case,
 * so a caller (the DOM scraper) can keep mutating an "open" cue's end while the
 * caption stays on screen. `source` records provenance so DOM cues can be purged
 * once TTML takes over; when TTML re-confirms a DOM cue it upgrades its source.
 */
export function upsertCue(
  start: number,
  end: number,
  text: string,
  source: CueSource
): VTTCue {
  if (source === "ttml") {
    // Index the RAW begin against the text so calibration can resolve it, then
    // fold in the learned offset so stored times sit on the video clock.
    registerTtmlText(text, start);
    start += ttmlOffset;
    end += ttmlOffset;
  }

  const idx = lowerBound(start);
  for (const j of [idx - 1, idx]) {
    const near = cues[j];
    if (!near || near.text !== text) continue;
    const startsClose = Math.abs(near.startTime - start) <= DEDUP_START_TOLERANCE;
    const rangesTouch =
      start <= near.endTime + MERGE_GAP && end >= near.startTime - MERGE_GAP;
    if (startsClose || rangesTouch) {
      // Same line already known: widen its end (keep the earlier, truer start).
      if (end > near.endTime) near.endTime = end;
      if (source === "ttml") near.id = "ttml";
      return near;
    }
  }

  const cue = new VTTCue(start, Math.max(end, start + 0.001), text);
  cue.id = source;
  const appending = idx >= cues.length;
  cues.splice(idx, 0, cue);
  // Appending keeps existing indices stable, so index-keyed translations stay
  // valid. An out-of-order insert (e.g. a segment for an earlier time arriving
  // after a seek) shifts later indices, so translation state must be reset.
  if (!appending) reindexPending = true;
  return cue;
}

/**
 * Promote TTML to the authoritative source (called on the first TTML cue). Drops
 * any cues the DOM scraper contributed before TTML arrived so they don't linger
 * as duplicates. Idempotent.
 */
export function activateTtml(): void {
  if (ttmlActive) return;
  ttmlActive = true;
  const before = cues.length;
  cues = cues.filter((c) => c.id === "ttml");
  if (cues.length !== before) reindexPending = true;
}

/** Record a TTML cue's text -> raw begin time (for offset calibration). */
function registerTtmlText(text: string, rawStart: number): void {
  const key = normalizeCueKey(text);
  if (!key) return;
  let arr = textIndex.get(key);
  if (!arr) {
    arr = [];
    textIndex.set(key, arr);
  }
  if (!arr.some((s) => Math.abs(s - rawStart) < 0.05)) arr.push(rawStart);
}

/**
 * Make the caption TV 2 is actually rendering authoritative for the active row.
 * TTML times can use a discontinuous DASH clock, but cue order and text remain
 * reliable. This gives exact current/upcoming alignment without depending on
 * presentation-time offset inference.
 */
export function anchorFromDisplay(now: number, displayedText: string): void {
  const key = normalizeCueKey(displayedText);
  const matches = cues.filter(
    (cue) => cue.id === "ttml" && normalizeCueKey(cue.text) === key
  );
  if (!matches.length) return;

  let match = matches[0];
  if (matches.length > 1) {
    const currentIndex = state.activeCue ? cues.indexOf(state.activeCue as VTTCue) : -1;
    const forward = matches.find((cue) => cues.indexOf(cue) >= currentIndex);
    if (forward) {
      match = forward;
    } else {
      match = matches.reduce((best, cue) =>
        Math.abs(cue.startTime - now) < Math.abs(best.startTime - now) ? cue : best
      );
    }
  }

  if (state.activeCue === match) return;
  state.activeCue = match;
  dlog("ANCHOR cue=", cues.indexOf(match), "t=", now.toFixed(2), "text=", JSON.stringify(match.text));
  invalidateRender();
  render();
}

/**
 * Calibrate the TTML->video time offset from the caption currently on screen.
 * `now` is the true `video.currentTime`; `displayedText` is what the player is
 * rendering. Matching that to the TTML cue with the same text yields the offset.
 * The first lock requires a text unique in the TTML set (so the match is
 * unambiguous); afterwards a running median keeps it stable.
 */
export function calibrateFromDisplay(now: number, displayedText: string): void {
  if (!ttmlActive) return;
  const key = normalizeCueKey(displayedText);
  anchorFromDisplay(now, displayedText);
  const starts = textIndex.get(key);
  if (!starts || !starts.length) {
    dlog("calib MISS  now=", now.toFixed(2), "key=", JSON.stringify(key), "(no TTML text match; indexSize=", textIndex.size, ")");
    return;
  }

  let raw: number;
  let discontinuity = false;
  if (!offsetLocked) {
    if (starts.length !== 1) {
      dlog("calib skip  ambiguous text (", starts.length, "occurrences) key=", JSON.stringify(key));
      return; // need an unambiguous line to lock onto
    }
    raw = starts[0];
  } else {
    // Pick the occurrence whose mapped time is nearest the playhead.
    raw = starts[0];
    let bestErr = Math.abs(raw + ttmlOffset - now);
    for (const s of starts) {
      const err = Math.abs(s + ttmlOffset - now);
      if (err < bestErr) {
        bestErr = err;
        raw = s;
      }
    }
    if (bestErr > 3) {
      // DASH presentation offsets can jump between periods (for example after
      // an ad). A unique caption is safe to use as a new anchor; repeated text
      // remains ambiguous and must not move the timeline.
      if (starts.length !== 1) {
        dlog("calib skip  discontinuity with ambiguous text key=", JSON.stringify(key));
        return;
      }
      raw = starts[0];
      discontinuity = true;
      offsetSamples.length = 0;
    }
  }

  offsetSamples.push(now - raw);
  if (offsetSamples.length > 7) offsetSamples.shift();
  const sorted = offsetSamples.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  offsetLocked = true;
  if (discontinuity) {
    dlog(
      "calib JUMP  now=", now.toFixed(2),
      "raw=", raw.toFixed(2),
      "oldOffset=", ttmlOffset.toFixed(2),
      "newOffset=", median.toFixed(2)
    );
  }
  dlog("calib HIT   now=", now.toFixed(2), "raw=", raw.toFixed(2), "=> offset=", (now - raw).toFixed(2), "median=", median.toFixed(2));
  if (Math.abs(median - ttmlOffset) > 0.25) {
    // On a period jump, preserve already-played history and rebase only the
    // matched cue and everything after it. Initial lock and small refinements
    // still shift the complete current cue set.
    const fromTime = discontinuity ? raw + ttmlOffset - 0.01 : -Infinity;
    applyOffset(median, fromTime);
  }
}

/** Shift every stored TTML cue onto the newly learned offset and re-render. */
function applyOffset(newOffset: number, fromTime: number): void {
  const delta = newOffset - ttmlOffset;
  ttmlOffset = newOffset;
  if (Math.abs(delta) < 1e-6) return;
  let shifted = 0;
  for (const c of cues) {
    if (c.id !== "ttml" || c.startTime < fromTime) continue;
    c.startTime += delta;
    c.endTime += delta;
    shifted++;
  }
  dlog("APPLY offset=", newOffset.toFixed(2), "delta=", delta.toFixed(2), "cues=", shifted);
  // Uniform shift preserves ordering and indices, so no translation reset.
  publishCues();
}

/** Publish the current cue list to shared state and refresh the overlay. */
export function publishCues(): void {
  state.cues = cues;
  if (reindexPending) {
    reindexPending = false;
    // Resets the (content-cached) translations, updates status, and re-renders.
    onTranslationConfigChanged();
  } else {
    updateStatus();
    invalidateRender();
    render();
  }
}
