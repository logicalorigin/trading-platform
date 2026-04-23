export type RayReplicaDirection = "long" | "short";

export type RayReplicaBar = {
  time: number;
  ts?: string;
  date?: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type RayReplicaBosConfirmation = "close" | "wicks";
export type RayReplicaTimeframeOption =
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

export type RayReplicaSessionOption =
  | "london"
  | "new_york"
  | "tokyo"
  | "sydney"
  | "asia"
  | "new_york_am"
  | "new_york_pm";

export type RayReplicaSignalSettings = {
  timeHorizon: number;
  bosConfirmation: RayReplicaBosConfirmation;
  basisLength: number;
  atrLength: number;
  atrSmoothing: number;
  volatilityMultiplier: number;
  shadowLength: number;
  shadowStdDev: number;
  adxLength: number;
  volumeMaLength: number;
  mtf1: RayReplicaTimeframeOption;
  mtf2: RayReplicaTimeframeOption;
  mtf3: RayReplicaTimeframeOption;
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
  sessions: RayReplicaSessionOption[];
  waitForBarClose: boolean;
};

export type RayReplicaStructureEventType =
  | "bullish_bos"
  | "bearish_bos"
  | "bullish_choch"
  | "bearish_choch";

export type RayReplicaSignalEvent = {
  id: string;
  eventType: "buy_signal" | "sell_signal";
  direction: RayReplicaDirection;
  barIndex: number;
  time: number;
  ts: string;
  price: number;
  close: number;
  actionable: boolean;
  filtered: boolean;
  filterState: RayReplicaFilterState;
};

export type RayReplicaStructureEvent = {
  id: string;
  eventType: RayReplicaStructureEventType;
  direction: RayReplicaDirection;
  barIndex: number;
  time: number;
  ts: string;
  actionable: boolean;
  filterState: RayReplicaFilterState | null;
};

export type RayReplicaFilterState = {
  enabled: boolean;
  direction: number;
  mtfDirections: [number, number, number];
  adx: number;
  volatilityScore: number;
  sessionKey: RayReplicaSessionOption | null;
  mtfPass: [boolean, boolean, boolean];
  adxPass: boolean;
  volatilityPass: boolean;
  sessionPass: boolean;
  passes: boolean;
};

export type RayReplicaEvaluation = {
  basis: number[];
  atrRaw: number[];
  atrSmoothed: number[];
  adx: number[];
  volatilityScore: number[];
  trendDirection: number[];
  regimeDirection: number[];
  structureEvents: RayReplicaStructureEvent[];
  signalEvents: RayReplicaSignalEvent[];
};

export const RAY_REPLICA_SIGNAL_WARMUP_BARS = 1000;

const toIso = (bar: RayReplicaBar): string =>
  bar.ts || new Date(bar.time * 1000).toISOString();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS: RayReplicaSignalSettings = {
  timeHorizon: 10,
  bosConfirmation: "close",
  basisLength: 80,
  atrLength: 14,
  atrSmoothing: 21,
  volatilityMultiplier: 2,
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
  sessions: ["new_york"],
  waitForBarClose: true,
};

const RAY_REPLICA_BOS_CONFIRMATION_OPTIONS = ["close", "wicks"] as const;
const RAY_REPLICA_TIMEFRAME_OPTIONS = [
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
const RAY_REPLICA_SESSION_SELECTION_OPTIONS = [
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
  fallback: RayReplicaSessionOption[],
): RayReplicaSessionOption[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const allowed = new Set<string>(RAY_REPLICA_SESSION_SELECTION_OPTIONS);
  const sessions = value.reduce<RayReplicaSessionOption[]>((acc, entry) => {
    const resolved = String(entry || "").trim() as RayReplicaSessionOption;
    if (!allowed.has(resolved) || acc.includes(resolved)) {
      return acc;
    }
    acc.push(resolved);
    return acc;
  }, []);

  return sessions.length ? sessions : [...fallback];
};

export function resolveRayReplicaSignalSettings(
  settings?: Record<string, unknown> | null,
): RayReplicaSignalSettings {
  const input = settings ?? {};
  const marketStructure = asSettingsRecord(input.marketStructure);
  const bands = asSettingsRecord(input.bands);
  const confirmation = asSettingsRecord(input.confirmation);
  const overlays = asSettingsRecord(input.overlays);
  const appearance = asSettingsRecord(input.appearance);
  const volScoreMin = resolveVolScoreSetting(
    confirmation.volScoreMin ?? input.volScoreMin,
    DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.volScoreMin,
  );

  return {
    timeHorizon: resolveIntegerSetting(
      marketStructure.timeHorizon ?? input.timeHorizon,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.timeHorizon,
      3,
      40,
    ),
    bosConfirmation: resolveEnumSetting(
      marketStructure.bosConfirmation ?? input.bosConfirmation,
      RAY_REPLICA_BOS_CONFIRMATION_OPTIONS,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.bosConfirmation,
    ),
    basisLength: resolveIntegerSetting(
      bands.basisLength ?? input.basisLength,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.basisLength,
      5,
      240,
    ),
    atrLength: resolveIntegerSetting(
      bands.atrLength ?? input.atrLength,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.atrLength,
      2,
      100,
    ),
    atrSmoothing: resolveIntegerSetting(
      bands.atrSmoothing ?? input.atrSmoothing,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.atrSmoothing,
      2,
      200,
    ),
    volatilityMultiplier: resolveFloatSetting(
      bands.volatilityMultiplier ?? input.volatilityMultiplier,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.volatilityMultiplier,
      0.1,
      10,
    ),
    shadowLength: resolveIntegerSetting(
      overlays.shadowLength ?? input.shadowLength,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.shadowLength,
      5,
      120,
    ),
    shadowStdDev: resolveFloatSetting(
      overlays.shadowStdDev ?? input.shadowStdDev,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.shadowStdDev,
      0.25,
      6,
    ),
    adxLength: resolveIntegerSetting(
      confirmation.adxLength ?? input.adxLength,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.adxLength,
      2,
      100,
    ),
    volumeMaLength: resolveIntegerSetting(
      confirmation.volumeMaLength ?? input.volumeMaLength,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.volumeMaLength,
      2,
      200,
    ),
    mtf1: resolveEnumSetting(
      confirmation.mtf1 ?? input.mtf1,
      RAY_REPLICA_TIMEFRAME_OPTIONS,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.mtf1,
    ),
    mtf2: resolveEnumSetting(
      confirmation.mtf2 ?? input.mtf2,
      RAY_REPLICA_TIMEFRAME_OPTIONS,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.mtf2,
    ),
    mtf3: resolveEnumSetting(
      confirmation.mtf3 ?? input.mtf3,
      RAY_REPLICA_TIMEFRAME_OPTIONS,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.mtf3,
    ),
    signalFiltersEnabled: resolveBooleanSetting(
      confirmation.signalFiltersEnabled ??
        confirmation.filtersEnabled ??
        input.signalFiltersEnabled,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.signalFiltersEnabled,
    ),
    requireMtf1: resolveBooleanSetting(
      confirmation.requireMtf1 ?? input.requireMtf1,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.requireMtf1,
    ),
    requireMtf2: resolveBooleanSetting(
      confirmation.requireMtf2 ?? input.requireMtf2,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.requireMtf2,
    ),
    requireMtf3: resolveBooleanSetting(
      confirmation.requireMtf3 ?? input.requireMtf3,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.requireMtf3,
    ),
    requireAdx: resolveBooleanSetting(
      confirmation.requireAdx ?? input.requireAdx,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.requireAdx,
    ),
    adxMin: resolveFloatSetting(
      confirmation.adxMin ?? input.adxMin,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.adxMin,
      0,
      100,
    ),
    requireVolScoreRange: resolveBooleanSetting(
      confirmation.requireVolScoreRange ?? input.requireVolScoreRange,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.requireVolScoreRange,
    ),
    volScoreMin,
    volScoreMax: Math.max(
      volScoreMin,
      resolveVolScoreSetting(
        confirmation.volScoreMax ?? input.volScoreMax,
        DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.volScoreMax,
      ),
    ),
    restrictToSelectedSessions: resolveBooleanSetting(
      confirmation.restrictToSelectedSessions ??
        input.restrictToSelectedSessions,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.restrictToSelectedSessions,
    ),
    sessions: resolveSessionSelections(
      confirmation.sessions ?? input.sessions,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.sessions,
    ),
    waitForBarClose: resolveBooleanSetting(
      appearance.waitForBarClose ?? input.waitForBarClose,
      DEFAULT_RAY_REPLICA_SIGNAL_SETTINGS.waitForBarClose,
    ),
  };
}

export const computeRayReplicaSma = (
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

export const computeRayReplicaWma = (
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

export const computeRayReplicaStandardDeviation = (
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

export const computeRayReplicaAtr = (
  chartBars: RayReplicaBar[],
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

export const computeRayReplicaAdx = (
  chartBars: RayReplicaBar[],
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

export const computeRayReplicaPercentRank = (
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

export const computeRayReplicaVolatilityScore = (
  chartBars: RayReplicaBar[],
  shadowLength: number,
  shadowStdDev: number,
): number[] => {
  const closes = chartBars.map((bar) => bar.c);
  const bbMid = computeRayReplicaSma(closes, shadowLength);
  const bbDev = computeRayReplicaStandardDeviation(closes, shadowLength).map(
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
  const rank = computeRayReplicaPercentRank(bbWidthPct, 200);
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

export const aggregateRayReplicaBarsForTimeframe = (
  chartBars: RayReplicaBar[],
  timeframe: RayReplicaTimeframeOption | string,
): RayReplicaBar[] => {
  const aggregatedBars: RayReplicaBar[] = [];
  chartBars.forEach((bar) => {
    const bucketStartMs = resolveBucketStartMs(bar.time * 1000, timeframe);
    const bucketTime = Math.floor(bucketStartMs / 1000);
    const lastBar = aggregatedBars[aggregatedBars.length - 1];
    if (!lastBar || lastBar.time !== bucketTime) {
      aggregatedBars.push({
        ...bar,
        time: bucketTime,
        ts: new Date(bucketStartMs).toISOString(),
        date: new Date(bucketStartMs).toISOString().slice(0, 10),
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

export const resolveRayReplicaTrendDirection = (
  chartBars: RayReplicaBar[],
  basisLength: number,
): number => {
  if (!chartBars.length) {
    return 1;
  }
  const basis = computeRayReplicaWma(
    chartBars.map((bar) => bar.c),
    basisLength,
  );
  let trendDirection = 1;
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
  }
  return trendDirection;
};

export const resolveRayReplicaSessionKey = (
  bar: RayReplicaBar,
): RayReplicaSessionOption | null => {
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

export const resolveRayReplicaSessionLabel = (bar: RayReplicaBar): string => {
  const key = resolveRayReplicaSessionKey(bar);
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
  selected: RayReplicaSessionOption,
  current: RayReplicaSessionOption | null,
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
  chartBars: RayReplicaBar[],
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
  chartBars: RayReplicaBar[],
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

const buildFilterState = (
  chartBars: RayReplicaBar[],
  index: number,
  direction: number,
  settings: RayReplicaSignalSettings,
  adx: number[],
  volatilityScore: number[],
): RayReplicaFilterState => {
  const mtfDirections = [settings.mtf1, settings.mtf2, settings.mtf3].map(
    (mtfTimeframe) =>
      resolveRayReplicaTrendDirection(
        aggregateRayReplicaBarsForTimeframe(
          chartBars.slice(0, index + 1),
          mtfTimeframe,
        ),
        settings.basisLength,
      ),
  ) as [number, number, number];
  const currentAdx = adx[index];
  const currentVolatilityScore = volatilityScore[index];
  const currentSessionKey = resolveRayReplicaSessionKey(chartBars[index]);
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
    sessionKey: currentSessionKey,
    mtfPass,
    adxPass,
    volatilityPass,
    sessionPass,
    passes: !settings.signalFiltersEnabled || gatedPass,
  };
};

export function evaluateRayReplicaSignals(input: {
  chartBars: RayReplicaBar[];
  settings: RayReplicaSignalSettings;
  includeProvisionalSignals?: boolean;
}): RayReplicaEvaluation {
  const { chartBars, settings } = input;
  const includeProvisionalSignals = input.includeProvisionalSignals !== false;
  const closes = chartBars.map((bar) => bar.c);
  const basis = computeRayReplicaWma(closes, settings.basisLength);
  const atrRaw = computeRayReplicaAtr(chartBars, settings.atrLength);
  const atrSmoothed = computeRayReplicaSma(atrRaw, settings.atrSmoothing);
  const adx = computeRayReplicaAdx(chartBars, settings.adxLength);
  const volatilityScore = computeRayReplicaVolatilityScore(
    chartBars,
    settings.shadowLength,
    settings.shadowStdDev,
  );
  const trendDirectionSeries = new Array<number>(chartBars.length).fill(1);
  const regimeDirection = new Array<number>(chartBars.length).fill(1);
  const structureEvents: RayReplicaStructureEvent[] = [];
  const signalEvents: RayReplicaSignalEvent[] = [];

  let trendDirection = 1;
  let marketStructureDirection = 0;
  let lastSwingHigh = Number.NaN;
  let previousSwingHigh = Number.NaN;
  let lastSwingLow = Number.NaN;
  let previousSwingLow = Number.NaN;
  let breakableHigh = Number.NaN;
  let breakableLow = Number.NaN;

  for (let index = 0; index < chartBars.length; index += 1) {
    const currentBar = chartBars[index];
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
      } else {
        bullishChoch = true;
        marketStructureDirection = 1;
      }
      breakableHigh = Number.NaN;
    }

    if (
      Number.isFinite(breakableLow) &&
      (settings.bosConfirmation === "wicks"
        ? currentBar.l < breakableLow
        : currentBar.c < breakableLow)
    ) {
      if (marketStructureDirection === -1) {
        bearishBos = true;
      } else {
        bearishChoch = true;
        marketStructureDirection = -1;
      }
      breakableLow = Number.NaN;
    }

    regimeDirection[index] =
      marketStructureDirection !== 0 ? marketStructureDirection : trendDirection;
    const actionable =
      includeProvisionalSignals ||
      !settings.waitForBarClose ||
      index < chartBars.length - 1;

    const pushStructure = (
      eventType: RayReplicaStructureEventType,
      direction: RayReplicaDirection,
      filterState: RayReplicaFilterState | null,
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
      const eventDirection: RayReplicaDirection = bullishChoch ? "long" : "short";
      const filterState = buildFilterState(
        chartBars,
        index,
        direction,
        settings,
        adx,
        volatilityScore,
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
              (Number.isFinite(atrRaw[index]) ? atrRaw[index] * 1.5 : 0)
            : currentBar.h +
              (Number.isFinite(atrRaw[index]) ? atrRaw[index] * 1.5 : 0);
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
    adx,
    volatilityScore,
    trendDirection: trendDirectionSeries,
    regimeDirection,
    structureEvents,
    signalEvents,
  };
}
