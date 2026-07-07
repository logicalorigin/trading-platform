import { createInsertSchema } from "drizzle-zod";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { usersTable } from "./auth";

export type AuditEventPayload = Record<string, unknown>;

export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    eventType: varchar("event_type", { length: 96 }).notNull(),
    subjectType: varchar("subject_type", { length: 64 }),
    subjectId: text("subject_id"),
    resourceType: varchar("resource_type", { length: 64 }),
    resourceId: text("resource_id"),
    payload: jsonb("payload").$type<AuditEventPayload>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_events_app_user_created_at_idx").on(
      table.appUserId,
      table.createdAt,
    ),
    index("audit_events_event_type_created_at_idx").on(
      table.eventType,
      table.createdAt,
    ),
    index("audit_events_subject_idx").on(table.subjectType, table.subjectId),
    index("audit_events_resource_idx").on(table.resourceType, table.resourceId),
  ],
);

export const insertAuditEventSchema = createInsertSchema(auditEventsTable);

export type AuditEvent = typeof auditEventsTable.$inferSelect;
export type InsertAuditEvent = typeof auditEventsTable.$inferInsert;
