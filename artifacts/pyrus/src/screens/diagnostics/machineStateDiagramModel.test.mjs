import assert from "node:assert/strict";
import test from "node:test";

import {
  MACHINE_STATE_GROUPS,
  buildMachineStateDiagramModel,
} from "./machineStateDiagramModel.js";

const NOW_MS = Date.parse("2026-06-12T12:00:00.000Z");
const FRESH_MS = NOW_MS - 2_000;
const STALE_MS = NOW_MS - 180_000;

const baseLatest = () => ({
  timestamp: "2026-06-12T11:59:58.000Z",
  status: "ok",
  severity: "success",
  events: [],
  snapshots: [
    {
      subsystem: "api",
      status: "ok",
      severity: "success",
      metrics: { p95LatencyMs: 42, requestCount5m: 18 },
    },
    {
      subsystem: "ibkr",
      status: "ok",
      severity: "success",
      metrics: { connected: true, heartbeatAgeMs: 250 },
    },
    {
      subsystem: "market-data",
      status: "ok",
      severity: "success",
      metrics: {
        freshnessAgeMs: 300,
        streamGapMs: 0,
        activeConsumerCount: 4,
        streamState: "live",
        cachedQuoteCount: 220,
        massiveWebSocketStatus: "ok",
        massiveLastSocketMessageAgeMs: 400,
        massiveSubscribedSymbolCount: 12,
      },
    },
    {
      subsystem: "accounts",
      status: "ok",
      severity: "success",
      metrics: { failureCount: 0 },
    },
    {
      subsystem: "orders",
      status: "ok",
      severity: "success",
      metrics: { failureCount: 0 },
    },
    {
      subsystem: "automation",
      status: "ok",
      severity: "success",
      metrics: {
        latestScanAgeMs: 8_000,
        lastScanDurationMs: 1_100,
        failureCount: 0,
        gatewayBlockedCount: 0,
        freshSignalCount: 12,
        staleSignalCount: 0,
        candidateCount: 5,
        shadowExitCount: 1,
        expirationMaintenanceDueCount: 0,
      },
    },
    {
      subsystem: "browser",
      status: "ok",
      severity: "success",
      metrics: { eventCount5m: 2, warningCount5m: 0 },
    },
  ],
});

const baseRuntimeControl = () => ({
  lineUsage: {
    available: true,
    warnings: 0,
    total: { used: 24, cap: 120, streamState: "healthy" },
    accountMonitor: { used: 6, cap: 30, free: 24, streamState: "healthy" },
    shadowAccount: {
      used: 2,
      cap: 20,
      free: 18,
      streamState: "healthy",
      massiveFallbackLineCount: 0,
    },
    flowScanner: { used: 3, cap: 20, free: 17, streamState: "healthy" },
    automation: { used: 2, cap: 16, free: 14, streamState: "healthy" },
    pressure: { state: "normal", policy: "normal", budgetSource: "diagnostics" },
    drift: { available: true, summary: "aligned", admissionVsBridgeLineDelta: 0 },
  },
  streams: {
    account: { fresh: true, lastEventAt: FRESH_MS },
    order: { fresh: true, lastEventAt: FRESH_MS },
    tradingFresh: true,
  },
  flowScanner: { enabled: true, active: true, backendActive: true },
  bridgeGovernor: {
    quotes: { active: 2, queued: 0, circuitOpen: false },
  },
  massive: {
    status: "ok",
    label: "connected",
    websocket: { status: "live", lastMessageAgeMs: 500, activeConsumerCount: 2 },
    rest: { status: "ok" },
  },
});

const buildModel = (overrides = {}) =>
  buildMachineStateDiagramModel({
    latest: baseLatest(),
    streamState: "live",
    runtimeControl: baseRuntimeControl(),
    footerSignal: { level: "normal", trend: "steady", dominantDrivers: [] },
    memoryPressureState: { level: "normal", server: { admissionAction: "allow" } },
    nowMs: NOW_MS,
    ...overrides,
  });

const nodeById = (model, id) => {
  const node = model.nodes.find((item) => item.id === id);
  assert.ok(node, `expected node ${id}`);
  return node;
};

const edgeById = (model, id) => {
  const edge = model.edges.find((item) => item.id === id);
  assert.ok(edge, `expected edge ${id}`);
  return edge;
};

