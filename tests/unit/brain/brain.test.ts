// The brain with the site's real content (axis fallback), persistence and the log.
import { describe, expect, test } from 'vitest';
import { Brain, buildItems } from '../../../src/brain/index';
import { DecisionLog } from '../../../src/brain/log';
import { LOCAL_KEY, OPENER_KEY, SESSION_KEY, clearAll, loadLocal, memoryKV, saveLocal } from '../../../src/brain/persist';
import { seeded } from '../../../src/brain/rng';
import { emptyModel } from '../../../src/brain/model';
import type { KV } from '../../../src/brain/types';
import { projects, research, site } from '../../../src/lib/content';
import { FakeWall, makeFixture } from '../fixtures/items';

const inputs = [research, ...projects].map((p) => ({ id: p.id, type: p.type, title: (p as { short?: string }).short ?? p.title, axes: p.axes }));
const curated = ['research-bstd', 'opspilot', 'semantic-hire', 'cellular', 'smoketrail'];

const make = (local: KV | null = memoryKV(), session: KV | null = memoryKV(), wall = new FakeWall()) =>
  new Brain({ items: inputs, curated, headlines: site.headlines, wall: wall.now, rng: seeded(1), local, session });

const throwing: KV = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

describe('real content', () => {
  test('falls back to the 5 axes when embeddings are missing or partial', () => {
    expect(buildItems(inputs, null).space).toBe('axes');
    expect(buildItems(inputs, { opspilot: new Array(384).fill(0.1) }).space).toBe('axes');
    const full = Object.fromEntries(inputs.map((i, k) => [i.id, Array.from({ length: 384 }, (_, j) => Math.sin(j + k))]));
    const b = buildItems(inputs, full);
    expect(b.space).toBe('embedding');
    expect(b.items[0].vector).toHaveLength(384);
    expect(b.items.find((i) => i.id === 'research-bstd')!.topic).toBe('research');
  });

  test('opener chip "Hiring for ML" puts semantic-hire first among the projects', () => {
    const b = make();
    const chip = site.openerChips[0];
    b.signal({ kind: 'opener', label: chip.label, axesBoost: chip.boost });
    const { order, moves } = b.planReorder(['opspilot', 'semantic-hire', 'cellular', 'smoketrail'], 0);
    expect(order[0]).toBe('semantic-hire');
    expect(moves.length).toBeGreaterThan(0);
    expect(b.log.recent(1)[0].text).toBe('Moved semantic-hire up because you picked "Hiring for ML".');
  });

  test('the opener order is robust to Thompson sampling noise', () => {
    const chips = site.openerChips;
    const tally: Record<string, Record<string, number>> = {};
    for (let seed = 1; seed <= 100; seed++) {
      for (const c of chips.slice(0, 3)) {
        const b = new Brain({ items: inputs, curated, wall: () => 0, rng: seeded(seed), local: null, session: null });
        b.signal({ kind: 'opener', label: c.label, axesBoost: c.boost });
        const top = b.planReorder(['opspilot', 'semantic-hire', 'cellular', 'smoketrail'], 0).order[0];
        (tally[c.label] ??= {})[top] = (tally[c.label][top] ?? 0) + 1;
      }
    }
    expect(tally['Hiring for ML']['semantic-hire']).toBeGreaterThanOrEqual(90);
    expect((tally['Software']['opspilot'] ?? 0) + (tally['Software']['cellular'] ?? 0)).toBeGreaterThanOrEqual(90);
    expect(tally['Data']['smoketrail']).toBeGreaterThanOrEqual(90);
  });

  test('"Software" puts a systems project first; on-screen cards never move', () => {
    const b = make();
    b.signal({ kind: 'opener', label: 'Software', axesBoost: { software: 1 } });
    const { order } = b.planReorder(['opspilot', 'semantic-hire', 'cellular', 'smoketrail'], 0);
    expect(['opspilot', 'cellular']).toContain(order[0]);
    const fixed = b.planReorder(['smoketrail', 'semantic-hire', 'opspilot', 'cellular'], 2);
    expect(fixed.order.slice(0, 2)).toEqual(['smoketrail', 'semantic-hire']);
  });

  test('"Just exploring" keeps the curated order', () => {
    const b = make();
    b.signal({ kind: 'opener', label: 'Just exploring', axesBoost: {} });
    expect(b.planReorder(['opspilot', 'semantic-hire', 'cellular', 'smoketrail'], 0).moves).toEqual([]);
  });

  test('explanations name real time spent', () => {
    const b = make();
    b.signal({ kind: 'expand', itemId: 'cellular' });
    b.signal({ kind: 'dwell', itemId: 'cellular', seconds: 40 });
    b.planReorder(['semantic-hire', 'smoketrail', 'opspilot'], 0);
    expect(b.log.recent(1)[0].text).toBe('Moved OpsPilot up because you spent 40 s on systems content.');
  });

  test('real content: reading a systems project can earn one well-founded suggestion', () => {
    const wall = new FakeWall();
    const b = make(memoryKV(), memoryKV(), wall);
    const got: string[] = [];
    for (const id of ['cellular']) {
      b.input();
      b.seen(id);
      b.signal({ kind: 'expand', itemId: id });
      wall.advance(15_000);
      b.input();
      b.signal({ kind: 'dwell', itemId: id, seconds: 15 });
      const s = b.moment({ kind: 'card-collapsed', readMs: 15_000 }, [id]);
      if (s) got.push(s.itemId);
    }
    expect(got).toEqual(['opspilot']);
  });

  test('headline changes once, never while the hero is on screen', () => {
    const b = make();
    for (const id of ['cellular', 'opspilot', 'cellular']) b.signal({ kind: 'expand', itemId: id });
    expect(b.headline(true)).toBeNull();
    expect(b.headline(false)!.text).toBe(site.headlines.software);
    expect(b.headline(false)).toBeNull();
  });

  test('snapshot for the panel', () => {
    const b = make();
    expect(b.snapshot().coldStart).toBe(true);
    expect(b.snapshot().suggestionState).toMatch(/none yet/);
    b.signal({ kind: 'expand', itemId: 'research-bstd' });
    const s = b.snapshot();
    expect(s.axes.research).toBeCloseTo(1);
    expect(s.space).toBe('axes');
    expect(s.suggestionState).toMatch(/up to two more/);
  });
});

