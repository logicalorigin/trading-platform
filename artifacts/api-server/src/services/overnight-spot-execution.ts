import { and, desc, eq, inArray, lt } from "drizzle-orm";
import {
  algoDeploymentsTable,
  automationDiagnosticsTable,
  db,
  executionEventsTable,
  shadowOrdersTable,
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
  type OvernightSpotPlanBlocked,
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
const OVERNIGHT_SPOT_QUOTE_BATCH_SIZE = 3;

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
    signal?: AbortSignal;
  }) => Promise<void>;
  loadSignalStates: (input: {
    deployment: OvernightSpotDeployment;
    profile: OvernightSpotProfile;
    timeframe: string;
    signal?: AbortSignal;
  }) => Promise<OvernightSpotSignalState[]>;
  loadQuotes: (
    symbols: string[],
    signal?: AbortSignal,
  ) => Promise<Map<string, OvernightSpotQuote | null>>;
  loadPositionQuantities: (input: {
    deployment: OvernightSpotDeployment;
    profile: OvernightSpotProfile;
    symbols: string[];
    signal?: AbortSignal;
  }) => Promise<Map<string, number>>;
  findExistingEventByClientOrderId: (input: {
    deploymentId: string;
    clientOrderId: string;
  }) => Promise<Record<string, unknown> | null>;
  insertExecutionEvent: (
    input: OvernightSpotExecutionEventInput,
  ) => Promise<Record<string, unknown>>;
  insertDiagnosticEvent: (
    input: OvernightSpotExecutionEventInput,
  ) => Promise<Record<string, unknown>>;
  placeShadowOrder: (
    order: OvernightSpotOrderRequest & {
      requestedFillPrice?: number | null;
      sourceEventId?: string | null;
    },
  ) => Promise<Record<string, unknown>>;
  placeLiveOrder: (
    order: OvernightSpotOrderRequest,
  ) => Promise<BrokerOrderSnapshot | Record<string, unknown>>;
  notifyChanged: (input: {
    deploymentId: string;
    mode: "shadow" | "live";
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

export type OvernightSpotWorkerDeployment = OvernightSpotDeployment;

type RunOvernightSpotSignalScanInput = {
  deploymentId: string;
  forceEvaluate?: boolean;
  runActions?: boolean;
  recordSignals?: boolean;
  // Positions/exit-only degrade under resource pressure: evaluate only SELL (exit)
  // signals so open longs can still be closed, and shed all entry (buy) work.
  // Sells with no open long self-block via overnight_spot_exit_position_required.
  skipEntryWork?: boolean;
  now?: Date;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
};

function throwIfOvernightSpotScanAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  const reason = signal.reason;
  throw reason instanceof Error ? reason : new Error("Overnight spot scan aborted.");
}

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

function isSignalStateActionableForOvernightSpot(input: {
  state: OvernightSpotSignalState;
  profile: OvernightSpotProfile;
  now: Date;
}) {
  const side = input.state.currentSignalDirection;
  if (side !== "buy" && side !== "sell") {
    return false;
  }
  if (input.state.status !== "ok") {
    return false;
  }
  const signalAt = dateOrNull(input.state.currentSignalAt);
  if (!signalAt) {
    return false;
  }
  const signalAgeMs = Math.max(0, input.now.getTime() - signalAt.getTime());
  return signalAgeMs <= input.profile.maxSignalAgeMs;
}

function signalStateToSignal(
  state: OvernightSpotSignalState,
  options: { actionable?: boolean } = {},
): OvernightSpotSignal {
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
    actionable:
      options.actionable ?? (state.status === "ok" && state.fresh === true),
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

function overnightSpotShadowFillPrice(plan: OvernightSpotPlanReady): number | null {
  const quote = plan.order.payload.quote;
  const record = asRecord(quote) ?? {};
  const sidePrice =
    plan.order.side === "buy"
      ? asNumber(record.ask)
      : asNumber(record.bid);
  if (sidePrice !== null && sidePrice > 0) {
    return sidePrice;
  }
  const mid = asNumber(record.mid);
  return mid !== null && mid > 0 ? mid : null;
}

export function deploymentHasOvernightSpotProfile(
  deployment: OvernightSpotDeployment,
) {
  const profile = resolveOvernightSpotProfile({
    config: deployment.config,
    providerAccountId: deployment.providerAccountId,
  });
  return profile.enabled && profile.executionMode !== "disabled";
}

function shouldSkipExistingClientOrderEvent(input: {
  existing: Record<string, unknown>;
  runActions: boolean;
}) {
  if (!input.runActions) {
    return true;
  }
  const eventType = asString(input.existing.eventType) ?? "";
  return (
    eventType.startsWith("overnight_spot_shadow_") ||
    eventType.startsWith("overnight_spot_live_") ||
    eventType === OVERNIGHT_SPOT_FAILED_EVENT
  );
}

function overnightSpotBlockerCodes(plan: unknown) {
  const record = asRecord(plan) ?? {};
  const blockers = Array.isArray(record.blockers) ? record.blockers : [];
  return blockers
    .map((blocker) => asString(asRecord(blocker)?.code))
    .filter((code): code is string => Boolean(code))
    .sort();
}

function sameOvernightSpotBlockerCodes(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((code, index) => code === right[index])
  );
}

function shouldSkipDuplicateBlockedPlan(input: {
  existing: Record<string, unknown>;
  plan: OvernightSpotPlanBlocked;
}) {
  const eventType = asString(input.existing.eventType) ?? "";
  if (eventType !== OVERNIGHT_SPOT_BLOCKED_EVENT) {
    return false;
  }
  // Log a blocked row only on a state TRANSITION: suppress whenever the most
  // recent blocked event for this client order has the SAME blocker codes,
  // regardless of age. A new block, a changed blocker reason, or a non-blocked
  // event in between all fall through and record. This replaces the old 30-minute
  // re-log window that re-persisted an unchanged block every half hour all night
  // (the dominant source of execution_events bloat).
  const payload = asRecord(input.existing.payload) ?? {};
  const existingPlan = asRecord(payload.plan) ?? {};
  return sameOvernightSpotBlockerCodes(
    overnightSpotBlockerCodes(existingPlan),
    overnightSpotBlockerCodes(input.plan),
  );
}

// Telemetry/noise events redirected to automation_diagnostics. The ledger
// (execution_events) keeps everything load-bearing: shadow/live execution events
// and overnight_spot_order_failed (the latter is the order-idempotency terminal
// marker). Keep this set in sync with the dedup union in
// findExistingEventByClientOrderId, which reads BOTH tables.
const OVERNIGHT_SPOT_DIAGNOSTIC_EVENT_TYPES = new Set<string>([
  OVERNIGHT_SPOT_TRACKED_EVENT,
  OVERNIGHT_SPOT_BLOCKED_EVENT,
]);

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
  const write = OVERNIGHT_SPOT_DIAGNOSTIC_EVENT_TYPES.has(input.eventType)
    ? deps.insertDiagnosticEvent
    : deps.insertExecutionEvent;
  const event = await write({
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
    let event: Record<string, unknown> | null = null;
    try {
      const draft = buildOvernightSpotExecutionEventDraft(input.plan, {
        deploymentId: input.deployment.id,
        occurredAt: input.now,
      });
      event = await insertEvent(input.deps, {
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
        requestedFillPrice: overnightSpotShadowFillPrice(input.plan),
        sourceEventId:
          typeof event.id === "string" ? event.id : String(event.id ?? ""),
      });
      return {
        status: "executed" as const,
        eventType: draft.eventType,
        eventId: eventId(event),
      };
    } catch (error) {
      const failed = await insertEvent(input.deps, {
        deployment: input.deployment,
        eventType: OVERNIGHT_SPOT_FAILED_EVENT,
        summary: `${input.plan.order.symbol} overnight spot shadow order failed`,
        symbol: input.plan.order.symbol,
        payload: {
          ...payload,
          sourceEventId: eventId(event),
          error: error instanceof Error ? error.message : String(error),
        },
        occurredAt: new Date(Math.max(input.now.getTime(), Date.now())),
      });
      return {
        status: "failed" as const,
        eventType: OVERNIGHT_SPOT_FAILED_EVENT,
        eventId: eventId(failed),
      };
    }
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
  throwIfOvernightSpotScanAborted(input.signal);
  const deployment = await dependencies.loadDeployment(input.deploymentId);
  throwIfOvernightSpotScanAborted(input.signal);
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
      signal: input.signal,
    });
    throwIfOvernightSpotScanAborted(input.signal);
  }

  const states = (await dependencies.loadSignalStates({
    deployment,
    profile,
    timeframe,
    signal: input.signal,
  })).filter(
    (state) =>
      state.currentSignalDirection === "buy" ||
      state.currentSignalDirection === "sell",
  );
  throwIfOvernightSpotScanAborted(input.signal);
  const actionStates = (
    runActions && profile.requireActionableSignal
      ? states.filter((state) =>
          isSignalStateActionableForOvernightSpot({ state, profile, now }),
        )
      : states
  ).filter(
    (state) =>
      // Under a resource-pressure degrade, act on exit (sell) signals only so open
      // longs stay closeable while entry (buy) work is shed.
      input.skipEntryWork !== true || state.currentSignalDirection === "sell",
  );
  const symbols = Array.from(
    new Set(actionStates.map((state) => normalizeSymbol(state.symbol).toUpperCase())),
  );
  const [quotes, positionQuantities] = await Promise.all([
    dependencies.loadQuotes(symbols, input.signal),
    dependencies.loadPositionQuantities({
      deployment,
      profile,
      symbols,
      signal: input.signal,
    }),
  ]);
  throwIfOvernightSpotScanAborted(input.signal);

  const results: OvernightSpotSignalScanResult["results"] = [];

  for (const state of actionStates) {
    throwIfOvernightSpotScanAborted(input.signal);
    const signal = signalStateToSignal(state, {
      actionable: isSignalStateActionableForOvernightSpot({ state, profile, now }),
    });
    const clientOrderId = trackClientOrderId({
      deploymentId: deployment.id,
      signal,
    });
    const existing = await dependencies.findExistingEventByClientOrderId({
      deploymentId: deployment.id,
      clientOrderId,
    });
    throwIfOvernightSpotScanAborted(input.signal);
    if (
      existing &&
      shouldSkipExistingClientOrderEvent({
        existing,
        runActions,
      })
    ) {
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

    if (
      plan.status === "blocked" &&
      existing &&
      shouldSkipDuplicateBlockedPlan({ existing, plan })
    ) {
      results.push({
        symbol: signal.symbol,
        clientOrderId,
        status: "skipped",
        reason: "duplicate_blocked_client_order_id",
        eventId: eventId(existing),
        eventType: asString(existing.eventType) ?? undefined,
        blockerCodes: plan.blockers.map((blocker) => blocker.code),
      });
      continue;
    }

    throwIfOvernightSpotScanAborted(input.signal);
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
    throwIfOvernightSpotScanAborted(input.signal);

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
    candidateCount: actionStates.length,
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

export async function listEnabledOvernightSpotDeployments() {
  const deployments = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.enabled, true))
    .orderBy(desc(algoDeploymentsTable.updatedAt));
  return deployments.filter(deploymentHasOvernightSpotProfile);
}

