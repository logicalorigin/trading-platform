import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getDiagnosticEventDetail,
  getLatestDiagnostics,
  listDiagnosticEvents,
  listDiagnosticHistory,
  recordClientDiagnosticEvent,
  useListBrokerConnections,
} from "@workspace/api-client-react";
import {
  useChartHydrationStats,
} from "../features/charting/chartHydrationStats";
import {
  useIbkrLatencyStats,
} from "../features/charting/useMassiveStockAggregateStream";
import {
  clearOptionHydrationDiagnosticsHistory,
  useOptionHydrationDiagnostics,
} from "../features/platform/optionHydrationDiagnostics";
import { collectBrowserResourceMetrics } from "../features/platform/memoryPressureClient";
import { useMemoryPressureSnapshot } from "../features/platform/memoryPressureStore";
import {
  maskIbkrAccountId,
  resolveIbkrGatewayHealth,
} from "../features/platform/IbkrConnectionStatus";
import { useRuntimeWorkloadStats } from "../features/platform/workloadStats";
import { useHydrationCoordinatorStats } from "../features/platform/hydrationCoordinator";
import { useRuntimeControlSnapshot } from "../features/platform/useRuntimeControlSnapshot";
import {
  LOCAL_ALERT_PREFERENCES_EVENT,
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
import { useQueryClient } from "@tanstack/react-query";

import { MachineStateDiagram } from "./diagnostics/MachineStateDiagram.jsx";
import {
  DIAGNOSTICS_COLLECTION_INTERVAL_MS,
  buildMachineStateDiagramModel,
} from "./diagnostics/machineStateDiagramModel.js";

const GEX_QUERY_KEY_PREFIXES = ["gex-dashboard", "gex-projection", "gex-zero-gamma"];
import {
  CSS_COLOR,
  cssColorAlpha,
  cssColorMix,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../lib/uiTokens.jsx";
import { Button } from "../components/ui/Button.jsx";
import {
  Badge,
  DataUnavailableState,
  MicroSparkline,
  SegmentedControl,
  SeverityRail,
  StatTile,
  StatusPill,
  SurfacePanel,
} from "../components/platform/primitives.jsx";
import {
  FailurePointInlineIcon,
  FailurePointTooltip,
} from "../components/platform/FailurePointTooltip.jsx";
import { formatAppDateTime } from "../lib/timeZone";
import {
  joinMotionClasses,
  motionRowStyle,
  motionVars,
} from "../lib/motion";
import { useUserPreferences } from "../features/preferences/useUserPreferences";
import { DiagnosticThresholdSettingsPanel } from "./settings/DiagnosticThresholdSettingsPanel";
import { responsiveFlags, useElementSize } from "../lib/responsive";
import {
  buildFailurePointFromDiagnosticEvent,
  buildFailurePointFromDiagnosticsSnapshot,
  buildMemoryPressureFailurePoint,
} from "../features/platform/failurePointModel.js";
import { isPyrusSafeQaMode } from "../app/qa-mode";

const TABS = [
  "Overview",
  "Broker",
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
    new Notification("PYRUS diagnostics", {
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

const formatMbWithLimit = (value, limit) => {
  const formattedValue = formatMb(value);
  const formattedLimit = formatMb(limit);
  if (formattedValue === MISSING_VALUE && formattedLimit === MISSING_VALUE) {
    return MISSING_VALUE;
  }
  if (formattedLimit === MISSING_VALUE) return formattedValue;
  if (formattedValue === MISSING_VALUE) return `limit ${formattedLimit}`;
  return `${formattedValue} / ${formattedLimit} limit`;
};

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

const formatFreshnessAge = (value) => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp)
    ? `${formatDuration(Date.now() - timestamp)} ago`
    : MISSING_VALUE;
};

const severityTone = (severity) => {
  if (severity === "error") return "var(--ra-toast-error)";
  if (severity === "warning" || severity === "unknown" || severity === "degraded") return "var(--ra-toast-warning)";
  if (severity === "success") return "var(--ra-toast-success)";
  return "var(--ra-toast-info)";
};

const severityBorder = (severity) =>
  `color-mix(in srgb, ${severityTone(severity)} 40%, transparent)`;

const alertToneBackground = (severity) => cssColorAlpha(severityTone(severity), "0d");
const alertToneHoverBackground = (severity) => cssColorAlpha(severityTone(severity), "12");

const statusLabel = (value) =>
  value === "down"
    ? "DOWN"
    : value === "degraded"
      ? "DEGRADED"
      : value === "ok"
        ? "OK"
        : "UNKNOWN";

const providerStatusLabel = (value) => {
  const status = String(value || "").toLowerCase();
  if (status === "ok") return "OK";
  if (status === "degraded") return "DEGRADED";
  if (status === "unconfigured") return "NOT CONFIGURED";
  if (status === "idle") return "IDLE";
  return "UNKNOWN";
};

const providerStatusTone = (value) => {
  const status = String(value || "").toLowerCase();
  if (status === "ok") return CSS_COLOR.green;
  if (status === "degraded") return CSS_COLOR.amber;
  if (status === "unconfigured") return CSS_COLOR.textDim;
  return CSS_COLOR.textSec;
};

const SNAPTRADE_BROKER_LABELS = Object.freeze({
  ETRADE: "E*TRADE",
  "INTERACTIVE-BROKERS-FLEX": "Interactive Brokers",
  "ALPACA-PAPER": "Alpaca Paper",
});

const safeRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const arrayOrEmpty = (value) => (Array.isArray(value) ? value : []);

const formatList = (values) => {
  const list = arrayOrEmpty(values)
    .map((value) => String(value).trim())
    .filter(Boolean);
  return list.length ? list.join(", ") : MISSING_VALUE;
};

const brokerConnectionTone = (status) => {
  const value = String(status || "").toLowerCase();
  if (value === "connected") return CSS_COLOR.green;
  if (value === "configured") return CSS_COLOR.amber;
  if (value === "error") return CSS_COLOR.red;
  if (value === "disconnected") return CSS_COLOR.red;
  return CSS_COLOR.textDim;
};

const brokerConnectionSeverity = (connections, fallbackSeverity) => {
  if (!connections.length) return fallbackSeverity;
  if (connections.some((connection) => connection.status === "error")) return "error";
  if (connections.some((connection) => connection.status === "configured")) return "warning";
  if (connections.some((connection) => connection.status === "connected")) return "success";
  return fallbackSeverity;
};

const brokerLabelFromSlug = (slug) => {
  const value = String(slug || "").trim().toUpperCase();
  if (!value) return "";
  if (SNAPTRADE_BROKER_LABELS[value]) return SNAPTRADE_BROKER_LABELS[value];
  return value
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const brokerConnectionLabel = (connection) =>
  brokerLabelFromSlug(connection?.brokerageSlug) ||
  String(connection?.displayName || connection?.name || connection?.id || "Broker");

const snapTradeBrokerConnections = (connections) =>
  arrayOrEmpty(connections)
    .map((connection) => safeRecord(connection))
    .filter(
      (connection) =>
        connection.provider === "snaptrade" && connection.status !== "disconnected",
    )
    .sort((a, b) =>
      brokerConnectionLabel(a).localeCompare(brokerConnectionLabel(b)),
    );

const formatMassiveRequestSummary = (request) => {
  const record = safeRecord(request);
  const purpose = String(record.purpose || record.endpointFamily || "")
    .replace(/[-_]+/g, " ")
    .trim();
  const symbol = record.symbol ? ` ${record.symbol}` : "";
  const timeframe = record.timeframe ? ` ${record.timeframe}` : "";
  if (!purpose && !symbol && !timeframe) {
    return MISSING_VALUE;
  }
  return `${purpose}${symbol}${timeframe}`.trim();
};

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
  if (isPyrusSafeQaMode()) {
    return;
  }
  recordClientDiagnosticEvent(input).catch(() => {});
}

function postClientMetrics(input) {
  if (isPyrusSafeQaMode()) {
    return Promise.resolve();
  }
  return fetch("/api/diagnostics/client-metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Client metrics post failed (${response.status})`);
    }
  });
}

const formatDiagnosticAsyncError = (error) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Unknown error";
};

const JsonBlock = ({ value }) => (
  <pre
    style={{
      margin: 0,
      maxHeight: dim(300),
      overflow: "auto",
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      color: CSS_COLOR.textSec,
      whiteSpace: "pre-wrap",
      lineHeight: 1.45,
    }}
  >
    {JSON.stringify(value || {}, null, 2)}
  </pre>
);

const Panel = ({ title, action, children }) => (
  <SurfacePanel title={title} action={action} compact>
    {children}
  </SurfacePanel>
);

