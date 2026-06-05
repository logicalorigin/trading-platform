import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSignalMatrixPendingStates,
  buildSignalMatrixStoredStateBootstrapRequest,
  buildSignalMatrixRequestPlan,
  buildSignalMatrixSymbolSets,
  mergeSignalMatrixStates,
  resolveSignalMatrixStaVisiblePageExactCellLimit,
  resolveSignalMatrixStaVisiblePageRequestTaskLimit,
  resolveSignalMatrixActiveScreenRequestTaskLimit,
  resolveSignalMatrixActiveScreenRequestSymbolLimit,
  resolveSignalMatrixBusyQueueDelayMs,
  resolveSignalMatrixCatchupDelayMs,
  resolveSignalMatrixExactCellLimit,
  signalMatrixStatesEqual,
} from "./signalMatrixScheduler.js";

const MATRIX_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"];

const hydratedStates = (
  symbols,
  timeframes = MATRIX_TIMEFRAMES,
) =>
  symbols.flatMap((symbol) =>
    timeframes.map((timeframe) => ({
      symbol,
      timeframe,
      status: "ok",
      latestBarAt: "2026-05-27T14:30:00.000Z",
      lastEvaluatedAt: "2026-05-27T14:31:00.000Z",
    })),
  );

test("signal matrix symbol sets prioritize suggested signal rows before open-position spillover", () => {
  const sets = buildSignalMatrixSymbolSets({
    selectedSymbol: "SPY",
    visibleWatchlistSymbols: [
      "SPY",
      "NVDA",
      "DIA",
      "AAPL",
      "MSFT",
      "TSLA",
      "TQQQ",
      "SQQQ",
    ],
    openPositionSymbols: ["FCEL", "INDI", "FRMI", "XYZ"],
    signalMonitorSymbols: ["LMT", "CCJ", "ISRG", "NVDA", "CEG"],
    watchlistSymbols: [
      "SPY",
      "NVDA",
      "DIA",
      "AAPL",
      "MSFT",
      "TSLA",
      "TQQQ",
      "SQQQ",
    ],
    wideLimit: 12,
    narrowLimit: 12,
  });

  assert.deepEqual(sets.suggestedSignalSymbols, ["LMT", "CCJ", "ISRG", "CEG"]);
  assert.deepEqual(sets.prioritySymbols, [
    "SPY",
    "NVDA",
    "DIA",
    "AAPL",
    "MSFT",
    "TSLA",
    "TQQQ",
    "SQQQ",
    "LMT",
    "CCJ",
    "ISRG",
    "CEG",
  ]);
  assert.equal(sets.prioritySymbols.includes("FCEL"), false);
  assert.deepEqual(sets.universeSymbols.slice(0, 12), sets.prioritySymbols);
});

test("signal matrix symbol sets hydrate display-only signal rows as background universe", () => {
  const sets = buildSignalMatrixSymbolSets({
    selectedSymbol: "SPY",
    visibleWatchlistSymbols: ["SPY"],
    signalMonitorSymbols: ["NVDA"],
    signalMonitorUniverseSymbols: ["NVDA", "PLTR", "IONQ", "RKLB"],
    watchlistSymbols: ["SPY"],
    wideLimit: 8,
    narrowLimit: 3,
  });

  assert.deepEqual(sets.suggestedSignalSymbols, ["NVDA"]);
  assert.deepEqual(sets.prioritySymbols, ["SPY", "NVDA"]);
  assert.deepEqual(sets.universeSymbols, [
    "SPY",
    "NVDA",
    "PLTR",
    "IONQ",
    "RKLB",
  ]);
});

test("signal matrix symbol sets prioritize signal bubbles and active Signals table rows", () => {
  const sets = buildSignalMatrixSymbolSets({
    selectedSymbol: "SPY",
    visibleWatchlistSymbols: ["SPY"],
    signalsScreenSymbols: ["PLTR", "IONQ", "RKLB", "SOFI", "HOOD", "COIN"],
    signalsScreenPrioritySymbols: ["HOOD", "PLTR"],
    signalMonitorUniverseSymbols: [
      "PLTR",
      "IONQ",
      "RKLB",
      "SOFI",
      "HOOD",
      "COIN",
    ],
    watchlistSymbols: ["SPY"],
    wideLimit: 8,
    narrowLimit: 4,
  });

  assert.deepEqual(sets.prioritySymbols, ["HOOD", "PLTR", "SPY"]);
  assert.deepEqual(sets.universeSymbols, [
    "SPY",
    "PLTR",
    "IONQ",
    "RKLB",
    "SOFI",
    "HOOD",
    "COIN",
  ]);
});

