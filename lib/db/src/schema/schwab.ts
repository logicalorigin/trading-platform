import { createInsertSchema } from "drizzle-zod";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { usersTable } from "./auth";

// Schwab Trader API OAuth custody. Unlike Robinhood there is no per-user
// OAuth client (the app key/secret are app-level env secrets) and no PKCE;
// Schwab's refresh token hard-expires 7 days after issuance, so its expiry is
// tracked explicitly to surface the weekly reconnect requirement.
export const schwabUserCredentialsTable = pgTable(
  "schwab_user_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    oauthState: varchar("oauth_state", { length: 128 }),
    connectStartedAt: timestamp("connect_started_at", { withTimezone: true }),
    accessTokenCiphertext: text("access_token_ciphertext"),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    tokenKeyVersion: varchar("token_key_version", { length: 64 }).notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: varchar("scope", { length: 128 }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("schwab_user_credentials_app_user_idx").on(table.appUserId),
    index("schwab_user_credentials_status_idx").on(table.status),
  ],
);

export const insertSchwabUserCredentialSchema = createInsertSchema(
  schwabUserCredentialsTable,
);

export type SchwabUserCredential =
  typeof schwabUserCredentialsTable.$inferSelect;
export type InsertSchwabUserCredential =
  typeof schwabUserCredentialsTable.$inferInsert;
