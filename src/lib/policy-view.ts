// HTML for the policy playground (build-time fallback and browser).
import { esc, ICON } from './html';
import { ACTIONS, CUSTOMERS, ENVIRONMENTS, OUTCOME_LABEL, POLICY_RULES, RISKS, RISK_BY_ACTION, ROLES, type Outcome, type PolicyDecision } from './policy';

const TONE: Record<Outcome, 'allow' | 'approval' | 'deny'> = {
  allow: 'allow',
  require_approval: 'approval',
  deny: 'deny',
};

const SHORT: Record<Outcome, string> = { allow: 'Allow', require_approval: 'Approval', deny: 'Deny' };

/** Compact table cell: icon plus a one-word label (full label for screen readers). */
export function outcomeBadge(o: Outcome): string {
  return `<span class="outcome tone-${TONE[o]}" title="${esc(OUTCOME_LABEL[o])}">${ICON[TONE[o]]}<span aria-hidden="true">${SHORT[o]}</span><span class="visually-hidden">${esc(OUTCOME_LABEL[o])}</span></span>`;
}

export function renderDecision(d: PolicyDecision): string {
  return `<div class="decision tone-${TONE[d.outcome]}" data-outcome="${d.outcome}">
    <p class="decision-outcome">${ICON[TONE[d.outcome]]}<span>${esc(OUTCOME_LABEL[d.outcome])}</span></p>
    <p class="decision-reason mono">${esc(d.reason)}</p>
    <p class="decision-risk muted">Risk ${esc(d.risk_level)} comes from the server's table for ${esc(d.action_type)}. A risk level claimed by the model is ignored.</p>
  </div>`;
}

/** The base rules as two small tables, one per environment. */
export function renderMatrix(): string {
  return ENVIRONMENTS.map((env, e) => {
    const rows = ROLES.map(
      (role) =>
        `<tr><th scope="row">${role}</th>${RISKS.map((risk) => `<td>${outcomeBadge(POLICY_RULES[`${role}:${risk}`][e])}</td>`).join('')}</tr>`,
    ).join('');
    return `<div class="table-scroll"><table class="matrix">
      <caption>${env === 'production' ? 'Production' : 'Staging (any non-production environment)'}</caption>
      <thead><tr><th scope="col">Role</th>${RISKS.map((r) => `<th scope="col">${r}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }).join('');
}

export function renderActionRisks(): string {
  return `<ul class="action-risks mono">${ACTIONS.map((a) => `<li>${a} <span class="muted">${RISK_BY_ACTION[a]}</span></li>`).join('')}</ul>`;
}

export function renderForm(): string {
  const radios = (name: string, values: readonly string[], checked: string) =>
    `<div class="seg" role="radiogroup">${values
      .map(
        (v) =>
          `<label><input type="radio" name="${name}" value="${v}"${v === checked ? ' checked' : ''}><span>${v}</span></label>`,
      )
      .join('')}</div>`;
  return `<form class="policy-form" data-policy-form>
    <fieldset><legend class="field-label">Role</legend>${radios('role', ROLES, 'operator')}</fieldset>
    <label class="field"><span class="field-label">Action</span>
      <select name="action">${ACTIONS.map((a) => `<option value="${a}"${a === 'restart_service' ? ' selected' : ''}>${a} (${RISK_BY_ACTION[a]})</option>`).join('')}</select>
    </label>
    <fieldset><legend class="field-label">Environment</legend>${radios('env', ENVIRONMENTS, 'production')}</fieldset>
    <label class="field"><span class="field-label">Customer file</span>
      <select name="customer">${CUSTOMERS.map((c) => `<option value="${c.id}">${c.id === 'default' ? 'None (whole simulator)' : esc(c.name)}</option>`).join('')}</select>
    </label>
    <p class="hint muted">Target service: checkout-api, which both example customers manage. Customer files can only make a decision stricter.</p>
  </form>`;
}