test("signal matrix scheduler sends missing priority symbols first", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: [
      "SPY",
      "QQQ",
      "AAPL",
      "NVDA",
      "MSFT",
      "TSLA",
      "AMD",
      "META",
      "IWM",
      "DIA",
    ],
    prioritySymbols: ["NVDA", "SPY", "QQQ"],
    backgroundReady: true,
    cursor: 0,
  });

  assert.deepEqual(plan.prioritySymbols, ["NVDA", "SPY", "QQQ"]);
  assert.deepEqual(plan.requestSymbols.slice(0, 3), ["NVDA", "SPY", "QQQ"]);
  assert.deepEqual(plan.backgroundSymbols, ["AAPL", "MSFT"]);
  assert.deepEqual(plan.timeframes, MATRIX_TIMEFRAMES);
  assert.equal(plan.coverage.totalSymbols, 10);
  assert.equal(plan.coverage.requestSymbols, 5);
  assert.equal(plan.coverage.requestSymbolLimit, 5);
  assert.equal(plan.coverage.requestTaskLimit, 30);
  assert.equal(plan.coverage.requestTaskCount, 30);
  assert.equal(plan.coverage.requestedTaskCount, 60);
  assert.equal(plan.coverage.pendingSymbols, 5);
  assert.equal(plan.coverage.queuedTaskCount, 30);
  assert.equal(plan.coverage.missingTaskCount, 60);
  assert.equal(plan.coverage.pendingTaskCount, 30);
  assert.equal(plan.coverage.hydratedSymbols, 0);
  assert.equal(plan.coverage.missingSymbols, 10);
  assert.equal(plan.backgroundPaused, false);
});

test("signal matrix scheduler chunks full automatic coverage under watch pressure", () => {
  const symbols = [
    "SPY",
    "QQQ",
    "AAPL",
    "NVDA",
    "MSFT",
    "TSLA",
    "AMD",
    "META",
    "IWM",
    "DIA",
    "PLTR",
    "COIN",
    "HOOD",
    "RBLX",
    "RKLB",
    "SMCI",
    "VXX",
    "VIXY",
    "AVGO",
    "AMZN",
  ];
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols: symbols,
    pressureLevel: "watch",
    backgroundReady: true,
    pollMs: 60_000,
  });

  assert.deepEqual(plan.timeframes, MATRIX_TIMEFRAMES);
  assert.deepEqual(plan.prioritySymbols, symbols.slice(0, 5));
  assert.deepEqual(plan.requestSymbols, symbols.slice(0, 5));
  assert.equal(plan.coverage.requestSymbols, 5);
  assert.equal(plan.coverage.requestSymbolLimit, 5);
  assert.equal(plan.coverage.requestTaskLimit, 30);
  assert.equal(plan.coverage.requestTaskCount, 30);
  assert.equal(plan.coverage.requestedTaskCount, 120);
  assert.equal(plan.coverage.pendingSymbols, 15);
  assert.equal(plan.coverage.queuedTaskCount, 90);
  assert.equal(plan.coverage.pendingTaskCount, 90);
  assert.equal(plan.coverage.estimatedFullCycleMs, 240_000);
});

test("signal matrix scheduler hydrates complete row batches while chunking large coverage", () => {
  const symbols = Array.from(
    { length: 90 },
    (_value, index) => `SYM${index + 1}`,
  );
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols: symbols,
    backgroundReady: true,
    pollMs: 60_000,
  });

  assert.deepEqual(plan.timeframes, MATRIX_TIMEFRAMES);
  assert.deepEqual(plan.matrixTimeframes, MATRIX_TIMEFRAMES);
  assert.deepEqual(plan.requestSymbols, symbols.slice(0, 5));
  assert.equal(plan.coverage.timeframes, 6);
  assert.equal(plan.coverage.matrixTimeframes, 6);
  assert.equal(plan.coverage.requestTaskLimit, 30);
  assert.equal(plan.coverage.requestTaskCount, 30);
  assert.equal(plan.coverage.requestedTaskCount, 540);
  assert.equal(plan.coverage.pendingSymbols, 85);
  assert.equal(plan.coverage.queuedTaskCount, 510);
  assert.equal(plan.coverage.pendingTaskCount, 510);
  assert.equal(plan.coverage.hydratedSymbols, 0);
  assert.equal(plan.coverage.missingSymbols, 90);
});

test("signal matrix scheduler skips hydrated priority rows and fills missing background rows", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: [
      "SPY",
      "NVDA",
      "DIA",
      "AAPL",
      "MSFT",
      "TSLA",
      "TQQQ",
      "SQQQ",
      "PLTR",
      "COIN",
      "HOOD",
      "RBLX",
      "RKLB",
      "SMCI",
      "VXX",
      "VIXY",
      "AMD",
      "AVGO",
      "QQQ",
      "IWM",
    ],
    prioritySymbols: ["SPY", "NVDA", "DIA"],
    currentStates: hydratedStates(["SPY", "NVDA", "DIA"]),
    backgroundReady: true,
    cursor: 0,
    pollMs: 60_000,
  });

  assert.equal(plan.requestSymbols.length, 5);
  assert.deepEqual(plan.prioritySymbols, []);
  assert.deepEqual(plan.backgroundSymbols, [
    "AAPL",
    "MSFT",
    "TSLA",
    "TQQQ",
    "SQQQ",
  ]);
  assert.equal(plan.coverage.hydratedSymbols, 3);
  assert.equal(plan.coverage.missingSymbols, 17);
  assert.equal(plan.coverage.pendingSymbols, 12);
  assert.equal(plan.coverage.requestTaskCount, 30);
  assert.equal(plan.coverage.requestedTaskCount, 102);
  assert.equal(plan.coverage.queuedTaskCount, 72);
  assert.equal(plan.coverage.pendingTaskCount, 72);
  assert.equal(plan.coverage.estimatedFullCycleMs, 240_000);
  assert.equal(plan.backgroundPaused, false);
});

