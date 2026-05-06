import {
  resolveSignalOptionsExecutionProfile,
  type SignalOptionsExecutionProfile,
} from "@workspace/backtest-core";
import {
  algoDeploymentsTable,
  algoStrategiesTable,
  backtestRunsTable,
  db,
  executionEventsTable,
  shadowFillsTable,
  shadowOrdersTable,
  shadowPositionsTable,
  type AlgoDeployment,
  type ExecutionEvent,
} from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import {
  evaluateSignalMonitor,
  getSignalMonitorState,
  type SignalMonitorTimeframe,
} from "./signal-monitor";
import {
  getOptionChainWithDebug,
  getOptionExpirationsWithDebug,
} from "./platform";
import {
  getAlgoGatewayReadiness,
  throwAlgoGatewayNotReady,
  type AlgoGatewayReadiness,
} from "./algo-gateway";
import { recordShadowAutomationEvent } from "./shadow-account";

export const SIGNAL_OPTIONS_EVENT_PREFIX = "signal_options_";
export const SIGNAL_OPTIONS_ENTRY_EVENT = "signal_options_shadow_entry";
export const SIGNAL_OPTIONS_EXIT_EVENT = "signal_options_shadow_exit";
export const SIGNAL_OPTIONS_MARK_EVENT = "signal_options_shadow_mark";
export const SIGNAL_OPTIONS_SKIPPED_EVENT = "signal_options_candidate_skipped";
export const SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT =
  "signal_options_gateway_blocked";
export const SIGNAL_OPTIONS_MANUAL_DEVIATION_EVENT =
  "signal_options_manual_deviation";

const activeScanDeploymentIds = new Set<string>();

type SignalDirection = "buy" | "sell";
type OptionRight = "call" | "put";
type SignalOptionsRuntimeStatus =
  | "candidate"
  | "open"
  | "closed"
  | "skipped"
  | "manual_override";

type SignalOptionsActionStatus =
  | "candidate"
  | "blocked"
  | "shadow_filled"
  | "partial_shadow"
  | "manual_override"
  | "live_previewed"
  | "live_submitted"
  | "closed"
  | "mismatch";

type SignalOptionsSyncStatus =
  | "synced"
  | "event_only"
  | "ledger_only"
  | "mismatch";

type SignalOptionsShadowLink = {
  orderId: string | null;
  fillId: string | null;
  positionId: string | null;
  sourceEventId: string | null;
  quantity: number | null;
  filledQuantity: number | null;
  positionQuantity: number | null;
  sourceType: "automation" | "manual" | "mixed" | null;
  strategyLabel: string | null;
  attributionStatus: "attributed" | "mixed" | "unknown";
};

export type SignalOptionsOptionQuote = {
  contract?: {
    ticker?: string;
    underlying?: string;
    expirationDate?: string | Date;
    strike?: number;
    right?: OptionRight;
    multiplier?: number;
    sharesPerContract?: number;
    providerContractId?: string | null;
  } | null;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  mark?: number | null;
  impliedVolatility?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  openInterest?: number | null;
  volume?: number | null;
  updatedAt?: string | Date | null;
  quoteFreshness?: string | null;
  marketDataMode?: string | null;
  quoteUpdatedAt?: string | Date | null;
  dataUpdatedAt?: string | Date | null;
  ageMs?: number | null;
};

type SignalOptionsCandidate = {
  id: string;
  deploymentId?: string | null;
  deploymentName?: string | null;
  symbol: string;
  direction: SignalDirection;
  optionRight: OptionRight;
  timeframe: SignalMonitorTimeframe;
  signalAt: string;
  signalPrice: number | null;
  status: SignalOptionsRuntimeStatus;
  selectedContract?: Record<string, unknown> | null;
  quote?: Record<string, unknown> | null;
  orderPlan?: Record<string, unknown> | null;
  liquidity?: Record<string, unknown> | null;
  reason?: string | null;
  actionStatus?: SignalOptionsActionStatus;
  syncStatus?: SignalOptionsSyncStatus;
  shadowLink?: SignalOptionsShadowLink | null;
  timeline?: Array<Record<string, unknown>>;
};

type SignalOptionsPosition = {
  id: string;
  candidateId: string;
  symbol: string;
  direction: SignalDirection;
  optionRight: OptionRight;
  timeframe: SignalMonitorTimeframe;
  signalAt: string;
  openedAt: string;
  entryPrice: number;
  quantity: number;
  peakPrice: number;
  stopPrice: number;
  premiumAtRisk: number;
  selectedContract: Record<string, unknown>;
  lastMarkPrice?: number | null;
  lastMarkedAt?: string | null;
};

