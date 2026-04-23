import {
  and,
  desc,
  eq,
  gte,
  inArray,
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
import { normalizeSymbol } from "../lib/values";
import { getRuntimeMode, type RuntimeMode } from "../lib/runtime";
import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import { getBars } from "./platform";
import type {
  BrokerAccountSnapshot,
  BrokerExecutionSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  OptionChainContract,
} from "../providers/ibkr/client";

const COMBINED_ACCOUNT_ID = "combined";
const FLEX_SEND_REQUEST_URL =
  "https://www.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest";
const FLEX_GET_STATEMENT_URL =
  "https://www.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement";
const SNAPSHOT_WRITE_INTERVAL_MS = 60_000;
const FLEX_POLL_INTERVAL_MS = 5_000;
const FLEX_MAX_POLLS = 18;
const FLEX_MAX_OVERRIDE_DAYS = 365;
const FLEX_MAX_HISTORY_YEARS = 4;
const OPTION_GREEK_CACHE_TTL_MS = 15_000;
const OPTION_CHAIN_INITIAL_STRIKES_AROUND_MONEY = 250;
const OPTION_CHAIN_FALLBACK_STRIKES_AROUND_MONEY = 2_000;
const ACCOUNT_SCHEMA_READINESS_CACHE_TTL_MS = 30_000;

type AccountRange = "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";
type OrderTab = "working" | "history";

type FlexRecord = {
  tag: string;
  attributes: Record<string, string>;
};

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
};

type OptionPositionSnapshot = BrokerPositionSnapshot & {
  optionContract: NonNullable<BrokerPositionSnapshot["optionContract"]>;
};

type PositionGreekSnapshot = {
  positionId: string;
  symbol: string;
  underlying: string;
  delta: number | null;
  betaWeightedDelta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  source: "IBKR_POSITIONS" | "IBKR_OPTION_CHAIN";
  matched: boolean;
  warning: string | null;
};

type OptionGreekEnrichmentResult = {
  byPositionId: Map<string, PositionGreekSnapshot>;
  totalOptionPositions: number;
  matchedOptionPositions: number;
  warnings: string[];
};

type OptionChainCacheEntry = {
  expiresAt: number;
  contracts: OptionChainContract[];
  error: string | null;
};

const snapshotWriteTimestamps = new Map<string, number>();
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

const ETF_SYMBOLS = new Set([
  "SPY",
  "QQQ",
  "IWM",
  "DIA",
  "TLT",
  "IEF",
  "GLD",
  "USO",
  "SOXX",
  "VXX",
  "VIXY",
]);

const STATIC_SECTOR_BY_SYMBOL: Record<string, string> = {
  AAPL: "Technology",
  MSFT: "Technology",
  NVDA: "Technology",
  AMD: "Technology",
  AVGO: "Technology",
  META: "Communication Services",
  GOOGL: "Communication Services",
  GOOG: "Communication Services",
  AMZN: "Consumer Discretionary",
  TSLA: "Consumer Discretionary",
  JPM: "Financials",
  BAC: "Financials",
  XOM: "Energy",
  CVX: "Energy",
  UNH: "Health Care",
  JNJ: "Health Care",
  SPY: "Broad Market ETF",
  QQQ: "Growth ETF",
  IWM: "Small-Cap ETF",
  DIA: "Blue-Chip ETF",
  TLT: "Rates ETF",
  GLD: "Commodity ETF",
  SOXX: "Semiconductor ETF",
};

const BETA_BY_SYMBOL: Record<string, number> = {
  SPY: 1,
  QQQ: 1.15,
  IWM: 1.25,
  AAPL: 1.2,
  MSFT: 0.95,
  NVDA: 1.8,
  AMD: 1.9,
  TSLA: 2.1,
  META: 1.25,
  GOOGL: 1.05,
  AMZN: 1.25,
};

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
  const readiness = await getOptionalAccountSchemaReadiness();
  const knownMissingTables = input.tables.filter((tableName) =>
    readiness.missingTables.includes(tableName),
  );
  if (knownMissingTables.length) {
    return input.fallback();
  }

  try {
    return await input.run();
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    const missingTable = extractMissingRelationName(error);
    if (!missingTable || !input.tables.includes(missingTable)) {
      throw error;
    }
    markAccountSchemaTablesMissing([missingTable], error);
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
  return new Date(`${value}T00:00:00.000Z`);
}

