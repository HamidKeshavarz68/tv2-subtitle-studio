/**
 * Translation engine — Google Translate (public `gtx` endpoint), proxied
 * through the background service worker (the page CSP blocks direct fetches).
 *
 * Requests for visible cues are coalesced into batches: enqueued indices joined
 * for a short window are sent in one request (cues separated by a token, then
 * split back apart), with a per-pair LRU-ish cache so seeks/repeats are free.
 */

import { TRANSLATE, TranslationState } from "../core/config";
import { detectSourceLang, isTranslationActive, settings, state } from "../core/state";
import { cueText, normalizeWhitespace } from "../core/utils";
import { invalidateRender, render, updateStatus } from "../ui/renderer";
import { showToast } from "../ui/toast";
import { t } from "../core/i18n";
import {
  isTranslateResponse,
  TRANSLATE_MESSAGE_TYPE,
  TranslatePayload,
  TranslateRequest,
} from "../../shared/translation";

interface TranslationEntry {
  state: TranslationState;
  text: string;
}

const translations = new Map<number, TranslationEntry>();
const cache = new Map<string, string>();

let requestId = 0; // bumped on config change to invalidate in-flight work
let lastRequestAt = 0;

const pending = new Set<number>();
let flushTimer: number | null = null;
let batchInflight = false;

let lastFallbackWarnAt = 0;

export function getTranslation(idx: number): TranslationEntry | undefined {
  return translations.get(idx);
}

const cacheKeyFor = (source: string, target: string, norm: string): string =>
  `${settings.translator}|${source}|${target}|${norm}`;

/** Clear the per-provider translation cache (e.g. when the provider changes). */
export function clearTranslationCache(): void {
  cache.clear();
}

/** Proxy a translate request through the background service worker. */
function proxyTranslate(payload: TranslatePayload): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const request: TranslateRequest = {
        type: TRANSLATE_MESSAGE_TYPE,
        ...payload,
      };
      chrome.runtime.sendMessage(
        request,
        (response) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message || "runtime error"));
          if (!isTranslateResponse(response)) {
            return reject(new Error("invalid translate response"));
          }
          if (!response.ok) return reject(new Error(response.error));
          resolve(response.text);
        }
      );
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** Show a throttled warning that DeepL failed and Google is being used. */
function warnDeeplFallback(reason?: unknown): void {
  console.warn("[nsr] DeepL unavailable, falling back to Google", reason);
  const now = Date.now();
  if (now - lastFallbackWarnAt < 8000) return;
  lastFallbackWarnAt = now;
  try {
    showToast(t("deepl_fallback"), 7000);
  } catch {
    // ignore toast failures
  }
}

/**
 * Translate `text` using the currently selected provider. DeepL is attempted
 * only when selected and a non-empty key exists; any failure (or a missing key)
 * falls back to the free Google Translate proxy with a short warning toast.
 */
async function translate(text: string, source: string, target: string): Promise<string> {
  if (settings.translator === "deepl") {
    const key = (settings.deeplApiKey || "").trim();
    if (key) {
      try {
        return await proxyTranslate({ provider: "deepl", apiKey: key, text, source, target });
      } catch (e) {
        warnDeeplFallback(e);
      }
    } else {
      warnDeeplFallback("empty key");
    }
  }
  return proxyTranslate({ provider: "google", text, source: source || "auto", target });
}

/** Request a translation for the cue at `idx`, if not already known/cached. */
export function enqueueTranslate(idx: number): void {
  if (!isTranslationActive()) return;
  if (idx < 0 || idx >= state.cues.length) return;
  if (translations.has(idx)) return; // pending, done, or error — all terminal here

  const norm = normalizeWhitespace(cueText(state.cues[idx]));
  if (!norm) {
    translations.set(idx, { state: "done", text: "" });
    invalidateRender();
    return;
  }

  const cached = cache.get(cacheKeyFor(detectSourceLang(), settings.targetLang, norm));
  if (cached !== undefined) {
    translations.set(idx, { state: "done", text: cached });
    invalidateRender();
    return;
  }

  translations.set(idx, { state: "pending", text: "" });
  pending.add(idx);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = self.setTimeout(() => {
    flushTimer = null;
    void flushBatch();
  }, TRANSLATE.coalesceMs);
}

function splitTranslated(text: string, expected: number): string[] {
  // The exact separator can come back with whitespace shifts; be forgiving.
  const parts = text.split(/\s*@@@\s*/g);
  if (parts.length === expected) return parts;
  if (expected === 1) return [text];
  return parts;
}

