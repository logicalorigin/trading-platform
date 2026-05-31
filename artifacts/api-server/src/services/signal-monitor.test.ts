import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SignalMonitorProfileRow } from "./signal-monitor";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

const signalMonitorModule = await import("./signal-monitor");
const {
  __signalMonitorInternalsForTests,
  aggregateCompletedFiveMinuteBars,
  aggregateCompletedMinuteBars,
  buildSignalMonitorDbUnavailableProfile,
  createSignalMonitorDbUnavailableError,
  evaluateSignalMonitorMatrixStateFromCompletedBars,
  signalMonitorCompletedBarsQueryTo,
} = signalMonitorModule;

const baseDate = new Date("2026-04-24T14:30:00.000Z");

function profile(patch: Partial<SignalMonitorProfileRow> = {}): SignalMonitorProfileRow {
  return {
    id: "profile-1",
    environment: "paper",
    enabled: true,
    watchlistId: "watchlist-1",
    timeframe: "15m",
    pyrusSignalsSettings: {},
    freshWindowBars: 3,
    pollIntervalSeconds: 15,
    maxSymbols: 50,
    evaluationConcurrency: 3,
    lastEvaluatedAt: null,
    lastError: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...patch,
  };
}

function bar(minute: string, open: number, close: number) {
  return {
    timestamp: new Date(`2026-04-24T14:${minute}:00.000Z`),
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume: 100,
    partial: false,
  };
}

test("stored signal monitor snapshots mark non-current states stale", () => {
  const state = {
    id: "state-1",
    profileId: "profile-1",
    symbol: "SPY",
    timeframe: "5m",
    currentSignalDirection: "buy",
    currentSignalAt: new Date("2026-04-24T14:30:00.000Z"),
    currentSignalPrice: "500.000000",
    latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
    barsSinceSignal: 1,
    fresh: true,
    status: "ok",
    active: true,
    lastEvaluatedAt: new Date("2026-04-24T14:35:00.000Z"),
    lastError: null,
  } as never;

  const snapshot =
    __signalMonitorInternalsForTests.stateToResponseForSnapshot(state, {
      timeframe: "5m",
      evaluatedAt: new Date("2026-04-24T16:00:00.000Z"),
      markNonCurrentStale: true,
    });

  assert.equal(snapshot.currentSignalDirection, "buy");
  assert.equal(snapshot.currentSignalPrice, 500);
  assert.equal(snapshot.fresh, false);
  assert.equal(snapshot.status, "stale");
  assert.match(snapshot.lastError ?? "", /persisted state/);
});

test("2m signal matrix bars roll up completed 1m bars", () => {
  const aggregated = aggregateCompletedMinuteBars(
    [
      bar("30", 100, 101),
      bar("31", 101, 103),
      bar("32", 103, 102),
      bar("33", 102, 104),
    ] as never,
    "2m",
    new Date("2026-04-24T14:35:02.000Z"),
  );

  assert.equal(aggregated.length, 2);
  assert.deepEqual(
    aggregated.map((item) => ({
      timestamp: item.timestamp,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
    })),
    [
      {
        timestamp: new Date("2026-04-24T14:30:00.000Z"),
        open: 100,
        high: 104,
        low: 99,
        close: 103,
        volume: 200,
      },
      {
        timestamp: new Date("2026-04-24T14:32:00.000Z"),
        open: 103,
        high: 105,
        low: 101,
        close: 104,
        volume: 200,
      },
    ],
  );
});

test("2m signal matrix bars skip incomplete source buckets", () => {
  const aggregated = aggregateCompletedMinuteBars(
    [
      bar("30", 100, 101),
      bar("32", 103, 102),
      bar("33", 102, 104),
    ] as never,
    "2m",
    new Date("2026-04-24T14:35:02.000Z"),
  );

  assert.deepEqual(
    aggregated.map((item) => item.timestamp),
    [new Date("2026-04-24T14:32:00.000Z")],
  );
});

test("15m signal matrix bars roll up completed 5m bars", () => {
  const aggregated = aggregateCompletedFiveMinuteBars(
    [
      { ...bar("30", 100, 101), volume: 10 },
      { ...bar("35", 101, 103), volume: 20 },
      { ...bar("40", 103, 102), volume: 30 },
      { ...bar("45", 102, 104), volume: 40 },
      { ...bar("50", 104, 105), volume: 50 },
    ] as never,
    "15m",
    new Date("2026-04-24T15:01:02.000Z"),
  );

  assert.equal(aggregated.length, 1);
  assert.deepEqual(
    aggregated.map((item) => ({
      timestamp: item.timestamp,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
    })),
    [
      {
        timestamp: new Date("2026-04-24T14:30:00.000Z"),
        open: 100,
        high: 104,
        low: 99,
        close: 102,
        volume: 60,
      },
    ],
  );
});

