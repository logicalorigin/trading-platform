import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  jsonb,
  numeric,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { alertSeverityEnum, flowSentimentEnum, optionRightEnum } from "./enums";
import { instrumentsTable, optionContractsTable } from "./instruments";

export const flowEventsTable = pgTable(
  "flow_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    underlyingInstrumentId: uuid("underlying_instrument_id").references(
      () => instrumentsTable.id,
    ),
    optionContractId: uuid("option_contract_id").references(
      () => optionContractsTable.id,
    ),
    provider: varchar("provider", { length: 32 }).notNull().default("polygon"),
    providerEventKey: varchar("provider_event_key", { length: 192 }),
    sourceBasis: varchar("source_basis", { length: 64 })
      .notNull()
      .default("confirmed_trade"),
    underlyingSymbol: varchar("underlying_symbol", { length: 64 }).notNull(),
    optionTicker: varchar("option_ticker", { length: 64 }).notNull(),
    strike: numeric("strike", { precision: 18, scale: 6 }).notNull(),
    expirationDate: text("expiration_date").notNull(),
    right: optionRightEnum("right").notNull(),
    price: numeric("price", { precision: 18, scale: 6 }).notNull(),
    size: numeric("size", { precision: 20, scale: 6 }).notNull(),
    premium: numeric("premium", { precision: 20, scale: 6 }).notNull(),
    exchange: varchar("exchange", { length: 32 }).notNull(),
    side: varchar("side", { length: 32 }).notNull(),
    sentiment: flowSentimentEnum("sentiment").notNull(),
    tradeConditions: jsonb("trade_conditions").$type<string[]>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    rawProviderPayload: jsonb("raw_provider_payload").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("flow_events_provider_event_key_idx").on(
      table.provider,
      table.providerEventKey,
    ),
    index("flow_events_provider_idx").on(table.provider),
    index("flow_events_underlying_symbol_idx").on(table.underlyingSymbol),
    index("flow_events_provider_symbol_occurred_idx").on(
      table.provider,
      table.underlyingSymbol,
      table.occurredAt,
    ),
    index("flow_events_option_ticker_idx").on(table.optionTicker),
    index("flow_events_occurred_at_idx").on(table.occurredAt),
  ],
);

export const flowEventHydrationSessionsTable = pgTable(
  "flow_event_hydration_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    underlyingSymbol: varchar("underlying_symbol", { length: 64 }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull().default("polygon"),
    marketDate: text("market_date").notNull(),
    windowFrom: timestamp("window_from", { withTimezone: true }).notNull(),
    windowTo: timestamp("window_to", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    contractCount: integer("contract_count").notNull().default(0),
    contractsScanned: integer("contracts_scanned").notNull().default(0),
    eventCount: integer("event_count").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("flow_event_hydration_sessions_key_idx").on(
      table.underlyingSymbol,
      table.provider,
      table.marketDate,
    ),
    index("flow_event_hydration_sessions_symbol_idx").on(table.underlyingSymbol),
    index("flow_event_hydration_sessions_window_idx").on(
      table.windowFrom,
      table.windowTo,
    ),
    index("flow_event_hydration_sessions_status_idx").on(table.status),
  ],
);

export const savedScansTable = pgTable("saved_scans", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
  ...timestamps,
});

export const alertRulesTable = pgTable(
  "alert_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    scope: varchar("scope", { length: 32 }).notNull(),
    instrumentId: uuid("instrument_id").references(() => instrumentsTable.id),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("alert_rules_instrument_idx").on(table.instrumentId)],
);

export const alertEventsTable = pgTable(
  "alert_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => alertRulesTable.id),
    severity: alertSeverityEnum("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("alert_events_rule_idx").on(table.ruleId),
    index("alert_events_triggered_at_idx").on(table.triggeredAt),
  ],
);

export const flowUniverseRankingsTable = pgTable(
  "flow_universe_rankings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    market: varchar("market", { length: 32 }).notNull(),
    price: numeric("price", { precision: 18, scale: 6 }),
    volume: numeric("volume", { precision: 20, scale: 2 }),
    dollarVolume: numeric("dollar_volume", { precision: 24, scale: 2 }),
    marketCap: numeric("market_cap", { precision: 24, scale: 2 }),
    liquidityRank: integer("liquidity_rank"),
    flowScore: numeric("flow_score", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    previousSessionFlowScore: numeric("previous_session_flow_score", {
      precision: 20,
      scale: 6,
    })
      .notNull()
      .default("0"),
    eligible: boolean("eligible").notNull().default(false),
    reason: varchar("reason", { length: 160 }),
    source: varchar("source", { length: 32 }).notNull().default("ibkr"),
    selected: boolean("selected").notNull().default(false),
    selectedAt: timestamp("selected_at", { withTimezone: true }),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
    lastFlowAt: timestamp("last_flow_at", { withTimezone: true }),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    rankedAt: timestamp("ranked_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("flow_universe_rankings_symbol_idx").on(table.symbol),
    index("flow_universe_rankings_selected_idx").on(table.selected),
    index("flow_universe_rankings_eligible_idx").on(table.eligible),
    index("flow_universe_rankings_rank_idx").on(table.liquidityRank),
    index("flow_universe_rankings_flow_score_idx").on(table.flowScore),
    index("flow_universe_rankings_cooldown_idx").on(table.cooldownUntil),
  ],
);

export const insertSavedScanSchema = createInsertSchema(savedScansTable);
export const insertAlertRuleSchema = createInsertSchema(alertRulesTable);
export const insertFlowUniverseRankingSchema = createInsertSchema(
  flowUniverseRankingsTable,
);

export type FlowEvent = typeof flowEventsTable.$inferSelect;
export type FlowEventHydrationSession =
  typeof flowEventHydrationSessionsTable.$inferSelect;
export type SavedScan = typeof savedScansTable.$inferSelect;
export type AlertRule = typeof alertRulesTable.$inferSelect;
export type AlertEvent = typeof alertEventsTable.$inferSelect;
export type FlowUniverseRanking =
  typeof flowUniverseRankingsTable.$inferSelect;
export type InsertFlowUniverseRanking =
  typeof flowUniverseRankingsTable.$inferInsert;
