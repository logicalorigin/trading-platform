import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalMatrixExactRequestPlan,
  buildSignalMatrixRequestPlan,
  buildSignalMatrixSymbolSets,
  buildSignalMatrixStoredStateBootstrapRequest,
  mergeSignalMatrixStates,
  reconcileSignalMatrixPendingStates,
  resolveSignalMatrixActiveScreenRequestTaskLimit,
  resolveSignalMatrixExactCellLimit,
} from "./signalMatrixScheduler.js";

const sixTimeframes = ["1m", "2m", "5m", "15m", "1h", "1d"];
const symbols = Array.from({ length: 30 }, (_value, index) => `T${index + 1}`);

test("active signal matrix requests keep full capacity under watch pressure", () => {
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("normal"), 240);
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("watch"), 240);
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("high"), 48);
  assert.equal(resolveSignalMatrixExactCellLimit("normal"), 240);
  assert.equal(resolveSignalMatrixExactCellLimit("watch"), 240);
  assert.equal(resolveSignalMatrixExactCellLimit("high"), 48);
});

test("watch pressure does not shrink active matrix coverage to a 15-symbol surface", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols: symbols,
    currentStates: [],
    timeframes: sixTimeframes,
    pressureLevel: "watch",
    backgroundReady: true,
    requestTaskLimit: resolveSignalMatrixActiveScreenRequestTaskLimit("watch"),
    requestExactCellLimit: resolveSignalMatrixExactCellLimit("watch"),
  });

  assert.equal(plan.requestCells.length, 180);
  assert.equal(plan.requestSymbols.length, 30);
  assert.equal(plan.coverage.requestTaskLimit, 240);
  assert.equal(plan.coverage.queuedTaskCount, 0);
});

test("matrix request planning chunks the supplied scope", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols: symbols,
    currentStates: [],
    timeframes: sixTimeframes,
    pressureLevel: "high",
    backgroundReady: true,
    requestTaskLimit: resolveSignalMatrixActiveScreenRequestTaskLimit("high"),
    requestExactCellLimit: resolveSignalMatrixExactCellLimit("high"),
  });

  assert.equal(plan.requestCells.length, 48);
  assert.equal(plan.coverage.requestTaskLimit, 48);
  assert.equal(plan.coverage.queuedTaskCount, 132);
});

test("exact matrix request planning preserves supplied cells", () => {
  const plan = buildSignalMatrixExactRequestPlan({
    symbols: ["AAPL", "MSFT", "NVDA"],
    prioritySymbols: ["MSFT", "AAPL"],
    cells: [
      { symbol: "msft", timeframe: "1m" },
      { symbol: "MSFT", timeframe: "1m" },
      { symbol: "AAPL", timeframe: "5m" },
      { symbol: "NVDA", timeframe: "1d" },
      { symbol: "TSLA", timeframe: "1m" },
      { symbol: "AAPL", timeframe: "bad" },
    ],
    timeframes: sixTimeframes,
    requestSymbolLimit: 2,
  });

  assert.deepEqual(plan.requestCells, [
    { symbol: "MSFT", timeframe: "1m" },
    { symbol: "AAPL", timeframe: "5m" },
  ]);
  assert.deepEqual(plan.requestSymbols, ["MSFT", "AAPL"]);
  assert.deepEqual(plan.timeframes, ["1m", "5m"]);
  assert.equal(plan.coverage.exactCellRequest, true);
  assert.equal(plan.coverage.requestTaskCount, 2);
  assert.equal(plan.coverage.queuedTaskCount, 1);
});

test("exact matrix request planning respects cell limits", () => {
  const cells = symbols.flatMap((symbol) =>
    sixTimeframes.map((timeframe) => ({ symbol, timeframe })),
  );
  const plan = buildSignalMatrixExactRequestPlan({
    symbols,
    prioritySymbols: symbols,
    cells,
    timeframes: sixTimeframes,
    requestExactCellLimit: resolveSignalMatrixExactCellLimit("high"),
  });

  assert.equal(plan.requestCells.length, 48);
  assert.equal(plan.coverage.requestTaskCount, 48);
  assert.equal(plan.coverage.queuedTaskCount, 132);
});

