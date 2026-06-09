import assert from "node:assert/strict";
import test from "node:test";

import { GetSignalMonitorStateResponse } from "@workspace/api-zod";

import {
  __signalMonitorInternalsForTests,
  evaluateSignalMonitorProfileSymbols,
} from "./signal-monitor";

const bar = (timestamp: string) =>
  ({
    timestamp: new Date(timestamp),
    dataUpdatedAt: new Date(timestamp),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    source: "massive-history",
    outsideRth: true,
    partial: false,
  }) as never;

test("quiet market completed bars do not retry solely because wall clock moved", () => {
  assert.equal(
    __signalMonitorInternalsForTests.shouldRetrySignalMonitorCompletedBars({
      completedBars: [bar("2026-06-05T19:50:00.000Z")],
      timeframe: "1m",
      evaluatedAt: new Date("2026-06-08T01:00:00.000Z"),
    }),
    false,
  );
});

test("quiet market completed bars still retry when far behind the previous close", () => {
  assert.equal(
    __signalMonitorInternalsForTests.shouldRetrySignalMonitorCompletedBars({
      completedBars: [bar("2026-06-05T18:00:00.000Z")],
      timeframe: "1m",
      evaluatedAt: new Date("2026-06-08T01:00:00.000Z"),
    }),
    true,
  );
});

test("active-session completed bars still require the expected live edge", () => {
  assert.equal(
    __signalMonitorInternalsForTests.shouldRetrySignalMonitorCompletedBars({
      completedBars: [bar("2026-06-08T14:45:00.000Z")],
      timeframe: "1m",
      evaluatedAt: new Date("2026-06-08T15:00:00.000Z"),
    }),
    true,
  );
});

test("quiet automatic matrix stored coverage still refreshes in background", () => {
  // Time-of-day gates only execution, not market data: background coverage refresh runs
  // in all sessions, including outside regular trading hours.
  assert.equal(
    __signalMonitorInternalsForTests.shouldRefreshSignalMonitorMatrixStoredCoverageInBackground({
      evaluatedAt: new Date("2026-06-08T01:00:00.000Z"),
    }),
    true,
  );
});

test("active-session automatic matrix stored coverage can refresh in background", () => {
  assert.equal(
    __signalMonitorInternalsForTests.shouldRefreshSignalMonitorMatrixStoredCoverageInBackground({
      evaluatedAt: new Date("2026-06-08T15:00:00.000Z"),
    }),
    true,
  );
});

test("non-automatic matrix evaluation is bounded under high pressure", () => {
  const settings = __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
    {
      maxSymbols: 500,
      evaluationConcurrency: 10,
    } as never,
    "high",
  );

  assert.equal(settings.maxSymbols, 8);
  assert.equal(settings.concurrency, 2);
  assert.equal(
    __signalMonitorInternalsForTests.resolveSignalMonitorMatrixExactCellCap({
      pressure: "high",
      clientRole: undefined,
      requestOrigin: undefined,
      cells: [],
    }),
    48,
  );
});

test("automatic stored-state matrix bootstrap keeps full universe breadth", () => {
  const settings = __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
    {
      maxSymbols: 500,
      evaluationConcurrency: 10,
    } as never,
    "high",
    {
      automatic: true,
      request: {
        clientRole: "leader",
        requestOrigin: "startup",
        cells: [],
      },
    },
  );

  assert.equal(settings.maxSymbols, 500);
});

test("signal monitor evaluation batch keeps existing cursor rotation without priority", () => {
  const batch =
    __signalMonitorInternalsForTests.resolveSignalMonitorEvaluationBatch({
      sourceSymbols: ["T1", "T2", "T3", "T4", "T5"],
      maxSymbols: 2,
      cursor: 3,
    });

  assert.deepEqual(batch.symbols, ["T4", "T5"]);
  assert.deepEqual(batch.skippedSymbols, ["T1", "T2", "T3"]);
  assert.equal(batch.truncated, true);
  assert.equal(batch.nextCursor, 0);
});

