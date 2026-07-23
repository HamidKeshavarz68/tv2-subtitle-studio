// Bundle the extension's TypeScript entry points into the single IIFE files the
// MV3 manifest loads. Type-checking is handled separately by `tsc --noEmit`.
//
// Usage:
//   node scripts/build.mjs           one-off build → dist/
//   node scripts/build.mjs --watch   rebuild on change

import { build, context } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: {
    "content/index": resolve(root, "src/content/index.ts"),
    "background/index": resolve(root, "src/background/index.ts"),
  },
  outdir: resolve(root, "dist"),
  bundle: true,
  format: "iife", // content scripts / MV3 service worker run as classic scripts
  target: "es2020",
  legalComments: "none",
  logLevel: "info",
};

const watch = process.argv.includes("--watch");

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("esbuild: watching for changes…");
} else {
  await build(options);
}
