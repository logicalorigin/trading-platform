import assert from "node:assert/strict";
import test from "node:test";

import { __diagnosticsInternalsForTests } from "./diagnostics";

test("IBKR diagnostics metrics suppress stale broker proof when not configured", () => {
  const metrics = __diagnosticsInternalsForTests.buildIbkrMetrics({
    ibkr: {
      configured: false,
      reachable: true,
      connected: true,
      authenticated: true,
      competing: true,
      accountCount: 1,
      healthFresh: true,
      streamFresh: true,
      streamState: "live",
      strictReady: true,
      lastTickleAt: "2026-06-09T03:32:46.000Z",
      lastStreamEventAgeMs: 42,
      lastRecoveryError: "stale bridge error",
    },
  });

  assert.deepEqual(metrics, {
    configured: false,
    reachable: false,
    connected: false,
    authenticated: false,
    competing: false,
    heartbeatAgeMs: null,
    accountCount: 0,
    marketDataMode: null,
    liveMarketDataAvailable: null,
    healthFresh: false,
    healthAgeMs: null,
    streamFresh: false,
    streamState: "offline",
    streamStateReason: "bridge_not_configured",
    lastStreamEventAgeMs: null,
    strictReady: false,
    strictReason: "ibkr_bridge_not_configured",
    lastRecoveryAttemptAt: null,
    lastRecoveryError: null,
  });
});
