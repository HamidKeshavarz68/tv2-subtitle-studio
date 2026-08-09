# Changelog

All notable changes to this project will be documented in this file. The format
is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-08-10

### Changed

- **Single line (TV2)**: the translated line now follows the Rolling list
  translation style — smaller, italic and light blue — and sits on the same
  background box as the original line, so the two read as one caption.
- **Text size** control now shows the current size (in px) between the `A−` and
  `A+` buttons, and its range widened to **6–36 px** (default **12**).

### Fixed

- **Single line (TV2)**: on autoplay the styled/translated caption now appears
  immediately instead of only after seeking. The overlay is driven by the
  caption TV 2 is actually painting rather than a cue-list time window that is
  not yet calibrated to the video clock right after load.

## [0.5.0] - 2026-08-09

### Added

- **Single line (TV2)** subtitle view (Settings → Subtitle view). Instead of the
  scrolling side window, the extension overrides TV 2 Play's own on-video caption
  in place: in **Translated** mode it shows one translated line, and in
  **Bilingual** mode it stacks the original above the translation, both centered
  over the video like a normal subtitle. The original **Rolling list** view
  remains the default. The choice persists across sessions (`tsr.viewMode`).
- The on-video caption is produced **non-destructively**: TV 2's native caption
  text is hidden with global CSS (never by touching the text track's `mode` or
  overwriting the player's own nodes), so seeking, pausing and switching
  subtitle tracks keep working. The caption automatically lifts above the player
  control bar while the controls are visible and drops back when they hide, and
  matches TV 2's own caption size (scaled by the Text size control).

### Changed

- The extension's controls now live **in the TV 2 player control bar**: a
  settings button sits to the left of the subtitle/fullscreen buttons and opens
  the Settings menu as a popover anchored to the video's bottom-right corner. The
  **"no → en" status indicator** sits just to the left of that button.
- The floating subtitle window is now a simpler panel — just the draggable title
  bar and the subtitle list — since every control moved into the player-bar
  settings menu. In **Single line (TV2)** view the window is hidden entirely.

## [0.4.1] - 2026-07-24

### Changed

- Merged the **Translation** menu into the **Settings** menu, removing the
  separate Translation button and panel. Settings now lists, in order: Menu
  language, Text size, Playback speed, Display mode, Translate to (target
  language), Translator, and the DeepL API key field (shown only when DeepL is
  selected).

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
