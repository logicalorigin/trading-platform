export type PyrusSignalsDirection = "long" | "short";

export type PyrusSignalsBar = {
  time: number;
  ts?: string;
  date?: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type PyrusSignalsBosConfirmation = "close" | "wicks";
export type PyrusSignalsTimeframeOption =
  | "1m"
  | "2m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "D"
  | "60"
  | "240"
  | "1D"
  | "1d";

export type PyrusSignalsSessionOption =
  | "london"
  | "new_york"
  | "tokyo"
  | "sydney"
  | "asia"
  | "new_york_am"
  | "new_york_pm";

export type PyrusSignalsSignalSettings = {
  timeHorizon: number;
  bosConfirmation: PyrusSignalsBosConfirmation;
  chochAtrBuffer: number;
  chochBodyExpansionAtr: number;
  chochVolumeGate: number;
  basisLength: number;
  atrLength: number;
  atrSmoothing: number;
  volatilityMultiplier: number;
  wireSpread: number;
  shadowLength: number;
  shadowStdDev: number;
  adxLength: number;
  volumeMaLength: number;
  mtf1: PyrusSignalsTimeframeOption;
  mtf2: PyrusSignalsTimeframeOption;
  mtf3: PyrusSignalsTimeframeOption;
  signalFiltersEnabled: boolean;
  requireMtf1: boolean;
  requireMtf2: boolean;
  requireMtf3: boolean;
  requireAdx: boolean;
  adxMin: number;
  requireVolScoreRange: boolean;
  volScoreMin: number;
  volScoreMax: number;
  restrictToSelectedSessions: boolean;
  sessions: PyrusSignalsSessionOption[];
  waitForBarClose: boolean;
  signalOffsetAtr: number;
};

export type PyrusSignalsStructureEventType =
  | "bullish_bos"
  | "bearish_bos"
  | "bullish_choch"
  | "bearish_choch";

export type PyrusSignalsSignalEvent = {
  id: string;
  eventType: "buy_signal" | "sell_signal";
  direction: PyrusSignalsDirection;
  barIndex: number;
  time: number;
  ts: string;
  price: number;
  close: number;
  actionable: boolean;
  filtered: boolean;
  filterState: PyrusSignalsFilterState;
};

export type PyrusSignalsStructureEvent = {
  id: string;
  eventType: PyrusSignalsStructureEventType;
  direction: PyrusSignalsDirection;
  barIndex: number;
  time: number;
  ts: string;
  actionable: boolean;
  filterState: PyrusSignalsFilterState | null;
};

export type PyrusSignalsFilterState = {
  enabled: boolean;
  direction: number;
  mtfDirections: [number, number, number];
  adx: number;
  volatilityScore: number;
  directionalFeatures: PyrusSignalsDirectionalFeatures;
  sessionKey: PyrusSignalsSessionOption | null;
  mtfPass: [boolean, boolean, boolean];
  adxPass: boolean;
  volatilityPass: boolean;
  sessionPass: boolean;
  passes: boolean;
};

export type PyrusSignalsDirectionalFeatures = {
  version: "directional-features-v1";
  shortMomentumPct: number;
  mediumMomentumPct: number;
  longMomentumPct: number;
  riskAdjustedMomentum: number;
  rangePosition20: number;
  rangeComponent: number;
  volumeRatio20: number;
  volumeExpansion: number;
  adxComponent: number;
  volatilityComponent: number;
  mtfAlignment: number;
  atrPct: number;
};

export type PyrusSignalsEvaluation = {
  basis: number[];
  atrRaw: number[];
  atrSmoothed: number[];
  upperBand: number[];
  lowerBand: number[];
  trendLine: number[];
  bullWires: [number[], number[], number[]];
  bearWires: [number[], number[], number[]];
  adx: number[];
  volatilityScore: number[];
  trendDirection: number[];
  regimeDirection: number[];
  structureEvents: PyrusSignalsStructureEvent[];
  signalEvents: PyrusSignalsSignalEvent[];
};

export const PYRUS_SIGNALS_SIGNAL_WARMUP_BARS = 1000;

const toIso = (bar: PyrusSignalsBar): string =>
  bar.ts || new Date(bar.time * 1000).toISOString();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS: PyrusSignalsSignalSettings = {
  timeHorizon: 10,
  bosConfirmation: "close",
  chochAtrBuffer: 0,
  chochBodyExpansionAtr: 0,
  chochVolumeGate: 0,
  basisLength: 80,
  atrLength: 14,
  atrSmoothing: 21,
  volatilityMultiplier: 2,
  wireSpread: 0.5,
  shadowLength: 20,
  shadowStdDev: 2,
  adxLength: 14,
  volumeMaLength: 20,
  mtf1: "1h",
  mtf2: "4h",
  mtf3: "D",
  signalFiltersEnabled: false,
  requireMtf1: false,
  requireMtf2: false,
  requireMtf3: false,
  requireAdx: false,
  adxMin: 20,
  requireVolScoreRange: false,
  volScoreMin: 2,
  volScoreMax: 10,
  restrictToSelectedSessions: false,
  sessions: [],
  waitForBarClose: true,
  signalOffsetAtr: 3.0,
};

const PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS = ["close", "wicks"] as const;
const PYRUS_SIGNALS_TIMEFRAME_OPTIONS = [
  "1m",
  "2m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "D",
  "60",
  "240",
  "1D",
  "1d",
] as const;
const PYRUS_SIGNALS_SESSION_SELECTION_OPTIONS = [
  "london",
  "new_york",
  "tokyo",
  "sydney",
  "asia",
  "new_york_am",
  "new_york_pm",
] as const;

const asSettingsRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const resolveIntegerSetting = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const resolved = Number(value);
  return Number.isFinite(resolved)
    ? clamp(Math.round(resolved), min, max)
    : fallback;
};