async function loadSignalStates(input: {
  deployment: OvernightSpotDeployment;
  timeframe: string;
  signal?: AbortSignal;
}) {
  throwIfOvernightSpotScanAborted(input.signal);
  const profile = await getSignalMonitorProfileRow({
    environment: input.deployment.mode,
    ensureWatchlist: false,
  });
  throwIfOvernightSpotScanAborted(input.signal);
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
  throwIfOvernightSpotScanAborted(input.signal);
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

async function loadQuotes(symbols: string[], signal?: AbortSignal) {
  throwIfOvernightSpotScanAborted(signal);
  if (!symbols.length) {
    return new Map<string, OvernightSpotQuote | null>();
  }
  const quotes = new Map<string, OvernightSpotQuote | null>();
  for (let index = 0; index < symbols.length; index += OVERNIGHT_SPOT_QUOTE_BATCH_SIZE) {
    throwIfOvernightSpotScanAborted(signal);
    const batch = symbols.slice(index, index + OVERNIGHT_SPOT_QUOTE_BATCH_SIZE);
    const response = await getQuoteSnapshots({
      symbols: batch.join(","),
      allowMassiveFallback: false,
      admissionOwner: "overnight-spot-automation",
      admissionIntent: "automation-live",
      tradingSession: "overnight",
    });
    throwIfOvernightSpotScanAborted(signal);
    response.quotes.forEach((quote) => {
      quotes.set(normalizeSymbol(quote.symbol).toUpperCase(), quote);
    });
  }
  return quotes;
}

async function loadPositionQuantities(input: {
  deployment: OvernightSpotDeployment;
  profile: OvernightSpotProfile;
  symbols: string[];
  signal?: AbortSignal;
}) {
  throwIfOvernightSpotScanAborted(input.signal);
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
    throwIfOvernightSpotScanAborted(input.signal);
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
  throwIfOvernightSpotScanAborted(input.signal);
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

type ClientOrderRow = {
  eventType?: unknown;
  payload?: unknown;
  occurredAt?: Date | string | number | null;
};

function clientOrderRowOccurredAtMs(row: ClientOrderRow): number {
  const occurredAt = dateOrNull(row.occurredAt);
  return occurredAt ? occurredAt.getTime() : 0;
}

// Pure merge+match for the dedup/idempotency lookup. Merges ledger rows
// (execution_events: overnight_spot_{shadow,live}_* + overnight_spot_order_failed,
// the order-idempotency terminal markers) with diagnostics rows
// (automation_diagnostics: overnight_spot_signal_blocked, the blocked-dedup
// marker) and returns the SINGLE newest payload-clientOrderId match across BOTH
// tables — reproducing the pre-split single-table "first match in occurred_at
// desc" semantics. clientOrderId is a deterministic sha256, so one id can carry
// BOTH a blocked row (diagnostics) AND a terminal order row (ledger); the newest
// wins, so a placed/failed order always shadows an older block -> no re-place.
// hasShadowOrder gates a shadow-execution row on the shadow order actually
// existing (matches the original behavior); kept as a callback so this stays a
// pure, DB-free, testable function.
async function selectExistingEventByClientOrderId<T extends ClientOrderRow>(input: {
  ledgerRows: T[];
  diagnosticRows: T[];
  clientOrderId: string;
  hasShadowOrder: (clientOrderId: string) => Promise<boolean>;
}): Promise<T | null> {
  const rows = [...input.ledgerRows, ...input.diagnosticRows].sort(
    (left, right) =>
      clientOrderRowOccurredAtMs(right) - clientOrderRowOccurredAtMs(left),
  );
  for (const row of rows) {
    if (payloadClientOrderId(row.payload) !== input.clientOrderId) {
      continue;
    }
    const eventType = asString(row.eventType) ?? "";
    if (eventType.startsWith("overnight_spot_shadow_")) {
      if (!(await input.hasShadowOrder(input.clientOrderId))) {
        continue;
      }
    }
    return row;
  }
  return null;
}

async function findExistingEventByClientOrderId(input: {
  deploymentId: string;
  clientOrderId: string;
}) {
  // Two reads, one per table, then merge in JS. The dedup/idempotency consumers
  // need: terminal order rows (shadow/live/failed) -> execution_events; the
  // blocked-dedup marker (overnight_spot_signal_blocked) -> automation_diagnostics.
  const [ledgerRows, diagnosticRows] = await Promise.all([
    db
      .select()
      .from(executionEventsTable)
      .where(eq(executionEventsTable.deploymentId, input.deploymentId))
      .orderBy(desc(executionEventsTable.occurredAt))
      .limit(1_000),
    db
      .select()
      .from(automationDiagnosticsTable)
      .where(eq(automationDiagnosticsTable.deploymentId, input.deploymentId))
      .orderBy(desc(automationDiagnosticsTable.occurredAt))
      .limit(1_000),
  ]);
  return selectExistingEventByClientOrderId({
    ledgerRows: ledgerRows as ClientOrderRow[],
    diagnosticRows: diagnosticRows as ClientOrderRow[],
    clientOrderId: input.clientOrderId,
    hasShadowOrder: async (clientOrderId) => {
      const orders = await db
        .select({ id: shadowOrdersTable.id })
        .from(shadowOrdersTable)
        .where(eq(shadowOrdersTable.clientOrderId, clientOrderId))
        .limit(1);
      return Boolean(orders[0]);
    },
  });
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

async function insertDiagnosticEvent(input: OvernightSpotExecutionEventInput) {
  const [event] = await db
    .insert(automationDiagnosticsTable)
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
  // Phase 2 retention: best-effort, self-throttled prune piggybacked on the
  // diagnostic write. Off the write path (fire-and-forget) and never throws back.
  void pruneAutomationDiagnostics().catch(() => {});
  return event;
}

// Keep automation_diagnostics bounded to a 7-day lookback (owner-decided
// 2026-06-24; deeper "why blocked" history lives in the flight recorder). Mirrors
// pruneHistoricalFlowEvents: piggybacked on the diagnostic write path and
// self-throttled, so it runs only while the table is actually growing (overnight)
// and never on a standalone timer.
const AUTOMATION_DIAGNOSTICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const AUTOMATION_DIAGNOSTICS_PRUNE_INTERVAL_MS = 60 * 60 * 1_000;
let lastAutomationDiagnosticsPruneMs = 0;

// Pure decision so the throttle window and 7-day cutoff are unit-testable without
// a DB or module state.
function computeAutomationDiagnosticsPrune(
  nowMs: number,
  lastPruneMs: number,
): { shouldPrune: boolean; cutoff: Date } {
  return {
    shouldPrune:
      nowMs - lastPruneMs >= AUTOMATION_DIAGNOSTICS_PRUNE_INTERVAL_MS,
    cutoff: new Date(nowMs - AUTOMATION_DIAGNOSTICS_RETENTION_MS),
  };
}

async function deleteAutomationDiagnosticsOlderThan(cutoff: Date) {
  return db
    .delete(automationDiagnosticsTable)
    .where(lt(automationDiagnosticsTable.occurredAt, cutoff));
}

async function pruneAutomationDiagnostics(
  now = new Date(),
  deleteOlderThan: (
    cutoff: Date,
  ) => Promise<unknown> = deleteAutomationDiagnosticsOlderThan,
): Promise<void> {
  const { shouldPrune, cutoff } = computeAutomationDiagnosticsPrune(
    now.getTime(),
    lastAutomationDiagnosticsPruneMs,
  );
  if (!shouldPrune) {
    return;
  }
  // Set synchronously (before the await) so concurrent diagnostic writes can't
  // each launch a prune in the same window.
  lastAutomationDiagnosticsPruneMs = now.getTime();
  await deleteOlderThan(cutoff);
}

async function evaluateSignals(input: {
  deployment: OvernightSpotDeployment;
  signal?: AbortSignal;
}) {
  throwIfOvernightSpotScanAborted(input.signal);
  await evaluateSignalMonitor({
    environment: input.deployment.mode,
    mode: "incremental",
  });
  throwIfOvernightSpotScanAborted(input.signal);
}

export const defaultOvernightSpotExecutionDependencies: OvernightSpotExecutionDependencies = {
  loadDeployment,
  evaluateSignals,
  loadSignalStates,
  loadQuotes,
  loadPositionQuantities,
  findExistingEventByClientOrderId,
  insertExecutionEvent,
  insertDiagnosticEvent,
  placeShadowOrder,
  placeLiveOrder: placeOrder,
  notifyChanged: notifyAlgoCockpitChanged,
};

export const __overnightSpotExecutionInternalsForTests = {
  signalStateToSignal,
  isSignalStateActionableForOvernightSpot,
  shouldSkipDuplicateBlockedPlan,
  shouldSkipExistingClientOrderEvent,
  selectExistingEventByClientOrderId,
  loadQuotes,
  resolveSignalTimeframe,
  payloadClientOrderId,
  computeAutomationDiagnosticsPrune,
  pruneAutomationDiagnostics,
};
