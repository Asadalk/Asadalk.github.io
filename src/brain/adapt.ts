// What the site changes for a visitor: headline, order of upcoming cards,
// reading depth, and a one-time plain-résumé offer for skimmers.
//
// Stability rule: nothing on screen or above it ever moves, hides or
// resizes. These functions only plan; the DOM adapter enforces where.
import { AXIS_LABEL, type Axis } from './types';
import type { VisitorModel } from './model';
import type { Ranked } from './ranking';

export interface HeadlineInput {
  model: VisitorModel;
  headlines: Partial<Record<Axis | 'default', string>>;
  heroVisible: boolean;
  alreadyChanged: boolean;
  /** Positive updates needed before the profile is trusted. */
  minUpdates?: number;
  /** Lead of the dominant axis over the runner-up on the unit profile. */
  minLead?: number;
}

export interface HeadlineChoice {
  axis: Axis;
  text: string;
  reason: string;
}

/** Headline for the dominant axis: at most once per session, never while the hero is on screen. */
export function chooseHeadline({
  model,
  headlines,
  heroVisible,
  alreadyChanged,
  minUpdates = 3,
  minLead = 0.05,
}: HeadlineInput): HeadlineChoice | null {
  if (alreadyChanged || heroVisible) return null;
  if (model.state.updates < minUpdates) return null;
  const d = model.dominant();
  if (!d || d.lead < minLead) return null;
  const text = headlines[d.axis];
  if (!text || text === headlines.default) return null;
  return { axis: d.axis, text, reason: `Changed the headline to match your interest in ${AXIS_LABEL[d.axis]}.` };
}

export interface Move {
  id: string;
  from: number;
  to: number;
}

/**
 * New order for a list of cards. The first `fixed` cards (on screen or above)
 * keep their places; the rest follow the ranking. Ids missing from the
 * ranking keep their relative order at the end.
 */
export function planOrder(current: string[], fixed: number, ranked: Ranked[]): { order: string[]; moves: Move[] } {
  const head = current.slice(0, fixed);
  const tail = current.slice(fixed);
  const pos = new Map(ranked.map((r, i) => [r.id, i]));
  const sorted = tail
    .map((id, i) => ({ id, i, p: pos.get(id) ?? Infinity }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.id);
  const order = [...head, ...sorted];
  const moves = order
    .map((id, to) => ({ id, from: current.indexOf(id), to }))
    .filter((m) => m.from !== m.to);
  return { order, moves };
}

/** Deep readers get the next project opened for them (below the fold only). */
export function readingDepth(model: VisitorModel): 'deep' | 'normal' {
  const dwells = Object.values(model.state.items).map((s) => s.dwell);
  const total = dwells.reduce((a, b) => a + b, 0);
  const long = dwells.filter((d) => d >= 20).length;
  return long >= 2 || total >= 90 ? 'deep' : 'normal';
}

export interface SkimInput {
  /** Active ms since the page loaded. */
  elapsedMs: number;
  /** Fast scroll bursts so far (more than ~2.5 screens per second). */
  fastScrolls: number;
  /** Longest qualifying read of any card so far, seconds. */
  maxDwellSec: number;
}

/**
 * A skimmer scrolls fast and reads little in the first 25 s. They get one
 * offer of the plain résumé view.
 */
export function isSkimmer({ elapsedMs, fastScrolls, maxDwellSec }: SkimInput): boolean {
  return elapsedMs >= 6_000 && elapsedMs <= 25_000 && fastScrolls >= 3 && maxDwellSec < 4;
}
