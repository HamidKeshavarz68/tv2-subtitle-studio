# TV2 Subtitle Studio

> **📦 Chrome Web Store:** not published yet. _TODO: add the listing link once the
> extension is submitted._ For now, install it unpacked (see below).

A Chrome (MV3) extension that supercharges the **play.tv2.no** player with a side
panel that:

- shows **every subtitle cue** captured from the current video, scrolling in sync
  with playback (past cues fade, the active line is highlighted, upcoming lines
  stay visible so you can read ahead),
- can **translate** the subtitles to any of ~30 languages via Google Translate
  (free, default) or **DeepL** with your own API key (Original / Translated /
  Bilingual modes),
- lets you **click any line to seek** the video to that point,
- adds a **playback-speed selector**,
- adjusts **font size** (A− / A+),
- can be **resized from any edge or corner** and dragged anywhere on screen,
- hides TV 2 Play's native on-video subtitle while the panel is open, and restores
  it the moment you collapse the panel.

## Table of contents

- [Install (unpacked)](#install-unpacked)
- [Toolbar controls](#toolbar-controls)
- [Scripts](#scripts)
- [Releasing to the Chrome Web Store](#releasing-to-the-chrome-web-store)
- [How it works](#how-it-works)
- [File layout](#file-layout)
- [Notes & limitations](#notes--limitations)
- [Roadmap](#roadmap)
- [License](#license)

## Install (unpacked)

```powershell
npm install
npm run build
```

This type-checks with `tsc` and bundles the TypeScript sources with
[esbuild](https://esbuild.github.io/) into:

- `src/content/index.ts` → `dist/content/index.js` (isolated content script)
- `src/content/main-world/net-hook.ts` → `dist/content/net-hook.js` (player network bridge)
- `src/background/index.ts` → `dist/background/index.js` (service worker — proxies
  translation calls so the page CSP can't block them)

Then:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this project folder (the one
   containing `manifest.json`).
3. Open any video on <https://play.tv2.no/>.
4. **Turn subtitles on in the TV 2 Play player at least once** — pick any
   language from the player's CC menu. The player only streams a subtitle track
   when the user requests it; once you have, cues stream into the panel as the
   video plays.
5. The panel appears in the top-left. Drag the header to move it. Drag any
   edge or corner to resize. Click **Hide** to collapse to just the
   toolbar; click **Show** to bring the list back.

> The panel only mounts on actual video pages (URLs containing segments like
> `/serier/`, `/filmer/`, `/film/`, `/sport/`, `/direkte/`, `/program/`,
> `/episode/`, `/se/`). The main / category pages of `play.tv2.no` stay clean.

## Toolbar controls

| Control | What it does |
| --- | --- |
| **Language** | Target language for translation. "— No translation —" disables it. Hidden when mode is "Original". |
| **Mode** | `Original` / `Translated` / `Bilingual`. Bilingual shows the original above and a smaller, blue, italic translation below. Hidden when language is off. |
| **Speed** | Sets `video.playbackRate` and re-asserts it if the player tries to reset. |
| **A− / A+** | Cue font size (10 px – 32 px, persisted). |
| **⚙ Settings** | Opens a dropdown to change menu language, translator (Google or DeepL), playback speed and font size. Choosing DeepL reveals a field to paste your API key. |
| **Hide / Show** | Collapses the window to just the toolbar, or restores its previous size. |

The settings dropdown is localised with a small built-in i18n layer
(`src/content/core/i18n.ts`).
Switching the menu language re-renders every toolbar label and tooltip on the fly.
Its size is derived automatically from the effective viewport, keeping the
controls compact on ordinary screens and readable on high-resolution TVs without
adding another user setting.
The dropdown also shows the current extension version and quick links to email the
author or open the GitHub repository for bugs, issues and suggestions.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run typecheck` | Type-check the sources with `tsc` (no emit). |
| `npm run build` | Type-check, generate icons, then bundle TypeScript → `dist/` with esbuild. |
| `npm run watch` | Rebuild on change (esbuild watch mode). |
| `npm run clean` | Delete the `dist/` folder. |
| `npm run rebuild` | `clean` + `build`. |
| `npm run package` | Rebuild and produce `build/tv2-subtitle-studio.zip` ready to upload to the Chrome Web Store. |
| `npm run crx` | Rebuild and produce `build/tv2-subtitle-studio.crx` (auto-creates the signing key at `.crx-key/key.pem` on first run). |

> The `.crx` signing key lives in `.crx-key/` (git-ignored), **not** under
> `build/`. It is kept in a dot-prefixed folder on purpose: Chrome's
> **Load unpacked** recursively scans the project folder, and it warns if a
> private key file is found inside the extension. Chrome ignores files and
> folders whose names start with `.`, so the key never trips that warning.
> Back this file up and reuse it for every build to keep a stable extension ID.

## Releasing to the Chrome Web Store

The repository ships GitHub Actions workflows under `.github/workflows/`:

- **`ci.yml`** – runs on every push / PR; builds, sanity-checks the produced
  files, and uploads a build artefact.
- **`publish.yml`** – on every tag matching `v*` (e.g. `v1.0.1`), or via
  manual *workflow_dispatch*, it:
  1. verifies the tag matches `manifest.json`'s `version`,
  2. builds + zips the extension,
  3. uploads it to the Chrome Web Store via
     [`chrome-webstore-upload-cli`](https://github.com/fregante/chrome-webstore-upload-cli)
     and (for tag pushes) auto-publishes.

### One-time setup

1. Manually upload the first build (the zip from `npm run package`) to the
   [Chrome Web Store dashboard](https://chrome.google.com/webstore/devconsole)
   so Google assigns you an extension ID.
2. In Google Cloud Console, enable the **Chrome Web Store API** and create
   OAuth 2.0 credentials (type: *Desktop app*).
3. Generate a refresh token:
   ```powershell
   npx chrome-webstore-upload-cli@3 generate-refresh-token
   ```
4. Add four repository secrets (Settings → Secrets and variables → Actions):

   | Secret | Value |
   | --- | --- |
   | `CWS_EXTENSION_ID` | Extension ID from the developer dashboard |
   | `CWS_CLIENT_ID` | OAuth 2.0 client ID |
   | `CWS_CLIENT_SECRET` | OAuth 2.0 client secret |
   | `CWS_REFRESH_TOKEN` | Refresh token from step 3 |

### Cutting a release

```powershell
# bump version in package.json + manifest.json so they match, commit, then:
git tag v1.0.1
git push --tags
```

GitHub Actions will build, upload, and publish.

## How it works

### Subtitle capture

A content script finds the player's `<video>` element (works across TV 2 Play's
SPA navigations) and listens for `addtrack` on `video.textTracks`, plus `cuechange`
on the subtitle track and a periodic re-scan. Whenever the cue set changes it is
snapshotted into shared state.

The script **never changes `track.mode`**. TV 2 Play's player streams subtitle
segments only while its text track is visible, so forcing the track to
`'hidden'` (an earlier approach) made the player stop loading cues — the overlay
would freeze on the last cue while the video kept playing. Leaving the
user-selected track untouched keeps cues flowing.

Because the cue set is delivered (and evicted) in segments, the snapshot is
guarded by a content *signature* (count + boundary timestamps), not just length,
so it refreshes correctly even when cues are appended, replaced or rolled
forward.

### Hiding TV 2 Play's native captions

Since `track.mode` is left alone, the native captions are suppressed *visually*
instead, fully reversibly:

- a `video::cue { … }` stylesheet covers the browser's native cue renderer, and
- the player paints its on-video subtitle as a styled DOM node (not via `::cue`),
  so the script also walks the player container and `visibility:hidden`s any
  leaf-ish element whose visible text matches the current cue.

Both are removed when the panel collapses or you leave the video page.

### Rendering & rolling window

On every `timeupdate`, a binary search finds the active cue (most recent
cue with `startTime ≤ currentTime`). The active cue stays highlighted
through the silent gap until the **next** cue starts, so the current line
never disappears between subtitles. A window of 3 past + 12 upcoming cues
is re-rendered only when the window or translation states change, and the
active line auto-scrolls to the centre.

### Translation (Google Translate, batched)

- The unauthenticated `translate.googleapis.com/translate_a/single?client=gtx`
  endpoint is used (the same one Chrome's "Translate this page" calls — no
  API key, but unofficial; rate-limited by IP).
- The page's CSP blocks direct fetches from a content script, so all
  translation requests are proxied through the **background service worker**
  (`dist/background/index.js`).
- Translation is **on-demand** — only the visible window (active cue + the
  next ~12) is translated, not the whole episode. As playback advances new
  cues stream in.
- Requests are **coalesced into batches**: every render-triggered enqueue
  joins a 30 ms collection window, and the resulting set is sent to Google
  in **one HTTP request** (cues separated by a `@@@` token, then split back
  apart).
- Per-pair LRU cache (`translator|source|target|normalised text` → translation)
  so repeats and seeks don't re-translate. The cache key includes the translator
  so switching providers never returns stale results.
- Falls back to per-cue requests if the separator gets mangled.

### DeepL (optional, bring your own key)

- In **⚙ Settings** you can switch the translator from Google (free, default)
  to **DeepL**. Selecting DeepL reveals a password-style field to paste your
  API key; the choice and key are persisted (`tsr.translator`,
  `tsr.deeplApiKey`).
- DeepL requests are proxied through the same background service worker.
  Free-tier keys (ending in `:fx`) use `api-free.deepl.com`; paid keys use
  `api.deepl.com`. Cues are sent as separate `text` fields in one request and
  rejoined, matching the batch splitter.
- If the key is missing or rejected (wrong key, quota reached, or a language
  DeepL does not support), translation **automatically falls back** to the free
  Google Translate and a short warning toast is shown. No dependencies are
  added, so it works on mobile and ARM devices (e.g. Raspberry Pi) too.

### Resizing & dragging

Eight invisible handles (4 edges + 4 corners) translate mouse drags into
width/height/top/left changes, clamped to `[240×140, 95vw×95vh]` and to the
viewport. Header dragging uses the same scheme. Position is not persisted
across reloads, but **size is** (`localStorage.tsr.size`).

### Persisted settings (localStorage)

| Key | Value |
| --- | --- |
| `tsr.targetLang` | BCP-47 base code or `off` |
| `tsr.displayMode` | `original` / `translated` / `bilingual` |
| `tsr.fontSize` | px |
| `tsr.size` | `{ "w": …, "h": … }` |
| `tsr.playbackRate` | number 0.25 – 4 |
| `tsr.uiLang` | `en` / `no` (menu language) |
| `tsr.translator` | `google` / `deepl` (default `google`) |
| `tsr.deeplApiKey` | DeepL API key (used only when translator is `deepl`) |

## File layout

```
tv2-subtitle-studio/
├── manifest.json              MV3 manifest (content script + service worker)
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
├── LICENSE
├── scripts/
│   └── build.mjs              esbuild bundler (one-off + --watch)
├── public/
│   └── icons/                 Toolbar / web-store icons (placeholder SVG)
└── src/
    ├── chrome.d.ts             Minimal Chrome runtime declarations
    ├── background/
    │   └── index.ts            Google Translate + DeepL service-worker proxy
    ├── content/
    │   ├── index.ts            Composition root: SPA gating + mount lifecycle
    │   ├── core/               Configuration, state, i18n and shared pure helpers
    │   ├── main-world/         Page-context network bridge
    │   ├── player/             Video discovery, lifecycle and player controls
    │   ├── subtitles/          DOM/TTML capture, cue store and native captions
    │   ├── translation/        Translation batching, caching and fallback
    │   └── ui/                 Overlay, rendering and transient notifications
    ├── shared/
    │   └── translation.ts      Typed content ↔ service-worker message contract
    └── styles/
        └── overlay.css         Overlay styles
```

Built with `npm run build` → `dist/content/index.js` and
`dist/background/index.js` (each a single bundled file).

## Notes & limitations

- **Subtitles must be enabled in the player**: turn subtitles on in the
  TV 2 Play player at least once per video so cues start streaming.
- **Live streams** that ship only in-band 608/708 captions don't expose
  cues via `TextTrack.cues` and won't roll.
- The Google Translate `gtx` endpoint is **unofficial**. If you start
  seeing only ⚠ on cues, that's almost certainly a temporary 429 from
  Google — wait a few minutes or pause translation by switching mode to
  "Original".
- The DOM-hiding heuristic for the on-video subtitle is content-based
  (it matches by text). If TV 2 Play ever changes their renderer markedly the
  match may need tightening.

## Roadmap

- Additional cloud providers with API keys (Google Cloud Translation v3) for
  higher quality / quota guarantees. (DeepL is already supported.)
- Persistent translation cache per-program in `chrome.storage.local`.

## License

[MIT](./LICENSE)
