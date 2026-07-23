/**
 * Video / text-track discovery and cue capture.
 *
 * play.tv2.no is a SPA, so the <video> appears asynchronously and can be swapped
 * across navigations. We attach listeners (cleanly detachable), read the user's
 * subtitle track WITHOUT changing its `mode` (see attach below), and snapshot
 * cues into shared state whenever they grow.
 */

import { applyPlaybackRate, settings, state } from "./state";
import { isSubtitleTrack } from "./utils";
import { render, setStatus, updateStatus, invalidateRender } from "./renderer";
import { onTranslationConfigChanged, stopTranslations } from "./translator";
import { startDomSubtitleCapture, stopDomSubtitleCapture, isDomCaptureActive } from "./dom-subtitles";
import { startTtmlCapture, stopTtmlCapture } from "./ttml-subtitles";
import { resetSubtitleStore } from "./subtitle-store";
import { applyNativeSubtitleVisibility } from "./native-subtitles";

/** Marker so each track is hooked for cue updates only once. */
const HOOKED = "__nsrHooked";

let detach: (() => void) | null = null;

/**
 * Signature of the last snapshotted cue set. The player streams subtitles in
 * segments and evicts cues outside the back-buffer, so the cue count is NOT
 * monotonic — it can stay the same or shrink while the actual cues change. We
 * therefore track a content signature (count + boundary timestamps) instead of
 * relying on length alone to decide whether the snapshot is stale.
 */
let lastCueSig = "";

/**
 * Start time of the first cue in the last snapshot. The per-cue translation map
 * is keyed by index; if the player evicts cues from the front, indices shift and
 * those mappings would point at the wrong cue. We detect a front shift via this
 * timestamp and reset the (content-cached) translation state so it rehydrates
 * against the correct cues.
 */
let lastFirstStart = -1;

export function findVideo(): HTMLVideoElement | null {
  const list = Array.from(document.querySelectorAll("video"));
  if (!list.length) return null;

  let best: HTMLVideoElement | null = null;
  let bestScore = -Infinity;

  for (const v of list) {
    const hasSource = v.duration > 0 || v.readyState > 0 || !!v.src || !!v.currentSrc;
    if (!hasSource) continue;

    const rect = v.getBoundingClientRect();
    const cs = getComputedStyle(v);
    const visible =
      rect.width >= 160 &&
      rect.height >= 90 &&
      cs.display !== "none" &&
      cs.visibility !== "hidden" &&
      Number(cs.opacity || "1") > 0.05 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;
    const playing = !v.paused && !v.ended && v.readyState >= 2;
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const score =
      (visible ? 1_000_000_000 : 0) +
      (playing ? 100_000_000 : 0) +
      area +
      v.readyState * 1_000 +
      (Number.isFinite(v.duration) ? 10 : 0);

    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }

  return best ?? list[0] ?? null;
}

export function attachToVideo(video: HTMLVideoElement): void {
  if (state.video === video) return;
  detachVideo();

  state.video = video;
  state.cues = [];
  state.activeCue = null;
  state.track = null;
  lastCueSig = "";
  lastFirstStart = -1;
  resetSubtitleStore();
  setStatus("video found");

  const refresh = () => scanTextTracks(video);
  const onSeeked = () => render();
  // On every tick, cheaply re-sync the active track's cues (signature-guarded so
  // it's a no-op when nothing changed) then render. This recovers even if a
  // `cuechange` event is missed when the player evicts/replaces buffered cues.
  const onTimeUpdate = () => {
    // If the tracked subtitle track was turned off (mode 'disabled' → cues go
    // null), re-scan so stale cues get cleared promptly and the tip shows,
    // rather than freezing on the last-loaded cues until the periodic scan.
    if (state.track) {
      if (state.track.mode === "disabled" || !state.track.cues) {
        scanTextTracks(video);
      } else {
        snapshotCues(state.track);
      }
    }
    render();
  };
  const onRateChange = () => {
    if (Math.abs(video.playbackRate - settings.playbackRate) > 0.001) {
      try { video.playbackRate = settings.playbackRate; } catch { /* ignore */ }
    }
  };

  video.textTracks.addEventListener("addtrack", refresh);
  video.textTracks.addEventListener("removetrack", refresh);
  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("seeked", onSeeked);
  video.addEventListener("loadedmetadata", refresh);
  // Re-apply our chosen playback rate if the player resets it.
  video.addEventListener("ratechange", onRateChange);

  detach = () => {
    video.textTracks.removeEventListener("addtrack", refresh);
    video.textTracks.removeEventListener("removetrack", refresh);
    video.removeEventListener("timeupdate", onTimeUpdate);
    video.removeEventListener("seeked", onSeeked);
    video.removeEventListener("loadedmetadata", refresh);
    video.removeEventListener("ratechange", onRateChange);
  };

  applyPlaybackRate();
  refresh();

  // TV 2 Play (RxPlayer) never exposes native TextTracks. Its subtitles are
  // captured two ways, both feeding the shared cue store:
  //   1. TTML segments the player downloads (accurate + buffered ahead, so the
  //      overlay can show upcoming lines) — the primary source.
  //   2. Scraping the on-screen caption node — a fallback that only sees the
  //      current line, used if the network hook can't observe the segments.
  startTtmlCapture();
  startDomSubtitleCapture(video);

  // Inject the native-caption hide stylesheet now that a video is attached. The
  // video often attaches AFTER the initial mount (via the periodic tick / mutation
  // observer), and those paths don't re-run mountIfNeeded's call, so do it here to
  // guarantee the player's own subtitles are suppressed on every attach.
  applyNativeSubtitleVisibility();
}

