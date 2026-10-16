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
