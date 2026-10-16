// Five simulated visitors drive the whole brain with a fake clock.
import { describe, expect, test } from 'vitest';
import { Brain, type Suggestion } from '../../../src/brain/index';
import { memoryKV } from '../../../src/brain/persist';
import { seeded } from '../../../src/brain/rng';
import { FakeWall, makeFixture } from '../fixtures/items';

const fx = makeFixture({ perCluster: 12 });

function visit(seed = 1) {
  const wall = new FakeWall();
  const rng = seeded(seed);
  const brain = new Brain({
    items: fx.inputs,
    embeddings: fx.embeddings,
    curated: fx.inputs.map((i) => i.id),
    wall: wall.now,
    rng,
    local: memoryKV(),
    session: memoryKV(),
  });
  const shown: Suggestion[] = [];
  const expired: string[] = [];
  /** Let time pass; an active visitor makes some input every 5 s. */
  const spend = (sec: number, active = true) => {
    for (let i = 0; i < sec; i++) {
      wall.advance(1000);
      if (active && i % 5 === 0) brain.input();
      if (brain.tick() === 'expired') expired.push(shown[shown.length - 1].itemId);
    }
  };
  /** Open a card, read it, collapse it; the collapse is a possible moment. */
  const read = (id: string, sec = 15): Suggestion | null => {
    brain.input();
    brain.seen(id);
    brain.signal({ kind: 'expand', itemId: id });
    spend(sec);
    brain.signal({ kind: 'dwell', itemId: id, seconds: sec });
    const s = brain.moment({ kind: 'card-collapsed', readMs: sec * 1000 }, [id]);
    if (s) shown.push(s);
    return s;
  };
  const unread = (cluster: string) => fx.ids(cluster).filter((id) => !brain.model.state.items[id]?.engaged);
  const pick = (cluster: string, noise: number) => {
    const others = ['ml', 'software', 'data'].filter((c) => c !== cluster);
    const c = rng() < noise ? others[Math.floor(rng() * others.length)] : cluster;
    const pool = unread(c);
    return pool[Math.floor(rng() * pool.length)] ?? unread(cluster)[0];
  };
  return { wall, brain, shown, expired, spend, read, pick };
}

describe('simulated visitors', () => {
  // The ignorer keeps one interest (10% stray clicks). An ignorer whose reading
  // really moves to another topic may get one more, by design (see the last test).
  test('the ignorer sees at most 2 suggestions', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const v = visit(seed);
      for (let k = 0; k < 12; k++) {
        // An ignorer never opens what was suggested (that would count as accepting).
        let id = v.pick('ml', 0.1);
        for (let tries = 0; id && v.brain.pacer.state.suggested.includes(id) && tries < 20; tries++) id = v.pick('ml', 0.1);
        if (!id || v.brain.pacer.state.suggested.includes(id)) break;
        v.read(id);
        v.spend(25); // scrolls on; any suggestion goes untouched and expires
      }
      expect(v.shown.length).toBeLessThanOrEqual(2);
      expect(v.brain.pacer.state.mode).toBe('quiet');
      expect(v.brain.suggestionState()).toMatch(/Quiet mode: you skipped my last two suggestions/);
    }
  });

  test('a reader who dwells and never scrolls is never interrupted', () => {
    const v = visit();
    const id = 'ml-0';
    v.brain.seen(id);
    v.brain.signal({ kind: 'expand', itemId: id });
    for (let k = 0; k < 60; k++) {
      v.spend(10);
      v.brain.signal({ kind: 'dwell', itemId: id, seconds: 10 });
      // The only moments that could arise while the card stays open:
      const s = v.brain.moment({ kind: 'section-end', growingDwell: true }, [id]);
      if (s) v.shown.push(s);
    }
    expect(v.shown).toHaveLength(0);
    expect(v.brain.log.entries.some((e) => e.text.includes('you are still reading'))).toBe(true);
  });

  test('an idle visitor gets nothing, and idle time does not count', () => {
    const v = visit();
    v.brain.signal({ kind: 'signboard', itemIds: v.pick('ml', 0) ? ['ml-0', 'ml-1'] : [] });
    v.brain.signal({ kind: 'expand', itemId: 'ml-2' });
    v.spend(30, false); // the visitor walks away
    for (let k = 0; k < 60; k++) {
      v.spend(10, false); // no input at all for 10 more minutes
      const s = v.brain.moment({ kind: 'section-end' }, []);
      if (s) v.shown.push(s);
    }
    expect(v.shown).toHaveLength(0);
    expect(v.brain.activeMs()).toBeLessThanOrEqual(30_000);
    // A hidden tab is never a moment either.
    v.brain.input();
    v.brain.setVisible(false);
    expect(v.brain.moment({ kind: 'demo-closed' }, [])).toBeNull();
  });

  test('the engager gets helpful suggestions, never more than 6', () => {
    for (const seed of [1, 2, 3]) {
      const v = visit(seed);
      let next: string | null = null;
      for (let k = 0; k < 40; k++) {
        const id = next ?? v.pick('ml', 0.2);
        if (!id) break;
        if (next) v.brain.resolve('accepted');
        const s = v.read(id, 20);
        next = s && fx.clusterOf[s.itemId] === 'ml' ? s.itemId : null;
        v.spend(10);
      }
      expect(v.shown.length).toBeGreaterThanOrEqual(3);
      expect(v.shown.length).toBeLessThanOrEqual(6);
      // Helpful: every suggestion is on the visitor's real topic.
      for (const s of v.shown) expect(fx.clusterOf[s.itemId]).toBe('ml');
      expect(v.shown[0].text).toMatch(/^Liked .+\? → /);
    }
  });

  test('the hard cap holds even for an endless engager', () => {
    const v = visit(9);
    for (let k = 0; k < 36; k++) {
      const s = v.read(v.pick('ml', 0) ?? 'ml-0', 20);
      if (s) {
        v.brain.resolve('accepted');
        v.read(s.itemId, 20);
      }
      v.spend(40);
    }
    expect(v.shown.length).toBeLessThanOrEqual(6);
  });

  test('a visitor who changes interests gets exactly one new suggestion after Quiet', () => {
    const v = visit(4);
    for (let k = 0; k < 8 && v.brain.pacer.state.mode !== 'quiet'; k++) {
      v.read(v.pick('ml', 0));
      v.spend(25);
    }
    expect(v.brain.pacer.state.mode).toBe('quiet');
    const before = v.shown.length;
    // Same interest for a while: still quiet.
    for (let k = 0; k < 3; k++) {
      v.read(v.pick('ml', 0));
      v.spend(25);
    }
    expect(v.shown.length).toBe(before);
    // Now the visitor gets into data work.
    for (let k = 0; k < 10; k++) {
      v.read(v.pick('data', 0));
      v.spend(25);
    }
    const after = v.shown.slice(before);
    expect(after).toHaveLength(1);
    expect(fx.clusterOf[after[0].itemId]).toBe('data');
    expect(v.brain.log.entries.some((e) => e.kind === 'quiet' && e.text.startsWith('Left quiet mode'))).toBe(true);
  });

  test('every decision carries a plain-English reason', () => {
    const v = visit(2);
    for (let k = 0; k < 6; k++) {
      v.read(v.pick('software', 0.2));
      v.spend(25);
    }
    expect(v.brain.log.entries.length).toBeGreaterThan(0);
    for (const e of v.brain.log.entries) {
      expect(e.text).toMatch(/^[A-Z].+[.]$/);
      expect(e.text).not.toMatch(/undefined|NaN|null/);
    }
  });
});
