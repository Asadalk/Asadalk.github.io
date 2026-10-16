// The only file in src/brain that touches the DOM. It watches what the visitor
// does (cards on screen, opening/closing, reading time, scroll speed, idle,
// tab visibility, events from other parts of the site), feeds the brain, and
// applies its decisions under the stability rule: nothing on screen or above
// it ever moves, hides or resizes. Only cards below the fold are reordered.
//
// Test hook: ?brain-test=1 shortens every timer by 10×, seeds the random
// numbers and exposes window.__brain, so Playwright can check behaviour in seconds.
import { Brain, AXES, AXIS_SHORT, type Axis, type ItemInput, type Moment, type Vec } from './index';
import { OPENER_KEY } from './persist';
import { seeded } from './rng';
import type { KV } from './types';

interface BrainData {
  items: ItemInput[];
  curated: string[];
  headlines: Partial<Record<Axis | 'default', string>>;
  openerChips: { label: string; boost: Partial<Record<Axis, number>> }[];
}

interface CardState {
  el: HTMLElement;
  details: HTMLDetailsElement | null;
  /** Fraction that counts: share of the card visible, or of the viewport it fills. */
  frac: number;
  /** Wall ms when it became ≥50% visible (null if not). */
  since: number | null;
  /** Wall ms it entered the viewport at all. */
  enteredAt: number | null;
  /** Unflushed qualifying reading seconds. */
  pending: number;
  /** Reading seconds during the current open stretch. */
  openRead: number;
  programmatic: boolean;
}

