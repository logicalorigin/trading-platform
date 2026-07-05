import type { ProviderAdapterKind } from "./broker-provider-classification";
import {
  getExecutionDecisionEntryOrThrow,
  type ExecutionCustomerMessageKey,
  type ExecutionDecisionRedactionClass,
  type ExecutionDecisionSeverity,
} from "./execution-decision-registry";
import {
  brokerCapabilityDecisionCodes,
  type BrokerCapabilityDecisionCode,
} from "./execution-decision-codes";

export { brokerCapabilityDecisionCodes, type BrokerCapabilityDecisionCode };

export const brokerAssetClasses = [
  "stocks",
  "single_leg_options",
  "multi_leg_options_spreads",
  "combo_orders",
] as const;

export type BrokerAssetClass = (typeof brokerAssetClasses)[number];
export type BrokerV1AssetClass = "stocks" | "single_leg_options";

export const brokerOrderTypes = [
  "market",
  "limit",
  "stop",
  "stop_limit",
] as const;

export type BrokerOrderType = (typeof brokerOrderTypes)[number];

export const brokerTimeInForceValues = ["day", "gtc", "ioc", "fok"] as const;

export type BrokerTimeInForce = (typeof brokerTimeInForceValues)[number];

export const brokerTradingSessions = [
  "regular",
  "extended",
  "overnight",
] as const;

export type BrokerTradingSession = (typeof brokerTradingSessions)[number];

export type BrokerAccountEnvironment = "live" | "paper" | "demo" | "shadow";
export type BrokerConnectionType = "broker" | "market_data";
export type BrokerScopeStatus = "complete" | "missing" | "unknown" | "stale";
export type BrokerFreshnessSource = "streaming" | "polling" | "snapshot";
export type BrokerCancelReplaceField =
  | "quantity"
  | "limit_price"
  | "stop_price"
  | "time_in_force";

export type BrokerFeatureSupport = {
  supported: boolean;
};

export type BrokerFreshnessPolicy = {
  source: BrokerFreshnessSource;
  maxAgeMs: number;
};

export type BrokerAccountCapabilityMap = {
  provider: string;
  adapterKind: ProviderAdapterKind;
  connectionId: string;
  brokerAccountIdHash: string;
  accountEnvironment: BrokerAccountEnvironment;
  connectionType: BrokerConnectionType;
  scopeStatus: BrokerScopeStatus;
  assetClasses: BrokerV1AssetClass[];
  orderTypes: BrokerOrderType[];
  timeInForce: BrokerTimeInForce[];
  sessions: BrokerTradingSession[];
  routes: string[];
  trailingStops: BrokerFeatureSupport;
  brackets: BrokerFeatureSupport;
  oco: BrokerFeatureSupport;
  oso: BrokerFeatureSupport;
  cancelReplace: {
    supported: boolean;
    fields: BrokerCancelReplaceField[];
  };
  preview: BrokerFeatureSupport;
  orderStatusStreaming: BrokerFeatureSupport;
  positionFreshnessPolicy: BrokerFreshnessPolicy;
  orderFreshnessPolicy: BrokerFreshnessPolicy;
  executionFreshnessPolicy: BrokerFreshnessPolicy;
  knownLimitations: string[];
  lastSyncedAt: string | null;
  expiresAt: string | null;
};

export type BrokerCapabilityMapValidation = {
  valid: boolean;
  errors: string[];
};

export type BrokerCapabilityMapReadiness = {
  outcome: "ready" | "blocked";
  decisionCode: BrokerCapabilityDecisionCode;
  customerMessageKey: ExecutionCustomerMessageKey;
  severity: ExecutionDecisionSeverity;
  auditEventHint: string;
  redactionClass: ExecutionDecisionRedactionClass;
  automationTradingConnection: boolean;
  blockedReasons: string[];
  validationErrors: string[];
};

export type OrderShapeCapabilityInput = {
  capabilityMap: BrokerAccountCapabilityMap;
  assetClass: BrokerAssetClass;
  orderType: BrokerOrderType;
  timeInForce: BrokerTimeInForce;
  session: BrokerTradingSession;
  route?: string | null;
};

export type OrderShapeCapabilityDecision = {
  outcome: "ready" | "blocked";
  decisionCode: "BROKER_CAPABILITY_READY" | "BROKER_ORDER_SHAPE_UNSUPPORTED";
  customerMessageKey: ExecutionCustomerMessageKey;
  severity: ExecutionDecisionSeverity;
  auditEventHint: string;
  redactionClass: ExecutionDecisionRedactionClass;
  missingCapabilities: string[];
};

