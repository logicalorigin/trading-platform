import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
  signalMonitorProfilesTable,
  shadowFillsTable,
  shadowOrdersTable,
  shadowPositionsTable,
  type AlgoDeployment,
  type ExecutionEvent,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import { listWatchlists } from "./platform";
import {
  SHADOW_ACCOUNT_ID,
  getShadowAccountSummary,
  placeShadowOrder,
  runShadowWatchlistBacktest,
} from "./shadow-account";
import {
  evaluateSignalMonitorProfileUniverse,
  getSignalMonitorProfileRow,
  loadSignalMonitorCompletedBars,
  resolveSignalMonitorTimeframe,
  withSignalMonitorUniverseScope,
  type SignalMonitorTimeframe,
} from "./signal-monitor";

const STRATEGY_NAME = "Shadow Equity Forward Test";
const DEPLOYMENT_NAME = "Shadow Equity Forward Test";
const EXECUTION_MODE = "signal_equity_shadow";
const DEFAULT_MAX_SYMBOLS = 250;
const DEFAULT_PROFILE = {
  timeframe: "15m" as SignalMonitorTimeframe,
  maxPositionFraction: 0.1,
  maxOpenPositions: 10,
  trailingStopPercent: 3,
  pollIntervalSeconds: 60,
  maxSymbols: DEFAULT_MAX_SYMBOLS,
  excludedSymbols: ["VXX", "VIXY"],
  proxySymbols: ["SQQQ"],
};

type ForwardProfile = typeof DEFAULT_PROFILE;

type ForwardUniverse = {
  symbols: string[];
  skippedSymbols: string[];
  truncated: boolean;
  watchlistCount: number;
};

type ShadowOrderRow = typeof shadowOrdersTable.$inferSelect;
type ShadowPositionRow = typeof shadowPositionsTable.$inferSelect;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.round(parsed)))
    : fallback;
}

function normalizeSymbolList(value: unknown, fallback: string[]) {
  const input = Array.isArray(value) ? value : fallback;
  const symbols = Array.from(
    new Set(
      input
        .map((entry) => normalizeSymbol(String(entry ?? "")).toUpperCase())
        .filter(Boolean),
    ),
  );
  return symbols.length ? symbols : fallback;
}

function resolveForwardProfile(deployment?: AlgoDeployment | null): ForwardProfile {
  const config = asRecord(deployment?.config);
  const raw = asRecord(config.signalEquityShadow);
  const maxPositionFraction =
    toNumber(raw.maxPositionFraction) ??
    (toNumber(raw.maxPositionPercent) ?? DEFAULT_PROFILE.maxPositionFraction * 100) /
      100;
  return {
    timeframe: resolveSignalMonitorTimeframe(raw.timeframe, DEFAULT_PROFILE.timeframe),
    maxPositionFraction: Math.min(
      1,
      Math.max(0.01, maxPositionFraction || DEFAULT_PROFILE.maxPositionFraction),
    ),
    maxOpenPositions: positiveInteger(
      raw.maxOpenPositions,
      DEFAULT_PROFILE.maxOpenPositions,
      1,
      25,
    ),
    trailingStopPercent: Math.min(
      50,
      Math.max(0.1, toNumber(raw.trailingStopPercent) ?? DEFAULT_PROFILE.trailingStopPercent),
    ),
    pollIntervalSeconds: positiveInteger(
      raw.pollIntervalSeconds,
      DEFAULT_PROFILE.pollIntervalSeconds,
      15,
      3600,
    ),
    maxSymbols: positiveInteger(raw.maxSymbols, DEFAULT_PROFILE.maxSymbols, 1, 500),
    excludedSymbols: normalizeSymbolList(raw.excludedSymbols, DEFAULT_PROFILE.excludedSymbols),
    proxySymbols: normalizeSymbolList(raw.proxySymbols, DEFAULT_PROFILE.proxySymbols),
  };
}

function buildForwardConfig(profile: ForwardProfile = DEFAULT_PROFILE) {
  return {
    parameters: { executionMode: EXECUTION_MODE },
    signalEquityShadow: profile,
  };
}

