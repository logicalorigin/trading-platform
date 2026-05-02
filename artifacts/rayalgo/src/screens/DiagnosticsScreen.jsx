import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getBrokerStockAggregateDebugStats,
  sanitizeChartHydrationStatsForDiagnostics,
  useChartHydrationStats,
  useIbkrLatencyStats,
} from "../features/charting";
import {
  clearOptionHydrationDiagnosticsHistory,
  useOptionHydrationDiagnostics,
} from "../features/platform/optionHydrationDiagnostics";
import {
  maskIbkrAccountId,
  resolveIbkrGatewayHealth,
} from "../features/platform/IbkrConnectionStatus";
import { useRuntimeWorkloadStats } from "../features/platform/workloadStats";
import { useHydrationCoordinatorStats } from "../features/platform/hydrationCoordinator";
import {
  dismissAllLocalAlertPreferences,
  dismissLocalAlertPreference,
  isLocalAlertDismissed,
  readLocalAlertPreferences,
  reduceDiagnosticAlerts,
  restoreLocalAlertPreferences,
  sortLocalAlerts,
  syncDiagnosticSnapshotAlerts,
  writeLocalAlertPreferences,
} from "./diagnostics/localAlerts";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../lib/uiTokens";
import { formatAppDateTime } from "../lib/timeZone";
import {
  joinMotionClasses,
  motionRowStyle,
  motionVars,
} from "../lib/motion";
import { useUserPreferences } from "../features/preferences/useUserPreferences";
import { DiagnosticThresholdSettingsPanel } from "./settings/DiagnosticThresholdSettingsPanel";

const DIAGNOSTIC_ALERT_PREF_EVENT = "rayalgo:diagnostic-alert-preferences-updated";

const TABS = [
  "Overview",
  "IBKR",
  "Market Data",
  "API",
  "Browser",
  "Memory",
  "Orders/Accounts",
  "Storage",
  "Events",
];

const WINDOW_OPTIONS = [
  { label: "1H", minutes: 60 },
  { label: "6H", minutes: 360 },
  { label: "24H", minutes: 1440 },
  { label: "7D", minutes: 10080 },
];

const AUDIO_SNOOZE_OPTIONS = [
  { label: "15m", ms: 15 * 60_000 },
  { label: "1h", ms: 60 * 60_000 },
  { label: "Reload", ms: Number.POSITIVE_INFINITY },
];

const parseClockMinutes = (value, fallback) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return hours * 60 + minutes;
};

const quietHoursActive = (preferences, now = new Date()) => {
  if (!preferences?.quietHoursEnabled) return false;
  const start = parseClockMinutes(preferences.quietHoursStart, 20 * 60);
  const end = parseClockMinutes(preferences.quietHoursEnd, 6 * 60);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
};

const requestDesktopAlert = (notification, preferences) => {
  if (
    !notification ||
    !preferences ||
    preferences.desktopNotifications === "off" ||
    quietHoursActive(preferences) ||
    typeof Notification === "undefined"
  ) {
    return;
  }
  if (Notification.permission === "granted") {
    new Notification("RayAlgo diagnostics", {
      body: notification.message || notification.severity || "Diagnostic alert",
      tag: notification.key,
    });
    return;
  }
  if (
    preferences.desktopNotifications === "ask" &&
    Notification.permission === "default"
  ) {
    void Notification.requestPermission();
  }
};

const formatMs = (value) =>
  Number.isFinite(value) ? `${Math.round(value).toLocaleString()}ms` : MISSING_VALUE;

const formatCount = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString() : MISSING_VALUE;

const formatMb = (value) =>
  Number.isFinite(value) ? `${Math.round(value).toLocaleString()} MB` : MISSING_VALUE;

const formatPercent = (value) =>
  Number.isFinite(value) ? `${Math.round(value)}%` : MISSING_VALUE;

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

const formatAgo = (value) => {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp)
    ? `${formatDuration(Date.now() - timestamp)} ago`
    : MISSING_VALUE;
};

const severityTone = (severity) => {
  if (severity === "critical") return T.red;
  if (severity === "warning") return T.amber;
  return T.green;
};

const statusLabel = (value) =>
  value === "down"
    ? "DOWN"
    : value === "degraded"
      ? "DEGRADED"
      : value === "ok"
        ? "OK"
        : "UNKNOWN";

const safeRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeMetricKey = (key) => key.split(".").at(-1) || key;

