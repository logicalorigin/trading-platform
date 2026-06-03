import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SignalMonitorProfileRow } from "./signal-monitor";
import {
  __resetApiResourcePressureForTests,
  resolveApiRssPressureThresholds,
  updateApiResourcePressure,
} from "./resource-pressure";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

const signalMonitorModule = await import("./signal-monitor");
const {
  __signalMonitorInternalsForTests,
  aggregateCompletedFiveMinuteBars,
  aggregateCompletedMinuteBars,
  buildSignalMonitorDbUnavailableProfile,
  createSignalMonitorDbUnavailableError,
  evaluateSignalMonitorMatrixStateFromCompletedBars,
  isSignalMonitorBarComplete,
  signalMonitorCompletedBarsQueryTo,
} = signalMonitorModule;

const baseDate = new Date("2026-04-24T14:30:00.000Z");

test("signal monitor profile evaluations notify stored state refreshes", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
  const metadataBlock =
    source.match(
      /export async function updateSignalMonitorProfileEvaluationMetadata[\s\S]*?\n}\n\nexport async function evaluateSignalMonitorProfileUniverse/,
    )?.[0] ?? "";

  assert.match(metadataBlock, /notifyAlgoCockpitChanged/);
  assert.match(metadataBlock, /reason:\s*"signal_monitor_state_refreshed"/);
});

test("signal monitor stored state preserves precise event signal time", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
  const eventKey = __signalMonitorInternalsForTests.buildSignalMonitorEventKey({
    profileId: "a5721cf5-16e1-4221-81d1-f2064e997d98",
    symbol: "mu",
    timeframe: "5m",
    direction: "buy",
    signalBarAt: new Date("2026-06-03T18:05:00.000Z"),
  });
  const upsertBlock =
    source.match(
      /async function upsertSymbolState[\s\S]*?\n}\n\nasync function resolveStoredSignalMonitorSignalAt/,
    )?.[0] ?? "";
  const resolverBlock =
    source.match(
      /async function resolveStoredSignalMonitorSignalAt[\s\S]*?\n}\n\nexport async function getLatestCompletedSignalMonitorBarAt/,
    )?.[0] ?? "";

  assert.equal(
    eventKey,
    "a5721cf5-16e1-4221-81d1-f2064e997d98:MU:5m:buy:1780509900",
  );
  assert.match(upsertBlock, /const currentSignalAt = await resolveStoredSignalMonitorSignalAt\(input\)/);
  assert.match(upsertBlock, /currentSignalAt,/);
  assert.match(resolverBlock, /signalMonitorEventsTable\.eventKey/);
  assert.match(resolverBlock, /return event\?\.signalAt \?\? input\.signalAt/);
});

function profile(
  patch: Partial<SignalMonitorProfileRow> = {},
): SignalMonitorProfileRow {
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

function minuteBars(count: number) {
  const start = Date.parse("2026-04-24T13:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + index * 0.15;
    const close = open + 0.08;
    return {
      timestamp: new Date(start + index * 60_000),
      open,
      high: close + 0.3,
      low: open - 0.3,
      close,
      volume: 1_000 + index * 5,
      partial: false,
    };
  });
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

  const snapshot = __signalMonitorInternalsForTests.stateToResponseForSnapshot(
    state,
    {
      timeframe: "5m",
      evaluatedAt: new Date("2026-04-24T16:00:00.000Z"),
      markNonCurrentStale: true,
    },
  );

  assert.equal(snapshot.currentSignalDirection, null);
  assert.equal(snapshot.currentSignalAt, null);
  assert.equal(snapshot.currentSignalPrice, null);
  assert.equal(snapshot.barsSinceSignal, null);
  assert.equal(snapshot.fresh, false);
  assert.equal(snapshot.status, "stale");
  assert.match(snapshot.lastError ?? "", /persisted state/);
});

