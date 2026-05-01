import {
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
    source: varchar("source", { length: 32 }).notNull().default("polygon"),
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
    source: varchar("source", { length: 32 }).notNull().default("polygon"),
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
    source: text("source").notNull().default("polygon"),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("option_chain_snapshots_underlying_idx").on(table.underlyingInstrumentId),
    index("option_chain_snapshots_contract_idx").on(table.optionContractId),
    index("option_chain_snapshots_as_of_idx").on(table.asOf),
  ],
);
