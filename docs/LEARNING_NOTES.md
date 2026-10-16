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

## Phase 5: the adaptive brain

**What it does.** The home page quietly learns what a visitor seems interested in (which cards they open, how long they read, what they ask) and uses it to order the projects further down, pick a headline, and occasionally suggest one thing to read next. All of it runs in the browser and is saved only in the browser.

**Vectors and cosine.** Every card has a vector: either a 384-number text embedding (similar texts point in similar directions) or, as a fallback, its five interest weights (ML, DL, software, data, research). Cosine similarity measures the angle between two vectors: 1 means the same direction, 0 means unrelated. Because the two kinds of vectors have different typical cosines, the brain rescales: "how much closer than two random cards are to each other".

**EMA: a memory that fades.** The visitor's interest is one vector, the profile. Each signal nudges it toward the card involved: `profile ← normalize((1 − w)·profile + w·card)`, with `w = α × strength`. That is an exponential moving average: recent behaviour counts most and old behaviour fades smoothly, with no list of past events to store. α = 0.3 was chosen by simulating visitors: smaller values follow a change of interest too slowly (20 signals at 0.1), larger ones start chasing stray clicks.

**Thompson sampling with Beta.** For each card, the brain keeps a belief about "how likely this visitor engages when it is shown", as a Beta(a, b) distribution: a counts successes, b failures, and the prior comes from similarity. Instead of always picking the highest average, it draws a random sample from each Beta and blends it with similarity. Cards it is unsure about sometimes win the draw, so it keeps learning (exploration), but a clearly better card wins almost always. Beta samples are made from two Gamma samples (X/(X+Y)), and Gamma samples use the Marsaglia–Tsang method.

**The stability rule.** Nothing on screen, or above it, ever moves, hides or resizes. Only cards whose top is below the bottom of the screen are reordered; suggestions go into space that is always reserved; the headline only changes while it is scrolled away. A recommender that shuffles the page while someone reads is worse than none.

**Pacing: a small state machine.** Suggestions are rationed. *Active*: may suggest (budget 2, max 3). Showing one costs 1 and starts a *Cooldown* of 45 s of active time (idle time never counts). Ignored doubles the cooldown, dismissed triples it and mutes that topic. Accepted refunds 1. Two misses in a row, or an empty budget, means *Quiet* for the session; it is left only once, and only if the visitor's recent reading points clearly elsewhere and something fits that new interest well. Suggestions also wait for a natural pause: after finishing a card, at the end of a section, after a demo or an "Ask" answer; never while scrolling, typing, reading or away.

**Explaining itself.** Every decision is logged with a plain-English reason ("Moved OpsPilot up because you spent 40 s on systems content."). The "Brain" panel shows the interest radar, the last three decisions, the suggestion state, and a button that wipes everything.

**Testing behaviour, not just code.** Because time and randomness are injected, tests run whole simulated visits in milliseconds: someone who ignores every suggestion sees at most two; a reader who never scrolls is never interrupted; an idle visitor gets nothing; an engaged visitor gets on-topic suggestions but never more than six; and someone who changes interests mid-visit gets exactly one new suggestion after the site went quiet.
