import type { CSSProperties } from "react";
import type { ChartLoadingStatus } from "./chartLoadingStatusModel";

type ChartHydrationStatusTheme = {
  accent?: string;
  amber: string;
  bg2: string;
  bg3: string;
  border: string;
  green: string;
  mono: string;
  red: string;
  text: string;
  textMuted: string;
};

const toneColor = (
  theme: ChartHydrationStatusTheme,
  tone: ChartLoadingStatus["tone"],
) => {
  if (tone === "good") return theme.green;
  if (tone === "warn") return theme.amber;
  if (tone === "bad") return theme.red;
  if (tone === "info") return theme.accent || theme.text;
  return theme.textMuted;
};

export const ChartHydrationStatusStrip = ({
  compact = false,
  dataTestId,
  status,
  theme,
}: {
  compact?: boolean;
  dataTestId?: string;
  status: ChartLoadingStatus;
  theme: ChartHydrationStatusTheme;
}) => {
  const color = toneColor(theme, status.tone);
  const motionStyle = {
    "--ra-motion-accent": color,
  } as CSSProperties;

  return (
    <div
      aria-label={`${status.label}: ${status.progressLabel}. ${status.detail}`}
      className={status.active ? "ra-scan-sweep" : undefined}
      data-chart-hydration-state={status.state}
      data-testid={dataTestId}
      style={{
        ...motionStyle,
        minHeight: compact ? 18 : 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: compact ? 6 : 8,
        padding: compact ? "2px 6px" : "3px 8px",
        borderBottom: `1px solid ${theme.border}`,
        background: status.active ? `${color}10` : theme.bg3 || theme.bg2,
        color: theme.textMuted,
        fontFamily: theme.mono,
        fontSize: compact ? 9 : 10,
        lineHeight: 1.1,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          minWidth: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            color,
            fontWeight: 800,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {status.label}
        </span>
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {status.detail}
        </span>
      </span>
      <span
        style={{
          flexShrink: 0,
          color: theme.text,
          fontWeight: 800,
          whiteSpace: "nowrap",
        }}
      >
        {status.progressLabel}
      </span>
    </div>
  );
};
