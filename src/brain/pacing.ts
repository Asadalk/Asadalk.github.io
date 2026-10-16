// Pacing: when the site may suggest something, and when it must stay quiet.
//
// State machine:  Active ──show──▶ Cooldown ──time passes──▶ Active
//                    │                 │
//                    └── budget 0, or two misses in a row, or 0% accepted ──▶ Quiet
// Quiet is left only when the visitor's interests have clearly moved since the
// last suggestion (drift) AND a candidate passes the confidence gate; the
// budget is then 1 and never more.
//
// All times are "active time" in ms from ActiveClock: idle stretches (no
// input for 30 s) and hidden tabs never count. No real timers live here.
import type { Axis, Vec } from './types';
import { cosineDistance } from './vector';

export interface PacingConfig {
  initialBudget: number;
  maxBudget: number;
  baseCooldownMs: number;
  /** Base cooldown once ≥50% of ≥2 suggestions were accepted. */
  fastCooldownMs: number;
  /** Cooldown never grows past this (45 → 90 → 180 s). */
  maxCooldownMs: number;
  /** A shown suggestion left untouched this long counts as ignored. */
  ignoreAfterMs: number;
  hardCap: number;
  /** Reading needed before a collapse counts as a moment. */
  minReadMs: number;
  /** Cosine distance recent interest must move before Quiet can end. */
  drift: number;
  /** Signals since the last suggestion needed before drift is measured. */
  minRecent: number;
}

export const DEFAULT_PACING: PacingConfig = {
  initialBudget: 2,
  maxBudget: 3,
  baseCooldownMs: 45_000,
  fastCooldownMs: 30_000,
  maxCooldownMs: 180_000,
  ignoreAfterMs: 20_000,
  hardCap: 6,
  minReadMs: 10_000,
  drift: 0.5,
  minRecent: 6,
};

export type Mode = 'active' | 'cooldown' | 'quiet';

export interface Shown {
  itemId: string;
  topic: Axis;
  at: number;
}

export interface PacingState {
  mode: Mode;
  budget: number;
  maxBudget: number;
  baseCooldownMs: number;
  cooldownMs: number;
  cooldownUntil: number;
  shown: number;
  accepted: number;
  missed: number;
  /** Misses (ignored or dismissed) since the last acceptance. */
  streak: number;
  current: Shown | null;
  /** Interest profile when the last suggestion was shown (for drift). */
  lastProfile: Vec | null;
  penalties: Axis[];
  suggested: string[];
  /** Why the site went quiet, for the panel. */
  quietReason: string | null;
  /** Times Quiet was left this session (at most once). */
  quietExits: number;
}

export const initialPacing = (cfg: PacingConfig = DEFAULT_PACING): PacingState => ({
  mode: 'active',
  budget: cfg.initialBudget,
  maxBudget: cfg.maxBudget,
  baseCooldownMs: cfg.baseCooldownMs,
  cooldownMs: cfg.baseCooldownMs,
  cooldownUntil: 0,
  shown: 0,
  accepted: 0,
  missed: 0,
  streak: 0,
  current: null,
  lastProfile: null,
  penalties: [],
  suggested: [],
  quietReason: null,
  quietExits: 0,
});

/** The moments a suggestion may appear at. */
export type MomentKind = 'card-collapsed' | 'section-end' | 'demo-closed' | 'ask-viewed';

export interface Moment {
  kind: MomentKind;
  /** For 'card-collapsed': active ms the card was read before collapsing. */
  readMs?: number;
  scrolling?: boolean;
  demoRunning?: boolean;
  inputFocused?: boolean;
  textSelected?: boolean;
  /** An expanded card is on screen and its dwell is still growing. */
  growingDwell?: boolean;
  hidden?: boolean;
  idle?: boolean;
}

export interface Verdict {
  ok: boolean;
  reason: string;
}

const secs = (ms: number) => `${Math.round(ms / 1000)} s`;