const StateRow = ({ label, value, tone = CSS_COLOR.textSec, onClick }) => (
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
      borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 33)}`,
      background: "transparent",
      padding: sp("7px 0"),
      fontFamily: T.sans,
      fontSize: fs(10),
      cursor: onClick ? "pointer" : "default",
      textAlign: "left",
    }}
  >
    <span style={{ color: CSS_COLOR.textDim, minWidth: 0 }}>{label}</span>
    <span
      style={{
        color: tone,
        fontWeight: FONT_WEIGHTS.regular,
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

const MetricCard = ({ label, value, sub, severity = "info", onClick, failurePoint }) => {
  const showFailurePoint = failurePoint && failurePoint.severity !== "info";
  return (
    <button
      type="button"
      className={onClick ? "ra-interactive" : undefined}
      onClick={onClick}
      style={{
        ...motionVars({ accent: severityTone(severity) }),
        border: `1px solid ${severityBorder(severity)}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg1,
        padding: 0,
        display: "flex",
        flex: "1 0 auto",
        minWidth: dim(140),
        alignSelf: "start",
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
      }}
    >
      <StatTile
        label={label}
        value={value ?? MISSING_VALUE}
        sub={sub || MISSING_VALUE}
        tone={severityTone(severity)}
        minWidth={140}
        info={
          showFailurePoint ? (
            <FailurePointInlineIcon point={failurePoint} side="bottom" size={12} />
          ) : null
        }
      />
    </button>
  );
};

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
      <DataUnavailableState
        title="No samples"
        detail="No samples recorded in the selected window."
        standby
      />
    );
  }
  const values = data.map((point) => point.value);
  const width = 320;
  const height = 78;
  if (values.length < 2) {
    return (
      <DataUnavailableState
        title="Collecting samples"
        detail="Waiting for more samples to plot a trend."
        loading
      />
    );
  }
  const tone = data.some((point) => point.severity === "warning")
    ? CSS_COLOR.amber
    : CSS_COLOR.green;
  return (
    <MicroSparkline
      data={values}
      color={tone}
      width={width}
      height={height}
      className="ra-sparkline"
      ariaLabel={`${subsystem} ${metricKey} trend`}
      style={{ width: "100%", height, "--ra-spark-length": "360" }}
    />
  );
};

