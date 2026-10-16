// Turns a raw exported OpsPilot run trace (src/content/data/opspilot/*.json)
// into the display steps of the incident replay.
//
// Rules: every value shown comes from a field of the trace, and every step
// lists the ids of the agent_events / audit_events / agent_tool_calls rows it
// was built from. Nothing is summarised by guesswork: tool summaries only pick
// and count fields of the stored tool result.

export interface AgentEvent {
  event_id: number;
  run_id: string;
  event_type: string;
  occurred_at: string;
  duration_ms: number | null;
  model: string | null;
  tool: string | null;
  status: string | null;
  error: unknown;
  details: Record<string, any>;
}

export interface AuditEvent {
  event_id: number;
  occurred_at: string;
  actor: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  run_id: string | null;
  reason: string | null;
  result: Record<string, any> | null;
  details: Record<string, any> | null;
}

export interface ToolCall {
  id: number;
  run_id: string;
  call_index: number;
  tool: string;
  arguments: Record<string, unknown>;
  start_time: string;
  end_time: string;
  result: any;
  success: boolean;
  error: unknown;
}

export interface Evidence {
  source: string;
  observation: string;
}

export interface RawHypothesis {
  score: number;
  hypothesis: string;
  supporting_evidence: Evidence[];
  contradicting_evidence: Evidence[];
}

export interface Proposal {
  reason: string;
  status: string;
  target: string;
  evidence: Evidence[];
  risk_level: string;
  action_type: string;
}

export interface PolicyRow {
  role: string;
  reason: string;
  outcome: 'allow' | 'deny' | 'require_approval';
  username: string;
  risk_level: string;
  action_type: string;
  environment: string;
}

export interface RawTrace {
  slug: string;
  title: string;
  scenario: string;
  provider: string;
  model: string;
  providerNote: string;
  exportedAt: string;
  run: {
    run_id: string;
    user_request: string;
    service: string | null;
    severity: string | null;
    diagnosis: string | null;
    status: string;
    created_at: string;
    completed_at: string | null;
    knowledge_citations: { chunk: number; source: string; content: string; document: string; similarity: number }[];
    [k: string]: unknown;
  };
  incident: { id: number; title: string; severity: string; status: string; _source?: string; [k: string]: unknown } | null;
  agentEvents: AgentEvent[];
  auditEvents: AuditEvent[];
  toolCalls: ToolCall[];
  hypotheses: RawHypothesis[];
  proposal: Proposal | null;
  action: {
    action_id: string;
    status: string;
    result: any;
    executed_at: string | null;
    [k: string]: unknown;
  } | null;
  policy: PolicyRow | null;
  approval: {
    id: number;
    requested_at: string;
    expires_at: string;
    decided_at: string | null;
    decision: string;
    decided_by: string | null;
    reason: string | null;
    requested_by: string;
  } | null;
  verification: { status: string; reason: string; attempt_count: number; [k: string]: unknown } | null;
  apiResponses: {
    selfApprovalAttempt?: { request: string; httpStatus: number; body: { detail: string }; note: string };
  } | null;
  [k: string]: unknown;
}

export type StepKind =
  | 'request'
  | 'retrieval'
  | 'tool'
  | 'diagnosis'
  | 'proposal'
  | 'policy'
  | 'approval-request'
  | 'self-approval'
  | 'approval-decision'
  | 'execution'
  | 'verification'
  | 'outcome';

/** allow = Neem, deny = Brick, approval = Mauve/Kohl. Always paired with text. */
export type Tone = 'neutral' | 'allow' | 'approval' | 'deny';

export interface Fact {
  label: string;
  value: string;
  mono?: boolean;
}

export interface Hypothesis {
  text: string;
  score: number;
  supporting: Evidence[];
  contradicting: Evidence[];
}

export interface StepRefs {
  agent: number[];
  audit: number[];
  toolCalls: number[];
  /** A top-level trace field, for data that is not an event row. */
  field?: string;
}

