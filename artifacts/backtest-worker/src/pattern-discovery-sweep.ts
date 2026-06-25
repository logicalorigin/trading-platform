// Bounded MTF pattern-discovery sweep.
//
// Persists one DB-backed mtf_pattern_discovery study per settings variant, then
// writes a small markdown/JSON report. This is intentionally narrower than the
// full worker loop: it is a reproducible research runner for comparing Pyrus
// signal-setting profiles in the Backtest Pattern Discovery UI.
//
// Run from artifacts/backtest-worker:
//   node --import tsx src/pattern-discovery-sweep.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  backtestStudiesTable,
  db,
  historicalBarDatasetsTable,
  historicalBarsTable,
  mtfPatternOccurrencesTable,
  mtfPatternResultsTable,
} from "@workspace/db";
import { DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS } from "@workspace/pyrus-signals-core";
import type { PyrusSignalsSignalSettings } from "@workspace/pyrus-signals-core";
import type { BacktestBar } from "@workspace/backtest-core";
import { and, asc, eq, gte } from "drizzle-orm";

import {
  computeDirectionEvents,
  DEFAULT_SIGNAL_SETTINGS_BY_TIMEFRAME,
  sampleTransitions,
  scorePatterns,
  type DirectionEvent,
  type PatternOccurrence,
  type PatternResultRow,
} from "./pattern-discovery";

const SYMBOLS = (process.env.PYRUS_SWEEP_SYMBOLS ?? "SPY,QQQ")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TIMEFRAME_SET = ["1m", "2m", "5m", "15m", "1h"];
const BASE_TF = "1m";
const HORIZONS = [3, 6, 12, 24];
const LOAD_FROM = new Date(process.env.PYRUS_SWEEP_LOAD_FROM ?? "2026-04-16T00:00:00Z");
const STUDY_FROM = new Date(process.env.PYRUS_SWEEP_STUDY_FROM ?? "2026-04-24T00:00:00Z");
const MIN_SAMPLE = 1;

// Live charts/signals baseline (DEFAULT_PYRUS_SIGNALS_SETTINGS in the UI pine adapter):
// timeHorizon 8, BOS wicks, CHoCH buffer 0 — uniform across every interval. This is the
// real product default, distinct from the per-timeframe research map below and from the
// core constant (timeHorizon 10). Gated by PYRUS_SWEEP_BASELINE=live-ui.
const USE_LIVE_UI_BASE = process.env.PYRUS_SWEEP_BASELINE === "live-ui";
const LIVE_UI_BASE: Partial<PyrusSignalsSignalSettings> = {
  timeHorizon: 8,
  bosConfirmation: "wicks",
  chochAtrBuffer: 0,
};
const HORIZON_GRID = [4, 6, 8, 10, 12, 16, 20];

type SettingsPatch = Record<string, Partial<PyrusSignalsSignalSettings>>;

type SweepVariant = {
  id: string;
  label: string;
  description: string;
  signalSettingsByTimeframe: SettingsPatch;
};

type SweepKind = "time-horizon" | "settings";
type NumericSweepSetting =
  | "basisLength"
  | "atrLength"
  | "atrSmoothing"
  | "volatilityMultiplier"
  | "chochAtrBuffer";

const SETUP_FAMILIES = [
  "bull_confluence",
  "bear_confluence",
  "fast_bullish_reversal",
  "fast_bearish_reversal",
  "mixed_divergence",
  "inactive",
] as const;

type SetupFamily = (typeof SETUP_FAMILIES)[number];

type FamilyHorizonSummary = {
  family: SetupFamily;
  horizonBars: number;
  patternCount: number;
  sampleCount: number;
  weightedMeanReturnPct: number | null;
  bestPatternKey: string | null;
  bestAbsTStat: number | null;
  bestBias: string | null;
};

