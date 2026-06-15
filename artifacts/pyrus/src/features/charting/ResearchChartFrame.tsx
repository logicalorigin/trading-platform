import { type CSSProperties, type ReactNode } from "react";
// @ts-expect-error JSX module imported into TypeScript context
import { RADII, cssColorAlpha } from "../../lib/uiTokens.jsx";
import {
  ResearchChartSurface,
  type ChartViewportSnapshot,
  type ChartLegendMetadata,
  type GexChartOverlay,
  type MobileChartInteractionMode,
  type OverlayContent,
  type VisibleLogicalRange,
} from "./ResearchChartSurface";
import type { ExtendedHoursQuoteInput } from "../platform/extendedHoursQuote";
import type { ChartFootprintContext, ChartModel } from "./types";
import type { ChartEvent, FlowChartEventConversion } from "./chartEvents";
import { useChartPositionOverlays } from "./useChartPositionOverlays";
import type { ChartPositionOverlayContext } from "./chartPositionOverlays";
import { useElementSize } from "../../lib/responsive";
import {
  ChartFrameDensityContext,
  resolveResearchChartFramePlacement,
  resolveResearchChartFrameDensity,
  resolveResearchChartFrameChromeMetrics,
  type ResearchChartFramePlacement,
} from "./chartFrameDensity";

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
  symbol?: string | null;
  footprintContext?: ChartFootprintContext | null;
  placement?: ResearchChartFramePlacement;
  compact?: boolean;
  mobileInteractionMode?: MobileChartInteractionMode;
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
  gexOverlay?: GexChartOverlay | null;
  chartEvents?: ChartEvent[];
  chartFlowDiagnostics?: FlowChartEventConversion | null;
  latestQuotePrice?: number | null;
  latestQuoteUpdatedAt?: string | Date | number | null;
  latestQuoteSnapshot?: ExtendedHoursQuoteInput | null;
  emptyState?: {
    title?: string | null;
    detail?: string | null;
    eyebrow?: string | null;
    loadingWaitItems?: Array<Record<string, unknown>> | null;
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
  positionOverlayContext?: ChartPositionOverlayContext | null;
  crosshairSyncGroupId?: string | null;
  crosshairSyncInstanceId?: string | null;
};