function rangeStart(range: AccountRange): Date | null {
  const now = new Date();
  const start = new Date(now);

  switch (range) {
    case "1W":
      start.setUTCDate(now.getUTCDate() - 7);
      return start;
    case "1M":
      start.setUTCMonth(now.getUTCMonth() - 1);
      return start;
    case "3M":
      start.setUTCMonth(now.getUTCMonth() - 3);
      return start;
    case "YTD":
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    case "1Y":
      start.setUTCFullYear(now.getUTCFullYear() - 1);
      return start;
    case "ALL":
      return null;
  }
}

function snapshotBucketSizeMs(range: AccountRange): number | null {
  switch (range) {
    case "1W":
      return 60_000;
    case "1M":
      return 5 * 60_000;
    case "3M":
    case "YTD":
      return 30 * 60_000;
    case "1Y":
      return 2 * 60 * 60_000;
    case "ALL":
      return 24 * 60 * 60_000;
  }
}

type EquitySnapshotRow = {
  providerAccountId: string;
  asOf: Date;
  currency: string;
  netLiquidation: string | null;
};

type AccountEquityHistorySeedPoint = {
  timestamp: Date;
  netLiquidation: number;
  currency: string;
  source: "FLEX" | "LOCAL_LEDGER";
  deposits: number;
  withdrawals: number;
  dividends: number;
  fees: number;
};

function compactEquitySnapshotRows(
  rows: EquitySnapshotRow[],
  range: AccountRange,
): EquitySnapshotRow[] {
  const bucketSizeMs = snapshotBucketSizeMs(range);
  if (!bucketSizeMs || rows.length <= 1) {
    return rows;
  }

  const byBucket = new Map<string, EquitySnapshotRow>();
  rows.forEach((row) => {
    const bucketStart = Math.floor(row.asOf.getTime() / bucketSizeMs);
    byBucket.set(`${row.providerAccountId}:${bucketStart}`, {
      ...row,
      asOf: new Date(bucketStart * bucketSizeMs),
    });
  });

  return Array.from(byBucket.values()).sort(
    (left, right) => left.asOf.getTime() - right.asOf.getTime(),
  );
}

function hasMeaningfulEquityHistory(point: AccountEquityHistorySeedPoint): boolean {
  return (
    Math.abs(point.netLiquidation) > 0 ||
    Math.abs(point.deposits) > 0 ||
    Math.abs(point.withdrawals) > 0 ||
    Math.abs(point.dividends) > 0 ||
    Math.abs(point.fees) > 0
  );
}

function trimLeadingInactiveEquityPoints(
  points: AccountEquityHistorySeedPoint[],
): AccountEquityHistorySeedPoint[] {
  const firstMeaningfulIndex = points.findIndex(hasMeaningfulEquityHistory);
  if (firstMeaningfulIndex <= 0) {
    return points;
  }
  return points.slice(firstMeaningfulIndex);
}

function normalizeRange(raw: unknown): AccountRange {
  const value = typeof raw === "string" ? raw.toUpperCase() : "1M";
  return value === "1W" ||
    value === "1M" ||
    value === "3M" ||
    value === "YTD" ||
    value === "1Y" ||
    value === "ALL"
    ? value
    : "1M";
}

function normalizeOrderTab(raw: unknown): OrderTab {
  return raw === "history" ? "history" : "working";
}

function currencyOf(accounts: BrokerAccountSnapshot[]): string {
  return accounts[0]?.currency || "USD";
}

