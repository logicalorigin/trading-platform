import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { extractSparklinePoints } from "../../components/platform/primitives.jsx";
import {
  buildStaSignalStatusSummary,
  hasStaCandidateAction,
  hasUsableSparklineData,
  resolveRowTickerSnapshot,
  splitStaRowsBySignalMatrixHydration,
} from "./OperationsSignalTable.jsx";

const source = readFileSync(new URL("./OperationsSignalTable.jsx", import.meta.url), "utf8");

test("STA table does not request Signal Matrix hydration", () => {
  assert.doesNotMatch(source, /onRequestSignalMatrixHydration/);
  assert.doesNotMatch(source, /buildAlgoSignalMatrixHydrationRequest/);
});

test("STA source-health banner only fires on a genuinely empty matrix", () => {
  // Event-loop stalls flip the cockpit + signal-options-state queries to isError
  // together, but the matrix is the real STA row source. The "STA action source is
  // currently unavailable" banner must stay gated on an empty matrix so a transient
  // metrics stall does not read as a hard data outage while rows are present.
  assert.match(
    source,
    /const sourceHealthBanner =\s*\(sourceHealth\.degraded \|\| sourceHealth\.stale\) && !staFilteredRows\.length/,
  );
});

test("STA candidate action counting tolerates null action payloads", () => {
  assert.equal(hasStaCandidateAction(null), false);
  assert.equal(hasStaCandidateAction({ action: null }), false);
  assert.equal(hasStaCandidateAction({ action: undefined }), false);
  assert.equal(hasStaCandidateAction({ action: {} }), false);
  assert.equal(hasStaCandidateAction({ action: { orderType: "market" } }), true);
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

test("STA row sparklines do not use DB-backed bars batch hydration", () => {
  assert.doesNotMatch(source, /\/api\/bars\/batch/);
  assert.doesNotMatch(source, /algo-signal-row-sparklines/);
  assert.doesNotMatch(source, /fetchStaSignalSparklineBarsBatch/);
});