/** Is this a moment where a suggestion would not interrupt? */
export function momentAllowed(m: Moment, cfg: PacingConfig = DEFAULT_PACING): Verdict {
  if (m.hidden) return { ok: false, reason: 'the tab is hidden' };
  if (m.idle) return { ok: false, reason: 'you seem to be away' };
  if (m.scrolling) return { ok: false, reason: 'you are scrolling' };
  if (m.demoRunning) return { ok: false, reason: 'a demo is running' };
  if (m.inputFocused) return { ok: false, reason: 'you are typing' };
  if (m.textSelected) return { ok: false, reason: 'you have text selected' };
  if (m.growingDwell) return { ok: false, reason: 'you are still reading' };
  if (m.kind === 'card-collapsed' && (m.readMs ?? 0) < cfg.minReadMs)
    return { ok: false, reason: `the card was read for under ${secs(cfg.minReadMs)}` };
  return { ok: true, reason: `a natural pause (${m.kind.replace('-', ' ')})` };
}

export class Pacer {
  constructor(
    public state: PacingState = initialPacing(),
    readonly cfg: PacingConfig = DEFAULT_PACING,
  ) {}

  /** Mode at active time t (cooldown expires on its own). */
  mode(t: number): Mode {
    const s = this.state;
    if (s.mode === 'cooldown' && t >= s.cooldownUntil && !s.current) s.mode = 'active';
    return s.mode;
  }

  /** Can a suggestion be shown now, pacing-wise? (Moment and gate are checked elsewhere.) */
  canShow(t: number): Verdict {
    const s = this.state;
    const mode = this.mode(t);
    if (s.current) return { ok: false, reason: 'a suggestion is already showing' };
    if (s.shown >= this.cfg.hardCap) return { ok: false, reason: `the session cap of ${this.cfg.hardCap} was reached` };
    if (mode === 'quiet') return { ok: false, reason: `quiet mode: ${s.quietReason ?? 'resting'}` };
    if (s.budget <= 0) return { ok: false, reason: 'no suggestion budget left' };
    if (mode === 'cooldown') return { ok: false, reason: `cooling down for ${secs(s.cooldownUntil - t)} more` };
    return { ok: true, reason: 'budget and cooldown allow it' };
  }

  /**
   * Drift: cosine distance between the profile when the last suggestion was
   * shown and the direction of what was engaged with since then. Comparing
   * against recent engagement (not the slowly moving profile) separates "learned
   * a bit more" from "now interested in something else". Needs `minRecent`
   * signals; otherwise 0.
   */
  drift(recent: { v: Vec | null; n: number } | null): number {
    const last = this.state.lastProfile;
    if (!last || !recent?.v || recent.n < this.cfg.minRecent) return 0;
    return cosineDistance(recent.v, last);
  }

  /**
   * Try to leave Quiet. Both conditions are required: the visitor's recent
   * interest moved more than cfg.drift away from the last suggestion's profile,
   * and a candidate passed the confidence gate.
   */
  tryLeaveQuiet(recent: { v: Vec | null; n: number } | null, gatePassed: boolean): Verdict {
    const s = this.state;
    if (s.mode !== 'quiet') return { ok: false, reason: 'not quiet' };
    if (s.shown >= this.cfg.hardCap) return { ok: false, reason: 'session cap reached' };
    if (s.quietExits >= 1) return { ok: false, reason: 'I already came back once this visit' };
    const d = this.drift(recent);
    if (!(d > this.cfg.drift))
      return { ok: false, reason: `your interests have not moved enough (${d.toFixed(2)} ≤ ${this.cfg.drift})` };
    if (!gatePassed) return { ok: false, reason: 'interests moved, but nothing fits clearly enough' };
    s.mode = 'active';
    s.quietExits += 1;
    s.budget = 1;
    s.maxBudget = 1;
    s.streak = 0;
    s.cooldownMs = s.baseCooldownMs;
    s.quietReason = null;
    return { ok: true, reason: `your interests moved (${d.toFixed(2)}) and one item fits clearly` };
  }

