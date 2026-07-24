/**
 * Minimal, dependency-free toast for transient status messages (e.g. the DeepL
 * fallback warning). Kept free of imports from overlay/renderer/translator to
 * avoid an import cycle: translator.ts needs to show a toast, and overlay pulls
 * translator in. Only the i18n `t` helper is safe to import (no cycle back).
 */

import { OVERLAY_ID } from "./config";

const TOAST_ID = OVERLAY_ID + "-toast";

let hideTimer: number | null = null;

function ensureToast(): HTMLDivElement {
  let el = document.getElementById(TOAST_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = TOAST_ID;
    el.className = "nsr-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
  }
  // Reparent so the toast shows above the player, including in fullscreen.
  const host = document.fullscreenElement ?? document.documentElement;
  if (el.parentElement !== host) host.appendChild(el);
  return el;
}

/** Show a short-lived toast message. Replaces any currently visible toast. */
export function showToast(message: string, durationMs = 4000): void {
  const el = ensureToast();
  el.textContent = message;

  // Force a reflow so the transition runs even on a rapid re-show.
  void el.offsetWidth;
  el.classList.add("nsr-toast-show");

  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = self.setTimeout(() => {
    el.classList.remove("nsr-toast-show");
    hideTimer = null;
  }, Math.max(0, durationMs));
}
