// HTML for the incident replay. Shared by the build-time fallback and the
// in-browser stepper.
import { esc, ICON } from './html';
import { clock, ms, type Replay, type Step } from './trace';

export function stepTime(s: Step): string {
  const parts: string[] = [];
  if (s.at) {
    parts.push(clock(s.at));
    parts.push(`+${ms(s.offsetMs ?? 0)}`);
  } else {
    parts.push('no timestamp');
  }
  if (s.duration) parts.push(s.duration);
  return parts.join(' · ');
}

function refs(s: Step): string {
  const r: string[] = [];
  if (s.refs.agent.length) r.push(`agent_events ${s.refs.agent.map((i) => `#${i}`).join(', ')}`);
  if (s.refs.audit.length) r.push(`audit_events ${s.refs.audit.map((i) => `#${i}`).join(', ')}`);
  if (s.refs.toolCalls.length) r.push(`agent_tool_calls ${s.refs.toolCalls.map((i) => `#${i}`).join(', ')}`);
  if (s.refs.field) r.push(`field ${s.refs.field}`);
  return r.join(' · ');
}

export function renderStep(s: Step, opts: { raw?: boolean; heading?: string } = {}): string {
  const h = opts.heading ?? 'h5';
  const icon = s.tone !== 'neutral' ? ICON[s.tone] : '';
  let out = `<article class="step tone-${s.tone}" data-step="${esc(s.key)}">`;
  out += `<${h} class="step-title">${icon}<span>${esc(s.title)}</span></${h}>`;
  out += `<p class="step-time mono">${esc(stepTime(s))}</p>`;
  if (s.text) out += `<blockquote class="step-text">${esc(s.text)}</blockquote>`;
  if (s.facts.length) {
    out += '<dl class="facts">';
    for (const f of s.facts) {
      out += `<div><dt>${esc(f.label)}</dt><dd${f.mono ? ' class="mono"' : ''}>${esc(f.value)}</dd></div>`;
    }
    out += '</dl>';
  }
  if (s.hypotheses?.length) {
    out += '<ol class="hyps">';
    for (const hy of s.hypotheses) {
      const pct = Math.round(Math.max(0, Math.min(1, hy.score)) * 100);
      out += `<li><p class="hyp-head"><span class="score mono">${esc(hy.score.toFixed(2))}</span> ${esc(hy.text)}</p>`;
      out += `<span class="meter" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
      for (const [label, ev] of [['Supporting', hy.supporting], ['Contradicting', hy.contradicting]] as const) {
        out += `<p class="ev-h">${label}${ev.length ? '' : ': none'}</p>`;
        if (ev.length) {
          out += '<ul class="ev">' + ev.map((e) => `<li>${esc(e.observation)} <span class="src mono">${esc(e.source)}</span></li>`).join('') + '</ul>';
        }
      }
      out += '</li>';
    }
    out += '</ol>';
  }
  if (s.list?.items.length) {
    out += `<p class="ev-h">${esc(s.list.heading)}</p><ul class="ev">${s.list.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  }
  if (s.note) out += `<p class="step-note">${esc(s.note)}</p>`;
  out += `<p class="step-refs mono">${esc(refs(s))}</p>`;
  if (opts.raw) {
    out += `<details class="raw"><summary class="mono">raw</summary><pre>${esc(JSON.stringify(s.raw, null, 2))}</pre></details>`;
  }
  out += '</article>';
  return out;
}

export function renderMeta(r: Replay): string {
  return `Real run exported from OpsPilot on ${esc(r.exportedOn)} · ${esc(r.provider)} · <span class="mono">${esc(r.model)}</span> · run <span class="mono">${esc(r.runId.slice(0, 8))}</span>`;
}

/** The no-JS version: every step, in order. */
export function renderAllSteps(r: Replay): string {
  return `<ol class="replay-all">${r.steps.map((s) => `<li>${renderStep(s)}</li>`).join('')}</ol>`;
}
