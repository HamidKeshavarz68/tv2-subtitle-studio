# Changelog

All notable changes to this project will be documented in this file. The format
is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-07-24

### Added

- **Translator choice** in the Settings menu: pick between the free Google
  Translate (default) and **DeepL** (bring your own API key). Selecting DeepL
  reveals a password-style field to paste the key; both the choice and the key
  persist across sessions (`tsr.translator`, `tsr.deeplApiKey`).
- **Automatic fallback**: if no DeepL key is entered or the key is rejected
  (wrong key, quota reached, unsupported language), translation silently falls
  back to the free Google Translate and shows a brief, throttled warning toast.
  DeepL requests are proxied through the background service worker (free-tier
  `:fx` keys use `api-free.deepl.com`, paid keys use `api.deepl.com`), keeping
  the extension dependency-free and working on mobile and ARM devices.

### Changed

- The overlay now opens in the **top-left** corner by default (was top-right).
- The DeepL fallback warning is shown **inside the extension overlay, just under
  the top menu**, so it clearly belongs to this extension, and now stays visible
  for 7 seconds.

## [0.1.0] - 2026-07-23

Initial release of **TV2 Subtitle Studio**, a Chrome (MV3) extension for
**play.tv2.no**.

### Added

- Side-panel overlay on `play.tv2.no` showing every subtitle cue captured from
  the current video, scrolling in sync with playback. Past cues fade, the active
  line is highlighted (and stays active through silent gaps until the next cue
  starts), and upcoming lines stay visible so you can read ahead.
- Click any cue to seek the video to that timestamp.
- **Translation** via Google Translate (public `gtx` endpoint), proxied through a
  background service worker so the page CSP does not block requests.
- **Display modes**: Original / Translated / Bilingual, with a dedicated
  Translation menu.
- **Coalesced batch translator** — visible-window cues are sent in one request
  per batch instead of one per cue — plus a per-pair LRU cache so seeks and
  re-watches don't re-translate.
- **Playback-speed selector**, **font-size buttons** (A− / A+, 10–32 px),
  **resize from any edge or corner** with persisted size, **drag-to-move**, and
  **Hide / Show** to collapse to just the toolbar.
- **Fullscreen-aware**: the panel reparents into the fullscreen element so it
  stays visible during fullscreen playback.
- **Visual native-caption hider** that suppresses TV 2 Play's on-video subtitle
  while the panel is expanded (never touching `track.mode`, so cues keep
  streaming), restoring it on collapse.
- Menu i18n (English / Norsk).
- Mounts only on actual video pages (URLs containing segments like `/serier/`,
  `/filmer/`, `/film/`, `/sport/`, `/direkte/`, `/program/`, `/episode/`, `/se/`).
