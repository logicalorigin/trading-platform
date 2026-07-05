import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateBrokerCapabilityMapReadiness,
  evaluateOrderShapeCapability,
  validateBrokerCapabilityMap,
  type BrokerAccountCapabilityMap,
} from "./broker-capability-map";

const now = new Date("2026-06-26T18:00:00.000Z");

const completeMap = (): BrokerAccountCapabilityMap => ({
  provider: "snaptrade",
  adapterKind: "aggregator",
  connectionId: "connection_123",
  brokerAccountIdHash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  accountEnvironment: "live",
  connectionType: "broker",
  scopeStatus: "complete",
  assetClasses: ["stocks", "single_leg_options"],
  orderTypes: ["market", "limit", "stop", "stop_limit"],
  timeInForce: ["day", "gtc"],
  sessions: ["regular"],
  routes: ["smart"],
  trailingStops: { supported: false },
  brackets: { supported: false },
  oco: { supported: false },
  oso: { supported: false },
  cancelReplace: {
    supported: true,
    fields: ["quantity", "limit_price", "stop_price", "time_in_force"],
  },
  preview: { supported: true },
  orderStatusStreaming: { supported: true },
  positionFreshnessPolicy: { source: "streaming", maxAgeMs: 5_000 },
  orderFreshnessPolicy: { source: "streaming", maxAgeMs: 2_000 },
  executionFreshnessPolicy: { source: "streaming", maxAgeMs: 2_000 },
  knownLimitations: [],
  lastSyncedAt: "2026-06-26T17:59:00.000Z",
  expiresAt: "2026-06-26T18:05:00.000Z",
});

test("complete, fresh capability maps are ready for activation gates", () => {
  const readiness = evaluateBrokerCapabilityMapReadiness({
    capabilityMap: completeMap(),
    now,
  });

  assert.equal(readiness.outcome, "ready");
  assert.equal(readiness.decisionCode, "BROKER_CAPABILITY_READY");
  assert.equal(readiness.automationTradingConnection, true);
  assert.deepEqual(readiness.blockedReasons, []);
});

test("missing, unknown, and expired capability maps fail closed", () => {
  assert.equal(
    evaluateBrokerCapabilityMapReadiness({
      capabilityMap: null,
      now,
    }).decisionCode,
    "BROKER_CAPABILITY_SYNC_REQUIRED",
  );

  assert.equal(
    evaluateBrokerCapabilityMapReadiness({
      capabilityMap: { ...completeMap(), scopeStatus: "unknown" },
      now,
    }).decisionCode,
    "BROKER_CAPABILITY_SYNC_REQUIRED",
  );

  assert.equal(
    evaluateBrokerCapabilityMapReadiness({
      capabilityMap: {
        ...completeMap(),
        expiresAt: "2026-06-26T17:59:59.000Z",
      },
      now,
    }).decisionCode,
    "BROKER_CAPABILITY_STALE",
  );
});

test("capability map validation rejects raw-looking account ids and provider payloads", () => {
  assert.deepEqual(validateBrokerCapabilityMap(completeMap()).errors, []);

  assert.ok(
    validateBrokerCapabilityMap({
      ...completeMap(),
      brokerAccountIdHash: "DU1234567",
    }).errors.includes("broker_account_id_hash_invalid"),
  );

  assert.ok(
    validateBrokerCapabilityMap({
      ...completeMap(),
      knownLimitations: ["raw payload: { access_token: secret }"],
    }).errors.includes("known_limitation_contains_sensitive_material"),
  );
});

test("order-shape capability allows v1 stocks and single-leg options", () => {
  const map = completeMap();

  assert.equal(
    evaluateOrderShapeCapability({
      capabilityMap: map,
      assetClass: "stocks",
      orderType: "limit",
      timeInForce: "day",
      session: "regular",
    }).decisionCode,
    "BROKER_CAPABILITY_READY",
  );

  assert.equal(
    evaluateOrderShapeCapability({
      capabilityMap: map,
      assetClass: "single_leg_options",
      orderType: "limit",
      timeInForce: "day",
      session: "regular",
    }).decisionCode,
    "BROKER_CAPABILITY_READY",
  );
});

test("order-shape capability blocks deferred or unsupported shapes", () => {
  const map = completeMap();

  assert.equal(
    evaluateOrderShapeCapability({
      capabilityMap: map,
      assetClass: "multi_leg_options_spreads",
      orderType: "limit",
      timeInForce: "day",
      session: "regular",
    }).decisionCode,
    "BROKER_ORDER_SHAPE_UNSUPPORTED",
  );

  assert.deepEqual(
    evaluateOrderShapeCapability({
      capabilityMap: { ...map, orderTypes: ["market"] },
      assetClass: "stocks",
      orderType: "limit",
      timeInForce: "day",
      session: "regular",
    }).missingCapabilities,
    ["order_type:limit"],
  );
});
