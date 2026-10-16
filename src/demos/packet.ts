// Follow the packet: one cell identity's trip from phone to map.
import type { DemoContext } from '../lib/demo';
import { esc } from '../lib/html';
import { SAMPLES, hops, type MapOutline, type Tower } from '../lib/cellular';
import { renderHop, renderMap } from '../lib/packet-view';

export async function mount({ root, used }: DemoContext): Promise<void> {
  const [towers, india] = await Promise.all([
    import('../content/data/cellular/towers.json').then((m) => m.default as Tower[]),
    import('../content/data/cellular/india.json').then((m) => m.default as MapOutline),
  ]);
  root.innerHTML = `
    <div class="packet" tabindex="-1">
      <label class="field">
        <span class="field-label">Cell</span>
        <select data-cell>${SAMPLES.map(
          (s) => `<option value="${s.id}">${esc(s.label)} · ${s.payload.mcc}/${s.payload.mnc}/${s.payload.tac}/${s.payload.cid}</option>`,
        ).join('')}</select>
      </label>
      <ol class="rail" data-rail aria-label="Hops"></ol>
      <div class="packet-grid">
        <div class="step-slot" data-slot aria-live="polite"></div>
        <figure class="map-fig">
          <div data-map></div>
          <figcaption class="muted">The demo searches the 49-row sample from the repo, not the full dataset. At this scale the 1 km circle is smaller than the pin, so the inset draws it to scale.</figcaption>
        </figure>
      </div>
      <div class="stepper-controls">
        <button type="button" class="button button--ghost" data-prev>← Previous</button>
        <button type="button" class="button button--ghost" data-next>Next hop →</button>
      </div>
    </div>`;
  const wrap = root.querySelector<HTMLElement>('.packet')!;
  const select = root.querySelector<HTMLSelectElement>('[data-cell]')!;
  const rail = root.querySelector<HTMLOListElement>('[data-rail]')!;
  const slot = root.querySelector<HTMLElement>('[data-slot]')!;
  const mapBox = root.querySelector<HTMLElement>('[data-map]')!;
  const prev = root.querySelector<HTMLButtonElement>('[data-prev]')!;
  const next = root.querySelector<HTMLButtonElement>('[data-next]')!;

  let flow = hops(towers, SAMPLES[0].payload);
  let i = 0;

  const show = (n: number) => {
    i = Math.max(0, Math.min(flow.hops.length - 1, n));
    slot.innerHTML = renderHop(flow.hops[i], i + 1, flow.hops.length);
    // The pin appears when the app draws it: on the last hop.
    mapBox.innerHTML = renderMap(india, flow.response, i === flow.hops.length - 1);
    rail.querySelectorAll('button').forEach((b, k) => {
      b.classList.toggle('done', k < i);
      if (k === i) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    prev.disabled = i === 0;
    next.disabled = i === flow.hops.length - 1;
  };

  const pick = (id: string) => {
    const s = SAMPLES.find((x) => x.id === id) ?? SAMPLES[0];
    flow = hops(towers, s.payload);
    wrap.dataset.found = String(!('error' in flow.response));
    rail.innerHTML = flow.hops
      .map((h, k) => `<li><button type="button" class="rail-dot" data-go="${k}" aria-label="Hop ${k + 1}: ${esc(h.title)}"></button></li>`)
      .join('');
    show(0);
  };

  select.addEventListener('change', () => {
    used();
    pick(select.value);
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

  pick(select.value);
}