export const ResearchChartFrame = ({
  theme,
  themeKey,
  model,
  surfaceUiStateKey,
  rangeIdentityKey,
  viewportLayoutKey,
  // Optional — passed through to <ResearchChartSurface symbol={symbol} />
  // for the ticker watermark feature (Tier 3 C.3). Callers that don't
  // have a symbol context (e.g., parity lab, generic backtest replay)
  // can leave it null; the watermark only renders when both this prop
  // and userPreferences.chart.showTickerWatermark are truthy.
  symbol = null,
  footprintContext = null,
  placement = "workspace",
  compact,
  mobileInteractionMode,
  showSurfaceToolbar,
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
  surfaceTopOverlayHeight,
  surfaceLeftOverlayWidth,
  surfaceBottomOverlayHeight,
  hideCrosshair = false,
  drawings = EMPTY_DRAWINGS,
  referenceLines = EMPTY_REFERENCE_LINES,
  gexOverlay = null,
  chartEvents = EMPTY_CHART_EVENTS,
  chartFlowDiagnostics = null,
  latestQuotePrice = null,
  latestQuoteUpdatedAt = null,
  latestQuoteSnapshot = null,
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
  positionOverlayContext = null,
  crosshairSyncGroupId = null,
  crosshairSyncInstanceId = null,
}: ResearchChartFrameProps) => {
  const [frameRef, frameSize] = useElementSize<HTMLDivElement>();
  const placementPolicy = resolveResearchChartFramePlacement(placement);
  const placementCompact = compact ?? placementPolicy.compact;
  const frameDensity = resolveResearchChartFrameDensity({
    width: frameSize.width,
    height: frameSize.height,
    compact: placementCompact,
  });
  const chromeMetrics = resolveResearchChartFrameChromeMetrics(
    placementPolicy,
    frameDensity,
  );
  const resolvedCompact = chromeMetrics.compact;
  const resolvedMobileInteractionMode =
    mobileInteractionMode ?? placementPolicy.mobileInteractionMode;
  const resolvedShowSurfaceToolbar =
    showSurfaceToolbar ?? placementPolicy.showSurfaceToolbar;
  const resolvedSurfaceTopOverlayHeight =
    surfaceTopOverlayHeight ?? chromeMetrics.surfaceTopOverlayHeight;
  const resolvedSurfaceLeftOverlayWidth =
    surfaceLeftOverlayWidth ?? chromeMetrics.surfaceLeftOverlayWidth;
  const resolvedSurfaceBottomOverlayHeight =
    surfaceBottomOverlayHeight ?? chromeMetrics.surfaceBottomOverlayHeight;
  const resolvedSurfaceLeftOverlay =
    frameDensity === "minimal" ? null : surfaceLeftOverlay;
  const resolvedSurfaceBottomOverlay =
    frameDensity === "minimal" ? null : surfaceBottomOverlay;
  const positionOverlayState = useChartPositionOverlays({
    chartContext: positionOverlayContext,
    model,
  });
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
      ref={frameRef}
      data-testid={dataTestId}
      data-chart-frame-placement={placement}
      data-chart-frame-compact={resolvedCompact ? "true" : "false"}
      data-chart-frame-density={frameDensity}
      data-signal-direction={signalActive ? frameSignalState?.direction : "none"}
      data-signal-frame-active={signalActive ? "true" : "false"}
      data-signal-frame-color={signalActive ? frameSignalState?.color : undefined}
      aria-label={signalActive ? frameSignalState?.label : undefined}
      style={{
        background: theme.bg2,
        borderRadius: RADII.md,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
        minHeight: 0,
        boxShadow: signalActive
          ? `0 0 0 1px ${cssColorAlpha(frameSignalState?.color || frameBorderColor, "66")}, 0 0 18px ${cssColorAlpha(frameSignalState?.color || frameBorderColor, "22")}`
          : style?.boxShadow,
        ...style,
        border: signalActive
          ? `1px solid ${frameBorderColor}`
          : style?.border || "none",
        borderColor: signalActive ? frameBorderColor : undefined,
      }}
    >
      <ChartFrameDensityContext.Provider value={frameDensity}>
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
            symbol={symbol}
            footprintContext={footprintContext}
            compact={resolvedCompact}
            mobileInteractionMode={resolvedMobileInteractionMode}
            showToolbar={resolvedShowSurfaceToolbar}
            showLegend={showLegend}
            legend={legend}
            hideTimeScale={hideTimeScale}
            hideCrosshair={hideCrosshair}
            topOverlay={surfaceTopOverlay}
            leftOverlay={resolvedSurfaceLeftOverlay}
            bottomOverlay={resolvedSurfaceBottomOverlay}
            topOverlayHeight={resolvedSurfaceTopOverlayHeight}
            leftOverlayWidth={resolvedSurfaceLeftOverlayWidth}
            bottomOverlayHeight={resolvedSurfaceBottomOverlayHeight}
            drawings={drawings}
            referenceLines={referenceLines}
            gexOverlay={gexOverlay}
            chartEvents={chartEvents}
            chartFlowDiagnostics={chartFlowDiagnostics}
            latestQuotePrice={latestQuotePrice}
            latestQuoteUpdatedAt={latestQuoteUpdatedAt}
            latestQuoteSnapshot={latestQuoteSnapshot}
            emptyState={emptyState}
            drawMode={drawMode}
            onAddDrawing={onAddDrawing}
            onTradeMarkerSelection={onTradeMarkerSelection}
            onVisibleLogicalRangeChange={onVisibleLogicalRangeChange}
            viewportSnapshot={viewportSnapshot}
            externalViewportUserTouched={viewportUserTouched}
            onViewportSnapshotChange={onViewportSnapshotChange}
            persistScalePrefs={persistScalePrefs}
            positionOverlays={positionOverlayState.overlays}
            positionOverlaysAvailable={positionOverlayState.available}
            positionOverlaysEnabled={positionOverlayState.enabled}
            onPositionOverlaysEnabledChange={positionOverlayState.setLocalEnabled}
            crosshairSyncGroupId={crosshairSyncGroupId}
            crosshairSyncInstanceId={crosshairSyncInstanceId}
          />
        </div>
        {footer ? <div style={{ flexShrink: 0 }}>{footer}</div> : null}
      </ChartFrameDensityContext.Provider>
    </div>
  );
};


export {
  resolveResearchChartFramePlacement,
  resolveResearchChartFrameDensity,
  resolveResearchChartFrameChromeMetrics,
} from "./chartFrameDensity";
export type {
  ResearchChartFramePlacement,
  ResearchChartFramePlacementPolicy,
  ResearchChartFrameDensity,
} from "./chartFrameDensity";
export {
  ResearchChartWidgetHeader,
  ResearchChartWidgetFooter,
  ResearchChartWidgetSidebar,
} from "./ResearchChartWidgets";
