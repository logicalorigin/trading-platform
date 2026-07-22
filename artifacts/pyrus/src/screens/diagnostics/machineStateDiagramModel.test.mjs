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
  streams: {
    account: { fresh: true, lastEventAt: FRESH_MS },
    order: { fresh: true, lastEventAt: FRESH_MS },
    tradingFresh: true,
  },
  flowScanner: { enabled: true, active: true, backendActive: true },
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

test("buildMachineStateDiagramModel renders SnapTrade broker connections as broker rows", () => {
  const model = buildModel({
    brokerConnections: {
      connections: [
        {
          id: "snaptrade-etrade",
          provider: "snaptrade",
          brokerageSlug: "ETRADE",
          name: "ETRADE",
          mode: "live",
          status: "connected",
          capabilities: ["accounts", "orders", "executions", "execution-ready"],
          updatedAt: "2026-06-12T11:59:55.000Z",
        },
        {
          id: "snaptrade-ibkr",
          provider: "snaptrade",
          brokerageSlug: "INTERACTIVE-BROKERS-FLEX",
          name: "INTERACTIVE-BROKERS-FLEX",
          mode: "live",
          status: "error",
          capabilities: ["accounts", "orders", "executions"],
          updatedAt: "2026-06-12T11:59:50.000Z",
        },
        {
          id: "massive-live",
          provider: "massive",
          name: "Massive",
          mode: "live",
          status: "configured",
          capabilities: ["quotes"],
          updatedAt: "2026-06-12T11:59:55.000Z",
        },
      ],
    },
  });

  const broker = model.groups.masters.find((master) => master.id === "broker");
  assert.deepEqual(
    broker.children.map((child) => child.label),
    ["E*TRADE", "Interactive Brokers"],
  );
  assert.equal(nodeById(model, "broker-snaptrade-etrade").status, "healthy");
  assert.equal(
    nodeById(model, "broker-snaptrade-interactive-brokers-flex").status,
    "down",
  );
  assert.equal(model.nodes.some((node) => node.id === "ibkr-bridge"), false);
  assert.equal(broker.status, "down");
  assert.match(broker.detail, /Interactive Brokers/);
  assert.ok(edgeById(model, "broker-snaptrade-etrade->account-stream"));
});

