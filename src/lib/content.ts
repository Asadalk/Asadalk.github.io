// Typed access to src/content/*.json. Pages render only from here, so the
// owner can edit the JSON without touching components.
import siteJson from '../content/site.json';
import researchJson from '../content/research.json';
import projectsJson from '../content/projects.json';
import skillsJson from '../content/skills.json';
import archiveJson from '../content/archive.json';

/** Weights over the five interest axes, each 0..1. Used by the brain (Phase 5). */
export interface Axes {
  ml: number;
  dl: number;
  software: number;
  data: number;
  research: number;
}

export interface ResultTable {
  id?: string;
  caption: string;
  columns: string[];
  rows: string[][];
  notes?: string[];
  findings?: string[];
  caveats?: string[];
}

export interface Demo {
  label: string;
  runsOn?: 'device' | 'server';
  phase?: number;
}

export interface Research {
  id: string;
  type: 'research';
  title: string;
  summary: string;
  role: string;
  supervisor: string;
  start: string;
  repo: string;
  stack: string[];
  tags: string[];
  axes: Axes;
  credit: { text: string; toolkit: string; citation: string; doi: string };
  problem: string;
  contributions: { id: string; title: string; text: string }[];
  results: ResultTable[];
  ongoing: string;
  demo: Demo;
}

export interface Project {
  id: string;
  type: 'project';
  status?: 'in-progress';
  statusNote?: string;
  title: string;
  /** Optional short label for skill links. */
  short?: string;
  summary: string;
  repo: string | null;
  tags: string[];
  axes: Axes;
  problem: string;
  built?: string[];
  plannedMethod?: string[];
  stack?: string[];
  focus?: string;
  results?: ResultTable | null;
  timeline?: { date: string; text: string }[];
  evolvedFrom?: string;
  media?: { video: string; poster: string; caption: string; source: string };
  figures?: { src: string; width: number; height: number; alt: string; caption: string }[];
  demo?: Demo & { blockedOn?: string };
}

export interface Skill {
  name: string;
  proof: string[];
  proofLabel?: string;
  inProgress?: boolean;
}

export interface SkillGroup {
  id: string;
  name: string;
  axes: Axes;
  skills: Skill[];
}

export interface ArchiveItem {
  id: string;
  repo: string;
  line: string;
  context: string;
  caution?: string;
  show: boolean;
}

export const site = siteJson;
export const research = researchJson as Research;
export const projects = projectsJson as Project[];
export const skillGroups = (skillsJson as { groups: SkillGroup[] }).groups;
export const archive = (archiveJson as { items: ArchiveItem[] }).items.filter((i) => i.show);

const titles: Record<string, string> = {
  [research.id]: 'Research',
  ...Object.fromEntries(projects.map((p) => [p.id, p.short ?? p.title])),
  ...Object.fromEntries(archive.map((a) => [a.id, a.repo.split('/').pop() ?? a.id])),
};

/** Resolve a skill's proof entry to a link. Content ids point at their card. */
export function proofLink(proof: string, label?: string): { href: string; text: string } {
  if (/^https?:\/\//.test(proof)) return { href: proof, text: label ?? new URL(proof).hostname };
  const text = titles[proof];
  if (!text) throw new Error(`Unknown proof id "${proof}" in skills.json`);
  const href = proof.startsWith('archive-') ? `/archive/#${proof}` : `/#${proof}`;
  return { href, text };
}

/** Every content id a skill may point to. Used by tests to catch typos. */
export const knownIds = new Set(Object.keys(titles));
