export type TranslatorProvider = "google" | "deepl";

export const TRANSLATE_MESSAGE_TYPE = "translate";
export const CUE_SEPARATOR = "\n\n@@@\n\n";

export interface TranslatePayload {
  provider: TranslatorProvider;
  apiKey?: string;
  text: string;
  source?: string;
  target: string;
}

export interface TranslateRequest extends TranslatePayload {
  type: typeof TRANSLATE_MESSAGE_TYPE;
}

export type TranslateResponse =
  | { ok: true; text: string }
  | { ok: false; error: string };

export interface TranslateMessage {
  type: typeof TRANSLATE_MESSAGE_TYPE;
  text?: unknown;
  source?: unknown;
  target?: unknown;
  provider?: unknown;
  apiKey?: unknown;
}

export function isTranslateMessage(value: unknown): value is TranslateMessage {
  if (!value || typeof value !== "object") return false;
  return (value as { type?: unknown }).type === TRANSLATE_MESSAGE_TYPE;
}

export function isTranslateResponse(value: unknown): value is TranslateResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as { ok?: unknown; text?: unknown; error?: unknown };
  return response.ok === true
    ? typeof response.text === "string"
    : response.ok === false && typeof response.error === "string";
}
