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
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ELEVATION,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
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
  resolveIbkrGatewayHealth,
} from "./IbkrConnectionStatus";
import { streamStateTokenVar } from "./streamSemantics";
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
import {
  buildIbkrDeactivateOperationStepper,
  buildIbkrLaunchOperationStepper,
  getIbkrLaunchActionProgressLabel,
} from "./ibkrConnectionOperationStepperModel";
import { buildIbkrConnectionInsightModel } from "./ibkrConnectionInsightModel";
import { buildHeaderIbkrPopoverModel } from "./ibkrPopoverModel";
import { platformJsonRequest } from "./platformJsonRequest";
import { useRuntimeControlSnapshot } from "./useRuntimeControlSnapshot";
import { useRuntimeWorkloadFlag } from "./workloadStats";
import { AppTooltip } from "@/components/ui/tooltip";

const CSS_COLOR = Object.freeze({
  bg0: "var(--ra-surface-0)",
  bg1: "var(--ra-surface-1)",
  bg2: "var(--ra-surface-2)",
  bg3: "var(--ra-surface-3)",
  bg4: "var(--ra-surface-4)",
  border: "var(--ra-border-default)",
  borderLight: "var(--ra-border-light)",
  borderFocus: "var(--ra-border-focus)",
  text: "var(--ra-text-primary)",
  textSec: "var(--ra-text-secondary)",
  textDim: "var(--ra-text-dim)",
  textMuted: "var(--ra-text-muted)",
  accent: "var(--ra-color-accent)",
  accentDim: "var(--ra-accent-dim)",
  accentHoverBg: "var(--ra-accent-hover-bg)",
  accentActiveBg: "var(--ra-accent-active-bg)",
  blue: "var(--ra-blue-500)",
  purple: "var(--ra-purple-500)",
  cyan: "var(--ra-cyan-500)",
  pink: "var(--ra-pink-500)",
  green: "var(--ra-green-500)",
  greenDim: "var(--ra-green-dim)",
  greenBg: "var(--ra-green-bg)",
  red: "var(--ra-red-500)",
  redDim: "var(--ra-red-dim)",
  redBg: "var(--ra-red-bg)",
  amber: "var(--ra-amber-500)",
  amberDim: "var(--ra-amber-dim)",
  amberBg: "var(--ra-amber-bg)",
  pulseLive: "var(--ra-green-500)",
  pulseAlert: "var(--ra-amber-500)",
  pulseLoss: "var(--ra-red-500)",
  onAccent: "var(--ra-on-accent)",
});

const cssColorMix = (color, percent) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

const getIbkrInsightToneColor = (tone) => {
  if (tone === "success") return CSS_COLOR.green;
  if (tone === "attention") return CSS_COLOR.amber;
  if (tone === "error") return CSS_COLOR.red;
  if (tone === "idle") return CSS_COLOR.textMuted;
  return CSS_COLOR.accent;
};

const IBKR_LOGIN_HANDOFF_ALGORITHM = "RSA-OAEP-256-CHUNKED";
const IBKR_LOGIN_HANDOFF_POLL_MS = 250;
const IBKR_LOGIN_HANDOFF_REQUEST_TIMEOUT_MS = 35_000;
const IBKR_LOGIN_HANDOFF_REQUEST_WAIT_MS = 30_000;
const IBKR_LOGIN_HANDOFF_WAIT_MS = 240_000;
const IBKR_LOGIN_HANDOFF_RSA_CHUNK_SIZE = 400;
const IBKR_BRIDGE_RECOGNITION_POLL_MS = 1_000;
const IBKR_BRIDGE_ACTIVATION_STATUS_POLL_MS = 1_000;
const IBKR_DESKTOP_JOB_POLL_MS = 250;
const IBKR_DESKTOP_SHUTDOWN_WAIT_MS = 35_000;

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

