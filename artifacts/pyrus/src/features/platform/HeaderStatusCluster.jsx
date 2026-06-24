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
import { CSS_COLOR, cssColorMix, dim, ELEVATION, FONT_WEIGHTS, fs, MISSING_VALUE, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";
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
import { streamStateTokenVar } from "./streamSemantics";
import { useToast } from "./platformContexts.jsx";
import {
  IBKR_BRIDGE_LAUNCH_COOLDOWN_MS,
  IBKR_BRIDGE_CREDENTIAL_LAUNCH_WINDOW_MS,
  IBKR_BRIDGE_SESSION_KEYS,
  IBKR_RECONNECT_REQUEST_EVENT,
  clearIbkrBridgeSessionValues,
  closeIbkrProtocolLauncher,
  invalidateIbkrRuntimeQueries,
  isWindowsIbkrLaunchBrowser,
  navigateIbkrProtocolLauncher,
  openIbkrProtocolLauncher,
  readIbkrBridgeSessionValue,
  removeIbkrBridgeSessionValue,
  shouldUseRemoteIbkrLaunchBrowser,
  writeIbkrBridgeSessionValue,
} from "./ibkrBridgeSession";
import { waitForBridgeLaunchFeedbackPaint } from "./ibkrBridgeLaunchFeedback";
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
import {
  selectHeaderIbkrLineUsageSnapshot,
  shouldActivateHeaderIbkrLineUsage,
} from "./headerIbkrLineUsagePolicy";
import { platformJsonRequest } from "./platformJsonRequest";
import { TRADE_OPTIONS_CHAIN_LABEL } from "./runtimeControlModel";
import { useIbkrLineUsageSnapshot } from "./useIbkrLineUsageSnapshot";
import { useRuntimeWorkloadFlag } from "./workloadStats";
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
const IBKR_BRIDGE_ACTIVATION_STATUS_POLL_MS = 500;
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

const waitForIbkrLoginKey = async ({
  activationId,
  managementToken,
  shouldAbort,
  signal,
}) => {
  const deadline = Date.now() + IBKR_LOGIN_HANDOFF_WAIT_MS;
  let lastTransientError = null;
  while (Date.now() < deadline) {
    if (shouldAbort?.()) {
      throw createIbkrLaunchCanceledError();
    }
    try {
      const payload = await platformJsonRequest(
        `/api/ibkr/activation/${encodeURIComponent(activationId)}/login-key/read`,
        {
          method: "POST",
          body: {
            managementToken,
            ...(IBKR_LOGIN_HANDOFF_REQUEST_WAIT_MS > 0
              ? { waitMs: IBKR_LOGIN_HANDOFF_REQUEST_WAIT_MS }
              : {}),
          },
          signal,
          timeoutMs: 0,
        },
      );
      if (payload?.ready) {
        if (payload.algorithm !== IBKR_LOGIN_HANDOFF_ALGORITHM) {
          throw new Error("The Windows helper advertised an unsupported credential handoff.");
        }
        return {
          completedWithoutCredentials: false,
          key: payload,
        };
      }
      lastTransientError = null;
    } catch (error) {
      if (shouldAbort?.()) {
        throw createIbkrLaunchCanceledError();
      }
      if (isIbkrLoginKeyReadActivationNotFoundError(error)) {
        return {
          completedWithoutCredentials: true,
          key: null,
        };
      }
      if (isTransientIbkrLoginKeyReadError(error)) {
        lastTransientError = error;
        await sleep(IBKR_LOGIN_HANDOFF_POLL_MS);
        continue;
      }
      throw error;
    }

    await sleep(IBKR_LOGIN_HANDOFF_POLL_MS);
  }

  throw new Error(
    lastTransientError instanceof Error
      ? `Timed out waiting for the Windows helper secure credential handoff. Last request error: ${lastTransientError.message}`
      : "Timed out waiting for the Windows helper secure credential handoff.",
  );
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

const readIbkrActivationStatus = ({ activationId, managementToken }) =>
  platformJsonRequest(
    `/api/ibkr/activation/${encodeURIComponent(activationId)}/status`,
    {
      method: "POST",
      body: {
        managementToken,
      },
      timeoutMs: 5_000,
    },
  );

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
const reportIbkrBrowserConnectionEvent = ({
  activationId,
  managementToken,
  phase = null,
  step,
  status = null,
  message = null,
  errorCode = null,
  errorMessage = null,
}) => {
  if (!activationId || !managementToken || !step) {
    return;
  }
  try {
    void platformJsonRequest(
      `/api/ibkr/activation/${encodeURIComponent(activationId)}/browser-event`,
      {
        method: "POST",
        body: {
          managementToken,
          phase,
          step,
          status,
          message,
          errorCode,
          errorMessage,
        },
        timeoutMs: 5000,
      },
    ).catch(() => {});
  } catch {
    // best-effort
  }
};

const waitForIbkrDesktopJob = async ({ jobId, statusToken }) => {
  if (!jobId || !statusToken) {
    return null;
  }

  const deadline = Date.now() + IBKR_DESKTOP_SHUTDOWN_WAIT_MS;
  while (Date.now() < deadline) {
    const payload = await platformJsonRequest("/api/ibkr/desktop/jobs/status", {
      method: "POST",
      body: { jobId, statusToken },
      timeoutMs: 0,
    });
    if (payload?.state === "completed") {
      return payload;
    }
    if (payload?.state === "failed") {
      throw new Error(
        payload.message || "The Windows desktop could not stop IB Gateway.",
      );
    }
    if (payload?.state === "expired") {
      throw new Error("The Windows desktop did not claim the IB Gateway shutdown request.");
    }
    await sleep(IBKR_DESKTOP_JOB_POLL_MS);
  }

  throw new Error("Timed out waiting for the Windows desktop to stop IB Gateway.");
};

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
  const lineUsage = model?.lineUsage;
  const compactLineUsage = model?.compactLineUsage;
  const pendingLineCount = Number.isFinite(lineUsage?.foregroundPendingLineCount)
    ? Math.max(0, lineUsage.foregroundPendingLineCount)
    : Number.isFinite(lineUsage?.warmup?.pendingLineCount)
      ? Math.max(0, lineUsage.warmup.pendingLineCount)
    : 0;
  const lineValue = compactLineUsage?.summary || lineUsage?.summary || MISSING_VALUE;
  const shortLineValue = lineValue.replace(/\s*\/\s*/g, "/");
  const inlineLineValue =
    lineUsage?.available && pendingLineCount > 0
      ? `${shortLineValue}+${Math.round(pendingLineCount).toLocaleString()}`
      : shortLineValue;
  const lineDisplayValue =
    pendingLineCount > 0
      ? `${lineValue} · ${Math.round(pendingLineCount).toLocaleString()} pending`
      : lineValue;
  const showInlineLineUsage =
    compressed && Boolean(compactLineUsage?.summary || lineUsage?.summary);

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
            ? showInlineLineUsage
              ? "auto auto auto auto auto"
              : "auto auto auto auto"
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
        {showInlineLineUsage ? (
          <span
            data-testid="header-ibkr-line-usage"
            aria-label={`Market data lines ${lineDisplayValue}`}
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: sp(3),
              minWidth: "max-content",
              color: compactLineUsage?.tone || CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize(compressed ? "body" : "caption"),
              fontWeight: FONT_WEIGHTS.medium,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                color: CSS_COLOR.textMuted,
                fontSize: textSize("micro"),
                fontWeight: FONT_WEIGHTS.medium,
                letterSpacing: 0,
                textTransform: "uppercase",
              }}
            >
              {compact || minimal ? "L" : "Lines"}
            </span>
            <span>{inlineLineValue}</span>
          </span>
        ) : null}
        <span
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
      ? "IBKR bridge runtime was detached."
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

