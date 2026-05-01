export type SpotChartFrameLayout = {
  surfaceTopOverlayHeight: number;
  surfaceLeftOverlayWidth: number;
  surfaceBottomOverlayHeight: number;
};

export const SPOT_CHART_FRAME_LAYOUT: Record<
  "regular" | "dense",
  SpotChartFrameLayout
> = {
  regular: {
    surfaceTopOverlayHeight: 40,
    surfaceLeftOverlayWidth: 40,
    surfaceBottomOverlayHeight: 22,
  },
  dense: {
    surfaceTopOverlayHeight: 28,
    surfaceLeftOverlayWidth: 28,
    surfaceBottomOverlayHeight: 16,
  },
};

export const resolveSpotChartFrameLayout = (
  dense = false,
): SpotChartFrameLayout => (
  dense ? SPOT_CHART_FRAME_LAYOUT.dense : SPOT_CHART_FRAME_LAYOUT.regular
);
