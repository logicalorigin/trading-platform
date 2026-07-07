import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  date,
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
import { brokerAccountsTable } from "./broker";
import { timestamps } from "./common";
import { usersTable } from "./auth";

export const taxProfilesTable = pgTable(
  "tax_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    taxYear: integer("tax_year").notNull(),
    filingStatus: varchar("filing_status", { length: 32 })
      .notNull()
      .default("single"),
    estimateScope: varchar("estimate_scope", { length: 64 })
      .notNull()
      .default("connected_accounts_only"),
    federalEstimateMode: varchar("federal_estimate_mode", { length: 64 })
      .notNull()
      .default("safe_harbor_plus_visible_gains"),
    stateEstimateMode: varchar("state_estimate_mode", { length: 64 })
      .notNull()
      .default("all_states"),
    residentState: varchar("resident_state", { length: 2 }),
    marginalFederalRate: numeric("marginal_federal_rate", {
      precision: 8,
      scale: 6,
    }),
    marginalStateRate: numeric("marginal_state_rate", {
      precision: 8,
      scale: 6,
    }),
    priorYearFederalTax: numeric("prior_year_federal_tax", {
      precision: 20,
      scale: 6,
    }),
    priorYearStateTax: numeric("prior_year_state_tax", {
      precision: 20,
      scale: 6,
    }),
    annualizedIncomeEnabled: boolean("annualized_income_enabled")
      .notNull()
      .default(false),
    cpaOverrideAmount: numeric("cpa_override_amount", {
      precision: 20,
      scale: 6,
    }),
    reserveMode: varchar("reserve_mode", { length: 64 })
      .notNull()
      .default("virtual_plus_broker_beta"),
    reserveInstrumentAllowlist: text("reserve_instrument_allowlist")
      .array()
      .notNull()
      .default([]),
    brokerReserveBetaEnabled: boolean("broker_reserve_beta_enabled")
      .notNull()
      .default(false),
    notifications: jsonb("notifications")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tax_profiles_app_user_year_idx").on(
      table.appUserId,
      table.taxYear,
    ),
    index("tax_profiles_app_user_idx").on(table.appUserId),
  ],
);

export const taxProfileAccountsTable = pgTable(
  "tax_profile_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    taxProfileId: uuid("tax_profile_id")
      .notNull()
      .references(() => taxProfilesTable.id),
    brokerAccountId: uuid("broker_account_id").references(
      () => brokerAccountsTable.id,
    ),
    accountState: varchar("account_state", { length: 32 })
      .notNull()
      .default("connected_included"),
    included: boolean("included").notNull().default(true),
    coverageStatus: varchar("coverage_status", { length: 32 })
      .notNull()
      .default("connected"),
    label: text("label"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    index("tax_profile_accounts_app_user_idx").on(table.appUserId),
    index("tax_profile_accounts_profile_idx").on(table.taxProfileId),
    uniqueIndex("tax_profile_accounts_broker_account_idx").on(
      table.taxProfileId,
      table.brokerAccountId,
    ),
  ],
);

export const taxStateRuleSetsTable = pgTable(
  "tax_state_rule_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jurisdiction: varchar("jurisdiction", { length: 2 }).notNull(),
    taxYear: integer("tax_year").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("unavailable"),
    version: varchar("version", { length: 64 }),
    sourceUrl: text("source_url"),
    sourceName: text("source_name"),
    checksum: varchar("checksum", { length: 128 }),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    rawRules: jsonb("raw_rules").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tax_state_rule_sets_jurisdiction_year_idx").on(
      table.jurisdiction,
      table.taxYear,
    ),
    index("tax_state_rule_sets_status_idx").on(table.status),
  ],
);

export const taxEventsTable = pgTable(
  "tax_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    accountId: uuid("account_id").references(() => brokerAccountsTable.id),
    taxYear: integer("tax_year").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    symbol: varchar("symbol", { length: 64 }),
    assetClass: varchar("asset_class", { length: 32 }),
    side: varchar("side", { length: 16 }),
    quantity: numeric("quantity", { precision: 20, scale: 6 }),
    price: numeric("price", { precision: 20, scale: 6 }),
    amount: numeric("amount", { precision: 20, scale: 6 }),
    fees: numeric("fees", { precision: 20, scale: 6 }),
    currency: varchar("currency", { length: 16 }).notNull().default("USD"),
    optionIdentity: jsonb("option_identity").$type<Record<string, unknown> | null>(),
    sourceType: varchar("source_type", { length: 48 }).notNull(),
    sourceId: text("source_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    basisConfidence: varchar("basis_confidence", { length: 32 })
      .notNull()
      .default("unknown"),
    rawRef: jsonb("raw_ref").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    index("tax_events_user_year_idx").on(table.appUserId, table.taxYear),
    index("tax_events_account_occurred_idx").on(table.accountId, table.occurredAt),
    uniqueIndex("tax_events_idempotency_idx").on(table.idempotencyKey),
  ],
);