const resolveFloatSetting = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? clamp(resolved, min, max) : fallback;
};

const resolveVolScoreSetting = (value: unknown, fallback: number): number => {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) {
    return fallback;
  }

  const normalized = resolved > 10 ? resolved / 10 : resolved;
  return Number(clamp(normalized, 0, 10).toFixed(1));
};

const resolveBooleanSetting = (
  value: unknown,
  fallback: boolean,
): boolean => (typeof value === "boolean" ? value : fallback);

const resolveEnumSetting = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => {
  const resolved = String(value || "").trim() as T;
  return allowed.includes(resolved) ? resolved : fallback;
};

const resolveSessionSelections = (
  value: unknown,
  fallback: PyrusSignalsSessionOption[],
): PyrusSignalsSessionOption[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const allowed = new Set<string>(PYRUS_SIGNALS_SESSION_SELECTION_OPTIONS);
  const sessions = value.reduce<PyrusSignalsSessionOption[]>((acc, entry) => {
    const resolved = String(entry || "").trim() as PyrusSignalsSessionOption;
    if (!allowed.has(resolved) || acc.includes(resolved)) {
      return acc;
    }
    acc.push(resolved);
    return acc;
  }, []);

  return sessions.length ? sessions : [...fallback];
};

export function resolvePyrusSignalsSignalSettings(
  settings?: Record<string, unknown> | null,
): PyrusSignalsSignalSettings {
  const input = settings ?? {};
  const marketStructure = asSettingsRecord(input.marketStructure);
  const bands = asSettingsRecord(input.bands);
  const confirmation = asSettingsRecord(input.confirmation);
  const overlays = asSettingsRecord(input.overlays);
  const appearance = asSettingsRecord(input.appearance);
  const volScoreMin = resolveVolScoreSetting(
    confirmation.volScoreMin ?? input.volScoreMin,
    DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.volScoreMin,
  );

  return {
    timeHorizon: resolveIntegerSetting(
      marketStructure.timeHorizon ?? input.timeHorizon,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.timeHorizon,
      2,
      40,
    ),
    bosConfirmation: resolveEnumSetting(
      marketStructure.bosConfirmation ?? input.bosConfirmation,
      PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.bosConfirmation,
    ),
    chochAtrBuffer: resolveFloatSetting(
      marketStructure.chochAtrBuffer ??
        marketStructure.atrBuffer ??
        input.chochAtrBuffer ??
        input.atrBuffer,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.chochAtrBuffer,
      0,
      20,
    ),
    chochBodyExpansionAtr: resolveFloatSetting(
      marketStructure.chochBodyExpansionAtr ??
        marketStructure.bodyExpansionAtr ??
        marketStructure.bodyExpansion ??
        input.chochBodyExpansionAtr ??
        input.bodyExpansionAtr ??
        input.bodyExpansion,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.chochBodyExpansionAtr,
      0,
      20,
    ),
    chochVolumeGate: resolveFloatSetting(
      marketStructure.chochVolumeGate ??
        marketStructure.volumeGate ??
        input.chochVolumeGate ??
        input.volumeGate,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.chochVolumeGate,
      0,
      20,
    ),
    basisLength: resolveIntegerSetting(
      bands.basisLength ?? input.basisLength,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.basisLength,
      1,
      240,
    ),
    atrLength: resolveIntegerSetting(
      bands.atrLength ?? input.atrLength,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.atrLength,
      1,
      100,
    ),
    atrSmoothing: resolveIntegerSetting(
      bands.atrSmoothing ?? input.atrSmoothing,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.atrSmoothing,
      1,
      200,
    ),
    volatilityMultiplier: resolveFloatSetting(
      bands.volatilityMultiplier ?? input.volatilityMultiplier,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.volatilityMultiplier,
      0.1,
      10,
    ),
    wireSpread: resolveFloatSetting(
      overlays.wireSpread ?? input.wireSpread,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.wireSpread,
      0.01,
      10,
    ),
    shadowLength: resolveIntegerSetting(
      overlays.shadowLength ?? input.shadowLength,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.shadowLength,
      1,
      120,
    ),
    shadowStdDev: resolveFloatSetting(
      overlays.shadowStdDev ?? input.shadowStdDev,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.shadowStdDev,
      0.001,
      50,
    ),
    adxLength: resolveIntegerSetting(
      confirmation.adxLength ?? input.adxLength,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.adxLength,
      1,
      100,
    ),
    volumeMaLength: resolveIntegerSetting(
      confirmation.volumeMaLength ?? input.volumeMaLength,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.volumeMaLength,
      1,
      200,
    ),
    mtf1: resolveEnumSetting(
      confirmation.mtf1 ?? input.mtf1,
      PYRUS_SIGNALS_TIMEFRAME_OPTIONS,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.mtf1,
    ),
    mtf2: resolveEnumSetting(
      confirmation.mtf2 ?? input.mtf2,
      PYRUS_SIGNALS_TIMEFRAME_OPTIONS,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.mtf2,
    ),
    mtf3: resolveEnumSetting(
      confirmation.mtf3 ?? input.mtf3,
      PYRUS_SIGNALS_TIMEFRAME_OPTIONS,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.mtf3,
    ),
    signalFiltersEnabled: resolveBooleanSetting(
      confirmation.signalFiltersEnabled ??
        confirmation.filtersEnabled ??
        input.signalFiltersEnabled,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.signalFiltersEnabled,
    ),
    requireMtf1: resolveBooleanSetting(
      confirmation.requireMtf1 ?? input.requireMtf1,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.requireMtf1,
    ),
    requireMtf2: resolveBooleanSetting(
      confirmation.requireMtf2 ?? input.requireMtf2,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.requireMtf2,
    ),
    requireMtf3: resolveBooleanSetting(
      confirmation.requireMtf3 ?? input.requireMtf3,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.requireMtf3,
    ),
    requireAdx: resolveBooleanSetting(
      confirmation.requireAdx ?? input.requireAdx,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.requireAdx,
    ),
    adxMin: resolveFloatSetting(
      confirmation.adxMin ?? input.adxMin,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.adxMin,
      1,
      100,
    ),
    requireVolScoreRange: resolveBooleanSetting(
      confirmation.requireVolScoreRange ?? input.requireVolScoreRange,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.requireVolScoreRange,
    ),
    volScoreMin,
    volScoreMax: Math.max(
      volScoreMin,
      resolveVolScoreSetting(
        confirmation.volScoreMax ?? input.volScoreMax,
        DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.volScoreMax,
      ),
    ),
    restrictToSelectedSessions: resolveBooleanSetting(
      confirmation.restrictToSelectedSessions ??
        input.restrictToSelectedSessions,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.restrictToSelectedSessions,
    ),
    sessions: resolveSessionSelections(
      confirmation.sessions ?? input.sessions,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.sessions,
    ),
    waitForBarClose: resolveBooleanSetting(
      appearance.waitForBarClose ?? input.waitForBarClose,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.waitForBarClose,
    ),
    signalOffsetAtr: resolveFloatSetting(
      appearance.signalOffsetAtr ??
        asSettingsRecord(input.risk).signalOffsetAtr ??
        input.signalOffsetAtr,
      DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.signalOffsetAtr,
      0,
      20,
    ),
  };
}

