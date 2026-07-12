import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import {
  getGetRobinhoodReadinessQueryKey,
  getGetSchwabReadinessQueryKey,
  getGetBrokerExecutionIncludedAccountsQueryKey,
  getGetSnapTradeReadinessQueryKey,
  getListAccountsQueryKey,
  getListBrokerConnectionsQueryKey,
  useGetBrokerExecutionIncludedAccounts,
  useGenerateSnapTradeConnectionPortal,
  useGetSnapTradeAccountPortfolio,
  useGetSnapTradeReadiness,
  useListBrokerConnections,
  useListSnapTradeBrokerages,
  useRegisterSnapTradeCurrentUser,
  useSyncSnapTradeBrokerageConnections,
  useGetRobinhoodReadiness,
  useStartRobinhoodConnect,
  useSyncRobinhoodConnections,
  useGetSchwabReadiness,
  useStartSchwabConnect,
  useSyncSchwabConnections,
  useGetIbkrPortalReadiness,
  useConnectIbkrPortal,
  useDisconnectIbkrPortal,
  useSetBrokerExecutionIncludedAccounts,
  getIbkrPortalStatus,
} from "@workspace/api-client-react";
import {
  Check,
  Copy,
  DatabaseZap,
  ExternalLink,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unplug,
  WalletCards,
  X,
} from "lucide-react";
import { Button } from "../../components/ui/Button.jsx";
import { SurfacePanel } from "../../components/platform/primitives.jsx";
import { useAuthSession } from "../../features/auth/authSession.jsx";
import { writeSnapTradeExecutionAccountState } from "../../features/broker/snapTradeExecutionAccountStore.js";
import {
  CSS_COLOR,
  ELEVATION,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  buildSnapTradeBrokerChoices,
  buildSnapTradeConnectionPortalBody,
  canManageSnapTradeConnections,
} from "./snapTradeConnectModel.js";
import {
  ROBINHOOD_UPGRADE_OPTIONS_URL,
  ROBINHOOD_USER_STATUS_LABELS,
  formatRobinhoodAccountBlockers,
  formatRobinhoodConnectOutcome,
  formatRobinhoodLimitation,
  formatRobinhoodOptionLevel,
} from "./robinhoodConnectModel.js";
import {
  SCHWAB_USER_STATUS_LABELS,
  formatSchwabConnectOutcome,
  formatSchwabLimitation,
  isSchwabReauthRequired,
  schwabConnectActionLabel,
} from "./schwabConnectModel.js";
import {
  buildIbkrPortalProgressModel,
  formatIbkrPortalStatus,
  hasIbkrPortalLoginTimedOut,
  isTerminalIbkrPortalConnectStatus,
  restoreIbkrPortalFocus,
} from "./ibkrPortalConnectModel.js";
import {
  BROKER_ERROR_FLASH_MS,
  BROKER_RING_SPECS,
  BROKER_SUCCESS_FLASH_MS,
  brokerCardStatusLine,
  deriveBrokerCardPhase,
  errorFlashKeys,
  successFlashKeys,
} from "./brokerConnectionLifecycle.js";
import {
  buildBrokerConnectQrDataUri,
  copyBrokerConnectLaunchUrl,
} from "./brokerConnectHandoffQr.js";

// Robinhood feather mark, inlined as a self-contained SVG data URI so the tile
// carries no external/CDN image dependency. Rendered on the same white logo
// frame as every other broker tile.
const ROBINHOOD_LOGO_DATA_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#00C805">' +
      '<path d="M2.84 24h.53c.096 0 .192-.048.224-.128C7.591 13.696 11.94 8.656 14.67 5.638c.112-.128.064-.225-.096-.225h-4.88a.55.55 0 0 0-.45.225L5.746 9.972c-.514.642-.642 1.236-.642 2.086v4.43c-1.14 3.194-1.862 5.361-2.392 7.32-.032.125.016.192.129.192M20.447.646c-.754-.802-4.157-.834-5.73-.224a3 3 0 0 0-.786.465 41 41 0 0 0-3.323 3.178c-.112.113-.064.225.097.225h5.409c.497 0 .786.289.786.786v6.1c0 .16.128.208.225.064l3.258-4.254c.53-.69.69-.898.835-1.861.192-1.413.08-3.58-.77-4.479m-6.982 16.18 2.231-3.676a.7.7 0 0 0 .064-.29V6.73c0-.16-.112-.225-.224-.097-3.355 3.74-5.971 7.672-8.395 12.407-.06.12.016.225.16.177l5.009-1.54c.565-.174.882-.402 1.155-.852"/>' +
      "</svg>",
  );

// Robinhood is a DIRECT OAuth broker (not a SnapTrade-aggregated brokerage), so
// it rides in the same picker grid but drives its own connect/sync flow.
const ROBINHOOD_BROKER_CHOICE = Object.freeze({
  value: "ROBINHOOD",
  label: "Robinhood",
  detail: "Direct OAuth",
  logoUrl: ROBINHOOD_LOGO_DATA_URI,
  direct: true,
});

// Schwab-blue "S" monogram, inlined as a self-contained SVG data URI for the
// same reason as the Robinhood mark: no external/CDN image dependency.
const SCHWAB_LOGO_DATA_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<text x="12" y="17.5" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="17" fill="#00A0DF">S</text>' +
      "</svg>",
  );

// Schwab is also a DIRECT OAuth broker (Schwab Trader API, confidential app
// client). Its refresh token hard-expires after 7 days, so the tile surfaces a
// weekly Reconnect state that the other brokers do not have.
const SCHWAB_BROKER_CHOICE = Object.freeze({
  value: "SCHWAB",
  label: "Charles Schwab",
  detail: "Direct OAuth",
  logoUrl: SCHWAB_LOGO_DATA_URI,
  direct: true,
});

// IBKR monogram, inlined as a self-contained SVG data URI for the same
// reason as the Robinhood/Schwab marks: no external/CDN image dependency.
const IBKR_LOGO_DATA_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<text x="12" y="17" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="10" fill="#CC0000">IBKR</text>' +
      "</svg>",
  );

// IBKR Client Portal (hosted gateway) is a DIRECT browser-login broker (not a
// SnapTrade-aggregated brokerage, and not an OAuth redirect like
// Robinhood/Schwab): Connect opens the capsule-local browser through the
// authenticated noVNC tunnel and the panel polls status until it reports
// "connected". Sessions expire roughly every 24h, requiring re-login.
const IBKR_PORTAL_BROKER_CHOICE = Object.freeze({
  value: "IBKR_PORTAL",
  label: "Interactive Brokers",
  detail: "Client Portal",
  logoUrl: IBKR_LOGO_DATA_URI,
  direct: true,
});

// The OAuth and SnapTrade auth pages block iframe embedding, so those broker
// flows still use a top-level popup. IBKR uses its dedicated in-app surface.
function openBrokerPopup(url, name) {
  const width = 480;
  const height = 760;
  const baseLeft = window.screenLeft ?? window.screenX ?? 0;
  const baseTop = window.screenTop ?? window.screenY ?? 0;
  const viewportW = window.outerWidth || width;
  const viewportH = window.outerHeight || height;
  const left = Math.round(baseLeft + Math.max(0, (viewportW - width) / 2));
  const top = Math.round(baseTop + Math.max(0, (viewportH - height) / 2));
  return window.open(
    url,
    name,
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
  );
}