const FAST_HORIZON_PROFILES = [
  { id: "fast", label: "fast", h1m: 6, h2m: 6 },
  { id: "base", label: "base", h1m: 12, h2m: 10 },
  { id: "slow", label: "slow", h1m: 16, h2m: 14 },
] as const;
const CONTEXT_HORIZON_PROFILES = [
  { id: "tight", label: "tight", h5m: 6, h15m: 6 },
  { id: "base", label: "base", h5m: 8, h15m: 8 },
  { id: "slow", label: "slow", h5m: 12, h15m: 12 },
] as const;
const ONE_FACTOR_HORIZON_PROFILES = [
  { timeframe: "1m", id: "fast", label: "1m fast only", timeHorizon: 6 },
  { timeframe: "1m", id: "slow", label: "1m slow only", timeHorizon: 16 },
  { timeframe: "2m", id: "fast", label: "2m fast only", timeHorizon: 6 },
  { timeframe: "2m", id: "slow", label: "2m slow only", timeHorizon: 14 },
  { timeframe: "5m", id: "tight", label: "5m tight only", timeHorizon: 6 },
  { timeframe: "5m", id: "slow", label: "5m slow only", timeHorizon: 12 },
  { timeframe: "15m", id: "tight", label: "15m tight only", timeHorizon: 6 },
  { timeframe: "15m", id: "slow", label: "15m slow only", timeHorizon: 12 },
  { timeframe: "1h", id: "tight", label: "1h tight only", timeHorizon: 4 },
  { timeframe: "1h", id: "slow", label: "1h slow only", timeHorizon: 10 },
] as const;

const NUMERIC_SETTING_SWEEPS: Array<{
  key: NumericSweepSetting;
  label: string;
  lowLabel: string;
  highLabel: string;
  low: (base: number) => number;
  high: (base: number) => number;
}> = [
  {
    key: "basisLength",
    label: "basis length",
    lowLabel: "short",
    highLabel: "long",
    low: (base) => Math.max(1, Math.round(base * 0.75)),
    high: (base) => Math.min(240, Math.round(base * 1.25)),
  },
  {
    key: "atrLength",
    label: "ATR length",
    lowLabel: "short",
    highLabel: "long",
    low: (base) => Math.max(1, Math.round(base * 0.7)),
    high: (base) => Math.min(100, Math.round(base * 1.5)),
  },
  {
    key: "atrSmoothing",
    label: "ATR smoothing",
    lowLabel: "fast",
    highLabel: "slow",
    low: (base) => Math.max(1, Math.round(base * 0.67)),
    high: (base) => Math.min(200, Math.round(base * 1.33)),
  },
  {
    key: "volatilityMultiplier",
    label: "volatility multiplier",
    lowLabel: "tight",
    highLabel: "wide",
    low: (base) => round2(Math.max(0.1, base * 0.8)),
    high: (base) => round2(Math.min(10, base * 1.2)),
  },
  {
    key: "chochAtrBuffer",
    label: "CHOCH ATR buffer",
    lowLabel: "loose",
    highLabel: "strict",
    low: () => 0,
    high: (base) => round2(Math.min(20, Math.max(0.05, base * 2))),
  },
];

function activeSweepKind(): SweepKind {
  return process.env.PYRUS_PATTERN_SWEEP_KIND === "settings"
    ? "settings"
    : "time-horizon";
}

const SWEEP_KIND = activeSweepKind();
const SWEEP_ID = USE_LIVE_UI_BASE
  ? "pattern-discovery-liveui-horizon"
  : SWEEP_KIND === "settings"
    ? "pattern-discovery-settings-v2"
    : "pattern-discovery-time-horizon-v3";

const round2 = (value: number): number => Number(value.toFixed(2));

// Per-interval base settings. With PYRUS_SWEEP_BASELINE=live-ui this is the uniform live
// charts/signals default; otherwise it is the per-timeframe research calibration map.
function timeframeBase(timeframe: string): PyrusSignalsSignalSettings {
  return USE_LIVE_UI_BASE
    ? { ...DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS, ...LIVE_UI_BASE }
    : {
        ...DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS,
        ...(DEFAULT_SIGNAL_SETTINGS_BY_TIMEFRAME[timeframe] ?? {}),
      };
}

function baseSetting<K extends keyof PyrusSignalsSignalSettings>(
  timeframe: string,
  key: K,
): PyrusSignalsSignalSettings[K] {
  return timeframeBase(timeframe)[key];
}

