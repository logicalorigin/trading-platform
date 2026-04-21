import type { CSSProperties, ReactNode } from "react";
import { ResearchChartSurface, type OverlayContent } from "./ResearchChartSurface";
import type { ChartModel } from "./types";

type ResearchChartTheme = {
  bg2: string;
  bg3: string;
  bg4: string;
  border: string;
  text: string;
  textMuted: string;
  green: string;
  red: string;
  amber: string;
  accent?: string;
  mono: string;
};

type ResearchDrawing = {
  type?: "horizontal" | "vertical" | "box";
  price?: number;
  time?: number;
  fromTime?: number;
  toTime?: number;
  top?: number;
  bottom?: number;
};

type ReferenceLine = {
  price: number;
  color?: string;
  title?: string;
  lineWidth?: number;
  axisLabelVisible?: boolean;
};

type ResearchChartFrameProps = {
  theme: ResearchChartTheme;
  themeKey: string;
  model: ChartModel;
  compact?: boolean;
  showSurfaceToolbar?: boolean;
  showLegend?: boolean;
  hideTimeScale?: boolean;
  dataTestId?: string;
  style?: CSSProperties;
  header?: ReactNode;
  subHeader?: ReactNode;
  footer?: ReactNode;
  surfaceTopOverlay?: OverlayContent;
  surfaceBottomOverlay?: OverlayContent;
  surfaceTopOverlayHeight?: number;
  surfaceBottomOverlayHeight?: number;
  hideCrosshair?: boolean;
  drawings?: ResearchDrawing[];
  referenceLines?: ReferenceLine[];
  drawMode?: "horizontal" | "vertical" | "box" | null;
  onAddDrawing?: (drawing: ResearchDrawing) => void;
};

export const ResearchChartFrame = ({
  theme,
  themeKey,
  model,
  compact = false,
  showSurfaceToolbar = true,
  showLegend = true,
  hideTimeScale = false,
  dataTestId,
  style,
  header = null,
  subHeader = null,
  footer = null,
  surfaceTopOverlay = null,
  surfaceBottomOverlay = null,
  surfaceTopOverlayHeight = 0,
  surfaceBottomOverlayHeight = 0,
  hideCrosshair = false,
  drawings = [],
  referenceLines = [],
  drawMode = null,
  onAddDrawing,
}: ResearchChartFrameProps) => (
  <div
    data-testid={dataTestId}
    style={{
      background: theme.bg2,
      border: `1px solid ${theme.border}`,
      borderRadius: compact ? 5 : 6,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      height: "100%",
      minHeight: 0,
      ...style,
    }}
  >
    {header ? (
      <div style={{ flexShrink: 0 }}>
        {header}
      </div>
    ) : null}
    {subHeader ? (
      <div style={{ flexShrink: 0 }}>
        {subHeader}
      </div>
    ) : null}
    <div style={{ flex: 1, minHeight: 0 }}>
      <ResearchChartSurface
        dataTestId={dataTestId ? `${dataTestId}-surface` : undefined}
        theme={theme}
        themeKey={themeKey}
        model={model}
        compact={compact}
        showToolbar={showSurfaceToolbar}
        showLegend={showLegend}
        hideTimeScale={hideTimeScale}
        hideCrosshair={hideCrosshair}
        topOverlay={surfaceTopOverlay}
        bottomOverlay={surfaceBottomOverlay}
        topOverlayHeight={surfaceTopOverlayHeight}
        bottomOverlayHeight={surfaceBottomOverlayHeight}
        drawings={drawings}
        referenceLines={referenceLines}
        drawMode={drawMode}
        onAddDrawing={onAddDrawing}
      />
    </div>
    {footer ? (
      <div style={{ flexShrink: 0 }}>
        {footer}
      </div>
    ) : null}
  </div>
);
