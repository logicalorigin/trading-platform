import {
  getExecutionDecisionEntryOrThrow,
  type ExecutionCustomerMessageKey,
  type ExecutionDecisionRedactionClass,
  type ExecutionDecisionSeverity,
} from "./execution-decision-registry";
import {
  brokerScopeDecisionCodes,
  type BrokerScopeDecisionCode,
} from "./execution-decision-codes";

export { brokerScopeDecisionCodes, type BrokerScopeDecisionCode };

export const brokerExecutionScopes = [
  "account_identity_read",
  "account_balance_read",
  "position_read",
  "order_read",
  "execution_read",
  "order_submit",
  "order_cancel",
  "order_replace",
  "broker_reauth",
  "trade_preview",
  "order_update_stream",
  "market_data",
] as const;

export type BrokerExecutionScope = (typeof brokerExecutionScopes)[number];

export const AUTOMATION_TRADING_REQUIRED_SCOPES = [
  "account_identity_read",
  "account_balance_read",
  "position_read",
  "order_read",
  "execution_read",
  "order_submit",
  "order_cancel",
  "order_replace",
  "broker_reauth",
] as const satisfies readonly BrokerExecutionScope[];

export const AUTOMATION_TRADING_PREFERRED_SCOPES = [
  "trade_preview",
  "order_update_stream",
] as const satisfies readonly BrokerExecutionScope[];

export const DISABLED_BY_DEFAULT_BROKER_SCOPES = [
  "market_data",
] as const satisfies readonly BrokerExecutionScope[];

const brokerExecutionScopeSet = new Set<string>(brokerExecutionScopes);

export type BrokerScopeReadiness = {
  outcome: "ready" | "blocked";
  decisionCode: BrokerScopeDecisionCode;
  customerMessageKey: ExecutionCustomerMessageKey;
  severity: ExecutionDecisionSeverity;
  auditEventHint: string;
  redactionClass: ExecutionDecisionRedactionClass;
  automationTradingConnection: boolean;
  requiredScopes: BrokerExecutionScope[];
  normalizedScopes: BrokerExecutionScope[];
  missingRequiredScopes: BrokerExecutionScope[];
  missingPreferredScopes: BrokerExecutionScope[];
  disabledRequestedScopes: BrokerExecutionScope[];
  unknownScopes: string[];
};

export function isBrokerExecutionScope(
  value: string,
): value is BrokerExecutionScope {
  return brokerExecutionScopeSet.has(value);
}

function orderedScopes(scopes: ReadonlySet<BrokerExecutionScope>): BrokerExecutionScope[] {
  return brokerExecutionScopes.filter((scope) => scopes.has(scope));
}

export function normalizeBrokerExecutionScopes(input: Iterable<string>): {
  scopes: BrokerExecutionScope[];
  unknownScopes: string[];
} {
  const scopes = new Set<BrokerExecutionScope>();
  const unknownScopes = new Set<string>();

  for (const rawScope of input) {
    const scope = rawScope.trim();
    if (!scope) {
      continue;
    }
    if (isBrokerExecutionScope(scope)) {
      scopes.add(scope);
    } else {
      unknownScopes.add(scope);
    }
  }

  return {
    scopes: orderedScopes(scopes),
    unknownScopes: Array.from(unknownScopes).sort(),
  };
}

export function evaluateAutomationTradingScopeReadiness(
  input: Iterable<string>,
): BrokerScopeReadiness {
  const normalized = normalizeBrokerExecutionScopes(input);
  const scopeSet = new Set(normalized.scopes);
  const missingRequiredScopes = AUTOMATION_TRADING_REQUIRED_SCOPES.filter(
    (scope) => !scopeSet.has(scope),
  );
  const missingPreferredScopes = AUTOMATION_TRADING_PREFERRED_SCOPES.filter(
    (scope) => !scopeSet.has(scope),
  );
  const disabledRequestedScopes = DISABLED_BY_DEFAULT_BROKER_SCOPES.filter(
    (scope) => scopeSet.has(scope),
  );
  const ready = missingRequiredScopes.length === 0;
  const decisionCode = ready ? "BROKER_SCOPE_READY" : "BROKER_SCOPE_MISSING";
  const decisionEntry = getExecutionDecisionEntryOrThrow(decisionCode);

  return {
    outcome: ready ? "ready" : "blocked",
    decisionCode,
    customerMessageKey: decisionEntry.customerMessageKey,
    severity: decisionEntry.severity,
    auditEventHint: decisionEntry.auditEventHint,
    redactionClass: decisionEntry.redactionClass,
    automationTradingConnection: ready,
    requiredScopes: [...AUTOMATION_TRADING_REQUIRED_SCOPES],
    normalizedScopes: normalized.scopes,
    missingRequiredScopes,
    missingPreferredScopes,
    disabledRequestedScopes,
    unknownScopes: normalized.unknownScopes,
  };
}
