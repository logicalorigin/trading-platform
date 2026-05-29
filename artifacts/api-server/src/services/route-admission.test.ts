import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyApiRoute,
  resolveApiRouteAdmission,
  withRouteAdmissionMetadata,
} from "./route-admission";

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
      method: "POST",
      path: "/api/algo/deployments/dep-1/signal-options/shadow-scan",
    }),
    "background-maintenance",
  );
});

test("route admission degrades only deferred work under API pressure", () => {
  const execution = resolveApiRouteAdmission({
    routeClass: "critical-execution",
    pressureLevel: "critical",
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
  assert.equal(analytics.cacheOnly, true);
  assert.equal(analytics.degraded, true);
  assert.equal(analytics.action, "cache-only");
  assert.equal(analytics.reason, "api-resource-pressure-high");
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

test("route admission sheds non-execution live data at critical pressure", () => {
  const liveData = resolveApiRouteAdmission({
    routeClass: "live-data",
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
  assert.equal(position.action, "allow");
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
