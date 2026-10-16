// Simulated visitors for tuning the visitor model (α, drift threshold).
import { buildItems } from '../../../src/brain/index';
import { VisitorModel } from '../../../src/brain/model';
import { calibrated, meanPairCosine } from '../../../src/brain/ranking';
import { seeded } from '../../../src/brain/rng';
import { cosine, cosineDistance } from '../../../src/brain/vector';
import type { Signal, Vec } from '../../../src/brain/types';
import type { Fixture } from './items';

export interface Trace {
  /** Interest profile after each step. */
  profiles: Vec[];
  /** Cluster of the best unengaged item after each step (by calibrated similarity). */
  top: string[];
  /** model.state.recent after each step. */
  recents: { v: Vec | null; n: number }[];
  model: VisitorModel;
}

/**
 * A visitor who engages with one item per step. `clusterAt(step)` is their true
 * interest; with probability `noise` they open something random instead.
 * Signals alternate between opening a card and reading one for 20 s.
 */
export function simulate(
  fx: Fixture,
  { alpha, seed, steps, clusterAt, noise = 0.3, useAxes = false, resetAt = [] }: {
    alpha: number;
    seed: number;
    steps: number;
    clusterAt: (step: number) => string;
    noise?: number;
    useAxes?: boolean;
    /** Steps after which the "recent" window restarts (as when a suggestion is shown). */
    resetAt?: number[];
  },
): Trace {
  const { items } = buildItems(fx.inputs, useAxes ? null : fx.embeddings);
  const mu = meanPairCosine(items);
  const model = new VisitorModel(items, { alpha, dwellEngagedSec: 10 });
  const rng = seeded(seed);
  const clusters = Object.keys(fx.centers);
  const profiles: Vec[] = [];
  const top: string[] = [];
  const recents: { v: Vec | null; n: number }[] = [];
  const pickFrom = (ids: string[]) => {
    const fresh = ids.filter((id) => !(model.state.items[id]?.engaged > 0));
    const pool = fresh.length ? fresh : ids;
    return pool[Math.floor(rng() * pool.length)];
  };
  for (let s = 0; s < steps; s++) {
    const truth = clusterAt(s);
    const c = rng() < noise ? clusters[Math.floor(rng() * clusters.length)] : truth;
    const id = pickFrom(fx.ids(c));
    const sig: Signal = s % 2 === 0 ? { kind: 'expand', itemId: id } : { kind: 'dwell', itemId: id, seconds: 20 };
    model.apply(sig);
    if (sig.kind === 'dwell') model.markEngaged(id);
    const p = model.state.interest!;
    profiles.push(p.slice());
    if (resetAt.includes(s)) model.resetRecent();
    recents.push({ v: model.state.recent.v?.slice() ?? null, n: model.state.recent.n });
    const best = items
      .filter((i) => !(model.state.items[i.id]?.engaged > 0))
      .map((i) => ({ id: i.id, sim: calibrated(p, i, mu) }))
      .sort((a, b) => b.sim - a.sim)[0];
    top.push(best ? fx.clusterOf[best.id] : '');
  }
  return { profiles, top, recents, model };
}

/** Steady-state accuracy: share of steps (after warm-up) where the best next item is in the true cluster. */
export function accuracy(fx: Fixture, alpha: number, seeds = 40, noise = 0.3): number {
  let hit = 0;
  let n = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const tr = simulate(fx, { alpha, seed, steps: 16, clusterAt: () => 'ml', noise });
    for (let s = 3; s < tr.top.length; s++) {
      n++;
      if (tr.top[s] === 'ml') hit++;
    }
  }
  return hit / n;
}

/** Median number of steps after an interest switch until recommendations follow it. */
export function switchLag(fx: Fixture, alpha: number, seeds = 40, noise = 0.3): number {
  const lags: number[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const tr = simulate(fx, { alpha, seed, steps: 40, clusterAt: (s) => (s < 12 ? 'ml' : 'data'), noise });
    let lag = 40;
    for (let s = 12; s < 40; s++) {
      const p = tr.profiles[s];
      if (tr.top[s] === 'data' && cosine(p, fx.centers.data) > cosine(p, fx.centers.ml)) {
        lag = s - 11;
        break;
      }
    }
    lags.push(lag);
  }
  lags.sort((a, b) => a - b);
  return lags[Math.floor(lags.length / 2)];
}

/**
 * Drift as pacing measures it: cosine distance between the interest profile
 * when the last suggestion was shown (step `ref`) and the profile now.
 *  - stable: the visitor keeps the same interest (with noise). Largest drift
 *    over the next `horizon` steps, i.e. the worst moment Quiet could be tested.
 *  - switched: the interest changes right after the suggestion; drift after `gap` steps.
 */
export function driftSamples(
  fx: Fixture,
  alpha: number,
  { gap = 6, horizon = 16, seeds = 30, noise = 0.3, refs = [6, 10], useAxes = false } = {},
) {
  const stable: number[] = [];
  const switched: number[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const a = simulate(fx, { alpha, seed, steps: Math.max(...refs) + 1 + horizon, clusterAt: () => 'ml', noise, useAxes });
    for (const ref of refs) {
      let worst = 0;
      for (let s = ref + 1; s <= ref + horizon; s++) worst = Math.max(worst, cosineDistance(a.profiles[ref], a.profiles[s]));
      stable.push(worst);
    }
    const b = simulate(fx, { alpha, seed, steps: 12 + gap, clusterAt: (s) => (s < 12 ? 'ml' : 'data'), noise, useAxes });
    switched.push(cosineDistance(b.profiles[11], b.profiles[11 + gap]));
  }
  const q = (xs: number[], p: number) => [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
  return { stable, switched, stableP95: q(stable, 0.95), stableMax: Math.max(...stable), switchedP05: q(switched, 0.05), switchedMin: Math.min(...switched) };
}

/** Same, but drift measured against the direction of engagement since the suggestion (needs `minRecent` signals). */
export function recentDriftSamples(
  fx: Fixture,
  alpha: number,
  { gap = 6, horizon = 16, seeds = 30, noise = 0.3, refs = [6, 10], minRecent = 5, useAxes = false } = {},
) {
  const stable: number[] = [];
  const switched: number[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    for (const ref of refs) {
      const a = simulate(fx, { alpha, seed: seed * 13 + ref, steps: ref + 1 + horizon, clusterAt: () => 'ml', noise, useAxes, resetAt: [ref] });
      let worst = 0;
      for (let s = ref + 1; s < a.profiles.length; s++) {
        const r = a.recents[s];
        if (r.v && r.n >= minRecent) worst = Math.max(worst, cosineDistance(r.v, a.profiles[ref]));
      }
      stable.push(worst);
    }
    const b = simulate(fx, { alpha, seed, steps: 12 + gap, clusterAt: (s) => (s < 12 ? 'ml' : 'data'), noise, useAxes, resetAt: [11] });
    switched.push(cosineDistance(b.recents[11 + gap].v!, b.profiles[11]));
  }
  const q = (xs: number[], p: number) => [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
  return { stable, switched, stableP95: q(stable, 0.95), stableMax: Math.max(...stable), switchedP05: q(switched, 0.05), switchedMin: Math.min(...switched) };
}
