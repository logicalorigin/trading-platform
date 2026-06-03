import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __resetApiResourcePressureForTests,
  getApiResourcePressureSnapshot,
  updateApiResourcePressure,
} from "./resource-pressure";
import {
  classifyApiRoute,
  resolveApiRouteAdmission,
  withRouteAdmissionMetadata,
} from "./route-admission";

afterEach(() => {
  __resetApiResourcePressureForTests();
});

test("classifies broker-critical routes separately from analytics routes", () => {
  assert.equal(
    classifyApiRoute({ method: "POST", path: "/api/orders/submit" }),
    "critical-execution",
  );
  assert.equal(
    classifyApiRoute({ method: "GET", path: "/api/accounts/shadow/positions" }),
    "critical-position",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/accounts/U123/positions?mode=live",
    }),
    "live-data",
  );
  assert.equal(
    classifyApiRoute({ method: "GET", path: "/api/streams/accounts/page" }),
    "stream",
  );
  assert.equal(
    classifyApiRoute({ method: "GET", path: "/api/universe/logo-proxy" }),
    "decorative",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/algo/deployments/dep-1/signal-options/performance",
    }),
    "deferred-analytics",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/algo/deployments/dep-1/signal-options/state",
    }),
    "active-screen",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/algo/deployments/dep-1/signal-options/state?view=full",
    }),
    "deferred-analytics",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/algo/deployments/dep-1/cockpit",
    }),
    "active-screen",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/algo/deployments/dep-1/cockpit?view=full",
    }),
    "deferred-analytics",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/algo/events?includePayload=true",
    }),
    "deferred-analytics",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/signal-monitor/state?environment=paper",
    }),
    "active-screen",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/diagnostics/latest",
    }),
    "active-screen",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/diagnostics/history",
    }),
    "deferred-analytics",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/bars?symbol=SPY",
      requestFamily: "chart-visible",
      fetchPriority: 8,
    }),
    "active-screen",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/options/chart-bars?underlying=SPY",
      requestFamily: "chart-bars",
      fetchPriority: 6,
    }),
    "active-screen",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/bars?symbol=SPY",
      requestFamily: "chart-backfill",
      fetchPriority: -2,
    }),
    "deferred-analytics",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/flow/events?underlying=SPY",
    }),
    "deferred-analytics",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/flow/events?underlying=SPY",
      requestFamily: "flow-visible",
      fetchPriority: 8,
    }),
    "active-screen",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/flow/events/aggregate",
      requestFamily: "flow-scanner-visible",
      fetchPriority: 8,
    }),
    "active-screen",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/flow/universe",
      requestFamily: "flow-scanner-visible",
      fetchPriority: 8,
    }),
    "active-screen",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/flow/premium-distribution",
      requestFamily: "flow-scanner-visible",
      fetchPriority: 8,
    }),
    "active-screen",
  );
  assert.equal(
    classifyApiRoute({
      method: "POST",
      path: "/api/signal-monitor/matrix",
    }),
    "active-screen",
  );
  assert.equal(
    classifyApiRoute({
      method: "POST",
      path: "/api/algo/deployments/dep-1/signal-options/shadow-scan",
    }),
    "automation-control",
  );
  assert.equal(
    classifyApiRoute({
      method: "POST",
      path: "/api/algo/deployments/dep-1/signal-options/shadow-backfill",
    }),
    "background-maintenance",
  );
});

test("route admission lets visible flow scanner reads survive high API pressure", () => {
  const visibleFlow = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: "GET",
      path: "/api/flow/events/aggregate",
      requestFamily: "flow-scanner-visible",
      fetchPriority: 8,
    }),
    pressureLevel: "high",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });
  const backgroundFlow = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: "GET",
      path: "/api/flow/events/aggregate",
      requestFamily: "scanner",
      fetchPriority: -1,
    }),
    pressureLevel: "high",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });

  assert.equal(visibleFlow.routeClass, "active-screen");
  assert.equal(visibleFlow.action, "allow");
  assert.equal(visibleFlow.reason, null);
  assert.equal(backgroundFlow.routeClass, "deferred-analytics");
  assert.equal(backgroundFlow.action, "shed");
  assert.equal(backgroundFlow.statusCode, 429);
});

test("route admission lets visible flow distribution reads survive high API pressure", () => {
  const visibleFlow = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: "GET",
      path: "/api/flow/premium-distribution?limit=16&timeframe=today",
      requestFamily: "flow-scanner-visible",
      fetchPriority: 8,
    }),
    pressureLevel: "high",
    now: new Date("2026-06-02T19:00:00.000Z"),
  });
  const backgroundFlow = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: "GET",
      path: "/api/flow/premium-distribution?limit=16&timeframe=today",
      requestFamily: "analytics",
      fetchPriority: -1,
    }),
    pressureLevel: "high",
    now: new Date("2026-06-02T19:00:00.000Z"),
  });

  assert.equal(visibleFlow.routeClass, "active-screen");
  assert.equal(visibleFlow.action, "allow");
  assert.equal(visibleFlow.reason, null);
  assert.equal(backgroundFlow.routeClass, "deferred-analytics");
  assert.equal(backgroundFlow.action, "shed");
  assert.equal(backgroundFlow.statusCode, 429);
});