type SignalMonitorState = {
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  currentSignalDirection: SignalDirection | null;
  currentSignalAt: Date | string | null;
  currentSignalPrice: number | null;
  fresh: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function dateOrNull(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function expirationDateKey(value: unknown): string | null {
  const date = dateOrNull(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function compactString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionContractKey(value: unknown): string | null {
  const contract = asRecord(value);
  const underlying = normalizeSymbol(String(contract.underlying ?? contract.ticker ?? ""))
    .toUpperCase();
  const expiration = expirationDateKey(contract.expirationDate);
  const strike = finiteNumber(contract.strike);
  const right = String(contract.right ?? "").toLowerCase();
  const providerContractId = compactString(contract.providerContractId);
  const ticker = compactString(contract.ticker);
  if (!underlying || !expiration || strike == null || !["call", "put"].includes(right)) {
    return null;
  }
  return [
    "option",
    underlying,
    expiration,
    strike,
    right,
    providerContractId || ticker || "",
  ].join(":");
}

function shadowPositionKey(input: {
  symbol: string;
  selectedContract?: unknown;
}) {
  const optionKey = optionContractKey(input.selectedContract);
  if (optionKey) {
    return optionKey;
  }
  return `equity:${normalizeSymbol(input.symbol).toUpperCase()}`;
}

function optionRightForSignal(direction: SignalDirection): OptionRight {
  return direction === "sell" ? "put" : "call";
}

function contractToPayload(quote: SignalOptionsOptionQuote) {
  const contract = asRecord(quote.contract);
  return {
    ticker: contract.ticker ?? null,
    underlying: contract.underlying ?? null,
    expirationDate: expirationDateKey(contract.expirationDate),
    strike: finiteNumber(contract.strike),
    right: contract.right === "put" ? "put" : "call",
    multiplier: finiteNumber(contract.multiplier) ?? 100,
    sharesPerContract: finiteNumber(contract.sharesPerContract) ?? 100,
    providerContractId:
      typeof contract.providerContractId === "string"
        ? contract.providerContractId
        : null,
  };
}

function quoteToPayload(quote: SignalOptionsOptionQuote) {
  return {
    bid: finiteNumber(quote.bid),
    ask: finiteNumber(quote.ask),
    last: finiteNumber(quote.last),
    mark: finiteNumber(quote.mark),
    impliedVolatility: finiteNumber(quote.impliedVolatility),
    delta: finiteNumber(quote.delta),
    gamma: finiteNumber(quote.gamma),
    theta: finiteNumber(quote.theta),
    vega: finiteNumber(quote.vega),
    openInterest: finiteNumber(quote.openInterest),
    volume: finiteNumber(quote.volume),
    quoteFreshness: quote.quoteFreshness ?? null,
    marketDataMode: quote.marketDataMode ?? null,
    quoteUpdatedAt: toIsoString(quote.quoteUpdatedAt),
    dataUpdatedAt: toIsoString(quote.dataUpdatedAt),
    updatedAt: toIsoString(quote.updatedAt),
    ageMs: finiteNumber(quote.ageMs),
  };
}

function eventToResponse(event: ExecutionEvent) {
  return {
    id: event.id,
    deploymentId: event.deploymentId ?? null,
    algoRunId: event.algoRunId ?? null,
    providerAccountId: event.providerAccountId ?? null,
    symbol: event.symbol ?? null,
    eventType: event.eventType,
    summary: event.summary,
    payload: event.payload,
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function deploymentToResponse(deployment: AlgoDeployment) {
  return {
    id: deployment.id,
    strategyId: deployment.strategyId,
    name: deployment.name,
    mode: deployment.mode,
    enabled: deployment.enabled,
    providerAccountId: deployment.providerAccountId,
    symbolUniverse: deployment.symbolUniverse,
    config: deployment.config,
    lastEvaluatedAt: deployment.lastEvaluatedAt ?? null,
    lastSignalAt: deployment.lastSignalAt ?? null,
    lastError: deployment.lastError ?? null,
    createdAt: deployment.createdAt,
    updatedAt: deployment.updatedAt,
  };
}

async function getDeploymentOrThrow(deploymentId: string): Promise<AlgoDeployment> {
  const [deployment] = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.id, deploymentId))
    .limit(1);

  if (!deployment) {
    throw new HttpError(404, "Algorithm deployment not found.", {
      code: "algo_deployment_not_found",
    });
  }

  return deployment;
}

async function listDeploymentEvents(deploymentId: string, limit = 500) {
  return db
    .select()
    .from(executionEventsTable)
    .where(eq(executionEventsTable.deploymentId, deploymentId))
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 1_000));
}

async function insertSignalOptionsEvent(input: {
  deployment: AlgoDeployment;
  symbol?: string | null;
  eventType: string;
  summary: string;
  payload: Record<string, unknown>;
  occurredAt?: Date;
}) {
  const [event] = await db
    .insert(executionEventsTable)
    .values({
      deploymentId: input.deployment.id,
      providerAccountId: input.deployment.providerAccountId,
      symbol: input.symbol ? normalizeSymbol(input.symbol).toUpperCase() : null,
      eventType: input.eventType,
      summary: input.summary,
      payload: input.payload,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .returning();

  if (
    event.eventType === SIGNAL_OPTIONS_ENTRY_EVENT ||
    event.eventType === SIGNAL_OPTIONS_EXIT_EVENT ||
    event.eventType === SIGNAL_OPTIONS_MARK_EVENT
  ) {
    await recordShadowAutomationEvent(event).catch((error) => {
      logger.warn?.(
        { err: error, eventId: event.id, eventType: event.eventType },
        "Failed to mirror signal-options event into Shadow account ledger",
      );
    });
  }

  return event;
}

function resolveDeploymentProfile(deployment: AlgoDeployment) {
  return resolveSignalOptionsExecutionProfile(deployment.config);
}

export function deploymentHasSignalOptionsProfile(deployment: AlgoDeployment) {
  const config = asRecord(deployment.config);
  const signalOptions = asRecord(config.signalOptions);
  const parameters = asRecord(config.parameters);
  return (
    Object.keys(signalOptions).length > 0 ||
    parameters.executionMode === "signal_options"
  );
}

function buildCandidateId(input: {
  deploymentId: string;
  symbol: string;
  direction: SignalDirection;
  signalAt: string;
}) {
  return [
    "SIGOPT",
    input.deploymentId.slice(0, 8),
    normalizeSymbol(input.symbol).toUpperCase(),
    input.direction,
    Date.parse(input.signalAt) || input.signalAt,
  ].join("-");
}

function buildSignalKey(state: SignalMonitorState, signalAt: string) {
  return [
    state.profileId,
    normalizeSymbol(state.symbol).toUpperCase(),
    state.timeframe,
    state.currentSignalDirection,
    signalAt,
  ].join(":");
}

function daysBetweenUtc(from: Date, to: Date) {
  const fromUtc = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const toUtc = Date.UTC(
    to.getUTCFullYear(),
    to.getUTCMonth(),
    to.getUTCDate(),
  );
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

export function selectSignalOptionsExpiration(
  expirations: Array<{ expirationDate?: Date | string | null }>,
  profile: SignalOptionsExecutionProfile,
  now = new Date(),
) {
  const minDte = profile.optionSelection.allowZeroDte
    ? profile.optionSelection.minDte
    : Math.max(1, profile.optionSelection.minDte);
  const maxDte = Math.max(minDte, profile.optionSelection.maxDte);
  const targetDte = Math.min(
    maxDte,
    Math.max(minDte, profile.optionSelection.targetDte),
  );

  return expirations
    .map((expiration) => {
      const expirationDate = dateOrNull(expiration.expirationDate);
      if (!expirationDate) {
        return null;
      }
      return {
        expirationDate,
        dte: daysBetweenUtc(now, expirationDate),
      };
    })
    .filter(
      (
        expiration,
      ): expiration is {
        expirationDate: Date;
        dte: number;
      } =>
        Boolean(
          expiration &&
            expiration.dte >= minDte &&
            expiration.dte <= maxDte,
        ),
    )
    .sort((left, right) => {
      const targetDelta =
        Math.abs(left.dte - targetDte) - Math.abs(right.dte - targetDte);
      return targetDelta || left.dte - right.dte;
    })[0] ?? null;
}

function resolveStrikeIndex(input: {
  strikes: number[];
  spotPrice: number;
  slot: number;
}) {
  const { strikes, spotPrice, slot } = input;
  const belowIndex = strikes.reduce(
    (bestIndex, strike, index) =>
      strike <= spotPrice && index > bestIndex ? index : bestIndex,
    -1,
  );
  const aboveIndex = strikes.findIndex((strike) => strike >= spotPrice);
  const resolvedBelowIndex =
    belowIndex >= 0 ? belowIndex : Math.max(0, aboveIndex);
  const resolvedAboveIndex =
    aboveIndex >= 0 ? aboveIndex : Math.max(0, resolvedBelowIndex);
  const targetIndex =
    slot === 0
      ? resolvedBelowIndex - 2
      : slot === 1
        ? resolvedBelowIndex - 1
        : slot === 2
          ? resolvedBelowIndex
          : slot === 3
            ? resolvedAboveIndex
            : slot === 4
              ? resolvedAboveIndex + 1
              : resolvedAboveIndex + 2;

  return Math.min(strikes.length - 1, Math.max(0, targetIndex));
}

export function selectSignalOptionsContractFromChain(input: {
  contracts: SignalOptionsOptionQuote[];
  direction: SignalDirection;
  signalPrice: number | null;
  profile: SignalOptionsExecutionProfile;
}) {
  const optionRight = optionRightForSignal(input.direction);
  const candidates = input.contracts.filter(
    (quote) => asRecord(quote.contract).right === optionRight,
  );
  if (!candidates.length) {
    return null;
  }

  const strikes = Array.from(
    new Set(
      candidates
        .map((quote) => finiteNumber(asRecord(quote.contract).strike))
        .filter((strike): strike is number => strike != null),
    ),
  ).sort((left, right) => left - right);
  if (!strikes.length) {
    return null;
  }

  const spotPrice = input.signalPrice ?? strikes[Math.floor(strikes.length / 2)]!;
  const slot =
    optionRight === "call"
      ? input.profile.optionSelection.callStrikeSlot
      : input.profile.optionSelection.putStrikeSlot;
  const strike = strikes[resolveStrikeIndex({ strikes, spotPrice, slot })];
  return (
    candidates.find(
      (quote) => finiteNumber(asRecord(quote.contract).strike) === strike,
    ) ?? null
  );
}

export function resolveSignalOptionsLiquidity(
  quote: SignalOptionsOptionQuote,
  profile: SignalOptionsExecutionProfile,
) {
  const bid = finiteNumber(quote.bid);
  const ask = finiteNumber(quote.ask);
  const last = finiteNumber(quote.last);
  const mark = finiteNumber(quote.mark);
  const mid =
    bid != null && ask != null && bid > 0 && ask > 0
      ? (bid + ask) / 2
      : mark != null && mark > 0
        ? mark
        : last != null && last > 0
          ? last
          : null;
  const spread =
    bid != null && ask != null && ask >= bid ? Math.max(0, ask - bid) : null;
  const spreadPctOfMid =
    spread != null && mid != null && mid > 0 ? (spread / mid) * 100 : null;
  const quoteFreshness = String(quote.quoteFreshness || "").toLowerCase();
  const quoteFresh =
    !profile.liquidityGate.requireFreshQuote ||
    !["stale", "unavailable", "pending"].includes(quoteFreshness);
  const hasBidAsk = bid != null && ask != null && bid > 0 && ask > 0 && ask >= bid;
  const reasons: string[] = [];

  if (profile.liquidityGate.requireBidAsk && !hasBidAsk) {
    reasons.push("missing_bid_ask");
  }
  if (bid != null && bid < profile.liquidityGate.minBid) {
    reasons.push("bid_below_minimum");
  }
  if (
    spreadPctOfMid == null ||
    spreadPctOfMid > profile.liquidityGate.maxSpreadPctOfMid
  ) {
    reasons.push("spread_too_wide");
  }
  if (!quoteFresh) {
    reasons.push("quote_not_fresh");
  }
  if (mid == null || mid <= 0) {
    reasons.push("missing_mark");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    bid,
    ask,
    mid,
    spread,
    spreadPctOfMid,
    quoteFreshness: quote.quoteFreshness ?? null,
    marketDataMode: quote.marketDataMode ?? null,
  };
}

export function buildSignalOptionsShadowOrderPlan(
  quote: SignalOptionsOptionQuote,
  profile: SignalOptionsExecutionProfile,
) {
  const liquidity = resolveSignalOptionsLiquidity(quote, profile);
  if (!liquidity.ok || liquidity.mid == null) {
    return {
      ok: false,
      reason: liquidity.reasons[0] ?? "liquidity_gate_failed",
      liquidity,
    };
  }

  const lastStep = profile.fillPolicy.chaseSteps.at(-1) ?? 0.9;
  const ask = liquidity.ask ?? liquidity.mid;
  const simulatedFillPrice = Number(
    Math.min(ask, liquidity.mid + (ask - liquidity.mid) * lastStep).toFixed(2),
  );
  const quantity = Math.min(
    profile.riskCaps.maxContracts,
    Math.floor(profile.riskCaps.maxPremiumPerEntry / (simulatedFillPrice * 100)),
  );

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      ok: false,
      reason: "premium_budget_too_small",
      liquidity,
    };
  }

  return {
    ok: true,
    entryLimitPrice: Number(liquidity.mid.toFixed(2)),
    simulatedFillPrice,
    quantity,
    premiumAtRisk: Number((simulatedFillPrice * 100 * quantity).toFixed(2)),
    fillPolicy: profile.fillPolicy,
    liquidity,
  };
}

function buildInitialStopPrice(
  entryPrice: number,
  profile: SignalOptionsExecutionProfile,
) {
  return Number(
    (entryPrice * (1 + profile.exitPolicy.hardStopPct / 100)).toFixed(2),
  );
}

function computePositionStop(input: {
  entryPrice: number;
  peakPrice: number;
  markPrice: number;
  profile: SignalOptionsExecutionProfile;
}) {
  const { entryPrice, peakPrice, markPrice, profile } = input;
  const hardStopPrice = buildInitialStopPrice(entryPrice, profile);
  const returnPct = entryPrice > 0 ? ((peakPrice - entryPrice) / entryPrice) * 100 : 0;
  const trailActive = returnPct >= profile.exitPolicy.trailActivationPct;
  const givebackPct =
    peakPrice >= entryPrice * 10
      ? profile.exitPolicy.tightenAtTenXGivebackPct
      : peakPrice >= entryPrice * 5
        ? profile.exitPolicy.tightenAtFiveXGivebackPct
        : profile.exitPolicy.trailGivebackPct;
  const trailStopPrice = trailActive
    ? Math.max(
        entryPrice * (1 + profile.exitPolicy.minLockedGainPct / 100),
        peakPrice * (1 - givebackPct / 100),
      )
    : null;
  const stopPrice = Number(
    Math.max(hardStopPrice, trailStopPrice ?? hardStopPrice).toFixed(2),
  );
  const exitReason =
    markPrice <= stopPrice
      ? trailActive && trailStopPrice != null && markPrice <= trailStopPrice
        ? "runner_trail_stop"
        : "hard_stop"
      : null;

  return {
    hardStopPrice,
    trailActive,
    trailStopPrice:
      trailStopPrice == null ? null : Number(trailStopPrice.toFixed(2)),
    givebackPct,
    stopPrice,
    exitReason,
    returnPct,
  };
}

function buildCandidateFromSignal(input: {
  deployment: AlgoDeployment;
  state: SignalMonitorState;
  signalAt: string;
}) {
  const direction = input.state.currentSignalDirection ?? "buy";
  const symbol = normalizeSymbol(input.state.symbol).toUpperCase();
  return {
    id: buildCandidateId({
      deploymentId: input.deployment.id,
      symbol,
      direction,
      signalAt: input.signalAt,
    }),
    deploymentId: input.deployment.id,
    deploymentName: input.deployment.name,
    symbol,
    direction,
    optionRight: optionRightForSignal(direction),
    timeframe: input.state.timeframe,
    signalAt: input.signalAt,
    signalPrice: finiteNumber(input.state.currentSignalPrice),
    status: "candidate" as const,
  };
}

function candidateFromEvent(event: ExecutionEvent): SignalOptionsCandidate | null {
  const payload = asRecord(event.payload);
  const candidate = asRecord(
    Object.keys(asRecord(payload.candidate)).length
      ? payload.candidate
      : payload.automationCandidate,
  );
  const position = asRecord(payload.position);
  const candidateId =
    compactString(candidate.id) ??
    compactString(payload.candidateId) ??
    compactString(position.candidateId);
  if (!candidateId && !event.symbol) {
    return null;
  }
  const direction =
    candidate.direction === "sell" || position.direction === "sell" ? "sell" : "buy";
  const status =
    event.eventType === SIGNAL_OPTIONS_SKIPPED_EVENT
      ? "skipped"
      : event.eventType === SIGNAL_OPTIONS_EXIT_EVENT
        ? "closed"
        : event.eventType === SIGNAL_OPTIONS_MANUAL_DEVIATION_EVENT
          ? "manual_override"
        : event.eventType === SIGNAL_OPTIONS_ENTRY_EVENT
          ? "open"
          : "candidate";
  return {
    id: String(candidateId || event.id),
    deploymentId:
      compactString(candidate.deploymentId) ?? event.deploymentId ?? null,
    deploymentName: compactString(candidate.deploymentName),
    symbol: String(candidate.symbol || event.symbol || ""),
    direction,
    optionRight:
      candidate.optionRight === "put" || position.optionRight === "put"
        ? "put"
        : "call",
    timeframe: String(candidate.timeframe || position.timeframe || "15m") as SignalMonitorTimeframe,
    signalAt:
      toIsoString(candidate.signalAt) ??
      toIsoString(position.signalAt) ??
      toIsoString(event.occurredAt) ??
      new Date(0).toISOString(),
    signalPrice: finiteNumber(candidate.signalPrice ?? position.signalPrice),
    status,
    selectedContract:
      Object.keys(asRecord(payload.selectedContract)).length
        ? asRecord(payload.selectedContract)
        : Object.keys(asRecord(candidate.selectedContract)).length
          ? asRecord(candidate.selectedContract)
          : asRecord(position.selectedContract),
    quote: asRecord(payload.quote),
    orderPlan:
      Object.keys(asRecord(payload.orderPlan)).length
        ? asRecord(payload.orderPlan)
        : asRecord(candidate.orderPlan),
    liquidity: asRecord(payload.liquidity),
    reason:
      typeof payload.reason === "string"
        ? payload.reason
        : typeof payload.skipReason === "string"
          ? payload.skipReason
          : null,
  };
}

function positionFromEntryPayload(event: ExecutionEvent): SignalOptionsPosition | null {
  const payload = asRecord(event.payload);
  const position = asRecord(payload.position);
  const candidate = asRecord(payload.candidate);
  const selectedContract = asRecord(payload.selectedContract);
  const entryPrice = finiteNumber(position.entryPrice ?? payload.simulatedFillPrice);
  const quantity = finiteNumber(position.quantity ?? payload.quantity);
  const candidateId = String(candidate.id || position.candidateId || event.id);
  const direction = candidate.direction === "sell" ? "sell" : "buy";
  const signalAt =
    toIsoString(candidate.signalAt) ??
    toIsoString(position.signalAt) ??
    toIsoString(event.occurredAt);
  if (!event.symbol || entryPrice == null || quantity == null || !signalAt) {
    return null;
  }

  return {
    id: String(position.id || `${event.deploymentId ?? "deployment"}:${event.symbol}`),
    candidateId,
    symbol: event.symbol,
    direction,
    optionRight: candidate.optionRight === "put" ? "put" : "call",
    timeframe: String(candidate.timeframe || "15m") as SignalMonitorTimeframe,
    signalAt,
    openedAt: toIsoString(event.occurredAt) ?? signalAt,
    entryPrice,
    quantity,
    peakPrice: finiteNumber(position.peakPrice) ?? entryPrice,
    stopPrice: finiteNumber(position.stopPrice) ?? entryPrice * 0.5,
    premiumAtRisk:
      finiteNumber(position.premiumAtRisk) ??
      Number((entryPrice * 100 * quantity).toFixed(2)),
    selectedContract,
    lastMarkPrice: finiteNumber(position.lastMarkPrice),
    lastMarkedAt: toIsoString(position.lastMarkedAt),
  };
}

function deriveActivePositions(events: ExecutionEvent[]) {
  const positions = new Map<string, SignalOptionsPosition>();
  [...events]
    .sort(
      (left, right) =>
        left.occurredAt.getTime() - right.occurredAt.getTime(),
    )
    .forEach((event) => {
      const symbol = normalizeSymbol(event.symbol ?? "").toUpperCase();
      if (!symbol) {
        return;
      }
      if (event.eventType === SIGNAL_OPTIONS_ENTRY_EVENT) {
        const position = positionFromEntryPayload(event);
        if (position) {
          positions.set(symbol, position);
        }
        return;
      }
      if (event.eventType === SIGNAL_OPTIONS_EXIT_EVENT) {
        positions.delete(symbol);
        return;
      }
      if (event.eventType === SIGNAL_OPTIONS_MARK_EVENT) {
        const payload = asRecord(event.payload);
        const position = asRecord(payload.position);
        const current = positions.get(symbol);
        if (current) {
          current.peakPrice = finiteNumber(position.peakPrice) ?? current.peakPrice;
          current.stopPrice = finiteNumber(position.stopPrice) ?? current.stopPrice;
          current.lastMarkPrice =
            finiteNumber(position.lastMarkPrice) ?? current.lastMarkPrice;
          current.lastMarkedAt =
            toIsoString(position.lastMarkedAt) ??
            toIsoString(event.occurredAt) ??
            current.lastMarkedAt;
        }
      }
    });
  return [...positions.values()];
}

function signalOptionsEvents(events: ExecutionEvent[]) {
  return events.filter((event) =>
    event.eventType.startsWith(SIGNAL_OPTIONS_EVENT_PREFIX),
  );
}

function isSameUtcDate(left: Date, right: Date) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

function computeSignalOptionsDailyRealizedPnl(
  events: ExecutionEvent[],
  now = new Date(),
) {
  return events
    .filter(
      (event) =>
        event.eventType === SIGNAL_OPTIONS_EXIT_EVENT &&
        isSameUtcDate(event.occurredAt, now),
    )
    .reduce((sum, event) => sum + (finiteNumber(asRecord(event.payload).pnl) ?? 0), 0);
}

function computeSignalOptionsOpenUnrealizedPnl(
  positions: SignalOptionsPosition[],
) {
  return positions.reduce((sum, position) => {
    const markPrice = finiteNumber(position.lastMarkPrice);
    if (markPrice == null) {
      return sum;
    }
    const multiplier =
      finiteNumber(asRecord(position.selectedContract).multiplier) ?? 100;
    return (
      sum +
      (markPrice - position.entryPrice) * position.quantity * multiplier
    );
  }, 0);
}

function computeSignalOptionsDailyPnl(
  events: ExecutionEvent[],
  positions: SignalOptionsPosition[] = [],
  now = new Date(),
) {
  return (
    computeSignalOptionsDailyRealizedPnl(events, now) +
    computeSignalOptionsOpenUnrealizedPnl(positions)
  );
}

type SignalOptionsShadowIndex = {
  byEventId: Map<string, SignalOptionsShadowLink>;
  byCandidateId: Map<string, SignalOptionsShadowLink>;
};

function shadowLinkFromParts(input: {
  order?: typeof shadowOrdersTable.$inferSelect;
  fill?: typeof shadowFillsTable.$inferSelect;
  position?: typeof shadowPositionsTable.$inferSelect;
}): SignalOptionsShadowLink {
  const payload = asRecord(input.order?.payload);
  const candidate = asRecord(payload.candidate);
  const positionPayload = asRecord(payload.position);
  const sourceType =
    input.order?.source === "automation"
      ? "automation"
      : input.order?.source === "manual"
        ? "manual"
        : null;
  return {
    orderId: input.order?.id ?? null,
    fillId: input.fill?.id ?? null,
    positionId: input.position?.id ?? null,
    sourceEventId:
      input.order?.sourceEventId ?? input.fill?.sourceEventId ?? null,
    quantity: finiteNumber(input.order?.quantity),
    filledQuantity: finiteNumber(input.order?.filledQuantity),
    positionQuantity: finiteNumber(input.position?.quantity),
    sourceType,
    strategyLabel:
      sourceType === "automation" ||
      compactString(candidate.id) ||
      compactString(positionPayload.candidateId)
        ? "Signal Options"
        : null,
    attributionStatus: sourceType ? "attributed" : "unknown",
  };
}

function mergeShadowLinks(
  current: SignalOptionsShadowLink | undefined,
  next: SignalOptionsShadowLink,
): SignalOptionsShadowLink {
  if (!current) {
    return next;
  }
  const sourceType =
    current.sourceType && next.sourceType && current.sourceType !== next.sourceType
      ? "mixed"
      : current.sourceType ?? next.sourceType;
  return {
    orderId: current.orderId ?? next.orderId,
    fillId: current.fillId ?? next.fillId,
    positionId: current.positionId ?? next.positionId,
    sourceEventId: current.sourceEventId ?? next.sourceEventId,
    quantity: (current.quantity ?? 0) + (next.quantity ?? 0),
    filledQuantity: (current.filledQuantity ?? 0) + (next.filledQuantity ?? 0),
    positionQuantity: current.positionQuantity ?? next.positionQuantity,
    sourceType,
    strategyLabel: current.strategyLabel ?? next.strategyLabel,
    attributionStatus:
      sourceType === "mixed" ? "mixed" : current.attributionStatus ?? next.attributionStatus,
  };
}

async function buildSignalOptionsShadowIndex(
  events: ExecutionEvent[],
): Promise<SignalOptionsShadowIndex> {
  const eventIds = events.map((event) => event.id);
  const byEventId = new Map<string, SignalOptionsShadowLink>();
  const byCandidateId = new Map<string, SignalOptionsShadowLink>();
  if (!eventIds.length) {
    return { byEventId, byCandidateId };
  }

  const [orders, fills, openPositions] = await Promise.all([
    db
      .select()
      .from(shadowOrdersTable)
      .where(inArray(shadowOrdersTable.sourceEventId, eventIds))
      .orderBy(desc(shadowOrdersTable.placedAt)),
    db
      .select()
      .from(shadowFillsTable)
      .where(inArray(shadowFillsTable.sourceEventId, eventIds))
      .orderBy(desc(shadowFillsTable.occurredAt)),
    db
      .select()
      .from(shadowPositionsTable)
      .where(eq(shadowPositionsTable.accountId, "shadow")),
  ]);

  const fillsByEventId = new Map(
    fills
      .filter((fill) => fill.sourceEventId)
      .map((fill) => [String(fill.sourceEventId), fill]),
  );
  const positionsByKey = new Map(
    openPositions.map((position) => [position.positionKey, position]),
  );

  for (const order of orders) {
    const sourceEventId = order.sourceEventId ? String(order.sourceEventId) : null;
    const payload = asRecord(order.payload);
    const candidate = asRecord(payload.candidate);
    const positionPayload = asRecord(payload.position);
    const candidateId =
      compactString(candidate.id) ?? compactString(positionPayload.candidateId);
    const position = positionsByKey.get(
      shadowPositionKey({
        symbol: order.symbol,
        selectedContract: order.optionContract,
      }),
    );
    const link = shadowLinkFromParts({
      order,
      fill: sourceEventId ? fillsByEventId.get(sourceEventId) : undefined,
      position,
    });
    if (sourceEventId) {
      byEventId.set(sourceEventId, link);
    }
    if (candidateId) {
      byCandidateId.set(
        candidateId,
        mergeShadowLinks(byCandidateId.get(candidateId), link),
      );
    }
  }

  return { byEventId, byCandidateId };
}

function seenSignalKeys(events: ExecutionEvent[]) {
  return new Set(
    signalOptionsEvents(events)
      .map((event) => asRecord(event.payload).signalKey)
      .filter((signalKey): signalKey is string => typeof signalKey === "string"),
  );
}

function mergeProfilePatch(
  current: SignalOptionsExecutionProfile,
  patch: Record<string, unknown>,
) {
  return resolveSignalOptionsExecutionProfile({
    ...current,
    ...patch,
    optionSelection: {
      ...current.optionSelection,
      ...asRecord(patch.optionSelection),
    },
    riskCaps: {
      ...current.riskCaps,
      ...asRecord(patch.riskCaps),
    },
    liquidityGate: {
      ...current.liquidityGate,
      ...asRecord(patch.liquidityGate),
    },
    fillPolicy: {
      ...current.fillPolicy,
      ...asRecord(patch.fillPolicy),
    },
    exitPolicy: {
      ...current.exitPolicy,
      ...asRecord(patch.exitPolicy),
    },
  });
}

function eventTimelineItem(
  event: ExecutionEvent,
  shadowLink?: SignalOptionsShadowLink,
) {
  const payload = asRecord(event.payload);
  const changedFields = Array.isArray(payload.changedFields)
    ? payload.changedFields.filter((field): field is string => typeof field === "string")
    : [];
  return {
    id: event.id,
    source: "event",
    type: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    summary: event.summary,
    reason: compactString(payload.reason) ?? compactString(payload.skipReason),
    changedFields,
    shadowOrderId: shadowLink?.orderId ?? null,
    shadowFillId: shadowLink?.fillId ?? null,
  };
}

function deriveCandidateActionStatus(input: {
  candidate: SignalOptionsCandidate;
  events: ExecutionEvent[];
  shadowLink?: SignalOptionsShadowLink;
}): {
  actionStatus: SignalOptionsActionStatus;
  syncStatus: SignalOptionsSyncStatus;
} {
  const eventTypes = new Set(input.events.map((event) => event.eventType));
  const hasEntry = eventTypes.has(SIGNAL_OPTIONS_ENTRY_EVENT);
  const hasExit = eventTypes.has(SIGNAL_OPTIONS_EXIT_EVENT);
  const hasDeviation = eventTypes.has(SIGNAL_OPTIONS_MANUAL_DEVIATION_EVENT);
  const hasSkip = eventTypes.has(SIGNAL_OPTIONS_SKIPPED_EVENT);
  const hasShadowFill = Boolean(input.shadowLink?.fillId || input.shadowLink?.orderId);
  const plannedQuantity = finiteNumber(asRecord(input.candidate.orderPlan).quantity);
  const positionQuantity = input.shadowLink?.positionQuantity ?? null;

  if (hasSkip) {
    return { actionStatus: "blocked", syncStatus: "synced" };
  }
  if (hasExit) {
    return {
      actionStatus:
        positionQuantity != null && positionQuantity > 0 ? "partial_shadow" : "closed",
      syncStatus: hasShadowFill ? "synced" : "event_only",
    };
  }
  if (hasEntry && !hasShadowFill) {
    return { actionStatus: "mismatch", syncStatus: "event_only" };
  }
  if (
    hasEntry &&
    plannedQuantity != null &&
    positionQuantity != null &&
    positionQuantity > 0 &&
    positionQuantity < plannedQuantity
  ) {
    return { actionStatus: "partial_shadow", syncStatus: "synced" };
  }
  if (hasDeviation) {
    return {
      actionStatus: hasShadowFill ? "manual_override" : "manual_override",
      syncStatus: hasShadowFill ? "synced" : "event_only",
    };
  }
  if (hasEntry && hasShadowFill) {
    return { actionStatus: "shadow_filled", syncStatus: "synced" };
  }
  return {
    actionStatus: input.candidate.status === "closed" ? "closed" : "candidate",
    syncStatus: "synced",
  };
}

type AlgoCockpitStageStatus =
  | "healthy"
  | "running"
  | "waiting"
  | "attention"
  | "blocked"
  | "stale";

type AlgoCockpitSeverity = "info" | "warning" | "critical";

function latestIso(
  values: Array<string | Date | null | undefined>,
): string | null {
  const dates = values
    .map((value) => dateOrNull(value))
    .filter((value): value is Date => Boolean(value));
  if (!dates.length) {
    return null;
  }
  return new Date(
    Math.max(...dates.map((value) => value.getTime())),
  ).toISOString();
}

function candidateLatestTimelineAt(candidate: SignalOptionsCandidate) {
  const latest = candidate.timeline?.at(-1);
  return toIsoString(asRecord(latest).occurredAt);
}

function stageStatus(input: {
  blocked?: boolean;
  attention?: boolean;
  running?: boolean;
  stale?: boolean;
  count?: number;
  fallback?: AlgoCockpitStageStatus;
}): AlgoCockpitStageStatus {
  if (input.blocked) {
    return "blocked";
  }
  if (input.running) {
    return "running";
  }
  if (input.attention) {
    return "attention";
  }
  if (input.stale) {
    return "stale";
  }
  if ((input.count ?? 0) > 0) {
    return "healthy";
  }
  return input.fallback ?? "waiting";
}

function positionStopDistancePercent(position: SignalOptionsPosition) {
  const mark = finiteNumber(position.lastMarkPrice) ?? position.entryPrice;
  const stop = finiteNumber(position.stopPrice);
  if (mark == null || stop == null || mark <= 0) {
    return null;
  }
  return ((mark - stop) / mark) * 100;
}

function isPositionNearStop(position: SignalOptionsPosition) {
  const distance = positionStopDistancePercent(position);
  return distance != null && distance <= 20;
}

function isPositionMarkStale(position: SignalOptionsPosition, now = new Date()) {
  const markedAt = dateOrNull(position.lastMarkedAt);
  return Boolean(markedAt && now.getTime() - markedAt.getTime() > 15 * 60_000);
}

function buildCockpitPipeline(input: {
  deployment: AlgoDeployment;
  readiness: AlgoGatewayReadiness;
  candidates: Array<SignalOptionsCandidate & {
    actionStatus?: SignalOptionsActionStatus;
    syncStatus?: SignalOptionsSyncStatus;
  }>;
  activePositions: SignalOptionsPosition[];
  risk: Record<string, unknown>;
  events: ExecutionEvent[];
}) {
  const selectedContracts = input.candidates.filter(
    (candidate) => Object.keys(asRecord(candidate.selectedContract)).length > 0,
  );
  const blockedCandidates = input.candidates.filter(
    (candidate) =>
      candidate.actionStatus === "blocked" || candidate.status === "skipped",
  );
  const shadowFilled = input.candidates.filter((candidate) =>
    ["shadow_filled", "partial_shadow", "closed"].includes(
      String(candidate.actionStatus ?? ""),
    ),
  );
  const mismatches = input.candidates.filter(
    (candidate) =>
      candidate.actionStatus === "mismatch" || candidate.syncStatus === "mismatch",
  );
  const exitEvents = input.events.filter(
    (event) => event.eventType === SIGNAL_OPTIONS_EXIT_EVENT,
  );
  const latestGatewayBlocked = input.events.find(
    (event) => event.eventType === SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT,
  );
  const nearStopCount = input.activePositions.filter(isPositionNearStop).length;
  const dailyHaltActive = input.risk.dailyHaltActive === true;
  const scanRunning = activeScanDeploymentIds.has(input.deployment.id);

  return [
    {
      id: "scan_universe",
      label: "Scan Universe",
      status: stageStatus({
        blocked: !input.readiness.ready,
        running: scanRunning,
        count: input.deployment.lastEvaluatedAt ? 1 : 0,
      }),
      count: input.deployment.symbolUniverse.length,
      latestAt:
        input.deployment.lastEvaluatedAt?.toISOString() ??
        latestGatewayBlocked?.occurredAt.toISOString() ??
        null,
      detail: scanRunning
        ? "scan running"
        : input.readiness.ready
          ? `${input.deployment.symbolUniverse.length} symbols ready`
          : input.readiness.message,
    },
    {
      id: "signal_detected",
      label: "Signal Detected",
      status: stageStatus({ count: input.candidates.length }),
      count: input.candidates.length,
      latestAt: latestIso(input.candidates.map((candidate) => candidate.signalAt)),
      detail: input.candidates.length
        ? `${input.candidates.length} recent signal candidates`
        : "awaiting fresh RayReplica signal",
    },
    {
      id: "contract_selected",
      label: "Contract Selected",
      status: stageStatus({
        attention: blockedCandidates.some((candidate) =>
          String(candidate.reason ?? "").includes("contract"),
        ),
        count: selectedContracts.length,
      }),
      count: selectedContracts.length,
      latestAt: latestIso(selectedContracts.map(candidateLatestTimelineAt)),
      detail: selectedContracts.length
        ? `${selectedContracts.length} contracts resolved`
        : "no resolved contracts yet",
    },
    {
      id: "liquidity_risk_gate",
      label: "Liquidity/Risk Gate",
      status: stageStatus({
        blocked: dailyHaltActive,
        attention: blockedCandidates.length > 0,
        count: input.candidates.length - blockedCandidates.length,
      }),
      count: blockedCandidates.length,
      latestAt: latestIso(blockedCandidates.map(candidateLatestTimelineAt)),
      detail: dailyHaltActive
        ? "daily loss halt active"
        : blockedCandidates.length
          ? `${blockedCandidates.length} candidates blocked`
          : "gates clear for current candidates",
    },
    {
      id: "order_shadow",
      label: "Shadow Order",
      status: stageStatus({
        attention: mismatches.length > 0,
        count: shadowFilled.length,
      }),
      count: shadowFilled.length,
      latestAt: latestIso(shadowFilled.map(candidateLatestTimelineAt)),
      detail: mismatches.length
        ? `${mismatches.length} shadow attribution mismatches`
        : shadowFilled.length
          ? `${shadowFilled.length} shadow-linked orders`
          : "no shadow fills yet",
    },
    {
      id: "position_managed",
      label: "Position Managed",
      status: stageStatus({
        attention: nearStopCount > 0,
        count: input.activePositions.length,
      }),
      count: input.activePositions.length,
      latestAt: latestIso(
        input.activePositions.map((position) => position.lastMarkedAt),
      ),
      detail: nearStopCount
        ? `${nearStopCount} positions near stop`
        : input.activePositions.length
          ? `${input.activePositions.length} positions marked`
          : "no open shadow positions",
    },
    {
      id: "exit_close",
      label: "Exit/Close",
      status: stageStatus({ count: exitEvents.length }),
      count: exitEvents.length,
      latestAt: latestIso(exitEvents.map((event) => event.occurredAt)),
      detail: exitEvents.length
        ? `${exitEvents.length} recent exits`
        : "waiting for exit rules",
    },
  ];
}

function buildCockpitAttention(input: {
  deployment: AlgoDeployment;
  readiness: AlgoGatewayReadiness;
  candidates: Array<SignalOptionsCandidate & {
    actionStatus?: SignalOptionsActionStatus;
    syncStatus?: SignalOptionsSyncStatus;
    shadowLink?: SignalOptionsShadowLink | null;
  }>;
  activePositions: SignalOptionsPosition[];
  risk: Record<string, unknown>;
  events: ExecutionEvent[];
}) {
  const items: Array<{
    id: string;
    severity: AlgoCockpitSeverity;
    stage: string;
    symbol: string | null;
    summary: string;
    detail: string;
    occurredAt: string | null;
    action: string;
  }> = [];

  if (!input.readiness.ready) {
    items.push({
      id: "gateway-readiness",
      severity: "critical",
      stage: "scan_universe",
      symbol: null,
      summary: "Gateway or market data is blocking scans.",
      detail: input.readiness.message,
      occurredAt: new Date().toISOString(),
      action: "Start or repair the IBKR bridge before running scans.",
    });
  }

  if (input.deployment.lastError) {
    items.push({
      id: "deployment-last-error",
      severity: "critical",
      stage: "scan_universe",
      symbol: null,
      summary: "Deployment has a recorded error.",
      detail: input.deployment.lastError,
      occurredAt: input.deployment.updatedAt.toISOString(),
      action: "Review the latest execution event and rerun after resolving it.",
    });
  }

  if (input.risk.dailyHaltActive === true) {
    items.push({
      id: "daily-loss-halt",
      severity: "critical",
      stage: "liquidity_risk_gate",
      symbol: null,
      summary: "Daily loss halt is active.",
      detail: `Daily P&L ${input.risk.dailyPnl ?? 0} breached max loss ${input.risk.maxDailyLoss ?? 0}.`,
      occurredAt: new Date().toISOString(),
      action: "Pause deployment or reduce risk before the next scan.",
    });
  }

  input.candidates
    .filter(
      (candidate) =>
        candidate.actionStatus === "blocked" || candidate.status === "skipped",
    )
    .slice(0, 8)
    .forEach((candidate) => {
      items.push({
        id: `blocked-${candidate.id}`,
        severity: "warning",
        stage: "liquidity_risk_gate",
        symbol: candidate.symbol,
        summary: `${candidate.symbol} candidate blocked.`,
        detail: formatEnumReason(candidate.reason ?? "gate_failed"),
        occurredAt: candidateLatestTimelineAt(candidate) ?? candidate.signalAt ?? null,
        action: "Inspect contract, quote freshness, liquidity, and risk caps.",
      });
    });

  input.candidates
    .filter(
      (candidate) =>
        candidate.actionStatus === "mismatch" ||
        candidate.syncStatus === "mismatch" ||
        candidate.syncStatus === "event_only" ||
        candidate.shadowLink?.attributionStatus === "unknown",
    )
    .slice(0, 8)
    .forEach((candidate) => {
      items.push({
        id: `shadow-${candidate.id}`,
        severity: candidate.actionStatus === "mismatch" ? "critical" : "warning",
        stage: "order_shadow",
        symbol: candidate.symbol,
        summary: `${candidate.symbol} shadow ledger attribution needs review.`,
        detail: shadowLinkStatus(candidate.shadowLink),
        occurredAt: candidateLatestTimelineAt(candidate) ?? candidate.signalAt ?? null,
        action: "Compare execution event, shadow order, fill, and position link.",
      });
    });

  input.activePositions.forEach((position) => {
    if (isPositionNearStop(position)) {
      items.push({
        id: `near-stop-${position.id}`,
        severity: "warning",
        stage: "position_managed",
        symbol: position.symbol,
        summary: `${position.symbol} position is near stop.`,
        detail: `${formatNumberForPayload(positionStopDistancePercent(position))}% from stop.`,
        occurredAt: position.lastMarkedAt ?? position.openedAt,
        action: "Review mark, stop, and exit policy before the next scan.",
      });
    }
    if (isPositionMarkStale(position)) {
      items.push({
        id: `stale-mark-${position.id}`,
        severity: "warning",
        stage: "position_managed",
        symbol: position.symbol,
        summary: `${position.symbol} mark is stale.`,
        detail: `Last marked ${position.lastMarkedAt ?? "unknown"}.`,
        occurredAt: position.lastMarkedAt ?? position.openedAt,
        action: "Run scan or check option quote hydration.",
      });
    }
  });

  return items.sort((left, right) => {
    const severityRank = { critical: 0, warning: 1, info: 2 };
    return severityRank[left.severity] - severityRank[right.severity];
  });
}

function formatEnumReason(value: string) {
  return value.replace(/_/g, " ");
}

function formatNumberForPayload(value: number | null) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(1));
}

function shadowLinkStatus(value: SignalOptionsShadowLink | null | undefined) {
  if (!value) {
    return "No shadow order/fill/position link found.";
  }
  return [
    value.orderId ? "order linked" : "order missing",
    value.fillId ? "fill linked" : "fill missing",
    value.positionId ? "position linked" : "position missing",
    value.attributionStatus,
  ].join(" / ");
}

function isUuidLike(value: string | null | undefined) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

async function resolveSourceBacktest(deployment: AlgoDeployment) {
  const config = asRecord(deployment.config);
  const sourceRunId =
    compactString(config.sourceRunId) ?? compactString(config.runId);
  const validSourceRunId = isUuidLike(sourceRunId) ? sourceRunId : null;
  const sourceStudyId = compactString(config.sourceStudyId);
  const [strategy] = await db
    .select()
    .from(algoStrategiesTable)
    .where(eq(algoStrategiesTable.id, deployment.strategyId))
    .limit(1);
  const [run] = validSourceRunId
    ? await db
        .select()
        .from(backtestRunsTable)
        .where(eq(backtestRunsTable.id, validSourceRunId))
        .limit(1)
    : [];

  return {
    strategyId: deployment.strategyId,
    strategyName: strategy?.name ?? deployment.name,
    sourceRunId: sourceRunId ?? null,
    sourceStudyId: sourceStudyId ?? run?.studyId ?? null,
    runName: run?.name ?? null,
    strategyVersion:
      compactString(config.strategyVersion) ?? run?.strategyVersion ?? null,
    metrics: (run?.metrics as Record<string, unknown> | null) ?? null,
    promotedAt:
      strategy?.createdAt?.toISOString?.() ?? deployment.createdAt.toISOString(),
  };
}

async function buildStatePayload(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  events: ExecutionEvent[];
}) {
  const signalEvents = signalOptionsEvents(input.events);
  const shadowIndex = await buildSignalOptionsShadowIndex(signalEvents);
  const activePositions = deriveActivePositions(signalEvents);
  const candidateEvents = new Map<string, ExecutionEvent[]>();
  const candidatesById = new Map<string, SignalOptionsCandidate>();

  for (const event of [...signalEvents].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  )) {
    const candidate = candidateFromEvent(event);
    if (!candidate) {
      continue;
    }
    const existing = candidatesById.get(candidate.id);
    candidatesById.set(candidate.id, {
      ...existing,
      ...candidate,
      selectedContract:
        Object.keys(asRecord(candidate.selectedContract)).length
          ? candidate.selectedContract
          : existing?.selectedContract ?? null,
      quote:
        Object.keys(asRecord(candidate.quote)).length
          ? candidate.quote
          : existing?.quote ?? null,
      orderPlan:
        Object.keys(asRecord(candidate.orderPlan)).length
          ? candidate.orderPlan
          : existing?.orderPlan ?? null,
      liquidity:
        Object.keys(asRecord(candidate.liquidity)).length
          ? candidate.liquidity
          : existing?.liquidity ?? null,
      reason: candidate.reason ?? existing?.reason ?? null,
    });
    candidateEvents.set(candidate.id, [
      ...(candidateEvents.get(candidate.id) ?? []),
      event,
    ]);
  }

  const candidates = Array.from(candidatesById.values())
    .map((candidate) => {
      const eventsForCandidate = candidateEvents.get(candidate.id) ?? [];
      const shadowLink =
        shadowIndex.byCandidateId.get(candidate.id) ??
        eventsForCandidate
          .map((event) => shadowIndex.byEventId.get(event.id))
          .find((link): link is SignalOptionsShadowLink => Boolean(link)) ??
        null;
      const { actionStatus, syncStatus } = deriveCandidateActionStatus({
        candidate,
        events: eventsForCandidate,
        shadowLink: shadowLink ?? undefined,
      });
      return {
        ...candidate,
        actionStatus,
        syncStatus,
        shadowLink,
        timeline: eventsForCandidate
          .slice()
          .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
          .map((event) =>
            eventTimelineItem(event, shadowIndex.byEventId.get(event.id)),
          ),
      };
    })
    .sort((left, right) => {
      const leftTime = dateOrNull(left.timeline?.at(-1)?.occurredAt)?.getTime() ?? 0;
      const rightTime = dateOrNull(right.timeline?.at(-1)?.occurredAt)?.getTime() ?? 0;
      return rightTime - leftTime;
    })
    .slice(0, 75);
  const openPremium = activePositions.reduce(
    (sum, position) => sum + position.premiumAtRisk,
    0,
  );
  const dailyRealizedPnl = computeSignalOptionsDailyRealizedPnl(signalEvents);
  const openUnrealizedPnl =
    computeSignalOptionsOpenUnrealizedPnl(activePositions);
  const dailyPnl = dailyRealizedPnl + openUnrealizedPnl;

  return {
    deployment: deploymentToResponse(input.deployment),
    profile: input.profile,
    mode: "shadow",
    candidates,
    activePositions,
    risk: {
      openSymbols: activePositions.length,
      maxOpenSymbols: input.profile.riskCaps.maxOpenSymbols,
      openPremium: Number(openPremium.toFixed(2)),
      maxPremiumPerEntry: input.profile.riskCaps.maxPremiumPerEntry,
      maxContracts: input.profile.riskCaps.maxContracts,
      maxDailyLoss: input.profile.riskCaps.maxDailyLoss,
      dailyRealizedPnl: Number(dailyRealizedPnl.toFixed(2)),
      openUnrealizedPnl: Number(openUnrealizedPnl.toFixed(2)),
      dailyPnl: Number(dailyPnl.toFixed(2)),
      dailyHaltActive: dailyPnl <= -Math.abs(input.profile.riskCaps.maxDailyLoss),
    },
    events: signalEvents.slice(0, 75).map(eventToResponse),
  };
}