test("signal matrix scheduler rotates stale priority symbols instead of starving later bubbles", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY", "NVDA", "DIA", "AAPL", "MSFT", "TSLA"],
    prioritySymbols: ["SPY", "NVDA", "DIA", "AAPL", "MSFT", "TSLA"],
    currentStates: hydratedStates([
      "SPY",
      "NVDA",
      "DIA",
      "AAPL",
      "MSFT",
      "TSLA",
    ]).map((state) => ({
      ...state,
      latestBarAt: "2026-05-28T20:00:00.000Z",
      lastEvaluatedAt: "2026-05-28T20:00:00.000Z",
    })),
    backgroundReady: true,
    cursor: 3,
    pollMs: 60_000,
    nowMs: Date.parse("2026-05-28T20:05:00.000Z"),
  });

  assert.deepEqual(plan.prioritySymbols, [
    "AAPL",
    "MSFT",
    "TSLA",
    "SPY",
    "NVDA",
    "DIA",
  ]);
  assert.deepEqual(plan.requestSymbols, [
    "AAPL",
    "MSFT",
    "TSLA",
    "SPY",
    "NVDA",
    "DIA",
  ]);
  assert.deepEqual(plan.timeframes, ["1m", "2m"]);
  assert.deepEqual(
    plan.requestCells.map((cell) => `${cell.symbol}:${cell.timeframe}`),
    [
      "AAPL:1m",
      "AAPL:2m",
      "MSFT:1m",
      "MSFT:2m",
      "TSLA:1m",
      "TSLA:2m",
      "SPY:1m",
      "SPY:2m",
      "NVDA:1m",
      "NVDA:2m",
      "DIA:1m",
      "DIA:2m",
    ],
  );
  assert.equal(plan.nextCursor, 3);
});

test("signal matrix scheduler uses recent evaluation time to avoid requeueing hydrated after-hours rows", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY", "NVDA", "DIA", "AAPL"],
    prioritySymbols: ["SPY", "NVDA", "DIA", "AAPL"],
    currentStates: [
      ...hydratedStates(["SPY", "NVDA", "DIA"]).map((state) => ({
        ...state,
        latestBarAt: "2026-05-28T20:00:00.000Z",
        lastEvaluatedAt: "2026-05-28T20:04:30.000Z",
      })),
    ],
    backgroundReady: true,
    cursor: 0,
    pollMs: 60_000,
    nowMs: Date.parse("2026-05-28T20:05:00.000Z"),
  });

  assert.deepEqual(plan.prioritySymbols, ["AAPL"]);
  assert.deepEqual(plan.requestSymbols, ["AAPL"]);
  assert.equal(plan.coverage.hydratedSymbols, 3);
  assert.equal(plan.coverage.missingSymbols, 1);
});

test("signal matrix scheduler treats recently evaluated stale after-hours cells as hydrated", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY", "AAPL"],
    prioritySymbols: ["SPY", "AAPL"],
    currentStates: [
      ...hydratedStates(["SPY"]).map((state) => ({
        ...state,
        status: "stale",
        latestBarAt: "2026-05-28T20:00:00.000Z",
        lastEvaluatedAt: "2026-05-28T20:04:30.000Z",
      })),
    ],
    backgroundReady: true,
    cursor: 0,
    pollMs: 60_000,
    nowMs: Date.parse("2026-05-28T20:05:00.000Z"),
  });

  assert.deepEqual(plan.prioritySymbols, ["AAPL"]);
  assert.deepEqual(plan.requestSymbols, ["AAPL"]);
  assert.equal(plan.coverage.hydratedSymbols, 1);
  assert.equal(plan.coverage.missingSymbols, 1);
});

test("signal matrix scheduler refreshes hydrated intraday cells right after candle close", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY"],
    prioritySymbols: ["SPY"],
    currentStates: [
      {
        symbol: "SPY",
        timeframe: "1m",
        status: "ok",
        latestBarAt: "2026-06-03T14:30:00.000Z",
        lastEvaluatedAt: "2026-06-03T14:30:05.000Z",
      },
    ],
    timeframes: ["1m"],
    backgroundReady: true,
    pollMs: 15_000,
    nowMs: Date.parse("2026-06-03T14:31:06.000Z"),
  });

  assert.deepEqual(plan.requestSymbols, ["SPY"]);
  assert.deepEqual(plan.timeframes, ["1m"]);
  assert.deepEqual(plan.requestCells, [{ symbol: "SPY", timeframe: "1m" }]);
  assert.equal(plan.coverage.missingSymbols, 1);
});

test("signal matrix scheduler does not requeue before the next candle-close grace window", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY"],
    prioritySymbols: ["SPY"],
    currentStates: [
      {
        symbol: "SPY",
        timeframe: "1m",
        status: "ok",
        latestBarAt: "2026-06-03T14:30:00.000Z",
        lastEvaluatedAt: "2026-06-03T14:30:05.000Z",
      },
    ],
    timeframes: ["1m"],
    backgroundReady: true,
    pollMs: 15_000,
    nowMs: Date.parse("2026-06-03T14:31:03.000Z"),
  });

  assert.deepEqual(plan.requestSymbols, []);
  assert.equal(plan.coverage.hydratedSymbols, 1);
  assert.equal(plan.coverage.missingSymbols, 0);
});

