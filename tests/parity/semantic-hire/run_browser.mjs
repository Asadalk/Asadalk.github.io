// Browser side of the parity test, run in Node: the site's self-hosted model
// files, the site's pooling code, the committed job vectors
// (src/content/generated/jobs.json) and src/lib/matcher.ts.
//
//   node tests/parity/semantic-hire/run_browser.mjs [--dtype fp32|fp16|q8] [--out file]
//
// Default dtype is the one visitors' browsers use (src/lib/embed-config.ts).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEmbedder } from '../../../scripts/lib/embedder.mjs';
import { rankJobs } from '../../../src/lib/matcher.ts';
import { dot } from '../../../src/lib/embed-math.ts';
import { BROWSER_DTYPE } from '../../../src/lib/embed-config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const dtype = arg('--dtype', BROWSER_DTYPE);
const outFile = arg('--out', join(here, 'browser.json'));

const { jobs, dtype: jobsDtype } = JSON.parse(await readFile(join(root, 'src/content/generated/jobs.json'), 'utf8'));
const queries = JSON.parse(await readFile(join(root, 'src/content/data/semantic-hire/queries.json'), 'utf8'));
const { embed } = await loadEmbedder(dtype);

const out = [];
for (const q of queries) {
  const [v] = await embed([q.resume_text]);
  const cosines = jobs.map((j) => dot(v, j.vector));
  const ranked = rankJobs(q.resume_text, jobs, cosines);
  out.push({
    query_id: q.query_id,
    top5: ranked.map((r) => ({
      job_id: r.jobId,
      semantic: r.semanticScore,
      skill: r.skillOverlapScore,
      final: r.finalScore,
      matched: r.matchedSkills,
      missing: r.missingSkills,
    })),
    cosines: Object.fromEntries(jobs.map((j, i) => [j.job_id, Math.round(cosines[i] * 1e6) / 1e6])),
  });
}

const pkg = JSON.parse(await readFile(join(root, 'node_modules/@huggingface/transformers/package.json'), 'utf8'));
await writeFile(
  outFile,
  JSON.stringify({ side: 'browser', model: 'Xenova/all-MiniLM-L6-v2', dtype, jobVectorsDtype: jobsDtype, transformersJs: pkg.version, queries: out }, null, 1) + '\n',
);
console.log(`wrote ${outFile} (${dtype})`);
