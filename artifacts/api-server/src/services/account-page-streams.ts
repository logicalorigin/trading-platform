import {
  currentDbLane,
  getPostgresDiagnosticContext,
  runInDbLane,
  runWithPostgresDiagnosticContext,
} from "@workspace/db";
import { logger } from "../lib/logger";
import type { RuntimeMode } from "../lib/runtime";
import {
  getAccountAllocation,
  getAccountCashActivity,
  getAccountClosedTrades,
  getAccountEquityHistory,
  getAccountOrders,
  getAccountPositions,
  getAccountRisk,
  getAccountSummary,
  getFlexHealth,
} from "./account";
import type { AccountRange } from "./account-ranges";
import {
  getShadowAccountAllocationFromPositions,
  getShadowAccountRisk,
  getShadowAccountSummaryFromPositions,
  isShadowAccountId,
} from "./shadow-account";
import {
  getShadowAccountLedgerGeneration,
  getShadowAccountSnapshotGeneration,
  subscribeShadowAccountChanges,
} from "./shadow-account-events";
import {
  currentShadowAccountId,
  runWithShadowAccountId,
} from "./shadow-account-context";
import { normalizeAccountPositionTypeFilter } from "./account-position-type";

type Unsubscribe = () => void;
type BenchmarkSymbol = "SPY" | "QQQ" | "DIA";
type ShadowRiskInput = NonNullable<Parameters<typeof getShadowAccountRisk>[0]>;

export const ACCOUNT_PAGE_STREAM_INTERVAL_MS = 1_000;
export const ACCOUNT_PAGE_DERIVED_STREAM_INTERVAL_MS = 30_000;
export const ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS = 0;
export const ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS = 0;
export const ACCOUNT_PAGE_BENCHMARK_EQUITY_CACHE_TTL_MS = 5 * 60_000;
export const ACCOUNT_PAGE_PRIMARY_CACHE_TTL_MS = 2_000;

type AccountPageSnapshotInput = {
  accountId: string;
  appUserId: string;
  allowDirectIbkr?: boolean;
  mode: RuntimeMode;
  range?: AccountRange;
  assetClass?: string | null;
  from?: Date | null;
  to?: Date | null;
  symbol?: string | null;
  tradeAssetClass?: string | null;
  pnlSign?: string | null;
  holdDuration?: string | null;
  performanceCalendarFrom?: Date | null;
  includeIntraday?: boolean;
  includeWorkingOrders?: boolean;
  includeSetupHealth?: boolean;
  includeSpyBenchmark?: boolean;
  includeQqqBenchmark?: boolean;
  includeDiaBenchmark?: boolean;
};

type AccountPagePayloadData = {
  tradeFilters: {
    from: string | null;
    to: string | null;
    symbol: string | null;
    assetClass: string | null;
    pnlSign: string | null;
    holdDuration: string | null;
  };
  summary: Awaited<ReturnType<typeof getAccountSummary>>;
  equityHistory: Awaited<ReturnType<typeof getAccountEquityHistory>>;
  intradayEquity?: Awaited<ReturnType<typeof getAccountEquityHistory>>;
  benchmarkEquityHistory: Partial<Record<
    BenchmarkSymbol,
    Awaited<ReturnType<typeof getAccountEquityHistory>>
  >>;
  performanceCalendarEquity: Awaited<ReturnType<typeof getAccountEquityHistory>>;
  performanceCalendarTrades: Awaited<ReturnType<typeof getAccountClosedTrades>>;
  allocation: Awaited<ReturnType<typeof getAccountAllocation>>;
  positions: Awaited<ReturnType<typeof getAccountPositions>>;
  closedTrades: Awaited<ReturnType<typeof getAccountClosedTrades>>;
  orders?: Awaited<ReturnType<typeof getAccountOrders>>;
  risk: Awaited<ReturnType<typeof getAccountRisk>>;
  cashActivity: Awaited<ReturnType<typeof getAccountCashActivity>>;
  flexHealth?: Awaited<ReturnType<typeof getFlexHealth>> | null;
};

export type AccountPagePrimaryPayload = {
  stream: "account-page-primary";
  accountId: string;
  mode: RuntimeMode;
  assetClass: string | null;
  updatedAt: string;
  summary: AccountPagePayloadData["summary"];
  allocation: AccountPagePayloadData["allocation"];
  positions: AccountPagePayloadData["positions"];
  orders?: AccountPagePayloadData["orders"];
  risk: AccountPagePayloadData["risk"];
};

export type AccountPageLivePayload = {
  stream: "account-page-live";
  accountId: string;
  mode: RuntimeMode;
  assetClass: string | null;
  updatedAt: string;
  summary: AccountPagePayloadData["summary"];
  intradayEquity?: AccountPagePayloadData["intradayEquity"];
  allocation: AccountPagePayloadData["allocation"];
  positions: AccountPagePayloadData["positions"];
  orders?: AccountPagePayloadData["orders"];
  risk: AccountPagePayloadData["risk"];
};