export const computePyrusSignalsSma = (
  values: number[],
  period: number,
): number[] => {
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

export const computePyrusSignalsWma = (
  values: number[],
  period: number,
): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 0) {
    return result;
  }
  const weightTotal = (period * (period + 1)) / 2;
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
      result[index] = Number((weightedSum / weightTotal).toFixed(6));
    }
  }
  return result;
};

export const computePyrusSignalsStandardDeviation = (
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

export const computePyrusSignalsAtr = (
  chartBars: PyrusSignalsBar[],
  period: number,
): number[] => {
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
    rolling += trueRange[index] ?? 0;
  }
  let atr = rolling / period;
  result[period - 1] = Number(atr.toFixed(6));
  for (let index = period; index < trueRange.length; index += 1) {
    atr = (atr * (period - 1) + trueRange[index]) / period;
    result[index] = Number(atr.toFixed(6));
  }
  return result;
};

export const computePyrusSignalsAdx = (
  chartBars: PyrusSignalsBar[],
  period: number,
): number[] => {
  const length = chartBars.length;
  const result = new Array<number>(length).fill(Number.NaN);
  if (length <= period * 2 || period <= 0) {
    return result;
  }

  const trueRanges = new Array<number>(length).fill(0);
  const plusDm = new Array<number>(length).fill(0);
  const minusDm = new Array<number>(length).fill(0);

  for (let index = 1; index < length; index += 1) {
    const currentBar = chartBars[index];
    const previousBar = chartBars[index - 1];
    if (!currentBar || !previousBar) {
      continue;
    }
    const upMove = currentBar.h - previousBar.h;
    const downMove = previousBar.l - currentBar.l;
    trueRanges[index] = Math.max(
      currentBar.h - currentBar.l,
      Math.abs(currentBar.h - previousBar.c),
      Math.abs(currentBar.l - previousBar.c),
    );
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  let smoothedTr = 0;
  let smoothedPlusDm = 0;
  let smoothedMinusDm = 0;
  for (let index = 1; index <= period; index += 1) {
    smoothedTr += trueRanges[index] ?? 0;
    smoothedPlusDm += plusDm[index] ?? 0;
    smoothedMinusDm += minusDm[index] ?? 0;
  }

  const dx = new Array<number>(length).fill(Number.NaN);
  for (let index = period; index < length; index += 1) {
    if (index > period) {
      smoothedTr = smoothedTr - smoothedTr / period + trueRanges[index];
      smoothedPlusDm = smoothedPlusDm - smoothedPlusDm / period + plusDm[index];
      smoothedMinusDm =
        smoothedMinusDm - smoothedMinusDm / period + minusDm[index];
    }
    if (!Number.isFinite(smoothedTr) || smoothedTr <= 0) {
      continue;
    }
    const plusDi = (smoothedPlusDm / smoothedTr) * 100;
    const minusDi = (smoothedMinusDm / smoothedTr) * 100;
    const diSum = plusDi + minusDi;
    if (diSum <= 0) {
      continue;
    }
    dx[index] = Math.abs(plusDi - minusDi) / diSum * 100;
  }

  let dxSum = 0;
  let dxCount = 0;
  for (let index = period; index < length && dxCount < period; index += 1) {
    if (Number.isFinite(dx[index])) {
      dxSum += dx[index];
      dxCount += 1;
      if (dxCount === period) {
        result[index] = Number((dxSum / period).toFixed(6));
      }
    }
  }
  for (let index = period * 2; index < length; index += 1) {
    if (!Number.isFinite(dx[index]) || !Number.isFinite(result[index - 1])) {
      continue;
    }
    result[index] = Number(
      ((result[index - 1] * (period - 1) + dx[index]) / period).toFixed(6),
    );
  }
  return result;
};

export const computePyrusSignalsPercentRank = (
  values: number[],
  period: number,
): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 1) {
    return result;
  }
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    const current = values[index];
    if (!Number.isFinite(current) || window.some((value) => !Number.isFinite(value))) {
      continue;
    }
    let lessOrEqual = 0;
    window.forEach((value) => {
      if (value <= current) {
        lessOrEqual += 1;
      }
    });
    result[index] = Number((((lessOrEqual - 1) / (period - 1)) * 100).toFixed(6));
  }
  return result;
};

