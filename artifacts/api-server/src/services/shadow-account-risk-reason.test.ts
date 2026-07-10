import assert from "node:assert/strict";
import test from "node:test";

import {
  getShadowAccountRisk,
  __shadowWatchlistBacktestInternalsForTests as internals,
} from "./shadow-account";

const DB_UNAVAILABLE_REASON =
  "Shadow account database is temporarily unavailable.";

const baseTotals = {
  cash: 100,
  startingBalance: 100,
  realizedPnl: 0,
  unrealizedPnl: 0,
  fees: 0,
  marketValue: 0,
  netLiquidation: 100,
  updatedAt: new Date(),
};

function positionsResponse(overrides: Record<string, unknown>) {
  return {
    accountId: "shadow",
    currency: "USD",
    degraded: false,
    reason: null,
    stale: false,
    positions: [],
    totals: {},
    updatedAt: new Date(),
    ...overrides,
  };
}

const closedTrades = {
  accountId: "shadow",
  currency: "USD",
  degraded: false,
  reason: null,
  trades: [],
  summary: { count: 0, winners: 0, losers: 0, realizedPnl: 0, commissions: 0 },
  updatedAt: new Date(),
};

function riskPosition(marketValue: number) {
  return {
    id: "position-1",
    symbol: "AAPL",
    assetClass: "equity",
    positionType: "stock",
    quantity: 1,
    averageCost: 100,
    mark: marketValue,
    marketValue,
    weightPercent: 100,
    unrealizedPnl: marketValue - 100,
    unrealizedPnlPercent: marketValue - 100,
    dayChange: marketValue - 100,
    sector: "Technology",
    optionContract: null,
  };
}

test("risk propagates the upstream pressure reason instead of relabeling it DB-unavailable", async () => {
  internals.clearShadowAccountDbBackoff();
  const risk = await getShadowAccountRisk({
    detail: "fast",
    totals: baseTotals as never,
    positionsResponse: positionsResponse({
      degraded: true,
      stale: true,
      reason: "shadow_positions_pressure_fallback",
    }) as never,
    closedTrades: closedTrades as never,
  });
  assert.equal(risk.degraded, true);
  assert.equal(risk.reason, "shadow_positions_pressure_fallback");
});

test("risk is not degraded when upstream reads are healthy", async () => {
  internals.clearShadowAccountDbBackoff();
  const risk = await getShadowAccountRisk({
    detail: "fast",
    totals: baseTotals as never,
    positionsResponse: positionsResponse({}) as never,
    closedTrades: closedTrades as never,
  });
  assert.equal(risk.degraded, false);
  assert.equal(risk.reason, null);
});

test("risk reports DB-unavailable only when the backoff is genuinely active", async () => {
  internals.clearShadowAccountDbBackoff();
  internals.markShadowAccountDbUnavailable(
    Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  );
  try {
    const risk = await getShadowAccountRisk({
      detail: "fast",
      totals: baseTotals as never,
      positionsResponse: positionsResponse({}) as never,
      closedTrades: closedTrades as never,
    });
    assert.equal(risk.degraded, true);
    assert.equal(risk.reason, DB_UNAVAILABLE_REASON);
  } finally {
    internals.clearShadowAccountDbBackoff();
  }
});

test("identical injected risk inputs share one build and changed inputs do not collide", async () => {
  internals.clearShadowAccountDbBackoff();
  internals.invalidateShadowFreshStateCache();
  internals.resetShadowAccountReadDiagnosticsForTests();
  const positionSnapshotAt = new Date("2026-07-10T12:00:00.000Z");
  const input = {
    detail: "fast" as const,
    positionsResponse: positionsResponse({
      positions: [riskPosition(100)],
      totals: {
        cash: 100,
        netExposure: 100,
        netLiquidation: 200,
        startingBalance: 100,
      },
      updatedAt: positionSnapshotAt,
    }) as never,
    closedTrades: closedTrades as never,
  };

  try {
    const [first, second] = await Promise.all([
      getShadowAccountRisk(input),
      getShadowAccountRisk({
        ...input,
        closedTrades: {
          ...closedTrades,
          updatedAt: new Date(closedTrades.updatedAt.getTime() + 1_000),
        } as never,
      }),
    ]);
    assert.deepEqual(second, first);
    let builds = internals
      .getShadowAccountReadDiagnostics()
      .recent.filter(
        (event) =>
          event.status === "operation" && event.key.includes("risk-build:"),
      );
    assert.equal(builds.length, 1);

    const changed = await getShadowAccountRisk({
      ...input,
      positionsResponse: positionsResponse({
        positions: [riskPosition(125)],
        totals: {
          cash: 100,
          netExposure: 125,
          netLiquidation: 225,
          startingBalance: 100,
        },
        updatedAt: positionSnapshotAt,
      }) as never,
    });
    assert.equal(changed.concentration.topPositions[0]?.marketValue, 125);
    builds = internals
      .getShadowAccountReadDiagnostics()
      .recent.filter(
        (event) =>
          event.status === "operation" && event.key.includes("risk-build:"),
      );
    assert.equal(builds.length, 2);
  } finally {
    internals.invalidateShadowFreshStateCache();
    internals.resetShadowAccountReadDiagnosticsForTests();
  }
});
