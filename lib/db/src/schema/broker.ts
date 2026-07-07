import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { usersTable } from "./auth";
import {
  brokerProviderEnum,
  connectionStatusEnum,
  connectionTypeEnum,
  environmentModeEnum,
  marketDataProviderEnum,
} from "./enums";

export const brokerConnectionsTable = pgTable(
  "broker_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id").references(() => usersTable.id),
    name: text("name").notNull(),
    connectionType: connectionTypeEnum("connection_type").notNull(),
    brokerProvider: brokerProviderEnum("broker_provider"),
    marketDataProvider: marketDataProviderEnum("market_data_provider"),
    mode: environmentModeEnum("mode").notNull(),
    status: connectionStatusEnum("status").notNull().default("configured"),
    capabilities: text("capabilities").array().notNull().default([]),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("broker_connections_app_user_idx").on(table.appUserId),
    index("broker_connections_mode_idx").on(table.mode),
    uniqueIndex("broker_connections_unique_provider_mode_idx").on(
      table.connectionType,
      table.mode,
      table.name,
    ).where(sql`${table.appUserId} IS NULL`),
    uniqueIndex("broker_connections_user_provider_mode_idx")
      .on(table.appUserId, table.connectionType, table.mode, table.name)
      .where(sql`${table.appUserId} IS NOT NULL`),
  ],
);

export const brokerAccountsTable = pgTable(
  "broker_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id").references(() => usersTable.id),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => brokerConnectionsTable.id),
    providerAccountId: varchar("provider_account_id", { length: 128 }).notNull(),
    displayName: text("display_name").notNull(),
    mode: environmentModeEnum("mode").notNull(),
    accountStatus: varchar("account_status", { length: 32 }),
    accountType: varchar("account_type", { length: 32 }),
    includedInTrading: boolean("included_in_trading").notNull().default(true),
    baseCurrency: varchar("base_currency", { length: 16 }).notNull().default("USD"),
    capabilities: text("capabilities").array().notNull().default([]),
    executionBlockers: text("execution_blockers").array().notNull().default([]),
    isDefault: boolean("is_default").notNull().default(false),
    lastSyncedAt: text("last_synced_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("broker_accounts_provider_account_id_idx").on(
      table.providerAccountId,
    ).where(sql`${table.appUserId} IS NULL`),
    uniqueIndex("broker_accounts_user_provider_account_id_idx")
      .on(table.appUserId, table.providerAccountId)
      .where(sql`${table.appUserId} IS NOT NULL`),
    index("broker_accounts_app_user_idx").on(table.appUserId),
    index("broker_accounts_connection_idx").on(table.connectionId),
  ],
);

export const insertBrokerConnectionSchema = createInsertSchema(
  brokerConnectionsTable,
);
export const insertBrokerAccountSchema = createInsertSchema(brokerAccountsTable);

export type BrokerConnection = typeof brokerConnectionsTable.$inferSelect;
export type InsertBrokerConnection = typeof brokerConnectionsTable.$inferInsert;
export type BrokerAccount = typeof brokerAccountsTable.$inferSelect;
export type InsertBrokerAccount = typeof brokerAccountsTable.$inferInsert;
