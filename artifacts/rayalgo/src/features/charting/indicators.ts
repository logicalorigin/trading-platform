import type {
  ChartBar,
  IndicatorPlugin,
  IndicatorPluginOutput,
  IndicatorRegistry,
  StudyPoint,
  StudySpec,
} from "./types";

const buildLineStudy = (
  key: string,
  chartBars: ChartBar[],
  values: number[],
  paneIndex: number,
  options: Record<string, unknown>,
): StudySpec => ({
  key,
  seriesType: "line",
  paneIndex,
  options,
  data: chartBars.reduce<StudyPoint[]>((points, bar, index) => {
    const value = values[index];
    if (!Number.isFinite(value)) {
      return points;
    }

    points.push({
      time: bar.time,
      value,
    });
    return points;
  }, []),
});

const computeEma = (values: number[], period: number): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 0) {
    return result;
  }

  const multiplier = 2 / (period + 1);
  let seeded = false;
  let rolling = 0;

  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      return;
    }

    if (!seeded) {
      rolling = value;
      seeded = true;
    } else {
      rolling = ((value - rolling) * multiplier) + rolling;
    }

    if (index >= period - 1) {
      result[index] = Number(rolling.toFixed(6));
    }
  });

  return result;
};

const createEmaPlugin = (
  id: string,
  period: number,
  color: string,
  lineWidth = 2,
): IndicatorPlugin => ({
  id,
  compute({ chartBars }): IndicatorPluginOutput {
    const closes = chartBars.map((bar) => bar.c);
    const values = computeEma(closes, period);

    return {
      studySpecs: [
        buildLineStudy(id, chartBars, values, 0, {
          color,
          lineWidth,
          priceLineVisible: false,
          lastValueVisible: false,
        }),
      ],
    };
  },
});

export const defaultIndicatorRegistry: IndicatorRegistry = {
  "ema-21": createEmaPlugin("ema-21", 21, "#60a5fa", 2),
  "ema-55": createEmaPlugin("ema-55", 55, "#f59e0b", 2),
};

export const resolveIndicatorPlugins = (
  selectedIndicators: string[],
  indicatorRegistry: IndicatorRegistry,
): IndicatorPlugin[] => selectedIndicators
  .map((indicatorId) => indicatorRegistry[indicatorId])
  .filter((plugin): plugin is IndicatorPlugin => Boolean(plugin));
