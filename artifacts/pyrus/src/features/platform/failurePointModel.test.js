import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAlgoStatusFailurePoint,
  buildFailurePointFromDiagnosticEvent,
  buildFailurePointFromDiagnosticsSnapshot,
  buildIbkrConnectionFailurePoint,
  buildMemoryPressureFailurePoint,
  redactDiagnosticText,
} from "./failurePointModel.js";

test("redactDiagnosticText masks secrets, urls, and account-like ids", () => {
  const text =
    "bridge https://example.invalid/api?token=secret-token account U123456789 password=hunter2";

  const redacted = redactDiagnosticText(text);

  assert.doesNotMatch(redacted, /secret-token/);
  assert.doesNotMatch(redacted, /hunter2/);
  assert.doesNotMatch(redacted, /https:\/\/example/);
  assert.match(redacted, /\[url redacted\]/);
  assert.match(redacted, /U1\.\.\.89/);
});

test("buildFailurePointFromDiagnosticsSnapshot summarizes api route pressure", () => {
  const point = buildFailurePointFromDiagnosticsSnapshot({
    subsystem: "api",
    status: "down",
    severity: "critical",
    summary: "API latency or errors are elevated",
    observedAt: "2026-06-02T14:21:27.120Z",
    metrics: {
      p95LatencyMs: 5204,
      p99LatencyMs: 11873,
      errorCount5m: 8,
      dominantSlowRoute: "/settings/ibkr-line-usage",
      dominantSlowRouteP95Ms: 10184,
      dominantErrorRoute: "/api/positions",
      dominantErrorRouteCount: 3,
    },
  });

  assert.equal(point.severity, "critical");
  assert.equal(point.source, "api");
  assert.match(point.title, /API/);
  assert.match(point.summary, /latency/i);
  assert.deepEqual(point.metrics.slice(0, 3), [
    ["p95", "5.2s"],
    ["p99", "11.9s"],
    ["Errors / 5m", "8"],
  ]);
  assert.ok(
    point.topCauses.some((cause) =>
      cause.includes("/settings/ibkr-line-usage"),
    ),
  );
  assert.match(point.nextAction, /slow and error routes/i);
});

test("buildFailurePointFromDiagnosticEvent keeps event code and repeat count", () => {
  const point = buildFailurePointFromDiagnosticEvent({
    severity: "warning",
    message: "Order visibility read probe is degraded",
    subsystem: "orders",
    category: "readiness",
    code: "orders_timeout",
    eventCount: 4,
    lastSeenAt: "2026-06-02T14:21:27.120Z",
  });

  assert.equal(point.reason, "orders timeout");
  assert.equal(point.observedAt, "2026-06-02T14:21:27.120Z");
  assert.deepEqual(point.metrics, [
    ["Subsystem", "orders"],
    ["Category", "readiness"],
    ["Repeats", "4"],
  ]);
});

test("buildAlgoStatusFailurePoint explains critical gateway and attention causes", () => {
  const point = buildAlgoStatusFailurePoint({
    status: "critical",
    gatewayReady: false,
    scanOn: true,
    deploymentEnabled: true,
    attentionItems: [
      {
        severity: "critical",
        kindLabel: "RULE",
        title: "Daily halt",
        summary: "Daily loss limit reached",
      },
    ],
    cockpitTradePath: { gatewayBlocks: 2 },
  });

  assert.equal(point.severity, "critical");
  assert.match(point.summary, /data bridge/i);
  assert.ok(point.topCauses.some((cause) => cause.includes("Daily halt")));
  assert.ok(point.topCauses.some((cause) => cause.includes("2 gateway")));
  assert.match(point.nextAction, /bridge/i);
});

test("buildIbkrConnectionFailurePoint lists bridge proof gaps", () => {
  const point = buildIbkrConnectionFailurePoint({
    label: "IB Gateway",
    proof: {
      strictReady: false,
      strictReason: "gateway_socket_disconnected",
      streamStateReason: "stale_stream_event",
      healthAgeMs: 9200,
      socketConnected: false,
      authenticated: true,
    },
  });

  assert.equal(point.source, "ibkr");
  assert.equal(point.reason, "gateway socket disconnected");
  assert.ok(point.topCauses.some((cause) => cause.includes("Socket disconnected")));
  assert.match(point.nextAction, /bridge/i);
});

test("buildMemoryPressureFailurePoint summarizes dominant pressure drivers", () => {
  const point = buildMemoryPressureFailurePoint({
    signal: {
      level: "high",
      trend: "steady",
      apiRssMb: 2253.3,
      apiHeapUsedPercent: 28.2,
      dominantDrivers: [
        { kind: "api-latency", label: "API latency", level: "high", detail: "16499 ms" },
      ],
    },
  });

  assert.equal(point.severity, "warning");
  assert.equal(point.reason, "high");
  assert.ok(point.topCauses[0].includes("API latency"));
  assert.deepEqual(point.metrics.slice(0, 2), [
    ["Level", "HIGH"],
    ["Trend", "steady"],
  ]);
});
