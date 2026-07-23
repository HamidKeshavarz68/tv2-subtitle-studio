// Walk manifest.json and return every relative file path it references.
//
// Used by pack-zip.mjs / pack-crx.mjs to make sure the manifest and the
// hand-maintained `filesToInclude` list never drift apart — uploading a zip
// where manifest.json points at a file that wasn't packaged makes the
// Chrome Web Store reject the upload as "Invalid package".

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

/** @returns {{ root: string, manifestRefs: string[] }} */
export function readManifestRefs() {
  const manifestPath = resolve(root, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const refs = new Set();

  // icons: { "16": "...", ... }
  for (const v of Object.values(manifest.icons ?? {})) {
    if (typeof v === "string") refs.add(v);
  }

  // background.service_worker
  if (typeof manifest.background?.service_worker === "string") {
    refs.add(manifest.background.service_worker);
  }

  // content_scripts[].js / .css
  for (const cs of manifest.content_scripts ?? []) {
    for (const f of cs.js ?? []) refs.add(f);
    for (const f of cs.css ?? []) refs.add(f);
  }

  // web_accessible_resources[].resources (MV3 form)
  for (const w of manifest.web_accessible_resources ?? []) {
    for (const f of w.resources ?? []) refs.add(f);
  }

  // action.default_icon, action.default_popup
  if (typeof manifest.action?.default_popup === "string") refs.add(manifest.action.default_popup);
  for (const v of Object.values(manifest.action?.default_icon ?? {})) {
    if (typeof v === "string") refs.add(v);
  }

  // options_ui.page / options_page
  if (typeof manifest.options_ui?.page === "string") refs.add(manifest.options_ui.page);
  if (typeof manifest.options_page === "string") refs.add(manifest.options_page);

  // Drop wildcard entries (e.g. "assets/*") — those need a different strategy
  // and we currently don't use them.
  return { root, manifestRefs: [...refs].filter((r) => !r.includes("*")) };
}

/**
 * Throws (via process.exit) if any path the manifest references is missing
 * from `filesToInclude`. Always include "manifest.json" itself implicitly.
 */
export function assertManifestCoversIncluded(filesToInclude) {
  const { manifestRefs } = readManifestRefs();
  const included = new Set(filesToInclude);
  const missing = manifestRefs.filter((r) => !included.has(r));
  if (missing.length > 0) {
    console.error(
      "manifest.json references files that are NOT included in the package:\n" +
        missing.map((m) => `  - ${m}`).join("\n") +
        "\n→ Add them to filesToInclude (or fix the manifest path).",
    );
    process.exit(1);
  }
}

