import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { universeHydrationStatusEnum, universeMarketEnum } from "./enums";

export const universeCatalogListingsTable = pgTable(
  "universe_catalog_listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingKey: varchar("listing_key", { length: 160 }).notNull(),
    market: universeMarketEnum("market").notNull(),
    ticker: varchar("ticker", { length: 64 }).notNull(),
    normalizedTicker: varchar("normalized_ticker", { length: 64 }).notNull(),
    rootSymbol: varchar("root_symbol", { length: 64 }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    normalizedExchangeMic: varchar("normalized_exchange_mic", { length: 32 }),
    exchangeDisplay: varchar("exchange_display", { length: 64 }),
    locale: varchar("locale", { length: 32 }),
    type: varchar("type", { length: 32 }),
    active: boolean("active").notNull().default(true),
    primaryExchange: varchar("primary_exchange", { length: 64 }),
    currencyName: varchar("currency_name", { length: 64 }),
    cik: varchar("cik", { length: 32 }),
    compositeFigi: varchar("composite_figi", { length: 64 }),
    shareClassFigi: varchar("share_class_figi", { length: 64 }),
    providerContractId: varchar("provider_contract_id", { length: 128 }),
    providers: text("providers").array().notNull().default([]),
    tradeProvider: varchar("trade_provider", { length: 32 }),
    dataProviderPreference: varchar("data_provider_preference", {
      length: 32,
    }),
    ibkrHydrationStatus: universeHydrationStatusEnum("ibkr_hydration_status")
      .notNull()
      .default("pending"),
    ibkrHydrationAttemptedAt: timestamp("ibkr_hydration_attempted_at", {
      withTimezone: true,
    }),
    ibkrHydratedAt: timestamp("ibkr_hydrated_at", { withTimezone: true }),
    ibkrHydrationError: text("ibkr_hydration_error"),
    contractDescription: text("contract_description"),
    contractMeta: jsonb("contract_meta").$type<Record<string, unknown> | null>(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("universe_catalog_listing_key_idx").on(table.listingKey),
    index("universe_catalog_market_idx").on(table.market),
    index("universe_catalog_ticker_idx").on(table.normalizedTicker),
    index("universe_catalog_root_idx").on(table.rootSymbol),
    index("universe_catalog_name_idx").on(table.normalizedName),
    index("universe_catalog_provider_contract_idx").on(table.providerContractId),
    index("universe_catalog_figi_idx").on(table.compositeFigi),
    index("universe_catalog_share_class_figi_idx").on(table.shareClassFigi),
    index("universe_catalog_cik_idx").on(table.cik),
    index("universe_catalog_hydration_idx").on(
      table.market,
      table.active,
      table.ibkrHydrationStatus,
    ),
  ],
);

export const universeCatalogSyncStatesTable = pgTable(
  "universe_catalog_sync_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeKey: varchar("scope_key", { length: 160 }).notNull(),
    phase: varchar("phase", { length: 32 }).notNull(),
    market: universeMarketEnum("market").notNull(),
    activeOnly: boolean("active_only").notNull().default(true),
    cursor: text("cursor"),
    lastProcessedListingKey: varchar("last_processed_listing_key", {
      length: 160,
    }),
    pagesSynced: integer("pages_synced").notNull().default(0),
    rowsSynced: integer("rows_synced").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("universe_catalog_sync_scope_idx").on(table.scopeKey),
    index("universe_catalog_sync_phase_idx").on(
      table.phase,
      table.market,
      table.activeOnly,
    ),
  ],
);

export const insertUniverseCatalogListingSchema = createInsertSchema(
  universeCatalogListingsTable,
);
export const insertUniverseCatalogSyncStateSchema = createInsertSchema(
  universeCatalogSyncStatesTable,
);

export type UniverseCatalogListing =
  typeof universeCatalogListingsTable.$inferSelect;
export type InsertUniverseCatalogListing =
  typeof universeCatalogListingsTable.$inferInsert;
export type UniverseCatalogSyncState =
  typeof universeCatalogSyncStatesTable.$inferSelect;
export type InsertUniverseCatalogSyncState =
  typeof universeCatalogSyncStatesTable.$inferInsert;