test("signal monitor bar queries are scoped to the latest completed boundary", () => {
  assert.equal(
    signalMonitorCompletedBarsQueryTo({
      timeframe: "5m",
      evaluatedAt: new Date("2026-04-24T14:35:01.999Z"),
    }).toISOString(),
    "2026-04-24T14:30:00.000Z",
  );
  assert.equal(
    signalMonitorCompletedBarsQueryTo({
      timeframe: "5m",
      evaluatedAt: new Date("2026-04-24T14:35:02.000Z"),
    }).toISOString(),
    "2026-04-24T14:35:00.000Z",
  );
  assert.equal(
    signalMonitorCompletedBarsQueryTo({
      timeframe: "1m",
      evaluatedAt: new Date("2026-04-24T14:35:02.000Z"),
    }).toISOString(),
    "2026-04-24T14:35:00.000Z",
  );
});

test("signal monitor completed-bars cache key is stable for the same completed boundary", () => {
  const keyA =
    __signalMonitorInternalsForTests.buildSignalMonitorCompletedBarsCacheKey({
      symbol: "spy",
      timeframe: "5m",
      providerTimeframe: "5m",
      providerLimit: 120,
      completedLimit: 120,
      queryTo: new Date("2026-04-24T14:35:00.000Z"),
      barSourcePolicy: "mixed",
    });
  const keyB =
    __signalMonitorInternalsForTests.buildSignalMonitorCompletedBarsCacheKey({
      symbol: "SPY",
      timeframe: "5m",
      providerTimeframe: "5m",
      providerLimit: 120,
      completedLimit: 120,
      queryTo: new Date("2026-04-24T14:35:00.000Z"),
      barSourcePolicy: "mixed",
    });
  const keyIbkrOnly =
    __signalMonitorInternalsForTests.buildSignalMonitorCompletedBarsCacheKey({
      symbol: "SPY",
      timeframe: "5m",
      providerTimeframe: "5m",
      providerLimit: 120,
      completedLimit: 120,
      queryTo: new Date("2026-04-24T14:35:00.000Z"),
      barSourcePolicy: "ibkr-only",
    });

  assert.equal(keyA, keyB);
  assert.notEqual(keyA, keyIbkrOnly);
});

test("signal monitor matrix bars use the priority-aware bars lane", () => {
  const source = readFileSync(new URL("./signal-monitor.ts", import.meta.url), "utf8");
  const loadBlock = source.match(
    /export async function loadSignalMonitorCompletedBars[\s\S]*?export async function evaluateSignalMonitorSymbolFromCompletedBars/,
  )?.[0];
  const fullEvaluationBlock = source.match(
    /export async function evaluateSignalMonitorSymbol[\s\S]*?export function evaluateSignalMonitorMatrixStateFromCompletedBars/,
  )?.[0];
  const matrixSymbolBlock = source.match(
    /async function evaluateSignalMonitorMatrixSymbol[\s\S]*?function withSignalMonitorMatrixMetadata/,
  )?.[0];

  assert.match(source, /getBarsWithDebug/);
  assert.match(source, /const SIGNAL_MONITOR_MATRIX_BARS_LIMIT = 240;/);
  assert.match(source, /const SIGNAL_MONITOR_MATRIX_SOURCE_STRATEGY = "native_timeframes";/);
  assert.match(source, /const SIGNAL_MONITOR_BARS_PRIORITY = 8;/);
  assert.match(source, /const SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY = 9;/);
  assert.match(source, /const SIGNAL_MONITOR_BARS_FAMILY = "signal-matrix";/);
  assert.match(
    loadBlock ?? "",
    /mode === "live-edge"\s*\?\s*SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY\s*:\s*SIGNAL_MONITOR_BARS_PRIORITY/,
  );
  assert.match(loadBlock ?? "", /priority,\s*\n\s*family:\s*SIGNAL_MONITOR_BARS_FAMILY/);
  assert.match(loadBlock ?? "", /family:\s*SIGNAL_MONITOR_BARS_FAMILY/);
  assert.match(loadBlock ?? "", /readSignalMonitorCompletedBarsCache/);
  assert.match(loadBlock ?? "", /signalMonitorCompletedBarsInFlight/);
  assert.match(loadBlock ?? "", /shouldRetrySignalMonitorCompletedBars/);
  assert.match(loadBlock ?? "", /shouldAllowSignalMonitorBrokerLiveEdgeRetry/);
  assert.match(loadBlock ?? "", /allowBrokerLiveEdgeRetry[\s\S]*fetchCompletedBars\("live-edge"\)/);
  assert.match(loadBlock ?? "", /const providerTimeframe = input\.timeframe;/);
  assert.match(loadBlock ?? "", /timeframe:\s*providerTimeframe/);
  assert.doesNotMatch(loadBlock ?? "", /buildFallbackPlan/);
  assert.doesNotMatch(loadBlock ?? "", /providerTimeframe:\s*"1m"/);
  assert.doesNotMatch(loadBlock ?? "", /providerTimeframe:\s*"5m"/);
  assert.doesNotMatch(loadBlock ?? "", /aggregateCompletedMinuteBars/);
  assert.doesNotMatch(loadBlock ?? "", /aggregateCompletedFiveMinuteBars/);
  assert.doesNotMatch(fullEvaluationBlock ?? "", /SIGNAL_MONITOR_MATRIX_BARS_LIMIT/);
  assert.doesNotMatch(fullEvaluationBlock ?? "", /retryStale:\s*false/);
  assert.match(matrixSymbolBlock ?? "", /limit:\s*SIGNAL_MONITOR_MATRIX_BARS_LIMIT/);
  assert.match(matrixSymbolBlock ?? "", /timeframe,/);
  assert.doesNotMatch(matrixSymbolBlock ?? "", /SIGNAL_MONITOR_MATRIX_5M_SOURCE_LIMIT/);
  assert.doesNotMatch(matrixSymbolBlock ?? "", /aggregateCompletedFiveMinuteBars/);
  assert.doesNotMatch(matrixSymbolBlock ?? "", /retryStale:\s*false/);
  assert.match(matrixSymbolBlock ?? "", /sourceRequestCount:\s*timeframes\.length/);
});

