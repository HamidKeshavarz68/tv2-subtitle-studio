/**
 * Fetching the *complete* subtitle file for the current programme.
 *
 * The player only streams subtitle segments as they play, so the in-page cues
 * never cover the whole video. Some broadcasters expose a public playback
 * manifest that resolves a single WebVTT file per subtitle track covering the
 * entire programme.
 *
 * TV 2 Play does NOT expose a comparable, reliable public manifest endpoint, so
 * whole-video fetch is not wired up here yet: `fetchFullSubtitles()` is a
 * best-effort stub that always resolves to `null`. Downloads therefore fall
 * back to the cues accumulated from the player during playback (handled in
 * download.ts). A tv2-fetch proxy already exists in the background service
 * worker for when a manifest source is identified.
 *
 * The WebVTT parsing helpers (`parseVtt`, `timestampToSeconds`, `decodeEntities`)
 * are kept and exported because they are player-agnostic and reused elsewhere.
 */

import { stripHtml } from "./utils";

export interface RemoteCue {
  start: number;
  end: number;
  text: string;
}

export interface RemoteSubtitles {
  cues: RemoteCue[];
  language: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-zA-Z]+;/g, (m) => ENTITIES[m] ?? m);
}

/** Parse a WebVTT/SRT-ish timestamp (`HH:MM:SS.mmm` or `MM:SS.mmm`) to seconds. */
export function timestampToSeconds(ts: string): number {
  const m = ts.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  if (!m) return NaN;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2], 10);
  const sec = parseInt(m[3], 10);
  const ms = parseInt(m[4].padEnd(3, "0"), 10);
  return h * 3600 + min * 60 + sec + ms / 1000;
}

/** Parse a WebVTT document into plain cues (tags stripped, entities decoded). */
export function parseVtt(input: string): RemoteCue[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const cues: RemoteCue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const arrow = line.indexOf("-->");
    if (arrow !== -1) {
      const startRaw = line.slice(0, arrow);
      const endRaw = line.slice(arrow + 3).trim().split(/\s+/)[0] || "";
      const start = timestampToSeconds(startRaw);
      const end = timestampToSeconds(endRaw);
      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== "") {
        textLines.push(lines[i]);
        i++;
      }
      const text = decodeEntities(stripHtml(textLines.join("\n"))).trim();
      if (text && isFinite(start) && isFinite(end)) {
        cues.push({ start, end, text });
      }
    } else {
      i++;
    }
  }
  return cues;
}

/**
 * Whole-video subtitle fetch is not wired for TV 2 Play yet (no reliable public
 * manifest endpoint), so this is a best-effort stub that always returns null.
 * Downloads fall back to the cues accumulated during playback (see download.ts).
 */
export async function fetchFullSubtitles(): Promise<RemoteSubtitles | null> {
  return null;
}