function IbkrPortalProgress({ model }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        display: "grid",
        gap: sp(12),
        padding: sp(16),
        background: CSS_COLOR.bg0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        {model.connected ? (
          <ShieldCheck
            size={20}
            strokeWidth={2}
            aria-hidden="true"
            style={{ color: CSS_COLOR.green, flexShrink: 0 }}
          />
        ) : (
          <RefreshCw
            size={20}
            strokeWidth={1.8}
            aria-hidden="true"
            style={{ color: CSS_COLOR.accent, flexShrink: 0 }}
          />
        )}
        <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
          <div
            style={{
              fontFamily: T.sans,
              fontSize: textSize("paragraph"),
              fontWeight: FONT_WEIGHTS.semibold,
            }}
          >
            {model.title}
          </div>
          <div
            style={{
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.5,
            }}
          >
            {model.detail}
          </div>
        </div>
      </div>
      <ol
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: sp(8),
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        {model.steps.map((step, index) => {
          const complete = step.status === "complete";
          const current = step.status === "current";
          const tone = complete
            ? CSS_COLOR.green
            : current
              ? CSS_COLOR.accent
              : CSS_COLOR.textDim;
          return (
            <li
              key={step.id}
              aria-current={current ? "step" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(7),
                minWidth: 0,
                padding: sp("8px 10px"),
                border: `1px solid ${current ? cssColorMix(tone, 45) : CSS_COLOR.border}`,
                borderRadius: dim(RADII.sm),
                background: current
                  ? cssColorMix(tone, 8)
                  : CSS_COLOR.bg1,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: dim(24),
                  height: dim(24),
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                  border: `1px solid ${cssColorMix(tone, 55)}`,
                  borderRadius: "50%",
                  color: tone,
                  fontFamily: T.mono,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.semibold,
                }}
              >
                {complete ? <Check size={14} strokeWidth={2.4} /> : index + 1}
              </span>
              <span style={{ display: "grid", gap: sp(1), minWidth: 0 }}>
                <span
                  style={{
                    color: current || complete ? CSS_COLOR.text : CSS_COLOR.textDim,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    fontWeight: FONT_WEIGHTS.semibold,
                    lineHeight: 1.3,
                  }}
                >
                  {step.label}
                </span>
                <span
                  style={{
                    color: tone,
                    fontFamily: T.sans,
                    fontSize: fs(10),
                    lineHeight: 1.3,
                  }}
                >
                  {complete
                    ? "Complete"
                    : current
                      ? "In progress"
                      : "Pending"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function IbkrPortalLoginDialog({
  open,
  url,
  connecting,
  readiness,
  onClose,
  returnFocusRef,
}) {
  const progress = buildIbkrPortalProgressModel({ readiness, connecting });
  const showViewer = Boolean(
    url && !progress.browserLoginComplete && !progress.connected,
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10020,
            display: "grid",
            placeItems: "center",
            padding: `max(${sp(12)}px, env(safe-area-inset-top, 0px)) max(${sp(12)}px, env(safe-area-inset-right, 0px)) max(${sp(12)}px, env(safe-area-inset-bottom, 0px)) max(${sp(12)}px, env(safe-area-inset-left, 0px))`,
          }}
        >
          <Dialog.Overlay
            style={{
              position: "absolute",
              inset: 0,
              background: cssColorMix(CSS_COLOR.bg0, 82),
            }}
          />
          <Dialog.Content
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreIbkrPortalFocus(returnFocusRef?.current);
            }}
            onPointerDownOutside={(event) => event.preventDefault()}
            style={{
              position: "relative",
              zIndex: 1,
              display: "grid",
              gridTemplateRows: showViewer
                ? "auto auto minmax(0, 1fr)"
                : "auto auto",
              width: "100%",
              height: showViewer ? "100%" : "auto",
              maxWidth: dim(showViewer ? 960 : 640),
              maxHeight: dim(800),
              margin: 0,
              padding: 0,
              overflow: "hidden",
              background: CSS_COLOR.bg0,
              color: CSS_COLOR.text,
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.md),
              boxShadow: ELEVATION.lg,
            }}
          >
            <div
              style={{
                minHeight: dim(52),
                padding: sp("6px 8px"),
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(8),
                borderBottom: `1px solid ${CSS_COLOR.border}`,
                background: CSS_COLOR.bg1,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Dialog.Title
                  style={{
                    margin: 0,
                    fontFamily: T.sans,
                    fontSize: textSize("paragraph"),
                    fontWeight: FONT_WEIGHTS.semibold,
                    letterSpacing: 0,
                  }}
                >
                  Interactive Brokers
                </Dialog.Title>
                <div
                  style={{
                    color: CSS_COLOR.textDim,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    letterSpacing: 0,
                  }}
                >
                  Client Portal
                </div>
              </div>
              <Dialog.Close asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Close IBKR Client Portal status"
                  title="Close"
                  style={{
                    width: dim(40),
                    height: dim(40),
                    padding: 0,
                    borderRadius: dim(RADII.xs),
                    flexShrink: 0,
                  }}
                >
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </Button>
              </Dialog.Close>
            </div>
            <IbkrPortalProgress model={progress} />
            {showViewer ? (
              <iframe
                title="Interactive Brokers Client Portal login"
                src={url}
                sandbox="allow-same-origin allow-scripts"
                referrerPolicy="same-origin"
                style={{
                  width: "100%",
                  height: "100%",
                  border: 0,
                  background: "#fff",
                }}
              />
            ) : null}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Watches a broker auth popup: fires onResult with the same-origin callback
// outcome (when the popup returns to our origin carrying ?<originParamKey>=...)
// or fires onClose when the popup closes / times out. Reading the popup URL
// throws while it is on the provider's cross-origin domain, so those reads are
// ignored until it returns to our origin.
function watchBrokerPopup({
  popup,
  pollRef,
  originParamKey,
  onResult,
  onClose,
  timeoutMs = 5 * 60_000,
}) {
  if (pollRef.current) {
    window.clearInterval(pollRef.current);
  }
  const startedAt = Date.now();
  const stop = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  pollRef.current = window.setInterval(() => {
    if (Date.now() - startedAt > timeoutMs) {
      stop();
      onClose?.();
      return;
    }
    if (popup.closed) {
      stop();
      onClose?.();
      return;
    }
    if (!originParamKey) return;
    let outcome = null;
    try {
      const href = popup.location.href;
      if (href && href.startsWith(window.location.origin)) {
        outcome = new URLSearchParams(popup.location.search).get(
          originParamKey,
        );
      }
    } catch {
      // Cross-origin: popup is still on the provider's domain. Ignore.
    }
    if (outcome) {
      stop();
      try {
        popup.close();
      } catch {
        // Some browsers restrict close(); the outcome is already captured.
      }
      onResult?.(outcome);
    }
  }, 400);
}

function readErrorMessage(error, fallback) {
  const payload = error?.data || error?.body || error?.payload;
  return (
    payload?.detail ||
    payload?.message ||
    error?.detail ||
    error?.message ||
    fallback
  );
}

function statusTone(ok, pending = false) {
  if (ok) return CSS_COLOR.green;
  if (pending) return CSS_COLOR.amber;
  return CSS_COLOR.textDim;
}

function formatPortfolioMoney(value, currency = "USD") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MISSING_VALUE;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
}

function formatPortfolioNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MISSING_VALUE;
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatPortfolioDateTime(value) {
  if (!value) return MISSING_VALUE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return MISSING_VALUE;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SNAPTRADE_EXECUTION_BLOCKER_LABELS = {
  "snaptrade.connection.disabled": "reconnect required",
  "snaptrade.connection.read_only": "read-only",
  "snaptrade.connection.permission_unknown": "permission unknown",
  "snaptrade.brokerage.trading_not_supported": "trading unavailable",
  "snaptrade.account.closed": "closed",
  "snaptrade.account.archived": "archived",
};

function formatExecutionBlockers(blockers) {
  const labels = Array.from(
    new Set(
      (Array.isArray(blockers) ? blockers : [])
        .map(
          (blocker) => SNAPTRADE_EXECUTION_BLOCKER_LABELS[blocker] || blocker,
        )
        .filter(Boolean),
    ),
  );
  return labels.length ? labels.join(", ") : "blocked";
}

function formatExecutionState(entity) {
  if (!entity) return MISSING_VALUE;
  return entity.executionReady === true
    ? "ready"
    : formatExecutionBlockers(entity.executionBlockers);
}

function formatBrokerProvider(provider) {
  const normalized = String(provider || "")
    .trim()
    .toLowerCase();
  if (normalized === "ibkr") return "IBKR";
  if (normalized === "snaptrade") return "SnapTrade";
  if (normalized === "robinhood") return "Robinhood";
  if (normalized === "schwab") return "Schwab";
  return provider || "Broker";
}

function formatAccountCategory(category) {
  const normalized = String(category || "equity")
    .trim()
    .toLowerCase();
  if (normalized === "crypto") return "Crypto";
  if (normalized === "futures") return "Futures";
  if (normalized === "prediction") return "Prediction";
  return "Equity";
}

function StatusRow({ label, value, tone = CSS_COLOR.textSec }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(10),
        borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 33)}`,
        padding: sp("7px 0"),
        fontFamily: T.sans,
        fontSize: fs(10),
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
        }}
      >
        {value ?? MISSING_VALUE}
      </span>
    </div>
  );
}

function BrokerConnectHandoff({ handoff, copyStatus, onCopy }) {
  const qrDataUri = useMemo(
    () => buildBrokerConnectQrDataUri(handoff?.url || ""),
    [handoff?.url],
  );

  if (!handoff?.url) return null;

  return (
    <div
      aria-label={`${handoff.label} login handoff`}
      style={{
        border: `1px solid ${cssColorMix(CSS_COLOR.border, 60)}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg1,
        padding: sp(10),
        display: "grid",
        gridTemplateColumns: `minmax(0, 1fr) ${dim(116)}`,
        gap: sp(12),
        alignItems: "center",
      }}
    >
      <div style={{ display: "grid", gap: sp(8), minWidth: 0 }}>
        <div
          style={{
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            lineHeight: 1.45,
          }}
        >
          The login window opens automatically. On a phone or when popups are
          blocked, use the link below and return here when login finishes.
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(8),
            flexWrap: "wrap",
          }}
        >
          <Button variant="secondary" size="sm" onClick={onCopy}>
            <Copy size={13} strokeWidth={2} aria-hidden="true" />
            {copyStatus === "copied" ? "Copied" : "Copy link"}
          </Button>
          <a
            href={handoff.url}
            target="_blank"
            rel="noreferrer"
            style={{
              color: CSS_COLOR.accent,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              overflowWrap: "anywhere",
            }}
          >
            Open login
          </a>
          {copyStatus === "error" ? (
            <span
              role="status"
              style={{
                color: CSS_COLOR.amber,
                fontFamily: T.sans,
                fontSize: fs(10),
              }}
            >
              Copy unavailable
            </span>
          ) : null}
        </div>
      </div>
      {qrDataUri ? (
        <img
          src={qrDataUri}
          alt={`${handoff.label} broker connect QR code`}
          width="116"
          height="116"
          style={{
            width: dim(116),
            height: dim(116),
            background: "#fff",
            border: `1px solid ${cssColorMix(CSS_COLOR.border, 45)}`,
            borderRadius: dim(RADII.sm),
            padding: dim(6),
            boxSizing: "border-box",
          }}
        />
      ) : null}
    </div>
  );
}

