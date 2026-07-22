import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerCapabilityDecisionCodes,
  evaluateOrderShapeCapability,
  type BrokerAccountCapabilityMap,
} from "./broker-capability-map";
import { providerBlockReasons } from "./broker-provider-classification";
import { brokerScopeDecisionCodes } from "./broker-scope-contract";
import { providerCapabilityDecisionCodes } from "./execution-decision-codes";
import {
  brokerPermissionCopyEntries,
  brokerPermissionCopyKeys,
} from "./broker-permission-copy";
import {
  executionDecisionRegistry,
  getExecutionDecisionEntry,
  validateExecutionDecisionRegistry,
} from "./execution-decision-registry";

const emittedDecisionCodes = new Set([
  ...brokerScopeDecisionCodes,
  ...brokerCapabilityDecisionCodes,
  ...providerBlockReasons,
  ...providerCapabilityDecisionCodes,
]);

test("decision registry has one complete entry for every emitted broker decision code", () => {
  const validation = validateExecutionDecisionRegistry(executionDecisionRegistry);
  assert.deepEqual(validation.errors, []);

  for (const decisionCode of emittedDecisionCodes) {
    const entry = getExecutionDecisionEntry(decisionCode);

    assert.ok(entry, `${decisionCode} must be registered`);
    assert.equal(entry.decisionCode, decisionCode);
    assert.ok(entry.customerMessageKey, `${decisionCode} needs a message key`);
    assert.ok(entry.auditEventHint, `${decisionCode} needs an audit hint`);
    assert.ok(entry.ownerTask, `${decisionCode} needs an owner task`);
    assert.ok(entry.allowedSurfaces.length, `${decisionCode} needs surfaces`);
  }
});

test("decision registry rejects ad hoc codes", () => {
  assert.equal(getExecutionDecisionEntry("EXECUTION_AD_HOC_BLOCK"), null);
});

test("each registry message key has one backend copy entry", () => {
  const copyKeys = new Set(brokerPermissionCopyKeys);

  for (const entry of executionDecisionRegistry) {
    assert.equal(
      copyKeys.has(entry.customerMessageKey),
      true,
      `${entry.decisionCode} message key ${entry.customerMessageKey} is missing copy metadata`,
    );
  }
});

test("backend copy entries are customer-safe and do not contain raw provider details", () => {
  const forbidden = /\b(access[_-]?token|refresh[_-]?token|authorization|bearer|secret|raw provider|stack trace|DU\d{3,}|U\d{3,})\b/i;

  for (const copy of brokerPermissionCopyEntries) {
    assert.equal(forbidden.test(copy.customerMessageKey), false);
    assert.equal(forbidden.test(copy.defaultMessage), false);
    assert.ok(copy.severity, `${copy.customerMessageKey} needs severity`);
  }
});

test("order-shape blocks use a dedicated registry code and copy key", () => {
  const capabilityMap: BrokerAccountCapabilityMap = {
    provider: "snaptrade",
    adapterKind: "aggregator",
    connectionId: "connection_123",
    brokerAccountIdHash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    accountEnvironment: "live",
    connectionType: "broker",
    scopeStatus: "complete",
    assetClasses: ["stocks"],
    orderTypes: ["market"],
    timeInForce: ["day"],
    sessions: ["regular"],
    routes: ["smart"],
    trailingStops: { supported: false },
    brackets: { supported: false },
    oco: { supported: false },
    oso: { supported: false },
    cancelReplace: { supported: true, fields: ["quantity"] },
    preview: { supported: true },
    orderStatusStreaming: { supported: true },
    positionFreshnessPolicy: { source: "streaming", maxAgeMs: 5_000 },
    orderFreshnessPolicy: { source: "streaming", maxAgeMs: 2_000 },
    executionFreshnessPolicy: { source: "streaming", maxAgeMs: 2_000 },
    knownLimitations: [],
    lastSyncedAt: "2026-06-26T17:59:00.000Z",
    expiresAt: "2026-06-26T18:05:00.000Z",
  };

  const decision = evaluateOrderShapeCapability({
    capabilityMap,
    assetClass: "single_leg_options",
    orderType: "limit",
    timeInForce: "day",
    session: "regular",
  });
  const entry = getExecutionDecisionEntry(decision.decisionCode);

  assert.equal(decision.decisionCode, "BROKER_ORDER_SHAPE_UNSUPPORTED");
  assert.equal(decision.customerMessageKey, "capability.order_shape.unsupported");
  assert.equal(entry?.customerMessageKey, decision.customerMessageKey);
  assert.equal(entry?.severity, decision.severity);
});
