// Seedable randomness so tests are deterministic. The DOM adapter passes Math.random.
import type { Rng } from './types';

/** mulberry32: tiny, fast, good enough for sampling. */
export function seeded(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
export function gaussian(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * Gamma(shape, 1) by Marsaglia & Tsang (2000). For shape < 1 it samples
 * Gamma(shape + 1) and scales by U^(1/shape).
 */
export function gamma(shape: number, rng: Rng): number {
  if (!(shape > 0)) throw new Error('gamma shape must be positive');
  if (shape < 1) return gamma(shape + 1, rng) * Math.pow(rng() || Number.MIN_VALUE, 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta(a, b) as X / (X + Y) with X ~ Gamma(a), Y ~ Gamma(b). */
export function beta(a: number, b: number, rng: Rng): number {
  const x = gamma(a, rng);
  const y = gamma(b, rng);
  return x / (x + y);
}
