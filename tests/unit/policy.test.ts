// Mirrors OpsPilot backend/tests/test_policy.py, plus a full matrix check.
import { describe, expect, it } from 'vitest';
import {
  ACTIONS, CUSTOMERS, POLICY_RULES, RISKS, RISK_BY_ACTION, ROLES, evaluate,
  type ActionType, type Role,
} from '../../src/lib/policy';

const restartProposal = () => ({ action_type: 'restart_service' as const, target: 'payments-api', risk_level: 'LOW' });
const proposal = (action_type: ActionType, target = 'payments-api') => ({ action_type, target, risk_level: 'LOW' });
const who = (role: Role) => ({ username: role[0], role });

describe('ported from test_policy.py', () => {
  it('viewer is denied a restart even when the LLM claims LOW risk', () => {
    const d = evaluate(restartProposal(), who('viewer'), 'production');
    expect(d.outcome).toBe('deny');
    expect(d.risk_level).toBe('HIGH');
  });

  it('operator needs approval for a production restart', () => {
    const d = evaluate(restartProposal(), who('operator'), 'production');
    expect(d.outcome).toBe('require_approval');
    expect(d.environment).toBe('production');
  });

  it('admin is allowed a configured HIGH-risk restart', () => {
    const d = evaluate(restartProposal(), who('admin'), 'production');
    expect(d.outcome).toBe('allow');
    expect(d.risk_level).toBe('HIGH');
  });

  it('environment changes the operator HIGH-risk outcome', () => {
    expect(evaluate(proposal('restart_service'), who('operator'), 'production').outcome).toBe('require_approval');
    expect(evaluate(proposal('restart_service', 'catalog-api'), who('operator'), 'staging').outcome).toBe('allow');
  });

  it('never permits CRITICAL actions in production', () => {
    for (const role of ROLES) {
      expect(evaluate(proposal('delete_data'), who(role), 'production').outcome, role).toBe('deny');
    }
    expect(evaluate(proposal('delete_data'), who('admin'), 'staging').outcome).toBe('require_approval');
  });

  it('the table covers every role and risk', () => {
    const want = ROLES.flatMap((r) => RISKS.map((k) => `${r}:${k}`)).sort();
    expect(Object.keys(POLICY_RULES).sort()).toEqual(want);
  });

  it('a spoofed risk on the proposal is ignored for every action', () => {
    for (const a of ACTIONS) {
      for (const spoof of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'none']) {
        const d = evaluate({ action_type: a, target: 'payments-api', risk_level: spoof }, who('viewer'), 'production');
        expect(d.risk_level).toBe(RISK_BY_ACTION[a]);
      }
    }
  });
});

describe('matches the Python source', () => {
  it('has the 7 action types and their risks', () => {
    expect(RISK_BY_ACTION).toEqual({
      create_incident: 'MEDIUM',
      update_incident: 'MEDIUM',
      create_github_issue: 'MEDIUM',
      generate_report: 'LOW',
      restart_service: 'HIGH',
      rollback_deployment: 'HIGH',
      delete_data: 'CRITICAL',
    });
  });

  it('every role × risk pair gives the documented production / staging outcomes', () => {
    const expected: Record<string, [string, string]> = {
      'viewer:LOW': ['allow', 'allow'],
      'viewer:MEDIUM': ['deny', 'deny'],
      'viewer:HIGH': ['deny', 'deny'],
      'viewer:CRITICAL': ['deny', 'deny'],
      'operator:LOW': ['allow', 'allow'],
      'operator:MEDIUM': ['allow', 'allow'],
      'operator:HIGH': ['require_approval', 'allow'],
      'operator:CRITICAL': ['deny', 'require_approval'],
      'admin:LOW': ['allow', 'allow'],
      'admin:MEDIUM': ['allow', 'allow'],
      'admin:HIGH': ['allow', 'allow'],
      'admin:CRITICAL': ['deny', 'require_approval'],
    };
    for (const role of ROLES) {
      for (const a of ACTIONS) {
        const [prod, other] = expected[`${role}:${RISK_BY_ACTION[a]}`];
        expect(evaluate(proposal(a), who(role), 'production').outcome, `${role} ${a} prod`).toBe(prod);
        expect(evaluate(proposal(a), who(role), 'staging').outcome, `${role} ${a} staging`).toBe(other);
      }
    }
  });

  it('uses the same reason text as the engine', () => {
    expect(evaluate(proposal('rollback_deployment'), who('operator'), 'production').reason)
      .toBe('operator policy evaluated rollback_deployment in production as HIGH risk.');
  });
});

describe('customer overlays only tighten', () => {
  const acme = CUSTOMERS.find((c) => c.id === 'acme-payments')!;
  const globex = CUSTOMERS.find((c) => c.id === 'globex-retail')!;

  it('Acme: every production restart needs approval, even for admins', () => {
    const d = evaluate(proposal('restart_service', 'checkout-api'), who('admin'), 'production', acme);
    expect(d.outcome).toBe('require_approval');
    expect(d.reason).toContain('Customer Acme Payments requires approval for every production restart.');
    expect(evaluate(proposal('restart_service', 'checkout-api'), who('admin'), 'staging', acme).outcome).toBe('allow');
  });

  it('Globex: GitHub issues are denied, unmanaged services are denied', () => {
    expect(evaluate(proposal('create_github_issue', 'checkout-api'), who('admin'), 'staging', globex).outcome).toBe('deny');
    const d = evaluate(proposal('generate_report', 'payments-api'), who('admin'), 'staging', globex);
    expect(d.outcome).toBe('deny');
    expect(d.reason).toBe('payments-api is not managed for customer Globex Retail.');
  });

  it('never loosens a decision', () => {
    const rank = { allow: 0, require_approval: 1, deny: 2 };
    for (const c of CUSTOMERS) {
      for (const role of ROLES) for (const a of ACTIONS) for (const env of ['production', 'staging']) {
        const base = evaluate(proposal(a, 'checkout-api'), who(role), env);
        const over = evaluate(proposal(a, 'checkout-api'), who(role), env, c);
        expect(rank[over.outcome]).toBeGreaterThanOrEqual(rank[base.outcome]);
      }
    }
  });
});
