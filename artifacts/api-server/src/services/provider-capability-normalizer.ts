import type { ProviderAdapterKind } from "./broker-provider-classification";
import {
  type BrokerAccountCapabilityMap,
  type BrokerAccountEnvironment,
  type BrokerCancelReplaceField,
  type BrokerFreshnessPolicy,
  type BrokerOrderType,
  type BrokerTimeInForce,
  type BrokerTradingSession,
  type BrokerV1AssetClass,
} from "./broker-capability-map";
import {
  getExecutionDecisionEntryOrThrow,
  type ExecutionCustomerMessageKey,
  type ExecutionDecisionRedactionClass,
  type ExecutionDecisionSeverity,
} from "./execution-decision-registry";
import {
  providerCapabilityDecisionCodes,
  type ProviderCapabilityDecisionCode,
} from "./execution-decision-codes";

export {
  providerCapabilityDecisionCodes,
  type ProviderCapabilityDecisionCode,
};

export const providerLimitationCodes = [
  "no_preview",
  "no_order_stream",
  "no_cancel_replace",
  "no_options_support",
  "paper_only",
  "demo_only",
  "read_only",
  "submit_only",
] as const;

export type ProviderLimitationCode = (typeof providerLimitationCodes)[number];

export type ProviderCapabilityLimitation = {
  code: ProviderLimitationCode;
  providerDetail?: string;
};

export type ProviderConnectionMode = "live" | "paper" | "demo";
export type ProviderLinkMode = "trading" | "read_only" | "submit_only";
export type ProviderCapabilitySyncStatus = "complete" | "unknown" | "stale";

export type ProviderCapabilityFacts = {
  provider: string;
  adapterKind: ProviderAdapterKind;
  connectionId: string;
  brokerAccountIdHash: string;
  accountEnvironment: BrokerAccountEnvironment;
  supportedAssetClasses: BrokerV1AssetClass[];
  supportedOrderTypes: BrokerOrderType[];
  supportedTimeInForce: BrokerTimeInForce[];
  supportedSessions: BrokerTradingSession[];
  supportedRoutes: string[];
  supportsPreview: boolean;
  supportsOrderStatusStreaming: boolean;
  supportsCancel: boolean;
  supportsReplace: boolean;
  cancelReplaceFields: BrokerCancelReplaceField[];
  connectionMode: ProviderConnectionMode;
  linkMode: ProviderLinkMode;
  syncStatus: ProviderCapabilitySyncStatus;
  providerLimitations: ProviderCapabilityLimitation[];
  lastSyncedAt: string | null;
  expiresAt: string | null;
};

export type NormalizedProviderCapability = {
  decisionCode: ProviderCapabilityDecisionCode;
  customerMessageKey: ExecutionCustomerMessageKey;
  severity: ExecutionDecisionSeverity;
  auditEventHint: string;
  redactionClass: ExecutionDecisionRedactionClass;
  automationTradingConnection: boolean;
  blockedReasons: string[];
  capabilityMap: BrokerAccountCapabilityMap;
  customerSafeLimitations: string[];
};

const STREAMING_POSITION_FRESHNESS_MS = 5_000;
const STREAMING_ORDER_FRESHNESS_MS = 2_000;
const POLLING_FRESHNESS_MS = 30_000;

const limitationCopyKeys: Record<ProviderLimitationCode, string> = {
  no_preview: "capability.preview.unavailable",
  no_order_stream: "capability.order_status_streaming.unavailable",
  no_cancel_replace: "capability.cancel_replace.unsupported",
  no_options_support: "capability.asset_class.single_leg_options.unsupported",
  paper_only: "provider.paper.unsupported",
  demo_only: "provider.demo.unsupported",
  read_only: "provider.read_only.unsupported",
  submit_only: "provider.submit_only.unsupported",
};

function uniquePreservingOrder<T extends string>(values: Iterable<T>): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function freshnessPolicy(input: {
  supportsOrderStatusStreaming: boolean;
  kind: "position" | "order" | "execution";
}): BrokerFreshnessPolicy {
  if (!input.supportsOrderStatusStreaming) {
    return { source: "polling", maxAgeMs: POLLING_FRESHNESS_MS };
  }
  return {
    source: "streaming",
    maxAgeMs:
      input.kind === "position"
        ? STREAMING_POSITION_FRESHNESS_MS
        : STREAMING_ORDER_FRESHNESS_MS,
  };
}

function scopeStatusForProviderStatus(
  syncStatus: ProviderCapabilitySyncStatus,
): BrokerAccountCapabilityMap["scopeStatus"] {
  if (syncStatus === "complete") {
    return "complete";
  }
  return syncStatus;
}

function normalizedLimitationCodes(
  facts: ProviderCapabilityFacts,
): ProviderLimitationCode[] {
  const codes: ProviderLimitationCode[] = facts.providerLimitations.map(
    (limitation) => limitation.code,
  );

  if (!facts.supportsPreview) {
    codes.push("no_preview");
  }
  if (!facts.supportsOrderStatusStreaming) {
    codes.push("no_order_stream");
  }
  if (!facts.supportsCancel || !facts.supportsReplace) {
    codes.push("no_cancel_replace");
  }
  if (!facts.supportedAssetClasses.includes("single_leg_options")) {
    codes.push("no_options_support");
  }
  if (facts.connectionMode === "paper") {
    codes.push("paper_only");
  }
  if (facts.connectionMode === "demo") {
    codes.push("demo_only");
  }
  if (facts.linkMode === "read_only") {
    codes.push("read_only");
  }
  if (facts.linkMode === "submit_only") {
    codes.push("submit_only");
  }

  return uniquePreservingOrder(codes);
}