function deploymentToResponse(deployment: AlgoDeployment | null, profile: ForwardProfile) {
  if (!deployment) {
    return null;
  }
  return {
    id: deployment.id,
    strategyId: deployment.strategyId,
    name: deployment.name,
    mode: deployment.mode,
    enabled: deployment.enabled,
    providerAccountId: deployment.providerAccountId,
    symbolUniverse: deployment.symbolUniverse,
    profile,
    lastEvaluatedAt: deployment.lastEvaluatedAt ?? null,
    lastSignalAt: deployment.lastSignalAt ?? null,
    lastError: deployment.lastError ?? null,
    updatedAt: deployment.updatedAt,
  };
}

function eventToResponse(event: ExecutionEvent) {
  return {
    id: event.id,
    deploymentId: event.deploymentId ?? null,
    providerAccountId: event.providerAccountId ?? null,
    symbol: event.symbol ?? null,
    eventType: event.eventType,
    summary: event.summary,
    payload: event.payload,
    occurredAt: event.occurredAt,
  };
}

export function deploymentHasShadowEquityForwardProfile(deployment: AlgoDeployment) {
  const config = asRecord(deployment.config);
  const parameters = asRecord(config.parameters);
  return parameters.executionMode === EXECUTION_MODE;
}

export function resolveShadowEquityForwardPollIntervalSeconds(
  deployment: AlgoDeployment,
) {
  return resolveForwardProfile(deployment).pollIntervalSeconds;
}

async function resolveForwardUniverse(profile: ForwardProfile): Promise<ForwardUniverse> {
  const { watchlists } = await listWatchlists();
  const excluded = new Set(profile.excludedSymbols);
  const bySymbol = new Set<string>();
  for (const watchlist of watchlists) {
    for (const item of watchlist.items) {
      const symbol = normalizeSymbol(item.symbol).toUpperCase();
      if (symbol && !excluded.has(symbol)) {
        bySymbol.add(symbol);
      }
    }
  }
  for (const symbol of profile.proxySymbols) {
    if (!excluded.has(symbol)) {
      bySymbol.add(symbol);
    }
  }
  const symbols = Array.from(bySymbol).sort((left, right) => left.localeCompare(right));
  return {
    symbols: symbols.slice(0, profile.maxSymbols),
    skippedSymbols: symbols.slice(profile.maxSymbols),
    truncated: symbols.length > profile.maxSymbols,
    watchlistCount: watchlists.length,
  };
}

async function getOrCreateStrategy(universe: string[]) {
  const [existing] = await db
    .select()
    .from(algoStrategiesTable)
    .where(
      and(
        eq(algoStrategiesTable.name, STRATEGY_NAME),
        eq(algoStrategiesTable.mode, "paper"),
      ),
    )
    .orderBy(desc(algoStrategiesTable.updatedAt))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(algoStrategiesTable)
    .values({
      name: STRATEGY_NAME,
      mode: "paper",
      enabled: false,
      symbolUniverse: universe,
      config: buildForwardConfig(),
    })
    .returning();
  if (!created) {
    throw new HttpError(500, "Unable to create shadow equity forward-test strategy.", {
      code: "shadow_equity_forward_strategy_create_failed",
    });
  }
  return created;
}

