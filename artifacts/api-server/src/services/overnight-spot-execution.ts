import { and, desc, eq, inArray } from "drizzle-orm";
import {
  algoDeploymentsTable,
  db,
  executionEventsTable,
  shadowPositionsTable,
  signalMonitorSymbolStatesTable,
  type AlgoDeployment,
  type ExecutionEvent,
} from "@workspace/db";
import { asNumber, asRecord, asString, normalizeSymbol } from "../lib/values";
import type { BrokerOrderSnapshot } from "../providers/ibkr/client";
import { getAlgoDeploymentForExecution } from "./automation";
import { notifyAlgoCockpitChanged } from "./algo-cockpit-events";
import {
  buildOvernightSpotClientOrderId,
  buildOvernightSpotExecutionEventDraft,
  planOvernightSpotOrder,
  resolveOvernightSpotProfile,
  type OvernightSpotOrderRequest,
  type OvernightSpotPlanResult,
  type OvernightSpotPlanReady,
  type OvernightSpotProfile,
  type OvernightSpotQuote,
  type OvernightSpotSignal,
} from "./overnight-spot-automation";
import { getQuoteSnapshots, listPositions, placeOrder } from "./platform";
import {
  SHADOW_ACCOUNT_ID,
  placeShadowOrder,
} from "./shadow-account";
import {
  evaluateSignalMonitor,
  getSignalMonitorProfileRow,
} from "./signal-monitor";

const OVERNIGHT_SPOT_TRACKED_EVENT = "overnight_spot_signal_tracked";
const OVERNIGHT_SPOT_BLOCKED_EVENT = "overnight_spot_signal_blocked";
const OVERNIGHT_SPOT_FAILED_EVENT = "overnight_spot_order_failed";

type OvernightSpotDeployment = Pick<
  AlgoDeployment,
  | "id"
  | "name"
  | "mode"
  | "enabled"
  | "providerAccountId"
  | "symbolUniverse"
  | "config"
>;

export type OvernightSpotSignalState = {
  profileId: string;
  symbol: string;
  timeframe: string;
  currentSignalDirection: "buy" | "sell" | null;
  currentSignalAt: Date | string | number | null;
  currentSignalPrice: number | string | null;
  fresh: boolean;
  status: string;
  barsSinceSignal: number | null;
  latestBarAt?: Date | string | number | null;
  lastEvaluatedAt?: Date | string | number | null;
};

export type OvernightSpotExecutionEventInput = {
  deploymentId: string | null;
  providerAccountId: string | null;
  symbol: string | null;
  eventType: string;
  summary: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
};

export type OvernightSpotExecutionDependencies = {
  loadDeployment: (deploymentId: string) => Promise<OvernightSpotDeployment>;
  evaluateSignals: (input: {
    deploymentId: string;
    deployment: OvernightSpotDeployment;
  }) => Promise<void>;
  loadSignalStates: (input: {
    deployment: OvernightSpotDeployment;
    profile: OvernightSpotProfile;
    timeframe: string;
  }) => Promise<OvernightSpotSignalState[]>;
  loadQuotes: (
    symbols: string[],
  ) => Promise<Map<string, OvernightSpotQuote | null>>;
  loadPositionQuantities: (input: {
    deployment: OvernightSpotDeployment;
    profile: OvernightSpotProfile;
    symbols: string[];
  }) => Promise<Map<string, number>>;
  findExistingEventByClientOrderId: (input: {
    deploymentId: string;
    clientOrderId: string;
  }) => Promise<Record<string, unknown> | null>;
  insertExecutionEvent: (
    input: OvernightSpotExecutionEventInput,
  ) => Promise<Record<string, unknown>>;
  placeShadowOrder: (
    order: OvernightSpotOrderRequest & { sourceEventId?: string | null },
  ) => Promise<Record<string, unknown>>;
  placeLiveOrder: (
    order: OvernightSpotOrderRequest,
  ) => Promise<BrokerOrderSnapshot | Record<string, unknown>>;
  notifyChanged: (input: {
    deploymentId: string;
    mode: "paper" | "live";
    reason: string;
  }) => void;
};

export type OvernightSpotSignalScanResult = {
  deploymentId: string;
  executionMode: OvernightSpotProfile["executionMode"];
  runActions: boolean;
  candidateCount: number;
  trackedCount: number;
  blockedCount: number;
  skippedCount: number;
  executedCount: number;
  failedCount: number;
  results: Array<{
    symbol: string;
    clientOrderId: string;
    status:
      | "tracked"
      | "blocked"
      | "skipped"
      | "executed"
      | "failed";
    eventType?: string;
    eventId?: string | null;
    blockerCodes?: string[];
    reason?: string;
  }>;
};

