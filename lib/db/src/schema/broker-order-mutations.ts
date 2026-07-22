import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { usersTable } from "./auth";
import { brokerAccountsTable } from "./broker";
import { timestamps } from "./common";
import { brokerProviderEnum } from "./enums";

export type BrokerOrderMutationOperation = "submit" | "replace" | "cancel";
export type BrokerOrderMutationStatus =
  | "inflight"
  | "succeeded"
  | "rejected"
  | "reconciliation_required";

export const brokerOrderMutationsTable = pgTable(
  "broker_order_mutations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => brokerAccountsTable.id),
    provider: brokerProviderEnum("provider").notNull(),
    operation: varchar("operation", { length: 16 })
      .$type<BrokerOrderMutationOperation>()
      .notNull(),
    status: varchar("status", { length: 32 })
      .$type<BrokerOrderMutationStatus>()
      .notNull()
      .default("inflight"),
    brokerOrderId: varchar("broker_order_id", { length: 128 }),
    reason: varchar("reason", { length: 128 }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      "broker_order_mutations_operation_chk",
      sql`${table.operation} IN ('submit', 'replace', 'cancel')`,
    ),
    check(
      "broker_order_mutations_status_chk",
      sql`${table.status} IN (
        'inflight', 'succeeded', 'rejected', 'reconciliation_required'
      )`,
    ),
    check(
      "broker_order_mutations_resolution_chk",
      sql`(${table.status} IN ('inflight', 'reconciliation_required')
          AND ${table.resolvedAt} IS NULL)
        OR (${table.status} IN ('succeeded', 'rejected')
          AND ${table.resolvedAt} IS NOT NULL)`,
    ),
    check(
      "broker_order_mutations_metadata_chk",
      sql`jsonb_typeof(${table.metadata}) = 'object'
        AND octet_length(${table.metadata}::text) <= 8192`,
    ),
    index("broker_order_mutations_account_status_idx").on(
      table.appUserId,
      table.accountId,
      table.provider,
      table.status,
    ),
    index("broker_order_mutations_broker_order_idx").on(
      table.provider,
      table.brokerOrderId,
    ),
    uniqueIndex("broker_order_mutations_unresolved_account_idx")
      .on(table.appUserId, table.accountId, table.provider)
      .where(
        sql`${table.status} IN ('inflight', 'reconciliation_required')`,
      ),
  ],
);

export type BrokerOrderMutation =
  typeof brokerOrderMutationsTable.$inferSelect;