export async function listSignalOptionsAutomationState(input: {
  deploymentId: string;
}) {
  const deployment = await getDeploymentOrThrow(input.deploymentId);
  const profile = resolveDeploymentProfile(deployment);
  const events = await listDeploymentEvents(deployment.id, 500);

  return buildStatePayload({ deployment, profile, events });
}

export async function getAlgoDeploymentCockpit(input: {
  deploymentId: string;
}) {
  const deployment = await getDeploymentOrThrow(input.deploymentId);
  const [profile, events, readiness, fleetRows] = await Promise.all([
    Promise.resolve(resolveDeploymentProfile(deployment)),
    listDeploymentEvents(deployment.id, 750),
    getAlgoGatewayReadiness(),
    db
      .select()
      .from(algoDeploymentsTable)
      .where(eq(algoDeploymentsTable.mode, deployment.mode))
      .orderBy(desc(algoDeploymentsTable.updatedAt)),
  ]);
  const state = await buildStatePayload({ deployment, profile, events });
  const pipelineStages = buildCockpitPipeline({
    deployment,
    readiness,
    candidates: state.candidates,
    activePositions: state.activePositions,
    risk: state.risk,
    events,
  });
  const attentionItems = buildCockpitAttention({
    deployment,
    readiness,
    candidates: state.candidates,
    activePositions: state.activePositions,
    risk: state.risk,
    events,
  });
  const sourceBacktest = await resolveSourceBacktest(deployment);
  const signalOptionFleet = fleetRows.filter(deploymentHasSignalOptionsProfile);
  const enabledDeployments = signalOptionFleet.filter((item) => item.enabled);
  const erroredDeployments = signalOptionFleet.filter((item) => item.lastError);
  const latestFleetEvent = events[0] ?? null;

  return {
    fleet: {
      mode: deployment.mode,
      totalDeployments: signalOptionFleet.length,
      enabledDeployments: enabledDeployments.length,
      pausedDeployments: Math.max(
        0,
        signalOptionFleet.length - enabledDeployments.length,
      ),
      erroredDeployments: erroredDeployments.length,
      activeBlockers: attentionItems.filter(
        (item) => item.severity === "critical",
      ).length,
      latestEventAt: latestFleetEvent?.occurredAt.toISOString() ?? null,
    },
    deployment: deploymentToResponse(deployment),
    readiness: {
      ready: readiness.ready,
      reason: readiness.reason,
      message: readiness.message,
      scanDisabledReason: readiness.ready ? null : readiness.message,
      enableDisabledReason: readiness.ready ? null : readiness.message,
      profileDisabledReason: null,
    },
    pipelineStages,
    attentionItems,
    kpis: {
      todayPnl: state.risk.dailyPnl,
      dailyRealizedPnl: state.risk.dailyRealizedPnl,
      openUnrealizedPnl: state.risk.openUnrealizedPnl,
      maxDailyLoss: state.risk.maxDailyLoss,
      dailyLossRemaining:
        Math.abs(Number(state.risk.maxDailyLoss ?? 0)) +
        Number(state.risk.dailyPnl ?? 0),
      openPremium: state.risk.openPremium,
      openSymbols: state.risk.openSymbols,
      maxOpenSymbols: state.risk.maxOpenSymbols,
      candidates: state.candidates.length,
      blockedCandidates: state.candidates.filter(
        (candidate) =>
          candidate.actionStatus === "blocked" ||
          candidate.status === "skipped",
      ).length,
      shadowFilledCandidates: state.candidates.filter((candidate) =>
        ["shadow_filled", "partial_shadow", "closed"].includes(
          String(candidate.actionStatus ?? ""),
        ),
      ).length,
      openPositions: state.activePositions.length,
    },
    risk: state.risk,
    candidates: state.candidates,
    activePositions: state.activePositions,
    events: state.events,
    sourceBacktest,
    generatedAt: new Date().toISOString(),
  };
}

