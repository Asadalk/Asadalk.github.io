// The brain: a small, explainable recommender that runs in the browser.
// Pure TypeScript; time, randomness, storage and vectors are all injected so
// tests can simulate whole visits. The only DOM code is in dom.ts.
import { AXES, AXIS_LABEL, type Axis, type BrainItem, type Clock, type ItemInput, type KV, type Rng, type Signal, type Vec } from './types';
import { DEFAULT_MODEL_CONFIG, VisitorModel, type ModelConfig } from './model';
import { DEFAULT_RANK_CONFIG, gate, meanPairCosine, rank, type RankConfig, type Ranked } from './ranking';
import { ActiveClock, DEFAULT_PACING, Pacer, initialPacing, momentAllowed, type Moment, type PacingConfig } from './pacing';
import { chooseHeadline, isSkimmer, planOrder, readingDepth, type HeadlineChoice, type Move, type SkimInput } from './adapt';
import { DecisionLog, because, type Decision } from './log';
import { clearAll, loadLocal, loadSession, saveLocal, saveSession } from './persist';
import { argmax, normalize } from './vector';

export * from './types';
export type { Ranked } from './ranking';
export type { Moment, MomentKind } from './pacing';
export type { Decision } from './log';
export type { HeadlineChoice, Move } from './adapt';

/** Attach vectors. Embeddings are used only if every item has one of the same size; otherwise all use the 5 axes. */
export function buildItems(inputs: ItemInput[], embeddings?: Record<string, Vec> | null): { items: BrainItem[]; space: 'embedding' | 'axes' } {
  const dims = new Set(inputs.map((i) => embeddings?.[i.id]?.length ?? 0));
  const useEmb = !!embeddings && dims.size === 1 && !dims.has(0);
  const items = inputs.map((i): BrainItem => {
    const axes = AXES.map((a) => i.axes[a] ?? 0);
    // Ties go to the later axis, so the research card's topic is "research", not "dl".
    const topic = AXES[argmax(axes)];
    return { id: i.id, type: i.type, title: i.title, axes, vector: normalize(useEmb ? embeddings![i.id] : axes), topic };
  });
  return { items, space: useEmb ? 'embedding' : 'axes' };
}

export interface BrainOptions {
  items: ItemInput[];
  embeddings?: Record<string, Vec> | null;
  /** Owner's cold-start order, research first. */
  curated: string[];
  headlines?: Partial<Record<Axis | 'default', string>>;
  /** Wall clock in ms. */
  wall: Clock;
  rng: Rng;
  local?: KV | null;
  session?: KV | null;
  model?: Partial<ModelConfig>;
  rank?: Partial<RankConfig>;
  pacing?: Partial<PacingConfig>;
  idleAfterMs?: number;
}

export interface Suggestion {
  itemId: string;
  title: string;
  likedTitle: string | null;
  text: string;
  reason: string;
}

