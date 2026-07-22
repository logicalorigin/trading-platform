import assert from "node:assert/strict";
import test from "node:test";

import type { AlgoDeployment } from "@workspace/db";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";
import {
  createSignalOptionsWorker,
  resolveWorkerScanTimeoutMs,
} from "./signal-options-worker";
import type { OvernightSpotWorkerDeployment } from "./overnight-spot-execution";
import { createOvernightSpotWorker } from "./overnight-spot-worker";
import { createSignalMonitorEvaluationWorker } from "./signal-monitor-evaluation-worker";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
};

function createTestAdvisoryLease(onRelease: () => void = () => {}) {
  const controller = new AbortController();
  const lease = Object.assign(
    async () => {
      controller.abort();
      onRelease();
    },
    { signal: controller.signal },
  );
  return { controller, lease };
}

async function waitForAssertion(assertion: () => void) {
  let error: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (candidate) {
      error = candidate;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  throw error;
}

type FakeTimer = {
  callback: () => void;
  delayMs: number;
  cleared: boolean;
  fired: boolean;
  unref: () => void;
};

function createFakeTimers() {
  const timers: FakeTimer[] = [];
  return {
    setTimer(callback: () => void, delayMs: number) {
      const timer = {
        callback,
        delayMs,
        cleared: false,
        fired: false,
        unref() {},
      };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer(timer: ReturnType<typeof setTimeout>) {
      (timer as unknown as FakeTimer).cleared = true;
    },
    pending(delayMs: number) {
      return timers.filter(
        (timer) =>
          !timer.cleared && !timer.fired && timer.delayMs === delayMs,
      );
    },
  };
}

function highFiniteResourcePressureSnapshot() {
  __resetApiResourcePressureForTests();
  // Two sustained samples of a SATURATED pool with a deep wait-queue enter "high"
  // finite-resource pressure (pool exhaustion) via the 2-sample hysteresis. This
  // is what drives isApiResourcePressureHardBlock now — a busy event loop no
  // longer does (finite-resource decouple), so the old event-loop-only snapshot
  // stopped tripping the hard block.
  const saturatedPool = {
    dbPoolActive: 12,
    dbPoolMax: 12,
    dbPoolWaiting: 8,
  };
  updateApiResourcePressure(saturatedPool);
  return updateApiResourcePressure(saturatedPool);
}

function normalPressureSnapshot() {
  __resetApiResourcePressureForTests();
  return updateApiResourcePressure({
    apiP95LatencyMs: 100,
    dominantSlowRouteP95Ms: 100,
  });
}

function signalOptionsDeployment(
  id = "signal-options-test",
): AlgoDeployment {
  return {
    id,
    enabled: true,
    mode: "shadow",
    providerAccountId: null,
    symbolUniverse: ["SPY"],
    config: {
      signalOptions: {
        worker: { pollIntervalSeconds: 15 },
      },
    },
  } as unknown as AlgoDeployment;
}

test("signal-options worker degrades to a positions-only scan under high resource pressure (does not fully pause)", async () => {
  highFiniteResourcePressureSnapshot();
  let maintenanceCount = 0;
  const scanCalls: Record<string, unknown>[] = [];
  const { lease: releaseLock } = createTestAdvisoryLease();
  const deployment = signalOptionsDeployment();

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async (input) => {
      scanCalls.push(input as Record<string, unknown>);
      return {};
    },
    runOpenSafety: async () => {
      maintenanceCount += 1;
      return {};
    },
    runClosedReconciliation: async () => ({}),
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(maintenanceCount, 1);
  // Owner directive 2026-07-07: entries never pause under pressure. The scan
  // runs in full — pressure recovery comes from demand fixes, not trading stops.
  assert.equal(scanCalls.length, 1);
  assert.equal(scanCalls[0]?.["skipEntryWork"], false);
  assert.equal(scanCalls[0]?.["source"], "worker");
  assert.equal(snapshot.scanEnabled, true);
  assert.equal(snapshot.deploymentCount, 1);
  assert.notEqual(
    snapshot.deployments[0]?.lastSkipReason,
    "resource_pressure",
  );
  assert.equal(snapshot.maintenance.runCount, 1);

  __resetApiResourcePressureForTests();
});

test("signal-options worker bounds action work by elapsed time without a fixed candidate count", async () => {
  normalPressureSnapshot();
  const scanCalls: unknown[] = [];
  let releaseCount = 0;
  let setTimerCount = 0;
  const deployment = signalOptionsDeployment();
  const releaseLease = createTestAdvisoryLease(() => {
    releaseCount += 1;
  });

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async (input) => {
      scanCalls.push(input);
      return {
        summary: {
          signalCount: 3,
          freshSignalCount: 1,
          staleSignalCount: 2,
          unavailableSignalCount: 0,
          latestSignalBarAt: "2026-06-09T18:40:00.000Z",
          oldestSignalBarAt: "2026-06-09T18:20:00.000Z",
          candidateCount: 1,
          blockedCandidateCount: 0,
          activePositionCount: 1,
          lastSignalScanAt: "2026-06-09T18:41:00.000Z",
          signalSourcePolicy: "stored",
          heavyWorkDeferred: false,
          activeScanPhase: "action_scan",
          batch: {
            symbols: ["SPY"],
            universeCount: 1,
            batchSize: 1,
            startIndex: 0,
            nextIndex: 0,
            capacity: 12,
            fullUniverse: true,
          },
        },
      };
    },
    runOpenSafety: async () => ({}),
    runClosedReconciliation: async () => ({}),
    acquireTickLock: async () => releaseLease.lease,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
    setTimer: () => {
      setTimerCount += 1;
      return { unref() {} } as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {},
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(scanCalls.length, 1);
  const scanCall = scanCalls[0] as Record<string, unknown>;
  assert.equal(scanCall["deploymentId"], deployment.id);
  assert.equal(scanCall["forceEvaluate"], false);
  assert.equal(scanCall["preferStoredMonitorState"], true);
  assert.equal(scanCall["source"], "worker");
  assert.equal(scanCall["actionWorkBudgetMs"], 60_000);
  assert.equal(scanCall["actionWorkItemLimit"], null);
  assert.ok(scanCall["signal"] instanceof AbortSignal);
  assert.equal(releaseCount, 1);
  assert.equal(setTimerCount, 0);
  assert.equal(snapshot.scanEnabled, true);
  assert.equal(snapshot.tickRunning, false);
  assert.equal(snapshot.deploymentCount, 1);
  assert.equal(snapshot.activeDeploymentCount, 0);
  assert.equal(snapshot.deployments[0]?.scanCount, 1);
  assert.equal(snapshot.deployments[0]?.lastCandidateCount, 1);
  assert.equal(snapshot.deployments[0]?.lastActivePositionCount, 1);
  assert.deepEqual(snapshot.deployments[0]?.lastBatchSymbols, ["SPY"]);

  __resetApiResourcePressureForTests();
});

test("signal-options worker default scan timeout scales with active positions unless overridden", () => {
  assert.equal(resolveWorkerScanTimeoutMs(undefined, 0, undefined), 120_000);
  assert.equal(resolveWorkerScanTimeoutMs(undefined, 10, undefined), 150_000);
  assert.equal(resolveWorkerScanTimeoutMs(undefined, 100, undefined), 300_000);
  assert.equal(resolveWorkerScanTimeoutMs("45000", 100, undefined), 45_000);
  assert.equal(resolveWorkerScanTimeoutMs(undefined, 100, "45000"), 45_000);
  assert.equal(resolveWorkerScanTimeoutMs(null, 100, undefined), null);
});

test("signal-options worker keeps scanning when signal evaluation is passive", async () => {
  normalPressureSnapshot();
  let maintenanceCount = 0;
  let scanCount = 0;
  const { lease: releaseLock } = createTestAdvisoryLease();
  const deployment = signalOptionsDeployment("signal-options-passive-test");

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async () => {
      scanCount += 1;
      return {};
    },
    runOpenSafety: async () => {
      maintenanceCount += 1;
      return {};
    },
    runClosedReconciliation: async () => ({}),
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();

  assert.equal(maintenanceCount, 1);
  assert.equal(scanCount, 1);
  assert.equal(worker.getRuntimeSnapshot().scanEnabled, true);

  __resetApiResourcePressureForTests();
});

test("signal monitor worker stays idle in passive mode", async () => {
  let lockCount = 0;
  let subscribeCount = 0;
  const worker = createSignalMonitorEvaluationWorker({
    isSignalMonitorBarEvaluationEnabled: () => false,
    acquireTickLock: async () => {
      lockCount += 1;
      return createTestAdvisoryLease().lease;
    },
    subscribeStockMinuteAggregates: () => {
      subscribeCount += 1;
      return {
        unsubscribe() {},
        setSymbols() {},
      };
    },
    logger: noopLogger,
  });

  await worker.runOnce();

  assert.equal(lockCount, 0);
  assert.equal(subscribeCount, 0);
});

test("signal-options worker stops the tick when its advisory lease is lost", async () => {
  const lock = createTestAdvisoryLease();
  let closedReconciliationCount = 0;
  let scanCount = 0;
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [signalOptionsDeployment()],
    scanDeployment: async () => {
      scanCount += 1;
      return {};
    },
    runOpenSafety: async () => {
      lock.controller.abort();
      return {};
    },
    runClosedReconciliation: async () => {
      closedReconciliationCount += 1;
      return {};
    },
    acquireTickLock: async () => lock.lease,
    now: () => new Date("2026-07-16T12:00:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();

  assert.equal(closedReconciliationCount, 0);
  assert.equal(scanCount, 0);
});

test("overnight worker stops before scanning after advisory lease loss", async () => {
  const lock = createTestAdvisoryLease();
  let scanCount = 0;
  const worker = createOvernightSpotWorker({
    listDeployments: async () => {
      lock.controller.abort();
      return [
        {
          id: "overnight-lease-loss",
          enabled: true,
          mode: "shadow",
          providerAccountId: null,
          symbolUniverse: ["SPY"],
          config: { overnightSpot: { worker: { pollIntervalSeconds: 15 } } },
        } as unknown as OvernightSpotWorkerDeployment,
      ];
    },
    scanDeployment: async () => {
      scanCount += 1;
      throw new Error("scan must not start after lease loss");
    },
    getResourcePressure: normalPressureSnapshot,
    getMarketSessionKey: () => "overnight",
    acquireTickLock: async () => lock.lease,
    now: () => new Date("2026-07-16T06:00:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();

  assert.equal(scanCount, 0);
});

test("signal monitor worker does not persist errors after advisory lease loss", async () => {
  const lock = createTestAdvisoryLease();
  let profileErrorWrites = 0;
  const worker = createSignalMonitorEvaluationWorker({
    isSignalMonitorBarEvaluationEnabled: () => true,
    listProfiles: async () => {
      lock.controller.abort();
      return [{ id: "lease-loss-profile", enabled: true } as never];
    },
    resolveUniverse: (async () => {
      throw new Error("profile work must not start after lease loss");
    }) as never,
    updateProfileLastError: async () => {
      profileErrorWrites += 1;
    },
    isStockAggregateStreamingAvailable: () => false,
    acquireTickLock: async () => lock.lease,
    subscribeStockMinuteAggregates: () => ({
      unsubscribe() {},
      setSymbols() {},
    }),
    logger: noopLogger,
  });

  await worker.runOnce();

  assert.equal(profileErrorWrites, 0);
});

test("signal monitor worker passes its advisory lease signal into stateful evaluation", async () => {
  const lock = createTestAdvisoryLease();
  let evaluatorSignal: AbortSignal | undefined;
  const worker = createSignalMonitorEvaluationWorker({
    isSignalMonitorBarEvaluationEnabled: () => true,
    listProfiles: async () => [
      {
        id: "lease-fenced-evaluator",
        enabled: true,
        timeframe: "1m",
        pollIntervalSeconds: 15,
      } as never,
    ],
    resolveUniverse: (async () => ({
      profile: {
        id: "lease-fenced-evaluator",
        timeframe: "1m",
        pollIntervalSeconds: 15,
      },
      symbols: ["SPY"],
      universe: { pinnedSymbols: 1 },
    })) as never,
    loadCompletedBars: (async () => ({
      bars: [{}],
      latestBarAt: new Date("2026-07-16T15:59:00.000Z"),
    })) as never,
    evaluateSymbolFromCompletedBars: (async (input: {
      signal?: AbortSignal;
    }) => {
      evaluatorSignal = input.signal;
      return { symbol: "SPY", status: "ok", currentSignalAt: null };
    }) as never,
    updateProfileEvaluationMetadata: async (input) => input.profile,
    updateProfileLastError: async () => {},
    isStockAggregateStreamingAvailable: () => false,
    acquireTickLock: async () => lock.lease,
    subscribeStockMinuteAggregates: () => ({
      unsubscribe() {},
      setSymbols() {},
    }),
    historyBatchMaxSymbols: 1,
    now: () => new Date("2026-07-16T16:00:00.000Z"),
    logger: noopLogger,
  });

  await worker.runOnce();

  assert.equal(evaluatorSignal, lock.lease.signal);
});

test("signal monitor stream-fresh error clearing carries the evaluated-at lease fence", async () => {
  const lock = createTestAdvisoryLease();
  const evaluatedAt = new Date("2026-07-16T16:00:00.000Z");
  let receivedEvaluatedAt: Date | undefined;
  let receivedSignal: AbortSignal | undefined;
  const worker = createSignalMonitorEvaluationWorker({
    isSignalMonitorBarEvaluationEnabled: () => true,
    listProfiles: async () => [
      {
        id: "lease-fenced-error-clear",
        enabled: true,
        timeframe: "1m",
        pollIntervalSeconds: 15,
        lastError: "stale error",
      } as never,
    ],
    resolveUniverse: (async () => ({
      profile: {
        id: "lease-fenced-error-clear",
        timeframe: "1m",
        pollIntervalSeconds: 15,
      },
      symbols: [],
      universe: { pinnedSymbols: 0 },
    })) as never,
    updateProfileLastError: async (
      _profileId: string,
      _message: string | null,
      receivedAt?: Date,
      signal?: AbortSignal,
    ) => {
      receivedEvaluatedAt = receivedAt;
      receivedSignal = signal;
      lock.controller.abort(new Error("lease lost during error clear"));
    },
    isStockAggregateStreamingAvailable: () => true,
    hasRecentStockAggregateSourceActivity: () => true,
    acquireTickLock: async () => lock.lease,
    subscribeStockMinuteAggregates: () => ({
      unsubscribe() {},
      setSymbols() {},
    }),
    now: () => evaluatedAt,
    logger: noopLogger,
  } as never);

  await worker.runOnce();

  assert.equal(receivedEvaluatedAt, evaluatedAt);
  assert.equal(receivedSignal, lock.lease.signal);
});

test("signal-monitor and overnight worker failures never retain credential-bearing errors", async () => {
  const secret = "cross-worker-error-secret";
  const error = new Error(
    `provider failed at https://operator:${secret}@provider.invalid/path?token=${secret}`,
  );
  const monitorErrors: Array<string | null> = [];
  const monitorLogs: unknown[] = [];
  const monitor = createSignalMonitorEvaluationWorker({
    isSignalMonitorBarEvaluationEnabled: () => true,
    listProfiles: async () => [{ id: "safe-error-profile", enabled: true } as never],
    resolveUniverse: (async () => {
      throw error;
    }) as never,
    updateProfileLastError: async (_profileId, message) => {
      monitorErrors.push(message);
    },
    isStockAggregateStreamingAvailable: () => false,
    acquireTickLock: async () => createTestAdvisoryLease().lease,
    subscribeStockMinuteAggregates: () => ({
      unsubscribe() {},
      setSymbols() {},
    }),
    logger: {
      ...noopLogger,
      warn: ((payload: unknown) => monitorLogs.push(payload)) as never,
    },
  });
  await monitor.runOnce();

  const overnightLogs: unknown[] = [];
  const overnight = createOvernightSpotWorker({
    listDeployments: async () => [
      {
        id: "safe-error-overnight",
        enabled: true,
        mode: "shadow",
        providerAccountId: null,
        symbolUniverse: ["SPY"],
        config: { overnightSpot: { worker: { pollIntervalSeconds: 15 } } },
      } as unknown as OvernightSpotWorkerDeployment,
    ],
    scanDeployment: async () => {
      throw error;
    },
    getResourcePressure: normalPressureSnapshot,
    getMarketSessionKey: () => "overnight",
    acquireTickLock: async () => createTestAdvisoryLease().lease,
    now: () => new Date("2026-07-16T06:00:00.000Z"),
    logger: {
      ...noopLogger,
      warn: ((payload: unknown) => overnightLogs.push(payload)) as never,
    },
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });
  await overnight.runOnce();

  const retained = JSON.stringify({
    monitorErrors,
    monitorLogs,
    overnightLogs,
    overnight: overnight.getRuntimeSnapshot(),
  });
  assert.doesNotMatch(retained, new RegExp(secret, "u"));
  assert.doesNotMatch(retained, /https:\/\/operator|\?token=/u);
});

test("signal-options worker retains its lease until a timed-out scan settles", async () => {
  const timers = createFakeTimers();
  let settleScan!: (value: unknown) => void;
  let scanSignal: AbortSignal | undefined;
  let releaseCount = 0;
  let runSettled = false;
  const scan = new Promise<unknown>((resolve) => {
    settleScan = resolve;
  });
  const lock = createTestAdvisoryLease(() => {
    releaseCount += 1;
  });
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [signalOptionsDeployment("timeout-lease")],
    scanDeployment: async (input) => {
      scanSignal = input.signal;
      return scan;
    },
    runOpenSafety: async () => ({}),
    runClosedReconciliation: async () => ({}),
    acquireTickLock: async () => lock.lease,
    now: () => new Date("2026-07-16T12:00:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: 1_000,
    subscribeCockpitChanges: () => () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const running = worker.runOnce().finally(() => {
    runSettled = true;
  });
  await waitForAssertion(() => assert.ok(timers.pending(1_000)[0]));
  const timeout = timers.pending(1_000)[0]!;
  timeout.fired = true;
  timeout.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(scanSignal?.aborted, true);
  assert.equal(releaseCount, 0);
  assert.equal(runSettled, false);

  settleScan({});
  await running;
  assert.equal(releaseCount, 1);
  assert.equal(runSettled, true);
});

test("overnight worker retains its lease until a timed-out scan settles", async () => {
  const timers = createFakeTimers();
  let settleScan!: (value: never) => void;
  let scanSignal: AbortSignal | undefined;
  let releaseCount = 0;
  let runSettled = false;
  const scan = new Promise<never>((resolve) => {
    settleScan = resolve;
  });
  const lock = createTestAdvisoryLease(() => {
    releaseCount += 1;
  });
  const worker = createOvernightSpotWorker({
    listDeployments: async () => [
      {
        id: "overnight-timeout-lease",
        enabled: true,
        mode: "shadow",
        providerAccountId: null,
        symbolUniverse: ["SPY"],
        config: { overnightSpot: { worker: { pollIntervalSeconds: 15 } } },
      } as unknown as OvernightSpotWorkerDeployment,
    ],
    scanDeployment: async (input) => {
      scanSignal = input.signal;
      return scan;
    },
    getResourcePressure: normalPressureSnapshot,
    getMarketSessionKey: () => "overnight",
    acquireTickLock: async () => lock.lease,
    now: () => new Date("2026-07-16T06:00:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: 5_000,
    subscribeCockpitChanges: () => () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const running = worker.runOnce().finally(() => {
    runSettled = true;
  });
  await waitForAssertion(() => assert.ok(timers.pending(5_000)[0]));
  const timeout = timers.pending(5_000)[0]!;
  timeout.fired = true;
  timeout.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(scanSignal?.aborted, true);
  assert.equal(releaseCount, 0);
  assert.equal(runSettled, false);

  settleScan(undefined as never);
  await running;
  assert.equal(releaseCount, 1);
  assert.equal(runSettled, true);
});

test("signal-options worker schedules open safety and closed reconciliation independently", async () => {
  const startedAtMs = new Date("2026-07-15T12:00:00.000Z").getTime();
  let nowMs = startedAtMs;
  let openSafetyCount = 0;
  let closedReconciliationCount = 0;

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [],
    scanDeployment: async () => ({}),
    runOpenSafety: async () => {
      openSafetyCount += 1;
      return { closedCount: 2 };
    },
    runClosedReconciliation: async () => {
      closedReconciliationCount += 1;
      if (closedReconciliationCount === 2) {
        throw new Error("closed pass threw");
      }
      return { reconciledCount: 3 };
    },
    acquireTickLock: async () => createTestAdvisoryLease().lease,
    now: () => new Date(nowMs),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  for (let wake = 0; wake < 12; wake += 1) {
    await worker.runOnce();
    nowMs += 5_000;
  }

  assert.equal(openSafetyCount, 12);
  assert.equal(closedReconciliationCount, 1);
  nowMs = startedAtMs + 899_999;
  await worker.runOnce();
  assert.equal(closedReconciliationCount, 1);
  nowMs = startedAtMs + 900_000;
  await worker.runOnce();
  assert.equal(closedReconciliationCount, 2);

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(snapshot.maintenance.runCount, 14);
  assert.equal(snapshot.maintenance.totalClosedCount, 28);
  assert.deepEqual(snapshot.openSafety, snapshot.maintenance);
  assert.equal(snapshot.closedReconciliation.runCount, 2);
  assert.equal(
    snapshot.closedReconciliation.lastRunAt,
    "2026-07-15T12:15:00.000Z",
  );
  assert.equal(snapshot.closedReconciliation.lastError, "closed pass threw");
  assert.equal(snapshot.closedReconciliation.reconciledCount, 3);
});

test("signal-options worker ordinary run-soon wake respects the closed cooldown", async () => {
  const timers = createFakeTimers();
  let openSafetyCount = 0;
  let closedReconciliationCount = 0;
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [],
    scanDeployment: async () => ({}),
    runOpenSafety: async () => {
      openSafetyCount += 1;
      return {};
    },
    runClosedReconciliation: async () => {
      closedReconciliationCount += 1;
      return {};
    },
    acquireTickLock: async () => createTestAdvisoryLease().lease,
    now: () => new Date("2026-07-15T12:00:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  worker.start();
  await waitForAssertion(() => {
    assert.equal(openSafetyCount, 1);
    assert.equal(closedReconciliationCount, 1);
  });
  worker.requestRunSoon();
  const immediateWake = timers.pending(0)[0];
  assert.ok(immediateWake);
  immediateWake.fired = true;
  immediateWake.callback();
  await waitForAssertion(() => assert.equal(openSafetyCount, 2));
  assert.equal(closedReconciliationCount, 1);
  worker.stop();
});

test("signal-options worker keeps an explicit closed repair pending across a lock miss", async () => {
  const timers = createFakeTimers();
  let grantLock = true;
  let lockAttemptCount = 0;
  let openSafetyCount = 0;
  let closedReconciliationCount = 0;
  let worker: ReturnType<typeof createSignalOptionsWorker>;
  worker = createSignalOptionsWorker({
    listDeployments: async () => [],
    scanDeployment: async () => ({}),
    runOpenSafety: async () => {
      openSafetyCount += 1;
      return {};
    },
    runClosedReconciliation: async () => {
      closedReconciliationCount += 1;
      if (closedReconciliationCount === 2) {
        worker.requestClosedRepair();
      }
      return {};
    },
    acquireTickLock: async () => {
      lockAttemptCount += 1;
      return grantLock ? createTestAdvisoryLease().lease : null;
    },
    now: () => new Date("2026-07-15T12:00:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  worker.start();
  await waitForAssertion(() => assert.equal(closedReconciliationCount, 1));
  grantLock = false;
  worker.requestClosedRepair();
  worker.requestClosedRepair();
  const immediateWakes = timers.pending(0);
  assert.equal(immediateWakes.length, 1);
  immediateWakes[0]?.callback();
  if (immediateWakes[0]) immediateWakes[0].fired = true;
  await waitForAssertion(() => {
    assert.equal(lockAttemptCount, 2);
    assert.ok(
      timers.pending(5_000).length > 0,
    );
  });
  assert.equal(closedReconciliationCount, 1);
  assert.equal(
    timers.pending(0).length,
    0,
  );

  grantLock = true;
  const fallbackWake = timers.pending(5_000)[0];
  assert.ok(fallbackWake);
  fallbackWake.fired = true;
  fallbackWake.callback();
  await waitForAssertion(() => assert.equal(closedReconciliationCount, 2));
  assert.equal(openSafetyCount, 2);

  const nextWake = timers.pending(5_000)[0];
  assert.ok(nextWake);
  nextWake.fired = true;
  nextWake.callback();
  await waitForAssertion(() => assert.equal(openSafetyCount, 3));
  assert.equal(closedReconciliationCount, 3);
  worker.stop();
});

test("signal-options worker reports isolated closed reconciliation errors", async () => {
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [],
    scanDeployment: async () => ({}),
    runOpenSafety: async () => ({ closedCount: 1 }),
    runClosedReconciliation: async () => ({
      reconciledCount: 2,
      errors: [
        {
          positionId: "reconcile",
          symbol: "*",
          reason: "closed scan failed",
        },
      ],
    }),
    acquireTickLock: async () => createTestAdvisoryLease().lease,
    now: () => new Date("2026-07-15T12:00:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(snapshot.maintenance.lastError, null);
  assert.equal(snapshot.closedReconciliation.runCount, 1);
  assert.equal(snapshot.closedReconciliation.lastError, "closed scan failed");
  assert.equal(snapshot.closedReconciliation.reconciledCount, 2);
});

test("overnight spot worker degrades to an exit-only scan under high resource pressure (outside RTH)", async () => {
  const pressure = highFiniteResourcePressureSnapshot();
  const scanCalls: Record<string, unknown>[] = [];
  const { lease: releaseLock } = createTestAdvisoryLease();
  const deployment = {
    id: "overnight-spot-test",
    enabled: true,
    mode: "shadow",
    providerAccountId: null,
    symbolUniverse: ["SPY"],
    config: {
      overnightSpot: {
        worker: { pollIntervalSeconds: 15 },
      },
    },
  } as unknown as OvernightSpotWorkerDeployment;

  const worker = createOvernightSpotWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async (input) => {
      scanCalls.push(input as Record<string, unknown>);
      return {
        deploymentId: deployment.id,
        executionMode: "shadow",
        runActions: true,
        candidateCount: 0,
        trackedCount: 0,
        executedCount: 0,
        blockedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        results: [],
      };
    },
    getResourcePressure: () => pressure,
    // Overnight session so the RTH full-pause does not pre-empt the pressure path.
    getMarketSessionKey: () => "overnight",
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T06:41:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  // Owner directive 2026-07-07: entries never pause under pressure — the worker
  // no longer sets skipEntryWork at all. RTH still fully pauses elsewhere.
  assert.equal(scanCalls.length, 1);
  assert.equal(scanCalls[0]?.["skipEntryWork"], undefined);
  assert.notEqual(
    snapshot.deployments[0]?.lastSkipReason,
    "resource_pressure",
  );

  __resetApiResourcePressureForTests();
});

test("entry work runs on every tick under sustained hard block (no pressure gate)", async () => {
  highFiniteResourcePressureSnapshot();
  const scanCalls: Record<string, unknown>[] = [];
  let nowMs = new Date("2026-06-09T18:41:00.000Z").getTime();

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [signalOptionsDeployment()],
    scanDeployment: async (input) => {
      scanCalls.push(input as Record<string, unknown>);
      return {};
    },
    runOpenSafety: async () => ({}),
    runClosedReconciliation: async () => ({}),
    acquireTickLock: async () => createTestAdvisoryLease().lease,
    now: () => new Date(nowMs),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  for (let tick = 0; tick < 21; tick += 1) {
    await worker.runOnce();
    nowMs += 16_000;
  }

  assert.equal(scanCalls.length, 21);
  // Owner directive 2026-07-07: the entry gate and its starvation floor are
  // removed — every tick runs full entry work even under sustained hard block.
  assert.equal(
    scanCalls.filter((call) => call["skipEntryWork"] === false).length,
    21,
  );

  __resetApiResourcePressureForTests();
});