test("signal matrix scheduler refreshes five-minute cells at the five-minute close", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["UUUU"],
    prioritySymbols: ["UUUU"],
    currentStates: [
      {
        symbol: "UUUU",
        timeframe: "5m",
        status: "ok",
        latestBarAt: "2026-06-03T14:30:00.000Z",
        lastEvaluatedAt: "2026-06-03T14:30:05.000Z",
      },
    ],
    timeframes: ["5m"],
    backgroundReady: true,
    pollMs: 15_000,
    nowMs: Date.parse("2026-06-03T14:35:06.000Z"),
  });

  assert.deepEqual(plan.requestSymbols, ["UUUU"]);
  assert.deepEqual(plan.timeframes, ["5m"]);
  assert.deepEqual(plan.requestCells, [{ symbol: "UUUU", timeframe: "5m" }]);
});

test("signal matrix scheduler treats recently unavailable cells as settled", () => {
  const terminalStates = MATRIX_TIMEFRAMES.map((timeframe) => ({
    symbol: "AMD",
    timeframe,
    status: "unavailable",
    latestBarAt: null,
    lastEvaluatedAt: "2026-05-28T20:05:00.000Z",
    lastError: "No broker history bars were available for this symbol.",
  }));
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["AMD"],
    prioritySymbols: ["AMD"],
    currentStates: terminalStates,
    backgroundReady: true,
    pollMs: 60_000,
    nowMs: Date.parse("2026-05-28T20:05:30.000Z"),
  });

  assert.deepEqual(plan.requestSymbols, []);
  assert.equal(plan.coverage.hydratedSymbols, 1);
  assert.equal(plan.coverage.missingSymbols, 0);
});

test("signal matrix scheduler retries old terminal unavailable cells", () => {
  const terminalStates = MATRIX_TIMEFRAMES.map((timeframe) => ({
    symbol: "AMD",
    timeframe,
    status: "unavailable",
    latestBarAt: null,
    lastEvaluatedAt: "2026-05-28T20:05:00.000Z",
    lastError: "No broker history bars were available for this symbol.",
  }));
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["AMD"],
    prioritySymbols: ["AMD"],
    currentStates: terminalStates,
    backgroundReady: true,
    pollMs: 60_000,
    nowMs: Date.parse("2026-05-28T20:12:00.000Z"),
  });

  assert.deepEqual(plan.requestSymbols, ["AMD"]);
  assert.equal(plan.coverage.hydratedSymbols, 0);
  assert.equal(plan.coverage.missingSymbols, 1);
});

test("signal matrix scheduler rehydrates stale Massive-backed signal bubbles", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY", "NVDA", "DIA", "AAPL"],
    prioritySymbols: ["NVDA", "SPY"],
    currentStates: [
      ...hydratedStates(["SPY"]).map((state) => ({
        ...state,
        latestBarAt: "2026-05-28T20:10:00.000Z",
      })),
      ...hydratedStates(["NVDA"]).map((state) => ({
        ...state,
        latestBarAt:
          state.timeframe === "2m"
            ? "2026-05-28T20:08:00.000Z"
            : "2026-05-28T20:15:00.000Z",
      })),
      ...hydratedStates(["DIA"]).map((state) => ({
        ...state,
        latestBarAt: "2026-05-28T20:15:00.000Z",
      })),
    ],
    backgroundReady: true,
    cursor: 0,
    pollMs: 60_000,
    nowMs: Date.parse("2026-05-28T20:15:00.000Z"),
  });

  assert.deepEqual(plan.prioritySymbols, ["NVDA", "SPY"]);
  assert.ok(plan.requestSymbols.includes("NVDA"));
  assert.ok(plan.timeframes.includes("2m"));
  assert.equal(plan.coverage.missingSymbols, 3);
});

test("signal matrix scheduler narrows visible priority rotation while pausing background under critical pressure", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: [
      "SPY",
      "QQQ",
      "AAPL",
      "NVDA",
      "MSFT",
      "TSLA",
      "AMD",
      "META",
      "PLTR",
      "COIN",
    ],
    prioritySymbols: ["SPY", "QQQ", "AAPL", "NVDA", "MSFT"],
    pressureLevel: "critical",
    backgroundReady: true,
  });

  assert.deepEqual(plan.prioritySymbols, ["SPY", "QQQ"]);
  assert.deepEqual(plan.backgroundSymbols, []);
  assert.deepEqual(plan.requestSymbols, ["SPY", "QQQ"]);
  assert.deepEqual(plan.timeframes, MATRIX_TIMEFRAMES);
  assert.equal(plan.backgroundPaused, true);
  assert.equal(plan.coverage.requestTaskLimit, 12);
  assert.equal(plan.coverage.requestTaskCount, 12);
  assert.equal(plan.coverage.pendingSymbols, 8);
  assert.equal(plan.coverage.pendingTaskCount, 48);
});

