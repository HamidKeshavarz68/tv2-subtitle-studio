/**
 * Overlay DOM, toolbar controls and direct interactions (font, speed, drag,
 * resize, collapse/expand, click-to-seek). Owns the overlay element and the
 * references the renderer writes into.
 */

import {
  DisplayMode,
  ViewMode,
  FONT,
  LANGS,
  OVERLAY_ID,
  STORAGE_KEYS,
  TRANSLATORS,
  TranslatorProvider,
  UI_LANGS,
  UiLang,
  WINDOW_MIN,
} from "../core/config";
import {
  applyPlaybackRate,
  detectSourceLang,
  isTranslationActive,
  setDeeplApiKey,
  setDisplayMode,
  setViewMode,
  setFontSize,
  setPlaybackRate,
  setTargetLang,
  setTranslator,
  settings,
  state,
} from "../core/state";
import { queryRequired, readStorage, writeStorage } from "../core/utils";
import { invalidateRender, render, updateStatus } from "./renderer";
import {
  clearTranslationCache,
  onTranslationConfigChanged,
} from "../translation/translator";
import { getUiLang, onUiLangChange, setUiLang, t } from "../core/i18n";
import { applyNativeSubtitleVisibility } from "../subtitles/native-subtitles";

const ICON_URL = (() => {
  try {
    return chrome.runtime.getURL("public/icons/icon-128.png");
  } catch {
    return "";
  }
})();

const VERSION = (() => {
  try {
    return chrome.runtime.getManifest().version || "";
  } catch {
    return "";
  }
})();

const REPO_URL = "https://github.com/HamidKeshavarz68/tv2-subtitle-studio";
const CONTACT_EMAIL = "hamidkeshavarz68@gmail.com";

