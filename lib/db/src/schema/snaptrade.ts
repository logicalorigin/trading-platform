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
import { usersTable } from "./auth";
import { brokerAccountsTable } from "./broker";

export const snapTradeUserCredentialsTable = pgTable(
  "snaptrade_user_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    snapTradeUserId: varchar("snaptrade_user_id", { length: 128 }).notNull(),
    userSecretCiphertext: text("user_secret_ciphertext").notNull(),
    userSecretKeyVersion: varchar("user_secret_key_version", {
      length: 64,
    }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("registered"),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("snaptrade_user_credentials_app_user_idx").on(table.appUserId),
    uniqueIndex("snaptrade_user_credentials_snaptrade_user_idx").on(
      table.snapTradeUserId,
    ),
    index("snaptrade_user_credentials_status_idx").on(table.status),
  ],
);

export const insertSnapTradeUserCredentialSchema = createInsertSchema(
  snapTradeUserCredentialsTable,
);

export const snapTradeAccountActivitiesTable = pgTable(
  "snaptrade_account_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => brokerAccountsTable.id),
    snapTradeActivityId: varchar("snaptrade_activity_id", {
      length: 180,
    }).notNull(),
    tradeDate: timestamp("trade_date", { withTimezone: true }).notNull(),
    settlementDate: timestamp("settlement_date", { withTimezone: true }),
    type: varchar("type", { length: 64 }).notNull(),
    optionType: varchar("option_type", { length: 48 }),
    symbol: varchar("symbol", { length: 96 }),
    rawSymbol: varchar("raw_symbol", { length: 160 }),
    description: text("description"),
    optionTicker: varchar("option_ticker", { length: 160 }),
    quantity: numeric("quantity", { precision: 20, scale: 6 }),
    price: numeric("price", { precision: 20, scale: 6 }),
    amount: numeric("amount", { precision: 20, scale: 6 }),
    fee: numeric("fee", { precision: 20, scale: 6 }),
    currency: varchar("currency", { length: 16 }).notNull().default("USD"),
    externalReferenceId: varchar("external_reference_id", { length: 180 }),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("snaptrade_account_activities_account_idx").on(table.accountId),
    index("snaptrade_account_activities_account_trade_date_idx").on(
      table.accountId,
      table.tradeDate.desc(),
    ),
    index("snaptrade_account_activities_symbol_idx").on(table.symbol),
    uniqueIndex("snaptrade_account_activities_unique_idx").on(
      table.accountId,
      table.snapTradeActivityId,
    ),
  ],
);

export const insertSnapTradeAccountActivitySchema = createInsertSchema(
  snapTradeAccountActivitiesTable,
);

export type SnapTradeUserCredential =
  typeof snapTradeUserCredentialsTable.$inferSelect;
export type InsertSnapTradeUserCredential =
  typeof snapTradeUserCredentialsTable.$inferInsert;
export type SnapTradeAccountActivity =
  typeof snapTradeAccountActivitiesTable.$inferSelect;
export type InsertSnapTradeAccountActivity =
  typeof snapTradeAccountActivitiesTable.$inferInsert;
