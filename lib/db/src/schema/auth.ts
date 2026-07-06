import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
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

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: text("display_name"),
    // Nullable: JIT "launch" users authenticate via the parent site (identity is
    // (external_issuer, external_user_id)) and have no local password.
    passwordHash: text("password_hash"),
    externalUserId: text("external_user_id"),
    externalIssuer: text("external_issuer"),
    // Entitlements carried from the launch token (e.g. "broker_connect").
    entitlements: text("entitlements").array().notNull().default([]),
    plan: text("plan"),
    role: varchar("role", { length: 32 }).notNull().default("member"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // Email stays unique among PASSWORD users (login keys on email); launch users
    // (null password) key on (issuer, sub) and may share an email.
    uniqueIndex("users_email_idx")
      .on(table.email)
      .where(sql`${table.passwordHash} IS NOT NULL`),
    uniqueIndex("users_external_identity_idx")
      .on(table.externalIssuer, table.externalUserId)
      .where(sql`${table.externalUserId} IS NOT NULL`),
  ],
);

export const authSessionsTable = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id),
    tokenHash: varchar("token_hash", { length: 96 }).notNull(),
    csrfTokenHash: varchar("csrf_token_hash", { length: 96 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_idx").on(table.tokenHash),
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

// One-time replay guard for launch-token JWTs (Slice 6). A launch token's `jti` is
// inserted here on first use; a second insert (replay) violates the PK and is rejected.
// Rows past `expiresAt` (the token's own exp) are dead weight and swept periodically.
export const launchTokenJtiTable = pgTable(
  "launch_token_jti",
  {
    jti: text("jti").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("launch_token_jti_expires_at_idx").on(table.expiresAt)],
);

export const insertUserSchema = createInsertSchema(usersTable);
export const insertAuthSessionSchema = createInsertSchema(authSessionsTable);

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
export type AuthSession = typeof authSessionsTable.$inferSelect;
export type InsertAuthSession = typeof authSessionsTable.$inferInsert;
export type LaunchTokenJti = typeof launchTokenJtiTable.$inferSelect;
export type InsertLaunchTokenJti = typeof launchTokenJtiTable.$inferInsert;
