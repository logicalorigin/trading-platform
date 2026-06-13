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
import { subscribeShadowAccountChanges } from "./shadow-account-events";
import { invalidateShadowAccountSnapshotBaseCache } from "./shadow-account-streams";
import { normalizeAccountPositionTypeFilter } from "./account-position-type";

type Unsubscribe = () => void;
type OrderTab = "working" | "history";
type BenchmarkSymbol = "SPY" | "QQQ" | "DIA";
type ShadowRiskInput = NonNullable<Parameters<typeof getShadowAccountRisk>[0]>;
type ShadowClosedTradesInput = NonNullable<ShadowRiskInput["closedTrades"]>;
type AccountOrdersPayload = Awaited<ReturnType<typeof getAccountOrders>>;

export const ACCOUNT_PAGE_STREAM_INTERVAL_MS = 1_000;
export const ACCOUNT_PAGE_DERIVED_STREAM_INTERVAL_MS = 30_000;
export const ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS = 0;
export const ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS = 0;
export const ACCOUNT_PAGE_BENCHMARK_EQUITY_CACHE_TTL_MS = 5 * 60_000;
export const ACCOUNT_PAGE_SHADOW_PRIMARY_CACHE_TTL_MS = 2_000;

type AccountPageSnapshotInput = {
  accountId: string;
  mode: RuntimeMode;
  range?: AccountRange;
  orderTab?: OrderTab;
  assetClass?: string | null;
  from?: Date | null;
  to?: Date | null;
  symbol?: string | null;
  tradeAssetClass?: string | null;
  pnlSign?: string | null;
  holdDuration?: string | null;
  performanceCalendarFrom?: Date | null;
};

export type AccountPageSnapshotPayload = {
  stream: "account-page-bootstrap";
  accountId: string;
  mode: RuntimeMode;
  range?: AccountRange;
  orderTab: OrderTab;
  assetClass: string | null;
  tradeFilters: {
    from: string | null;
    to: string | null;
    symbol: string | null;
    assetClass: string | null;
    pnlSign: string | null;
    holdDuration: string | null;
  };
  performanceCalendarFrom: string | null;
  updatedAt: string;
  summary: Awaited<ReturnType<typeof getAccountSummary>>;
  equityHistory: Awaited<ReturnType<typeof getAccountEquityHistory>>;
  intradayEquity: Awaited<ReturnType<typeof getAccountEquityHistory>>;
  benchmarkEquityHistory: Record<
    BenchmarkSymbol,
    Awaited<ReturnType<typeof getAccountEquityHistory>>
  >;
  performanceCalendarEquity: Awaited<ReturnType<typeof getAccountEquityHistory>>;
  performanceCalendarTrades: Awaited<ReturnType<typeof getAccountClosedTrades>>;
  allocation: Awaited<ReturnType<typeof getAccountAllocation>>;
  positions: Awaited<ReturnType<typeof getAccountPositions>>;
  closedTrades: Awaited<ReturnType<typeof getAccountClosedTrades>>;
  orders: Awaited<ReturnType<typeof getAccountOrders>>;
  risk: Awaited<ReturnType<typeof getAccountRisk>>;
  cashActivity: Awaited<ReturnType<typeof getAccountCashActivity>>;
  flexHealth: Awaited<ReturnType<typeof getFlexHealth>> | null;
};

export type AccountPagePrimaryPayload = {
  stream: "account-page-primary";
  accountId: string;
  mode: RuntimeMode;
  orderTab: OrderTab;
  assetClass: string | null;
  updatedAt: string;
  summary: AccountPageSnapshotPayload["summary"];
  allocation: AccountPageSnapshotPayload["allocation"];
  positions: AccountPageSnapshotPayload["positions"];
  orders: AccountPageSnapshotPayload["orders"];
  risk: AccountPageSnapshotPayload["risk"];
};

