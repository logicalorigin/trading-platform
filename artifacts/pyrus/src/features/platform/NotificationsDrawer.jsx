import {
  memo,
  useEffect,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { Bell, Info, RadioTower, Sparkles, X } from "lucide-react";
import {
  CSS_COLOR,
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
import {
  markNotificationsRead,
  useNotificationSnapshot,
} from "./notificationStore.js";

const KIND_ICONS = {
  info: Info,
  success: Sparkles,
  warning: Bell,
  error: Bell,
  algo: RadioTower,
};

const KIND_TONES = {
  info: CSS_COLOR.textSec,
  success: CSS_COLOR.green,
  warning: CSS_COLOR.amber,
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

const NotificationRow = ({ icon: Icon, tone, title, body, timestamp, onAction, actionLabel }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: `${dim(16)}px minmax(0, 1fr) auto`,
      gap: sp(3),
      alignItems: "start",
      padding: sp("8px 12px"),
      borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
    }}
  >
    <Icon size={dim(13)} strokeWidth={2.2} color={tone || CSS_COLOR.textSec} aria-hidden="true" />
    <div style={{ minWidth: 0 }}>
      {title ? (
        <div
          style={{
            fontSize: textSize("body"),
            fontWeight: FONT_WEIGHTS.medium,
            fontFamily: T.sans,
            color: CSS_COLOR.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
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
    </div>
    {onAction && actionLabel ? (
      <button
        type="button"
        onClick={onAction}
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

const NotificationsDrawerInner = ({
  open,
  onClose,
  algoEvents,
  onAlgoEventClick,
}) => {
  const { toasts } = useNotificationSnapshot();
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
        background: "rgba(0, 0, 0, 0.4)",
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
          <div style={{ display: "inline-flex", alignItems: "center", gap: sp(3) }}>
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
          <SectionHeader title="Toasts" count={toasts.length} />
          {toasts.length === 0 ? (
            <div
              style={{
                padding: sp("12px 16px"),
                fontSize: textSize("caption"),
                color: CSS_COLOR.textMuted,
              }}
            >
              No recent toasts.
            </div>
          ) : (
            toasts.map((toast) => (
              <NotificationRow
                key={toast.id}
                icon={KIND_ICONS[toast.kind] || Info}
                tone={KIND_TONES[toast.kind] || CSS_COLOR.textSec}
                title={toast.title}
                body={toast.body}
                timestamp={toast.timestamp}
              />
            ))
          )}
          <SectionHeader title="Algo events" count={algoList.length} />
          {algoList.length === 0 ? (
            <div
              style={{
                padding: sp("12px 16px"),
                fontSize: textSize("caption"),
                color: CSS_COLOR.textMuted,
              }}
            >
              No recent algo events.
            </div>
          ) : (
            algoList.map((event, index) => {
              const symbol =
                event?.symbol || event?.contract?.symbol || event?.position?.symbol || "";
              const action = event?.action || event?.kind || "event";
              const title = symbol ? `${symbol} · ${action}` : String(action);
              const eventTimestampSource =
                event?.timestamp || event?.occurredAt || event?.createdAt || null;
              const parsed = eventTimestampSource ? Date.parse(eventTimestampSource) : NaN;
              const timestamp = Number.isFinite(parsed) ? parsed : Date.now() - index * 5_000;
              const handleClick = () => {
                onAlgoEventClick?.(event);
              };
              return (
                <NotificationRow
                  key={event?.id || `algo-${index}-${timestamp}`}
                  icon={RadioTower}
                  tone={CSS_COLOR.accent}
                  title={title}
                  body={event?.message || event?.reason || ""}
                  timestamp={timestamp}
                  onAction={onAlgoEventClick ? handleClick : undefined}
                  actionLabel={onAlgoEventClick ? "Open" : undefined}
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