test("buildMachineStateDiagramModel marks a live healthy path as animated", () => {
  const model = buildModel();

  assert.equal(model.summary.status, "healthy");
  assert.equal(nodeById(model, "diagnostics-stream").status, "healthy");
  assert.equal(nodeById(model, "api-runtime").status, "healthy");
  assert.equal(nodeById(model, "ibkr-bridge").label, "Broker Feed");
  assert.equal(nodeById(model, "massive-feed").label, "Massive Feed");
  assert.equal(nodeById(model, "market-equities").status, "healthy");
  assert.equal(nodeById(model, "market-options").status, "healthy");
  assert.equal(nodeById(model, "account-view").status, "healthy");
  assert.equal(nodeById(model, "signal-engine").status, "healthy");
  assert.equal(nodeById(model, "algo-engine").status, "healthy");
  assert.equal(nodeById(model, "trade-management").status, "healthy");
  assert.equal(nodeById(model, "route-admission").canonicalState, "AdmissionAllowed");
  assert.equal(nodeById(model, "route-admission").evidence, "observed");
  assert.equal(edgeById(model, "ibkr-bridge->account-stream").animated, true);
  assert.equal(edgeById(model, "massive-feed->market-equities").animated, true);
  assert.equal(edgeById(model, "market-equities->signal-engine").animated, true);
  assert.equal(edgeById(model, "algo-engine->trade-management").animated, true);
});

test("buildMachineStateDiagramModel shows reconnecting diagnostics transport as checking", () => {
  const model = buildModel({ streamState: "reconnecting" });

  assert.equal(model.summary.status, "checking");
  assert.equal(nodeById(model, "diagnostics-stream").status, "checking");
  assert.equal(nodeById(model, "diagnostics-stream").canonicalState, "ContractEmitted");
});

test("buildMachineStateDiagramModel surfaces API degradation", () => {
  const latest = baseLatest();
  latest.snapshots = latest.snapshots.map((snapshot) =>
    snapshot.subsystem === "api"
      ? {
          ...snapshot,
          status: "degraded",
          severity: "warning",
          metrics: { p95LatencyMs: 2400, requestCount5m: 91 },
        }
      : snapshot,
  );

  const model = buildModel({ latest });

  assert.equal(model.summary.status, "degraded");
  assert.equal(nodeById(model, "api-runtime").status, "degraded");
  assert.match(nodeById(model, "api-runtime").detail, /2,400ms p95/);
});

test("buildMachineStateDiagramModel surfaces IBKR bridge outage separately from API", () => {
  const latest = baseLatest();
  latest.snapshots = latest.snapshots.map((snapshot) =>
    snapshot.subsystem === "ibkr"
      ? {
          ...snapshot,
          status: "down",
          severity: "error",
          metrics: { connected: false, heartbeatAgeMs: 61_000 },
        }
      : snapshot,
  );

  const model = buildModel({ latest });

  assert.equal(model.summary.status, "down");
  assert.equal(nodeById(model, "ibkr-bridge").status, "down");
  assert.equal(nodeById(model, "api-runtime").status, "healthy");
});

test("buildMachineStateDiagramModel flags stale account and order streams", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.streams = {
    account: { fresh: false, lastEventAt: STALE_MS },
    order: { fresh: false, lastEventAt: STALE_MS },
    tradingFresh: false,
  };

  const model = buildModel({ runtimeControl });

  assert.equal(model.summary.status, "degraded");
  assert.equal(nodeById(model, "account-stream").status, "degraded");
  assert.equal(nodeById(model, "order-stream").status, "degraded");
  assert.equal(nodeById(model, "account-view").status, "degraded");
});

test("buildMachineStateDiagramModel flags capacity-limited line pressure", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.lineUsage.total = { used: 95, cap: 100, streamState: "capacity-limited" };
  runtimeControl.lineUsage.warnings = 2;
  runtimeControl.lineUsage.pressure = { state: "protected", policy: "shed-background" };

  const model = buildModel({ runtimeControl });

  assert.equal(model.summary.status, "degraded");
  assert.equal(nodeById(model, "bridge-governor").status, "degraded");
  assert.match(nodeById(model, "bridge-governor").detail, /95 of 100/);
});