const EventList = ({ events, onSelect }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: sp(8) }}>
    {events.length ? (
      events.map((event, index) => {
        const failurePoint = buildFailurePointFromDiagnosticEvent(event);
        return (
          <button
            key={event.id || event.incidentKey}
            type="button"
            className={joinMotionClasses("ra-row-enter", "ra-interactive")}
            onClick={() => onSelect(event)}
            style={{
              ...motionRowStyle(index, 16, 160),
              ...motionVars({ accent: severityTone(event.severity) }),
              border: `1px solid ${CSS_COLOR.borderLight}`,
              background: alertToneBackground(event.severity),
              borderRadius: dim(RADII.xs),
              padding: sp("5px 6px"),
              display: "grid",
              gridTemplateColumns: `auto ${dim(74)}px minmax(0, 1fr) ${dim(60)}px`,
              gap: sp(6),
              alignItems: "center",
              textAlign: "left",
              cursor: "pointer",
              transition: "background var(--ra-motion-fast) ease, border-color var(--ra-motion-fast) ease",
            }}
            onMouseEnter={(pointerEvent) => {
              pointerEvent.currentTarget.style.background = alertToneHoverBackground(event.severity);
              pointerEvent.currentTarget.style.borderColor = severityBorder(event.severity);
            }}
            onMouseLeave={(pointerEvent) => {
              pointerEvent.currentTarget.style.background = alertToneBackground(event.severity);
              pointerEvent.currentTarget.style.borderColor = CSS_COLOR.borderLight;
            }}
          >
            <SeverityRail tone={severityTone(event.severity)} />
            <FailurePointTooltip point={failurePoint} side="right" align="start" compact>
              <Badge color={severityTone(event.severity)}>
                {event.severity}
              </Badge>
            </FailurePointTooltip>
            <span style={{ minWidth: 0 }}>
              <div style={{ color: CSS_COLOR.text, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.medium, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                {event.message}
              </div>
              <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption"), fontFamily: T.sans }}>
                {event.subsystem} / {event.category} / {event.code || "no-code"}
              </div>
            </span>
            <span style={{ color: CSS_COLOR.textSec, fontFamily: T.sans, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.medium, textAlign: "right" }}>
              x{event.eventCount}
            </span>
          </button>
        );
      })
    ) : (
      <DataUnavailableState
        title="No events"
        detail="No diagnostic events in this window."
      />
    )}
  </div>
);

const LocalAlertRow = ({ alert, onSelect, onDismiss }) => {
  const failurePoint = buildFailurePointFromDiagnosticEvent(alert);
  return (
    <div
      className={joinMotionClasses("ra-row-enter", "ra-focus-rail")}
      style={{
        ...motionVars({ accent: severityTone(alert.severity) }),
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        gap: sp(6),
        alignItems: "center",
        border: `1px solid ${CSS_COLOR.borderLight}`,
        background: alertToneBackground(alert.severity),
        borderRadius: dim(RADII.xs),
        padding: sp("5px 6px"),
      }}
    >
      <SeverityRail tone={severityTone(alert.severity)} />
      <button
        type="button"
        onClick={() => onSelect(alert)}
        style={{
          border: 0,
          background: "transparent",
          color: CSS_COLOR.text,
          display: "grid",
          gridTemplateColumns: `${dim(74)}px minmax(0, 1fr) ${dim(48)}px`,
          gap: sp(6),
          alignItems: "center",
          minWidth: 0,
          padding: 0,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <FailurePointTooltip point={failurePoint} side="right" align="start" compact>
          <Badge color={severityTone(alert.severity)}>
            {alert.severity}
          </Badge>
        </FailurePointTooltip>
        <span style={{ minWidth: 0 }}>
          <div style={{ color: CSS_COLOR.text, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.medium, whiteSpace: "normal", overflowWrap: "anywhere" }}>
            {alert.message}
          </div>
          <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("caption"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {alert.subsystem || "diagnostics"} / {alert.category || alert.kind} / {alert.code || alert.incidentKey}
          </div>
        </span>
        <span style={{ color: CSS_COLOR.textSec, fontFamily: T.sans, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.medium, textAlign: "right" }}>
          x{alert.repeatCount}
        </span>
      </button>
    <div style={{ display: "flex", alignItems: "center", gap: sp(6) }}>
      <span style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.medium, whiteSpace: "nowrap" }}>
        {formatAgo(alert.lastSeenAt)}
      </span>
      <Button variant="ghost" size="sm" onClick={() => onDismiss(alert)}>
        Dismiss
      </Button>
    </div>
    </div>
  );
};

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
    : { label: "Waiting", color: CSS_COLOR.textDim };

  return (
    <Panel
      title="Legacy Broker Runtime"
      action={
        <StatusPill
          color={health.color}
          glow={health.status && health.status !== "ready"}
        >
          {health.label}
        </StatusPill>
      }
    >
      <StateRow label="Bridge URL" value={ibkr.bridgeUrlConfigured ? "configured" : "missing"} tone={ibkr.bridgeUrlConfigured ? CSS_COLOR.green : CSS_COLOR.amber} />
      <StateRow label="Bridge token" value={ibkr.bridgeTokenConfigured ? "configured" : "missing"} tone={ibkr.bridgeTokenConfigured ? CSS_COLOR.green : CSS_COLOR.amber} />
      <StateRow label="Runtime override" value={ibkr.runtimeOverrideActive ? "active" : "env"} tone={ibkr.runtimeOverrideActive ? CSS_COLOR.green : CSS_COLOR.textSec} />
      <StateRow label="Legacy env" value={ibkr.legacyIbkrEnvPresent ? "present" : "clear"} tone={ibkr.legacyIbkrEnvPresent ? CSS_COLOR.amber : CSS_COLOR.green} />
      <StateRow label="Bridge HTTP" value={metrics.reachable ? "reachable" : "offline"} tone={metrics.reachable ? CSS_COLOR.green : CSS_COLOR.red} />
      <StateRow label="Health current" value={metrics.healthFresh == null ? MISSING_VALUE : metrics.healthFresh ? "yes" : "pending"} tone={metrics.healthFresh ? CSS_COLOR.green : metrics.healthFresh === false ? CSS_COLOR.amber : CSS_COLOR.textDim} />
      <StateRow label="Health age" value={formatMs(metrics.healthAgeMs)} tone={(metrics.healthAgeMs ?? 0) > 10_000 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
      <StateRow label="Gateway socket" value={metrics.connected ? "connected" : "disconnected"} tone={metrics.connected ? CSS_COLOR.green : CSS_COLOR.red} />
      <StateRow label="Authenticated" value={metrics.authenticated ? "yes" : "no"} tone={metrics.authenticated ? CSS_COLOR.green : CSS_COLOR.red} />
      <StateRow label="Competing client" value={metrics.competing ? "yes" : "no"} tone={metrics.competing ? CSS_COLOR.red : CSS_COLOR.green} />
      <StateRow label="Target" value={ibkr.connectionTarget} />
      <StateRow label="Client ID" value={ibkr.clientId} />
      <StateRow label="Heartbeat age" value={formatMs(metrics.heartbeatAgeMs)} tone={(metrics.heartbeatAgeMs ?? 0) > 30_000 ? CSS_COLOR.amber : CSS_COLOR.textSec} onClick={() => onMetric("ibkr", "ibkr.heartbeat_age_ms")} />
      <StateRow label="Selected account" value={maskIbkrAccountId(ibkr.selectedAccountId)} />
      <StateRow label="Session mode" value={ibkr.sessionMode} />
      <StateRow label="Market data" value={ibkr.marketDataMode} />
      <StateRow label="Live mode" value={metrics.liveMarketDataAvailable == null ? MISSING_VALUE : metrics.liveMarketDataAvailable ? "yes" : "no"} tone={metrics.liveMarketDataAvailable ? CSS_COLOR.textSec : metrics.liveMarketDataAvailable === false ? CSS_COLOR.amber : CSS_COLOR.textDim} />
      <StateRow label="Stream current" value={metrics.streamFresh == null ? MISSING_VALUE : metrics.streamFresh ? "yes" : "pending"} tone={metrics.streamFresh ? CSS_COLOR.green : metrics.streamFresh === false ? CSS_COLOR.amber : CSS_COLOR.textDim} />
      <StateRow label="Stream age" value={formatMs(metrics.lastStreamEventAgeMs)} tone={(metrics.lastStreamEventAgeMs ?? 0) > 10_000 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
      <StateRow label="Strict ready" value={metrics.strictReady == null ? MISSING_VALUE : metrics.strictReady ? "yes" : "no"} tone={metrics.strictReady ? CSS_COLOR.green : metrics.strictReady === false ? CSS_COLOR.amber : CSS_COLOR.textDim} />
      <StateRow label="Ready reason" value={metrics.strictReason} tone={metrics.strictReason ? CSS_COLOR.amber : CSS_COLOR.textSec} />
      <StateRow label="Bridge->API p95" value={formatMs(latencyStats.bridgeToApiMs?.p95)} />
      <StateRow label="API->React p95" value={formatMs(latencyStats.apiToReactMs?.p95)} />
      <StateRow label="Total p95" value={formatMs(latencyStats.totalMs?.p95)} />
      <StateRow label="Last error" value={ibkr.lastError || ibkr.healthError || ibkr.lastRecoveryError} tone={ibkr.lastError || ibkr.healthError || ibkr.lastRecoveryError ? CSS_COLOR.red : CSS_COLOR.textSec} />
      <StateRow label="Health detail" value={ibkr.healthErrorDetail} tone={ibkr.healthErrorDetail ? CSS_COLOR.red : CSS_COLOR.textSec} />
    </Panel>
  );
}

function BrokerConnectionsPanel({
  connections = [],
  isError = false,
  isLoading = false,
}) {
  const rows = snapTradeBrokerConnections(connections);
  const actionTone = isError
    ? CSS_COLOR.red
    : isLoading
      ? CSS_COLOR.textDim
      : rows.length
        ? CSS_COLOR.green
        : CSS_COLOR.amber;
  return (
    <Panel
      title="SnapTrade Brokers"
      action={
        <span
          style={{
            color: actionTone,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.regular,
          }}
        >
          {isError ? "Unavailable" : isLoading ? "Checking" : `${formatCount(rows.length)} active`}
        </span>
      }
    >
      {rows.length ? (
        rows.map((connection) => {
          const capabilities = arrayOrEmpty(connection.capabilities);
          return (
            <StateRow
              key={connection.id || connection.brokerageSlug || connection.name}
              label={brokerConnectionLabel(connection)}
              value={[
                connection.status || MISSING_VALUE,
                connection.mode,
                capabilities.includes("execution-ready") ? "execution-ready" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              tone={brokerConnectionTone(connection.status)}
            />
          );
        })
      ) : (
        <StateRow
          label="SnapTrade brokers"
          value={isLoading ? "checking" : isError ? "unavailable" : "none connected"}
          tone={isError ? CSS_COLOR.red : CSS_COLOR.amber}
        />
      )}
    </Panel>
  );
}

export default function DiagnosticsScreen({
  isVisible = false,
  onReadinessChange,
} = {}) {
  const [diagnosticsRootRef, diagnosticsRootSize] = useElementSize();
  const { isPhone: diagnosticsIsPhone, isNarrow: diagnosticsIsNarrow } =
    responsiveFlags(diagnosticsRootSize.width);
  const { preferences: userPreferences } = useUserPreferences();
  const notificationPreferences = userPreferences.notifications;
  const [activeTab, setActiveTab] = useState("Overview");
  const diagnosticsVisible = Boolean(isVisible);
  const overviewTabActive = diagnosticsVisible && activeTab === "Overview";
  const brokerTabActive = diagnosticsVisible && activeTab === "Broker";
  const marketDataTabActive = diagnosticsVisible && activeTab === "Market Data";
  const apiTabActive = diagnosticsVisible && activeTab === "API";
  const browserTabActive = diagnosticsVisible && activeTab === "Browser";
  const memoryTabActive = diagnosticsVisible && activeTab === "Memory";
  const ordersAccountsTabActive =
    diagnosticsVisible && activeTab === "Orders/Accounts";
  const eventsTabActive = diagnosticsVisible && activeTab === "Events";
  const optionHydrationDiagnosticsActive =
    overviewTabActive || marketDataTabActive;
  const chartDiagnosticsActive =
    overviewTabActive || marketDataTabActive || browserTabActive;
  const ibkrDiagnosticsActive = overviewTabActive || brokerTabActive;
  const workloadDiagnosticsActive =
    overviewTabActive || apiTabActive || browserTabActive;
  const memoryDiagnosticsActive =
    overviewTabActive || browserTabActive || memoryTabActive;
  const hydrationCoordinatorDiagnosticsActive =
    overviewTabActive || marketDataTabActive;
  const runtimeDiagnosticsActive =
    overviewTabActive ||
    brokerTabActive ||
    marketDataTabActive ||
    apiTabActive ||
    browserTabActive ||
    memoryTabActive ||
    ordersAccountsTabActive;
  const browserMetricsCollectionActive =
    overviewTabActive || browserTabActive || memoryTabActive;
  const { state, metrics, history } = useOptionHydrationDiagnostics(
    optionHydrationDiagnosticsActive,
  );
  const chartStats = useChartHydrationStats(chartDiagnosticsActive);
  const latencyStats = useIbkrLatencyStats(ibkrDiagnosticsActive);
  const workloadStats = useRuntimeWorkloadStats(workloadDiagnosticsActive);
  const memoryPressureState = useMemoryPressureSnapshot(memoryDiagnosticsActive);
  const hydrationCoordinatorStats = useHydrationCoordinatorStats(
    hydrationCoordinatorDiagnosticsActive,
  );
  const brokerConnectionsQuery = useListBrokerConnections({
    query: {
      enabled: overviewTabActive || brokerTabActive,
      retry: false,
      staleTime: 30_000,
    },
  });
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [latest, setLatest] = useState(null);
  const [historyData, setHistoryData] = useState({ points: [], snapshots: [] });
  const [events, setEvents] = useState([]);
  const [historyEventsRefreshError, setHistoryEventsRefreshError] = useState(null);
  const [browserMetricsPostError, setBrowserMetricsPostError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventDetail, setEventDetail] = useState(null);
  const [streamState, setStreamState] = useState("connecting");
  const [alertsByKey, setAlertsByKey] = useState({});
  const [alertPreferences, setAlertPreferences] = useState(readLocalAlertPreferences);
  const audioContextRef = useRef(null);
  const alertsRef = useRef({});
  const diagnosticsOpenLoggedRef = useRef(false);
  const historyEventsRefreshGenerationRef = useRef(0);
  const browserMetricsInFlightRef = useRef(false);
  useEffect(() => {
    onReadinessChange?.({
      contentReady: diagnosticsVisible,
      primaryReady: diagnosticsVisible,
      derivedReady: diagnosticsVisible,
      backgroundAllowed: diagnosticsVisible,
    });
  }, [diagnosticsVisible, onReadinessChange]);
  const browserMetricsInputRef = useRef({
    workloadStats,
    hydrationCoordinatorStats,
    chartStats,
    optionState: state,
    memoryPressureState,
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
      memoryPressureState,
    };
  }, [chartStats, hydrationCoordinatorStats, memoryPressureState, state, workloadStats]);

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
    window.addEventListener(LOCAL_ALERT_PREFERENCES_EVENT, listener);
    return () => {
      window.removeEventListener(LOCAL_ALERT_PREFERENCES_EVENT, listener);
    };
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
      oscillator.frequency.value = severity === "warning" ? 520 : 440;
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
    const notification = result.notifications[0];
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
    const generation = historyEventsRefreshGenerationRef.current + 1;
    historyEventsRefreshGenerationRef.current = generation;
    const params = {
      from: timeWindow.from.toISOString(),
      to: timeWindow.to.toISOString(),
      limit: 240,
    };
    Promise.allSettled([
      listDiagnosticHistory(params),
      listDiagnosticEvents(params),
    ]).then(([historyResult, eventsResult]) => {
      if (generation !== historyEventsRefreshGenerationRef.current) {
        return;
      }

      const failures = [];
      if (historyResult.status === "fulfilled") {
        setHistoryData(historyResult.value);
      } else {
        failures.push(`History: ${formatDiagnosticAsyncError(historyResult.reason)}`);
      }

      if (eventsResult.status === "fulfilled") {
        setEvents(eventsResult.value.events || []);
      } else {
        failures.push(`Events: ${formatDiagnosticAsyncError(eventsResult.reason)}`);
      }

      setHistoryEventsRefreshError(failures.length ? failures.join(" / ") : null);
    });
  }, [timeWindow.from, timeWindow.to]);

  useEffect(() => {
    if (!eventsTabActive) {
      return undefined;
    }

    loadHistoryAndEvents();
    const interval = window.setInterval(loadHistoryAndEvents, 60_000);
    return () => window.clearInterval(interval);
  }, [eventsTabActive, loadHistoryAndEvents]);

  useEffect(() => {
    if (!isVisible) {
      diagnosticsOpenLoggedRef.current = false;
    }
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || diagnosticsOpenLoggedRef.current) {
      return;
    }

    diagnosticsOpenLoggedRef.current = true;
    postClientEvent({
      category: "diagnostics-page",
      severity: "info",
      message: "Diagnostics page opened",
      raw: { userAgent: navigator.userAgent },
    });
  }, [isVisible]);

  useEffect(() => {
    if (!browserMetricsCollectionActive) {
      return undefined;
    }

    let cancelled = false;
    const collect = () => {
      if (browserMetricsInFlightRef.current) {
        return;
      }

      browserMetricsInFlightRef.current = true;
      collectBrowserResourceMetrics(browserMetricsInputRef.current).then((payload) => {
        if (!cancelled) {
          return postClientMetrics(payload);
        }
        return undefined;
      }).then(() => {
        if (!cancelled) {
          setBrowserMetricsPostError(null);
        }
      }).catch((error) => {
        if (!cancelled) {
          const message = formatDiagnosticAsyncError(error);
          setBrowserMetricsPostError(message);
          postClientEvent({
            category: "diagnostics-client-metrics",
            severity: "warning",
            message: "Browser metrics refresh failed",
            raw: { error: message },
          });
        }
      }).finally(() => {
        browserMetricsInFlightRef.current = false;
      });
    };
    collect();
    const interval = window.setInterval(collect, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [browserMetricsCollectionActive]);

  useEffect(() => {
    if (!isVisible) {
      setStreamState("paused");
      return undefined;
    }

    if (typeof window.EventSource === "undefined") {
      setStreamState("polling");
      const poll = () => {
        getLatestDiagnostics()
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
  }, [isVisible, syncLocalAlertsFromSnapshot, updateLocalAlerts]);

  useEffect(() => {
    if (!eventsTabActive || !selectedEvent) {
      setEventDetail(null);
      return;
    }
    getDiagnosticEventDetail(selectedEvent.id || selectedEvent.incidentKey)
      .then((payload) => setEventDetail(payload))
      .catch(() => setEventDetail(null));
  }, [eventsTabActive, selectedEvent]);

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
  const brokerConnections = brokerConnectionsQuery.data?.connections || [];
  const brokerRows = snapTradeBrokerConnections(brokerConnections);
  const connectedBrokerCount = brokerRows.filter(
    (connection) => connection.status === "connected",
  ).length;
  const brokerOverviewValue = brokerRows.length
    ? `${formatCount(connectedBrokerCount)}/${formatCount(brokerRows.length)}`
    : formatMs(ibkrMetrics.heartbeatAgeMs);
  const brokerOverviewSub = brokerRows.length
    ? "SnapTrade brokers connected"
    : ibkrMetrics.connected
      ? "connected"
      : "disconnected";
  const brokerOverviewSeverity = brokerConnectionSeverity(
    brokerRows,
    ibkrSnapshot?.severity,
  );
  const marketDataMetrics = safeRecord(marketDataSnapshot?.metrics);
  const marketDataRaw = safeRecord(marketDataSnapshot?.raw);
  const massiveDiagnostics = safeRecord(marketDataRaw.massive);
  const massiveRest = safeRecord(massiveDiagnostics.rest);
  const massiveLastRequest = safeRecord(massiveRest.lastRequest);
  const massiveWebSocket = safeRecord(massiveDiagnostics.websocket);
  const massiveWebSocketFeeds = arrayOrEmpty(massiveWebSocket.feeds);
  const marketDataWorkPlan = safeRecord(
    latest?.marketDataWorkPlan || marketDataRaw.marketDataWorkPlan,
  );
  const marketDataWorkPlanSummary = safeRecord(marketDataWorkPlan.summary);
  const hasMassiveOptionSummary =
    marketDataWorkPlanSummary.massiveOptionLineCount != null ||
    marketDataWorkPlanSummary.massiveOptionSymbolCount != null;
  const plannerMassiveOptionLineCount = hasMassiveOptionSummary
    ? marketDataWorkPlanSummary.massiveOptionLineCount
    : marketDataWorkPlanSummary.ibkrOptionLineCount;
  const plannerMassiveOptionSymbolCount = hasMassiveOptionSummary
    ? marketDataWorkPlanSummary.massiveOptionSymbolCount
    : marketDataWorkPlanSummary.ibkrOptionSymbolCount;
  const plannerIbkrOptionLineCount = marketDataWorkPlanSummary.ibkrOptionLineCount ?? 0;
  const plannerIbkrOptionSymbolCount = marketDataWorkPlanSummary.ibkrOptionSymbolCount ?? 0;
  const persistClaimableQueuedJobCount =
    marketDataWorkPlanSummary.persistClaimableQueuedJobCount ?? 0;
  const persistWorkerInactive = Boolean(
    marketDataWorkPlanSummary.persistWorkerInactive,
  );
  const marketDataWorkPlanScanner = safeRecord(marketDataWorkPlan.scanner);
  const marketDataWorkPlanMemory = safeRecord(marketDataWorkPlan.memoryAction);
  const browserMetrics = safeRecord(browserSnapshot?.metrics);
  const chartHydrationMetrics = safeRecord(chartHydrationSnapshot?.metrics);
  const resourcePressureMetrics = safeRecord(resourcePressureSnapshot?.metrics);
  const footerMemoryMetrics = latest?.footerMemoryPressure || null;
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
  const runtimeIbkr = safeRecord(ibkrSnapshot?.raw);
  const runtimeControl = useRuntimeControlSnapshot({
    enabled: runtimeDiagnosticsActive,
    runtimeDiagnostics: runtimeIbkr ? { ibkr: runtimeIbkr } : null,
    runtimeDiagnosticsEnabled: false,
    workloadStats,
    hydrationStats: hydrationCoordinatorStats,
    memoryPressure: memoryPressureState,
  });
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
  const footerSignal = useMemo(
    () => ({
      level:
        memoryPressureState?.level ||
        footerMemoryMetrics?.level ||
        "normal",
      trend:
        memoryPressureState?.trend ||
        footerMemoryMetrics?.trend ||
        resourcePressureMetrics.clientPressureTrend ||
        "steady",
      sourceQuality:
        memoryPressureState?.sourceQuality ||
        footerMemoryMetrics?.sourceQuality ||
        resourcePressureMetrics.sourceQuality ||
        MISSING_VALUE,
      browserMemoryMb:
        memoryPressureState?.browserMemoryMb ??
        footerMemoryMetrics?.browserMemoryMb ??
        resourcePressureMetrics.browserMemoryMb,
      browserMemoryLimitMb:
        memoryPressureState?.browserMemoryLimitMb ??
        footerMemoryMetrics?.browserMemoryLimitMb ??
        resourcePressureMetrics.browserMemoryLimitMb,
      apiHeapUsedPercent:
        memoryPressureState?.apiHeapUsedPercent ??
        footerMemoryMetrics?.apiHeapUsedPercent ??
        resourcePressureMetrics.heapUsedPercent,
      dominantDrivers:
        memoryPressureState?.dominantDrivers?.length
          ? memoryPressureState.dominantDrivers
          : Array.isArray(footerMemoryMetrics?.dominantDrivers)
            ? footerMemoryMetrics.dominantDrivers
            : [],
      observedAt:
        memoryPressureState?.observedAt ||
        footerMemoryMetrics?.observedAt ||
        resourcePressureMetrics.browserObservedAt ||
        null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resourcePressureMetrics derives from resourcePressureSnapshot
    [memoryPressureState, footerMemoryMetrics, resourcePressureSnapshot],
  );
  const memoryOverviewSeverity =
    footerSignal.level === "high" || footerSignal.level === "watch"
      ? "warning"
      : "info";
  // Coarse ticker so snapshot-age decay stays live after the SSE stream dies;
  // one tick per collector interval is enough granularity for the decay tiers.
  const [machineNowMs, setMachineNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!overviewTabActive) return undefined;
    setMachineNowMs(Date.now());
    const interval = window.setInterval(
      () => setMachineNowMs(Date.now()),
      DIAGNOSTICS_COLLECTION_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [overviewTabActive]);
  // GEX lane sensor: the client-side React Query cache state of the gex
  // feature's fetches, sampled on the same coarse ticker as decay.
  const queryClient = useQueryClient();
  const gexClientState = useMemo(() => {
    if (!overviewTabActive) return null;
    const queries = queryClient
      .getQueryCache()
      .findAll()
      .filter((query) =>
        GEX_QUERY_KEY_PREFIXES.includes(String(query.queryKey?.[0] ?? "")),
      );
    return {
      queryCount: queries.length,
      isFetching: queries.some((query) => query.state.fetchStatus === "fetching"),
      hasError: queries.some((query) => query.state.status === "error"),
      lastUpdatedAt: queries.reduce(
        (latestAt, query) => Math.max(latestAt, query.state.dataUpdatedAt || 0),
        0,
      ) || null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- machineNowMs is the sampling tick
  }, [overviewTabActive, machineNowMs, queryClient]);
  const machineStateModel = useMemo(
    () =>
      overviewTabActive
        ? buildMachineStateDiagramModel({
            latest,
            streamState,
            runtimeControl,
            brokerConnections: brokerConnectionsQuery.data?.connections,
            footerSignal,
            memoryPressureState,
            gexClientState,
            nowMs: machineNowMs,
          })
        : null,
    [
      overviewTabActive,
      latest,
      streamState,
      runtimeControl,
      brokerConnectionsQuery.data,
      footerSignal,
      memoryPressureState,
      gexClientState,
      machineNowMs,
    ],
  );

  const selectMetric = (subsystem, metricKey) => {
    setActiveTab("Events");
    const params = {
      from: timeWindow.from.toISOString(),
      to: timeWindow.to.toISOString(),
      subsystem,
    };
    listDiagnosticEvents(params)
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

  const activeAlertsPanel =
    activeLocalAlerts.length > 0 || dismissedLocalAlerts.length > 0 ? (
      <Panel
        title="Active Alerts"
        action={
          <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setAlertPreferences((current) => ({
                  ...current,
                  audioEnabled: !current.audioEnabled,
                }))
              }
            >
              {audioEnabled ? "Audio On" : "Audio Off"}
            </Button>
            {AUDIO_SNOOZE_OPTIONS.map((option) => (
              <Button
                key={option.label}
                variant="ghost"
                size="sm"
                onClick={() => setAudioMutedUntilPreference(option.ms === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : Date.now() + option.ms)}
              >
                Snooze {option.label}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setAudioMutedUntilPreference(0)}>
              Unsnooze
            </Button>
            {activeLocalAlerts.length > 0 && (
              <Button variant="ghost" size="sm" onClick={dismissAllVisibleAlerts}>
                Dismiss all
              </Button>
            )}
            {dismissedLocalAlerts.length > 0 && (
              <Button variant="ghost" size="sm" onClick={restoreDismissedAlerts}>
                Restore
              </Button>
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
            <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("caption") }}>
              {activeLocalAlerts.length - 8} more grouped alerts
            </div>
          )}
          {dismissedLocalAlerts.length > 0 && (
            <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("caption") }}>
              {dismissedLocalAlerts.length} dismissed active alert{dismissedLocalAlerts.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
      </Panel>
    ) : null;

  return (
    <div
      ref={diagnosticsRootRef}
      data-testid="diagnostics-screen"
      data-layout={diagnosticsIsPhone ? "phone" : diagnosticsIsNarrow ? "tablet" : "desktop"}
      style={{
        height: "100%",
        width: "100%",
        overflow: "auto",
        background: CSS_COLOR.bg0,
        color: CSS_COLOR.text,
        padding: sp(diagnosticsIsPhone ? "8px 10px 18px" : "20px 28px"),
        fontFamily: T.sans,
        minWidth: 0,
        WebkitOverflowScrolling: diagnosticsIsPhone ? "touch" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: diagnosticsIsPhone ? "space-between" : "flex-end",
          gap: sp(8),
          flexWrap: "wrap",
          minWidth: 0,
          marginBottom: sp(diagnosticsIsPhone ? 8 : 0),
        }}
      >
        {latest?.status === "degraded" || latest?.status === "down" ? (
          (() => {
            const bandTone =
              latest?.status === "down" ? CSS_COLOR.red : providerStatusTone("degraded");
            return (
              <div
                style={{
                  flex: "1 1 100%",
                  display: "flex",
                  alignItems: "center",
                  gap: sp(8),
                  padding: sp("6px 10px"),
                  borderRadius: dim(RADII.sm),
                  border: `1px solid ${cssColorAlpha(bandTone, "40")}`,
                  background: cssColorAlpha(bandTone, "14"),
                  color: CSS_COLOR.text,
                  fontFamily: T.sans,
                  fontSize: fs(11),
                  fontWeight: FONT_WEIGHTS.medium,
                }}
              >
                <StatusPill
                  color={bandTone}
                  variant="ghost"
                  glow={latest?.status === "down"}
                >
                  {statusLabel(latest?.status)}
                </StatusPill>
              </div>
            );
          })()
        ) : (
          <StatusPill color={severityTone(topSeverity)} dot={false}>
            {statusLabel(latest?.status)}
          </StatusPill>
        )}
        <span role="status" aria-live="polite" style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: fs(10) }}>
          {streamState.toUpperCase()} / {latest?.timestamp ? formatAgo(latest.timestamp) : "waiting"}
        </span>
        {WINDOW_OPTIONS.map((option) => {
          const active = windowMinutes === option.minutes;
          return (
            <Button
              key={option.label}
              variant={active ? "primary" : "secondary"}
              size="sm"
              onClick={() => setWindowMinutes(option.minutes)}
            >
              {option.label}
            </Button>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.open(exportUrl, "_blank", "noopener,noreferrer")}
        >
          Export Raw
        </Button>
      </div>

      <div
        className="ra-hide-scrollbar"
        style={{
          display: "flex",
          gap: sp(6),
          flexWrap: diagnosticsIsPhone ? "nowrap" : "wrap",
          overflowX: diagnosticsIsPhone ? "auto" : undefined,
          marginBottom: sp(12),
          paddingBottom: diagnosticsIsPhone ? sp(2) : undefined,
          minWidth: 0,
        }}
      >
        <SegmentedControl
          options={TABS}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel="Diagnostics sections"
          buttonTestId={(tab) =>
            `diagnostics-tab-${tab.toLowerCase().replace(/\s+/g, "-")}`
          }
        />
      </div>

      {activeTab !== "Overview" && activeAlertsPanel}

      {activeTab === "Overview" && (
        <>
          <MachineStateDiagram model={machineStateModel} />
          {activeAlertsPanel}
          <div className="ra-hide-scrollbar" style={{ display: "flex", flexWrap: "nowrap", overflowX: "auto", gap: sp(8), margin: sp("10px 0"), minWidth: 0 }}>
            <MetricCard label="API p95" value={formatMs(apiMetrics.p95LatencyMs)} sub={`${formatCount(apiMetrics.requestCount5m)} req / 5m`} severity={apiSnapshot?.severity} failurePoint={buildFailurePointFromDiagnosticsSnapshot(apiSnapshot)} onClick={() => selectMetric("api", "api.p95_latency_ms")} />
            <MetricCard label="Broker health" value={brokerOverviewValue} sub={brokerOverviewSub} severity={brokerOverviewSeverity} failurePoint={buildFailurePointFromDiagnosticsSnapshot(ibkrSnapshot)} onClick={() => setActiveTab("Broker")} />
            <MetricCard label="Market freshness" value={formatMs(marketDataMetrics.freshnessAgeMs ?? stream.lastEventAgeMs)} sub={`${formatCount(marketDataMetrics.activeConsumerCount ?? stream.activeConsumerCount)} consumers`} severity={marketDataSnapshot?.severity || (stream.streamGapCount > 0 ? "warning" : "info")} failurePoint={buildFailurePointFromDiagnosticsSnapshot(marketDataSnapshot)} onClick={() => selectMetric("market-data", "market_data.freshness_age_ms")} />
            <MetricCard label="Chart hydration" value={formatMs(chartHydrationMetrics.prependP95Ms ?? chartStats.prependRequestMs?.p95)} sub={`${formatCount(chartHydrationMetrics.activeScopeCount ?? chartStats.activeScopeCount ?? chartStats.scopes.length)} scopes / ${formatCount(chartHydrationMetrics.cursorFallbackCount ?? 0)} fallbacks`} severity={chartHydrationSeverity} failurePoint={buildFailurePointFromDiagnosticsSnapshot(chartHydrationSnapshot)} onClick={() => selectMetric("chart-hydration", "chart_hydration.prepend_p95_ms")} />
            <MetricCard label="Browser events" value={formatCount(browserMetrics.warningCount5m ?? 0)} sub={`${formatCount(browserMetrics.eventCount5m ?? 0)} events / 5m`} severity={browserSnapshot?.severity} failurePoint={buildFailurePointFromDiagnosticsSnapshot(browserSnapshot)} onClick={() => selectMetric("browser", "browser.events")} />
            <MetricCard label="Memory" value={String(footerSignal.level || "normal").toUpperCase()} sub={`heap ${formatPercent(footerSignal.apiHeapUsedPercent)} / browser ${formatMbWithLimit(footerSignal.browserMemoryMb, footerSignal.browserMemoryLimitMb)}`} severity={memoryOverviewSeverity} failurePoint={buildMemoryPressureFailurePoint({ signal: footerSignal })} onClick={() => setActiveTab("Memory")} />
            <MetricCard label="Accounts" value={formatCount(accountMetrics.accountCount)} sub={`${formatCount(accountMetrics.positionCount)} positions`} severity={accountSnapshot?.severity} failurePoint={buildFailurePointFromDiagnosticsSnapshot(accountSnapshot)} onClick={() => selectMetric("accounts", "orders.visibility_failures")} />
            <MetricCard label="Orders" value={formatCount(orderMetrics.orderCount)} sub={`${formatCount(orderMetrics.visibilityFailures)} failures`} severity={orderSnapshot?.severity} failurePoint={buildFailurePointFromDiagnosticsSnapshot(orderSnapshot)} onClick={() => selectMetric("orders", "orders.visibility_failures")} />
            <MetricCard label="Storage" value={storageMetrics.reachable ? "reachable" : "offline"} sub={formatMs(storageMetrics.pingMs)} severity={storageSnapshot?.severity} failurePoint={buildFailurePointFromDiagnosticsSnapshot(storageSnapshot)} onClick={() => selectMetric("storage", "storage.ping_ms")} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(280)}px, 1fr))`, gap: sp(10), alignItems: "start" }}>
            <Panel title="API Latency Trend">
              <Sparkline points={historyData.points || []} subsystem="api" metricKey="p95LatencyMs" />
            </Panel>
            <Panel title="Broker Heartbeat Trend">
              <Sparkline points={historyData.points || []} subsystem="ibkr" metricKey="heartbeatAgeMs" />
            </Panel>
            <Panel title="Recent Events">
              <EventList events={events.slice(0, 5)} onSelect={setSelectedEvent} />
            </Panel>
          </div>
        </>
      )}

      {activeTab === "Broker" && (
        <div style={{ display: "grid", gap: sp(14) }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(280)}px, 1fr))`, gap: sp(14) }}>
            <BrokerConnectionsPanel
              connections={brokerConnections}
              isError={brokerConnectionsQuery.isError}
              isLoading={brokerConnectionsQuery.isLoading}
            />
            <GatewayPanel latest={latest} latencyStats={latencyStats} onMetric={selectMetric} />
            <Panel title="Account Realtime">
              <StateRow
                label="Account stream"
                value={runtimeControl.streams.account.fresh ? "fresh" : "pending"}
                tone={runtimeControl.streams.account.fresh ? CSS_COLOR.green : CSS_COLOR.amber}
              />
              <StateRow
                label="Account age"
                value={formatFreshnessAge(runtimeControl.streams.account.lastEventAt)}
              />
              <StateRow
                label="Order stream"
                value={runtimeControl.streams.order.fresh ? "fresh" : "pending"}
                tone={runtimeControl.streams.order.fresh ? CSS_COLOR.green : CSS_COLOR.amber}
              />
              <StateRow
                label="Order age"
                value={formatFreshnessAge(runtimeControl.streams.order.lastEventAt)}
              />
              <StateRow
                label="Trading freshness"
                value={
                  runtimeControl.streams.tradingFresh
                    ? "ready"
                    : "paused"
                }
                tone={
                  runtimeControl.streams.tradingFresh
                    ? CSS_COLOR.green
                    : CSS_COLOR.amber
                }
              />
            </Panel>
            <Panel title="Legacy Broker Runtime Snapshot">
              <JsonBlock value={ibkrSnapshot} />
            </Panel>
          </div>
        </div>
      )}

      {activeTab === "Market Data" && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(280)}px, 1fr))`, gap: sp(14) }}>
          <Panel title="Backend Quote Stream">
            <StateRow label="Consumers" value={formatCount(marketDataMetrics.activeConsumerCount)} />
            <StateRow label="Symbols" value={formatCount(marketDataMetrics.unionSymbolCount)} />
            <StateRow label="Cached quotes" value={formatCount(marketDataMetrics.cachedQuoteCount)} />
            <StateRow label="Events" value={formatCount(marketDataMetrics.eventCount)} />
            <StateRow label="Last event" value={marketDataMetrics.lastEventAgeMs == null ? MISSING_VALUE : `${formatMs(marketDataMetrics.lastEventAgeMs)} ago`} />
            <StateRow label="Freshness" value={formatMs(marketDataMetrics.freshnessAgeMs)} tone={marketDataMetrics.freshnessAgeMs > 2_000 ? CSS_COLOR.amber : CSS_COLOR.textSec} onClick={() => selectMetric("market-data", "market_data.freshness_age_ms")} />
            <StateRow label="Reconnects" value={formatCount(marketDataMetrics.reconnectCount)} tone={marketDataMetrics.reconnectCount > 0 ? CSS_COLOR.amber : CSS_COLOR.green} />
            <StateRow label="Active gap alert" value={formatMs(marketDataMetrics.streamGapMs ?? marketDataMetrics.stream_gap_ms)} tone={(marketDataMetrics.streamGapMs ?? marketDataMetrics.stream_gap_ms) > 5_000 ? CSS_COLOR.amber : CSS_COLOR.green} onClick={() => selectMetric("market-data", "market_data.stream_gap_ms")} />
            <StateRow label="Observed gaps" value={formatCount(marketDataMetrics.rawStreamGapCount ?? marketDataMetrics.streamGapCount)} tone={marketDataMetrics.recentGapCount > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
            <StateRow label="Recent gaps" value={formatCount(marketDataMetrics.recentGapCount)} tone={marketDataMetrics.recentGapCount > 0 ? CSS_COLOR.amber : CSS_COLOR.green} />
            <StateRow label="Last gap" value={marketDataMetrics.lastGapMs == null ? MISSING_VALUE : `${formatMs(marketDataMetrics.lastGapMs)} / ${formatMs(marketDataMetrics.lastGapAgeMs)} ago`} tone={marketDataMetrics.recentGapCount > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
            <StateRow label="Worst observed gap" value={formatMs(marketDataMetrics.rawMaxGapMs ?? marketDataMetrics.maxGapMs)} tone={marketDataMetrics.recentGapCount > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
            <StateRow label="Last error" value={marketDataMetrics.lastError} tone={marketDataMetrics.lastError ? CSS_COLOR.red : CSS_COLOR.textSec} />
          </Panel>
          <Panel title="Massive HTTP">
            <StateRow
              label="Status"
              value={providerStatusLabel(massiveRest.status)}
              tone={providerStatusTone(massiveRest.status)}
            />
            <StateRow label="Host" value={massiveDiagnostics.baseUrlHost || MISSING_VALUE} />
            <StateRow label="Last call" value={formatMassiveRequestSummary(massiveLastRequest)} />
            <StateRow label="Endpoint" value={massiveLastRequest.endpoint || MISSING_VALUE} />
            <StateRow label="Symbols" value={formatCount(massiveLastRequest.symbolCount)} />
            <StateRow label="Rows" value={formatCount(massiveLastRequest.resultCount)} />
            <StateRow label="Limit" value={formatCount(massiveLastRequest.limit)} />
            <StateRow label="Duration" value={formatMs(massiveLastRequest.durationMs)} />
            <StateRow label="Observed" value={massiveLastRequest.observedAt ? formatAgo(massiveLastRequest.observedAt) : MISSING_VALUE} />
            <StateRow label="Last error" value={massiveRest.lastError || MISSING_VALUE} tone={massiveRest.lastError ? CSS_COLOR.red : CSS_COLOR.textSec} />
          </Panel>
          <Panel title="Massive WebSocket">
            <StateRow
              label="Status"
              value={providerStatusLabel(massiveWebSocket.status)}
              tone={providerStatusTone(massiveWebSocket.status)}
            />
            <StateRow label="Mode" value={massiveWebSocket.mode || MISSING_VALUE} />
            <StateRow label="Active channels" value={formatList(massiveWebSocket.activeChannels)} />
            <StateRow label="Available channels" value={formatList(massiveWebSocket.availableChannels)} />
            <StateRow label="Subscribed symbols" value={formatCount(massiveWebSocket.subscribedSymbolCount)} />
            <StateRow label="Consumers" value={formatCount(massiveWebSocket.activeConsumerCount)} />
            <StateRow label="Events" value={formatCount(massiveWebSocket.eventCount)} />
            <StateRow label="Last message" value={massiveWebSocket.lastMessageAgeMs == null ? MISSING_VALUE : `${formatMs(massiveWebSocket.lastMessageAgeMs)} ago`} />
            <StateRow label="Reconnects" value={formatCount(massiveWebSocket.reconnectCount)} tone={(massiveWebSocket.reconnectCount ?? 0) > 0 ? CSS_COLOR.amber : CSS_COLOR.green} />
            {massiveWebSocketFeeds.slice(0, 2).map((feedValue, index) => {
              const feed = safeRecord(feedValue);
              return (
                <StateRow
                  key={feed.id || feed.label || `massive-feed-${index}`}
                  label={feed.label || feed.id || "Feed"}
                  value={`${formatList(feed.subscribedChannels)} · ${formatCount(feed.subscribedSymbolCount)} symbols`}
                  tone={feed.lastError ? CSS_COLOR.red : feed.connected ? CSS_COLOR.green : CSS_COLOR.textSec}
                />
              );
            })}
            <StateRow label="Last error" value={massiveWebSocket.lastError || MISSING_VALUE} tone={massiveWebSocket.lastError ? CSS_COLOR.red : CSS_COLOR.textSec} />
          </Panel>
          <Panel title="Streaming">
            <StateRow label="Consumers" value={formatCount(stream.activeConsumerCount)} />
            <StateRow label="Symbols" value={formatCount(stream.unionSymbolCount)} />
            <StateRow label="Events" value={formatCount(stream.eventCount)} />
            <StateRow label="Last event" value={stream.lastEventAgeMs == null ? MISSING_VALUE : `${formatMs(stream.lastEventAgeMs)} ago`} />
            <StateRow label="Reconnects" value={formatCount(stream.reconnectCount)} />
            <StateRow label="Observed gaps" value={formatCount(stream.streamGapCount)} tone={stream.recentGapCount > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
            <StateRow label="Recent gaps" value={formatCount(stream.recentGapCount)} tone={stream.recentGapCount > 0 ? CSS_COLOR.amber : CSS_COLOR.green} />
            <StateRow label="Last gap" value={stream.lastGapMs == null ? MISSING_VALUE : `${formatMs(stream.lastGapMs)} / ${formatMs(stream.lastGapAgeMs)} ago`} tone={stream.recentGapCount > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
            <StateRow label="Worst observed gap" value={formatMs(stream.maxGapMs)} tone={stream.recentGapCount > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
          </Panel>
          <Panel title="Latency">
            <StateRow label="Bridge->API p50" value={formatMs(latencyStats.bridgeToApiMs?.p50)} />
            <StateRow label="Bridge->API p95" value={formatMs(latencyStats.bridgeToApiMs?.p95)} />
            <StateRow label="API->React p50" value={formatMs(latencyStats.apiToReactMs?.p50)} />
            <StateRow label="API->React p95" value={formatMs(latencyStats.apiToReactMs?.p95)} />
            <StateRow label="Total p50" value={formatMs(latencyStats.totalMs?.p50)} />
            <StateRow label="Total p95" value={formatMs(latencyStats.totalMs?.p95)} />
          </Panel>
          <Panel title="Work Planner">
            <StateRow label="Generation" value={marketDataWorkPlan.generation || MISSING_VALUE} />
            <StateRow
              label="IBKR equity"
              value={`${formatCount(marketDataWorkPlanSummary.ibkrEquityLineCount)} lines · ${formatCount(marketDataWorkPlanSummary.ibkrEquitySymbolCount)} symbols`}
            />
            <StateRow
              label={hasMassiveOptionSummary ? "Massive options" : "Option demand"}
              value={`${formatCount(plannerMassiveOptionLineCount)} lines · ${formatCount(plannerMassiveOptionSymbolCount)} symbols`}
            />
            {hasMassiveOptionSummary && (plannerIbkrOptionLineCount > 0 || plannerIbkrOptionSymbolCount > 0) ? (
              <StateRow
                label="IBKR options"
                value={`${formatCount(plannerIbkrOptionLineCount)} lines · ${formatCount(plannerIbkrOptionSymbolCount)} symbols`}
              />
            ) : null}
            <StateRow
              label="Persist queue"
              value={`${formatCount(marketDataWorkPlanSummary.persistQueuedJobCount)} queued · ${formatCount(marketDataWorkPlanSummary.persistRunningJobCount)} running`}
              tone={(marketDataWorkPlanSummary.persistQueuedJobCount ?? 0) > 0 ? CSS_COLOR.amber : CSS_COLOR.green}
            />
            <StateRow
              label="Persist worker"
              value={
                persistWorkerInactive
                  ? `${formatCount(persistClaimableQueuedJobCount)} ready · inactive`
                  : (marketDataWorkPlanSummary.persistRunningJobCount ?? 0) > 0
                    ? `${formatCount(persistClaimableQueuedJobCount)} ready · running`
                    : `${formatCount(persistClaimableQueuedJobCount)} ready`
              }
              tone={persistWorkerInactive ? CSS_COLOR.amber : CSS_COLOR.green}
            />
            <StateRow
              label="Blocked GEX"
              value={formatCount(marketDataWorkPlanSummary.persistBlockedJobCount)}
              tone={(marketDataWorkPlanSummary.persistBlockedJobCount ?? 0) > 0 ? CSS_COLOR.amber : CSS_COLOR.green}
            />
            <StateRow
              label="Scanner horizon"
              value={`${formatCount(marketDataWorkPlanScanner.plannedHorizonCount)} symbols · ${formatMs(marketDataWorkPlanScanner.estimatedCycleMs)}`}
            />
            <StateRow
              label="Scanner lines"
              value={`${formatCount(marketDataWorkPlanSummary.scannerMaxDeepScanLines)} max · ${formatCount(marketDataWorkPlanSummary.scannerEffectiveConcurrency)} workers`}
            />
            <StateRow
              label="Memory action"
              value={marketDataWorkPlanMemory.action || MISSING_VALUE}
              tone={marketDataWorkPlanMemory.action && marketDataWorkPlanMemory.action !== "normal" ? CSS_COLOR.amber : CSS_COLOR.green}
            />
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
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(280)}px, 1fr))`, gap: sp(14) }}>
          <Panel title="API Golden Signals">
            <StateRow label="Requests / 5m" value={formatCount(apiMetrics.requestCount5m)} />
            <StateRow label="4xx / 5m" value={formatCount(apiMetrics.warningCount5m)} />
            <StateRow label="5xx / 5m" value={formatCount(apiMetrics.errorCount5m)} tone={apiMetrics.errorCount5m > 0 ? CSS_COLOR.red : CSS_COLOR.green} />
            <StateRow label="p50 latency" value={formatMs(apiMetrics.p50LatencyMs)} />
            <StateRow label="p95 latency" value={formatMs(apiMetrics.p95LatencyMs)} tone={apiMetrics.p95LatencyMs > 1000 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
            <StateRow label="p99 latency" value={formatMs(apiMetrics.p99LatencyMs)} />
            <StateRow label="Slow requests / 5m" value={formatCount(apiMetrics.slowRouteCount5m)} tone={(apiMetrics.slowRouteCount5m ?? 0) > 0 ? CSS_COLOR.amber : CSS_COLOR.green} />
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
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(280)}px, 1fr))`, gap: sp(14) }}>
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
            <StateRow label="Prepending scopes" value={formatCount(chartHydrationMetrics.prependingScopeCount ?? chartStats.prependingScopeCount)} tone={(chartHydrationMetrics.prependingScopeCount ?? chartStats.prependingScopeCount ?? 0) > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
            <StateRow label="Exhausted scopes" value={formatCount(chartHydrationMetrics.exhaustedScopeCount ?? chartStats.exhaustedScopeCount)} tone={(chartHydrationMetrics.exhaustedScopeCount ?? chartStats.exhaustedScopeCount ?? 0) > 0 ? CSS_COLOR.amber : CSS_COLOR.green} />
            <StateRow label="Prepend p95" value={formatMs(chartHydrationMetrics.prependP95Ms ?? chartStats.prependRequestMs?.p95)} tone={(chartHydrationMetrics.prependP95Ms ?? chartStats.prependRequestMs?.p95 ?? 0) >= 1500 ? CSS_COLOR.amber : CSS_COLOR.textSec} onClick={() => selectMetric("chart-hydration", "chart_hydration.prepend_p95_ms")} />
            <StateRow label="Payload shape errors" value={formatCount(chartHydrationMetrics.payloadShapeErrors ?? chartStats.counters?.payloadShapeError)} tone={(chartHydrationMetrics.payloadShapeErrors ?? chartStats.counters?.payloadShapeError ?? 0) > 0 ? CSS_COLOR.red : CSS_COLOR.green} onClick={() => selectMetric("chart-hydration", "chart_hydration.payload_shape_errors")} />
            <StateRow label="Oldest loaded" value={(chartHydrationMetrics.oldestLoadedAtMin || chartStats.oldestLoadedAtMin) ? formatAgo(chartHydrationMetrics.oldestLoadedAtMin || chartStats.oldestLoadedAtMin) : MISSING_VALUE} />
          </Panel>
          <Panel title="Chart Backend">
            <StateRow label="Cache entries" value={`${formatCount(chartHydrationMetrics.cacheEntries)} / ${formatCount(chartHydrationMetrics.cacheMaxEntries)}`} />
            <StateRow label="In-flight" value={formatCount(chartHydrationMetrics.inFlight)} tone={(chartHydrationMetrics.inFlight ?? 0) > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
            <StateRow label="Cursor entries" value={`${formatCount(chartHydrationMetrics.historyCursorEntries)} / ${formatCount(chartHydrationMetrics.historyCursorMaxEntries)}`} />
            <StateRow label="Cursor TTL" value={formatDuration(chartHydrationMetrics.historyCursorTtlMs)} />
            <StateRow label="Cursor flag" value={chartHydrationMetrics.cursorEnabled == null ? MISSING_VALUE : chartHydrationMetrics.cursorEnabled ? "enabled" : "disabled"} tone={chartHydrationMetrics.cursorEnabled === false ? CSS_COLOR.amber : CSS_COLOR.green} />
            <StateRow label="Dedupe flag" value={chartHydrationMetrics.dedupeEnabled == null ? MISSING_VALUE : chartHydrationMetrics.dedupeEnabled ? "enabled" : "disabled"} tone={chartHydrationMetrics.dedupeEnabled === false ? CSS_COLOR.amber : CSS_COLOR.green} />
            <StateRow label="Background flag" value={chartHydrationMetrics.backgroundEnabled == null ? MISSING_VALUE : chartHydrationMetrics.backgroundEnabled ? "enabled" : "disabled"} tone={chartHydrationMetrics.backgroundEnabled === false ? CSS_COLOR.amber : CSS_COLOR.green} />
            <StateRow label="Cache hit/miss" value={`${formatCount(chartHydrationMetrics.cacheHit)} / ${formatCount(chartHydrationMetrics.cacheMiss)}`} />
            <StateRow label="In-flight joins" value={formatCount(chartHydrationMetrics.inFlightJoin)} />
            <StateRow label="Provider fetch/pages" value={`${formatCount(chartHydrationMetrics.providerFetch)} / ${formatCount(chartHydrationMetrics.providerPage)}`} />
            <StateRow label="Cursor continuations" value={formatCount(chartHydrationMetrics.cursorContinuation)} tone={(chartHydrationMetrics.cursorContinuation ?? 0) > 0 ? CSS_COLOR.green : CSS_COLOR.textSec} />
            <StateRow label="Cursor fallbacks" value={formatCount(chartHydrationMetrics.cursorFallbackCount ?? chartHydrationMetrics.cursorFallback)} tone={(chartHydrationMetrics.cursorFallbackCount ?? chartHydrationMetrics.cursorFallback ?? 0) > 0 ? CSS_COLOR.amber : CSS_COLOR.green} onClick={() => selectMetric("chart-hydration", "chart_hydration.cursor_fallback_count")} />
          </Panel>
          <Panel title="Chart Scopes">
            {chartHydrationScopes.length ? (
              chartHydrationScopes.slice(0, 8).map((scope) => (
                <div key={scope.scope} style={{ borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 33)}`, padding: sp("7px 0") }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: sp(10), fontFamily: T.sans, fontSize: fs(10), color: CSS_COLOR.textSec }}>
                    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{scope.scope}</span>
                    <span style={{ color: scope.hasExhaustedOlderHistory ? CSS_COLOR.amber : scope.isPrependingOlder ? CSS_COLOR.green : CSS_COLOR.textDim }}>
                      {scope.role || "chart"} / {scope.timeframe || MISSING_VALUE}
                    </span>
                  </div>
                  <div style={{ marginTop: sp(4), display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${dim(110)}px), max-content))`, justifyContent: "start", gap: sp(6), fontFamily: T.sans, fontSize: textSize("caption"), color: CSS_COLOR.textDim }}>
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
              <DataUnavailableState
                title="No chart scopes"
                detail="No chart scopes observed in the current session."
              />
            )}
          </Panel>
          <Panel title="Current Option Session">
            <StateRow label="Ticker" value={state.ticker} />
            <StateRow label="Expiration" value={state.expiration} />
            <StateRow label="Provider mode" value={state.providerMode} />
            <StateRow label="WebSocket" value={state.wsState} />
            <StateRow label="Quote coverage" value={quoteCoverage} />
            <StateRow label="Backpressure" value={state.degraded ? "degraded" : "normal"} tone={state.degraded ? CSS_COLOR.amber : CSS_COLOR.green} />
            <StateRow label="Pause reason" value={state.pauseReason} />
          </Panel>
          <Panel title="Local Rollups" action={<Button variant="ghost" size="sm" onClick={clearOptionHydrationDiagnosticsHistory}>Clear History</Button>}>
            {history.length ? (
              history.slice(-8).reverse().map((entry) => (
                <div key={entry.id} style={{ borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 33)}`, padding: sp("7px 0"), fontFamily: T.sans, fontSize: textSize("caption"), color: CSS_COLOR.textSec }}>
                  {formatAppDateTime(entry.updatedAt)} / failures {entry.failureCount} / {entry.transportStates.join(", ") || "no state"}
                </div>
              ))
            ) : (
              <DataUnavailableState
                title="No rollups"
                detail="No local option-hydration rollups recorded yet."
              />
            )}
          </Panel>
          <Panel title="Browser Events">
            {browserMetricsPostError ? (
              <StateRow label="Metrics refresh" value={browserMetricsPostError} tone={CSS_COLOR.red} />
            ) : null}
            <StateRow label="Events / 5m" value={formatCount(browserMetrics.eventCount5m)} />
            <StateRow label="Warnings / 5m" value={formatCount(browserMetrics.warningCount5m)} tone={browserMetrics.warningCount5m > 0 ? CSS_COLOR.amber : CSS_COLOR.green} />
            <StateRow label="Last category" value={browserMetrics.lastCategory} />
            <StateRow label="Last event" value={browserMetrics.lastEventAt ? formatAgo(browserMetrics.lastEventAt) : MISSING_VALUE} />
          </Panel>
        </div>
      )}

      {activeTab === "Memory" && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(280)}px, 1fr))`, gap: sp(14) }}>
          <Panel title="Pressure State">
            <StateRow label="Level" value={String(resourcePressureMetrics.pressureLevel || "normal").toUpperCase()} tone={severityTone(resourcePressureSnapshot?.severity)} />
            <StateRow label="Footer signal" value={String(footerSignal.level || "normal").toUpperCase()} tone={footerSignal.level === "high" || footerSignal.level === "watch" ? CSS_COLOR.amber : CSS_COLOR.green} />
            <StateRow label="Trend" value={String(footerSignal.trend || "steady").toUpperCase()} />
            <StateRow label="Recommended action" value={resourcePressureMetrics.recommendedAction} />
            <StateRow label="Diagnostics clients" value={formatCount(resourcePressureMetrics.activeDiagnosticsClients)} />
          </Panel>
          <Panel title="Footer Pressure Signal">
            <StateRow label="Source quality" value={footerSignal.sourceQuality} />
            <StateRow label="Browser estimate" value={formatMb(footerSignal.browserMemoryMb)} />
            <StateRow label="Browser limit" value={formatMb(footerSignal.browserMemoryLimitMb)} />
            <StateRow label="API heap" value={formatPercent(footerSignal.apiHeapUsedPercent)} />
            <StateRow label="Observed" value={footerSignal.observedAt ? formatAgo(footerSignal.observedAt) : MISSING_VALUE} />
            <JsonBlock value={footerSignal.dominantDrivers} />
          </Panel>
          <Panel title="API Memory">
            <StateRow label="Heap used" value={formatMb(resourcePressureMetrics.heapUsedMb)} />
            <StateRow label="Heap limit" value={formatMb(resourcePressureMetrics.heapLimitMb)} />
            <StateRow label="Heap pressure" value={formatPercent(resourcePressureMetrics.heapUsedPercent)} tone={(resourcePressureMetrics.heapUsedPercent ?? 0) >= 70 ? CSS_COLOR.amber : CSS_COLOR.green} onClick={() => selectMetric("resource-pressure", "resource_pressure.heap_used_percent")} />
            <StateRow label="RSS" value={formatMb(resourcePressureMetrics.rssMb)} />
            <StateRow label="Event loop p95" value={formatMs(resourcePressureMetrics.eventLoopP95Ms)} />
          </Panel>
          <Panel title="Browser Memory">
            <StateRow label="Estimate" value={formatMb(resourcePressureMetrics.browserMemoryMb)} onClick={() => selectMetric("resource-pressure", "resource_pressure.browser_memory_mb")} />
            <StateRow label="Limit" value={formatMb(resourcePressureMetrics.browserMemoryLimitMb)} />
            <StateRow label="Limit pressure" value={formatPercent(resourcePressureMetrics.browserMemoryLimitPercent)} onClick={() => selectMetric("resource-pressure", "resource_pressure.browser_memory_limit_percent")} />
            <StateRow label="Confidence" value={resourcePressureMetrics.sourceQuality || resourcePressureMetrics.browserMemoryConfidence} />
            <StateRow label="Source" value={resourcePressureMetrics.browserMemorySource} />
            <StateRow label="Observed" value={resourcePressureMetrics.browserObservedAt ? formatAgo(resourcePressureMetrics.browserObservedAt) : MISSING_VALUE} />
          </Panel>
          <Panel title="Isolation Readiness">
            <StateRow label="Mode" value={isolationMetrics.mode} />
            <StateRow label="Cross-origin isolated" value={isolationMetrics.crossOriginIsolated ? "yes" : "no"} tone={isolationMetrics.crossOriginIsolated ? CSS_COLOR.green : CSS_COLOR.amber} />
            <StateRow label="Report-only" value={isolationMetrics.reportOnly ? "yes" : "no"} />
            <StateRow label="COOP target" value={isolationMetrics.coopMode} />
            <StateRow label="COEP target" value={isolationMetrics.coepMode} />
            <StateRow label="Memory API available" value={isolationMetrics.memoryApiAvailable ? "yes" : "no"} />
            <StateRow label="Memory API used" value={isolationMetrics.memoryApiUsed ? "yes" : "no"} />
            <StateRow label="Latest client sample" value={isolationMetrics.latestClientAt ? formatAgo(isolationMetrics.latestClientAt) : MISSING_VALUE} />
          </Panel>
          <Panel title="Isolation Reports">
            <StateRow label="Actionable reports / 5m" value={formatCount(isolationMetrics.reportCount5m)} tone={(isolationMetrics.reportCount5m ?? 0) > 0 ? CSS_COLOR.amber : CSS_COLOR.green} onClick={() => selectMetric("isolation", "isolation.report_count_5m")} />
            <StateRow label="Raw browser reports / 5m" value={formatCount(isolationMetrics.rawReportCount5m)} tone={(isolationMetrics.rawReportCount5m ?? 0) > 0 ? CSS_COLOR.amber : CSS_COLOR.green} />
            <JsonBlock value={{ actionableTypes: isolationMetrics.reportTypes, rawTypes: isolationMetrics.rawReportTypes, blockedOrigins: isolationMetrics.blockedOrigins }} />
          </Panel>
          <Panel title="Runtime Caches">
            <JsonBlock value={resourcePressureMetrics.cacheInventory} />
          </Panel>
          <Panel title="Cache Tables">
            {(Array.isArray(storageMetrics.monitoredTables) ? storageMetrics.monitoredTables : []).map((table) => (
              <div key={table.table} style={{ borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 33)}`, padding: sp("7px 0") }}>
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
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(280)}px, 1fr))`, gap: sp(14) }}>
          <Panel title="Accounts Probe">
            <StateRow label="Accounts" value={formatCount(accountMetrics.accountCount)} />
            <StateRow label="Positions" value={formatCount(accountMetrics.positionCount)} />
            <StateRow label="Visibility failures" value={formatCount(accountMetrics.visibilityFailures)} tone={accountMetrics.visibilityFailures > 0 ? CSS_COLOR.red : CSS_COLOR.green} />
            <StateRow label="Last error" value={accountMetrics.lastError} tone={accountMetrics.lastError ? CSS_COLOR.red : CSS_COLOR.textSec} />
          </Panel>
          <Panel title="Orders Probe">
            <StateRow label="Orders" value={formatCount(orderMetrics.orderCount)} />
            <StateRow label="Visibility failures" value={formatCount(orderMetrics.visibilityFailures)} tone={orderMetrics.visibilityFailures > 0 ? CSS_COLOR.red : CSS_COLOR.green} />
            <StateRow label="Last error" value={orderMetrics.lastError} tone={orderMetrics.lastError ? CSS_COLOR.red : CSS_COLOR.textSec} />
          </Panel>
          <Panel title="Probe Raw">
            <JsonBlock value={{ accounts: accountSnapshot, orders: orderSnapshot }} />
          </Panel>
        </div>
      )}

      {activeTab === "Storage" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: sp(14) }}>
          <Panel title="Storage Health">
            <StateRow label="Reachable" value={storageMetrics.reachable ? "yes" : "no"} tone={storageMetrics.reachable ? CSS_COLOR.green : CSS_COLOR.red} />
            <StateRow label="Ping" value={formatMs(storageMetrics.pingMs)} />
            <StateRow label="Retention" value={`${storageMetrics.snapshotRetentionDays || 7} days`} />
            <StateRow label="Error" value={storageMetrics.error} tone={storageMetrics.error ? CSS_COLOR.red : CSS_COLOR.textSec} />
          </Panel>
          <Panel title="Storage Raw Snapshot">
            <JsonBlock value={storageSnapshot} />
          </Panel>
        </div>
      )}

      {activeTab === "Events" && (
        <div style={{ display: "grid", gridTemplateColumns: `minmax(0, 1fr) minmax(${dim(320)}px, 0.7fr)`, gap: sp(14) }}>
          <Panel title="Events">
            {historyEventsRefreshError ? (
              <StateRow label="Refresh error" value={historyEventsRefreshError} tone={CSS_COLOR.red} />
            ) : null}
            <EventList events={events} onSelect={setSelectedEvent} />
          </Panel>
          <Panel title="Event Detail">
            {selectedEvent ? (
              <JsonBlock value={eventDetail || selectedEvent} />
            ) : (
              <DataUnavailableState
                title="No selection"
                detail="Select an event or metric to inspect raw context."
                standby
              />
            )}
          </Panel>
        </div>
      )}

      <DiagnosticThresholdSettingsPanel compact={diagnosticsIsPhone} />

      <div style={{ height: sp(16) }} />
    </div>
  );
}
