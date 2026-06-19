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
    connectivityUp: false,
    connectivityReason: null,
    lastTickleAgeMs: null,
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

test("IBKR diagnostics metrics preserve online desktop-agent unattached state", () => {
  const metrics = __diagnosticsInternalsForTests.buildIbkrMetrics({
    ibkr: {
      configured: false,
      desktopAgentOnline: true,
      reachable: false,
      connected: false,
      authenticated: false,
      competing: false,
      accountCount: 0,
      healthFresh: false,
      streamFresh: false,
      streamState: "checking",
      streamStateReason: "ibkr_bridge_runtime_unattached",
      strictReady: false,
      bridgeRuntimeReason: "ibkr_bridge_runtime_unattached",
    },
  });

  assert.equal(metrics.configured, true);
  assert.equal(metrics.connected, false);
  assert.equal(metrics.connectivityUp, false);
  assert.equal(metrics.authenticated, false);
  assert.equal(metrics.streamState, "checking");
  assert.equal(metrics.streamStateReason, "ibkr_bridge_runtime_unattached");
  assert.equal(metrics.strictReason, "ibkr_bridge_runtime_unattached");
});

test("IBKR diagnostics metrics prefer connectivityUp over stale connected fields", () => {
  const metrics = __diagnosticsInternalsForTests.buildIbkrMetrics({
    ibkr: {
      configured: true,
      reachable: false,
      connected: false,
      connectivityUp: true,
      connectivityReason: null,
      lastTickleAgeMs: 5000,
      authenticated: true,
      competing: false,
      accountCount: 1,
      healthFresh: false,
      streamFresh: true,
      streamState: "live",
      streamStateReason: "fresh_stream_event_health_stale",
      strictReady: false,
      strictReason: "health_stale",
    },
  });

  assert.equal(metrics.connected, true);
  assert.equal(metrics.connectivityUp, true);
  assert.equal(metrics.lastTickleAgeMs, 5000);

  const events = __diagnosticsInternalsForTests.buildIbkrDiagnosticEvents(
    {
      bridgeUrlConfigured: true,
      bridgeTokenConfigured: true,
      healthFresh: false,
      streamFresh: true,
      streamState: "live",
      strictReason: "health_stale",
    },
    metrics,
  );

  assert.equal(
    events.some((event) => event.code === "ibkr_gateway_socket_disconnected"),
    false,
  );
  assert.equal(
    events.some((event) => event.code === "ibkr_bridge_health_stale"),
    true,
  );
});

test("IBKR diagnostic events use the shared runtime-unattached code", () => {
  const events = __diagnosticsInternalsForTests.buildIbkrDiagnosticEvents(
    {
      bridgeUrlConfigured: false,
      bridgeTokenConfigured: false,
      desktopAgentOnline: true,
      bridgeRuntimeReason: "ibkr_bridge_runtime_unattached",
    },
    {
      configured: true,
      reachable: false,
      connected: false,
      authenticated: false,
      competing: false,
    },
  );

  assert.equal(events[0]?.category, "bridge-runtime");
  assert.equal(events[0]?.code, "ibkr_bridge_runtime_unattached");
});
