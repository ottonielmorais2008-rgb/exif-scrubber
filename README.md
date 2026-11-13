# EXIF Scrubber

[![CI](https://github.com/ottonielmorais2008-rgb/exif-scrubber/actions/workflows/ci.yml/badge.svg)](https://github.com/ottonielmorais2008-rgb/exif-scrubber/actions/workflows/ci.yml)

Inspect JPEG and PNG metadata in the browser, then download a clean copy with the hidden tags removed. Nothing is uploaded.

**Live demo:** [https://ottonielmorais2008-rgb.github.io/exif-scrubber/](https://ottonielmorais2008-rgb.github.io/exif-scrubber/)

## What it does

Photos often carry more than pixels: camera make and model, the date they were taken, the software that wrote the file, and sometimes a precise GPS location. This tool:

1. Opens a JPEG or PNG in the current tab (drag and drop, file picker, or a built-in sample so you do not need to use a personal photo).
2. Groups the metadata it finds (GPS, camera, date/time, software, comments, IPTC, XMP, and PNG text).
3. Strips those metadata segments and chunks, then re-parses the cleaned bytes to confirm that **0 metadata tags remain**.
4. Shows the file size before and after, and offers a download of the clean copy.

Supported formats: **JPEG and PNG**. WebP, HEIC and RAW files are not supported.

## Privacy and security

- The page is a static site with **no backend**. Files are read into memory and never sent to a server.
- A strict Content Security Policy includes `connect-src 'none'`, so the page cannot make network requests (including map APIs).
- GPS coordinates, when present, are shown as **plain text and degrees only**. They are never sent to an external map service.
- Stripping is **lossless byte-level editing**: JPEG APP1 (EXIF and XMP), APP13 (IPTC/Photoshop), COM comments, and optionally APP2 ICC profiles are removed; PNG `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`, and optionally `iCCP` are removed. Required image structure (JPEG SOI/SOF/SOS/EOI; PNG signature, IHDR, IDAT, IEND) is left intact.
- Pixel data is copied, not re-encoded. There is no canvas redraw, so JPEG quality is not reduced by a second compression pass.
- An optional checkbox keeps the ICC color profile if you need it for color accuracy.

## Honest limitations

- Only JPEG and PNG are supported.
- `zTXt` and compressed `iTXt` chunks are detected and stripped, but their compressed text is not inflated in the inspector; they are listed as compressed.
- Unknown ancillary PNG chunks that are not on a short allow-list are also removed, which is the safer default for privacy.
- Malformed files that are missing required markers or chunks are rejected rather than “repaired” by re-encoding.
- Very large files are limited to 40 MiB because they are held in memory.

## Run locally

Use this only on your own machine. The public demo is the GitHub Pages link above, not a localhost URL.

```bash
npm ci
npm test
npm run dev
```

Then open the local Vite URL shown in the terminal. `npm run typecheck` and `npm run build` are also available.

## Tests and CI

GitHub Actions runs typecheck, Vitest, and the Vite production build on every pull request and push, and deploys `dist/` to GitHub Pages from `main`.

The tests build synthetic JPEG (APP1 EXIF with a GPS IFD, Make/Model, DateTime, COM, APP13 IPTC, and XMP) and PNG (`eXIf`, `tEXt`, `iTXt`, `tIME`) files, check that the parser reads the fields, that the stripper removes the metadata, that the cleaned file is still a valid JPEG or PNG, and that re-parsing the cleaned buffer finds zero tags. Files that already have no metadata are left valid and clean.

## What went wrong

- The first XMP reader treated the APP1 payload as a single C string, so it stopped at the NUL after `http://ns.adobe.com/xap/1.0/` and never saw the XML packet. The inspector now decodes the bytes after that header.
- TypeScript 5.9 types `Uint8Array` more strictly against `ArrayBuffer`. Slices used for JPEG scan data and for `Blob` downloads had to be copied into a fresh `Uint8Array` before the project would typecheck.

## License

MIT.