export type AccountPageLivePayload = {
  stream: "account-page-live";
  accountId: string;
  mode: RuntimeMode;
  orderTab: OrderTab;
  assetClass: string | null;
  updatedAt: string;
  summary: AccountPageSnapshotPayload["summary"];
  intradayEquity: AccountPageSnapshotPayload["intradayEquity"];
  allocation: AccountPageSnapshotPayload["allocation"];
  positions: AccountPageSnapshotPayload["positions"];
  orders: AccountPageSnapshotPayload["orders"];
  risk: AccountPageSnapshotPayload["risk"];
};

export type AccountPageDerivedPayload = {
  stream: "account-page-derived";
  accountId: string;
  mode: RuntimeMode;
  range?: AccountRange;
  tradeFilters: AccountPageSnapshotPayload["tradeFilters"];
  performanceCalendarFrom: string | null;
  updatedAt: string;
  equityHistory: AccountPageSnapshotPayload["equityHistory"];
  benchmarkEquityHistory: AccountPageSnapshotPayload["benchmarkEquityHistory"];
  performanceCalendarEquity: AccountPageSnapshotPayload["performanceCalendarEquity"];
  performanceCalendarTrades: AccountPageSnapshotPayload["performanceCalendarTrades"];
  closedTrades: AccountPageSnapshotPayload["closedTrades"];
  cashActivity: AccountPageSnapshotPayload["cashActivity"];
  flexHealth: AccountPageSnapshotPayload["flexHealth"];
};

const accountPageSnapshotInflight = new Map<
  string,
  Promise<AccountPageSnapshotPayload>
>();
const accountPagePrimaryInflight = new Map<
  string,
  Promise<AccountPagePrimaryPayload>
>();
const accountPageLiveInflight = new Map<
  string,
  Promise<AccountPageLivePayload>
>();
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
const accountPageShadowPrimaryCache = new Map<
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
    mode: input.mode,
    range: input.range ?? "ALL",
    orderTab: input.orderTab ?? "working",
    assetClass: normalizePositionTypeFilterValue(input.assetClass),
    from: input.from ?? null,
    to: input.to ?? null,
    symbol: input.symbol ?? null,
    tradeAssetClass: normalizePositionTypeFilterValue(input.tradeAssetClass),
    pnlSign: input.pnlSign ?? null,
    holdDuration: input.holdDuration ?? null,
    performanceCalendarFrom: input.performanceCalendarFrom ?? null,
  };
}

function deferredShadowClosedTrades(accountId: string): ShadowClosedTradesInput {
  return {
    accountId,
    currency: "USD",
    degraded: false,
    reason: null,
    trades: [],
    summary: {
      count: 0,
      winners: 0,
      losers: 0,
      realizedPnl: 0,
      commissions: 0,
    },
    updatedAt: new Date(),
  };
}

function deferredShadowOrders(accountId: string, tab: OrderTab): AccountOrdersPayload {
  return {
    accountId,
    tab,
    currency: "USD",
    degraded: false,
    reason: "Shadow orders deferred until live account-page refresh.",
    stale: true,
    debug: null,
    orders: [],
    updatedAt: new Date(),
  };
}

function cacheKeyForInput(input: AccountPageSnapshotInput): string {
  const normalized = normalizeInput(input);
  return stableStringify({
    ...normalized,
    from: isoOrNull(normalized.from),
    to: isoOrNull(normalized.to),
    performanceCalendarFrom: isoOrNull(normalized.performanceCalendarFrom),
  });
}

export function clearAccountPageSnapshotCache() {
  accountPageDerivedCache.clear();
  accountPageBenchmarkEquityCache.clear();
  accountPageShadowPrimaryCache.clear();
  accountPageSnapshotInflight.clear();
  accountPagePrimaryInflight.clear();
  accountPageLiveInflight.clear();
  accountPageDerivedInflight.clear();
  accountPageSnapshotCacheVersion += 1;
}

function livePayloadFromBootstrap(
  payload: AccountPageSnapshotPayload,
): AccountPageLivePayload {
  return {
    stream: "account-page-live",
    accountId: payload.accountId,
    mode: payload.mode,
    orderTab: payload.orderTab,
    assetClass: payload.assetClass,
    updatedAt: payload.updatedAt,
    summary: payload.summary,
    intradayEquity: payload.intradayEquity,
    allocation: payload.allocation,
    positions: payload.positions,
    orders: payload.orders,
    risk: payload.risk,
  };
}

