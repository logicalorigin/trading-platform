import type { CSSProperties } from "react";
// @ts-expect-error JSX import from a .jsx module
import { CSS_COLOR, FONT_WEIGHTS, T, fs, sp } from "../../lib/uiTokens.jsx";

type ChartFloatingCrosshairProps = {
  visible: boolean;
  x: number | null;
  y: number | null;
  containerWidth: number;
  containerHeight: number;
  payload: ChartFloatingPayload | null;
};

export type ChartFloatingPayload = {
  timeLabel?: string | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  delta?: number | null;
  deltaPercent?: number | null;
};

const OFFSET = 18;
const BADGE_WIDTH = 152;
const BADGE_HEIGHT = 96;

const formatNum = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  return value.toFixed(2);
};

const formatSignedPercent = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
};

export const ChartFloatingCrosshair = ({
  visible,
  x,
  y,
  containerWidth,
  containerHeight,
  payload,
}: ChartFloatingCrosshairProps) => {
  if (!visible || x == null || y == null || !payload) return null;

  // Position above-left of touch by default; auto-flip when near edges
  // so the badge stays fully visible.
  const wantRight = x < BADGE_WIDTH + OFFSET;
  const wantBelow = y < BADGE_HEIGHT + OFFSET;
  const badgeLeft = wantRight
    ? Math.min(containerWidth - BADGE_WIDTH - 4, x + OFFSET)
    : Math.max(4, x - BADGE_WIDTH - OFFSET);
  const badgeTop = wantBelow
    ? Math.min(containerHeight - BADGE_HEIGHT - 4, y + OFFSET)
    : Math.max(4, y - BADGE_HEIGHT - OFFSET);

  const deltaTone =
    payload.delta == null || payload.delta === 0
      ? CSS_COLOR.textSec
      : payload.delta > 0
        ? CSS_COLOR.green
        : CSS_COLOR.red;

  const wrapperStyle: CSSProperties = {
    position: "absolute",
    left: badgeLeft,
    top: badgeTop,
    width: BADGE_WIDTH,
    pointerEvents: "none",
    zIndex: 4,
    padding: sp("8px 10px"),
    background: "var(--ra-tooltip-bg)",
    color: "var(--ra-tooltip-text)",
    border: "1px solid var(--ra-tooltip-border)",
    borderRadius: 8,
    boxShadow: "var(--ra-tooltip-shadow)",
    fontFamily: T.sans,
    display: "grid",
    gap: sp(2),
  };

  return (
    <div
      data-testid="chart-floating-crosshair-badge"
      data-chart-floating-crosshair=""
      style={wrapperStyle}
    >
      <div
        style={{
          fontSize: fs(9),
          color: "var(--ra-tooltip-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: FONT_WEIGHTS.medium,
        }}
      >
        {payload.timeLabel || "—"}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          rowGap: sp(1),
          columnGap: sp(6),
          fontFamily: T.data,
          fontSize: fs(10),
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ color: "var(--ra-tooltip-muted)" }}>O</span>
        <span style={{ textAlign: "right" }}>{formatNum(payload.open)}</span>
        <span style={{ color: "var(--ra-tooltip-muted)" }}>H</span>
        <span style={{ color: CSS_COLOR.green, textAlign: "right" }}>{formatNum(payload.high)}</span>
        <span style={{ color: "var(--ra-tooltip-muted)" }}>L</span>
        <span style={{ color: CSS_COLOR.red, textAlign: "right" }}>{formatNum(payload.low)}</span>
        <span style={{ color: "var(--ra-tooltip-muted)" }}>C</span>
        <span style={{ textAlign: "right", fontWeight: FONT_WEIGHTS.medium }}>{formatNum(payload.close)}</span>
      </div>
      {payload.delta != null && payload.delta !== 0 ? (
        <div
          style={{
            fontSize: fs(9),
            fontFamily: T.data,
            color: deltaTone,
            fontVariantNumeric: "tabular-nums",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>{payload.delta > 0 ? `+${formatNum(payload.delta)}` : formatNum(payload.delta)}</span>
          <span>{formatSignedPercent(payload.deltaPercent)}</span>
        </div>
      ) : null}
    </div>
  );
};

export default ChartFloatingCrosshair;
