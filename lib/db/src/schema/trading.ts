import { createInsertSchema } from "drizzle-zod";
import {
  date,
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

export const flexReportRunsTable = pgTable(
  "flex_report_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    queryId: varchar("query_id", { length: 128 }).notNull(),
    referenceCode: varchar("reference_code", { length: 128 }),
    status: varchar("status", { length: 32 }).notNull().default("requested"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    rawXml: text("raw_xml"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("flex_report_runs_query_idx").on(table.queryId),
    uniqueIndex("flex_report_runs_reference_code_idx").on(table.referenceCode),
    index("flex_report_runs_requested_at_idx").on(table.requestedAt),
  ],
);

export const flexNavHistoryTable = pgTable(
  "flex_nav_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerAccountId: varchar("provider_account_id", { length: 128 }).notNull(),
    statementDate: date("statement_date").notNull(),
    currency: varchar("currency", { length: 16 }).notNull().default("USD"),
    netAssetValue: numeric("net_asset_value", {
      precision: 20,
      scale: 6,
    }).notNull(),
    cash: numeric("cash", { precision: 20, scale: 6 }),
    securities: numeric("securities", { precision: 20, scale: 6 }),
    deposits: numeric("deposits", { precision: 20, scale: 6 }),
    withdrawals: numeric("withdrawals", { precision: 20, scale: 6 }),
    dividends: numeric("dividends", { precision: 20, scale: 6 }),
    fees: numeric("fees", { precision: 20, scale: 6 }),
    realizedPnl: numeric("realized_pnl", { precision: 20, scale: 6 }),
    changeInNav: numeric("change_in_nav", { precision: 20, scale: 6 }),
    sourceRunId: uuid("source_run_id").references(() => flexReportRunsTable.id),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("flex_nav_history_account_idx").on(table.providerAccountId),
    index("flex_nav_history_statement_date_idx").on(table.statementDate),
    uniqueIndex("flex_nav_history_unique_account_date_currency_idx").on(
      table.providerAccountId,
      table.statementDate,
      table.currency,
    ),
  ],
);

export const flexTradesTable = pgTable(
  "flex_trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerAccountId: varchar("provider_account_id", { length: 128 }).notNull(),
    tradeId: varchar("trade_id", { length: 160 }).notNull(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    description: text("description"),
    assetClass: varchar("asset_class", { length: 32 }).notNull().default("stock"),
    side: varchar("side", { length: 16 }).notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    price: numeric("price", { precision: 18, scale: 6 }),
    amount: numeric("amount", { precision: 20, scale: 6 }),
    commission: numeric("commission", { precision: 20, scale: 6 }),
    currency: varchar("currency", { length: 16 }).notNull().default("USD"),
    tradeDate: timestamp("trade_date", { withTimezone: true }).notNull(),
    settleDate: date("settle_date"),
    openClose: varchar("open_close", { length: 16 }),
    realizedPnl: numeric("realized_pnl", { precision: 20, scale: 6 }),
    sourceRunId: uuid("source_run_id").references(() => flexReportRunsTable.id),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("flex_trades_account_idx").on(table.providerAccountId),
    index("flex_trades_symbol_idx").on(table.symbol),
    index("flex_trades_trade_date_idx").on(table.tradeDate),
    uniqueIndex("flex_trades_unique_account_trade_idx").on(
      table.providerAccountId,
      table.tradeId,
    ),
  ],
);

export const flexCashActivityTable = pgTable(
  "flex_cash_activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerAccountId: varchar("provider_account_id", { length: 128 }).notNull(),
    activityId: varchar("activity_id", { length: 180 }).notNull(),
    activityType: varchar("activity_type", { length: 64 }).notNull(),
    description: text("description"),
    amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),
    currency: varchar("currency", { length: 16 }).notNull().default("USD"),
    activityDate: timestamp("activity_date", { withTimezone: true }).notNull(),
    sourceRunId: uuid("source_run_id").references(() => flexReportRunsTable.id),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("flex_cash_activity_account_idx").on(table.providerAccountId),
    index("flex_cash_activity_date_idx").on(table.activityDate),
    uniqueIndex("flex_cash_activity_unique_account_activity_idx").on(
      table.providerAccountId,
      table.activityId,
    ),
  ],
);

export const flexDividendsTable = pgTable(
  "flex_dividends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerAccountId: varchar("provider_account_id", { length: 128 }).notNull(),
    dividendId: varchar("dividend_id", { length: 180 }).notNull(),
    symbol: varchar("symbol", { length: 64 }),
    description: text("description"),
    amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),
    currency: varchar("currency", { length: 16 }).notNull().default("USD"),
    paidDate: timestamp("paid_date", { withTimezone: true }).notNull(),
    exDate: date("ex_date"),
    sourceRunId: uuid("source_run_id").references(() => flexReportRunsTable.id),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("flex_dividends_account_idx").on(table.providerAccountId),
    index("flex_dividends_paid_date_idx").on(table.paidDate),
    uniqueIndex("flex_dividends_unique_account_dividend_idx").on(
      table.providerAccountId,
      table.dividendId,
    ),
  ],
);

export const flexOpenPositionsTable = pgTable(
  "flex_open_positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerAccountId: varchar("provider_account_id", { length: 128 }).notNull(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    description: text("description"),
    assetClass: varchar("asset_class", { length: 32 }).notNull().default("stock"),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    costBasis: numeric("cost_basis", { precision: 20, scale: 6 }),
    marketValue: numeric("market_value", { precision: 20, scale: 6 }),
    currency: varchar("currency", { length: 16 }).notNull().default("USD"),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    sourceRunId: uuid("source_run_id").references(() => flexReportRunsTable.id),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("flex_open_positions_account_idx").on(table.providerAccountId),
    index("flex_open_positions_symbol_idx").on(table.symbol),
    index("flex_open_positions_as_of_idx").on(table.asOf),
    uniqueIndex("flex_open_positions_unique_account_symbol_as_of_idx").on(
      table.providerAccountId,
      table.symbol,
      table.asOf,
    ),
  ],
);

export const tickerReferenceCacheTable = pgTable(
  "ticker_reference_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    name: text("name"),
    assetClass: varchar("asset_class", { length: 32 }),
    sector: varchar("sector", { length: 128 }),
    beta: numeric("beta", { precision: 18, scale: 6 }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("ticker_reference_cache_symbol_idx").on(table.symbol),
    index("ticker_reference_cache_sector_idx").on(table.sector),
    index("ticker_reference_cache_fetched_at_idx").on(table.fetchedAt),
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
export type FlexReportRun = typeof flexReportRunsTable.$inferSelect;
export type FlexNavHistory = typeof flexNavHistoryTable.$inferSelect;
export type FlexTrade = typeof flexTradesTable.$inferSelect;
export type FlexCashActivity = typeof flexCashActivityTable.$inferSelect;
export type FlexDividend = typeof flexDividendsTable.$inferSelect;
export type FlexOpenPosition = typeof flexOpenPositionsTable.$inferSelect;
export type TickerReferenceCache = typeof tickerReferenceCacheTable.$inferSelect;
