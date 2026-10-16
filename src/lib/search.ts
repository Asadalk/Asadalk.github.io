// "Ask about me": the text each content item is embedded from, and the
// helpers that rank items for a question. No runtime imports, so the
// build-time script (plain Node) and the page share the exact same recipe.
import type { ArchiveItem, Project, Research, SkillGroup } from './content';

export type DocType = 'research' | 'project' | 'experience' | 'education' | 'achievement' | 'skills' | 'archive';

export interface Doc {
  id: string;
  type: DocType;
  title: string;
  /** Where the item lives on the site. */
  href: string;
  /** The text that gets embedded. */
  text: string;
}

/** The slice of src/content the recipe reads. */
export interface SearchContent {
  research: Pick<Research, 'id' | 'title' | 'summary' | 'tags'>;
  projects: Pick<Project, 'id' | 'title' | 'summary' | 'tags'>[];
  site: {
    experience: { id: string; role: string; org: string; refersTo?: string }[];
    education: { id: string; degree: string; institution: string; coursework?: string[] }[];
    achievements: { id: string; text: string }[];
  };
  skillGroups: Pick<SkillGroup, 'id' | 'name' | 'skills'>[];
  archive: Pick<ArchiveItem, 'id' | 'repo' | 'line' | 'context'>[];
}

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const tagLine = (tags: string[]) => (tags.length ? ` Tags: ${tags.join(', ')}.` : '');

/**
 * The per-type text recipe (documented in docs/decisions.md):
 * - research, project: "<title>. <summary> Tags: <tags>."
 * - experience: "<role>, <org>." plus the research title when it points at it
 * - education: "<degree>, <institution>." plus coursework when listed
 * - achievement: its text
 * - skill group: "Skills: <group>. <skill>, <skill>, ..."
 * - archive repo: "<repo name>. <line> <context>."
 */
export function buildDocs(c: SearchContent): Doc[] {
  const docs: Doc[] = [];
  const r = c.research;
  docs.push({ id: r.id, type: 'research', title: r.title, href: `/#${r.id}`, text: `${sentence(r.title)} ${sentence(r.summary)}${tagLine(r.tags)}` });
  for (const p of c.projects) {
    docs.push({ id: p.id, type: 'project', title: p.title, href: `/#${p.id}`, text: `${sentence(p.title)} ${sentence(p.summary)}${tagLine(p.tags)}` });
  }
  for (const x of c.site.experience) {
    const about = x.refersTo === r.id ? ` ${sentence(r.title)}` : '';
    docs.push({ id: x.id, type: 'experience', title: `${x.role}, ${x.org}`, href: `/#${x.id}`, text: `${sentence(`${x.role}, ${x.org}`)}${about}` });
  }
  for (const e of c.site.education) {
    const course = e.coursework?.length ? ` Coursework: ${e.coursework.join(', ')}.` : '';
    docs.push({ id: e.id, type: 'education', title: e.degree, href: `/#${e.id}`, text: `${sentence(`${e.degree}, ${e.institution}`)}${course}` });
  }
  for (const a of c.site.achievements) {
    docs.push({ id: a.id, type: 'achievement', title: a.text.split(':')[0], href: `/#${a.id}`, text: sentence(a.text) });
  }
  for (const g of c.skillGroups) {
    docs.push({ id: g.id, type: 'skills', title: `Skills: ${g.name}`, href: `/#${g.id}`, text: `Skills: ${sentence(g.name)} ${sentence(g.skills.map((s) => s.name).join(', '))}` });
  }
  for (const a of c.archive) {
    const name = a.repo.split('/').pop() ?? a.id;
    docs.push({ id: a.id, type: 'archive', title: name, href: `/archive/#${a.id}`, text: `${sentence(name)} ${sentence(a.line)} ${sentence(a.context)}` });
  }
  return docs;
}

export interface Scored<T> {
  item: T;
  score: number;
}

/** Shown results must be at least this similar; below it the match is noise. */
export const MIN_SCORE = 0.2;
export const MAX_RESULTS = 5;

/** Highest cosine first, at most `k`, dropping anything under `min`. Vectors are unit length. */
export function topMatches<T extends { vector: ArrayLike<number> }>(
  query: ArrayLike<number>,
  items: T[],
  k = MAX_RESULTS,
  min = MIN_SCORE,
): Scored<T>[] {
  return items
    .map((item) => {
      let s = 0;
      for (let i = 0; i < query.length; i++) s += query[i] * item.vector[i];
      return { item, score: s };
    })
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

const STOP = new Set(
  'a an and any are about as at be by can could did do does for from has have he his how i in is it its me my of on or show tell than that the their there this to was what when where which who why with work worked you your asad asadullah faisal'.split(' '),
);

/** Query words worth matching: lower-case, 3+ letters, not filler. */
export function keywords(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? [];
  return [...new Set(words.filter((w) => (w.length >= 3 || /^[a-z]\+\+$|^c#$/.test(w)) && !STOP.has(w)))];
}

/**
 * One honest line on why an item came up: the question's words it contains
 * (allowing a plural "s"), or else that it is close in meaning only.
 */
export function whyLine(query: string, text: string): string {
  const hay = text.toLowerCase();
  const hits = keywords(query).filter((w) => {
    const stem = w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;
    return new RegExp(`(?<![\\p{L}\\p{N}])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(hay);
  });
  if (hits.length) return `Mentions ${hits.slice(0, 3).map((w) => `“${w}”`).join(', ')}`;
  return 'Close in meaning, no shared words';
}
