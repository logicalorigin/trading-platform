import { useMemo } from "react";
import { buildResearchChartModel } from "./model";
import { ResearchChartSurface } from "./ResearchChartSurface";
import type { ChartMarker, IndicatorRegistry, MarketBar } from "./types";

type BaseSeriesType = "candles" | "bars" | "line" | "area" | "baseline";

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

type ResearchMiniChartProps = {
  bars: MarketBar[];
  timeframe: string;
  theme: ResearchChartTheme;
  themeKey: string;
  selectedIndicators?: string[];
  indicatorRegistry?: IndicatorRegistry;
  indicatorMarkers?: ChartMarker[];
  openPrice?: number | null;
  defaultBaseSeriesType?: BaseSeriesType;
  defaultShowVolume?: boolean;
};

export const ResearchMiniChart = ({
  bars,
  timeframe,
  theme,
  themeKey,
  selectedIndicators = [],
  indicatorRegistry,
  indicatorMarkers = [],
  openPrice = null,
  defaultBaseSeriesType = "candles",
  defaultShowVolume = true,
}: ResearchMiniChartProps) => {
  const model = useMemo(
    () =>
      buildResearchChartModel({
        bars,
        timeframe,
        selectedIndicators,
        indicatorRegistry,
        indicatorMarkers,
      }),
    [bars, indicatorMarkers, indicatorRegistry, selectedIndicators, timeframe],
  );
  const referenceLines = useMemo(
    () =>
      typeof openPrice === "number" && Number.isFinite(openPrice)
        ? [
            {
              price: openPrice,
              color: theme.textMuted,
              lineWidth: 1,
              axisLabelVisible: false,
              title: "",
            },
          ]
        : [],
    [openPrice, theme.textMuted],
  );

  return (
    <ResearchChartSurface
      model={model}
      theme={theme}
      themeKey={themeKey}
      referenceLines={referenceLines}
      compact
      showToolbar={false}
      showLegend={false}
      hideTimeScale
      hideCrosshair
      showRightPriceScale={false}
      enableInteractions={false}
      showAttributionLogo={false}
      defaultBaseSeriesType={defaultBaseSeriesType}
      defaultShowVolume={defaultShowVolume}
      defaultShowPriceLine={false}
    />
  );
};
