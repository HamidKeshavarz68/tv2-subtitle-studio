/**
 * Injects a settings button into TV 2 Play's bottom control bar, at the very
 * left of the right-aligned button group (before all of TV 2's own controls), so
 * the extension's settings menu can be opened straight from the video's
 * bottom-right corner. The "no → en" status indicator sits directly to the left
 * of the button, giving the final order:
 *   [no → en] [settings] [ …TV 2's native buttons… ]
 *
 * TV 2 Play's player is a React app whose emotion CSS class names are hashed and
 * unstable, but its controls carry stable `data-testid` hooks:
 *   - the bottom control bar is `[data-testid="player-controls"]`,
 *   - the subtitle button is `[data-testid="player-subtitles-button"]`,
 *   - the fullscreen button is `[data-testid="player-toggle-fullscreen-button"]`.
 * Each native button lives in its own wrapper `<div>` inside one shared,
 * right-aligned flex group. We find that group as the lowest common ancestor of
 * the subtitle and fullscreen buttons and prepend our elements to it as clean
 * siblings of those wrappers — inserting *inside* a button's tooltip wrapper
 * instead would swallow our click. We clone a native button's class list so ours
 * inherits the native sizing/hover, and show the extension's own icon so it
 * clearly belongs to us. The control bar is torn down and rebuilt across
 * fullscreen transitions, so this is called repeatedly (see index.ts) to
 * re-inject the button whenever it's gone.
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

/** Walk up the ancestor chain, nearest first (including the element itself). */
function ancestorChain(el: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let cur: HTMLElement | null = el;
  while (cur) {
    chain.push(cur);
    cur = cur.parentElement;
  }
  return chain;
}

/** Lowest common ancestor of two elements, or null if they don't share one. */
function lowestCommonAncestor(a: HTMLElement, b: HTMLElement): HTMLElement | null {
  const set = new Set(ancestorChain(b));
  for (const node of ancestorChain(a)) {
    if (set.has(node)) return node;
  }
  return null;
}

/**
 * Locate the right-aligned button group: the lowest common ancestor of the
 * subtitle and fullscreen buttons. Each native button lives in its own wrapper
 * `<div>` directly inside this group, so prepending to the group lands us left of
 * every native button as a clean sibling of those wrappers (never nested inside a
 * button's tooltip wrapper, which would swallow clicks). `styleSource` is a
 * native button we clone classes from for matching sizing/hover.
 */
function findGroup(): { group: HTMLElement; styleSource: HTMLElement } | null {
  const subtitle = document.querySelector<HTMLElement>(TV2.subtitlesButton);
  const fullscreen = document.querySelector<HTMLElement>(TV2.fullscreenButton);
  if (subtitle && fullscreen) {
    const group = lowestCommonAncestor(subtitle, fullscreen);
    if (group) return { group, styleSource: subtitle };
  }
  return null;
}

/**
 * The first child of the group that isn't one of ours — i.e. the wrapper of the
 * left-most native button. Our elements are inserted before this so they sit at
 * the very start of the group.
 */
function firstNativeChild(group: HTMLElement): HTMLElement | null {
  for (const child of Array.from(group.children)) {
    const el = child as HTMLElement;
    if (el === button || el === statusEl || el.classList.contains(BTN_CLASS)) continue;
    return el;
  }
  return null;
}

/**
 * Fallback insertion point used only until the shared group can be resolved
 * (e.g. a very early call before both native buttons have rendered).
 */
function fallbackTarget(): { parent: HTMLElement; before: HTMLElement | null; styleSource: HTMLElement } | null {
  const anchorBtn =
    document.querySelector<HTMLElement>(TV2.subtitlesButton) ??
    document.querySelector<HTMLElement>(TV2.fullscreenButton);
  if (anchorBtn && anchorBtn.parentElement) {
    return { parent: anchorBtn.parentElement, before: anchorBtn, styleSource: anchorBtn };
  }
  const controls = document.querySelector<HTMLElement>(TV2.controls);
  if (controls) {
    const buttons = Array.from(controls.querySelectorAll<HTMLElement>("button"));
    const last = buttons[buttons.length - 1] ?? controls;
    return { parent: controls, before: null, styleSource: last };
  }
  return null;
}

function createButton(styleSource: HTMLElement): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  // Reuse a native control button's classes so ours matches the native
  // sizing/hover/radius, then add our own marker class.
  const inherited = styleSource.tagName === "BUTTON" ? styleSource.className : "";
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
 * control bar, and keep it anchored at the very start of the right-aligned button
 * group. Because TV 2 re-renders its controls (and this runs from a
 * MutationObserver), an early call may land the button in a fallback spot before
 * both native buttons exist; every later call re-anchors it to the group start
 * once the group is resolvable. All moves are guarded so we never mutate the DOM
 * when already in place (which would feed the observer back into a loop).
 */
export function injectSettingsButton(): void {
  const existing = document.querySelector("." + BTN_CLASS) as HTMLButtonElement | null;
  if (existing && existing.isConnected) button = existing;

  const g = findGroup();
  if (g) {
    if (!button || !button.isConnected) button = createButton(g.styleSource);
    // Re-anchor to the start of the group (left of every native button) only if
    // it isn't already there.
    const before = firstNativeChild(g.group);
    if (button.parentElement !== g.group || button.nextElementSibling !== before) {
      g.group.insertBefore(button, before);
    }
    ensureStatusBeside(button);
    return;
  }

  // No group yet → leave an already-placed button alone, else drop one in a
  // temporary fallback spot; a later call will re-anchor it correctly.
  if (button && button.isConnected) {
    ensureStatusBeside(button);
    return;
  }
  const target = fallbackTarget();
  if (!target) return;
  button = createButton(target.styleSource);
  target.parent.insertBefore(button, target.before);
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
