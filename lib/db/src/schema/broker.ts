import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { usersTable } from "./auth";
import {
  brokerProviderEnum,
  connectionStatusEnum,
  connectionTypeEnum,
  environmentModeEnum,
  marketDataProviderEnum,
} from "./enums";

export const brokerConnectionsTable = pgTable(
  "broker_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id").references(() => usersTable.id),
    name: text("name").notNull(),
    connectionType: connectionTypeEnum("connection_type").notNull(),
    brokerProvider: brokerProviderEnum("broker_provider"),
    marketDataProvider: marketDataProviderEnum("market_data_provider"),
    mode: environmentModeEnum("mode").notNull(),
    status: connectionStatusEnum("status").notNull().default("configured"),
    capabilities: text("capabilities").array().notNull().default([]),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("broker_connections_app_user_idx").on(table.appUserId),
    index("broker_connections_mode_idx").on(table.mode),
    unique("broker_connections_id_app_user_id_key").on(
      table.id,
      table.appUserId,
    ),
    unique("broker_connections_ibkr_identity_key").on(
      table.id,
      table.appUserId,
      table.brokerProvider,
      table.connectionType,
    ),
    uniqueIndex("broker_connections_unique_provider_mode_idx").on(
      table.connectionType,
      table.mode,
      table.name,
    ).where(sql`${table.appUserId} IS NULL`),
    uniqueIndex("broker_connections_user_provider_mode_idx")
      .on(table.appUserId, table.connectionType, table.mode, table.name)
      .where(sql`${table.appUserId} IS NOT NULL`),
  ],
);

export type IbkrGatewayHostStatus =
  | "active"
  | "draining"
  | "quarantined";

export type IbkrGatewayLifecycleState =
  | "requested"
  | "provisioning"
  | "login_required"
  | "verifying"
  | "authenticated"
  | "degraded"
  | "reauth_required"
  | "draining"
  | "released"
  | "quarantined";

export const ibkrGatewayHostsTable = pgTable(
  "ibkr_gateway_hosts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workloadIdentityDigest: varchar("workload_identity_digest", {
      length: 64,
    }).notNull(),
    controlOrigin: varchar("control_origin", { length: 2048 }).notNull(),
    imageDigest: varchar("image_digest", { length: 71 }).notNull(),
    runtimeSpecDigest: varchar("runtime_spec_digest", { length: 71 }).notNull(),
    runtimeAttestationDigest: varchar("runtime_attestation_digest", {
      length: 71,
    }).notNull(),
    failureDomain: varchar("failure_domain", { length: 128 }).notNull(),
    measuredSlotCapacity: integer("measured_slot_capacity").notNull(),
    admissionSlotCapacity: integer("admission_slot_capacity").notNull(),
    status: varchar("status", { length: 16 })
      .$type<IbkrGatewayHostStatus>()
      .notNull()
      .default("quarantined"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", {
      withTimezone: true,
    }).notNull(),
    heartbeatExpiresAt: timestamp("heartbeat_expires_at", {
      withTimezone: true,
    }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("ibkr_gateway_hosts_workload_identity_digest_key").on(
      table.workloadIdentityDigest,
    ),
    check(
      "ibkr_gateway_hosts_workload_identity_digest_chk",
      sql`${table.workloadIdentityDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ibkr_gateway_hosts_digest_chk",
      sql`${table.imageDigest} ~ '^sha256:[0-9a-f]{64}$'
        AND ${table.runtimeSpecDigest} ~ '^sha256:[0-9a-f]{64}$'
        AND ${table.runtimeAttestationDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "ibkr_gateway_hosts_capacity_chk",
      sql`${table.measuredSlotCapacity} BETWEEN 1 AND 20
        AND ${table.admissionSlotCapacity} BETWEEN 1 AND ${table.measuredSlotCapacity}`,
    ),
    check(
      "ibkr_gateway_hosts_status_chk",
      sql`${table.status} IN ('active', 'draining', 'quarantined')`,
    ),
    check(
      "ibkr_gateway_hosts_heartbeat_chk",
      sql`${table.heartbeatExpiresAt} > ${table.lastHeartbeatAt}`,
    ),
    check(
      "ibkr_gateway_hosts_control_origin_chk",
      sql`${table.controlOrigin} ~ '^https://[^/?#]+/?$' AND ${table.controlOrigin} !~ '@'`,
    ),
    index("ibkr_gateway_hosts_admission_idx").on(
      table.status,
      table.heartbeatExpiresAt,
    ),
  ],
);

