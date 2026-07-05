export const brokerScopeDecisionCodes = [
  "BROKER_SCOPE_READY",
  "BROKER_SCOPE_MISSING",
] as const;

export type BrokerScopeDecisionCode = (typeof brokerScopeDecisionCodes)[number];

export const brokerCapabilityDecisionCodes = [
  "BROKER_CAPABILITY_READY",
  "BROKER_CAPABILITY_SYNC_REQUIRED",
  "BROKER_CAPABILITY_STALE",
  "BROKER_CAPABILITY_UNSUPPORTED",
  "BROKER_ORDER_SHAPE_UNSUPPORTED",
] as const;

export type BrokerCapabilityDecisionCode =
  (typeof brokerCapabilityDecisionCodes)[number];

export const providerBlockReasons = [
  "PROVIDER_ELIGIBLE",
  "PROVIDER_RESEARCH_REQUIRED",
  "PROVIDER_INSUFFICIENT_CAPABILITY",
  "PROVIDER_UNSUPPORTED",
  "PROVIDER_SPECIAL_CONNECTOR_REQUIRED",
  "PROVIDER_COMPLIANCE_REVIEW_REQUIRED",
] as const;

export type ProviderBlockReason = (typeof providerBlockReasons)[number];

export type ProviderCapabilityDecisionCode =
  | BrokerCapabilityDecisionCode
  | Extract<
      ProviderBlockReason,
      "PROVIDER_INSUFFICIENT_CAPABILITY" | "PROVIDER_RESEARCH_REQUIRED"
    >;

export const providerCapabilityDecisionCodes = [
  ...brokerCapabilityDecisionCodes,
  "PROVIDER_INSUFFICIENT_CAPABILITY",
  "PROVIDER_RESEARCH_REQUIRED",
] as const satisfies readonly ProviderCapabilityDecisionCode[];

export type ExecutionDecisionCode =
  | BrokerScopeDecisionCode
  | BrokerCapabilityDecisionCode
  | ProviderBlockReason
  | ProviderCapabilityDecisionCode;

export const executionDecisionCodes = [
  ...brokerScopeDecisionCodes,
  ...brokerCapabilityDecisionCodes,
  ...providerBlockReasons,
  ...providerCapabilityDecisionCodes,
] as const satisfies readonly ExecutionDecisionCode[];
