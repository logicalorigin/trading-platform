import type { AccountRange } from "./account-ranges";
import { ACCOUNT_HISTORY_RANGES } from "./account-ranges";
import {
  listAlgoDeployments,
  listExecutionEvents,
} from "./automation";
import { subscribeAlgoCockpitChanges } from "./algo-cockpit-events";
import {
  getShadowAccountAllocation,
  getShadowAccountClosedTrades,
  getShadowAccountEquityHistory,
  getShadowAccountOrders,
  getShadowAccountPositions,
  getShadowAccountRisk,
  getShadowAccountSummary,
} from "./shadow-account";
import { subscribeShadowAccountChanges } from "./shadow-account-events";
import { getAlgoDeploymentCockpit } from "./signal-options-automation";
import { logger } from "../lib/logger";

type AsyncReturn<T extends (...args: any[]) => unknown> = Awaited<ReturnType<T>>;
type ShadowSummary = AsyncReturn<typeof getShadowAccountSummary>;
type ShadowEquityHistory = AsyncReturn<typeof getShadowAccountEquityHistory>;
type ShadowPositions = AsyncReturn<typeof getShadowAccountPositions>;
type ShadowClosedTrades = AsyncReturn<typeof getShadowAccountClosedTrades>;
type ShadowOrders = AsyncReturn<typeof getShadowAccountOrders>;
type ShadowAllocation = AsyncReturn<typeof getShadowAccountAllocation>;
type ShadowRisk = AsyncReturn<typeof getShadowAccountRisk>;
type AlgoDeployments = AsyncReturn<typeof listAlgoDeployments>;
type AlgoDeployment = AlgoDeployments["deployments"][number];
type AlgoCockpit = AsyncReturn<typeof getAlgoDeploymentCockpit>;
type ExecutionEvents = AsyncReturn<typeof listExecutionEvents>;
type Unsubscribe = () => void;

export const MARKETING_SHADOW_DASHBOARD_DEFAULT_EVENT_LIMIT = 50;
export const MARKETING_SHADOW_DASHBOARD_MAX_EVENT_LIMIT = 100;
export const MARKETING_SHADOW_DASHBOARD_STREAM_INTERVAL_MS = 5_000;
export const MARKETING_SHADOW_DASHBOARD_STREAM_COALESCE_MS = 1_000;
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
    orders: {
      working: unknown[];
      history: unknown[];
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
  getSummary: typeof getShadowAccountSummary;
  getEquityHistory: typeof getShadowAccountEquityHistory;
  getPositions: typeof getShadowAccountPositions;
  getClosedTrades: typeof getShadowAccountClosedTrades;
  getOrders: typeof getShadowAccountOrders;
  getAllocation: typeof getShadowAccountAllocation;
  getRisk: typeof getShadowAccountRisk;
  listDeployments: typeof listAlgoDeployments;
  getCockpit: typeof getAlgoDeploymentCockpit;
  listEvents: typeof listExecutionEvents;
  now: () => Date;
};

const defaultDependencies: MarketingShadowDashboardDependencies = {
  getSummary: getShadowAccountSummary,
  getEquityHistory: getShadowAccountEquityHistory,
  getPositions: getShadowAccountPositions,
  getClosedTrades: getShadowAccountClosedTrades,
  getOrders: getShadowAccountOrders,
  getAllocation: getShadowAccountAllocation,
  getRisk: getShadowAccountRisk,
  listDeployments: listAlgoDeployments,
  getCockpit: getAlgoDeploymentCockpit,
  listEvents: listExecutionEvents,
  now: () => new Date(),
};

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
    : "ALL";
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

