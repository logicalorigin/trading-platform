import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Cable,
  ChevronDown,
  Check,
  Clock3,
  Database,
  Gauge,
  Hash,
  KeyRound,
  MonitorUp,
  Network,
  Power,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  Timer,
  Unplug,
  Wifi,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CSS_COLOR, cssColorMix, dim, ELEVATION, FONT_WEIGHTS, fs, GLOW, MISSING_VALUE, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";
import { useValueFlash } from "../../lib/motion.jsx";
import { useIbkrLatencyStats } from "../charting/useMassiveStockAggregateStream";
import {
  formatPreferenceDateTime,
  formatPreferenceTimeZoneLabel,
} from "../preferences/userPreferenceModel";
import { useUserPreferences } from "../preferences/useUserPreferences";
import {
  formatIbkrPingMs,
  formatIbkrPingMsParts,
  getIbkrConnection,
  getIbkrConnectionTone,
  IbkrPingWavelength,
  isIbkrGatewayBridgeAttached,
  resolveIbkrGatewayHealth,
} from "./IbkrConnectionStatus";
import { useToast } from "./platformContexts.jsx";
import {
  IBKR_BRIDGE_LAUNCH_COOLDOWN_MS,
  IBKR_BRIDGE_CREDENTIAL_LAUNCH_WINDOW_MS,
  IBKR_BRIDGE_SESSION_KEYS,
  IBKR_RECONNECT_REQUEST_EVENT,
  clearIbkrBridgeSessionValues,
  invalidateIbkrRuntimeQueries,
  readIbkrBridgeSessionValue,
  removeIbkrBridgeSessionValue,
} from "./ibkrBridgeSession";
import {
  isIbkrLoginKeyReadActivationNotFoundError,
  isTransientIbkrLoginKeyReadError,
} from "./ibkrLoginHandoffErrorModel";
import {
  buildIbkrDeactivateOperationStepper,
  buildIbkrLaunchOperationStepper,
  getIbkrLaunchActionProgressLabel,
} from "./ibkrConnectionOperationStepperModel";
import { buildIbkrConnectionSnapshot } from "./ibkrConnectionSnapshot";
import {
  resolveIbkrBridgeProcessActions,
  resolveIbkrCredentialActionState,
  shouldAutoResumeIbkrCredentials,
  shouldClearIbkrPasswordAfterCredentialSubmit,
} from "./ibkrConnectionCredentialActionModel";
import { buildIbkrConnectionInsightModel, formatIbkrInsightElapsed } from "./ibkrConnectionInsightModel";
import {
  buildHeaderIbkrPopoverModel,
  buildHeaderIbkrTriggerModel,
} from "./ibkrPopoverModel";
import { platformJsonRequest } from "./platformJsonRequest";
import { HeaderSnapTradeBrokerStatus } from "./HeaderSnapTradeBrokerStatus";
import { HeaderSessionStatus } from "./HeaderSessionStatus";
import { AppTooltip } from "@/components/ui/tooltip";

const getIbkrInsightToneColor = (tone) => {
  if (tone === "success") return CSS_COLOR.green;
  if (tone === "attention") return CSS_COLOR.amber;
  if (tone === "error") return CSS_COLOR.red;
  if (tone === "idle") return CSS_COLOR.textMuted;
  return CSS_COLOR.accent;
};

const IBKR_LOGIN_HANDOFF_ALGORITHM = "RSA-OAEP-256-CHUNKED";
const IBKR_LOGIN_HANDOFF_POLL_MS = 150;
const IBKR_LOGIN_HANDOFF_REQUEST_WAIT_MS = 25_000;
const IBKR_LOGIN_HANDOFF_WAIT_MS = 60_000;
const IBKR_LOGIN_HANDOFF_RSA_CHUNK_SIZE = 400;
const IBKR_BRIDGE_RECOGNITION_POLL_MS = 1_000;
// Realtime launch status: the popover holds a long-poll against /status that the backend
// wakes the instant a phase changes, so the stepper reflects each step within ~ms instead
// of a fixed poll cadence. WAIT_MS is how long the server parks an idle request (well under
// the server's 30s long-poll cap) before returning the unchanged snapshot to be re-issued;
// RETRY_MS is the brief backoff after a transient network/pressure blip.
const IBKR_BRIDGE_ACTIVATION_STATUS_WAIT_MS = 20_000;
const IBKR_BRIDGE_ACTIVATION_STATUS_RETRY_MS = 500;
// Client-side stall backstop: if a launch in flight makes no observable progress
// for this long, settle the stepper into a non-animating "warning" even when the
// backend never sends its own insight.stale signal (agent died, polling failing,
// server unreachable). Sits well beyond the backend's longest per-phase budget
// (~15s) plus poll slack, so a healthy slow phase that is still emitting progress
// is never falsely flagged; this only fires when status stops updating entirely.
const IBKR_BRIDGE_LAUNCH_WATCHDOG_MS = 45_000;
const IBKR_DESKTOP_JOB_POLL_MS = 250;
const IBKR_DESKTOP_SHUTDOWN_WAIT_MS = 35_000;
// Detach/clear competes with live market-data SSE streams on the event loop, so a
// slow-but-successful clear must not be cut off and reported as a failure. Bound it
// generously; a timeout here is treated as "proceeding" (the clear is idempotent and
// teardown is already underway), not a hard error, and confirmed by the state refresh.
const IBKR_BRIDGE_DETACH_TIMEOUT_MS = 40_000;
const IBKR_CREDENTIAL_AUTOFILL_SYNC_MS = 250;

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return window.btoa(binary);
};

const encryptIbkrLoginEnvelope = async ({ publicKeyJwk, payload }) => {
  if (!window.crypto?.subtle || typeof TextEncoder === "undefined") {
    throw new Error("This browser cannot encrypt the IBKR credential handoff.");
  }

  const publicKey = await window.crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["encrypt"],
  );
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertextChunks = [];
  for (let offset = 0; offset < encoded.length; offset += IBKR_LOGIN_HANDOFF_RSA_CHUNK_SIZE) {
    const chunk = encoded.slice(offset, offset + IBKR_LOGIN_HANDOFF_RSA_CHUNK_SIZE);
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      chunk,
    );
    ciphertextChunks.push(bytesToBase64(new Uint8Array(encrypted)));
  }

  return {
    algorithm: IBKR_LOGIN_HANDOFF_ALGORITHM,
    ciphertextChunks,
  };
};

const IBKR_BRIDGE_ACTIVATION_CANCELED_CODE = "ibkr_bridge_activation_canceled";

// Sentinel raised when the user cancels mid-handoff. Carries the same code the
// backend uses for a server-side cancel so every credential-delivery caller
// already treats it as a clean cancel (clear state, no error toast) rather than
// a failure — and, critically, so we never POST credentials after a cancel.
const createIbkrLaunchCanceledError = () => {
  const error = new Error(
    "IB Gateway launch was canceled before credentials were delivered.",
  );
  error.code = IBKR_BRIDGE_ACTIVATION_CANCELED_CODE;
  return error;
};

const waitForIbkrLoginKey = async () => {
  throw new Error("The legacy IBKR desktop bridge has been retired. Use the broker Client Portal connection instead.");
};

const IBKR_LOGIN_ENVELOPE_ACCEPTED_STEPS = new Set([
  "credentials_received",
  "credentials_sent_to_pyrus",
  "gateway_login_window_wait",
  "gateway_process_started",
  "gateway_login_window_waiting",
  "gateway_login_window_active",
  "typing_gateway_credentials",
  "credentials_submitted",
  "waiting_2fa",
  "downloading_bridge_bundle",
  "bridge_bundle_ready",
  "starting_sidecar",
  "sidecar_ready",
  "preparing_bridge",
  "starting_bridge",
  "waiting_bridge_gateway_api",
  "starting_tunnel",
  "validating_tunnel",
]);