async function getOrCreateDeployment(input: { enable?: boolean } = {}) {
  const baseProfile = resolveForwardProfile(null);
  const universe = await resolveForwardUniverse(baseProfile);
  const strategy = await getOrCreateStrategy(universe.symbols);
  const [existing] = await db
    .select()
    .from(algoDeploymentsTable)
    .where(
      and(
        eq(algoDeploymentsTable.strategyId, strategy.id),
        eq(algoDeploymentsTable.mode, "paper"),
        eq(algoDeploymentsTable.providerAccountId, SHADOW_ACCOUNT_ID),
      ),
    )
    .orderBy(desc(algoDeploymentsTable.updatedAt))
    .limit(1);
  const nextConfig = buildForwardConfig(resolveForwardProfile(existing));

  if (existing) {
    if (input.enable === undefined) {
      return existing;
    }
    const [updated] = await db
      .update(algoDeploymentsTable)
      .set({
        name: DEPLOYMENT_NAME,
        symbolUniverse: universe.symbols,
        config: nextConfig,
        enabled: input.enable === undefined ? existing.enabled : input.enable,
        lastError: input.enable ? null : existing.lastError,
        updatedAt: new Date(),
      })
      .where(eq(algoDeploymentsTable.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [created] = await db
    .insert(algoDeploymentsTable)
    .values({
      strategyId: strategy.id,
      name: DEPLOYMENT_NAME,
      mode: "paper",
      enabled: input.enable === true,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbolUniverse: universe.symbols,
      config: nextConfig,
    })
    .returning();
  if (!created) {
    throw new HttpError(500, "Unable to create shadow equity forward-test deployment.", {
      code: "shadow_equity_forward_deployment_create_failed",
    });
  }
  return created;
}

async function findShadowEquityForwardDeployment() {
  const rows = await db
    .select()
    .from(algoDeploymentsTable)
    .where(
      and(
        eq(algoDeploymentsTable.mode, "paper"),
        eq(algoDeploymentsTable.providerAccountId, SHADOW_ACCOUNT_ID),
      ),
    )
    .orderBy(desc(algoDeploymentsTable.updatedAt))
    .limit(20);
  return rows.find(deploymentHasShadowEquityForwardProfile) ?? null;
}

export async function listEnabledShadowEquityForwardDeployments() {
  const rows = await db
    .select()
    .from(algoDeploymentsTable)
    .where(
      and(
        eq(algoDeploymentsTable.enabled, true),
        eq(algoDeploymentsTable.mode, "paper"),
        eq(algoDeploymentsTable.providerAccountId, SHADOW_ACCOUNT_ID),
      ),
    );
  return rows.filter(deploymentHasShadowEquityForwardProfile);
}

async function configureSignalMonitor(profile: ForwardProfile) {
  const row = await getSignalMonitorProfileRow({
    environment: "paper",
    ensureWatchlist: false,
  });
  const settings = withSignalMonitorUniverseScope(
    asRecord(row.rayReplicaSettings),
    "all_watchlists",
  );
  const [updated] = await db
    .update(signalMonitorProfilesTable)
    .set({
      enabled: true,
      timeframe: profile.timeframe,
      rayReplicaSettings: settings,
      maxSymbols: Math.min(profile.maxSymbols, DEFAULT_MAX_SYMBOLS),
      updatedAt: new Date(),
    })
    .where(eq(signalMonitorProfilesTable.id, row.id))
    .returning();
  return updated ?? row;
}

function eventDedupeWhere(input: {
  deploymentId: string;
  eventType: string;
  dedupeKey: string;
}) {
  return and(
    eq(executionEventsTable.deploymentId, input.deploymentId),
    eq(executionEventsTable.eventType, input.eventType),
    sql`${executionEventsTable.payload}->>'dedupeKey' = ${input.dedupeKey}`,
  );
}

async function insertForwardEventOnce(input: {
  deployment: AlgoDeployment;
  symbol?: string | null;
  eventType: string;
  summary: string;
  payload: Record<string, unknown>;
  occurredAt?: Date;
}) {
  const dedupeKey = String(input.payload.dedupeKey ?? "");
  if (dedupeKey) {
    const [existing] = await db
      .select()
      .from(executionEventsTable)
      .where(
        eventDedupeWhere({
          deploymentId: input.deployment.id,
          eventType: input.eventType,
          dedupeKey,
        }),
      )
      .limit(1);
    if (existing) {
      return { event: existing, created: false };
    }
  }

  const [event] = await db
    .insert(executionEventsTable)
    .values({
      deploymentId: input.deployment.id,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: input.symbol ? normalizeSymbol(input.symbol).toUpperCase() : null,
      eventType: input.eventType,
      summary: input.summary,
      payload: { ...input.payload, deploymentId: input.deployment.id },
      occurredAt: input.occurredAt ?? new Date(),
    })
    .returning();
  if (!event) {
    throw new HttpError(500, "Unable to record shadow equity forward-test event.", {
      code: "shadow_equity_forward_event_create_failed",
    });
  }
  return { event, created: true };
}

function barValue(bar: unknown, keys: string[]) {
  const record = asRecord(bar);
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value != null) {
      return value;
    }
  }
  return null;
}

async function latestCompletedBar(input: {
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  evaluatedAt: Date;
}) {
  const snapshot = await loadSignalMonitorCompletedBars({
    symbol: input.symbol,
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
    limit: 3,
  });
  const bar = snapshot.bars.at(-1) ?? null;
  return {
    bar,
    latestBarAt: snapshot.latestBarAt,
    close: barValue(bar, ["close", "c"]),
    high: barValue(bar, ["high", "h"]),
    low: barValue(bar, ["low", "l"]),
  };
}

async function openEquityPositions() {
  return db
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowPositionsTable.assetClass, "equity"),
        eq(shadowPositionsTable.status, "open"),
      ),
    );
}

