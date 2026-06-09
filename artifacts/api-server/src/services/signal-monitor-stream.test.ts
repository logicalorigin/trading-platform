import assert from "node:assert/strict";
import test from "node:test";

import { __signalMonitorInternalsForTests } from "./signal-monitor";

const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");

function profile(id = "profile-test") {
  return {
    id,
    environment: "paper",
    enabled: true,
    watchlistId: null,
    timeframe: "15m",
    pyrusSignalsSettings: {},
    freshWindowBars: 3,
    pollIntervalSeconds: 60,
    maxSymbols: 500,
    evaluationConcurrency: 6,
  } as never;
}

function streamState(symbol: string, timeframe: string, marker: string) {
  return {
    id: `profile-test:${symbol}:${timeframe}`,
    profileId: "profile-test",
    symbol,
    timeframe,
    currentSignalDirection: null,
    currentSignalAt: null,
    currentSignalPrice: null,
    latestBarAt: null,
    barsSinceSignal: null,
    fresh: false,
    status: "unavailable",
    active: true,
    lastEvaluatedAt: evaluatedAt,
    lastError: marker,
    indicatorSnapshot: null,
  } as never;
}

test("signal matrix stream scope treats exact cells as authoritative", () => {
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "paper",
      symbols: ["MSFT"],
      timeframes: ["1d"],
      cells: [
        { symbol: "aapl", timeframe: "5m" },
        { symbol: "AAPL", timeframe: "1m" },
        { symbol: "AAPL", timeframe: "1m" },
        { symbol: "TSLA", timeframe: "bad" },
      ] as never,
      clientRole: "leader",
      requestOrigin: "startup",
    });

  assert.equal(scope.exactCells, true);
  assert.deepEqual(scope.symbols, ["AAPL"]);
  assert.deepEqual(scope.timeframes, ["1m", "5m"]);
  assert.deepEqual(scope.cells, [
    { symbol: "AAPL", timeframe: "1m" },
    { symbol: "AAPL", timeframe: "5m" },
  ]);
});

test("signal matrix stream aggregate evaluation only touches the aggregate symbol", () => {
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "paper",
      symbols: ["AAPL", "MSFT"],
      timeframes: ["1m", "5m"],
    });
  const calls: string[] = [];

  const states =
    __signalMonitorInternalsForTests.evaluateSignalMonitorMatrixStreamScopeDelta({
      scope,
      profile: profile(),
      symbol: "AAPL",
      evaluatedAt,
      evaluateState(input) {
        calls.push(`${input.symbol}:${input.timeframe}`);
        return streamState(input.symbol, input.timeframe, "delta");
      },
    });

  assert.deepEqual(calls, ["AAPL:1m", "AAPL:5m"]);
  assert.equal(states.length, 2);
});

test("signal matrix stream subscription emits changed deltas and cleans up", () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "paper",
      symbols: ["AAPL"],
      timeframes: ["1m"],
    });
  const events: { event: string; states?: unknown[] }[] = [];
  const subscription =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(),
        prime: false,
        onEvent(event) {
          events.push(event);
        },
      },
    );

  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "AAPL" },
    evaluatedAt,
    evaluateState(input) {
      return streamState(input.symbol, input.timeframe, "first");
    },
  });
  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "AAPL" },
    evaluatedAt,
    evaluateState(input) {
      return streamState(input.symbol, input.timeframe, "first");
    },
  });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "state-delta");
  assert.equal(events[0]?.states?.length, 1);

  subscription.unsubscribe();
  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "AAPL" },
    evaluatedAt,
    evaluateState(input) {
      return streamState(input.symbol, input.timeframe, "after-cleanup");
    },
  });
  assert.equal(events.length, 1);
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("signal matrix stream bootstrap event includes coverage metadata", () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "paper",
      cells: [{ symbol: "AAPL", timeframe: "1m" }] as never,
    });
  const state = streamState("AAPL", "1m", "bootstrap");
  const event =
    __signalMonitorInternalsForTests.buildSignalMonitorMatrixStreamBootstrapEvent(
      {
        profile: { id: "profile-test" },
        states: [state],
        evaluatedAt,
        timeframes: ["1m"],
      } as never,
      scope,
    );

  assert.equal(event.event, "bootstrap");
  assert.equal(event.coverage.taskCount, 1);
  assert.equal(event.coverage.stateCount, 1);
  assert.equal(event.coverage.activeScopeSymbols, 1);
});
