import { describe, expect, test } from 'vitest';
import { ActiveClock, DEFAULT_PACING, Pacer, initialPacing, momentAllowed } from '../../../src/brain/pacing';

const S = 1000;
const pacer = () => new Pacer(initialPacing(), DEFAULT_PACING);
const recent = (v: number[], n = 6) => ({ v, n });

describe('budget and cooldown', () => {
  test('starts Active with budget 2; showing costs 1 and blocks a second one', () => {
    const p = pacer();
    expect(p.canShow(0).ok).toBe(true);
    p.show(0, 'a', 'ml', [1, 0]);
    expect(p.state.budget).toBe(1);
    expect(p.canShow(1).reason).toMatch(/already showing/);
  });

  test('ignored doubles the cooldown (45 → 90 s) in active time', () => {
    const p = pacer();
    p.show(0, 'a', 'ml', [1, 0]);
    p.ignore(20 * S);
    expect(p.state.cooldownMs).toBe(90 * S);
    expect(p.mode(20 * S + 89 * S)).toBe('cooldown');
    expect(p.canShow(20 * S + 89 * S).reason).toMatch(/cooling down/);
    expect(p.mode(20 * S + 90 * S)).toBe('active');
  });

  test('cooldown doubles 45 → 90 → 180 and is capped', () => {
    const p = pacer();
    p.state.budget = 3;
    p.show(0, 'a', 'ml', null);
    p.ignore(0);
    p.state.streak = 0; // look at the cooldown alone
    p.show(100 * S, 'b', 'ml', null);
    p.ignore(100 * S);
    expect(p.state.cooldownMs).toBe(180 * S);
    p.state.streak = 0;
    p.state.mode = 'active';
    p.state.budget = 1;
    p.show(400 * S, 'c', 'ml', null);
    p.ignore(400 * S);
    expect(p.state.cooldownMs).toBe(180 * S);
  });

  test('dismissed triples the cooldown and penalizes the topic', () => {
    const p = pacer();
    p.show(0, 'a', 'data', null);
    expect(p.dismiss(S)).toBe('data');
    expect(p.state.cooldownMs).toBe(135 * S);
    expect(p.state.penalties).toEqual(['data']);
  });

  test('accepted refunds 1 (max 3) and resets the cooldown to base', () => {
    const p = pacer();
    p.show(0, 'a', 'ml', null);
    p.ignore(S);
    p.show(200 * S, 'b', 'ml', null);
    p.accept(210 * S);
    expect(p.state.budget).toBe(1);
    // Reset to base; 1 of 2 accepted (50%) also lowers the base to 30 s.
    expect(p.state.cooldownMs).toBe(30 * S);
    expect(p.state.mode).toBe('cooldown');
    const r = pacer();
    r.show(0, 'a', 'ml', null);
    r.accept(S);
    expect(r.state.cooldownMs).toBe(45 * S);
    // Budget never exceeds 3.
    const q = pacer();
    q.state.budget = 3;
    q.show(0, 'x', 'ml', null);
    q.accept(1);
    expect(q.state.budget).toBe(3);
  });

  test('≥50% accepted after ≥2 suggestions → base cooldown 30 s', () => {
    const p = pacer();
    p.show(0, 'a', 'ml', null);
    p.accept(S);
    p.show(100 * S, 'b', 'ml', null);
    p.ignore(101 * S);
    expect(p.state.baseCooldownMs).toBe(30 * S);
    p.show(400 * S, 'c', 'ml', null);
    p.accept(401 * S);
    expect(p.state.cooldownMs).toBe(30 * S);
  });

  test('budget 0 → Quiet', () => {
    const p = pacer();
    p.show(0, 'a', 'ml', null);
    p.accept(S); // budget 2
    p.show(100 * S, 'b', 'ml', null);
    p.accept(101 * S); // budget 2
    p.state.budget = 1;
    p.show(200 * S, 'c', 'ml', null);
    p.state.streak = 0;
    p.ignore(201 * S);
    expect(p.state.mode).toBe('quiet');
    expect(p.state.quietReason).toMatch(/used up/);
  });

  test('two ignored or dismissed in a row → Quiet', () => {
    const p = pacer();
    p.show(0, 'a', 'ml', null);
    p.dismiss(S);
    expect(p.state.mode).toBe('cooldown');
    p.show(200 * S, 'b', 'ml', null);
    p.ignore(201 * S);
    expect(p.state.mode).toBe('quiet');
    expect(p.canShow(10_000 * S).ok).toBe(false);
  });

  test('hard cap of 6 per session', () => {
    const p = pacer();
    for (let i = 0; i < 6; i++) {
      p.state.mode = 'active';
      p.state.budget = 3;
      p.show(i * 1000 * S, `x${i}`, 'ml', null);
      p.accept(i * 1000 * S + S);
    }
    p.state.mode = 'active';
    expect(p.canShow(1e9).reason).toMatch(/cap of 6/);
  });

  test('an untouched suggestion expires after 20 s of active time', () => {
    const p = pacer();
    p.show(5 * S, 'a', 'ml', null);
    expect(p.expired(24 * S)).toBe(false);
    expect(p.expired(25 * S)).toBe(true);
  });
});

