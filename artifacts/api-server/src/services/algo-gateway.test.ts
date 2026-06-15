import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { resolveAlgoGatewayReadiness } from "./algo-gateway";

// A bridge diagnostics fixture that satisfies every non-session readiness proof, so the
// market-session execution gate is the deciding factor.
const READY_IBKR = {
  configured: true,
  healthFresh: true,
  connected: true,
  authenticated: true,
  accountsLoaded: true,
  configuredLiveMarketDataMode: true,
  streamFresh: true,
  streamState: "live",
  strictReady: true,
};

// 2026-06-08 is a Monday. 15:00Z = 11:00 ET (regular trading hours).
const DURING_RTH = new Date("2026-06-08T15:00:00.000Z");
// 23:30Z = 19:30 ET (after the 16:00 ET close, still a trading day).
const AFTER_CLOSE = new Date("2026-06-08T23:30:00.000Z");

test("options strategy execution stays blocked outside regular options hours", () => {
  const readiness = resolveAlgoGatewayReadiness(READY_IBKR, AFTER_CLOSE);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "market_session_quiet");
  assert.equal(
    readiness.message,
    "Options strategy execution is outside the regular options session.",
  );
});

test("options strategy execution is ready during regular options hours when the bridge is healthy", () => {
  const readiness = resolveAlgoGatewayReadiness(READY_IBKR, DURING_RTH);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, null);
  assert.equal(readiness.message, "IB Gateway is ready for options strategy execution.");
});

test("non-session readiness failures take precedence over the session gate", () => {
  // Even during RTH, a disconnected bridge must not be ready (and must not be reported as
  // market_session_quiet) — the execution gate is independent of, not masking, health.
  const readiness = resolveAlgoGatewayReadiness(
    { ...READY_IBKR, connected: false },
    DURING_RTH,
  );
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "gateway_socket_disconnected");
});

// Regression guard for the cockpit/STA startup-latency fix. getAlgoGatewayReadiness
// runs on the hot cockpit read path (getAlgoDeploymentCockpit ->
// buildAlgoDeploymentCockpitPayload). It must read only the lightweight readiness
// signals, never build the full getRuntimeDiagnostics aggregate (~540KB: market-data
// work plan, ingest diagnostics, account/shadow reads), which added ~2s per read.
test("getAlgoGatewayReadiness reads lightweight signals, not the full diagnostics blob", () => {
  const gatewaySource = readFileSync(
    new URL("./algo-gateway.ts", import.meta.url),
    "utf8",
  );
  assert.match(gatewaySource, /getAlgoGatewayReadinessSignals\(\)/);
  // No call to, and no import of, the heavy aggregate (a comment may still name it).
  assert.doesNotMatch(gatewaySource, /getRuntimeDiagnostics\(/);
  assert.doesNotMatch(gatewaySource, /import\s[^\n]*getRuntimeDiagnostics/);
});

test("getAlgoGatewayReadinessSignals sources from cached bridge health, not the work-plan builder", () => {
  const platformSource = readFileSync(
    new URL("./platform.ts", import.meta.url),
    "utf8",
  );
  const idx = platformSource.indexOf(
    "export async function getAlgoGatewayReadinessSignals",
  );
  assert.notEqual(idx, -1, "getAlgoGatewayReadinessSignals must exist");
  const body = platformSource.slice(idx, idx + 800);
  assert.match(body, /getRuntimeBridgeHealthState\(\)/);
  assert.doesNotMatch(
    body,
    /buildMarketDataWorkPlan|getRuntimeMarketDataIngestDiagnostics/,
  );
});
