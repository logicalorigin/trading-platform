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

export const algoDeploymentsTable = pgTable(
  "algo_deployments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => algoStrategiesTable.id),
    name: text("name").notNull(),
    mode: environmentModeEnum("mode").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    providerAccountId: varchar("provider_account_id", { length: 128 }).notNull(),
    symbolUniverse: jsonb("symbol_universe").$type<string[]>().notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    lastSignalAt: timestamp("last_signal_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    index("algo_deployments_strategy_idx").on(table.strategyId),
    index("algo_deployments_mode_idx").on(table.mode),
    index("algo_deployments_enabled_idx").on(table.enabled),
  ],
);

export const executionEventsTable = pgTable(
  "execution_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deploymentId: uuid("deployment_id").references(() => algoDeploymentsTable.id),
    algoRunId: uuid("algo_run_id").references(() => algoRunsTable.id),
    providerAccountId: varchar("provider_account_id", { length: 128 }),
    symbol: varchar("symbol", { length: 64 }),
    eventType: text("event_type").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("execution_events_deployment_idx").on(table.deploymentId),
    index("execution_events_account_idx").on(table.providerAccountId),
    index("execution_events_symbol_idx").on(table.symbol),
    index("execution_events_occurred_at_idx").on(table.occurredAt),
  ],
);

export const insertAlgoStrategySchema = createInsertSchema(algoStrategiesTable);
export const insertAlgoDeploymentSchema = createInsertSchema(algoDeploymentsTable);

export type AlgoStrategy = typeof algoStrategiesTable.$inferSelect;
export type AlgoRun = typeof algoRunsTable.$inferSelect;
export type AlgoDeployment = typeof algoDeploymentsTable.$inferSelect;
export type InsertAlgoDeployment = typeof algoDeploymentsTable.$inferInsert;
export type ExecutionEvent = typeof executionEventsTable.$inferSelect;