function readMetric(snapshot, key) {
  const metrics = safeRecord(snapshot?.metrics);
  const direct = metrics[key];
  const local = metrics[normalizeMetricKey(key)];
  const value = typeof direct === "number" ? direct : local;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function snapshotBySubsystem(latest, subsystem) {
  return latest?.snapshots?.find((snapshot) => snapshot.subsystem === subsystem) || null;
}

function postClientEvent(input) {
  fetch("/api/diagnostics/client-events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  }).catch(() => {});
}

function postClientMetrics(input) {
  fetch("/api/diagnostics/client-metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  }).catch(() => {});
}

async function collectBrowserResourceMetrics({
  workloadStats,
  hydrationCoordinatorStats,
  chartStats,
  optionState,
}) {
  const isolation = {
    crossOriginIsolated: Boolean(window.crossOriginIsolated),
    memoryApiAvailable:
      typeof performance.measureUserAgentSpecificMemory === "function",
    memoryApiUsed: false,
    userAgent: navigator.userAgent,
  };
  let memory = { source: "heuristic", confidence: "low" };
  try {
    if (
      window.crossOriginIsolated &&
      typeof performance.measureUserAgentSpecificMemory === "function"
    ) {
      const measured = await performance.measureUserAgentSpecificMemory();
      memory = {
        source: "measureUserAgentSpecificMemory",
        confidence: "high",
        bytes: measured?.bytes ?? null,
        breakdownCount: Array.isArray(measured?.breakdown)
          ? measured.breakdown.length
          : 0,
      };
      isolation.memoryApiUsed = true;
    } else if (performance.memory) {
      memory = {
        source: "performance.memory",
        confidence: "medium",
        usedJsHeapSize: performance.memory.usedJSHeapSize ?? null,
        totalJsHeapSize: performance.memory.totalJSHeapSize ?? null,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit ?? null,
      };
    }
  } catch (error) {
    memory = {
      ...memory,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const storageEstimate =
    navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const cacheNames = window.caches?.keys ? await window.caches.keys().catch(() => []) : [];
  return {
    chartHydration: sanitizeChartHydrationStatsForDiagnostics(chartStats),
    memory,
    isolation,
    workload: {
      workloadStats,
      aggregateStream: getBrokerStockAggregateDebugStats(),
      hydrationCoordinatorStats,
      chartScopeCount: chartStats.activeScopeCount ?? chartStats.scopes.length,
      optionSession: {
        ticker: optionState.ticker,
        expiration: optionState.expiration,
        wsState: optionState.wsState,
        degraded: optionState.degraded,
      },
    },
    storage: {
      estimate: storageEstimate,
      localStorageKeys: window.localStorage?.length ?? null,
      sessionStorageKeys: window.sessionStorage?.length ?? null,
    },
    caches: {
      cacheStorageNames: cacheNames,
      cacheStorageCount: cacheNames.length,
    },
  };
}

const JsonBlock = ({ value }) => (
  <pre
    style={{
      margin: 0,
      maxHeight: dim(300),
      overflow: "auto",
      fontFamily: T.mono,
      fontSize: fs(9),
      color: T.textSec,
      whiteSpace: "pre-wrap",
      lineHeight: 1.45,
    }}
  >
    {JSON.stringify(value || {}, null, 2)}
  </pre>
);

const Panel = ({ title, action, children }) => (
  <section
    className="ra-panel-enter"
    style={{
        border: `1px solid ${T.border}`,
        background: T.bg1,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        minWidth: 0,
        alignSelf: "start",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(10),
        marginBottom: sp(10),
      }}
    >
      <div style={{ fontSize: fs(12), fontWeight: 800 }}>{title}</div>
      {action}
    </div>
    {children}
  </section>
);

const StateRow = ({ label, value, tone = T.textSec, onClick }) => (
  <button
    type="button"
    className={onClick ? "ra-interactive" : undefined}
    onClick={onClick}
    disabled={!onClick}
    style={{
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(10),
      border: 0,
      borderBottom: `1px solid ${T.border}55`,
      background: "transparent",
      padding: sp("7px 0"),
      fontFamily: T.mono,
      fontSize: fs(10),
      cursor: onClick ? "pointer" : "default",
      textAlign: "left",
    }}
  >
    <span style={{ color: T.textDim, minWidth: 0 }}>{label}</span>
    <span
      style={{
        color: tone,
        fontWeight: 800,
        textAlign: "right",
        minWidth: 0,
        overflowWrap: "anywhere",
        whiteSpace: "normal",
      }}
    >
      {value ?? MISSING_VALUE}
    </span>
  </button>
);

const MetricCard = ({ label, value, sub, severity = "info", onClick }) => (
  <button
    type="button"
    className={onClick ? "ra-interactive" : undefined}
    onClick={onClick}
    style={{
      ...motionVars({ accent: severityTone(severity) }),
      border: `1px solid ${severityTone(severity)}66`,
      borderRadius: dim(6),
      background: T.bg2,
      padding: sp("7px 8px"),
      display: "flex",
      flexDirection: "column",
      gap: sp(4),
      minWidth: 0,
      alignSelf: "start",
      cursor: onClick ? "pointer" : "default",
      textAlign: "left",
    }}
  >
    <span style={{ color: T.textDim, fontSize: fs(9), fontFamily: T.mono }}>
      {label}
    </span>
    <span style={{ color: severityTone(severity), fontSize: fs(17), fontWeight: 900 }}>
      {value ?? MISSING_VALUE}
    </span>
    <span style={{ color: T.textSec, fontSize: fs(9), fontFamily: T.mono }}>
      {sub || MISSING_VALUE}
    </span>
  </button>
);

const Sparkline = ({ points, metricKey, subsystem }) => {
  const data = points
    .filter((point) => point.subsystem === subsystem)
    .map((point) => ({
      at: Date.parse(point.at),
      value: readMetric({ metrics: point.metrics }, metricKey),
      severity: point.severity,
    }))
    .filter((point) => Number.isFinite(point.value));
  if (!data.length) {
    return (
      <div style={{ color: T.textDim, fontSize: fs(10), fontFamily: T.mono }}>
        No samples in selected window.
      </div>
    );
  }
  const values = data.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 320;
  const height = 78;
  const path = data
    .map((point, index) => {
      const x = data.length === 1 ? width : (index / (data.length - 1)) * width;
      const y = height - ((point.value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const tone = data.some((point) => point.severity === "critical")
    ? T.red
    : data.some((point) => point.severity === "warning")
      ? T.amber
      : T.green;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="ra-sparkline"
      style={{ width: "100%", height, "--ra-spark-length": "360" }}
    >
      <polyline
        points={path}
        fill="none"
        stroke={tone}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

const EventList = ({ events, onSelect }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: sp(8) }}>
    {events.length ? (
      events.map((event, index) => (
        <button
          key={event.id || event.incidentKey}
          type="button"
          className={joinMotionClasses("ra-row-enter", "ra-interactive")}
          onClick={() => onSelect(event)}
          style={{
            ...motionRowStyle(index, 16, 160),
            ...motionVars({ accent: severityTone(event.severity) }),
            border: `1px solid ${severityTone(event.severity)}66`,
            background: T.bg2,
            borderRadius: dim(5),
            padding: sp(9),
            display: "grid",
            gridTemplateColumns: "96px minmax(0, 1fr) 72px",
            gap: sp(8),
            alignItems: "start",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <span style={{ color: severityTone(event.severity), fontFamily: T.mono, fontSize: fs(9), fontWeight: 900 }}>
            {event.severity.toUpperCase()}
          </span>
          <span style={{ minWidth: 0 }}>
            <div style={{ color: T.text, fontSize: fs(11), fontWeight: 800, whiteSpace: "normal", overflowWrap: "anywhere" }}>
              {event.message}
            </div>
            <div style={{ color: T.textDim, fontSize: fs(9), fontFamily: T.mono }}>
              {event.subsystem} / {event.category} / {event.code || "no-code"}
            </div>
          </span>
          <span style={{ color: T.textSec, fontFamily: T.mono, fontSize: fs(9), textAlign: "right" }}>
            x{event.eventCount}
          </span>
        </button>
      ))
    ) : (
      <div style={{ color: T.textDim, fontSize: fs(10), fontFamily: T.mono }}>
        No diagnostic events in this window.
      </div>
    )}
  </div>
);

const LocalAlertRow = ({ alert, onSelect, onDismiss }) => (
  <div
    className={joinMotionClasses("ra-row-enter", "ra-focus-rail")}
    style={{
      ...motionVars({ accent: severityTone(alert.severity) }),
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      gap: sp(8),
      alignItems: "stretch",
      border: `1px solid ${severityTone(alert.severity)}66`,
      background: T.bg2,
      borderRadius: dim(5),
      padding: sp(8),
    }}
  >
    <button
      type="button"
      onClick={() => onSelect(alert)}
      style={{
        border: 0,
        background: "transparent",
        color: T.text,
        display: "grid",
        gridTemplateColumns: "88px minmax(0, 1fr) 64px",
        gap: sp(8),
        alignItems: "start",
        minWidth: 0,
        padding: 0,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ color: severityTone(alert.severity), fontFamily: T.mono, fontSize: fs(9), fontWeight: 900 }}>
        {alert.severity.toUpperCase()}
      </span>
      <span style={{ minWidth: 0 }}>
        <div style={{ color: T.text, fontSize: fs(11), fontWeight: 800, whiteSpace: "normal", overflowWrap: "anywhere" }}>
          {alert.message}
        </div>
        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {alert.subsystem || "diagnostics"} / {alert.category || alert.kind} / {alert.code || alert.incidentKey}
        </div>
      </span>
      <span style={{ color: T.textSec, fontFamily: T.mono, fontSize: fs(9), textAlign: "right" }}>
        x{alert.repeatCount}
      </span>
    </button>
    <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
      <span style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), whiteSpace: "nowrap" }}>
        {formatAgo(alert.lastSeenAt)}
      </span>
      <button type="button" onClick={() => onDismiss(alert)} style={smallButton()}>
        Dismiss
      </button>
    </div>
  </div>
);

function GatewayPanel({ latest, latencyStats, onMetric }) {
  const snapshot = snapshotBySubsystem(latest, "ibkr");
  const ibkr = safeRecord(snapshot?.raw);
  const metrics = safeRecord(snapshot?.metrics);
  const connection = ibkr
    ? {
        configured: ibkr.configured,
        reachable: ibkr.connected,
        authenticated: ibkr.authenticated,
        competing: ibkr.competing,
        selectedAccountId: ibkr.selectedAccountId,
        accounts: Number.isFinite(ibkr.accountCount)
          ? Array.from({ length: ibkr.accountCount })
          : [],
        target: ibkr.connectionTarget,
        mode: ibkr.sessionMode,
        clientId: ibkr.clientId,
        marketDataMode: ibkr.marketDataMode,
        liveMarketDataAvailable: ibkr.liveMarketDataAvailable,
        healthFresh: ibkr.healthFresh,
        healthAgeMs: ibkr.healthAgeMs,
        bridgeReachable: ibkr.bridgeReachable,
        socketConnected: ibkr.socketConnected,
        accountsLoaded: ibkr.accountsLoaded,
        configuredLiveMarketDataMode: ibkr.configuredLiveMarketDataMode,
        streamFresh: ibkr.streamFresh,
        lastStreamEventAgeMs: ibkr.lastStreamEventAgeMs,
        strictReady: ibkr.strictReady,
        strictReason: ibkr.strictReason,
        lastError: ibkr.lastError || ibkr.healthError,
      }
    : null;
  const health = ibkr
    ? resolveIbkrGatewayHealth({ connection, runtime: ibkr })
    : { label: "Waiting", color: T.textDim };

  return (
    <Panel
      title="IBKR / TWS"
      action={
        <span
          className={
            health.status && health.status !== "ready"
              ? "ra-status-pulse"
              : undefined
          }
          style={{
            border: `1px solid ${health.color}66`,
            background: T.bg2,
            color: health.color,
            fontFamily: T.mono,
            fontSize: fs(9),
            fontWeight: 900,
            padding: sp("3px 6px"),
          }}
        >
          {health.label}
        </span>
      }
    >
      <StateRow label="Bridge URL" value={ibkr.bridgeUrlConfigured ? "configured" : "missing"} tone={ibkr.bridgeUrlConfigured ? T.green : T.amber} />
      <StateRow label="Bridge token" value={ibkr.bridgeTokenConfigured ? "configured" : "missing"} tone={ibkr.bridgeTokenConfigured ? T.green : T.amber} />
      <StateRow label="Runtime override" value={ibkr.runtimeOverrideActive ? "active" : "env"} tone={ibkr.runtimeOverrideActive ? T.green : T.textSec} />
      <StateRow label="Legacy env" value={ibkr.legacyIbkrEnvPresent ? "present" : "clear"} tone={ibkr.legacyIbkrEnvPresent ? T.amber : T.green} />
      <StateRow label="Bridge HTTP" value={metrics.reachable ? "reachable" : "offline"} tone={metrics.reachable ? T.green : T.red} />
      <StateRow label="Health fresh" value={metrics.healthFresh == null ? MISSING_VALUE : metrics.healthFresh ? "yes" : "no"} tone={metrics.healthFresh ? T.green : metrics.healthFresh === false ? T.amber : T.textDim} />
      <StateRow label="Health age" value={formatMs(metrics.healthAgeMs)} tone={(metrics.healthAgeMs ?? 0) > 10_000 ? T.amber : T.textSec} />
      <StateRow label="Gateway socket" value={metrics.connected ? "connected" : "disconnected"} tone={metrics.connected ? T.green : T.red} />
      <StateRow label="Authenticated" value={metrics.authenticated ? "yes" : "no"} tone={metrics.authenticated ? T.green : T.red} />
      <StateRow label="Competing client" value={metrics.competing ? "yes" : "no"} tone={metrics.competing ? T.red : T.green} />
      <StateRow label="Target" value={ibkr.connectionTarget} />
      <StateRow label="Client ID" value={ibkr.clientId} />
      <StateRow label="Heartbeat age" value={formatMs(metrics.heartbeatAgeMs)} tone={(metrics.heartbeatAgeMs ?? 0) > 30_000 ? T.amber : T.textSec} onClick={() => onMetric("ibkr", "ibkr.heartbeat_age_ms")} />
      <StateRow label="Selected account" value={maskIbkrAccountId(ibkr.selectedAccountId)} />
      <StateRow label="Session mode" value={ibkr.sessionMode} />
      <StateRow label="Market data" value={ibkr.marketDataMode} />
      <StateRow label="Live mode" value={metrics.liveMarketDataAvailable == null ? MISSING_VALUE : metrics.liveMarketDataAvailable ? "yes" : "no"} tone={metrics.liveMarketDataAvailable ? T.textSec : metrics.liveMarketDataAvailable === false ? T.amber : T.textDim} />
      <StateRow label="Stream fresh" value={metrics.streamFresh == null ? MISSING_VALUE : metrics.streamFresh ? "yes" : "no"} tone={metrics.streamFresh ? T.green : metrics.streamFresh === false ? T.amber : T.textDim} />
      <StateRow label="Stream age" value={formatMs(metrics.lastStreamEventAgeMs)} tone={(metrics.lastStreamEventAgeMs ?? 0) > 10_000 ? T.amber : T.textSec} />
      <StateRow label="Strict ready" value={metrics.strictReady == null ? MISSING_VALUE : metrics.strictReady ? "yes" : "no"} tone={metrics.strictReady ? T.green : metrics.strictReady === false ? T.amber : T.textDim} />
      <StateRow label="Ready reason" value={metrics.strictReason} tone={metrics.strictReason ? T.amber : T.textSec} />
      <StateRow label="Bridge->API p95" value={formatMs(latencyStats.bridgeToApiMs?.p95)} />
      <StateRow label="API->React p95" value={formatMs(latencyStats.apiToReactMs?.p95)} />
      <StateRow label="Total p95" value={formatMs(latencyStats.totalMs?.p95)} />
      <StateRow label="Last error" value={ibkr.lastError || ibkr.healthError || ibkr.lastRecoveryError} tone={ibkr.lastError || ibkr.healthError || ibkr.lastRecoveryError ? T.red : T.textSec} />
      <StateRow label="Health detail" value={ibkr.healthErrorDetail} tone={ibkr.healthErrorDetail ? T.red : T.textSec} />
    </Panel>
  );
}

export default function DiagnosticsScreen() {
  const { preferences: userPreferences } = useUserPreferences();
  const notificationPreferences = userPreferences.notifications;
  const { state, metrics, history } = useOptionHydrationDiagnostics();
  const chartStats = useChartHydrationStats();
  const latencyStats = useIbkrLatencyStats();
  const workloadStats = useRuntimeWorkloadStats();
  const hydrationCoordinatorStats = useHydrationCoordinatorStats();
  const [activeTab, setActiveTab] = useState("Overview");
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [latest, setLatest] = useState(null);
  const [historyData, setHistoryData] = useState({ points: [], snapshots: [] });
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventDetail, setEventDetail] = useState(null);
  const [streamState, setStreamState] = useState("connecting");
  const [alertsByKey, setAlertsByKey] = useState({});
  const [alertPreferences, setAlertPreferences] = useState(readLocalAlertPreferences);
  const audioContextRef = useRef(null);
  const alertsRef = useRef({});
  const browserMetricsInputRef = useRef({
    workloadStats,
    hydrationCoordinatorStats,
    chartStats,
    optionState: state,
  });
  const audioEnabled = alertPreferences.audioEnabled;
  const alertVolume = Number.isFinite(Number(alertPreferences.alertVolume))
    ? Math.max(0, Math.min(100, Number(alertPreferences.alertVolume)))
    : 70;
  const audioMutedUntil = alertPreferences.audioMutedUntil;

  useEffect(() => {
    browserMetricsInputRef.current = {
      workloadStats,
      hydrationCoordinatorStats,
      chartStats,
      optionState: state,
    };
  }, [chartStats, hydrationCoordinatorStats, state, workloadStats]);

  useEffect(() => {
    alertsRef.current = alertsByKey;
  }, [alertsByKey]);

  useEffect(() => {
    writeLocalAlertPreferences(alertPreferences);
  }, [alertPreferences]);

  useEffect(() => {
    const listener = () => {
      setAlertPreferences(readLocalAlertPreferences());
    };
    window.addEventListener(DIAGNOSTIC_ALERT_PREF_EVENT, listener);
    return () => window.removeEventListener(DIAGNOSTIC_ALERT_PREF_EVENT, listener);
  }, []);

  const timeWindow = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - windowMinutes * 60_000);
    return { from, to };
  }, [windowMinutes]);

  const playAlert = useCallback((severity) => {
    if (
      !audioEnabled ||
      quietHoursActive(notificationPreferences) ||
      Date.now() < audioMutedUntil
    ) {
      return;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = audioContextRef.current || new AudioContext();
      audioContextRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = severity === "critical" ? 880 : 520;
      gain.gain.setValueAtTime(0.001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.001, 0.12 * (alertVolume / 100)),
        context.currentTime + 0.02,
      );
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.24);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.25);
    } catch {
      setAlertPreferences((current) => ({
        ...current,
        audioEnabled: false,
      }));
    }
  }, [alertVolume, audioEnabled, audioMutedUntil, notificationPreferences]);

  const updateLocalAlerts = useCallback((items, options = {}) => {
    const inputs = Array.isArray(items) ? items : [items];
    const result = reduceDiagnosticAlerts(alertsRef.current, inputs, {
      source: options.source || "event",
      notify: options.notify !== false,
      nowMs: Date.now(),
      dismissedAlerts: alertPreferences.dismissedAlerts,
    });
    alertsRef.current = result.alerts;
    setAlertsByKey(result.alerts);
    const notification =
      result.notifications.find((alert) => alert.severity === "critical") ||
      result.notifications[0];
    if (notification) {
      playAlert(notification.severity);
      requestDesktopAlert(notification, notificationPreferences);
    }
  }, [alertPreferences.dismissedAlerts, notificationPreferences, playAlert]);

  const syncLocalAlertsFromSnapshot = useCallback((items) => {
    const inputs = Array.isArray(items) ? items : [items];
    const result = syncDiagnosticSnapshotAlerts(alertsRef.current, inputs, {
      nowMs: Date.now(),
      dismissedAlerts: alertPreferences.dismissedAlerts,
    });
    alertsRef.current = result.alerts;
    setAlertsByKey(result.alerts);
  }, [alertPreferences.dismissedAlerts]);

  const loadHistoryAndEvents = useCallback(() => {
    const params = new URLSearchParams({
      from: timeWindow.from.toISOString(),
      to: timeWindow.to.toISOString(),
    });
    fetch(`/api/diagnostics/history?${params.toString()}`)
      .then((response) => response.json())
      .then((payload) => setHistoryData(payload))
      .catch(() => {});
    fetch(`/api/diagnostics/events?${params.toString()}`)
      .then((response) => response.json())
      .then((payload) => setEvents(payload.events || []))
      .catch(() => {});
  }, [timeWindow.from, timeWindow.to]);

  useEffect(() => {
    loadHistoryAndEvents();
    const interval = window.setInterval(loadHistoryAndEvents, 15_000);
    return () => window.clearInterval(interval);
  }, [loadHistoryAndEvents]);

  useEffect(() => {
    postClientEvent({
      category: "diagnostics-page",
      severity: "info",
      message: "Diagnostics page opened",
      raw: { userAgent: navigator.userAgent },
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const collect = () => {
      collectBrowserResourceMetrics(browserMetricsInputRef.current).then((payload) => {
        if (!cancelled) {
          postClientMetrics(payload);
        }
      });
    };
    collect();
    const interval = window.setInterval(collect, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (typeof window.EventSource === "undefined") {
      setStreamState("polling");
      const poll = () => {
        fetch("/api/diagnostics/latest")
          .then((response) => response.json())
          .then((payload) => {
            setLatest(payload);
            syncLocalAlertsFromSnapshot(payload.events || []);
          })
          .catch(() => setStreamState("error"));
      };
      poll();
      const interval = window.setInterval(poll, 5_000);
      return () => window.clearInterval(interval);
    }

    const source = new EventSource("/api/diagnostics/stream");
    source.addEventListener("ready", (event) => {
      setStreamState("live");
      try {
        const payload = JSON.parse(event.data);
        if (payload.latest) {
          setLatest(payload.latest);
          syncLocalAlertsFromSnapshot(payload.latest.events || []);
        }
      } catch {
        // The heartbeat path will publish a fresh snapshot shortly.
      }
    });
    source.addEventListener("snapshot", (event) => {
      setStreamState("live");
      const payload = JSON.parse(event.data);
      setLatest(payload);
      syncLocalAlertsFromSnapshot(payload.events || []);
    });
    source.addEventListener("event", (event) => {
      const payload = JSON.parse(event.data);
      setEvents((current) => [payload, ...current.filter((item) => item.id !== payload.id)].slice(0, 500));
      updateLocalAlerts(payload, { source: "event" });
    });
    source.addEventListener("threshold-breach", (event) => {
      const payload = JSON.parse(event.data);
      updateLocalAlerts(payload, { source: "threshold" });
    });
    source.onerror = () => setStreamState("reconnecting");
    return () => source.close();
  }, [syncLocalAlertsFromSnapshot, updateLocalAlerts]);

  useEffect(() => {
    if (!selectedEvent) {
      setEventDetail(null);
      return;
    }
    fetch(`/api/diagnostics/events/${encodeURIComponent(selectedEvent.id || selectedEvent.incidentKey)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setEventDetail(payload))
      .catch(() => setEventDetail(null));
  }, [selectedEvent]);

  const overviewSnapshots = latest?.snapshots || [];
  const topSeverity = latest?.severity || "info";
  const apiSnapshot = snapshotBySubsystem(latest, "api");
  const ibkrSnapshot = snapshotBySubsystem(latest, "ibkr");
  const marketDataSnapshot = snapshotBySubsystem(latest, "market-data");
  const browserSnapshot = snapshotBySubsystem(latest, "browser");
  const chartHydrationSnapshot = snapshotBySubsystem(latest, "chart-hydration");
  const resourcePressureSnapshot = snapshotBySubsystem(latest, "resource-pressure");
  const isolationSnapshot = snapshotBySubsystem(latest, "isolation");
  const storageSnapshot = snapshotBySubsystem(latest, "storage");
  const accountSnapshot = snapshotBySubsystem(latest, "accounts");
  const orderSnapshot = snapshotBySubsystem(latest, "orders");
  const apiMetrics = safeRecord(apiSnapshot?.metrics);
  const ibkrMetrics = safeRecord(ibkrSnapshot?.metrics);
  const marketDataMetrics = safeRecord(marketDataSnapshot?.metrics);
  const browserMetrics = safeRecord(browserSnapshot?.metrics);
  const chartHydrationMetrics = safeRecord(chartHydrationSnapshot?.metrics);
  const resourcePressureMetrics = safeRecord(resourcePressureSnapshot?.metrics);
  const isolationMetrics = safeRecord(isolationSnapshot?.metrics);
  const storageMetrics = safeRecord(storageSnapshot?.metrics);
  const accountMetrics = safeRecord(accountSnapshot?.metrics);
  const orderMetrics = safeRecord(orderSnapshot?.metrics);
  const allLocalAlerts = useMemo(() => sortLocalAlerts(alertsByKey), [alertsByKey]);
  const activeLocalAlerts = useMemo(() => {
    const nowMs = Date.now();
    return allLocalAlerts.filter(
      (alert) => !isLocalAlertDismissed(alert, alertPreferences.dismissedAlerts, nowMs),
    );
  }, [allLocalAlerts, alertPreferences.dismissedAlerts, latest?.timestamp]);
  const dismissedLocalAlerts = useMemo(() => {
    const nowMs = Date.now();
    return allLocalAlerts.filter(
      (alert) => isLocalAlertDismissed(alert, alertPreferences.dismissedAlerts, nowMs),
    );
  }, [allLocalAlerts, alertPreferences.dismissedAlerts, latest?.timestamp]);
  const stream = latencyStats?.stream || {};
  const quoteCoverage =
    Number.isFinite(state.requestedQuotes) && state.requestedQuotes > 0
      ? `${state.returnedQuotes ?? state.acceptedQuotes ?? 0}/${state.requestedQuotes}`
      : MISSING_VALUE;
  const chartHydrationScopes =
    Array.isArray(chartHydrationMetrics.scopes) &&
    chartHydrationMetrics.scopes.length
      ? chartHydrationMetrics.scopes
      : Array.isArray(chartStats.scopes)
        ? chartStats.scopes
        : [];
  const chartHydrationSeverity =
    chartHydrationSnapshot?.severity ||
    ((chartStats.counters?.payloadShapeError ?? 0) > 0 ? "warning" : "info");

  const selectMetric = (subsystem, metricKey) => {
    setActiveTab("Events");
    const params = new URLSearchParams({
      from: timeWindow.from.toISOString(),
      to: timeWindow.to.toISOString(),
      subsystem,
    });
    fetch(`/api/diagnostics/events?${params.toString()}`)
      .then((response) => response.json())
      .then((payload) => setEvents(payload.events || []))
      .catch(() => {});
    setSelectedEvent({
      id: metricKey,
      incidentKey: metricKey,
      subsystem,
      category: "metric",
      code: metricKey,
      severity: "info",
      message: `Filtered by ${metricKey}`,
      eventCount: 0,
      lastSeenAt: new Date().toISOString(),
    });
  };

  const selectLocalAlert = (alert) => {
    if (alert.kind === "threshold" && alert.subsystem && alert.code) {
      selectMetric(alert.subsystem, alert.code);
      return;
    }
    setActiveTab("Events");
    setSelectedEvent({
      id: alert.eventId || alert.incidentKey || alert.key,
      incidentKey: alert.incidentKey || alert.key,
      subsystem: alert.subsystem || "browser",
      category: alert.category || alert.kind,
      code: alert.code || alert.key,
      severity: alert.severity,
      message: alert.message,
      eventCount: alert.repeatCount,
      firstSeenAt: alert.firstSeenAt,
      lastSeenAt: alert.lastSeenAt,
    });
  };

  const dismissLocalAlert = (alert) => {
    setAlertPreferences((current) => dismissLocalAlertPreference(current, alert));
  };

  const dismissAllVisibleAlerts = () => {
    setAlertPreferences((current) =>
      dismissAllLocalAlertPreferences(current, activeLocalAlerts),
    );
  };

  const restoreDismissedAlerts = () => {
    setAlertPreferences((current) =>
      restoreLocalAlertPreferences(
        current,
        dismissedLocalAlerts.map((alert) => alert.key),
      ),
    );
  };

  const setAudioMutedUntilPreference = (value) => {
    setAlertPreferences((current) => ({
      ...current,
      audioMutedUntil: value,
    }));
  };

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams({
      from: timeWindow.from.toISOString(),
      to: timeWindow.to.toISOString(),
    });
    return `/api/diagnostics/export?${params.toString()}`;
  }, [timeWindow.from, timeWindow.to]);

  return (
    <div
      data-testid="diagnostics-screen"
      style={{
        height: "100%",
        overflow: "auto",
        background: T.bg0,
        color: T.text,
        padding: sp(10),
        fontFamily: T.sans,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: sp(12),
          marginBottom: sp(14),
        }}
      >
        <div>
          <div style={{ fontSize: fs(18), fontWeight: 900 }}>Diagnostics</div>
          <div style={{ color: T.textDim, fontSize: fs(10), fontFamily: T.mono }}>
            Real-time SSE, 7-day history, per-subsystem uptime, events, probes, and thresholds
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: sp(8), flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ color: severityTone(topSeverity), fontFamily: T.mono, fontSize: fs(10), fontWeight: 900 }}>
            {statusLabel(latest?.status)}
          </span>
          <span style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(10) }}>
            {streamState.toUpperCase()} / {latest?.timestamp ? formatAgo(latest.timestamp) : "waiting"}
          </span>
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setWindowMinutes(option.minutes)}
              style={{
                border: `1px solid ${windowMinutes === option.minutes ? T.green : T.border}`,
                background: windowMinutes === option.minutes ? T.greenBg : T.bg2,
                color: windowMinutes === option.minutes ? T.green : T.textSec,
                borderRadius: dim(4),
                padding: sp("5px 8px"),
                fontFamily: T.mono,
                fontSize: fs(9),
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {option.label}
            </button>
          ))}
          <a
            href={exportUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              border: `1px solid ${T.border}`,
              background: T.bg2,
              color: T.textSec,
              borderRadius: dim(4),
              padding: sp("5px 8px"),
              fontFamily: T.mono,
              fontSize: fs(9),
              fontWeight: 900,
              textDecoration: "none",
            }}
          >
            Export Raw
          </a>
        </div>
      </div>

      <div style={{ display: "flex", gap: sp(8), flexWrap: "wrap", marginBottom: sp(14) }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            data-testid={`diagnostics-tab-${tab.toLowerCase().replace(/\s+/g, "-")}`}
            type="button"
            className={joinMotionClasses(
              "ra-interactive",
              activeTab === tab && "ra-focus-rail",
            )}
            onClick={() => setActiveTab(tab)}
            style={{
              ...motionVars({ accent: T.green }),
              border: `1px solid ${activeTab === tab ? T.green : T.border}`,
              background: activeTab === tab ? T.greenBg : T.bg1,
              color: activeTab === tab ? T.green : T.textSec,
              borderRadius: dim(4),
              padding: sp("7px 10px"),
              fontFamily: T.mono,
              fontSize: fs(9),
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {(activeLocalAlerts.length > 0 || dismissedLocalAlerts.length > 0) && (
        <Panel
          title="Active Alerts"
          action={
            <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() =>
                  setAlertPreferences((current) => ({
                    ...current,
                    audioEnabled: !current.audioEnabled,
                  }))
                }
                style={smallButton()}
              >
                {audioEnabled ? "Audio On" : "Audio Off"}
              </button>
              {AUDIO_SNOOZE_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setAudioMutedUntilPreference(option.ms === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : Date.now() + option.ms)}
                  style={smallButton()}
                >
                  Snooze {option.label}
                </button>
              ))}
              <button type="button" onClick={() => setAudioMutedUntilPreference(0)} style={smallButton()}>
                Unsnooze
              </button>
              {activeLocalAlerts.length > 0 && (
                <button type="button" onClick={dismissAllVisibleAlerts} style={smallButton()}>
                  Dismiss all
                </button>
              )}
              {dismissedLocalAlerts.length > 0 && (
                <button type="button" onClick={restoreDismissedAlerts} style={smallButton()}>
                  Restore
                </button>
              )}
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: sp(8) }}>
            {activeLocalAlerts.slice(0, 8).map((alert) => (
              <LocalAlertRow
                key={alert.key}
                alert={alert}
                onSelect={selectLocalAlert}
                onDismiss={dismissLocalAlert}
              />
            ))}
            {activeLocalAlerts.length > 8 && (
              <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9) }}>
                {activeLocalAlerts.length - 8} more grouped alerts
              </div>
            )}
            {dismissedLocalAlerts.length > 0 && (
              <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9) }}>
                {dismissedLocalAlerts.length} dismissed active alert{dismissedLocalAlerts.length === 1 ? "" : "s"}
              </div>
            )}
          </div>
        </Panel>
      )}

      {activeTab === "Overview" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: sp(8), margin: sp("10px 0"), alignItems: "start" }}>
            <MetricCard label="API p95" value={formatMs(apiMetrics.p95LatencyMs)} sub={`${formatCount(apiMetrics.requestCount5m)} req / 5m`} severity={apiSnapshot?.severity} onClick={() => selectMetric("api", "api.p95_latency_ms")} />
            <MetricCard label="IBKR heartbeat" value={formatMs(ibkrMetrics.heartbeatAgeMs)} sub={ibkrMetrics.connected ? "connected" : "disconnected"} severity={ibkrSnapshot?.severity} onClick={() => selectMetric("ibkr", "ibkr.heartbeat_age_ms")} />
            <MetricCard label="Market freshness" value={formatMs(marketDataMetrics.freshnessAgeMs ?? stream.lastEventAgeMs)} sub={`${formatCount(marketDataMetrics.activeConsumerCount ?? stream.activeConsumerCount)} consumers`} severity={marketDataSnapshot?.severity || (stream.streamGapCount > 0 ? "warning" : "info")} onClick={() => selectMetric("market-data", "market_data.freshness_age_ms")} />
            <MetricCard label="Chart hydration" value={formatMs(chartHydrationMetrics.prependP95Ms ?? chartStats.prependRequestMs?.p95)} sub={`${formatCount(chartHydrationMetrics.activeScopeCount ?? chartStats.activeScopeCount ?? chartStats.scopes.length)} scopes / ${formatCount(chartHydrationMetrics.cursorFallbackCount ?? 0)} fallbacks`} severity={chartHydrationSeverity} onClick={() => selectMetric("chart-hydration", "chart_hydration.prepend_p95_ms")} />
            <MetricCard label="Browser events" value={formatCount(browserMetrics.warningCount5m ?? 0)} sub={`${formatCount(browserMetrics.eventCount5m ?? 0)} events / 5m`} severity={browserSnapshot?.severity} onClick={() => selectMetric("browser", "browser.events")} />
            <MetricCard label="Memory" value={String(resourcePressureMetrics.pressureLevel || "normal").toUpperCase()} sub={`heap ${formatPercent(resourcePressureMetrics.heapUsedPercent)} / browser ${formatMb(resourcePressureMetrics.browserMemoryMb)}`} severity={resourcePressureSnapshot?.severity || isolationSnapshot?.severity} onClick={() => setActiveTab("Memory")} />
            <MetricCard label="Accounts" value={formatCount(accountMetrics.accountCount)} sub={`${formatCount(accountMetrics.positionCount)} positions`} severity={accountSnapshot?.severity} onClick={() => selectMetric("accounts", "orders.visibility_failures")} />
            <MetricCard label="Orders" value={formatCount(orderMetrics.orderCount)} sub={`${formatCount(orderMetrics.visibilityFailures)} failures`} severity={orderSnapshot?.severity} onClick={() => selectMetric("orders", "orders.visibility_failures")} />
            <MetricCard label="Storage" value={storageMetrics.reachable ? "reachable" : "offline"} sub={formatMs(storageMetrics.pingMs)} severity={storageSnapshot?.severity} onClick={() => selectMetric("storage", "storage.ping_ms")} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: sp(10), alignItems: "start" }}>
            <Panel title="API Latency Trend">
              <Sparkline points={historyData.points || []} subsystem="api" metricKey="p95LatencyMs" />
            </Panel>
            <Panel title="IBKR Heartbeat Trend">
              <Sparkline points={historyData.points || []} subsystem="ibkr" metricKey="heartbeatAgeMs" />
            </Panel>
            <Panel title="Recent Events">
              <EventList events={events.slice(0, 5)} onSelect={setSelectedEvent} />
            </Panel>
          </div>
        </>
      )}

      {activeTab === "IBKR" && (
        <div style={{ display: "grid", gap: sp(14) }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: sp(14) }}>
            <GatewayPanel latest={latest} latencyStats={latencyStats} onMetric={selectMetric} />
            <Panel title="IBKR Raw Snapshot">
              <JsonBlock value={ibkrSnapshot} />
            </Panel>
          </div>
        </div>
      )}

      {activeTab === "Market Data" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: sp(14) }}>
          <Panel title="Backend Quote Stream">
            <StateRow label="Consumers" value={formatCount(marketDataMetrics.activeConsumerCount)} />
            <StateRow label="Symbols" value={formatCount(marketDataMetrics.unionSymbolCount)} />
            <StateRow label="Cached quotes" value={formatCount(marketDataMetrics.cachedQuoteCount)} />
            <StateRow label="Events" value={formatCount(marketDataMetrics.eventCount)} />
            <StateRow label="Last event" value={marketDataMetrics.lastEventAgeMs == null ? MISSING_VALUE : `${formatMs(marketDataMetrics.lastEventAgeMs)} ago`} />
            <StateRow label="Freshness" value={formatMs(marketDataMetrics.freshnessAgeMs)} tone={marketDataMetrics.freshnessAgeMs > 2_000 ? T.amber : T.textSec} onClick={() => selectMetric("market-data", "market_data.freshness_age_ms")} />
            <StateRow label="Reconnects" value={formatCount(marketDataMetrics.reconnectCount)} tone={marketDataMetrics.reconnectCount > 0 ? T.amber : T.green} />
            <StateRow label="Active gap alert" value={formatMs(marketDataMetrics.streamGapMs ?? marketDataMetrics.stream_gap_ms)} tone={(marketDataMetrics.streamGapMs ?? marketDataMetrics.stream_gap_ms) > 5_000 ? T.amber : T.green} onClick={() => selectMetric("market-data", "market_data.stream_gap_ms")} />
            <StateRow label="Observed gaps" value={formatCount(marketDataMetrics.rawStreamGapCount ?? marketDataMetrics.streamGapCount)} tone={marketDataMetrics.recentGapCount > 0 ? T.amber : T.textSec} />
            <StateRow label="Recent gaps" value={formatCount(marketDataMetrics.recentGapCount)} tone={marketDataMetrics.recentGapCount > 0 ? T.amber : T.green} />
            <StateRow label="Last gap" value={marketDataMetrics.lastGapMs == null ? MISSING_VALUE : `${formatMs(marketDataMetrics.lastGapMs)} / ${formatMs(marketDataMetrics.lastGapAgeMs)} ago`} tone={marketDataMetrics.recentGapCount > 0 ? T.amber : T.textSec} />
            <StateRow label="Worst observed gap" value={formatMs(marketDataMetrics.rawMaxGapMs ?? marketDataMetrics.maxGapMs)} tone={marketDataMetrics.recentGapCount > 0 ? T.amber : T.textSec} />
            <StateRow label="Last error" value={marketDataMetrics.lastError} tone={marketDataMetrics.lastError ? T.red : T.textSec} />
          </Panel>
          <Panel title="Streaming">
            <StateRow label="Consumers" value={formatCount(stream.activeConsumerCount)} />
            <StateRow label="Symbols" value={formatCount(stream.unionSymbolCount)} />
            <StateRow label="Events" value={formatCount(stream.eventCount)} />
            <StateRow label="Last event" value={stream.lastEventAgeMs == null ? MISSING_VALUE : `${formatMs(stream.lastEventAgeMs)} ago`} />
            <StateRow label="Reconnects" value={formatCount(stream.reconnectCount)} />
            <StateRow label="Observed gaps" value={formatCount(stream.streamGapCount)} tone={stream.recentGapCount > 0 ? T.amber : T.textSec} />
            <StateRow label="Recent gaps" value={formatCount(stream.recentGapCount)} tone={stream.recentGapCount > 0 ? T.amber : T.green} />
            <StateRow label="Last gap" value={stream.lastGapMs == null ? MISSING_VALUE : `${formatMs(stream.lastGapMs)} / ${formatMs(stream.lastGapAgeMs)} ago`} tone={stream.recentGapCount > 0 ? T.amber : T.textSec} />
            <StateRow label="Worst observed gap" value={formatMs(stream.maxGapMs)} tone={stream.recentGapCount > 0 ? T.amber : T.textSec} />
          </Panel>
          <Panel title="Latency">
            <StateRow label="Bridge->API p50" value={formatMs(latencyStats.bridgeToApiMs?.p50)} />
            <StateRow label="Bridge->API p95" value={formatMs(latencyStats.bridgeToApiMs?.p95)} />
            <StateRow label="API->React p50" value={formatMs(latencyStats.apiToReactMs?.p50)} />
            <StateRow label="API->React p95" value={formatMs(latencyStats.apiToReactMs?.p95)} />
            <StateRow label="Total p50" value={formatMs(latencyStats.totalMs?.p50)} />
            <StateRow label="Total p95" value={formatMs(latencyStats.totalMs?.p95)} />
          </Panel>
          <Panel title="Option Hydration">
            <StateRow label="Active chain p95" value={formatMs(metrics.activeChainMs?.p95)} />
            <StateRow label="Batch chain p95" value={formatMs(metrics.batchChainMs?.p95)} />
            <StateRow label="Full chain p95" value={formatMs(metrics.fullChainMs?.p95)} />
            <StateRow label="Quote snapshot p95" value={formatMs(metrics.quoteSnapshotMs?.p95)} />
            <StateRow label="First quote p95" value={formatMs(metrics.firstQuoteMs?.p95)} />
          </Panel>
        </div>
      )}

      {activeTab === "API" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: sp(14) }}>
          <Panel title="API Golden Signals">
            <StateRow label="Requests / 5m" value={formatCount(apiMetrics.requestCount5m)} />
            <StateRow label="4xx / 5m" value={formatCount(apiMetrics.warningCount5m)} />
            <StateRow label="5xx / 5m" value={formatCount(apiMetrics.errorCount5m)} tone={apiMetrics.errorCount5m > 0 ? T.red : T.green} />
            <StateRow label="p50 latency" value={formatMs(apiMetrics.p50LatencyMs)} />
            <StateRow label="p95 latency" value={formatMs(apiMetrics.p95LatencyMs)} tone={apiMetrics.p95LatencyMs > 1000 ? T.amber : T.textSec} />
            <StateRow label="p99 latency" value={formatMs(apiMetrics.p99LatencyMs)} />
            <StateRow label="Slow requests / 5m" value={formatCount(apiMetrics.slowRouteCount5m)} tone={(apiMetrics.slowRouteCount5m ?? 0) > 0 ? T.amber : T.green} />
            <StateRow label="Dominant slow route" value={apiMetrics.dominantSlowRoute || MISSING_VALUE} />
            <StateRow label="Dominant route p95" value={formatMs(apiMetrics.dominantSlowRouteP95Ms)} />
          </Panel>
          <Panel title="API Runtime">
            <StateRow label="Uptime" value={formatDuration(apiMetrics.uptimeMs)} />
            <StateRow label="Event loop p95" value={formatMs(apiMetrics.eventLoopP95Ms)} />
            <StateRow label="Event loop max" value={formatMs(apiMetrics.eventLoopMaxMs)} />
            <StateRow label="Diagnostics clients" value={formatCount(apiMetrics.activeDiagnosticsClients)} />
          </Panel>
          <Panel title="API Raw Snapshot">
            <JsonBlock value={apiSnapshot} />
          </Panel>
          <Panel title="Slow Routes">
            <JsonBlock value={apiMetrics.slowRoutes || []} />
          </Panel>
        </div>
      )}

      {activeTab === "Browser" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: sp(14) }}>
          <Panel title="Frontend Workload">
            <StateRow label="Streams" value={workloadStats.kindCounts?.stream ?? 0} />
            <StateRow label="Pollers" value={workloadStats.kindCounts?.poll ?? 0} />
            <StateRow label="Hydration intents" value={hydrationCoordinatorStats.activeIntentCount ?? 0} />
            <StateRow label="Chart intents" value={hydrationCoordinatorStats.familyCounts?.["chart-bars"] ?? 0} />
            <StateRow label="Chart scopes" value={chartStats.activeScopeCount ?? chartStats.scopes.length} />
          </Panel>
          <Panel title="Chart Hydration">
            <StateRow label="Status" value={statusLabel(chartHydrationSnapshot?.status)} tone={severityTone(chartHydrationSeverity)} />
            <StateRow label="Active scopes" value={formatCount(chartHydrationMetrics.activeScopeCount ?? chartStats.activeScopeCount ?? chartStats.scopes.length)} />
            <StateRow label="Prepending scopes" value={formatCount(chartHydrationMetrics.prependingScopeCount ?? chartStats.prependingScopeCount)} tone={(chartHydrationMetrics.prependingScopeCount ?? chartStats.prependingScopeCount ?? 0) > 0 ? T.amber : T.textSec} />
            <StateRow label="Exhausted scopes" value={formatCount(chartHydrationMetrics.exhaustedScopeCount ?? chartStats.exhaustedScopeCount)} tone={(chartHydrationMetrics.exhaustedScopeCount ?? chartStats.exhaustedScopeCount ?? 0) > 0 ? T.amber : T.green} />
            <StateRow label="Prepend p95" value={formatMs(chartHydrationMetrics.prependP95Ms ?? chartStats.prependRequestMs?.p95)} tone={(chartHydrationMetrics.prependP95Ms ?? chartStats.prependRequestMs?.p95 ?? 0) >= 1500 ? T.amber : T.textSec} onClick={() => selectMetric("chart-hydration", "chart_hydration.prepend_p95_ms")} />
            <StateRow label="Payload shape errors" value={formatCount(chartHydrationMetrics.payloadShapeErrors ?? chartStats.counters?.payloadShapeError)} tone={(chartHydrationMetrics.payloadShapeErrors ?? chartStats.counters?.payloadShapeError ?? 0) > 0 ? T.red : T.green} onClick={() => selectMetric("chart-hydration", "chart_hydration.payload_shape_errors")} />
            <StateRow label="Oldest loaded" value={(chartHydrationMetrics.oldestLoadedAtMin || chartStats.oldestLoadedAtMin) ? formatAgo(chartHydrationMetrics.oldestLoadedAtMin || chartStats.oldestLoadedAtMin) : MISSING_VALUE} />
          </Panel>
          <Panel title="Chart Backend">
            <StateRow label="Cache entries" value={`${formatCount(chartHydrationMetrics.cacheEntries)} / ${formatCount(chartHydrationMetrics.cacheMaxEntries)}`} />
            <StateRow label="In-flight" value={formatCount(chartHydrationMetrics.inFlight)} tone={(chartHydrationMetrics.inFlight ?? 0) > 0 ? T.amber : T.textSec} />
            <StateRow label="Cursor entries" value={`${formatCount(chartHydrationMetrics.historyCursorEntries)} / ${formatCount(chartHydrationMetrics.historyCursorMaxEntries)}`} />
            <StateRow label="Cursor TTL" value={formatDuration(chartHydrationMetrics.historyCursorTtlMs)} />
            <StateRow label="Cursor flag" value={chartHydrationMetrics.cursorEnabled == null ? MISSING_VALUE : chartHydrationMetrics.cursorEnabled ? "enabled" : "disabled"} tone={chartHydrationMetrics.cursorEnabled === false ? T.amber : T.green} />
            <StateRow label="Dedupe flag" value={chartHydrationMetrics.dedupeEnabled == null ? MISSING_VALUE : chartHydrationMetrics.dedupeEnabled ? "enabled" : "disabled"} tone={chartHydrationMetrics.dedupeEnabled === false ? T.amber : T.green} />
            <StateRow label="Background flag" value={chartHydrationMetrics.backgroundEnabled == null ? MISSING_VALUE : chartHydrationMetrics.backgroundEnabled ? "enabled" : "disabled"} tone={chartHydrationMetrics.backgroundEnabled === false ? T.amber : T.green} />
            <StateRow label="Cache hit/miss" value={`${formatCount(chartHydrationMetrics.cacheHit)} / ${formatCount(chartHydrationMetrics.cacheMiss)}`} />
            <StateRow label="In-flight joins" value={formatCount(chartHydrationMetrics.inFlightJoin)} />
            <StateRow label="Provider fetch/pages" value={`${formatCount(chartHydrationMetrics.providerFetch)} / ${formatCount(chartHydrationMetrics.providerPage)}`} />
            <StateRow label="Cursor continuations" value={formatCount(chartHydrationMetrics.cursorContinuation)} tone={(chartHydrationMetrics.cursorContinuation ?? 0) > 0 ? T.green : T.textSec} />
            <StateRow label="Cursor fallbacks" value={formatCount(chartHydrationMetrics.cursorFallbackCount ?? chartHydrationMetrics.cursorFallback)} tone={(chartHydrationMetrics.cursorFallbackCount ?? chartHydrationMetrics.cursorFallback ?? 0) > 0 ? T.amber : T.green} onClick={() => selectMetric("chart-hydration", "chart_hydration.cursor_fallback_count")} />
          </Panel>
          <Panel title="Chart Scopes">
            {chartHydrationScopes.length ? (
              chartHydrationScopes.slice(0, 8).map((scope) => (
                <div key={scope.scope} style={{ borderBottom: `1px solid ${T.border}55`, padding: sp("7px 0") }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: sp(10), fontFamily: T.mono, fontSize: fs(10), color: T.textSec }}>
                    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{scope.scope}</span>
                    <span style={{ color: scope.hasExhaustedOlderHistory ? T.amber : scope.isPrependingOlder ? T.green : T.textDim }}>
                      {scope.role || "chart"} / {scope.timeframe || MISSING_VALUE}
                    </span>
                  </div>
                  <div style={{ marginTop: sp(4), display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: sp(6), fontFamily: T.mono, fontSize: fs(9), color: T.textDim }}>
                    <span>bars {formatCount(scope.hydratedBaseCount)} / {formatCount(scope.renderedBarCount)}</span>
                    <span>oldest {scope.oldestLoadedAt ? formatAgo(scope.oldestLoadedAt) : MISSING_VALUE}</span>
                    <span>pages {formatCount(scope.olderHistoryPageCount)}</span>
                    <span>provider {scope.olderHistoryProvider || MISSING_VALUE}</span>
                    <span>cursor {scope.hasHistoryCursor ? "yes" : "no"}</span>
                    <span>{scope.hasExhaustedOlderHistory ? scope.olderHistoryExhaustionReason || "exhausted" : scope.isPrependingOlder ? "prepending" : "ready"}</span>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: T.textDim, fontSize: fs(10), fontFamily: T.mono }}>No chart scopes observed.</div>
            )}
          </Panel>
          <Panel title="Current Option Session">
            <StateRow label="Ticker" value={state.ticker} />
            <StateRow label="Expiration" value={state.expiration} />
            <StateRow label="Provider mode" value={state.providerMode} />
            <StateRow label="WebSocket" value={state.wsState} />
            <StateRow label="Quote coverage" value={quoteCoverage} />
            <StateRow label="Backpressure" value={state.degraded ? "degraded" : "normal"} tone={state.degraded ? T.amber : T.green} />
            <StateRow label="Pause reason" value={state.pauseReason} />
          </Panel>
          <Panel title="Local Rollups" action={<button type="button" onClick={clearOptionHydrationDiagnosticsHistory} style={smallButton()}>Clear History</button>}>
            {history.length ? (
              history.slice(-8).reverse().map((entry) => (
                <div key={entry.id} style={{ borderBottom: `1px solid ${T.border}55`, padding: sp("7px 0"), fontFamily: T.mono, fontSize: fs(9), color: T.textSec }}>
                  {formatAppDateTime(entry.updatedAt)} / failures {entry.failureCount} / {entry.transportStates.join(", ") || "no state"}
                </div>
              ))
            ) : (
              <div style={{ color: T.textDim, fontSize: fs(10), fontFamily: T.mono }}>No local rollups yet.</div>
            )}
          </Panel>
          <Panel title="Browser Events">
            <StateRow label="Events / 5m" value={formatCount(browserMetrics.eventCount5m)} />
            <StateRow label="Warnings / 5m" value={formatCount(browserMetrics.warningCount5m)} tone={browserMetrics.warningCount5m > 0 ? T.amber : T.green} />
            <StateRow label="Critical / 5m" value={formatCount(browserMetrics.criticalCount5m)} tone={browserMetrics.criticalCount5m > 0 ? T.red : T.green} />
            <StateRow label="Last category" value={browserMetrics.lastCategory} />
            <StateRow label="Last event" value={browserMetrics.lastEventAt ? formatAgo(browserMetrics.lastEventAt) : MISSING_VALUE} />
          </Panel>
        </div>
      )}

      {activeTab === "Memory" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: sp(14) }}>
          <Panel title="Pressure State">
            <StateRow label="Level" value={String(resourcePressureMetrics.pressureLevel || "normal").toUpperCase()} tone={severityTone(resourcePressureSnapshot?.severity)} />
            <StateRow label="Recommended action" value={resourcePressureMetrics.recommendedAction} />
            <StateRow label="Diagnostics clients" value={formatCount(resourcePressureMetrics.activeDiagnosticsClients)} />
          </Panel>
          <Panel title="API Memory">
            <StateRow label="Heap used" value={formatMb(resourcePressureMetrics.heapUsedMb)} />
            <StateRow label="Heap limit" value={formatMb(resourcePressureMetrics.heapLimitMb)} />
            <StateRow label="Heap pressure" value={formatPercent(resourcePressureMetrics.heapUsedPercent)} tone={(resourcePressureMetrics.heapUsedPercent ?? 0) >= 70 ? T.amber : T.green} onClick={() => selectMetric("resource-pressure", "resource_pressure.heap_used_percent")} />
            <StateRow label="RSS" value={formatMb(resourcePressureMetrics.rssMb)} />
            <StateRow label="Event loop p95" value={formatMs(resourcePressureMetrics.eventLoopP95Ms)} />
          </Panel>
          <Panel title="Browser Memory">
            <StateRow label="Estimate" value={formatMb(resourcePressureMetrics.browserMemoryMb)} onClick={() => selectMetric("resource-pressure", "resource_pressure.browser_memory_mb")} />
            <StateRow label="Confidence" value={resourcePressureMetrics.browserMemoryConfidence} />
            <StateRow label="Source" value={resourcePressureMetrics.browserMemorySource} />
            <StateRow label="Observed" value={resourcePressureMetrics.browserObservedAt ? formatAgo(resourcePressureMetrics.browserObservedAt) : MISSING_VALUE} />
          </Panel>
          <Panel title="Isolation Readiness">
            <StateRow label="Mode" value={isolationMetrics.mode} />
            <StateRow label="Cross-origin isolated" value={isolationMetrics.crossOriginIsolated ? "yes" : "no"} tone={isolationMetrics.crossOriginIsolated ? T.green : T.amber} />
            <StateRow label="Report-only" value={isolationMetrics.reportOnly ? "yes" : "no"} />
            <StateRow label="COOP target" value={isolationMetrics.coopMode} />
            <StateRow label="COEP target" value={isolationMetrics.coepMode} />
            <StateRow label="Memory API available" value={isolationMetrics.memoryApiAvailable ? "yes" : "no"} />
            <StateRow label="Memory API used" value={isolationMetrics.memoryApiUsed ? "yes" : "no"} />
            <StateRow label="Latest client sample" value={isolationMetrics.latestClientAt ? formatAgo(isolationMetrics.latestClientAt) : MISSING_VALUE} />
          </Panel>
          <Panel title="Isolation Reports">
            <StateRow label="Actionable reports / 5m" value={formatCount(isolationMetrics.reportCount5m)} tone={(isolationMetrics.reportCount5m ?? 0) > 0 ? T.amber : T.green} onClick={() => selectMetric("isolation", "isolation.report_count_5m")} />
            <StateRow label="Raw browser reports / 5m" value={formatCount(isolationMetrics.rawReportCount5m)} tone={(isolationMetrics.rawReportCount5m ?? 0) > 0 ? T.amber : T.green} />
            <JsonBlock value={{ actionableTypes: isolationMetrics.reportTypes, rawTypes: isolationMetrics.rawReportTypes, blockedOrigins: isolationMetrics.blockedOrigins }} />
          </Panel>
          <Panel title="Runtime Caches">
            <JsonBlock value={resourcePressureMetrics.cacheInventory} />
          </Panel>
          <Panel title="Cache Tables">
            {(Array.isArray(storageMetrics.monitoredTables) ? storageMetrics.monitoredTables : []).map((table) => (
              <div key={table.table} style={{ borderBottom: `1px solid ${T.border}55`, padding: sp("7px 0") }}>
                <StateRow label={table.table} value={`${formatCount(table.rowEstimate)} rows / ${formatMb(table.totalMb)}`} />
                <StateRow label="oldest/newest" value={`${table.oldestAt ? formatAgo(table.oldestAt) : MISSING_VALUE} / ${table.newestAt ? formatAgo(table.newestAt) : MISSING_VALUE}`} />
              </div>
            ))}
          </Panel>
          <Panel title="V8 Heap Spaces">
            <JsonBlock value={resourcePressureMetrics.v8HeapSpaces} />
          </Panel>
          <Panel title="Raw Memory Snapshots">
            <JsonBlock value={{ resourcePressure: resourcePressureSnapshot, isolation: isolationSnapshot, storage: storageSnapshot }} />
          </Panel>
        </div>
      )}

      {activeTab === "Orders/Accounts" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: sp(14) }}>
          <Panel title="Accounts Probe">
            <StateRow label="Accounts" value={formatCount(accountMetrics.accountCount)} />
            <StateRow label="Positions" value={formatCount(accountMetrics.positionCount)} />
            <StateRow label="Visibility failures" value={formatCount(accountMetrics.visibilityFailures)} tone={accountMetrics.visibilityFailures > 0 ? T.red : T.green} />
            <StateRow label="Last error" value={accountMetrics.lastError} tone={accountMetrics.lastError ? T.red : T.textSec} />
          </Panel>
          <Panel title="Orders Probe">
            <StateRow label="Orders" value={formatCount(orderMetrics.orderCount)} />
            <StateRow label="Visibility failures" value={formatCount(orderMetrics.visibilityFailures)} tone={orderMetrics.visibilityFailures > 0 ? T.red : T.green} />
            <StateRow label="Last error" value={orderMetrics.lastError} tone={orderMetrics.lastError ? T.red : T.textSec} />
          </Panel>
          <Panel title="Probe Raw">
            <JsonBlock value={{ accounts: accountSnapshot, orders: orderSnapshot }} />
          </Panel>
        </div>
      )}

      {activeTab === "Storage" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: sp(14) }}>
          <Panel title="Storage Health">
            <StateRow label="Reachable" value={storageMetrics.reachable ? "yes" : "no"} tone={storageMetrics.reachable ? T.green : T.red} />
            <StateRow label="Ping" value={formatMs(storageMetrics.pingMs)} />
            <StateRow label="Retention" value={`${storageMetrics.snapshotRetentionDays || 7} days`} />
            <StateRow label="Error" value={storageMetrics.error} tone={storageMetrics.error ? T.red : T.textSec} />
          </Panel>
          <Panel title="Storage Raw Snapshot">
            <JsonBlock value={storageSnapshot} />
          </Panel>
        </div>
      )}

      {activeTab === "Events" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.7fr)", gap: sp(14) }}>
          <Panel title="Events">
            <EventList events={events} onSelect={setSelectedEvent} />
          </Panel>
          <Panel title="Event Detail">
            {selectedEvent ? (
              <JsonBlock value={eventDetail || selectedEvent} />
            ) : (
              <div style={{ color: T.textDim, fontSize: fs(10), fontFamily: T.mono }}>
                Select an event or metric to inspect raw context.
              </div>
            )}
          </Panel>
        </div>
      )}

      <DiagnosticThresholdSettingsPanel />

      <div style={{ height: sp(16) }} />
    </div>
  );
}

function smallButton() {
  return {
    border: `1px solid ${T.border}`,
    background: T.bg2,
    color: T.textSec,
    borderRadius: dim(4),
    padding: sp("5px 8px"),
    fontFamily: T.mono,
    fontSize: fs(9),
    fontWeight: 900,
    cursor: "pointer",
  };
}
