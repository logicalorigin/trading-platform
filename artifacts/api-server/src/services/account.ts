import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import {
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  flexCashActivityTable,
  flexDividendsTable,
  flexNavHistoryTable,
  flexOpenPositionsTable,
  flexReportRunsTable,
  flexTradesTable,
  instrumentsTable,
  positionLotsTable,
  pool,
  tickerReferenceCacheTable,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  createTransientPostgresBackoff,
  isTransientPostgresError,
} from "../lib/transient-db-error";
import { normalizeSymbol } from "../lib/values";
import { getRuntimeMode, type RuntimeMode } from "../lib/runtime";
import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import {
  assertIbkrGatewayTradingAvailable,
  getBars,
  getQuoteSnapshots,
  listOrdersWithResilience,
} from "./platform";
import {
  listIbkrAccounts,
  listIbkrExecutions,
  listIbkrPositions,
} from "./ibkr-account-bridge";
import {
  getShadowAccountCashActivity,
  getShadowAccountClosedTrades,
  getShadowAccountEquityHistory,
  getShadowAccountPositionsAtDate,
  isShadowAccountId,
} from "./shadow-account";
import { fetchShadowAccountSnapshotBase } from "./shadow-account-streams";
import {
  accountBenchmarkLimitForRange,
  accountBenchmarkTimeframeForRange,
  accountRangeStart,
  normalizeAccountRange,
  type AccountRange,
} from "./account-ranges";
import {
  buildPositionMarketHydration,
  canHydratePositionFromEquityQuote,
  filterOpenBrokerPositions,
  isOpenBrokerPosition,
  positionReferenceSymbol,
  positionSignedNotional,
  POSITION_QUANTITY_EPSILON,
  type PositionMarketHydration,
} from "./account-position-model";
import {
  buildAccountMarginSnapshot,
  inferAccountType,
  sumAccounts,
  weightedAccountAverage,
} from "./account-summary-model";
import {
  calculateTransferAdjustedReturnPoints,
  classifyExternalCashTransfer,
  compactEquitySnapshotRows,
  filterSnapshotsOnFlexTransferDates,
  filterPlaceholderZeroEquitySnapshotRows,
  isPlaceholderZeroAccountSnapshot,
  persistedAccountRowsToSnapshots,
  trimLeadingInactiveEquityPoints,
  type AccountEquityHistorySeedPoint,
  type EquitySnapshotRow,
  type PersistedAccountSnapshotRow,
} from "./account-equity-history-model";
import {
  isEtfSymbol,
  normalizeAssetClassLabel,
  normalizeOrderTab,
  normalizeTradeAssetClassLabel,
  orderGroupKey,
  positionGroupKey,
  terminalOrderStatus,
  workingOrderStatus,
  type OrderTab,
} from "./account-trade-model";
import {
  betaForSymbol,
  buildExpiryConcentration,
  exposureSummary,
  hasOptionContract,
  hydratedPositionMarketValue,
  matchOptionChainContract,
  mergeOptionChainContracts,
  optionChainGroupKey,
  scaleOptionGreek,
  sectorForSymbol,
  sumNullableValues,
  upsertNullableTotal,
  weightPercent,
  type OptionGreekEnrichmentResult,
  type OptionPositionSnapshot,
  type PositionGreekSnapshot,
} from "./account-risk-model";
import {
  buildFlexBackfillWindows,
  extractFlexRecords,
  extractTagText,
  flexConfigured,
  getFlexConfigs,
} from "./account-flex-model";
import type {
  BrokerAccountSnapshot,
  BrokerExecutionSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  OptionChainContract,
  QuoteSnapshot,
} from "../providers/ibkr/client";

const COMBINED_ACCOUNT_ID = "combined";
const FLEX_SEND_REQUEST_URL =
  "https://www.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest";
const FLEX_GET_STATEMENT_URL =
  "https://www.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement";
const SNAPSHOT_WRITE_INTERVAL_MS = 60_000;
const FLEX_POLL_INTERVAL_MS = 5_000;
const FLEX_MAX_POLLS = 18;
const FLEX_REFERENCE_MAX_ATTEMPTS = FLEX_MAX_POLLS;
const FLEX_RETRYABLE_ERROR_CODES = new Set(["1001", "1002", "1018"]);
const OPTION_GREEK_CACHE_TTL_MS = 15_000;
const OPTION_CHAIN_INITIAL_STRIKES_AROUND_MONEY = 250;
const OPTION_CHAIN_FALLBACK_STRIKES_AROUND_MONEY = 2_000;
const ACCOUNT_SCHEMA_READINESS_CACHE_TTL_MS = 30_000;

type AccountMetric = {
  value: number | null;
  currency: string | null;
  source: "IBKR_ACCOUNT_SUMMARY" | "IBKR_POSITIONS" | "FLEX" | "LOCAL_LEDGER";
  field: string;
  updatedAt: Date | null;
};

type AccountUniverse = {
  requestedAccountId: string;
  accountIds: string[];
  isCombined: boolean;
  accounts: BrokerAccountSnapshot[];
  primaryCurrency: string;
  source: "live" | "persisted" | "flex";
  latestSnapshotAt: Date | null;
  staleReason: string | null;
};

type OptionChainCacheEntry = {
  expiresAt: number;
  contracts: OptionChainContract[];
  error: string | null;
};

const snapshotWriteTimestamps = new Map<string, number>();
const accountSnapshotPersistenceBackoff = createTransientPostgresBackoff();
const accountSnapshotReadBackoff = createTransientPostgresBackoff();
const accountPositionLotsReadBackoff = createTransientPostgresBackoff();
const optionalAccountSchemaReadBackoff = createTransientPostgresBackoff();
const optionGreekChainCache = new Map<string, OptionChainCacheEntry>();
const OPTIONAL_ACCOUNT_SCHEMA_TABLES = [
  "flex_report_runs",
  "flex_nav_history",
  "flex_cash_activity",
  "flex_dividends",
  "flex_open_positions",
  "flex_trades",
  "ticker_reference_cache",
] as const;
const FLEX_STORAGE_REQUIRED_TABLES = [
  "flex_report_runs",
  "flex_nav_history",
  "flex_cash_activity",
  "flex_dividends",
  "flex_open_positions",
  "flex_trades",
] as const;

type OptionalAccountSchemaTable = (typeof OPTIONAL_ACCOUNT_SCHEMA_TABLES)[number];

type AccountSchemaReadiness = {
  checkedAt: number;
  missingTables: OptionalAccountSchemaTable[];
  schemaError: string | null;
};

let accountSchemaReadinessCache: AccountSchemaReadiness | null = null;
let accountSchemaReadinessPromise: Promise<AccountSchemaReadiness> | null = null;
const loggedMissingAccountSchemaTables = new Set<OptionalAccountSchemaTable>();
let loggedAccountSchemaReadinessError: string | null = null;

function getIbkrClient(): IbkrBridgeClient {
  return new IbkrBridgeClient();
}

function metric(
  value: number | null | undefined,
  currency: string | null,
  source: AccountMetric["source"],
  field: string,
  updatedAt: Date | null,
): AccountMetric {
  return {
    value: isFiniteNumber(value) ? Number(value) : null,
    currency,
    source,
    field,
    updatedAt,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingRelationError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  if (error.code === "42P01") {
    return true;
  }

  const cause = error.cause;
  return isRecord(cause) && cause.code === "42P01";
}

function normalizeOptionalAccountSchemaTable(
  value: string | null | undefined,
): OptionalAccountSchemaTable | null {
  if (!value) {
    return null;
  }

  return OPTIONAL_ACCOUNT_SCHEMA_TABLES.includes(
    value as OptionalAccountSchemaTable,
  )
    ? (value as OptionalAccountSchemaTable)
    : null;
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function extractMissingRelationName(
  error: unknown,
): OptionalAccountSchemaTable | null {
  if (!isRecord(error)) {
    return null;
  }

  const candidates = [
    typeof error.message === "string" ? error.message : null,
    isRecord(error.cause) && typeof error.cause.message === "string"
      ? error.cause.message
      : null,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const match = /relation "([^"]+)"/i.exec(candidate);
    const tableName = normalizeOptionalAccountSchemaTable(match?.[1] ?? null);
    if (tableName) {
      return tableName;
    }
  }

  return null;
}

function cacheAccountSchemaReadiness(
  readiness: AccountSchemaReadiness,
): AccountSchemaReadiness {
  accountSchemaReadinessCache = readiness;
  return readiness;
}

function recordMissingAccountSchemaTables(
  missingTables: readonly OptionalAccountSchemaTable[],
  error?: unknown,
): void {
  const newlyMissing = missingTables.filter((tableName) => {
    if (loggedMissingAccountSchemaTables.has(tableName)) {
      return false;
    }
    loggedMissingAccountSchemaTables.add(tableName);
    return true;
  });

  if (!newlyMissing.length) {
    return;
  }

  logger.warn(
    {
      missingTables: newlyMissing,
      err: error,
    },
    "Account/FLEX storage tables are missing; using degraded live-only fallbacks",
  );
}

function markAccountSchemaTablesMissing(
  missingTables: readonly OptionalAccountSchemaTable[],
  error?: unknown,
): AccountSchemaReadiness {
  const currentMissing = new Set(accountSchemaReadinessCache?.missingTables ?? []);
  missingTables.forEach((tableName) => currentMissing.add(tableName));
  const mergedMissingTables = OPTIONAL_ACCOUNT_SCHEMA_TABLES.filter((tableName) =>
    currentMissing.has(tableName),
  );
  const readiness = cacheAccountSchemaReadiness({
    checkedAt: Date.now(),
    missingTables: mergedMissingTables,
    schemaError: accountSchemaReadinessCache?.schemaError ?? null,
  });
  recordMissingAccountSchemaTables(missingTables, error);
  return readiness;
}

async function getOptionalAccountSchemaReadiness(
  force = false,
): Promise<AccountSchemaReadiness> {
  const now = Date.now();
  if (
    !force &&
    accountSchemaReadinessCache &&
    now - accountSchemaReadinessCache.checkedAt < ACCOUNT_SCHEMA_READINESS_CACHE_TTL_MS
  ) {
    return accountSchemaReadinessCache;
  }

  if (accountSchemaReadinessPromise) {
    return accountSchemaReadinessPromise;
  }

  accountSchemaReadinessPromise = (async () => {
    try {
      const result = await pool.query<{ table_name: string }>(
        `select table_name
         from information_schema.tables
         where table_schema = 'public'
           and table_name = any($1::text[])`,
        [OPTIONAL_ACCOUNT_SCHEMA_TABLES],
      );
      const presentTables = new Set<OptionalAccountSchemaTable>();
      result.rows.forEach((row) => {
        const tableName = normalizeOptionalAccountSchemaTable(row.table_name);
        if (tableName) {
          presentTables.add(tableName);
        }
      });
      const missingTables = OPTIONAL_ACCOUNT_SCHEMA_TABLES.filter(
        (tableName) => !presentTables.has(tableName),
      );
      const readiness = cacheAccountSchemaReadiness({
        checkedAt: Date.now(),
        missingTables,
        schemaError: null,
      });
      recordMissingAccountSchemaTables(missingTables);
      return readiness;
    } catch (error) {
      const schemaError = summarizeError(error);
      if (loggedAccountSchemaReadinessError !== schemaError) {
        loggedAccountSchemaReadinessError = schemaError;
        logger.warn({ err: error }, "Failed to probe account/FLEX schema readiness");
      }
      return cacheAccountSchemaReadiness({
        checkedAt: Date.now(),
        missingTables: accountSchemaReadinessCache?.missingTables ?? [],
        schemaError,
      });
    } finally {
      accountSchemaReadinessPromise = null;
    }
  })();

  return accountSchemaReadinessPromise;
}

async function withOptionalAccountSchemaFallback<T>(input: {
  tables: readonly OptionalAccountSchemaTable[];
  fallback: () => T;
  run: () => Promise<T>;
}): Promise<T> {
  const now = Date.now();
  if (optionalAccountSchemaReadBackoff.isActive(now)) {
    return input.fallback();
  }

  const readiness = await getOptionalAccountSchemaReadiness();
  if (readiness.schemaError) {
    return input.fallback();
  }

  const knownMissingTables = input.tables.filter((tableName) =>
    readiness.missingTables.includes(tableName),
  );
  if (knownMissingTables.length) {
    return input.fallback();
  }

  try {
    const result = await input.run();
    optionalAccountSchemaReadBackoff.clear();
    return result;
  } catch (error) {
    if (isMissingRelationError(error)) {
      const missingTable = extractMissingRelationName(error);
      if (!missingTable || !input.tables.includes(missingTable)) {
        throw error;
      }
      markAccountSchemaTablesMissing([missingTable], error);
      return input.fallback();
    }
    if (isTransientPostgresError(error)) {
      optionalAccountSchemaReadBackoff.markFailure({
        error,
        logger,
        message:
          "Account optional history database unavailable; using live-only account fallbacks",
        nowMs: Date.now(),
      });
      return input.fallback();
    }
    throw error;
  }
}

async function withAccountSnapshotReadFallback<T>(input: {
  fallback: () => T;
  message: string;
  run: () => Promise<T>;
}): Promise<T> {
  const now = Date.now();
  if (accountSnapshotReadBackoff.isActive(now)) {
    return input.fallback();
  }

  try {
    const result = await input.run();
    accountSnapshotReadBackoff.clear();
    return result;
  } catch (error) {
    if (!isTransientPostgresError(error)) {
      throw error;
    }
    accountSnapshotReadBackoff.markFailure({
      error,
      logger,
      message: input.message,
      nowMs: Date.now(),
    });
    return input.fallback();
  }
}

async function withAccountPositionLotsReadFallback<T>(input: {
  backoff?: ReturnType<typeof createTransientPostgresBackoff>;
  fallback: () => T;
  logger?: { warn: (payload: unknown, message: string) => void };
  nowMs?: () => number;
  run: () => Promise<T>;
}): Promise<T> {
  const backoff = input.backoff ?? accountPositionLotsReadBackoff;
  const now = input.nowMs?.() ?? Date.now();
  if (backoff.isActive(now)) {
    return input.fallback();
  }

  try {
    const result = await input.run();
    backoff.clear();
    return result;
  } catch (error) {
    if (!isTransientPostgresError(error)) {
      throw error;
    }
    backoff.markFailure({
      error,
      logger: input.logger ?? logger,
      message:
        "Account position lots database unavailable; returning live positions without lots",
      nowMs: now,
    });
    return input.fallback();
  }
}

async function ensureFlexStorageTablesAvailable(): Promise<void> {
  const readiness = await getOptionalAccountSchemaReadiness();
  const missingTables = FLEX_STORAGE_REQUIRED_TABLES.filter((tableName) =>
    readiness.missingTables.includes(tableName),
  );
  if (!missingTables.length) {
    return;
  }

  throw new HttpError(503, "IBKR Flex storage tables are missing.", {
    code: "ibkr_flex_schema_missing",
    detail: `Run pnpm --filter @workspace/db run push. Missing tables: ${missingTables.join(", ")}.`,
    expose: true,
  });
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[$,%\s,]/g, "");
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function numericString(value: unknown): string | null {
  const numeric = toNumber(value);
  return numeric === null ? null : String(numeric);
}

function nonNullNumericString(value: unknown, fallback = 0): string {
  return String(toNumber(value) ?? fallback);
}

function firstString(
  source: Record<string, string>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const direct = source[key];
    if (direct?.trim()) {
      return direct.trim();
    }

    const entry = Object.entries(source).find(
      ([candidate]) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (entry?.[1]?.trim()) {
      return entry[1].trim();
    }
  }

  return null;
}

function firstNumber(
  source: Record<string, string>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = firstString(source, [key]);
    const numeric = toNumber(value);
    if (numeric !== null) {
      return numeric;
    }
  }

  return null;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const raw = value.trim();
  const yyyymmdd = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (yyyymmdd) {
    return new Date(
      Date.UTC(Number(yyyymmdd[1]), Number(yyyymmdd[2]) - 1, Number(yyyymmdd[3])),
    );
  }

  const yyyymmddTime = raw.match(
    /^(\d{4})(\d{2})(\d{2})[;\sT]+(\d{2}):?(\d{2}):?(\d{2})?$/,
  );
  if (yyyymmddTime) {
    return new Date(
      Date.UTC(
        Number(yyyymmddTime[1]),
        Number(yyyymmddTime[2]) - 1,
        Number(yyyymmddTime[3]),
        Number(yyyymmddTime[4]),
        Number(yyyymmddTime[5]),
        Number(yyyymmddTime[6] ?? "0"),
      ),
    );
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateFromDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(`${value}T12:00:00.000Z`);
}

function dateWindowUtc(value: string | Date): {
  date: string;
  start: Date;
  end: Date;
} {
  const parsed = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "Invalid inspection date.", {
      code: "invalid_account_inspection_date",
      expose: true,
    });
  }
  const start = new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  return {
    date: formatDateOnly(start),
    start,
    end,
  };
}

function currencyOf(accounts: BrokerAccountSnapshot[]): string {
  return accounts[0]?.currency || "USD";
}