// Live-UI horizon grid: baseline = H8 uniform; one-factor variants step each interval's
// timeHorizon across HORIZON_GRID while every other interval stays at the H8 base.
function buildLiveUiHorizonVariants(): SweepVariant[] {
  const variants: SweepVariant[] = [
    {
      id: "baseline-live-ui-h8",
      label: "Baseline live-UI (H=8 all)",
      description:
        "Live charts/signals defaults: timeHorizon 8, BOS wicks, CHoCH 0, uniform across all intervals.",
      signalSettingsByTimeframe: {},
    },
  ];
  for (const timeframe of TIMEFRAME_SET) {
    for (const h of HORIZON_GRID) {
      if (h === 8) continue;
      variants.push({
        id: `liveui-${timeframe}-h${h}`,
        label: `${timeframe} H=${h}`,
        description: `One-factor timeHorizon: ${timeframe}=${h}; all other intervals stay at the H=8 live-UI base.`,
        signalSettingsByTimeframe: { [timeframe]: { timeHorizon: h } },
      });
    }
  }
  return variants;
}

function buildTimeHorizonVariants(): SweepVariant[] {
  const variants: SweepVariant[] = [
    {
      id: "baseline-calibrated-defaults",
      label: "Baseline calibrated defaults",
      description: "Current per-timeframe defaults from pattern-discovery.ts.",
      signalSettingsByTimeframe: {},
    },
  ];
  for (const profile of ONE_FACTOR_HORIZON_PROFILES) {
    variants.push({
      id: `horizon-${profile.timeframe}-${profile.id}-only`,
      label: profile.label,
      description: `One-factor timeHorizon change: ${profile.timeframe}=${profile.timeHorizon}, all other timeframe settings use defaults.`,
      signalSettingsByTimeframe: {
        [profile.timeframe]: { timeHorizon: profile.timeHorizon },
      },
    });
  }
  for (const fast of FAST_HORIZON_PROFILES) {
    for (const context of CONTEXT_HORIZON_PROFILES) {
      const id = `horizon-${fast.id}-fast-${context.id}-context`;
      if (id === "horizon-base-fast-base-context") continue;
      variants.push({
        id,
        label: `${fast.label} fast / ${context.label} context`,
        description: `timeHorizon grid: 1m=${fast.h1m}, 2m=${fast.h2m}, 5m=${context.h5m}, 15m=${context.h15m}.`,
        signalSettingsByTimeframe: {
          "1m": { timeHorizon: fast.h1m },
          "2m": { timeHorizon: fast.h2m },
          "5m": { timeHorizon: context.h5m },
          "15m": { timeHorizon: context.h15m },
        },
      });
    }
  }
  return variants;
}