export const ibkrGatewaySessionsTable = pgTable(
  "ibkr_gateway_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id").notNull(),
    brokerConnectionId: uuid("broker_connection_id").notNull(),
    brokerProvider: brokerProviderEnum("broker_provider")
      .notNull()
      .default("ibkr"),
    connectionType: connectionTypeEnum("connection_type")
      .notNull()
      .default("broker"),
    generation: integer("generation").notNull().default(0),
    lifecycleState: varchar("lifecycle_state", { length: 32 })
      .$type<IbkrGatewayLifecycleState>()
      .notNull()
      .default("requested"),
    hostId: uuid("host_id"),
    slotNumber: integer("slot_number"),
    leaseHolderId: uuid("lease_holder_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (table) => [
    unique("ibkr_gateway_sessions_id_owner_connection_key").on(
      table.id,
      table.appUserId,
      table.brokerConnectionId,
    ),
    unique("ibkr_gateway_sessions_broker_connection_id_key").on(
      table.brokerConnectionId,
    ),
    uniqueIndex("ibkr_gateway_sessions_host_slot_key")
      .on(table.hostId, table.slotNumber)
      .where(sql`${table.hostId} IS NOT NULL`),
    check(
      "ibkr_gateway_sessions_generation_nonnegative_chk",
      sql`${table.generation} >= 0`,
    ),
    check(
      "ibkr_gateway_sessions_ibkr_identity_chk",
      sql`${table.brokerProvider} = 'ibkr' AND ${table.connectionType} = 'broker'`,
    ),
    check(
      "ibkr_gateway_sessions_lifecycle_state_chk",
      sql`${table.lifecycleState} IN (
        'requested', 'provisioning', 'login_required', 'verifying',
        'authenticated', 'degraded', 'reauth_required', 'draining',
        'released', 'quarantined'
      )`,
    ),
    check(
      "ibkr_gateway_sessions_placement_lease_chk",
      sql`(${table.hostId} IS NULL
        AND ${table.slotNumber} IS NULL
        AND ${table.leaseHolderId} IS NULL
        AND ${table.leaseExpiresAt} IS NULL)
        OR (${table.hostId} IS NOT NULL
        AND ${table.slotNumber} IS NOT NULL
        AND ${table.leaseHolderId} IS NOT NULL
        AND ${table.leaseExpiresAt} IS NOT NULL)`,
    ),
    check(
      "ibkr_gateway_sessions_slot_number_chk",
      sql`${table.slotNumber} IS NULL OR ${table.slotNumber} BETWEEN 1 AND 20`,
    ),
    foreignKey({
      columns: [table.brokerConnectionId, table.appUserId],
      foreignColumns: [
        brokerConnectionsTable.id,
        brokerConnectionsTable.appUserId,
      ],
      name: "ibkr_gateway_sessions_connection_owner_fk",
    }),
    foreignKey({
      columns: [
        table.brokerConnectionId,
        table.appUserId,
        table.brokerProvider,
        table.connectionType,
      ],
      foreignColumns: [
        brokerConnectionsTable.id,
        brokerConnectionsTable.appUserId,
        brokerConnectionsTable.brokerProvider,
        brokerConnectionsTable.connectionType,
      ],
      name: "ibkr_gateway_sessions_connection_identity_fk",
    }),
    foreignKey({
      columns: [table.hostId],
      foreignColumns: [ibkrGatewayHostsTable.id],
      name: "ibkr_gateway_sessions_host_fk",
    }),
    index("ibkr_gateway_sessions_active_lease_idx").on(
      table.hostId,
      table.leaseExpiresAt,
    ),
  ],
);

export const brokerAccountsTable = pgTable(
  "broker_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id").references(() => usersTable.id),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => brokerConnectionsTable.id),
    providerAccountId: varchar("provider_account_id", { length: 128 }).notNull(),
    displayName: text("display_name").notNull(),
    mode: environmentModeEnum("mode").notNull(),
    accountStatus: varchar("account_status", { length: 32 }),
    accountType: varchar("account_type", { length: 32 }),
    includedInTrading: boolean("included_in_trading").notNull().default(true),
    baseCurrency: varchar("base_currency", { length: 16 }).notNull().default("USD"),
    capabilities: text("capabilities").array().notNull().default([]),
    executionBlockers: text("execution_blockers").array().notNull().default([]),
    isDefault: boolean("is_default").notNull().default(false),
    lastSyncedAt: text("last_synced_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("broker_accounts_provider_account_id_idx").on(
      table.providerAccountId,
    ).where(sql`${table.appUserId} IS NULL`),
    uniqueIndex("broker_accounts_user_provider_account_id_idx")
      .on(table.appUserId, table.providerAccountId)
      .where(sql`${table.appUserId} IS NOT NULL`),
    index("broker_accounts_app_user_idx").on(table.appUserId),
    index("broker_accounts_connection_idx").on(table.connectionId),
  ],
);

export const insertBrokerConnectionSchema = createInsertSchema(
  brokerConnectionsTable,
);
export const insertIbkrGatewayHostSchema = createInsertSchema(
  ibkrGatewayHostsTable,
);
export const insertIbkrGatewaySessionSchema = createInsertSchema(
  ibkrGatewaySessionsTable,
);
export const insertBrokerAccountSchema = createInsertSchema(brokerAccountsTable);

export type BrokerConnection = typeof brokerConnectionsTable.$inferSelect;
export type InsertBrokerConnection = typeof brokerConnectionsTable.$inferInsert;
export type IbkrGatewayHost = typeof ibkrGatewayHostsTable.$inferSelect;
export type InsertIbkrGatewayHost = typeof ibkrGatewayHostsTable.$inferInsert;
export type IbkrGatewaySession = typeof ibkrGatewaySessionsTable.$inferSelect;
export type InsertIbkrGatewaySession =
  typeof ibkrGatewaySessionsTable.$inferInsert;
export type BrokerAccount = typeof brokerAccountsTable.$inferSelect;
export type InsertBrokerAccount = typeof brokerAccountsTable.$inferInsert;
