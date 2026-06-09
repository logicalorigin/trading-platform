import assert from "node:assert/strict";
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