export const overlay = document.createElement("div");
overlay.id = OVERLAY_ID;
overlay.innerHTML = `
  <div class="nsr-header" title="Drag to move">
    ${ICON_URL ? `<img class="nsr-icon" src="${ICON_URL}" alt="" />` : "📜"}
    <span class="nsr-title">TV2 Subtitle Studio</span>
  </div>
  <div class="nsr-settings" hidden>
    <div class="nsr-settings-title-row"><div class="nsr-settings-title" data-i18n="settings_heading">Settings</div><button class="nsr-settings-close" type="button" title="Close" aria-label="Close">×</button></div>
    <label class="nsr-settings-row">
      <span data-i18n="setting_view_mode">Subtitle view</span>
      <select class="nsr-sel" data-act="view-mode" title="Subtitle view">
        <option value="rolling">Rolling list</option>
        <option value="single">Single line (TV2)</option>
      </select>
    </label>
    <label class="nsr-settings-row">
      <span data-i18n="setting_ui_language">Menu language</span>
      <select class="nsr-sel" data-act="set-uilang">
        ${UI_LANGS.map((l) => `<option value="${l.code}">${l.name}</option>`).join("")}
      </select>
    </label>
    <div class="nsr-settings-row" data-row="font-size">
      <span data-i18n="setting_font_size">Text size</span>
      <span class="nsr-group nsr-group-font">
        <button class="nsr-btn" type="button" data-act="font-down" title="Smaller text">A−</button>
        <span class="nsr-font-value" data-font-value>${settings.fontSize}</span>
        <button class="nsr-btn" type="button" data-act="font-up" title="Larger text">A+</button>
      </span>
    </div>
    <label class="nsr-settings-row">
      <span data-i18n="setting_playback_speed">Playback speed</span>
      <select class="nsr-sel" data-act="speed" title="Playback speed">
        <option value="0.6">0.6×</option>
        <option value="0.7">0.7×</option>
        <option value="0.8">0.8×</option>
        <option value="0.9">0.9×</option>
        <option value="0.95">0.95×</option>
        <option value="1">1×</option>
        <option value="1.1">1.1×</option>
        <option value="1.25">1.25×</option>
        <option value="1.5">1.5×</option>
        <option value="1.75">1.75×</option>
        <option value="2">2×</option>
      </select>
    </label>
    <label class="nsr-settings-row">
      <span data-i18n="setting_display_mode">Display mode</span>
      <select class="nsr-sel" data-act="mode" title="Display mode">
        <option value="original">Original</option>
        <option value="translated">Translated</option>
        <option value="bilingual">Bilingual</option>
      </select>
    </label>
    <label class="nsr-settings-row nsr-row-lang">
      <span data-i18n="setting_target_lang">Translate to</span>
      <select class="nsr-sel" data-act="lang" title="Translate to…"></select>
    </label>
    <label class="nsr-settings-row">
      <span data-i18n="setting_translator">Translator</span>
      <select class="nsr-sel" data-act="set-translator">
        ${TRANSLATORS.map((tr) => `<option value="${tr.code}">${tr.name}</option>`).join("")}
      </select>
    </label>
    <div class="nsr-settings-row nsr-settings-row-col nsr-row-deepl-key" hidden>
      <span data-i18n="setting_deepl_key">DeepL API key</span>
      <input class="nsr-input" data-act="set-deepl-key" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste your DeepL API key" />
    </div>
    <div class="nsr-settings-foot">
      <div class="nsr-settings-feedback" data-i18n="feedback_intro">Found a bug or have a suggestion?</div>
      <div class="nsr-settings-links">
        <a class="nsr-link" href="mailto:${CONTACT_EMAIL}" data-i18n="feedback_email">Email the author</a>
        <span class="nsr-dot">·</span>
        <a class="nsr-link" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" data-i18n="feedback_repo">GitHub repository</a>
      </div>
      <div class="nsr-settings-version">${VERSION ? `v${VERSION}` : ""}</div>
    </div>
  </div>
  <div class="nsr-body">
    <div class="nsr-list"></div>
    <div class="nsr-foot">
      <small>Tip: enable subtitles in the TV 2 Play player so they appear here.</small>
    </div>
  </div>
  <div class="nsr-rh nsr-rh-n"  data-dir="n"></div>
  <div class="nsr-rh nsr-rh-s"  data-dir="s"></div>
  <div class="nsr-rh nsr-rh-w"  data-dir="w"></div>
  <div class="nsr-rh nsr-rh-e"  data-dir="e"></div>
  <div class="nsr-rh nsr-rh-nw" data-dir="nw"></div>
  <div class="nsr-rh nsr-rh-ne" data-dir="ne"></div>
  <div class="nsr-rh nsr-rh-sw" data-dir="sw"></div>
  <div class="nsr-rh nsr-rh-se" data-dir="se"></div>`;
// The overlay is only inserted into the DOM on video pages (see index.ts).

export const listEl = queryRequired<HTMLDivElement>(overlay, ".nsr-list");
// The "no → en" status indicator lives to the left of our button in the TV 2
// player control bar (player-controls.ts inserts it there). It is a standalone
// element so it can sit outside the overlay; renderer.ts writes its text.
export const statusEl = document.createElement("span");
statusEl.className = "nsr-status nsr-player-status";
statusEl.textContent = "waiting…";
const footEl = queryRequired<HTMLDivElement>(overlay, ".nsr-foot");
const settingsPanel = queryRequired<HTMLDivElement>(overlay, ".nsr-settings");

// The settings menu lives in a standalone, fixed-position popover so it can be
// anchored to the button injected into the TV 2 player's control bar (bottom-
// right of the video) instead of being clipped inside the subtitle overlay. The
// panel node is moved into this host at the end of the module, after all the
// init-time `overlay.querySelector` lookups have resolved against it while it
// still lived inside the overlay.
export const settingsHost = document.createElement("div");
settingsHost.className = "nsr-settings-host";
settingsHost.hidden = true;

