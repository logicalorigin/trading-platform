import { useMemo } from "react";
import { buildResearchChartModel } from "./model";
import { ResearchChartSurface } from "./ResearchChartSurface";
import { getChartBarLimit } from "./timeframes";
import type { ChartMarker, IndicatorRegistry, MarketBar } from "./types";
import type { ChartEvent } from "./chartEvents";

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
  indicatorSettings?: Record<string, Record<string, unknown>>;
  indicatorRegistry?: IndicatorRegistry;
  indicatorMarkers?: ChartMarker[];
  openPrice?: number | null;
  defaultBaseSeriesType?: BaseSeriesType;
  defaultShowVolume?: boolean;
  chartEvents?: ChartEvent[];
};

export const ResearchMiniChart = ({
  bars,
  timeframe,
  theme,
  themeKey,
  selectedIndicators = [],
  indicatorSettings = {},
  indicatorRegistry,
  indicatorMarkers = [],
  openPrice = null,
  defaultBaseSeriesType = "candles",
  defaultShowVolume = true,
  chartEvents = [],
}: ResearchMiniChartProps) => {
  const model = useMemo(
    () =>
      buildResearchChartModel({
        bars,
        timeframe,
        defaultVisibleBarCount: getChartBarLimit(timeframe, "mini"),
        selectedIndicators,
        indicatorSettings,
        indicatorRegistry,
        indicatorMarkers,
      }),
    [
      bars,
      indicatorMarkers,
      indicatorRegistry,
      indicatorSettings,
      selectedIndicators,
      timeframe,
    ],
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
      chartEvents={chartEvents}
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
