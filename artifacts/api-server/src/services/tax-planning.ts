import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  brokerAccountsTable,
  brokerOrdersTable,
  instrumentsTable,
  orderRequestsTable,
  shadowAccountsTable,
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
import { fingerprintIbkrOrderBody } from "./ibkr-order-intent";

const TAX_PREFLIGHT_TTL_MS = 2 * 60 * 1000;
const TAX_PREFLIGHT_ORDER_SUBMISSION_CONSUMED_MARKER =
  "__order_submission_consumed__";
const IBKR_REPLY_PENDING_PREFIX = "__ibkr_reply_pending__:";
const IBKR_REPLY_CLAIMED_PREFIX = "__ibkr_reply_claimed__:";
const IBKR_RECONCILIATION_REQUIRED_MARKER =
  "__ibkr_reconciliation_required__";
const LEGACY_SHADOW_ACCOUNT_ID = "shadow";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

export type IbkrPreparedPlaceOrderIntent = {
  version: 1;
  kind?: "place";
  accountId: string;
  clientOrderId: string;
  orderFingerprint: string;
  orderBody: Record<string, unknown>;
  preparedAt: string;
  whatIf: Record<string, unknown>;
};

export type IbkrPreparedReplaceOrderIntent = {
  version: 2;
  kind: "replace";
  orderId: string;
  previousOrderFingerprint: string;
  accountId: string;
  clientOrderId: string;
  orderFingerprint: string;
  orderBody: Record<string, unknown>;
  preparedAt: string;
  whatIf: Record<string, unknown>;
};

export type IbkrPreparedOrderIntent =
  | IbkrPreparedPlaceOrderIntent
  | IbkrPreparedReplaceOrderIntent;

function readIbkrPreparedOrderIntent(
  value: unknown,
  expectedAccountId: string,
): IbkrPreparedOrderIntent {
  const record = readJsonRecord(value);
  const orderBody = readJsonRecord(record.orderBody);
  const orders = Array.isArray(orderBody.orders) ? orderBody.orders : [];
  const order = readJsonRecord(orders[0]);
  const accountId = String(record.accountId || "").trim();
  const clientOrderId = String(record.clientOrderId || "").trim();
  const orderFingerprint = String(record.orderFingerprint || "").trim();
  const actualFingerprint = fingerprintIbkrOrderBody(orderBody);
  const placeIntent = record.version === 1 && (!record.kind || record.kind === "place");
  const replaceIntent = record.version === 2 && record.kind === "replace";
  const orderId = String(record.orderId || "").trim();
  const previousOrderFingerprint = String(
    record.previousOrderFingerprint || "",
  ).trim();
  if (
    (!placeIntent && !replaceIntent) ||
    orders.length !== 1 ||
    accountId !== expectedAccountId ||
    String(order.acctId || "").trim() !== accountId ||
    String(order.cOID || "").trim() !== clientOrderId ||
    !/^[A-Za-z0-9._:-]{1,64}$/u.test(clientOrderId) ||
    !/^[a-f0-9]{64}$/u.test(orderFingerprint) ||
    actualFingerprint !== orderFingerprint ||
    (replaceIntent &&
      (!PROVIDER_ACCOUNT_ID_PATTERN.test(orderId) ||
        !/^[a-f0-9]{64}$/u.test(previousOrderFingerprint)))
  ) {
    throw new HttpError(409, "The prepared IBKR order intent is invalid.", {
      code: "ibkr_order_intent_invalid",
      expose: true,
    });
  }
  const whatIf = readJsonRecord(record.whatIf);
  if (String(whatIf.error || "").trim()) {
    throw new HttpError(409, "IBKR what-if rejected the prepared order.", {
      code: "ibkr_what_if_rejected",
      expose: true,
    });
  }
  const common = {
    accountId,
    clientOrderId,
    orderFingerprint,
    orderBody,
    preparedAt: String(record.preparedAt || ""),
    whatIf,
  };
  return replaceIntent
    ? {
        version: 2,
        kind: "replace",
        orderId,
        previousOrderFingerprint,
        ...common,
      }
    : { version: 1, kind: "place", ...common };
}

