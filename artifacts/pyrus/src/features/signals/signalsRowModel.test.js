import assert from "node:assert/strict";
import test from "node:test";
import {
  SIGNALS_ROW_STATUS,
  buildSignalsRows,
  filterSignalsRows,
  resolveSignalMatrixVerdict,
  sortSignalsRows,
  summarizeSignalsRows,
} from "./signalsRowModel.js";

const state = (symbol, patch = {}) => ({
  id: `state-${symbol}-${patch.timeframe || "5m"}`,
  profileId: "profile-paper",
  symbol,
  timeframe: patch.timeframe || "5m",
  currentSignalDirection: patch.currentSignalDirection ?? null,
  currentSignalAt: patch.currentSignalAt ?? null,
  currentSignalPrice: patch.currentSignalPrice ?? null,
  latestBarAt: patch.latestBarAt ?? "2026-05-31T14:30:00.000Z",
  barsSinceSignal: patch.barsSinceSignal ?? null,
  fresh: patch.fresh ?? false,
  status: patch.status || "ok",
  active: patch.active ?? true,
  lastEvaluatedAt: patch.lastEvaluatedAt ?? "2026-05-31T14:31:00.000Z",
  lastError: patch.lastError ?? null,
  indicatorSnapshot: patch.indicatorSnapshot ?? null,
});

const event = (symbol, patch = {}) => ({
  id: `event-${symbol}-${patch.emittedAt || "now"}`,
  profileId: "profile-paper",
  environment: "paper",
  symbol,
  timeframe: patch.timeframe || "5m",
  direction: patch.direction || "buy",
  signalAt: patch.signalAt || "2026-05-31T14:00:00.000Z",
  signalPrice: patch.signalPrice ?? 101,
  close: patch.close ?? 101,
  emittedAt: patch.emittedAt || "2026-05-31T14:01:00.000Z",
  source: "signal-monitor",
  payload: {},
});

const response = (patch = {}) => ({
  profile: { timeframe: "5m" },
  states: [],
  universeSymbols: [],
  skippedSymbols: [],
  universe: {},
  evaluatedAt: "2026-05-31T14:32:00.000Z",
  truncated: false,
  ...patch,
});

test("signals rows preserve universe symbols without stored state", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["spy", "aapl", "msft"],
      skippedSymbols: ["msft"],
      states: [
        state("SPY", {
          currentSignalDirection: "buy",
          currentSignalAt: "2026-05-31T14:25:00.000Z",
          fresh: true,
          barsSinceSignal: 1,
        }),
      ],
    }),
  });

  assert.deepEqual(rows.map((row) => row.symbol), ["SPY", "MSFT", "AAPL"]);
  assert.equal(rows[0].status, SIGNALS_ROW_STATUS.activeFresh);
  assert.equal(rows[1].status, SIGNALS_ROW_STATUS.skipped);
  assert.equal(
    rows[1].coverageReason,
    "Primary monitor scan pending",
  );
  assert.equal(rows[2].status, SIGNALS_ROW_STATUS.pending);
});

test("signals rows preserve skipped symbols even when they are outside the universe list", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["SPY"],
      skippedSymbols: ["QQQ"],
    }),
  });

  assert.deepEqual(rows.map((row) => row.symbol), ["QQQ", "SPY"]);
  assert.equal(rows[0].status, SIGNALS_ROW_STATUS.skipped);
  assert.equal(rows[0].statusLabel, "Scan pending");
  assert.equal(rows[0].skipped, true);
  assert.equal(rows[0].coverageReason, "Primary monitor scan pending");
});

test("signals rows do not let scan queue metadata override stored state", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["SPY", "MSFT"],
      skippedSymbols: ["MSFT"],
      states: [
        state("MSFT", {
          currentSignalDirection: "sell",
          currentSignalAt: "2026-05-31T14:20:00.000Z",
          barsSinceSignal: 3,
          fresh: false,
        }),
      ],
    }),
  });

  assert.equal(rows[0].symbol, "MSFT");
  assert.equal(rows[0].status, SIGNALS_ROW_STATUS.activeStale);
  assert.equal(
    rows[0].coverageReason,
    "Stored primary state present; interval matrix hydrates from market bars",
  );
});

