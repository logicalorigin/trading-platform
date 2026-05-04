import assert from "node:assert/strict";
import test from "node:test";
import type { SignalMonitorProfileRow } from "./signal-monitor";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

const signalMonitorModule = await import("./signal-monitor");
const {
  aggregateCompletedMinuteBars,
  evaluateSignalMonitorMatrixStateFromCompletedBars,
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
