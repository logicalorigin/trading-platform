import assert from "node:assert/strict";
import test from "node:test";

import { GetSignalMonitorStateResponse } from "@workspace/api-zod";

import { __signalMonitorInternalsForTests } from "./signal-monitor";

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

test("quiet automatic matrix stored coverage does not refresh in background", () => {
  assert.equal(
    __signalMonitorInternalsForTests.shouldRefreshSignalMonitorMatrixStoredCoverageInBackground({
      evaluatedAt: new Date("2026-06-08T01:00:00.000Z"),
    }),
    false,
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

  assert.equal(settings.maxSymbols, 20);
  assert.equal(
    __signalMonitorInternalsForTests.resolveSignalMonitorMatrixExactCellCap({
      pressure: "high",
      clientRole: undefined,
      requestOrigin: undefined,
      cells: [],
    }),
    120,
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

test("oversized exact matrix evaluation is rejected before inline work", () => {
  const cells = Array.from({ length: 121 }, (_value, index) => ({
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
