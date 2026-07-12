import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptanceFailedStepKeys,
  assertStableApiPid,
  diffRuntimeCounters,
  pickRuntimeAcceptanceSnapshot,
  summarizeRuntimeSamples,
} from "./market-open-acceptance-utils.mjs";

function runtime(overrides = {}) {
  return {
    api: {
      memoryMb: { heapUsed: 500, rss: 900 },
      eventLoopDelayMs: { p95: 42 },
      eventLoopUtilization: 0.4,
      resourcePressure: {
        inputs: { dbPoolActive: 4, dbPoolWaiting: 2, dbPoolMax: 12 },
      },
    },
    dbPoolAdmission: {
      lanes: [
        { lane: "interactive", queued: 3, inFlight: 1, admitted: 10 },
        { lane: "background", queued: 1, inFlight: 2, admitted: 20 },
      ],
    },
    ibkr: {
      streams: {
        signalMonitorLocalBars: {
          storedBarsCache: {
            barCount: 100,
            compactBarCount: 100,
            objectBarCount: 0,
            hitCount: 7,
            deltaReadCount: 5,
          },
          storedBarsDelta: { deltaReads: 5, gapFallbacks: 1, shadowMismatches: 0 },
        },
        signalMonitorResidentBars: { completedBarsCache: { entries: 2, bars: 40 } },
        signalMonitorIncrementalEval: {
          seeds: 2,
          appends: 3,
          shadowMismatches: 0,
          matrixServeMismatchCount: 0,
        },
        massiveStockQuotes: { reconnectCount: 4 },
        stockAggregates: {
          massiveDelayedWebSocket: { reconnectCount: 2 },
        },
        signalMatrix: { eventCount: 9, activeScopeSymbols: 3 },
        marketDataAdmission: {
          optionsFlowScanner: {
            coverage: { selectedSymbols: 50, cycleScannedSymbols: 20 },
          },
          ownerClasses: { retiredOwnerCount: 0, unknownOwnerCount: 0 },
          lineOwnership: { lineCount: 8, scannerOverlapLineCount: 0 },
        },
      },
    },
    ...overrides,
  };
}

test("runtime acceptance snapshots include admission waiters and bounded diagnostics", () => {
  const snapshot = pickRuntimeAcceptanceSnapshot(runtime());

  assert.equal(snapshot.db.rawWaiting, 2);
  assert.equal(snapshot.db.admissionQueued, 4);
  assert.equal(snapshot.db.totalWaiting, 6);
  assert.equal(snapshot.counters.storedBarsHitCount, 7);
  assert.equal(snapshot.counters.matrixEventCount, 9);
  assert.equal(snapshot.diagnostics.storedBarsCache.barCount, 100);
  assert.equal(snapshot.diagnostics.scannerCoverage.selectedSymbols, 50);
  assert.equal(JSON.stringify(snapshot).includes("perSymbol"), false);
});

test("runtime counter deltas are scoped to the captured window", () => {
  const before = pickRuntimeAcceptanceSnapshot(runtime());
  const afterRuntime = runtime();
  afterRuntime.ibkr.streams.signalMonitorLocalBars.storedBarsCache.hitCount = 17;
  afterRuntime.ibkr.streams.signalMonitorIncrementalEval.appends = 8;
  const after = pickRuntimeAcceptanceSnapshot(afterRuntime);

  const delta = diffRuntimeCounters(before.counters, after.counters);
  assert.equal(delta.storedBarsHitCount, 10);
  assert.equal(delta.incrementalAppends, 5);
  assert.equal(diffRuntimeCounters({ missing: null }, { missing: null }).missing, null);
});

test("runtime sample summaries preserve peaks and exact-window deltas", () => {
  const first = pickRuntimeAcceptanceSnapshot(runtime());
  const secondRuntime = runtime();
  secondRuntime.api.eventLoopUtilization = 0.8;
  secondRuntime.api.eventLoopDelayMs.p95 = 120;
  secondRuntime.api.memoryMb.heapUsed = 700;
  secondRuntime.api.resourcePressure.inputs.dbPoolWaiting = 5;
  secondRuntime.ibkr.streams.signalMonitorLocalBars.storedBarsCache.hitCount = 12;
  const second = pickRuntimeAcceptanceSnapshot(secondRuntime);

  const summary = summarizeRuntimeSamples([
    { at: "2026-07-13T13:30:00.000Z", fetchDurationMs: 10, snapshot: first },
    { at: "2026-07-13T13:30:05.000Z", fetchDurationMs: 25, snapshot: second },
  ]);
  assert.equal(summary.peakEventLoopUtilization, 0.8);
  assert.equal(summary.peakEventLoopDelayP95Ms, 120);
  assert.equal(summary.peakHeapUsedMb, 700);
  assert.equal(summary.peakDbTotalWaiting, 9);
  assert.equal(summary.peakRuntimeFetchMs, 25);
  assert.equal(summary.averageRuntimeFetchMs, 17.5);
  assert.equal(summary.counterDelta.storedBarsHitCount, 5);
});

test("acceptance fails closed on PID changes and required phase failures", () => {
  assert.doesNotThrow(() => assertStableApiPid(100, 100));
  assert.throws(() => assertStableApiPid(100, 101), /changed from 100 to 101/);
  assert.deepEqual(
    acceptanceFailedStepKeys(
      { identity: { ok: true }, cpuProfile: { ok: false }, counters: { ok: true } },
      ["identity", "cpuProfile", "counters", "allocationProfile"],
    ),
    ["cpuProfile", "allocationProfile"],
  );
});