export const computePyrusSignalsVolatilityScore = (
  chartBars: PyrusSignalsBar[],
  shadowLength: number,
  shadowStdDev: number,
): number[] => {
  const closes = chartBars.map((bar) => bar.c);
  const bbMid = computePyrusSignalsSma(closes, shadowLength);
  const bbDev = computePyrusSignalsStandardDeviation(closes, shadowLength).map(
    (value) => (Number.isFinite(value) ? value * shadowStdDev : Number.NaN),
  );
  const bbWidthPct = bbMid.map((value, index) => {
    const dev = bbDev[index];
    const close = closes[index];
    if (!Number.isFinite(value) || !Number.isFinite(dev) || !Number.isFinite(close) || close <= 0) {
      return Number.NaN;
    }
    return (dev * 2) / close;
  });
  const rank = computePyrusSignalsPercentRank(bbWidthPct, 200);
  return rank.map((value) =>
    Number.isFinite(value) ? clamp(Math.round(value / 10), 0, 10) : 0,
  );
};

const resolveBucketStartMs = (timeMs: number, timeframe: string): number => {
  const normalized = timeframe === "60" ? "1h" : timeframe === "240" ? "4h" : timeframe;
  if (/^\d+$/.test(normalized)) {
    const intervalMs = Number(normalized) * 60_000;
    return Math.floor(timeMs / intervalMs) * intervalMs;
  }
  if (/^\d+m$/i.test(normalized)) {
    const intervalMs = Number(normalized.slice(0, -1)) * 60_000;
    return Math.floor(timeMs / intervalMs) * intervalMs;
  }
  if (/^\d+h$/i.test(normalized)) {
    const intervalMs = Number(normalized.slice(0, -1)) * 60 * 60_000;
    return Math.floor(timeMs / intervalMs) * intervalMs;
  }
  const value = new Date(timeMs);
  if (normalized === "D" || normalized === "1D" || normalized === "1d") {
    value.setUTCHours(0, 0, 0, 0);
    return value.getTime();
  }
  return timeMs;
};

export const aggregatePyrusSignalsBarsForTimeframe = (
  chartBars: PyrusSignalsBar[],
  timeframe: PyrusSignalsTimeframeOption | string,
): PyrusSignalsBar[] => {
  const aggregatedBars: PyrusSignalsBar[] = [];
  chartBars.forEach((bar) => {
    const bucketStartMs = resolveBucketStartMs(bar.time * 1000, timeframe);
    const bucketTime = Math.floor(bucketStartMs / 1000);
    const lastBar = aggregatedBars[aggregatedBars.length - 1];
    if (!lastBar || lastBar.time !== bucketTime) {
      // One Date + one toISOString per bucket boundary, not two. `date` is just
      // the first 10 chars of the same ISO string, so the second
      // `new Date(...).toISOString()` was pure duplicated work — and on the
      // universe-wide signal fan-out this aggregation is a top event-loop cost
      // (V8 Date formatting), so halving it directly relieves the loop. Output is
      // byte-identical.
      const bucketIso = new Date(bucketStartMs).toISOString();
      aggregatedBars.push({
        ...bar,
        time: bucketTime,
        ts: bucketIso,
        date: bucketIso.slice(0, 10),
      });
      return;
    }
    lastBar.h = Math.max(lastBar.h, bar.h);
    lastBar.l = Math.min(lastBar.l, bar.l);
    lastBar.c = bar.c;
    lastBar.v += bar.v;
  });
  return aggregatedBars;
};

