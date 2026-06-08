import assert from "node:assert/strict";
import test from "node:test";

import { __signalOptionsAutomationInternalsForTests } from "./signal-options-automation";

const signalState = (
  symbol: string,
  signalAt: string,
  direction: "buy" | "sell" = "buy",
) =>
  ({
    id: `${symbol}:5m`,
    profileId: "paper-profile",
    symbol,
    timeframe: "5m",
    currentSignalDirection: direction,
    currentSignalAt: signalAt,
    currentSignalPrice: 100,
    latestBarAt: signalAt,
    barsSinceSignal: 0,
    fresh: true,
    status: "ok",
    active: true,
    lastEvaluatedAt: signalAt,
    lastError: null,
  }) as never;

test("Signal Options MTF matrix symbols follow cursor, seen set, and worker cap", () => {
  const states = [
    signalState("SPY", "2026-06-08T14:20:00.000Z"),
    signalState("AAPL", "2026-06-08T14:19:00.000Z"),
    signalState("MSFT", "2026-06-08T14:18:00.000Z", "sell"),
    signalState("TSLA", "2026-06-08T14:17:00.000Z"),
  ];
  const seenSignals = new Set([
    __signalOptionsAutomationInternalsForTests.buildSignalKey(
      states[1],
      "2026-06-08T14:19:00.000Z",
    ),
  ]);

  assert.deepEqual(
    __signalOptionsAutomationInternalsForTests.selectSignalOptionsMtfMatrixSymbols({
      states,
      universe: new Set(["SPY", "AAPL", "MSFT", "TSLA"]),
      seenSignals,
      startIndex: 1,
      maxSymbols: 2,
    }),
    ["MSFT", "TSLA"],
  );
});

test("Signal Options dashboard candidates use deterministic display tie-breakers", () => {
  const candidates = [
    {
      id: "SIGOPT-paper-TSLA-buy-1780617600000",
      symbol: "TSLA",
      direction: "buy",
      signalAt: "2026-06-05T00:00:00.000Z",
      timeline: [],
    },
    {
      id: "SIGOPT-paper-META-buy-1780617600000",
      symbol: "META",
      direction: "buy",
      signalAt: "2026-06-05T00:00:00.000Z",
      timeline: [],
    },
    {
      id: "SIGOPT-paper-LITE-buy-1780929600000",
      symbol: "LITE",
      direction: "buy",
      signalAt: "2026-06-08T14:40:00.000Z",
      timeline: [],
    },
  ];
  const compare =
    __signalOptionsAutomationInternalsForTests.compareSignalOptionsCandidatesForDisplay as (
      left: Record<string, unknown>,
      right: Record<string, unknown>,
    ) => number;

  candidates.sort(compare);

  assert.deepEqual(
    candidates.map((candidate) => candidate.symbol),
    ["LITE", "META", "TSLA"],
  );
});

test("Signal Options forced signal refresh fallback preserves cached state", () => {
  const state = {
    deployment: { id: "deployment-paper" },
    profile: { id: "paper-profile" },
    mode: "shadow",
    signals: [{ symbol: "SPY" }],
    candidates: [{ symbol: "SPY" }],
    dataQuality: {},
    activePositions: [],
    risk: {},
    events: [],
  };
  const fallback =
    __signalOptionsAutomationInternalsForTests.signalOptionsSignalRefreshFallbackState({
      deployment: { id: "deployment-paper" },
      profile: { id: "paper-profile" },
      events: [],
      state,
      cachedAt: "2026-06-08T14:20:00.000Z",
      expiresAt: 0,
      staleExpiresAt: 0,
    } as never) as Record<string, unknown>;

  assert.equal(fallback["cacheStatus"], "stale");
  assert.equal(fallback["degraded"], true);
  assert.equal(fallback["stale"], true);
  assert.equal(
    fallback["reason"],
    "signal_options_state_signal_refresh_failed_fallback",
  );
  assert.deepEqual(fallback["signals"], state.signals);
  assert.deepEqual(fallback["candidates"], state.candidates);
});

const pressureSnapshot = (level: "normal" | "watch" | "high") =>
  ({
    level,
    observedAt: "2026-06-08T18:10:00.000Z",
    drivers: [],
    scannerPressure: {
      level: "normal",
      drivers: [],
      activeLongScanCount: 0,
    },
    caps: {
      signalOptions: {
        maintenanceOnly: false,
        skipDeploymentScans: false,
        signalRefreshAllowed: true,
        actionScansAllowed: true,
        positionMarksAllowed: true,
        watchlistPrewarmAllowed: true,
      },
    },
    inputs: {
      rssMb: null,
      apiHeapUsedPercent: null,
      apiP95LatencyMs: null,
      dominantSlowRouteP95Ms: null,
      clientLevel: null,
      cacheLevel: null,
      automationActiveLongScanCount: null,
    },
  }) as never;

test("Signal Options worker live-edge refresh batches when stream-first monitor is available", () => {
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldBatchSignalOptionsWorkerMonitorRefresh({
      source: "worker",
      pressure: pressureSnapshot("normal"),
      streamFirstMonitorAvailable: true,
    }),
    true,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldBatchSignalOptionsWorkerMonitorRefresh({
      source: "manual",
      pressure: pressureSnapshot("high"),
      streamFirstMonitorAvailable: true,
    }),
    false,
  );
});

test("Signal Options worker live-edge refresh batches under API pressure", () => {
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldBatchSignalOptionsWorkerMonitorRefresh({
      source: "worker",
      pressure: pressureSnapshot("watch"),
      streamFirstMonitorAvailable: false,
    }),
    true,
  );
});

test("Signal Options worker live-edge batch merge preserves full stored universe", () => {
  const stored = {
    profile: { id: "paper-profile", lastEvaluatedAt: "2026-06-08T18:00:00.000Z" },
    evaluatedAt: "2026-06-08T18:00:00.000Z",
    universeSymbols: ["AAPL", "MSFT", "SPY"],
    universe: { resolvedSymbols: 3 },
    states: [
      { symbol: "AAPL", timeframe: "5m", currentSignalAt: "old-aapl" },
      { symbol: "MSFT", timeframe: "5m", currentSignalAt: "old-msft" },
      { symbol: "SPY", timeframe: "5m", currentSignalAt: "old-spy" },
    ],
  };
  const evaluated = {
    profile: { id: "paper-profile", lastEvaluatedAt: "2026-06-08T18:10:00.000Z" },
    evaluatedAt: "2026-06-08T18:10:00.000Z",
    universeSymbols: ["AAPL"],
    universe: { resolvedSymbols: 1 },
    states: [
      { symbol: "AAPL", timeframe: "5m", currentSignalAt: "new-aapl" },
    ],
  };

  const merged =
    __signalOptionsAutomationInternalsForTests.mergeSignalOptionsMonitorStateBatch({
      stored,
      evaluated,
    }) as Record<string, unknown>;

  assert.deepEqual(merged["universeSymbols"], stored.universeSymbols);
  assert.deepEqual(merged["universe"], stored.universe);
  assert.deepEqual(
    (merged["states"] as Array<Record<string, unknown>>).map((state) => [
      state.symbol,
      state.currentSignalAt,
    ]),
    [
      ["AAPL", "new-aapl"],
      ["MSFT", "old-msft"],
      ["SPY", "old-spy"],
    ],
  );
});
