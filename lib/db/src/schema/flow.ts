import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
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
    index("flow_events_underlying_symbol_idx").on(table.underlyingSymbol),
    index("flow_events_option_ticker_idx").on(table.optionTicker),
    index("flow_events_occurred_at_idx").on(table.occurredAt),
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

export const insertSavedScanSchema = createInsertSchema(savedScansTable);
export const insertAlertRuleSchema = createInsertSchema(alertRulesTable);

export type FlowEvent = typeof flowEventsTable.$inferSelect;
export type SavedScan = typeof savedScansTable.$inferSelect;
export type AlertRule = typeof alertRulesTable.$inferSelect;
export type AlertEvent = typeof alertEventsTable.$inferSelect;
