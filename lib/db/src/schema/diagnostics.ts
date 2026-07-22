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

export const DIAGNOSTIC_EVENT_PROVENANCE_KEY = "__pyrusProvenance";

export type DiagnosticEventProvenance = {
  source:
    | "server"
    | "browser_client_event"
    | "browser_report"
    | "legacy_unknown";
  trust: "trusted" | "untrusted" | "unknown";
  actorScope: string | null;
};

export const SERVER_DIAGNOSTIC_EVENT_PROVENANCE = {
  source: "server",
  trust: "trusted",
  actorScope: null,
} as const satisfies DiagnosticEventProvenance;

export const LEGACY_DIAGNOSTIC_EVENT_PROVENANCE = {
  source: "legacy_unknown",
  trust: "unknown",
  actorScope: null,
} as const satisfies DiagnosticEventProvenance;

const DIAGNOSTIC_ACTOR_SCOPE_PATTERN = /^usr_[a-f0-9]{64}$/u;

export function readDiagnosticEventProvenance(
  dimensions: unknown,
): DiagnosticEventProvenance {
  if (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) {
    return LEGACY_DIAGNOSTIC_EVENT_PROVENANCE;
  }

  const provenance = (dimensions as JsonRecord)[
    DIAGNOSTIC_EVENT_PROVENANCE_KEY
  ];
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    return LEGACY_DIAGNOSTIC_EVENT_PROVENANCE;
  }

  const record = provenance as JsonRecord;
  if (
    record.source === "server" &&
    record.trust === "trusted" &&
    record.actorScope === null
  ) {
    return SERVER_DIAGNOSTIC_EVENT_PROVENANCE;
  }
  if (
    (record.source === "browser_client_event" ||
      record.source === "browser_report") &&
    record.trust === "untrusted" &&
    typeof record.actorScope === "string" &&
    DIAGNOSTIC_ACTOR_SCOPE_PATTERN.test(record.actorScope)
  ) {
    return {
      source: record.source,
      trust: "untrusted",
      actorScope: record.actorScope,
    };
  }
  return LEGACY_DIAGNOSTIC_EVENT_PROVENANCE;
}

export function persistDiagnosticEventProvenance(
  dimensions: JsonRecord,
  provenance: DiagnosticEventProvenance,
): JsonRecord {
  return {
    ...publicDiagnosticEventDimensions(dimensions),
    [DIAGNOSTIC_EVENT_PROVENANCE_KEY]: provenance,
  };
}

export function publicDiagnosticEventDimensions(
  dimensions: JsonRecord,
): JsonRecord {
  const visible = { ...dimensions };
  delete visible[DIAGNOSTIC_EVENT_PROVENANCE_KEY];
  return visible;
}

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