export const taxLotsTable = pgTable(
  "tax_lots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    accountId: uuid("account_id").references(() => brokerAccountsTable.id),
    openEventId: uuid("open_event_id").references(() => taxEventsTable.id),
    closeEventId: uuid("close_event_id").references(() => taxEventsTable.id),
    taxYear: integer("tax_year").notNull(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    assetClass: varchar("asset_class", { length: 32 }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    quantityOpened: numeric("quantity_opened", { precision: 20, scale: 6 }).notNull(),
    quantityRemaining: numeric("quantity_remaining", { precision: 20, scale: 6 }).notNull(),
    basisAmount: numeric("basis_amount", { precision: 20, scale: 6 }),
    proceedsAmount: numeric("proceeds_amount", { precision: 20, scale: 6 }),
    basisSource: varchar("basis_source", { length: 32 }).notNull().default("unknown"),
    basisConfidence: varchar("basis_confidence", { length: 32 })
      .notNull()
      .default("unknown"),
    status: varchar("status", { length: 32 }).notNull().default("open"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    index("tax_lots_user_year_idx").on(table.appUserId, table.taxYear),
    index("tax_lots_account_symbol_idx").on(table.accountId, table.symbol),
    index("tax_lots_status_idx").on(table.status),
  ],
);

export const taxReconciliationIssuesTable = pgTable(
  "tax_reconciliation_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    accountId: uuid("account_id").references(() => brokerAccountsTable.id),
    taxYear: integer("tax_year").notNull(),
    issueType: varchar("issue_type", { length: 64 }).notNull(),
    severity: varchar("severity", { length: 24 }).notNull().default("warning"),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    symbol: varchar("symbol", { length: 64 }),
    eventId: uuid("event_id").references(() => taxEventsTable.id),
    lotId: uuid("lot_id").references(() => taxLotsTable.id),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("tax_reconciliation_user_year_idx").on(table.appUserId, table.taxYear),
    index("tax_reconciliation_status_idx").on(table.status),
  ],
);

export const taxWashSaleMatchesTable = pgTable(
  "tax_wash_sale_matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    accountId: uuid("account_id").references(() => brokerAccountsTable.id),
    taxYear: integer("tax_year").notNull(),
    lossEventId: uuid("loss_event_id").references(() => taxEventsTable.id),
    replacementEventId: uuid("replacement_event_id").references(
      () => taxEventsTable.id,
    ),
    riskLevel: varchar("risk_level", { length: 24 }).notNull(),
    disallowedLossEstimate: numeric("disallowed_loss_estimate", {
      precision: 20,
      scale: 6,
    }),
    reasonCodes: text("reason_codes").array().notNull().default([]),
    rationale: text("rationale"),
    status: varchar("status", { length: 24 }).notNull().default("estimated"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    index("tax_wash_sale_user_year_idx").on(table.appUserId, table.taxYear),
    index("tax_wash_sale_account_idx").on(table.accountId),
  ],
);

export const taxPreflightChecksTable = pgTable(
  "tax_preflight_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    accountId: text("account_id").notNull(),
    preflightToken: varchar("preflight_token", { length: 128 }).notNull(),
    orderFingerprint: varchar("order_fingerprint", { length: 128 }).notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    washSaleRisk: varchar("wash_sale_risk", { length: 32 }).notNull(),
    selfTradeRisk: varchar("self_trade_risk", { length: 32 }).notNull(),
    reasons: text("reasons").array().notNull().default([]),
    warnings: text("warnings").array().notNull().default([]),
    requiredAcknowledgements: text("required_acknowledgements")
      .array()
      .notNull()
      .default([]),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    submittedOrderId: text("submitted_order_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tax_preflight_token_idx").on(table.preflightToken),
    index("tax_preflight_user_account_idx").on(table.appUserId, table.accountId),
    index("tax_preflight_fingerprint_idx").on(table.orderFingerprint),
    index("tax_preflight_expires_idx").on(table.expiresAt),
  ],
);

export const taxReserveBucketsTable = pgTable(
  "tax_reserve_buckets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    taxProfileId: uuid("tax_profile_id")
      .notNull()
      .references(() => taxProfilesTable.id),
    taxYear: integer("tax_year").notNull(),
    targetAmount: numeric("target_amount", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    reservedAmount: numeric("reserved_amount", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    currency: varchar("currency", { length: 16 }).notNull().default("USD"),
    mode: varchar("mode", { length: 64 }).notNull().default("virtual"),
    state: varchar("state", { length: 32 }).notNull().default("draft"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tax_reserve_bucket_user_year_idx").on(
      table.appUserId,
      table.taxYear,
    ),
    index("tax_reserve_bucket_profile_idx").on(table.taxProfileId),
  ],
);

export const taxReserveActionsTable = pgTable(
  "tax_reserve_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    bucketId: uuid("bucket_id")
      .notNull()
      .references(() => taxReserveBucketsTable.id),
    accountId: text("account_id"),
    actionType: varchar("action_type", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    instrumentSymbol: varchar("instrument_symbol", { length: 64 }),
    amount: numeric("amount", { precision: 20, scale: 6 }),
    quantity: numeric("quantity", { precision: 20, scale: 6 }),
    brokerOrderId: text("broker_order_id"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    capabilitySnapshot: jsonb("capability_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorMessage: text("error_message"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tax_reserve_action_idempotency_idx").on(
      table.appUserId,
      table.idempotencyKey,
    ),
    index("tax_reserve_actions_user_status_idx").on(
      table.appUserId,
      table.status,
    ),
    index("tax_reserve_actions_bucket_idx").on(table.bucketId),
  ],
);

export const taxAuditEventsTable = pgTable(
  "tax_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => usersTable.id),
    taxYear: integer("tax_year"),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    severity: varchar("severity", { length: 24 }).notNull().default("info"),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("tax_audit_events_user_year_idx").on(table.appUserId, table.taxYear),
    index("tax_audit_events_occurred_idx").on(table.occurredAt),
  ],
);

export const insertTaxProfileSchema = createInsertSchema(taxProfilesTable);
export const insertTaxProfileAccountSchema = createInsertSchema(
  taxProfileAccountsTable,
);
export const insertTaxStateRuleSetSchema = createInsertSchema(
  taxStateRuleSetsTable,
);

export type TaxProfile = typeof taxProfilesTable.$inferSelect;
export type InsertTaxProfile = typeof taxProfilesTable.$inferInsert;