test("buildMachineStateDiagramModel treats full matched line allocation as healthy", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.lineUsage.total = { used: 200, cap: 200, streamState: "capacity-limited" };
  runtimeControl.lineUsage.warnings = 0;
  runtimeControl.lineUsage.pressure = { state: "protected", policy: "options-flow-rotation-allocation" };
  runtimeControl.lineUsage.drift = {
    status: "matched",
    admissionVsBridgeLineDelta: 0,
  };

  const model = buildModel({ runtimeControl });

  assert.equal(nodeById(model, "bridge-governor").status, "healthy");
  assert.match(nodeById(model, "bridge-governor").detail, /200 of 200/);
});

test("buildMachineStateDiagramModel uses observed shed admission action", () => {
  const model = buildModel({
    memoryPressureState: {
      level: "high",
      server: { admissionAction: "shed", admissionReason: "api-resource-pressure-high" },
    },
    footerSignal: { level: "high", trend: "rising", dominantDrivers: ["api heap"] },
  });

  assert.equal(nodeById(model, "route-admission").status, "degraded");
  assert.equal(nodeById(model, "route-admission").canonicalState, "AdmissionShed");
  assert.equal(nodeById(model, "route-admission").evidence, "observed");
  assert.match(nodeById(model, "route-admission").detail, /shed/);
});

test("buildMachineStateDiagramModel uses observed cache-only admission action", () => {
  const model = buildModel({
    memoryPressureState: {
      level: "watch",
      server: { admissionAction: "cache-only", admissionReason: "api-resource-pressure-watch" },
    },
    footerSignal: { level: "watch", trend: "rising", dominantDrivers: ["api heap"] },
  });

  assert.equal(nodeById(model, "route-admission").status, "degraded");
  assert.equal(nodeById(model, "route-admission").canonicalState, "AdmissionCacheOnly");
  assert.equal(nodeById(model, "route-admission").evidence, "observed");
});

test("buildMachineStateDiagramModel keeps missing snapshots unknown", () => {
  const model = buildMachineStateDiagramModel({
    latest: null,
    streamState: "idle",
    runtimeControl: null,
    footerSignal: null,
    memoryPressureState: null,
    nowMs: NOW_MS,
  });

  assert.equal(model.summary.status, "unknown");
  assert.equal(nodeById(model, "api-runtime").status, "unknown");
  assert.equal(nodeById(model, "route-admission").evidence, "unknown");
  assert.equal(edgeById(model, "route-admission->api-runtime").animated, false);
});

test("buildMachineStateDiagramModel never fabricates observedAt without a payload time", () => {
  const model = buildMachineStateDiagramModel({
    latest: null,
    streamState: "idle",
    runtimeControl: null,
    footerSignal: null,
    memoryPressureState: null,
    nowMs: NOW_MS,
  });
  assert.equal(model.observedAt, null);
});

test("buildMachineStateDiagramModel resolves a numeric epoch timestamp exactly", () => {
  const latest = baseLatest();
  latest.timestamp = NOW_MS; // numeric ms epoch, which firstString used to skip
  const model = buildModel({ latest });
  assert.equal(model.observedAt, new Date(NOW_MS).toISOString());
});

test("buildMachineStateDiagramModel treats missing numeric metrics as n/a, not zero", () => {
  const latest = baseLatest();
  latest.snapshots = latest.snapshots.map((snapshot) =>
    snapshot.subsystem === "api"
      ? { ...snapshot, metrics: { p95LatencyMs: null, requestCount5m: "" } }
      : snapshot,
  );
  const model = buildModel({ latest });
  // null/"" must not coerce to 0; detail shows n/a, not "0ms p95".
  assert.match(nodeById(model, "api-runtime").detail, /n\/a p95/);
  assert.doesNotMatch(nodeById(model, "api-runtime").detail, /0ms p95/);
});

test("buildMachineStateDiagramModel surfaces a degraded EventSource transport in client nodes", () => {
  const model = buildModel({ streamState: "error" });
  assert.equal(nodeById(model, "diagnostics-stream").status, "degraded");
  assert.equal(nodeById(model, "client-transport").status, "degraded");
});

test("buildMachineStateDiagramModel treats a paused transport as unknown, not healthy", () => {
  const model = buildModel({ streamState: "paused" });
  assert.equal(nodeById(model, "diagnostics-stream").status, "unknown");
});