function latestTimestampOf(accounts: BrokerAccountSnapshot[]): Date | null {
  const timestamps = accounts
    .map((account) => account.updatedAt?.getTime?.() ?? 0)
    .filter(Boolean);
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

function accountMetricUpdatedAt(accounts: BrokerAccountSnapshot[]): Date | null {
  return latestTimestampOf(accounts);
}

async function getPersistedBackedAccounts(
  requestedAccountId: string,
  mode: RuntimeMode,
): Promise<{
  accounts: BrokerAccountSnapshot[];
  latestSnapshotAt: Date | null;
}> {
  const isCombined = requestedAccountId === COMBINED_ACCOUNT_ID;
  const conditions = [eq(brokerAccountsTable.mode, mode)];
  if (!isCombined) {
    conditions.push(eq(brokerAccountsTable.providerAccountId, requestedAccountId));
  }

  const rows = await db
    .select({
      providerAccountId: brokerAccountsTable.providerAccountId,
      displayName: brokerAccountsTable.displayName,
      mode: brokerAccountsTable.mode,
      asOf: balanceSnapshotsTable.asOf,
      currency: balanceSnapshotsTable.currency,
      cash: balanceSnapshotsTable.cash,
      buyingPower: balanceSnapshotsTable.buyingPower,
      netLiquidation: balanceSnapshotsTable.netLiquidation,
      maintenanceMargin: balanceSnapshotsTable.maintenanceMargin,
    })
    .from(brokerAccountsTable)
    .innerJoin(
      balanceSnapshotsTable,
      eq(balanceSnapshotsTable.accountId, brokerAccountsTable.id),
    )
    .where(and(...conditions))
    .orderBy(desc(balanceSnapshotsTable.asOf))
    .limit(1_000);

  return persistedAccountRowsToSnapshots(rows);
}

async function getLiveAccountUniverse(
  accountId: string,
  mode: RuntimeMode,
): Promise<AccountUniverse> {
  let liveReadFailed = false;
  const accounts = await listIbkrAccounts(mode).catch(() => {
    liveReadFailed = true;
    return [] as BrokerAccountSnapshot[];
  });
  const requestedAccountId = accountId || COMBINED_ACCOUNT_ID;
  const isCombined = requestedAccountId === COMBINED_ACCOUNT_ID;
  const selectedAccounts = isCombined
    ? accounts
    : accounts.filter((account) => account.id === requestedAccountId);

  if (!selectedAccounts.length) {
    const persistedAccounts = await getPersistedBackedAccounts(
      requestedAccountId,
      mode,
    );
    if (persistedAccounts.accounts.length) {
      return {
        requestedAccountId,
        accountIds: persistedAccounts.accounts.map((account) => account.id),
        isCombined,
        accounts: persistedAccounts.accounts,
        primaryCurrency: currencyOf(persistedAccounts.accounts),
        source: "persisted",
        latestSnapshotAt: persistedAccounts.latestSnapshotAt,
        staleReason: liveReadFailed
          ? "ibkr_unavailable_using_persisted_snapshots"
          : "ibkr_accounts_empty_using_persisted_snapshots",
      };
    }

    const flexAccounts = await getFlexBackedAccounts(requestedAccountId, mode);
    if (flexAccounts.length) {
      return {
        requestedAccountId,
        accountIds: flexAccounts.map((account) => account.id),
        isCombined,
        accounts: flexAccounts,
        primaryCurrency: currencyOf(flexAccounts),
        source: "flex",
        latestSnapshotAt: null,
        staleReason: liveReadFailed
          ? "ibkr_unavailable_using_flex_history"
          : "ibkr_accounts_empty_using_flex_history",
      };
    }

    throw new HttpError(404, `Account "${requestedAccountId}" was not found.`, {
      code: "account_not_found",
      expose: true,
    });
  }

  return {
    requestedAccountId,
    accountIds: selectedAccounts.map((account) => account.id),
    isCombined,
    accounts: selectedAccounts,
    primaryCurrency: currencyOf(selectedAccounts),
    source: "live",
    latestSnapshotAt: null,
    staleReason: null,
  };
}

async function getFlexBackedAccounts(
  requestedAccountId: string,
  mode: RuntimeMode,
): Promise<BrokerAccountSnapshot[]> {
  const navRows = await withOptionalAccountSchemaFallback({
    tables: ["flex_nav_history"],
    fallback: () => [],
    run: async () =>
      db
        .select({
          providerAccountId: flexNavHistoryTable.providerAccountId,
          currency: flexNavHistoryTable.currency,
          statementDate: flexNavHistoryTable.statementDate,
          netAssetValue: flexNavHistoryTable.netAssetValue,
        })
        .from(flexNavHistoryTable)
        .orderBy(desc(flexNavHistoryTable.statementDate))
        .limit(250),
  });

  const latestByAccount = new Map();
  navRows.forEach((row) => {
    if (
      requestedAccountId !== COMBINED_ACCOUNT_ID &&
      row.providerAccountId !== requestedAccountId
    ) {
      return;
    }
    if (!latestByAccount.has(row.providerAccountId)) {
      latestByAccount.set(row.providerAccountId, row);
    }
  });

  return Array.from(latestByAccount.values()).map((row) => ({
    id: row.providerAccountId,
    providerAccountId: row.providerAccountId,
    provider: "ibkr",
    mode,
    displayName: `IBKR ${row.providerAccountId}`,
    currency: row.currency,
    buyingPower: 0,
    cash: 0,
    netLiquidation: toNumber(row.netAssetValue) ?? 0,
    accountType: inferAccountType(row.providerAccountId),
    totalCashValue: null,
    settledCash: null,
    accruedCash: null,
    initialMargin: null,
    maintenanceMargin: null,
    excessLiquidity: null,
    cushion: null,
    sma: null,
    dayTradingBuyingPower: null,
    regTInitialMargin: null,
    grossPositionValue: null,
    leverage: null,
    dayTradesRemaining: null,
    isPatternDayTrader: null,
    updatedAt: dateFromDateOnly(row.statementDate),
  }));
}

async function listPositionsForUniverse(
  universe: AccountUniverse,
  mode: RuntimeMode,
): Promise<BrokerPositionSnapshot[]> {
  if (!universe.isCombined && universe.accountIds[0]) {
    return filterOpenBrokerPositions(
      await listIbkrPositions({
        accountId: universe.accountIds[0],
        mode,
      }),
    );
  }

  const positions = await Promise.all(
    universe.accountIds.map((accountId) =>
      listIbkrPositions({ accountId, mode }),
    ),
  );
  return filterOpenBrokerPositions(positions.flat());
}

async function listOrdersForUniverse(
  universe: AccountUniverse,
  mode: RuntimeMode,
): Promise<{
  orders: BrokerOrderSnapshot[];
  degraded?: boolean;
  reason?: string;
  stale?: boolean;
  debug?: {
    message: string;
    code: string;
    timeoutMs?: number;
  };
}> {
  const results = await Promise.all(
    universe.accountIds.map((accountId) =>
      listOrdersWithResilience({ accountId, mode }),
    ),
  );
  const degraded = results.some((result) => result.degraded);
  const firstDegraded = results.find((result) => result.degraded);
  return {
    orders: results.flatMap((result) => result.orders),
    degraded: degraded || undefined,
    reason: firstDegraded?.reason,
    stale: degraded
      ? results.some((result) => result.stale === true)
      : undefined,
    debug: firstDegraded?.debug,
  };
}

async function listExecutionsForUniverse(
  universe: AccountUniverse,
  options: {
    days?: number;
    limit?: number;
    symbol?: string;
  },
): Promise<BrokerExecutionSnapshot[]> {
  const executions = await Promise.all(
    universe.accountIds.map((accountId) =>
      listIbkrExecutions({
        accountId,
        days: options.days,
        limit: options.limit,
        symbol: options.symbol,
      }),
    ),
  );
  return executions.flat();
}

async function hydratePositionMarkets(
  positions: BrokerPositionSnapshot[],
): Promise<Map<string, PositionMarketHydration>> {
  const symbols = Array.from(
    new Set(
      positions
        .filter(canHydratePositionFromEquityQuote)
        .map((position) => normalizeSymbol(positionReferenceSymbol(position)))
        .filter(Boolean),
    ),
  );
  let quotesBySymbol = new Map<string, QuoteSnapshot>();

  if (symbols.length) {
    const payload = await getQuoteSnapshots({ symbols: symbols.join(",") }).catch(() => ({
      quotes: [],
    }));
    quotesBySymbol = new Map(
      (payload.quotes || []).map((quote) => [normalizeSymbol(quote.symbol), quote]),
    );
  }

  return new Map(
    positions.map((position) => [
      position.id,
      buildPositionMarketHydration(
        position,
        quotesBySymbol.get(normalizeSymbol(positionReferenceSymbol(position))),
      ),
    ]),
  );
}

async function getCachedOptionChainContracts(
  positions: OptionPositionSnapshot[],
): Promise<{ contracts: OptionChainContract[]; error: string | null }> {
  if (!positions.length) {
    return {
      contracts: [],
      error: null,
    };
  }

  const { underlying, expirationDate } = positions[0].optionContract;
  const cacheKey = optionChainGroupKey(positions[0].optionContract);
  const now = Date.now();
  const cached = optionGreekChainCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return {
      contracts: cached.contracts,
      error: cached.error,
    };
  }

  let contracts: OptionChainContract[] = [];
  let error: string | null = null;

  try {
    const initialContracts = await getIbkrClient().getOptionChain({
      underlying,
      expirationDate,
      maxExpirations: 1,
      strikesAroundMoney: OPTION_CHAIN_INITIAL_STRIKES_AROUND_MONEY,
    });
    let resolvedContracts = initialContracts;
    const matchedInitial = positions.filter((position) =>
      matchOptionChainContract(initialContracts, position.optionContract),
    ).length;

    if (matchedInitial < positions.length) {
      const fallbackContracts = await getIbkrClient().getOptionChain({
        underlying,
        expirationDate,
        maxExpirations: 1,
        strikesAroundMoney: OPTION_CHAIN_FALLBACK_STRIKES_AROUND_MONEY,
      });
      resolvedContracts = mergeOptionChainContracts([
        initialContracts,
        fallbackContracts,
      ]);
    }

    contracts = resolvedContracts;
  } catch (fetchError) {
    error =
      fetchError instanceof Error
        ? fetchError.message
        : `Unknown IBKR option-chain error for ${underlying} ${formatDateOnly(expirationDate)}.`;
    logger.warn(
      {
        err: fetchError,
        underlying,
        expirationDate,
      },
      "Unable to refresh IBKR option-chain greeks",
    );
  }

  optionGreekChainCache.set(cacheKey, {
    expiresAt: now + OPTION_GREEK_CACHE_TTL_MS,
    contracts,
    error,
  });

  return {
    contracts,
    error,
  };
}

async function enrichPositionGreeks(
  positions: BrokerPositionSnapshot[],
): Promise<OptionGreekEnrichmentResult> {
  const byPositionId = new Map<string, PositionGreekSnapshot>();
  const warnings = new Set<string>();
  const optionPositions = positions.filter(hasOptionContract);

  if (!optionPositions.length) {
    positions.forEach((position) => {
      const underlying = positionReferenceSymbol(position);
      const beta = betaForSymbol(underlying);
      byPositionId.set(position.id, {
        positionId: position.id,
        symbol: position.symbol,
        underlying,
        delta: position.quantity,
        betaWeightedDelta: position.quantity * beta,
        gamma: 0,
        theta: 0,
        vega: 0,
        source: "IBKR_POSITIONS",
        matched: true,
        warning: null,
      });
    });

    return {
      byPositionId,
      totalOptionPositions: 0,
      matchedOptionPositions: 0,
      warnings: [],
    };
  }

  const optionGroups = Array.from(
    optionPositions.reduce<Map<string, OptionPositionSnapshot[]>>((acc, position) => {
      const key = optionChainGroupKey(position.optionContract);
      acc.set(key, [...(acc.get(key) ?? []), position]);
      return acc;
    }, new Map()),
  );
  const chainResults = new Map<
    string,
    { contracts: OptionChainContract[]; error: string | null }
  >();

  await Promise.all(
    optionGroups.map(async ([key, group]) => {
      const result = await getCachedOptionChainContracts(group);
      chainResults.set(key, result);
      if (result.error) {
        warnings.add(result.error);
      }
    }),
  );

  let matchedOptionPositions = 0;

  positions.forEach((position) => {
    if (!hasOptionContract(position)) {
      const underlying = positionReferenceSymbol(position);
      const beta = betaForSymbol(underlying);
      byPositionId.set(position.id, {
        positionId: position.id,
        symbol: position.symbol,
        underlying,
        delta: position.quantity,
        betaWeightedDelta: position.quantity * beta,
        gamma: 0,
        theta: 0,
        vega: 0,
        source: "IBKR_POSITIONS",
        matched: true,
        warning: null,
      });
      return;
    }

    const underlying = position.optionContract.underlying;
    const contracts =
      chainResults.get(optionChainGroupKey(position.optionContract))?.contracts ?? [];
    const matchedContract = matchOptionChainContract(contracts, position.optionContract);
    const delta = matchedContract ? scaleOptionGreek(matchedContract.delta, position) : null;
    const gamma = matchedContract ? scaleOptionGreek(matchedContract.gamma, position) : null;
    const theta = matchedContract ? scaleOptionGreek(matchedContract.theta, position) : null;
    const vega = matchedContract ? scaleOptionGreek(matchedContract.vega, position) : null;
    const betaWeightedDelta =
      delta === null ? null : delta * betaForSymbol(underlying);
    const hasAnyGreek =
      delta !== null || gamma !== null || theta !== null || vega !== null;
    const warning = !matchedContract
      ? `No IBKR greek snapshot matched ${position.symbol}.`
      : !hasAnyGreek
        ? `IBKR returned ${position.symbol} contract metadata without option greek values.`
        : null;

    if (warning) {
      warnings.add(warning);
    } else {
      matchedOptionPositions += 1;
    }

    byPositionId.set(position.id, {
      positionId: position.id,
      symbol: position.symbol,
      underlying,
      delta,
      betaWeightedDelta,
      gamma,
      theta,
      vega,
      source: "IBKR_OPTION_CHAIN",
      matched: Boolean(matchedContract && hasAnyGreek),
      warning,
    });
  });

  return {
    byPositionId,
    totalOptionPositions: optionPositions.length,
    matchedOptionPositions,
    warnings: Array.from(warnings),
  };
}

async function fetchFlexEndpoint(
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const endpoint = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    endpoint.searchParams.set(key, value);
  });

  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "RayAlgo Account Flex Client/1.0",
      Accept: "application/xml,text/xml,*/*",
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new HttpError(
      response.status,
      `IBKR Flex request failed with HTTP ${response.status}.`,
      {
        code: "ibkr_flex_http_error",
        detail: text.slice(0, 500),
        expose: response.status < 500,
      },
    );
  }

  return text;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestFlexReference(config: {
  token: string;
  queryId: string;
  fromDate?: string | null;
  toDate?: string | null;
  maxAttempts?: number;
}): Promise<{ referenceCode: string; statementUrl: string | null; rawXml: string }> {
  const params: Record<string, string> = {
    t: config.token,
    q: config.queryId,
    v: "3",
  };
  if (config.fromDate && config.toDate) {
    params.fd = config.fromDate;
    params.td = config.toDate;
  }

  const maxAttempts = config.maxAttempts ?? FLEX_REFERENCE_MAX_ATTEMPTS;
  let lastXml = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const rawXml = await fetchFlexEndpoint(FLEX_SEND_REQUEST_URL, params);
    lastXml = rawXml;
    const status = extractTagText(rawXml, "Status");
    const errorCode = extractTagText(rawXml, "ErrorCode");
    const referenceCode =
      extractTagText(rawXml, "ReferenceCode") ??
      extractTagText(rawXml, "Reference") ??
      "";
    const statementUrl = extractTagText(rawXml, "Url");

    if (referenceCode) {
      if (status && !/^success$/i.test(status)) {
        throw new HttpError(502, `IBKR Flex returned status "${status}".`, {
          code: "ibkr_flex_request_rejected",
          detail: rawXml.slice(0, 500),
        });
      }

      return { referenceCode, statementUrl, rawXml };
    }

    if (errorCode && FLEX_RETRYABLE_ERROR_CODES.has(errorCode)) {
      if (attempt < maxAttempts - 1) {
        await sleep(FLEX_POLL_INTERVAL_MS);
        continue;
      }

      throw new HttpError(504, "IBKR Flex reference was not ready before timeout.", {
        code: "ibkr_flex_reference_timeout",
        detail: rawXml.slice(0, 500),
      });
    }

    if (status && !/^success$/i.test(status)) {
      throw new HttpError(502, `IBKR Flex returned status "${status}".`, {
        code: "ibkr_flex_request_rejected",
        detail: rawXml.slice(0, 500),
      });
    }
  }

  throw new HttpError(502, "IBKR Flex did not return a reference code.", {
    code: "ibkr_flex_missing_reference",
    detail: lastXml.slice(0, 500),
  });
}

