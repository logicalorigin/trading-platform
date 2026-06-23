import assert from "node:assert/strict";
import test from "node:test";

import { classifyApiRoute, resolveApiRouteAdmission } from "./route-admission";

test("Signal Options performance is active-screen", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/algo/deployments/paper-id/signal-options/performance",
    }),
    "active-screen",
  );
});

test("Signal Quality KPIs are background-maintenance", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/algo/deployments/paper-id/signal-quality-kpis",
    }),
    "background-maintenance",
  );
});

test("Signal Quality KPIs are shed under high pressure", () => {
  const routeClass = classifyApiRoute({
    method: "GET",
    path: "/api/algo/deployments/paper-id/signal-quality-kpis",
  });

  assert.equal(routeClass, "background-maintenance");
  assert.equal(
    resolveApiRouteAdmission({
      routeClass,
      pressureLevel: "high",
    }).action,
    "shed",
  );
});

test("Signal Options full state remains active-screen", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/algo/deployments/paper-id/signal-options/state?view=full",
    }),
    "active-screen",
  );
});

test("algo signal sparklines stay active-screen at near priority", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/bars",
      requestFamily: "algo-signal-sparkline",
      fetchPriority: 4,
    }),
    "active-screen",
  );
});

test("api-prefixed algo signal sparklines stay active-screen at near priority", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/bars?symbol=SPY&timeframe=1m",
      requestFamily: "algo-signal-sparkline",
      fetchPriority: 4,
    }),
    "active-screen",
  );
});

test("api-prefixed high-priority bars requests stay active-screen", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/bars?symbol=SPY&timeframe=1m",
      fetchPriority: 8,
    }),
    "active-screen",
  );
});

test("high-priority passive sparklines are not grouped with charts", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/bars?symbol=SPY&timeframe=1m",
      requestFamily: "sparkline",
      fetchPriority: 8,
    }),
    "deferred-analytics",
  );
});

test("visible signal row chart bars stay active-screen at visible priority", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/bars",
      requestFamily: "signals-row-chart",
      fetchPriority: 6,
    }),
    "active-screen",
  );
});

test("signal-table sparklines stay separate from chart-family priority rules", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/bars?symbol=SPY&timeframe=1m",
      requestFamily: "signals-table-sparkline",
      fetchPriority: 4,
    }),
    "active-screen",
  );
});

test("visible trade chart warmups stay active-screen", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/bars?symbol=SPY&timeframe=1m",
      requestFamily: "chart-warmup",
      fetchPriority: 6,
    }),
    "active-screen",
  );
});

test("visible trade chart warmups are allowed under high pressure", () => {
  const routeClass = classifyApiRoute({
    method: "GET",
    path: "/api/bars?symbol=SPY&timeframe=1m",
    requestFamily: "chart-warmup",
    fetchPriority: 6,
  });

  assert.equal(
    resolveApiRouteAdmission({
      routeClass,
      pressureLevel: "high",
    }).action,
    "allow",
  );
});

test("near-priority trade chart warmups remain deferrable", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/bars?symbol=SPY&timeframe=1m",
      requestFamily: "chart-warmup",
      fetchPriority: 4,
    }),
    "deferred-analytics",
  );
});

test("background bars requests remain deferred analytics", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/bars",
      requestFamily: "sparkline",
      fetchPriority: -2,
    }),
    "deferred-analytics",
  );
});

test("active-screen algo signal sparklines are allowed under high pressure", () => {
  assert.equal(
    resolveApiRouteAdmission({
      routeClass: "active-screen",
      pressureLevel: "high",
    }).action,
    "allow",
  );
});

test("diagnostics client-events is active-screen, not shed under pressure", () => {
  for (const path of [
    "/diagnostics/client-events",
    "/api/diagnostics/client-events",
  ]) {
    const routeClass = classifyApiRoute({ method: "POST", path });
    assert.equal(routeClass, "active-screen", path);
    assert.equal(
      resolveApiRouteAdmission({ routeClass, pressureLevel: "high" }).action,
      "allow",
      path,
    );
  }
});

test("diagnostics client-metrics stays active-screen alongside client-events", () => {
  assert.equal(
    classifyApiRoute({ method: "POST", path: "/diagnostics/client-metrics" }),
    "active-screen",
  );
});
