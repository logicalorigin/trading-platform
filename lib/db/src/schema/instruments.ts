import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { assetClassEnum, optionRightEnum } from "./enums";

export const instrumentsTable = pgTable(
  "instruments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    assetClass: assetClassEnum("asset_class").notNull(),
    name: text("name"),
    exchange: varchar("exchange", { length: 32 }),
    currency: varchar("currency", { length: 16 }).notNull().default("USD"),
    underlyingSymbol: varchar("underlying_symbol", { length: 64 }),
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("instruments_symbol_idx").on(table.symbol),
    index("instruments_asset_class_idx").on(table.assetClass),
    index("instruments_underlying_symbol_idx").on(table.underlyingSymbol),
  ],
);

export const instrumentAliasesTable = pgTable(
  "instrument_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrumentsTable.id),
    provider: varchar("provider", { length: 32 }).notNull(),
    aliasType: varchar("alias_type", { length: 32 }).notNull(),
    aliasValue: varchar("alias_value", { length: 128 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("instrument_alias_provider_value_idx").on(
      table.provider,
      table.aliasValue,
    ),
    index("instrument_alias_instrument_idx").on(table.instrumentId),
  ],
);

export const optionContractsTable = pgTable(
  "option_contracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrumentsTable.id),
    underlyingInstrumentId: uuid("underlying_instrument_id")
      .notNull()
      .references(() => instrumentsTable.id),
    massiveTicker: varchar("massive_ticker", { length: 64 }).notNull(),
    providerContractId: varchar("provider_contract_id", { length: 128 }),
    brokerContractId: varchar("broker_contract_id", { length: 128 }),
    expirationDate: date("expiration_date").notNull(),
    strike: numeric("strike", { precision: 18, scale: 6 }).notNull(),
    right: optionRightEnum("right").notNull(),
    multiplier: integer("multiplier").notNull().default(100),
    sharesPerContract: integer("shares_per_contract").notNull().default(100),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("option_contracts_massive_ticker_idx").on(table.massiveTicker),
    uniqueIndex("option_contracts_provider_contract_id_idx").on(
      table.providerContractId,
    ),
    uniqueIndex("option_contracts_broker_contract_id_idx").on(
      table.brokerContractId,
    ),
    index("option_contracts_underlying_idx").on(table.underlyingInstrumentId),
    index("option_contracts_expiration_idx").on(table.expirationDate),
    // Durable option-chain cache loads filter by underlying + expiration_date>=today
    // and order by expiration_date; this composite keeps that an index range scan
    // instead of a full per-underlying scan + sort over the expired backlog.
    index("option_contracts_underlying_expiration_idx").on(
      table.underlyingInstrumentId,
      table.expirationDate,
    ),
    // Hot durable option-chain loads read only active future contracts for one
    // underlying and return display order. Keep the partial index aligned with
    // lib/db/migrations/20260626_option_contracts_active_chain_order_idx.sql.
    index("option_contracts_active_chain_order_idx")
      .on(
        table.underlyingInstrumentId,
        table.expirationDate,
        table.strike,
        table.right,
      )
      .where(sql`${table.isActive} = true`),
  ],
);

export const insertInstrumentSchema = createInsertSchema(instrumentsTable);
export const insertInstrumentAliasSchema = createInsertSchema(
  instrumentAliasesTable,
);
export const insertOptionContractSchema = createInsertSchema(
  optionContractsTable,
);

export type Instrument = typeof instrumentsTable.$inferSelect;
export type InsertInstrument = typeof instrumentsTable.$inferInsert;
export type InstrumentAlias = typeof instrumentAliasesTable.$inferSelect;
export type InsertInstrumentAlias = typeof instrumentAliasesTable.$inferInsert;
export type OptionContract = typeof optionContractsTable.$inferSelect;
export type InsertOptionContract = typeof optionContractsTable.$inferInsert;
