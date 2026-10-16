# Learning notes

Plain-language explanations of each piece of the site, so every part can be defended in an interview. Updated every phase.

## Phase 1: the foundation

**Why a static site?** Astro renders every page to plain HTML at build time. A recruiter on a slow phone gets readable content immediately, and the site keeps working if JavaScript fails or is turned off. Interactive parts (demos, the recommender) will be added later as small "islands" that load only where they are needed.

**Why content in JSON?** The pages never contain facts directly; they read `src/content/*.json`. That separates *what is true* from *how it looks*. It also makes the hard rules testable: a unit test reads every content file and fails if it finds a phone number, a CGPA, a placement mention or a leftover TODO.

**Expandable cards without JavaScript.** Each card is a native HTML `<details>` element. The browser handles opening and closing, keyboard access and screen-reader state for free. Later phases add behaviour on top, but the basic page never depends on it.

**Colour and contrast.** WCAG AA requires 4.5:1 contrast for body text. The checks turned up two failures in the original palette:

- Brick links on Plaster cards were only 4.15:1, so links use a slightly deeper brick (`#963B24`, 5.07:1).
- The chartreuse focus ring was nearly invisible on the light background (1.13:1), so every focus ring has a dark Kohl edge around it.

**Fonts.** Fonts are self-hosted from npm packages, and only the needed character sets (Latin, plus Devanagari for the Hindi signboards) are loaded. No request goes to Google, which keeps the "no third parties" privacy promise.

**Theme.** The site follows the system light/dark setting. A footer button cycles system → light → dark and remembers the choice in `localStorage`. A tiny script in `<head>` applies the saved choice before first paint, so the page never flashes the wrong theme. Storage access sits inside `try/catch`, because private browsing can make it throw.

**CI.** Every push runs the unit tests, the type checker and the build. The built HTML is then scanned for anything shaped like an Indian mobile number. Only `main` deploys.

## Phase 2: the street

**Generated, not drawn by hand.** The scene is computed by `src/lib/street.ts` at build time. Window positions, skyline heights and which windows are lit come from a small seeded random number generator, so every build produces the identical picture. Unit tests check the geometry: every detection box contains its board, and no box or label overlaps another or leaves the frame.

**Detection boxes that draw themselves.** Each box is an SVG rectangle whose outline is one long dash. The dash starts fully offset (invisible) and a CSS animation slides the offset to zero, so the line appears to be drawn. The offset equals the rectangle's perimeter, computed in the same code that places the box. Under `prefers-reduced-motion` the boxes simply appear.

**Tilted board, upright box.** A YOLO-style detector outputs axis-aligned boxes. For a board rotated by θ, the upright box needs width `w·cosθ + h·sinθ` and height `w·sinθ + h·cosθ`, which is what `rotatedBounds` computes.

**Lock-on without breaking links.** The signboards are ordinary `<a href="#research">` links. JavaScript intercepts the click, thickens the chosen box and dims the rest for about a quarter of a second, then smooth-scrolls to the section and moves keyboard focus there. If JS is off, the plain link behaviour takes over; under reduced motion the jump is instant.

**Parallax.** The far skyline moves at 14% of scroll speed and the wires at 5%, applied with `transform` inside `requestAnimationFrame`. Transforms don't trigger layout, so there is no layout shift (CLS). The effect only runs while the hero is visible.

## Phase 3: running the detector in the browser

**From PyTorch to the browser.** The fine-tuned YOLO11n is exported to ONNX, a portable model format. In the browser, onnxruntime-web runs it inside a Web Worker, a background thread, so the page stays responsive. It uses the GPU through WebGPU when available, and the CPU through WebAssembly otherwise.

**What the model actually outputs.** One tensor of shape `[1, 5, 33600]`. For each of 33,600 candidate positions (from three grids with cell sizes 8, 16 and 32 pixels over a 1280 × 1280 input) it gives a box centre, width, height and a "text" score. Turning that into boxes means:
1. keep candidates scoring above 0.25;
2. greedy non-maximum suppression: take the best box, drop any other box overlapping it with IoU above 0.7, repeat;
3. undo the letterbox to get back to photo pixels.

**Letterboxing.** The photo is scaled so its long side is 1280 pixels, then padded to a square with grey (114). The scaling must be done exactly as in training. That is the lesson from the research too: a model is only as good as the match between its training and inference preprocessing.

**The parity test, and the bug it caught.** The same nine photos go through Python and through the real web page, and every box must overlap its partner by IoU ≥ 0.95. The first run failed on four boxes. Ruling out causes one at a time:
- JPEG decoding was identical.
- The ONNX runtime was innocent: Python reproduced the failure when given the browser's input.
- The resize was the cause. OpenCV uses fixed-point arithmetic, so a mathematically "correct" bilinear resize lands one grey level away on about 10% of pixels. That was enough to push two boxes scoring 0.251–0.254 under the 0.25 threshold.

Porting OpenCV's integer arithmetic made the inputs identical, and the test passed.

**Why small text gets missed.** A 20-pixel word in a 3,200-pixel photo becomes 8 pixels at 1280: one cell of the finest grid. The explainer under the demo lets you change the numbers.