type RunOvernightSpotSignalScanInput = {
  deploymentId: string;
  forceEvaluate?: boolean;
  runActions?: boolean;
  recordSignals?: boolean;
  now?: Date;
  env?: Record<string, string | undefined>;
};

function dateOrNull(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 1e11 ? value : value * 1_000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = asString(value);
  if (!text) {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeTimeframe(value: unknown, fallback: string): string {
  const timeframe = asString(value);
  return timeframe ?? fallback;
}

function resolveSignalTimeframe(
  deployment: OvernightSpotDeployment,
  fallback = "15m",
): string {
  const config = asRecord(deployment.config) ?? {};
  const parameters = asRecord(config.parameters) ?? {};
  const overnightSpot = asRecord(config.overnightSpot) ?? {};
  return normalizeTimeframe(
    overnightSpot.signalTimeframe ?? parameters.signalTimeframe,
    fallback,
  );
}

function signalStateToSignal(state: OvernightSpotSignalState): OvernightSpotSignal {
  const side = state.currentSignalDirection;
  if (side !== "buy" && side !== "sell") {
    throw new Error("Cannot build overnight spot signal without a direction.");
  }
  const signalAt = dateOrNull(state.currentSignalAt);
  const symbol = normalizeSymbol(state.symbol).toUpperCase();
  return {
    symbol,
    side,
    stage: side === "buy" ? "entry" : "exit",
    signalId: [
      "signal-monitor",
      state.profileId,
      symbol,
      state.timeframe,
      side,
      signalAt?.getTime() ?? "unknown",
    ].join(":"),
    signalAt,
    actionable: state.status === "ok" && state.fresh === true,
    referencePrice: asNumber(state.currentSignalPrice),
    source: "automation",
    metadata: {
      source: "signal_monitor_symbol_state",
      profileId: state.profileId,
      timeframe: state.timeframe,
      barsSinceSignal: state.barsSinceSignal,
      latestBarAt: dateOrNull(state.latestBarAt)?.toISOString() ?? null,
      lastEvaluatedAt: dateOrNull(state.lastEvaluatedAt)?.toISOString() ?? null,
      status: state.status,
      fresh: state.fresh,
    },
  };
}

function trackClientOrderId(input: {
  deploymentId: string;
  signal: OvernightSpotSignal;
}) {
  const signalAt = dateOrNull(input.signal.signalAt);
  return buildOvernightSpotClientOrderId({
    deploymentId: input.deploymentId,
    symbol: input.signal.symbol,
    side: input.signal.side,
    stage: input.signal.stage ?? (input.signal.side === "buy" ? "entry" : "exit"),
    signalId: input.signal.signalId,
    signalAt,
  });
}

function eventPayload(input: {
  clientOrderId: string;
  signal: OvernightSpotSignal;
  plan: OvernightSpotPlanResult;
  runActions: boolean;
}) {
  return {
    automation: "overnight_spot",
    clientOrderId: input.clientOrderId,
    runActions: input.runActions,
    signal: input.signal,
    plan: input.plan,
  };
}

function eventId(event: Record<string, unknown> | null | undefined) {
  if (event?.id === null || event?.id === undefined) {
    return null;
  }
  return String(event.id);
}

async function insertEvent(
  deps: OvernightSpotExecutionDependencies,
  input: {
    deployment: OvernightSpotDeployment;
    eventType: string;
    summary: string;
    symbol: string | null;
    payload: Record<string, unknown>;
    occurredAt: Date;
  },
) {
  const event = await deps.insertExecutionEvent({
    deploymentId: input.deployment.id,
    providerAccountId: input.deployment.providerAccountId,
    symbol: input.symbol ? normalizeSymbol(input.symbol).toUpperCase() : null,
    eventType: input.eventType,
    summary: input.summary,
    payload: input.payload,
    occurredAt: input.occurredAt,
  });
  deps.notifyChanged({
    deploymentId: input.deployment.id,
    mode: input.deployment.mode,
    reason: input.eventType,
  });
  return event;
}

async function handleReadyPlan(input: {
  deps: OvernightSpotExecutionDependencies;
  deployment: OvernightSpotDeployment;
  plan: OvernightSpotPlanReady;
  signal: OvernightSpotSignal;
  runActions: boolean;
  recordSignals: boolean;
  now: Date;
}) {
  const payload = eventPayload({
    clientOrderId: input.plan.clientOrderId,
    signal: input.signal,
    plan: input.plan,
    runActions: input.runActions,
  });

  if (!input.runActions) {
    if (!input.recordSignals) {
      return {
        status: "skipped" as const,
        reason: "record_signals_disabled",
      };
    }
    const event = await insertEvent(input.deps, {
      deployment: input.deployment,
      eventType: OVERNIGHT_SPOT_TRACKED_EVENT,
      summary: `${input.plan.order.symbol} overnight spot signal tracked`,
      symbol: input.plan.order.symbol,
      payload,
      occurredAt: input.now,
    });
    return {
      status: "tracked" as const,
      eventType: OVERNIGHT_SPOT_TRACKED_EVENT,
      eventId: eventId(event),
    };
  }

  if (input.plan.profile.executionMode === "shadow") {
    const draft = buildOvernightSpotExecutionEventDraft(input.plan, {
      deploymentId: input.deployment.id,
      occurredAt: input.now,
    });
    const event = await insertEvent(input.deps, {
      deployment: input.deployment,
      eventType: draft.eventType,
      summary: draft.summary,
      symbol: draft.symbol,
      payload: {
        ...draft.payload,
        clientOrderId: input.plan.clientOrderId,
      },
      occurredAt: draft.occurredAt,
    });
    await input.deps.placeShadowOrder({
      ...input.plan.order,
      sourceEventId: typeof event.id === "string" ? event.id : String(event.id ?? ""),
    });
    return {
      status: "executed" as const,
      eventType: draft.eventType,
      eventId: eventId(event),
    };
  }

  try {
    const brokerOrder = await input.deps.placeLiveOrder(input.plan.order);
    const draft = buildOvernightSpotExecutionEventDraft(input.plan, {
      deploymentId: input.deployment.id,
      occurredAt: input.now,
    });
    const event = await insertEvent(input.deps, {
      deployment: input.deployment,
      eventType: draft.eventType,
      summary: draft.summary,
      symbol: draft.symbol,
      payload: {
        ...draft.payload,
        clientOrderId: input.plan.clientOrderId,
        brokerOrder,
      },
      occurredAt: draft.occurredAt,
    });
    return {
      status: "executed" as const,
      eventType: draft.eventType,
      eventId: eventId(event),
    };
  } catch (error) {
    const event = await insertEvent(input.deps, {
      deployment: input.deployment,
      eventType: OVERNIGHT_SPOT_FAILED_EVENT,
      summary: `${input.plan.order.symbol} overnight spot live order failed`,
      symbol: input.plan.order.symbol,
      payload: {
        ...payload,
        error: error instanceof Error ? error.message : String(error),
      },
      occurredAt: input.now,
    });
    return {
      status: "failed" as const,
      eventType: OVERNIGHT_SPOT_FAILED_EVENT,
      eventId: eventId(event),
    };
  }
}

async function handleBlockedPlan(input: {
  deps: OvernightSpotExecutionDependencies;
  deployment: OvernightSpotDeployment;
  plan: Extract<OvernightSpotPlanResult, { status: "blocked" }>;
  signal: OvernightSpotSignal;
  clientOrderId: string;
  runActions: boolean;
  recordSignals: boolean;
  now: Date;
}) {
  if (!input.recordSignals) {
    return {
      status: "skipped" as const,
      reason: "record_signals_disabled",
    };
  }
  const event = await insertEvent(input.deps, {
    deployment: input.deployment,
    eventType: OVERNIGHT_SPOT_BLOCKED_EVENT,
    summary: `${input.signal.symbol} overnight spot signal blocked`,
    symbol: input.signal.symbol,
    payload: eventPayload({
      clientOrderId: input.clientOrderId,
      signal: input.signal,
      plan: input.plan,
      runActions: input.runActions,
    }),
    occurredAt: input.now,
  });
  return {
    status: "blocked" as const,
    eventType: OVERNIGHT_SPOT_BLOCKED_EVENT,
    eventId: eventId(event),
    blockerCodes: input.plan.blockers.map((blocker) => blocker.code),
  };
}

export async function runOvernightSpotSignalScan(
  input: RunOvernightSpotSignalScanInput,
  dependencies: OvernightSpotExecutionDependencies = defaultOvernightSpotExecutionDependencies,
): Promise<OvernightSpotSignalScanResult> {
  const deployment = await dependencies.loadDeployment(input.deploymentId);
  const profile = resolveOvernightSpotProfile({
    config: deployment.config,
    providerAccountId: deployment.providerAccountId,
  });
  const timeframe = resolveSignalTimeframe(deployment);
  const now = input.now ?? new Date();
  const runActions = input.runActions === true;
  const recordSignals = input.recordSignals !== false;

  if (input.forceEvaluate) {
    await dependencies.evaluateSignals({
      deploymentId: deployment.id,
      deployment,
    });
  }

  const states = (await dependencies.loadSignalStates({
    deployment,
    profile,
    timeframe,
  })).filter(
    (state) =>
      state.currentSignalDirection === "buy" ||
      state.currentSignalDirection === "sell",
  );
  const symbols = Array.from(
    new Set(states.map((state) => normalizeSymbol(state.symbol).toUpperCase())),
  );
  const [quotes, positionQuantities] = await Promise.all([
    dependencies.loadQuotes(symbols),
    dependencies.loadPositionQuantities({
      deployment,
      profile,
      symbols,
    }),
  ]);

  const results: OvernightSpotSignalScanResult["results"] = [];

  for (const state of states) {
    const signal = signalStateToSignal(state);
    const clientOrderId = trackClientOrderId({
      deploymentId: deployment.id,
      signal,
    });
    const existing = await dependencies.findExistingEventByClientOrderId({
      deploymentId: deployment.id,
      clientOrderId,
    });
    if (existing) {
      results.push({
        symbol: signal.symbol,
        clientOrderId,
        status: "skipped",
        reason: "duplicate_client_order_id",
        eventId: eventId(existing),
        eventType:
          typeof existing.eventType === "string" ? existing.eventType : undefined,
      });
      continue;
    }

    const plan = planOvernightSpotOrder({
      profile,
      deploymentId: deployment.id,
      deploymentMode: deployment.mode,
      providerAccountId: deployment.providerAccountId,
      signal,
      quote: quotes.get(signal.symbol) ?? null,
      existingPositionQuantity: positionQuantities.get(signal.symbol) ?? null,
      now,
      env: input.env,
    });

    const handled =
      plan.status === "ready"
        ? await handleReadyPlan({
            deps: dependencies,
            deployment,
            plan,
            signal,
            runActions,
            recordSignals,
            now,
          })
        : await handleBlockedPlan({
            deps: dependencies,
            deployment,
            plan,
            signal,
            clientOrderId,
            runActions,
            recordSignals,
            now,
          });

    results.push({
      symbol: signal.symbol,
      clientOrderId,
      ...handled,
    });
  }

  return {
    deploymentId: deployment.id,
    executionMode: profile.executionMode,
    runActions,
    candidateCount: states.length,
    trackedCount: results.filter((result) =>
      ["tracked", "blocked", "executed", "failed"].includes(result.status),
    ).length,
    blockedCount: results.filter((result) => result.status === "blocked").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    executedCount: results.filter((result) => result.status === "executed").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    results,
  };
}

async function loadDeployment(deploymentId: string) {
  return getAlgoDeploymentForExecution({ deploymentId });
}

async function loadSignalStates(input: {
  deployment: OvernightSpotDeployment;
  timeframe: string;
}) {
  const profile = await getSignalMonitorProfileRow({
    environment: input.deployment.mode,
    ensureWatchlist: false,
  });
  const symbols = input.deployment.symbolUniverse
    .map((symbol) => normalizeSymbol(symbol).toUpperCase())
    .filter(Boolean);
  if (!symbols.length) {
    return [];
  }
  const states = await db
    .select()
    .from(signalMonitorSymbolStatesTable)
    .where(
      and(
        eq(signalMonitorSymbolStatesTable.profileId, profile.id),
        inArray(signalMonitorSymbolStatesTable.symbol, symbols),
        eq(signalMonitorSymbolStatesTable.timeframe, input.timeframe),
        eq(signalMonitorSymbolStatesTable.active, true),
      ),
    );
  return states.map((state): OvernightSpotSignalState => ({
    profileId: profile.id,
    symbol: state.symbol,
    timeframe: state.timeframe,
    currentSignalDirection:
      state.currentSignalDirection === "buy" ||
      state.currentSignalDirection === "sell"
        ? state.currentSignalDirection
        : null,
    currentSignalAt: state.currentSignalAt,
    currentSignalPrice: state.currentSignalPrice,
    fresh: state.fresh,
    status: state.status,
    barsSinceSignal: state.barsSinceSignal,
    latestBarAt: state.latestBarAt,
    lastEvaluatedAt: state.lastEvaluatedAt,
  }));
}

async function loadQuotes(symbols: string[]) {
  if (!symbols.length) {
    return new Map<string, OvernightSpotQuote | null>();
  }
  const response = await getQuoteSnapshots({
    symbols: symbols.join(","),
    allowMassiveFallback: false,
    admissionOwner: "overnight-spot-automation",
    admissionIntent: "automation-live",
  });
  return new Map(
    response.quotes.map((quote) => [
      normalizeSymbol(quote.symbol).toUpperCase(),
      quote,
    ]),
  );
}

async function loadPositionQuantities(input: {
  deployment: OvernightSpotDeployment;
  profile: OvernightSpotProfile;
  symbols: string[];
}) {
  const symbols = new Set(
    input.symbols.map((symbol) => normalizeSymbol(symbol).toUpperCase()),
  );
  const quantities = new Map<string, number>();
  if (!symbols.size) {
    return quantities;
  }

  if (
    input.profile.executionMode === "live" &&
    input.deployment.mode === "live"
  ) {
    const positions = await listPositions({
      accountId: input.profile.accountId ?? input.deployment.providerAccountId,
      mode: input.deployment.mode,
    });
    for (const position of positions.positions) {
      if (position.assetClass !== "equity" || position.optionContract) {
        continue;
      }
      const symbol = normalizeSymbol(position.symbol).toUpperCase();
      if (!symbols.has(symbol)) {
        continue;
      }
      quantities.set(symbol, (quantities.get(symbol) ?? 0) + Number(position.quantity));
    }
    return quantities;
  }

  const rows = await db
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowPositionsTable.assetClass, "equity"),
        eq(shadowPositionsTable.status, "open"),
        inArray(shadowPositionsTable.symbol, Array.from(symbols)),
      ),
    );
  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol).toUpperCase();
    quantities.set(symbol, (quantities.get(symbol) ?? 0) + (asNumber(row.quantity) ?? 0));
  }
  return quantities;
}

