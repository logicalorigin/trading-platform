import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  algoDeploymentsTable,
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  executionEventsTable,
  flexCashActivityTable,
  flexDividendsTable,
  flexNavHistoryTable,
  flexOpenPositionsTable,
  flexReportRunsTable,
  flexTradesTable,
  instrumentsTable,
  positionLotsTable,
  pool,
  runInDbLane,
  runWithDbAdmissionSignal,
} from "@workspace/db";
import {
  calculateTransferAdjustedReturnSummary,
  externalTransferAmount,
} from "@workspace/account-math";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  createTransientPostgresBackoff,
  isStatementTimeoutError,
  isTransientPostgresError,
} from "../lib/transient-db-error";
import { normalizeSymbol, toIsoDateString } from "../lib/values";
import { getRuntimeMode, type RuntimeMode } from "../lib/runtime";
import { getCurrentAppUserId } from "./app-user-context";
import {
  cancelOrder,
  getBars,
  getOptionChain,
  getQuoteSnapshots,
  listOrders,
} from "./platform";
import {
  listIbkrAccounts,
  listIbkrExecutions,
  listIbkrPositions,
} from "./ibkr-account-bridge";
import {
  recordAccountPositionsTiming,
  type AccountPositionsCacheDisposition,
  type AccountPositionsStage,
} from "./runtime-flight-recorder";
import {
  getShadowAccountAllocation,
  getShadowAccountCashActivity,
  getShadowAccountClosedTrades,
  getShadowAccountEquityHistory,
  getShadowAccountOrders,
  getShadowAccountPositions,
  getShadowAccountPositionsAtDate,
  getShadowAccountRisk,
  getShadowAccountSummary,
  isShadowAccountId,
} from "./shadow-account";
import {
  accountBenchmarkLimitForRange,
  accountBenchmarkTimeframeForRange,
  accountRangeStart,
  normalizeAccountRange,
  type AccountRange,
} from "./account-ranges";
import {
  buildPositionQuoteFromSnapshot,
  buildPositionMarketHydration,
  canHydratePositionFromEquityQuote,
  choosePositionQuote,
  filterOpenBrokerPositions,
  isOpenBrokerPosition,
  positionAveragePrice,
  positionMarketPrice,
  positionPnlBasis,
  positionPnlPercent,
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
  aggregateCombinedEquitySeedPoints,
  aggregateCombinedEquitySnapshotRows,
  calculateTransferAdjustedReturnPoints,
  classifyExternalCashTransfer,
  compactEquitySnapshotRows,
  dedupeEquitySnapshotRows,
  equitySnapshotBucketSizeMs,
  filterSnapshotsOnFlexTransferDates,
  filterPlaceholderZeroEquitySnapshotRows,
  isPlaceholderZeroAccountSnapshot,
  persistedAccountRowsToSnapshots,
  trimLeadingInactiveEquityPoints,
  type AccountEquityHistorySeedPoint,
} from "./account-equity-history-model";
import {
  accountOptionCalendarDte,
  accountPositionSourceForProvider,
  accountTradeCurrenciesMatch,
  combineAccountPositionSources,
  normalizeAssetClassLabel,
  normalizeOrderTab,
  normalizeTradeAssetClassLabel,
  optionContractGroupKey,
  orderGroupKey,
  positionGroupKey,
  summarizeAccountClosedTrades,
  terminalOrderStatus,
  workingOrderStatus,
  type AccountPositionSource,
  type OrderTab,
} from "./account-trade-model";
import {
  accountPositionTypeMatchesFilter,
  classifyAccountPositionType,
  normalizeAccountPositionTypeFilter,
} from "./account-position-type";
import {
  aggregateGreeksByUnderlying,
  betaForSymbol,
  buildExpiryConcentration,
  buildGreekScenarioMatrixInput,
  buildNotionalExposure,
  exposureSummary,
  hasOptionContract,
  hydratedPositionMarketValue,
  matchOptionChainContract,
  mergeOptionChainContracts,
  optionChainGroupKey,
  scaleOptionGreek,
  sectorForSymbol,
  sumNullableValues,
  weightPercent,
  type OptionGreekEnrichmentResult,
  type OptionPositionSnapshot,
  type PositionGreekSnapshot,
} from "./account-risk-model";
import {
  resolveAccountGreekScenarios,
  type AccountGreekScenarios,
} from "./account-greek-scenarios";
import { resolveAccountPortfolioRisk } from "./account-portfolio-risk";
import { buildAccountRiskRecommendations } from "./account-risk-recommendations";
import {
  buildFlexBackfillWindows,
  extractFlexRecords,
  extractTagText,
  flexConfigured,
  getFlexConfigs,
} from "./account-flex-model";
import {
  declareOptionQuoteDemand,
  type OptionQuoteDemandStatus,
  type OptionQuoteDemandQuoteState,
  readOptionQuoteDemandState,
  releaseOptionQuoteDemand,
} from "./option-quote-demand-coordinator";
import {
  fetchMassiveOptionQuoteSnapshots,
  normalizeOpraOptionTicker,
} from "./massive-option-quote-stream";
import {
  buildSnapTradeAccountPortfolioTotals,
  getSnapTradeAccountPortfolio,
  readLatestSnapTradeAccountPortfolio,
  rememberLatestSnapTradeAccountPortfolio,
  SNAPTRADE_ACCOUNT_PORTFOLIO_CACHE_TTL_MS,
  type SnapTradeAccountPortfolioStage,
  type SnapTradeAccountPortfolioResponse,
} from "./snaptrade-account-portfolio";
import {
  readSnapTradeAccountClosedTrades,
  readSnapTradeAccountEquitySeedPoints,
  type SnapTradeHistoryOptionContract,
  type SnapTradeHistoryTrade,
} from "./snaptrade-account-history";
import { readRobinhoodAccountActivities } from "./robinhood-account-history";
import { readRobinhoodAccountPositions } from "./robinhood-account-positions";
import { getRobinhoodAccessToken } from "./robinhood-oauth";
import { ownedBy } from "./scoped-db";
import { RobinhoodMcpSession } from "../providers/robinhood/mcp-client";
import type {
  BrokerAccountSnapshot,
  BrokerExecutionSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  OptionChainContract,
  PositionQuoteSnapshot,
  QuoteSnapshot,
} from "../providers/ibkr/client";

const COMBINED_ACCOUNT_ID = "combined";
const ACCOUNT_POSITION_MARKET_DATA_TTL_MS = 15_000;
const ACCOUNT_PAGE_SHARED_LIVE_READ_CACHE_TTL_MS = 2_000;
const ACCOUNT_LIST_RESPONSE_CACHE_TTL_MS = 5_000;
const ACCOUNT_ROUTE_EQUITY_HISTORY_RESPONSE_CACHE_TTL_MS = 30_000;
const ACCOUNT_ROUTE_DERIVED_RESPONSE_CACHE_TTL_MS = 60_000;
const ACCOUNT_ROUTE_CLOSED_TRADES_RESPONSE_CACHE_TTL_MS =
  ACCOUNT_PAGE_SHARED_LIVE_READ_CACHE_TTL_MS;
const ACCOUNT_POSITION_OPEN_DATE_CACHE_TTL_MS = 30_000;
const ACCOUNT_POSITION_OPEN_DATE_STALE_TTL_MS = 5 * 60_000;
const ACCOUNT_POSITION_OPTION_QUOTE_REFRESH_TIMEOUT_MS = 5_000;
export const ACCOUNT_FULL_RISK_CACHE_TTL_MS = 30_000;
export const ACCOUNT_FULL_RISK_STALE_TTL_MS = 5 * 60_000;
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
// Per-SnapTrade-account live balance cache. Balances are not persisted for
// SnapTrade accounts, so the account list fetches them live from the SnapTrade
// portfolio endpoint and caches the result briefly so repeated list builds (each
// a cold miss on the 5s route-response cache) do not fan out to SnapTrade upstream
// on every request.
const SNAPTRADE_BALANCE_CACHE_TTL_MS =
  SNAPTRADE_ACCOUNT_PORTFOLIO_CACHE_TTL_MS;
const SNAPTRADE_BALANCE_FETCH_CONCURRENCY = 4;
const ROBINHOOD_LOCAL_ID_PREFIX = "robinhood:";
const ROBINHOOD_BALANCE_CACHE_TTL_MS = 45_000;
const ROBINHOOD_BALANCE_FETCH_CONCURRENCY = 4;

type AccountMetric = {
  value: number | null;
  currency: string | null;
  source: "IBKR_ACCOUNT_SUMMARY" | "IBKR_POSITIONS" | "FLEX" | "LOCAL_LEDGER";
  field: string;
  updatedAt: Date | null;
};

