import type {
  ChartBar,
  IndicatorCatalogEntry,
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
  paneKey?: string,
): StudySpec => ({
  key,
  seriesType: "line",
  paneIndex,
  paneKey,
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

const buildHistogramStudy = (
  key: string,
  chartBars: ChartBar[],
  values: number[],
  paneIndex: number,
  options: Record<string, unknown>,
  colorResolver?: (value: number, index: number) => string | undefined,
  paneKey?: string,
): StudySpec => ({
  key,
  seriesType: "histogram",
  paneIndex,
  paneKey,
  options,
  data: chartBars.reduce<StudyPoint[]>((points, bar, index) => {
    const value = values[index];
    if (!Number.isFinite(value)) {
      return points;
    }

    points.push({
      time: bar.time,
      value,
      color: colorResolver?.(value, index),
    });
    return points;
  }, []),
});

const buildGuideStudy = (
  key: string,
  chartBars: ChartBar[],
  value: number,
  paneKey: string,
  color: string,
): StudySpec => buildLineStudy(
  key,
  chartBars,
  new Array<number>(chartBars.length).fill(value),
  1,
  {
    color,
    lineWidth: 1,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  },
  paneKey,
);

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

const computeSma = (values: number[], period: number): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 0) {
    return result;
  }

  let rollingSum = 0;
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      return;
    }

    rollingSum += value;
    if (index >= period) {
      rollingSum -= values[index - period];
    }

    if (index >= period - 1) {
      result[index] = Number((rollingSum / period).toFixed(6));
    }
  });

  return result;
};

const computeStandardDeviation = (values: number[], period: number): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 0) {
    return result;
  }

  values.forEach((_, index) => {
    if (index < period - 1) {
      return;
    }

    const window = values.slice(index - period + 1, index + 1).filter(Number.isFinite);
    if (window.length !== period) {
      return;
    }

    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance = window.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / period;
    result[index] = Number(Math.sqrt(variance).toFixed(6));
  });

  return result;
};

const computeRsi = (values: number[], period: number): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (values.length <= period || period <= 0) {
    return result;
  }

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  result[period] = averageLoss === 0
    ? 100
    : Number((100 - (100 / (1 + (averageGain / averageLoss)))).toFixed(6));

  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    averageGain = ((averageGain * (period - 1)) + gain) / period;
    averageLoss = ((averageLoss * (period - 1)) + loss) / period;

    if (averageLoss === 0) {
      result[index] = 100;
      continue;
    }

    const relativeStrength = averageGain / averageLoss;
    result[index] = Number((100 - (100 / (1 + relativeStrength))).toFixed(6));
  }

  return result;
};

const computeAtr = (chartBars: ChartBar[], period: number): number[] => {
  const trueRange = chartBars.map((bar, index) => {
    if (index === 0) {
      return bar.h - bar.l;
    }

    const previousClose = chartBars[index - 1]?.c ?? bar.c;
    return Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - previousClose),
      Math.abs(bar.l - previousClose),
    );
  });
  const result = new Array<number>(chartBars.length).fill(Number.NaN);
  if (trueRange.length < period || period <= 0) {
    return result;
  }

  let rolling = 0;
  for (let index = 0; index < period; index += 1) {
    rolling += trueRange[index];
  }

  let atr = rolling / period;
  result[period - 1] = Number(atr.toFixed(6));

  for (let index = period; index < trueRange.length; index += 1) {
    atr = ((atr * (period - 1)) + trueRange[index]) / period;
    result[index] = Number(atr.toFixed(6));
  }

  return result;
};

