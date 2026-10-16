// Small vector helpers. Vectors are plain number arrays.
import type { Vec } from './types';

export const zeros = (n: number): Vec => new Array<number>(n).fill(0);

export function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * (b[i] ?? 0);
  return s;
}

export const norm = (a: Vec): number => Math.sqrt(dot(a, a));

/** Unit-length copy; a zero vector stays zero. */
export function normalize(a: Vec): Vec {
  const n = norm(a);
  return n === 0 ? a.slice() : a.map((x) => x / n);
}

/** Cosine similarity in [-1, 1]; 0 when either vector is zero. */
export function cosine(a: Vec, b: Vec): number {
  const d = norm(a) * norm(b);
  return d === 0 ? 0 : dot(a, b) / d;
}

export const cosineDistance = (a: Vec, b: Vec): number => 1 - cosine(a, b);

export const add = (a: Vec, b: Vec): Vec => a.map((x, i) => x + b[i]);
export const scale = (a: Vec, k: number): Vec => a.map((x) => x * k);

/** Weighted mean of vectors; weights need not sum to 1. */
export function weightedMean(vs: Vec[], ws: number[]): Vec {
  if (vs.length === 0) return [];
  const out = zeros(vs[0].length);
  let total = 0;
  vs.forEach((v, j) => {
    total += ws[j];
    for (let i = 0; i < v.length; i++) out[i] += v[i] * ws[j];
  });
  return total === 0 ? out : scale(out, 1 / total);
}

/** Index of the largest entry; ties go to the later index. */
export function argmax(a: Vec): number {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] >= a[best]) best = i;
  return best;
}
