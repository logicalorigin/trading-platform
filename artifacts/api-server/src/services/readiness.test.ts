import assert from "node:assert/strict";
import test from "node:test";

import type { DiagnosticsLatestPayload } from "./diagnostics";
import type { ApiResourcePressureSnapshot } from "./resource-pressure";
import { buildApiReadinessPayload } from "./readiness";

const NORMAL_PRESSURE: ApiResourcePressureSnapshot = {
  level: "normal",
  resourceLevel: "normal",
  observedAt: "2026-06-09T03:32:46.000Z",
  drivers: [],
  scannerPressure: {
    level: "normal",
    drivers: [],
    activeLongScanCount: null,
  },
  caps: {
    signalOptions: {
      maintenanceOnly: false,
      skipDeploymentScans: false,
      signalRefreshAllowed: true,
      actionScansAllowed: true,
      positionMarksAllowed: true,
      watchlistPrewarmAllowed: true,
    },
  },
  inputs: {
    rssMb: null,
    apiHeapUsedPercent: null,
    apiP95LatencyMs: null,
    dominantSlowRouteP95Ms: null,
    eventLoopDelayP95Ms: null,
    clientLevel: null,
    cacheLevel: null,
    automationActiveLongScanCount: null,
  },
};

test("broker readiness suppresses stale connection proof when IBKR is not configured", () => {
  const diagnostics: DiagnosticsLatestPayload = {
    timestamp: "2026-06-09T03:32:46.000Z",
    status: "ok",
    severity: "info",
    summary: "runtime ok",
    thresholds: [],
    events: [],
    snapshots: [
      {
        id: "ibkr",
        observedAt: "2026-06-09T03:32:46.000Z",
        subsystem: "ibkr",
        status: "ok",
        severity: "info",
        summary: "stale broker proof after detach",
        dimensions: {},
        metrics: {
          configured: false,
          reachable: true,
          connected: true,
          authenticated: true,
          competing: false,
          healthFresh: true,
          streamFresh: true,
          strictReady: true,
        },
        raw: {},
      },
    ],
  };

  const readiness = buildApiReadinessPayload({
    diagnostics,
    pressure: NORMAL_PRESSURE,
    now: new Date("2026-06-09T03:32:46.000Z"),
  });

  assert.equal(readiness.brokerTradingReadiness.status, "blocked");
  assert.equal(readiness.brokerTradingReadiness.ready, false);
  assert.equal(
    readiness.brokerTradingReadiness.reason,
    "broker_not_configured",
  );
  assert.equal(
    readiness.manualTradingBlockedReason,
    "broker_not_configured",
  );
  assert.deepEqual(readiness.brokerTradingReadiness.checks, {
    configured: false,
    reachable: false,
    connected: false,
    authenticated: false,
    competing: false,
    healthFresh: false,
    streamFresh: false,
    strictReady: false,
  });
});

test("live bridge detach overrides stale ready diagnostics immediately", () => {
  const diagnostics: DiagnosticsLatestPayload = {
    timestamp: "2026-06-09T04:22:20.000Z",
    status: "ok",
    severity: "info",
    summary: "stale runtime",
    thresholds: [],
    events: [],
    snapshots: [
      {
        id: "ibkr",
        observedAt: "2026-06-09T04:22:20.000Z",
        subsystem: "ibkr",
        status: "ok",
        severity: "info",
        summary: "stale ready broker proof",
        dimensions: {},
        metrics: {
          configured: true,
          reachable: true,
          connected: true,
          authenticated: true,
          competing: false,
          healthFresh: true,
          streamFresh: true,
          strictReady: true,
        },
        raw: {},
      },
    ],
  };

  const readiness = buildApiReadinessPayload({
    brokerRuntime: null,
    diagnostics,
    pressure: NORMAL_PRESSURE,
    now: new Date("2026-06-09T04:22:20.000Z"),
  });

  assert.equal(readiness.brokerTradingReadiness.status, "blocked");
  assert.equal(readiness.brokerTradingReadiness.ready, false);
  assert.equal(readiness.brokerTradingReadiness.reason, "broker_not_configured");
  assert.deepEqual(readiness.brokerTradingReadiness.checks, {
    configured: false,
    reachable: false,
    connected: false,
    authenticated: false,
    competing: false,
    healthFresh: false,
    streamFresh: false,
    strictReady: false,
  });
});

test("live bridge readiness overrides stale not-configured diagnostics", () => {
  const diagnostics: DiagnosticsLatestPayload = {
    timestamp: "2026-06-09T04:24:00.000Z",
    status: "ok",
    severity: "info",
    summary: "stale runtime",
    thresholds: [],
    events: [],
    snapshots: [
      {
        id: "ibkr",
        observedAt: "2026-06-09T04:24:00.000Z",
        subsystem: "ibkr",
        status: "degraded",
        severity: "warning",
        summary: "stale disconnected broker proof",
        dimensions: {},
        metrics: {
          configured: false,
          reachable: false,
          connected: false,
          authenticated: false,
          competing: false,
          healthFresh: false,
          streamFresh: false,
          strictReady: false,
        },
        raw: {},
      },
    ],
  };

  const readiness = buildApiReadinessPayload({
    brokerRuntime: {
      configured: true,
      reachable: true,
      connected: true,
      authenticated: true,
      competing: false,
      healthFresh: true,
      streamFresh: true,
      strictReady: true,
    },
    diagnostics,
    pressure: NORMAL_PRESSURE,
    now: new Date("2026-06-09T04:24:00.000Z"),
  });

  assert.equal(readiness.brokerTradingReadiness.status, "ready");
  assert.equal(readiness.brokerTradingReadiness.ready, true);
  assert.equal(readiness.brokerTradingReadiness.reason, null);
  assert.equal(readiness.manualTradingBlockedReason, null);
  assert.deepEqual(readiness.brokerTradingReadiness.checks, {
    configured: true,
    reachable: true,
    connected: true,
    authenticated: true,
    competing: false,
    healthFresh: true,
    streamFresh: true,
    strictReady: true,
  });
});