function derivedPayloadFromBootstrap(
  payload: AccountPageSnapshotPayload,
): AccountPageDerivedPayload {
  return {
    stream: "account-page-derived",
    accountId: payload.accountId,
    mode: payload.mode,
    range: payload.range,
    tradeFilters: payload.tradeFilters,
    performanceCalendarFrom: payload.performanceCalendarFrom,
    updatedAt: payload.updatedAt,
    equityHistory: payload.equityHistory,
    benchmarkEquityHistory: payload.benchmarkEquityHistory,
    performanceCalendarEquity: payload.performanceCalendarEquity,
    performanceCalendarTrades: payload.performanceCalendarTrades,
    closedTrades: payload.closedTrades,
    cashActivity: payload.cashActivity,
    flexHealth: payload.flexHealth,
  };
}

export async function fetchAccountPageLivePayload(
  input: AccountPageSnapshotInput,
): Promise<AccountPageLivePayload> {
  const normalized = normalizeInput(input);
  const cacheKey = stableStringify({
    accountId: normalized.accountId,
    mode: normalized.mode,
    orderTab: normalized.orderTab,
    assetClass: normalized.assetClass,
  });
  const inFlight = accountPageLiveInflight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const startedAt = Date.now();
  const request = (async () => {
    try {
      const common = {
        accountId: normalized.accountId,
        mode: normalized.mode,
      };
      const isShadow = isShadowAccountId(normalized.accountId);
      const [primary, intradayEquity, shadowOrders, livePositions] = await Promise.all([
        fetchAccountPagePrimaryPayload(normalized),
        getAccountEquityHistory({ ...common, range: "1D" }),
        isShadow
          ? getAccountOrders({ ...common, tab: normalized.orderTab })
          : Promise.resolve(null),
        isShadow
          ? getAccountPositions({
              ...common,
              assetClass: normalized.assetClass,
              liveQuotes: true,
            })
          : Promise.resolve(null),
      ]);
      const positions = livePositions ?? primary.positions;
      const [summary, allocation, risk] =
        isShadow && livePositions
          ? await Promise.all([
              getShadowAccountSummaryFromPositions({
                positionsResponse:
                  livePositions as NonNullable<ShadowRiskInput["positionsResponse"]>,
              }),
              Promise.resolve(
                getShadowAccountAllocationFromPositions({
                  positionsResponse:
                    livePositions as NonNullable<ShadowRiskInput["positionsResponse"]>,
                }),
              ),
              getShadowAccountRisk({
                positionsResponse:
                  livePositions as NonNullable<ShadowRiskInput["positionsResponse"]>,
                closedTrades: deferredShadowClosedTrades(normalized.accountId),
                detail: "fast",
              }),
            ])
          : [primary.summary, primary.allocation, primary.risk];

      const value: AccountPageLivePayload = {
        stream: "account-page-live",
        accountId: normalized.accountId,
        mode: normalized.mode,
        orderTab: normalized.orderTab,
        assetClass: normalized.assetClass,
        updatedAt: new Date().toISOString(),
        summary,
        intradayEquity,
        allocation,
        positions,
        orders: shadowOrders ?? primary.orders,
        risk,
      };
      return value;
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
    orderTab: normalized.orderTab,
    assetClass: normalized.assetClass,
  });
  const now = Date.now();
  if (isShadow) {
    const cached = accountPageShadowPrimaryCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      recordAccountPageCache("primaryHit", true);
      recordAccountPageTiming("primaryMs", now);
      return cached.value;
    }
    if (cached) {
      accountPageShadowPrimaryCache.delete(cacheKey);
    }
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
        mode: normalized.mode,
      };
      let summary: AccountPagePrimaryPayload["summary"];
      let allocation: AccountPagePrimaryPayload["allocation"];
      let positions: AccountPagePrimaryPayload["positions"];
      let orders: AccountPagePrimaryPayload["orders"];
      let risk: AccountPagePrimaryPayload["risk"];

      if (isShadow) {
        const shadowPositions = await getAccountPositions({
          ...common,
          assetClass: normalized.assetClass,
          liveQuotes: true,
        });
        positions = shadowPositions;
        orders = deferredShadowOrders(normalized.accountId, normalized.orderTab);
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
            closedTrades: deferredShadowClosedTrades(normalized.accountId),
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
          getAccountOrders({ ...common, tab: normalized.orderTab }),
        ]);
        risk = await getAccountRisk({ ...common, detail: "fast" });
      }

      const value: AccountPagePrimaryPayload = {
        stream: "account-page-primary",
        accountId: normalized.accountId,
        mode: normalized.mode,
        orderTab: normalized.orderTab,
        assetClass: normalized.assetClass,
        updatedAt: new Date().toISOString(),
        summary,
        allocation,
        positions,
        orders,
        risk,
      };
      if (isShadow && version === accountPageSnapshotCacheVersion) {
        accountPageShadowPrimaryCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + ACCOUNT_PAGE_SHADOW_PRIMARY_CACHE_TTL_MS,
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
  const cacheKey = cacheKeyForInput(normalized);
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
      const benchmarkSymbols: BenchmarkSymbol[] = ["SPY", "QQQ", "DIA"];
      let equityHistory: AccountPageDerivedPayload["equityHistory"];
      let benchmarkRows: AccountPageDerivedPayload["benchmarkEquityHistory"][BenchmarkSymbol][];
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
        flexHealth = null;
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
          getFlexHealth(),
        ]);
      }

      const value: AccountPageDerivedPayload = {
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
        updatedAt: new Date().toISOString(),
        equityHistory,
        benchmarkEquityHistory: {
          SPY: benchmarkRows[0]!,
          QQQ: benchmarkRows[1]!,
          DIA: benchmarkRows[2]!,
        },
        performanceCalendarEquity,
        performanceCalendarTrades,
        closedTrades,
        cashActivity,
        flexHealth,
      };
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

