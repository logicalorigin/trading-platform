import assert from "node:assert/strict";
import test from "node:test";

import { classifyApiRoute, resolveApiRouteAdmission } from "./route-admission";

test("Signal Options performance is active-screen so service cache fallback can run", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/algo/deployments/paper-id/signal-options/performance",
    }),
    "active-screen",
  );
});

test("Signal Options full state remains deferred analytics", () => {
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/algo/deployments/paper-id/signal-options/state?view=full",
    }),
    "deferred-analytics",
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