function marketingAccountPositions(positions: ShadowPositions): unknown[] {
  return (positions.positions ?? []).map((position) =>
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
}

function marketingClosedTrades(closedTrades: ShadowClosedTrades): unknown[] {
  return (closedTrades.trades ?? []).map((trade) =>
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
}

function marketingOrders(orders: ShadowOrders): unknown[] {
  return (orders.orders ?? []).map((order) =>
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
  return events.events.map((event) => ({
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
}

function buildEquityHistory(equityHistory: ShadowEquityHistory) {
  return equityHistory.points
    .map((point) => ({
      t: isoOrNull(point.timestamp),
      nav: numberOrNull(point.netLiquidation),
    }))
    .filter((point): point is { t: string; nav: number } => Boolean(point.t) && point.nav !== null);
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
};

export async function fetchMarketingShadowDashboardSnapshot(
  input: MarketingShadowDashboardInput = {},
  dependencies: Partial<MarketingShadowDashboardDependencies> = {},
): Promise<MarketingShadowDashboardPayload> {
  const normalized = normalizeMarketingShadowDashboardInput(input);
  const deps = resolveDependencies(dependencies);
  const [
    summary,
    equityHistory,
    positions,
    closedTrades,
    workingOrders,
    historyOrders,
    allocation,
    deployments,
  ] = await Promise.all([
    deps.getSummary(),
    deps.getEquityHistory({ range: normalized.equityRange }),
    deps.getPositions({}),
    deps.getClosedTrades({}),
    deps.getOrders({ tab: "working" }),
    deps.getOrders({ tab: "history" }),
    deps.getAllocation(),
    deps.listDeployments({ mode: "shadow" }),
  ]);
  const risk = await deps.getRisk({
    positionsResponse: positions,
    closedTrades,
    detail: "fast",
  });
  const focusedDeployment = selectMarketingDeployment(deployments.deployments);
  const [cockpit, events] = focusedDeployment
    ? await Promise.all([
        deps.getCockpit({ deploymentId: focusedDeployment.id }),
        deps.listEvents({
          deploymentId: focusedDeployment.id,
          limit: normalized.eventLimit,
        }),
      ])
    : [null, { events: [] } as ExecutionEvents];

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
      orders: {
        working: marketingOrders(workingOrders),
        history: marketingOrders(historyOrders),
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

function signatureForPayload(payload: MarketingShadowDashboardPayload): string {
  return JSON.stringify({
    ...payload,
    status: {
      ...payload.status,
      generatedAt: null,
    },
  });
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
  let active = true;
  let inFlight = false;
  let queued = false;
  let queuedTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSignature = options.initialPayload
    ? signatureForPayload(options.initialPayload)
    : "";
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

  const scheduleQueuedPoll = () => {
    if (!active || queuedTimer) {
      return;
    }
    queuedTimer = setPollTimeout(() => {
      queuedTimer = null;
      if (!active) {
        return;
      }
      queued = false;
      void tick();
    }, coalescedPollDelayMs);
    queuedTimer.unref?.();
  };

  const tick = async () => {
    if (!active) {
      return;
    }
    if (inFlight || queuedTimer) {
      queued = true;
      return;
    }

    inFlight = true;
    try {
      queued = false;
      const payload = await fetchSnapshot(input);
      if (!active) {
        return;
      }
      const signature = signatureForPayload(payload);
      const changed = signature !== lastSignature;
      if (changed) {
        lastSignature = signature;
        onSnapshot(payload);
      }
      await options.onPollSuccess?.({ payload, changed });
    } catch (error) {
      logger.warn({ err: error }, "Marketing shadow dashboard polling failed");
    } finally {
      inFlight = false;
      if (active && queued) {
        queued = false;
        scheduleQueuedPoll();
      }
    }
  };

  const timer = setPollInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  const unsubscribeShadow = subscribeShadowChanges(() => {
    void tick();
  });
  const unsubscribeAlgo = subscribeAlgoChanges((change) => {
    if (change.mode && change.mode !== "shadow") {
      return;
    }
    void tick();
  });

  if (!options.initialPayload) {
    void tick();
  }

  return () => {
    active = false;
    clearPollInterval(timer);
    if (queuedTimer) {
      clearPollTimeout(queuedTimer);
      queuedTimer = null;
    }
    unsubscribeShadow();
    unsubscribeAlgo();
  };
}
