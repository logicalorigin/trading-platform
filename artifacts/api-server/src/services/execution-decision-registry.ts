import {
  executionDecisionCodes,
  type ExecutionDecisionCode,
} from "./execution-decision-codes";

export type { ExecutionDecisionCode } from "./execution-decision-codes";

export const executionDecisionGateFamilies = [
  "scope",
  "capability",
  "provider",
] as const;

export type ExecutionDecisionGateFamily =
  (typeof executionDecisionGateFamilies)[number];

export const executionDecisionOutcomes = ["allowed", "blocked"] as const;

export type ExecutionDecisionOutcome =
  (typeof executionDecisionOutcomes)[number];

export const executionDecisionSeverities = [
  "info",
  "action_required",
  "blocked",
  "security_blocked",
  "provider_limitation",
] as const;

export type ExecutionDecisionSeverity =
  (typeof executionDecisionSeverities)[number];

export const executionDecisionRedactionClasses = [
  "customer_safe",
  "support_safe",
  "internal_only",
] as const;

export type ExecutionDecisionRedactionClass =
  (typeof executionDecisionRedactionClasses)[number];

export const executionDecisionSurfaces = [
  "api",
  "audit",
  "platform",
  "portal",
  "support",
] as const;

export type ExecutionDecisionSurface =
  (typeof executionDecisionSurfaces)[number];

export type ExecutionCustomerMessageKey =
  | "broker.provider.complianceReviewRequired"
  | "broker.provider.eligible"
  | "broker.provider.ibkrSpecialConnector"
  | "broker.provider.insufficientCapability"
  | "broker.provider.researchRequired"
  | "broker.provider.unsupported"
  | "broker.scope.automationTradingConnection.missingRequired"
  | "broker.scope.ready"
  | "capability.asset_class.single_leg_options.unsupported"
  | "capability.cancel_replace.unsupported"
  | "capability.order_shape.unsupported"
  | "capability.order_status_streaming.unavailable"
  | "capability.preview.unavailable"
  | "capability.ready"
  | "capability.sync.required"
  | "capability.sync.stale"
  | "capability.unsupported"
  | "provider.demo.unsupported"
  | "provider.paper.unsupported"
  | "provider.read_only.unsupported"
  | "provider.submit_only.unsupported";

export type ExecutionDecisionEntry = {
  decisionCode: ExecutionDecisionCode;
  gateFamily: ExecutionDecisionGateFamily;
  outcome: ExecutionDecisionOutcome;
  customerMessageKey: ExecutionCustomerMessageKey;
  severity: ExecutionDecisionSeverity;
  auditEventHint: string;
  redactionClass: ExecutionDecisionRedactionClass;
  ownerTask: string;
  allowedSurfaces: ExecutionDecisionSurface[];
};

const brokerSurfaces = ["api", "audit", "platform", "portal", "support"] as const;

