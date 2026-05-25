import { RotateCcw } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";
import { Button } from "./Button.jsx";

const CSS_COLOR = {
  textSec: "var(--ra-text-secondary)",
  textMuted: "var(--ra-text-muted)",
  red: "var(--ra-red-500)",
};

const cssColorMix = (color, percent) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

const toTimestamp = (value) => {
  if (!value) return null;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const formatCooldown = (remainingMs) => {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }
  return `${seconds}s`;
};

export const ActionButton = ({
  state = "idle",
  pending = false,
  pendingLabel = "Working...",
  error = null,
  cooldownUntil = null,
  children,
  disabled = false,
  variant = "secondary",
  size = "sm",
  style,
  onMouseLeave,
  dataTestId,
  ...rest
}) => {
  const cooldownTimestamp = toTimestamp(cooldownUntil);
  const [now, setNow] = useState(Date.now());
  const cooldownActive = Boolean(
    state === "cooldown" ||
      (cooldownTimestamp != null && cooldownTimestamp > now),
  );
  const pendingActive = Boolean(pending || state === "pending");
  const errorMessage =
    error instanceof Error ? error.message : error ? String(error) : null;
  const errorActive = Boolean(state === "error" || errorMessage);
  const remainingMs = Math.max(0, (cooldownTimestamp ?? now) - now);
  const effectiveVariant = errorActive ? "secondary" : variant;
  const effectiveDisabled = disabled || pendingActive || cooldownActive;
  const label = pendingActive ? pendingLabel : children;

  useEffect(() => {
    if (!cooldownActive) {
      return undefined;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownActive]);

  const statusChip = useMemo(() => {
    if (cooldownActive) {
      return (
        <span
          data-testid="action-button-cooldown"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: sp("1px 5px"),
            borderRadius: dim(RADII.pill),
            background: cssColorMix(CSS_COLOR.textMuted, 10),
            color: CSS_COLOR.textSec,
            fontSize: fs(9),
            fontWeight: FONT_WEIGHTS.medium,
            lineHeight: 1.2,
          }}
        >
          {formatCooldown(remainingMs)}
        </span>
      );
    }
    if (errorActive) {
      return (
        <span
          data-testid="action-button-retry"
          title={errorMessage || "Retry"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(3),
            padding: sp("1px 5px"),
            borderRadius: dim(RADII.pill),
            background: cssColorMix(CSS_COLOR.red, 7),
            color: CSS_COLOR.red,
            fontSize: fs(9),
            fontWeight: FONT_WEIGHTS.medium,
            lineHeight: 1.2,
          }}
        >
          <RotateCcw size={10} strokeWidth={2.4} />
          Retry
        </span>
      );
    }
    return null;
  }, [cooldownActive, errorActive, errorMessage, remainingMs]);

  return (
    <Button
      {...rest}
      dataTestId={dataTestId}
      variant={effectiveVariant}
      size={size}
      loading={pendingActive}
      disabled={effectiveDisabled}
      style={{
        ...(errorActive
          ? {
              border: `1px solid ${cssColorMix(CSS_COLOR.red, 33)}`,
              color: CSS_COLOR.red,
            }
          : null),
        ...style,
      }}
      onMouseLeave={(event) => {
        if (style?.background) {
          event.currentTarget.style.background = style.background;
        }
        if (style?.border) {
          event.currentTarget.style.border = style.border;
        }
        if (style?.color) {
          event.currentTarget.style.color = style.color;
        }
        if (errorActive) {
          event.currentTarget.style.border = `1px solid ${cssColorMix(CSS_COLOR.red, 33)}`;
          event.currentTarget.style.color = CSS_COLOR.red;
        }
        onMouseLeave?.(event);
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: sp(5) }}>
        <span>{label}</span>
        {statusChip}
      </span>
    </Button>
  );
};
