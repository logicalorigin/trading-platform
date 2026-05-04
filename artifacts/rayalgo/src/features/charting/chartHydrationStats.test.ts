import test from "node:test";
import assert from "node:assert/strict";
import {
  getChartHydrationStatsSnapshot,
  recordChartBarScopeState,
  recordChartHydrationCounter,
  recordChartHydrationMetric,
  sanitizeChartHydrationStatsForDiagnostics,
} from "./chartHydrationStats";

test("chart hydration stats records extended request metrics", () => {
  recordChartHydrationMetric("favoritePrewarmRequestMs", 25, "AAPL:5m");
  recordChartHydrationMetric("liveFallbackRequestMs", 40, "AAPL:5m");
  recordChartHydrationMetric("seriesSyncMs", 5, "AAPL:5m");
  recordChartHydrationMetric("deferredOverlayMs", 7, "AAPL:5m");

  const snapshot = getChartHydrationStatsSnapshot();

  assert.equal(snapshot.favoritePrewarmRequestMs.count >= 1, true);
  assert.equal(snapshot.liveFallbackRequestMs.count >= 1, true);
  assert.equal(snapshot.seriesSyncMs.count >= 1, true);
  assert.equal(snapshot.deferredOverlayMs.count >= 1, true);
  assert.equal(snapshot.favoritePrewarmRequestMs.p50, 25);
  assert.equal(snapshot.liveFallbackRequestMs.p50, 40);
  assert.equal(snapshot.seriesSyncMs.p50, 5);
  assert.equal(snapshot.deferredOverlayMs.p50, 7);
});

test("chart hydration stats ignores unknown metrics without throwing", () => {
  assert.doesNotThrow(() => {
    recordChartHydrationMetric("unknownMetricMs", 10, "AAPL:5m");
  });
});

test("chart hydration stats records global and scoped counters", () => {
  const scope = "SPY:1m:test";
  const before =
    getChartHydrationStatsSnapshot().counters.payloadShapeError ?? 0;

  recordChartHydrationCounter("payloadShapeError", scope);

  const snapshot = getChartHydrationStatsSnapshot();
  const scoped = snapshot.scopes.find((entry) => entry.scope === scope);

  assert.equal(snapshot.counters.payloadShapeError >= before + 1, true);
  assert.equal(scoped?.payloadShapeError, 1);
});

test("chart hydration stats derives scope counts and sanitizes cursor URLs", () => {
  const scope = "SPY:1m:diagnostics";
  recordChartBarScopeState(scope, {
    timeframe: "1m",
    role: "primary",
    requestedLimit: 500,
    initialLimit: 500,
    targetLimit: 1000,
    maxLimit: 5000,
    hydratedBaseCount: 500,
    renderedBarCount: 500,
    livePatchedBarCount: 2,
    oldestLoadedAt: "2026-04-30T13:30:00.000Z",
    isPrependingOlder: true,
    hasExhaustedOlderHistory: false,
    olderHistoryNextBeforeAt: "2026-04-30T13:29:59.999Z",
    emptyOlderHistoryWindowCount: 0,
    olderHistoryPageCount: 1,
    olderHistoryProvider: "polygon-history",
    olderHistoryExhaustionReason: null,
    olderHistoryProviderCursor:
      "https://api.polygon.io/v2/aggs/ticker/SPY?apiKey=secret",
    olderHistoryProviderNextUrl:
      "https://api.polygon.io/v2/aggs/ticker/SPY?apiKey=secret",
    olderHistoryProviderPageCount: 2,
    olderHistoryProviderPageLimitReached: true,
    olderHistoryCursor: "opaque-history-cursor",
  });

  const snapshot = getChartHydrationStatsSnapshot();
  const sanitized = sanitizeChartHydrationStatsForDiagnostics(snapshot);
  const scoped = sanitized.scopes.find((entry) => entry.scope === scope);

  assert.equal(snapshot.activeScopeCount >= 1, true);
  assert.equal(snapshot.prependingScopeCount >= 1, true);
  assert.equal(snapshot.scopeRoles.primary >= 1, true);
  assert.equal(scoped?.hasProviderCursor, true);
  assert.equal(scoped?.hasHistoryCursor, true);
  assert.equal("olderHistoryProviderCursor" in (scoped ?? {}), false);
  assert.equal("olderHistoryProviderNextUrl" in (scoped ?? {}), false);
  assert.equal("olderHistoryCursor" in (scoped ?? {}), false);
});
