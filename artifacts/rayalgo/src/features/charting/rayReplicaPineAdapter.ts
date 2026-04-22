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

export type RayReplicaRuntimeSettings = {
  timeHorizon: number;
  basisLength: number;
  atrLength: number;
  atrSmoothing: number;
  volatilityMultiplier: number;
  wireSpread: number;
  shadowLength: number;
  shadowStdDev: number;
  showWires: boolean;
  showShadow: boolean;
  showKeyLevels: boolean;
  showStructure: boolean;
  showOrderBlocks: boolean;
  showSupportResistance: boolean;
  showTpSl: boolean;
  showRegimeWindows: boolean;
  colorCandles: boolean;
};

export const DEFAULT_RAY_REPLICA_SETTINGS: RayReplicaRuntimeSettings = {
  timeHorizon: 10,
  basisLength: 80,
  atrLength: 14,
  atrSmoothing: 21,
  volatilityMultiplier: 2,
  wireSpread: 0.5,
  shadowLength: 20,
  shadowStdDev: 2,
  showWires: true,
  showShadow: true,
  showKeyLevels: true,
  showStructure: true,
  showOrderBlocks: true,
  showSupportResistance: false,
  showTpSl: true,
  showRegimeWindows: true,
  colorCandles: true,
};

const BULL_COLOR = "#00bcd4";
const BEAR_COLOR = "#e91e63";
const SHADOW_COLOR = "#787b86";
const REACTION_COLOR = "#facc15";
const KEY_LEVEL_HIGH_COLOR = "#ef5350";
const KEY_LEVEL_LOW_COLOR = "#26a69a";
const KEY_LEVEL_CLOSE_COLOR = "#9ca3af";
const KEY_LEVEL_OPEN_COLOR = "#facc15";
const ORDER_BLOCK_BULL_COLOR = "#00bcd433";
const ORDER_BLOCK_BEAR_COLOR = "#e91e6333";
const SUPPORT_ZONE_COLOR = "#00bcd440";
const RESISTANCE_ZONE_COLOR = "#e91e6340";
const STOP_LOSS_COLOR = "#ef4444";
const TAKE_PROFIT_COLOR = "#22c55e";
const SHADOW_FILL_COLOR = "#787b8618";
const STRUCTURE_LINE_STYLE = "solid";
const TREND_REVERSAL_LINE_STYLE = "dashed";
const KEY_LEVEL_LINE_STYLE_NAME = "dashed";
const TP_SL_LINE_STYLE = "dashed";
const KEY_LEVEL_LABEL_OFFSET_BARS = 8;
const SUPPORT_RESISTANCE_PIVOT_STRENGTH = 15;
const SUPPORT_RESISTANCE_MIN_ZONE_DISTANCE_PERCENT = 0.05;
const SUPPORT_RESISTANCE_THICKNESS_MULTIPLIER = 0.25;
const SUPPORT_RESISTANCE_MAX_ZONES = 7;
const SUPPORT_RESISTANCE_EXTENSION_BARS = 100;
const TP_RR_1 = 0.5;
const TP_RR_2 = 1;
const TP_RR_3 = 1.7;

const resolveIntegerSetting = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(resolved)));
};

const resolveFloatSetting = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, resolved));
};

const resolveBooleanSetting = (
  value: unknown,
  fallback: boolean,
): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
};

const withHexAlpha = (color: string, alpha: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;

const formatOverlayPrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const fixed = value.toFixed(Math.abs(value) >= 100 ? 2 : 4);
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

const formatCompactVolume = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "")}B`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(2).replace(/\.?0+$/, "")}K`;
  }

  return value.toFixed(0);
};