export interface Step {
  key: string;
  kind: StepKind;
  /** Short label for the progress rail. */
  rail: string;
  title: string;
  /** ISO timestamp of the first event in the step, or null when the trace has none. */
  at: string | null;
  /** Milliseconds since run.started. */
  offsetMs: number | null;
  /** Human duration note, built only from duration_ms or start/end times. */
  duration: string | null;
  tone: Tone;
  /** Main text, quoted from the trace. */
  text?: string;
  facts: Fact[];
  /** Small bulleted list (citations, evidence, …). */
  list?: { heading: string; items: string[] };
  hypotheses?: Hypothesis[];
  /** One-line muted note. */
  note?: string;
  refs: StepRefs;
  /** The trace rows behind this step, for the "raw" toggle. */
  raw: unknown[];
}

export interface Replay {
  slug: string;
  title: string;
  runId: string;
  provider: string;
  model: string;
  exportedOn: string;
  scenario: string;
  steps: Step[];
}

// ---------------------------------------------------------------- formatting

export function ms(n: number): string {
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(2)} s`;
}

/** "06:14:51.547 UTC" from an ISO timestamp, without Date parsing drift. */
export function clock(iso: string): string {
  const m = /T(\d{2}:\d{2}:\d{2})(\.\d{1,3})?/.exec(iso);
  return m ? `${m[1]}${(m[2] ?? '.000').padEnd(4, '0')} UTC` : iso;
}

function time(iso: string): number {
  return Date.parse(iso);
}

function compactArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([k]) => k !== 'service')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : String(v)}`)
    .join(', ');
}

function hhmm(iso: string): string {
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? `${iso.slice(0, 10)} ${m[1]}` : iso;
}

/** A short, field-for-field summary of a READ tool's stored result. */
export function summarizeToolResult(tool: string, result: any): string {
  if (result == null) return 'No result stored.';
  switch (tool) {
    case 'get_service_health':
      return `${result.name}: ${result.state} (${result.environment})`;
    case 'get_metrics': {
      const ms = (result.metrics ?? []) as { metric_name: string; value: number }[];
      if (!ms.length) return 'No metrics returned.';
      return ms.map((m) => `${m.metric_name} = ${m.value}`).join('; ');
    }
    case 'search_logs': {
      const logs = (result.logs ?? []) as { level: string; message: string }[];
      if (!logs.length) return 'No matching log lines.';
      return `${logs.length} log line${logs.length > 1 ? 's' : ''}: ` + logs.map((l) => `[${l.level}] ${l.message}`).join(' | ');
    }
    case 'get_recent_deployments': {
      const ds = (result.deployments ?? []) as { version: string; status: string; deployed_at: string }[];
      if (!ds.length) return 'No deployments returned.';
      return `${ds.length} deployment${ds.length > 1 ? 's' : ''}: ` + ds.map((d) => `${d.version} (${d.status}, ${hhmm(d.deployed_at)})`).join('; ');
    }
    case 'get_incident_history': {
      const is = (result.incidents ?? []) as { title: string; severity: string; status: string }[];
      if (!is.length) return 'No incidents returned.';
      return `${is.length} incident${is.length > 1 ? 's' : ''}: ` + is.map((i) => `${i.title} (${i.severity}, ${i.status})`).join('; ');
    }
    default:
      return `Result fields: ${Object.keys(result).join(', ')}`;
  }
}

const outcomeLabel: Record<string, string> = {
  allow: 'Allow',
  deny: 'Deny',
  require_approval: 'Needs approval',
};

const outcomeTone: Record<string, Tone> = {
  allow: 'allow',
  deny: 'deny',
  require_approval: 'approval',
};

function evidenceLine(e: Evidence): string {
  return `${e.observation} (${e.source})`;
}

// ---------------------------------------------------------------- builder