export async function listEnabledSignalOptionsDeployments() {
  const deployments = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.enabled, true))
    .orderBy(desc(algoDeploymentsTable.updatedAt));

  return deployments.filter(deploymentHasSignalOptionsProfile);
}

async function refreshActivePosition(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  position: SignalOptionsPosition;
}) {
  const contract = input.position.selectedContract;
  const expirationDate = dateOrNull(contract.expirationDate);
  const optionRight = contract.right === "put" ? "put" : "call";
  if (!expirationDate) {
    return;
  }

  const chain = await getOptionChainWithDebug({
    underlying: input.position.symbol,
    expirationDate,
    contractType: optionRight,
    strikesAroundMoney: 4,
    strikeCoverage: "standard",
    quoteHydration: "snapshot",
  });
  const providerContractId =
    typeof contract.providerContractId === "string"
      ? contract.providerContractId
      : null;
  const strike = finiteNumber(contract.strike);
  const quote = (chain.contracts as SignalOptionsOptionQuote[]).find((item) => {
    const itemContract = asRecord(item.contract);
    if (
      providerContractId &&
      itemContract.providerContractId === providerContractId
    ) {
      return true;
    }
    return (
      finiteNumber(itemContract.strike) === strike &&
      itemContract.right === optionRight
    );
  });

  if (!quote) {
    return;
  }

  const liquidity = resolveSignalOptionsLiquidity(quote, input.profile);
  const markPrice = liquidity.mid ?? finiteNumber(quote.mark) ?? finiteNumber(quote.last);
  if (markPrice == null || markPrice <= 0) {
    return;
  }

  const peakPrice = Math.max(input.position.peakPrice, markPrice);
  const stop = computePositionStop({
    entryPrice: input.position.entryPrice,
    peakPrice,
    markPrice,
    profile: input.profile,
  });
  const exitPrice =
    liquidity.bid != null && liquidity.mid != null
      ? Number((liquidity.mid - (liquidity.mid - liquidity.bid) * 0.9).toFixed(2))
      : Number(markPrice.toFixed(2));
  const positionPatch = {
    ...input.position,
    peakPrice,
    stopPrice: stop.stopPrice,
    lastMarkPrice: Number(markPrice.toFixed(2)),
    lastMarkedAt: new Date().toISOString(),
  };

  if (stop.exitReason) {
    await insertSignalOptionsEvent({
      deployment: input.deployment,
      symbol: input.position.symbol,
      eventType: SIGNAL_OPTIONS_EXIT_EVENT,
      summary: `${input.position.symbol} shadow exit ${stop.exitReason} at ${exitPrice.toFixed(2)}`,
      payload: {
        reason: stop.exitReason,
        exitPrice,
        markPrice,
        pnl: Number(
          ((exitPrice - input.position.entryPrice) *
            input.position.quantity *
            100).toFixed(2),
        ),
        position: positionPatch,
        selectedContract: input.position.selectedContract,
        quote: quoteToPayload(quote),
        liquidity,
        stop,
      },
    });
    return;
  }

  if (
    peakPrice !== input.position.peakPrice ||
    stop.stopPrice !== input.position.stopPrice
  ) {
    await insertSignalOptionsEvent({
      deployment: input.deployment,
      symbol: input.position.symbol,
      eventType: SIGNAL_OPTIONS_MARK_EVENT,
      summary: `${input.position.symbol} shadow mark ${markPrice.toFixed(2)} stop ${stop.stopPrice.toFixed(2)}`,
      payload: {
        position: positionPatch,
        selectedContract: input.position.selectedContract,
        quote: quoteToPayload(quote),
        liquidity,
        stop,
      },
    });
  }
}

