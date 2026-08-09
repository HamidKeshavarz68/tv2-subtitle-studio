/**
 * Injects a settings button into TV 2 Play's bottom control bar, to the left of
 * the subtitle and fullscreen buttons, so the extension's settings menu can be
 * opened straight from the video's bottom-right corner. The "no → en" status
 * indicator sits directly to the left of the button.
 *
 * TV 2 Play's player is a React app whose emotion CSS class names are hashed and
 * unstable, but its controls carry stable `data-testid` hooks:
 *   - the bottom control bar is `[data-testid="player-controls"]`,
 *   - the subtitle button is `[data-testid="player-subtitles-button"]`,
 *   - the fullscreen button is `[data-testid="player-toggle-fullscreen-button"]`.
 * We clone a neighbouring control button's class list so ours inherits the native
 * sizing/hover, and show the extension's own icon so it clearly belongs to us.
 * The control bar is torn down and rebuilt across fullscreen transitions, so this
 * is called repeatedly (see index.ts) to re-inject the button whenever it's gone.
 */

import { TV2 } from "./config";
import { closeSettings, isSettingsOpen, statusEl, toggleSettings } from "./overlay";
import { onUiLangChange, t } from "./i18n";

declare const chrome: any;

const BTN_CLASS = "nsr-player-btn";

// The extension's own icon (declared in web_accessible_resources).
const ICON_URL = (() => {
  try {
    return chrome.runtime.getURL("public/icons/icon-128.png");
  } catch {
    return "";
  }
})();

let button: HTMLButtonElement | null = null;

/**
 * Find where our button should go. Prefer sitting just before the subtitle
 * button (left of both native icons); otherwise before the fullscreen button;
 * otherwise at the end of the bottom control bar.
 */
function findInsertTarget(): { anchor: HTMLElement; before: boolean } | null {
  const subtitle = document.querySelector<HTMLElement>(TV2.subtitlesButton);
  if (subtitle) return { anchor: subtitle, before: true };

  const fullscreen = document.querySelector<HTMLElement>(TV2.fullscreenButton);
  if (fullscreen) return { anchor: fullscreen, before: true };

  const controls = document.querySelector(TV2.controls);
  const buttons = controls
    ? Array.from(controls.querySelectorAll<HTMLElement>("button"))
    : [];
  const last = buttons[buttons.length - 1];
  return last ? { anchor: last, before: false } : null;
}

function createButton(sibling: HTMLElement): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  // Reuse the neighbouring control button's classes so ours matches the native
  // sizing/hover/radius, then add our own marker class.
  const inherited = sibling.tagName === "BUTTON" ? sibling.className : "";
  btn.className = (inherited ? inherited + " " : "") + BTN_CLASS;
  const img = document.createElement("img");
  img.src = ICON_URL;
  img.alt = "";
  img.setAttribute("aria-hidden", "true");
  img.className = "nsr-player-btn-icon";
  img.draggable = false;
  btn.appendChild(img);
  btn.tabIndex = 0;
  btn.title = t("settings_open");
  btn.setAttribute("aria-label", t("settings_open"));
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSettings(btn);
  });
  // Stop the player from treating the press as a play/seek/fullscreen gesture.
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.addEventListener("dblclick", (e) => e.stopPropagation());
  return btn;
}

/**
 * Add the settings button (and the status indicator to its left) to the player
 * control bar if they aren't there yet.
 */
export function injectSettingsButton(): void {
  // Already present and still attached → make sure the status sits just to the
  // left of the button, then stop.
  const existing = document.querySelector("." + BTN_CLASS) as HTMLButtonElement | null;
  if (existing && existing.isConnected) {
    button = existing;
    ensureStatusBeside(button);
    return;
  }

  const target = findInsertTarget();
  if (!target || !target.anchor.parentElement) return;

  const parent = target.anchor.parentElement;
  button = createButton(target.anchor);
  if (target.before) {
    parent.insertBefore(button, target.anchor);
  } else {
    parent.insertBefore(button, target.anchor.nextSibling);
  }
  ensureStatusBeside(button);
}

/** Keep the "no → en" status indicator directly to the left of our button. */
function ensureStatusBeside(btn: HTMLButtonElement): void {
  if (statusEl.nextElementSibling !== btn || statusEl.parentElement !== btn.parentElement) {
    btn.parentElement?.insertBefore(statusEl, btn);
  }
}

/** Remove the button, status and close the popover (used when tearing down). */
export function removePlayerButton(): void {
  if (isSettingsOpen()) closeSettings();
  statusEl.remove();
  button?.remove();
  button = null;
}

// Keep the tooltip in sync when the user switches the menu language.
onUiLangChange(() => {
  if (button) {
    button.title = t("settings_open");
    button.setAttribute("aria-label", t("settings_open"));
  }
});