export const resolvePyrusSignalsTrendDirection = (
  chartBars: PyrusSignalsBar[],
  basisLength: number,
): number => {
  // Returns 0 (neutral / unknown) when the WMA basis cannot be computed — i.e.
  // empty bars OR fewer than basisLength bars, where the WMA is all-NaN and no
  // finite basis comparison is ever evaluable. Consumers must treat 0 as
  // non-confirming, never as a bullish default. When there IS enough history to
  // evaluate at least one basis comparison, behavior is unchanged: the direction
  // resolves to +1/-1, and a flat basis keeps the prior +1 default.
  if (!chartBars.length) {
    return 0;
  }
  const basis = computePyrusSignalsWma(
    chartBars.map((bar) => bar.c),
    basisLength,
  );
  let trendDirection = 1;
  let basisComputable = false;
  for (let index = 0; index < chartBars.length; index += 1) {
    if (
      index >= 5 &&
      Number.isFinite(basis[index]) &&
      Number.isFinite(basis[index - 5])
    ) {
      basisComputable = true;
      if (basis[index] > basis[index - 5]) {
        trendDirection = 1;
      } else if (basis[index] < basis[index - 5]) {
        trendDirection = -1;
      }
    }
  }
  return basisComputable ? trendDirection : 0;
};

export const resolvePyrusSignalsSessionKey = (
  bar: PyrusSignalsBar,
): PyrusSignalsSessionOption | null => {
  const value = new Date(bar.time * 1000);
  const minutes = value.getUTCHours() * 60 + value.getUTCMinutes();
  if (minutes >= 8 * 60 && minutes < 17 * 60) {
    return "london";
  }
  if (minutes >= 13 * 60 && minutes < 22 * 60) {
    return "new_york";
  }
  if (minutes >= 0 && minutes < 9 * 60) {
    return "tokyo";
  }
  if (minutes >= 22 * 60 || minutes < 7 * 60) {
    return "sydney";
  }
  return null;
};

export const resolvePyrusSignalsSessionLabel = (bar: PyrusSignalsBar): string => {
  const key = resolvePyrusSignalsSessionKey(bar);
  return key === "new_york"
    ? "New York"
    : key === "london"
      ? "London"
      : key === "tokyo"
        ? "Tokyo"
        : key === "sydney"
          ? "Sydney"
          : "Closed";
};

const sessionSelectionMatches = (
  selected: PyrusSignalsSessionOption,
  current: PyrusSignalsSessionOption | null,
): boolean => {
  if (!current) {
    return false;
  }
  if (selected === current) {
    return true;
  }
  if (selected === "asia") {
    return current === "tokyo" || current === "sydney";
  }
  if (selected === "new_york_am" || selected === "new_york_pm") {
    return current === "new_york";
  }
  return false;
};

const resolvePivotHigh = (
  chartBars: PyrusSignalsBar[],
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
  for (let index = pivotIndex - strength; index <= pivotIndex + strength; index += 1) {
    if (index !== pivotIndex && (chartBars[index]?.h ?? Number.NEGATIVE_INFINITY) > pivotValue) {
      return null;
    }
  }
  return pivotValue;
};

const resolvePivotLow = (
  chartBars: PyrusSignalsBar[],
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
  for (let index = pivotIndex - strength; index <= pivotIndex + strength; index += 1) {
    if (index !== pivotIndex && (chartBars[index]?.l ?? Number.POSITIVE_INFINITY) < pivotValue) {
      return null;
    }
  }
  return pivotValue;
};

const resolveMedianPositiveBarInterval = (chartBars: PyrusSignalsBar[]): number => {
  const intervals: number[] = [];
  for (let index = 1; index < chartBars.length; index += 1) {
    const interval = chartBars[index].time - chartBars[index - 1].time;
    if (Number.isFinite(interval) && interval > 0) {
      intervals.push(interval);
    }
  }

  if (!intervals.length) {
    return 0;
  }

  intervals.sort((left, right) => left - right);
  return intervals[Math.floor(intervals.length / 2)] ?? 0;
};

const hasHardBarTimeGap = (
  chartBars: PyrusSignalsBar[],
  index: number,
  medianInterval: number,
): boolean => {
  if (index <= 0 || medianInterval <= 0) {
    return false;
  }

  return chartBars[index].time - chartBars[index - 1].time > medianInterval * 2;
};

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const roundFeature = (value: number): number =>
  Number.isFinite(value) ? Number(value.toFixed(6)) : 0;

const averageFinite = (values: number[]): number => {
  const finite = values.filter(Number.isFinite);
  return finite.length
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : 0;
};

const directionalPercentChange = (
  chartBars: PyrusSignalsBar[],
  index: number,
  lookback: number,
  direction: number,
): number => {
  const current = chartBars[index];
  const previous = chartBars[index - lookback];
  if (!current || !previous || !Number.isFinite(previous.c) || previous.c <= 0) {
    return 0;
  }
  return ((current.c - previous.c) / previous.c) * 100 * direction;
};

