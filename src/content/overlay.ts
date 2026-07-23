/**
 * Overlay DOM, toolbar controls and direct interactions (font, speed, drag,
 * resize, collapse/expand, click-to-seek). Owns the overlay element and the
 * references the renderer writes into.
 */

import {
  DisplayMode,
  FONT,
  LANGS,
  OVERLAY_ID,
  STORAGE_KEYS,
  UI_LANGS,
  UiLang,
  WINDOW_MIN,
} from "./config";
import {
  applyPlaybackRate,
  detectSourceLang,
  setDisplayMode,
  setFontSize,
  setPlaybackRate,
  setTargetLang,
  settings,
  state,
  ui,
} from "./state";
import { readStorage, writeStorage } from "./utils";
import { invalidateRender, render, updateStatus } from "./renderer";
import { onTranslationConfigChanged } from "./translator";
import { applyNativeSubtitleVisibility } from "./native-subtitles";
import { getUiLang, onUiLangChange, setUiLang, t } from "./i18n";

declare const chrome: any;

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
  <div class="nsr-header">
    <span class="nsr-title">${ICON_URL ? `<img class="nsr-icon" src="${ICON_URL}" alt="" />` : "📜"} TV2 Subtitle Studio</span>
    <span class="nsr-status">waiting…</span>
    <span class="nsr-actions">
      <span class="nsr-group nsr-group-translate">
        <button class="nsr-btn nsr-btn-text" data-act="translate-menu" title="Translation" aria-label="Translation">Translation</button>
      </span>
      <span class="nsr-group nsr-group-settings">
        <button class="nsr-btn nsr-btn-text" data-act="settings" title="Settings" aria-label="Settings">Settings</button>
      </span>
    </span>
    <span class="nsr-group nsr-group-toggle">
      <button class="nsr-btn nsr-btn-text" data-act="toggle" title="Hide subtitle list">Hide</button>
    </span>
  </div>
  <div class="nsr-settings" hidden>
    <div class="nsr-settings-title-row"><div class="nsr-settings-title" data-i18n="settings_heading">Settings</div><button class="nsr-settings-close" type="button" title="Close" aria-label="Close">×</button></div>
    <label class="nsr-settings-row">
      <span data-i18n="setting_ui_language">Menu language</span>
      <select class="nsr-sel" data-act="set-uilang">
        ${UI_LANGS.map((l) => `<option value="${l.code}">${l.name}</option>`).join("")}
      </select>
    </label>
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
    <div class="nsr-settings-row">
      <span data-i18n="setting_font_size">Text size</span>
      <span class="nsr-group nsr-group-font">
        <button class="nsr-btn" type="button" data-act="font-down" title="Smaller text">A−</button>
        <button class="nsr-btn" type="button" data-act="font-up" title="Larger text">A+</button>
      </span>
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
  <div class="nsr-translate-panel" hidden>
    <div class="nsr-settings-title-row"><div class="nsr-settings-title" data-i18n="translate_heading">Translation</div><button class="nsr-translate-close" type="button" title="Close" aria-label="Close">×</button></div>
    <div class="nsr-translate-rows">
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

export const listEl = overlay.querySelector(".nsr-list") as HTMLDivElement;
export const statusEl = overlay.querySelector(".nsr-status") as HTMLSpanElement;
const bodyEl = overlay.querySelector(".nsr-body") as HTMLDivElement;
const footEl = overlay.querySelector(".nsr-foot") as HTMLDivElement;
const settingsPanel = overlay.querySelector(".nsr-settings") as HTMLDivElement;
const translatePanel = overlay.querySelector(".nsr-translate-panel") as HTMLDivElement;

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
}
document.addEventListener("fullscreenchange", syncFullscreenParent);
document.addEventListener("webkitfullscreenchange", syncFullscreenParent as EventListener);

let savedExpandedHeight = "";

// ---------- Font size ----------
function renderFontSize(): void {
  overlay.style.setProperty("--nsr-cue-size", settings.fontSize + "px");
}
renderFontSize();

// Font buttons live inside the settings panel, whose click handler stops
// propagation, so they need direct listeners rather than the overlay-level
// delegated handler used by the header buttons.
overlay.querySelector('button[data-act="font-up"]')?.addEventListener("click", () => {
  setFontSize(settings.fontSize + FONT.step);
  renderFontSize();
});
overlay.querySelector('button[data-act="font-down"]')?.addEventListener("click", () => {
  setFontSize(settings.fontSize - FONT.step);
  renderFontSize();
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
const speedSel = overlay.querySelector('select[data-act="speed"]') as HTMLSelectElement;
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
const langSel = overlay.querySelector('select[data-act="lang"]') as HTMLSelectElement;
const langRow = overlay.querySelector(".nsr-row-lang") as HTMLLabelElement;
const modeSel = overlay.querySelector('select[data-act="mode"]') as HTMLSelectElement;
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
  updateStatus();
  invalidateRender();
  render();
});