async function readForwardOrders(deploymentId: string) {
  return db
    .select()
    .from(shadowOrdersTable)
    .where(
      and(
        eq(shadowOrdersTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowOrdersTable.source, "automation"),
        sql`${shadowOrdersTable.payload}->>'forwardTest' = 'true'`,
        sql`${shadowOrdersTable.payload}->>'deploymentId' = ${deploymentId}`,
      ),
    )
    .orderBy(desc(shadowOrdersTable.placedAt))
    .limit(1000);
}

function forwardOpenQuantitiesBySymbol(orders: ShadowOrderRow[]) {
  const quantities = new Map<string, number>();
  for (const order of orders) {
    const symbol = normalizeSymbol(order.symbol).toUpperCase();
    const quantity = toNumber(order.filledQuantity) ?? toNumber(order.quantity) ?? 0;
    if (!symbol || quantity <= 0) {
      continue;
    }
    const direction = order.side === "buy" ? 1 : -1;
    quantities.set(symbol, (quantities.get(symbol) ?? 0) + direction * quantity);
  }
  for (const [symbol, quantity] of quantities) {
    if (quantity <= 0.000001) {
      quantities.delete(symbol);
    }
  }
  return quantities;
}

async function openForwardEquityPositions(
  deploymentId: string,
): Promise<ShadowPositionRow[]> {
  const forwardOpenQuantities = forwardOpenQuantitiesBySymbol(
    await readForwardOrders(deploymentId),
  );
  if (!forwardOpenQuantities.size) {
    return [];
  }
  const positions = await openEquityPositions();
  return positions.filter((position) =>
    forwardOpenQuantities.has(normalizeSymbol(position.symbol).toUpperCase()),
  );
}

async function latestHighWaterMark(input: {
  deploymentId: string;
  symbol: string;
  fallback: number;
}) {
  const rows = await db
    .select()
    .from(executionEventsTable)
    .where(
      and(
        eq(executionEventsTable.deploymentId, input.deploymentId),
        eq(executionEventsTable.symbol, input.symbol),
      ),
    )
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(100);
  for (const row of rows) {
    const highWater = toNumber(asRecord(row.payload).highWaterMark);
    if (highWater != null && highWater > 0) {
      return highWater;
    }
  }
  return input.fallback;
}

async function recordShadowFillForEvent(input: {
  event: ExecutionEvent;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  payload: Record<string, unknown>;
}) {
  return placeShadowOrder({
    accountId: SHADOW_ACCOUNT_ID,
    mode: "paper",
    symbol: input.symbol,
    assetClass: "equity",
    side: input.side,
    type: "market",
    quantity: input.quantity,
    limitPrice: input.price,
    stopPrice: null,
    timeInForce: "day",
    optionContract: null,
    source: "automation",
    sourceEventId: input.event.id,
    clientOrderId: `shadow-equity-forward-${input.side}-${input.event.id}`,
    requestedFillPrice: input.price,
    payload: input.payload,
    placedAt: input.event.occurredAt,
  });
}

