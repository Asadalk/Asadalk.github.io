import { describe, expect, test } from 'vitest';
import { buildItems } from '../../../src/brain/index';
import { VisitorModel, dwellValue, emaStep } from '../../../src/brain/model';
import { cosine, norm } from '../../../src/brain/vector';
import { makeFixture } from '../fixtures/items';

const fx = makeFixture({ perCluster: 6 });
const make = (alpha = 0.25, useAxes = false) => {
  const { items } = buildItems(fx.inputs, useAxes ? null : fx.embeddings);
  return new VisitorModel(items, { alpha, dwellEngagedSec: 10 });
};

describe('EMA step', () => {
  test('first positive signal sets the profile; negatives alone do nothing', () => {
    expect(emaStep(null, [3, 4], 0.2)).toEqual([0.6, 0.8]);
    expect(emaStep(null, [3, 4], -0.2)).toBeNull();
  });

  test('moves toward the new vector by w and stays unit length', () => {
    const p = emaStep([1, 0], [0, 1], 0.25)!;
    expect(norm(p)).toBeCloseTo(1);
    expect(p[1] / p[0]).toBeCloseTo(0.25 / 0.75);
  });

  test('negative weight pushes away; non-negative mode clamps', () => {
    const p = emaStep([0.8, 0.6], [0, 1], -0.3)!;
    expect(p[1]).toBeLessThan(0.6);
    const q = emaStep([1, 0.1], [0, 1], -0.5, true)!;
    expect(Math.min(...q)).toBeGreaterThanOrEqual(0);
  });
});

describe('dwell', () => {
  test('log-scaled and capped at 60 s', () => {
    expect(dwellValue(0)).toBe(0);
    expect(dwellValue(60)).toBeCloseTo(1);
    expect(dwellValue(600)).toBeCloseTo(1);
    // Diminishing returns: the first 10 s are worth more than the next 10 s.
    expect(dwellValue(10) - dwellValue(0)).toBeGreaterThan(dwellValue(20) - dwellValue(10));
  });

  test('reading past 60 s on one card adds nothing; 10 s counts as engagement', () => {
    const m = make();
    const id = fx.ids('ml')[0];
    expect(m.apply({ kind: 'dwell', itemId: id, seconds: 8 })).toBeGreaterThan(0);
    expect(m.stats(id).engaged).toBe(0);
    m.apply({ kind: 'dwell', itemId: id, seconds: 4 });
    expect(m.stats(id).engaged).toBe(1);
    m.apply({ kind: 'dwell', itemId: id, seconds: 60 });
    expect(m.apply({ kind: 'dwell', itemId: id, seconds: 30 })).toBe(0);
    expect(m.stats(id).dwell).toBe(102);
  });
});

describe('visitor model', () => {
  test('profile follows engagement and stays normalized', () => {
    const m = make();
    for (const id of fx.ids('software').slice(0, 4)) m.apply({ kind: 'expand', itemId: id });
    const p = m.state.interest!;
    expect(norm(p)).toBeCloseTo(1);
    expect(cosine(p, fx.centers.software)).toBeGreaterThan(0.7);
    expect(cosine(p, fx.centers.ml)).toBeLessThan(0.2);
    expect(m.dominant()!.axis).toBe('software');
    expect(m.state.updates).toBe(4);
  });

  test('stronger signals move the profile further', () => {
    const base = () => {
      const m = make();
      m.apply({ kind: 'expand', itemId: fx.ids('ml')[0] });
      return m;
    };
    const target = fx.ids('data')[0];
    const a = base();
    a.apply({ kind: 'demo', itemId: target });
    const b = base();
    b.apply({ kind: 'signboard', itemIds: [target] });
    expect(cosine(a.state.interest!, fx.embeddings[target])).toBeGreaterThan(cosine(b.state.interest!, fx.embeddings[target]));
  });

  test('fast scroll is a weak negative, skipped for engaged items', () => {
    const m = make();
    const [x, y] = fx.ids('ml');
    m.apply({ kind: 'expand', itemId: x });
    const w = m.apply({ kind: 'fast-scroll', itemId: y });
    expect(w).toBeLessThan(0);
    expect(w).toBeGreaterThan(-0.1);
    expect(m.apply({ kind: 'fast-scroll', itemId: x })).toBe(0);
  });

  test('ask: the query vector is the signal; results feed the axis profile', () => {
    const m = make();
    m.apply({ kind: 'ask', vector: fx.centers.data, itemIds: fx.ids('data').slice(0, 2) });
    expect(cosine(m.state.interest!, fx.centers.data)).toBeCloseTo(1);
    expect(m.dominant()!.axis).toBe('data');
  });

  test('ask with a vector from another space falls back to the result items', () => {
    const m = make(0.25, true); // 5-d axis space
    m.apply({ kind: 'ask', vector: fx.centers.data, itemIds: fx.ids('data').slice(0, 2) });
    expect(m.state.interest!.length).toBe(5);
    expect(m.dominant()!.axis).toBe('data');
  });

  test('opener chip: a boost moves both profiles; "Just exploring" does not', () => {
    const m = make();
    expect(m.apply({ kind: 'opener', label: 'Just exploring', axesBoost: {} })).toBe(0);
    expect(m.state.interest).toBeNull();
    expect(m.state.opener).toBe('Just exploring');
    m.apply({ kind: 'opener', label: 'Software', axesBoost: { software: 1 } });
    expect(m.dominant()!.axis).toBe('software');
    expect(cosine(m.state.interest!, fx.centers.software)).toBeGreaterThan(cosine(m.state.interest!, fx.centers.ml));
  });

  test('recent window accumulates and resets', () => {
    const m = make();
    m.apply({ kind: 'expand', itemId: fx.ids('ml')[0] });
    m.apply({ kind: 'expand', itemId: fx.ids('ml')[1] });
    expect(m.state.recent.n).toBe(2);
    m.resetRecent();
    expect(m.state.recent).toEqual({ v: null, n: 0 });
  });

  test('axes for display are scaled to max 1, zeros at cold start', () => {
    const m = make();
    expect(m.axesForDisplay()).toEqual([0, 0, 0, 0, 0]);
    m.apply({ kind: 'expand', itemId: fx.ids('ml')[0] });
    expect(Math.max(...m.axesForDisplay())).toBeCloseTo(1);
  });
});