export async function fetchAccountPageSnapshotPayload(
  input: AccountPageSnapshotInput,
): Promise<AccountPageSnapshotPayload> {
  const normalized = normalizeInput(input);
  const cacheKey = cacheKeyForInput(normalized);
  const inFlight = accountPageSnapshotInflight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    let live: AccountPageLivePayload;
    let derived: AccountPageDerivedPayload;
    if (isShadowAccountId(normalized.accountId)) {
      live = await fetchAccountPageLivePayload(normalized);
      derived = await fetchAccountPageDerivedPayload(normalized);
    } else {
      [live, derived] = await Promise.all([
        fetchAccountPageLivePayload(normalized),
        fetchAccountPageDerivedPayload(normalized),
      ]);
    }
    const value: AccountPageSnapshotPayload = {
      stream: "account-page-bootstrap",
      accountId: normalized.accountId,
      mode: normalized.mode,
      range: normalized.range,
      orderTab: normalized.orderTab,
      assetClass: normalized.assetClass,
      tradeFilters: derived.tradeFilters,
      performanceCalendarFrom: derived.performanceCalendarFrom,
      updatedAt: new Date().toISOString(),
      summary: live.summary,
      equityHistory: derived.equityHistory,
      intradayEquity: live.intradayEquity,
      benchmarkEquityHistory: derived.benchmarkEquityHistory,
      performanceCalendarEquity: derived.performanceCalendarEquity,
      performanceCalendarTrades: derived.performanceCalendarTrades,
      allocation: live.allocation,
      positions: live.positions,
      closedTrades: derived.closedTrades,
      orders: live.orders,
      risk: live.risk,
      cashActivity: derived.cashActivity,
      flexHealth: derived.flexHealth,
    };
    return value;
  })();

  accountPageSnapshotInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (accountPageSnapshotInflight.get(cacheKey) === request) {
      accountPageSnapshotInflight.delete(cacheKey);
    }
  }
}

