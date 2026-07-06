import {
  memo,
  useEffect,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { Ban, Bell, Bot, Info, LogIn, LogOut, SkipForward, Sparkles, X } from "lucide-react";
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
import { AppTooltip } from "../../components/ui/tooltip";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";
import { formatEnumLabel } from "../../lib/formatters";
import {
  markNotificationsRead,
  useNotificationSnapshot,
} from "./notificationStore.js";
import { normalizeToastKind } from "./toastModel.js";

const KIND_ICONS = {
  info: Info,
  success: Sparkles,
  warn: Bell,
  error: Bell,
  algo: Bot,
};

const KIND_TONES = {
  info: CSS_COLOR.textSec,
  success: CSS_COLOR.green,
  warn: CSS_COLOR.amber,
  error: CSS_COLOR.red,
  algo: CSS_COLOR.accent,
};

const formatRelative = (timestamp) => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return MISSING_VALUE;
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  if (elapsedMs < 5_000) return "now";
  if (elapsedMs < 60_000) return `${Math.round(elapsedMs / 1000)}s ago`;
  if (elapsedMs < 3_600_000) return `${Math.round(elapsedMs / 60_000)}m ago`;
  if (elapsedMs < 86_400_000) return `${Math.round(elapsedMs / 3_600_000)}h ago`;
  return `${Math.round(elapsedMs / 86_400_000)}d ago`;
};

const formatAbsolute = (timestamp) => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return null;
  }
};

const readNumber = (value) => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number) ? number : null;
};

const formatSignedUsd = (value) =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

// Algo execution events carry an `eventType` like "signal_options_shadow_exit".
// Tone, icon, and label mirror the Algo screen's transitions strip so the
// drawer reads consistently with the rest of the algo surfaces.
const algoEventTone = (eventType) => {
  const type = String(eventType || "");
  if (type.endsWith("_blocked")) return CSS_COLOR.amber;
  if (type.endsWith("_skipped")) return CSS_COLOR.textDim;
  if (type.endsWith("_entry")) return CSS_COLOR.green;
  if (type.endsWith("_exit")) return CSS_COLOR.cyan;
  return CSS_COLOR.accent;
};

const algoEventIcon = (eventType) => {
  const type = String(eventType || "");
  if (type.endsWith("_blocked")) return Ban;
  if (type.endsWith("_skipped")) return SkipForward;
  if (type.endsWith("_entry")) return LogIn;
  if (type.endsWith("_exit")) return LogOut;
  return Bot;
};

// Drop the verbose "signal_options_" prefix so titles stay short in the drawer.
const algoEventLabel = (eventType) => {
  const stripped = String(eventType || "").replace(/^signal_options_/, "");
  return formatEnumLabel(stripped || eventType || "event");
};

// Collapse runs of identical consecutive toasts into one row with an occurrence
// count, so a burst of the same message reads as "Saved ×4" instead of four rows.
const groupToasts = (list) => {
  const groups = [];
  for (const toast of list) {
    const kind = normalizeToastKind(toast.kind);
    const title = toast.title || "";
    const body = toast.body || "";
    const last = groups[groups.length - 1];
    if (last && last.kind === kind && last.title === title && last.body === body) {
      last.count += 1;
      continue;
    }
    groups.push({ key: toast.id, kind, title, body, timestamp: toast.timestamp, count: 1 });
  }
  return groups;
};

