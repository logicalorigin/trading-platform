import type { PineScriptRecord } from "@workspace/api-client-react";
import type {
  ChartBar,
  ChartBarStyle,
  ChartMarker,
  IndicatorEvent,
  IndicatorPlugin,
  IndicatorPluginOutput,
  IndicatorWindow,
  IndicatorZone,
  StudyPoint,
  StudySpec,
} from "./types";

export const RAY_REPLICA_PINE_SCRIPT_KEY = "rayalgo-replica-smc-pro-v3";

const TIME_HORIZON = 10;
const BASIS_LENGTH = 80;
const ATR_LENGTH = 14;
const ATR_SMOOTHING = 21;
const VOLATILITY_MULTIPLIER = 2;
const WIRE_SPREAD = 0.5;
const SHADOW_LENGTH = 20;
const SHADOW_STD_DEV = 2;
const KEY_LEVEL_LINE_STYLE = 2;
const BULL_COLOR = "#00bcd4";
const BEAR_COLOR = "#e91e63";
const SHADOW_COLOR = "#787b86";
const REACTION_COLOR = "#facc15";
const KEY_LEVEL_HIGH_COLOR = "#ef5350";
const KEY_LEVEL_LOW_COLOR = "#26a69a";
const KEY_LEVEL_CLOSE_COLOR = "#9ca3af";
const KEY_LEVEL_OPEN_COLOR = "#facc15";

type StructureKind = "bos" | "choch";

type StructureRecord = {
  kind: StructureKind;
  direction: "long" | "short";
  sourceBarIndex: number;
  sourcePrice: number;
  eventBarIndex: number;
  label: string;
};

type ActiveOrderBlock = {
  id: string;
  direction: "long" | "short";
  startBarIndex: number;
  endBarIndex: number;
  top: number;
  bottom: number;
  label: string;
};

const buildStudyData = (
  chartBars: ChartBar[],
  values: number[],
): StudyPoint[] =>
  chartBars.reduce<StudyPoint[]>((points, bar, index) => {
    const value = values[index];
    if (!Number.isFinite(value)) {
      return points;
    }

    points.push({
      time: bar.time,
      value,
    });
    return points;
  }, []);

const buildLineStudy = (
  key: string,
  chartBars: ChartBar[],
  values: number[],
  options: Record<string, unknown>,
): StudySpec => ({
  key,
  seriesType: "line",
  paneIndex: 0,
  options,
  data: buildStudyData(chartBars, values),
});

const buildMarker = (
  id: string,
  bar: ChartBar,
  barIndex: number,
  position: ChartMarker["position"],
  shape: ChartMarker["shape"],
  color: string,
  text?: string,
): ChartMarker => ({
  id,
  time: bar.time,
  barIndex,
  position,
  shape,
  color,
  text,
  size: 1,
});

const buildEvent = (
  id: string,
  bar: ChartBar,
  barIndex: number,
  eventType: string,
  direction: "long" | "short",
  label: string,
): IndicatorEvent => ({
  id,
  strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
  eventType,
  ts: bar.ts,
  time: bar.time,
  barIndex,
  direction,
  label,
});

const computeSma = (values: number[], period: number): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 0) {
    return result;
  }

  let rollingSum = 0;
  let validCount = 0;

  values.forEach((value, index) => {
    if (Number.isFinite(value)) {
      rollingSum += value;
      validCount += 1;
    }

    if (index >= period) {
      const dropped = values[index - period];
      if (Number.isFinite(dropped)) {
        rollingSum -= dropped;
        validCount -= 1;
      }
    }

    if (index >= period - 1 && validCount === period) {
      result[index] = Number((rollingSum / period).toFixed(6));
    }
  });

  return result;
};

const computeWma = (values: number[], period: number): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 0) {
    return result;
  }

  const denominator = (period * (period + 1)) / 2;
  for (let index = period - 1; index < values.length; index += 1) {
    let weightedSum = 0;
    let valid = true;

    for (let offset = 0; offset < period; offset += 1) {
      const value = values[index - period + 1 + offset];
      if (!Number.isFinite(value)) {
        valid = false;
        break;
      }

      weightedSum += value * (offset + 1);
    }

    if (valid) {
      result[index] = Number((weightedSum / denominator).toFixed(6));
    }
  }

  return result;
};