export function buildPyrusSignalsDirectionalFeatures(input: {
  chartBars: PyrusSignalsBar[];
  index: number;
  direction: number;
  mtfDirections: readonly number[];
  adx: number;
  volatilityScore: number;
  atr: number;
}): PyrusSignalsDirectionalFeatures {
  const current = input.chartBars[input.index];
  const direction = input.direction >= 0 ? 1 : -1;
  if (!current) {
    return {
      version: "directional-features-v1",
      shortMomentumPct: 0,
      mediumMomentumPct: 0,
      longMomentumPct: 0,
      riskAdjustedMomentum: 0,
      rangePosition20: 0.5,
      rangeComponent: 0,
      volumeRatio20: 1,
      volumeExpansion: 0,
      adxComponent: -1,
      volatilityComponent: 0,
      mtfAlignment: 0,
      atrPct: 0,
    };
  }

  const shortMomentumPct = directionalPercentChange(
    input.chartBars,
    input.index,
    6,
    direction,
  );
  const mediumMomentumPct = directionalPercentChange(
    input.chartBars,
    input.index,
    20,
    direction,
  );
  const longMomentumPct = directionalPercentChange(
    input.chartBars,
    input.index,
    78,
    direction,
  );

  const rangeBars = input.chartBars.slice(Math.max(0, input.index - 19), input.index + 1);
  const rangeHigh = Math.max(...rangeBars.map((bar) => bar.h));
  const rangeLow = Math.min(...rangeBars.map((bar) => bar.l));
  const rangePosition =
    Number.isFinite(rangeHigh) &&
    Number.isFinite(rangeLow) &&
    rangeHigh > rangeLow
      ? direction === 1
        ? (current.c - rangeLow) / (rangeHigh - rangeLow)
        : (rangeHigh - current.c) / (rangeHigh - rangeLow)
      : 0.5;

  const priorVolumeAverage = averageFinite(
    input.chartBars
      .slice(Math.max(0, input.index - 20), input.index)
      .map((bar) => bar.v),
  );
  const volumeRatio =
    priorVolumeAverage > 0 && current.v > 0 ? current.v / priorVolumeAverage : 1;

  const adx = Number.isFinite(input.adx) ? input.adx : 0;
  const volatilityScore = Number.isFinite(input.volatilityScore)
    ? input.volatilityScore
    : 0;
  const mtfAlignment =
    input.mtfDirections.filter((value) => value === direction).length -
    input.mtfDirections.filter((value) => value === -direction).length * 0.5;
  const atrPct =
    Number.isFinite(input.atr) && input.atr > 0 && current.c > 0
      ? (input.atr / current.c) * 100
      : 0;
  const riskAdjustedMomentum =
    mediumMomentumPct / Math.max(0.25, atrPct || 0.25);

  return {
    version: "directional-features-v1",
    shortMomentumPct: roundFeature(shortMomentumPct),
    mediumMomentumPct: roundFeature(mediumMomentumPct),
    longMomentumPct: roundFeature(longMomentumPct),
    riskAdjustedMomentum: roundFeature(riskAdjustedMomentum),
    rangePosition20: roundFeature(clampNumber(rangePosition, 0, 1)),
    rangeComponent: roundFeature((clampNumber(rangePosition, 0, 1) - 0.5) * 4),
    volumeRatio20: roundFeature(volumeRatio),
    volumeExpansion: roundFeature(clampNumber(volumeRatio - 1, -1, 2)),
    adxComponent: roundFeature(clampNumber((adx - 18) / 12, -1, 2.5)),
    volatilityComponent: roundFeature(
      clampNumber(1 - Math.abs(volatilityScore - 6) / 6, -0.5, 1),
    ),
    mtfAlignment: roundFeature(mtfAlignment),
    atrPct: roundFeature(atrPct),
  };
}

const buildFilterState = (
  chartBars: PyrusSignalsBar[],
  index: number,
  direction: number,
  settings: PyrusSignalsSignalSettings,
  adx: number[],
  volatilityScore: number[],
  atrSmoothed: number[],
): PyrusSignalsFilterState => {
  const mtfDirections = [settings.mtf1, settings.mtf2, settings.mtf3].map(
    (mtfTimeframe) =>
      resolvePyrusSignalsTrendDirection(
        aggregatePyrusSignalsBarsForTimeframe(
          chartBars.slice(0, index + 1),
          mtfTimeframe,
        ),
        settings.basisLength,
      ),
  ) as [number, number, number];
  const currentAdx = adx[index];
  const currentVolatilityScore = volatilityScore[index];
  const directionalFeatures = buildPyrusSignalsDirectionalFeatures({
    chartBars,
    index,
    direction,
    mtfDirections,
    adx: currentAdx,
    volatilityScore: currentVolatilityScore,
    atr: atrSmoothed[index],
  });
  const currentSessionKey = resolvePyrusSignalsSessionKey(chartBars[index]);
  const mtfPass: [boolean, boolean, boolean] = [
    !settings.requireMtf1 || mtfDirections[0] === direction,
    !settings.requireMtf2 || mtfDirections[1] === direction,
    !settings.requireMtf3 || mtfDirections[2] === direction,
  ];
  const adxPass =
    !settings.requireAdx ||
    (Number.isFinite(currentAdx) && currentAdx >= settings.adxMin);
  const volatilityPass =
    !settings.requireVolScoreRange ||
    (Number.isFinite(currentVolatilityScore) &&
      currentVolatilityScore >= settings.volScoreMin &&
      currentVolatilityScore <= settings.volScoreMax);
  const sessionPass =
    !settings.restrictToSelectedSessions ||
    settings.sessions.some((session) =>
      sessionSelectionMatches(session, currentSessionKey),
    );
  const gatedPass =
    mtfPass.every(Boolean) && adxPass && volatilityPass && sessionPass;
  return {
    enabled: settings.signalFiltersEnabled,
    direction,
    mtfDirections,
    adx: currentAdx,
    volatilityScore: currentVolatilityScore,
    directionalFeatures,
    sessionKey: currentSessionKey,
    mtfPass,
    adxPass,
    volatilityPass,
    sessionPass,
    passes: !settings.signalFiltersEnabled || gatedPass,
  };
};

