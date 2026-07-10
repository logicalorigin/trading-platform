import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  __marketingShadowDashboardInternalsForTests,
  normalizeMarketingShadowDashboardInput,
  subscribeMarketingShadowDashboardSnapshots,
  type MarketingShadowDashboardPayload,
} from "./marketing-shadow-dashboard";
import {
  __resetSseStreamDiagnosticsForTests,
  getSseEmitCounters,
  serializeSseEventData,
} from "./sse-stream-diagnostics";

const { readGenuineDegraded, readGenuineStale, buildWarnings } =
  __marketingShadowDashboardInternalsForTests;

const DB_UNAVAILABLE_REASON =
  "Shadow account database is temporarily unavailable.";

type TimerHandle = {
  callback: () => void;
  unref: () => void;
};

function createFakeTimers() {
  const intervals = new Set<TimerHandle>();
  const timeouts = new Set<TimerHandle>();
  return {
    setInterval: ((callback: () => void) => {
      const handle = { callback, unref: () => {} };
      intervals.add(handle);
      return handle as never;
    }) as unknown as typeof setInterval,
    clearInterval: ((handle: TimerHandle) => {
      intervals.delete(handle);
    }) as unknown as typeof clearInterval,
    setTimeout: ((callback: () => void) => {
      const handle = { callback, unref: () => {} };
      timeouts.add(handle);
      return handle as never;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((handle: TimerHandle) => {
      timeouts.delete(handle);
    }) as unknown as typeof clearTimeout,
    fireIntervals: () => {
      for (const handle of [...intervals]) handle.callback();
    },
  };
}

async function flushAsyncWork() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function marketingPayload(cash: number): MarketingShadowDashboardPayload {
  return {
    status: {
      mode: "shadow",
      source: "shadow-ledger",
      label: "Shadow trading",
      asOf: "2026-07-07T00:00:00.000Z",
      generatedAt: "2026-07-07T00:00:00.000Z",
      lastAccountUpdateAt: "2026-07-07T00:00:00.000Z",
      lastAlgoUpdateAt: null,
      degraded: false,
      stale: false,
      reason: null,
      warnings: [],
    },
    account: {
      summary: {
        currency: "USD",
        netLiquidation: 100,
        cash,
        buyingPower: 100,
        dayPnl: 0,
        dayPnlPercent: 0,
        totalPnl: 0,
        totalPnlPercent: 0,
      },
      equityHistory: [],
      positions: [],
      closedTrades: [],
      orders: { working: [], history: [] },
      risk: {} as never,
      allocation: {} as never,
      tradeStats: {
        count: 0,
        winners: 0,
        losers: 0,
        winRate: null,
        realizedPnl: null,
        commissions: null,
      },
    },
    algo: {
      deployment: null,
      readiness: null,
      kpis: null,
      pipelineStages: [],
      attentionItems: [],
      signals: [],
      candidates: [],
      activePositions: [],
      events: [],
    },
  };
}

test("pool-contention markers do not count as degraded or stale", () => {
  const stalecache = {
    degraded: true,
    stale: true,
    reason: "shadow_read_stale_cache",
  };
  const pressure = {
    degraded: true,
    stale: true,
    reason: "shadow_positions_pressure_fallback",
  };
  for (const subRead of [stalecache, pressure]) {
    assert.equal(readGenuineDegraded(subRead), false);
    assert.equal(readGenuineStale(subRead), false);
  }
});

test("genuine DB-unavailable state still counts as degraded", () => {
  const subRead = {
    degraded: true,
    stale: true,
    reason: DB_UNAVAILABLE_REASON,
  };
  assert.equal(readGenuineDegraded(subRead), true);
  assert.equal(readGenuineStale(subRead), true);
});

test("degraded with no reason is treated as genuine (not silently swallowed)", () => {
  const subRead = { degraded: true };
  assert.equal(readGenuineDegraded(subRead), true);
});

test("staleReason markers are read alongside reason", () => {
  const subRead = { stale: true, staleReason: "shadow_read_stale_cache" };
  assert.equal(readGenuineStale(subRead), false);
});

test("buildWarnings filters out contention markers but keeps real warnings", () => {
  const warnings = buildWarnings([
    { reason: "shadow_read_stale_cache" },
    { reason: "shadow_positions_pressure_fallback" },
    { reason: DB_UNAVAILABLE_REASON },
  ]);
  assert.deepEqual(warnings, [DB_UNAVAILABLE_REASON]);
});

test("marketing dashboard defaults to a bounded equity range unless ALL is explicit", () => {
  assert.equal(normalizeMarketingShadowDashboardInput({}).equityRange, "1D");
  assert.equal(
    normalizeMarketingShadowDashboardInput({ equityRange: "ALL" }).equityRange,
    "ALL",
  );
});

test("marketing dashboard snapshot stages cold DB reads", () => {
  const source = readFileSync(
    new URL("./marketing-shadow-dashboard.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function fetchMarketingShadowDashboardSnapshot",
  );
  const end = source.indexOf("function signatureForPayload", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.doesNotMatch(block, /Promise\.all/);
});

test("marketing dashboard default snapshots share cache and in-flight work", () => {
  const source = readFileSync(
    new URL("./marketing-shadow-dashboard.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function fetchMarketingShadowDashboardSnapshot",
  );
  const end = source.indexOf(
    "async function fetchMarketingShadowDashboardSnapshotUncached",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(block, /Object\.keys\(dependencies\)\.length === 0/);
  assert.match(block, /marketingSnapshotCache\.get\(cacheKey\)/);
  assert.match(block, /marketingSnapshotInFlight\.get\(cacheKey\)/);
  assert.match(block, /marketingSnapshotInFlight\.set\(cacheKey, inFlight\)/);
  assert.match(block, /marketingSnapshotInFlight\.delete\(cacheKey\)/);
  assert.match(block, /MARKETING_SHADOW_DASHBOARD_SNAPSHOT_CACHE_MS/);
});

test("marketing dashboard skips identical payload serialization and emits one change", async () => {
  __resetSseStreamDiagnosticsForTests();
  const timers = createFakeTimers();
  const initialPayload = marketingPayload(50);
  const changedPayload = marketingPayload(51);
  let signatureSerializations = 0;
  Object.defineProperty(initialPayload.account, "toJSON", {
    value() {
      signatureSerializations += 1;
      return { ...initialPayload.account };
    },
  });
  const payloads = [initialPayload, changedPayload];
  let fetchCount = 0;
  const unsubscribe = subscribeMarketingShadowDashboardSnapshots(
    {},
    (payload) => {
      serializeSseEventData(payload);
    },
    {
      initialPayload,
      fetchSnapshot: async () => payloads[fetchCount++]!,
      subscribeShadowChanges: () => () => {},
      subscribeAlgoChanges: () => () => {},
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
  );
  signatureSerializations = 0;

  try {
    timers.fireIntervals();
    await flushAsyncWork();
    assert.equal(signatureSerializations, 0);
    assert.equal(getSseEmitCounters().events, 0);

    timers.fireIntervals();
    await flushAsyncWork();
    assert.equal(getSseEmitCounters().events, 1);
  } finally {
    unsubscribe();
    __resetSseStreamDiagnosticsForTests();
  }
});

test("marketing dashboard ignores shadow mark_refresh notifications", async () => {
  const timers = createFakeTimers();
  const initialPayload = marketingPayload(50);
  let fetchCount = 0;
  let shadowSubscribed = false;
  let onShadowChange = (_change: { reason: string }) => {};
  const unsubscribe = subscribeMarketingShadowDashboardSnapshots({}, () => {}, {
    initialPayload,
    fetchSnapshot: async () => {
      fetchCount += 1;
      return initialPayload;
    },
    subscribeShadowChanges: ((
      listener: (change: { reason: string }) => void,
    ) => {
      shadowSubscribed = true;
      onShadowChange = listener;
      return () => {};
    }) as never,
    subscribeAlgoChanges: () => () => {},
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  try {
    assert.equal(shadowSubscribed, true);
    onShadowChange({ reason: "mark_refresh" });
    await flushAsyncWork();
    assert.equal(fetchCount, 0);

    onShadowChange({ reason: "ledger" });
    await flushAsyncWork();
    assert.equal(fetchCount, 1);
  } finally {
    unsubscribe();
  }
});