// ---------- Fullscreen handling ----------
// In fullscreen only the fullscreen element's subtree renders, so reparent the
// overlay into it and restore it to <html> on exit.
const overlayHome = document.documentElement;
export function syncFullscreenParent(): void {
  const fs = document.fullscreenElement as HTMLElement | null;
  const target = fs ?? overlayHome;
  if (overlay.parentElement !== target) {
    target.appendChild(overlay);
  }
  if (settingsHost.parentElement !== target) {
    target.appendChild(settingsHost);
  }
  // Positioning is anchored to the (per-player) button, which is torn down and
  // rebuilt across fullscreen transitions, so drop any open popover.
  if (!settingsHost.hidden) closeSettings();
}
document.addEventListener("fullscreenchange", syncFullscreenParent);
document.addEventListener("webkitfullscreenchange", syncFullscreenParent as EventListener);

// ---------- Font size ----------
function renderFontSize(): void {
  overlay.style.setProperty("--nsr-cue-size", settings.fontSize + "px");
  const valueEl =
    settingsHost.querySelector("[data-font-value]") ||
    overlay.querySelector("[data-font-value]");
  if (valueEl) valueEl.textContent = String(settings.fontSize);
}
renderFontSize();

// Font buttons live inside the settings panel, whose click handler stops
// propagation, so they need direct listeners rather than the overlay-level
// delegated handler used by the header buttons.
overlay.querySelector('button[data-act="font-up"]')?.addEventListener("click", () => {
  setFontSize(settings.fontSize + FONT.step);
  renderFontSize();
  render(); // also resize the single-mode on-video caption
});
overlay.querySelector('button[data-act="font-down"]')?.addEventListener("click", () => {
  setFontSize(settings.fontSize - FONT.step);
  renderFontSize();
  render();
});

// ---------- Window size (persisted) ----------
// Only apply saved size if it meets a reasonable minimum; otherwise let the
// CSS default (viewport-relative) take effect.
const SIZE_MIN_THRESHOLD = { w: 400, h: 500 };

function loadSize(): { w: number; h: number } | null {
  try {
    const raw = readStorage(STORAGE_KEYS.size);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (typeof o?.w === "number" && typeof o?.h === "number") {
      if (o.w >= SIZE_MIN_THRESHOLD.w && o.h >= SIZE_MIN_THRESHOLD.h) {
        return o;
      }
    }
  } catch {
    // ignore
  }
  return null;
}
const savedSize = loadSize();
if (savedSize) {
  overlay.style.width = savedSize.w + "px";
  overlay.style.height = savedSize.h + "px";
}

// Persist size changes, but not while collapsed (height is "auto" then and we
// don't want to overwrite the user's preferred expanded height).
let resizeSaveTimer: number | null = null;
let suppressSizeSave = false;
const ro = new ResizeObserver(() => {
  if (suppressSizeSave || resizeSaveTimer !== null) return;
  resizeSaveTimer = self.setTimeout(() => {
    resizeSaveTimer = null;
    if (suppressSizeSave) return;
    const r = overlay.getBoundingClientRect();
    writeStorage(STORAGE_KEYS.size, JSON.stringify({
      w: Math.round(r.width),
      h: Math.round(r.height),
    }));
  }, 150);
});
ro.observe(overlay);

// ---------- Playback speed ----------
const speedSel = queryRequired<HTMLSelectElement>(overlay, 'select[data-act="speed"]');
speedSel.value = String(settings.playbackRate);
speedSel.addEventListener("change", () => {
  setPlaybackRate(parseFloat(speedSel.value) || 1);
});

