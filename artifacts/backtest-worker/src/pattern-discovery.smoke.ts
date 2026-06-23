// Live smoke for the MTF pattern-discovery engine. Loads REAL 1m SPY+QQQ bars from
// the DB, aggregates to 1m/2m/5m/15m, runs the real engine (signal compute -> pattern
// sampling -> forward-return scoring), persists to mtf_pattern_results, and reads back.
// Run from artifacts/backtest-worker: node --import tsx src/pattern-discovery.smoke.ts
//
// NOTE: production loads NATIVE per-TF bars; only 1m is seeded locally, so this smoke
// aggregates from 1m (a faithful proxy - that is how higher-TF bars are formed).
import {
  backtestStudiesTable,
  db,
  historicalBarDatasetsTable,
  historicalBarsTable,
  mtfPatternOccurrencesTable,
  mtfPatternResultsTable,
} from "@workspace/db";
import { DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS } from "@workspace/pyrus-signals-core";
import type { BacktestBar } from "@workspace/backtest-core";
import { and, asc, eq, gte } from "drizzle-orm";

import {
  computeDirectionEvents,
  DEFAULT_SIGNAL_SETTINGS_BY_TIMEFRAME,
  sampleTransitions,
  scorePatterns,
  type DirectionEvent,
  type PatternOccurrence,
} from "./pattern-discovery";

const SYMBOLS = ["SPY", "QQQ"];
const TIMEFRAME_SET = ["1m", "2m", "5m", "15m"];
const BASE_TF = "1m";
const HORIZONS = [3, 6, 12];
const LOAD_FROM = new Date("2026-04-16T00:00:00Z"); // earliest both symbols cover
const STUDY_FROM = new Date("2026-04-24T00:00:00Z"); // warmup = LOAD_FROM..STUDY_FROM
const MIN_SAMPLE = 5; // smoke threshold (production default 30)

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
  // Dedup overlapping datasets by timestamp.
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
      existing.close = bar.close; // bars are time-ordered -> last in bucket
      existing.volume += bar.volume;
    }
  }
  return [...buckets.values()].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
}

async function main(): Promise<void> {
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
    for (const tf of TIMEFRAME_SET) {
      const minutes = tf === "1m" ? 1 : tf === "2m" ? 2 : tf === "5m" ? 5 : 15;
      barsByTf[tf] = aggregate(bars1m, minutes);
    }
    baseBarsBySymbol[symbol] = barsByTf[BASE_TF];

    const eventsByTf: Record<string, DirectionEvent[]> = {};
    for (const tf of TIMEFRAME_SET) {
      const settings = {
        ...DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS,
        ...(DEFAULT_SIGNAL_SETTINGS_BY_TIMEFRAME[tf] ?? {}),
      };
      const events = computeDirectionEvents(barsByTf[tf], settings);
      eventsByTf[tf] = events;
      coverage.push(
        `${symbol} ${tf}: ${barsByTf[tf].length} bars, ${events.length} signal events`,
      );
    }
    const inWindow = baseBarsBySymbol[symbol].filter(
      (b) => b.startsAt.getTime() >= STUDY_FROM.getTime(),
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

  console.log("\n=== coverage ===");
  for (const line of coverage) console.log("  " + line);
  console.log(`\noccurrences (transitions in window): ${occurrences.length}`);

  const { results, occurrenceRows } = scorePatterns({
    occurrences,
    barsBySymbol: baseBarsBySymbol,
    baseTimeframe: BASE_TF,
    horizonsBars: HORIZONS,
    minSampleThreshold: MIN_SAMPLE,
  });
  console.log(
    `scored pattern rows (>= ${MIN_SAMPLE} samples): ${results.length}; raw occurrence-window rows: ${occurrenceRows.length}`,
  );

  // Persist: create a study row (FK target) then insert results.
  const [study] = await db
    .insert(backtestStudiesTable)
    .values({
      name: "SMOKE MTF pattern discovery",
      strategyId: "mtf_pattern_discovery",
      strategyVersion: "v1",
      symbols: SYMBOLS,
      timeframe: BASE_TF,
      startsAt: STUDY_FROM,
      endsAt,
      parameters: { timeframeSet: TIMEFRAME_SET, baseTimeframe: BASE_TF, horizons: HORIZONS, smoke: true },
      portfolioRules: {},
      executionProfile: {},
      optimizerConfig: {},
    })
    .returning();

  const dataQuality = { signalSource: "pyrus-signals-core(smoke-aggregated-1m)", timeframeSet: TIMEFRAME_SET };
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

  // Read back from the DB to prove persistence.
  const persisted = await db
    .select()
    .from(mtfPatternResultsTable)
    .where(eq(mtfPatternResultsTable.studyId, study.id));
  const persistedOccurrences = await db
    .select()
    .from(mtfPatternOccurrencesTable)
    .where(eq(mtfPatternOccurrencesTable.studyId, study.id));
  console.log(`\n=== persisted ${persisted.length} rows to mtf_pattern_results (study ${study.id}) ===`);
  console.log(`=== persisted ${persistedOccurrences.length} rows to mtf_pattern_occurrences ===`);

  for (const horizon of HORIZONS) {
    const top = persisted
      .filter((r) => r.horizonBars === horizon)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .slice(0, 6);
    if (top.length === 0) continue;
    console.log(`\n  horizon ${horizon} bars - top by |t-stat|:`);
    for (const r of top) {
      console.log(
        `    #${r.rank} ${r.patternKey}  n=${r.sampleCount} bias=${r.bias} mean=${Number(r.meanReturnPct).toFixed(3)}% win=${Number(r.winRatePct).toFixed(0)}% t=${Number(r.tStat).toFixed(2)}`,
      );
    }
  }

  // Spotlight any LTF/HTF divergence patterns (the user's core idea).
  const divergences = persisted.filter((r) => {
    const dirs = r.patternKey.split("|").map((p) => p.split(":")[1]);
    const has = (d: string) => dirs.includes(d);
    return has("buy") && has("sell"); // at least one TF disagrees with another
  });
  console.log(`\n=== divergence patterns (some TF buy while another sells): ${divergences.length} ===`);
  for (const r of divergences
    .sort((a, b) => Math.abs(Number(b.tStat)) - Math.abs(Number(a.tStat)))
    .slice(0, 8)) {
    console.log(
      `    h${r.horizonBars} ${r.patternKey}  n=${r.sampleCount} bias=${r.bias} mean=${Number(r.meanReturnPct).toFixed(3)}% t=${Number(r.tStat).toFixed(2)}`,
    );
  }

  console.log("\nSMOKE OK");
  process.exit(0);
}

main().catch((error) => {
  console.error("SMOKE FAILED:", error);
  process.exit(1);
});