async function emitSkippedCandidate(input: {
  deployment: AlgoDeployment;
  candidate: SignalOptionsCandidate;
  signalKey: string;
  reason: string;
  detail?: Record<string, unknown>;
}) {
  await insertSignalOptionsEvent({
    deployment: input.deployment,
    symbol: input.candidate.symbol,
    eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
    summary: `${input.candidate.symbol} shadow candidate skipped: ${input.reason}`,
    payload: {
      signalKey: input.signalKey,
      candidate: {
        ...input.candidate,
        status: "skipped",
      },
      reason: input.reason,
      ...(input.detail ?? {}),
    },
  });
}

async function processEntryCandidate(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  candidate: SignalOptionsCandidate;
  signalKey: string;
}) {
  const expirations = await getOptionExpirationsWithDebug({
    underlying: input.candidate.symbol,
  });
  const selectedExpiration = selectSignalOptionsExpiration(
    expirations.expirations,
    input.profile,
  );
  if (!selectedExpiration) {
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason: "no_expiration_in_dte_window",
      detail: {
        expirationsDebug: expirations.debug,
      },
    });
    return false;
  }

  const chain = await getOptionChainWithDebug({
    underlying: input.candidate.symbol,
    expirationDate: selectedExpiration.expirationDate,
    contractType: input.candidate.optionRight,
    strikesAroundMoney: 6,
    strikeCoverage: "standard",
    quoteHydration: "snapshot",
  });
  const selectedQuote = selectSignalOptionsContractFromChain({
    contracts: chain.contracts as SignalOptionsOptionQuote[],
    direction: input.candidate.direction,
    signalPrice: input.candidate.signalPrice,
    profile: input.profile,
  });
  if (!selectedQuote) {
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason: "no_contract_for_strike_slot",
      detail: {
        selectedExpiration: {
          expirationDate: selectedExpiration.expirationDate.toISOString(),
          dte: selectedExpiration.dte,
        },
        chainDebug: chain.debug,
      },
    });
    return false;
  }

  const orderPlan = buildSignalOptionsShadowOrderPlan(
    selectedQuote,
    input.profile,
  );
  const selectedContract = contractToPayload(selectedQuote);
  const quote = quoteToPayload(selectedQuote);
  if (!orderPlan.ok) {
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason: String(orderPlan.reason || "liquidity_gate_failed"),
      detail: {
        selectedContract,
        quote,
        liquidity: orderPlan.liquidity,
        selectedExpiration: {
          expirationDate: selectedExpiration.expirationDate.toISOString(),
          dte: selectedExpiration.dte,
        },
        chainDebug: chain.debug,
      },
    });
    return false;
  }

  const simulatedFillPrice = finiteNumber(orderPlan.simulatedFillPrice);
  const quantity = finiteNumber(orderPlan.quantity);
  const premiumAtRisk = finiteNumber(orderPlan.premiumAtRisk);
  if (simulatedFillPrice == null || quantity == null || premiumAtRisk == null) {
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason: "invalid_shadow_order_plan",
      detail: {
        selectedContract,
        quote,
        orderPlan,
      },
    });
    return false;
  }

  const stopPrice = buildInitialStopPrice(simulatedFillPrice, input.profile);
  const position = {
    id: `${input.deployment.id}:${input.candidate.symbol}`,
    candidateId: input.candidate.id,
    symbol: input.candidate.symbol,
    direction: input.candidate.direction,
    optionRight: input.candidate.optionRight,
    timeframe: input.candidate.timeframe,
    signalAt: input.candidate.signalAt,
    openedAt: new Date().toISOString(),
    entryPrice: simulatedFillPrice,
    quantity,
    peakPrice: simulatedFillPrice,
    stopPrice,
    premiumAtRisk,
    selectedContract,
  };

  await insertSignalOptionsEvent({
    deployment: input.deployment,
    symbol: input.candidate.symbol,
    eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
    summary: `${input.candidate.symbol} shadow ${input.candidate.optionRight.toUpperCase()} ${selectedContract.strike ?? "strike"} ${selectedContract.expirationDate ?? "expiry"} x${quantity}`,
    payload: {
      signalKey: input.signalKey,
      candidate: {
        ...input.candidate,
        status: "open",
        selectedContract,
        quote,
        orderPlan,
      },
      profile: input.profile,
      selectedExpiration: {
        expirationDate: selectedExpiration.expirationDate.toISOString(),
        dte: selectedExpiration.dte,
      },
      selectedContract,
      quote,
      orderPlan,
      liquidity: orderPlan.liquidity,
      position,
      chainDebug: chain.debug,
    },
  });

  return true;
}