// ---------- Custom resize from any edge / corner ----------
// Eight invisible handles translate pointer drags into width/height/top/left.
// Pointer events (with pointer capture) make this work for mouse, touch and
// pen alike, so resize works on Android extension browsers too.
overlay.querySelectorAll<HTMLElement>(".nsr-rh").forEach((handle) => {
  handle.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dir = handle.dataset.dir || "";
    const start = overlay.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const pointerId = e.pointerId;
    const maxW = Math.min(window.innerWidth * 0.95, window.innerWidth - 4);
    const maxH = Math.min(window.innerHeight * 0.95, window.innerHeight - 4);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      let left = start.left;
      let top = start.top;
      let w = start.width;
      let h = start.height;

      if (dir.includes("e")) w = start.width + dx;
      if (dir.includes("s")) h = start.height + dy;
      if (dir.includes("w")) { w = start.width - dx; left = start.left + dx; }
      if (dir.includes("n")) { h = start.height - dy; top = start.top + dy; }

      // Clamp width
      if (w < WINDOW_MIN.width) {
        if (dir.includes("w")) left -= WINDOW_MIN.width - w;
        w = WINDOW_MIN.width;
      }
      if (w > maxW) {
        if (dir.includes("w")) left += w - maxW;
        w = maxW;
      }
      // Clamp height
      if (h < WINDOW_MIN.height) {
        if (dir.includes("n")) top -= WINDOW_MIN.height - h;
        h = WINDOW_MIN.height;
      }
      if (h > maxH) {
        if (dir.includes("n")) top += h - maxH;
        h = maxH;
      }
      // Keep on screen
      if (left < 0) { w += left; left = 0; }
      if (top < 0) { h += top; top = 0; }
      if (left + w > window.innerWidth) w = window.innerWidth - left;
      if (top + h > window.innerHeight) h = window.innerHeight - top;

      // Switch positioning to top/left so it stays put.
      overlay.style.right = "auto";
      overlay.style.bottom = "auto";
      overlay.style.left = left + "px";
      overlay.style.top = top + "px";
      overlay.style.width = w + "px";
      overlay.style.height = h + "px";
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      // The ResizeObserver above persists the new size.
    };
    try { handle.setPointerCapture(pointerId); } catch { /* ignore */ }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
});

// ---------- Translation selects ----------
const langSel = queryRequired<HTMLSelectElement>(overlay, 'select[data-act="lang"]');
const langRow = queryRequired<HTMLLabelElement>(overlay, ".nsr-row-lang");
const modeSel = queryRequired<HTMLSelectElement>(overlay, 'select[data-act="mode"]');
langSel.innerHTML = LANGS.map((l) => `<option value="${l.code}">${l.name}</option>`).join("");
langSel.value = settings.targetLang;
modeSel.value = settings.displayMode;

function syncLangSelVisibility(): void {
  // No need to pick a target language if the user only wants the original;
  // hide the whole "Translate to" row in that case. The "Display mode" select
  // above stays visible at all times so it always offers a way out of
  // "original" — otherwise a fresh user (default "off" + "original") would see
  // an empty panel with no control to enable translation.
  langRow.style.display = settings.displayMode === "original" ? "none" : "";
}
syncLangSelVisibility();

// Pick a sensible target language when the user turns translation on without
// having chosen one yet, so switching to Translated/Bilingual has an immediate
// visible effect instead of silently staying "off". Prefer the UI language
// (what the user reads) as long as it differs from the subtitle's source
// language; otherwise fall back to English.
function defaultTargetLang(): string {
  const uiLang = getUiLang();
  const source = detectSourceLang();
  if (uiLang !== source && LANGS.some((l) => l.code === uiLang)) return uiLang;
  return "en";
}

langSel.addEventListener("change", () => {
  setTargetLang(langSel.value);
  syncFontSizeRowVisibility();
  onTranslationConfigChanged();
});
modeSel.addEventListener("change", () => {
  setDisplayMode(modeSel.value as DisplayMode);
  if (settings.displayMode !== "original" && settings.targetLang === "off") {
    const lang = defaultTargetLang();
    setTargetLang(lang);
    langSel.value = lang;
  }
  syncLangSelVisibility();
  syncFontSizeRowVisibility();
  applyNativeSubtitleVisibility();
  updateStatus();
  invalidateRender();
  render();
});

// ---------- View mode (rolling window vs. TV 2's native single line) ----------
const viewSel = queryRequired<HTMLSelectElement>(overlay, 'select[data-act="view-mode"]');
viewSel.value = settings.viewMode;
// Reflect the persisted mode immediately so the window starts hidden in single
// mode (native captions are toggled on mount via applyNativeSubtitleVisibility).
overlay.style.display = settings.viewMode === "single" ? "none" : "";

