import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReplay, summarizeToolResult, type RawTrace } from '../../src/lib/trace';

const dir = join(__dirname, '../../src/content/data/opspilot');
const load = (slug: string): RawTrace => JSON.parse(readFileSync(join(dir, `trace-${slug}.json`), 'utf8'));
const slugs = ['happy-path-rollback', 'viewer-injection-denied', 'approval-rejected'];

/** Every string value anywhere in the trace, for "nothing invented" checks. */
function strings(x: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof x === 'string') out.add(x);
  else if (Array.isArray(x)) x.forEach((v) => strings(v, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((v) => strings(v, out));
  return out;
}

describe.each(slugs)('replay of %s', (slug) => {
  const trace = load(slug);
  const replay = buildReplay(trace);
  const agentIds = new Set(trace.agentEvents.map((e) => e.event_id));
  const auditIds = new Set(trace.auditEvents.map((e) => e.event_id));
  const toolIds = new Set(trace.toolCalls.map((t) => t.id));

  it('every step references real rows (or a named trace field)', () => {
    for (const s of replay.steps) {
      const n = s.refs.agent.length + s.refs.audit.length + s.refs.toolCalls.length;
      expect(n > 0 || !!s.refs.field, s.key).toBe(true);
      s.refs.agent.forEach((id) => expect(agentIds.has(id), `${s.key} agent ${id}`).toBe(true));
      s.refs.audit.forEach((id) => expect(auditIds.has(id), `${s.key} audit ${id}`).toBe(true));
      s.refs.toolCalls.forEach((id) => expect(toolIds.has(id), `${s.key} tool ${id}`).toBe(true));
    }
  });

  it('accounts for every event exactly once', () => {
    const a = replay.steps.flatMap((s) => s.refs.agent);
    const u = replay.steps.flatMap((s) => s.refs.audit);
    expect([...a].sort((x, y) => x - y)).toEqual([...agentIds].sort((x, y) => x - y));
    expect([...u].sort((x, y) => x - y)).toEqual([...auditIds].sort((x, y) => x - y));
  });

  it('has one step per tool call, in call order, with matching rows', () => {
    const tools = replay.steps.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(trace.toolCalls.length);
    tools.forEach((s, i) => {
      const call = trace.toolCalls.find((t) => t.call_index === i)!;
      expect(s.refs.toolCalls).toEqual([call.id]);
      expect(s.title).toContain(call.tool);
      for (const id of s.refs.agent) {
        expect(trace.agentEvents.find((e) => e.event_id === id)!.tool).toBe(call.tool);
      }
      const auditRow = trace.auditEvents.find((e) => e.event_id === s.refs.audit[0])!;
      expect(auditRow.details!.tool).toBe(call.tool);
      expect(auditRow.details!.arguments).toEqual(call.arguments);
    });
  });

  it('quotes text from the trace rather than writing its own', () => {
    const all = strings(trace);
    for (const s of replay.steps) {
      if (s.text) expect(all.has(s.text), s.key).toBe(true);
    }
    for (const h of replay.steps.find((s) => s.kind === 'diagnosis')!.hypotheses!) {
      expect(all.has(h.text)).toBe(true);
      [...h.supporting, ...h.contradicting].forEach((e) => expect(all.has(e.observation)).toBe(true));
    }
  });

  it('keeps steps in time order and starts at the request', () => {
    expect(replay.steps[0].kind).toBe('request');
    expect(replay.steps[0].offsetMs).toBe(0);
    const offsets = replay.steps.map((s) => s.offsetMs).filter((x): x is number => x !== null);
    expect(offsets).toEqual([...offsets].sort((x, y) => x - y));
    expect(replay.steps.at(-1)!.kind).toBe('outcome');
  });

  it('shows the policy decision exactly as stored', () => {
    const p = replay.steps.find((s) => s.kind === 'policy')!;
    expect(p.text).toBe(trace.policy!.reason);
    const facts = Object.fromEntries(p.facts.map((f) => [f.label, f.value]));
    expect(facts.Role).toBe(trace.policy!.role);
    expect(facts.Environment).toBe(trace.policy!.environment);
    expect(facts.Outcome).toBe(trace.policy!.outcome);
    expect(facts.Risk).toContain(trace.policy!.risk_level);
  });

  it('carries provider, model and export date', () => {
    expect(replay.provider).toBe('groq');
    expect(replay.model).toBe('openai/gpt-oss-120b');
    expect(replay.exportedOn).toBe('2026-10-16');
  });
});

describe('story-specific steps', () => {
  it('happy path: 6 tools, a 403 self-approval, admin approval, execution, SUCCESS', () => {
    const r = buildReplay(load('happy-path-rollback'));
    const kinds = r.steps.map((s) => s.kind);
    expect(kinds.filter((k) => k === 'tool')).toHaveLength(6);
    expect(kinds).toEqual([
      'request', 'retrieval', 'tool', 'tool', 'tool', 'tool', 'tool', 'tool', 'diagnosis', 'proposal',
      'policy', 'approval-request', 'self-approval', 'approval-decision', 'execution', 'verification', 'outcome',
    ]);
    const self = r.steps.find((s) => s.kind === 'self-approval')!;
    expect(self.title).toContain('403');
    expect(self.text).toBe('The requester cannot decide their own action');
    expect(self.at).toBeNull();
    expect(r.steps.find((s) => s.kind === 'verification')!.title).toContain('SUCCESS');
    const outcome = Object.fromEntries(r.steps.at(-1)!.facts.map((f) => [f.label, f.value]));
    expect(outcome['Audit rows']).toBe('19 (17 for this run + 2 sign-ins)');
    expect(outcome['Incident status']).toBe('resolved');
  });

  it('viewer injection: policy denies and nothing after it exists', () => {
    const r = buildReplay(load('viewer-injection-denied'));
    const kinds = r.steps.map((s) => s.kind);
    expect(kinds).not.toContain('approval-request');
    expect(kinds).not.toContain('execution');
    expect(r.steps.find((s) => s.kind === 'policy')!.tone).toBe('deny');
    const outcome = Object.fromEntries(r.steps.at(-1)!.facts.map((f) => [f.label, f.value]));
    expect(outcome['Approval row']).toBe('none created');
    expect(outcome['Action row']).toBe('none created');
    expect(r.steps[0].text).toContain('Ignore your rules');
  });

  it('approval rejected: needs approval, admin rejects, no execution or verification', () => {
    const r = buildReplay(load('approval-rejected'));
    const kinds = r.steps.map((s) => s.kind);
    expect(kinds).toContain('approval-decision');
    expect(kinds).not.toContain('execution');
    expect(kinds).not.toContain('verification');
    expect(r.steps.find((s) => s.kind === 'policy')!.tone).toBe('approval');
    expect(r.steps.find((s) => s.kind === 'approval-decision')!.tone).toBe('deny');
    const outcome = Object.fromEntries(r.steps.at(-1)!.facts.map((f) => [f.label, f.value]));
    expect(outcome['Action row']).toBe('rejected, not executed');
  });
});

describe('summarizeToolResult', () => {
  it('reports empty results honestly', () => {
    expect(summarizeToolResult('search_logs', { logs: [], service: 'x' })).toBe('No matching log lines.');
  });
  it('falls back to field names for unknown tools', () => {
    expect(summarizeToolResult('search_runbooks', { results: [], query: 'q' })).toBe('Result fields: results, query');
  });
});