function accountMetricUpdatedAt(accounts: BrokerAccountSnapshot[]): Date | null {
  const timestamps = accounts
    .map((account) => account.updatedAt?.getTime?.() ?? 0)
    .filter(Boolean);
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

function sumAccounts(
  accounts: BrokerAccountSnapshot[],
  key: keyof BrokerAccountSnapshot,
): number | null {
  const values = accounts
    .map((account) => toNumber(account[key]))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function weightedAccountAverage(
  accounts: BrokerAccountSnapshot[],
  key: keyof BrokerAccountSnapshot,
): number | null {
  const weighted = accounts
    .map((account) => {
      const value = toNumber(account[key]);
      const nav = toNumber(account.netLiquidation);
      return value === null || nav === null ? null : { value, nav: Math.abs(nav) };
    })
    .filter((entry): entry is { value: number; nav: number } => Boolean(entry));
  const denominator = weighted.reduce((sum, entry) => sum + entry.nav, 0);
  if (!weighted.length || denominator <= 0) {
    return null;
  }
  return (
    weighted.reduce((sum, entry) => sum + entry.value * entry.nav, 0) /
    denominator
  );
}

async function getLiveAccountUniverse(
  accountId: string,
  mode: RuntimeMode,
): Promise<AccountUniverse> {
  const accounts = await getIbkrClient()
    .listAccounts(mode)
    .catch(() => [] as BrokerAccountSnapshot[]);
  const requestedAccountId = accountId || COMBINED_ACCOUNT_ID;
  const isCombined = requestedAccountId === COMBINED_ACCOUNT_ID;
  const selectedAccounts = isCombined
    ? accounts
    : accounts.filter((account) => account.id === requestedAccountId);

  if (!selectedAccounts.length) {
    const flexAccounts = await getFlexBackedAccounts(requestedAccountId, mode);
    if (flexAccounts.length) {
      return {
        requestedAccountId,
        accountIds: flexAccounts.map((account) => account.id),
        isCombined,
        accounts: flexAccounts,
        primaryCurrency: currencyOf(flexAccounts),
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
    return getIbkrClient().listPositions({
      accountId: universe.accountIds[0],
      mode,
    });
  }

  const positions = await Promise.all(
    universe.accountIds.map((accountId) =>
      getIbkrClient().listPositions({ accountId, mode }),
    ),
  );
  return positions.flat();
}

async function listOrdersForUniverse(
  universe: AccountUniverse,
  mode: RuntimeMode,
): Promise<BrokerOrderSnapshot[]> {
  const orders = await Promise.all(
    universe.accountIds.map((accountId) =>
      getIbkrClient().listOrders({ accountId, mode }),
    ),
  );
  return orders.flat();
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
      getIbkrClient().listExecutions({
        accountId,
        days: options.days,
        limit: options.limit,
        symbol: options.symbol,
      }),
    ),
  );
  return executions.flat();
}

function terminalOrderStatus(status: BrokerOrderSnapshot["status"]): boolean {
  return (
    status === "filled" ||
    status === "canceled" ||
    status === "rejected" ||
    status === "expired"
  );
}

function workingOrderStatus(status: BrokerOrderSnapshot["status"]): boolean {
  return !terminalOrderStatus(status);
}

function normalizeAssetClassLabel(position: BrokerPositionSnapshot): string {
  if (position.assetClass === "option") {
    return "Options";
  }
  if (ETF_SYMBOLS.has(position.symbol.toUpperCase())) {
    return "ETF";
  }
  return "Stocks";
}

function normalizeTradeAssetClassLabel(input: {
  assetClass: string | null | undefined;
  symbol: string;
}): string {
  const normalized = (input.assetClass ?? "").trim().toLowerCase();
  if (normalized.includes("option")) {
    return "Options";
  }
  if (ETF_SYMBOLS.has(input.symbol.toUpperCase())) {
    return "ETF";
  }
  return "Stocks";
}

function positionGroupKey(position: BrokerPositionSnapshot): string {
  if (position.optionContract) {
    return [
      "option",
      position.optionContract.underlying,
      formatDateOnly(position.optionContract.expirationDate),
      position.optionContract.strike,
      position.optionContract.right,
    ].join(":");
  }
  return `equity:${position.symbol.toUpperCase()}`;
}

function orderGroupKey(order: BrokerOrderSnapshot): string {
  if (order.optionContract) {
    return [
      "option",
      order.optionContract.underlying,
      formatDateOnly(order.optionContract.expirationDate),
      order.optionContract.strike,
      order.optionContract.right,
    ].join(":");
  }
  return `equity:${order.symbol.toUpperCase()}`;
}

function sectorForSymbol(symbol: string): string {
  return STATIC_SECTOR_BY_SYMBOL[symbol.toUpperCase()] ?? "Unknown";
}

function betaForSymbol(symbol: string): number {
  return BETA_BY_SYMBOL[symbol.toUpperCase()] ?? 1;
}

function weightPercent(value: number, nav: number | null): number | null {
  if (!nav || nav === 0) {
    return null;
  }
  return (value / nav) * 100;
}

function exposureSummary(positions: BrokerPositionSnapshot[]) {
  const grossLong = positions
    .filter((position) => position.marketValue > 0)
    .reduce((sum, position) => sum + position.marketValue, 0);
  const grossShort = Math.abs(
    positions
      .filter((position) => position.marketValue < 0)
      .reduce((sum, position) => sum + position.marketValue, 0),
  );
  const netExposure = positions.reduce(
    (sum, position) => sum + position.marketValue,
    0,
  );

  return {
    grossLong,
    grossShort,
    netExposure,
  };
}

function positionReferenceSymbol(position: BrokerPositionSnapshot): string {
  return position.optionContract?.underlying ?? position.symbol;
}

function hasOptionContract(
  position: BrokerPositionSnapshot,
): position is OptionPositionSnapshot {
  return position.assetClass === "option" && Boolean(position.optionContract);
}

function optionChainGroupKey(
  optionContract: NonNullable<BrokerPositionSnapshot["optionContract"]>,
): string {
  return `${normalizeSymbol(optionContract.underlying)}:${formatDateOnly(optionContract.expirationDate)}`;
}

function optionContractTupleKey(input: {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: string;
}): string {
  return [
    normalizeSymbol(input.underlying),
    formatDateOnly(input.expirationDate),
    String(Number(input.strike)),
    input.right.toLowerCase(),
  ].join(":");
}

function contractMultiplierForPosition(position: OptionPositionSnapshot): number {
  const optionContract = position.optionContract;
  return (
    toNumber(optionContract.sharesPerContract) ??
    toNumber(optionContract.multiplier) ??
    100
  );
}

function scaleOptionGreek(
  value: number | null,
  position: OptionPositionSnapshot,
): number | null {
  return value === null
    ? null
    : value * position.quantity * contractMultiplierForPosition(position);
}

function sumNullableValues(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => isFiniteNumber(value));
  return filtered.length ? filtered.reduce((sum, value) => sum + value, 0) : null;
}

function upsertNullableTotal(
  current: number | null,
  next: number | null,
): number | null {
  if (next === null) {
    return current;
  }
  return (current ?? 0) + next;
}

function matchOptionChainContract(
  contracts: OptionChainContract[],
  optionContract: NonNullable<BrokerPositionSnapshot["optionContract"]>,
): OptionChainContract | null {
  const providerContractId = optionContract.providerContractId
    ? String(optionContract.providerContractId)
    : null;

  if (providerContractId) {
    const directMatch =
      contracts.find(
        (contract) =>
          contract.contract.providerContractId &&
          String(contract.contract.providerContractId) === providerContractId,
      ) ?? null;
    if (directMatch) {
      return directMatch;
    }
  }

  const tupleKey = optionContractTupleKey({
    underlying: optionContract.underlying,
    expirationDate: optionContract.expirationDate,
    strike: optionContract.strike,
    right: optionContract.right,
  });

  return (
    contracts.find(
      (contract) =>
        optionContractTupleKey({
          underlying: contract.contract.underlying,
          expirationDate: contract.contract.expirationDate,
          strike: contract.contract.strike,
          right: contract.contract.right,
        }) === tupleKey,
    ) ?? null
  );
}

function mergeOptionChainContracts(
  contractSets: OptionChainContract[][],
): OptionChainContract[] {
  const merged = new Map<string, OptionChainContract>();

  contractSets.flat().forEach((contract) => {
    const key =
      contract.contract.providerContractId
        ? `conid:${contract.contract.providerContractId}`
        : `tuple:${optionContractTupleKey({
            underlying: contract.contract.underlying,
            expirationDate: contract.contract.expirationDate,
            strike: contract.contract.strike,
            right: contract.contract.right,
          })}`;
    merged.set(key, contract);
  });

  return Array.from(merged.values());
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

function xmlDecode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseXmlAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = attributePattern.exec(raw);

  while (match) {
    attributes[match[1]] = xmlDecode(match[3] ?? match[4] ?? "");
    match = attributePattern.exec(raw);
  }

  return attributes;
}

function extractFlexRecords(xml: string, tagNames: string[]): FlexRecord[] {
  const tags = tagNames.join("|");
  const pattern = new RegExp(
    `<(${tags})\\b([^>]*?)(?:/>|>[\\s\\S]*?</\\1>)`,
    "gi",
  );
  const records: FlexRecord[] = [];
  let match = pattern.exec(xml);

  while (match) {
    records.push({
      tag: match[1],
      attributes: parseXmlAttributes(match[2] ?? ""),
    });
    match = pattern.exec(xml);
  }

  return records;
}

function extractTagText(xml: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = xml.match(pattern);
  return match ? xmlDecode(match[1].trim()) : null;
}

type FlexConfig = { token: string; queryId: string };

function getFlexConfigs(): FlexConfig[] | null {
  const token = process.env["IBKR_FLEX_TOKEN"]?.trim();
  const queryIds = (process.env["IBKR_FLEX_QUERY_ID"] ?? "")
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);

  return token && queryIds.length
    ? queryIds.map((queryId) => ({ token, queryId }))
    : null;
}

