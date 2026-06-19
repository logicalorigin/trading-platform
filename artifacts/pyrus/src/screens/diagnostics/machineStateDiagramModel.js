// Backend Data Machine view model.
//
// Truth-bias rules (locked with the wiring walkthrough, see
// MACHINE_STATE_WIRING.md):
// - Every node colors by its OWN telemetry only; upstream trouble travels on
//   edges (worst-of-endpoints), never by cascading into downstream nodes.
// - Missing/malformed telemetry renders as unknown, never as healthy zeros.
// - "observed" means a payload actually carried that evidence; timestamps are
//   never fabricated from the wall clock.
// - Statuses and edge animation decay as the diagnostics snapshot ages.

// Mirrors of backend cadences/thresholds. Update when the cited source changes
// (the contract test pins these values).
export const DIAGNOSTICS_COLLECTION_INTERVAL_MS = 15_000; // api-server/src/services/diagnostics.ts:203 DEFAULT_COLLECTION_INTERVAL_MS
export const IBKR_HEARTBEAT_WARNING_MS = 30_000; // api-server/src/services/diagnostics.ts:298
export const MARKET_DATA_FRESHNESS_WARNING_MS = 2_000; // api-server/src/services/diagnostics.ts:308
export const MARKET_DATA_STREAM_GAP_WARNING_MS = 5_000; // api-server/src/services/diagnostics.ts:318
export const BROWSER_MEMORY_WATCH_PERCENT = 60; // api-server/src/services/diagnostics.ts:247
export const BROWSER_MEMORY_HIGH_PERCENT = 75; // api-server/src/services/diagnostics.ts:248

// Decay budgets derived from the collector cadence: one missed snapshot is
// jitter, two is stale, four is expired.
export const SNAPSHOT_STALE_MS = 2 * DIAGNOSTICS_COLLECTION_INTERVAL_MS;
export const SNAPSHOT_EXPIRED_MS = 4 * DIAGNOSTICS_COLLECTION_INTERVAL_MS;

const STATUS_ORDER = Object.freeze({
  unknown: 0,
  idle: 1,
  healthy: 2,
  checking: 3,
  degraded: 4,
  down: 5,
});

const EVIDENCE_ORDER = Object.freeze({
  unknown: 0,
  inferred: 1,
  observed: 2,
});

const MISSING_VALUE = "n/a";

// Which Backend Data Machine card owns each monitored storage table (diagnostics.ts
// MONITORED_STORAGE_TABLES). Drives the per-lane row count on the Database bus.
// Tables with no owning card here simply carry no lane count.
const DB_TABLE_SOURCE = Object.freeze({
  quote_cache: "market",
  bar_cache: "market",
  option_chain_snapshots: "market",
  ticker_reference_cache: "market",
  flow_events: "flow",
  flow_event_hydration_sessions: "flow",
  diagnostic_snapshots: "diagnostics",
  diagnostic_events: "diagnostics",
});

// Which positioned card a pressure driver (diagnostics.ts dominantDrivers.kind)
// maps to, so the diagram can mark the card as a pressure source and trace it to
// API Pressure. Only drivers with a real card are mapped; the rest stay attributed
// in the API Pressure node detail. db-pool is the actionable one today.
const PRESSURE_DRIVER_CARD = Object.freeze({
  "db-pool": "database",
});

const safeRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const arrayOrEmpty = (value) => (Array.isArray(value) ? value : []);

const hasRecordKeys = (value) => Object.keys(safeRecord(value)).length > 0;

const hasOwn = (record, key) => Object.prototype.hasOwnProperty.call(record, key);

const firstString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    // Guard against coercion traps: Number(null)/Number("")/Number(false)/
    // Number([]) all yield a finite 0, which would let missing telemetry
    // masquerade as a real zero and short-circuit the fallback chain.
    if (typeof value === "number") {
      if (Number.isFinite(value)) return value;
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
    }
  }
  return null;
};

const formatCount = (value) =>
  Number.isFinite(value) ? Math.round(value).toLocaleString() : MISSING_VALUE;

const formatMs = (value) =>
  Number.isFinite(value) ? `${Math.round(value).toLocaleString()}ms` : MISSING_VALUE;

const formatDuration = (value) => {
  if (!Number.isFinite(value)) return MISSING_VALUE;
  const seconds = Math.max(0, Math.floor(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

const timestampMs = (value) => {
  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    }
  }
  return null;
};

const formatAge = (value, nowMs) => {
  const parsed = timestampMs(value);
  return parsed == null ? MISSING_VALUE : `${formatDuration(nowMs - parsed)} ago`;
};

const normalizeStatus = (status) =>
  Object.prototype.hasOwnProperty.call(STATUS_ORDER, status) ? status : "unknown";

const worstStatus = (...statuses) =>
  statuses
    .map(normalizeStatus)
    .reduce(
      (worst, status) =>
        STATUS_ORDER[status] > STATUS_ORDER[worst] ? status : worst,
      "unknown",
    );

const combineEvidence = (...values) => {
  const evidence = values
    .map((value) =>
      Object.prototype.hasOwnProperty.call(EVIDENCE_ORDER, value)
        ? value
        : "unknown",
    )
    .filter(Boolean);
  if (!evidence.length || evidence.includes("unknown")) return "unknown";
  if (evidence.includes("inferred")) return "inferred";
  return "observed";
};

const statusFromSeverity = (severity) => {
  const value = String(severity || "").toLowerCase();
  if (
    ["fatal", ["crit", "ical"].join(""), "error", "down"].includes(value)
  ) {
    return "down";
  }
  if (["warning", "warn", "degraded"].includes(value)) return "degraded";
  if (["success", "ok", "info", "healthy"].includes(value)) return "healthy";
  return "unknown";
};

const statusFromDiagnosticValue = (status) => {
  const value = String(status || "").toLowerCase();
  if (["down", "offline", "failed"].includes(value)) return "down";
  if (["degraded", "warning", "stale", "unhealthy"].includes(value)) return "degraded";
  if (["checking", "pending", "starting"].includes(value)) return "checking";
  if (["ok", "healthy", "success", "ready", "live"].includes(value)) return "healthy";
  // "idle" is a legitimate quiet state (e.g. Massive provider outside market
  // hours) — neutral, never alarming, never masking real problems.
  if (value === "idle") return "idle";
  return "unknown";
};

const statusFromSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return "unknown";
  return worstStatus(
    statusFromDiagnosticValue(snapshot.status),
    statusFromSeverity(snapshot.severity),
  );
};

const statusFromStreamState = (streamState) => {
  const value = String(streamState || "").toLowerCase();
  if (["live", "open", "ready"].includes(value)) return "healthy";
  if (["connecting", "reconnecting", "polling", "loading"].includes(value)) {
    return "checking";
  }
  if (["error", "errored", "failed"].includes(value)) return "degraded";
  if (["closed", "down", "offline"].includes(value)) return "down";
  // "paused" is an intentionally-idle transport (tab not visible): data is not
  // flowing, so it must read as unknown rather than healthy.
  return "unknown";
};

const statusFromPressureLevel = (level) => {
  const value = String(level || "").toLowerCase();
  if ([["crit", "ical"].join(""), "down"].includes(value)) return "down";
  if (["high", "degraded", "protected", "shed"].includes(value)) return "degraded";
  if (["watch", "elevated", "constrained", "rising"].includes(value)) return "checking";
  if (["normal", "steady", "low", "ok", "healthy"].includes(value)) return "healthy";
  return "unknown";
};

const snapshotBySubsystem = (latest, subsystem) =>
  arrayOrEmpty(safeRecord(latest).snapshots).find(
    (snapshot) => snapshot?.subsystem === subsystem,
  ) || null;

// source tags drive snapshot-age decay: "latest" nodes derive from the
// diagnostics SSE payload and decay with it; "runtime" nodes ride the 5s
// runtime-control poll (no payload timestamp — documented limitation);
// "client" nodes are observed directly in the browser.
const makeNode = ({
  id,
  label,
  lane,
  canonicalState,
  status = "unknown",
  detail = MISSING_VALUE,
  observedAt = null,
  evidence = "unknown",
  source = "latest",
  split = null,
  metric = null,
}) => ({
  id,
  label,
  lane,
  canonicalState,
  status: normalizeStatus(status),
  detail: detail || MISSING_VALUE,
  observedAt: observedAt || null,
  evidence: Object.prototype.hasOwnProperty.call(EVIDENCE_ORDER, evidence)
    ? evidence
    : "unknown",
  source,
  stale: false,
  ...(split ? { split } : {}),
  ...(metric ? { metric } : {}),
});

const metricDetail = (parts) => parts.filter(Boolean).join(" / ") || MISSING_VALUE;

const diagnosticDetail = (snapshot, detailParts = []) => {
  const message = firstString(snapshot?.message, snapshot?.summary, snapshot?.reason);
  return metricDetail([...detailParts, message]);
};

