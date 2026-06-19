import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { timestamps } from "./common";
import { backtestStudiesTable, backtestStudyJobsTable } from "./backtesting";

// MTF pattern-discovery results. A "pattern" is the per-timeframe signal-direction
// vector (e.g. "1m:sell|2m:sell|5m:sell|15m:buy"). Each row aggregates one pattern
// at one forward horizon across all observed occurrences across all symbols in the
// study. This is a statistical study (observe patterns in history -> forward-return
// aggregation), NOT a position-sizing backtest, so it lives in its own result table
// rather than backtest_run_trades/points. Orchestration reuses backtest_studies +
// backtest_study_jobs (kind = "pattern_discovery").
export const mtfPatternResultsTable = pgTable(
  "mtf_pattern_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => backtestStudiesTable.id),
    jobId: uuid("job_id").references(() => backtestStudyJobsTable.id),
    // Canonical "tf:dir|tf:dir|..." key over the fixed timeframe set; dir in buy/sell/none.
    patternKey: text("pattern_key").notNull(),
    timeframeSet: jsonb("timeframe_set").$type<string[]>().notNull(),
    baseTimeframe: varchar("base_timeframe", { length: 16 }).notNull(),
    horizonBars: integer("horizon_bars").notNull(),
    sampleCount: integer("sample_count").notNull(),
    // "long" | "short" | "neutral" - sign of the mean forward move.
    bias: varchar("bias", { length: 8 }).notNull().default("neutral"),
    winRatePct: numeric("win_rate_pct", { precision: 18, scale: 6 }),
    meanReturnPct: numeric("mean_return_pct", { precision: 18, scale: 6 }),
    medianReturnPct: numeric("median_return_pct", { precision: 18, scale: 6 }),
    stdReturnPct: numeric("std_return_pct", { precision: 18, scale: 6 }),
    avgMaePct: numeric("avg_mae_pct", { precision: 18, scale: 6 }),
    avgMfePct: numeric("avg_mfe_pct", { precision: 18, scale: 6 }),
    // Sharpe-like = mean / (std + eps); tStat = mean / (std / sqrt(n)) for ranking.
    score: numeric("score", { precision: 18, scale: 6 }),
    tStat: numeric("t_stat", { precision: 18, scale: 6 }),
    rank: integer("rank"),
    dataQuality: jsonb("data_quality").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("mtf_pattern_results_rank_idx").on(
      table.studyId,
      table.horizonBars,
      table.score,
    ),
    uniqueIndex("mtf_pattern_results_pattern_idx").on(
      table.studyId,
      table.patternKey,
      table.horizonBars,
    ),
  ],
);

// Raw per-occurrence rows for drill-down/audit. High-volume; only written when the
// study config sets persistOccurrences. (Equivalent of backtest_run_trades for this
// study type.)
export const mtfPatternOccurrencesTable = pgTable(
  "mtf_pattern_occurrences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => backtestStudiesTable.id),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    patternKey: text("pattern_key").notNull(),
    horizonBars: integer("horizon_bars").notNull(),
    realizedReturnPct: numeric("realized_return_pct", { precision: 18, scale: 6 }),
    maePct: numeric("mae_pct", { precision: 18, scale: 6 }),
    mfePct: numeric("mfe_pct", { precision: 18, scale: 6 }),
    ...timestamps,
  },
  (table) => [
    index("mtf_pattern_occurrences_pattern_idx").on(
      table.studyId,
      table.patternKey,
      table.horizonBars,
    ),
    index("mtf_pattern_occurrences_symbol_idx").on(table.studyId, table.symbol),
  ],
);

export const insertMtfPatternResultSchema = createInsertSchema(
  mtfPatternResultsTable,
);
export const insertMtfPatternOccurrenceSchema = createInsertSchema(
  mtfPatternOccurrencesTable,
);

export type MtfPatternResult = typeof mtfPatternResultsTable.$inferSelect;
export type MtfPatternOccurrence = typeof mtfPatternOccurrencesTable.$inferSelect;