function capabilityMapFromProviderFacts(
  facts: ProviderCapabilityFacts,
  customerSafeLimitations: string[],
): BrokerAccountCapabilityMap {
  const cancelReplaceSupported = facts.supportsCancel && facts.supportsReplace;

  return {
    provider: facts.provider,
    adapterKind: facts.adapterKind,
    connectionId: facts.connectionId,
    brokerAccountIdHash: facts.brokerAccountIdHash,
    accountEnvironment: facts.accountEnvironment,
    connectionType: "broker",
    scopeStatus: scopeStatusForProviderStatus(facts.syncStatus),
    assetClasses: [...facts.supportedAssetClasses],
    orderTypes: [...facts.supportedOrderTypes],
    timeInForce: [...facts.supportedTimeInForce],
    sessions: [...facts.supportedSessions],
    routes: [...facts.supportedRoutes],
    trailingStops: { supported: false },
    brackets: { supported: false },
    oco: { supported: false },
    oso: { supported: false },
    cancelReplace: {
      supported: cancelReplaceSupported,
      fields: cancelReplaceSupported ? [...facts.cancelReplaceFields] : [],
    },
    preview: { supported: facts.supportsPreview },
    orderStatusStreaming: { supported: facts.supportsOrderStatusStreaming },
    positionFreshnessPolicy: freshnessPolicy({
      supportsOrderStatusStreaming: facts.supportsOrderStatusStreaming,
      kind: "position",
    }),
    orderFreshnessPolicy: freshnessPolicy({
      supportsOrderStatusStreaming: facts.supportsOrderStatusStreaming,
      kind: "order",
    }),
    executionFreshnessPolicy: freshnessPolicy({
      supportsOrderStatusStreaming: facts.supportsOrderStatusStreaming,
      kind: "execution",
    }),
    knownLimitations: customerSafeLimitations,
    lastSyncedAt: facts.lastSyncedAt,
    expiresAt: facts.expiresAt,
  };
}

function decisionForFacts(input: {
  facts: ProviderCapabilityFacts;
  customerSafeLimitations: string[];
}): Pick<
  NormalizedProviderCapability,
  "decisionCode" | "automationTradingConnection" | "blockedReasons"
> {
  if (input.facts.syncStatus === "unknown") {
    return {
      decisionCode: "BROKER_CAPABILITY_SYNC_REQUIRED",
      automationTradingConnection: false,
      blockedReasons: ["capability.sync.required"],
    };
  }

  if (input.facts.syncStatus === "stale") {
    return {
      decisionCode: "BROKER_CAPABILITY_STALE",
      automationTradingConnection: false,
      blockedReasons: ["capability.sync.stale"],
    };
  }

  if (input.facts.connectionMode === "paper" || input.facts.connectionMode === "demo") {
    return {
      decisionCode: "PROVIDER_RESEARCH_REQUIRED",
      automationTradingConnection: false,
      blockedReasons: input.customerSafeLimitations.filter((key) =>
        key.startsWith("provider."),
      ),
    };
  }

  if (input.facts.linkMode === "read_only" || input.facts.linkMode === "submit_only") {
    return {
      decisionCode: "PROVIDER_INSUFFICIENT_CAPABILITY",
      automationTradingConnection: false,
      blockedReasons: input.customerSafeLimitations.filter((key) =>
        key.startsWith("provider."),
      ),
    };
  }

  if (
    !input.facts.supportsCancel ||
    !input.facts.supportsReplace ||
    !input.facts.supportedAssetClasses.includes("single_leg_options")
  ) {
    return {
      decisionCode: "BROKER_CAPABILITY_UNSUPPORTED",
      automationTradingConnection: false,
      blockedReasons: input.customerSafeLimitations.filter((key) =>
        key.startsWith("capability."),
      ),
    };
  }

  return {
    decisionCode: "BROKER_CAPABILITY_READY",
    automationTradingConnection: true,
    blockedReasons: [],
  };
}

export function normalizeProviderCapabilityFacts(
  facts: ProviderCapabilityFacts,
): NormalizedProviderCapability {
  const customerSafeLimitations = uniquePreservingOrder(
    normalizedLimitationCodes(facts).map((code) => limitationCopyKeys[code]),
  );
  const decision = decisionForFacts({ facts, customerSafeLimitations });
  const decisionEntry = getExecutionDecisionEntryOrThrow(decision.decisionCode);

  return {
    ...decision,
    customerMessageKey: decisionEntry.customerMessageKey,
    severity: decisionEntry.severity,
    auditEventHint: decisionEntry.auditEventHint,
    redactionClass: decisionEntry.redactionClass,
    capabilityMap: capabilityMapFromProviderFacts(facts, customerSafeLimitations),
    customerSafeLimitations,
  };
}

export function toCustomerSafeProviderLimitations(
  normalized: NormalizedProviderCapability,
): string[] {
  return [...normalized.customerSafeLimitations];
}
