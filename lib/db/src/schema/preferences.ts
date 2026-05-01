import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";

export const userPreferenceProfilesTable = pgTable(
  "user_preference_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileKey: text("profile_key").notNull(),
    version: integer("version").notNull().default(1),
    preferences: jsonb("preferences")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_preference_profiles_profile_key_idx").on(
      table.profileKey,
    ),
  ],
);

export const insertUserPreferenceProfileSchema = createInsertSchema(
  userPreferenceProfilesTable,
);

export type UserPreferenceProfile =
  typeof userPreferenceProfilesTable.$inferSelect;
export type InsertUserPreferenceProfile =
  typeof userPreferenceProfilesTable.$inferInsert;
