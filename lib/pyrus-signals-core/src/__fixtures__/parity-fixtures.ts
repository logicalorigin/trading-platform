import assert from "node:assert/strict";

import {
  DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS,
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsSignalSettings,
  type PyrusSignalsBar,
  type PyrusSignalsEvaluation,
  type PyrusSignalsSignalEvent,
  type PyrusSignalsSignalSettings,
  type PyrusSignalsStructureEvent,
} from "../index";

export type PyrusSignalsParityFixture = {
  name: string;
  description: string;
  seed: number;
  bars: PyrusSignalsBar[];
};

type StableJsonValue =
  | null
  | boolean
  | number
  | string
  | StableJsonValue[]
  | { [key: string]: StableJsonValue };

export type StableDifference = {
  path: string;
  index: number | null;
  expected: StableJsonValue | undefined;
  actual: StableJsonValue | undefined;
  delta: number | null;
};

export type IncrementalPyrusSignalsEvaluator = (
  series: PyrusSignalsBar[],
) => PyrusSignalsEvaluation;

export type PyrusSignalsFixtureEvaluationOptions = {
  includeProvisionalSignals?: boolean;
  lastBarClosed?: boolean;
};

const BAR_INTERVAL_SECONDS = 15 * 60;
const BASE_TIME_SECONDS = 1_700_000_000;
const DEFAULT_LENGTH = 1000;

export const PYRUS_SIGNALS_FIXTURE_TAIL_BARS = 240;
export const PYRUS_SIGNALS_WARMUP_SAMPLE_SIZES = [
  240,
  300,
  380,
  460,
  540,
  700,
  1000,
] as const;

export const PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS =
  resolvePyrusSignalsSignalSettings({});

export const PYRUS_SIGNALS_FIXTURE_SEEDS = {
  steadyUptrend: 0x1a2b3c4d,
  downtrend: 0x2b3c4d5e,
  choppyMeanReverting: 0x3c4d5e6f,
  gappy: 0x4d5e6f70,
  lowLiquidity: 0x5e6f7081,
  extremeValues: 0x6f708192,
  flat: 0x708192a3,
  shortMinusOne: 0x8192a3b4,
  shortPeriod: 0x92a3b4c5,
  shortAdxGuard: 0xa3b4c5d6,
  nonFinite: 0xb4c5d6e7,
} as const;

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const randomBetween = (rng: () => number, min: number, max: number): number =>
  min + (max - min) * rng();

const roundedPrice = (value: number): number => {
  if (!Number.isFinite(value)) {
    return value;
  }
  const digits = Math.abs(value) < 1 ? 8 : 6;
  return Number(value.toFixed(digits));
};

const roundedVolume = (value: number): number =>
  Number.isFinite(value) ? Number(Math.max(0, value).toFixed(2)) : value;

const makeBar = (input: {
  timeIndex: number;
  open: number;
  close: number;
  rng: () => number;
  volume: number;
  spreadFraction?: number;
}): PyrusSignalsBar => {
  const spreadFraction = input.spreadFraction ?? 0.004;
  const reference = Math.max(Math.abs(input.open), Math.abs(input.close), 0.01);
  const wick =
    reference * randomBetween(input.rng, spreadFraction * 0.2, spreadFraction);
  const high = Math.max(input.open, input.close) + wick;
  const low = Math.max(0, Math.min(input.open, input.close) - wick);
  const time = BASE_TIME_SECONDS + input.timeIndex * BAR_INTERVAL_SECONDS;
  return {
    time,
    ts: new Date(time * 1000).toISOString(),
    o: roundedPrice(input.open),
    h: roundedPrice(high),
    l: roundedPrice(low),
    c: roundedPrice(input.close),
    v: roundedVolume(input.volume),
  };
};

const buildTrendFixture = (input: {
  seed: number;
  length: number;
  start: number;
  drift: number;
  noise: number;
}): PyrusSignalsBar[] => {
  const rng = mulberry32(input.seed);
  const bars: PyrusSignalsBar[] = [];
  let close = input.start;
  for (let index = 0; index < input.length; index += 1) {
    const open = close;
    close = Math.max(
      0.01,
      close + input.drift + randomBetween(rng, -input.noise, input.noise),
    );
    bars.push(
      makeBar({
        timeIndex: index,
        open,
        close,
        rng,
        volume: 900 + index * 1.25 + randomBetween(rng, -150, 180),
      }),
    );
  }
  return bars;
};

