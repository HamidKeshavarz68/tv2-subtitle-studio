interface ChromeRuntimeError {
  message?: string;
}

interface ChromeManifest {
  version?: string;
}

interface ChromeRuntime {
  readonly lastError?: ChromeRuntimeError;
  getManifest(): ChromeManifest;
  getURL(path: string): string;
  sendMessage(message: unknown, callback: (response: unknown) => void): void;
  readonly onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    ): void;
  };
}

declare const chrome: {
  readonly runtime: ChromeRuntime;
};

interface Window {
  __tv2SubtitleStudioLoaded?: boolean;
}
