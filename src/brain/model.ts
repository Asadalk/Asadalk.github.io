// The visitor model: what this visitor seems interested in.
//
// Two profiles are kept, updated the same way:
//  - interest: a unit vector in the item-vector space (384-d embeddings, or
//    the 5 axes when embeddings are missing). Ranking uses this.
//  - axes: a unit vector over the 5 axes. The radar chart and the headline use this.
//
// Each signal moves a profile toward (or, if negative, away from) the vector
// of what was engaged with, by an exponential moving average (EMA):
//     p ← normalize((1 − w)·p + w·v),   w = α · strength
// The first positive signal sets the profile directly.
import { AXES, STRENGTH, type Axis, type BrainItem, type Signal, type Vec } from './types';
import { cosine, normalize, scale, weightedMean, zeros } from './vector';

export interface ItemStats {
  /** Times the card was really on screen (≥50% for a moment) or suggested. */
  shown: number;
  /** Engagements (expand, demo, ≥10 s of reading, accepted suggestion). */
  engaged: number;
  /** Total qualifying reading time in seconds. */
  dwell: number;
  /** Last engagement, in the injected clock's ms. */
  engagedAt?: number;
}

export interface ModelState {
  interest: Vec | null;
  axes: Vec | null;
  /** Positive updates applied so far (a confidence proxy). */
  updates: number;
  items: Record<string, ItemStats>;
  lastEngaged: string | null;
  /** Label of the opener chip, if one was picked. */
  opener: string | null;
  /**
   * Strength-weighted sum of what was engaged with since the last suggestion,
   * and how many signals went into it. Pacing compares its direction with
   * the profile at that suggestion to detect a real change of interest.
   */
  recent: { v: Vec | null; n: number };
}

export interface ModelConfig {
  /** EMA rate for a full-strength signal. Tuned in tests/unit/brain/tuning.test.ts. */
  alpha: number;
  /** Seconds of reading on one card that count as an engagement. */
  dwellEngagedSec: number;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = { alpha: 0.3, dwellEngagedSec: 10 };

export const emptyModel = (): ModelState => ({
  interest: null,
  axes: null,
  updates: 0,
  items: {},
  lastEngaged: null,
  recent: { v: null, n: 0 },
  opener: null,
});

/** Log-scaled dwell value in 0..1, saturating at 60 s. */
export const dwellValue = (sec: number): number => Math.log1p(Math.min(Math.max(sec, 0), 60)) / Math.log1p(60);

/** One EMA step. Returns the new unit vector (or null when there is nothing yet). */
export function emaStep(p: Vec | null, v: Vec, w: number, nonNegative = false): Vec | null {
  if (v.length === 0) return p;
  if (!p) return w > 0 ? normalize(v) : null;
  let next: Vec;
  if (w >= 0) next = p.map((x, i) => (1 - w) * x + w * v[i]);
  else next = p.map((x, i) => x + w * v[i]);
  if (nonNegative) next = next.map((x) => Math.max(0, x));
  const n = normalize(next);
  return n.every((x) => x === 0) ? p : n;
}

/** Axis boost (from site.json) as a 5-d vector in AXES order. */
export const boostToAxes = (b: Partial<Record<Axis, number>>): Vec => AXES.map((a) => b[a] ?? 0);

export class VisitorModel {
  state: ModelState;
  readonly byId: Map<string, BrainItem>;

  constructor(
    readonly items: BrainItem[],
    readonly cfg: ModelConfig = DEFAULT_MODEL_CONFIG,
    state?: ModelState,
  ) {
    this.byId = new Map(items.map((i) => [i.id, i]));
    this.state = state ?? emptyModel();
  }

  stats(id: string): ItemStats {
    return (this.state.items[id] ??= { shown: 0, engaged: 0, dwell: 0 });
  }

  /** Map an axis direction into the item-vector space. */
  axesToVector(axes: Vec): Vec {
    // A blend of the items that match the direction, so the result sits among
    // real items (a bare boost like [1, 0.6, 0, 0, 0] matches none of them well).
    const ws = this.items.map((i) => Math.max(0, cosine(axes, i.axes)) ** 4);
    return normalize(weightedMean(this.items.map((i) => i.vector), ws));
  }