const computeVwap = (chartBars: ChartBar[]): number[] => {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  return chartBars.map((bar) => {
    const typicalPrice = (bar.h + bar.l + bar.c) / 3;
    cumulativePriceVolume += typicalPrice * bar.v;
    cumulativeVolume += bar.v;
    if (cumulativeVolume <= 0) {
      return Number.NaN;
    }

    return Number((cumulativePriceVolume / cumulativeVolume).toFixed(6));
  });
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

const createSmaPlugin = (
  id: string,
  period: number,
  color: string,
  lineWidth = 2,
): IndicatorPlugin => ({
  id,
  compute({ chartBars }): IndicatorPluginOutput {
    const closes = chartBars.map((bar) => bar.c);
    const values = computeSma(closes, period);

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

const createVwapPlugin = (
  id: string,
  color: string,
): IndicatorPlugin => ({
  id,
  compute({ chartBars }): IndicatorPluginOutput {
    const values = computeVwap(chartBars);

    return {
      studySpecs: [
        buildLineStudy(id, chartBars, values, 0, {
          color,
          lineWidth: 2,
          lineStyle: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        }),
      ],
    };
  },
});

const createBollingerPlugin = (
  id: string,
  period: number,
  multiplier: number,
  colors: {
    basis: string;
    upper: string;
    lower: string;
  },
): IndicatorPlugin => ({
  id,
  compute({ chartBars }): IndicatorPluginOutput {
    const closes = chartBars.map((bar) => bar.c);
    const basis = computeSma(closes, period);
    const deviation = computeStandardDeviation(closes, period);
    const upper = basis.map((value, index) => (
      Number.isFinite(value) && Number.isFinite(deviation[index])
        ? Number((value + (deviation[index] * multiplier)).toFixed(6))
        : Number.NaN
    ));
    const lower = basis.map((value, index) => (
      Number.isFinite(value) && Number.isFinite(deviation[index])
        ? Number((value - (deviation[index] * multiplier)).toFixed(6))
        : Number.NaN
    ));

    return {
      studySpecs: [
        buildLineStudy(`${id}-basis`, chartBars, basis, 0, {
          color: colors.basis,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        }),
        buildLineStudy(`${id}-upper`, chartBars, upper, 0, {
          color: colors.upper,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        }),
        buildLineStudy(`${id}-lower`, chartBars, lower, 0, {
          color: colors.lower,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        }),
      ],
    };
  },
});

const createRsiPlugin = (
  id: string,
  period: number,
  color: string,
): IndicatorPlugin => ({
  id,
  compute({ chartBars }): IndicatorPluginOutput {
    const paneKey = id;
    const closes = chartBars.map((bar) => bar.c);
    const values = computeRsi(closes, period);

    return {
      studySpecs: [
        buildLineStudy(id, chartBars, values, 1, {
          color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        }, paneKey),
        buildGuideStudy(`${id}-guide-70`, chartBars, 70, paneKey, "#D7747088"),
        buildGuideStudy(`${id}-guide-50`, chartBars, 50, paneKey, "#86837D88"),
        buildGuideStudy(`${id}-guide-30`, chartBars, 30, paneKey, "#4FB28688"),
      ],
    };
  },
});

const createAtrPlugin = (
  id: string,
  period: number,
  color: string,
): IndicatorPlugin => ({
  id,
  compute({ chartBars }): IndicatorPluginOutput {
    const paneKey = id;
    const values = computeAtr(chartBars, period);

    return {
      studySpecs: [
        buildLineStudy(id, chartBars, values, 1, {
          color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        }, paneKey),
      ],
    };
  },
});

const createMacdPlugin = (
  id: string,
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
  colors: {
    macd: string;
    signal: string;
    positive: string;
    negative: string;
  },
): IndicatorPlugin => ({
  id,
  compute({ chartBars }): IndicatorPluginOutput {
    const paneKey = id;
    const closes = chartBars.map((bar) => bar.c);
    const fast = computeEma(closes, fastPeriod);
    const slow = computeEma(closes, slowPeriod);
    const macd = closes.map((_, index) => (
      Number.isFinite(fast[index]) && Number.isFinite(slow[index])
        ? Number((fast[index] - slow[index]).toFixed(6))
        : Number.NaN
    ));
    const signal = computeEma(
      macd.map((value) => (Number.isFinite(value) ? value : 0)),
      signalPeriod,
    ).map((value, index) => (Number.isFinite(macd[index]) ? value : Number.NaN));
    const histogram = macd.map((value, index) => (
      Number.isFinite(value) && Number.isFinite(signal[index])
        ? Number((value - signal[index]).toFixed(6))
        : Number.NaN
    ));

    return {
      studySpecs: [
        buildHistogramStudy(`${id}-histogram`, chartBars, histogram, 1, {
          priceLineVisible: false,
          lastValueVisible: false,
          base: 0,
        }, (value) => (value >= 0 ? colors.positive : colors.negative), paneKey),
        buildLineStudy(`${id}-macd`, chartBars, macd, 1, {
          color: colors.macd,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        }, paneKey),
        buildLineStudy(`${id}-signal`, chartBars, signal, 1, {
          color: colors.signal,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        }, paneKey),
        buildGuideStudy(`${id}-zero`, chartBars, 0, paneKey, "#86837D66"),
      ],
    };
  },
});

export const defaultIndicatorRegistry: IndicatorRegistry = {
  "ema-21": createEmaPlugin("ema-21", 21, "#7CA7D9", 2),
  "ema-55": createEmaPlugin("ema-55", 55, "#D9A864", 2),
  "sma-20": createSmaPlugin("sma-20", 20, "#B7A4DC", 2),
  vwap: createVwapPlugin("vwap", "#6FB5C2"),
  "bb-20": createBollingerPlugin("bb-20", 20, 2, {
    basis: "#86837D",
    upper: "#7CA7D9",
    lower: "#7CA7D9",
  }),
  "rsi-14": createRsiPlugin("rsi-14", 14, "#4FB286"),
  "atr-14": createAtrPlugin("atr-14", 14, "#DB8C56"),
  "macd-12-26-9": createMacdPlugin("macd-12-26-9", 12, 26, 9, {
    macd: "#7CA7D9",
    signal: "#D9A864",
    positive: "#4FB28699",
    negative: "#D7747099",
  }),
};

export const defaultIndicatorCatalog: IndicatorCatalogEntry[] = [
  {
    id: "ema-21",
    label: "EMA21",
    kind: "built_in",
    paneType: "price",
    description: "21-period exponential moving average.",
  },
  {
    id: "ema-55",
    label: "EMA55",
    kind: "built_in",
    paneType: "price",
    description: "55-period exponential moving average.",
  },
  {
    id: "sma-20",
    label: "SMA20",
    kind: "built_in",
    paneType: "price",
    description: "20-period simple moving average.",
  },
  {
    id: "vwap",
    label: "VWAP",
    kind: "built_in",
    paneType: "price",
    description: "Session volume-weighted average price.",
  },
  {
    id: "bb-20",
    label: "BB20",
    kind: "built_in",
    paneType: "price",
    description: "20-period Bollinger Bands.",
  },
  {
    id: "rsi-14",
    label: "RSI14",
    kind: "built_in",
    paneType: "lower",
    description: "14-period relative strength index.",
  },
  {
    id: "atr-14",
    label: "ATR14",
    kind: "built_in",
    paneType: "lower",
    description: "14-period average true range.",
  },
  {
    id: "macd-12-26-9",
    label: "MACD",
    kind: "built_in",
    paneType: "lower",
    description: "MACD 12/26/9 oscillator.",
  },
];

export const resolveIndicatorPlugins = (
  selectedIndicators: string[],
  indicatorRegistry: IndicatorRegistry,
): IndicatorPlugin[] => selectedIndicators
  .map((indicatorId) => indicatorRegistry[indicatorId])
  .filter((plugin): plugin is IndicatorPlugin => Boolean(plugin));
