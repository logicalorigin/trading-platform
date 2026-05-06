import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  CircleCheck,
  Gauge,
  Power,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens";
import { useIbkrLatencyStats } from "../charting/useMassiveStockAggregateStream";
import {
  formatPreferenceDateTime,
  formatPreferenceTimeZoneLabel,
} from "../preferences/userPreferenceModel";
import { useUserPreferences } from "../preferences/useUserPreferences";
import { bridgeRuntimeMessage } from "./bridgeRuntimeModel";
import {
  formatIbkrPingMs,
  getIbkrConnection,
  getIbkrConnectionTone,
  getIbkrGatewayBadges,
  IbkrPingWavelength,
  resolveIbkrGatewayHealth,
} from "./IbkrConnectionStatus";
import {
  IBKR_BRIDGE_LAUNCH_COOLDOWN_MS,
  IBKR_BRIDGE_SESSION_KEYS,
  clearIbkrBridgeSessionValues,
  closeIbkrProtocolLauncher,
  invalidateIbkrRuntimeQueries,
  navigateIbkrProtocolLauncher,
  openIbkrProtocolLauncher,
  readIbkrBridgeSessionValue,
  removeIbkrBridgeSessionValue,
  writeIbkrBridgeSessionValue,
} from "./ibkrBridgeSession";
import { buildHeaderIbkrPopoverModel } from "./ibkrPopoverModel";
import { platformJsonRequest } from "./platformJsonRequest";
import { useRuntimeControlSnapshot } from "./useRuntimeControlSnapshot";
import { useRuntimeWorkloadFlag } from "./workloadStats";
import { AppTooltip } from "@/components/ui/tooltip";


const ET_CLOCK_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const ET_WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatClockCountdown = (totalSeconds) => {
  const safeSeconds = Math.max(0, Math.round(totalSeconds || 0));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const hhmmss = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return days > 0 ? `${days}d ${hhmmss}` : hhmmss;
};

const buildMarketClockState = (now = Date.now(), preferences) => {
  const clockDate = new Date(now);
  const parts = Object.fromEntries(
    ET_CLOCK_PARTS_FORMATTER.formatToParts(clockDate).map((part) => [
      part.type,
      part.value,
    ]),
  );
  const weekdayIndex = ET_WEEKDAY_INDEX[parts.weekday] ?? 0;
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  const currentSeconds = hour * 3600 + minute * 60 + second;
  const openSeconds = 9 * 3600 + 30 * 60;
  const closeSeconds = 16 * 3600;
  const afterHoursCloseSeconds = 20 * 3600;
  const nextBusinessDayOffset =
    weekdayIndex === 5 ? 3 : weekdayIndex === 6 ? 2 : weekdayIndex === 0 ? 1 : 1;

  const base = {
    timeLabel: `${formatPreferenceDateTime(clockDate, {
      preferences,
      context: "app",
      includeDate: false,
      includeTime: true,
      fallback: `${parts.hour}:${parts.minute}:${parts.second}`,
    })}${
      preferences?.time?.showTimeZoneBadge
        ? ` ${formatPreferenceTimeZoneLabel(preferences, "app")}`
        : ""
    }`,
    dateLabel: formatPreferenceDateTime(clockDate, {
      preferences,
      context: "app",
      includeDate: false,
      includeTime: false,
      weekdayStyle: "short",
      monthStyle: "short",
      dayStyle: "numeric",
      fallback: `${parts.weekday} ${parts.month} ${parts.day}`,
    }),
  };

  if (weekdayIndex === 0 || weekdayIndex === 6) {
    const daysUntilOpen = weekdayIndex === 6 ? 2 : 1;
    return {
      ...base,
      phase: "weekend",
      label: "Weekend",
      action: "Opens",
      timerLabel: formatClockCountdown(
        daysUntilOpen * 86400 + openSeconds - currentSeconds,
      ),
      color: T.textDim,
    };
  }

  if (currentSeconds < openSeconds) {
    return {
      ...base,
      phase: "pre",
      label: "Pre-market",
      action: "Opens",
      timerLabel: formatClockCountdown(openSeconds - currentSeconds),
      color: T.amber,
    };
  }

  if (currentSeconds < closeSeconds) {
    return {
      ...base,
      phase: "open",
      label: "Market open",
      action: "Closes",
      timerLabel: formatClockCountdown(closeSeconds - currentSeconds),
      color: T.green,
    };
  }

  if (currentSeconds < afterHoursCloseSeconds) {
    return {
      ...base,
      phase: "post",
      label: "After hours",
      action: "Opens",
      timerLabel: formatClockCountdown(
        nextBusinessDayOffset * 86400 + openSeconds - currentSeconds,
      ),
      color: T.amber,
    };
  }

  return {
    ...base,
    phase: "closed",
    label: "Closed",
    action: "Opens",
    timerLabel: formatClockCountdown(
      nextBusinessDayOffset * 86400 + openSeconds - currentSeconds,
    ),
    color: T.textDim,
  };
};