const ACCOUNT_MARKET_TIME_ZONE = "America/New_York";
const accountMarketDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ACCOUNT_MARKET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// True when the position was opened during the current market day (America/New_York).
// Used so the day-change column reflects the change since WE entered (our unrealized
// P&L), not the underlying's full move from prior close, which includes movement
// before we took the position.
const accountPositionOpenedOnCurrentMarketDay = (
  openedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean => {
  const openedKey = accountMarketDateKey(openedAt ?? null);
  const nowKey = accountMarketDateKey(now);
  return Boolean(openedKey && nowKey && openedKey === nowKey);
};

type BackedAccountIdentity = Omit<
  BrokerAccountSnapshot,
  "buyingPower" | "cash" | "netLiquidation"
>;

type AccountUniverse = {
  appUserId?: string | null;
  allowDirectIbkr: boolean;
  requestedAccountId: string;
  accountIds: string[];
  isCombined: boolean;
  accounts: BrokerAccountSnapshot[];
  positionOnlyAccounts?: BackedAccountIdentity[];
  primaryCurrency: string;
  source: "live" | "snaptrade" | "robinhood" | "broker";
  latestSnapshotAt: Date | null;
};

const UUID_V4_OR_COMPATIBLE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isProviderBackedAccount(account: BrokerAccountSnapshot): boolean {
  return account.provider === "snaptrade" || account.provider === "robinhood";
}

const IBKR_ACCOUNT_TEXT_PATTERN =
  /\b(?:interactive(?:\s+|-|_)+brokers|ibkr)\b/i;

function accountBrokerText(account: BackedAccountIdentity): string {
  const accountWithBrokerFields = account as BackedAccountIdentity &
    Record<string, unknown>;
  return [
    accountWithBrokerFields.brokerageName,
    accountWithBrokerFields.brokerage,
    accountWithBrokerFields.institutionName,
    accountWithBrokerFields.institution,
    accountWithBrokerFields.providerName,
    account.brokerageSlug,
    account.displayName,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .join(" ");
}

function isDirectIbkrAccount(account: BackedAccountIdentity): boolean {
  return account.provider === "ibkr";
}

function isSnapTradeIbkrAccount(account: BackedAccountIdentity): boolean {
  return (
    account.provider === "snaptrade" &&
    IBKR_ACCOUNT_TEXT_PATTERN.test(accountBrokerText(account))
  );
}

function accountIdentityLastFour(
  account: BackedAccountIdentity,
): string | null {
  for (const value of [
    account.accountNumberLastFour ?? "",
    account.providerAccountId,
    account.id,
    account.displayName,
  ]) {
    const digits = value.replace(/\D/gu, "");
    if (digits.length >= 4) {
      return digits.slice(-4);
    }
  }
  return null;
}

function filterDirectSupersededProviderAccounts<
  Account extends BackedAccountIdentity,
>(
  baseAccounts: BackedAccountIdentity[],
  providerAccounts: Account[],
): Account[] {
  if (!baseAccounts.some(isDirectIbkrAccount)) {
    return providerAccounts;
  }
  const directSuffixCounts = new Map<string, number>();
  for (const account of baseAccounts.filter(isDirectIbkrAccount)) {
    const suffix = accountIdentityLastFour(account);
    if (suffix) {
      directSuffixCounts.set(suffix, (directSuffixCounts.get(suffix) ?? 0) + 1);
    }
  }
  const snapTradeSuffixCounts = new Map<string, number>();
  for (const account of providerAccounts.filter(isSnapTradeIbkrAccount)) {
    const suffix = accountIdentityLastFour(account);
    if (suffix) {
      snapTradeSuffixCounts.set(
        suffix,
        (snapTradeSuffixCounts.get(suffix) ?? 0) + 1,
      );
    }
  }
  return providerAccounts.filter((account) => {
    if (!isSnapTradeIbkrAccount(account)) {
      return true;
    }
    const suffix = accountIdentityLastFour(account);
    return (
      !suffix ||
      directSuffixCounts.get(suffix) !== 1 ||
      snapTradeSuffixCounts.get(suffix) !== 1
    );
  });
}

function mergeAccountsWithDirectIbkrSupersedence(
  baseAccounts: BrokerAccountSnapshot[],
  providerAccounts: BrokerAccountSnapshot[],
): BrokerAccountSnapshot[] {
  return [
    ...baseAccounts,
    ...filterDirectSupersededProviderAccounts(baseAccounts, providerAccounts),
  ];
}

function ibkrReadableAccountsForUniverse(
  universe: AccountUniverse,
): BrokerAccountSnapshot[] {
  return universe.source === "live"
    ? universe.accounts.filter((account) => !isProviderBackedAccount(account))
    : universe.accounts;
}

function accountUniverseIdentities(
  universe: AccountUniverse,
): BackedAccountIdentity[] {
  return [
    ...universe.accounts,
    ...(universe.positionOnlyAccounts ?? []),
  ];
}

function accountUniverseFinancialTotalsAvailable(
  universe: AccountUniverse,
): boolean {
  return (universe.positionOnlyAccounts?.length ?? 0) === 0;
}

function brokerAccountOwnershipCondition(appUserId: string | null) {
  return appUserId === null
    ? isNull(brokerAccountsTable.appUserId)
    : eq(brokerAccountsTable.appUserId, appUserId);
}

function brokerAccountSnapshotCondition(universe: AccountUniverse) {
  const localAccountIds = universe.accountIds.filter((accountId) =>
    UUID_V4_OR_COMPATIBLE_PATTERN.test(accountId),
  );
  const providerAccountCondition = inArray(
    brokerAccountsTable.providerAccountId,
    universe.accountIds,
  );
  const accountCondition = localAccountIds.length
    ? (or(
        providerAccountCondition,
        inArray(brokerAccountsTable.id, localAccountIds),
      ) ?? providerAccountCondition)
    : providerAccountCondition;
  return (
    and(
      brokerAccountOwnershipCondition(universe.appUserId ?? null),
      accountCondition,
    ) ?? sql<boolean>`false`
  );
}

function flexProviderAccountOwnershipCondition(
  providerAccountId: AnyPgColumn,
  appUserId: string | null | undefined,
  mode: RuntimeMode,
) {
  if (!appUserId) {
    return sql<boolean>`false`;
  }
  const ownedProviderAccountIds = db
    .select({ providerAccountId: brokerAccountsTable.providerAccountId })
    .from(brokerAccountsTable)
    .groupBy(brokerAccountsTable.providerAccountId)
    .having(
      sql<boolean>`count(*) = 1 and bool_and(${brokerAccountsTable.appUserId} is not distinct from ${appUserId}) and bool_and(${brokerAccountsTable.mode} = ${mode})`,
    );
  return inArray(providerAccountId, ownedProviderAccountIds);
}

type AccountRiskDetail = "fast" | "full";

type ShortLivedAccountCacheEntry<T> = {
  promise: Promise<T>;
  expiresAt: number;
  settled: boolean;
};

type AccountRouteResponseCacheEntry<T> = {
  promise: Promise<T> | null;
  value: T | null;
  hasValue: boolean;
  expiresAt: number;
};

type AccountPositionTotalsInput = {
  accounts: BrokerAccountSnapshot[];
  financialTotalsAvailable?: boolean;
  rows: Array<{
    weightPercent: number | null;
    unrealizedPnl: number;
  }>;
  grossLong: number;
  grossShort: number;
  netExposure: number;
};

type OptionChainCacheEntry = {
  expiresAt: number;
  contracts: OptionChainContract[];
  error: string | null;
};

const snapshotWriteTimestamps = new Map<string, number>();
const snapshotProviderTimestamps = new Map<string, number>();
const accountSnapshotPersistenceBackoff = createTransientPostgresBackoff();
const liveAccountUniverseReadCache = new Map<
  string,
  ShortLivedAccountCacheEntry<AccountUniverse>
>();
const accountPositionsReadCache = new Map<
  string,
  ShortLivedAccountCacheEntry<BrokerPositionSnapshot[]>
>();
const accountOrdersReadCache = new Map<
  string,
  ShortLivedAccountCacheEntry<AccountUniverseOrderResult>
>();
const accountExecutionsReadCache = new Map<
  string,
  ShortLivedAccountCacheEntry<BrokerExecutionSnapshot[]>
>();
const accountPositionOpenDatesReadCache = new Map<
  string,
  ShortLivedAccountCacheEntry<Map<string, PositionOpenDate>>
>();
const accountPositionOpenDatesLastKnownCache = new Map<
  string,
  {
    value: Map<string, PositionOpenDate>;
    expiresAt: number;
  }
>();
const positionMarketHydrationReadCache = new Map<
  string,
  ShortLivedAccountCacheEntry<Map<string, PositionMarketHydration>>
>();
const accountRouteResponseCache = new Map<
  string,
  AccountRouteResponseCacheEntry<unknown>
>();
const accountRouteResponseCacheSignal = new AbortController().signal;
const accountFullRiskCache = new Map<
  string,
  {
    value: unknown;
    cachedAt: number;
    expiresAt: number;
    staleExpiresAt: number;
  }
>();
const accountFullRiskInflight = new Map<string, Promise<unknown>>();
const snapTradeAccountBalanceCache = new Map<
  string,
  { value: TimedAccountBalanceValues<SnapTradeAccountBalanceValues>; expiresAt: number }
>();
const snapTradeAccountBalanceInflight = new Map<
  string,
  Promise<TimedAccountBalanceValues<SnapTradeAccountBalanceValues>>
>();
const robinhoodAccountBalanceCache = new Map<
  string,
  { value: TimedAccountBalanceValues<RobinhoodAccountBalanceValues>; expiresAt: number }
>();
const robinhoodAccountBalanceInflight = new Map<
  string,
  Promise<TimedAccountBalanceValues<RobinhoodAccountBalanceValues>>
>();

function readShortLivedAccountCache<T>(
  cache: Map<string, ShortLivedAccountCacheEntry<T>>,
  key: string,
  factory: () => Promise<T>,
  ttlMs = ACCOUNT_PAGE_SHARED_LIVE_READ_CACHE_TTL_MS,
  onRead?: (disposition: AccountPositionsCacheDisposition) => void,
): Promise<T> {
  const now = Date.now();
  for (const [entryKey, entry] of cache.entries()) {
    if (entry.settled && entry.expiresAt <= now) {
      cache.delete(entryKey);
    }
  }

  const cached = cache.get(key);
  if (cached && (!cached.settled || cached.expiresAt > now)) {
    onRead?.(cached.settled ? "hit" : "inflight");
    return cached.promise;
  }

  onRead?.("miss");
  const entry: ShortLivedAccountCacheEntry<T> = {
    promise: Promise.resolve().then(factory),
    expiresAt: Number.POSITIVE_INFINITY,
    settled: false,
  };
  entry.promise = entry.promise.then(
    (value) => {
      entry.settled = true;
      entry.expiresAt = Date.now() + ttlMs;
      return value;
    },
    (error) => {
      if (cache.get(key) === entry) {
        cache.delete(key);
      }
      throw error;
    },
  );
  cache.set(key, entry);
  return entry.promise;
}

function stableAccountReadCacheKey(
  route: string,
  input: Record<string, unknown>,
): string {
  return JSON.stringify({
    route,
    ...Object.fromEntries(
      Object.entries(input).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  });
}

function readAccountRouteResponseCache<T>(
  route: string,
  input: Record<string, unknown>,
  factory: () => Promise<T>,
  ttlMs: number,
): Promise<T> {
  const now = Date.now();
  for (const [entryKey, entry] of accountRouteResponseCache.entries()) {
    if (!entry.promise && entry.expiresAt <= now) {
      accountRouteResponseCache.delete(entryKey);
    }
  }

  const cacheKey = stableAccountReadCacheKey(route, input);
  const cached = accountRouteResponseCache.get(
    cacheKey,
  ) as AccountRouteResponseCacheEntry<T> | undefined;
  if (cached?.hasValue && cached.expiresAt > now) {
    return Promise.resolve(cached.value as T);
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const entry: AccountRouteResponseCacheEntry<T> = cached ?? {
    promise: null,
    value: null,
    hasValue: false,
    expiresAt: 0,
  };
  const request = runWithDbAdmissionSignal(
    accountRouteResponseCacheSignal,
    () => Promise.resolve().then(factory),
  ).then(
    (value) => {
      entry.promise = null;
      entry.value = value;
      entry.hasValue = true;
      const cachedAt = Date.now();
      entry.expiresAt = cachedAt + ttlMs;
      accountRouteResponseCache.set(cacheKey, entry);
      return value;
    },
    (error) => {
      entry.promise = null;
      if (accountRouteResponseCache.get(cacheKey) === entry) {
        accountRouteResponseCache.delete(cacheKey);
      }
      throw error;
    },
  );
  entry.promise = request;
  accountRouteResponseCache.set(cacheKey, entry);
  return request;
}
const optionGreekChainCache = new Map<string, OptionChainCacheEntry>();

function snapshotAccountCacheKey(
  account: BrokerAccountSnapshot,
  appUserId: string | null,
): string {
  return `${appUserId ?? "global"}:${account.mode}:${account.providerAccountId || account.id}`;
}

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
const accountSchemaReadinessProbeSignal = new AbortController().signal;
const loggedMissingAccountSchemaTables = new Set<OptionalAccountSchemaTable>();
let loggedAccountSchemaReadinessError: string | null = null;

function runAccountSchemaReadinessProbe<T>(probe: () => Promise<T>): Promise<T> {
  return runWithDbAdmissionSignal(accountSchemaReadinessProbeSignal, probe);
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

function accountMarketDateKey(value: Date | string | null | undefined): string | null {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }
  return accountMarketDateFormatter.format(date);
}

function calculateLatestMarketDayPnlFromHistory(
  points: Array<{
    timestamp: Date | string;
    netLiquidation: number;
    deposits?: number | null;
    withdrawals?: number | null;
    source?: string | null;
  }>,
): {
  value: number;
  capitalBase: number | null;
  marketDate: string;
  source: AccountMetric["source"];
} | null {
  const sorted = points
    .map((point) => {
      const timestamp =
        point.timestamp instanceof Date
          ? point.timestamp
          : new Date(point.timestamp);
      const netLiquidation = Number(point.netLiquidation);
      return {
        ...point,
        timestamp,
        netLiquidation,
        marketDate: accountMarketDateKey(timestamp),
      };
    })
    .filter(
      (
        point,
      ): point is {
        timestamp: Date;
        netLiquidation: number;
        deposits?: number | null;
        withdrawals?: number | null;
        source?: string | null;
        marketDate: string;
      } =>
        !Number.isNaN(point.timestamp.getTime()) &&
        Number.isFinite(point.netLiquidation) &&
        Boolean(point.marketDate),
    )
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const latest = sorted[sorted.length - 1];
  if (!latest) {
    return null;
  }
  const dayPoints = sorted.filter((point) => point.marketDate === latest.marketDate);
  const first = dayPoints[0];
  const last = dayPoints[dayPoints.length - 1];
  if (!first || !last || first.timestamp.getTime() === last.timestamp.getTime()) {
    return null;
  }
  const transfersAfterFirst = dayPoints.reduce(
    (sum, point) =>
      point.timestamp.getTime() > first.timestamp.getTime()
        ? sum + externalTransferAmount(point)
        : sum,
    0,
  );
  const value = last.netLiquidation - first.netLiquidation - transfersAfterFirst;
  if (!Number.isFinite(value)) {
    return null;
  }
  return {
    value,
    capitalBase:
      Number.isFinite(first.netLiquidation) && first.netLiquidation !== 0
        ? Math.abs(first.netLiquidation)
        : null,
    marketDate: latest.marketDate,
    source:
      last.source === "FLEX" || last.source === "LOCAL_LEDGER"
        ? last.source
        : "LOCAL_LEDGER",
  };
}

async function resolveAccountSummaryReturnMetrics(input: {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  mode: RuntimeMode;
  source?: string | null;
}) {
  const readRange = (range: AccountRange) =>
    getAccountEquityHistory({
      accountId: input.accountId,
      appUserId: input.appUserId,
      allowDirectIbkr: input.allowDirectIbkr,
      range,
      mode: input.mode,
      source: input.source,
    });

  const [allTimeHistory, intradayHistory] = await Promise.all([
    readRange("ALL"),
    readRange("1D"),
  ]);
  const summarize = (history: typeof allTimeHistory) =>
    calculateTransferAdjustedReturnSummary(
      history.points.map((point) => ({
        netLiquidation: point.netLiquidation,
        deposits: point.deposits,
        withdrawals: point.withdrawals,
      })),
    );
  const allTime = summarize(allTimeHistory);
  const intraday = summarize(intradayHistory);
  const dayPnl = calculateLatestMarketDayPnlFromHistory(
    intradayHistory.points,
  );

  return {
    totalPnl: allTime?.cumulativePnl ?? null,
    totalPnlPercent: allTime?.returnPercent ?? null,
    dayPnl: dayPnl?.value ?? null,
    dayPnlSource: dayPnl?.source ?? "LOCAL_LEDGER",
    dayPnlField: dayPnl ? `EquityHistoryMarketDayPnl:${dayPnl.marketDate}` : "EquityHistoryMarketDayPnl",
    dayPnlPercentDenominator: intraday?.capitalBase ?? null,
    dayPnlCapitalBase: dayPnl?.capitalBase ?? null,
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
    "Account/FLEX optional storage tables are missing; affected history fields are unavailable",
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
      const result = await runAccountSchemaReadinessProbe(() =>
        pool.query<{ table_name: string }>(
          `select table_name
           from information_schema.tables
           where table_schema = 'public'
             and table_name = any($1::text[])`,
          [OPTIONAL_ACCOUNT_SCHEMA_TABLES],
        ),
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

function createAccountDbUnavailableError(error?: unknown): HttpError {
  return new HttpError(503, "Account data is temporarily unavailable.", {
    code: "account_db_unavailable",
    detail:
      "Account database reads are timing out or disconnected. Retry after Postgres connectivity recovers.",
    expose: true,
    ...(error === undefined ? {} : { cause: error }),
  });
}

function isAccountDbReadUnavailableError(error: unknown): boolean {
  return (
    isTransientPostgresError(error) ||
    isStatementTimeoutError(error) ||
    isMissingRelationError(error)
  );
}

async function withAccountDbRead<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isAccountDbReadUnavailableError(error)) {
      throw createAccountDbUnavailableError(error);
    }
    throw error;
  }
}

async function withOptionalAccountSchema<T>(input: {
  tables: readonly OptionalAccountSchemaTable[];
  whenMissing: () => T;
  run: () => Promise<T>;
}): Promise<T> {
  const readiness = await getOptionalAccountSchemaReadiness();
  if (readiness.schemaError) {
    throw createAccountDbUnavailableError();
  }

  const knownMissingTables = input.tables.filter((tableName) =>
    readiness.missingTables.includes(tableName),
  );
  if (knownMissingTables.length) {
    return input.whenMissing();
  }

  try {
    return await input.run();
  } catch (error) {
    if (isMissingRelationError(error)) {
      const missingTable = extractMissingRelationName(error);
      if (!missingTable || !input.tables.includes(missingTable)) {
        throw createAccountDbUnavailableError(error);
      }
      markAccountSchemaTablesMissing([missingTable], error);
      return input.whenMissing();
    }
    if (
      isTransientPostgresError(error) ||
      isStatementTimeoutError(error)
    ) {
      throw createAccountDbUnavailableError(error);
    }
    throw error;
  }
}

function assertAccountSchemaTablesAvailable(
  readiness: AccountSchemaReadiness,
  requiredTables: readonly OptionalAccountSchemaTable[],
): void {
  if (readiness.schemaError) {
    throw createAccountDbUnavailableError();
  }
  const missingTables = requiredTables.filter((tableName) =>
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

async function ensureFlexStorageTablesAvailable(): Promise<void> {
  assertAccountSchemaTablesAvailable(
    await getOptionalAccountSchemaReadiness(),
    FLEX_STORAGE_REQUIRED_TABLES,
  );
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

function requiredAccountFinancialNumber(value: unknown, field: string): number {
  const numeric = toNumber(value);
  if (numeric !== null) return numeric;
  throw new HttpError(503, "Account financial data is incomplete.", {
    code: "account_financial_data_incomplete",
    detail: `Missing or invalid ${field}.`,
    expose: true,
  });
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
    date: toIsoDateString(start),
    start,
    end,
  };
}

function currencyOf(
  accounts: Array<Pick<BackedAccountIdentity, "currency">>,
): string {
  const normalizedCurrencies = accounts.map((account) =>
    String(account.currency || "").trim().toUpperCase(),
  );
  const currencies = new Set(normalizedCurrencies);
  if (
    !normalizedCurrencies.length ||
    normalizedCurrencies.some((currency) => !/^[A-Z]{3}$/.test(currency)) ||
    currencies.size !== 1
  ) {
    throw new HttpError(
      409,
      "Account financial data requires one authoritative three-letter currency across the full account population.",
      {
        code: "account_currency_conversion_required",
        expose: true,
      },
    );
  }
  return normalizedCurrencies[0]!;
}

function latestTimestampOf(
  accounts: Array<Pick<BackedAccountIdentity, "updatedAt">>,
): Date | null {
  const timestamps = accounts
    .map((account) => account.updatedAt?.getTime?.() ?? 0)
    .filter(Boolean);
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

function accountMetricUpdatedAt(accounts: BrokerAccountSnapshot[]): Date | null {
  return latestTimestampOf(accounts);
}

function totalPositionWeightPercent(
  rows: Array<{ weightPercent: number | null }>,
): number | null {
  return rows.length
    ? sumNullableValues(rows.map((row) => row.weightPercent))
    : 0;
}

function buildAccountPositionTotals(input: AccountPositionTotalsInput) {
  if (input.financialTotalsAvailable === false) {
    return {
      weightPercent: null,
      unrealizedPnl: null,
      grossLong: null,
      grossShort: null,
      netExposure: null,
      cash: null,
      totalCash: null,
      buyingPower: null,
      netLiquidation: null,
    };
  }
  const cash =
    sumAccounts(input.accounts, "cash") ??
    sumAccounts(input.accounts, "totalCashValue");
  const buyingPower = sumAccounts(input.accounts, "buyingPower");
  const netLiquidation = sumAccounts(input.accounts, "netLiquidation");
  return {
    weightPercent: totalPositionWeightPercent(input.rows),
    unrealizedPnl: input.rows.reduce(
      (sum, row) => sum + row.unrealizedPnl,
      0,
    ),
    grossLong: input.grossLong,
    grossShort: input.grossShort,
    netExposure: input.netExposure,
    cash,
    totalCash: cash,
    buyingPower,
    netLiquidation,
  };
}

function liveAccountUniverseCacheKey(
  accountId: string,
  mode: RuntimeMode,
  appUserId: string | null,
  allowDirectIbkr = directIbkrReadsAllowed(appUserId, undefined),
  includeUnvaluedSnapTradePositions = false,
): string {
  return JSON.stringify({
    accountId: accountId || COMBINED_ACCOUNT_ID,
    allowDirectIbkr,
    appUserId,
    includeUnvaluedSnapTradePositions,
    mode,
  });
}

function directIbkrReadsAllowed(
  appUserId: string | null,
  allowDirectIbkr: boolean | undefined,
): boolean {
  return appUserId === null || allowDirectIbkr === true;
}

async function getLiveAccountUniverse(
  accountId: string,
  mode: RuntimeMode,
  appUserId: string | null = getCurrentAppUserId(),
  allowDirectIbkr?: boolean,
  timing?: AccountPositionsTimingState,
  includeUnvaluedSnapTradePositions = false,
): Promise<AccountUniverse> {
  const effectiveAllowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    allowDirectIbkr,
  );
  return readShortLivedAccountCache(
    liveAccountUniverseReadCache,
    liveAccountUniverseCacheKey(
      accountId,
      mode,
      appUserId,
      effectiveAllowDirectIbkr,
      includeUnvaluedSnapTradePositions,
    ),
    () =>
      readLiveAccountUniverseUncached(accountId, mode, {
        appUserId,
        allowDirectIbkr: effectiveAllowDirectIbkr,
        includeUnvaluedSnapTradePositions,
        timing,
      }),
    ACCOUNT_PAGE_SHARED_LIVE_READ_CACHE_TTL_MS,
    (disposition) => {
      if (timing) {
        timing.universeCache = disposition;
      }
    },
  );
}

type SnapTradePositionAccountReadOptions = {
  onStageTiming?: (
    stage: SnapTradeAccountPortfolioStage,
    durationMs: number,
  ) => void;
};

const SNAPTRADE_POSITION_STAGE_BY_PORTFOLIO_STAGE: Record<
  SnapTradeAccountPortfolioStage,
  AccountPositionsStage
> = {
  credential_lookup: "universe_snaptrade_credential_lookup",
  account_lookup: "universe_snaptrade_account_lookup",
  balances_http: "universe_snaptrade_balances_http",
  positions_http: "universe_snaptrade_positions_http",
  normalization: "universe_snaptrade_normalization",
};

function recordSnapTradeAccountPositionStage(
  timing: AccountPositionsTimingState | undefined,
  stage: SnapTradeAccountPortfolioStage,
  durationMs: number,
): void {
  if (!timing) {
    return;
  }
  const accountStage = SNAPTRADE_POSITION_STAGE_BY_PORTFOLIO_STAGE[stage];
  timing.stagesMs[accountStage] = Math.max(
    timing.stagesMs[accountStage] ?? 0,
    durationMs,
  );
}

type ReadLiveAccountUniverseOptions = Pick<
  ListAccountsOptions,
  | "appUserId"
  | "allowDirectIbkr"
  | "listLiveAccounts"
  | "getSnapTradeAccounts"
  | "getRobinhoodAccounts"
> & {
  timing?: AccountPositionsTimingState;
  includeUnvaluedSnapTradePositions?: boolean;
  getSnapTradePositionAccounts?: (
    mode: RuntimeMode,
    appUserId: string | null,
    deps?: SnapTradePositionAccountReadOptions,
  ) => Promise<SnapTradePositionAccountResolution>;
};

async function readLiveAccountUniverseUncached(
  accountId: string,
  mode: RuntimeMode,
  options: ReadLiveAccountUniverseOptions = {},
): Promise<AccountUniverse> {
  const appUserId =
    options.appUserId === undefined ? getCurrentAppUserId() : options.appUserId;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    options.allowDirectIbkr,
  );
  let liveReadError: unknown = null;
  const accounts = allowDirectIbkr
    ? await timeAccountPositionsStage(
        options.timing,
        "universe_ibkr_accounts",
        () => (options.listLiveAccounts ?? listIbkrAccounts)(mode),
      ).catch((error) => {
        liveReadError = error;
        return [] as BrokerAccountSnapshot[];
      })
    : [];
  const requestedAccountId = accountId || COMBINED_ACCOUNT_ID;
  const isCombined = requestedAccountId === COMBINED_ACCOUNT_ID;
  const selectedAccounts = isCombined
    ? accounts
    : accounts.filter((account) => account.id === requestedAccountId);

  const readProviderBackedAccounts = async () => {
    const [snapTradeResolution, robinhoodAccounts] =
      await timeAccountPositionsStage(
        options.timing,
        "universe_provider_fanout",
        () =>
          Promise.all([
            timeAccountPositionsStage(
              options.timing,
              "universe_snaptrade_accounts",
              async () => {
                if (options.includeUnvaluedSnapTradePositions) {
                  return (
                    options.getSnapTradePositionAccounts ??
                    getSnapTradePositionBackedAccounts
                  )(mode, appUserId, {
                    onStageTiming: (stage, durationMs) =>
                      recordSnapTradeAccountPositionStage(
                        options.timing,
                        stage,
                        durationMs,
                      ),
                  });
                }
                return {
                  accounts: await (
                    options.getSnapTradeAccounts ?? getSnapTradeValuedAccounts
                  )(mode, appUserId),
                  positionOnlyAccounts: [],
                };
              },
            ).catch((error) => {
              if (isAccountDbReadUnavailableError(error)) {
                throw createAccountDbUnavailableError(error);
              }
              throw error;
            }),
            timeAccountPositionsStage(
              options.timing,
              "universe_robinhood_accounts",
              () =>
                (options.getRobinhoodAccounts ?? getRobinhoodBackedAccounts)(
                  mode,
                  appUserId,
                ),
            ).catch((error) => {
              if (isAccountDbReadUnavailableError(error)) {
                throw createAccountDbUnavailableError(error);
              }
              throw error;
            }),
          ]),
      );
    return {
      accounts: [...snapTradeResolution.accounts, ...robinhoodAccounts],
      positionOnlyAccounts: snapTradeResolution.positionOnlyAccounts,
    };
  };

  if (isCombined && selectedAccounts.length) {
    const providerResolution = await readProviderBackedAccounts();
    const combinedAccounts = mergeAccountsWithDirectIbkrSupersedence(
      selectedAccounts,
      providerResolution.accounts,
    );
    const positionOnlyAccounts = filterDirectSupersededProviderAccounts(
      selectedAccounts,
      providerResolution.positionOnlyAccounts,
    );
    const identities = [...combinedAccounts, ...positionOnlyAccounts];
    return {
      appUserId,
      allowDirectIbkr,
      requestedAccountId,
      accountIds: identities.map((account) => account.id),
      isCombined,
      accounts: combinedAccounts,
      positionOnlyAccounts,
      primaryCurrency: currencyOf(identities),
      source: "live",
      latestSnapshotAt: latestTimestampOf(identities),
    };
  }

  if (!selectedAccounts.length) {
    const providerResolution = await readProviderBackedAccounts();
    const providerBackedAccounts = filterDirectSupersededProviderAccounts(
      accounts,
      providerResolution.accounts,
    );
    const positionOnlyAccounts = filterDirectSupersededProviderAccounts(
      accounts,
      providerResolution.positionOnlyAccounts,
    );
    const selectedProviderBackedAccounts = isCombined
      ? providerBackedAccounts
      : providerBackedAccounts.filter(
          (account) => account.id === requestedAccountId,
        );
    const selectedPositionOnlyAccounts = isCombined
      ? positionOnlyAccounts
      : positionOnlyAccounts.filter(
          (account) => account.id === requestedAccountId,
        );
    if (isCombined && liveReadError) {
      throw liveReadError;
    }
    if (
      selectedProviderBackedAccounts.length ||
      selectedPositionOnlyAccounts.length
    ) {
      const identities = [
        ...selectedProviderBackedAccounts,
        ...selectedPositionOnlyAccounts,
      ];
      const providers = new Set(
        identities.map((account) => account.provider),
      );
      const source =
        providers.size === 1 && providers.has("robinhood")
          ? "robinhood"
          : providers.size === 1 && providers.has("snaptrade")
            ? "snaptrade"
            : "broker";
      return {
        appUserId,
        allowDirectIbkr,
        requestedAccountId,
        accountIds: identities.map((account) => account.id),
        isCombined,
        accounts: selectedProviderBackedAccounts,
        positionOnlyAccounts: selectedPositionOnlyAccounts,
        primaryCurrency: currencyOf(identities),
        source,
        latestSnapshotAt: latestTimestampOf(identities),
      };
    }

    if (liveReadError) {
      throw liveReadError;
    }

    throw new HttpError(404, `Account "${requestedAccountId}" was not found.`, {
      code: "account_not_found",
      expose: true,
    });
  }

  return {
    appUserId,
    allowDirectIbkr,
    requestedAccountId,
    accountIds: selectedAccounts.map((account) => account.id),
    isCombined,
    accounts: selectedAccounts,
    primaryCurrency: currencyOf(selectedAccounts),
    source: "live",
    latestSnapshotAt: null,
  };
}

function accountUniverseReadCacheKey(
  route: string,
  universe: AccountUniverse,
  mode: RuntimeMode,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    accountIds: [...universe.accountIds].sort(),
    allowDirectIbkr: universe.allowDirectIbkr,
    appUserId: universe.appUserId ?? null,
    ...Object.fromEntries(
      Object.entries(extra).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    isCombined: universe.isCombined,
    latestSnapshotAt: universe.latestSnapshotAt?.toISOString() ?? null,
    mode,
    requestedAccountId: universe.requestedAccountId,
    route,
    source: universe.source,
  });
}

function accountPositionsCacheKey(
  universe: AccountUniverse,
  mode: RuntimeMode,
): string {
  return accountUniverseReadCacheKey("positions", universe, mode);
}

async function listPositionsForUniverse(
  universe: AccountUniverse,
  mode: RuntimeMode,
  timing?: AccountPositionsTimingState,
): Promise<BrokerPositionSnapshot[]> {
  return readShortLivedAccountCache(
    accountPositionsReadCache,
    accountPositionsCacheKey(universe, mode),
    () => readPositionsForUniverseUncached(universe, mode, { timing }),
    ACCOUNT_PAGE_SHARED_LIVE_READ_CACHE_TTL_MS,
    (disposition) => {
      if (timing) {
        timing.positionsCache = disposition;
      }
    },
  );
}

function snapTradePortfolioPositionToBrokerPosition(
  accountId: string,
  position: SnapTradeAccountPortfolioResponse["positions"][number],
): BrokerPositionSnapshot {
  const rawQuantity = toNumber(position.quantity);
  const optionContract = position.optionContract
    ? {
        ...position.optionContract,
        expirationDate: new Date(
          `${position.optionContract.expirationDate}T00:00:00.000Z`,
        ),
      }
    : null;
  const multiplier = optionContract?.multiplier || optionContract?.sharesPerContract || 1;
  const reportedCostBasis = toNumber(position.costBasis);
  const reportedMarketValue = toNumber(position.marketValue);
  const averagePrice =
    toNumber(position.averagePurchasePrice) ??
    (rawQuantity && reportedCostBasis != null
      ? Math.abs(reportedCostBasis) / Math.abs(rawQuantity) / multiplier
      : null);
  const marketPrice =
    toNumber(position.price) ??
    (rawQuantity && reportedMarketValue != null
      ? Math.abs(reportedMarketValue) / Math.abs(rawQuantity) / multiplier
      : null);
  if (rawQuantity == null || averagePrice == null || marketPrice == null) {
    throw new HttpError(
      503,
      `SnapTrade position economics are unavailable for "${position.symbol}".`,
      {
        code: "snaptrade_position_economics_unavailable",
        expose: true,
      },
    );
  }
  const quantity = position.side === "short" ? -Math.abs(rawQuantity) : rawQuantity;
  const marketValue =
    reportedMarketValue ?? marketPrice * quantity * multiplier;
  const costBasis =
    reportedCostBasis ?? averagePrice * quantity * multiplier;
  const unrealizedPnl =
    toNumber(position.unrealizedPnl) ?? marketValue - costBasis;

  return {
    id: `snaptrade:${accountId}:${position.snapTradePositionId}`,
    accountId,
    symbol: position.symbol,
    assetClass: position.assetClass === "option" ? "option" : "equity",
    providerSecurityType: position.instrumentKind,
    quantity,
    averagePrice,
    marketPrice,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPercent:
      Math.abs(costBasis) > POSITION_QUANTITY_EPSILON
        ? (unrealizedPnl / Math.abs(costBasis)) * 100
        : 0,
    optionContract,
    openedAt: null,
    openedAtSource: "unknown",
    quote: null,
  };
}

function applyLatestSnapTradeBalancesToUniverse(
  universe: AccountUniverse,
): AccountUniverse {
  const appUserId =
    universe.appUserId === undefined
      ? getCurrentAppUserId()
      : universe.appUserId;
  let changed = false;
  const accounts = universe.accounts.map((account) => {
    if (account.provider !== "snaptrade") {
      return account;
    }
    const portfolio = readLatestSnapTradeAccountPortfolio({
      appUserId,
      accountId: account.id,
    });
    if (!portfolio) {
      return account;
    }
    changed = true;
    const syncedAt = new Date(portfolio.syncedAt);
    return {
      ...account,
      ...snapTradeBalanceValuesFromPortfolio(portfolio, account.currency),
      updatedAt: Number.isNaN(syncedAt.getTime()) ? account.updatedAt : syncedAt,
    };
  });
  if (!changed) {
    return universe;
  }
  const identities = accountUniverseIdentities({ ...universe, accounts });
  return {
    ...universe,
    accounts,
    latestSnapshotAt: latestTimestampOf(identities),
    primaryCurrency: currencyOf(identities),
  };
}

async function readPositionsForUniverseUncached(
  universe: AccountUniverse,
  mode: RuntimeMode,
  options: {
    listIbkrPositions?: typeof listIbkrPositions;
    readSnapTradePortfolio?: (
      accountId: string,
    ) => SnapTradeAccountPortfolioResponse | null;
    readRobinhoodPositions?: typeof readRobinhoodAccountPositions;
    timing?: AccountPositionsTimingState;
  } = {},
): Promise<BrokerPositionSnapshot[]> {
  const snapTradeAccounts = [
    ...universe.accounts,
    ...(universe.positionOnlyAccounts ?? []),
  ].filter((account) => account.provider === "snaptrade");
  const appUserId =
    universe.appUserId === undefined
      ? getCurrentAppUserId()
      : universe.appUserId;
  const readSnapTradePortfolio =
    options.readSnapTradePortfolio ??
    ((accountId: string) =>
      readLatestSnapTradeAccountPortfolio({ appUserId, accountId }));
  const snapTradePositions = snapTradeAccounts.length
    ? timeAccountPositionsSyncStage(
        options.timing,
        "positions_snaptrade_snapshot",
        () =>
          snapTradeAccounts.flatMap((account) => {
            const portfolio = readSnapTradePortfolio(account.id);
            if (!portfolio || !Array.isArray(portfolio.positions)) {
              throw new HttpError(
                503,
                `SnapTrade position population is unavailable for account "${account.id}".`,
                {
                  code: "snaptrade_position_population_unavailable",
                  expose: true,
                },
              );
            }
            return portfolio.positions.map((position) =>
              snapTradePortfolioPositionToBrokerPosition(account.id, position),
            );
          }),
      )
    : [];

  const robinhoodAccounts = universe.accounts.filter(
    (account) => account.provider === "robinhood",
  );
  if (robinhoodAccounts.length && !appUserId) {
    throw new HttpError(503, "Robinhood account identity is unavailable.", {
      code: "robinhood_account_identity_unavailable",
      expose: true,
    });
  }
  const robinhoodPositionsPromise =
    robinhoodAccounts.length && appUserId
      ? timeAccountPositionsStage(
          options.timing,
          "positions_robinhood",
          () =>
            (options.readRobinhoodPositions ?? readRobinhoodAccountPositions)(
              {
                appUserId,
                accounts: robinhoodAccounts.map((account) => ({
                  accountId: account.id,
                  accountNumber: robinhoodAccountNumber(
                    account.providerAccountId,
                  ),
                })),
              },
              {
                onStageTiming: (stage, durationMs) => {
                  if (!options.timing) {
                    return;
                  }
                  const accountStage: AccountPositionsStage =
                    stage === "session"
                      ? "positions_robinhood_session"
                      : stage === "holdings"
                        ? "positions_robinhood_holdings"
                        : "positions_robinhood_market_data";
                  options.timing.stagesMs[accountStage] = durationMs;
                },
              },
            ),
        )
      : Promise.resolve([] as BrokerPositionSnapshot[]);

  const ibkrAccounts = ibkrReadableAccountsForUniverse(universe).filter(
    (account) => account.provider === "ibkr",
  );

  const readOpenPositions = async (): Promise<BrokerPositionSnapshot[]> => {
    if (!ibkrAccounts.length) {
      return [];
    }
    if (!universe.isCombined && ibkrAccounts[0]) {
      return filterOpenBrokerPositions(
        await (options.listIbkrPositions ?? listIbkrPositions)({
          accountId: ibkrAccounts[0].id,
          mode,
        }),
      );
    }

    const positions = await Promise.all(
      ibkrAccounts.map((account) =>
        (options.listIbkrPositions ?? listIbkrPositions)({
          accountId: account.id,
          mode,
        }),
      ),
    );
    return filterOpenBrokerPositions(positions.flat());
  };

  const ibkrPositionsPromise = ibkrAccounts.length
    ? timeAccountPositionsStage(
        options.timing,
        "positions_ibkr",
        readOpenPositions,
      )
    : Promise.resolve([] as BrokerPositionSnapshot[]);
  const [ibkrPositions, robinhoodPositions] = await timeAccountPositionsStage(
    options.timing,
    "positions_provider_fanout",
    () => Promise.all([ibkrPositionsPromise, robinhoodPositionsPromise]),
  );
  return filterOpenBrokerPositions([
    ...ibkrPositions,
    ...snapTradePositions,
    ...robinhoodPositions,
  ]);
}

export async function getAccountPositionVisibilityProbe(input: {
  accountId: string;
  appUserId?: string | null;
  allowDirectIbkr?: boolean;
  assetClass?: string | null;
  mode?: RuntimeMode;
  source?: string | null;
}) {
  const mode = input.mode ?? getRuntimeMode();
  const appUserId =
    input.appUserId === undefined ? getCurrentAppUserId() : input.appUserId;
  const universe = await getLiveAccountUniverse(
    input.accountId,
    mode,
    appUserId,
    input.allowDirectIbkr,
    undefined,
    true,
  );
  const positions = await listPositionsForUniverse(universe, mode);
  const filter = resolveAccountPositionTypeFilter(input.assetClass);
  const filteredPositions = positions.filter((position) =>
    accountPositionTypeMatchesFilter(
      classifyAccountPositionType(position),
      filter,
    ),
  );

  return {
    accountId: universe.requestedAccountId,
    isCombined: universe.isCombined,
    mode,
    source: input.source ?? universe.source,
    count: filteredPositions.length,
    updatedAt:
      accountMetricUpdatedAt(universe.accounts)?.toISOString() ??
      new Date().toISOString(),
  };
}

type AccountUniverseOrderResult = {
  orders: BrokerOrderSnapshot[];
};

async function listOrdersForUniverse(
  universe: AccountUniverse,
  mode: RuntimeMode,
): Promise<AccountUniverseOrderResult> {
  return readShortLivedAccountCache(
    accountOrdersReadCache,
    accountUniverseReadCacheKey("orders", universe, mode),
    () => readOrdersForUniverseUncached(universe, mode),
  );
}

async function readOrdersForUniverseUncached(
  universe: AccountUniverse,
  mode: RuntimeMode,
): Promise<AccountUniverseOrderResult> {
  if (
    universe.source === "robinhood" ||
    universe.source === "snaptrade" ||
    universe.source === "broker"
  ) {
    return { orders: [] };
  }

  const ibkrAccounts = ibkrReadableAccountsForUniverse(universe);
  if (!ibkrAccounts.length) {
    return { orders: [] };
  }

  const results = await Promise.all(
    ibkrAccounts.map((account) =>
      listOrders({ accountId: account.id, mode }),
    ),
  );
  return {
    orders: results.flatMap((result) => result.orders),
  };
}

async function fetchEquityQuoteSnapshotsForPositions(
  positions: BrokerPositionSnapshot[],
): Promise<Map<string, QuoteSnapshot>> {
  const symbols = accountPositionEquityQuoteSymbols(positions);
  if (!symbols.length) {
    return new Map();
  }

  const payload = await getQuoteSnapshots({
    symbols: symbols.join(","),
  }).catch(() => ({
    quotes: [],
  }));
  return new Map(
    (payload.quotes || []).map((quote) => [normalizeSymbol(quote.symbol), quote]),
  );
}

function accountPositionEquityQuoteSymbols(
  positions: BrokerPositionSnapshot[],
): string[] {
  return Array.from(
    new Set(
      positions
        .filter(canHydratePositionFromEquityQuote)
        .map((position) => normalizeSymbol(positionReferenceSymbol(position)))
        .filter(Boolean),
    ),
  );
}

function refreshAccountPositionEquityQuotes(
  positions: BrokerPositionSnapshot[],
): void {
  void fetchEquityQuoteSnapshotsForPositions(positions);
}

type AccountPositionOptionQuoteDemandState = OptionQuoteDemandQuoteState;

type AccountPositionOptionQuoteSnapshot = PositionQuoteSnapshot & {
  providerContractId: string | null;
};

const demandFreshnessForStatus = (status: string | null | undefined): string | null => {
  if (status === "live" || status === "stale" || status === "pending") {
    return status;
  }
  if (status === "unavailable" || status === "rejected") {
    return "unavailable";
  }
  return null;
};

function finiteQuoteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function optionQuoteDayChangeNumber(
  quote: (QuoteSnapshot & { dayChange?: unknown }) | null | undefined,
): number | null {
  return quote?.prevClose != null
    ? finiteQuoteNumber(quote.dayChange ?? quote.change)
    : null;
}

function optionQuoteDayChangePercentNumber(
  quote: (QuoteSnapshot & { dayChangePercent?: unknown }) | null | undefined,
): number | null {
  return quote?.prevClose != null
    ? finiteQuoteNumber(quote.dayChangePercent ?? quote.changePercent)
    : null;
}

function quoteDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function quoteTimestampMs(value: unknown): number | null {
  const date = quoteDate(value);
  return date ? date.getTime() : null;
}

function selectCombinedPositionQuote(
  providerSecurityType: string | null,
  positionQuotes: PositionQuoteSnapshot[],
  fallback: PositionQuoteSnapshot | null,
): PositionQuoteSnapshot | null {
  if (providerSecurityType !== "robinhood_option") {
    return fallback;
  }
  return (
    positionQuotes.reduce<PositionQuoteSnapshot | null>((freshest, quote) => {
      const quoteUpdatedAt =
        quoteTimestampMs(quote.dataUpdatedAt) ??
        quoteTimestampMs(quote.updatedAt) ??
        Number.NEGATIVE_INFINITY;
      const freshestUpdatedAt = freshest
        ? (quoteTimestampMs(freshest.dataUpdatedAt) ??
          quoteTimestampMs(freshest.updatedAt) ??
          Number.NEGATIVE_INFINITY)
        : Number.NEGATIVE_INFINITY;
      return !freshest || quoteUpdatedAt > freshestUpdatedAt ? quote : freshest;
    }, null) ?? fallback
  );
}

function optionQuoteStatusRank(status: unknown): number {
  switch (String(status ?? "").trim().toLowerCase()) {
    case "live":
      return 5;
    case "stale":
      return 4;
    case "pending":
      return 3;
    case "unavailable":
      return 2;
    case "rejected":
      return 1;
    default:
      return 0;
  }
}

function optionQuoteDemandStateTimestampMs(
  state: AccountPositionOptionQuoteDemandState,
): number | null {
  return (
    quoteTimestampMs(state.quote?.dataUpdatedAt) ??
    quoteTimestampMs(state.quote?.updatedAt)
  );
}

function compareOptionQuoteDemandStates(
  left: AccountPositionOptionQuoteDemandState,
  right: AccountPositionOptionQuoteDemandState,
): number {
  const leftHasQuote = left.quote ? 1 : 0;
  const rightHasQuote = right.quote ? 1 : 0;
  if (leftHasQuote !== rightHasQuote) {
    return leftHasQuote - rightHasQuote;
  }

  const leftStatusRank = optionQuoteStatusRank(left.quoteStatus);
  const rightStatusRank = optionQuoteStatusRank(right.quoteStatus);
  if (leftStatusRank !== rightStatusRank) {
    return leftStatusRank - rightStatusRank;
  }

  const leftFreshnessRank = optionQuoteStatusRank(left.quote?.freshness);
  const rightFreshnessRank = optionQuoteStatusRank(right.quote?.freshness);
  if (leftFreshnessRank !== rightFreshnessRank) {
    return leftFreshnessRank - rightFreshnessRank;
  }

  const leftTimestamp = optionQuoteDemandStateTimestampMs(left);
  const rightTimestamp = optionQuoteDemandStateTimestampMs(right);
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  if (leftTimestamp !== null && rightTimestamp === null) {
    return 1;
  }
  if (leftTimestamp === null && rightTimestamp !== null) {
    return -1;
  }

  const leftCacheAge = finiteQuoteNumber(left.cacheAgeMs);
  const rightCacheAge = finiteQuoteNumber(right.cacheAgeMs);
  if (leftCacheAge !== null && rightCacheAge !== null && leftCacheAge !== rightCacheAge) {
    return rightCacheAge - leftCacheAge;
  }
  if (leftCacheAge !== null && rightCacheAge === null) {
    return 1;
  }
  if (leftCacheAge === null && rightCacheAge !== null) {
    return -1;
  }

  return 0;
}

function bestOptionQuoteDemandState(
  states: AccountPositionOptionQuoteDemandState[],
): AccountPositionOptionQuoteDemandState | null {
  return states.reduce<AccountPositionOptionQuoteDemandState | null>(
    (best, state) =>
      !best || compareOptionQuoteDemandStates(state, best) > 0 ? state : best,
    null,
  );
}

function quoteCacheAgeMsForAccountOption(
  quote: QuoteSnapshot | undefined | null,
): number | null {
  if (!quote) {
    return null;
  }
  const explicitAge =
    finiteQuoteNumber(quote.cacheAgeMs) ?? finiteQuoteNumber(quote.ageMs);
  if (explicitAge !== null) {
    return Math.max(0, explicitAge);
  }
  const receivedAt = quote.latency?.apiServerReceivedAt;
  const receivedAtMs =
    receivedAt instanceof Date
      ? receivedAt.getTime()
      : receivedAt
        ? new Date(receivedAt).getTime()
        : null;
  return receivedAtMs !== null && Number.isFinite(receivedAtMs)
    ? Math.max(0, Date.now() - receivedAtMs)
    : null;
}

function optionQuoteHasAnyGreek(quote: QuoteSnapshot | undefined | null): boolean {
  return Boolean(
    quote &&
      [quote.delta, quote.gamma, quote.theta, quote.vega].some(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
  );
}

type OptionQuoteSource = "ibkr" | "massive";

function optionQuoteFreshnessState(
  quote: QuoteSnapshot & { source?: OptionQuoteSource },
): { status: OptionQuoteDemandStatus; reason: string | null } {
  const freshness = String(quote.freshness ?? "").trim();
  if (freshness === "unavailable") {
    return { status: "unavailable", reason: "quote_unavailable" };
  }
  if (freshness === "pending" || freshness === "metadata") {
    return { status: "pending", reason: "quote_pending" };
  }
  if (freshness === "stale") {
    return { status: "stale", reason: "stale_quote" };
  }
  return { status: "live", reason: null };
}

function optionQuoteGreeksState(input: {
  quote: QuoteSnapshot & { source?: OptionQuoteSource };
  requiresGreeks: boolean;
}): { status: OptionQuoteDemandStatus; reason: string | null } {
  const quoteState = optionQuoteFreshnessState(input.quote);
  if (optionQuoteHasAnyGreek(input.quote)) {
    return quoteState;
  }
  if (quoteState.status === "pending") {
    return { status: "pending", reason: "quote_pending" };
  }
  if (quoteState.status === "stale") {
    return { status: "stale", reason: "stale_greeks" };
  }
  if (quoteState.status === "unavailable") {
    return { status: "unavailable", reason: "greeks_unavailable" };
  }
  if (input.requiresGreeks) {
    return { status: "pending", reason: "awaiting_greeks" };
  }
  return { status: "unavailable", reason: "greeks_not_requested" };
}

function optionQuoteDemandStateFromSnapshot(
  quote: QuoteSnapshot & { source?: OptionQuoteSource },
  requiresGreeks: boolean,
): AccountPositionOptionQuoteDemandState | null {
  const providerContractId = String(quote.providerContractId ?? "").trim();
  if (!providerContractId) {
    return null;
  }
  const quoteState = optionQuoteFreshnessState(quote);
  const greeksState = optionQuoteGreeksState({ quote, requiresGreeks });
  const incompleteGreeks =
    requiresGreeks &&
    (greeksState.status === "pending" ||
      greeksState.status === "stale" ||
      greeksState.status === "unavailable");
  const overallState = incompleteGreeks ? greeksState : quoteState;
  return {
    providerContractId,
    status: overallState.status,
    reason: overallState.reason,
    quoteStatus: quoteState.status,
    quoteReason: quoteState.reason,
    greeksStatus: greeksState.status,
    greeksReason: greeksState.reason,
    quote,
    cacheAgeMs: quoteCacheAgeMsForAccountOption(quote),
  };
}

function accountOptionQuoteFromDemandState(
  state: AccountPositionOptionQuoteDemandState | null | undefined,
): AccountPositionOptionQuoteSnapshot | null {
  if (!state) {
    return null;
  }

  const quote = state.quote;
  const quoteSnapshot = quote
    ? buildPositionQuoteFromSnapshot(quote, null, "option_quote")
    : null;
  const quoteFreshness =
    quote?.freshness ?? demandFreshnessForStatus(state.quoteStatus);
  const greeksFreshness =
    quote && state.greeksStatus === "live"
      ? quote.freshness ?? "live"
      : demandFreshnessForStatus(state.greeksStatus);
  const reason = state.quoteReason ?? state.reason ?? null;
  const greeksReason = state.greeksReason ?? null;

  return {
    bid: quoteSnapshot?.bid ?? null,
    ask: quoteSnapshot?.ask ?? null,
    mid: quoteSnapshot?.mid ?? null,
    last: quoteSnapshot?.last ?? null,
    mark: quoteSnapshot?.mark ?? null,
    spread: quoteSnapshot?.spread ?? null,
    spreadPercent: quoteSnapshot?.spreadPercent ?? null,
    bidSize: quoteSnapshot?.bidSize ?? null,
    askSize: quoteSnapshot?.askSize ?? null,
    updatedAt: quoteSnapshot?.updatedAt ?? quoteDate(quote?.updatedAt),
    freshness: quoteFreshness,
    marketDataMode: quote?.marketDataMode ?? null,
    source: quote ? "option_quote" : "position_mark",
    providerContractId: state.providerContractId,
    transport: quote?.transport ?? null,
    delayed: quote?.delayed ?? null,
    dataUpdatedAt: quoteDate(quote?.dataUpdatedAt),
    ageMs: finiteQuoteNumber(quote?.ageMs),
    cacheAgeMs: state.cacheAgeMs ?? finiteQuoteNumber(quote?.cacheAgeMs),
    status: state.quoteStatus,
    reason,
    quoteStatus: state.quoteStatus,
    quoteReason: state.quoteReason,
    greeksStatus: state.greeksStatus,
    greeksReason,
    demandStatus: state.status,
    demandReason: state.reason,
    quoteFreshness,
    greeksFreshness,
    unavailableDetail: reason ?? greeksReason,
    price: finiteQuoteNumber(quote?.price),
    dayChange: optionQuoteDayChangeNumber(quote),
    dayChangePercent: optionQuoteDayChangePercentNumber(quote),
    volume: finiteQuoteNumber(quote?.volume),
    openInterest: finiteQuoteNumber(quote?.openInterest),
    impliedVolatility: finiteQuoteNumber(quote?.impliedVolatility),
    delta: finiteQuoteNumber(quote?.delta),
    gamma: finiteQuoteNumber(quote?.gamma),
    theta: finiteQuoteNumber(quote?.theta),
    vega: finiteQuoteNumber(quote?.vega),
    underlyingPrice: quoteSnapshot?.underlyingPrice ?? null,
  };
}

function optionQuoteDemandStateForPosition(
  position: AccountPositionOptionQuoteDemandRow,
  optionQuoteDemandStates:
    | Map<string, AccountPositionOptionQuoteDemandState>
    | undefined,
): AccountPositionOptionQuoteDemandState | null {
  if (!optionQuoteDemandStates) {
    return null;
  }
  const providerContractIds = optionQuoteProviderContractIdsForPosition(position);
  const states = providerContractIds.flatMap((providerContractId) => {
    const state = optionQuoteDemandStates.get(providerContractId);
    return state ? [state] : [];
  });
  return bestOptionQuoteDemandState(states);
}

function optionQuoteSnapshotForPosition(
  position: AccountPositionOptionQuoteDemandRow,
  optionQuoteDemandStates:
    | Map<string, AccountPositionOptionQuoteDemandState>
    | undefined,
): QuoteSnapshot | null {
  return optionQuoteDemandStateForPosition(position, optionQuoteDemandStates)?.quote ?? null;
}

function accountOptionQuoteForPosition(
  position: AccountPositionOptionQuoteDemandRow,
  optionQuoteDemandStates:
    | Map<string, AccountPositionOptionQuoteDemandState>
    | undefined,
): AccountPositionOptionQuoteSnapshot | null {
  return accountOptionQuoteFromDemandState(
    optionQuoteDemandStateForPosition(position, optionQuoteDemandStates),
  );
}

function attachAccountOptionQuoteMetadata(
  quote: PositionQuoteSnapshot | null,
  state: AccountPositionOptionQuoteDemandState | null | undefined,
): PositionQuoteSnapshot | null {
  if (!quote || !state) {
    return quote;
  }
  return {
    ...quote,
    providerContractId: state.providerContractId,
    status: state.quoteStatus,
    reason: state.quoteReason,
    quoteStatus: state.quoteStatus,
    quoteReason: state.quoteReason,
    greeksStatus: state.greeksStatus,
    greeksReason: state.greeksReason,
    demandStatus: state.status,
    demandReason: state.reason,
    quoteFreshness: quote.freshness ?? demandFreshnessForStatus(state.quoteStatus),
    greeksFreshness:
      state.greeksStatus === "live"
        ? quote.freshness ?? "live"
        : demandFreshnessForStatus(state.greeksStatus),
    cacheAgeMs: state.cacheAgeMs,
    unavailableDetail: state.quoteReason ?? state.reason ?? state.greeksReason,
  };
}

async function fetchOptionQuoteSnapshotsForPositions(
  positions: BrokerPositionSnapshot[],
): Promise<Map<string, AccountPositionOptionQuoteDemandState>> {
  const providerContractIds = positions.flatMap((position) => {
    return optionQuoteDemandProviderContractIdsForPosition(position);
  });
  const uniqueProviderContractIds = Array.from(new Set(providerContractIds));

  if (!uniqueProviderContractIds.length) {
    return new Map();
  }

  const owner = declareAccountPositionOptionQuoteDemands(positions, "mixed");
  let demandStateEntries: AccountPositionOptionQuoteDemandState[] = [];
  try {
    const positionsByUnderlying = positions.reduce((map, position) => {
      const underlying = normalizeSymbol(position.optionContract?.underlying ?? "");
      const demandProviderContractIdsForPosition =
        optionQuoteDemandProviderContractIdsForPosition(position);
      if (!demandProviderContractIdsForPosition.length || !underlying) {
        return map;
      }
      const current = map.get(underlying) ?? {
        demandProviderContractIds: [] as string[],
        readProviderContractIds: [] as string[],
      };
      current.demandProviderContractIds.push(
        ...demandProviderContractIdsForPosition,
      );
      current.readProviderContractIds.push(
        ...optionQuoteProviderContractIdsForPosition(position),
      );
      map.set(underlying, current);
      return map;
    }, new Map<string, { demandProviderContractIds: string[]; readProviderContractIds: string[] }>());

    const snapshotResults = await Promise.allSettled(
      Array.from(positionsByUnderlying.entries()).map(
        async ([underlying, underlyingProviderContractIds]) => {
          const ownerForUnderlying = `${owner}:${underlying}`;
          const demandProviderContractIdsForUnderlying = Array.from(
            new Set(underlyingProviderContractIds.demandProviderContractIds),
          );
          return fetchMassiveOptionQuoteSnapshots({
            underlying,
            providerContractIds: demandProviderContractIdsForUnderlying,
            owner: `${ownerForUnderlying}:snapshot`,
            intent: "account-monitor-live",
            fallbackProvider: "cache",
            requiresGreeks: true,
            hydrateCached: true,
            timeoutMs: ACCOUNT_POSITION_OPTION_QUOTE_REFRESH_TIMEOUT_MS,
          });
        },
      ),
    );
    const underlyings = Array.from(positionsByUnderlying.keys());
    snapshotResults.forEach((result, index) => {
      if (result.status !== "rejected") {
        return;
      }
      const underlying = underlyings[index];
      logger.debug?.(
        { err: result.reason, owner: `${owner}:${underlying}`, underlying },
        "Account position option quote snapshot failed",
      );
    });

    const demandStateResults = await Promise.allSettled(
      Array.from(positionsByUnderlying.entries()).map(
        async ([underlying, underlyingProviderContractIds]) => {
          const ownerForUnderlying = `${owner}:${underlying}`;
          const readProviderContractIdsForUnderlying = Array.from(
            new Set(underlyingProviderContractIds.readProviderContractIds),
          );
          return readOptionQuoteDemandState({
            owner: ownerForUnderlying,
            underlying,
            providerContractIds: readProviderContractIdsForUnderlying,
            requiresGreeks: true,
          }).states;
        },
      ),
    );
    demandStateEntries = [
      ...snapshotResults.flatMap((result) =>
        result.status === "fulfilled"
          ? result.value.quotes.flatMap((quote) => {
              const state = optionQuoteDemandStateFromSnapshot(quote, true);
              return state ? [state] : [];
            })
          : [],
      ),
      ...demandStateResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
    ];
  } catch (error) {
    logger.debug?.(
      { err: error, owner },
      "Unable to read account position option quote demand",
    );
  }

  const demandStatesByProviderContractId = new Map<
    string,
    AccountPositionOptionQuoteDemandState
  >();
  demandStateEntries.forEach((state) => {
    const providerContractId = String(state.providerContractId ?? "").trim();
    if (!providerContractId) {
      return;
    }
    const current = demandStatesByProviderContractId.get(providerContractId);
    const best = current ? bestOptionQuoteDemandState([current, state]) : state;
    if (best) {
      demandStatesByProviderContractId.set(providerContractId, best);
    }
  });
  positions.forEach((position) => {
    const providerContractIdsForPosition =
      optionQuoteProviderContractIdsForPosition(position);
    const state = bestOptionQuoteDemandState(
      providerContractIdsForPosition.flatMap((providerContractId) => {
        const candidate = demandStatesByProviderContractId.get(providerContractId);
        return candidate ? [candidate] : [];
      }),
    );
    if (!state) {
      return;
    }
    providerContractIdsForPosition.forEach((providerContractId) => {
      demandStatesByProviderContractId.set(providerContractId, state);
    });
  });

  return demandStatesByProviderContractId;
}

type AccountPositionOptionQuoteDemandRow = {
  accountId?: string | null;
  accounts?: string[] | null;
  providerSecurityType?: string | null;
  optionContract?: {
    ticker?: string | null;
    underlying?: string | null;
    expirationDate?: Date | string | null;
    strike?: number | string | null;
    right?: string | null;
    multiplier?: number | string | null;
    sharesPerContract?: number | string | null;
    providerContractId?: string | null;
    conid?: string | number | null;
  } | null;
};

function isRobinhoodOptionQuoteRow(
  row: AccountPositionOptionQuoteDemandRow,
): boolean {
  return row.providerSecurityType === "robinhood_option";
}

function finiteOptionNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function optionExpirationKey(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDateString(value).replaceAll("-", "");
  }
  const text = String(value ?? "").trim();
  if (/^\d{8}$/.test(text)) {
    return text;
  }
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) {
    return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`;
  }
  const parsed = text ? new Date(text) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? toIsoDateString(parsed).replaceAll("-", "")
    : null;
}

function optionRightCode(value: unknown): "C" | "P" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "call" || normalized === "c") {
    return "C";
  }
  if (normalized === "put" || normalized === "p") {
    return "P";
  }
  return null;
}

function primaryOptionProviderContractIdForRow(
  row: AccountPositionOptionQuoteDemandRow,
): string | null {
  const raw =
    row.optionContract?.providerContractId ??
    row.optionContract?.conid ??
    null;
  const text = String(raw ?? "").trim();
  return text || null;
}

function opraOptionTickerForRow(
  row: AccountPositionOptionQuoteDemandRow,
): string | null {
  if (isRobinhoodOptionQuoteRow(row)) {
    return null;
  }
  const ticker = normalizeOpraOptionTicker(row.optionContract?.ticker);
  if (ticker) {
    return ticker;
  }

  const contract = row.optionContract;
  const underlying = normalizeSymbol(contract?.underlying ?? "").replace(
    /[^A-Z0-9]/g,
    "",
  );
  const expiration = optionExpirationKey(contract?.expirationDate);
  const strike = finiteOptionNumber(contract?.strike);
  const right = optionRightCode(contract?.right);
  if (!underlying || !expiration || strike === null || !right) {
    return null;
  }

  const opraExpiration =
    expiration.length === 8 ? expiration.slice(2) : expiration;
  const strikeKey = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${underlying}${opraExpiration}${right}${strikeKey}`;
}

function uniqueOptionProviderContractIds(
  providerContractIds: Array<string | null | undefined>,
): string[] {
  return Array.from(
    new Set(
      providerContractIds
        .map((providerContractId) => String(providerContractId ?? "").trim())
        .filter(Boolean),
    ),
  );
}

function optionQuoteDemandProviderContractIdsForPosition(
  row: AccountPositionOptionQuoteDemandRow,
): string[] {
  if (isRobinhoodOptionQuoteRow(row)) {
    return [];
  }
  const opraOptionTicker = opraOptionTickerForRow(row);
  if (opraOptionTicker) {
    return [opraOptionTicker];
  }

  const primaryProviderContractId = primaryOptionProviderContractIdForRow(row);
  return primaryProviderContractId ? [primaryProviderContractId] : [];
}

function optionQuoteProviderContractIdsForPosition(
  row: AccountPositionOptionQuoteDemandRow,
): string[] {
  const demandProviderContractIds =
    optionQuoteDemandProviderContractIdsForPosition(row);
  return uniqueOptionProviderContractIds([
    ...demandProviderContractIds,
    opraOptionTickerForRow(row),
    primaryOptionProviderContractIdForRow(row),
  ]);
}

const accountPositionOptionDemandOwnersByAccountKey = new Map<string, Set<string>>();

function accountPositionOptionQuoteOwnerKey(
  rows: AccountPositionOptionQuoteDemandRow[],
  fallbackAccountKey: string,
): string {
  return Array.from(
    new Set(
      rows
        .flatMap((row) =>
          Array.isArray(row.accounts) && row.accounts.length
            ? row.accounts
            : [row.accountId],
        )
        .map((accountId) => String(accountId || "").trim())
        .filter(Boolean),
    ),
  ).sort().join("+") || fallbackAccountKey || "mixed";
}

function declareAccountPositionOptionQuoteDemands(
  rows: AccountPositionOptionQuoteDemandRow[],
  fallbackAccountKey: string,
): string {
  const accountKey = accountPositionOptionQuoteOwnerKey(rows, fallbackAccountKey);
  const owner = `account-position-option-quotes:${accountKey}`;
  const nextOwners = new Set<string>();
  let droppedOptionPositions = 0;
  const positionsByUnderlying = rows.reduce((map, row) => {
    const underlying = normalizeSymbol(row.optionContract?.underlying ?? "");
    const providerContractIds =
      optionQuoteDemandProviderContractIdsForPosition(row);
    if (!providerContractIds.length || !underlying) {
      // An option position that can't be keyed to a provider contract id /
      // underlying is silently excluded from the account-monitor-live lease and
      // (correctly) can't use equity quotes either, so it gets no live market
      // data. Surface it rather than dropping it invisibly.
      if (row.optionContract && !isRobinhoodOptionQuoteRow(row)) {
        droppedOptionPositions += 1;
      }
      return map;
    }
    map.set(underlying, [
      ...(map.get(underlying) ?? []),
      ...providerContractIds,
    ]);
    return map;
  }, new Map<string, string[]>());
  if (droppedOptionPositions > 0) {
    logger.warn(
      {
        code: "account_position_option_quote_unleased",
        accountKey,
        droppedOptionPositions,
        leasedUnderlyings: positionsByUnderlying.size,
      },
      "Option positions excluded from account-monitor live quote lease (missing provider contract id / underlying)",
    );
  }
  Array.from(positionsByUnderlying.entries()).forEach(
    ([underlying, underlyingProviderContractIds]) => {
      const ownerForUnderlying = `${owner}:${underlying}`;
      nextOwners.add(ownerForUnderlying);
      declareOptionQuoteDemand({
        owner: ownerForUnderlying,
        underlying,
        providerContractIds: Array.from(new Set(underlyingProviderContractIds)),
        intent: "account-monitor-live",
        fallbackProvider: "cache",
        requiresGreeks: true,
        ttlMs: ACCOUNT_POSITION_MARKET_DATA_TTL_MS,
      });
    },
  );
  const previousOwners =
    accountPositionOptionDemandOwnersByAccountKey.get(accountKey) ?? new Set<string>();
  previousOwners.forEach((previousOwner) => {
    if (!nextOwners.has(previousOwner)) {
      releaseOptionQuoteDemand(previousOwner, "account_position_set_changed");
    }
  });
  if (nextOwners.size) {
    accountPositionOptionDemandOwnersByAccountKey.set(accountKey, nextOwners);
  } else {
    accountPositionOptionDemandOwnersByAccountKey.delete(accountKey);
  }

  return owner;
}

function positionMarketHydrationCacheKey(
  positions: BrokerPositionSnapshot[],
): string {
  return positions
    .map((position) =>
      [
        position.id,
        position.accountId,
        position.symbol,
        position.assetClass,
        position.quantity,
        position.averagePrice,
        position.marketPrice,
        position.marketValue,
        position.unrealizedPnl,
        position.optionContract?.providerContractId ?? "",
        position.optionContract?.underlying ?? "",
        position.optionContract?.expirationDate?.toISOString?.() ?? "",
        position.optionContract?.strike ?? "",
        position.optionContract?.right ?? "",
      ].join("|"),
    )
    .sort()
    .join(";");
}

async function hydratePositionMarkets(
  positions: BrokerPositionSnapshot[],
  quotesBySymbol?: Map<string, QuoteSnapshot>,
  optionQuotesByProviderContractId?: Map<string, AccountPositionOptionQuoteDemandState>,
  openDatesByPositionId?: Map<
    string,
    {
      openedAt: Date | null;
      openedAtSource: BrokerPositionSnapshot["openedAtSource"] | null;
    }
  >,
): Promise<Map<string, PositionMarketHydration>> {
  if (!quotesBySymbol && !optionQuotesByProviderContractId && !openDatesByPositionId) {
    return readShortLivedAccountCache(
      positionMarketHydrationReadCache,
      positionMarketHydrationCacheKey(positions),
      () => hydratePositionMarketsUncached(positions),
    );
  }

  return hydratePositionMarketsUncached(
    positions,
    quotesBySymbol,
    optionQuotesByProviderContractId,
    openDatesByPositionId,
  );
}

async function hydratePositionMarketsUncached(
  positions: BrokerPositionSnapshot[],
  quotesBySymbol?: Map<string, QuoteSnapshot>,
  optionQuotesByProviderContractId?: Map<string, AccountPositionOptionQuoteDemandState>,
  openDatesByPositionId?: Map<
    string,
    {
      openedAt: Date | null;
      openedAtSource: BrokerPositionSnapshot["openedAtSource"] | null;
    }
  >,
): Promise<Map<string, PositionMarketHydration>> {
  const positionQuotes =
    quotesBySymbol ?? (await fetchEquityQuoteSnapshotsForPositions(positions));

  return new Map(
    positions.map((position) => {
      const quote = position.optionContract
        ? optionQuoteSnapshotForPosition(position, optionQuotesByProviderContractId)
        : positionQuotes.get(normalizeSymbol(positionReferenceSymbol(position)));
      const openedAt = bestOpenedAtForPosition(
        position,
        openDatesByPositionId?.get(position.id),
      );
      return [
        position.id,
        buildPositionMarketHydration(position, quote, {
          openedAt: openedAt.openedAt,
        }),
      ] as const;
    }),
  );
}

function brokerPositionOpenedAt(position: BrokerPositionSnapshot): {
  openedAt: Date | null;
  openedAtSource: BrokerPositionSnapshot["openedAtSource"] | null;
} {
  const openedAt =
    position.openedAt instanceof Date && !Number.isNaN(position.openedAt.getTime())
      ? position.openedAt
      : null;
  return {
    openedAt,
    openedAtSource: openedAt ? position.openedAtSource ?? "broker" : null,
  };
}

type PositionOpenDate = ReturnType<typeof brokerPositionOpenedAt>;

const FLEX_OPEN_POSITION_OPEN_DATE_KEYS = [
  "openDateTime",
  "openDate",
  "dateAcquired",
  "acquiredDate",
  "holdingPeriodDateTime",
  "holdingPeriodDate",
  "purchaseDate",
  "tradeDateTime",
  "tradeDate",
  "dateTime",
  "openedAt",
];

const FLEX_OPEN_POSITION_CONTRACT_ID_KEYS = [
  "providerContractId",
  "conid",
  "conId",
  "contractId",
  "ibContractId",
  "ibkrContractId",
];
const FLEX_OPEN_POSITION_UNDERLYING_KEYS = [
  "underlyingSymbol",
  "underlying",
  "underlyingTicker",
  "symbol",
];
const FLEX_OPEN_POSITION_EXPIRATION_KEYS = [
  "expirationDate",
  "expiration",
  "expiry",
  "expDate",
  "maturity",
  "lastTradeDateOrContractMonth",
];
const FLEX_OPEN_POSITION_STRIKE_KEYS = ["strike", "strikePrice"];
const FLEX_OPEN_POSITION_RIGHT_KEYS = [
  "right",
  "putCall",
  "callPut",
  "optionType",
];
const FLEX_OPEN_POSITION_STREAK_GAP_MS = 8 * 24 * 60 * 60 * 1000;

type FlexOpenPositionRecord = typeof flexOpenPositionsTable.$inferSelect;

type FlexOpenPositionCandidate = {
  accountId: string;
  symbol: string;
  description: string;
  contractId: string | null;
  asOf: Date;
  openedAt: Date;
  openedAtSource: NonNullable<BrokerPositionSnapshot["openedAtSource"]>;
  raw: Record<string, unknown> | null;
};

function flexOpenPositionOpenedAt(
  row: Pick<FlexOpenPositionRecord, "asOf" | "raw">,
): PositionOpenDate {
  const raw = isRecord(row.raw) ? row.raw : null;
  for (const key of FLEX_OPEN_POSITION_OPEN_DATE_KEYS) {
    const parsed = parseDate(rawString(raw, [key]));
    if (parsed) {
      return {
        openedAt: parsed,
        openedAtSource: "flex_open_position",
      };
    }
  }

  return {
    openedAt: row.asOf,
    openedAtSource: "flex_snapshot",
  };
}

function flexOpenPositionContractId(
  raw: Record<string, unknown> | null | undefined,
): string | null {
  return rawString(raw, FLEX_OPEN_POSITION_CONTRACT_ID_KEYS);
}

function flexOpenPositionContractKey(
  attrs: Record<string, string>,
  symbol: string,
): string {
  const contractId = firstString(attrs, FLEX_OPEN_POSITION_CONTRACT_ID_KEYS);
  if (contractId) {
    return `id:${contractId}`;
  }

  const underlying = normalizeSymbol(
    firstString(attrs, FLEX_OPEN_POSITION_UNDERLYING_KEYS) ?? symbol,
  ).replace(/[^A-Z0-9]/g, "");
  const expiration = optionExpirationKey(
    firstString(attrs, FLEX_OPEN_POSITION_EXPIRATION_KEYS),
  );
  const strike = firstNumber(attrs, FLEX_OPEN_POSITION_STRIKE_KEYS);
  const right = optionRightCode(firstString(attrs, FLEX_OPEN_POSITION_RIGHT_KEYS));
  if (!underlying || !expiration || strike === null || !right) {
    return "";
  }

  const opraExpiration =
    expiration.length === 8 ? expiration.slice(2) : expiration;
  const strikeKey = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${underlying}${opraExpiration}${right}${strikeKey}`;
}

function flexOpenPositionText(candidate: FlexOpenPositionCandidate): string {
  const rawValues = candidate.raw
    ? Object.values(candidate.raw).map((value) => String(value ?? ""))
    : [];
  return [candidate.symbol, candidate.description, ...rawValues]
    .join(" ")
    .toUpperCase();
}

function flexOpenPositionMatchesOptionContract(
  candidate: FlexOpenPositionCandidate,
  contract: NonNullable<BrokerPositionSnapshot["optionContract"]>,
): boolean {
  const text = flexOpenPositionText(candidate);
  const expiration = toIsoDateString(contract.expirationDate);
  const compactExpiration = expiration.replaceAll("-", "");
  const strike = String(contract.strike).replace(/\.0+$/, "");
  const right = contract.right.toUpperCase();
  return (
    (text.includes(expiration) || text.includes(compactExpiration)) &&
    text.includes(strike) &&
    (text.includes(right) || new RegExp(`\\b${right[0]}\\b`).test(text))
  );
}

function selectFlexOpenPositionCandidate(
  candidates: FlexOpenPositionCandidate[],
): PositionOpenDate | null {
  const sortedBySnapshot = [...candidates].sort(
    (left, right) => right.asOf.getTime() - left.asOf.getTime(),
  );
  const latestStreak: FlexOpenPositionCandidate[] = [];
  let previousAsOf: Date | null = null;
  for (const candidate of sortedBySnapshot) {
    if (
      previousAsOf &&
      previousAsOf.getTime() - candidate.asOf.getTime() >
        FLEX_OPEN_POSITION_STREAK_GAP_MS
    ) {
      break;
    }
    latestStreak.push(candidate);
    previousAsOf = candidate.asOf;
  }

  const selected = latestStreak
    .filter((candidate) => candidate.openedAt)
    .sort((left, right) => {
      const sourceRank = (source: FlexOpenPositionCandidate["openedAtSource"]) =>
        source === "flex_open_position" ? 0 : 1;
      const rankDelta = sourceRank(left.openedAtSource) - sourceRank(right.openedAtSource);
      if (rankDelta !== 0) return rankDelta;
      return left.openedAt.getTime() - right.openedAt.getTime();
    })[0];

  return selected
    ? {
        openedAt: selected.openedAt,
        openedAtSource: selected.openedAtSource,
      }
    : null;
}

function matchFlexOpenPositionCandidate(
  position: BrokerPositionSnapshot,
  candidates: FlexOpenPositionCandidate[],
): PositionOpenDate | null {
  const accountCandidates = candidates.filter(
    (candidate) => candidate.accountId === position.accountId,
  );
  if (!accountCandidates.length) {
    return null;
  }

  const providerContractId = position.optionContract?.providerContractId?.trim();
  if (providerContractId) {
    const contractMatches = accountCandidates.filter(
      (candidate) => candidate.contractId === providerContractId,
    );
    const selected = selectFlexOpenPositionCandidate(contractMatches);
    if (selected) {
      return selected;
    }
  }

  if (position.optionContract) {
    const detailMatches = accountCandidates.filter((candidate) =>
      flexOpenPositionMatchesOptionContract(candidate, position.optionContract!),
    );
    const selected = selectFlexOpenPositionCandidate(detailMatches);
    if (selected) {
      return selected;
    }
  }

  const symbol = normalizeSymbol(position.symbol);
  const symbolMatches = accountCandidates.filter(
    (candidate) => candidate.symbol === symbol,
  );
  if (!position.optionContract || symbolMatches.length === 1) {
    const selected = selectFlexOpenPositionCandidate(symbolMatches);
    if (selected) {
      return selected;
    }
  }

  const underlying = normalizeSymbol(position.optionContract?.underlying ?? "");
  if (underlying) {
    const underlyingMatches = accountCandidates.filter(
      (candidate) => candidate.symbol === underlying,
    );
    if (underlyingMatches.length === 1) {
      return selectFlexOpenPositionCandidate(underlyingMatches);
    }
  }

  return null;
}

async function fetchFlexOpenDatesForPositions(
  universe: AccountUniverse,
  mode: RuntimeMode,
  positions: BrokerPositionSnapshot[],
): Promise<Map<string, PositionOpenDate>> {
  if (!universe.accountIds.length || !positions.length) {
    return new Map();
  }

  const rows = await withOptionalAccountSchema({
    tables: ["flex_open_positions"],
    whenMissing: () => [] as FlexOpenPositionRecord[],
    run: async () =>
      db
        .select()
        .from(flexOpenPositionsTable)
        .where(
          and(
            inArray(
              flexOpenPositionsTable.providerAccountId,
              universe.accountIds,
            ),
            flexProviderAccountOwnershipCondition(
              flexOpenPositionsTable.providerAccountId,
              universe.appUserId,
              mode,
            ),
          ),
        )
        .orderBy(desc(flexOpenPositionsTable.asOf))
        .limit(5_000),
  });

  if (!rows.length) {
    return new Map();
  }

  const candidates = rows.map((row) => {
    const opened = flexOpenPositionOpenedAt(row);
    const raw = isRecord(row.raw) ? row.raw : null;
    return {
      accountId: row.providerAccountId,
      symbol: normalizeSymbol(row.symbol),
      description: row.description ?? "",
      contractId: flexOpenPositionContractId(raw),
      asOf: row.asOf,
      openedAt: opened.openedAt ?? row.asOf,
      openedAtSource: opened.openedAtSource ?? "flex_snapshot",
      raw,
    };
  });

  return new Map(
    positions.flatMap((position) => {
      const opened = matchFlexOpenPositionCandidate(position, candidates);
      return opened ? [[position.id, opened] as const] : [];
    }),
  );
}

async function fetchExecutionOpenDatesForPositions(
  universe: AccountUniverse,
  mode: RuntimeMode,
  positions: BrokerPositionSnapshot[],
): Promise<Map<string, PositionOpenDate>> {
  if (!positions.some((position) => !position.openedAt)) {
    return new Map();
  }

  const positionIds = positions.map((position) => position.id).sort().join(",");
  return readShortLivedAccountCache(
    accountPositionOpenDatesReadCache,
    accountUniverseReadCacheKey("position-open-dates", universe, mode, {
      positionIds,
      positions: accountPositionOpenDateSignature(positions),
    }),
    async () => {
      const executions = await listExecutionsForUniverse(universe, mode, {});
      return stabilizeExecutionOpenDatesForPositions(
        executionOpenDateLastKnownCacheKey(universe, mode, positions),
        positions,
        buildExecutionOpenDatesForPositions(positions, executions),
      );
    },
    ACCOUNT_POSITION_OPEN_DATE_CACHE_TTL_MS,
  );
}

function inferSameDayExpiringOptionOpenDatesForPositions(
  positions: BrokerPositionSnapshot[],
  now = new Date(),
): Map<string, PositionOpenDate> {
  const marketDate = accountMarketDateKey(now);
  if (!marketDate) {
    return new Map();
  }

  return new Map(
    positions.flatMap((position) => {
      if (brokerPositionOpenedAt(position).openedAt || !position.optionContract) {
        return [];
      }
      const expirationDate = position.optionContract.expirationDate;
      if (!(expirationDate instanceof Date) || Number.isNaN(expirationDate.getTime())) {
        return [];
      }
      const expirationMarketDate = toIsoDateString(expirationDate);
      if (expirationMarketDate !== marketDate) {
        return [];
      }
      return [
        [
          position.id,
          {
            openedAt: dateFromDateOnly(expirationMarketDate),
            openedAtSource: "expiration_same_day" as const,
          },
        ] as const,
      ];
    }),
  );
}

function accountPositionOpenDateSignature(
  positions: BrokerPositionSnapshot[],
): string {
  return positions
    .map((position) =>
      [
        position.id,
        position.accountId,
        normalizeSymbol(position.symbol),
        position.quantity,
        position.optionContract?.providerContractId ?? "",
        position.optionContract?.underlying ?? "",
        position.optionContract?.expirationDate?.toISOString?.() ?? "",
        position.optionContract?.strike ?? "",
        position.optionContract?.right ?? "",
      ].join("|"),
    )
    .sort()
    .join(";");
}

function openDateHasValue(openDate: PositionOpenDate | null | undefined): boolean {
  return (
    openDate?.openedAt instanceof Date &&
    !Number.isNaN(openDate.openedAt.getTime())
  );
}

function executionOpenDateLastKnownCacheKey(
  universe: AccountUniverse,
  mode: RuntimeMode,
  positions: BrokerPositionSnapshot[],
): string {
  return accountUniverseReadCacheKey(
    "position-open-dates:last-known",
    universe,
    mode,
    {
      positions: accountPositionOpenDateSignature(positions),
    },
  );
}

function readLastKnownExecutionOpenDates(
  cacheKey: string,
  positionIds: Set<string>,
  now = Date.now(),
): Map<string, PositionOpenDate> | null {
  const cached = accountPositionOpenDatesLastKnownCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= now) {
    accountPositionOpenDatesLastKnownCache.delete(cacheKey);
    return null;
  }
  const filtered = new Map(
    Array.from(cached.value.entries()).filter(
      ([positionId, openDate]) =>
        positionIds.has(positionId) && openDateHasValue(openDate),
    ),
  );
  return filtered.size ? filtered : null;
}

function readLastKnownExecutionOpenDatesForPositions(
  universe: AccountUniverse,
  mode: RuntimeMode,
  positions: BrokerPositionSnapshot[],
): Map<string, PositionOpenDate> {
  if (!positions.some((position) => !position.openedAt)) {
    return new Map();
  }
  return (
    readLastKnownExecutionOpenDates(
      executionOpenDateLastKnownCacheKey(universe, mode, positions),
      new Set(positions.map((position) => position.id)),
    ) ?? new Map()
  );
}

function stabilizeExecutionOpenDatesForPositions(
  cacheKey: string,
  positions: BrokerPositionSnapshot[],
  freshOpenDates: Map<string, PositionOpenDate>,
  now = Date.now(),
): Map<string, PositionOpenDate> {
  const positionIds = new Set(positions.map((position) => position.id));
  const lastKnown = readLastKnownExecutionOpenDates(cacheKey, positionIds, now);
  const merged = new Map(lastKnown ?? []);
  freshOpenDates.forEach((openDate, positionId) => {
    if (positionIds.has(positionId) && openDateHasValue(openDate)) {
      merged.set(positionId, openDate);
    }
  });

  if (merged.size > 0) {
    accountPositionOpenDatesLastKnownCache.set(cacheKey, {
      value: new Map(merged),
      expiresAt: now + ACCOUNT_POSITION_OPEN_DATE_STALE_TTL_MS,
    });
    return merged;
  }

  return freshOpenDates;
}

type ExecutionOpenLot = {
  signedQuantity: number;
  openedAt: Date;
};

function executionPositionGroupKey(execution: BrokerExecutionSnapshot): string {
  const contract = executionOptionContract(execution);
  if (contract) {
    const providerContractId = String(
      contract.providerContractId ??
        contract.brokerContractId ??
        execution.providerContractId ??
        "",
    ).trim();
    return optionContractGroupKey(contract, providerContractId || null);
  }
  return `equity:${normalizeSymbol(execution.symbol).toUpperCase()}`;
}

function buildExecutionOpenDatesForPositions(
  positions: BrokerPositionSnapshot[],
  executions: BrokerExecutionSnapshot[],
): Map<string, PositionOpenDate> {
  const lotsByKey = new Map<string, ExecutionOpenLot[]>();
  const sortedExecutions = [...executions].sort(
    (left, right) => left.executedAt.getTime() - right.executedAt.getTime(),
  );

  for (const execution of sortedExecutions) {
    const quantity = Math.abs(toNumber(execution.quantity) ?? 0);
    if (
      quantity <= POSITION_QUANTITY_EPSILON ||
      Number.isNaN(execution.executedAt.getTime())
    ) {
      continue;
    }

    const side = execution.side === "sell" ? -1 : 1;
    let remaining = quantity * side;
    const key = `${execution.accountId}:${executionPositionGroupKey(execution)}`;
    const lots = lotsByKey.get(key) ?? [];
    lotsByKey.set(key, lots);

    while (
      Math.abs(remaining) > POSITION_QUANTITY_EPSILON &&
      lots.length &&
      lots[0]!.signedQuantity * remaining < 0
    ) {
      const lot = lots[0]!;
      const closeQuantity = Math.min(
        Math.abs(remaining),
        Math.abs(lot.signedQuantity),
      );
      lot.signedQuantity += closeQuantity * Math.sign(remaining);
      remaining -= closeQuantity * Math.sign(remaining);
      if (Math.abs(lot.signedQuantity) <= POSITION_QUANTITY_EPSILON) {
        lots.shift();
      }
    }

    if (Math.abs(remaining) > POSITION_QUANTITY_EPSILON) {
      lots.push({
        signedQuantity: remaining,
        openedAt: execution.executedAt,
      });
    }
  }

  return new Map(
    positions.flatMap((position) => {
      const quantity = toNumber(position.quantity) ?? 0;
      if (Math.abs(quantity) <= POSITION_QUANTITY_EPSILON) {
        return [];
      }

      const key = `${position.accountId}:${positionGroupKey(position)}`;
      const side = Math.sign(quantity);
      const lot = (lotsByKey.get(key) ?? [])
        .filter((candidate) => candidate.signedQuantity * side > 0)
        .sort((left, right) => left.openedAt.getTime() - right.openedAt.getTime())[0];
      return lot
        ? [
            [
              position.id,
              {
                openedAt: lot.openedAt,
                openedAtSource: "execution" as const,
              },
            ] as const,
          ]
        : [];
    }),
  );
}

function bestOpenedAtForPosition(
  position: BrokerPositionSnapshot,
  fallback: PositionOpenDate | null | undefined,
): PositionOpenDate {
  const brokerOpenedAt = brokerPositionOpenedAt(position);
  return brokerOpenedAt.openedAt ? brokerOpenedAt : fallback ?? brokerOpenedAt;
}

function quoteForPosition(
  position: BrokerPositionSnapshot,
  mark: number | null | undefined,
  equityQuoteSnapshots: Map<string, QuoteSnapshot>,
  optionQuoteSnapshots: Map<string, AccountPositionOptionQuoteDemandState>,
): PositionQuoteSnapshot | null {
  const optionDemandState = position.optionContract
    ? optionQuoteDemandStateForPosition(position, optionQuoteSnapshots)
    : null;
  const snapshot = position.optionContract
    ? optionDemandState?.quote ?? null
    : equityQuoteSnapshots.get(normalizeSymbol(positionReferenceSymbol(position)));
  const enriched = buildPositionQuoteFromSnapshot(
    snapshot,
    mark,
    position.optionContract
      ? "option_quote"
      : snapshot && (snapshot as QuoteSnapshot & { source?: string }).source === "massive"
        ? "massive"
        : "bridge_quote",
  );
  return choosePositionQuote(
    position.quote,
    attachAccountOptionQuoteMetadata(enriched, optionDemandState),
  );
}

function optionQuoteForPosition(
  position: AccountPositionOptionQuoteDemandRow,
  optionQuoteSnapshots:
    | Map<string, AccountPositionOptionQuoteDemandState>
    | undefined,
): AccountPositionOptionQuoteSnapshot | null {
  if (!optionQuoteSnapshots) {
    return null;
  }
  return accountOptionQuoteForPosition(position, optionQuoteSnapshots);
}

function earlierPositionOpen(
  current: {
    openedAt: Date | null;
    openedAtSource: BrokerPositionSnapshot["openedAtSource"] | null;
  },
  next: {
    openedAt: Date | null;
    openedAtSource: BrokerPositionSnapshot["openedAtSource"] | null;
  },
) {
  if (!next.openedAt) return current;
  if (!current.openedAt || next.openedAt.getTime() < current.openedAt.getTime()) {
    return next;
  }
  return current;
}

async function hydrateOptionUnderlyingPrices(
  positions: BrokerPositionSnapshot[],
): Promise<Map<string, number>> {
  const symbols = Array.from(
    new Set(
      positions
        .filter(hasOptionContract)
        .map((position) => normalizeSymbol(position.optionContract.underlying))
        .filter(Boolean),
    ),
  );

  if (!symbols.length) {
    return new Map();
  }

  const payload = await getQuoteSnapshots({
    symbols: symbols.join(","),
    allowMassiveFallback: false,
  }).catch(() => ({
    quotes: [],
  }));
  return new Map(
    (payload.quotes || [])
      .map((quote) => [normalizeSymbol(quote.symbol), toNumber(quote.price)] as const)
      .filter((entry): entry is readonly [string, number] => Boolean(entry[0]) && entry[1] !== null),
  );
}

async function getCachedOptionChainContracts(
  positions: OptionPositionSnapshot[],
  options: { refreshChains?: boolean } = {},
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
  const refreshChains = options.refreshChains !== false;
  const cached = optionGreekChainCache.get(cacheKey);

  if (cached && (cached.expiresAt > now || !refreshChains)) {
    return {
      contracts: cached.contracts,
      error: cached.error,
    };
  }

  if (!refreshChains) {
    return {
      contracts: [],
      error: `Option-chain Greek refresh skipped for ${underlying} ${toIsoDateString(expirationDate)}; account positions use live option quote Greeks.`,
    };
  }

  let contracts: OptionChainContract[] = [];
  let error: string | null = null;

  try {
    const initialContracts = (await getOptionChain({
      underlying,
      expirationDate,
      maxExpirations: 1,
      strikesAroundMoney: OPTION_CHAIN_INITIAL_STRIKES_AROUND_MONEY,
      quoteHydration: "metadata",
    })).contracts;
    contracts = initialContracts;
    let resolvedContracts = initialContracts;
    const matchedInitial = positions.filter((position) =>
      matchOptionChainContract(initialContracts, position.optionContract),
    ).length;

    if (matchedInitial < positions.length) {
      const fallbackContracts = (await getOptionChain({
        underlying,
        expirationDate,
        maxExpirations: 1,
        strikesAroundMoney: OPTION_CHAIN_FALLBACK_STRIKES_AROUND_MONEY,
        quoteHydration: "metadata",
      })).contracts;
      resolvedContracts = mergeOptionChainContracts([
        initialContracts,
        fallbackContracts,
      ]);
    }

    contracts = resolvedContracts;
  } catch (fetchError) {
    contracts = contracts.length ? contracts : (cached?.contracts ?? []);
    error =
      fetchError instanceof Error
        ? fetchError.message
        : `Unknown option-chain error for ${underlying} ${toIsoDateString(expirationDate)}.`;
    logger.warn(
      {
        err: fetchError,
        underlying,
        expirationDate,
      },
      "Unable to refresh option-chain greeks",
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
  options: { refreshChains?: boolean } = {},
): Promise<OptionGreekEnrichmentResult> {
  const byPositionId = new Map<string, PositionGreekSnapshot>();
  const warnings = new Set<string>();
  const optionPositions = positions.filter(hasOptionContract);
  const optionChainPositions = optionPositions.filter(
    (position) => position.providerSecurityType !== "robinhood_option",
  );

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
        impliedVolatility: null,
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
    optionChainPositions.reduce<Map<string, OptionPositionSnapshot[]>>(
      (acc, position) => {
        const key = optionChainGroupKey(position.optionContract);
        acc.set(key, [...(acc.get(key) ?? []), position]);
        return acc;
      },
      new Map(),
    ),
  );
  const chainResults = new Map<
    string,
    { contracts: OptionChainContract[]; error: string | null }
  >();

  await Promise.all(
    optionGroups.map(async ([key, group]) => {
      const result = await getCachedOptionChainContracts(group, {
        refreshChains: options.refreshChains,
      });
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
        impliedVolatility: null,
        source: "IBKR_POSITIONS",
        matched: true,
        warning: null,
      });
      return;
    }

    const underlying = position.optionContract.underlying;
    if (position.providerSecurityType === "robinhood_option") {
      const delta = scaleOptionGreek(
        finiteOptionNumber(position.quote?.delta),
        position,
      );
      const gamma = scaleOptionGreek(
        finiteOptionNumber(position.quote?.gamma),
        position,
      );
      const theta = scaleOptionGreek(
        finiteOptionNumber(position.quote?.theta),
        position,
      );
      const vega = scaleOptionGreek(
        finiteOptionNumber(position.quote?.vega),
        position,
      );
      const impliedVolatility = finiteOptionNumber(
        position.quote?.impliedVolatility,
      );
      const betaWeightedDelta =
        delta === null ? null : delta * betaForSymbol(underlying);
      const hasAnyGreek =
        delta !== null || gamma !== null || theta !== null || vega !== null;
      const warning = hasAnyGreek
        ? null
        : `Robinhood returned ${position.symbol} without option greek values.`;
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
        impliedVolatility,
        source: "ROBINHOOD_OPTION_QUOTE",
        matched: hasAnyGreek,
        warning,
      });
      return;
    }

    const contracts =
      chainResults.get(optionChainGroupKey(position.optionContract))?.contracts ?? [];
    const matchedContract = matchOptionChainContract(contracts, position.optionContract);
    const delta = matchedContract ? scaleOptionGreek(matchedContract.delta, position) : null;
    const gamma = matchedContract ? scaleOptionGreek(matchedContract.gamma, position) : null;
    const theta = matchedContract ? scaleOptionGreek(matchedContract.theta, position) : null;
    const vega = matchedContract ? scaleOptionGreek(matchedContract.vega, position) : null;
    const impliedVolatility = matchedContract?.impliedVolatility ?? null;
    const betaWeightedDelta =
      delta === null ? null : delta * betaForSymbol(underlying);
    const hasAnyGreek =
      delta !== null || gamma !== null || theta !== null || vega !== null;
    const warning = !matchedContract
      ? `No Massive greek snapshot matched ${position.symbol}.`
      : !hasAnyGreek
        ? `Massive returned ${position.symbol} contract metadata without option greek values.`
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
      impliedVolatility,
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

function buildDeferredPositionGreekEnrichment(
  positions: BrokerPositionSnapshot[],
): OptionGreekEnrichmentResult {
  const byPositionId = new Map<string, PositionGreekSnapshot>();
  let totalOptionPositions = 0;

  positions.forEach((position) => {
    const underlying = positionReferenceSymbol(position);
    if (!hasOptionContract(position)) {
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
        impliedVolatility: null,
        source: "IBKR_POSITIONS",
        matched: true,
        warning: null,
      });
      return;
    }

    totalOptionPositions += 1;
    byPositionId.set(position.id, {
      positionId: position.id,
      symbol: position.symbol,
      underlying: position.optionContract.underlying,
      delta: null,
      betaWeightedDelta: null,
      gamma: null,
      theta: null,
      vega: null,
      impliedVolatility: null,
      source: "IBKR_OPTION_CHAIN",
      matched: false,
      warning: "Option Greek enrichment deferred during fast account risk read.",
    });
  });

  return {
    byPositionId,
    totalOptionPositions,
    matchedOptionPositions: 0,
    warnings:
      totalOptionPositions > 0
        ? ["Option Greek enrichment deferred during fast account risk read."]
        : [],
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
      "User-Agent": "PYRUS Account Flex Client/1.0",
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
}): Promise<{ referenceCode: string; statementUrl: string | null }> {
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

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const rawXml = await fetchFlexEndpoint(FLEX_SEND_REQUEST_URL, params);
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
        });
      }

      return { referenceCode, statementUrl };
    }

    if (errorCode && FLEX_RETRYABLE_ERROR_CODES.has(errorCode)) {
      if (attempt < maxAttempts - 1) {
        await sleep(FLEX_POLL_INTERVAL_MS);
        continue;
      }

      throw new HttpError(504, "IBKR Flex reference was not ready before timeout.", {
        code: "ibkr_flex_reference_timeout",
      });
    }

    if (status && !/^success$/i.test(status)) {
      throw new HttpError(502, `IBKR Flex returned status "${status}".`, {
        code: "ibkr_flex_request_rejected",
      });
    }
  }

  throw new HttpError(502, "IBKR Flex did not return a reference code.", {
    code: "ibkr_flex_missing_reference",
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

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const rawXml = await fetchFlexEndpoint(
      input.statementUrl || FLEX_GET_STATEMENT_URL,
      {
        t: input.token,
        q: input.referenceCode,
        v: "3",
      },
    );
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
      });
    }

    await sleep(pollIntervalMs);
  }

  throw new HttpError(504, "IBKR Flex report was not ready before timeout.", {
    code: "ibkr_flex_timeout",
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
        statementDate: toIsoDateString(statementDate),
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
    const quantity = firstNumber(attrs, ["quantity", "qty"]);
    const side = normalizeFlexTradeSide(rawSide, quantity);
    if (!side) {
      return [];
    }
    const settleDate = parseDate(
      firstString(attrs, ["settleDate", "settleDateTarget"]),
    );
    const assetClass =
      firstString(attrs, ["assetCategory", "assetClass", "secType"]) ??
      "stock";

    return [
      {
        providerAccountId,
        tradeId,
        symbol,
        description: firstString(attrs, ["description"]),
        assetClass,
        positionType: classifyAccountPositionType({
          symbol,
          assetClass,
          raw: attrs,
        }),
        side,
        quantity: nonNullNumericString(quantity),
        price: numericString(firstNumber(attrs, ["tradePrice", "price"])),
        amount: numericString(firstNumber(attrs, ["amount", "proceeds"])),
        commission: numericString(
          firstNumber(attrs, ["ibCommission", "commission", "commissions"]),
        ),
        currency: firstString(attrs, ["currency"]) ?? "USD",
        tradeDate,
        settleDate: settleDate ? toIsoDateString(settleDate) : null,
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
          assetClass: sql`excluded.asset_class`,
          positionType: sql`excluded.position_type`,
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
          parseDate(firstString(attrs, ["exDate"])) ? toIsoDateString(parseDate(firstString(attrs, ["exDate"])) as Date) : null,
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
    const assetClass =
      firstString(attrs, ["assetCategory", "assetClass", "secType"]) ??
      "stock";

    if (quantity === null) {
      return [];
    }

    return [
      {
        providerAccountId,
        symbol,
        contractKey: flexOpenPositionContractKey(attrs, symbol),
        description: firstString(attrs, ["description"]),
        assetClass,
        positionType: classifyAccountPositionType({
          symbol,
          assetClass,
          raw: attrs,
        }),
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
          flexOpenPositionsTable.contractKey,
        ],
        set: {
          quantity: sql`excluded.quantity`,
          assetClass: sql`excluded.asset_class`,
          positionType: sql`excluded.position_type`,
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

const FLEX_REPORT_ACCOUNT_TAGS = [
  "FlexStatement",
  "ChangeInNAV",
  "NetAssetValue",
  "NAV",
  "EquitySummary",
  "EquitySummaryByReportDateInBase",
  "Trade",
  "CashTransaction",
  "CashReport",
  "DepositWithdraw",
  "OpenPosition",
];

function flexProviderAccountIdsFromReport(xml: string): string[] {
  return Array.from(
    new Set(
      extractFlexRecords(xml, FLEX_REPORT_ACCOUNT_TAGS)
        .map((record) =>
          firstString(record.attributes, ["accountId", "account", "acctId"]),
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );
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
            updatedAt: new Date(),
          })
          .where(eq(flexReportRunsTable.id, run.id));

        const xml = await downloadFlexStatement({
          token: config.token,
          referenceCode: reference.referenceCode,
          statementUrl: reference.statementUrl,
        });
        const providerAccountIds = flexProviderAccountIdsFromReport(xml);
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
            metadata: {
              reason,
              queryIds: configs.map((entry) => entry.queryId),
              window,
              providerAccountIds,
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

const FLEX_COVERAGE_DAY_MS = 86_400_000;

function flexCoverageDay(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (toIsoDateString(new Date(timestamp)) !== value) return null;
  return timestamp / FLEX_COVERAGE_DAY_MS;
}

function completedFlexRunsCoverRange(input: {
  runs: Array<{ metadata: unknown }>;
  providerAccountIds: string[];
  fromDate: string;
  toDate: string;
}): boolean {
  const fromDay = flexCoverageDay(input.fromDate);
  const toDay = flexCoverageDay(input.toDate);
  const accountIds = Array.from(
    new Set(input.providerAccountIds.map((value) => value.trim()).filter(Boolean)),
  );
  if (fromDay == null || toDay == null || fromDay > toDay || !accountIds.length) {
    return false;
  }

  const intervalsByAccount = new Map<string, Array<{ from: number; to: number }>>(
    accountIds.map((accountId) => [accountId, []]),
  );
  input.runs.forEach((run) => {
    if (!isRecord(run.metadata) || !isRecord(run.metadata["window"])) return;
    const providerAccountIds = Array.isArray(run.metadata["providerAccountIds"])
      ? run.metadata["providerAccountIds"].filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [];
    const interval = {
      from: flexCoverageDay(run.metadata["window"]["fromDate"]),
      to: flexCoverageDay(run.metadata["window"]["toDate"]),
    };
    if (interval.from == null || interval.to == null || interval.from > interval.to) {
      return;
    }
    providerAccountIds.forEach((accountId) => {
      intervalsByAccount.get(accountId.trim())?.push({
        from: interval.from as number,
        to: interval.to as number,
      });
    });
  });

  return accountIds.every((accountId) => {
    const intervals = (intervalsByAccount.get(accountId) ?? []).sort(
      (left, right) => left.from - right.from,
    );
    let coveredThrough = fromDay - 1;
    for (const interval of intervals) {
      if (interval.to < fromDay || interval.from > toDay) continue;
      if (interval.from > coveredThrough + 1) return false;
      coveredThrough = Math.max(coveredThrough, interval.to);
      if (coveredThrough >= toDay) return true;
    }
    return false;
  });
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

type ScheduledFlexRefreshDependencies = {
  shouldRunInitialFlexRefresh: () => Promise<boolean>;
  refreshFlexReport: (reason: string) => Promise<unknown>;
};

function runScheduledFlexRefresh(
  reason: "scheduled-initial" | "scheduled",
  dependencies: ScheduledFlexRefreshDependencies = {
    shouldRunInitialFlexRefresh,
    refreshFlexReport,
  },
): Promise<unknown | null> {
  return runInDbLane("background", async () => {
    if (
      reason === "scheduled-initial" &&
      !(await dependencies.shouldRunInitialFlexRefresh())
    ) {
      return null;
    }
    return await dependencies.refreshFlexReport(reason);
  });
}

export function startAccountFlexRefreshScheduler(): void {
  if (!flexConfigured()) {
    logger.info("IBKR Flex env vars are not configured; daily Flex refresh disabled");
    return;
  }

  setTimeout(() => {
    void runScheduledFlexRefresh("scheduled-initial").catch((error) => {
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
      runScheduledFlexRefresh("scheduled")
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
  appUserId?: string | null;
  nowMs?: () => number;
  logger?: AccountSnapshotPersistenceLogger;
  persistSnapshots?: (accounts: BrokerAccountSnapshot[]) => Promise<void>;
  backoff?: ReturnType<typeof createTransientPostgresBackoff>;
};

async function persistAccountSnapshotsToDb(
  accounts: BrokerAccountSnapshot[],
  appUserId: string | null,
): Promise<void> {
  const mode = accounts[0]?.mode ?? getRuntimeMode();
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId,
      name: "Interactive Brokers Bridge",
      connectionType: "broker",
      brokerProvider: "ibkr",
      mode,
      status: "connected",
      capabilities: ["accounts", "positions", "orders", "executions"],
      isDefault: true,
    })
    .onConflictDoUpdate({
      target:
        appUserId === null
          ? [
              brokerConnectionsTable.connectionType,
              brokerConnectionsTable.mode,
              brokerConnectionsTable.name,
            ]
          : [
              brokerConnectionsTable.appUserId,
              brokerConnectionsTable.connectionType,
              brokerConnectionsTable.mode,
              brokerConnectionsTable.name,
            ],
      targetWhere:
        appUserId === null
          ? sql`${brokerConnectionsTable.appUserId} is null`
          : isNotNull(brokerConnectionsTable.appUserId),
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
        appUserId,
        connectionId: connection.id,
        providerAccountId: account.providerAccountId,
        displayName: account.displayName,
        mode: account.mode,
        baseCurrency: account.currency,
        lastSyncedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target:
          appUserId === null
            ? brokerAccountsTable.providerAccountId
            : [
                brokerAccountsTable.appUserId,
                brokerAccountsTable.providerAccountId,
              ],
        targetWhere:
          appUserId === null
            ? sql`${brokerAccountsTable.appUserId} is null`
            : isNotNull(brokerAccountsTable.appUserId),
        set: {
          displayName: account.displayName,
          mode: account.mode,
          baseCurrency: account.currency,
          lastSyncedAt: new Date().toISOString(),
          updatedAt: new Date(),
        },
      })
      .returning({ id: brokerAccountsTable.id });

    const snapshotAsOf = account.updatedAt ?? new Date();
    const snapshotAsOfMs = snapshotAsOf.getTime();
    const cacheKey = snapshotAccountCacheKey(account, appUserId);
    if (snapshotProviderTimestamps.get(cacheKey) === snapshotAsOfMs) {
      continue;
    }

    await db.transaction(async (transaction) => {
      await transaction.execute(sql`
        select ${brokerAccountsTable.id}
        from ${brokerAccountsTable}
        where ${brokerAccountsTable.id} = ${brokerAccount.id}
        for update
      `);
      const [existing] = await transaction
        .select({ id: balanceSnapshotsTable.id })
        .from(balanceSnapshotsTable)
        .where(
          and(
            eq(balanceSnapshotsTable.accountId, brokerAccount.id),
            eq(balanceSnapshotsTable.asOf, snapshotAsOf),
          ),
        )
        .limit(1);
      if (existing) {
        return;
      }
      await transaction
        .insert(balanceSnapshotsTable)
        .values({
          accountId: brokerAccount.id,
          currency: account.currency,
          cash: String(account.cash),
          buyingPower: String(account.buyingPower),
          netLiquidation: String(account.netLiquidation),
          maintenanceMargin:
            account.maintenanceMargin === null ||
            account.maintenanceMargin === undefined
              ? null
              : String(account.maintenanceMargin),
          asOf: snapshotAsOf,
        })
        .onConflictDoNothing();
    });
    snapshotProviderTimestamps.set(cacheKey, snapshotAsOfMs);
  }
}

export async function recordAccountSnapshots(
  accounts: BrokerAccountSnapshot[],
  options: AccountSnapshotPersistenceOptions = {},
): Promise<void> {
  const now = options.nowMs?.() ?? Date.now();
  const appUserId =
    options.appUserId === undefined ? getCurrentAppUserId() : options.appUserId;
  const persistSnapshots =
    options.persistSnapshots ??
    ((snapshots: BrokerAccountSnapshot[]) =>
      persistAccountSnapshotsToDb(snapshots, appUserId));
  const backoff = options.backoff ?? accountSnapshotPersistenceBackoff;
  if (backoff.isActive(now)) {
    return;
  }

  const dueAccounts = accounts.filter((account) => {
    const last =
      snapshotWriteTimestamps.get(snapshotAccountCacheKey(account, appUserId)) ?? 0;
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
    .forEach((account) =>
      snapshotWriteTimestamps.set(snapshotAccountCacheKey(account, appUserId), now),
    );

  if (!persistableDueAccounts.length) {
    return;
  }

  try {
    await runInDbLane("background", () =>
      persistSnapshots(persistableDueAccounts),
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
    snapshotWriteTimestamps.set(snapshotAccountCacheKey(account, appUserId), now);
  }
}

type ListAccountsOptions = {
  appUserId?: string | null;
  allowDirectIbkr?: boolean;
  listLiveAccounts?: (mode: RuntimeMode) => Promise<BrokerAccountSnapshot[]>;
  hydrateDayPnl?: (
    accounts: BrokerAccountSnapshot[],
  ) => Promise<BrokerAccountSnapshot[]>;
  recordSnapshots?: (accounts: BrokerAccountSnapshot[]) => Promise<void>;
  getSnapTradeAccounts?: (
    mode: RuntimeMode,
    appUserId: string | null,
  ) => Promise<BrokerAccountSnapshot[]>;
  getRobinhoodAccounts?: (
    mode: RuntimeMode,
    appUserId: string | null,
  ) => Promise<BrokerAccountSnapshot[]>;
};

const SNAPTRADE_LOCAL_ID_PREFIX = "snaptrade:";

// Live portfolio balances for a single SnapTrade account.
type SnapTradeAccountBalanceValues = {
  netLiquidation: number;
  cash: number;
  buyingPower: number;
  currency: string;
};

type RobinhoodAccountBalanceValues = {
  netLiquidation: number;
  cash: number;
  buyingPower: number;
  currency: string;
};

type TimedAccountBalanceValues<T> = T & { updatedAt: Date };

// A persisted SnapTrade account identity paired with its owning app user so the
// required live portfolio balance fetch can be user-scoped.
type SnapTradeAccountRecord = {
  snapshot: BackedAccountIdentity;
  appUserId: string | null;
};

type RobinhoodAccountRecord = {
  snapshot: BackedAccountIdentity;
  appUserId: string | null;
};

type BackedAccountReadiness = {
  includedInTrading: boolean;
  capabilities: string[];
  accountStatus: string | null;
  executionReady: boolean;
  executionBlockers: string[];
  agentic?: boolean | null;
};

export type SnapTradeAccountPortfolioFetcher = (input: {
  appUserId: string;
  accountId: string;
  onStageTiming?: (
    stage: SnapTradeAccountPortfolioStage,
    durationMs: number,
  ) => void;
}) => Promise<SnapTradeAccountPortfolioResponse>;

export type RobinhoodAccountPortfolioFetcher = (input: {
  appUserId: string;
  accountNumber: string;
}) => Promise<unknown>;

function withTradingInclusionDefault(
  accounts: BrokerAccountSnapshot[],
): BrokerAccountSnapshot[] {
  return accounts.map((account) => {
    const accountWithInclusion = account as BrokerAccountSnapshot & {
      includedInTrading?: unknown;
    };
    return {
      ...account,
      includedInTrading:
        typeof accountWithInclusion.includedInTrading === "boolean"
          ? accountWithInclusion.includedInTrading
          : true,
    };
  });
}

function accountListSnapshotCondition(accounts: BrokerAccountSnapshot[]) {
  const providerAccountIds = accounts
    .map((account) => account.providerAccountId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const localAccountIds = accounts
    .map((account) => account.id)
    .filter((value): value is string => UUID_V4_OR_COMPATIBLE_PATTERN.test(value));
  const conditions = [];
  if (providerAccountIds.length) {
    conditions.push(inArray(brokerAccountsTable.providerAccountId, providerAccountIds));
  }
  if (localAccountIds.length) {
    conditions.push(inArray(brokerAccountsTable.id, localAccountIds));
  }
  return conditions.length > 1 ? or(...conditions) : conditions[0];
}

function accountListSnapshotKeys(account: BrokerAccountSnapshot): string[] {
  return [account.id, account.providerAccountId].filter(
    (value, index, values): value is string =>
      typeof value === "string" && value.length > 0 && values.indexOf(value) === index,
  );
}

async function withAccountListDayPnl(
  accounts: BrokerAccountSnapshot[],
  appUserId: string | null,
): Promise<BrokerAccountSnapshot[]> {
  const condition = accountListSnapshotCondition(accounts);
  if (!accounts.length || !condition) {
    return accounts;
  }

  const snapshotRows = await withAccountDbRead(() =>
    db
      .select({
        localAccountId: brokerAccountsTable.id,
        providerAccountId: brokerAccountsTable.providerAccountId,
        asOf: balanceSnapshotsTable.asOf,
        netLiquidation: balanceSnapshotsTable.netLiquidation,
      })
      .from(balanceSnapshotsTable)
      .innerJoin(
        brokerAccountsTable,
        eq(balanceSnapshotsTable.accountId, brokerAccountsTable.id),
      )
      .where(and(brokerAccountOwnershipCondition(appUserId), condition))
      .orderBy(desc(balanceSnapshotsTable.asOf))
      .limit(Math.max(200, accounts.length * 20)),
  );

  const rowsByKey = new Map<
    string,
    Array<{ asOf: Date; netLiquidation: number }>
  >();
  for (const row of snapshotRows) {
    const netLiquidation = toNumber(row.netLiquidation);
    if (netLiquidation == null) continue;
    for (const key of [row.localAccountId, row.providerAccountId]) {
      const bucket = rowsByKey.get(key) ?? [];
      bucket.push({ asOf: row.asOf, netLiquidation });
      rowsByKey.set(key, bucket);
    }
  }

  const baselinesByAccountId = new Map(
    accounts.map((account) => {
      const marketDate =
        accountMarketDateKey(account.updatedAt) ?? accountMarketDateKey(new Date());
      const rows =
        accountListSnapshotKeys(account)
          .map((key) => rowsByKey.get(key) ?? [])
          .find((bucket) => bucket.length > 0) ?? [];
      return [
        account.id,
        marketDate
          ? (rows.find((row) => accountMarketDateKey(row.asOf) !== marketDate) ?? null)
          : null,
      ] as const;
    }),
  );
  const baselineTimes = Array.from(baselinesByAccountId.values())
    .filter((row): row is { asOf: Date; netLiquidation: number } => row !== null)
    .map((row) => row.asOf.getTime());
  const latestAccountTime = Math.max(
    ...accounts.map((account) => account.updatedAt.getTime()),
  );
  const providerAccountIds = accounts
    .filter((account) => account.provider === "ibkr")
    .map((account) => account.providerAccountId)
    .filter(Boolean);
  const ownedProviderAccountIds = db
    .select({ providerAccountId: brokerAccountsTable.providerAccountId })
    .from(brokerAccountsTable)
    .where(and(brokerAccountOwnershipCondition(appUserId), condition));
  const transferRows =
    baselineTimes.length && providerAccountIds.length
      ? await withOptionalAccountSchema({
          tables: ["flex_cash_activity"],
          whenMissing: () => [],
          run: () =>
            db
              .select({
                providerAccountId: flexCashActivityTable.providerAccountId,
                activityType: flexCashActivityTable.activityType,
                description: flexCashActivityTable.description,
                amount: flexCashActivityTable.amount,
                activityDate: flexCashActivityTable.activityDate,
              })
              .from(flexCashActivityTable)
              .where(
                and(
                  inArray(flexCashActivityTable.providerAccountId, providerAccountIds),
                  inArray(
                    flexCashActivityTable.providerAccountId,
                    ownedProviderAccountIds,
                  ),
                  gte(flexCashActivityTable.activityDate, new Date(Math.min(...baselineTimes))),
                  lte(flexCashActivityTable.activityDate, new Date(latestAccountTime)),
                ),
              ),
        })
      : [];

  return accounts.map((account) => {
    const currentNav = toNumber(account.netLiquidation);
    const baseline = baselinesByAccountId.get(account.id) ?? null;
    if (currentNav == null || !baseline) {
      return {
        ...account,
        dayPnl: null,
        dayPnlPercent: null,
      };
    }
    const externalTransfer = transferRows.reduce((sum, row) => {
      if (
        row.providerAccountId !== account.providerAccountId ||
        row.activityDate <= baseline.asOf ||
        row.activityDate > account.updatedAt
      ) {
        return sum;
      }
      return sum + (classifyExternalCashTransfer(row) ?? 0);
    }, 0);
    const dayPnl = currentNav - baseline.netLiquidation - externalTransfer;
    return {
      ...account,
      dayPnl,
      dayPnlPercent: baseline.netLiquidation
        ? (dayPnl / Math.abs(baseline.netLiquidation)) * 100
        : null,
    };
  });
}

// Reads connected SnapTrade account identities once so account valuation and
// positions availability can apply different failure semantics without
// duplicating the ownership-scoped database query.
async function readSnapTradeAccountRecords(
  mode: RuntimeMode,
  appUserId: string | null,
): Promise<SnapTradeAccountRecord[]> {
  if (!appUserId) return [];

  const rows = await db
    .select({
      id: brokerAccountsTable.id,
      appUserId: brokerAccountsTable.appUserId,
      providerAccountId: brokerAccountsTable.providerAccountId,
      displayName: brokerAccountsTable.displayName,
      accountType: brokerAccountsTable.accountType,
      capabilities: brokerAccountsTable.capabilities,
      connectionCapabilities: brokerConnectionsTable.capabilities,
      includedInTrading: brokerAccountsTable.includedInTrading,
      baseCurrency: brokerAccountsTable.baseCurrency,
      mode: brokerAccountsTable.mode,
      lastSyncedAt: brokerAccountsTable.lastSyncedAt,
      updatedAt: brokerAccountsTable.updatedAt,
    })
    .from(brokerAccountsTable)
    .innerJoin(
      brokerConnectionsTable,
      eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
    )
    .where(
      and(
        eq(brokerAccountsTable.appUserId, appUserId),
        eq(brokerAccountsTable.mode, mode),
        eq(brokerAccountsTable.includedInTrading, true),
        eq(brokerConnectionsTable.brokerProvider, "snaptrade"),
        eq(brokerConnectionsTable.status, "connected"),
      ),
    )
    .limit(1_000);

  const records: SnapTradeAccountRecord[] = rows.map((row) => {
    const rawSnapTradeId = row.providerAccountId.startsWith(
      SNAPTRADE_LOCAL_ID_PREFIX,
    )
      ? row.providerAccountId.slice(SNAPTRADE_LOCAL_ID_PREFIX.length).trim()
      : row.providerAccountId;
    const syncedAt = row.lastSyncedAt ? new Date(row.lastSyncedAt) : null;
    return {
      appUserId: row.appUserId,
      snapshot: {
        id: row.id,
        providerAccountId: rawSnapTradeId || row.providerAccountId,
        accountNumberLastFour:
          row.capabilities
            .find((capability) =>
              capability.startsWith("snaptrade-account-last4:"),
            )
            ?.slice("snaptrade-account-last4:".length) ?? null,
        brokerageSlug:
          row.connectionCapabilities
            .find((capability) => capability.startsWith("snaptrade-brokerage:"))
            ?.slice("snaptrade-brokerage:".length) ?? null,
        provider: "snaptrade" as const,
        mode: row.mode,
        displayName: row.displayName || "SnapTrade account",
        currency: row.baseCurrency || "USD",
        accountType: row.accountType,
        includedInTrading: row.includedInTrading,
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
        updatedAt:
          syncedAt && !Number.isNaN(syncedAt.getTime())
            ? syncedAt
            : row.updatedAt ?? new Date(),
      },
    };
  });

  return records;
}

async function getSnapTradeValuedAccounts(
  mode: RuntimeMode,
  appUserId: string | null,
): Promise<BrokerAccountSnapshot[]> {
  return applySnapTradeAccountBalances(
    await readSnapTradeAccountRecords(mode, appUserId),
  );
}

function snapTradeListAccountsFromResolution(
  resolution: SnapTradePositionAccountResolution,
): BrokerAccountSnapshot[] {
  return [
    ...resolution.accounts,
    ...resolution.positionOnlyAccounts.map((account) => ({
      ...account,
      buyingPower: null,
      cash: null,
      netLiquidation: null,
    })),
  ];
}

async function getSnapTradeBackedAccounts(
  mode: RuntimeMode,
  appUserId: string | null,
): Promise<BrokerAccountSnapshot[]> {
  return snapTradeListAccountsFromResolution(
    await resolveSnapTradeAccountsForPositions(
      await readSnapTradeAccountRecords(mode, appUserId),
    ),
  );
}

async function getSnapTradePositionBackedAccounts(
  mode: RuntimeMode,
  appUserId: string | null,
  deps: SnapTradePositionAccountReadOptions = {},
): Promise<SnapTradePositionAccountResolution> {
  return resolveSnapTradeAccountsForPositions(
    await readSnapTradeAccountRecords(mode, appUserId),
    deps,
  );
}

export async function getRobinhoodBackedAccounts(
  mode: RuntimeMode,
  appUserId: string | null,
  deps: Parameters<typeof applyRobinhoodAccountBalances>[1] = {},
): Promise<BrokerAccountSnapshot[]> {
  if (!appUserId) return [];

  const rows = await db
    .select({
      id: brokerAccountsTable.id,
      appUserId: brokerAccountsTable.appUserId,
      providerAccountId: brokerAccountsTable.providerAccountId,
      displayName: brokerAccountsTable.displayName,
      accountType: brokerAccountsTable.accountType,
      includedInTrading: brokerAccountsTable.includedInTrading,
      baseCurrency: brokerAccountsTable.baseCurrency,
      mode: brokerAccountsTable.mode,
      accountStatus: brokerAccountsTable.accountStatus,
      capabilities: brokerAccountsTable.capabilities,
      executionBlockers: brokerAccountsTable.executionBlockers,
      lastSyncedAt: brokerAccountsTable.lastSyncedAt,
      updatedAt: brokerAccountsTable.updatedAt,
    })
    .from(brokerAccountsTable)
    .innerJoin(
      brokerConnectionsTable,
      eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
    )
    .where(
      and(
        eq(brokerAccountsTable.appUserId, appUserId),
        eq(brokerAccountsTable.mode, mode),
        eq(brokerAccountsTable.includedInTrading, true),
        eq(brokerConnectionsTable.brokerProvider, "robinhood"),
        eq(brokerConnectionsTable.status, "connected"),
      ),
    )
    .limit(1_000);

  const records: RobinhoodAccountRecord[] = rows.map((row) => {
    const syncedAt = row.lastSyncedAt ? new Date(row.lastSyncedAt) : null;
    const executionBlockers = [...row.executionBlockers];
    const accountStatus = row.accountStatus ?? null;
    const capabilities = [...row.capabilities];
    const agentic = executionBlockers.includes("robinhood.account.non_agentic")
      ? false
      : executionBlockers.includes("robinhood.account.agentic_unverified")
        ? null
        : true;
    return {
      appUserId: row.appUserId,
      snapshot: {
        id: row.id,
        providerAccountId: row.providerAccountId,
        provider: "robinhood",
        mode: row.mode,
        displayName: row.displayName || "Robinhood account",
        currency: row.baseCurrency || "USD",
        accountType: row.accountType,
        includedInTrading: row.includedInTrading,
        capabilities,
        accountStatus,
        executionReady:
          executionBlockers.length === 0 &&
          (accountStatus == null || accountStatus === "open"),
        executionBlockers,
        agentic,
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
        updatedAt:
          syncedAt && !Number.isNaN(syncedAt.getTime())
            ? syncedAt
            : row.updatedAt ?? new Date(),
      } satisfies BackedAccountIdentity & BackedAccountReadiness,
    };
  });

  return applyRobinhoodAccountBalances(records, deps);
}

const SNAPTRADE_PRESENCE_CACHE_TTL_MS = 30_000;
const SNAPTRADE_GLOBAL_PRESENCE_CACHE_KEY = "__global__";
const snapTradePresenceCache = new Map<
  string,
  { value: boolean; expiresAtMs: number }
>();
const snapTradePresenceInFlight = new Map<string, Promise<boolean>>();

async function readSnapTradeAccountPresence(
  appUserId: string | null,
): Promise<boolean> {
  try {
    const conditions = [
      eq(brokerConnectionsTable.brokerProvider, "snaptrade"),
      eq(brokerConnectionsTable.status, "connected"),
    ];
    if (appUserId) {
      conditions.push(eq(brokerAccountsTable.appUserId, appUserId));
    }
    const rows = await db
      .select({ id: brokerAccountsTable.id })
      .from(brokerAccountsTable)
      .innerJoin(
        brokerConnectionsTable,
        eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
      )
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  } catch (error) {
    logger.warn(
      { err: error },
      "snaptrade account presence check failed; treating as absent",
    );
    return false;
  }
}

export async function hasSnapTradeBackedAccounts(input: {
  appUserId?: string | null;
} = {}): Promise<boolean> {
  const appUserId = input.appUserId ?? getCurrentAppUserId();
  const cacheKey = appUserId ?? SNAPTRADE_GLOBAL_PRESENCE_CACHE_KEY;
  const nowMs = Date.now();
  const cached = snapTradePresenceCache.get(cacheKey);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.value;
  }
  let inFlight = snapTradePresenceInFlight.get(cacheKey);
  if (!inFlight) {
    inFlight = readSnapTradeAccountPresence(appUserId)
      .then((value) => {
        snapTradePresenceCache.set(cacheKey, {
          value,
          expiresAtMs: Date.now() + SNAPTRADE_PRESENCE_CACHE_TTL_MS,
        });
        return value;
      })
      .finally(() => {
        snapTradePresenceInFlight.delete(cacheKey);
      });
    snapTradePresenceInFlight.set(cacheKey, inFlight);
  }
  return inFlight;
}

const ROBINHOOD_PRESENCE_CACHE_TTL_MS = 30_000;
const robinhoodPresenceCache = new Map<
  string,
  { value: boolean; expiresAtMs: number }
>();
const robinhoodPresenceInFlight = new Map<string, Promise<boolean>>();

async function readRobinhoodAccountPresence(
  appUserId: string | null,
): Promise<boolean> {
  try {
    const conditions = [
      eq(brokerConnectionsTable.brokerProvider, "robinhood"),
      eq(brokerConnectionsTable.status, "connected"),
    ];
    if (appUserId) {
      conditions.push(eq(brokerAccountsTable.appUserId, appUserId));
    }
    const rows = await db
      .select({ id: brokerAccountsTable.id })
      .from(brokerAccountsTable)
      .innerJoin(
        brokerConnectionsTable,
        eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
      )
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  } catch (error) {
    logger.warn(
      { err: error },
      "robinhood account presence check failed; treating as absent",
    );
    return false;
  }
}

// Multi-broker admission companion to hasSnapTradeBackedAccounts: a connected
// Robinhood account also admits real-account routes for its owner, so a
// Robinhood-only caller is not rejected before scoped resolution
// (WO-P2-ACCTSCOPE). Cached per app user like the SnapTrade presence probe.
export async function hasRobinhoodBackedAccounts(input: {
  appUserId?: string | null;
} = {}): Promise<boolean> {
  const appUserId = input.appUserId ?? getCurrentAppUserId();
  const cacheKey = appUserId ?? SNAPTRADE_GLOBAL_PRESENCE_CACHE_KEY;
  const nowMs = Date.now();
  const cached = robinhoodPresenceCache.get(cacheKey);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.value;
  }
  let inFlight = robinhoodPresenceInFlight.get(cacheKey);
  if (!inFlight) {
    inFlight = readRobinhoodAccountPresence(appUserId)
      .then((value) => {
        robinhoodPresenceCache.set(cacheKey, {
          value,
          expiresAtMs: Date.now() + ROBINHOOD_PRESENCE_CACHE_TTL_MS,
        });
        return value;
      })
      .finally(() => {
        robinhoodPresenceInFlight.delete(cacheKey);
      });
    robinhoodPresenceInFlight.set(cacheKey, inFlight);
  }
  return inFlight;
}

function snapTradeBalanceValuesFromPortfolio(
  portfolio: SnapTradeAccountPortfolioResponse,
  fallbackCurrency: string,
): SnapTradeAccountBalanceValues {
  const normalizedTotals = buildSnapTradeAccountPortfolioTotals({
    baseCurrency: portfolio.account.baseCurrency || fallbackCurrency,
    balances: portfolio.balances,
    positions: portfolio.positions,
  });
  const cashValue = normalizedTotals.cash ?? portfolio.totals.cash;
  const buyingPowerValue =
    normalizedTotals.buyingPower ?? portfolio.totals.buyingPower;
  const positionMarketValue =
    normalizedTotals.positionMarketValue ?? portfolio.totals.positionMarketValue;
  const netLiquidation =
    positionMarketValue != null && cashValue != null
      ? cashValue + positionMarketValue
      : (portfolio.totals.netLiquidation ??
        normalizedTotals.netLiquidation ??
        cashValue);
  if (
    cashValue == null ||
    buyingPowerValue == null ||
    netLiquidation == null
  ) {
    throw new HttpError(503, "SnapTrade account balances are unavailable.", {
      code: "snaptrade_account_balances_unavailable",
      expose: true,
    });
  }
  return {
    netLiquidation,
    cash: cashValue,
    buyingPower: buyingPowerValue,
    currency: portfolio.account.baseCurrency || fallbackCurrency,
  };
}

// Resolves live balances for a single SnapTrade account, serving only a fresh
// cached value and deduping concurrent in-flight fetches.
async function resolveSnapTradeAccountBalance(
  record: SnapTradeAccountRecord,
  fetchPortfolio: SnapTradeAccountPortfolioFetcher,
  now: () => number,
  onStageTiming?: (
    stage: SnapTradeAccountPortfolioStage,
    durationMs: number,
  ) => void,
): Promise<TimedAccountBalanceValues<SnapTradeAccountBalanceValues>> {
  const appUserId = record.appUserId;
  if (!appUserId) {
    throw new HttpError(503, "SnapTrade account identity is unavailable.", {
      code: "snaptrade_account_identity_unavailable",
      expose: true,
    });
  }
  const accountId = record.snapshot.id;
  const nowMs = now();
  const cached = snapTradeAccountBalanceCache.get(accountId);
  if (cached && cached.expiresAt > nowMs) {
    return cached.value;
  }
  const inflight = snapTradeAccountBalanceInflight.get(accountId);
  if (inflight) {
    return inflight;
  }
  const cachedPortfolio = readLatestSnapTradeAccountPortfolio({
    appUserId,
    accountId,
    now: nowMs,
  });
  if (cachedPortfolio) {
    return {
      ...snapTradeBalanceValuesFromPortfolio(
        cachedPortfolio,
        record.snapshot.currency,
      ),
      updatedAt:
        parseDate(cachedPortfolio.syncedAt) ?? record.snapshot.updatedAt,
    };
  }

  const request = (async () => {
    const portfolio = await fetchPortfolio({
      appUserId,
      accountId,
      onStageTiming,
    });
    const cachedAt = now();
    const expiresAt = cachedAt + SNAPTRADE_BALANCE_CACHE_TTL_MS;
    rememberLatestSnapTradeAccountPortfolio({
      appUserId,
      accountId,
      value: portfolio,
      expiresAt,
    });
    const value = {
      ...snapTradeBalanceValuesFromPortfolio(
        portfolio,
        record.snapshot.currency,
      ),
      updatedAt: new Date(cachedAt),
    };
    snapTradeAccountBalanceCache.set(accountId, {
      value,
      expiresAt,
    });
    return value;
  })().finally(() => {
    snapTradeAccountBalanceInflight.delete(accountId);
  });
  snapTradeAccountBalanceInflight.set(accountId, request);
  return request;
}

async function mapSnapTradeAccountRecords<T>(
  records: SnapTradeAccountRecord[],
  resolve: (record: SnapTradeAccountRecord) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(records.length);
  let nextIndex = 0;
  const workerCount = Math.min(
    records.length,
    SNAPTRADE_BALANCE_FETCH_CONCURRENCY,
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= records.length) {
          return;
        }
        results[index] = await resolve(records[index]);
      }
    }),
  );
  return results;
}

type SnapTradePositionAccountResolution = {
  accounts: BrokerAccountSnapshot[];
  positionOnlyAccounts: BackedAccountIdentity[];
};

async function resolveSnapTradeAccountsForPositions(
  records: SnapTradeAccountRecord[],
  deps: {
    fetchPortfolio?: SnapTradeAccountPortfolioFetcher;
    now?: () => number;
    onStageTiming?: (
      stage: SnapTradeAccountPortfolioStage,
      durationMs: number,
    ) => void;
  } = {},
): Promise<SnapTradePositionAccountResolution> {
  const fetchPortfolio = deps.fetchPortfolio ?? getSnapTradeAccountPortfolio;
  const now = deps.now ?? Date.now;
  const resolved = await mapSnapTradeAccountRecords(records, async (record) => {
    try {
      const balances = await resolveSnapTradeAccountBalance(
        record,
        fetchPortfolio,
        now,
        deps.onStageTiming,
      );
      return {
        account: {
          ...record.snapshot,
          ...balances,
        } satisfies BrokerAccountSnapshot,
        positionOnlyAccount: null,
      };
    } catch (error) {
      if (
        !(error instanceof HttpError) ||
        error.code !== "snaptrade_account_balances_unavailable"
      ) {
        throw error;
      }
      const portfolio = readLatestSnapTradeAccountPortfolio({
        appUserId: record.appUserId,
        accountId: record.snapshot.id,
        now: now(),
      });
      if (!portfolio) {
        throw error;
      }
      const syncedAt = new Date(portfolio.syncedAt);
      return {
        account: null,
        positionOnlyAccount: {
          ...record.snapshot,
          updatedAt: Number.isNaN(syncedAt.getTime())
            ? record.snapshot.updatedAt
            : syncedAt,
        },
      };
    }
  });

  return {
    accounts: resolved.flatMap((entry) =>
      entry.account ? [entry.account] : [],
    ),
    positionOnlyAccounts: resolved.flatMap((entry) =>
      entry.positionOnlyAccount ? [entry.positionOnlyAccount] : [],
    ),
  };
}

// Hydrates SnapTrade account identities with current portfolio balances.
export async function applySnapTradeAccountBalances(
  records: SnapTradeAccountRecord[],
  deps: {
    fetchPortfolio?: SnapTradeAccountPortfolioFetcher;
    now?: () => number;
    onStageTiming?: (
      stage: SnapTradeAccountPortfolioStage,
      durationMs: number,
    ) => void;
  } = {},
): Promise<BrokerAccountSnapshot[]> {
  if (records.length === 0) {
    return [];
  }
  const fetchPortfolio = deps.fetchPortfolio ?? getSnapTradeAccountPortfolio;
  const now = deps.now ?? Date.now;

  return mapSnapTradeAccountRecords(records, async (record) => {
    const balances = await resolveSnapTradeAccountBalance(
      record,
      fetchPortfolio,
      now,
      deps.onStageTiming,
    );
    return {
      ...record.snapshot,
      ...balances,
    };
  });
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function robinhoodAccountNumber(providerAccountId: string): string {
  return providerAccountId.startsWith(ROBINHOOD_LOCAL_ID_PREFIX)
    ? providerAccountId.slice(ROBINHOOD_LOCAL_ID_PREFIX.length).trim()
    : providerAccountId;
}

function robinhoodBalanceValuesFromPortfolio(
  payload: unknown,
  fallbackCurrency: string,
): RobinhoodAccountBalanceValues {
  const root = recordOf(payload);
  const data = recordOf(root["data"]);
  const buyingPower = recordOf(data["buying_power"]);
  const currency =
    (typeof data["currency"] === "string" && data["currency"].trim()) ||
    (typeof buyingPower["display_currency"] === "string" &&
      buyingPower["display_currency"].trim()) ||
    fallbackCurrency;
  const cash = toNumber(data["cash"]);
  const netLiquidation = toNumber(data["total_value"]);
  const buyingPowerValue = toNumber(buyingPower["buying_power"]);
  if (cash == null || netLiquidation == null || buyingPowerValue == null) {
    throw new HttpError(503, "Robinhood account balances are unavailable.", {
      code: "robinhood_account_balances_unavailable",
      expose: true,
    });
  }
  return {
    netLiquidation,
    cash,
    buyingPower: buyingPowerValue,
    currency: currency.toUpperCase(),
  };
}

function createRobinhoodAccountPortfolioFetcher(options: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  encryptionKey?: string;
  mcpUrl?: string;
  now?: () => number;
} = {}): RobinhoodAccountPortfolioFetcher {
  const sessionsByUser = new Map<string, Promise<RobinhoodMcpSession>>();
  return async ({ appUserId, accountNumber }) => {
    let sessionPromise = sessionsByUser.get(appUserId);
    if (!sessionPromise) {
      sessionPromise = (async () => {
        const accessToken = await getRobinhoodAccessToken({
          appUserId,
          env: options.env,
          fetchImpl: options.fetchImpl,
          encryptionKey: options.encryptionKey,
          now: options.now ? new Date(options.now()) : undefined,
        });
        const session = new RobinhoodMcpSession({
          accessToken,
          fetchImpl: options.fetchImpl,
          mcpUrl: options.mcpUrl,
        });
        await session.initialize();
        return session;
      })();
      sessionsByUser.set(appUserId, sessionPromise);
    }

    const session = await sessionPromise;
    return session.callTool({
      name: "get_portfolio",
      arguments: { account_number: accountNumber },
    });
  };
}

async function resolveRobinhoodAccountBalance(
  record: RobinhoodAccountRecord,
  fetchPortfolio: RobinhoodAccountPortfolioFetcher,
  now: () => number,
): Promise<TimedAccountBalanceValues<RobinhoodAccountBalanceValues>> {
  const appUserId = record.appUserId;
  const accountId = record.snapshot.id;
  const accountNumber = robinhoodAccountNumber(record.snapshot.providerAccountId);
  if (!appUserId || !accountNumber) {
    throw new HttpError(503, "Robinhood account identity is unavailable.", {
      code: "robinhood_account_identity_unavailable",
      expose: true,
    });
  }

  const cached = robinhoodAccountBalanceCache.get(accountId);
  if (cached && cached.expiresAt > now()) {
    return cached.value;
  }
  const inflight = robinhoodAccountBalanceInflight.get(accountId);
  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    const portfolio = await fetchPortfolio({ appUserId, accountNumber });
    const cachedAt = now();
    const value = {
      ...robinhoodBalanceValuesFromPortfolio(
        portfolio,
        record.snapshot.currency,
      ),
      updatedAt: new Date(cachedAt),
    };
    robinhoodAccountBalanceCache.set(accountId, {
      value,
      expiresAt: cachedAt + ROBINHOOD_BALANCE_CACHE_TTL_MS,
    });
    return value;
  })().finally(() => {
    robinhoodAccountBalanceInflight.delete(accountId);
  });
  robinhoodAccountBalanceInflight.set(accountId, request);
  return request;
}

export async function applyRobinhoodAccountBalances(
  records: RobinhoodAccountRecord[],
  deps: {
    fetchPortfolio?: RobinhoodAccountPortfolioFetcher;
    now?: () => number;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    encryptionKey?: string;
    mcpUrl?: string;
  } = {},
): Promise<BrokerAccountSnapshot[]> {
  if (records.length === 0) {
    return [];
  }
  const now = deps.now ?? Date.now;
  const fetchPortfolio =
    deps.fetchPortfolio ??
    createRobinhoodAccountPortfolioFetcher({
      env: deps.env,
      fetchImpl: deps.fetchImpl,
      encryptionKey: deps.encryptionKey,
      mcpUrl: deps.mcpUrl,
      now,
    });

  const results = new Array<BrokerAccountSnapshot>(records.length);
  let nextIndex = 0;
  const workerCount = Math.min(
    records.length,
    ROBINHOOD_BALANCE_FETCH_CONCURRENCY,
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= records.length) {
          return;
        }
        const record = records[index];
        const balances = await resolveRobinhoodAccountBalance(
          record,
          fetchPortfolio,
          now,
        );
        results[index] = {
          ...record.snapshot,
          ...balances,
        };
      }
    }),
  );
  return results;
}

export async function listAccounts(
  input: { mode?: RuntimeMode },
  options: ListAccountsOptions = {},
) {
  const mode = input.mode ?? getRuntimeMode();
  const appUserId =
    options.appUserId === undefined ? getCurrentAppUserId() : options.appUserId;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    options.allowDirectIbkr,
  );
  const hasDependencyOverrides = Boolean(
    options.listLiveAccounts ||
      options.hydrateDayPnl ||
      options.recordSnapshots ||
      options.getSnapTradeAccounts ||
      options.getRobinhoodAccounts,
  );
  if (!hasDependencyOverrides) {
    return readAccountRouteResponseCache(
      "accounts",
      { allowDirectIbkr, appUserId, mode },
      () =>
        listAccountsUncached(
          { mode },
          { ...options, allowDirectIbkr, appUserId },
        ),
      ACCOUNT_LIST_RESPONSE_CACHE_TTL_MS,
    );
  }
  return listAccountsUncached(
    { mode },
    { ...options, allowDirectIbkr, appUserId },
  );
}

async function listAccountsUncached(
  input: { mode: RuntimeMode },
  options: ListAccountsOptions,
) {
  const mode = input.mode;
  const appUserId = options.appUserId ?? null;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    options.allowDirectIbkr,
  );
  const listLiveAccounts = options.listLiveAccounts ?? listIbkrAccounts;
  const hydrateDayPnl =
    options.hydrateDayPnl ??
    ((accounts: BrokerAccountSnapshot[]) =>
      withAccountListDayPnl(accounts, appUserId));
  const recordSnapshots =
    options.recordSnapshots ??
    ((accounts: BrokerAccountSnapshot[]) =>
      recordAccountSnapshots(accounts, { appUserId }));
  const getSnapTradeAccounts =
    options.getSnapTradeAccounts ?? getSnapTradeBackedAccounts;
  const getRobinhoodAccounts =
    options.getRobinhoodAccounts ?? getRobinhoodBackedAccounts;

  const snapTradeAccountsPromise = getSnapTradeAccounts(mode, appUserId).catch(
    (error) => {
      if (isAccountDbReadUnavailableError(error)) {
        throw createAccountDbUnavailableError(error);
      }
      logger.warn(
        { err: error },
        "SnapTrade account merge failed; returning brokers without SnapTrade accounts",
      );
      return [] as BrokerAccountSnapshot[];
    },
  );
  const robinhoodAccountsPromise = getRobinhoodAccounts(mode, appUserId).catch(
    (error) => {
      if (isAccountDbReadUnavailableError(error)) {
        throw createAccountDbUnavailableError(error);
      }
      logger.warn(
        { err: error },
        "Robinhood account merge failed; returning brokers without Robinhood accounts",
      );
      return [] as BrokerAccountSnapshot[];
    },
  );
  const additionalBrokerAccountsPromise = Promise.all([
    snapTradeAccountsPromise,
    robinhoodAccountsPromise,
  ]).then(([snapTradeAccounts, robinhoodAccounts]) => [
    ...snapTradeAccounts,
    ...robinhoodAccounts,
  ]);

  let liveAccounts: BrokerAccountSnapshot[] = [];
  let liveReadError: unknown = null;
  if (allowDirectIbkr) {
    try {
      liveAccounts = await listLiveAccounts(mode);
    } catch (error) {
      liveReadError = error;
    }
  }
  if (liveAccounts.length) {
    void recordSnapshots(liveAccounts).catch((error) => {
      logger.warn(
        { err: error },
        "Account snapshot persistence failed after live account list",
      );
    });
  }

  const accounts = withTradingInclusionDefault(
    mergeAccountsWithDirectIbkrSupersedence(
      liveAccounts,
      await additionalBrokerAccountsPromise,
    ),
  );
  if (!accounts.length && liveReadError) {
    throw liveReadError;
  }
  return {
    accounts: await hydrateDayPnl(accounts),
  };
}

export async function getAccountSummary(input: {
  accountId: string;
  appUserId?: string | null;
  allowDirectIbkr?: boolean;
  mode?: RuntimeMode;
  source?: string | null;
}) {
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountSummary({ source: input.source });
  }

  const mode = input.mode ?? getRuntimeMode();
  const appUserId =
    input.appUserId === undefined ? getCurrentAppUserId() : input.appUserId;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    input.allowDirectIbkr,
  );
  return readAccountRouteResponseCache(
    "summary",
    {
      accountId: input.accountId,
      allowDirectIbkr,
      appUserId,
      mode,
      source: input.source ?? null,
    },
    () =>
      getAccountSummaryUncached({
        ...input,
        allowDirectIbkr,
        appUserId,
        mode,
      }),
    ACCOUNT_PAGE_SHARED_LIVE_READ_CACHE_TTL_MS,
  );
}

async function getAccountSummaryUncached(input: {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  mode: RuntimeMode;
  source?: string | null;
}) {
  const mode = input.mode;
  const universe = await getLiveAccountUniverse(
    input.accountId,
    mode,
    input.appUserId,
    input.allowDirectIbkr,
  );
  const updatedAt = accountMetricUpdatedAt(universe.accounts) ?? new Date();
  const currency = universe.primaryCurrency;
  const nav = sumAccounts(universe.accounts, "netLiquidation");
  const marginSnapshot = buildAccountMarginSnapshot(universe.accounts);

  const returnMetrics = await resolveAccountSummaryReturnMetrics({
    accountId: input.accountId,
    appUserId: input.appUserId,
    allowDirectIbkr: input.allowDirectIbkr,
    mode,
    source: input.source,
  });
  const dayPnlPercentDenominator =
    returnMetrics.dayPnlCapitalBase && returnMetrics.dayPnlCapitalBase !== 0
      ? Math.abs(returnMetrics.dayPnlCapitalBase)
      : returnMetrics.dayPnlPercentDenominator &&
          returnMetrics.dayPnlPercentDenominator !== 0
        ? Math.abs(returnMetrics.dayPnlPercentDenominator)
      : nav !== null && nav !== 0
        ? Math.abs(nav)
        : null;

  const accountTypes = Array.from(
    new Set(
      universe.accounts
        .map((account) => account.accountType || inferAccountType(account.id))
        .filter(Boolean),
    ),
  );
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
      dayPnl: metric(
        returnMetrics.dayPnl,
        currency,
        returnMetrics.dayPnlSource,
        returnMetrics.dayPnlField,
        updatedAt,
      ),
      dayPnlPercent: metric(
        dayPnlPercentDenominator && returnMetrics.dayPnl !== null
          ? (returnMetrics.dayPnl / dayPnlPercentDenominator) * 100
          : null,
        null,
        returnMetrics.dayPnlSource,
        "EquityHistoryMarketDayPnl/MarketDayCapitalBase",
        updatedAt,
      ),
      totalPnl: metric(
        returnMetrics.totalPnl,
        currency,
        "FLEX",
        "TransferAdjustedPnl",
        updatedAt,
      ),
      totalPnlPercent: metric(
        returnMetrics.totalPnlPercent,
        null,
        "FLEX",
        "TransferAdjustedPnl/CapitalBase",
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
        sumAccounts(universe.accounts, "grossPositionValue"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "GrossPositionValue",
        updatedAt,
      ),
    },
  };
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
  appUserId?: string | null;
  allowDirectIbkr?: boolean;
  range?: AccountRange;
  benchmark?: string | null;
  mode?: RuntimeMode;
  source?: string | null;
}) {
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountEquityHistory({
      range: input.range,
      benchmark: input.benchmark,
      source: input.source,
    });
  }

  const mode = input.mode ?? getRuntimeMode();
  const appUserId =
    input.appUserId === undefined ? getCurrentAppUserId() : input.appUserId;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    input.allowDirectIbkr,
  );
  const range = normalizeAccountRange(input.range);
  return readAccountRouteResponseCache(
    "equity-history",
    {
      accountId: input.accountId,
      allowDirectIbkr,
      appUserId,
      benchmark: input.benchmark || null,
      mode,
      range,
      source: input.source ?? null,
    },
    () =>
      getAccountEquityHistoryUncached({
        ...input,
        allowDirectIbkr,
        appUserId,
        mode,
        range,
      }),
    input.benchmark
      ? ACCOUNT_ROUTE_DERIVED_RESPONSE_CACHE_TTL_MS
      : ACCOUNT_ROUTE_EQUITY_HISTORY_RESPONSE_CACHE_TTL_MS,
  );
}

async function readProviderEquitySeedPointsForUniverse(
  universe: AccountUniverse,
): Promise<{
  points: Array<{
    providerAccountId: string;
    point: AccountEquityHistorySeedPoint;
  }>;
}> {
  const snapTradeAccounts = universe.accounts.filter(
    (account) => account.provider === "snaptrade",
  );
  if (!snapTradeAccounts.length) {
    return { points: [] };
  }

  const results = await Promise.all(
    snapTradeAccounts.map(async (account) => ({
      account,
      result: await readSnapTradeAccountEquitySeedPoints({
        accountId: account.id,
      }),
    })),
  );

  const points: Array<{
    providerAccountId: string;
    point: AccountEquityHistorySeedPoint;
  }> = [];

  results.forEach(({ account, result }) => {
    if (
      result.selectedSnapshotSource !==
      "SNAPTRADE_ACTIVITY_LEDGER_RECONSTRUCTION"
    ) {
      return;
    }
    points.push(
      ...result.points.map((point) => ({
        providerAccountId: account.id,
        point,
      })),
    );
  });

  return { points };
}

async function getAccountEquityHistoryUncached(input: {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  range: AccountRange;
  benchmark?: string | null;
  mode: RuntimeMode;
  source?: string | null;
}) {
  const mode = input.mode;
  const range = input.range;
  const universe = await getLiveAccountUniverse(
    input.accountId,
    mode,
    input.appUserId,
    input.allowDirectIbkr,
  );
  const accountIdsByAlias = new Map<string, Set<string>>();
  const addAccountAlias = (alias: string, accountId: string) => {
    const normalized = alias.trim();
    if (!normalized) {
      return;
    }
    const accountIds = accountIdsByAlias.get(normalized) ?? new Set<string>();
    accountIds.add(accountId);
    accountIdsByAlias.set(normalized, accountIds);
  };
  universe.accounts.forEach((account) => {
    addAccountAlias(account.id, account.id);
    addAccountAlias(account.providerAccountId, account.id);
    if (account.provider === "snaptrade") {
      addAccountAlias(
        account.providerAccountId.startsWith(SNAPTRADE_LOCAL_ID_PREFIX)
          ? account.providerAccountId.slice(SNAPTRADE_LOCAL_ID_PREFIX.length)
          : `${SNAPTRADE_LOCAL_ID_PREFIX}${account.providerAccountId}`,
        account.id,
      );
    } else if (account.provider === "robinhood") {
      addAccountAlias(
        account.providerAccountId.startsWith(ROBINHOOD_LOCAL_ID_PREFIX)
          ? account.providerAccountId.slice(ROBINHOOD_LOCAL_ID_PREFIX.length)
          : `${ROBINHOOD_LOCAL_ID_PREFIX}${account.providerAccountId}`,
        account.id,
      );
    }
  });
  const historyAccountId = (...aliases: string[]): string => {
    for (const alias of aliases) {
      const accountIds = accountIdsByAlias.get(alias);
      if (accountIds?.size === 1) {
        return accountIds.values().next().value!;
      }
    }
    return aliases[0] ?? "unknown";
  };
  const start = accountRangeStart(range);
  const flexConditions = [
    inArray(flexNavHistoryTable.providerAccountId, universe.accountIds),
    flexProviderAccountOwnershipCondition(
      flexNavHistoryTable.providerAccountId,
      universe.appUserId,
      mode,
    ),
  ];
  if (start) {
    flexConditions.push(
      gte(flexNavHistoryTable.statementDate, toIsoDateString(start)),
    );
  }

  const flexRows = await withOptionalAccountSchema({
    tables: ["flex_nav_history"],
    whenMissing: () => [],
    run: async () =>
      db
        .select()
        .from(flexNavHistoryTable)
        .where(and(...flexConditions))
        .orderBy(flexNavHistoryTable.statementDate),
  });
  const flexCashConditions = [
    inArray(flexCashActivityTable.providerAccountId, universe.accountIds),
    flexProviderAccountOwnershipCondition(
      flexCashActivityTable.providerAccountId,
      universe.appUserId,
      mode,
    ),
  ];
  if (start) {
    flexCashConditions.push(gte(flexCashActivityTable.activityDate, start));
  }
  const flexCashRows = await withOptionalAccountSchema({
    tables: ["flex_cash_activity"],
    whenMissing: () => [],
    run: async () =>
      db
        .select()
        .from(flexCashActivityTable)
        .where(and(...flexCashConditions))
        .orderBy(flexCashActivityTable.activityDate),
  });

  const snapshotConditions = [brokerAccountSnapshotCondition(universe)];
  if (start) {
    snapshotConditions.push(gte(balanceSnapshotsTable.asOf, start));
  }

  const rawSnapshotRows = await withAccountDbRead(async () =>
      db
        .select({
          localAccountId: brokerAccountsTable.id,
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
  );
  const providerEquitySeedPoints = await withAccountDbRead(() =>
    readProviderEquitySeedPointsForUniverse(universe),
  );
  const snapshotRows = compactEquitySnapshotRows(
    dedupeEquitySnapshotRows(
      filterPlaceholderZeroEquitySnapshotRows(
        rawSnapshotRows.map((row) => ({
          ...row,
          providerAccountId: historyAccountId(
            row.localAccountId,
            row.providerAccountId,
          ),
        })),
      ),
    ),
    range,
  );

  const accountDateKey = (accountId: string, date: string | Date) =>
    `${accountId}:${
      typeof date === "string" ? date : toIsoDateString(date)
    }`;
  const cashTransfersByAccountDate = new Map<
    string,
    { deposits: number; withdrawals: number }
  >();
  flexCashRows.forEach((row) => {
    const transfer = classifyExternalCashTransfer(row);
    if (transfer === null) {
      return;
    }
    const key = accountDateKey(
      historyAccountId(row.providerAccountId),
      row.activityDate,
    );
    const current = cashTransfersByAccountDate.get(key) ?? {
      deposits: 0,
      withdrawals: 0,
    };
    if (transfer > 0) {
      current.deposits += transfer;
    } else {
      current.withdrawals += Math.abs(transfer);
    }
    cashTransfersByAccountDate.set(key, current);
  });

  const flexAccountDates = new Set<string>();
  const flexTransferAccountDates = new Set<string>();
  const flexSeedPoints = flexRows.map((row) => {
    const providerAccountId = historyAccountId(row.providerAccountId);
    const key = accountDateKey(providerAccountId, row.statementDate);
    flexAccountDates.add(key);
    const cashTransfer = cashTransfersByAccountDate.get(key);
    const deposits = toNumber(row.deposits) ?? cashTransfer?.deposits ?? 0;
    const withdrawals =
      toNumber(row.withdrawals) ?? cashTransfer?.withdrawals ?? 0;
    if (Math.abs(deposits) > 0 || Math.abs(withdrawals) > 0) {
      flexTransferAccountDates.add(key);
    }
    return {
      providerAccountId,
      point: {
        timestamp: dateFromDateOnly(row.statementDate),
        netLiquidation: toNumber(row.netAssetValue) ?? 0,
        currency: row.currency,
        source: "FLEX" as const,
        deposits,
        withdrawals,
        dividends: toNumber(row.dividends) ?? 0,
        fees: toNumber(row.fees) ?? 0,
      },
    };
  });

  const accountSeedPoints = [
    ...flexSeedPoints,
    ...providerEquitySeedPoints.points,
    ...filterSnapshotsOnFlexTransferDates(
      snapshotRows,
      flexTransferAccountDates,
    ).map(
      (row) => ({
        providerAccountId: row.providerAccountId,
        point: {
          timestamp: row.asOf,
          netLiquidation: toNumber(row.netLiquidation) ?? 0,
          currency: row.currency,
          source: "LOCAL_LEDGER" as const,
          deposits: flexAccountDates.has(
            accountDateKey(row.providerAccountId, row.asOf),
          )
            ? 0
            : (cashTransfersByAccountDate.get(
                accountDateKey(row.providerAccountId, row.asOf),
              )?.deposits ?? 0),
          withdrawals: flexAccountDates.has(
            accountDateKey(row.providerAccountId, row.asOf),
          )
            ? 0
            : (cashTransfersByAccountDate.get(
                accountDateKey(row.providerAccountId, row.asOf),
              )?.withdrawals ?? 0),
          dividends: 0,
          fees: 0,
        },
      }),
    ),
  ];
  const byTimestamp = new Map<string, AccountEquityHistorySeedPoint>();
  aggregateCombinedEquitySeedPoints(accountSeedPoints, {
    expectedAccountIds: universe.accounts.map((account) => account.id),
  }).forEach((point) => {
    byTimestamp.set(point.timestamp.toISOString(), point);
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
  const currentSources = new Set<AccountEquityHistorySeedPoint["source"]>(
    liveEquityAccounts.map((account) =>
      account.provider === "ibkr"
        ? "IBKR_ACCOUNT_SUMMARY"
        : account.provider === "snaptrade"
          ? "SNAPTRADE_BALANCE_HISTORY"
          : "LOCAL_LEDGER",
    ),
  );
  const currentSource: AccountEquityHistorySeedPoint["source"] =
    currentSources.size === 1
      ? currentSources.values().next().value!
      : "MIXED";
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
      source: currentSource,
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
          : lastPoint?.source === "SNAPTRADE_BALANCE_HISTORY"
            ? "snaptrade_balance_history"
          : null;

  const lastRun = await withOptionalAccountSchema({
    tables: ["flex_report_runs"],
    whenMissing: () => null,
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
        source: point.source,
      })),
  };
}

export async function getAccountAllocation(input: {
  accountId: string;
  appUserId?: string | null;
  allowDirectIbkr?: boolean;
  mode?: RuntimeMode;
  source?: string | null;
}) {
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountAllocation({ source: input.source });
  }

  const mode = input.mode ?? getRuntimeMode();
  const appUserId =
    input.appUserId === undefined ? getCurrentAppUserId() : input.appUserId;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    input.allowDirectIbkr,
  );
  return getAccountAllocationUncached({
    ...input,
    allowDirectIbkr,
    appUserId,
    mode,
  });
}

function addKnownCashAllocation(
  buckets: Map<string, number>,
  cash: number | null,
): void {
  if (cash === null) return;
  buckets.set("Cash", (buckets.get("Cash") ?? 0) + cash);
}

async function getAccountAllocationUncached(input: {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  mode: RuntimeMode;
  source?: string | null;
}) {
  const mode = input.mode;
  const universe = await getLiveAccountUniverse(
    input.accountId,
    mode,
    input.appUserId,
    input.allowDirectIbkr,
  );
  const positions = await listPositionsForUniverse(universe, mode);
  const marketHydration = await hydratePositionMarkets(positions);
  const nav = sumAccounts(universe.accounts, "netLiquidation");

  const assetBuckets = new Map<string, number>();
  const sectorBuckets = new Map<string, number>();
  positions.forEach((position) => {
    const assetClass = normalizeAssetClassLabel(position);
    const sector = sectorForSymbol(positionReferenceSymbol(position));
    const allocationValue = hydratedPositionMarketValue(position, marketHydration);
    assetBuckets.set(assetClass, (assetBuckets.get(assetClass) ?? 0) + allocationValue);
    sectorBuckets.set(sector, (sectorBuckets.get(sector) ?? 0) + allocationValue);
  });

  addKnownCashAllocation(
    assetBuckets,
    sumAccounts(universe.accounts, "cash"),
  );

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

function rawString(source: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const direct = source[key];
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }

    const entry = Object.entries(source).find(
      ([candidate]) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (typeof entry?.[1] === "string" && entry[1].trim()) {
      return entry[1].trim();
    }
  }
  return null;
}

function normalizeMarketDataSymbol(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || /^twsopt:/i.test(text)) {
    return "";
  }
  return normalizeSymbol(text).toUpperCase();
}

function accountPositionMarketDataSymbol(input: {
  symbol?: unknown;
  optionContract?: { underlying?: unknown } | null;
  raw?: Record<string, unknown> | null;
}): string {
  return (
    normalizeMarketDataSymbol(input.optionContract?.underlying) ||
    normalizeMarketDataSymbol(
      rawString(input.raw, ["underlyingSymbol", "underlying", "underlyingTicker"]),
    ) ||
    normalizeMarketDataSymbol(input.symbol)
  );
}

export async function getAccountPositions(input: {
  accountId: string;
  appUserId?: string | null;
  allowDirectIbkr?: boolean;
  assetClass?: string | null;
  mode?: RuntimeMode;
  source?: string | null;
  liveQuotes?: boolean;
  detail?: AccountPositionsDetail;
}) {
  resolveAccountPositionTypeFilter(input.assetClass);
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountPositions({
      assetClass: input.assetClass,
      source: input.source,
      liveQuotes: input.liveQuotes,
      detail: input.detail,
    });
  }

  const mode = input.mode ?? getRuntimeMode();
  const appUserId =
    input.appUserId === undefined ? getCurrentAppUserId() : input.appUserId;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    input.allowDirectIbkr,
  );
  const detail = normalizeAccountPositionsDetail(input.detail);
  return getAccountPositionsUncached({
    ...input,
    allowDirectIbkr,
    appUserId,
    mode,
    detail,
  });
}

function resolveAccountPositionTypeFilter(input: string | null | undefined) {
  const filter = normalizeAccountPositionTypeFilter(input);
  if (filter.kind === "invalid") {
    throw new HttpError(400, "Unsupported account position type filter.", {
      code: "invalid_account_position_type",
      detail:
        "Use all, stock, etf, option, or the legacy equity alias for account position filters.",
      expose: true,
    });
  }
  return filter;
}

type AccountPositionsDetail = "fast" | "full";

type RealAccountPositionsInput = {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  assetClass?: string | null;
  mode: RuntimeMode;
  source?: string | null;
  liveQuotes?: boolean;
  detail: AccountPositionsDetail;
};

type AccountPositionsTimingState = {
  startedAt: number;
  universeCache: AccountPositionsCacheDisposition | null;
  positionsCache: AccountPositionsCacheDisposition | null;
  positionCount: number | null;
  stagesMs: Partial<Record<AccountPositionsStage, number>>;
};

function accountPositionsElapsedMs(startedAt: number): number {
  return Math.max(
    0,
    Math.round((performance.now() - startedAt) * 1_000) / 1_000,
  );
}

async function timeAccountPositionsStage<T>(
  timing: AccountPositionsTimingState | undefined,
  stage: AccountPositionsStage,
  work: () => Promise<T>,
): Promise<T> {
  if (!timing) {
    return work();
  }
  const startedAt = performance.now();
  try {
    return await work();
  } finally {
    timing.stagesMs[stage] = accountPositionsElapsedMs(startedAt);
  }
}

function timeAccountPositionsSyncStage<T>(
  timing: AccountPositionsTimingState | undefined,
  stage: AccountPositionsStage,
  work: () => T,
): T {
  if (!timing) {
    return work();
  }
  const startedAt = performance.now();
  try {
    return work();
  } finally {
    timing.stagesMs[stage] = accountPositionsElapsedMs(startedAt);
  }
}

function normalizeAccountPositionsDetail(
  input: AccountPositionsDetail | string | null | undefined,
): AccountPositionsDetail {
  return input === "fast" ? "fast" : "full";
}

type RealPositionAttributionSourceType =
  | "manual"
  | "automation"
  | "watchlist_backtest"
  | "signal_options_replay"
  | "mixed";

type RealPositionAttribution = {
  sourceType: RealPositionAttributionSourceType;
  strategyLabel: string | null;
  attributionStatus: "unknown" | "attributed" | "mixed";
  sourceAttribution: Array<{
    sourceType: RealPositionAttributionSourceType;
    deploymentId: string | null;
    deploymentName: string | null;
  }>;
};

const MANUAL_REAL_POSITION_ATTRIBUTION: RealPositionAttribution = {
  sourceType: "manual",
  strategyLabel: "Manual",
  attributionStatus: "unknown",
  sourceAttribution: [],
};

// Stable join key shared by real positions and the automation execution-event
// ledger. Options key on the structurally-derived providerContractId (identical
// on both sides and JSON-round-trip safe); everything else keys on symbol.
function realAttributionPositionKey(input: {
  symbol: string;
  optionContract?: { providerContractId?: string | null; ticker?: string | null } | null;
}): string {
  const optionContract = input.optionContract;
  if (optionContract) {
    const id = optionContract.providerContractId || optionContract.ticker;
    if (id) {
      return `option:${id}`;
    }
  }
  return `equity:${normalizeSymbol(input.symbol).toUpperCase()}`;
}

// Attribute real broker positions to their automation source by joining to the
// execution-events ledger (overnight-spot real orders record deploymentId +
// brokerOrder). Real fills carry no recoverable source tag from IBKR, so this
// local ledger join is the source of truth. Positions with no matching
// automation event stay "manual" (the prior hardcoded default).
async function buildRealPositionAttribution(input: {
  appUserId: string | null;
  providerAccountIds: string[];
  positions: BrokerPositionSnapshot[];
}): Promise<Map<string, RealPositionAttribution>> {
  const attribution = new Map<string, RealPositionAttribution>();
  const providerAccountIds = Array.from(
    new Set(input.providerAccountIds.filter(Boolean)),
  );
  const symbols = Array.from(
    new Set(
      input.positions
        .map((position) => normalizeSymbol(position.symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
  if (!input.appUserId || !providerAccountIds.length || !symbols.length) {
    return attribution;
  }

  const ownedProviderAccountIds = db
    .select({ providerAccountId: brokerAccountsTable.providerAccountId })
    .from(brokerAccountsTable)
    .where(inArray(brokerAccountsTable.providerAccountId, providerAccountIds))
    .groupBy(brokerAccountsTable.providerAccountId)
    .having(
      sql<boolean>`bool_and(${brokerAccountsTable.appUserId} is not distinct from ${input.appUserId})`,
    );

  let events: Array<{ deploymentId: string | null; brokerOrder: unknown }> = [];
  try {
    events = await db
      .select({
        deploymentId: executionEventsTable.deploymentId,
        // Only payload.brokerOrder is read (symbol + optionContract id/ticker),
        // so project just that jsonb sub-object instead of the whole payload —
        // byte-identical attribution, far less jsonb hauled on the interactive
        // positions path (LIMIT 1000). (WO-EE-FIREHOSE, Deliverable 4)
        brokerOrder: sql<unknown>`${executionEventsTable.payload} -> 'brokerOrder'`,
      })
      .from(executionEventsTable)
      .innerJoin(
        algoDeploymentsTable,
        eq(executionEventsTable.deploymentId, algoDeploymentsTable.id),
      )
      .where(
        and(
          isNotNull(executionEventsTable.deploymentId),
          inArray(executionEventsTable.symbol, symbols),
          inArray(executionEventsTable.providerAccountId, providerAccountIds),
          eq(
            executionEventsTable.providerAccountId,
            algoDeploymentsTable.providerAccountId,
          ),
          inArray(
            algoDeploymentsTable.providerAccountId,
            ownedProviderAccountIds,
          ),
        ),
      )
      .orderBy(desc(executionEventsTable.occurredAt))
      .limit(1000);
  } catch (error) {
    if (isAccountDbReadUnavailableError(error)) {
      throw createAccountDbUnavailableError(error);
    }
    throw error;
  }

  return foldRealPositionAttribution(events);
}

// Pure fold from the (deploymentId, brokerOrder) projection to the per-position
// attribution map. Extracted so the read-shape narrowing above is unit-testable
// without a DB. (WO-EE-FIREHOSE, Deliverable 4)
function foldRealPositionAttribution(
  events: Array<{ deploymentId: string | null; brokerOrder: unknown }>,
): Map<string, RealPositionAttribution> {
  const attribution = new Map<string, RealPositionAttribution>();
  const deploymentsByKey = new Map<string, Set<string>>();
  for (const event of events) {
    const deploymentId = event.deploymentId;
    if (!deploymentId) {
      continue;
    }
    const brokerOrder = event.brokerOrder as
      | { symbol?: string | null; optionContract?: RealPositionAttribution["sourceAttribution"][number] | unknown }
      | null
      | undefined;
    if (!brokerOrder || typeof brokerOrder.symbol !== "string") {
      continue;
    }
    const key = realAttributionPositionKey({
      symbol: brokerOrder.symbol,
      optionContract: (brokerOrder.optionContract ?? null) as {
        providerContractId?: string | null;
        ticker?: string | null;
      } | null,
    });
    const set = deploymentsByKey.get(key) ?? new Set<string>();
    set.add(deploymentId);
    deploymentsByKey.set(key, set);
  }

  for (const [key, deploymentIds] of deploymentsByKey) {
    const isMixed = deploymentIds.size > 1;
    attribution.set(key, {
      sourceType: isMixed ? "mixed" : "automation",
      strategyLabel: isMixed ? "Mixed" : "Automation",
      attributionStatus: isMixed ? "mixed" : "attributed",
      sourceAttribution: Array.from(deploymentIds).map((deploymentId) => ({
        sourceType: "automation",
        deploymentId,
        deploymentName: null,
      })),
    });
  }

  return attribution;
}

async function getAccountPositionsUncached(input: RealAccountPositionsInput) {
  const timing: AccountPositionsTimingState = {
    startedAt: performance.now(),
    universeCache: null,
    positionsCache: null,
    positionCount: null,
    stagesMs: {},
  };
  try {
    const result = await buildAccountPositionsUncached(input, timing);
    recordAccountPositionsTiming({
      detail: input.detail,
      liveQuotes: input.liveQuotes !== false,
      outcome: "success",
      universeCache: timing.universeCache,
      positionsCache: timing.positionsCache,
      positionCount: timing.positionCount,
      rowCount: result.positions.length,
      stagesMs: timing.stagesMs,
      totalDurationMs: accountPositionsElapsedMs(timing.startedAt),
    });
    return result;
  } catch (error) {
    recordAccountPositionsTiming({
      detail: input.detail,
      liveQuotes: input.liveQuotes !== false,
      outcome: "failure",
      universeCache: timing.universeCache,
      positionsCache: timing.positionsCache,
      positionCount: timing.positionCount,
      rowCount: null,
      stagesMs: timing.stagesMs,
      totalDurationMs: accountPositionsElapsedMs(timing.startedAt),
    });
    throw error;
  }
}

async function buildAccountPositionsUncached(
  input: RealAccountPositionsInput,
  timing: AccountPositionsTimingState,
) {
  const mode = input.mode;
  const universe = await timeAccountPositionsStage(
    timing,
    "universe",
    async () => {
      const liveUniverse = await getLiveAccountUniverse(
        input.accountId,
        mode,
        input.appUserId,
        input.allowDirectIbkr,
        timing,
        true,
      );
      return timeAccountPositionsSyncStage(
        timing,
        "universe_balance_overlay",
        () => applyLatestSnapTradeBalancesToUniverse(liveUniverse),
      );
    },
  );
  const universeIdentities = accountUniverseIdentities(universe);
  const financialTotalsAvailable =
    accountUniverseFinancialTotalsAvailable(universe);
  const assetClassFilter = resolveAccountPositionTypeFilter(input.assetClass);
  const allPositions = await timeAccountPositionsStage(
    timing,
    "positions_upstream",
    () => listPositionsForUniverse(universe, mode, timing),
  );
  const positions = allPositions.filter((position) =>
    accountPositionTypeMatchesFilter(
      classifyAccountPositionType(position),
      assetClassFilter,
    ),
  );
  timing.positionCount = positions.length;
  let ordersResult: Awaited<ReturnType<typeof listOrdersForUniverse>> = { orders: [] };
  let lots: Awaited<ReturnType<typeof getPositionLots>> = [];
  let greekEnrichment: OptionGreekEnrichmentResult = {
    byPositionId: new Map(),
    totalOptionPositions: 0,
    matchedOptionPositions: 0,
    warnings: [],
  };
  let equityQuoteSnapshots = new Map<string, QuoteSnapshot>();
  let optionQuoteSnapshots = new Map<string, AccountPositionOptionQuoteDemandState>();
  let openDates = new Map<string, PositionOpenDate>();
  let realAttribution = new Map<string, RealPositionAttribution>();
  if (input.detail === "fast") {
    const openDateScheduleStartedAt = performance.now();
    openDates = readLastKnownExecutionOpenDatesForPositions(
      universe,
      mode,
      positions,
    );
    void fetchExecutionOpenDatesForPositions(universe, mode, positions).catch(
      (error) => {
        logger.warn(
          {
            err: error,
            accountId: universe.requestedAccountId,
            mode,
          },
          "Account position execution open-date refresh failed",
        );
      },
    );
    timing.stagesMs.fast_open_date_schedule = accountPositionsElapsedMs(
      openDateScheduleStartedAt,
    );
    const quoteFanoutStartedAt = performance.now();
    [equityQuoteSnapshots, optionQuoteSnapshots] = await Promise.all([
      timeAccountPositionsStage(timing, "equity_quotes", async () =>
        input.liveQuotes === false
          ? new Map<string, QuoteSnapshot>()
          : fetchEquityQuoteSnapshotsForPositions(positions),
      ),
      timeAccountPositionsStage(timing, "option_quotes", async () =>
        input.liveQuotes === false
          ? new Map<string, AccountPositionOptionQuoteDemandState>()
          : fetchOptionQuoteSnapshotsForPositions(positions),
      ),
    ]);
    timing.stagesMs.fast_quote_fanout = accountPositionsElapsedMs(
      quoteFanoutStartedAt,
    );
    inferSameDayExpiringOptionOpenDatesForPositions(positions).forEach(
      (openDate, positionId) => {
        if (!openDates.has(positionId)) {
          openDates.set(positionId, openDate);
        }
      },
    );
  }
  let marketHydration = await timeAccountPositionsStage(
    timing,
    "market_hydration_initial",
    () =>
      hydratePositionMarkets(
        positions,
        equityQuoteSnapshots,
        optionQuoteSnapshots,
        openDates,
      ),
  );

  if (input.detail !== "fast") {
    const fullFanoutStartedAt = performance.now();
    const [
      fullOrdersResult,
      fullLots,
      fullGreekEnrichment,
      fullEquityQuoteSnapshots,
      fullOptionQuoteSnapshots,
      flexOpenDates,
      executionOpenDates,
    ] = await Promise.all([
      timeAccountPositionsStage(timing, "full_orders", () =>
        listOrdersForUniverse(universe, mode),
      ),
      timeAccountPositionsStage(timing, "full_lots", () =>
        getPositionLots(universe.accountIds, universe.appUserId ?? null),
      ),
      timeAccountPositionsStage(timing, "full_greeks", () =>
        enrichPositionGreeks(positions, { refreshChains: false }),
      ),
      timeAccountPositionsStage(timing, "equity_quotes", async () =>
        input.liveQuotes === false
          ? new Map<string, QuoteSnapshot>()
          : fetchEquityQuoteSnapshotsForPositions(positions),
      ),
      timeAccountPositionsStage(timing, "option_quotes", async () =>
        input.liveQuotes === false
          ? new Map<string, AccountPositionOptionQuoteDemandState>()
          : fetchOptionQuoteSnapshotsForPositions(positions),
      ),
      timeAccountPositionsStage(timing, "full_flex_open_dates", () =>
        fetchFlexOpenDatesForPositions(universe, mode, positions),
      ),
      timeAccountPositionsStage(timing, "full_execution_open_dates", () =>
        fetchExecutionOpenDatesForPositions(universe, mode, positions),
      ),
    ]);
    timing.stagesMs.full_fanout = accountPositionsElapsedMs(fullFanoutStartedAt);
    ordersResult = fullOrdersResult;
    lots = fullLots;
    greekEnrichment = fullGreekEnrichment;
    equityQuoteSnapshots = fullEquityQuoteSnapshots;
    optionQuoteSnapshots = fullOptionQuoteSnapshots;
    openDates = new Map(flexOpenDates);
    executionOpenDates.forEach((executionOpenDate, positionId) => {
      const current = openDates.get(positionId);
      if (!current || current.openedAtSource === "flex_snapshot") {
        openDates.set(positionId, executionOpenDate);
      }
    });
    inferSameDayExpiringOptionOpenDatesForPositions(positions).forEach(
      (openDate, positionId) => {
        if (!openDates.has(positionId)) {
          openDates.set(positionId, openDate);
        }
      },
    );
    realAttribution = await timeAccountPositionsStage(
      timing,
      "real_attribution",
      () =>
        buildRealPositionAttribution({
          appUserId: input.appUserId,
          providerAccountIds: universeIdentities.map(
            (account) => account.providerAccountId,
          ),
          positions,
        }),
    );
    marketHydration = await timeAccountPositionsStage(
      timing,
      "market_hydration_full",
      () =>
        hydratePositionMarkets(
          positions,
          equityQuoteSnapshots,
          optionQuoteSnapshots,
          openDates,
        ),
    );
  }
  const responseShapeStartedAt = performance.now();
  const orders = ordersResult.orders;
  const nav = financialTotalsAvailable
    ? sumAccounts(universe.accounts, "netLiquidation")
    : null;
  const positionSourceByAccountId = new Map(
    universeIdentities.map((account) => [
      account.id,
      accountPositionSourceForProvider(account.provider),
    ]),
  );
  const positionSource = (position: BrokerPositionSnapshot) =>
    positionSourceByAccountId.get(position.accountId) ??
    accountPositionSourceForProvider(null);

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
    providerSecurityType: string | null;
    positionType: ReturnType<typeof classifyAccountPositionType>;
    optionContract: BrokerPositionSnapshot["optionContract"] | null;
    marketDataSymbol: string;
    sector: string;
    quantity: number;
    averageCostAccumulator: number;
    markAccumulator: number;
    markWeight: number;
    averageWeight: number;
    dayChangeContributions: Array<number | null>;
    dayChangeBasis: number;
    unrealizedPnl: number;
    unrealizedCostBasis: number;
    marketValue: number;
    betaWeightedDeltaContributions: Array<number | null>;
    lots: typeof lots;
    openOrders: BrokerOrderSnapshot[];
    positionQuotes: PositionQuoteSnapshot[];
    sources: Set<AccountPositionSource>;
    openedAt: Date | null;
    openedAtSource: BrokerPositionSnapshot["openedAtSource"] | null;
  };

  const rows =
    universe.isCombined && financialTotalsAvailable
      ? Array.from(
          positions.reduce((map, position) => {
            const key = positionGroupKey(position);
            const current = map.get(key) ?? {
              id: key,
              accountId: universe.requestedAccountId,
              accounts: [] as string[],
              symbol: position.symbol,
              description: position.optionContract
                ? `${position.optionContract.underlying} ${toIsoDateString(position.optionContract.expirationDate)} ${position.optionContract.strike} ${position.optionContract.right}`
                : position.symbol,
              assetClass: normalizeAssetClassLabel(position),
              providerSecurityType: position.providerSecurityType ?? null,
              positionType: classifyAccountPositionType(position),
              optionContract: position.optionContract ?? null,
              marketDataSymbol: accountPositionMarketDataSymbol(position),
              sector: sectorForSymbol(positionReferenceSymbol(position)),
              quantity: 0,
              averageCostAccumulator: 0,
              markAccumulator: 0,
              markWeight: 0,
              averageWeight: 0,
              dayChangeContributions: [] as Array<number | null>,
              dayChangeBasis: 0,
              unrealizedPnl: 0,
              unrealizedCostBasis: 0,
              marketValue: 0,
              betaWeightedDeltaContributions: [] as Array<number | null>,
              lots: [] as typeof lots,
              openOrders: [] as BrokerOrderSnapshot[],
              positionQuotes: [] as PositionQuoteSnapshot[],
              sources: new Set<AccountPositionSource>(),
              openedAt: null as Date | null,
              openedAtSource: null as
                | BrokerPositionSnapshot["openedAtSource"]
                | null,
            };
            const greek = greekEnrichment.byPositionId.get(position.id);
            const quantityWeight = Math.abs(position.quantity);
            const hydratedMarket = marketHydration.get(position.id);
            const openedAt = bestOpenedAtForPosition(
              position,
              openDates.get(position.id),
            );
            const positionValue =
              hydratedMarket?.marketValue ?? positionSignedNotional(position);
            const positionMark =
              hydratedMarket?.mark ??
              (Math.abs(positionMarketPrice(position) || 0) >
              POSITION_QUANTITY_EPSILON
                ? positionMarketPrice(position)
                : null);
            current.quantity += position.quantity;
            current.averageCostAccumulator +=
              positionAveragePrice(position) * quantityWeight;
            if (positionMark != null) {
              current.markAccumulator += positionMark * quantityWeight;
              current.markWeight += quantityWeight;
            }
            current.averageWeight += quantityWeight;
            // Same-day positions contribute change-since-entry (unrealized P&L); held
            // positions contribute the prior-close day change. Keeps the combined/"All"
            // view consistent with the per-account view (which applies the same mapping
            // below). Owner report 2026-07-08.
            const positionOpenedToday = accountPositionOpenedOnCurrentMarketDay(
              openedAt.openedAt,
            );
            const contributedDayChange = positionOpenedToday
              ? (hydratedMarket?.unrealizedPnl ??
                position.unrealizedPnl ??
                hydratedMarket?.dayChange ??
                null)
              : (hydratedMarket?.dayChange ?? null);
            current.dayChangeContributions.push(contributedDayChange);
            if (contributedDayChange != null) {
              current.dayChangeBasis +=
                positionPnlBasis(positionValue, contributedDayChange) ?? 0;
            }
            const positionUnrealizedPnl =
              hydratedMarket?.unrealizedPnl ?? position.unrealizedPnl;
            current.unrealizedPnl += positionUnrealizedPnl;
            current.unrealizedCostBasis +=
              positionPnlBasis(positionValue, positionUnrealizedPnl) ?? 0;
            current.marketValue += positionValue;
            current.betaWeightedDeltaContributions.push(
              greek?.betaWeightedDelta ?? null,
            );
            current.accounts = Array.from(
              new Set([...current.accounts, position.accountId]),
            );
            current.sources.add(positionSource(position));
            current.lots = [
              ...current.lots,
              ...(lotRowsBySymbol.get(position.symbol.toUpperCase()) ?? []),
            ];
            current.openOrders = [
              ...current.openOrders,
              ...(openOrdersBySymbol.get(position.symbol.toUpperCase()) ?? []),
            ].filter((order) => orderGroupKey(order) === key);
            if (position.quote) {
              current.positionQuotes.push(position.quote);
            }
            const nextOpen = earlierPositionOpen(
              {
                openedAt: current.openedAt,
                openedAtSource: current.openedAtSource,
              },
              openedAt,
            );
            current.openedAt = nextOpen.openedAt;
            current.openedAtSource = nextOpen.openedAtSource;
            map.set(key, current);
            return map;
          }, new Map<string, AggregatedPositionRow>()),
        ).map(([, row]) => {
          const dayChange = sumNullableValues(row.dayChangeContributions);
          return {
            id: row.id,
            accountId: row.accountId,
            accounts: row.accounts,
            symbol: row.symbol,
            description: row.description,
            assetClass: row.assetClass,
            providerSecurityType: row.providerSecurityType,
            positionType: row.positionType,
            optionContract: row.optionContract,
            marketDataSymbol: row.marketDataSymbol,
            sector: row.sector,
            quantity: row.quantity,
            averageCost:
              row.averageWeight > 0
                ? row.averageCostAccumulator / row.averageWeight
                : 0,
            mark:
              row.markWeight > 0 ? row.markAccumulator / row.markWeight : null,
            dayChange,
            dayChangePercent:
              dayChange !== null && row.dayChangeBasis > 0
                ? positionPnlPercent(dayChange, row.dayChangeBasis)
                : null,
            unrealizedPnl: row.unrealizedPnl,
            unrealizedPnlPercent:
              row.unrealizedCostBasis > 0
                ? positionPnlPercent(row.unrealizedPnl, row.unrealizedCostBasis)
                : 0,
            marketValue: row.marketValue,
            weightPercent: weightPercent(row.marketValue, nav),
            betaWeightedDelta: sumNullableValues(
              row.betaWeightedDeltaContributions,
            ),
            lots: Array.from(
              row.lots.reduce(
                (
                  map: Map<string, (typeof lots)[number]>,
                  lot: (typeof lots)[number],
                ) => {
                  map.set(
                    `${lot.accountId}:${lot.symbol}:${lot.asOf.toISOString()}:${lot.quantity}:${lot.averageCost}`,
                    lot,
                  );
                  return map;
                },
                new Map<string, (typeof lots)[number]>(),
              ),
            )
              .map(([, lot]) => lot)
              .sort(
                (left, right) => right.asOf.getTime() - left.asOf.getTime(),
              ),
            openOrders: Array.from(
              row.openOrders.reduce(
                (
                  map: Map<string, BrokerOrderSnapshot>,
                  order: BrokerOrderSnapshot,
                ) => {
                  map.set(order.id, order);
                  return map;
                },
                new Map<string, BrokerOrderSnapshot>(),
              ),
            )
              .map(([, order]) => order)
              .sort(
                (left, right) =>
                  right.updatedAt.getTime() - left.updatedAt.getTime(),
              ),
            source: combineAccountPositionSources(row.sources),
            ...(realAttribution.get(realAttributionPositionKey(row)) ??
              MANUAL_REAL_POSITION_ATTRIBUTION),
            openedAt: row.openedAt,
            openedAtSource: row.openedAtSource,
            optionQuote: row.optionContract
              ? accountOptionQuoteForPosition(row, optionQuoteSnapshots)
              : null,
            quote: selectCombinedPositionQuote(
              row.providerSecurityType,
              row.positionQuotes,
              attachAccountOptionQuoteMetadata(
                buildPositionQuoteFromSnapshot(
                  row.optionContract
                    ? optionQuoteSnapshotForPosition(row, optionQuoteSnapshots)
                    : equityQuoteSnapshots.get(
                        normalizeSymbol(row.marketDataSymbol || row.symbol),
                      ),
                  row.markWeight > 0
                    ? row.markAccumulator / row.markWeight
                    : null,
                  row.optionContract
                    ? "option_quote"
                    : (
                          equityQuoteSnapshots.get(
                            normalizeSymbol(row.marketDataSymbol || row.symbol),
                          ) as (QuoteSnapshot & { source?: string }) | undefined
                        )?.source === "massive"
                      ? "massive"
                      : "bridge_quote",
                ),
                row.optionContract
                  ? optionQuoteDemandStateForPosition(row, optionQuoteSnapshots)
                  : null,
              ),
            ),
          };
        })
      : positions.map((position) => {
          const hydratedMarket = marketHydration.get(position.id);
          const marketValue =
            hydratedMarket?.marketValue ?? positionSignedNotional(position);
          const mark =
            hydratedMarket?.mark ??
            (Math.abs(positionMarketPrice(position) || 0) >
            POSITION_QUANTITY_EPSILON
              ? positionMarketPrice(position)
              : null);
          const greek = greekEnrichment.byPositionId.get(position.id);
          const referenceSymbol = positionReferenceSymbol(position);
          const openedAt = bestOpenedAtForPosition(
            position,
            openDates.get(position.id),
          );
          return {
            id: position.id,
            accountId: position.accountId,
            accounts: [position.accountId],
            symbol: position.symbol,
            description: position.optionContract
              ? `${position.optionContract.underlying} ${toIsoDateString(position.optionContract.expirationDate)} ${position.optionContract.strike} ${position.optionContract.right}`
              : position.symbol,
            assetClass: normalizeAssetClassLabel(position),
            providerSecurityType: position.providerSecurityType ?? null,
            positionType: classifyAccountPositionType(position),
            optionContract: position.optionContract ?? null,
            marketDataSymbol: accountPositionMarketDataSymbol(position),
            sector: sectorForSymbol(referenceSymbol),
            quantity: position.quantity,
            averageCost: positionAveragePrice(position),
            mark,
            // Same-day positions show the change since OUR entry (unrealized P&L), not
            // the underlying's full prior-close day move (which includes movement before
            // we took the position). Held positions keep the prior-close day change.
            // Owner report 2026-07-08. Mirrors the algo positions same-day logic.
            dayChange: accountPositionOpenedOnCurrentMarketDay(
              openedAt.openedAt,
            )
              ? (hydratedMarket?.unrealizedPnl ??
                position.unrealizedPnl ??
                hydratedMarket?.dayChange ??
                null)
              : (hydratedMarket?.dayChange ?? null),
            dayChangePercent: accountPositionOpenedOnCurrentMarketDay(
              openedAt.openedAt,
            )
              ? (hydratedMarket?.unrealizedPnlPercent ??
                position.unrealizedPnlPercent ??
                hydratedMarket?.dayChangePercent ??
                null)
              : (hydratedMarket?.dayChangePercent ?? null),
            unrealizedPnl:
              hydratedMarket?.unrealizedPnl ?? position.unrealizedPnl,
            unrealizedPnlPercent:
              hydratedMarket?.unrealizedPnlPercent ??
              position.unrealizedPnlPercent,
            marketValue,
            weightPercent: weightPercent(marketValue, nav),
            betaWeightedDelta: greek?.betaWeightedDelta ?? null,
            lots: lotRowsBySymbol.get(position.symbol.toUpperCase()) ?? [],
            openOrders: (
              openOrdersBySymbol.get(position.symbol.toUpperCase()) ?? []
            ).filter(
              (order) => orderGroupKey(order) === positionGroupKey(position),
            ),
            source: positionSource(position),
            ...(realAttribution.get(realAttributionPositionKey(position)) ??
              MANUAL_REAL_POSITION_ATTRIBUTION),
            openedAt: openedAt.openedAt,
            openedAtSource: openedAt.openedAtSource,
            optionQuote: position.optionContract
              ? accountOptionQuoteForPosition(position, optionQuoteSnapshots)
              : null,
            quote: quoteForPosition(
              position,
              mark,
              equityQuoteSnapshots,
              optionQuoteSnapshots,
            ),
          };
        });

  const openRows = rows.filter((row) => Math.abs(Number(row.quantity)) > POSITION_QUANTITY_EPSILON);
  const exposure = exposureSummary(positions, (position) =>
    hydratedPositionMarketValue(position, marketHydration),
  );
  const marketDataDemandPositions = allPositions.filter(
    (position) => Math.abs(Number(position.quantity)) > POSITION_QUANTITY_EPSILON,
  );
  refreshAccountPositionEquityQuotes(marketDataDemandPositions);
  declareAccountPositionOptionQuoteDemands(
    marketDataDemandPositions,
    universe.requestedAccountId || input.accountId,
  );
  const result = {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    positions: openRows,
    totals: buildAccountPositionTotals({
      accounts: universe.accounts,
      financialTotalsAvailable,
      rows: openRows,
      grossLong: exposure.grossLong,
      grossShort: exposure.grossShort,
      netExposure: exposure.netExposure,
    }),
    updatedAt: latestTimestampOf(universeIdentities) ?? new Date(),
  };
  timing.stagesMs.response_shape = accountPositionsElapsedMs(
    responseShapeStartedAt,
  );
  return result;
}

const historicalPositionResponseAvailability = (input: {
  positionCount: number;
  hasBalanceSnapshot: boolean;
  activityCount: number;
}) => {
  const status =
    input.positionCount > 0 || input.hasBalanceSnapshot || input.activityCount > 0
      ? "historical"
      : "unavailable";
  const message =
    input.positionCount > 0
      ? null
      : input.hasBalanceSnapshot
        ? "No Flex open-position snapshot exists for this date; showing recorded balance snapshot."
        : input.activityCount > 0
          ? "No Flex open-position snapshot or recorded balance snapshot exists for this date; showing recorded account activity."
          : "No Flex open-position snapshot or recorded balance snapshot exists for this date.";
  return { status, message };
};

type HistoricalFlexOpenPositionRow = FlexOpenPositionRecord & {
  sourceRunCompletedAt: Date | null;
};

function selectLatestCompletedFlexPositionRows(
  rows: HistoricalFlexOpenPositionRow[],
): FlexOpenPositionRecord[] {
  const latestRunByAccount = new Map<
    string,
    { id: string; completedAt: Date }
  >();
  rows.forEach((row) => {
    if (!row.sourceRunId || !row.sourceRunCompletedAt) {
      return;
    }
    const current = latestRunByAccount.get(row.providerAccountId);
    if (
      !current ||
      row.sourceRunCompletedAt.getTime() > current.completedAt.getTime() ||
      (row.sourceRunCompletedAt.getTime() === current.completedAt.getTime() &&
        row.sourceRunId > current.id)
    ) {
      latestRunByAccount.set(row.providerAccountId, {
        id: row.sourceRunId,
        completedAt: row.sourceRunCompletedAt,
      });
    }
  });

  const latestAsOfByAccount = new Map<string, number>();
  rows.forEach((row) => {
    if (latestRunByAccount.get(row.providerAccountId)?.id !== row.sourceRunId) {
      return;
    }
    const asOf = row.asOf.getTime();
    const current = latestAsOfByAccount.get(row.providerAccountId);
    if (current === undefined || asOf > current) {
      latestAsOfByAccount.set(row.providerAccountId, asOf);
    }
  });

  return rows.filter(
    (row) =>
      latestRunByAccount.get(row.providerAccountId)?.id === row.sourceRunId &&
      latestAsOfByAccount.get(row.providerAccountId) === row.asOf.getTime(),
  );
}

export async function getAccountPositionsAtDate(input: {
  accountId: string;
  appUserId?: string | null;
  allowDirectIbkr?: boolean;
  date: string | Date;
  assetClass?: string | null;
  mode?: RuntimeMode;
  source?: string | null;
}) {
  const window = dateWindowUtc(input.date);
  const assetClassFilter = resolveAccountPositionTypeFilter(input.assetClass);
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountPositionsAtDate({
      date: window.date,
      assetClass: input.assetClass,
      source: input.source,
    });
  }

  const mode = input.mode ?? getRuntimeMode();
  const appUserId =
    input.appUserId === undefined ? getCurrentAppUserId() : input.appUserId;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    input.allowDirectIbkr,
  );
  const universe = await getLiveAccountUniverse(
    input.accountId,
    mode,
    appUserId,
    allowDirectIbkr,
  );
  const positionConditions = [
    inArray(flexOpenPositionsTable.providerAccountId, universe.accountIds),
    flexProviderAccountOwnershipCondition(
      flexOpenPositionsTable.providerAccountId,
      universe.appUserId,
      mode,
    ),
    gte(flexOpenPositionsTable.asOf, window.start),
    lt(flexOpenPositionsTable.asOf, window.end),
  ];

  const balanceConditions = [
    brokerAccountSnapshotCondition(universe),
    gte(balanceSnapshotsTable.asOf, window.start),
    lt(balanceSnapshotsTable.asOf, window.end),
  ];
  const previousBalanceConditions = [
    brokerAccountSnapshotCondition(universe),
    lt(balanceSnapshotsTable.asOf, window.start),
  ];

  const [
    candidatePositionRows,
    tradeRows,
    cashRows,
    dividendRows,
    balanceRows,
    previousBalanceRows,
  ] = await Promise.all([
    withOptionalAccountSchema({
      tables: ["flex_open_positions", "flex_report_runs"],
      whenMissing: () => [] as HistoricalFlexOpenPositionRow[],
      run: async () =>
        db
          .select({
            ...getTableColumns(flexOpenPositionsTable),
            sourceRunCompletedAt: flexReportRunsTable.completedAt,
          })
          .from(flexOpenPositionsTable)
          .innerJoin(
            flexReportRunsTable,
            eq(flexOpenPositionsTable.sourceRunId, flexReportRunsTable.id),
          )
          .where(
            and(
              ...positionConditions,
              eq(flexReportRunsTable.status, "completed"),
              isNotNull(flexReportRunsTable.completedAt),
            ),
          )
          .orderBy(flexOpenPositionsTable.asOf),
    }),
    withOptionalAccountSchema({
      tables: ["flex_trades"],
      whenMissing: () => [],
      run: async () =>
        db
          .select()
          .from(flexTradesTable)
          .where(
            and(
              inArray(flexTradesTable.providerAccountId, universe.accountIds),
              flexProviderAccountOwnershipCondition(
                flexTradesTable.providerAccountId,
                universe.appUserId,
                mode,
              ),
              gte(flexTradesTable.tradeDate, window.start),
              lt(flexTradesTable.tradeDate, window.end),
            ),
          )
          .orderBy(flexTradesTable.tradeDate),
    }),
    withOptionalAccountSchema({
      tables: ["flex_cash_activity"],
      whenMissing: () => [],
      run: async () =>
        db
          .select()
          .from(flexCashActivityTable)
          .where(
            and(
              inArray(flexCashActivityTable.providerAccountId, universe.accountIds),
              flexProviderAccountOwnershipCondition(
                flexCashActivityTable.providerAccountId,
                universe.appUserId,
                mode,
              ),
              gte(flexCashActivityTable.activityDate, window.start),
              lt(flexCashActivityTable.activityDate, window.end),
            ),
          )
          .orderBy(flexCashActivityTable.activityDate),
    }),
    withOptionalAccountSchema({
      tables: ["flex_dividends"],
      whenMissing: () => [],
      run: async () =>
        db
          .select()
          .from(flexDividendsTable)
          .where(
            and(
              inArray(flexDividendsTable.providerAccountId, universe.accountIds),
              flexProviderAccountOwnershipCondition(
                flexDividendsTable.providerAccountId,
                universe.appUserId,
                mode,
              ),
              gte(flexDividendsTable.paidDate, window.start),
              lt(flexDividendsTable.paidDate, window.end),
            ),
          )
          .orderBy(flexDividendsTable.paidDate),
    }),
    withAccountDbRead(async () =>
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
    ),
    withAccountDbRead(async () =>
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
    ),
  ]);

  const positionRows = selectLatestCompletedFlexPositionRows(
    candidatePositionRows,
  );

  const filteredPositionRows = positionRows.filter((row) =>
    accountPositionTypeMatchesFilter(
      classifyAccountPositionType({
        symbol: row.symbol,
        assetClass: row.assetClass,
        positionType: row.positionType,
        raw: row.raw,
      }),
      assetClassFilter,
    ),
  );
  if (
    !accountTradeCurrenciesMatch(
      [...filteredPositionRows, ...tradeRows, ...cashRows, ...dividendRows],
      universe.primaryCurrency,
    )
  ) {
    throw new HttpError(
      409,
      "Historical account data is unavailable across currencies without authoritative FX rates.",
      {
        code: "account_currency_conversion_required",
        expose: true,
      },
    );
  }
  filteredPositionRows.forEach((row) => {
    requiredAccountFinancialNumber(row.quantity, `position ${row.symbol} quantity`);
    requiredAccountFinancialNumber(row.costBasis, `position ${row.symbol} cost basis`);
    requiredAccountFinancialNumber(row.marketValue, `position ${row.symbol} market value`);
  });
  cashRows.forEach((row) =>
    requiredAccountFinancialNumber(row.amount, `cash activity ${row.activityId}`),
  );
  dividendRows.forEach((row) =>
    requiredAccountFinancialNumber(row.amount, `dividend ${row.dividendId}`),
  );
  const nav = filteredPositionRows.reduce(
    (sum, row) => sum + requiredAccountFinancialNumber(row.marketValue, "market value"),
    0,
  );
  const positions = filteredPositionRows.map((row) => {
    const quantity = requiredAccountFinancialNumber(
      row.quantity,
      `position ${row.symbol} quantity`,
    );
    const costBasis = requiredAccountFinancialNumber(
      row.costBasis,
      `position ${row.symbol} cost basis`,
    );
    const marketValue = requiredAccountFinancialNumber(
      row.marketValue,
      `position ${row.symbol} market value`,
    );
    const averageCost =
      Math.abs(quantity) > POSITION_QUANTITY_EPSILON
        ? Math.abs(costBasis) / Math.abs(quantity)
        : 0;
    const mark =
      Math.abs(quantity) > POSITION_QUANTITY_EPSILON
        ? Math.abs(marketValue) / Math.abs(quantity)
        : 0;
    const unrealizedPnl = marketValue - costBasis;
    const positionType = classifyAccountPositionType({
      symbol: row.symbol,
      assetClass: row.assetClass,
      positionType: row.positionType,
      raw: row.raw,
    });
    return {
      id: `FLEX:${row.id}`,
      accountId: row.providerAccountId,
      accounts: [row.providerAccountId],
      symbol: row.symbol,
      description: row.description || row.symbol,
      assetClass: normalizeTradeAssetClassLabel({
        assetClass: row.assetClass,
        symbol: row.symbol,
      }),
      positionType,
      optionContract: null,
      marketDataSymbol: accountPositionMarketDataSymbol(row),
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
    fees: flexCommissionCost(row),
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
      ? Math.abs(
          requiredAccountFinancialNumber(
            row.amount,
            `cash activity ${row.activityId}`,
          ),
        )
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
    {
      expectedAccountIds: universe.accountIds,
      currency: universe.primaryCurrency,
    },
  );
  const balanceBaseline =
    aggregateBalanceRows(previousLatestBalanceRows, {
      expectedAccountIds: universe.accountIds,
      currency: universe.primaryCurrency,
    }) ??
    aggregateBalanceRows(firstBalanceRows, {
      expectedAccountIds: universe.accountIds,
      currency: universe.primaryCurrency,
    });
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
  const availability = historicalPositionResponseAvailability({
    positionCount: positions.length,
    hasBalanceSnapshot: balanceSnapshot != null,
    activityCount: activity.length,
  });

  return {
    accountId: universe.requestedAccountId,
    date: window.date,
    currency: universe.primaryCurrency,
    status: availability.status,
    snapshotDate: effectiveSnapshotDate,
    message: availability.message,
    positions,
    activity,
    totals: {
      weightPercent: totalPositionWeightPercent(positions),
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
  input: { expectedAccountIds: string[]; currency: string },
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
  const expectedAccountIds = new Set(input.expectedAccountIds);
  const observedAccountIds = new Set(rows.map((row) => row.providerAccountId));
  if (
    expectedAccountIds.size !== observedAccountIds.size ||
    Array.from(expectedAccountIds).some((id) => !observedAccountIds.has(id))
  ) {
    return null;
  }
  const currency = input.currency.trim().toUpperCase();
  if (
    !currency ||
    rows.some(
      (row) => String(row.currency || "").trim().toUpperCase() !== currency,
    )
  ) {
    throw new HttpError(
      409,
      "Historical account balances are unavailable across currencies without authoritative FX rates.",
      {
        code: "account_currency_conversion_required",
        expose: true,
      },
    );
  }
  const cashValues = rows.map((row) => toNumber(row.cash));
  const buyingPowerValues = rows.map((row) => toNumber(row.buyingPower));
  const netLiquidationValues = rows.map((row) => toNumber(row.netLiquidation));
  if (
    cashValues.some((value) => value === null) ||
    buyingPowerValues.some((value) => value === null) ||
    netLiquidationValues.some((value) => value === null)
  ) {
    return null;
  }
  const maintenanceMarginValues = rows.map((row) =>
    toNumber(row.maintenanceMargin),
  );
  return {
    asOf: rows.reduce(
      (latest, row) =>
        row.asOf.getTime() > latest.getTime() ? row.asOf : latest,
      rows[0]!.asOf,
    ),
    currency,
    cash: cashValues.reduce<number>((sum, value) => sum + value!, 0),
    buyingPower: buyingPowerValues.reduce<number>(
      (sum, value) => sum + value!,
      0,
    ),
    netLiquidation: netLiquidationValues.reduce<number>(
      (sum, value) => sum + value!,
      0,
    ),
    maintenanceMargin: maintenanceMarginValues.some(
      (value) => value === null,
    )
      ? null
      : maintenanceMarginValues.reduce<number>(
          (sum, value) => sum + value!,
          0,
        ),
  };
}

async function getPositionLots(
  accountIds: string[],
  appUserId: string | null,
) {
  if (!accountIds.length) {
    return [];
  }

  return withAccountDbRead(async () => {
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
        .where(
          and(
            brokerAccountOwnershipCondition(appUserId),
            inArray(brokerAccountsTable.providerAccountId, accountIds),
          ),
        )
        .orderBy(desc(positionLotsTable.asOf));

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
  });
}

type NormalizedAccountTrade = {
  id: string;
  source:
    | "FLEX"
    | "LIVE_ORDER"
    | "LIVE_EXECUTION"
    | "SNAPTRADE_ACTIVITY"
    | "ROBINHOOD_ACTIVITY";
  accountId: string;
  symbol: string;
  side: "buy" | "sell" | "unknown";
  assetClass: string;
  positionType: ReturnType<typeof classifyAccountPositionType>;
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
  orderIds?: string[];
  sourceType?: string | null;
  strategyLabel?: string | null;
  orderStatus?: BrokerOrderSnapshot["status"] | null;
  orderType?: BrokerOrderSnapshot["type"] | null;
  optionContract?: BrokerOrderSnapshot["optionContract"] | null;
  optionRight?: string | null;
  dte?: number | null;
};

const normalizeAccountTradeSide = (
  value: unknown,
): NormalizedAccountTrade["side"] => {
  const side = String(value ?? "").trim().toLowerCase();
  return side === "buy" || side === "sell" ? side : "unknown";
};

type FlexTradeRecord = typeof flexTradesTable.$inferSelect;

type AccountClosedTradeFilters = {
  from?: Date | null;
  to?: Date | null;
  symbol?: string | null;
  assetClass?: string | null;
  pnlSign?: string | null;
  holdDuration?: string | null;
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
  return input.mode === "live" ? "live" : "shadow";
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

const isClosedFlexTradeRow = (row: {
  openClose?: string | null;
  realizedPnl?: unknown;
}) => {
  const openClose = String(row.openClose ?? "").trim().toLowerCase();
  if (openClose) {
    return openClose.startsWith("c") || openClose === "closed";
  }
  const realizedPnl = toNumber(row.realizedPnl);
  return realizedPnl != null && realizedPnl !== 0;
};

type InferredFlexLot = {
  row: FlexTradeRecord;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  openedAt: Date;
  commissionRemaining: number | null;
  multiplier: number | null;
};

const flexTradeDate = (row: FlexTradeRecord): Date =>
  row.tradeDate instanceof Date ? row.tradeDate : new Date(row.tradeDate);

function normalizeFlexTradeSide(
  value: unknown,
  quantityValue: unknown,
): "buy" | "sell" | null {
  const side = String(value ?? "").trim().toUpperCase();
  if (side === "B" || side === "BOT" || side.startsWith("BUY")) return "buy";
  if (side === "S" || side === "SLD" || side.startsWith("SELL")) return "sell";
  const quantity = toNumber(quantityValue);
  if (quantity == null || Math.abs(quantity) <= POSITION_QUANTITY_EPSILON) {
    return null;
  }
  return quantity < 0 ? "sell" : "buy";
}

const flexTradeSide = (row: FlexTradeRecord): "buy" | "sell" | null => {
  return normalizeFlexTradeSide(row.side, row.quantity);
};

const openingSideForClosingSide = (
  side: "buy" | "sell" | null,
): "buy" | "sell" | null =>
  side === "buy" ? "sell" : side === "sell" ? "buy" : null;

const closedTradeReturnPercent = (
  avgOpen: number,
  avgClose: number,
  openingSide: "buy" | "sell" | null,
): number | null => {
  if (avgOpen <= 0 || !openingSide) return null;
  const direction = openingSide === "buy" ? 1 : -1;
  return (((avgClose - avgOpen) / Math.abs(avgOpen)) * 100) * direction;
};

const flexTradePositionType = (
  row: FlexTradeRecord,
): ReturnType<typeof classifyAccountPositionType> =>
  classifyAccountPositionType({
    assetClass: row.assetClass,
    symbol: row.symbol,
    positionType: row.positionType,
    raw: row.raw,
  });

const flexTradeAssetClassLabel = (row: FlexTradeRecord): string =>
  normalizeTradeAssetClassLabel({
    assetClass: row.assetClass,
    symbol: row.symbol,
    positionType: row.positionType,
  });

const flexCommissionCost = (row: FlexTradeRecord): number | null => {
  const commission = toNumber(row.commission);
  const raw = isRecord(row.raw) ? row.raw : {};
  const commissionCurrency = String(
    rawString(raw, ["ibCommissionCurrency", "commissionCurrency"]) ?? "",
  )
    .trim()
    .toUpperCase();
  const tradeCurrency = String(row.currency || "").trim().toUpperCase();
  if (
    commissionCurrency &&
    (!tradeCurrency || commissionCurrency !== tradeCurrency)
  ) {
    return null;
  }
  return commission === null ? null : Math.abs(commission);
};

const flexTradeContractKey = (row: FlexTradeRecord): string =>
  [
    row.providerAccountId,
    String(row.currency || "").trim().toUpperCase() || "UNKNOWN_CURRENCY",
    flexTradeAssetClassLabel(row).toLowerCase(),
    normalizeSymbol(row.symbol || ""),
  ].join("|");

const flexTradeMultiplier = (row: FlexTradeRecord): number | null => {
  if (flexTradeAssetClassLabel(row).toLowerCase() !== "options") return 1;

  const raw = isRecord(row.raw) ? row.raw : {};
  const economicsKeys = ["multiplier", "sharesPerContract", "contractMultiplier"];
  const declaredKey = economicsKeys.find((key) =>
    Object.prototype.hasOwnProperty.call(raw, key),
  );
  if (declaredKey) {
    const declared = toNumber(raw[declaredKey]);
    return declared != null && declared > 0 ? declared : null;
  }

  return raw["standardDeliverableVerified"] === true ? 100 : null;
};

const flexTradeToNormalizedClosedTrade = (
  row: FlexTradeRecord,
): NormalizedAccountTrade => ({
  id: row.tradeId,
  source: "FLEX" as const,
  accountId: row.providerAccountId,
  symbol: row.symbol,
  side: openingSideForClosingSide(flexTradeSide(row)) ?? "unknown",
  assetClass: flexTradeAssetClassLabel(row),
  positionType: flexTradePositionType(row),
  quantity: toNumber(row.quantity) ?? 0,
  openDate: null,
  closeDate: row.tradeDate,
  avgOpen: null,
  avgClose: toNumber(row.price),
  realizedPnl: toNumber(row.realizedPnl),
  realizedPnlPercent: null,
  holdDurationMinutes: null,
  commissions: flexCommissionCost(row),
  currency: row.currency,
});

const buildInferredFlexClosedTrades = (
  rows: FlexTradeRecord[],
): NormalizedAccountTrade[] => {
  const lotsByKey = new Map<string, InferredFlexLot[]>();
  const trades: NormalizedAccountTrade[] = [];
  const sorted = [...rows].sort(
    (left, right) => flexTradeDate(left).getTime() - flexTradeDate(right).getTime(),
  );

  for (const row of sorted) {
    const side = flexTradeSide(row);
    const quantity = Math.abs(toNumber(row.quantity) ?? 0);
    const price = toNumber(row.price);
    const tradeDate = flexTradeDate(row);
    if (
      !side ||
      quantity <= POSITION_QUANTITY_EPSILON ||
      price == null ||
      Number.isNaN(tradeDate.getTime())
    ) {
      continue;
    }

    const key = flexTradeContractKey(row);
    const lots = lotsByKey.get(key) ?? [];
    lotsByKey.set(key, lots);
    const rowCommission = flexCommissionCost(row);

    if (!lots.length || lots[0]?.side === side) {
      lots.push({
        row,
        side,
        quantity,
        price,
        openedAt: tradeDate,
        commissionRemaining: rowCommission,
        multiplier: flexTradeMultiplier(row),
      });
      continue;
    }

    let remaining = quantity;
    let matchedQuantity = 0;
    let openValue = 0;
    let grossRealizedPnl: number | null = 0;
    let openingCommissions: number | null = 0;
    let earliestOpen: Date | null = null;
    let openingSide: InferredFlexLot["side"] | null = null;
    const multiplier = flexTradeMultiplier(row);

    while (remaining > POSITION_QUANTITY_EPSILON && lots.length) {
      const lot = lots[0]!;
      const lotQuantityBefore = lot.quantity;
      const closeQuantity = Math.min(remaining, lot.quantity);
      const lotCommissionShare =
        lot.commissionRemaining != null &&
        lotQuantityBefore > POSITION_QUANTITY_EPSILON
          ? lot.commissionRemaining * (closeQuantity / lotQuantityBefore)
          : null;
      matchedQuantity += closeQuantity;
      openValue += closeQuantity * lot.price;
      openingSide ??= lot.side;
      openingCommissions =
        openingCommissions != null && lotCommissionShare != null
          ? openingCommissions + lotCommissionShare
          : null;
      earliestOpen =
        !earliestOpen || lot.openedAt.getTime() < earliestOpen.getTime()
          ? lot.openedAt
          : earliestOpen;
      if (
        grossRealizedPnl != null &&
        multiplier != null &&
        lot.multiplier != null &&
        multiplier === lot.multiplier
      ) {
        grossRealizedPnl +=
          lot.side === "buy"
            ? (price - lot.price) * closeQuantity * multiplier
            : (lot.price - price) * closeQuantity * multiplier;
      } else {
        grossRealizedPnl = null;
      }
      lot.quantity -= closeQuantity;
      if (lot.commissionRemaining != null && lotCommissionShare != null) {
        lot.commissionRemaining -= lotCommissionShare;
      }
      remaining -= closeQuantity;
      if (lot.quantity <= POSITION_QUANTITY_EPSILON) {
        lots.shift();
      }
    }

    if (matchedQuantity > POSITION_QUANTITY_EPSILON) {
      const avgOpen = openValue / matchedQuantity;
      const closingCommission =
        rowCommission != null && quantity > POSITION_QUANTITY_EPSILON
          ? rowCommission * (matchedQuantity / quantity)
          : null;
      const commissions =
        openingCommissions != null && closingCommission != null
          ? openingCommissions + closingCommission
          : null;
      const realizedPnl =
        grossRealizedPnl != null && commissions != null
          ? grossRealizedPnl - commissions
          : null;
      const openNotional = multiplier == null ? null : openValue * multiplier;
      const capitalBase =
        openNotional != null && openingCommissions != null && openingSide
          ? openingSide === "buy"
            ? openNotional + openingCommissions
            : openNotional - openingCommissions
          : null;
      trades.push({
        id: `inferred:${row.tradeId}`,
        source: "FLEX" as const,
        accountId: row.providerAccountId,
        symbol: row.symbol,
        side: openingSide ?? side,
        assetClass: flexTradeAssetClassLabel(row),
        positionType: flexTradePositionType(row),
        quantity: matchedQuantity,
        openDate: earliestOpen,
        closeDate: tradeDate,
        avgOpen,
        avgClose: price,
        realizedPnl,
        realizedPnlPercent:
          realizedPnl != null && capitalBase != null && capitalBase > 0
            ? (realizedPnl / capitalBase) * 100
            : null,
        holdDurationMinutes: earliestOpen
          ? (tradeDate.getTime() - earliestOpen.getTime()) / 60_000
          : null,
        commissions,
        currency: row.currency,
      });
    }

    if (remaining > POSITION_QUANTITY_EPSILON) {
      lots.push({
        row,
        side,
        quantity: remaining,
        price,
        openedAt: tradeDate,
        commissionRemaining:
          rowCommission != null && quantity > POSITION_QUANTITY_EPSILON
            ? rowCommission * (remaining / quantity)
            : null,
        multiplier: flexTradeMultiplier(row),
      });
    }
  }

  return trades.sort((left, right) => {
    const leftTime = left.closeDate?.getTime() ?? 0;
    const rightTime = right.closeDate?.getTime() ?? 0;
    return rightTime - leftTime;
  });
};

const orderActivityDate = (order: BrokerOrderSnapshot): Date =>
  order.updatedAt instanceof Date ? order.updatedAt : new Date(order.updatedAt);

const orderActivityPrice = (order: BrokerOrderSnapshot): number | null =>
  toNumber(order.limitPrice) ?? toNumber(order.stopPrice);

const optionDteFromOrder = (
  order: BrokerOrderSnapshot,
  activityDate: Date,
): number | null => {
  const expiration = order.optionContract?.expirationDate;
  if (!expiration) return null;
  return accountOptionCalendarDte(expiration, activityDate);
};

const dateIsoDay = (date: Date | null | undefined): string => {
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const activityMatchPriceKey = (value: unknown): string => {
  const numeric = toNumber(value);
  return numeric == null ? "noprice" : String(Math.round(numeric * 10_000) / 10_000);
};

const activityMatchQuantityKey = (value: unknown): string => {
  const numeric = toNumber(value);
  return numeric == null ? "0" : String(Math.round(Math.abs(numeric) * 1_000_000) / 1_000_000);
};

const accountTradeActivityMatchKey = (
  trade: NormalizedAccountTrade,
  side: NormalizedAccountTrade["side"] = trade.side,
): string =>
  [
    trade.accountId,
    normalizeSymbol(trade.symbol || ""),
    trade.positionType,
    side,
    activityMatchQuantityKey(trade.quantity),
    activityMatchPriceKey(trade.avgClose),
    dateIsoDay(trade.closeDate),
  ].join("|");

const accountTradeMatchesClosedTradeFilters = (
  trade: NormalizedAccountTrade,
  input: AccountClosedTradeFilters,
): boolean => {
  const closeDate = trade.closeDate;
  if (!closeDate || Number.isNaN(closeDate.getTime())) return false;
  if (input.from && closeDate < input.from) return false;
  if (input.to && closeDate > input.to) return false;
  if (input.symbol && normalizeSymbol(trade.symbol) !== normalizeSymbol(input.symbol)) {
    return false;
  }
  if (
    input.assetClass &&
    !accountPositionTypeMatchesFilter(
      trade.positionType,
      resolveAccountPositionTypeFilter(input.assetClass),
    )
  ) {
    return false;
  }
  if (input.pnlSign === "winners" && (trade.realizedPnl ?? 0) <= 0) {
    return false;
  }
  if (input.pnlSign === "losers" && (trade.realizedPnl ?? 0) >= 0) {
    return false;
  }
  return matchesHoldDurationBucket(trade.holdDurationMinutes, input.holdDuration);
};

const LIVE_EXECUTION_LOOKBACK_MAX_DAYS = 7;

const executionLookbackDays = (input: AccountClosedTradeFilters): number => {
  if (!input.from) return LIVE_EXECUTION_LOOKBACK_MAX_DAYS;
  const ageMs = Date.now() - input.from.getTime();
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  return Math.max(
    1,
    Math.min(
      LIVE_EXECUTION_LOOKBACK_MAX_DAYS,
      Math.ceil(ageMs / 86_400_000) + 1,
    ),
  );
};

const executionMultiplier = (
  execution: BrokerExecutionSnapshot,
): number | null => {
  const optionContract = normalizeLiveExecutionOptionContract(
    execution.optionContract,
  );
  const explicit = toNumber(optionContract?.multiplier);
  if (explicit != null && explicit > 0) return explicit;
  const sharesPerContract = toNumber(optionContract?.sharesPerContract);
  if (sharesPerContract != null && sharesPerContract > 0) {
    return sharesPerContract;
  }
  if (execution.assetClass !== "option") return 1;
  const hasDeclaredEconomics = Boolean(
    execution.optionContract &&
      (execution.optionContract.multiplier != null ||
        execution.optionContract.sharesPerContract != null),
  );
  if (hasDeclaredEconomics) return null;
  return optionContract?.standardDeliverableVerified === true ? 100 : null;
};

const executionPositionType = (
  execution: BrokerExecutionSnapshot,
): ReturnType<typeof classifyAccountPositionType> =>
  classifyAccountPositionType({
    symbol: execution.symbol,
    assetClass: execution.assetClass,
    optionContract: executionOptionContract(execution),
  });

const executionAssetClassLabel = (execution: BrokerExecutionSnapshot): string =>
  normalizeTradeAssetClassLabel({
    assetClass: execution.assetClass,
    symbol: execution.symbol,
    positionType: executionPositionType(execution),
    optionContract: executionOptionContract(execution),
  });

const executionContractKey = (execution: BrokerExecutionSnapshot): string =>
  [
    execution.accountId,
    executionAssetClassLabel(execution).toLowerCase(),
    normalizeSymbol(
      executionOptionContract(execution)?.ticker ||
        execution.contractDescription ||
        execution.symbol,
    ),
    execution.providerContractId || "noconid",
  ].join("|");

type LiveExecutionLot = {
  executionId: string;
  side: BrokerExecutionSnapshot["side"];
  quantity: number;
  price: number;
  executedAt: Date;
  optionContract: BrokerOrderSnapshot["optionContract"] | null;
  multiplier: number | null;
};

const accountOrderIdForExecution = (executionId: string): string =>
  `execution:${executionId}`;

const normalizeLiveExecutionOptionContract = (
  optionContract: BrokerExecutionSnapshot["optionContract"] | null | undefined,
): BrokerOrderSnapshot["optionContract"] | null =>
  optionContract
    ? {
        ...optionContract,
        providerContractId: optionContract.providerContractId ?? null,
      }
    : null;

const executionOptionContract = (
  execution: BrokerExecutionSnapshot,
): BrokerOrderSnapshot["optionContract"] | null =>
  normalizeLiveExecutionOptionContract(execution.optionContract);

const optionDteFromContract = (
  optionContract: BrokerOrderSnapshot["optionContract"] | null | undefined,
  activityDate: Date,
): number | null => {
  if (!optionContract) return null;
  return optionDteFromOrder({ optionContract } as BrokerOrderSnapshot, activityDate);
};

const liveExecutionActivityTrade = (
  execution: BrokerExecutionSnapshot,
  currency: string,
  quantity = Math.abs(toNumber(execution.quantity) ?? 0),
  id = execution.id,
): NormalizedAccountTrade => {
  const activityDate = execution.executedAt;
  const optionContract = executionOptionContract(execution);
  const optionRight = optionContract?.right
    ? String(optionContract.right).toLowerCase()
    : null;
  return {
    id,
    source: "LIVE_EXECUTION",
    accountId: execution.accountId,
    symbol: normalizeSymbol(execution.symbol),
    side: "unknown",
    assetClass: executionAssetClassLabel(execution),
    positionType: executionPositionType(execution),
    quantity,
    openDate: null,
    closeDate: activityDate,
    avgOpen: null,
    avgClose: toNumber(execution.price),
    realizedPnl: null,
    realizedPnlPercent: null,
    holdDurationMinutes: null,
    commissions: null,
    currency,
    orderIds: [accountOrderIdForExecution(execution.id)],
    sourceType: "manual",
    strategyLabel: "Manual",
    optionContract,
    optionRight,
    dte: optionDteFromContract(optionContract, activityDate),
  };
};

const buildLiveExecutionActivityTrades = (
  executions: BrokerExecutionSnapshot[],
  currency: string,
): NormalizedAccountTrade[] => {
  const sorted = [...executions].sort(
    (left, right) => left.executedAt.getTime() - right.executedAt.getTime(),
  );
  const lotsByKey = new Map<string, LiveExecutionLot[]>();
  const representedQuantities = new Map<string, number>();
  const trades: NormalizedAccountTrade[] = [];
  const recordRepresentedQuantity = (executionId: string, quantity: number) => {
    representedQuantities.set(
      executionId,
      (representedQuantities.get(executionId) ?? 0) + quantity,
    );
  };

  for (const execution of sorted) {
    const quantity = Math.abs(toNumber(execution.quantity) ?? 0);
    const price = toNumber(execution.price);
    if (!quantity || price == null || Number.isNaN(execution.executedAt.getTime())) {
      continue;
    }

    const key = executionContractKey(execution);
    const lots = lotsByKey.get(key) ?? [];
    lotsByKey.set(key, lots);

    if (!lots.length || lots[0]?.side === execution.side) {
      lots.push({
        executionId: execution.id,
        side: execution.side,
        quantity,
        price,
        executedAt: execution.executedAt,
        optionContract: executionOptionContract(execution),
        multiplier: executionMultiplier(execution),
      });
      continue;
    }

    let remaining = quantity;
    let matchedQuantity = 0;
    let openValue = 0;
    const multiplier = executionMultiplier(execution);
    let realizedPnl: number | null = multiplier == null ? null : 0;
    let earliestOpen: Date | null = null;
    let representativeOpen: LiveExecutionLot | null = null;
    const orderIds = new Set<string>();
    while (remaining > POSITION_QUANTITY_EPSILON && lots.length) {
      const lot = lots[0]!;
      const closeQuantity = Math.min(remaining, lot.quantity);
      matchedQuantity += closeQuantity;
      openValue += closeQuantity * lot.price;
      earliestOpen =
        !earliestOpen || lot.executedAt.getTime() < earliestOpen.getTime()
          ? lot.executedAt
          : earliestOpen;
      representativeOpen ??= lot;
      recordRepresentedQuantity(lot.executionId, closeQuantity);
      recordRepresentedQuantity(execution.id, closeQuantity);
      orderIds.add(accountOrderIdForExecution(lot.executionId));
      if (realizedPnl !== null) {
        realizedPnl =
          lot.multiplier === multiplier
            ? realizedPnl +
              (lot.side === "buy"
                ? (price - lot.price) * closeQuantity * multiplier!
                : (lot.price - price) * closeQuantity * multiplier!)
            : null;
      }
      lot.quantity -= closeQuantity;
      remaining -= closeQuantity;
      if (lot.quantity <= POSITION_QUANTITY_EPSILON) {
        lots.shift();
      }
    }

    if (matchedQuantity > POSITION_QUANTITY_EPSILON) {
      orderIds.add(accountOrderIdForExecution(execution.id));
      const avgOpen = openValue / matchedQuantity;
      const optionContract =
        executionOptionContract(execution) ??
        representativeOpen?.optionContract ??
        null;
      const optionRight = optionContract?.right
        ? String(optionContract.right).toLowerCase()
        : null;
      const openingSide = representativeOpen?.side ?? execution.side;
      trades.push({
        id: execution.id,
        source: "LIVE_EXECUTION",
        accountId: execution.accountId,
        symbol: normalizeSymbol(execution.symbol),
        side: openingSide,
        assetClass: executionAssetClassLabel(execution),
        positionType: executionPositionType(execution),
        quantity: matchedQuantity,
        openDate: earliestOpen,
        closeDate: execution.executedAt,
        avgOpen,
        avgClose: price,
        realizedPnl,
        realizedPnlPercent: closedTradeReturnPercent(
          avgOpen,
          price,
          openingSide,
        ),
        holdDurationMinutes: earliestOpen
          ? (execution.executedAt.getTime() - earliestOpen.getTime()) / 60_000
          : null,
        commissions: null,
        currency,
        orderIds: Array.from(orderIds),
        sourceType: "manual",
        strategyLabel: "Manual",
        optionContract,
        optionRight,
        dte: optionDteFromContract(
          optionContract,
          earliestOpen ?? execution.executedAt,
        ),
      });
    }

    if (remaining > POSITION_QUANTITY_EPSILON) {
      lots.push({
        executionId: execution.id,
        side: execution.side,
        quantity: remaining,
        price,
        executedAt: execution.executedAt,
        optionContract: executionOptionContract(execution),
        multiplier: executionMultiplier(execution),
      });
    }
  }

  for (const execution of sorted) {
    const quantity = Math.abs(toNumber(execution.quantity) ?? 0);
    const residualQuantity =
      quantity - (representedQuantities.get(execution.id) ?? 0);
    if (residualQuantity <= POSITION_QUANTITY_EPSILON) continue;
    trades.push(
      liveExecutionActivityTrade(
        execution,
        currency,
        residualQuantity,
        residualQuantity < quantity
          ? `${execution.id}:residual`
          : execution.id,
      ),
    );
  }

  return trades.sort((left, right) => {
    const leftTime = left.closeDate?.getTime() ?? 0;
    const rightTime = right.closeDate?.getTime() ?? 0;
    return rightTime - leftTime;
  });
};

const mergeLiveExecutionActivityTrades = (
  trades: NormalizedAccountTrade[],
  executions: BrokerExecutionSnapshot[],
  input: AccountClosedTradeFilters = {},
  currency = "USD",
): NormalizedAccountTrade[] => {
  const representedActivityKeys = new Set(
    trades.map((trade) => accountTradeActivityMatchKey(trade)),
  );
  const executionsById = new Map(
    executions.map((execution) => [execution.id, execution] as const),
  );
  const seenExecutionIds = new Set<string>();
  const executionTrades = buildLiveExecutionActivityTrades(executions, currency)
    .filter((trade) => accountTradeMatchesClosedTradeFilters(trade, input))
    .filter((trade) => {
      if (seenExecutionIds.has(trade.id)) return false;
      seenExecutionIds.add(trade.id);
      const execution = executionsById.get(
        trade.id.endsWith(":residual")
          ? trade.id.slice(0, -":residual".length)
          : trade.id,
      );
      const matchSide =
        trade.side === "unknown"
          ? (openingSideForClosingSide(execution?.side ?? null) ?? "unknown")
          : trade.side;
      return !representedActivityKeys.has(
        accountTradeActivityMatchKey(trade, matchSide),
      );
    });
  if (!executionTrades.length) return trades;
  return [...trades, ...executionTrades].sort((left, right) => {
    const leftTime = left.closeDate?.getTime() ?? 0;
    const rightTime = right.closeDate?.getTime() ?? 0;
    return rightTime - leftTime;
  });
};

const brokerOrderActivityMatchKey = (order: BrokerOrderSnapshot): string =>
  [
    order.accountId,
    normalizeSymbol(order.symbol || ""),
    brokerOrderPositionType(order),
    openingSideForClosingSide(order.side) ?? "unknown",
    activityMatchQuantityKey(order.filledQuantity || order.quantity),
    activityMatchPriceKey(orderActivityPrice(order)),
    dateIsoDay(orderActivityDate(order)),
  ].join("|");

const filledLiveOrderActivity = (order: BrokerOrderSnapshot): boolean =>
  terminalOrderStatus(order.status) && (toNumber(order.filledQuantity) ?? 0) > 0;

const brokerOrderPositionType = (
  order: BrokerOrderSnapshot,
): ReturnType<typeof classifyAccountPositionType> =>
  classifyAccountPositionType({
    symbol: order.symbol,
    assetClass: order.assetClass,
    optionContract: order.optionContract,
  });

const orderMatchesClosedTradeFilters = (
  order: BrokerOrderSnapshot,
  input: AccountClosedTradeFilters,
): boolean => {
  const activityDate = orderActivityDate(order);
  if (Number.isNaN(activityDate.getTime())) return false;
  if (input.from && activityDate < input.from) return false;
  if (input.to && activityDate > input.to) return false;
  if (input.symbol && normalizeSymbol(order.symbol) !== normalizeSymbol(input.symbol)) {
    return false;
  }
  if (
    input.assetClass &&
    !accountPositionTypeMatchesFilter(
      brokerOrderPositionType(order),
      resolveAccountPositionTypeFilter(input.assetClass),
    )
  ) {
    return false;
  }
  if (input.pnlSign && input.pnlSign !== "all") {
    return false;
  }
  if (!matchesHoldDurationBucket(null, input.holdDuration)) {
    return false;
  }
  return true;
};

const liveOrderToAccountActivityTrade = (
  order: BrokerOrderSnapshot,
  currency: string,
): NormalizedAccountTrade => {
  const activityDate = orderActivityDate(order);
  const quantity = Math.abs(
    toNumber(order.filledQuantity) ?? toNumber(order.quantity) ?? 0,
  );
  const avgClose = orderActivityPrice(order);
  const optionRight = order.optionContract?.right
    ? String(order.optionContract.right).toLowerCase()
    : null;
  return {
    id: order.id,
    source: "LIVE_ORDER",
    accountId: order.accountId,
    symbol: normalizeSymbol(order.symbol),
    side: "unknown",
    assetClass: normalizeTradeAssetClassLabel({
      assetClass: order.assetClass,
      symbol: order.symbol,
      positionType: brokerOrderPositionType(order),
      optionContract: order.optionContract,
    }),
    positionType: brokerOrderPositionType(order),
    quantity,
    openDate: null,
    closeDate: activityDate,
    avgOpen: null,
    avgClose,
    realizedPnl: null,
    realizedPnlPercent: null,
    holdDurationMinutes: null,
    commissions: null,
    currency,
    orderIds: [order.id],
    sourceType: "manual",
    strategyLabel: "Manual",
    orderStatus: order.status,
    orderType: order.type,
    optionContract: order.optionContract,
    optionRight,
    dte: optionDteFromOrder(order, order.placedAt),
  };
};

const mergeLiveOrderActivityTrades = (
  trades: NormalizedAccountTrade[],
  orders: BrokerOrderSnapshot[],
  input: AccountClosedTradeFilters = {},
  currency = "USD",
): NormalizedAccountTrade[] => {
  const seen = new Set(
    trades.map((trade) => accountTradeActivityMatchKey(trade)),
  );
  const activityTrades: NormalizedAccountTrade[] = [];
  for (const order of orders) {
    if (!filledLiveOrderActivity(order)) continue;
    if (!orderMatchesClosedTradeFilters(order, input)) continue;
    const key = brokerOrderActivityMatchKey(order);
    if (seen.has(key)) continue;
    seen.add(key);
    activityTrades.push(liveOrderToAccountActivityTrade(order, currency));
  }
  if (!activityTrades.length) return trades;
  return [...trades, ...activityTrades].sort((left, right) => {
    const leftTime = left.closeDate?.getTime() ?? 0;
    const rightTime = right.closeDate?.getTime() ?? 0;
    return rightTime - leftTime;
  });
};

const normalizeSnapTradeOptionContract = (
  contract: SnapTradeHistoryOptionContract | null | undefined,
): BrokerOrderSnapshot["optionContract"] | null => {
  if (!contract) return null;
  const expirationDate = new Date(contract.expirationDate);
  if (Number.isNaN(expirationDate.getTime())) return null;
  return {
    ticker: contract.ticker,
    underlying: contract.underlying,
    expirationDate,
    strike: contract.strike,
    right: contract.right,
    multiplier: contract.multiplier,
    sharesPerContract: contract.sharesPerContract,
    providerContractId: contract.providerContractId,
    brokerContractId: contract.brokerContractId,
  };
};

const snapTradeHistoryTradeToAccountTrade = (
  trade: SnapTradeHistoryTrade,
): NormalizedAccountTrade => {
  const optionContract = normalizeSnapTradeOptionContract(trade.optionContract);
  const closeDate = trade.closeDate;
  const activityDate = trade.openDate ?? closeDate;
  return {
    id: trade.id,
    source: "SNAPTRADE_ACTIVITY",
    accountId: trade.accountId,
    symbol: normalizeSymbol(trade.symbol),
    side: normalizeAccountTradeSide(trade.side),
    assetClass: trade.assetClass,
    positionType: trade.positionType,
    quantity: trade.quantity,
    openDate: trade.openDate,
    closeDate,
    avgOpen: trade.avgOpen,
    avgClose: trade.avgClose,
    realizedPnl: trade.realizedPnl,
    realizedPnlPercent: trade.realizedPnlPercent,
    holdDurationMinutes: trade.holdDurationMinutes,
    commissions: trade.commissions,
    currency: trade.currency,
    sourceType: trade.sourceType,
    strategyLabel: trade.strategyLabel,
    optionContract,
    optionRight: trade.optionRight,
    dte:
      optionContract && activityDate
        ? optionDteFromContract(optionContract, activityDate)
        : null,
  };
};

type RobinhoodAccountActivityRow = Awaited<
  ReturnType<typeof readRobinhoodAccountActivities>
>[number];

const robinhoodActivityToAccountTrade = (
  activity: RobinhoodAccountActivityRow,
): NormalizedAccountTrade | null => {
  const closeDate = activity.closedAt;
  if (!closeDate || Number.isNaN(closeDate.getTime())) {
    return null;
  }
  return {
    id: `robinhood-activity:${activity.id}`,
    source: "ROBINHOOD_ACTIVITY",
    accountId: activity.accountId,
    symbol: normalizeSymbol(activity.symbol || "UNKNOWN") || "UNKNOWN",
    side: normalizeAccountTradeSide(activity.side),
    assetClass: "Stocks",
    positionType: "stock",
    quantity: Math.abs(toNumber(activity.quantity) ?? 0),
    openDate: null,
    closeDate,
    avgOpen: null,
    avgClose: toNumber(activity.price),
    realizedPnl: toNumber(activity.realizedGain),
    realizedPnlPercent: null,
    holdDurationMinutes: null,
    commissions: null,
    currency: activity.currency,
    sourceType: "manual",
    strategyLabel: "Manual",
  };
};

async function listProviderActivityClosedTradesForUniverse(
  universe: AccountUniverse,
  input: AccountClosedTradeFilters,
): Promise<NormalizedAccountTrade[]> {
  const snapTradeAccountIds = universe.accounts
    .filter((account) => account.provider === "snaptrade")
    .map((account) => account.id);
  const robinhoodAccountIds = universe.accounts
    .filter((account) => account.provider === "robinhood")
    .map((account) => account.id);

  const [snapTradeTrades, robinhoodTrades] = await withAccountDbRead(() =>
    Promise.all([
      Promise.all(
        snapTradeAccountIds.map((accountId) =>
          readSnapTradeAccountClosedTrades({
            accountId,
            from: input.from,
            to: input.to,
          }),
        ),
      ),
      Promise.all(
        robinhoodAccountIds.map((accountId) =>
          readRobinhoodAccountActivities(accountId),
        ),
      ),
    ]),
  );

  return [
    ...snapTradeTrades.flat().map(snapTradeHistoryTradeToAccountTrade),
    ...robinhoodTrades
      .flat()
      .map(robinhoodActivityToAccountTrade)
      .filter((trade): trade is NormalizedAccountTrade => Boolean(trade)),
  ]
    .filter((trade) => accountTradeMatchesClosedTradeFilters(trade, input))
    .sort((left, right) => {
      const leftTime = left.closeDate?.getTime() ?? 0;
      const rightTime = right.closeDate?.getTime() ?? 0;
      return rightTime - leftTime;
    });
}

async function listExecutionsForUniverse(
  universe: AccountUniverse,
  mode: RuntimeMode,
  input: AccountClosedTradeFilters,
): Promise<BrokerExecutionSnapshot[]> {
  const days = executionLookbackDays(input);
  const symbol = input.symbol ? normalizeSymbol(input.symbol) : null;
  return readShortLivedAccountCache(
    accountExecutionsReadCache,
    accountUniverseReadCacheKey("executions", universe, mode, {
      days,
      symbol,
    }),
    () => readExecutionsForUniverseUncached(universe, mode, input, days),
  );
}

async function readExecutionsForUniverseUncached(
  universe: AccountUniverse,
  mode: RuntimeMode,
  input: AccountClosedTradeFilters,
  days: number,
): Promise<BrokerExecutionSnapshot[]> {
  if (
    universe.source === "robinhood" ||
    universe.source === "snaptrade" ||
    universe.source === "broker"
  ) {
    return [];
  }

  const ibkrAccounts = ibkrReadableAccountsForUniverse(universe);
  if (!ibkrAccounts.length) {
    return [];
  }

  const executions = await Promise.all(
    ibkrAccounts.map((account) =>
      listIbkrExecutions({
        accountId: account.id,
        mode,
        days,
        limit: 500,
        symbol: input.symbol ? normalizeSymbol(input.symbol) : undefined,
      }),
    ),
  );
  return executions.flat();
}

type AccountOrderRow = {
  id: string;
  accountId: string;
  symbol: string;
  side: BrokerOrderSnapshot["side"] | BrokerExecutionSnapshot["side"];
  type: string;
  assetClass: string;
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  timeInForce: string | null;
  status: string;
  placedAt: Date;
  filledAt: Date | null;
  updatedAt: Date;
  averageFillPrice: number | null;
  commission: number | null;
  source: string;
  sourceType?: "manual" | "automation" | "watchlist_backtest" | "mixed";
  strategyLabel?: string;
  optionContract?: BrokerOrderSnapshot["optionContract"] | null;
};

const accountOrderRowFromBrokerOrder = (
  order: BrokerOrderSnapshot,
): AccountOrderRow => ({
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
  sourceType: "manual",
  strategyLabel: "Manual",
  optionContract: order.optionContract ?? null,
});

const accountOrderRowFromExecution = (
  execution: BrokerExecutionSnapshot,
): AccountOrderRow => {
  const quantity = Math.abs(toNumber(execution.quantity) ?? 0);
  const price = toNumber(execution.price);
  return {
    id: accountOrderIdForExecution(execution.id),
    accountId: execution.accountId,
    symbol: normalizeSymbol(execution.symbol),
    side: execution.side,
    type: "EXECUTION",
    assetClass: executionAssetClassLabel(execution),
    quantity,
    filledQuantity: quantity,
    limitPrice: price,
    stopPrice: null,
    timeInForce: null,
    status: "filled",
    placedAt: execution.executedAt,
    filledAt: execution.executedAt,
    updatedAt: execution.executedAt,
    averageFillPrice: price,
    commission: null,
    source: "LIVE_EXECUTION",
    sourceType: "manual",
    strategyLabel: "Manual",
    optionContract: executionOptionContract(execution),
  };
};

const mergeExecutionHistoryOrderRows = (
  orderRows: AccountOrderRow[],
  executions: BrokerExecutionSnapshot[],
): AccountOrderRow[] => {
  if (!executions.length) return orderRows;
  const seenIds = new Set(orderRows.map((row) => row.id));
  const existingOrderActivityKeys = new Set(
    orderRows.map((row) =>
      [
        row.accountId,
        normalizeSymbol(row.symbol),
        String(row.assetClass || "").toLowerCase(),
        String(row.side || "").toLowerCase(),
        activityMatchQuantityKey(row.filledQuantity || row.quantity),
        activityMatchPriceKey(row.averageFillPrice ?? row.limitPrice ?? row.stopPrice),
        dateIsoDay(row.filledAt ?? row.updatedAt),
      ].join("|"),
    ),
  );
  const executionRows: AccountOrderRow[] = [];
  for (const execution of executions) {
    const row = accountOrderRowFromExecution(execution);
    const activityKey = [
      row.accountId,
      normalizeSymbol(row.symbol),
      String(row.assetClass || "").toLowerCase(),
      String(row.side || "").toLowerCase(),
      activityMatchQuantityKey(row.filledQuantity || row.quantity),
      activityMatchPriceKey(row.averageFillPrice ?? row.limitPrice),
      dateIsoDay(row.filledAt ?? row.updatedAt),
    ].join("|");
    if (seenIds.has(row.id) || existingOrderActivityKeys.has(activityKey)) {
      continue;
    }
    seenIds.add(row.id);
    executionRows.push(row);
  }
  if (!executionRows.length) return orderRows;
  return [...orderRows, ...executionRows].sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
};

async function listClosedTradesForUniverse(
  universe: AccountUniverse,
  input: AccountClosedTradeFilters,
  mode: RuntimeMode,
): Promise<NormalizedAccountTrade[]> {
  const conditions = [
    inArray(flexTradesTable.providerAccountId, universe.accountIds),
    flexProviderAccountOwnershipCondition(
      flexTradesTable.providerAccountId,
      universe.appUserId,
      mode,
    ),
  ];
  if (input.symbol) {
    conditions.push(eq(flexTradesTable.symbol, normalizeSymbol(input.symbol)));
  }

  const flexRows = await withOptionalAccountSchema({
    tables: ["flex_trades"],
    whenMissing: () => [],
    run: async () =>
      db
        .select()
        .from(flexTradesTable)
        .where(and(...conditions))
        .orderBy(desc(flexTradesTable.tradeDate)),
  });
  if (!accountTradeCurrenciesMatch(flexRows, universe.primaryCurrency)) {
    throw new HttpError(
      409,
      "Account trade data is unavailable across currencies without authoritative FX rates.",
      {
        code: "account_currency_conversion_required",
        expose: true,
      },
    );
  }

  const explicitClosedTrades = flexRows
    .filter(isClosedFlexTradeRow)
    .map(flexTradeToNormalizedClosedTrade);
  const trades = explicitClosedTrades.length
    ? explicitClosedTrades
    : buildInferredFlexClosedTrades(flexRows);

  return trades.filter((trade) =>
    accountTradeMatchesClosedTradeFilters(trade, input),
  );
}

export async function getAccountClosedTrades(input: {
  accountId: string;
  appUserId?: string | null;
  allowDirectIbkr?: boolean;
  from?: Date | null;
  to?: Date | null;
  symbol?: string | null;
  assetClass?: string | null;
  pnlSign?: string | null;
  holdDuration?: string | null;
  mode?: RuntimeMode;
  source?: string | null;
}) {
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountClosedTrades({
      from: input.from,
      to: input.to,
      symbol: input.symbol,
      assetClass: input.assetClass,
      pnlSign: input.pnlSign,
      source: input.source,
    });
  }

  const mode = input.mode ?? getRuntimeMode();
  const appUserId =
    input.appUserId === undefined ? getCurrentAppUserId() : input.appUserId;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    input.allowDirectIbkr,
  );
  return readAccountRouteResponseCache(
    "closed-trades",
    {
      accountId: input.accountId,
      allowDirectIbkr,
      appUserId,
      assetClass: input.assetClass ?? null,
      from: input.from?.toISOString() ?? null,
      holdDuration: input.holdDuration ?? null,
      mode,
      pnlSign: input.pnlSign ?? null,
      source: input.source ?? null,
      symbol: input.symbol ? normalizeSymbol(input.symbol) : null,
      to: input.to?.toISOString() ?? null,
    },
    () =>
      getAccountClosedTradesUncached({
        ...input,
        allowDirectIbkr,
        appUserId,
        mode,
      }),
    ACCOUNT_ROUTE_CLOSED_TRADES_RESPONSE_CACHE_TTL_MS,
  );
}

async function getAccountClosedTradesUncached(input: {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  from?: Date | null;
  to?: Date | null;
  symbol?: string | null;
  assetClass?: string | null;
  pnlSign?: string | null;
  holdDuration?: string | null;
  mode: RuntimeMode;
  source?: string | null;
}) {
  const mode = input.mode;
  const universe = await getLiveAccountUniverse(
    input.accountId,
    mode,
    input.appUserId,
    input.allowDirectIbkr,
  );
  const [flexTrades, providerTrades, executions, orderResult] = await Promise.all([
    listClosedTradesForUniverse(universe, input, mode),
    listProviderActivityClosedTradesForUniverse(universe, input),
    listExecutionsForUniverse(universe, mode, input),
    listOrdersForUniverse(universe, mode),
  ]);
  const historicalTrades = [...flexTrades, ...providerTrades].sort((left, right) => {
    const leftTime = left.closeDate?.getTime() ?? 0;
    const rightTime = right.closeDate?.getTime() ?? 0;
    return rightTime - leftTime;
  });
  const executionTrades = mergeLiveExecutionActivityTrades(
    historicalTrades,
    executions,
    input,
    universe.primaryCurrency,
  );
  const trades = mergeLiveOrderActivityTrades(
    executionTrades,
    orderResult.orders,
    input,
    universe.primaryCurrency,
  );
  if (!accountTradeCurrenciesMatch(trades, universe.primaryCurrency)) {
    throw new HttpError(
      409,
      "Account trade data is unavailable across currencies without authoritative FX rates.",
      {
        code: "account_currency_conversion_required",
        expose: true,
      },
    );
  }

  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    trades,
    summary: summarizeAccountClosedTrades(trades),
    updatedAt: new Date(),
  };
}

export async function getAccountOrders(input: {
  accountId: string;
  appUserId?: string | null;
  allowDirectIbkr?: boolean;
  tab?: OrderTab;
  mode?: RuntimeMode;
  source?: string | null;
}) {
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountOrders({
      tab: input.tab,
      source: input.source,
    });
  }

  const mode = input.mode ?? getRuntimeMode();
  const appUserId =
    input.appUserId === undefined ? getCurrentAppUserId() : input.appUserId;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    input.allowDirectIbkr,
  );
  const tab = normalizeOrderTab(input.tab);
  const universe = await getLiveAccountUniverse(
    input.accountId,
    mode,
    appUserId,
    allowDirectIbkr,
  );
  const [orderResult, executions] = await Promise.all([
    listOrdersForUniverse(universe, mode),
    tab === "history"
      ? listExecutionsForUniverse(universe, mode, {})
      : Promise.resolve([]),
  ]);
  const filtered = orderResult.orders.filter((order) =>
    tab === "working" ? workingOrderStatus(order.status) : terminalOrderStatus(order.status),
  );
  const orderRows = filtered.map(accountOrderRowFromBrokerOrder);
  const historyRows =
    tab === "history" ? mergeExecutionHistoryOrderRows(orderRows, executions) : orderRows;

  return {
    accountId: universe.requestedAccountId,
    tab,
    currency: universe.primaryCurrency,
    orders: historyRows,
    updatedAt: new Date(),
  };
}

export async function cancelAccountOrder(input: {
  accountId: string;
  orderId: string;
  mode?: RuntimeMode | null;
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

  return cancelOrder(input);
}

function normalizeAccountRiskDetail(detail?: AccountRiskDetail): AccountRiskDetail {
  return detail === "full" ? "full" : "fast";
}

export async function getAccountRisk(input: {
  accountId: string;
  appUserId?: string | null;
  allowDirectIbkr?: boolean;
  mode?: RuntimeMode;
  source?: string | null;
  detail?: AccountRiskDetail;
}) {
  const detail = normalizeAccountRiskDetail(input.detail);
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountRisk({ source: input.source, detail });
  }

  const mode = input.mode ?? getRuntimeMode();
  const appUserId =
    input.appUserId === undefined ? getCurrentAppUserId() : input.appUserId;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    input.allowDirectIbkr,
  );
  if (detail === "full") {
    return getAccountRiskWithNonBlockingFullDetail({
      ...input,
      allowDirectIbkr,
      appUserId,
      mode,
    });
  }
  return getAccountRiskUncached({
    ...input,
    allowDirectIbkr,
    appUserId,
    mode,
    detail,
  });
}

async function getAccountRiskUncached(input: {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  mode: RuntimeMode;
  source?: string | null;
  detail?: AccountRiskDetail;
}) {
  const mode = input.mode;
  const detail = normalizeAccountRiskDetail(input.detail);
  const universe = await getLiveAccountUniverse(
    input.accountId,
    mode,
    input.appUserId,
    input.allowDirectIbkr,
  );
  const [positions, closedTrades] = await Promise.all([
    listPositionsForUniverse(universe, mode),
    listClosedTradesForUniverse(universe, {}, mode),
  ]);
  const deferGreekRefresh = detail === "fast";
  const [greekEnrichment, marketHydration, underlyingPrices] = await Promise.all([
    deferGreekRefresh
      ? Promise.resolve(buildDeferredPositionGreekEnrichment(positions))
      : enrichPositionGreeks(positions),
    hydratePositionMarkets(positions),
    hydrateOptionUnderlyingPrices(positions),
  ]);
  const nav = sumAccounts(universe.accounts, "netLiquidation");
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
  const gamma = sumNullableValues(
    positions.map((position) => greekEnrichment.byPositionId.get(position.id)?.gamma),
  );
  const theta = sumNullableValues(
    positions.map((position) => greekEnrichment.byPositionId.get(position.id)?.theta),
  );
  const vega = sumNullableValues(
    positions.map((position) => greekEnrichment.byPositionId.get(position.id)?.vega),
  );
  const perUnderlying = aggregateGreeksByUnderlying(
    positions.map((position) => ({
      underlying: positionReferenceSymbol(position),
      exposure: hydratedPositionMarketValue(position, marketHydration),
      isOption: position.assetClass === "option",
      greek: greekEnrichment.byPositionId.get(position.id),
    })),
  ).sort(
    (left, right) => Math.abs(right.exposure) - Math.abs(left.exposure),
  );
  const greekWarnings = [...greekEnrichment.warnings];

  if (
    totalOptionPositions > 0 &&
    greekEnrichment.matchedOptionPositions < totalOptionPositions
  ) {
    greekWarnings.unshift(
      `Matched ${greekEnrichment.matchedOptionPositions} of ${totalOptionPositions} option positions to Massive greek snapshots.`,
    );
  }

  const notional = deferGreekRefresh
    ? buildNotionalExposure(positions, {
        nav,
        marketHydration,
        greekByPositionId: greekEnrichment.byPositionId,
        underlyingPrices,
      })
    : (
        await resolveAccountPortfolioRisk({
          positions,
          nav,
          marketHydration,
          greekByPositionId: greekEnrichment.byPositionId,
          underlyingPrices,
        })
      ).notional;
  const greekScenarios = deferGreekRefresh
    ? buildDeferredAccountGreekScenarios()
    : await resolveAccountGreekScenarios({
        positions,
        marketHydration,
        greekByPositionId: greekEnrichment.byPositionId,
        underlyingPrices,
      });
  const expiryConcentration = buildExpiryConcentration(positions);
  const riskRecommendations = buildAccountRiskRecommendations({
    positions,
    nav,
    marketHydration,
    greekByPositionId: greekEnrichment.byPositionId,
    greekScenarios,
    notional,
    expiryConcentration,
  });

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
    notional,
    greekScenarios,
    riskRecommendations,
    expiryConcentration,
    updatedAt: accountMetricUpdatedAt(universe.accounts) ?? new Date(),
  };
}

type AccountRiskPayload = Awaited<ReturnType<typeof getAccountRiskUncached>>;

type AccountFullRiskDetailMetadata = {
  requested: true;
  status: "fresh" | "stale" | "pending";
  cachedAt: string | null;
  refreshInFlight: boolean;
  warning: string | null;
};

function accountFullRiskCacheKey(input: {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  mode: RuntimeMode;
  source?: string | null;
}): string {
  return stableAccountReadCacheKey("full-risk", {
    accountId: input.accountId,
    allowDirectIbkr: input.allowDirectIbkr,
    appUserId: input.appUserId,
    mode: input.mode,
    source: input.source ?? null,
  });
}

function pruneAccountFullRiskCache(now = Date.now()): void {
  for (const [cacheKey, entry] of accountFullRiskCache.entries()) {
    if (entry.staleExpiresAt <= now && !accountFullRiskInflight.has(cacheKey)) {
      accountFullRiskCache.delete(cacheKey);
    }
  }
}

function markAccountRiskFullDetailStatus(
  payload: AccountRiskPayload,
  input: AccountFullRiskDetailMetadata,
): AccountRiskPayload & { fullRiskDetail: AccountFullRiskDetailMetadata } {
  return {
    ...payload,
    fullRiskDetail: input,
  };
}

function markAccountRiskFullRefreshPending(
  payload: AccountRiskPayload,
): AccountRiskPayload & { fullRiskDetail: AccountFullRiskDetailMetadata } {
  return markAccountRiskFullDetailStatus(
    {
      ...payload,
      greekScenarios: buildPendingAccountGreekScenarios(),
    },
    {
      requested: true,
      status: "pending",
      cachedAt: null,
      refreshInFlight: true,
      warning: "Full account risk detail is refreshing asynchronously.",
    },
  );
}

function refreshAccountFullRiskCache(input: {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  mode: RuntimeMode;
  source?: string | null;
}): Promise<AccountRiskPayload> {
  const cacheKey = accountFullRiskCacheKey(input);
  const existing = accountFullRiskInflight.get(cacheKey) as
    | Promise<AccountRiskPayload>
    | undefined;
  if (existing) {
    return existing;
  }

  const request = getAccountRiskUncached({ ...input, detail: "full" }).then(
    (value) => {
      const cachedAt = Date.now();
      accountFullRiskCache.set(cacheKey, {
        value,
        cachedAt,
        expiresAt: cachedAt + ACCOUNT_FULL_RISK_CACHE_TTL_MS,
        staleExpiresAt: cachedAt + ACCOUNT_FULL_RISK_STALE_TTL_MS,
      });
      return value;
    },
  );
  accountFullRiskInflight.set(cacheKey, request);
  request.finally(() => {
    if (accountFullRiskInflight.get(cacheKey) === request) {
      accountFullRiskInflight.delete(cacheKey);
    }
  }).catch(() => undefined);
  return request;
}

function scheduleAccountFullRiskRefresh(input: {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  mode: RuntimeMode;
  source?: string | null;
}): Promise<AccountRiskPayload> {
  const request = refreshAccountFullRiskCache(input);
  request.catch((error) => {
    logger.warn(
      { err: error, accountId: input.accountId, mode: input.mode },
      "Account full risk refresh failed",
    );
  });
  return request;
}

async function getAccountRiskWithNonBlockingFullDetail(input: {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  mode: RuntimeMode;
  source?: string | null;
}) {
  const mode = input.mode;
  const cacheKey = accountFullRiskCacheKey(input);
  const now = Date.now();
  pruneAccountFullRiskCache(now);

  const cached = accountFullRiskCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return markAccountRiskFullDetailStatus(cached.value as AccountRiskPayload, {
      requested: true,
      status: "fresh",
      cachedAt: new Date(cached.cachedAt).toISOString(),
      refreshInFlight: false,
      warning: null,
    });
  }

  scheduleAccountFullRiskRefresh({ ...input, mode });
  if (cached && cached.staleExpiresAt > now) {
    return markAccountRiskFullDetailStatus(cached.value as AccountRiskPayload, {
      requested: true,
      status: "stale",
      cachedAt: new Date(cached.cachedAt).toISOString(),
      refreshInFlight: true,
      warning: "Full account risk detail is stale while a refresh is running.",
    });
  }

  const fastRisk = await getAccountRiskUncached({ ...input, mode, detail: "fast" });
  return markAccountRiskFullRefreshPending(fastRisk);
}

function buildDeferredAccountGreekScenarios(): AccountGreekScenarios {
  return {
    enabled: false,
    status: "disabled",
    source: "python_compute",
    warning: "Deferred during fast account risk read.",
    coverage: null,
    result: null,
    pythonJob: {
      jobId: null,
      jobType: "greek_scenario_matrix",
      durationMs: null,
      warnings: [],
      error: null,
    },
  };
}

function buildPendingAccountGreekScenarios(): AccountGreekScenarios {
  return {
    enabled: true,
    status: "pending",
    source: "python_compute",
    warning: "Full account risk detail is refreshing asynchronously.",
    coverage: null,
    result: null,
    pythonJob: {
      jobId: null,
      jobType: "greek_scenario_matrix",
      durationMs: null,
      warnings: [],
      error: null,
    },
  };
}

export async function getAccountCashActivity(input: {
  accountId: string;
  appUserId?: string | null;
  allowDirectIbkr?: boolean;
  from?: Date | null;
  to?: Date | null;
  mode?: RuntimeMode;
  source?: string | null;
}) {
  if (isShadowAccountId(input.accountId)) {
    return getShadowAccountCashActivity({ source: input.source });
  }

  const mode = input.mode ?? getRuntimeMode();
  const appUserId =
    input.appUserId === undefined ? getCurrentAppUserId() : input.appUserId;
  const allowDirectIbkr = directIbkrReadsAllowed(
    appUserId,
    input.allowDirectIbkr,
  );
  return getAccountCashActivityUncached({
    ...input,
    allowDirectIbkr,
    appUserId,
    mode,
  });
}

async function getAccountCashActivityUncached(input: {
  accountId: string;
  appUserId: string | null;
  allowDirectIbkr: boolean;
  from?: Date | null;
  to?: Date | null;
  mode: RuntimeMode;
  source?: string | null;
}) {
  const mode = input.mode;
  const universe = await getLiveAccountUniverse(
    input.accountId,
    mode,
    input.appUserId,
    input.allowDirectIbkr,
  );
  return readAccountCashActivityForUniverse({
    universe,
    mode,
    from: input.from,
    to: input.to,
    now: new Date(),
  });
}

async function readAccountCashActivityForUniverse(input: {
  universe: AccountUniverse;
  mode: RuntimeMode;
  from?: Date | null;
  to?: Date | null;
  now: Date;
}) {
  const { universe, mode } = input;
  assertAccountSchemaTablesAvailable(
    await getOptionalAccountSchemaReadiness(),
    ["flex_report_runs", "flex_cash_activity", "flex_dividends"],
  );
  const now = input.now;
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const activityOwnershipConditions = [
    inArray(flexCashActivityTable.providerAccountId, universe.accountIds),
    flexProviderAccountOwnershipCondition(
      flexCashActivityTable.providerAccountId,
      universe.appUserId,
      mode,
    ),
  ];
  const activityDisplayConditions = [...activityOwnershipConditions];
  if (input.from) {
    activityDisplayConditions.push(
      gte(flexCashActivityTable.activityDate, input.from),
    );
  }
  if (input.to) {
    activityDisplayConditions.push(
      lte(flexCashActivityTable.activityDate, input.to),
    );
  }
  const dividendOwnershipConditions = [
    inArray(flexDividendsTable.providerAccountId, universe.accountIds),
    flexProviderAccountOwnershipCondition(
      flexDividendsTable.providerAccountId,
      universe.appUserId,
      mode,
    ),
  ];
  const dividendDisplayConditions = [...dividendOwnershipConditions];
  if (input.from) {
    dividendDisplayConditions.push(
      gte(flexDividendsTable.paidDate, input.from),
    );
  }
  if (input.to) {
    dividendDisplayConditions.push(
      lte(flexDividendsTable.paidDate, input.to),
    );
  }

  const [
    activities,
    dividends,
    activityTotalRows,
    dividendTotalRows,
    completedCoverageRuns,
  ] =
    await Promise.all([
      withOptionalAccountSchema({
        tables: ["flex_cash_activity"],
        whenMissing: () => [],
        run: async () =>
          db
            .select()
            .from(flexCashActivityTable)
            .where(and(...activityDisplayConditions))
            .orderBy(desc(flexCashActivityTable.activityDate))
            .limit(200),
      }),
      withOptionalAccountSchema({
        tables: ["flex_dividends"],
        whenMissing: () => [],
        run: async () =>
          db
            .select()
            .from(flexDividendsTable)
            .where(and(...dividendDisplayConditions))
            .orderBy(desc(flexDividendsTable.paidDate))
            .limit(100),
      }),
      withOptionalAccountSchema({
        tables: ["flex_cash_activity"],
        whenMissing: () => [],
        run: async () =>
          db
            .select({
              feesYtd: sql<string>`coalesce(sum(case when (${flexCashActivityTable.activityType} || ' ' || coalesce(${flexCashActivityTable.description}, '')) ~* 'fee|commission' then abs(${flexCashActivityTable.amount}) else 0 end), 0)`,
              interestPaidEarnedYtd: sql<string>`coalesce(sum(case when (${flexCashActivityTable.activityType} || ' ' || coalesce(${flexCashActivityTable.description}, '')) ~* 'interest' then ${flexCashActivityTable.amount} else 0 end), 0)`,
              currencyMismatchCount: sql<string>`count(*) filter (where upper(trim(${flexCashActivityTable.currency})) <> ${universe.primaryCurrency.trim().toUpperCase()})`,
            })
            .from(flexCashActivityTable)
            .where(
              and(
                ...activityOwnershipConditions,
                gte(flexCashActivityTable.activityDate, yearStart),
                lte(flexCashActivityTable.activityDate, now),
              ),
            ),
      }),
      withOptionalAccountSchema({
        tables: ["flex_dividends"],
        whenMissing: () => [],
        run: async () =>
          db
            .select({
              dividendsMonth: sql<string>`coalesce(sum(${flexDividendsTable.amount}) filter (where ${flexDividendsTable.paidDate} >= ${monthStart}), 0)`,
              dividendsYtd: sql<string>`coalesce(sum(${flexDividendsTable.amount}), 0)`,
              currencyMismatchCount: sql<string>`count(*) filter (where upper(trim(${flexDividendsTable.currency})) <> ${universe.primaryCurrency.trim().toUpperCase()})`,
            })
            .from(flexDividendsTable)
            .where(
              and(
                ...dividendOwnershipConditions,
                gte(flexDividendsTable.paidDate, yearStart),
                lte(flexDividendsTable.paidDate, now),
              ),
            ),
      }),
      withOptionalAccountSchema({
        tables: ["flex_report_runs"],
        whenMissing: () => [],
        run: () =>
          db
            .select({ metadata: flexReportRunsTable.metadata })
            .from(flexReportRunsTable)
            .where(
              and(
                eq(flexReportRunsTable.status, "completed"),
                gte(flexReportRunsTable.completedAt, yearStart),
              ),
            )
            .orderBy(desc(flexReportRunsTable.completedAt)),
      }),
    ]);
  const coverageThrough = toIsoDateString(now);
  if (
    !completedFlexRunsCoverRange({
      runs: completedCoverageRuns,
      providerAccountIds: universe.accounts.map(
        (account) => account.providerAccountId,
      ),
      fromDate: toIsoDateString(yearStart),
      toDate: coverageThrough,
    })
  ) {
    throw new HttpError(
      503,
      `Account cash activity is unavailable because completed Flex report coverage does not span every account through ${coverageThrough}.`,
      {
        code: "ibkr_flex_coverage_unavailable",
        expose: true,
      },
    );
  }
  const activityTotals = activityTotalRows[0];
  const dividendTotals = dividendTotalRows[0];
  const displayedCurrenciesMatch = accountTradeCurrenciesMatch(
    [...activities, ...dividends],
    universe.primaryCurrency,
  );
  if (
    !displayedCurrenciesMatch ||
    (toNumber(activityTotals?.currencyMismatchCount) ?? 0) > 0 ||
    (toNumber(dividendTotals?.currencyMismatchCount) ?? 0) > 0
  ) {
    throw new HttpError(
      409,
      "Account cash activity is unavailable across currencies without authoritative FX rates.",
      {
        code: "account_currency_conversion_required",
        expose: true,
      },
    );
  }

  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    settledCash: sumAccounts(universe.accounts, "settledCash"),
    unsettledCash: null,
    totalCash: sumAccounts(universe.accounts, "cash"),
    dividendsMonth: requiredAccountFinancialNumber(
      dividendTotals?.dividendsMonth,
      "monthly dividends total",
    ),
    dividendsYtd: requiredAccountFinancialNumber(
      dividendTotals?.dividendsYtd,
      "year-to-date dividends total",
    ),
    interestPaidEarnedYtd: requiredAccountFinancialNumber(
      activityTotals?.interestPaidEarnedYtd,
      "year-to-date interest total",
    ),
    feesYtd: requiredAccountFinancialNumber(
      activityTotals?.feesYtd,
      "year-to-date fees total",
    ),
    activities: activities.map((row) => ({
      id: row.activityId,
      accountId: row.providerAccountId,
      date: row.activityDate,
      type: row.activityType,
      description: row.description,
      amount: requiredAccountFinancialNumber(
        row.amount,
        `cash activity ${row.activityId}`,
      ),
      currency: row.currency,
      source: "FLEX",
    })),
    dividends: dividends.map((row) => ({
      id: row.dividendId,
      accountId: row.providerAccountId,
      symbol: row.symbol,
      description: row.description,
      paidDate: row.paidDate,
      amount: requiredAccountFinancialNumber(
        row.amount,
        `dividend ${row.dividendId}`,
      ),
      currency: row.currency,
      source: "FLEX",
    })),
    updatedAt: new Date(),
  };
}

export async function getFlexHealth() {
  const schema = await getOptionalAccountSchemaReadiness();
  const [
    lastRun,
    lastCompletedRun,
    latestSnapshot,
    [snapshotCoverage],
    [flexCoverage],
    [tradeCoverage],
    [cashCoverage],
    [dividendCoverage],
    [openPositionCoverage],
  ] = await Promise.all([
    withOptionalAccountSchema({
      tables: ["flex_report_runs"],
      whenMissing: () => null,
      run: async () => {
        const [row] = await db
          .select()
          .from(flexReportRunsTable)
          .orderBy(desc(flexReportRunsTable.requestedAt))
          .limit(1);
        return row ?? null;
      },
    }),
    withOptionalAccountSchema({
      tables: ["flex_report_runs"],
      whenMissing: () => null,
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
    withAccountDbRead(async () =>
      db
        .select({ asOf: balanceSnapshotsTable.asOf })
        .from(balanceSnapshotsTable)
        .orderBy(desc(balanceSnapshotsTable.asOf))
        .limit(1),
    ),
    withAccountDbRead(async () =>
      db
        .select({
          firstAsOf: sql<Date | null>`min(${balanceSnapshotsTable.asOf})`,
          lastAsOf: sql<Date | null>`max(${balanceSnapshotsTable.asOf})`,
          rowCount: sql<number>`count(*)::int`,
        })
        .from(balanceSnapshotsTable),
    ),
    withOptionalAccountSchema({
      tables: ["flex_nav_history"],
      whenMissing: () => [{ firstDate: null, lastDate: null, rowCount: 0 }],
      run: async () =>
        db
          .select({
            firstDate: sql<string | null>`min(${flexNavHistoryTable.statementDate})`,
            lastDate: sql<string | null>`max(${flexNavHistoryTable.statementDate})`,
            rowCount: sql<number>`count(*)::int`,
          })
          .from(flexNavHistoryTable),
    }),
    withOptionalAccountSchema({
      tables: ["flex_trades"],
      whenMissing: () => [{ firstAt: null, lastAt: null, rowCount: 0 }],
      run: async () =>
        db
          .select({
            firstAt: sql<Date | null>`min(${flexTradesTable.tradeDate})`,
            lastAt: sql<Date | null>`max(${flexTradesTable.tradeDate})`,
            rowCount: sql<number>`count(*)::int`,
          })
          .from(flexTradesTable),
    }),
    withOptionalAccountSchema({
      tables: ["flex_cash_activity"],
      whenMissing: () => [{ firstAt: null, lastAt: null, rowCount: 0 }],
      run: async () =>
        db
          .select({
            firstAt: sql<Date | null>`min(${flexCashActivityTable.activityDate})`,
            lastAt: sql<Date | null>`max(${flexCashActivityTable.activityDate})`,
            rowCount: sql<number>`count(*)::int`,
          })
          .from(flexCashActivityTable),
    }),
    withOptionalAccountSchema({
      tables: ["flex_dividends"],
      whenMissing: () => [{ firstAt: null, lastAt: null, rowCount: 0 }],
      run: async () =>
        db
          .select({
            firstAt: sql<Date | null>`min(${flexDividendsTable.paidDate})`,
            lastAt: sql<Date | null>`max(${flexDividendsTable.paidDate})`,
            rowCount: sql<number>`count(*)::int`,
          })
          .from(flexDividendsTable),
    }),
    withOptionalAccountSchema({
      tables: ["flex_open_positions"],
      whenMissing: () => [{ firstAt: null, lastAt: null, rowCount: 0 }],
      run: async () =>
        db
          .select({
            firstAt: sql<Date | null>`min(${flexOpenPositionsTable.asOf})`,
            lastAt: sql<Date | null>`max(${flexOpenPositionsTable.asOf})`,
            rowCount: sql<number>`count(*)::int`,
          })
          .from(flexOpenPositionsTable),
    }),
  ]);

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
  clearAccountRouteResponseCache: () => accountRouteResponseCache.clear(),
  aggregateCombinedEquitySnapshotRows,
  compactEquitySnapshotRows,
  dedupeEquitySnapshotRows,
  equitySnapshotBucketSizeMs,
  filterPlaceholderZeroEquitySnapshotRows,
  filterSnapshotsOnFlexTransferDates,
  isPlaceholderZeroAccountSnapshot,
  persistedAccountRowsToSnapshots,
  readAccountRouteResponseCache,
};

export const __accountSnapshotPersistenceInternalsForTests = {
  resetCaches: () => {
    snapshotWriteTimestamps.clear();
    snapshotProviderTimestamps.clear();
  },
};

export const __accountUniverseInternalsForTests = {
  currencyOf,
  liveAccountUniverseCacheKey,
  readLiveAccountUniverseUncached,
  resolveSnapTradeAccountsForPositions,
  snapTradeListAccountsFromResolution,
};

export const __accountPositionInternalsForTests = {
  addKnownCashAllocation,
  applyLatestSnapTradeBalancesToUniverse,
  aggregateBalanceRows,
  accountPositionMarketDataSymbol,
  buildAccountPositionTotals,
  buildExecutionOpenDatesForPositions,
  buildPositionMarketHydration,
  buildPositionQuoteFromSnapshot,
  choosePositionQuote,
  enrichPositionGreeks,
  accountOptionQuoteFromDemandState,
  clearAccountPositionOpenDateCaches: () => {
    accountPositionOpenDatesReadCache.clear();
    accountPositionOpenDatesLastKnownCache.clear();
  },
  filterOpenBrokerPositions,
  flexOpenPositionOpenedAt,
  historicalPositionResponseAvailability,
  inferSameDayExpiringOptionOpenDatesForPositions,
  isOpenBrokerPosition,
  normalizeMarketDataSymbol,
  optionQuoteForPosition,
  optionQuoteDemandProviderContractIdsForPosition,
  optionQuoteProviderContractIdsForPosition,
  readPositionsForUniverseUncached,
  stabilizeExecutionOpenDatesForPositions,
  selectFlexOpenPositionCandidate,
  selectBalanceBoundaryRows,
  selectCombinedPositionQuote,
};

export const __accountDbReadInternalsForTests = {
  assertAccountSchemaTablesAvailable,
  runAccountSchemaReadinessProbe,
  withAccountDbRead,
};

export const __accountMarginInternalsForTests = {
  buildAccountMarginSnapshot,
};

export const __accountOrderInternalsForTests = {
  accountTradeMatchesClosedTradeFilters,
  accountOrderRowFromExecution,
  buildLiveExecutionActivityTrades,
  mergeExecutionHistoryOrderRows,
  mergeLiveExecutionActivityTrades,
  mergeLiveOrderActivityTrades,
  normalizeOrderTab,
  normalizeTradeAssetClassLabel,
  optionDteFromOrder,
  orderMatchesClosedTradeFilters,
  orderGroupKey,
  positionGroupKey,
  terminalOrderStatus,
  workingOrderStatus,
  // WO-EE-FIREHOSE Deliverable 4 — read-shape fold over the narrowed projection.
  buildRealPositionAttribution,
  foldRealPositionAttribution,
  realAttributionPositionKey,
};

export const __accountTradeAnnotationInternalsForTests = {
  buildInferredFlexClosedTrades,
  buildAccountTradeAnnotationKey,
  normalizeFlexTradeSide,
  isClosedFlexTradeRow,
  normalizeAccountAnnotationMode,
  normalizeAnnotationNote,
  normalizeAnnotationTags,
  robinhoodActivityToAccountTrade,
};

export const __accountOverviewInternalsForTests = {
  calculateLatestMarketDayPnlFromHistory,
  buildTradeOutcomeBuckets,
  normalizeTradeOutcomeBucketCount,
  overviewMatchesRequest,
};

export const __accountRiskInternalsForTests = {
  betaForSymbol,
  buildPendingAccountGreekScenarios,
  buildExpiryConcentration,
  buildGreekScenarioMatrixInput,
  buildNotionalExposure,
  matchOptionChainContract,
  mergeOptionChainContracts,
  normalizeAccountRiskDetail,
  sectorForSymbol,
  sumNullableValues,
  weightPercent,
};

export const __accountFlexInternalsForTests = {
  buildFlexBackfillWindows,
  completedFlexRunsCoverRange,
  extractFlexRecords,
  extractTagText,
  flexConfigured,
  getFlexConfigs,
  flexProviderAccountIdsFromReport,
  readAccountCashActivityForUniverse,
  runScheduledFlexRefresh,
  upsertFlexReport,
};