export interface Snapshot {
  /** Axis profile scaled so the largest is 1; zeros at cold start. */
  axes: Record<Axis, number>;
  recent: Decision[];
  suggestionState: string;
  mode: string;
  space: 'embedding' | 'axes';
  coldStart: boolean;
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class Brain {
  readonly items: BrainItem[];
  readonly space: 'embedding' | 'axes';
  readonly clock: ActiveClock;
  model: VisitorModel;
  pacer: Pacer;
  log: DecisionLog;
  private mu: number;
  private cache: Ranked[] | null = null;
  private seenThisView = new Set<string>();
  private lastTop: string | null = null;
  flags = { headlineChanged: false, skimmerOffered: false, depthApplied: false };

  private readonly modelCfg: ModelConfig;
  private readonly rankCfg: RankConfig;
  private readonly pacingCfg: PacingConfig;

  constructor(private readonly o: BrainOptions) {
    const built = buildItems(o.items, o.embeddings);
    this.items = built.items;
    this.space = built.space;
    this.mu = meanPairCosine(this.items);
    this.modelCfg = { ...DEFAULT_MODEL_CONFIG, ...o.model };
    this.rankCfg = { ...DEFAULT_RANK_CONFIG, ...o.rank };
    this.pacingCfg = { ...DEFAULT_PACING, ...o.pacing };
    this.clock = new ActiveClock(o.wall, o.idleAfterMs ?? 30_000);

    const local = loadLocal(o.local ?? null);
    this.model = new VisitorModel(this.items, this.modelCfg, local ? this.sanitize(local.model) : undefined);
    this.log = new DecisionLog(local?.log ?? []);
    const session = loadSession(o.session ?? null);
    const pacing = session?.pacing ?? initialPacing(this.pacingCfg);
    // Pacing times are active ms of the previous page view: rebase them.
    pacing.current = null;
    if (session) pacing.cooldownUntil = Math.max(0, pacing.cooldownUntil - (session.activeAt ?? 0));
    this.pacer = new Pacer(pacing, this.pacingCfg);
    if (session) this.flags = { headlineChanged: session.headlineChanged, skimmerOffered: session.skimmerOffered, depthApplied: session.depthApplied };
  }

  /** Drop stored state that does not fit the current items (e.g. vectors changed size). */
  private sanitize(m: VisitorModel['state']): VisitorModel['state'] {
    const dim = this.items[0]?.vector.length ?? 0;
    if (m.interest && m.interest.length !== dim) m.interest = null;
    if (m.axes && m.axes.length !== AXES.length) m.axes = null;
    m.items ??= {};
    if (!m.recent || (m.recent.v && m.recent.v.length !== dim)) m.recent = { v: null, n: 0 };
    return m;
  }

  private now(): number {
    return this.clock.now();
  }

  save(): void {
    saveLocal(this.o.local ?? null, { model: this.model.state, log: this.log.entries });
    saveSession(this.o.session ?? null, {
      pacing: this.pacer.state,
      ...this.flags,
      activeAt: this.now(),
    });
  }

  private decide(kind: Decision['kind'], text: string, visible?: boolean): void {
    this.log.add(this.o.wall(), kind, text, visible);
  }

  title(id: string): string {
    return this.model.byId.get(id)?.title ?? id;
  }

  // ---- inputs -------------------------------------------------------------

  input(): void {
    this.clock.input();
  }

  setVisible(v: boolean): void {
    this.clock.setVisible(v);
  }

  isIdle(): boolean {
    return this.clock.idle();
  }

  activeMs(): number {
    return this.now();
  }

  /** A card was really on screen. Counted once per page view. */
  seen(id: string): void {
    if (this.seenThisView.has(id) || !this.model.byId.has(id)) return;
    this.seenThisView.add(id);
    this.model.markShown(id);
    this.save();
  }

  signal(s: Signal): number {
    const t = this.now();
    const w = this.model.apply(s, this.o.wall());
    if (w !== 0) this.cache = null;
    // Engaging with the suggested card counts as accepting the suggestion.
    const cur = this.pacer.state.current;
    if (cur && s.itemId === cur.itemId && (s.kind === 'expand' || s.kind === 'demo' || s.kind === 'dwell')) {
      this.pacer.accept(t);
      this.decide('outcome', `You opened ${this.title(cur.itemId)} after I suggested it, so I may suggest again.`);
    }
    if (s.kind === 'opener' && s.label) {
      this.decide('opener', w ? `Noted "${s.label}" as a starting point.` : `Noted "${s.label}": keeping the default order.`);
    }
    this.save();
    return w;
  }

  // ---- ranking and adaptation --------------------------------------------

  ranked(): Ranked[] {
    this.cache ??= rank({
      model: this.model,
      curated: this.o.curated,
      rng: this.o.rng,
      penalties: new Set(this.pacer.state.penalties),
      mu: this.mu,
      cfg: this.rankCfg,
    });
    return this.cache;
  }

  /**
   * Plan a new order for a list of cards whose first `fixed` entries are on
   * screen or above (they keep their places). Logs one plain-English line
   * when the next card changes.
   */
  planReorder(current: string[], fixed: number): { order: string[]; moves: Move[] } {
    if (!this.model.state.interest) return { order: current, moves: [] };
    const plan = planOrder(current, fixed, this.ranked());
    if (plan.moves.length) {
      const top = plan.order[fixed];
      if (top && top !== this.lastTop && current.indexOf(top) > fixed) {
        const item = this.model.byId.get(top)!;
        this.decide('reorder', `Moved ${item.title} up ${because(item, this.model)}.`);
        this.save();
      }
      this.lastTop = top ?? null;
    }
    return plan;
  }

  headline(heroVisible: boolean): HeadlineChoice | null {
    const c = chooseHeadline({
      model: this.model,
      headlines: this.o.headlines ?? {},
      heroVisible,
      alreadyChanged: this.flags.headlineChanged,
    });
    if (c) {
      this.flags.headlineChanged = true;
      this.decide('headline', c.reason);
      this.save();
    }
    return c;
  }

  /** "deep" once per session when the visitor reads long; the adapter opens the next card below the fold. */
  depth(): 'deep' | null {
    if (this.flags.depthApplied || readingDepth(this.model) !== 'deep') return null;
    this.flags.depthApplied = true;
    this.decide('depth', 'You read closely, so I opened the next project for you further down.');
    this.save();
    return 'deep';
  }

  /** One-time plain résumé offer for skimmers. */
  skimmer(input: Omit<SkimInput, 'elapsedMs'>): boolean {
    if (this.flags.skimmerOffered) return false;
    if (!isSkimmer({ ...input, elapsedMs: this.now() })) return false;
    this.flags.skimmerOffered = true;
    this.decide('skimmer', 'You were moving fast, so I offered the one-page résumé view (once).');
    this.save();
    return true;
  }

  // ---- suggestions ---------------------------------------------------------

  /**
   * A possible moment for a suggestion. Returns one only if the moment is
   * calm, pacing allows it, and a candidate passes the confidence gate.
   */
  moment(m: Moment, onScreen: string[]): Suggestion | null {
    const t = this.now();
    const hold = (why: string) => {
      this.decide('hold', `Stayed silent: ${why}.`);
      return null;
    };
    const allowed = momentAllowed({ ...m, idle: m.idle ?? this.isIdle(), hidden: m.hidden ?? !this.clock.isVisible() }, this.pacingCfg);
    if (!allowed.ok) return hold(allowed.reason);
    const profile = this.model.state.interest;
    if (!profile) return hold('I know nothing about you yet');

    const ranked = this.ranked();
    const on = new Set(onScreen);
    const onScreenR = ranked.filter((r) => on.has(r.id));
    const suggested = new Set(this.pacer.state.suggested);
    let pick: Ranked | null = null;
    let why = 'nothing left to suggest';
    for (const r of ranked) {
      if (on.has(r.id) || suggested.has(r.id) || r.engaged) continue;
      const g = gate(r, onScreenR, this.rankCfg);
      if (g.ok) {
        pick = r;
        why = g.reason;
        break;
      }
      if (why === 'nothing left to suggest') why = g.reason;
    }

    if (this.pacer.mode(t) === 'quiet') {
      const left = this.pacer.tryLeaveQuiet(this.model.state.recent, !!pick);
      if (!left.ok) return hold(left.reason);
      this.decide('quiet', `Left quiet mode: ${left.reason}.`);
    }
    const can = this.pacer.canShow(t);
    if (!can.ok) return hold(can.reason);
    if (!pick) return hold(why);

    const item = this.model.byId.get(pick.id)!;
    this.pacer.show(t, item.id, item.topic, profile);
    this.model.markShown(item.id);
    this.model.resetRecent();
    this.cache = null;
    const liked = this.model.state.lastEngaged ? this.title(this.model.state.lastEngaged) : null;
    const text = liked ? `Liked ${liked}? → ${item.title}` : `Next for you → ${item.title}`;
    // The panel shows the plain reason; the gate's numbers stay in the full log.
    const reason = `Suggested ${item.title} ${because(item, this.model)}.`;
    this.decide('suggest', reason);
    this.decide('hold', `Gate passed for ${item.title}: ${why}.`, false);
    this.save();
    return { itemId: item.id, title: item.title, likedTitle: liked, text, reason };
  }

  /** Call about once a second; returns 'expired' when the shown suggestion timed out. */
  tick(): 'expired' | null {
    const t = this.now();
    if (!this.pacer.expired(t)) return null;
    this.resolve('ignored');
    return 'expired';
  }

  resolve(outcome: 'accepted' | 'ignored' | 'dismissed'): void {
    const t = this.now();
    const cur = this.pacer.state.current;
    if (!cur) return;
    const title = this.title(cur.itemId);
    if (outcome === 'accepted') {
      this.pacer.accept(t);
      this.model.markEngaged(cur.itemId, this.o.wall());
      this.decide('outcome', `You followed my suggestion of ${title}, so I may suggest again.`);
    } else if (outcome === 'ignored') {
      this.pacer.ignore(t);
      this.decide('outcome', `You passed on ${title}; waiting longer before the next one.`);
    } else {
      const topic = this.pacer.dismiss(t);
      this.model.apply({ kind: 'dismiss', itemId: cur.itemId });
      this.decide('outcome', `You dismissed ${title}; no more ${topic ? AXIS_LABEL[topic] : 'such'} suggestions this visit.`);
    }
    this.cache = null;
    if (this.pacer.state.mode === 'quiet') this.decide('quiet', `${cap(this.quietLine())}`);
    this.save();
  }

  private quietLine(): string {
    return `quiet mode: ${this.pacer.state.quietReason ?? 'resting'}.`;
  }

  /** Line for the panel describing the suggestion state. */
  suggestionState(): string {
    const s = this.pacer.state;
    const t = this.now();
    if (s.current) return 'One suggestion is showing now.';
    if (s.shown >= this.pacingCfg.hardCap) return `That's all my suggestions for this visit (${s.shown}).`;
    const mode = this.pacer.mode(t);
    if (mode === 'quiet') return cap(this.quietLine());
    if (!this.model.state.interest) return 'Suggestions: none yet. I wait until I know what you like.';
    const n = WORDS[s.budget] ?? String(s.budget);
    return `Suggestions: up to ${n} more, one at a time, only when you pause.`;
  }

  snapshot(): Snapshot {
    const a = this.model.axesForDisplay();
    return {
      axes: Object.fromEntries(AXES.map((ax, i) => [ax, a[i]])) as Record<Axis, number>,
      recent: this.log.recent(3),
      suggestionState: this.suggestionState(),
      mode: this.pacer.mode(this.now()),
      space: this.space,
      coldStart: !this.model.state.interest,
    };
  }

  /** Forget everything this site learned, here and in storage. */
  reset(): void {
    clearAll(this.o.local ?? null, this.o.session ?? null);
    this.model = new VisitorModel(this.items, this.modelCfg);
    this.pacer = new Pacer(initialPacing(this.pacingCfg), this.pacingCfg);
    this.log = new DecisionLog();
    this.cache = null;
    this.lastTop = null;
    this.seenThisView.clear();
    this.flags = { headlineChanged: this.flags.headlineChanged, skimmerOffered: false, depthApplied: false };
  }
}

export const createBrain = (o: BrainOptions): Brain => new Brain(o);