const resolveHeaderIbkrPingMs = (connection, latencyStats) => {
  const candidates = [
    connection?.lastPingMs,
    latencyStats?.bridgeToApiMs?.p95,
    latencyStats?.totalMs?.p95,
    latencyStats?.apiToReactMs?.p95,
  ];
  return candidates.find((value) => Number.isFinite(value)) ?? null;
};

const resolveHeaderDataModeLabel = (session) => {
  const liveAvailable = session?.ibkrBridge?.liveMarketDataAvailable;
  if (liveAvailable === false) return "DELAYED DATA";
  if (liveAvailable === true) return "LIVE DATA";
  const provider = session?.marketDataProviders?.live;
  return provider ? "LIVE DATA" : MISSING_VALUE;
};

const HeaderIbkrStatusChip = ({
  label,
  connection,
  tone,
  latencyStats,
}) => {
  const Icon = tone.Icon;
  const health = resolveIbkrGatewayHealth({ connection });
  const badges = getIbkrGatewayBadges({ connection, latencyStats, health })
    .filter((badge) => !["LIVE", "NO SUBS", "CLOSED", "QUIET STREAM"].includes(badge.label))
    .slice(0, 1);
  const pulse = Boolean(tone.pulse);
  const pingMs = resolveHeaderIbkrPingMs(connection, latencyStats);

  return (
    <span
      data-ibkr-state-pulse={pulse ? "true" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(3),
        minWidth: 0,
        color: tone.color,
        animation: pulse ? "ibkrStatusPulse 1.8s ease-in-out infinite" : "none",
      }}
    >
      <Icon size={dim(11)} strokeWidth={2.3} color={tone.color} />
      {label ? (
        <span
          style={{
            fontSize: fs(7),
            fontWeight: 800,
            fontFamily: T.sans,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      ) : null}
      {badges.map((badge) => (
        <span
          key={badge.label}
          style={{
            border: `1px solid ${badge.color}66`,
            background: badge.background,
            color: badge.color,
            fontSize: fs(7),
            fontWeight: 900,
            fontFamily: T.mono,
            lineHeight: 1,
            padding: sp("2px 4px"),
            whiteSpace: "nowrap",
          }}
        >
          {badge.label}
        </span>
      ))}
      <IbkrPingWavelength connection={connection} tone={tone} />
      <span
        style={{
          color: T.textDim,
          fontSize: fs(7),
          fontWeight: 800,
          fontFamily: T.mono,
          minWidth: dim(30),
          textAlign: "right",
          whiteSpace: "nowrap",
        }}
      >
        {formatIbkrPingMs(pingMs)}
      </span>
    </span>
  );
};

const HeaderIbkrDetailRow = ({
  label,
  value,
  tone = T.textSec,
  wrap = false,
}) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "minmax(72px, 0.78fr) minmax(0, 1.22fr)",
      gap: sp(8),
      alignItems: "baseline",
      minWidth: 0,
      padding: sp("2px 0"),
      borderBottom: `1px solid ${T.border}55`,
      fontFamily: T.mono,
      fontSize: fs(8),
    }}
  >
    <span style={{ color: T.textDim, whiteSpace: "nowrap" }}>{label}</span>
    <span
      style={{
        color: tone,
        fontWeight: 800,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: wrap ? "clip" : "ellipsis",
        whiteSpace: wrap ? "normal" : "nowrap",
        wordBreak: wrap ? "break-word" : "normal",
        textAlign: "right",
      }}
    >
      {value ?? MISSING_VALUE}
    </span>
  </div>
);

const HEADER_IBKR_ICON_COMPONENTS = {
  activity: Activity,
  alert: AlertTriangle,
  gauge: Gauge,
  radioTower: RadioTower,
  shieldCheck: ShieldCheck,
};

const getHeaderIbkrIcon = (iconKey) =>
  HEADER_IBKR_ICON_COMPONENTS[iconKey] || Activity;