const buildChoppyFixture = (seed: number, length: number): PyrusSignalsBar[] => {
  const rng = mulberry32(seed);
  const bars: PyrusSignalsBar[] = [];
  let close = 100;
  for (let index = 0; index < length; index += 1) {
    const open = close;
    close = Math.max(
      1,
      close + (100 - close) * 0.08 + randomBetween(rng, -2.4, 2.4),
    );
    bars.push(
      makeBar({
        timeIndex: index,
        open,
        close,
        rng,
        volume: 1200 + randomBetween(rng, -450, 500),
      }),
    );
  }
  return bars;
};

const buildGappyFixture = (seed: number): PyrusSignalsBar[] => {
  const rng = mulberry32(seed);
  const bars: PyrusSignalsBar[] = [];
  let close = 70;
  let candidateIndex = 0;
  while (bars.length < DEFAULT_LENGTH) {
    const skip = rng() < 0.1;
    if (!skip) {
      const open = close;
      close = Math.max(1, close + 0.02 + randomBetween(rng, -0.9, 1.1));
      bars.push(
        makeBar({
          timeIndex: candidateIndex,
          open,
          close,
          rng,
          volume: 1000 + randomBetween(rng, -300, 500),
        }),
      );
    }
    candidateIndex += 1;
  }
  return bars;
};

const buildLowLiquidityFixture = (seed: number): PyrusSignalsBar[] => {
  const rng = mulberry32(seed);
  const bars: PyrusSignalsBar[] = [];
  let close = 12;
  for (let index = 0; index < DEFAULT_LENGTH; index += 1) {
    const open = close;
    const noTradeBar = rng() < 0.35;
    close = noTradeBar
      ? close
      : Math.max(0.25, close + randomBetween(rng, -0.12, 0.14));
    bars.push(
      makeBar({
        timeIndex: index,
        open,
        close,
        rng,
        volume: rng() < 0.58 ? 0 : randomBetween(rng, 1, 140),
        spreadFraction: 0.012,
      }),
    );
  }
  return bars;
};

const buildExtremeValuesFixture = (seed: number): PyrusSignalsBar[] => {
  const rng = mulberry32(seed);
  const bars: PyrusSignalsBar[] = [];
  let close = 10_000;
  for (let index = 0; index < DEFAULT_LENGTH; index += 1) {
    if (index === DEFAULT_LENGTH / 2) {
      close = 0.01;
    }
    const open = close;
    const scale = index < DEFAULT_LENGTH / 2 ? 8 : 0.00003;
    const floor = index < DEFAULT_LENGTH / 2 ? 100 : 0.0001;
    close = Math.max(floor, close + randomBetween(rng, -scale, scale * 1.1));
    bars.push(
      makeBar({
        timeIndex: index,
        open,
        close,
        rng,
        volume: index < DEFAULT_LENGTH / 2 ? 50_000 : 5,
        spreadFraction: index < DEFAULT_LENGTH / 2 ? 0.002 : 0.08,
      }),
    );
  }
  return bars;
};

const buildFlatFixture = (seed: number): PyrusSignalsBar[] => {
  const rng = mulberry32(seed);
  const bars: PyrusSignalsBar[] = [];
  for (let index = 0; index < DEFAULT_LENGTH; index += 1) {
    bars.push(
      makeBar({
        timeIndex: index,
        open: 42.42,
        close: 42.42,
        rng,
        volume: 1000,
        spreadFraction: 0,
      }),
    );
  }
  return bars.map((bar) => ({ ...bar, h: 42.42, l: 42.42 }));
};

const buildShortFixture = (
  seed: number,
  length: number,
): PyrusSignalsBar[] =>
  buildTrendFixture({
    seed,
    length,
    start: 25,
    drift: 0.15,
    noise: 0.2,
  });

const buildNonFiniteFixture = (seed: number): PyrusSignalsBar[] => {
  const bars = buildChoppyFixture(seed, DEFAULT_LENGTH);
  bars[17] = { ...bars[17], c: Number.NaN };
  bars[45] = { ...bars[45], h: Number.POSITIVE_INFINITY };
  bars[83] = { ...bars[83], l: Number.NEGATIVE_INFINITY };
  bars[144] = { ...bars[144], v: Number.NaN };
  bars[377] = { ...bars[377], o: Number.POSITIVE_INFINITY };
  return bars;
};

