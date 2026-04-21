import { useMemo } from "react";
import { ResearchMiniChart } from "./ResearchMiniChart";
import type { MarketBar } from "./types";

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

type ResearchSparklineProps = {
  bars?: MarketBar[] | null;
  theme: ResearchChartTheme;
  themeKey: string;
};

export const ResearchSparkline = ({
  bars = [],
  theme,
  themeKey,
}: ResearchSparklineProps) => {
  const sparkBars = useMemo(
    () => Array.isArray(bars) ? bars.filter((bar) => (
      typeof (bar.close ?? bar.c) === "number" &&
      Number.isFinite(bar.close ?? bar.c)
    )) : [],
    [bars],
  );

  if (sparkBars.length < 2) {
    return null;
  }

  return (
    <ResearchMiniChart
      theme={theme}
      themeKey={themeKey}
      bars={sparkBars}
      timeframe="5m"
      defaultBaseSeriesType="line"
      defaultShowVolume={false}
    />
  );
};
