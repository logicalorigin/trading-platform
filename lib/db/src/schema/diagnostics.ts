import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";

type JsonRecord = Record<string, unknown>;

export const diagnosticSnapshotsTable = pgTable(
  "diagnostic_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    subsystem: varchar("subsystem", { length: 48 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("ok"),
    severity: varchar("severity", { length: 24 }).notNull().default("info"),
    summary: text("summary"),
    dimensions: jsonb("dimensions").$type<JsonRecord>().notNull().default({}),
    metrics: jsonb("metrics").$type<JsonRecord>().notNull().default({}),
    raw: jsonb("raw").$type<JsonRecord>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    index("diagnostic_snapshots_observed_at_idx").on(table.observedAt),
    index("diagnostic_snapshots_subsystem_observed_idx").on(
      table.subsystem,
      table.observedAt,
    ),
    index("diagnostic_snapshots_severity_idx").on(table.severity),
  ],
);

export const diagnosticEventsTable = pgTable(
  "diagnostic_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    incidentKey: text("incident_key").notNull(),
    subsystem: varchar("subsystem", { length: 48 }).notNull(),
    category: varchar("category", { length: 64 }).notNull(),
    code: varchar("code", { length: 96 }),
    severity: varchar("severity", { length: 24 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    message: text("message").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    eventCount: integer("event_count").notNull().default(1),
    dimensions: jsonb("dimensions").$type<JsonRecord>().notNull().default({}),
    raw: jsonb("raw").$type<JsonRecord>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("diagnostic_events_incident_key_idx").on(table.incidentKey),
    index("diagnostic_events_last_seen_idx").on(table.lastSeenAt),
    index("diagnostic_events_subsystem_idx").on(table.subsystem),
    index("diagnostic_events_severity_idx").on(table.severity),
    index("diagnostic_events_status_idx").on(table.status),
  ],
);

export const diagnosticThresholdOverridesTable = pgTable(
  "diagnostic_threshold_overrides",
  {
    metricKey: varchar("metric_key", { length: 128 }).primaryKey(),
    warning: doublePrecision("warning"),
    critical: doublePrecision("critical"),
    enabled: boolean("enabled").notNull().default(true),
    audible: boolean("audible").notNull().default(true),
    ...timestamps,
  },
);

export const insertDiagnosticSnapshotSchema = createInsertSchema(
  diagnosticSnapshotsTable,
);
export const insertDiagnosticEventSchema = createInsertSchema(
  diagnosticEventsTable,
);
export const insertDiagnosticThresholdOverrideSchema = createInsertSchema(
  diagnosticThresholdOverridesTable,
);

export type DiagnosticSnapshot = typeof diagnosticSnapshotsTable.$inferSelect;
export type InsertDiagnosticSnapshot =
  typeof diagnosticSnapshotsTable.$inferInsert;
export type DiagnosticEvent = typeof diagnosticEventsTable.$inferSelect;
export type InsertDiagnosticEvent = typeof diagnosticEventsTable.$inferInsert;
export type DiagnosticThresholdOverride =
  typeof diagnosticThresholdOverridesTable.$inferSelect;
export type InsertDiagnosticThresholdOverride =
  typeof diagnosticThresholdOverridesTable.$inferInsert;
