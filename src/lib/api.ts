// Client for the portfolio API (space/server.py on Modal, two deployments:
// light for search + matcher, heavy for OCR). Both scale to zero when idle,
// so slow first requests trigger an honest "waking up" note.
import site from '../content/site.json';

const cfg = site as { api?: string; ocrApi?: string };
/** Search and the matcher (a light server). */
export const API_BASE: string = cfg.api ?? '';
/** Full OCR (a separate, heavier server). */
export const OCR_BASE: string = cfg.ocrApi ?? '';
export const hasApi = () => API_BASE.length > 0;
export const hasOcr = () => OCR_BASE.length > 0;

const woken = new Set<string>();
/**
 * Start a sleeping server as soon as the visitor shows intent (focuses the
 * search box, opens the matcher, scrolls to the scan demo), so it is usually
 * awake by the time they press the button. Fire and forget, once per page.
 */
export function wake(base: string): void {
  // Automated browsers (tests, crawlers that run JS) never wake servers.
  if (!base || woken.has(base) || navigator.webdriver) return;
  woken.add(base);
  fetch(`${base}/health`, { mode: 'cors' }).catch(() => woken.delete(base));
}

export class ApiError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit,
  { timeoutMs = 120_000, onSlow, base = API_BASE }: { timeoutMs?: number; onSlow?: () => void; base?: string } = {},
): Promise<T> {
  if (!base) throw new ApiError('No server configured');
  const ctrl = new AbortController();
  const slow = onSlow ? window.setTimeout(onSlow, 4000) : 0;
  const kill = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      let detail = `${res.status}`;
      try {
        const body = await res.json();
        detail = typeof body.detail === 'string' ? body.detail : detail;
      } catch {}
      throw new ApiError(detail, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(ctrl.signal.aborted ? 'The server took too long' : 'Could not reach the server');
  } finally {
    window.clearTimeout(slow);
    window.clearTimeout(kill);
  }
}

export const WAKING = 'Waking the server. It sleeps when nobody is using it, so this first request can take up to a minute…';
