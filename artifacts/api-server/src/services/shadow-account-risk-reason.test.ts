import assert from "node:assert/strict";
import test from "node:test";

import {
  getShadowAccountRisk,
  __shadowWatchlistBacktestInternalsForTests as internals,
} from "./shadow-account";

const DB_FALLBACK_REASON =
  "Shadow account database is unavailable; using runtime-only shadow account fallback.";

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
    assert.equal(risk.reason, DB_FALLBACK_REASON);
  } finally {
    internals.clearShadowAccountDbBackoff();
  }
});
