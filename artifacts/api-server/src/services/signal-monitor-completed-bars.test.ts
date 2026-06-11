import assert from "node:assert/strict";
import test from "node:test";

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

const barsSinceSignal = __signalMonitorInternalsForTests.signalMonitorBarsSinceSignal;

test("gappy intraday feed counts bars since signal by elapsed time, not present bars", () => {
  // ADBG defect: signal at 20:05, latest bar 20:40 (35 min ≈ 7 bars on 5m) but
  // only 1 bar is present in the sparse stream cache.
  assert.equal(
    barsSinceSignal({
      timeframe: "5m",
      signalAt: new Date("2026-06-11T20:05:00.000Z"),
      latestBarAt: new Date("2026-06-11T20:40:00.000Z"),
      presentBarsSinceSignal: 1,
    }),
    7,
  );
});

test("thin and liquid symbols with the same signal/latest times report the same bars", () => {
  const args = {
    timeframe: "5m" as const,
    signalAt: new Date("2026-06-11T20:05:00.000Z"),
    latestBarAt: new Date("2026-06-11T20:40:00.000Z"),
  };
  const thin = barsSinceSignal({ ...args, presentBarsSinceSignal: 1 });
  const liquid = barsSinceSignal({ ...args, presentBarsSinceSignal: 7 });
  assert.equal(thin, liquid);
  assert.equal(thin, 7);
});

test("bars since signal never reads fresher than the present-bar count", () => {
  // Wall-clock distance shorter than present bars (e.g. partial edge) keeps the
  // larger present count — never under-reports age.
  assert.equal(
    barsSinceSignal({
      timeframe: "5m",
      signalAt: new Date("2026-06-11T20:05:00.000Z"),
      latestBarAt: new Date("2026-06-11T20:07:00.000Z"),
      presentBarsSinceSignal: 4,
    }),
    4,
  );
});

test("cross-session intraday signal is counted as very old, not artificially fresh", () => {
  // Signal from the prior session with a current latest bar must not look fresh
  // just because the gappy cache only holds 1 bar.
  const value = barsSinceSignal({
    timeframe: "5m",
    signalAt: new Date("2026-06-10T19:55:00.000Z"),
    latestBarAt: new Date("2026-06-11T20:00:00.000Z"),
    presentBarsSinceSignal: 1,
  });
  assert.ok(value > 50);
});