const HeaderIbkrMetricTile = ({ tile }) => {
  const Icon = getHeaderIbkrIcon(tile.iconKey);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        alignItems: "center",
        gap: sp(6),
        minWidth: 0,
        padding: sp("6px 7px"),
        background: T.bg1,
        border: `1px solid ${T.border}`,
      }}
    >
      <Icon size={dim(13)} strokeWidth={2.2} color={tile.tone} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: T.textDim,
            fontFamily: T.mono,
            fontSize: fs(7),
            fontWeight: 900,
            letterSpacing: "0.04em",
            lineHeight: 1.1,
            textTransform: "uppercase",
          }}
        >
          {tile.label}
        </div>
        <div
          style={{
            color: tile.tone,
            fontFamily: T.sans,
            fontSize: fs(10),
            fontWeight: 900,
            lineHeight: 1.15,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {tile.value ?? MISSING_VALUE}
        </div>
        {tile.detail ? (
          <div
            style={{
              color: T.textDim,
              fontFamily: T.mono,
              fontSize: fs(7),
              lineHeight: 1.1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tile.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const HeaderProviderRows = ({ rows = [] }) => (
  <div
    style={{
      display: "grid",
      gap: sp(4),
      marginBottom: sp(8),
      padding: sp("6px 7px"),
      background: T.bg1,
      border: `1px solid ${T.border}`,
    }}
  >
    <div
      style={{
        color: T.textMuted,
        fontFamily: T.mono,
        fontSize: fs(8),
        fontWeight: 900,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      Providers
    </div>
    {rows.map((row) => (
      <div
        key={row.label}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(56px, 0.5fr) minmax(0, 0.9fr) minmax(0, 1.3fr)",
          gap: sp(6),
          alignItems: "baseline",
          minWidth: 0,
          fontFamily: T.mono,
          fontSize: fs(8),
        }}
      >
        <span style={{ color: T.textDim }}>{row.label}</span>
        <span style={{ color: row.tone, fontWeight: 900 }}>{row.value}</span>
        <span
          style={{
            color: T.textMuted,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: row.wrap ? "clip" : "ellipsis",
            whiteSpace: row.wrap ? "normal" : "nowrap",
            overflowWrap: row.wrap ? "anywhere" : "normal",
            textAlign: "right",
          }}
        >
          {row.detail ?? MISSING_VALUE}
        </span>
      </div>
    ))}
  </div>
);

const HeaderMarketDataLineUsage = ({ lineUsage }) => {
  if (!lineUsage?.available) {
    return null;
  }

  return (
    <div
      style={{
        display: "grid",
        gap: sp(4),
        marginBottom: sp(8),
        padding: sp("6px 7px"),
        background: T.bg1,
        border: `1px solid ${T.border}`,
        fontFamily: T.mono,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: sp(8),
        }}
      >
        <span
          style={{
            color: T.textMuted,
            fontSize: fs(8),
            fontWeight: 900,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          Market data lines
        </span>
        <span style={{ color: T.textSec, fontSize: fs(8), fontWeight: 900 }}>
          {lineUsage.summary}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(96px, 1fr) repeat(3, minmax(34px, auto))",
          gap: sp(5),
          color: T.textMuted,
          fontSize: fs(7),
          fontWeight: 900,
          textTransform: "uppercase",
          borderBottom: `1px solid ${T.border}66`,
          paddingBottom: sp(2),
        }}
      >
        <span>Pool</span>
        <span style={{ textAlign: "right" }}>Used</span>
        <span style={{ textAlign: "right" }}>Cap</span>
        <span style={{ textAlign: "right" }}>Free</span>
      </div>
      {lineUsage.rows.map((row) => (
        <div
          key={row.id}
          data-testid={`header-market-data-line-row-${row.id}`}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(96px, 1fr) repeat(3, minmax(34px, auto))",
            gap: sp(5),
            alignItems: "baseline",
            color: row.tone,
            fontSize: fs(8),
            borderBottom: `1px solid ${T.border}33`,
            padding: sp("1px 0"),
          }}
        >
          <span
            style={{
              color: row.id === "total" ? T.textSec : T.textDim,
              minWidth: 0,
            }}
          >
            <span>{row.label}</span>
            {row.detail ? (
              <span
                style={{
                  display: "block",
                  marginTop: sp(1),
                  color: row.tone,
                  fontSize: fs(7),
                  lineHeight: 1.1,
                  overflowWrap: "anywhere",
                }}
              >
                {row.detail}
              </span>
            ) : null}
          </span>
          <span style={{ textAlign: "right", fontWeight: 900 }}>
            {Number.isFinite(row.used) ? Math.round(row.used) : MISSING_VALUE}
          </span>
          <span style={{ textAlign: "right" }}>
            {Number.isFinite(row.cap) ? Math.round(row.cap) : MISSING_VALUE}
          </span>
          <span style={{ textAlign: "right" }}>
            {Number.isFinite(row.free) ? Math.round(row.free) : MISSING_VALUE}
          </span>
        </div>
      ))}
    </div>
  );
};

const HeaderMarketDataLineBadge = ({ lineUsage }) => {
  if (!lineUsage?.available) {
    return null;
  }

  const totalRow = lineUsage.rows?.find((row) => row.id === "total");
  const tone = totalRow?.tone || T.textSec;

  return (
    <AppTooltip content={`Market data lines ${lineUsage.summary}`}><span
      data-testid="header-market-data-line-usage"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(3),
        minWidth: 0,
        border: `1px solid ${tone}66`,
        background: `${tone}14`,
        color: tone,
        fontFamily: T.mono,
        fontSize: fs(7),
        fontWeight: 900,
        lineHeight: 1,
        padding: sp("2px 4px"),
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: T.textMuted }}>LINES</span>
      <span>{lineUsage.summary}</span>
    </span></AppTooltip>
  );
};

const HeaderIbkrConnectionSummary = ({ model }) => {
  const IssueIcon = getHeaderIbkrIcon(model.issue.iconKey);

  return (
    <div
      style={{
        display: "grid",
        gap: sp(8),
        marginBottom: sp(8),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            minWidth: 0,
            color: model.health.color,
            fontFamily: T.mono,
            fontSize: fs(10),
            fontWeight: 900,
          }}
        >
          <span
            style={{
              width: dim(8),
              height: dim(8),
              background: model.health.color,
              boxShadow: `0 0 10px ${model.health.color}66`,
            }}
          />
          <span>{model.health.label}</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: sp(4),
            minWidth: 0,
          }}
        >
          {model.badges.map((badge) => (
            <span
              key={badge.label}
              style={{
                border: `1px solid ${badge.color}66`,
                background: badge.background,
                color: badge.color,
                fontFamily: T.mono,
                fontSize: fs(7),
                fontWeight: 900,
                padding: sp("2px 4px"),
                whiteSpace: "nowrap",
              }}
            >
              {badge.label}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          gap: sp(6),
          alignItems: "start",
          padding: sp("6px 7px"),
          background: T.bg1,
          border: `1px solid ${model.issue.tone}55`,
          color: model.issue.tone,
          fontFamily: T.mono,
          fontSize: fs(8),
          lineHeight: 1.3,
        }}
      >
        <IssueIcon size={dim(12)} strokeWidth={2.2} color={model.issue.tone} />
        <span
          style={{
            minWidth: 0,
            whiteSpace: "normal",
            overflowWrap: "anywhere",
          }}
        >
          {model.issue.label}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: sp(6),
        }}
      >
        {model.tiles.map((tile) => (
          <HeaderIbkrMetricTile key={tile.label} tile={tile} />
        ))}
      </div>
    </div>
  );
};

