# Decisions

## 2026-10-16 · Phase 0 and owner answers

- **Research numbers come only from the owner's résumé (Oct 2026).** No other source is used for research figures. Where the public fork's README reports a differently defined comparison, the résumé's figure is the one shown.
- **Owner approved public research results and hosting the model.**
- **OpsPilot retrieval is described as lexical-vector, not semantic.** It uses 128-d hashed bag-of-words vectors (ADR-0002 in the repo).
- **Unflattering results stay**, for example OpsBench misleading-evidence 0/8 and the ensemble's 40.3% precision.
- **SmokeTrail is "in progress" with no numbers.** The hero haze will use a fixed value until real data exists.
- **Archive curated to 6 repos** with real owner work and code: NLU-Assignment-2, DL-PhaseII, Sports-Or-Politics, Socket_Programming, Project-CSL1010, Product-Recommendation-System (team credit stated). Hidden: PRML-Spring-2023 (no owner commits), Logistic-Regression (no code), Linear-Regression (course boilerplate, missing data), EPMFDS (mostly empty files).
- **Cellular demo video is self-hosted**, copied from the repo's README attachment, so no runtime request goes to GitHub. The README's terminal screenshot was left out because it shows a username, internal IPs and a real cell ID.
- **OpsPilot traces** were produced by running the real stack with Groq `openai/gpt-oss-120b` on 2026-10-16 (see `src/content/data/opspilot/README.md`).

## 2026-10-16 · Phase 1

- **Astro 7.3.5, not 7.4.0.** Every dependency is pinned exactly to a version published at least two weeks before the build. TypeScript is pinned to 5.9.3 because `@astrojs/check` does not support TS 7 yet.
- **vitest was added with `--legacy-peer-deps`** to work around an npm 10.9 arborist crash. The resulting lockfile installs cleanly with plain `npm ci`.
- **Two contrast fixes to the palette:** a link-only `--accent-ink` (#963B24, 5.07:1 on Plaster) and a Kohl edge on the chartreuse focus ring (the ring alone is 1.13:1 on Lime-wash).
- **The Phase 1 hero is text only.** The illustrated street (Phase 2) replaces it. The signboard labels already appear as a bilingual section nav.
- **The mini-bar has 3 of its 4 items.** The brain panel button arrives with the brain in Phase 5.
- **Bio and about text were written by Claude from the résumé and repos**, at the owner's request. Every claim in them maps to a content fact.

## 2026-10-16 · Phase 2

- **Two layouts of one street.** A five-shop street seen side-on would shrink the signboard text to about 6 px on a phone. Phones get one tall market building with the five boards stacked on its facade, a common sight on Indian streets. CSS shows whichever layout fits; only one is ever in the accessibility tree.
- **Signboards are SVG links with real text**, not images. They work as plain anchors without JavaScript. With JS, a tap "locks on": the chosen box thickens, the other signs dim, and the page scrolls smoothly to the section, then focus moves to its heading. The spec's zoom was tried first and dropped after the owner tested it on a phone and found it unpleasant.
- **A one-line caption under the street explains the boxes and numbers.** Without it, the owner read the scene as decoration with random numbers. The caption is deliberately small and muted so it doesn't clutter the hero.
- **The detection boxes are upright, even around the tilted Projects board**, the way a real axis-aligned detector would draw them. The confidence numbers are illustrative, and the caption says so.
- **The haze is a fixed level with an honest note under the scene.** It switches to real PM2.5 when SmokeTrail has data.
- **The "Scan a photo with my model" button waits for Phase 3**, when the demo exists. Until then the first hero button is "See the research".
- **Playwright e2e tests** (hero navigation, keyboard, reduced motion, no-JS, résumé) run in CI on a phone and a desktop profile.

## 2026-10-16 · Phase 3

- **Model:** the released `yolo11n-bstd-v1.0` weights (SHA-256 checked against the fork) exported to ONNX at a fixed 1280 × 1280 input, opset 17, fp32 (10.6 MB). fp16 would halve the download but needs its own parity run, so it waits.
- **Runtime:** onnxruntime-web 1.30.0 in a Web Worker. WebGPU when an adapter exists, otherwise single-threaded WebAssembly (GitHub Pages cannot send the COOP/COEP headers needed for threads). The runtime files are self-hosted in `/ort/`; nothing loads from a CDN.
- **Preprocessing is a bit-exact port of OpenCV**, not canvas `drawImage`. Canvas resizing antialiases, and even a plain float bilinear port was off by a grey level on ~10% of pixels, enough to flip borderline boxes. See `tests/parity/yolo/README.md`.
- **Parity reference is Ultralytics running the ONNX file**, not the `.pt`: `.pt` predictions use rectangular padding, ONNX uses the full square, and the browser runs the ONNX.
- **Test photos come from Wikimedia Commons** (CC BY / CC BY-SA). Only one (Paharganj Main Bazaar, CC BY 4.0) ships on the site, resized to 2400 px and credited under the demo.
- **Fallback:** without JavaScript, or if the model can't load, the demo shows the sample photo with boxes precomputed by Python from the same model.
- **A service worker caches models, the ONNX runtime and samples after first use.** It ignores every other request.
- **`[hidden]` now always wins over component display rules.** A no-JS e2e test caught the demo's buttons showing despite `hidden`.
- **Recognition (script ID + PARSeq) is not in the browser.** It needs the server planned for Phase 7.