export const buildPyrusSignalsParityFixtures =
  (): PyrusSignalsParityFixture[] => {
    const adxLength = DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.adxLength;
    return [
      {
        name: "steady-uptrend",
        description: "1000 bars with persistent positive drift and mild noise.",
        seed: PYRUS_SIGNALS_FIXTURE_SEEDS.steadyUptrend,
        bars: buildTrendFixture({
          seed: PYRUS_SIGNALS_FIXTURE_SEEDS.steadyUptrend,
          length: DEFAULT_LENGTH,
          start: 45,
          drift: 0.075,
          noise: 0.045,
        }),
      },
      {
        name: "downtrend",
        description: "1000 bars with persistent negative drift and mild noise.",
        seed: PYRUS_SIGNALS_FIXTURE_SEEDS.downtrend,
        bars: buildTrendFixture({
          seed: PYRUS_SIGNALS_FIXTURE_SEEDS.downtrend,
          length: DEFAULT_LENGTH,
          start: 180,
          drift: -0.065,
          noise: 0.05,
        }),
      },
      {
        name: "choppy-mean-reverting",
        description: "1000 bars oscillating around a mean with stochastic shocks.",
        seed: PYRUS_SIGNALS_FIXTURE_SEEDS.choppyMeanReverting,
        bars: buildChoppyFixture(
          PYRUS_SIGNALS_FIXTURE_SEEDS.choppyMeanReverting,
          DEFAULT_LENGTH,
        ),
      },
      {
        name: "gappy",
        description:
          "1000 bars after deleting roughly 10% of candidate bars, leaving timestamp gaps.",
        seed: PYRUS_SIGNALS_FIXTURE_SEEDS.gappy,
        bars: buildGappyFixture(PYRUS_SIGNALS_FIXTURE_SEEDS.gappy),
      },
      {
        name: "low-liquidity",
        description: "1000 bars with frequent zero-volume and unchanged bars.",
        seed: PYRUS_SIGNALS_FIXTURE_SEEDS.lowLiquidity,
        bars: buildLowLiquidityFixture(PYRUS_SIGNALS_FIXTURE_SEEDS.lowLiquidity),
      },
      {
        name: "extreme-values",
        description:
          "1000 bars covering prices near 1e4 and near 1e-2 in one deterministic path.",
        seed: PYRUS_SIGNALS_FIXTURE_SEEDS.extremeValues,
        bars: buildExtremeValuesFixture(PYRUS_SIGNALS_FIXTURE_SEEDS.extremeValues),
      },
      {
        name: "flat",
        description: "1000 identical OHLCV bars.",
        seed: PYRUS_SIGNALS_FIXTURE_SEEDS.flat,
        bars: buildFlatFixture(PYRUS_SIGNALS_FIXTURE_SEEDS.flat),
      },
      {
        name: "short-adx-period-minus-1",
        description: `Short ADX guard fixture with ${adxLength - 1} bars.`,
        seed: PYRUS_SIGNALS_FIXTURE_SEEDS.shortMinusOne,
        bars: buildShortFixture(
          PYRUS_SIGNALS_FIXTURE_SEEDS.shortMinusOne,
          adxLength - 1,
        ),
      },
      {
        name: "short-adx-period",
        description: `Short ADX guard fixture with ${adxLength} bars.`,
        seed: PYRUS_SIGNALS_FIXTURE_SEEDS.shortPeriod,
        bars: buildShortFixture(
          PYRUS_SIGNALS_FIXTURE_SEEDS.shortPeriod,
          adxLength,
        ),
      },
      {
        name: "short-adx-guard-plus-1",
        description: `Short ADX guard fixture with ${adxLength * 2 + 1} bars.`,
        seed: PYRUS_SIGNALS_FIXTURE_SEEDS.shortAdxGuard,
        bars: buildShortFixture(
          PYRUS_SIGNALS_FIXTURE_SEEDS.shortAdxGuard,
          adxLength * 2 + 1,
        ),
      },
      {
        name: "non-finite",
        description:
          "1000 bars with NaN and +/-Infinity values; PyrusSignalsBar uses number fields, so the type permits them.",
        seed: PYRUS_SIGNALS_FIXTURE_SEEDS.nonFinite,
        bars: buildNonFiniteFixture(PYRUS_SIGNALS_FIXTURE_SEEDS.nonFinite),
      },
    ];
  };

