import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalMatrixStatesBySymbol,
  hydrateSignalMatrixProfileTimeframe,
  resolveSignalMatrixVerdict,
  sortSignalsRows,
} from "./signalsRowModel.js";

const row = (symbol, universeRank) => ({
  symbol,
  universeRank,
  statusWeight: 0,
  direction: "",
  activityMs: 0,
});

test("Signals rows sort by universe rank", () => {
  const rows = [
    row("MSFT", 3),
    row("AAPL", 1),
    row("NVDA", 2),
  ];

  assert.deepEqual(
    sortSignalsRows(rows, { sortKey: "rank", direction: "asc" }).map(
      (item) => item.symbol,
    ),
    ["AAPL", "NVDA", "MSFT"],
  );
  assert.deepEqual(
    sortSignalsRows(rows, { sortKey: "rank", direction: "desc" }).map(
      (item) => item.symbol,
    ),
    ["MSFT", "NVDA", "AAPL"],
  );
});

const matrixState = (timeframe, direction) => ({
  symbol: "MU",
  timeframe,
  status: "ok",
  active: true,
  fresh: true,
  currentSignalDirection: direction,
  currentSignalAt: "2026-06-08T19:00:00.000Z",
  latestBarAt: "2026-06-08T19:10:00.000Z",
});

test("Signal matrix verdict ignores hidden non-trading timeframes", () => {
  const matrixStatesByTimeframe = {
    "2m": matrixState("2m", "buy"),
    "5m": matrixState("5m", "buy"),
    "15m": matrixState("15m", "buy"),
    "1h": matrixState("1h", "sell"),
    "1d": matrixState("1d", "sell"),
  };

  const selectedVerdict = resolveSignalMatrixVerdict({
    matrixStatesByTimeframe,
    profileTimeframe: "5m",
    timeframes: ["2m", "5m", "15m"],
  });

  assert.equal(selectedVerdict.direction, "buy");
  assert.equal(selectedVerdict.regime, "bull_trend");
  assert.equal(selectedVerdict.tradeReadiness, "ready");
  assert.equal(selectedVerdict.alignmentScore, 100);
});

test("Signal matrix strict mode does not backfill execution bubble from primary signal", () => {
  const primaryState = {
    symbol: "BLDR",
    timeframe: "5m",
    status: "ok",
    active: true,
    fresh: true,
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-08T19:50:33.889Z",
    latestBarAt: "2026-06-08T19:50:33.889Z",
  };

  assert.equal(
    hydrateSignalMatrixProfileTimeframe({
      matrixStatesByTimeframe: {},
      primaryState,
      profileTimeframe: "5m",
      includePrimaryFallback: false,
    })["5m"],
    undefined,
  );

  const verdict = resolveSignalMatrixVerdict({
    matrixStatesByTimeframe: {},
    primaryState,
    profileTimeframe: "5m",
    timeframes: ["2m", "5m", "15m"],
    includePrimaryFallback: false,
  });

  assert.equal(verdict.reasonCodes.includes("insufficient_matrix_data"), true);
  assert.equal(verdict.direction, null);
});

test("Signal matrix state index uses evaluated no-signal state over older signal", () => {
  const bySymbol = buildSignalMatrixStatesBySymbol([
    {
      symbol: "TSLA",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-06-08T12:00:00.000Z",
      latestBarAt: "2026-06-08T12:00:00.000Z",
      fresh: true,
    },
    {
      symbol: "TSLA",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: null,
      currentSignalAt: null,
      latestBarAt: "2026-06-08T13:00:00.000Z",
      lastEvaluatedAt: "2026-06-08T13:00:00.000Z",
      fresh: false,
    },
  ]);

  assert.equal(bySymbol.get("TSLA")["5m"].currentSignalDirection, null);
  assert.equal(
    bySymbol.get("TSLA")["5m"].latestBarAt,
    "2026-06-08T13:00:00.000Z",
  );
});
