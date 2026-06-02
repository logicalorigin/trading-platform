import {
  jsonb,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { instrumentsTable, optionContractsTable } from "./instruments";

export const quoteCacheTable = pgTable(
  "quote_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrumentsTable.id),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    bid: numeric("bid", { precision: 18, scale: 6 }),
    ask: numeric("ask", { precision: 18, scale: 6 }),
    last: numeric("last", { precision: 18, scale: 6 }),
    bidSize: integer("bid_size"),
    askSize: integer("ask_size"),
    lastSize: integer("last_size"),
    change: numeric("change", { precision: 18, scale: 6 }),
    changePercent: numeric("change_percent", { precision: 18, scale: 6 }),
    source: varchar("source", { length: 32 }).notNull().default("massive"),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("quote_cache_instrument_idx").on(table.instrumentId),
    index("quote_cache_symbol_idx").on(table.symbol),
    index("quote_cache_as_of_idx").on(table.asOf),
  ],
);

export const barCacheTable = pgTable(
  "bar_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrumentsTable.id),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    timeframe: varchar("timeframe", { length: 16 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    open: numeric("open", { precision: 18, scale: 6 }).notNull(),
    high: numeric("high", { precision: 18, scale: 6 }).notNull(),
    low: numeric("low", { precision: 18, scale: 6 }).notNull(),
    close: numeric("close", { precision: 18, scale: 6 }).notNull(),
    volume: numeric("volume", { precision: 20, scale: 4 }).notNull(),
    source: varchar("source", { length: 32 }).notNull().default("massive"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("bar_cache_instrument_timeframe_source_starts_at_idx").on(
      table.instrumentId,
      table.timeframe,
      table.source,
      table.startsAt,
    ),
    index("bar_cache_instrument_idx").on(table.instrumentId),
    index("bar_cache_symbol_timeframe_idx").on(table.symbol, table.timeframe),
    index("bar_cache_starts_at_idx").on(table.startsAt),
  ],
);

export const optionChainSnapshotsTable = pgTable(
  "option_chain_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    underlyingInstrumentId: uuid("underlying_instrument_id")
      .notNull()
      .references(() => instrumentsTable.id),
    optionContractId: uuid("option_contract_id")
      .notNull()
      .references(() => optionContractsTable.id),
    bid: numeric("bid", { precision: 18, scale: 6 }),
    ask: numeric("ask", { precision: 18, scale: 6 }),
    last: numeric("last", { precision: 18, scale: 6 }),
    mark: numeric("mark", { precision: 18, scale: 6 }),
    impliedVolatility: numeric("implied_volatility", { precision: 18, scale: 6 }),
    delta: numeric("delta", { precision: 18, scale: 6 }),
    gamma: numeric("gamma", { precision: 18, scale: 6 }),
    theta: numeric("theta", { precision: 18, scale: 6 }),
    vega: numeric("vega", { precision: 18, scale: 6 }),
    openInterest: integer("open_interest"),
    volume: integer("volume"),
    source: text("source").notNull().default("massive"),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("option_chain_snapshots_underlying_idx").on(table.underlyingInstrumentId),
    index("option_chain_snapshots_contract_idx").on(table.optionContractId),
    index("option_chain_snapshots_as_of_idx").on(table.asOf),
    index("option_chain_snapshots_underlying_contract_as_of_idx").on(
      table.underlyingInstrumentId,
      table.optionContractId,
      table.asOf.desc(),
    ),
  ],
);

export const marketDataIngestJobsTable = pgTable(
  "market_data_ingest_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: varchar("kind", { length: 48 }).notNull(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    timeframe: varchar("timeframe", { length: 16 }),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    priority: integer("priority").notNull().default(5),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    leaseOwner: varchar("lease_owner", { length: 128 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown> | null>(),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("market_data_ingest_jobs_dedupe_key_idx").on(table.dedupeKey),
    index("market_data_ingest_jobs_status_priority_idx").on(
      table.status,
      table.priority,
      table.nextRunAt,
      table.createdAt,
    ),
    index("market_data_ingest_jobs_symbol_kind_idx").on(table.symbol, table.kind),
    index("market_data_ingest_jobs_lease_expires_idx").on(table.leaseExpiresAt),
  ],
);

export const providerRequestLogTable = pgTable(
  "provider_request_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: varchar("provider", { length: 32 }).notNull(),
    endpointFamily: varchar("endpoint_family", { length: 64 }).notNull(),
    symbol: varchar("symbol", { length: 64 }),
    requestKey: varchar("request_key", { length: 256 }),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    status: varchar("status", { length: 32 }).notNull(),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
    rowCount: integer("row_count"),
    pageCount: integer("page_count"),
    retryCount: integer("retry_count").notNull().default(0),
    rateLimitResetAt: timestamp("rate_limit_reset_at", { withTimezone: true }),
    errorCode: varchar("error_code", { length: 96 }),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    ...timestamps,
  },
  (table) => [
    index("provider_request_log_provider_created_idx").on(
      table.provider,
      table.createdAt,
    ),
    index("provider_request_log_family_created_idx").on(
      table.endpointFamily,
      table.createdAt,
    ),
    index("provider_request_log_symbol_created_idx").on(table.symbol, table.createdAt),
  ],
);

export const gexSnapshotsTable = pgTable(
  "gex_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    spot: numeric("spot", { precision: 18, scale: 6 }).notNull(),
    netGex: numeric("net_gex", { precision: 24, scale: 6 }).notNull(),
    optionCount: integer("option_count").notNull().default(0),
    usableOptionCount: integer("usable_option_count").notNull().default(0),
    sourceStatus: varchar("source_status", { length: 32 }).notNull().default("ok"),
    sourceMessage: text("source_message"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("gex_snapshots_symbol_computed_at_idx").on(
      table.symbol,
      table.computedAt,
    ),
    index("gex_snapshots_symbol_latest_idx").on(table.symbol, table.computedAt),
  ],
);

export const flowSummariesTable = pgTable(
  "flow_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    eventCount: integer("event_count").notNull().default(0),
    bullishPremium: numeric("bullish_premium", { precision: 24, scale: 6 })
      .notNull()
      .default("0"),
    bearishPremium: numeric("bearish_premium", { precision: 24, scale: 6 })
      .notNull()
      .default("0"),
    neutralPremium: numeric("neutral_premium", { precision: 24, scale: 6 })
      .notNull()
      .default("0"),
    netDelta: numeric("net_delta", { precision: 24, scale: 6 })
      .notNull()
      .default("0"),
    sourceStatus: varchar("source_status", { length: 32 }).notNull().default("ok"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("flow_summaries_symbol_window_idx").on(
      table.symbol,
      table.windowStart,
      table.windowEnd,
    ),
    index("flow_summaries_symbol_latest_idx").on(table.symbol, table.windowEnd),
  ],
);
