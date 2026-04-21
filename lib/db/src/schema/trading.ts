import { createInsertSchema } from "drizzle-zod";
import {
  index,
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
  environmentModeEnum,
  orderSideEnum,
  orderStatusEnum,
  orderTypeEnum,
  timeInForceEnum,
} from "./enums";
import { brokerAccountsTable } from "./broker";
import { instrumentsTable, optionContractsTable } from "./instruments";

export const orderRequestsTable = pgTable(
  "order_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => brokerAccountsTable.id),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrumentsTable.id),
    optionContractId: uuid("option_contract_id").references(
      () => optionContractsTable.id,
    ),
    mode: environmentModeEnum("mode").notNull(),
    side: orderSideEnum("side").notNull(),
    type: orderTypeEnum("type").notNull(),
    timeInForce: timeInForceEnum("time_in_force").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    limitPrice: numeric("limit_price", { precision: 18, scale: 6 }),
    stopPrice: numeric("stop_price", { precision: 18, scale: 6 }),
    clientRequestId: varchar("client_request_id", { length: 128 }),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("order_requests_account_idx").on(table.accountId),
    index("order_requests_instrument_idx").on(table.instrumentId),
    uniqueIndex("order_requests_client_request_id_idx").on(table.clientRequestId),
  ],
);

export const brokerOrdersTable = pgTable(
  "broker_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderRequestId: uuid("order_request_id")
      .notNull()
      .references(() => orderRequestsTable.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => brokerAccountsTable.id),
    brokerOrderId: varchar("broker_order_id", { length: 128 }).notNull(),
    status: orderStatusEnum("status").notNull().default("pending_submit"),
    filledQuantity: numeric("filled_quantity", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    averageFillPrice: numeric("average_fill_price", { precision: 18, scale: 6 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lastBrokerUpdateAt: timestamp("last_broker_update_at", {
      withTimezone: true,
    }),
    rawBrokerPayload: jsonb("raw_broker_payload").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("broker_orders_account_idx").on(table.accountId),
    uniqueIndex("broker_orders_broker_order_id_idx").on(table.brokerOrderId),
  ],
);

export const executionFillsTable = pgTable(
  "execution_fills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brokerOrderId: uuid("broker_order_id")
      .notNull()
      .references(() => brokerOrdersTable.id),
    executionId: varchar("execution_id", { length: 128 }).notNull(),
    side: orderSideEnum("side").notNull(),
    price: numeric("price", { precision: 18, scale: 6 }).notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    rawBrokerPayload: jsonb("raw_broker_payload").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("execution_fills_broker_order_idx").on(table.brokerOrderId),
    uniqueIndex("execution_fills_execution_id_idx").on(table.executionId),
  ],
);

export const positionLotsTable = pgTable(
  "position_lots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => brokerAccountsTable.id),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrumentsTable.id),
    optionContractId: uuid("option_contract_id").references(
      () => optionContractsTable.id,
    ),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    averageCost: numeric("average_cost", { precision: 18, scale: 6 }).notNull(),
    marketPrice: numeric("market_price", { precision: 18, scale: 6 }),
    marketValue: numeric("market_value", { precision: 20, scale: 6 }),
    unrealizedPnl: numeric("unrealized_pnl", { precision: 20, scale: 6 }),
    unrealizedPnlPercent: numeric("unrealized_pnl_percent", {
      precision: 18,
      scale: 6,
    }),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("position_lots_account_idx").on(table.accountId),
    index("position_lots_instrument_idx").on(table.instrumentId),
    index("position_lots_as_of_idx").on(table.asOf),
  ],
);

export const balanceSnapshotsTable = pgTable(
  "balance_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => brokerAccountsTable.id),
    currency: varchar("currency", { length: 16 }).notNull().default("USD"),
    cash: numeric("cash", { precision: 20, scale: 6 }).notNull(),
    buyingPower: numeric("buying_power", { precision: 20, scale: 6 }).notNull(),
    netLiquidation: numeric("net_liquidation", {
      precision: 20,
      scale: 6,
    }).notNull(),
    maintenanceMargin: numeric("maintenance_margin", {
      precision: 20,
      scale: 6,
    }),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("balance_snapshots_account_idx").on(table.accountId),
    index("balance_snapshots_as_of_idx").on(table.asOf),
  ],
);

export const activityLogTable = pgTable(
  "activity_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").references(() => brokerAccountsTable.id),
    instrumentId: uuid("instrument_id").references(() => instrumentsTable.id),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("activity_log_account_idx").on(table.accountId),
    index("activity_log_occurred_at_idx").on(table.occurredAt),
  ],
);

export const insertOrderRequestSchema = createInsertSchema(orderRequestsTable);

export type OrderRequest = typeof orderRequestsTable.$inferSelect;
export type InsertOrderRequest = typeof orderRequestsTable.$inferInsert;
export type BrokerOrder = typeof brokerOrdersTable.$inferSelect;
export type ExecutionFill = typeof executionFillsTable.$inferSelect;
export type PositionLot = typeof positionLotsTable.$inferSelect;
export type BalanceSnapshot = typeof balanceSnapshotsTable.$inferSelect;
