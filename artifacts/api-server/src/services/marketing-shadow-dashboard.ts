import type { AccountRange } from "./account-ranges";
import { ACCOUNT_HISTORY_RANGES } from "./account-ranges";
import {
  listAlgoDeploymentMetadata,
  listExecutionEvents,
} from "./automation";
import { subscribeAlgoCockpitChanges } from "./algo-cockpit-events";
import {
  getShadowAccountAllocationFromPositions,
  getShadowAccountClosedTrades,
  getShadowAccountEquityHistory,
  getShadowAccountOrders,
  getShadowAccountPositions,
  getShadowAccountRisk,
  getShadowAccountSummaryFromPositions,
} from "./shadow-account";
import { subscribeShadowAccountChanges } from "./shadow-account-events";
import { getAlgoDeploymentCockpit } from "./signal-options-automation";
import { logger } from "../lib/logger";

type AsyncReturn<T extends (...args: any[]) => unknown> = Awaited<ReturnType<T>>;
type ShadowSummary = AsyncReturn<typeof getShadowAccountSummaryFromPositions>;
type ShadowEquityHistory = AsyncReturn<typeof getShadowAccountEquityHistory>;
type ShadowPositions = AsyncReturn<typeof getShadowAccountPositions>;
type ShadowClosedTrades = AsyncReturn<typeof getShadowAccountClosedTrades>;
type ShadowOrders = AsyncReturn<typeof getShadowAccountOrders>;
type ShadowAllocation = AsyncReturn<
  typeof getShadowAccountAllocationFromPositions
>;
type ShadowRisk = AsyncReturn<typeof getShadowAccountRisk>;
type AlgoDeployments = AsyncReturn<typeof listAlgoDeploymentMetadata>;
type AlgoDeployment = AlgoDeployments["deployments"][number];
type AlgoCockpit = AsyncReturn<typeof getAlgoDeploymentCockpit>;
type ExecutionEvents = AsyncReturn<typeof listExecutionEvents>;
type Unsubscribe = () => void;

export const MARKETING_SHADOW_DASHBOARD_DEFAULT_EVENT_LIMIT = 50;
export const MARKETING_SHADOW_DASHBOARD_MAX_EVENT_LIMIT = 100;
export const MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT = 100;
export const MARKETING_SHADOW_DASHBOARD_DEFAULT_EQUITY_RANGE: AccountRange = "1D";
export const MARKETING_SHADOW_DASHBOARD_STREAM_INTERVAL_MS = 5_000;
export const MARKETING_SHADOW_DASHBOARD_STREAM_COALESCE_MS = 1_000;
export const MARKETING_SHADOW_DASHBOARD_SNAPSHOT_CACHE_MS = 5_000;
// ponytail: bound retained snapshots by key; switch to a byte budget only if
// bounded payload sizes later vary enough for key count to stop being predictive.
const MARKETING_SHADOW_DASHBOARD_SNAPSHOT_CACHE_MAX_KEYS = 16;
export const MARKETING_SHADOW_DASHBOARD_STALE_MS = 24 * 60 * 60_000;
export const MARKETING_SHADOW_DASHBOARD_LABEL = "Shadow trading";

export type MarketingShadowDashboardInput = {
  equityRange?: unknown;
  eventLimit?: unknown;
};

export type NormalizedMarketingShadowDashboardInput = {
  equityRange: AccountRange;
  eventLimit: number;
};

