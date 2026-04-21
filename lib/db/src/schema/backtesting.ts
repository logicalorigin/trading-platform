import { createInsertSchema } from "drizzle-zod";
import {
  bigint,
  boolean,
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
import {
  backtestDirectionModeEnum,
  backtestJobStatusEnum,
  backtestOptimizerModeEnum,
} from "./enums";
import { algoStrategiesTable } from "./automation";
import { watchlistsTable } from "./watchlists";

export const backtestStudiesTable = pgTable(
  "backtest_studies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    strategyId: varchar("strategy_id", { length: 64 }).notNull(),
    strategyVersion: varchar("strategy_version", { length: 64 }).notNull(),
    directionMode: backtestDirectionModeEnum("direction_mode")
      .notNull()
      .default("long_only"),
    watchlistId: uuid("watchlist_id").references(() => watchlistsTable.id),
    symbols: jsonb("symbols").$type<string[]>().notNull(),
    timeframe: varchar("timeframe", { length: 16 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull(),
    portfolioRules: jsonb("portfolio_rules")
      .$type<Record<string, unknown>>()
      .notNull(),
    executionProfile: jsonb("execution_profile")
      .$type<Record<string, unknown>>()
      .notNull(),
    optimizerMode: backtestOptimizerModeEnum("optimizer_mode")
      .notNull()
      .default("grid"),
    optimizerConfig: jsonb("optimizer_config")
      .$type<Record<string, unknown>>()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("backtest_studies_strategy_idx").on(table.strategyId),
    index("backtest_studies_updated_at_idx").on(table.updatedAt),
  ],
);

export const backtestSweepsTable = pgTable(
  "backtest_sweeps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => backtestStudiesTable.id),
    mode: backtestOptimizerModeEnum("mode").notNull(),
    status: backtestJobStatusEnum("status").notNull().default("queued"),
    candidateTargetCount: integer("candidate_target_count").notNull().default(0),
    candidateCompletedCount: integer("candidate_completed_count")
      .notNull()
      .default(0),
    bestRunId: uuid("best_run_id"),
    rankingSummary: jsonb("ranking_summary").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("backtest_sweeps_study_idx").on(table.studyId),
    index("backtest_sweeps_status_idx").on(table.status),
  ],
);

export const backtestRunsTable = pgTable(
  "backtest_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => backtestStudiesTable.id),
    sweepId: uuid("sweep_id").references(() => backtestSweepsTable.id),
    name: text("name").notNull(),
    strategyId: varchar("strategy_id", { length: 64 }).notNull(),
    strategyVersion: varchar("strategy_version", { length: 64 }).notNull(),
    directionMode: backtestDirectionModeEnum("direction_mode")
      .notNull()
      .default("long_only"),
    status: backtestJobStatusEnum("status").notNull().default("queued"),
    symbolUniverse: jsonb("symbol_universe").$type<string[]>().notNull(),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull(),
    portfolioRules: jsonb("portfolio_rules")
      .$type<Record<string, unknown>>()
      .notNull(),
    executionProfile: jsonb("execution_profile")
      .$type<Record<string, unknown>>()
      .notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    errorMessage: text("error_message"),
    sortRank: integer("sort_rank"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("backtest_runs_study_idx").on(table.studyId),
    index("backtest_runs_sweep_idx").on(table.sweepId),
    index("backtest_runs_status_idx").on(table.status),
  ],
);

export const backtestStudyJobsTable = pgTable(
  "backtest_study_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => backtestStudiesTable.id),
    kind: varchar("kind", { length: 32 }).notNull(),
    runId: uuid("run_id").references(() => backtestRunsTable.id),
    sweepId: uuid("sweep_id").references(() => backtestSweepsTable.id),
    status: backtestJobStatusEnum("status").notNull().default("queued"),
    progressPercent: integer("progress_percent").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    errorMessage: text("error_message"),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("backtest_study_jobs_study_idx").on(table.studyId),
    index("backtest_study_jobs_status_idx").on(table.status),
    index("backtest_study_jobs_created_at_idx").on(table.createdAt),
  ],
);

export const historicalBarDatasetsTable = pgTable(
  "historical_bar_datasets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    timeframe: varchar("timeframe", { length: 16 }).notNull(),
    source: varchar("source", { length: 32 }).notNull().default("massive"),
    sessionMode: varchar("session_mode", { length: 16 })
      .notNull()
      .default("regular"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    barCount: integer("bar_count").notNull().default(0),
    byteSize: bigint("byte_size", { mode: "number" }).notNull().default(0),
    pinnedCount: integer("pinned_count").notNull().default(0),
    isSeeded: boolean("is_seeded").notNull().default(false),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("historical_bar_datasets_unique_idx").on(
      table.symbol,
      table.timeframe,
      table.source,
      table.sessionMode,
      table.startsAt,
      table.endsAt,
    ),
    index("historical_bar_datasets_symbol_timeframe_idx").on(
      table.symbol,
      table.timeframe,
    ),
    index("historical_bar_datasets_last_accessed_idx").on(table.lastAccessedAt),
  ],
);

