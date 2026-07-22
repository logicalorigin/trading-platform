import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalMatrixSymbolSets,
  buildSignalMatrixStoredStateBootstrapRequest,
  mergeSignalMatrixStreamSnapshot,
  mergeSignalMatrixStates,
  resolveSignalMatrixActiveScreenRequestSymbolLimit,
  resolveSignalMatrixActiveScreenRequestTaskLimit,
  resolveSignalMatrixExactCellLimit,
} from "./signalMatrixScheduler.js";

const sixTimeframes = ["1m", "2m", "5m", "15m", "1h", "1d"];
const symbols = Array.from({ length: 30 }, (_value, index) => `T${index + 1}`);

test("active signal matrix requests keep full capacity under API pressure", () => {
  assert.equal(resolveSignalMatrixActiveScreenRequestSymbolLimit("normal"), null);
  assert.equal(resolveSignalMatrixActiveScreenRequestSymbolLimit("watch"), null);
  assert.equal(resolveSignalMatrixActiveScreenRequestSymbolLimit("high"), null);
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("normal"), 240);
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("watch"), 240);
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("high"), 240);
  assert.equal(resolveSignalMatrixExactCellLimit("normal"), 240);
  assert.equal(resolveSignalMatrixExactCellLimit("watch"), 240);
  assert.equal(resolveSignalMatrixExactCellLimit("high"), 240);
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

test("existing-cell matrix deltas do not re-sort the complete matrix", () => {
  const currentStates = Array.from({ length: 2_000 }, (_, index) => ({
    symbol: `S${String(index).padStart(4, "0")}`,
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-12T16:25:00.000Z",
    latestBarAt: "2026-06-12T16:30:00.000Z",
    lastEvaluatedAt: "2026-06-12T16:30:00.000Z",
    currentSignalPrice: index,
    fresh: true,
  }));
  const incomingStates = [
    {
      ...currentStates[1_500],
      latestBarAt: "2026-06-12T16:35:00.000Z",
      lastEvaluatedAt: "2026-06-12T16:35:00.000Z",
      currentSignalPrice: 1_500.5,
    },
  ];
  const originalSort = Array.prototype.sort;
  let sortCalls = 0;
  Array.prototype.sort = function trackedSort(...args) {
    sortCalls += 1;
    return originalSort.apply(this, args);
  };

  try {
    const merged = mergeSignalMatrixStates({
      currentStates,
      incomingStates,
    });

    assert.equal(merged.length, currentStates.length);
    assert.equal(merged[1_499], currentStates[1_499]);
    assert.equal(merged[1_500], incomingStates[0]);
    assert.equal(merged[1_501], currentStates[1_501]);
    assert.equal(
      sortCalls,
      0,
      "an existing-key delta must preserve canonical order without a full sort",
    );
  } finally {
    Array.prototype.sort = originalSort;
  }
});

test("signal matrix stream bootstrap merges instead of replacing live cells", () => {
  const liveState = {
    symbol: "SPY",
    timeframe: "1m",
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-26T16:49:00.000Z",
    latestBarAt: "2026-06-26T16:49:00.000Z",
    lastEvaluatedAt: "2026-06-26T16:49:01.000Z",
    displayHydrationSource: "stream-delta",
    fresh: true,
  };
  const staleBootstrapState = {
    symbol: "SPY",
    timeframe: "1m",
    status: "stale",
    currentSignalDirection: "sell",
    currentSignalAt: "2026-06-26T16:40:00.000Z",
    latestBarAt: "2026-06-26T16:40:00.000Z",
    lastEvaluatedAt: "2026-06-26T16:40:01.000Z",
    displayHydrationSource: "stream-bootstrap",
    fresh: false,
  };

  const snapshot = mergeSignalMatrixStreamSnapshot({
    currentSnapshot: { states: [liveState] },
    incomingStates: [staleBootstrapState],
    kind: "bootstrap",
    coverage: { activeScopeSymbols: 500 },
  });

  assert.equal(snapshot.states.length, 1);
  assert.equal(snapshot.states[0], liveState);
  assert.equal(snapshot.coverage.activeScopeSymbols, 500);
});

test("empty signal matrix stream bootstrap clears prior cells on reconnect", () => {
  const liveState = {
    symbol: "SPY",
    timeframe: "1m",
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-26T16:49:00.000Z",
    latestBarAt: "2026-06-26T16:49:00.000Z",
    lastEvaluatedAt: "2026-06-26T16:49:01.000Z",
    displayHydrationSource: "stream-delta",
    fresh: true,
  };

  const snapshot = mergeSignalMatrixStreamSnapshot({
    currentSnapshot: { states: [liveState], coverage: { activeScopeSymbols: 500 } },
    incomingStates: [],
    kind: "bootstrap",
    coverage: { activeScopeSymbols: 500, stateCount: 0 },
  });

  assert.deepEqual(snapshot.states, []);
  assert.equal(snapshot.coverage.stateCount, 0);
});
