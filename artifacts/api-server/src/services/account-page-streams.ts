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
import { getShadowTradingPatterns, isShadowAccountId } from "./shadow-account";
import { subscribeShadowAccountChanges } from "./shadow-account-events";
import { invalidateShadowAccountSnapshotBaseCache } from "./shadow-account-streams";

type Unsubscribe = () => void;
type OrderTab = "working" | "history";
type BenchmarkSymbol = "SPY" | "QQQ" | "DIA";

export const ACCOUNT_PAGE_STREAM_INTERVAL_MS = 1_000;
export const ACCOUNT_PAGE_DERIVED_STREAM_INTERVAL_MS = 30_000;

type AccountPageSnapshotInput = {
  accountId: string;
  mode: RuntimeMode;
  range?: AccountRange;
  orderTab?: OrderTab;
  assetClass?: string | null;
  from?: Date | null;
  to?: Date | null;
  symbol?: string | null;
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
  tradingPatterns: Awaited<ReturnType<typeof getShadowTradingPatterns>> | null;
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
  tradingPatterns: AccountPageSnapshotPayload["tradingPatterns"];
};

const accountPageSnapshotCache = new Map<
  string,
  { value: AccountPageSnapshotPayload; expiresAt: number }
>();
const accountPageSnapshotInflight = new Map<
  string,
  Promise<AccountPageSnapshotPayload>
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
    pnlSign: input.pnlSign ?? null,
    holdDuration: input.holdDuration ?? null,
    performanceCalendarFrom: input.performanceCalendarFrom ?? null,
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
  accountPageLiveCache.clear();
  accountPageDerivedCache.clear();
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
    tradingPatterns: payload.tradingPatterns,
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
    return cached.value;
  }
  const inFlight = accountPageLiveInflight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const common = {
      accountId: normalized.accountId,
      mode: normalized.mode,
    };
    const [
      summary,
      intradayEquity,
      allocation,
      positions,
      orders,
      risk,
    ] = await Promise.all([
      getAccountSummary(common),
      getAccountEquityHistory({ ...common, range: "1D" }),
      getAccountAllocation(common),
      getAccountPositions({
        ...common,
        assetClass: normalized.assetClass,
      }),
      getAccountOrders({ ...common, tab: normalized.orderTab }),
      getAccountRisk(common),
    ]);

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
      orders,
      risk,
    };
    accountPageLiveCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + ACCOUNT_PAGE_STREAM_INTERVAL_MS,
    });
    return value;
  })();

  accountPageLiveInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    accountPageLiveInflight.delete(cacheKey);
  }
}

export async function fetchAccountPageDerivedPayload(
  input: AccountPageSnapshotInput,
): Promise<AccountPageDerivedPayload> {
  const normalized = normalizeInput(input);
  const cacheKey = cacheKeyForInput(normalized);
  const cached = accountPageDerivedCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const inFlight = accountPageDerivedInflight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const common = {
      accountId: normalized.accountId,
      mode: normalized.mode,
    };
    const closedTradeInput = {
      ...common,
      from: normalized.from,
      to: normalized.to,
      symbol: normalized.symbol,
      assetClass: null,
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
      tradingPatterns,
    ] = await Promise.all([
      getAccountEquityHistory({ ...common, range: normalized.range }),
      Promise.all(
        benchmarkSymbols.map((benchmark) =>
          getAccountEquityHistory({
            ...common,
            range: normalized.range,
            benchmark,
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
      isShadowAccountId(normalized.accountId)
        ? getShadowTradingPatterns({ range: normalized.range, snapshotId: "latest" })
        : Promise.resolve(null),
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
      tradingPatterns,
    };
    accountPageDerivedCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + ACCOUNT_PAGE_DERIVED_STREAM_INTERVAL_MS,
    });
    return value;
  })();

  accountPageDerivedInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    accountPageDerivedInflight.delete(cacheKey);
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
      tradingPatterns: derived.tradingPatterns,
    };
    accountPageSnapshotCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + ACCOUNT_PAGE_STREAM_INTERVAL_MS,
    });
    return value;
  })();

  accountPageSnapshotInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    accountPageSnapshotInflight.delete(cacheKey);
  }
}

export function subscribeAccountPageSnapshots(
  input: AccountPageSnapshotInput,
  onLive: (payload: AccountPageLivePayload) => void,
  onDerived: (payload: AccountPageDerivedPayload) => void,
  options: {
    initialPayload?: AccountPageSnapshotPayload;
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
    : "";
  let lastDerivedSignature = options.initialPayload
    ? stableStringify(derivedPayloadFromBootstrap(options.initialPayload))
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

  const liveTimer = setInterval(() => {
    void tickLive();
  }, ACCOUNT_PAGE_STREAM_INTERVAL_MS);
  liveTimer.unref?.();
  const derivedTimer = setInterval(() => {
    void tickDerived();
  }, ACCOUNT_PAGE_DERIVED_STREAM_INTERVAL_MS);
  derivedTimer.unref?.();

  const unsubscribeShadowChanges = isShadowAccountId(input.accountId)
    ? subscribeShadowAccountChanges(() => {
        clearAccountPageSnapshotCache();
        invalidateShadowAccountSnapshotBaseCache();
        void tickLive();
        void tickDerived();
      })
    : () => undefined;

  void tickLive();

  return () => {
    active = false;
    clearInterval(liveTimer);
    clearInterval(derivedTimer);
    unsubscribeShadowChanges();
  };
}
