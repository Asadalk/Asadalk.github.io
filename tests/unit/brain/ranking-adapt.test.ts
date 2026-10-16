import { describe, expect, test } from 'vitest';
import { buildItems } from '../../../src/brain/index';
import { VisitorModel } from '../../../src/brain/model';
import { gate, meanPairCosine, rank, type Ranked } from '../../../src/brain/ranking';
import { chooseHeadline, isSkimmer, planOrder, readingDepth } from '../../../src/brain/adapt';
import { seeded } from '../../../src/brain/rng';
import { makeFixture } from '../fixtures/items';

const fx = makeFixture({ perCluster: 6 });
const { items } = buildItems(fx.inputs, fx.embeddings);
const mu = meanPairCosine(items);
const curated = items.map((i) => i.id);
const model = () => new VisitorModel(items, { alpha: 0.3, dwellEngagedSec: 10 });
const doRank = (m: VisitorModel, seed = 1, penalties: string[] = []) =>
  rank({ model: m, curated, rng: seeded(seed), penalties: new Set(penalties as never[]), mu });

describe('ranking', () => {
  test('cold start keeps the curated order, deterministically', () => {
    const r = doRank(model());
    expect(r.map((x) => x.id)).toEqual(curated);
    expect(doRank(model(), 99).map((x) => x.id)).toEqual(curated);
  });

  test('items on the visitor’s topic rank first; engaged ones drop to the bottom', () => {
    const m = model();
    const [a, b] = fx.ids('data');
    m.apply({ kind: 'expand', itemId: a });
    m.apply({ kind: 'demo', itemId: b });
    const r = doRank(m);
    expect(r.slice(0, 4).every((x) => fx.clusterOf[x.id] === 'data')).toBe(true);
    expect(r.slice(-2).map((x) => x.id).sort()).toEqual([a, b].sort());
  });

  test('Thompson sampling explores among near-ties but respects big gaps', () => {
    const m = model();
    m.apply({ kind: 'expand', itemId: fx.ids('ml')[0] });
    const firsts = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const top = doRank(m, seed)[0].id;
      firsts.add(top);
      expect(fx.clusterOf[top]).toBe('ml');
    }
    expect(firsts.size).toBeGreaterThan(1);
  });

  test('seen-but-ignored items decay; a dismissed topic is penalized', () => {
    const m = model();
    m.apply({ kind: 'expand', itemId: fx.ids('ml')[0] });
    const target = fx.ids('ml')[1];
    const before = doRank(m).find((x) => x.id === target)!;
    m.markShown(target);
    m.markShown(target);
    const after = doRank(m).find((x) => x.id === target)!;
    expect(after.score).toBeLessThan(before.score);
    const pen = doRank(m, 1, ['ml']).find((x) => x.id === target)!;
    expect(pen.penalized).toBe(true);
    expect(pen.score).toBeLessThan(after.score);
  });

  const r = (sim: number, extra: Partial<Ranked> = {}): Ranked => ({ id: 'x', sim, sample: sim, score: sim, engaged: false, seen: false, penalized: false, ...extra });

  test('confidence gate: unseen, strong, and clearly better than what is on screen', () => {
    expect(gate(r(0.7), [r(0.3)]).ok).toBe(true);
    expect(gate(r(0.7, { seen: true }), []).reason).toMatch(/already been seen/);
    expect(gate(r(0.3), []).reason).toMatch(/weak/);
    expect(gate(r(0.7), [r(0.6)]).reason).toMatch(/not clearly better/);
    // The card the visitor just read is not an alternative.
    expect(gate(r(0.7), [r(1, { engaged: true })]).ok).toBe(true);
  });
});

describe('adapt', () => {
  test('planOrder keeps on-screen cards in place and reorders the rest', () => {
    const ranked = ['d', 'c', 'a', 'b'].map((id) => r0(id));
    const { order, moves } = planOrder(['a', 'b', 'c', 'd'], 1, ranked);
    expect(order).toEqual(['a', 'd', 'c', 'b']);
    expect(moves.map((m) => m.id).sort()).toEqual(['b', 'd']);
    expect(planOrder(['a', 'b'], 2, ranked).moves).toEqual([]);
  });

  test('headline: only with a confident profile, never while the hero shows, once', () => {
    const m = model();
    const headlines = { default: 'Default.', ml: 'ML line.', software: 'SW line.', data: 'Data line.' };
    const args = { model: m, headlines, heroVisible: false, alreadyChanged: false };
    expect(chooseHeadline(args)).toBeNull(); // nothing known yet
    for (const id of fx.ids('data').slice(0, 3)) m.apply({ kind: 'expand', itemId: id });
    expect(chooseHeadline({ ...args, heroVisible: true })).toBeNull();
    expect(chooseHeadline({ ...args, alreadyChanged: true })).toBeNull();
    const c = chooseHeadline(args)!;
    expect(c.axis).toBe('data');
    expect(c.text).toBe('Data line.');
    expect(c.reason).toMatch(/interest in data/);
  });

  test('reading depth', () => {
    const m = model();
    expect(readingDepth(m)).toBe('normal');
    m.apply({ kind: 'dwell', itemId: 'ml-0', seconds: 25 });
    m.apply({ kind: 'dwell', itemId: 'ml-1', seconds: 25 });
    expect(readingDepth(m)).toBe('deep');
  });

  test('skimmer: fast scrolling and short reads early on', () => {
    expect(isSkimmer({ elapsedMs: 15_000, fastScrolls: 3, maxDwellSec: 2 })).toBe(true);
    expect(isSkimmer({ elapsedMs: 15_000, fastScrolls: 3, maxDwellSec: 8 })).toBe(false);
    expect(isSkimmer({ elapsedMs: 15_000, fastScrolls: 1, maxDwellSec: 0 })).toBe(false);
    expect(isSkimmer({ elapsedMs: 60_000, fastScrolls: 9, maxDwellSec: 0 })).toBe(false);
  });
});

function r0(id: string): Ranked {
  return { id, sim: 0, sample: 0, score: 0, engaged: false, seen: false, penalized: false };
}