test("buildMachineStateDiagramModel reads line-usage stream state case-insensitively", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.lineUsage.total = { used: 95, cap: 100, streamState: "Capacity-Limited" };
  const model = buildModel({ runtimeControl });
  assert.equal(nodeById(model, "bridge-governor").status, "degraded");
});

test("buildMachineStateDiagramModel leaves unknown-freshness streams as SourceRead", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.streams = { account: {}, order: {}, tradingFresh: undefined };
  const model = buildModel({ runtimeControl });
  const account = nodeById(model, "account-stream");
  assert.equal(account.status, "unknown");
  assert.equal(account.canonicalState, "SourceRead");
  assert.match(account.detail, /freshness not observed/);
});

test("buildMachineStateDiagramModel ignores malformed incident event entries", () => {
  const latest = baseLatest();
  latest.events = [null, "boom", 42, { status: "resolved" }];
  const model = buildModel({ latest });
  const incidents = nodeById(model, "diagnostics-incidents");
  assert.equal(incidents.status, "healthy");
  assert.equal(incidents.canonicalState, "IncidentResolved");
  assert.match(incidents.detail, /0 open/);
});

test("buildMachineStateDiagramModel shows an idle Massive provider as neutral idle", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.massive = {
    status: "idle",
    label: "idle",
    websocket: { status: "idle", lastMessageAgeMs: 7_200_000, activeConsumerCount: 0 },
    rest: { status: "ok" },
  };
  const model = buildModel({ runtimeControl });
  const massive = nodeById(model, "massive-feed");
  // Idle provider must not be degraded by message age, and must not alarm.
  assert.equal(massive.status, "idle");
  assert.equal(massive.canonicalState, "SourceIdle");
  assert.equal(model.summary.status, "healthy");
  assert.equal(edgeById(model, "massive-feed->market-equities").animated, false);
});

test("buildMachineStateDiagramModel shows a session-quiet flow scanner as idle", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.flowScanner = {
    enabled: true,
    active: false,
    backendActive: false,
    sessionBlockedReason: "market-session-quiet",
  };
  const model = buildModel({ runtimeControl });
  const scanner = nodeById(model, "flow-scanner");
  assert.equal(scanner.status, "idle");
  assert.match(scanner.detail, /market session quiet/);
});

test("buildMachineStateDiagramModel keeps a stuck enabled scanner as checking", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.flowScanner = { enabled: true, active: false, backendActive: false };
  const model = buildModel({ runtimeControl });
  assert.equal(nodeById(model, "flow-scanner").status, "checking");
});

test("buildMachineStateDiagramModel surfaces an open bridge governor circuit", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.bridgeGovernor = {
    quotes: { active: 0, queued: 4, circuitOpen: true },
    chains: { active: 1, queued: 0, circuitOpen: false },
  };
  const model = buildModel({ runtimeControl });
  const governor = nodeById(model, "bridge-governor");
  assert.equal(governor.status, "degraded");
  assert.match(governor.detail, /circuit open: quotes/);
  assert.match(governor.detail, /24 of 120/);
  // Own-telemetry: the broker feed itself stays healthy.
  assert.equal(nodeById(model, "ibkr-bridge").status, "healthy");
});

test("buildMachineStateDiagramModel splits live and shadow quote pool statuses", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.lineUsage.shadowAccount = {
    used: 19,
    cap: 20,
    free: 1,
    streamState: "capacity-limited",
    massiveFallbackLineCount: 3,
  };
  const model = buildModel({ runtimeControl });
  const quotes = nodeById(model, "position-quotes");
  assert.equal(quotes.split.live.status, "healthy");
  assert.equal(quotes.split.shadow.status, "degraded");
  assert.equal(quotes.status, "degraded");
  assert.match(quotes.detail, /3 Massive fallback/);
});

test("buildMachineStateDiagramModel reads browser memory against backend thresholds", () => {
  const model = buildModel({
    memoryPressureState: {
      level: "normal",
      server: { admissionAction: "allow" },
      browserMemoryMb: 380,
      browserMemoryLimitMb: 500,
    },
  });
  // 76% of limit crosses the high threshold (75) mirrored from diagnostics.ts:248.
  assert.equal(nodeById(model, "browser-memory").status, "degraded");
});