test("signals rows use market-data matrix state when primary scan state is queued", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["MSFT"],
      skippedSymbols: ["MSFT"],
      states: [],
    }),
    matrixStates: [
      state("MSFT", {
        timeframe: "1m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-05-31T14:28:00.000Z",
        fresh: true,
        barsSinceSignal: 0,
      }),
      state("MSFT", { timeframe: "2m" }),
      state("MSFT", { timeframe: "5m" }),
      state("MSFT", { timeframe: "15m" }),
      state("MSFT", { timeframe: "1h" }),
      state("MSFT", { timeframe: "1d" }),
    ],
  });

  assert.equal(rows[0].status, SIGNALS_ROW_STATUS.activeFresh);
  assert.equal(rows[0].statusLabel, "Fresh signal");
  assert.equal(rows[0].direction, "buy");
  assert.equal(rows[0].fresh, true);
  assert.equal(rows[0].skipped, true);
  assert.equal(
    rows[0].coverageReason,
    "Computed from market bars; primary monitor scan pending",
  );
});

test("signals rows do not promote stale matrix states into active signals", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["SPY"],
      states: [],
    }),
    matrixStates: [
      state("SPY", {
        timeframe: "1m",
        status: "stale",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-05-29T20:00:00.000Z",
        latestBarAt: "2026-05-29T20:01:00.000Z",
        lastEvaluatedAt: "2026-06-01T00:40:00.000Z",
      }),
      state("SPY", {
        timeframe: "2m",
        status: "stale",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-05-29T20:00:00.000Z",
        latestBarAt: "2026-05-29T20:00:00.000Z",
        lastEvaluatedAt: "2026-06-01T00:40:00.000Z",
      }),
    ],
  });

  assert.equal(rows[0].direction, null);
  assert.equal(rows[0].status, SIGNALS_ROW_STATUS.pending);
  assert.equal(rows[0].fresh, false);
  assert.deepEqual(rows[0].activeTimeframes, []);
  assert.deepEqual(rows[0].stackSummary, {
    direction: null,
    buyCount: 0,
    sellCount: 0,
    activeCount: 0,
    freshCount: 0,
    totalCount: 6,
    label: "0/6",
  });
  assert.equal(
    rows[0].coverageReason,
    "Waiting for current market bars",
  );
});

test("signals rows keep terminal matrix placeholders out of computed coverage", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["AMD"],
      states: [],
    }),
    matrixStates: ["1m", "2m", "5m", "15m", "1h", "1d"].map((timeframe) =>
      state("AMD", {
        timeframe,
        status: "error",
        latestBarAt: null,
        lastEvaluatedAt: "2026-06-01T15:00:00.000Z",
        lastError: "Signal monitor matrix bar load timed out.",
      }),
    ),
  });

  assert.equal(rows[0].direction, null);
  assert.equal(rows[0].status, SIGNALS_ROW_STATUS.problem);
  assert.equal(rows[0].matrixVerdict.regime, "no_data");
  assert.deepEqual(rows[0].matrixVerdict.reasonCodes, [
    "insufficient_matrix_data",
    "matrix_problem",
  ]);
  assert.equal(rows[0].stackSummary.label, "0/6");
  assert.equal(rows[0].coverageReason, "Signal computation unavailable");
});

test("signals rows use current primary state for the profile interval when matrix is stale", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["GLD"],
      states: [
        state("GLD", {
          timeframe: "5m",
          currentSignalDirection: "buy",
          currentSignalAt: "2026-06-02T00:55:00.000Z",
          latestBarAt: "2026-06-02T00:55:00.000Z",
          lastEvaluatedAt: "2026-06-02T01:03:00.000Z",
          fresh: true,
          barsSinceSignal: 0,
        }),
      ],
    }),
    matrixStates: [
      state("GLD", {
        timeframe: "5m",
        status: "stale",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-01T23:50:00.000Z",
        latestBarAt: "2026-06-01T23:55:00.000Z",
        lastEvaluatedAt: "2026-06-02T01:03:00.000Z",
        fresh: false,
      }),
    ],
  });

  assert.equal(rows[0].matrixStatesByTimeframe["5m"].status, "ok");
  assert.equal(rows[0].matrixStatesByTimeframe["5m"].currentSignalDirection, "buy");
  assert.deepEqual(rows[0].activeTimeframes, ["5m"]);
  assert.deepEqual(rows[0].freshTimeframes, ["5m"]);
  assert.equal(rows[0].stackSummary.label, "1/6");
});

