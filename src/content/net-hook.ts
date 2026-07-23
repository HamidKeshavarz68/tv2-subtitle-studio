/**
 * MAIN-world network hook for TV 2 Play subtitle capture.
 *
 * This runs in the PAGE's JavaScript world (manifest `"world": "MAIN"`), not the
 * isolated content-script world, which is the only place it can observe the
 * player's own `fetch` / `XMLHttpRequest` traffic. TV 2 Play (Canal+ RxPlayer)
 * loads subtitles as DASH fMP4 segments containing TTML — the requests whose URL
 * contains "textstream", served as `video/mp4`. We watch for those, extract the
 * embedded `<tt>...</tt>` document, and forward it to the content script (which
 * parses it — see ttml-subtitles.ts) via `window.postMessage`.
 *
 * Everything here is defensive and best-effort: it never throws into, blocks, or
 * alters the player's requests — it only clones/reads responses on the side.
 */

(() => {
  const decoder = new TextDecoder("utf-8");
  /** Extracted TTML documents kept so a late-starting listener can replay them. */
  const segments = new Map<string, string>();
  const MAX_SEGMENTS = 1000;

  const isSubtitleUrl = (u: unknown): u is string =>
    typeof u === "string" && /textstream/i.test(u);

  function post(url: string, xml: string): void {
    window.postMessage({ __tv2subKind: "ttml", xml, url }, "*");
  }

  function forward(url: string, buffer: ArrayBuffer): void {
    if (segments.has(url)) return;
    try {
      const s = decoder.decode(new Uint8Array(buffer));
      const i = s.indexOf("<tt");
      const j = s.lastIndexOf("</tt>");
      if (i === -1 || j === -1) return;
      const xml = s.slice(i, j + 5);
      if (segments.size >= MAX_SEGMENTS) {
        const oldest = segments.keys().next().value;
        if (oldest !== undefined) segments.delete(oldest);
      }
      segments.set(url, xml);
      post(url, xml);
    } catch {
      /* ignore malformed segments */
    }
  }

  // The content script (isolated world) attaches its listener after we may have
  // already seen the first segments; when it announces itself, replay them.
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window) return;
    const data = e.data as { __tv2subKind?: string } | null;
    if (!data || data.__tv2subKind !== "ttml-request") return;
    segments.forEach((xml, url) => post(url, xml));
  });

  // --- fetch ---------------------------------------------------------------
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (this: unknown, ...args: unknown[]): Promise<Response> {
      const promise = origFetch.apply(this, args as Parameters<typeof fetch>);
      try {
        const req = args[0] as { url?: string } | string | undefined;
        const url = typeof req === "string" ? req : req?.url;
        if (isSubtitleUrl(url)) {
          promise
            .then((res) => res.clone().arrayBuffer().then((b) => forward(url, b)))
            .catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return promise;
    } as typeof window.fetch;
  }

  // --- XMLHttpRequest ------------------------------------------------------
  const XhrProto = XMLHttpRequest.prototype;
  const origOpen = XhrProto.open;
  const origSend = XhrProto.send;

  XhrProto.open = function (this: XMLHttpRequest, _method: string, url: string): void {
    (this as unknown as { __tv2url?: string }).__tv2url = url;
    // eslint-disable-next-line prefer-rest-params
    return origOpen.apply(this, arguments as unknown as Parameters<typeof origOpen>);
  } as typeof XhrProto.open;

  XhrProto.send = function (this: XMLHttpRequest): void {
    try {
      const url = (this as unknown as { __tv2url?: string }).__tv2url;
      if (isSubtitleUrl(url)) {
        this.addEventListener("load", () => {
          try {
            const r = this.response;
            if (r instanceof ArrayBuffer) {
              forward(url, r);
            } else if (typeof this.responseText === "string" && this.responseText) {
              forward(url, new TextEncoder().encode(this.responseText).buffer);
            }
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line prefer-rest-params
    return origSend.apply(this, arguments as unknown as Parameters<typeof origSend>);
  } as typeof XhrProto.send;
})();