const computeStandardDeviation = (
  values: number[],
  period: number,
): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 0) {
    return result;
  }

  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    if (window.some((value) => !Number.isFinite(value))) {
      continue;
    }

    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    result[index] = Number(Math.sqrt(variance).toFixed(6));
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
    atr = (atr * (period - 1) + trueRange[index]) / period;
    result[index] = Number(atr.toFixed(6));
  }

  return result;
};

const resolveDayKey = (bar: ChartBar): string =>
  new Date(bar.time * 1000).toISOString().slice(0, 10);

const resolveIsoWeekKey = (bar: ChartBar): string => {
  const value = new Date(bar.time * 1000);
  const utcDay = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - utcDay);
  value.setUTCHours(0, 0, 0, 0);
  return value.toISOString().slice(0, 10);
};

const buildSessionKeyLevelSeries = (
  chartBars: ChartBar[],
): {
  pdh: number[];
  pdl: number[];
  pdc: number[];
  todayOpen: number[];
  pwh: number[];
  pwl: number[];
} => {
  const dayStats = new Map<
    string,
    { open: number; high: number; low: number; close: number }
  >();
  const weekStats = new Map<string, { high: number; low: number }>();
  const orderedDayKeys: string[] = [];
  const orderedWeekKeys: string[] = [];

  chartBars.forEach((bar) => {
    const dayKey = resolveDayKey(bar);
    if (!dayStats.has(dayKey)) {
      orderedDayKeys.push(dayKey);
      dayStats.set(dayKey, {
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
      });
    } else {
      const current = dayStats.get(dayKey);
      if (current) {
        current.high = Math.max(current.high, bar.h);
        current.low = Math.min(current.low, bar.l);
        current.close = bar.c;
      }
    }

    const weekKey = resolveIsoWeekKey(bar);
    if (!weekStats.has(weekKey)) {
      orderedWeekKeys.push(weekKey);
      weekStats.set(weekKey, { high: bar.h, low: bar.l });
    } else {
      const current = weekStats.get(weekKey);
      if (current) {
        current.high = Math.max(current.high, bar.h);
        current.low = Math.min(current.low, bar.l);
      }
    }
  });

  const previousDayStats = new Map<
    string,
    { open: number; high: number; low: number; close: number } | null
  >();
  let lastDay: {
    open: number;
    high: number;
    low: number;
    close: number;
  } | null = null;
  orderedDayKeys.forEach((key) => {
    previousDayStats.set(key, lastDay);
    lastDay = dayStats.get(key) ?? null;
  });

  const previousWeekStats = new Map<
    string,
    { high: number; low: number } | null
  >();
  let lastWeek: { high: number; low: number } | null = null;
  orderedWeekKeys.forEach((key) => {
    previousWeekStats.set(key, lastWeek);
    lastWeek = weekStats.get(key) ?? null;
  });

  return chartBars.reduce(
    (series, bar, index) => {
      const dayKey = resolveDayKey(bar);
      const day = dayStats.get(dayKey) ?? null;
      const previousDay = previousDayStats.get(dayKey) ?? null;
      const weekKey = resolveIsoWeekKey(bar);
      const previousWeek = previousWeekStats.get(weekKey) ?? null;

      series.pdh[index] = previousDay?.high ?? Number.NaN;
      series.pdl[index] = previousDay?.low ?? Number.NaN;
      series.pdc[index] = previousDay?.close ?? Number.NaN;
      series.todayOpen[index] = day?.open ?? Number.NaN;
      series.pwh[index] = previousWeek?.high ?? Number.NaN;
      series.pwl[index] = previousWeek?.low ?? Number.NaN;
      return series;
    },
    {
      pdh: new Array<number>(chartBars.length).fill(Number.NaN),
      pdl: new Array<number>(chartBars.length).fill(Number.NaN),
      pdc: new Array<number>(chartBars.length).fill(Number.NaN),
      todayOpen: new Array<number>(chartBars.length).fill(Number.NaN),
      pwh: new Array<number>(chartBars.length).fill(Number.NaN),
      pwl: new Array<number>(chartBars.length).fill(Number.NaN),
    },
  );
};