async function processTrailingStops(input: {
  deployment: AlgoDeployment;
  profile: ForwardProfile;
  evaluatedAt: Date;
}) {
  const events: ExecutionEvent[] = [];
  const positions = await openForwardEquityPositions(input.deployment.id);
  for (const position of positions) {
    const symbol = normalizeSymbol(position.symbol).toUpperCase();
    if (input.profile.excludedSymbols.includes(symbol)) {
      continue;
    }
    const quantity = toNumber(position.quantity) ?? 0;
    const averageCost = toNumber(position.averageCost) ?? 0;
    if (!symbol || quantity <= 0 || averageCost <= 0) {
      continue;
    }
    const latest = await latestCompletedBar({
      symbol,
      timeframe: input.profile.timeframe,
      evaluatedAt: input.evaluatedAt,
    });
    if (!latest.latestBarAt || latest.high == null || latest.low == null) {
      continue;
    }
    const previousHighWater = await latestHighWaterMark({
      deploymentId: input.deployment.id,
      symbol,
      fallback: averageCost,
    });
    const highWaterMark = Math.max(previousHighWater, latest.high);
    const stopPrice = highWaterMark * (1 - input.profile.trailingStopPercent / 100);
    const markKey = `${input.deployment.id}:${symbol}:trail:${latest.latestBarAt.toISOString()}`;
    const markEvent = await insertForwardEventOnce({
      deployment: input.deployment,
      symbol,
      eventType: "signal_equity_shadow_trailing_mark",
      summary: `${symbol} forward trailing stop ${stopPrice.toFixed(2)}`,
      payload: {
        dedupeKey: markKey,
        forwardTest: true,
        highWaterMark,
        stopPrice,
        latestBarAt: latest.latestBarAt.toISOString(),
      },
      occurredAt: input.evaluatedAt,
    });
    if (markEvent.created) {
      events.push(markEvent.event);
    }
    if (latest.low > stopPrice) {
      continue;
    }
    const exitKey = `${input.deployment.id}:${symbol}:trail-exit:${latest.latestBarAt.toISOString()}`;
    const exitEvent = await insertForwardEventOnce({
      deployment: input.deployment,
      symbol,
      eventType: "signal_equity_shadow_exit",
      summary: `${symbol} forward exit on ${input.profile.trailingStopPercent}% trailing stop`,
      payload: {
        dedupeKey: exitKey,
        forwardTest: true,
        exitReason: "trailing_stop",
        highWaterMark,
        stopPrice,
        latestBarAt: latest.latestBarAt.toISOString(),
      },
      occurredAt: latest.latestBarAt,
    });
    if (exitEvent.created) {
      events.push(exitEvent.event);
      await recordShadowFillForEvent({
        event: exitEvent.event,
        symbol,
        side: "sell",
        quantity,
        price: stopPrice,
        payload: exitEvent.event.payload,
      });
    }
  }
  return events;
}

