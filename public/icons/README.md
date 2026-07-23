# Icons

`icon.svg` is the source artwork. Chrome's manifest `icons` field does **not**
accept SVG — uploading an SVG-only extension to the Chrome Web Store fails
with `Could not decode image: 'icon.svg'`. We therefore ship PNGs at the
standard sizes, and `manifest.json` references those PNGs.

The PNGs (`icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`) are
generated automatically from `icon.svg` by:

```powershell
npm run icons
```

This step is also wired into `npm run build`, so normal build / package
runs keep the PNGs in sync with the SVG.