function buildSettingsVariants(): SweepVariant[] {
  const variants: SweepVariant[] = [
    {
      id: "baseline-calibrated-defaults",
      label: "Baseline calibrated defaults",
      description: "Current per-timeframe defaults from pattern-discovery.ts.",
      signalSettingsByTimeframe: {},
    },
  ];

  for (const next of ["close", "wicks"] as const) {
    const patch = Object.fromEntries(
      TIMEFRAME_SET.map((timeframe) => [timeframe, { bosConfirmation: next }]),
    ) as SettingsPatch;
    const changedCount = TIMEFRAME_SET.filter(
      (timeframe) => baseSetting(timeframe, "bosConfirmation") !== next,
    ).length;
    if (changedCount > 0) {
      variants.push({
        id: `setting-all-bos-confirmation-${next}`,
        label: `all frames BOS ${next}`,
        description: `Profile bosConfirmation change: all active timeframes use ${next}.`,
        signalSettingsByTimeframe: patch,
      });
    }
  }

  for (const timeframe of TIMEFRAME_SET) {
    const base = baseSetting(timeframe, "bosConfirmation");
    const next = base === "close" ? "wicks" : "close";
    variants.push({
      id: `setting-${timeframe}-bos-confirmation-${next}`,
      label: `${timeframe} BOS ${next}`,
      description: `One-factor bosConfirmation change: ${timeframe} ${base} -> ${next}.`,
      signalSettingsByTimeframe: {
        [timeframe]: { bosConfirmation: next },
      },
    });
  }

  for (const setting of NUMERIC_SETTING_SWEEPS) {
    for (const profile of [
      { id: setting.lowLabel, value: setting.low },
      { id: setting.highLabel, value: setting.high },
    ]) {
      const patch = Object.fromEntries(
        TIMEFRAME_SET.map((timeframe) => {
          const base = Number(baseSetting(timeframe, setting.key));
          return [timeframe, { [setting.key]: profile.value(base) }];
        }),
      ) as SettingsPatch;
      variants.push({
        id: `setting-all-${setting.key}-${profile.id}`,
        label: `all frames ${setting.label} ${profile.id}`,
        description: `Profile ${setting.key} change: all active timeframes use ${profile.id} values around their calibrated defaults.`,
        signalSettingsByTimeframe: patch,
      });
    }

    for (const timeframe of TIMEFRAME_SET) {
      const base = Number(baseSetting(timeframe, setting.key));
      const values = [
        { id: setting.lowLabel, value: setting.low(base) },
        { id: setting.highLabel, value: setting.high(base) },
      ].filter((entry, index, list) => {
        if (entry.value === base) return false;
        return list.findIndex((candidate) => candidate.value === entry.value) === index;
      });
      for (const { id, value } of values) {
        variants.push({
          id: `setting-${timeframe}-${setting.key}-${id}`,
          label: `${timeframe} ${setting.label} ${id}`,
          description: `One-factor ${setting.key} change: ${timeframe} ${base} -> ${value}.`,
          signalSettingsByTimeframe: {
            [timeframe]: { [setting.key]: value },
          },
        });
      }
    }
  }

  return variants;
}

const VARIANTS: SweepVariant[] = USE_LIVE_UI_BASE
  ? buildLiveUiHorizonVariants()
  : SWEEP_KIND === "settings"
    ? buildSettingsVariants()
    : buildTimeHorizonVariants();
const POSSIBLE_PATTERN_COUNT = 3 ** TIMEFRAME_SET.length;

const num = (value: unknown): number => Number(value);
const numStr = (value: number | null): string | null =>
  value == null ? null : String(value);

async function load1m(symbol: string): Promise<BacktestBar[]> {
  const rows = await db
    .select({
      startsAt: historicalBarsTable.startsAt,
      open: historicalBarsTable.open,
      high: historicalBarsTable.high,
      low: historicalBarsTable.low,
      close: historicalBarsTable.close,
      volume: historicalBarsTable.volume,
    })
    .from(historicalBarsTable)
    .innerJoin(
      historicalBarDatasetsTable,
      eq(historicalBarsTable.datasetId, historicalBarDatasetsTable.id),
    )
    .where(
      and(
        eq(historicalBarDatasetsTable.symbol, symbol),
        eq(historicalBarDatasetsTable.timeframe, "1m"),
        gte(historicalBarsTable.startsAt, LOAD_FROM),
      ),
    )
    .orderBy(asc(historicalBarsTable.startsAt));
  const byTime = new Map<number, BacktestBar>();
  for (const row of rows) {
    const t = row.startsAt.getTime();
    if (!byTime.has(t)) {
      byTime.set(t, {
        startsAt: row.startsAt,
        open: num(row.open),
        high: num(row.high),
        low: num(row.low),
        close: num(row.close),
        volume: num(row.volume),
      });
    }
  }
  return [...byTime.values()].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
}

function aggregate(bars: BacktestBar[], minutes: number): BacktestBar[] {
  if (minutes === 1) return bars;
  const bucketMs = minutes * 60_000;
  const buckets = new Map<number, BacktestBar>();
  for (const bar of bars) {
    const key = Math.floor(bar.startsAt.getTime() / bucketMs) * bucketMs;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        startsAt: new Date(key),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }
  return [...buckets.values()].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
}

function timeframeMinutes(timeframe: string): number {
  switch (timeframe) {
    case "1m":
      return 1;
    case "2m":
      return 2;
    case "5m":
      return 5;
    case "15m":
      return 15;
    case "1h":
      return 60;
    default:
      throw new Error(`Unsupported sweep timeframe ${timeframe}`);
  }
}