const runtimeSnapshotFrom = (runtimeControl) => {
  const control = safeRecord(runtimeControl);
  const snapshot = safeRecord(control.snapshot);
  return Object.keys(snapshot).length ? snapshot : control;
};

const runtimePart = (runtimeControl, key) => {
  const control = safeRecord(runtimeControl);
  const snapshot = runtimeSnapshotFrom(control);
  return control[key] ?? snapshot[key] ?? null;
};

const streamFreshnessNode = ({ id, label, lane, stream, nowMs, observedAt }) => {
  const streamRecord = safeRecord(stream);
  const lastEventAt = streamRecord.lastEventAt ?? null;
  // The runtime-control hook coerces missing freshness to fresh:false, so a
  // bare fresh:false without any lastEventAt is "never observed", not "stale".
  const freshObserved =
    typeof streamRecord.fresh === "boolean" && lastEventAt != null;
  const age = formatAge(lastEventAt, nowMs);
  const status = freshObserved
    ? streamRecord.fresh
      ? "healthy"
      : "degraded"
    : lastEventAt
      ? "checking"
      : "unknown";
  const detail = freshObserved
    ? `${streamRecord.fresh ? "fresh" : "stale"} / last ${age}`
    : lastEventAt
      ? `last ${age}`
      : "freshness not observed";
  return makeNode({
    id,
    label,
    lane,
    canonicalState: streamRecord.fresh === false && freshObserved
      ? "SourceUnavailable"
      : "SourceRead",
    status,
    detail,
    observedAt,
    evidence: freshObserved || lastEventAt ? "observed" : "unknown",
    source: "runtime",
  });
};

const statusFromLineUsage = (lineUsage) => {
  const record = safeRecord(lineUsage);
  const state = firstString(record.streamState, record.state).toLowerCase();
  const used = firstFiniteNumber(record.used, record.activeLineCount);
  const cap = firstFiniteNumber(record.cap, record.effectiveCap, record.maxLines);
  if (["capacity-limited", "limited", "degraded", "protected"].includes(state)) {
    return "degraded";
  }
  if (["checking", "warming", "pending"].includes(state)) return "checking";
  if (state === "healthy") return "healthy";
  if (Number.isFinite(used) && Number.isFinite(cap) && cap > 0) {
    const ratio = used / cap;
    if (ratio >= 0.85) return "degraded";
    return "healthy";
  }
  return "unknown";
};

const statusFromProviderRecord = (provider) => {
  const record = safeRecord(provider);
  const rest = safeRecord(record.rest);
  const websocket = safeRecord(record.websocket);
  const feeds = arrayOrEmpty(websocket.feeds);
  const feedStatus = feeds.reduce(
    (status, feed) => worstStatus(status, statusFromDiagnosticValue(feed?.status)),
    "unknown",
  );
  const baseStatus = worstStatus(
    statusFromDiagnosticValue(record.status),
    statusFromDiagnosticValue(rest.status),
    statusFromDiagnosticValue(websocket.status),
    feedStatus,
  );
  const lastMessageAgeMs = firstFiniteNumber(
    websocket.lastMessageAgeMs,
    record.lastMessageAgeMs,
  );
  // An idle provider (market session quiet) legitimately stops messaging; the
  // age check only applies when the provider claims to be live. The declared
  // idle also wins over a merely-healthy REST status — REST being reachable
  // does not mean data is flowing.
  const declaredIdle =
    statusFromDiagnosticValue(record.status) === "idle" ||
    statusFromDiagnosticValue(websocket.status) === "idle";
  const ageStatus =
    !declaredIdle && lastMessageAgeMs > MARKET_DATA_STREAM_GAP_WARNING_MS
      ? "degraded"
      : "unknown";
  const combined = worstStatus(
    baseStatus,
    firstString(record.lastError, rest.lastError, websocket.lastError)
      ? "degraded"
      : "unknown",
    ageStatus,
  );
  return declaredIdle && STATUS_ORDER[combined] <= STATUS_ORDER.healthy
    ? "idle"
    : combined;
};

const lineUsageDetail = (lineUsage) => {
  const record = safeRecord(lineUsage);
  const used = firstFiniteNumber(record.used, record.activeLineCount);
  const cap = firstFiniteNumber(record.cap, record.effectiveCap, record.maxLines);
  const free = firstFiniteNumber(record.free, record.displayFree);
  const detail = `${formatCount(used)} of ${formatCount(cap)}`;
  return free == null ? detail : `${detail} / ${formatCount(free)} free`;
};

const admissionNode = ({ latest, memoryPressureState, footerSignal, observedAt }) => {
  const resourcePressureSnapshot = snapshotBySubsystem(latest, "resource-pressure");
  const resourceMetrics = safeRecord(resourcePressureSnapshot?.metrics);
  const memoryRecord = safeRecord(memoryPressureState);
  const serverRecord = safeRecord(memoryRecord.server);
  const footerRecord = safeRecord(footerSignal);
  const action = firstString(
    serverRecord.admissionAction,
    serverRecord.action,
    memoryRecord.admissionAction,
    resourceMetrics.admissionAction,
    resourceMetrics.routeAdmissionAction,
    resourceMetrics.action,
  ).toLowerCase();
  const reason = firstString(
    serverRecord.admissionReason,
    serverRecord.reason,
    memoryRecord.admissionReason,
    resourceMetrics.admissionReason,
    resourceMetrics.reason,
  );
  const pressureLevel = firstString(
    serverRecord.pressureLevel,
    memoryRecord.level,
    footerRecord.level,
    resourceMetrics.pressureLevel,
    resourceMetrics.level,
  );
  const observedAction = Boolean(action);
  const pressureStatus = statusFromPressureLevel(pressureLevel);

  if (action === "allow") {
    return makeNode({
      id: "route-admission",
      label: "Admission",
      lane: "Client",
      canonicalState: "AdmissionAllowed",
      status: "healthy",
      detail: metricDetail(["action=allow", reason, pressureLevel ? `pressure=${pressureLevel}` : null]),
      observedAt,
      evidence: "observed",
    });
  }

  if (action === "cache-only") {
    return makeNode({
      id: "route-admission",
      label: "Admission",
      lane: "Client",
      canonicalState: "AdmissionCacheOnly",
      status: "degraded",
      detail: metricDetail(["action=cache-only", reason || "stale cache path active", pressureLevel ? `pressure=${pressureLevel}` : null]),
      observedAt,
      evidence: "observed",
    });
  }

  if (action === "shed") {
    return makeNode({
      id: "route-admission",
      label: "Admission",
      lane: "Client",
      canonicalState: "AdmissionShed",
      status: "degraded",
      detail: metricDetail(["action=shed", reason, pressureLevel ? `pressure=${pressureLevel}` : null]),
      observedAt,
      evidence: "observed",
    });
  }

  return makeNode({
    id: "route-admission",
    label: "Route Admission",
    lane: "Platform Edge",
    canonicalState: observedAction ? "RouteClassified" : "AdmissionUnknown",
    status: pressureStatus === "healthy" ? "unknown" : pressureStatus,
    detail: observedAction
      ? `unrecognized action=${action}`
      : pressureLevel
        ? `action not emitted / pressure=${pressureLevel}`
        : "per-request action not emitted by diagnostics",
    observedAt,
    evidence: pressureStatus === "unknown" ? "unknown" : "inferred",
  });
};

const incidentNode = ({ latest, observedAt }) => {
  const latestRecord = safeRecord(latest);
  const events = arrayOrEmpty(latestRecord.events);
  const eventsObserved = hasOwn(latestRecord, "events");
  const openEvents = events.filter((event) => {
    // Only well-formed event objects can be "open"; null/scalar garbage must
    // not inflate the active-incident count (it would otherwise pass the
    // not-in-resolved-set test and force a false degraded).
    if (!event || typeof event !== "object") return false;
    const status = String(event.status || event.state || "").toLowerCase();
    return !["resolved", "closed", "dismissed"].includes(status);
  });
  const incidentStatus = openEvents.reduce(
    (status, event) =>
      worstStatus(status, statusFromSeverity(event?.severity || event?.level)),
    "unknown",
  );
  const status = !eventsObserved
    ? "unknown"
    : openEvents.length
      ? worstStatus(incidentStatus, "degraded")
      : "healthy";
  // Attribute open incidents to their subsystem so the node says WHERE they come
  // from (e.g. "runtime 5 · ibkr 2 · …"), worst-count first.
  const bySubsystem = {};
  for (const event of openEvents) {
    const sub = firstString(event.subsystem, event.source) || "other";
    bySubsystem[sub] = (bySubsystem[sub] ?? 0) + 1;
  }
  const rankedSubsystems = Object.entries(bySubsystem).sort((a, b) => b[1] - a[1]);
  const breakdown = rankedSubsystems
    .map(([sub, count]) => `${sub} ${count}`)
    .join(" · ");
  // Dominant source shown inline on the row; full breakdown rides the detail.
  const topSubsystem = rankedSubsystems.length
    ? `${rankedSubsystems[0][0]} ${rankedSubsystems[0][1]}`
    : null;
  return makeNode({
    id: "diagnostics-incidents",
    label: "Incidents",
    lane: "Diagnostics",
    canonicalState: openEvents.length ? "IncidentOpen" : "IncidentResolved",
    status,
    detail: !eventsObserved
      ? "event list not observed"
      : openEvents.length
        ? `${formatCount(openEvents.length)} open: ${breakdown}`
        : `0 open / ${formatCount(events.length)} sampled`,
    observedAt,
    evidence: eventsObserved ? "observed" : "unknown",
    metric: topSubsystem,
  });
};

