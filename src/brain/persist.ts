// Persistence. Everything stays in this browser.
//  - Long-term (localStorage): the visitor model and the decision log.
//  - Session (sessionStorage): pacing state, headline/skimmer flags.
// Keys are versioned; anything unreadable means a silent cold start.
import type { KV } from './types';
import type { ModelState } from './model';
import type { PacingState } from './pacing';
import type { Decision } from './log';

export const VERSION = 1;
export const LOCAL_KEY = `brain:v${VERSION}`;
export const SESSION_KEY = `brain:v${VERSION}:session`;
/** Set when the opener line was used or dismissed; read by an inline script before paint. */
export const OPENER_KEY = 'brain:opener-done';

export interface LocalData {
  version: number;
  model: ModelState;
  log: Decision[];
}

export interface SessionData {
  version: number;
  pacing: PacingState;
  headlineChanged: boolean;
  skimmerOffered: boolean;
  depthApplied: boolean;
  /** Active ms at save time, so pacing times can be rebased on the next page view. */
  activeAt: number;
}

function read<T extends { version: number }>(kv: KV | null, key: string): T | null {
  if (!kv) return null;
  try {
    const raw = kv.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as T;
    return data && data.version === VERSION ? data : null;
  } catch {
    return null;
  }
}

function write(kv: KV | null, key: string, value: unknown): boolean {
  if (!kv) return false;
  try {
    // Infinity (an open cooldown) does not survive JSON; store it as null.
    kv.setItem(key, JSON.stringify(value, (_k, v) => (v === Infinity ? null : v)));
    return true;
  } catch {
    return false;
  }
}

export const loadLocal = (kv: KV | null): LocalData | null => {
  const d = read<LocalData>(kv, LOCAL_KEY);
  return d && d.model && typeof d.model === 'object' && Array.isArray(d.log) ? d : null;
};

export const loadSession = (kv: KV | null): SessionData | null => {
  const d = read<SessionData>(kv, SESSION_KEY);
  if (!d || !d.pacing) return null;
  if (d.pacing.cooldownUntil === null) d.pacing.cooldownUntil = Infinity;
  return d;
};

export const saveLocal = (kv: KV | null, d: Omit<LocalData, 'version'>): boolean =>
  write(kv, LOCAL_KEY, { version: VERSION, ...d });

export const saveSession = (kv: KV | null, d: Omit<SessionData, 'version'>): boolean =>
  write(kv, SESSION_KEY, { version: VERSION, ...d });

/** Forget everything. Never throws. */
export function clearAll(local: KV | null, session: KV | null): void {
  for (const [kv, key] of [
    [local, LOCAL_KEY],
    [local, OPENER_KEY],
    [session, SESSION_KEY],
  ] as const) {
    try {
      kv?.removeItem(key);
    } catch {
      /* storage unavailable: nothing to clear */
    }
  }
}

/** In-memory KV for tests and as a fallback. */
export function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
