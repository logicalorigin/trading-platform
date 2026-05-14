import {
  resolveSignalOptionsExecutionProfile,
  type SignalOptionsExecutionProfile,
} from "@workspace/backtest-core";
import {
  evaluateRayReplicaSignals,
  RAY_REPLICA_SIGNAL_WARMUP_BARS,
  resolveRayReplicaSignalSettings,
  type RayReplicaBar,
  type RayReplicaSignalEvent,
} from "@workspace/rayreplica-core";
import {
  algoDeploymentsTable,
  algoStrategiesTable,
  backtestRunsTable,
  db,
  executionEventsTable,
  signalMonitorEventsTable,
  shadowFillsTable,
  shadowOrdersTable,
  shadowPositionsTable,
  type AlgoDeployment,
  type ExecutionEvent,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import type { BrokerBarSnapshot, QuoteSnapshot } from "../providers/ibkr/client";
import {
  evaluateSignalMonitor,
  getSignalMonitorProfileRow,
  getSignalMonitorState,
  resolveSignalMonitorProfileUniverse,
  type SignalMonitorTimeframe,
} from "./signal-monitor";
import {
  getBars,
  getHistoricalOptionTrades,
  getOptionChainWithDebug,
  getOptionChartBarsWithDebug,
  getOptionExpirationsWithDebug,
  listWatchlists,
  type OptionTradePrint,
} from "./platform";
import {
  getAlgoGatewayReadiness,
  throwAlgoGatewayNotReady,
  type AlgoGatewayReadiness,
} from "./algo-gateway";
import {
  isSignalOptionsShadowConfig,
  normalizeAlgoDeploymentProviderAccountId,
} from "./algo-deployment-account";
import { fetchBridgeOptionQuoteSnapshots } from "./bridge-option-quote-stream";
import {
  SIGNAL_OPTIONS_REPLAY_MARK_SOURCE,
  SIGNAL_OPTIONS_REPLAY_SOURCE,
  computeShadowTradingPatterns,
  recordShadowAutomationEvent,
  resetSignalOptionsReplayRowsForRange,
} from "./shadow-account";

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

type SignalOptionsRunMetadata = {
  runId: string;
  mode: "live_scan" | "historical_backfill" | "replay";
  source:
    | "manual"
    | "worker"
    | "signal_options_backfill"
    | "signal_options_replay";
  startedAt: string;
  marketDate?: string | null;
};

const activeSignalOptionsRunMetadata = new Map<
  string,
  SignalOptionsRunMetadata
>();

const SIGNAL_OPTIONS_MONITOR_STALE_GRACE_MS = 5_000;
const SIGNAL_OPTIONS_POSITION_MARK_SKIP_RATE_LIMIT_MS = 5 * 60 * 1_000;

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

type SignalOptionsSignalSnapshot = {
  profileId: string;
  signalKey?: string | null;
  source: string;
  eventId?: string | null;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  direction: SignalDirection | null;
  signalAt: string | null;
  signalPrice: number | null;
  latestBarAt: string | null;
  barsSinceSignal: number | null;
  fresh: boolean;
  status?: string | null;
  filterState?: Record<string, unknown> | null;
};

type SignalOptionsActionMapping = {
  indicator: "rayreplica";
  signalDirection: SignalDirection;
  optionRight: OptionRight;
  optionAction: "buy_call" | "buy_put";
  orderSide: "buy";
  orderIntent: "open_long_option";
  executionMode: "shadow";
  destinationAccountId: "shadow";
  brokerSubmission: false;
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
  signal?: Record<string, unknown> | null;
  action?: Record<string, unknown> | null;
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
  latestBarAt?: Date | string | null;
  barsSinceSignal?: number | null;
  fresh: boolean;
  status?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalFiniteNumber(value: unknown): number | null {
  return value == null || value === "" ? null : finiteNumber(value);
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

function signalOptionsRunId(input: {
  deployment: AlgoDeployment;
  mode: SignalOptionsRunMetadata["mode"];
  startedAt: Date;
}) {
  const stamp = input.startedAt
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  return [
    "signal-options",
    input.mode,
    input.deployment.id.slice(0, 8),
    stamp,
  ].join(":");
}

function buildSignalOptionsRunMetadata(input: {
  deployment: AlgoDeployment;
  mode: SignalOptionsRunMetadata["mode"];
  source: SignalOptionsRunMetadata["source"];
  marketDate?: string | null;
}) {
  const startedAt = new Date();
  return {
    runId: signalOptionsRunId({
      deployment: input.deployment,
      mode: input.mode,
      startedAt,
    }),
    mode: input.mode,
    source: input.source,
    startedAt: startedAt.toISOString(),
    marketDate: input.marketDate ?? null,
  };
}

function signalOptionsPayloadWithRunMetadata(input: {
  deployment: AlgoDeployment;
  payload: Record<string, unknown>;
}) {
  const metadata = asRecord(input.payload.metadata);
  const activeRun = activeSignalOptionsRunMetadata.get(input.deployment.id);
  const nextMetadata: Record<string, unknown> = {
    ...(activeRun
      ? {
          runId: activeRun.runId,
          runMode: activeRun.mode,
          runSource: activeRun.source,
          runStartedAt: activeRun.startedAt,
          ...(activeRun.marketDate
            ? { marketDate: activeRun.marketDate }
            : {}),
        }
      : {}),
    ...metadata,
    deploymentId: metadata.deploymentId ?? input.deployment.id,
    deploymentName: metadata.deploymentName ?? input.deployment.name,
  };
  return {
    ...input.payload,
    metadata: nextMetadata,
  };
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

function quoteSnapshotToSignalOptionsQuote(input: {
  contract: Record<string, unknown>;
  quote: QuoteSnapshot;
}): SignalOptionsOptionQuote {
  const contract = input.contract;
  const quote = input.quote;
  return {
    contract: {
      ticker: compactString(contract.ticker) ?? undefined,
      underlying: compactString(contract.underlying) ?? undefined,
      expirationDate: contract.expirationDate as string | Date | undefined,
      strike: finiteNumber(contract.strike) ?? undefined,
      right: contract.right === "put" ? "put" : "call",
      multiplier: finiteNumber(contract.multiplier) ?? 100,
      sharesPerContract: finiteNumber(contract.sharesPerContract) ?? 100,
      providerContractId:
        compactString(quote.providerContractId) ??
        compactString(contract.providerContractId),
    },
    bid: finiteNumber(quote.bid),
    ask: finiteNumber(quote.ask),
    last: finiteNumber(quote.price),
    mark: finiteNumber(quote.price),
    impliedVolatility: finiteNumber(quote.impliedVolatility),
    delta: finiteNumber(quote.delta),
    gamma: finiteNumber(quote.gamma),
    theta: finiteNumber(quote.theta),
    vega: finiteNumber(quote.vega),
    openInterest: finiteNumber(quote.openInterest),
    volume: finiteNumber(quote.volume),
    updatedAt: quote.updatedAt,
    quoteFreshness: quote.freshness ?? null,
    marketDataMode: quote.marketDataMode ?? null,
    quoteUpdatedAt: quote.updatedAt,
    dataUpdatedAt: quote.dataUpdatedAt,
    ageMs: finiteNumber(quote.ageMs),
  };
}

function findSignalOptionsQuoteForContract(input: {
  contracts: SignalOptionsOptionQuote[];
  selectedContract: Record<string, unknown>;
}) {
  const selectedContract = input.selectedContract;
  const targetProviderContractId = compactString(
    selectedContract.providerContractId,
  );
  const targetStrike = finiteNumber(selectedContract.strike);
  const targetRight = selectedContract.right === "put" ? "put" : "call";
  const targetExpirationKey = expirationDateKey(selectedContract.expirationDate);

  return (
    input.contracts.find((quote) => {
      const contract = asRecord(quote.contract);
      const providerContractId = compactString(contract.providerContractId);
      const strike = finiteNumber(contract.strike);
      const right = contract.right === "put" ? "put" : "call";
      const expirationKey = expirationDateKey(contract.expirationDate);

      if (
        targetProviderContractId &&
        providerContractId &&
        targetProviderContractId !== providerContractId
      ) {
        return false;
      }
      if (targetStrike != null && strike !== targetStrike) {
        return false;
      }
      if (right !== targetRight) {
        return false;
      }
      if (
        targetExpirationKey &&
        expirationKey &&
        targetExpirationKey !== expirationKey
      ) {
        return false;
      }
      return true;
    }) ?? null
  );
}

function resolvePositionMarkQuote(input: {
  quote: SignalOptionsOptionQuote;
  profile: SignalOptionsExecutionProfile;
}) {
  const liquidity = resolveSignalOptionsLiquidity(input.quote, input.profile);
  const markPrice =
    liquidity.mid ??
    finiteNumber(input.quote.mark) ??
    finiteNumber(input.quote.last);
  const quoteNotFresh = liquidity.reasons.includes("quote_not_fresh");
  return {
    ok: markPrice != null && markPrice > 0 && !quoteNotFresh,
    markPrice,
    liquidity,
    reason:
      markPrice == null || markPrice <= 0
        ? "missing_mark"
        : quoteNotFresh
          ? "quote_not_fresh"
          : null,
  };
}

function positionMarkAttemptPayload(input: {
  source: "provider_snapshot" | "chain_standard" | "chain_full";
  quote: SignalOptionsOptionQuote | null;
  reason?: string | null;
  chainDebug?: unknown;
}) {
  return {
    source: input.source,
    ok: Boolean(input.quote && !input.reason),
    reason: input.reason ?? (input.quote ? null : "quote_unavailable"),
    quote: input.quote ? quoteToPayload(input.quote) : null,
    chainDebug: input.chainDebug ?? null,
  };
}

function positionEventMatchesMarkSkip(input: {
  event: ExecutionEvent;
  position: SignalOptionsPosition;
  reason: string;
}) {
  if (input.event.eventType !== SIGNAL_OPTIONS_SKIPPED_EVENT) {
    return false;
  }
  const payload = asRecord(input.event.payload);
  const reason = compactString(payload.reason ?? payload.skipReason);
  if (reason !== input.reason) {
    return false;
  }
  const position = asRecord(payload.position);
  const positionId = compactString(position.id);
  if (positionId && positionId === input.position.id) {
    return true;
  }
  const candidateId = compactString(position.candidateId);
  return Boolean(candidateId && candidateId === input.position.candidateId);
}

function shouldRecordPositionMarkSkip(input: {
  events: ExecutionEvent[];
  position: SignalOptionsPosition;
  reason: string;
  now: Date;
}) {
  return !input.events.some((event) => {
    if (
      !positionEventMatchesMarkSkip({
        event,
        position: input.position,
        reason: input.reason,
      })
    ) {
      return false;
    }
    const occurredAt = dateOrNull(event.occurredAt);
    return Boolean(
      occurredAt &&
        input.now.getTime() - occurredAt.getTime() <
          SIGNAL_OPTIONS_POSITION_MARK_SKIP_RATE_LIMIT_MS,
    );
  });
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

  return normalizeSignalOptionsDeploymentAccount(deployment);
}

async function listDeploymentEvents(deploymentId: string, limit = 500) {
  return db
    .select()
    .from(executionEventsTable)
    .where(eq(executionEventsTable.deploymentId, deploymentId))
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 1_000));
}

async function listDeploymentBackfillEvents(deploymentId: string) {
  return db
    .select()
    .from(executionEventsTable)
    .where(eq(executionEventsTable.deploymentId, deploymentId))
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(10_000);
}

async function normalizeSignalOptionsDeploymentAccount(
  deployment: AlgoDeployment,
): Promise<AlgoDeployment> {
  if (!deploymentHasSignalOptionsProfile(deployment)) {
    return deployment;
  }

  const providerAccountId = normalizeAlgoDeploymentProviderAccountId({
    providerAccountId: deployment.providerAccountId,
    config: deployment.config,
  });
  if (providerAccountId === deployment.providerAccountId) {
    return deployment;
  }

  const [updated] = await db
    .update(algoDeploymentsTable)
    .set({
      providerAccountId,
      updatedAt: new Date(),
      lastError: null,
    })
    .where(eq(algoDeploymentsTable.id, deployment.id))
    .returning();
  const normalized = updated ?? { ...deployment, providerAccountId };

  await db.insert(executionEventsTable).values({
    deploymentId: deployment.id,
    providerAccountId,
    eventType: "deployment_account_normalized",
    summary: `Routed ${deployment.name} to the Shadow account`,
    payload: {
      previousProviderAccountId: deployment.providerAccountId,
      providerAccountId,
      reason: "signal_options_shadow_execution",
    },
  });

  return normalized;
}

async function insertSignalOptionsEvent(input: {
  deployment: AlgoDeployment;
  symbol?: string | null;
  eventType: string;
  summary: string;
  payload: Record<string, unknown>;
  occurredAt?: Date;
  ledgerSource?: "automation" | "signal_options_replay";
  ledgerMarkSource?: string;
}) {
  const payload = signalOptionsPayloadWithRunMetadata({
    deployment: input.deployment,
    payload: input.payload,
  });
  const [event] = await db
    .insert(executionEventsTable)
    .values({
      deploymentId: input.deployment.id,
      providerAccountId: input.deployment.providerAccountId,
      symbol: input.symbol ? normalizeSymbol(input.symbol).toUpperCase() : null,
      eventType: input.eventType,
      summary: input.summary,
      payload,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .returning();

  if (
    event.eventType === SIGNAL_OPTIONS_ENTRY_EVENT ||
    event.eventType === SIGNAL_OPTIONS_EXIT_EVENT ||
    event.eventType === SIGNAL_OPTIONS_MARK_EVENT
  ) {
    await recordShadowAutomationEvent(event, {
      source: input.ledgerSource,
      markSource: input.ledgerMarkSource,
    }).catch((error) => {
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
  return isSignalOptionsShadowConfig(deployment.config);
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

function buildSignalOptionsSignalSnapshot(input: {
  state: SignalMonitorState;
  signalAt?: string | null;
  signalKey?: string | null;
  source?: string | null;
  eventId?: string | null;
  filterState?: unknown;
}): SignalOptionsSignalSnapshot {
  const signalAt =
    input.signalAt ?? toIsoString(input.state.currentSignalAt) ?? null;
  const filterState = asRecord(input.filterState);
  return {
    profileId: input.state.profileId,
    signalKey: input.signalKey ?? null,
    source:
      compactString(input.source) ??
      (isUuidLike(input.state.profileId) ? "rayreplica" : "rayreplica-runtime"),
    eventId: compactString(input.eventId),
    symbol: normalizeSymbol(input.state.symbol).toUpperCase(),
    timeframe: input.state.timeframe,
    direction: input.state.currentSignalDirection ?? null,
    signalAt,
    signalPrice: optionalFiniteNumber(input.state.currentSignalPrice),
    latestBarAt: toIsoString(input.state.latestBarAt),
    barsSinceSignal: optionalFiniteNumber(input.state.barsSinceSignal),
    fresh: input.state.fresh === true,
    status: compactString(input.state.status),
    filterState: Object.keys(filterState).length ? filterState : null,
  };
}

function buildSignalOptionsActionMapping(
  direction: SignalDirection,
): SignalOptionsActionMapping {
  const optionRight = optionRightForSignal(direction);
  return {
    indicator: "rayreplica",
    signalDirection: direction,
    optionRight,
    optionAction: optionRight === "put" ? "buy_put" : "buy_call",
    orderSide: "buy",
    orderIntent: "open_long_option",
    executionMode: "shadow",
    destinationAccountId: "shadow",
    brokerSubmission: false,
  };
}

async function readSignalMonitorEventMetadata(input: {
  state: SignalMonitorState;
  signalAt: string;
}) {
  if (!isUuidLike(input.state.profileId)) {
    return null;
  }
  const signalAt = dateOrNull(input.signalAt);
  const direction = input.state.currentSignalDirection;
  if (!signalAt || !direction) {
    return null;
  }

  const [event] = await db
    .select()
    .from(signalMonitorEventsTable)
    .where(
      and(
        eq(signalMonitorEventsTable.profileId, input.state.profileId),
        eq(
          signalMonitorEventsTable.symbol,
          normalizeSymbol(input.state.symbol).toUpperCase(),
        ),
        eq(signalMonitorEventsTable.timeframe, input.state.timeframe),
        eq(signalMonitorEventsTable.direction, direction),
        eq(signalMonitorEventsTable.signalAt, signalAt),
      ),
    )
    .orderBy(desc(signalMonitorEventsTable.emittedAt))
    .limit(1);

  if (!event) {
    return null;
  }

  return {
    eventId: event.id,
    source: event.source,
    filterState: asRecord(asRecord(event.payload).filterState),
  };
}

async function listSignalOptionsSignalSnapshots(deployment: AlgoDeployment) {
  const universe = new Set(
    deployment.symbolUniverse
      .map((symbol) => normalizeSymbol(symbol).toUpperCase())
      .filter(Boolean),
  );
  const signalState = await getSignalMonitorState({
    environment: deployment.mode,
  }).catch((error) => {
    logger.warn?.(
      { err: error, deploymentId: deployment.id },
      "Failed to read signal monitor state for signal-options cockpit",
    );
    return null;
  });
  const states = Array.isArray(signalState?.states)
    ? (signalState.states as SignalMonitorState[])
    : [];
  const filteredStates = states.filter((state) => {
    const symbol = normalizeSymbol(state.symbol).toUpperCase();
    return symbol && (universe.size === 0 || universe.has(symbol));
  });

  const snapshots = await Promise.all(
    filteredStates.map(async (state) => {
      const signalAt = toIsoString(state.currentSignalAt);
      const signalKey =
        signalAt && state.currentSignalDirection
          ? buildSignalKey(state, signalAt)
          : null;
      const metadata = signalAt
        ? await readSignalMonitorEventMetadata({ state, signalAt }).catch(
            () => null,
          )
        : null;
      return buildSignalOptionsSignalSnapshot({
        state,
        signalAt,
        signalKey,
        source: metadata?.source ?? null,
        eventId: metadata?.eventId ?? null,
        filterState: metadata?.filterState ?? null,
      });
    }),
  );

  return snapshots.sort((left, right) => {
    const leftTime = dateOrNull(left.signalAt)?.getTime() ?? 0;
    const rightTime = dateOrNull(right.signalAt)?.getTime() ?? 0;
    return rightTime - leftTime;
  });
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

function strikesAroundMoneyForSlot(slot: number) {
  const normalizedSlot = Math.min(5, Math.max(0, Math.floor(slot)));
  if (normalizedSlot === 0 || normalizedSlot === 5) {
    return 3;
  }
  if (normalizedSlot === 1 || normalizedSlot === 4) {
    return 2;
  }
  return 1;
}

const SIGNAL_OPTIONS_FALLBACK_STRIKE_STEPS = 2;

function signalOptionsStrikeSlotsForFallback(input: {
  profile: SignalOptionsExecutionProfile;
  optionRight: OptionRight;
}) {
  const slot =
    input.optionRight === "call"
      ? input.profile.optionSelection.callStrikeSlot
      : input.profile.optionSelection.putStrikeSlot;
  const preferredSlot = Math.min(5, Math.max(0, Math.floor(Number(slot))));
  const slots = [preferredSlot];
  for (let step = 1; step <= SIGNAL_OPTIONS_FALLBACK_STRIKE_STEPS; step += 1) {
    const fallbackSlot =
      input.optionRight === "call" ? preferredSlot + step : preferredSlot - step;
    if (fallbackSlot >= 0 && fallbackSlot <= 5) {
      slots.push(fallbackSlot);
    }
  }
  return Array.from(new Set(slots));
}

function signalOptionsStrikesAroundMoney(input: {
  profile: SignalOptionsExecutionProfile;
  optionRight: OptionRight;
}) {
  const slots = signalOptionsStrikeSlotsForFallback(input);
  return Math.max(...slots.map((slot) => strikesAroundMoneyForSlot(slot)));
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

function selectSignalOptionsContractPlanFromChain(input: {
  contracts: SignalOptionsOptionQuote[];
  direction: SignalDirection;
  signalPrice: number | null;
  profile: SignalOptionsExecutionProfile;
}) {
  const optionRight = optionRightForSignal(input.direction);
  const candidates = input.contracts.filter(
    (quote) => asRecord(quote.contract).right === optionRight,
  );
  const attempts: Array<{
    slot: number;
    fallback: boolean;
    quote: SignalOptionsOptionQuote;
    orderPlan: ReturnType<typeof buildSignalOptionsShadowOrderPlan>;
  }> = [];
  if (!candidates.length) {
    return {
      ok: false,
      selectedQuote: null,
      orderPlan: null,
      attempts,
      preferredSlot: null,
      selectedSlot: null,
      fallbackUsed: false,
    };
  }

  const strikes = Array.from(
    new Set(
      candidates
        .map((quote) => finiteNumber(asRecord(quote.contract).strike))
        .filter((strike): strike is number => strike != null),
    ),
  ).sort((left, right) => left - right);
  if (!strikes.length) {
    return {
      ok: false,
      selectedQuote: null,
      orderPlan: null,
      attempts,
      preferredSlot: null,
      selectedSlot: null,
      fallbackUsed: false,
    };
  }

  const spotPrice = input.signalPrice ?? strikes[Math.floor(strikes.length / 2)]!;
  const slots = signalOptionsStrikeSlotsForFallback({
    profile: input.profile,
    optionRight,
  });
  const attemptedStrikes = new Set<number>();

  for (const slot of slots) {
    const strike = strikes[resolveStrikeIndex({ strikes, spotPrice, slot })];
    if (strike == null || attemptedStrikes.has(strike)) {
      continue;
    }
    attemptedStrikes.add(strike);
    const quote =
      candidates.find(
        (item) => finiteNumber(asRecord(item.contract).strike) === strike,
      ) ?? null;
    if (!quote) {
      continue;
    }

    const orderPlan = buildSignalOptionsShadowOrderPlan(quote, input.profile);
    const attempt = {
      slot,
      fallback: slot !== slots[0],
      quote,
      orderPlan,
    };
    attempts.push(attempt);
    if (orderPlan.ok) {
      return {
        ok: true,
        selectedQuote: quote,
        orderPlan,
        attempts,
        preferredSlot: slots[0] ?? null,
        selectedSlot: slot,
        fallbackUsed: attempt.fallback,
      };
    }
  }

  const firstAttempt = attempts[0] ?? null;
  return {
    ok: false,
    selectedQuote: firstAttempt?.quote ?? null,
    orderPlan: firstAttempt?.orderPlan ?? null,
    attempts,
    preferredSlot: slots[0] ?? null,
    selectedSlot: firstAttempt?.slot ?? null,
    fallbackUsed: false,
  };
}

function signalOptionsContractSelectionPayload(
  selection: ReturnType<typeof selectSignalOptionsContractPlanFromChain>,
) {
  return {
    preferredSlot: selection.preferredSlot,
    selectedSlot: selection.selectedSlot,
    fallbackUsed: selection.fallbackUsed,
    attempts: selection.attempts.map((attempt) => ({
      slot: attempt.slot,
      fallback: attempt.fallback,
      selectedContract: contractToPayload(attempt.quote),
      quote: quoteToPayload(attempt.quote),
      orderPlan: attempt.orderPlan,
      reason: attempt.orderPlan.ok
        ? null
        : String(attempt.orderPlan.reason || "liquidity_gate_failed"),
    })),
  };
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

function shouldRecordActivePositionMark(input: {
  position: SignalOptionsPosition;
  peakPrice: number;
  stopPrice: number;
  markPrice: number;
}) {
  const lastMarkPrice = finiteNumber(input.position.lastMarkPrice);
  return (
    input.peakPrice !== input.position.peakPrice ||
    input.stopPrice !== input.position.stopPrice ||
    lastMarkPrice == null ||
    Math.abs(input.markPrice - lastMarkPrice) >= 0.005
  );
}

function sameUtcMinute(left: unknown, right: unknown) {
  const leftDate = dateOrNull(left);
  const rightDate = dateOrNull(right);
  if (!leftDate || !rightDate) {
    return false;
  }
  return (
    Math.floor(leftDate.getTime() / 60_000) ===
    Math.floor(rightDate.getTime() / 60_000)
  );
}

function shouldRecordActivePositionMarkForScan(input: {
  position: Pick<SignalOptionsPosition, "lastMarkedAt">;
  markAt: Date;
}) {
  return !sameUtcMinute(input.position.lastMarkedAt, input.markAt);
}

function numericArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry))
    : [];
}

function signalDirectionSign(direction: SignalDirection) {
  return direction === "sell" ? -1 : 1;
}

function evaluateSignalOptionsEntryGate(input: {
  candidate: SignalOptionsCandidate;
  profile: SignalOptionsExecutionProfile;
}) {
  const filterState = asRecord(asRecord(input.candidate.signal).filterState);
  const mtfGate = input.profile.entryGate.mtfAlignment ?? {
    enabled: true,
    requiredCount: 2,
  };
  const requiredMtfCount = Math.min(
    3,
    Math.max(1, Math.round(finiteNumber(mtfGate.requiredCount) ?? 2)),
  );
  const adx = finiteNumber(filterState.adx);
  const mtfDirections = numericArray(filterState.mtfDirections);
  const directionSign = signalDirectionSign(input.candidate.direction);
  const mtfMatches = mtfDirections
    .slice(0, 3)
    .filter((direction) => direction === directionSign).length;
  const reasons: string[] = [];

  if (mtfGate.enabled && mtfMatches < requiredMtfCount) {
    reasons.push("mtf_not_aligned");
  }

  const blockedPutSymbols = new Set(
    (input.profile.entryGate.blockedPutSymbols ?? []).map((symbol) =>
      normalizeSymbol(symbol).toUpperCase(),
    ),
  );
  const symbol = normalizeSymbol(input.candidate.symbol).toUpperCase();
  if (
    input.candidate.optionRight === "put" &&
    symbol &&
    blockedPutSymbols.has(symbol)
  ) {
    reasons.push("inverse_put_blocked");
  }

  const gate = input.profile.entryGate.bearishRegime;
  const fullyBullishMtf =
    mtfDirections.length > 0 && mtfDirections.every((direction) => direction > 0);
  const bearishMtfCount = mtfDirections.filter((direction) => direction < 0).length;
  const effectiveMinAdx =
    bearishMtfCount >= 2 ? Math.min(gate.minAdx, 22) : gate.minAdx;

  if (gate.enabled && input.candidate.optionRight === "put") {
    if (adx == null || adx < effectiveMinAdx) {
      reasons.push("adx_below_minimum");
    }
    if (gate.rejectFullyBullishMtf && fullyBullishMtf) {
      reasons.push("mtf_fully_bullish");
    }
  }

  const reason = reasons.includes("inverse_put_blocked")
    ? "inverse_put_blocked"
    : reasons.includes("mtf_not_aligned")
      ? "mtf_not_aligned"
      : reasons.length
        ? "bear_regime_gate_failed"
        : null;

  return {
    ok: reasons.length === 0,
    reason,
    reasons,
    adx,
    minAdx: gate.minAdx,
    effectiveMinAdx,
    mtfDirections,
    requiredMtfCount,
    mtfMatches,
    bearishMtfCount,
    fullyBullishMtf,
    rejectFullyBullishMtf: gate.rejectFullyBullishMtf,
  };
}

function buildCandidateFromSignal(input: {
  deployment: AlgoDeployment;
  state: SignalMonitorState;
  signalAt: string;
  signalKey?: string | null;
  signalMetadata?: {
    eventId?: string | null;
    source?: string | null;
    filterState?: unknown;
  } | null;
}) {
  const direction = input.state.currentSignalDirection ?? "buy";
  const symbol = normalizeSymbol(input.state.symbol).toUpperCase();
  const signal = buildSignalOptionsSignalSnapshot({
    state: input.state,
    signalAt: input.signalAt,
    signalKey: input.signalKey ?? null,
    source: input.signalMetadata?.source ?? null,
    eventId: input.signalMetadata?.eventId ?? null,
    filterState: input.signalMetadata?.filterState ?? null,
  });
  const action = buildSignalOptionsActionMapping(direction);
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
    signalPrice: optionalFiniteNumber(input.state.currentSignalPrice),
    status: "candidate" as const,
    signal,
    action,
  };
}

function candidateFromSignalSnapshot(input: {
  deployment: AlgoDeployment;
  signal: SignalOptionsSignalSnapshot;
}): SignalOptionsCandidate | null {
  const { signal } = input;
  if (!signal.fresh || !signal.signalAt || !signal.direction) {
    return null;
  }

  const symbol = normalizeSymbol(signal.symbol).toUpperCase();
  if (!symbol) {
    return null;
  }

  const action = buildSignalOptionsActionMapping(signal.direction);
  return {
    id: buildCandidateId({
      deploymentId: input.deployment.id,
      symbol,
      direction: signal.direction,
      signalAt: signal.signalAt,
    }),
    deploymentId: input.deployment.id,
    deploymentName: input.deployment.name,
    symbol,
    direction: signal.direction,
    optionRight: optionRightForSignal(signal.direction),
    timeframe: signal.timeframe,
    signalAt: signal.signalAt,
    signalPrice: optionalFiniteNumber(signal.signalPrice),
    status: "candidate",
    selectedContract: null,
    quote: null,
    orderPlan: null,
    liquidity: null,
    reason: null,
    signal,
    action,
  };
}

function signalMonitorPollIntervalMs(profile: Record<string, unknown>) {
  const seconds = finiteNumber(profile.pollIntervalSeconds) ?? 60;
  return Math.min(3_600_000, Math.max(15_000, Math.round(seconds * 1000)));
}

function stateMatchesSignalOptionsUniverse(
  state: Record<string, unknown>,
  universe: Set<string>,
) {
  const symbol = normalizeSymbol(String(state.symbol ?? "")).toUpperCase();
  return Boolean(symbol && (universe.size === 0 || universe.has(symbol)));
}

function shouldRefreshSignalOptionsMonitorState(input: {
  evaluated: unknown;
  universe: Set<string>;
  now?: Date;
}) {
  const evaluated = asRecord(input.evaluated);
  const profile = asRecord(evaluated.profile);
  const profileId = compactString(profile.id) ?? "";
  const runtimeFallbackProfile = profileId.startsWith("runtime-fallback-");
  const lastEvaluatedAt = dateOrNull(profile.lastEvaluatedAt);
  const now = input.now ?? new Date();
  const states = asArray(evaluated.states)
    .map(asRecord)
    .filter((state) => stateMatchesSignalOptionsUniverse(state, input.universe));

  if (!runtimeFallbackProfile) {
    if (!lastEvaluatedAt) {
      return true;
    }
    const maxAgeMs =
      signalMonitorPollIntervalMs(profile) + SIGNAL_OPTIONS_MONITOR_STALE_GRACE_MS;
    if (now.getTime() - lastEvaluatedAt.getTime() > maxAgeMs) {
      return true;
    }
  }

  if (input.universe.size > 0) {
    const stateSymbols = new Set(
      states
        .map((state) => normalizeSymbol(String(state.symbol ?? "")).toUpperCase())
        .filter(Boolean),
    );
    for (const symbol of input.universe) {
      if (!stateSymbols.has(symbol)) {
        return true;
      }
    }
  }

  if (!states.length) {
    return true;
  }

  return states.some((state) =>
    ["error", "stale", "unavailable"].includes(
      String(state.status ?? "").toLowerCase(),
    ),
  );
}

async function loadSignalOptionsMonitorState(input: {
  deployment: AlgoDeployment;
  universe: Set<string>;
  forceEvaluate?: boolean;
}) {
  if (input.forceEvaluate !== false) {
    return evaluateSignalMonitor({
      environment: input.deployment.mode,
      mode: "incremental",
    });
  }

  const current = await getSignalMonitorState({
    environment: input.deployment.mode,
  });
  if (
    shouldRefreshSignalOptionsMonitorState({
      evaluated: current,
      universe: input.universe,
    })
  ) {
    return evaluateSignalMonitor({
      environment: input.deployment.mode,
      mode: "incremental",
    });
  }
  return current;
}

function candidateFromEvent(event: ExecutionEvent): SignalOptionsCandidate | null {
  const payload = asRecord(event.payload);
  const candidate = asRecord(
    Object.keys(asRecord(payload.candidate)).length
      ? payload.candidate
      : payload.automationCandidate,
  );
  const position = asRecord(payload.position);
  const signal = Object.keys(asRecord(candidate.signal)).length
    ? asRecord(candidate.signal)
    : asRecord(payload.signal);
  const action = Object.keys(asRecord(candidate.action)).length
    ? asRecord(candidate.action)
    : asRecord(payload.action);
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
    signal: Object.keys(signal).length ? signal : null,
    action: Object.keys(action).length ? action : null,
  };
}

function mergeSignalOptionsCandidate(
  existing: SignalOptionsCandidate | undefined,
  candidate: SignalOptionsCandidate,
): SignalOptionsCandidate {
  return {
    ...(existing ?? {}),
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
    signal:
      Object.keys(asRecord(candidate.signal)).length
        ? candidate.signal
        : existing?.signal ?? null,
    action:
      Object.keys(asRecord(candidate.action)).length
        ? candidate.action
        : existing?.action ?? null,
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
    if (position.lastMarkPrice == null) {
      return sum;
    }
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

const RETRYABLE_SIGNAL_OPTION_SKIP_REASONS = new Set([
  "candidate_resolution_failed",
  "no_contract_for_strike_slot",
  "no_expiration_in_dte_window",
]);

const FORCE_RETRYABLE_SIGNAL_OPTION_SKIP_REASONS = new Set([
  "candidate_resolution_failed",
  "missing_bid_ask",
  "missing_mark",
  "no_contract_for_strike_slot",
  "no_expiration_in_dte_window",
  "position_mark_unavailable",
  "quote_not_fresh",
  "spread_too_wide",
]);

const RETRYABLE_OPTION_DEBUG_REASONS = new Set([
  "durable_option_chain_after_upstream_failure",
  "durable_option_expirations_after_upstream_failure",
  "option_expirations_degraded_empty",
  "options_backoff",
  "options_degraded_empty",
  "options_upstream_failure",
]);

function signalOptionsPositionMatchesCandidate(input: {
  position: SignalOptionsPosition;
  candidate: Record<string, unknown>;
}) {
  const positionSymbol = normalizeSymbol(input.position.symbol).toUpperCase();
  const candidateSymbol = normalizeSymbol(String(input.candidate.symbol ?? ""))
    .toUpperCase();
  const candidateDirection =
    input.candidate.direction === "sell" ? "sell" : "buy";
  return (
    positionSymbol === candidateSymbol &&
    input.position.direction === candidateDirection
  );
}

function isRetryableSignalOptionsSkip(
  event: ExecutionEvent,
  options?: {
    activePositions?: SignalOptionsPosition[];
    currentPremiumCap?: number | null;
    forceRetryMarketData?: boolean;
  },
) {
  if (event.eventType !== SIGNAL_OPTIONS_SKIPPED_EVENT) {
    return false;
  }
  const payload = asRecord(event.payload);
  const reason = compactString(payload.reason ?? payload.skipReason);
  if (!reason) {
    return false;
  }

  if (
    payload.retryable === true &&
    FORCE_RETRYABLE_SIGNAL_OPTION_SKIP_REASONS.has(reason)
  ) {
    return true;
  }

  if (reason === "premium_budget_too_small") {
    const previousPremiumCap = optionalFiniteNumber(payload.premiumCap);
    const currentPremiumCap = optionalFiniteNumber(options?.currentPremiumCap);
    return (
      currentPremiumCap != null &&
      (previousPremiumCap == null || previousPremiumCap < currentPremiumCap)
    );
  }

  if (reason === "same_direction_position_open") {
    if (!options?.activePositions) {
      return false;
    }
    const candidate = asRecord(payload.candidate);
    return !options.activePositions.some((position) =>
      signalOptionsPositionMatchesCandidate({ position, candidate }),
    );
  }

  if (
    options?.forceRetryMarketData &&
    FORCE_RETRYABLE_SIGNAL_OPTION_SKIP_REASONS.has(reason)
  ) {
    return true;
  }

  if (!RETRYABLE_SIGNAL_OPTION_SKIP_REASONS.has(reason)) {
    return false;
  }

  const chainDebug = asRecord(payload.chainDebug);
  const expirationsDebug = asRecord(payload.expirationsDebug);
  return [chainDebug.reason, expirationsDebug.reason].some((debugReason) => {
    const value = compactString(debugReason);
    return value ? RETRYABLE_OPTION_DEBUG_REASONS.has(value) : false;
  });
}

function seenSignalKeys(
  events: ExecutionEvent[],
  options?: {
    activePositions?: SignalOptionsPosition[];
    currentPremiumCap?: number | null;
    forceRetryMarketData?: boolean;
  },
) {
  return new Set(
    signalOptionsEvents(events)
      .filter((event) => !isRetryableSignalOptionsSkip(event, options))
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
    entryGate: {
      ...current.entryGate,
      ...asRecord(patch.entryGate),
      mtfAlignment: {
        ...current.entryGate.mtfAlignment,
        ...asRecord(asRecord(patch.entryGate).mtfAlignment),
        ...asRecord(patch.mtfAlignment),
      },
      bearishRegime: {
        ...current.entryGate.bearishRegime,
        ...asRecord(asRecord(patch.entryGate).bearishRegime),
        ...asRecord(patch.bearishRegime),
      },
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

function candidateLatestActivityAt(candidate: SignalOptionsCandidate) {
  return candidateLatestTimelineAt(candidate) ?? candidate.signalAt;
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
  const actionMapped = input.candidates.filter(
    (candidate) => Object.keys(asRecord(candidate.action)).length > 0,
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
      id: "action_mapped",
      label: "Action Mapped",
      status: stageStatus({ count: actionMapped.length }),
      count: actionMapped.length,
      latestAt: latestIso(actionMapped.map((candidate) => candidate.signalAt)),
      detail: actionMapped.length
        ? `${actionMapped.length} signals mapped to shadow option actions`
        : "waiting for buy-call or buy-put mapping",
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
      summary: "Market data readiness is blocking scans.",
      detail: input.readiness.message,
      occurredAt: new Date().toISOString(),
      action: "Start or repair the IBKR bridge/data mode before running Shadow scans.",
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

function incrementDiagnosticCounter(
  counter: Record<string, number>,
  value: unknown,
) {
  const key = compactString(value);
  if (!key) {
    return;
  }
  counter[key] = (counter[key] ?? 0) + 1;
}

function sortedDiagnosticCounter(counter: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(counter).sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    ),
  );
}

function signalOptionsDiagnosticEventWeight(event: ExecutionEvent) {
  const payload = asRecord(event.payload);
  const count = finiteNumber(payload.count);
  return count != null && count > 0 ? count : 1;
}

function classifySignalOptionsSkipReason(reason: string) {
  if (
    [
      "position_mark_unavailable",
      "position_mark_failed",
      "invalid_position_mark",
    ].includes(reason)
  ) {
    return "marking";
  }
  if (
    [
      "no_contract_for_strike_slot",
      "no_expiration_in_dte_window",
      "historical_option_bars_unavailable",
      "options_upstream_failure",
    ].includes(reason)
  ) {
    return "contract_resolution";
  }
  if (
    [
      "missing_bid_ask",
      "spread_too_wide",
      "bid_below_minimum",
      "invalid_shadow_order_plan",
      "invalid_historical_shadow_order_plan",
    ].includes(reason)
  ) {
    return "liquidity";
  }
  if (
    [
      "max_open_symbols_reached",
      "daily_loss_halt_active",
      "premium_budget_exceeded",
      "quantity_below_minimum",
    ].includes(reason)
  ) {
    return "risk";
  }
  if (
    [
      "ibkr_not_configured",
      "gateway_socket_disconnected",
      "gateway_not_ready",
      "bridge_unavailable",
    ].includes(reason)
  ) {
    return "gateway";
  }
  if (
    [
      "bear_regime_gate_failed",
      "mtf_not_aligned",
      "inverse_put_blocked",
      "entry_gate_failed",
      "same_direction_position_open",
      "opposite_signal_flip_disabled",
      "candidate_resolution_failed",
    ].includes(reason)
  ) {
    return "signal_policy";
  }
  return "other";
}

function incrementDiagnosticCounterBy(
  counter: Record<string, number>,
  value: unknown,
  count: number,
) {
  const key = compactString(value);
  if (!key || count <= 0) {
    return;
  }
  counter[key] = (counter[key] ?? 0) + count;
}

function updateDiagnosticIncident(
  incidents: Map<
    string,
    {
      source: string;
      reason: string;
      count: number;
      firstSeenAt: string | null;
      lastSeenAt: string | null;
      latestMessage: string | null;
    }
  >,
  event: ExecutionEvent,
) {
  const payload = asRecord(event.payload);
  const reason = compactString(payload.reason) ?? "unknown";
  const source = compactString(payload.source) ?? "unknown";
  const key = `${source}:${reason}`;
  const count = signalOptionsDiagnosticEventWeight(event);
  const readiness = asRecord(payload.readiness);
  const message =
    compactString(readiness.message) ?? compactString(payload.message);
  const firstSeenAt =
    toIsoString(payload.firstSeenAt) ?? event.occurredAt.toISOString();
  const lastSeenAt =
    toIsoString(payload.lastSeenAt) ?? event.occurredAt.toISOString();
  const existing = incidents.get(key);
  if (!existing) {
    incidents.set(key, {
      source,
      reason,
      count,
      firstSeenAt,
      lastSeenAt,
      latestMessage: message,
    });
    return;
  }
  existing.count += count;
  if (!existing.firstSeenAt || firstSeenAt < existing.firstSeenAt) {
    existing.firstSeenAt = firstSeenAt;
  }
  if (!existing.lastSeenAt || lastSeenAt > existing.lastSeenAt) {
    existing.lastSeenAt = lastSeenAt;
    existing.latestMessage = message ?? existing.latestMessage;
  }
}

function buildCockpitDiagnostics(input: {
  signals: SignalOptionsSignalSnapshot[];
  candidates: Array<SignalOptionsCandidate & {
    actionStatus?: SignalOptionsActionStatus;
  }>;
  activePositions: SignalOptionsPosition[];
  events: ExecutionEvent[];
}) {
  const eventTypes: Record<string, number> = {};
  const skipReasons: Record<string, number> = {};
  const skipCategories: Record<string, number> = {};
  const entryGateReasons: Record<string, number> = {};
  const optionChainReasons: Record<string, number> = {};
  const signalStatuses: Record<string, number> = {};
  const readinessIncidents = new Map<
    string,
    {
      source: string;
      reason: string;
      count: number;
      firstSeenAt: string | null;
      lastSeenAt: string | null;
      latestMessage: string | null;
    }
  >();
  let firstEventAt: string | null = null;
  let latestEventAt: string | null = null;
  let entryEvents = 0;
  let exitEvents = 0;
  let markEvents = 0;
  let gatewayBlocks = 0;

  for (const event of input.events) {
    incrementDiagnosticCounter(eventTypes, event.eventType);
    const eventWeight = signalOptionsDiagnosticEventWeight(event);
    const occurredAt = event.occurredAt.toISOString();
    if (!firstEventAt || occurredAt < firstEventAt) {
      firstEventAt = occurredAt;
    }
    if (!latestEventAt || occurredAt > latestEventAt) {
      latestEventAt = occurredAt;
    }

    if (event.eventType === SIGNAL_OPTIONS_ENTRY_EVENT) {
      entryEvents += 1;
    } else if (event.eventType === SIGNAL_OPTIONS_EXIT_EVENT) {
      exitEvents += 1;
    } else if (event.eventType === SIGNAL_OPTIONS_MARK_EVENT) {
      markEvents += 1;
    } else if (event.eventType === SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT) {
      gatewayBlocks += eventWeight;
      updateDiagnosticIncident(readinessIncidents, event);
    }

    const payload = asRecord(event.payload);
    const skipReason = compactString(payload.reason ?? payload.skipReason);
    if (skipReason) {
      incrementDiagnosticCounterBy(skipReasons, skipReason, eventWeight);
      incrementDiagnosticCounterBy(
        skipCategories,
        classifySignalOptionsSkipReason(skipReason),
        eventWeight,
      );
    }

    const entryGate = asRecord(payload.entryGate);
    if (Array.isArray(entryGate.reasons)) {
      entryGate.reasons.forEach((reason) =>
        incrementDiagnosticCounter(entryGateReasons, reason),
      );
    }

    const chainDebug = asRecord(payload.chainDebug);
    const expirationsDebug = asRecord(payload.expirationsDebug);
    incrementDiagnosticCounter(optionChainReasons, chainDebug.reason);
    incrementDiagnosticCounter(optionChainReasons, expirationsDebug.reason);
  }

  const freshSignals = input.signals.filter((signal) => signal.fresh).length;
  const signalsWithoutDirection = input.signals.filter(
    (signal) => !signal.direction,
  ).length;
  for (const signal of input.signals) {
    incrementDiagnosticCounter(signalStatuses, signal.status ?? "unknown");
  }

  const blockedCandidates = input.candidates.filter(
    (candidate) =>
      candidate.actionStatus === "blocked" || candidate.status === "skipped",
  );
  const contractsSelected = input.candidates.filter(
    (candidate) => Object.keys(asRecord(candidate.selectedContract)).length > 0,
  );
  const actionMapped = input.candidates.filter(
    (candidate) => Object.keys(asRecord(candidate.action)).length > 0,
  );
  const liquidityAccepted = input.candidates.filter((candidate) => {
    const orderPlan = asRecord(candidate.orderPlan);
    const liquidity = asRecord(candidate.liquidity);
    return (
      orderPlan.ok === true ||
      liquidity.ok === true ||
      ["shadow_filled", "partial_shadow", "closed"].includes(
        String(candidate.actionStatus ?? ""),
      )
    );
  });
  const shadowFilledCandidates = input.candidates.filter((candidate) =>
    ["shadow_filled", "partial_shadow", "closed"].includes(
      String(candidate.actionStatus ?? ""),
    ),
  );
  const shadowFillCount = Math.max(shadowFilledCandidates.length, entryEvents);
  const now = new Date();
  const markFailureEvents = input.events.filter((event) => {
    const reason = compactString(asRecord(event.payload).reason);
    return (
      event.eventType === SIGNAL_OPTIONS_SKIPPED_EVENT &&
      (reason === "position_mark_unavailable" ||
        reason === "position_mark_failed")
    );
  });
  const markHealthPositions = input.activePositions.map((position) => {
    const markedAt = dateOrNull(position.lastMarkedAt);
    const ageMs = markedAt ? now.getTime() - markedAt.getTime() : null;
    return {
      id: position.id,
      candidateId: position.candidateId,
      symbol: position.symbol,
      direction: position.direction,
      lastMarkPrice: position.lastMarkPrice ?? null,
      lastMarkedAt: position.lastMarkedAt ?? null,
      ageMs,
      stale: markedAt ? isPositionMarkStale(position, now) : false,
      unmarked: !markedAt,
    };
  });
  const staleMarks = markHealthPositions.filter((position) => position.stale);
  const unmarkedPositions = markHealthPositions.filter(
    (position) => position.unmarked,
  );

  return {
    eventWindow: {
      total: input.events.length,
      firstEventAt,
      latestEventAt,
    },
    eventTypes: sortedDiagnosticCounter(eventTypes),
    tradePath: {
      candidates: input.candidates.length,
      blockedCandidates: blockedCandidates.length,
      contractsSelected: contractsSelected.length,
      shadowFilledCandidates: shadowFillCount,
      activePositions: input.activePositions.length,
      entryEvents,
      exitEvents,
      markEvents,
      gatewayBlocks,
    },
    signalFreshness: {
      total: input.signals.length,
      fresh: freshSignals,
      notFresh: Math.max(0, input.signals.length - freshSignals),
      withoutDirection: signalsWithoutDirection,
      statuses: sortedDiagnosticCounter(signalStatuses),
    },
    lifecycle: {
      signals: input.signals.length,
      freshSignals,
      candidates: input.candidates.length,
      actionMapped: actionMapped.length,
      contractsSelected: contractsSelected.length,
      liquidityAccepted: liquidityAccepted.length,
      shadowEntries: entryEvents,
      shadowFills: shadowFillCount,
      shadowMarks: markEvents,
      shadowExits: exitEvents,
      activePositions: input.activePositions.length,
      blockedCandidates: blockedCandidates.length,
    },
    skipReasons: sortedDiagnosticCounter(skipReasons),
    skipCategories: sortedDiagnosticCounter(skipCategories),
    entryGateReasons: sortedDiagnosticCounter(entryGateReasons),
    optionChainReasons: sortedDiagnosticCounter(optionChainReasons),
    readinessIncidents: Array.from(readinessIncidents.values()).sort(
      (left, right) =>
        right.count - left.count ||
        left.source.localeCompare(right.source) ||
        left.reason.localeCompare(right.reason),
    ),
    markHealth: {
      activePositions: input.activePositions.length,
      fresh: Math.max(
        0,
        input.activePositions.length -
          staleMarks.length -
          unmarkedPositions.length,
      ),
      stale: staleMarks.length,
      unmarked: unmarkedPositions.length,
      markFailures: markFailureEvents.length,
      lastMarkFailureAt: latestIso(
        markFailureEvents.map((event) => event.occurredAt),
      ),
      positions: markHealthPositions
        .sort(
          (left, right) =>
            Number(right.stale) - Number(left.stale) ||
            Number(right.unmarked) - Number(left.unmarked) ||
            (right.ageMs ?? -1) - (left.ageMs ?? -1) ||
            String(left.symbol ?? "").localeCompare(String(right.symbol ?? "")),
        )
        .slice(0, 8),
    },
  };
}

function roundMetric(value: unknown, digits = 2) {
  const parsed = finiteNumber(value);
  return parsed == null ? null : Number(parsed.toFixed(digits));
}

function averageMetric(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function profitFactorMetric(values: number[]) {
  const gains = values
    .filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(
    values
      .filter((value) => value < 0)
      .reduce((sum, value) => sum + value, 0),
  );
  if (!losses) {
    return gains > 0 ? null : 0;
  }
  return gains / losses;
}

function payloadCandidate(payload: Record<string, unknown>) {
  return asRecord(
    Object.keys(asRecord(payload.candidate)).length
      ? payload.candidate
      : payload.automationCandidate,
  );
}

function eventCandidate(event: ExecutionEvent) {
  return payloadCandidate(asRecord(event.payload));
}

function eventOrderPlan(event: ExecutionEvent) {
  const payload = asRecord(event.payload);
  const candidate = payloadCandidate(payload);
  return Object.keys(asRecord(payload.orderPlan)).length
    ? asRecord(payload.orderPlan)
    : asRecord(candidate.orderPlan);
}

function eventAction(event: ExecutionEvent) {
  const payload = asRecord(event.payload);
  const candidate = payloadCandidate(payload);
  return Object.keys(asRecord(payload.action)).length
    ? asRecord(payload.action)
    : asRecord(candidate.action);
}

function eventSelectedExpiration(event: ExecutionEvent) {
  const payload = asRecord(event.payload);
  return asRecord(payload.selectedExpiration);
}

function eventReasonValue(event: ExecutionEvent) {
  const payload = asRecord(event.payload);
  return compactString(payload.reason ?? payload.skipReason);
}

function eventBrokerSubmission(event: ExecutionEvent) {
  return eventAction(event).brokerSubmission;
}

function eventDte(event: ExecutionEvent) {
  const selectedExpiration = eventSelectedExpiration(event);
  const explicitDte = finiteNumber(selectedExpiration.dte);
  if (explicitDte != null) {
    return explicitDte;
  }

  const payload = asRecord(event.payload);
  const candidate = payloadCandidate(payload);
  const selectedContract = asRecord(
    Object.keys(asRecord(payload.selectedContract)).length
      ? payload.selectedContract
      : candidate.selectedContract,
  );
  const expirationDate = expirationDateKey(
    selectedExpiration.expirationDate ?? selectedContract.expirationDate,
  );
  const openedAt =
    toIsoString(candidate.signalAt) ??
    toIsoString(event.occurredAt) ??
    toIsoString(asRecord(payload.position).openedAt);
  if (!expirationDate || !openedAt) {
    return null;
  }
  return daysBetweenUtc(new Date(openedAt), new Date(`${expirationDate}T00:00:00.000Z`));
}

function eventEntryGateWouldPass(
  event: ExecutionEvent,
  profile: SignalOptionsExecutionProfile,
) {
  const candidate = candidateFromEvent(event);
  if (!candidate) {
    return true;
  }
  return evaluateSignalOptionsEntryGate({ candidate, profile }).ok;
}

function counterArray(counter: Record<string, number>) {
  return Object.entries(sortedDiagnosticCounter(counter)).map(
    ([reason, count]) => ({
      reason,
      label: formatEnumReason(reason),
      count,
    }),
  );
}

function signalOptionsTradeDeploymentId(value: unknown) {
  const record = asRecord(value);
  const candidate = asRecord(record.candidate);
  const position = asRecord(record.position);
  const metadata = asRecord(record.metadata);
  return (
    compactString(record.deploymentId) ??
    compactString(candidate.deploymentId) ??
    compactString(position.deploymentId) ??
    compactString(metadata.deploymentId)
  );
}

function shadowRecordDeploymentId(record: Record<string, unknown>) {
  return (
    compactString(record.deploymentId) ??
    signalOptionsTradeDeploymentId(record.entryMetadata) ??
    signalOptionsTradeDeploymentId(record.metadata) ??
    signalOptionsTradeDeploymentId(record)
  );
}

function isSignalOptionsAutomationShadowRecord(
  value: unknown,
  deploymentId: string,
) {
  const record = asRecord(value);
  const sourceType = compactString(record.sourceType);
  const strategyLabel = compactString(record.strategyLabel);
  const candidateId = compactString(record.candidateId);
  const looksLikeSignalOptions =
    strategyLabel === "Signal Options" ||
    Boolean(candidateId?.startsWith("SIGOPT-"));
  if (sourceType !== "automation" || !looksLikeSignalOptions) {
    return false;
  }

  const recordDeploymentId = shadowRecordDeploymentId(record);
  return !recordDeploymentId || recordDeploymentId === deploymentId;
}

function summarizeSignalOptionsRoundTrips(roundTrips: unknown[]) {
  const pnls = roundTrips
    .map((trade) => finiteNumber(asRecord(trade).realizedPnl))
    .filter((value): value is number => value != null);
  const winners = pnls.filter((value) => value > 0);
  const losers = pnls.filter((value) => value < 0);
  const holdMinutes = roundTrips
    .map((trade) => finiteNumber(asRecord(trade).holdDurationMinutes))
    .filter((value): value is number => value != null);
  const fees = roundTrips.map(
    (trade) => finiteNumber(asRecord(trade).fees) ?? 0,
  );
  return {
    closedTrades: roundTrips.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRatePercent: roundMetric(
      roundTrips.length ? (winners.length / roundTrips.length) * 100 : null,
      1,
    ),
    realizedPnl: roundMetric(
      pnls.reduce((sum, value) => sum + value, 0),
      2,
    ),
    fees: roundMetric(fees.reduce((sum, value) => sum + value, 0), 2),
    averageWin: roundMetric(averageMetric(winners), 2),
    averageLoss: roundMetric(averageMetric(losers), 2),
    expectancy: roundMetric(averageMetric(pnls), 2),
    profitFactor: roundMetric(profitFactorMetric(pnls), 2),
    payoffRatio: roundMetric(
      winners.length && losers.length
        ? (averageMetric(winners) ?? 0) / Math.abs(averageMetric(losers) ?? 1)
        : null,
      2,
    ),
    averageHoldMinutes: roundMetric(averageMetric(holdMinutes), 1),
  };
}

function recentSignalOptionsClosedTrades(roundTrips: unknown[]) {
  return [...roundTrips]
    .sort((left, right) => {
      const leftTime = dateOrNull(asRecord(left).closeDate)?.getTime() ?? 0;
      const rightTime = dateOrNull(asRecord(right).closeDate)?.getTime() ?? 0;
      return rightTime - leftTime;
    })
    .slice(0, 10)
    .map((trade) => {
      const record = asRecord(trade);
      const entryMetadata = asRecord(record.entryMetadata);
      const exitMetadata = asRecord(record.metadata);
      const entryCandidate = asRecord(entryMetadata.candidate);
      const exitCandidate = asRecord(exitMetadata.candidate);
      const selectedContract = asRecord(
        Object.keys(asRecord(entryMetadata.selectedContract)).length
          ? entryMetadata.selectedContract
          : exitMetadata.selectedContract,
      );
      const selectedExpiration = asRecord(
        Object.keys(asRecord(entryMetadata.selectedExpiration)).length
          ? entryMetadata.selectedExpiration
          : exitMetadata.selectedExpiration,
      );
      return {
        id: compactString(record.id),
        symbol: compactString(record.symbol),
        assetClass: compactString(record.assetClass),
        quantity: roundMetric(record.quantity, 3),
        openDate: toIsoString(record.openDate),
        closeDate: toIsoString(record.closeDate),
        avgOpen: roundMetric(record.avgOpen, 2),
        avgClose: roundMetric(record.avgClose, 2),
        realizedPnl: roundMetric(record.realizedPnl, 2),
        realizedPnlPercent: roundMetric(record.realizedPnlPercent, 1),
        fees: roundMetric(record.fees, 2),
        holdDurationMinutes: roundMetric(record.holdDurationMinutes, 1),
        candidateId: compactString(record.candidateId),
        exitReason: compactString(exitMetadata.reason),
        optionRight:
          compactString(selectedContract.right) ??
          compactString(entryCandidate.optionRight) ??
          compactString(exitCandidate.optionRight),
        expirationDate: expirationDateKey(selectedContract.expirationDate),
        dte: roundMetric(selectedExpiration.dte, 0),
        strike: roundMetric(selectedContract.strike, 2),
      };
    });
}

function buildRuleAdherence(input: {
  profile: SignalOptionsExecutionProfile;
  events: ExecutionEvent[];
  activePositions: SignalOptionsPosition[];
  risk: Record<string, unknown>;
}) {
  const entryEvents = input.events.filter(
    (event) => event.eventType === SIGNAL_OPTIONS_ENTRY_EVENT,
  );
  const skippedEvents = input.events.filter(
    (event) => event.eventType === SIGNAL_OPTIONS_SKIPPED_EVENT,
  );
  const markEvents = input.events.filter(
    (event) => event.eventType === SIGNAL_OPTIONS_MARK_EVENT,
  );
  const skipReasonCounts = skippedEvents.reduce<Record<string, number>>(
    (counter, event) => {
      incrementDiagnosticCounter(counter, eventReasonValue(event));
      return counter;
    },
    {},
  );
  const skipCount = (reason: string) => skipReasonCounts[reason] ?? 0;
  const brokerLiveSubmissions = entryEvents.filter(
    (event) => eventBrokerSubmission(event) === true,
  ).length;
  const brokerSubmissionMissing = entryEvents.filter(
    (event) => eventBrokerSubmission(event) == null,
  ).length;
  const premiumViolations = entryEvents.filter((event) => {
    const premium = finiteNumber(eventOrderPlan(event).premiumAtRisk);
    return (
      premium != null && premium > input.profile.riskCaps.maxPremiumPerEntry
    );
  }).length;
  const maxPremium = entryEvents.reduce(
    (max, event) =>
      Math.max(max, finiteNumber(eventOrderPlan(event).premiumAtRisk) ?? 0),
    0,
  );
  const contractViolations = entryEvents.filter((event) => {
    const quantity = finiteNumber(eventOrderPlan(event).quantity);
    return quantity != null && quantity > input.profile.riskCaps.maxContracts;
  }).length;
  const maxQuantity = entryEvents.reduce(
    (max, event) =>
      Math.max(max, finiteNumber(eventOrderPlan(event).quantity) ?? 0),
    0,
  );
  const minDte = input.profile.optionSelection.allowZeroDte
    ? input.profile.optionSelection.minDte
    : Math.max(1, input.profile.optionSelection.minDte);
  const maxDte = Math.max(minDte, input.profile.optionSelection.maxDte);
  const dteViolations = entryEvents.filter((event) => {
    const dte = eventDte(event);
    return dte != null && (dte < minDte || dte > maxDte);
  }).length;
  const liquidityEntryViolations = entryEvents.filter((event) => {
    const orderPlan = eventOrderPlan(event);
    const liquidity = asRecord(orderPlan.liquidity);
    return liquidity.ok === false || orderPlan.ok === false;
  }).length;
  const liquidityBlocks =
    skipCount("spread_too_wide") +
    skipCount("missing_bid_ask") +
    skipCount("bid_below_minimum") +
    skipCount("quote_not_fresh") +
    skipCount("missing_mark") +
    skipCount("liquidity_gate_failed") +
    skipCount("premium_budget_too_small");
  const bearishPutGateViolations = entryEvents.filter(
    (event) => !eventEntryGateWouldPass(event, input.profile),
  ).length;
  const openSymbols = finiteNumber(input.risk.openSymbols) ?? input.activePositions.length;
  const unmarkedPositions = input.activePositions.filter(
    (position) => finiteNumber(position.lastMarkPrice) == null,
  ).length;
  const markProblemEvents = input.events.filter((event) => {
    const reason = eventReasonValue(event);
    return (
      event.eventType === SIGNAL_OPTIONS_MARK_EVENT &&
      ["position_mark_failed", "position_mark_unavailable"].includes(
        reason ?? "",
      )
    );
  }).length;

  const rule = (inputRule: {
    id: string;
    label: string;
    status: "pass" | "warning" | "fail";
    observations?: number;
    violations?: number;
    detail: string;
  }) => ({
    observations: 0,
    violations: 0,
    ...inputRule,
  });

  return [
    rule({
      id: "shadow_only_execution",
      label: "Shadow-only execution",
      status: brokerLiveSubmissions
        ? "fail"
        : brokerSubmissionMissing
          ? "warning"
          : "pass",
      observations: entryEvents.length,
      violations: brokerLiveSubmissions,
      detail: brokerLiveSubmissions
        ? `${brokerLiveSubmissions} entries requested broker submission.`
        : brokerSubmissionMissing
          ? `${brokerSubmissionMissing} entries lacked an explicit brokerSubmission flag.`
          : "All recorded entries stayed paper/shadow only.",
    }),
    rule({
      id: "premium_cap",
      label: "Premium per entry cap",
      status: premiumViolations ? "fail" : "pass",
      observations: entryEvents.length,
      violations: premiumViolations,
      detail: `Max observed premium ${roundMetric(maxPremium, 2) ?? 0} vs cap ${input.profile.riskCaps.maxPremiumPerEntry}.`,
    }),
    rule({
      id: "contract_cap",
      label: "Contract quantity cap",
      status: contractViolations ? "fail" : "pass",
      observations: entryEvents.length,
      violations: contractViolations,
      detail: `Max observed quantity ${roundMetric(maxQuantity, 0) ?? 0} vs cap ${input.profile.riskCaps.maxContracts}.`,
    }),
    rule({
      id: "dte_window",
      label: "DTE window",
      status: dteViolations
        ? "fail"
        : skipCount("no_expiration_in_dte_window")
          ? "warning"
          : "pass",
      observations: entryEvents.length,
      violations: dteViolations,
      detail: skipCount("no_expiration_in_dte_window")
        ? `${skipCount("no_expiration_in_dte_window")} candidates had no expiration inside ${minDte}-${maxDte} DTE.`
        : `Filled entries stayed inside ${minDte}-${maxDte} DTE.`,
    }),
    rule({
      id: "liquidity_gate",
      label: "Liquidity gate",
      status: liquidityEntryViolations
        ? "fail"
        : liquidityBlocks
          ? "warning"
          : "pass",
      observations: entryEvents.length + liquidityBlocks,
      violations: liquidityEntryViolations,
      detail: liquidityBlocks
        ? `${liquidityBlocks} candidates were blocked by liquidity or quote rules.`
        : "No liquidity-gate breaches on filled entries.",
    }),
    rule({
      id: "bearish_put_gate",
      label: "Bearish put gate",
      status: bearishPutGateViolations
        ? "fail"
        : skipCount("bear_regime_gate_failed")
          ? "warning"
          : "pass",
      observations: entryEvents.length + skipCount("bear_regime_gate_failed"),
      violations: bearishPutGateViolations,
      detail: skipCount("bear_regime_gate_failed")
        ? `${skipCount("bear_regime_gate_failed")} put candidates were blocked by regime filters.`
        : "Filled put entries satisfied the configured regime filter.",
    }),
    rule({
      id: "max_open_symbols",
      label: "Open-symbol cap",
      status:
        openSymbols > input.profile.riskCaps.maxOpenSymbols
          ? "fail"
          : skipCount("max_open_symbols_reached")
            ? "warning"
            : "pass",
      observations: skippedEvents.length + input.activePositions.length,
      violations:
        openSymbols > input.profile.riskCaps.maxOpenSymbols ? 1 : 0,
      detail: skipCount("max_open_symbols_reached")
        ? `${skipCount("max_open_symbols_reached")} candidates were blocked by the open-symbol cap; current exposure is ${openSymbols}/${input.profile.riskCaps.maxOpenSymbols}.`
        : `${openSymbols}/${input.profile.riskCaps.maxOpenSymbols} open symbols.`,
    }),
    rule({
      id: "daily_loss_halt",
      label: "Daily loss halt",
      status:
        input.risk.dailyHaltActive === true ||
        skipCount("daily_loss_halt_active")
          ? "warning"
          : "pass",
      observations: skippedEvents.length,
      violations: 0,
      detail: input.risk.dailyHaltActive === true
        ? `Daily P&L ${input.risk.dailyPnl ?? 0} is at or below halt ${input.profile.riskCaps.maxDailyLoss}.`
        : skipCount("daily_loss_halt_active")
          ? `${skipCount("daily_loss_halt_active")} candidates were blocked by the daily halt.`
          : "Daily loss halt is clear.",
    }),
    rule({
      id: "position_marking",
      label: "Position marking",
      status: unmarkedPositions || markProblemEvents ? "warning" : "pass",
      observations: markEvents.length + input.activePositions.length,
      violations: markProblemEvents,
      detail: unmarkedPositions || markProblemEvents
        ? `${unmarkedPositions} open positions lack marks; ${markProblemEvents} mark events reported quote issues.`
        : "Open positions have marks for current exposure.",
    }),
  ];
}

export function buildSignalOptionsPerformanceFromInputs(input: {
  deploymentId: string;
  profile: SignalOptionsExecutionProfile;
  state: Awaited<ReturnType<typeof buildStatePayload>>;
  events: ExecutionEvent[];
  shadowPatterns: Record<string, unknown>;
}) {
  const roundTrips = Array.isArray(input.shadowPatterns.roundTrips)
    ? input.shadowPatterns.roundTrips.filter((trade) =>
        isSignalOptionsAutomationShadowRecord(trade, input.deploymentId),
      )
    : [];
  const openLots = Array.isArray(input.shadowPatterns.openLots)
    ? input.shadowPatterns.openLots.filter((lot) =>
        isSignalOptionsAutomationShadowRecord(lot, input.deploymentId),
      )
    : [];
  const blockerCounts = input.events.reduce<Record<string, number>>(
    (counter, event) => {
      if (
        event.eventType === SIGNAL_OPTIONS_SKIPPED_EVENT ||
        event.eventType === SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT
      ) {
        incrementDiagnosticCounter(
          counter,
          eventReasonValue(event) ??
            (event.eventType === SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT
              ? "gateway_blocked"
              : null),
        );
      }
      return counter;
    },
    {},
  );
  const unmarkedPositions = input.state.activePositions.filter(
    (position) => finiteNumber(position.lastMarkPrice) == null,
  ).length;

  return {
    deploymentId: input.deploymentId,
    range: compactString(asRecord(input.shadowPatterns.context).range) ?? "1M",
    summary: {
      ...summarizeSignalOptionsRoundTrips(roundTrips),
      openLots: openLots.length,
      tradeEvents: Array.isArray(input.shadowPatterns.tradeEvents)
        ? input.shadowPatterns.tradeEvents.filter((event) =>
            isSignalOptionsAutomationShadowRecord(event, input.deploymentId),
          ).length
        : null,
    },
    openExposure: {
      openPositions: input.state.activePositions.length,
      openSymbols: input.state.risk.openSymbols ?? input.state.activePositions.length,
      maxOpenSymbols: input.profile.riskCaps.maxOpenSymbols,
      atOpenSymbolCapacity:
        Number(input.state.risk.openSymbols ?? input.state.activePositions.length) >=
        input.profile.riskCaps.maxOpenSymbols,
      openPremium: input.state.risk.openPremium ?? 0,
      maxPremiumPerEntry: input.profile.riskCaps.maxPremiumPerEntry,
      openUnrealizedPnl: input.state.risk.openUnrealizedPnl ?? 0,
      dailyRealizedPnl: input.state.risk.dailyRealizedPnl ?? 0,
      dailyPnl: input.state.risk.dailyPnl ?? 0,
      maxDailyLoss: input.profile.riskCaps.maxDailyLoss,
      dailyLossRemaining:
        Math.abs(input.profile.riskCaps.maxDailyLoss) +
        Number(input.state.risk.dailyPnl ?? 0),
      dailyHaltActive: input.state.risk.dailyHaltActive === true,
      markedPositions: Math.max(
        0,
        input.state.activePositions.length - unmarkedPositions,
      ),
      unmarkedPositions,
    },
    ruleAdherence: buildRuleAdherence({
      profile: input.profile,
      events: input.events,
      activePositions: input.state.activePositions,
      risk: input.state.risk,
    }),
    topBlockers: counterArray(blockerCounts).slice(0, 10),
    recentClosedTrades: recentSignalOptionsClosedTrades(roundTrips),
    generatedAt: new Date().toISOString(),
  };
}

export async function getSignalOptionsPerformance(input: {
  deploymentId: string;
}) {
  const deployment = await getDeploymentOrThrow(input.deploymentId);
  const profile = resolveDeploymentProfile(deployment);
  const events = await listDeploymentEvents(deployment.id, 1_000);
  const state = await buildStatePayload({ deployment, profile, events });
  const shadowPatterns = await computeShadowTradingPatterns({ range: "1M" });

  return buildSignalOptionsPerformanceFromInputs({
    deploymentId: deployment.id,
    profile,
    state,
    events: signalOptionsEvents(events),
    shadowPatterns,
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
  const signals = await listSignalOptionsSignalSnapshots(input.deployment);
  const signalEvents = signalOptionsEvents(input.events);
  const shadowIndex = await buildSignalOptionsShadowIndex(signalEvents);
  const activePositions = deriveActivePositions(signalEvents);
  const candidateEvents = new Map<string, ExecutionEvent[]>();
  const candidatesById = new Map<string, SignalOptionsCandidate>();

  for (const signal of signals) {
    const candidate = candidateFromSignalSnapshot({
      deployment: input.deployment,
      signal,
    });
    if (candidate) {
      candidatesById.set(candidate.id, candidate);
    }
  }

  for (const event of [...signalEvents].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  )) {
    const candidate = candidateFromEvent(event);
    if (!candidate) {
      continue;
    }
    const existing = candidatesById.get(candidate.id);
    candidatesById.set(
      candidate.id,
      mergeSignalOptionsCandidate(existing, candidate),
    );
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
      const leftTime = dateOrNull(candidateLatestActivityAt(left))?.getTime() ?? 0;
      const rightTime = dateOrNull(candidateLatestActivityAt(right))?.getTime() ?? 0;
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
    signals,
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
  const diagnostics = buildCockpitDiagnostics({
    signals: state.signals,
    candidates: state.candidates,
    activePositions: state.activePositions,
    events,
  });
  const shadowFilledCandidateCount = state.candidates.filter((candidate) =>
    ["shadow_filled", "partial_shadow", "closed"].includes(
      String(candidate.actionStatus ?? ""),
    ),
  ).length;
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
    diagnostics,
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
      shadowFilledCandidates: Math.max(
        shadowFilledCandidateCount,
        diagnostics.tradePath.entryEvents,
      ),
      openPositions: state.activePositions.length,
    },
    risk: state.risk,
    signals: state.signals,
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

  return Promise.all(
    deployments
      .filter(deploymentHasSignalOptionsProfile)
      .map((deployment) => normalizeSignalOptionsDeploymentAccount(deployment)),
  );
}

async function refreshActivePosition(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  position: SignalOptionsPosition;
  recentEvents?: ExecutionEvent[];
}) {
  const contract = input.position.selectedContract;
  const expirationDate = dateOrNull(contract.expirationDate);
  const optionRight = contract.right === "put" ? "put" : "call";
  if (!expirationDate) {
    return;
  }

  const providerContractId =
    typeof contract.providerContractId === "string"
      ? contract.providerContractId
      : null;
  const markState: {
    quote: SignalOptionsOptionQuote | null;
    resolution: ReturnType<typeof resolvePositionMarkQuote> | null;
  } = {
    quote: null,
    resolution: null,
  };
  const markAttempts: ReturnType<typeof positionMarkAttemptPayload>[] = [];
  const useQuote = (
    source: "provider_snapshot" | "chain_standard" | "chain_full",
    candidateQuote: SignalOptionsOptionQuote | null,
    chainDebug?: unknown,
  ) => {
    const resolution = candidateQuote
      ? resolvePositionMarkQuote({ quote: candidateQuote, profile: input.profile })
      : null;
    markAttempts.push(
      positionMarkAttemptPayload({
        source,
        quote: candidateQuote,
        reason: resolution?.ok ? null : resolution?.reason,
        chainDebug,
      }),
    );
    if (candidateQuote) {
      markState.quote = candidateQuote;
      markState.resolution = resolution;
    }
    return Boolean(resolution?.ok);
  };

  if (providerContractId) {
    const snapshot = await fetchBridgeOptionQuoteSnapshots({
      underlying: input.position.symbol,
      providerContractIds: [providerContractId],
      owner: `signal-options-position-mark:${input.deployment.id}:${input.position.id}`,
      intent: "flow-scanner-live",
      ttlMs: 5_000,
      fallbackProvider: "cache",
      requiresGreeks: false,
    });
    const matchedQuote =
      snapshot.quotes.find(
        (item) => item.providerContractId?.trim() === providerContractId,
      ) ?? null;
    const snapshotQuote = matchedQuote
      ? quoteSnapshotToSignalOptionsQuote({ contract, quote: matchedQuote })
      : null;
    useQuote("provider_snapshot", snapshotQuote);
  } else {
    const chain = await getOptionChainWithDebug({
      underlying: input.position.symbol,
      expirationDate,
      contractType: optionRight,
      strikesAroundMoney: 1,
      strikeCoverage: "standard",
      quoteHydration: "snapshot",
    });
    const chainQuote =
      findSignalOptionsQuoteForContract({
        contracts: chain.contracts as SignalOptionsOptionQuote[],
        selectedContract: contract,
      }) ?? null;
    useQuote("chain_standard", chainQuote, chain.debug);
  }

  if (!markState.resolution?.ok) {
    const chain = await getOptionChainWithDebug({
      underlying: input.position.symbol,
      expirationDate,
      contractType: optionRight,
      strikeCoverage: "full",
      quoteHydration: "snapshot",
    });
    const chainQuote = findSignalOptionsQuoteForContract({
      contracts: chain.contracts as SignalOptionsOptionQuote[],
      selectedContract: contract,
    });
    useQuote("chain_full", chainQuote, chain.debug);
  }

  const emitPositionMarkSkip = async (inputSkip: {
    summary: string;
    message: string;
    quote?: SignalOptionsOptionQuote | null;
    liquidity?: unknown;
  }) => {
    const occurredAt = new Date();
    if (
      !shouldRecordPositionMarkSkip({
        events: input.recentEvents ?? [],
        position: input.position,
        reason: "position_mark_unavailable",
        now: occurredAt,
      })
    ) {
      return;
    }
    await insertSignalOptionsEvent({
      deployment: input.deployment,
      symbol: input.position.symbol,
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      summary: inputSkip.summary,
      occurredAt,
      payload: {
        reason: "position_mark_unavailable",
        message: inputSkip.message,
        retryable: true,
        position: input.position,
        selectedContract: input.position.selectedContract,
        quote: inputSkip.quote ? quoteToPayload(inputSkip.quote) : null,
        liquidity: inputSkip.liquidity ?? null,
        markResolution: {
          attempts: markAttempts,
        },
      },
    });
  };

  const quote = markState.quote;
  const markResolution = markState.resolution;
  if (!quote) {
    await emitPositionMarkSkip({
      summary: `${input.position.symbol} shadow mark skipped: option quote unavailable`,
      message: "No option quote was returned for the open shadow position.",
    });
    return;
  }

  if (!markResolution?.ok || markResolution.markPrice == null) {
    await emitPositionMarkSkip({
      summary: `${input.position.symbol} shadow mark skipped: option mark unavailable`,
      message:
        markResolution?.reason === "quote_not_fresh"
          ? "The option quote was stale or unavailable for the open shadow position."
          : "The option quote did not include a positive mark price.",
      quote,
      liquidity: markResolution?.liquidity ?? null,
    });
    return;
  }

  const liquidity = markResolution.liquidity;
  const markPrice = markResolution.markPrice;
  const markSource = markAttempts.find((attempt) => attempt.ok)?.source ?? null;
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
  const markAt = new Date();
  const positionPatch = {
    ...input.position,
    peakPrice,
    stopPrice: stop.stopPrice,
    lastMarkPrice: Number(markPrice.toFixed(2)),
    lastMarkedAt: markAt.toISOString(),
  };

  if (stop.exitReason) {
    await insertSignalOptionsEvent({
      deployment: input.deployment,
      symbol: input.position.symbol,
      eventType: SIGNAL_OPTIONS_EXIT_EVENT,
      summary: `${input.position.symbol} shadow exit ${stop.exitReason} at ${exitPrice.toFixed(2)}`,
      occurredAt: markAt,
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
        markResolution: {
          source: markSource,
          attempts: markAttempts,
        },
        stop,
      },
    });
    return;
  }

  if (
    shouldRecordActivePositionMarkForScan({
      position: input.position,
      markAt,
    })
  ) {
    await insertSignalOptionsEvent({
      deployment: input.deployment,
      symbol: input.position.symbol,
      eventType: SIGNAL_OPTIONS_MARK_EVENT,
      summary: `${input.position.symbol} shadow mark ${markPrice.toFixed(2)} stop ${stop.stopPrice.toFixed(2)}`,
      occurredAt: markAt,
      payload: {
        position: positionPatch,
        selectedContract: input.position.selectedContract,
        quote: quoteToPayload(quote),
        liquidity,
        markResolution: {
          source: markSource,
          attempts: markAttempts,
        },
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
      signal: input.candidate.signal ?? null,
      action: input.candidate.action ?? null,
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
  const entryGate = evaluateSignalOptionsEntryGate({
    candidate: input.candidate,
    profile: input.profile,
  });
  if (!entryGate.ok) {
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason: entryGate.reason ?? "entry_gate_failed",
      detail: { entryGate },
    });
    return false;
  }

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

  const strikesAroundMoney = signalOptionsStrikesAroundMoney({
    profile: input.profile,
    optionRight: input.candidate.optionRight,
  });
  let chain = await getOptionChainWithDebug({
    underlying: input.candidate.symbol,
    expirationDate: selectedExpiration.expirationDate,
    contractType: input.candidate.optionRight,
    strikesAroundMoney,
    strikeCoverage: "standard",
    quoteHydration: "snapshot",
  });
  let contractSelection = selectSignalOptionsContractPlanFromChain({
    contracts: chain.contracts as SignalOptionsOptionQuote[],
    direction: input.candidate.direction,
    signalPrice: input.candidate.signalPrice,
    profile: input.profile,
  });
  const chainAttempts: Array<{
    source: "bounded" | "full";
    strikeCoverage: "standard" | "full";
    strikesAroundMoney: number | null;
    contractCount: number;
    selectedQuote: boolean;
    chainDebug: unknown;
  }> = [
    {
      source: "bounded",
      strikeCoverage: "standard",
      strikesAroundMoney,
      contractCount: chain.contracts.length,
      selectedQuote: Boolean(contractSelection.selectedQuote),
      chainDebug: chain.debug,
    },
  ];
  if (!contractSelection.selectedQuote) {
    const fullChain = await getOptionChainWithDebug({
      underlying: input.candidate.symbol,
      expirationDate: selectedExpiration.expirationDate,
      contractType: input.candidate.optionRight,
      strikeCoverage: "full",
      quoteHydration: "snapshot",
    });
    const fullSelection = selectSignalOptionsContractPlanFromChain({
      contracts: fullChain.contracts as SignalOptionsOptionQuote[],
      direction: input.candidate.direction,
      signalPrice: input.candidate.signalPrice,
      profile: input.profile,
    });
    chainAttempts.push({
      source: "full",
      strikeCoverage: "full",
      strikesAroundMoney: null,
      contractCount: fullChain.contracts.length,
      selectedQuote: Boolean(fullSelection.selectedQuote),
      chainDebug: fullChain.debug,
    });
    if (fullSelection.selectedQuote) {
      chain = fullChain;
      contractSelection = fullSelection;
    }
  }
  const selectedQuote = contractSelection.selectedQuote;
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
        chainAttempts,
        retryable: true,
        contractSelection: signalOptionsContractSelectionPayload(contractSelection),
      },
    });
    return false;
  }

  const orderPlan = contractSelection.orderPlan;
  const selectedContract = contractToPayload(selectedQuote);
  const quote = quoteToPayload(selectedQuote);
  if (!orderPlan?.ok) {
    const reason = String(orderPlan?.reason || "liquidity_gate_failed");
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason,
      detail: {
        selectedContract,
        quote,
        liquidity: orderPlan?.liquidity ?? null,
        premiumCap: input.profile.riskCaps.maxPremiumPerEntry,
        retryable:
          reason === "missing_bid_ask" ||
          reason === "missing_mark" ||
          reason === "quote_not_fresh" ||
          reason === "spread_too_wide",
        contractSelection: signalOptionsContractSelectionPayload(contractSelection),
        selectedExpiration: {
          expirationDate: selectedExpiration.expirationDate.toISOString(),
          dte: selectedExpiration.dte,
        },
        chainDebug: chain.debug,
        chainAttempts,
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
      signal: input.candidate.signal ?? null,
      action: input.candidate.action ?? null,
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
      contractSelection: signalOptionsContractSelectionPayload(contractSelection),
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
      signal: input.candidate.signal ?? null,
      action: input.candidate.action ?? null,
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
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const existing = (await listDeploymentEvents(input.deployment.id, 50)).find(
    (event) => {
      if (
        event.eventType !== SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT ||
        event.occurredAt.toISOString().slice(0, 10) !== todayKey
      ) {
        return false;
      }
      const payload = asRecord(event.payload);
      return (
        payload.reason === input.readiness.reason &&
        payload.source === input.source
      );
    },
  );
  if (existing) {
    const payload = asRecord(existing.payload);
    const count = signalOptionsDiagnosticEventWeight(existing) + 1;
    const nextPayload = signalOptionsPayloadWithRunMetadata({
      deployment: input.deployment,
      payload: {
        ...payload,
        source: input.source,
        reason: input.readiness.reason,
        readiness: input.readiness,
        count,
        firstSeenAt:
          toIsoString(payload.firstSeenAt) ?? existing.occurredAt.toISOString(),
        lastSeenAt: now.toISOString(),
      },
    });
    await db
      .update(executionEventsTable)
      .set({
        summary: `Signal-options scan blocked: ${input.readiness.message}`,
        payload: nextPayload,
        occurredAt: now,
        updatedAt: now,
      })
      .where(eq(executionEventsTable.id, existing.id));
    return;
  }

  await insertSignalOptionsEvent({
    deployment: input.deployment,
    eventType: SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT,
    summary: `Signal-options scan blocked: ${input.readiness.message}`,
    payload: {
      source: input.source,
      reason: input.readiness.reason,
      readiness: input.readiness,
      count: 1,
      firstSeenAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
    },
    occurredAt: now,
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

type SignalOptionsBackfillSession = "regular" | "all";

type SignalOptionsBackfillWindow = {
  startDate: string;
  endDate: string;
  session: SignalOptionsBackfillSession;
  from: Date;
  to: Date;
  warmupFrom: Date;
};

type SignalOptionsBackfillEventWrite = {
  inserted: boolean;
  existing: boolean;
  event: ExecutionEvent | null;
};

type SignalOptionsHistoricalEventSource =
  | "signal_options_backfill"
  | "signal_options_replay";

type SignalOptionsReplayMetadata = {
  runId: string;
  marketDate: string;
  deploymentId: string;
  deploymentName: string;
};

type SignalOptionsBackfillSummary = {
  symbolsEvaluated: number;
  symbolUniverse: SignalOptionsBackfillUniverse;
  signalsEvaluated: number;
  entriesOpened: number;
  exitsClosed: number;
  marksRecorded: number;
  candidatesSkipped: number;
  existingEvents: number;
  mirrorRepairsAttempted: number;
  missingOptionBars: number;
  realizedPnl: number;
  winningTrades: number;
  losingTrades: number;
  exitReasons: Record<string, number>;
  skippedReasons: Record<string, number>;
  closedTrades: Array<{
    candidateId: string;
    symbol: string;
    direction: SignalDirection;
    optionRight: OptionRight;
    openedAt: string;
    closedAt: string;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    pnl: number;
    reason: string;
    selectedContract: Record<string, unknown>;
  }>;
  errors: Array<{ symbol?: string | null; message: string }>;
};

type SignalOptionsBackfillUniverse = {
  source: "signal_monitor_watchlist" | "deployment";
  symbols: string[];
  watchlistId: string | null;
  skippedSymbols: string[];
  truncated: boolean;
};

type HistoricalBackfillSignal = {
  symbol: string;
  signal: RayReplicaSignalEvent;
  signalAt: Date;
  direction: SignalDirection;
  signalPrice: number | null;
};

type HistoricalBackfillResolvedOption = {
  selectedContract: Record<string, unknown>;
  optionBars: BrokerBarSnapshot[];
  optionTrades: OptionTradePrint[];
  entryBar: BrokerBarSnapshot;
  quote: Record<string, unknown>;
  liquidity: Record<string, unknown>;
  orderPlan: Record<string, unknown>;
  selectedExpiration: { expirationDate: Date; dte: number };
};

type HistoricalBackfillOpenPosition = SignalOptionsPosition & {
  optionBars: BrokerBarSnapshot[];
  optionTrades: OptionTradePrint[];
  nextBarIndex: number;
};

const DEFAULT_SIGNAL_OPTIONS_BACKFILL_START = "2026-04-01";
const SIGNAL_OPTIONS_BACKFILL_SOURCE = "signal_options_backfill";
const SIGNAL_OPTIONS_BACKFILL_VERSION = 1;
const SIGNAL_OPTIONS_OPTION_MARK_TIMEFRAME = "1m";
const BACKFILL_WARMUP_DAYS = 90;
const BACKFILL_OPTION_BAR_LIMIT = 5_000;
const BACKFILL_OPTION_TRADE_LIMIT = 50_000;
const HISTORICAL_OPTION_TRADE_FILL_MAX_DELAY_MS = 60_000;
const BACKFILL_EQUITY_BAR_LIMIT = Math.max(
  1_500,
  RAY_REPLICA_SIGNAL_WARMUP_BARS + 500,
);
const MARKET_TIME_ZONE = "America/New_York";
const MARKET_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parseBackfillDate(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, "Invalid backfill date.", {
      code: "invalid_signal_options_backfill_date",
      detail: "Use YYYY-MM-DD dates.",
      expose: true,
    });
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new HttpError(400, "Invalid backfill date.", {
      code: "invalid_signal_options_backfill_date",
      detail: "Use a real calendar date in YYYY-MM-DD format.",
      expose: true,
    });
  }
  return raw;
}

function addDaysToBackfillDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function backfillDateWeekday(value: string) {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay();
}

function previousBackfillWeekdayOrSame(value: string) {
  let cursor = value;
  while (backfillDateWeekday(cursor) === 0 || backfillDateWeekday(cursor) === 6) {
    cursor = addDaysToBackfillDate(cursor, -1);
  }
  return cursor;
}

function latestCompletedBackfillMarketDate(now = new Date()) {
  const parts = marketParts(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = parts.weekday;
  if (weekday === "Sat" || weekday === "Sun") {
    return previousBackfillWeekdayOrSame(today);
  }
  const minutes =
    Number.parseInt(parts.hour ?? "0", 10) * 60 +
    Number.parseInt(parts.minute ?? "0", 10);
  if (minutes >= 16 * 60) {
    return today;
  }
  return previousBackfillWeekdayOrSame(addDaysToBackfillDate(today, -1));
}

function resolveSignalOptionsBackfillWindow(input: {
  start?: unknown;
  end?: unknown;
  session?: unknown;
  now?: Date;
}): SignalOptionsBackfillWindow {
  const startDate = parseBackfillDate(
    input.start,
    DEFAULT_SIGNAL_OPTIONS_BACKFILL_START,
  );
  const endDate = parseBackfillDate(
    input.end,
    latestCompletedBackfillMarketDate(input.now),
  );
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (start.getTime() > end.getTime()) {
    throw new HttpError(400, "Invalid backfill date range.", {
      code: "invalid_signal_options_backfill_range",
      detail: "start must be on or before end.",
      expose: true,
    });
  }
  const session: SignalOptionsBackfillSession =
    input.session === "all" ? "all" : "regular";
  return {
    startDate,
    endDate,
    session,
    from: start,
    to: new Date(end.getTime() + 24 * 60 * 60_000 - 1),
    warmupFrom: new Date(start.getTime() - BACKFILL_WARMUP_DAYS * 86_400_000),
  };
}

function marketParts(value: Date): Record<string, string> {
  return Object.fromEntries(
    MARKET_PARTS_FORMATTER.formatToParts(value).map((part) => [
      part.type,
      part.value,
    ]),
  );
}

function marketDateKeyFromDate(value: Date): string {
  const parts = marketParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isRegularMarketSession(value: Date): boolean {
  const parts = marketParts(value);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }
  const minutes =
    Number.parseInt(parts.hour ?? "0", 10) * 60 +
    Number.parseInt(parts.minute ?? "0", 10);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function isWithinBackfillWindow(value: Date, window: SignalOptionsBackfillWindow) {
  if (value.getTime() < window.from.getTime() || value.getTime() > window.to.getTime()) {
    return false;
  }
  return window.session === "all" || isRegularMarketSession(value);
}

function brokerBarsToRayReplicaBars(
  bars: BrokerBarSnapshot[],
): RayReplicaBar[] {
  return bars
    .map((bar): RayReplicaBar | null => {
      const timestamp = dateOrNull(bar.timestamp);
      if (!timestamp) {
        return null;
      }
      const open = finiteNumber(bar.open);
      const high = finiteNumber(bar.high);
      const low = finiteNumber(bar.low);
      const close = finiteNumber(bar.close);
      const volume = finiteNumber(bar.volume) ?? 0;
      if (open == null || high == null || low == null || close == null) {
        return null;
      }
      return {
        time: Math.floor(timestamp.getTime() / 1000),
        ts: timestamp.toISOString(),
        o: open,
        h: high,
        l: low,
        c: close,
        v: volume,
      };
    })
    .filter((bar): bar is RayReplicaBar => Boolean(bar))
    .sort((left, right) => left.time - right.time);
}

function signalDirection(signal: RayReplicaSignalEvent): SignalDirection {
  return signal.eventType === "sell_signal" ? "sell" : "buy";
}

function signalPrice(signal: RayReplicaSignalEvent): number | null {
  return finiteNumber(signal.price) ?? finiteNumber(signal.close);
}

function backfillEventKey(
  parts: Array<string | number | null | undefined>,
  source: SignalOptionsHistoricalEventSource = SIGNAL_OPTIONS_BACKFILL_SOURCE,
) {
  return [
    source,
    SIGNAL_OPTIONS_BACKFILL_VERSION,
    ...parts.map((part) => String(part ?? "")),
  ].join(":");
}

function buildBackfillEventIndexes(events: ExecutionEvent[]) {
  const byKey = new Map<string, ExecutionEvent>();
  signalOptionsEvents(events).forEach((event) => {
    const key = compactString(asRecord(event.payload).backfillEventKey);
    if (key) {
      byKey.set(key, event);
    }
  });
  return byKey;
}

function candidateIdFromHistoricalPayload(payload: Record<string, unknown>) {
  const candidate = asRecord(payload.candidate);
  const position = asRecord(payload.position);
  return (
    compactString(position.candidateId) ??
    compactString(candidate.id) ??
    compactString(payload.candidateId)
  );
}

function replayPositionMarketDate(input: {
  payload: Record<string, unknown>;
  occurredAt?: Date | null;
  fallbackMarketDate: string;
}) {
  const candidate = asRecord(input.payload.candidate);
  const position = asRecord(input.payload.position);
  const positionAt =
    dateOrNull(position.openedAt) ??
    dateOrNull(position.signalAt) ??
    dateOrNull(candidate.signalAt) ??
    input.occurredAt ??
    null;
  return positionAt ? marketDateKeyFromDate(positionAt) : input.fallbackMarketDate;
}

function replayEventMarketDate(input: {
  occurredAt?: Date | null;
  fallbackMarketDate: string;
}) {
  return input.occurredAt
    ? marketDateKeyFromDate(input.occurredAt)
    : input.fallbackMarketDate;
}

function replayPositionKey(input: {
  replay: SignalOptionsReplayMetadata;
  payload: Record<string, unknown>;
  occurredAt?: Date | null;
}) {
  const candidateId = candidateIdFromHistoricalPayload(input.payload);
  const marketDate = replayPositionMarketDate({
    payload: input.payload,
    occurredAt: input.occurredAt,
    fallbackMarketDate: input.replay.marketDate,
  });
  return candidateId
    ? [
        SIGNAL_OPTIONS_REPLAY_SOURCE,
        marketDate,
        input.replay.deploymentId,
        candidateId,
      ].join(":")
    : null;
}

function historicalEventPayload(input: {
  source: SignalOptionsHistoricalEventSource;
  deployment: AlgoDeployment;
  payload: Record<string, unknown>;
  backfillEventKey: string;
  replay?: SignalOptionsReplayMetadata | null;
  occurredAt?: Date | null;
}) {
  const metadata = asRecord(input.payload.metadata);
  const replayMarketDate = input.replay
    ? replayEventMarketDate({
        occurredAt: input.occurredAt,
        fallbackMarketDate: input.replay.marketDate,
      })
    : null;
  const positionMarketDate = input.replay
    ? replayPositionMarketDate({
        payload: input.payload,
        occurredAt: input.occurredAt,
        fallbackMarketDate: input.replay.marketDate,
      })
    : null;
  const replayPosition = input.replay
    ? replayPositionKey({
        replay: input.replay,
        payload: input.payload,
        occurredAt: input.occurredAt,
      })
    : null;
  return {
    ...input.payload,
    metadata: {
      ...metadata,
      ...(input.replay
        ? {
            sourceType: SIGNAL_OPTIONS_REPLAY_SOURCE,
            strategyLabel: "Options Backtest",
            runId: input.replay.runId,
            marketDate: replayMarketDate,
            positionMarketDate,
            deploymentId: input.replay.deploymentId,
            deploymentName: input.replay.deploymentName,
            positionKey: replayPosition,
          }
        : {}),
    },
    backfillEventKey: input.backfillEventKey,
    backfill: {
      source: input.source,
      version: SIGNAL_OPTIONS_BACKFILL_VERSION,
    },
    ...(input.replay
      ? {
          replay: {
            source: SIGNAL_OPTIONS_REPLAY_SOURCE,
            runId: input.replay.runId,
            marketDate: replayMarketDate,
            deploymentId: input.replay.deploymentId,
            deploymentName: input.replay.deploymentName,
          },
        }
      : {}),
  };
}

async function insertSignalOptionsBackfillEvent(input: {
  deployment: AlgoDeployment;
  symbol?: string | null;
  eventType: string;
  summary: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  backfillEventKey: string;
  source?: SignalOptionsHistoricalEventSource;
  replay?: SignalOptionsReplayMetadata | null;
  existingBackfillEvents: Map<string, ExecutionEvent>;
  commit: boolean;
  summaryCounters: SignalOptionsBackfillSummary;
}): Promise<SignalOptionsBackfillEventWrite> {
  const source = input.source ?? SIGNAL_OPTIONS_BACKFILL_SOURCE;
  const existing = input.existingBackfillEvents.get(input.backfillEventKey);
  if (existing) {
    input.summaryCounters.existingEvents += 1;
    if (
      input.commit &&
      (existing.eventType === SIGNAL_OPTIONS_ENTRY_EVENT ||
        existing.eventType === SIGNAL_OPTIONS_EXIT_EVENT)
    ) {
      input.summaryCounters.mirrorRepairsAttempted += 1;
      await recordShadowAutomationEvent(existing, {
        source:
          input.replay || source === SIGNAL_OPTIONS_REPLAY_SOURCE
            ? SIGNAL_OPTIONS_REPLAY_SOURCE
            : "automation",
        markSource:
          input.replay || source === SIGNAL_OPTIONS_REPLAY_SOURCE
            ? SIGNAL_OPTIONS_REPLAY_MARK_SOURCE
            : undefined,
      }).catch((error) => {
        logger.warn?.(
          { err: error, eventId: existing.id, backfillEventKey: input.backfillEventKey },
          "Failed to repair existing signal-options backfill shadow mirror",
        );
      });
    }
    return { inserted: false, existing: true, event: existing };
  }

  if (!input.commit) {
    return { inserted: false, existing: false, event: null };
  }

  const event = await insertSignalOptionsEvent({
    deployment: input.deployment,
    symbol: input.symbol,
    eventType: input.eventType,
    summary: input.summary,
    occurredAt: input.occurredAt,
    ledgerSource:
      input.replay || source === SIGNAL_OPTIONS_REPLAY_SOURCE
        ? SIGNAL_OPTIONS_REPLAY_SOURCE
        : undefined,
    ledgerMarkSource:
      input.replay || source === SIGNAL_OPTIONS_REPLAY_SOURCE
        ? SIGNAL_OPTIONS_REPLAY_MARK_SOURCE
        : undefined,
    payload: historicalEventPayload({
      source,
      deployment: input.deployment,
      payload: input.payload,
      backfillEventKey: input.backfillEventKey,
      replay: input.replay,
      occurredAt: input.occurredAt,
    }),
  });
  input.existingBackfillEvents.set(input.backfillEventKey, event);
  return { inserted: true, existing: false, event };
}

function selectHistoricalExpirationCandidates(
  signalAt: Date,
  profile: SignalOptionsExecutionProfile,
) {
  const minDte = profile.optionSelection.allowZeroDte
    ? profile.optionSelection.minDte
    : Math.max(1, profile.optionSelection.minDte);
  const maxDte = Math.max(minDte, profile.optionSelection.maxDte);
  const targetDte = Math.min(
    maxDte,
    Math.max(minDte, profile.optionSelection.targetDte),
  );
  const signalDate = new Date(
    Date.UTC(
      signalAt.getUTCFullYear(),
      signalAt.getUTCMonth(),
      signalAt.getUTCDate(),
    ),
  );

  return Array.from({ length: maxDte - minDte + 1 }, (_, index) => {
    const dte = minDte + index;
    const expirationDate = new Date(signalDate.getTime() + dte * 86_400_000);
    return { expirationDate, dte };
  })
    .filter(({ expirationDate }) => {
      const day = expirationDate.getUTCDay();
      return day !== 0 && day !== 6;
    })
    .sort((left, right) => {
      const targetDelta =
        Math.abs(left.dte - targetDte) - Math.abs(right.dte - targetDte);
      return targetDelta || left.dte - right.dte;
    });
}

function roundStrike(value: number): number {
  return Number(value.toFixed(3));
}

function historicalStrikeForSlot(input: {
  signalPrice: number;
  direction: SignalDirection;
  profile: SignalOptionsExecutionProfile;
}) {
  const step = 1;
  const below = Math.floor(input.signalPrice / step) * step;
  const above = Math.ceil(input.signalPrice / step) * step;
  const slot =
    optionRightForSignal(input.direction) === "put"
      ? input.profile.optionSelection.putStrikeSlot
      : input.profile.optionSelection.callStrikeSlot;
  const target =
    slot === 0
      ? below - 2 * step
      : slot === 1
        ? below - step
        : slot === 2
          ? below
          : slot === 3
            ? above
            : slot === 4
              ? above + step
              : above + 2 * step;
  return roundStrike(target);
}

function selectHistoricalStrikeCandidates(input: {
  signalPrice: number | null;
  direction: SignalDirection;
  profile: SignalOptionsExecutionProfile;
}) {
  if (input.signalPrice == null || input.signalPrice <= 0) {
    return [];
  }
  const primary = historicalStrikeForSlot({
    signalPrice: input.signalPrice,
    direction: input.direction,
    profile: input.profile,
  });
  const offsets = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5];
  return Array.from(
    new Set(
      offsets
        .map((offset) => roundStrike(primary + offset))
        .filter((strike) => strike > 0),
    ),
  );
}

function buildHistoricalPolygonOptionTicker(input: {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: OptionRight;
}) {
  const underlying = normalizeSymbol(input.underlying)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!underlying || !Number.isFinite(input.strike) || input.strike <= 0) {
    return null;
  }
  const yy = String(input.expirationDate.getUTCFullYear()).slice(-2);
  const mm = String(input.expirationDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(input.expirationDate.getUTCDate()).padStart(2, "0");
  const side = input.right === "put" ? "P" : "C";
  const strike = String(Math.round(input.strike * 1000)).padStart(8, "0");
  return `O:${underlying}${yy}${mm}${dd}${side}${strike}`;
}

function backfillBarPrice(bar: BrokerBarSnapshot): number | null {
  return finiteNumber(bar.close);
}

function optionTradeSnapshot(trade: OptionTradePrint | null) {
  return trade
    ? {
        price: trade.price,
        size: trade.size,
        occurredAt: trade.occurredAt.toISOString(),
        sequenceNumber: trade.sequenceNumber,
        conditionCodes: trade.conditionCodes,
        exchange: trade.exchange,
      }
    : null;
}

function selectHistoricalOptionTradeFill(input: {
  trades: OptionTradePrint[];
  at: Date;
  maxDelayMs?: number;
}) {
  const maxDelayMs =
    input.maxDelayMs ?? HISTORICAL_OPTION_TRADE_FILL_MAX_DELAY_MS;
  return (
    input.trades.find((trade) => {
      const delayMs = trade.occurredAt.getTime() - input.at.getTime();
      return delayMs >= 0 && delayMs <= maxDelayMs;
    }) ?? null
  );
}

function quoteFromHistoricalBar(bar: BrokerBarSnapshot) {
  const price = backfillBarPrice(bar);
  return {
    bid: null,
    ask: null,
    last: price,
    mark: price,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    openInterest: null,
    volume: finiteNumber(bar.volume),
    quoteFreshness: "historical_option_bars",
    marketDataMode: bar.marketDataMode ?? null,
    quoteUpdatedAt: toIsoString(bar.timestamp),
    dataUpdatedAt: toIsoString(bar.dataUpdatedAt) ?? toIsoString(bar.timestamp),
    updatedAt: toIsoString(bar.timestamp),
    ageMs: null,
  };
}

function buildHistoricalOrderPlan(
  fillPrice: number,
  profile: SignalOptionsExecutionProfile,
  fill?: {
    source: "polygon-option-trade" | "polygon-option-aggregates";
    trade?: OptionTradePrint | null;
    markPrice?: number | null;
  },
) {
  const simulatedFillPrice = Number(fillPrice.toFixed(2));
  const quantity = Math.min(
    profile.riskCaps.maxContracts,
    Math.floor(profile.riskCaps.maxPremiumPerEntry / (simulatedFillPrice * 100)),
  );
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      ok: false,
      reason: "premium_budget_too_small",
      liquidity: {
        ok: true,
        reasons: [],
        mid: simulatedFillPrice,
        quoteFreshness: "historical_option_bars",
      },
    };
  }
  return {
    ok: true,
    entryLimitPrice: simulatedFillPrice,
    simulatedFillPrice,
    quantity,
    premiumAtRisk: Number((simulatedFillPrice * 100 * quantity).toFixed(2)),
    fillPolicy: profile.fillPolicy,
    liquidity: {
      ok: true,
      reasons: [],
      bid: null,
      ask: null,
      mid: simulatedFillPrice,
      spread: null,
      spreadPctOfMid: null,
      quoteFreshness:
        fill?.source === "polygon-option-trade"
          ? "historical_option_trades"
          : "historical_option_bars",
      marketDataMode: "historical",
      trade: optionTradeSnapshot(fill?.trade ?? null),
      markPrice: fill?.markPrice ?? null,
    },
    historicalPricing: true,
    historicalFill: {
      source: fill?.source ?? "polygon-option-aggregates",
      trade: optionTradeSnapshot(fill?.trade ?? null),
      markPrice: fill?.markPrice ?? null,
      maxDelayMs: HISTORICAL_OPTION_TRADE_FILL_MAX_DELAY_MS,
    },
  };
}

async function resolveHistoricalOptionForBackfill(input: {
  candidate: SignalOptionsCandidate;
  profile: SignalOptionsExecutionProfile;
  window: SignalOptionsBackfillWindow;
}): Promise<HistoricalBackfillResolvedOption | null> {
  const signalAt = dateOrNull(input.candidate.signalAt);
  if (!signalAt) {
    return null;
  }
  const expirations = selectHistoricalExpirationCandidates(signalAt, input.profile);
  const strikes = selectHistoricalStrikeCandidates({
    signalPrice: input.candidate.signalPrice,
    direction: input.candidate.direction,
    profile: input.profile,
  });
  for (const selectedExpiration of expirations) {
    for (const strike of strikes) {
      const optionTicker = buildHistoricalPolygonOptionTicker({
        underlying: input.candidate.symbol,
        expirationDate: selectedExpiration.expirationDate,
        strike,
        right: input.candidate.optionRight,
      });
      if (!optionTicker) {
        continue;
      }
      const result = await getOptionChartBarsWithDebug({
        underlying: input.candidate.symbol,
        expirationDate: selectedExpiration.expirationDate,
        strike,
        right: input.candidate.optionRight,
        optionTicker,
        skipBrokerContractResolution: true,
        timeframe: SIGNAL_OPTIONS_OPTION_MARK_TIMEFRAME,
        from: new Date(Math.max(input.window.from.getTime(), signalAt.getTime() - 15 * 60_000)),
        to: input.window.to,
        limit: BACKFILL_OPTION_BAR_LIMIT,
        outsideRth: false,
      });
      const optionBars = result.bars
        .filter((bar) => {
          const timestamp = dateOrNull(bar.timestamp);
          const price = backfillBarPrice(bar);
          return Boolean(
            timestamp &&
              price != null &&
              price > 0 &&
              isWithinBackfillWindow(timestamp, input.window),
          );
        })
        .sort((left, right) => {
          const leftTime = dateOrNull(left.timestamp)?.getTime() ?? 0;
          const rightTime = dateOrNull(right.timestamp)?.getTime() ?? 0;
          return leftTime - rightTime;
        });
      const entryBar =
        optionBars.find((bar) => {
          const timestamp = dateOrNull(bar.timestamp);
          return Boolean(timestamp && timestamp.getTime() >= signalAt.getTime());
        }) ?? null;
      const fillPrice = entryBar ? backfillBarPrice(entryBar) : null;
      if (!entryBar || fillPrice == null || fillPrice <= 0) {
        continue;
      }
      const optionTrades = await getHistoricalOptionTrades({
        optionTicker,
        from: signalAt,
        to: input.window.to,
        limit: BACKFILL_OPTION_TRADE_LIMIT,
      }).catch(() => [] as OptionTradePrint[]);
      const entryTrade = selectHistoricalOptionTradeFill({
        trades: optionTrades,
        at: signalAt,
      });
      const entryFillPrice = entryTrade?.price ?? fillPrice;
      const orderPlan = buildHistoricalOrderPlan(entryFillPrice, input.profile, {
        source: entryTrade ? "polygon-option-trade" : "polygon-option-aggregates",
        trade: entryTrade,
        markPrice: fillPrice,
      });
      if (!orderPlan.ok) {
        continue;
      }
      const selectedContract = {
        ticker: optionTicker,
        underlying: input.candidate.symbol,
        expirationDate: selectedExpiration.expirationDate.toISOString().slice(0, 10),
        strike,
        right: input.candidate.optionRight,
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: result.providerContractId ?? optionTicker,
      };
      return {
        selectedContract,
        optionBars,
        optionTrades,
        entryBar,
        quote: quoteFromHistoricalBar(entryBar),
        liquidity: asRecord(orderPlan.liquidity),
        orderPlan,
        selectedExpiration,
      };
    }
  }
  return null;
}

async function emitBackfillSkippedCandidate(input: {
  deployment: AlgoDeployment;
  candidate: SignalOptionsCandidate;
  signalKey: string;
  reason: string;
  detail?: Record<string, unknown>;
  occurredAt: Date;
  existingBackfillEvents: Map<string, ExecutionEvent>;
  commit: boolean;
  summary: SignalOptionsBackfillSummary;
  eventSource?: SignalOptionsHistoricalEventSource;
  replay?: SignalOptionsReplayMetadata | null;
}) {
  const eventSource = input.eventSource ?? SIGNAL_OPTIONS_BACKFILL_SOURCE;
  const write = await insertSignalOptionsBackfillEvent({
    deployment: input.deployment,
    symbol: input.candidate.symbol,
    eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
    summary: `${input.candidate.symbol} shadow backfill candidate skipped: ${input.reason}`,
    occurredAt: input.occurredAt,
    backfillEventKey: backfillEventKey([
      input.deployment.id,
      input.signalKey,
      "skip",
      input.reason,
    ], eventSource),
    source: eventSource,
    replay: input.replay,
    existingBackfillEvents: input.existingBackfillEvents,
    commit: input.commit,
    summaryCounters: input.summary,
    payload: {
      signalKey: input.signalKey,
      signal: input.candidate.signal ?? null,
      action: input.candidate.action ?? null,
      candidate: {
        ...input.candidate,
        status: "skipped",
      },
      reason: input.reason,
      ...(input.detail ?? {}),
    },
  });
  if (!write.existing) {
    input.summary.candidatesSkipped += 1;
    input.summary.skippedReasons[input.reason] =
      (input.summary.skippedReasons[input.reason] ?? 0) + 1;
  }
}

function buildBackfillPosition(input: {
  deployment: AlgoDeployment;
  candidate: SignalOptionsCandidate;
  selectedContract: Record<string, unknown>;
  orderPlan: Record<string, unknown>;
  entryAt: Date;
  optionBars: BrokerBarSnapshot[];
  optionTrades: OptionTradePrint[];
  nextBarIndex: number;
  profile: SignalOptionsExecutionProfile;
}): HistoricalBackfillOpenPosition | null {
  const entryPrice = finiteNumber(input.orderPlan.simulatedFillPrice);
  const quantity = finiteNumber(input.orderPlan.quantity);
  const premiumAtRisk = finiteNumber(input.orderPlan.premiumAtRisk);
  if (entryPrice == null || quantity == null || premiumAtRisk == null) {
    return null;
  }
  return {
    id: `${input.deployment.id}:${input.candidate.symbol}`,
    candidateId: input.candidate.id,
    symbol: input.candidate.symbol,
    direction: input.candidate.direction,
    optionRight: input.candidate.optionRight,
    timeframe: input.candidate.timeframe,
    signalAt: input.candidate.signalAt,
    openedAt: input.entryAt.toISOString(),
    entryPrice,
    quantity,
    peakPrice: entryPrice,
    stopPrice: buildInitialStopPrice(entryPrice, input.profile),
    premiumAtRisk,
    selectedContract: input.selectedContract,
    lastMarkPrice: entryPrice,
    lastMarkedAt: input.entryAt.toISOString(),
    optionBars: input.optionBars,
    optionTrades: input.optionTrades,
    nextBarIndex: input.nextBarIndex,
  };
}

function backfillPositionPayload(
  position: HistoricalBackfillOpenPosition,
): SignalOptionsPosition {
  return {
    id: position.id,
    candidateId: position.candidateId,
    symbol: position.symbol,
    direction: position.direction,
    optionRight: position.optionRight,
    timeframe: position.timeframe,
    signalAt: position.signalAt,
    openedAt: position.openedAt,
    entryPrice: position.entryPrice,
    quantity: position.quantity,
    peakPrice: position.peakPrice,
    stopPrice: position.stopPrice,
    premiumAtRisk: position.premiumAtRisk,
    selectedContract: position.selectedContract,
    lastMarkPrice: position.lastMarkPrice,
    lastMarkedAt: position.lastMarkedAt,
  };
}

function dailyPnlForBackfill(input: {
  dayKey: string;
  realizedByDay: Map<string, number>;
  openPositions: Iterable<HistoricalBackfillOpenPosition>;
}) {
  let pnl = input.realizedByDay.get(input.dayKey) ?? 0;
  for (const position of input.openPositions) {
    const mark = finiteNumber(position.lastMarkPrice) ?? position.entryPrice;
    pnl += (mark - position.entryPrice) * position.quantity * 100;
  }
  return pnl;
}

function backfillPositionExpirationKey(
  position: HistoricalBackfillOpenPosition,
): string | null {
  const expirationDate = dateOrNull(
    asRecord(position.selectedContract).expirationDate,
  );
  return expirationDate ? expirationDate.toISOString().slice(0, 10) : null;
}

function shouldCloseBackfillPositionAtExpiration(input: {
  position: HistoricalBackfillOpenPosition;
  until: Date;
}) {
  const expirationKey = backfillPositionExpirationKey(input.position);
  if (!expirationKey) {
    return false;
  }
  return expirationKey <= marketDateKeyFromDate(input.until);
}

async function closeBackfillPosition(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  position: HistoricalBackfillOpenPosition;
  reason: string;
  occurredAt: Date;
  exitPrice: number;
  signalKey?: string | null;
  candidate?: SignalOptionsCandidate | null;
  existingBackfillEvents: Map<string, ExecutionEvent>;
  commit: boolean;
  summary: SignalOptionsBackfillSummary;
  realizedByDay: Map<string, number>;
  eventSource?: SignalOptionsHistoricalEventSource;
  replay?: SignalOptionsReplayMetadata | null;
}) {
  const exitTrade = selectHistoricalOptionTradeFill({
    trades: input.position.optionTrades,
    at: input.occurredAt,
  });
  const exitMarkPrice = input.exitPrice;
  const exitPrice = Number((exitTrade?.price ?? exitMarkPrice).toFixed(2));
  const pnl = Number(
    ((exitPrice - input.position.entryPrice) *
      input.position.quantity *
      100).toFixed(2),
  );
  const dayKey = input.occurredAt.toISOString().slice(0, 10);
  input.realizedByDay.set(
    dayKey,
    (input.realizedByDay.get(dayKey) ?? 0) + pnl,
  );
  const positionPatch = {
    ...backfillPositionPayload(input.position),
    lastMarkPrice: exitPrice,
    lastMarkedAt: input.occurredAt.toISOString(),
  };
  const eventSource = input.eventSource ?? SIGNAL_OPTIONS_BACKFILL_SOURCE;
  const write = await insertSignalOptionsBackfillEvent({
    deployment: input.deployment,
    symbol: input.position.symbol,
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    summary: `${input.position.symbol} shadow backfill exit ${input.reason} at ${exitPrice.toFixed(2)}`,
    occurredAt: input.occurredAt,
    backfillEventKey: backfillEventKey([
      input.deployment.id,
      input.position.candidateId,
      "exit",
      input.reason,
      input.occurredAt.toISOString(),
    ], eventSource),
    source: eventSource,
    replay: input.replay,
    existingBackfillEvents: input.existingBackfillEvents,
    commit: input.commit,
    summaryCounters: input.summary,
    payload: {
      signalKey: input.signalKey ?? null,
      reason: input.reason,
      signal: input.candidate?.signal ?? null,
      action: input.candidate?.action ?? null,
      candidate: input.candidate ?? null,
      exitPrice,
      exitMarkPrice,
      exitFill: {
        source: exitTrade ? "polygon-option-trade" : "polygon-option-aggregates",
        trade: optionTradeSnapshot(exitTrade),
        markPrice: exitMarkPrice,
        maxDelayMs: HISTORICAL_OPTION_TRADE_FILL_MAX_DELAY_MS,
      },
      pnl,
      position: positionPatch,
      selectedContract: input.position.selectedContract,
      profile: input.profile,
    },
  });
  if (!write.existing) {
    input.summary.exitsClosed += 1;
    input.summary.realizedPnl = Number(
      (input.summary.realizedPnl + pnl).toFixed(2),
    );
    if (pnl > 0) {
      input.summary.winningTrades += 1;
    } else if (pnl < 0) {
      input.summary.losingTrades += 1;
    }
    input.summary.exitReasons[input.reason] =
      (input.summary.exitReasons[input.reason] ?? 0) + 1;
    input.summary.closedTrades.push({
      candidateId: input.position.candidateId,
      symbol: input.position.symbol,
      direction: input.position.direction,
      optionRight: input.position.optionRight,
      openedAt: input.position.openedAt,
      closedAt: input.occurredAt.toISOString(),
      entryPrice: input.position.entryPrice,
      exitPrice,
      quantity: input.position.quantity,
      pnl,
      reason: input.reason,
      selectedContract: input.position.selectedContract,
    });
  }
}

async function markBackfillPositionsThrough(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  positionsBySymbol: Map<string, HistoricalBackfillOpenPosition>;
  until: Date;
  existingBackfillEvents: Map<string, ExecutionEvent>;
  commit: boolean;
  summary: SignalOptionsBackfillSummary;
  realizedByDay: Map<string, number>;
  eventSource?: SignalOptionsHistoricalEventSource;
  replay?: SignalOptionsReplayMetadata | null;
}) {
  const eventSource = input.eventSource ?? SIGNAL_OPTIONS_BACKFILL_SOURCE;
  for (const [symbol, position] of Array.from(input.positionsBySymbol.entries())) {
    while (position.nextBarIndex < position.optionBars.length) {
      const bar = position.optionBars[position.nextBarIndex];
      const barAt = dateOrNull(bar?.timestamp);
      if (!bar || !barAt || barAt.getTime() > input.until.getTime()) {
        break;
      }
      position.nextBarIndex += 1;
      const markPrice = backfillBarPrice(bar);
      if (markPrice == null || markPrice <= 0) {
        continue;
      }
      const peakPrice = Math.max(position.peakPrice, markPrice);
      const stop = computePositionStop({
        entryPrice: position.entryPrice,
        peakPrice,
        markPrice,
        profile: input.profile,
      });
      position.peakPrice = peakPrice;
      position.stopPrice = stop.stopPrice;
      position.lastMarkPrice = Number(markPrice.toFixed(2));
      position.lastMarkedAt = barAt.toISOString();

      if (stop.exitReason) {
        const exitPrice = Number(markPrice.toFixed(2));
        await closeBackfillPosition({
          deployment: input.deployment,
          profile: input.profile,
          position,
          reason: stop.exitReason,
          occurredAt: barAt,
          exitPrice,
          existingBackfillEvents: input.existingBackfillEvents,
          commit: input.commit,
          summary: input.summary,
          realizedByDay: input.realizedByDay,
          eventSource,
          replay: input.replay,
        });
        input.positionsBySymbol.delete(symbol);
        break;
      }

      const write = await insertSignalOptionsBackfillEvent({
        deployment: input.deployment,
        symbol: position.symbol,
        eventType: SIGNAL_OPTIONS_MARK_EVENT,
        summary: `${position.symbol} shadow backfill mark ${markPrice.toFixed(2)} stop ${stop.stopPrice.toFixed(2)}`,
        occurredAt: barAt,
        backfillEventKey: backfillEventKey([
          input.deployment.id,
          position.candidateId,
          "mark",
          barAt.toISOString(),
        ], eventSource),
        source: eventSource,
        replay: input.replay,
        existingBackfillEvents: input.existingBackfillEvents,
        commit: input.commit,
        summaryCounters: input.summary,
        payload: {
          position: {
            ...backfillPositionPayload(position),
            lastMarkPrice: Number(markPrice.toFixed(2)),
            lastMarkedAt: barAt.toISOString(),
          },
          selectedContract: position.selectedContract,
          quote: quoteFromHistoricalBar(bar),
          liquidity: {
            ok: true,
            reasons: [],
            mid: Number(markPrice.toFixed(2)),
            quoteFreshness: "historical_option_bars",
          },
          stop,
        },
      });
      if (!write.existing) {
        input.summary.marksRecorded += 1;
      }
    }

    if (
      input.positionsBySymbol.has(symbol) &&
      shouldCloseBackfillPositionAtExpiration({ position, until: input.until })
    ) {
      const exitPrice =
        finiteNumber(position.lastMarkPrice) ?? position.entryPrice;
      await closeBackfillPosition({
        deployment: input.deployment,
        profile: input.profile,
        position,
        reason: "expiration",
        occurredAt:
          dateOrNull(position.lastMarkedAt) ??
          dateOrNull(position.openedAt) ??
          input.until,
        exitPrice,
        existingBackfillEvents: input.existingBackfillEvents,
        commit: input.commit,
        summary: input.summary,
        realizedByDay: input.realizedByDay,
        eventSource,
        replay: input.replay,
      });
      input.positionsBySymbol.delete(symbol);
    }
  }
}

function buildBackfillSignalSnapshot(input: {
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  signal: RayReplicaSignalEvent;
}): SignalMonitorState {
  const signalAt = new Date(input.signal.time * 1000);
  return {
    profileId: input.profileId,
    symbol: input.symbol,
    timeframe: input.timeframe,
    currentSignalDirection: signalDirection(input.signal),
    currentSignalAt: signalAt,
    currentSignalPrice: signalPrice(input.signal),
    latestBarAt: signalAt,
    barsSinceSignal: 0,
    fresh: true,
    status: "ok",
  };
}

async function loadHistoricalBackfillSignals(input: {
  profileId: string;
  profileSettings: Record<string, unknown>;
  symbols: string[];
  timeframe: SignalMonitorTimeframe;
  window: SignalOptionsBackfillWindow;
}) {
  const signals: HistoricalBackfillSignal[] = [];
  const errors: SignalOptionsBackfillSummary["errors"] = [];
  const settings = resolveRayReplicaSignalSettings(input.profileSettings);

  for (const symbol of input.symbols) {
    try {
      const bars = await getBars({
        symbol,
        timeframe: input.timeframe,
        limit: BACKFILL_EQUITY_BAR_LIMIT,
        from: input.window.warmupFrom,
        to: input.window.to,
        assetClass: "equity",
        outsideRth: input.window.session === "all",
        source: "trades",
        allowHistoricalSynthesis: true,
      });
      const chartBars = brokerBarsToRayReplicaBars(bars.bars);
      const evaluation = evaluateRayReplicaSignals({
        chartBars,
        settings,
        includeProvisionalSignals: false,
      });
      evaluation.signalEvents.forEach((signal) => {
        const signalAt = new Date(signal.time * 1000);
        if (!isWithinBackfillWindow(signalAt, input.window)) {
          return;
        }
        signals.push({
          symbol,
          signal,
          signalAt,
          direction: signalDirection(signal),
          signalPrice: signalPrice(signal),
        });
      });
    } catch (error) {
      errors.push({
        symbol,
        message:
          error instanceof Error && error.message
            ? error.message
            : "Failed to load historical backfill bars.",
      });
    }
  }

  return {
    signals: signals.sort(
      (left, right) =>
        left.signalAt.getTime() - right.signalAt.getTime() ||
        left.symbol.localeCompare(right.symbol),
    ),
    errors,
  };
}

async function resolveDefaultSignalOptionsSymbols() {
  const { watchlists } = await listWatchlists();
  const watchlist =
    watchlists.find((item) => item.name.toLowerCase() === "core") ??
    watchlists.find((item) => item.isDefault) ??
    watchlists[0] ??
    null;
  const symbols =
    watchlist?.items
      .map((item) => normalizeSymbol(item.symbol).toUpperCase())
      .filter(Boolean) ?? [];
  return Array.from(new Set(symbols));
}

function normalizeSignalOptionsUniverseSymbols(symbols: readonly unknown[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of symbols) {
    const symbol =
      typeof value === "string" ? normalizeSymbol(value).toUpperCase() : "";
    if (symbol && !seen.has(symbol)) {
      seen.add(symbol);
      normalized.push(symbol);
    }
  }
  return normalized;
}

function buildSignalOptionsBackfillUniverse(input: {
  deploymentSymbols: readonly unknown[];
  signalMonitorSymbols: readonly unknown[];
  watchlistId?: string | null;
  skippedSymbols?: readonly unknown[];
  truncated?: boolean;
}): SignalOptionsBackfillUniverse {
  const signalMonitorSymbols = normalizeSignalOptionsUniverseSymbols(
    input.signalMonitorSymbols,
  );
  if (signalMonitorSymbols.length) {
    return {
      source: "signal_monitor_watchlist",
      symbols: signalMonitorSymbols,
      watchlistId: input.watchlistId ?? null,
      skippedSymbols: normalizeSignalOptionsUniverseSymbols(
        input.skippedSymbols ?? [],
      ),
      truncated: input.truncated === true,
    };
  }

  return {
    source: "deployment",
    symbols: normalizeSignalOptionsUniverseSymbols(input.deploymentSymbols),
    watchlistId: null,
    skippedSymbols: [],
    truncated: false,
  };
}

function isDefaultSignalOptionsSeedConfig(value: unknown): boolean {
  const config = asRecord(value);
  return (
    config.source === "default_signal_options_seed" ||
    asRecord(config.parameters).executionMode === "signal_options"
  );
}

export async function ensureDefaultSignalOptionsPaperDeployment(input: {
  enabled?: boolean;
} = {}) {
  const symbols = await resolveDefaultSignalOptionsSymbols();
  if (!symbols.length) {
    throw new HttpError(409, "No symbols are available for the default signal-options deployment.", {
      code: "signal_options_default_universe_empty",
      expose: true,
    });
  }
  const enabled = input.enabled !== false;
  const existingStrategies = await db
    .select()
    .from(algoStrategiesTable)
    .where(eq(algoStrategiesTable.mode, "paper"))
    .orderBy(desc(algoStrategiesTable.updatedAt));
  let strategy =
    existingStrategies.find((row) => isDefaultSignalOptionsSeedConfig(row.config)) ??
    null;

  if (!strategy) {
    [strategy] = await db
      .insert(algoStrategiesTable)
      .values({
        name: "RayReplica Signal Options Shadow",
        mode: "paper",
        enabled: false,
        symbolUniverse: symbols,
        config: {
          source: "default_signal_options_seed",
          strategyId: "ray_replica_signals",
          strategyVersion: "v1",
          parameters: {
            executionMode: "signal_options",
          },
          signalOptions: resolveSignalOptionsExecutionProfile({}),
        },
      })
      .returning();
  }

  const existingDeployments = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.mode, "paper"))
    .orderBy(desc(algoDeploymentsTable.updatedAt));
  let deployment =
    existingDeployments.find(
      (row) =>
        row.strategyId === strategy.id ||
        row.name === "RayReplica Signal Options Shadow Paper",
    ) ?? null;

  if (!deployment) {
    [deployment] = await db
      .insert(algoDeploymentsTable)
      .values({
        strategyId: strategy.id,
        name: "RayReplica Signal Options Shadow Paper",
        mode: "paper",
        enabled,
        providerAccountId: "shadow",
        symbolUniverse: symbols,
        config: {
          ...(strategy.config as Record<string, unknown>),
          signalOptions: resolveSignalOptionsExecutionProfile(strategy.config),
        },
      })
      .returning();

    await db.insert(executionEventsTable).values({
      deploymentId: deployment.id,
      providerAccountId: deployment.providerAccountId,
      eventType: "deployment_created",
      summary: `Created deployment ${deployment.name}`,
      payload: {
        strategyId: deployment.strategyId,
        mode: deployment.mode,
        symbolUniverse: deployment.symbolUniverse,
        source: "default_signal_options_seed",
      },
    });
  } else if (enabled && !deployment.enabled) {
    const [updated] = await db
      .update(algoDeploymentsTable)
      .set({
        enabled: true,
        symbolUniverse: symbols,
        updatedAt: new Date(),
        lastError: null,
      })
      .where(eq(algoDeploymentsTable.id, deployment.id))
      .returning();
    deployment = updated ?? deployment;
    await db.insert(executionEventsTable).values({
      deploymentId: deployment.id,
      providerAccountId: deployment.providerAccountId,
      eventType: "deployment_enabled",
      summary: `Enabled deployment ${deployment.name}`,
      payload: {
        enabled: true,
        source: "default_signal_options_seed",
      },
    });
  }

  deployment = await normalizeSignalOptionsDeploymentAccount(deployment);

  return {
    strategy: {
      id: strategy.id,
      name: strategy.name,
      mode: strategy.mode,
      enabled: strategy.enabled,
      symbolUniverse: strategy.symbolUniverse,
      config: strategy.config,
      createdAt: strategy.createdAt,
      updatedAt: strategy.updatedAt,
    },
    deployment: deploymentToResponse(deployment),
  };
}

export async function runSignalOptionsShadowBackfill(input: {
  deploymentId: string;
  start?: unknown;
  end?: unknown;
  session?: unknown;
  commit?: boolean;
  profilePatch?: unknown;
  forceDeploymentUniverse?: boolean;
  replay?: SignalOptionsReplayMetadata | boolean | null;
  replaceReplayRows?: boolean;
}) {
  if (activeScanDeploymentIds.has(input.deploymentId)) {
    throw new HttpError(409, "Signal-options scan is already running.", {
      code: "signal_options_scan_running",
      detail:
        "A worker, manual scan, or backfill is already active for this deployment.",
      expose: true,
    });
  }

  activeScanDeploymentIds.add(input.deploymentId);
  try {
    const deployment = await getDeploymentOrThrow(input.deploymentId);
    const window = resolveSignalOptionsBackfillWindow(input);
    const replay =
      input.replay && typeof input.replay === "object"
        ? {
            ...input.replay,
            marketDate: input.replay.marketDate || window.startDate,
            deploymentId: input.replay.deploymentId || deployment.id,
            deploymentName: input.replay.deploymentName || deployment.name,
          }
        : input.replay
          ? {
              runId: `manual-replay-${window.startDate}-through-${window.endDate}-${Date.now()}`,
              marketDate: window.startDate,
              deploymentId: deployment.id,
              deploymentName: deployment.name,
            }
          : null;
    const commit = input.commit !== false;
    const eventSource = replay
      ? SIGNAL_OPTIONS_REPLAY_SOURCE
      : SIGNAL_OPTIONS_BACKFILL_SOURCE;
    activeSignalOptionsRunMetadata.set(
      deployment.id,
      buildSignalOptionsRunMetadata({
        deployment,
        mode: replay ? "replay" : "historical_backfill",
        source: replay
          ? SIGNAL_OPTIONS_REPLAY_SOURCE
          : SIGNAL_OPTIONS_BACKFILL_SOURCE,
        marketDate: replay?.marketDate,
      }),
    );
    if (replay && input.replaceReplayRows !== false && commit) {
      await resetSignalOptionsReplayRowsForRange({
        deploymentId: deployment.id,
        marketDateFrom: window.startDate,
        marketDateTo: window.endDate,
        windowStart: window.from,
        cleanupEnd: window.to,
      });
    }
    const baseProfile = resolveDeploymentProfile(deployment);
    const profilePatch = asRecord(input.profilePatch);
    const profile = Object.keys(profilePatch).length
      ? mergeProfilePatch(baseProfile, profilePatch)
      : baseProfile;
    const signalProfile = await getSignalMonitorProfileRow({
      environment: deployment.mode,
    });
    const signalUniverse =
      await resolveSignalMonitorProfileUniverse(signalProfile);
    const backfillUniverse = buildSignalOptionsBackfillUniverse({
      deploymentSymbols: deployment.symbolUniverse,
      signalMonitorSymbols: input.forceDeploymentUniverse
        ? []
        : signalUniverse.symbols,
      watchlistId: signalUniverse.profile.watchlistId,
      skippedSymbols: input.forceDeploymentUniverse
        ? []
        : signalUniverse.skippedSymbols,
      truncated: input.forceDeploymentUniverse ? false : signalUniverse.truncated,
    });
    const timeframe = String(
      signalUniverse.profile.timeframe || "15m",
    ) as SignalMonitorTimeframe;
    const summary: SignalOptionsBackfillSummary = {
      symbolsEvaluated: backfillUniverse.symbols.length,
      symbolUniverse: backfillUniverse,
      signalsEvaluated: 0,
      entriesOpened: 0,
      exitsClosed: 0,
      marksRecorded: 0,
      candidatesSkipped: 0,
      existingEvents: 0,
      mirrorRepairsAttempted: 0,
      missingOptionBars: 0,
      realizedPnl: 0,
      winningTrades: 0,
      losingTrades: 0,
      exitReasons: {},
      skippedReasons: {},
      closedTrades: [],
      errors: [],
    };
    const initialEvents = replay
      ? []
      : await listDeploymentBackfillEvents(deployment.id);
    const seenSignals = seenSignalKeys(initialEvents);
    const existingBackfillEvents = buildBackfillEventIndexes(initialEvents);
    const positionsBySymbol = new Map<string, HistoricalBackfillOpenPosition>();
    const realizedByDay = new Map<string, number>();
    const { signals, errors } = await loadHistoricalBackfillSignals({
      profileId: signalProfile.id,
      profileSettings: asRecord(signalProfile.rayReplicaSettings),
      symbols: backfillUniverse.symbols,
      timeframe,
      window,
    });
    summary.errors.push(...errors);
    summary.signalsEvaluated = signals.length;

    let lastSignalAt: Date | null = null;
    for (const historicalSignal of signals) {
      await markBackfillPositionsThrough({
        deployment,
        profile,
        positionsBySymbol,
        until: historicalSignal.signalAt,
        existingBackfillEvents,
        commit,
        summary,
        realizedByDay,
        eventSource,
        replay,
      });

      const state = buildBackfillSignalSnapshot({
        profileId: signalProfile.id,
        symbol: historicalSignal.symbol,
        timeframe,
        signal: historicalSignal.signal,
      });
      const signalAt = historicalSignal.signalAt.toISOString();
      const signalKey = buildSignalKey(state, signalAt);
      if (seenSignals.has(signalKey)) {
        summary.existingEvents += 1;
        continue;
      }
      seenSignals.add(signalKey);
      const candidate = buildCandidateFromSignal({
        deployment,
        state,
        signalAt,
        signalKey,
        signalMetadata: {
          source: "rayreplica-backfill",
          filterState: asRecord(historicalSignal.signal.filterState),
        },
      });
      const symbol = normalizeSymbol(candidate.symbol).toUpperCase();
      const currentPosition = positionsBySymbol.get(symbol);

      if (currentPosition && currentPosition.direction === candidate.direction) {
        await emitBackfillSkippedCandidate({
          deployment,
          candidate,
          signalKey,
          reason: "same_direction_position_open",
          detail: { position: backfillPositionPayload(currentPosition) },
          occurredAt: historicalSignal.signalAt,
          existingBackfillEvents,
          commit,
          summary,
          eventSource,
          replay,
        });
        continue;
      }

      if (currentPosition && currentPosition.direction !== candidate.direction) {
        if (!profile.exitPolicy.flipOnOppositeSignal) {
          await emitBackfillSkippedCandidate({
            deployment,
            candidate,
            signalKey,
            reason: "opposite_signal_flip_disabled",
            detail: { position: backfillPositionPayload(currentPosition) },
            occurredAt: historicalSignal.signalAt,
            existingBackfillEvents,
            commit,
            summary,
            eventSource,
            replay,
          });
          continue;
        }
        const exitPrice =
          finiteNumber(currentPosition.lastMarkPrice) ?? currentPosition.entryPrice;
        await closeBackfillPosition({
          deployment,
          profile,
          position: currentPosition,
          reason: "opposite_signal",
          occurredAt: historicalSignal.signalAt,
          exitPrice,
          signalKey,
          candidate,
          existingBackfillEvents,
          commit,
          summary,
          realizedByDay,
          eventSource,
          replay,
        });
        positionsBySymbol.delete(symbol);
      }

      const entryGate = evaluateSignalOptionsEntryGate({ candidate, profile });
      if (!entryGate.ok) {
        await emitBackfillSkippedCandidate({
          deployment,
          candidate,
          signalKey,
          reason: entryGate.reason ?? "entry_gate_failed",
          detail: { entryGate },
          occurredAt: historicalSignal.signalAt,
          existingBackfillEvents,
          commit,
          summary,
          eventSource,
          replay,
        });
        continue;
      }

      const dayKey = historicalSignal.signalAt.toISOString().slice(0, 10);
      const dailyPnl = dailyPnlForBackfill({
        dayKey,
        realizedByDay,
        openPositions: positionsBySymbol.values(),
      });
      if (dailyPnl <= -Math.abs(profile.riskCaps.maxDailyLoss)) {
        await emitBackfillSkippedCandidate({
          deployment,
          candidate,
          signalKey,
          reason: "daily_loss_halt_active",
          detail: {
            dailyPnl,
            maxDailyLoss: profile.riskCaps.maxDailyLoss,
          },
          occurredAt: historicalSignal.signalAt,
          existingBackfillEvents,
          commit,
          summary,
          eventSource,
          replay,
        });
        continue;
      }

      if (positionsBySymbol.size >= profile.riskCaps.maxOpenSymbols) {
        await emitBackfillSkippedCandidate({
          deployment,
          candidate,
          signalKey,
          reason: "max_open_symbols_reached",
          detail: {
            openSymbols: positionsBySymbol.size,
            maxOpenSymbols: profile.riskCaps.maxOpenSymbols,
          },
          occurredAt: historicalSignal.signalAt,
          existingBackfillEvents,
          commit,
          summary,
          eventSource,
          replay,
        });
        continue;
      }

      const resolved = await resolveHistoricalOptionForBackfill({
        candidate,
        profile,
        window,
      }).catch((error) => {
        summary.errors.push({
          symbol,
          message:
            error instanceof Error && error.message
              ? error.message
              : "Historical option resolution failed.",
        });
        return null;
      });
      if (!resolved) {
        summary.missingOptionBars += 1;
        await emitBackfillSkippedCandidate({
          deployment,
          candidate,
          signalKey,
          reason: "historical_option_bars_unavailable",
          detail: {
            signalPrice: candidate.signalPrice,
            optionRight: candidate.optionRight,
          },
          occurredAt: historicalSignal.signalAt,
          existingBackfillEvents,
          commit,
          summary,
          eventSource,
          replay,
        });
        continue;
      }

      const entryAt = dateOrNull(resolved.entryBar.timestamp) ?? historicalSignal.signalAt;
      const firstFutureBarIndex = resolved.optionBars.findIndex((bar) => {
        const barAt = dateOrNull(bar.timestamp);
        return Boolean(barAt && barAt.getTime() > entryAt.getTime());
      });
      const nextBarIndex =
        firstFutureBarIndex >= 0
          ? firstFutureBarIndex
          : resolved.optionBars.length;
      const position = buildBackfillPosition({
        deployment,
        candidate,
        selectedContract: resolved.selectedContract,
        orderPlan: resolved.orderPlan,
        entryAt,
        optionBars: resolved.optionBars,
        optionTrades: resolved.optionTrades,
        nextBarIndex,
        profile,
      });
      if (!position) {
        await emitBackfillSkippedCandidate({
          deployment,
          candidate,
          signalKey,
          reason: "invalid_historical_shadow_order_plan",
          detail: {
            selectedContract: resolved.selectedContract,
            orderPlan: resolved.orderPlan,
          },
          occurredAt: historicalSignal.signalAt,
          existingBackfillEvents,
          commit,
          summary,
          eventSource,
          replay,
        });
        continue;
      }

      const write = await insertSignalOptionsBackfillEvent({
        deployment,
        symbol: candidate.symbol,
        eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
        summary: `${candidate.symbol} shadow backfill ${candidate.optionRight.toUpperCase()} ${resolved.selectedContract.strike ?? "strike"} ${resolved.selectedContract.expirationDate ?? "expiry"} x${resolved.orderPlan.quantity}`,
        occurredAt: entryAt,
        backfillEventKey: backfillEventKey([
          deployment.id,
          signalKey,
          "entry",
        ], eventSource),
        source: eventSource,
        replay,
        existingBackfillEvents,
        commit,
        summaryCounters: summary,
        payload: {
          signalKey,
          signal: candidate.signal ?? null,
          action: candidate.action ?? null,
          candidate: {
            ...candidate,
            status: "open",
            selectedContract: resolved.selectedContract,
            quote: resolved.quote,
            orderPlan: resolved.orderPlan,
          },
          profile,
          selectedExpiration: {
            expirationDate: resolved.selectedExpiration.expirationDate.toISOString(),
            dte: resolved.selectedExpiration.dte,
          },
          selectedContract: resolved.selectedContract,
          quote: resolved.quote,
          orderPlan: resolved.orderPlan,
          liquidity: resolved.liquidity,
          position: backfillPositionPayload(position),
          historicalPricing: {
            source: "polygon-option-aggregates",
            entryBarAt: entryAt.toISOString(),
          },
        },
      });
      if (!write.existing) {
        summary.entriesOpened += 1;
      }
      positionsBySymbol.set(symbol, position);
      lastSignalAt = historicalSignal.signalAt;
    }

    await markBackfillPositionsThrough({
      deployment,
      profile,
      positionsBySymbol,
      until: window.to,
      existingBackfillEvents,
      commit,
      summary,
      realizedByDay,
      eventSource,
      replay,
    });

    if (commit) {
      await db
        .update(algoDeploymentsTable)
        .set({
          lastEvaluatedAt: new Date(),
          lastSignalAt: lastSignalAt ?? deployment.lastSignalAt,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(algoDeploymentsTable.id, deployment.id));
    }

    const finalState = commit
      ? await listSignalOptionsAutomationState({ deploymentId: deployment.id })
      : null;

    return {
      deployment: deploymentToResponse(deployment),
      window: {
        start: window.startDate,
        end: window.endDate,
        session: window.session,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
      },
      timeframe,
      commit,
      summary,
      openPositions:
        finalState?.activePositions ??
        Array.from(positionsBySymbol.values()).map((position) => ({
          id: position.id,
          candidateId: position.candidateId,
          symbol: position.symbol,
          direction: position.direction,
          optionRight: position.optionRight,
          openedAt: position.openedAt,
          entryPrice: position.entryPrice,
          quantity: position.quantity,
          lastMarkPrice: position.lastMarkPrice ?? null,
          lastMarkedAt: position.lastMarkedAt ?? null,
          selectedContract: position.selectedContract,
        })),
      state: finalState,
    };
  } finally {
    activeScanDeploymentIds.delete(input.deploymentId);
    activeSignalOptionsRunMetadata.delete(input.deploymentId);
  }
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
    activeSignalOptionsRunMetadata.delete(input.deploymentId);
  }
}

async function runSignalOptionsShadowScanUnlocked(input: {
  deploymentId: string;
  forceEvaluate?: boolean;
  source?: "manual" | "worker";
}) {
  const deployment = await getDeploymentOrThrow(input.deploymentId);
  const source = input.source ?? "manual";
  activeSignalOptionsRunMetadata.set(
    deployment.id,
    buildSignalOptionsRunMetadata({
      deployment,
      mode: "live_scan",
      source,
    }),
  );
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
    await refreshActivePosition({
      deployment,
      profile,
      position,
      recentEvents: initialSignalEvents,
    }).catch(
      async (error: unknown) => {
        const occurredAt = new Date();
        if (
          !shouldRecordPositionMarkSkip({
            events: initialSignalEvents,
            position,
            reason: "position_mark_failed",
            now: occurredAt,
          })
        ) {
          return;
        }
        await insertSignalOptionsEvent({
          deployment,
          symbol: position.symbol,
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          summary: `${position.symbol} shadow mark skipped: option quote unavailable`,
          occurredAt,
          payload: {
            reason: "position_mark_failed",
            message:
              error instanceof Error ? error.message : "Unknown position mark error",
            retryable: true,
            position,
          },
        });
      },
    );
  }

  const eventsAfterMarks = await listDeploymentEvents(deployment.id, 750);
  const activePositionsAfterMarks = deriveActivePositions(
    signalOptionsEvents(eventsAfterMarks),
  );
  const seenSignals = seenSignalKeys(eventsAfterMarks, {
    activePositions: activePositionsAfterMarks,
    currentPremiumCap: profile.riskCaps.maxPremiumPerEntry,
    forceRetryMarketData: input.forceEvaluate === true,
  });
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
  const evaluated = await loadSignalOptionsMonitorState({
    deployment,
    universe,
    forceEvaluate: input.forceEvaluate,
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
    const signalMetadata = await readSignalMonitorEventMetadata({
      state,
      signalAt,
    }).catch(() => null);
    const candidate = buildCandidateFromSignal({
      deployment,
      state,
      signalAt,
      signalKey,
      signalMetadata,
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

    const entryGate = evaluateSignalOptionsEntryGate({ candidate, profile });
    if (!entryGate.ok) {
      await emitSkippedCandidate({
        deployment,
        candidate,
        signalKey,
        reason: entryGate.reason ?? "entry_gate_failed",
        detail: { entryGate },
      });
      continue;
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
  buildCandidateFromSignal,
  candidateFromSignalSnapshot,
  buildCockpitAttention,
  buildCockpitDiagnostics,
  buildCockpitPipeline,
  buildSignalOptionsActionMapping,
  buildSignalOptionsSignalSnapshot,
  candidateFromEvent,
  classifySignalOptionsSkipReason,
  findSignalOptionsQuoteForContract,
  mergeSignalOptionsCandidate,
  computeSignalOptionsDailyPnl,
  computeSignalOptionsDailyRealizedPnl,
  computeSignalOptionsOpenUnrealizedPnl,
  computePositionStop,
  evaluateSignalOptionsEntryGate,
  quoteSnapshotToSignalOptionsQuote,
  resolvePositionMarkQuote,
  selectHistoricalOptionTradeFill,
  selectSignalOptionsContractPlanFromChain,
  seenSignalKeys,
  shouldRecordPositionMarkSkip,
  shouldRefreshSignalOptionsMonitorState,
  signalOptionsStrikesAroundMoney,
  shouldRecordActivePositionMark,
  shouldRecordActivePositionMarkForScan,
  SIGNAL_OPTIONS_OPTION_MARK_TIMEFRAME,
  buildHistoricalPolygonOptionTicker,
  buildHistoricalOrderPlan,
  buildSignalOptionsBackfillUniverse,
  backfillEventKey,
  historicalEventPayload,
  replayPositionKey,
  resolveSignalOptionsBackfillWindow,
  selectHistoricalExpirationCandidates,
  selectHistoricalStrikeCandidates,
  shouldCloseBackfillPositionAtExpiration,
};
