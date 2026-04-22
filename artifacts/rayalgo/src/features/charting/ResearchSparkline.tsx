import { useMemo } from "react";
import { ResearchMiniChart } from "./ResearchMiniChart";
import { useIndicatorLibrary } from "./pineScripts";
import {
  DEFAULT_RAY_REPLICA_SETTINGS,
  RAY_REPLICA_PINE_SCRIPT_KEY,
} from "./rayReplicaPineAdapter";
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
  const { indicatorRegistry } = useIndicatorLibrary();
  const sparkBars = useMemo(
    () => Array.isArray(bars) ? bars.filter((bar) => (
      typeof (bar.close ?? bar.c) === "number" &&
      Number.isFinite(bar.close ?? bar.c)
    )) : [],
    [bars],
  );
  const indicatorSettings = useMemo(
    () => ({
      [RAY_REPLICA_PINE_SCRIPT_KEY]: {
        ...DEFAULT_RAY_REPLICA_SETTINGS,
        showTpSl: false,
        showDashboard: false,
      },
    }),
    [],
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
      selectedIndicators={[RAY_REPLICA_PINE_SCRIPT_KEY]}
      indicatorSettings={indicatorSettings}
      indicatorRegistry={indicatorRegistry}
      defaultBaseSeriesType="line"
      defaultShowVolume={false}
    />
  );
};