/** Remove listeners from the currently attached video, if any. */
export function detachVideo(): void {
  stopDomSubtitleCapture();
  stopTtmlCapture();
  if (detach) {
    detach();
    detach = null;
  }
}

export function scanTextTracks(video: HTMLVideoElement): void {
  const tracks = video.textTracks;
  let bestTrack: TextTrack | null = null;
  let bestCount = 0;
  let anyEnabled = false;

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (!isSubtitleTrack(t)) continue;

    // A subtitle track the player is still feeding (the user has subtitles on).
    // When the user turns subtitles off, the player sets the track to
    // 'disabled' (and its cues go null), so this flags whether any remain on.
    if (t.mode !== "disabled") anyEnabled = true;

    // We deliberately do NOT change t.mode here. The player only streams
    // subtitle segments while the track is visible/showing, so forcing it to
    // 'hidden' would stop cue loading. Native captions are suppressed visually
    // instead (see native-subtitles.ts).

    // Hook each track once.
    if (!(t as any)[HOOKED]) {
      (t as any)[HOOKED] = true;
      t.addEventListener("cuechange", () => snapshotCues(t));
      // Some players add cues asynchronously after first load.
      t.addEventListener("load" as any, () => snapshotCues(t));
    }

    const count = t.cues ? t.cues.length : 0;
    if (count > bestCount) {
      bestCount = count;
      bestTrack = t;
    }
  }

  if (bestTrack && bestCount > 0) {
    snapshotCues(bestTrack);
  } else if (isDomCaptureActive()) {
    // No native subtitle track, but the DOM scraper owns the cue state (TV 2
    // Play / RxPlayer). Leave its captured cues untouched.
    return;
  } else if (!anyEnabled && (state.track || state.cues.length)) {
    // Subtitles were turned off entirely: drop the stale cues so the overlay
    // shows the "enable subtitles" tip instead of freezing on the last cues.
    clearSubtitleState();
  } else {
    setStatus(`no cues yet (${tracks.length} track${tracks.length === 1 ? "" : "s"} found)`);
  }
}

/** Reset all subtitle-derived state (used when the user disables subtitles). */
function clearSubtitleState(): void {
  state.track = null;
  state.cues = [];
  state.activeCue = null;
  lastCueSig = "";
  lastFirstStart = -1;
  stopTranslations();
  updateStatus();
  invalidateRender();
  render();
}

/** Cheap fingerprint of a cue set: count plus the boundary timestamps. */
function cueSetSignature(cues: TextTrackCue[]): string {
  const n = cues.length;
  if (n === 0) return "0";
  return `${n}|${cues[0].startTime}|${cues[n - 1].startTime}|${cues[n - 1].endTime}`;
}

function snapshotCues(track: TextTrack): void {
  if (!track.cues) return;
  const cues = Array.from(track.cues);
  const sig = cueSetSignature(cues);
  const trackChanged = state.track !== track;
  // Skip only when the same track's cue *content* is unchanged. Comparing a
  // signature (not just length) catches segment eviction/replacement, where the
  // count is unchanged but the cues themselves have rolled forward.
  if (!trackChanged && sig === lastCueSig) return;

  lastCueSig = sig;
  state.track = track;
  state.cues = cues;
  state.activeCue = null;
  updateStatus();
  if (trackChanged) {
    // New track (e.g. a different subtitle language) → translations from the old
    // track no longer apply.
    onTranslationConfigChanged();
  } else if (cues.length && cues[0].startTime !== lastFirstStart) {
    // Front of the list moved (cues evicted): index→translation mappings are
    // now misaligned. Drop them; the content-keyed cache makes re-resolution of
    // still-visible cues instantaneous (no extra network requests).
    stopTranslations();
  }
  lastFirstStart = cues.length ? cues[0].startTime : -1;
  // Indices into state.cues may now map to different cues, so the renderer's
  // index-based cache must be discarded.
  invalidateRender();
  render();
}