const readIbkrActivationStatus = async () => ({
  active: false,
  canceled: true,
  retired: true,
});

const ibkrActivationStatusShowsAcceptedLoginEnvelope = (payload) => {
  if (!payload || payload.canceled) {
    return false;
  }
  const progress = [
    payload.latestProgress,
    ...(Array.isArray(payload.recentProgress) ? payload.recentProgress : []),
  ];
  return progress.some((event) =>
    IBKR_LOGIN_ENVELOPE_ACCEPTED_STEPS.has(String(event?.step || "")),
  );
};

// Fire-and-forget reporting of browser-side connection events (encrypt step, envelope-POST
// outcome, timeouts) to the backend connection audit. Best-effort: never blocks or throws, so
// the credential flow is unaffected if the audit endpoint is unavailable.
const reportIbkrBrowserConnectionEvent = () => {};

const waitForIbkrDesktopJob = async () => null;

const isIbkrRemoteDesktopUnavailableError = (error) =>
  error?.status === 409 && error?.code === "ibkr_remote_desktop_unavailable";

const isTerminalIbkrLaunchError = (error) =>
  error?.status === 404 ||
  error?.code === "ibkr_bridge_activation_not_found" ||
  error?.code === "ibkr_bridge_activation_superseded" ||
  error?.code === "ibkr_bridge_activation_canceled" ||
  error?.code === "ibkr_desktop_job_not_found";

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
      color: CSS_COLOR.textDim,
    };
  }

  if (currentSeconds < openSeconds) {
    return {
      ...base,
      phase: "pre",
      label: "Pre-market",
      action: "Opens",
      timerLabel: formatClockCountdown(openSeconds - currentSeconds),
      color: CSS_COLOR.amber,
    };
  }

  if (currentSeconds < closeSeconds) {
    return {
      ...base,
      phase: "open",
      label: "Market open",
      action: "Closes",
      timerLabel: formatClockCountdown(closeSeconds - currentSeconds),
      color: CSS_COLOR.green,
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
      color: CSS_COLOR.amber,
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
    color: CSS_COLOR.textDim,
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

const HeaderIbkrDetailRow = ({
  label,
  value,
  tone = CSS_COLOR.text,
  wrap = false,
}) => (
  <div
    className="ra-hairline-bottom"
    style={{
      display: "grid",
      gridTemplateColumns: "minmax(0, 0.74fr) minmax(0, 1.26fr)",
      gap: sp(8),
      alignItems: "baseline",
      minWidth: 0,
      padding: sp("3px 0"),
      fontFamily: T.sans,
    }}
  >
    <span
      style={{
        color: CSS_COLOR.textMuted,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: tone,
        fontSize: textSize("paragraphMuted"),
        fontWeight: FONT_WEIGHTS.medium,
        fontVariantNumeric: "tabular-nums",
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
  gateway: MonitorUp,
  shieldCheck: ShieldCheck,
};

const getHeaderIbkrIcon = (iconKey) =>
  HEADER_IBKR_ICON_COMPONENTS[iconKey] || Activity;

const HeaderIbkrMetricRail = ({ tiles = [] }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: `repeat(auto-fit, minmax(${dim(132)}px, 1fr))`,
      alignItems: "stretch",
      gap: sp(5),
      minWidth: 0,
    }}
  >
    {tiles.map((tile) => {
      const Icon = getHeaderIbkrIcon(tile.iconKey);
      const label = `${tile.label}: ${tile.value ?? MISSING_VALUE}`;
      const tileNode = (
        <span
          key={tile.label}
          aria-label={label}
          style={{
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr)",
            alignItems: "center",
            columnGap: sp(6),
            rowGap: sp(1),
            minWidth: 0,
            padding: sp("5px 7px"),
            borderRadius: dim(RADII.sm),
            background: `${cssColorMix(tile.tone, 6)}`,
            color: tile.tone,
            fontFamily: T.sans,
            fontSize: textSize("paragraphMuted"),
            fontWeight: FONT_WEIGHTS.medium,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Icon
            size={dim(12)}
            strokeWidth={2.2}
            color={tile.tone}
            style={{ gridRow: "1 / span 2" }}
          />
          <span
            style={{
              minWidth: 0,
              color: CSS_COLOR.textMuted,
              fontSize: fs(8),
              fontWeight: FONT_WEIGHTS.regular,
              letterSpacing: "0.04em",
              lineHeight: 1,
              textTransform: "uppercase",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tile.label}
          </span>
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tile.value ?? MISSING_VALUE}
          </span>
        </span>
      );
      return tile.detail ? (
        <AppTooltip key={tile.label} content={`${label} · ${tile.detail}`}>
          {tileNode}
        </AppTooltip>
      ) : (
        tileNode
      );
    })}
  </div>
);

const HeaderIbkrTriggerSummary = ({
  model,
  connection,
  tone,
  latencyStats,
  compact,
  dense = false,
  minimal = false,
}) => {
  const compressed = compact || dense || minimal;
  const health = model?.health || resolveIbkrGatewayHealth({ connection });
  const issueActive = Boolean(
    model?.issue?.severity && model.issue.severity !== "healthy",
  );
  const statusTone = issueActive ? model.issue.tone : health.color || tone.color;
  const StatusIcon = issueActive
    ? getHeaderIbkrIcon(model.issue.iconKey)
    : tone.Icon;
  const pingMs = resolveHeaderIbkrPingMs(connection, latencyStats);
  const pingFlashClass = useValueFlash(pingMs, {
    enabled: Number.isFinite(pingMs),
  });

  return (
    <span
      data-testid="header-ibkr-trigger-summary"
      data-ibkr-state-pulse={tone.pulse ? "true" : undefined}
      style={{
        display: "grid",
        gap: sp(compressed ? 0 : 5),
        width: "max-content",
        minWidth: "max-content",
        animation: tone.pulse ? "ibkrStatusPulse 1.8s ease-in-out infinite" : "none",
      }}
    >
      <span
        style={{
          display: "grid",
          gridTemplateColumns: compressed
            ? "auto auto auto auto"
            : "auto auto minmax(0, 1fr) auto auto",
          alignItems: "center",
          gap: sp(compressed ? 4 : 6),
          minWidth: "max-content",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: dim(compressed ? 13 : 18),
            height: dim(compressed ? 13 : 18),
            borderRadius: 0,
            background: "transparent",
            flexShrink: 0,
          }}
        >
          <StatusIcon size={dim(compressed ? 11 : 12)} strokeWidth={2.3} color={statusTone} />
        </span>
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontSize: textSize(compressed ? "micro" : "caption"),
            fontWeight: FONT_WEIGHTS.medium,
            fontFamily: T.sans,
            letterSpacing: compressed ? 0 : "0.04em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          IBKR
        </span>
        <IbkrPingWavelength connection={connection} tone={{ ...tone, color: statusTone }} />
        <span
          className={
            pingFlashClass
              ? `${pingFlashClass} ra-value-flash--quick`
              : undefined
          }
          style={{
            color: CSS_COLOR.textSec,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            fontFamily: T.sans,
            fontVariantNumeric: "tabular-nums",
            minWidth: "max-content",
            textAlign: "right",
            whiteSpace: "nowrap",
          }}
        >
          {(() => {
            const parts = formatIbkrPingMsParts(pingMs);
            return (
              <>
                {parts.value}
                {parts.unit ? (
                  <span
                    style={{
                      fontSize: "0.7em",
                      verticalAlign: "super",
                      marginLeft: 1,
                      color: CSS_COLOR.textMuted,
                      letterSpacing: 0,
                    }}
                  >
                    {parts.unit}
                  </span>
                ) : null}
              </>
            );
          })()}
        </span>
      </span>
    </span>
  );
};

const isIbkrDeactivateOperationComplete = (model) =>
  Boolean(
    (model?.operation === "deactivate" ||
      model?.operation === "detach-bridge") &&
      Array.isArray(model.steps) &&
      model.steps.length > 0 &&
      model.steps.every((step) => step.status === "complete"),
  );

const isIbkrDetachBridgeOperation = (model) =>
  model?.operation === "detach-bridge";

const buildIbkrDeactivatedTone = (model) => ({
  color: CSS_COLOR.green,
  Icon: Power,
  label: isIbkrDetachBridgeOperation(model) ? "Detached" : "Deactivated",
  pulse: false,
});

const buildIbkrDeactivatedPopoverModel = (model) => {
  if (!model) {
    return model;
  }

  const detachBridge = isIbkrDetachBridgeOperation(model);
  const deactivatedHealth = {
    status: detachBridge ? "bridge-detached" : "deactivated",
    label: detachBridge ? "Bridge Detached" : "Deactivated",
    color: CSS_COLOR.green,
    detail: detachBridge
      ? "IBKR broker runtime was disconnected."
      : "Windows helper confirmed IB Gateway shutdown.",
  };
  const deactivatedIssue = {
    key: detachBridge ? "bridge-detached" : "deactivated",
    label: deactivatedHealth.detail,
    tone: CSS_COLOR.green,
    iconKey: "check",
    severity: "healthy",
    autoOpenDetails: false,
  };
  const tiles = Array.isArray(model.tiles)
    ? model.tiles.map((tile) =>
        tile.label === "Gateway"
          ? {
              ...tile,
              value: detachBridge ? "Detached" : "Stopped",
              tone: CSS_COLOR.green,
            }
          : tile,
      )
    : model.tiles;
  return {
    ...model,
    health: deactivatedHealth,
    issue: deactivatedIssue,
    tiles,
    priorityDetailGroup: null,
    autoOpenDetails: false,
  };
};

const HeaderIbkrConnectionSummaryMemo = memo(HeaderIbkrConnectionSummary);
const HeaderIbkrAdvancedDetailsMemo = memo(HeaderIbkrAdvancedDetails);
const HeaderIbkrOperationStepperMemo = memo(HeaderIbkrOperationStepper);

// The market clock ticks once per second. Isolating it in its own component keeps
// that 1Hz re-render out of the heavy HeaderStatusCluster body, so the main-thread
// SMIL status wave is no longer starved/jittered by a full header re-render every
// second. The wave stays smooth UNLESS there is real main-thread work, which
// preserves its value as a live load/health indicator. Mirrors the existing
// Memoized popover rows and isolated elapsed-label pattern in this file.
const HeaderMarketClock = memo(function HeaderMarketClock({
  compressed,
  surfaceStyle,
}) {
  const { preferences } = useUserPreferences();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const marketClock = buildMarketClockState(nowMs, preferences);
  return (
    <AppTooltip
      content={`${marketClock.dateLabel} · ${marketClock.timeLabel} · ${marketClock.label}`}
    >
      <div
        className="ra-hover-accent-bg"
        style={{
          ...surfaceStyle,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          width: "max-content",
          minWidth: "max-content",
          maxWidth: "none",
          gap: sp(compressed ? 3 : 0),
          overflow: "visible",
          paddingLeft: sp(compressed ? 5 : 8),
          borderLeft: `1px solid ${CSS_COLOR.borderLight}`,
        }}
      >
        <div
          style={{
            fontSize: textSize("body"),
            color: marketClock.color,
            fontFamily: T.sans,
            fontWeight: FONT_WEIGHTS.medium,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "visible",
          }}
        >
          {compressed
            ? `${marketClock.label.replace(/^Market /, "").replace("After hours", "AH")} ${marketClock.timerLabel}`
            : `${marketClock.label} ${marketClock.timerLabel}`}
        </div>
      </div>
    </AppTooltip>
  );
});

export const HeaderStatusCluster = ({
  session,
  environment,
  bridgeTone,
  theme,
  onToggleTheme,
  compact = false,
  dense = false,
  minimal = false,
  mobileSheet = false,
  showThemeToggle = true,
  safeQaMode = false,
}) => {
  const isDense = dense && !compact;
  const compressed = compact || isDense || minimal;
  const bridgePopoverAsSheet = mobileSheet;
  const queryClient = useQueryClient();
  const toast = useToast();
  const bridgeTriggerRef = useRef(null);
  const bridgePopoverRef = useRef(null);
  const autoLoginUsernameInputRef = useRef(null);
  const autoLoginPasswordInputRef = useRef(null);
  const bridgePendingAutoLoginCredentialsRef = useRef(null);
  const bridgeCredentialAutoResumeAttemptRef = useRef(null);
  const bridgeRecognitionRefreshTimerRef = useRef(null);
  const bridgeLaunchCancelRequestedRef = useRef(false);
  const [bridgePopoverOpen, setBridgePopoverOpen] = useState(false);
  const [bridgePopoverPosition, setBridgePopoverPosition] = useState(null);
  const [, setBridgeLaunchUrl] = useState(() =>
    readIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.launchUrl),
  );
  const [bridgeActivationId, setBridgeActivationId] = useState(() =>
    readIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.activationId),
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
  const [bridgeActivationActive, setBridgeActivationActive] = useState(false);
  const [bridgeLauncherBusy, setBridgeLauncherBusy] = useState(false);
  const [bridgeLaunchCancelInFlight, setBridgeLaunchCancelInFlight] =
    useState(false);
  const [bridgeLauncherError, setBridgeLauncherError] = useState(null);
  const [bridgeLauncherNotice, setBridgeLauncherNotice] = useState(null);
  const [bridgeActivationStatus, setBridgeActivationStatus] = useState(null);
  const [bridgeManualOperationModel, setBridgeManualOperationModel] =
    useState(null);
  // The market clock now ticks inside <HeaderMarketClock>, so the header no longer
  // re-renders every second. The only parent state that needed the clock is the
  // launch-in-flight expiry below, which reads Date.now() at render time; this
  // one-shot timer re-renders exactly once when the in-flight window lapses so the
  // "launch in flight" UI still clears promptly without a per-second re-render.
  const [, setLaunchExpiryTick] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const remainingMs = bridgeLaunchInFlightUntil - Date.now();
    if (remainingMs <= 0) {
      return undefined;
    }
    const timer = window.setTimeout(
      () => setLaunchExpiryTick((tick) => tick + 1),
      remainingMs + 50,
    );
    return () => window.clearTimeout(timer);
  }, [bridgeLaunchInFlightUntil]);
  // getIbkrConnection returns the stable session connection when connected, but
  // a fresh fallbackConnection literal every call when disconnected. Memoizing on
  // session (stable across market-clock ticks) keeps gatewayConnection — a dep of
  // the popover model memo and gatewayTone — referentially stable in BOTH states,
  // so the popover model/children don't rebuild every tick while disconnected.
  const gatewayConnection = useMemo(
    () => getIbkrConnection(session, "tws"),
    [session],
  );
  // getIbkrConnectionTone returns a fresh object literal each call; memoize it so
  // the memoized trigger summary isn't re-rendered every market-clock tick.
  const gatewayTone = useMemo(
    () => getIbkrConnectionTone(gatewayConnection),
    [gatewayConnection],
  );
  // ── Broker connection lifecycle toasts ──
  // The connection flow was previously toast-silent. Surface the two events the user
  // cares about: the broker reaching "online" (connected/streaming) and leaving it
  // (disconnect/reconnect), plus any launch/credential/activation failure (all of which
  // funnel into bridgeLauncherError). A short post-mount arming window suppresses the
  // hydration-time flip so a page refresh while already connected doesn't toast.
  const brokerStatusLabel = gatewayTone?.label || "offline";
  const brokerOnline = brokerStatusLabel === "online";
  const brokerOnlineRef = useRef(null);
  const brokerToastArmAtRef = useRef(Date.now() + 4000);
  useEffect(() => {
    const prev = brokerOnlineRef.current;
    brokerOnlineRef.current = brokerOnline;
    if (prev === null || prev === brokerOnline) return;
    if (Date.now() < brokerToastArmAtRef.current) return;
    toast.push(
      brokerOnline
        ? {
            kind: "success",
            title: "IBKR broker connected",
            body: "Live market data and trading are active.",
          }
        : {
            kind: "warn",
            title: "IBKR broker disconnected",
            body: `Connection status: ${brokerStatusLabel}.`,
          },
    );
  }, [brokerOnline, brokerStatusLabel, toast]);
  const bridgeLauncherErrorRef = useRef(null);
  useEffect(() => {
    const prev = bridgeLauncherErrorRef.current;
    bridgeLauncherErrorRef.current = bridgeLauncherError;
    if (bridgeLauncherError && bridgeLauncherError !== prev) {
      toast.push({
        kind: "error",
        title: "IBKR connection error",
        body: bridgeLauncherError,
      });
    }
  }, [bridgeLauncherError, toast]);
  const gatewayLatencyStats = useIbkrLatencyStats(bridgePopoverOpen);
  const activeGatewayLatencyStats = bridgePopoverOpen ? gatewayLatencyStats : null;
  const sessionIbkrRuntime = session?.runtime?.ibkr || null;
  const bridgeLaunchSessionInFlight = bridgeLaunchInFlightUntil > Date.now();
  // The snapshot is NOT a function of the 1s market clock (its launch-activity
  // gate is carried by the stable `inFlight` boolean below). Keep the raw clock
  // out of the memo so the connection snapshot — which feeds the SMIL ping wave —
  // does not rebuild every second during a launch and restart the animation.
  const gatewayBrokerSnapshot = useMemo(
    () =>
      buildIbkrConnectionSnapshot({
        session,
        connection: gatewayConnection,
        runtime: sessionIbkrRuntime,
        launch: {
          activationId: bridgeActivationId,
          managementToken: bridgeManagementToken,
          inFlight: bridgeLaunchSessionInFlight,
          inFlightUntil: bridgeLaunchInFlightUntil,
          busy: bridgeLauncherBusy,
          cancelInFlight: bridgeLaunchCancelInFlight,
        },
      }),
    [
      bridgeActivationId,
      bridgeLaunchCancelInFlight,
      bridgeLaunchSessionInFlight,
      bridgeLaunchInFlightUntil,
      bridgeLauncherBusy,
      bridgeManagementToken,
      gatewayConnection,
      session,
      sessionIbkrRuntime,
    ],
  );
  const gatewayRuntimeActivityPresent = gatewayBrokerSnapshot.activityPresent;
  const gatewayRuntimeError = null;
  const gatewayRuntimeDiagnostics = useMemo(
    () => gatewayBrokerSnapshot.runtimeDiagnostics,
    [gatewayBrokerSnapshot.runtimeDiagnostics],
  );
  const gatewayTriggerModel = useMemo(
    () =>
      buildHeaderIbkrTriggerModel({
        connection: gatewayConnection,
        runtimeDiagnostics: gatewayRuntimeDiagnostics,
        runtimeError: gatewayRuntimeError,
      }),
    [
      gatewayConnection,
      gatewayRuntimeDiagnostics,
      gatewayRuntimeError,
    ],
  );
  const gatewayPopoverModel = useMemo(
    () => {
      if (!bridgePopoverOpen) {
        return gatewayTriggerModel;
      }
      return buildHeaderIbkrPopoverModel({
        connection: gatewayConnection,
        latencyStats: activeGatewayLatencyStats,
        runtimeDiagnostics: gatewayRuntimeDiagnostics,
        runtimeError: gatewayRuntimeError,
      });
    },
    [
      activeGatewayLatencyStats,
      bridgePopoverOpen,
      gatewayConnection,
      gatewayTriggerModel,
      gatewayRuntimeDiagnostics,
      gatewayRuntimeError,
    ],
  );
  const bridgeRuntimeOverrideActive = Boolean(
    gatewayRuntimeDiagnostics?.ibkr?.runtimeOverrideActive ||
      sessionIbkrRuntime?.runtimeOverrideActive,
  );
  const ibkrRuntimeState =
    gatewayRuntimeDiagnostics?.ibkr || sessionIbkrRuntime || null;
  const bridgeActivationDiagnostics = ibkrRuntimeState?.activation || null;
  const bridgeRuntimeActivationActiveCount = Number(
    bridgeActivationDiagnostics?.activeCount ?? 0,
  );
  const bridgeRuntimeActivation =
    bridgeActivationDiagnostics?.latestActivation || null;
  const bridgeRuntimeActivationStillActive = Boolean(
    bridgeRuntimeActivationActiveCount > 0 &&
      bridgeRuntimeActivation &&
      bridgeRuntimeActivation.canceled !== true,
  );
  const gatewayConnectedForBridge = isIbkrGatewayBridgeAttached({
    connection: gatewayConnection,
    runtime: ibkrRuntimeState,
  });
  const desktopHelperKnownBad = Boolean(
    ibkrRuntimeState?.desktopAgentKnownBad ||
      ibkrRuntimeState?.desktopAgentCompatibility === "known_bad",
  );
  const desktopHelperUpgradeRequired = Boolean(
    ibkrRuntimeState?.desktopAgentUpgradeRequired,
  );
  const desktopReconnectNeeded = Boolean(
    !gatewayConnectedForBridge &&
      (ibkrRuntimeState?.desktopAgentOnline ||
        desktopHelperKnownBad ||
        desktopHelperUpgradeRequired ||
        (!bridgeRuntimeOverrideActive && ibkrRuntimeState?.reconnectAvailable)),
  );
  const desktopReconnectReady = Boolean(
    desktopReconnectNeeded &&
      ibkrRuntimeState?.desktopAgentOnline &&
      ibkrRuntimeState?.reconnectAvailable,
  );
  const desktopReconnectKnownBad = Boolean(
    desktopReconnectNeeded && desktopHelperKnownBad,
  );
  const desktopReconnectUpgradeRequired = Boolean(
    desktopReconnectNeeded && desktopHelperUpgradeRequired,
  );
  const desktopReconnectNeedsHelperUpdate = Boolean(
    desktopReconnectKnownBad || desktopReconnectUpgradeRequired,
  );
  const bridgeLaunchInFlight = Boolean(
    !gatewayConnectedForBridge &&
      (bridgeLaunchInFlightUntil > Date.now() ||
        (bridgeActivationId &&
          bridgeManagementToken &&
          bridgeRuntimeActivationStillActive)),
  );
  const gatewayReconnectNeeded = Boolean(
    (session?.configured?.ibkr && !gatewayConnectedForBridge) ||
      desktopReconnectNeeded,
  );
  const bridgePopoverMessage =
    bridgeLauncherError ||
    bridgeLauncherNotice ||
    (bridgeLaunchInFlight
      ? "IB Gateway activation is running from the Windows helper. Wait for the bridge to attach before launching again."
      : null);
  // Watchdog: a stable key that changes only when the launch makes observable
  // progress (new step/status, more events, or the backend stale flag flips).
  const bridgeLaunchProgressKey = useMemo(() => {
    const latestProgress = bridgeActivationStatus?.latestProgress || null;
    return [
      bridgeActivationId || "",
      bridgeActivationStatus?.recentProgress?.length || 0,
      String(latestProgress?.step || ""),
      String(latestProgress?.status || ""),
      bridgeActivationStatus?.insight?.stale ? "stale" : "",
    ].join("|");
  }, [bridgeActivationId, bridgeActivationStatus]);
  const bridgeLaunchProgressStampRef = useRef({ key: "", at: 0 });
  const [bridgeLaunchWatchdogTick, setBridgeLaunchWatchdogTick] = useState(0);
  // Re-stamp the moment observable progress changes, so the silence timer resets.
  useEffect(() => {
    bridgeLaunchProgressStampRef.current = {
      key: bridgeLaunchProgressKey,
      at: Date.now(),
    };
    setBridgeLaunchWatchdogTick((tick) => tick + 1);
  }, [bridgeLaunchProgressKey]);
  // Tick once per second while a launch is genuinely in flight so the silence
  // check below re-evaluates without depending on any backend message arriving.
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !bridgeLaunchInFlight ||
      gatewayConnectedForBridge
    ) {
      return undefined;
    }
    const timerId = window.setInterval(() => {
      setBridgeLaunchWatchdogTick((tick) => tick + 1);
    }, 1_000);
    return () => window.clearInterval(timerId);
  }, [bridgeLaunchInFlight, gatewayConnectedForBridge]);
  const bridgeLaunchLocallyStale = useMemo(() => {
    if (!bridgeLaunchInFlight || gatewayConnectedForBridge) {
      return false;
    }
    const stampedAt = bridgeLaunchProgressStampRef.current.at;
    if (!stampedAt) {
      return false;
    }
    // bridgeLaunchWatchdogTick is the re-evaluation trigger; the comparison is on
    // wall-clock silence since the last observable progress change.
    void bridgeLaunchWatchdogTick;
    return Date.now() - stampedAt >= IBKR_BRIDGE_LAUNCH_WATCHDOG_MS;
  }, [bridgeLaunchInFlight, gatewayConnectedForBridge, bridgeLaunchWatchdogTick]);
  const bridgeLaunchOperationModel = useMemo(() => {
    const launchRequestPending = Boolean(
      bridgeLauncherBusy && !bridgeLaunchCancelInFlight,
    );
    const hasProgress = Boolean(
      bridgeActivationStatus?.latestProgress ||
        bridgeActivationStatus?.recentProgress?.length,
    );
    const hasTerminalLaunchState = Boolean(
      bridgeActivationStatus?.canceled ||
        (bridgeLauncherError && hasProgress) ||
        gatewayConnectedForBridge,
    );
    if (
      !launchRequestPending &&
      !bridgeLaunchInFlight &&
      !hasProgress &&
      !hasTerminalLaunchState
    ) {
      return null;
    }
    return buildIbkrLaunchOperationStepper({
      activationStatus: bridgeActivationStatus,
      error: bridgeLauncherError,
      gatewayConnected: gatewayConnectedForBridge,
      inFlight: bridgeLaunchInFlight || launchRequestPending,
      message: gatewayConnectedForBridge
        ? "IB Gateway bridge attached."
        : bridgePopoverMessage,
      stale: bridgeLaunchLocallyStale,
    });
  }, [
    bridgeActivationStatus,
    bridgeLaunchCancelInFlight,
    bridgeLaunchInFlight,
    bridgeLaunchLocallyStale,
    bridgeLauncherError,
    bridgeLauncherBusy,
    bridgePopoverMessage,
    gatewayConnectedForBridge,
  ]);
  const bridgeOperationModel =
    bridgeManualOperationModel || bridgeLaunchOperationModel;
  const bridgeDeactivationComplete =
    isIbkrDeactivateOperationComplete(bridgeOperationModel);
  const bridgeDeactivatedTone = bridgeDeactivationComplete
    ? buildIbkrDeactivatedTone(bridgeOperationModel)
    : null;
  const displayedBridgeTone = bridgeDeactivatedTone || bridgeTone;
  const displayedGatewayTone = bridgeDeactivatedTone || gatewayTone;
  const displayedGatewayPopoverModel = useMemo(
    () =>
      bridgeDeactivationComplete
        ? buildIbkrDeactivatedPopoverModel(gatewayPopoverModel)
        : gatewayPopoverModel,
    [bridgeDeactivationComplete, gatewayPopoverModel],
  );
  const bridgeConnectionInsightModel = useMemo(() => {
    if (bridgeOperationModel?.operation && bridgeOperationModel.operation !== "launch") {
      return null;
    }
    return buildIbkrConnectionInsightModel({
      activationStatus: bridgeActivationStatus,
      bridgeOperationModel,
      busy: bridgeLauncherBusy,
      cancelInFlight: bridgeLaunchCancelInFlight,
      error: bridgeLauncherError,
      gatewayConnected: gatewayConnectedForBridge,
      inFlight: bridgeLaunchInFlight,
    });
  }, [
    bridgeActivationStatus,
    bridgeLaunchCancelInFlight,
    bridgeLaunchInFlight,
    bridgeLauncherBusy,
    bridgeLauncherError,
    bridgeOperationModel,
    gatewayConnectedForBridge,
  ]);
  const popoverLatencyMs = Number.isFinite(gatewayConnection?.lastPingMs)
    ? gatewayConnection.lastPingMs
    : activeGatewayLatencyStats?.totalMs?.p95;
  const popoverLatencyLabel = formatIbkrPingMs(popoverLatencyMs);
  const desktopAgentOnlineForLaunch =
    ibkrRuntimeState?.desktopAgentOnline === true;
  const desktopAgentRegisteredForLaunch = Boolean(
    ibkrRuntimeState?.desktopAgentRegistered === true ||
      Number(ibkrRuntimeState?.desktopAgentRegisteredCount || 0) > 0,
  );
  const desktopAgentCompatibleForLaunch =
    ibkrRuntimeState?.desktopAgentCompatible !== false;
  const desktopAgentUpgradeRequiredForLaunch =
    ibkrRuntimeState?.desktopAgentUpgradeRequired === true;
  const remoteDesktopLaunchBrowser = false;
  const bridgeActivationLoginHandoffReady =
    bridgeRuntimeActivation?.loginHandoffReady === true;
  const bridgeActivationLoginKeyReadCount = Number(
    bridgeRuntimeActivation?.loginKeyReadCount ?? 0,
  );
  const bridgeActivationLoginEnvelopeSubmitAttemptCount = Number(
    bridgeRuntimeActivation?.loginEnvelopeSubmitAttemptCount ?? 0,
  );
  const bridgeActivationLoginEnvelopeSubmitted =
    bridgeRuntimeActivation?.loginEnvelopeSubmitted === true;
  const bridgeActivationRemoteLaunchQueued = Boolean(
    bridgeRuntimeActivation?.timings?.launchJobCreatedAt,
  );
  const bridgeDirectActivationShouldRelaunchRemotely = Boolean(
    !gatewayConnectedForBridge &&
      bridgeActivationId &&
      bridgeManagementToken &&
      bridgeLaunchInFlight &&
      remoteDesktopLaunchBrowser &&
      bridgeRuntimeActivation &&
      !bridgeActivationRemoteLaunchQueued &&
      !bridgeActivationLoginHandoffReady,
  );
  const bridgeDirectActivationShouldRestartLocally = Boolean(
    !gatewayConnectedForBridge &&
      bridgeActivationId &&
      bridgeManagementToken &&
      bridgeLaunchInFlight &&
      !remoteDesktopLaunchBrowser &&
      bridgeRuntimeActivation &&
      bridgeActivationRemoteLaunchQueued &&
      !bridgeActivationLoginHandoffReady,
  );
  const bridgeDirectActivationShouldReplaceCurrentLaunch = Boolean(
    bridgeDirectActivationShouldRelaunchRemotely ||
      bridgeDirectActivationShouldRestartLocally,
  );
  const credentialActionState = resolveIbkrCredentialActionState({
    activationActive:
      bridgeActivationActive ||
      bridgeActivationStatus?.active === true ||
      bridgeRuntimeActivationStillActive,
    activationId: bridgeActivationId,
    directActivationShouldReplaceCurrentLaunch:
      bridgeDirectActivationShouldReplaceCurrentLaunch,
    gatewayConnected: gatewayConnectedForBridge,
    launchInFlight: bridgeLaunchInFlight || bridgeLauncherBusy,
    managementToken: bridgeManagementToken,
    runtimeActivationActive: bridgeRuntimeActivationStillActive,
  });
  const bridgeLaunchCancelable = credentialActionState.launchCancelable;
  const bridgeCredentialResumeAvailable =
    credentialActionState.resumeAvailable;
  const autoLoginPrimaryBlockedByActiveLaunch =
    credentialActionState.primaryBlockedByActiveLaunch;
  const bridgeProcessActions = resolveIbkrBridgeProcessActions({
    bridgeDeactivationComplete,
    bridgeLaunchCancelable,
    bridgeLaunchInFlight,
    bridgeManagementToken,
    bridgeRuntimeOverrideActive,
    gatewayConnectedForBridge,
    runtime: ibkrRuntimeState,
  });
  const bridgeDeactivateAction = bridgeProcessActions.deactivateAction;
  const bridgeCancelLaunchAction = bridgeProcessActions.cancelLaunchAction;
  const canDeactivate = Boolean(bridgeDeactivateAction);
  const bridgeCredentialSecondaryCancelsLaunch =
    Boolean(bridgeCancelLaunchAction);
  const bridgeCredentialSecondaryActionDisabled = Boolean(
    bridgeCredentialSecondaryCancelsLaunch
      ? bridgeLaunchCancelInFlight
      : bridgeLauncherBusy,
  );
  const autoLoginActionDisabled = Boolean(
    gatewayConnectedForBridge ||
      bridgeLaunchCancelInFlight ||
      bridgeLauncherBusy ||
      autoLoginPrimaryBlockedByActiveLaunch ||
      (!bridgeLaunchCancelable && bridgeLaunchInFlight),
  );
  const autoLoginCredentialsOptional = Boolean(
    desktopReconnectNeedsHelperUpdate && !bridgeLauncherBusy && !bridgeLaunchInFlight,
  );
  const autoLoginProgressActionLabel = getIbkrLaunchActionProgressLabel({
    activationStatus: bridgeActivationStatus,
    busy: bridgeLauncherBusy,
    inFlight: bridgeLaunchInFlight,
  });
  let autoLoginActionLabel = "Retired connection";
  if (bridgeDirectActivationShouldRelaunchRemotely) {
    autoLoginActionLabel = "Launch on desktop";
  } else if (bridgeDirectActivationShouldRestartLocally) {
    autoLoginActionLabel = "Reconnect with credentials";
  } else if (bridgeCredentialResumeAvailable) {
    autoLoginActionLabel = "Send credentials";
  } else if (bridgeLauncherBusy || bridgeLaunchInFlight || bridgeLaunchCancelInFlight) {
    autoLoginActionLabel = autoLoginProgressActionLabel;
  } else if (desktopReconnectKnownBad) {
    autoLoginActionLabel = "Launch and repair helper";
  } else if (desktopReconnectUpgradeRequired) {
    autoLoginActionLabel = "Launch and update helper";
  } else if (desktopReconnectReady) {
    autoLoginActionLabel = "Reconnect on desktop";
  } else if (remoteDesktopLaunchBrowser) {
    autoLoginActionLabel = "Launch on desktop";
  } else if (gatewayReconnectNeeded) {
    autoLoginActionLabel = "Reconnect with credentials";
  }
  // When a runtime override is still active but the bridge is not attached (e.g. a
  // stale/dead override after the gateway dropped), the deactivate/detach control is
  // shown. Don't also render the launch form in that case — the two together read as
  // a contradiction ("Detach bridge" + "Launch"). Surface the detach/reconnect
  // control first; the launch form returns once the stale override is cleared.
  const showCredentialForm = !gatewayConnectedForBridge && !canDeactivate;
  const surfaceStyle = {
    display: "flex",
    alignItems: "center",
    gap: sp(compressed ? 3 : 6),
    width: "max-content",
    minWidth: "max-content",
    minHeight: dim(compressed ? 22 : 34),
    padding: sp(compressed ? "0px 4px" : "3px 8px"),
    boxSizing: "border-box",
    background: "transparent",
    border: "none",
    borderRadius: 0,
    overflow: "visible",
    flex: "0 0 max-content",
    transition: "background var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease",
  };
  const microLabelStyle = {
    fontSize: textSize(compressed ? "micro" : "caption"),
    fontWeight: FONT_WEIGHTS.medium,
    fontFamily: T.sans,
    color: CSS_COLOR.textMuted,
    letterSpacing: compressed ? 0 : "0.04em",
    textTransform: "uppercase",
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

  const refreshIbkrConnectionStatus = useCallback(() => {
    const pending = [
      queryClient.refetchQueries({
        queryKey: ["/api/session"],
        exact: true,
        type: "active",
      }),
    ];
    return Promise.allSettled(pending);
  }, [queryClient]);

  const openBridgeReconnectPopover = useCallback(() => {
    setBridgePopoverOpen(true);
    setBridgeManualOperationModel(null);
    if (!bridgeLauncherBusy && !bridgeLaunchInFlight) {
      setBridgeLauncherError(null);
      setBridgeLauncherNotice(null);
    }
    if (typeof window !== "undefined") {
      window.setTimeout(() => autoLoginUsernameInputRef.current?.focus?.(), 0);
    }
  }, [bridgeLaunchInFlight, bridgeLauncherBusy]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleReconnectRequest = () => {
      openBridgeReconnectPopover();
    };
    window.addEventListener(
      IBKR_RECONNECT_REQUEST_EVENT,
      handleReconnectRequest,
    );
    return () => {
      window.removeEventListener(
        IBKR_RECONNECT_REQUEST_EVENT,
        handleReconnectRequest,
      );
    };
  }, [openBridgeReconnectPopover]);

  const stopBridgeRecognitionRefresh = useCallback(() => {
    if (
      bridgeRecognitionRefreshTimerRef.current !== null &&
      typeof window !== "undefined"
    ) {
      window.clearInterval(bridgeRecognitionRefreshTimerRef.current);
    }
    bridgeRecognitionRefreshTimerRef.current = null;
  }, []);

  const clearBridgeLaunchSessionState = useCallback(() => {
    bridgePendingAutoLoginCredentialsRef.current = null;
    setBridgeActivationActive(false);
    setBridgeActivationStatus(null);
    setBridgeLaunchCancelInFlight(false);
    setBridgeLaunchInFlightUntil(0);
    setBridgeActivationId(null);
    setBridgeManagementToken(null);
    setBridgeLaunchUrl(null);
    removeIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.activationId);
    removeIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.launchInFlightUntil);
    removeIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.launchUrl);
    removeIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.managementToken);
    stopBridgeRecognitionRefresh();
    invalidateIbkrRuntimeQueries(queryClient);
  }, [queryClient, stopBridgeRecognitionRefresh]);

  useEffect(() => {
    if (
      bridgeLauncherBusy ||
      gatewayConnectedForBridge ||
      !bridgeLaunchInFlight ||
      !bridgeActivationDiagnostics ||
      bridgeRuntimeActivationActiveCount !== 0
    ) {
      return;
    }

    setBridgeLauncherNotice(null);
    clearBridgeLaunchSessionState();
  }, [
    bridgeActivationDiagnostics,
    bridgeLaunchInFlight,
    bridgeLauncherBusy,
    bridgeRuntimeActivationActiveCount,
    clearBridgeLaunchSessionState,
    gatewayConnectedForBridge,
  ]);

  const startBridgeRecognitionRefresh = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    stopBridgeRecognitionRefresh();
    const deadline = Date.now() + IBKR_BRIDGE_CREDENTIAL_LAUNCH_WINDOW_MS;
    const refresh = () => {
      if (Date.now() >= deadline) {
        stopBridgeRecognitionRefresh();
        return;
      }
      void refreshIbkrConnectionStatus();
    };

    refresh();
    bridgeRecognitionRefreshTimerRef.current = window.setInterval(
      refresh,
      IBKR_BRIDGE_RECOGNITION_POLL_MS,
    );
  }, [
    refreshIbkrConnectionStatus,
    stopBridgeRecognitionRefresh,
  ]);

  useEffect(() => {
    if (!bridgeActivationId || !bridgeManagementToken || gatewayConnectedForBridge) {
      setBridgeActivationActive(false);
      return undefined;
    }
    setBridgeActivationActive(false);
    clearBridgeLaunchSessionState();
    void refreshIbkrConnectionStatus();
    return undefined;
  }, [
    bridgeActivationId,
    bridgeManagementToken,
    clearBridgeLaunchSessionState,
    gatewayConnectedForBridge,
    refreshIbkrConnectionStatus,
  ]);

  useEffect(() => {
    if (!gatewayConnectedForBridge || bridgeLaunchInFlightUntil <= 0) {
      return;
    }
    setBridgeLauncherNotice(null);
    setBridgeLauncherError(null);
    clearBridgeLaunchSessionState();
  }, [
    bridgeLaunchInFlightUntil,
    clearBridgeLaunchSessionState,
    gatewayConnectedForBridge,
  ]);

  useEffect(() => {
    if (!bridgeLaunchInFlight || gatewayConnectedForBridge) {
      return;
    }
    startBridgeRecognitionRefresh();
    return stopBridgeRecognitionRefresh;
  }, [
    bridgeLaunchInFlight,
    gatewayConnectedForBridge,
    startBridgeRecognitionRefresh,
    stopBridgeRecognitionRefresh,
  ]);

  useEffect(() => stopBridgeRecognitionRefresh, [stopBridgeRecognitionRefresh]);

  useEffect(() => {
    if (!bridgePopoverOpen || !bridgePopoverAsSheet || typeof document === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [bridgePopoverAsSheet, bridgePopoverOpen]);

  useLayoutEffect(() => {
    if (!bridgePopoverOpen) {
      setBridgePopoverPosition(null);
      return;
    }

    if (bridgePopoverAsSheet) {
      setBridgePopoverPosition(null);
      return;
    }

    updateBridgePopoverPosition();
  }, [bridgePopoverAsSheet, bridgePopoverOpen, updateBridgePopoverPosition]);

  useEffect(() => {
    if (!bridgePopoverOpen) {
      setBridgePopoverPosition(null);
      return;
    }

    if (bridgePopoverAsSheet) {
      setBridgePopoverPosition(null);
    } else {
      updateBridgePopoverPosition();
    }

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

    // Scrolling *inside* the popover never moves the trigger anchor, but the
    // capture-phase scroll listener fires for those scrolls too — and each call
    // forces a getBoundingClientRect (layout) + setBridgePopoverPosition (full
    // re-render). That made popover scrolling far jankier than the rest of the
    // app. Reposition only for scrolls that originate outside the popover.
    const handleScrollReposition = (event) => {
      const target = event.target;
      if (target instanceof Node && bridgePopoverRef.current?.contains(target)) {
        return;
      }
      updateBridgePopoverPosition();
    };

    if (!bridgePopoverAsSheet) {
      window.addEventListener("resize", updateBridgePopoverPosition);
      window.addEventListener("scroll", handleScrollReposition, true);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      if (!bridgePopoverAsSheet) {
        window.removeEventListener("resize", updateBridgePopoverPosition);
        window.removeEventListener("scroll", handleScrollReposition, true);
      }
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [bridgePopoverAsSheet, bridgePopoverOpen, updateBridgePopoverPosition]);

  const appendBridgeActivationProgress = useCallback(
    ({ activationId, message, status, step }) => {
      if (!step) {
        return;
      }
      setBridgeActivationStatus((current) => {
        const recentProgress = Array.isArray(current?.recentProgress)
          ? current.recentProgress
          : [];
        const latestProgress = {
          activationId:
            activationId || current?.latestProgress?.activationId || null,
          bridgeUrl: null,
          helperVersion:
            ibkrRuntimeState?.desktopAgentExpectedHelperVersion || null,
          message,
          status,
          step,
          updatedAt: new Date().toISOString(),
        };
        return {
          ...(current || {}),
          active: current?.active ?? true,
          canceled: current?.canceled ?? false,
          latestProgress,
          recentProgress: [...recentProgress, latestProgress].slice(-20),
        };
      });
    },
    [ibkrRuntimeState?.desktopAgentExpectedHelperVersion],
  );

  const markBridgeActivationCanceled = useCallback(
    ({ activationId, message }) => {
      const latestProgress = {
        activationId,
        status: "canceled",
        step: "cancel_requested",
        message,
        helperVersion: null,
        bridgeUrl: null,
        updatedAt: new Date().toISOString(),
      };
      setBridgeActivationStatus((current) => {
        const recentProgress = Array.isArray(current?.recentProgress)
          ? current.recentProgress
          : [];
        return {
          ...(current || {}),
          active: false,
          canceled: true,
          expiresAt: current?.expiresAt || new Date().toISOString(),
          latestProgress,
          recentProgress: [...recentProgress, latestProgress].slice(-20),
        };
      });
    },
    [],
  );

  const deliverIbkrLoginCredentials = useCallback(
    async () => {
      clearBridgeLaunchSessionState();
      throw new Error(
        "The legacy IBKR desktop bridge has been retired. Use the broker Client Portal connection instead.",
      );
    },
    [clearBridgeLaunchSessionState],
  );

  useEffect(() => {
    const activationId = bridgeActivationId;
    const managementToken = bridgeManagementToken;
    const pendingCredentials = bridgePendingAutoLoginCredentialsRef.current;
    const usePendingCredentials =
      pendingCredentials &&
      (!pendingCredentials.activationId ||
        pendingCredentials.activationId === activationId);
    const username = usePendingCredentials
      ? pendingCredentials.username
      : autoLoginUsernameInputRef.current?.value?.trim() || "";
    const password = usePendingCredentials
      ? pendingCredentials.password
      : autoLoginPasswordInputRef.current?.value || "";
    const shouldResume = shouldAutoResumeIbkrCredentials({
      activationId,
      attemptedActivationId: bridgeCredentialAutoResumeAttemptRef.current,
      directActivationShouldReplaceCurrentLaunch:
        bridgeDirectActivationShouldReplaceCurrentLaunch,
      gatewayConnected: gatewayConnectedForBridge,
      launchCancelInFlight: bridgeLaunchCancelInFlight,
      loginEnvelopeSubmitAttemptCount:
        bridgeActivationLoginEnvelopeSubmitAttemptCount,
      loginEnvelopeSubmitted: bridgeActivationLoginEnvelopeSubmitted,
      loginHandoffReady: bridgeActivationLoginHandoffReady,
      loginKeyReadCount: bridgeActivationLoginKeyReadCount,
      managementToken,
      password,
      runtimeActivationActive: bridgeRuntimeActivationStillActive,
      username,
    });
    if (!shouldResume) {
      return undefined;
    }

    bridgeCredentialAutoResumeAttemptRef.current = activationId;
    // Auto-resume is an intentional (re)start of delivery, like a manual submit,
    // so clear any stale user-cancel flag from a prior flow before delivering —
    // otherwise the new deliver's abort guard would suppress a legitimate resume.
    bridgeLaunchCancelRequestedRef.current = false;
    let canceled = false;
    setBridgeManualOperationModel(null);
    setBridgePopoverOpen(true);
    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);
    setBridgeLauncherNotice(
      "Sending credentials to the active Windows helper.",
    );

    void (async () => {
      try {
        if (canceled) {
          return;
        }
        const deliveryResult = await deliverIbkrLoginCredentials({
          activationId,
          managementToken,
          username,
          password,
        });
        if (
          !canceled &&
          deliveryResult?.delivered &&
          autoLoginPasswordInputRef.current
        ) {
          bridgePendingAutoLoginCredentialsRef.current = null;
          autoLoginPasswordInputRef.current.value = "";
        }
      } catch (error) {
        if (canceled) {
          return;
        }
        if (
          bridgeLaunchCancelRequestedRef.current ||
          error?.code === "ibkr_bridge_activation_canceled"
        ) {
          setBridgeLauncherError(null);
          clearBridgeLaunchSessionState();
          return;
        }
        setBridgeLauncherError(
          error instanceof Error ? error.message : "IBKR auto-login failed.",
        );
      } finally {
        if (!canceled) {
          setBridgeLauncherBusy(false);
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [
    bridgeActivationId,
    bridgeActivationLoginEnvelopeSubmitAttemptCount,
    bridgeActivationLoginEnvelopeSubmitted,
    bridgeActivationLoginHandoffReady,
    bridgeActivationLoginKeyReadCount,
    bridgeDirectActivationShouldReplaceCurrentLaunch,
    bridgeLaunchCancelInFlight,
    bridgeManagementToken,
    bridgeRuntimeActivationStillActive,
    clearBridgeLaunchSessionState,
    deliverIbkrLoginCredentials,
    gatewayConnectedForBridge,
  ]);

  const handleSubmitAutoLogin = useCallback(async () => {
    bridgeLaunchCancelRequestedRef.current = false;
    bridgePendingAutoLoginCredentialsRef.current = null;
    setBridgeManualOperationModel(null);
    setBridgePopoverOpen(true);
    setBridgeLauncherBusy(false);
    setBridgeLauncherNotice(null);
    setBridgeLauncherError(
      "The legacy IBKR desktop bridge has been retired. Use the broker Client Portal connection instead.",
    );
    clearBridgeLaunchSessionState();
    return { credentialsDelivered: false };
  }, [
    clearBridgeLaunchSessionState,
  ]);

  const handleCancelBridgeLaunch = useCallback(async () => {
    bridgeLaunchCancelRequestedRef.current = true;
    setBridgeLaunchCancelInFlight(true);
    setBridgeLauncherError(null);
    setBridgeLauncherNotice("Legacy IBKR desktop bridge launch cleared.");
    setBridgeActivationActive(false);
    setBridgeManualOperationModel(null);
    clearBridgeLaunchSessionState();
    setBridgeLauncherBusy(false);
    setBridgeLaunchCancelInFlight(false);
  }, [
    clearBridgeLaunchSessionState,
  ]);

  const handleDeactivate = useCallback(async () => {
    const action = bridgeDeactivateAction;
    if (!action) {
      return;
    }
    const buildDeactivateModel = (state = {}) =>
      buildIbkrDeactivateOperationStepper({
        variant: action.stepperVariant,
        ...state,
      });
    const detachingBridgeOnly = action.stepperVariant === "clear-state";

    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);
    setBridgeLauncherNotice(null);
    setBridgeActivationStatus(null);
    setBridgeManualOperationModel(
      buildDeactivateModel({
        detach: detachingBridgeOnly ? "current" : "pending",
        queue: "complete",
        message: "Clearing retired IBKR desktop bridge state.",
      }),
    );

    try {
      setBridgeManualOperationModel(
        buildDeactivateModel({
          queue: "complete",
          detach: "current",
          message: "Clearing retired IBKR desktop bridge state.",
        }),
      );

      setBridgeLauncherNotice("Clearing retired IBKR desktop bridge state.");
      setBridgeManualOperationModel(
        buildDeactivateModel({
          queue: "complete",
          detach: "complete",
          refresh: "current",
          message: "Retired IBKR desktop bridge state cleared. Refreshing connection state.",
        }),
      );
      setBridgeManagementToken(null);
      setBridgeActivationId(null);
      clearIbkrBridgeSessionValues();
      setBridgeLaunchUrl(null);
      setBridgeLaunchInFlightUntil(0);
      invalidateIbkrRuntimeQueries(queryClient);
      void refreshIbkrConnectionStatus();
      setBridgeManualOperationModel(
        buildDeactivateModel({
          queue: "complete",
          detach: "complete",
          refresh: "complete",
          desktop: "complete",
          message: "Retired IBKR desktop bridge state cleared.",
        }),
      );
      setBridgeLauncherNotice("Retired IBKR desktop bridge state cleared.");
    } catch (error) {
      setBridgeManualOperationModel(
        buildDeactivateModel({
          queue: "complete",
          detach: "error",
          message:
            error instanceof Error
              ? error.message
              : "Clearing retired IBKR desktop bridge state failed.",
        }),
      );
      setBridgeLauncherError(
        error instanceof Error
          ? error.message
          : "Clearing retired IBKR desktop bridge state failed.",
      );
    } finally {
      setBridgeLauncherBusy(false);
    }
  }, [
    bridgeDeactivateAction,
    queryClient,
    refreshIbkrConnectionStatus,
  ]);

  return (
    <div
      data-testid="platform-header-status"
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-end",
        gap: sp(compressed ? 2 : 4),
        flexWrap: "nowrap",
        alignContent: "center",
        width: "max-content",
        minWidth: "max-content",
        flex: "0 0 max-content",
      }}
    >
      <HeaderSessionStatus
        compressed={compressed}
        compact={compact}
        mobileSheet={mobileSheet}
        surfaceStyle={surfaceStyle}
      />

      <HeaderSnapTradeBrokerStatus
        compressed={compressed}
        compact={compact}
        minimal={minimal}
        mobileSheet={mobileSheet}
        surfaceStyle={surfaceStyle}
        theme={theme}
      />


      {compact ? null : (
        <HeaderMarketClock compressed={compressed} surfaceStyle={surfaceStyle} />
      )}

      {compact || minimal || !showThemeToggle ? null : (
      <AppTooltip content={
          theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
        }><button
        type="button"
        onClick={onToggleTheme}
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        className="ra-hover-accent-bgfg"
        style={{
          width: dim(compressed ? 22 : 34),
          minHeight: dim(compressed ? 22 : 34),
          padding: 0,
          background: "transparent",
          border: "none",
          borderRadius: 0,
          color: CSS_COLOR.textSec,
          cursor: "pointer",
          fontSize: fs(compressed ? 11 : 13),
          lineHeight: 1,
          fontFamily: T.sans,
          fontWeight: FONT_WEIGHTS.regular,
          transition: "background var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease",
        }}
      >
        {theme === "dark" ? "☼" : "☾"}
      </button></AppTooltip>
      )}
    </div>
  );
};

export const MemoHeaderStatusCluster = memo(HeaderStatusCluster);