const storage = (kind: 'localStorage' | 'sessionStorage'): KV | null => {
  try {
    const s = window[kind];
    const k = '__brain_probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
};

/** Run a DOM change while keeping whatever is on screen exactly where it is. */
function keepViewport(change: () => void): void {
  const probe = document.elementFromPoint(window.innerWidth / 2, Math.min(80, window.innerHeight / 3));
  const anchor = probe instanceof HTMLElement ? probe : null;
  const before = anchor?.getBoundingClientRect().top ?? 0;
  change();
  if (anchor && anchor.isConnected) {
    const delta = anchor.getBoundingClientRect().top - before;
    if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
  }
}

export async function startBrain(): Promise<void> {
  const dataEl = document.getElementById('brain-data');
  if (!dataEl) return;
  let data: BrainData;
  try {
    data = JSON.parse(dataEl.textContent ?? '');
  } catch {
    return;
  }
  const test = new URLSearchParams(location.search).has('brain-test');
  const k = test ? 0.1 : 1; // time scale for the test hook
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const local = storage('localStorage');
  const session = storage('sessionStorage');

  const brain = new Brain({
    items: data.items,
    // Rank in the owner's 5-axis space. With only five feed items, MiniLM
    // similarities between project summaries are too flat (calibrated ≤ 0.12)
    // for the confidence gate; see docs/decisions.md. Search queries still
    // steer the profile through the items they match.
    embeddings: null,
    curated: data.curated,
    headlines: data.headlines,
    wall: () => performance.now(),
    rng: test ? seeded(1) : Math.random, // seeded in the test hook so e2e runs repeat
    local,
    session,
    idleAfterMs: 30_000 * k,
    pacing: {
      baseCooldownMs: 45_000 * k,
      fastCooldownMs: 30_000 * k,
      maxCooldownMs: 180_000 * k,
      ignoreAfterMs: 20_000 * k,
      minReadMs: 10_000 * k,
    },
  });
  if (test) (window as unknown as { __brain: Brain }).__brain = brain;

  // ---- cards --------------------------------------------------------------
  const ids = new Set(data.items.map((i) => i.id));
  const cards = new Map<string, CardState>();
  for (const el of document.querySelectorAll<HTMLElement>('article.card[data-item]')) {
    const id = el.dataset.item!;
    if (!ids.has(id)) continue;
    cards.set(id, { el, details: el.querySelector('details'), frac: 0, since: null, enteredAt: null, pending: 0, openRead: 0, programmatic: false });
  }
  const projects = document.getElementById('projects');
  const hero = document.querySelector<HTMLElement>('header.hero');
  const h1 = document.querySelector<HTMLElement>('h1[data-headline]');
  const live = document.querySelector<HTMLElement>('[data-brain-live]');

  let heroVisible = true;
  let lastScroll = -1e9;
  let scrollY = window.scrollY;
  let scrollT = performance.now();
  let fastBurst = false;
  let fastScrolls = 0;
  let maxDwell = 0;
  let demoRunning = false;
  let wasIdle = false;
  let firstSignboard = true;
  let pendingMoment: { kind: Moment['kind']; slot?: HTMLElement } | null = null;
  const scrolling = () => performance.now() - lastScroll < 400;

  const io = new IntersectionObserver(
    (entries) => {
      const now = performance.now();
      for (const e of entries) {
        const st = cards.get((e.target as HTMLElement).dataset.item!);
        if (!st) continue;
        const h = e.boundingClientRect.height || 1;
        const frac = e.intersectionRect.height / Math.min(h, window.innerHeight);
        if (e.isIntersecting && st.enteredAt === null) st.enteredAt = now;
        if (!e.isIntersecting && st.enteredAt !== null) {
          // Passed quickly while scrolling fast and never opened: weak negative.
          if (fastBurst && now - st.enteredAt < 700 && !st.details?.open) {
            brain.signal({ kind: 'fast-scroll', itemId: e.target instanceof HTMLElement ? e.target.dataset.item : undefined });
          }
          st.enteredAt = null;
        }
        st.frac = frac;
        if (frac >= 0.5 && st.since === null) st.since = now;
        if (frac < 0.5) {
          st.since = null;
          flush(st);
        }
      }
    },
    { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
  );
  for (const st of cards.values()) io.observe(st.el);
  if (hero) new IntersectionObserver(([e]) => (heroVisible = e.isIntersecting)).observe(hero);

  const idOf = (st: CardState) => st.el.dataset.item!;
  function flush(st: CardState) {
    if (st.pending < 0.5) return;
    const sec = st.pending / k; // real seconds in test mode count as 10×
    st.pending = 0;
    brain.signal({ kind: 'dwell', itemId: idOf(st), seconds: sec });
    afterSignal();
  }
  const onScreen = () => [...cards.entries()].filter(([, s]) => s.frac > 0.15).map(([id]) => id);
  const growingDwell = () => [...cards.values()].some((s) => s.details?.open && s.since !== null && s.frac >= 0.5);

  // ---- open / close --------------------------------------------------------
  document.addEventListener(
    'toggle',
    (e) => {
      const d = e.target;
      if (!(d instanceof HTMLDetailsElement)) return;
      const art = d.closest<HTMLElement>('article.card[data-item]');
      const st = art && cards.get(art.dataset.item!);
      if (!st) return;
      if (st.programmatic) {
        st.programmatic = false;
        return;
      }
      if (d.open) {
        st.openRead = 0;
        brain.signal({ kind: 'expand', itemId: idOf(st) });
        afterSignal();
      } else {
        const read = st.openRead + st.pending;
        flush(st);
        st.openRead = 0;
        tryMoment({ kind: 'card-collapsed', readMs: read * 1000 }, slotFor(st.el));
      }
    },
    true,
  );

  // ---- input, scroll, idle, visibility --------------------------------------
  const onInput = () => {
    if (wasIdle) {
      wasIdle = false;
      // Back from idle: at most a soft highlight of a visible chip.
      if (chip.current) {
        chip.current.el.classList.add('soft');
        window.setTimeout(() => chip.current?.el.classList.remove('soft'), 2000);
      }
    }
    brain.input();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(ev, onInput, { passive: true });
  let lastMove = 0;
  window.addEventListener(
    'pointermove',
    () => {
      const t = performance.now();
      if (t - lastMove > 1000) {
        lastMove = t;
        onInput();
      }
    },
    { passive: true },
  );
  window.addEventListener(
    'scroll',
    () => {
      const t = performance.now();
      const dy = Math.abs(window.scrollY - scrollY);
      const dt = Math.max(t - scrollT, 1);
      scrollY = window.scrollY;
      scrollT = t;
      lastScroll = t;
      const fast = (dy / dt) * 1000 > 2.5 * window.innerHeight;
      if (fast && !fastBurst) fastScrolls++;
      fastBurst = fast || (fastBurst && dt < 300);
      onInput();
    },
    { passive: true },
  );
  document.addEventListener('visibilitychange', () => {
    brain.setVisible(document.visibilityState === 'visible');
    if (document.visibilityState === 'hidden') for (const st of cards.values()) flush(st);
  });
  window.addEventListener('pagehide', () => {
    for (const st of cards.values()) flush(st);
    brain.save();
  });

  // ---- events from other parts of the site ---------------------------------
  window.addEventListener('signboard', (e) => {
    if (!firstSignboard) return;
    firstSignboard = false;
    const section = document.getElementById(String((e as CustomEvent).detail));
    const inSection = section ? [...section.querySelectorAll<HTMLElement>('article.card[data-item]')].map((c) => c.dataset.item!) : [];
    if (!inSection.length) return;
    brain.signal({ kind: 'signboard', label: section!.id, itemIds: inSection });
    afterSignal();
  });
  window.addEventListener('ask', (e) => {
    const d = (e as CustomEvent).detail ?? {};
    const results: unknown[] = Array.isArray(d.results) ? d.results : [];
    const itemIds = results
      .map((r) => (typeof r === 'string' ? r : (r as { id?: string })?.id))
      .filter((id): id is string => !!id && ids.has(id));
    brain.signal({ kind: 'ask', vector: Array.isArray(d.vector) ? d.vector : undefined, itemIds });
    afterSignal();
    pendingMoment = { kind: 'ask-viewed' };
  });
  window.addEventListener('demo', (e) => {
    const d = (e as CustomEvent).detail ?? {};
    if (d.action === 'open') demoRunning = true;
    // Phase 6 demos send { id: demo name, item: content id }; Phase 3 sends the content id as id.
    const itemId = ids.has(d.item) ? d.item : d.id;
    if (d.action === 'used' && ids.has(itemId)) {
      brain.signal({ kind: 'demo', itemId });
      afterSignal();
    }
    if (d.action === 'close') {
      demoRunning = false;
      pendingMoment = { kind: 'demo-closed' };
    }
  });

  // ---- reordering (below the fold only) ------------------------------------
  const projectCards = () => (projects ? [...projects.querySelectorAll<HTMLElement>(':scope > article.card[data-item]')] : []);
  function reorder() {
    const list = projectCards();
    if (list.length < 2) return;
    const vh = window.innerHeight;
    // Everything whose top is above the bottom of the screen stays put.
    let fixed = list.findIndex((c) => c.getBoundingClientRect().top >= vh);
    if (fixed < 0) return;
    // Never move a card that holds keyboard focus.
    const focusIdx = list.findIndex((c) => c.contains(document.activeElement));
    if (focusIdx >= fixed) fixed = focusIdx + 1;
    const current = list.map((c) => c.dataset.item!);
    const plan = brain.planReorder(current, fixed);
    if (!plan.moves.length) return;
    applyOrder(list, plan.order, fixed);
  }
  function applyOrder(list: HTMLElement[], order: string[], fixed: number) {
    const byId = new Map(list.map((c) => [c.dataset.item!, c]));
    const anchor = list[list.length - 1].nextSibling;
    const parent = list[0].parentElement!;
    const before = new Map(list.map((c) => [c, c.getBoundingClientRect().top]));
    for (const id of order.slice(fixed)) parent.insertBefore(byId.get(id)!, anchor);
    if (reduce.matches) return;
    // FLIP: settle each moved card from its old place in 300 ms, ease-out.
    for (const c of list) {
      const dy = before.get(c)! - c.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
    }
  }

  // ---- headline, depth -----------------------------------------------------
  function maybeHeadline() {
    if (!h1) return;
    const c = brain.headline(heroVisible);
    if (!c) return;
    // The hero is off screen; keep the visible content exactly in place anyway.
    keepViewport(() => (h1.textContent = c.text));
  }
  function maybeDepth() {
    if (brain.depth() !== 'deep') return;
    const vh = window.innerHeight;
    const next = projectCards().find((c) => c.getBoundingClientRect().top >= vh && !c.querySelector('details')?.open);
    const st = next && cards.get(next.dataset.item!);
    if (st?.details) {
      st.programmatic = true;
      st.details.open = true;
    }
  }

  let settleTimer = 0;
  function afterSignal() {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      reorder();
      maybeHeadline();
      maybeDepth();
      renderPanel();
    }, 600);
  }

  // ---- suggestions -----------------------------------------------------------
  const slots = [...document.querySelectorAll<HTMLElement>('[data-suggest-slot]')];
  const slotFor = (el: Element) => el.closest('section')?.querySelector<HTMLElement>('[data-suggest-slot]') ?? undefined;
  const slotVisible = new Set<HTMLElement>();
  const chip: { current: { el: HTMLElement; seen: boolean; itemId: string | null } | null } = { current: null };
  const slotIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const s = e.target as HTMLElement;
      if (e.isIntersecting) {
        slotVisible.add(s);
        if (!pendingMoment && !chip.current) pendingMoment = { kind: 'section-end', slot: s };
        if (chip.current && s.contains(chip.current.el)) chip.current.seen = true;
      } else {
        slotVisible.delete(s);
        // Seen, then scrolled out of view untouched: ignored.
        if (chip.current && s.contains(chip.current.el) && chip.current.seen) clearChip('ignored');
      }
    }
  });
  for (const s of slots) slotIO.observe(s);

  const context = (): Omit<Moment, 'kind'> => {
    const a = document.activeElement;
    return {
      scrolling: scrolling(),
      demoRunning,
      inputFocused: !!a && (a.matches('input, textarea, select') || (a as HTMLElement).isContentEditable),
      textSelected: (window.getSelection()?.toString().length ?? 0) > 0,
      growingDwell: growingDwell(),
      hidden: document.visibilityState !== 'visible',
      idle: brain.isIdle(),
    };
  };

  function pickSlot(preferred?: HTMLElement): HTMLElement | undefined {
    if (preferred) return preferred;
    const vis = slots.find((s) => slotVisible.has(s));
    if (vis) return vis;
    return slots.find((s) => s.getBoundingClientRect().top >= 0) ?? slots[slots.length - 1];
  }

  function tryMoment(m: Moment, preferred?: HTMLElement) {
    if (chip.current) return;
    const s = brain.moment({ ...context(), ...m }, onScreen());
    if (!s) return;
    const slot = pickSlot(preferred);
    if (!slot) return;
    showChip(slot, s.text, `#${s.itemId}`, s.itemId, `Suggestion: ${s.text.replace('→', 'next,')}`);
    renderPanel();
  }

  function showChip(slot: HTMLElement, text: string, href: string, itemId: string | null, announce: string) {
    const el = slot.querySelector<HTMLElement>('.chip');
    if (!el) return;
    const link = el.querySelector<HTMLAnchorElement>('.chip-link')!;
    link.textContent = text;
    link.href = href;
    el.hidden = false; // the slot's space is reserved: nothing moves
    chip.current = { el, seen: slotVisible.has(slot), itemId };
    if (live) live.textContent = announce;
  }

  function clearChip(outcome: 'accepted' | 'ignored' | 'dismissed' | null) {
    const c = chip.current;
    if (!c) return;
    chip.current = null;
    c.el.hidden = true;
    c.el.classList.remove('soft');
    if (c.itemId && outcome) brain.resolve(outcome);
    renderPanel();
  }

  for (const s of slots) {
    s.querySelector('.chip-link')?.addEventListener('click', () => clearChip('accepted'));
    s.querySelector('.chip-x')?.addEventListener('click', () => clearChip('dismissed'));
  }

  // ---- the 1-second loop (the only timer; the core has none) ----------------
  const started = performance.now();
  window.setInterval(() => {
    const now = performance.now();
    const visible = document.visibilityState === 'visible';
    const idle = brain.isIdle();
    if (idle) wasIdle = true;
    for (const st of cards.values()) {
      if (visible && !idle && st.since !== null && st.details?.open) {
        st.pending += 1;
        st.openRead += 1;
        maxDwell = Math.max(maxDwell, (st.openRead + st.pending) / k);
        if (st.pending >= 5) flush(st);
      }
      if (st.since !== null && now - st.since >= 1000) brain.seen(idOf(st));
    }
    if (brain.tick() === 'expired' && chip.current) {
      const c = chip.current;
      chip.current = null;
      c.el.hidden = true;
      renderPanel();
    }
    // A section end or other moment waits until scrolling stops.
    if (pendingMoment && !scrolling()) {
      const m = pendingMoment;
      pendingMoment = null;
      if (m.kind !== 'section-end' || (m.slot && slotVisible.has(m.slot))) tryMoment({ kind: m.kind }, m.slot);
    }
    // Skimmer: one offer of the plain résumé view.
    if (!chip.current && now - started < 30_000 && brain.skimmer({ fastScrolls, maxDwellSec: maxDwell })) {
      const slot = pickSlot();
      if (slot) showChip(slot, 'Short on time? → One-page résumé', '/resume/', null, 'Offer: a one-page résumé view.');
      renderPanel();
    }
    if (panel?.open) renderPanel();
  }, 1000);

  // ---- opener chips ----------------------------------------------------------
  const opener = document.querySelector<HTMLElement>('[data-opener]');
  const markOpenerDone = () => {
    try {
      local?.setItem(OPENER_KEY, '1');
    } catch {
      /* ignore */
    }
  };
  if (opener) {
    opener.addEventListener('click', (e) => {
      const t = e.target as Element;
      const btn = t.closest<HTMLElement>('[data-opener-chip]');
      const x = t.closest('[data-opener-dismiss]');
      if (!btn && !x) return;
      // Freeze the line's height so swapping its content never moves the page.
      opener.style.minHeight = `${opener.getBoundingClientRect().height}px`;
      markOpenerDone();
      if (x) {
        opener.style.visibility = 'hidden';
        return;
      }
      const chipData = data.openerChips[Number(btn!.dataset.openerChip)];
      brain.signal({ kind: 'opener', label: chipData.label, axesBoost: chipData.boost });
      reorder();
      renderPanel();
      const line = opener.querySelector<HTMLElement>('.opener-line')!;
      const done = opener.querySelector<HTMLElement>('.opener-done')!;
      const focused = line.contains(document.activeElement);
      line.hidden = true;
      done.hidden = false;
      done.textContent = Object.keys(chipData.boost).length
        ? `Noted: the projects further down now start with what fits "${chipData.label}".`
        : 'Noted: keeping the default order.';
      if (focused) {
        done.tabIndex = -1;
        done.focus({ preventScroll: true });
      }
    });
  }

  // ---- brain panel ---------------------------------------------------------
  const panel = document.querySelector<HTMLDialogElement>('[data-brain-panel]');
  const opener4 = document.querySelector<HTMLAnchorElement>('[data-brain-open]');
  function renderPanel() {
    if (!panel?.open) return;
    const s = brain.snapshot();
    const shape = panel.querySelector<SVGPolygonElement>('[data-brain-shape]');
    const cx = 120;
    const cy = 100;
    const R = 70;
    const pts = AXES.map((a, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length;
      const r = R * Math.max(0.04, s.axes[a]);
      return `${(cx + r * Math.cos(ang)).toFixed(1)},${(cy + r * Math.sin(ang)).toFixed(1)}`;
    }).join(' ');
    shape?.setAttribute('points', s.coldStart ? AXES.map(() => `${cx},${cy}`).join(' ') : pts);
    const ranked = AXES.map((a) => ({ a, v: s.axes[a] })).sort((x, y) => y.v - x.v);
    const desc = s.coldStart
      ? 'Nothing learned yet.'
      : `Strongest interest: ${AXIS_SHORT[ranked[0].a]}. ` + AXES.map((a) => `${AXIS_SHORT[a]} ${Math.round(s.axes[a] * 100)}%`).join(', ') + '.';
    panel.querySelector('[data-brain-radar-desc]')!.textContent = desc;
    panel.querySelector('[data-brain-caption]')!.textContent = s.coldStart
      ? 'Nothing learned yet. The shape grows as you read.'
      : `Leaning toward ${AXIS_SHORT[ranked[0].a]}${ranked[1].v > 0.8 ? ` and ${AXIS_SHORT[ranked[1].a]}` : ''}.`;
    const list = panel.querySelector('[data-brain-decisions]')!;
    list.replaceChildren(
      ...(s.recent.length
        ? s.recent.map((d) => Object.assign(document.createElement('li'), { textContent: d.text }))
        : [Object.assign(document.createElement('li'), { textContent: 'None yet.', className: 'muted' })]),
    );
    panel.querySelector('[data-brain-state]')!.textContent = s.suggestionState;
  }
  if (panel && opener4) {
    opener4.addEventListener('click', (e) => {
      e.preventDefault();
      panel.querySelector<HTMLElement>('[data-brain-reset-note]')!.textContent = '';
      panel.showModal();
      renderPanel();
    });
    panel.querySelector('[data-brain-close]')?.addEventListener('click', () => panel.close());
    // Click on the backdrop closes too.
    panel.addEventListener('click', (e) => {
      if (e.target === panel) panel.close();
    });
    panel.querySelector('[data-brain-reset]')?.addEventListener('click', () => {
      brain.reset();
      clearChip(null);
      // Put the cards that are out of sight back in the owner's order.
      const list = projectCards();
      const vh = window.innerHeight;
      const fixed = list.findIndex((c) => c.getBoundingClientRect().top >= vh);
      if (fixed >= 0) {
        const head = list.slice(0, fixed).map((c) => c.dataset.item!);
        const tail = data.curated.filter((id) => !head.includes(id) && list.some((c) => c.dataset.item === id));
        applyOrder(list, [...head, ...tail], fixed);
      }
      panel.querySelector<HTMLElement>('[data-brain-reset-note]')!.textContent = 'Done. This site has forgotten everything it learned about you.';
      renderPanel();
    });
  }
}
