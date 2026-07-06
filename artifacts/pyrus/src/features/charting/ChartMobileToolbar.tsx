import {
  Clock,
  Crosshair,
  Maximize2,
  Minimize2,
  Plus,
  Wrench,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
// @ts-expect-error JSX import from a .jsx module
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";

type ChartMobileToolbarProps = {
  timeframeLabel: string;
  indicatorCount: number;
  drawMode: "horizontal" | "vertical" | "box" | null;
  isFullscreen: boolean;
  isCrosshairFree: boolean;
  onOpenTimeframe: () => void;
  onOpenIndicators: () => void;
  onOpenDrawings: () => void;
  onToggleFullscreen: () => void;
  onToggleCrosshair: () => void;
};

const buttonStyle = (active: boolean): CSSProperties => ({
  flex: 1,
  minWidth: 0,
  minHeight: dim(44),
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: sp(1),
  padding: sp("4px 2px"),
  border: "none",
  background: "transparent",
  color: active ? CSS_COLOR.accent : CSS_COLOR.textSec,
  fontFamily: T.sans,
  fontSize: fs(8),
  fontWeight: active ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  cursor: "pointer",
  position: "relative",
});

const labelStyle: CSSProperties = {
  display: "block",
  fontFamily: T.sans,
  fontSize: fs(8),
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: dim(72),
};

const ToolbarButton = ({
  testId,
  icon,
  label,
  active = false,
  badge,
  onClick,
}: {
  testId: string;
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: number | string;
  onClick: () => void;
}) => (
  <button
    type="button"
    data-testid={testId}
    aria-pressed={active}
    onClick={onClick}
    style={buttonStyle(active)}
  >
    <span style={{ position: "relative", display: "inline-flex" }}>
      {icon}
      {badge != null && badge !== "" && badge !== 0 ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -dim(4),
            right: -dim(8),
            minWidth: dim(14),
            height: dim(14),
            padding: sp("0 4px"),
            borderRadius: dim(RADII.pill),
            background: CSS_COLOR.accent,
            color: CSS_COLOR.onAccent,
            fontFamily: T.sans,
            fontSize: fs(7),
            fontWeight: FONT_WEIGHTS.medium,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {badge}
        </span>
      ) : null}
    </span>
    <span style={labelStyle}>{label}</span>
  </button>
);

export const ChartMobileToolbar = ({
  timeframeLabel,
  indicatorCount,
  drawMode,
  isFullscreen,
  isCrosshairFree,
  onOpenTimeframe,
  onOpenIndicators,
  onOpenDrawings,
  onToggleFullscreen,
  onToggleCrosshair,
}: ChartMobileToolbarProps) => {
  return (
    <div
      data-testid="chart-mobile-toolbar"
      className="ra-glass-surface"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 3,
        display: "flex",
        alignItems: "stretch",
        gap: sp(1),
        padding: sp("3px 2px max(3px, env(safe-area-inset-bottom))"),
        borderTop: `1px solid ${CSS_COLOR.border}`,
      }}
    >
      <ToolbarButton
        testId="chart-mobile-toolbar-crosshair"
        icon={<Crosshair size={18} strokeWidth={1.6} />}
        label={isCrosshairFree ? "Free" : "Magnet"}
        active={isCrosshairFree}
        onClick={onToggleCrosshair}
      />
      <ToolbarButton
        testId="chart-mobile-toolbar-timeframe"
        icon={<Clock size={18} strokeWidth={1.6} />}
        label={timeframeLabel}
        active={false}
        onClick={onOpenTimeframe}
      />
      <ToolbarButton
        testId="chart-mobile-toolbar-indicators"
        icon={<Plus size={18} strokeWidth={1.6} />}
        label="Indicators"
        badge={indicatorCount || ""}
        active={indicatorCount > 0}
        onClick={onOpenIndicators}
      />
      <ToolbarButton
        testId="chart-mobile-toolbar-tools"
        icon={<Wrench size={18} strokeWidth={1.6} />}
        label="Tools"
        active={drawMode != null}
        onClick={onOpenDrawings}
      />
      <ToolbarButton
        testId="chart-mobile-toolbar-fullscreen"
        icon={
          isFullscreen ? (
            <Minimize2 size={18} strokeWidth={1.6} />
          ) : (
            <Maximize2 size={18} strokeWidth={1.6} />
          )
        }
        label={isFullscreen ? "Exit" : "Full"}
        active={isFullscreen}
        onClick={onToggleFullscreen}
      />
    </div>
  );
};

export default ChartMobileToolbar;