export type MarketingAlgoEvent = {
  id: string;
  deploymentId: string | null;
  symbol: string | null;
  eventType: string;
  summary: string;
  payload: unknown;
  occurredAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

export type MarketingShadowDashboardPayload = {
  status: {
    mode: "shadow";
    source: "shadow-ledger";
    label: typeof MARKETING_SHADOW_DASHBOARD_LABEL;
    asOf: string | null;
    generatedAt: string;
    lastAccountUpdateAt: string | null;
    lastAlgoUpdateAt: string | null;
    degraded: boolean;
    stale: boolean;
    reason: string | null;
    warnings: string[];
  };
  account: {
    summary: {
      currency: string;
      netLiquidation: number | null;
      cash: number | null;
      buyingPower: number | null;
      dayPnl: number | null;
      dayPnlPercent: number | null;
      totalPnl: number | null;
      totalPnlPercent: number | null;
    };
    equityHistory: Array<{
      t: string;
      nav: number;
    }>;
    positions: unknown[];
    closedTrades: unknown[];
    closedTradesMeta: {
      total: number;
      truncated: boolean;
    };
    orders: {
      working: unknown[];
      history: unknown[];
      historyMeta: {
        total: number;
        truncated: boolean;
      };
    };
    risk: ShadowRisk;
    allocation: ShadowAllocation;
    tradeStats: {
      count: number;
      winners: number;
      losers: number;
      winRate: number | null;
      realizedPnl: number | null;
      commissions: number | null;
    };
  };
  algo: {
    deployment: null | {
      id: string;
      name: string;
      enabled: boolean;
      mode: "shadow" | "live";
      lastEvaluatedAt: string | null;
      lastSignalAt: string | null;
    };
    readiness: AlgoCockpit["readiness"] | null;
    kpis: AlgoCockpit["kpis"] | null;
    pipelineStages: AlgoCockpit["pipelineStages"];
    attentionItems: AlgoCockpit["attentionItems"];
    signals: AlgoCockpit["signals"];
    candidates: AlgoCockpit["candidates"];
    activePositions: AlgoCockpit["activePositions"];
    events: MarketingAlgoEvent[];
  };
};

export type MarketingShadowDashboardDependencies = {
  getSummaryFromPositions: typeof getShadowAccountSummaryFromPositions;
  getEquityHistory: typeof getShadowAccountEquityHistory;
  getPositions: typeof getShadowAccountPositions;
  getClosedTrades: typeof getShadowAccountClosedTrades;
  getOrders: typeof getShadowAccountOrders;
  getAllocationFromPositions: typeof getShadowAccountAllocationFromPositions;
  getRisk: typeof getShadowAccountRisk;
  listDeployments: typeof listAlgoDeploymentMetadata;
  getCockpit: typeof getAlgoDeploymentCockpit;
  listEvents: typeof listExecutionEvents;
  now: () => Date;
};

const defaultDependencies: MarketingShadowDashboardDependencies = {
  getSummaryFromPositions: getShadowAccountSummaryFromPositions,
  getEquityHistory: getShadowAccountEquityHistory,
  getPositions: getShadowAccountPositions,
  getClosedTrades: getShadowAccountClosedTrades,
  getOrders: getShadowAccountOrders,
  getAllocationFromPositions: getShadowAccountAllocationFromPositions,
  getRisk: getShadowAccountRisk,
  listDeployments: listAlgoDeploymentMetadata,
  getCockpit: getAlgoDeploymentCockpit,
  listEvents: listExecutionEvents,
  now: () => new Date(),
};

const marketingSnapshotCache = new Map<
  string,
  { payload: MarketingShadowDashboardPayload; expiresAt: number }
>();
const marketingSnapshotInFlight = new Map<
  string,
  Promise<MarketingShadowDashboardPayload>
>();

function readMarketingSnapshotCache(
  key: string,
  nowMs: number,
): MarketingShadowDashboardPayload | null {
  const cached = marketingSnapshotCache.get(key);
  if (!cached || cached.expiresAt <= nowMs) {
    marketingSnapshotCache.delete(key);
    return null;
  }
  marketingSnapshotCache.delete(key);
  marketingSnapshotCache.set(key, cached);
  return cached.payload;
}

function setMarketingSnapshotCache(
  key: string,
  entry: { payload: MarketingShadowDashboardPayload; expiresAt: number },
) {
  if (
    !marketingSnapshotCache.has(key) &&
    marketingSnapshotCache.size >=
      MARKETING_SHADOW_DASHBOARD_SNAPSHOT_CACHE_MAX_KEYS
  ) {
    const oldestKey = marketingSnapshotCache.keys().next().value;
    if (oldestKey !== undefined) {
      marketingSnapshotCache.delete(oldestKey);
    }
  }
  marketingSnapshotCache.delete(key);
  marketingSnapshotCache.set(key, entry);
}

function resolveDependencies(
  dependencies: Partial<MarketingShadowDashboardDependencies> = {},
): MarketingShadowDashboardDependencies {
  return {
    ...defaultDependencies,
    ...dependencies,
  };
}

export function normalizeMarketingShadowDashboardInput(
  input: MarketingShadowDashboardInput = {},
): NormalizedMarketingShadowDashboardInput {
  const rawRange =
    typeof input.equityRange === "string" ? input.equityRange.toUpperCase() : "";
  const equityRange = ACCOUNT_HISTORY_RANGES.includes(rawRange as AccountRange)
    ? (rawRange as AccountRange)
    : MARKETING_SHADOW_DASHBOARD_DEFAULT_EQUITY_RANGE;
  const rawEventLimit = Number(input.eventLimit);
  const eventLimit = Number.isFinite(rawEventLimit)
    ? Math.min(
        MARKETING_SHADOW_DASHBOARD_MAX_EVENT_LIMIT,
        Math.max(1, Math.floor(rawEventLimit)),
      )
    : MARKETING_SHADOW_DASHBOARD_DEFAULT_EVENT_LIMIT;

  return {
    equityRange,
    eventLimit,
  };
}

function marketingShadowDashboardCacheKey(
  normalized: NormalizedMarketingShadowDashboardInput,
): string {
  return JSON.stringify(normalized);
}

function numberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString() : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    const time = date.getTime();
    return Number.isFinite(time) ? date.toISOString() : null;
  }
  return null;
}

