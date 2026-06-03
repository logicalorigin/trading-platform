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
export const ACCOUNT_PAGE_CRITICAL_LIVE_CACHE_TTL_MS = 2_000;
export const ACCOUNT_PAGE_CACHE_JITTER_MS = 250;
export const ACCOUNT_PAGE_BENCHMARK_EQUITY_CACHE_TTL_MS = 5 * 60_000;

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

export type AccountPageCriticalPayload = {
  stream: "account-page-critical";
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

const accountPageSnapshotCache = new Map<
  string,
  { value: AccountPageSnapshotPayload; expiresAt: number }
>();
const accountPageSnapshotInflight = new Map<
  string,
  Promise<AccountPageSnapshotPayload>
>();
const accountPageCriticalCache = new Map<
  string,
  { value: AccountPageCriticalPayload; expiresAt: number }
>();
const accountPageCriticalInflight = new Map<
  string,
  Promise<AccountPageCriticalPayload>
>();
const accountPageLiveCache = new Map<
  string,
  { value: AccountPageLivePayload; expiresAt: number }
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
let accountPageSnapshotCacheVersion = 0;

type AccountPageTimingKey =
  | "criticalMs"
  | "liveMs"
  | "derivedMs"
  | "firstCriticalWriteMs"
  | "firstDerivedWriteMs";
type AccountPageCacheKey =
  | "criticalHit"
  | "liveHit"
  | "derivedHit"
  | "benchmarkHit";

const accountPageStreamDiagnostics: {
  updatedAt: string | null;
  timings: Record<AccountPageTimingKey, number | null>;
  cache: Record<AccountPageCacheKey, boolean | null> & {
    criticalHits: number;
    criticalMisses: number;
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
    criticalMs: null,
    liveMs: null,
    derivedMs: null,
    firstCriticalWriteMs: null,
    firstDerivedWriteMs: null,
  },
  cache: {
    criticalHit: null,
    liveHit: null,
    derivedHit: null,
    benchmarkHit: null,
    criticalHits: 0,
    criticalMisses: 0,
    liveHits: 0,
    liveMisses: 0,
    derivedHits: 0,
    derivedMisses: 0,
    benchmarkHits: 0,
    benchmarkMisses: 0,
  },
};

function cacheTtlMs(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * (ACCOUNT_PAGE_CACHE_JITTER_MS + 1));
}

function recordAccountPageTiming(key: AccountPageTimingKey, startedAt: number): void {
  accountPageStreamDiagnostics.timings[key] = Math.max(0, Date.now() - startedAt);
  accountPageStreamDiagnostics.updatedAt = new Date().toISOString();
}