export type AccountPageDerivedPayload = {
  stream: "account-page-derived";
  accountId: string;
  mode: RuntimeMode;
  range?: AccountRange;
  tradeFilters: AccountPagePayloadData["tradeFilters"];
  performanceCalendarFrom: string | null;
  updatedAt: string;
  equityHistory: AccountPagePayloadData["equityHistory"];
  benchmarkEquityHistory: AccountPagePayloadData["benchmarkEquityHistory"];
  performanceCalendarEquity: AccountPagePayloadData["performanceCalendarEquity"];
  performanceCalendarTrades: AccountPagePayloadData["performanceCalendarTrades"];
  closedTrades: AccountPagePayloadData["closedTrades"];
  cashActivity: AccountPagePayloadData["cashActivity"];
  flexHealth?: AccountPagePayloadData["flexHealth"];
};

const accountPagePrimaryInflight = new Map<
  string,
  Promise<AccountPagePrimaryPayload>
>();
const accountPageLiveInflight = new Map<
  string,
  Promise<AccountPageLivePayload>
>();
const ACCOUNT_PAGE_LIVE_CONTENT_CACHE_MAX_ENTRIES = 64;
const accountPageLiveContentCache = new Map<string, AccountPageLivePayload>();
const accountPageDerivedCache = new Map<
  string,
  { value: AccountPageDerivedPayload; expiresAt: number }
>();
const accountPageDerivedInflight = new Map<
  string,
  Promise<AccountPageDerivedPayload>
>();
const accountPageBenchmarkEquityCache = new Map<
  string,
  {
    value: Awaited<ReturnType<typeof getAccountEquityHistory>>;
    expiresAt: number;
  }
>();
const accountPagePrimaryCache = new Map<
  string,
  { value: AccountPagePrimaryPayload; expiresAt: number }
>();
let accountPageSnapshotCacheVersion = 0;

type AccountPageTimingKey =
  | "primaryMs"
  | "liveMs"
  | "derivedMs"
  | "firstPrimaryWriteMs"
  | "firstDerivedWriteMs";
type AccountPageCacheKey =
  | "primaryHit"
  | "liveHit"
  | "derivedHit"
  | "benchmarkHit";

const accountPageStreamDiagnostics: {
  updatedAt: string | null;
  timings: Record<AccountPageTimingKey, number | null>;
  cache: Record<AccountPageCacheKey, boolean | null> & {
    primaryHits: number;
    primaryMisses: number;
    liveHits: number;
    liveMisses: number;
    derivedHits: number;
    derivedMisses: number;
    benchmarkHits: number;
    benchmarkMisses: number;
  };
} = {
  updatedAt: null,
  timings: {
    primaryMs: null,
    liveMs: null,
    derivedMs: null,
    firstPrimaryWriteMs: null,
    firstDerivedWriteMs: null,
  },
  cache: {
    primaryHit: null,
    liveHit: null,
    derivedHit: null,
    benchmarkHit: null,
    primaryHits: 0,
    primaryMisses: 0,
    liveHits: 0,
    liveMisses: 0,
    derivedHits: 0,
    derivedMisses: 0,
    benchmarkHits: 0,
    benchmarkMisses: 0,
  },
};

function recordAccountPageTiming(key: AccountPageTimingKey, startedAt: number): void {
  accountPageStreamDiagnostics.timings[key] = Math.max(0, Date.now() - startedAt);
  accountPageStreamDiagnostics.updatedAt = new Date().toISOString();
}

function recordAccountPageCache(key: AccountPageCacheKey, hit: boolean): void {
  accountPageStreamDiagnostics.cache[key] = hit;
  if (key === "primaryHit") {
    accountPageStreamDiagnostics.cache[hit ? "primaryHits" : "primaryMisses"] += 1;
  } else if (key === "liveHit") {
    accountPageStreamDiagnostics.cache[hit ? "liveHits" : "liveMisses"] += 1;
  } else if (key === "derivedHit") {
    accountPageStreamDiagnostics.cache[hit ? "derivedHits" : "derivedMisses"] += 1;
  } else {
    accountPageStreamDiagnostics.cache[hit ? "benchmarkHits" : "benchmarkMisses"] += 1;
  }
  accountPageStreamDiagnostics.updatedAt = new Date().toISOString();
}

export function recordAccountPageStreamWrite(
  kind: "primary" | "derived",
  startedAt: number,
): void {
  recordAccountPageTiming(
    kind === "primary" ? "firstPrimaryWriteMs" : "firstDerivedWriteMs",
    startedAt,
  );
}