test("buildMachineStateDiagramModel keeps unobserved line admission unknown", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.lineUsage = { available: false };
  runtimeControl.bridgeGovernor = {};
  const model = buildModel({ runtimeControl });
  const governor = nodeById(model, "bridge-governor");
  assert.equal(governor.status, "unknown");
  assert.equal(governor.evidence, "unknown");
  assert.match(governor.detail, /governor not observed/);
});

test("buildMachineStateDiagramModel decays observed evidence after two missed snapshots", () => {
  const model = buildModel({ nowMs: NOW_MS + 31_000 });
  const api = nodeById(model, "api-runtime");
  assert.equal(api.evidence, "inferred");
  assert.equal(api.status, "healthy");
  assert.equal(api.stale, true);
  assert.equal(edgeById(model, "market-equities->signal-engine").animated, false);
});

test("buildMachineStateDiagramModel expires stale healthy statuses to unknown, keeping bad news", () => {
  const latest = baseLatest();
  latest.snapshots = latest.snapshots.map((snapshot) =>
    snapshot.subsystem === "ibkr"
      ? { ...snapshot, status: "down", severity: "error", metrics: { connected: false } }
      : snapshot,
  );
  const model = buildModel({ latest, nowMs: NOW_MS + 61_000 });
  assert.equal(nodeById(model, "api-runtime").status, "unknown");
  assert.match(nodeById(model, "api-runtime").detail, /snapshot .* old/);
  // Known problems must never wash out.
  assert.equal(nodeById(model, "ibkr-bridge").status, "down");
});

test("buildMachineStateDiagramModel reads trade-chain and automation pools from lineUsage.pools", () => {
  const runtimeControl = baseRuntimeControl();
  // Real payload shape: these pools exist ONLY under lineUsage.pools
  // (runtimeControlModel.js:1455-1474), not as top-level keys.
  delete runtimeControl.lineUsage.automation;
  runtimeControl.lineUsage.pools = {
    visible: { used: 96, cap: 100, streamState: "capacity-limited" },
    automation: { used: 2, cap: 16, streamState: "healthy" },
  };
  const model = buildModel({ runtimeControl });
  const tradeChain = nodeById(model, "trade-chain");
  assert.equal(tradeChain.status, "degraded");
  assert.match(tradeChain.detail, /96 of 100/);
  assert.equal(nodeById(model, "algo-engine").status, "healthy");
});

test("buildMachineStateDiagramModel keeps gex unknown without cache observation, idle with zero queries", () => {
  const unobserved = buildModel();
  assert.equal(nodeById(unobserved, "gex-projection").status, "unknown");
  const idle = buildModel({ gexClientState: { queryCount: 0 } });
  assert.equal(nodeById(idle, "gex-projection").status, "idle");
  assert.match(nodeById(idle, "gex-projection").detail, /no gex requests/);
});

test("buildMachineStateDiagramModel reflects gex client query health", () => {
  const healthy = buildModel({
    gexClientState: {
      queryCount: 3,
      isFetching: false,
      hasError: false,
      lastUpdatedAt: NOW_MS - 20_000,
    },
  });
  const node = nodeById(healthy, "gex-projection");
  assert.equal(node.status, "healthy");
  assert.equal(node.evidence, "observed");
  assert.match(node.detail, /data 20s old/);
  const errored = buildModel({
    gexClientState: { queryCount: 2, hasError: true, lastUpdatedAt: NOW_MS - 5_000 },
  });
  assert.equal(nodeById(errored, "gex-projection").status, "degraded");
});

test("buildMachineStateDiagramGroups assigns every node to exactly one master", () => {
  const model = buildModel();
  const childIds = MACHINE_STATE_GROUPS.flatMap((group) => [...group.children]);
  assert.equal(new Set(childIds).size, childIds.length);
  assert.deepEqual(
    [...childIds].sort(),
    model.nodes.map((node) => node.id).sort(),
  );
});

test("buildMachineStateDiagramGroups surfaces a degraded child in its master", () => {
  const latest = baseLatest();
  latest.snapshots = latest.snapshots.map((snapshot) =>
    snapshot.subsystem === "ibkr"
      ? { ...snapshot, status: "down", severity: "error", metrics: { connected: false } }
      : snapshot,
  );
  const model = buildModel({ latest });
  const broker = model.groups.masters.find((master) => master.id === "broker");
  assert.equal(broker.status, "down");
  assert.match(broker.detail, /Broker Feed/);
  const account = model.groups.masters.find((master) => master.id === "account");
  // Own-telemetry: the outage does not cascade into the Account master...
  assert.equal(account.status, "healthy");
  // ...the edge carries it instead.
  const edge = model.groups.edges.find((item) => item.id === "broker->account");
  assert.equal(edge.status, "down");
});