async function closePositionForOppositeSignal(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  position: SignalOptionsPosition;
  signalKey: string;
  candidate: SignalOptionsCandidate;
}) {
  const exitPrice = input.position.lastMarkPrice ?? input.position.entryPrice;
  await insertSignalOptionsEvent({
    deployment: input.deployment,
    symbol: input.position.symbol,
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    summary: `${input.position.symbol} shadow exit opposite signal at ${exitPrice.toFixed(2)}`,
    payload: {
      signalKey: input.signalKey,
      reason: "opposite_signal",
      candidate: input.candidate,
      exitPrice,
      pnl: Number(
        ((exitPrice - input.position.entryPrice) *
          input.position.quantity *
          100).toFixed(2),
      ),
      position: input.position,
      selectedContract: input.position.selectedContract,
      profile: input.profile,
    },
  });
}

async function recordSignalOptionsGatewayBlocked(input: {
  deployment: AlgoDeployment;
  readiness: AlgoGatewayReadiness;
  source: "manual" | "worker";
}) {
  await insertSignalOptionsEvent({
    deployment: input.deployment,
    eventType: SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT,
    summary: `Signal-options scan blocked: ${input.readiness.message}`,
    payload: {
      source: input.source,
      reason: input.readiness.reason,
      readiness: input.readiness,
    },
  });
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readChangedFields(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => readNonEmptyString(item))
        .filter((item): item is string => Boolean(item)),
    ),
  );
}