describe('persistence', () => {
  test('state survives a reload; pacing state is per session', () => {
    const local = memoryKV();
    const session = memoryKV();
    const a = make(local, session);
    a.signal({ kind: 'expand', itemId: 'opspilot' });
    expect(local.data.has(LOCAL_KEY)).toBe(true);
    expect(session.data.has(SESSION_KEY)).toBe(true);
    const b = make(local, session);
    expect(b.model.state.interest).toEqual(a.model.state.interest);
    const c = make(local, memoryKV()); // new session, same browser
    expect(c.model.state.updates).toBe(1);
    expect(c.pacer.state.shown).toBe(0);
  });

  test('throwing or missing storage means a silent cold start', () => {
    expect(() => make(throwing, throwing).signal({ kind: 'expand', itemId: 'opspilot' })).not.toThrow();
    expect(make(throwing, throwing).model.state.interest).toBeNull();
    expect(() => make(null, null).reset()).not.toThrow();
    expect(() => clearAll(throwing, throwing)).not.toThrow();
  });

  test('garbage or an old version is ignored', () => {
    const kv = memoryKV();
    kv.setItem(LOCAL_KEY, '{not json');
    expect(loadLocal(kv)).toBeNull();
    kv.setItem(LOCAL_KEY, JSON.stringify({ version: 0, model: emptyModel(), log: [] }));
    expect(loadLocal(kv)).toBeNull();
    expect(saveLocal(kv, { model: emptyModel(), log: [] })).toBe(true);
    expect(loadLocal(kv)).not.toBeNull();
  });

  test('stored vectors of another size are dropped (e.g. embeddings appeared)', () => {
    const local = memoryKV();
    make(local).signal({ kind: 'expand', itemId: 'opspilot' }); // 5-d profile saved
    const full = Object.fromEntries(inputs.map((i, k) => [i.id, Array.from({ length: 384 }, (_, j) => Math.cos(j * (k + 1)))]));
    const b = new Brain({ items: inputs, embeddings: full, curated, wall: () => 0, rng: seeded(1), local, session: memoryKV() });
    expect(b.model.state.interest).toBeNull();
    expect(b.model.state.axes).toHaveLength(5);
  });

  test('reset forgets everything', () => {
    const local = memoryKV();
    const session = memoryKV();
    local.setItem(OPENER_KEY, '1');
    const b = make(local, session);
    b.signal({ kind: 'expand', itemId: 'opspilot' });
    b.reset();
    expect(local.data.size).toBe(0);
    expect(session.data.size).toBe(0);
    expect(b.model.state.interest).toBeNull();
    expect(b.snapshot().recent).toEqual([]);
  });

  test('a pending cooldown carries over to the next page view', () => {
    const fx = makeFixture({ perCluster: 4 });
    const local = memoryKV();
    const session = memoryKV();
    const wall = new FakeWall();
    const opts = { items: fx.inputs, embeddings: fx.embeddings, curated: fx.inputs.map((i) => i.id), wall: wall.now, rng: seeded(2), local, session };
    const a = new Brain(opts);
    a.signal({ kind: 'expand', itemId: 'ml-0' });
    wall.advance(15_000);
    a.input();
    const s = a.moment({ kind: 'card-collapsed', readMs: 15_000 }, ['ml-0']);
    expect(s).not.toBeNull();
    a.resolve('ignored'); // 90 s cooldown from active time 15 s
    const b = new Brain(opts);
    expect(b.pacer.state.cooldownUntil).toBe(90_000);
    expect(b.pacer.canShow(0).reason).toMatch(/cooling down/);
  });
});

describe('decision log', () => {
  test('keeps a bounded history and shows the latest visible ones first', () => {
    const log = new DecisionLog([], 5);
    for (let i = 0; i < 8; i++) log.add(i, i % 2 ? 'hold' : 'reorder', `Decision ${i}.`);
    expect(log.entries).toHaveLength(5);
    expect(log.recent(3).map((d) => d.text)).toEqual(['Decision 6.', 'Decision 4.']);
  });
});
