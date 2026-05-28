import assert from "node:assert/strict";
import test from "node:test";
import { buildApiReadinessPayload } from "./readiness";
import { updateApiResourcePressure, __resetApiResourcePressureForTests } from "./resource-pressure";
import type { DiagnosticsLatestPayload } from "./diagnostics";

const baseDiagnostics = (
  overrides: Partial<DiagnosticsLatestPayload> = {},
): DiagnosticsLatestPayload => ({
  timestamp: "2026-05-28T19:00:00.000Z",
  status: "ok",
  severity: "info",
  summary: "ok",
  snapshots: [
    {
      id: "ibkr",
      observedAt: "2026-05-28T19:00:00.000Z",
      subsystem: "ibkr",
      status: "ok",
      severity: "info",
      summary: "IBKR ready",
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
  events: [],
  thresholds: [],
  ...overrides,
});

test.afterEach(() => {
  __resetApiResourcePressureForTests();
});

test("readiness keeps liveness separate from app pressure", () => {
  const pressure = updateApiResourcePressure({ rssMb: 1_650 });
  const payload = buildApiReadinessPayload({
    diagnostics: baseDiagnostics(),
    pressure,
    now: new Date("2026-05-28T19:00:00.000Z"),
  });

  assert.equal(payload.liveness.status, "ok");
  assert.equal(payload.appReadiness.status, "not_ready");
  assert.equal(payload.appReadiness.reason, "api_resource_pressure_critical");
  assert.equal(payload.brokerTradingReadiness.ready, true);
  assert.equal(payload.manualTradingBlockedReason, null);
});

test("readiness blocks manual trading only for broker readiness failures", () => {
  const diagnostics = baseDiagnostics({
    snapshots: [
      {
        id: "ibkr",
        observedAt: "2026-05-28T19:00:00.000Z",
        subsystem: "ibkr",
        status: "down",
        severity: "critical",
        summary: "Gateway login required",
        dimensions: {},
        metrics: {
          configured: true,
          reachable: true,
          connected: true,
          authenticated: false,
          competing: false,
          healthFresh: true,
          streamFresh: true,
          strictReady: false,
          strictReason: "gateway_login_required",
        },
        raw: {},
      },
    ],
  });
  const payload = buildApiReadinessPayload({
    diagnostics,
    now: new Date("2026-05-28T19:00:00.000Z"),
  });

  assert.equal(payload.brokerTradingReadiness.ready, false);
  assert.equal(payload.brokerTradingReadiness.reason, "gateway_login_required");
  assert.equal(payload.manualTradingBlockedReason, "gateway_login_required");
});