// The "Text size" control resizes the rolling list, and in single mode it
// resizes our injected caption — but our injected caption only exists when a
// translation is shown. In single mode with "Original" (or translation off),
// TV 2 renders its own caption and we can't resize it, so hide the control then.
const fontSizeRow = queryRequired<HTMLElement>(overlay, '[data-row="font-size"]');
function syncFontSizeRowVisibility(): void {
  const usable = settings.viewMode !== "single" || isTranslationActive();
  // A base CSS rule may set this row to display:flex; toggling [hidden] wouldn't
  // win (equal specificity), so hide via inline style instead.
  fontSizeRow.style.display = usable ? "" : "none";
}
syncFontSizeRowVisibility();

/**
 * Show/hide the extension's rolling window and TV 2's own captions to match the
 * chosen view mode. In "single" mode the overlay window is hidden and TV 2's
 * native single-line subtitles are shown; the player-bar button and this
 * settings popover stay available so the user can switch back.
 */
export function applyViewMode(): void {
  const single = settings.viewMode === "single";
  overlay.style.display = single ? "none" : "";
  syncFontSizeRowVisibility();
  applyNativeSubtitleVisibility();
  invalidateRender();
  render();
}

viewSel.addEventListener("change", () => {
  setViewMode(viewSel.value as ViewMode);
  applyViewMode();
});

// ---------- Settings menu ----------
const uiLangSel = queryRequired<HTMLSelectElement>(overlay, 'select[data-act="set-uilang"]');
const translatorSel = queryRequired<HTMLSelectElement>(overlay, 'select[data-act="set-translator"]');
const deeplKeyRow = queryRequired<HTMLDivElement>(overlay, ".nsr-row-deepl-key");
const deeplKeyInput = queryRequired<HTMLInputElement>(overlay, 'input[data-act="set-deepl-key"]');

uiLangSel.value = getUiLang();
translatorSel.value = settings.translator;
deeplKeyInput.value = settings.deeplApiKey;

/** Show the DeepL API-key row only when DeepL is the selected provider. */
function syncDeeplKeyVisibility(): void {
  deeplKeyRow.hidden = settings.translator !== "deepl";
}
syncDeeplKeyVisibility();

// The button injected into the player control bar (see player-controls.ts)
// anchors the popover; `settingsAnchor` remembers it so we can clear its active
// state and re-close cleanly on outside clicks.
let settingsAnchor: HTMLElement | null = null;

const SETTINGS_REFERENCE_HEIGHT = 1080;
const SETTINGS_MAX_SCALE = 2.5;
const SETTINGS_MAX_WIDTH = 340;
const SETTINGS_VIEWPORT_MARGIN = 8;
const SETTINGS_VIEWPORT_HEIGHT_RATIO = 0.8;

function reparentSettingsHost(): void {
  const target = (document.fullscreenElement as HTMLElement | null) ?? document.documentElement;
  if (settingsHost.parentElement !== target) target.appendChild(settingsHost);
}

/**
 * Keep the menu physically readable as viewport resolution increases. CSS pixels
 * already account for device pixel ratio, so scaling from the effective viewport
 * avoids over-enlarging high-density laptops while correctly handling 4K TVs.
 */
function syncSettingsScale(): number {
  const heightScale = window.innerHeight / SETTINGS_REFERENCE_HEIGHT;
  const widthScale =
    window.innerWidth /
    (SETTINGS_MAX_WIDTH + SETTINGS_VIEWPORT_MARGIN * 2);
  const scale = Math.max(1, Math.min(heightScale, widthScale, SETTINGS_MAX_SCALE));
  settingsHost.style.setProperty("--nsr-settings-scale", scale.toFixed(3));

  // The transformed panel should occupy at most 80% of the visible viewport.
  const maxPanelHeight =
    window.innerHeight * SETTINGS_VIEWPORT_HEIGHT_RATIO / scale;
  settingsPanel.style.maxHeight = Math.floor(maxPanelHeight) + "px";
  return scale;
}

