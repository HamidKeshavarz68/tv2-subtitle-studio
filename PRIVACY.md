# Privacy Policy — TV2 Subtitle Studio

_Last updated: 2026-07-23_

TV2 Subtitle Studio ("the extension") is a browser extension that displays the
subtitles of videos on TV 2 Play (play.tv2.no) in a scrolling, time-synced panel,
and can optionally show a translation of each subtitle line.

## Summary

**The extension does not collect, store, sell, or share any personal or
identifiable user data.** It has no servers, no analytics, no advertising, no
tracking, and no user accounts.

## What the extension accesses

- **Subtitle text on play.tv2.no.** The extension reads the subtitle cues from
  the TV 2 Play video player that you are already watching, purely in order to
  render them in its side panel on the same page. This text is processed locally
  in your browser and is never sent to us (we operate no servers).

## Optional translation feature

If — and only if — you enable the translation feature, the text of the current
subtitle lines is sent to Google Translate's public translation endpoint
(`translate.googleapis.com`) to obtain a translation, which is then displayed in
the panel. This request contains only the subtitle text to be translated. It
contains no personal information, no identifiers, and no browsing history. The
request is handled by Google under Google's own Privacy Policy
(https://policies.google.com/privacy). If you do not enable translation, no data
leaves your browser.

## Data storage

The extension stores a small number of your own preferences (such as target
translation language, display mode, text size, playback speed, panel size, and
menu language) locally in your browser using `localStorage`. This information
stays on your device, is used only to remember your settings between sessions,
and is never transmitted anywhere.

## Data sharing

We do not transmit, sell, or share any user data with any third party. The only
outbound network request the extension makes is the optional Google Translate
request described above, and only when you have enabled translation.

## Changes to this policy

If this policy changes, the updated version will be published at this same URL
with a new "Last updated" date.

## Contact

For questions about this policy, please open an issue at
https://github.com/HamidKeshavarz68/tv2-subtitle-studio/issues