async function downloadFlexStatement(input: {
  token: string;
  referenceCode: string;
  statementUrl?: string | null;
  maxPolls?: number;
  pollIntervalMs?: number;
}): Promise<string> {
  const maxPolls = input.maxPolls ?? FLEX_MAX_POLLS;
  const pollIntervalMs = input.pollIntervalMs ?? FLEX_POLL_INTERVAL_MS;
  let lastXml = "";

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const rawXml = await fetchFlexEndpoint(
      input.statementUrl || FLEX_GET_STATEMENT_URL,
      {
        t: input.token,
        q: input.referenceCode,
        v: "3",
      },
    );
    lastXml = rawXml;

    if (/<FlexStatements?\b/i.test(rawXml) || /<Trade\b/i.test(rawXml)) {
      return rawXml;
    }

    const status = extractTagText(rawXml, "Status");
    const errorCode = extractTagText(rawXml, "ErrorCode");

    if (
      status &&
      /^fail|error$/i.test(status) &&
      !["1018", "1001", "1002"].includes(errorCode ?? "")
    ) {
      throw new HttpError(502, `IBKR Flex returned status "${status}".`, {
        code: "ibkr_flex_statement_failed",
        detail: rawXml.slice(0, 500),
      });
    }

    await sleep(pollIntervalMs);
  }

  throw new HttpError(504, "IBKR Flex report was not ready before timeout.", {
    code: "ibkr_flex_timeout",
    detail: lastXml.slice(0, 500),
  });
}

