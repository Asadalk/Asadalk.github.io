# semantic-hire data (in-browser matcher)

Unchanged copies from [Asadalk/semantic-hire](https://github.com/Asadalk/semantic-hire) at commit `50d4049470220f642478887f85a795b55476fed3` (2026-09-23):

| File | Repo path | Use here |
|---|---|---|
| `jobs.json` | `data/jobs.json` | The 24 synthetic job descriptions the matcher ranks. `npm run embed` embeds them into `src/content/generated/jobs.json`. |
| `queries.json` | `evaluation/queries.json` | The 8 hand-labelled evaluation queries. One feeds the "Try an example resume" button; all 8 drive the parity test (`tests/parity/semantic-hire/`). |

The jobs and queries were written by the owner as a small demonstration benchmark, not real postings.