function latestIsoTimestamp(...values: unknown[]): string | null {
  const times = values
    .map((value) => {
      const iso = isoOrNull(value);
      return iso ? new Date(iso).getTime() : 0;
    })
    .filter((time) => time > 0);
  if (!times.length) {
    return null;
  }
  return new Date(Math.max(...times)).toISOString();
}

function metricValue(
  metrics: ShadowSummary["metrics"],
  key: keyof ShadowSummary["metrics"],
): number | null {
  return numberOrNull(metrics[key]?.value);
}

function readStringField(value: unknown, field: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return typeof record[field] === "string" && record[field].trim()
    ? record[field]
    : null;
}

function readBooleanField(value: unknown, field: string): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>)[field] === true,
  );
}

function warningFrom(value: unknown): string | null {
  return (
    readStringField(value, "reason") ??
    readStringField(value, "staleReason") ??
    null
  );
}

function buildTradeStats(closedTrades: ShadowClosedTrades) {
  const summary =
    closedTrades.summary &&
    typeof closedTrades.summary === "object" &&
    !Array.isArray(closedTrades.summary)
      ? (closedTrades.summary as Record<string, unknown>)
      : {};
  const trades = Array.isArray(closedTrades.trades)
    ? (closedTrades.trades as Array<Record<string, unknown>>)
    : [];
  const count =
    numberOrNull(summary.count) ?? trades.length;
  const winners =
    numberOrNull(summary.winners) ??
    trades.filter((trade) => (numberOrNull(trade.realizedPnl) ?? 0) > 0).length;
  const losers =
    numberOrNull(summary.losers) ??
    trades.filter((trade) => (numberOrNull(trade.realizedPnl) ?? 0) < 0).length;

  return {
    count,
    winners,
    losers,
    winRate: count > 0 ? (winners / count) * 100 : null,
    realizedPnl:
      numberOrNull(summary.realizedPnl) ??
      trades.reduce(
        (sum, trade) => sum + (numberOrNull(trade.realizedPnl) ?? 0),
        0,
      ),
    commissions:
      numberOrNull(summary.commissions) ??
      trades.reduce(
        (sum, trade) => sum + (numberOrNull(trade.commissions) ?? 0),
        0,
      ),
  };
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickMarketingFields(
  value: unknown,
  fields: string[],
): Record<string, unknown> {
  const record = recordOrNull(value);
  if (!record) {
    return {};
  }

  return fields.reduce<Record<string, unknown>>((next, field) => {
    if (record[field] !== undefined) {
      next[field] = record[field];
    }
    return next;
  }, {});
}

const marketingPositionsMemo = new WeakMap<object, unknown[]>();
const marketingClosedTradesMemo = new WeakMap<object, unknown[]>();
const marketingOrdersMemo = new WeakMap<object, unknown[]>();
const marketingHistoryOrdersMemo = new WeakMap<object, unknown[]>();
const marketingEquityHistoryMemo = new WeakMap<
  object,
  Array<{ t: string; nav: number }>
>();
const marketingAlgoEventsMemo = new WeakMap<object, MarketingAlgoEvent[]>();

function marketingAccountPositions(positions: ShadowPositions): unknown[] {
  const cached = marketingPositionsMemo.get(positions);
  if (cached) {
    return cached;
  }
  const projected = (positions.positions ?? []).map((position) =>
    pickMarketingFields(position, [
      "id",
      "accountId",
      "accounts",
      "symbol",
      "marketDataSymbol",
      "description",
      "assetClass",
      "optionContract",
      "underlyingMarket",
      "sector",
      "quantity",
      "averageCost",
      "mark",
      "dayChange",
      "dayChangePercent",
      "unrealizedPnl",
      "unrealizedPnlPercent",
      "marketValue",
      "weightPercent",
      "betaWeightedDelta",
      "source",
      "sourceType",
      "strategyLabel",
      "attributionStatus",
    ]),
  );
  marketingPositionsMemo.set(positions, projected);
  return projected;
}

function marketingClosedTrades(closedTrades: ShadowClosedTrades): unknown[] {
  const cached = marketingClosedTradesMemo.get(closedTrades);
  if (cached) {
    return cached;
  }
  const projected = (closedTrades.trades ?? [])
    .slice(0, MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT)
    .map((trade) =>
      pickMarketingFields(trade, [
        "id",
        "source",
        "accountId",
        "symbol",
        "side",
        "assetClass",
        "quantity",
        "openDate",
        "closeDate",
        "avgOpen",
        "avgClose",
        "realizedPnl",
        "realizedPnlPercent",
        "holdDurationMinutes",
        "fees",
        "commissions",
        "currency",
        "sourceType",
        "strategyLabel",
        "exitReason",
        "optionRight",
        "expirationDate",
        "dte",
        "strike",
        "signalPrice",
        "peakPrice",
        "mfePercent",
        "givebackPercent",
        "premiumAtRisk",
      ]),
    );
  marketingClosedTradesMemo.set(closedTrades, projected);
  return projected;
}

function marketingOrders(
  orders: ShadowOrders,
  historyOnly: boolean = false,
): unknown[] {
  const memo = historyOnly ? marketingHistoryOrdersMemo : marketingOrdersMemo;
  const cached = memo.get(orders);
  if (cached) {
    return cached;
  }
  const projected = (
    historyOnly
      ? (orders.orders ?? []).slice(0, MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT)
      : (orders.orders ?? [])
  ).map((order) =>
    pickMarketingFields(order, [
      "id",
      "accountId",
      "symbol",
      "side",
      "type",
      "assetClass",
      "quantity",
      "filledQuantity",
      "limitPrice",
      "stopPrice",
      "timeInForce",
      "status",
      "placedAt",
      "filledAt",
      "updatedAt",
      "averageFillPrice",
      "commission",
      "source",
      "sourceType",
      "strategyLabel",
    ]),
  );
  memo.set(orders, projected);
  return projected;
}

function selectMarketingDeployment(deployments: AlgoDeployment[]) {
  return (
    deployments.find(
      (deployment) => deployment.mode === "shadow" && deployment.enabled,
    ) ??
    deployments.find((deployment) => deployment.mode === "shadow") ??
    null
  );
}

function marketingDeployment(deployment: AlgoDeployment | null) {
  if (!deployment) {
    return null;
  }

  return {
    id: deployment.id,
    name: deployment.name,
    enabled: Boolean(deployment.enabled),
    mode: deployment.mode,
    lastEvaluatedAt: isoOrNull(deployment.lastEvaluatedAt),
    lastSignalAt: isoOrNull(deployment.lastSignalAt),
  };
}

function stripInternalAlgoPayload(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(stripInternalAlgoPayload);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(source)) {
    if (
      key === "providerAccountId" ||
      key === "algoRunId" ||
      key === "debug"
    ) {
      continue;
    }
    output[key] = stripInternalAlgoPayload(nestedValue);
  }
  return output;
}