async function upsertFlexReport(xml: string, runId: string): Promise<{
  navRows: number;
  trades: number;
  cashActivities: number;
  dividends: number;
  openPositions: number;
}> {
  const navRecords = extractFlexRecords(xml, [
    "ChangeInNAV",
    "NetAssetValue",
    "NAV",
    "EquitySummary",
    "EquitySummaryByReportDateInBase",
  ]);
  const tradeRecords = extractFlexRecords(xml, ["Trade"]);
  const cashRecords = extractFlexRecords(xml, [
    "CashTransaction",
    "CashReport",
    "DepositWithdraw",
  ]);
  const dividendRecords = cashRecords.filter((record) => {
    const type = firstString(record.attributes, ["type", "activityType"]) ?? "";
    const description = firstString(record.attributes, ["description"]) ?? "";
    return /dividend/i.test(`${type} ${description}`);
  });
  const openPositionRecords = extractFlexRecords(xml, ["OpenPosition"]);

  const navValues = navRecords.flatMap((record) => {
    const attrs = record.attributes;
    const providerAccountId =
      firstString(attrs, ["accountId", "account", "acctId"]) ?? "UNKNOWN";
    const statementDate =
      parseDate(firstString(attrs, ["date", "reportDate", "toDate", "asOfDate"])) ??
      null;
    const netAssetValue = firstNumber(attrs, [
      "netAssetValue",
      "endingValue",
      "total",
      "totalEquity",
      "value",
      "endingNAV",
    ]);

    if (!statementDate || netAssetValue === null) {
      return [];
    }

    const explicitDeposits = firstNumber(attrs, ["deposits"]);
    const explicitWithdrawals = firstNumber(attrs, ["withdrawals"]);
    const combinedDepositsWithdrawals = firstNumber(attrs, [
      "depositsWithdrawals",
      "depositsAndWithdrawals",
    ]);
    const deposits =
      explicitDeposits ?? (combinedDepositsWithdrawals && combinedDepositsWithdrawals > 0
        ? combinedDepositsWithdrawals
        : null);
    const withdrawals =
      explicitWithdrawals ?? (combinedDepositsWithdrawals && combinedDepositsWithdrawals < 0
        ? Math.abs(combinedDepositsWithdrawals)
        : null);

    return [
      {
        providerAccountId,
        statementDate: formatDateOnly(statementDate),
        currency: firstString(attrs, ["currency", "currencyPrimary"]) ?? "USD",
        netAssetValue: String(netAssetValue),
        cash: numericString(firstNumber(attrs, ["cash", "cashValue"])),
        securities: numericString(
          firstNumber(attrs, ["securities", "stockValue", "positionValue"]),
        ),
        deposits: numericString(deposits),
        withdrawals: numericString(withdrawals),
        dividends: numericString(firstNumber(attrs, ["dividends"])),
        fees: numericString(
          firstNumber(attrs, ["fees", "commissions", "advisorFees"]),
        ),
        realizedPnl: numericString(
          firstNumber(attrs, ["realizedPnl", "realizedPnL", "fifoPnlRealized"]),
        ),
        changeInNav: numericString(firstNumber(attrs, ["change", "changeInNAV"])),
        sourceRunId: runId,
        raw: attrs,
      },
    ];
  });

  const mergedNavValues = [...navValues.values()].reduce<typeof navValues>(
    (rows, current) => {
      const existing = rows.find(
        (row) =>
          row.providerAccountId === current.providerAccountId &&
          row.statementDate === current.statementDate &&
          row.currency === current.currency,
      );

      if (!existing) {
        rows.push(current);
        return rows;
      }

      existing.netAssetValue = current.netAssetValue ?? existing.netAssetValue;
      existing.cash = current.cash ?? existing.cash;
      existing.securities = current.securities ?? existing.securities;
      existing.deposits = current.deposits ?? existing.deposits;
      existing.withdrawals = current.withdrawals ?? existing.withdrawals;
      existing.dividends = current.dividends ?? existing.dividends;
      existing.fees = current.fees ?? existing.fees;
      existing.realizedPnl = current.realizedPnl ?? existing.realizedPnl;
      existing.changeInNav = current.changeInNav ?? existing.changeInNav;
      existing.sourceRunId = current.sourceRunId;
      existing.raw = {
        ...(isRecord(existing.raw) ? existing.raw : {}),
        ...(isRecord(current.raw) ? current.raw : {}),
      };
      return rows;
    },
    [],
  );

  if (mergedNavValues.length) {
    await db
      .insert(flexNavHistoryTable)
      .values(mergedNavValues)
      .onConflictDoUpdate({
        target: [
          flexNavHistoryTable.providerAccountId,
          flexNavHistoryTable.statementDate,
          flexNavHistoryTable.currency,
        ],
        set: {
          netAssetValue: sql`excluded.net_asset_value`,
          cash: sql`excluded.cash`,
          securities: sql`excluded.securities`,
          deposits: sql`excluded.deposits`,
          withdrawals: sql`excluded.withdrawals`,
          dividends: sql`excluded.dividends`,
          fees: sql`excluded.fees`,
          realizedPnl: sql`excluded.realized_pnl`,
          changeInNav: sql`excluded.change_in_nav`,
          raw: sql`excluded.raw`,
          sourceRunId: sql`excluded.source_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  const tradeValues = tradeRecords.flatMap((record, index) => {
    const attrs = record.attributes;
    const providerAccountId =
      firstString(attrs, ["accountId", "account", "acctId"]) ?? "UNKNOWN";
    const symbol =
      normalizeSymbol(
        firstString(attrs, ["symbol", "underlyingSymbol", "conid"]) ?? "",
      ) || "UNKNOWN";
    const tradeDate =
      parseDate(firstString(attrs, ["dateTime", "when"])) ??
      parseDate(
        [
          firstString(attrs, ["tradeDate", "date"]),
          firstString(attrs, ["tradeTime"]),
        ]
          .filter(Boolean)
          .join(" "),
      );

    if (!tradeDate) {
      return [];
    }

    const tradeId =
      firstString(attrs, ["tradeID", "tradeId", "execID", "ibExecID"]) ??
      `${providerAccountId}:${symbol}:${tradeDate.toISOString()}:${index}`;
    const rawSide =
      firstString(attrs, ["buySell", "side", "transactionType"]) ?? "";
    const side = /^s/i.test(rawSide) ? "sell" : "buy";
    const settleDate = parseDate(
      firstString(attrs, ["settleDate", "settleDateTarget"]),
    );

    return [
      {
        providerAccountId,
        tradeId,
        symbol,
        description: firstString(attrs, ["description"]),
        assetClass:
          firstString(attrs, ["assetCategory", "assetClass", "secType"]) ??
          "stock",
        side,
        quantity: nonNullNumericString(firstNumber(attrs, ["quantity", "qty"])),
        price: numericString(firstNumber(attrs, ["tradePrice", "price"])),
        amount: numericString(firstNumber(attrs, ["amount", "proceeds"])),
        commission: numericString(
          firstNumber(attrs, ["ibCommission", "commission", "commissions"]),
        ),
        currency: firstString(attrs, ["currency"]) ?? "USD",
        tradeDate,
        settleDate: settleDate ? formatDateOnly(settleDate) : null,
        openClose: firstString(attrs, ["openCloseIndicator", "openClose"]),
        realizedPnl: numericString(
          firstNumber(attrs, ["fifoPnlRealized", "realizedPnl", "realizedPnL"]),
        ),
        sourceRunId: runId,
        raw: attrs,
      },
    ];
  });

  if (tradeValues.length) {
    await db
      .insert(flexTradesTable)
      .values(tradeValues)
      .onConflictDoUpdate({
        target: [flexTradesTable.providerAccountId, flexTradesTable.tradeId],
        set: {
          side: sql`excluded.side`,
          quantity: sql`excluded.quantity`,
          price: sql`excluded.price`,
          amount: sql`excluded.amount`,
          commission: sql`excluded.commission`,
          tradeDate: sql`excluded.trade_date`,
          settleDate: sql`excluded.settle_date`,
          openClose: sql`excluded.open_close`,
          realizedPnl: sql`excluded.realized_pnl`,
          raw: sql`excluded.raw`,
          sourceRunId: sql`excluded.source_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  const cashValues = cashRecords.flatMap((record, index) => {
    const attrs = record.attributes;
    const providerAccountId =
      firstString(attrs, ["accountId", "account", "acctId"]) ?? "UNKNOWN";
    const amount = firstNumber(attrs, ["amount", "proceeds", "value"]);
    const activityDate =
      parseDate(firstString(attrs, ["dateTime", "date", "reportDate"])) ?? null;

    if (amount === null || !activityDate) {
      return [];
    }

    const description = firstString(attrs, ["description"]) ?? "";
    const activityType =
      firstString(attrs, ["type", "activityType", "transactionType"]) ??
      "cash";
    const activityId =
      firstString(attrs, ["transactionID", "transactionId", "id"]) ??
      `${providerAccountId}:${activityType}:${activityDate.toISOString()}:${amount}:${index}`;

    return [
      {
        providerAccountId,
        activityId,
        activityType,
        description,
        amount: String(amount),
        currency: firstString(attrs, ["currency"]) ?? "USD",
        activityDate,
        sourceRunId: runId,
        raw: attrs,
      },
    ];
  });

  if (cashValues.length) {
    await db
      .insert(flexCashActivityTable)
      .values(cashValues)
      .onConflictDoUpdate({
        target: [
          flexCashActivityTable.providerAccountId,
          flexCashActivityTable.activityId,
        ],
        set: {
          amount: sql`excluded.amount`,
          description: sql`excluded.description`,
          raw: sql`excluded.raw`,
          sourceRunId: sql`excluded.source_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  const dividendValues = dividendRecords.flatMap((record, index) => {
    const attrs = record.attributes;
    const providerAccountId =
      firstString(attrs, ["accountId", "account", "acctId"]) ?? "UNKNOWN";
    const amount = firstNumber(attrs, ["amount", "proceeds", "value"]);
    const paidDate =
      parseDate(firstString(attrs, ["dateTime", "date", "reportDate"])) ?? null;

    if (amount === null || !paidDate) {
      return [];
    }

    const symbol = normalizeSymbol(firstString(attrs, ["symbol"]) ?? "");
    const dividendId =
      firstString(attrs, ["transactionID", "transactionId", "id"]) ??
      `${providerAccountId}:${symbol || "CASH"}:${paidDate.toISOString()}:${amount}:${index}`;

    return [
      {
        providerAccountId,
        dividendId,
        symbol: symbol || null,
        description: firstString(attrs, ["description"]),
        amount: String(amount),
        currency: firstString(attrs, ["currency"]) ?? "USD",
        paidDate,
        exDate:
          parseDate(firstString(attrs, ["exDate"])) ? formatDateOnly(parseDate(firstString(attrs, ["exDate"])) as Date) : null,
        sourceRunId: runId,
        raw: attrs,
      },
    ];
  });

  if (dividendValues.length) {
    await db
      .insert(flexDividendsTable)
      .values(dividendValues)
      .onConflictDoUpdate({
        target: [
          flexDividendsTable.providerAccountId,
          flexDividendsTable.dividendId,
        ],
        set: {
          amount: sql`excluded.amount`,
          raw: sql`excluded.raw`,
          sourceRunId: sql`excluded.source_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  const openPositionValues = openPositionRecords.flatMap((record) => {
    const attrs = record.attributes;
    const providerAccountId =
      firstString(attrs, ["accountId", "account", "acctId"]) ?? "UNKNOWN";
    const symbol =
      normalizeSymbol(firstString(attrs, ["symbol", "underlyingSymbol"]) ?? "") ||
      "UNKNOWN";
    const quantity = firstNumber(attrs, ["quantity", "qty", "position"]);
    const asOf =
      parseDate(firstString(attrs, ["reportDate", "date", "asOfDate"])) ??
      new Date();

    if (quantity === null) {
      return [];
    }

    return [
      {
        providerAccountId,
        symbol,
        description: firstString(attrs, ["description"]),
        assetClass:
          firstString(attrs, ["assetCategory", "assetClass", "secType"]) ??
          "stock",
        quantity: String(quantity),
        costBasis: numericString(
          firstNumber(attrs, ["costBasisMoney", "costBasis", "cost"]),
        ),
        marketValue: numericString(
          firstNumber(attrs, ["marketValue", "positionValue", "value"]),
        ),
        currency: firstString(attrs, ["currency"]) ?? "USD",
        asOf,
        sourceRunId: runId,
        raw: attrs,
      },
    ];
  });

  if (openPositionValues.length) {
    await db
      .insert(flexOpenPositionsTable)
      .values(openPositionValues)
      .onConflictDoUpdate({
        target: [
          flexOpenPositionsTable.providerAccountId,
          flexOpenPositionsTable.symbol,
          flexOpenPositionsTable.asOf,
        ],
        set: {
          quantity: sql`excluded.quantity`,
          costBasis: sql`excluded.cost_basis`,
          marketValue: sql`excluded.market_value`,
          raw: sql`excluded.raw`,
          sourceRunId: sql`excluded.source_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  return {
    navRows: mergedNavValues.length,
    trades: tradeValues.length,
    cashActivities: cashValues.length,
    dividends: dividendValues.length,
    openPositions: openPositionValues.length,
  };
}

export async function refreshFlexReport(reason = "scheduled"): Promise<{
  ok: boolean;
  runId: string;
  referenceCode: string;
  counts: Awaited<ReturnType<typeof upsertFlexReport>>;
}> {
  const configs = getFlexConfigs();
  if (!configs?.length) {
    throw new HttpError(503, "IBKR Flex is not configured.", {
      code: "ibkr_flex_not_configured",
      detail: "Set IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID.",
      expose: true,
    });
  }

  await ensureFlexStorageTablesAvailable();
  const totalCounts: Awaited<ReturnType<typeof upsertFlexReport>> = {
    navRows: 0,
    trades: 0,
    cashActivities: 0,
    dividends: 0,
    openPositions: 0,
  };
  let primaryRunId: string | null = null;
  let primaryReferenceCode: string | null = null;
  const windows = buildFlexBackfillWindows(reason);

  for (const config of configs) {
    for (const window of windows) {
      const [run] = await db
        .insert(flexReportRunsTable)
        .values({
          queryId: config.queryId,
          status: "requested",
          metadata: {
            reason,
            queryIds: configs.map((entry) => entry.queryId),
            window,
          },
        })
        .returning({ id: flexReportRunsTable.id });

      try {
        const reference = await requestFlexReference({
          ...config,
          fromDate: window.fromDate,
          toDate: window.toDate,
        });
        await db
          .update(flexReportRunsTable)
          .set({
            referenceCode: reference.referenceCode,
            status: "polling",
            rawXml: reference.rawXml,
            updatedAt: new Date(),
          })
          .where(eq(flexReportRunsTable.id, run.id));

        const xml = await downloadFlexStatement({
          token: config.token,
          referenceCode: reference.referenceCode,
          statementUrl: reference.statementUrl,
        });
        const counts = await upsertFlexReport(xml, run.id);

        totalCounts.navRows += counts.navRows;
        totalCounts.trades += counts.trades;
        totalCounts.cashActivities += counts.cashActivities;
        totalCounts.dividends += counts.dividends;
        totalCounts.openPositions += counts.openPositions;

        await db
          .update(flexReportRunsTable)
          .set({
            status: "completed",
            completedAt: new Date(),
            rawXml: xml,
            metadata: {
              reason,
              queryIds: configs.map((entry) => entry.queryId),
              window,
              counts,
              totalCounts,
            },
            updatedAt: new Date(),
          })
          .where(eq(flexReportRunsTable.id, run.id));

        primaryRunId ??= run.id;
        primaryReferenceCode ??= reference.referenceCode;
      } catch (error) {
        await db
          .update(flexReportRunsTable)
          .set({
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(flexReportRunsTable.id, run.id));
        throw error;
      }
    }
  }

  return {
    ok: true,
    runId: primaryRunId ?? "",
    referenceCode: primaryReferenceCode ?? "",
    counts: totalCounts,
  };
}

async function flexTablesHaveRows(): Promise<boolean> {
  const [navRows, tradeRows, cashRows, dividendRows, positionRows] = await Promise.all([
    db.select({ id: flexNavHistoryTable.id }).from(flexNavHistoryTable).limit(1),
    db.select({ id: flexTradesTable.id }).from(flexTradesTable).limit(1),
    db.select({ id: flexCashActivityTable.id }).from(flexCashActivityTable).limit(1),
    db.select({ id: flexDividendsTable.id }).from(flexDividendsTable).limit(1),
    db.select({ id: flexOpenPositionsTable.id }).from(flexOpenPositionsTable).limit(1),
  ]);

  return Boolean(
    navRows.length ||
      tradeRows.length ||
      cashRows.length ||
      dividendRows.length ||
      positionRows.length,
  );
}

async function shouldRunInitialFlexRefresh(): Promise<boolean> {
  const schema = await getOptionalAccountSchemaReadiness();
  if (schema.missingTables.length || schema.schemaError) {
    return false;
  }

  const [activeRun] = await db
    .select({ id: flexReportRunsTable.id })
    .from(flexReportRunsTable)
    .where(sql`${flexReportRunsTable.status} in ('requested', 'polling')`)
    .limit(1);
  if (activeRun) {
    return false;
  }

  return !(await flexTablesHaveRows());
}

export function startAccountFlexRefreshScheduler(): void {
  if (!flexConfigured()) {
    logger.info("IBKR Flex env vars are not configured; daily Flex refresh disabled");
    return;
  }

  setTimeout(() => {
    shouldRunInitialFlexRefresh()
      .then((shouldRun) =>
        shouldRun ? refreshFlexReport("scheduled-initial") : null,
      )
      .catch((error) => {
        logger.warn({ err: error }, "Initial IBKR Flex refresh failed");
      });
  }, 0).unref?.();

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(7, 0, 0, 0);
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    const timeout = next.getTime() - now.getTime();
    const timer = setTimeout(() => {
      refreshFlexReport("scheduled")
        .catch((error) => {
          logger.warn({ err: error }, "Scheduled IBKR Flex refresh failed");
        })
        .finally(scheduleNext);
    }, timeout);
    timer.unref?.();
  };

  scheduleNext();
}

type AccountSnapshotPersistenceLogger = {
  warn: (payload: unknown, message: string) => void;
};

type AccountSnapshotPersistenceOptions = {
  nowMs?: () => number;
  logger?: AccountSnapshotPersistenceLogger;
  persistSnapshots?: (accounts: BrokerAccountSnapshot[]) => Promise<void>;
  backoff?: ReturnType<typeof createTransientPostgresBackoff>;
};

async function persistAccountSnapshotsToDb(
  accounts: BrokerAccountSnapshot[],
): Promise<void> {
  const mode = accounts[0]?.mode ?? getRuntimeMode();
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      name: "Interactive Brokers Bridge",
      connectionType: "broker",
      brokerProvider: "ibkr",
      mode,
      status: "connected",
      capabilities: ["accounts", "positions", "orders", "executions"],
      isDefault: true,
    })
    .onConflictDoUpdate({
      target: [
        brokerConnectionsTable.connectionType,
        brokerConnectionsTable.mode,
        brokerConnectionsTable.name,
      ],
      set: {
        status: "connected",
        updatedAt: new Date(),
      },
    })
    .returning({ id: brokerConnectionsTable.id });

  for (const account of accounts) {
    const [brokerAccount] = await db
      .insert(brokerAccountsTable)
      .values({
        connectionId: connection.id,
        providerAccountId: account.providerAccountId,
        displayName: account.displayName,
        mode: account.mode,
        baseCurrency: account.currency,
        lastSyncedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: brokerAccountsTable.providerAccountId,
        set: {
          displayName: account.displayName,
          mode: account.mode,
          baseCurrency: account.currency,
          lastSyncedAt: new Date().toISOString(),
          updatedAt: new Date(),
        },
      })
      .returning({ id: brokerAccountsTable.id });

    await db.insert(balanceSnapshotsTable).values({
      accountId: brokerAccount.id,
      currency: account.currency,
      cash: String(account.cash),
      buyingPower: String(account.buyingPower),
      netLiquidation: String(account.netLiquidation),
      maintenanceMargin:
        account.maintenanceMargin === null || account.maintenanceMargin === undefined
          ? null
          : String(account.maintenanceMargin),
      asOf: account.updatedAt ?? new Date(),
    });
  }
}

export async function recordAccountSnapshots(
  accounts: BrokerAccountSnapshot[],
  options: AccountSnapshotPersistenceOptions = {},
): Promise<void> {
  const now = options.nowMs?.() ?? Date.now();
  const backoff = options.backoff ?? accountSnapshotPersistenceBackoff;
  if (backoff.isActive(now)) {
    return;
  }

  const dueAccounts = accounts.filter((account) => {
    const last = snapshotWriteTimestamps.get(account.id) ?? 0;
    return now - last >= SNAPSHOT_WRITE_INTERVAL_MS;
  });

  if (!dueAccounts.length) {
    return;
  }

  const persistableDueAccounts = dueAccounts.filter(
    (account) => !isPlaceholderZeroAccountSnapshot(account),
  );
  dueAccounts
    .filter((account) => isPlaceholderZeroAccountSnapshot(account))
    .forEach((account) => snapshotWriteTimestamps.set(account.id, now));

  if (!persistableDueAccounts.length) {
    return;
  }

  try {
    await (options.persistSnapshots ?? persistAccountSnapshotsToDb)(
      persistableDueAccounts,
    );
    backoff.clear();
  } catch (error) {
    if (isTransientPostgresError(error)) {
      backoff.markFailure({
        error,
        logger: options.logger ?? logger,
        message:
          "Account snapshot persistence database unavailable; pausing snapshot writes",
        nowMs: now,
      });
      return;
    }
    throw error;
  }

  for (const account of persistableDueAccounts) {
    snapshotWriteTimestamps.set(account.id, now);
  }
}

type ListAccountsOptions = {
  listLiveAccounts?: (mode: RuntimeMode) => Promise<BrokerAccountSnapshot[]>;
  getPersistedAccounts?: (
    requestedAccountId: string,
    mode: RuntimeMode,
  ) => Promise<{
    accounts: BrokerAccountSnapshot[];
    latestSnapshotAt: Date | null;
  }>;
  getFlexAccounts?: (
    requestedAccountId: string,
    mode: RuntimeMode,
  ) => Promise<BrokerAccountSnapshot[]>;
  recordSnapshots?: (accounts: BrokerAccountSnapshot[]) => Promise<void>;
};

export async function listAccounts(
  input: { mode?: RuntimeMode },
  options: ListAccountsOptions = {},
) {
  const mode = input.mode ?? getRuntimeMode();
  const listLiveAccounts = options.listLiveAccounts ?? listIbkrAccounts;
  const getPersistedAccounts =
    options.getPersistedAccounts ?? getPersistedBackedAccounts;
  const getFlexAccounts = options.getFlexAccounts ?? getFlexBackedAccounts;
  const recordSnapshots = options.recordSnapshots ?? recordAccountSnapshots;

  try {
    const liveAccounts = await listLiveAccounts(mode);
    if (liveAccounts.length) {
      void recordSnapshots(liveAccounts).catch((error) => {
        logger.warn(
          { err: error },
          "Account snapshot persistence failed after live account list",
        );
      });
      return { accounts: liveAccounts };
    }
  } catch {
    // A stale or unavailable bridge should not prevent persisted account views.
  }

  const persistedAccounts = await withAccountSnapshotReadFallback({
    message:
      "Account snapshot database unavailable; returning account list without persisted fallback",
    fallback: () => ({ accounts: [], latestSnapshotAt: null }),
    run: () => getPersistedAccounts(COMBINED_ACCOUNT_ID, mode),
  });
  if (persistedAccounts.accounts.length) {
    return { accounts: persistedAccounts.accounts };
  }

  const flexAccounts = await getFlexAccounts(COMBINED_ACCOUNT_ID, mode);
  if (flexAccounts.length) {
    return { accounts: flexAccounts };
  }

  return { accounts: [] };
}

export async function getAccountSummary(input: {
  accountId: string;
  mode?: RuntimeMode;
}) {
  if (isShadowAccountId(input.accountId)) {
    return (await fetchShadowAccountSnapshotBase()).summary;
  }

  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const positions = await listPositionsForUniverse(universe, mode);
  const marketHydration = await hydratePositionMarkets(positions);
  const updatedAt = accountMetricUpdatedAt(universe.accounts) ?? new Date();
  const currency = universe.primaryCurrency;
  const nav = sumAccounts(universe.accounts, "netLiquidation") ?? 0;
  const marginSnapshot = buildAccountMarginSnapshot(universe.accounts);
  const initialNav = await getInitialFlexNav(universe.accountIds);
  const totalPnl = initialNav === null ? null : nav - initialNav;

  const dayPnl = positions.reduce(
    (sum, position) => sum + (marketHydration.get(position.id)?.dayChange ?? 0),
    0,
  );

  const accountTypes = Array.from(
    new Set(
      universe.accounts
        .map((account) => account.accountType || inferAccountType(account.id))
        .filter(Boolean),
    ),
  );
  const remainingDayTrades = universe.accounts
    .map((account) => account.dayTradesRemaining)
    .filter((value): value is number => isFiniteNumber(value));

  return {
    accountId: universe.requestedAccountId,
    isCombined: universe.isCombined,
    mode,
    currency,
    accounts: universe.accounts.map((account) => ({
      id: account.id,
      displayName: account.displayName,
      currency: account.currency,
      live: true,
      accountType: account.accountType || inferAccountType(account.id),
      updatedAt: account.updatedAt,
    })),
    updatedAt,
    fx: {
      baseCurrency: currency,
      timestamp: updatedAt,
      rates: Object.fromEntries(
        Array.from(new Set(universe.accounts.map((account) => account.currency))).map(
          (accountCurrency) => [accountCurrency, accountCurrency === currency ? 1 : null],
        ),
      ),
      warning:
        new Set(universe.accounts.map((account) => account.currency)).size > 1
          ? "Multiple account currencies detected; non-base conversion requires a bridge FX quote feed."
          : null,
    },
    badges: {
      accountTypes,
      pdt: {
        isPatternDayTrader:
          universe.accounts.some((account) => account.isPatternDayTrader === true) ||
          null,
        dayTradesRemainingThisWeek: remainingDayTrades.length
          ? Math.min(...remainingDayTrades)
          : null,
      },
    },
    metrics: {
      netLiquidation: metric(
        nav,
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "NetLiquidation",
        updatedAt,
      ),
      totalCash: metric(
        sumAccounts(universe.accounts, "totalCashValue") ??
          sumAccounts(universe.accounts, "cash"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "TotalCashValue",
        updatedAt,
      ),
      buyingPower: metric(
        sumAccounts(universe.accounts, "buyingPower"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "BuyingPower",
        updatedAt,
      ),
      marginUsed: metric(
        marginSnapshot.marginUsed,
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        marginSnapshot.providerFields.marginUsed,
        updatedAt,
      ),
      maintenanceMargin: metric(
        marginSnapshot.maintenanceMargin,
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        marginSnapshot.providerFields.maintenanceMargin,
        updatedAt,
      ),
      maintenanceMarginCushionPercent: metric(
        marginSnapshot.maintenanceCushionPercent,
        null,
        "IBKR_ACCOUNT_SUMMARY",
        "Cushion",
        updatedAt,
      ),
      dayPnl: metric(dayPnl, currency, "IBKR_POSITIONS", "QuoteChange", updatedAt),
      dayPnlPercent: metric(
        nav ? (dayPnl / nav) * 100 : null,
        null,
        "IBKR_POSITIONS",
        "QuoteChange/NetLiquidation",
        updatedAt,
      ),
      totalPnl: metric(totalPnl, currency, "FLEX", "ChangeInNAV", updatedAt),
      totalPnlPercent: metric(
        initialNav && totalPnl !== null ? (totalPnl / initialNav) * 100 : null,
        null,
        "FLEX",
        "ChangeInNAV/InitialNAV",
        updatedAt,
      ),
      settledCash: metric(
        sumAccounts(universe.accounts, "settledCash"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "SettledCash",
        updatedAt,
      ),
      unsettledCash: metric(
        null,
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "UnsettledCash",
        updatedAt,
      ),
      sma: metric(
        sumAccounts(universe.accounts, "sma"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "SMA",
        updatedAt,
      ),
      dayTradingBuyingPower: metric(
        sumAccounts(universe.accounts, "dayTradingBuyingPower"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "DayTradingBuyingPower",
        updatedAt,
      ),
      regTInitialMargin: metric(
        sumAccounts(universe.accounts, "regTInitialMargin"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "RegTMargin",
        updatedAt,
      ),
      leverage: metric(
        weightedAccountAverage(universe.accounts, "leverage"),
        null,
        "IBKR_ACCOUNT_SUMMARY",
        "Leverage",
        updatedAt,
      ),
      grossPositionValue: metric(
        sumAccounts(universe.accounts, "grossPositionValue") ??
          positions.reduce(
            (sum, position) =>
              sum + Math.abs(hydratedPositionMarketValue(position, marketHydration)),
            0,
          ),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "GrossPositionValue",
        updatedAt,
      ),
    },
  };
}

async function getInitialFlexNav(accountIds: string[]): Promise<number | null> {
  if (!accountIds.length) {
    return null;
  }

  const rows = await withOptionalAccountSchemaFallback({
    tables: ["flex_nav_history"],
    fallback: () => [],
    run: async () =>
      db
        .select({
          providerAccountId: flexNavHistoryTable.providerAccountId,
          statementDate: flexNavHistoryTable.statementDate,
          netAssetValue: flexNavHistoryTable.netAssetValue,
        })
        .from(flexNavHistoryTable)
        .where(inArray(flexNavHistoryTable.providerAccountId, accountIds))
        .orderBy(flexNavHistoryTable.statementDate)
        .limit(accountIds.length),
  });

  const values = rows
    .map((row) => toNumber(row.netAssetValue))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

async function resolveBenchmarkPercents(input: {
  benchmark: string | null | undefined;
  range: AccountRange;
  start: Date | null;
  points: Array<{ timestamp: Date; benchmarkPercent: number | null }>;
}): Promise<Array<number | null>> {
  if (!input.benchmark || input.points.length < 2) {
    return input.points.map(() => null);
  }

  try {
    const bars = await getBars({
      symbol: input.benchmark,
      timeframe: accountBenchmarkTimeframeForRange(input.range),
      from:
        input.start ??
        input.points[0]?.timestamp ??
        new Date(Date.now() - 365 * 86_400_000),
      to: input.points[input.points.length - 1]?.timestamp ?? new Date(),
      limit: accountBenchmarkLimitForRange(input.range),
      outsideRth: true,
      allowHistoricalSynthesis: true,
    });

    if (!bars.bars.length) {
      return input.points.map(() => null);
    }

    const sortedBars = [...bars.bars].sort(
      (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
    );
    const base = sortedBars[0]?.close;
    if (!isFiniteNumber(base) || base === 0) {
      return input.points.map(() => null);
    }

    let cursor = 0;
    return input.points.map((point) => {
      while (
        cursor + 1 < sortedBars.length &&
        sortedBars[cursor + 1]!.timestamp.getTime() <= point.timestamp.getTime()
      ) {
        cursor += 1;
      }

      const bar = sortedBars[cursor];
      return isFiniteNumber(bar?.close) ? ((bar.close - base) / base) * 100 : null;
    });
  } catch (error) {
    logger.debug?.(
      { err: error, benchmark: input.benchmark },
      "Account benchmark overlay unavailable",
    );
    return input.points.map(() => null);
  }
}

export async function getAccountEquityHistory(input: {
  accountId: string;
  range?: AccountRange;
  benchmark?: string | null;
  mode?: RuntimeMode;
}) {
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountEquityHistory({
      range: input.range,
      benchmark: input.benchmark,
    });
  }

  const mode = input.mode ?? getRuntimeMode();
  const range = normalizeAccountRange(input.range);
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const start = accountRangeStart(range);
  const flexConditions = [inArray(flexNavHistoryTable.providerAccountId, universe.accountIds)];
  if (start) {
    flexConditions.push(
      gte(flexNavHistoryTable.statementDate, formatDateOnly(start)),
    );
  }

  const flexRows = await withOptionalAccountSchemaFallback({
    tables: ["flex_nav_history"],
    fallback: () => [],
    run: async () =>
      db
        .select()
        .from(flexNavHistoryTable)
        .where(and(...flexConditions))
        .orderBy(flexNavHistoryTable.statementDate),
  });
  const flexCashConditions = [
    inArray(flexCashActivityTable.providerAccountId, universe.accountIds),
  ];
  if (start) {
    flexCashConditions.push(gte(flexCashActivityTable.activityDate, start));
  }
  const flexCashRows = await withOptionalAccountSchemaFallback({
    tables: ["flex_cash_activity"],
    fallback: () => [],
    run: async () =>
      db
        .select()
        .from(flexCashActivityTable)
        .where(and(...flexCashConditions))
        .orderBy(flexCashActivityTable.activityDate),
  });

  const snapshotConditions = [
    inArray(brokerAccountsTable.providerAccountId, universe.accountIds),
  ];
  if (start) {
    snapshotConditions.push(gte(balanceSnapshotsTable.asOf, start));
  }

  const rawSnapshotRows = await withAccountSnapshotReadFallback({
    fallback: () => [],
    message:
      "Account equity snapshot database unavailable; using live account point only",
    run: async () =>
      db
        .select({
          providerAccountId: brokerAccountsTable.providerAccountId,
          asOf: balanceSnapshotsTable.asOf,
          currency: balanceSnapshotsTable.currency,
          netLiquidation: balanceSnapshotsTable.netLiquidation,
          cash: balanceSnapshotsTable.cash,
          buyingPower: balanceSnapshotsTable.buyingPower,
        })
        .from(balanceSnapshotsTable)
        .innerJoin(
          brokerAccountsTable,
          eq(balanceSnapshotsTable.accountId, brokerAccountsTable.id),
        )
        .where(and(...snapshotConditions))
        .orderBy(balanceSnapshotsTable.asOf),
  });
  const snapshotRows = compactEquitySnapshotRows(
    filterPlaceholderZeroEquitySnapshotRows(rawSnapshotRows),
    range,
  );

  const byTimestamp = new Map<string, AccountEquityHistorySeedPoint>();

  flexRows.forEach((row) => {
    const timestamp = dateFromDateOnly(row.statementDate);
    const key = timestamp.toISOString();
    const current = byTimestamp.get(key);
    const netLiquidation = toNumber(row.netAssetValue) ?? 0;
    const deposits = toNumber(row.deposits) ?? 0;
    const withdrawals = toNumber(row.withdrawals) ?? 0;
    const dividends = toNumber(row.dividends) ?? 0;
    const fees = toNumber(row.fees) ?? 0;
    byTimestamp.set(key, {
      timestamp,
      netLiquidation: (current?.netLiquidation ?? 0) + netLiquidation,
      currency: row.currency,
      source: "FLEX",
      deposits: (current?.deposits ?? 0) + deposits,
      withdrawals: (current?.withdrawals ?? 0) + withdrawals,
      dividends: (current?.dividends ?? 0) + dividends,
      fees: (current?.fees ?? 0) + fees,
    });
  });

  const flexTransferDates = new Set<string>();
  const flexRowsHaveExternalTransfers = flexRows.some(
    (row) =>
      Math.abs(toNumber(row.deposits) ?? 0) > 0 ||
      Math.abs(toNumber(row.withdrawals) ?? 0) > 0,
  );
  flexRows.forEach((row) => {
    if (
      Math.abs(toNumber(row.deposits) ?? 0) > 0 ||
      Math.abs(toNumber(row.withdrawals) ?? 0) > 0
    ) {
      flexTransferDates.add(row.statementDate);
    }
  });
  if (!flexRowsHaveExternalTransfers) {
    const cashTransfersByDate = new Map<
      string,
      { deposits: number; withdrawals: number }
    >();
    flexCashRows.forEach((row) => {
      const transfer = classifyExternalCashTransfer(row);
      if (transfer === null) {
        return;
      }
      const key = dateFromDateOnly(formatDateOnly(row.activityDate)).toISOString();
      const current = cashTransfersByDate.get(key) ?? {
        deposits: 0,
        withdrawals: 0,
      };
      if (transfer > 0) {
        current.deposits += transfer;
      } else {
        current.withdrawals += Math.abs(transfer);
      }
      cashTransfersByDate.set(key, current);
    });

    cashTransfersByDate.forEach((transfer, key) => {
      const current = byTimestamp.get(key);
      if (!current) {
        return;
      }
      byTimestamp.set(key, {
        ...current,
        deposits: transfer.deposits,
        withdrawals: transfer.withdrawals,
      });
    });
  }

  const transferSafeSnapshotRows = filterSnapshotsOnFlexTransferDates(
    snapshotRows,
    flexTransferDates,
  );

  transferSafeSnapshotRows.forEach((row) => {
    const key = row.asOf.toISOString();
    const current = byTimestamp.get(key);
    if (current?.source === "FLEX") {
      return;
    }
    byTimestamp.set(key, {
      timestamp: row.asOf,
      netLiquidation:
        (current?.netLiquidation ?? 0) + (toNumber(row.netLiquidation) ?? 0),
      currency: row.currency,
      source: "LOCAL_LEDGER",
      deposits: current?.deposits ?? 0,
      withdrawals: current?.withdrawals ?? 0,
      dividends: current?.dividends ?? 0,
      fees: current?.fees ?? 0,
    });
  });

  const liveEquityAccounts =
    universe.source === "live"
      ? universe.accounts.filter(
          (account) => !isPlaceholderZeroAccountSnapshot(account),
        )
      : [];
  const currentNetLiquidation =
    universe.source === "live"
      ? sumAccounts(liveEquityAccounts, "netLiquidation")
      : null;
  const currentTimestamp =
    accountMetricUpdatedAt(liveEquityAccounts) ?? new Date();
  const liveTerminalIncluded =
    currentNetLiquidation !== null &&
    (!start || currentTimestamp.getTime() >= start.getTime());
  if (
    currentNetLiquidation !== null &&
    (!start || currentTimestamp.getTime() >= start.getTime())
  ) {
    const key = currentTimestamp.toISOString();
    const current = byTimestamp.get(key);
    byTimestamp.set(key, {
      timestamp: currentTimestamp,
      netLiquidation: currentNetLiquidation,
      currency: universe.primaryCurrency,
      source: "IBKR_ACCOUNT_SUMMARY",
      deposits: current?.deposits ?? 0,
      withdrawals: current?.withdrawals ?? 0,
      dividends: current?.dividends ?? 0,
      fees: current?.fees ?? 0,
    });
  }

  const sortedSeedPoints = trimLeadingInactiveEquityPoints(
    Array.from(byTimestamp.values())
      .filter((point) => !start || point.timestamp.getTime() >= start.getTime())
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
  );
  const adjustedSeedPoints =
    calculateTransferAdjustedReturnPoints(sortedSeedPoints);

  const points = adjustedSeedPoints.map((point) => {
      return {
        timestamp: point.timestamp,
        netLiquidation: point.netLiquidation,
        currency: point.currency,
        source: point.source,
        deposits: point.deposits,
        withdrawals: point.withdrawals,
        dividends: point.dividends,
        fees: point.fees,
        returnPercent: point.returnPercent,
        benchmarkPercent: null,
      };
    });
  const benchmarkPercents = await resolveBenchmarkPercents({
    benchmark: input.benchmark,
    range,
    start,
    points,
  });
  const pointsWithBenchmark = points.map((point, index) => ({
    ...point,
    benchmarkPercent: benchmarkPercents[index] ?? null,
  }));
  const latestSnapshotAt =
    rawSnapshotRows.reduce<Date | null>((latest, row) => {
      if (!latest || row.asOf.getTime() > latest.getTime()) {
        return row.asOf;
      }
      return latest;
    }, universe.latestSnapshotAt) ?? null;
  const lastPoint = pointsWithBenchmark[pointsWithBenchmark.length - 1] ?? null;
  const terminalPointSource = liveTerminalIncluded
    ? "live_account_summary"
    : lastPoint?.source === "LOCAL_LEDGER"
      ? "persisted_snapshot"
      : lastPoint?.source === "FLEX"
        ? "flex"
        : lastPoint?.source === "SHADOW_LEDGER"
          ? "shadow_ledger"
          : null;

  const lastRun = await withOptionalAccountSchemaFallback({
    tables: ["flex_report_runs"],
    fallback: () => null,
    run: async () => {
      const [row] = await db
        .select()
        .from(flexReportRunsTable)
        .orderBy(desc(flexReportRunsTable.requestedAt))
        .limit(1);
      return row ?? null;
    },
  });

  return {
    accountId: universe.requestedAccountId,
    range,
    currency: universe.primaryCurrency,
    flexConfigured: flexConfigured(),
    lastFlexRefreshAt: lastRun?.completedAt ?? null,
    benchmark: input.benchmark || null,
    asOf: lastPoint?.timestamp ?? null,
    latestSnapshotAt,
    isStale: universe.source !== "live",
    staleReason: universe.staleReason,
    terminalPointSource,
    liveTerminalIncluded,
    points: pointsWithBenchmark,
    events: pointsWithBenchmark
      .filter(
        (point) =>
          Math.abs(point.deposits) > 0 ||
          Math.abs(point.withdrawals) > 0 ||
          Math.abs(point.dividends) > 0,
      )
      .map((point) => ({
        timestamp: point.timestamp,
        type:
          Math.abs(point.dividends) > 0
            ? "dividend"
            : point.deposits >= Math.abs(point.withdrawals)
              ? "deposit"
              : "withdrawal",
        amount:
          point.dividends || point.deposits || point.withdrawals * -1 || 0,
        currency: point.currency,
        source: "FLEX",
      })),
  };
}

export async function getAccountAllocation(input: {
  accountId: string;
  mode?: RuntimeMode;
}) {
  if (isShadowAccountId(input.accountId)) {
    return (await fetchShadowAccountSnapshotBase()).allocation;
  }

  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const positions = await listPositionsForUniverse(universe, mode);
  const marketHydration = await hydratePositionMarkets(positions);
  const nav = sumAccounts(universe.accounts, "netLiquidation") ?? 0;

  await upsertTickerReferenceCache(positions);

  const assetBuckets = new Map<string, number>();
  const sectorBuckets = new Map<string, number>();
  positions.forEach((position) => {
    const assetClass = normalizeAssetClassLabel(position);
    const sector = sectorForSymbol(positionReferenceSymbol(position));
    const allocationValue = hydratedPositionMarketValue(position, marketHydration);
    assetBuckets.set(assetClass, (assetBuckets.get(assetClass) ?? 0) + allocationValue);
    sectorBuckets.set(sector, (sectorBuckets.get(sector) ?? 0) + allocationValue);
  });

  const cash = sumAccounts(universe.accounts, "cash") ?? 0;
  assetBuckets.set("Cash", (assetBuckets.get("Cash") ?? 0) + cash);

  const bucketRows = (buckets: Map<string, number>) =>
    Array.from(buckets.entries())
      .map(([label, value]) => ({
        label,
        value,
        weightPercent: weightPercent(value, nav),
        source: label === "Cash" ? "IBKR_ACCOUNT_SUMMARY" : "IBKR_POSITIONS",
      }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    assetClass: bucketRows(assetBuckets),
    sector: bucketRows(sectorBuckets),
    exposure: exposureSummary(positions, (position) =>
      hydratedPositionMarketValue(position, marketHydration),
    ),
    updatedAt: accountMetricUpdatedAt(universe.accounts) ?? new Date(),
  };
}

async function upsertTickerReferenceCache(
  positions: BrokerPositionSnapshot[],
): Promise<void> {
  const symbols = Array.from(
    new Set(positions.map((position) => positionReferenceSymbol(position))),
  );
  if (!symbols.length) {
    return;
  }

  await withOptionalAccountSchemaFallback({
    tables: ["ticker_reference_cache"],
    fallback: () => undefined,
    run: async () => {
      for (const symbol of symbols) {
        await db
          .insert(tickerReferenceCacheTable)
          .values({
            symbol,
            name: symbol,
            assetClass: isEtfSymbol(symbol) ? "ETF" : "Stock",
            sector: sectorForSymbol(symbol),
            beta: String(betaForSymbol(symbol)),
            raw: { source: "static-fallback" },
          })
          .onConflictDoNothing();
      }
    },
  });
}

export async function getAccountPositions(input: {
  accountId: string;
  assetClass?: string | null;
  mode?: RuntimeMode;
}) {
  if (isShadowAccountId(input.accountId)) {
    const positionsResponse = (await fetchShadowAccountSnapshotBase()).positions;
    if (!input.assetClass || input.assetClass === "all") {
      return positionsResponse;
    }
    return {
      ...positionsResponse,
      positions: positionsResponse.positions.filter(
        (position) =>
          String(position.assetClass || "").toLowerCase() ===
          input.assetClass?.toLowerCase(),
      ),
    };
  }

  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const positionsPromise = listPositionsForUniverse(universe, mode);
  const [positions, ordersResult, lots, greekEnrichment] = await Promise.all([
    positionsPromise,
    listOrdersForUniverse(universe, mode),
    getPositionLots(universe.accountIds),
    positionsPromise.then((result) => enrichPositionGreeks(result)),
  ]);
  const marketHydration = await hydratePositionMarkets(positions);
  const orders = ordersResult.orders;
  const nav = sumAccounts(universe.accounts, "netLiquidation") ?? 0;
  const filteredPositions =
    input.assetClass && input.assetClass !== "all"
      ? positions.filter(
          (position) =>
            normalizeAssetClassLabel(position).toLowerCase() ===
            input.assetClass?.toLowerCase(),
        )
      : positions;

  const openOrdersBySymbol = new Map<string, BrokerOrderSnapshot[]>();
  orders.filter((order) => workingOrderStatus(order.status)).forEach((order) => {
    const key = order.symbol.toUpperCase();
    openOrdersBySymbol.set(key, [...(openOrdersBySymbol.get(key) ?? []), order]);
  });

  const lotRowsBySymbol = new Map<string, typeof lots>();
  lots.forEach((lot) => {
    const key = lot.symbol.toUpperCase();
    lotRowsBySymbol.set(key, [...(lotRowsBySymbol.get(key) ?? []), lot]);
  });

  type AggregatedPositionRow = {
    id: string;
    accountId: string;
    accounts: string[];
    symbol: string;
    description: string;
    assetClass: string;
    optionContract: BrokerPositionSnapshot["optionContract"] | null;
    sector: string;
    quantity: number;
    averageCostAccumulator: number;
    markAccumulator: number;
    averageWeight: number;
    unrealizedWeight: number;
    dayChange: number | null;
    dayChangePercent: number | null;
    unrealizedPnl: number;
    unrealizedPnlPercentAccumulator: number;
    marketValue: number;
    betaWeightedDelta: number | null;
    lots: typeof lots;
    openOrders: BrokerOrderSnapshot[];
    source: "IBKR_POSITIONS";
  };

  const rows = universe.isCombined
    ? Array.from(
        filteredPositions.reduce((map, position) => {
          const key = positionGroupKey(position);
          const current = map.get(key) ?? {
            id: key,
            accountId: universe.requestedAccountId,
            accounts: [] as string[],
            symbol: position.symbol,
            description: position.optionContract
              ? `${position.optionContract.underlying} ${formatDateOnly(position.optionContract.expirationDate)} ${position.optionContract.strike} ${position.optionContract.right}`
              : position.symbol,
            assetClass: normalizeAssetClassLabel(position),
            optionContract: position.optionContract ?? null,
            sector: sectorForSymbol(positionReferenceSymbol(position)),
            quantity: 0,
            averageCostAccumulator: 0,
            markAccumulator: 0,
            averageWeight: 0,
            unrealizedWeight: 0,
            dayChange: null as number | null,
            dayChangePercent: null as number | null,
            unrealizedPnl: 0,
            unrealizedPnlPercentAccumulator: 0,
            marketValue: 0,
            betaWeightedDelta: null as number | null,
            lots: [] as typeof lots,
            openOrders: [] as BrokerOrderSnapshot[],
            source: "IBKR_POSITIONS" as const,
          };
          const greek = greekEnrichment.byPositionId.get(position.id);
          const quantityWeight = Math.abs(position.quantity);
          const hydratedMarket = marketHydration.get(position.id);
          const positionValue =
            hydratedMarket?.marketValue ?? positionSignedNotional(position);
          const positionMark =
            hydratedMarket?.mark ??
            (Math.abs(Number(position.marketPrice) || 0) > POSITION_QUANTITY_EPSILON
              ? position.marketPrice
              : position.averagePrice);
          const marketValueWeight = Math.abs(positionValue);

          current.quantity += position.quantity;
          current.averageCostAccumulator += position.averagePrice * quantityWeight;
          current.markAccumulator += positionMark * quantityWeight;
          current.averageWeight += quantityWeight;
          current.unrealizedWeight += marketValueWeight;
          current.dayChange = upsertNullableTotal(
            current.dayChange,
            hydratedMarket?.dayChange ?? null,
          );
          current.dayChangePercent = upsertNullableTotal(
            current.dayChangePercent,
            hydratedMarket?.dayChangePercent == null || marketValueWeight <= 0
              ? null
              : hydratedMarket.dayChangePercent * marketValueWeight,
          );
          current.unrealizedPnl += hydratedMarket?.unrealizedPnl ?? position.unrealizedPnl;
          current.unrealizedPnlPercentAccumulator +=
            (hydratedMarket?.unrealizedPnlPercent ?? position.unrealizedPnlPercent ?? 0) *
            marketValueWeight;
          current.marketValue += positionValue;
          current.betaWeightedDelta = upsertNullableTotal(
            current.betaWeightedDelta,
            greek?.betaWeightedDelta ?? null,
          );
          current.accounts = Array.from(
            new Set([...current.accounts, position.accountId]),
          );
          current.lots = [
            ...current.lots,
            ...(lotRowsBySymbol.get(position.symbol.toUpperCase()) ?? []),
          ];
          current.openOrders = [
            ...current.openOrders,
            ...(openOrdersBySymbol.get(position.symbol.toUpperCase()) ?? []),
          ].filter((order) => orderGroupKey(order) === key);
          map.set(key, current);
          return map;
        }, new Map<string, AggregatedPositionRow>()),
      ).map(([, row]) => ({
        id: row.id,
        accountId: row.accountId,
        accounts: row.accounts,
        symbol: row.symbol,
        description: row.description,
        assetClass: row.assetClass,
        optionContract: row.optionContract,
        sector: row.sector,
        quantity: row.quantity,
        averageCost:
          row.averageWeight > 0
            ? row.averageCostAccumulator / row.averageWeight
            : 0,
        mark: row.averageWeight > 0 ? row.markAccumulator / row.averageWeight : 0,
        dayChange: row.dayChange,
        dayChangePercent:
          row.unrealizedWeight > 0 && row.dayChangePercent !== null
            ? row.dayChangePercent / row.unrealizedWeight
            : null,
        unrealizedPnl: row.unrealizedPnl,
        unrealizedPnlPercent:
          row.unrealizedWeight > 0
            ? row.unrealizedPnlPercentAccumulator / row.unrealizedWeight
            : 0,
        marketValue: row.marketValue,
        weightPercent: weightPercent(row.marketValue, nav),
        betaWeightedDelta: row.betaWeightedDelta,
        lots: Array.from(
          row.lots.reduce((map: Map<string, (typeof lots)[number]>, lot: (typeof lots)[number]) => {
            map.set(
              `${lot.accountId}:${lot.symbol}:${lot.asOf.toISOString()}:${lot.quantity}:${lot.averageCost}`,
              lot,
            );
            return map;
          }, new Map<string, (typeof lots)[number]>()),
        )
          .map(([, lot]) => lot)
          .sort((left, right) => right.asOf.getTime() - left.asOf.getTime()),
        openOrders: Array.from(
          row.openOrders.reduce((map: Map<string, BrokerOrderSnapshot>, order: BrokerOrderSnapshot) => {
            map.set(order.id, order);
            return map;
          }, new Map<string, BrokerOrderSnapshot>()),
        )
          .map(([, order]) => order)
          .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()),
        source: row.source,
        sourceType: "manual" as const,
        strategyLabel: "Manual",
        attributionStatus: "unknown" as const,
        sourceAttribution: [],
      }))
    : filteredPositions.map((position) => {
        const hydratedMarket = marketHydration.get(position.id);
        const marketValue =
          hydratedMarket?.marketValue ?? positionSignedNotional(position);
        const mark =
          hydratedMarket?.mark ??
          (Math.abs(Number(position.marketPrice) || 0) > POSITION_QUANTITY_EPSILON
            ? position.marketPrice
            : position.averagePrice);
        const greek = greekEnrichment.byPositionId.get(position.id);
        const referenceSymbol = positionReferenceSymbol(position);
        return {
          id: position.id,
          accountId: position.accountId,
          accounts: [position.accountId],
          symbol: position.symbol,
          description: position.optionContract
            ? `${position.optionContract.underlying} ${formatDateOnly(position.optionContract.expirationDate)} ${position.optionContract.strike} ${position.optionContract.right}`
            : position.symbol,
          assetClass: normalizeAssetClassLabel(position),
          optionContract: position.optionContract ?? null,
          sector: sectorForSymbol(referenceSymbol),
          quantity: position.quantity,
          averageCost: position.averagePrice,
          mark,
          dayChange: hydratedMarket?.dayChange ?? null,
          dayChangePercent: hydratedMarket?.dayChangePercent ?? null,
          unrealizedPnl: hydratedMarket?.unrealizedPnl ?? position.unrealizedPnl,
          unrealizedPnlPercent:
            hydratedMarket?.unrealizedPnlPercent ?? position.unrealizedPnlPercent,
          marketValue,
          weightPercent: weightPercent(marketValue, nav),
          betaWeightedDelta: greek?.betaWeightedDelta ?? null,
          lots: lotRowsBySymbol.get(position.symbol.toUpperCase()) ?? [],
          openOrders:
            (openOrdersBySymbol.get(position.symbol.toUpperCase()) ?? []).filter(
              (order) => orderGroupKey(order) === positionGroupKey(position),
            ),
          source: "IBKR_POSITIONS",
          sourceType: "manual" as const,
          strategyLabel: "Manual",
          attributionStatus: "unknown" as const,
          sourceAttribution: [],
        };
      });

  const openRows = rows.filter((row) => Math.abs(Number(row.quantity)) > POSITION_QUANTITY_EPSILON);
  const exposure = exposureSummary(filteredPositions, (position) =>
    hydratedPositionMarketValue(position, marketHydration),
  );
  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    positions: openRows,
    totals: {
      weightPercent: openRows.reduce((sum, row) => sum + (row.weightPercent ?? 0), 0),
      unrealizedPnl: openRows.reduce((sum, row) => sum + row.unrealizedPnl, 0),
      grossLong: exposure.grossLong,
      grossShort: exposure.grossShort,
      netExposure: exposure.netExposure,
    },
    updatedAt: accountMetricUpdatedAt(universe.accounts) ?? new Date(),
  };
}

export async function getAccountPositionsAtDate(input: {
  accountId: string;
  date: string | Date;
  assetClass?: string | null;
  mode?: RuntimeMode;
}) {
  const window = dateWindowUtc(input.date);
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountPositionsAtDate({
      date: window.date,
      assetClass: input.assetClass,
    });
  }

  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const positionConditions = [
    inArray(flexOpenPositionsTable.providerAccountId, universe.accountIds),
    gte(flexOpenPositionsTable.asOf, window.start),
    lt(flexOpenPositionsTable.asOf, window.end),
  ];
  if (input.assetClass && input.assetClass !== "all") {
    positionConditions.push(eq(flexOpenPositionsTable.assetClass, input.assetClass));
  }

  const balanceConditions = [
    inArray(brokerAccountsTable.providerAccountId, universe.accountIds),
    gte(balanceSnapshotsTable.asOf, window.start),
    lt(balanceSnapshotsTable.asOf, window.end),
  ];
  const previousBalanceConditions = [
    inArray(brokerAccountsTable.providerAccountId, universe.accountIds),
    lt(balanceSnapshotsTable.asOf, window.start),
  ];

  const [
    positionRows,
    tradeRows,
    cashRows,
    dividendRows,
    balanceRows,
    previousBalanceRows,
  ] = await Promise.all([
    withOptionalAccountSchemaFallback({
      tables: ["flex_open_positions"],
      fallback: () => [],
      run: async () =>
        db
          .select()
          .from(flexOpenPositionsTable)
          .where(and(...positionConditions))
          .orderBy(flexOpenPositionsTable.asOf),
    }),
    withOptionalAccountSchemaFallback({
      tables: ["flex_trades"],
      fallback: () => [],
      run: async () =>
        db
          .select()
          .from(flexTradesTable)
          .where(
            and(
              inArray(flexTradesTable.providerAccountId, universe.accountIds),
              gte(flexTradesTable.tradeDate, window.start),
              lt(flexTradesTable.tradeDate, window.end),
            ),
          )
          .orderBy(flexTradesTable.tradeDate),
    }),
    withOptionalAccountSchemaFallback({
      tables: ["flex_cash_activity"],
      fallback: () => [],
      run: async () =>
        db
          .select()
          .from(flexCashActivityTable)
          .where(
            and(
              inArray(flexCashActivityTable.providerAccountId, universe.accountIds),
              gte(flexCashActivityTable.activityDate, window.start),
              lt(flexCashActivityTable.activityDate, window.end),
            ),
          )
          .orderBy(flexCashActivityTable.activityDate),
    }),
    withOptionalAccountSchemaFallback({
      tables: ["flex_dividends"],
      fallback: () => [],
      run: async () =>
        db
          .select()
          .from(flexDividendsTable)
          .where(
            and(
              inArray(flexDividendsTable.providerAccountId, universe.accountIds),
              gte(flexDividendsTable.paidDate, window.start),
              lt(flexDividendsTable.paidDate, window.end),
            ),
          )
          .orderBy(flexDividendsTable.paidDate),
    }),
    withAccountSnapshotReadFallback({
      fallback: () => [],
      message:
        "Account date balance snapshot database unavailable; returning positions without balance summary",
      run: async () =>
        db
          .select({
            providerAccountId: brokerAccountsTable.providerAccountId,
            asOf: balanceSnapshotsTable.asOf,
            currency: balanceSnapshotsTable.currency,
            cash: balanceSnapshotsTable.cash,
            buyingPower: balanceSnapshotsTable.buyingPower,
            netLiquidation: balanceSnapshotsTable.netLiquidation,
            maintenanceMargin: balanceSnapshotsTable.maintenanceMargin,
          })
          .from(balanceSnapshotsTable)
          .innerJoin(
            brokerAccountsTable,
            eq(balanceSnapshotsTable.accountId, brokerAccountsTable.id),
          )
          .where(and(...balanceConditions))
          .orderBy(balanceSnapshotsTable.asOf),
    }),
    withAccountSnapshotReadFallback({
      fallback: () => [],
      message:
        "Account previous balance snapshot database unavailable; returning date balance without P&L",
      run: async () =>
        db
          .select({
            providerAccountId: brokerAccountsTable.providerAccountId,
            asOf: balanceSnapshotsTable.asOf,
            currency: balanceSnapshotsTable.currency,
            cash: balanceSnapshotsTable.cash,
            buyingPower: balanceSnapshotsTable.buyingPower,
            netLiquidation: balanceSnapshotsTable.netLiquidation,
            maintenanceMargin: balanceSnapshotsTable.maintenanceMargin,
          })
          .from(balanceSnapshotsTable)
          .innerJoin(
            brokerAccountsTable,
            eq(balanceSnapshotsTable.accountId, brokerAccountsTable.id),
          )
          .where(and(...previousBalanceConditions))
          .orderBy(desc(balanceSnapshotsTable.asOf)),
    }),
  ]);

  const nav = positionRows.reduce(
    (sum, row) => sum + (toNumber(row.marketValue) ?? 0),
    0,
  );
  const positions = positionRows.map((row) => {
    const quantity = toNumber(row.quantity) ?? 0;
    const costBasis = toNumber(row.costBasis) ?? 0;
    const marketValue = toNumber(row.marketValue) ?? 0;
    const averageCost =
      Math.abs(quantity) > POSITION_QUANTITY_EPSILON
        ? Math.abs(costBasis) / Math.abs(quantity)
        : 0;
    const mark =
      Math.abs(quantity) > POSITION_QUANTITY_EPSILON
        ? Math.abs(marketValue) / Math.abs(quantity)
        : 0;
    const unrealizedPnl = marketValue - costBasis;
    return {
      id: `FLEX:${row.providerAccountId}:${row.symbol}:${row.asOf.toISOString()}`,
      accountId: row.providerAccountId,
      accounts: [row.providerAccountId],
      symbol: row.symbol,
      description: row.description || row.symbol,
      assetClass: normalizeTradeAssetClassLabel({
        assetClass: row.assetClass,
        symbol: row.symbol,
      }),
      optionContract: null,
      sector: sectorForSymbol(row.symbol),
      quantity,
      averageCost,
      mark,
      dayChange: null,
      dayChangePercent: null,
      unrealizedPnl,
      unrealizedPnlPercent: costBasis ? (unrealizedPnl / Math.abs(costBasis)) * 100 : 0,
      marketValue,
      weightPercent: weightPercent(marketValue, nav),
      betaWeightedDelta: null,
      lots: [
        {
          accountId: row.providerAccountId,
          symbol: row.symbol,
          quantity,
          averageCost,
          marketPrice: mark,
          marketValue,
          unrealizedPnl,
          asOf: row.asOf,
          source: "FLEX_OPEN_POSITIONS",
        },
      ],
      openOrders: [],
      source: "FLEX_OPEN_POSITIONS",
      sourceType: "manual" as const,
      strategyLabel: "Flex",
      attributionStatus: "unknown" as const,
      sourceAttribution: [],
    };
  });

  const tradeActivity = tradeRows.map((row) => ({
    id: `trade:${row.tradeId}`,
    timestamp: row.tradeDate,
    type: "trade",
    symbol: row.symbol,
    side: row.side,
    amount: toNumber(row.amount),
    quantity: toNumber(row.quantity),
    price: toNumber(row.price),
    realizedPnl: toNumber(row.realizedPnl),
    fees: toNumber(row.commission),
    currency: row.currency,
    source: "FLEX_TRADES",
  }));
  const cashActivity = cashRows.map((row) => ({
    id: `cash:${row.activityId}`,
    timestamp: row.activityDate,
    type: row.activityType,
    symbol: null,
    side: null,
    amount: toNumber(row.amount),
    quantity: null,
    price: null,
    realizedPnl: null,
    fees: /fee|commission/i.test(`${row.activityType} ${row.description ?? ""}`)
      ? Math.abs(toNumber(row.amount) ?? 0)
      : null,
    currency: row.currency,
    source: "FLEX_CASH",
  }));
  const dividendActivity = dividendRows.map((row) => ({
    id: `dividend:${row.dividendId}`,
    timestamp: row.paidDate,
    type: "dividend",
    symbol: row.symbol,
    side: null,
    amount: toNumber(row.amount),
    quantity: null,
    price: null,
    realizedPnl: null,
    fees: null,
    currency: row.currency,
    source: "FLEX_DIVIDEND",
  }));
  const activity = [...tradeActivity, ...cashActivity, ...dividendActivity].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
  const latestBalanceRows = selectBalanceBoundaryRows(balanceRows, "latest");
  const firstBalanceRows = selectBalanceBoundaryRows(balanceRows, "earliest");
  const previousLatestBalanceRows = selectBalanceBoundaryRows(
    previousBalanceRows,
    "latest",
  );
  const balanceSnapshot = aggregateBalanceRows(
    latestBalanceRows,
    universe.primaryCurrency,
  );
  const balanceBaseline =
    aggregateBalanceRows(previousLatestBalanceRows, universe.primaryCurrency) ??
    aggregateBalanceRows(firstBalanceRows, universe.primaryCurrency);
  const externalTransfer = cashRows.reduce((sum, row) => {
    const transfer = classifyExternalCashTransfer(row);
    return transfer === null ? sum : sum + transfer;
  }, 0);
  const dayPnl =
    balanceSnapshot && balanceBaseline
      ? balanceSnapshot.netLiquidation -
        balanceBaseline.netLiquidation -
        externalTransfer
      : null;
  const dayPnlPercent =
    dayPnl !== null && balanceBaseline && balanceBaseline.netLiquidation
      ? (dayPnl / Math.abs(balanceBaseline.netLiquidation)) * 100
      : null;
  const snapshotDate = positionRows.reduce<Date | null>(
    (latest, row) => (!latest || row.asOf.getTime() > latest.getTime() ? row.asOf : latest),
    null,
  );
  const effectiveSnapshotDate =
    snapshotDate && balanceSnapshot?.asOf
      ? snapshotDate.getTime() >= balanceSnapshot.asOf.getTime()
        ? snapshotDate
        : balanceSnapshot.asOf
      : (snapshotDate ?? balanceSnapshot?.asOf ?? null);

  return {
    accountId: universe.requestedAccountId,
    date: window.date,
    currency: universe.primaryCurrency,
    status: positions.length || balanceSnapshot ? "historical" : "unavailable",
    snapshotDate: effectiveSnapshotDate,
    message: positions.length
      ? null
      : balanceSnapshot
        ? "No Flex open-position snapshot exists for this date; showing recorded balance snapshot."
        : "No Flex open-position snapshot or recorded balance snapshot exists for this date.",
    positions,
    activity,
    totals: {
      weightPercent: positions.reduce((sum, row) => sum + (row.weightPercent ?? 0), 0),
      unrealizedPnl: positions.reduce((sum, row) => sum + row.unrealizedPnl, 0),
      grossLong: positions
        .filter((row) => row.marketValue > 0)
        .reduce((sum, row) => sum + row.marketValue, 0),
      grossShort: positions
        .filter((row) => row.marketValue < 0)
        .reduce((sum, row) => sum + Math.abs(row.marketValue), 0),
      netExposure: nav,
      balance: balanceSnapshot
        ? {
            ...balanceSnapshot,
            previousNetLiquidation: balanceBaseline?.netLiquidation ?? null,
            dayPnl,
            dayPnlPercent,
            externalTransfer,
            source: "LOCAL_LEDGER",
          }
        : null,
    },
    updatedAt: new Date(),
  };
}

type AccountDateBalanceRow = {
  providerAccountId: string;
  asOf: Date;
  currency: string;
  cash: string;
  buyingPower: string;
  netLiquidation: string;
  maintenanceMargin: string | null;
};

function selectBalanceBoundaryRows(
  rows: AccountDateBalanceRow[],
  boundary: "earliest" | "latest",
): AccountDateBalanceRow[] {
  const byAccount = new Map<string, AccountDateBalanceRow>();
  rows.forEach((row) => {
    const current = byAccount.get(row.providerAccountId);
    if (!current) {
      byAccount.set(row.providerAccountId, row);
      return;
    }
    const useCandidate =
      boundary === "latest"
        ? row.asOf.getTime() > current.asOf.getTime()
        : row.asOf.getTime() < current.asOf.getTime();
    if (useCandidate) {
      byAccount.set(row.providerAccountId, row);
    }
  });
  return Array.from(byAccount.values());
}

function aggregateBalanceRows(
  rows: AccountDateBalanceRow[],
  fallbackCurrency: string,
): {
  asOf: Date;
  currency: string;
  cash: number;
  buyingPower: number;
  netLiquidation: number;
  maintenanceMargin: number | null;
} | null {
  if (!rows.length) {
    return null;
  }
  return {
    asOf: rows.reduce(
      (latest, row) =>
        row.asOf.getTime() > latest.getTime() ? row.asOf : latest,
      rows[0]!.asOf,
    ),
    currency: rows[0]?.currency || fallbackCurrency,
    cash: rows.reduce((sum, row) => sum + (toNumber(row.cash) ?? 0), 0),
    buyingPower: rows.reduce(
      (sum, row) => sum + (toNumber(row.buyingPower) ?? 0),
      0,
    ),
    netLiquidation: rows.reduce(
      (sum, row) => sum + (toNumber(row.netLiquidation) ?? 0),
      0,
    ),
    maintenanceMargin: sumNullableValues(
      rows.map((row) => toNumber(row.maintenanceMargin)),
    ),
  };
}

async function getPositionLots(accountIds: string[]) {
  if (!accountIds.length) {
    return [];
  }

  return withAccountPositionLotsReadFallback({
    fallback: () => [],
    run: async () => {
      const rows = await db
        .select({
          providerAccountId: brokerAccountsTable.providerAccountId,
          symbol: instrumentsTable.symbol,
          quantity: positionLotsTable.quantity,
          averageCost: positionLotsTable.averageCost,
          marketPrice: positionLotsTable.marketPrice,
          marketValue: positionLotsTable.marketValue,
          unrealizedPnl: positionLotsTable.unrealizedPnl,
          asOf: positionLotsTable.asOf,
        })
        .from(positionLotsTable)
        .innerJoin(
          brokerAccountsTable,
          eq(positionLotsTable.accountId, brokerAccountsTable.id),
        )
        .innerJoin(
          instrumentsTable,
          eq(positionLotsTable.instrumentId, instrumentsTable.id),
        )
        .where(inArray(brokerAccountsTable.providerAccountId, accountIds))
        .orderBy(desc(positionLotsTable.asOf))
        .limit(500);

      return rows.map((row) => ({
        accountId: row.providerAccountId,
        symbol: row.symbol,
        quantity: toNumber(row.quantity) ?? 0,
        averageCost: toNumber(row.averageCost) ?? 0,
        marketPrice: toNumber(row.marketPrice),
        marketValue: toNumber(row.marketValue),
        unrealizedPnl: toNumber(row.unrealizedPnl),
        asOf: row.asOf,
        source: "LOCAL_LEDGER",
      }));
    },
  });
}

type NormalizedAccountTrade = {
  id: string;
  source: "FLEX" | "LIVE";
  accountId: string;
  symbol: string;
  side: string;
  assetClass: string;
  quantity: number;
  openDate: Date | null;
  closeDate: Date | null;
  avgOpen: number | null;
  avgClose: number | null;
  realizedPnl: number | null;
  realizedPnlPercent: number | null;
  holdDurationMinutes: number | null;
  commissions: number | null;
  currency: string;
};

type TradeOutcomeSide = "loss" | "flat" | "win";

type TradeOutcomeBucket = {
  id: string;
  index: number;
  bucketCount: number;
  min: number;
  max: number;
  label: string;
  side: TradeOutcomeSide;
  count: number;
  total: number;
  average: number;
};

const buildAccountTradeAnnotationKey = (input: {
  source?: string | null;
  accountId?: string | null;
  id?: string | null;
  symbol?: string | null;
  closeDate?: Date | string | null;
}) => {
  const source = String(input.source || "UNKNOWN").trim().toUpperCase();
  const accountId = String(input.accountId || "unknown").trim() || "unknown";
  const id = String(input.id || "").trim();
  if (id) {
    return `${source}:${accountId}:${id}`;
  }
  const symbol = normalizeSymbol(input.symbol || "");
  const closeDate =
    input.closeDate instanceof Date
      ? input.closeDate.toISOString()
      : String(input.closeDate || "").trim();
  return `${source}:${accountId}:${symbol || "unknown"}:${closeDate || "open"}`;
};

const normalizeAnnotationNote = (value: unknown) =>
  typeof value === "string" ? value.trim().slice(0, 5_000) : "";

const normalizeAnnotationTags = (value: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((tag) => String(tag || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 20);

const normalizeAccountAnnotationMode = (input: {
  accountId?: string | null;
  mode?: RuntimeMode | "shadow" | null;
}) => {
  if (isShadowAccountId(input.accountId)) {
    return "shadow";
  }
  return input.mode === "live" ? "live" : "paper";
};

const normalizeClosedTradesLimit = (value: unknown) => {
  const parsed = Number(value);
  if (value === undefined || value === null || value === "") {
    return 500;
  }
  if (Number.isFinite(parsed) && parsed <= 0) {
    return null;
  }
  return Number.isFinite(parsed)
    ? Math.min(10_000, Math.max(1, Math.round(parsed)))
    : 500;
};

const normalizeTradeOutcomeBucketCount = (value: unknown) => {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.round(parsed) : 9;
  const odd = normalized % 2 === 0 ? normalized + 1 : normalized;
  return Math.min(31, Math.max(3, odd));
};

const buildOutcomeBucket = (
  side: TradeOutcomeSide,
  values: number[],
  index: number,
  bucketCount: number,
): TradeOutcomeBucket => {
  const total = values.reduce((sum, value) => sum + value, 0);
  const label = side === "loss" ? "Loss" : side === "win" ? "Win" : "Flat";
  return {
    id: `pnl:${side}`,
    index,
    bucketCount,
    min: Math.min(...values),
    max: Math.max(...values),
    label,
    side,
    count: values.length,
    total,
    average: values.length ? total / values.length : 0,
  };
};

const buildTradeOutcomeBuckets = (
  values: readonly number[],
  bucketCountInput: unknown,
): TradeOutcomeBucket[] => {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) {
    return [];
  }
  if (numbers.every((value) => value === 0)) {
    return [
      {
        id: "pnl:flat",
        index: 0,
        bucketCount: 1,
        min: 0,
        max: 0,
        label: "Flat",
        side: "flat",
        count: numbers.length,
        total: 0,
        average: 0,
      },
    ];
  }

  const requestedBucketCount = normalizeTradeOutcomeBucketCount(bucketCountInput);
  const groups: Array<[TradeOutcomeSide, number[]]> = [
    ["loss", numbers.filter((value) => value < 0)],
    ["flat", numbers.filter((value) => value === 0)],
    ["win", numbers.filter((value) => value > 0)],
  ].filter(
    (group): group is [TradeOutcomeSide, number[]] => group[1].length > 0,
  );
  const bucketCount = Math.min(requestedBucketCount, groups.length);
  return groups.map(([side, groupValues], index) =>
    buildOutcomeBucket(side, groupValues, index, bucketCount),
  );
};

const overviewMatchesRequest = (
  overview: Record<string, unknown> | null | undefined,
  request: Record<string, unknown>,
) =>
  Boolean(
    overview &&
      overview.accountId === request.accountId &&
      overview.mode === request.mode &&
      overview.range === request.range &&
      (overview.assetClass ?? null) === (request.assetClass ?? null) &&
      (overview.orderTab ?? null) === (request.orderTab ?? null),
  );

function matchesHoldDurationBucket(
  holdDurationMinutes: number | null,
  filter: string | null | undefined,
): boolean {
  if (!filter || filter === "all") {
    return true;
  }
  if (holdDurationMinutes == null) {
    return false;
  }
  if (filter === "intraday") {
    return holdDurationMinutes < 24 * 60;
  }
  if (filter === "swing") {
    return holdDurationMinutes >= 24 * 60 && holdDurationMinutes < 7 * 24 * 60;
  }
  if (filter === "position") {
    return holdDurationMinutes >= 7 * 24 * 60;
  }
  return true;
}

async function listClosedTradesForUniverse(
  universe: AccountUniverse,
  input: {
    from?: Date | null;
    to?: Date | null;
    symbol?: string | null;
    assetClass?: string | null;
    pnlSign?: string | null;
    holdDuration?: string | null;
  },
): Promise<NormalizedAccountTrade[]> {
  const conditions = [inArray(flexTradesTable.providerAccountId, universe.accountIds)];
  if (input.from) {
    conditions.push(gte(flexTradesTable.tradeDate, input.from));
  }
  if (input.to) {
    conditions.push(lte(flexTradesTable.tradeDate, input.to));
  }
  if (input.symbol) {
    conditions.push(eq(flexTradesTable.symbol, normalizeSymbol(input.symbol)));
  }

  const [flexRows, liveExecutions] = await Promise.all([
    withOptionalAccountSchemaFallback({
      tables: ["flex_trades"],
      fallback: () => [],
      run: async () =>
        db
          .select()
          .from(flexTradesTable)
          .where(and(...conditions))
          .orderBy(desc(flexTradesTable.tradeDate))
          .limit(500),
    }),
    listExecutionsForUniverse(universe, {
      days: 7,
      limit: 250,
      symbol: input.symbol ?? undefined,
    }).catch(() => []),
  ]);

  return [
    ...flexRows.map((row) => ({
      id: row.tradeId,
      source: "FLEX" as const,
      accountId: row.providerAccountId,
      symbol: row.symbol,
      side: row.side,
      assetClass: normalizeTradeAssetClassLabel({
        assetClass: row.assetClass,
        symbol: row.symbol,
      }),
      quantity: toNumber(row.quantity) ?? 0,
      openDate: null,
      closeDate: row.tradeDate,
      avgOpen: null,
      avgClose: toNumber(row.price),
      realizedPnl: toNumber(row.realizedPnl),
      realizedPnlPercent: null,
      holdDurationMinutes: null,
      commissions: toNumber(row.commission),
      currency: row.currency,
    })),
    ...liveExecutions.map((execution) => ({
      id: execution.id,
      source: "LIVE" as const,
      accountId: execution.accountId,
      symbol: execution.symbol,
      side: execution.side,
      assetClass: normalizeTradeAssetClassLabel({
        assetClass: execution.assetClass,
        symbol: execution.symbol,
      }),
      quantity: execution.quantity,
      openDate: null,
      closeDate: execution.executedAt,
      avgOpen: null,
      avgClose: execution.price,
      realizedPnl: execution.netAmount,
      realizedPnlPercent: null,
      holdDurationMinutes: null,
      commissions: null,
      currency: universe.primaryCurrency,
    })),
  ].filter((trade) => {
    if (
      input.assetClass &&
      input.assetClass !== "all" &&
      trade.assetClass.toLowerCase() !== input.assetClass.toLowerCase()
    ) {
      return false;
    }
    if (input.pnlSign === "winners" && (trade.realizedPnl ?? 0) <= 0) {
      return false;
    }
    if (input.pnlSign === "losers" && (trade.realizedPnl ?? 0) >= 0) {
      return false;
    }
    if (!matchesHoldDurationBucket(trade.holdDurationMinutes, input.holdDuration)) {
      return false;
    }
    return true;
  });
}

export async function getAccountClosedTrades(input: {
  accountId: string;
  from?: Date | null;
  to?: Date | null;
  symbol?: string | null;
  assetClass?: string | null;
  pnlSign?: string | null;
  holdDuration?: string | null;
  mode?: RuntimeMode;
}) {
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountClosedTrades({
      from: input.from,
      to: input.to,
      symbol: input.symbol,
      assetClass: input.assetClass,
      pnlSign: input.pnlSign,
    });
  }

  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const trades = await listClosedTradesForUniverse(universe, input);

  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    trades,
    summary: {
      count: trades.length,
      winners: trades.filter((trade) => (trade.realizedPnl ?? 0) > 0).length,
      losers: trades.filter((trade) => (trade.realizedPnl ?? 0) < 0).length,
      realizedPnl: trades.reduce(
        (sum, trade) => sum + (trade.realizedPnl ?? 0),
        0,
      ),
      commissions: trades.reduce((sum, trade) => sum + (trade.commissions ?? 0), 0),
    },
    updatedAt: new Date(),
  };
}

export async function getAccountOrders(input: {
  accountId: string;
  tab?: OrderTab;
  mode?: RuntimeMode;
}) {
  if (isShadowAccountId(input.accountId)) {
    const snapshot = await fetchShadowAccountSnapshotBase();
    return input.tab === "history"
      ? snapshot.historyOrders
      : snapshot.workingOrders;
  }

  const mode = input.mode ?? getRuntimeMode();
  const tab = normalizeOrderTab(input.tab);
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const orderResult = await listOrdersForUniverse(universe, mode);
  const filtered = orderResult.orders.filter((order) =>
    tab === "working" ? workingOrderStatus(order.status) : terminalOrderStatus(order.status),
  );

  return {
    accountId: universe.requestedAccountId,
    tab,
    currency: universe.primaryCurrency,
    degraded: orderResult.degraded,
    reason: orderResult.reason,
    stale: orderResult.stale,
    debug: orderResult.debug,
    orders: filtered.map((order) => ({
      id: order.id,
      accountId: order.accountId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      assetClass: order.assetClass,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      limitPrice: order.limitPrice,
      stopPrice: order.stopPrice,
      timeInForce: order.timeInForce,
      status: order.status,
      placedAt: order.placedAt,
      filledAt: order.status === "filled" ? order.updatedAt : null,
      updatedAt: order.updatedAt,
      averageFillPrice: null,
      commission: null,
      source: "LIVE",
    })),
    updatedAt: new Date(),
  };
}

export async function cancelAccountOrder(input: {
  accountId: string;
  orderId: string;
  confirm?: boolean | null;
}) {
  if (isShadowAccountId(input.accountId)) {
    return {
      orderId: input.orderId,
      accountId: input.accountId,
      message: "Shadow orders fill immediately and cannot be canceled.",
      submittedAt: new Date(),
    };
  }

  if (getRuntimeMode() === "live" && input.confirm !== true) {
    throw new HttpError(409, "Live order cancellation requires confirmation.", {
      code: "ibkr_live_cancel_confirmation_required",
      expose: true,
    });
  }

  await assertIbkrGatewayTradingAvailable();
  return getIbkrClient().cancelOrder({
    accountId: input.accountId,
    orderId: input.orderId,
    confirm: input.confirm,
  });
}

export async function getAccountRisk(input: {
  accountId: string;
  mode?: RuntimeMode;
}) {
  if (isShadowAccountId(input.accountId)) {
    return (await fetchShadowAccountSnapshotBase()).risk;
  }

  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const [positions, closedTrades] = await Promise.all([
    listPositionsForUniverse(universe, mode),
    listClosedTradesForUniverse(universe, {}),
  ]);
  const [greekEnrichment, marketHydration] = await Promise.all([
    enrichPositionGreeks(positions),
    hydratePositionMarkets(positions),
  ]);
  const nav = sumAccounts(universe.accounts, "netLiquidation") ?? 0;
  const marginSnapshot = buildAccountMarginSnapshot(universe.accounts);
  const exposure = exposureSummary(positions, (position) =>
    hydratedPositionMarketValue(position, marketHydration),
  );
  const sectorMap = new Map<string, number>();
  positions.forEach((position) => {
    const sector = sectorForSymbol(positionReferenceSymbol(position));
    sectorMap.set(
      sector,
      (sectorMap.get(sector) ?? 0) +
        hydratedPositionMarketValue(position, marketHydration),
    );
  });

  const positionRows = positions
    .map((position) => {
      const hydratedMarket = marketHydration.get(position.id);
      const marketValue =
        hydratedMarket?.marketValue ?? positionSignedNotional(position);
      return {
        symbol: position.symbol,
        marketValue,
        weightPercent: weightPercent(marketValue, nav),
        dayChange: hydratedMarket?.dayChange ?? null,
        unrealizedPnl: hydratedMarket?.unrealizedPnl ?? position.unrealizedPnl,
        sector: sectorForSymbol(positionReferenceSymbol(position)),
      };
    })
    .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));
  const realizedRows = closedTrades
    .filter((trade) => (trade.realizedPnl ?? 0) !== 0)
    .map((trade) => ({
      symbol: trade.symbol,
      marketValue: trade.realizedPnl ?? 0,
      weightPercent: null,
      unrealizedPnl: trade.realizedPnl ?? 0,
      sector: sectorForSymbol(trade.symbol),
    }));
  const optionGreekCoverage = {
    gamma: 0,
    theta: 0,
    vega: 0,
  };
  const perUnderlyingMap = new Map<
    string,
    {
      underlying: string;
      exposure: number;
      delta: number | null;
      betaWeightedDelta: number | null;
      gamma: number | null;
      theta: number | null;
      vega: number | null;
      positionCount: number;
      optionPositionCount: number;
    }
  >();

  positions.forEach((position) => {
    const underlying = positionReferenceSymbol(position);
    const greek = greekEnrichment.byPositionId.get(position.id);

    if (position.assetClass === "option") {
      if (greek?.gamma !== null) optionGreekCoverage.gamma += 1;
      if (greek?.theta !== null) optionGreekCoverage.theta += 1;
      if (greek?.vega !== null) optionGreekCoverage.vega += 1;
    }

    const entry = perUnderlyingMap.get(underlying) ?? {
      underlying,
      exposure: 0,
      delta: null,
      betaWeightedDelta: null,
      gamma: null,
      theta: null,
      vega: null,
      positionCount: 0,
      optionPositionCount: 0,
    };
    entry.exposure += hydratedPositionMarketValue(position, marketHydration);
    entry.positionCount += 1;
    if (position.assetClass === "option") {
      entry.optionPositionCount += 1;
    }
    entry.delta = upsertNullableTotal(entry.delta, greek?.delta ?? null);
    entry.betaWeightedDelta = upsertNullableTotal(
      entry.betaWeightedDelta,
      greek?.betaWeightedDelta ?? null,
    );
    entry.gamma = upsertNullableTotal(entry.gamma, greek?.gamma ?? null);
    entry.theta = upsertNullableTotal(entry.theta, greek?.theta ?? null);
    entry.vega = upsertNullableTotal(entry.vega, greek?.vega ?? null);
    perUnderlyingMap.set(underlying, entry);
  });

  const totalOptionPositions = greekEnrichment.totalOptionPositions;
  const rawDelta = sumNullableValues(
    positions.map((position) => greekEnrichment.byPositionId.get(position.id)?.delta),
  );
  const betaWeightedDelta = sumNullableValues(
    positions.map(
      (position) =>
        greekEnrichment.byPositionId.get(position.id)?.betaWeightedDelta,
    ),
  );
  const gamma =
    totalOptionPositions > 0 && optionGreekCoverage.gamma === 0
      ? null
      : sumNullableValues(
          positions.map((position) => greekEnrichment.byPositionId.get(position.id)?.gamma),
        );
  const theta =
    totalOptionPositions > 0 && optionGreekCoverage.theta === 0
      ? null
      : sumNullableValues(
          positions.map((position) => greekEnrichment.byPositionId.get(position.id)?.theta),
        );
  const vega =
    totalOptionPositions > 0 && optionGreekCoverage.vega === 0
      ? null
      : sumNullableValues(
          positions.map((position) => greekEnrichment.byPositionId.get(position.id)?.vega),
        );
  const perUnderlying = Array.from(perUnderlyingMap.values()).sort(
    (left, right) => Math.abs(right.exposure) - Math.abs(left.exposure),
  );
  const greekWarnings = [...greekEnrichment.warnings];

  if (
    totalOptionPositions > 0 &&
    greekEnrichment.matchedOptionPositions < totalOptionPositions
  ) {
    greekWarnings.unshift(
      `Matched ${greekEnrichment.matchedOptionPositions} of ${totalOptionPositions} option positions to IBKR greek snapshots.`,
    );
  }

  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    concentration: {
      topPositions: positionRows.slice(0, 5),
      sectors: Array.from(sectorMap.entries())
        .map(([sector, value]) => ({
          sector,
          value,
          weightPercent: weightPercent(value, nav),
        }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    },
    winnersLosers: {
      todayWinners: positionRows
        .filter((row) => (row.dayChange ?? 0) > 0)
        .sort((a, b) => (b.dayChange ?? 0) - (a.dayChange ?? 0))
        .slice(0, 5),
      todayLosers: positionRows
        .filter((row) => (row.dayChange ?? 0) < 0)
        .sort((a, b) => (a.dayChange ?? 0) - (b.dayChange ?? 0))
        .slice(0, 5),
      allTimeWinners: realizedRows
        .filter((row) => row.unrealizedPnl > 0)
        .sort((a, b) => b.unrealizedPnl - a.unrealizedPnl)
        .slice(0, 5),
      allTimeLosers: realizedRows
        .filter((row) => row.unrealizedPnl < 0)
        .sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)
        .slice(0, 5),
    },
    margin: {
      leverageRatio: nav ? exposure.netExposure / nav : null,
      marginUsed: marginSnapshot.marginUsed,
      marginAvailable: marginSnapshot.marginAvailable,
      maintenanceMargin: marginSnapshot.maintenanceMargin,
      maintenanceCushionPercent: marginSnapshot.maintenanceCushionPercent,
      dayTradingBuyingPower: marginSnapshot.dayTradingBuyingPower,
      sma: marginSnapshot.sma,
      regTInitialMargin: marginSnapshot.regTInitialMargin,
      marginUsedUsesMaintenanceFallback:
        marginSnapshot.marginUsedUsesMaintenanceFallback,
      pdtDayTradeCount: null,
      providerFields: marginSnapshot.providerFields,
    },
    greeks: {
      delta: rawDelta,
      betaWeightedDelta,
      gamma,
      theta,
      vega,
      source: "IBKR_OPTION_CHAIN",
      coverage: {
        optionPositions: totalOptionPositions,
        matchedOptionPositions: greekEnrichment.matchedOptionPositions,
      },
      perUnderlying,
      warning: greekWarnings.length ? greekWarnings.join(" ") : null,
    },
    expiryConcentration: buildExpiryConcentration(positions),
    updatedAt: accountMetricUpdatedAt(universe.accounts) ?? new Date(),
  };
}

export async function getAccountCashActivity(input: {
  accountId: string;
  from?: Date | null;
  to?: Date | null;
  mode?: RuntimeMode;
}) {
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountCashActivity();
  }

  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const conditions = [
    inArray(flexCashActivityTable.providerAccountId, universe.accountIds),
  ];
  if (input.from) {
    conditions.push(gte(flexCashActivityTable.activityDate, input.from));
  }
  if (input.to) {
    conditions.push(lte(flexCashActivityTable.activityDate, input.to));
  }

  const [activities, dividends] = await Promise.all([
    withOptionalAccountSchemaFallback({
      tables: ["flex_cash_activity"],
      fallback: () => [],
      run: async () =>
        db
          .select()
          .from(flexCashActivityTable)
          .where(and(...conditions))
          .orderBy(desc(flexCashActivityTable.activityDate))
          .limit(200),
    }),
    withOptionalAccountSchemaFallback({
      tables: ["flex_dividends"],
      fallback: () => [],
      run: async () =>
        db
          .select()
          .from(flexDividendsTable)
          .where(inArray(flexDividendsTable.providerAccountId, universe.accountIds))
          .orderBy(desc(flexDividendsTable.paidDate))
          .limit(100),
    }),
  ]);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

  const dividendAmount = (from: Date) =>
    dividends
      .filter((row) => row.paidDate >= from)
      .reduce((sum, row) => sum + (toNumber(row.amount) ?? 0), 0);

  const feeYtd = activities
    .filter((row) => row.activityDate >= yearStart)
    .filter((row) => /fee|commission/i.test(`${row.activityType} ${row.description ?? ""}`))
    .reduce((sum, row) => sum + Math.abs(toNumber(row.amount) ?? 0), 0);

  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    settledCash: sumAccounts(universe.accounts, "settledCash"),
    unsettledCash: null,
    totalCash: sumAccounts(universe.accounts, "cash"),
    dividendsMonth: dividendAmount(monthStart),
    dividendsYtd: dividendAmount(yearStart),
    interestPaidEarnedYtd: activities
      .filter((row) => row.activityDate >= yearStart)
      .filter((row) => /interest/i.test(`${row.activityType} ${row.description ?? ""}`))
      .reduce((sum, row) => sum + (toNumber(row.amount) ?? 0), 0),
    feesYtd: feeYtd,
    activities: activities.map((row) => ({
      id: row.activityId,
      accountId: row.providerAccountId,
      date: row.activityDate,
      type: row.activityType,
      description: row.description,
      amount: toNumber(row.amount) ?? 0,
      currency: row.currency,
      source: "FLEX",
    })),
    dividends: dividends.map((row) => ({
      id: row.dividendId,
      accountId: row.providerAccountId,
      symbol: row.symbol,
      description: row.description,
      paidDate: row.paidDate,
      amount: toNumber(row.amount) ?? 0,
      currency: row.currency,
      source: "FLEX",
    })),
    updatedAt: new Date(),
  };
}

export async function getFlexHealth() {
  const schema = await getOptionalAccountSchemaReadiness();
  const [lastRun, lastCompletedRun] = await Promise.all([
    withOptionalAccountSchemaFallback({
      tables: ["flex_report_runs"],
      fallback: () => null,
      run: async () => {
        const [row] = await db
          .select()
          .from(flexReportRunsTable)
          .orderBy(desc(flexReportRunsTable.requestedAt))
          .limit(1);
        return row ?? null;
      },
    }),
    withOptionalAccountSchemaFallback({
      tables: ["flex_report_runs"],
      fallback: () => null,
      run: async () => {
        const [row] = await db
          .select()
          .from(flexReportRunsTable)
          .where(eq(flexReportRunsTable.status, "completed"))
          .orderBy(desc(flexReportRunsTable.completedAt))
          .limit(1);
        return row ?? null;
      },
    }),
  ]);
  const latestSnapshot = await withAccountSnapshotReadFallback({
    fallback: () => [],
    message:
      "Account snapshot database unavailable while checking Flex health; using empty snapshot coverage",
    run: async () =>
      db
        .select({ asOf: balanceSnapshotsTable.asOf })
        .from(balanceSnapshotsTable)
        .orderBy(desc(balanceSnapshotsTable.asOf))
        .limit(1),
  });
  const [snapshotCoverage] = await withAccountSnapshotReadFallback({
    fallback: () => [{ firstAsOf: null, lastAsOf: null, rowCount: 0 }],
    message:
      "Account snapshot database unavailable while checking Flex health; using empty snapshot coverage",
    run: async () =>
      db
        .select({
          firstAsOf: sql<Date | null>`min(${balanceSnapshotsTable.asOf})`,
          lastAsOf: sql<Date | null>`max(${balanceSnapshotsTable.asOf})`,
          rowCount: sql<number>`count(*)::int`,
        })
        .from(balanceSnapshotsTable),
  });
  const [flexCoverage] = await withOptionalAccountSchemaFallback({
    tables: ["flex_nav_history"],
    fallback: () => [{ firstDate: null, lastDate: null, rowCount: 0 }],
    run: async () =>
      db
        .select({
          firstDate: sql<string | null>`min(${flexNavHistoryTable.statementDate})`,
          lastDate: sql<string | null>`max(${flexNavHistoryTable.statementDate})`,
          rowCount: sql<number>`count(*)::int`,
        })
        .from(flexNavHistoryTable),
  });
  const [tradeCoverage] = await withOptionalAccountSchemaFallback({
    tables: ["flex_trades"],
    fallback: () => [{ firstAt: null, lastAt: null, rowCount: 0 }],
    run: async () =>
      db
        .select({
          firstAt: sql<Date | null>`min(${flexTradesTable.tradeDate})`,
          lastAt: sql<Date | null>`max(${flexTradesTable.tradeDate})`,
          rowCount: sql<number>`count(*)::int`,
        })
        .from(flexTradesTable),
  });
  const [cashCoverage] = await withOptionalAccountSchemaFallback({
    tables: ["flex_cash_activity"],
    fallback: () => [{ firstAt: null, lastAt: null, rowCount: 0 }],
    run: async () =>
      db
        .select({
          firstAt: sql<Date | null>`min(${flexCashActivityTable.activityDate})`,
          lastAt: sql<Date | null>`max(${flexCashActivityTable.activityDate})`,
          rowCount: sql<number>`count(*)::int`,
        })
        .from(flexCashActivityTable),
  });
  const [dividendCoverage] = await withOptionalAccountSchemaFallback({
    tables: ["flex_dividends"],
    fallback: () => [{ firstAt: null, lastAt: null, rowCount: 0 }],
    run: async () =>
      db
        .select({
          firstAt: sql<Date | null>`min(${flexDividendsTable.paidDate})`,
          lastAt: sql<Date | null>`max(${flexDividendsTable.paidDate})`,
          rowCount: sql<number>`count(*)::int`,
        })
        .from(flexDividendsTable),
  });
  const [openPositionCoverage] = await withOptionalAccountSchemaFallback({
    tables: ["flex_open_positions"],
    fallback: () => [{ firstAt: null, lastAt: null, rowCount: 0 }],
    run: async () =>
      db
        .select({
          firstAt: sql<Date | null>`min(${flexOpenPositionsTable.asOf})`,
          lastAt: sql<Date | null>`max(${flexOpenPositionsTable.asOf})`,
          rowCount: sql<number>`count(*)::int`,
        })
        .from(flexOpenPositionsTable),
  });

  return {
    bridgeConnected: null,
    flexConfigured: flexConfigured(),
    flexTokenPresent: Boolean(process.env["IBKR_FLEX_TOKEN"]?.trim()),
    flexQueryIdPresent: Boolean(process.env["IBKR_FLEX_QUERY_ID"]?.trim()),
    schemaReady: schema.missingTables.length === 0 && schema.schemaError === null,
    missingTables: schema.missingTables,
    schemaError: schema.schemaError,
    lastSuccessfulRefreshAt: lastCompletedRun?.completedAt ?? null,
    lastAttemptAt: lastRun?.requestedAt ?? null,
    lastStatus: lastRun?.status ?? null,
    lastError: lastRun?.errorMessage ?? null,
    snapshotsRecording: Boolean(latestSnapshot[0]),
    lastSnapshotAt: latestSnapshot[0]?.asOf ?? null,
    snapshotCoverageStartAt: snapshotCoverage?.firstAsOf ?? null,
    snapshotCoverageEndAt: snapshotCoverage?.lastAsOf ?? null,
    snapshotPointCount: snapshotCoverage?.rowCount ?? 0,
    flexNavCoverageStartDate: flexCoverage?.firstDate
      ? dateFromDateOnly(flexCoverage.firstDate)
      : null,
    flexNavCoverageEndDate: flexCoverage?.lastDate
      ? dateFromDateOnly(flexCoverage.lastDate)
      : null,
    flexNavRowCount: flexCoverage?.rowCount ?? 0,
    flexTradeCoverageStartAt: tradeCoverage?.firstAt ?? null,
    flexTradeCoverageEndAt: tradeCoverage?.lastAt ?? null,
    flexTradeRowCount: tradeCoverage?.rowCount ?? 0,
    flexCashCoverageStartAt: cashCoverage?.firstAt ?? null,
    flexCashCoverageEndAt: cashCoverage?.lastAt ?? null,
    flexCashRowCount: cashCoverage?.rowCount ?? 0,
    flexDividendCoverageStartAt: dividendCoverage?.firstAt ?? null,
    flexDividendCoverageEndAt: dividendCoverage?.lastAt ?? null,
    flexDividendRowCount: dividendCoverage?.rowCount ?? 0,
    flexOpenPositionCoverageStartAt: openPositionCoverage?.firstAt ?? null,
    flexOpenPositionCoverageEndAt: openPositionCoverage?.lastAt ?? null,
    flexOpenPositionRowCount: openPositionCoverage?.rowCount ?? 0,
  };
}

export async function testFlexToken() {
  const result = await refreshFlexReport("manual-test");
  return {
    message: "Flex report pulled and normalized successfully.",
    ...result,
  };
}

export const __accountEquityHistoryInternalsForTests = {
  calculateTransferAdjustedReturnPoints,
  classifyExternalCashTransfer,
  compactEquitySnapshotRows,
  filterPlaceholderZeroEquitySnapshotRows,
  filterSnapshotsOnFlexTransferDates,
  isPlaceholderZeroAccountSnapshot,
  persistedAccountRowsToSnapshots,
};

export const __accountPositionInternalsForTests = {
  aggregateBalanceRows,
  buildPositionMarketHydration,
  filterOpenBrokerPositions,
  isOpenBrokerPosition,
  selectBalanceBoundaryRows,
  withAccountPositionLotsReadFallback,
};

export const __accountMarginInternalsForTests = {
  buildAccountMarginSnapshot,
};

export const __accountOrderInternalsForTests = {
  normalizeOrderTab,
  normalizeTradeAssetClassLabel,
  orderGroupKey,
  positionGroupKey,
  terminalOrderStatus,
  workingOrderStatus,
};

export const __accountTradeAnnotationInternalsForTests = {
  buildAccountTradeAnnotationKey,
  normalizeAccountAnnotationMode,
  normalizeAnnotationNote,
  normalizeAnnotationTags,
  normalizeClosedTradesLimit,
};

export const __accountOverviewInternalsForTests = {
  buildTradeOutcomeBuckets,
  normalizeTradeOutcomeBucketCount,
  overviewMatchesRequest,
};

export const __accountRiskInternalsForTests = {
  betaForSymbol,
  buildExpiryConcentration,
  matchOptionChainContract,
  mergeOptionChainContracts,
  sectorForSymbol,
  sumNullableValues,
  upsertNullableTotal,
  weightPercent,
};

export const __accountFlexInternalsForTests = {
  buildFlexBackfillWindows,
  extractFlexRecords,
  extractTagText,
  flexConfigured,
  getFlexConfigs,
  upsertFlexReport,
};