function positionSettingsHost(anchor: HTMLElement | null): void {
  const scale = syncSettingsScale();
  const margin = SETTINGS_VIEWPORT_MARGIN * scale;
  const gap = SETTINGS_VIEWPORT_MARGIN * scale;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const panel = settingsHost.getBoundingClientRect();

  settingsHost.style.right = "auto";
  settingsHost.style.bottom = "auto";

  let left: number;
  let top: number;
  if (!anchor || !anchor.isConnected) {
    // No/stale anchor → park it in the bottom-right corner of the viewport.
    left = viewportWidth - panel.width - margin;
    top = viewportHeight - panel.height - 64 * scale;
  } else {
    const anchorRect = anchor.getBoundingClientRect();
    left = anchorRect.right - panel.width;
    top = anchorRect.top - panel.height - gap;
    if (top < margin) top = anchorRect.bottom + gap;
  }

  left = Math.max(margin, Math.min(left, viewportWidth - panel.width - margin));
  top = Math.max(margin, Math.min(top, viewportHeight - panel.height - margin));
  settingsHost.style.left = Math.round(left) + "px";
  settingsHost.style.top = Math.round(top) + "px";
}

export function isSettingsOpen(): boolean {
  return !settingsHost.hidden;
}

export function openSettings(anchor?: HTMLElement | null): void {
  reparentSettingsHost();
  settingsAnchor = anchor ?? null;
  // Measure while invisible so the popover never flashes at a stale position.
  settingsHost.style.visibility = "hidden";
  settingsHost.hidden = false;
  positionSettingsHost(settingsAnchor);
  settingsHost.style.visibility = "";
  if (settingsAnchor) settingsAnchor.classList.add("nsr-player-btn-active");
}

export function closeSettings(): void {
  settingsHost.hidden = true;
  if (settingsAnchor) settingsAnchor.classList.remove("nsr-player-btn-active");
  settingsAnchor = null;
}

export function toggleSettings(anchor?: HTMLElement | null): void {
  if (isSettingsOpen()) closeSettings();
  else openSettings(anchor);
}

// Keep clicks inside the panel from bubbling to the document-level close.
settingsPanel.addEventListener("click", (e) => e.stopPropagation());

// Settings close button.
const settingsCloseBtn = queryRequired<HTMLButtonElement>(overlay, ".nsr-settings-close");
settingsCloseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  closeSettings();
});
// Close when clicking anywhere outside the popover and its anchoring button.
document.addEventListener("click", (e) => {
  if (!isSettingsOpen()) return;
  const target = e.target as Node | null;
  if (target && (settingsHost.contains(target) || settingsAnchor?.contains(target))) return;
  closeSettings();
});
// Re-scale and re-anchor on viewport changes so the popover remains readable and
// keeps hugging the player button across resolution and orientation changes.
const handleSettingsViewportChange = (): void => {
  if (isSettingsOpen()) positionSettingsHost(settingsAnchor);
};
window.addEventListener("resize", handleSettingsViewportChange);
window.visualViewport?.addEventListener("resize", handleSettingsViewportChange);

uiLangSel.addEventListener("change", () => {
  setUiLang(uiLangSel.value as UiLang);
});

// Translator provider: switch, toggle the key row, drop cached results (they are
// provider-specific), then re-render/re-translate.
translatorSel.addEventListener("change", () => {
  setTranslator(translatorSel.value as TranslatorProvider);
  syncDeeplKeyVisibility();
  clearTranslationCache();
  onTranslationConfigChanged();
});

// DeepL API key: persist per keystroke, but debounce the (expensive) re-translate
// so it only fires once the user pauses typing.
let deeplKeyDebounce: number | null = null;
deeplKeyInput.addEventListener("input", () => {
  setDeeplApiKey(deeplKeyInput.value.trim());
  clearTranslationCache();
  if (deeplKeyDebounce !== null) clearTimeout(deeplKeyDebounce);
  deeplKeyDebounce = self.setTimeout(() => {
    deeplKeyDebounce = null;
    onTranslationConfigChanged();
  }, 600);
});
// Keep typing/tapping in the key field from closing the panel or dragging the header.
deeplKeyInput.addEventListener("keydown", (e) => e.stopPropagation());
deeplKeyInput.addEventListener("pointerdown", (e) => e.stopPropagation());

