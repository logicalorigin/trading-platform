import assert from "node:assert/strict";
import test from "node:test";

import {
  apiRouteAdmissionMiddleware,
  classifyApiRoute,
  resolveApiRouteAdmission,
} from "./route-admission";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";

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

test("tax planning routes keep protected admission classes", () => {
  assert.equal(
    classifyApiRoute({
      method: "POST",
      path: "/api/accounts/live-account-id/tax/preflight",
    }),
    "protected-execution",
  );
  assert.equal(
    classifyApiRoute({
      method: "PUT",
      path: "/api/tax/profile",
    }),
    "protected-execution",
  );
  assert.equal(
    classifyApiRoute({
      method: "POST",
      path: "/api/tax/reserve/plan",
    }),
    "protected-execution",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/tax/reserve",
    }),
    "protected-position",
  );
  assert.equal(
    classifyApiRoute({
      method: "GET",
      path: "/api/accounts/live-account-id/tax/lots",
    }),
    "protected-position",
  );
});

test("IBKR order warning replies keep protected execution admission", () => {
  assert.equal(
    classifyApiRoute({ method: "POST", path: "/api/orders/reply" }),
    "protected-execution",
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

test("Massive option chart bars default to live data, not shed-prone analytics", () => {
  const routeClass = classifyApiRoute({
    method: "GET",
    path: "/api/options/chart-bars?underlying=AAPL&timeframe=1m",
  });

  assert.equal(routeClass, "live-data");
  assert.equal(
    resolveApiRouteAdmission({
      routeClass,
      pressureLevel: "high",
    }).action,
    "allow",
  );
});

test("Massive flow events default to live data, not shed-prone analytics", () => {
  const routeClass = classifyApiRoute({
    method: "GET",
    path: "/api/flow/events?underlying=SPY",
  });

  assert.equal(routeClass, "live-data");
  assert.equal(
    resolveApiRouteAdmission({
      routeClass,
      pressureLevel: "high",
    }).action,
    "allow",
  );
});

test("explicit option chart backfills remain deferrable under pressure", () => {
  const routeClass = classifyApiRoute({
    method: "GET",
    path: "/api/options/chart-bars?underlying=AAPL&timeframe=1m",
    requestFamily: "chart-backfill",
    fetchPriority: 4,
  });

  assert.equal(routeClass, "deferred-analytics");
  assert.equal(
    resolveApiRouteAdmission({
      routeClass,
      pressureLevel: "high",
    }).action,
    "shed",
  );
});

test("selected trade option-chain metadata remains active-screen", () => {
  const routeClass = classifyApiRoute({
    method: "POST",
    path: "/api/options/chains",
    requestFamily: "trade-option-chain",
    fetchPriority: 8,
  });

  assert.equal(routeClass, "active-screen");
  assert.equal(
    resolveApiRouteAdmission({
      routeClass,
      pressureLevel: "high",
    }).action,
    "allow",
  );
});

test("trade option-chain batches remain deferrable under pressure", () => {
  const routeClass = classifyApiRoute({
    method: "POST",
    path: "/api/options/chains/batch",
    requestFamily: "trade-option-chain-batch",
    fetchPriority: -2,
  });

  assert.equal(routeClass, "deferred-analytics");
  assert.equal(
    resolveApiRouteAdmission({
      routeClass,
      pressureLevel: "high",
    }).action,
    "shed",
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

test("sparkline seed is deferred analytics and sheds under finite-resource pressure", () => {
  const routeClass = classifyApiRoute({
    method: "POST",
    path: "/api/sparklines/seed",
  });

  assert.equal(routeClass, "deferred-analytics");
  assert.equal(
    resolveApiRouteAdmission({
      routeClass,
      pressureLevel: "high",
    }).action,
    "shed",
  );
});

test("route pressure headers stay aligned with finite-resource admission", () => {
  __resetApiResourcePressureForTests();
  try {
    updateApiResourcePressure({ eventLoopDelayP95Ms: 1_500 });
    updateApiResourcePressure({ eventLoopDelayP95Ms: 1_500 });

    const headers = new Map<string, string>();
    let nextCalled = false;
    const req = {
      method: "GET",
      originalUrl: "/api/healthz",
      url: "/api/healthz",
      path: "/api/healthz",
      query: {},
      get: () => undefined,
    };
    const res = {
      locals: {},
      setHeader(name: string, value: unknown) {
        headers.set(name, String(value));
        return this;
      },
      status() {
        throw new Error("event-loop-only pressure must not shed health");
      },
      type() {
        return this;
      },
      json() {
        return this;
      },
      end() {
        return this;
      },
    };

    apiRouteAdmissionMiddleware(
      req as unknown as Parameters<typeof apiRouteAdmissionMiddleware>[0],
      res as unknown as Parameters<typeof apiRouteAdmissionMiddleware>[1],
      () => {
        nextCalled = true;
      },
    );

    assert.equal(nextCalled, true);
    assert.equal(headers.get("X-Pyrus-Pressure-Level"), "normal");
    assert.equal(headers.get("X-Pyrus-Resource-Level"), "normal");
    assert.equal(headers.get("X-Pyrus-Observed-Resource-Level"), "high");
  } finally {
    __resetApiResourcePressureForTests();
  }
});

test("visible sparkline seed remains deferred analytics", () => {
  const routeClass = classifyApiRoute({
    method: "POST",
    path: "/api/sparklines/seed",
    requestFamily: "signal-sparkline-seed",
    fetchPriority: 6,
  });

  assert.equal(routeClass, "deferred-analytics");
  assert.equal(
    resolveApiRouteAdmission({
      routeClass,
      pressureLevel: "high",
    }).action,
    "shed",
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