test("signals rows keep a newer current matrix interval over primary fallback", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["GLD"],
      states: [
        state("GLD", {
          timeframe: "5m",
          currentSignalDirection: "buy",
          currentSignalAt: "2026-06-02T00:50:00.000Z",
          latestBarAt: "2026-06-02T00:50:00.000Z",
          lastEvaluatedAt: "2026-06-02T00:51:00.000Z",
          fresh: false,
        }),
      ],
    }),
    matrixStates: [
      state("GLD", {
        timeframe: "5m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-02T00:55:00.000Z",
        latestBarAt: "2026-06-02T00:55:00.000Z",
        lastEvaluatedAt: "2026-06-02T01:03:00.000Z",
        fresh: true,
      }),
    ],
  });

  assert.equal(rows[0].matrixStatesByTimeframe["5m"].currentSignalDirection, "sell");
  assert.deepEqual(rows[0].activeTimeframes, ["5m"]);
  assert.deepEqual(rows[0].freshTimeframes, ["5m"]);
});

test("signals rows merge matrix states by timeframe", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["NVDA"],
      states: [state("NVDA", { status: "ok" })],
    }),
    matrixStates: [
      state("NVDA", {
        timeframe: "2m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-05-31T14:20:00.000Z",
      }),
      state("NVDA", {
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-05-31T14:27:00.000Z",
        fresh: true,
      }),
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].matrixStatesByTimeframe["2m"].currentSignalDirection, "sell");
  assert.equal(rows[0].matrixStatesByTimeframe["5m"].currentSignalDirection, "buy");
  assert.deepEqual(rows[0].activeTimeframes, ["2m", "5m"]);
  assert.deepEqual(rows[0].freshTimeframes, ["5m"]);
});

test("signals rows attach watchlist labels from item and legacy symbol lists", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["SPY", "QQQ"],
    }),
    watchlists: [
      { id: "core", name: "Core", symbols: ["spy"] },
      { id: "growth", name: "Growth", items: [{ symbol: "QQQ" }] },
    ],
  });

  const bySymbol = Object.fromEntries(rows.map((row) => [row.symbol, row]));
  assert.deepEqual(bySymbol.SPY.watchlistLabels, ["Core"]);
  assert.deepEqual(bySymbol.QQQ.watchlistLabels, ["Growth"]);
});

test("signals rows summarize six interval stack and indicator dashboard", () => {
  const dashboard = {
    trendDirection: "bullish",
    trendAgeBars: 12,
    trendAgeBucket: "new",
    adx: 31.4,
    strength: "strong",
    volatilityScore: 7,
    mtf: [
      { timeframe: "1h", direction: "bullish", required: true, pass: true },
      { timeframe: "4h", direction: "bearish", required: false, pass: true },
      { timeframe: "D", direction: "bullish", required: false, pass: true },
    ],
    filterState: { adxPass: true },
  };
  const rows = buildSignalsRows({
    stateResponse: response({
      profile: { timeframe: "15m" },
      universeSymbols: ["SPY"],
    }),
    matrixStates: [
      state("SPY", { timeframe: "1m", currentSignalDirection: "buy", fresh: true }),
      state("SPY", { timeframe: "2m", currentSignalDirection: "buy", fresh: true }),
      state("SPY", { timeframe: "5m", currentSignalDirection: "sell" }),
      state("SPY", {
        timeframe: "15m",
        currentSignalDirection: "buy",
        indicatorSnapshot: dashboard,
      }),
      state("SPY", { timeframe: "1h" }),
      state("SPY", { timeframe: "1d", currentSignalDirection: "buy" }),
    ],
  });

  assert.deepEqual(rows[0].stackSummary, {
    direction: "buy",
    buyCount: 4,
    sellCount: 1,
    activeCount: 5,
    freshCount: 2,
    totalCount: 6,
    label: "4/6",
  });
  assert.equal(rows[0].dashboardSummary.timeframe, "15m");
  assert.equal(rows[0].dashboardSummary.signalDirection, "buy");
  assert.equal(rows[0].dashboardSummary.strength, "strong");
  assert.equal(rows[0].dashboardSummary.volatilityScore, 7);
  assert.equal(rows[0].dashboardSummary.mtf.length, 3);
});

