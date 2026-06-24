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
import { sql } from "drizzle-orm";
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
    // execution_events_deployment_idx (deployment_id only) dropped 2026-06-24:
    // redundant with execution_events_deployment_occurred_idx (deployment_id,
    // occurred_at DESC) and non-selective (n_distinct=2, idx_scan~0). See
    // migration 20260624_drop_execution_events_deployment_idx.sql.
    index("execution_events_account_idx").on(table.providerAccountId),
    index("execution_events_symbol_idx").on(table.symbol),
    index("execution_events_occurred_at_idx").on(table.occurredAt),
    // Generic deployment event readers use:
    // WHERE deployment_id = ? ORDER BY occurred_at DESC LIMIT n.
    // Keep this separate from event-type partial indexes below; the partial
    // indexes cannot help deployment-only readers such as /algo/events.
    index("execution_events_deployment_occurred_idx").on(
      table.deploymentId,
      table.occurredAt.desc(),
    ),
    // Partial index for the hot listDeploymentEvents query
    // (WHERE deployment_id = ? AND event_type LIKE 'signal_options_%'
    // ORDER BY occurred_at DESC LIMIT n). A deployment's events are mostly
    // overnight_spot_signal_blocked (continuously growing) vs a minority of
    // (older) signal_options_* rows, so a plain occurred_at scan skips ~750k
    // newer non-matching rows (~15-23s, pinning a pool connection -> the
    // "Signal-Options Deployment Unavailable" fallback). Indexing ONLY the
    // signal_options rows, ordered by occurred_at, makes the LIMIT a sub-ms
    // index scan regardless of planner stats. (A plain composite
    // (deployment_id, event_type, occurred_at) is NOT used; the LIKE-prefix
    // predicate can't drive it without text_pattern_ops; verified via EXPLAIN.)
    index("execution_events_sigopt_deploy_occurred_idx")
      .on(table.deploymentId, table.occurredAt.desc())
      .where(sql`${table.eventType} LIKE 'signal_options_%'`),
    index("execution_events_overnight_deploy_occurred_idx")
      .on(table.deploymentId, table.occurredAt.desc())
      .where(sql`${table.eventType} LIKE 'overnight_spot_%'`),
  ],
);

// Telemetry/diagnostics split out of the execution_events ledger. Mirrors
// execution_events column-for-column so union-reads (listExecutionEvents,
// findExistingEventByClientOrderId) need no row reshaping. Holds high-volume
// noise (overnight_spot_signal_blocked/tracked) and deployment_* lifecycle/audit
// events. The ledger keeps everything load-bearing: all signal_options_* run
// events, overnight_spot_{shadow,live}_*, and overnight_spot_order_failed.
export const automationDiagnosticsTable = pgTable(
  "automation_diagnostics",
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
    // Per-deployment union branch of listExecutionEvents /
    // findExistingEventByClientOrderId:
    //   WHERE deployment_id = ? ORDER BY occurred_at DESC LIMIT n.
    index("automation_diagnostics_deployment_occurred_idx").on(
      table.deploymentId,
      table.occurredAt.desc(),
    ),
    // Global (no deploymentId) union branch of listExecutionEvents.
    index("automation_diagnostics_occurred_idx").on(table.occurredAt.desc()),
    // Expression index for the dedup union's clientOrderId lookup. Correctness
    // does NOT depend on this index (the JS match loop is the source of truth);
    // it only keeps the deployment-scoped scan cheap once the table grows.
    index("automation_diagnostics_deployment_client_order_idx").on(
      table.deploymentId,
      sql`(${table.payload}->>'clientOrderId')`,
    ),
  ],
);

export const insertAlgoStrategySchema = createInsertSchema(algoStrategiesTable);
export const insertAlgoDeploymentSchema = createInsertSchema(algoDeploymentsTable);

export type AlgoStrategy = typeof algoStrategiesTable.$inferSelect;
export type AlgoRun = typeof algoRunsTable.$inferSelect;
export type AlgoDeployment = typeof algoDeploymentsTable.$inferSelect;
export type InsertAlgoDeployment = typeof algoDeploymentsTable.$inferInsert;
export type ExecutionEvent = typeof executionEventsTable.$inferSelect;
export type AutomationDiagnostic = typeof automationDiagnosticsTable.$inferSelect;
