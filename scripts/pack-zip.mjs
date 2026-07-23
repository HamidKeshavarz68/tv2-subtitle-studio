// Build a Chrome-Web-Store-ready zip of the extension.
//
// Usage: npm run zip → build/tv2-subtitle-studio.zip

import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertManifestCoversIncluded } from "./manifest-files.mjs";
const require = createRequire(import.meta.url);
const { ZipArchive } = require("archiver");

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const buildDir = resolve(root, "build");
const zipPath = resolve(buildDir, "tv2-subtitle-studio.zip");

const filesToInclude = [
  "manifest.json",
  "dist/content/net-hook.js",
  "dist/content/index.js",
  "dist/background/index.js",
  "src/styles/overlay.css",
  "public/icons/icon-16.png",
  "public/icons/icon-32.png",
  "public/icons/icon-48.png",
  "public/icons/icon-128.png",
];

// Catch manifest <-> package drift before producing a zip the Web Store
// will reject with "Invalid package".
assertManifestCoversIncluded(filesToInclude);

for (const rel of filesToInclude) {
  if (!existsSync(resolve(root, rel))) {
    console.error(`Missing required file: ${rel}\n→ Did you forget to run 'npm run build'?`);
    process.exit(1);
  }
}

mkdirSync(buildDir, { recursive: true });
await new Promise((resolvePromise, reject) => {
  const out = createWriteStream(zipPath);
  const zip = new ZipArchive({ zlib: { level: 9 } });
  out.on("close", resolvePromise);
  zip.on("error", reject);
  zip.pipe(out);
  for (const rel of filesToInclude) {
    zip.file(resolve(root, rel), { name: rel });
  }
  zip.finalize();
});

const sizeKB = (statSync(zipPath).size / 1024).toFixed(1);
console.log(`✓ ${zipPath} (${sizeKB} KB)`);

