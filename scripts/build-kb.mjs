// Builds the knowledge base for "Ask about me": every fact on the site as a
// small, self-contained chunk that names its subject, so retrieval can find it
// and the LLM can answer from it without context. Output:
// src/content/generated/kb.json  →  [{ id, href, title, text }]
// The API (space/server.py) embeds these chunks and answers only from them.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync(new URL(`../src/content/${f}`, import.meta.url), 'utf8'));
const site = load('site.json');
const research = load('research.json');
const projects = load('projects.json');
const skills = load('skills.json');
const archive = load('archive.json');

const chunks = [];
const add = (href, title, text) => chunks.push({ id: `c${chunks.length + 1}`, href, title, text: text.replace(/\s+/g, ' ').trim() });
// One self-contained fact per table row: a whole table in one chunk let the
// model attribute a baseline's numbers to the main result.
const rowFacts = (t, subject) =>
  t.rows.map((r) => `${subject} — ${t.caption}. Row "${r[0]}": ` + t.columns.slice(1).map((c, i) => `${c} ${r[i + 1]}`).join(', ') + '.');
const who = site.name;

// Identity and about
add('/#about', 'Who he is', `${who} (also called Faizal). ${site.tagline}. ${site.bio}`);
site.about.forEach((p, i) => add('/#about', `About ${who} (${i + 1})`, p));

// Education: say plainly which degree is the highest and current.
const [degree, ...school] = site.education;
add(
  '/#education',
  'Education: highest degree',
  `${who}'s highest education is a ${degree.degree} at ${degree.institution} (${degree.years}), which he is currently pursuing: he is in his final year and has not graduated yet. He does not hold a master's or PhD.`,
);
add('/#education', 'Education: coursework', `Coursework in ${who}'s B.Tech at IIT Jodhpur: ${degree.coursework.join(', ')}.`);
add('/#education', 'Education: school', `${who}'s schooling: ` + school.map((e) => `${e.degree} at ${e.institution} (${e.years})`).join('; ') + '.');

// Experience and achievements
for (const x of site.experience) add(`/#${x.id}`, `Experience: ${x.role}`, `${who}: ${x.role}, ${x.org}, ${x.dates}.`);
for (const a of site.achievements) add('/#education', 'Achievement', `${who} — ${a.text}.`);

// Contact (no phone number exists in the content, by design)
const c = site.contact;
add('/#contact', 'Contact', `Contact ${who} by email at ${c.email}. LinkedIn: ${c.linkedin}. GitHub: ${c.github}. LeetCode (C++ practice): ${c.leetcode}.`);

// Research
const r = research;
add('/#research-bstd', 'Research overview', `${who}'s research: ${r.title}. ${r.role} with ${r.supervisor}, since August 2026 (ongoing). ${r.summary}`);
add('/#research-bstd', 'Research problem', `The problem in ${who}'s research: ${r.problem}`);
for (const x of r.contributions) add('/#research-bstd', `Research: ${x.title}`, `In his research, ${who} — ${x.title}: ${x.text}`);
for (const t of r.results) {
  for (const f of rowFacts(t, `${who}'s research result`)) add('/#research-bstd', `Research results: ${t.caption}`, f);
  if (t.notes?.length) add('/#research-bstd', `Research results: ${t.caption} (notes)`, `${who}'s research, ${t.caption}: ${t.notes.join(' ')}`);
}
add('/#research-bstd', 'Research: ongoing work', `${who}'s ongoing research work (in progress, no results yet): ${r.ongoing}`);
add('/#research-bstd', 'Research: tools', `Tools ${who} uses in his research: ${r.stack.join(', ')}.`);
add('/#research-bstd', 'Research: credit', r.credit.text + ` Paper: ${r.credit.citation}`);

// Projects
for (const p of projects) {
  const href = `/#${p.id}`;
  const status = p.status === 'in-progress' ? ' (in progress)' : '';
  add(href, `Project: ${p.title}`, `${who}'s project ${p.title}${status}: ${p.summary} Problem it addresses: ${p.problem}`);
  for (const b of p.built || []) add(href, `${p.title}: what he built`, `In ${p.title}, ${who} built: ${b}`);
  for (const b of p.plannedMethod || []) add(href, `${p.title}: plan`, `Planned for ${p.title}: ${b}`);
  if (p.results) {
    for (const f of rowFacts(p.results, `${p.title} result`)) add(href, `${p.title}: results`, f);
    for (const f of p.results.findings || []) add(href, `${p.title}: finding`, `${p.title} finding: ${f}`);
    if (p.results.caveats?.length) add(href, `${p.title}: caveats`, `${p.title} caveats: ${p.results.caveats.join(' ')}`);
  }
  if (p.statusNote) add(href, `${p.title}: status`, `${p.title} status: ${p.statusNote}`);
  if (p.stack) add(href, `${p.title}: tech stack`, `${p.title} tech stack: ${p.stack.join(', ')}.`);
  if (p.repo) add(href, `${p.title}: code`, `${p.title} source code: ${p.repo}`);
}

// Skills: one chunk per group, listing what each skill is proven by.
for (const g of skills.groups) {
  add(`/#${g.id}`, `Skills: ${g.name}`, `${who}'s skills in ${g.name}: ${g.skills.map((s) => s.name + (s.inProgress ? ' (in progress)' : '')).join(', ')}.`);
}

// Smaller projects
for (const a of archive.items.filter((i) => i.show)) {
  add(`/archive/#${a.id}`, `Smaller project: ${a.repo.split('/').pop()}`, `${who}'s smaller project ${a.repo.split('/').pop()}: ${a.line} (${a.context}).`);
}

mkdirSync(new URL('../src/content/generated/', import.meta.url), { recursive: true });
writeFileSync(new URL('../src/content/generated/kb.json', import.meta.url), JSON.stringify(chunks, null, 1));
console.log(`kb.json: ${chunks.length} chunks`);
