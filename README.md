# asadalk.github.io

Personal portfolio of Asadullah Faisal (AI & Data Science, IIT Jodhpur). Live at <https://asadalk.github.io>.

Design decisions and plain-language notes on how everything works are in [docs/](docs/).

## Stack

- [Astro](https://astro.build) 7 with TypeScript, static output: every page is rendered at build time and works without JavaScript.
- Self-hosted fonts via `@fontsource` (Young Serif, Tiro Devanagari Hindi, Atkinson Hyperlegible, Martian Mono; all OFL-1.1).
- Vitest for unit tests. GitHub Actions builds, tests and deploys to GitHub Pages on every push to `main`.
- No analytics, cookies, trackers or third-party requests at runtime.

## Editing content

All text lives in `src/content/*.json`. Pages render only from these files.

| File | What it holds |
| --- | --- |
| `site.json` | Name, bio, about, education, experience, achievements, contact, headline variants |
| `research.json` | B.Tech research: contributions, results tables, lab credit |
| `projects.json` | Main projects, in the shape problem → built → results → demo → repo |
| `skills.json` | Skill groups; every skill lists the items (`proof`) that show it in use |
| `archive.json` | Smaller repos shown on `/archive` |
| `data/opspilot/` | Real exported OpsPilot run traces for the incident replay demo |
| `data/cellular/` | Tower sample (CSV + generated `towers.json`) and the India outline for "Follow the packet" |

Each item has an `axes` object (ML, DL, Software, Data, Research, each 0–1) that the on-device recommender will use to order the feed.

Rules enforced by `tests/unit/content.test.ts` and CI: no phone number, no CGPA or placement details, no leftover `TODO`, and every skill proof must resolve.

## Commands

```sh
npm ci           # install exact pinned versions
npm run dev      # local dev server at http://localhost:4321
npm test         # unit tests
npm run check    # type-check .astro and .ts files
npm run build    # static site in dist/
```

## Licenses

Site code: MIT. The research demo will run a YOLO model fine-tuned with Ultralytics, which is AGPL-3.0, so this repository stays public.

Data used by the demos:

- Tower data: OpenCellID, CC BY-SA 4.0, via a Kaggle sample (the 49-row `dataset/tower_sample.csv` from the Cellular repo).
- India outline: [Natural Earth](https://www.naturalearthdata.com/) 1:10m admin-0, India point of view, public domain; built by `scripts/build-india-outline.py`.
