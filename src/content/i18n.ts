/**
 * Tiny i18n layer for the overlay's own UI strings.
 *
 * Holds the current menu language and a per-locale message table. Modules call
 * `t(key)` to read a string; `setUiLang()` switches the active locale. The
 * overlay re-applies all static text via `applyI18n()` (registered as a
 * listener) whenever the language changes.
 */

import { DEFAULT_UI_LANG, STORAGE_KEYS, UiLang } from "./config";
import { readStorage, writeStorage } from "./utils";

export type MessageKey =
  | "status_waiting"
  | "translate_to"
  | "display_mode"
  | "mode_original"
  | "mode_translated"
  | "mode_bilingual"
  | "playback_speed"
  | "font_smaller"
  | "font_larger"
  | "hide"
  | "show"
  | "hide_title"
  | "show_title"
  | "tip"
  | "empty"
  | "translation_failed"
  | "no_translation"
  | "translate_open"
  | "translate_heading"
  | "setting_target_lang"
  | "setting_display_mode"
  | "settings_open"
  | "settings_heading"
  | "download"
  | "download_busy"
  | "download_title"
  | "setting_playback_speed"
  | "setting_font_size"
  | "setting_ui_language"
  | "feedback_intro"
  | "feedback_email"
  | "feedback_repo";

type Messages = Record<MessageKey, string>;

const MESSAGES: Record<UiLang, Messages> = {
  en: {
    status_waiting: "waiting…",
    translate_to: "Translate to…",
    display_mode: "Display mode",
    mode_original: "Original",
    mode_translated: "Translated",
    mode_bilingual: "Bilingual",
    playback_speed: "Playback speed",
    font_smaller: "Smaller text",
    font_larger: "Larger text",
    hide: "Hide",
    show: "Show",
    hide_title: "Hide subtitle list",
    show_title: "Show subtitle list",
    tip: "Tip: enable subtitles in the TV 2 Play player so they get downloaded.",
    empty:
      "Waiting for subtitles…<br/>Open the TV 2 Play player's CC/subtitle menu and " +
      "select a language — every cue will then be loaded and rolled here.",
    translation_failed: "Translation failed (click cue to retry by changing language)",
    no_translation: "— No translation —",
    translate_open: "Translation",
    translate_heading: "Translation",
    setting_target_lang: "Translate to",
    setting_display_mode: "Display mode",
    settings_open: "Settings",
    settings_heading: "Settings",
    download: "Download subtitle",
    download_busy: "Downloading…",
    download_title: "Download subtitles (.srt)",
    setting_playback_speed: "Playback speed",
    setting_font_size: "Text size",
    setting_ui_language: "Menu language",
    feedback_intro: "Found a bug, issue or have a suggestion?",
    feedback_email: "Email the author",
    feedback_repo: "GitHub repository",
  },
  no: {
    status_waiting: "venter…",
    translate_to: "Oversett til…",
    display_mode: "Visningsmodus",
    mode_original: "Original",
    mode_translated: "Oversatt",
    mode_bilingual: "Tospråklig",
    playback_speed: "Avspillingshastighet",
    font_smaller: "Mindre tekst",
    font_larger: "Større tekst",
    hide: "Skjul",
    show: "Vis",
    hide_title: "Skjul undertekstliste",
    show_title: "Vis undertekstliste",
    tip: "Tips: slå på undertekster i TV 2 Play-spilleren slik at de lastes ned.",
    empty:
      "Venter på undertekster…<br/>Åpne TV 2 Play-spillerens undertekstmeny og velg " +
      "et språk — hver linje lastes da inn og rulles her.",
    translation_failed: "Oversettelsen mislyktes (klikk på linjen for å prøve igjen ved å bytte språk)",
    no_translation: "— Ingen oversettelse —",
    translate_open: "Oversettelse",
    translate_heading: "Oversettelse",
    setting_target_lang: "Oversett til",
    setting_display_mode: "Visningsmodus",
    settings_open: "Innstillinger",
    settings_heading: "Innstillinger",
    download: "Last ned undertekst",
    download_busy: "Laster ned…",
    download_title: "Last ned undertekster (.srt)",
    setting_playback_speed: "Avspillingshastighet",
    setting_font_size: "Tekststørrelse",
    setting_ui_language: "Menyspråk",
    feedback_intro: "Funnet en feil eller har et forslag?",
    feedback_email: "Send e-post til utvikleren",
    feedback_repo: "GitHub-repositorium",
  },
};

function normalizeLang(value: string | null): UiLang {
  return value === "no" || value === "en" ? value : DEFAULT_UI_LANG;
}

let currentLang: UiLang = normalizeLang(readStorage(STORAGE_KEYS.uiLang));

const listeners = new Set<() => void>();

export const getUiLang = (): UiLang => currentLang;

export function t(key: MessageKey): string {
  return MESSAGES[currentLang][key];
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onUiLangChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setUiLang(lang: UiLang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  writeStorage(STORAGE_KEYS.uiLang, lang);
  listeners.forEach((fn) => fn());
}
