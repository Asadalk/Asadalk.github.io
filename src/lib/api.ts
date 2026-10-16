// Client for the portfolio API (a Hugging Face Space, see space/). Free Spaces
// sleep when idle, so slow first requests trigger an honest "waking up" note.
import site from '../content/site.json';

export const API_BASE: string = (site as { api?: string }).api ?? '';
export const hasApi = () => API_BASE.length > 0;

export class ApiError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit,
  { timeoutMs = 120_000, onSlow }: { timeoutMs?: number; onSlow?: () => void } = {},
): Promise<T> {
  if (!hasApi()) throw new ApiError('No server configured');
  const ctrl = new AbortController();
  const slow = onSlow ? window.setTimeout(onSlow, 4000) : 0;
  const kill = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_BASE + path, { ...init, signal: ctrl.signal });
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

export const WAKING = 'Waking the server. It sleeps when nobody is using it, so the first request takes about 30–60 s…';