const resolvePivotHigh = (
  chartBars: ChartBar[],
  pivotIndex: number,
  strength: number,
): number | null => {
  if (pivotIndex - strength < 0 || pivotIndex + strength >= chartBars.length) {
    return null;
  }

  const pivotValue = chartBars[pivotIndex]?.h;
  if (!Number.isFinite(pivotValue)) {
    return null;
  }

  for (
    let index = pivotIndex - strength;
    index <= pivotIndex + strength;
    index += 1
  ) {
    if (index === pivotIndex) {
      continue;
    }

    if ((chartBars[index]?.h ?? Number.NEGATIVE_INFINITY) > pivotValue) {
      return null;
    }
  }

  return pivotValue;
};

const resolvePivotLow = (
  chartBars: ChartBar[],
  pivotIndex: number,
  strength: number,
): number | null => {
  if (pivotIndex - strength < 0 || pivotIndex + strength >= chartBars.length) {
    return null;
  }

  const pivotValue = chartBars[pivotIndex]?.l;
  if (!Number.isFinite(pivotValue)) {
    return null;
  }

  for (
    let index = pivotIndex - strength;
    index <= pivotIndex + strength;
    index += 1
  ) {
    if (index === pivotIndex) {
      continue;
    }

    if ((chartBars[index]?.l ?? Number.POSITIVE_INFINITY) < pivotValue) {
      return null;
    }
  }

  return pivotValue;
};

const pushStructureZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  structure: StructureRecord,
) => {
  const startBar = chartBars[structure.sourceBarIndex];
  const endBar = chartBars[structure.eventBarIndex];
  if (!startBar || !endBar) {
    return;
  }

  zones.push({
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-${structure.kind}-${zones.length}`,
    strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
    zoneType: structure.kind,
    direction: structure.direction,
    startTs: startBar.ts,
    endTs: endBar.ts,
    startBarIndex: structure.sourceBarIndex,
    endBarIndex: structure.eventBarIndex,
    top: structure.sourcePrice,
    bottom: structure.sourcePrice,
    label: structure.label,
    meta: {
      style: "structure-line",
    },
  });
};

const pushTrendReversalZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  startBarIndex: number | null,
  price: number | null,
  direction: "long" | "short",
  signalLengthBars: number,
) => {
  if (startBarIndex == null || price == null || !Number.isFinite(price)) {
    return;
  }

  const startBar = chartBars[startBarIndex];
  const endIndex = Math.min(
    chartBars.length - 1,
    startBarIndex + signalLengthBars,
  );
  const endBar = chartBars[endIndex];
  if (!startBar || !endBar) {
    return;
  }

  const resolvedPrice = price;
  zones.push({
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-trend-reversal-${zones.length}`,
    strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
    zoneType: "trend-reversal",
    direction,
    startTs: startBar.ts,
    endTs: endBar.ts,
    startBarIndex,
    endBarIndex: endIndex,
    top: resolvedPrice,
    bottom: resolvedPrice,
    label: "Trend Reversal",
    meta: {
      style: "trend-reversal",
    },
  });
};

