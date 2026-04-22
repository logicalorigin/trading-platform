import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { pineScriptPaneTypeEnum, pineScriptStatusEnum } from "./enums";

export const pineScriptsTable = pgTable(
  "pine_scripts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scriptKey: varchar("script_key", { length: 128 }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    sourceCode: text("source_code").notNull(),
    status: pineScriptStatusEnum("status").notNull().default("draft"),
    defaultPaneType: pineScriptPaneTypeEnum("default_pane_type")
      .notNull()
      .default("price"),
    chartAccessEnabled: boolean("chart_access_enabled")
      .notNull()
      .default(false),
    notes: text("notes"),
    lastError: text("last_error"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pine_scripts_script_key_idx").on(table.scriptKey),
    index("pine_scripts_status_idx").on(table.status),
    index("pine_scripts_updated_at_idx").on(table.updatedAt),
  ],
);

export const insertPineScriptSchema = createInsertSchema(pineScriptsTable);

export type PineScript = typeof pineScriptsTable.$inferSelect;
export type InsertPineScript = typeof pineScriptsTable.$inferInsert;
