import { createInsertSchema } from "drizzle-zod";
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
    polygonTicker: varchar("polygon_ticker", { length: 64 }).notNull(),
    providerContractId: varchar("provider_contract_id", { length: 128 }),
    expirationDate: date("expiration_date").notNull(),
    strike: numeric("strike", { precision: 18, scale: 6 }).notNull(),
    right: optionRightEnum("right").notNull(),
    multiplier: integer("multiplier").notNull().default(100),
    sharesPerContract: integer("shares_per_contract").notNull().default(100),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("option_contracts_polygon_ticker_idx").on(table.polygonTicker),
    uniqueIndex("option_contracts_provider_contract_id_idx").on(
      table.providerContractId,
    ),
    index("option_contracts_underlying_idx").on(table.underlyingInstrumentId),
    index("option_contracts_expiration_idx").on(table.expirationDate),
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
