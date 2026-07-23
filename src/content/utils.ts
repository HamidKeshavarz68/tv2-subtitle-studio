/**
 * Small, pure helpers shared across the content script modules.
 */

export const stripHtml = (s: string): string => s.replace(/<[^>]+>/g, "");

export const normalizeWhitespace = (s: string): string =>
  s.replace(/\s+/g, " ").trim();

export const isSubtitleTrack = (t: TextTrack): boolean =>
  t.kind === "subtitles" || t.kind === "captions";

/** Plain (tag-stripped) text of a cue, tolerant of missing cues. */
export const cueText = (cue: TextTrackCue | VTTCue | null | undefined): string =>
  stripHtml((cue as VTTCue | undefined)?.text || "");

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode / quota); ignore.
  }
}

export const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));

/** Format seconds as `m:ss` (or `h:mm:ss` past an hour). */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