type TaxProfileRow = typeof taxProfilesTable.$inferSelect;
type TaxProfileAccountRow = typeof taxProfileAccountsTable.$inferSelect;
type ShadowTaxFillRow = import("./shadow-account").ShadowTaxFoldFill;
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

async function loadShadowTaxFills(
  appUserId: string,
  taxYear: number,
): Promise<{ shadowAccountId: string | null; fills: ShadowTaxFillRow[] }> {
  const accountId = await resolveShadowTaxAccountId(appUserId);
  if (!accountId) {
    return { shadowAccountId: null, fills: [] };
  }
  const { start, end } = taxYearWindow(taxYear);
  // Function-local import avoids the static cycle
  // shadow-account -> platform -> tax-planning -> shadow-account.
  const { readShadowTaxFillsFromSharedFold } = await import("./shadow-account");
  const fills = await readShadowTaxFillsFromSharedFold({
    accountId,
    start,
    end,
  });
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

export async function createTaxOrderPreflight(
  input: unknown,
  options: { ibkrPreparedIntent?: IbkrPreparedOrderIntent | null } = {},
) {
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
  const ibkrPreparedIntent = options.ibkrPreparedIntent
    ? readIbkrPreparedOrderIntent(options.ibkrPreparedIntent, order.accountId)
    : null;
  const whatIfWarnings = ibkrPreparedIntent
    ? stringList(ibkrPreparedIntent.whatIf.warnings)
    : [];
  const requiredAcknowledgements = Array.from(
    new Set([
      ...evaluation.requiredAcknowledgements,
      ...(whatIfWarnings.length ? ["ibkr_what_if_warning_reviewed"] : []),
    ]),
  );
  const preflightEvaluation = {
    ...evaluation,
    action:
      evaluation.action === "block"
        ? "block"
        : requiredAcknowledgements.length
          ? "warn_ack_required"
          : "allow",
    warnings: [...evaluation.warnings, ...whatIfWarnings],
    requiredAcknowledgements,
  };
  const preflightToken = `tax_pf_${randomUUID()}`;
  const expiresAt = new Date(Date.now() + TAX_PREFLIGHT_TTL_MS);
  await db.insert(taxPreflightChecksTable).values({
    appUserId,
    accountId: String(order.accountId || ""),
    preflightToken,
    orderFingerprint: preflightEvaluation.orderFingerprint,
    action: preflightEvaluation.action,
    washSaleRisk: preflightEvaluation.washSaleRisk,
    selfTradeRisk: preflightEvaluation.selfTradeRisk,
    reasons: preflightEvaluation.reasons,
    warnings: preflightEvaluation.warnings,
    requiredAcknowledgements: preflightEvaluation.requiredAcknowledgements,
    expiresAt,
    metadata: {
      order,
      rolloutMode: "compute_only",
      ...(ibkrPreparedIntent ? { ibkrPreparedIntent } : {}),
    },
  });
  await db.insert(taxAuditEventsTable).values({
    appUserId,
    taxYear: profile.taxYear,
    eventType:
      preflightEvaluation.action === "block"
        ? "tax_preflight_blocked"
        : "tax_preflight_created",
    severity: preflightEvaluation.action === "block" ? "warning" : "info",
    message:
      preflightEvaluation.action === "block"
        ? "Tax/compliance preflight blocked an order."
        : "Tax/compliance preflight was created.",
    metadata: { ...preflightEvaluation, accountId: order.accountId },
  });
  return {
    ...preflightEvaluation,
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
  ibkrPreparedIntent: IbkrPreparedOrderIntent | null;
};

export async function loadSubmittedIbkrPreparedOrderIntent(input: {
  appUserId?: string;
  accountId: string;
  submittedOrderId: string;
}): Promise<IbkrPreparedOrderIntent> {
  const appUserId = input.appUserId ?? requireCurrentAppUserId();
  const accountId = String(input.accountId || "").trim();
  const submittedOrderId = String(input.submittedOrderId || "").trim();
  if (
    !PROVIDER_ACCOUNT_ID_PATTERN.test(accountId) ||
    !PROVIDER_ACCOUNT_ID_PATTERN.test(submittedOrderId)
  ) {
    throw new HttpError(409, "The submitted IBKR order reference is invalid.", {
      code: "ibkr_submitted_order_intent_invalid",
      expose: true,
    });
  }
  const [preflight] = await db
    .select({ metadata: taxPreflightChecksTable.metadata })
    .from(taxPreflightChecksTable)
    .where(
      and(
        eq(taxPreflightChecksTable.appUserId, appUserId),
        eq(taxPreflightChecksTable.accountId, accountId),
        eq(taxPreflightChecksTable.submittedOrderId, submittedOrderId),
      ),
    )
    .orderBy(desc(taxPreflightChecksTable.updatedAt))
    .limit(1);
  const prepared = readJsonRecord(preflight?.metadata).ibkrPreparedIntent;
  if (!prepared) {
    throw new HttpError(409, "The acknowledged IBKR order intent is unavailable.", {
      code: "ibkr_submitted_order_intent_unavailable",
      expose: true,
    });
  }
  return readIbkrPreparedOrderIntent(prepared, accountId);
}

export async function assertTaxPreflightForOrderSubmission(input: {
  appUserId?: string;
  order: TaxOrderLike;
  taxPreflightToken?: string | null;
  taxAcknowledgements?: unknown;
  requireIbkrPreparedIntent?: boolean;
  expectedIbkrIntentKind?: "place" | "replace";
  expectedBrokerOrderId?: string | null;
  expectedClientOrderId?: string | null;
  expectedOrderFingerprint?: string | null;
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
  if (preflight.submittedOrderId) {
    throw new HttpError(409, "Tax/compliance preflight has already been used.", {
      code: "tax_preflight_already_used",
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

  const ibkrPreparedIntentValue =
    readJsonRecord(preflight.metadata).ibkrPreparedIntent;
  const ibkrPreparedIntent = ibkrPreparedIntentValue
    ? readIbkrPreparedOrderIntent(ibkrPreparedIntentValue, input.order.accountId)
    : null;
  if (input.requireIbkrPreparedIntent && !ibkrPreparedIntent) {
    throw new HttpError(409, "A prepared IBKR order intent is required.", {
      code: "ibkr_order_intent_required",
      expose: true,
    });
  }
  if (
    (input.expectedIbkrIntentKind &&
      (ibkrPreparedIntent?.kind ?? "place") !== input.expectedIbkrIntentKind) ||
    (input.expectedBrokerOrderId &&
      (ibkrPreparedIntent?.kind !== "replace" ||
        ibkrPreparedIntent.orderId !== input.expectedBrokerOrderId)) ||
    (input.expectedClientOrderId &&
      ibkrPreparedIntent?.clientOrderId !== input.expectedClientOrderId) ||
    (input.expectedOrderFingerprint &&
      ibkrPreparedIntent?.orderFingerprint !== input.expectedOrderFingerprint)
  ) {
    throw new HttpError(409, "The prepared IBKR order intent does not match.", {
      code: "ibkr_order_intent_mismatch",
      expose: true,
    });
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

  const consume = async (executor: typeof db) =>
    executor
      .update(taxPreflightChecksTable)
      .set({
        acknowledgedAt:
          (preflight.requiredAcknowledgements || []).length > 0
            ? now
            : preflight.acknowledgedAt,
        submittedOrderId: TAX_PREFLIGHT_ORDER_SUBMISSION_CONSUMED_MARKER,
        updatedAt: now,
      })
      .where(
        and(
          eq(taxPreflightChecksTable.id, preflight.id),
          isNull(taxPreflightChecksTable.submittedOrderId),
        ),
      )
      .returning({ id: taxPreflightChecksTable.id });

  const consumed = ibkrPreparedIntent
    ? await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`ibkr-order-mutation:${appUserId}`}))`,
        );
        const candidates = await tx
          .select({
            id: taxPreflightChecksTable.id,
            submittedOrderId: taxPreflightChecksTable.submittedOrderId,
            metadata: taxPreflightChecksTable.metadata,
          })
          .from(taxPreflightChecksTable)
          .where(eq(taxPreflightChecksTable.appUserId, appUserId));
        const unresolved = candidates.some((candidate) => {
          if (candidate.id === preflight.id) return false;
          if (!readJsonRecord(candidate.metadata).ibkrPreparedIntent) return false;
          const marker = candidate.submittedOrderId || "";
          return (
            marker === TAX_PREFLIGHT_ORDER_SUBMISSION_CONSUMED_MARKER ||
            marker === IBKR_RECONCILIATION_REQUIRED_MARKER ||
            marker.startsWith(IBKR_REPLY_PENDING_PREFIX) ||
            marker.startsWith(IBKR_REPLY_CLAIMED_PREFIX)
          );
        });
        if (unresolved) {
          throw new HttpError(409, "Another IBKR order action requires reconciliation.", {
            code: "ibkr_order_mutation_in_progress",
            expose: true,
          });
        }
        return consume(tx as typeof db);
      })
    : await consume(db);

  if (consumed.length === 0) {
    throw new HttpError(409, "Tax/compliance preflight has already been used.", {
      code: "tax_preflight_already_used",
      expose: true,
    });
  }

  return {
    preflightToken: token,
    orderFingerprint,
    action: preflight.action,
    ibkrPreparedIntent,
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
  const submittedOrderId =
    input.submittedOrderId?.trim() ||
    TAX_PREFLIGHT_ORDER_SUBMISSION_CONSUMED_MARKER;
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

export async function recordTaxPreflightIbkrReconciliationRequired(input: {
  appUserId?: string;
  preflightToken: string;
  reason: string;
}): Promise<void> {
  const appUserId = input.appUserId ?? requireCurrentAppUserId();
  const [preflight] = await db
    .select()
    .from(taxPreflightChecksTable)
    .where(
      and(
        eq(taxPreflightChecksTable.appUserId, appUserId),
        eq(taxPreflightChecksTable.preflightToken, input.preflightToken),
      ),
    )
    .limit(1);
  const currentMarker = preflight?.submittedOrderId || "";
  if (
    !preflight ||
    (currentMarker !== TAX_PREFLIGHT_ORDER_SUBMISSION_CONSUMED_MARKER &&
      !currentMarker.startsWith(IBKR_REPLY_CLAIMED_PREFIX))
  ) {
    return;
  }
  const metadata = {
    ...readJsonRecord(preflight.metadata),
    ibkrReconciliation: {
      reason: String(input.reason || "broker_outcome_unknown").slice(0, 128),
      recordedAt: new Date().toISOString(),
    },
  };
  await db
    .update(taxPreflightChecksTable)
    .set({
      submittedOrderId: IBKR_RECONCILIATION_REQUIRED_MARKER,
      metadata,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(taxPreflightChecksTable.id, preflight.id),
        eq(taxPreflightChecksTable.submittedOrderId, currentMarker),
      ),
    );
}

export async function recordTaxPreflightIbkrReplyRequired(input: {
  appUserId?: string;
  preflightToken: string;
  replyId: string;
  messages: unknown;
  now?: Date;
}) {
  const appUserId = input.appUserId ?? requireCurrentAppUserId();
  const replyId = String(input.replyId || "").trim();
  if (!replyId || replyId.length > 256) {
    throw new HttpError(409, "The IBKR order warning reply is invalid.", {
      code: "ibkr_order_reply_invalid",
      expose: true,
    });
  }
  const [preflight] = await db
    .select()
    .from(taxPreflightChecksTable)
    .where(
      and(
        eq(taxPreflightChecksTable.appUserId, appUserId),
        eq(taxPreflightChecksTable.preflightToken, input.preflightToken),
      ),
    )
    .limit(1);
  const currentMarker = preflight?.submittedOrderId ?? "";
  if (
    !preflight ||
    (currentMarker !== TAX_PREFLIGHT_ORDER_SUBMISSION_CONSUMED_MARKER &&
      !currentMarker.startsWith(IBKR_REPLY_CLAIMED_PREFIX))
  ) {
    throw new HttpError(409, "The IBKR order reply cannot be continued.", {
      code: "ibkr_order_reply_unavailable",
      expose: true,
    });
  }
  const challengeId = `ibkr_reply_${randomUUID()}`;
  const messages = stringList(input.messages);
  const priorReply = readJsonRecord(readJsonRecord(preflight.metadata).ibkrReply);
  const replyCount = Number(priorReply.replyCount || 0) + 1;
  if (replyCount > 5) {
    throw new HttpError(409, "Too many chained IBKR order warnings.", {
      code: "ibkr_order_reply_limit_exceeded",
      expose: true,
    });
  }
  const metadata = {
    ...readJsonRecord(preflight.metadata),
    ibkrReply: {
      challengeId,
      replyId,
      messages,
      replyCount,
      createdAt: (input.now ?? new Date()).toISOString(),
    },
  };
  const updated = await db
    .update(taxPreflightChecksTable)
    .set({
      submittedOrderId: `${IBKR_REPLY_PENDING_PREFIX}${challengeId}`,
      metadata,
      updatedAt: input.now ?? new Date(),
    })
    .where(
      and(
        eq(taxPreflightChecksTable.id, preflight.id),
        eq(taxPreflightChecksTable.submittedOrderId, currentMarker),
      ),
    )
    .returning({ id: taxPreflightChecksTable.id });
  if (!updated.length) {
    throw new HttpError(409, "The IBKR order reply was already changed.", {
      code: "ibkr_order_reply_already_used",
      expose: true,
    });
  }
  return { challengeId, messages, expiresAt: preflight.expiresAt.toISOString() };
}

export async function claimTaxPreflightIbkrReply(input: {
  appUserId?: string;
  preflightToken: string;
  challengeId: string;
  now?: Date;
}) {
  const appUserId = input.appUserId ?? requireCurrentAppUserId();
  const [preflight] = await db
    .select()
    .from(taxPreflightChecksTable)
    .where(
      and(
        eq(taxPreflightChecksTable.appUserId, appUserId),
        eq(taxPreflightChecksTable.preflightToken, input.preflightToken),
      ),
    )
    .limit(1);
  const now = input.now ?? new Date();
  if (!preflight || preflight.expiresAt.getTime() <= now.getTime()) {
    throw new HttpError(409, "The IBKR order reply has expired.", {
      code: "ibkr_order_reply_expired",
      expose: true,
    });
  }
  const challengeId = String(input.challengeId || "").trim();
  const pendingMarker = `${IBKR_REPLY_PENDING_PREFIX}${challengeId}`;
  const reply = readJsonRecord(readJsonRecord(preflight.metadata).ibkrReply);
  const preparedValue = readJsonRecord(preflight.metadata).ibkrPreparedIntent;
  const preparedIntent = preparedValue
    ? readIbkrPreparedOrderIntent(preparedValue, preflight.accountId)
    : null;
  if (
    preflight.submittedOrderId !== pendingMarker ||
    String(reply.challengeId || "") !== challengeId
  ) {
    throw new HttpError(409, "The IBKR order reply was already used.", {
      code: "ibkr_order_reply_already_used",
      expose: true,
    });
  }
  const claimed = await db
    .update(taxPreflightChecksTable)
    .set({
      submittedOrderId: `${IBKR_REPLY_CLAIMED_PREFIX}${challengeId}`,
      updatedAt: now,
    })
    .where(
      and(
        eq(taxPreflightChecksTable.id, preflight.id),
        eq(taxPreflightChecksTable.submittedOrderId, pendingMarker),
      ),
    )
    .returning({ id: taxPreflightChecksTable.id });
  if (!claimed.length) {
    throw new HttpError(409, "The IBKR order reply was already used.", {
      code: "ibkr_order_reply_already_used",
      expose: true,
    });
  }
  return {
    replyId: String(reply.replyId || ""),
    messages: stringList(reply.messages),
    ibkrPreparedIntent: preparedIntent,
  };
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