export function evaluatePyrusSignalsSignals(input: {
  chartBars: PyrusSignalsBar[];
  settings: PyrusSignalsSignalSettings;
  includeProvisionalSignals?: boolean;
  // waitForBarClose treats the FINAL series bar as possibly still forming
  // (TradingView semantics: the last chart bar is the live bar) and suppresses
  // its signal until a newer bar exists. Callers that feed a completed-bars-only
  // series (the signal monitor) set this true when the final bar provably
  // closed, so the signal fires at its own bar close instead of one full bar
  // later. Default false preserves forming-bar suppression for chart callers.
  lastBarClosed?: boolean;
}): PyrusSignalsEvaluation {
  const { chartBars, settings } = input;
  const includeProvisionalSignals = input.includeProvisionalSignals !== false;
  const lastBarClosed = input.lastBarClosed === true;
  const closes = chartBars.map((bar) => bar.c);
  const basis = computePyrusSignalsWma(closes, settings.basisLength);
  const atrRaw = computePyrusSignalsAtr(chartBars, settings.atrLength);
  const atrSmoothed = computePyrusSignalsSma(atrRaw, settings.atrSmoothing);
  const upperBand = basis.map((value, index) =>
    Number.isFinite(value) && Number.isFinite(atrSmoothed[index])
      ? Number((value + atrSmoothed[index] * settings.volatilityMultiplier).toFixed(6))
      : Number.NaN,
  );
  const lowerBand = basis.map((value, index) =>
    Number.isFinite(value) && Number.isFinite(atrSmoothed[index])
      ? Number((value - atrSmoothed[index] * settings.volatilityMultiplier).toFixed(6))
      : Number.NaN,
  );
  const trendLine = new Array<number>(chartBars.length).fill(Number.NaN);
  const bullWires = Array.from({ length: 3 }, () =>
    new Array<number>(chartBars.length).fill(Number.NaN),
  ) as [number[], number[], number[]];
  const bearWires = Array.from({ length: 3 }, () =>
    new Array<number>(chartBars.length).fill(Number.NaN),
  ) as [number[], number[], number[]];
  const adx = computePyrusSignalsAdx(chartBars, settings.adxLength);
  const volumeSma = computePyrusSignalsSma(
    chartBars.map((bar) => bar.v),
    settings.volumeMaLength,
  );
  const volatilityScore = computePyrusSignalsVolatilityScore(
    chartBars,
    settings.shadowLength,
    settings.shadowStdDev,
  );
  const trendDirectionSeries = new Array<number>(chartBars.length).fill(1);
  const regimeDirection = new Array<number>(chartBars.length).fill(1);
  const structureEvents: PyrusSignalsStructureEvent[] = [];
  const signalEvents: PyrusSignalsSignalEvent[] = [];
  const medianBarInterval = resolveMedianPositiveBarInterval(chartBars);

  let trendDirection = 1;
  let marketStructureDirection = 0;
  let lastSwingHigh = Number.NaN;
  let previousSwingHigh = Number.NaN;
  let lastSwingLow = Number.NaN;
  let previousSwingLow = Number.NaN;
  let breakableHigh = Number.NaN;
  let breakableLow = Number.NaN;
  let previousRegimeDirection: number | null = null;

  const passesChochFilters = (
    index: number,
    direction: PyrusSignalsDirection,
    pivotLevel: number,
  ): boolean => {
    const currentBar = chartBars[index];
    if (!currentBar || !Number.isFinite(pivotLevel)) {
      return false;
    }

    const currentAtr = atrRaw[index];
    const atrBuffer =
      Number.isFinite(currentAtr) && settings.chochAtrBuffer > 0
        ? currentAtr * settings.chochAtrBuffer
        : 0;
    const breakThreshold =
      direction === "long" ? pivotLevel + atrBuffer : pivotLevel - atrBuffer;
    const hasBufferedBreak =
      direction === "long"
        ? settings.bosConfirmation === "wicks"
          ? currentBar.h > breakThreshold
          : currentBar.c > breakThreshold
        : settings.bosConfirmation === "wicks"
          ? currentBar.l < breakThreshold
          : currentBar.c < breakThreshold;

    if (!hasBufferedBreak) {
      return false;
    }

    if (settings.chochBodyExpansionAtr > 0) {
      if (!Number.isFinite(currentAtr)) {
        return false;
      }
      const candleBody = Math.abs(currentBar.c - currentBar.o);
      if (candleBody < currentAtr * settings.chochBodyExpansionAtr) {
        return false;
      }
    }

    if (settings.chochVolumeGate > 0) {
      const baselineVolume = volumeSma[index];
      if (
        !Number.isFinite(baselineVolume) ||
        currentBar.v < baselineVolume * settings.chochVolumeGate
      ) {
        return false;
      }
    }

    return true;
  };

  for (let index = 0; index < chartBars.length; index += 1) {
    const currentBar = chartBars[index];
    const hardGapBar = hasHardBarTimeGap(chartBars, index, medianBarInterval);
    if (!currentBar) {
      continue;
    }

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
    trendDirectionSeries[index] = trendDirection;

    const pivotIndex = index - settings.timeHorizon;
    if (pivotIndex >= settings.timeHorizon) {
      const pivotHigh = resolvePivotHigh(
        chartBars,
        pivotIndex,
        settings.timeHorizon,
      );
      if (pivotHigh != null) {
        previousSwingHigh = lastSwingHigh;
        lastSwingHigh = pivotHigh;
        breakableHigh = pivotHigh;
      }
      const pivotLow = resolvePivotLow(
        chartBars,
        pivotIndex,
        settings.timeHorizon,
      );
      if (pivotLow != null) {
        previousSwingLow = lastSwingLow;
        lastSwingLow = pivotLow;
        breakableLow = pivotLow;
      }
    }

    let bullishBos = false;
    let bearishBos = false;
    let bullishChoch = false;
    let bearishChoch = false;

    if (
      Number.isFinite(breakableHigh) &&
      (settings.bosConfirmation === "wicks"
        ? currentBar.h > breakableHigh
        : currentBar.c > breakableHigh)
    ) {
      if (marketStructureDirection === 1) {
        bullishBos = true;
        breakableHigh = Number.NaN;
      } else if (passesChochFilters(index, "long", breakableHigh)) {
        bullishChoch = true;
        marketStructureDirection = 1;
        breakableHigh = Number.NaN;
      }
    }

    if (
      Number.isFinite(breakableLow) &&
      (settings.bosConfirmation === "wicks"
        ? currentBar.l < breakableLow
        : currentBar.c < breakableLow)
    ) {
      if (marketStructureDirection === -1) {
        bearishBos = true;
        breakableLow = Number.NaN;
      } else if (passesChochFilters(index, "short", breakableLow)) {
        bearishChoch = true;
        marketStructureDirection = -1;
        breakableLow = Number.NaN;
      }
    }

    regimeDirection[index] =
      marketStructureDirection !== 0 ? marketStructureDirection : trendDirection;
    const activeRegimeDirection = regimeDirection[index];
    const activeTrendLine =
      activeRegimeDirection === 1 ? lowerBand[index] : upperBand[index];
    const regimeFlipped =
      previousRegimeDirection != null &&
      previousRegimeDirection !== activeRegimeDirection;
    if (!hardGapBar && !regimeFlipped && Number.isFinite(activeTrendLine)) {
      trendLine[index] = activeTrendLine;
      const wireStep = Number.isFinite(atrSmoothed[index])
        ? atrSmoothed[index] * settings.wireSpread
        : Number.NaN;
      if (Number.isFinite(wireStep)) {
        const wireDirection = activeRegimeDirection === 1 ? -1 : 1;
        const wires = activeRegimeDirection === 1 ? bullWires : bearWires;
        wires[0][index] = Number(
          (activeTrendLine + wireDirection * wireStep).toFixed(6),
        );
        wires[1][index] = Number(
          (activeTrendLine + wireDirection * wireStep * 2).toFixed(6),
        );
        wires[2][index] = Number(
          (activeTrendLine + wireDirection * wireStep * 3).toFixed(6),
        );
      }
    }
    previousRegimeDirection = activeRegimeDirection;
    const actionable =
      includeProvisionalSignals ||
      !settings.waitForBarClose ||
      lastBarClosed ||
      index < chartBars.length - 1;

    const pushStructure = (
      eventType: PyrusSignalsStructureEventType,
      direction: PyrusSignalsDirection,
      filterState: PyrusSignalsFilterState | null,
    ) => {
      structureEvents.push({
        id: `${eventType}-${index}-${currentBar.time}`,
        eventType,
        direction,
        barIndex: index,
        time: currentBar.time,
        ts: toIso(currentBar),
        actionable,
        filterState,
      });
    };

    if (bullishBos) {
      pushStructure("bullish_bos", "long", null);
    }
    if (bearishBos) {
      pushStructure("bearish_bos", "short", null);
    }

    if (bullishChoch || bearishChoch) {
      const direction = bullishChoch ? 1 : -1;
      const eventDirection: PyrusSignalsDirection = bullishChoch ? "long" : "short";
      const filterState = buildFilterState(
        chartBars,
        index,
        direction,
        settings,
        adx,
        volatilityScore,
        atrSmoothed,
      );
      pushStructure(
        bullishChoch ? "bullish_choch" : "bearish_choch",
        eventDirection,
        filterState,
      );
      if (filterState.passes && actionable) {
        const signalPrice =
          eventDirection === "long"
            ? currentBar.l -
              (Number.isFinite(atrRaw[index])
                ? atrRaw[index] * settings.signalOffsetAtr
                : 0)
            : currentBar.h +
              (Number.isFinite(atrRaw[index])
                ? atrRaw[index] * settings.signalOffsetAtr
                : 0);
        signalEvents.push({
          id: `${eventDirection === "long" ? "buy" : "sell"}-${index}-${currentBar.time}`,
          eventType: eventDirection === "long" ? "buy_signal" : "sell_signal",
          direction: eventDirection,
          barIndex: index,
          time: currentBar.time,
          ts: toIso(currentBar),
          price: Number(signalPrice.toFixed(6)),
          close: currentBar.c,
          actionable,
          filtered: false,
          filterState,
        });
      }
    }

    void previousSwingHigh;
    void previousSwingLow;
  }

  return {
    basis,
    atrRaw,
    atrSmoothed,
    upperBand,
    lowerBand,
    trendLine,
    bullWires,
    bearWires,
    adx,
    volatilityScore,
    trendDirection: trendDirectionSeries,
    regimeDirection,
    structureEvents,
    signalEvents,
  };
}