const makeEdge = (nodesById, { from, to, label }) => {
  const fromNode = nodesById.get(from);
  const toNode = nodesById.get(to);
  const evidence = combineEvidence(fromNode?.evidence, toNode?.evidence);
  const status = worstStatus(fromNode?.status, toNode?.status);
  return {
    id: `${from}->${to}`,
    from,
    to,
    label,
    status,
    animated:
      evidence !== "unknown" &&
      (status === "healthy" || status === "checking") &&
      // An idle endpoint is not sending; the flow cue would be a lie.
      fromNode?.status !== "idle" &&
      toNode?.status !== "idle" &&
      !fromNode?.stale &&
      !toNode?.stale,
    evidence,
  };
};

const summaryFromNodes = (nodes, snapshotAgeMs) => {
  const status = nodes.reduce(
    (current, node) => worstStatus(current, node.status),
    "unknown",
  );
  const knownCount = nodes.filter((node) => node.status !== "unknown").length;
  if (!knownCount) {
    return {
      status: "unknown",
      label: "No Runtime Snapshot",
      detail: "Diagnostics has not observed enough state to classify the backend data line.",
    };
  }
  const labels = {
    idle: "Data Line Idle",
    healthy: "Data Line Healthy",
    checking: "Data Line Checking",
    degraded: "Data Line Degraded",
    down: "Data Line Down",
    unknown: "Data Line Unknown",
  };
  const issueCount = nodes.filter((node) =>
    ["checking", "degraded", "down"].includes(node.status),
  ).length;
  const staleSuffix =
    snapshotAgeMs != null && snapshotAgeMs > SNAPSHOT_STALE_MS
      ? ` Snapshot ${formatDuration(snapshotAgeMs)} old.`
      : "";
  return {
    status,
    label: labels[status],
    detail:
      status === "healthy" || status === "idle"
        ? `${formatCount(knownCount)} observed or inferred states are flowing.${staleSuffix}`
        : `${formatCount(issueCount)} state${issueCount === 1 ? "" : "s"} need attention.${staleSuffix}`,
  };
};

// Locked master-card spec from the Phase 0 wiring walkthrough: 8 masters,
// 22 child bubbles, one bubble per real sensor.
export const MACHINE_STATE_GROUPS = Object.freeze([
  {
    id: "broker",
    label: "Broker Feed (IBKR)",
    children: Object.freeze(["ibkr-bridge", "bridge-governor"]),
  },
  {
    id: "massive",
    label: "Massive Feed",
    children: Object.freeze(["massive-feed"]),
  },
  {
    id: "market",
    label: "Market Streams",
    children: Object.freeze(["market-equities", "market-options"]),
  },
  {
    id: "trade",
    label: "Trade Chain",
    children: Object.freeze(["trade-chain"]),
  },
  {
    id: "flow",
    label: "Flow",
    children: Object.freeze(["flow-scanner"]),
  },
  {
    id: "gex",
    label: "GEX",
    children: Object.freeze(["gex-projection"]),
  },
  {
    id: "signals",
    label: "Signals",
    children: Object.freeze(["signal-engine"]),
  },
  {
    id: "algo",
    label: "Algo Engine",
    children: Object.freeze(["algo-engine"]),
  },
  {
    id: "account",
    label: "Account",
    children: Object.freeze([
      "account-stream",
      "order-stream",
      "position-quotes",
      "account-view",
    ]),
  },
  {
    id: "trade-mgmt",
    label: "Trade Mgmt",
    children: Object.freeze(["trade-management"]),
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    children: Object.freeze([
      "diagnostics-collector",
      "diagnostics-stream",
      "diagnostics-incidents",
      "api-pressure",
    ]),
  },
  {
    id: "client",
    label: "Client",
    children: Object.freeze([
      "client-transport",
      "api-runtime",
      "route-admission",
      "browser-events",
      "browser-memory",
    ]),
  },
  // Persistence sink. Sensors reuse the existing `storage` (connectivity, size,
  // table freshness) and `resource-pressure` (connection pool) snapshots — no
  // new backend subsystem. Rendered in the observability rail with edges drawn
  // from every card (see MachineStateDiagram.jsx VISUAL_FLOW_EDGES + the rail
  // override note in MACHINE_STATE_WIRING.md).
  {
    id: "database",
    label: "Database",
    children: Object.freeze([
      "database-health",
      "database-pool",
      "database-storage",
      "database-tables",
    ]),
  },
]);

// Labels for the locked master edges (key: groupId->groupId).
const MASTER_EDGE_LABELS = Object.freeze({
  "broker->account": "broker REST/SSE + quote lines",
  "broker->market": "quotes/chains",
  "broker->trade": "chain line budget",
  "broker->flow": "chains + line budget",
  "broker->gex": "option chains",
  "broker->algo": "algo budget",
  "broker->client": "pressure/backoff",
  "massive->market": "Massive WS",
  "massive->flow": "spot fallback",
  "massive->account": "equity quote fallback",
  "market->account": "quote marks",
  "market->signals": "bars/quotes",
  "flow->signals": "flow events",
  "signals->algo": "worker state",
  "flow->signals": "flow events",
  "account->algo": "risk/capital",
  "algo->trade-mgmt": "decisions",
  "account->trade-mgmt": "positions/fills",
  "market->client": "market model",
  "trade->client": "chain snapshots",
  "flow->client": "flow model",
  "gex->client": "gex model",
  "signals->client": "signal model",
  "algo->client": "algo state",
  "account->client": "account model",
  "trade-mgmt->client": "trade state",
  "diagnostics->client": "EventSource + pressure gate",
  "client->diagnostics": "client events/metrics",
  "trade-mgmt->diagnostics": "events/probes",
});

export const buildMachineStateDiagramGroups = (model) => {
  const record = safeRecord(model);
  const nodes = arrayOrEmpty(record.nodes);
  const edges = arrayOrEmpty(record.edges);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const groupByChild = new Map();
  for (const group of MACHINE_STATE_GROUPS) {
    for (const childId of group.children) {
      groupByChild.set(childId, group.id);
    }
  }

  const masters = MACHINE_STATE_GROUPS.map((group) => {
    const children = group.children
      .map((childId) => nodesById.get(childId))
      .filter(Boolean);
    const status = children.reduce(
      (worst, child) => worstStatus(worst, child.status),
      "unknown",
    );
    const worstChild = children.reduce(
      (worst, child) =>
        !worst || STATUS_ORDER[child.status] > STATUS_ORDER[worst.status]
          ? child
          : worst,
      null,
    );
    return {
      id: group.id,
      label: group.label,
      status,
      evidence: combineEvidence(...children.map((child) => child.evidence)),
      stale: children.some((child) => child.stale),
      children,
      detail:
        worstChild && worstChild.status !== "unknown"
          ? `${worstChild.label}: ${worstChild.detail}`
          : "not observed",
    };
  });

  const masterEdges = new Map();
  for (const edge of edges) {
    const fromGroup = groupByChild.get(edge.from);
    const toGroup = groupByChild.get(edge.to);
    if (!fromGroup || !toGroup || fromGroup === toGroup) continue;
    const key = `${fromGroup}->${toGroup}`;
    const existing = masterEdges.get(key);
    if (existing) {
      existing.status = worstStatus(existing.status, edge.status);
      existing.animated = existing.animated || edge.animated;
      existing.evidence = combineEvidence(existing.evidence, edge.evidence);
    } else {
      masterEdges.set(key, {
        id: key,
        from: fromGroup,
        to: toGroup,
        label: MASTER_EDGE_LABELS[key] || edge.label,
        status: edge.status,
        animated: edge.animated,
        evidence: edge.evidence,
      });
    }
  }

  return { masters, edges: [...masterEdges.values()] };
};