export function subscribeAccountPageSnapshots(
  input: AccountPageSnapshotInput,
  onLive: (payload: AccountPageLivePayload) => void,
  onDerived: (payload: AccountPageDerivedPayload) => void,
  options: {
    initialPayload?: AccountPageSnapshotPayload;
    initialPrimaryPayload?: AccountPagePrimaryPayload;
    initialLivePayload?: AccountPageLivePayload;
    initialDerivedPayload?: AccountPageDerivedPayload;
    initialLiveDelayMs?: number;
    initialDerivedDelayMs?: number;
    onPollSuccess?: (input: {
      payload: AccountPageLivePayload | AccountPageDerivedPayload;
      kind: "live" | "derived";
      changed: boolean;
    }) => void | Promise<void>;
  } = {},
): Unsubscribe {
  let active = true;
  let liveInFlight = false;
  let derivedInFlight = false;
  let queued = false;
  let lastLiveSignature = options.initialPayload
    ? stableStringify(livePayloadFromBootstrap(options.initialPayload))
    : options.initialLivePayload
      ? stableStringify(options.initialLivePayload)
    : "";
  let lastDerivedSignature = options.initialPayload
    ? stableStringify(derivedPayloadFromBootstrap(options.initialPayload))
    : options.initialDerivedPayload
      ? stableStringify(options.initialDerivedPayload)
    : "";

  const tickLive = async () => {
    if (!active || liveInFlight) {
      if (liveInFlight) {
        queued = true;
      }
      return;
    }
    liveInFlight = true;
    try {
      do {
        queued = false;
        const snapshot = await fetchAccountPageLivePayload(input);
        if (!active) {
          return;
        }
        const signature = stableStringify(snapshot);
        const changed = signature !== lastLiveSignature;
        if (changed) {
          lastLiveSignature = signature;
          onLive(snapshot);
        }
        await options.onPollSuccess?.({ payload: snapshot, kind: "live", changed });
      } while (active && queued);
    } catch (error) {
      logger.warn({ err: error }, "Account page live stream polling failed");
    } finally {
      liveInFlight = false;
    }
  };

  const tickDerived = async () => {
    if (!active || derivedInFlight) {
      return;
    }
    derivedInFlight = true;
    try {
      const snapshot = await fetchAccountPageDerivedPayload(input);
      if (!active) {
        return;
      }
      const signature = stableStringify(snapshot);
      const changed = signature !== lastDerivedSignature;
      if (changed) {
        lastDerivedSignature = signature;
        onDerived(snapshot);
      }
      await options.onPollSuccess?.({ payload: snapshot, kind: "derived", changed });
    } catch (error) {
      logger.warn({ err: error }, "Account page derived stream polling failed");
    } finally {
      derivedInFlight = false;
    }
  };

  let liveTimer: ReturnType<typeof setInterval> | null = null;
  let derivedTimer: ReturnType<typeof setInterval> | null = null;
  const liveDelay = Math.max(0, options.initialLiveDelayMs ?? 0);
  const derivedDelay = Math.max(0, options.initialDerivedDelayMs ?? 0);
  const firstLiveTimer = setTimeout(() => {
    void tickLive();
    liveTimer = setInterval(() => {
      void tickLive();
    }, ACCOUNT_PAGE_STREAM_INTERVAL_MS);
    liveTimer.unref?.();
  }, liveDelay);
  firstLiveTimer.unref?.();
  const firstDerivedTimer = setTimeout(() => {
    void tickDerived();
    derivedTimer = setInterval(() => {
      void tickDerived();
    }, ACCOUNT_PAGE_DERIVED_STREAM_INTERVAL_MS);
    derivedTimer.unref?.();
  }, derivedDelay);
  firstDerivedTimer.unref?.();

  const unsubscribeShadowChanges = isShadowAccountId(input.accountId)
    ? subscribeShadowAccountChanges((change) => {
        if (change.reason === "mark_refresh") {
          return;
        }
        clearAccountPageSnapshotCache();
        invalidateShadowAccountSnapshotBaseCache();
        void tickLive();
        void tickDerived();
      })
    : () => undefined;

  return () => {
    active = false;
    clearTimeout(firstLiveTimer);
    clearTimeout(firstDerivedTimer);
    if (liveTimer) {
      clearInterval(liveTimer);
    }
    if (derivedTimer) {
      clearInterval(derivedTimer);
    }
    unsubscribeShadowChanges();
  };
}