describe('leaving Quiet', () => {
  const quiet = () => {
    const p = pacer();
    p.show(0, 'a', 'ml', [1, 0, 0]);
    p.ignore(S);
    p.show(200 * S, 'b', 'ml', [1, 0, 0]);
    p.ignore(201 * S);
    expect(p.state.mode).toBe('quiet');
    return p;
  };

  test('needs both drift and a candidate that passes the gate', () => {
    expect(quiet().tryLeaveQuiet(recent([1, 0.1, 0]), true).ok).toBe(false); // no drift
    expect(quiet().tryLeaveQuiet(recent([0, 1, 0]), false).ok).toBe(false); // drift, weak candidate
    expect(quiet().tryLeaveQuiet(recent([0, 1, 0], 2), true).ok).toBe(false); // too little evidence
    const p = quiet();
    expect(p.tryLeaveQuiet(recent([0, 1, 0]), true).ok).toBe(true);
    expect(p.state.budget).toBe(1);
    expect(p.state.maxBudget).toBe(1);
  });

  test('after leaving Quiet the budget never exceeds 1, and Quiet is left only once', () => {
    const p = quiet();
    p.tryLeaveQuiet(recent([0, 1, 0]), true);
    p.show(500 * S, 'c', 'dl', [0, 1, 0]);
    p.accept(501 * S);
    expect(p.state.budget).toBe(1);
    p.show(600 * S, 'd', 'dl', [0, 1, 0]);
    p.ignore(601 * S);
    expect(p.state.mode).toBe('quiet');
    expect(p.tryLeaveQuiet(recent([0, 0, 1]), true).reason).toMatch(/already came back once/);
  });

  test('0% accepted after 2 → Quiet even without a streak', () => {
    const p = pacer();
    p.show(0, 'a', 'ml', null);
    p.ignore(S);
    p.state.streak = 0;
    p.show(200 * S, 'b', 'ml', null);
    p.ignore(201 * S);
    expect(p.state.mode).toBe('quiet');
  });
});

describe('allowed moments', () => {
  test('calm moments are allowed', () => {
    expect(momentAllowed({ kind: 'section-end' }).ok).toBe(true);
    expect(momentAllowed({ kind: 'demo-closed' }).ok).toBe(true);
    expect(momentAllowed({ kind: 'ask-viewed' }).ok).toBe(true);
    expect(momentAllowed({ kind: 'card-collapsed', readMs: 10 * S }).ok).toBe(true);
  });

  test.each([
    [{ scrolling: true }, /scrolling/],
    [{ demoRunning: true }, /demo/],
    [{ inputFocused: true }, /typing/],
    [{ textSelected: true }, /selected/],
    [{ growingDwell: true }, /still reading/],
    [{ hidden: true }, /hidden/],
    [{ idle: true }, /away/],
  ])('never during %o', (flags, why) => {
    const v = momentAllowed({ kind: 'section-end', ...flags });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(why);
  });

  test('a card collapsed after under 10 s of reading is not a moment', () => {
    expect(momentAllowed({ kind: 'card-collapsed', readMs: 9 * S }).ok).toBe(false);
  });
});

describe('active clock', () => {
  test('idle stretches and hidden time never count', () => {
    let t = 0;
    const c = new ActiveClock(() => t, 30 * S);
    t = 10 * S;
    c.input();
    t = 100 * S; // 90 s with no input: only 30 count
    expect(c.now()).toBe(40 * S);
    expect(c.idle()).toBe(true);
    c.input();
    expect(c.idle()).toBe(false);
    c.setVisible(false);
    t = 200 * S;
    expect(c.now()).toBe(40 * S);
    expect(c.idle()).toBe(true);
    c.setVisible(true);
    t = 205 * S;
    expect(c.now()).toBe(45 * S);
  });
});
