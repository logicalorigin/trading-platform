import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  brokerAccountsTable,
  brokerOrdersTable,
  instrumentsTable,
  orderRequestsTable,
  shadowAccountsTable,
  shadowFillsTable,
  shadowOrdersTable,
  taxAuditEventsTable,
  taxPreflightChecksTable,
  taxProfileAccountsTable,
  taxProfilesTable,
  taxReconciliationIssuesTable,
  taxReserveActionsTable,
  taxReserveBucketsTable,
  taxStateRuleSetsTable,
  taxLotsTable,
  taxWashSaleMatchesTable,
} from "@workspace/db/schema";
import { requireCurrentAppUserId } from "./app-user-context";
import {
  buildStateRuleStatus,
  evaluateTaxOrderPreflight,
  fingerprintTaxOrder,
  normalizeTaxProfileConfig,
  type TaxOrderLike,
  type TaxProfileConfig,
  type TaxStateRuleSetRow,
} from "./tax-planning-model";
import { HttpError } from "../lib/errors";

const TAX_PREFLIGHT_TTL_MS = 2 * 60 * 1000;
const LEGACY_SHADOW_ACCOUNT_ID = "shadow";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

type TaxProfileRow = typeof taxProfilesTable.$inferSelect;
type TaxProfileAccountRow = typeof taxProfileAccountsTable.$inferSelect;
type ShadowTaxFillRow = Awaited<ReturnType<typeof loadShadowTaxFills>>["fills"][number];
type TaxAccountScope =
  | { accountId: "all"; accountScope: "connected_accounts" }
  | { accountId: "shadow"; accountScope: "shadow_simulation" }
  | {
      accountId: string;
      accountScope: "single_connected_account";
      providerAccountId: string | null;
    }
  | {
      accountId: string;
      accountScope: "provider_account";
      providerAccountId: string;
    };

const nowTaxYear = (): number => new Date().getFullYear();

const numberOrNull = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const moneyString = (value: number | null): string | null =>
  value == null ? null : value.toFixed(6);

const readJsonRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const taxYearWindow = (taxYear: number): { start: Date; end: Date } => ({
  start: new Date(Date.UTC(taxYear, 0, 1)),
  end: new Date(Date.UTC(taxYear + 1, 0, 1)),
});

const addDays = (value: Date, days: number): Date =>
  new Date(value.getTime() + days * 24 * 60 * 60 * 1000);

const profileRowToConfig = (row: TaxProfileRow): TaxProfileConfig =>
  normalizeTaxProfileConfig({
    taxYear: row.taxYear,
    filingStatus: row.filingStatus,
    estimateScope: row.estimateScope,
    federalEstimateMode: row.federalEstimateMode,
    stateEstimateMode: row.stateEstimateMode,
    residentState: row.residentState,
    marginalFederalRate: numberOrNull(row.marginalFederalRate),
    marginalStateRate: numberOrNull(row.marginalStateRate),
    priorYearFederalTax: numberOrNull(row.priorYearFederalTax),
    priorYearStateTax: numberOrNull(row.priorYearStateTax),
    annualizedIncomeEnabled: row.annualizedIncomeEnabled,
    cpaOverrideAmount: numberOrNull(row.cpaOverrideAmount),
    reserveMode: row.reserveMode,
    reserveInstrumentAllowlist: row.reserveInstrumentAllowlist,
    brokerReserveBetaEnabled: row.brokerReserveBetaEnabled,
  });

const profileResponse = (row: TaxProfileRow, accounts: TaxProfileAccountRow[]) => {
  const profile = profileRowToConfig(row);
  return {
    profileKey: "default",
    version: 1,
    source: "database",
    updatedAt: row.updatedAt.toISOString(),
    profile,
    accounts: accounts.map((account) => ({
      id: account.id,
      brokerAccountId: account.brokerAccountId,
      accountState: account.accountState,
      included: account.included,
      coverageStatus: account.coverageStatus,
      label: account.label,
      metadata: account.metadata,
      updatedAt: account.updatedAt.toISOString(),
    })),
  };
};