  show(t: number, itemId: string, topic: Axis, profile: Vec | null): void {
    const s = this.state;
    s.budget -= 1;
    s.shown += 1;
    s.current = { itemId, topic, at: t };
    s.lastProfile = profile ? profile.slice() : null;
    s.suggested.push(itemId);
    s.mode = 'cooldown';
    s.cooldownUntil = Infinity; // starts when the suggestion resolves
  }

  /** Has the current suggestion sat untouched long enough to count as ignored? */
  expired(t: number): boolean {
    const c = this.state.current;
    return !!c && t - c.at >= this.cfg.ignoreAfterMs;
  }

  accept(t: number): void {
    const s = this.state;
    if (!s.current) return;
    s.current = null;
    s.accepted += 1;
    s.streak = 0;
    s.budget = Math.min(s.maxBudget, s.budget + 1);
    this.applyRate();
    s.cooldownMs = s.baseCooldownMs;
    this.startCooldown(t);
  }

  ignore(t: number): void {
    this.miss(t, 2);
  }

  /** Dismissed with ×: triple the cooldown and penalize the topic for the session. */
  dismiss(t: number): Axis | null {
    const topic = this.state.current?.topic ?? null;
    if (topic && !this.state.penalties.includes(topic)) this.state.penalties.push(topic);
    this.miss(t, 3);
    return topic;
  }

  private miss(t: number, factor: number): void {
    const s = this.state;
    if (!s.current) return;
    s.current = null;
    s.missed += 1;
    s.streak += 1;
    s.cooldownMs = Math.min(this.cfg.maxCooldownMs, s.cooldownMs * factor);
    this.applyRate();
    this.startCooldown(t);
  }

  private applyRate(): void {
    const s = this.state;
    const resolved = s.accepted + s.missed;
    if (resolved >= 2 && s.accepted / resolved >= 0.5) s.baseCooldownMs = this.cfg.fastCooldownMs;
  }

  private startCooldown(t: number): void {
    const s = this.state;
    s.cooldownUntil = t + s.cooldownMs;
    s.mode = 'cooldown';
    const resolved = s.accepted + s.missed;
    if (s.streak >= 2) this.goQuiet(`you skipped my last ${s.streak} suggestions`);
    else if (resolved >= 2 && s.accepted === 0) this.goQuiet('none of my suggestions were useful');
    else if (s.budget <= 0) this.goQuiet('I have used up my suggestions for now');
  }

  private goQuiet(reason: string): void {
    this.state.mode = 'quiet';
    this.state.quietReason = reason;
  }
}

/**
 * Active time: wall-clock time minus idle stretches and hidden-tab time.
 * Fed by the DOM adapter (input, visibility); read with now().
 */
export class ActiveClock {
  private active = 0;
  private last: number;
  private lastInput: number;
  private visible = true;

  constructor(
    private readonly wall: () => number,
    readonly idleAfterMs = 30_000,
  ) {
    this.last = wall();
    this.lastInput = this.last;
  }

  private advance(): number {
    const t = this.wall();
    if (this.visible) {
      // Only the part of [last, t] before going idle counts.
      const until = Math.min(t, this.lastInput + this.idleAfterMs);
      if (until > this.last) this.active += until - this.last;
    }
    this.last = t;
    return t;
  }

  /** Any user input (scroll, pointer, key, touch). */
  input(): void {
    const t = this.advance();
    this.lastInput = t;
  }

  setVisible(v: boolean): void {
    const t = this.advance();
    this.visible = v;
    if (v) this.lastInput = t; // coming back counts as input
  }

  idle(): boolean {
    return !this.visible || this.wall() - this.lastInput >= this.idleAfterMs;
  }

  isVisible(): boolean {
    return this.visible;
  }

  now(): number {
    this.advance();
    return this.active;
  }
}