function resolveSettings(
  timeframe: string,
  variant: SweepVariant,
): PyrusSignalsSignalSettings {
  return {
    ...timeframeBase(timeframe),
    ...(variant.signalSettingsByTimeframe[timeframe] ?? {}),
  };
}

function setupFamily(patternKey: string): SetupFamily {
  const directions = patternKey.split("|").map((part) => part.split(":")[1] ?? "none");
  const buyCount = directions.filter((direction) => direction === "buy").length;
  const sellCount = directions.filter((direction) => direction === "sell").length;
  if (buyCount === 0 && sellCount === 0) return "inactive";
  if (buyCount > 0 && sellCount === 0) return "bull_confluence";
  if (sellCount > 0 && buyCount === 0) return "bear_confluence";
  const splitIndex = Math.max(1, Math.floor(directions.length / 2));
  const fast = directions.slice(0, splitIndex);
  const slow = directions.slice(splitIndex);
  const fastBuy = fast.filter((direction) => direction === "buy").length;
  const fastSell = fast.filter((direction) => direction === "sell").length;
  const slowBuy = slow.filter((direction) => direction === "buy").length;
  const slowSell = slow.filter((direction) => direction === "sell").length;
  if (fastBuy > fastSell && slowSell > slowBuy) return "fast_bullish_reversal";
  if (fastSell > fastBuy && slowBuy > slowSell) return "fast_bearish_reversal";
  return "mixed_divergence";
}

const round6 = (value: number): number => Number(value.toFixed(6));

function summarizeFamiliesByHorizon(results: PatternResultRow[]): FamilyHorizonSummary[] {
  return HORIZONS.flatMap((horizon) =>
    SETUP_FAMILIES.map((family) => {
      const rows = results.filter(
        (row) => row.horizonBars === horizon && setupFamily(row.patternKey) === family,
      );
      const sampleCount = rows.reduce((sum, row) => sum + row.sampleCount, 0);
      const weightedReturnSum = rows.reduce(
        (sum, row) => sum + (row.meanReturnPct ?? 0) * row.sampleCount,
        0,
      );
      const best = [...rows].sort(
        (a, b) =>
          Math.abs(b.tStat ?? 0) - Math.abs(a.tStat ?? 0) ||
          b.sampleCount - a.sampleCount,
      )[0];
      return {
        family,
        horizonBars: horizon,
        patternCount: rows.length,
        sampleCount,
        weightedMeanReturnPct:
          sampleCount > 0 ? round6(weightedReturnSum / sampleCount) : null,
        bestPatternKey: best?.patternKey ?? null,
        bestAbsTStat: best?.tStat == null ? null : round6(Math.abs(best.tStat)),
        bestBias: best?.bias ?? null,
      };
    }),
  );
}

