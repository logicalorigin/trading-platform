import {
  DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
} from "../chart/rayalgoCandleColorMode.js";
import { DEFAULT_CHART_TYPE } from "../chart/volumeChartType.js";
import { resolveDefaultVisibleRangeForTimeframe } from "../chart/timeframeModel.js";

export function resolveResearchStartupChartState() {
  return {
    candleTf: "auto",
    chartRange: resolveDefaultVisibleRangeForTimeframe("auto"),
    chartWindowMode: "default",
    spotChartType: DEFAULT_CHART_TYPE,
    optionChartType: DEFAULT_CHART_TYPE,
    rayalgoCandleColorMode: DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
  };
}