const SectionHeader = ({ title, count }) => (
  <div
    style={{
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      padding: sp("8px 12px 4px"),
      borderTop: `1px solid ${CSS_COLOR.borderLight}`,
      background: CSS_COLOR.bg0,
    }}
  >
    <span
      style={{
        fontSize: fs(9),
        fontFamily: T.sans,
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: CSS_COLOR.textMuted,
      }}
    >
      {title}
    </span>
    <span
      style={{
        fontSize: fs(9),
        fontFamily: T.sans,
        color: CSS_COLOR.textMuted,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {count}
    </span>
  </div>
);

const CountBadge = ({ count, tone }) => (
  <span
    style={{
      flexShrink: 0,
      padding: sp("0px 5px"),
      borderRadius: dim(RADII.pill),
      background: cssColorMix(tone || CSS_COLOR.textSec, 16),
      color: tone || CSS_COLOR.textSec,
      fontSize: fs(8),
      fontWeight: FONT_WEIGHTS.label,
      lineHeight: 1.6,
      fontVariantNumeric: "tabular-nums",
    }}
  >
    ×{count}
  </span>
);

const PnlChip = ({ pnl }) => (
  <span
    style={{
      display: "inline-block",
      marginTop: 2,
      padding: sp("0px 5px"),
      borderRadius: dim(RADII.xs),
      background: pnl >= 0 ? CSS_COLOR.greenBg : CSS_COLOR.redBg,
      color: pnl >= 0 ? CSS_COLOR.green : CSS_COLOR.red,
      fontSize: fs(9),
      fontWeight: FONT_WEIGHTS.medium,
      fontVariantNumeric: "tabular-nums",
    }}
  >
    {formatSignedUsd(pnl)}
  </span>
);

const NotificationRow = ({
  icon: Icon,
  tone,
  title,
  body,
  timestamp,
  count = 1,
  pnl = null,
  onAction,
  actionLabel,
  onClick,
}) => {
  const absolute = formatAbsolute(timestamp);
  const clickable = typeof onClick === "function";
  return (
    <div
      className={clickable ? "ra-notif-row ra-notif-row--clickable" : "ra-notif-row"}
      onClick={clickable ? onClick : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: `${dim(16)}px minmax(0, 1fr) auto`,
        gap: sp(3),
        alignItems: "start",
        padding: sp("8px 12px 8px 13px"),
        borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
        cursor: clickable ? "pointer" : "default",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: dim(2),
          background: tone || CSS_COLOR.textSec,
          opacity: 0.7,
        }}
      />
      <Icon size={dim(13)} strokeWidth={2.2} color={tone || CSS_COLOR.textSec} aria-hidden="true" />
      <div style={{ minWidth: 0 }}>
        {title ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(4),
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: textSize("body"),
                fontWeight: FONT_WEIGHTS.medium,
                fontFamily: T.sans,
                color: CSS_COLOR.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {title}
            </span>
            {count > 1 ? <CountBadge count={count} tone={tone} /> : null}
          </div>
        ) : null}
        {body ? (
          <div
            style={{
              fontSize: textSize("caption"),
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              marginTop: 1,
              wordBreak: "break-word",
            }}
          >
            {body}
          </div>
        ) : null}
        {Number.isFinite(pnl) ? <PnlChip pnl={pnl} /> : null}
        {absolute ? (
          <AppTooltip content={absolute}>
            <span
              style={{
                display: "inline-block",
                fontSize: fs(9),
                color: CSS_COLOR.textMuted,
                fontFamily: T.sans,
                marginTop: 2,
                fontVariantNumeric: "tabular-nums",
                cursor: "help",
              }}
            >
              {formatRelative(timestamp)}
            </span>
          </AppTooltip>
        ) : (
          <div
            style={{
              fontSize: fs(9),
              color: CSS_COLOR.textMuted,
              fontFamily: T.sans,
              marginTop: 2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatRelative(timestamp)}
          </div>
        )}
      </div>
      {onAction && actionLabel ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAction();
          }}
          style={{
            alignSelf: "center",
            padding: sp("2px 6px"),
            background: "transparent",
            border: `1px solid ${CSS_COLOR.borderLight}`,
            borderRadius: dim(RADII.xs),
            color: CSS_COLOR.accent,
            cursor: "pointer",
            fontFamily: T.sans,
            fontSize: fs(10),
            fontWeight: FONT_WEIGHTS.medium,
            whiteSpace: "nowrap",
          }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
};

const NotificationsDrawerInner = ({
  open,
  onClose,
  algoEvents,
  onAlgoEventClick,
}) => {
  const { toasts } = useNotificationSnapshot();
  const groupedToasts = useMemo(() => groupToasts(toasts), [toasts]);
  const algoList = useMemo(() => {
    if (!Array.isArray(algoEvents)) return [];
    return algoEvents.slice(0, 10);
  }, [algoEvents]);

  useEffect(() => {
    if (!open) return;
    markNotificationsRead();
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: cssColorMix(CSS_COLOR.bg0, 72),
        zIndex: 1000,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(360px, 92vw)",
          maxHeight: "100vh",
          background: CSS_COLOR.bg1,
          borderLeft: `1px solid ${CSS_COLOR.border}`,
          boxShadow: ELEVATION?.lg || "-16px 0 40px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: T.sans,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: sp("10px 12px"),
            borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: sp(5) }}>
            <Bell size={dim(15)} strokeWidth={2.2} color={CSS_COLOR.text} aria-hidden="true" />
            <span
              style={{
                fontSize: textSize("body"),
                fontWeight: FONT_WEIGHTS.medium,
                color: CSS_COLOR.text,
              }}
            >
              Notifications
            </span>
            {toasts.length + algoList.length > 0 ? (
              <span
                style={{
                  padding: sp("0px 5px"),
                  borderRadius: dim(RADII.pill),
                  background: cssColorMix(CSS_COLOR.accent, 16),
                  color: CSS_COLOR.accent,
                  fontSize: fs(8),
                  fontWeight: FONT_WEIGHTS.label,
                  lineHeight: 1.7,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {toasts.length + algoList.length}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            style={{
              padding: sp(2),
              background: "transparent",
              border: "none",
              color: CSS_COLOR.textSec,
              cursor: "pointer",
            }}
          >
            <X size={dim(14)} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <SectionHeader title="Toasts" count={groupedToasts.length} />
          {groupedToasts.length === 0 ? (
            <DataUnavailableState
              title="No recent toasts"
              detail="Toast notifications appear here as they fire."
              minHeight={64}
            />
          ) : (
            groupedToasts.map((group) => (
              <NotificationRow
                key={group.key}
                icon={KIND_ICONS[group.kind] || Info}
                tone={KIND_TONES[group.kind] || CSS_COLOR.textSec}
                title={group.title}
                body={group.body}
                timestamp={group.timestamp}
                count={group.count}
              />
            ))
          )}
          <SectionHeader title="Algo events" count={algoList.length} />
          {algoList.length === 0 ? (
            <DataUnavailableState
              title="No recent algo events"
              detail="Algo execution events appear here as they fire."
              minHeight={64}
            />
          ) : (
            algoList.map((event, index) => {
              const symbol =
                event?.symbol || event?.contract?.symbol || event?.position?.symbol || "";
              const eventType = event?.eventType || event?.action || event?.kind || "event";
              const label = algoEventLabel(eventType);
              const title = symbol ? `${symbol} · ${label}` : label;
              const eventTimestampSource =
                event?.occurredAt || event?.timestamp || event?.createdAt || null;
              const parsed = eventTimestampSource ? Date.parse(eventTimestampSource) : NaN;
              const timestamp = Number.isFinite(parsed) ? parsed : Date.now() - index * 5_000;
              const pnl = readNumber(event?.payload?.pnl ?? event?.pnl);
              const summary = event?.summary || event?.message || event?.reason || "";
              // The summary often leads with the symbol+label; suppress it as a
              // body line when it would just echo the title.
              const body = summary && summary !== title ? summary : "";
              const handleClick = onAlgoEventClick
                ? () => onAlgoEventClick(event)
                : undefined;
              return (
                <NotificationRow
                  key={event?.id || `algo-${index}-${timestamp}`}
                  icon={algoEventIcon(eventType)}
                  tone={algoEventTone(eventType)}
                  title={title}
                  body={body}
                  timestamp={timestamp}
                  pnl={pnl}
                  onClick={handleClick}
                  onAction={handleClick}
                  actionLabel={handleClick ? "Open" : undefined}
                />
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export const NotificationsDrawer = memo(NotificationsDrawerInner);