test("signal monitor evaluates the newest completed bar without an extra bar wait", () => {
  const source = readFileSync(new URL("./signal-monitor.ts", import.meta.url), "utf8");
  const symbolEvaluationBlock = source.match(
    /export async function evaluateSignalMonitorSymbolFromCompletedBars[\s\S]*?async function evaluateSignalMonitorSymbol/,
  )?.[0];
  const matrixEvaluationBlock = source.match(
    /export function evaluateSignalMonitorMatrixStateFromCompletedBars[\s\S]*?type SignalMonitorMatrixStateResult/,
  )?.[0];

  assert.match(symbolEvaluationBlock ?? "", /includeProvisionalSignals:\s*true/);
  assert.doesNotMatch(
    symbolEvaluationBlock ?? "",
    /includeProvisionalSignals:\s*false/,
  );
  assert.match(matrixEvaluationBlock ?? "", /includeProvisionalSignals:\s*true/);
  assert.doesNotMatch(
    matrixEvaluationBlock ?? "",
    /includeProvisionalSignals:\s*false/,
  );
});

test("signal monitor event responses normalize retired algo branding", () => {
  const source = readFileSync(new URL("./signal-monitor.ts", import.meta.url), "utf8");
  const eventResponseBlock = source.match(
    /function eventToResponse[\s\S]*?\n}\n\ntype SignalMonitorEventResponse/,
  )?.[0];

  assert.match(source, /normalizeLegacyAlgoBrandText/);
  assert.match(source, /normalizeLegacyAlgoBranding/);
  assert.match(
    eventResponseBlock ?? "",
    /source:\s*normalizeLegacyAlgoBrandText\(event\.source\)/,
  );
  assert.match(
    eventResponseBlock ?? "",
    /payload:\s*normalizeLegacyAlgoBranding\(asRecord\(event\.payload\)\)/,
  );
});

test("intraday delayed signal bars force live-edge retry before stale age", () => {
  const evaluatedAt = new Date("2026-05-26T15:40:00.000Z");
  const delayedLatest = {
    timestamp: new Date("2026-05-26T15:35:00.000Z"),
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 100,
    partial: false,
    delayed: true,
    freshness: "delayed",
    marketDataMode: "delayed",
    source: "massive-history",
  };

  assert.equal(
    __signalMonitorInternalsForTests.shouldRetrySignalMonitorCompletedBars({
      completedBars: [delayedLatest] as never,
      timeframe: "5m",
      evaluatedAt,
    }),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldRetrySignalMonitorCompletedBars({
      completedBars: [delayedLatest] as never,
      timeframe: "1d",
      evaluatedAt,
    }),
    false,
  );

  const massiveLiveLatest = {
    ...delayedLatest,
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    source: "massive-history",
  };
  assert.equal(
    __signalMonitorInternalsForTests.shouldRetrySignalMonitorCompletedBars({
      completedBars: [massiveLiveLatest] as never,
      timeframe: "5m",
      evaluatedAt,
    }),
    false,
  );
});

