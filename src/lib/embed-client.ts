// Main-thread handle on the shared embedding worker. "Ask about me" and the
// semantic-hire matcher both use this, so the model is downloaded and loaded
// once per visit. Nothing here runs until a feature calls warm() or embed().
import type { EmbedRequest, EmbedResponse } from '../workers/embed.worker';

export type ModelState = 'idle' | 'loading' | 'ready' | 'error';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: EmbedResponse) => void }>();
let state: ModelState = 'idle';
let loadPromise: Promise<void> | null = null;
const listeners = new Set<(s: ModelState) => void>();

function setState(s: ModelState) {
  state = s;
  for (const l of listeners) l(s);
}

/** Current model state, and a subscription for changes. */
export function modelState(): ModelState {
  return state;
}
export function onModelState(fn: (s: ModelState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/embed.worker.ts', import.meta.url), { type: 'module', name: 'embed' });
    worker.onmessage = (e: MessageEvent<EmbedResponse>) => {
      pending.get(e.data.id)?.resolve(e.data);
      pending.delete(e.data.id);
    };
    worker.onerror = (e) => {
      for (const [, p] of pending) p.resolve({ id: 0, ok: false, error: e.message || 'Worker failed' });
      pending.clear();
      setState('error');
    };
  }
  return worker;
}

function call(msg: { type: 'load' } | { type: 'embed'; texts: string[] }): Promise<EmbedResponse> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    getWorker().postMessage({ ...msg, id } as EmbedRequest);
  });
}

/** Start downloading and loading the model if that hasn't happened yet. */
export function warm(): Promise<void> {
  if (!loadPromise) {
    setState('loading');
    loadPromise = call({ type: 'load' }).then((r) => {
      if (!r.ok) {
        loadPromise = null;
        setState('error');
        throw new Error(r.error);
      }
      setState('ready');
    });
    loadPromise.catch(() => {});
  }
  return loadPromise;
}

/**
 * Sentence embeddings for `texts`: mean-pooled over tokens and scaled to
 * unit length, like sentence-transformers. Loads the model on first use.
 */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  await warm();
  const r = await call({ type: 'embed', texts });
  if (!r.ok) throw new Error(r.error);
  return r.vectors ?? [];
}

let scheduled = false;
/**
 * Preload after 5 s of idle time, unless the visitor asked to save data or is
 * on a 2G connection. Interaction (focus, typing) calls warm() sooner.
 */
export function warmWhenIdle(delayMs = 5000): void {
  if (scheduled) return;
  scheduled = true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData === true || /(^|-)2g$/.test(conn?.effectiveType ?? '')) return;
  const go = () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => void warm().catch(() => {}), { timeout: 2000 });
    else void warm().catch(() => {});
  };
  // Never before first paint: wait for load, then the idle delay.
  const start = () => window.setTimeout(go, delayMs);
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