export function getAccountPageStreamDiagnostics() {
  return {
    updatedAt: accountPageStreamDiagnostics.updatedAt,
    timings: { ...accountPageStreamDiagnostics.timings },
    cache: { ...accountPageStreamDiagnostics.cache },
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

// These response-level stamps describe fetch/build time, not a content revision.
// Summary also copies the account-fetch stamp into accounts, metrics, and fx.
const ACCOUNT_PAGE_VOLATILE_ROOT_UPDATED_AT_SECTIONS = new Set([
  "summary",
  "allocation",
  "positions",
  "orders",
  "risk",
  "performanceCalendarTrades",
  "closedTrades",
  "cashActivity",
]);
// Ages are derived from the preserved source timestamps and advance on wall clock alone.
const ACCOUNT_PAGE_VOLATILE_DERIVED_KEYS = new Set(["ageMs", "cacheAgeMs"]);
const ACCOUNT_PAGE_EQUITY_HISTORY_SECTIONS = new Set([
  "intradayEquity",
  "equityHistory",
  "benchmarkEquityHistory",
  "performanceCalendarEquity",
]);

// ponytail: full content walk is the correctness fallback until every source exposes a revision.
function sameAccountPageContent(
  left: unknown,
  right: unknown,
  depth = 0,
  ignoreUpdatedAt = false,
  rootSection: string | null = null,
  parentKey: string | null = null,
): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left instanceof Date || right instanceof Date) {
    return (
      left instanceof Date &&
      right instanceof Date &&
      Object.is(left.getTime(), right.getTime())
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (
        !sameAccountPageContent(
          left[index],
          right[index],
          depth + 1,
          false,
          rootSection,
          parentKey,
        )
      ) {
        return false;
      }
    }
    return true;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const sameVolatileLiveEquityPoint =
    rootSection !== null &&
    ACCOUNT_PAGE_EQUITY_HISTORY_SECTIONS.has(rootSection) &&
    leftRecord["source"] === "IBKR_ACCOUNT_SUMMARY" &&
    rightRecord["source"] === "IBKR_ACCOUNT_SUMMARY";
  const sameVolatileLiveEquityResponse =
    rootSection !== null &&
    ACCOUNT_PAGE_EQUITY_HISTORY_SECTIONS.has(rootSection) &&
    leftRecord["liveTerminalIncluded"] === true &&
    rightRecord["liveTerminalIncluded"] === true &&
    leftRecord["terminalPointSource"] === "live_account_summary" &&
    rightRecord["terminalPointSource"] === "live_account_summary";
  let leftKeyCount = 0;
  let rightKeyCount = 0;
  for (const key in leftRecord) {
    if (
      !Object.prototype.hasOwnProperty.call(leftRecord, key) ||
      ACCOUNT_PAGE_VOLATILE_DERIVED_KEYS.has(key) ||
      (key === "updatedAt" &&
        (depth === 0 || ignoreUpdatedAt || rootSection === "summary")) ||
      (key === "timestamp" && rootSection === "summary" && parentKey === "fx") ||
      (key === "timestamp" && sameVolatileLiveEquityPoint) ||
      ((key === "asOf" || key === "latestSnapshotAt") &&
        sameVolatileLiveEquityResponse)
    ) {
      continue;
    }
    leftKeyCount += 1;
    if (
      !Object.prototype.hasOwnProperty.call(rightRecord, key) ||
      !sameAccountPageContent(
        leftRecord[key],
        rightRecord[key],
        depth + 1,
        depth === 0 && ACCOUNT_PAGE_VOLATILE_ROOT_UPDATED_AT_SECTIONS.has(key),
        depth === 0 ? key : rootSection,
        key,
      )
    ) {
      return false;
    }
  }
  for (const key in rightRecord) {
    if (
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      !ACCOUNT_PAGE_VOLATILE_DERIVED_KEYS.has(key) &&
      !(
        key === "updatedAt" &&
        (depth === 0 || ignoreUpdatedAt || rootSection === "summary")
      ) &&
      !(key === "timestamp" && rootSection === "summary" && parentKey === "fx") &&
      !(key === "timestamp" && sameVolatileLiveEquityPoint) &&
      !(
        (key === "asOf" || key === "latestSnapshotAt") &&
        sameVolatileLiveEquityResponse
      )
    ) {
      rightKeyCount += 1;
    }
  }
  return leftKeyCount === rightKeyCount;
}

function retainAccountPagePayload<T extends { updatedAt: string }>(
  previous: T | null,
  candidate: T,
): T {
  if (previous && sameAccountPageContent(previous, candidate)) {
    return previous;
  }
  candidate.updatedAt = new Date().toISOString();
  return candidate;
}

function retainAccountPageLivePayload(
  cacheKey: string,
  candidate: AccountPageLivePayload,
  version: number,
): AccountPageLivePayload {
  const previous =
    version === accountPageSnapshotCacheVersion
      ? accountPageLiveContentCache.get(cacheKey) ?? null
      : null;
  const value = retainAccountPagePayload(previous, candidate);
  if (version === accountPageSnapshotCacheVersion) {
    accountPageLiveContentCache.delete(cacheKey);
    accountPageLiveContentCache.set(cacheKey, value);
    while (
      accountPageLiveContentCache.size >
      ACCOUNT_PAGE_LIVE_CONTENT_CACHE_MAX_ENTRIES
    ) {
      const oldest = accountPageLiveContentCache.keys().next().value;
      if (oldest === undefined) break;
      accountPageLiveContentCache.delete(oldest);
    }
  }
  return value;
}

export const __accountPageStreamInternalsForTests = {
  derivedCacheKeyForInput,
  retainAccountPagePayload,
  sameAccountPageContent,
};

function isoOrNull(value: Date | null | undefined): string | null {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value.toISOString()
    : null;
}

function normalizePositionTypeFilterValue(value: string | null | undefined): string | null {
  const filter = normalizeAccountPositionTypeFilter(value);
  if (filter.kind === "all") return null;
  if (filter.kind === "equity") return "equity";
  if (filter.kind === "single") return filter.value;
  return filter.raw.trim() || null;
}

function normalizeInput(input: AccountPageSnapshotInput): Required<AccountPageSnapshotInput> {
  return {
    accountId: input.accountId || "combined",
    appUserId: input.appUserId,
    allowDirectIbkr: input.allowDirectIbkr === true,
    mode: input.mode,
    range: input.range ?? "ALL",
    assetClass: normalizePositionTypeFilterValue(input.assetClass),
    from: input.from ?? null,
    to: input.to ?? null,
    symbol: input.symbol ?? null,
    tradeAssetClass: normalizePositionTypeFilterValue(input.tradeAssetClass),
    pnlSign: input.pnlSign ?? null,
    holdDuration: input.holdDuration ?? null,
    performanceCalendarFrom: input.performanceCalendarFrom ?? null,
    includeIntraday: input.includeIntraday === true,
    includeWorkingOrders: input.includeWorkingOrders === true,
    includeSetupHealth: input.includeSetupHealth === true,
    includeSpyBenchmark: input.includeSpyBenchmark === true,
    includeQqqBenchmark: input.includeQqqBenchmark === true,
    includeDiaBenchmark: input.includeDiaBenchmark === true,
  };
}

function derivedCacheKeyForInput(input: AccountPageSnapshotInput): string {
  const normalized = normalizeInput(input);
  return stableStringify({
    accountId: normalized.accountId,
    ...(!isShadowAccountId(normalized.accountId)
      ? { appUserId: normalized.appUserId }
      : {}),
    allowDirectIbkr: normalized.allowDirectIbkr,
    mode: normalized.mode,
    range: normalized.range,
    from: isoOrNull(normalized.from),
    to: isoOrNull(normalized.to),
    symbol: normalized.symbol,
    tradeAssetClass: normalized.tradeAssetClass,
    pnlSign: normalized.pnlSign,
    holdDuration: normalized.holdDuration,
    performanceCalendarFrom: isoOrNull(normalized.performanceCalendarFrom),
    includeSetupHealth: normalized.includeSetupHealth,
    includeSpyBenchmark: normalized.includeSpyBenchmark,
    includeQqqBenchmark: normalized.includeQqqBenchmark,
    includeDiaBenchmark: normalized.includeDiaBenchmark,
    ...shadowAccountCacheScope(normalized.accountId),
  });
}

function shadowAccountCacheScope(accountId: string) {
  const shadowAccountId = isShadowAccountId(accountId)
    ? currentShadowAccountId()
    : null;
  return {
    shadowAccountId,
    shadowLedgerGeneration: shadowAccountId
      ? getShadowAccountLedgerGeneration(shadowAccountId)
      : null,
  };
}

export function clearAccountPageSnapshotCache() {
  accountPageDerivedCache.clear();
  accountPageBenchmarkEquityCache.clear();
  accountPagePrimaryCache.clear();
  accountPagePrimaryInflight.clear();
  accountPageLiveInflight.clear();
  accountPageLiveContentCache.clear();
  accountPageDerivedInflight.clear();
  accountPageSnapshotCacheVersion += 1;
}

export async function fetchAccountPageLivePayload(
  input: AccountPageSnapshotInput,
): Promise<AccountPageLivePayload> {
  const normalized = normalizeInput(input);
  const isShadow = isShadowAccountId(normalized.accountId);
  const cacheKey = stableStringify({
    accountId: normalized.accountId,
    mode: normalized.mode,
    assetClass: normalized.assetClass,
    includeIntraday: normalized.includeIntraday,
    includeWorkingOrders: normalized.includeWorkingOrders,
    ...(isShadow
      ? {}
      : {
          appUserId: normalized.appUserId,
          allowDirectIbkr: normalized.allowDirectIbkr,
        }),
    ...shadowAccountCacheScope(normalized.accountId),
  });
  const inFlight = accountPageLiveInflight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const version = accountPageSnapshotCacheVersion;
  const startedAt = Date.now();
  const request = (async () => {
    try {
      const common = {
        accountId: normalized.accountId,
        appUserId: normalized.appUserId,
        allowDirectIbkr: normalized.allowDirectIbkr,
        mode: normalized.mode,
      };

      // For shadow accounts the live tick used to call
      // fetchAccountPagePrimaryPayload and then DISCARD it: positions, summary,
      // allocation and risk are recomputed below from the fresh `livePositions`,
      // and orders come from the separately-fetched shadow orders. That made
      // every 1s tick do a redundant second positions/ledger read plus a
      // duplicate in-memory derivation, holding extra connections of the hard
      // 12-connection pool. Fetch positions/orders/equity ONCE here and derive
      // once. The primary payload's 2s cache is still warmed by the initial
      // snapshot (routes/platform.ts). Real accounts keep consuming the primary
      // payload, whose fan-out IS used here.
      let value: AccountPageLivePayload;
      if (isShadow) {
        const [livePositions, shadowOrders, intradayEquity] = await Promise.all([
          getAccountPositions({
            ...common,
            assetClass: normalized.assetClass,
            liveQuotes: true,
          }),
          normalized.includeWorkingOrders
            ? getAccountOrders({ ...common, tab: "working" })
            : Promise.resolve(undefined),
          normalized.includeIntraday
            ? getAccountEquityHistory({ ...common, range: "1D" })
            : Promise.resolve(undefined),
        ]);
        const shadowPositions =
          livePositions as NonNullable<ShadowRiskInput["positionsResponse"]>;
        const [summary, allocation, risk] = await Promise.all([
          getShadowAccountSummaryFromPositions({
            positionsResponse: shadowPositions,
            equityHistory: intradayEquity,
          }),
          Promise.resolve(
            getShadowAccountAllocationFromPositions({
              positionsResponse: shadowPositions,
            }),
          ),
          getShadowAccountRisk({
            positionsResponse: shadowPositions,
            detail: "fast",
          }),
        ]);
        value = {
          stream: "account-page-live",
          accountId: normalized.accountId,
          mode: normalized.mode,
          assetClass: normalized.assetClass,
          updatedAt: "",
          summary,
          ...(intradayEquity ? { intradayEquity } : {}),
          allocation,
          positions: livePositions,
          ...(shadowOrders ? { orders: shadowOrders } : {}),
          risk,
        };
      } else {
        const [primary, intradayEquity] = await Promise.all([
          fetchAccountPagePrimaryPayload(normalized),
          normalized.includeIntraday
            ? getAccountEquityHistory({ ...common, range: "1D" })
            : Promise.resolve(undefined),
        ]);
        value = {
          stream: "account-page-live",
          accountId: normalized.accountId,
          mode: normalized.mode,
          assetClass: normalized.assetClass,
          updatedAt: "",
          summary: primary.summary,
          ...(intradayEquity ? { intradayEquity } : {}),
          allocation: primary.allocation,
          positions: primary.positions,
          ...(primary.orders ? { orders: primary.orders } : {}),
          risk: primary.risk,
        };
      }
      return retainAccountPageLivePayload(cacheKey, value, version);
    } finally {
      recordAccountPageTiming("liveMs", startedAt);
    }
  })();

  accountPageLiveInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (accountPageLiveInflight.get(cacheKey) === request) {
      accountPageLiveInflight.delete(cacheKey);
    }
  }
}

