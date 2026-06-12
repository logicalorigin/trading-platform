import assert from "node:assert/strict";
import test from "node:test";

import { extractSparklinePoints } from "../../components/platform/primitives.jsx";
import {
  buildAlgoSignalMatrixHydrationRequest,
  buildStaSparklineHydrationSymbols,
  buildStaSignalSparklineBatchRequest,
  buildStaSignalStatusSummary,
  hasUsableSparklineData,
  resolveRowTickerSnapshot,
  splitStaRowsBySignalMatrixHydration,
} from "./OperationsSignalTable.jsx";

test("STA signal matrix hydration uses control-rail trading timeframes only", () => {
  const request = buildAlgoSignalMatrixHydrationRequest({
    rows: [
      {
        signal: {
          symbol: "SPY",
          timeframe: "5m",
        },
      },
    ],
    currentStates: [],
    timeframes: ["1m", "2m", "5m"],
  });

  assert.deepEqual(request.requestSymbols, ["SPY"]);
  assert.deepEqual(request.requestTimeframes, ["5m", "1m", "2m"]);
  assert.deepEqual(
    request.requestCells.map((cell) => cell.timeframe),
    ["5m", "1m", "2m"],
  );
});

test("STA status summary separates rows, received signals, actions, and history", () => {
  const summary = buildStaSignalStatusSummary({
    activeFilterLabel: "All",
    visibleCount: 9,
    totalCount: 14,
    receivedCount: 8,
    actionCount: 3,
    historyCount: 5,
    freshnessLine: "Signal 2m ago",
    receivedHistorySourceStatus: "runtime-fallback",
  });

  assert.equal(
    summary.statusLine,
    "All 9/14 rows · Received 8 · Actions 3 · History 5 · Signal 2m ago",
  );
  assert.equal(summary.mobileStatusLine, "All 9/14 · Rec 8 · Act 3 · Hist 5");
});

test("STA signal matrix hydration prioritizes the row execution timeframe", () => {
  const request = buildAlgoSignalMatrixHydrationRequest({
    rows: [
      {
        signal: {
          symbol: "MU",
          timeframe: "5m",
        },
      },
    ],
    currentStates: [],
    timeframes: ["2m", "5m", "15m"],
  });

  assert.deepEqual(
    request.requestCells.map((cell) => `${cell.symbol}:${cell.timeframe}`),
    ["MU:5m", "MU:2m", "MU:15m"],
  );
  assert.deepEqual(request.requestTimeframes, ["5m", "2m", "15m"]);
});

test("STA signal matrix hydration refreshes stale selected bubbles", () => {
  const request = buildAlgoSignalMatrixHydrationRequest({
    rows: [
      {
        signal: {
          symbol: "VST",
          timeframe: "5m",
        },
      },
    ],
    currentStates: [
      {
        symbol: "VST",
        timeframe: "2m",
        active: true,
        latestBarAt: "2026-06-08T18:00:00.000Z",
        lastEvaluatedAt: "2026-06-08T18:00:10.000Z",
        status: "stale",
      },
      {
        symbol: "VST",
        timeframe: "5m",
        active: true,
        latestBarAt: "2026-06-08T18:00:00.000Z",
        lastEvaluatedAt: "2026-06-08T18:00:10.000Z",
        status: "ok",
      },
    ],
    timeframes: ["2m", "5m", "15m"],
  });

  assert.deepEqual(
    request.requestCells.map((cell) => `${cell.symbol}:${cell.timeframe}`),
    ["VST:2m", "VST:15m"],
  );
});

test("STA signal rows do not wait for companion timeframe bubbles", () => {
  const rows = [
    {
      signal: {
        symbol: "ALIT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-09T13:35:00.000Z",
      },
    },
    {
      signal: {
        symbol: "SPY",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T13:35:00.000Z",
      },
    },
  ];

  const split = splitStaRowsBySignalMatrixHydration({
    rows,
    signalMatrixBySymbol: {
      ALIT: {
        "5m": {
          symbol: "ALIT",
          timeframe: "5m",
          status: "ok",
          latestBarAt: "2026-06-09T13:35:00.000Z",
        },
      },
      SPY: {
        "1m": {
          symbol: "SPY",
          timeframe: "1m",
          status: "stale",
          latestBarAt: "2026-06-09T13:35:00.000Z",
        },
        "5m": {
          symbol: "SPY",
          timeframe: "5m",
          status: "ok",
          latestBarAt: "2026-06-09T13:35:00.000Z",
        },
      },
    },
    timeframes: ["1m", "5m"],
  });

  assert.deepEqual(
    split.hydratedRows.map((row) => row.signal.symbol),
    ["ALIT", "SPY"],
  );
  assert.deepEqual(split.pendingRows, []);
  assert.deepEqual(
    split.rows.map((row) => row.signal.symbol),
    ["ALIT", "SPY"],
  );
  assert.deepEqual(split.rows[0].matrixHydration.missingTimeframes, ["1m"]);

  const request = buildAlgoSignalMatrixHydrationRequest({
    rows,
    currentStates: [
      {
        symbol: "ALIT",
        timeframe: "5m",
        status: "ok",
        latestBarAt: "2026-06-09T13:35:00.000Z",
      },
      {
        symbol: "SPY",
        timeframe: "1m",
        status: "stale",
        latestBarAt: "2026-06-09T13:35:00.000Z",
      },
      {
        symbol: "SPY",
        timeframe: "5m",
        status: "ok",
        latestBarAt: "2026-06-09T13:35:00.000Z",
      },
    ],
    timeframes: ["1m", "5m"],
  });

  assert.deepEqual(
    request.requestCells.map((cell) => `${cell.symbol}:${cell.timeframe}`),
    ["ALIT:1m", "SPY:1m"],
  );
});

