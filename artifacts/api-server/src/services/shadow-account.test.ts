import assert from "node:assert/strict";
import { test } from "node:test";
import {
  __shadowWatchlistBacktestInternalsForTests,
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

test("buildWatchlistBacktestFills can stop out open longs before a RayReplica sell", () => {
  const result = buildWatchlistBacktestFills({
    runId: "run-stop-1",
    marketDate: "2026-05-01",
    startingTotals: shadowTotals,
    baseMarketValue: 0,
    riskOverlay: {
      label: "SL5",
      stopLossPercent: 5,
      trailingStopPercent: null,
    },
    barsBySymbol: new Map([
      [
        "AAPL",
        [
          {
            time: Math.floor(new Date("2026-05-01T14:45:00.000Z").getTime() / 1000),
            ts: "2026-05-01T14:45:00.000Z",
            o: 100,
            h: 101,
            l: 94,
            c: 95,
            v: 1_000,
          },
        ],
      ],
    ]),
    windowEnd: new Date("2026-05-01T15:00:00.000Z"),
    candidates: [candidate({})] as never,
  });

  assert.equal(result.fills.length, 2);
  assert.equal(result.fills[0]?.side, "buy");
  assert.equal(result.fills[1]?.side, "sell");
  assert.equal(result.fills[1]?.price, 95);
  assert.equal(result.fills[1]?.fillSource, "risk_stop_loss:SL5");
  assert.equal(result.fills[1]?.realizedPnl, -151);
});

test("watchlist backtest window keeps legacy single-day behavior", () => {
  const window =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      marketDate: "2026-05-01",
      now: new Date("2026-05-01T18:00:00.000Z"),
    });

  assert.equal(window.marketDate, "2026-05-01");
  assert.equal(window.marketDateFrom, "2026-05-01");
  assert.equal(window.marketDateTo, "2026-05-01");
  assert.equal(window.rangeKey, "2026-05-01");
  assert.equal(window.start.toISOString(), "2026-05-01T13:30:00.000Z");
  assert.equal(window.end.toISOString(), "2026-05-01T18:00:00.000Z");
});

test("watchlist backtest past_week resolves to five weekdays ending at the resolved date", () => {
  const fridayWindow =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "past_week",
      marketDate: "2026-05-01",
      now: new Date("2026-05-02T12:00:00.000Z"),
    });

  assert.equal(fridayWindow.marketDateFrom, "2026-04-27");
  assert.equal(fridayWindow.marketDateTo, "2026-05-01");
  assert.equal(fridayWindow.rangeKey, "2026-04-27:2026-05-01");
  assert.equal(fridayWindow.start.toISOString(), "2026-04-27T13:30:00.000Z");
  assert.equal(fridayWindow.cleanupEnd.toISOString(), "2026-05-02T04:00:00.000Z");

  const weekendWindow =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "week",
      marketDateTo: "2026-05-02",
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

  assert.equal(weekendWindow.marketDateFrom, "2026-04-27");
  assert.equal(weekendWindow.marketDateTo, "2026-05-01");
  assert.equal(weekendWindow.rangeKey, "2026-04-27:2026-05-01");
});

test("watchlist backtest last_month resolves to the previous New York calendar month", () => {
  const window =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "last_month",
      now: new Date("2026-05-02T00:15:00.000Z"),
    });

  assert.equal(window.marketDateFrom, "2026-04-01");
  assert.equal(window.marketDateTo, "2026-04-30");
  assert.equal(window.rangeKey, "2026-04-01:2026-04-30");
  assert.equal(window.start.toISOString(), "2026-04-01T13:30:00.000Z");
  assert.equal(window.cleanupEnd.toISOString(), "2026-05-01T04:00:00.000Z");

  const januaryWindow =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "month",
      now: new Date("2026-01-15T18:00:00.000Z"),
    });

  assert.equal(januaryWindow.marketDateFrom, "2025-12-01");
  assert.equal(januaryWindow.marketDateTo, "2025-12-31");
});

test("watchlist backtest ytd resolves from the New York calendar year start", () => {
  const window =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "ytd",
      now: new Date("2026-05-02T00:15:00.000Z"),
    });

  assert.equal(window.marketDateFrom, "2026-01-01");
  assert.equal(window.marketDateTo, "2026-05-01");
  assert.equal(window.rangeKey, "2026-01-01:2026-05-01");
  assert.equal(window.start.toISOString(), "2026-01-01T14:30:00.000Z");
  assert.equal(window.cleanupEnd.toISOString(), "2026-05-02T04:00:00.000Z");

  const aliasWindow =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "since_2026",
      now: new Date("2026-05-02T00:15:00.000Z"),
    });

  assert.equal(aliasWindow.marketDateFrom, "2026-01-01");
  assert.equal(aliasWindow.marketDateTo, "2026-05-01");
});

test("watchlist backtest regular-session filter uses New York market hours", () => {
  const isRegularSession =
    __shadowWatchlistBacktestInternalsForTests.isWatchlistBacktestRegularSessionTime;

  assert.equal(isRegularSession(new Date("2026-01-02T14:30:00.000Z")), true);
  assert.equal(isRegularSession(new Date("2026-01-02T20:59:00.000Z")), true);
  assert.equal(isRegularSession(new Date("2026-01-02T21:00:00.000Z")), false);
  assert.equal(
    isRegularSession(new Date("2026-01-02T21:00:00.000Z"), {
      allowClosePrint: true,
    }),
    true,
  );
  assert.equal(isRegularSession(new Date("2026-01-02T09:00:00.000Z")), false);
  assert.equal(isRegularSession(new Date("2026-01-03T15:00:00.000Z")), false);
});

test("watchlist backtest rejects inverted date ranges", () => {
  assert.throws(
    () =>
      __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
        marketDateFrom: "2026-05-04",
        marketDateTo: "2026-05-01",
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "shadow_backtest_date_range_invalid",
  );
});

test("watchlist backtest range cleanup matches range keys and date metadata", () => {
  const range = {
    marketDateFrom: "2026-04-27",
    marketDateTo: "2026-05-01",
    rangeKey: "2026-04-27:2026-05-01",
  };
  const matches =
    __shadowWatchlistBacktestInternalsForTests.watchlistBacktestOrderMatchesRange;

  assert.equal(
    matches({ metadata: { rangeKey: "2026-04-27:2026-05-01" } }, range),
    true,
  );
  assert.equal(
    matches({ metadata: { marketDate: "2026-04-29" } }, range),
    true,
  );
  assert.equal(
    matches({ metadata: { marketDate: "2026-05-04" } }, range),
    false,
  );
  assert.equal(matches({ metadata: { rangeKey: "2026-05-04" } }, range), false);
});

test("watchlist backtest snapshot sources preserve single-day compatibility and range identity", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;

  assert.equal(
    internals.watchlistBacktestSnapshotSource("2026-05-01"),
    "watchlist_backtest:2026-05-01",
  );
  assert.equal(
    internals.watchlistBacktestSnapshotSource("2026-04-27:2026-05-01"),
    "watchlist_bt:20260427:20260501",
  );
  assert.deepEqual(
    internals.watchlistBacktestSnapshotSourcesForRange({
      marketDateFrom: "2026-04-30",
      marketDateTo: "2026-05-01",
      rangeKey: "2026-04-30:2026-05-01",
    }),
    [
      "watchlist_bt:20260430:20260501",
      "watchlist_backtest:2026-04-30",
      "watchlist_backtest:2026-05-01",
    ],
  );
});
