import { describe, expect, test } from 'vitest';
import { argmax, cosine, cosineDistance, normalize, norm, weightedMean } from '../../../src/brain/vector';
import { beta, gamma, gaussian, seeded } from '../../../src/brain/rng';

describe('vector', () => {
  test('cosine of parallel, orthogonal and opposite vectors', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 3])).toBeCloseTo(0);
    expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1);
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1);
  });

  test('zero vectors are safe', () => {
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(normalize([0, 0])).toEqual([0, 0]);
  });

  test('normalize gives unit length', () => {
    expect(norm(normalize([3, 4]))).toBeCloseTo(1);
  });

  test('weightedMean', () => {
    expect(weightedMean([[0, 0], [2, 4]], [1, 3])).toEqual([1.5, 3]);
    expect(weightedMean([], [])).toEqual([]);
  });

  test('argmax breaks ties toward the later index', () => {
    expect(argmax([0.6, 1, 0.3, 0.4, 1])).toBe(4);
    expect(argmax([3, 1, 2])).toBe(0);
  });
});

describe('rng', () => {
  test('seeded generators are reproducible and in [0, 1)', () => {
    const a = seeded(42);
    const b = seeded(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(seeded(1)()).not.toBe(seeded(2)());
  });

  test('gaussian has mean 0 and variance 1', () => {
    const r = seeded(3);
    const xs = Array.from({ length: 20000 }, () => gaussian(r));
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
    expect(m).toBeCloseTo(0, 1);
    expect(v).toBeCloseTo(1, 1);
  });

  test.each([0.4, 1, 2.5, 9])('Marsaglia–Tsang gamma(%f) has mean ≈ shape', (k) => {
    const r = seeded(11);
    const n = 20000;
    let s = 0;
    for (let i = 0; i < n; i++) s += gamma(k, r);
    expect(s / n).toBeGreaterThan(k * 0.95);
    expect(s / n).toBeLessThan(k * 1.05);
  });

  test('gamma rejects a non-positive shape', () => {
    expect(() => gamma(0, seeded(1))).toThrow();
  });

  test('beta(a, b) has mean a / (a + b) and stays in (0, 1)', () => {
    const r = seeded(5);
    for (const [a, b] of [[1, 1], [2, 8], [6, 2]]) {
      const xs = Array.from({ length: 10000 }, () => beta(a, b, r));
      const m = xs.reduce((s, x) => s + x, 0) / xs.length;
      expect(m).toBeCloseTo(a / (a + b), 1);
      expect(Math.min(...xs)).toBeGreaterThan(0);
      expect(Math.max(...xs)).toBeLessThan(1);
    }
  });
});
