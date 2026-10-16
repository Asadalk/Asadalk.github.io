// Incident replay: step through a real exported OpsPilot run.
import type { DemoContext } from '../lib/demo';
import { esc } from '../lib/html';
import { renderMeta, renderStep } from '../lib/replay-view';
import { buildReplay, type Replay } from '../lib/trace';
import { TRACES } from '../lib/traces';

export async function mount({ root, used }: DemoContext): Promise<void> {
  root.innerHTML = `
    <div class="replay" tabindex="-1">
      <label class="field">
        <span class="field-label">Run</span>
        <select data-trace>${TRACES.map((t) => `<option value="${t.slug}">${esc(t.label)}</option>`).join('')}</select>
      </label>
      <p class="replay-title" data-title></p>
      <p class="replay-meta muted" data-meta></p>
      <ol class="rail" data-rail aria-label="Steps"></ol>
      <p class="rail-pos mono muted" data-pos aria-hidden="true"></p>
      <div class="step-slot" data-slot aria-live="polite"></div>
      <div class="stepper-controls">
        <button type="button" class="button button--ghost" data-prev>← Previous</button>
        <button type="button" class="button button--ghost" data-next>Next →</button>
      </div>
      <p class="hint muted">Arrow keys also move between steps.</p>
    </div>`;
  const wrap = root.querySelector<HTMLElement>('.replay')!;
  const select = root.querySelector<HTMLSelectElement>('[data-trace]')!;
  const title = root.querySelector<HTMLElement>('[data-title]')!;
  const meta = root.querySelector<HTMLElement>('[data-meta]')!;
  const rail = root.querySelector<HTMLOListElement>('[data-rail]')!;
  const pos = root.querySelector<HTMLElement>('[data-pos]')!;
  const slot = root.querySelector<HTMLElement>('[data-slot]')!;
  const prev = root.querySelector<HTMLButtonElement>('[data-prev]')!;
  const next = root.querySelector<HTMLButtonElement>('[data-next]')!;

  const cache = new Map<string, Replay>();
  let replay: Replay;
  let i = 0;

  const show = (n: number) => {
    i = Math.max(0, Math.min(replay.steps.length - 1, n));
    const s = replay.steps[i];
    slot.innerHTML = renderStep(s, { raw: true });
    pos.textContent = `Step ${i + 1} of ${replay.steps.length}`;
    rail.querySelectorAll('button').forEach((b, k) => {
      b.classList.toggle('done', k < i);
      if (k === i) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    prev.disabled = i === 0;
    next.disabled = i === replay.steps.length - 1;
  };

  const load = async (slug: string) => {
    let r = cache.get(slug);
    if (!r) {
      const entry = TRACES.find((t) => t.slug === slug) ?? TRACES[0];
      r = buildReplay(await entry.load());
      cache.set(slug, r);
    }
    replay = r;
    wrap.dataset.trace = r.slug;
    title.textContent = r.title;
    meta.innerHTML = renderMeta(r);
    rail.innerHTML = r.steps
      .map(
        (s, k) =>
          `<li><button type="button" class="rail-dot tone-${s.tone}" data-go="${k}" aria-label="Step ${k + 1}: ${esc(s.title)}" title="${esc(s.rail)}"></button></li>`,
      )
      .join('');
    show(0);
  };

  select.addEventListener('change', () => {
    used();
    load(select.value);
  });
  prev.addEventListener('click', () => {
    used();
    show(i - 1);
  });
  next.addEventListener('click', () => {
    used();
    show(i + 1);
  });
  rail.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-go]');
    if (!b) return;
    used();
    show(Number(b.dataset.go));
  });
  wrap.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('select, input, textarea, summary') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      used();
      show(i + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });

  await load(select.value);
}
