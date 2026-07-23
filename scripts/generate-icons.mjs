// Rasterize public/icons/icon.svg into the PNG sizes Chrome's manifest needs.
//
// Chrome's "icons" field (and the Chrome Web Store) does NOT accept SVG —
// uploading an extension that points "icons" at an .svg fails with
// "Could not decode image: 'icon.svg'". So we ship PNGs instead.
//
// Usage:
//   node scripts/generate-icons.mjs
//
// Produces:
//   public/icons/icon-16.png
//   public/icons/icon-32.png
//   public/icons/icon-48.png
//   public/icons/icon-128.png

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const srcSvg = resolve(root, "public/icons/icon.svg");

const sizes = [16, 32, 48, 128];

const svgBuffer = await readFile(srcSvg);

await Promise.all(
  sizes.map(async (size) => {
    const out = resolve(root, `public/icons/icon-${size}.png`);
    // density scales the SVG's internal rendering resolution; pick one that
    // roughly matches the target size so text stays sharp at all sizes.
    const density = Math.max(72, Math.round((size / 128) * 384));
    await sharp(svgBuffer, { density })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(out);
    console.log(`✓ ${out}`);
  }),
);

