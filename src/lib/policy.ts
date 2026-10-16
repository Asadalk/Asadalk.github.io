// A line-for-line port of OpsPilot's policy engine
// (backend/app/policy/engine.py, and the customer overlay from
// backend/app/core/customer.py + backend/config/customers/*.toml).
// Tests in tests/unit/policy.test.ts mirror backend/tests/test_policy.py.

export type Role = 'viewer' | 'operator' | 'admin';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Outcome = 'allow' | 'deny' | 'require_approval';
export type Environment = 'production' | 'staging';
export type ActionType =
  | 'create_incident'
  | 'update_incident'
  | 'create_github_issue'
  | 'generate_report'
  | 'restart_service'
  | 'rollback_deployment'
  | 'delete_data';

export const ROLES: Role[] = ['viewer', 'operator', 'admin'];
export const RISKS: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const ENVIRONMENTS: Environment[] = ['production', 'staging'];

export const RISK_BY_ACTION: Record<ActionType, RiskLevel> = {
  create_incident: 'MEDIUM',
  update_incident: 'MEDIUM',
  create_github_issue: 'MEDIUM',
  generate_report: 'LOW',
  restart_service: 'HIGH',
  rollback_deployment: 'HIGH',
  delete_data: 'CRITICAL',
};

export const ACTIONS = Object.keys(RISK_BY_ACTION) as ActionType[];

// (role, canonical risk) -> [outcome in production, outcome elsewhere].
// Production is stricter: operators need approval for HIGH risk there, and
// CRITICAL actions are never permitted in production.
export const POLICY_RULES: Record<`${Role}:${RiskLevel}`, [Outcome, Outcome]> = {
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

export interface CustomerConfig {
  id: string;
  name: string;
  /** null: every simulator service. */
  managedServices: string[] | null;
  githubEnabled: boolean;
  productionRestartRequiresApproval: boolean;
}

/** DEFAULT_CUSTOMER: no customer file, unrestricted simulator. */
export const DEFAULT_CUSTOMER: CustomerConfig = {
  id: 'default',
  name: 'Simulator',
  managedServices: null,
  githubEnabled: true,
  productionRestartRequiresApproval: false,
};

/** backend/config/customers/*.toml, copied value for value. */
export const CUSTOMERS: CustomerConfig[] = [
  DEFAULT_CUSTOMER,
  {
    id: 'acme-payments',
    name: 'Acme Payments',
    managedServices: ['payments-api', 'checkout-api', 'auth-api', 'payments-worker'],
    githubEnabled: true,
    productionRestartRequiresApproval: true,
  },
  {
    id: 'globex-retail',
    name: 'Globex Retail',
    managedServices: ['checkout-api', 'inventory-api', 'notification-api', 'orders-api', 'catalog-api', 'auth-api'],
    githubEnabled: false,
    productionRestartRequiresApproval: false,
  },
];

export interface Proposal {
  action_type: ActionType;
  target: string;
  /** What the model claimed. Ignored: risk always comes from RISK_BY_ACTION. */
  risk_level?: string;
}

export interface Principal {
  username: string;
  role: Role;
}

export interface PolicyDecision {
  outcome: Outcome;
  reason: string;
  username: string;
  role: Role;
  action_type: ActionType;
  environment: string;
  risk_level: RiskLevel;
}

function manages(c: CustomerConfig, service: string): boolean {
  return c.managedServices === null || c.managedServices.includes(service);
}

export function evaluate(
  proposal: Proposal,
  principal: Principal,
  environment: string,
  customer: CustomerConfig = DEFAULT_CUSTOMER,
): PolicyDecision {
  // Risk comes from the server table, never from the model's proposal.
  const risk = RISK_BY_ACTION[proposal.action_type];
  const [productionOutcome, otherOutcome] = POLICY_RULES[`${principal.role}:${risk}`];
  let outcome: Outcome = environment === 'production' ? productionOutcome : otherOutcome;
  let reason = `${principal.role} policy evaluated ${proposal.action_type} in ${environment} as ${risk} risk.`;
  // Customer configuration can only make the decision stricter.
  const service = proposal.target.split('@', 1)[0];
  if (!manages(customer, service)) {
    outcome = 'deny';
    reason = `${service} is not managed for customer ${customer.name}.`;
  } else if (proposal.action_type === 'create_github_issue' && !customer.githubEnabled) {
    outcome = 'deny';
    reason = `The GitHub integration is disabled for customer ${customer.name}.`;
  } else if (
    customer.productionRestartRequiresApproval &&
    outcome === 'allow' &&
    proposal.action_type === 'restart_service' &&
    environment === 'production'
  ) {
    outcome = 'require_approval';
    reason += ` Customer ${customer.name} requires approval for every production restart.`;
  }
  return {
    outcome,
    reason,
    username: principal.username,
    role: principal.role,
    action_type: proposal.action_type,
    environment,
    risk_level: risk,
  };
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  allow: 'Allowed',
  require_approval: 'Needs approval',
  deny: 'Denied',
};