test("buildMachineStateDiagramGroups derives the 27 locked master edges", () => {
  const model = buildModel();
  assert.equal(model.groups.edges.length, 27);
  const ids = model.groups.edges.map((edge) => edge.id);
  for (const expected of [
    "broker->account",
    "broker->algo",
    "broker->market",
    "broker->trade",
    "broker->flow",
    "broker->gex",
    "broker->client",
    "massive->market",
    "massive->flow",
    "massive->account",
    "market->signals",
    "flow->signals",
    "signals->algo",
    "account->algo",
    "algo->trade-mgmt",
    "account->trade-mgmt",
    "market->client",
    "signals->client",
    "gex->client",
    "trade-mgmt->client",
    "trade-mgmt->diagnostics",
    "diagnostics->client",
    "client->diagnostics",
  ]) {
    assert.ok(ids.includes(expected), `expected master edge ${expected}`);
  }
});

// --- Database card (persistence sink) ---------------------------------------
// Sourced from the existing `storage` (connectivity / size / table freshness)
// and `resource-pressure` (connection pool) snapshots — no new backend subsystem.
const latestWithDatabase = ({ storage, resourcePressure } = {}) => {
  const latest = baseLatest();
  if (storage) {
    latest.snapshots.push({
      subsystem: "storage",
      status: storage.status ?? "ok",
      severity: "success",
      metrics: storage,
    });
  }
  if (resourcePressure) {
    latest.snapshots.push({
      subsystem: "resource-pressure",
      status: "ok",
      severity: "success",
      metrics: resourcePressure,
    });
  }
  return latest;
};

const healthyStorageMetrics = {
  status: "ok",
  reachable: true,
  readWriteVerified: true,
  pingMs: 6,
  databaseMb: 1200,
  warningDatabaseMb: 15360,
  storagePressureLevel: "ok",
  monitoredTables: [
    { table: "quote_cache", rowEstimate: 1000, newestAt: "2026-06-12T11:59:55.000Z" },
    { table: "bar_cache", rowEstimate: 500, newestAt: "2026-06-12T11:59:50.000Z" },
  ],
};

const healthyPoolMetrics = {
  dbPoolMax: 10,
  dbPoolActive: 2,
  dbPoolWaiting: 0,
  dbPoolIdle: 8,
};

const dbMaster = (model) =>
  model.groups.masters.find((master) => master.id === "database");

test("database card reads unknown when storage and pool snapshots are absent", () => {
  const model = buildModel();
  for (const id of [
    "database-health",
    "database-pool",
    "database-storage",
    "database-tables",
  ]) {
    const node = nodeById(model, id);
    assert.equal(node.status, "unknown", `${id} should be unknown without telemetry`);
    assert.equal(node.evidence, "unknown");
  }
  assert.equal(dbMaster(model).status, "unknown");
});

test("database card is healthy when storage is reachable and the pool is not saturated", () => {
  const model = buildModel({
    latest: latestWithDatabase({
      storage: healthyStorageMetrics,
      resourcePressure: healthyPoolMetrics,
    }),
  });
  assert.equal(nodeById(model, "database-health").status, "healthy");
  assert.equal(nodeById(model, "database-health").canonicalState, "StorageReachable");
  assert.equal(nodeById(model, "database-pool").status, "healthy");
  assert.equal(nodeById(model, "database-storage").status, "healthy");
  assert.equal(nodeById(model, "database-tables").status, "healthy");
  assert.equal(dbMaster(model).status, "healthy");
});

test("database master goes down when storage is unreachable, even with a healthy pool", () => {
  const model = buildModel({
    latest: latestWithDatabase({
      storage: { status: "unavailable", reachable: false, readWriteVerified: false },
      resourcePressure: healthyPoolMetrics,
    }),
  });
  assert.equal(nodeById(model, "database-health").status, "down");
  assert.equal(nodeById(model, "database-health").canonicalState, "StorageUnreachable");
  // Pool still reads its own healthy telemetry (truth bias: no cascade)...
  assert.equal(nodeById(model, "database-pool").status, "healthy");
  // ...but the master takes the worst-of its children.
  assert.equal(dbMaster(model).status, "down");
});

