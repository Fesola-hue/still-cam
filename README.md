# Still

A tiny mobile-first memory toy, built with HTML, CSS and vanilla JavaScript.
Serve this directory with any static HTTP server. No build, dependencies,
account, backend, or external API is required.

## GitHub

Extract the ZIP and upload its contents to the root of your GitHub repository.
Keep `index.html` at the repository root, alongside the other source files.
The package includes the app, original icons, and repeatable browser tests;
generated test images and local ZIP files are excluded.

For GitHub Pages, publish the repository's main branch from its root directory.
There is no build command. All assets and the PWA manifest use relative paths,
so the app also works beneath a repository URL such as
`https://your-name.github.io/still/`.

Grain uses deterministic monochrome texture at two fine scales, so it remains
visible when the high-resolution PNG is displayed as a small phone preview.
Zero grain leaves the original texture untouched.

## Architecture

- `index.html`: Photos → Make it yours → Developing → Result.
- `script.js`: original uploads, shared non-destructive edit state, controls,
  screen transitions, the existing pink-camera ritual, and PNG download.
- `renderer.js`: one deterministic Canvas composition pipeline. Each photo
  window is drawn from its original image, then receives the shared edits.
  Neutral edits bypass processing. A bounded per-image cache avoids repeating
  photo processing when only the caption or paper style changes.
- `styles.css`: mobile controls and the preserved camera/print animation.
- `service-worker.js`, `manifest.webmanifest`, `assets/`: offline shell and
  existing app icons. The cache version includes the new renderer.

The same full-resolution Canvas moves between the live preview, developing
camera, and result. Save encodes that Canvas directly as a PNG. Paper, tape,
ink, captions, shadows, lines and clips are included in the exported pixels.
Photos use the existing center crop with a small portrait bias; their original
color and texture remain unchanged until an adjustment is selected.

Single, Stack (Duo, Pile, Scatter with two or three photos), Strip (three or
four photos), and Hanging (two or three photos) all support Classic,
Scrapbook, and Messy. Captions wrap, including long unbroken words.

## Verification

On Windows with Node 24+ and Microsoft Edge installed:

```sh
node tests/verify.mjs
```

This starts a temporary local server and headless Edge. It exercises all 27
compositions, adjustment pixels, reset and repeatability, live slider events,
caption wrapping, native single/batch upload, missing-photo gating, animation
and reduced motion, Edit/Try another, downloaded PNG equality, PWA caching,
and horizontal overflow at 320/360/390/430px. No test code ships in the app.

Results and screenshots are in `tests/artifacts/`, including
`composition-matrix.png` and `checks.json`.

Verified in desktop Chromium with mobile viewport emulation. Physical iOS
Safari and Android installation/download behavior have not been device-tested.

The mobile refinement adds collapsed optional edits, 44px minimum control
targets, a larger slider thumb, safe-area padding on all four edges, and print
sizing that follows viewport changes. Caption entry uses a Done key and keeps
the action in normal flow while focused. The mobile checks also cover compact
375×667, reduced-height 390×664 and 430×739, 393×852, and 844×390 landscape
viewports, with edits both open and closed.