test("exact matrix request planning rotates through capped exact cells", () => {
  const cells = symbols.flatMap((symbol) =>
    sixTimeframes.map((timeframe) => ({ symbol, timeframe })),
  );
  const firstPlan = buildSignalMatrixExactRequestPlan({
    symbols,
    prioritySymbols: symbols,
    cells,
    timeframes: sixTimeframes,
    requestExactCellLimit: resolveSignalMatrixExactCellLimit("high"),
  });
  const secondPlan = buildSignalMatrixExactRequestPlan({
    symbols,
    prioritySymbols: symbols,
    cells,
    timeframes: sixTimeframes,
    cursor: firstPlan.nextCursor,
    requestExactCellLimit: resolveSignalMatrixExactCellLimit("high"),
  });

  assert.equal(firstPlan.nextCursor, 48);
  assert.deepEqual(
    firstPlan.requestCells.slice(0, 6).map((cell) => `${cell.symbol}:${cell.timeframe}`),
    [
      "T1:1m",
      "T1:2m",
      "T1:5m",
      "T1:15m",
      "T1:1h",
      "T1:1d",
    ],
  );
  assert.deepEqual(
    secondPlan.requestCells.slice(0, 6).map((cell) => `${cell.symbol}:${cell.timeframe}`),
    [
      "T9:1m",
      "T9:2m",
      "T9:5m",
      "T9:15m",
      "T9:1h",
      "T9:1d",
    ],
  );
  assert.equal(secondPlan.nextCursor, 96);
});

test("stored-state bootstrap plans broad coverage without exact cells", () => {
  const plan = buildSignalMatrixStoredStateBootstrapRequest({
    symbols,
    currentStates: [],
    timeframes: sixTimeframes,
  });

  assert.deepEqual(plan.symbols, symbols);
  assert.deepEqual(plan.timeframes, sixTimeframes);
  assert.equal(plan.coverage.storedStateBootstrap, true);
  assert.equal(plan.coverage.requestTaskCount, symbols.length * sixTimeframes.length);
  assert.equal(plan.coverage.missingTaskCount, symbols.length * sixTimeframes.length);
});

test("stored-state bootstrap key is stable across symbol ordering changes", () => {
  const plan = buildSignalMatrixStoredStateBootstrapRequest({
    symbols: ["MSFT", "AAPL", "NVDA"],
    currentStates: [],
    timeframes: sixTimeframes,
  });

  assert.ok(plan);
  const reorderedPlan = buildSignalMatrixStoredStateBootstrapRequest({
    symbols: ["NVDA", "MSFT", "AAPL"],
    currentStates: [],
    timeframes: sixTimeframes,
    lastBootstrapKey: plan.key,
  });

  assert.equal(reorderedPlan, null);
});

test("signal matrix symbol sets prioritize visible shell symbols without signals screen", () => {
  const sets = buildSignalMatrixSymbolSets({
    selectedSymbol: "spy",
    watchlistPrioritySymbols: ["aapl", "msft"],
    openPositionSymbols: ["nvda"],
    signalMonitorSymbols: ["tsla"],
    signalMonitorUniverseSymbols: ["amd"],
    watchlistSymbols: ["AAPL", "MSFT", "GOOG"],
  });

  assert.deepEqual(sets.prioritySymbols.slice(0, 5), [
    "SPY",
    "AAPL",
    "MSFT",
    "TSLA",
    "NVDA",
  ]);
  assert.equal(sets.universeSymbols.includes("GOOG"), true);
  assert.equal(sets.universeSymbols.includes("AMD"), true);
});

test("signal matrix symbol sets keep open positions in priority during signals screen requests", () => {
  const sets = buildSignalMatrixSymbolSets({
    selectedSymbol: "spy",
    watchlistPrioritySymbols: ["aapl"],
    signalsScreenSymbols: ["mu", "avgo"],
    signalsScreenPrioritySymbols: ["avgo"],
    openPositionSymbols: ["nvda"],
    signalMonitorSymbols: ["tsla"],
    watchlistSymbols: ["AAPL"],
  });

  assert.deepEqual(sets.prioritySymbols, ["AVGO", "SPY", "AAPL", "NVDA"]);
  assert.equal(sets.universeSymbols.includes("MU"), true);
  assert.equal(sets.universeSymbols.includes("TSLA"), true);
});

test("signal matrix merge keeps usable matrix state when it is at least as active", () => {
  const currentStates = [
    {
      symbol: "AAPL",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-06-09T14:30:00.000Z",
      latestBarAt: "2026-06-09T14:30:00.000Z",
      lastEvaluatedAt: "2026-06-09T14:30:00.000Z",
      fresh: true,
    },
  ];
  const incomingStates = [
    {
      symbol: "AAPL",
      timeframe: "5m",
      status: "stale",
      currentSignalDirection: "sell",
      currentSignalAt: "2026-06-09T14:35:00.000Z",
      latestBarAt: "2026-06-09T14:35:00.000Z",
      lastEvaluatedAt: "2026-06-09T14:35:00.000Z",
      fresh: false,
    },
  ];

  const merged = mergeSignalMatrixStates({ currentStates, incomingStates });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].currentSignalDirection, "sell");
});

