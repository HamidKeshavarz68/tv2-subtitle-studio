/**
 * Shared application state and persisted settings.
 *
 * A single source of truth that the other modules read and mutate. Settings are
 * backed by localStorage; helpers here own both the in-memory value and its
 * persistence so callers never have to touch storage directly.
 */

import { DisplayMode, FONT, SPEED, STORAGE_KEYS } from "./config";
import { clamp, readStorage, writeStorage } from "./utils";

export interface AppState {
  video: HTMLVideoElement | null;
  track: TextTrack | null;
  cues: TextTrackCue[];
}

export const state: AppState = {
  video: null,
  track: null,
  cues: [],
};

/** Transient UI flags (not persisted). */
export const ui = {
  /** Whether the subtitle list is expanded (vs. collapsed to the toolbar). */
  isExpanded: true,
};

export const clampFont = (n: number): number => clamp(n, FONT.min, FONT.max);
export const clampSpeed = (n: number): number => clamp(n, SPEED.min, SPEED.max);

export interface Settings {
  targetLang: string;
  displayMode: DisplayMode;
  fontSize: number;
  playbackRate: number;
}

export const settings: Settings = {
  targetLang: readStorage(STORAGE_KEYS.targetLang) || "off",
  displayMode: (readStorage(STORAGE_KEYS.displayMode) as DisplayMode) || "original",
  fontSize: clampFont(parseInt(readStorage(STORAGE_KEYS.fontSize) || "", 10) || FONT.default),
  playbackRate: clampSpeed(parseFloat(readStorage(STORAGE_KEYS.playbackRate) || "") || SPEED.default),
};

export function setTargetLang(lang: string): void {
  settings.targetLang = lang;
  writeStorage(STORAGE_KEYS.targetLang, lang);
}

export function setDisplayMode(mode: DisplayMode): void {
  settings.displayMode = mode;
  writeStorage(STORAGE_KEYS.displayMode, mode);
}

export function setFontSize(size: number): void {
  settings.fontSize = clampFont(size);
  writeStorage(STORAGE_KEYS.fontSize, String(settings.fontSize));
}

/** True when translation output should be requested/shown at all. */
export const isTranslationActive = (): boolean =>
  settings.targetLang !== "off" &&
  settings.displayMode !== "original";

/** Source language of the current track (base code), defaulting to Norwegian. */
export function detectSourceLang(): string {
  const lang = (state.track?.language || "").toLowerCase();
  if (lang) return lang.split("-")[0] || lang;
  return "no";
}

/** Apply the chosen playback rate to the current video and persist it. */
export function applyPlaybackRate(): void {
  if (state.video) {
    try {
      state.video.playbackRate = settings.playbackRate;
    } catch {
      // ignore
    }
  }
  writeStorage(STORAGE_KEYS.playbackRate, String(settings.playbackRate));
}

export function setPlaybackRate(rate: number): void {
  settings.playbackRate = clampSpeed(rate);
  applyPlaybackRate();
}