test("signal monitor completed-bars cache bypasses retryable delayed rows", () => {
  const evaluatedAt = new Date("2026-05-26T15:40:00.000Z");
  const delayedLatest = {
    timestamp: new Date("2026-05-26T15:35:00.000Z"),
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 100,
    partial: false,
    delayed: true,
    freshness: "delayed",
    marketDataMode: "delayed",
    source: "massive-history",
  };
  const liveLatest = {
    ...delayedLatest,
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    source: "ibkr-history",
  };

  assert.equal(
    __signalMonitorInternalsForTests.shouldBypassSignalMonitorCompletedBarsCache({
      cached: {
        bars: [delayedLatest] as never,
        latestBarAt: delayedLatest.timestamp,
      },
      timeframe: "5m",
      evaluatedAt,
    }),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldBypassSignalMonitorCompletedBarsCache({
      cached: {
        bars: [delayedLatest] as never,
        latestBarAt: delayedLatest.timestamp,
      },
      timeframe: "5m",
      evaluatedAt,
      retryStale: false,
    }),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldBypassSignalMonitorCompletedBarsCache({
      cached: {
        bars: [liveLatest] as never,
        latestBarAt: liveLatest.timestamp,
      },
      timeframe: "5m",
      evaluatedAt,
    }),
    false,
  );
});

test("signal monitor IBKR source policy rejects Polygon and Massive bars", () => {
  const ibkr = { ...bar("30", 100, 101), source: "ibkr-history" };
  const overnight = { ...bar("31", 101, 102), source: "ibkr-overnight-history" };
  const polygon = {
    ...bar("32", 102, 103),
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    source: "polygon-history",
  };
  const massive = {
    ...bar("33", 103, 104),
    delayed: true,
    freshness: "delayed",
    marketDataMode: "delayed",
    source: "massive-history",
  };

  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorIbkrBar(ibkr as never),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorIbkrBar(overnight as never),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorIbkrBar(polygon as never),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorIbkrBar(massive as never),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorDelayedBar(polygon as never),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorDelayedBar(massive as never),
    true,
  );

  assert.deepEqual(
    __signalMonitorInternalsForTests
      .filterSignalMonitorBarsForSourcePolicy(
        [polygon, ibkr, massive, overnight] as never,
        "ibkr-only",
      )
      .map((item) => item.source),
    ["ibkr-history", "ibkr-overnight-history"],
  );
});

test("intraday delayed matrix bars are degraded instead of fresh", () => {
  const evaluatedAt = new Date("2026-05-26T15:40:00.000Z");
  const delayedLatest = {
    timestamp: new Date("2026-05-26T15:35:00.000Z"),
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 100,
    partial: false,
    delayed: true,
    freshness: "delayed",
    marketDataMode: "delayed",
    source: "massive-history",
  };

  const intraday = evaluateSignalMonitorMatrixStateFromCompletedBars({
    profile: profile({ timeframe: "5m" }),
    symbol: "SPY",
    timeframe: "5m",
    evaluatedAt,
    completedBars: [delayedLatest] as never,
  });
  const daily = evaluateSignalMonitorMatrixStateFromCompletedBars({
    profile: profile({ timeframe: "1d" }),
    symbol: "SPY",
    timeframe: "1d",
    evaluatedAt,
    completedBars: [delayedLatest] as never,
  });

  assert.equal(intraday.status, "stale");
  assert.equal(intraday.fresh, false);
  assert.match(intraday.lastError || "", /delayed/);
  assert.equal(daily.status, "ok");
});

