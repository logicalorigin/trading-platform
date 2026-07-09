import { createInsertSchema } from "drizzle-zod";
import {
  bigint,
  boolean,
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
    kind: varchar("kind", { length: 32 })
      .$type<"study" | "watchlist_backtest" | "signal_options_replay">()
      .notNull()
      .default("study"),
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
    sourceRunKey: varchar("source_run_key", { length: 240 }),
    sourceAccountId: varchar("source_account_id", { length: 64 }),
    marketDate: varchar("market_date", { length: 10 }),
    marketDateFrom: varchar("market_date_from", { length: 10 }),
    marketDateTo: varchar("market_date_to", { length: 10 }),
    rangeKey: varchar("range_key", { length: 160 }),
    windowStartsAt: timestamp("window_starts_at", { withTimezone: true }),
    windowEndsAt: timestamp("window_ends_at", { withTimezone: true }),
    configUsedRef: varchar("config_used_ref", { length: 240 }),
    fidelity: varchar("fidelity", { length: 16 })
      .$type<"full" | "compact">()
      .notNull()
      .default("full"),
    compactedAt: timestamp("compacted_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("backtest_runs_study_idx").on(table.studyId),
    index("backtest_runs_sweep_idx").on(table.sweepId),
    index("backtest_runs_status_idx").on(table.status),
    index("backtest_runs_kind_created_at_idx").on(
      table.kind,
      table.createdAt.desc(),
    ),
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
    bid: numeric("bid", { precision: 18, scale: 6 }),
    ask: numeric("ask", { precision: 18, scale: 6 }),
    mid: numeric("mid", { precision: 18, scale: 6 }),
    quoteAsOf: timestamp("quote_as_of", { withTimezone: true }),
    providerContractId: varchar("provider_contract_id", { length: 128 }),
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

export const backtestRunExecutionsTable = pgTable(
  "backtest_run_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => backtestRunsTable.id),
    accountId: varchar("account_id", { length: 64 }),
    source: varchar("source", { length: 32 }),
    sourceEventId: uuid("source_event_id"),
    sourceOrderId: uuid("source_order_id"),
    sourceFillId: uuid("source_fill_id"),
    sourcePositionId: uuid("source_position_id"),
    sourcePositionMarkId: uuid("source_position_mark_id"),
    clientOrderId: varchar("client_order_id", { length: 180 }),
    deploymentId: uuid("deployment_id"),
    providerAccountId: varchar("provider_account_id", { length: 128 }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    summary: text("summary"),
    symbol: varchar("symbol", { length: 64 }),
    assetClass: varchar("asset_class", { length: 32 }),
    positionType: varchar("position_type", { length: 32 }),
    positionKey: varchar("position_key", { length: 240 }),
    side: varchar("side", { length: 16 }),
    direction: varchar("direction", { length: 16 }),
    timeframe: varchar("timeframe", { length: 16 }),
    orderType: varchar("order_type", { length: 16 }),
    timeInForce: varchar("time_in_force", { length: 16 }),
    status: varchar("status", { length: 32 }),
    quantity: numeric("quantity", { precision: 20, scale: 6 }),
    filledQuantity: numeric("filled_quantity", { precision: 20, scale: 6 }),
    limitPrice: numeric("limit_price", { precision: 18, scale: 6 }),
    stopPrice: numeric("stop_price", { precision: 18, scale: 6 }),
    averageFillPrice: numeric("average_fill_price", {
      precision: 18,
      scale: 6,
    }),
    price: numeric("price", { precision: 18, scale: 6 }),
    grossAmount: numeric("gross_amount", { precision: 20, scale: 6 }),
    fees: numeric("fees", { precision: 20, scale: 6 }),
    realizedPnl: numeric("realized_pnl", { precision: 20, scale: 6 }),
    cashDelta: numeric("cash_delta", { precision: 20, scale: 6 }),
    optionTicker: varchar("option_ticker", { length: 96 }),
    optionUnderlying: varchar("option_underlying", { length: 64 }),
    optionExpirationDate: date("option_expiration_date"),
    optionStrike: numeric("option_strike", { precision: 18, scale: 6 }),
    optionRight: varchar("option_right", { length: 8 }),
    optionMultiplier: integer("option_multiplier"),
    optionProviderContractId: varchar("option_provider_contract_id", {
      length: 128,
    }),
    signalAt: timestamp("signal_at", { withTimezone: true }),
    signalPrice: numeric("signal_price", { precision: 18, scale: 6 }),
    signalClose: numeric("signal_close", { precision: 18, scale: 6 }),
    signalScore: numeric("signal_score", { precision: 18, scale: 6 }),
    signalScoreDetails: jsonb("signal_score_details").$type<
      Record<string, number>
    >(),
    watchlists: jsonb("watchlists").$type<Array<{ id: string; name: string }>>(),
    regime: jsonb("regime").$type<Record<string, unknown>>(),
    fillSource: varchar("fill_source", { length: 160 }),
    candidateId: varchar("candidate_id", { length: 160 }),
    signalKey: varchar("signal_key", { length: 240 }),
    reason: varchar("reason", { length: 160 }),
    marketDate: varchar("market_date", { length: 10 }),
    positionMarketDate: varchar("position_market_date", { length: 10 }),
    positionQuantity: numeric("position_quantity", {
      precision: 20,
      scale: 6,
    }),
    averageCost: numeric("average_cost", { precision: 18, scale: 6 }),
    mark: numeric("mark", { precision: 18, scale: 6 }),
    marketValue: numeric("market_value", { precision: 20, scale: 6 }),
    unrealizedPnl: numeric("unrealized_pnl", { precision: 20, scale: 6 }),
    positionStatus: varchar("position_status", { length: 32 }),
    positionOpenedAt: timestamp("position_opened_at", { withTimezone: true }),
    positionClosedAt: timestamp("position_closed_at", { withTimezone: true }),
    positionAsOf: timestamp("position_as_of", { withTimezone: true }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    filledAt: timestamp("filled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("backtest_run_executions_run_idx").on(table.runId)],
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
    source: varchar("source", { length: 32 }),
    currency: varchar("currency", { length: 16 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    equity: numeric("equity", { precision: 20, scale: 6 }).notNull(),
    cash: numeric("cash", { precision: 20, scale: 6 }).notNull(),
    buyingPower: numeric("buying_power", { precision: 20, scale: 6 }),
    grossExposure: numeric("gross_exposure", {
      precision: 20,
      scale: 6,
    }).notNull(),
    realizedPnl: numeric("realized_pnl", { precision: 20, scale: 6 }),
    unrealizedPnl: numeric("unrealized_pnl", { precision: 20, scale: 6 }),
    fees: numeric("fees", { precision: 20, scale: 6 }),
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
export const insertBacktestRunExecutionSchema = createInsertSchema(
  backtestRunExecutionsTable,
);

export type BacktestStudy = typeof backtestStudiesTable.$inferSelect;
export type BacktestSweep = typeof backtestSweepsTable.$inferSelect;
export type BacktestRun = typeof backtestRunsTable.$inferSelect;
export type BacktestStudyJob = typeof backtestStudyJobsTable.$inferSelect;
export type HistoricalBarDataset = typeof historicalBarDatasetsTable.$inferSelect;
export type HistoricalBar = typeof historicalBarsTable.$inferSelect;
export type BacktestRunExecution = typeof backtestRunExecutionsTable.$inferSelect;
export type BacktestRunTrade = typeof backtestRunTradesTable.$inferSelect;
export type BacktestRunPoint = typeof backtestRunPointsTable.$inferSelect;
export type BacktestPromotion = typeof backtestPromotionsTable.$inferSelect;
