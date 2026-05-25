import React from "react";
import { FONT_WEIGHTS, T, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { formatRelativeTimeShort } from "../../lib/formatters";
import { StatusPill } from "../platform/primitives.jsx";
import { PulseDot } from "./PulseDot.jsx";

const CSS_COLOR = {
  textMuted: "var(--ra-text-muted)",
  accent: "var(--ra-color-accent)",
  green: "var(--ra-green-500)",
  amber: "var(--ra-amber-500)",
  red: "var(--ra-red-500)",
};

const STATUS_META = {
  disconnected: {
    label: "Disconnected",
    color: CSS_COLOR.textMuted,
    active: false,
  },
  connecting: {
    label: "Connecting",
    color: CSS_COLOR.accent,
    active: true,
  },
  connected: {
    label: "Connected",
    color: CSS_COLOR.green,
    active: true,
  },
  degraded: {
    label: "Degraded",
    color: CSS_COLOR.amber,
    active: true,
  },
  reconnecting: {
    label: "Reconnecting",
    color: CSS_COLOR.accent,
    active: true,
  },
  error: {
    label: "Error",
    color: CSS_COLOR.red,
    active: true,
  },
};

const formatUpdatedLabel = (value) => {
  if (!value) {
    return null;
  }
  const relative = formatRelativeTimeShort(value);
  if (!relative || relative === "--") {
    return null;
  }
  return relative === "now" ? "Updated now" : `Updated ${relative} ago`;
};

export const ConnectionStatusPill = ({
  status = "disconnected",
  lastSyncAt = null,
  size = "md",
  label,
}) => {
  const meta = STATUS_META[status] || STATUS_META.disconnected;
  const color = meta.color;
  const updatedLabel = formatUpdatedLabel(lastSyncAt);
  const compact = size === "sm";

  return (
    <span
      data-testid="connection-status-pill"
      data-status={status}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: sp(2),
        minWidth: 0,
      }}
    >
      <StatusPill color={color} dot={false}>
        <PulseDot
          active={meta.active}
          color={color}
          size={compact ? 5 : 6}
          label={label || meta.label}
        />
        <span
          style={{
            fontSize: textSize(compact ? "caption" : "body"),
            lineHeight: 1.1,
          }}
        >
          {label || meta.label}
        </span>
      </StatusPill>
      {updatedLabel ? (
        <span
          data-testid="connection-status-pill-updated"
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: fs(compact ? 9 : 10),
            fontWeight: FONT_WEIGHTS.regular,
            lineHeight: 1.1,
            paddingLeft: sp(compact ? 4 : 6),
            whiteSpace: "nowrap",
          }}
        >
          {updatedLabel}
        </span>
      ) : null}
    </span>
  );
};