export async function recordSignalOptionsManualDeviation(input: {
  deploymentId: string;
  deviation: Record<string, unknown>;
}) {
  const deployment = await getDeploymentOrThrow(input.deploymentId);
  const candidateId = readNonEmptyString(input.deviation.candidateId);
  const symbol = normalizeSymbol(String(input.deviation.symbol ?? "")).toUpperCase();
  const source = readNonEmptyString(input.deviation.source) ?? "trade_preview";
  const changedFields = readChangedFields(input.deviation.changedFields);

  if (!candidateId) {
    throw new HttpError(400, "Missing signal-options candidate id.", {
      code: "invalid_signal_options_deviation",
      detail: "candidateId must be a non-empty string.",
    });
  }

  if (!symbol) {
    throw new HttpError(400, "Missing signal-options symbol.", {
      code: "invalid_signal_options_deviation",
      detail: "symbol must be a non-empty string.",
    });
  }

  if (changedFields.length === 0) {
    throw new HttpError(400, "Missing manual deviation fields.", {
      code: "invalid_signal_options_deviation",
      detail: "changedFields must contain at least one changed field.",
    });
  }

  const event = await insertSignalOptionsEvent({
    deployment,
    symbol,
    eventType: SIGNAL_OPTIONS_MANUAL_DEVIATION_EVENT,
    summary: `${symbol} manual preview deviation from signal-options plan`,
    payload: {
      candidateId,
      symbol,
      source,
      changedFields,
      plannedContract: asRecord(input.deviation.plannedContract),
      plannedOrderPlan: asRecord(input.deviation.plannedOrderPlan),
      actualOrderRequest: asRecord(input.deviation.actualOrderRequest),
      automationCandidate: asRecord(input.deviation.automationCandidate),
      metadata: asRecord(input.deviation.metadata),
    },
  });

  return {
    event: eventToResponse(event),
  };
}