test("signal monitor evaluation batch prioritizes visible symbols within the existing cap", () => {
  const batch =
    __signalMonitorInternalsForTests.resolveSignalMonitorEvaluationBatch({
      sourceSymbols: ["T1", "T2", "T3", "T4", "T5", "T6"],
      prioritySymbols: ["T5", "T2"],
      maxSymbols: 4,
      cursor: 2,
    });

  assert.deepEqual(batch.symbols, ["T5", "T2", "T4", "T6"]);
  assert.deepEqual(batch.skippedSymbols, ["T1", "T3"]);
  assert.equal(batch.truncated, true);
  assert.equal(batch.nextCursor, 0);
});

test("signal monitor evaluation batch rotates oversized priority symbols without expanding work", () => {
  const batch =
    __signalMonitorInternalsForTests.resolveSignalMonitorEvaluationBatch({
      sourceSymbols: ["T1", "T2", "T3", "T4"],
      prioritySymbols: ["T4", "T3", "T2"],
      maxSymbols: 2,
      cursor: 1,
    });

  assert.deepEqual(batch.symbols, ["T3", "T2"]);
  assert.deepEqual(batch.skippedSymbols, ["T1", "T4"]);
  assert.equal(batch.truncated, true);
  assert.equal(batch.nextCursor, 0);
});

test("signal matrix metadata reports pending exact cells from backend coverage", () => {
  const response =
    __signalMonitorInternalsForTests.withSignalMonitorMatrixMetadata(
      {
        profile: {},
        states: [
          {
            id: "matrix:AAPL:1m",
            profileId: "profile",
            symbol: "AAPL",
            timeframe: "1m",
            currentSignalDirection: null,
            currentSignalAt: null,
            currentSignalPrice: null,
            latestBarAt: "2026-06-08T15:30:00.000Z",
            barsSinceSignal: null,
            fresh: true,
            status: "ok",
            active: true,
            lastEvaluatedAt: "2026-06-08T15:31:00.000Z",
            lastError: null,
            indicatorSnapshot: null,
          },
        ],
        evaluatedAt: new Date("2026-06-08T15:31:00.000Z"),
        timeframes: ["1m", "5m"],
        truncated: false,
        skippedSymbols: [],
        sourceRequestCount: 1,
      },
      {
        cacheStatus: "stale",
        requestedSymbols: ["AAPL", "MSFT"],
        requestedCells: [
          { symbol: "AAPL", timeframe: "1m" },
          { symbol: "AAPL", timeframe: "5m" },
          { symbol: "MSFT", timeframe: "5m" },
        ],
        totalSymbols: 2,
        taskCount: 3,
        startedAt: Date.now(),
      },
    );

  assert.equal(response.warming, true);
  assert.deepEqual(response.pendingCells, [
    { symbol: "AAPL", timeframe: "5m" },
    { symbol: "MSFT", timeframe: "5m" },
  ]);
  assert.equal(response.coverage.pendingCellCount, 2);
});

test("signal matrix metadata does not expand broad requests into pending cells", () => {
  const response =
    __signalMonitorInternalsForTests.withSignalMonitorMatrixMetadata(
      {
        profile: {},
        states: [],
        evaluatedAt: new Date("2026-06-08T15:31:00.000Z"),
        timeframes: ["1m", "5m"],
        truncated: false,
        skippedSymbols: [],
        sourceRequestCount: 0,
      },
      {
        cacheStatus: "miss",
        requestedSymbols: ["AAPL", "MSFT"],
        totalSymbols: 2,
        taskCount: 4,
        startedAt: Date.now(),
      },
    );

  assert.deepEqual(response.pendingCells, []);
  assert.equal(response.coverage.pendingCellCount, 0);
});

