import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { extractSparklinePoints } from "../../components/platform/primitives.jsx";
import {
  buildSignalIndicatorMetrics,
  staRowPassesMtfAlignment,
} from "./algoHelpers.js";
import {
  buildStaSignalStatusSummary,
  buildStaTableRowsSnapshot,
  hasStaCandidateAction,
  hasUsableSparklineData,
  resolveRowTickerSnapshot,
  sortRows,
  splitStaRowsBySignalMatrixHydration,
} from "./OperationsSignalTable.jsx";

const source = readFileSync(new URL("./OperationsSignalTable.jsx", import.meta.url), "utf8");

test("STA table does not request Signal Matrix hydration", () => {
  assert.doesNotMatch(source, /onRequestSignalMatrixHydration/);
  assert.doesNotMatch(source, /buildAlgoSignalMatrixHydrationRequest/);
});

test("STA Move sort uses the live ticker snapshot shown by each row", () => {
  const rows = [
    {
      signal: {
        symbol: "ESS",
        signalPrice: 100,
        currentPrice: 150,
        signalAt: "2026-06-18T13:00:00.000Z",
      },
    },
    {
      signal: {
        symbol: "FHI",
        signalPrice: 100,
        currentPrice: 101,
        signalAt: "2026-06-18T12:00:00.000Z",
      },
    },
    {
      signal: {
        symbol: "FCEL",
        signalPrice: 100,
        currentPrice: 102,
        signalAt: "2026-06-18T11:00:00.000Z",
      },
    },
  ];

  const sorted = sortRows(rows, "move", null, "desc", {
    tickerSnapshotsBySymbol: {
      ESS: { price: 99 },
      FHI: { price: 122.8 },
      FCEL: { price: 115.6 },
    },
  });

  assert.deepEqual(
    sorted.map((row) => row.signal.symbol),
    ["FHI", "FCEL", "ESS"],
  );
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

test("STA stale scan banner only fires on a genuinely empty matrix", () => {
  // A stale matrix age is useful in the compact status line, but it must not
  // become the primary warning while current matrix rows are present.
  assert.match(
    source,
    /const staleScanBanner =\s*freshness\.staleScan && !staFilteredRows\.length/,
  );
});

test("STA stale state keeps the compact Signal/Bar age while the primary banner is gated off", () => {
  // The stale-scan PRIMARY banner is suppressed once matrix rows are present
  // (it only fires on an empty matrix), but the compact Signal/Bar age line must
  // stay visible on a populated table. Guard that the compact-age source
  // (freshnessItems -> freshnessLine -> status summary) is built unconditionally
  // and is NOT gated by freshness.staleScan.
  assert.match(
    source,
    /const staleScanBanner =\s*freshness\.staleScan && !staFilteredRows\.length/,
  );

  // freshnessItems holds the compact Signal/Bar age and is declared before the
  // staleScanBanner, so this slice is exactly the compact-age source block.
  const freshnessItemsBlock = source.slice(
    source.indexOf("const freshnessItems = ["),
    source.indexOf("const staleScanBanner ="),
  );
  assert.ok(
    freshnessItemsBlock.length > 0,
    "expected a freshnessItems block before staleScanBanner",
  );
  assert.match(freshnessItemsBlock, /Signal \$\{formatRelativeTimeShort\(/);
  assert.match(freshnessItemsBlock, /Bar \$\{formatRelativeTimeShort\(/);
  assert.doesNotMatch(freshnessItemsBlock, /staleScan/);

  // freshnessLine is composed unconditionally and passed straight into the
  // status summary, so the compact age renders regardless of the banner gate.
  assert.match(
    source,
    /const freshnessLine = freshnessItems\.filter\(Boolean\)\.join\(/,
  );
  assert.match(
    source,
    /buildStaSignalStatusSummary\(\{[\s\S]*?freshnessLine,[\s\S]*?\}\)/,
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

test("STA table snapshot exports computed row signals for KPI consumers", () => {
  const snapshot = buildStaTableRowsSnapshot({
    rows: [
      {
        signal: {
          symbol: "AAPL",
          timeframe: "5m",
          direction: "buy",
          signalAt: "2026-06-22T14:30:00.000Z",
        },
        candidate: { id: "candidate-aapl" },
      },
      {
        signal: {
          symbol: "MSFT",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-22T14:35:00.000Z",
        },
        candidate: { id: "candidate-msft" },
      },
    ],
    receivedCount: 2,
    actionCount: 1,
    historyCount: 0,
    activeFilterLabel: "Ready",
  });

  assert.equal(snapshot.rowCount, 2);
  assert.deepEqual(
    snapshot.signalRows.map((row) => row.symbol),
    ["AAPL", "MSFT"],
  );
  assert.equal(snapshot.receivedCount, 2);
  assert.equal(snapshot.actionCount, 1);
  assert.equal(snapshot.historyCount, 0);
  assert.equal(snapshot.activeFilterLabel, "Ready");
  assert.match(snapshot.signature, /AAPL/);
  assert.match(snapshot.signature, /MSFT/);
  // KPI score-bucket consumers need each exported row to carry the same
  // scoreBreakdown the table renders with (tier drives the By-score buckets).
  for (const row of snapshot.signalRows) {
    assert.ok(row.scoreBreakdown, "snapshot row carries scoreBreakdown");
    assert.equal(typeof row.scoreBreakdown.tier, "string");
  }
});

test("KPI metrics are driven only by STA table-visible rows", () => {
  const finalStaRows = [
    {
      signal: {
        symbol: "AAPL",
        timeframe: "15m",
        direction: "buy",
        signalPrice: 100,
        currentPrice: 110,
      },
    },
    {
      signal: {
        symbol: "MSFT",
        timeframe: "15m",
        direction: "sell",
        signalPrice: 200,
        currentPrice: 180,
      },
    },
  ];
  const excludedPreFilterRow = {
    signal: {
      symbol: "TSLA",
      timeframe: "15m",
      direction: "buy",
      signalPrice: 100,
      currentPrice: 50,
    },
  };

  const snapshot = buildStaTableRowsSnapshot({ rows: finalStaRows });
  const metrics = buildSignalIndicatorMetrics(snapshot.signalRows);
  const pollutedMetrics = buildSignalIndicatorMetrics([
    ...snapshot.signalRows,
    excludedPreFilterRow.signal,
  ]);

  assert.equal(snapshot.rowCount, 2);
  assert.equal(metrics.signalCount, 2);
  assert.equal(metrics.winCount, 2);
  assert.equal(metrics.correctnessPercent, 100);
  assert.equal(pollutedMetrics.signalCount, 3);
  assert.notEqual(pollutedMetrics.correctnessPercent, metrics.correctnessPercent);
});

test("STA table snapshot signature changes when draft execution or MTF context changes", () => {
  const rows = [
    {
      signal: {
        symbol: "AAPL",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-22T14:30:00.000Z",
      },
    },
  ];
  const fiveMinuteSnapshot = buildStaTableRowsSnapshot({
    rows,
    contextSignature: JSON.stringify({
      signalTimeframes: ["2m", "5m"],
      executionTimeframe: "5m",
      mtf: { requiredCount: 2, timeframes: ["2m", "5m"] },
    }),
  });
  const fifteenMinuteSnapshot = buildStaTableRowsSnapshot({
    rows,
    contextSignature: JSON.stringify({
      signalTimeframes: ["2m", "5m", "15m"],
      executionTimeframe: "15m",
      mtf: { requiredCount: 3, timeframes: ["2m", "5m", "15m"] },
    }),
  });

  assert.notEqual(fiveMinuteSnapshot.signature, fifteenMinuteSnapshot.signature);
  assert.deepEqual(
    fiveMinuteSnapshot.signalRows.map((row) => row.symbol),
    fifteenMinuteSnapshot.signalRows.map((row) => row.symbol),
  );
});

test("STA table snapshot signature changes when KPI move inputs hydrate", () => {
  const baseRow = {
    signal: {
      symbol: "AAPL",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-22T14:30:00.000Z",
      currentSignalClose: 100,
      currentPrice: null,
      latestBarClose: null,
      currentSignalMfePercent: null,
      currentSignalMaePercent: null,
    },
  };
  const pendingSnapshot = buildStaTableRowsSnapshot({
    rows: [baseRow],
  });
  const hydratedSnapshot = buildStaTableRowsSnapshot({
    rows: [
      {
        signal: {
          ...baseRow.signal,
          currentPrice: 108,
          latestBarClose: 108,
          currentSignalMfePercent: 12,
          currentSignalMaePercent: -3,
        },
      },
    ],
  });

  assert.notEqual(pendingSnapshot.signature, hydratedSnapshot.signature);
  assert.equal(hydratedSnapshot.signalRows[0].currentPrice, 108);
  assert.equal(hydratedSnapshot.signalRows[0].currentSignalMfePercent, 12);
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

test("STA rows require a backing selected Signal Matrix cell", () => {
  const split = splitStaRowsBySignalMatrixHydration({
    rows: [
      {
        signal: {
          symbol: "HIST",
          timeframe: "5m",
          direction: "buy",
          signalAt: "2026-06-09T13:35:00.000Z",
        },
      },
    ],
    signalMatrixBySymbol: {},
    timeframes: ["5m"],
  });

  assert.deepEqual(split.hydratedRows, []);
  assert.equal(split.pendingRows.length, 1);
  assert.deepEqual(split.rows, []);
  assert.deepEqual(split.pendingRows[0].matrixHydration.blockingMissingTimeframes, [
    "5m",
  ]);
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

// A per-timeframe matrix cell as it lives in signalMatrixBySymbol[symbol].
// The MTF gate now reads the cell's current trend (mirroring the backend entry
// gate), so trendDirection defaults to mirror the cell's direction; pass a
// trendDirection override to model a crossover/trend divergence.
const cellTrend = (direction) =>
  direction === "buy" ? "bullish" : direction === "sell" ? "bearish" : null;

const matrixCell = (timeframe, direction, overrides = {}) => ({
  symbol: "MU",
  timeframe,
  status: "ok",
  active: true,
  fresh: true,
  currentSignalDirection: direction,
  trendDirection: cellTrend(direction),
  currentSignalAt: "2026-06-08T19:00:00.000Z",
  latestBarAt: "2026-06-08T19:10:00.000Z",
  ...overrides,
});

const buyRow = (symbol, timeframe = null) => ({
  signal: { symbol, direction: "buy", ...(timeframe ? { timeframe } : {}) },
});

test("STA MTF alignment filter hides divergent and unconfirmed rows when enabled", () => {
  const mtfAlignmentConfig = {
    enabled: true,
    timeframes: ["2m", "5m"],
    requiredCount: 2,
  };
  // 2m buy / 5m sell -> divergent -> excluded.
  const divergent = {
    MU: { "2m": matrixCell("2m", "buy"), "5m": matrixCell("5m", "sell") },
  };
  assert.equal(
    staRowPassesMtfAlignment(buyRow("MU"), divergent, mtfAlignmentConfig),
    false,
  );
  // 2m buy / 5m missing -> unconfirmed (neutral) -> matches 1 < 2 -> excluded.
  const missing = { MU: { "2m": matrixCell("2m", "buy") } };
  assert.equal(
    staRowPassesMtfAlignment(buyRow("MU"), missing, mtfAlignmentConfig),
    false,
  );
  // 2m buy / 5m buy -> fully aligned -> included.
  const aligned = {
    MU: { "2m": matrixCell("2m", "buy"), "5m": matrixCell("5m", "buy") },
  };
  assert.equal(
    staRowPassesMtfAlignment(buyRow("MU"), aligned, mtfAlignmentConfig),
    true,
  );
});

test("STA MTF alignment filter does not add execution frame to selected-frame checks", () => {
  const configuredWithoutExecutionFrame = {
    enabled: true,
    timeframes: ["2m", "5m"],
    requiredCount: 2,
  };
  const matrix = {
    MU: {
      "5m": matrixCell("5m", "buy"),
      "15m": matrixCell("15m", "buy"),
    },
  };

  assert.equal(
    staRowPassesMtfAlignment(
      buyRow("MU", "15m"),
      matrix,
      configuredWithoutExecutionFrame,
    ),
    false,
  );
});

test("STA MTF alignment filter rejects stale partial required counts", () => {
  const stalePartialConfig = {
    enabled: true,
    timeframes: ["2m", "5m", "15m"],
    requiredCount: 2,
  };
  const matrix = {
    MU: {
      "2m": matrixCell("2m", "buy"),
      "5m": matrixCell("5m", "buy"),
      "15m": matrixCell("15m", "sell"),
    },
  };

  assert.equal(
    staRowPassesMtfAlignment(buyRow("MU", "15m"), matrix, stalePartialConfig),
    false,
  );
});

test("STA MTF alignment counts an in-trend selected frame without a fresh crossover (mirrors backend entry gate)", () => {
  const config = {
    enabled: true,
    timeframes: ["1m", "2m", "5m", "15m"],
    requiredCount: 4,
  };
  // The 2m frame is in a bullish trend but has no fresh crossover
  // (currentSignalDirection null, currentSignalAt null). The gate reads the live
  // trendDirection — the same source the backend entry gate trades on
  // (getTrendDirectionsForSymbol) — so this frame counts as a buy match and all
  // four configured frames align.
  const matrix = {
    MU: {
      "1m": matrixCell("1m", "buy"),
      "2m": matrixCell("2m", null, {
        trendDirection: "bullish",
        currentSignalAt: null,
      }),
      "5m": matrixCell("5m", "buy"),
      "15m": matrixCell("15m", "buy"),
    },
  };

  assert.equal(
    staRowPassesMtfAlignment(buyRow("MU", "5m"), matrix, config),
    true,
  );
});

test("all-selected MTF keeps 2m and 5m execution rows on the same aligned symbol set", () => {
  const config = {
    enabled: true,
    timeframes: ["1m", "2m", "5m", "15m"],
    requiredCount: 4,
  };
  // MSFT's 2m frame is in a bullish trend with no fresh crossover. Because the
  // gate reads the live trendDirection (mirroring the backend entry gate), that
  // frame counts, so MSFT aligns on all four frames — and does so regardless of
  // which execution timeframe the row is on.
  const matrix = {
    AAPL: {
      "1m": matrixCell("1m", "buy"),
      "2m": matrixCell("2m", "buy"),
      "5m": matrixCell("5m", "buy"),
      "15m": matrixCell("15m", "buy"),
    },
    MSFT: {
      "1m": matrixCell("1m", "buy"),
      "2m": matrixCell("2m", null, {
        trendDirection: "bullish",
        currentSignalAt: null,
      }),
      "5m": matrixCell("5m", "buy"),
      "15m": matrixCell("15m", "buy"),
    },
  };
  const fiveMinuteRows = [buyRow("AAPL", "5m"), buyRow("MSFT", "5m")].filter(
    (row) => staRowPassesMtfAlignment(row, matrix, config),
  );
  const twoMinuteRows = [buyRow("AAPL", "2m"), buyRow("MSFT", "2m")].filter(
    (row) => staRowPassesMtfAlignment(row, matrix, config),
  );

  assert.deepEqual(
    fiveMinuteRows.map((row) => row.signal.symbol),
    ["AAPL", "MSFT"],
  );
  assert.deepEqual(
    twoMinuteRows.map((row) => row.signal.symbol),
    ["AAPL", "MSFT"],
  );
});

test("STA MTF alignment filter returns the configured aligned subset, not the universe cap", () => {
  const config = {
    enabled: true,
    timeframes: ["1m", "2m"],
    requiredCount: 2,
  };
  const alignedSymbols = new Set(["SYM001", "SYM042", "SYM499"]);
  const symbols = Array.from(
    { length: 500 },
    (_, index) => `SYM${String(index).padStart(3, "0")}`,
  );
  const rows = symbols.map((symbol) => buyRow(symbol, "1m"));
  const matrix = Object.fromEntries(
    symbols.map((symbol) => [
      symbol,
      {
        "1m": matrixCell("1m", "buy"),
        "2m": matrixCell(
          "2m",
          alignedSymbols.has(symbol) ? "buy" : "sell",
        ),
      },
    ]),
  );

  const filtered = rows.filter((row) =>
    staRowPassesMtfAlignment(row, matrix, config),
  );

  assert.equal(rows.length, 500);
  assert.equal(filtered.length, 3);
  assert.notEqual(filtered.length, 500);
  assert.deepEqual(
    filtered.map((row) => row.signal.symbol),
    ["SYM001", "SYM042", "SYM499"],
  );
});

test("STA MTF alignment filter includes all rows when the gate is disabled", () => {
  const disabled = { enabled: false, timeframes: ["2m", "5m"], requiredCount: 2 };
  const divergent = {
    MU: { "2m": matrixCell("2m", "buy"), "5m": matrixCell("5m", "sell") },
  };
  const missing = { MU: { "2m": matrixCell("2m", "buy") } };
  assert.equal(staRowPassesMtfAlignment(buyRow("MU"), divergent, disabled), true);
  assert.equal(staRowPassesMtfAlignment(buyRow("MU"), missing, disabled), true);
});
