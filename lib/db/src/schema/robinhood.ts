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

export const robinhoodUserCredentialsTable = pgTable(
  "robinhood_user_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    oauthClientId: varchar("oauth_client_id", { length: 128 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    oauthState: varchar("oauth_state", { length: 128 }),
    pkceVerifierCiphertext: text("pkce_verifier_ciphertext"),
    connectStartedAt: timestamp("connect_started_at", { withTimezone: true }),
    accessTokenCiphertext: text("access_token_ciphertext"),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    tokenKeyVersion: varchar("token_key_version", { length: 64 }).notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    scope: varchar("scope", { length: 128 }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("robinhood_user_credentials_app_user_idx").on(table.appUserId),
    index("robinhood_user_credentials_status_idx").on(table.status),
  ],
);

export const insertRobinhoodUserCredentialSchema = createInsertSchema(
  robinhoodUserCredentialsTable,
);

export type RobinhoodUserCredential =
  typeof robinhoodUserCredentialsTable.$inferSelect;
export type InsertRobinhoodUserCredential =
  typeof robinhoodUserCredentialsTable.$inferInsert;

// Per-trade realized P&L history backfilled from the Robinhood MCP
// `get_pnl_trade_history` tool (rows: timestamp/symbol/side/quantity/price/
// realized_gain). Mirrors snapTradeAccountActivitiesTable so account-detail P&L
// populates automatically via the scheduler + on-connect hook, without a page
// open. Robinhood returns realized P&L already computed per closing trade, so no
// cost-basis lot matching is needed. Dedup key is a deterministic hash of the
// row's identity fields (Robinhood P&L trades carry no stable server id).
export const robinhoodAccountActivitiesTable = pgTable(
  "robinhood_account_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => brokerAccountsTable.id),
    activityKey: varchar("activity_key", { length: 128 }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
    symbol: varchar("symbol", { length: 96 }),
    side: varchar("side", { length: 16 }),
    quantity: numeric("quantity", { precision: 20, scale: 6 }),
    price: numeric("price", { precision: 20, scale: 6 }),
    realizedGain: numeric("realized_gain", { precision: 20, scale: 6 }),
    currency: varchar("currency", { length: 16 }).notNull().default("USD"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("robinhood_account_activities_account_idx").on(table.accountId),
    index("robinhood_account_activities_account_closed_at_idx").on(
      table.accountId,
      table.closedAt.desc(),
    ),
    uniqueIndex("robinhood_account_activities_unique_idx").on(
      table.accountId,
      table.activityKey,
    ),
  ],
);

export const insertRobinhoodAccountActivitySchema = createInsertSchema(
  robinhoodAccountActivitiesTable,
);

export type RobinhoodAccountActivity =
  typeof robinhoodAccountActivitiesTable.$inferSelect;
export type InsertRobinhoodAccountActivity =
  typeof robinhoodAccountActivitiesTable.$inferInsert;