test("daily bars do not count weekends/holidays as elapsed bars", () => {
  // Friday close to Monday close is 1 daily bar, not 3 wall-clock days.
  assert.equal(
    barsSinceSignal({
      timeframe: "1d",
      signalAt: new Date("2026-06-05T20:00:00.000Z"),
      latestBarAt: new Date("2026-06-08T20:00:00.000Z"),
      presentBarsSinceSignal: 1,
    }),
    1,
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

type LatchValues = {
  currentSignalDirection: "buy" | "sell" | null;
  currentSignalAt: Date | null;
  currentSignalPrice: string | null;
  barsSinceSignal: number | null;
  fresh: boolean;
  latestBarAt: Date;
  status: string;
};
const latchValues = (overrides: Partial<LatchValues> = {}): LatchValues => ({
  currentSignalDirection: null,
  currentSignalAt: null,
  currentSignalPrice: null,
  barsSinceSignal: null,
  fresh: false,
  latestBarAt: new Date("2026-06-10T22:00:00.000Z"),
  status: "ok",
  ...overrides,
});
const latchExisting = {
  currentSignalDirection: "sell",
  currentSignalAt: new Date("2026-06-09T15:00:00.000Z"),
  currentSignalPrice: "12.5",
  barsSinceSignal: 21,
} as never;

test("matrix cache latches the last signal when a re-eval finds no new signal", () => {
  const result = __signalMonitorInternalsForTests.applyStoredSignalDirectionLatch({
    existing: latchExisting,
    values: latchValues(),
  });
  // No new signal this eval -> keep the cached sell, refresh freshness/bars meta.
  assert.equal(result.currentSignalDirection, "sell");
  assert.equal(result.currentSignalPrice, "12.5");
  assert.equal(result.fresh, false);
  // Bar metadata still advances.
  assert.equal(result.latestBarAt.toISOString(), "2026-06-10T22:00:00.000Z");
});

test("matrix cache flips direction when an opposite signal arrives", () => {
  const result = __signalMonitorInternalsForTests.applyStoredSignalDirectionLatch({
    existing: latchExisting,
    values: latchValues({
      currentSignalDirection: "buy",
      currentSignalPrice: "13.1",
      fresh: true,
    }),
  });
  // A real buy signal replaces the cached sell.
  assert.equal(result.currentSignalDirection, "buy");
  assert.equal(result.currentSignalPrice, "13.1");
  assert.equal(result.fresh, true);
});

test("matrix cache leaves a never-signaled cell directionless", () => {
  const result = __signalMonitorInternalsForTests.applyStoredSignalDirectionLatch({
    existing: null,
    values: latchValues(),
  });
  assert.equal(result.currentSignalDirection, null);
});

test("signal monitor bar evaluation is passive by default", () => {
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorBarEvaluationEnabled({}),
    false,
  );
});

test("signal monitor bar evaluation requires explicit opt-in", () => {
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorBarEvaluationEnabled({
      PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "1",
    }),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.isSignalMonitorBarEvaluationEnabled({
      SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "true",
    }),
    true,
  );
});

test("non-current signal state snapshots preserve last-known direction for display hydration", () => {
  const response =
    __signalMonitorInternalsForTests.stateToResponseForSnapshot(
      {
        id: "state-crwv-1m",
        profileId: "profile-test",
        symbol: "CRWV",
        timeframe: "1m",
        currentSignalDirection: "sell",
        currentSignalAt: new Date("2026-06-08T17:02:00.000Z"),
        currentSignalPrice: "48.12",
        latestBarAt: new Date("2026-06-08T17:44:00.000Z"),
        barsSinceSignal: 42,
        fresh: false,
        status: "ok",
        active: true,
        lastEvaluatedAt: new Date("2026-06-08T17:44:00.000Z"),
        lastError: null,
      } as never,
      {
        timeframe: "1m",
        evaluatedAt: new Date("2026-06-09T20:00:00.000Z"),
        markNonCurrentStale: true,
      },
    );

  assert.equal(response.status, "stale");
  assert.equal(response.fresh, false);
  assert.equal(response.currentSignalDirection, "sell");
  assert.equal(
    response.currentSignalAt?.toISOString(),
    "2026-06-08T17:02:00.000Z",
  );
  assert.equal(response.currentSignalPrice, 48.12);
  assert.equal(response.barsSinceSignal, 42);
});

test("matrix evaluation keeps configured capacity under high pressure", () => {
  const settings = __signalMonitorInternalsForTests.cappedSignalMatrixSettings(
    {
      maxSymbols: 500,
      evaluationConcurrency: 10,
    } as never,
    "high",
  );

  assert.equal(settings.maxSymbols, 500);
  assert.equal(settings.concurrency, 10);
  assert.equal(
    __signalMonitorInternalsForTests.resolveSignalMonitorMatrixExactCellCap({
      pressure: "high",
      clientRole: undefined,
      requestOrigin: undefined,
      cells: [],
    }),
    null,
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

test("exact matrix evaluation is not capped by pressure", () => {
  const cells = Array.from({ length: 49 }, (_value, index) => ({
    symbol: `T${index + 1}`,
    timeframe: "1m" as const,
  }));

  const resolved =
    __signalMonitorInternalsForTests.resolveSignalMonitorMatrixExactCells({
      cells,
      allowedSymbols: cells.map((cell) => cell.symbol),
      pressure: "high",
    });

  assert.equal(resolved.exact, true);
  assert.equal(resolved.cells.length, 49);
});

test("fresh signal monitor events persist when first observed after the zero bar", () => {
  const evaluatedAt = new Date("2026-06-09T16:50:10.000Z");
  const signalAt = new Date("2026-06-09T16:40:00.000Z");

  assert.equal(
    __signalMonitorInternalsForTests.shouldPersistSignalMonitorStateEvent({
      mode: "incremental",
      fresh: true,
      barsSinceSignal: 2,
      freshWindowBars: 3,
      signalAt,
      evaluatedAt,
      sourceBarPartial: false,
    }),
    true,
  );
});

test("signal monitor event catch-up does not persist stale or out-of-window signals", () => {
  const evaluatedAt = new Date("2026-06-09T16:50:10.000Z");
  const signalAt = new Date("2026-06-09T16:30:00.000Z");

  assert.equal(
    __signalMonitorInternalsForTests.shouldPersistSignalMonitorStateEvent({
      mode: "incremental",
      fresh: true,
      barsSinceSignal: 4,
      freshWindowBars: 3,
      signalAt,
      evaluatedAt,
      sourceBarPartial: false,
    }),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldPersistSignalMonitorStateEvent({
      mode: "incremental",
      fresh: false,
      barsSinceSignal: 1,
      freshWindowBars: 3,
      signalAt,
      evaluatedAt,
      sourceBarPartial: false,
    }),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldPersistSignalMonitorStateEvent({
      mode: "incremental",
      fresh: true,
      barsSinceSignal: 1,
      freshWindowBars: 3,
      signalAt,
      evaluatedAt,
      sourceBarPartial: true,
    }),
    false,
  );
});

test("canonical signal monitor event eligibility is shared by matrix and symbol paths", () => {
  const evaluatedAt = new Date("2026-06-09T16:50:10.000Z");
  const signalAt = new Date("2026-06-09T16:40:00.000Z");

  assert.equal(
    __signalMonitorInternalsForTests.shouldPersistCanonicalSignalMonitorEvent({
      fresh: true,
      barsSinceSignal: 2,
      freshWindowBars: 3,
      signalAt,
      evaluatedAt,
      sourceBarPartial: false,
    }),
    true,
  );
  assert.equal(
    __signalMonitorInternalsForTests.shouldPersistCanonicalSignalMonitorEvent({
      fresh: true,
      barsSinceSignal: 1,
      freshWindowBars: 3,
      signalAt,
      evaluatedAt,
      sourceBarPartial: true,
    }),
    false,
  );
});

test("signal monitor event pagination reports source status", () => {
  const response =
    __signalMonitorInternalsForTests.paginateSignalMonitorEventResponses(
      [
        {
          id: "event-1",
          profileId: "profile-1",
          environment: "paper",
          symbol: "SPY",
          timeframe: "5m",
          direction: "buy",
          signalAt: new Date("2026-06-09T16:40:00.000Z"),
          signalPrice: 100,
          close: 100,
          emittedAt: new Date("2026-06-09T16:40:01.000Z"),
          source: "pyrus-signals",
          payload: {},
        },
      ],
      100,
      "runtime-fallback",
    );

  assert.equal(response.sourceStatus, "runtime-fallback");
  assert.equal(response.hasMore, false);
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

test("enabled signal monitor profile symbols stay passive by default", async () => {
  const previousPyrusFlag =
    process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  const previousLegacyFlag =
    process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  delete process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  delete process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  try {
    const now = new Date("2026-06-08T15:00:00.000Z");
    const result = await evaluateSignalMonitorProfileSymbols({
      profile: {
        id: "enabled-profile",
        environment: "paper",
        enabled: true,
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

    assert.equal(result.profile.enabled, true);
    assert.deepEqual(result.states, []);
    assert.deepEqual(result.universeSymbols, ["SPY", "QQQ"]);
    assert.equal(
      result.universe.degradedReason,
      __signalMonitorInternalsForTests.SIGNAL_MONITOR_PASSIVE_SIGNAL_SOURCE_MESSAGE,
    );
  } finally {
    if (previousPyrusFlag === undefined) {
      delete process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
    } else {
      process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] =
        previousPyrusFlag;
    }
    if (previousLegacyFlag === undefined) {
      delete process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
    } else {
      process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] =
        previousLegacyFlag;
    }
  }
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