const HeaderMarketDataLineUsage = ({ lineUsage, compactLineUsage }) => {
  if (!lineUsage?.available) {
    return null;
  }

  const warmup = lineUsage.warmup || {};
  const pendingLineCount = Number.isFinite(lineUsage.foregroundPendingLineCount)
    ? Math.max(0, lineUsage.foregroundPendingLineCount)
    : Number.isFinite(warmup.pendingLineCount)
      ? Math.max(0, warmup.pendingLineCount)
      : 0;
  const warmupPending = pendingLineCount > 0;
  const compact = compactLineUsage;
  const driftStatus = lineUsage.drift?.status || "unknown";
  const driftActionable =
    driftStatus &&
    !["ok", "unknown", "matched", "settling", "api_active_bridge_missing"].includes(driftStatus);
  const autoOpenBreakdown = Boolean(
    driftActionable ||
    (warmup.available && warmup.state !== "idle") ||
    warmupPending,
  );
  const [breakdownOpen, setBreakdownOpen] = useState(autoOpenBreakdown);

  useEffect(() => {
    if (autoOpenBreakdown) {
      setBreakdownOpen(true);
    }
  }, [autoOpenBreakdown]);

  const used = compact?.used;
  const cap = compact?.cap;
  const free = compact?.free;
  const targetFillLines = compact?.targetFillLines;
  const reserveLineCount = compact?.reserveLineCount;
  const tradeOptionsChainReserveLineCount =
    lineUsage.allocation?.tradeOptionsChainReserveLineCount;
  const summaryItems = [
    Number.isFinite(tradeOptionsChainReserveLineCount) &&
    tradeOptionsChainReserveLineCount > 0
      ? {
          label: TRADE_OPTIONS_CHAIN_LABEL,
          value: `${Math.round(tradeOptionsChainReserveLineCount).toLocaleString()} active`,
          tone: CSS_COLOR.textSec,
        }
      : null,
    Number.isFinite(targetFillLines) &&
    Number.isFinite(cap) &&
    targetFillLines < cap
      ? {
          label: "Usable target",
          value: `${Math.round(targetFillLines).toLocaleString()} line${
            Math.round(targetFillLines) === 1 ? "" : "s"
          }${
            Number.isFinite(reserveLineCount)
              ? ` · ${Math.round(reserveLineCount).toLocaleString()} reserve`
              : ""
          }`,
          tone: CSS_COLOR.textSec,
        }
      : null,
    warmupPending
      ? {
          label: "Pending",
          value: `${Math.round(pendingLineCount).toLocaleString()} line${
            Math.round(pendingLineCount) === 1 ? "" : "s"
          }`,
          tone: warmup.tone,
        }
      : null,
    driftActionable
      ? {
          label: "Reconcile",
          value: lineUsage.drift.label,
          tone: lineUsage.drift.tone,
        }
      : null,
  ].filter(Boolean);
  const percent = Number.isFinite(compact?.percent)
    ? Math.max(0, Math.min(100, compact.percent))
    : 0;
  const tone = compact?.tone || lineUsage.bridge?.tone || CSS_COLOR.textSec;
  const summaryText =
    Number.isFinite(used) && Number.isFinite(cap)
      ? `${Math.round(used)} of ${Math.round(cap)} · ${
          Number.isFinite(free) ? `${Math.round(free)} free` : lineUsage.summary
        }`
      : lineUsage.summary;

  return (
    <div
      style={{
        display: "grid",
        gap: sp(7),
        marginBottom: sp(8),
        padding: sp("6px 8px"),
        background: "transparent",
        borderTop: `1px solid ${CSS_COLOR.borderLight}`,
        borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
        fontFamily: T.sans,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `auto minmax(${dim(70)}px, 1fr) auto auto`,
          alignItems: "center",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Lines
        </span>
        <span
          aria-hidden="true"
          style={{
            minWidth: 0,
            height: dim(4),
            borderRadius: dim(RADII.pill),
            background: CSS_COLOR.borderLight,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              display: "block",
              width: `${percent}%`,
              height: "100%",
              borderRadius: dim(RADII.pill),
              background: tone,
            }}
          />
        </span>
        <span
          style={{
            color: CSS_COLOR.text,
            fontSize: textSize("paragraphMuted"),
            fontWeight: FONT_WEIGHTS.medium,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {summaryText}
        </span>
        <button
          type="button"
          onClick={() => setBreakdownOpen((current) => !current)}
          style={{
            border: "none",
            background: "transparent",
            color: CSS_COLOR.textMuted,
            cursor: "pointer",
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            padding: 0,
            whiteSpace: "nowrap",
          }}
        >
          {breakdownOpen ? "Hide" : "Breakdown"}{" "}
          <ChevronDown
            size={dim(10)}
            strokeWidth={2.2}
            style={{
              display: "inline-block",
              transform: breakdownOpen ? "rotate(180deg)" : "rotate(-90deg)",
              transition: "transform var(--ra-motion-fast) ease",
              verticalAlign: "-1px",
            }}
          />
        </button>
      </div>
      {breakdownOpen && summaryItems.length ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fit, minmax(${dim(118)}px, 1fr))`,
            gap: sp(5),
            minWidth: 0,
          }}
        >
          {summaryItems.map((item) => (
            <div
              key={item.label}
              style={{
                display: "grid",
                gap: sp(2),
                minWidth: 0,
                padding: sp("5px 7px"),
                borderRadius: dim(RADII.sm),
                background: `${cssColorMix(item.tone, 5)}`,
                color: item.tone,
                fontSize: textSize("paragraphMuted"),
                fontWeight: FONT_WEIGHTS.medium,
                lineHeight: 1.15,
              }}
            >
              <span
                style={{
                  color: CSS_COLOR.textMuted,
                  fontSize: fs(8),
                  fontWeight: FONT_WEIGHTS.regular,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </span>
              <span
                style={{
                  minWidth: 0,
                  fontVariantNumeric: "tabular-nums",
                  overflowWrap: "anywhere",
                }}
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {breakdownOpen ? (
        <div style={{ display: "grid", gap: 0 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `minmax(${dim(120)}px, 1fr) repeat(3, minmax(${dim(44)}px, auto))`,
              gap: sp(10),
              color: CSS_COLOR.textMuted,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              paddingBottom: sp(6),
              borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
            }}
          >
            <span>Lane</span>
            <span style={{ textAlign: "right" }}>Active</span>
            <span style={{ textAlign: "right" }}>Usable</span>
            <span style={{ textAlign: "right" }}>Headroom</span>
          </div>
          {lineUsage.rows.map((row, index) => (
            <div
              key={row.id}
              data-testid={`header-market-data-line-row-${row.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: `minmax(${dim(120)}px, 1fr) repeat(3, minmax(${dim(44)}px, auto))`,
                gap: sp(10),
                alignItems: "baseline",
                fontSize: textSize("paragraphMuted"),
                padding: sp("8px 0"),
                borderBottom:
                  index < lineUsage.rows.length - 1
                    ? `1px solid ${CSS_COLOR.borderLight}`
                    : "none",
              }}
            >
              <span
                style={{
                  color: row.id === "total" ? CSS_COLOR.text : CSS_COLOR.textSec,
                  minWidth: 0,
                  fontWeight:
                    row.id === "total"
                      ? FONT_WEIGHTS.medium
                      : FONT_WEIGHTS.regular,
                }}
              >
                <span>{row.label}</span>
                {row.detail ? (
                  <span
                    style={{
                      display: "block",
                      marginTop: sp(3),
                      color: row.tone,
                      fontSize: textSize("caption"),
                      fontWeight: FONT_WEIGHTS.regular,
                      lineHeight: 1.4,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {row.detail}
                  </span>
                ) : null}
              </span>
              <span
                style={{
                  textAlign: "right",
                  color: row.tone,
                  fontWeight: FONT_WEIGHTS.medium,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Number.isFinite(row.displayActive ?? row.covered ?? row.used)
                  ? Math.round(row.displayActive ?? row.covered ?? row.used)
                  : MISSING_VALUE}
              </span>
              <span
                style={{
                  textAlign: "right",
                  color: CSS_COLOR.textSec,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Number.isFinite(row.displayAvailable ?? row.effectiveCap ?? row.cap)
                  ? Math.round(row.displayAvailable ?? row.effectiveCap ?? row.cap)
                  : MISSING_VALUE}
              </span>
              <span
                style={{
                  textAlign: "right",
                  color: CSS_COLOR.textSec,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Number.isFinite(row.displayFree ?? row.free)
                  ? Math.round(row.displayFree ?? row.free)
                  : MISSING_VALUE}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const HeaderIbkrConnectionSummary = ({ model }) => {
  const IssueIcon = getHeaderIbkrIcon(model.issue.iconKey);
  const showIssue = model.issue?.severity && model.issue.severity !== "healthy";

  return (
    <div
      style={{
        display: "grid",
        gap: sp(6),
        marginBottom: sp(8),
      }}
    >
      {showIssue ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr)",
            gap: sp(8),
            alignItems: "start",
            padding: sp("8px 10px"),
            background: CSS_COLOR.bg1,
            border: `1px solid ${cssColorMix(model.issue.tone, 33)}`,
            borderRadius: dim(RADII.sm),
            color: model.issue.tone,
            fontFamily: T.sans,
            fontSize: textSize("paragraphMuted"),
            lineHeight: 1.35,
          }}
        >
          <IssueIcon size={dim(14)} strokeWidth={2.2} color={model.issue.tone} />
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
      ) : null}
      <HeaderIbkrMetricRail tiles={model.tiles} />
      <HeaderIbkrProviderRows rows={model.providerRows} />
    </div>
  );
};

const HEADER_PROVIDER_ICONS = Object.freeze({
  activity: Activity,
  alert: AlertTriangle,
  check: Check,
  clock: Clock3,
  database: Database,
  hash: Hash,
  network: Network,
  rest: Database,
  timer: Timer,
  unplug: Unplug,
  websocket: Network,
  wifi: Wifi,
});

const HeaderProviderIcon = ({
  iconKey,
  color = "currentColor",
  size = 12,
  strokeWidth = 2.2,
  style,
}) => {
  const Icon = HEADER_PROVIDER_ICONS[iconKey] || Activity;
  return (
    <Icon
      aria-hidden="true"
      color={color}
      size={dim(size)}
      strokeWidth={strokeWidth}
      style={style}
    />
  );
};

const HeaderProviderStatusGlyph = ({ iconKey, tone, size = 18 }) => {
  const color = tone || CSS_COLOR.textSec;
  return (
    <span
      aria-hidden="true"
      style={{
        width: dim(size),
        height: dim(size),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: `0 0 ${dim(size)}`,
        border: `1px solid ${cssColorMix(color, 42)}`,
        borderRadius: dim(RADII.pill),
        background: cssColorMix(color, 11),
        color,
      }}
    >
      <HeaderProviderIcon
        iconKey={iconKey}
        color={color}
        size={size <= 14 ? 8.5 : 10.5}
        strokeWidth={iconKey === "check" ? 2.8 : 2.35}
      />
    </span>
  );
};

const HeaderProviderChip = ({ chip, baseTone, compact = false }) => {
  if (!chip?.label) {
    return null;
  }
  const tone = chip.tone || baseTone || CSS_COLOR.textSec;
  const tooltipContent =
    chip.title && chip.title !== chip.label ? chip.title : null;
  const chipNode = (
    <span
      style={{
        minHeight: dim(compact ? 18 : 20),
        display: "inline-flex",
        alignItems: "center",
        gap: sp(3),
        maxWidth: "100%",
        padding: sp(compact ? "2px 5px" : "3px 6px"),
        border: `1px solid ${cssColorMix(tone, compact ? 24 : 30)}`,
        borderRadius: dim(RADII.pill),
        background: cssColorMix(tone, compact ? 5 : 7),
        color: tone,
        fontSize: fs(compact ? 8 : 9),
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        minWidth: 0,
      }}
    >
      {chip.iconKey ? (
        <HeaderProviderIcon
          iconKey={chip.iconKey}
          color={tone}
          size={compact ? 8 : 9}
          strokeWidth={2.35}
        />
      ) : null}
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {chip.label}
      </span>
    </span>
  );
  return tooltipContent ? (
    <AppTooltip content={tooltipContent}>
      {chipNode}
    </AppTooltip>
  ) : (
    chipNode
  );
};

const HeaderProviderChannelChip = ({ channel, tone }) => {
  if (!channel?.label) {
    return null;
  }
  const active = channel.active === true;
  const color = active ? tone || CSS_COLOR.green : CSS_COLOR.textDim;
  const tooltipContent =
    channel.title && channel.title !== channel.label ? channel.title : null;
  const channelNode = (
    <span
      style={{
        minWidth: dim(24),
        minHeight: dim(19),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp("2px 6px"),
        border: `1px solid ${cssColorMix(color, active ? 44 : 20)}`,
        borderRadius: dim(RADII.xs),
        background: active ? cssColorMix(color, 11) : CSS_COLOR.bg0,
        color,
        fontSize: fs(9),
        fontWeight: active ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {channel.label}
    </span>
  );
  return tooltipContent ? (
    <AppTooltip content={tooltipContent}>
      {channelNode}
    </AppTooltip>
  ) : (
    channelNode
  );
};

const HeaderProviderLane = ({ lane, providerTone }) => {
  const tone = lane.tone || providerTone || CSS_COLOR.textSec;
  const metricChips = Array.isArray(lane.chips) ? lane.chips : [];
  const channels = Array.isArray(lane.channels) ? lane.channels : [];

  return (
    <div
      style={{
        minWidth: 0,
        display: "grid",
        alignContent: "start",
        gap: sp(6),
        padding: sp("7px 8px"),
        border: `1px solid ${cssColorMix(tone, 25)}`,
        borderRadius: dim(RADII.sm),
        background: cssColorMix(tone, 5),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(6),
          minWidth: 0,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(5),
            minWidth: 0,
            color: CSS_COLOR.textMuted,
            fontSize: fs(8),
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          <HeaderProviderIcon iconKey={lane.iconKey} color={tone} size={10} />
          {lane.label}
        </span>
        <HeaderProviderStatusGlyph
          iconKey={lane.statusIconKey}
          tone={tone}
          size={14}
        />
      </div>
      <div
        style={{
          minWidth: 0,
          color: tone,
          fontSize: textSize("paragraphMuted"),
          fontWeight: FONT_WEIGHTS.medium,
          lineHeight: 1.25,
          overflowWrap: "anywhere",
          textWrap: "pretty",
        }}
      >
        {lane.value || MISSING_VALUE}
      </div>
      {channels.length ? (
        <div
          aria-label={`${lane.label} channels`}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: sp(4),
            minWidth: 0,
          }}
        >
          {channels.map((channel) => (
            <HeaderProviderChannelChip
              key={`${lane.id || lane.label}:${channel.label}`}
              channel={channel}
              tone={tone}
            />
          ))}
        </div>
      ) : null}
      {metricChips.length ? (
        <div
          aria-label={`${lane.label} evidence`}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: sp(4),
            minWidth: 0,
          }}
        >
          {metricChips.map((chip) => (
            <HeaderProviderChip
              key={`${lane.id || lane.label}:${chip.title || chip.label}`}
              chip={chip}
              baseTone={tone}
            />
          ))}
        </div>
      ) : null}
      {lane.detail ? (
        <div
          style={{
            minWidth: 0,
            color: CSS_COLOR.textDim,
            fontSize: fs(9),
            lineHeight: 1.25,
            overflowWrap: "anywhere",
            textWrap: "pretty",
          }}
        >
          {lane.detail}
        </div>
      ) : null}
    </div>
  );
};

const HeaderMassiveProviderPanel = ({ row }) => (
  <div
    style={{
      display: "grid",
      gap: sp(7),
      minWidth: 0,
      fontFamily: T.sans,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: sp(6),
        minWidth: 0,
      }}
    >
      <HeaderProviderStatusGlyph iconKey={row.statusIconKey} tone={row.tone} />
      <span
        style={{
          color: CSS_COLOR.textMuted,
          fontSize: fs(8),
          fontWeight: FONT_WEIGHTS.regular,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {row.label}
      </span>
      <span
        style={{
          color: row.tone || CSS_COLOR.textSec,
          fontSize: textSize("paragraphMuted"),
          fontWeight: FONT_WEIGHTS.medium,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
        }}
      >
        {row.value}
      </span>
      {row.host ? (
        <HeaderProviderChip
          compact
          chip={{
            iconKey: "network",
            label: row.host,
            title: "Massive REST host",
          }}
          baseTone={CSS_COLOR.textSec}
        />
      ) : null}
      {row.detail ? (
        <span
          style={{
            minWidth: 0,
            flex: "1 1 150px",
            color: CSS_COLOR.textDim,
            fontSize: fs(9),
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.detail}
        </span>
      ) : null}
    </div>
    {Array.isArray(row.summary) && row.summary.length ? (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 148px), 1fr))",
          gap: sp(6),
          minWidth: 0,
        }}
      >
        {row.summary.map((lane) => (
          <HeaderProviderLane
            key={lane.id || lane.label}
            lane={lane}
            providerTone={row.tone}
          />
        ))}
      </div>
    ) : null}
  </div>
);

const HeaderGenericProviderRow = ({ row }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: sp(7),
      minWidth: 0,
      fontFamily: T.sans,
    }}
  >
    <HeaderProviderStatusGlyph iconKey={row.statusIconKey} tone={row.tone} />
    <span
      style={{
        color: CSS_COLOR.textMuted,
        fontSize: fs(8),
        fontWeight: FONT_WEIGHTS.regular,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {row.label}
    </span>
    <span
      style={{
        minWidth: 0,
        color: row.tone || CSS_COLOR.textSec,
        fontSize: textSize("paragraphMuted"),
        fontWeight: FONT_WEIGHTS.medium,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {row.value}
      {row.detail ? (
        <span style={{ color: CSS_COLOR.textDim, fontWeight: FONT_WEIGHTS.regular }}>
          {" · "}
          {row.detail}
        </span>
      ) : null}
    </span>
  </div>
);

const HeaderIbkrProviderRows = ({ rows }) => {
  const visibleRows = Array.isArray(rows)
    ? rows.filter((row) => row?.label)
    : [];
  if (!visibleRows.length) {
    return null;
  }

  return (
    <div
      data-testid="header-ibkr-provider-rows"
      style={{
        display: "grid",
        gap: sp(7),
        padding: sp("8px 9px"),
        border: `1px solid ${CSS_COLOR.borderLight}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg1,
      }}
    >
      {visibleRows.map((row) =>
        row.label === "Massive" && Array.isArray(row.summary) ? (
          <HeaderMassiveProviderPanel key={row.label} row={row} />
        ) : (
          <HeaderGenericProviderRow key={row.label} row={row} />
        ),
      )}
    </div>
  );
};

const HeaderIbkrAdvancedDetails = ({ insightModel, model }) => {
  const initialMode = model.autoOpenDetails
    ? "all"
    : model.priorityDetailGroup
      ? "priority"
      : "closed";
  const [openMode, setOpenMode] = useState(initialMode);
  const openSourceRef = useRef(initialMode === "closed" ? "default" : "auto");
  const lastIssueKeyRef = useRef(model.issue.key);

  useEffect(() => {
    const issueChanged = model.issue.key !== lastIssueKeyRef.current;
    if (issueChanged) {
      lastIssueKeyRef.current = model.issue.key;
    }

    const nextAutoMode = model.autoOpenDetails
      ? "all"
      : model.priorityDetailGroup
        ? "priority"
        : "closed";

    if (nextAutoMode !== "closed") {
      if (issueChanged || openSourceRef.current !== "user") {
        openSourceRef.current = "auto";
        setOpenMode(nextAutoMode);
      }
      return;
    }

    if (issueChanged && openSourceRef.current === "auto") {
      openSourceRef.current = "default";
      setOpenMode("closed");
    }
  }, [model.autoOpenDetails, model.issue.key, model.priorityDetailGroup]);

  const handleDetailsToggle = useCallback(() => {
    openSourceRef.current = "user";
    setOpenMode((current) => (current === "all" ? "closed" : "all"));
  }, []);
  const open = openMode !== "closed";
  const expandedGroupTitle =
    openMode === "priority" && model.priorityDetailGroup
      ? model.priorityDetailGroup
      : null;
  const insightRows = Array.isArray(insightModel?.timelineRows)
    ? insightModel.timelineRows.filter((row) => row.status !== "pending")
    : [];
  const detailGroups = insightRows.length
    ? [
        {
          title: "Launch",
          rows: insightRows.map((row) => ({
            label: row.label,
            tone: getIbkrInsightToneColor(row.tone),
            value: [
              row.statusLabel,
              row.elapsedLabel,
              row.ownerLabel,
            ].filter(Boolean).join(" · "),
            wrap: true,
          })),
        },
        ...model.detailGroups,
      ]
    : model.detailGroups;

  return (
    <div
      style={{
        marginTop: sp(6),
        display: "grid",
        gap: sp(6),
        borderTop: `1px solid ${CSS_COLOR.borderLight}`,
      }}
    >
      <button
        type="button"
        onClick={handleDetailsToggle}
        style={{
          minHeight: dim(24),
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          padding: sp("6px 2px 0"),
          border: "none",
          background: "transparent",
          color: CSS_COLOR.textDim,
          cursor: "pointer",
          fontFamily: T.sans,
          fontSize: fs(8),
          fontWeight: FONT_WEIGHTS.regular,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        <span>Details</span>
        <ChevronDown
          size={dim(11)}
          strokeWidth={2.2}
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform var(--ra-motion-fast) ease",
          }}
        />
      </button>

      {open ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))",
            gap: sp(6),
            padding: 0,
            background: "transparent",
            border: "none",
          }}
        >
          {detailGroups.map((group) => {
            const groupKey = group.title.toLowerCase();
            const groupOpen =
              !expandedGroupTitle || groupKey === expandedGroupTitle;
            return (
              <div
                key={group.title}
                style={{
                  display: "grid",
                  alignContent: "start",
                  gap: sp(3),
                  minWidth: 0,
                  padding: sp("6px 8px"),
                  border: `1px solid ${CSS_COLOR.borderLight}`,
                  borderRadius: dim(RADII.sm),
                  background: CSS_COLOR.bg1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: sp(4),
                    color: CSS_COLOR.textMuted,
                    fontFamily: T.sans,
                    fontSize: fs(8),
                    fontWeight: FONT_WEIGHTS.regular,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  <span>{group.title}</span>
                  {expandedGroupTitle ? (
                    <ChevronDown
                      size={dim(10)}
                      strokeWidth={2.2}
                      style={{
                        transform: groupOpen ? "rotate(180deg)" : "rotate(-90deg)",
                      }}
                    />
                  ) : null}
                </div>
                {groupOpen
                  ? group.rows.map((row) => (
                      <HeaderIbkrDetailRow
                        key={`${group.title}:${row.label}`}
                        label={row.label}
                        value={row.value}
                        tone={row.tone}
                        wrap={row.wrap}
                      />
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

const getIbkrOperationStepTone = (status) => {
  if (status === "complete") return CSS_COLOR.green;
  if (status === "current") return CSS_COLOR.accent;
  if (status === "warning") return CSS_COLOR.amber;
  if (status === "error" || status === "canceled") return CSS_COLOR.red;
  return CSS_COLOR.textMuted;
};

const getIbkrOperationStepAria = (step) =>
  `${step.label} ${step.status === "current" ? "current" : step.status}`;

const IBKR_OPERATION_STEP_ICONS = Object.freeze({
  cable: Cable,
  clock: Clock3,
  key: KeyRound,
  monitor: MonitorUp,
  network: Network,
  power: Power,
  refresh: RefreshCw,
  send: SendHorizontal,
  unplug: Unplug,
});

const getIbkrOperationStepIconAnimation = (step, active) => {
  if (!active) return "none";
  if (step.motion === "spin") return "premiumFlowSpin 960ms linear infinite";
  if (step.motion === "dispatch") return "ibkrStepIconDispatch 1.2s ease-in-out infinite";
  if (step.motion === "secure") return "ibkrStepIconSecure 1.5s ease-in-out infinite";
  if (step.motion === "boot") return "ibkrStepIconBoot 1.45s ease-in-out infinite";
  if (step.motion === "link") return "ibkrStepIconLink 1.25s ease-in-out infinite";
  if (step.motion === "tunnel") return "ibkrStepIconTunnel 1.35s ease-in-out infinite";
  if (step.motion === "queue") return "ibkrStepIconQueue 1.1s steps(2, end) infinite";
  if (step.motion === "detach") return "ibkrStepIconDetach 1.15s ease-in-out infinite";
  if (step.motion === "power") return "ibkrStepIconPower 1.5s ease-in-out infinite";
  return "ibkrStepIconPulse 1.35s ease-in-out infinite";
};

const getIbkrOperationActivityLabel = (activity) => {
  if (!activity) return null;
  if (activity.status === "current") return "Working";
  if (activity.status === "warning") return "Needs attention";
  if (activity.status === "error") return "Failed";
  return activity.status;
};

const normalizeIbkrStepperCopy = (value) =>
  String(value || "").replace(/\s+/g, " ").trim();

const IBKR_STEPPER_COPY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "is",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

const fingerprintIbkrStepperCopy = (value) =>
  normalizeIbkrStepperCopy(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !IBKR_STEPPER_COPY_STOP_WORDS.has(word))
    .join(" ");

const isDuplicateIbkrStepperCopy = (left, right) => {
  const leftFingerprint = fingerprintIbkrStepperCopy(left);
  const rightFingerprint = fingerprintIbkrStepperCopy(right);
  if (!leftFingerprint || !rightFingerprint) return false;
  if (leftFingerprint === rightFingerprint) return true;
  if (Math.min(leftFingerprint.length, rightFingerprint.length) < 24) return false;
  return leftFingerprint.includes(rightFingerprint) || rightFingerprint.includes(leftFingerprint);
};

const HeaderIbkrOperationStepper = ({ insightModel, model }) => {
  if (!model?.steps?.length) {
    return null;
  }
  const insightTone = insightModel
    ? getIbkrInsightToneColor(insightModel.tone)
    : CSS_COLOR.textSec;
  const activity = model.activity || null;
  const ActivityIcon = activity
    ? IBKR_OPERATION_STEP_ICONS[activity.icon] || Activity
    : Activity;
  const activityTone = getIbkrOperationStepTone(activity?.status);
  const normalizedLatestMessage = normalizeIbkrStepperCopy(model.latestMessage);
  const showInsightDetail = Boolean(
    insightModel?.detail &&
      !isDuplicateIbkrStepperCopy(insightModel.detail, activity?.detail),
  );
  const showLatestMessage = Boolean(
    normalizedLatestMessage &&
      !isDuplicateIbkrStepperCopy(normalizedLatestMessage, insightModel?.detail) &&
      !isDuplicateIbkrStepperCopy(normalizedLatestMessage, insightModel?.statusLine) &&
      !isDuplicateIbkrStepperCopy(normalizedLatestMessage, activity?.detail),
  );

  return (
    <div
      data-testid={`ibkr-operation-stepper-${model.operation}`}
      style={{
        display: "grid",
        gap: sp(8),
        marginBottom: sp(8),
        padding: sp("10px 12px"),
        background: CSS_COLOR.bg1,
        border: `1px solid ${CSS_COLOR.borderLight}`,
        borderRadius: dim(RADII.sm),
        fontFamily: T.sans,
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
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(6),
            color: CSS_COLOR.text,
            fontSize: textSize("paragraphMuted"),
            fontWeight: FONT_WEIGHTS.medium,
            minWidth: 0,
          }}
        >
          {activity ? (
            <RefreshCw
              aria-hidden="true"
              data-ibkr-operation-title-spinner="true"
              size={dim(12)}
              strokeWidth={2.2}
              style={{
                color: activityTone,
                animation: "premiumFlowSpin 860ms linear infinite",
                flex: "0 0 auto",
                willChange: "transform",
              }}
            />
          ) : null}
          {model.title}
        </span>
        {activity ? (
          <span
            style={{
              color: activityTone,
              flex: "0 0 auto",
              fontSize: fs(8),
              fontVariantNumeric: "tabular-nums",
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {getIbkrOperationActivityLabel(activity)}
          </span>
        ) : null}
      </div>
      <div
        role="list"
        aria-label={`${model.title} progress`}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${model.steps.length}, minmax(0, 1fr))`,
          alignItems: "start",
          gap: 0,
          minWidth: 0,
        }}
      >
        {model.steps.map((step, index) => {
          const tone = getIbkrOperationStepTone(step.status);
          const complete = step.status === "complete";
          const warned = step.status === "warning";
          const failed = step.status === "error" || step.status === "canceled";
          const current = step.status === "current";
          const activeLine =
            model.operation === "deactivate" &&
            current &&
            index > 0 &&
            model.steps[index - 1]?.status !== "complete";
          const StepIcon = IBKR_OPERATION_STEP_ICONS[step.icon] || Activity;
          const StatusIcon = complete
            ? Check
            : failed
              ? X
              : warned
                ? AlertTriangle
                : StepIcon;
          return (
            <div
              key={step.id}
              role="listitem"
              aria-label={getIbkrOperationStepAria(step)}
              data-ibkr-operation-step={step.id}
              data-ibkr-operation-step-status={step.status}
              style={{
                display: "grid",
                justifyItems: "center",
                gap: sp(5),
                minWidth: 0,
                position: "relative",
              }}
            >
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  data-ibkr-step-line="true"
                  style={{
                    position: "absolute",
                    top: dim(9),
                    left: "-50%",
                    width: "100%",
                    height: 1,
                    backgroundColor:
                      model.steps[index - 1]?.status === "complete"
                        ? CSS_COLOR.green
                        : CSS_COLOR.borderLight,
                    backgroundImage:
                      model.steps[index - 1]?.status === "complete" || !activeLine
                        ? undefined
                        : `linear-gradient(90deg, ${CSS_COLOR.borderLight}, ${tone}, ${CSS_COLOR.borderLight})`,
                    transformOrigin: "left center",
                    animation:
                      model.steps[index - 1]?.status === "complete"
                        ? "ibkrStepLineFill 540ms ease-out"
                        : activeLine
                          ? "ibkrStepLineChase 1.05s ease-in-out infinite"
                          : "none",
                    backgroundSize: activeLine ? "180% 100%" : undefined,
                  }}
                />
              ) : null}
              <span
                aria-hidden="true"
                data-ibkr-step-complete={complete ? "true" : undefined}
                data-ibkr-state-pulse={current ? "true" : undefined}
                data-ibkr-step-motion={current ? step.motion || "pulse" : undefined}
                style={{
                  "--ibkr-step-tone": tone,
                  width: dim(18),
                  height: dim(18),
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: dim(RADII.pill),
                  border: `1px solid ${tone}`,
                  background:
                    complete || current || failed || warned
                      ? tone
                      : CSS_COLOR.bg0,
                  color:
                    complete || current || failed || warned
                      ? CSS_COLOR.onAccent
                      : tone,
                  boxShadow: current
                    ? `0 0 0 3px ${cssColorMix(tone, 14)}`
                    : "none",
                  animation: current
                    ? "ibkrStatusPulse 1.8s ease-in-out infinite"
                    : "none",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <StatusIcon
                  size={dim(complete ? 11 : failed || warned ? 10 : 10.5)}
                  strokeWidth={complete || failed || warned ? 2.6 : 2.3}
                  style={{
                    opacity: step.status === "pending" ? 0.62 : 1,
                    transformOrigin: "center",
                    willChange: current ? "transform, opacity, filter" : undefined,
                    animation: complete
                      ? "ibkrStepCheckPop 340ms ease-out"
                      : getIbkrOperationStepIconAnimation(step, current),
                  }}
                />
              </span>
              <span
                style={{
                  color: tone,
                  fontSize: fs(8),
                  fontWeight:
                    current || complete || failed
                      ? FONT_WEIGHTS.medium
                      : FONT_WEIGHTS.regular,
                  letterSpacing: 0,
                  lineHeight: 1.1,
                  minWidth: 0,
                  overflow: "hidden",
                  textAlign: "center",
                  textOverflow: "ellipsis",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  width: "100%",
                }}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
      {activity ? (
        <div
          data-testid={`ibkr-operation-activity-${model.operation}`}
          style={{
            display: "grid",
            gap: sp(7),
            padding: sp("8px 9px"),
            background: cssColorMix(activityTone, 6),
            border: `1px solid ${cssColorMix(activityTone, 28)}`,
            borderRadius: dim(RADII.sm),
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto minmax(0, 1fr)",
              gap: sp(8),
              alignItems: "center",
              minWidth: 0,
            }}
          >
            <span
              aria-hidden="true"
              data-ibkr-deactivate-activity-glyph="true"
              style={{
                width: dim(22),
                height: dim(22),
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: dim(RADII.pill),
                background: activityTone,
                color: CSS_COLOR.onAccent,
                boxShadow: `0 0 0 3px ${cssColorMix(activityTone, 14)}`,
              }}
            >
              <ActivityIcon
                size={dim(12)}
                strokeWidth={2.4}
                style={{
                  animation: getIbkrOperationStepIconAnimation(activity, true),
                  transformOrigin: "center",
                  willChange: "transform, opacity, filter",
                }}
              />
            </span>
            <div
              style={{
                display: "grid",
                gap: sp(2),
                minWidth: 0,
              }}
            >
              <div
                style={{
                  color: activityTone,
                  fontSize: textSize("paragraphMuted"),
                  fontWeight: FONT_WEIGHTS.medium,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {activity.label || activity.id}
              </div>
              {activity.detail ? (
                <div
                  style={{
                    color: CSS_COLOR.textSec,
                    fontSize: fs(10),
                    lineHeight: 1.3,
                    overflowWrap: "anywhere",
                  }}
                >
                  {activity.detail}
                </div>
              ) : null}
            </div>
          </div>
          <div
            aria-hidden="true"
            data-ibkr-deactivate-progress-track="true"
            style={{
              position: "relative",
              height: dim(3),
              overflow: "hidden",
              borderRadius: dim(RADII.pill),
              background: cssColorMix(activityTone, 16),
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                width: "44%",
                borderRadius: dim(RADII.pill),
                background: activityTone,
                animation: "ibkrDeactivateProgressSweep 1.15s ease-in-out infinite",
                willChange: "transform, opacity",
              }}
            />
          </div>
        </div>
      ) : null}
      {showLatestMessage ? (
        <div
          style={{
            color: CSS_COLOR.textSec,
            fontSize: textSize("paragraphMuted"),
            lineHeight: 1.35,
            overflowWrap: "anywhere",
          }}
        >
          {normalizedLatestMessage}
        </div>
      ) : null}
      {insightModel ? (
        <div
          data-testid="ibkr-connection-insight"
          style={{
            display: "grid",
            gap: sp(5),
            paddingTop: sp(8),
            borderTop: `1px solid ${CSS_COLOR.borderLight}`,
            color: CSS_COLOR.textSec,
            fontSize: textSize("paragraphMuted"),
            lineHeight: 1.35,
            minWidth: 0,
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
            <span
              style={{
                minWidth: 0,
                color: insightTone,
                fontWeight: FONT_WEIGHTS.medium,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {insightModel.statusLine}
            </span>
            <IbkrInsightElapsedLabel
              startedAtMs={insightModel.currentPhaseStartedAtMs}
              fallbackLabel={insightModel.elapsedLabel}
            />
          </div>
          {showInsightDetail ? (
            <div
              style={{
                color: CSS_COLOR.textSec,
                overflowWrap: "anywhere",
              }}
            >
              {insightModel.detail}
            </div>
          ) : null}
          {insightModel.action ? (
            <div
              style={{
                color: insightTone,
                overflowWrap: "anywhere",
              }}
            >
              {insightModel.action}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

// Isolated elapsed-time label so the stepper doesn't re-render every second.
// The parent insight model no longer carries `now` — this leaf owns the 1s tick.
const IbkrInsightElapsedLabel = memo(function IbkrInsightElapsedLabel({ startedAtMs, fallbackLabel }) {
  const [label, setLabel] = useState(() =>
    startedAtMs != null ? formatIbkrInsightElapsed(Date.now() - startedAtMs) : fallbackLabel,
  );
  useEffect(() => {
    if (startedAtMs == null) {
      setLabel(fallbackLabel);
      return undefined;
    }
    const update = () => setLabel(formatIbkrInsightElapsed(Date.now() - startedAtMs));
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs, fallbackLabel]);
  if (!label) return null;
  return (
    <span style={{ flex: "0 0 auto", color: CSS_COLOR.textMuted, fontVariantNumeric: "tabular-nums" }}>
      {label}
    </span>
  );
});

const HeaderIbkrCredentialForm = memo(function HeaderIbkrCredentialForm({
  actionDisabled = false,
  actionLabel,
  busy = false,
  credentialsOptional = false,
  inFlight = false,
  launchCancelInFlight = false,
  onCancelBridgeLaunch,
  onSubmitCredentials,
  passwordInputRef: externalPasswordInputRef,
  secondaryActionDisabled = false,
  secondaryCancelsLaunch = false,
  usernameInputRef,
}) {
  const localPasswordInputRef = useRef(null);
  const passwordInputRef = externalPasswordInputRef || localPasswordInputRef;
  const credentialsReadyRef = useRef(false);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const syncCredentialsReady = useCallback(() => {
    const nextReady = Boolean(
      usernameInputRef.current?.value?.trim() && passwordInputRef.current?.value,
    );
    if (credentialsReadyRef.current !== nextReady) {
      credentialsReadyRef.current = nextReady;
      setCredentialsReady(nextReady);
    }
    return nextReady;
  }, [passwordInputRef, usernameInputRef]);
  const clearCredentials = useCallback(() => {
    if (usernameInputRef.current) {
      usernameInputRef.current.value = "";
    }
    if (passwordInputRef.current) {
      passwordInputRef.current.value = "";
    }
    if (credentialsReadyRef.current) {
      credentialsReadyRef.current = false;
      setCredentialsReady(false);
    }
  }, [passwordInputRef, usernameInputRef]);
  useEffect(() => {
    if (busy || typeof window === "undefined") {
      return undefined;
    }
    syncCredentialsReady();
    const syncTimerId = window.setInterval(
      syncCredentialsReady,
      IBKR_CREDENTIAL_AUTOFILL_SYNC_MS,
    );
    return () => window.clearInterval(syncTimerId);
  }, [busy, syncCredentialsReady]);
  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const username = usernameInputRef.current?.value?.trim() || "";
      const password = passwordInputRef.current?.value || "";
      if (actionDisabled || (!credentialsOptional && (!username || !password))) {
        syncCredentialsReady();
        return;
      }
      let submitResult = null;
      try {
        submitResult = await onSubmitCredentials({ password, username });
      } finally {
        if (
          shouldClearIbkrPasswordAfterCredentialSubmit(submitResult) &&
          passwordInputRef.current
        ) {
          passwordInputRef.current.value = "";
        }
        syncCredentialsReady();
      }
    },
    [
      actionDisabled,
      credentialsOptional,
      onSubmitCredentials,
      passwordInputRef,
      syncCredentialsReady,
      usernameInputRef,
    ],
  );
  const handleSecondaryAction = useCallback(() => {
    if (secondaryCancelsLaunch) {
      onCancelBridgeLaunch?.();
      return;
    }
    if (busy) {
      return;
    }
    clearCredentials();
    usernameInputRef.current?.focus?.();
  }, [
    busy,
    clearCredentials,
    onCancelBridgeLaunch,
    secondaryCancelsLaunch,
    usernameInputRef,
  ]);
  const submitDisabled = Boolean(
    actionDisabled || (!credentialsOptional && !credentialsReady),
  );

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "grid",
        gap: sp(5),
        marginBottom: sp(8),
        padding: sp(8),
        background: CSS_COLOR.bg1,
        border: `1px solid ${CSS_COLOR.borderLight}`,
        borderRadius: dim(RADII.sm),
      }}
    >
      <label
        style={{
          display: "grid",
          gap: sp(4),
          color: CSS_COLOR.textSec,
          fontSize: textSize("caption"),
          fontFamily: T.sans,
          fontWeight: FONT_WEIGHTS.medium,
        }}
      >
        IBKR username
        <input
          ref={usernameInputRef}
          type="text"
          autoComplete="username"
          onInput={syncCredentialsReady}
          disabled={busy}
          style={{
            minHeight: dim(28),
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.sm),
            background: CSS_COLOR.bg0,
            color: CSS_COLOR.text,
            padding: sp("5px 8px"),
            font: "inherit",
          }}
        />
      </label>
      <label
        style={{
          display: "grid",
          gap: sp(4),
          color: CSS_COLOR.textSec,
          fontSize: textSize("caption"),
          fontFamily: T.sans,
          fontWeight: FONT_WEIGHTS.medium,
        }}
      >
        IBKR password
        <input
          ref={passwordInputRef}
          type="password"
          autoComplete="current-password"
          onInput={syncCredentialsReady}
          disabled={busy}
          style={{
            minHeight: dim(28),
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.sm),
            background: CSS_COLOR.bg0,
            color: CSS_COLOR.text,
            padding: sp("5px 8px"),
            font: "inherit",
          }}
        />
      </label>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: sp(6),
        }}
      >
        <button
          type="submit"
          disabled={submitDisabled}
          aria-disabled={submitDisabled}
          style={{
            minHeight: dim(28),
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: sp(6),
            border: `1px solid ${CSS_COLOR.accent}`,
            borderRadius: dim(RADII.sm),
            background: `${cssColorMix(CSS_COLOR.accent, 9)}`,
            color: CSS_COLOR.accent,
            cursor: submitDisabled ? "default" : "pointer",
            fontSize: textSize("paragraphMuted"),
            fontWeight: FONT_WEIGHTS.medium,
            fontFamily: T.sans,
          }}
        >
          {busy || inFlight ? (
            <RefreshCw
              data-ibkr-bridge-spinner
              size={dim(12)}
              strokeWidth={2.2}
              style={{
                animation: "premiumFlowSpin 820ms linear infinite",
              }}
            />
          ) : null}
          {actionLabel}
        </button>
        <button
          type="button"
          onClick={handleSecondaryAction}
          disabled={secondaryActionDisabled}
          aria-disabled={secondaryActionDisabled}
          style={{
            minHeight: dim(28),
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.sm),
            background: CSS_COLOR.bg0,
            color: CSS_COLOR.textSec,
            cursor: secondaryActionDisabled ? "default" : "pointer",
            fontSize: textSize("paragraphMuted"),
            fontWeight: FONT_WEIGHTS.medium,
            fontFamily: T.sans,
          }}
        >
          {secondaryCancelsLaunch
            ? launchCancelInFlight
              ? "Canceling"
              : "Cancel launch"
            : "Clear"}
        </button>
      </div>
    </form>
  );
});

// The market clock now ticks inside its own <HeaderMarketClock> component, so a
// clock tick no longer re-renders the header body. These popover-content
// components are still heavy, so they stay memoized: they receive referentially
// stable props while connected (the popover model is memoized and the insight
// model is null when idle), which keeps any header re-render from re-rendering the
// open broker popover subtree.
const HeaderIbkrTriggerSummaryMemo = memo(HeaderIbkrTriggerSummary);
const HeaderMarketDataLineUsageMemo = memo(HeaderMarketDataLineUsage);
const HeaderIbkrConnectionSummaryMemo = memo(HeaderIbkrConnectionSummary);
const HeaderIbkrAdvancedDetailsMemo = memo(HeaderIbkrAdvancedDetails);
const HeaderIbkrOperationStepperMemo = memo(HeaderIbkrOperationStepper);

// The market clock ticks once per second. Isolating it in its own component keeps
// that 1Hz re-render out of the heavy HeaderStatusCluster body, so the main-thread
// SMIL status wave is no longer starved/jittered by a full header re-render every
// second. The wave stays smooth UNLESS there is real main-thread work, which
// preserves its value as a live load/health indicator. Mirrors the existing
// HeaderMarketDataLineUsageMemo and isolated elapsed-label pattern in this file.
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
  const runtimeControlReloadRef = useRef(null);
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
  const gatewayLineUsageAvailable = Boolean(
    !safeQaMode && gatewayBrokerSnapshot.lineUsageEnabled,
  );
  const gatewayLineUsageActive = shouldActivateHeaderIbkrLineUsage({
    safeQaMode,
    lineUsageAvailable: gatewayLineUsageAvailable,
  });
  const lineUsageControl = useIbkrLineUsageSnapshot({
    enabled: gatewayLineUsageActive,
    lineUsageStreamEnabled: gatewayLineUsageActive,
    lineUsagePollInterval: 10_000,
    lineUsageDetail: "compact",
  });
  useRuntimeWorkloadFlag(
    "header:ibkr-line-usage",
    gatewayLineUsageActive,
    {
      kind: "poll",
      label: "Header IBKR lines",
      detail: "10s/compact",
      priority: 7,
    },
  );
  useEffect(() => {
    runtimeControlReloadRef.current = lineUsageControl.reload;
  }, [lineUsageControl.reload]);
  const gatewayRuntimeError = null;
  const gatewayRuntimeDiagnostics = useMemo(
    () => gatewayBrokerSnapshot.runtimeDiagnostics,
    [gatewayBrokerSnapshot.runtimeDiagnostics],
  );
  const gatewayLineUsageSnapshot = selectHeaderIbkrLineUsageSnapshot({
    lineUsageSnapshot: lineUsageControl.lineUsageSnapshot,
  });
  const gatewayTriggerModel = useMemo(
    () =>
      buildHeaderIbkrTriggerModel({
        connection: gatewayConnection,
        runtimeDiagnostics: gatewayRuntimeDiagnostics,
        runtimeError: gatewayRuntimeError,
        lineUsageSnapshot: gatewayLineUsageSnapshot,
      }),
    [
      gatewayConnection,
      gatewayLineUsageSnapshot,
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
        lineUsage: null,
        lineUsageSnapshot: gatewayLineUsageSnapshot,
      });
    },
    [
      activeGatewayLatencyStats,
      bridgePopoverOpen,
      gatewayConnection,
      gatewayLineUsageSnapshot,
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
  const remoteDesktopLaunchBrowser = shouldUseRemoteIbkrLaunchBrowser({
    desktopAgentCompatible: desktopAgentCompatibleForLaunch,
    desktopAgentOnline: desktopAgentOnlineForLaunch,
    desktopAgentRegistered: desktopAgentRegisteredForLaunch,
    desktopAgentUpgradeRequired: desktopAgentUpgradeRequiredForLaunch,
  });
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
  let autoLoginActionLabel = "Launch with credentials";
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

  const refreshIbkrConnectionStatus = useCallback((options = {}) => {
    const { includeSupplementalState = false } = options;
    const pending = [
      queryClient.refetchQueries({
        queryKey: ["/api/session"],
        exact: true,
        type: "active",
      }),
    ];
    if (includeSupplementalState && runtimeControlReloadRef.current) {
      pending.push(runtimeControlReloadRef.current());
    }
    return Promise.allSettled(pending);
  }, [queryClient]);

  // The session (connection status) only refetches every ~20s, but line usage
  // polls faster and reflects live subscriptions sooner. If lines are actively
  // being consumed — positive proof the bridge is up — while the session still
  // reports disconnected, pull a fresh session immediately so the indicator
  // stops lagging reality during reconnect/bring-up. One-shot, debounced; it
  // self-stops once the refreshed session reports connected.
  const connectionResyncAtRef = useRef(0);
  useEffect(() => {
    const activeLineCount = Number(
      gatewayLineUsageSnapshot?.admission?.pressure?.activeLineCount ?? 0,
    );
    if (activeLineCount <= 0 || gatewayConnectedForBridge) {
      return;
    }
    const now = Date.now();
    if (now - connectionResyncAtRef.current < 5_000) {
      return;
    }
    connectionResyncAtRef.current = now;
    void refreshIbkrConnectionStatus();
  }, [
    gatewayLineUsageSnapshot,
    gatewayConnectedForBridge,
    refreshIbkrConnectionStatus,
  ]);

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
    if (bridgeLaunchInFlightUntil <= Date.now()) {
      if (bridgeRuntimeActivationStillActive) {
        setBridgeActivationActive(true);
        return undefined;
      }
      const staleActivationId = bridgeActivationId;
      const staleManagementToken = bridgeManagementToken;
      clearBridgeLaunchSessionState();
      void platformJsonRequest(
        `/api/ibkr/activation/${encodeURIComponent(staleActivationId)}/cancel`,
        {
          method: "POST",
          body: {
            managementToken: staleManagementToken,
          },
          timeoutMs: 0,
        },
      ).catch(() => {});
      return undefined;
    }

    let canceled = false;
    let timerId = null;
    const validateActivation = async () => {
      try {
        const payload = await platformJsonRequest(
          `/api/ibkr/activation/${encodeURIComponent(bridgeActivationId)}/status`,
          {
            method: "POST",
            body: {
              managementToken: bridgeManagementToken,
            },
            timeoutMs: 0,
          },
        );
        if (canceled) {
          return;
        }
        setBridgeActivationStatus(payload || null);
        if (payload?.active && !payload.canceled) {
          setBridgeActivationActive(true);
          return;
        }
        clearBridgeLaunchSessionState();
      } catch (error) {
        if (canceled) {
          return;
        }
        if (
          error?.status === 404 ||
          error?.code === "ibkr_bridge_activation_not_found" ||
          error?.code === "ibkr_bridge_activation_superseded" ||
          error?.code === "ibkr_bridge_activation_canceled"
        ) {
          clearBridgeLaunchSessionState();
          return;
        }
        setBridgeActivationActive(false);
      }
    };

    void validateActivation();
    timerId = window.setInterval(
      validateActivation,
      IBKR_BRIDGE_ACTIVATION_STATUS_POLL_MS,
    );
    return () => {
      canceled = true;
      if (timerId !== null) {
        window.clearInterval(timerId);
      }
    };
  }, [
    bridgeActivationId,
    bridgeLaunchInFlightUntil,
    bridgeManagementToken,
    bridgeRuntimeActivationStillActive,
    clearBridgeLaunchSessionState,
    gatewayConnectedForBridge,
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
    async ({
      activationId,
      managementToken,
      password,
      shouldAbort: shouldAbortOverride,
      signal,
      username,
    }) => {
      // The user-cancel signal. Read live (not captured) so a cancel that lands
      // mid-handoff is observed by the key-wait loop and the pre-POST guard.
      const shouldAbort = () =>
        bridgeLaunchCancelRequestedRef.current || shouldAbortOverride?.() === true;
      let handoff;
      reportIbkrBrowserConnectionEvent({
        activationId,
        managementToken,
        phase: "credentials",
        step: "login_key_wait_started",
        message: "Browser is waiting for the Windows helper credential key.",
      });
      try {
        handoff = await waitForIbkrLoginKey({
          activationId,
          managementToken,
          signal,
          shouldAbort,
        });
      } catch (error) {
        reportIbkrBrowserConnectionEvent({
          activationId,
          managementToken,
          phase: "credentials",
          step: "login_key_timeout",
          status: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      if (handoff.completedWithoutCredentials) {
        setBridgeLauncherNotice(
          "IB Gateway was already ready or the bridge attached before credentials were needed.",
        );
        clearBridgeLaunchSessionState();
        // No credentials were actually delivered (the activation vanished/was
        // already attached). Report not-delivered so callers do NOT wipe the
        // typed password — the user may still need it to retry.
        return { delivered: false, completedWithoutCredentials: true };
      }

      reportIbkrBrowserConnectionEvent({
        activationId,
        managementToken,
        phase: "credentials",
        step: "login_key_ready",
        message: "Browser received the Windows helper credential key.",
      });
      appendBridgeActivationProgress({
        activationId,
        status: "waiting_gateway",
        step: "encrypting_credentials",
        message: "Encrypting one-time IBKR credentials in this browser.",
      });
      reportIbkrBrowserConnectionEvent({
        activationId,
        managementToken,
        phase: "credentials",
        step: "encrypting_credentials",
        message: "Encrypting one-time IBKR credentials in this browser.",
      });
      let envelope;
      try {
        envelope = await encryptIbkrLoginEnvelope({
          publicKeyJwk: handoff.key.publicKeyJwk,
          payload: {
            version: 1,
            username,
            password,
            tradingMode: "live",
          },
        });
      } catch (error) {
        reportIbkrBrowserConnectionEvent({
          activationId,
          managementToken,
          phase: "credentials",
          step: "encrypt_failed",
          status: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      // Last gate before the credentials leave the browser: if the user
      // canceled while we were waiting for the key or encrypting, never POST
      // the envelope to an activation they abandoned.
      if (shouldAbort()) {
        throw createIbkrLaunchCanceledError();
      }
      let envelopeAccepted = false;
      let lastEnvelopePostError = null;
      for (let attempt = 1; attempt <= 2 && !envelopeAccepted; attempt += 1) {
        try {
          await platformJsonRequest(
            `/api/ibkr/activation/${encodeURIComponent(activationId)}/login-envelope`,
            {
              method: "POST",
              body: {
                managementToken,
                helperInstanceId: handoff.key.helperInstanceId,
                ...envelope,
              },
              timeoutMs: 0,
            },
          );
          envelopeAccepted = true;
        } catch (error) {
          lastEnvelopePostError = error;
          reportIbkrBrowserConnectionEvent({
            activationId,
            managementToken,
            phase: "credentials",
            step: "envelope_post_failed",
            status: "error",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          try {
            const status = await readIbkrActivationStatus({
              activationId,
              managementToken,
            });
            if (ibkrActivationStatusShowsAcceptedLoginEnvelope(status)) {
              envelopeAccepted = true;
              break;
            }
          } catch {
            // The retry below is the recovery path when status is also temporarily unavailable.
          }
          if (attempt < 2) {
            await sleep(IBKR_LOGIN_HANDOFF_POLL_MS);
          }
        }
      }
      if (!envelopeAccepted) {
        throw (
          lastEnvelopePostError ||
          new Error("IBKR encrypted credential envelope was not accepted.")
        );
      }
      appendBridgeActivationProgress({
        activationId,
        status: "waiting_gateway",
        step: "credentials_sent_to_pyrus",
        message: "Encrypted credentials sent to Pyrus for the Windows helper.",
      });
      reportIbkrBrowserConnectionEvent({
        activationId,
        managementToken,
        phase: "credentials",
        step: "credentials_sent_to_pyrus",
        message: "Encrypted credentials sent to Pyrus for the Windows helper.",
      });
      setBridgeActivationActive(true);
      setBridgeLauncherNotice(
        "Encrypted credentials delivered. Approve the IBKR Mobile/2FA prompt.",
      );
      return { delivered: true };
    },
    [appendBridgeActivationProgress, clearBridgeLaunchSessionState],
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
        await waitForBridgeLaunchFeedbackPaint();
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

  const handleSubmitAutoLogin = useCallback(async ({ password, username }) => {
    bridgeLaunchCancelRequestedRef.current = false;
    const normalizedUsername = String(username || "").trim();
    const credentialsReady = Boolean(normalizedUsername && password);
    const helperUpdateOnly = Boolean(
      !credentialsReady && desktopReconnectNeedsHelperUpdate,
    );
    if (!credentialsReady && !helperUpdateOnly) {
      setBridgeLauncherError("IBKR username and password are required.");
      return { credentialsDelivered: false };
    }
    bridgePendingAutoLoginCredentialsRef.current = credentialsReady
      ? {
          activationId: bridgeActivationId || null,
          password,
          username: normalizedUsername,
        }
      : null;
    setBridgeManualOperationModel(null);

    if (
      bridgeDirectActivationShouldReplaceCurrentLaunch &&
      bridgeActivationId &&
      bridgeManagementToken
    ) {
      const staleActivationId = bridgeActivationId;
      const staleManagementToken = bridgeManagementToken;
      clearBridgeLaunchSessionState();
      void platformJsonRequest(
        `/api/ibkr/activation/${encodeURIComponent(staleActivationId)}/cancel`,
        {
          method: "POST",
          body: {
            managementToken: staleManagementToken,
          },
          timeoutMs: 0,
        },
      ).catch(() => {});
    } else if (
      bridgeCredentialResumeAvailable &&
      bridgeActivationId &&
      bridgeManagementToken
    ) {
      setBridgePopoverOpen(true);
      setBridgeLauncherBusy(true);
      setBridgeLauncherError(null);
      setBridgeLauncherNotice(
        "Sending credentials to the active Windows helper.",
      );
      // Claim the one-shot auto-resume slot for this activation so the auto-resume
      // effect cannot also post an envelope for it before the backend flips
      // loginEnvelopeSubmitted (which would be a double-submit).
      bridgeCredentialAutoResumeAttemptRef.current = bridgeActivationId;
      bridgePendingAutoLoginCredentialsRef.current = {
        activationId: bridgeActivationId,
        password,
        username: normalizedUsername,
      };
      let resumeDeliveryResult = null;
      try {
        await waitForBridgeLaunchFeedbackPaint();
        resumeDeliveryResult = await deliverIbkrLoginCredentials({
          activationId: bridgeActivationId,
          managementToken: bridgeManagementToken,
          username: normalizedUsername,
          password,
        });
      } catch (error) {
        if (
          bridgeLaunchCancelRequestedRef.current ||
          error?.code === "ibkr_bridge_activation_canceled"
        ) {
          setBridgeLauncherError(null);
          clearBridgeLaunchSessionState();
          return { clearPassword: true };
        }
        setBridgeLauncherError(
          error instanceof Error ? error.message : "IBKR auto-login failed.",
        );
        return { credentialsDelivered: false };
      } finally {
        setBridgeLauncherBusy(false);
      }
      if (resumeDeliveryResult?.delivered) {
        bridgePendingAutoLoginCredentialsRef.current = null;
      }
      return {
        credentialsDelivered: Boolean(resumeDeliveryResult?.delivered),
      };
    }

    const initialUseRemoteDesktopLaunch = shouldUseRemoteIbkrLaunchBrowser({
      desktopAgentCompatible: desktopAgentCompatibleForLaunch,
      desktopAgentOnline: desktopAgentOnlineForLaunch,
      desktopAgentRegistered: desktopAgentRegisteredForLaunch,
      desktopAgentUpgradeRequired: desktopAgentUpgradeRequiredForLaunch,
    });
    let protocolLauncher = null;
    setBridgeActivationStatus(null);
    setBridgePopoverOpen(true);
    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);
    setBridgeLauncherNotice(
      initialUseRemoteDesktopLaunch
        ? "Sending the IBKR launch request to the paired Windows desktop."
        : "Preparing the Windows helper secure credential handoff.",
    );
    void waitForBridgeLaunchFeedbackPaint();
    if (!initialUseRemoteDesktopLaunch) {
      protocolLauncher = openIbkrProtocolLauncher();
    }

    try {
      const launchIbkrBridge = async (useRemoteDesktopLaunch) => {
        if (!useRemoteDesktopLaunch && !protocolLauncher) {
          protocolLauncher = openIbkrProtocolLauncher();
        }

        const requestController =
          typeof AbortController === "function" ? new AbortController() : null;
        const credentialDeliveryController =
          typeof AbortController === "function" ? new AbortController() : null;
        let credentialDeliveryCanceled = false;
        const startCredentialDelivery = (payload) => {
          if (
            !credentialsReady ||
            !payload?.activationId ||
            !payload?.managementToken
          ) {
            return Promise.resolve({ delivered: false });
          }
          return deliverIbkrLoginCredentials({
            activationId: payload.activationId,
            managementToken: payload.managementToken,
            password,
            signal: credentialDeliveryController?.signal,
            shouldAbort: () => credentialDeliveryCanceled,
            username: normalizedUsername,
          });
        };

        const payload = await platformJsonRequest(
          useRemoteDesktopLaunch
            ? "/api/ibkr/remote-launch"
            : "/api/ibkr/bridge/launcher",
          {
            method: useRemoteDesktopLaunch ? "POST" : "GET",
            body: useRemoteDesktopLaunch
              ? { autoLogin: credentialsReady, helperUpdateOnly }
              : undefined,
            signal: requestController?.signal,
            timeoutMs: 0,
          },
        );
        const selectedLaunchUrl = credentialsReady
          ? payload.autoLoginLaunchUrl || payload.launchUrl
          : payload.updateOnlyLaunchUrl || payload.launchUrl;
        if (credentialsReady && payload.activationId) {
          bridgePendingAutoLoginCredentialsRef.current = {
            activationId: payload.activationId,
            password,
            username: normalizedUsername,
          };
        }
        setBridgeActivationId(payload.activationId || null);
        setBridgeManagementToken(payload.managementToken || null);
        setBridgeLaunchUrl(selectedLaunchUrl || null);
        writeIbkrBridgeSessionValue(
          IBKR_BRIDGE_SESSION_KEYS.activationId,
          payload.activationId,
        );
        writeIbkrBridgeSessionValue(
          IBKR_BRIDGE_SESSION_KEYS.managementToken,
          payload.managementToken,
        );
        writeIbkrBridgeSessionValue(
          IBKR_BRIDGE_SESSION_KEYS.launchUrl,
          selectedLaunchUrl,
        );
        const pendingCredentialDelivery = startCredentialDelivery(payload);
        const launched = useRemoteDesktopLaunch
          ? Boolean(payload.remoteLaunch?.jobId)
          : navigateIbkrProtocolLauncher(
              protocolLauncher,
              selectedLaunchUrl,
            );
        if (!launched) {
          credentialDeliveryCanceled = true;
          credentialDeliveryController?.abort();
          void pendingCredentialDelivery.catch(() => {});
          clearBridgeLaunchSessionState();
          throw new Error(
            useRemoteDesktopLaunch
              ? "No paired Windows desktop accepted the IBKR launch request."
              : "Could not open the PYRUS IBKR PowerShell launcher from this browser.",
          );
        }

        setBridgeActivationActive(true);
        appendBridgeActivationProgress({
          activationId: payload.activationId,
          status: "starting_bridge",
          step: useRemoteDesktopLaunch
            ? "queued_on_pyrus"
            : "helper_launch_requested",
          message: useRemoteDesktopLaunch
            ? "IBKR launch request queued in Pyrus for the Windows desktop."
            : "Windows helper launch requested from this browser.",
        });
        if (useRemoteDesktopLaunch) {
          appendBridgeActivationProgress({
            activationId: payload.activationId,
            status: "starting_bridge",
            step: "waiting_desktop_agent",
            message:
              "Waiting for the Windows desktop helper to claim the launch request.",
          });
        }
        const inFlightUntil = Date.now() + IBKR_BRIDGE_CREDENTIAL_LAUNCH_WINDOW_MS;
        setBridgeLaunchInFlightUntil(inFlightUntil);
        writeIbkrBridgeSessionValue(
          IBKR_BRIDGE_SESSION_KEYS.launchInFlightUntil,
          String(inFlightUntil),
        );
        setBridgeLauncherNotice(
          !credentialsReady
            ? "Helper update launched. Re-run broker launch with credentials after PowerShell updates the helper."
            : useRemoteDesktopLaunch
            ? "Waiting for the Windows desktop helper to claim the launch request."
            : "Waiting for the Windows helper to request encrypted credentials.",
        );
        return { payload, pendingCredentialDelivery, useRemoteDesktopLaunch };
      };

      let launchResult;
      try {
        launchResult = await launchIbkrBridge(initialUseRemoteDesktopLaunch);
      } catch (error) {
        if (
          initialUseRemoteDesktopLaunch &&
          isIbkrRemoteDesktopUnavailableError(error) &&
          isWindowsIbkrLaunchBrowser()
        ) {
          clearBridgeLaunchSessionState();
          setBridgeLauncherNotice(
            "No paired desktop agent is online. Opening the Windows helper directly.",
          );
          launchResult = await launchIbkrBridge(false);
        } else {
          throw error;
        }
      }

      if (!credentialsReady) {
        setBridgeLauncherNotice(
          launchResult.useRemoteDesktopLaunch
            ? "Helper update request queued for the Windows desktop. Waiting for the helper to report the update result."
            : "Helper update launched in PowerShell. Waiting for the helper to report the update result.",
        );
        void refreshIbkrConnectionStatus({ includeSupplementalState: true });
        return { clearPassword: true };
      }

      const deliveryResult = await launchResult.pendingCredentialDelivery;
      if (deliveryResult?.delivered) {
        bridgePendingAutoLoginCredentialsRef.current = null;
      }
      return { credentialsDelivered: Boolean(deliveryResult?.delivered) };
    } catch (error) {
      if (protocolLauncher) {
        closeIbkrProtocolLauncher(protocolLauncher);
      }
      if (
        bridgeLaunchCancelRequestedRef.current ||
        error?.code === "ibkr_bridge_activation_canceled"
      ) {
        setBridgeLauncherNotice("IB Gateway launch canceled.");
        setBridgeLauncherError(null);
        clearBridgeLaunchSessionState();
        return { clearPassword: true };
      }
      if (
        isIbkrRemoteDesktopUnavailableError(error) ||
        isTerminalIbkrLaunchError(error)
      ) {
        setBridgeLauncherNotice(null);
        setBridgeLauncherError(
          error instanceof Error ? error.message : "IBKR bridge launch failed.",
        );
        clearBridgeLaunchSessionState();
        return { credentialsDelivered: false };
      }
      setBridgeLauncherError(
        error instanceof Error ? error.message : "IBKR auto-login failed.",
      );
      return { credentialsDelivered: false };
    } finally {
      setBridgeLauncherBusy(false);
    }
  }, [
    appendBridgeActivationProgress,
    bridgeActivationId,
    bridgeCredentialResumeAvailable,
    bridgeDirectActivationShouldReplaceCurrentLaunch,
    bridgeManagementToken,
    clearBridgeLaunchSessionState,
    deliverIbkrLoginCredentials,
    desktopReconnectNeedsHelperUpdate,
    desktopAgentCompatibleForLaunch,
    desktopAgentOnlineForLaunch,
    desktopAgentRegisteredForLaunch,
    desktopAgentUpgradeRequiredForLaunch,
    refreshIbkrConnectionStatus,
  ]);

  const handleCancelBridgeLaunch = useCallback(async () => {
    if (!bridgeActivationId || !bridgeManagementToken) {
      setBridgeLauncherNotice(null);
      setBridgeLauncherError(
        "Cancel launch is unavailable because the backend activation identity is missing.",
      );
      return;
    }

    bridgeLaunchCancelRequestedRef.current = true;
    setBridgeLaunchCancelInFlight(true);
    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);
    setBridgeLauncherNotice("Canceling IB Gateway launch.");
    setBridgeActivationActive(false);
    markBridgeActivationCanceled({
      activationId: bridgeActivationId,
      message: "Cancel requested. Waiting for PYRUS to acknowledge.",
    });
    try {
      await platformJsonRequest(
        `/api/ibkr/activation/${encodeURIComponent(bridgeActivationId)}/cancel`,
        {
          method: "POST",
          body: {
            managementToken: bridgeManagementToken,
          },
          timeoutMs: 0,
        },
      );
      markBridgeActivationCanceled({
        activationId: bridgeActivationId,
        message: "IB Gateway bridge launch was canceled from PYRUS.",
      });
      setBridgeManualOperationModel(null);
      setBridgeLauncherNotice("IB Gateway launch canceled.");
      clearBridgeLaunchSessionState();
    } catch (error) {
      if (
        error?.status === 404 ||
        error?.code === "ibkr_bridge_activation_not_found" ||
        error?.code === "ibkr_bridge_activation_superseded"
      ) {
        markBridgeActivationCanceled({
          activationId: bridgeActivationId,
          message: "No active IB Gateway launch remained.",
        });
        setBridgeManualOperationModel(null);
        setBridgeLauncherNotice("No active IB Gateway launch remained.");
        clearBridgeLaunchSessionState();
      } else {
        setBridgeLauncherError(
          error instanceof Error ? error.message : "Cancel launch failed.",
        );
      }
    } finally {
      setBridgeLauncherBusy(false);
      setBridgeLaunchCancelInFlight(false);
    }
  }, [
    bridgeActivationId,
    bridgeManagementToken,
    clearBridgeLaunchSessionState,
    markBridgeActivationCanceled,
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
    // Only queue + wait on a Windows desktop shutdown when there is a live
    // Gateway to stop. When the bridge is already off, queueing a remote
    // shutdown leaves the "Desktop" step animating on a job no desktop will
    // ever claim (a 35s wait that reads as "stuck detaching"). In that case the
    // detach is idempotent: clear the runtime and settle immediately.
    const queueRemoteShutdown =
      action.queueRemoteShutdown === true && gatewayConnectedForBridge;
    const detachingBridgeOnly = action.stepperVariant === "clear-state";

    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);
    setBridgeLauncherNotice(null);
    setBridgeActivationStatus(null);
    setBridgeManualOperationModel(
      buildDeactivateModel({
        detach: detachingBridgeOnly ? "current" : "pending",
        queue: queueRemoteShutdown ? "current" : "complete",
        message: queueRemoteShutdown
          ? "Queueing Windows desktop shutdown."
          : "Detaching IBKR bridge runtime.",
      }),
    );
    const shutdownRequest = queueRemoteShutdown
      ? platformJsonRequest("/api/ibkr/remote-shutdown", {
          method: "POST",
          body: { managementToken: bridgeManagementToken },
          timeoutMs: 0,
        }).then(
          (payload) => ({ payload, error: null }),
          (error) => ({ payload: null, error }),
        )
      : Promise.resolve({ payload: null, error: null });

    try {
      setBridgeManualOperationModel(
        buildDeactivateModel({
          queue: queueRemoteShutdown ? "current" : "complete",
          detach: "current",
          message: queueRemoteShutdown
            ? "Queueing Windows shutdown and detaching backend runtime."
            : "Detaching IBKR bridge runtime.",
        }),
      );

      setBridgeLauncherNotice(
        queueRemoteShutdown ? "Detaching IBKR bridge." : "Detaching IBKR bridge.",
      );
      // The clear competes with live SSE streams on the event loop and can run
      // slow. Bound it generously (IBKR_BRIDGE_DETACH_TIMEOUT_MS) so it isn't cut
      // off mid-flight, and treat a timeout as "proceeding" rather than a hard
      // failure: the clear is idempotent and the teardown is already underway, so
      // we fall through to the settle path and let the state refresh confirm.
      let detachTimedOut = false;
      try {
        if (bridgeManagementToken && queueRemoteShutdown) {
          try {
            await platformJsonRequest("/api/ibkr/bridge/detach", {
              method: "POST",
              body: {
                managementToken: bridgeManagementToken,
              },
              timeoutMs: IBKR_BRIDGE_DETACH_TIMEOUT_MS,
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
                timeoutMs: IBKR_BRIDGE_DETACH_TIMEOUT_MS,
              },
            );
          }
        } else {
          await platformJsonRequest(
            "/api/settings/backend/actions/ibkr.bridgeOverride.clear",
            {
              method: "POST",
              body: { force: true },
              timeoutMs: IBKR_BRIDGE_DETACH_TIMEOUT_MS,
            },
          );
        }
      } catch (error) {
        if (error?.code !== "request_timeout") {
          throw error;
        }
        detachTimedOut = true;
      }
      setBridgeManualOperationModel(
        buildDeactivateModel({
          queue: queueRemoteShutdown ? "current" : "complete",
          detach: "complete",
          refresh: "current",
          message: detachTimedOut
            ? "Detach is taking longer than usual; verifying connection state."
            : queueRemoteShutdown
              ? "IBKR runtime detached. Refreshing connection state."
              : "IBKR bridge detached. Refreshing connection state.",
        }),
      );
      setBridgeManagementToken(null);
      setBridgeActivationId(null);
      clearIbkrBridgeSessionValues();
      setBridgeLaunchUrl(null);
      setBridgeLaunchInFlightUntil(0);
      invalidateIbkrRuntimeQueries(queryClient);
      void refreshIbkrConnectionStatus({ includeSupplementalState: true });
      setBridgeManualOperationModel(
        buildDeactivateModel({
          queue: queueRemoteShutdown ? "current" : "complete",
          detach: "complete",
          refresh: "complete",
          desktop: queueRemoteShutdown ? "pending" : "complete",
          message: detachTimedOut
            ? "IBKR detach requested; the clear is taking longer than usual. Verifying connection state."
            : queueRemoteShutdown
              ? "IBKR detached. Waiting for Windows shutdown queue confirmation."
              : "IBKR bridge detached.",
        }),
      );
      setBridgeLauncherNotice(
        detachTimedOut
          ? "IBKR detach requested; verifying connection state."
          : queueRemoteShutdown
            ? "IBKR detached."
            : "IBKR bridge detached.",
      );
      if (!queueRemoteShutdown) {
        return;
      }
      void shutdownRequest.then(({ payload: shutdown, error }) => {
        if (error) {
          const message =
            error instanceof Error
              ? error.message
              : "shutdown request was not queued";
          setBridgeManualOperationModel(
            buildDeactivateModel({
              queue: "warning",
              detach: "complete",
              refresh: "complete",
              desktop: "warning",
              message: `Windows shutdown was not queued: ${message}`,
            }),
          );
          setBridgeLauncherNotice(
            `IBKR detached. Windows shutdown was not queued: ${message}`,
          );
          return;
        }

        const shutdownJob = shutdown?.shutdown;
        if (!shutdownJob?.jobId || !shutdownJob?.statusToken) {
          setBridgeManualOperationModel(
            buildDeactivateModel({
              queue: "warning",
              detach: "complete",
              refresh: "complete",
              desktop: "warning",
              message: "IBKR detached. Windows shutdown was not queued.",
            }),
          );
          setBridgeLauncherNotice("IBKR detached.");
          return;
        }

        setBridgeManualOperationModel(
          buildDeactivateModel({
            queue: "complete",
            detach: "complete",
            refresh: "complete",
            desktop: "current",
            message: "Waiting for the Windows desktop to stop IB Gateway.",
          }),
        );
        setBridgeLauncherNotice(
          "IBKR detached. Waiting for the Windows desktop to stop IB Gateway.",
        );
        void waitForIbkrDesktopJob({
          jobId: shutdownJob.jobId,
          statusToken: shutdownJob.statusToken,
        }).then(
          () => {
            invalidateIbkrRuntimeQueries(queryClient);
            void refreshIbkrConnectionStatus({ includeSupplementalState: true });
            setBridgeManualOperationModel(
              buildDeactivateModel({
                queue: "complete",
                detach: "complete",
                refresh: "complete",
                desktop: "complete",
                message: "IBKR detached and Gateway stopped on the Windows desktop.",
              }),
            );
            setBridgeLauncherNotice(
              "IBKR detached and Gateway stopped on the Windows desktop.",
            );
          },
          (statusError) => {
            const message =
              statusError instanceof Error
                ? statusError.message
                : "shutdown was not confirmed";
            setBridgeManualOperationModel(
              buildDeactivateModel({
                queue: "complete",
                detach: "complete",
                refresh: "complete",
                desktop: "warning",
                message: `Windows shutdown was not confirmed: ${message}`,
              }),
            );
            setBridgeLauncherNotice(
              `IBKR detached. Windows shutdown was not confirmed: ${message}`,
            );
          },
        );
      });
    } catch (error) {
      setBridgeManualOperationModel(
        buildDeactivateModel({
          queue: queueRemoteShutdown ? "current" : "complete",
          detach: "error",
          message:
            error instanceof Error
              ? error.message
              : detachingBridgeOnly
                ? "Detach bridge failed."
                : "Deactivate failed.",
        }),
      );
      setBridgeLauncherError(
        error instanceof Error
          ? error.message
          : detachingBridgeOnly
            ? "Detach bridge failed."
            : "Deactivate failed.",
      );
    } finally {
      setBridgeLauncherBusy(false);
    }
  }, [
    bridgeDeactivateAction,
    bridgeManagementToken,
    gatewayConnectedForBridge,
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
      <div style={{ position: "relative", display: "flex", flex: "0 0 max-content" }}>
        <button
          ref={bridgeTriggerRef}
          type="button"
          aria-label="Open IB Gateway connection details"
          aria-expanded={bridgePopoverOpen}
          onClick={() => setBridgePopoverOpen((current) => !current)}
          className="ra-hover-accent-bg"
          style={{
            ...surfaceStyle,
            display: "grid",
            alignItems: "center",
            justifyContent: "stretch",
            width: "max-content",
            minWidth: "max-content",
            maxWidth: "none",
            padding: sp(compact ? "2px 14px 2px 3px" : compressed ? "2px 15px 2px 4px" : "6px 20px 6px 8px"),
            position: "relative",
            color: CSS_COLOR.text,
            appearance: "none",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          <HeaderIbkrTriggerSummaryMemo
            model={displayedGatewayPopoverModel}
            connection={gatewayConnection}
            tone={displayedGatewayTone}
            latencyStats={activeGatewayLatencyStats}
            compact={compact}
            dense={isDense}
            minimal={minimal}
          />
          <ChevronDown
            size={dim(12)}
            color={CSS_COLOR.textMuted}
            strokeWidth={2.3}
            style={{
              position: "absolute",
              right: dim(5),
              top: dim(compressed ? 3 : 5),
              pointerEvents: "none",
            }}
          />
        </button>

        {bridgePopoverOpen && typeof document !== "undefined" ? createPortal((
          <>
          {bridgePopoverAsSheet ? (
            <div
              data-testid="header-ibkr-mobile-sheet-backdrop"
              aria-hidden="true"
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 279,
                background: `${cssColorMix(CSS_COLOR.bg0, 40)}`,
                touchAction: "none",
              }}
            />
          ) : null}
          <div
            data-testid={bridgePopoverAsSheet ? "header-ibkr-mobile-sheet" : undefined}
            ref={bridgePopoverRef}
            role="dialog"
            aria-modal={bridgePopoverAsSheet ? true : undefined}
            aria-label="IB Gateway bridge"
            style={{
              position: "fixed",
              top: bridgePopoverAsSheet ? "auto" : bridgePopoverPosition?.top ?? dim(40),
              left: bridgePopoverAsSheet ? 0 : bridgePopoverPosition?.left ?? dim(8),
              right: bridgePopoverAsSheet ? 0 : undefined,
              bottom: bridgePopoverAsSheet ? 0 : undefined,
              zIndex: bridgePopoverAsSheet ? 280 : 240,
              width: bridgePopoverAsSheet ? "100vw" : bridgePopoverPosition?.width ?? dim(408),
              maxWidth: bridgePopoverAsSheet ? "100vw" : `calc(100vw - ${dim(16)}px)`,
              maxHeight: bridgePopoverAsSheet
                ? "min(82dvh, 620px)"
                : Math.min(
                  bridgePopoverPosition?.maxHeight ?? dim(420),
                  dim(420),
                ),
              visibility:
                !bridgePopoverAsSheet && !bridgePopoverPosition
                  ? "hidden"
                  : undefined,
              overflowY: "auto",
              WebkitOverflowScrolling: bridgePopoverAsSheet ? "touch" : undefined,
              overscrollBehavior: bridgePopoverAsSheet ? "contain" : undefined,
              boxSizing: "border-box",
              padding: bridgePopoverAsSheet
                ? sp("8px 8px max(12px, env(safe-area-inset-bottom))")
                : sp(8),
              background: CSS_COLOR.bg0,
              border: bridgePopoverAsSheet ? `1px solid ${CSS_COLOR.borderLight}` : "none",
              borderBottom: bridgePopoverAsSheet ? "none" : undefined,
              borderTopLeftRadius: bridgePopoverAsSheet ? dim(RADII.md) : undefined,
              borderTopRightRadius: bridgePopoverAsSheet ? dim(RADII.md) : undefined,
              boxShadow: bridgePopoverAsSheet ? `0 -18px 48px ${cssColorMix(CSS_COLOR.bg0, 80)}` : ELEVATION.lg,
              color: CSS_COLOR.text,
              fontFamily: T.sans,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto auto",
                alignItems: "center",
                gap: sp(6),
                marginBottom: sp(6),
              }}
            >
              <div
                style={{
                  minWidth: 0,
                  display: "flex",
                  alignItems: "baseline",
                  gap: sp(5),
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    color: CSS_COLOR.text,
                    fontSize: textSize("paragraph"),
                    fontWeight: FONT_WEIGHTS.medium,
                    fontFamily: T.sans,
                    lineHeight: 1.15,
                  }}
                >
                  IB Gateway
                </span>
                <span style={{ color: CSS_COLOR.textMuted, fontSize: textSize("paragraphMuted") }}>
                  ·
                </span>
                <span
                  style={{
                    color: displayedBridgeTone.color,
                    fontSize: textSize("paragraph"),
                    fontWeight: FONT_WEIGHTS.label,
                    fontFamily: T.sans,
                    lineHeight: 1.15,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {displayedBridgeTone.label}
                </span>
              </div>
              <span
                style={{
                  color: CSS_COLOR.textSec,
                  fontSize: textSize("paragraphMuted"),
                  fontWeight: FONT_WEIGHTS.medium,
                  fontFamily: T.sans,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {popoverLatencyLabel}
              </span>
              <AppTooltip content="Close">
                <button
                  type="button"
                  onClick={() => setBridgePopoverOpen(false)}
                  style={{
                    width: dim(22),
                    height: dim(22),
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "none",
                    borderRadius: dim(RADII.sm),
                    background: "transparent",
                    color: CSS_COLOR.textSec,
                    cursor: "pointer",
                  }}
                >
                  <X size={dim(13)} strokeWidth={2.2} />
                </button>
              </AppTooltip>
            </div>

            {canDeactivate ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: sp(6),
                  marginBottom: sp(8),
                }}
              >
                <button
                  type="button"
                  onClick={handleDeactivate}
                  disabled={bridgeLauncherBusy}
                  style={{
                    minHeight: dim(32),
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: sp(6),
                    padding: sp("6px 12px"),
                    border: `1px solid ${CSS_COLOR.border}`,
                    borderRadius: dim(RADII.sm),
                    background: CSS_COLOR.bg1,
                    color: CSS_COLOR.textSec,
                    cursor: bridgeLauncherBusy ? "default" : "pointer",
                    fontSize: textSize("paragraphMuted"),
                    fontWeight: FONT_WEIGHTS.medium,
                    fontFamily: T.sans,
                    letterSpacing: 0,
                  }}
                >
                  <X size={dim(12)} strokeWidth={2.2} />
                  {bridgeDeactivateAction.label}
                </button>
              </div>
            ) : null}

            {showCredentialForm ? (
              <HeaderIbkrCredentialForm
                actionDisabled={autoLoginActionDisabled}
                actionLabel={autoLoginActionLabel}
                busy={bridgeLauncherBusy}
                credentialsOptional={autoLoginCredentialsOptional}
                inFlight={bridgeLaunchInFlight}
                launchCancelInFlight={bridgeLaunchCancelInFlight}
                onCancelBridgeLaunch={handleCancelBridgeLaunch}
                onSubmitCredentials={handleSubmitAutoLogin}
                passwordInputRef={autoLoginPasswordInputRef}
                secondaryActionDisabled={bridgeCredentialSecondaryActionDisabled}
                secondaryCancelsLaunch={bridgeCredentialSecondaryCancelsLaunch}
                usernameInputRef={autoLoginUsernameInputRef}
              />
            ) : null}

            {bridgePopoverMessage?.trim() && !bridgeOperationModel ? (
              <div
                style={{
                  minHeight: dim(32),
                  marginBottom: sp(8),
                  padding: sp("10px 12px"),
                  background: CSS_COLOR.bg1,
                  border: `1px solid ${CSS_COLOR.borderLight}`,
                  borderRadius: dim(RADII.sm),
                  color: bridgeLauncherError
                    ? CSS_COLOR.red
                    : CSS_COLOR.textSec,
                  fontSize: textSize("paragraphMuted"),
                  lineHeight: 1.4,
                  fontFamily: T.sans,
                  whiteSpace: "normal",
                  overflowWrap: "anywhere",
                }}
              >
                {bridgePopoverMessage}
              </div>
            ) : null}

            <HeaderIbkrOperationStepperMemo
              insightModel={bridgeConnectionInsightModel}
              model={bridgeOperationModel}
            />

            <HeaderIbkrConnectionSummaryMemo model={displayedGatewayPopoverModel} />
            <HeaderMarketDataLineUsageMemo
              lineUsage={displayedGatewayPopoverModel.lineUsage}
              compactLineUsage={displayedGatewayPopoverModel.compactLineUsage}
            />

            <HeaderIbkrAdvancedDetailsMemo
              insightModel={bridgeConnectionInsightModel}
              model={displayedGatewayPopoverModel}
            />
          </div>
          </>
        ), document.body) : null}
      </div>

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