export async function fetchAccountPagePrimaryPayload(
  input: AccountPageSnapshotInput,
): Promise<AccountPagePrimaryPayload> {
  const normalized = normalizeInput(input);
  const isShadow = isShadowAccountId(normalized.accountId);
  const cacheKey = stableStringify({
    accountId: normalized.accountId,
    mode: normalized.mode,
    assetClass: normalized.assetClass,
    includeWorkingOrders: normalized.includeWorkingOrders,
    ...(isShadow
      ? {}
      : {
          appUserId: normalized.appUserId,
          allowDirectIbkr: normalized.allowDirectIbkr,
        }),
    ...shadowAccountCacheScope(normalized.accountId),
  });
  const now = Date.now();
  const cached = accountPagePrimaryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    recordAccountPageCache("primaryHit", true);
    recordAccountPageTiming("primaryMs", now);
    return cached.value;
  }
  if (cached) {
    accountPagePrimaryCache.delete(cacheKey);
  }
  recordAccountPageCache("primaryHit", false);

  const inFlight = accountPagePrimaryInflight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const version = accountPageSnapshotCacheVersion;
  const startedAt = Date.now();
  const request = (async () => {
    try {
      const common = {
        accountId: normalized.accountId,
        appUserId: normalized.appUserId,
        allowDirectIbkr: normalized.allowDirectIbkr,
        mode: normalized.mode,
      };
      let summary: AccountPagePrimaryPayload["summary"];
      let allocation: AccountPagePrimaryPayload["allocation"];
      let positions: AccountPagePrimaryPayload["positions"];
      let orders: AccountPagePrimaryPayload["orders"];
      let risk: AccountPagePrimaryPayload["risk"];

      if (isShadow) {
        const [shadowPositions, shadowOrders] = await Promise.all([
          getAccountPositions({
            ...common,
            assetClass: normalized.assetClass,
            liveQuotes: true,
          }),
          normalized.includeWorkingOrders
            ? getAccountOrders({ ...common, tab: "working" })
            : Promise.resolve(undefined),
        ]);
        positions = shadowPositions;
        orders = shadowOrders;
        [summary, allocation, risk] = await Promise.all([
          getShadowAccountSummaryFromPositions({
            positionsResponse:
              shadowPositions as NonNullable<ShadowRiskInput["positionsResponse"]>,
          }),
          Promise.resolve(
            getShadowAccountAllocationFromPositions({
              positionsResponse:
                shadowPositions as NonNullable<ShadowRiskInput["positionsResponse"]>,
            }),
          ),
          getShadowAccountRisk({
            positionsResponse:
              shadowPositions as NonNullable<ShadowRiskInput["positionsResponse"]>,
            detail: "fast",
          }),
        ]);
      } else {
        [summary, allocation, positions, orders] = await Promise.all([
          getAccountSummary(common),
          getAccountAllocation(common),
          getAccountPositions({
            ...common,
            assetClass: normalized.assetClass,
            detail: "fast",
            liveQuotes: false,
          }),
          normalized.includeWorkingOrders
            ? getAccountOrders({ ...common, tab: "working" })
            : Promise.resolve(undefined),
        ]);
        risk = await getAccountRisk({ ...common, detail: "fast" });
      }

      const value: AccountPagePrimaryPayload = {
        stream: "account-page-primary",
        accountId: normalized.accountId,
        mode: normalized.mode,
        assetClass: normalized.assetClass,
        updatedAt: new Date().toISOString(),
        summary,
        allocation,
        positions,
        ...(orders ? { orders } : {}),
        risk,
      };
      if (version === accountPageSnapshotCacheVersion) {
        accountPagePrimaryCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + ACCOUNT_PAGE_PRIMARY_CACHE_TTL_MS,
        });
      }
      return value;
    } finally {
      recordAccountPageTiming("primaryMs", startedAt);
    }
  })();

  accountPagePrimaryInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (accountPagePrimaryInflight.get(cacheKey) === request) {
      accountPagePrimaryInflight.delete(cacheKey);
    }
  }
}

