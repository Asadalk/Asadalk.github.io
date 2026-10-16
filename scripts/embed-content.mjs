// Build-time embeddings (npm run embed). Re-run after editing src/content.
//
// Writes, both committed:
//   src/content/generated/embeddings.json  every content item, for "Ask about me"
//                                          and the Phase 5 recommender
//   src/content/generated/jobs.json        semantic-hire's 24 jobs, for the matcher
//
// Uses the same self-hosted model and pooling code as the browser.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEmbedder } from './lib/embedder.mjs';
import { buildDocs } from '../src/lib/search.ts';
import { cleanText } from '../src/lib/matcher.ts';
import { DIM, roundVector } from '../src/lib/embed-math.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const content = join(root, 'src/content');
const outDir = join(content, 'generated');
const readJson = async (p) => JSON.parse(await readFile(join(content, p), 'utf8'));

const site = await readJson('site.json');
const research = await readJson('research.json');
const projects = await readJson('projects.json');
const { groups: skillGroups } = await readJson('skills.json');
const archive = (await readJson('archive.json')).items.filter((i) => i.show);
const jobs = await readJson('data/semantic-hire/jobs.json');

const { embed, dtype } = await loadEmbedder();
const MODEL = 'Xenova/all-MiniLM-L6-v2';

const docs = buildDocs({ site, research, projects, skillGroups, archive });
const docVectors = await embed(docs.map((d) => d.text));
const embeddings = {
  model: MODEL,
  dim: DIM,
  items: docs.map((d, i) => ({ id: d.id, type: d.type, title: d.title, vector: roundVector(docVectors[i]) })),
};

// semantic-hire app/retrieval.py _job_text: clean_text(f"{title}. {description}. Skills: {', '.join(skills)}")
const jobText = (j) => cleanText(`${j.title}. ${j.description}. Skills: ${j.skills.join(', ')}`);
const jobVectors = await embed(jobs.map(jobText));
const jobsOut = {
  model: MODEL,
  dtype,
  dim: DIM,
  source: 'github.com/Asadalk/semantic-hire data/jobs.json @ 50d4049',
  jobs: jobs.map((j, i) => ({ ...j, vector: roundVector(jobVectors[i], 6) })),
};

await mkdir(outDir, { recursive: true });
// One item per line keeps diffs readable when a single item changes.
const dump = (obj, key) =>
  JSON.stringify({ ...obj, [key]: undefined }, null, 2).replace(/\n}$/, `,\n  "${key}": [\n${obj[key].map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]\n}\n`);
await writeFile(join(outDir, 'embeddings.json'), dump(embeddings, 'items'));
await writeFile(join(outDir, 'jobs.json'), dump(jobsOut, 'jobs'));
console.log(`embedded ${docs.length} content items and ${jobs.length} jobs with ${MODEL} (${dtype})`);