function marketingAlgoEvents(events: ExecutionEvents): MarketingAlgoEvent[] {
  const cached = marketingAlgoEventsMemo.get(events);
  if (cached) {
    return cached;
  }
  const projected = events.events.map((event) => ({
    id: event.id,
    deploymentId: event.deploymentId ?? null,
    symbol: event.symbol ?? null,
    eventType: event.eventType,
    summary: event.summary,
    payload: stripInternalAlgoPayload(event.payload),
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  }));
  marketingAlgoEventsMemo.set(events, projected);
  return projected;
}

function buildEquityHistory(equityHistory: ShadowEquityHistory) {
  const cached = marketingEquityHistoryMemo.get(equityHistory);
  if (cached) {
    return cached;
  }
  const projected = equityHistory.points
    .map((point) => ({
      t: isoOrNull(point.timestamp),
      nav: numberOrNull(point.netLiquidation),
    }))
    .filter(
      (point): point is { t: string; nav: number } =>
        Boolean(point.t) && point.nav !== null,
    );
  marketingEquityHistoryMemo.set(equityHistory, projected);
  return projected;
}

// These markers describe transient local conditions on fresh data — a read served
// from a slightly-old cache, or positions served without live quotes under resource
// pressure. They are NOT a degraded/stale-data signal and must not flip the
// dashboard's degraded/stale flags or surface as user-facing warnings.
const SHADOW_CONTENTION_REASONS = new Set([
  "shadow_read_stale_cache",
  "shadow_positions_pressure_fallback",
]);