async function fetchAccountPageBenchmarkEquityHistory(input: {
  accountId: string;
  appUserId: string;
  allowDirectIbkr: boolean;
  mode: RuntimeMode;
  range?: AccountRange;
  benchmark: BenchmarkSymbol;
  version: number;
}): Promise<Awaited<ReturnType<typeof getAccountEquityHistory>>> {
  const cacheKey = stableStringify({
    accountId: input.accountId,
    mode: input.mode,
    range: input.range ?? null,
    benchmark: input.benchmark,
    ...(isShadowAccountId(input.accountId)
      ? {}
      : {
          appUserId: input.appUserId,
          allowDirectIbkr: input.allowDirectIbkr,
        }),
    ...shadowAccountCacheScope(input.accountId),
  });
  const cached = accountPageBenchmarkEquityCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    recordAccountPageCache("benchmarkHit", true);
    return cached.value;
  }
  recordAccountPageCache("benchmarkHit", false);

  const value = await getAccountEquityHistory({
    accountId: input.accountId,
    appUserId: input.appUserId,
    allowDirectIbkr: input.allowDirectIbkr,
    mode: input.mode,
    range: input.range,
    benchmark: input.benchmark,
  });
  if (input.version === accountPageSnapshotCacheVersion) {
    accountPageBenchmarkEquityCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + ACCOUNT_PAGE_BENCHMARK_EQUITY_CACHE_TTL_MS,
    });
  }
  return value;
}