test("oversized exact matrix evaluation is rejected before inline work", () => {
  const cells = Array.from({ length: 49 }, (_value, index) => ({
    symbol: `T${index + 1}`,
    timeframe: "1m" as const,
  }));

  assert.throws(
    () =>
      __signalMonitorInternalsForTests.resolveSignalMonitorMatrixExactCells({
        cells,
        allowedSymbols: cells.map((cell) => cell.symbol),
        pressure: "high",
      }),
    /exact-cell request is too large/,
  );
});

test("disabled signal monitor profile symbols do not evaluate bars", async () => {
  const now = new Date("2026-06-08T15:00:00.000Z");
  const result = await evaluateSignalMonitorProfileSymbols({
    profile: {
      id: "disabled-profile",
      environment: "paper",
      enabled: false,
      watchlistId: null,
      timeframe: "5m",
      pyrusSignalsSettings: {},
      freshWindowBars: 3,
      pollIntervalSeconds: 60,
      maxSymbols: 500,
      evaluationConcurrency: 10,
      lastEvaluatedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    },
    evaluatedAt: now,
    symbols: ["SPY", "QQQ"],
    maxSymbolsOverride: 2,
  });

  assert.equal(result.profile.enabled, false);
  assert.deepEqual(result.states, []);
  assert.deepEqual(result.universeSymbols, ["SPY", "QQQ"]);
  assert.equal(result.universe.degradedReason, "Signal monitor profile is disabled.");
});

test("signal monitor state snapshots fill missing universe cells as unavailable", () => {
  const evaluatedAt = new Date("2026-06-08T15:00:00.000Z");
  const snapshot =
    __signalMonitorInternalsForTests.completeSignalMonitorStateSnapshotCoverage({
      profile: { id: "paper-profile" },
      states: [
        {
          id: "existing-spy-1m",
          profileId: "paper-profile",
          symbol: "SPY",
          timeframe: "1m",
          currentSignalDirection: "buy",
          currentSignalAt: evaluatedAt,
          currentSignalPrice: 500,
          latestBarAt: evaluatedAt,
          barsSinceSignal: 0,
          fresh: true,
          status: "ok",
          active: true,
          lastEvaluatedAt: evaluatedAt,
          lastError: null,
        },
      ],
      evaluatedAt,
      universeSymbols: ["SPY", "AALB"],
    });

  assert.equal(snapshot.states.length, 12);
  assert.equal(
    snapshot.states.find(
      (state) => state.symbol === "SPY" && state.timeframe === "1m",
    )?.status,
    "ok",
  );
  const aalbStates = snapshot.states.filter((state) => state.symbol === "AALB");
  assert.equal(aalbStates.length, 6);
  assert.deepEqual(
    Array.from(new Set(aalbStates.map((state) => state.status))),
    ["unavailable"],
  );
  assert.equal(
    snapshot.states.find(
      (state) => state.symbol === "SPY" && String(state.timeframe) === "2m",
    )?.status,
    "unavailable",
  );
});

test("signal monitor cold state fallback is schema-valid and marked warming", () => {
  const snapshot =
    __signalMonitorInternalsForTests.buildSignalMonitorStateCacheWarmingResult(
      "paper",
      new Date("2026-06-08T15:00:00.000Z"),
    );

  const parsed = GetSignalMonitorStateResponse.parse({
    ...snapshot.value,
    cacheStatus: "miss",
    refreshing: true,
    servedAt: new Date("2026-06-08T15:00:00.000Z"),
    stateSource: snapshot.stateSource,
  });

  assert.equal(parsed.profile.environment, "paper");
  assert.ok(parsed.universeSymbols.length > 0);
  assert.ok(parsed.states.length >= parsed.universeSymbols.length);
  assert.ok(parsed.universeSymbols.includes("SPY"));
  assert.deepEqual(
    Array.from(new Set(parsed.states.map((state) => state.status))),
    ["unavailable"],
  );
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.refreshing, true);
  assert.equal(parsed.cacheStatus, "miss");
  assert.equal(parsed.stateSource, "runtime-fallback");
  assert.equal(parsed.universe.fallbackUsed, true);
  assert.match(
    parsed.universe.degradedReason ?? "",
    /cache is warming/,
  );
});
