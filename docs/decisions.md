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

## 2026-10-16 · Phase 6

- **Demos load only when opened.** Each demo sits in a `<details>` whose body is complete static HTML (the default run's every step, the full policy table, every hop for one sample cell with its pin). Opening it imports the demo's code and data for the first time; the same render functions (`src/lib/*-view.ts`) produce both versions, so they can't drift. Each demo reports `open`, `used` (once per opening) and `close` as `window` `demo` events with `{ id, item, action }`, where `item` is the content id for the brain.
- **The replay is derived, never written.** `src/lib/trace.ts` builds the steps from the exported rows, and every step lists the `agent_events` / `audit_events` / `agent_tool_calls` ids it came from. Unit tests check that every id exists, that every event is used exactly once, that all quoted text appears in the trace, and that steps are in time order. The trace files are unchanged.
- **Steps follow the clock, not the spec's list.** Retrieval happens before the first tool call in all three runs, so it is shown second.
- **The diagnosis is shown as it was at pause time.** The `runs` row's `diagnosis` is rewritten when the run closes (it gains "Human approval granted; …"), which would put the approval outcome on a step 0.1 s before it happened. The replay quotes the copy on the `run.paused` event (or `run.completed` when the run never paused).
- **The self-approval 403 has no timestamp.** It is a captured HTTP response, not an event row, so the step says "no timestamp" and points at `apiResponses.selfApprovalAttempt` instead of inventing a time.
- **Incident status is only shown for the happy path.** The other two files carry the OpsBench world definition (the live row was reset), whose status is the starting state, not the outcome.
- **Retrieval scores are labelled "hybrid score".** In hybrid mode OpsPilot stores `0.45 × rescaled cosine + 0.55 × keyword score` in the `similarity` field (`app/rag/repository.py`).
- **Policy port.** `src/lib/policy.ts` copies `RISK_BY_ACTION`, `POLICY_RULES` and the customer overlay from `backend/app/policy/engine.py`, `backend/app/core/customer.py` and both `config/customers/*.toml`. Tests mirror `backend/tests/test_policy.py` and add a full role × action × environment matrix. The playground includes the customer overlays because they are shown faithfully: the target is fixed to `checkout-api`, which both example customers manage, so Acme's "approval for every production restart" and Globex's "GitHub disabled" rules are visible. Globex's "unmanaged service" rule is tested but not reachable in the UI.
- **Outcome colours always come with an icon and a word:** Neem + check for allow, Brick + cross for deny, Kohl dashed + hourglass for needs approval.
- **Architecture diagram** is the README mermaid flowchart redrawn as inline SVG, same nodes and edges. The write path (agent → policy → approval → simulator) is brick; the LLM provider box is dashed because it is an external API.
- **India outline: Natural Earth 1:10m, India point of view, simplified.** The 1:50m and 1:110m admin-0 files only exist in Natural Earth's default (de facto) point of view, which splits Jammu & Kashmir and Ladakh. The India-POV file (`ne_10m_admin_0_countries_ind`, v5.1.1, public domain, from naciscdn.org; zip sha256 `36a54ee9…102192`) shows India's official boundary. `scripts/build-india-outline.py` (standard library only) reads the shapefile, drops islands under 0.005 deg², simplifies with Douglas–Peucker at 0.035° (about 4 km, roughly 1:50m detail) and projects equirectangularly at 22° N. Output: `src/content/data/cellular/india.json`, 12 KB, committed.
- **Tower data.** `dataset/tower_sample.csv` (49 rows) is copied verbatim from the Cellular repo to `src/content/data/cellular/tower_sample.csv`; `scripts/build-towers.mjs` converts it to `towers.json` before every build. Attribution under the demo and in the README: "Tower data: OpenCellID, CC BY-SA 4.0, via a Kaggle sample".
- **The 1 km circle gets an inset.** On a phone-width map of India 1 km is about 0.1 px, so the pin sits on the outline and a 5 km inset draws the fixed 1,000 m radius to scale, with a scale bar.
- **Sample cells** are six rows of the CSV (one is the test cell commented out in `MainActivity.kt`) plus Delhi's cell with CID + 1, which is not in the sample, to show that the lookup is exact.
- **SmokeTrail** keeps its "in progress" badge and has no demo.

## 2026-10-16 · Phase 4

- **One embedding model, two features.** "Ask about me" and the semantic-hire matcher share one Web Worker running `Xenova/all-MiniLM-L6-v2` with `@huggingface/transformers` 4.3.0 (4.3.1 was only 10 days old). The library is loaded with a dynamic import inside the worker, so it never touches first-load JS.
- **Everything is self-hosted.** Model and tokenizer files live in `public/models/all-MiniLM-L6-v2/` (pinned Hugging Face revision, SHA-256 checked by `scripts/download-model.mjs`). The onnxruntime-web WASM is copied to `public/ort-embed/` by `scripts/copy-ort-embed.mjs` before `dev` and `build`; `public/ort/` stays with the YOLO demo. transformers.js pins its own onnxruntime-web (1.31.0-dev.20260914), and the copy script uses exactly that version. Remote models are switched off at runtime, and a small Vite plugin stops Vite from copying a second 27 MB WASM file into `_astro/`.
- **The browser runs the fp16 weights (45 MB), not the 8-bit ones (23 MB).** The 8-bit model reordered 2 of the 8 semantic-hire evaluation queries; fp16 reorders none (`tests/parity/semantic-hire/REPORT.md`). Stored vectors (content and jobs) are computed at build time with the full fp32 weights, which are git-ignored and never deployed.
- **The model never loads before first paint.** It starts on the first focus or tap in the search box or the matcher, or 5 s after the page has loaded and gone idle, unless the browser asks to save data or reports a 2G connection. That idle preload means most visitors download about 49 MB (gzip) once. It is in the spec, but it is the biggest cost on the page and the first thing to revisit if mobile data use matters more than instant answers.
- **Text recipe for each content item** (`src/lib/search.ts`, `buildDocs`): research and projects use "title. summary Tags: tags."; experience uses "role, org." plus the research title when it points to it; education uses "degree, institution." plus coursework; achievements use their text; skill groups use "Skills: group. skill, skill, …"; archive repos use "name. line context." 22 items in total. `npm run embed` writes `src/content/generated/embeddings.json` (`{ model, dim: 384, items: [{ id, type, title, vector }] }`, 5 decimals) for search and the Phase 5 recommender, and `src/content/generated/jobs.json` (the 24 jobs with the repo's `_job_text` recipe). A unit test fails if content items change without re-running it.
- **"Ask about me" sits just before Research.** It is one input and one muted line, which doubles as the polite live region. Up to 5 results with a score of at least 0.2 are shown; each gets an honest one-line reason, either the question's words it contains or "close in meaning". Matches on the page get a thin chartreuse bar drawn with `box-shadow`, so nothing moves. Each search fires a `window` `ask` event with `{ query, vector, results }` for Phase 5.
- **The matcher is a line-for-line port of semantic-hire's ranking** (`src/lib/matcher.ts`), including its quirks: a skill directly followed by a full stop is not matched, inputs are cut at 256 word pieces, and ties are broken on 4-decimal scores. No Gemini and no network. "Try an example resume" cycles through the repo's 8 evaluation queries.
- **Parity is tested three ways:** the repo's real Python `/match` handler, the TypeScript port in Node, and the real page in Chrome (an e2e test that walks all 8 queries). All agree on every top-5 order.
- **The e2e preview port is configurable** (`PW_PORT`), so several checkouts can test side by side.

- **The embedding model loads only when someone uses the search box or the matcher**, not after 5 s of idle time as the spec suggested. The fp16 model plus runtime is about 49 MB gzipped, too much to push onto every mobile visitor who never searches. (Changed during the Phase 4 merge.)