export async function fetchAccountPageDerivedPayload(
  input: AccountPageSnapshotInput,
): Promise<AccountPageDerivedPayload> {
  const normalized = normalizeInput(input);
  const cacheKey = derivedCacheKeyForInput(normalized);
  const cached = accountPageDerivedCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    recordAccountPageCache("derivedHit", true);
    recordAccountPageTiming("derivedMs", now);
    return cached.value;
  }
  recordAccountPageCache("derivedHit", false);
  const inFlight = accountPageDerivedInflight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const version = accountPageSnapshotCacheVersion;
  const startedAt = Date.now();
  const request = (async () => {
    try {
      const common = {
        accountId: normalized.accountId,
        appUserId: normalized.appUserId,
        allowDirectIbkr: normalized.allowDirectIbkr,
        mode: normalized.mode,
      };
      const closedTradeInput = {
        ...common,
        from: normalized.from,
        to: normalized.to,
        symbol: normalized.symbol,
        assetClass: normalized.tradeAssetClass,
        pnlSign: normalized.pnlSign,
        holdDuration: normalized.holdDuration,
      };
      const benchmarkSymbols: BenchmarkSymbol[] = [
        ...(normalized.includeSpyBenchmark ? (["SPY"] as const) : []),
        ...(normalized.includeQqqBenchmark ? (["QQQ"] as const) : []),
        ...(normalized.includeDiaBenchmark ? (["DIA"] as const) : []),
      ];
      let equityHistory: AccountPageDerivedPayload["equityHistory"];
      let benchmarkRows: AccountPagePayloadData["equityHistory"][];
      let performanceCalendarEquity: AccountPageDerivedPayload["performanceCalendarEquity"];
      let performanceCalendarTrades: AccountPageDerivedPayload["performanceCalendarTrades"];
      let closedTrades: AccountPageDerivedPayload["closedTrades"];
      let cashActivity: AccountPageDerivedPayload["cashActivity"];
      let flexHealth: AccountPageDerivedPayload["flexHealth"];
      const isShadow = isShadowAccountId(normalized.accountId);

      if (isShadow) {
        equityHistory = await getAccountEquityHistory({ ...common, range: normalized.range });
        benchmarkRows = [];
        for (const benchmark of benchmarkSymbols) {
          benchmarkRows.push(
            await fetchAccountPageBenchmarkEquityHistory({
              ...common,
              range: normalized.range,
              benchmark,
              version,
            }),
          );
        }
        performanceCalendarEquity = await getAccountEquityHistory({
          ...common,
          range: "1Y",
        });
        performanceCalendarTrades = await getAccountClosedTrades({
          ...common,
          from: normalized.performanceCalendarFrom,
        });
        closedTrades = await getAccountClosedTrades(closedTradeInput);
        cashActivity = await getAccountCashActivity(common);
        flexHealth = normalized.includeSetupHealth ? null : undefined;
      } else {
        [
          equityHistory,
          benchmarkRows,
          performanceCalendarEquity,
          performanceCalendarTrades,
          closedTrades,
          cashActivity,
          flexHealth,
        ] = await Promise.all([
          getAccountEquityHistory({ ...common, range: normalized.range }),
          Promise.all(
            benchmarkSymbols.map((benchmark) =>
              fetchAccountPageBenchmarkEquityHistory({
                ...common,
                range: normalized.range,
                benchmark,
                version,
              }),
            ),
          ),
          getAccountEquityHistory({ ...common, range: "1Y" }),
          getAccountClosedTrades({
            ...common,
            from: normalized.performanceCalendarFrom,
          }),
          getAccountClosedTrades(closedTradeInput),
          getAccountCashActivity(common),
          normalized.includeSetupHealth
            ? getFlexHealth()
            : Promise.resolve(undefined),
        ]);
      }

      const candidate: AccountPageDerivedPayload = {
        stream: "account-page-derived",
        accountId: normalized.accountId,
        mode: normalized.mode,
        range: normalized.range,
        tradeFilters: {
          from: isoOrNull(normalized.from),
          to: isoOrNull(normalized.to),
          symbol: normalized.symbol,
          assetClass: normalized.tradeAssetClass,
          pnlSign: normalized.pnlSign,
          holdDuration: normalized.holdDuration,
        },
        performanceCalendarFrom: isoOrNull(normalized.performanceCalendarFrom),
        updatedAt: "",
        equityHistory,
        benchmarkEquityHistory: Object.fromEntries(
          benchmarkSymbols.map((benchmark, index) => [benchmark, benchmarkRows[index]]),
        ),
        performanceCalendarEquity,
        performanceCalendarTrades,
        closedTrades,
        cashActivity,
        ...(flexHealth !== undefined ? { flexHealth } : {}),
      };
      const value = retainAccountPagePayload(
        version === accountPageSnapshotCacheVersion ? cached?.value ?? null : null,
        candidate,
      );
      if (version === accountPageSnapshotCacheVersion) {
        accountPageDerivedCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + ACCOUNT_PAGE_DERIVED_STREAM_INTERVAL_MS,
        });
      }
      return value;
    } finally {
      recordAccountPageTiming("derivedMs", startedAt);
    }
  })();

  accountPageDerivedInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (accountPageDerivedInflight.get(cacheKey) === request) {
      accountPageDerivedInflight.delete(cacheKey);
    }
  }
}

