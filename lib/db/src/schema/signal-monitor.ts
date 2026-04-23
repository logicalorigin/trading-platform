import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  integer,
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
import { environmentModeEnum } from "./enums";
import { watchlistsTable } from "./watchlists";

export const signalMonitorProfilesTable = pgTable(
  "signal_monitor_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environment: environmentModeEnum("environment").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    watchlistId: uuid("watchlist_id").references(() => watchlistsTable.id),
    timeframe: varchar("timeframe", { length: 16 }).notNull().default("15m"),
    rayReplicaSettings: jsonb("ray_replica_settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    freshWindowBars: integer("fresh_window_bars").notNull().default(3),
    pollIntervalSeconds: integer("poll_interval_seconds").notNull().default(60),
    maxSymbols: integer("max_symbols").notNull().default(50),
    evaluationConcurrency: integer("evaluation_concurrency").notNull().default(3),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("signal_monitor_profiles_environment_idx").on(table.environment),
    index("signal_monitor_profiles_watchlist_idx").on(table.watchlistId),
  ],
);

export const signalMonitorSymbolStatesTable = pgTable(
  "signal_monitor_symbol_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => signalMonitorProfilesTable.id),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    timeframe: varchar("timeframe", { length: 16 }).notNull(),
    currentSignalDirection: varchar("current_signal_direction", { length: 8 }),
    currentSignalAt: timestamp("current_signal_at", { withTimezone: true }),
    currentSignalPrice: numeric("current_signal_price", {
      precision: 18,
      scale: 6,
    }),
    latestBarAt: timestamp("latest_bar_at", { withTimezone: true }),
    barsSinceSignal: integer("bars_since_signal"),
    fresh: boolean("fresh").notNull().default(false),
    status: varchar("status", { length: 32 }).notNull().default("unknown"),
    active: boolean("active").notNull().default(true),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("signal_monitor_symbol_states_unique_idx").on(
      table.profileId,
      table.symbol,
      table.timeframe,
    ),
    index("signal_monitor_symbol_states_profile_idx").on(table.profileId),
    index("signal_monitor_symbol_states_symbol_idx").on(table.symbol),
  ],
);

export const signalMonitorEventsTable = pgTable(
  "signal_monitor_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => signalMonitorProfilesTable.id),
    eventKey: text("event_key").notNull(),
    environment: environmentModeEnum("environment").notNull(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    timeframe: varchar("timeframe", { length: 16 }).notNull(),
    direction: varchar("direction", { length: 8 }).notNull(),
    signalAt: timestamp("signal_at", { withTimezone: true }).notNull(),
    signalPrice: numeric("signal_price", { precision: 18, scale: 6 }),
    close: numeric("close", { precision: 18, scale: 6 }),
    source: varchar("source", { length: 32 }).notNull().default("monitor"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    emittedAt: timestamp("emitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("signal_monitor_events_event_key_idx").on(table.eventKey),
    index("signal_monitor_events_profile_idx").on(table.profileId),
    index("signal_monitor_events_symbol_idx").on(table.symbol),
    index("signal_monitor_events_signal_at_idx").on(table.signalAt),
  ],
);

export const insertSignalMonitorProfileSchema = createInsertSchema(
  signalMonitorProfilesTable,
);
export const insertSignalMonitorSymbolStateSchema = createInsertSchema(
  signalMonitorSymbolStatesTable,
);
export const insertSignalMonitorEventSchema = createInsertSchema(
  signalMonitorEventsTable,
);

export type SignalMonitorProfile =
  typeof signalMonitorProfilesTable.$inferSelect;
export type InsertSignalMonitorProfile =
  typeof signalMonitorProfilesTable.$inferInsert;
export type SignalMonitorSymbolState =
  typeof signalMonitorSymbolStatesTable.$inferSelect;
export type InsertSignalMonitorSymbolState =
  typeof signalMonitorSymbolStatesTable.$inferInsert;
export type SignalMonitorEvent = typeof signalMonitorEventsTable.$inferSelect;
export type InsertSignalMonitorEvent =
  typeof signalMonitorEventsTable.$inferInsert;