async function processSignalState(input: {
  deployment: AlgoDeployment;
  profile: ForwardProfile;
  state: {
    symbol: string;
    status: string;
    fresh: boolean;
    currentSignalDirection: "buy" | "sell" | null;
    currentSignalAt: Date | string | null;
    currentSignalPrice: number | null;
    latestBarAt: Date | string | null;
    barsSinceSignal: number | null;
  };
  evaluatedAt: Date;
}) {
  const { state } = input;
  const symbol = normalizeSymbol(state.symbol).toUpperCase();
  if (
    !symbol ||
    state.status !== "ok" ||
    !state.fresh ||
    !state.currentSignalDirection ||
    !state.currentSignalAt
  ) {
    return [];
  }

  const signalAt =
    state.currentSignalAt instanceof Date
      ? state.currentSignalAt
      : new Date(state.currentSignalAt);
  const signalKey = [
    input.deployment.id,
    symbol,
    state.currentSignalDirection,
    signalAt.toISOString(),
  ].join(":");
  const signalEvent = await insertForwardEventOnce({
    deployment: input.deployment,
    symbol,
    eventType: "signal_equity_shadow_signal",
    summary: `${symbol} ${state.currentSignalDirection.toUpperCase()} signal`,
    payload: {
      dedupeKey: signalKey,
      signalKey,
      forwardTest: true,
      direction: state.currentSignalDirection,
      signalAt: signalAt.toISOString(),
      signalPrice: state.currentSignalPrice,
      latestBarAt:
        state.latestBarAt instanceof Date
          ? state.latestBarAt.toISOString()
          : state.latestBarAt,
      barsSinceSignal: state.barsSinceSignal,
    },
    occurredAt: signalAt,
  });
  const events = signalEvent.created ? [signalEvent.event] : [];
  const accountPositions = await openEquityPositions();
  const forwardPositions = await openForwardEquityPositions(input.deployment.id);
  const accountPosition = accountPositions.find(
    (position) => normalizeSymbol(position.symbol).toUpperCase() === symbol,
  );
  const forwardPosition = forwardPositions.find(
    (position) => normalizeSymbol(position.symbol).toUpperCase() === symbol,
  );

  if (state.currentSignalDirection === "sell") {
    const quantity = toNumber(forwardPosition?.quantity) ?? 0;
    if (!forwardPosition || quantity <= 0) {
      const skip = await insertForwardEventOnce({
        deployment: input.deployment,
        symbol,
        eventType: "signal_equity_shadow_skip",
        summary: `${symbol} sell signal skipped: no open forward position`,
        payload: {
          dedupeKey: `${signalKey}:skip:no_forward_position`,
          signalKey,
          forwardTest: true,
          reason: "no_forward_position",
        },
        occurredAt: input.evaluatedAt,
      });
      return skip.created ? [...events, skip.event] : events;
    }
    const latest = await latestCompletedBar({
      symbol,
      timeframe: input.profile.timeframe,
      evaluatedAt: input.evaluatedAt,
    });
    const price = state.currentSignalPrice ?? latest.close;
    if (price == null || price <= 0) {
      return events;
    }
    const exit = await insertForwardEventOnce({
      deployment: input.deployment,
      symbol,
      eventType: "signal_equity_shadow_exit",
      summary: `${symbol} forward exit on sell signal`,
      payload: {
        dedupeKey: `${signalKey}:exit`,
        signalKey,
        forwardTest: true,
        exitReason: "sell_signal",
        signalPrice: state.currentSignalPrice,
      },
      occurredAt: signalAt,
    });
    if (exit.created) {
      events.push(exit.event);
      await recordShadowFillForEvent({
        event: exit.event,
        symbol,
        side: "sell",
        quantity,
        price,
        payload: exit.event.payload,
      });
    }
    return events;
  }

  if (accountPosition) {
    const skip = await insertForwardEventOnce({
      deployment: input.deployment,
      symbol,
      eventType: "signal_equity_shadow_skip",
      summary: `${symbol} buy signal skipped: already open`,
      payload: {
        dedupeKey: `${signalKey}:skip:already_open`,
        signalKey,
        forwardTest: true,
        reason: "already_open",
      },
      occurredAt: input.evaluatedAt,
    });
    return skip.created ? [...events, skip.event] : events;
  }
  if (forwardPositions.length >= input.profile.maxOpenPositions) {
    const skip = await insertForwardEventOnce({
      deployment: input.deployment,
      symbol,
      eventType: "signal_equity_shadow_skip",
      summary: `${symbol} buy signal skipped: max open positions`,
      payload: {
        dedupeKey: `${signalKey}:skip:max_open_positions`,
        signalKey,
        forwardTest: true,
        reason: "max_open_positions",
      },
      occurredAt: input.evaluatedAt,
    });
    return skip.created ? [...events, skip.event] : events;
  }

  const latest = await latestCompletedBar({
    symbol,
    timeframe: input.profile.timeframe,
    evaluatedAt: input.evaluatedAt,
  });
  const price = state.currentSignalPrice ?? latest.close;
  if (price == null || price <= 0) {
    return events;
  }
  const summary = await getShadowAccountSummary();
  const cash = toNumber(summary.metrics.totalCash.value) ?? 0;
  const nav = toNumber(summary.metrics.netLiquidation.value) ?? cash;
  const targetNotional = Math.min(cash - 1, nav * input.profile.maxPositionFraction);
  const quantity = Math.floor(targetNotional / price);
  if (quantity <= 0) {
    const skip = await insertForwardEventOnce({
      deployment: input.deployment,
      symbol,
      eventType: "signal_equity_shadow_skip",
      summary: `${symbol} buy signal skipped: insufficient shadow cash`,
      payload: {
        dedupeKey: `${signalKey}:skip:insufficient_cash`,
        signalKey,
        forwardTest: true,
        reason: "insufficient_cash",
        cash,
        price,
      },
      occurredAt: input.evaluatedAt,
    });
    return skip.created ? [...events, skip.event] : events;
  }

  const entry = await insertForwardEventOnce({
    deployment: input.deployment,
    symbol,
    eventType: "signal_equity_shadow_entry",
    summary: `${symbol} forward entry from buy signal`,
    payload: {
      dedupeKey: `${signalKey}:entry`,
      signalKey,
      forwardTest: true,
      signalPrice: state.currentSignalPrice,
      quantity,
      highWaterMark: price,
    },
    occurredAt: signalAt,
  });
  if (entry.created) {
    events.push(entry.event);
    await recordShadowFillForEvent({
      event: entry.event,
      symbol,
      side: "buy",
      quantity,
      price,
      payload: entry.event.payload,
    });
  }
  return events;
}

