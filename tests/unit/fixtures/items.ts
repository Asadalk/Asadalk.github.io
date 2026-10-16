// Deterministic synthetic items for brain tests: seeded 384-d vectors
// clustered by topic, like real sentence embeddings (same-topic cosine around
// 0.5, cross-topic around 0). The real embeddings file is never needed.
import { seeded, gaussian } from '../../../src/brain/rng';
import { normalize } from '../../../src/brain/vector';
import type { Axis, ItemInput, Vec } from '../../../src/brain/types';

export const CLUSTER_AXES: Record<string, Record<Axis, number>> = {
  ml: { ml: 1, dl: 0.5, software: 0.3, data: 0.4, research: 0.3 },
  software: { ml: 0.2, dl: 0.1, software: 1, data: 0.3, research: 0.1 },
  data: { ml: 0.4, dl: 0.1, software: 0.3, data: 1, research: 0.4 },
};

export interface Fixture {
  inputs: ItemInput[];
  embeddings: Record<string, Vec>;
  centers: Record<string, Vec>;
  clusterOf: Record<string, string>;
  ids: (cluster: string) => string[];
}

export function randomUnit(rng: () => number, dim: number): Vec {
  return normalize(Array.from({ length: dim }, () => gaussian(rng)));
}

export function makeFixture({
  seed = 7,
  perCluster = 8,
  dim = 384,
  noise = 1,
  clusters = Object.keys(CLUSTER_AXES),
} = {}): Fixture {
  const rng = seeded(seed);
  const centers: Record<string, Vec> = {};
  const inputs: ItemInput[] = [];
  const embeddings: Record<string, Vec> = {};
  const clusterOf: Record<string, string> = {};
  for (const c of clusters) {
    centers[c] = randomUnit(rng, dim);
    for (let k = 0; k < perCluster; k++) {
      const id = `${c}-${k}`;
      const n = randomUnit(rng, dim);
      embeddings[id] = normalize(centers[c].map((x, i) => x + noise * n[i]));
      const base = CLUSTER_AXES[c];
      const axes = Object.fromEntries(
        Object.entries(base).map(([a, v]) => [a, Math.min(1, Math.max(0, v + (rng() - 0.5) * 0.1))]),
      ) as Record<Axis, number>;
      inputs.push({ id, type: 'project', title: `${c} item ${k}`, axes });
      clusterOf[id] = c;
    }
  }
  return {
    inputs,
    embeddings,
    centers,
    clusterOf,
    ids: (c) => inputs.filter((i) => clusterOf[i.id] === c).map((i) => i.id),
  };
}

/** A wall clock the test moves by hand. */
export class FakeWall {
  t = 0;
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}
