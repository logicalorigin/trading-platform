import assert from "node:assert/strict";
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
