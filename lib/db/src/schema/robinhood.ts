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
