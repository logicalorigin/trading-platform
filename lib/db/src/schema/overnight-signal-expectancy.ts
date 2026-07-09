import { createInsertSchema } from "drizzle-zod";
import {
  date,
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

// Overnight signal-expectancy studies reuse backtest_studies +
// backtest_study_jobs (kind = "overnight_signal_expectancy") but persist their
// own statistical result and audit sample rows. This keeps the study separate
// from MTF pattern discovery and from position-sizing backtest_run_* tables.
export const overnightSignalExpectancyResultsTable = pgTable(
  "overnight_signal_expectancy_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => backtestStudiesTable.id),
    jobId: uuid("job_id").references(() => backtestStudyJobsTable.id),
    timeframe: varchar("timeframe", { length: 16 }).notNull(),
    sampleCount: integer("sample_count").notNull(),
    eligibleSampleCount: integer("eligible_sample_count").notNull().default(0),
    buyStateCount: integer("buy_state_count").notNull().default(0),
    validReturnCoveragePct: numeric("valid_return_coverage_pct", {
      precision: 18,
      scale: 6,
    }),
    buyStateFrequencyPct: numeric("buy_state_frequency_pct", {
      precision: 18,
      scale: 6,
    }),
    expectancyPct: numeric("expectancy_pct", { precision: 18, scale: 6 }),
    medianReturnPct: numeric("median_return_pct", { precision: 18, scale: 6 }),
    winRatePct: numeric("win_rate_pct", { precision: 18, scale: 6 }),
    avgWinPct: numeric("avg_win_pct", { precision: 18, scale: 6 }),
    avgLossPct: numeric("avg_loss_pct", { precision: 18, scale: 6 }),
    payoffRatio: numeric("payoff_ratio", { precision: 18, scale: 6 }),
    stdReturnPct: numeric("std_return_pct", { precision: 18, scale: 6 }),
    tStat: numeric("t_stat", { precision: 18, scale: 6 }),
    ci95LowPct: numeric("ci95_low_pct", { precision: 18, scale: 6 }),
    ci95HighPct: numeric("ci95_high_pct", { precision: 18, scale: 6 }),
    rank: integer("rank"),
    winnerStatus: varchar("winner_status", { length: 32 }).notNull().default("tie"),
    pairwiseSummary: jsonb("pairwise_summary").$type<Record<string, unknown>>(),
    dataQuality: jsonb("data_quality").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("overnight_signal_expectancy_results_study_tf_idx").on(
      table.studyId,
      table.timeframe,
    ),
    index("overnight_signal_expectancy_results_rank_idx").on(
      table.studyId,
      table.rank,
    ),
  ],
);

export const overnightSignalExpectancySamplesTable = pgTable(
  "overnight_signal_expectancy_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => backtestStudiesTable.id),
    jobId: uuid("job_id").references(() => backtestStudyJobsTable.id),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    sessionDate: date("session_date").notNull(),
    timeframe: varchar("timeframe", { length: 16 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    exclusionReason: varchar("exclusion_reason", { length: 64 }),
    signalAt: timestamp("signal_at", { withTimezone: true }),
    signalAvailableAt: timestamp("signal_available_at", { withTimezone: true }),
    entryAt: timestamp("entry_at", { withTimezone: true }),
    entryPrice: numeric("entry_price", { precision: 18, scale: 6 }),
    exitAt: timestamp("exit_at", { withTimezone: true }),
    exitPrice: numeric("exit_price", { precision: 18, scale: 6 }),
    returnPct: numeric("return_pct", { precision: 18, scale: 6 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("overnight_signal_expectancy_samples_unique_idx").on(
      table.studyId,
      table.symbol,
      table.sessionDate,
      table.timeframe,
    ),
    index("overnight_signal_expectancy_samples_page_idx").on(
      table.studyId,
      table.sessionDate,
      table.symbol,
      table.timeframe,
      table.id,
    ),
    index("overnight_signal_expectancy_samples_filter_idx").on(
      table.studyId,
      table.timeframe,
      table.status,
      table.sessionDate,
    ),
    index("overnight_signal_expectancy_samples_symbol_idx").on(
      table.studyId,
      table.symbol,
    ),
  ],
);

export const insertOvernightSignalExpectancyResultSchema = createInsertSchema(
  overnightSignalExpectancyResultsTable,
);
export const insertOvernightSignalExpectancySampleSchema = createInsertSchema(
  overnightSignalExpectancySamplesTable,
);

export type OvernightSignalExpectancyResult =
  typeof overnightSignalExpectancyResultsTable.$inferSelect;
export type OvernightSignalExpectancySample =
  typeof overnightSignalExpectancySamplesTable.$inferSelect;