test("signal matrix scheduler keeps background hydration under high pressure", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY", "QQQ", "AAPL", "NVDA", "MSFT"],
    prioritySymbols: ["SPY", "QQQ"],
    currentStates: hydratedStates(["SPY", "QQQ"]),
    pressureLevel: "high",
    backgroundReady: true,
    cursor: 0,
  });

  assert.deepEqual(plan.prioritySymbols, []);
  assert.deepEqual(plan.backgroundSymbols, ["AAPL", "NVDA", "MSFT"]);
  assert.deepEqual(plan.requestSymbols, ["AAPL", "NVDA", "MSFT"]);
  assert.equal(plan.backgroundReady, true);
  assert.equal(plan.backgroundPaused, false);
  assert.equal(plan.coverage.missingSymbols, 3);
});

test("signal matrix scheduler holds all startup work while protection is active", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY", "QQQ", "AAPL"],
    prioritySymbols: ["QQQ", "SPY"],
    backgroundReady: true,
    startupProtectionActive: true,
    pollMs: 60_000,
  });

  assert.deepEqual(plan.requestSymbols, []);
  assert.deepEqual(plan.prioritySymbols, []);
  assert.deepEqual(plan.backgroundSymbols, []);
  assert.equal(plan.backgroundReady, false);
  assert.equal(plan.backgroundPaused, true);
  assert.equal(plan.startupProtectionActive, true);
  assert.equal(plan.coverage.startupProtectionActive, true);
  assert.equal(plan.coverage.missingSymbols, 3);
  assert.equal(plan.coverage.estimatedFullCycleMs, null);
});

test("signal matrix scheduler still hydrates priority symbols before background readiness", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY", "QQQ", "AAPL"],
    prioritySymbols: ["QQQ"],
    backgroundReady: false,
  });

  assert.deepEqual(plan.requestSymbols, ["QQQ"]);
  assert.deepEqual(plan.prioritySymbols, ["QQQ"]);
  assert.equal(plan.backgroundSymbols.length, 0);
  assert.equal(plan.backgroundPaused, true);
});

test("signal matrix scheduler treats active Signals table rows as foreground hydration", () => {
  const symbols = [
    "PLTR",
    "MSFT",
    "NVDA",
    "IONQ",
    "TSLA",
    "META",
    "AMZN",
    "GOOGL",
    "AMD",
    "AVGO",
    "QQQ",
    "SPY",
    "SMH",
    "AAPL",
    "SOFI",
    "HOOD",
    "COIN",
    "RKLB",
  ];
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols: symbols,
    backgroundReady: false,
    cursor: 0,
    pollMs: 60_000,
    requestTaskLimit:
      resolveSignalMatrixActiveScreenRequestTaskLimit("normal"),
  });

  assert.deepEqual(plan.prioritySymbols, symbols.slice(0, 8));
  assert.deepEqual(plan.requestSymbols, symbols.slice(0, 8));
  assert.deepEqual(plan.timeframes, MATRIX_TIMEFRAMES);
  assert.deepEqual(plan.backgroundSymbols, []);
  assert.equal(plan.backgroundPaused, true);
  assert.equal(plan.coverage.missingSymbols, symbols.length);
  assert.equal(plan.coverage.requestSymbolLimit, 8);
  assert.equal(plan.coverage.requestTaskLimit, 48);
  assert.equal(plan.coverage.requestTaskCount, 48);
  assert.equal(plan.coverage.requestedTaskCount, 108);
  assert.equal(plan.coverage.pendingSymbols, 10);
  assert.equal(plan.coverage.queuedTaskCount, 60);
  assert.equal(plan.coverage.pendingTaskCount, 60);
  assert.equal(plan.coverage.estimatedFullCycleMs, 180_000);
});

test("signal matrix stored-state bootstrap requests full universe when browser cache is partial", () => {
  const symbols = Array.from(
    { length: 500 },
    (_value, index) => `BOOT${index + 1}`,
  );
  const partialStates = hydratedStates(symbols.slice(0, 125));
  const request = buildSignalMatrixStoredStateBootstrapRequest({
    symbols,
    currentStates: partialStates,
    timeframes: MATRIX_TIMEFRAMES,
  });

  assert.ok(request);
  assert.equal(request.key, `${symbols.join(",")}|${MATRIX_TIMEFRAMES.join(",")}`);
  assert.deepEqual(request.symbols, symbols);
  assert.deepEqual(request.timeframes, MATRIX_TIMEFRAMES);
  assert.equal(request.coverage.totalSymbols, 500);
  assert.equal(request.coverage.requestSymbols, 500);
  assert.equal(request.coverage.totalTaskCount, 3000);
  assert.equal(request.coverage.hydratedTaskCount, 750);
  assert.equal(request.coverage.missingTaskCount, 2250);
  assert.equal(request.coverage.storedStateBootstrap, true);
});

test("signal matrix stored-state bootstrap is skipped after full cache or same bootstrap key", () => {
  const symbols = ["SPY", "QQQ"];
  const fullStates = hydratedStates(symbols);
  const completeRequest = buildSignalMatrixStoredStateBootstrapRequest({
    symbols,
    currentStates: fullStates,
    timeframes: MATRIX_TIMEFRAMES,
  });
  assert.equal(completeRequest, null);

  const key = `${symbols.join(",")}|${MATRIX_TIMEFRAMES.join(",")}`;
  const repeatedRequest = buildSignalMatrixStoredStateBootstrapRequest({
    symbols,
    currentStates: [],
    timeframes: MATRIX_TIMEFRAMES,
    lastBootstrapKey: key,
  });
  assert.equal(repeatedRequest, null);
});

