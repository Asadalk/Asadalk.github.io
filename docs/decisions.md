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

## 2026-10-16 · Phase 5: the adaptive brain

- **Pure TypeScript core, one DOM file.** `src/brain/*` has no DOM, no timers and no `Math.random`; time, randomness, storage and vectors are injected, so whole visits are simulated in unit tests. `src/brain/dom.ts` is the only adapter, with one 1-second interval as its only timer.
- **Embeddings are optional.** `dom.ts` loads `src/content/generated/embeddings.json` through `import.meta.glob`, so the build does not break while the file is missing. Embeddings are used only when every item has one of the same size; otherwise every item falls back to its 5 axes. A stored profile of the wrong size is dropped (silent cold start).
- **α = 0.3** (top of the allowed 0.15–0.3). Simulated visitors over synthetic 384-d topic clusters (`tests/unit/brain/tuning.test.ts`), each signal's weight is `α × strength` (expand 1, demo 1.5, ask 1, dwell 0.6 × log-gain, signboard 0.5):

  | α | best-next-item on topic (30% off-topic clicks) | same, 50% off-topic | signals to follow a change |
  |---|---|---|---|
  | 0.10 | 0.91 | 0.73 | 20 |
  | 0.20 | 0.97 | 0.84 | 9 |
  | 0.25 | 0.98 | 0.88 | 7 |
  | **0.30** | **0.99** | **0.90** | **5** |
  | 0.40 | 0.98 | 0.87 | 3 |
  | 0.50 | 0.94 | 0.80 | 2 |

  Accuracy peaks at 0.3 and falls beyond it as the profile starts chasing stray clicks.
- **Drift is measured against recent interest, threshold 0.5 (not the spec's 0.25).** Comparing the profile now with the profile at the last suggestion could not tell noise from a real change: a steady visitor's profile wanders as far (95th percentile 0.34) as a switcher's does after 6 signals (5th percentile 0.21). Instead, drift is the cosine distance between the profile at the last suggestion and the strength-weighted direction of everything engaged with since, measured once at least 6 signals exist. With threshold 0.5: 0% of steady visitors (≈13% stray clicks, worst moment over 16 steps) trip it, and 93% of real switchers do within 8 signals. At 0.25, 30% of steady visitors would trip it.
- **Quiet can be left once per session**, then the budget is 1. This keeps "the ignorer sees at most 2" true even for a visitor whose interest wanders, and "exactly one new suggestion after Quiet" for a real change.
- **Similarity is calibrated per vector space**: `sim = clamp((cos − μ)/(1 − μ), 0, 1)`, μ = mean cosine between two items. Raw cosines of the 5 non-negative axes sit around 0.6–0.95 and of text embeddings around 0–0.6, so one threshold could not serve both.
- **Confidence gate: sim ≥ 0.45 and at least 0.2 above the average on-screen alternative.** The card the visitor just finished is not an alternative (it is engaged), otherwise the gate would always compare against a perfect match. With the real content and no embeddings, finishing Cellular earns "OpsPilot" (sim 0.52); weaker matches stay silent.
- **Thompson sampling**: Beta prior `a = 1 + 4·sim`, `b = 1 + 4·(1 − sim)`, updated by shows and engagements; blend `0.7·sim + 0.3·sample`. Seen-and-ignored items decay ×0.85 per show (max 3), engaged items go to the bottom, a dismissed topic is ×0.5 for the session. At cold start the curated order is used with no sampling. 100 seeded runs: each opener chip puts the right project first ≥ 90% of the time.
- **Stability rule in practice.** Only project cards whose top is below the bottom of the screen are reordered (never one holding focus); FLIP settle 300 ms ease-out, none under reduced motion. The headline changes at most once per session and only while the hero is off screen, with a viewport anchor check. Suggestions appear in a reserved slot at the end of Research and Projects (the space always exists), so showing or dismissing one moves nothing. The opener line freezes its height before swapping to its "Noted" line, and is revealed by an inline script during parsing (no shift, and no-JS visitors never see it).
- **"Deep readers get result tables expanded"** is implemented as: once per session, after ≥ 2 cards read ≥ 20 s (or 90 s total), the next unopened project below the fold is opened, since the result tables live inside the cards.
- **The mini-bar's fourth item is a link to `/privacy/`** that JavaScript upgrades to open the panel. Without JS, and on other pages, it still works. "Résumé view" became "Résumé" so four items fit on one line at 390 px.
- **Dwell counts only for open cards** that are ≥ 50% visible (or fill ≥ 50% of the screen, for tall cards), with the tab visible and the visitor not idle.
- **Session vs long-term storage.** The visitor model and decision log live in `localStorage` (`brain:v1`); pacing state and once-per-session flags in `sessionStorage` (`brain:v1:session`). Any storage error means a silent cold start. Reset clears both plus the opener flag.
- **Test hook `?brain-test=1`** divides every timer by 10, seeds the random numbers and exposes `window.__brain` for Playwright.
- **No new dependencies.**