test("signal matrix merge does not let older matrix state clobber fresher store state", () => {
  const currentStates = [
    {
      symbol: "MSFT",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-06-09T14:35:00.000Z",
      latestBarAt: "2026-06-09T14:35:00.000Z",
      lastEvaluatedAt: "2026-06-09T14:35:00.000Z",
      fresh: false,
    },
  ];
  const incomingStates = [
    {
      symbol: "MSFT",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "sell",
      currentSignalAt: "2026-06-09T14:25:00.000Z",
      latestBarAt: "2026-06-09T14:25:00.000Z",
      lastEvaluatedAt: "2026-06-09T14:25:00.000Z",
      fresh: true,
    },
  ];

  const merged = mergeSignalMatrixStates({ currentStates, incomingStates });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].currentSignalDirection, "buy");
});

test("signal matrix merge keeps real state over pending state", () => {
  const currentStates = [
    {
      symbol: "NVDA",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-06-09T14:30:00.000Z",
      latestBarAt: "2026-06-09T14:30:00.000Z",
      fresh: true,
    },
  ];
  const incomingStates = [
    {
      symbol: "NVDA",
      timeframe: "5m",
      status: "pending",
      currentSignalDirection: null,
      currentSignalAt: null,
      latestBarAt: null,
      fresh: false,
    },
  ];

  const merged = mergeSignalMatrixStates({ currentStates, incomingStates });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "ok");
});

test("signal matrix merge reuses the current array for equivalent incoming state", () => {
  const currentStates = [
    {
      symbol: "CEG",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-06-12T16:25:00.000Z",
      latestBarAt: "2026-06-12T16:30:00.000Z",
      lastEvaluatedAt: "2026-06-12T16:30:00.000Z",
      currentSignalPrice: 93.12,
      barsSinceSignal: 1,
      fresh: true,
    },
  ];
  const incomingStates = [
    {
      ...currentStates[0],
      symbol: "ceg",
      currentSignalPrice: "93.12",
      barsSinceSignal: "1",
    },
  ];

  const merged = mergeSignalMatrixStates({ currentStates, incomingStates });

  assert.equal(merged, currentStates);
  assert.equal(merged[0], currentStates[0]);
});

test("signal matrix pending reconciliation keeps only backend-confirmed pending cells", () => {
  const currentStates = [
    {
      symbol: "AAPL",
      timeframe: "5m",
      status: "pending",
      currentSignalDirection: null,
      currentSignalAt: null,
      latestBarAt: null,
      lastEvaluatedAt: "2026-06-09T14:30:00.000Z",
      fresh: false,
    },
    {
      symbol: "MSFT",
      timeframe: "1m",
      status: "pending",
      currentSignalDirection: null,
      currentSignalAt: null,
      latestBarAt: null,
      lastEvaluatedAt: "2026-06-09T14:30:00.000Z",
      fresh: false,
    },
    {
      symbol: "NVDA",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-06-09T14:25:00.000Z",
      latestBarAt: "2026-06-09T14:25:00.000Z",
      lastEvaluatedAt: "2026-06-09T14:25:00.000Z",
      fresh: true,
    },
  ];
  const incomingStates = [
    {
      symbol: "AAPL",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: null,
      currentSignalAt: null,
      latestBarAt: "2026-06-09T14:35:00.000Z",
      lastEvaluatedAt: "2026-06-09T14:35:00.000Z",
      fresh: true,
    },
  ];

  const reconciled = reconcileSignalMatrixPendingStates({
    currentStates,
    incomingStates,
    requestCells: [
      { symbol: "AAPL", timeframe: "5m" },
      { symbol: "MSFT", timeframe: "1m" },
    ],
    pendingCells: [{ symbol: "MSFT", timeframe: "1m" }],
  });

  assert.deepEqual(
    reconciled.map((state) => `${state.symbol}:${state.timeframe}:${state.status}`),
    ["MSFT:1m:pending", "NVDA:5m:ok"],
  );
});

test("signal matrix pending reconciliation clears stale background pending cells", () => {
  const currentStates = [
    {
      symbol: "AALB",
      timeframe: "5m",
      status: "pending",
      currentSignalDirection: null,
      currentSignalAt: null,
      latestBarAt: null,
      lastEvaluatedAt: "2026-06-09T14:30:00.000Z",
      fresh: false,
    },
    {
      symbol: "AAPL",
      timeframe: "5m",
      status: "pending",
      currentSignalDirection: null,
      currentSignalAt: null,
      latestBarAt: null,
      lastEvaluatedAt: "2026-06-09T14:31:00.000Z",
      fresh: false,
    },
  ];

  const reconciled = reconcileSignalMatrixPendingStates({
    currentStates,
    requestCells: [{ symbol: "AAPL", timeframe: "5m" }],
    pendingCells: [],
    clearUnconfirmedPendingStates: true,
  });

  assert.deepEqual(reconciled, []);
});
