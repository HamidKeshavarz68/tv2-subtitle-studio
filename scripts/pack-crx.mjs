// Build a .crx package of the extension.
//
// Usage: npm run crx
//
// On first run, also generates .crx-key/key.pem (a 2048-bit RSA private key) —
// KEEP IT SAFE. Reusing the same key on every build keeps the extension's ID
// stable, which is required for Chrome to recognise updates.
//
// The key lives in a dot-prefixed directory (NOT under build/) so that Chrome's
// "Load unpacked" — which recursively scans the project folder — never sees it.
// Chrome ignores files/folders whose names start with ".", and warns if a
// private key file is found inside a loaded extension.

import { mkdirSync, rmSync, copyFileSync, statSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crx3 from "crx3";
import { assertManifestCoversIncluded } from "./manifest-files.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const buildDir = resolve(root, "build");
const stagingDir = resolve(buildDir, "staging");
const keyPath = resolve(root, ".crx-key", "key.pem");
const crxPath = resolve(buildDir, "tv2-subtitle-studio.crx");

// Files referenced (directly or indirectly) by manifest.json. Anything listed
// here will be copied into the staging directory, preserving relative paths.
// crx3 will then zip up everything inside staging/ as the extension package.
const filesToInclude = [
  "manifest.json",
  "dist/content/index.js",
  "dist/background/index.js",
  "src/styles/overlay.css",
  "public/icons/icon-16.png",
  "public/icons/icon-32.png",
  "public/icons/icon-48.png",
  "public/icons/icon-128.png",
];

// 1) Verify the build artefacts exist.
assertManifestCoversIncluded(filesToInclude);
for (const rel of filesToInclude) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    console.error(`Missing required file: ${rel}\n→ Did you forget to run 'npm run build'?`);
    process.exit(1);
  }
}

// 2) Stage them under build/staging/ with the same relative paths as the
//    manifest's references — so manifest.json keeps working inside the CRX.
rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
for (const rel of filesToInclude) {
  const src = resolve(root, rel);
  const dst = resolve(stagingDir, rel);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

// 3) Pack.
mkdirSync(buildDir, { recursive: true });
mkdirSync(dirname(keyPath), { recursive: true });
await crx3([stagingDir], { keyPath, crxPath });

// 4) Clean up the staging dir; keep the .crx and the key.
rmSync(stagingDir, { recursive: true, force: true });

const sizeKB = (statSync(crxPath).size / 1024).toFixed(1);
console.log(`✓ ${crxPath} (${sizeKB} KB)`);
console.log(`  Signing key: ${keyPath}`);
console.log("  Reuse this key for every future build to keep the same extension ID.");

