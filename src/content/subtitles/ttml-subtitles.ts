/**
 * TTML subtitle capture for TV 2 Play (DASH / Unified Streaming).
 *
 * TV 2 Play delivers subtitles as DASH fMP4 segments containing TTML (the
 * requests whose URL contains "textstream", served as `video/mp4`). A companion
 * MAIN-world hook (net-hook.ts) can see those network responses — content
 * scripts run in an isolated world and cannot — so it extracts the embedded
 * `<tt>...</tt>` document and forwards it here via `window.postMessage`.
 *
 * We parse each segment's `<p begin="..." end="...">` cues and merge them into
 * the shared cue store, which calibrates their DASH presentation timeline to
 * `video.currentTime`. Because RxPlayer fetches these segments ahead of playback,
 * this yields the full set of current AND upcoming lines — real look-ahead,
 * unlike DOM scraping which only ever sees the caption currently on screen.
 */

import { normalizeWhitespace } from "../core/utils";
import { upsertCue, publishCues, activateTtml, subDebug } from "./subtitle-store";

let listening = false;
const parser = new DOMParser();

/** Begin listening for TTML segments forwarded by the MAIN-world hook. */
export function startTtmlCapture(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("message", onMessage);
  // Ask the MAIN-world hook to replay any segments it captured before we were
  // listening (it often loads subtitles before the overlay mounts).
  window.postMessage({ __tv2subKind: "ttml-request" }, "*");
}

export function stopTtmlCapture(): void {
  if (!listening) return;
  listening = false;
  window.removeEventListener("message", onMessage);
}

function onMessage(e: MessageEvent): void {
  if (e.source !== window) return;
  const data = e.data as { __tv2subKind?: string; xml?: unknown } | null;
  if (!data || data.__tv2subKind !== "ttml" || typeof data.xml !== "string") return;
  ingestTtml(data.xml);
}

/** Parse a TTML document and merge its cues into the shared store. */
function ingestTtml(xml: string): void {
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return;

  const paras = doc.getElementsByTagNameNS("*", "p");
  let added = 0;
  let firstStart: number | null = null;
  let lastStart: number | null = null;
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const start = ttmlTime(p.getAttribute("begin"));
    const end = ttmlTime(p.getAttribute("end"));
    const text = paragraphText(p);
    if (start === null || end === null || !text) continue;
    upsertCue(start, end, text, "ttml");
    if (firstStart === null) firstStart = start;
    lastStart = start;
    added++;
  }
  if (added) {
    if (subDebug()) {
      console.log(
        "[tv2sub] ttml segment: +", added, "cues rawBegin",
        firstStart?.toFixed(2), "..", lastStart?.toFixed(2)
      );
    }
    // TTML is now the source of truth; drop any earlier DOM-scraped cues.
    activateTtml();
    publishCues();
  }
}

/** Flatten a `<p>` into text, mapping `<br/>` to newlines. */
function paragraphText(p: Element): string {
  const lines: string[] = [];
  let cur = "";
  const walk = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        cur += child.textContent || "";
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if ((child as Element).localName.toLowerCase() === "br") {
          lines.push(cur);
          cur = "";
        } else {
          walk(child);
        }
      }
    });
  };
  walk(p);
  lines.push(cur);
  return lines.map((l) => normalizeWhitespace(l)).filter(Boolean).join("\n");
}

/**
 * Parse a TTML time expression to seconds. Handles clock time
 * (`[H]H:MM:SS(.mmm)`) and offset time (`12.5s`, `500ms`, `2m`, `1h`).
 */
function ttmlTime(v: string | null): number | null {
  if (!v) return null;
  const clock = v.match(/^(\d+):(\d{2}):(\d{2}(?:[.,]\d+)?)$/);
  if (clock) {
    return (
      Number(clock[1]) * 3600 +
      Number(clock[2]) * 60 +
      parseFloat(clock[3].replace(",", "."))
    );
  }
  const offset = v.match(/^(\d+(?:\.\d+)?)(h|m|s|ms)?$/);
  if (offset) {
    const n = parseFloat(offset[1]);
    switch (offset[2]) {
      case "h":
        return n * 3600;
      case "m":
        return n * 60;
      case "ms":
        return n / 1000;
      default:
        return n; // "s" or a bare number of seconds
    }
  }
  return null;
}
