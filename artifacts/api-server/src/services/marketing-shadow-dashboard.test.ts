import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  currentDbAdmissionSignal,
  runWithDbAdmissionSignal,
} from "@workspace/db";
import {
  __marketingShadowDashboardInternalsForTests,
  fetchMarketingShadowDashboardSnapshot,
  MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT,
  normalizeMarketingShadowDashboardInput,
  subscribeMarketingShadowDashboardSnapshots,
  type MarketingShadowDashboardDependencies,
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
    intervalCount: () => intervals.size,
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
      closedTradesMeta: { total: 0, truncated: false },
      orders: {
        working: [],
        history: [],
        historyMeta: { total: 0, truncated: false },
      },
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
  } as MarketingShadowDashboardPayload;
}

function snapshotDependencies(input: {
  closedTrades?: Array<Record<string, unknown>>;
  workingOrders?: Array<Record<string, unknown>>;
  historyOrders?: Array<Record<string, unknown>>;
  positions?: Array<Record<string, unknown>>;
  equityPoints?: Array<{ timestamp: Date; netLiquidation: number }>;
  events?: Array<Record<string, unknown>>;
}) {
  const timestamp = new Date("2026-07-07T00:00:00.000Z");
  const summary = {
    currency: "USD",
    metrics: {},
    updatedAt: timestamp,
  };
  const equityHistory = {
    points: input.equityPoints ?? [],
    asOf: timestamp,
    latestSnapshotAt: timestamp,
    isStale: false,
  };
  const positions = {
    positions: input.positions ?? [],
    updatedAt: timestamp,
  };
  const closedTrades = {
    trades: (input.closedTrades ?? []).slice(
      0,
      MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT,
    ),
    tradesMeta: {
      total: input.closedTrades?.length ?? 0,
      truncated:
        (input.closedTrades?.length ?? 0) >
        MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT,
    },
    summary: {
      count: input.closedTrades?.length ?? 0,
      winners: input.closedTrades?.length ?? 0,
      losers: 0,
      realizedPnl: input.closedTrades?.length ?? 0,
      commissions: 0,
    },
    updatedAt: timestamp,
  };
  const orders = {
    working: input.workingOrders ?? [],
    history: (input.historyOrders ?? []).slice(
      0,
      MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT,
    ),
    historyMeta: {
      total: input.historyOrders?.length ?? 0,
      truncated:
        (input.historyOrders?.length ?? 0) >
        MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT,
    },
    updatedAt: timestamp,
  };
  const allocation = { updatedAt: timestamp };
  const risk = { updatedAt: timestamp };
  const deployments = input.events?.length
    ? {
        deployments: [
          {
            id: "deployment-1",
            name: "Shadow deployment",
            enabled: true,
            mode: "shadow",
            lastEvaluatedAt: timestamp,
            lastSignalAt: timestamp,
          },
        ],
      }
    : { deployments: [] };
  const cockpit = {
    generatedAt: timestamp,
    readiness: null,
    kpis: null,
    pipelineStages: [],
    attentionItems: [],
    signals: [],
    candidates: [],
    activePositions: [],
  };
  const events = { events: input.events ?? [] };
  const dependencies = {
    getSummaryFromPositions: async () => summary,
    getMarketingEquityHistory: async () => equityHistory,
    getMarketingPositions: async () => positions,
    getMarketingClosedTrades: async () => closedTrades,
    getMarketingOrders: async () => orders,
    getAllocationFromPositions: () => allocation,
    getRisk: async () => risk,
    listDeployments: async () => deployments,
    getCockpit: async () => cockpit,
    listEvents: async () => events,
    now: () => timestamp,
  } as unknown as Partial<MarketingShadowDashboardDependencies>;

  return dependencies;
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

test("marketing dashboard derives summary and allocation from loaded account data", () => {
  const source = readFileSync(
    new URL("./marketing-shadow-dashboard.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "async function fetchMarketingShadowDashboardSnapshotUncached",
  );
  const end = source.indexOf("const marketingPayloadSignatureMemo", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.match(
    block,
    /deps\.getSummaryFromPositions\(\{\s*positionsResponse: positions,\s*equityHistory,\s*detail: "marketing"/,
  );
  assert.match(block, /deps\.getAllocationFromPositions\(\{\s*positionsResponse: positions/);
  assert.doesNotMatch(block, /deps\.getSummary\(\)/);
  assert.doesNotMatch(block, /deps\.getAllocation\(\)/);
});

test("marketing dashboard uses only compact marketing shadow reads", () => {
  const source = readFileSync(
    new URL("./marketing-shadow-dashboard.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "async function fetchMarketingShadowDashboardSnapshotUncached",
  );
  const end = source.indexOf("const marketingPayloadSignatureMemo", start);
  const block = source.slice(start, end);

  assert.match(block, /deps\.getMarketingEquityHistory/);
  assert.match(block, /deps\.getMarketingPositions/);
  assert.match(block, /deps\.getMarketingClosedTrades/);
  assert.match(block, /deps\.getMarketingOrders/);
  assert.doesNotMatch(block, /deps\.getEquityHistory/);
  assert.doesNotMatch(block, /deps\.getClosedTrades/);
  assert.doesNotMatch(block, /deps\.getOrders/);
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
  assert.match(block, /readMarketingSnapshotCache\(cacheKey, Date\.now\(\)\)/);
  assert.match(block, /marketingSnapshotInFlight\.get\(cacheKey\)/);
  assert.match(block, /marketingSnapshotInFlight\.set\(cacheKey, inFlight\)/);
  assert.match(block, /marketingSnapshotInFlight\.delete\(cacheKey\)/);
  assert.match(block, /setMarketingSnapshotCache\(cacheKey/);
  assert.match(block, /MARKETING_SHADOW_DASHBOARD_SNAPSHOT_CACHE_MS/);
});

test("marketing snapshot cache evicts the oldest retained payload", () => {
  const internals = __marketingShadowDashboardInternalsForTests;
  internals.clearSnapshotCacheForTests();
  const maxKeys = internals.getSnapshotCacheMaxKeysForTests();

  try {
    for (let index = 0; index <= maxKeys; index += 1) {
      internals.setSnapshotCacheForTests(
        `snapshot-${index}`,
        marketingPayload(index),
      );
    }

    assert.equal(internals.hasSnapshotCacheKeyForTests("snapshot-0"), false);
    assert.equal(
      internals.hasSnapshotCacheKeyForTests(`snapshot-${maxKeys}`),
      true,
    );
    assert.equal(internals.getSnapshotCacheSizeForTests(), maxKeys);
  } finally {
    internals.clearSnapshotCacheForTests();
  }
});

test("marketing dashboard resolves deployments without P&L decoration", () => {
  const source = readFileSync(
    new URL("./marketing-shadow-dashboard.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /listAlgoDeploymentMetadata/);
  assert.doesNotMatch(source, /\blistAlgoDeployments\b/);
  assert.match(
    source,
    /listDeployments:\s*listAlgoDeploymentMetadata/,
  );
});

test("marketing snapshot bounds histories but keeps full trade stats and working orders", async () => {
  const closedTrades = Array.from(
    { length: MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT + 5 },
    (_, index) => ({ id: `trade-${index}`, realizedPnl: 1 }),
  );
  const historyOrders = Array.from(
    { length: MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT + 5 },
    (_, index) => ({ id: `history-${index}` }),
  );
  const workingOrders = Array.from(
    { length: MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT + 5 },
    (_, index) => ({ id: `working-${index}` }),
  );
  const dependencies = snapshotDependencies({
    closedTrades,
    historyOrders,
    workingOrders,
  });

  const payload = await fetchMarketingShadowDashboardSnapshot({}, dependencies);

  assert.equal(
    payload.account.closedTrades.length,
    MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT,
  );
  assert.equal(
    (payload.account.closedTrades.at(-1) as { id: string }).id,
    `trade-${MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT - 1}`,
  );
  assert.deepEqual(payload.account.closedTradesMeta, {
    total: closedTrades.length,
    truncated: true,
  });
  assert.equal(payload.account.tradeStats.count, closedTrades.length);
  assert.equal(payload.account.tradeStats.realizedPnl, closedTrades.length);
  assert.equal(
    payload.account.orders.history.length,
    MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT,
  );
  assert.deepEqual(payload.account.orders.historyMeta, {
    total: historyOrders.length,
    truncated: true,
  });
  assert.equal(payload.account.orders.working.length, workingOrders.length);
});

test("marketing snapshot reuses projections when cached source responses retain identity", async () => {
  const dependencies = snapshotDependencies({
    closedTrades: [{ id: "trade-1", realizedPnl: 1 }],
    workingOrders: [{ id: "working-1" }],
    historyOrders: [{ id: "history-1" }],
    positions: [{ id: "position-1" }],
    equityPoints: [
      {
        timestamp: new Date("2026-07-07T00:00:00.000Z"),
        netLiquidation: 100,
      },
    ],
    events: [
      {
        id: "event-1",
        deploymentId: "deployment-1",
        symbol: "SPY",
        eventType: "signal",
        summary: "Signal",
        payload: { score: 1 },
        occurredAt: new Date("2026-07-07T00:00:00.000Z"),
        createdAt: new Date("2026-07-07T00:00:00.000Z"),
        updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      },
    ],
  });

  const first = await fetchMarketingShadowDashboardSnapshot({}, dependencies);
  const second = await fetchMarketingShadowDashboardSnapshot({}, dependencies);

  assert.equal(second.account.equityHistory, first.account.equityHistory);
  assert.equal(second.account.positions, first.account.positions);
  assert.equal(second.account.closedTrades, first.account.closedTrades);
  assert.equal(second.account.orders.working, first.account.orders.working);
  assert.equal(second.account.orders.history, first.account.orders.history);
  assert.equal(second.algo.events, first.algo.events);
});

test("marketing subscribers with the same normalized input share one poller", async () => {
  const timers = createFakeTimers();
  const initialPayload = marketingPayload(50);
  const changedPayload = marketingPayload(51);
  let signatureSerializations = 0;
  Object.defineProperty(changedPayload.account, "toJSON", {
    value() {
      signatureSerializations += 1;
      return { ...changedPayload.account };
    },
  });
  let fetchCount = 0;
  const delivered = [0, 0];
  const pollSuccess = [0, 0];
  const options = {
    initialPayload,
    fetchSnapshot: async () => {
      fetchCount += 1;
      return changedPayload;
    },
    subscribeShadowChanges: () => () => {},
    subscribeAlgoChanges: () => () => {},
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  };
  const unsubscribeA = subscribeMarketingShadowDashboardSnapshots(
    { equityRange: "1d", eventLimit: "50" },
    () => {
      delivered[0] += 1;
    },
    {
      ...options,
      onPollSuccess: () => {
        pollSuccess[0] += 1;
      },
    },
  );
  const unsubscribeB = subscribeMarketingShadowDashboardSnapshots(
    { equityRange: "1D", eventLimit: 50.9 },
    () => {
      delivered[1] += 1;
    },
    {
      ...options,
      onPollSuccess: () => {
        pollSuccess[1] += 1;
      },
    },
  );

  try {
    assert.equal(timers.intervalCount(), 1);
    timers.fireIntervals();
    await flushAsyncWork();

    assert.equal(fetchCount, 1);
    assert.equal(signatureSerializations, 1);
    assert.deepEqual(delivered, [1, 1]);
    assert.deepEqual(pollSuccess, [1, 1]);

    timers.fireIntervals();
    await flushAsyncWork();
    assert.equal(fetchCount, 2);
    assert.equal(signatureSerializations, 1);
    assert.deepEqual(delivered, [1, 1]);
    assert.deepEqual(pollSuccess, [2, 2]);

    unsubscribeA();
    assert.equal(timers.intervalCount(), 1);
    unsubscribeB();
    assert.equal(timers.intervalCount(), 0);
  } finally {
    unsubscribeA();
    unsubscribeB();
  }
});

test("shared marketing polls outlive the first subscriber request signal", async () => {
  const timers = createFakeTimers();
  const firstRequest = new AbortController();
  const secondRequest = new AbortController();
  const observedSignals: Array<AbortSignal | undefined> = [];
  const options = {
    initialPayload: marketingPayload(50),
    fetchSnapshot: async () => {
      observedSignals.push(currentDbAdmissionSignal());
      return marketingPayload(51);
    },
    subscribeShadowChanges: () => () => {},
    subscribeAlgoChanges: () => () => {},
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  };
  const unsubscribeFirst = runWithDbAdmissionSignal(
    firstRequest.signal,
    () => subscribeMarketingShadowDashboardSnapshots({}, () => {}, options),
  );
  const unsubscribeSecond = runWithDbAdmissionSignal(
    secondRequest.signal,
    () => subscribeMarketingShadowDashboardSnapshots({}, () => {}, options),
  );

  try {
    firstRequest.abort();
    unsubscribeFirst();
    runWithDbAdmissionSignal(firstRequest.signal, timers.fireIntervals);
    await flushAsyncWork();

    assert.equal(observedSignals.length, 1);
    assert.notEqual(observedSignals[0], firstRequest.signal);
    assert.equal(observedSignals[0]?.aborted, false);
  } finally {
    unsubscribeFirst();
    unsubscribeSecond();
  }
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
