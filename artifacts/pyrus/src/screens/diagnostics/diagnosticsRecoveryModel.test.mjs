import assert from "node:assert/strict";
import test from "node:test";

import { buildDiagnosticsRecoveryModel } from "./diagnosticsRecoveryModel.js";

test("recovery model ranks outages above degradations and routes to the affected panel", () => {
  const model = buildDiagnosticsRecoveryModel({
    status: "down",
    severity: "warning",
    summary: "One or more diagnostics need attention",
    snapshots: [
      {
        subsystem: "api",
        status: "degraded",
        severity: "warning",
        summary: "API latency or errors are elevated",
        observedAt: "2026-07-22T12:00:00.000Z",
        metrics: { p95LatencyMs: 2_400 },
      },
      {
        subsystem: "ibkr",
        status: "down",
        severity: "warning",
        summary: "IBKR Client Portal session needs attention",
        observedAt: "2026-07-22T12:00:01.000Z",
        metrics: { connected: false },
      },
    ],
  });

  assert.equal(model.state, "failure");
  assert.equal(model.subsystem, "ibkr");
  assert.equal(model.currentFailure, "IBKR Down");
  assert.equal(model.summary, "IBKR Client Portal session needs attention");
  assert.match(model.impact, /broker.*trading context may be unavailable/i);
  assert.equal(model.evidence, "Client Portal disconnected");
  assert.match(model.nextAction, /Client Portal readiness/);
  assert.doesNotMatch(model.nextAction, /bridge/i);
  assert.equal(model.targetTab, "Broker");
  assert.equal(model.observedAt, "2026-07-22T12:00:01.000Z");
});

test("recovery model prefers a source-provided safe action and keeps evidence concise", () => {
  const model = buildDiagnosticsRecoveryModel({
    status: "degraded",
    severity: "warning",
    snapshots: [
      {
        subsystem: "resource-pressure",
        status: "degraded",
        severity: "warning",
        summary: "Memory, cache, or workload pressure is elevated",
        observedAt: "2026-07-22T12:00:00.000Z",
        metrics: {
          pressureLevel: "watch",
          recommendedAction: "Monitor growth while work continues.",
        },
      },
    ],
  });

  assert.equal(model.nextAction, "Monitor growth while work continues.");
  assert.equal(model.evidence, "Pressure: WATCH");
  assert.equal(model.targetTab, "Memory");
});

test("recovery model reports a calm healthy state when every snapshot is healthy", () => {
  const model = buildDiagnosticsRecoveryModel({
    status: "ok",
    severity: "info",
    summary: "Diagnostics are healthy",
    timestamp: "2026-07-22T12:00:00.000Z",
    snapshots: [
      { subsystem: "api", status: "ok", severity: "info" },
      { subsystem: "storage", status: "ok", severity: "info" },
    ],
  });

  assert.deepEqual(model, {
    state: "healthy",
    severity: "info",
    subsystem: null,
    currentFailure: "No active failure",
    summary: "Diagnostics are healthy",
    impact: "No current operational impact detected.",
    evidence: "2 subsystem checks reporting OK",
    observedAt: "2026-07-22T12:00:00.000Z",
    nextAction: "No action required. Continue monitoring.",
    targetTab: null,
  });
});

test("recovery model makes the initial waiting state explicit", () => {
  const model = buildDiagnosticsRecoveryModel({
    status: "unknown",
    severity: "info",
    summary: "Diagnostics collector has not published a snapshot yet.",
    timestamp: "2026-07-22T12:00:00.000Z",
    snapshots: [],
  });

  assert.equal(model.state, "waiting");
  assert.equal(model.currentFailure, "Waiting for diagnostics");
  assert.match(model.impact, /unknown/i);
  assert.equal(model.evidence, "No subsystem snapshots received");
  assert.equal(model.targetTab, null);
});

test("recovery model ignores malformed snapshot entries", () => {
  const model = buildDiagnosticsRecoveryModel({
    status: "unknown",
    severity: "info",
    timestamp: "2026-07-22T12:00:00.000Z",
    snapshots: [null, "bad", [], 7, {}],
  });

  assert.equal(model.state, "waiting");
  assert.equal(model.currentFailure, "Waiting for diagnostics");
  assert.equal(model.evidence, "No subsystem snapshots received");
});