  /** Resolve a signal to (vector, axes, strength). Returns null if it carries no information. */
  private resolve(s: Signal): { v: Vec; a: Vec; strength: number } | null {
    const item = s.itemId ? this.byId.get(s.itemId) : undefined;
    const group = (s.itemIds ?? []).map((id) => this.byId.get(id)).filter((i): i is BrainItem => !!i);
    switch (s.kind) {
      case 'demo':
      case 'expand':
      case 'fast-scroll':
      case 'dismiss':
        return item ? { v: item.vector, a: item.axes, strength: STRENGTH[s.kind] } : null;
      case 'dwell': {
        if (!item || !s.seconds) return null;
        const before = this.stats(item.id).dwell;
        const gain = dwellValue(before + s.seconds) - dwellValue(before);
        return gain > 0 ? { v: item.vector, a: item.axes, strength: STRENGTH.dwell * gain } : null;
      }
      case 'ask': {
        const dim = this.items[0]?.vector.length ?? 0;
        const groupV = group.length ? weightedMean(group.map((g) => g.vector), group.map(() => 1)) : null;
        const v = s.vector && s.vector.length === dim ? s.vector : groupV;
        if (!v) return null;
        const a = group.length
          ? weightedMean(group.map((g) => g.axes), group.map(() => 1))
          : weightedMean(this.items.map((i) => i.axes), this.items.map((i) => Math.max(0, cosine(v, i.vector)) ** 2));
        return { v, a, strength: STRENGTH.ask };
      }
      case 'signboard': {
        if (group.length) {
          return {
            v: weightedMean(group.map((g) => g.vector), group.map(() => 1)),
            a: weightedMean(group.map((g) => g.axes), group.map(() => 1)),
            strength: STRENGTH.signboard,
          };
        }
        return null;
      }
      case 'opener': {
        const a = boostToAxes(s.axesBoost ?? {});
        if (a.every((x) => x === 0)) return null; // "Just exploring" carries no direction
        return { v: this.axesToVector(a), a, strength: STRENGTH.opener };
      }
    }
  }

  /**
   * Apply one signal. Returns the effective EMA weight (0 when ignored), so
   * callers can log what happened.
   */
  apply(s: Signal, now = 0): number {
    const st = this.state;
    const item = s.itemId ? this.byId.get(s.itemId) : undefined;
    if (s.kind === 'opener') st.opener = s.label ?? null;
    // A quick scroll past something already engaged with is not a negative.
    if (s.kind === 'fast-scroll' && item && this.stats(item.id).engaged > 0) return 0;

    const r = this.resolve(s);
    // Bookkeeping that happens even when the profile does not move.
    if (item && s.kind === 'dwell' && s.seconds) {
      const stats = this.stats(item.id);
      const crossed = stats.dwell < this.cfg.dwellEngagedSec && stats.dwell + s.seconds >= this.cfg.dwellEngagedSec;
      stats.dwell += s.seconds;
      if (crossed) this.markEngaged(item.id, now);
    }
    if (item && (s.kind === 'expand' || s.kind === 'demo')) this.markEngaged(item.id, now);
    if (!r) return 0;

    // Clamp so one strong signal can never wipe out the history.
    const w = Math.max(-0.5, Math.min(0.6, this.cfg.alpha * r.strength));
    st.interest = emaStep(st.interest, normalize(r.v), w);
    st.axes = emaStep(st.axes, normalize(r.a), w, true);
    if (w > 0) {
      st.updates += 1;
      const u = normalize(r.v);
      st.recent.v = st.recent.v ? st.recent.v.map((x, i) => x + w * u[i]) : scale(u, w);
      st.recent.n += 1;
    }
    return w;
  }

  markEngaged(id: string, now = 0): void {
    const stats = this.stats(id);
    stats.engaged += 1;
    stats.engagedAt = now;
    this.state.lastEngaged = id;
  }

  /** Start a new "recent" window (called when a suggestion is shown). */
  resetRecent(): void {
    this.state.recent = { v: null, n: 0 };
  }

  markShown(id: string): void {
    this.stats(id).shown += 1;
  }

  /** Axis profile scaled for display (max = 1), or zeros at cold start. */
  axesForDisplay(): Vec {
    const a = this.state.axes;
    if (!a) return zeros(AXES.length);
    const m = Math.max(...a);
    return m > 0 ? scale(a, 1 / m) : a.slice();
  }

  /** Dominant axis and its lead over the runner-up (both on the unit profile). */
  dominant(): { axis: Axis; lead: number } | null {
    const a = this.state.axes;
    if (!a) return null;
    const order = AXES.map((ax, i) => ({ ax, v: a[i] })).sort((x, y) => y.v - x.v);
    return { axis: order[0].ax, lead: order[0].v - order[1].v };
  }
}