test("STA normal rows accept evaluated diagnostic signal bubbles", () => {
  const rows = [
    {
      signal: {
        symbol: "QCOM",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-09T13:25:00.000Z",
      },
    },
  ];

  const split = splitStaRowsBySignalMatrixHydration({
    rows,
    signalMatrixBySymbol: {
      QCOM: {
        "2m": {
          symbol: "QCOM",
          timeframe: "2m",
          status: "ok",
          latestBarAt: "2026-06-09T14:27:00.000Z",
        },
        "5m": {
          symbol: "QCOM",
          timeframe: "5m",
          status: "unavailable",
          lastEvaluatedAt: "2026-06-09T14:30:37.745Z",
          lastError: "No broker history bars were available for this symbol.",
        },
        "15m": {
          symbol: "QCOM",
          timeframe: "15m",
          status: "error",
          lastEvaluatedAt: "2026-06-09T14:30:37.745Z",
          lastError: "Signal computation unavailable.",
        },
      },
    },
    timeframes: ["2m", "5m", "15m"],
  });

  assert.deepEqual(
    split.hydratedRows.map((row) => row.signal.symbol),
    ["QCOM"],
  );
  assert.deepEqual(split.pendingRows, []);
});

test("STA row ticker snapshot keeps quote and direct sparkline hydration", () => {
  const snapshot = resolveRowTickerSnapshot(
    {
      symbol: "APLD",
      price: 41.1,
      bid: null,
      ask: null,
      sparkBars: [],
    },
    {
      symbol: "APLD",
      price: 41.09,
      bid: 41.08,
      ask: 41.12,
      updatedAt: "2026-06-08T19:35:00.000Z",
    },
    {
      symbol: "APLD",
      sparkBars: [
        { close: 40.8, timestamp: "2026-06-08T19:25:00.000Z" },
        { close: 41.1, timestamp: "2026-06-08T19:30:00.000Z" },
      ],
    },
  );

  assert.equal(snapshot.price, 41.1);
  assert.equal(snapshot.bid, 41.08);
  assert.equal(snapshot.ask, 41.12);
  assert.equal(snapshot.sparkBars.length, 2);
  assert.equal(extractSparklinePoints(snapshot.sparkBars).length, 2);
});

test("STA row ticker snapshot does not let non-drawable runtime bars mask hydrated bars", () => {
  const hydratedSparkBars = [
    { close: 12.1, timestamp: "2026-06-08T19:25:00.000Z" },
    { close: 12.4, timestamp: "2026-06-08T19:30:00.000Z" },
  ];
  const snapshot = resolveRowTickerSnapshot(
    {
      symbol: "FFAI",
      price: 12.4,
      sparkBars: [
        { timestamp: "2026-06-08T19:20:00.000Z" },
        { timestamp: "2026-06-08T19:21:00.000Z" },
      ],
      spark: [
        { timestamp: "2026-06-08T19:20:00.000Z" },
        { timestamp: "2026-06-08T19:21:00.000Z" },
      ],
    },
    null,
    {
      symbol: "FFAI",
      sparkBars: hydratedSparkBars,
    },
  );

  assert.equal(snapshot.sparkBars, hydratedSparkBars);
  assert.equal(extractSparklinePoints(snapshot.sparkBars).length, 2);
  assert.equal(snapshot.spark, null);
});

test("STA sparkline hydration ignores non-drawable fallback bars", () => {
  assert.equal(
    hasUsableSparklineData({
      bars: [
        { timestamp: "2026-06-08T20:00:00.000Z" },
        { timestamp: "2026-06-08T20:01:00.000Z" },
      ],
    }),
    false,
  );
  assert.equal(
    hasUsableSparklineData({
      bars: [{ c: 99 }, { c: 100 }],
    }),
    true,
  );
});

test("STA sparkline hydration requests compact visible batch bars", () => {
  const request = buildStaSignalSparklineBatchRequest([" spy ", "NVDA"]);

  assert.deepEqual(
    request.requests.map((item) => item.key),
    ["SPY", "NVDA"],
  );
  assert.deepEqual(
    request.requests.map((item) => item.responseShape),
    ["sparkline", "sparkline"],
  );
  assert.deepEqual(
    request.requests.map((item) => item.timeframe),
    ["1m", "1m"],
  );
  assert.deepEqual(
    request.requests.map((item) => item.brokerRecentWindowMinutes),
    [0, 0],
  );
});

test("STA sparkline hydration preloads adjacent rows without stale fallback bars", () => {
  const rows = Array.from({ length: 80 }, (_, index) => ({
    signal: {
      symbol: `SYM${String(index + 1).padStart(2, "0")}`,
      ...(index === 21
        ? {
            bars: [{ timestamp: "2026-06-08T20:00:00.000Z" }],
          }
        : null),
      ...(index === 22
        ? {
            sparkBars: [{ close: 100 }, { close: 101 }],
          }
        : null),
    },
  }));

  const symbols = buildStaSparklineHydrationSymbols({
    rows,
    page: 2,
    pageSize: 20,
    maxSymbols: 60,
  });

  assert.equal(symbols[0], "SYM01");
  assert.equal(symbols.includes("SYM22"), true);
  assert.equal(symbols.includes("SYM23"), false);
  assert.equal(symbols.at(-1), "SYM60");
  assert.equal(symbols.length, 59);
});
