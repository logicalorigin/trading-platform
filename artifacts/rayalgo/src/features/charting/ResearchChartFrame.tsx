import type { CSSProperties, ReactNode } from "react";
import {
  ResearchChartSurface,
  type ChartViewportSnapshot,
  type ChartLegendMetadata,
  type OverlayContent,
  type VisibleLogicalRange,
} from "./ResearchChartSurface";
import type { ChartModel } from "./types";
import type { ChartEvent, FlowChartEventConversion } from "./chartEvents";

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
  blue?: string;
  cyan?: string;
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

type FrameSignalState = {
  active?: boolean;
  direction?: "buy" | "sell" | "none" | string;
  color?: string;
  label?: string;
} | null;

const EMPTY_DRAWINGS: ResearchDrawing[] = [];
const EMPTY_REFERENCE_LINES: ReferenceLine[] = [];
const EMPTY_CHART_EVENTS: ChartEvent[] = [];

type ResearchChartFrameProps = {
  theme: ResearchChartTheme;
  themeKey: string;
  model: ChartModel;
  surfaceUiStateKey?: string;
  rangeIdentityKey?: string | null;
  viewportLayoutKey?: string | null;
  compact?: boolean;
  showSurfaceToolbar?: boolean;
  showLegend?: boolean;
  legend?: ChartLegendMetadata | null;
  hideTimeScale?: boolean;
  dataTestId?: string;
  style?: CSSProperties;
  header?: ReactNode;
  subHeader?: ReactNode;
  footer?: ReactNode;
  surfaceTopOverlay?: OverlayContent;
  surfaceLeftOverlay?: OverlayContent;
  surfaceBottomOverlay?: OverlayContent;
  surfaceTopOverlayHeight?: number;
  surfaceLeftOverlayWidth?: number;
  surfaceBottomOverlayHeight?: number;
  hideCrosshair?: boolean;
  drawings?: ResearchDrawing[];
  referenceLines?: ReferenceLine[];
  chartEvents?: ChartEvent[];
  chartFlowDiagnostics?: FlowChartEventConversion | null;
  latestQuotePrice?: number | null;
  latestQuoteUpdatedAt?: string | Date | number | null;
  emptyState?: {
    title?: string | null;
    detail?: string | null;
    eyebrow?: string | null;
  } | null;
  drawMode?: "horizontal" | "vertical" | "box" | null;
  onAddDrawing?: (drawing: ResearchDrawing) => void;
  onTradeMarkerSelection?: (tradeSelectionIds: string[]) => void;
  onVisibleLogicalRangeChange?: (range: VisibleLogicalRange | null) => void;
  viewportSnapshot?: ChartViewportSnapshot | null;
  viewportUserTouched?: boolean;
  onViewportSnapshotChange?: (snapshot: ChartViewportSnapshot) => void;
  persistScalePrefs?: boolean;
  frameSignalState?: FrameSignalState;
};

export const ResearchChartFrame = ({
  theme,
  themeKey,
  model,
  surfaceUiStateKey,
  rangeIdentityKey,
  viewportLayoutKey,
  compact = false,
  showSurfaceToolbar = true,
  showLegend = true,
  legend = null,
  hideTimeScale = false,
  dataTestId,
  style,
  header = null,
  subHeader = null,
  footer = null,
  surfaceTopOverlay = null,
  surfaceLeftOverlay = null,
  surfaceBottomOverlay = null,
  surfaceTopOverlayHeight = 0,
  surfaceLeftOverlayWidth = 0,
  surfaceBottomOverlayHeight = 0,
  hideCrosshair = false,
  drawings = EMPTY_DRAWINGS,
  referenceLines = EMPTY_REFERENCE_LINES,
  chartEvents = EMPTY_CHART_EVENTS,
  chartFlowDiagnostics = null,
  latestQuotePrice = null,
  latestQuoteUpdatedAt = null,
  emptyState = null,
  drawMode = null,
  onAddDrawing,
  onTradeMarkerSelection,
  onVisibleLogicalRangeChange,
  viewportSnapshot,
  viewportUserTouched = false,
  onViewportSnapshotChange,
  persistScalePrefs,
  frameSignalState = null,
}: ResearchChartFrameProps) => {
  const signalActive = Boolean(
    frameSignalState?.active &&
      (frameSignalState.direction === "buy" ||
        frameSignalState.direction === "sell") &&
      frameSignalState.color,
  );
  const frameBorderColor = signalActive
    ? frameSignalState?.color
    : style?.borderColor || theme.border;

  return (
    <div
      data-testid={dataTestId}
      data-signal-direction={signalActive ? frameSignalState?.direction : "none"}
      data-signal-frame-active={signalActive ? "true" : "false"}
      data-signal-frame-color={signalActive ? frameSignalState?.color : undefined}
      aria-label={signalActive ? frameSignalState?.label : undefined}
      style={{
        background: theme.bg2,
        borderRadius: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
        minHeight: 0,
        boxShadow: signalActive
          ? `0 0 0 1px ${frameSignalState?.color}66, 0 0 18px ${frameSignalState?.color}22`
          : style?.boxShadow,
        ...style,
        border: signalActive
          ? `1px solid ${frameBorderColor}`
          : style?.border || `1px solid ${theme.border}`,
        borderColor: frameBorderColor,
      }}
    >
      {header ? <div style={{ flexShrink: 0 }}>{header}</div> : null}
      {subHeader ? <div style={{ flexShrink: 0 }}>{subHeader}</div> : null}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResearchChartSurface
          dataTestId={dataTestId ? `${dataTestId}-surface` : undefined}
          theme={theme}
          themeKey={themeKey}
          uiStateKey={surfaceUiStateKey}
          rangeIdentityKey={rangeIdentityKey}
          viewportLayoutKey={viewportLayoutKey}
          model={model}
          compact={compact}
          showToolbar={showSurfaceToolbar}
          showLegend={showLegend}
          legend={legend}
          hideTimeScale={hideTimeScale}
          hideCrosshair={hideCrosshair}
          topOverlay={surfaceTopOverlay}
          leftOverlay={surfaceLeftOverlay}
          bottomOverlay={surfaceBottomOverlay}
          topOverlayHeight={surfaceTopOverlayHeight}
          leftOverlayWidth={surfaceLeftOverlayWidth}
          bottomOverlayHeight={surfaceBottomOverlayHeight}
          drawings={drawings}
          referenceLines={referenceLines}
          chartEvents={chartEvents}
          chartFlowDiagnostics={chartFlowDiagnostics}
          latestQuotePrice={latestQuotePrice}
          latestQuoteUpdatedAt={latestQuoteUpdatedAt}
          emptyState={emptyState}
          drawMode={drawMode}
          onAddDrawing={onAddDrawing}
          onTradeMarkerSelection={onTradeMarkerSelection}
          onVisibleLogicalRangeChange={onVisibleLogicalRangeChange}
          viewportSnapshot={viewportSnapshot}
          externalViewportUserTouched={viewportUserTouched}
          onViewportSnapshotChange={onViewportSnapshotChange}
          persistScalePrefs={persistScalePrefs}
        />
      </div>
      {footer ? <div style={{ flexShrink: 0 }}>{footer}</div> : null}
    </div>
  );
};