const buildRegimeWindows = (
  chartBars: ChartBar[],
  regimeDirection: number[],
): IndicatorWindow[] => {
  const windows: IndicatorWindow[] = [];
  if (!chartBars.length) {
    return windows;
  }

  let segmentStart = 0;
  let currentDirection = regimeDirection[0] >= 0 ? 1 : -1;

  for (let index = 1; index < chartBars.length; index += 1) {
    const direction = regimeDirection[index] >= 0 ? 1 : -1;
    if (direction === currentDirection) {
      continue;
    }

    windows.push({
      id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-regime-${windows.length}`,
      strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
      direction: currentDirection === 1 ? "long" : "short",
      startTs: chartBars[segmentStart].ts,
      endTs: chartBars[index - 1].ts,
      startBarIndex: segmentStart,
      endBarIndex: index - 1,
      tone: currentDirection === 1 ? "bullish" : "bearish",
      meta: {
        label: currentDirection === 1 ? "Bullish Regime" : "Bearish Regime",
      },
    });
    segmentStart = index;
    currentDirection = direction;
  }

  windows.push({
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-regime-${windows.length}`,
    strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
    direction: currentDirection === 1 ? "long" : "short",
    startTs: chartBars[segmentStart].ts,
    endTs: chartBars[chartBars.length - 1].ts,
    startBarIndex: segmentStart,
    endBarIndex: chartBars.length - 1,
    tone: currentDirection === 1 ? "bullish" : "bearish",
    meta: {
      label: currentDirection === 1 ? "Bullish Regime" : "Bearish Regime",
    },
  });

  return windows;
};

export function createRayReplicaPineRuntimeAdapter(
  script: PineScriptRecord,
): IndicatorPlugin {
  return {
    id: script.scriptKey,
    compute({ chartBars }): IndicatorPluginOutput {
      if (!chartBars.length) {
        return {};
      }

      const closes = chartBars.map((bar) => bar.c);
      const basis = computeWma(closes, BASIS_LENGTH);
      const atrRaw = computeAtr(chartBars, ATR_LENGTH);
      const atrSmoothed = computeSma(atrRaw, ATR_SMOOTHING);
      const upperBand = basis.map((value, index) =>
        Number.isFinite(value) && Number.isFinite(atrSmoothed[index])
          ? Number(
              (value + atrSmoothed[index] * VOLATILITY_MULTIPLIER).toFixed(6),
            )
          : Number.NaN,
      );
      const lowerBand = basis.map((value, index) =>
        Number.isFinite(value) && Number.isFinite(atrSmoothed[index])
          ? Number(
              (value - atrSmoothed[index] * VOLATILITY_MULTIPLIER).toFixed(6),
            )
          : Number.NaN,
      );
      const bbMid = computeSma(closes, SHADOW_LENGTH);
      const bbDev = computeStandardDeviation(closes, SHADOW_LENGTH).map(
        (value) =>
          Number.isFinite(value)
            ? Number((value * SHADOW_STD_DEV).toFixed(6))
            : Number.NaN,
      );
      const bbUpper = bbMid.map((value, index) =>
        Number.isFinite(value) && Number.isFinite(bbDev[index])
          ? Number((value + bbDev[index]).toFixed(6))
          : Number.NaN,
      );
      const bbLower = bbMid.map((value, index) =>
        Number.isFinite(value) && Number.isFinite(bbDev[index])
          ? Number((value - bbDev[index]).toFixed(6))
          : Number.NaN,
      );

      const markers: ChartMarker[] = [];
      const events: IndicatorEvent[] = [];
      const zones: IndicatorZone[] = [];
      const barStyleByIndex = new Array<ChartBarStyle | null>(
        chartBars.length,
      ).fill(null);
      const regimeDirection = new Array<number>(chartBars.length).fill(1);
      const bullMain = new Array<number>(chartBars.length).fill(Number.NaN);
      const bearMain = new Array<number>(chartBars.length).fill(Number.NaN);
      const bullWires = Array.from({ length: 3 }, () =>
        new Array<number>(chartBars.length).fill(Number.NaN),
      );
      const bearWires = Array.from({ length: 3 }, () =>
        new Array<number>(chartBars.length).fill(Number.NaN),
      );

      let trendDirection = 1;
      let marketStructureDirection = 0;
      let lastSwingHigh = Number.NaN;
      let previousSwingHigh = Number.NaN;
      let lastSwingHighBarIndex: number | null = null;
      let lastSwingLow = Number.NaN;
      let previousSwingLow = Number.NaN;
      let lastSwingLowBarIndex: number | null = null;
      let breakableHigh = Number.NaN;
      let breakableHighBarIndex: number | null = null;
      let breakableLow = Number.NaN;
      let breakableLowBarIndex: number | null = null;
      const activeBullOrderBlocks: ActiveOrderBlock[] = [];
      const activeBearOrderBlocks: ActiveOrderBlock[] = [];

      for (let index = 0; index < chartBars.length; index += 1) {
        if (
          index >= 5 &&
          Number.isFinite(basis[index]) &&
          Number.isFinite(basis[index - 5])
        ) {
          if (basis[index] > basis[index - 5]) {
            trendDirection = 1;
          } else if (basis[index] < basis[index - 5]) {
            trendDirection = -1;
          }
        }

        const pivotIndex = index - TIME_HORIZON;
        if (pivotIndex >= TIME_HORIZON) {
          const pivotHigh = resolvePivotHigh(
            chartBars,
            pivotIndex,
            TIME_HORIZON,
          );
          if (pivotHigh != null) {
            const resolvedPivotHigh = pivotHigh;
            previousSwingHigh = lastSwingHigh;
            lastSwingHigh = resolvedPivotHigh;
            lastSwingHighBarIndex = pivotIndex;
            breakableHigh = resolvedPivotHigh;
            breakableHighBarIndex = pivotIndex;

            const bar = chartBars[pivotIndex];
            if (bar) {
              const label =
                Number.isFinite(previousSwingHigh) &&
                resolvedPivotHigh > previousSwingHigh
                  ? "HH"
                  : "LH";
              markers.push(
                buildMarker(
                  `${script.scriptKey}-swing-high-${pivotIndex}`,
                  bar,
                  pivotIndex,
                  "aboveBar",
                  "circle",
                  "#94a3b8",
                  label,
                ),
              );
            }
          }

          const pivotLow = resolvePivotLow(chartBars, pivotIndex, TIME_HORIZON);
          if (pivotLow != null) {
            const resolvedPivotLow = pivotLow;
            previousSwingLow = lastSwingLow;
            lastSwingLow = resolvedPivotLow;
            lastSwingLowBarIndex = pivotIndex;
            breakableLow = resolvedPivotLow;
            breakableLowBarIndex = pivotIndex;

            const bar = chartBars[pivotIndex];
            if (bar) {
              const label =
                Number.isFinite(previousSwingLow) &&
                resolvedPivotLow > previousSwingLow
                  ? "HL"
                  : "LL";
              markers.push(
                buildMarker(
                  `${script.scriptKey}-swing-low-${pivotIndex}`,
                  bar,
                  pivotIndex,
                  "belowBar",
                  "circle",
                  "#94a3b8",
                  label,
                ),
              );
            }
          }
        }

        let bullishBos = false;
        let bearishBos = false;
        let bullishChoch = false;
        let bearishChoch = false;
        let reversalAnchorBarIndex: number | null = null;
        let reversalAnchorPrice: number | null = null;
        let reversalDirection: "long" | "short" | null = null;

        if (
          Number.isFinite(breakableHigh) &&
          chartBars[index].c > breakableHigh
        ) {
          if (marketStructureDirection === 1) {
            bullishBos = true;
          } else {
            bullishChoch = true;
            reversalAnchorPrice = Number.isFinite(breakableLow)
              ? breakableLow
              : lastSwingLow;
            reversalAnchorBarIndex =
              breakableLowBarIndex ?? lastSwingLowBarIndex;
            reversalDirection = "long";
            marketStructureDirection = 1;
          }

          breakableHigh = Number.NaN;
          breakableHighBarIndex = null;
        }

        if (
          Number.isFinite(breakableLow) &&
          chartBars[index].c < breakableLow
        ) {
          if (marketStructureDirection === -1) {
            bearishBos = true;
          } else {
            bearishChoch = true;
            reversalAnchorPrice = Number.isFinite(breakableHigh)
              ? breakableHigh
              : lastSwingHigh;
            reversalAnchorBarIndex =
              breakableHighBarIndex ?? lastSwingHighBarIndex;
            reversalDirection = "short";
            marketStructureDirection = -1;
          }

          breakableLow = Number.NaN;
          breakableLowBarIndex = null;
        }

        const activeRegimeDirection =
          marketStructureDirection !== 0
            ? marketStructureDirection
            : trendDirection;
        regimeDirection[index] = activeRegimeDirection;

        if (
          bullishBos &&
          lastSwingHighBarIndex != null &&
          Number.isFinite(lastSwingHigh)
        ) {
          pushStructureZone(zones, chartBars, {
            kind: "bos",
            direction: "long",
            sourceBarIndex: lastSwingHighBarIndex,
            sourcePrice: lastSwingHigh,
            eventBarIndex: index,
            label: "BOS",
          });
        }

        if (
          bearishBos &&
          lastSwingLowBarIndex != null &&
          Number.isFinite(lastSwingLow)
        ) {
          pushStructureZone(zones, chartBars, {
            kind: "bos",
            direction: "short",
            sourceBarIndex: lastSwingLowBarIndex,
            sourcePrice: lastSwingLow,
            eventBarIndex: index,
            label: "BOS",
          });
        }

        if (
          bullishChoch &&
          lastSwingHighBarIndex != null &&
          Number.isFinite(lastSwingHigh)
        ) {
          pushStructureZone(zones, chartBars, {
            kind: "choch",
            direction: "long",
            sourceBarIndex: lastSwingHighBarIndex,
            sourcePrice: lastSwingHigh,
            eventBarIndex: index,
            label: "CHOCH",
          });
        }

        if (
          bearishChoch &&
          lastSwingLowBarIndex != null &&
          Number.isFinite(lastSwingLow)
        ) {
          pushStructureZone(zones, chartBars, {
            kind: "choch",
            direction: "short",
            sourceBarIndex: lastSwingLowBarIndex,
            sourcePrice: lastSwingLow,
            eventBarIndex: index,
            label: "CHOCH",
          });
        }

        if (reversalDirection) {
          pushTrendReversalZone(
            zones,
            chartBars,
            reversalAnchorBarIndex,
            reversalAnchorPrice,
            reversalDirection,
            30,
          );
        }

        if (bullishBos || bullishChoch) {
          markers.push(
            buildMarker(
              `${script.scriptKey}-${bullishBos ? "bos" : "choch"}-long-${index}`,
              chartBars[index],
              index,
              "belowBar",
              bullishBos ? "arrowUp" : "square",
              BULL_COLOR,
              bullishBos ? "BOS" : "BUY",
            ),
          );
          events.push(
            buildEvent(
              `${script.scriptKey}-${bullishBos ? "bos" : "choch"}-event-long-${index}`,
              chartBars[index],
              index,
              bullishBos ? "bullish_bos" : "bullish_choch",
              "long",
              bullishBos ? "BOS" : "BUY",
            ),
          );
        }

        if (bearishBos || bearishChoch) {
          markers.push(
            buildMarker(
              `${script.scriptKey}-${bearishBos ? "bos" : "choch"}-short-${index}`,
              chartBars[index],
              index,
              "aboveBar",
              bearishBos ? "arrowDown" : "square",
              BEAR_COLOR,
              bearishBos ? "BOS" : "SELL",
            ),
          );
          events.push(
            buildEvent(
              `${script.scriptKey}-${bearishBos ? "bos" : "choch"}-event-short-${index}`,
              chartBars[index],
              index,
              bearishBos ? "bearish_bos" : "bearish_choch",
              "short",
              bearishBos ? "BOS" : "SELL",
            ),
          );
        }

        if (
          (bullishBos || bullishChoch) &&
          lastSwingLowBarIndex != null &&
          chartBars[lastSwingLowBarIndex]
        ) {
          activeBullOrderBlocks.push({
            id: `${script.scriptKey}-bull-ob-${index}`,
            direction: "long",
            startBarIndex: lastSwingLowBarIndex,
            endBarIndex: index,
            top: chartBars[lastSwingLowBarIndex].h,
            bottom: chartBars[lastSwingLowBarIndex].l,
            label: "BULL OB",
          });
          while (activeBullOrderBlocks.length > 5) {
            activeBullOrderBlocks.shift();
          }
        }

        if (
          (bearishBos || bearishChoch) &&
          lastSwingHighBarIndex != null &&
          chartBars[lastSwingHighBarIndex]
        ) {
          activeBearOrderBlocks.push({
            id: `${script.scriptKey}-bear-ob-${index}`,
            direction: "short",
            startBarIndex: lastSwingHighBarIndex,
            endBarIndex: index,
            top: chartBars[lastSwingHighBarIndex].h,
            bottom: chartBars[lastSwingHighBarIndex].l,
            label: "BEAR OB",
          });
          while (activeBearOrderBlocks.length > 5) {
            activeBearOrderBlocks.shift();
          }
        }

        for (
          let orderBlockIndex = activeBullOrderBlocks.length - 1;
          orderBlockIndex >= 0;
          orderBlockIndex -= 1
        ) {
          const orderBlock = activeBullOrderBlocks[orderBlockIndex];
          orderBlock.endBarIndex = index;
          if (chartBars[index].c < orderBlock.bottom) {
            activeBullOrderBlocks.splice(orderBlockIndex, 1);
          }
        }

        for (
          let orderBlockIndex = activeBearOrderBlocks.length - 1;
          orderBlockIndex >= 0;
          orderBlockIndex -= 1
        ) {
          const orderBlock = activeBearOrderBlocks[orderBlockIndex];
          orderBlock.endBarIndex = index;
          if (chartBars[index].c > orderBlock.top) {
            activeBearOrderBlocks.splice(orderBlockIndex, 1);
          }
        }

        const trendLine =
          activeRegimeDirection === 1 ? lowerBand[index] : upperBand[index];
        const reaction =
          Number.isFinite(trendLine) &&
          chartBars[index].l <= trendLine &&
          chartBars[index].h >= trendLine;

        const wireDirection = activeRegimeDirection === 1 ? -1 : 1;
        const wireStep = Number.isFinite(atrSmoothed[index])
          ? atrSmoothed[index] * WIRE_SPREAD
          : Number.NaN;
        if (activeRegimeDirection === 1 && Number.isFinite(lowerBand[index])) {
          bullMain[index] = lowerBand[index];
          if (Number.isFinite(wireStep)) {
            bullWires[0][index] = Number(
              (trendLine + wireDirection * wireStep).toFixed(6),
            );
            bullWires[1][index] = Number(
              (trendLine + wireDirection * wireStep * 2).toFixed(6),
            );
            bullWires[2][index] = Number(
              (trendLine + wireDirection * wireStep * 3).toFixed(6),
            );
          }
        } else if (
          activeRegimeDirection === -1 &&
          Number.isFinite(upperBand[index])
        ) {
          bearMain[index] = upperBand[index];
          if (Number.isFinite(wireStep)) {
            bearWires[0][index] = Number(
              (trendLine + wireDirection * wireStep).toFixed(6),
            );
            bearWires[1][index] = Number(
              (trendLine + wireDirection * wireStep * 2).toFixed(6),
            );
            bearWires[2][index] = Number(
              (trendLine + wireDirection * wireStep * 3).toFixed(6),
            );
          }
        }

        const candleColor = reaction
          ? REACTION_COLOR
          : activeRegimeDirection === 1
            ? BULL_COLOR
            : BEAR_COLOR;
        barStyleByIndex[index] = {
          color: candleColor,
          borderColor: candleColor,
          wickColor: candleColor,
        };
      }

      activeBullOrderBlocks.forEach((orderBlock, index) => {
        const startBar = chartBars[orderBlock.startBarIndex];
        const endBar = chartBars[orderBlock.endBarIndex];
        if (!startBar || !endBar) {
          return;
        }

        zones.push({
          id: `${orderBlock.id}-${index}`,
          strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
          zoneType: "order-block",
          direction: orderBlock.direction,
          startTs: startBar.ts,
          endTs: endBar.ts,
          startBarIndex: orderBlock.startBarIndex,
          endBarIndex: orderBlock.endBarIndex,
          top: orderBlock.top,
          bottom: orderBlock.bottom,
          label: orderBlock.label,
        });
      });
      activeBearOrderBlocks.forEach((orderBlock, index) => {
        const startBar = chartBars[orderBlock.startBarIndex];
        const endBar = chartBars[orderBlock.endBarIndex];
        if (!startBar || !endBar) {
          return;
        }

        zones.push({
          id: `${orderBlock.id}-${index}`,
          strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
          zoneType: "order-block",
          direction: orderBlock.direction,
          startTs: startBar.ts,
          endTs: endBar.ts,
          startBarIndex: orderBlock.startBarIndex,
          endBarIndex: orderBlock.endBarIndex,
          top: orderBlock.top,
          bottom: orderBlock.bottom,
          label: orderBlock.label,
        });
      });

      const windows = buildRegimeWindows(chartBars, regimeDirection);
      const keyLevels = buildSessionKeyLevelSeries(chartBars);
      const studyPrefix = script.scriptKey;

      return {
        studySpecs: [
          buildLineStudy(`${studyPrefix}-bull-main`, chartBars, bullMain, {
            color: BULL_COLOR,
            lineWidth: 3,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
          buildLineStudy(`${studyPrefix}-bear-main`, chartBars, bearMain, {
            color: BEAR_COLOR,
            lineWidth: 3,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
          ...bullWires.map((values, index) =>
            buildLineStudy(
              `${studyPrefix}-bull-wire-${index + 1}`,
              chartBars,
              values,
              {
                color: `${BULL_COLOR}88`,
                lineWidth: 1,
                priceLineVisible: false,
                lastValueVisible: false,
              },
            ),
          ),
          ...bearWires.map((values, index) =>
            buildLineStudy(
              `${studyPrefix}-bear-wire-${index + 1}`,
              chartBars,
              values,
              {
                color: `${BEAR_COLOR}88`,
                lineWidth: 1,
                priceLineVisible: false,
                lastValueVisible: false,
              },
            ),
          ),
          buildLineStudy(`${studyPrefix}-shadow-upper`, chartBars, bbUpper, {
            color: `${SHADOW_COLOR}55`,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
          buildLineStudy(`${studyPrefix}-shadow-lower`, chartBars, bbLower, {
            color: `${SHADOW_COLOR}55`,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
          buildLineStudy(`${studyPrefix}-pdh`, chartBars, keyLevels.pdh, {
            color: KEY_LEVEL_HIGH_COLOR,
            lineWidth: 1,
            lineStyle: KEY_LEVEL_LINE_STYLE,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
          buildLineStudy(`${studyPrefix}-pdl`, chartBars, keyLevels.pdl, {
            color: KEY_LEVEL_LOW_COLOR,
            lineWidth: 1,
            lineStyle: KEY_LEVEL_LINE_STYLE,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
          buildLineStudy(`${studyPrefix}-pdc`, chartBars, keyLevels.pdc, {
            color: KEY_LEVEL_CLOSE_COLOR,
            lineWidth: 1,
            lineStyle: KEY_LEVEL_LINE_STYLE,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
          buildLineStudy(
            `${studyPrefix}-open`,
            chartBars,
            keyLevels.todayOpen,
            {
              color: KEY_LEVEL_OPEN_COLOR,
              lineWidth: 1,
              lineStyle: KEY_LEVEL_LINE_STYLE,
              priceLineVisible: false,
              lastValueVisible: false,
            },
          ),
          buildLineStudy(`${studyPrefix}-pwh`, chartBars, keyLevels.pwh, {
            color: KEY_LEVEL_HIGH_COLOR,
            lineWidth: 1,
            lineStyle: KEY_LEVEL_LINE_STYLE,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
          buildLineStudy(`${studyPrefix}-pwl`, chartBars, keyLevels.pwl, {
            color: KEY_LEVEL_LOW_COLOR,
            lineWidth: 1,
            lineStyle: KEY_LEVEL_LINE_STYLE,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
        ],
        markers,
        events,
        zones,
        windows,
        barStyleByIndex,
      };
    },
  };
}
