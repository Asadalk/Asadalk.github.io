// semantic-hire's ranking, ported line for line from the Python repo
// (app/preprocess.py, app/skills.py, app/ranking.py, app/main.py /match).
// Pure functions with no imports: the browser, the parity script (plain Node)
// and Vitest all run this same file.

/** app/skills.py SKILL_VOCABULARY, same order. */
export const SKILL_VOCABULARY = [
  'Machine Learning', 'Deep Learning', 'Computer Vision', 'Information Retrieval',
  'Data Engineering', 'Spring Boot', 'Node.js', 'C++', 'C#', 'JavaScript',
  'TypeScript', 'PostgreSQL', 'TensorFlow', 'PyTorch', 'Kubernetes', 'FastAPI',
  'MongoDB', 'Docker', 'Python', 'Java', 'React', 'Angular', 'Django', 'Flask',
  'Pandas', 'NumPy', 'Scikit-learn', 'FAISS', 'NLP', 'LLM', 'RAG', 'SQL', 'AWS',
  'Azure', 'GCP', 'Statistics', 'Data Analysis', 'Tableau', 'HTML', 'CSS', 'Linux',
  'Terraform', 'Spring', 'Redis', 'Git', 'Spark', 'Hadoop', 'Airflow', 'MLOps',
] as const;

/** FAISS retrieves this many jobs before the skill re-rank (the API default). */
export const TOP_K = 5;
export const SEMANTIC_WEIGHT = 0.7;
export const SKILL_WEIGHT = 0.3;
/** app/main.py rejects shorter resumes. */
export const MIN_RESUME_CHARS = 20;

export interface Job {
  job_id: string;
  title: string;
  company: string;
  location?: string;
  description: string;
  skills: string[];
}

export interface RankedScore {
  semanticScore: number;
  skillOverlapScore: number;
  finalScore: number;
}

export interface MatchResult extends RankedScore {
  jobId: string;
  title: string;
  company: string;
  location: string;
  matchedSkills: string[];
  missingSkills: string[];
}

/** app/preprocess.py clean_text: collapse runs of whitespace, trim. */
export function cleanText(text: string): string {
  // Python's \s also matches \x1c-\x1f; JS's does not.
  return text.replace(/[\s\x1c-\x1f]+/gu, ' ').trim();
}

/**
 * Python's str.casefold(). Upper- then lower-casing applies the same full
 * case folding for everything that matters here (e.g. "ß" → "ss").
 */
export function casefold(text: string): string {
  return text.toUpperCase().toLowerCase();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Python's \w on str is Unicode-aware; JS's \w is ASCII-only even with the
// u flag, so the word class is spelled out with Unicode properties.
const WORD = '\\p{L}\\p{N}_';
const SKILL_PATTERNS = SKILL_VOCABULARY.map(
  (skill) => [skill, new RegExp(`(?<![${WORD}+#.])${escapeRegExp(casefold(skill))}(?![${WORD}+#.])`, 'u')] as const,
);

/** app/skills.py extract_skills: case-insensitive phrases with token boundaries. */
export function extractSkills(text: string): Set<string> {
  const normalized = casefold(text);
  const found = new Set<string>();
  for (const [skill, pattern] of SKILL_PATTERNS) if (pattern.test(normalized)) found.add(skill);
  return found;
}

/** app/ranking.py combine_scores. */
export function combineScores(semanticScore: number, resumeSkills: Set<string>, jobSkills: Set<string>): RankedScore {
  const semantic = Math.min(1, Math.max(0, semanticScore));
  let shared = 0;
  for (const s of jobSkills) if (resumeSkills.has(s)) shared++;
  const overlap = jobSkills.size ? shared / jobSkills.size : 0;
  return { semanticScore: semantic, skillOverlapScore: overlap, finalScore: SEMANTIC_WEIGHT * semantic + SKILL_WEIGHT * overlap };
}

/** The job's skills: its listed skills plus any vocabulary skill in its description. */
export function jobSkillSet(job: Job): Set<string> {
  return new Set([...job.skills, ...extractSkills(job.description)]);
}

/** Python's round(x, 4) for the values seen here (half-to-even only differs on exact ties). */
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** sorted(..., key=str.casefold): code-point order of the folded strings. */
const byCasefold = (a: string, b: string) => {
  const fa = casefold(a);
  const fb = casefold(b);
  return fa < fb ? -1 : fa > fb ? 1 : 0;
};

/**
 * app/main.py /match. `cosines[i]` is the cosine similarity between the
 * resume and jobs[i] (both embeddings unit length, as FAISS IndexFlatIP sees them).
 *
 * 1. Retrieve the TOP_K jobs with the highest cosine (FAISS's job).
 * 2. Score each: 0.7 × clamp(cosine, 0, 1) + 0.3 × share of the job's skills in the resume.
 * 3. Sort by final score, ties by semantic score (on the 4-decimal values the API returns).
 */
export function rankJobs(resumeText: string, jobs: Job[], cosines: ArrayLike<number>, topK = TOP_K): MatchResult[] {
  const resume = cleanText(resumeText);
  if (resume.length < MIN_RESUME_CHARS) throw new Error(`Resume text must contain at least ${MIN_RESUME_CHARS} non-whitespace characters.`);
  if (cosines.length !== jobs.length) throw new Error('One cosine per job is required.');
  const resumeSkills = extractSkills(resume);

  // FAISS IndexFlatIP: exact search, highest inner product first.
  const candidates = jobs
    .map((job, i) => ({ job, cosine: cosines[i] }))
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, Math.min(topK, jobs.length));

  const ranked = candidates.map(({ job, cosine }) => {
    const jobSkills = jobSkillSet(job);
    const score = combineScores(cosine, resumeSkills, jobSkills);
    return {
      jobId: job.job_id,
      title: job.title,
      company: job.company,
      location: job.location ?? '',
      semanticScore: round4(score.semanticScore),
      skillOverlapScore: round4(score.skillOverlapScore),
      finalScore: round4(score.finalScore),
      matchedSkills: [...jobSkills].filter((s) => resumeSkills.has(s)).sort(byCasefold),
      missingSkills: [...jobSkills].filter((s) => !resumeSkills.has(s)).sort(byCasefold),
    };
  });
  // Array.prototype.sort is stable, like Python's sorted(..., reverse=True).
  ranked.sort((a, b) => b.finalScore - a.finalScore || b.semanticScore - a.semanticScore);
  return ranked;
}