async function getOrCreateTaxProfileForUser(
  appUserId: string,
  taxYear = nowTaxYear(),
): Promise<TaxProfileRow> {
  const [created] = await db
    .insert(taxProfilesTable)
    .values({
      appUserId,
      taxYear,
      filingStatus: "single",
      estimateScope: "connected_accounts_only",
      federalEstimateMode: "safe_harbor_plus_visible_gains",
      stateEstimateMode: "all_states",
      reserveMode: "virtual_plus_broker_beta",
    })
    .onConflictDoNothing({
      target: [taxProfilesTable.appUserId, taxProfilesTable.taxYear],
    })
    .returning();
  if (created) return created;

  const existing = await db
    .select()
    .from(taxProfilesTable)
    .where(
      and(
        eq(taxProfilesTable.appUserId, appUserId),
        eq(taxProfilesTable.taxYear, taxYear),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];
  throw new HttpError(500, "Tax profile could not be initialized.", {
    code: "tax_profile_init_failed",
  });
}

async function resolveTaxAccountScope(
  appUserId: string,
  accountId: string,
  options: {
    allowAll?: boolean;
    allowShadow?: boolean;
    allowProviderAccountId?: boolean;
  } = {},
): Promise<TaxAccountScope> {
  if (accountId === "all" && options.allowAll !== false) {
    return { accountId: "all", accountScope: "connected_accounts" };
  }
  if (accountId === "shadow" && options.allowShadow !== false) {
    return { accountId: "shadow", accountScope: "shadow_simulation" };
  }
  const trimmedAccountId = String(accountId || "").trim();
  const byLocalId = UUID_PATTERN.test(trimmedAccountId);
  const byProviderAccountId = PROVIDER_ACCOUNT_ID_PATTERN.test(trimmedAccountId);
  if (!byLocalId && !byProviderAccountId) {
    throw new HttpError(404, "Tax account was not found.", {
      code: "tax_account_not_found",
    });
  }
  const rows = await db
    .select({
      id: brokerAccountsTable.id,
      providerAccountId: brokerAccountsTable.providerAccountId,
    })
    .from(brokerAccountsTable)
    .where(
      and(
        byLocalId
          ? eq(brokerAccountsTable.id, trimmedAccountId)
          : eq(brokerAccountsTable.providerAccountId, trimmedAccountId),
        eq(brokerAccountsTable.appUserId, appUserId),
        eq(brokerAccountsTable.mode, "live"),
      ),
    )
    .limit(1);
  if (rows[0]) {
    return {
      accountId: rows[0].id,
      accountScope: "single_connected_account",
      providerAccountId: rows[0].providerAccountId,
    };
  }
  if (
    !byLocalId &&
    byProviderAccountId &&
    options.allowProviderAccountId !== false
  ) {
    return {
      accountId: trimmedAccountId,
      accountScope: "provider_account",
      providerAccountId: trimmedAccountId,
    };
  }
  throw new HttpError(404, "Tax account was not found.", {
    code: "tax_account_not_found",
  });
}

async function resolveShadowTaxAccountId(appUserId: string): Promise<string | null> {
  const [userAccount] = await db
    .select({ id: shadowAccountsTable.id })
    .from(shadowAccountsTable)
    .where(
      and(
        eq(shadowAccountsTable.appUserId, appUserId),
        isNull(shadowAccountsTable.sourceBrokerAccountId),
        eq(shadowAccountsTable.status, "active"),
      ),
    )
    .limit(1);
  if (userAccount) return userAccount.id;

  const [legacyAccount] = await db
    .select({ id: shadowAccountsTable.id })
    .from(shadowAccountsTable)
    .where(
      and(
        eq(shadowAccountsTable.id, LEGACY_SHADOW_ACCOUNT_ID),
        isNull(shadowAccountsTable.appUserId),
        isNull(shadowAccountsTable.sourceBrokerAccountId),
        eq(shadowAccountsTable.status, "active"),
      ),
    )
    .limit(1);
  return legacyAccount?.id ?? null;
}

async function loadShadowTaxFills(appUserId: string, taxYear: number) {
  const accountId = await resolveShadowTaxAccountId(appUserId);
  if (!accountId) {
    return { shadowAccountId: null, fills: [] };
  }
  const { start, end } = taxYearWindow(taxYear);
  const fills = await db
    .select({
      fillId: shadowFillsTable.id,
      orderId: shadowFillsTable.orderId,
      source: shadowOrdersTable.source,
      symbol: shadowFillsTable.symbol,
      assetClass: shadowFillsTable.assetClass,
      side: shadowFillsTable.side,
      quantity: shadowFillsTable.quantity,
      price: shadowFillsTable.price,
      grossAmount: shadowFillsTable.grossAmount,
      fees: shadowFillsTable.fees,
      realizedPnl: shadowFillsTable.realizedPnl,
      cashDelta: shadowFillsTable.cashDelta,
      optionContract: shadowFillsTable.optionContract,
      occurredAt: shadowFillsTable.occurredAt,
    })
    .from(shadowFillsTable)
    .innerJoin(
      shadowOrdersTable,
      eq(shadowOrdersTable.id, shadowFillsTable.orderId),
    )
    .where(
      and(
        eq(shadowFillsTable.accountId, accountId),
        gte(shadowFillsTable.occurredAt, start),
        lt(shadowFillsTable.occurredAt, end),
      ),
    )
    .orderBy(asc(shadowFillsTable.occurredAt));
  return { shadowAccountId: accountId, fills };
}

function summarizeShadowTaxFills(fills: ShadowTaxFillRow[]) {
  const realizedPnl = fills.reduce(
    (sum, fill) => sum + (numberOrNull(fill.realizedPnl) ?? 0),
    0,
  );
  const fees = fills.reduce(
    (sum, fill) => sum + (numberOrNull(fill.fees) ?? 0),
    0,
  );
  const lossEventCount = fills.filter(
    (fill) => (numberOrNull(fill.realizedPnl) ?? 0) < 0,
  ).length;
  return {
    eventCount: fills.length,
    realizedPnl,
    fees,
    taxableGainEstimate: Math.max(realizedPnl, 0),
    buyFillCount: fills.filter((fill) => fill.side === "buy").length,
    sellFillCount: fills.filter((fill) => fill.side === "sell").length,
    lossEventCount,
  };
}

function shadowTaxEvent(fill: ShadowTaxFillRow) {
  return {
    id: `shadow_fill_${fill.fillId}`,
    occurredAt: fill.occurredAt.toISOString(),
    eventType: "shadow_fill",
    symbol: fill.symbol,
    assetClass: fill.assetClass,
    side: fill.side,
    quantity: numberOrNull(fill.quantity) ?? 0,
    price: numberOrNull(fill.price) ?? 0,
    grossAmount: numberOrNull(fill.grossAmount) ?? 0,
    amount: numberOrNull(fill.realizedPnl) ?? 0,
    fees: numberOrNull(fill.fees) ?? 0,
    currency: "USD",
    optionIdentity: fill.optionContract ?? null,
    sourceType: "shadow_ledger",
    sourceId: fill.fillId,
    basisConfidence: "shadow_simulation",
    metadata: {
      orderId: fill.orderId,
      source: fill.source,
      cashDelta: numberOrNull(fill.cashDelta) ?? 0,
    },
  };
}

function shadowTaxLot(fill: ShadowTaxFillRow) {
  const side = String(fill.side || "").toLowerCase();
  const realizedPnl = numberOrNull(fill.realizedPnl) ?? 0;
  const grossAmount = numberOrNull(fill.grossAmount) ?? 0;
  const fees = numberOrNull(fill.fees) ?? 0;
  const quantity = numberOrNull(fill.quantity) ?? 0;
  return {
    id: `shadow_lot_${fill.fillId}`,
    symbol: fill.symbol,
    assetClass: fill.assetClass,
    openedAt: fill.occurredAt.toISOString(),
    closedAt: side === "sell" ? fill.occurredAt.toISOString() : null,
    quantityOpened: quantity,
    quantityRemaining: side === "buy" ? quantity : 0,
    basisAmount: side === "buy" ? grossAmount + fees : null,
    proceedsAmount: side === "sell" ? grossAmount - fees : null,
    realizedPnl,
    status: side === "buy" ? "open_candidate" : "closed",
    basisSource: "shadow_fill_history",
    basisConfidence: "shadow_simulation",
    metadata: {
      sourceType: "shadow_ledger",
      sourceId: fill.fillId,
      orderId: fill.orderId,
    },
  };
}

function shadowWashWindow(fill: ShadowTaxFillRow) {
  const lossAmount = Math.abs(numberOrNull(fill.realizedPnl) ?? 0);
  return {
    id: `shadow_wash_${fill.fillId}`,
    symbol: fill.symbol,
    assetClass: fill.assetClass,
    riskLevel: "unknown",
    lossAmount,
    windowStart: addDays(fill.occurredAt, -30).toISOString(),
    windowEnd: addDays(fill.occurredAt, 30).toISOString(),
    reasonCodes: ["shadow_loss_without_cross_account_lot_matching"],
    rationale:
      "Shadow ledger recorded a simulated loss; replacement purchases across live and external accounts are not computed yet.",
    sourceType: "shadow_ledger",
    sourceId: fill.fillId,
  };
}

async function syncConnectedAccounts(
  appUserId: string,
  taxProfileId: string,
): Promise<void> {
  const accounts = await db
    .select()
    .from(brokerAccountsTable)
    .where(
      and(
        eq(brokerAccountsTable.appUserId, appUserId),
        eq(brokerAccountsTable.mode, "live"),
      ),
    );
  for (const account of accounts) {
    await db
      .insert(taxProfileAccountsTable)
      .values({
        appUserId,
        taxProfileId,
        brokerAccountId: account.id,
        accountState: "connected_included",
        included: true,
        coverageStatus: "connected",
        label: account.displayName,
      })
      .onConflictDoNothing({
        target: [
          taxProfileAccountsTable.taxProfileId,
          taxProfileAccountsTable.brokerAccountId,
        ],
      });
  }
}

async function listTaxProfileAccounts(
  appUserId: string,
  taxProfileId: string,
): Promise<TaxProfileAccountRow[]> {
  await syncConnectedAccounts(appUserId, taxProfileId);
  return db
    .select()
    .from(taxProfileAccountsTable)
    .where(
      and(
        eq(taxProfileAccountsTable.appUserId, appUserId),
        eq(taxProfileAccountsTable.taxProfileId, taxProfileId),
      ),
    );
}

export async function getTaxProfileSnapshot() {
  const appUserId = requireCurrentAppUserId();
  const profile = await getOrCreateTaxProfileForUser(appUserId);
  const accounts = await listTaxProfileAccounts(appUserId, profile.id);
  return profileResponse(profile, accounts);
}

export async function updateTaxProfileSnapshot(input: unknown) {
  const appUserId = requireCurrentAppUserId();
  const config = normalizeTaxProfileConfig(input);
  const [profile] = await db
    .insert(taxProfilesTable)
    .values({
      appUserId,
      taxYear: config.taxYear,
      filingStatus: config.filingStatus,
      estimateScope: config.estimateScope,
      federalEstimateMode: config.federalEstimateMode,
      stateEstimateMode: config.stateEstimateMode,
      residentState: config.residentState,
      marginalFederalRate: moneyString(config.marginalFederalRate),
      marginalStateRate: moneyString(config.marginalStateRate),
      priorYearFederalTax: moneyString(config.priorYearFederalTax),
      priorYearStateTax: moneyString(config.priorYearStateTax),
      annualizedIncomeEnabled: config.annualizedIncomeEnabled,
      cpaOverrideAmount: moneyString(config.cpaOverrideAmount),
      reserveMode: config.reserveMode,
      reserveInstrumentAllowlist: config.reserveInstrumentAllowlist,
      brokerReserveBetaEnabled: config.brokerReserveBetaEnabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [taxProfilesTable.appUserId, taxProfilesTable.taxYear],
      set: {
        filingStatus: config.filingStatus,
        estimateScope: config.estimateScope,
        federalEstimateMode: config.federalEstimateMode,
        stateEstimateMode: config.stateEstimateMode,
        residentState: config.residentState,
        marginalFederalRate: moneyString(config.marginalFederalRate),
        marginalStateRate: moneyString(config.marginalStateRate),
        priorYearFederalTax: moneyString(config.priorYearFederalTax),
        priorYearStateTax: moneyString(config.priorYearStateTax),
        annualizedIncomeEnabled: config.annualizedIncomeEnabled,
        cpaOverrideAmount: moneyString(config.cpaOverrideAmount),
        reserveMode: config.reserveMode,
        reserveInstrumentAllowlist: config.reserveInstrumentAllowlist,
        brokerReserveBetaEnabled: config.brokerReserveBetaEnabled,
        updatedAt: new Date(),
      },
    })
    .returning();

  await db.insert(taxAuditEventsTable).values({
    appUserId,
    taxYear: profile.taxYear,
    eventType: "tax_profile_updated",
    severity: "info",
    message: "Tax profile settings were updated.",
    metadata: { profile: profileRowToConfig(profile) },
  });

  const accounts = await listTaxProfileAccounts(appUserId, profile.id);
  return profileResponse(profile, accounts);
}

export async function getTaxStateRulesStatus(taxYear = nowTaxYear()) {
  const rows = await db
    .select()
    .from(taxStateRuleSetsTable)
    .where(eq(taxStateRuleSetsTable.taxYear, taxYear));
  return buildStateRuleStatus({
    taxYear,
    rows: rows.map(
      (row): TaxStateRuleSetRow => ({
        jurisdiction: row.jurisdiction,
        taxYear: row.taxYear,
        status: row.status as TaxStateRuleSetRow["status"],
        version: row.version,
        sourceUrl: row.sourceUrl,
        sourceName: row.sourceName,
        checksum: row.checksum,
        verifiedAt: row.verifiedAt,
      }),
    ),
  });
}

async function getOverviewContext() {
  const appUserId = requireCurrentAppUserId();
  const profile = await getOrCreateTaxProfileForUser(appUserId);
  const accounts = await listTaxProfileAccounts(appUserId, profile.id);
  const stateRules = await getTaxStateRulesStatus(profile.taxYear);
  return { appUserId, profile, accounts, stateRules };
}

export async function getTaxOverview() {
  const { profile, accounts, stateRules } = await getOverviewContext();
  const config = profileRowToConfig(profile);
  const includedAccounts = accounts.filter((account) => account.included);
  return {
    generatedAt: new Date().toISOString(),
    profile: config,
    scope: {
      estimateScope: config.estimateScope,
      externalAccounts: "not_modeled",
      shadowIncluded: false,
      connectedAccounts: accounts.length,
      includedAccounts: includedAccounts.length,
    },
    estimates: {
      federal: {
        status: "unavailable",
        reason: "tax_event_engine_not_yet_computed",
        estimatedLiability: config.cpaOverrideAmount ?? 0,
      },
      state: {
        status: stateRules.ready ? "available" : "unavailable",
        reason: stateRules.ready
          ? null
          : "state_rule_pack_unavailable_or_unverified",
        estimatedLiability: 0,
        ruleStatus: stateRules.summary,
      },
      totalReserveTarget: config.cpaOverrideAmount ?? 0,
      currency: "USD",
    },
    washSales: {
      status: "not_computed",
      exactCount: null,
      highRiskCount: null,
      ambiguousCount: null,
      unknownCount: null,
    },
    lots: {
      openCount: 0,
      closedCount: 0,
      basisConfidence: "unknown",
    },
    sourceFreshness: {
      brokerActivity: "not_ingested",
      lots: "not_computed",
      stateRules: stateRules.ready ? "verified" : "unavailable",
    },
    unknowns: [
      "Tax events and lots have not been computed yet.",
      "External accounts are outside v1 scope.",
      ...(stateRules.ready ? [] : ["State rule packs are not source-verified yet."]),
    ],
    requiredAcknowledgements: [],
  };
}

export async function getAccountTaxOverview(accountId: string) {
  const appUserId = requireCurrentAppUserId();
  const scope = await resolveTaxAccountScope(appUserId, accountId);
  const overview = await getTaxOverview();
  const shadow = scope.accountScope === "shadow_simulation";
  if (shadow) {
    const profile = await getOrCreateTaxProfileForUser(appUserId);
    const config = profileRowToConfig(profile);
    const { fills } = await loadShadowTaxFills(appUserId, profile.taxYear);
    const summary = summarizeShadowTaxFills(fills);
    const federalRate = config.marginalFederalRate ?? 0;
    const stateRate = config.marginalStateRate ?? 0;
    const federalEstimate = summary.taxableGainEstimate * federalRate;
    const stateEstimate = summary.taxableGainEstimate * stateRate;
    return {
      ...overview,
      accountId: scope.accountId,
      accountScope: scope.accountScope,
      shadowExcluded: false,
      scope: {
        ...overview.scope,
        shadowIncluded: true,
        shadowEventCount: summary.eventCount,
      },
      estimates: {
        ...overview.estimates,
        federal: {
          ...overview.estimates.federal,
          status: "available",
          reason: summary.eventCount
            ? "shadow_simulation_realized_pnl"
            : "shadow_simulation_no_trading_history",
          estimatedLiability: federalEstimate,
          taxableIncomeEstimate: summary.taxableGainEstimate,
          realizedPnl: summary.realizedPnl,
          fees: summary.fees,
        },
        state: {
          ...overview.estimates.state,
          estimatedLiability: stateEstimate,
          taxableIncomeEstimate: summary.taxableGainEstimate,
          realizedPnl: summary.realizedPnl,
          fees: summary.fees,
        },
        totalReserveTarget: federalEstimate + stateEstimate,
        shadow: {
          status: "available",
          taxYear: profile.taxYear,
          eventCount: summary.eventCount,
          realizedPnl: summary.realizedPnl,
          fees: summary.fees,
          taxableGainEstimate: summary.taxableGainEstimate,
          federalEstimate,
          stateEstimate,
          currency: "USD",
          basisConfidence: "shadow_simulation",
        },
      },
      washSales: {
        status: summary.lossEventCount > 0 ? "unknown" : "none",
        exactCount: 0,
        highRiskCount: 0,
        ambiguousCount: 0,
        unknownCount: summary.lossEventCount,
      },
      lots: {
        openCount: summary.buyFillCount,
        closedCount: summary.sellFillCount,
        basisConfidence: "shadow_simulation",
      },
      sourceFreshness: {
        brokerActivity: "shadow_ledger_current",
        lots: "shadow_fills_current",
        stateRules: overview.sourceFreshness.stateRules,
      },
      unknowns: [
        "Shadow tax view is simulation-only; it is not broker tax reporting.",
        "Wash-sale adjustments against live and external accounts are not computed yet.",
        ...(overview.sourceFreshness.stateRules === "verified"
          ? []
          : ["State rule packs are not source-verified yet."]),
      ],
    };
  }
  return {
    ...overview,
    accountId: scope.accountId,
    accountScope: scope.accountScope,
    shadowExcluded: shadow,
    unknowns: shadow
      ? ["Shadow account activity is simulation-only and excluded from tax estimates."]
      : overview.unknowns,
  };
}

export async function listAccountTaxEvents(accountId: string) {
  const appUserId = requireCurrentAppUserId();
  const scope = await resolveTaxAccountScope(appUserId, accountId);
  if (scope.accountScope === "shadow_simulation") {
    const profile = await getOrCreateTaxProfileForUser(appUserId);
    const { fills } = await loadShadowTaxFills(appUserId, profile.taxYear);
    return {
      events: fills.map(shadowTaxEvent),
      sourceFreshness: "shadow_ledger_current",
      basisConfidence: "shadow_simulation",
    };
  }
  return {
    events: [],
    sourceFreshness: "not_ingested",
    basisConfidence: "unknown",
  };
}

export async function listAccountTaxLots(accountId: string) {
  const appUserId = requireCurrentAppUserId();
  const scope = await resolveTaxAccountScope(appUserId, accountId);
  if (scope.accountScope === "shadow_simulation") {
    const profile = await getOrCreateTaxProfileForUser(appUserId);
    const { fills } = await loadShadowTaxFills(appUserId, profile.taxYear);
    return {
      lots: fills.map(shadowTaxLot),
      basisConfidence: "shadow_simulation",
      reconciliationRequired: false,
    };
  }
  return {
    lots: [],
    basisConfidence: "unknown",
    reconciliationRequired: true,
  };
}

export async function listAccountWashWindows(accountId: string) {
  const appUserId = requireCurrentAppUserId();
  const scope = await resolveTaxAccountScope(appUserId, accountId);
  if (scope.accountScope === "shadow_simulation") {
    const profile = await getOrCreateTaxProfileForUser(appUserId);
    const { fills } = await loadShadowTaxFills(appUserId, profile.taxYear);
    const lossFills = fills.filter(
      (fill) => (numberOrNull(fill.realizedPnl) ?? 0) < 0,
    );
    return {
      washWindows: lossFills.map(shadowWashWindow),
      riskSummary: {
        status: lossFills.length > 0 ? "unknown" : "none",
        exact: 0,
        high: 0,
        ambiguous: 0,
        unknown: lossFills.length,
      },
    };
  }
  return {
    washWindows: [],
    riskSummary: {
      status: "not_computed",
      exact: null,
      high: null,
      ambiguous: null,
      unknown: null,
    },
  };
}

export async function listAccountReconciliationIssues(accountId: string) {
  const appUserId = requireCurrentAppUserId();
  const profile = await getOrCreateTaxProfileForUser(appUserId);
  const scope = await resolveTaxAccountScope(appUserId, accountId);
  if (scope.accountScope !== "single_connected_account") {
    return { issues: [], status: "not_applicable" };
  }
  const issues = await db
    .select()
    .from(taxReconciliationIssuesTable)
    .where(
      and(
        eq(taxReconciliationIssuesTable.appUserId, appUserId),
        eq(taxReconciliationIssuesTable.taxYear, profile.taxYear),
        eq(taxReconciliationIssuesTable.accountId, scope.accountId),
      ),
    );
  return {
    issues: issues.map((issue) => ({
      id: issue.id,
      issueType: issue.issueType,
      severity: issue.severity,
      status: issue.status,
      symbol: issue.symbol,
      message: issue.message,
      metadata: issue.metadata,
      updatedAt: issue.updatedAt.toISOString(),
    })),
    status: issues.length ? "needs_attention" : "clear",
  };
}

async function loadOpenOrdersForPreflight(
  appUserId: string,
  accountId: string,
  comparisonAccountId = accountId,
): Promise<TaxOrderLike[]> {
  if (!UUID_PATTERN.test(accountId)) return [];
  const rows = await db
    .select({
      accountId: orderRequestsTable.accountId,
      mode: orderRequestsTable.mode,
      symbol: instrumentsTable.symbol,
      assetClass: instrumentsTable.assetClass,
      side: orderRequestsTable.side,
      type: orderRequestsTable.type,
      quantity: orderRequestsTable.quantity,
      limitPrice: orderRequestsTable.limitPrice,
      stopPrice: orderRequestsTable.stopPrice,
      timeInForce: orderRequestsTable.timeInForce,
      status: brokerOrdersTable.status,
    })
    .from(orderRequestsTable)
    .innerJoin(
      brokerOrdersTable,
      eq(brokerOrdersTable.orderRequestId, orderRequestsTable.id),
    )
    .innerJoin(
      brokerAccountsTable,
      eq(brokerAccountsTable.id, orderRequestsTable.accountId),
    )
    .innerJoin(
      instrumentsTable,
      eq(instrumentsTable.id, orderRequestsTable.instrumentId),
    )
    .where(
      and(
        eq(brokerAccountsTable.appUserId, appUserId),
        eq(orderRequestsTable.accountId, accountId),
        inArray(brokerOrdersTable.status, [
          "pending_submit",
          "submitted",
          "accepted",
          "partially_filled",
        ]),
      ),
    );
  return rows.map((row) => ({
    accountId: comparisonAccountId,
    mode: row.mode,
    symbol: row.symbol || "",
    assetClass: row.assetClass,
    side: row.side,
    type: row.type,
    quantity: Number(row.quantity) || 0,
    limitPrice: numberOrNull(row.limitPrice),
    stopPrice: numberOrNull(row.stopPrice),
    timeInForce: row.timeInForce,
  }));
}

export async function createTaxOrderPreflight(input: unknown) {
  const appUserId = requireCurrentAppUserId();
  const body = readJsonRecord(input);
  const order = readJsonRecord(body.order) as unknown as TaxOrderLike;
  const scope = await resolveTaxAccountScope(appUserId, String(order.accountId || ""), {
    allowAll: false,
    allowShadow: false,
  });
  const profile = await getOrCreateTaxProfileForUser(appUserId);
  const openOrders = await loadOpenOrdersForPreflight(
    appUserId,
    scope.accountScope === "single_connected_account"
      ? scope.accountId
      : order.accountId,
    order.accountId,
  );
  const evaluation = evaluateTaxOrderPreflight({
    profile: profileRowToConfig(profile),
    order,
    openOrders,
  });
  const preflightToken = `tax_pf_${randomUUID()}`;
  const expiresAt = new Date(Date.now() + TAX_PREFLIGHT_TTL_MS);
  await db.insert(taxPreflightChecksTable).values({
    appUserId,
    accountId: String(order.accountId || ""),
    preflightToken,
    orderFingerprint: evaluation.orderFingerprint,
    action: evaluation.action,
    washSaleRisk: evaluation.washSaleRisk,
    selfTradeRisk: evaluation.selfTradeRisk,
    reasons: evaluation.reasons,
    warnings: evaluation.warnings,
    requiredAcknowledgements: evaluation.requiredAcknowledgements,
    expiresAt,
    metadata: {
      order,
      rolloutMode: "compute_only",
    },
  });
  await db.insert(taxAuditEventsTable).values({
    appUserId,
    taxYear: profile.taxYear,
    eventType:
      evaluation.action === "block"
        ? "tax_preflight_blocked"
        : "tax_preflight_created",
    severity: evaluation.action === "block" ? "warning" : "info",
    message:
      evaluation.action === "block"
        ? "Tax/compliance preflight blocked an order."
        : "Tax/compliance preflight was created.",
    metadata: { ...evaluation, accountId: order.accountId },
  });
  return {
    ...evaluation,
    preflightToken,
    expiresAt: expiresAt.toISOString(),
    sourceFreshness: {
      brokerActivity: "not_ingested",
      openOrders: "database_current",
      lots: "not_computed",
    },
    rolloutMode: "compute_only",
  };
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
        .slice(0, 32)
    : [];

const readRequiredPreflightToken = (value: unknown): string => {
  const token = String(value || "").trim();
  if (token) return token;
  throw new HttpError(
    409,
    "Tax/compliance preflight is required before live order submission.",
    {
      code: "tax_preflight_required",
      expose: true,
    },
  );
};

export type TaxPreflightSubmissionRecord = {
  preflightToken: string;
  orderFingerprint: string;
  action: string;
};

export async function assertTaxPreflightForOrderSubmission(input: {
  appUserId?: string;
  order: TaxOrderLike;
  taxPreflightToken?: string | null;
  taxAcknowledgements?: unknown;
  now?: Date;
}): Promise<TaxPreflightSubmissionRecord | null> {
  if (input.order.mode !== "live") {
    return null;
  }
  const appUserId = input.appUserId ?? requireCurrentAppUserId();
  const token = readRequiredPreflightToken(input.taxPreflightToken);
  const [preflight] = await db
    .select()
    .from(taxPreflightChecksTable)
    .where(
      and(
        eq(taxPreflightChecksTable.appUserId, appUserId),
        eq(taxPreflightChecksTable.preflightToken, token),
      ),
    )
    .limit(1);
  if (!preflight) {
    throw new HttpError(409, "Tax/compliance preflight token is invalid.", {
      code: "tax_preflight_invalid",
      expose: true,
    });
  }

  const now = input.now ?? new Date();
  if (preflight.expiresAt.getTime() <= now.getTime()) {
    throw new HttpError(409, "Tax/compliance preflight has expired.", {
      code: "tax_preflight_expired",
      expose: true,
    });
  }
  if (preflight.accountId !== input.order.accountId) {
    throw new HttpError(
      409,
      "Tax/compliance preflight does not match this account.",
      {
        code: "tax_preflight_account_mismatch",
        expose: true,
      },
    );
  }
  if (preflight.action === "block") {
    throw new HttpError(
      409,
      "Tax/compliance preflight blocked this order.",
      {
        code: "tax_preflight_blocked",
        data: { reasons: preflight.reasons },
        expose: true,
      },
    );
  }

  const orderFingerprint = fingerprintTaxOrder(input.order);
  if (preflight.orderFingerprint !== orderFingerprint) {
    throw new HttpError(
      409,
      "Tax/compliance preflight does not match the submitted order.",
      {
        code: "tax_preflight_order_mismatch",
        expose: true,
      },
    );
  }

  const acknowledgements = new Set(stringList(input.taxAcknowledgements));
  const missingAcknowledgements = (preflight.requiredAcknowledgements || []).filter(
    (acknowledgement) => !acknowledgements.has(acknowledgement),
  );
  if (missingAcknowledgements.length > 0) {
    throw new HttpError(
      409,
      "Tax/compliance acknowledgements are required before live submission.",
      {
        code: "tax_preflight_acknowledgement_required",
        data: { missingAcknowledgements },
        expose: true,
      },
    );
  }

  await db
    .update(taxPreflightChecksTable)
    .set({
      acknowledgedAt:
        (preflight.requiredAcknowledgements || []).length > 0
          ? now
          : preflight.acknowledgedAt,
      updatedAt: now,
    })
    .where(eq(taxPreflightChecksTable.id, preflight.id));

  return {
    preflightToken: token,
    orderFingerprint,
    action: preflight.action,
  };
}

export async function recordTaxPreflightOrderSubmitted(input: {
  appUserId?: string;
  preflightToken?: string | null;
  submittedOrderId?: string | null;
  provider?: string | null;
}): Promise<void> {
  if (!input.preflightToken) return;
  const appUserId = input.appUserId ?? requireCurrentAppUserId();
  const submittedOrderId = input.submittedOrderId?.trim() || null;
  await db
    .update(taxPreflightChecksTable)
    .set({
      submittedOrderId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(taxPreflightChecksTable.appUserId, appUserId),
        eq(taxPreflightChecksTable.preflightToken, input.preflightToken),
      ),
    );
}

async function getOrCreateReserveBucket() {
  const appUserId = requireCurrentAppUserId();
  const profile = await getOrCreateTaxProfileForUser(appUserId);
  const target = profileRowToConfig(profile).cpaOverrideAmount ?? 0;
  const [bucket] = await db
    .insert(taxReserveBucketsTable)
    .values({
      appUserId,
      taxProfileId: profile.id,
      taxYear: profile.taxYear,
      targetAmount: moneyString(target) ?? "0",
      reservedAmount: "0",
      mode: "virtual",
      state: "draft",
    })
    .onConflictDoUpdate({
      target: [taxReserveBucketsTable.appUserId, taxReserveBucketsTable.taxYear],
      set: {
        taxProfileId: profile.id,
        targetAmount: moneyString(target) ?? "0",
        updatedAt: new Date(),
      },
    })
    .returning();
  return { appUserId, profile, bucket };
}

export async function getTaxReserveSnapshot() {
  const { profile, bucket } = await getOrCreateReserveBucket();
  const config = profileRowToConfig(profile);
  const reservedAmount = Number(bucket.reservedAmount) || 0;
  const targetAmount = Number(bucket.targetAmount) || 0;
  return {
    taxYear: profile.taxYear,
    mode: "virtual_plus_broker_beta",
    brokerBetaEnabled: config.brokerReserveBetaEnabled,
    targetAmount,
    reservedAmount,
    coverageRatio: targetAmount > 0 ? reservedAmount / targetAmount : 0,
    currency: bucket.currency,
    allowedInstruments: config.reserveInstrumentAllowlist,
    capability: {
      supportsBrokerReserve: false,
      supportsEtfs: false,
      supportsMutualFunds: false,
      supportsMoneyMarketFunds: false,
      supportsFractional: false,
      supportsPreview: false,
      supportsLiquidation: false,
      settlementDays: null,
      requiresManualReview: true,
      reason: "reserve_broker_beta_not_connected",
    },
    warnings: [
      "Virtual reserve tracking is active.",
      "Broker reserve purchases require capability review and explicit confirmation.",
    ],
    updatedAt: bucket.updatedAt.toISOString(),
  };
}

export async function planTaxReserve(input: unknown) {
  const { bucket } = await getOrCreateReserveBucket();
  const body = readJsonRecord(input);
  const targetAmount = numberOrNull(body.targetAmount);
  if (targetAmount != null && targetAmount >= 0) {
    const [updated] = await db
      .update(taxReserveBucketsTable)
      .set({
        targetAmount: moneyString(targetAmount) ?? "0",
        updatedAt: new Date(),
      })
      .where(eq(taxReserveBucketsTable.id, bucket.id))
      .returning();
    return { ...(await getTaxReserveSnapshot()), bucketId: updated.id };
  }
  return { ...(await getTaxReserveSnapshot()), bucketId: bucket.id };
}

export async function previewTaxReserveAction(input: unknown) {
  const body = readJsonRecord(input);
  const reserve = await getTaxReserveSnapshot();
  const amount = numberOrNull(body.amount) ?? 0;
  return {
    previewId: `tax_reserve_preview_${randomUUID()}`,
    action: String(body.action || "reserve_cash"),
    amount,
    currency: reserve.currency,
    status: amount > 0 ? "previewed" : "blocked",
    capability: reserve.capability,
    warnings: reserve.warnings,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}

export async function submitTaxReserveAction(input: unknown) {
  const { appUserId, bucket, profile } = await getOrCreateReserveBucket();
  const body = readJsonRecord(input);
  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : randomUUID();
  const amount = numberOrNull(body.amount) ?? 0;
  const [action] = await db
    .insert(taxReserveActionsTable)
    .values({
      appUserId,
      bucketId: bucket.id,
      accountId: typeof body.accountId === "string" ? body.accountId : null,
      actionType: String(body.action || "reserve_cash"),
      status: "virtual_recorded",
      amount: moneyString(amount),
      instrumentSymbol:
        typeof body.instrumentSymbol === "string" ? body.instrumentSymbol : null,
      idempotencyKey,
      capabilitySnapshot: {
        supportsBrokerReserve: false,
        reason: "virtual_reserve_record_only",
      },
      confirmedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        taxReserveActionsTable.appUserId,
        taxReserveActionsTable.idempotencyKey,
      ],
      set: {
        updatedAt: new Date(),
      },
    })
    .returning();
  await db.insert(taxAuditEventsTable).values({
    appUserId,
    taxYear: profile.taxYear,
    eventType: "tax_reserve_action_recorded",
    severity: "info",
    message: "Virtual tax reserve action was recorded.",
    metadata: { actionId: action.id, amount },
  });
  return {
    actionId: action.id,
    status: action.status,
    amount: Number(action.amount) || 0,
    virtualOnly: true,
    brokerOrderId: action.brokerOrderId,
    updatedAt: action.updatedAt.toISOString(),
  };
}
