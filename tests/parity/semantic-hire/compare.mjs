// Fails unless the browser port ranks every evaluation query exactly like
// the Python service: same five jobs, same order, same matched/missing skills.
// Also reports how far the scores drift.
//
//   node tests/parity/semantic-hire/compare.mjs [python.json] [browser.json]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [pyFile = join(here, 'python.json'), jsFile = join(here, 'browser.json')] = process.argv.slice(2);
const py = JSON.parse(readFileSync(pyFile, 'utf8'));
const js = JSON.parse(readFileSync(jsFile, 'utf8'));

let failures = 0;
const max = { semantic: 0, final: 0, cosine: 0 };
for (const p of py.queries) {
  const b = js.queries.find((q) => q.query_id === p.query_id);
  if (!b) {
    console.log(`FAIL ${p.query_id}: missing from ${jsFile}`);
    failures++;
    continue;
  }
  const po = p.top5.map((r) => r.job_id);
  const bo = b.top5.map((r) => r.job_id);
  const sameOrder = po.length === 5 && po.join() === bo.join();
  const sameSkills = p.top5.every((r, i) => JSON.stringify([r.matched, r.missing]) === JSON.stringify([b.top5[i]?.matched, b.top5[i]?.missing]));
  p.top5.forEach((r, i) => {
    const o = b.top5[i];
    if (!o) return;
    max.semantic = Math.max(max.semantic, Math.abs(r.semantic - o.semantic));
    max.final = Math.max(max.final, Math.abs(r.final - o.final));
  });
  for (const [id, c] of Object.entries(p.cosines)) max.cosine = Math.max(max.cosine, Math.abs(c - b.cosines[id]));
  const ok = sameOrder && sameSkills;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${p.query_id.padEnd(22)} ${po.join(' ')}${sameOrder ? '' : `  vs  ${bo.join(' ')}`}${sameSkills ? '' : '  (skills differ)'}`);
}
console.log(`\nmax |Δ| over top-5: semantic ${max.semantic.toFixed(4)}, final ${max.final.toFixed(4)}; over all 24 cosines: ${max.cosine.toFixed(6)}`);
console.log(`${py.queries.length - failures}/${py.queries.length} queries identical (${js.dtype ?? '?'} model)`);
process.exit(failures ? 1 : 0);