// ---------- Footer tip ----------
// The "enable subtitles in the player" tip is only useful until subtitles have
// actually been captured; hide it once cues exist.
export function syncFooterTip(): void {
  footEl.hidden = state.cues.length > 0;
}
syncFooterTip();

// ---------- i18n: (re)apply all static UI strings ----------
function applyI18n(): void {
  langSel.title = t("translate_to");
  if (langSel.options.length) langSel.options[0].text = t("no_translation"); // "off" entry
  modeSel.title = t("display_mode");
  setOptionText(modeSel, "original", t("mode_original"));
  setOptionText(modeSel, "translated", t("mode_translated"));
  setOptionText(modeSel, "bilingual", t("mode_bilingual"));
  viewSel.title = t("view_mode");
  setOptionText(viewSel, "rolling", t("view_rolling"));
  setOptionText(viewSel, "single", t("view_single"));
  speedSel.title = t("playback_speed");

  setTitle('button[data-act="font-down"]', t("font_smaller"));
  setTitle('button[data-act="font-up"]', t("font_larger"));

  footEl.innerHTML = `<small>${t("tip")}</small>`;

  deeplKeyInput.placeholder = t("deepl_key_placeholder");

  [overlay, settingsHost].forEach((root) => {
    root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n as Parameters<typeof t>[0] | undefined;
      if (key) el.textContent = t(key);
    });
  });

  // Status line shows the localized "waiting…" until a track is known.
  if (!state.track) statusEl.textContent = t("status_waiting");

  invalidateRender();
  render();
}

function setOptionText(sel: HTMLSelectElement, value: string, text: string): void {
  const opt = Array.from(sel.options).find((o) => o.value === value);
  if (opt) opt.text = text;
}
function setTitle(selector: string, title: string): void {
  const el = overlay.querySelector<HTMLElement>(selector) ||
    settingsHost.querySelector<HTMLElement>(selector);
  if (el) el.title = title;
}

onUiLangChange(applyI18n);
applyI18n();

// ---------- Click-to-seek ----------
listEl.addEventListener("click", (e) => {
  const cueEl = (e.target as HTMLElement).closest(".nsr-cue") as HTMLElement | null;
  if (!cueEl || !state.video) return;
  const s = parseFloat(cueEl.dataset.start || "0");
  if (!isNaN(s)) state.video.currentTime = s;
});

// ---------- Dragging ----------
makeDraggable(overlay, queryRequired<HTMLElement>(overlay, ".nsr-header"));

function makeDraggable(el: HTMLElement, handle: HTMLElement): void {
  let dragging = false;
  let sx = 0, sy = 0, ox = 0, oy = 0, pointerId = -1;
  handle.addEventListener("pointerdown", (e: PointerEvent) => {
    // Don't drag when clicking interactive controls.
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "BUTTON" || tag === "SELECT" || tag === "OPTION") return;
    dragging = true;
    pointerId = e.pointerId;
    sx = e.clientX; sy = e.clientY;
    const r = el.getBoundingClientRect();
    ox = r.left; oy = r.top;
    el.style.right = "auto";
    el.style.bottom = "auto";
    try { handle.setPointerCapture(pointerId); } catch { /* ignore */ }
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    el.style.left = Math.max(0, ox + e.clientX - sx) + "px";
    el.style.top = Math.max(0, oy + e.clientY - sy) + "px";
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = -1;
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// Re-apply the persisted playback rate if/when a video is present.
applyPlaybackRate();

// Move the settings panel into its standalone popover host now that every
// init-time `overlay.querySelector(...)` lookup above has resolved against it
// while it still lived inside the overlay. From here on it renders as an
// anchored popover (see openSettings / player-controls.ts).
settingsPanel.hidden = false;
settingsHost.appendChild(settingsPanel);