function getFlexConfig(): FlexConfig | null {
  return getFlexConfigs()?.[0] ?? null;
}

function flexConfigured(): boolean {
  return Boolean(getFlexConfigs()?.length);
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

  const rawXml = await fetchFlexEndpoint(FLEX_SEND_REQUEST_URL, params);
  const status = extractTagText(rawXml, "Status");
  const referenceCode =
    extractTagText(rawXml, "ReferenceCode") ??
    extractTagText(rawXml, "Reference") ??
    "";
  const statementUrl = extractTagText(rawXml, "Url");

  if (!referenceCode) {
    throw new HttpError(502, "IBKR Flex did not return a reference code.", {
      code: "ibkr_flex_missing_reference",
      detail: rawXml.slice(0, 500),
    });
  }

  if (status && !/^success$/i.test(status)) {
    throw new HttpError(502, `IBKR Flex returned status "${status}".`, {
      code: "ibkr_flex_request_rejected",
      detail: rawXml.slice(0, 500),
    });
  }

  return { referenceCode, statementUrl, rawXml };
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function buildFlexBackfillWindows(reason: string, now = new Date()): Array<{
  fromDate: string;
  toDate: string;
}> {
  const end = startOfUtcDay(now);
  const manualBackfill =
    /manual|test|backfill|import/i.test(reason) || reason === "scheduled-initial";
  const historyStart = manualBackfill
    ? new Date(Date.UTC(end.getUTCFullYear() - FLEX_MAX_HISTORY_YEARS, 0, 1))
    : addUtcDays(end, -(FLEX_MAX_OVERRIDE_DAYS - 1));
  const windows: Array<{ fromDate: string; toDate: string }> = [];

  for (let cursor = historyStart; cursor <= end; cursor = addUtcDays(cursor, FLEX_MAX_OVERRIDE_DAYS)) {
    const windowEndCandidate = addUtcDays(cursor, FLEX_MAX_OVERRIDE_DAYS - 1);
    const windowEnd = windowEndCandidate <= end ? windowEndCandidate : end;
    windows.push({
      fromDate: formatDateOnly(cursor),
      toDate: formatDateOnly(windowEnd),
    });
  }

  return windows;
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
        deposits: numericString(
          firstNumber(attrs, [
            "deposits",
            "depositsWithdrawals",
            "depositsAndWithdrawals",
          ]),
        ),
        withdrawals: numericString(firstNumber(attrs, ["withdrawals"])),
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
      parseDate(
        [
          firstString(attrs, ["tradeDate", "date"]),
          firstString(attrs, ["tradeTime"]),
        ]
          .filter(Boolean)
          .join(" "),
      ) ?? parseDate(firstString(attrs, ["dateTime", "when"]));

    if (!tradeDate) {
      return [];
    }

    const tradeId =
      firstString(attrs, ["tradeID", "tradeId", "execID", "ibExecID"]) ??
      `${providerAccountId}:${symbol}:${tradeDate.toISOString()}:${index}`;
    const rawSide =
      firstString(attrs, ["buySell", "side", "transactionType"]) ?? "";
    const side = /^s/i.test(rawSide) ? "sell" : "buy";

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
        settleDate:
          parseDate(firstString(attrs, ["settleDate"])) ? formatDateOnly(parseDate(firstString(attrs, ["settleDate"])) as Date) : null,
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
          price: sql`excluded.price`,
          amount: sql`excluded.amount`,
          commission: sql`excluded.commission`,
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
        marketValue: numericString(firstNumber(attrs, ["marketValue", "value"])),
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

export function startAccountFlexRefreshScheduler(): void {
  if (!flexConfigured()) {
    logger.info("IBKR Flex env vars are not configured; daily Flex refresh disabled");
    return;
  }

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

export async function recordAccountSnapshots(
  accounts: BrokerAccountSnapshot[],
): Promise<void> {
  const now = Date.now();
  const dueAccounts = accounts.filter((account) => {
    const last = snapshotWriteTimestamps.get(account.id) ?? 0;
    return now - last >= SNAPSHOT_WRITE_INTERVAL_MS;
  });

  if (!dueAccounts.length) {
    return;
  }

  const mode = dueAccounts[0]?.mode ?? getRuntimeMode();
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

  for (const account of dueAccounts) {
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
    snapshotWriteTimestamps.set(account.id, now);
  }
}

export async function getAccountSummary(input: {
  accountId: string;
  mode?: RuntimeMode;
}) {
  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const positions = await listPositionsForUniverse(universe, mode);
  const updatedAt = accountMetricUpdatedAt(universe.accounts) ?? new Date();
  const currency = universe.primaryCurrency;
  const nav = sumAccounts(universe.accounts, "netLiquidation") ?? 0;
  const initialNav = await getInitialFlexNav(universe.accountIds);
  const totalPnl = initialNav === null ? null : nav - initialNav;

  const dayPnl = positions.reduce(
    (sum, position) => sum + (position.unrealizedPnl ?? 0),
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
        sumAccounts(universe.accounts, "initialMargin") ??
          sumAccounts(universe.accounts, "maintenanceMargin"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "InitMarginReq",
        updatedAt,
      ),
      maintenanceMargin: metric(
        sumAccounts(universe.accounts, "maintenanceMargin"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "MaintMarginReq",
        updatedAt,
      ),
      maintenanceMarginCushionPercent: metric(
        weightedAccountAverage(universe.accounts, "cushion"),
        null,
        "IBKR_ACCOUNT_SUMMARY",
        "Cushion",
        updatedAt,
      ),
      dayPnl: metric(dayPnl, currency, "IBKR_POSITIONS", "UnrealizedPnL", updatedAt),
      dayPnlPercent: metric(
        nav ? (dayPnl / nav) * 100 : null,
        null,
        "IBKR_POSITIONS",
        "UnrealizedPnL/NetLiquidation",
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
          positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "GrossPositionValue",
        updatedAt,
      ),
    },
  };
}

function inferAccountType(accountId: string): string {
  if (/du|paper/i.test(accountId)) {
    return "Paper";
  }
  if (/ira/i.test(accountId)) {
    return "IRA";
  }
  return "Margin";
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

function benchmarkTimeframeForRange(range: AccountRange): "1h" | "1d" {
  return range === "1W" || range === "1M" ? "1h" : "1d";
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
      timeframe: benchmarkTimeframeForRange(input.range),
      from:
        input.start ??
        input.points[0]?.timestamp ??
        new Date(Date.now() - 365 * 86_400_000),
      to: input.points[input.points.length - 1]?.timestamp ?? new Date(),
      limit: input.range === "1W" ? 300 : 1_000,
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
  const mode = input.mode ?? getRuntimeMode();
  const range = normalizeRange(input.range);
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const start = rangeStart(range);
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

  const snapshotConditions = [
    inArray(brokerAccountsTable.providerAccountId, universe.accountIds),
  ];
  if (start) {
    snapshotConditions.push(gte(balanceSnapshotsTable.asOf, start));
  }

  const rawSnapshotRows = await db
    .select({
      providerAccountId: brokerAccountsTable.providerAccountId,
      asOf: balanceSnapshotsTable.asOf,
      currency: balanceSnapshotsTable.currency,
      netLiquidation: balanceSnapshotsTable.netLiquidation,
    })
    .from(balanceSnapshotsTable)
    .innerJoin(
      brokerAccountsTable,
      eq(balanceSnapshotsTable.accountId, brokerAccountsTable.id),
    )
    .where(and(...snapshotConditions))
    .orderBy(balanceSnapshotsTable.asOf);
  const snapshotRows = compactEquitySnapshotRows(rawSnapshotRows, range);

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

  snapshotRows.forEach((row) => {
    const key = row.asOf.toISOString();
    const current = byTimestamp.get(key);
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

  const sortedSeedPoints = trimLeadingInactiveEquityPoints(
    Array.from(byTimestamp.values()).sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    ),
  );
  const baselineNetLiquidation =
    sortedSeedPoints.find((point) => Math.abs(point.netLiquidation) > 0)
      ?.netLiquidation ??
    sortedSeedPoints[0]?.netLiquidation ??
    0;

  const points = sortedSeedPoints.map((point) => {
      return {
        timestamp: point.timestamp,
        netLiquidation: point.netLiquidation,
        currency: point.currency,
        source: point.source,
        deposits: point.deposits,
        withdrawals: point.withdrawals,
        dividends: point.dividends,
        fees: point.fees,
        returnPercent: baselineNetLiquidation
          ? ((point.netLiquidation - baselineNetLiquidation) /
              baselineNetLiquidation) *
            100
          : 0,
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
  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const positions = await listPositionsForUniverse(universe, mode);
  const nav = sumAccounts(universe.accounts, "netLiquidation") ?? 0;

  await upsertTickerReferenceCache(positions);

  const assetBuckets = new Map<string, number>();
  const sectorBuckets = new Map<string, number>();
  positions.forEach((position) => {
    const assetClass = normalizeAssetClassLabel(position);
    const sector = sectorForSymbol(positionReferenceSymbol(position));
    assetBuckets.set(assetClass, (assetBuckets.get(assetClass) ?? 0) + position.marketValue);
    sectorBuckets.set(sector, (sectorBuckets.get(sector) ?? 0) + position.marketValue);
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
    exposure: exposureSummary(positions),
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
            assetClass: ETF_SYMBOLS.has(symbol) ? "ETF" : "Stock",
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
  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const positionsPromise = listPositionsForUniverse(universe, mode);
  const [positions, orders, lots, greekEnrichment] = await Promise.all([
    positionsPromise,
    listOrdersForUniverse(universe, mode),
    getPositionLots(universe.accountIds),
    positionsPromise.then((result) => enrichPositionGreeks(result)),
  ]);
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
          const marketValueWeight = Math.abs(position.marketValue ?? 0);

          current.quantity += position.quantity;
          current.averageCostAccumulator += position.averagePrice * quantityWeight;
          current.markAccumulator += position.marketPrice * quantityWeight;
          current.averageWeight += quantityWeight;
          current.unrealizedWeight += marketValueWeight;
          current.unrealizedPnl += position.unrealizedPnl;
          current.unrealizedPnlPercentAccumulator +=
            (position.unrealizedPnlPercent ?? 0) * marketValueWeight;
          current.marketValue += position.marketValue ?? 0;
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
        sector: row.sector,
        quantity: row.quantity,
        averageCost:
          row.averageWeight > 0
            ? row.averageCostAccumulator / row.averageWeight
            : 0,
        mark: row.averageWeight > 0 ? row.markAccumulator / row.averageWeight : 0,
        dayChange: row.dayChange,
        dayChangePercent: row.dayChangePercent,
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
      }))
    : filteredPositions.map((position) => {
        const marketValue = position.marketValue ?? 0;
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
          sector: sectorForSymbol(referenceSymbol),
          quantity: position.quantity,
          averageCost: position.averagePrice,
          mark: position.marketPrice,
          dayChange: null,
          dayChangePercent: null,
          unrealizedPnl: position.unrealizedPnl,
          unrealizedPnlPercent: position.unrealizedPnlPercent,
          marketValue,
          weightPercent: weightPercent(marketValue, nav),
          betaWeightedDelta: greek?.betaWeightedDelta ?? null,
          lots: lotRowsBySymbol.get(position.symbol.toUpperCase()) ?? [],
          openOrders:
            (openOrdersBySymbol.get(position.symbol.toUpperCase()) ?? []).filter(
              (order) => orderGroupKey(order) === positionGroupKey(position),
            ),
          source: "IBKR_POSITIONS",
        };
      });

  const exposure = exposureSummary(filteredPositions);
  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    positions: rows,
    totals: {
      weightPercent: rows.reduce((sum, row) => sum + (row.weightPercent ?? 0), 0),
      unrealizedPnl: rows.reduce((sum, row) => sum + row.unrealizedPnl, 0),
      grossLong: exposure.grossLong,
      grossShort: exposure.grossShort,
      netExposure: exposure.netExposure,
    },
    updatedAt: accountMetricUpdatedAt(universe.accounts) ?? new Date(),
  };
}

async function getPositionLots(accountIds: string[]) {
  if (!accountIds.length) {
    return [];
  }

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
  const mode = input.mode ?? getRuntimeMode();
  const tab = normalizeOrderTab(input.tab);
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const orders = await listOrdersForUniverse(universe, mode);
  const filtered = orders.filter((order) =>
    tab === "working" ? workingOrderStatus(order.status) : terminalOrderStatus(order.status),
  );

  return {
    accountId: universe.requestedAccountId,
    tab,
    currency: universe.primaryCurrency,
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
  if (getRuntimeMode() === "live" && input.confirm !== true) {
    throw new HttpError(409, "Live order cancellation requires confirmation.", {
      code: "ibkr_live_cancel_confirmation_required",
      expose: true,
    });
  }

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
  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const [positions, closedTrades] = await Promise.all([
    listPositionsForUniverse(universe, mode),
    listClosedTradesForUniverse(universe, {}),
  ]);
  const greekEnrichment = await enrichPositionGreeks(positions);
  const nav = sumAccounts(universe.accounts, "netLiquidation") ?? 0;
  const exposure = exposureSummary(positions);
  const sectorMap = new Map<string, number>();
  positions.forEach((position) => {
    const sector = sectorForSymbol(positionReferenceSymbol(position));
    sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + position.marketValue);
  });

  const positionRows = positions
    .map((position) => ({
      symbol: position.symbol,
      marketValue: position.marketValue,
      weightPercent: weightPercent(position.marketValue, nav),
      unrealizedPnl: position.unrealizedPnl,
      sector: sectorForSymbol(positionReferenceSymbol(position)),
    }))
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
    entry.exposure += position.marketValue;
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
        .filter((row) => row.unrealizedPnl > 0)
        .sort((a, b) => b.unrealizedPnl - a.unrealizedPnl)
        .slice(0, 5),
      todayLosers: positionRows
        .filter((row) => row.unrealizedPnl < 0)
        .sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)
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
      marginUsed: sumAccounts(universe.accounts, "initialMargin"),
      marginAvailable: sumAccounts(universe.accounts, "excessLiquidity"),
      maintenanceMargin: sumAccounts(universe.accounts, "maintenanceMargin"),
      maintenanceCushionPercent: weightedAccountAverage(universe.accounts, "cushion"),
      dayTradingBuyingPower: sumAccounts(universe.accounts, "dayTradingBuyingPower"),
      sma: sumAccounts(universe.accounts, "sma"),
      regTInitialMargin: sumAccounts(universe.accounts, "regTInitialMargin"),
      pdtDayTradeCount: null,
      providerFields: {
        marginUsed: "InitMarginReq",
        marginAvailable: "ExcessLiquidity",
        maintenanceMargin: "MaintMarginReq",
        maintenanceCushionPercent: "Cushion",
        dayTradingBuyingPower: "DayTradingBuyingPower",
        sma: "SMA",
        regTInitialMargin: "RegTMargin",
      },
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

function buildExpiryConcentration(positions: BrokerPositionSnapshot[]) {
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  const month = now + 30 * 86_400_000;
  const ninety = now + 90 * 86_400_000;
  const buckets = {
    thisWeek: 0,
    thisMonth: 0,
    next90Days: 0,
  };

  positions.forEach((position) => {
    const expiry = position.optionContract?.expirationDate?.getTime?.();
    if (!expiry) {
      return;
    }
    const notional = Math.abs(position.marketValue);
    if (expiry <= week) {
      buckets.thisWeek += notional;
    }
    if (expiry <= month) {
      buckets.thisMonth += notional;
    }
    if (expiry <= ninety) {
      buckets.next90Days += notional;
    }
  });

  return buckets;
}

export async function getAccountCashActivity(input: {
  accountId: string;
  from?: Date | null;
  to?: Date | null;
  mode?: RuntimeMode;
}) {
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
  const latestSnapshot = await db
    .select({ asOf: balanceSnapshotsTable.asOf })
    .from(balanceSnapshotsTable)
    .orderBy(desc(balanceSnapshotsTable.asOf))
    .limit(1);
  const [snapshotCoverage] = await db
    .select({
      firstAsOf: sql<Date | null>`min(${balanceSnapshotsTable.asOf})`,
      lastAsOf: sql<Date | null>`max(${balanceSnapshotsTable.asOf})`,
      rowCount: sql<number>`count(*)::int`,
    })
    .from(balanceSnapshotsTable);
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

  return {
    bridgeConnected: null,
    flexConfigured: flexConfigured(),
    flexTokenPresent: Boolean(process.env["IBKR_FLEX_TOKEN"]?.trim()),
    flexQueryIdPresent: Boolean(process.env["IBKR_FLEX_QUERY_ID"]?.trim()),
    schemaReady: schema.missingTables.length === 0 && schema.schemaError === null,
    missingTables: schema.missingTables,
    schemaError: schema.schemaError,
    lastSuccessfulRefreshAt:
      lastRun?.status === "completed" ? lastRun.completedAt : null,
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
  };
}

export async function testFlexToken() {
  const result = await refreshFlexReport("manual-test");
  return {
    message: "Flex report pulled and normalized successfully.",
    ...result,
  };
}