function recordAccountPageCache(key: AccountPageCacheKey, hit: boolean): void {
  accountPageStreamDiagnostics.cache[key] = hit;
  if (key === "criticalHit") {
    accountPageStreamDiagnostics.cache[hit ? "criticalHits" : "criticalMisses"] += 1;
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
  kind: "critical" | "derived",
  startedAt: number,
): void {
  recordAccountPageTiming(
    kind === "critical" ? "firstCriticalWriteMs" : "firstDerivedWriteMs",
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

function normalizeInput(input: AccountPageSnapshotInput): Required<AccountPageSnapshotInput> {
  return {
    accountId: input.accountId || "combined",
    mode: input.mode,
    range: input.range ?? "ALL",
    orderTab: input.orderTab ?? "working",
    assetClass: input.assetClass ?? null,
    from: input.from ?? null,
    to: input.to ?? null,
    symbol: input.symbol ?? null,
    tradeAssetClass: input.tradeAssetClass ?? null,
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
  accountPageSnapshotCache.clear();
  accountPageCriticalCache.clear();
  accountPageLiveCache.clear();
  accountPageDerivedCache.clear();
  accountPageBenchmarkEquityCache.clear();
  accountPageSnapshotInflight.clear();
  accountPageCriticalInflight.clear();
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
  const cached = accountPageLiveCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    recordAccountPageCache("liveHit", true);
    recordAccountPageTiming("liveMs", now);
    return cached.value;
  }
  recordAccountPageCache("liveHit", false);
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
        mode: normalized.mode,
      };
      const isShadow = isShadowAccountId(normalized.accountId);
      const [critical, intradayEquity, shadowOrders] = await Promise.all([
        fetchAccountPageCriticalPayload(normalized),
        getAccountEquityHistory({ ...common, range: "1D" }),
        isShadow
          ? getAccountOrders({ ...common, tab: normalized.orderTab })
          : Promise.resolve(null),
      ]);

      const value: AccountPageLivePayload = {
        stream: "account-page-live",
        accountId: normalized.accountId,
        mode: normalized.mode,
        orderTab: normalized.orderTab,
        assetClass: normalized.assetClass,
        updatedAt: new Date().toISOString(),
        summary: critical.summary,
        intradayEquity,
        allocation: critical.allocation,
        positions: critical.positions,
        orders: shadowOrders ?? critical.orders,
        risk: critical.risk,
      };
      if (version === accountPageSnapshotCacheVersion) {
        accountPageLiveCache.set(cacheKey, {
          value,
          expiresAt:
            Date.now() + cacheTtlMs(ACCOUNT_PAGE_CRITICAL_LIVE_CACHE_TTL_MS),
        });
      }
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

export async function fetchAccountPageCriticalPayload(
  input: AccountPageSnapshotInput,
): Promise<AccountPageCriticalPayload> {
  const normalized = normalizeInput(input);
  const cacheKey = stableStringify({
    accountId: normalized.accountId,
    mode: normalized.mode,
    orderTab: normalized.orderTab,
    assetClass: normalized.assetClass,
  });
  const cached = accountPageCriticalCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    recordAccountPageCache("criticalHit", true);
    recordAccountPageTiming("criticalMs", now);
    return cached.value;
  }
  recordAccountPageCache("criticalHit", false);
  const inFlight = accountPageCriticalInflight.get(cacheKey);
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
      const isShadow = isShadowAccountId(normalized.accountId);
      let summary: AccountPageCriticalPayload["summary"];
      let allocation: AccountPageCriticalPayload["allocation"];
      let positions: AccountPageCriticalPayload["positions"];
      let orders: AccountPageCriticalPayload["orders"];
      let risk: AccountPageCriticalPayload["risk"];

      if (isShadow) {
        const shadowPositions = await getAccountPositions({
          ...common,
          assetClass: normalized.assetClass,
          liveQuotes: false,
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
          }),
          getAccountOrders({ ...common, tab: normalized.orderTab }),
        ]);
        risk = await getAccountRisk(common);
      }

      const value: AccountPageCriticalPayload = {
        stream: "account-page-critical",
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
      if (version === accountPageSnapshotCacheVersion) {
        accountPageCriticalCache.set(cacheKey, {
          value,
          expiresAt:
            Date.now() + cacheTtlMs(ACCOUNT_PAGE_CRITICAL_LIVE_CACHE_TTL_MS),
        });
      }
      return value;
    } finally {
      recordAccountPageTiming("criticalMs", startedAt);
    }
  })();

  accountPageCriticalInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (accountPageCriticalInflight.get(cacheKey) === request) {
      accountPageCriticalInflight.delete(cacheKey);
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
      const [
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
        isShadowAccountId(normalized.accountId) ? Promise.resolve(null) : getFlexHealth(),
      ]);

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
  const cached = accountPageSnapshotCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const inFlight = accountPageSnapshotInflight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const version = accountPageSnapshotCacheVersion;
  const request = (async () => {
    const [live, derived] = await Promise.all([
      fetchAccountPageLivePayload(normalized),
      fetchAccountPageDerivedPayload(normalized),
    ]);
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
    if (version === accountPageSnapshotCacheVersion) {
      accountPageSnapshotCache.set(cacheKey, {
        value,
        expiresAt:
          Date.now() + cacheTtlMs(ACCOUNT_PAGE_CRITICAL_LIVE_CACHE_TTL_MS),
      });
    }
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
    initialCriticalPayload?: AccountPageCriticalPayload;
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
    ? subscribeShadowAccountChanges(() => {
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
