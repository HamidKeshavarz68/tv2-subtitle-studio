/**
 * TV2 Subtitle Studio — content script entry point.
 *
 * Wires the modules together and owns the page lifecycle: it gates on actual
 * video pages, mounts/tears down the overlay across TV 2 Play's SPA navigations,
 * and keeps the overlay attached to the current <video>.
 *
 * Domains:
 *  - core         shared configuration, state, i18n and pure helpers
 *  - player       video discovery, lifecycle and player-control integration
 *  - subtitles    DOM/TTML capture, cue storage and native-caption rendering
 *  - translation  provider proxying, batching, caching and fallback
 *  - ui           overlay DOM, interactions, rendering and notifications
 */

import { VIDEO_PAGE_RE } from "./core/config";
import { state } from "./core/state";
import {
  overlay,
  syncFullscreenParent,
  closeSettings,
  settingsHost,
} from "./ui/overlay";
import {
  applyNativeSubtitleVisibility,
  clearNativeSubtitleHiding,
} from "./subtitles/native-subtitles";
import { stopTranslations } from "./translation/translator";
import { attachToVideo, detachVideo, findVideo, scanTextTracks } from "./player/video";
import { injectSettingsButton, removePlayerButton } from "./player/player-controls";

if (!window.__tv2SubtitleStudioLoaded) {
  window.__tv2SubtitleStudioLoaded = true;
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
  history.pushState = function (
    this: History,
    ...args: Parameters<History["pushState"]>
  ) {
    const r = origPush.apply(this, args);
    fireNavigation();
    return r;
  } as typeof history.pushState;
  history.replaceState = function (
    this: History,
    ...args: Parameters<History["replaceState"]>
  ) {
    const r = origReplace.apply(this, args);
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