const waitForIbkrLoginKey = async ({ activationId, managementToken }) => {
  const deadline = Date.now() + IBKR_LOGIN_HANDOFF_WAIT_MS;
  let lastTransientError = null;
  while (Date.now() < deadline) {
    try {
      const payload = await platformJsonRequest(
        `/api/ibkr/activation/${encodeURIComponent(activationId)}/login-key/read`,
        {
          method: "POST",
          body: {
            managementToken,
            waitMs: IBKR_LOGIN_HANDOFF_REQUEST_WAIT_MS,
          },
          timeoutMs: IBKR_LOGIN_HANDOFF_REQUEST_TIMEOUT_MS,
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
      if (error?.code === "ibkr_bridge_activation_not_found") {
        return {
          completedWithoutCredentials: true,
          key: null,
        };
      }
      if (!error?.status && !error?.code) {
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
      return (
        <AppTooltip
          key={tile.label}
          content={tile.detail ? `${label} · ${tile.detail}` : label}
        >
          <span
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
        </AppTooltip>
      );
    })}
  </div>
);

const getHeaderIbkrTile = (model, label) =>
  model?.tiles?.find((tile) => tile.label === label) || null;

const HeaderIbkrTriggerMetric = ({ label, value, tone }) => (
  <span
    style={{
      display: "grid",
      gap: sp(1),
      minWidth: 0,
      padding: sp("4px 6px"),
      borderRadius: dim(RADII.sm),
      background: `${cssColorMix(tone || CSS_COLOR.textSec, 6)}`,
      fontFamily: T.sans,
      lineHeight: 1.05,
    }}
  >
    <span
      style={{
        color: CSS_COLOR.textMuted,
        fontSize: fs(8),
        fontWeight: FONT_WEIGHTS.regular,
        letterSpacing: "0.04em",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: tone || CSS_COLOR.textSec,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.medium,
        fontVariantNumeric: "tabular-nums",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value ?? MISSING_VALUE}
    </span>
  </span>
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
  const dataTile = getHeaderIbkrTile(model, "Data");
  const streamTile = getHeaderIbkrTile(model, "Stream");
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
  const showInlineLineUsage = compressed;
  const statusLabel = issueActive
    ? model.issue.severity === "warning"
      ? "Attention"
      : "Action needed"
    : health.label || tone.label;
  const shortStatusLabel = statusLabel
    .replace(/^Market\s+/i, "")
    .replace(/^Action needed$/i, "Action")
    .replace(/^Attention$/i, "Issue");
  const metrics = [
    compressed ? null : dataTile,
    compressed ? null : streamTile,
    compressed
      ? null
      : lineUsage?.available
      ? {
          label: "Lines",
          value: lineDisplayValue,
          tone: compactLineUsage?.tone || CSS_COLOR.textSec,
        }
      : null,
  ].filter(Boolean);

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
            ? "auto auto auto auto auto"
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
        {compressed ? null : <span
          style={{
            color: statusTone,
            fontSize: textSize(compressed ? "body" : "paragraphMuted"),
            fontWeight: FONT_WEIGHTS.medium,
            fontFamily: T.sans,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {compressed ? shortStatusLabel : statusLabel}
        </span>}
        <IbkrPingWavelength connection={connection} tone={{ ...tone, color: statusTone }} />
        {showInlineLineUsage ? (
          <span
            data-testid="header-ibkr-line-usage"
            aria-label={`Market data lines ${lineDisplayValue}`}
            title={`Market data lines ${lineDisplayValue}`}
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
      {metrics.length ? (
        <span
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(metrics.length, compact ? 2 : 3)}, minmax(0, 1fr))`,
            gap: sp(4),
            minWidth: 0,
          }}
        >
          {metrics.map((metric) => (
            <HeaderIbkrTriggerMetric
              key={metric.label}
              label={metric.label}
              value={metric.value}
              tone={metric.tone}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
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
    !["ok", "unknown", "matched", "api_active_bridge_missing"].includes(driftStatus);
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
  const summaryItems = [
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
              transition: "transform 0.12s ease",
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
            <span style={{ textAlign: "right" }}>Available</span>
            <span style={{ textAlign: "right" }}>Free</span>
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
                {Number.isFinite(row.covered ?? row.used)
                  ? Math.round(row.covered ?? row.used)
                  : MISSING_VALUE}
              </span>
              <span
                style={{
                  textAlign: "right",
                  color: CSS_COLOR.textSec,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Number.isFinite(
                  row.id === "account-monitor"
                    ? row.needed
                    : row.effectiveCap ?? row.cap,
                )
                  ? Math.round(
                      row.id === "account-monitor"
                        ? row.needed
                        : row.effectiveCap ?? row.cap,
                    )
                  : MISSING_VALUE}
              </span>
              <span
                style={{
                  textAlign: "right",
                  color: CSS_COLOR.textSec,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Number.isFinite(
                  row.id === "account-monitor" ? row.deferred : row.free,
                )
                  ? Math.round(row.id === "account-monitor" ? row.deferred : row.free)
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
  return (
    <span
      title={chip.title || chip.label}
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
};

const HeaderProviderChannelChip = ({ channel, tone }) => {
  if (!channel?.label) {
    return null;
  }
  const active = channel.active === true;
  const color = active ? tone || CSS_COLOR.green : CSS_COLOR.textDim;
  return (
    <span
      title={channel.title || channel.label}
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
        title={lane.detail ? `${lane.value} · ${lane.detail}` : lane.value}
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
          title={row.detail}
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
      title={row.detail ? `${row.value} · ${row.detail}` : row.value}
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
    ? rows.filter((row) => row?.label && row.label !== "IBKR")
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
            transition: "transform 0.12s ease",
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
                    background:
                      model.steps[index - 1]?.status === "complete"
                        ? CSS_COLOR.green
                        : activeLine
                          ? `linear-gradient(90deg, ${CSS_COLOR.borderLight}, ${tone}, ${CSS_COLOR.borderLight})`
                          : CSS_COLOR.borderLight,
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
            {insightModel.elapsedLabel ? (
              <span
                style={{
                  flex: "0 0 auto",
                  color: CSS_COLOR.textMuted,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {insightModel.elapsedLabel}
              </span>
            ) : null}
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
  const { preferences } = useUserPreferences();
  const bridgeTriggerRef = useRef(null);
  const bridgePopoverRef = useRef(null);
  const autoLoginUsernameInputRef = useRef(null);
  const bridgeRecognitionRefreshTimerRef = useRef(null);
  const bridgeLaunchCancelRequestedRef = useRef(false);
  const runtimeControlReloadRef = useRef(null);
  const [marketClockNow, setMarketClockNow] = useState(() => Date.now());
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
  const [autoLoginUsername, setAutoLoginUsername] = useState("");
  const [autoLoginPassword, setAutoLoginPassword] = useState("");
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
    !safeQaMode &&
      (bridgePopoverOpen ||
        session?.configured?.ibkr ||
        gatewayConnection?.configured ||
        gatewayConnection?.reachable ||
        gatewayConnection?.authenticated),
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
  useEffect(() => {
    runtimeControlReloadRef.current = runtimeControl.reload;
  }, [runtimeControl.reload]);
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
  const ibkrRuntimeState =
    session?.runtime?.ibkr || runtimeControl.runtimeDiagnostics?.ibkr || null;
  const desktopReconnectNeeded = Boolean(
    ibkrRuntimeState?.desktopAgentOnline && !bridgeRuntimeOverrideActive,
  );
  const desktopReconnectReady = Boolean(
    desktopReconnectNeeded && ibkrRuntimeState?.reconnectAvailable,
  );
  const desktopReconnectKnownBad = Boolean(
    desktopReconnectNeeded &&
      (ibkrRuntimeState?.desktopAgentKnownBad ||
        ibkrRuntimeState?.desktopAgentCompatibility === "known_bad"),
  );
  const desktopReconnectUpgradeRequired = Boolean(
    desktopReconnectNeeded && ibkrRuntimeState?.desktopAgentUpgradeRequired,
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
    (session?.configured?.ibkr && !gatewayConnectedForBridge) ||
      desktopReconnectNeeded,
  );
  const bridgePopoverMessage =
    bridgeLauncherError ||
    bridgeLauncherNotice ||
    (bridgeLaunchInFlight
      ? "IB Gateway activation is running from the Windows helper. Wait for the bridge to attach before launching again."
      : null);
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
    });
  }, [
    bridgeActivationStatus,
    bridgeLaunchCancelInFlight,
    bridgeLaunchInFlight,
    bridgeLauncherError,
    bridgeLauncherBusy,
    bridgePopoverMessage,
    gatewayConnectedForBridge,
  ]);
  const bridgeOperationModel =
    bridgeManualOperationModel || bridgeLaunchOperationModel;
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
      now: marketClockNow,
    });
  }, [
    bridgeActivationStatus,
    bridgeLaunchCancelInFlight,
    bridgeLaunchInFlight,
    bridgeLauncherBusy,
    bridgeLauncherError,
    bridgeOperationModel,
    gatewayConnectedForBridge,
    marketClockNow,
  ]);
  const popoverLatencyMs = Number.isFinite(gatewayConnection?.lastPingMs)
    ? gatewayConnection.lastPingMs
    : gatewayLatencyStats?.totalMs?.p95;
  const popoverLatencyLabel = formatIbkrPingMs(popoverLatencyMs);
  const bridgeLaunchCancelable = Boolean(
    !gatewayConnectedForBridge &&
      bridgeActivationId &&
      bridgeManagementToken &&
      (bridgeActivationActive || bridgeLaunchInFlight || bridgeLauncherBusy),
  );
  const bridgeCredentialResumeAvailable = Boolean(
    !gatewayConnectedForBridge &&
      bridgeActivationId &&
      bridgeManagementToken &&
      bridgeActivationActive &&
      bridgeLaunchInFlight,
  );
  const autoLoginCredentialsReady = Boolean(
    autoLoginUsername.trim() && autoLoginPassword,
  );
  const autoLoginPrimaryCancelsLaunch = Boolean(
    bridgeLaunchCancelable && !bridgeCredentialResumeAvailable,
  );
  const bridgeCredentialSecondaryCancelsLaunch = bridgeLaunchCancelable;
  const bridgeCredentialSecondaryActionDisabled = Boolean(
    bridgeCredentialSecondaryCancelsLaunch
      ? bridgeLaunchCancelInFlight
      : bridgeLauncherBusy,
  );
  const desktopAgentOnlineForLaunch =
    ibkrRuntimeState?.desktopAgentOnline === true;
  const remoteDesktopLaunchBrowser = shouldUseRemoteIbkrLaunchBrowser({
    desktopAgentOnline: desktopAgentOnlineForLaunch,
  });
  const autoLoginActionDisabled = Boolean(
    gatewayConnectedForBridge ||
      bridgeLaunchCancelInFlight ||
      (!autoLoginPrimaryCancelsLaunch && bridgeLauncherBusy) ||
      (!autoLoginPrimaryCancelsLaunch && !autoLoginCredentialsReady) ||
      (!bridgeLaunchCancelable && bridgeLaunchInFlight),
  );
  const autoLoginProgressActionLabel = getIbkrLaunchActionProgressLabel({
    activationStatus: bridgeActivationStatus,
    busy: bridgeLauncherBusy,
    inFlight: bridgeLaunchInFlight,
  });
  let autoLoginActionLabel = "Launch with credentials";
  if (bridgeLauncherBusy || bridgeLaunchInFlight) {
    autoLoginActionLabel = autoLoginProgressActionLabel;
  } else if (bridgeCredentialResumeAvailable) {
    autoLoginActionLabel = "Send credentials";
  } else if (autoLoginPrimaryCancelsLaunch) {
    autoLoginActionLabel = "Cancel launch";
  } else if (desktopReconnectKnownBad) {
    autoLoginActionLabel = "Launch and repair helper";
  } else if (desktopReconnectUpgradeRequired) {
    autoLoginActionLabel = "Launch and update helper";
  } else if (desktopReconnectReady) {
    autoLoginActionLabel = "Reconnect on desktop";
  } else if (gatewayReconnectNeeded) {
    autoLoginActionLabel = "Reconnect with credentials";
  } else if (remoteDesktopLaunchBrowser) {
    autoLoginActionLabel = "Launch on desktop";
  }
  const showCredentialForm = !gatewayConnectedForBridge;
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
    transition: "background 0.12s ease, color 0.12s ease",
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
      queryClient.refetchQueries({
        queryKey: ["platform-runtime-diagnostics"],
        exact: false,
        type: "active",
      }),
    ];
    if (runtimeControlReloadRef.current) {
      pending.push(runtimeControlReloadRef.current());
    }
    return Promise.allSettled(pending);
  }, [queryClient]);

  const openBridgeReconnectPopover = useCallback(() => {
    setBridgePopoverOpen(true);
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
    setBridgeActivationActive(false);
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

    if (!bridgePopoverAsSheet) {
      window.addEventListener("resize", updateBridgePopoverPosition);
      window.addEventListener("scroll", updateBridgePopoverPosition, true);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      if (!bridgePopoverAsSheet) {
        window.removeEventListener("resize", updateBridgePopoverPosition);
        window.removeEventListener("scroll", updateBridgePopoverPosition, true);
      }
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [bridgePopoverAsSheet, bridgePopoverOpen, updateBridgePopoverPosition]);

  const handleClearCredentialForm = useCallback(() => {
    if (bridgeLauncherBusy) {
      return;
    }
    setAutoLoginUsername("");
    setAutoLoginPassword("");
  }, [bridgeLauncherBusy]);

  const appendBridgeActivationProgress = useCallback(
    ({ activationId, message, status, step }) => {
      if (!activationId || !step) {
        return;
      }
      const latestProgress = {
        activationId,
        bridgeUrl: null,
        helperVersion:
          ibkrRuntimeState?.desktopAgentExpectedHelperVersion || null,
        message,
        status,
        step,
        updatedAt: new Date().toISOString(),
      };
      setBridgeActivationStatus((current) => {
        const recentProgress = Array.isArray(current?.recentProgress)
          ? current.recentProgress
          : [];
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

  const deliverIbkrLoginCredentials = useCallback(
    async ({ activationId, managementToken, username, password }) => {
      const handoff = await waitForIbkrLoginKey({
        activationId,
        managementToken,
      });
      if (handoff.completedWithoutCredentials) {
        setBridgeLauncherNotice(
          "IB Gateway was already ready or the bridge attached before credentials were needed.",
        );
        clearBridgeLaunchSessionState();
        setAutoLoginPassword("");
        return;
      }

      appendBridgeActivationProgress({
        activationId,
        status: "waiting_gateway",
        step: "encrypting_credentials",
        message: "Encrypting one-time IBKR credentials in this browser.",
      });
      const envelope = await encryptIbkrLoginEnvelope({
        publicKeyJwk: handoff.key.publicKeyJwk,
        payload: {
          version: 1,
          username,
          password,
          tradingMode: "live",
        },
      });
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
      appendBridgeActivationProgress({
        activationId,
        status: "waiting_gateway",
        step: "credentials_sent_to_pyrus",
        message: "Encrypted credentials sent to Pyrus for the Windows helper.",
      });
      setAutoLoginPassword("");
      setBridgeActivationActive(true);
      setBridgeLauncherNotice(
        "Encrypted credentials delivered. Approve the IBKR Mobile/2FA prompt.",
      );
    },
    [appendBridgeActivationProgress, clearBridgeLaunchSessionState],
  );

  const handleSubmitAutoLogin = useCallback(async (event) => {
    event.preventDefault();
    bridgeLaunchCancelRequestedRef.current = false;
    const username = autoLoginUsername.trim();
    const password = autoLoginPassword;
    if (!username || !password) {
      setBridgeLauncherError("IBKR username and password are required.");
      return;
    }
    setBridgeManualOperationModel(null);

    if (
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
      try {
        await deliverIbkrLoginCredentials({
          activationId: bridgeActivationId,
          managementToken: bridgeManagementToken,
          username,
          password,
        });
      } catch (error) {
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
        setAutoLoginPassword("");
        setBridgeLauncherBusy(false);
      }
      return;
    }

    const initialUseRemoteDesktopLaunch = shouldUseRemoteIbkrLaunchBrowser({
      desktopAgentOnline: desktopAgentOnlineForLaunch,
    });
    let protocolLauncher = initialUseRemoteDesktopLaunch
      ? null
      : openIbkrProtocolLauncher();
    setBridgeActivationStatus(null);
    setBridgePopoverOpen(true);
    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);
    setBridgeLauncherNotice(
      initialUseRemoteDesktopLaunch
        ? "Sending the IBKR launch request to the paired Windows desktop."
        : "Preparing the Windows helper secure credential handoff.",
    );

    try {
      const launchIbkrBridge = async (useRemoteDesktopLaunch) => {
        if (!useRemoteDesktopLaunch && !protocolLauncher) {
          protocolLauncher = openIbkrProtocolLauncher();
        }

        const payload = await platformJsonRequest(
          useRemoteDesktopLaunch
            ? "/api/ibkr/remote-launch"
            : "/api/ibkr/bridge/launcher",
          {
            method: useRemoteDesktopLaunch ? "POST" : "GET",
            body: useRemoteDesktopLaunch ? { autoLogin: true } : undefined,
            timeoutMs: 0,
          },
        );
        const selectedLaunchUrl = payload.autoLoginLaunchUrl || payload.launchUrl;
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
        const launched = useRemoteDesktopLaunch
          ? Boolean(payload.remoteLaunch?.jobId)
          : navigateIbkrProtocolLauncher(
              protocolLauncher,
              selectedLaunchUrl,
            );
        if (!launched) {
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
              "Waiting for the Windows desktop helper to claim the launch request. The v7 desktop agent keeps a fast claim request open.",
          });
        }
        const inFlightUntil = Date.now() + IBKR_BRIDGE_CREDENTIAL_LAUNCH_WINDOW_MS;
        setBridgeLaunchInFlightUntil(inFlightUntil);
        writeIbkrBridgeSessionValue(
          IBKR_BRIDGE_SESSION_KEYS.launchInFlightUntil,
          String(inFlightUntil),
        );
        setBridgeLauncherNotice(
          useRemoteDesktopLaunch
            ? "Waiting for the Windows desktop helper to claim the launch request. The v7 desktop agent keeps a fast claim request open."
            : "Waiting for the Windows helper to request encrypted credentials.",
        );
        return { payload, useRemoteDesktopLaunch };
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

      await deliverIbkrLoginCredentials({
        activationId: launchResult.payload.activationId,
        managementToken: launchResult.payload.managementToken,
        username,
        password,
      });
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
        return;
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
        return;
      }
      setBridgeLauncherError(
        error instanceof Error ? error.message : "IBKR auto-login failed.",
      );
    } finally {
      setAutoLoginPassword("");
      setBridgeLauncherBusy(false);
    }
  }, [
    autoLoginPassword,
    autoLoginUsername,
    appendBridgeActivationProgress,
    bridgeActivationId,
    bridgeCredentialResumeAvailable,
    bridgeManagementToken,
    clearBridgeLaunchSessionState,
    deliverIbkrLoginCredentials,
    desktopAgentOnlineForLaunch,
  ]);

  const handleCancelBridgeLaunch = useCallback(async () => {
    if (!bridgeActivationId || !bridgeManagementToken) {
      setBridgeLauncherError(null);
      setBridgeLauncherNotice("No active IB Gateway launch remained.");
      clearBridgeLaunchSessionState();
      return;
    }

    bridgeLaunchCancelRequestedRef.current = true;
    setBridgeLaunchCancelInFlight(true);
    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);
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
      setBridgeActivationStatus((current) => {
        const recentProgress = Array.isArray(current?.recentProgress)
          ? current.recentProgress
          : [];
        const latestProgress = {
          activationId: bridgeActivationId,
          status: "canceled",
          step: "cancel_requested",
          message: "IB Gateway bridge launch was canceled from PYRUS.",
          helperVersion: null,
          bridgeUrl: null,
          updatedAt: new Date().toISOString(),
        };
        return {
          ...(current || {}),
          active: false,
          canceled: true,
          expiresAt: current?.expiresAt || new Date().toISOString(),
          latestProgress,
          recentProgress: [...recentProgress, latestProgress].slice(-20),
        };
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
        setBridgeActivationStatus((current) => ({
          ...(current || {}),
          active: false,
          canceled: true,
          expiresAt: current?.expiresAt || new Date().toISOString(),
          latestProgress: {
            activationId: bridgeActivationId,
            status: "canceled",
            step: "cancel_requested",
            message: "No active IB Gateway launch remained.",
            helperVersion: null,
            bridgeUrl: null,
            updatedAt: new Date().toISOString(),
          },
          recentProgress: [
            ...(Array.isArray(current?.recentProgress)
              ? current.recentProgress
              : []),
            {
              activationId: bridgeActivationId,
              status: "canceled",
              step: "cancel_requested",
              message: "No active IB Gateway launch remained.",
              helperVersion: null,
              bridgeUrl: null,
              updatedAt: new Date().toISOString(),
            },
          ].slice(-20),
        }));
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
  ]);

  const handleDeactivate = useCallback(async () => {
    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);
    setBridgeLauncherNotice(null);
    setBridgeActivationStatus(null);
    setBridgeManualOperationModel(
      buildIbkrDeactivateOperationStepper({
        queue: "current",
        message: "Queueing Windows desktop shutdown.",
      }),
    );
    const shutdownRequest = platformJsonRequest("/api/ibkr/remote-shutdown", {
      method: "POST",
      body: bridgeManagementToken
        ? { managementToken: bridgeManagementToken }
        : { force: true },
      timeoutMs: 0,
    }).then(
      (payload) => ({ payload, error: null }),
      (error) => ({ payload: null, error }),
    );

    try {
      setBridgeManualOperationModel(
        buildIbkrDeactivateOperationStepper({
          queue: "current",
          detach: "current",
          message: "Queueing Windows shutdown and detaching backend runtime.",
        }),
      );

      setBridgeLauncherNotice("Detaching IBKR bridge.");
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
      setBridgeManualOperationModel(
        buildIbkrDeactivateOperationStepper({
          queue: "current",
          detach: "complete",
          refresh: "current",
          message: "IBKR runtime detached. Refreshing connection state.",
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
        buildIbkrDeactivateOperationStepper({
          queue: "current",
          detach: "complete",
          refresh: "complete",
          message: "IBKR detached. Waiting for Windows shutdown queue confirmation.",
        }),
      );
      setBridgeLauncherNotice("IBKR detached.");
      void shutdownRequest.then(({ payload: shutdown, error }) => {
        if (error) {
          const message =
            error instanceof Error
              ? error.message
              : "shutdown request was not queued";
          setBridgeManualOperationModel(
            buildIbkrDeactivateOperationStepper({
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
            buildIbkrDeactivateOperationStepper({
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
          buildIbkrDeactivateOperationStepper({
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
            void refreshIbkrConnectionStatus();
            setBridgeManualOperationModel(
              buildIbkrDeactivateOperationStepper({
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
              buildIbkrDeactivateOperationStepper({
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
        buildIbkrDeactivateOperationStepper({
          queue: "current",
          detach: "error",
          message: error instanceof Error ? error.message : "Deactivate failed.",
        }),
      );
      setBridgeLauncherError(
        error instanceof Error ? error.message : "Deactivate failed.",
      );
    } finally {
      setBridgeLauncherBusy(false);
    }
  }, [bridgeManagementToken, queryClient, refreshIbkrConnectionStatus]);

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
          onMouseEnter={(event) => {
            event.currentTarget.style.background = CSS_COLOR.accentHoverBg;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
        >
          <HeaderIbkrTriggerSummary
            model={gatewayPopoverModel}
            connection={gatewayConnection}
            tone={gatewayTone}
            latencyStats={gatewayLatencyStats}
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
                    color: bridgeTone.color,
                    fontSize: textSize("paragraph"),
                    fontWeight: FONT_WEIGHTS.label,
                    fontFamily: T.sans,
                    lineHeight: 1.15,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {bridgeTone.label}
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
                  Deactivate
                </button>
              </div>
            ) : null}

            {showCredentialForm ? (
              <form
                onSubmit={handleSubmitAutoLogin}
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
                    ref={autoLoginUsernameInputRef}
                    type="text"
                    autoComplete="username"
                    value={autoLoginUsername}
                    onChange={(event) => setAutoLoginUsername(event.target.value)}
                    disabled={bridgeLauncherBusy}
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
                    type="password"
                    autoComplete="current-password"
                    value={autoLoginPassword}
                    onChange={(event) => setAutoLoginPassword(event.target.value)}
                    disabled={bridgeLauncherBusy}
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
                    type={autoLoginPrimaryCancelsLaunch ? "button" : "submit"}
                    onClick={
                      autoLoginPrimaryCancelsLaunch
                        ? handleCancelBridgeLaunch
                        : undefined
                    }
                    disabled={autoLoginActionDisabled}
                    aria-disabled={autoLoginActionDisabled}
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
                      cursor: autoLoginActionDisabled ? "default" : "pointer",
                      fontSize: textSize("paragraphMuted"),
                      fontWeight: FONT_WEIGHTS.medium,
                      fontFamily: T.sans,
                    }}
                  >
                    {bridgeLauncherBusy || bridgeLaunchInFlight ? (
                      <RefreshCw
                        data-ibkr-bridge-spinner
                        size={dim(12)}
                        strokeWidth={2.2}
                        style={{
                          animation: "premiumFlowSpin 820ms linear infinite",
                        }}
                      />
                    ) : null}
                    {autoLoginActionLabel}
                  </button>
	                  <button
	                    type="button"
	                    onClick={
	                      bridgeCredentialSecondaryCancelsLaunch
	                        ? handleCancelBridgeLaunch
	                        : handleClearCredentialForm
	                    }
	                    disabled={bridgeCredentialSecondaryActionDisabled}
	                    aria-disabled={bridgeCredentialSecondaryActionDisabled}
                    style={{
                      minHeight: dim(28),
                      border: `1px solid ${CSS_COLOR.border}`,
                      borderRadius: dim(RADII.sm),
                      background: CSS_COLOR.bg0,
                      color: CSS_COLOR.textSec,
	                      cursor: bridgeCredentialSecondaryActionDisabled
	                        ? "default"
	                        : "pointer",
                      fontSize: textSize("paragraphMuted"),
                      fontWeight: FONT_WEIGHTS.medium,
                      fontFamily: T.sans,
                    }}
                  >
	                    {bridgeCredentialSecondaryCancelsLaunch
	                      ? bridgeLaunchCancelInFlight
	                        ? "Canceling"
	                        : "Cancel"
	                      : "Clear"}
                  </button>
                </div>
              </form>
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

            <HeaderIbkrOperationStepper
              insightModel={bridgeConnectionInsightModel}
              model={bridgeOperationModel}
            />

            <HeaderIbkrConnectionSummary model={gatewayPopoverModel} />
            <HeaderMarketDataLineUsage
              lineUsage={gatewayPopoverModel.lineUsage}
              compactLineUsage={gatewayPopoverModel.compactLineUsage}
            />

            <HeaderIbkrAdvancedDetails
              insightModel={bridgeConnectionInsightModel}
              model={gatewayPopoverModel}
            />
          </div>
          </>
        ), document.body) : null}
      </div>

      {compact ? null : (
      <AppTooltip content={`${marketClock.dateLabel} · ${marketClock.timeLabel} · ${marketClock.label}`}><div
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
        onMouseEnter={(event) => {
          event.currentTarget.style.background = CSS_COLOR.accentHoverBg;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "transparent";
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
      </div></AppTooltip>
      )}

      {compact || minimal || !showThemeToggle ? null : (
      <AppTooltip content={
          theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
        }><button
        type="button"
        onClick={onToggleTheme}
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
          transition: "background 0.12s ease, color 0.12s ease",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = CSS_COLOR.accentHoverBg;
          event.currentTarget.style.color = CSS_COLOR.accent;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "transparent";
          event.currentTarget.style.color = CSS_COLOR.textSec;
        }}
      >
        {theme === "dark" ? "☼" : "☾"}
      </button></AppTooltip>
      )}
    </div>
  );
};

export const MemoHeaderStatusCluster = memo(HeaderStatusCluster);
