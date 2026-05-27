import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSignalMatrixRequestPlan,
  mergeSignalMatrixStates,
} from "./signalMatrixScheduler.js";

const hydratedStates = (symbols, timeframes = ["2m", "5m", "15m"]) =>
  symbols.flatMap((symbol) =>
    timeframes.map((timeframe) => ({
      symbol,
      timeframe,
      status: "ok",
      latestBarAt: "2026-05-27T14:30:00.000Z",
      lastEvaluatedAt: "2026-05-27T14:31:00.000Z",
    })),
  );

test("signal matrix scheduler sends missing priority symbols first", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY", "QQQ", "AAPL", "NVDA", "MSFT", "TSLA", "AMD", "META", "IWM", "DIA"],
    prioritySymbols: ["NVDA", "SPY", "QQQ"],
    backgroundReady: true,
    cursor: 0,
  });

  assert.deepEqual(plan.prioritySymbols, ["NVDA", "SPY", "QQQ"]);
  assert.deepEqual(plan.requestSymbols.slice(0, 3), ["NVDA", "SPY", "QQQ"]);
  assert.deepEqual(plan.backgroundSymbols, []);
  assert.equal(plan.coverage.totalSymbols, 10);
  assert.equal(plan.coverage.requestSymbols, 3);
  assert.equal(plan.coverage.hydratedSymbols, 0);
  assert.equal(plan.coverage.missingSymbols, 10);
  assert.equal(plan.backgroundPaused, true);
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
    prioritySymbols: [
      "SPY",
      "NVDA",
      "DIA",
    ],
    currentStates: hydratedStates(["SPY", "NVDA", "DIA"]),
    backgroundReady: true,
    cursor: 0,
    pollMs: 60_000,
  });

  assert.equal(plan.requestSymbols.length, 3);
  assert.deepEqual(plan.prioritySymbols, []);
  assert.deepEqual(plan.backgroundSymbols, [
    "AAPL",
    "MSFT",
    "TSLA",
  ]);
  assert.equal(plan.coverage.hydratedSymbols, 3);
  assert.equal(plan.coverage.missingSymbols, 17);
  assert.equal(plan.coverage.estimatedFullCycleMs, 360_000);
  assert.equal(plan.backgroundPaused, false);
});

test("signal matrix scheduler keeps bounded background rotation under critical pressure", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY", "QQQ", "AAPL", "NVDA", "MSFT", "TSLA", "AMD", "META", "PLTR", "COIN"],
    prioritySymbols: ["SPY", "QQQ", "AAPL", "NVDA", "MSFT"],
    pressureLevel: "critical",
    backgroundReady: true,
  });

  assert.deepEqual(plan.prioritySymbols, ["SPY"]);
  assert.deepEqual(plan.backgroundSymbols, []);
  assert.deepEqual(plan.requestSymbols, ["SPY"]);
  assert.equal(plan.backgroundPaused, true);
});

test("signal matrix scheduler defers background-only work under high pressure", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols: ["SPY", "QQQ", "AAPL", "NVDA", "MSFT"],
    prioritySymbols: ["SPY", "QQQ"],
    currentStates: hydratedStates(["SPY", "QQQ"]),
    pressureLevel: "high",
    backgroundReady: true,
    cursor: 0,
  });

  assert.deepEqual(plan.prioritySymbols, []);
  assert.deepEqual(plan.backgroundSymbols, []);
  assert.deepEqual(plan.requestSymbols, []);
  assert.equal(plan.backgroundReady, false);
  assert.equal(plan.backgroundPaused, true);
  assert.equal(plan.coverage.missingSymbols, 3);
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
  assert.deepEqual(
    merged.map((state) => state.timeframe).sort(),
    ["15m", "2m", "5m"],
  );
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
