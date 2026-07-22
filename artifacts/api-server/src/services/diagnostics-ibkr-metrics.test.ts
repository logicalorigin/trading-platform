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
    streamStateReason: "ibkr_client_portal_not_configured",
    lastStreamEventAgeMs: null,
    strictReady: false,
    strictReason: "ibkr_client_portal_not_configured",
    lastRecoveryAttemptAt: null,
    lastRecoveryError: null,
  });
});

test("IBKR diagnostics metrics preserve configured Client Portal readiness state", () => {
  const metrics = __diagnosticsInternalsForTests.buildIbkrMetrics({
    ibkr: {
      configured: true,
      reachable: false,
      connected: false,
      authenticated: false,
      competing: false,
      accountCount: 0,
      healthFresh: false,
      streamFresh: false,
      streamState: "checking",
      streamStateReason: "ibkr_client_portal_readiness_user_scoped",
      strictReady: false,
      strictReason: "ibkr_client_portal_readiness_user_scoped",
    },
  });

  assert.equal(metrics.configured, true);
  assert.equal(metrics.connected, false);
  assert.equal(metrics.connectivityUp, false);
  assert.equal(metrics.authenticated, false);
  assert.equal(metrics.streamState, "checking");
  assert.equal(
    metrics.streamStateReason,
    "ibkr_client_portal_readiness_user_scoped",
  );
  assert.equal(
    metrics.strictReason,
    "ibkr_client_portal_readiness_user_scoped",
  );
});

test("global user-scoped Client Portal readiness is informational, not unconfigured", () => {
  const metrics = __diagnosticsInternalsForTests.buildIbkrMetrics({
    ibkr: {
      configured: false,
      reachable: false,
      connected: false,
      authenticated: false,
      competing: false,
      healthFresh: false,
      streamFresh: false,
      streamState: "offline",
      streamStateReason: "ibkr_client_portal_readiness_user_scoped",
      strictReady: false,
      strictReason: "ibkr_client_portal_readiness_user_scoped",
    },
  });

  assert.equal(metrics.configured, null);
  assert.equal(
    metrics.strictReason,
    "ibkr_client_portal_readiness_user_scoped",
  );
  assert.equal(
    __diagnosticsInternalsForTests.classifyIbkrSnapshot(metrics),
    "info",
  );
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
    events.some((event) => event.code === "ibkr_client_portal_health_stale"),
    true,
  );
});

test("IBKR diagnostic events classify upstream failures as Client Portal connectivity", () => {
  const events = __diagnosticsInternalsForTests.buildIbkrDiagnosticEvents(
    {
      healthError: "upstream request failed",
      healthErrorCode: "upstream_request_failed",
      healthFresh: true,
    },
    {
      configured: true,
      reachable: false,
      connected: false,
      authenticated: false,
      competing: false,
    },
  );

  assert.equal(events[0]?.category, "client-portal-connectivity");
  assert.equal(events[0]?.code, "ibkr_client_portal_unreachable");
});

test("an unconfigured Client Portal emits zero diagnostic events", () => {
  const events = __diagnosticsInternalsForTests.buildIbkrDiagnosticEvents(
    {
      connectionStyle: "client_portal",
      healthFresh: false,
      streamFresh: false,
      streamState: "unavailable",
      strictReason: "ibkr_client_portal_not_configured",
    },
    {
      configured: false,
      reachable: false,
      connected: false,
      authenticated: false,
      competing: false,
    },
  );

  assert.deepEqual(events, []);
});