test("route admission sheds deferred work at high API pressure", () => {
  const execution = resolveApiRouteAdmission({
    routeClass: "critical-execution",
    pressureLevel: "high",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });
  const analytics = resolveApiRouteAdmission({
    routeClass: "deferred-analytics",
    pressureLevel: "high",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });

  assert.equal(execution.cacheOnly, false);
  assert.equal(execution.degraded, false);
  assert.equal(execution.action, "allow");
  assert.equal(analytics.cacheOnly, false);
  assert.equal(analytics.degraded, true);
  assert.equal(analytics.action, "shed");
  assert.equal(analytics.statusCode, 429);
  assert.equal(analytics.reason, "api-resource-pressure-high");
});

test("route admission lets manual shadow scans reach scanner pressure gates at high API pressure", () => {
  const admission = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: "POST",
      path: "/api/algo/deployments/dep-1/signal-options/shadow-scan",
    }),
    pressureLevel: "high",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });

  assert.equal(admission.routeClass, "automation-control");
  assert.equal(admission.action, "allow");
  assert.equal(admission.reason, null);
});

test("automation-only scanner pressure does not shed manual shadow scans", () => {
  updateApiResourcePressure({ automationActiveLongScanCount: 1 });
  const pressure = getApiResourcePressureSnapshot();

  const admission = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: "POST",
      path: "/api/algo/deployments/dep-1/signal-options/shadow-scan",
    }),
    pressureLevel: pressure.level,
    now: new Date("2026-05-28T19:00:00.000Z"),
  });

  assert.equal(pressure.level, "normal");
  assert.equal(pressure.scannerPressure.level, "high");
  assert.equal(admission.action, "allow");
  assert.equal(admission.reason, null);
});

test("route admission sheds safe browser QA fanout", () => {
  const stream = resolveApiRouteAdmission({
    routeClass: "stream",
    pressureLevel: "normal",
    qaMode: "safe",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });
  const execution = resolveApiRouteAdmission({
    routeClass: "critical-execution",
    pressureLevel: "normal",
    qaMode: "safe",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });

  assert.equal(stream.action, "shed");
  assert.equal(stream.statusCode, 429);
  assert.equal(stream.reason, "qa-safe-mode-shed");
  assert.equal(stream.qaMode, "safe");
  assert.equal(execution.action, "allow");
  assert.equal(execution.degraded, false);
});

test("route admission lets active Signals hydration run in safe browser QA", () => {
  const signalState = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: "GET",
      path: "/api/signal-monitor/state?environment=paper",
    }),
    pressureLevel: "normal",
    qaMode: "safe",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });
  const signalMatrix = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: "POST",
      path: "/api/signal-monitor/matrix",
    }),
    pressureLevel: "normal",
    qaMode: "safe",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });

  assert.equal(signalState.action, "allow");
  assert.equal(signalState.degraded, false);
  assert.equal(signalState.qaMode, "safe");
  assert.equal(signalMatrix.action, "allow");
  assert.equal(signalMatrix.degraded, false);
  assert.equal(signalMatrix.qaMode, "safe");
});

test("route admission sheds non-execution live data at critical pressure", () => {
  const liveData = resolveApiRouteAdmission({
    routeClass: "live-data",
    pressureLevel: "critical",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });
  const automationControl = resolveApiRouteAdmission({
    routeClass: "automation-control",
    pressureLevel: "critical",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });
  const position = resolveApiRouteAdmission({
    routeClass: "critical-position",
    pressureLevel: "critical",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });

  assert.equal(liveData.action, "shed");
  assert.equal(liveData.statusCode, 503);
  assert.equal(liveData.reason, "api-resource-pressure-critical");
  assert.equal(automationControl.action, "shed");
  assert.equal(automationControl.statusCode, 503);
  assert.equal(automationControl.reason, "api-resource-pressure-critical");
  assert.equal(position.action, "allow");
});

test("route admission keeps cached latest diagnostics available at critical pressure", () => {
  const latestDiagnostics = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: "GET",
      path: "/api/diagnostics/latest",
    }),
    pressureLevel: "critical",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });
  const diagnosticsHistory = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: "GET",
      path: "/api/diagnostics/history",
    }),
    pressureLevel: "critical",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });

  assert.equal(latestDiagnostics.action, "allow");
  assert.equal(latestDiagnostics.degraded, false);
  assert.equal(diagnosticsHistory.action, "shed");
  assert.equal(diagnosticsHistory.statusCode, 503);
});

test("route admission metadata marks stale analytics payloads", () => {
  const admission = resolveApiRouteAdmission({
    routeClass: "deferred-analytics",
    pressureLevel: "critical",
    now: new Date("2026-05-28T19:00:00.000Z"),
  });
  const payload = withRouteAdmissionMetadata({ rows: [] }, admission);

  assert.deepEqual(payload, {
    rows: [],
    degraded: true,
    stale: true,
    reason: "api-resource-pressure-critical",
    generatedAt: "2026-05-28T19:00:00.000Z",
    partial: false,
  });
});