export const historicalBarsTable = pgTable(
  "historical_bars",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => historicalBarDatasetsTable.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    open: numeric("open", { precision: 18, scale: 6 }).notNull(),
    high: numeric("high", { precision: 18, scale: 6 }).notNull(),
    low: numeric("low", { precision: 18, scale: 6 }).notNull(),
    close: numeric("close", { precision: 18, scale: 6 }).notNull(),
    volume: numeric("volume", { precision: 20, scale: 4 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("historical_bars_dataset_starts_at_idx").on(
      table.datasetId,
      table.startsAt,
    ),
    index("historical_bars_starts_at_idx").on(table.startsAt),
  ],
);

export const backtestRunDatasetsTable = pgTable(
  "backtest_run_datasets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => backtestRunsTable.id),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => historicalBarDatasetsTable.id),
    role: varchar("role", { length: 32 }).notNull().default("primary"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("backtest_run_datasets_unique_idx").on(
      table.runId,
      table.datasetId,
      table.role,
    ),
    index("backtest_run_datasets_run_idx").on(table.runId),
  ],
);

export const backtestRunTradesTable = pgTable(
  "backtest_run_trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => backtestRunsTable.id),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    side: varchar("side", { length: 16 }).notNull(),
    entryAt: timestamp("entry_at", { withTimezone: true }).notNull(),
    exitAt: timestamp("exit_at", { withTimezone: true }).notNull(),
    entryPrice: numeric("entry_price", { precision: 18, scale: 6 }).notNull(),
    exitPrice: numeric("exit_price", { precision: 18, scale: 6 }).notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    entryValue: numeric("entry_value", { precision: 20, scale: 6 }).notNull(),
    exitValue: numeric("exit_value", { precision: 20, scale: 6 }).notNull(),
    grossPnl: numeric("gross_pnl", { precision: 20, scale: 6 }).notNull(),
    netPnl: numeric("net_pnl", { precision: 20, scale: 6 }).notNull(),
    netPnlPercent: numeric("net_pnl_percent", {
      precision: 18,
      scale: 6,
    }).notNull(),
    barsHeld: integer("bars_held").notNull(),
    commissionPaid: numeric("commission_paid", {
      precision: 20,
      scale: 6,
    }).notNull(),
    exitReason: varchar("exit_reason", { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("backtest_run_trades_run_idx").on(table.runId),
    index("backtest_run_trades_symbol_idx").on(table.symbol),
  ],
);

export const backtestRunPointsTable = pgTable(
  "backtest_run_points",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => backtestRunsTable.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    equity: numeric("equity", { precision: 20, scale: 6 }).notNull(),
    cash: numeric("cash", { precision: 20, scale: 6 }).notNull(),
    grossExposure: numeric("gross_exposure", {
      precision: 20,
      scale: 6,
    }).notNull(),
    drawdownPercent: numeric("drawdown_percent", {
      precision: 18,
      scale: 6,
    }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("backtest_run_points_run_occurred_idx").on(
      table.runId,
      table.occurredAt,
    ),
    index("backtest_run_points_occurred_idx").on(table.occurredAt),
  ],
);

export const backtestPromotionsTable = pgTable(
  "backtest_promotions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => backtestStudiesTable.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => backtestRunsTable.id),
    algoStrategyId: uuid("algo_strategy_id")
      .notNull()
      .references(() => algoStrategiesTable.id),
    notes: text("notes"),
    promotedAt: timestamp("promoted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("backtest_promotions_run_idx").on(table.runId),
    index("backtest_promotions_study_idx").on(table.studyId),
  ],
);

export const insertBacktestStudySchema = createInsertSchema(backtestStudiesTable);
export const insertBacktestSweepSchema = createInsertSchema(backtestSweepsTable);
export const insertBacktestRunSchema = createInsertSchema(backtestRunsTable);

export type BacktestStudy = typeof backtestStudiesTable.$inferSelect;
export type BacktestSweep = typeof backtestSweepsTable.$inferSelect;
export type BacktestRun = typeof backtestRunsTable.$inferSelect;
export type BacktestStudyJob = typeof backtestStudyJobsTable.$inferSelect;
export type HistoricalBarDataset = typeof historicalBarDatasetsTable.$inferSelect;
export type HistoricalBar = typeof historicalBarsTable.$inferSelect;
export type BacktestRunTrade = typeof backtestRunTradesTable.$inferSelect;
export type BacktestRunPoint = typeof backtestRunPointsTable.$inferSelect;
export type BacktestPromotion = typeof backtestPromotionsTable.$inferSelect;