export const PYRUS_SIGNALS_PARITY_FIXTURES =
  buildPyrusSignalsParityFixtures();

export const evaluatePyrusSignalsFixture = (
  chartBars: PyrusSignalsBar[],
  settings: PyrusSignalsSignalSettings = PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
  options: PyrusSignalsFixtureEvaluationOptions = {},
): PyrusSignalsEvaluation =>
  evaluatePyrusSignalsSignals({
    chartBars,
    settings,
    includeProvisionalSignals:
      options.includeProvisionalSignals ?? !settings.waitForBarClose,
    lastBarClosed: options.lastBarClosed ?? true,
  });

const normalizeStableValue = (value: unknown): StableJsonValue | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return "__NaN__";
    }
    if (value === Number.POSITIVE_INFINITY) {
      return "__Infinity__";
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return "__-Infinity__";
    }
    if (Object.is(value, -0)) {
      return "__-0__";
    }
    return value;
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeStableValue(entry) ?? null);
  }
  if (typeof value === "object") {
    const output: { [key: string]: StableJsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = normalizeStableValue(
        (value as Record<string, unknown>)[key],
      );
      if (normalized !== undefined) {
        output[key] = normalized;
      }
    }
    return output;
  }
  return String(value);
};

export const toStableJsonValue = (value: unknown): StableJsonValue => {
  const normalized = normalizeStableValue(value);
  return normalized === undefined ? null : normalized;
};

export const stableSerialize = (value: unknown): string =>
  `${JSON.stringify(toStableJsonValue(value))}\n`;

const isStableObject = (
  value: StableJsonValue | undefined,
): value is { [key: string]: StableJsonValue } =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const differenceIndexFromPath = (path: string): number | null => {
  const match = /\[(\d+)\](?!.*\[\d+\])/.exec(path);
  return match ? Number(match[1]) : null;
};

export const findFirstStableDifference = (
  expected: unknown,
  actual: unknown,
  path = "$",
): StableDifference | null => {
  const expectedValue =
    path === "$" ? toStableJsonValue(expected) : (expected as StableJsonValue);
  const actualValue =
    path === "$" ? toStableJsonValue(actual) : (actual as StableJsonValue);

  if (Object.is(expectedValue, actualValue)) {
    return null;
  }
  if (Array.isArray(expectedValue) || Array.isArray(actualValue)) {
    if (!Array.isArray(expectedValue) || !Array.isArray(actualValue)) {
      return {
        path,
        index: differenceIndexFromPath(path),
        expected: expectedValue,
        actual: actualValue,
        delta: null,
      };
    }
    const maxLength = Math.max(expectedValue.length, actualValue.length);
    for (let index = 0; index < maxLength; index += 1) {
      if (index >= expectedValue.length || index >= actualValue.length) {
        return {
          path: `${path}[${index}]`,
          index,
          expected: expectedValue[index],
          actual: actualValue[index],
          delta: null,
        };
      }
      const child = findFirstStableDifference(
        expectedValue[index],
        actualValue[index],
        `${path}[${index}]`,
      );
      if (child) {
        return child;
      }
    }
    return null;
  }
  if (isStableObject(expectedValue) || isStableObject(actualValue)) {
    if (!isStableObject(expectedValue) || !isStableObject(actualValue)) {
      return {
        path,
        index: differenceIndexFromPath(path),
        expected: expectedValue,
        actual: actualValue,
        delta: null,
      };
    }
    const keys = Array.from(
      new Set([...Object.keys(expectedValue), ...Object.keys(actualValue)]),
    ).sort();
    for (const key of keys) {
      if (!(key in expectedValue) || !(key in actualValue)) {
        return {
          path: `${path}.${key}`,
          index: differenceIndexFromPath(path),
          expected: expectedValue[key],
          actual: actualValue[key],
          delta: null,
        };
      }
      const child = findFirstStableDifference(
        expectedValue[key],
        actualValue[key],
        `${path}.${key}`,
      );
      if (child) {
        return child;
      }
    }
    return null;
  }
  return {
    path,
    index: differenceIndexFromPath(path),
    expected: expectedValue,
    actual: actualValue,
    delta:
      typeof expectedValue === "number" && typeof actualValue === "number"
        ? Math.abs(expectedValue - actualValue)
        : null,
  };
};

