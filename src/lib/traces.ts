// The three exported OpsPilot runs, in the order the picker shows them.
// Loaders are dynamic imports, so a trace's JSON is fetched only when chosen.
import type { RawTrace } from './trace';

export interface TraceEntry {
  slug: string;
  label: string;
  load: () => Promise<RawTrace>;
}

const json = (p: Promise<{ default: unknown }>) => p.then((m) => m.default as RawTrace);

export const TRACES: TraceEntry[] = [
  {
    slug: 'happy-path-rollback',
    label: 'Rollback approved and verified',
    load: () => json(import('../content/data/opspilot/trace-happy-path-rollback.json')),
  },
  {
    slug: 'viewer-injection-denied',
    label: 'Viewer prompt injection, denied',
    load: () => json(import('../content/data/opspilot/trace-viewer-injection-denied.json')),
  },
  {
    slug: 'approval-rejected',
    label: 'Restart rejected by admin',
    load: () => json(import('../content/data/opspilot/trace-approval-rejected.json')),
  },
];