export function buildReplay(trace: RawTrace): Replay {
  const agent = [...trace.agentEvents].sort((a, b) => a.event_id - b.event_id);
  const audit = [...trace.auditEvents].sort((a, b) => a.event_id - b.event_id);
  const usedAgent = new Set<number>();
  const usedAudit = new Set<number>();

  const findAgent = (pred: (e: AgentEvent) => boolean) => {
    const e = agent.find((x) => !usedAgent.has(x.event_id) && pred(x));
    if (e) usedAgent.add(e.event_id);
    return e;
  };
  const findAudit = (pred: (e: AuditEvent) => boolean) => {
    const e = audit.find((x) => !usedAudit.has(x.event_id) && pred(x));
    if (e) usedAudit.add(e.event_id);
    return e;
  };

  const started = findAgent((e) => e.event_type === 'run.started');
  if (!started) throw new Error(`${trace.slug}: no run.started event`);
  const t0 = time(started.occurred_at);
  const actor = String(started.details.actor ?? '');

  const steps: Step[] = [];
  const push = (
    s: Omit<Step, 'at' | 'offsetMs' | 'refs' | 'raw'>,
    a: (AgentEvent | undefined)[],
    u: (AuditEvent | undefined)[],
    extra: { toolCalls?: ToolCall[]; field?: string; raw?: unknown[] } = {},
  ) => {
    const ag = a.filter((x): x is AgentEvent => !!x);
    const au = u.filter((x): x is AuditEvent => !!x);
    const first = ag[0]?.occurred_at ?? au[0]?.occurred_at ?? null;
    steps.push({
      ...s,
      at: first,
      offsetMs: first ? time(first) - t0 : null,
      refs: {
        agent: ag.map((e) => e.event_id),
        audit: au.map((e) => e.event_id),
        toolCalls: (extra.toolCalls ?? []).map((t) => t.id),
        ...(extra.field ? { field: extra.field } : {}),
      },
      raw: [...ag, ...au, ...(extra.toolCalls ?? []), ...(extra.raw ?? [])],
    });
  };

  // 1. Request
  const login = findAudit((e) => e.event_type === 'auth.login' && e.actor === actor);
  const agentStarted = findAudit((e) => e.event_type === 'agent.started');
  const reqFacts: Fact[] = [{ label: 'Signed in as', value: `${actor} (role: ${login?.result?.role ?? actor})` }];
  if (trace.incident) {
    reqFacts.push({ label: 'Incident', value: `#${trace.incident.id} ${trace.incident.title} (${trace.incident.severity})` });
  }
  push(
    {
      key: 'request',
      kind: 'request',
      rail: 'Request',
      title: 'Request',
      duration: null,
      tone: 'neutral',
      text: trace.run.user_request,
      facts: reqFacts,
      note: trace.incident?._source && !trace.incident._source.startsWith('incidents row')
        ? `Incident details come from the OpsBench world definition; the live row was reset later.`
        : undefined,
    },
    [started],
    [login, agentStarted],
  );

  // 2. Retrieval (runs before the first model call)
  const retrieval = findAgent((e) => e.event_type === 'retrieval');
  if (retrieval) {
    const cites = trace.run.knowledge_citations ?? [];
    push(
      {
        key: 'retrieval',
        kind: 'retrieval',
        rail: 'Runbooks',
        title: 'Retrieved runbooks',
        duration: retrieval.duration_ms != null ? ms(retrieval.duration_ms) : null,
        tone: 'neutral',
        facts: [
          { label: 'Mode', value: String(retrieval.details.mode ?? '') },
          { label: 'Citations', value: String(retrieval.details.citation_count ?? cites.length) },
        ],
        list: {
          heading: 'Cited documents (hybrid score)',
          items: cites.map((c) => `${c.document}: ${c.source} (${c.similarity.toFixed(3)})`),
        },
        note: 'The score mixes hashed bag-of-words cosine (45%) with a keyword score (55%): lexical, not semantic.',
      },
      [retrieval],
      [],
      { field: 'run.knowledge_citations' },
    );
  }

  // 3. Tool calls: the model's decision event, the tool event, the audit row and the tool-call row.
  const calls = [...trace.toolCalls].sort((a, b) => a.call_index - b.call_index);
  calls.forEach((call, i) => {
    const toolEvent = agent.find((e) => e.details?.call_index === call.call_index && e.tool === call.tool && !e.model);
    const decision = toolEvent
      ? [...agent].reverse().find((e) => e.event_id < toolEvent.event_id && e.model && e.tool === call.tool && !usedAgent.has(e.event_id))
      : undefined;
    if (decision) usedAgent.add(decision.event_id);
    if (toolEvent) usedAgent.add(toolEvent.event_id);
    const auditRow = findAudit((e) => e.event_type === 'tool.called' && e.details?.tool === call.tool);
    const toolMs = time(call.end_time) - time(call.start_time);
    const durationParts = [];
    if (decision?.duration_ms != null) durationParts.push(`model decision ${ms(decision.duration_ms)}`);
    durationParts.push(`tool ${ms(toolMs)}`);
    const facts: Fact[] = [];
    const args = compactArgs(call.arguments);
    facts.push({ label: 'Arguments', value: `service="${call.arguments.service ?? ''}"${args ? ', ' + args : ''}`, mono: true });
    facts.push({ label: 'Result', value: call.success ? summarizeToolResult(call.tool, call.result) : `Failed: ${String(call.error)}` });
    if (decision?.details?.input_tokens != null) {
      facts.push({ label: 'Tokens', value: `${decision.details.input_tokens} in · ${decision.details.output_tokens} out` });
    }
    push(
      {
        key: `tool-${call.call_index}`,
        kind: 'tool',
        rail: `Tool ${i + 1}`,
        title: `Tool call ${i + 1} of ${calls.length}: ${call.tool}`,
        duration: durationParts.join(' · '),
        tone: 'neutral',
        facts,
      },
      [decision, toolEvent],
      [auditRow],
      { toolCalls: [call] },
    );
  });

  // 4. Diagnosis and competing hypotheses
  const diagnosis = findAgent((e) => e.event_type === 'diagnosis');
  // The runs row's diagnosis is rewritten when the run closes (it gains the
  // approval outcome), so show the text as first recorded: on run.paused, or
  // on run.completed when the run never paused.
  const diagnosisText: string | null =
    agent.find((e) => e.event_type === 'run.paused' && typeof e.details?.diagnosis === 'string')?.details.diagnosis ??
    agent.find((e) => e.event_type === 'run.completed' && typeof e.details?.diagnosis === 'string')?.details.diagnosis ??
    trace.run.diagnosis;
  if (diagnosis) {
    push(
      {
        key: 'diagnosis',
        kind: 'diagnosis',
        rail: 'Hypotheses',
        title: 'Diagnosis and competing hypotheses',
        duration: diagnosis.duration_ms != null ? `model ${ms(diagnosis.duration_ms)}` : null,
        tone: 'neutral',
        text: diagnosisText ?? undefined,
        facts: diagnosis.details?.input_tokens != null
          ? [{ label: 'Tokens', value: `${diagnosis.details.input_tokens} in · ${diagnosis.details.output_tokens} out` }]
          : [],
        hypotheses: trace.hypotheses.map((h) => ({
          text: h.hypothesis,
          score: h.score,
          supporting: h.supporting_evidence,
          contradicting: h.contradicting_evidence,
        })),
        note: 'Scores are assigned by the model, not calibrated probabilities.',
      },
      [diagnosis],
      [],
      { field: 'hypotheses', raw: [trace.hypotheses] },
    );
  }

  // 5. Proposed action
  const proposed = findAgent((e) => e.event_type === 'action_proposed');
  if (proposed && trace.proposal) {
    const p = trace.proposal;
    const auditProposed = findAudit((e) => e.event_type === 'action.proposed');
    push(
      {
        key: 'proposal',
        kind: 'proposal',
        rail: 'Proposal',
        title: `Proposed action: ${p.action_type} on ${p.target}`,
        duration: null,
        tone: 'neutral',
        text: p.reason,
        facts: [
          { label: 'Action', value: p.action_type, mono: true },
          { label: 'Target', value: p.target, mono: true },
        ],
        list: { heading: 'Evidence the model cited', items: p.evidence.map(evidenceLine) },
      },
      [proposed],
      [auditProposed],
    );
  }

  // 6. Policy decision
  const policyEvent = findAgent((e) => e.event_type === 'policy');
  if (policyEvent && trace.policy) {
    const pol = trace.policy;
    const auditPolicy = findAudit((e) => e.event_type === 'policy.evaluated');
    push(
      {
        key: 'policy',
        kind: 'policy',
        rail: 'Policy',
        title: `Policy: ${outcomeLabel[pol.outcome] ?? pol.outcome}`,
        duration: null,
        tone: outcomeTone[pol.outcome] ?? 'neutral',
        text: pol.reason,
        facts: [
          { label: 'Risk', value: `${pol.risk_level} (from the server's table, not the model)` },
          { label: 'Role', value: pol.role },
          { label: 'Environment', value: pol.environment },
          { label: 'Outcome', value: pol.outcome, mono: true },
        ],
      },
      [policyEvent],
      [auditPolicy],
    );
  }

  // 7. Approval requested, run paused
  const pending = findAgent((e) => e.event_type === 'approval' && e.status === 'pending');
  if (pending && trace.approval) {
    const paused = findAgent((e) => e.event_type === 'run.paused');
    const reqRow = findAudit((e) => e.event_type === 'approval.requested');
    const linked = findAudit((e) => e.event_type === 'incident.investigation_linked');
    const pausedRow = findAudit((e) => e.event_type === 'agent.paused');
    push(
      {
        key: 'approval-request',
        kind: 'approval-request',
        rail: 'Approval',
        title: 'Approval requested; the run pauses',
        duration: null,
        tone: 'approval',
        facts: [
          { label: 'Approval', value: `#${trace.approval.id}, requested by ${trace.approval.requested_by}` },
          { label: 'Expires', value: clock(trace.approval.expires_at) },
        ],
        note: 'The approval is a database row, so it survives a server restart.',
      },
      [pending, paused],
      [reqRow, linked, pausedRow],
    );
  }

  // 8. The captured self-approval attempt (not an event: a recorded HTTP response)
  const self = trace.apiResponses?.selfApprovalAttempt;
  if (self) {
    steps.push({
      key: 'self-approval',
      kind: 'self-approval',
      rail: '403',
      title: `Self-approval attempt: HTTP ${self.httpStatus}`,
      at: null,
      offsetMs: null,
      duration: null,
      tone: 'deny',
      text: self.body.detail,
      facts: [{ label: 'Request', value: self.request, mono: true }],
      note: 'Captured HTTP response. A rejected attempt writes no audit row, so it has no event id or timestamp.',
      refs: { agent: [], audit: [], toolCalls: [], field: 'apiResponses.selfApprovalAttempt' },
      raw: [self],
    });
  }

  // 9. Human decision
  const decided = findAgent((e) => e.event_type === 'approval' && (e.status === 'approved' || e.status === 'rejected'));
  if (decided && trace.approval) {
    const reviewer = String(decided.details.decided_by ?? trace.approval.decided_by ?? '');
    const reviewerLogin = findAudit((e) => e.event_type === 'auth.login' && e.actor === reviewer);
    const decisionRow = findAudit((e) => e.event_type === 'approval.granted' || e.event_type === 'approval.rejected');
    const approved = decided.status === 'approved';
    push(
      {
        key: 'approval-decision',
        kind: 'approval-decision',
        rail: approved ? 'Approved' : 'Rejected',
        title: `${reviewer} ${approved ? 'approves' : 'rejects'}`,
        duration: decided.duration_ms != null ? ms(decided.duration_ms) : null,
        tone: approved ? 'allow' : 'deny',
        text: String(decided.details.reason ?? trace.approval.reason ?? ''),
        facts: [
          { label: 'Decided by', value: `${reviewer} (role: ${reviewerLogin?.result?.role ?? reviewer})` },
          { label: 'Decision', value: String(decided.status), mono: true },
        ],
      },
      [decided],
      [reviewerLogin, decisionRow],
    );
  }

  // 10. Execution (simulated)
  const exec = findAgent((e) => e.event_type === 'execution');
  if (exec) {
    const r = exec.details.result ?? {};
    const execRow = findAudit((e) => e.event_type === 'action.executed');
    const pre = r.pre_action_state;
    const post = r.post_action_state;
    const facts: Fact[] = [{ label: 'Status', value: String(r.status ?? exec.status), mono: true }];
    if (pre && post) {
      facts.push({ label: 'Service state', value: `${pre.state} → ${post.state}` });
      for (const k of Object.keys(pre.metrics ?? {})) {
        facts.push({ label: k, value: `${pre.metrics[k]} → ${post.metrics?.[k]}`, mono: true });
      }
    }
    push(
      {
        key: 'execution',
        kind: 'execution',
        rail: 'Execute',
        title: `Execution: ${r.action_type ?? exec.tool} on ${r.target ?? ''}`,
        duration: exec.duration_ms != null ? ms(exec.duration_ms) : null,
        tone: 'neutral',
        text: r.message,
        facts,
      },
      [exec],
      [execRow],
    );
  }

  // 11. Verification
  const verify = findAgent((e) => e.event_type === 'verification');
  if (verify && trace.verification) {
    const vRow = findAudit((e) => e.event_type === 'verification.completed');
    const resolved = findAudit((e) => e.event_type === 'incident.resolved');
    const ok = trace.verification.status === 'SUCCESS';
    push(
      {
        key: 'verification',
        kind: 'verification',
        rail: 'Verify',
        title: `Verification: ${trace.verification.status}`,
        duration: null,
        tone: ok ? 'allow' : 'deny',
        text: trace.verification.reason,
        facts: [
          { label: 'Attempts', value: String(trace.verification.attempt_count) },
          { label: 'Resolved incidents', value: (verify.details.resolved_incident_ids ?? []).map((i: number) => `#${i}`).join(', ') || 'none' },
        ],
      },
      [verify],
      [vRow, resolved],
    );
  }

  // 12. Outcome and audit trail: everything left over belongs to the run's close.
  const completed = findAgent((e) => e.event_type === 'run.completed');
  const restAgent = agent.filter((e) => !usedAgent.has(e.event_id));
  restAgent.forEach((e) => usedAgent.add(e.event_id));
  const restAudit = audit.filter((e) => !usedAudit.has(e.event_id));
  restAudit.forEach((e) => usedAudit.add(e.event_id));
  const runAudit = trace.auditEvents.filter((e) => e.run_id === trace.run.run_id).length;
  const loginAudit = trace.auditEvents.length - runAudit;
  const outcomeFacts: Fact[] = [
    { label: 'Audit rows', value: `${trace.auditEvents.length} (${runAudit} for this run + ${loginAudit} sign-in${loginAudit === 1 ? '' : 's'})` },
    { label: 'Agent events', value: String(trace.agentEvents.length) },
    { label: 'Tool calls', value: String(trace.toolCalls.length) },
    { label: 'Approval row', value: trace.approval ? `${trace.approval.decision}` : 'none created' },
    { label: 'Action row', value: trace.action ? `${trace.action.status}${trace.action.executed_at ? '' : ', not executed'}` : 'none created' },
  ];
  // Only the happy-path file has the live incident row; the others carry the
  // world definition, whose status is the starting state, not the outcome.
  if (trace.incident?._source?.startsWith('incidents row')) {
    outcomeFacts.push({ label: 'Incident status', value: trace.incident.status });
  }
  const closing = restAudit.find((e) => e.event_type === 'agent.completed');
  push(
    {
      key: 'outcome',
      kind: 'outcome',
      rail: 'Audit',
      title: 'Run completed: audit trail',
      duration: trace.run.completed_at ? `whole run ${ms(time(trace.run.completed_at) - time(trace.run.created_at))}` : null,
      tone: 'neutral',
      text: closing?.reason && closing.reason !== trace.run.diagnosis && closing.reason !== diagnosisText ? closing.reason : undefined,
      facts: outcomeFacts,
      note: 'audit_events and agent_events are append-only; database triggers reject updates and deletes.',
    },
    [completed, ...restAgent],
    restAudit,
  );

  return {
    slug: trace.slug,
    title: trace.title,
    runId: trace.run.run_id,
    provider: trace.provider,
    model: trace.model,
    exportedOn: trace.exportedAt.slice(0, 10),
    scenario: trace.scenario,
    steps,
  };
}