function BrokerChoiceLogo({ choice }) {
  const [failed, setFailed] = useState(false);
  const frameStyle = {
    width: dim(26),
    height: dim(26),
    borderRadius: dim(RADII.xs),
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
  };
  if (!choice.logoUrl || failed) {
    return (
      <span
        style={{
          ...frameStyle,
          background: cssColorMix(CSS_COLOR.border, 45),
          color: CSS_COLOR.textSec,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.semibold,
        }}
      >
        {(choice.label || "?").slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <span style={{ ...frameStyle, background: "#fff" }}>
      <img
        src={choice.logoUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </span>
  );
}

// SVG ring overlay tracing the card border — one visual grammar for every
// connector's lifecycle phase (spec: BROKER_RING_SPECS + the brokerRing*
// keyframes in PlatformApp.jsx). pathLength=100 normalizes the rect perimeter
// so dasharray/dashoffset motion is uniform regardless of card size.
function BrokerCardRing({ phase }) {
  const spec = BROKER_RING_SPECS[phase];
  if (!spec) return null;
  const stroke =
    spec.tone === "green"
      ? CSS_COLOR.green
      : spec.tone === "amber"
        ? CSS_COLOR.amber
        : CSS_COLOR.accent;
  const rectAnimation =
    spec.motion === "arc"
      ? "brokerRingArc 1.2s linear infinite"
      : spec.motion === "sweep"
        ? "brokerRingSweep 450ms cubic-bezier(0.25, 1, 0.5, 1) both"
        : "none";
  const svgAnimation =
    spec.motion === "breathe"
      ? "brokerRingBreathe 1.8s ease-in-out infinite"
      : spec.motion === "sweep"
        ? "brokerRingGlow 600ms ease-out 450ms both"
        : spec.motion === "shake"
          ? "brokerErrorShake 240ms cubic-bezier(0.25, 1, 0.5, 1) both"
          : "none";
  const svgFilter =
    spec.motion === "sweep"
      ? undefined
      : spec.glow
        ? `drop-shadow(0 0 3px ${cssColorMix(stroke, 40)})`
        : spec.motion === "shake"
          ? `drop-shadow(0 0 4px ${cssColorMix(stroke, 45)})`
          : undefined;
  return (
    <svg
      data-broker-ring={phase}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
        "--broker-ring-color": stroke,
        animation: svgAnimation,
        filter: svgFilter,
      }}
    >
      <rect
        pathLength="100"
        style={{
          x: "1px",
          y: "1px",
          width: "calc(100% - 2px)",
          height: "calc(100% - 2px)",
          rx: dim(RADII.sm),
          fill: "none",
          stroke,
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeDasharray: spec.dashed
            ? "3 3"
            : spec.arc
              ? "28 72"
              : spec.motion === "sweep"
                ? "100 100"
                : undefined,
          strokeDashoffset: spec.motion === "sweep" ? 100 : undefined,
          animation: rectAnimation,
        }}
      />
      {spec.sheen ? (
        <rect
          pathLength="100"
          style={{
            x: "1px",
            y: "1px",
            width: "calc(100% - 2px)",
            height: "calc(100% - 2px)",
            rx: dim(RADII.sm),
            fill: "none",
            stroke,
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeDasharray: "6 94",
            opacity: 0.4,
            animation: "brokerRingSheen 6s linear infinite",
          }}
        />
      ) : null}
    </svg>
  );
}

// The card is the single surface for a broker: identity + lifecycle ring +
// contextual actions in its footer (docs/plans/broker-connection-ux-plan.md).
// It is a div[role=button] rather than a <button> because the footer holds
// real <Button>s — nested buttons are invalid HTML.
function BrokerChoiceButton({
  choice,
  selected,
  phase = "idle",
  statusLine = "",
  actions = [],
  onSelect,
  focusRef,
}) {
  const connectedVisual = phase === "connected" || phase === "success";
  const borderColor = selected
    ? CSS_COLOR.accent
    : connectedVisual
      ? cssColorMix(CSS_COLOR.green, 55)
      : cssColorMix(CSS_COLOR.border, 70);
  return (
    <div
      ref={focusRef}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-broker-card={choice.value}
      onClick={() => onSelect(choice.value)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(choice.value);
        }
      }}
      style={{
        position: "relative",
        border: `1px solid ${borderColor}`,
        boxShadow: selected ? `0 0 0 1px ${CSS_COLOR.accent}` : "none",
        background: selected ? CSS_COLOR.bg2 : CSS_COLOR.bg1,
        color: selected ? CSS_COLOR.text : CSS_COLOR.textSec,
        opacity: choice.impaired ? 0.65 : 1,
        borderRadius: dim(RADII.sm),
        padding: sp("8px 10px"),
        minHeight: dim(52),
        display: "grid",
        alignContent: "start",
        gap: sp(6),
        textAlign: "left",
        cursor: "pointer",
        fontFamily: T.sans,
      }}
    >
      <BrokerCardRing phase={phase} />
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <BrokerChoiceLogo choice={choice} />
        <span style={{ display: "grid", gap: sp(2), minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: textSize("caption"),
              fontWeight: selected
                ? FONT_WEIGHTS.semibold
                : FONT_WEIGHTS.medium,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {choice.label}
          </span>
          <span
            style={{ color: CSS_COLOR.textDim, fontSize: textSize("body") }}
          >
            {statusLine || choice.detail}
          </span>
        </span>
        {connectedVisual ? (
          <Check
            data-broker-check={phase === "success" ? "draw" : "on"}
            size={13}
            strokeWidth={3}
            aria-label="Connected"
            style={{
              color: CSS_COLOR.green,
              flexShrink: 0,
              animation:
                phase === "success"
                  ? "brokerCheckPop 300ms ease-out 700ms both"
                  : "none",
            }}
          />
        ) : null}
      </span>
      {actions.length ? (
        <span
          style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {actions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant || "secondary"}
              size="xs"
              onClick={action.onClick}
              disabled={action.disabled}
              loading={action.loading}
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </span>
      ) : null}
    </div>
  );
}

export function SnapTradeConnectPanel({ enabled = true }) {
  const queryClient = useQueryClient();
  const [selectedBrokerChoice, setSelectedBroker] = useState("ETRADE");
  const [lastPortal, setLastPortal] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [selectedPortfolioAccountId, setSelectedPortfolioAccountId] =
    useState("");
  const [portalLaunchBlocked, setPortalLaunchBlocked] = useState(false);
  const [localError, setLocalError] = useState("");
  // Card-native lifecycle state: which card has a connect mutation in flight,
  // and which card owns the currently open auth popup (drives the
  // working / awaiting-user ring phases on that card only).
  const [activeConnectKey, setActiveConnectKey] = useState("");
  const [popupBrokerKey, setPopupBrokerKey] = useState("");
  const [connectHandoff, setConnectHandoff] = useState(null);
  const [connectHandoffCopyStatus, setConnectHandoffCopyStatus] = useState("");

  const authSession = useAuthSession();
  const canManage = canManageSnapTradeConnections(authSession.user);
  const csrfToken = authSession.csrfToken || "";
  const csrfHeaders = useMemo(
    () => (csrfToken ? { "x-csrf-token": csrfToken } : {}),
    [csrfToken],
  );

  const readinessQuery = useGetSnapTradeReadiness({
    query: {
      enabled: Boolean(enabled && canManage),
      retry: false,
      staleTime: 15_000,
    },
  });
  const brokeragesQuery = useListSnapTradeBrokerages({
    query: {
      enabled: Boolean(enabled && canManage),
      retry: false,
      staleTime: 300_000,
    },
  });
  const brokerConnectionsQuery = useListBrokerConnections({
    query: {
      enabled: Boolean(enabled),
      retry: false,
      staleTime: 30_000,
    },
  });
  const inclusionQuery = useGetBrokerExecutionIncludedAccounts({
    query: {
      enabled: Boolean(enabled && canManage),
      retry: false,
      staleTime: 30_000,
    },
  });
  const registerMutation = useRegisterSnapTradeCurrentUser({
    request: { headers: csrfHeaders },
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetSnapTradeReadinessQueryKey(),
        });
      },
    },
  });
  const portalMutation = useGenerateSnapTradeConnectionPortal({
    request: { headers: csrfHeaders },
  });
  const syncMutation = useSyncSnapTradeBrokerageConnections({
    request: { headers: csrfHeaders },
    mutation: {
      onSuccess: (data) => {
        setLastSync(data);
        setSelectedPortfolioAccountId((current) => {
          const nextAccountId = data.accounts.some(
            (account) => account.id === current,
          )
            ? current
            : data.accounts.find((account) => account.executionReady === true)
                ?.id ||
              data.accounts[0]?.id ||
              "";
          writeSnapTradeExecutionAccountState({
            accounts: data.accounts,
            selectedAccountId: nextAccountId,
            savedAt: data.syncedAt,
          });
          return nextAccountId;
        });
        void queryClient.invalidateQueries({
          queryKey: getListBrokerConnectionsQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getListAccountsQueryKey(),
        });
      },
    },
  });
  const inclusionMutation = useSetBrokerExecutionIncludedAccounts({
    request: { headers: csrfHeaders },
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetBrokerExecutionIncludedAccountsQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getListAccountsQueryKey(),
        });
      },
    },
  });
  const portfolioQuery = useGetSnapTradeAccountPortfolio(
    selectedPortfolioAccountId || "",
    {
      query: {
        enabled: false,
        retry: false,
      },
    },
  );

  const [robinhoodLastSync, setRobinhoodLastSync] = useState(null);
  const [robinhoodOutcome, setRobinhoodOutcome] = useState("");
  const oauthPollRef = useRef(null);
  const robinhoodReadinessQuery = useGetRobinhoodReadiness({
    query: {
      enabled: Boolean(enabled && canManage),
      retry: false,
      staleTime: 15_000,
    },
  });
  const robinhoodStartMutation = useStartRobinhoodConnect({
    request: { headers: csrfHeaders },
  });
  const robinhoodSyncMutation = useSyncRobinhoodConnections({
    request: { headers: csrfHeaders },
    mutation: {
      onSuccess: (data) => {
        setRobinhoodLastSync(data);
        void queryClient.invalidateQueries({
          queryKey: getListBrokerConnectionsQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getListAccountsQueryKey(),
        });
      },
    },
  });

  const [schwabLastSync, setSchwabLastSync] = useState(null);
  const [schwabOutcome, setSchwabOutcome] = useState("");
  const schwabReadinessQuery = useGetSchwabReadiness({
    query: {
      enabled: Boolean(enabled && canManage),
      retry: false,
      staleTime: 15_000,
    },
  });
  const schwabStartMutation = useStartSchwabConnect({
    request: { headers: csrfHeaders },
  });
  const schwabSyncMutation = useSyncSchwabConnections({
    request: { headers: csrfHeaders },
    mutation: {
      onSuccess: (data) => {
        setSchwabLastSync(data);
        void queryClient.invalidateQueries({
          queryKey: getListBrokerConnectionsQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getListAccountsQueryKey(),
        });
      },
    },
  });

  const [ibkrLoginUrl, setIbkrLoginUrl] = useState("");
  const [ibkrDialogOpen, setIbkrDialogOpen] = useState(false);
  const [ibkrPortalPollReadiness, setIbkrPortalPollReadiness] = useState(null);
  const [ibkrConnecting, setIbkrConnecting] = useState(false);
  const [ibkrDisconnecting, setIbkrDisconnecting] = useState(false);
  const ibkrPollRef = useRef(null);
  const ibkrAttemptRef = useRef(0);
  const ibkrConnectBusyRef = useRef(false);
  const ibkrReturnFocusRef = useRef(null);
  const ibkrPortalReadinessQuery = useGetIbkrPortalReadiness({
    query: {
      enabled: Boolean(enabled && canManage),
      retry: false,
      staleTime: 15_000,
    },
  });
  const ibkrPortalConnectMutation = useConnectIbkrPortal({
    request: { headers: csrfHeaders },
  });
  const ibkrPortalDisconnectMutation = useDisconnectIbkrPortal({
    request: { headers: csrfHeaders },
  });

  const readiness = readinessQuery.data;
  const userReadiness = readiness?.user || null;
  const credentialsReady = readiness?.configured === true;
  const upstreamReady =
    readiness?.clientInfo?.reachable === true ||
    (readiness?.upstream ? readiness.upstream.reachable !== false : false);
  const userRegistered = userReadiness?.snapTradeUserIdPresent === true;
  const syncedAccounts = lastSync?.accounts || [];
  const syncedConnections = lastSync?.connections || [];
  const executionReadyAccounts = syncedAccounts.filter(
    (account) => account.executionReady === true,
  );
  const executionReadyConnections = syncedConnections.filter(
    (connection) => connection.executionReady === true,
  );
  const selectedPortfolioAccount =
    syncedAccounts.find(
      (account) => account.id === selectedPortfolioAccountId,
    ) ||
    syncedAccounts[0] ||
    null;
  const portfolio =
    portfolioQuery.data?.account?.id === selectedPortfolioAccountId
      ? portfolioQuery.data
      : null;
  const portfolioCurrency =
    portfolio?.account?.baseCurrency ||
    selectedPortfolioAccount?.baseCurrency ||
    "USD";
  const busy =
    authSession.isLoading ||
    readinessQuery.isLoading ||
    registerMutation.isPending ||
    portalMutation.isPending ||
    syncMutation.isPending ||
    inclusionMutation.isPending ||
    portfolioQuery.isFetching ||
    robinhoodReadinessQuery.isLoading ||
    robinhoodStartMutation.isPending ||
    robinhoodSyncMutation.isPending ||
    schwabReadinessQuery.isLoading ||
    schwabStartMutation.isPending ||
    schwabSyncMutation.isPending ||
    ibkrPortalReadinessQuery.isLoading ||
    ibkrConnecting ||
    ibkrDisconnecting;
  const connectDisabled = Boolean(
    !canManage ||
      !csrfToken ||
      !credentialsReady ||
      registerMutation.isPending ||
      portalMutation.isPending ||
      syncMutation.isPending,
  );
  const syncDisabled = Boolean(
    !canManage ||
      !csrfToken ||
      !credentialsReady ||
      !userRegistered ||
      registerMutation.isPending ||
      portalMutation.isPending ||
      syncMutation.isPending,
  );
  const portfolioDisabled = Boolean(
    !canManage ||
      !selectedPortfolioAccountId ||
      registerMutation.isPending ||
      portalMutation.isPending ||
      syncMutation.isPending ||
      portfolioQuery.isFetching,
  );
  const inclusionAccounts = inclusionQuery.data?.accounts || [];
  const toggleIncludedAccount = (accountId, nextIncluded) => {
    const includedAccountIds = inclusionAccounts
      .filter((account) =>
        account.id === accountId ? nextIncluded : account.includedInTrading,
      )
      .map((account) => account.id);
    inclusionMutation.mutate({ data: { includedAccountIds } });
  };
  // Avoid the "defaults, then live" flash: render the live tradable list once it
  // arrives, the bundled defaults only if the fetch errored, and nothing while
  // the first fetch is still in flight.
  const brokerChoices = useMemo(() => {
    if (brokeragesQuery.data) {
      return buildSnapTradeBrokerChoices(brokeragesQuery.data?.brokerages);
    }
    if (brokeragesQuery.isError) {
      return buildSnapTradeBrokerChoices(undefined);
    }
    return [];
  }, [brokeragesQuery.data, brokeragesQuery.isError]);
  const allChoices = useMemo(
    () => [
      ...brokerChoices,
      ROBINHOOD_BROKER_CHOICE,
      SCHWAB_BROKER_CHOICE,
      IBKR_PORTAL_BROKER_CHOICE,
    ],
    [brokerChoices],
  );
  const serverBrokerConnections = brokerConnectionsQuery.data?.connections;
  const connectedBrokerSlugs = useMemo(() => {
    const slugs = new Set();
    // Server truth: hydrate connected brokers on initial load (before any sync).
    if (Array.isArray(serverBrokerConnections)) {
      for (const connection of serverBrokerConnections) {
        if (
          connection?.provider === "snaptrade" &&
          connection?.status === "connected" &&
          typeof connection?.brokerageSlug === "string" &&
          connection.brokerageSlug.trim()
        ) {
          slugs.add(connection.brokerageSlug.trim().toUpperCase());
        }
      }
    }
    // Freshness overlay: union the latest sync-derived connections.
    for (const connection of syncedConnections) {
      if (
        connection?.status === "connected" &&
        connection?.disabled !== true &&
        typeof connection?.brokerageSlug === "string" &&
        connection.brokerageSlug.trim()
      ) {
        slugs.add(connection.brokerageSlug.trim().toUpperCase());
      }
    }
    return slugs;
  }, [serverBrokerConnections, syncedConnections]);
  const selectedBroker = allChoices.some(
    (choice) => choice.value === selectedBrokerChoice,
  )
    ? selectedBrokerChoice
    : brokerChoices[0]?.value || selectedBrokerChoice;
  const isRobinhood = selectedBroker === ROBINHOOD_BROKER_CHOICE.value;
  const isSchwab = selectedBroker === SCHWAB_BROKER_CHOICE.value;
  const isIbkrPortal = selectedBroker === IBKR_PORTAL_BROKER_CHOICE.value;
  const isDirectBroker = isRobinhood || isSchwab || isIbkrPortal;

  const robinhoodReadiness = robinhoodReadinessQuery.data;
  const robinhoodUser = robinhoodReadiness?.user || null;
  const robinhoodConfigured = robinhoodReadiness?.configured === true;
  const robinhoodOauthReachable = robinhoodReadiness?.oauth?.reachable === true;
  const robinhoodUserStatus = robinhoodUser?.status || "not_connected";
  const robinhoodConnected = robinhoodUser?.connected === true;
  const robinhoodLimitations = Array.isArray(robinhoodReadiness?.limitations)
    ? robinhoodReadiness.limitations
    : [];
  const robinhoodSyncedAccounts = robinhoodLastSync?.accounts || [];
  const robinhoodOutcomeBanner =
    formatRobinhoodConnectOutcome(robinhoodOutcome);
  const robinhoodConnectDisabled = Boolean(
    !canManage ||
      !csrfToken ||
      !robinhoodConfigured ||
      robinhoodStartMutation.isPending ||
      robinhoodSyncMutation.isPending,
  );
  const robinhoodSyncDisabled = Boolean(
    !canManage ||
      !csrfToken ||
      !robinhoodConfigured ||
      !robinhoodConnected ||
      robinhoodStartMutation.isPending ||
      robinhoodSyncMutation.isPending,
  );

  const schwabReadiness = schwabReadinessQuery.data;
  const schwabUser = schwabReadiness?.user || null;
  const schwabConfigured = schwabReadiness?.configured === true;
  const schwabUserStatus = schwabUser?.status || "not_connected";
  const schwabConnected = schwabUser?.connected === true;
  const schwabReconnectRequired = isSchwabReauthRequired(schwabReadiness);
  const schwabLimitations = Array.isArray(schwabReadiness?.limitations)
    ? schwabReadiness.limitations
    : [];
  const schwabSyncedAccounts = schwabLastSync?.accounts || [];
  const schwabOutcomeBanner = formatSchwabConnectOutcome(schwabOutcome);
  const schwabConnectDisabled = Boolean(
    !canManage ||
      !csrfToken ||
      !schwabConfigured ||
      schwabStartMutation.isPending ||
      schwabSyncMutation.isPending,
  );
  const schwabSyncDisabled = Boolean(
    !canManage ||
      !csrfToken ||
      !schwabConfigured ||
      !schwabConnected ||
      schwabStartMutation.isPending ||
      schwabSyncMutation.isPending,
  );

  const ibkrPortalReadiness = ibkrPortalReadinessQuery.data;
  const ibkrPortalStatus = ibkrPortalReadiness?.status || "disconnected";
  const ibkrPortalUnavailable = ibkrPortalStatus === "unavailable";
  const ibkrPortalConnected = ibkrPortalStatus === "connected";
  const ibkrPortalPending =
    ibkrPortalStatus === "gateway_starting" ||
    ibkrPortalStatus === "needs_login";
  const ibkrPortalAttemptActive = Boolean(ibkrConnecting || ibkrLoginUrl);
  const ibkrConnectDisabled = Boolean(
    !canManage ||
      !csrfToken ||
      ibkrPortalUnavailable ||
      ibkrConnecting ||
      ibkrPortalConnectMutation.isPending ||
      ibkrDisconnecting,
  );
  const ibkrDisconnectDisabled = Boolean(
    !canManage || !csrfToken || ibkrConnecting || ibkrDisconnecting,
  );

  // ── Shared card lifecycle: map every connector onto one phase machine ──
  const snapTradeConnectPending =
    registerMutation.isPending || portalMutation.isPending;
  const cardPhases = useMemo(() => {
    const phases = new Map();
    for (const choice of allChoices) {
      const key = choice.value;
      if (key === ROBINHOOD_BROKER_CHOICE.value) {
        phases.set(
          key,
          deriveBrokerCardPhase({
            connected: robinhoodConnected,
            working:
              robinhoodStartMutation.isPending ||
              robinhoodSyncMutation.isPending,
            awaitingUser: popupBrokerKey === key,
          }),
        );
      } else if (key === SCHWAB_BROKER_CHOICE.value) {
        phases.set(
          key,
          deriveBrokerCardPhase({
            connected: schwabConnected && !schwabReconnectRequired,
            working:
              schwabStartMutation.isPending || schwabSyncMutation.isPending,
            awaitingUser: popupBrokerKey === key,
            impaired: schwabReconnectRequired,
          }),
        );
      } else if (key === IBKR_PORTAL_BROKER_CHOICE.value) {
        phases.set(
          key,
          deriveBrokerCardPhase({
            connected: ibkrPortalConnected,
            working:
              ibkrPortalStatus === "gateway_starting" || ibkrDisconnecting,
            awaitingUser:
              popupBrokerKey === key || ibkrPortalStatus === "needs_login",
            impaired: ibkrPortalUnavailable,
          }),
        );
      } else {
        const slugConnected = connectedBrokerSlugs.has(key.toUpperCase());
        phases.set(
          key,
          deriveBrokerCardPhase({
            connected: slugConnected,
            working:
              (activeConnectKey === key && snapTradeConnectPending) ||
              (slugConnected && syncMutation.isPending),
            awaitingUser: popupBrokerKey === key,
          }),
        );
      }
    }
    return phases;
  }, [
    allChoices,
    robinhoodConnected,
    robinhoodStartMutation.isPending,
    robinhoodSyncMutation.isPending,
    schwabConnected,
    schwabStartMutation.isPending,
    schwabSyncMutation.isPending,
    schwabReconnectRequired,
    ibkrPortalConnected,
    ibkrPortalStatus,
    ibkrDisconnecting,
    ibkrPortalUnavailable,
    connectedBrokerSlugs,
    activeConnectKey,
    snapTradeConnectPending,
    syncMutation.isPending,
    popupBrokerKey,
  ]);

  // Per-card "connect attempt failed" flag, feeding the transient error shake.
  // IBKR Client Portal is intentionally excluded — its error surface is owned by
  // the parallel host-root rework, so it never sets the map (never shakes here).
  const cardErrors = useMemo(() => {
    const errors = new Map();
    for (const choice of allChoices) {
      const key = choice.value;
      if (key === ROBINHOOD_BROKER_CHOICE.value) {
        errors.set(key, Boolean(robinhoodStartMutation.error));
      } else if (key === SCHWAB_BROKER_CHOICE.value) {
        errors.set(key, Boolean(schwabStartMutation.error));
      } else if (key === IBKR_PORTAL_BROKER_CHOICE.value) {
        errors.set(key, false);
      } else {
        errors.set(
          key,
          Boolean(
            activeConnectKey === key &&
              (registerMutation.error || portalMutation.error),
          ),
        );
      }
    }
    return errors;
  }, [
    allChoices,
    robinhoodStartMutation.error,
    schwabStartMutation.error,
    activeConnectKey,
    registerMutation.error,
    portalMutation.error,
  ]);

  // Transient success acknowledgement: when a card transitions into
  // connected, it owns the success sequence (ring sweep → glow → check pop)
  // for BROKER_SUCCESS_FLASH_MS before settling on the steady green ring.
  const [successKeys, setSuccessKeys] = useState(() => new Set());
  const prevPhasesRef = useRef(new Map());
  const successTimersRef = useRef([]);
  useEffect(() => {
    const flashed = successFlashKeys(prevPhasesRef.current, cardPhases);
    prevPhasesRef.current = cardPhases;
    if (!flashed.length) return;
    setSuccessKeys((current) => new Set([...current, ...flashed]));
    const timer = window.setTimeout(() => {
      successTimersRef.current = successTimersRef.current.filter(
        (pending) => pending !== timer,
      );
      setSuccessKeys((current) => {
        const next = new Set(current);
        for (const key of flashed) next.delete(key);
        return next;
      });
    }, BROKER_SUCCESS_FLASH_MS);
    successTimersRef.current.push(timer);
  }, [cardPhases]);
  useEffect(
    () => () => {
      for (const timer of successTimersRef.current) {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  // Transient error acknowledgement: when a card's connect attempt newly fails,
  // it owns the amber shake for BROKER_ERROR_FLASH_MS before settling back to
  // its steady phase (the persistent failure text stays in the error banner).
  const [errorKeys, setErrorKeys] = useState(() => new Set());
  const prevErrorsRef = useRef(new Map());
  const errorTimersRef = useRef([]);
  useEffect(() => {
    const flashed = errorFlashKeys(prevErrorsRef.current, cardErrors);
    prevErrorsRef.current = cardErrors;
    if (!flashed.length) return;
    setErrorKeys((current) => new Set([...current, ...flashed]));
    const timer = window.setTimeout(() => {
      errorTimersRef.current = errorTimersRef.current.filter(
        (pending) => pending !== timer,
      );
      setErrorKeys((current) => {
        const next = new Set(current);
        for (const key of flashed) next.delete(key);
        return next;
      });
    }, BROKER_ERROR_FLASH_MS);
    errorTimersRef.current.push(timer);
  }, [cardErrors]);
  useEffect(
    () => () => {
      for (const timer of errorTimersRef.current) {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  // Robinhood OAuth callback returns to /?screen=settings&robinhood=<outcome>.
  // Surface the result, focus the Robinhood tile, refresh server truth, then
  // strip the flag so a reload does not replay the banner.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("robinhood");
    if (!outcome) return;
    setRobinhoodOutcome(outcome);
    setSelectedBroker(ROBINHOOD_BROKER_CHOICE.value);
    void queryClient.invalidateQueries({
      queryKey: getGetRobinhoodReadinessQueryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: getListBrokerConnectionsQueryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: getListAccountsQueryKey(),
    });
    params.delete("robinhood");
    const nextSearch = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`,
    );
  }, [queryClient]);

  // Schwab OAuth callback returns to /?screen=settings&schwab=<outcome>.
  // Same treatment as the Robinhood flag above.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("schwab");
    if (!outcome) return;
    setSchwabOutcome(outcome);
    setSelectedBroker(SCHWAB_BROKER_CHOICE.value);
    void queryClient.invalidateQueries({
      queryKey: getGetSchwabReadinessQueryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: getListBrokerConnectionsQueryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: getListAccountsQueryKey(),
    });
    params.delete("schwab");
    const nextSearch = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`,
    );
  }, [queryClient]);

  // Stop polling any open broker auth popup if the panel unmounts.
  useEffect(
    () => () => {
      if (oauthPollRef.current) {
        window.clearInterval(oauthPollRef.current);
      }
      if (ibkrPollRef.current) {
        window.clearTimeout(ibkrPollRef.current);
      }
      ibkrAttemptRef.current += 1;
      ibkrConnectBusyRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!connectHandoff?.expiresAt) return undefined;
    const expiresAtMs = new Date(connectHandoff.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) return undefined;
    const delayMs = expiresAtMs - Date.now();
    if (delayMs <= 0) {
      setConnectHandoff(null);
      setConnectHandoffCopyStatus("");
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setConnectHandoff(null);
      setConnectHandoffCopyStatus("");
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [connectHandoff?.expiresAt]);

  const showConnectHandoff = ({ brokerKey, label, url, expiresAt }) => {
    setConnectHandoff({ brokerKey, label, url, expiresAt });
    setConnectHandoffCopyStatus("");
  };

  const clearConnectHandoff = (brokerKey) => {
    setConnectHandoff((current) =>
      !brokerKey || current?.brokerKey === brokerKey ? null : current,
    );
    setConnectHandoffCopyStatus("");
  };

  const copyConnectHandoff = async () => {
    if (!connectHandoff?.url) return;
    try {
      await copyBrokerConnectLaunchUrl(connectHandoff.url);
      setConnectHandoffCopyStatus("copied");
    } catch {
      setConnectHandoffCopyStatus("error");
    }
  };

  const refresh = () => {
    setLocalError("");
    setPortalLaunchBlocked(false);
    void authSession.refresh();
    void readinessQuery.refetch();
    void robinhoodReadinessQuery.refetch();
    void schwabReadinessQuery.refetch();
    void ibkrPortalReadinessQuery.refetch();
    void brokeragesQuery.refetch();
    void inclusionQuery.refetch();
    if (selectedPortfolioAccountId) {
      void portfolioQuery.refetch();
    }
  };

  const launchPortal = async (targetBroker = selectedBroker) => {
    if (!canManage) return;
    if (!csrfToken) {
      setLocalError("Auth session is missing a CSRF token.");
      return;
    }
    if (!credentialsReady) {
      setLocalError("SnapTrade app credentials are not configured.");
      return;
    }

    setLocalError("");
    setPortalLaunchBlocked(false);
    setActiveConnectKey(targetBroker);
    try {
      if (!userRegistered) {
        await registerMutation.mutateAsync();
      }
      const portal = await portalMutation.mutateAsync({
        data: buildSnapTradeConnectionPortalBody(targetBroker),
      });
      setLastPortal(portal);
      showConnectHandoff({
        brokerKey: targetBroker,
        label:
          allChoices.find((choice) => choice.value === targetBroker)?.label ||
          "SnapTrade",
        url: portal.redirectUri,
        expiresAt: portal.expiresAt,
      });
      // Match the Robinhood flow: open the SnapTrade Connection Portal in a
      // popup window and refresh connection state when it closes.
      const popup = openBrokerPopup(portal.redirectUri, "snaptrade-portal");
      if (!popup) {
        setPortalLaunchBlocked(true);
      } else {
        setPopupBrokerKey(targetBroker);
        watchBrokerPopup({
          popup,
          pollRef: oauthPollRef,
          onClose: () => {
            setPopupBrokerKey("");
            clearConnectHandoff(targetBroker);
            void readinessQuery.refetch();
            void queryClient.invalidateQueries({
              queryKey: getListBrokerConnectionsQueryKey(),
            });
            void queryClient.invalidateQueries({
              queryKey: getListAccountsQueryKey(),
            });
          },
        });
      }
      void readinessQuery.refetch();
    } catch (error) {
      setLocalError(
        readErrorMessage(
          error,
          "SnapTrade Connection Portal could not be opened.",
        ),
      );
    } finally {
      setActiveConnectKey("");
    }
  };

  const syncAccounts = async () => {
    if (!canManage) return;
    if (!csrfToken) {
      setLocalError("Auth session is missing a CSRF token.");
      return;
    }
    if (!credentialsReady) {
      setLocalError("SnapTrade app credentials are not configured.");
      return;
    }

    setLocalError("");
    setPortalLaunchBlocked(false);
    try {
      await syncMutation.mutateAsync();
      void readinessQuery.refetch();
    } catch (error) {
      setLocalError(
        readErrorMessage(error, "SnapTrade accounts could not be synced."),
      );
    }
  };

  const connectRobinhood = async () => {
    if (!canManage) return;
    if (!csrfToken) {
      setLocalError("Auth session is missing a CSRF token.");
      return;
    }
    if (!robinhoodConfigured) {
      setLocalError("Robinhood OAuth prerequisites are not configured.");
      return;
    }
    setLocalError("");
    setPortalLaunchBlocked(false);
    setRobinhoodOutcome("");
    let start;
    try {
      start = await robinhoodStartMutation.mutateAsync();
    } catch (error) {
      setLocalError(
        readErrorMessage(error, "Robinhood connection could not be started."),
      );
      return;
    }
    if (!start?.authorizationUrl) {
      setLocalError("Robinhood authorization URL was not returned.");
      return;
    }
    showConnectHandoff({
      brokerKey: ROBINHOOD_BROKER_CHOICE.value,
      label: ROBINHOOD_BROKER_CHOICE.label,
      url: start.authorizationUrl,
      expiresAt: start.expiresAt,
    });
    // Robinhood's OAuth page cannot be iframed (X-Frame-Options: SAMEORIGIN), so
    // authorize in a popup window. The server callback 302s back to our origin
    // with ?robinhood=<outcome>, which we read once the popup returns same-origin.
    const popup = openBrokerPopup(start.authorizationUrl, "robinhood-oauth");
    if (!popup) {
      return;
    }
    setPopupBrokerKey(ROBINHOOD_BROKER_CHOICE.value);
    watchBrokerPopup({
      popup,
      pollRef: oauthPollRef,
      originParamKey: "robinhood",
      onResult: (outcome) => {
        setPopupBrokerKey("");
        clearConnectHandoff(ROBINHOOD_BROKER_CHOICE.value);
        setRobinhoodOutcome(outcome);
        void robinhoodReadinessQuery.refetch();
        void queryClient.invalidateQueries({
          queryKey: getListBrokerConnectionsQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getListAccountsQueryKey(),
        });
      },
      onClose: () => {
        setPopupBrokerKey("");
        clearConnectHandoff(ROBINHOOD_BROKER_CHOICE.value);
        void robinhoodReadinessQuery.refetch();
      },
    });
  };

  const syncRobinhood = async () => {
    if (!canManage) return;
    if (!csrfToken) {
      setLocalError("Auth session is missing a CSRF token.");
      return;
    }
    setLocalError("");
    try {
      await robinhoodSyncMutation.mutateAsync();
      void robinhoodReadinessQuery.refetch();
    } catch (error) {
      setLocalError(
        readErrorMessage(error, "Robinhood accounts could not be synced."),
      );
    }
  };

  const connectSchwab = async () => {
    if (!canManage) return;
    if (!csrfToken) {
      setLocalError("Auth session is missing a CSRF token.");
      return;
    }
    if (!schwabConfigured) {
      setLocalError("Schwab OAuth prerequisites are not configured.");
      return;
    }
    setLocalError("");
    setPortalLaunchBlocked(false);
    setSchwabOutcome("");
    let start;
    try {
      start = await schwabStartMutation.mutateAsync();
    } catch (error) {
      setLocalError(
        readErrorMessage(error, "Schwab connection could not be started."),
      );
      return;
    }
    if (!start?.authorizationUrl) {
      setLocalError("Schwab authorization URL was not returned.");
      return;
    }
    showConnectHandoff({
      brokerKey: SCHWAB_BROKER_CHOICE.value,
      label: SCHWAB_BROKER_CHOICE.label,
      url: start.authorizationUrl,
      expiresAt: start.expiresAt,
    });
    // Schwab's login page cannot be iframed either, so authorize in a popup
    // window. The server callback 302s back to our origin with
    // ?schwab=<outcome>, which we read once the popup returns same-origin.
    const popup = openBrokerPopup(start.authorizationUrl, "schwab-oauth");
    if (!popup) {
      return;
    }
    setPopupBrokerKey(SCHWAB_BROKER_CHOICE.value);
    watchBrokerPopup({
      popup,
      pollRef: oauthPollRef,
      originParamKey: "schwab",
      onResult: (outcome) => {
        setPopupBrokerKey("");
        clearConnectHandoff(SCHWAB_BROKER_CHOICE.value);
        setSchwabOutcome(outcome);
        void schwabReadinessQuery.refetch();
        void queryClient.invalidateQueries({
          queryKey: getListBrokerConnectionsQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getListAccountsQueryKey(),
        });
      },
      onClose: () => {
        setPopupBrokerKey("");
        clearConnectHandoff(SCHWAB_BROKER_CHOICE.value);
        void schwabReadinessQuery.refetch();
      },
    });
  };

  const syncSchwab = async () => {
    if (!canManage) return;
    if (!csrfToken) {
      setLocalError("Auth session is missing a CSRF token.");
      return;
    }
    setLocalError("");
    try {
      await schwabSyncMutation.mutateAsync();
      void schwabReadinessQuery.refetch();
    } catch (error) {
      setLocalError(
        readErrorMessage(error, "Schwab accounts could not be synced."),
      );
    }
  };

  const stopIbkrPortalPoll = () => {
    if (ibkrPollRef.current) {
      window.clearTimeout(ibkrPollRef.current);
      ibkrPollRef.current = null;
    }
    ibkrConnectBusyRef.current = false;
    setIbkrConnecting(false);
    setPopupBrokerKey((current) =>
      current === IBKR_PORTAL_BROKER_CHOICE.value ? "" : current,
    );
  };

  const closeIbkrPortalDialog = () => {
    setIbkrDialogOpen(false);
  };

  // IBKR Client Portal login happens in the capsule-local browser (not an
  // OAuth redirect back to our origin), so we cannot rely on a callback flag
  // like Robinhood/Schwab. Poll GET status every ~3s while the in-app login is
  // open until the server verifies the authenticated session.
  const connectIbkrPortal = async () => {
    if (!canManage) return;
    if (ibkrConnectBusyRef.current || ibkrPortalConnectMutation.isPending) {
      return;
    }
    if (!csrfToken) {
      setLocalError("Auth session is missing a CSRF token.");
      return;
    }
    if (ibkrPortalUnavailable) {
      setLocalError("IBKR Client Portal runtime is not installed.");
      return;
    }
    const attempt = ++ibkrAttemptRef.current;
    ibkrConnectBusyRef.current = true;
    setIbkrLoginUrl("");
    setIbkrPortalPollReadiness(null);
    setIbkrDialogOpen(true);
    setIbkrConnecting(true);
    setPopupBrokerKey(IBKR_PORTAL_BROKER_CHOICE.value);
    if (ibkrPollRef.current) {
      window.clearTimeout(ibkrPollRef.current);
      ibkrPollRef.current = null;
    }
    setLocalError("");
    let started;
    try {
      started = await ibkrPortalConnectMutation.mutateAsync();
    } catch (error) {
      if (attempt !== ibkrAttemptRef.current) return;
      stopIbkrPortalPoll();
      setIbkrDialogOpen(false);
      setLocalError(
        readErrorMessage(
          error,
          "IBKR Client Portal connection could not be started.",
        ),
      );
      return;
    }
    if (attempt !== ibkrAttemptRef.current) return;
    const loginPath = started?.loginPath;
    if (!loginPath) {
      stopIbkrPortalPoll();
      setIbkrDialogOpen(false);
      setLocalError("IBKR Client Portal login URL was not returned.");
      return;
    }
    let loginUrl;
    try {
      loginUrl = new URL(loginPath, window.location.origin).href;
    } catch {
      stopIbkrPortalPoll();
      setIbkrDialogOpen(false);
      setLocalError("IBKR Client Portal login URL was invalid.");
      return;
    }
    if (new URL(loginUrl).origin !== window.location.origin) {
      stopIbkrPortalPoll();
      setIbkrDialogOpen(false);
      setLocalError("The secure IBKR login viewer is not available.");
      return;
    }
    setIbkrLoginUrl(loginUrl);
    const startedAt = Date.now();
    const poll = async () => {
      if (attempt !== ibkrAttemptRef.current) return;
      if (hasIbkrPortalLoginTimedOut(startedAt, Date.now())) {
        void disconnectIbkrPortal("IBKR Client Portal login timed out.");
        return;
      }
      let status;
      try {
        status = await getIbkrPortalStatus();
      } catch {
        if (attempt === ibkrAttemptRef.current) {
          ibkrPollRef.current = window.setTimeout(poll, 3000);
        }
        return;
      }
      if (attempt !== ibkrAttemptRef.current) return;
      setIbkrPortalPollReadiness(status);
      if (status?.status === "connected" && status?.authenticated === true) {
        ++ibkrAttemptRef.current;
        setIbkrLoginUrl("");
        stopIbkrPortalPoll();
        clearConnectHandoff(IBKR_PORTAL_BROKER_CHOICE.value);
        void ibkrPortalReadinessQuery.refetch();
        void queryClient.invalidateQueries({
          queryKey: getListBrokerConnectionsQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getListAccountsQueryKey(),
        });
      } else if (isTerminalIbkrPortalConnectStatus(status)) {
        ++ibkrAttemptRef.current;
        setIbkrLoginUrl("");
        stopIbkrPortalPoll();
        clearConnectHandoff(IBKR_PORTAL_BROKER_CHOICE.value);
        setLocalError(
          status?.message || "IBKR Client Portal connection was closed.",
        );
        void ibkrPortalReadinessQuery.refetch();
      } else {
        ibkrPollRef.current = window.setTimeout(poll, 3000);
      }
    };
    ibkrPollRef.current = window.setTimeout(poll, 3000);
  };

  const disconnectIbkrPortal = async (finalMessage = "") => {
    if (!canManage) return;
    if (!csrfToken) {
      setLocalError("Auth session is missing a CSRF token.");
      return;
    }
    ++ibkrAttemptRef.current;
    setIbkrLoginUrl("");
    setIbkrPortalPollReadiness(null);
    setIbkrDialogOpen(false);
    stopIbkrPortalPoll();
    clearConnectHandoff(IBKR_PORTAL_BROKER_CHOICE.value);
    setLocalError(finalMessage);
    setIbkrDisconnecting(true);
    try {
      await ibkrPortalDisconnectMutation.mutateAsync();
      void ibkrPortalReadinessQuery.refetch();
      void queryClient.invalidateQueries({
        queryKey: getListBrokerConnectionsQueryKey(),
      });
      void queryClient.invalidateQueries({
        queryKey: getListAccountsQueryKey(),
      });
    } catch (error) {
      setLocalError(
        readErrorMessage(
          error,
          "IBKR Client Portal could not be disconnected.",
        ),
      );
    } finally {
      setIbkrDisconnecting(false);
    }
  };

  const loadPortfolio = async () => {
    if (!selectedPortfolioAccountId) {
      setLocalError("Sync accounts before loading a portfolio.");
      return;
    }

    setLocalError("");
    try {
      await portfolioQuery.refetch();
    } catch (error) {
      setLocalError(
        readErrorMessage(error, "SnapTrade portfolio could not be loaded."),
      );
    }
  };

  const authError = authSession.isError ? "Auth session unavailable." : "";
  const readinessError = readinessQuery.error
    ? readErrorMessage(readinessQuery.error, "SnapTrade readiness unavailable.")
    : robinhoodReadinessQuery.error
      ? readErrorMessage(
          robinhoodReadinessQuery.error,
          "Robinhood readiness unavailable.",
        )
      : schwabReadinessQuery.error
        ? readErrorMessage(
            schwabReadinessQuery.error,
            "Schwab readiness unavailable.",
          )
        : ibkrPortalReadinessQuery.error
          ? readErrorMessage(
              ibkrPortalReadinessQuery.error,
              "IBKR Client Portal readiness unavailable.",
            )
          : "";
  const mutationError =
    readErrorMessage(registerMutation.error, "") ||
    readErrorMessage(portalMutation.error, "") ||
    readErrorMessage(syncMutation.error, "") ||
    readErrorMessage(inclusionMutation.error, "") ||
    readErrorMessage(portfolioQuery.error, "") ||
    readErrorMessage(robinhoodStartMutation.error, "") ||
    readErrorMessage(robinhoodSyncMutation.error, "") ||
    readErrorMessage(schwabStartMutation.error, "") ||
    readErrorMessage(schwabSyncMutation.error, "");
  const visibleError =
    localError || mutationError || authError || readinessError;

  // Contextual footer actions per card, keyed to the card's own lifecycle —
  // the card is the single action surface for its broker.
  const actionIconSize = 11;
  const cardActionsFor = (choice) => {
    const key = choice.value;
    if (key === ROBINHOOD_BROKER_CHOICE.value) {
      const actions = [
        {
          label: robinhoodConnected ? "Reconnect" : "Connect",
          variant: robinhoodConnected ? "secondary" : "primary",
          icon: robinhoodConnected ? (
            <ExternalLink
              size={actionIconSize}
              strokeWidth={2}
              aria-hidden="true"
            />
          ) : (
            <PlugZap size={actionIconSize} strokeWidth={2} aria-hidden="true" />
          ),
          onClick: () => {
            setSelectedBroker(key);
            void connectRobinhood();
          },
          disabled: robinhoodConnectDisabled,
          loading: robinhoodStartMutation.isPending,
        },
      ];
      if (robinhoodConnected) {
        actions.push({
          label: "Sync now",
          icon: (
            <DatabaseZap
              size={actionIconSize}
              strokeWidth={2}
              aria-hidden="true"
            />
          ),
          onClick: () => {
            setSelectedBroker(key);
            void syncRobinhood();
          },
          disabled: robinhoodSyncDisabled,
          loading: robinhoodSyncMutation.isPending,
        });
      }
      return actions;
    }
    if (key === SCHWAB_BROKER_CHOICE.value) {
      const schwabReconnect = schwabConnected || schwabReconnectRequired;
      const actions = [
        {
          label: schwabConnectActionLabel({
            connected: schwabConnected,
            reauthRequired: schwabReconnectRequired,
          }),
          variant:
            schwabReconnectRequired || !schwabConnected
              ? "primary"
              : "secondary",
          icon: schwabReconnect ? (
            <ExternalLink
              size={actionIconSize}
              strokeWidth={2}
              aria-hidden="true"
            />
          ) : (
            <PlugZap size={actionIconSize} strokeWidth={2} aria-hidden="true" />
          ),
          onClick: () => {
            setSelectedBroker(key);
            void connectSchwab();
          },
          disabled: schwabConnectDisabled,
          loading: schwabStartMutation.isPending,
        },
      ];
      if (schwabConnected) {
        actions.push({
          label: "Sync now",
          icon: (
            <DatabaseZap
              size={actionIconSize}
              strokeWidth={2}
              aria-hidden="true"
            />
          ),
          onClick: () => {
            setSelectedBroker(key);
            void syncSchwab();
          },
          disabled: schwabSyncDisabled,
          loading: schwabSyncMutation.isPending,
        });
      }
      return actions;
    }
    if (key === IBKR_PORTAL_BROKER_CHOICE.value) {
      if (ibkrPortalConnected) {
        return [
          {
            label: "View status",
            icon: (
              <ShieldCheck
                size={actionIconSize}
                strokeWidth={2}
                aria-hidden="true"
              />
            ),
            onClick: () => {
              setSelectedBroker(key);
              setIbkrDialogOpen(true);
            },
            disabled: ibkrDisconnecting,
          },
          {
            label: "Disconnect",
            icon: (
              <Unplug
                size={actionIconSize}
                strokeWidth={2}
                aria-hidden="true"
              />
            ),
            onClick: () => {
              setSelectedBroker(key);
              void disconnectIbkrPortal();
            },
            disabled: ibkrDisconnectDisabled,
            loading: ibkrDisconnecting,
          },
        ];
      }
      if (ibkrPortalAttemptActive) {
        return [
          {
            label: ibkrPortalPollReadiness?.browserLoginComplete
              ? "View status"
              : "Continue Login",
            variant: "primary",
            icon: (
              <PlugZap
                size={actionIconSize}
                strokeWidth={2}
                aria-hidden="true"
              />
            ),
            onClick: () => {
              setSelectedBroker(key);
              setIbkrDialogOpen(true);
            },
            disabled: !canManage || !csrfToken || ibkrDisconnecting,
            loading: ibkrConnecting && ibkrDialogOpen,
          },
        ];
      }
      return [
        {
          label:
            ibkrPortalStatus === "needs_login" ? "Continue Login" : "Connect",
          variant: "primary",
          icon: (
            <PlugZap size={actionIconSize} strokeWidth={2} aria-hidden="true" />
          ),
          onClick: () => {
            setSelectedBroker(key);
            void connectIbkrPortal();
          },
          disabled: ibkrConnectDisabled,
          loading: ibkrConnecting,
        },
      ];
    }
    // SnapTrade-aggregated brokerage: Connect registers (if needed) and opens
    // the Connection Portal scoped to this brokerage; Sync refreshes all
    // SnapTrade-backed connections.
    const slugConnected = connectedBrokerSlugs.has(key.toUpperCase());
    const actions = [
      {
        label: slugConnected ? "Open Portal" : "Connect",
        variant: slugConnected ? "secondary" : "primary",
        icon: slugConnected ? (
          <ExternalLink
            size={actionIconSize}
            strokeWidth={2}
            aria-hidden="true"
          />
        ) : (
          <PlugZap size={actionIconSize} strokeWidth={2} aria-hidden="true" />
        ),
        onClick: () => {
          setSelectedBroker(key);
          void launchPortal(key);
        },
        disabled: connectDisabled,
        loading: activeConnectKey === key && snapTradeConnectPending,
      },
    ];
    if (slugConnected) {
      actions.push({
        label: "Sync now",
        icon: (
          <DatabaseZap
            size={actionIconSize}
            strokeWidth={2}
            aria-hidden="true"
          />
        ),
        onClick: () => {
          setSelectedBroker(key);
          void syncAccounts();
        },
        disabled: syncDisabled,
        loading: syncMutation.isPending,
      });
    }
    return actions;
  };

  const cardStatusLineFor = (choice, phase) => {
    if (choice.value === SCHWAB_BROKER_CHOICE.value) {
      return brokerCardStatusLine(phase, {
        impairedLabel: "Weekly reconnect required",
      });
    }
    if (choice.value === IBKR_PORTAL_BROKER_CHOICE.value) {
      return brokerCardStatusLine(phase, {
        impairedLabel: formatIbkrPortalStatus("unavailable"),
      });
    }
    return brokerCardStatusLine(phase);
  };

  if (enabled && !authSession.isLoading && !canManage) {
    return null;
  }

  return (
    <SurfacePanel
      title="Broker Connections"
      action={
        <Button variant="secondary" size="sm" onClick={refresh} disabled={busy}>
          <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
          Refresh
        </Button>
      }
    >
      <div style={{ display: "grid", gap: sp(12), minWidth: 0 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fit, minmax(${dim(150)}px, 1fr))`,
            gap: sp(8),
          }}
        >
          {isRobinhood ? (
            <>
              <StatusRow
                label="Prerequisites"
                value={robinhoodConfigured ? "configured" : "missing"}
                tone={statusTone(
                  robinhoodConfigured,
                  robinhoodReadinessQuery.isLoading,
                )}
              />
              <StatusRow
                label="OAuth upstream"
                value={
                  robinhoodOauthReachable
                    ? "reachable"
                    : robinhoodReadiness?.status === "upstream_error"
                      ? "unreachable"
                      : robinhoodReadinessQuery.isLoading
                        ? "checking"
                        : MISSING_VALUE
                }
                tone={statusTone(
                  robinhoodOauthReachable,
                  robinhoodReadinessQuery.isLoading,
                )}
              />
              <StatusRow
                label="Connection"
                value={
                  ROBINHOOD_USER_STATUS_LABELS[robinhoodUserStatus] ||
                  robinhoodUserStatus
                }
                tone={statusTone(
                  robinhoodConnected,
                  robinhoodUserStatus === "pending",
                )}
              />
              <StatusRow
                label="Accounts"
                value={
                  robinhoodLastSync
                    ? `${robinhoodLastSync.totals.storedAccounts} accounts`
                    : robinhoodSyncMutation.isPending
                      ? "syncing"
                      : robinhoodConnected
                        ? "not synced"
                        : MISSING_VALUE
                }
                tone={statusTone(
                  Boolean(robinhoodLastSync),
                  robinhoodSyncMutation.isPending,
                )}
              />
            </>
          ) : isSchwab ? (
            <>
              <StatusRow
                label="Prerequisites"
                value={schwabConfigured ? "configured" : "missing"}
                tone={statusTone(
                  schwabConfigured,
                  schwabReadinessQuery.isLoading,
                )}
              />
              <StatusRow
                label="Connection"
                value={
                  SCHWAB_USER_STATUS_LABELS[schwabUserStatus] ||
                  schwabUserStatus
                }
                tone={statusTone(
                  schwabConnected,
                  schwabUserStatus === "pending",
                )}
              />
              <StatusRow
                label="Re-auth window"
                value={
                  schwabReconnectRequired
                    ? "expired"
                    : schwabUser?.refreshTokenExpiresAt
                      ? `until ${formatPortfolioDateTime(schwabUser.refreshTokenExpiresAt)}`
                      : MISSING_VALUE
                }
                tone={statusTone(
                  Boolean(
                    schwabUser?.refreshTokenExpiresAt &&
                      !schwabReconnectRequired,
                  ),
                  schwabReadinessQuery.isLoading,
                )}
              />
              <StatusRow
                label="Accounts"
                value={
                  schwabLastSync
                    ? `${schwabLastSync.totals.storedAccounts} accounts`
                    : schwabSyncMutation.isPending
                      ? "syncing"
                      : schwabConnected
                        ? "not synced"
                        : MISSING_VALUE
                }
                tone={statusTone(
                  Boolean(schwabLastSync),
                  schwabSyncMutation.isPending,
                )}
              />
            </>
          ) : isIbkrPortal ? (
            <>
              <StatusRow
                label="Gateway"
                value={
                  ibkrPortalReadiness?.gatewayRunning
                    ? "running"
                    : ibkrPortalUnavailable
                      ? "not installed"
                      : ibkrPortalReadinessQuery.isLoading
                        ? "checking"
                        : "stopped"
                }
                tone={statusTone(
                  Boolean(ibkrPortalReadiness?.gatewayRunning),
                  ibkrPortalStatus === "gateway_starting",
                )}
              />
              <StatusRow
                label="Connection"
                value={formatIbkrPortalStatus(ibkrPortalStatus)}
                tone={statusTone(ibkrPortalConnected, ibkrPortalPending)}
              />
              <StatusRow
                label="Account"
                value={ibkrPortalReadiness?.selectedAccountId || MISSING_VALUE}
                tone={CSS_COLOR.textSec}
              />
              <StatusRow
                label="Accounts"
                value={
                  Array.isArray(ibkrPortalReadiness?.accounts) &&
                  ibkrPortalReadiness.accounts.length
                    ? `${ibkrPortalReadiness.accounts.length} accounts`
                    : MISSING_VALUE
                }
                tone={CSS_COLOR.textSec}
              />
            </>
          ) : (
            <>
              <StatusRow
                label="App credentials"
                value={credentialsReady ? "configured" : "missing"}
                tone={statusTone(credentialsReady, readinessQuery.isLoading)}
              />
              <StatusRow
                label="SnapTrade user"
                value={
                  userRegistered
                    ? "registered"
                    : userReadiness?.nextAction || "not registered"
                }
                tone={statusTone(userRegistered, registerMutation.isPending)}
              />
              <StatusRow
                label="Upstream"
                value={
                  readiness?.upstream?.status ||
                  (upstreamReady ? "available" : "unavailable")
                }
                tone={statusTone(upstreamReady, readinessQuery.isLoading)}
              />
              <StatusRow
                label="Local sync"
                value={
                  lastSync
                    ? `${lastSync.totals.storedAccounts} accounts`
                    : syncMutation.isPending
                      ? "syncing"
                      : "not synced"
                }
                tone={statusTone(Boolean(lastSync), syncMutation.isPending)}
              />
            </>
          )}
        </div>

        <div style={{ display: "grid", gap: sp(7) }}>
          <div
            style={{
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
            }}
          >
            Broker target
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fit, minmax(${dim(150)}px, 1fr))`,
              gap: sp(8),
            }}
          >
            {allChoices.map((choice) => {
              const phase = errorKeys.has(choice.value)
                ? "error"
                : successKeys.has(choice.value)
                  ? "success"
                  : cardPhases.get(choice.value) || "idle";
              return (
                <BrokerChoiceButton
                  key={choice.value}
                  choice={choice}
                  selected={choice.value === selectedBroker}
                  phase={phase}
                  statusLine={cardStatusLineFor(choice, phase)}
                  actions={cardActionsFor(choice)}
                  onSelect={setSelectedBroker}
                  focusRef={
                    choice.value === IBKR_PORTAL_BROKER_CHOICE.value
                      ? ibkrReturnFocusRef
                      : undefined
                  }
                />
              );
            })}
          </div>
          {brokeragesQuery.isError ? (
            <div
              style={{
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: textSize("body"),
              }}
            >
              Live broker list unavailable — showing defaults.
            </div>
          ) : null}
          {brokeragesQuery.isLoading && !brokeragesQuery.data ? (
            <div
              style={{
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: textSize("body"),
              }}
            >
              Loading brokers…
            </div>
          ) : null}
        </div>

        {inclusionAccounts.length || inclusionQuery.isFetching ? (
          <div
            style={{
              border: `1px solid ${cssColorMix(CSS_COLOR.border, 55)}`,
              borderRadius: dim(RADII.sm),
              background: CSS_COLOR.bg1,
              padding: sp(10),
              display: "grid",
              gap: sp(8),
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(8),
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  color: CSS_COLOR.textSec,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.medium,
                }}
              >
                Trading accounts
              </div>
              <span
                style={{
                  color: CSS_COLOR.textDim,
                  fontFamily: T.sans,
                  fontSize: fs(10),
                }}
              >
                {
                  inclusionAccounts.filter(
                    (account) => account.includedInTrading,
                  ).length
                }{" "}
                included
              </span>
            </div>
            {inclusionAccounts.map((account) => (
              <label
                key={account.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: sp(10),
                  alignItems: "center",
                  borderTop: `1px solid ${cssColorMix(CSS_COLOR.border, 35)}`,
                  paddingTop: sp(8),
                  fontFamily: T.sans,
                }}
              >
                <span style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
                  <span
                    style={{
                      color: CSS_COLOR.text,
                      fontSize: textSize("body"),
                      overflowWrap: "anywhere",
                    }}
                  >
                    {account.displayName}
                  </span>
                  <span
                    style={{
                      color: CSS_COLOR.textDim,
                      fontSize: fs(10),
                      overflowWrap: "anywhere",
                    }}
                  >
                    {formatBrokerProvider(account.provider)} / {account.mode} /{" "}
                    {formatAccountCategory(account.accountType)}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={account.includedInTrading}
                  disabled={inclusionMutation.isPending || !canManage}
                  onChange={(event) =>
                    toggleIncludedAccount(account.id, event.target.checked)
                  }
                  style={{
                    width: dim(18),
                    height: dim(18),
                    accentColor: CSS_COLOR.accent,
                  }}
                />
              </label>
            ))}
          </div>
        ) : null}

        {isRobinhood ? (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: sp(8),
              border: `1px solid ${cssColorMix(CSS_COLOR.amber, 40)}`,
              borderRadius: dim(RADII.sm),
              background: cssColorMix(CSS_COLOR.amber, 7),
              padding: sp("8px 10px"),
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.45,
            }}
          >
            <ShieldAlert
              size={15}
              strokeWidth={2}
              aria-hidden="true"
              style={{
                color: CSS_COLOR.amber,
                flexShrink: 0,
                marginTop: dim(1),
              }}
            />
            <span>
              Connect links a Robinhood Agentic account and syncs balances for
              research. Live order execution stays disabled — provider research
              is still required.
            </span>
          </div>
        ) : null}

        {isSchwab ? (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: sp(8),
              border: `1px solid ${cssColorMix(CSS_COLOR.amber, 40)}`,
              borderRadius: dim(RADII.sm),
              background: cssColorMix(CSS_COLOR.amber, 7),
              padding: sp("8px 10px"),
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.45,
            }}
          >
            <ShieldAlert
              size={15}
              strokeWidth={2}
              aria-hidden="true"
              style={{
                color: CSS_COLOR.amber,
                flexShrink: 0,
                marginTop: dim(1),
              }}
            />
            <span>
              Connect links a Schwab brokerage account via the Schwab Trader API
              and syncs balances for research. Schwab expires the grant every 7
              days, so expect a weekly Reconnect. Live order execution stays
              disabled — provider research is still required.
            </span>
          </div>
        ) : null}

        {isIbkrPortal && ibkrPortalConnected ? (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: sp(8),
              border: `1px solid ${cssColorMix(CSS_COLOR.green, 40)}`,
              borderRadius: dim(RADII.sm),
              background: cssColorMix(CSS_COLOR.green, 7),
              padding: sp("8px 10px"),
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.45,
            }}
          >
            <ShieldCheck
              size={15}
              strokeWidth={2}
              aria-hidden="true"
              style={{
                color: CSS_COLOR.green,
                flexShrink: 0,
                marginTop: dim(1),
              }}
            />
            <span>
              Connected to account{" "}
              {ibkrPortalReadiness?.selectedAccountId || MISSING_VALUE}. IBKR
              Client Portal sessions require re-login roughly every 24h.
            </span>
          </div>
        ) : isIbkrPortal && ibkrPortalReadiness?.message ? (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: sp(8),
              border: `1px solid ${cssColorMix(CSS_COLOR.amber, 40)}`,
              borderRadius: dim(RADII.sm),
              background: cssColorMix(CSS_COLOR.amber, 7),
              padding: sp("8px 10px"),
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.45,
            }}
          >
            <ShieldAlert
              size={15}
              strokeWidth={2}
              aria-hidden="true"
              style={{
                color: CSS_COLOR.amber,
                flexShrink: 0,
                marginTop: dim(1),
              }}
            />
            <span>{ibkrPortalReadiness.message}</span>
          </div>
        ) : null}

        {isSchwab && schwabLimitations.length ? (
          <ul
            style={{
              margin: 0,
              paddingLeft: dim(16),
              display: "grid",
              gap: sp(3),
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("body"),
            }}
          >
            {schwabLimitations.map((code) => (
              <li key={code}>{formatSchwabLimitation(code)}</li>
            ))}
          </ul>
        ) : null}

        {isSchwab && schwabOutcomeBanner ? (
          <div
            role="status"
            style={{
              border: `1px solid ${cssColorMix(
                schwabOutcomeBanner.tone === "green"
                  ? CSS_COLOR.green
                  : CSS_COLOR.amber,
                45,
              )}`,
              borderRadius: dim(RADII.sm),
              color:
                schwabOutcomeBanner.tone === "green"
                  ? CSS_COLOR.green
                  : CSS_COLOR.amber,
              background: cssColorMix(
                schwabOutcomeBanner.tone === "green"
                  ? CSS_COLOR.green
                  : CSS_COLOR.amber,
                8,
              ),
              padding: sp("8px 10px"),
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.4,
            }}
          >
            {schwabOutcomeBanner.message}
          </div>
        ) : null}

        {isRobinhood && robinhoodLimitations.length ? (
          <ul
            style={{
              margin: 0,
              paddingLeft: dim(16),
              display: "grid",
              gap: sp(3),
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("body"),
            }}
          >
            {robinhoodLimitations.map((code) => (
              <li key={code}>{formatRobinhoodLimitation(code)}</li>
            ))}
          </ul>
        ) : null}

        {isRobinhood && robinhoodOutcomeBanner ? (
          <div
            role="status"
            style={{
              border: `1px solid ${cssColorMix(
                robinhoodOutcomeBanner.tone === "green"
                  ? CSS_COLOR.green
                  : CSS_COLOR.amber,
                45,
              )}`,
              borderRadius: dim(RADII.sm),
              color:
                robinhoodOutcomeBanner.tone === "green"
                  ? CSS_COLOR.green
                  : CSS_COLOR.amber,
              background: cssColorMix(
                robinhoodOutcomeBanner.tone === "green"
                  ? CSS_COLOR.green
                  : CSS_COLOR.amber,
                8,
              ),
              padding: sp("8px 10px"),
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.4,
            }}
          >
            {robinhoodOutcomeBanner.message}
          </div>
        ) : null}

        {visibleError ? (
          <div
            role="alert"
            style={{
              border: `1px solid ${cssColorMix(CSS_COLOR.amber, 45)}`,
              borderRadius: dim(RADII.sm),
              color: CSS_COLOR.amber,
              background: cssColorMix(CSS_COLOR.amber, 8),
              padding: sp("8px 10px"),
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.4,
            }}
          >
            {visibleError}
          </div>
        ) : null}

        {connectHandoff?.url ? (
          <BrokerConnectHandoff
            handoff={connectHandoff}
            copyStatus={connectHandoffCopyStatus}
            onCopy={copyConnectHandoff}
          />
        ) : null}

        {!isDirectBroker && portalLaunchBlocked && lastPortal?.redirectUri ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(8),
              flexWrap: "wrap",
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
            }}
          >
            <span>Popup blocked.</span>
            <a
              href={lastPortal.redirectUri}
              target="_blank"
              rel="noreferrer"
              style={{ color: CSS_COLOR.accent }}
            >
              Open portal
            </a>
          </div>
        ) : null}

        {!isDirectBroker && lastPortal ? (
          <div
            style={{
              display: "flex",
              gap: sp(6),
              flexWrap: "wrap",
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: fs(10),
            }}
          >
            <span>Portal {lastPortal.sessionId || "session"}</span>
            <span>Expires {lastPortal.expiresAt || MISSING_VALUE}</span>
            <span>Requested {lastPortal.requestedConnectionType}</span>
          </div>
        ) : null}

        {!isDirectBroker && lastSync ? (
          <div style={{ display: "grid", gap: sp(10), minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                gap: sp(6),
                flexWrap: "wrap",
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: fs(10),
              }}
            >
              <span>{lastSync.totals.storedConnections} connections</span>
              <span>{lastSync.totals.storedAccounts} accounts</span>
              <span>
                {executionReadyConnections.length} execution-ready connections
              </span>
              <span>
                {executionReadyAccounts.length} execution-ready accounts
              </span>
              <span>Synced {formatPortfolioDateTime(lastSync.syncedAt)}</span>
            </div>

            <div
              style={{
                border: `1px solid ${cssColorMix(CSS_COLOR.border, 55)}`,
                borderRadius: dim(RADII.sm),
                background: CSS_COLOR.bg1,
                padding: sp(10),
                display: "grid",
                gap: sp(10),
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: sp(8),
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    color: CSS_COLOR.textSec,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    fontWeight: FONT_WEIGHTS.medium,
                  }}
                >
                  Portfolio preview
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: sp(8),
                    flexWrap: "wrap",
                  }}
                >
                  <select
                    aria-label="SnapTrade portfolio account"
                    value={selectedPortfolioAccountId}
                    onChange={(event) => {
                      const nextAccountId = event.target.value;
                      setSelectedPortfolioAccountId(nextAccountId);
                      writeSnapTradeExecutionAccountState({
                        accounts: syncedAccounts,
                        selectedAccountId: nextAccountId,
                        savedAt: lastSync?.syncedAt,
                      });
                    }}
                    style={{
                      height: dim(30),
                      minWidth: dim(180),
                      maxWidth: "100%",
                      border: `1px solid ${CSS_COLOR.border}`,
                      borderRadius: dim(RADII.xs),
                      background: CSS_COLOR.bg0,
                      color: CSS_COLOR.text,
                      fontFamily: T.sans,
                      fontSize: textSize("body"),
                      padding: sp("0 8px"),
                    }}
                  >
                    {syncedAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.displayName} / {formatExecutionState(account)}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    onClick={loadPortfolio}
                    disabled={portfolioDisabled}
                    loading={portfolioQuery.isFetching}
                  >
                    <WalletCards size={15} strokeWidth={2} aria-hidden="true" />
                    Load Portfolio
                  </Button>
                </div>
              </div>

              {selectedPortfolioAccount ? (
                <StatusRow
                  label="Selected execution"
                  value={formatExecutionState(selectedPortfolioAccount)}
                  tone={
                    selectedPortfolioAccount.executionReady === true
                      ? CSS_COLOR.green
                      : CSS_COLOR.amber
                  }
                />
              ) : null}

              {portfolio ? (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(auto-fit, minmax(${dim(118)}px, 1fr))`,
                      gap: sp(8),
                    }}
                  >
                    <StatusRow
                      label="Cash"
                      value={formatPortfolioMoney(
                        portfolio.totals.cash,
                        portfolioCurrency,
                      )}
                      tone={CSS_COLOR.textSec}
                    />
                    <StatusRow
                      label="Buying power"
                      value={formatPortfolioMoney(
                        portfolio.totals.buyingPower,
                        portfolioCurrency,
                      )}
                      tone={CSS_COLOR.textSec}
                    />
                    <StatusRow
                      label="Net liq"
                      value={formatPortfolioMoney(
                        portfolio.totals.netLiquidation,
                        portfolioCurrency,
                      )}
                      tone={CSS_COLOR.textSec}
                    />
                    <StatusRow
                      label="Positions"
                      value={String(portfolio.totals.positionCount)}
                      tone={CSS_COLOR.textSec}
                    />
                  </div>

                  <div
                    style={{
                      overflowX: "auto",
                      border: `1px solid ${cssColorMix(CSS_COLOR.border, 45)}`,
                      borderRadius: dim(RADII.xs),
                    }}
                  >
                    <table
                      aria-label="SnapTrade portfolio positions"
                      style={{
                        width: "100%",
                        minWidth: dim(520),
                        borderCollapse: "collapse",
                        fontFamily: T.sans,
                        fontSize: fs(10),
                      }}
                    >
                      <thead>
                        <tr style={{ color: CSS_COLOR.textDim }}>
                          {["Symbol", "Type", "Qty", "Value", "P&L"].map(
                            (column) => (
                              <th
                                key={column}
                                scope="col"
                                style={{
                                  textAlign:
                                    column === "Symbol" || column === "Type"
                                      ? "left"
                                      : "right",
                                  padding: sp("7px 8px"),
                                  borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 45)}`,
                                  fontWeight: FONT_WEIGHTS.medium,
                                }}
                              >
                                {column}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {portfolio.positions.slice(0, 6).map((position) => (
                          <tr key={position.snapTradePositionId}>
                            <td
                              style={{
                                color: CSS_COLOR.text,
                                padding: sp("7px 8px"),
                                borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 25)}`,
                                fontWeight: FONT_WEIGHTS.medium,
                              }}
                            >
                              {position.symbol}
                            </td>
                            <td
                              style={{
                                color: CSS_COLOR.textDim,
                                padding: sp("7px 8px"),
                                borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 25)}`,
                              }}
                            >
                              {position.assetClass}
                            </td>
                            <td
                              style={{
                                color: CSS_COLOR.textSec,
                                padding: sp("7px 8px"),
                                borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 25)}`,
                                textAlign: "right",
                              }}
                            >
                              {formatPortfolioNumber(position.quantity)}
                            </td>
                            <td
                              style={{
                                color: CSS_COLOR.textSec,
                                padding: sp("7px 8px"),
                                borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 25)}`,
                                textAlign: "right",
                              }}
                            >
                              {formatPortfolioMoney(
                                position.marketValue,
                                position.currency || portfolioCurrency,
                              )}
                            </td>
                            <td
                              style={{
                                color:
                                  position.unrealizedPnl > 0
                                    ? CSS_COLOR.green
                                    : position.unrealizedPnl < 0
                                      ? CSS_COLOR.red
                                      : CSS_COLOR.textDim,
                                padding: sp("7px 8px"),
                                borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 25)}`,
                                textAlign: "right",
                              }}
                            >
                              {formatPortfolioMoney(
                                position.unrealizedPnl,
                                position.currency || portfolioCurrency,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div
                    style={{
                      color: CSS_COLOR.textDim,
                      fontFamily: T.sans,
                      fontSize: fs(10),
                    }}
                  >
                    Freshness{" "}
                    {formatPortfolioDateTime(portfolio.dataFreshness.asOf)}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    color: CSS_COLOR.textDim,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                  }}
                >
                  Load a synced account to inspect mocked balances and
                  positions.
                </div>
              )}
            </div>
          </div>
        ) : null}

        {isRobinhood && robinhoodLastSync ? (
          <div style={{ display: "grid", gap: sp(8), minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                gap: sp(6),
                flexWrap: "wrap",
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: fs(10),
              }}
            >
              <span>
                {robinhoodLastSync.totals.storedConnections} connections
              </span>
              <span>{robinhoodLastSync.totals.storedAccounts} accounts</span>
              <span>
                Synced {formatPortfolioDateTime(robinhoodLastSync.syncedAt)}
              </span>
            </div>
            {robinhoodSyncedAccounts.length ? (
              <div
                style={{
                  border: `1px solid ${cssColorMix(CSS_COLOR.border, 55)}`,
                  borderRadius: dim(RADII.sm),
                  background: CSS_COLOR.bg1,
                  padding: sp(10),
                  display: "grid",
                  gap: sp(4),
                  minWidth: 0,
                }}
              >
                {robinhoodSyncedAccounts.map((account) => {
                  const optionLabel = formatRobinhoodOptionLevel(
                    account.optionLevel,
                  );
                  return (
                    <div
                      key={account.id}
                      style={{ display: "grid", gap: sp(2), minWidth: 0 }}
                    >
                      <StatusRow label={account.displayName} value="" />
                      <StatusRow
                        label="Options"
                        value={
                          optionLabel ?? (
                            <a
                              href={ROBINHOOD_UPGRADE_OPTIONS_URL}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: CSS_COLOR.amber,
                                textDecoration: "underline",
                              }}
                            >
                              not approved — upgrade
                            </a>
                          )
                        }
                        tone={optionLabel ? CSS_COLOR.green : CSS_COLOR.amber}
                      />
                      <StatusRow
                        label="Agentic"
                        value={
                          account.agentic === true
                            ? "enabled"
                            : account.agentic === false
                              ? "disabled"
                              : "unverified"
                        }
                        tone={
                          account.agentic === true
                            ? CSS_COLOR.green
                            : CSS_COLOR.amber
                        }
                      />
                      <StatusRow
                        label="Execution"
                        value={
                          account.executionReady
                            ? "ready"
                            : formatRobinhoodAccountBlockers(
                                account.executionBlockers,
                              )
                        }
                        tone={
                          account.executionReady
                            ? CSS_COLOR.green
                            : CSS_COLOR.amber
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {isSchwab && schwabLastSync ? (
          <div style={{ display: "grid", gap: sp(8), minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                gap: sp(6),
                flexWrap: "wrap",
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: fs(10),
              }}
            >
              <span>{schwabLastSync.totals.storedConnections} connections</span>
              <span>{schwabLastSync.totals.storedAccounts} accounts</span>
              <span>
                Synced {formatPortfolioDateTime(schwabLastSync.syncedAt)}
              </span>
            </div>
            {schwabSyncedAccounts.length ? (
              <div
                style={{
                  border: `1px solid ${cssColorMix(CSS_COLOR.border, 55)}`,
                  borderRadius: dim(RADII.sm),
                  background: CSS_COLOR.bg1,
                  padding: sp(10),
                  display: "grid",
                  gap: sp(4),
                  minWidth: 0,
                }}
              >
                {schwabSyncedAccounts.map((account) => (
                  <StatusRow
                    key={account.id}
                    label={account.displayName}
                    value={
                      account.executionReady
                        ? "execution ready"
                        : "research required"
                    }
                    tone={
                      account.executionReady ? CSS_COLOR.green : CSS_COLOR.amber
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <IbkrPortalLoginDialog
        open={ibkrDialogOpen}
        url={ibkrLoginUrl}
        connecting={ibkrConnecting}
        readiness={ibkrPortalPollReadiness || ibkrPortalReadiness}
        onClose={closeIbkrPortalDialog}
        returnFocusRef={ibkrReturnFocusRef}
      />
    </SurfacePanel>
  );
}

export default SnapTradeConnectPanel;