async function persistVariant(input: {
  variant: SweepVariant;
  endsAt: Date;
  results: PatternResultRow[];
  occurrenceRows: ReturnType<typeof scorePatterns>["occurrenceRows"];
}): Promise<string> {
  const { variant, endsAt, results, occurrenceRows } = input;
  const [study] = await db
    .insert(backtestStudiesTable)
    .values({
      name: `MTF Pattern Sweep - ${variant.label}`,
      strategyId: "mtf_pattern_discovery",
      strategyVersion: "v1",
      symbols: SYMBOLS,
      timeframe: BASE_TF,
      startsAt: STUDY_FROM,
      endsAt,
      parameters: {
        sweep: SWEEP_ID,
        sweepKind: SWEEP_KIND,
        variantId: variant.id,
        variantLabel: variant.label,
        variantDescription: variant.description,
        symbols: SYMBOLS,
        timeframeSet: TIMEFRAME_SET,
        baseTimeframe: BASE_TF,
        forwardHorizonsBars: HORIZONS,
        minSampleThreshold: MIN_SAMPLE,
        possiblePatternCount: POSSIBLE_PATTERN_COUNT,
        setupFamilies: SETUP_FAMILIES,
        signalSettingsByTimeframe: variant.signalSettingsByTimeframe,
        persistOccurrences: true,
      },
      portfolioRules: {},
      executionProfile: {},
      optimizerConfig: {},
    })
    .returning();

  const dataQuality = {
    signalSource: "pyrus-signals-core(sweep-aggregated-1m)",
    timeframeSet: TIMEFRAME_SET,
    baseTimeframe: BASE_TF,
    variantId: variant.id,
  };

  for (let i = 0; i < results.length; i += 500) {
    await db.insert(mtfPatternResultsTable).values(
      results.slice(i, i + 500).map((row) => ({
        studyId: study.id,
        patternKey: row.patternKey,
        timeframeSet: TIMEFRAME_SET,
        baseTimeframe: BASE_TF,
        horizonBars: row.horizonBars,
        sampleCount: row.sampleCount,
        bias: row.bias,
        winRatePct: numStr(row.winRatePct),
        meanReturnPct: numStr(row.meanReturnPct),
        medianReturnPct: numStr(row.medianReturnPct),
        stdReturnPct: numStr(row.stdReturnPct),
        avgMaePct: numStr(row.avgMaePct),
        avgMfePct: numStr(row.avgMfePct),
        score: numStr(row.score),
        tStat: numStr(row.tStat),
        rank: row.rank,
        dataQuality,
      })),
    );
  }

  for (let i = 0; i < occurrenceRows.length; i += 1000) {
    await db.insert(mtfPatternOccurrencesTable).values(
      occurrenceRows.slice(i, i + 1000).map((row) => ({
        studyId: study.id,
        symbol: row.symbol,
        occurredAt: row.occurredAt,
        patternKey: row.patternKey,
        horizonBars: row.horizonBars,
        realizedReturnPct: numStr(row.realizedReturnPct),
        maePct: numStr(row.maePct),
        mfePct: numStr(row.mfePct),
      })),
    );
  }

  return study.id;
}