test("signal matrix pending states fill requested holes without counting as hydrated", () => {
  const evaluatedAt = "2026-05-27T14:32:00.000Z";
  const pendingStates = buildSignalMatrixPendingStates({
    requestCells: [
      { symbol: "spy", timeframe: "1m" },
      { symbol: "SPY", timeframe: "5m" },
      { symbol: "qqq", timeframe: "1m" },
      { symbol: "SPY", timeframe: "1m" },
    ],
    currentStates: hydratedStates(["SPY"], ["5m"]),
    evaluatedAt,
  });

  assert.deepEqual(
    pendingStates.map((state) => `${state.symbol}:${state.timeframe}`),
    ["SPY:1m", "QQQ:1m"],
  );
  assert.equal(pendingStates[0].status, "pending");
  assert.equal(pendingStates[0].lastEvaluatedAt, evaluatedAt);

  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY", "QQQ"],
    prioritySymbols: ["SPY", "QQQ"],
    currentStates: pendingStates,
    timeframes: ["1m"],
    backgroundReady: false,
    nowMs: Date.parse("2026-05-27T14:32:01.000Z"),
    pollMs: 60_000,
  });

  assert.deepEqual(plan.requestCells, [
    { symbol: "SPY", timeframe: "1m" },
    { symbol: "QQQ", timeframe: "1m" },
  ]);
  assert.equal(plan.coverage.hydratedTaskCount, 0);
  assert.equal(plan.coverage.missingTaskCount, 2);
});

test("signal matrix scheduler caps explicit Signals screen chunks when background is ready", () => {
  const symbols = Array.from(
    { length: 90 },
    (_value, index) => `SIG${index + 1}`,
  );
  const prioritySymbols = symbols.slice(0, 12);
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols,
    backgroundReady: true,
    cursor: 0,
    pollMs: 60_000,
    requestSymbolLimit: prioritySymbols.length,
    requestTaskLimit:
      resolveSignalMatrixActiveScreenRequestTaskLimit("normal"),
  });

  assert.deepEqual(plan.prioritySymbols, prioritySymbols.slice(0, 8));
  assert.deepEqual(plan.requestSymbols, prioritySymbols.slice(0, 8));
  assert.deepEqual(plan.timeframes, MATRIX_TIMEFRAMES);
  assert.deepEqual(plan.backgroundSymbols, []);
  assert.equal(plan.backgroundPaused, true);
  assert.equal(plan.coverage.requestSymbolLimit, 8);
  assert.equal(plan.coverage.requestTaskLimit, 48);
  assert.equal(plan.coverage.requestTaskCount, 48);
  assert.equal(plan.coverage.requestedTaskCount, 540);
  assert.equal(plan.coverage.pendingSymbols, 82);
  assert.equal(plan.coverage.queuedTaskCount, 492);
  assert.equal(plan.coverage.pendingTaskCount, 492);
  assert.equal(plan.coverage.missingSymbols, symbols.length);
});

test("signal matrix active screen symbol limit stays wide under API pressure", () => {
  assert.equal(
    resolveSignalMatrixActiveScreenRequestSymbolLimit("normal"),
    500,
  );
  assert.equal(resolveSignalMatrixActiveScreenRequestSymbolLimit("watch"), 500);
  assert.equal(resolveSignalMatrixActiveScreenRequestSymbolLimit("high"), 500);
  assert.equal(
    resolveSignalMatrixActiveScreenRequestSymbolLimit("critical"),
    500,
  );
  assert.equal(resolveSignalMatrixActiveScreenRequestSymbolLimit("bogus"), 500);
});

test("signal matrix active screen task limits cover STA page hydration under normal pressure", () => {
  const symbols = Array.from(
    { length: 30 },
    (_value, index) => `STA${index + 1}`,
  );
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols: symbols,
    backgroundReady: false,
    cursor: 0,
    pollMs: 60_000,
    requestTaskLimit:
      resolveSignalMatrixActiveScreenRequestTaskLimit("normal"),
  });

  assert.deepEqual(plan.requestSymbols, symbols.slice(0, 8));
  assert.deepEqual(plan.timeframes, MATRIX_TIMEFRAMES);
  assert.equal(plan.coverage.requestSymbolLimit, 8);
  assert.equal(plan.coverage.requestTaskLimit, 48);
  assert.equal(plan.coverage.requestTaskCount, 48);
  assert.equal(plan.coverage.requestedTaskCount, 180);
  assert.equal(plan.coverage.pendingSymbols, 22);
  assert.equal(plan.coverage.queuedTaskCount, 132);
  assert.equal(plan.coverage.pendingTaskCount, 132);
});

