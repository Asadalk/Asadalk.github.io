// Shared plumbing for the on-device demos.
//
// Each demo sits in a <details data-demo="…"> whose body is readable static
// HTML. Opening it imports the demo's code (and data) for the first time, then
// the demo replaces the static body with its interactive version.
//
// Every demo reports 'open', 'used' (once per opening) and 'close' as a
// window 'demo' event; the brain (Phase 5) listens for these.

export type DemoAction = 'open' | 'used' | 'close';

export interface DemoEventDetail {
  /** Demo id, e.g. "opspilot-replay". */
  id: string;
  /** Content item the demo belongs to, e.g. "opspilot". */
  item: string;
  action: DemoAction;
}

export function emitDemo(id: string, item: string, action: DemoAction): void {
  window.dispatchEvent(new CustomEvent<DemoEventDetail>('demo', { detail: { id, item, action } }));
}

export interface DemoContext {
  root: HTMLElement;
  /** Call on any real interaction; only the first call per opening is reported. */
  used: () => void;
}

export type Mount = (ctx: DemoContext) => void | Promise<void>;

/** Wire one demo: lazy import on first open, open/used/close events. */
export function lazyDemo(id: string, load: () => Promise<{ mount: Mount }>): void {
  const box = document.querySelector<HTMLDetailsElement>(`details[data-demo="${id}"]`);
  const root = box?.querySelector<HTMLElement>('[data-demo-root]');
  if (!box || !root) return;
  const item = box.dataset.item ?? id;
  let loaded: Promise<void> | null = null;
  let usedThisOpen = false;
  const used = () => {
    if (usedThisOpen) return;
    usedThisOpen = true;
    emitDemo(id, item, 'used');
  };
  const onToggle = () => {
    if (box.open) {
      usedThisOpen = false;
      emitDemo(id, item, 'open');
      if (!loaded) {
        box.setAttribute('aria-busy', 'true');
        loaded = load()
          .then((m) => m.mount({ root, used }))
          .then(() => {
            root.dataset.ready = 'true';
          })
          .catch((err) => {
            // Keep the static fallback; it is complete on its own.
            console.error(`[demo ${id}]`, err);
          })
          .finally(() => box.removeAttribute('aria-busy'));
      }
    } else {
      emitDemo(id, item, 'close');
    }
  };
  box.addEventListener('toggle', onToggle);
  if (box.open) onToggle();
}