function isContentionOnly(value: unknown): boolean {
  const reason = warningFrom(value);
  return reason !== null && SHADOW_CONTENTION_REASONS.has(reason);
}

function readGenuineDegraded(value: unknown): boolean {
  return readBooleanField(value, "degraded") && !isContentionOnly(value);
}

function readGenuineStale(value: unknown): boolean {
  return readBooleanField(value, "stale") && !isContentionOnly(value);
}

function buildWarnings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map(warningFrom)
        .filter(
          (value): value is string =>
            Boolean(value) && !SHADOW_CONTENTION_REASONS.has(value as string),
        ),
    ),
  );
}

export const __marketingShadowDashboardInternalsForTests = {
  readGenuineDegraded,
  readGenuineStale,
  buildWarnings,
  clearSnapshotCacheForTests() {
    marketingSnapshotCache.clear();
  },
  getSnapshotCacheMaxKeysForTests() {
    return MARKETING_SHADOW_DASHBOARD_SNAPSHOT_CACHE_MAX_KEYS;
  },
  setSnapshotCacheForTests(
    key: string,
    payload: MarketingShadowDashboardPayload,
  ) {
    setMarketingSnapshotCache(key, {
      payload,
      expiresAt: Number.POSITIVE_INFINITY,
    });
  },
  hasSnapshotCacheKeyForTests(key: string) {
    return marketingSnapshotCache.has(key);
  },
  getSnapshotCacheSizeForTests() {
    return marketingSnapshotCache.size;
  },
};

export async function fetchMarketingShadowDashboardSnapshot(
  input: MarketingShadowDashboardInput = {},
  dependencies: Partial<MarketingShadowDashboardDependencies> = {},
): Promise<MarketingShadowDashboardPayload> {
  const normalized = normalizeMarketingShadowDashboardInput(input);
  if (Object.keys(dependencies).length === 0) {
    const cacheKey = marketingShadowDashboardCacheKey(normalized);
    const cached = readMarketingSnapshotCache(cacheKey, Date.now());
    if (cached) {
      return cached;
    }
    let inFlight = marketingSnapshotInFlight.get(cacheKey);
    if (!inFlight) {
      inFlight = fetchMarketingShadowDashboardSnapshotUncached(
        normalized,
        defaultDependencies,
      )
        .then((payload) => {
          setMarketingSnapshotCache(cacheKey, {
            payload,
            expiresAt:
              Date.now() + MARKETING_SHADOW_DASHBOARD_SNAPSHOT_CACHE_MS,
          });
          return payload;
        })
        .finally(() => {
          marketingSnapshotInFlight.delete(cacheKey);
        });
      marketingSnapshotInFlight.set(cacheKey, inFlight);
    }
    return inFlight;
  }

  const deps = resolveDependencies(dependencies);
  return fetchMarketingShadowDashboardSnapshotUncached(normalized, deps);
}

