import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SignalMonitorProfileRow } from "./signal-monitor";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

const signalMonitorModule = await import("./signal-monitor");
const {
  __signalMonitorInternalsForTests,
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
    rayReplicaSettings: {},
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
    });
  const keyB =
    __signalMonitorInternalsForTests.buildSignalMonitorCompletedBarsCacheKey({
      symbol: "SPY",
      timeframe: "5m",
      providerTimeframe: "5m",
      providerLimit: 120,
      completedLimit: 120,
      queryTo: new Date("2026-04-24T14:35:00.000Z"),
    });

  assert.equal(keyA, keyB);
});

test("signal monitor matrix bars use the priority-aware bars lane", () => {
  const source = readFileSync(new URL("./signal-monitor.ts", import.meta.url), "utf8");
  const loadBlock = source.match(
    /export async function loadSignalMonitorCompletedBars[\s\S]*?export async function evaluateSignalMonitorSymbolFromCompletedBars/,
  )?.[0];

  assert.match(source, /getBarsWithDebug/);
  assert.match(source, /const SIGNAL_MONITOR_BARS_PRIORITY = 4;/);
  assert.match(source, /const SIGNAL_MONITOR_BARS_FAMILY = "signal-matrix";/);
  assert.match(loadBlock ?? "", /priority:\s*SIGNAL_MONITOR_BARS_PRIORITY/);
  assert.match(loadBlock ?? "", /family:\s*SIGNAL_MONITOR_BARS_FAMILY/);
  assert.match(loadBlock ?? "", /readSignalMonitorCompletedBarsCache/);
  assert.match(loadBlock ?? "", /signalMonitorCompletedBarsInFlight/);
});

test("signal monitor matrix caps server work under API resource pressure", () => {
  const configured = profile({
    maxSymbols: 250,
    evaluationConcurrency: 10,
  });

  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(configured, "normal"),
    { pressure: "normal", maxSymbols: 250, concurrency: 10 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(configured, "watch"),
    { pressure: "watch", maxSymbols: 96, concurrency: 2 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(configured, "high"),
    { pressure: "high", maxSymbols: 32, concurrency: 1 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(configured, "critical"),
    { pressure: "critical", maxSymbols: 8, concurrency: 1 },
  );
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
        rayReplicaSettings: {
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
  assert.deepEqual(result.skippedSymbols, []);
  assert.equal(result.truncated, false);
});

test("signal monitor selected-watchlist scope stays on the configured watchlist", () => {
  const result =
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists({
      profile: profile({
        watchlistId: "core",
        maxSymbols: 10,
        rayReplicaSettings: {
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

test("signal monitor default scope expands watchlists with ranked universe symbols", () => {
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

  assert.deepEqual(result.symbols, ["SPY", "NVDA", "PLTR", "AAPL", "MSFT", "TSLA"]);
  assert.deepEqual(result.skippedSymbols, ["AMD"]);
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
        rayReplicaSettings: {
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
  const start = source.indexOf("export async function getSignalMonitorState");
  const end = source.indexOf("export async function evaluateSignalMonitor", start);
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
});

test("signal monitor full evaluation deactivates stale timeframe rows", () => {
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
