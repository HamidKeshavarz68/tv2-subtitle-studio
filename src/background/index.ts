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

function isTranslateRequest(msg: unknown): msg is TranslateRequest {
  return !!msg && typeof msg === "object" && (msg as { type?: unknown }).type === "translate";
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