async function fetchMarketingShadowDashboardSnapshotUncached(
  normalized: NormalizedMarketingShadowDashboardInput,
  deps: MarketingShadowDashboardDependencies,
): Promise<MarketingShadowDashboardPayload> {
  // The first dashboard snapshot often lands during app warmup. These reads are
  // cached below the service layer, but cold parallel fan-out can occupy the
  // entire shared DB pool alongside signal-monitor bar-cache warmup.
  const equityHistory = await deps.getEquityHistory({
    range: normalized.equityRange,
  });
  const positions = await deps.getPositions({});
  const closedTrades = await deps.getClosedTrades({});
  const workingOrders = await deps.getOrders({ tab: "working" });
  const historyOrders = await deps.getOrders({ tab: "history" });
  const summary = await deps.getSummaryFromPositions({
    positionsResponse: positions,
  });
  const allocation = deps.getAllocationFromPositions({
    positionsResponse: positions,
  });
  const deployments = await deps.listDeployments({ mode: "shadow" });
  const risk = await deps.getRisk({
    positionsResponse: positions,
    closedTrades,
    detail: "fast",
  });
  const focusedDeployment = selectMarketingDeployment(deployments.deployments);
  let cockpit: AlgoCockpit | null = null;
  let events: ExecutionEvents = { events: [] } as ExecutionEvents;
  if (focusedDeployment) {
    cockpit = await deps.getCockpit({ deploymentId: focusedDeployment.id });
    events = await deps.listEvents({
      deploymentId: focusedDeployment.id,
      limit: normalized.eventLimit,
      // This dashboard renders event payload (marketingAlgoEvents ->
      // stripInternalAlgoPayload); the execution_events feed now omits jsonb
      // payload unless asked, so opt in here to preserve prior output.
      includePayload: true,
    });
  }

  const accountAsOf = latestIsoTimestamp(
    summary.updatedAt,
    equityHistory.asOf,
    equityHistory.latestSnapshotAt,
    positions.updatedAt,
    closedTrades.updatedAt,
    workingOrders.updatedAt,
    historyOrders.updatedAt,
    allocation.updatedAt,
    risk.updatedAt,
  );
  const algoAsOf = latestIsoTimestamp(
    focusedDeployment?.lastEvaluatedAt,
    focusedDeployment?.lastSignalAt,
    cockpit?.generatedAt,
    ...events.events.map((event) => event.occurredAt),
  );
  const asOf = latestIsoTimestamp(accountAsOf, algoAsOf);
  const generatedAt = deps.now().toISOString();
  const asOfMs = asOf ? new Date(asOf).getTime() : null;
  const staleByAge =
    asOfMs !== null
      ? deps.now().getTime() - asOfMs > MARKETING_SHADOW_DASHBOARD_STALE_MS
      : false;
  const stale = Boolean(
    staleByAge ||
      equityHistory.isStale ||
      readGenuineStale(positions) ||
      readGenuineStale(workingOrders) ||
      readGenuineStale(historyOrders),
  );
  const degraded = Boolean(
    readGenuineDegraded(summary) ||
      readGenuineDegraded(positions) ||
      readGenuineDegraded(closedTrades) ||
      readGenuineDegraded(workingOrders) ||
      readGenuineDegraded(historyOrders) ||
      readGenuineDegraded(allocation) ||
      readGenuineDegraded(risk),
  );
  const warnings = buildWarnings([
    summary,
    equityHistory,
    positions,
    closedTrades,
    workingOrders,
    historyOrders,
    allocation,
    risk,
  ]);

  return {
    status: {
      mode: "shadow",
      source: "shadow-ledger",
      label: MARKETING_SHADOW_DASHBOARD_LABEL,
      asOf,
      generatedAt,
      lastAccountUpdateAt: accountAsOf,
      lastAlgoUpdateAt: algoAsOf,
      degraded,
      stale,
      reason:
        warnings[0] ??
        (staleByAge ? "Shadow dashboard data has not updated within 24 hours." : null),
      warnings,
    },
    account: {
      summary: {
        currency: summary.currency || "USD",
        netLiquidation: metricValue(summary.metrics, "netLiquidation"),
        cash: metricValue(summary.metrics, "totalCash"),
        buyingPower: metricValue(summary.metrics, "buyingPower"),
        dayPnl: metricValue(summary.metrics, "dayPnl"),
        dayPnlPercent: metricValue(summary.metrics, "dayPnlPercent"),
        totalPnl: metricValue(summary.metrics, "totalPnl"),
        totalPnlPercent: metricValue(summary.metrics, "totalPnlPercent"),
      },
      equityHistory: buildEquityHistory(equityHistory),
      positions: marketingAccountPositions(positions),
      closedTrades: marketingClosedTrades(closedTrades),
      closedTradesMeta: {
        total: closedTrades.trades?.length ?? 0,
        truncated:
          (closedTrades.trades?.length ?? 0) >
          MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT,
      },
      orders: {
        working: marketingOrders(workingOrders),
        history: marketingOrders(historyOrders, true),
        historyMeta: {
          total: historyOrders.orders?.length ?? 0,
          truncated:
            (historyOrders.orders?.length ?? 0) >
            MARKETING_SHADOW_DASHBOARD_HISTORY_LIMIT,
        },
      },
      risk,
      allocation,
      tradeStats: buildTradeStats(closedTrades),
    },
    algo: {
      deployment: marketingDeployment(focusedDeployment),
      readiness: cockpit?.readiness ?? null,
      kpis: cockpit?.kpis ?? null,
      pipelineStages: cockpit?.pipelineStages ?? [],
      attentionItems: cockpit?.attentionItems ?? [],
      signals: cockpit?.signals ?? [],
      candidates: cockpit?.candidates ?? [],
      activePositions: cockpit?.activePositions ?? [],
      events: marketingAlgoEvents(events),
    },
  };
}