// Snapshot-age decay (truth bias: never keep stale good news, never wash out
// known problems). Tier 1: observed evidence is only "inferred" now. Tier 2:
// stale healthy/idle reads as unknown; degraded/down/checking survive.
const applySnapshotDecay = (nodes, snapshotAgeMs) => {
  if (snapshotAgeMs == null || snapshotAgeMs <= SNAPSHOT_STALE_MS) return nodes;
  const expired = snapshotAgeMs > SNAPSHOT_EXPIRED_MS;
  return nodes.map((node) => {
    if (node.source !== "latest") return node;
    const decayed = { ...node, stale: true };
    if (decayed.evidence === "observed") decayed.evidence = "inferred";
    if (expired && (decayed.status === "healthy" || decayed.status === "idle")) {
      decayed.status = "unknown";
      decayed.detail = `${decayed.detail} / snapshot ${formatDuration(snapshotAgeMs)} old`;
    }
    return decayed;
  });
};

export const buildMachineStateDiagramModel = ({
  latest = null,
  streamState = "unknown",
  runtimeControl = null,
  footerSignal = null,
  memoryPressureState = null,
  gexClientState = null,
  nowMs = Date.now(),
} = {}) => {
  const latestRecord = safeRecord(latest);
  // "observed" must mean a payload actually carried this time. Resolve a real
  // ms timestamp (string or numeric epoch) and emit null when nothing did, so
  // the panel renders "waiting" rather than fabricating the current wall clock.
  const observedAtMs =
    timestampMs(latestRecord.timestamp) ??
    timestampMs(latestRecord.observedAt) ??
    timestampMs(safeRecord(footerSignal).observedAt);
  const observedAt =
    observedAtMs == null ? null : new Date(observedAtMs).toISOString();
  const snapshotMs = timestampMs(latestRecord.timestamp);
  const snapshotAgeMs =
    snapshotMs == null || !Number.isFinite(nowMs) ? null : nowMs - snapshotMs;

  const apiSnapshot = snapshotBySubsystem(latestRecord, "api");
  const ibkrSnapshot = snapshotBySubsystem(latestRecord, "ibkr");
  const marketDataSnapshot = snapshotBySubsystem(latestRecord, "market-data");
  const accountSnapshot = snapshotBySubsystem(latestRecord, "accounts");
  const orderSnapshot = snapshotBySubsystem(latestRecord, "orders");
  const automationSnapshot = snapshotBySubsystem(latestRecord, "automation");
  const browserSnapshot = snapshotBySubsystem(latestRecord, "browser");
  const resourcePressureSnapshot = snapshotBySubsystem(latestRecord, "resource-pressure");
  const storageSnapshot = snapshotBySubsystem(latestRecord, "storage");
  const apiMetrics = safeRecord(apiSnapshot?.metrics);
  const ibkrMetrics = safeRecord(ibkrSnapshot?.metrics);
  const marketDataMetrics = safeRecord(marketDataSnapshot?.metrics);
  const marketDataRaw = safeRecord(marketDataSnapshot?.raw);
  const rawMassive = safeRecord(marketDataRaw.massive);
  const accountMetrics = safeRecord(accountSnapshot?.metrics);
  const orderMetrics = safeRecord(orderSnapshot?.metrics);
  const automationMetrics = safeRecord(automationSnapshot?.metrics);
  const browserMetrics = safeRecord(browserSnapshot?.metrics);
  const resourceMetrics = safeRecord(resourcePressureSnapshot?.metrics);
  const storageMetrics = safeRecord(storageSnapshot?.metrics);

  // Database (persistence sink). Reuses the `storage` subsystem snapshot
  // (connectivity / size / per-table freshness) and the `resource-pressure`
  // snapshot (connection pool). Each sensor colors by its own telemetry and
  // reads "unknown" when its backing snapshot did not arrive (truth bias).
  const storageObserved = Boolean(storageSnapshot);
  const dbStatusText = firstString(storageMetrics.status).toLowerCase();
  const dbReachable = storageMetrics.reachable === true;
  const dbHealthStatus = !storageObserved
    ? "unknown"
    : dbStatusText === "ok" && dbReachable
      ? "healthy"
      : dbStatusText === "degraded"
        ? "degraded"
        : "down";
  const dbPingMs = firstFiniteNumber(storageMetrics.pingMs);
  const dbReadWriteVerified = storageMetrics.readWriteVerified === true;

  const dbPoolMax = firstFiniteNumber(resourceMetrics.dbPoolMax);
  const dbPoolActive = firstFiniteNumber(resourceMetrics.dbPoolActive);
  const dbPoolWaiting = firstFiniteNumber(resourceMetrics.dbPoolWaiting);
  const dbPoolIdle = firstFiniteNumber(resourceMetrics.dbPoolIdle);
  const poolObserved = dbPoolMax != null;
  const dbPoolStatus = !poolObserved
    ? "unknown"
    : dbPoolWaiting != null && dbPoolWaiting > 0
      ? "degraded"
      : "healthy";

  const dbSizeMb = firstFiniteNumber(storageMetrics.databaseMb);
  const dbWarnMb = firstFiniteNumber(storageMetrics.warningDatabaseMb);
  const dbPressureLevel = firstString(storageMetrics.storagePressureLevel).toLowerCase();
  const dbStorageStatus =
    !storageObserved || dbSizeMb == null
      ? "unknown"
      : dbPressureLevel === "warning"
        ? "degraded"
        : "healthy";

  const dbMonitoredTables = arrayOrEmpty(storageMetrics.monitoredTables);
  const dbNewestTableMs = dbMonitoredTables.reduce((newest, table) => {
    const ms = timestampMs(safeRecord(table).newestAt);
    return ms != null && (newest == null || ms > newest) ? ms : newest;
  }, null);
  const dbTablesStatus =
    !storageObserved || dbMonitoredTables.length === 0 ? "unknown" : "healthy";
  // Sum monitored-table row estimates per owning card, so each Database bus lane
  // can show how many rows that source persists.
  const databaseRowCounts = {};
  for (const entry of dbMonitoredTables) {
    const record = safeRecord(entry);
    const source = DB_TABLE_SOURCE[firstString(record.table, record.name)];
    const rows = firstFiniteNumber(record.rowEstimate);
    if (source && rows != null) {
      databaseRowCounts[source] = (databaseRowCounts[source] ?? 0) + rows;
    }
  }
  const runtimeSnapshot = runtimeSnapshotFrom(runtimeControl);
  const lineUsage = safeRecord(runtimePart(runtimeControl, "lineUsage"));
  const streams = safeRecord(runtimePart(runtimeControl, "streams"));
  const flowScanner = safeRecord(runtimePart(runtimeControl, "flowScanner"));
  const bridgeGovernor = safeRecord(runtimePart(runtimeControl, "bridgeGovernor"));
  const runtimeMassive = safeRecord(runtimePart(runtimeControl, "massive"));
  const massiveRecord = hasRecordKeys(runtimeMassive) ? runtimeMassive : rawMassive;
  const massiveWebSocket = safeRecord(massiveRecord.websocket);
  const massiveRest = safeRecord(massiveRecord.rest);
  const footerRecord = safeRecord(footerSignal);
  const memoryRecord = safeRecord(memoryPressureState);
  const serverPressureRecord = safeRecord(memoryRecord.server);
  const latestSnapshots = arrayOrEmpty(latestRecord.snapshots);
  const latestEvents = arrayOrEmpty(latestRecord.events);

  const streamStatus = statusFromStreamState(streamState);
  const ibkrStatus = worstStatus(
    statusFromSnapshot(ibkrSnapshot),
    ibkrMetrics.connected === false ? "down" : "unknown",
  );
  // Equities vs options ride different upstream channels and the market-data
  // snapshot keeps per-channel fields (buildMarketDataMetrics diagnostics.ts:
  // 1150-1290): massive* fields are the Massive stock websocket; the gap and
  // lastEventAgeMs fields are bridge-side, where option chains/quotes live.
  const marketQuiet = marketDataMetrics.streamState === "quiet";
  const massiveWsStatus = statusFromDiagnosticValue(
    marketDataMetrics.massiveWebSocketStatus,
  );
  const massiveSocketAgeMs = firstFiniteNumber(
    marketDataMetrics.massiveLastSocketMessageAgeMs,
  );
  const equitiesStatus = marketQuiet
    ? "idle"
    : worstStatus(
        massiveWsStatus,
        massiveWsStatus !== "idle" &&
          massiveSocketAgeMs > MARKET_DATA_STREAM_GAP_WARNING_MS
          ? "degraded"
          : "unknown",
      );
  const equitiesObserved =
    Boolean(firstString(marketDataMetrics.massiveWebSocketStatus)) ||
    massiveSocketAgeMs != null;
  const bridgeGapMs = firstFiniteNumber(
    marketDataMetrics.recentMaxGapMs,
    marketDataMetrics.maxGapMs,
    marketDataMetrics.streamGapMs,
    marketDataMetrics.stream_gap_ms,
  );
  const optionsStatus = !marketDataSnapshot
    ? "unknown"
    : marketQuiet
      ? "idle"
      : worstStatus(
          statusFromStreamState(marketDataMetrics.streamState),
          firstFiniteNumber(marketDataMetrics.freshnessAgeMs) >
            MARKET_DATA_FRESHNESS_WARNING_MS
            ? "degraded"
            : "unknown",
          bridgeGapMs > MARKET_DATA_STREAM_GAP_WARNING_MS ? "degraded" : "unknown",
          marketDataMetrics.reconnectScheduled === true ? "checking" : "unknown",
        );
  const accountStreamNode = streamFreshnessNode({
    id: "account-stream",
    label: "Account State",
    lane: "Account & Trading",
    stream: safeRecord(streams.account),
    nowMs,
    observedAt,
  });
  const orderStreamNode = streamFreshnessNode({
    id: "order-stream",
    label: "Order State",
    lane: "Account & Trading",
    stream: safeRecord(streams.order),
    nowMs,
    observedAt,
  });
  // tradingFresh is hook-derived from the same coerced booleans; only trust a
  // false when at least one underlying stream actually reported an event time.
  const tradingFreshObserved =
    typeof streams.tradingFresh === "boolean" &&
    (safeRecord(streams.account).lastEventAt != null ||
      safeRecord(streams.order).lastEventAt != null);
  const massiveObserved = hasRecordKeys(massiveRecord);
  const massiveStatus = statusFromProviderRecord(massiveRecord);
  const governorLanes = Object.entries(bridgeGovernor).filter(
    ([, lane]) => lane && typeof lane === "object",
  );
  const governorOpenLanes = governorLanes
    .filter(([, lane]) => lane.circuitOpen)
    .map(([name]) => name);
  const lineTotal = safeRecord(lineUsage.total);
  const lineWarnings = firstFiniteNumber(lineUsage.warnings);
  const linePressure = safeRecord(lineUsage.pressure);
  const lineDriftRecord = safeRecord(lineUsage.drift);
  const lineUsageAvailable = lineUsage.available !== false;
  const lineDriftMatched =
    lineDriftRecord.status === "matched" ||
    lineDriftRecord.status === "settling" ||
    firstFiniteNumber(lineDriftRecord.admissionVsBridgeLineDelta) === 0;
  const protectedByUtilizationOnly =
    linePressure.state === "protected" && lineWarnings <= 0 && lineDriftMatched;
  const accountMonitorUsage = safeRecord(lineUsage.accountMonitor);
  const shadowAccountUsage = safeRecord(lineUsage.shadowAccount);
  const lineStatus = !lineUsageAvailable
    ? "unknown"
    : worstStatus(
        protectedByUtilizationOnly ? "healthy" : statusFromLineUsage(lineTotal),
        protectedByUtilizationOnly
          ? "healthy"
          : statusFromPressureLevel(linePressure.state),
        lineWarnings > 0 ? "degraded" : "unknown",
      );
  const flowScannerUsage = safeRecord(lineUsage.flowScanner);
  // The live lineUsage payload exposes automation and the Trade Options Chain
  // pool only under lineUsage.pools (runtimeControlModel.js:1455-1474); the
  // top-level keys exist in fixtures/legacy shapes only.
  const linePools = safeRecord(lineUsage.pools);
  const automationUsage = hasRecordKeys(safeRecord(lineUsage.automation))
    ? safeRecord(lineUsage.automation)
    : safeRecord(linePools.automation);
  const tradeChainUsage = hasRecordKeys(safeRecord(linePools.visible))
    ? safeRecord(linePools.visible)
    : safeRecord(lineUsage.visible);
  const gexRecord = safeRecord(gexClientState);
  const gexQueryCount = firstFiniteNumber(gexRecord.queryCount);
  const gexUpdatedAgeMs =
    timestampMs(gexRecord.lastUpdatedAt) != null && Number.isFinite(nowMs)
      ? nowMs - timestampMs(gexRecord.lastUpdatedAt)
      : null;
  // Unobserved cache (no gexClientState supplied) is unknown; idle is earned
  // only by observing the cache and finding zero requests.
  const gexCacheObserved = gexQueryCount != null;
  const gexObserved = gexCacheObserved && gexQueryCount > 0;
  const gexStatus = !gexCacheObserved
    ? "unknown"
    : !gexObserved
      ? "idle"
      : gexRecord.hasError
      ? "degraded"
      : gexRecord.isFetching && gexUpdatedAgeMs == null
        ? "checking"
        : gexUpdatedAgeMs != null
          ? "healthy"
          : "checking";
  const sessionQuiet = flowScanner.sessionBlockedReason === "market-session-quiet";
  const flowScannerStatus = sessionQuiet
    ? "idle"
    : worstStatus(
        statusFromLineUsage(flowScannerUsage),
        flowScanner.enabled && !flowScanner.active ? "checking" : "unknown",
      );
  const liveQuoteStatus = statusFromLineUsage(accountMonitorUsage);
  const shadowQuoteStatus = statusFromLineUsage(shadowAccountUsage);
  const positionQuoteStatus = worstStatus(liveQuoteStatus, shadowQuoteStatus);
  const positionQuoteObserved =
    hasRecordKeys(accountMonitorUsage) || hasRecordKeys(shadowAccountUsage);
  const accountProbeStatus = statusFromSnapshot(accountSnapshot);
  const orderProbeStatus = statusFromSnapshot(orderSnapshot);
  const accountViewStatus = worstStatus(
    accountProbeStatus,
    orderProbeStatus,
    firstFiniteNumber(accountMetrics.failureCount) > 0 ? "degraded" : "unknown",
    tradingFreshObserved && !streams.tradingFresh ? "degraded" : "unknown",
  );
  const diagnosticsCollectorStatus = latestRecord.timestamp
    ? worstStatus(
        statusFromDiagnosticValue(latestRecord.status),
        statusFromSeverity(latestRecord.severity),
      )
    : "unknown";
  const serverPressureLevel = firstString(
    serverPressureRecord.pressureLevel,
    resourceMetrics.pressureLevel,
    resourceMetrics.level,
  );
  const apiHeapUsedPercent = firstFiniteNumber(
    memoryRecord.apiHeapUsedPercent,
    footerRecord.apiHeapUsedPercent,
    resourceMetrics.heapUsedPercent,
  );
  const apiPressureObserved =
    hasRecordKeys(serverPressureRecord) ||
    Boolean(resourcePressureSnapshot) ||
    apiHeapUsedPercent != null;
  // Dominant pressure drivers (diagnostics.ts resource-pressure dominantDrivers):
  // names exactly which subsystem is driving server pressure (DB pool, API latency,
  // event loop, workload…) so the API Pressure node attributes it instead of just
  // reading "high". The backend array is in a fixed structural order, NOT sorted by
  // severity, so keep the elevated ones and re-rank worst-first ourselves.
  const elevatedPressureDrivers = arrayOrEmpty(resourceMetrics.dominantDrivers)
    .map((driver) => safeRecord(driver))
    .filter((driver) => {
      const level = firstString(driver.level).toLowerCase();
      return level && level !== "normal" && level !== "low" && level !== "ok";
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[statusFromPressureLevel(b.level)] -
        STATUS_ORDER[statusFromPressureLevel(a.level)],
    );
  const pressureDrivers = elevatedPressureDrivers.map((driver) => {
    const name = firstString(driver.label, driver.kind);
    const detail = firstString(driver.detail);
    return detail ? `${name} (${detail})` : name;
  });
  // The worst-severity driver, shown inline on the card so the pressure source is
  // visible without hovering.
  const topPressureDriver = elevatedPressureDrivers.length
    ? firstString(
        elevatedPressureDrivers[0].label,
        elevatedPressureDrivers[0].kind,
      )
    : null;
  // Elevated drivers that map to a positioned card → the diagram marks those
  // cards as pressure sources and links them to API Pressure.
  const pressureSources = elevatedPressureDrivers
    .map((driver) => {
      const cardId = PRESSURE_DRIVER_CARD[firstString(driver.kind)];
      return cardId
        ? {
            cardId,
            label: firstString(driver.label, driver.kind),
            detail: firstString(driver.detail),
            level: firstString(driver.level),
          }
        : null;
    })
    .filter(Boolean);
  const browserMemoryMb = firstFiniteNumber(
    memoryRecord.browserMemoryMb,
    footerRecord.browserMemoryMb,
  );
  const browserMemoryLimitMb = firstFiniteNumber(
    memoryRecord.browserMemoryLimitMb,
    footerRecord.browserMemoryLimitMb,
  );
  const browserMemoryPercent =
    browserMemoryMb != null && browserMemoryLimitMb > 0
      ? (browserMemoryMb / browserMemoryLimitMb) * 100
      : null;
  const latestScanAgeMs = firstFiniteNumber(
    automationMetrics.latestScanAgeMs,
    automationMetrics.latest_scan_age_ms,
  );
  const lastScanDurationMs = firstFiniteNumber(automationMetrics.lastScanDurationMs);
  const failureCount = firstFiniteNumber(
    automationMetrics.failureCount,
    automationMetrics.failure_count,
  );
  const gatewayBlockedCount = firstFiniteNumber(
    automationMetrics.gatewayBlockedCount,
    automationMetrics.gateway_blocked_count,
  );
  const candidateCount = firstFiniteNumber(automationMetrics.candidateCount);
  const freshSignalCount = firstFiniteNumber(automationMetrics.freshSignalCount);
  const staleSignalCount = firstFiniteNumber(
    automationMetrics.staleSignalCount,
    automationMetrics.notFreshSignalCount,
  );
  const shadowExitCount = firstFiniteNumber(automationMetrics.shadowExitCount);
  const expirationDueCount = firstFiniteNumber(
    automationMetrics.expirationMaintenanceDueCount,
  );
  const automationObserved = Boolean(automationSnapshot);
  const orderFailureCount = firstFiniteNumber(orderMetrics.failureCount);

  const nodes = [
    makeNode({
      id: "ibkr-bridge",
      label: "Broker Feed",
      lane: "Data Sources",
      canonicalState: ibkrStatus === "down" || ibkrStatus === "degraded"
        ? "SourceUnavailable"
        : "SourceRead",
      status: ibkrStatus,
      detail: ibkrSnapshot
        ? diagnosticDetail(ibkrSnapshot, [
            ibkrMetrics.connected === false ? "disconnected" : null,
            `${formatMs(firstFiniteNumber(ibkrMetrics.heartbeatAgeMs))} heartbeat`,
          ])
        : "IBKR snapshot not observed",
      observedAt,
      evidence: ibkrSnapshot ? "observed" : "unknown",
    }),
    makeNode({
      id: "massive-feed",
      label: "Massive Feed",
      lane: "Data Sources",
      canonicalState: massiveStatus === "degraded" || massiveStatus === "down"
        ? "SourceUnavailable"
        : massiveStatus === "idle"
          ? "SourceIdle"
          : "SourceRead",
      status: massiveStatus,
      detail: massiveObserved
        ? metricDetail([
            massiveRecord.label ? `status=${massiveRecord.label}` : null,
            firstFiniteNumber(massiveWebSocket.lastMessageAgeMs) !== null
              ? `${formatMs(firstFiniteNumber(massiveWebSocket.lastMessageAgeMs))} last ws`
              : null,
            firstFiniteNumber(massiveWebSocket.activeConsumerCount) !== null
              ? `${formatCount(firstFiniteNumber(massiveWebSocket.activeConsumerCount))} consumers`
              : null,
            firstString(massiveRecord.lastError, massiveRest.lastError, massiveWebSocket.lastError),
          ])
        : "Massive provider detail not observed",
      observedAt,
      evidence: massiveObserved ? "observed" : "unknown",
      source: "runtime",
    }),
    makeNode({
      id: "bridge-governor",
      label: "Bridge Governor",
      lane: "Broker Feed (IBKR)",
      canonicalState:
        governorOpenLanes.length || lineStatus === "degraded" || lineStatus === "down"
          ? "AdmissionShed"
          : "RouteClassified",
      // One merged readout: the governor IS the broker-line distribution hub —
      // line pools and lane circuits are two fields of the same hub's health.
      status: worstStatus(
        lineStatus,
        governorLanes.length
          ? governorOpenLanes.length
            ? "degraded"
            : "healthy"
          : "unknown",
      ),
      detail:
        (lineUsageAvailable && Object.keys(lineUsage).length) || governorLanes.length
          ? metricDetail([
              lineUsageAvailable && Object.keys(lineUsage).length
                ? `${lineUsageDetail(lineTotal)} lines`
                : null,
              firstString(linePressure.state) ? `pressure=${linePressure.state}` : null,
              lineWarnings ? `${formatCount(lineWarnings)} warnings` : null,
              governorLanes.length
                ? governorOpenLanes.length
                  ? `circuit open: ${governorOpenLanes.join(", ")}`
                  : "circuits closed"
                : null,
            ])
          : "governor not observed",
      observedAt,
      evidence:
        (lineUsageAvailable && Object.keys(lineUsage).length) || governorLanes.length
          ? "observed"
          : "unknown",
      source: "runtime",
      metric:
        lineUsageAvailable && Object.keys(lineUsage).length
          ? `${formatCount(firstFiniteNumber(lineTotal.used, lineTotal.activeLineCount))}/${formatCount(firstFiniteNumber(lineTotal.cap, lineTotal.maxLines))}`
          : null,
    }),
    accountStreamNode,
    orderStreamNode,
    makeNode({
      id: "position-quotes",
      label: "Position Quotes",
      lane: "Account & Trading",
      canonicalState: positionQuoteStatus === "degraded" || positionQuoteStatus === "down"
        ? "SourceUnavailable"
        : "Normalized",
      status: positionQuoteStatus,
      detail: metricDetail([
        hasRecordKeys(accountMonitorUsage)
          ? `live ${lineUsageDetail(accountMonitorUsage)}`
          : null,
        hasRecordKeys(shadowAccountUsage)
          ? `shadow ${lineUsageDetail(shadowAccountUsage)}`
          : null,
        firstFiniteNumber(shadowAccountUsage.massiveFallbackLineCount) > 0
          ? `${formatCount(firstFiniteNumber(shadowAccountUsage.massiveFallbackLineCount))} Massive fallback`
          : null,
      ]),
      observedAt,
      evidence: positionQuoteObserved ? "observed" : "unknown",
      source: "runtime",
      split: {
        live: {
          label: "Live",
          status: liveQuoteStatus,
          detail: hasRecordKeys(accountMonitorUsage)
            ? lineUsageDetail(accountMonitorUsage)
            : "not observed",
        },
        shadow: {
          label: "Shadow",
          status: shadowQuoteStatus,
          detail: hasRecordKeys(shadowAccountUsage)
            ? lineUsageDetail(shadowAccountUsage)
            : "not observed",
        },
      },
    }),
    makeNode({
      id: "account-view",
      label: "Account View",
      lane: "Account & Trading",
      canonicalState: accountViewStatus === "degraded" || accountViewStatus === "down"
        ? "SourceUnavailable"
        : "Normalized",
      status: accountViewStatus,
      detail: metricDetail([
        accountSnapshot
          ? `${formatCount(firstFiniteNumber(accountMetrics.failureCount))} account failures`
          : null,
        orderSnapshot
          ? `${formatCount(orderFailureCount)} order failures`
          : null,
        tradingFreshObserved
          ? `trading=${streams.tradingFresh ? "fresh" : "stale"}`
          : null,
      ]),
      observedAt,
      evidence: accountSnapshot || orderSnapshot ? "observed" : "unknown",
    }),
    makeNode({
      id: "market-equities",
      label: "Equities Stream",
      lane: "Market / Trade",
      canonicalState: equitiesStatus === "degraded" || equitiesStatus === "down"
        ? "SourceUnavailable"
        : equitiesStatus === "idle"
          ? "SourceIdle"
          : "SourceRead",
      status: equitiesStatus,
      detail: equitiesObserved
        ? metricDetail([
            firstString(marketDataMetrics.massiveWebSocketStatus)
              ? `massive ws=${marketDataMetrics.massiveWebSocketStatus}`
              : null,
            massiveSocketAgeMs != null
              ? `${formatMs(massiveSocketAgeMs)} last socket`
              : null,
            firstFiniteNumber(marketDataMetrics.massiveSubscribedSymbolCount) != null
              ? `${formatCount(firstFiniteNumber(marketDataMetrics.massiveSubscribedSymbolCount))} symbols`
              : null,
          ])
        : "equities channel not observed",
      observedAt,
      evidence: equitiesObserved ? "observed" : "unknown",
    }),
    makeNode({
      id: "market-options",
      label: "Options Stream",
      lane: "Market / Trade",
      canonicalState: optionsStatus === "degraded" || optionsStatus === "down"
        ? "SourceUnavailable"
        : optionsStatus === "idle"
          ? "SourceIdle"
          : "SourceRead",
      status: optionsStatus,
      detail: marketDataSnapshot
        ? metricDetail([
            `${formatMs(firstFiniteNumber(marketDataMetrics.freshnessAgeMs))} freshness`,
            bridgeGapMs != null ? `${formatMs(bridgeGapMs)} gap` : null,
            firstFiniteNumber(marketDataMetrics.cachedQuoteCount) != null
              ? `${formatCount(firstFiniteNumber(marketDataMetrics.cachedQuoteCount))} cached quotes`
              : null,
            `${formatCount(firstFiniteNumber(marketDataMetrics.activeConsumerCount))} consumers`,
          ])
        : "market-data snapshot not observed",
      observedAt,
      evidence: marketDataSnapshot ? "observed" : "unknown",
    }),
    makeNode({
      id: "trade-chain",
      label: "Trade Chain",
      lane: "Market / Trade",
      canonicalState:
        statusFromLineUsage(tradeChainUsage) === "degraded" ? "AdmissionShed" : "SourceRead",
      status: statusFromLineUsage(tradeChainUsage),
      detail: hasRecordKeys(tradeChainUsage)
        ? `${lineUsageDetail(tradeChainUsage)} chain lines`
        : "trade chain pool not observed",
      observedAt,
      evidence: hasRecordKeys(tradeChainUsage) ? "observed" : "unknown",
      source: "runtime",
    }),
    makeNode({
      id: "flow-scanner",
      label: "Flow Scanner",
      lane: "Flow",
      canonicalState: flowScannerStatus === "degraded" || flowScannerStatus === "down"
        ? "AdmissionShed"
        : flowScannerStatus === "idle"
          ? "SourceIdle"
          : "SourceRead",
      status: flowScannerStatus,
      detail: metricDetail([
        sessionQuiet ? "market session quiet" : null,
        flowScanner.enabled ? "enabled" : flowScanner.active ? "active" : null,
        sessionQuiet
          ? null
          : flowScanner.active
            ? "running"
            : flowScanner.enabled
              ? "waiting"
              : null,
        hasRecordKeys(flowScannerUsage)
          ? `${lineUsageDetail(flowScannerUsage)} scanner lines`
          : null,
      ]),
      observedAt,
      evidence: Object.keys(flowScanner).length || Object.keys(flowScannerUsage).length
        ? "observed"
        : "unknown",
      source: "runtime",
    }),
    makeNode({
      id: "gex-projection",
      label: "GEX Projection",
      lane: "GEX",
      canonicalState: gexStatus === "degraded" ? "SourceUnavailable" : "ClientConsumed",
      // On-demand feature: zero queries this session is honest quiet (idle),
      // not an unknown sensor. Sensor = client-side React Query cache state.
      status: gexStatus,
      detail: gexObserved
        ? metricDetail([
            `${formatCount(gexQueryCount)} queries`,
            gexRecord.hasError ? "last fetch errored" : null,
            gexRecord.isFetching ? "fetching" : null,
            gexUpdatedAgeMs != null
              ? `data ${formatDuration(gexUpdatedAgeMs)} old`
              : null,
          ])
        : gexCacheObserved
          ? "no gex requests this session"
          : "gex cache not observed",
      observedAt,
      evidence: gexCacheObserved ? "observed" : "unknown",
      source: "client",
    }),
    makeNode({
      id: "signal-engine",
      label: "Signals",
      lane: "Signals",
      canonicalState: staleSignalCount > 0 ? "SourceUnavailable" : "Normalized",
      status: automationObserved
        ? staleSignalCount > 0
          ? "checking"
          : freshSignalCount != null || latestScanAgeMs != null
            ? "healthy"
            : "unknown"
        : "unknown",
      detail: automationObserved
        ? metricDetail([
            freshSignalCount !== null
              ? `${formatCount(freshSignalCount)} fresh signals`
              : null,
            staleSignalCount > 0
              ? `${formatCount(staleSignalCount)} stale/not fresh`
              : null,
            latestScanAgeMs !== null ? `${formatMs(latestScanAgeMs)} scan age` : null,
          ])
        : "signal-options automation snapshot not observed",
      observedAt,
      evidence: automationObserved ? "observed" : "unknown",
    }),
    makeNode({
      id: "algo-engine",
      label: "Algo Engine",
      lane: "Signals",
      canonicalState:
        gatewayBlockedCount > 0 || failureCount > 0
          ? "AdmissionShed"
          : "ServiceSelected",
      status: automationObserved
        ? worstStatus(
            statusFromSnapshot(automationSnapshot),
            statusFromLineUsage(automationUsage),
            failureCount > 0 || gatewayBlockedCount > 0 ? "degraded" : "unknown",
          )
        : "unknown",
      detail: automationObserved
        ? metricDetail([
            candidateCount !== null ? `${formatCount(candidateCount)} candidates` : null,
            lastScanDurationMs !== null ? `${formatMs(lastScanDurationMs)} scan` : null,
            gatewayBlockedCount > 0
              ? `${formatCount(gatewayBlockedCount)} gateway blocked`
              : null,
            failureCount > 0 ? `${formatCount(failureCount)} failures` : null,
            hasRecordKeys(automationUsage)
              ? `${lineUsageDetail(automationUsage)} algo lines`
              : null,
          ])
        : "algo orchestration snapshot not observed",
      observedAt,
      evidence: automationObserved ? "observed" : "unknown",
    }),
    makeNode({
      id: "trade-management",
      label: "Trade Mgmt",
      lane: "Account & Trading",
      canonicalState:
        orderFailureCount > 0 ? "SourceUnavailable" : "ContractEmitted",
      status: automationObserved
        ? worstStatus(
            orderFailureCount > 0 ? "degraded" : "unknown",
            expirationDueCount > 0 ? "checking" : "unknown",
            "healthy",
          )
        : "unknown",
      detail: automationObserved
        ? metricDetail([
            shadowExitCount !== null ? `${formatCount(shadowExitCount)} shadow exits` : null,
            expirationDueCount > 0
              ? `${formatCount(expirationDueCount)} expiration due`
              : null,
            orderSnapshot
              ? `${formatCount(orderFailureCount)} order failures`
              : null,
          ])
        : "trade-management snapshot not observed",
      observedAt,
      evidence: automationObserved ? "observed" : "unknown",
    }),
    admissionNode({ latest: latestRecord, memoryPressureState, footerSignal, observedAt }),
    makeNode({
      id: "api-runtime",
      label: "API Link",
      lane: "Client",
      canonicalState: "BoundaryReceived",
      status: statusFromSnapshot(apiSnapshot),
      detail: apiSnapshot
        ? diagnosticDetail(apiSnapshot, [
            `${formatMs(firstFiniteNumber(apiMetrics.p95LatencyMs))} p95`,
            `${formatCount(firstFiniteNumber(apiMetrics.requestCount5m))} req/5m`,
          ])
        : "API subsystem not observed",
      observedAt,
      evidence: apiSnapshot ? "observed" : "unknown",
    }),
    makeNode({
      id: "api-pressure",
      label: "API Pressure",
      lane: "Diagnostics",
      canonicalState:
        statusFromPressureLevel(serverPressureLevel) === "degraded" ||
        statusFromPressureLevel(serverPressureLevel) === "down"
          ? "AdmissionShed"
          : "DiagnosticSampled",
      status: apiPressureObserved
        ? worstStatus(
            statusFromPressureLevel(serverPressureLevel),
            apiHeapUsedPercent != null && apiHeapUsedPercent >= BROWSER_MEMORY_HIGH_PERCENT
              ? "degraded"
              : "unknown",
          )
        : "unknown",
      detail: apiPressureObserved
        ? metricDetail([
            `level=${serverPressureLevel || MISSING_VALUE}`,
            pressureDrivers.length ? `from ${pressureDrivers.join(", ")}` : null,
            apiHeapUsedPercent != null
              ? `heap ${Math.round(apiHeapUsedPercent)}%`
              : null,
          ])
        : "server pressure not observed",
      observedAt,
      evidence: apiPressureObserved ? "observed" : "unknown",
      metric: topPressureDriver,
    }),
    makeNode({
      id: "diagnostics-collector",
      label: "Collector",
      lane: "Diagnostics",
      canonicalState: "DiagnosticSampled",
      status: diagnosticsCollectorStatus,
      detail: latestRecord.timestamp
        ? `${formatCount(latestSnapshots.length)} snapshots / ${formatCount(latestEvents.length)} events`
        : "latest diagnostics payload not observed",
      observedAt,
      evidence: latestRecord.timestamp || latestSnapshots.length ? "observed" : "unknown",
    }),
    makeNode({
      id: "diagnostics-stream",
      label: "Diagnostics SSE",
      lane: "Diagnostics",
      canonicalState: "ContractEmitted",
      status: streamStatus,
      detail:
        streamStatus === "unknown"
          ? "EventSource state not observed"
          : `EventSource ${streamState} / snapshot ${formatAge(latestRecord.timestamp, nowMs)}`,
      observedAt,
      evidence: streamStatus === "unknown" ? "unknown" : "observed",
      source: "client",
    }),
    incidentNode({ latest: latestRecord, observedAt }),
    makeNode({
      id: "client-transport",
      label: "Transport",
      lane: "Client",
      canonicalState: "ClientConsumed",
      status: streamStatus,
      detail:
        streamStatus === "unknown"
          ? "transport state not observed"
          : `EventSource ${streamState}`,
      observedAt,
      evidence: streamStatus === "unknown" ? "unknown" : "observed",
      source: "client",
    }),
    makeNode({
      id: "browser-events",
      label: "Browser Events",
      lane: "Client",
      canonicalState: "DiagnosticSampled",
      status: statusFromSnapshot(browserSnapshot),
      detail: browserSnapshot
        ? metricDetail([
            `${formatCount(firstFiniteNumber(browserMetrics.eventCount5m))} events/5m`,
            `${formatCount(firstFiniteNumber(browserMetrics.warningCount5m))} warnings`,
          ])
        : "browser snapshot not observed",
      observedAt,
      evidence: browserSnapshot ? "observed" : "unknown",
    }),
    makeNode({
      id: "browser-memory",
      label: "Browser Memory",
      lane: "Client",
      canonicalState:
        browserMemoryPercent != null && browserMemoryPercent >= BROWSER_MEMORY_HIGH_PERCENT
          ? "AdmissionShed"
          : "DiagnosticSampled",
      status:
        browserMemoryPercent == null
          ? "unknown"
          : browserMemoryPercent >= BROWSER_MEMORY_HIGH_PERCENT
            ? "degraded"
            : browserMemoryPercent >= BROWSER_MEMORY_WATCH_PERCENT
              ? "checking"
              : "healthy",
      detail:
        browserMemoryMb != null
          ? metricDetail([
              `${formatCount(browserMemoryMb)}mb${
                browserMemoryLimitMb ? ` of ${formatCount(browserMemoryLimitMb)}mb` : ""
              }`,
              browserMemoryPercent != null
                ? `${Math.round(browserMemoryPercent)}%`
                : null,
            ])
          : "browser memory not observed",
      observedAt,
      evidence: browserMemoryMb != null ? "observed" : "unknown",
      source: "client",
    }),
    makeNode({
      id: "database-health",
      label: "Connectivity",
      lane: "Persistence",
      canonicalState:
        dbHealthStatus === "down" ? "StorageUnreachable" : "StorageReachable",
      status: dbHealthStatus,
      detail: storageObserved
        ? metricDetail([
            dbReachable ? "reachable" : "unreachable",
            dbPingMs != null ? `${formatMs(dbPingMs)} ping` : null,
            `read/write ${dbReadWriteVerified ? "ok" : "no"}`,
          ])
        : "storage snapshot not observed",
      observedAt,
      evidence: storageObserved ? "observed" : "unknown",
    }),
    makeNode({
      id: "database-pool",
      label: "Connection Pool",
      lane: "Persistence",
      canonicalState: dbPoolStatus === "degraded" ? "PoolSaturated" : "PoolReady",
      status: dbPoolStatus,
      detail: poolObserved
        ? metricDetail([
            `${formatCount(dbPoolActive)}/${formatCount(dbPoolMax)} active`,
            `${formatCount(dbPoolWaiting)} waiting`,
            dbPoolIdle != null ? `${formatCount(dbPoolIdle)} idle` : null,
          ])
        : "pool stats not observed",
      observedAt,
      evidence: poolObserved ? "observed" : "unknown",
      metric: poolObserved
        ? `${formatCount(dbPoolActive)}/${formatCount(dbPoolMax)}`
        : null,
    }),
    makeNode({
      id: "database-storage",
      label: "Storage",
      lane: "Persistence",
      canonicalState:
        dbStorageStatus === "degraded" ? "StoragePressure" : "StorageSteady",
      status: dbStorageStatus,
      detail:
        dbSizeMb != null
          ? metricDetail([
              `${formatCount(dbSizeMb)}mb`,
              dbWarnMb != null ? `of ${formatCount(dbWarnMb)}mb warn` : null,
              dbPressureLevel ? `pressure ${dbPressureLevel}` : null,
            ])
          : "database size not observed",
      observedAt,
      evidence: storageObserved && dbSizeMb != null ? "observed" : "unknown",
      metric: dbSizeMb != null ? `${formatCount(dbSizeMb)}mb` : null,
    }),
    makeNode({
      id: "database-tables",
      label: "Data Freshness",
      lane: "Persistence",
      canonicalState: "SourceRead",
      status: dbTablesStatus,
      detail: dbMonitoredTables.length
        ? metricDetail([
            `${formatCount(dbMonitoredTables.length)} tables`,
            dbNewestTableMs != null
              ? `newest ${formatAge(dbNewestTableMs, nowMs)}`
              : null,
          ])
        : "table stats not observed",
      observedAt,
      evidence: dbMonitoredTables.length ? "observed" : "unknown",
      metric: dbMonitoredTables.length
        ? `${formatCount(dbMonitoredTables.length)} tbl`
        : null,
    }),
  ];

  const decayedNodes = applySnapshotDecay(nodes, snapshotAgeMs);
  const nodesById = new Map(decayedNodes.map((node) => [node.id, node]));
  const edges = [
    { from: "ibkr-bridge", to: "bridge-governor", label: "broker lines" },
    { from: "ibkr-bridge", to: "account-stream", label: "broker REST/SSE" },
    { from: "ibkr-bridge", to: "order-stream", label: "broker SSE" },
    { from: "ibkr-bridge", to: "market-equities", label: "IBKR quotes" },
    { from: "ibkr-bridge", to: "market-options", label: "chains/quotes" },
    { from: "ibkr-bridge", to: "flow-scanner", label: "chains/quotes" },
    { from: "ibkr-bridge", to: "gex-projection", label: "option chains" },
    { from: "massive-feed", to: "market-equities", label: "Massive WS" },
    { from: "massive-feed", to: "flow-scanner", label: "spot fallback" },
    { from: "massive-feed", to: "position-quotes", label: "equity quote fallback" },
    { from: "bridge-governor", to: "trade-chain", label: "chain line budget" },
    { from: "bridge-governor", to: "flow-scanner", label: "line budget" },
    { from: "bridge-governor", to: "algo-engine", label: "algo budget" },
    { from: "bridge-governor", to: "position-quotes", label: "quote lines" },
    { from: "bridge-governor", to: "route-admission", label: "pressure/backoff" },
    { from: "market-equities", to: "position-quotes", label: "stock marks" },
    { from: "market-options", to: "position-quotes", label: "option marks" },
    { from: "market-equities", to: "signal-engine", label: "bars/quotes" },
    { from: "flow-scanner", to: "signal-engine", label: "flow events" },
    { from: "signal-engine", to: "algo-engine", label: "worker state" },
    { from: "account-view", to: "algo-engine", label: "risk/capital" },
    { from: "algo-engine", to: "trade-management", label: "decisions" },
    { from: "account-stream", to: "account-view", label: "account state" },
    { from: "order-stream", to: "account-view", label: "orders/fills" },
    { from: "position-quotes", to: "account-view", label: "quote marks" },
    { from: "order-stream", to: "trade-management", label: "fills/status" },
    { from: "account-view", to: "trade-management", label: "positions/risk" },
    { from: "market-equities", to: "api-runtime", label: "market model" },
    { from: "market-options", to: "api-runtime", label: "options model" },
    { from: "trade-chain", to: "api-runtime", label: "chain snapshots" },
    { from: "flow-scanner", to: "api-runtime", label: "flow model" },
    { from: "gex-projection", to: "api-runtime", label: "gex model" },
    { from: "signal-engine", to: "api-runtime", label: "signal model" },
    { from: "account-view", to: "api-runtime", label: "account model" },
    { from: "trade-management", to: "api-runtime", label: "trade state" },
    { from: "route-admission", to: "api-runtime", label: "route gate" },
    { from: "api-pressure", to: "route-admission", label: "pressure/timeout" },
    { from: "api-runtime", to: "client-transport", label: "REST/SSE" },
    { from: "api-runtime", to: "diagnostics-collector", label: "request metrics" },
    { from: "api-pressure", to: "diagnostics-collector", label: "pressure sample" },
    { from: "trade-management", to: "diagnostics-collector", label: "events/probes" },
    { from: "diagnostics-collector", to: "diagnostics-stream", label: "SSE snapshot" },
    { from: "diagnostics-collector", to: "diagnostics-incidents", label: "thresholds" },
    { from: "diagnostics-stream", to: "client-transport", label: "EventSource" },
    { from: "browser-events", to: "diagnostics-collector", label: "client events" },
  ].map((edge) => makeEdge(nodesById, edge));
  const model = {
    observedAt,
    snapshotAgeMs,
    summary: summaryFromNodes(decayedNodes, snapshotAgeMs),
    nodes: decayedNodes,
    edges,
    databaseRowCounts,
    pressureSources,
  };
  return { ...model, groups: buildMachineStateDiagramGroups(model) };
};