test("stored signal monitor matrix snapshots preserve the 2m timeframe", () => {
  const state = {
    id: "state-2m",
    profileId: "profile-1",
    symbol: "SPY",
    timeframe: "2m",
    currentSignalDirection: null,
    currentSignalAt: null,
    currentSignalPrice: null,
    latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
    barsSinceSignal: null,
    fresh: false,
    status: "ok",
    active: true,
    lastEvaluatedAt: new Date("2026-04-24T14:31:00.000Z"),
    lastError: null,
  } as never;

  const snapshot = __signalMonitorInternalsForTests.stateToResponseForSnapshot(
    state,
    {
      timeframe: "2m",
      evaluatedAt: new Date("2026-04-24T14:31:00.000Z"),
      markNonCurrentStale: true,
    },
  );

  assert.equal(snapshot.timeframe, "2m");
  assert.equal(snapshot.status, "ok");
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
    [bar("30", 100, 101), bar("32", 103, 102), bar("33", 102, 104)] as never,
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

test("signal monitor live-edge bars roll up stock aggregate stream minutes", () => {
  const start = Date.parse("2026-04-24T14:30:00.000Z");
  const aggregates = Array.from({ length: 5 }, (_, index) => {
    const open = 100 + index;
    const close = open + 0.5;
    const startMs = start + index * 60_000;
    return {
      eventType: "AM",
      symbol: "SPY",
      open,
      high: close + 1,
      low: open - 1,
      close,
      volume: 100 + index,
      accumulatedVolume: null,
      vwap: null,
      sessionVwap: null,
      officialOpen: null,
      averageTradeSize: null,
      startMs,
      endMs: startMs + 59_999,
      delayed: false,
      source: "massive-websocket",
    };
  });

  const bars =
    __signalMonitorInternalsForTests.aggregateStockMinuteAggregatesForSignalMonitorBars(
      {
        aggregates: aggregates as never,
        timeframe: "5m",
        evaluatedAt: new Date("2026-04-24T14:35:02.000Z"),
        limit: 10,
      },
    );

  assert.equal(bars.length, 1);
  assert.deepEqual(
    bars.map((item) => ({
      timestamp: item.timestamp,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
      source: item.source,
      delayed: item.delayed,
      freshness: item.freshness,
    })),
    [
      {
        timestamp: new Date("2026-04-24T14:30:00.000Z"),
        open: 100,
        high: 105.5,
        low: 99,
        close: 104.5,
        volume: 510,
        source: "massive-websocket",
        delayed: false,
        freshness: "live",
      },
    ],
  );
});

test("signal monitor live-edge bars can include the current forming timeframe bar", () => {
  const start = Date.parse("2026-04-24T14:30:00.000Z");
  const aggregates = [0, 1].map((index) => {
    const open = 100 + index;
    const close = open + 0.5;
    const startMs = start + index * 60_000;
    return {
      eventType: "AM",
      symbol: "SPY",
      open,
      high: close + 1,
      low: open - 1,
      close,
      volume: 100 + index,
      accumulatedVolume: null,
      vwap: null,
      sessionVwap: null,
      officialOpen: null,
      averageTradeSize: null,
      startMs,
      endMs: startMs + 59_999,
      delayed: false,
      source: "massive-websocket",
    };
  });
  const evaluatedAt = new Date("2026-04-24T14:31:30.000Z");

  const completedOnly =
    __signalMonitorInternalsForTests.aggregateStockMinuteAggregatesForSignalMonitorBars(
      {
        aggregates: aggregates as never,
        timeframe: "5m",
        evaluatedAt,
        limit: 10,
      },
    );
  const provisional =
    __signalMonitorInternalsForTests.aggregateStockMinuteAggregatesForSignalMonitorBars(
      {
        aggregates: aggregates as never,
        timeframe: "5m",
        evaluatedAt,
        limit: 10,
        includeProvisional: true,
      },
    );

  assert.equal(completedOnly.length, 0);
  assert.equal(provisional.length, 1);
  assert.equal(
    provisional[0]?.timestamp.toISOString(),
    "2026-04-24T14:30:00.000Z",
  );
  assert.equal(provisional[0]?.partial, true);
  assert.equal(provisional[0]?.close, 101.5);
  assert.equal(
    provisional[0]?.dataUpdatedAt?.toISOString(),
    "2026-04-24T14:31:30.000Z",
  );
});

test("signal monitor aggregate merge prefers current Massive snapshots over history", () => {
  const startMs = Date.parse("2026-04-24T14:35:00.000Z");
  const history = {
    eventType: "AM",
    symbol: "SPY",
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 100,
    accumulatedVolume: null,
    vwap: null,
    sessionVwap: null,
    officialOpen: null,
    averageTradeSize: null,
    startMs,
    endMs: startMs + 59_999,
    delayed: false,
    source: "massive-websocket",
  };
  const current = {
    ...history,
    close: 102.25,
    high: 102.5,
    volume: 175,
  };

  const merged =
    __signalMonitorInternalsForTests.mergeSignalMonitorStockMinuteAggregates(
      [history, current] as never,
      10,
    );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.close, 102.25);
  assert.equal(merged[0]?.volume, 175);
});

test("signal monitor matrix coverage counts stale interval states as hydrated", () => {
  const value =
    __signalMonitorInternalsForTests.withSignalMonitorMatrixMetadata(
      {
        profile: profile(),
        states: ["1m", "2m", "5m", "15m", "1h"].map((timeframe) => ({
          symbol: "GLD",
          timeframe,
          latestBarAt: new Date("2026-06-01T23:55:00.000Z"),
          currentSignalAt: null,
          status: "stale",
          active: true,
        })),
        evaluatedAt: new Date("2026-06-02T01:03:00.000Z"),
        timeframes: ["1m", "2m", "5m", "15m", "1h"] as const,
        skippedSymbols: [],
        truncated: false,
        sourceRequestCount: 5,
      },
      {
        cacheStatus: "miss",
        requestedSymbols: ["GLD"],
        totalSymbols: 1,
        taskCount: 5,
        startedAt: Date.now(),
      },
    );

  assert.equal(value.coverage.hydratedSymbols, 1);
  assert.equal(value.coverage.missingSymbols, 0);
});

test("signal monitor matrix coverage counts settled unavailable states as evaluated", () => {
  const value =
    __signalMonitorInternalsForTests.withSignalMonitorMatrixMetadata(
      {
        profile: profile(),
        states: [
          {
            symbol: "CEG",
            timeframe: "1h",
            latestBarAt: null,
            currentSignalAt: null,
            lastEvaluatedAt: new Date("2026-06-02T01:20:00.000Z"),
            status: "unavailable",
            active: true,
            lastError: "No broker history bars were available for this symbol.",
          },
        ],
        evaluatedAt: new Date("2026-06-02T01:21:00.000Z"),
        timeframes: ["1h"] as const,
        skippedSymbols: [],
        truncated: false,
        sourceRequestCount: 1,
      },
      {
        cacheStatus: "miss",
        requestedSymbols: ["CEG"],
        requestedCells: [{ symbol: "CEG", timeframe: "1h" }],
        totalSymbols: 1,
        taskCount: 1,
        startedAt: Date.now(),
      },
    );

  assert.equal(value.coverage.hydratedSymbols, 1);
  assert.equal(value.coverage.missingSymbols, 0);
});

test("signal monitor matrix exact cells canonicalize and enforce pressure caps", () => {
  const resolved =
    __signalMonitorInternalsForTests.resolveSignalMonitorMatrixExactCells({
      cells: [
        { symbol: " spy ", timeframe: "5m" },
        { symbol: "SPY", timeframe: "5m" },
        { symbol: "qqq", timeframe: "1m" },
        { symbol: "ignored", timeframe: "bogus" },
      ] as never,
      allowedSymbols: ["SPY", "QQQ"],
      pressure: "normal",
    });

  assert.equal(resolved.exact, true);
  assert.deepEqual(resolved.cells, [
    { symbol: "QQQ", timeframe: "1m" },
    { symbol: "SPY", timeframe: "5m" },
  ]);
  assert.deepEqual(resolved.timeframes, ["1m", "5m"]);
  assert.equal(resolved.cacheKeyPart, "QQQ:1m,SPY:5m");

  assert.throws(
    () =>
      __signalMonitorInternalsForTests.resolveSignalMonitorMatrixExactCells({
        cells: Array.from({ length: 21 }, (_value, index) => ({
          symbol: `SYM${index}`,
          timeframe: "1m",
        })),
        allowedSymbols: Array.from({ length: 21 }, (_value, index) => `SYM${index}`),
        pressure: "high",
      }),
    (error) =>
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      (error as { statusCode?: number }).statusCode === 400,
  );
});

test("signal monitor matrix exact cells narrow coverage metadata", () => {
  const value =
    __signalMonitorInternalsForTests.withSignalMonitorMatrixMetadata(
      {
        profile: profile(),
        states: [
          {
            symbol: "GLD",
            timeframe: "1m",
            latestBarAt: new Date("2026-06-02T01:20:00.000Z"),
            currentSignalAt: null,
            status: "ok",
            active: true,
          },
          {
            symbol: "GLD",
            timeframe: "5m",
            latestBarAt: new Date("2026-06-02T01:20:00.000Z"),
            currentSignalAt: null,
            status: "ok",
            active: true,
          },
        ],
        evaluatedAt: new Date("2026-06-02T01:21:00.000Z"),
        timeframes: ["1m", "5m"] as const,
        skippedSymbols: [],
        truncated: false,
        sourceRequestCount: 1,
      },
      {
        cacheStatus: "miss",
        requestedSymbols: ["GLD"],
        requestedCells: [{ symbol: "GLD", timeframe: "5m" }],
        totalSymbols: 1,
        taskCount: 1,
        startedAt: Date.now(),
      },
    );

  assert.equal(value.coverage.taskCount, 1);
  assert.equal(value.coverage.timeframes, 2);
  assert.equal(value.coverage.hydratedSymbols, 1);
  assert.equal(value.coverage.missingSymbols, 0);
});

test("signal monitor matrix persists clean usable current and stale matrix cells", () => {
  const cleanState = {
    id: "matrix-GLD-2m",
    profileId: "profile-1",
    symbol: "GLD",
    timeframe: "2m",
    currentSignalDirection: null,
    currentSignalAt: null,
    currentSignalPrice: null,
    latestBarAt: new Date("2026-06-02T01:20:00.000Z"),
    barsSinceSignal: null,
    fresh: false,
    status: "ok",
    active: true,
    lastEvaluatedAt: new Date("2026-06-02T01:20:45.000Z"),
    lastError: null,
    indicatorSnapshot: null,
  };

  assert.equal(
    __signalMonitorInternalsForTests.shouldPersistSignalMonitorMatrixState(
      cleanState as never,
    ),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldPersistSignalMonitorMatrixState({
      ...cleanState,
      status: "stale",
      currentSignalDirection: null,
      currentSignalAt: null,
      currentSignalPrice: null,
      barsSinceSignal: null,
      fresh: false,
    } as never),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldPersistSignalMonitorMatrixState({
      ...cleanState,
      status: "error",
      lastError: "Signal monitor matrix bar load timed out.",
    } as never),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldPersistSignalMonitorMatrixState({
      ...cleanState,
      status: "ok",
      lastError: "Latest signal monitor bar is delayed.",
    } as never),
    false,
  );
});

test("automatic signal matrix requests can fast-return stored states", () => {
  assert.equal(
    __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromStoredStateFast(
      {
        clientRole: "leader",
        requestOrigin: "startup",
        states: [{ symbol: "SPY", timeframe: "5m" }],
      },
    ),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromStoredStateFast(
      {
        clientRole: "manual",
        requestOrigin: "manual",
        states: [{ symbol: "SPY", timeframe: "5m" }],
      },
    ),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromStoredStateFast(
      {
        clientRole: "leader",
        requestOrigin: "startup",
        states: [],
      },
    ),
    false,
  );
});

test("signal monitor matrix hydrates requested timeframe from current stored state", () => {
  const value =
    __signalMonitorInternalsForTests.hydrateSignalMonitorMatrixStatesFromStoredStates(
      {
        states: [
          {
            id: "matrix-GLD-5m",
            profileId: "profile-1",
            symbol: "GLD",
            timeframe: "5m",
            currentSignalDirection: null,
            currentSignalAt: null,
            currentSignalPrice: null,
            latestBarAt: new Date("2026-06-01T23:55:00.000Z"),
            barsSinceSignal: null,
            fresh: false,
            status: "stale",
            active: true,
            lastEvaluatedAt: new Date("2026-06-02T01:20:00.000Z"),
            lastError: null,
            indicatorSnapshot: null,
          },
        ],
        timeframes: ["1m", "2m", "5m", "15m", "1h"] as const,
      },
      {
        requestedSymbols: ["GLD"],
        storedStates: [
          {
            id: "state-GLD-5m",
            profileId: "profile-1",
            symbol: "GLD",
            timeframe: "5m",
            currentSignalDirection: "sell",
            currentSignalAt: new Date("2026-06-02T01:15:00.000Z"),
            currentSignalPrice: 412.8,
            latestBarAt: new Date("2026-06-02T01:15:00.000Z"),
            barsSinceSignal: 1,
            fresh: true,
            status: "ok",
            active: true,
            lastEvaluatedAt: new Date("2026-06-02T01:20:45.000Z"),
            lastError: null,
          },
        ] as never,
      },
    );

  const fiveMinute = value.states.find(
    (state) => state.symbol === "GLD" && state.timeframe === "5m",
  );
  assert.equal(fiveMinute?.id, "state-GLD-5m");
  assert.equal(fiveMinute?.status, "ok");
  assert.equal(fiveMinute?.currentSignalDirection, "sell");
  assert.equal(
    fiveMinute?.latestBarAt?.toISOString(),
    "2026-06-02T01:15:00.000Z",
  );
});

test("signal monitor matrix stored hydration filters to requested exact cells", () => {
  const value =
    __signalMonitorInternalsForTests.hydrateSignalMonitorMatrixStatesFromStoredStates(
      {
        states: [],
        timeframes: ["1m", "5m"] as const,
      },
      {
        requestedSymbols: ["GLD"],
        requestedCells: [{ symbol: "GLD", timeframe: "5m" }],
        storedStates: [
          {
            id: "state-GLD-1m",
            profileId: "profile-1",
            symbol: "GLD",
            timeframe: "1m",
            currentSignalDirection: "buy",
            currentSignalAt: new Date("2026-06-02T01:19:00.000Z"),
            currentSignalPrice: 413,
            latestBarAt: new Date("2026-06-02T01:19:00.000Z"),
            barsSinceSignal: 0,
            fresh: true,
            status: "ok",
            active: true,
            lastEvaluatedAt: new Date("2026-06-02T01:19:30.000Z"),
            lastError: null,
          },
          {
            id: "state-GLD-5m",
            profileId: "profile-1",
            symbol: "GLD",
            timeframe: "5m",
            currentSignalDirection: "sell",
            currentSignalAt: new Date("2026-06-02T01:15:00.000Z"),
            currentSignalPrice: 412.8,
            latestBarAt: new Date("2026-06-02T01:15:00.000Z"),
            barsSinceSignal: 1,
            fresh: true,
            status: "ok",
            active: true,
            lastEvaluatedAt: new Date("2026-06-02T01:20:45.000Z"),
            lastError: null,
          },
        ] as never,
      },
    );

  assert.deepEqual(
    (value.states as Array<{ symbol: string; timeframe: string }>).map(
      (state) => `${state.symbol}:${state.timeframe}`,
    ),
    ["GLD:5m"],
  );
});

test("signal monitor matrix keeps newer current matrix state over stored hydration", () => {
  const value =
    __signalMonitorInternalsForTests.hydrateSignalMonitorMatrixStatesFromStoredStates(
      {
        states: [
          {
            id: "matrix-GLD-5m",
            profileId: "profile-1",
            symbol: "GLD",
            timeframe: "5m",
            currentSignalDirection: "buy",
            currentSignalAt: new Date("2026-06-02T01:20:00.000Z"),
            currentSignalPrice: 413.1,
            latestBarAt: new Date("2026-06-02T01:20:00.000Z"),
            barsSinceSignal: 0,
            fresh: true,
            status: "ok",
            active: true,
            lastEvaluatedAt: new Date("2026-06-02T01:21:00.000Z"),
            lastError: null,
            indicatorSnapshot: null,
          },
        ],
        timeframes: ["1m", "2m", "5m", "15m", "1h"] as const,
      },
      {
        requestedSymbols: ["GLD"],
        storedStates: [
          {
            id: "state-GLD-5m",
            profileId: "profile-1",
            symbol: "GLD",
            timeframe: "5m",
            currentSignalDirection: "sell",
            currentSignalAt: new Date("2026-06-02T01:15:00.000Z"),
            currentSignalPrice: 412.8,
            latestBarAt: new Date("2026-06-02T01:15:00.000Z"),
            barsSinceSignal: 1,
            fresh: false,
            status: "ok",
            active: true,
            lastEvaluatedAt: new Date("2026-06-02T01:20:45.000Z"),
            lastError: null,
          },
        ] as never,
      },
    );

  assert.equal(value.states[0]?.id, "matrix-GLD-5m");
  assert.equal(value.states[0]?.currentSignalDirection, "buy");
});

test("signal monitor matrix renders clean stale stored cells while refresh is pending", () => {
  const value =
    __signalMonitorInternalsForTests.hydrateSignalMonitorMatrixStatesFromStoredStates(
      {
        states: [],
        timeframes: ["5m"] as const,
      },
      {
        requestedSymbols: ["GLD"],
        storedStates: [
          {
            id: "state-GLD-5m",
            profileId: "profile-1",
            symbol: "GLD",
            timeframe: "5m",
            currentSignalDirection: null,
            currentSignalAt: null,
            currentSignalPrice: null,
            latestBarAt: "2026-06-02T14:00:00.000Z",
            barsSinceSignal: null,
            fresh: false,
            status: "stale",
            active: true,
            lastEvaluatedAt: "2026-06-02T14:01:00.000Z",
            lastError: null,
          },
        ] as never,
      },
    );

  assert.equal(value.states.length, 1);
  const state = value.states[0] as
    | { symbol?: string; timeframe?: string; status?: string }
    | undefined;
  assert.equal(state?.symbol, "GLD");
  assert.equal(state?.timeframe, "5m");
  assert.equal(state?.status, "stale");
});

test("signal monitor bar queries are scoped to the latest completed boundary", () => {
  assert.equal(
    signalMonitorCompletedBarsQueryTo({
      timeframe: "5m",
      evaluatedAt: new Date("2026-04-24T14:34:59.999Z"),
    }).toISOString(),
    "2026-04-24T14:30:00.000Z",
  );
  assert.equal(
    signalMonitorCompletedBarsQueryTo({
      timeframe: "5m",
      evaluatedAt: new Date("2026-04-24T14:35:00.000Z"),
    }).toISOString(),
    "2026-04-24T14:35:00.000Z",
  );
  assert.equal(
    signalMonitorCompletedBarsQueryTo({
      timeframe: "1m",
      evaluatedAt: new Date("2026-04-24T14:35:00.000Z"),
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

test("signal monitor matrix bars do not force a zero broker recent window", () => {
  const resolveWindow =
    __signalMonitorInternalsForTests.resolveSignalMonitorBrokerRecentWindowMinutes;

  assert.equal(resolveWindow({ mode: "primary" }), null);
  assert.equal(resolveWindow({ mode: "full-retry" }), 240);
  assert.equal(resolveWindow({ mode: "live-edge" }), 240);
});

test("signal monitor matrix bars use the priority-aware bars lane", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
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
  assert.match(
    source,
    /const SIGNAL_MONITOR_MATRIX_TIMEFRAMES:[\s\S]*\["1m",\s*"2m",\s*"5m",\s*"15m",\s*"1h",\s*"1d"\]/,
  );
  assert.match(source, /const SIGNAL_MONITOR_MATRIX_BARS_LIMIT = 240;/);
  assert.match(
    source,
    /const SIGNAL_MONITOR_MATRIX_SOURCE_STRATEGY = "native_timeframes_live_retry";/,
  );
  assert.match(
    source,
    /const SIGNAL_MONITOR_MATRIX_BAR_LOAD_TIMEOUT_MS = 12_000;/,
  );
  assert.match(
    source,
    /const SIGNAL_MONITOR_MATRIX_STREAM_KEEPALIVE_MS = 5 \* 60_000;/,
  );
  assert.match(source, /const SIGNAL_MONITOR_BARS_PRIORITY = 8;/);
  assert.match(source, /const SIGNAL_MONITOR_MATRIX_BARS_PRIORITY = 5;/);
  assert.match(source, /const SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY = 9;/);
  assert.match(source, /const SIGNAL_MONITOR_BARS_FAMILY = "signal-matrix";/);
  assert.match(
    loadBlock ?? "",
    /mode === "live-edge"[\s\S]*input\.liveEdgePriority\s*\?\?\s*SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY[\s\S]*input\.priority\s*\?\?\s*SIGNAL_MONITOR_BARS_PRIORITY/,
  );
  assert.match(
    loadBlock ?? "",
    /priority,\s*\n\s*family:\s*SIGNAL_MONITOR_BARS_FAMILY/,
  );
  assert.match(loadBlock ?? "", /family:\s*SIGNAL_MONITOR_BARS_FAMILY/);
  assert.match(
    loadBlock ?? "",
    /resolveSignalMonitorBrokerRecentWindowMinutes/,
  );
  assert.match(loadBlock ?? "", /readSignalMonitorCompletedBarsCache/);
  assert.match(loadBlock ?? "", /signalMonitorCompletedBarsInFlight/);
  assert.match(loadBlock ?? "", /shouldRetrySignalMonitorCompletedBars/);
  assert.match(loadBlock ?? "", /shouldAllowSignalMonitorBrokerLiveEdgeRetry/);
  assert.match(
    loadBlock ?? "",
    /allowBrokerLiveEdgeRetry[\s\S]*fetchCompletedBars\("live-edge"\)/,
  );
  assert.match(loadBlock ?? "", /const providerTimeframe = input\.timeframe;/);
  assert.match(loadBlock ?? "", /timeframe:\s*providerTimeframe/);
  assert.doesNotMatch(loadBlock ?? "", /buildFallbackPlan/);
  assert.doesNotMatch(loadBlock ?? "", /providerTimeframe:\s*"1m"/);
  assert.doesNotMatch(loadBlock ?? "", /providerTimeframe:\s*"5m"/);
  assert.doesNotMatch(loadBlock ?? "", /aggregateCompletedMinuteBars/);
  assert.doesNotMatch(loadBlock ?? "", /aggregateCompletedFiveMinuteBars/);
  assert.doesNotMatch(
    fullEvaluationBlock ?? "",
    /SIGNAL_MONITOR_MATRIX_BARS_LIMIT/,
  );
  assert.doesNotMatch(fullEvaluationBlock ?? "", /retryStale:\s*false/);
  assert.match(
    matrixSymbolBlock ?? "",
    /limit:\s*SIGNAL_MONITOR_MATRIX_BARS_LIMIT/,
  );
  assert.match(
    matrixSymbolBlock ?? "",
    /withSignalMonitorMatrixBarLoadTimeout/,
  );
  assert.match(matrixSymbolBlock ?? "", /isSignalMonitorMatrixBarLoadTimeout/);
  assert.match(
    matrixSymbolBlock ?? "",
    /evaluateSignalMonitorMatrixStateFromStreamBars/,
  );
  assert.match(matrixSymbolBlock ?? "", /timeframe,/);
  assert.doesNotMatch(matrixSymbolBlock ?? "", /retryStale:\s*false/);
  assert.match(
    matrixSymbolBlock ?? "",
    /priority:\s*SIGNAL_MONITOR_MATRIX_BARS_PRIORITY/,
  );
  assert.doesNotMatch(
    matrixSymbolBlock ?? "",
    /SIGNAL_MONITOR_MATRIX_5M_SOURCE_LIMIT/,
  );
  assert.doesNotMatch(
    matrixSymbolBlock ?? "",
    /aggregateCompletedFiveMinuteBars/,
  );
  assert.match(
    matrixSymbolBlock ?? "",
    /sourceRequestCount:\s*timeframes\.length/,
  );
  assert.match(
    source,
    /primeSignalMonitorMatrixStockAggregateStream\(symbols\)/,
  );
  assert.match(source, /subscribeMutableStockMinuteAggregates/);
  assert.match(source, /getCurrentStockMinuteAggregates/);
  assert.match(source, /isStockAggregateStreamingAvailable/);
  assert.match(source, /mergeSignalMonitorStockMinuteAggregates/);
  assert.match(source, /shouldCacheSignalMonitorMatrixEvaluationValue/);
});

test("automatic signal matrix reads keep followers cache-only and incomplete exact-cell leaders source-backed", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
  const cacheOnlyStart = source.indexOf(
    "function shouldServeSignalMonitorMatrixFromCacheOnly",
  );
  const cacheOnlyEnd = source.indexOf(
    "function markAutomaticSignalMonitorMatrixRequest",
    cacheOnlyStart,
  );
  const cacheOnlyBody = source.slice(cacheOnlyStart, cacheOnlyEnd);
  const matrixStart = source.indexOf("export async function evaluateSignalMonitorMatrix");
  const matrixEnd = source.indexOf("export async function getSignalMonitorProfile", matrixStart);
  const matrixBlock = source.slice(matrixStart, matrixEnd);
  const matrixCacheOnlyBranch = matrixBlock.match(
    /if \(shouldServeSignalMonitorMatrixFromCacheOnly\(input\)\) \{[\s\S]*?\n  const cachedMatrix/,
  )?.[0];
  const matrixAutomaticStart = matrixBlock.indexOf(
    "if (isAutomaticSignalMonitorMatrixRequest(input))",
  );
  const matrixFinalRefreshStart = matrixBlock.lastIndexOf(
    "const response = await withSignalMonitorMatrixEvaluationCache",
  );
  const matrixAutomaticBranchBody = matrixBlock.slice(
    matrixAutomaticStart,
    matrixFinalRefreshStart,
  );

  assert.notEqual(cacheOnlyStart, -1);
  assert.notEqual(cacheOnlyEnd, -1);
  assert.notEqual(matrixStart, -1);
  assert.notEqual(matrixEnd, -1);
  assert.match(cacheOnlyBody, /input\.clientRole === "follower"/);
  assert.match(cacheOnlyBody, /input\.clientRole === "leader"/);
  assert.match(
    cacheOnlyBody,
    /pressureLevel === "high" \|\| pressureLevel === "critical"/,
  );
  assert.doesNotMatch(
    cacheOnlyBody,
    /return isAutomaticSignalMonitorMatrixRequest\(input\)/,
  );
  assert.doesNotMatch(
    cacheOnlyBody,
    new RegExp("shouldRefreshSignalMonitorMatrix" + "CacheInBackground"),
  );
  assert.ok(matrixCacheOnlyBranch);
  assert.match(matrixBlock, /getDebouncedSignalMonitorMatrixCacheValue/);
  assert.match(matrixCacheOnlyBranch, /cacheOnlyCached/);
  assert.match(
    matrixBlock,
    /hydrateSignalMonitorMatrixResponseFromStoredStates/,
  );
  assert.match(matrixCacheOnlyBranch, /hydrateFromStoredStates/);
  assert.ok(matrixAutomaticStart > -1);
  assert.ok(matrixFinalRefreshStart > matrixAutomaticStart);
  assert.ok(matrixAutomaticBranchBody);
  assert.match(matrixAutomaticBranchBody, /exactCells\.exact/);
  assert.match(matrixAutomaticBranchBody, /matrixSettings\.pressure === "normal"/);
  assert.match(matrixAutomaticBranchBody, /matrixSettings\.pressure === "watch"/);
  assert.match(matrixAutomaticBranchBody, /hasCompleteSignalMonitorMatrixCoverage/);
  assert.match(matrixAutomaticBranchBody, /await withSignalMonitorMatrixEvaluationCache/);
  assert.match(matrixAutomaticBranchBody, /refreshMatrixInBackground\(\)/);
  assert.match(matrixAutomaticBranchBody, /return withSignalMonitorMatrixMetadata/);
  assert.match(matrixBlock, /sourceRequestCount:\s*0/);
  assert.doesNotMatch(
    matrixCacheOnlyBranch,
    /withSignalMonitorMatrixEvaluationCache/,
  );
  assert.doesNotMatch(
    matrixCacheOnlyBranch,
    /await withSignalMonitorMatrixEvaluationCache/,
  );
});

test("automatic signal matrix reads fast-return complete stored rows before background refresh", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function evaluateSignalMonitorMatrix");
  const end = source.indexOf("export async function getSignalMonitorProfile", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);
  const automaticBranchIndex = block.indexOf(
    "if (isAutomaticSignalMonitorMatrixRequest(input))",
  );
  const blockingRefreshIndex = block.lastIndexOf(
    "const response = await withSignalMonitorMatrixEvaluationCache",
  );
  const automaticBranch = block.slice(automaticBranchIndex, blockingRefreshIndex);
  const buildFreshIndex = block.indexOf("const buildFreshMatrixResponse");
  const primeIndex = block.indexOf(
    "primeSignalMonitorMatrixStockAggregateStream(symbols);",
  );

  assert.match(block, /void persistSignalMonitorMatrixStatesBestEffort/);
  assert.match(source, /function scheduleSignalMonitorMatrixBackgroundRefresh/);
  assert.match(block, /scheduleSignalMonitorMatrixBackgroundRefresh\(\(\) => \{/);
  assert.ok(automaticBranchIndex > -1);
  assert.ok(blockingRefreshIndex > -1);
  assert.ok(automaticBranchIndex < blockingRefreshIndex);
  assert.ok(buildFreshIndex > -1);
  assert.ok(primeIndex > buildFreshIndex);
  assert.match(automaticBranch, /refreshMatrixInBackground\(\)/);
  assert.match(automaticBranch, /return withSignalMonitorMatrixMetadata/);
  assert.match(automaticBranch, /hasCompleteSignalMonitorMatrixCoverage/);
  assert.match(automaticBranch, /exactCells\.exact/);
  assert.match(automaticBranch, /matrixSettings\.pressure === "normal"/);
  assert.match(automaticBranch, /matrixSettings\.pressure === "watch"/);
  assert.doesNotMatch(
    automaticBranch,
    /if \(\s*shouldServeSignalMonitorMatrixFromStoredStateFast/,
  );
});

test("signal matrix coverage detects incomplete exact-cell stored responses", () => {
  const cells = [
    { symbol: "SPY", timeframe: "1m" },
    { symbol: "SPY", timeframe: "2m" },
    { symbol: "QQQ", timeframe: "1m" },
  ] as const;
  const states = [
    {
      symbol: "SPY",
      timeframe: "1m",
      status: "ok",
      latestBarAt: new Date("2026-06-03T13:00:00.000Z"),
      active: true,
    },
    {
      symbol: "SPY",
      timeframe: "2m",
      status: "stale",
      latestBarAt: new Date("2026-06-03T13:00:00.000Z"),
      active: true,
    },
  ];

  assert.equal(
    __signalMonitorInternalsForTests.hasCompleteSignalMonitorMatrixCoverage({
      states,
      timeframes: ["1m", "2m"],
      requestedSymbols: ["SPY", "QQQ"],
      requestedCells: [...cells],
    }),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.hasCompleteSignalMonitorMatrixCoverage({
      states: [
        ...states,
        {
          symbol: "QQQ",
          timeframe: "1m",
          status: "ok",
          latestBarAt: new Date("2026-06-03T13:00:00.000Z"),
          active: true,
        },
      ],
      timeframes: ["1m", "2m"],
      requestedSymbols: ["SPY", "QQQ"],
      requestedCells: [...cells],
    }),
    true,
  );
});

test("signal monitor matrix timeout can fall back to stream-backed bars", () => {
  const timeout = Object.assign(new Error("timed out"), {
    code: "signal_monitor_matrix_bar_load_timeout",
  });
  const other = Object.assign(new Error("other"), {
    code: "signal_monitor_other_error",
  });

  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorMatrixBarLoadTimeout(
      timeout,
    ),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorMatrixBarLoadTimeout(other),
    false,
  );
});

test("signal monitor evaluates the newest completed bar without an extra bar wait", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
  const symbolEvaluationBlock = source.match(
    /export async function evaluateSignalMonitorSymbolFromCompletedBars[\s\S]*?async function evaluateSignalMonitorSymbol/,
  )?.[0];
  const matrixEvaluationBlock = source.match(
    /export function evaluateSignalMonitorMatrixStateFromCompletedBars[\s\S]*?type SignalMonitorMatrixStateResult/,
  )?.[0];

  assert.match(
    symbolEvaluationBlock ?? "",
    /includeProvisionalSignals:\s*true/,
  );
  assert.doesNotMatch(
    symbolEvaluationBlock ?? "",
    /includeProvisionalSignals:\s*false/,
  );
  assert.match(
    matrixEvaluationBlock ?? "",
    /includeProvisionalSignals:\s*true/,
  );
  assert.doesNotMatch(
    matrixEvaluationBlock ?? "",
    /includeProvisionalSignals:\s*false/,
  );
  assert.match(
    symbolEvaluationBlock ?? "",
    /input\.mode === "incremental" && fresh && barsSinceSignal === 0/,
  );
});

test("signal monitor treats intraday provider timestamps as closed bars", () => {
  const timestamp = new Date("2026-06-02T17:55:00.000Z");

  assert.equal(
    isSignalMonitorBarComplete({
      timestamp,
      timeframe: "5m",
      evaluatedAt: new Date("2026-06-02T17:54:59.999Z"),
    }),
    false,
  );
  assert.equal(
    isSignalMonitorBarComplete({
      timestamp,
      timeframe: "5m",
      evaluatedAt: new Date("2026-06-02T17:55:00.000Z"),
    }),
    true,
  );
  assert.equal(
    isSignalMonitorBarComplete({
      timestamp: new Date("2026-06-02T17:50:00.000Z"),
      dataUpdatedAt: timestamp,
      timeframe: "5m",
      evaluatedAt: new Date("2026-06-02T17:55:00.000Z"),
    }),
    true,
  );
});

test("signal monitor event responses normalize retired algo branding", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
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
  const evaluatedAfterBoundary = new Date("2026-05-26T15:40:03.000Z");
  const delayedLatest = {
    timestamp: new Date("2026-05-26T15:35:00.000Z"),
    dataUpdatedAt: new Date("2026-05-26T15:40:00.000Z"),
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

  const liveButBehindCompletedEdge = {
    ...massiveLiveLatest,
    timestamp: new Date("2026-05-26T15:30:00.000Z"),
    dataUpdatedAt: new Date("2026-05-26T15:35:00.000Z"),
  };
  assert.equal(
    __signalMonitorInternalsForTests
      .expectedLatestCompletedIntradayBarAt({
        timeframe: "5m",
        evaluatedAt: evaluatedAfterBoundary,
      })
      ?.toISOString(),
    "2026-05-26T15:40:00.000Z",
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorMissingExpectedLiveEdge({
      latestBarAt: liveButBehindCompletedEdge.dataUpdatedAt,
      timeframe: "5m",
      evaluatedAt: evaluatedAfterBoundary,
    }),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldRetrySignalMonitorCompletedBars({
      completedBars: [liveButBehindCompletedEdge] as never,
      timeframe: "5m",
      evaluatedAt: evaluatedAfterBoundary,
    }),
    true,
  );
});

test("signal monitor completed-bars cache bypasses retryable delayed rows", () => {
  const evaluatedAt = new Date("2026-05-26T15:40:00.000Z");
  const delayedLatest = {
    timestamp: new Date("2026-05-26T15:35:00.000Z"),
    dataUpdatedAt: new Date("2026-05-26T15:40:00.000Z"),
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
  const liveButBehindCompletedEdge = {
    ...liveLatest,
    timestamp: new Date("2026-05-26T15:30:00.000Z"),
    dataUpdatedAt: new Date("2026-05-26T15:35:00.000Z"),
  };

  assert.equal(
    __signalMonitorInternalsForTests.shouldBypassSignalMonitorCompletedBarsCache(
      {
        cached: {
          bars: [delayedLatest] as never,
          latestBarAt: delayedLatest.dataUpdatedAt,
        },
        timeframe: "5m",
        evaluatedAt,
      },
    ),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldBypassSignalMonitorCompletedBarsCache(
      {
        cached: {
          bars: [delayedLatest] as never,
          latestBarAt: delayedLatest.dataUpdatedAt,
        },
        timeframe: "5m",
        evaluatedAt,
        retryStale: false,
      },
    ),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldBypassSignalMonitorCompletedBarsCache(
      {
        cached: {
          bars: [liveLatest] as never,
          latestBarAt: liveLatest.dataUpdatedAt,
        },
        timeframe: "5m",
        evaluatedAt,
      },
    ),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldBypassSignalMonitorCompletedBarsCache(
      {
        cached: {
          bars: [liveButBehindCompletedEdge] as never,
          latestBarAt: liveButBehindCompletedEdge.dataUpdatedAt,
        },
        timeframe: "5m",
        evaluatedAt: new Date("2026-05-26T15:40:03.000Z"),
      },
    ),
    true,
  );
});

test("signal monitor profile scans prime stock aggregate stream before symbol evaluation", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
  const universeBlock = source.match(
    /export async function evaluateSignalMonitorProfileUniverse[\s\S]*?function resolveExplicitSignalMonitorSymbols/,
  )?.[0];
  const explicitSymbolsBlock = source.match(
    /export async function evaluateSignalMonitorProfileSymbols[\s\S]*?function resolveSignalMonitorMatrixSymbols/,
  )?.[0];

  assert.match(
    universeBlock ?? "",
    /const symbols = resolvedBatch\.symbols;\s*primeSignalMonitorMatrixStockAggregateStream\(symbols\);[\s\S]*evaluateSymbolsInBatches/,
  );
  assert.match(
    explicitSymbolsBlock ?? "",
    /const resolved = resolveExplicitSignalMonitorSymbols[\s\S]*primeSignalMonitorMatrixStockAggregateStream\(resolved\.symbols\);[\s\S]*evaluateSymbolsInBatches/,
  );
});

test("signal monitor IBKR source policy rejects live and delayed Massive bars", () => {
  const ibkr = { ...bar("30", 100, 101), source: "ibkr-history" };
  const overnight = {
    ...bar("31", 101, 102),
    source: "ibkr-overnight-history",
  };
  const massive = {
    ...bar("32", 102, 103),
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    source: "massive-history",
  };
  const delayedMassive = {
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
    __signalMonitorInternalsForTests.isSignalMonitorIbkrBar(
      delayedMassive as never,
    ),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorIbkrBar(massive as never),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorDelayedBar(
      massive as never,
    ),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorDelayedBar(
      delayedMassive as never,
    ),
    true,
  );

  assert.deepEqual(
    __signalMonitorInternalsForTests
      .filterSignalMonitorBarsForSourcePolicy(
        [massive, ibkr, delayedMassive, overnight] as never,
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
  assert.equal(intraday.currentSignalDirection, null);
  assert.equal(intraday.fresh, false);
  assert.match(intraday.lastError || "", /delayed/);
  assert.equal(daily.status, "ok");
});

test("signal monitor matrix preserves requested coverage while narrowing concurrency under API resource pressure", () => {
  const configured = profile({
    maxSymbols: 250,
    evaluationConcurrency: 10,
  });
  const lowProfile = profile({
    maxSymbols: 6,
    evaluationConcurrency: 1,
  });

  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
      configured,
      "normal",
    ),
    { pressure: "normal", maxSymbols: 250, concurrency: 10 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
      configured,
      "watch",
    ),
    { pressure: "watch", maxSymbols: 250, concurrency: 8 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
      configured,
      "high",
    ),
    { pressure: "high", maxSymbols: 250, concurrency: 4 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
      configured,
      "critical",
    ),
    { pressure: "critical", maxSymbols: 250, concurrency: 1 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
      lowProfile,
      "watch",
    ),
    { pressure: "watch", maxSymbols: 6, concurrency: 1 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
      configured,
      "normal",
      { automatic: true },
    ),
    { pressure: "normal", maxSymbols: 32, concurrency: 2 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
      configured,
      "watch",
      { automatic: true },
    ),
    { pressure: "watch", maxSymbols: 16, concurrency: 2 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
      configured,
      "high",
      { automatic: true },
    ),
    { pressure: "high", maxSymbols: 8, concurrency: 1 },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
      configured,
      "critical",
      { automatic: true },
    ),
    { pressure: "critical", maxSymbols: 8, concurrency: 1 },
  );
});

test("signal monitor pressure caps read the shared pressure snapshot without rewriting RSS", () => {
  __resetApiResourcePressureForTests();
  updateApiResourcePressure({
    rssMb: resolveApiRssPressureThresholds().critical + 1,
  });
  try {
    assert.equal(
      __signalMonitorInternalsForTests.cappedSignalMatrixSettings(profile()).pressure,
      "critical",
    );
    assert.equal(
      __signalMonitorInternalsForTests.cappedSignalMonitorEvaluationProfile(
        profile(),
      ).pressure,
      "critical",
    );
  } finally {
    __resetApiResourcePressureForTests();
  }
});

test("explicit leader signal matrix requests bypass soft pressure concurrency only below high pressure", () => {
  const normalMatrixSettings = {
    pressure: "normal",
    maxSymbols: 250,
    concurrency: 4,
  } as const;
  const highMatrixSettings = {
    pressure: "high",
    maxSymbols: 250,
    concurrency: 4,
  } as const;

  assert.equal(
    __signalMonitorInternalsForTests.shouldBypassSoftSignalMonitorMatrixPressure(
      {
        clientRole: "leader",
        requestOrigin: "startup",
        symbols: ["SPY", "QQQ", "AAPL"],
      },
    ),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.resolveSignalMonitorMatrixConcurrency({
      matrixSettings: normalMatrixSettings,
      request: {
        clientRole: "leader",
        requestOrigin: "startup",
        symbols: ["SPY", "QQQ", "AAPL"],
      },
      symbolCount: 6,
    }),
    6,
  );
  assert.equal(
    __signalMonitorInternalsForTests.resolveSignalMonitorMatrixConcurrency({
      matrixSettings: normalMatrixSettings,
      request: {
        clientRole: "leader",
        requestOrigin: "startup",
        symbols: Array.from({ length: 24 }, (_, index) => `T${index}`),
      },
      symbolCount: 24,
    }),
    4,
  );
  assert.equal(
    __signalMonitorInternalsForTests.resolveSignalMonitorMatrixConcurrency({
      matrixSettings: highMatrixSettings,
      request: {
        clientRole: "leader",
        requestOrigin: "startup",
        symbols: ["SPY", "QQQ", "AAPL"],
      },
      symbolCount: 6,
    }),
    4,
  );
  assert.equal(
    __signalMonitorInternalsForTests.resolveSignalMonitorMatrixConcurrency({
      matrixSettings: {
        ...highMatrixSettings,
        pressure: "critical",
        concurrency: 1,
      },
      request: {
        clientRole: "leader",
        requestOrigin: "startup",
        symbols: ["SPY", "QQQ", "AAPL"],
      },
      symbolCount: 24,
    }),
    1,
  );
  assert.equal(
    __signalMonitorInternalsForTests.resolveSignalMonitorMatrixConcurrency({
      matrixSettings: highMatrixSettings,
      request: {
        clientRole: "follower",
        requestOrigin: "startup",
        symbols: ["SPY", "QQQ", "AAPL"],
      },
      symbolCount: 24,
    }),
    4,
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
      capped: false,
      profile: {
        ...configured,
        maxSymbols: 250,
        evaluationConcurrency: 10,
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
      maxSymbols: 250,
      evaluationConcurrency: 10,
    },
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.cappedSignalMonitorEvaluationProfile(
      configured,
      "high",
    ).profile,
    {
      ...configured,
      maxSymbols: 250,
      evaluationConcurrency: 10,
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

test("signal monitor profile universe does not inherit the historical-bars lane cap", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /resolveIbkrLaneSymbols\("historical-bars"/);
  assert.doesNotMatch(source, /Historical Bars lane is dropping/);
});

test("explicit signal monitor symbol evaluations can bypass soft pressure caps", () => {
  const configured = profile({
    maxSymbols: 250,
    evaluationConcurrency: 10,
  });

  const capped =
    __signalMonitorInternalsForTests.resolveSignalMonitorProfileSymbolEvaluationSettings(
      {
        profile: configured,
        maxSymbolsOverride: 90,
        pressureLevel: "critical",
      },
    );
  const bypass =
    __signalMonitorInternalsForTests.resolveSignalMonitorProfileSymbolEvaluationSettings(
      {
        profile: configured,
        maxSymbolsOverride: 90,
        pressureCapMode: "bypass-soft",
        evaluationConcurrencyOverride: 6,
        pressureLevel: "critical",
      },
    );

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
  assert.equal(state.indicatorSnapshot, null);
  assert.match(state.id, /profile-1:AAPL:2m/);
});

test("signal matrix state includes current indicator dashboard snapshot", () => {
  const state = evaluateSignalMonitorMatrixStateFromCompletedBars({
    profile: profile({
      pyrusSignalsSettings: {
        basisLength: 4,
        atrLength: 4,
        atrSmoothing: 2,
        adxLength: 4,
        volumeMaLength: 4,
        mtf1: "1m",
        mtf2: "5m",
        mtf3: "1h",
        requireMtf1: true,
      },
    }),
    symbol: "SPY",
    timeframe: "1m",
    evaluatedAt: new Date("2026-04-24T14:35:00.000Z"),
    completedBars: minuteBars(96) as never,
  });

  assert.equal(state.indicatorSnapshot?.trendDirection, "bullish");
  assert.equal(typeof state.indicatorSnapshot?.trendAgeBars, "number");
  assert.equal(state.indicatorSnapshot?.strength, "strong");
  assert.deepEqual(
    state.indicatorSnapshot?.mtf.map((entry) => entry.timeframe),
    ["1m", "5m", "1h"],
  );
  assert.equal(state.indicatorSnapshot?.mtf[0]?.required, true);
  assert.equal(typeof state.indicatorSnapshot?.mtf[0]?.pass, "boolean");
});

test("signal monitor all-watchlists scope evaluates the combined universe", () => {
  const result =
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists(
      {
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
            items: [
              { symbol: "PLTR" },
              { symbol: "spy" },
              { symbol: "IONQ" },
            ] as never,
          },
        ],
      },
    );

  assert.deepEqual(result.symbols, ["SPY", "NVDA", "PLTR", "IONQ"]);
  assert.deepEqual(result.watchlistSymbols, ["SPY", "NVDA", "PLTR", "IONQ"]);
  assert.deepEqual(result.skippedSymbols, []);
  assert.equal(result.truncated, false);
});

test("signal monitor state universe keeps all watchlist symbols outside max cap", () => {
  const result =
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists(
      {
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
      },
    );

  assert.deepEqual(result.symbols, ["SPY", "NVDA"]);
  assert.deepEqual(result.watchlistSymbols, ["SPY", "NVDA", "AAPL", "MSFT"]);
  assert.deepEqual(result.skippedSymbols, ["AAPL", "MSFT"]);
  assert.deepEqual(
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseSymbols(
      result,
    ),
    ["SPY", "NVDA", "AAPL", "MSFT"],
  );
  assert.equal(result.truncated, true);
});

test("signal monitor selected-watchlist scope stays on the configured watchlist", () => {
  const result =
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists(
      {
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
      },
    );

  assert.deepEqual(result.symbols, ["SPY", "NVDA"]);
});

test("signal monitor default scope stays on all watchlists", () => {
  const result =
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists(
      {
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
      },
    );

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
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists(
      {
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
      },
    );

  assert.deepEqual(result.symbols, [
    "SPY",
    "NVDA",
    "PLTR",
    "AAPL",
    "MSFT",
    "TSLA",
  ]);
  assert.deepEqual(result.skippedSymbols, ["AMD"]);
  assert.deepEqual(
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseSymbols(
      result,
    ),
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
    __signalMonitorInternalsForTests.resolveSignalMonitorUniverseFromWatchlists(
      {
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
      },
    );

  assert.deepEqual(result.symbols, ["SPY", "NVDA"]);
  assert.equal(result.fallbackWatchlists, true);
});

test("signal monitor state hydration is scoped to the profile timeframe", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
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

test("signal monitor matrix stored hydration reads all requested timeframes", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "async function readCurrentSignalMonitorMatrixStates",
  );
  const end = source.indexOf(
    "async function hydrateSignalMonitorMatrixResponseFromStoredStates",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.match(
    block,
    /inArray\(signalMonitorSymbolStatesTable\.symbol,\s*requestedSymbols\)/,
  );
  assert.match(
    block,
    /inArray\(signalMonitorSymbolStatesTable\.timeframe,\s*timeframes\)/,
  );
  assert.match(block, /isRenderableStoredSignalMonitorMatrixState/);
  assert.doesNotMatch(block, /isSignalMonitorStateCurrentForLane/);
  assert.doesNotMatch(block, /profileTimeframe/);
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

test("signal monitor full evaluation preserves sibling matrix timeframe rows", () => {
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function evaluateSignalMonitorProfileUniverse",
  );
  const end = source.indexOf(
    "function resolveSignalMonitorMatrixSymbols",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.doesNotMatch(
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
  __signalMonitorInternalsForTests.seedSignalMonitorMatrixCache(
    key,
    staleValue,
    {
      freshUntil: 1_000,
      staleUntil: 20_000,
    },
  );

  const result =
    await __signalMonitorInternalsForTests.withSignalMonitorMatrixEvaluationCache(
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

test("signal matrix cache does not pin timeout error states", async () => {
  const key = "signal-matrix:unit:timeout";
  const timeoutValue = {
    states: [
      {
        symbol: "TSLA",
        timeframe: "5m",
        status: "error",
        lastError:
          "Signal monitor matrix bar load timed out for TSLA 5m after 8000ms.",
      },
    ],
    evaluatedAt: "new",
  };

  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache();
  assert.equal(
    __signalMonitorInternalsForTests.shouldCacheSignalMonitorMatrixEvaluationValue(
      timeoutValue,
    ),
    false,
  );

  const result =
    await __signalMonitorInternalsForTests.withSignalMonitorMatrixEvaluationCache(
      key,
      async () => timeoutValue,
      { nowMs: 1_000 },
    );

  assert.equal(result, timeoutValue);
  assert.equal(
    __signalMonitorInternalsForTests.getDebouncedSignalMonitorMatrixCacheValue(
      key,
      1_100,
    ),
    null,
  );
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

test("signal matrix cache keeps settled unavailable states without pinning errors", () => {
  assert.equal(
    __signalMonitorInternalsForTests.shouldCacheSignalMonitorMatrixEvaluationValue(
      {
        states: [
          {
            symbol: "CEG",
            timeframe: "1h",
            status: "unavailable",
            lastEvaluatedAt: new Date("2026-06-02T01:20:00.000Z"),
            lastError: "No broker history bars were available for this symbol.",
          },
          {
            symbol: "APH",
            timeframe: "5m",
            status: "stale",
            latestBarAt: new Date("2026-06-02T01:20:00.000Z"),
            lastError: null,
          },
        ],
      },
    ),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldCacheSignalMonitorMatrixEvaluationValue(
      {
        states: [
          {
            symbol: "TSLA",
            timeframe: "5m",
            status: "error",
            lastError:
              "Signal monitor matrix bar load timed out for TSLA 5m after 8000ms.",
          },
        ],
      },
    ),
    false,
  );
});

test("signal matrix automatic cache-only mode preserves foreground exact-cell leaders under pressure", () => {
  __resetApiResourcePressureForTests();
  updateApiResourcePressure({ dominantSlowRouteP95Ms: 12_000 });
  try {
    assert.equal(
      __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly(
        {
          clientRole: "follower",
          requestOrigin: "startup",
        },
      ),
      true,
    );
    assert.equal(
      __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly(
        {
          clientRole: "follower",
          requestOrigin: "poll",
        },
      ),
      true,
    );
    assert.equal(
      __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly(
        {
          clientRole: "leader",
          requestOrigin: "startup",
          cells: [{ symbol: "SPY", timeframe: "1m" }],
        },
      ),
      false,
    );
    assert.equal(
      __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly(
        {
          clientRole: "leader",
          requestOrigin: "poll",
          cells: [{ symbol: "SPY", timeframe: "1m" }],
        },
      ),
      false,
    );
    assert.equal(
      __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly(
        {
          clientRole: "leader",
          requestOrigin: "startup",
        },
      ),
      true,
    );
    assert.equal(
      __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly(
        {
          clientRole: "leader",
          requestOrigin: "poll",
        },
      ),
      true,
    );
    assert.equal(
      __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly(
        {
          clientRole: "leader",
          requestOrigin: "manual",
        },
      ),
      false,
    );
    assert.equal(
      __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly(
        {
          clientRole: "manual",
          requestOrigin: "manual",
        },
      ),
      false,
    );

    __resetApiResourcePressureForTests();
    updateApiResourcePressure({ apiHeapUsedPercent: 91 });
    assert.equal(
      __signalMonitorInternalsForTests.shouldServeSignalMonitorMatrixFromCacheOnly(
        {
          clientRole: "leader",
          requestOrigin: "startup",
          cells: [{ symbol: "SPY", timeframe: "1m" }],
        },
      ),
      false,
    );
  } finally {
    __resetApiResourcePressureForTests();
  }
});

test("signal matrix automatic debounce can reuse stale cache without refreshing", () => {
  const key = "signal-matrix:paper:debounced-cache";
  const staleValue = { states: [{ symbol: "SPY" }], evaluatedAt: "old" };
  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache();
  __signalMonitorInternalsForTests.seedSignalMonitorMatrixCache(
    key,
    staleValue,
    {
      freshUntil: 1_000,
      staleUntil: 20_000,
    },
  );

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
  const key =
    "signal-matrix:native_timeframes_live_retry:paper:profile:default:SPY:2m:1:normal:3:{}";
  const staleValue = { states: [{ symbol: "SPY" }], evaluatedAt: "old" };
  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache();
  __signalMonitorInternalsForTests.seedSignalMonitorMatrixCache(
    key,
    staleValue,
    {
      freshUntil: 1_000,
      staleUntil: 20_000,
    },
  );
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

  __signalMonitorInternalsForTests.clearSignalMonitorMatrixEvaluationCache(
    "paper",
  );

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
  assert.match(
    error.detail || "",
    /Retry after Postgres connectivity recovers/,
  );
  assert.equal((error as Error & { cause?: unknown }).cause, cause);
});