const HeaderIbkrAdvancedDetails = ({ model }) => {
  const [open, setOpen] = useState(() => Boolean(model.autoOpenDetails));
  const openSourceRef = useRef(model.autoOpenDetails ? "auto" : "default");
  const lastIssueKeyRef = useRef(model.issue.key);

  useEffect(() => {
    const issueChanged = model.issue.key !== lastIssueKeyRef.current;
    if (issueChanged) {
      lastIssueKeyRef.current = model.issue.key;
    }

    if (model.autoOpenDetails) {
      if (issueChanged || openSourceRef.current !== "user") {
        openSourceRef.current = "auto";
        setOpen(true);
      }
      return;
    }

    if (issueChanged && openSourceRef.current === "auto") {
      openSourceRef.current = "default";
      setOpen(false);
    }
  }, [model.autoOpenDetails, model.issue.key]);

  const handleDetailsToggle = useCallback(() => {
    openSourceRef.current = "user";
    setOpen((current) => !current);
  }, []);

  return (
    <div style={{ marginTop: sp(7), display: "grid", gap: sp(6) }}>
      <button
        type="button"
        onClick={handleDetailsToggle}
        style={{
          minHeight: dim(26),
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          padding: sp("4px 7px"),
          border: `1px solid ${T.border}`,
          background: T.bg1,
          color: T.textDim,
          cursor: "pointer",
          fontFamily: T.mono,
          fontSize: fs(8),
          fontWeight: 900,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        <span>Details</span>
        <ChevronDown
          size={dim(12)}
          strokeWidth={2.2}
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.12s ease",
          }}
        />
      </button>

      {open ? (
        <div
          style={{
            display: "grid",
            gap: sp(8),
            padding: sp("7px 8px"),
            background: T.bg1,
            border: `1px solid ${T.border}`,
          }}
        >
          {model.detailGroups.map((group) => (
            <div key={group.title} style={{ display: "grid", gap: sp(2) }}>
              <div
                style={{
                  color: T.textMuted,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  fontWeight: 900,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                {group.title}
              </div>
              {group.rows.map((row) => (
                <HeaderIbkrDetailRow
                  key={`${group.title}:${row.label}`}
                  label={row.label}
                  value={row.value}
                  tone={row.tone}
                  wrap={row.wrap}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const HeaderStatusCluster = ({
  session,
  environment,
  bridgeTone,
  theme,
  onToggleTheme,
}) => {
  const queryClient = useQueryClient();
  const { preferences } = useUserPreferences();
  const bridgeTriggerRef = useRef(null);
  const bridgePopoverRef = useRef(null);
  const [marketClockNow, setMarketClockNow] = useState(() => Date.now());
  const [bridgePopoverOpen, setBridgePopoverOpen] = useState(false);
  const [bridgePopoverPosition, setBridgePopoverPosition] = useState(null);
  const [bridgeLaunchUrl, setBridgeLaunchUrl] = useState(() =>
    readIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.launchUrl),
  );
  const [bridgeLaunchInFlightUntil, setBridgeLaunchInFlightUntil] = useState(
    () =>
      Number(
        readIbkrBridgeSessionValue(
          IBKR_BRIDGE_SESSION_KEYS.launchInFlightUntil,
        ) || 0,
      ) || 0,
  );
  const [bridgeManagementToken, setBridgeManagementToken] =
    useState(() =>
      readIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.managementToken),
    );
  const [bridgeLauncherBusy, setBridgeLauncherBusy] = useState(false);
  const [bridgeLauncherError, setBridgeLauncherError] = useState(null);
  useEffect(() => {
    const timer = window.setInterval(() => setMarketClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const marketClock = useMemo(
    () => buildMarketClockState(marketClockNow, preferences),
    [marketClockNow, preferences],
  );
  const gatewayConnection = getIbkrConnection(session, "tws");
  const gatewayTone = getIbkrConnectionTone(gatewayConnection);
  const gatewayLatencyStats = useIbkrLatencyStats();
  const gatewayDiagnosticsEnabled = Boolean(
    bridgePopoverOpen ||
      session?.configured?.ibkr ||
      gatewayConnection?.configured ||
      gatewayConnection?.reachable ||
      gatewayConnection?.authenticated,
  );
  const gatewayRuntimeDiagnosticsEnabled = Boolean(
    bridgePopoverOpen && gatewayDiagnosticsEnabled,
  );
  const runtimeControl = useRuntimeControlSnapshot({
    enabled: gatewayDiagnosticsEnabled,
    runtimeDiagnosticsEnabled: gatewayRuntimeDiagnosticsEnabled,
    runtimeDiagnosticsQueryKey: "ibkr-popover",
    runtimeDiagnosticsRefetchInterval: bridgePopoverOpen ? 5_000 : 15_000,
    lineUsageEnabled: gatewayDiagnosticsEnabled,
    lineUsageStreamEnabled: true,
    lineUsagePollInterval: bridgePopoverOpen ? 2_000 : 10_000,
  });
  useRuntimeWorkloadFlag(
    "header:runtime-diagnostics",
    gatewayRuntimeDiagnosticsEnabled,
    {
      kind: "poll",
      label: "Header runtime",
      detail: bridgePopoverOpen ? "5s" : "15s",
      priority: 7,
    },
  );
  const gatewayRuntimeError =
    runtimeControl.runtimeError instanceof Error
      ? runtimeControl.runtimeError.message
      : runtimeControl.runtimeError
        ? String(runtimeControl.runtimeError)
        : null;
  const gatewayPopoverModel = useMemo(
    () =>
      buildHeaderIbkrPopoverModel({
        connection: gatewayConnection,
        latencyStats: gatewayLatencyStats,
        runtimeDiagnostics: runtimeControl.runtimeDiagnostics,
        runtimeError: gatewayRuntimeError,
        lineUsage: runtimeControl.lineUsage,
        lineUsageSnapshot: runtimeControl.lineUsageSnapshot,
      }),
    [
      gatewayConnection,
      gatewayLatencyStats,
      runtimeControl.runtimeDiagnostics,
      gatewayRuntimeError,
      runtimeControl.lineUsage,
      runtimeControl.lineUsageSnapshot,
    ],
  );
  const bridgeRuntimeOverrideActive = Boolean(
    runtimeControl.runtimeDiagnostics?.ibkr?.runtimeOverrideActive ||
      session?.runtime?.ibkr?.runtimeOverrideActive,
  );
  const canDeactivate = Boolean(
    bridgeManagementToken ||
      bridgeRuntimeOverrideActive ||
      session?.configured?.ibkr ||
      gatewayConnection?.configured,
  );
  const gatewayConnectedForBridge = Boolean(
    gatewayConnection?.authenticated &&
      gatewayConnection?.reachable !== false &&
      gatewayConnection?.competing !== true &&
      gatewayConnection?.healthFresh !== false &&
      gatewayConnection?.accountsLoaded !== false,
  );
  const bridgeLaunchInFlight = Boolean(
    !gatewayConnectedForBridge && bridgeLaunchInFlightUntil > marketClockNow,
  );
  const gatewayReconnectNeeded = Boolean(
    session?.configured?.ibkr && !gatewayConnectedForBridge,
  );
  const gatewayBlockingIssueMessage =
    gatewayPopoverModel.issue?.iconKey === "alert" &&
    gatewayPopoverModel.issue?.key !== "stream-gaps" &&
    gatewayPopoverModel.issue?.key !== "legacy-env"
      ? gatewayPopoverModel.issue.label
      : null;
  const bridgeLauncherMessage =
    bridgeLauncherError ||
    (bridgeLaunchInFlight
      ? "IB Gateway activation is running from the Windows helper. Wait for the bridge to attach before launching again."
      : null) ||
    (bridgeLaunchUrl && !gatewayConnectedForBridge
      ? "Your browser should ask to open the RayAlgo IBKR PowerShell launcher."
      : null) ||
    gatewayBlockingIssueMessage ||
    bridgeRuntimeMessage(session);
  const bridgeActionLabel =
    bridgeLauncherBusy
      ? "Preparing"
      : bridgeLaunchInFlight
        ? "Launching"
      : gatewayConnectedForBridge
          ? "Connected"
          : gatewayReconnectNeeded
            ? "Reconnect"
            : "Launch";
  const bridgeActionColor = gatewayConnectedForBridge
    ? T.green
    : gatewayReconnectNeeded
      ? T.amber
      : T.accent;
  const bridgeActionDisabled = Boolean(
    bridgeLauncherBusy ||
      bridgeLaunchInFlight ||
      gatewayConnectedForBridge,
  );
  const bridgeActionShowsBusyStyle = Boolean(
    bridgeLauncherBusy || bridgeLaunchInFlight,
  );
  const headerDataModeLabel = resolveHeaderDataModeLabel(session);
  const surfaceStyle = {
    display: "flex",
    alignItems: "center",
    gap: 2,
    minHeight: dim(32),
    padding: sp("3px 7px"),
    background: T.bg1,
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    transition: "background 0.12s ease, border-color 0.12s ease",
  };
  const microLabelStyle = {
    fontSize: fs(7),
    fontWeight: 800,
    fontFamily: T.sans,
    color: T.textMuted,
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  };

  const updateBridgePopoverPosition = useCallback(() => {
    if (typeof window === "undefined" || !bridgeTriggerRef.current) {
      return;
    }

    const margin = dim(8);
    const gap = dim(6);
    const triggerRect = bridgeTriggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const width = Math.max(
      0,
      Math.min(dim(408), Math.max(0, viewportWidth - margin * 2)),
    );
    const left = Math.min(
      Math.max(margin, triggerRect.right - width),
      Math.max(margin, viewportWidth - margin - width),
    );
    const top = Math.min(
      Math.max(margin, triggerRect.bottom + gap),
      Math.max(margin, viewportHeight - margin - dim(220)),
    );

    setBridgePopoverPosition({
      left,
      top,
      width,
      maxHeight: Math.max(dim(220), viewportHeight - top - margin),
    });
  }, []);

  useEffect(() => {
    if (!gatewayConnectedForBridge || bridgeLaunchInFlightUntil <= 0) {
      return;
    }
    setBridgeLaunchInFlightUntil(0);
    removeIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.launchInFlightUntil);
  }, [bridgeLaunchInFlightUntil, gatewayConnectedForBridge]);

  useEffect(() => {
    if (!bridgePopoverOpen) {
      setBridgePopoverPosition(null);
      return;
    }

    updateBridgePopoverPosition();

    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        bridgeTriggerRef.current?.contains(target) ||
        bridgePopoverRef.current?.contains(target)
      ) {
        return;
      }
      setBridgePopoverOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setBridgePopoverOpen(false);
      }
    };

    window.addEventListener("resize", updateBridgePopoverPosition);
    window.addEventListener("scroll", updateBridgePopoverPosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updateBridgePopoverPosition);
      window.removeEventListener("scroll", updateBridgePopoverPosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [bridgePopoverOpen, updateBridgePopoverPosition]);

  const handleStartBridgeLauncher = useCallback(async () => {
    const protocolLauncher = openIbkrProtocolLauncher();
    setBridgePopoverOpen(true);
    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);

    try {
      const payload = await platformJsonRequest("/api/ibkr/bridge/launcher", {
        timeoutMs: 0,
      });
      setBridgeManagementToken(payload.managementToken || null);
      setBridgeLaunchUrl(payload.launchUrl || null);
      writeIbkrBridgeSessionValue(
        IBKR_BRIDGE_SESSION_KEYS.managementToken,
        payload.managementToken,
      );
      writeIbkrBridgeSessionValue(
        IBKR_BRIDGE_SESSION_KEYS.launchUrl,
        payload.launchUrl,
      );
      const launched = navigateIbkrProtocolLauncher(
        protocolLauncher,
        payload.launchUrl,
      );
      if (launched) {
        const inFlightUntil = Date.now() + IBKR_BRIDGE_LAUNCH_COOLDOWN_MS;
        setBridgeLaunchInFlightUntil(inFlightUntil);
        writeIbkrBridgeSessionValue(
          IBKR_BRIDGE_SESSION_KEYS.launchInFlightUntil,
          String(inFlightUntil),
        );
      } else {
        setBridgeLauncherError(
          "Could not open the RayAlgo IBKR PowerShell launcher from this browser.",
        );
      }
    } catch (error) {
      closeIbkrProtocolLauncher(protocolLauncher);
      setBridgeLauncherError(
        error instanceof Error ? error.message : "Bridge launcher failed.",
      );
    } finally {
      setBridgeLauncherBusy(false);
    }
  }, []);

  const handleDeactivate = useCallback(async () => {
    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);

    try {
      if (bridgeManagementToken) {
        try {
          await platformJsonRequest("/api/ibkr/bridge/detach", {
            method: "POST",
            body: {
              managementToken: bridgeManagementToken,
            },
          });
        } catch (error) {
          if (error?.code !== "invalid_ibkr_bridge_detach_token") {
            throw error;
          }
          await platformJsonRequest(
            "/api/settings/backend/actions/ibkr.bridgeOverride.clear",
            {
              method: "POST",
              body: { force: true },
            },
          );
        }
      } else {
        await platformJsonRequest(
          "/api/settings/backend/actions/ibkr.bridgeOverride.clear",
          {
            method: "POST",
            body: { force: true },
          },
        );
      }
      setBridgeManagementToken(null);
      clearIbkrBridgeSessionValues();
      setBridgeLaunchUrl(null);
      setBridgeLaunchInFlightUntil(0);
      invalidateIbkrRuntimeQueries(queryClient);
    } catch (error) {
      setBridgeLauncherError(
        error instanceof Error ? error.message : "Deactivate failed.",
      );
    } finally {
      setBridgeLauncherBusy(false);
    }
  }, [bridgeManagementToken, queryClient]);

  return (
    <div
      data-testid="platform-header-status"
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-end",
        gap: sp(4),
        flexWrap: "nowrap",
        minWidth: 0,
      }}
    >
      <div style={{ position: "relative", display: "flex" }}>
        <button
          ref={bridgeTriggerRef}
          type="button"
          aria-label="Open IB Gateway connection details"
          aria-expanded={bridgePopoverOpen}
          onClick={() => setBridgePopoverOpen((current) => !current)}
          style={{
            ...surfaceStyle,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            minWidth: dim(220),
            gap: sp(5),
            color: T.text,
            appearance: "none",
            font: "inherit",
            cursor: "pointer",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = T.bg3;
            event.currentTarget.style.borderColor = T.textMuted;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = T.bg1;
            event.currentTarget.style.borderColor = T.border;
          }}
        >
          <span style={microLabelStyle}>IBKR</span>
          <HeaderIbkrStatusChip
            label={bridgeTone.label.toUpperCase()}
            connection={gatewayConnection}
            tone={gatewayTone}
            latencyStats={gatewayLatencyStats}
          />
          <HeaderMarketDataLineBadge lineUsage={gatewayPopoverModel.lineUsage} />
          <span style={{ ...microLabelStyle, color: T.textDim }}>
            {environment.toUpperCase()} | {headerDataModeLabel}
          </span>
          <ChevronDown size={dim(12)} color={T.textMuted} strokeWidth={2.3} />
        </button>

        {bridgePopoverOpen ? (
          <div
            ref={bridgePopoverRef}
            role="dialog"
            aria-label="IB Gateway bridge"
            style={{
              position: "fixed",
              top: bridgePopoverPosition?.top ?? dim(40),
              left: bridgePopoverPosition?.left ?? dim(8),
              zIndex: 60,
              width: bridgePopoverPosition?.width ?? dim(408),
              maxWidth: `calc(100vw - ${dim(16)}px)`,
              maxHeight: bridgePopoverPosition?.maxHeight ?? dim(520),
              overflowY: "auto",
              boxSizing: "border-box",
              padding: sp(10),
              background: T.bg0,
              border: `1px solid ${T.border}`,
              boxShadow: "0 12px 32px rgba(0,0,0,0.34)",
              color: T.text,
              fontFamily: T.sans,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(8),
                marginBottom: sp(8),
              }}
            >
              <div
                style={{
                  minWidth: 0,
                  display: "flex",
                  alignItems: "baseline",
                  gap: sp(7),
                }}
              >
                <span style={{ ...microLabelStyle, color: T.textSec }}>
                  IB GATEWAY
                </span>
                <span
                  style={{
                    ...microLabelStyle,
                    color: bridgeTone.color,
                  }}
                >
                  {bridgeTone.label.toUpperCase()}
                </span>
              </div>
              <AppTooltip content="Close"><button
                type="button"
                onClick={() => setBridgePopoverOpen(false)}
                style={{
                  width: dim(24),
                  height: dim(24),
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: `1px solid ${T.border}`,
                  background: T.bg1,
                  color: T.textDim,
                  cursor: "pointer",
                }}
              >
                <X size={dim(13)} strokeWidth={2.2} />
              </button></AppTooltip>
            </div>

            <div
              style={{
                minHeight: dim(28),
                marginBottom: sp(8),
                padding: sp("6px 8px"),
                background: T.bg1,
                border: `1px solid ${T.border}`,
                color: bridgeLauncherError
                  ? T.red
                  : gatewayBlockingIssueMessage
                    ? gatewayPopoverModel.issue.tone
                    : T.textSec,
                fontSize: fs(9),
                lineHeight: 1.25,
                fontFamily: T.mono,
                whiteSpace: "normal",
                overflowWrap: "anywhere",
              }}
            >
              {bridgeLauncherMessage}
            </div>

            <HeaderIbkrConnectionSummary model={gatewayPopoverModel} />
            <HeaderProviderRows rows={gatewayPopoverModel.providerRows} />
            <HeaderMarketDataLineUsage lineUsage={gatewayPopoverModel.lineUsage} />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: canDeactivate ? "1fr 1fr" : "1fr",
                gap: sp(6),
              }}
            >
              <button
                type="button"
                onClick={handleStartBridgeLauncher}
                disabled={bridgeActionDisabled}
                aria-disabled={bridgeActionDisabled}
                style={{
                  minHeight: dim(30),
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: sp(6),
                  border: `1px solid ${
                    bridgeActionShowsBusyStyle ? T.border : bridgeActionColor
                  }`,
                  background: bridgeActionShowsBusyStyle
                    ? T.bg1
                    : `${bridgeActionColor}18`,
                  color: bridgeActionShowsBusyStyle ? T.textDim : bridgeActionColor,
                  cursor: bridgeActionDisabled ? "default" : "pointer",
                  fontSize: fs(9),
                  fontWeight: 800,
                  fontFamily: T.sans,
                  letterSpacing: "0.04em",
                }}
              >
                {bridgeLauncherBusy ? (
                  <RefreshCw
                    data-ibkr-bridge-spinner
                    size={dim(13)}
                    strokeWidth={2.2}
                    style={{
                      animation: "premiumFlowSpin 820ms linear infinite",
                    }}
                  />
                ) : gatewayConnectedForBridge ? (
                  <CircleCheck size={dim(13)} strokeWidth={2.2} />
                ) : gatewayReconnectNeeded ? (
                  <RefreshCw size={dim(13)} strokeWidth={2.2} />
                ) : (
                  <Power size={dim(13)} strokeWidth={2.2} />
                )}
                {bridgeActionLabel}
              </button>

              {canDeactivate ? (
                <button
                  type="button"
                  onClick={handleDeactivate}
                  disabled={bridgeLauncherBusy}
                  style={{
                    minHeight: dim(30),
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: sp(6),
                    border: `1px solid ${T.border}`,
                    background: T.bg1,
                    color: T.textSec,
                    cursor: bridgeLauncherBusy ? "default" : "pointer",
                    fontSize: fs(9),
                    fontWeight: 800,
                    fontFamily: T.sans,
                    letterSpacing: "0.04em",
                  }}
                >
                  <X size={dim(13)} strokeWidth={2.2} />
                  Deactivate
                </button>
              ) : null}
            </div>

            <HeaderIbkrAdvancedDetails model={gatewayPopoverModel} />
          </div>
        ) : null}
      </div>

      <AppTooltip content={`${marketClock.dateLabel} · ${marketClock.label}`}><div
        style={{
          ...surfaceStyle,
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          minWidth: dim(92),
          gap: 0,
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = T.bg3;
          event.currentTarget.style.borderColor = T.textMuted;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = T.bg1;
          event.currentTarget.style.borderColor = T.border;
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(4),
            minWidth: 0,
          }}
        >
          <span style={microLabelStyle}>MARKET</span>
          <span
            style={{
              fontSize: fs(10),
              fontWeight: 700,
              fontFamily: T.sans,
              color: T.text,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
            }}
          >
            {marketClock.timeLabel}
          </span>
        </div>
        <div
          style={{
            fontSize: fs(8),
            color: marketClock.color,
            fontFamily: T.sans,
            fontWeight: 700,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          }}
        >
          {marketClock.label.toUpperCase()} {marketClock.timerLabel}
        </div>
      </div></AppTooltip>

      <AppTooltip content={
          theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
        }><button
        type="button"
        onClick={onToggleTheme}
        style={{
          width: dim(30),
          minHeight: dim(32),
          padding: 0,
          background: T.bg1,
          border: `1px solid ${T.border}`,
          borderRadius: 0,
          color: T.textSec,
          cursor: "pointer",
          fontSize: fs(12),
          lineHeight: 1,
          fontFamily: T.sans,
          fontWeight: 700,
          transition: "background 0.12s ease, border-color 0.12s ease",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = T.bg3;
          event.currentTarget.style.borderColor = T.textMuted;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = T.bg1;
          event.currentTarget.style.borderColor = T.border;
        }}
      >
        {theme === "dark" ? "☼" : "☾"}
      </button></AppTooltip>
    </div>
  );
};

export const MemoHeaderStatusCluster = memo(HeaderStatusCluster);