test("signal matrix active screen task limits narrow under critical pressure", () => {
  const symbols = ["SPY", "QQQ", "IWM", "DIA", "NVDA", "TSLA", "AAPL", "MSFT"];
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols: symbols,
    backgroundReady: false,
    cursor: 0,
    pollMs: 60_000,
    pressureLevel: "critical",
    requestTaskLimit:
      resolveSignalMatrixActiveScreenRequestTaskLimit("critical"),
  });

  assert.deepEqual(plan.requestSymbols, ["SPY", "QQQ"]);
  assert.deepEqual(plan.timeframes, MATRIX_TIMEFRAMES);
  assert.equal(plan.coverage.requestSymbolLimit, 2);
  assert.equal(plan.coverage.requestTaskLimit, 12);
  assert.equal(plan.coverage.requestTaskCount, 12);
  assert.equal(plan.coverage.pendingSymbols, 6);
  assert.equal(plan.coverage.pendingTaskCount, 36);
});

test("signal matrix scheduler bounds STA visible page hydration under high pressure", () => {
  const symbols = Array.from({ length: 20 }, (_value, index) => `STA${index + 1}`);
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols: symbols,
    backgroundReady: false,
    cursor: 0,
    pollMs: 60_000,
    pressureLevel: "high",
    requestExactCellLimit: resolveSignalMatrixStaVisiblePageExactCellLimit("high"),
    requestTaskLimit: resolveSignalMatrixStaVisiblePageRequestTaskLimit("high"),
  });

  assert.deepEqual(plan.requestSymbols, symbols.slice(0, 4));
  assert.deepEqual(plan.timeframes, MATRIX_TIMEFRAMES);
  assert.equal(plan.coverage.exactCellLimit, 24);
  assert.equal(plan.coverage.requestSymbolLimit, 4);
  assert.equal(plan.coverage.requestTaskLimit, 24);
  assert.equal(plan.coverage.requestTaskCount, 24);
  assert.equal(plan.coverage.pendingSymbols, 16);
  assert.equal(plan.coverage.pendingTaskCount, 96);
  assert.equal(plan.coverage.estimatedFullCycleMs, 300_000);
});

test("signal matrix catchup and busy queue delays back off under pressure", () => {
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("normal"), 48);
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("watch"), 36);
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("high"), 24);
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("critical"), 12);
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("bogus"), 48);
  assert.equal(resolveSignalMatrixStaVisiblePageRequestTaskLimit("normal"), 48);
  assert.equal(resolveSignalMatrixStaVisiblePageRequestTaskLimit("watch"), 36);
  assert.equal(resolveSignalMatrixStaVisiblePageRequestTaskLimit("high"), 24);
  assert.equal(resolveSignalMatrixStaVisiblePageRequestTaskLimit("critical"), 12);
  assert.equal(resolveSignalMatrixStaVisiblePageExactCellLimit("normal"), 48);
  assert.equal(resolveSignalMatrixStaVisiblePageExactCellLimit("watch"), 36);
  assert.equal(resolveSignalMatrixStaVisiblePageExactCellLimit("high"), 24);
  assert.equal(resolveSignalMatrixStaVisiblePageExactCellLimit("critical"), 12);

  assert.equal(resolveSignalMatrixBusyQueueDelayMs("normal"), 0);
  assert.equal(resolveSignalMatrixBusyQueueDelayMs("watch"), 2_500);
  assert.equal(resolveSignalMatrixBusyQueueDelayMs("high"), 15_000);
  assert.equal(resolveSignalMatrixBusyQueueDelayMs("critical"), 60_000);

  assert.equal(resolveSignalMatrixCatchupDelayMs("normal"), 1_500);
  assert.equal(resolveSignalMatrixCatchupDelayMs("watch"), 5_000);
  assert.equal(resolveSignalMatrixCatchupDelayMs("high"), 15_000);
  assert.equal(resolveSignalMatrixCatchupDelayMs("critical"), null);
});

test("signal matrix request plans stay inside API exact-cell pressure caps", () => {
  const symbols = Array.from(
    { length: 40 },
    (_value, index) => `CAP${index + 1}`,
  );
  const cases = [
    ["normal", 48],
    ["watch", 36],
    ["high", 24],
    ["critical", 12],
  ];

  cases.forEach(([pressureLevel, exactCellLimit]) => {
    const plan = buildSignalMatrixRequestPlan({
      symbols,
      prioritySymbols: symbols,
      backgroundReady: false,
      pressureLevel,
      requestTaskLimit: 999,
    });

    assert.equal(resolveSignalMatrixExactCellLimit(pressureLevel), exactCellLimit);
    assert.equal(plan.coverage.exactCellLimit, exactCellLimit);
    assert.equal(plan.coverage.requestTaskLimit, exactCellLimit);
    assert.equal(plan.coverage.requestTaskCount, exactCellLimit);
    assert.equal(plan.requestCells.length <= exactCellLimit, true);
  });
  assert.equal(resolveSignalMatrixExactCellLimit("bogus"), 48);
});