test("buildMachineStateDiagramModel uses SnapTrade account readiness instead of stale legacy streams", () => {
  const runtimeControl = baseRuntimeControl();
  runtimeControl.streams = {
    account: { fresh: false, lastEventAt: STALE_MS },
    order: { fresh: false, lastEventAt: STALE_MS },
    tradingFresh: false,
  };

  const model = buildModel({
    runtimeControl,
    brokerConnections: {
      connections: [
        {
          id: "snaptrade-ibkr-flex",
          provider: "snaptrade",
          brokerageSlug: "INTERACTIVE-BROKERS-FLEX",
          name: "INTERACTIVE-BROKERS-FLEX",
          mode: "live",
          status: "connected",
          capabilities: ["accounts", "positions", "read-only"],
          updatedAt: "2026-06-12T11:59:54.000Z",
        },
        {
          id: "snaptrade-etrade",
          provider: "snaptrade",
          brokerageSlug: "ETRADE",
          name: "ETRADE",
          mode: "live",
          status: "connected",
          capabilities: ["accounts", "positions", "orders", "execution-ready"],
          updatedAt: "2026-06-12T11:59:55.000Z",
        },
      ],
    },
  });

  assert.equal(model.summary.status, "healthy");
  assert.equal(nodeById(model, "account-stream").status, "healthy");
  assert.match(nodeById(model, "account-stream").detail, /SnapTrade/);
  assert.equal(nodeById(model, "order-stream").status, "healthy");
  assert.match(nodeById(model, "order-stream").detail, /SnapTrade/);
  assert.equal(nodeById(model, "account-view").status, "healthy");
  assert.equal(
    edgeById(model, "broker-snaptrade-etrade->account-stream").label,
    "broker sync",
  );
  assert.equal(
    edgeById(model, "broker-snaptrade-etrade->order-stream").label,
    "broker orders",
  );
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

test("buildMachineStateDiagramModel attributes degraded signal inputs to Signals, not Algo Engine", () => {
  const latest = baseLatest();
  latest.snapshots = latest.snapshots.map((snapshot) =>
    snapshot.subsystem === "automation"
      ? {
          ...snapshot,
          status: "degraded",
          severity: "warning",
          summary: "Signal-options automation needs attention",
          metrics: {
            workerRunning: true,
            workerScanEnabled: true,
            latestScanAgeMs: 4_000,
            lastScanDurationMs: 16_856,
            gatewayBlockedCount: 0,
            failureCount: 0,
            signalCount: 12_000,
            freshSignalCount: 30,
            staleSignalCount: 0,
            unavailableSignalCount: 2_123,
            candidateCount: 0,
          },
        }
      : snapshot,
  );

  const model = buildModel({ latest });

  assert.equal(nodeById(model, "signal-engine").status, "checking");
  assert.match(nodeById(model, "signal-engine").detail, /2,123 unavailable/);
  assert.equal(nodeById(model, "algo-engine").status, "healthy");
  assert.match(nodeById(model, "algo-engine").detail, /0 candidates/);
});

test("buildMachineStateDiagramModel does not render the retired bridge governor bubble", () => {
  const model = buildModel();

  assert.equal(model.nodes.some((node) => node.id === "bridge-governor"), false);
  assert.equal(
    model.edges.some(
      (edge) => edge.from === "bridge-governor" || edge.to === "bridge-governor",
    ),
    false,
  );
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

test("buildMachineStateDiagramModel does not heal explicit unknown status with info severity", () => {
  const latest = baseLatest();
  latest.status = "unknown";
  latest.severity = "info";
  latest.snapshots = latest.snapshots.map((snapshot) =>
    snapshot.subsystem === "api"
      ? { ...snapshot, status: "unknown", severity: "info" }
      : snapshot,
  );
  const model = buildModel({ latest });
  assert.equal(nodeById(model, "api-runtime").status, "unknown");
  assert.equal(nodeById(model, "diagnostics-collector").status, "unknown");
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
  latest.events = [
    null,
    "boom",
    42,
    {},
    { status: "mystery" },
    { status: "resolved" },
  ];
  const model = buildModel({ latest });
  const incidents = nodeById(model, "diagnostics-incidents");
  assert.equal(incidents.status, "healthy");
  assert.equal(incidents.canonicalState, "IncidentResolved");
  assert.match(incidents.detail, /0 open/);
});

test("buildMachineStateDiagramModel treats a malformed incident collection as unknown", () => {
  const latest = baseLatest();
  latest.events = { status: "resolved" };
  const incidents = nodeById(buildModel({ latest }), "diagnostics-incidents");
  assert.equal(incidents.status, "unknown");
  assert.equal(incidents.evidence, "unknown");
});

test("buildMachineStateDiagramModel does not infer healthy trade management from unrelated automation metrics", () => {
  const latest = baseLatest();
  latest.snapshots = latest.snapshots
    .filter((snapshot) => snapshot.subsystem !== "orders")
    .map((snapshot) =>
      snapshot.subsystem === "automation"
        ? {
            ...snapshot,
            metrics: { latestScanAgeMs: 1_000 },
          }
        : snapshot,
    );
  const tradeManagement = nodeById(
    buildModel({ latest }),
    "trade-management",
  );
  assert.equal(tradeManagement.status, "unknown");
  assert.equal(tradeManagement.evidence, "unknown");
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
  const brokerGroup = MACHINE_STATE_GROUPS.find((group) => group.id === "broker");
  assert.equal(brokerGroup?.label, "Broker Feed");
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

test("buildMachineStateDiagramGroups derives the locked master edges", () => {
  const model = buildModel();
  const ids = model.groups.edges.map((edge) => edge.id);
  assert.deepEqual([...ids].sort(), [
    "account->algo",
    "account->client",
    "account->trade-mgmt",
    "algo->trade-mgmt",
    "broker->account",
    "client->diagnostics",
    "diagnostics->client",
    "flow->client",
    "flow->signals",
    "gex->client",
    "market->client",
    "market->signals",
    "massive->flow",
    "massive->gex",
    "massive->market",
    "signals->algo",
    "signals->client",
    "trade-mgmt->client",
    "trade-mgmt->diagnostics",
  ].sort());
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

test("database card keeps incomplete telemetry unknown", () => {
  const model = buildModel({
    latest: latestWithDatabase({
      storage: {
        databaseMb: 1200,
        monitoredTables: [{}],
      },
      resourcePressure: { dbPoolMax: 10 },
    }),
  });
  for (const id of [
    "database-health",
    "database-pool",
    "database-storage",
    "database-tables",
  ]) {
    const node = nodeById(model, id);
    assert.equal(node.status, "unknown", `${id} should not classify partial telemetry`);
    assert.equal(node.evidence, "unknown");
  }
});

test("database storage derives pressure from the warning threshold when level is absent", () => {
  const model = buildModel({
    latest: latestWithDatabase({
      storage: {
        ...healthyStorageMetrics,
        databaseMb: 20_000,
        storagePressureLevel: undefined,
      },
    }),
  });
  assert.equal(nodeById(model, "database-storage").status, "degraded");
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
      resourcePressure: {
        ...healthyPoolMetrics,
        dbPoolWaiting: 1,
        dbPoolRawWaiting: 1,
        dbPoolAdmissionWaiting: 22,
        dbPoolTotalWaiting: 23,
      },
    }),
  });
  const pool = nodeById(model, "database-pool");
  assert.equal(pool.status, "degraded");
  assert.equal(pool.canonicalState, "PoolSaturated");
  assert.match(pool.detail, /23 waiting/);
  assert.match(pool.detail, /1 pool/);
  assert.match(pool.detail, /22 admission/);
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
