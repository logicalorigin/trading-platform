import {
  AUTOMATION_TRADING_REQUIRED_SCOPES,
  evaluateAutomationTradingScopeReadiness,
  type BrokerExecutionScope,
} from "./broker-scope-contract";
import {
  getExecutionDecisionEntryOrThrow,
  type ExecutionCustomerMessageKey,
  type ExecutionDecisionRedactionClass,
  type ExecutionDecisionSeverity,
} from "./execution-decision-registry";
import {
  providerBlockReasons,
  type ProviderBlockReason,
} from "./execution-decision-codes";

export { providerBlockReasons, type ProviderBlockReason };

export const providerAdapterKinds = [
  "ibkr_special_connector",
  "aggregator",
  "direct_oauth",
  "read_only",
  "manual_only",
  "submit_only",
  "paper_demo",
  "unsupported",
] as const;

export type ProviderAdapterKind = (typeof providerAdapterKinds)[number];

export const providerCustomerV1Statuses = [
  "eligible_for_private_beta",
  "eligible_after_exception",
  "insufficient_capability",
  "unsupported_provider",
  "research_only",
  "ibkr_special_connector",
] as const;

export type ProviderCustomerV1Status =
  (typeof providerCustomerV1Statuses)[number];

export type ProviderClassificationSourceKind =
  | "official_provider_docs"
  | "aggregator_docs"
  | "internal_plan"
  | "fixture"
  | "compliance_review";

export type ProviderClassificationSourceRef = {
  kind: ProviderClassificationSourceKind;
  label: string;
  accessedOn: string;
  url?: string;
  path?: string;
};

export type ProviderClassificationRow = {
  providerKey: string;
  displayName: string;
  adapterKind: ProviderAdapterKind;
  customerV1Status: ProviderCustomerV1Status;
  requiredScopes: readonly BrokerExecutionScope[];
  knownLimitations: readonly string[];
  sourceRefs: readonly ProviderClassificationSourceRef[];
  verificationDate: string;
  defaultBlockReason: ProviderBlockReason;
  selectedBrokerageFixtureRef?: string | null;
};

export type ProviderClassificationValidation = {
  valid: boolean;
  errors: string[];
};

