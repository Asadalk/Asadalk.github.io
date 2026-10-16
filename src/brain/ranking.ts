// Ranking: which unseen item fits this visitor best.
//
// 1. Similarity. Raw cosine depends on the vector space (384-d embeddings of
//    related texts sit around 0.3–0.6; the 5 non-negative axes sit around
//    0.6–0.95), so it is calibrated against the items themselves:
//        sim = clamp((cos − μ) / (1 − μ), 0, 1)
//    where μ is the mean cosine between two different items. sim = 0 means
//    "no closer than a typical pair", 1 means "identical direction".
// 2. Thompson sampling. Each item has Beta(a, b) over "engaged when shown".
//    The prior comes from sim (a0 = 1 + κ·sim, b0 = 1 + κ·(1 − sim)) and
//    real shows/engagements update it. A random draw from each Beta is
//    blended with sim, so slightly-less-likely items still get a chance.
// 3. Seen items decay, engaged items drop to the bottom, and a dismissed
//    topic is penalized for the session.
import type { Axis, BrainItem, Rng, Vec } from './types';
import type { VisitorModel } from './model';
import { beta } from './rng';
import { cosine } from './vector';

export interface RankConfig {
  /** Weight of the Thompson sample in the blend. */
  lambda: number;
  /** Prior strength κ of the Beta prior built from similarity. */
  priorStrength: number;
  /** Multiplier per time an item was already shown without engagement (max 3). */
  seenDecay: number;
  /** Multiplier for items whose topic was dismissed this session. */
  penalty: number;
  /** Confidence gate: absolute calibrated similarity a suggestion needs. */
  gateAbs: number;
  /** Confidence gate: lead over the average on-screen item. */
  gateMargin: number;
}

export const DEFAULT_RANK_CONFIG: RankConfig = {
  lambda: 0.3,
  priorStrength: 4,
  seenDecay: 0.85,
  penalty: 0.5,
  gateAbs: 0.45,
  gateMargin: 0.2,
};

export interface Ranked {
  id: string;
  /** Calibrated similarity to the profile (or curated prior at cold start), 0..1. */
  sim: number;
  /** Thompson draw from the item's Beta; equals sim at cold start. */
  sample: number;
  score: number;
  engaged: boolean;
  seen: boolean;
  penalized: boolean;
}

/** Mean cosine between distinct items: the "typical pair" baseline μ. */
export function meanPairCosine(items: BrainItem[]): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      s += cosine(items[i].vector, items[j].vector);
      n++;
    }
  return n ? s / n : 0;
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function calibrated(profile: Vec, item: BrainItem, mu: number): number {
  return clamp01((cosine(profile, item.vector) - mu) / (1 - mu || 1));
}

export interface RankInput {
  model: VisitorModel;
  /** Owner's curated cold-start order (research first). */
  curated: string[];
  rng: Rng;
  penalties: ReadonlySet<Axis>;
  mu: number;
  cfg?: RankConfig;
}

export function rank({ model, curated, rng, penalties, mu, cfg = DEFAULT_RANK_CONFIG }: RankInput): Ranked[] {
  const profile = model.state.interest;
  const n = model.items.length;
  const out = model.items.map((item): Ranked => {
    const stats = model.stats(item.id);
    const engaged = stats.engaged > 0;
    const seen = stats.shown > 0 || engaged;
    const penalized = penalties.has(item.topic);
    let sim: number;
    let sample: number;
    if (!profile) {
      // Cold start: the curated order, deterministic, no exploration yet.
      const idx = curated.indexOf(item.id);
      sim = idx < 0 ? 0 : 1 - idx / Math.max(n, 1);
      sample = sim;
    } else {
      sim = calibrated(profile, item, mu);
      const a = 1 + cfg.priorStrength * sim + stats.engaged;
      const b = 1 + cfg.priorStrength * (1 - sim) + Math.max(0, stats.shown - stats.engaged);
      sample = beta(a, b, rng);
    }
    let score = (1 - cfg.lambda) * sim + cfg.lambda * sample;
    if (!engaged) score *= cfg.seenDecay ** Math.min(stats.shown, 3);
    if (penalized) score *= cfg.penalty;
    return { id: item.id, sim, sample, score, engaged, seen, penalized };
  });
  // Engaged items go to the bottom of the upcoming queue; otherwise by score.
  return out.sort((x, y) => Number(x.engaged) - Number(y.engaged) || y.score - x.score);
}

export interface GateResult {
  ok: boolean;
  reason: string;
}

/**
 * Confidence gate for suggestions: the candidate must be unseen, fit the
 * profile well in absolute terms, and clearly beat what is already on screen.
 */
export function gate(c: Ranked, onScreen: Ranked[], cfg: RankConfig = DEFAULT_RANK_CONFIG): GateResult {
  if (c.seen) return { ok: false, reason: 'it has already been seen' };
  if (c.penalized) return { ok: false, reason: 'you dismissed that topic' };
  if (c.sim < cfg.gateAbs)
    return { ok: false, reason: `the best match is weak (${c.sim.toFixed(2)} < ${cfg.gateAbs})` };
  // Compare with what the visitor could read instead right now: on-screen
  // items not already engaged with (the card just read is not an alternative).
  const alt = onScreen.filter((r) => !r.engaged);
  const base = alt.length ? alt.reduce((s, r) => s + r.sim, 0) / alt.length : 0;
  if (c.sim - base < cfg.gateMargin)
    return { ok: false, reason: `it is not clearly better than what is on screen (${c.sim.toFixed(2)} vs ${base.toFixed(2)})` };
  return { ok: true, reason: `it fits well (${c.sim.toFixed(2)}) and beats what is on screen (${base.toFixed(2)})` };
}