// ---------- Settings menu ----------
const settingsBtn = overlay.querySelector('button[data-act="settings"]') as HTMLButtonElement;
const translateBtn = overlay.querySelector('button[data-act="translate-menu"]') as HTMLButtonElement;
const uiLangSel = overlay.querySelector('select[data-act="set-uilang"]') as HTMLSelectElement;

uiLangSel.value = getUiLang();

function setSettingsOpen(open: boolean): void {
  if (open) setTranslateOpen(false);
  settingsPanel.hidden = !open;
  settingsBtn.classList.toggle("nsr-btn-active", open);
}
const isSettingsOpen = (): boolean => !settingsPanel.hidden;

function setTranslateOpen(open: boolean): void {
  if (open) setSettingsOpen(false);
  translatePanel.hidden = !open;
  translateBtn.classList.toggle("nsr-btn-active", open);
}
const isTranslateOpen = (): boolean => !translatePanel.hidden;

settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setSettingsOpen(settingsPanel.hidden);
});
translateBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setTranslateOpen(translatePanel.hidden);
});
// Keep clicks inside the panels from bubbling to the document-level close.
settingsPanel.addEventListener("click", (e) => e.stopPropagation());
translatePanel.addEventListener("click", (e) => e.stopPropagation());

// Settings close button
const settingsCloseBtn = overlay.querySelector('.nsr-settings-close') as HTMLButtonElement;
if (settingsCloseBtn) {
  settingsCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setSettingsOpen(false);
  });
}
// Translation panel close button
const translateCloseBtn = overlay.querySelector('.nsr-translate-close') as HTMLButtonElement;
if (translateCloseBtn) {
  translateCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setTranslateOpen(false);
  });
}
// Close when clicking anywhere else.
document.addEventListener("click", () => {
  if (isSettingsOpen()) setSettingsOpen(false);
  if (isTranslateOpen()) setTranslateOpen(false);
});

uiLangSel.addEventListener("change", () => {
  setUiLang(uiLangSel.value as UiLang);
});

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
  speedSel.title = t("playback_speed");

  setTitle('button[data-act="font-down"]', t("font_smaller"));
  setTitle('button[data-act="font-up"]', t("font_larger"));
  settingsBtn.title = t("settings_open");
  settingsBtn.setAttribute("aria-label", t("settings_open"));
  settingsBtn.textContent = t("settings_open");
  translateBtn.title = t("translate_open");
  translateBtn.setAttribute("aria-label", t("translate_open"));
  translateBtn.textContent = t("translate_open");

  // Collapse/expand button reflects current state.
  toggleBtn.textContent = ui.isExpanded ? t("hide") : t("show");
  toggleBtn.title = ui.isExpanded ? t("hide_title") : t("show_title");

  footEl.innerHTML = `<small>${t("tip")}</small>`;

  overlay.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n as Parameters<typeof t>[0] | undefined;
    if (key) el.textContent = t(key);
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
  const el = overlay.querySelector(selector) as HTMLElement | null;
  if (el) el.title = title;
}

const toggleBtn = overlay.querySelector('button[data-act="toggle"]') as HTMLButtonElement;

onUiLangChange(applyI18n);
applyI18n();

// ---------- Toolbar buttons (toggle / font) ----------
function toggleExpanded(button: HTMLElement): void {
  const collapsed = bodyEl.style.display === "none";
  bodyEl.style.display = collapsed ? "" : "none";
  const nowCollapsed = !collapsed;
  ui.isExpanded = !nowCollapsed;
  // Collapsed = header shows only the logo, name and the Show button.
  overlay.classList.toggle("nsr-collapsed", nowCollapsed);

  // Shrink to header-only when collapsed; restore previous height when expanded.
  if (nowCollapsed) {
    savedExpandedHeight = overlay.style.height || overlay.getBoundingClientRect().height + "px";
    suppressSizeSave = true;
    overlay.style.height = "auto";
    overlay.style.minHeight = "0";
  } else {
    overlay.style.height = savedExpandedHeight || "";
    overlay.style.minHeight = "";
    self.setTimeout(() => { suppressSizeSave = false; }, 200);
  }
  button.textContent = nowCollapsed ? t("show") : t("hide");
  button.title = nowCollapsed ? t("show_title") : t("hide_title");
  applyNativeSubtitleVisibility();
}

overlay.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  switch (target.dataset.act) {
    case "toggle":
      toggleExpanded(target);
      break;
  }
});

// ---------- Click-to-seek ----------
listEl.addEventListener("click", (e) => {
  const cueEl = (e.target as HTMLElement).closest(".nsr-cue") as HTMLElement | null;
  if (!cueEl || !state.video) return;
  const s = parseFloat(cueEl.dataset.start || "0");
  if (!isNaN(s)) state.video.currentTime = s;
});

// ---------- Dragging ----------
makeDraggable(overlay, overlay.querySelector(".nsr-header") as HTMLElement);

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
