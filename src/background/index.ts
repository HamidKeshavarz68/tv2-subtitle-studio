/**
 * TV2 Subtitle Studio — background service worker
 *
 * The play.tv2.no page has a strict Content-Security-Policy that blocks
 * `connect-src` to translate.googleapis.com, even from our content script.
 * Service worker fetches are NOT subject to the page CSP, so we proxy all
 * translation requests through here.
 */

declare const chrome: any;

type TranslateRequest = {
  type: "translate";
  text?: unknown;
  source?: unknown;
  target?: unknown;
};

type Tv2FetchRequest = {
  type: "tv2-fetch";
  url?: unknown;
};

function isTranslateRequest(msg: unknown): msg is TranslateRequest {
  return !!msg && typeof msg === "object" && (msg as { type?: unknown }).type === "translate";
}

function isTv2FetchRequest(msg: unknown): msg is Tv2FetchRequest {
  return !!msg && typeof msg === "object" && (msg as { type?: unknown }).type === "tv2-fetch";
}

/** Only TV2-owned hosts may be proxied, to keep this a narrow, safe helper. */
function isAllowedTv2Url(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host === "tv2.no" || host.endsWith(".tv2.no");
  } catch {
    return false;
  }
}

function buildTranslateUrl(source: string, target: string, text: string): string {
  return (
    "https://translate.googleapis.com/translate_a/single" +
    "?client=gtx" +
    "&sl=" + encodeURIComponent(source) +
    "&tl=" + encodeURIComponent(target) +
    "&dt=t" +
    "&q=" + encodeURIComponent(text)
  );
}

function extractTranslatedText(data: unknown): string {
  const segs = Array.isArray(data) ? data[0] : null;
  if (!Array.isArray(segs)) return "";
  return segs.map((segment) => {
    if (!Array.isArray(segment)) return "";
    return String(segment[0] ?? "");
  }).join("");
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender: unknown, sendResponse: (resp: any) => void) => {
  if (isTv2FetchRequest(msg)) {
    (async () => {
      try {
        const url = String(msg.url ?? "");
        if (!isAllowedTv2Url(url)) {
          sendResponse({ ok: false, error: "url not allowed" });
          return;
        }
        const res = await fetch(url, { method: "GET", credentials: "omit" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        sendResponse({ ok: true, text: await res.text() });
      } catch (e: unknown) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (!isTranslateRequest(msg)) return;

  (async () => {
    try {
      const target = String(msg.target ?? "");
      const source = String(msg.source ?? "auto");
      const text = String(msg.text ?? "");
      if (!target || !text) {
        sendResponse({ ok: false, error: "missing target/text" });
        return;
      }

      const res = await fetch(buildTranslateUrl(source, target, text), {
        method: "GET",
        credentials: "omit",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);

      const data: unknown = await res.json();
      sendResponse({ ok: true, text: extractTranslatedText(data) });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      sendResponse({ ok: false, error: message });
    }
  })();

  // Keep the message channel open for the async sendResponse.
  return true;
});

