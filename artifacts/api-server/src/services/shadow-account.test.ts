import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWatchlistBacktestFills,
  computeShadowOrderFees,
} from "./shadow-account";

test("computeShadowOrderFees applies IBKR Pro Fixed option fees", () => {
  assert.equal(
    computeShadowOrderFees({
      assetClass: "option",
      quantity: 3,
      price: 1.25,
      multiplier: 100,
    }),
    2.02,
  );
});

test("computeShadowOrderFees applies stock min and cap", () => {
  assert.equal(
    computeShadowOrderFees({
      assetClass: "equity",
      quantity: 10,
      price: 100,
    }),
    1,
  );
  assert.equal(
    computeShadowOrderFees({
      assetClass: "equity",
      quantity: 100_000,
      price: 1,
    }),
    500,
  );
  assert.equal(
    computeShadowOrderFees({
      assetClass: "equity",
      quantity: 100_000,
      price: 0.02,
    }),
    20,
  );
});

const shadowTotals = {
  cash: 30_000,
  startingBalance: 30_000,
  realizedPnl: 0,
  unrealizedPnl: 0,
  fees: 0,
  marketValue: 0,
  netLiquidation: 30_000,
  updatedAt: new Date("2026-05-01T14:00:00.000Z"),
};

const candidate = (patch: Record<string, unknown>) => ({
  symbol: "AAPL",
  side: "buy",
  signal: {},
  signalAt: new Date("2026-05-01T14:00:00.000Z"),
  signalPrice: 100,
  signalClose: 100,
  fillPrice: 100,
  placedAt: new Date("2026-05-01T14:15:00.000Z"),
  fillSource: "next_bar_open",
  watchlists: [{ id: "default", name: "Default" }],
  ...patch,
});

test("buildWatchlistBacktestFills uses run-scoped positions and long-only exits", () => {
  const result = buildWatchlistBacktestFills({
    runId: "run-1",
    marketDate: "2026-05-01",
    startingTotals: shadowTotals,
    baseMarketValue: 0,
    candidates: [
      candidate({}),
      candidate({ fillPrice: 101, signalAt: new Date("2026-05-01T14:30:00.000Z") }),
      candidate({
        side: "sell",
        fillPrice: 110,
        placedAt: new Date("2026-05-01T15:00:00.000Z"),
        signalAt: new Date("2026-05-01T14:45:00.000Z"),
      }),
      candidate({
        symbol: "MSFT",
        side: "sell",
        fillPrice: 250,
        placedAt: new Date("2026-05-01T15:15:00.000Z"),
        signalAt: new Date("2026-05-01T15:00:00.000Z"),
      }),
    ] as never,
  });

  assert.equal(result.fills.length, 2);
  assert.equal(result.fills[0]?.side, "buy");
  assert.equal(result.fills[0]?.quantity, 30);
  assert.equal(result.fills[0]?.positionKey, "watchlist_backtest:run-1:equity:AAPL");
  assert.equal(result.fills[1]?.side, "sell");
  assert.equal(result.fills[1]?.realizedPnl, 299);
  assert.deepEqual(
    result.skipped.map((skip) => skip.reason),
    ["same_symbol_position_open", "no_synthetic_position"],
  );
});