export function resolveRayReplicaRuntimeSettings(
  settings?: Record<string, unknown>,
): RayReplicaRuntimeSettings {
  const input = settings ?? {};

  return {
    timeHorizon: resolveIntegerSetting(
      input.timeHorizon,
      DEFAULT_RAY_REPLICA_SETTINGS.timeHorizon,
      3,
      40,
    ),
    basisLength: resolveIntegerSetting(
      input.basisLength,
      DEFAULT_RAY_REPLICA_SETTINGS.basisLength,
      10,
      240,
    ),
    atrLength: resolveIntegerSetting(
      input.atrLength,
      DEFAULT_RAY_REPLICA_SETTINGS.atrLength,
      2,
      100,
    ),
    atrSmoothing: resolveIntegerSetting(
      input.atrSmoothing,
      DEFAULT_RAY_REPLICA_SETTINGS.atrSmoothing,
      2,
      200,
    ),
    volatilityMultiplier: resolveFloatSetting(
      input.volatilityMultiplier,
      DEFAULT_RAY_REPLICA_SETTINGS.volatilityMultiplier,
      0.25,
      10,
    ),
    wireSpread: resolveFloatSetting(
      input.wireSpread,
      DEFAULT_RAY_REPLICA_SETTINGS.wireSpread,
      0.05,
      5,
    ),
    shadowLength: resolveIntegerSetting(
      input.shadowLength,
      DEFAULT_RAY_REPLICA_SETTINGS.shadowLength,
      5,
      120,
    ),
    shadowStdDev: resolveFloatSetting(
      input.shadowStdDev,
      DEFAULT_RAY_REPLICA_SETTINGS.shadowStdDev,
      0.25,
      6,
    ),
    showWires: resolveBooleanSetting(
      input.showWires,
      DEFAULT_RAY_REPLICA_SETTINGS.showWires,
    ),
    showShadow: resolveBooleanSetting(
      input.showShadow,
      DEFAULT_RAY_REPLICA_SETTINGS.showShadow,
    ),
    showKeyLevels: resolveBooleanSetting(
      input.showKeyLevels,
      DEFAULT_RAY_REPLICA_SETTINGS.showKeyLevels,
    ),
    showStructure: resolveBooleanSetting(
      input.showStructure,
      DEFAULT_RAY_REPLICA_SETTINGS.showStructure,
    ),
    showOrderBlocks: resolveBooleanSetting(
      input.showOrderBlocks,
      DEFAULT_RAY_REPLICA_SETTINGS.showOrderBlocks,
    ),
    showSupportResistance: resolveBooleanSetting(
      input.showSupportResistance,
      DEFAULT_RAY_REPLICA_SETTINGS.showSupportResistance,
    ),
    showTpSl: resolveBooleanSetting(
      input.showTpSl,
      DEFAULT_RAY_REPLICA_SETTINGS.showTpSl,
    ),
    showRegimeWindows: resolveBooleanSetting(
      input.showRegimeWindows,
      DEFAULT_RAY_REPLICA_SETTINGS.showRegimeWindows,
    ),
    colorCandles: resolveBooleanSetting(
      input.colorCandles,
      DEFAULT_RAY_REPLICA_SETTINGS.colorCandles,
    ),
  };
}

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

type SupportResistanceZone = {
  id: string;
  direction: "long" | "short";
  startBarIndex: number;
  endBarIndex: number;
  extendBars: number;
  top: number;
  bottom: number;
  fillColor: string;
  borderColor: string;
};

