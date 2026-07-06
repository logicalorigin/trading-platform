import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { usersTable } from "./auth";

export const userPreferenceProfilesTable = pgTable(
  "user_preference_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id").references(() => usersTable.id),
    profileKey: text("profile_key").notNull(),
    version: integer("version").notNull().default(1),
    preferences: jsonb("preferences")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    // Per-user: one preferences row per user (Slice 5.4). The legacy global
    // unique on profile_key was dropped — it blocked a second user from ever
    // owning a row since every user shares profile_key 'default'.
    uniqueIndex("user_preference_profiles_app_user_idx")
      .on(table.appUserId)
      .where(sql`${table.appUserId} IS NOT NULL`),
  ],
);

export const insertUserPreferenceProfileSchema = createInsertSchema(
  userPreferenceProfilesTable,
);

export type UserPreferenceProfile =
  typeof userPreferenceProfilesTable.$inferSelect;
export type InsertUserPreferenceProfile =
  typeof userPreferenceProfilesTable.$inferInsert;