export function subscribeAccountPageSnapshots(
  input: AccountPageSnapshotInput,
  onLive: (payload: AccountPageLivePayload) => void,
  onDerived: (payload: AccountPageDerivedPayload) => void,
  options: {
    initialLivePayload?: AccountPageLivePayload;
    initialDerivedPayload?: AccountPageDerivedPayload;
    initialLiveDelayMs?: number;
    initialDerivedDelayMs?: number;
    fetchLivePayload?: typeof fetchAccountPageLivePayload;
    fetchDerivedPayload?: typeof fetchAccountPageDerivedPayload;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
    onPollSuccess?: (input: {
      payload: AccountPageLivePayload | AccountPageDerivedPayload;
      kind: "live" | "derived";
      changed: boolean;
    }) => void | Promise<void>;
  } = {},
): Unsubscribe {
  const shadowAccountId = isShadowAccountId(input.accountId)
    ? currentShadowAccountId()
    : null;
  const postgresDiagnosticContext = getPostgresDiagnosticContext();
  const dbLane = currentDbLane();
  const runInSubscriberContext = <T>(fn: () => T): T => {
    const run = () => runInDbLane(dbLane, fn);
    return postgresDiagnosticContext
      ? runWithPostgresDiagnosticContext(postgresDiagnosticContext, run)
      : run();
  };
  let active = true;
  let liveInFlight = false;
  let derivedInFlight = false;
  let lastLivePayload = options.initialLivePayload ?? null;
  let lastDerivedPayload = options.initialDerivedPayload ?? null;
  const fetchLivePayload = options.fetchLivePayload ?? fetchAccountPageLivePayload;
  const fetchDerivedPayload =
    options.fetchDerivedPayload ?? fetchAccountPageDerivedPayload;
  const setPollTimeout = options.setTimeout ?? setTimeout;
  const clearPollTimeout = options.clearTimeout ?? clearTimeout;
  let liveTimer: ReturnType<typeof setTimeout> | null = null;
  let derivedTimer: ReturnType<typeof setTimeout> | null = null;

  const tickLive = async () => {
    if (!active || liveInFlight) {
      return;
    }
    liveInFlight = true;
    const snapshotGeneration = shadowAccountId
      ? getShadowAccountSnapshotGeneration(shadowAccountId)
      : null;
    try {
      const snapshot = await (shadowAccountId
        ? runWithShadowAccountId(shadowAccountId, () =>
            fetchLivePayload(input),
          )
        : fetchLivePayload(input));
      if (
        !active ||
        (shadowAccountId &&
          snapshotGeneration !==
            getShadowAccountSnapshotGeneration(shadowAccountId))
      ) {
        return;
      }
      const changed = snapshot !== lastLivePayload;
      if (changed) {
        lastLivePayload = snapshot;
        onLive(snapshot);
      }
      await options.onPollSuccess?.({ payload: snapshot, kind: "live", changed });
    } catch (error) {
      logger.warn({ err: error }, "Account page live stream polling failed");
    } finally {
      liveInFlight = false;
      if (active) {
        liveTimer = setPollTimeout(() => {
          liveTimer = null;
          void runInSubscriberContext(tickLive);
        }, ACCOUNT_PAGE_STREAM_INTERVAL_MS);
        liveTimer.unref?.();
      }
    }
  };

  const tickDerived = async () => {
    if (!active || derivedInFlight) {
      return;
    }
    derivedInFlight = true;
    const snapshotGeneration = shadowAccountId
      ? getShadowAccountSnapshotGeneration(shadowAccountId)
      : null;
    try {
      const snapshot = await (shadowAccountId
        ? runWithShadowAccountId(shadowAccountId, () =>
            fetchDerivedPayload(input),
          )
        : fetchDerivedPayload(input));
      if (
        !active ||
        (shadowAccountId &&
          snapshotGeneration !==
            getShadowAccountSnapshotGeneration(shadowAccountId))
      ) {
        return;
      }
      const changed = snapshot !== lastDerivedPayload;
      if (changed) {
        lastDerivedPayload = snapshot;
        onDerived(snapshot);
      }
      await options.onPollSuccess?.({ payload: snapshot, kind: "derived", changed });
    } catch (error) {
      logger.warn({ err: error }, "Account page derived stream polling failed");
    } finally {
      derivedInFlight = false;
      if (active) {
        derivedTimer = setPollTimeout(() => {
          derivedTimer = null;
          void runInSubscriberContext(tickDerived);
        }, ACCOUNT_PAGE_DERIVED_STREAM_INTERVAL_MS);
        derivedTimer.unref?.();
      }
    }
  };

  const liveDelay = Math.max(0, options.initialLiveDelayMs ?? 0);
  const derivedDelay = Math.max(0, options.initialDerivedDelayMs ?? 0);
  liveTimer = setPollTimeout(() => {
    liveTimer = null;
    void runInSubscriberContext(tickLive);
  }, liveDelay);
  liveTimer.unref?.();
  derivedTimer = setPollTimeout(() => {
    derivedTimer = null;
    void runInSubscriberContext(tickDerived);
  }, derivedDelay);
  derivedTimer.unref?.();

  const unsubscribeShadowChanges = isShadowAccountId(input.accountId)
    ? subscribeShadowAccountChanges((change) => {
        if (
          change.reason === "mark_refresh" ||
          change.accountId !== shadowAccountId
        ) {
          return;
        }
        if (liveTimer) {
          clearPollTimeout(liveTimer);
          liveTimer = null;
        }
        if (derivedTimer) {
          clearPollTimeout(derivedTimer);
          derivedTimer = null;
        }
        void runInSubscriberContext(tickLive);
        void runInSubscriberContext(tickDerived);
      })
    : () => undefined;

  return () => {
    active = false;
    if (liveTimer) {
      clearPollTimeout(liveTimer);
    }
    if (derivedTimer) {
      clearPollTimeout(derivedTimer);
    }
    unsubscribeShadowChanges();
  };
}