const brokerAccountHashPattern = /^sha256:[a-f0-9]{64}$/;
const sensitiveLimitationPattern =
  /\b(access[_-]?token|refresh[_-]?token|authorization|bearer|secret|raw payload|DU\d{3,}|U\d{3,})\b/i;

function isValidIsoDate(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function expiredAtOrBefore(value: string | null, now: Date): boolean {
  if (!isValidIsoDate(value)) {
    return true;
  }
  return Date.parse(value as string) <= now.getTime();
}

function includesValue<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort();
}

export function validateBrokerCapabilityMap(
  capabilityMap: BrokerAccountCapabilityMap,
): BrokerCapabilityMapValidation {
  const errors: string[] = [];

  if (!capabilityMap.provider.trim()) {
    errors.push("provider_required");
  }
  if (!capabilityMap.connectionId.trim()) {
    errors.push("connection_id_required");
  }
  if (!brokerAccountHashPattern.test(capabilityMap.brokerAccountIdHash)) {
    errors.push("broker_account_id_hash_invalid");
  }
  if (!capabilityMap.assetClasses.length) {
    errors.push("asset_classes_required");
  }
  if (!capabilityMap.orderTypes.length) {
    errors.push("order_types_required");
  }
  if (!capabilityMap.timeInForce.length) {
    errors.push("time_in_force_required");
  }
  if (!capabilityMap.sessions.length) {
    errors.push("sessions_required");
  }
  if (!capabilityMap.routes.length) {
    errors.push("routes_required");
  }
  if (!isValidIsoDate(capabilityMap.lastSyncedAt)) {
    errors.push("last_synced_at_invalid");
  }
  if (!isValidIsoDate(capabilityMap.expiresAt)) {
    errors.push("expires_at_invalid");
  }
  for (const assetClass of capabilityMap.assetClasses) {
    if (assetClass !== "stocks" && assetClass !== "single_leg_options") {
      errors.push("asset_class_invalid");
    }
  }
  for (const orderType of capabilityMap.orderTypes) {
    if (!includesValue(brokerOrderTypes, orderType)) {
      errors.push("order_type_invalid");
    }
  }
  for (const timeInForce of capabilityMap.timeInForce) {
    if (!includesValue(brokerTimeInForceValues, timeInForce)) {
      errors.push("time_in_force_invalid");
    }
  }
  for (const session of capabilityMap.sessions) {
    if (!includesValue(brokerTradingSessions, session)) {
      errors.push("session_invalid");
    }
  }
  for (const limitation of capabilityMap.knownLimitations) {
    if (sensitiveLimitationPattern.test(limitation)) {
      errors.push("known_limitation_contains_sensitive_material");
    }
  }

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

export function evaluateBrokerCapabilityMapReadiness(input: {
  capabilityMap: BrokerAccountCapabilityMap | null;
  now: Date;
}): BrokerCapabilityMapReadiness {
  if (!input.capabilityMap) {
    const decisionEntry = getExecutionDecisionEntryOrThrow(
      "BROKER_CAPABILITY_SYNC_REQUIRED",
    );
    return {
      outcome: "blocked",
      decisionCode: "BROKER_CAPABILITY_SYNC_REQUIRED",
      customerMessageKey: decisionEntry.customerMessageKey,
      severity: decisionEntry.severity,
      auditEventHint: decisionEntry.auditEventHint,
      redactionClass: decisionEntry.redactionClass,
      automationTradingConnection: false,
      blockedReasons: ["capability.sync.required"],
      validationErrors: [],
    };
  }

  const validation = validateBrokerCapabilityMap(input.capabilityMap);
  if (!validation.valid) {
    const decisionEntry = getExecutionDecisionEntryOrThrow(
      "BROKER_CAPABILITY_SYNC_REQUIRED",
    );
    return {
      outcome: "blocked",
      decisionCode: "BROKER_CAPABILITY_SYNC_REQUIRED",
      customerMessageKey: decisionEntry.customerMessageKey,
      severity: decisionEntry.severity,
      auditEventHint: decisionEntry.auditEventHint,
      redactionClass: decisionEntry.redactionClass,
      automationTradingConnection: false,
      blockedReasons: ["capability.sync.required"],
      validationErrors: validation.errors,
    };
  }

  if (
    input.capabilityMap.scopeStatus === "unknown" ||
    input.capabilityMap.scopeStatus === "missing"
  ) {
    const decisionEntry = getExecutionDecisionEntryOrThrow(
      "BROKER_CAPABILITY_SYNC_REQUIRED",
    );
    return {
      outcome: "blocked",
      decisionCode: "BROKER_CAPABILITY_SYNC_REQUIRED",
      customerMessageKey: decisionEntry.customerMessageKey,
      severity: decisionEntry.severity,
      auditEventHint: decisionEntry.auditEventHint,
      redactionClass: decisionEntry.redactionClass,
      automationTradingConnection: false,
      blockedReasons: ["capability.sync.required"],
      validationErrors: [],
    };
  }

  if (
    input.capabilityMap.scopeStatus === "stale" ||
    expiredAtOrBefore(input.capabilityMap.expiresAt, input.now)
  ) {
    const decisionEntry = getExecutionDecisionEntryOrThrow(
      "BROKER_CAPABILITY_STALE",
    );
    return {
      outcome: "blocked",
      decisionCode: "BROKER_CAPABILITY_STALE",
      customerMessageKey: decisionEntry.customerMessageKey,
      severity: decisionEntry.severity,
      auditEventHint: decisionEntry.auditEventHint,
      redactionClass: decisionEntry.redactionClass,
      automationTradingConnection: false,
      blockedReasons: ["capability.sync.stale"],
      validationErrors: [],
    };
  }

  if (
    !input.capabilityMap.assetClasses.length ||
    !input.capabilityMap.orderTypes.length ||
    !input.capabilityMap.cancelReplace.supported
  ) {
    const decisionEntry = getExecutionDecisionEntryOrThrow(
      "BROKER_CAPABILITY_UNSUPPORTED",
    );
    return {
      outcome: "blocked",
      decisionCode: "BROKER_CAPABILITY_UNSUPPORTED",
      customerMessageKey: decisionEntry.customerMessageKey,
      severity: decisionEntry.severity,
      auditEventHint: decisionEntry.auditEventHint,
      redactionClass: decisionEntry.redactionClass,
      automationTradingConnection: false,
      blockedReasons: ["capability.unsupported"],
      validationErrors: [],
    };
  }

  const decisionEntry = getExecutionDecisionEntryOrThrow(
    "BROKER_CAPABILITY_READY",
  );
  return {
    outcome: "ready",
    decisionCode: "BROKER_CAPABILITY_READY",
    customerMessageKey: decisionEntry.customerMessageKey,
    severity: decisionEntry.severity,
    auditEventHint: decisionEntry.auditEventHint,
    redactionClass: decisionEntry.redactionClass,
    automationTradingConnection: true,
    blockedReasons: [],
    validationErrors: [],
  };
}

export function evaluateOrderShapeCapability(
  input: OrderShapeCapabilityInput,
): OrderShapeCapabilityDecision {
  const missingCapabilities: string[] = [];

  if (
    input.assetClass !== "stocks" &&
    input.assetClass !== "single_leg_options"
  ) {
    missingCapabilities.push(`asset_class:${input.assetClass}`);
  } else if (!input.capabilityMap.assetClasses.includes(input.assetClass)) {
    missingCapabilities.push(`asset_class:${input.assetClass}`);
  }

  if (!input.capabilityMap.orderTypes.includes(input.orderType)) {
    missingCapabilities.push(`order_type:${input.orderType}`);
  }

  if (!input.capabilityMap.timeInForce.includes(input.timeInForce)) {
    missingCapabilities.push(`time_in_force:${input.timeInForce}`);
  }

  if (!input.capabilityMap.sessions.includes(input.session)) {
    missingCapabilities.push(`session:${input.session}`);
  }

  if (
    input.route &&
    input.capabilityMap.routes.length > 0 &&
    !input.capabilityMap.routes.includes(input.route)
  ) {
    missingCapabilities.push(`route:${input.route}`);
  }

  if (missingCapabilities.length > 0) {
    const decisionEntry = getExecutionDecisionEntryOrThrow(
      "BROKER_ORDER_SHAPE_UNSUPPORTED",
    );
    return {
      outcome: "blocked",
      decisionCode: "BROKER_ORDER_SHAPE_UNSUPPORTED",
      customerMessageKey: decisionEntry.customerMessageKey,
      severity: decisionEntry.severity,
      auditEventHint: decisionEntry.auditEventHint,
      redactionClass: decisionEntry.redactionClass,
      missingCapabilities,
    };
  }

  const decisionEntry = getExecutionDecisionEntryOrThrow(
    "BROKER_CAPABILITY_READY",
  );
  return {
    outcome: "ready",
    decisionCode: "BROKER_CAPABILITY_READY",
    customerMessageKey: decisionEntry.customerMessageKey,
    severity: decisionEntry.severity,
    auditEventHint: decisionEntry.auditEventHint,
    redactionClass: decisionEntry.redactionClass,
    missingCapabilities: [],
  };
}
