/**
 * TV2 Subtitle Studio — content script entry point.
 *
 * Wires the modules together and owns the page lifecycle: it gates on actual
 * video pages, mounts/tears down the overlay across TV 2 Play's SPA navigations,
 * and keeps the overlay attached to the current <video>.
 *
 * Modules:
 *  - config            shared constants, language list and types
 *  - utils             pure helpers (strip/normalize/escape/time/storage)
 *  - state             shared state + persisted settings
 *  - translator        Google Translate proxy + coalesced batch engine
 *  - native-subtitles  hide/restore the player's native captions
 *  - renderer          status line + rolling-window render
 *  - overlay           overlay DOM, toolbar controls, drag/resize, seek
 *  - video             video/track discovery, attach/detach, cue snapshots
 */

import { VIDEO_PAGE_RE } from "./config";
import { state } from "./state";
import { overlay, syncFullscreenParent, closeSettings, settingsHost } from "./overlay";
import { applyNativeSubtitleVisibility, clearNativeSubtitleHiding } from "./native-subtitles";
import { stopTranslations } from "./translator";
import { attachToVideo, detachVideo, findVideo, scanTextTracks } from "./video";
import { injectSettingsButton, removePlayerButton } from "./player-controls";

if (!(window as any).__tv2SubtitleStudioLoaded) {
  (window as any).__tv2SubtitleStudioLoaded = true;
  bootstrap();
}

function isVideoPage(): boolean {
  return VIDEO_PAGE_RE.test(location.pathname);
}

function bootstrap(): void {
  let mounted = false;

  function mountIfNeeded(): void {
    const should = isVideoPage();
    if (should && !mounted) {
      document.documentElement.appendChild(overlay);
      document.documentElement.appendChild(settingsHost);
      syncFullscreenParent(); // in case we entered fullscreen on the new page
      mounted = true;
      const v = findVideo();
      if (v) attachToVideo(v);
      applyNativeSubtitleVisibility();
      injectSettingsButton();
    } else if (!should && mounted) {
      // Leaving a video page → tear everything down.
      clearNativeSubtitleHiding();
      closeSettings();
      removePlayerButton();
      overlay.parentElement?.removeChild(overlay);
      settingsHost.parentElement?.removeChild(settingsHost);
      stopTranslations();
      detachVideo();
      state.video = null;
      state.track = null;
      state.cues = [];
      state.activeCue = null;
      mounted = false;
    }
  }

  // Detect SPA navigations: TV 2 Play uses the History API.
  const fireNavigation = () => queueMicrotask(mountIfNeeded);
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (this: History, ...args: any[]) {
    const r = origPush.apply(this, args as any);
    fireNavigation();
    return r;
  } as typeof history.pushState;
  history.replaceState = function (this: History, ...args: any[]) {
    const r = origReplace.apply(this, args as any);
    fireNavigation();
    return r;
  } as typeof history.replaceState;
  window.addEventListener("popstate", fireNavigation);
  window.addEventListener("hashchange", fireNavigation);

  const mo = new MutationObserver(() => {
    if (!mounted) return;
    const v = findVideo();
    if (v && v !== state.video) attachToVideo(v);
    // TV 2's React player re-renders its controls across state changes, so
    // re-add our settings button promptly whenever it gets wiped.
    injectSettingsButton();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Periodic tick: re-evaluate URL, re-scan tracks, re-attach if needed.
  setInterval(() => {
    mountIfNeeded();
    if (!mounted) return;
    // TV 2 rebuilds its controls across navigations / fullscreen toggles, so
    // re-add our settings button whenever it has gone missing.
    injectSettingsButton();
    if (!state.video || !document.contains(state.video)) {
      const v = findVideo();
      if (v) attachToVideo(v);
      return;
    }
    scanTextTracks(state.video);
  }, 1500);

  // Initial check.
  mountIfNeeded();
}