test("signal matrix verdict confirms aligned higher-timeframe trend", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      profile: { timeframe: "5m" },
      universeSymbols: ["SPY"],
    }),
    matrixStates: ["1m", "2m", "5m", "15m", "1h", "1d"].map((timeframe, index) =>
      state("SPY", {
        timeframe,
        currentSignalDirection: "buy",
        currentSignalAt: `2026-05-31T14:2${index}:00.000Z`,
        barsSinceSignal: index,
        fresh: true,
      }),
    ),
  });

  const verdict = rows[0].matrixVerdict;
  assert.equal(verdict.direction, "buy");
  assert.equal(verdict.regime, "bull_trend");
  assert.equal(verdict.transition, "confirmed");
  assert.equal(verdict.tradeReadiness, "ready");
  assert.equal(verdict.riskPosture, "normal");
  assert.ok(verdict.alignmentScore >= 90);
  assert.ok(verdict.freshnessScore >= 90);
  assert.ok(verdict.readinessScore >= 75);
  assert.ok(verdict.reasonCodes.includes("matrix_confirmed"));
  assert.ok(verdict.reasonCodes.includes("higher_timeframe_aligned"));
});

test("signal matrix verdict detects pullback pressure against the higher-timeframe trend", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      profile: { timeframe: "5m" },
      universeSymbols: ["QQQ"],
    }),
    matrixStates: [
      state("QQQ", { timeframe: "1m", currentSignalDirection: "sell", fresh: true }),
      state("QQQ", { timeframe: "2m", currentSignalDirection: "sell", fresh: true }),
      state("QQQ", { timeframe: "5m", currentSignalDirection: "buy", fresh: true }),
      state("QQQ", { timeframe: "15m", currentSignalDirection: "buy", fresh: true }),
      state("QQQ", { timeframe: "1h", currentSignalDirection: "buy", fresh: true }),
      state("QQQ", { timeframe: "1d", currentSignalDirection: "buy", fresh: true }),
    ],
  });

  const verdict = rows[0].matrixVerdict;
  assert.equal(verdict.direction, "buy");
  assert.equal(verdict.regime, "pullback");
  assert.equal(verdict.transition, "fading");
  assert.equal(verdict.tradeReadiness, "wait");
  assert.equal(verdict.riskPosture, "tighten");
  assert.ok(verdict.reasonCodes.includes("lower_frame_pullback"));
});

test("signal matrix verdict detects lower-timeframe reversal attempts", () => {
  const matrixStatesByTimeframe = {
    "1m": state("IWM", { timeframe: "1m", currentSignalDirection: "sell", fresh: true }),
    "2m": state("IWM", { timeframe: "2m", currentSignalDirection: "sell", fresh: true }),
    "5m": state("IWM", { timeframe: "5m", currentSignalDirection: "sell", fresh: true }),
    "15m": state("IWM", { timeframe: "15m", currentSignalDirection: "buy", fresh: true }),
    "1h": state("IWM", { timeframe: "1h" }),
    "1d": state("IWM", { timeframe: "1d" }),
  };

  const verdict = resolveSignalMatrixVerdict({
    matrixStatesByTimeframe,
    profileTimeframe: "5m",
  });

  assert.equal(verdict.direction, "sell");
  assert.equal(verdict.regime, "reversal_attempt");
  assert.equal(verdict.transition, "building");
  assert.equal(verdict.tradeReadiness, "watch");
  assert.equal(verdict.riskPosture, "tighten");
  assert.ok(verdict.reasonCodes.includes("reversal_attempt"));
});

test("signal matrix verdict uses the primary profile state when matrix storage lacks that timeframe", () => {
  const primaryState = state("MSFT", {
    timeframe: "5m",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-01T21:25:00.000Z",
    latestBarAt: "2026-06-01T21:25:00.000Z",
    barsSinceSignal: 0,
    fresh: true,
  });
  const matrixStatesByTimeframe = Object.fromEntries(
    ["1m", "2m", "15m", "1h", "1d"].map((timeframe) => [
      timeframe,
      state("MSFT", {
        timeframe,
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-01T21:25:00.000Z",
        latestBarAt: "2026-06-01T21:25:00.000Z",
        barsSinceSignal: 0,
        fresh: true,
      }),
    ]),
  );

  const verdict = resolveSignalMatrixVerdict({
    primaryState,
    matrixStatesByTimeframe,
    profileTimeframe: "5m",
  });

  assert.equal(verdict.direction, "buy");
  assert.equal(verdict.alignmentScore, 100);
  assert.equal(verdict.tradeReadiness, "ready");
  assert.ok(verdict.reasonCodes.includes("execution_frame_aligned"));
});