export const executionDecisionRegistry = [
  {
    decisionCode: "BROKER_SCOPE_READY",
    gateFamily: "scope",
    outcome: "allowed",
    customerMessageKey: "broker.scope.ready",
    severity: "info",
    auditEventHint: "broker_scope_ready",
    redactionClass: "customer_safe",
    ownerTask: "P1-1A",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "BROKER_SCOPE_MISSING",
    gateFamily: "scope",
    outcome: "blocked",
    customerMessageKey:
      "broker.scope.automationTradingConnection.missingRequired",
    severity: "action_required",
    auditEventHint: "broker_scope_missing",
    redactionClass: "customer_safe",
    ownerTask: "P1-1A",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "BROKER_CAPABILITY_READY",
    gateFamily: "capability",
    outcome: "allowed",
    customerMessageKey: "capability.ready",
    severity: "info",
    auditEventHint: "broker_capability_ready",
    redactionClass: "customer_safe",
    ownerTask: "P1-1B",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "BROKER_CAPABILITY_SYNC_REQUIRED",
    gateFamily: "capability",
    outcome: "blocked",
    customerMessageKey: "capability.sync.required",
    severity: "action_required",
    auditEventHint: "broker_capability_sync_required",
    redactionClass: "customer_safe",
    ownerTask: "P1-1B",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "BROKER_CAPABILITY_STALE",
    gateFamily: "capability",
    outcome: "blocked",
    customerMessageKey: "capability.sync.stale",
    severity: "action_required",
    auditEventHint: "broker_capability_stale",
    redactionClass: "customer_safe",
    ownerTask: "P1-1B",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "BROKER_CAPABILITY_UNSUPPORTED",
    gateFamily: "capability",
    outcome: "blocked",
    customerMessageKey: "capability.unsupported",
    severity: "provider_limitation",
    auditEventHint: "broker_capability_unsupported",
    redactionClass: "customer_safe",
    ownerTask: "P1-1B",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "BROKER_ORDER_SHAPE_UNSUPPORTED",
    gateFamily: "capability",
    outcome: "blocked",
    customerMessageKey: "capability.order_shape.unsupported",
    severity: "provider_limitation",
    auditEventHint: "broker_order_shape_unsupported",
    redactionClass: "customer_safe",
    ownerTask: "P1-1C",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "PROVIDER_ELIGIBLE",
    gateFamily: "provider",
    outcome: "allowed",
    customerMessageKey: "broker.provider.eligible",
    severity: "info",
    auditEventHint: "broker_provider_eligible",
    redactionClass: "customer_safe",
    ownerTask: "P1-1B",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "PROVIDER_RESEARCH_REQUIRED",
    gateFamily: "provider",
    outcome: "blocked",
    customerMessageKey: "broker.provider.researchRequired",
    severity: "blocked",
    auditEventHint: "broker_provider_research_required",
    redactionClass: "customer_safe",
    ownerTask: "P1-1B",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "PROVIDER_INSUFFICIENT_CAPABILITY",
    gateFamily: "provider",
    outcome: "blocked",
    customerMessageKey: "broker.provider.insufficientCapability",
    severity: "provider_limitation",
    auditEventHint: "broker_provider_insufficient_capability",
    redactionClass: "customer_safe",
    ownerTask: "P1-1B",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "PROVIDER_UNSUPPORTED",
    gateFamily: "provider",
    outcome: "blocked",
    customerMessageKey: "broker.provider.unsupported",
    severity: "blocked",
    auditEventHint: "broker_provider_unsupported",
    redactionClass: "customer_safe",
    ownerTask: "P1-1B",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "PROVIDER_SPECIAL_CONNECTOR_REQUIRED",
    gateFamily: "provider",
    outcome: "blocked",
    customerMessageKey: "broker.provider.ibkrSpecialConnector",
    severity: "action_required",
    auditEventHint: "broker_provider_special_connector_required",
    redactionClass: "customer_safe",
    ownerTask: "P1-1B",
    allowedSurfaces: [...brokerSurfaces],
  },
  {
    decisionCode: "PROVIDER_COMPLIANCE_REVIEW_REQUIRED",
    gateFamily: "provider",
    outcome: "blocked",
    customerMessageKey: "broker.provider.complianceReviewRequired",
    severity: "security_blocked",
    auditEventHint: "broker_provider_compliance_review_required",
    redactionClass: "customer_safe",
    ownerTask: "P1-1B",
    allowedSurfaces: [...brokerSurfaces],
  },
] as const satisfies readonly ExecutionDecisionEntry[];

const knownDecisionCodes = new Set<ExecutionDecisionCode>([
  ...executionDecisionCodes,
]);

const decisionEntryByCode = new Map(
  executionDecisionRegistry.map((entry) => [entry.decisionCode, entry]),
);

export type ExecutionDecisionRegistryValidation = {
  valid: boolean;
  errors: string[];
};

export function getExecutionDecisionEntry(
  decisionCode: string,
): ExecutionDecisionEntry | null {
  return decisionEntryByCode.get(decisionCode as ExecutionDecisionCode) ?? null;
}

export function getExecutionDecisionEntryOrThrow(
  decisionCode: ExecutionDecisionCode,
): ExecutionDecisionEntry {
  const entry = getExecutionDecisionEntry(decisionCode);
  if (!entry) {
    throw new Error(`Unregistered execution decision code: ${decisionCode}`);
  }
  return entry;
}

export function validateExecutionDecisionRegistry(
  entries: readonly ExecutionDecisionEntry[],
): ExecutionDecisionRegistryValidation {
  const errors: string[] = [];
  const seen = new Set<ExecutionDecisionCode>();

  for (const entry of entries) {
    if (seen.has(entry.decisionCode)) {
      errors.push(`duplicate_decision_code:${entry.decisionCode}`);
    }
    seen.add(entry.decisionCode);

    if (!knownDecisionCodes.has(entry.decisionCode)) {
      errors.push(`unknown_decision_code:${entry.decisionCode}`);
    }
    if (!entry.customerMessageKey) {
      errors.push(`missing_customer_message_key:${entry.decisionCode}`);
    }
    if (!entry.auditEventHint.trim()) {
      errors.push(`missing_audit_event_hint:${entry.decisionCode}`);
    }
    if (!entry.ownerTask.trim()) {
      errors.push(`missing_owner_task:${entry.decisionCode}`);
    }
    if (!entry.allowedSurfaces.length) {
      errors.push(`missing_allowed_surfaces:${entry.decisionCode}`);
    }
  }

  for (const decisionCode of knownDecisionCodes) {
    if (!seen.has(decisionCode)) {
      errors.push(`missing_decision_code:${decisionCode}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: Array.from(new Set(errors)).sort(),
  };
}