function payloadClientOrderId(payload: unknown): string | null {
  const record = asRecord(payload) ?? {};
  const direct = asString(record.clientOrderId);
  if (direct) {
    return direct;
  }
  const order = asRecord(record.order) ?? {};
  const orderId = asString(order.clientOrderId);
  if (orderId) {
    return orderId;
  }
  const plan = asRecord(record.plan) ?? {};
  const planId = asString(plan.clientOrderId);
  if (planId) {
    return planId;
  }
  return null;
}

async function findExistingEventByClientOrderId(input: {
  deploymentId: string;
  clientOrderId: string;
}) {
  const rows = await db
    .select()
    .from(executionEventsTable)
    .where(eq(executionEventsTable.deploymentId, input.deploymentId))
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(1_000);
  return (
    rows.find((row) => payloadClientOrderId(row.payload) === input.clientOrderId) ??
    null
  );
}

async function insertExecutionEvent(input: OvernightSpotExecutionEventInput) {
  const [event] = await db
    .insert(executionEventsTable)
    .values({
      deploymentId: input.deploymentId,
      providerAccountId: input.providerAccountId,
      symbol: input.symbol,
      eventType: input.eventType,
      summary: input.summary,
      payload: input.payload,
      occurredAt: input.occurredAt,
    })
    .returning();
  return event as ExecutionEvent;
}

async function evaluateSignals(input: {
  deployment: OvernightSpotDeployment;
}) {
  await evaluateSignalMonitor({
    environment: input.deployment.mode,
    mode: "incremental",
  });
}

export const defaultOvernightSpotExecutionDependencies: OvernightSpotExecutionDependencies = {
  loadDeployment,
  evaluateSignals,
  loadSignalStates,
  loadQuotes,
  loadPositionQuantities,
  findExistingEventByClientOrderId,
  insertExecutionEvent,
  placeShadowOrder,
  placeLiveOrder: placeOrder,
  notifyChanged: notifyAlgoCockpitChanged,
};

export const __overnightSpotExecutionInternalsForTests = {
  signalStateToSignal,
  resolveSignalTimeframe,
  payloadClientOrderId,
};