test("signal matrix verdict avoids stale or insufficient matrix data", () => {
  const verdict = resolveSignalMatrixVerdict({
    matrixStatesByTimeframe: {
      "1m": state("DIA", {
        timeframe: "1m",
        currentSignalDirection: "buy",
        status: "stale",
        fresh: true,
      }),
      "5m": state("DIA", { timeframe: "5m" }),
    },
    profileTimeframe: "5m",
  });

  assert.equal(verdict.direction, null);
  assert.equal(verdict.regime, "no_data");
  assert.equal(verdict.transition, "pending");
  assert.equal(verdict.tradeReadiness, "avoid");
  assert.equal(verdict.riskPosture, "exit_watch");
  assert.ok(verdict.reasonCodes.includes("insufficient_matrix_data"));
});

test("signals rows sort timeframe columns by interval activity with missing states last", () => {
  const rows = [
    {
      symbol: "OLD",
      statusWeight: 0,
      matrixStatesByTimeframe: {
        "5m": state("OLD", {
          timeframe: "5m",
          latestBarAt: "2026-06-01T20:00:00.000Z",
          lastEvaluatedAt: "2026-06-01T20:01:00.000Z",
        }),
      },
    },
    {
      symbol: "MISS",
      statusWeight: 0,
      matrixStatesByTimeframe: {},
    },
    {
      symbol: "NEW",
      statusWeight: 0,
      matrixStatesByTimeframe: {
        "5m": state("NEW", {
          timeframe: "5m",
          latestBarAt: "2026-06-01T21:00:00.000Z",
          lastEvaluatedAt: "2026-06-01T21:01:00.000Z",
        }),
      },
    },
  ];

  assert.deepEqual(
    sortSignalsRows(rows, { sortKey: "tf-5m", direction: "asc" }).map(
      (row) => row.symbol,
    ),
    ["NEW", "OLD", "MISS"],
  );
  assert.deepEqual(
    sortSignalsRows(rows, { sortKey: "tf-5m", direction: "desc" }).map(
      (row) => row.symbol,
    ),
    ["OLD", "NEW", "MISS"],
  );
});

test("signals rows attach the latest event per symbol", () => {
  const rows = buildSignalsRows({
    stateResponse: response({ universeSymbols: ["PLTR"] }),
    events: [
      event("PLTR", { direction: "buy", emittedAt: "2026-05-31T14:10:00.000Z" }),
      event("PLTR", { direction: "sell", emittedAt: "2026-05-31T14:40:00.000Z" }),
    ],
  });

  assert.equal(rows[0].latestEvent.direction, "sell");
  assert.equal(rows[0].direction, null);
  assert.equal(rows[0].currentSignalPrice, null);
  assert.equal(rows[0].status, SIGNALS_ROW_STATUS.pending);
});

test("signals row summary and filters use normalized row metadata", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["SPY", "TSLA", "AMD", "QQQ"],
      skippedSymbols: ["QQQ"],
      states: [
        state("SPY", {
          currentSignalDirection: "buy",
          currentSignalAt: "2026-05-31T14:25:00.000Z",
          fresh: true,
          barsSinceSignal: 1,
        }),
        state("TSLA", {
          currentSignalDirection: "sell",
          currentSignalAt: "2026-05-31T13:30:00.000Z",
          barsSinceSignal: 8,
          fresh: false,
        }),
        state("AMD", {
          status: "error",
          lastError: "provider unavailable",
        }),
      ],
    }),
  });

  assert.deepEqual(rows.map((row) => row.symbol), ["SPY", "TSLA", "AMD", "QQQ"]);
  assert.deepEqual(summarizeSignalsRows(rows), {
    total: 4,
    fresh: 1,
    active: 2,
    buy: 1,
    sell: 1,
    problem: 1,
    skipped: 1,
    pending: 0,
  });
  assert.deepEqual(
    filterSignalsRows(rows, { status: SIGNALS_ROW_STATUS.skipped }).map((row) => row.symbol),
    ["QQQ"],
  );
  assert.deepEqual(
    filterSignalsRows(rows, { status: SIGNALS_ROW_STATUS.problem }).map((row) => row.symbol),
    ["AMD"],
  );
  assert.deepEqual(
    filterSignalsRows(rows, { query: "s", direction: "sell" }).map((row) => row.symbol),
    ["TSLA"],
  );
});