type ActiveTpSlOverlay = {
  direction: "long" | "short";
  startBarIndex: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
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
  dayStartBarIndex: number[];
  weekStartBarIndex: number[];
} => {
  const dayStats = new Map<
    string,
    { open: number; high: number; low: number; close: number }
  >();
  const weekStats = new Map<string, { high: number; low: number }>();
  const orderedDayKeys: string[] = [];
  const orderedWeekKeys: string[] = [];
  const dayStartBarIndexByKey = new Map<string, number>();
  const weekStartBarIndexByKey = new Map<string, number>();

  chartBars.forEach((bar, index) => {
    const dayKey = resolveDayKey(bar);
    if (!dayStats.has(dayKey)) {
      orderedDayKeys.push(dayKey);
      dayStartBarIndexByKey.set(dayKey, index);
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
      weekStartBarIndexByKey.set(weekKey, index);
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
      series.dayStartBarIndex[index] =
        dayStartBarIndexByKey.get(dayKey) ?? index;
      series.weekStartBarIndex[index] =
        weekStartBarIndexByKey.get(weekKey) ?? index;
      return series;
    },
    {
      pdh: new Array<number>(chartBars.length).fill(Number.NaN),
      pdl: new Array<number>(chartBars.length).fill(Number.NaN),
      pdc: new Array<number>(chartBars.length).fill(Number.NaN),
      todayOpen: new Array<number>(chartBars.length).fill(Number.NaN),
      pwh: new Array<number>(chartBars.length).fill(Number.NaN),
      pwl: new Array<number>(chartBars.length).fill(Number.NaN),
      dayStartBarIndex: new Array<number>(chartBars.length).fill(0),
      weekStartBarIndex: new Array<number>(chartBars.length).fill(0),
    },
  );
};

const pushFilledBarZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  barIndex: number,
  top: number,
  bottom: number,
  fillColor: string,
) => {
  const bar = chartBars[barIndex];
  if (
    !bar ||
    !Number.isFinite(top) ||
    !Number.isFinite(bottom) ||
    top === bottom
  ) {
    return;
  }

  zones.push({
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-fill-${zones.length}`,
    strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
    zoneType: "fill-band",
    startTs: bar.ts,
    endTs: bar.ts,
    startBarIndex: barIndex,
    endBarIndex: barIndex,
    top: Math.max(top, bottom),
    bottom: Math.min(top, bottom),
    meta: {
      style: "fill-band",
      fillColor,
      borderVisible: false,
    },
  });
};

const pushLabeledLineZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  {
    id,
    zoneType,
    direction,
    startBarIndex,
    endBarIndex,
    price,
    label,
    lineColor,
    lineStyle,
    labelPosition = "center",
    labelFillColor,
    labelColor = "#ffffff",
    labelOffsetBars = 0,
    extendBars = 0,
  }: {
    id: string;
    zoneType: string;
    direction?: "long" | "short";
    startBarIndex: number;
    endBarIndex: number;
    price: number;
    label?: string;
    lineColor: string;
    lineStyle: string;
    labelPosition?: string;
    labelFillColor?: string;
    labelColor?: string;
    labelOffsetBars?: number;
    extendBars?: number;
  },
) => {
  const startBar = chartBars[startBarIndex];
  const endBar = chartBars[endBarIndex];
  if (!startBar || !endBar || !Number.isFinite(price)) {
    return;
  }

  zones.push({
    id,
    strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
    zoneType,
    direction,
    startTs: startBar.ts,
    endTs: endBar.ts,
    startBarIndex,
    endBarIndex,
    top: price,
    bottom: price,
    label,
    meta: {
      style: "line-overlay",
      lineColor,
      lineStyle,
      labelPosition,
      labelFillColor,
      labelColor,
      labelOffsetBars,
      extendBars,
      borderWidth: 1,
    },
  });
};

const pushKeyLevelZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  {
    idSuffix,
    anchorBarIndex,
    lastBarIndex,
    price,
    label,
    color,
  }: {
    idSuffix: string;
    anchorBarIndex: number;
    lastBarIndex: number;
    price: number;
    label: string;
    color: string;
  },
) => {
  if (!Number.isFinite(price)) {
    return;
  }

  pushLabeledLineZone(zones, chartBars, {
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-${idSuffix}`,
    zoneType: "key-level",
    startBarIndex: anchorBarIndex,
    endBarIndex: lastBarIndex,
    price,
    label: `${label} ${formatOverlayPrice(price)}`,
    lineColor: color,
    lineStyle: KEY_LEVEL_LINE_STYLE_NAME,
    labelPosition: "right",
    labelFillColor: withHexAlpha(color, "b3"),
    labelOffsetBars: KEY_LEVEL_LABEL_OFFSET_BARS,
    extendBars: KEY_LEVEL_LABEL_OFFSET_BARS,
  });
};

const pushTpSlZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  {
    idSuffix,
    startBarIndex,
    lastBarIndex,
    price,
    label,
    color,
  }: {
    idSuffix: string;
    startBarIndex: number;
    lastBarIndex: number;
    price: number;
    label: string;
    color: string;
  },
) => {
  if (!Number.isFinite(price)) {
    return;
  }

  pushLabeledLineZone(zones, chartBars, {
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-${idSuffix}`,
    zoneType: "tp-sl",
    startBarIndex,
    endBarIndex: lastBarIndex,
    price,
    label,
    lineColor: color,
    lineStyle: TP_SL_LINE_STYLE,
    labelPosition: "right",
    labelFillColor: withHexAlpha(color, "bf"),
  });
};

const pushSupportResistanceZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  supportResistanceZone: SupportResistanceZone,
) => {
  const startBar = chartBars[supportResistanceZone.startBarIndex];
  const endBar = chartBars[supportResistanceZone.endBarIndex];
  if (!startBar || !endBar) {
    return;
  }

  zones.push({
    id: supportResistanceZone.id,
    strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
    zoneType: "support-resistance",
    direction: supportResistanceZone.direction,
    startTs: startBar.ts,
    endTs: endBar.ts,
    startBarIndex: supportResistanceZone.startBarIndex,
    endBarIndex: supportResistanceZone.endBarIndex,
    top: supportResistanceZone.top,
    bottom: supportResistanceZone.bottom,
    meta: {
      style: "support-resistance",
      fillColor: supportResistanceZone.fillColor,
      borderColor: supportResistanceZone.borderColor,
      extendBars: supportResistanceZone.extendBars,
      borderWidth: 1,
    },
  });
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
  pushLabeledLineZone(zones, chartBars, {
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-${structure.kind}-${zones.length}`,
    zoneType: structure.kind,
    direction: structure.direction,
    startBarIndex: structure.sourceBarIndex,
    endBarIndex: structure.eventBarIndex,
    price: structure.sourcePrice,
    label: structure.label,
    lineColor: structure.direction === "short" ? BEAR_COLOR : BULL_COLOR,
    lineStyle: STRUCTURE_LINE_STYLE,
    labelPosition: "center",
    labelFillColor: withHexAlpha(
      structure.direction === "short" ? BEAR_COLOR : BULL_COLOR,
      "66",
    ),
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

  const endIndex = Math.min(
    chartBars.length - 1,
    startBarIndex + signalLengthBars,
  );
  pushLabeledLineZone(zones, chartBars, {
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-trend-reversal-${zones.length}`,
    zoneType: "trend-reversal",
    direction,
    startBarIndex,
    endBarIndex: endIndex,
    price,
    label: "Trend Reversal",
    lineColor: "#ffffff",
    lineStyle: TREND_REVERSAL_LINE_STYLE,
    labelPosition: "center",
    labelFillColor: withHexAlpha(direction === "short" ? BEAR_COLOR : BULL_COLOR, "b3"),
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
        style: "background",
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
      style: "background",
    },
  });

  return windows;
};

export function createRayReplicaPineRuntimeAdapter(
  script: PineScriptRecord,
): IndicatorPlugin {
  return {
    id: script.scriptKey,
    compute({ chartBars, settings }): IndicatorPluginOutput {
      if (!chartBars.length) {
        return {};
      }

      const {
        timeHorizon,
        basisLength,
        atrLength,
        atrSmoothing,
        volatilityMultiplier,
        wireSpread,
        shadowLength,
        shadowStdDev,
        showWires,
        showShadow,
        showKeyLevels,
        showStructure,
        showOrderBlocks,
        showSupportResistance,
        showTpSl,
        showRegimeWindows,
        colorCandles,
      } = resolveRayReplicaRuntimeSettings(settings);
      const closes = chartBars.map((bar) => bar.c);
      const basis = computeWma(closes, basisLength);
      const atrRaw = computeAtr(chartBars, atrLength);
      const atrSmoothed = computeSma(atrRaw, atrSmoothing);
      const upperBand = basis.map((value, index) =>
        Number.isFinite(value) && Number.isFinite(atrSmoothed[index])
          ? Number(
              (value + atrSmoothed[index] * volatilityMultiplier).toFixed(6),
            )
          : Number.NaN,
      );
      const lowerBand = basis.map((value, index) =>
        Number.isFinite(value) && Number.isFinite(atrSmoothed[index])
          ? Number(
              (value - atrSmoothed[index] * volatilityMultiplier).toFixed(6),
            )
          : Number.NaN,
      );
      const bbMid = computeSma(closes, shadowLength);
      const bbDev = computeStandardDeviation(closes, shadowLength).map(
        (value) =>
          Number.isFinite(value)
            ? Number((value * shadowStdDev).toFixed(6))
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
      const fillZones: IndicatorZone[] = [];
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
      const supportResistanceZones: SupportResistanceZone[] = [];
      let activeTpSlOverlay: ActiveTpSlOverlay | null = null;

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

        const pivotIndex = index - timeHorizon;
        if (pivotIndex >= timeHorizon) {
          const pivotHigh = resolvePivotHigh(
            chartBars,
            pivotIndex,
            timeHorizon,
          );
          if (pivotHigh != null) {
            const resolvedPivotHigh = pivotHigh;
            previousSwingHigh = lastSwingHigh;
            lastSwingHigh = resolvedPivotHigh;
            lastSwingHighBarIndex = pivotIndex;
            breakableHigh = resolvedPivotHigh;
            breakableHighBarIndex = pivotIndex;

            const bar = chartBars[pivotIndex];
            if (bar && showStructure) {
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

          const pivotLow = resolvePivotLow(chartBars, pivotIndex, timeHorizon);
          if (pivotLow != null) {
            const resolvedPivotLow = pivotLow;
            previousSwingLow = lastSwingLow;
            lastSwingLow = resolvedPivotLow;
            lastSwingLowBarIndex = pivotIndex;
            breakableLow = resolvedPivotLow;
            breakableLowBarIndex = pivotIndex;

            const bar = chartBars[pivotIndex];
            if (bar && showStructure) {
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

        if (showSupportResistance) {
          const supportResistancePivotIndex =
            index - SUPPORT_RESISTANCE_PIVOT_STRENGTH;
          if (supportResistancePivotIndex >= SUPPORT_RESISTANCE_PIVOT_STRENGTH) {
            const currentClose = chartBars[index]?.c ?? Number.NaN;
            const currentAtr = atrRaw[index];
            const thickness = Number.isFinite(currentAtr)
              ? currentAtr * SUPPORT_RESISTANCE_THICKNESS_MULTIPLIER
              : Number.NaN;

            const isTooCloseToExistingZone = (price: number) =>
              supportResistanceZones.some((zone) => {
                const midpoint = (zone.top + zone.bottom) / 2;
                return (
                  Number.isFinite(currentClose) &&
                  currentClose !== 0 &&
                  Math.abs(price - midpoint) / currentClose * 100 <
                    SUPPORT_RESISTANCE_MIN_ZONE_DISTANCE_PERCENT
                );
              });

            const pivotResistance = resolvePivotHigh(
              chartBars,
              supportResistancePivotIndex,
              SUPPORT_RESISTANCE_PIVOT_STRENGTH,
            );
            if (
              typeof pivotResistance === "number" &&
              Number.isFinite(thickness) &&
              !isTooCloseToExistingZone(pivotResistance)
            ) {
              const targetEndIndex =
                index + SUPPORT_RESISTANCE_EXTENSION_BARS;
              supportResistanceZones.push({
                id: `${script.scriptKey}-sr-resistance-${supportResistancePivotIndex}`,
                direction: "short",
                startBarIndex: supportResistancePivotIndex,
                endBarIndex: Math.min(chartBars.length - 1, targetEndIndex),
                extendBars: Math.max(0, targetEndIndex - (chartBars.length - 1)),
                top: Number((pivotResistance + thickness / 2).toFixed(6)),
                bottom: Number((pivotResistance - thickness / 2).toFixed(6)),
                fillColor: RESISTANCE_ZONE_COLOR,
                borderColor: withHexAlpha(BEAR_COLOR, "70"),
              });
            }

            const pivotSupport = resolvePivotLow(
              chartBars,
              supportResistancePivotIndex,
              SUPPORT_RESISTANCE_PIVOT_STRENGTH,
            );
            if (
              typeof pivotSupport === "number" &&
              Number.isFinite(thickness) &&
              !isTooCloseToExistingZone(pivotSupport)
            ) {
              const targetEndIndex =
                index + SUPPORT_RESISTANCE_EXTENSION_BARS;
              supportResistanceZones.push({
                id: `${script.scriptKey}-sr-support-${supportResistancePivotIndex}`,
                direction: "long",
                startBarIndex: supportResistancePivotIndex,
                endBarIndex: Math.min(chartBars.length - 1, targetEndIndex),
                extendBars: Math.max(0, targetEndIndex - (chartBars.length - 1)),
                top: Number((pivotSupport + thickness / 2).toFixed(6)),
                bottom: Number((pivotSupport - thickness / 2).toFixed(6)),
                fillColor: SUPPORT_ZONE_COLOR,
                borderColor: withHexAlpha(BULL_COLOR, "70"),
              });
            }

            while (supportResistanceZones.length > SUPPORT_RESISTANCE_MAX_ZONES) {
              supportResistanceZones.shift();
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
          showStructure &&
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
          showStructure &&
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
          showStructure &&
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
          showStructure &&
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

        if (showStructure && reversalDirection) {
          pushTrendReversalZone(
            zones,
            chartBars,
            reversalAnchorBarIndex,
            reversalAnchorPrice,
            reversalDirection,
            30,
          );
        }

        if (showStructure && (bullishBos || bullishChoch)) {
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

        if (showStructure && (bearishBos || bearishChoch)) {
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

        if (showTpSl && bullishChoch) {
          const stopLoss = Number.isFinite(lastSwingLow)
            ? lastSwingLow
            : chartBars[index].l;
          const risk = Math.abs(chartBars[index].c - stopLoss);
          activeTpSlOverlay = {
            direction: "long",
            startBarIndex: index,
            stopLoss,
            takeProfit1: Number((chartBars[index].c + risk * TP_RR_1).toFixed(6)),
            takeProfit2: Number((chartBars[index].c + risk * TP_RR_2).toFixed(6)),
            takeProfit3: Number((chartBars[index].c + risk * TP_RR_3).toFixed(6)),
          };
        }

        if (showTpSl && bearishChoch) {
          const stopLoss = Number.isFinite(lastSwingHigh)
            ? lastSwingHigh
            : chartBars[index].h;
          const risk = Math.abs(chartBars[index].c - stopLoss);
          activeTpSlOverlay = {
            direction: "short",
            startBarIndex: index,
            stopLoss,
            takeProfit1: Number((chartBars[index].c - risk * TP_RR_1).toFixed(6)),
            takeProfit2: Number((chartBars[index].c - risk * TP_RR_2).toFixed(6)),
            takeProfit3: Number((chartBars[index].c - risk * TP_RR_3).toFixed(6)),
          };
        }

        if (showOrderBlocks) {
          if (
            (bullishBos || bullishChoch) &&
            lastSwingLowBarIndex != null &&
            chartBars[lastSwingLowBarIndex]
          ) {
            const orderBlockBar = chartBars[lastSwingLowBarIndex];
            activeBullOrderBlocks.push({
              id: `${script.scriptKey}-bull-ob-${index}`,
              direction: "long",
              startBarIndex: lastSwingLowBarIndex,
              endBarIndex: index,
              top: orderBlockBar.h,
              bottom: orderBlockBar.l,
              label: `BULL OB +++ ${formatCompactVolume(orderBlockBar.v)}`,
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
            const orderBlockBar = chartBars[lastSwingHighBarIndex];
            activeBearOrderBlocks.push({
              id: `${script.scriptKey}-bear-ob-${index}`,
              direction: "short",
              startBarIndex: lastSwingHighBarIndex,
              endBarIndex: index,
              top: orderBlockBar.h,
              bottom: orderBlockBar.l,
              label: `BEAR OB +++ ${formatCompactVolume(orderBlockBar.v)}`,
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
        }

        const trendLine =
          activeRegimeDirection === 1 ? lowerBand[index] : upperBand[index];
        const reaction =
          Number.isFinite(trendLine) &&
          chartBars[index].l <= trendLine &&
          chartBars[index].h >= trendLine;

        const wireDirection = activeRegimeDirection === 1 ? -1 : 1;
        const wireStep = Number.isFinite(atrSmoothed[index])
          ? atrSmoothed[index] * wireSpread
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

        if (showShadow) {
          pushFilledBarZone(
            fillZones,
            chartBars,
            index,
            bbUpper[index],
            bbLower[index],
            SHADOW_FILL_COLOR,
          );
        }

        if (
          showWires &&
          reaction &&
          activeRegimeDirection === 1 &&
          Number.isFinite(bullMain[index]) &&
          Number.isFinite(bullWires[0][index])
        ) {
          pushFilledBarZone(
            fillZones,
            chartBars,
            index,
            bullMain[index],
            bullWires[0][index],
            withHexAlpha(BULL_COLOR, "38"),
          );
        }

        if (
          showWires &&
          reaction &&
          activeRegimeDirection === -1 &&
          Number.isFinite(bearMain[index]) &&
          Number.isFinite(bearWires[0][index])
        ) {
          pushFilledBarZone(
            fillZones,
            chartBars,
            index,
            bearMain[index],
            bearWires[0][index],
            withHexAlpha(BEAR_COLOR, "38"),
          );
        }

        if (colorCandles) {
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
      }

      if (showOrderBlocks) {
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
            meta: {
              fillColor: ORDER_BLOCK_BULL_COLOR,
              borderVisible: false,
              labelPosition: "center",
              labelVariant: "plain",
              labelColor: "#ffffff",
            },
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
            meta: {
              fillColor: ORDER_BLOCK_BEAR_COLOR,
              borderVisible: false,
              labelPosition: "center",
              labelVariant: "plain",
              labelColor: "#ffffff",
            },
          });
        });
      }

      if (showSupportResistance) {
        supportResistanceZones.forEach((zone) =>
          pushSupportResistanceZone(zones, chartBars, zone),
        );
      }

      const windows = showRegimeWindows
        ? buildRegimeWindows(chartBars, regimeDirection)
        : [];
      const keyLevels = showKeyLevels
        ? buildSessionKeyLevelSeries(chartBars)
        : null;
      const lastBarIndex = chartBars.length - 1;
      if (keyLevels && lastBarIndex >= 0) {
        const dayAnchorBarIndex = keyLevels.dayStartBarIndex[lastBarIndex] ?? 0;
        const weekAnchorBarIndex =
          keyLevels.weekStartBarIndex[lastBarIndex] ?? 0;
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "pdh",
          anchorBarIndex: dayAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.pdh[lastBarIndex],
          label: "PDH",
          color: KEY_LEVEL_HIGH_COLOR,
        });
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "pdl",
          anchorBarIndex: dayAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.pdl[lastBarIndex],
          label: "PDL",
          color: KEY_LEVEL_LOW_COLOR,
        });
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "pdc",
          anchorBarIndex: dayAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.pdc[lastBarIndex],
          label: "PDC",
          color: KEY_LEVEL_CLOSE_COLOR,
        });
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "open",
          anchorBarIndex: dayAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.todayOpen[lastBarIndex],
          label: "O",
          color: KEY_LEVEL_OPEN_COLOR,
        });
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "pwh",
          anchorBarIndex: weekAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.pwh[lastBarIndex],
          label: "PWH",
          color: KEY_LEVEL_HIGH_COLOR,
        });
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "pwl",
          anchorBarIndex: weekAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.pwl[lastBarIndex],
          label: "PWL",
          color: KEY_LEVEL_LOW_COLOR,
        });
      }

      if (showTpSl && activeTpSlOverlay) {
        pushTpSlZone(zones, chartBars, {
          idSuffix: "sl",
          startBarIndex: activeTpSlOverlay.startBarIndex,
          lastBarIndex,
          price: activeTpSlOverlay.stopLoss,
          label: "SL",
          color: STOP_LOSS_COLOR,
        });
        pushTpSlZone(zones, chartBars, {
          idSuffix: "tp1",
          startBarIndex: activeTpSlOverlay.startBarIndex,
          lastBarIndex,
          price: activeTpSlOverlay.takeProfit1,
          label: "TP 1",
          color: TAKE_PROFIT_COLOR,
        });
        pushTpSlZone(zones, chartBars, {
          idSuffix: "tp2",
          startBarIndex: activeTpSlOverlay.startBarIndex,
          lastBarIndex,
          price: activeTpSlOverlay.takeProfit2,
          label: "TP 2",
          color: TAKE_PROFIT_COLOR,
        });
        pushTpSlZone(zones, chartBars, {
          idSuffix: "tp3",
          startBarIndex: activeTpSlOverlay.startBarIndex,
          lastBarIndex,
          price: activeTpSlOverlay.takeProfit3,
          label: "TP 3",
          color: TAKE_PROFIT_COLOR,
        });
      }

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
          ...(showWires
            ? bullWires.map((values, index) =>
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
              )
            : []),
          ...(showWires
            ? bearWires.map((values, index) =>
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
              )
            : []),
          ...(showShadow
            ? [
                buildLineStudy(
                  `${studyPrefix}-shadow-upper`,
                  chartBars,
                  bbUpper,
                  {
                    color: `${SHADOW_COLOR}55`,
                    lineWidth: 1,
                    priceLineVisible: false,
                    lastValueVisible: false,
                  },
                ),
                buildLineStudy(
                  `${studyPrefix}-shadow-lower`,
                  chartBars,
                  bbLower,
                  {
                    color: `${SHADOW_COLOR}55`,
                    lineWidth: 1,
                    priceLineVisible: false,
                    lastValueVisible: false,
                  },
                ),
              ]
            : []),
        ],
        markers,
        events,
        zones: [...fillZones, ...zones],
        windows,
        barStyleByIndex: colorCandles ? barStyleByIndex : undefined,
      };
    },
  };
}
