// Chart frame placement + density policy. Extracted verbatim from ResearchChartFrame.tsx.
import { createContext, useContext } from "react";
import type { MobileChartInteractionMode } from "./ResearchChartSurface";

export type ResearchChartFramePlacement =
  | "workspace"
  | "workspace-passive"
  | "compact-active"
  | "compact-passive"
  | "market-compact-active"
  | "market-compact-passive"
  | "inspection"
  | "backtest";

export type ResearchChartFramePlacementPolicy = {
  compact: boolean;
  mobileInteractionMode: MobileChartInteractionMode;
  showSurfaceToolbar: boolean;
  surfaceTopOverlayHeight: number;
  surfaceLeftOverlayWidth: number;
  surfaceBottomOverlayHeight: number;
};

const WORKSPACE_CHROME_PLACEMENT: ResearchChartFramePlacementPolicy = {
  compact: false,
  mobileInteractionMode: "hybrid",
  showSurfaceToolbar: false,
  surfaceTopOverlayHeight: 40,
  surfaceLeftOverlayWidth: 40,
  surfaceBottomOverlayHeight: 22,
};

const DENSE_CHROME_PLACEMENT: ResearchChartFramePlacementPolicy = {
  compact: true,
  mobileInteractionMode: "hybrid",
  showSurfaceToolbar: false,
  surfaceTopOverlayHeight: 28,
  surfaceLeftOverlayWidth: 28,
  surfaceBottomOverlayHeight: 16,
};

const MARKET_GRID_CHROME_PLACEMENT: ResearchChartFramePlacementPolicy = {
  ...DENSE_CHROME_PLACEMENT,
  surfaceTopOverlayHeight: 24,
  surfaceLeftOverlayWidth: 24,
  surfaceBottomOverlayHeight: 14,
};

const CHART_FRAME_PLACEMENTS: Record<
  ResearchChartFramePlacement,
  ResearchChartFramePlacementPolicy
> = {
  workspace: WORKSPACE_CHROME_PLACEMENT,
  "workspace-passive": {
    ...WORKSPACE_CHROME_PLACEMENT,
    mobileInteractionMode: "page-first",
  },
  "compact-active": DENSE_CHROME_PLACEMENT,
  "compact-passive": {
    ...DENSE_CHROME_PLACEMENT,
    mobileInteractionMode: "page-first",
  },
  "market-compact-active": MARKET_GRID_CHROME_PLACEMENT,
  "market-compact-passive": {
    ...MARKET_GRID_CHROME_PLACEMENT,
    mobileInteractionMode: "page-first",
  },
  inspection: {
    ...DENSE_CHROME_PLACEMENT,
    surfaceLeftOverlayWidth: 0,
    surfaceBottomOverlayHeight: 20,
  },
  backtest: {
    compact: false,
    mobileInteractionMode: "hybrid",
    showSurfaceToolbar: true,
    surfaceTopOverlayHeight: 0,
    surfaceLeftOverlayWidth: 0,
    surfaceBottomOverlayHeight: 0,
  },
};

export const resolveResearchChartFramePlacement = (
  placement: ResearchChartFramePlacement = "workspace",
): ResearchChartFramePlacementPolicy =>
  CHART_FRAME_PLACEMENTS[placement] || CHART_FRAME_PLACEMENTS.workspace;

export type ResearchChartFrameDensity = "full" | "compact" | "icon" | "minimal";

export const resolveResearchChartFrameDensity = ({
  width,
  height,
  compact = false,
}: {
  width?: number;
  height?: number;
  compact?: boolean;
}): ResearchChartFrameDensity => {
  const hasWidth = typeof width === "number" && width > 0;
  const hasHeight = typeof height === "number" && height > 0;

  if ((hasWidth && width < 260) || (hasHeight && height < 190)) {
    return "minimal";
  }
  if ((hasWidth && width < 640) || (hasHeight && height < 240)) {
    return "icon";
  }
  if (compact || (hasWidth && width < 860) || (hasHeight && height < 260)) {
    return "compact";
  }
  return "full";
};

export const resolveResearchChartFrameChromeMetrics = (
  placementPolicy: ResearchChartFramePlacementPolicy,
  density: ResearchChartFrameDensity,
): Pick<
  ResearchChartFramePlacementPolicy,
  | "compact"
  | "surfaceTopOverlayHeight"
  | "surfaceLeftOverlayWidth"
  | "surfaceBottomOverlayHeight"
> => {
  const compressed = density !== "full";
  const hiddenAuxChrome = density === "minimal";
  return {
    compact: compressed,
    surfaceTopOverlayHeight:
      placementPolicy.surfaceTopOverlayHeight <= 0
        ? 0
        : compressed
          ? Math.min(28, placementPolicy.surfaceTopOverlayHeight)
          : placementPolicy.surfaceTopOverlayHeight,
    surfaceLeftOverlayWidth:
      placementPolicy.surfaceLeftOverlayWidth <= 0 || hiddenAuxChrome
        ? 0
        : density === "full"
          ? placementPolicy.surfaceLeftOverlayWidth
          : density === "compact"
            ? Math.min(30, placementPolicy.surfaceLeftOverlayWidth)
            : Math.min(26, placementPolicy.surfaceLeftOverlayWidth),
    surfaceBottomOverlayHeight:
      placementPolicy.surfaceBottomOverlayHeight <= 0 || hiddenAuxChrome
        ? 0
        : compressed
          ? Math.min(16, placementPolicy.surfaceBottomOverlayHeight)
          : placementPolicy.surfaceBottomOverlayHeight,
  };
};

export const ChartFrameDensityContext =
  createContext<ResearchChartFrameDensity | null>(null);

export const useResolvedChartFrameDensity = (
  dense: boolean,
  density?: ResearchChartFrameDensity,
): ResearchChartFrameDensity => {
  const contextDensity = useContext(ChartFrameDensityContext);
  return density ?? contextDensity ?? (dense ? "compact" : "full");
};

export const isCompressedChartFrameDensity = (density: ResearchChartFrameDensity) =>
  density !== "full";

export const isIconChartFrameDensity = (density: ResearchChartFrameDensity) =>
  density === "icon" || density === "minimal";