export async function runSignalOptionsShadowScan(input: {
  deploymentId: string;
  forceEvaluate?: boolean;
  source?: "manual" | "worker";
}) {
  if (activeScanDeploymentIds.has(input.deploymentId)) {
    throw new HttpError(409, "Signal-options scan is already running.", {
      code: "signal_options_scan_running",
      detail:
        "A worker or manual scan is already active for this deployment.",
      expose: true,
    });
  }
  activeScanDeploymentIds.add(input.deploymentId);
  try {
    return await runSignalOptionsShadowScanUnlocked(input);
  } finally {
    activeScanDeploymentIds.delete(input.deploymentId);
  }
}

async function runSignalOptionsShadowScanUnlocked(input: {
  deploymentId: string;
  forceEvaluate?: boolean;
  source?: "manual" | "worker";
}) {
  const deployment = await getDeploymentOrThrow(input.deploymentId);
  const source = input.source ?? "manual";
  const readiness = await getAlgoGatewayReadiness();
  if (!readiness.ready) {
    await recordSignalOptionsGatewayBlocked({ deployment, readiness, source });
    throwAlgoGatewayNotReady(readiness);
  }

  const profile = resolveDeploymentProfile(deployment);
  const initialEvents = await listDeploymentEvents(deployment.id, 500);
  const initialSignalEvents = signalOptionsEvents(initialEvents);
  const initialPositions = deriveActivePositions(initialSignalEvents);

  for (const position of initialPositions) {
    await refreshActivePosition({ deployment, profile, position }).catch(
      async (error: unknown) => {
        await insertSignalOptionsEvent({
          deployment,
          symbol: position.symbol,
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          summary: `${position.symbol} shadow mark skipped: option quote unavailable`,
          payload: {
            reason: "position_mark_failed",
            message:
              error instanceof Error ? error.message : "Unknown position mark error",
            position,
          },
        });
      },
    );
  }

  const eventsAfterMarks = await listDeploymentEvents(deployment.id, 750);
  const seenSignals = seenSignalKeys(eventsAfterMarks);
  const activePositionsAfterMarks = deriveActivePositions(
    signalOptionsEvents(eventsAfterMarks),
  );
  const dailyPnl = computeSignalOptionsDailyPnl(
    eventsAfterMarks,
    activePositionsAfterMarks,
  );
  const dailyHaltActive = dailyPnl <= -Math.abs(profile.riskCaps.maxDailyLoss);
  const activePositionsBySymbol = new Map(
    activePositionsAfterMarks.map((position) => [
      normalizeSymbol(position.symbol).toUpperCase(),
      position,
    ]),
  );
  const universe = new Set(
    deployment.symbolUniverse
      .map((symbol) => normalizeSymbol(symbol).toUpperCase())
      .filter(Boolean),
  );
  const evaluated =
    input.forceEvaluate === false
      ? await getSignalMonitorState({
          environment: deployment.mode,
        })
      : await evaluateSignalMonitor({
          environment: deployment.mode,
          mode: "incremental",
        });
  let lastSignalAt: Date | null = null;
  let openSymbols = activePositionsBySymbol.size;

  for (const state of evaluated.states as SignalMonitorState[]) {
    const symbol = normalizeSymbol(state.symbol).toUpperCase();
    if (!symbol || (universe.size > 0 && !universe.has(symbol))) {
      continue;
    }
    if (
      !state.fresh ||
      !state.currentSignalDirection ||
      !state.currentSignalAt
    ) {
      continue;
    }
    const signalAt = toIsoString(state.currentSignalAt);
    if (!signalAt) {
      continue;
    }
    const signalKey = buildSignalKey(state, signalAt);
    if (seenSignals.has(signalKey)) {
      continue;
    }

    seenSignals.add(signalKey);
    const candidate = buildCandidateFromSignal({
      deployment,
      state,
      signalAt,
    });
    const currentPosition = activePositionsBySymbol.get(symbol);

    if (currentPosition && currentPosition.direction === candidate.direction) {
      await emitSkippedCandidate({
        deployment,
        candidate,
        signalKey,
        reason: "same_direction_position_open",
        detail: { position: currentPosition },
      });
      continue;
    }

    if (currentPosition && currentPosition.direction !== candidate.direction) {
      if (!profile.exitPolicy.flipOnOppositeSignal) {
        await emitSkippedCandidate({
          deployment,
          candidate,
          signalKey,
          reason: "opposite_signal_flip_disabled",
          detail: { position: currentPosition },
        });
        continue;
      }
      await closePositionForOppositeSignal({
        deployment,
        profile,
        position: currentPosition,
        signalKey,
        candidate,
      });
      activePositionsBySymbol.delete(symbol);
      openSymbols = Math.max(0, openSymbols - 1);
    }

    if (dailyHaltActive) {
      await emitSkippedCandidate({
        deployment,
        candidate,
        signalKey,
        reason: "daily_loss_halt_active",
        detail: {
          dailyPnl,
          maxDailyLoss: profile.riskCaps.maxDailyLoss,
        },
      });
      continue;
    }

    if (openSymbols >= profile.riskCaps.maxOpenSymbols) {
      await emitSkippedCandidate({
        deployment,
        candidate,
        signalKey,
        reason: "max_open_symbols_reached",
        detail: {
          openSymbols,
          maxOpenSymbols: profile.riskCaps.maxOpenSymbols,
        },
      });
      continue;
    }

    const opened = await processEntryCandidate({
      deployment,
      profile,
      candidate,
      signalKey,
    }).catch(async (error: unknown) => {
      await emitSkippedCandidate({
        deployment,
        candidate,
        signalKey,
        reason: "candidate_resolution_failed",
        detail: {
          message:
            error instanceof Error
              ? error.message
              : "Unknown signal-options resolution error",
        },
      });
      return false;
    });

    if (opened) {
      openSymbols += 1;
      const signalDate = dateOrNull(signalAt);
      if (signalDate && (!lastSignalAt || signalDate > lastSignalAt)) {
        lastSignalAt = signalDate;
      }
    }
  }

  await db
    .update(algoDeploymentsTable)
    .set({
      lastEvaluatedAt: new Date(),
      lastSignalAt: lastSignalAt ?? deployment.lastSignalAt,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(algoDeploymentsTable.id, deployment.id));

  return listSignalOptionsAutomationState({ deploymentId: deployment.id });
}

export async function updateSignalOptionsExecutionProfile(input: {
  deploymentId: string;
  patch: Record<string, unknown>;
}) {
  const deployment = await getDeploymentOrThrow(input.deploymentId);
  const currentProfile = resolveDeploymentProfile(deployment);
  const nextProfile = mergeProfilePatch(currentProfile, input.patch);
  const config = asRecord(deployment.config);
  const [updated] = await db
    .update(algoDeploymentsTable)
    .set({
      config: {
        ...config,
        signalOptions: nextProfile,
      },
      updatedAt: new Date(),
    })
    .where(eq(algoDeploymentsTable.id, deployment.id))
    .returning();

  const nextDeployment = updated ?? deployment;
  await insertSignalOptionsEvent({
    deployment: nextDeployment,
    eventType: "signal_options_profile_updated",
    summary: `Updated signal-options profile for ${nextDeployment.name}`,
    payload: {
      profile: nextProfile,
    },
  });

  return listSignalOptionsAutomationState({
    deploymentId: nextDeployment.id,
  });
}

export const __signalOptionsAutomationInternalsForTests = {
  buildCockpitAttention,
  buildCockpitPipeline,
  computeSignalOptionsDailyPnl,
  computeSignalOptionsDailyRealizedPnl,
  computeSignalOptionsOpenUnrealizedPnl,
};