const marketingPayloadSignatureMemo = new WeakMap<
  MarketingShadowDashboardPayload,
  string
>();

function signatureForPayload(payload: MarketingShadowDashboardPayload): string {
  let signature = marketingPayloadSignatureMemo.get(payload);
  if (signature === undefined) {
    signature = JSON.stringify({
      ...payload,
      status: {
        ...payload.status,
        generatedAt: null,
      },
    });
    marketingPayloadSignatureMemo.set(payload, signature);
  }
  return signature;
}

type MarketingShadowDashboardSubscriber = {
  active: boolean;
  lastSignature: string;
  onSnapshot: (payload: MarketingShadowDashboardPayload) => void;
  onPollSuccess?: (input: {
    payload: MarketingShadowDashboardPayload;
    changed: boolean;
  }) => void | Promise<void>;
};

type MarketingShadowDashboardSharedPoller = {
  key: string;
  input: NormalizedMarketingShadowDashboardInput;
  subscribers: Set<MarketingShadowDashboardSubscriber>;
  active: boolean;
  inFlight: boolean;
  queued: boolean;
  queuedTimer: ReturnType<typeof setTimeout> | null;
  timer: ReturnType<typeof setInterval> | null;
  unsubscribeShadow: Unsubscribe;
  unsubscribeAlgo: Unsubscribe;
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

const marketingShadowDashboardSharedPollers = new Map<
  string,
  MarketingShadowDashboardSharedPoller
>();

function createMarketingShadowDashboardSharedPoller(
  key: string,
  input: NormalizedMarketingShadowDashboardInput,
  options: {
    fetchSnapshot: (
      input: MarketingShadowDashboardInput,
    ) => Promise<MarketingShadowDashboardPayload>;
    subscribeShadowChanges: typeof subscribeShadowAccountChanges;
    subscribeAlgoChanges: typeof subscribeAlgoCockpitChanges;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    intervalMs: number;
    coalescedPollDelayMs: number;
  },
): MarketingShadowDashboardSharedPoller {
  const poller: MarketingShadowDashboardSharedPoller = {
    key,
    input,
    subscribers: new Set(),
    active: true,
    inFlight: false,
    queued: false,
    queuedTimer: null,
    timer: null,
    unsubscribeShadow: () => {},
    unsubscribeAlgo: () => {},
    tick: async () => {
      if (!poller.active) {
        return;
      }
      if (poller.inFlight || poller.queuedTimer) {
        poller.queued = true;
        return;
      }

      poller.inFlight = true;
      try {
        poller.queued = false;
        const payload = await options.fetchSnapshot(poller.input);
        if (!poller.active) {
          return;
        }
        const signature = signatureForPayload(payload);
        for (const subscriber of [...poller.subscribers]) {
          if (!subscriber.active) {
            continue;
          }
          const changed = signature !== subscriber.lastSignature;
          if (changed) {
            subscriber.lastSignature = signature;
            try {
              subscriber.onSnapshot(payload);
            } catch (error) {
              logger.warn(
                { err: error },
                "Marketing shadow dashboard subscriber write failed",
              );
              continue;
            }
          }
          if (!subscriber.active) {
            continue;
          }
          try {
            await subscriber.onPollSuccess?.({ payload, changed });
          } catch (error) {
            logger.warn(
              { err: error },
              "Marketing shadow dashboard freshness write failed",
            );
          }
        }
      } catch (error) {
        logger.warn(
          { err: error },
          "Marketing shadow dashboard polling failed",
        );
      } finally {
        poller.inFlight = false;
        if (poller.active && poller.queued) {
          poller.queued = false;
          if (!poller.queuedTimer) {
            poller.queuedTimer = options.setTimeout(() => {
              poller.queuedTimer = null;
              if (!poller.active) {
                return;
              }
              void poller.tick();
            }, options.coalescedPollDelayMs);
            poller.queuedTimer.unref?.();
          }
        }
      }
    },
    start: () => {
      poller.timer = options.setInterval(() => {
        void poller.tick();
      }, options.intervalMs);
      poller.timer.unref?.();
      poller.unsubscribeShadow = options.subscribeShadowChanges((change) => {
        if (change.reason !== "mark_refresh") {
          void poller.tick();
        }
      });
      poller.unsubscribeAlgo = options.subscribeAlgoChanges((change) => {
        if (!change.mode || change.mode === "shadow") {
          void poller.tick();
        }
      });
    },
    stop: () => {
      poller.active = false;
      if (poller.timer) {
        options.clearInterval(poller.timer);
        poller.timer = null;
      }
      if (poller.queuedTimer) {
        options.clearTimeout(poller.queuedTimer);
        poller.queuedTimer = null;
      }
      poller.unsubscribeShadow();
      poller.unsubscribeAlgo();
      if (marketingShadowDashboardSharedPollers.get(poller.key) === poller) {
        marketingShadowDashboardSharedPollers.delete(poller.key);
      }
    },
  };

  return poller;
}

export function subscribeMarketingShadowDashboardSnapshots(
  input: MarketingShadowDashboardInput,
  onSnapshot: (payload: MarketingShadowDashboardPayload) => void,
  options: {
    initialPayload?: MarketingShadowDashboardPayload;
    fetchSnapshot?: (
      input: MarketingShadowDashboardInput,
    ) => Promise<MarketingShadowDashboardPayload>;
    subscribeShadowChanges?: typeof subscribeShadowAccountChanges;
    subscribeAlgoChanges?: typeof subscribeAlgoCockpitChanges;
    onPollSuccess?: (input: {
      payload: MarketingShadowDashboardPayload;
      changed: boolean;
    }) => void | Promise<void>;
    setInterval?: typeof setInterval;
    clearInterval?: typeof clearInterval;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
    intervalMs?: number;
    coalescedPollDelayMs?: number;
  } = {},
): Unsubscribe {
  const fetchSnapshot =
    options.fetchSnapshot ?? fetchMarketingShadowDashboardSnapshot;
  const subscribeShadowChanges =
    options.subscribeShadowChanges ?? subscribeShadowAccountChanges;
  const subscribeAlgoChanges =
    options.subscribeAlgoChanges ?? subscribeAlgoCockpitChanges;
  const setPollInterval = options.setInterval ?? setInterval;
  const clearPollInterval = options.clearInterval ?? clearInterval;
  const setPollTimeout = options.setTimeout ?? setTimeout;
  const clearPollTimeout = options.clearTimeout ?? clearTimeout;
  const intervalMs =
    options.intervalMs ?? MARKETING_SHADOW_DASHBOARD_STREAM_INTERVAL_MS;
  const coalescedPollDelayMs =
    options.coalescedPollDelayMs ??
    MARKETING_SHADOW_DASHBOARD_STREAM_COALESCE_MS;
  const subscriber: MarketingShadowDashboardSubscriber = {
    active: true,
    lastSignature: options.initialPayload
      ? signatureForPayload(options.initialPayload)
      : "",
    onSnapshot,
    onPollSuccess: options.onPollSuccess,
  };
  const normalized = normalizeMarketingShadowDashboardInput(input);
  const key = marketingShadowDashboardCacheKey(normalized);
  let poller = marketingShadowDashboardSharedPollers.get(key);
  if (!poller) {
    poller = createMarketingShadowDashboardSharedPoller(key, normalized, {
      fetchSnapshot,
      subscribeShadowChanges,
      subscribeAlgoChanges,
      setInterval: setPollInterval,
      clearInterval: clearPollInterval,
      setTimeout: setPollTimeout,
      clearTimeout: clearPollTimeout,
      intervalMs,
      coalescedPollDelayMs,
    });
    marketingShadowDashboardSharedPollers.set(key, poller);
    poller.subscribers.add(subscriber);
    poller.start();
  } else {
    poller.subscribers.add(subscriber);
  }

  if (!options.initialPayload && !poller.inFlight) {
    void poller.tick();
  }

  return () => {
    if (!subscriber.active) {
      return;
    }
    subscriber.active = false;
    poller?.subscribers.delete(subscriber);
    if (poller && poller.subscribers.size === 0) {
      poller.stop();
    }
  };
}
