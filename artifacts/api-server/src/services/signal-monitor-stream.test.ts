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

function withSignalMonitorBarEvaluationEnabled<T>(run: () => T): T {
  const previousPyrusFlag =
    process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  const previousLegacyFlag =
    process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] = "1";
  delete process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  try {
    return run();
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
  withSignalMonitorBarEvaluationEnabled(() => {
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
});

test("signal matrix stream aggregate evaluation runs regardless of bar-evaluation flag", () => {
  const previousPyrusFlag =
    process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  const previousLegacyFlag =
    process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  delete process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  delete process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  try {
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "paper",
        symbols: ["AAPL"],
        timeframes: ["1m"],
      });
    const calls: string[] = [];

    // The live emit path (stream -> delta) must produce signals even with
    // bar-evaluation off; that flag now only gates legacy backfill scanning.
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

    assert.deepEqual(calls, ["AAPL:1m"]);
    assert.equal(states.length, 1);
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

test("signal matrix stream subscription emits changed deltas and cleans up", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
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
});

test("server-owned producer scope normalizes and dedupes universe symbols", () => {
  const scope =
    __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope({
      environment: "paper",
      symbols: ["aapl", "AAPL", " msft ", ""],
      timeframes: ["1m", "5m"],
    });

  assert.deepEqual(scope.symbols, ["AAPL", "MSFT"]);
  assert.equal(scope.exactCells, false);
  assert.deepEqual(scope.timeframes, ["1m", "5m"]);
  assert.equal(scope.requestedSymbolCount, 2);
});

test("server-owned producer evaluates bar-close ticks with no UI subscriber", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope(
        {
          environment: "paper",
          symbols: ["AAPL", "MSFT"],
          timeframes: ["1m"],
        },
      );
    // Register the server-owned producer (no UI client connected).
    __signalMonitorInternalsForTests.registerSignalMonitorServerOwnedProducer({
      environment: "paper",
      profile: profile(),
      scope,
    });

    const evalCalls: string[] = [];
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      evaluatedAt,
      evaluateState(input) {
        evalCalls.push(`${input.symbol}:${input.timeframe}`);
        return streamState(input.symbol, input.timeframe, "server-owned");
      },
    });

    // The producer evaluated the universe symbol despite zero UI subscribers,
    // and only for the tick's symbol (keystone gap fixed).
    assert.deepEqual(evalCalls, ["AAPL:1m"]);
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("matrix producer still bails when neither client nor server-owned producer is present", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const evalCalls: string[] = [];
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      evaluatedAt,
      evaluateState(input) {
        evalCalls.push(`${input.symbol}:${input.timeframe}`);
        return streamState(input.symbol, input.timeframe, "noop");
      },
    });

    // No subscriber and no server-owned producer => no evaluation work.
    assert.equal(evalCalls.length, 0);
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
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
