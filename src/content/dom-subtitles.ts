/**
 * DOM-scraping subtitle capture for TV 2 Play (RxPlayer) — the FALLBACK path.
 *
 * TV 2 Play's player (Canal+ RxPlayer) does NOT expose subtitles as native
 * HTML5 `TextTrack`s — `video.textTracks` is empty. Instead it paints the active
 * subtitle into DOM nodes:
 *
 *   div.rxp-texttrack-region            (one per on-screen caption block)
 *     p.rxp-texttrack-p                 (one per line)
 *       span.rxp-texttrack-span ...     (line text, possibly split)
 *
 * The primary capture path (ttml-subtitles.ts) reads the player's TTML segments
 * and provides accurate, look-ahead cues. This DOM scraper is a safety net for
 * when that isn't available (e.g. the MAIN-world hook couldn't install): it
 * samples the rendered caption and records a cue each time the text changes.
 * Its inherent limit is that it only ever sees the line currently on screen, so
 * on its own it cannot show upcoming lines.
 *
 * Both paths write to the shared cue store (subtitle-store.ts), which merges
 * duplicates, so running them together is safe.
 */

import { normalizeWhitespace } from "./utils";
import {
  upsertCue,
  publishCues,
  isTtmlActive,
  calibrateFromDisplay,
  anchorFromDisplay,
  subDebug,
} from "./subtitle-store";

/** RxPlayer's rendered-subtitle containers. */
const REGION_SELECTOR = ".rxp-texttrack-region";
const LINE_SELECTOR = ".rxp-texttrack-p";

/** How often to sample the rendered subtitle text. */
const SAMPLE_MS = 250;

let video: HTMLVideoElement | null = null;
let timer: number | null = null;
let observer: MutationObserver | null = null;
let onSeeked: (() => void) | null = null;
let heartbeat = 0;

let openCue: VTTCue | null = null;
/** Text of the currently displayed caption ("" when none). */
let lastText = "";

/** True while the DOM scraper is running (used to guard video.ts). */
export function isDomCaptureActive(): boolean {
  return timer !== null;
}

/** Read the currently rendered subtitle text (lines joined with newlines). */
function readRenderedText(): string {
  const regions = document.querySelectorAll(REGION_SELECTOR);
  if (!regions.length) return "";
  const lines: string[] = [];
  regions.forEach((region) => {
    const paras = region.querySelectorAll(LINE_SELECTOR);
    if (paras.length) {
      paras.forEach((p) => {
        const line = normalizeWhitespace(p.textContent || "");
        if (line) lines.push(line);
      });
    } else {
      const line = normalizeWhitespace(region.textContent || "");
      if (line) lines.push(line);
    }
  });
  return lines.join("\n");
}

function sample(): void {
  if (!video) return;
  const now = video.currentTime;
  const text = readRenderedText();

  // Low-frequency heartbeat so we can tell whether the region nodes are reachable
  // from this frame at all (independent of whether calibration matches).
  if (subDebug() && ++heartbeat % 12 === 0) {
    console.log(
      "[tv2sub] dom heartbeat t=", now.toFixed(2),
      "regions=", document.querySelectorAll(REGION_SELECTOR).length,
      "ttmlActive=", isTtmlActive(),
      "text=", JSON.stringify(text)
    );
  }

  // Once TTML owns the cue list, the scraper no longer adds cues — but it stays
  // running as a timing reference: it knows the true currentTime of the caption
  // on screen, which is what calibrates the TTML->video offset.
  if (isTtmlActive()) {
    // Re-run the direct text anchor while a caption remains visible. This also
    // catches a TTML segment that arrives after its caption first appeared.
    if (text) anchorFromDisplay(now, text);
    if (text && text !== lastText) calibrateFromDisplay(now, text);
    lastText = text;
    return;
  }

  if (text === lastText) {
    // Same caption still on screen: keep its end time current.
    if (openCue && now > openCue.endTime) openCue.endTime = now;
    return;
  }

  // Caption changed: close the previous one at the current time.
  if (openCue && now > openCue.endTime) openCue.endTime = now;
  openCue = null;
  lastText = text;

  if (text) {
    // upsertCue merges with an existing (e.g. TTML-provided) cue for the same
    // line, so this never double-records what the primary path already has.
    openCue = upsertCue(now, now + 0.001, text, "dom");
    publishCues();
  }
}

/** Begin scraping rendered subtitles for `v`. Safe to call repeatedly. */
export function startDomSubtitleCapture(v: HTMLVideoElement): void {
  if (timer !== null && video === v) return;
  stopDomSubtitleCapture();

  video = v;
  openCue = null;
  lastText = "";

  // Sampling on a timer is resilient to however RxPlayer mutates its nodes; a
  // MutationObserver adds low-latency reaction on top of it.
  timer = self.setInterval(sample, SAMPLE_MS);

  observer = new MutationObserver(() => sample());
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
  });

  // A seek breaks caption continuity: finalise the open cue and force the next
  // sample to treat whatever is on screen as a fresh caption.
  onSeeked = () => {
    if (openCue && video) openCue.endTime = Math.max(openCue.endTime, video.currentTime);
    openCue = null;
    lastText = "\u0000"; // sentinel that never equals real subtitle text
  };
  v.addEventListener("seeked", onSeeked);
}

/** Stop scraping and release observers/listeners (keeps captured cues intact). */
export function stopDomSubtitleCapture(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (video && onSeeked) video.removeEventListener("seeked", onSeeked);
  onSeeked = null;
  video = null;
  openCue = null;
  lastText = "";
}
