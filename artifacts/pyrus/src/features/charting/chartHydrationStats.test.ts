import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearChartHydrationScope,
  getChartHydrationStatsSnapshot,
  recordChartBarScopeState,
} from "./chartHydrationStats.ts";

test("scope snapshots update when request-policy diagnostics change", () => {
  const scope = "chart-hydration-stats-test";
  const state = {
    timeframe: "15m",
    role: "primary" as const,
    requestedLimit: 720,
    baseRequestedLimit: 2_160,
    initialLimit: 180,
    targetLimit: 720,
    maxLimit: 2_000,
    hydratedBaseCount: 180,
    renderedBarCount: 60,
    livePatchedBarCount: 0,
    oldestLoadedAt: "2026-07-20T14:30:00.000Z",
    isPrependingOlder: false,
    hasExhaustedOlderHistory: false,
  };

  try {
    clearChartHydrationScope(scope);
    recordChartBarScopeState(scope, state);
    recordChartBarScopeState(scope, {
      ...state,
      baseRequestedLimit: 4_320,
      baseTimeframe: "5m",
      chartHydrationStatus: "hydrated",
    });

    const snapshot = getChartHydrationStatsSnapshot().scopes.find(
      (entry) => entry.scope === scope,
    );
    assert.equal(snapshot?.baseRequestedLimit, 4_320);
    assert.equal(snapshot?.baseTimeframe, "5m");
    assert.equal(snapshot?.chartHydrationStatus, "hydrated");
  } finally {
    clearChartHydrationScope(scope);
  }
});
