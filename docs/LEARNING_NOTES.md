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

## Phase 6: demos that run on your device

**Replaying a real incident.** OpsPilot writes two append-only logs while it works: `agent_events` (what the agent did: each model decision, each tool call, with timings and token counts) and `audit_events` (who did what: logins, proposals, policy decisions, approvals). Three real runs were exported from the database. The replay doesn't tell a story on top of them; `src/lib/trace.ts` walks the rows in order and groups them into steps, for example "model decides to call `search_logs`" + "the tool ran" + "the audit row for it" become one tool-call step. Each step prints the ids of its rows, and a "raw" toggle shows the rows themselves. Tests fail if a step points at a row that doesn't exist, if any row is left out, or if any quoted sentence isn't in the trace.

One trap found while building it: the run's final `diagnosis` field is updated when the run ends, so showing it at the diagnosis step would leak the future ("approval granted") into the past. The replay uses the copy saved at pause time.

**The policy matrix.** OpsPilot never lets the model decide what is safe. The server looks up the action's risk in a fixed table (restart = HIGH, delete data = CRITICAL, …), then looks up (role, risk) in a second table that gives one answer for production and one for everything else. That's the whole engine: two dictionary lookups, plus optional customer rules that can only make an answer stricter. The playground runs a line-for-line TypeScript copy, and the tests are copies of the Python tests, plus a check of all 3 roles × 7 actions × 2 environments. Because risk comes from the table, a model that claims "this restart is LOW risk" changes nothing; there is a test for that too.

**Exact-match lookup, and why no triangulation.** A phone knows the identity of the cell it's registered to: country (MCC), operator (MNC), area (TAC) and cell (CID). The backend looks up that exact combination in a table of known towers. If one value differs, it's a different cell, so the answer is "tower_not_found" rather than the nearest guess. The app then draws the tower's position with a fixed 1 km circle. It doesn't triangulate, because that would need signal measurements from several towers at once and a propagation model, and it would suggest a precision the data can't support. The 1 km circle is an honest "somewhere around this tower", not a measured accuracy. The demo runs the same lookup over the repo's 49-row sample, in the browser.

**A map without map tiles.** Loading OpenStreetMap tiles would send visitors' requests to a third party. Instead, a small script turns Natural Earth's public-domain country shapes into one SVG path (12 KB): read the shapefile, keep India, simplify the outline (Douglas–Peucker drops points that move the line less than about 4 km), and project longitude/latitude onto x/y. Placing the pin uses the same projection formula.

**Lazy loading.** The page ships only a few hundred bytes per demo up front. Opening a demo runs `import()`, which fetches its code and data then. Without JavaScript, the static version inside each `<details>` is still complete.
