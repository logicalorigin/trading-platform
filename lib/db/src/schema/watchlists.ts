import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { instrumentsTable } from "./instruments";

export const watchlistsTable = pgTable("watchlists", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  ...timestamps,
});

export const watchlistItemsTable = pgTable(
  "watchlist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    watchlistId: uuid("watchlist_id")
      .notNull()
      .references(() => watchlistsTable.id),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrumentsTable.id),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("watchlist_items_watchlist_idx").on(table.watchlistId),
    uniqueIndex("watchlist_items_unique_item_idx").on(
      table.watchlistId,
      table.instrumentId,
    ),
  ],
);

export const insertWatchlistSchema = createInsertSchema(watchlistsTable);
export const insertWatchlistItemSchema = createInsertSchema(watchlistItemsTable);

export type Watchlist = typeof watchlistsTable.$inferSelect;
export type InsertWatchlist = typeof watchlistsTable.$inferInsert;
export type WatchlistItem = typeof watchlistItemsTable.$inferSelect;
export type InsertWatchlistItem = typeof watchlistItemsTable.$inferInsert;
