import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { algoRunStatusEnum, environmentModeEnum } from "./enums";

export const algoStrategiesTable = pgTable("algo_strategies", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  mode: environmentModeEnum("mode").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  symbolUniverse: jsonb("symbol_universe").$type<string[]>().notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  ...timestamps,
});

export const algoRunsTable = pgTable(
  "algo_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => algoStrategiesTable.id),
    status: algoRunStatusEnum("status").notNull().default("queued"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),
    logs: jsonb("logs").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("algo_runs_strategy_idx").on(table.strategyId),
    index("algo_runs_status_idx").on(table.status),
  ],
);

export const backtestRunsTable = pgTable(
  "backtest_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    mode: environmentModeEnum("mode").notNull().default("paper"),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("backtest_runs_symbol_idx").on(table.symbol),
    index("backtest_runs_started_at_idx").on(table.startedAt),
  ],
);

export const insertAlgoStrategySchema = createInsertSchema(algoStrategiesTable);
export const insertBacktestRunSchema = createInsertSchema(backtestRunsTable);

export type AlgoStrategy = typeof algoStrategiesTable.$inferSelect;
export type AlgoRun = typeof algoRunsTable.$inferSelect;
export type BacktestRun = typeof backtestRunsTable.$inferSelect;
