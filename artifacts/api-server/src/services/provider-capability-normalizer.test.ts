import assert from "node:assert/strict";
import test from "node:test";

import { evaluateOrderShapeCapability } from "./broker-capability-map";
import {
  normalizeProviderCapabilityFacts,
  toCustomerSafeProviderLimitations,
  type ProviderCapabilityFacts,
} from "./provider-capability-normalizer";

const baseFacts = (): ProviderCapabilityFacts => ({
  provider: "snaptrade",
  adapterKind: "aggregator",
  connectionId: "connection_123",
  brokerAccountIdHash:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  accountEnvironment: "live",
  supportedAssetClasses: ["stocks", "single_leg_options"],
  supportedOrderTypes: ["market", "limit"],
  supportedTimeInForce: ["day", "gtc"],
  supportedSessions: ["regular"],
  supportedRoutes: ["smart"],
  supportsPreview: true,
  supportsOrderStatusStreaming: true,
  supportsCancel: true,
  supportsReplace: true,
  cancelReplaceFields: ["quantity", "limit_price", "time_in_force"],
  connectionMode: "live",
  linkMode: "trading",
  syncStatus: "complete",
  providerLimitations: [],
  lastSyncedAt: "2026-06-26T17:59:00.000Z",
  expiresAt: "2026-06-26T18:05:00.000Z",
});

test("normalizer creates a complete account-specific capability map from safe provider facts", () => {
  const normalized = normalizeProviderCapabilityFacts(baseFacts());

  assert.equal(normalized.decisionCode, "BROKER_CAPABILITY_READY");
  assert.equal(normalized.customerMessageKey, "capability.ready");
  assert.equal(normalized.severity, "info");
  assert.equal(normalized.automationTradingConnection, true);
  assert.equal(normalized.capabilityMap.assetClasses.includes("stocks"), true);
  assert.equal(
    normalized.capabilityMap.assetClasses.includes("single_leg_options"),
    true,
  );
  assert.equal(normalized.capabilityMap.preview.supported, true);
  assert.equal(normalized.capabilityMap.orderStatusStreaming.supported, true);
  assert.equal(normalized.capabilityMap.cancelReplace.supported, true);
});

test("no-preview and no-stream limitations are normalized without leaking provider details", () => {
  const normalized = normalizeProviderCapabilityFacts({
    ...baseFacts(),
    supportsPreview: false,
    supportsOrderStatusStreaming: false,
    providerLimitations: [
      {
        code: "no_preview",
        providerDetail: "broker acct DU123 lacks preview",
      },
      {
        code: "no_order_stream",
        providerDetail: "stream token abc123",
      },
    ],
  });

  assert.equal(normalized.capabilityMap.preview.supported, false);
  assert.equal(normalized.capabilityMap.orderStatusStreaming.supported, false);
  assert.equal(normalized.capabilityMap.orderFreshnessPolicy.source, "polling");
  assert.deepEqual(toCustomerSafeProviderLimitations(normalized), [
    "capability.preview.unavailable",
    "capability.order_status_streaming.unavailable",
  ]);
});

test("missing cancel or replace support blocks automation trading connection", () => {
  const normalized = normalizeProviderCapabilityFacts({
    ...baseFacts(),
    supportsCancel: false,
    supportsReplace: false,
    cancelReplaceFields: [],
    providerLimitations: [{ code: "no_cancel_replace" }],
  });

  assert.equal(normalized.automationTradingConnection, false);
  assert.equal(normalized.decisionCode, "BROKER_CAPABILITY_UNSUPPORTED");
  assert.equal(normalized.customerMessageKey, "capability.unsupported");
  assert.equal(normalized.severity, "provider_limitation");
  assert.equal(normalized.capabilityMap.cancelReplace.supported, false);
  assert.ok(
    normalized.blockedReasons.includes("capability.cancel_replace.unsupported"),
  );
});

test("no-options support removes single-leg options instead of downgrading strategy intent", () => {
  const normalized = normalizeProviderCapabilityFacts({
    ...baseFacts(),
    supportedAssetClasses: ["stocks"],
    providerLimitations: [{ code: "no_options_support" }],
  });

  assert.equal(normalized.automationTradingConnection, false);
  assert.equal(normalized.decisionCode, "BROKER_CAPABILITY_UNSUPPORTED");
  assert.equal(
    evaluateOrderShapeCapability({
      capabilityMap: normalized.capabilityMap,
      assetClass: "single_leg_options",
      orderType: "limit",
      timeInForce: "day",
      session: "regular",
    }).decisionCode,
    "BROKER_ORDER_SHAPE_UNSUPPORTED",
  );
});

test("read-only, submit-only, and paper/demo links fail closed", () => {
  for (const linkMode of ["read_only", "submit_only"] as const) {
    const normalized = normalizeProviderCapabilityFacts({
      ...baseFacts(),
      linkMode,
    });

    assert.equal(normalized.automationTradingConnection, false);
    assert.equal(normalized.decisionCode, "PROVIDER_INSUFFICIENT_CAPABILITY");
  }

  const paper = normalizeProviderCapabilityFacts({
    ...baseFacts(),
    connectionMode: "paper",
  });

  assert.equal(paper.automationTradingConnection, false);
  assert.equal(paper.decisionCode, "PROVIDER_RESEARCH_REQUIRED");
});

test("unknown or stale provider capability state fails closed without reading clocks", () => {
  const unknown = normalizeProviderCapabilityFacts({
    ...baseFacts(),
    syncStatus: "unknown",
  });

  assert.equal(unknown.automationTradingConnection, false);
  assert.equal(unknown.decisionCode, "BROKER_CAPABILITY_SYNC_REQUIRED");

  const stale = normalizeProviderCapabilityFacts({
    ...baseFacts(),
    syncStatus: "stale",
  });

  assert.equal(stale.automationTradingConnection, false);
  assert.equal(stale.decisionCode, "BROKER_CAPABILITY_STALE");
});
