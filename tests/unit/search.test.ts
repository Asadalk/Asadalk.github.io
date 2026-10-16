import { describe, expect, it } from 'vitest';
import { buildDocs, keywords, topMatches, whyLine } from '../../src/lib/search';
import { cosine, dot, meanPoolNormalize, roundVector } from '../../src/lib/embed-math';
import { archive, projects, research, site, skillGroups } from '../../src/lib/content';
import embeddings from '../../src/content/generated/embeddings.json';

const docs = buildDocs({ research, projects, site, skillGroups, archive });

describe('content docs', () => {
  it('covers every content item once, with a link', () => {
    const ids = docs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('research-bstd');
    for (const p of projects) expect(ids).toContain(p.id);
    for (const a of archive) expect(docs.find((d) => d.id === a.id)?.href).toBe(`/archive/#${a.id}`);
    expect(docs.find((d) => d.id === 'semantic-hire')?.href).toBe('/#semantic-hire');
  });

  it('matches the committed embeddings (run `npm run embed` after editing content)', () => {
    expect(embeddings.dim).toBe(384);
    expect(embeddings.items.map((i) => [i.id, i.type, i.title])).toEqual(docs.map((d) => [d.id, d.type, d.title]));
    for (const i of embeddings.items) expect(i.vector).toHaveLength(384);
  });
});

describe('ranking helpers', () => {
  const items = [
    { id: 'a', vector: [1, 0, 0] },
    { id: 'b', vector: [0.6, 0.8, 0] },
    { id: 'c', vector: [0, 0, 1] },
  ];

  it('orders by cosine, drops weak matches, caps the count', () => {
    expect(topMatches([1, 0, 0], items).map((m) => m.item.id)).toEqual(['a', 'b']);
    expect(topMatches([1, 0, 0], items, 1)).toHaveLength(1);
    expect(topMatches([0, 1, 0], items, 5, 0.9)).toEqual([]);
  });

  it('explains a result with the shared words, or says it is meaning only', () => {
    expect(keywords('What about object detection research?')).toEqual(['object', 'detection', 'research']);
    expect(whyLine('object detection research', 'Scene text detection. B.Tech research.')).toBe('Mentions “detection”, “research”');
    expect(whyLine('benchmarks', 'Benchmark of 10 detectors')).toBe('Mentions “benchmarks”');
    expect(whyLine('hiring for vision', 'Scene text in street photos')).toBe('Close in meaning, no shared words');
  });
});

describe('embedding maths', () => {
  it('mean-pools only real tokens, then normalises', () => {
    // batch 1, 3 tokens (last is padding), dim 2
    const [v] = meanPoolNormalize([3, 0, 1, 0, 100, 100], [1, 1, 0], 1, 3, 2);
    expect(Array.from(v)).toEqual([1, 0]);
    const [w] = meanPoolNormalize([1, 1, 3, 3], [1n, 1n], 1, 2, 2);
    expect(w[0]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('dot equals cosine for unit vectors', () => {
    expect(dot([0.6, 0.8], [1, 0])).toBeCloseTo(cosine([3, 4], [2, 0]), 12);
    expect(roundVector([0.123456, -0.000004])).toEqual([0.12346, -0]);
  });
});