async function readForwardOrdersSummary(deploymentId: string) {
  const orders = await readForwardOrders(deploymentId);
  const orderIds = orders.map((order) => order.id);
  const fills = orderIds.length
    ? await db
        .select()
        .from(shadowFillsTable)
        .where(inArray(shadowFillsTable.orderId, orderIds))
    : [];
  return {
    orders: orders.length,
    fills: fills.length,
    realizedPnl: fills.reduce((sum, fill) => sum + (toNumber(fill.realizedPnl) ?? 0), 0),
    fees: fills.reduce((sum, fill) => sum + (toNumber(fill.fees) ?? 0), 0),
    deploymentId,
  };
}

export async function runShadowEquityForwardScan(input: {
  deploymentId?: string;
  forceEvaluate?: boolean;
  source?: "manual" | "worker";
} = {}) {
  const deployment = input.deploymentId
    ? await getShadowEquityForwardDeployment(input.deploymentId)
    : await getOrCreateDeployment();
  const profile = resolveForwardProfile(deployment);
  const universe = await resolveForwardUniverse(profile);
  const monitorProfile = await configureSignalMonitor(profile);
  const evaluatedAt = new Date();

  const trailingEvents = await processTrailingStops({
    deployment,
    profile,
    evaluatedAt,
  });
  const evaluation = await evaluateSignalMonitorProfileUniverse({
    profile: monitorProfile,
    mode: "incremental",
    evaluatedAt,
    symbols: universe.symbols,
    ensureWatchlist: false,
    deactivateMissing: true,
  });

  const signalEvents: ExecutionEvent[] = [];
  for (const state of evaluation.states) {
    const events = await processSignalState({
      deployment,
      profile,
      state: state as never,
      evaluatedAt,
    });
    signalEvents.push(...events);
  }

  const lastSignal = signalEvents.find((event) =>
    event.eventType === "signal_equity_shadow_signal"
  );
  await db
    .update(algoDeploymentsTable)
    .set({
      symbolUniverse: universe.symbols,
      lastEvaluatedAt: evaluatedAt,
      lastSignalAt: lastSignal?.occurredAt ?? deployment.lastSignalAt,
      lastError: null,
      updatedAt: evaluatedAt,
    })
    .where(eq(algoDeploymentsTable.id, deployment.id));

  const events = [...trailingEvents, ...signalEvents];
  return {
    deployment: deploymentToResponse(deployment, profile),
    evaluatedAt,
    source: input.source ?? "manual",
    universe: {
      symbolCount: universe.symbols.length,
      watchlistCount: universe.watchlistCount,
      skippedSymbols: universe.skippedSymbols,
      truncated: universe.truncated,
    },
    summary: {
      statesEvaluated: evaluation.states.length,
      eventsCreated: events.length,
      freshSignals: evaluation.states.filter((state) => state.fresh).length,
      entries: events.filter((event) => event.eventType === "signal_equity_shadow_entry").length,
      exits: events.filter((event) => event.eventType === "signal_equity_shadow_exit").length,
      skips: events.filter((event) => event.eventType === "signal_equity_shadow_skip").length,
    },
    events: events.map(eventToResponse),
  };
}

async function getShadowEquityForwardDeployment(deploymentId: string) {
  const [deployment] = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.id, deploymentId))
    .limit(1);
  if (!deployment || !deploymentHasShadowEquityForwardProfile(deployment)) {
    throw new HttpError(404, "Shadow equity forward-test deployment not found.", {
      code: "shadow_equity_forward_deployment_not_found",
    });
  }
  return deployment;
}

export async function setShadowEquityForwardEnabled(enabled: boolean) {
  const deployment = await getOrCreateDeployment({ enable: enabled });
  const event = await insertForwardEventOnce({
    deployment,
    eventType: enabled
      ? "signal_equity_shadow_forward_enabled"
      : "signal_equity_shadow_forward_paused",
    summary: enabled
      ? "Enabled shadow equity forward test"
      : "Paused shadow equity forward test",
    payload: {
      dedupeKey: `${deployment.id}:${enabled ? "enabled" : "paused"}:${Date.now()}`,
      forwardTest: true,
      enabled,
    },
  });
  return {
    deployment: deploymentToResponse(deployment, resolveForwardProfile(deployment)),
    event: eventToResponse(event.event),
  };
}

function marketDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(value);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    key: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: part("weekday"),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
  };
}

function previousWeekday(dateKey: string) {
  const cursor = new Date(`${dateKey}T12:00:00.000Z`);
  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      return cursor.toISOString().slice(0, 10);
    }
  } while (true);
}

function latestCompletedMarketDate(now = new Date()) {
  const parts = marketDateParts(now);
  const isWeekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  const afterClose = parts.hour > 16 || (parts.hour === 16 && parts.minute >= 0);
  if (!isWeekend && afterClose) {
    return parts.key;
  }
  return previousWeekday(parts.key);
}

export async function seedShadowEquityForwardBaseline() {
  const marketDateTo = latestCompletedMarketDate();
  return runShadowWatchlistBacktest({
    marketDateFrom: "2025-01-01",
    marketDateTo,
    timeframe: DEFAULT_PROFILE.timeframe,
    riskOverlay: {
      label: "TR3",
      trailingStopPercent: DEFAULT_PROFILE.trailingStopPercent,
    },
    sizingOverlay: {
      label: "P10x10",
      maxPositionFraction: DEFAULT_PROFILE.maxPositionFraction,
      maxOpenPositions: DEFAULT_PROFILE.maxOpenPositions,
    },
    proxySymbols: DEFAULT_PROFILE.proxySymbols,
    excludedSymbols: DEFAULT_PROFILE.excludedSymbols,
    persist: true,
  });
}

export async function getShadowEquityForwardStatus() {
  const deployment = await findShadowEquityForwardDeployment();
  const profile = resolveForwardProfile(deployment);
  const universe = await resolveForwardUniverse(profile);
  const events = deployment
    ? await db
        .select()
        .from(executionEventsTable)
        .where(eq(executionEventsTable.deploymentId, deployment.id))
        .orderBy(desc(executionEventsTable.occurredAt))
        .limit(100)
    : [];
  const positions = deployment ? await openForwardEquityPositions(deployment.id) : [];
  const orderSummary = deployment
    ? await readForwardOrdersSummary(deployment.id)
    : { orders: 0, fills: 0, realizedPnl: 0, fees: 0, deploymentId: null };
  const staleCount = events.filter((event) => event.eventType.includes("stale")).length;
  return {
    deployment: deploymentToResponse(deployment, profile),
    universe: {
      symbolCount: universe.symbols.length,
      watchlistCount: universe.watchlistCount,
      skippedSymbols: universe.skippedSymbols,
      truncated: universe.truncated,
    },
    summary: {
      openPositions: positions.length,
      signals: events.filter((event) => event.eventType === "signal_equity_shadow_signal").length,
      entries: events.filter((event) => event.eventType === "signal_equity_shadow_entry").length,
      exits: events.filter((event) => event.eventType === "signal_equity_shadow_exit").length,
      skips: events.filter((event) => event.eventType === "signal_equity_shadow_skip").length,
      staleData: staleCount,
      ...orderSummary,
    },
    events: events.map(eventToResponse),
    positions: positions.map((position) => ({
      id: position.id,
      symbol: position.symbol,
      quantity: toNumber(position.quantity),
      averageCost: toNumber(position.averageCost),
      mark: toNumber(position.mark),
      marketValue: toNumber(position.marketValue),
      unrealizedPnl: toNumber(position.unrealizedPnl),
      updatedAt: position.updatedAt,
    })),
  };
}

export async function runShadowEquityForwardScanSafely(input: {
  deploymentId: string;
  source: "worker";
}) {
  try {
    return await runShadowEquityForwardScan({
      deploymentId: input.deploymentId,
      forceEvaluate: false,
      source: input.source,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Shadow equity forward scan failed.";
    await db
      .update(algoDeploymentsTable)
      .set({
        lastError: message,
        updatedAt: new Date(),
      })
      .where(eq(algoDeploymentsTable.id, input.deploymentId));
    logger.warn({ err: error, deploymentId: input.deploymentId }, message);
    throw error;
  }
}