test("signal monitor matrix narrows historical work under API resource pressure", () => {
  const configured = profile({
    maxSymbols: 250,
    evaluationConcurrency: 10,
  });
  const lowProfile = profile({
    maxSymbols: 6,
    evaluationConcurrency: 1,
  });

  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(configured, "normal"),
    { pressure: "normal", maxSymbols: 24, concurrency: 4 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(configured, "watch"),
    { pressure: "watch", maxSymbols: 18, concurrency: 4 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(configured, "high"),
    { pressure: "high", maxSymbols: 12, concurrency: 2 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(configured, "critical"),
    { pressure: "critical", maxSymbols: 6, concurrency: 1 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(lowProfile, "watch"),
    { pressure: "watch", maxSymbols: 18, concurrency: 4 },
  );
});

test("signal monitor profile evaluations rotate through pressure-aware historical caps", () => {
  const configured = profile({
    maxSymbols: 250,
    evaluationConcurrency: 10,
  });

  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMonitorEvaluationProfile(
      configured,
      "normal",
    ),
    {
      pressure: "normal",
      capped: true,
      profile: {
        ...configured,
        maxSymbols: 60,
        evaluationConcurrency: 2,
      },
    },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMonitorEvaluationProfile(
      configured,
      "watch",
    ).profile,
    {
      ...configured,
      maxSymbols: 40,
      evaluationConcurrency: 1,
    },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMonitorEvaluationProfile(
      configured,
      "high",
    ).profile,
    {
      ...configured,
      maxSymbols: 20,
      evaluationConcurrency: 1,
    },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMonitorEvaluationProfile(
      configured,
      "critical",
    ).profile,
    {
      ...configured,
      maxSymbols: 8,
      evaluationConcurrency: 1,
    },
  );
});

test("explicit signal monitor symbol evaluations can bypass soft pressure caps", () => {
  const configured = profile({
    maxSymbols: 250,
    evaluationConcurrency: 10,
  });

  const capped =
    __signalMonitorInternalsForTests.resolveSignalMonitorProfileSymbolEvaluationSettings({
      profile: configured,
      maxSymbolsOverride: 90,
      pressureLevel: "critical",
    });
  const bypass =
    __signalMonitorInternalsForTests.resolveSignalMonitorProfileSymbolEvaluationSettings({
      profile: configured,
      maxSymbolsOverride: 90,
      pressureCapMode: "bypass-soft",
      evaluationConcurrencyOverride: 6,
      pressureLevel: "critical",
    });

  assert.equal(capped.profile.maxSymbols, 8);
  assert.equal(capped.profile.evaluationConcurrency, 1);
  assert.equal(bypass.profile.maxSymbols, 90);
  assert.equal(bypass.profile.evaluationConcurrency, 6);
  assert.equal(bypass.pressure, "critical");
  assert.equal(bypass.capped, false);
});

test("explicit signal monitor symbol batches keep requested order under caps", () => {
  const resolved =
    __signalMonitorInternalsForTests.resolveExplicitSignalMonitorSymbols({
      symbols: ["spy", "NVDA", "SPY", "AAPL", "MSFT"],
      maxSymbols: 3,
    });

  assert.deepEqual(resolved.symbols, ["SPY", "NVDA", "AAPL"]);
  assert.deepEqual(resolved.skippedSymbols, ["MSFT"]);
  assert.equal(resolved.truncated, true);
});

test("signal monitor evaluation batches rotate across all watchlist symbols", () => {
  const sourceSymbols = ["spy", "NVDA", "SPY", "AAPL", "MSFT", "TSLA"];
  const first =
    __signalMonitorInternalsForTests.resolveSignalMonitorEvaluationBatch({
      sourceSymbols,
      maxSymbols: 2,
      cursor: 0,
    });
  const second =
    __signalMonitorInternalsForTests.resolveSignalMonitorEvaluationBatch({
      sourceSymbols,
      maxSymbols: 2,
      cursor: first.nextCursor,
    });
  const third =
    __signalMonitorInternalsForTests.resolveSignalMonitorEvaluationBatch({
      sourceSymbols,
      maxSymbols: 2,
      cursor: second.nextCursor,
    });

  assert.deepEqual(first.symbols, ["SPY", "NVDA"]);
  assert.deepEqual(first.skippedSymbols, ["AAPL", "MSFT", "TSLA"]);
  assert.deepEqual(second.symbols, ["AAPL", "MSFT"]);
  assert.deepEqual(third.symbols, ["TSLA", "SPY"]);
  assert.equal(first.truncated, true);
});

test("signal matrix state returns neutral unavailable rows without persisting", () => {
  const state = evaluateSignalMonitorMatrixStateFromCompletedBars({
    profile: profile(),
    symbol: "AAPL",
    timeframe: "2m",
    evaluatedAt: new Date("2026-04-24T14:35:00.000Z"),
    completedBars: [],
  });

  assert.equal(state.symbol, "AAPL");
  assert.equal(state.timeframe, "2m");
  assert.equal(state.currentSignalDirection, null);
  assert.equal(state.status, "unavailable");
  assert.equal(state.active, true);
  assert.match(state.id, /profile-1:AAPL:2m/);
});

test("signal monitor all-watchlists scope evaluates the combined universe", () => {
  const result =
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists({
      profile: profile({
        watchlistId: "core",
        maxSymbols: 10,
        pyrusSignalsSettings: {
          __signalMonitorUniverseScope: "all_watchlists",
        },
      }),
      watchlists: [
        {
          id: "core",
          name: "Core",
          isDefault: true,
          updatedAt: baseDate,
          items: [{ symbol: "SPY" }, { symbol: "NVDA" }] as never,
        },
        {
          id: "research",
          name: "Research",
          isDefault: false,
          updatedAt: baseDate,
          items: [{ symbol: "PLTR" }, { symbol: "spy" }, { symbol: "IONQ" }] as never,
        },
      ],
    });

  assert.deepEqual(result.symbols, ["SPY", "NVDA", "PLTR", "IONQ"]);
  assert.deepEqual(result.watchlistSymbols, ["SPY", "NVDA", "PLTR", "IONQ"]);
  assert.deepEqual(result.skippedSymbols, []);
  assert.equal(result.truncated, false);
});

test("signal monitor state universe keeps all watchlist symbols outside max cap", () => {
  const result =
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists({
      profile: profile({
        watchlistId: "core",
        maxSymbols: 2,
        pyrusSignalsSettings: {
          __signalMonitorUniverseScope: "all_watchlists",
        },
      }),
      watchlists: [
        {
          id: "core",
          name: "Core",
          isDefault: true,
          updatedAt: baseDate,
          items: [{ symbol: "SPY" }, { symbol: "NVDA" }] as never,
        },
        {
          id: "research",
          name: "Research",
          isDefault: false,
          updatedAt: baseDate,
          items: [{ symbol: "AAPL" }, { symbol: "MSFT" }] as never,
        },
      ],
    });

  assert.deepEqual(result.symbols, ["SPY", "NVDA"]);
  assert.deepEqual(result.watchlistSymbols, ["SPY", "NVDA", "AAPL", "MSFT"]);
  assert.deepEqual(result.skippedSymbols, ["AAPL", "MSFT"]);
  assert.deepEqual(
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseSymbols(result),
    ["SPY", "NVDA", "AAPL", "MSFT"],
  );
  assert.equal(result.truncated, true);
});

test("signal monitor selected-watchlist scope stays on the configured watchlist", () => {
  const result =
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists({
      profile: profile({
        watchlistId: "core",
        maxSymbols: 10,
        pyrusSignalsSettings: {
          __signalMonitorUniverseScope: "selected_watchlist",
        },
      }),
      watchlists: [
        {
          id: "core",
          name: "Core",
          isDefault: true,
          updatedAt: baseDate,
          items: [{ symbol: "SPY" }, { symbol: "NVDA" }] as never,
        },
        {
          id: "research",
          name: "Research",
          isDefault: false,
          updatedAt: baseDate,
          items: [{ symbol: "PLTR" }, { symbol: "IONQ" }] as never,
        },
      ],
    });

  assert.deepEqual(result.symbols, ["SPY", "NVDA"]);
});

test("signal monitor default scope stays on all watchlists", () => {
  const result =
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists({
      profile: profile({
        watchlistId: "core",
        maxSymbols: 6,
      }),
      watchlists: [
        {
          id: "core",
          name: "Core",
          isDefault: true,
          updatedAt: baseDate,
          items: [{ symbol: "SPY" }, { symbol: "NVDA" }] as never,
        },
        {
          id: "research",
          name: "Research",
          isDefault: false,
          updatedAt: baseDate,
          items: [{ symbol: "PLTR" }, { symbol: "spy" }] as never,
        },
      ],
      expansionUniverse: {
        symbols: ["AAPL", "MSFT", "NVDA", "TSLA", "AMD"],
        fallbackUsed: false,
        degradedReason: null,
        rankedAt: baseDate,
      },
    });

  assert.deepEqual(result.symbols, ["SPY", "NVDA", "PLTR"]);
  assert.deepEqual(result.skippedSymbols, []);
  assert.equal(result.universe.configuredMaxSymbols, 6);
  assert.equal(result.universe.pinnedSymbols, 3);
  assert.equal(result.universe.expansionSymbols, 0);
  assert.equal(result.universe.shortfall, 3);
  assert.equal(result.universe.source, "all_watchlists");
});

test("signal monitor explicit expansion scope adds ranked universe symbols", () => {
  const result =
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists({
      profile: profile({
        watchlistId: "core",
        maxSymbols: 6,
        pyrusSignalsSettings: {
          __signalMonitorUniverseScope: "all_watchlists_plus_universe",
        },
      }),
      watchlists: [
        {
          id: "core",
          name: "Core",
          isDefault: true,
          updatedAt: baseDate,
          items: [{ symbol: "SPY" }, { symbol: "NVDA" }] as never,
        },
        {
          id: "research",
          name: "Research",
          isDefault: false,
          updatedAt: baseDate,
          items: [{ symbol: "PLTR" }, { symbol: "spy" }] as never,
        },
      ],
      expansionUniverse: {
        symbols: ["AAPL", "MSFT", "NVDA", "TSLA", "AMD"],
        fallbackUsed: false,
        degradedReason: null,
        rankedAt: baseDate,
      },
    });

  assert.deepEqual(result.symbols, ["SPY", "NVDA", "PLTR", "AAPL", "MSFT", "TSLA"]);
  assert.deepEqual(result.skippedSymbols, ["AMD"]);
  assert.deepEqual(
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseSymbols(result),
    ["SPY", "NVDA", "PLTR", "AAPL", "MSFT", "TSLA", "AMD"],
  );
  assert.equal(result.universe.configuredMaxSymbols, 6);
  assert.equal(result.universe.pinnedSymbols, 3);
  assert.equal(result.universe.expansionSymbols, 3);
  assert.equal(result.universe.shortfall, 0);
  assert.equal(result.universe.source, "watchlists_plus_ranked_universe");
});

test("signal monitor marks built-in fallback universes as non-authoritative", () => {
  const result =
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists({
      profile: profile({
        maxSymbols: 10,
        pyrusSignalsSettings: {
          __signalMonitorUniverseScope: "all_watchlists",
        },
      }),
      watchlists: [
        {
          id: "built-in-core",
          name: "Core",
          isDefault: true,
          updatedAt: baseDate,
          items: [{ symbol: "SPY" }, { symbol: "NVDA" }] as never,
        },
      ],
    });

  assert.deepEqual(result.symbols, ["SPY", "NVDA"]);
  assert.equal(result.fallbackWatchlists, true);
});

test("signal monitor state hydration is scoped to the profile timeframe", () => {
  const source = readFileSync(new URL("./signal-monitor.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function readSignalMonitorStateFresh");
  const end = source.indexOf("type SignalMonitorStateReadResult", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.match(
    block,
    /eq\(signalMonitorSymbolStatesTable\.timeframe,\s*timeframe\)/,
  );
  assert.match(
    block,
    /const timeframe = resolveSignalMonitorTimeframe\(hydratedProfile\.timeframe\)/,
  );
  assert.match(block, /watchlistSymbols/);
  assert.match(block, /currentUniverseSymbols\.has\(symbol\)/);
  assert.match(block, /isSignalMonitorStateCurrentForLane/);
});

test("signal monitor state route opts into stale-fast cache metadata", () => {
  const routeSource = readFileSync(
    new URL("../routes/signal-monitor.ts", import.meta.url),
    "utf8",
  );
  const zodSource = readFileSync(
    new URL("../../../../lib/api-zod/src/generated/api.ts", import.meta.url),
    "utf8",
  );
  const start = zodSource.indexOf("export const GetSignalMonitorStateResponse");
  const end = zodSource.indexOf("/**", start + 1);
  const block = zodSource.slice(start, end);

  assert.match(routeSource, /staleFast:\s*true/);
  assert.match(block, /"cacheStatus"/);
  assert.match(block, /"refreshing"/);
  assert.match(block, /"servedAt"/);
  assert.match(block, /"stateSource"/);
  assert.match(block, /"universeSymbols":\s*zod\.array\(zod\.string\(\)\)/);
});

test("signal monitor lane recency rejects stale persisted fresh rows", () => {
  const evaluatedAt = new Date("2026-05-26T17:50:00.000Z");

  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorStateCurrentForLane({
      state: {
        status: "ok",
        latestBarAt: new Date("2026-05-26T17:45:00.000Z"),
        lastEvaluatedAt: new Date("2026-05-26T17:45:05.000Z"),
      } as never,
      timeframe: "5m",
      evaluatedAt,
    }),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorStateCurrentForLane({
      state: {
        status: "ok",
        latestBarAt: new Date("2026-05-22T19:55:00.000Z"),
        lastEvaluatedAt: new Date("2026-05-25T01:38:15.743Z"),
      } as never,
      timeframe: "5m",
      evaluatedAt,
    }),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorStateCurrentForLane({
      state: {
        status: "stale",
        latestBarAt: new Date("2026-05-26T17:45:00.000Z"),
        lastEvaluatedAt: new Date("2026-05-26T17:45:05.000Z"),
      } as never,
      timeframe: "5m",
      evaluatedAt,
    }),
    false,
  );
});

test("signal monitor capped evaluation preserves skipped all-watchlist rows", () => {
  const source = readFileSync(new URL("./signal-monitor.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function evaluateSignalMonitorProfileUniverse");
  const end = source.indexOf("function resolveSignalMonitorMatrixSymbols", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.match(
    block,
    /ne\(signalMonitorSymbolStatesTable\.timeframe,\s*timeframe\)/,
  );
  assert.match(block, /universe\.watchlistSymbols/);
  assert.match(block, /resolveSignalMonitorEvaluationBatch/);
  assert.match(block, /!evaluationSettings\.capped/);
  assert.match(block, /!resolvedBatch\.truncated/);
});

test("signal matrix cache serves stale data while a refresh is in flight", async () => {
  const key = "signal-matrix:unit";
  const staleValue = { states: [{ symbol: "SPY" }], evaluatedAt: "old" };
  let resolveRefresh: (value: unknown) => void = () => {};
  let calls = 0;
  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache();
  __signalMonitorInternalsForTests.seedSignalMonitorMatrixCache(key, staleValue, {
    freshUntil: 1_000,
    staleUntil: 20_000,
  });

  const result = await __signalMonitorInternalsForTests.withSignalMonitorMatrixEvaluationCache(
    key,
    async () => {
      calls += 1;
      return await new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    },
    { nowMs: 2_000 },
  );

  assert.equal(result, staleValue);
  assert.equal(calls, 1);
  resolveRefresh({ states: [{ symbol: "QQQ" }], evaluatedAt: "new" });
  await new Promise((resolve) => setImmediate(resolve));
  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache();
});

test("signal matrix automatic request marker debounces reconnect duplicates only", () => {
  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache();

  assert.deepEqual(
    __signalMonitorInternalsForTests.markAutomaticSignalMonitorMatrixRequest(
      "signal-matrix:paper:unit",
      { clientRole: "leader", requestOrigin: "startup" },
      1_000,
    ),
    { automatic: true, debounced: false },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.markAutomaticSignalMonitorMatrixRequest(
      "signal-matrix:paper:unit",
      { clientRole: "leader", requestOrigin: "poll" },
      2_000,
    ),
    { automatic: true, debounced: true },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.markAutomaticSignalMonitorMatrixRequest(
      "signal-matrix:paper:unit",
      { clientRole: "manual", requestOrigin: "manual" },
      2_100,
    ),
    { automatic: false, debounced: false },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.markAutomaticSignalMonitorMatrixRequest(
      "signal-matrix:paper:unit",
      { clientRole: "test", requestOrigin: "test" },
      2_200,
    ),
    { automatic: false, debounced: false },
  );

  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache();
});

test("signal matrix follower startup and poll requests are cache-only", () => {
  assert.equal(
    __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly({
      clientRole: "follower",
      requestOrigin: "startup",
    }),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly({
      clientRole: "follower",
      requestOrigin: "poll",
    }),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly({
      clientRole: "leader",
      requestOrigin: "poll",
    }),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly({
      clientRole: "manual",
      requestOrigin: "manual",
    }),
    false,
  );
});

test("signal matrix automatic debounce can reuse stale cache without refreshing", () => {
  const key = "signal-matrix:paper:debounced-cache";
  const staleValue = { states: [{ symbol: "SPY" }], evaluatedAt: "old" };
  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache();
  __signalMonitorInternalsForTests.seedSignalMonitorMatrixCache(key, staleValue, {
    freshUntil: 1_000,
    staleUntil: 20_000,
  });

  assert.deepEqual(
    __signalMonitorInternalsForTests.getDebouncedSignalMonitorMatrixCacheValue(
      key,
      2_000,
    ),
    { value: staleValue, cacheStatus: "stale" },
  );
  assert.equal(
    __signalMonitorInternalsForTests.getDebouncedSignalMonitorMatrixCacheValue(
      key,
      21_000,
    ),
    null,
  );

  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache();
});

test("signal matrix environment clear removes source-strategy cache and automatic markers", () => {
  const key = "signal-matrix:native_timeframes:paper:profile:default:SPY:2m:1:normal:3:{}";
  const staleValue = { states: [{ symbol: "SPY" }], evaluatedAt: "old" };
  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache();
  __signalMonitorInternalsForTests.seedSignalMonitorMatrixCache(key, staleValue, {
    freshUntil: 1_000,
    staleUntil: 20_000,
  });
  assert.deepEqual(
    __signalMonitorInternalsForTests.markAutomaticSignalMonitorMatrixRequest(
      key,
      { clientRole: "leader", requestOrigin: "startup" },
      1_000,
    ),
    { automatic: true, debounced: false },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.getDebouncedSignalMonitorMatrixCacheValue(
      key,
      2_000,
    ),
    { value: staleValue, cacheStatus: "stale" },
  );

  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache("paper");

  assert.equal(
    __signalMonitorInternalsForTests.getDebouncedSignalMonitorMatrixCacheValue(
      key,
      2_000,
    ),
    null,
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.markAutomaticSignalMonitorMatrixRequest(
      key,
      { clientRole: "leader", requestOrigin: "poll" },
      2_100,
    ),
    { automatic: true, debounced: false },
  );

  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache();
});

test("signal monitor DB fallback profile is visibly degraded", () => {
  const profile = buildSignalMonitorDbUnavailableProfile(
    "live",
    new Date("2026-05-07T15:45:00.000Z"),
  );

  assert.equal(profile.id, "db-unavailable-live");
  assert.equal(profile.environment, "live");
  assert.equal(profile.enabled, false);
  assert.match(profile.lastError || "", /Postgres is unavailable/);
  assert.equal(profile.lastEvaluatedAt, null);
});

test("signal monitor DB unavailable error is a visible retryable 503", () => {
  const cause = new Error("Connection terminated due to connection timeout");
  const error = createSignalMonitorDbUnavailableError(cause);

  assert.equal(error.statusCode, 503);
  assert.equal(error.code, "signal_monitor_db_unavailable");
  assert.equal(error.expose, true);
  assert.match(error.detail || "", /Retry after Postgres connectivity recovers/);
  assert.equal((error as Error & { cause?: unknown }).cause, cause);
});
