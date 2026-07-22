import {
  buildFailurePointFromDiagnosticsSnapshot,
  redactDiagnosticText,
} from "../../features/platform/failurePointModel.js";

const STATUS_RANK = Object.freeze({
  ok: 0,
  unknown: 1,
  degraded: 2,
  down: 3,
});

const WARNING_RANK = 2;

const TARGET_TAB = Object.freeze({
  api: "API",
  ibkr: "Broker",
  "market-data": "Market Data",
  "chart-hydration": "Market Data",
  browser: "Browser",
  "resource-pressure": "Memory",
  runtime: "API",
  isolation: "Browser",
  accounts: "Orders/Accounts",
  orders: "Orders/Accounts",
  automation: "Events",
  storage: "Storage",
});

const IMPACT = Object.freeze({
  api: "Screen requests may slow or fail.",
  ibkr: "Broker, account, and trading context may be unavailable.",
  "market-data": "Prices and market flow may be stale or incomplete.",
  "chart-hydration": "Chart history may be incomplete.",
  browser: "Client-side workspace behavior may be degraded.",
  "resource-pressure": "Workspace latency and background work may degrade.",
  runtime: "App process continuity may be at risk.",
  isolation: "Browser memory evidence may be less reliable.",
  accounts: "Position and exposure context may be incomplete.",
  orders: "Working and historical order visibility may be incomplete.",
  automation: "Signal Options decisions or execution may pause.",
  storage: "Persisted history and diagnostic evidence may be unavailable.",
});

const SAFE_ACTION = Object.freeze({
  ibkr:
    "Check Client Portal readiness, stream freshness, and lane pressure before changing trading state.",
});

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const cleanText = (value) => {
  const text = redactDiagnosticText(String(value ?? "").trim());
  return text || null;
};

const snapshotRank = (snapshot) => {
  const record = asRecord(snapshot);
  const statusRank = STATUS_RANK[String(record.status || "unknown").toLowerCase()] ?? 1;
  const severityRank = String(record.severity || "").toLowerCase() === "warning"
    ? WARNING_RANK
    : 0;
  return Math.max(statusRank, severityRank);
};

const primarySnapshot = (snapshots) =>
  snapshots.reduce((current, snapshot) => {
    if (!current || snapshotRank(snapshot) > snapshotRank(current)) return snapshot;
    return current;
  }, null);

const conciseEvidence = (snapshot, point) => {
  const metrics = asRecord(snapshot.metrics);
  if (snapshot.subsystem === "ibkr" && metrics.connected === false) {
    return "Client Portal disconnected";
  }
  if (point.topCauses[0]) return point.topCauses[0];
  if (point.metrics[0]) return `${point.metrics[0][0]}: ${point.metrics[0][1]}`;
  return point.reason || point.summary;
};

export const buildDiagnosticsRecoveryModel = (latest) => {
  const payload = asRecord(latest);
  const snapshots = Array.isArray(payload.snapshots)
    ? payload.snapshots.map(asRecord)
    : [];

  if (snapshots.length === 0) {
    return {
      state: "waiting",
      severity: "info",
      subsystem: null,
      currentFailure: "Waiting for diagnostics",
      summary:
        cleanText(payload.summary) ||
        "Diagnostics collector has not published a snapshot yet.",
      impact: "Operational impact is unknown until subsystem evidence arrives.",
      evidence: "No subsystem snapshots received",
      observedAt: cleanText(payload.timestamp),
      nextAction: "Keep Diagnostics open while the collector publishes its first snapshot.",
      targetTab: null,
    };
  }

  const activeSnapshots = snapshots.filter((snapshot) => snapshotRank(snapshot) > 0);
  if (activeSnapshots.length === 0) {
    return {
      state: "healthy",
      severity: "info",
      subsystem: null,
      currentFailure: "No active failure",
      summary: cleanText(payload.summary) || "Diagnostics are healthy",
      impact: "No current operational impact detected.",
      evidence: `${snapshots.length} subsystem check${snapshots.length === 1 ? "" : "s"} reporting OK`,
      observedAt: cleanText(payload.timestamp),
      nextAction: "No action required. Continue monitoring.",
      targetTab: null,
    };
  }

  const snapshot = primarySnapshot(activeSnapshots);
  const point = buildFailurePointFromDiagnosticsSnapshot(snapshot);
  const subsystem = cleanText(snapshot.subsystem) || "diagnostics";
  const recommendedAction = cleanText(asRecord(snapshot.metrics).recommendedAction);

  return {
    state: "failure",
    severity: point.severity,
    subsystem,
    currentFailure: point.title,
    summary: point.summary,
    impact: IMPACT[subsystem] || "Related workspace behavior may be degraded.",
    evidence: conciseEvidence(snapshot, point),
    observedAt: point.observedAt,
    nextAction: recommendedAction || SAFE_ACTION[subsystem] || point.nextAction,
    targetTab: TARGET_TAB[subsystem] || "Events",
  };
};