export const formatStableDifference = (
  difference: StableDifference | null,
): string => {
  if (!difference) {
    return "no stable difference";
  }
  const delta =
    difference.delta == null ? "" : ` absDelta=${difference.delta}`;
  const index =
    difference.index == null ? "" : ` index=${difference.index}`;
  return `${difference.path}${index}${delta}`;
};

export const assertStableEvaluationEqual = (
  actual: PyrusSignalsEvaluation,
  expected: PyrusSignalsEvaluation,
  message: string,
): void => {
  const actualBytes = stableSerialize(actual);
  const expectedBytes = stableSerialize(expected);
  if (actualBytes !== expectedBytes) {
    assert.fail(
      `${message}: ${formatStableDifference(
        findFirstStableDifference(expected, actual),
      )}`,
    );
  }
};

export const minimumAppendParityLength = (
  settings: PyrusSignalsSignalSettings = PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
): number => Math.max(1, settings.adxLength * 2 + 1);

export const assertAppendParity = (
  series: PyrusSignalsBar[],
  evaluateIncremental: IncrementalPyrusSignalsEvaluator,
  options: PyrusSignalsFixtureEvaluationOptions = {},
): void => {
  if (!series.length) {
    return;
  }
  const start = Math.min(series.length, minimumAppendParityLength());
  for (let length = start; length <= series.length; length += 1) {
    const prefix = series.slice(0, length);
    const fresh = evaluatePyrusSignalsFixture(
      prefix,
      PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
      options,
    );
    const incremental = evaluateIncremental(prefix);
    const freshBytes = stableSerialize(fresh);
    const incrementalBytes = stableSerialize(incremental);
    if (freshBytes !== incrementalBytes) {
      assert.fail(
        `append parity diverged at k=${length}: ${formatStableDifference(
          findFirstStableDifference(fresh, incremental),
        )}`,
      );
    }
  }
};

const normalizeSignalEvent = (
  event: PyrusSignalsSignalEvent,
  startIndex: number,
): PyrusSignalsSignalEvent => {
  const barIndex = event.barIndex - startIndex;
  const prefix = event.eventType === "buy_signal" ? "buy" : "sell";
  return {
    ...event,
    id: `${prefix}-${barIndex}-${event.time}`,
    barIndex,
  };
};

const normalizeStructureEvent = (
  event: PyrusSignalsStructureEvent,
  startIndex: number,
): PyrusSignalsStructureEvent => {
  const barIndex = event.barIndex - startIndex;
  return {
    ...event,
    id: `${event.eventType}-${barIndex}-${event.time}`,
    barIndex,
  };
};

export const projectEvaluationTail = (
  evaluation: PyrusSignalsEvaluation,
  sourceLength: number,
  tailBars = PYRUS_SIGNALS_FIXTURE_TAIL_BARS,
): PyrusSignalsEvaluation => {
  const startIndex = Math.max(0, sourceLength - tailBars);
  return {
    basis: evaluation.basis.slice(startIndex),
    atrRaw: evaluation.atrRaw.slice(startIndex),
    atrSmoothed: evaluation.atrSmoothed.slice(startIndex),
    upperBand: evaluation.upperBand.slice(startIndex),
    lowerBand: evaluation.lowerBand.slice(startIndex),
    trendLine: evaluation.trendLine.slice(startIndex),
    bullWires: evaluation.bullWires.map((wire) =>
      wire.slice(startIndex),
    ) as [number[], number[], number[]],
    bearWires: evaluation.bearWires.map((wire) =>
      wire.slice(startIndex),
    ) as [number[], number[], number[]],
    adx: evaluation.adx.slice(startIndex),
    volatilityScore: evaluation.volatilityScore.slice(startIndex),
    trendDirection: evaluation.trendDirection.slice(startIndex),
    regimeDirection: evaluation.regimeDirection.slice(startIndex),
    trendBasisComputable: evaluation.trendBasisComputable,
    marketStructureDirection: evaluation.marketStructureDirection,
    structureEvents: evaluation.structureEvents
      .filter((event) => event.barIndex >= startIndex)
      .map((event) => normalizeStructureEvent(event, startIndex)),
    signalEvents: evaluation.signalEvents
      .filter((event) => event.barIndex >= startIndex)
      .map((event) => normalizeSignalEvent(event, startIndex)),
  };
};
