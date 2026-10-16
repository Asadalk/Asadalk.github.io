// Mirrors semantic-hire's tests/test_core.py, plus the parts of app/main.py
// the port has to reproduce (retrieve 5, re-rank, tie-break).
import { describe, expect, it } from 'vitest';
import { SKILL_VOCABULARY, cleanText, combineScores, extractSkills, jobSkillSet, rankJobs, type Job } from '../../src/lib/matcher';
import generated from '../../src/content/generated/jobs.json';

describe('ported from tests/test_core.py', () => {
  it('collapses whitespace without losing tokens', () => {
    expect(cleanText('  Python\n\twith  FAISS ')).toBe('Python with FAISS');
  });

  it('extracts skills with phrase boundaries', () => {
    expect(extractSkills('Experienced with Python, PyTorch and NLP')).toEqual(new Set(['Python', 'PyTorch', 'NLP']));
    expect(extractSkills('JavaScript developer').has('Java')).toBe(false);
  });

  it('weights ranking 70/30', () => {
    const s = combineScores(0.8, new Set(['Python', 'SQL']), new Set(['Python', 'SQL', 'Docker', 'AWS']));
    expect(s.semanticScore).toBe(0.8);
    expect(s.skillOverlapScore).toBe(0.5);
    expect(Math.abs(s.finalScore - 0.71)).toBeLessThan(1e-9);
  });

  it('does not divide by zero when a job has no skills', () => {
    const s = combineScores(0.6, new Set(['Python']), new Set());
    expect(s.skillOverlapScore).toBe(0);
    expect(Math.abs(s.finalScore - 0.42)).toBeLessThan(1e-9);
  });
});

describe('skill extraction edge cases', () => {
  it('keeps the vocabulary at 49 skills', () => {
    expect(SKILL_VOCABULARY.length).toBe(49);
  });

  it('treats + # . as part of a token, like the Python regex', () => {
    expect(extractSkills('C++ and C# on Node.js')).toEqual(new Set(['C++', 'C#', 'Node.js']));
    expect(extractSkills('Spring Boot service').has('Spring')).toBe(true);
    expect(extractSkills('Sparkling .NET people').has('Spark')).toBe(false);
    // A full stop right after a skill blocks the match in the Python regex too.
    expect(extractSkills('Docker and Kubernetes.').has('Kubernetes')).toBe(false);
  });

  it('uses Unicode word boundaries (Python \\w), not ASCII ones', () => {
    expect(extractSkills('éPython').has('Python')).toBe(false);
    expect(extractSkills('über Python').has('Python')).toBe(true);
  });

  it('clamps cosine into 0..1', () => {
    expect(combineScores(-0.2, new Set(), new Set(['SQL'])).semanticScore).toBe(0);
    expect(combineScores(1.3, new Set(), new Set()).semanticScore).toBe(1);
  });
});

describe('rankJobs (app/main.py /match)', () => {
  const job = (id: string, skills: string[], description = 'Role.'): Job => ({ job_id: id, title: id, company: 'Co', description, skills });

  it('retrieves the top 5 by cosine, then re-ranks them with skills', () => {
    const jobs = [
      job('a', ['Docker']),
      job('b', ['Python']),
      job('c', ['Java']),
      job('d', ['Go'], 'Uses Python daily.'),
      job('e', ['Rust']),
      job('f', ['Python']), // 6th by cosine: never considered, even with full overlap
    ];
    const r = rankJobs('Python developer with ten years of experience', jobs, [0.9, 0.8, 0.7, 0.6, 0.5, 0.49]);
    expect(r.map((x) => x.jobId)).toEqual(['b', 'a', 'd', 'c', 'e']);
    expect(r[0].finalScore).toBe(0.86); // 0.7·0.8 + 0.3·1
    expect(r[2].matchedSkills).toEqual(['Python']); // from the description
    expect(r[2].missingSkills).toEqual(['Go']);
  });

  it('breaks final-score ties by semantic score', () => {
    // 0.7·0.6 + 0.3·1 = 0.72 and 0.7·0.9 + 0.3·0.3 = 0.72 (rounded to 4 decimals)
    const jobs = [job('low', ['Python']), job('high', ['Python', 'AWS', 'Azure', 'GCP', 'SQL', 'Git', 'Linux', 'Redis', 'Spark', 'Docker'])];
    const r = rankJobs('Python engineer with AWS and SQL experience', jobs, [0.6, 0.9]);
    expect(r.map((x) => x.finalScore)).toEqual([0.72, 0.72]);
    expect(r[0].jobId).toBe('high');
  });

  it('rejects very short resumes like the API', () => {
    expect(() => rankJobs('  short  ', [job('a', ['SQL'])], [0.5])).toThrow(/20/);
  });

  it('job skills = listed skills ∪ skills found in the description', () => {
    expect(jobSkillSet(job('x', ['SQL'], 'Docker and Kubernetes at scale'))).toEqual(new Set(['SQL', 'Docker', 'Kubernetes']));
  });
});

describe('generated jobs', () => {
  it('has the 24 repo jobs with unit-length 384-d vectors', () => {
    expect(generated.jobs).toHaveLength(24);
    for (const j of generated.jobs) {
      expect(j.vector).toHaveLength(384);
      const n = Math.sqrt(j.vector.reduce((s, x) => s + x * x, 0));
      expect(Math.abs(n - 1)).toBeLessThan(1e-4);
    }
  });
});
