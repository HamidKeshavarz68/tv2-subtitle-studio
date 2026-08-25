/**
 * TV2 Subtitle Studio — background service worker
 *
 * The play.tv2.no page has a strict Content-Security-Policy that blocks
 * `connect-src` to translate.googleapis.com, even from our content script.
 * Service worker fetches are NOT subject to the page CSP, so we proxy all
 * translation requests through here.
 */

import {
  CUE_SEPARATOR,
  isTranslateMessage,
  TranslateResponse,
} from "../shared/translation";

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

/**
 * Map an app BCP-47 base target code to a DeepL target language. Returns null
 * for languages DeepL does not support, so the caller can fall back to Google.
 */
function toDeeplTargetLang(target: string): string | null {
  const base = String(target || "").toLowerCase().split("-")[0];
  const map: Record<string, string> = {
    en: "EN-US",
    pt: "PT-PT",
    zh: "ZH",
    nb: "NB",
    no: "NB",
    ar: "AR",
    bg: "BG",
    cs: "CS",
    da: "DA",
    de: "DE",
    el: "EL",
    es: "ES",
    et: "ET",
    fi: "FI",
    fr: "FR",
    hu: "HU",
    id: "ID",
    it: "IT",
    ja: "JA",
    ko: "KO",
    lt: "LT",
    lv: "LV",
    nl: "NL",
    pl: "PL",
    ro: "RO",
    ru: "RU",
    sk: "SK",
    sl: "SL",
    sv: "SV",
    tr: "TR",
    uk: "UK",
  };
  return map[base] ?? null;
}

/**
 * Translate through DeepL. Free-tier keys end with ":fx" and use the
 * api-free.deepl.com host; paid keys use api.deepl.com. The content script joins
 * multiple cues with CUE_SEPARATOR, so we split them out, send each as its own
 * `text` form field (DeepL accepts many per request), then rejoin the results
 * with the same separator so the content-side splitter recovers cues exactly.
 * Throws on any failure (missing key, unsupported language, HTTP error) so the
 * content script can fall back to Google Translate.
 */
async function deeplTranslate(text: string, target: string, apiKey: string): Promise<string> {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("missing DeepL API key");

  const targetLang = toDeeplTargetLang(target);
  if (!targetLang) throw new Error("unsupported DeepL target: " + target);

  const host = key.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
  const endpoint = "https://" + host + "/v2/translate";

  const pieces = String(text).split(/\s*@@@\s*/g);
  const body = new URLSearchParams();
  body.set("target_lang", targetLang);
  for (const piece of pieces) body.append("text", piece);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": "DeepL-Auth-Key " + key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    credentials: "omit",
  });
  if (!res.ok) throw new Error("HTTP " + res.status);

  const data: unknown = await res.json();
  const translations = (data as { translations?: unknown }).translations;
  if (!Array.isArray(translations)) throw new Error("unexpected DeepL response");
  const out = translations.map((t) => String((t as { text?: unknown }).text ?? ""));
  return out.join(CUE_SEPARATOR);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isTranslateMessage(msg)) return;

  const respond = (response: TranslateResponse): void => sendResponse(response);

  (async () => {
    try {
      const target = String(msg.target ?? "");
      const source = String(msg.source ?? "auto");
      const text = String(msg.text ?? "");
      const provider = String(msg.provider ?? "google");
      if (!target || !text) {
        respond({ ok: false, error: "missing target/text" });
        return;
      }

      if (provider === "deepl") {
        const translated = await deeplTranslate(text, target, String(msg.apiKey ?? ""));
        respond({ ok: true, text: translated });
        return;
      }

      const res = await fetch(buildTranslateUrl(source, target, text), {
        method: "GET",
        credentials: "omit",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);

      const data: unknown = await res.json();
      respond({ ok: true, text: extractTranslatedText(data) });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      respond({ ok: false, error: message });
    }
  })();

  // Keep the message channel open for the async sendResponse.
  return true;
});