export type ProviderClassificationDecision = {
  outcome: "eligible" | "blocked" | "special_connector";
  decisionCode: ProviderBlockReason;
  customerMessageKey: ExecutionCustomerMessageKey;
  severity: ExecutionDecisionSeverity;
  auditEventHint: string;
  redactionClass: ExecutionDecisionRedactionClass;
  launchable: boolean;
  activationAllowed: boolean;
  executionAllowed: boolean;
  missingScopes: BrokerExecutionScope[];
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function hasOfficialSource(row: ProviderClassificationRow): boolean {
  return row.sourceRefs.some(
    (source) =>
      source.kind === "official_provider_docs" ||
      source.kind === "aggregator_docs",
  );
}

function requiresEligibilityEvidence(row: ProviderClassificationRow): boolean {
  return (
    row.customerV1Status === "eligible_for_private_beta" ||
    row.customerV1Status === "eligible_after_exception"
  );
}

export function validateProviderClassificationRow(
  row: ProviderClassificationRow,
): ProviderClassificationValidation {
  const errors: string[] = [];

  if (!row.providerKey.trim()) {
    errors.push("provider_key_required");
  }
  if (!providerAdapterKinds.includes(row.adapterKind)) {
    errors.push("adapter_kind_invalid");
  }
  if (!providerCustomerV1Statuses.includes(row.customerV1Status)) {
    errors.push("customer_v1_status_invalid");
  }
  if (!row.requiredScopes.length) {
    errors.push("required_scopes_required");
  }
  if (!row.knownLimitations.length) {
    errors.push("known_limitations_required");
  }
  if (!row.sourceRefs.length) {
    errors.push("source_refs_required");
  }
  for (const source of row.sourceRefs) {
    if (!source.label.trim()) {
      errors.push("source_ref_label_required");
    }
    if (!isoDatePattern.test(source.accessedOn)) {
      errors.push("source_ref_accessed_on_invalid");
    }
  }
  if (!isoDatePattern.test(row.verificationDate)) {
    errors.push("verification_date_required");
  }
  if (!providerBlockReasons.includes(row.defaultBlockReason)) {
    errors.push("default_block_reason_invalid");
  }
  if (requiresEligibilityEvidence(row) && !hasOfficialSource(row)) {
    errors.push("eligible_provider_requires_official_source_ref");
  }
  if (
    row.adapterKind === "aggregator" &&
    row.customerV1Status === "eligible_for_private_beta" &&
    !row.selectedBrokerageFixtureRef
  ) {
    errors.push("eligible_aggregator_requires_selected_brokerage_fixture");
  }

  return { valid: errors.length === 0, errors };
}

export function decideProviderClassification(
  row: ProviderClassificationRow,
): ProviderClassificationDecision {
  const validation = validateProviderClassificationRow(row);
  if (!validation.valid) {
    const decisionEntry = getExecutionDecisionEntryOrThrow(
      "PROVIDER_RESEARCH_REQUIRED",
    );
    return {
      outcome: "blocked",
      decisionCode: "PROVIDER_RESEARCH_REQUIRED",
      customerMessageKey: decisionEntry.customerMessageKey,
      severity: decisionEntry.severity,
      auditEventHint: decisionEntry.auditEventHint,
      redactionClass: decisionEntry.redactionClass,
      launchable: false,
      activationAllowed: false,
      executionAllowed: false,
      missingScopes: [...AUTOMATION_TRADING_REQUIRED_SCOPES],
    };
  }

  const scopeReadiness = evaluateAutomationTradingScopeReadiness(
    row.requiredScopes,
  );

  if (row.customerV1Status === "ibkr_special_connector") {
    const decisionEntry = getExecutionDecisionEntryOrThrow(
      "PROVIDER_SPECIAL_CONNECTOR_REQUIRED",
    );
    return {
      outcome: "special_connector",
      decisionCode: "PROVIDER_SPECIAL_CONNECTOR_REQUIRED",
      customerMessageKey: decisionEntry.customerMessageKey,
      severity: decisionEntry.severity,
      auditEventHint: decisionEntry.auditEventHint,
      redactionClass: decisionEntry.redactionClass,
      launchable: false,
      activationAllowed: false,
      executionAllowed: false,
      missingScopes: scopeReadiness.missingRequiredScopes,
    };
  }

  if (
    (row.customerV1Status === "eligible_for_private_beta" ||
      row.customerV1Status === "eligible_after_exception") &&
    row.defaultBlockReason === "PROVIDER_ELIGIBLE" &&
    scopeReadiness.outcome === "ready"
  ) {
    const decisionEntry = getExecutionDecisionEntryOrThrow("PROVIDER_ELIGIBLE");
    return {
      outcome: "eligible",
      decisionCode: "PROVIDER_ELIGIBLE",
      customerMessageKey: decisionEntry.customerMessageKey,
      severity: decisionEntry.severity,
      auditEventHint: decisionEntry.auditEventHint,
      redactionClass: decisionEntry.redactionClass,
      launchable: true,
      activationAllowed: true,
      executionAllowed: true,
      missingScopes: [],
    };
  }

  const decisionEntry = getExecutionDecisionEntryOrThrow(row.defaultBlockReason);
  return {
    outcome: "blocked",
    decisionCode: row.defaultBlockReason,
    customerMessageKey: decisionEntry.customerMessageKey,
    severity: decisionEntry.severity,
    auditEventHint: decisionEntry.auditEventHint,
    redactionClass: decisionEntry.redactionClass,
    launchable: false,
    activationAllowed: false,
    executionAllowed: false,
    missingScopes: scopeReadiness.missingRequiredScopes,
  };
}

const planSourceRef: ProviderClassificationSourceRef = {
  kind: "internal_plan",
  label: "Broker Execution Platform Architecture",
  path: "docs/plans/broker-execution-platform-architecture.md",
  accessedOn: "2026-06-26",
};

const ibkrWebApiSourceRef: ProviderClassificationSourceRef = {
  kind: "official_provider_docs",
  label: "IBKR Web API Documentation",
  url: "https://www.interactivebrokers.com/campus/ibkr-api-page/webapi-doc/",
  accessedOn: "2026-07-01",
};

const ibkrOAuthSourceRef: ProviderClassificationSourceRef = {
  kind: "official_provider_docs",
  label: "IBKR OAuth 1.0a Extended",
  url: "https://www.interactivebrokers.com/campus/ibkr-api-page/oauth-1-0a-extended/",
  accessedOn: "2026-07-01",
};

const robinhoodAgenticSourceRef: ProviderClassificationSourceRef = {
  kind: "official_provider_docs",
  label: "Robinhood Agentic Trading Overview",
  url: "https://robinhood.com/us/en/support/articles/agentic-trading-overview/",
  accessedOn: "2026-07-02",
};

export const initialProviderClassificationRows = [
  {
    providerKey: "ibkr",
    displayName: "Interactive Brokers",
    adapterKind: "ibkr_special_connector",
    customerV1Status: "ibkr_special_connector",
    requiredScopes: AUTOMATION_TRADING_REQUIRED_SCOPES,
    knownLimitations: [
      "Existing Gateway/bridge support is a special connector, not the default hosted SaaS broker path.",
    ],
    sourceRefs: [planSourceRef],
    verificationDate: "2026-06-26",
    defaultBlockReason: "PROVIDER_SPECIAL_CONNECTOR_REQUIRED",
    selectedBrokerageFixtureRef: null,
  },
  {
    providerKey: "ibkr_oauth",
    displayName: "Interactive Brokers OAuth",
    adapterKind: "direct_oauth",
    customerV1Status: "research_only",
    requiredScopes: AUTOMATION_TRADING_REQUIRED_SCOPES,
    knownLimitations: [
      "Third-party OAuth requires IBKR approval and compliance onboarding before customer use.",
      "The hosted OAuth adapter is not implemented yet; Client Portal Gateway remains an internal special connector only.",
      "A named account capability fixture must prove stocks, single-leg options, orders, fills, cancel, replace, and reauth before private beta.",
    ],
    sourceRefs: [ibkrWebApiSourceRef, ibkrOAuthSourceRef, planSourceRef],
    verificationDate: "2026-07-01",
    defaultBlockReason: "PROVIDER_COMPLIANCE_REVIEW_REQUIRED",
    selectedBrokerageFixtureRef: null,
  },
  {
    providerKey: "snaptrade",
    displayName: "SnapTrade",
    adapterKind: "aggregator",
    customerV1Status: "research_only",
    requiredScopes: AUTOMATION_TRADING_REQUIRED_SCOPES,
    knownLimitations: [
      "Generic aggregator support is insufficient; a named underlying brokerage/account fixture must prove stocks and single-leg options.",
      "Current official-doc, token-custody, and compliance review are still required before private-beta eligibility.",
    ],
    sourceRefs: [planSourceRef],
    verificationDate: "2026-06-26",
    defaultBlockReason: "PROVIDER_RESEARCH_REQUIRED",
    selectedBrokerageFixtureRef: null,
  },
  {
    providerKey: "robinhood",
    displayName: "Robinhood Agentic",
    adapterKind: "direct_oauth",
    customerV1Status: "research_only",
    requiredScopes: AUTOMATION_TRADING_REQUIRED_SCOPES,
    knownLimitations: [
      "Robinhood Agentic Trading is beta: long equities (options rolling out) in the dedicated Agentic account only.",
      "MCP tool schemas (order types, time-in-force) are unverified until a live authorized tools/list fixture is captured.",
      "No order replace tool is documented; cancel plus re-place is the only amendment path.",
    ],
    sourceRefs: [robinhoodAgenticSourceRef, planSourceRef],
    verificationDate: "2026-07-02",
    defaultBlockReason: "PROVIDER_RESEARCH_REQUIRED",
    selectedBrokerageFixtureRef: null,
  },
  {
    providerKey: "direct_oauth_candidate",
    displayName: "Direct OAuth Broker Candidate",
    adapterKind: "direct_oauth",
    customerV1Status: "research_only",
    requiredScopes: AUTOMATION_TRADING_REQUIRED_SCOPES,
    knownLimitations: [
      "Second-wave research lane; no selected provider has been promoted.",
    ],
    sourceRefs: [planSourceRef],
    verificationDate: "2026-06-26",
    defaultBlockReason: "PROVIDER_RESEARCH_REQUIRED",
    selectedBrokerageFixtureRef: null,
  },
  {
    providerKey: "read_only_connection",
    displayName: "Read-Only Connection",
    adapterKind: "read_only",
    customerV1Status: "insufficient_capability",
    requiredScopes: AUTOMATION_TRADING_REQUIRED_SCOPES,
    knownLimitations: ["Read-only links cannot submit or manage orders."],
    sourceRefs: [planSourceRef],
    verificationDate: "2026-06-26",
    defaultBlockReason: "PROVIDER_INSUFFICIENT_CAPABILITY",
    selectedBrokerageFixtureRef: null,
  },
  {
    providerKey: "manual_only_connection",
    displayName: "Manual-Only Connection",
    adapterKind: "manual_only",
    customerV1Status: "insufficient_capability",
    requiredScopes: AUTOMATION_TRADING_REQUIRED_SCOPES,
    knownLimitations: ["Manual-only links do not satisfy automation execution."],
    sourceRefs: [planSourceRef],
    verificationDate: "2026-06-26",
    defaultBlockReason: "PROVIDER_INSUFFICIENT_CAPABILITY",
    selectedBrokerageFixtureRef: null,
  },
  {
    providerKey: "submit_only_connection",
    displayName: "Submit-Only Connection",
    adapterKind: "submit_only",
    customerV1Status: "insufficient_capability",
    requiredScopes: AUTOMATION_TRADING_REQUIRED_SCOPES,
    knownLimitations: [
      "Submit-only links cannot satisfy order read, execution read, cancel, and replace safety gates.",
    ],
    sourceRefs: [planSourceRef],
    verificationDate: "2026-06-26",
    defaultBlockReason: "PROVIDER_INSUFFICIENT_CAPABILITY",
    selectedBrokerageFixtureRef: null,
  },
  {
    providerKey: "paper_demo_connection",
    displayName: "Paper Or Demo Connection",
    adapterKind: "paper_demo",
    customerV1Status: "research_only",
    requiredScopes: AUTOMATION_TRADING_REQUIRED_SCOPES,
    knownLimitations: [
      "Paper/demo links cannot satisfy live customer automation eligibility.",
    ],
    sourceRefs: [planSourceRef],
    verificationDate: "2026-06-26",
    defaultBlockReason: "PROVIDER_RESEARCH_REQUIRED",
    selectedBrokerageFixtureRef: null,
  },
  {
    providerKey: "unsupported_provider",
    displayName: "Unsupported Provider",
    adapterKind: "unsupported",
    customerV1Status: "unsupported_provider",
    requiredScopes: AUTOMATION_TRADING_REQUIRED_SCOPES,
    knownLimitations: ["Provider is not supported for customer v1."],
    sourceRefs: [planSourceRef],
    verificationDate: "2026-06-26",
    defaultBlockReason: "PROVIDER_UNSUPPORTED",
    selectedBrokerageFixtureRef: null,
  },
] as const satisfies readonly ProviderClassificationRow[];
