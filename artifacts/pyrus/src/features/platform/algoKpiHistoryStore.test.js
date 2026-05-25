import assert from "node:assert/strict";
import test from "node:test";

import {
  algoKpiHistoryStore,
  buildKpiSample,
  pruneAlgoKpiHistory,
  pushAlgoKpiSample,
  seriesFromBuffer,
} from "./algoKpiHistoryStore";

test("push appends samples to the buffer for the given deployment", () => {
  algoKpiHistoryStore.__resetForTests();
  pushAlgoKpiSample("dep-1", { timestampMs: 1, realized: 100 });
  pushAlgoKpiSample("dep-1", { timestampMs: 2, realized: 150 });
  const buffer = algoKpiHistoryStore.getBuffer("dep-1");
  assert.equal(buffer.length, 2);
  assert.equal(buffer[0].realized, 100);
  assert.equal(buffer[1].realized, 150);
});

test("buffer caps at the configured capacity (default 60)", () => {
  algoKpiHistoryStore.__resetForTests();
  for (let i = 0; i < 80; i += 1) {
    pushAlgoKpiSample("dep-1", { timestampMs: i, realized: i });
  }
  const buffer = algoKpiHistoryStore.getBuffer("dep-1");
  assert.equal(buffer.length, 60);
  assert.equal(buffer[0].realized, 20);
  assert.equal(buffer.at(-1).realized, 79);
});

test("prune drops buffers for deployments other than the active one", () => {
  algoKpiHistoryStore.__resetForTests();
  pushAlgoKpiSample("dep-1", { timestampMs: 1, realized: 1 });
  pushAlgoKpiSample("dep-2", { timestampMs: 2, realized: 2 });
  pruneAlgoKpiHistory("dep-1");
  assert.equal(algoKpiHistoryStore.getBuffer("dep-1").length, 1);
  assert.equal(algoKpiHistoryStore.getBuffer("dep-2").length, 0);
});

test("buildKpiSample folds cockpit + performance values into one record", () => {
  const sample = buildKpiSample({
    cockpitKpis: { dailyRealizedPnl: 1247.5, openUnrealizedPnl: 182.1, openPositions: 12 },
    cockpitSignalFreshness: { fresh: 14 },
    signalOptionsPerformanceSummary: { winRatePercent: 70, profitFactor: 1.84 },
    signalOptionsPositions: [],
    timestampMs: 1000,
  });
  assert.equal(sample.realized, 1247.5);
  assert.equal(sample.unrealized, 182.1);
  assert.equal(sample.winRate, 70);
  assert.equal(sample.profitFactor, 1.84);
  assert.equal(sample.freshSignals, 14);
  assert.equal(sample.openPositions, 12);
  assert.equal(sample.timestampMs, 1000);
});

test("seriesFromBuffer extracts a single metric across the buffer", () => {
  const buffer = [
    { realized: 100 },
    { realized: 150 },
    { realized: 175 },
  ];
  assert.deepEqual(seriesFromBuffer(buffer, "realized"), [100, 150, 175]);
});

test("seriesFromBuffer treats missing values as 0", () => {
  const buffer = [{ realized: 100 }, {}, { realized: 150 }];
  assert.deepEqual(seriesFromBuffer(buffer, "realized"), [100, 0, 150]);
});

test("store emits to subscribers on push", () => {
  algoKpiHistoryStore.__resetForTests();
  let calls = 0;
  const unsubscribe = algoKpiHistoryStore.subscribe(() => {
    calls += 1;
  });
  pushAlgoKpiSample("dep-1", { timestampMs: 1, realized: 100 });
  pushAlgoKpiSample("dep-1", { timestampMs: 2, realized: 150 });
  unsubscribe();
  assert.equal(calls, 2);
});