async function flushBatch(): Promise<void> {
  if (batchInflight) return; // re-flushed after the current batch completes
  if (pending.size === 0) return;

  // Pace requests to avoid hammering the endpoint.
  const wait = TRANSLATE.reqDelayMs - (Date.now() - lastRequestAt);
  if (wait > 0) {
    self.setTimeout(() => void flushBatch(), wait);
    return;
  }

  const indices = Array.from(pending).sort((a, b) => a - b);
  pending.clear();

  const myReq = requestId;
  const source = detectSourceLang();
  const target = settings.targetLang;
  const lines = indices.map((i) => cueText(state.cues[i]));
  const norms = lines.map(normalizeWhitespace);
  const joined = lines.join(TRANSLATE.separator);

  batchInflight = true;
  lastRequestAt = Date.now();
  try {
    const out = await translate(joined, source, target);
    if (myReq !== requestId) return;

    const parts = splitTranslated(out, indices.length);
    if (parts.length === indices.length) {
      indices.forEach((i, k) => {
        const text = parts[k].trim();
        translations.set(i, { state: "done", text });
        if (norms[k]) cache.set(cacheKeyFor(source, target, norms[k]), text);
      });
    } else {
      // Separator was lost in translation: fall back to per-cue requests.
      console.warn("[nsr] batch split mismatch, expected", indices.length, "got", parts.length);
      for (let k = 0; k < indices.length; k++) {
        if (myReq !== requestId) return;
        const i = indices[k];
        try {
          const single = await translate(lines[k], source, target);
          translations.set(i, { state: "done", text: single });
          if (norms[k]) cache.set(cacheKeyFor(source, target, norms[k]), single);
        } catch {
          translations.set(i, { state: "error", text: "" });
        }
        invalidateRender();
      }
    }
  } catch (e) {
    console.warn("[nsr] batch translate failed", e);
    for (const i of indices) translations.set(i, { state: "error", text: "" });
    // Brief back-off on (likely) 429.
    await new Promise((r) => setTimeout(r, 1000));
  } finally {
    batchInflight = false;
    invalidateRender();
    render();
    if (pending.size > 0) scheduleFlush();
  }
}

/**
 * Translate an arbitrary list of texts (e.g. a whole subtitle file) using the
 * current source/target settings. Reuses the shared cache, chunks requests to
 * stay within the translate endpoint's GET URL limits, and paces them to avoid
 * rate limiting. On a failed chunk the original text is returned for those
 * items so the caller always gets a full-length result array.
 */
export async function translateTexts(texts: string[]): Promise<string[]> {
  const source = detectSourceLang();
  const target = settings.targetLang;
  const out: string[] = texts.slice();

  // Resolve from cache first; collect the rest into size-bounded chunks.
  const MAX_CHARS = 1200;
  const MAX_ITEMS = 80;
  let chunk: number[] = [];
  let chunkChars = 0;

  const flush = async (indices: number[]): Promise<void> => {
    if (!indices.length) return;
    const lines = indices.map((i) => texts[i]);
    const joined = lines.join(TRANSLATE.separator);
    try {
      const res = await translate(joined, source, target);
      const parts = splitTranslated(res, indices.length);
      if (parts.length === indices.length) {
        indices.forEach((i, k) => {
          const text = parts[k].trim();
          out[i] = text;
          const norm = normalizeWhitespace(texts[i]);
          if (norm) cache.set(cacheKeyFor(source, target, norm), text);
        });
      } else {
        // Separator lost: translate each item on its own.
        for (let k = 0; k < indices.length; k++) {
          const i = indices[k];
          try {
            const single = (await translate(texts[i], source, target)).trim();
            out[i] = single;
            const norm = normalizeWhitespace(texts[i]);
            if (norm) cache.set(cacheKeyFor(source, target, norm), single);
          } catch {
            // keep original
          }
        }
      }
    } catch {
      // keep originals for this chunk
    }
    // Gentle pacing between network calls.
    await new Promise((r) => setTimeout(r, TRANSLATE.reqDelayMs));
  };

  for (let i = 0; i < texts.length; i++) {
    const raw = texts[i] ?? "";
    const norm = normalizeWhitespace(raw);
    if (!norm) {
      out[i] = "";
      continue;
    }
    const cached = cache.get(cacheKeyFor(source, target, norm));
    if (cached !== undefined) {
      out[i] = cached;
      continue;
    }
    const addChars = raw.length + TRANSLATE.separator.length;
    if (chunk.length && (chunkChars + addChars > MAX_CHARS || chunk.length >= MAX_ITEMS)) {
      await flush(chunk);
      chunk = [];
      chunkChars = 0;
    }
    chunk.push(i);
    chunkChars += addChars;
  }
  await flush(chunk);

  return out;
}

/** Abort in-flight work and drop per-cue results (cache is preserved). */
export function stopTranslations(): void {
  requestId++;
  translations.clear();
  pending.clear();
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/**
 * Called when the source/target/mode changes: existing results no longer apply,
 * so reset and re-render (status is set centrally to avoid toolbar flicker).
 */
export function onTranslationConfigChanged(): void {
  stopTranslations();
  invalidateRender();
  // Stable status — set once here, never per-cue, so the toolbar doesn't
  // flicker as cues enter/leave the visible window.
  updateStatus();
  render();
}