test("signal matrix request plan narrows critical active pressure before API admission", () => {
  const symbols = ["SPY", "QQQ", "IWM", "DIA", "NVDA", "TSLA", "AAPL", "MSFT"];
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols: symbols,
    backgroundReady: false,
    cursor: 0,
    pollMs: 60_000,
    pressureLevel: "critical",
    requestSymbolLimit:
      resolveSignalMatrixActiveScreenRequestSymbolLimit("critical"),
    requestTaskLimit:
      resolveSignalMatrixActiveScreenRequestTaskLimit("critical"),
  });

  assert.deepEqual(plan.requestSymbols, ["SPY", "QQQ"]);
  assert.deepEqual(plan.timeframes, MATRIX_TIMEFRAMES);
  assert.equal(plan.coverage.requestSymbolLimit, 2);
  assert.equal(plan.coverage.requestTaskLimit, 12);
  assert.equal(plan.coverage.requestTaskCount, 12);
  assert.equal(plan.coverage.requestedTaskCount, 48);
  assert.equal(plan.coverage.pendingSymbols, 6);
  assert.equal(plan.coverage.queuedTaskCount, 36);
  assert.equal(plan.coverage.pendingTaskCount, 36);
  assert.equal(plan.coverage.estimatedFullCycleMs, 240_000);
});

test("signal matrix merge updates touched states without dropping untouched symbols", () => {
  const currentStates = [
    {
      symbol: "SPY",
      timeframe: "5m",
      currentSignalDirection: "buy",
      lastEvaluatedAt: "2026-05-21T14:00:00.000Z",
    },
    {
      symbol: "QQQ",
      timeframe: "5m",
      currentSignalDirection: "sell",
      lastEvaluatedAt: "2026-05-21T14:00:00.000Z",
    },
  ];
  const incomingStates = [
    {
      symbol: "SPY",
      timeframe: "5m",
      currentSignalDirection: "sell",
      lastEvaluatedAt: "2026-05-21T14:30:00.000Z",
    },
  ];

  const merged = mergeSignalMatrixStates({
    currentStates,
    incomingStates,
    knownSymbols: ["SPY", "QQQ"],
  });

  assert.equal(merged.length, 2);
  assert.equal(
    merged.find((state) => state.symbol === "SPY").currentSignalDirection,
    "sell",
  );
  assert.equal(
    merged.find((state) => state.symbol === "QQQ").currentSignalDirection,
    "sell",
  );
});

test("signal matrix merge keeps other timeframes when one timeframe refreshes", () => {
  const currentStates = [
    {
      symbol: "SPY",
      timeframe: "2m",
      currentSignalDirection: "buy",
      lastEvaluatedAt: "2026-05-21T14:00:00.000Z",
    },
    {
      symbol: "SPY",
      timeframe: "5m",
      currentSignalDirection: "sell",
      lastEvaluatedAt: "2026-05-21T14:00:00.000Z",
    },
    {
      symbol: "SPY",
      timeframe: "15m",
      currentSignalDirection: "buy",
      lastEvaluatedAt: "2026-05-21T14:00:00.000Z",
    },
  ];
  const incomingStates = [
    {
      symbol: "SPY",
      timeframe: "5m",
      currentSignalDirection: "buy",
      lastEvaluatedAt: "2026-05-21T14:30:00.000Z",
    },
  ];

  const merged = mergeSignalMatrixStates({
    currentStates,
    incomingStates,
    knownSymbols: ["SPY"],
  });

  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((state) => state.timeframe).sort(), [
    "15m",
    "2m",
    "5m",
  ]);
  assert.equal(
    merged.find((state) => state.timeframe === "5m").currentSignalDirection,
    "buy",
  );
});

test("signal matrix merge rejects older incoming state for an existing symbol", () => {
  const merged = mergeSignalMatrixStates({
    currentStates: [
      {
        symbol: "SPY",
        timeframe: "5m",
        currentSignalDirection: "buy",
        lastEvaluatedAt: "2026-05-21T14:30:00.000Z",
      },
    ],
    incomingStates: [
      {
        symbol: "SPY",
        timeframe: "5m",
        currentSignalDirection: "sell",
        lastEvaluatedAt: "2026-05-21T14:00:00.000Z",
      },
    ],
    knownSymbols: ["SPY"],
  });

  assert.equal(merged[0].currentSignalDirection, "buy");
});

test("signal matrix merge replaces pending placeholders with computed states", () => {
  const merged = mergeSignalMatrixStates({
    currentStates: [
      {
        symbol: "SPY",
        timeframe: "1m",
        status: "pending",
        lastEvaluatedAt: "2026-05-21T14:30:00.000Z",
      },
    ],
    incomingStates: [
      {
        symbol: "SPY",
        timeframe: "1m",
        status: "stale",
        latestBarAt: "2026-05-21T14:29:00.000Z",
        lastEvaluatedAt: "2026-05-21T14:29:30.000Z",
      },
    ],
    knownSymbols: ["SPY"],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "stale");
  assert.equal(merged[0].latestBarAt, "2026-05-21T14:29:00.000Z");
});

test("signal matrix state equality detects no-op pruning output", () => {
  const currentStates = [
    {
      symbol: "SPY",
      timeframe: "5m",
      currentSignalDirection: "buy",
      lastEvaluatedAt: "2026-05-21T14:30:00.000Z",
    },
  ];
  const merged = mergeSignalMatrixStates({
    currentStates,
    knownSymbols: ["SPY"],
  });

  assert.equal(signalMatrixStatesEqual(currentStates, merged), true);
  assert.equal(signalMatrixStatesEqual(currentStates, []), false);
});
