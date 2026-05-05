import type { CSSProperties, ReactNode } from "react";
import {
  ResearchChartSurface,
  type ChartViewportSnapshot,
  type ChartLegendMetadata,
  type OverlayContent,
  type VisibleLogicalRange,
} from "./ResearchChartSurface";
import type { ChartModel } from "./types";
import type { ChartEvent } from "./chartEvents";

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

const EMPTY_DRAWINGS: ResearchDrawing[] = [];
const EMPTY_REFERENCE_LINES: ReferenceLine[] = [];
const EMPTY_CHART_EVENTS: ChartEvent[] = [];

type ResearchChartFrameProps = {
  theme: ResearchChartTheme;
  themeKey: string;
  model: ChartModel;
  surfaceUiStateKey?: string;
  rangeIdentityKey?: string | null;
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
  viewportResetRevision?: number;
  persistScalePrefs?: boolean;
};

export const ResearchChartFrame = ({
  theme,
  themeKey,
  model,
  surfaceUiStateKey,
  rangeIdentityKey,
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
  emptyState = null,
  drawMode = null,
  onAddDrawing,
  onTradeMarkerSelection,
  onVisibleLogicalRangeChange,
  viewportSnapshot,
  viewportUserTouched = false,
  onViewportSnapshotChange,
  viewportResetRevision = 0,
  persistScalePrefs,
}: ResearchChartFrameProps) => (
  <div
    data-testid={dataTestId}
    style={{
      background: theme.bg2,
      border: `1px solid ${theme.border}`,
      borderRadius: 0,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      height: "100%",
      minHeight: 0,
      ...style,
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
        emptyState={emptyState}
        drawMode={drawMode}
        onAddDrawing={onAddDrawing}
        onTradeMarkerSelection={onTradeMarkerSelection}
        onVisibleLogicalRangeChange={onVisibleLogicalRangeChange}
        viewportSnapshot={viewportSnapshot}
        externalViewportUserTouched={viewportUserTouched}
        onViewportSnapshotChange={onViewportSnapshotChange}
        viewportResetRevision={viewportResetRevision}
        persistScalePrefs={persistScalePrefs}
      />
    </div>
    {footer ? <div style={{ flexShrink: 0 }}>{footer}</div> : null}
  </div>
);