test("database card flags pool saturation and storage pressure as degraded", () => {
  const model = buildModel({
    latest: latestWithDatabase({
      storage: { ...healthyStorageMetrics, storagePressureLevel: "warning" },
      resourcePressure: { ...healthyPoolMetrics, dbPoolWaiting: 4 },
    }),
  });
  assert.equal(nodeById(model, "database-pool").status, "degraded");
  assert.equal(nodeById(model, "database-pool").canonicalState, "PoolSaturated");
  assert.equal(nodeById(model, "database-storage").status, "degraded");
  assert.equal(dbMaster(model).status, "degraded");
});

// --- Attribution: where pressure / incidents come from ----------------------
test("incidents node attributes open events by subsystem", () => {
  const latest = baseLatest();
  latest.events = [
    { subsystem: "runtime", severity: "warning", status: "open" },
    { subsystem: "runtime", severity: "warning", status: "open" },
    { subsystem: "ibkr", severity: "warning", status: "open" },
    { subsystem: "api", severity: "warning", status: "resolved" },
  ];
  const incidents = nodeById(buildModel({ latest }), "diagnostics-incidents");
  assert.equal(incidents.status, "degraded");
  assert.match(incidents.detail, /3 open: runtime 2 · ibkr 1/);
  assert.equal(incidents.metric, "runtime 2"); // dominant source shown on the row
});

test("api pressure ranks drivers worst-first and marks the source card", () => {
  const latest = baseLatest();
  latest.snapshots.push({
    subsystem: "resource-pressure",
    status: "warning",
    severity: "warning",
    metrics: {
      pressureLevel: "high",
      dbPoolMax: 12,
      dbPoolActive: 12,
      dbPoolWaiting: 7,
      dbPoolIdle: 0,
      // Backend order is structural, NOT severity-sorted: a "watch" driver leads
      // here, ahead of two "high" drivers. The model must re-rank worst-first.
      dominantDrivers: [
        { kind: "api-event-loop", label: "API event loop", level: "watch", detail: "95 ms" },
        { kind: "api-latency", label: "API latency", level: "high", detail: "4106 ms" },
        { kind: "db-pool", label: "DB pool", level: "high", detail: "12/12 active, 7 waiting" },
        { kind: "browser-memory", label: "Browser memory", level: "normal", detail: "20%" },
      ],
    },
  });
  const apiPressure = nodeById(buildModel({ latest }), "api-pressure");
  // The "high" driver headlines, NOT the "watch" one that led the backend array.
  assert.equal(apiPressure.metric, "API latency");
  assert.match(
    apiPressure.detail,
    /from API latency \(4106 ms\), DB pool \(12\/12 active, 7 waiting\), API event loop \(95 ms\)/,
  );
  assert.doesNotMatch(apiPressure.detail, /Browser memory/); // normal-level excluded
  // db-pool maps to the Database card, so it is surfaced as a pressure source.
  assert.deepEqual(
    buildModel({ latest }).pressureSources.map((source) => source.cardId),
    ["database"],
  );
});

test("database bus row counts sum monitored tables per owning card", () => {
  const model = buildModel({
    latest: latestWithDatabase({
      storage: {
        ...healthyStorageMetrics,
        monitoredTables: [
          // `table` is the real backend field (diagnostics.ts), not `name`.
          { table: "quote_cache", rowEstimate: 200_000 },
          { table: "bar_cache", rowEstimate: 50_000 },
          { table: "flow_events", rowEstimate: 30_000 },
          { table: "diagnostic_snapshots", rowEstimate: 9_000 },
          { table: "unmapped_table", rowEstimate: 999 },
        ],
      },
    }),
  });
  assert.equal(model.databaseRowCounts.market, 250_000); // quote_cache + bar_cache
  assert.equal(model.databaseRowCounts.flow, 30_000);
  assert.equal(model.databaseRowCounts.diagnostics, 9_000);
  assert.equal(model.databaseRowCounts.gex, undefined); // no monitored table
  assert.equal(model.databaseRowCounts.unmapped, undefined); // table not owned by a card
});