async function runVariant(variant: SweepVariant) {
  const occurrences: PatternOccurrence[] = [];
  const baseBarsBySymbol: Record<string, BacktestBar[]> = {};
  const coverage: string[] = [];
  let endsAt = STUDY_FROM;

  for (const symbol of SYMBOLS) {
    const bars1m = await load1m(symbol);
    if (bars1m.length === 0) {
      coverage.push(`${symbol}: no 1m bars`);
      continue;
    }
    const last = bars1m[bars1m.length - 1].startsAt;
    if (last.getTime() > endsAt.getTime()) endsAt = last;
    const barsByTf: Record<string, BacktestBar[]> = {};
    for (const timeframe of TIMEFRAME_SET) {
      barsByTf[timeframe] = aggregate(bars1m, timeframeMinutes(timeframe));
    }
    baseBarsBySymbol[symbol] = barsByTf[BASE_TF];

    const eventsByTf: Record<string, DirectionEvent[]> = {};
    for (const timeframe of TIMEFRAME_SET) {
      const events = computeDirectionEvents(
        barsByTf[timeframe],
        resolveSettings(timeframe, variant),
      );
      eventsByTf[timeframe] = events;
      coverage.push(
        `${symbol} ${timeframe}: ${barsByTf[timeframe].length} bars, ${events.length} signal events`,
      );
    }

    const inWindow = baseBarsBySymbol[symbol].filter(
      (bar) => bar.startsAt.getTime() >= STUDY_FROM.getTime(),
    );
    occurrences.push(
      ...sampleTransitions({
        symbol,
        timeframeSet: TIMEFRAME_SET,
        baseBars: inWindow,
        eventsByTimeframe: eventsByTf,
      }),
    );
  }

  const { results, occurrenceRows } = scorePatterns({
    occurrences,
    barsBySymbol: baseBarsBySymbol,
    baseTimeframe: BASE_TF,
    horizonsBars: HORIZONS,
    minSampleThreshold: MIN_SAMPLE,
  });
  const studyId = await persistVariant({
    variant,
    endsAt,
    results,
    occurrenceRows,
  });
  const allByHorizon = Object.fromEntries(
    HORIZONS.map((horizon) => [
      horizon,
      results
        .filter((row) => row.horizonBars === horizon)
        .sort((a, b) => a.rank - b.rank),
    ]),
  );

  return {
    variant,
    studyId,
    coverage,
    occurrenceCount: occurrences.length,
    resultCount: results.length,
    occurrenceRowCount: occurrenceRows.length,
    allByHorizon,
    topByHorizon: Object.fromEntries(
      HORIZONS.map((horizon) => [
        horizon,
        allByHorizon[horizon]?.slice(0, 10) ?? [],
      ]),
    ),
    familyByHorizon: summarizeFamiliesByHorizon(results),
    familyCounts: results.reduce<Record<string, number>>((acc, row) => {
      const family = setupFamily(row.patternKey);
      acc[family] = (acc[family] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

type VariantSummary = Awaited<ReturnType<typeof runVariant>>;

type BestFamilyCandidate = FamilyHorizonSummary & {
  studyId: string;
  variantId: string;
  variantLabel: string;
};

function metric(value: number | null | undefined): string {
  return value == null ? "" : value.toFixed(6);
}

function signedMetric(value: number | null | undefined): string {
  if (value == null) return "";
  const fixed = value.toFixed(6);
  return value > 0 ? `+${fixed}` : fixed;
}

function resultKey(row: Pick<PatternResultRow, "horizonBars" | "patternKey">): string {
  return `${row.horizonBars}::${row.patternKey}`;
}

function bestFamilyCandidates(summaries: VariantSummary[]): BestFamilyCandidate[] {
  return HORIZONS.flatMap((horizon) =>
    SETUP_FAMILIES.flatMap((family) => {
      const candidates = summaries
        .flatMap((summary) =>
          summary.familyByHorizon
            .filter((row) => row.horizonBars === horizon && row.family === family)
            .map((row) => ({
              ...row,
              studyId: summary.studyId,
              variantId: summary.variant.id,
              variantLabel: summary.variant.label,
            })),
        )
        .filter((row) => row.sampleCount > 0 && row.bestPatternKey != null)
        .sort(
          (a, b) =>
            (b.bestAbsTStat ?? 0) - (a.bestAbsTStat ?? 0) ||
            b.sampleCount - a.sampleCount ||
            Math.abs(b.weightedMeanReturnPct ?? 0) -
              Math.abs(a.weightedMeanReturnPct ?? 0),
        );
      return candidates[0] ? [candidates[0]] : [];
    }),
  );
}

function writeReport(summaries: VariantSummary[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = fileURLToPath(
    new URL(`../../../reports/pattern-discovery-sweeps/${stamp}/`, import.meta.url),
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/results.json`, JSON.stringify(summaries, null, 2));

  const lines: string[] = [];
  lines.push("# MTF Pattern Discovery Settings Sweep");
  lines.push("");
  lines.push(`- Symbols: ${SYMBOLS.join(", ")}`);
  lines.push(`- Timeframes: ${TIMEFRAME_SET.join(", ")}`);
  lines.push(`- Horizons: ${HORIZONS.join(", ")}`);
  lines.push(`- Study window: ${STUDY_FROM.toISOString()} through latest loaded bar`);
  lines.push(`- Min sample threshold: ${MIN_SAMPLE}`);
  lines.push(`- Sweep kind: ${SWEEP_KIND}`);
  lines.push(`- Sweep ID: ${SWEEP_ID}`);
  lines.push(`- Possible direction combinations per horizon: ${POSSIBLE_PATTERN_COUNT}`);
  lines.push(`- Variants: ${summaries.length}`);
  lines.push("");

  lines.push("## Cross-Variant Best By Family/Horizon");
  lines.push("");
  lines.push(
    "| Horizon | Family | Variant | Study ID | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |",
  );
  lines.push("| ---: | --- | --- | --- | ---: | ---: | --- | ---: | --- |");
  for (const row of bestFamilyCandidates(summaries)) {
    lines.push(
      `| ${row.horizonBars} | ${row.family} | ${row.variantLabel} | \`${row.studyId}\` | ${row.sampleCount} | ${metric(row.weightedMeanReturnPct)} | \`${row.bestPatternKey ?? ""}\` | ${metric(row.bestAbsTStat)} | ${row.bestBias ?? ""} |`,
    );
  }
  lines.push("");

  const baseline = summaries.find(
    (summary) => summary.variant.id === "baseline-calibrated-defaults",
  );
  const baselineByPattern = new Map<string, PatternResultRow>();
  for (const rows of Object.values(baseline?.allByHorizon ?? {})) {
    for (const row of rows) baselineByPattern.set(resultKey(row), row);
  }

  for (const summary of summaries) {
    lines.push(`## ${summary.variant.label}`);
    lines.push("");
    lines.push(`- Study ID: \`${summary.studyId}\``);
    lines.push(`- Variant: \`${summary.variant.id}\``);
    lines.push(`- Description: ${summary.variant.description}`);
    lines.push(`- Observed transitions: ${summary.occurrenceCount}`);
    lines.push(`- Result rows: ${summary.resultCount}`);
    lines.push(`- Occurrence rows: ${summary.occurrenceRowCount}`);
    lines.push(`- Family rows: \`${JSON.stringify(summary.familyCounts)}\``);
    lines.push("");
    lines.push("### Family Summary By Horizon");
    lines.push("");
    lines.push(
      "| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |",
    );
    lines.push("| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |");
    for (const row of summary.familyByHorizon) {
      lines.push(
        `| ${row.horizonBars} | ${row.family} | ${row.patternCount} | ${row.sampleCount} | ${metric(row.weightedMeanReturnPct)} | \`${row.bestPatternKey ?? ""}\` | ${metric(row.bestAbsTStat)} | ${row.bestBias ?? ""} |`,
      );
    }
    lines.push("");
    lines.push("### All Observed Combination Outcomes");
    lines.push("");
    lines.push(
      "| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |",
    );
    lines.push(
      "| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const horizon of HORIZONS) {
      for (const row of summary.allByHorizon[horizon] ?? []) {
        const baselineRow = baselineByPattern.get(resultKey(row));
        const meanDelta =
          baselineRow?.meanReturnPct == null || row.meanReturnPct == null
            ? null
            : row.meanReturnPct - baselineRow.meanReturnPct;
        const winDelta =
          baselineRow?.winRatePct == null || row.winRatePct == null
            ? null
            : row.winRatePct - baselineRow.winRatePct;
        lines.push(
          `| ${horizon} | ${row.rank} | \`${row.patternKey}\` | ${setupFamily(row.patternKey)} | ${row.sampleCount} | ${row.bias} | ${metric(row.meanReturnPct)} | ${signedMetric(meanDelta)} | ${metric(row.winRatePct)} | ${signedMetric(winDelta)} | ${metric(row.medianReturnPct)} | ${metric(row.stdReturnPct)} | ${metric(row.avgMaePct)} | ${metric(row.avgMfePct)} | ${metric(row.tStat)} | ${metric(row.score)} |`,
        );
      }
    }
    lines.push("");
    for (const horizon of HORIZONS) {
      lines.push(`### Horizon ${horizon} bars`);
      lines.push("");
      lines.push("| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |");
      lines.push("| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |");
      for (const row of summary.topByHorizon[horizon] ?? []) {
        lines.push(
          `| ${row.rank} | \`${row.patternKey}\` | ${setupFamily(row.patternKey)} | ${row.sampleCount} | ${row.bias} | ${metric(row.meanReturnPct)} | ${metric(row.winRatePct)} | ${metric(row.tStat)} |`,
        );
      }
      lines.push("");
    }
  }
  writeFileSync(`${dir}/report.md`, `${lines.join("\n")}\n`);
  return dir;
}

async function main(): Promise<void> {
  const summaries = [];
  for (const variant of VARIANTS) {
    console.log(`\n=== running ${variant.id} ===`);
    const summary = await runVariant(variant);
    summaries.push(summary);
    console.log(
      `${variant.id}: study=${summary.studyId} transitions=${summary.occurrenceCount} results=${summary.resultCount} occurrenceRows=${summary.occurrenceRowCount}`,
    );
  }
  const reportDir = writeReport(summaries);
  console.log(`\nSWEEP OK: ${reportDir}`);
}

main().catch((error) => {
  console.error("SWEEP FAILED:", error);
  process.exit(1);
});
