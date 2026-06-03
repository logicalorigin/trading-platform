import {
  computeOptionGreeksFromPrice,
  resolveSignalOptionsExecutionProfile,
  scoreOptionGreekCandidate,
  signalOptionsStrikeSlotsForRight,
  timeToExpirationYears,
  tunedSignalOptionsExecutionProfile,
  tunedSignalOptionsStrategySettings,
  type OptionGreekScore,
  type OptionGreekSnapshot,
  type SignalOptionsExecutionProfile,
} from "@workspace/backtest-core";
import {
  evaluatePyrusSignalsSignals,
  PYRUS_SIGNALS_SIGNAL_WARMUP_BARS,
  resolvePyrusSignalsSignalSettings,
  type PyrusSignalsBar,
  type PyrusSignalsEvaluation,
  type PyrusSignalsSignalEvent,
} from "@workspace/pyrus-signals-core";
import {
  algoDeploymentsTable,
  algoStrategiesTable,
  backtestRunsTable,
  db,
  executionEventsTable,
  signalMonitorEventsTable,
  shadowFillsTable,
  shadowOrdersTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
  type AlgoDeployment,
  type ExecutionEvent,
} from "@workspace/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import type {
  BrokerBarSnapshot,
  QuoteSnapshot,
} from "../providers/ibkr/client";
import type { OptionChainContract } from "../providers/ibkr/client";
import {
  cappedSignalMonitorEvaluationProfile,
  evaluateSignalMonitor,
  evaluateSignalMonitorMatrix,
  evaluateSignalMonitorProfileSymbols,
  getSignalMonitorProfileRow,
  getSignalMonitorState,
  getSignalMonitorStoredState,
  getSignalMonitorTimeframeMs,
  loadSignalMonitorCompletedBars,
  resolveSignalMonitorTimeframe,
  resolveSignalMonitorProfileUniverse,
  updateSignalMonitorProfile,
  withSignalMonitorUniverseScope,
  type SignalMonitorProfileRow,
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
import { persistDurableOptionChain } from "./option-metadata-store";
import {
  getAlgoGatewayReadiness,
  type AlgoGatewayReadiness,
} from "./algo-gateway";
import {
  hasLegacyAlgoBranding,
  normalizeLegacyAlgoBranding,
  normalizeLegacyAlgoBrandText,
} from "./algo-branding";
import { notifyAlgoCockpitChanged } from "./algo-cockpit-events";
import {
  SHADOW_PROVIDER_ACCOUNT_ID,
  isSignalOptionsShadowConfig,
  normalizeAlgoDeploymentProviderAccountId,
} from "./algo-deployment-account";
import { getSignalOptionsWorkerSnapshot } from "./signal-options-worker-state";
import { fetchBridgeOptionQuoteSnapshots } from "./bridge-option-quote-stream";
import {
  declareIbkrLiveDemand,
  readIbkrLiveDemandState,
  type IbkrLiveDemandDeclaration,
  type IbkrLiveDemandState,
} from "./ibkr-live-demand-coordinator";
import {
  SIGNAL_OPTIONS_REPLAY_MARK_SOURCE,
  SIGNAL_OPTIONS_REPLAY_SOURCE,
  computeShadowTradeDiagnostics,
  recordShadowAutomationEvent,
  resetSignalOptionsReplayRowsForRange,
} from "./shadow-account";
import {
  getApiResourcePressureSnapshot,
  isApiResourcePressureHardBlock,
} from "./resource-pressure";
import {
  buildInitialStopPrice,
  computeSignalOptionsOvernightPositionExit as computeOvernightPositionExit,
  computeSignalOptionsPositionStop as computePositionStop,
  type SignalOptionsEntryQuality,
  type SignalOptionsGreekSnapshot,
  type SignalOptionsWireContext,
} from "./signal-options-exit-policy";

export const SIGNAL_OPTIONS_EVENT_PREFIX = "signal_options_";
export const SIGNAL_OPTIONS_ENTRY_EVENT = "signal_options_shadow_entry";
export const SIGNAL_OPTIONS_EXIT_EVENT = "signal_options_shadow_exit";
export const SIGNAL_OPTIONS_MARK_EVENT = "signal_options_shadow_mark";
export const SIGNAL_OPTIONS_CANDIDATE_EVENT =
  "signal_options_candidate_created";
export const SIGNAL_OPTIONS_SKIPPED_EVENT = "signal_options_candidate_skipped";
export const SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT =
  "signal_options_gateway_blocked";
export const SIGNAL_OPTIONS_MANUAL_DEVIATION_EVENT =
  "signal_options_manual_deviation";

const SIGNAL_OPTIONS_DECISION_SNAPSHOT_SOURCE_PREFIX =
  "signal-options:decision";
const SIGNAL_OPTIONS_DECISION_SNAPSHOT_MAX_CONTRACTS = 12;
const activeScanDeploymentIds = new Set<string>();
const activeScanStartedAtByDeploymentId = new Map<string, Date>();
const signalOptionsMonitorBatchCursors = new Map<
  string,
  { signature: string; nextIndex: number }
>();
const signalOptionsActionCursors = new Map<
  string,
  {
    phase: "positions" | "signals";
    positionSignature: string;
    positionIndex: number;
    signalSignature: string;
    signalIndex: number;
  }
>();

type SignalOptionsRunMetadata = {
  runId: string;
  mode: "live_scan" | "historical_backfill" | "replay";
  source:
    | "manual"
    | "worker"
    | "signal_options_backfill"
    | "signal_options_replay";
  phase: "signal_refresh" | "action_scan" | "deferred";
  startedAt: string;
  marketDate?: string | null;
  lastSignalScanAt?: string | null;
  latestSignalBarAt?: string | null;
  heavyWorkDeferred?: boolean;
};

const activeSignalOptionsRunMetadata = new Map<
  string,
  SignalOptionsRunMetadata
>();

const DEFAULT_SIGNAL_OPTIONS_MONITOR_MAX_SYMBOLS = 250;
const DEFAULT_SIGNAL_OPTIONS_MONITOR_CONCURRENCY = 6;
const SIGNAL_OPTIONS_MONITOR_FULL_REFRESH_CONCURRENCY = 6;
const DEFAULT_SIGNAL_OPTIONS_MONITOR_POLL_SECONDS = 60;
const DEFAULT_SIGNAL_OPTIONS_WORKER_MONITOR_BATCH_SIZE = 12;
const DEFAULT_SIGNAL_OPTIONS_WORKER_ACTION_BUDGET_MS = 60_000;
const DEFAULT_SIGNAL_OPTIONS_WORKER_ACTION_ITEM_LIMIT = 24;
const DEFAULT_SIGNAL_OPTIONS_WORKER_SIGNAL_RESERVE_BUDGET_MS = 30_000;
const DEFAULT_SIGNAL_OPTIONS_WORKER_SIGNAL_RESERVE_ITEM_LIMIT = 4;
const SIGNAL_OPTIONS_MATRIX_MTF_TIMEFRAMES = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
] as const;
const SIGNAL_OPTIONS_ACTION_ITEM_TIMEOUT_MS = 5_000;
const SIGNAL_OPTIONS_POSITION_MARK_TIMEOUT_MS = 9_000;
const SIGNAL_OPTIONS_CANDIDATE_RESOLUTION_TIMEOUT_MS = 9_000;
const SIGNAL_OPTIONS_LIVE_QUOTE_DEMAND_TTL_MS = 120_000;
const SIGNAL_OPTIONS_SELECTED_LIVE_QUOTE_SETTLE_MS = 2_500;
const SIGNAL_OPTIONS_SELECTED_LIVE_QUOTE_RETRY_INTERVAL_MS = 500;
const SIGNAL_OPTIONS_SHADOW_EXECUTION_SLO_MS = {
  signalPickup: 5_000,
  contractDecision: 10_000,
  positionMark: 10_000,
};
const SIGNAL_OPTIONS_POSITION_MARK_RECORD_INTERVAL_MS = Math.max(
  1_000,
  Math.floor(SIGNAL_OPTIONS_SHADOW_EXECUTION_SLO_MS.positionMark / 2),
);
const SIGNAL_OPTIONS_SIGNAL_SOURCE_POLICY = "massive-primary";
const SIGNAL_OPTIONS_MONITOR_BAR_SOURCE_POLICY = "mixed" as const;
const SIGNAL_OPTIONS_MONITOR_STALE_GRACE_MS = 5_000;
const SIGNAL_OPTIONS_POSITION_MARK_SKIP_RATE_LIMIT_MS = 5 * 60 * 1_000;
const SIGNAL_OPTIONS_SHADOW_MARK_FALLBACK_MAX_AGE_MS = 3 * 60 * 1_000;
const SIGNAL_OPTIONS_BLOCKED_LIVE_MARKET_DATA_MODES = new Set([
  "delayed",
  "frozen",
]);
const SIGNAL_OPTIONS_EXTENDED_CLOSE_UNDERLYINGS = new Set([
  "DIA",
  "IWM",
  "QQQ",
  "SPY",
]);
const SIGNAL_OPTIONS_STATE_EVENT_LIMIT = 2_500;
const SIGNAL_OPTIONS_SUMMARY_EVENT_LIMIT = 250;
const SIGNAL_OPTIONS_SUMMARY_RESPONSE_EVENT_LIMIT = 20;
const SIGNAL_OPTIONS_DASHBOARD_CACHE_TTL_MS = 2_000;
const SIGNAL_OPTIONS_DASHBOARD_CACHE_STALE_TTL_MS = 60_000;
const SIGNAL_OPTIONS_SUMMARY_CACHE_TTL_MS = 15_000;
const SIGNAL_OPTIONS_SUMMARY_CACHE_STALE_TTL_MS = 120_000;
const SIGNAL_OPTIONS_DASHBOARD_SUMMARY_BUILD_TIMEOUT_MS = 4_000;
const SIGNAL_OPTIONS_DASHBOARD_FULL_BUILD_TIMEOUT_MS = 8_000;
const SIGNAL_OPTIONS_MAX_ACTIONABLE_BARS_SINCE_SIGNAL = 0;
const SIGNAL_OPTIONS_CONTRACT_PREVIEW_LIMIT = 12;
const SIGNAL_OPTIONS_CONTRACT_PREVIEW_TIMEOUT_MS = 2_000;
const SIGNAL_OPTIONS_CONTRACT_PREVIEW_STATE_BUDGET_MS = 2_000;
const SIGNAL_OPTIONS_CONTRACT_PREVIEW_TIMEOUT_BACKOFF_MS = 60_000;
const SIGNAL_OPTIONS_OPTION_BACKOFF_DEBUG_REASON = "options_backoff";
const SIGNAL_OPTIONS_GATEWAY_NOT_READY_REASON = "algo_gateway_not_ready";
const SIGNAL_OPTIONS_MARKET_SESSION_QUIET_REASON = "market_session_quiet";

type SignalDirection = "buy" | "sell";
type OptionRight = "call" | "put";
type SignalOptionsDashboardView = "summary" | "full";
type SignalOptionsDashboardCacheMode = "normal" | "cache-only";
type SignalOptionsOptionBackoffReason =
  | "option_chain_backoff"
  | "option_expiration_backoff";
type SignalOptionsOptionBackoff = {
  reason: SignalOptionsOptionBackoffReason;
  source: "chain" | "expiration";
  debugReason: string;
  backoffRemainingMs: number | null;
};
type SignalOptionsExecutionBlocker = {
  reason: string;
  detail?: Record<string, unknown>;
};
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

type SignalOptionsContractPreview = {
  status: "resolved" | "unavailable";
  source: "profile_contract_preview";
  action: SignalOptionsActionMapping | null;
  basisPrice: number | null;
  selectedContract: Record<string, unknown> | null;
  quote: Record<string, unknown> | null;
  liquidity: Record<string, unknown> | null;
  orderPlan: Record<string, unknown> | null;
  contractSelection: Record<string, unknown> | null;
  selectedExpiration: Record<string, unknown> | null;
  reason: string | null;
  detail: Record<string, unknown> | null;
  tradeReady: boolean;
  generatedAt: string;
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
  freshWindowBars: number | null;
  fresh: boolean;
  actionEligible: boolean;
  actionBlocker: string | null;
  status?: string | null;
  filterState?: Record<string, unknown> | null;
  contractPreview?: SignalOptionsContractPreview | null;
};

type SignalOptionsActionMapping = {
  indicator: "pyrus-signals";
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
  selectedExpiration?: Record<string, unknown> | null;
  contractSelection?: Record<string, unknown> | null;
  chainDebug?: Record<string, unknown> | null;
  chainAttempts?: Array<Record<string, unknown>>;
  expirationsDebug?: Record<string, unknown> | null;
  optionMarketDataBackoff?: Record<string, unknown> | null;
  liveQuoteDemand?: Record<string, unknown> | null;
  reason?: string | null;
  actionStatus?: SignalOptionsActionStatus;
  syncStatus?: SignalOptionsSyncStatus;
  shadowLink?: SignalOptionsShadowLink | null;
  signalQuality?: SignalOptionsEntryQuality | null;
  signal?: Record<string, unknown> | null;
  action?: Record<string, unknown> | null;
  timeline?: Array<Record<string, unknown>>;
};

export type SignalOptionsPosition = {
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
  lastStop?: Record<string, unknown> | null;
  lastWireTrail?: Record<string, unknown> | null;
  signalQuality?: SignalOptionsEntryQuality | null;
  entryGreeks?: SignalOptionsGreekSnapshot | null;
  greekBaselineSource?: "entry" | "first_mark" | null;
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

function throwIfSignalOptionsScanAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw new Error("Signal-options scan aborted.");
}

function signalOptionsTimeoutError(reason: string, timeoutMs: number): Error {
  const error = new Error(`${reason} after ${timeoutMs}ms.`);
  const typed = error as Error & {
    code?: string;
    reason?: string;
    timeoutMs?: number;
  };
  typed.code = reason;
  typed.reason = reason;
  typed.timeoutMs = timeoutMs;
  return error;
}

function waitForSignalOptionsDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfSignalOptionsScanAborted(signal);
  const waitMs = Math.max(0, Math.floor(ms));
  if (waitMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolve();
    }, waitMs);
    const abort = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(signal?.reason ?? new Error("Signal-options scan aborted."));
    };
    timeout.unref?.();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function withSignalOptionsActionItemTimeout<T>(input: {
  reason: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  task: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  throwIfSignalOptionsScanAborted(input.signal);
  const timeoutMs = Math.max(
    1,
    Math.floor(input.timeoutMs ?? SIGNAL_OPTIONS_ACTION_ITEM_TIMEOUT_MS),
  );
  const controller = new AbortController();
  const parentAbort = () => {
    controller.abort(
      input.signal?.reason ?? new Error("Signal-options scan aborted."),
    );
  };
  input.signal?.addEventListener("abort", parentAbort, { once: true });
  const taskPromise = input.task(controller.signal);
  taskPromise.catch(() => {});
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = signalOptionsTimeoutError(input.reason, timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    timeout.unref?.();
  });
  try {
    return await Promise.race([taskPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    input.signal?.removeEventListener("abort", parentAbort);
    if (!controller.signal.aborted) {
      controller.abort(new Error("Signal-options action item complete."));
    }
  }
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
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

function latestSignalDate(current: Date | null, value: unknown): Date | null {
  const next = dateOrNull(value);
  if (!next) {
    return current;
  }
  return current && current >= next ? current : next;
}

function expirationDateKey(value: unknown): string | null {
  const date = dateOrNull(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function compactString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function signalOptionsCandidateResolutionErrorReason(error: unknown) {
  const record = asRecord(error);
  const reason = compactString(record.reason ?? record.code);
  return reason === "candidate_resolution_timeout"
    ? "candidate_resolution_timeout"
    : "candidate_resolution_failed";
}

function signalOptionsCandidateResolutionErrorDetail(
  error: unknown,
  reason: string,
) {
  const record = asRecord(error);
  const timeoutMs = finiteNumber(record.timeoutMs);
  return {
    message:
      error instanceof Error
        ? error.message
        : "Unknown signal-options resolution error",
    ...(timeoutMs != null ? { timeoutMs } : {}),
    ...(reason === "candidate_resolution_timeout" ? { retryable: true } : {}),
  };
}

function signalOptionsPositionMarkErrorReason(error: unknown) {
  const record = asRecord(error);
  const reason = compactString(record.reason ?? record.code);
  return reason === "position_mark_timeout"
    ? "position_mark_timeout"
    : "position_mark_failed";
}

function signalOptionsPositionMarkErrorDetail(
  error: unknown,
  reason: string,
) {
  const record = asRecord(error);
  const timeoutMs = finiteNumber(record.timeoutMs);
  return {
    message:
      error instanceof Error ? error.message : "Unknown position mark error",
    ...(timeoutMs != null ? { timeoutMs } : {}),
    retryable: true,
    timeout: reason === "position_mark_timeout",
  };
}

function normalizedQuoteStatus(value: unknown): string | null {
  return compactString(value)?.toLowerCase() ?? null;
}

function isBlockedLiveMarketDataMode(value: unknown): boolean {
  const mode = normalizedQuoteStatus(value);
  return Boolean(
    mode && SIGNAL_OPTIONS_BLOCKED_LIVE_MARKET_DATA_MODES.has(mode),
  );
}

function isSignalOptionsLiveExitQuoteEligible(input: {
  quote: SignalOptionsOptionQuote | null;
  markSource: string | null;
  usedShadowMarkFallback: boolean;
}) {
  if (
    !input.quote ||
    input.usedShadowMarkFallback ||
    input.markSource === "shadow_position_mark"
  ) {
    return false;
  }
  const marketDataMode = normalizedQuoteStatus(input.quote.marketDataMode);
  if (
    isBlockedLiveMarketDataMode(input.quote.marketDataMode) ||
    (marketDataMode && marketDataMode !== "live")
  ) {
    return false;
  }
  const quoteFreshness = normalizedQuoteStatus(input.quote.quoteFreshness);
  if (
    quoteFreshness &&
    ["pending", "stale", "unavailable"].includes(quoteFreshness)
  ) {
    return false;
  }
  return true;
}

function isSignalOptionsShadowMarkFallbackExitEligible(input: {
  deployment: Pick<AlgoDeployment, "providerAccountId">;
  fallback: SignalOptionsShadowPositionMarkFallback | null;
  markSource: string | null;
  now: Date;
  position: SignalOptionsPosition;
  usedShadowMarkFallback: boolean;
}) {
  if (
    input.deployment.providerAccountId !== SHADOW_PROVIDER_ACCOUNT_ID ||
    !input.usedShadowMarkFallback ||
    input.markSource !== "shadow_position_mark" ||
    !input.fallback
  ) {
    return false;
  }
  return (
    isFreshShadowPositionMarkFallback({
      fallback: input.fallback,
      now: input.now,
    }) &&
    normalizedQuoteStatus(input.fallback.source) === "option_quote" &&
    isLiveOptionTradingSession(
      input.fallback.latestAsOf,
      input.position.selectedContract,
    )
  );
}

function signalOptionsTradeEventHasActionableOptionSession(
  event: ExecutionEvent,
) {
  const payload = asRecord(event.payload);
  const position = asRecord(payload.position);
  const payloadContract = asRecord(payload.selectedContract);
  const selectedContract = Object.keys(payloadContract).length
    ? payloadContract
    : asRecord(position.selectedContract);
  if (!Object.keys(selectedContract).length) {
    return true;
  }
  return isLiveOptionTradingSession(event.occurredAt, selectedContract);
}

function signalOptionsEntryEventHasActionableOptionSession(
  event: ExecutionEvent,
) {
  return signalOptionsTradeEventHasActionableOptionSession(event);
}

function signalOptionsExitEventHasActionableOptionSession(
  event: ExecutionEvent,
) {
  return signalOptionsTradeEventHasActionableOptionSession(event);
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
    phase: "signal_refresh" as const,
    startedAt: startedAt.toISOString(),
    marketDate: input.marketDate ?? null,
    lastSignalScanAt: null,
    latestSignalBarAt: null,
    heavyWorkDeferred: false,
  };
}

function updateSignalOptionsRunMetadata(
  deploymentId: string,
  patch: Partial<SignalOptionsRunMetadata>,
) {
  const current = activeSignalOptionsRunMetadata.get(deploymentId);
  if (!current) {
    return;
  }
  activeSignalOptionsRunMetadata.set(deploymentId, {
    ...current,
    ...patch,
  });
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
          runPhase: activeRun.phase,
          runStartedAt: activeRun.startedAt,
          ...(activeRun.lastSignalScanAt
            ? { lastSignalScanAt: activeRun.lastSignalScanAt }
            : {}),
          ...(activeRun.latestSignalBarAt
            ? { latestSignalBarAt: activeRun.latestSignalBarAt }
            : {}),
          ...(activeRun.heavyWorkDeferred ? { heavyWorkDeferred: true } : {}),
          ...(activeRun.marketDate ? { marketDate: activeRun.marketDate } : {}),
        }
      : {}),
    ...metadata,
    deploymentId: metadata.deploymentId ?? input.deployment.id,
    deploymentName: normalizeLegacyAlgoBrandText(
      compactString(metadata.deploymentName) ?? input.deployment.name,
    ),
  };
  return {
    ...input.payload,
    metadata: nextMetadata,
  };
}

function optionContractKey(value: unknown): string | null {
  const contract = asRecord(value);
  const underlying = normalizeSymbol(
    String(contract.underlying ?? contract.ticker ?? ""),
  ).toUpperCase();
  const expiration = expirationDateKey(contract.expirationDate);
  const strike = finiteNumber(contract.strike);
  const right = String(contract.right ?? "").toLowerCase();
  const providerContractId = compactString(contract.providerContractId);
  const ticker = compactString(contract.ticker);
  if (
    !underlying ||
    !expiration ||
    strike == null ||
    !["call", "put"].includes(right)
  ) {
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

function greekSnapshotFromQuote(
  quote: SignalOptionsOptionQuote | Record<string, unknown> | null | undefined,
): SignalOptionsGreekSnapshot | null {
  if (!quote) {
    return null;
  }
  const snapshot: SignalOptionsGreekSnapshot = {
    delta: finiteNumber((quote as Record<string, unknown>).delta),
    gamma: finiteNumber((quote as Record<string, unknown>).gamma),
    theta: finiteNumber((quote as Record<string, unknown>).theta),
    vega: finiteNumber((quote as Record<string, unknown>).vega),
    impliedVolatility: finiteNumber(
      (quote as Record<string, unknown>).impliedVolatility,
    ),
    updatedAt:
      toIsoString((quote as Record<string, unknown>).quoteUpdatedAt) ??
      toIsoString((quote as Record<string, unknown>).updatedAt),
    ageMs: finiteNumber((quote as Record<string, unknown>).ageMs),
  };
  return [
    snapshot.delta,
    snapshot.gamma,
    snapshot.theta,
    snapshot.vega,
    snapshot.impliedVolatility,
  ].some((value) => value != null)
    ? snapshot
    : null;
}

function quoteToOptionChainContract(input: {
  contract: Record<string, unknown>;
  quote: SignalOptionsOptionQuote;
}): OptionChainContract | null {
  const contract = input.contract;
  const quoteContract = asRecord(input.quote.contract);
  const expirationDate = dateOrNull(
    quoteContract.expirationDate ?? contract.expirationDate,
  );
  const underlying = compactString(
    quoteContract.underlying ?? contract.underlying,
  );
  const strike = finiteNumber(quoteContract.strike ?? contract.strike);
  const right =
    quoteContract.right === "put" || contract.right === "put" ? "put" : "call";
  if (!underlying || !expirationDate || strike == null) {
    return null;
  }
  return {
    contract: {
      ticker:
        compactString(quoteContract.ticker ?? contract.ticker) ??
        `${underlying}-${expirationDate.toISOString().slice(0, 10)}-${right}-${strike}`,
      underlying,
      expirationDate,
      strike,
      right,
      multiplier:
        finiteNumber(quoteContract.multiplier ?? contract.multiplier) ?? 100,
      sharesPerContract:
        finiteNumber(
          quoteContract.sharesPerContract ?? contract.sharesPerContract,
        ) ?? 100,
      providerContractId:
        compactString(
          quoteContract.providerContractId ?? contract.providerContractId,
        ) ?? null,
    },
    bid: finiteNumber(input.quote.bid),
    ask: finiteNumber(input.quote.ask),
    last: finiteNumber(input.quote.last),
    mark: finiteNumber(input.quote.mark),
    impliedVolatility: finiteNumber(input.quote.impliedVolatility),
    delta: finiteNumber(input.quote.delta),
    gamma: finiteNumber(input.quote.gamma),
    theta: finiteNumber(input.quote.theta),
    vega: finiteNumber(input.quote.vega),
    openInterest: finiteNumber(input.quote.openInterest),
    volume: finiteNumber(input.quote.volume),
    updatedAt:
      dateOrNull(input.quote.updatedAt) ??
      dateOrNull(input.quote.quoteUpdatedAt) ??
      new Date(),
    quoteUpdatedAt: dateOrNull(input.quote.quoteUpdatedAt),
    dataUpdatedAt: dateOrNull(input.quote.dataUpdatedAt),
    ageMs: finiteNumber(input.quote.ageMs),
  };
}

async function persistSignalOptionsQuoteSnapshot(input: {
  contract: Record<string, unknown>;
  quote: SignalOptionsOptionQuote | null;
  source: string;
}): Promise<void> {
  if (!input.quote) {
    return;
  }
  const contract = quoteToOptionChainContract({
    contract: input.contract,
    quote: input.quote,
  });
  if (!contract) {
    return;
  }
  await persistDurableOptionChain({
    contracts: [contract],
    source: input.source,
    asOf:
      dateOrNull(input.quote.quoteUpdatedAt) ??
      dateOrNull(input.quote.updatedAt) ??
      new Date(),
  });
}

function signalOptionsQuoteHasDecisionSnapshotFields(
  quote: SignalOptionsOptionQuote | null,
) {
  if (!quote) {
    return false;
  }
  return [
    quote.bid,
    quote.ask,
    quote.last,
    quote.mark,
    quote.impliedVolatility,
    quote.delta,
    quote.gamma,
    quote.theta,
    quote.vega,
  ].some((value) => finiteNumber(value) != null);
}

function signalOptionsQuoteFromDecisionPayload(
  value: unknown,
): SignalOptionsOptionQuote | null {
  const record = asRecord(value);
  const quote = Object.keys(asRecord(record.quote)).length
    ? asRecord(record.quote)
    : record;
  const contract = Object.keys(asRecord(record.selectedContract)).length
    ? asRecord(record.selectedContract)
    : asRecord(quote.contract);
  if (!Object.keys(contract).length) {
    return null;
  }
  return {
    contract: {
      ticker: compactString(contract.ticker) ?? undefined,
      underlying: compactString(contract.underlying) ?? undefined,
      expirationDate: contract.expirationDate as string | Date | undefined,
      strike: finiteNumber(contract.strike) ?? undefined,
      right: contract.right === "put" ? "put" : "call",
      multiplier: finiteNumber(contract.multiplier) ?? 100,
      sharesPerContract: finiteNumber(contract.sharesPerContract) ?? 100,
      providerContractId: compactString(contract.providerContractId),
    },
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
    quoteFreshness: compactString(quote.quoteFreshness),
    marketDataMode: compactString(quote.marketDataMode),
    updatedAt: (quote.updatedAt as string | Date | null | undefined) ?? null,
    quoteUpdatedAt:
      (quote.quoteUpdatedAt as string | Date | null | undefined) ?? null,
    dataUpdatedAt:
      (quote.dataUpdatedAt as string | Date | null | undefined) ?? null,
    ageMs: finiteNumber(quote.ageMs),
  };
}

function signalOptionsDecisionSnapshotKey(contract: OptionChainContract) {
  return (
    compactString(contract.contract.providerContractId) ??
    optionContractKey(contract.contract) ??
    [
      contract.contract.underlying,
      expirationDateKey(contract.contract.expirationDate),
      contract.contract.strike,
      contract.contract.right,
    ].join(":")
  );
}

function buildSignalOptionsDecisionSnapshotBatch(input: {
  selectedQuote?: SignalOptionsOptionQuote | null;
  contractSelectionPayload?: Record<string, unknown> | null;
  maxContracts?: number;
}) {
  const maxContracts = Math.max(
    1,
    Math.floor(
      input.maxContracts ?? SIGNAL_OPTIONS_DECISION_SNAPSHOT_MAX_CONTRACTS,
    ),
  );
  const contracts: OptionChainContract[] = [];
  const seen = new Set<string>();
  let attemptedCount = 0;
  let skippedNoUsableFields = 0;

  const appendQuote = (
    quote: SignalOptionsOptionQuote | null,
    contractOverride?: Record<string, unknown> | null,
  ) => {
    if (!quote) {
      return;
    }
    attemptedCount += 1;
    if (!signalOptionsQuoteHasDecisionSnapshotFields(quote)) {
      skippedNoUsableFields += 1;
      return;
    }
    const contract = quoteToOptionChainContract({
      contract: contractOverride ?? contractToPayload(quote),
      quote,
    });
    if (!contract) {
      skippedNoUsableFields += 1;
      return;
    }
    const key = signalOptionsDecisionSnapshotKey(contract);
    if (seen.has(key) || contracts.length >= maxContracts) {
      return;
    }
    seen.add(key);
    contracts.push(contract);
  };

  if (input.selectedQuote) {
    appendQuote(input.selectedQuote, contractToPayload(input.selectedQuote));
  }

  const contractSelection = asRecord(input.contractSelectionPayload);
  const greekSelection = asRecord(contractSelection.greekSelection);
  const appendEntries = (entries: unknown[]) => {
    for (const entry of entries) {
      const quote = signalOptionsQuoteFromDecisionPayload(entry);
      appendQuote(quote, asRecord(asRecord(entry).selectedContract));
    }
  };
  appendEntries(asArray(greekSelection.topCandidates));
  appendEntries(asArray(contractSelection.attempts));
  appendEntries(asArray(greekSelection.attempts));

  return {
    contracts,
    attemptedCount,
    submittedCount: contracts.length,
    skippedNoUsableFields,
  };
}

function signalOptionsDecisionSnapshotContracts(input: {
  selectedQuote?: SignalOptionsOptionQuote | null;
  contractSelectionPayload?: Record<string, unknown> | null;
  maxContracts?: number;
}) {
  return buildSignalOptionsDecisionSnapshotBatch(input).contracts;
}

async function recordSignalOptionsDecisionSnapshots(input: {
  deployment: AlgoDeployment;
  candidate: SignalOptionsCandidate;
  selectedQuote?: SignalOptionsOptionQuote | null;
  contractSelectionPayload?: Record<string, unknown> | null;
}) {
  const batch = buildSignalOptionsDecisionSnapshotBatch({
    selectedQuote: input.selectedQuote,
    contractSelectionPayload: input.contractSelectionPayload,
  });
  const source = `${SIGNAL_OPTIONS_DECISION_SNAPSHOT_SOURCE_PREFIX}:${input.deployment.id}`;
  const providerContractIds = Array.from(
    new Set(
      batch.contracts
        .map((contract) => compactString(contract.contract.providerContractId))
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const detail = {
    source,
    attemptedCount: batch.attemptedCount,
    submittedCount: batch.submittedCount,
    skippedNoUsableFields: batch.skippedNoUsableFields,
    providerContractIdCount: providerContractIds.length,
    providerContractIds: providerContractIds.slice(
      0,
      SIGNAL_OPTIONS_DECISION_SNAPSHOT_MAX_CONTRACTS,
    ),
  };
  if (!batch.contracts.length) {
    return detail;
  }
  const asOf =
    batch.contracts
      .map((contract) => contract.updatedAt)
      .filter((date): date is Date => date instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0] ??
    new Date();
  try {
    await persistDurableOptionChain({
      contracts: batch.contracts,
      source,
      asOf,
    });
    return detail;
  } catch (error) {
    logger.debug?.(
      {
        err: error,
        deploymentId: input.deployment.id,
        candidateId: input.candidate.id,
      },
      "Signal-options decision snapshot persistence skipped",
    );
    return {
      ...detail,
      writeFailed: true,
    };
  }
}

function signalOptionsDataQualityStageFromReason(
  reason: unknown,
): string | null {
  const normalized = compactString(reason)?.toLowerCase() ?? "";
  if (!normalized) {
    return null;
  }
  if (normalized.includes("expiration")) {
    return "expiration";
  }
  if (normalized.includes("chain") || normalized.includes("upstream")) {
    return "chain";
  }
  if (
    normalized.includes("liquidity") ||
    normalized.includes("spread_too_wide")
  ) {
    return "liquidity";
  }
  if (
    normalized.includes("greek") ||
    normalized.includes("delta") ||
    normalized.includes("gamma") ||
    normalized.includes("theta") ||
    normalized.includes("vega")
  ) {
    return "greeks";
  }
  if (
    normalized.includes("quote") ||
    normalized.includes("bid") ||
    normalized.includes("ask") ||
    normalized.includes("mark")
  ) {
    return "quote";
  }
  return null;
}

function incrementSignalOptionsDataQualityStage(
  counter: Record<string, number>,
  stage: unknown,
) {
  incrementDiagnosticCounter(counter, stage);
}

function recordSignalOptionsDataQualityBackoff(input: {
  stages: Record<string, number>;
  value: unknown;
}) {
  const backoff = asRecord(input.value);
  if (!Object.keys(backoff).length) {
    return;
  }
  incrementSignalOptionsDataQualityStage(
    input.stages,
    compactString(backoff.source) ??
      signalOptionsDataQualityStageFromReason(backoff.reason),
  );
}

function recordSignalOptionsLiveDemandDataQuality(input: {
  liveDemand: {
    statuses: Record<string, number>;
    reasons: Record<string, number>;
  };
  stages: Record<string, number>;
  value: unknown;
}) {
  const demand = asRecord(input.value);
  if (!Object.keys(demand).length) {
    return;
  }
  const recordDemandState = (state: unknown, countStage: boolean) => {
    const stateRecord = asRecord(state);
    incrementDiagnosticCounter(input.liveDemand.statuses, stateRecord.status);
    incrementDiagnosticCounter(input.liveDemand.reasons, stateRecord.reason);
    if (countStage) {
      incrementSignalOptionsDataQualityStage(
        input.stages,
        signalOptionsDataQualityStageFromReason(stateRecord.reason),
      );
    }
  };
  recordDemandState(demand, true);
  for (const state of asArray(demand.states)) {
    recordDemandState(state, false);
  }
}

function recordSignalOptionsGreekSelectionDataQuality(input: {
  greekSelection: {
    selectedBy: Record<string, number>;
    fallbackReasons: Record<string, number>;
    candidateCount: number;
    rejectedCount: number;
  };
  stages: Record<string, number>;
  value: unknown;
}) {
  const selection = asRecord(input.value);
  if (!Object.keys(selection).length) {
    return;
  }
  incrementDiagnosticCounter(
    input.greekSelection.selectedBy,
    selection.selectedBy,
  );
  incrementDiagnosticCounter(
    input.greekSelection.fallbackReasons,
    selection.fallbackReason,
  );
  input.greekSelection.candidateCount +=
    finiteNumber(selection.candidateCount) ?? 0;
  input.greekSelection.rejectedCount +=
    finiteNumber(selection.rejectedCount) ?? 0;
  incrementSignalOptionsDataQualityStage(
    input.stages,
    signalOptionsDataQualityStageFromReason(selection.fallbackReason),
  );
}

function recordSignalOptionsDecisionSnapshotDataQuality(input: {
  snapshotPersistence: {
    attemptedCount: number;
    submittedCount: number;
    skippedNoUsableFields: number;
    writeFailedCount: number;
  };
  value: unknown;
}) {
  const snapshot = asRecord(input.value);
  if (!Object.keys(snapshot).length) {
    return;
  }
  input.snapshotPersistence.attemptedCount +=
    finiteNumber(snapshot.attemptedCount) ?? 0;
  input.snapshotPersistence.submittedCount +=
    finiteNumber(snapshot.submittedCount) ?? 0;
  input.snapshotPersistence.skippedNoUsableFields +=
    finiteNumber(snapshot.skippedNoUsableFields) ?? 0;
  if (snapshot.writeFailed === true) {
    input.snapshotPersistence.writeFailedCount += 1;
  }
}

function signalOptionsDataQualityEventCandidateId(event: ExecutionEvent) {
  const payload = asRecord(event.payload);
  const candidate = asRecord(
    Object.keys(asRecord(payload.candidate)).length
      ? payload.candidate
      : payload.automationCandidate,
  );
  const position = asRecord(payload.position);
  return (
    compactString(candidate.id) ??
    compactString(payload.candidateId) ??
    compactString(position.candidateId)
  );
}

function buildSignalOptionsDataQualityReport(input: {
  candidates?: Array<Partial<SignalOptionsCandidate> & Record<string, unknown>>;
  events?: ExecutionEvent[];
}) {
  const reasons: Record<string, number> = {};
  const stages: Record<string, number> = {};
  const greekSelection = {
    selectedBy: {} as Record<string, number>,
    fallbackReasons: {} as Record<string, number>,
    candidateCount: 0,
    rejectedCount: 0,
  };
  const liveDemand = {
    statuses: {} as Record<string, number>,
    reasons: {} as Record<string, number>,
  };
  const snapshotPersistence = {
    attemptedCount: 0,
    submittedCount: 0,
    skippedNoUsableFields: 0,
    writeFailedCount: 0,
  };
  const eventCandidateIds = new Set(
    (input.events ?? [])
      .map((event) => signalOptionsDataQualityEventCandidateId(event))
      .filter((candidateId): candidateId is string => Boolean(candidateId)),
  );

  const recordCandidate = (
    candidate: Record<string, unknown>,
    includeDiagnostics: boolean,
  ) => {
    if (!includeDiagnostics) {
      return;
    }
    const reason = candidate.reason;
    incrementDiagnosticCounter(reasons, reason);
    incrementSignalOptionsDataQualityStage(
      stages,
      signalOptionsDataQualityStageFromReason(reason),
    );
    const optionMarketDataBackoff = asRecord(candidate.optionMarketDataBackoff);
    recordSignalOptionsDataQualityBackoff({
      stages,
      value: optionMarketDataBackoff,
    });
    if (!Object.keys(optionMarketDataBackoff).length) {
      incrementSignalOptionsDataQualityStage(
        stages,
        signalOptionsDataQualityStageFromReason(
          asRecord(candidate.chainDebug).reason,
        ),
      );
    }
    const contractSelection = asRecord(candidate.contractSelection);
    recordSignalOptionsGreekSelectionDataQuality({
      greekSelection,
      stages,
      value: contractSelection.greekSelection,
    });
    recordSignalOptionsLiveDemandDataQuality({
      liveDemand,
      stages,
      value: candidate.liveQuoteDemand,
    });
  };

  for (const candidate of input.candidates ?? []) {
    recordCandidate(
      candidate,
      !eventCandidateIds.has(compactString(candidate.id) ?? ""),
    );
  }

  for (const event of input.events ?? []) {
    const payload = asRecord(event.payload);
    const reason = payload.reason;
    const optionMarketDataBackoff = asRecord(payload.optionMarketDataBackoff);
    incrementDiagnosticCounter(reasons, reason);
    if (!Object.keys(optionMarketDataBackoff).length) {
      incrementSignalOptionsDataQualityStage(
        stages,
        signalOptionsDataQualityStageFromReason(reason),
      );
    }
    recordSignalOptionsDataQualityBackoff({
      stages,
      value: optionMarketDataBackoff,
    });
    if (!Object.keys(optionMarketDataBackoff).length) {
      incrementSignalOptionsDataQualityStage(
        stages,
        signalOptionsDataQualityStageFromReason(
          asRecord(payload.chainDebug).reason,
        ),
      );
    }
    recordSignalOptionsGreekSelectionDataQuality({
      greekSelection,
      stages,
      value: asRecord(payload.contractSelection).greekSelection,
    });
    recordSignalOptionsLiveDemandDataQuality({
      liveDemand,
      stages,
      value: payload.liveQuoteDemand,
    });
    recordSignalOptionsDecisionSnapshotDataQuality({
      snapshotPersistence,
      value: payload.decisionSnapshot,
    });
  }

  return {
    candidateCount: input.candidates?.length ?? 0,
    reasons: sortedDiagnosticCounter(reasons),
    stages: sortedDiagnosticCounter(stages),
    greekSelection: {
      selectedBy: sortedDiagnosticCounter(greekSelection.selectedBy),
      fallbackReasons: sortedDiagnosticCounter(greekSelection.fallbackReasons),
      candidateCount: greekSelection.candidateCount,
      rejectedCount: greekSelection.rejectedCount,
    },
    liveDemand: {
      statuses: sortedDiagnosticCounter(liveDemand.statuses),
      reasons: sortedDiagnosticCounter(liveDemand.reasons),
    },
    snapshotPersistence,
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
  const targetExpirationKey = expirationDateKey(
    selectedContract.expirationDate,
  );

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
  source:
    | "provider_snapshot"
    | "provider_stream"
    | "chain_standard"
    | "shadow_position_mark";
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

type SignalOptionsShadowPositionMarkFallback = {
  positionId: string;
  latestMarkPrice: number;
  latestAsOf: Date;
  peakMarkPrice: number;
  peakAsOf: Date;
  source: string | null;
};

async function readShadowPositionMarkFallback(
  position: SignalOptionsPosition,
): Promise<SignalOptionsShadowPositionMarkFallback | null> {
  const openedAt = dateOrNull(position.openedAt);
  if (!openedAt) {
    return null;
  }
  const positionKey = shadowPositionKey({
    symbol: position.symbol,
    selectedContract: position.selectedContract,
  });
  const [shadowPosition] = await db
    .select({
      id: shadowPositionsTable.id,
    })
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, "shadow"),
        eq(shadowPositionsTable.positionKey, positionKey),
        eq(shadowPositionsTable.status, "open"),
      ),
    )
    .limit(1);
  if (!shadowPosition) {
    return null;
  }
  const marks = await db
    .select()
    .from(shadowPositionMarksTable)
    .where(
      and(
        eq(shadowPositionMarksTable.positionId, shadowPosition.id),
        gte(shadowPositionMarksTable.asOf, openedAt),
      ),
    )
    .orderBy(desc(shadowPositionMarksTable.asOf))
    .limit(1000);
  const eligibleMarks = marks.filter((mark) =>
    isLiveOptionTradingSession(mark.asOf, position.selectedContract),
  );
  const [latest] = eligibleMarks;
  const peak = eligibleMarks.reduce<typeof latest | undefined>(
    (selected, mark) => {
      const selectedPrice = finiteNumber(selected?.mark);
      const markPrice = finiteNumber(mark.mark);
      if (markPrice == null) {
        return selected;
      }
      if (!selected || selectedPrice == null || markPrice > selectedPrice) {
        return mark;
      }
      return selected;
    },
    undefined,
  );
  const latestMarkPrice = finiteNumber(latest?.mark);
  const peakMarkPrice = finiteNumber(peak?.mark);
  if (!latest || !peak || latestMarkPrice == null || peakMarkPrice == null) {
    return null;
  }
  return {
    positionId: shadowPosition.id,
    latestMarkPrice,
    latestAsOf: latest.asOf,
    peakMarkPrice,
    peakAsOf: peak.asOf,
    source: latest.source ?? null,
  };
}

function isFreshShadowPositionMarkFallback(input: {
  fallback: SignalOptionsShadowPositionMarkFallback | null;
  now: Date;
}) {
  if (!input.fallback) {
    return false;
  }
  return (
    input.now.getTime() - input.fallback.latestAsOf.getTime() <=
    SIGNAL_OPTIONS_SHADOW_MARK_FALLBACK_MAX_AGE_MS
  );
}

function quoteFromShadowPositionMarkFallback(input: {
  position: SignalOptionsPosition;
  fallback: SignalOptionsShadowPositionMarkFallback;
}): SignalOptionsOptionQuote {
  const mark = Number(input.fallback.latestMarkPrice.toFixed(2));
  return {
    contract: input.position
      .selectedContract as SignalOptionsOptionQuote["contract"],
    bid: null,
    ask: null,
    last: mark,
    mark,
    openInterest: null,
    volume: null,
    updatedAt: input.fallback.latestAsOf.toISOString(),
    quoteUpdatedAt: input.fallback.latestAsOf.toISOString(),
    dataUpdatedAt: input.fallback.latestAsOf.toISOString(),
    quoteFreshness: "shadow_position_mark",
    marketDataMode: "shadow",
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

const SIGNAL_OPTIONS_POSITION_MARK_SKIP_REASONS = new Set([
  "position_mark_unavailable",
  "position_mark_failed",
  "position_mark_timeout",
]);

function isSignalOptionsPositionMarkSkipReason(reason: string | null) {
  return Boolean(reason && SIGNAL_OPTIONS_POSITION_MARK_SKIP_REASONS.has(reason));
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
    summary: normalizeLegacyAlgoBrandText(event.summary),
    payload: normalizeLegacyAlgoBranding(event.payload),
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function deploymentToResponse(deployment: AlgoDeployment) {
  return {
    id: deployment.id,
    strategyId: deployment.strategyId,
    name: normalizeLegacyAlgoBrandText(deployment.name),
    mode: deployment.mode,
    enabled: deployment.enabled,
    providerAccountId: deployment.providerAccountId,
    symbolUniverse: deployment.symbolUniverse,
    config: normalizeLegacyAlgoBranding(deployment.config),
    lastEvaluatedAt: deployment.lastEvaluatedAt ?? null,
    lastSignalAt: deployment.lastSignalAt ?? null,
    lastError: deployment.lastError ?? null,
    createdAt: deployment.createdAt,
    updatedAt: deployment.updatedAt,
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getDeploymentByAlias(
  deploymentId: string,
): Promise<AlgoDeployment | null> {
  const alias = deploymentId.trim().toLowerCase();
  if (alias !== "paper-enabled") {
    return null;
  }

  const deployments = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.mode, "paper"))
    .orderBy(desc(algoDeploymentsTable.updatedAt));

  return (
    deployments.find(
      (deployment) =>
        deployment.enabled && deploymentHasSignalOptionsProfile(deployment),
    ) ??
    deployments.find((deployment) => {
      const deploymentName = normalizeLegacyAlgoBrandText(deployment.name);
      return (
        deploymentName === DEFAULT_SIGNAL_OPTIONS_DEPLOYMENT_NAME ||
        deploymentName === LEGACY_SIGNAL_OPTIONS_DEPLOYMENT_NAME
      );
    }) ??
    null
  );
}

async function getDeploymentOrThrow(
  deploymentId: string,
): Promise<AlgoDeployment> {
  const deployment = UUID_PATTERN.test(deploymentId)
    ? await db
        .select()
        .from(algoDeploymentsTable)
        .where(eq(algoDeploymentsTable.id, deploymentId))
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : await getDeploymentByAlias(deploymentId);

  if (!deployment) {
    throw new HttpError(404, "Algorithm deployment not found.", {
      code: "algo_deployment_not_found",
    });
  }

  const brandNormalized =
    await normalizeSignalOptionsDeploymentBranding(deployment);
  return normalizeSignalOptionsDeploymentAccount(brandNormalized);
}

async function listDeploymentEvents(deploymentId: string, limit = 500) {
  return db
    .select()
    .from(executionEventsTable)
    .where(eq(executionEventsTable.deploymentId, deploymentId))
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 10_000));
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
    mode: deployment.mode,
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
    summary: `Routed ${normalizeLegacyAlgoBrandText(deployment.name)} to the Shadow account`,
    payload: {
      previousProviderAccountId: deployment.providerAccountId,
      providerAccountId,
      reason: "signal_options_shadow_execution",
    },
  });

  return normalized;
}

async function normalizeSignalOptionsDeploymentBranding(
  deployment: AlgoDeployment,
): Promise<AlgoDeployment> {
  if (!deploymentHasSignalOptionsProfile(deployment)) {
    return deployment;
  }

  const nextName = normalizeLegacyAlgoBrandText(deployment.name);
  const nextConfig = normalizeLegacyAlgoBranding(deployment.config);
  const patch: {
    name?: string;
    config?: AlgoDeployment["config"];
  } = {};

  if (nextName !== deployment.name) {
    patch.name = nextName;
  }
  if (hasLegacyAlgoBranding(deployment.config)) {
    patch.config = nextConfig as AlgoDeployment["config"];
  }

  if (patch.name === undefined && patch.config === undefined) {
    return deployment;
  }

  const [updated] = await db
    .update(algoDeploymentsTable)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(algoDeploymentsTable.id, deployment.id))
    .returning();

  return updated ?? { ...deployment, ...patch, updatedAt: new Date() };
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

  invalidateSignalOptionsDashboardCaches(input.deployment.id);
  notifyAlgoCockpitChanged({
    deploymentId: input.deployment.id,
    mode: input.deployment.mode,
    reason: input.eventType,
  });

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

function signalOptionsBarsSinceSignal(value: unknown): number | null {
  const bars = optionalFiniteNumber(value);
  if (bars == null) return null;
  return Math.max(0, Math.round(bars));
}

function signalOptionsSignalAgeBlocker(
  barsSinceSignal: unknown,
  options?: { fresh?: boolean | null },
): string | null {
  if (options?.fresh === true) {
    return null;
  }
  const bars = signalOptionsBarsSinceSignal(barsSinceSignal);
  if (bars == null) return "signal_age_unavailable";
  return bars <= SIGNAL_OPTIONS_MAX_ACTIONABLE_BARS_SINCE_SIGNAL
    ? null
    : "signal_too_old";
}

function isSignalOptionsSignalAgeActionable(
  barsSinceSignal: unknown,
  options?: { fresh?: boolean | null },
): boolean {
  return signalOptionsSignalAgeBlocker(barsSinceSignal, options) == null;
}

function buildSignalOptionsSignalSnapshot(input: {
  state: SignalMonitorState;
  signalAt?: string | null;
  signalKey?: string | null;
  source?: string | null;
  eventId?: string | null;
  filterState?: unknown;
  freshWindowBars?: number | null;
}): SignalOptionsSignalSnapshot {
  const signalAt =
    input.signalAt ?? toIsoString(input.state.currentSignalAt) ?? null;
  const filterState = asRecord(input.filterState);
  const barsSinceSignal = signalOptionsBarsSinceSignal(
    input.state.barsSinceSignal,
  );
  const direction = input.state.currentSignalDirection ?? null;
  const fresh = input.state.fresh === true;
  const actionBlocker = signalOptionsSignalAgeBlocker(barsSinceSignal, {
    fresh,
  });
  return {
    profileId: input.state.profileId,
    signalKey: input.signalKey ?? null,
    source:
      compactString(input.source) ??
      (isUuidLike(input.state.profileId)
        ? "pyrus-signals"
        : "pyrus-signals-runtime"),
    eventId: compactString(input.eventId),
    symbol: normalizeSymbol(input.state.symbol).toUpperCase(),
    timeframe: input.state.timeframe,
    direction,
    signalAt,
    signalPrice: optionalFiniteNumber(input.state.currentSignalPrice),
    latestBarAt: toIsoString(input.state.latestBarAt),
    barsSinceSignal,
    freshWindowBars: optionalFiniteNumber(input.freshWindowBars),
    fresh,
    actionEligible: Boolean(fresh && signalAt && direction && !actionBlocker),
    actionBlocker,
    status: compactString(input.state.status),
    filterState: Object.keys(filterState).length ? filterState : null,
  };
}

function buildSignalOptionsActionMapping(
  direction: SignalDirection,
): SignalOptionsActionMapping {
  const optionRight = optionRightForSignal(direction);
  return {
    indicator: "pyrus-signals",
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
  const visibleStates = filteredStates.filter(isSignalOptionsVisibleSignalState);
  const freshWindowBars = optionalFiniteNumber(
    asRecord(signalState?.profile).freshWindowBars,
  );

  const snapshots = await Promise.all(
    visibleStates.map(async (state) => {
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
        freshWindowBars,
      });
    }),
  );

  return snapshots.sort((left, right) => {
    const leftTime = dateOrNull(left.signalAt)?.getTime() ?? 0;
    const rightTime = dateOrNull(right.signalAt)?.getTime() ?? 0;
    return rightTime - leftTime;
  });
}

function isSignalOptionsVisibleSignalState(state: SignalMonitorState) {
  return Boolean(
    state.fresh === true &&
      state.currentSignalDirection &&
      state.currentSignalAt,
  );
}

function isSignalOptionsActionableSignalState(state: SignalMonitorState) {
  return isSignalOptionsVisibleSignalState(state);
}

function isSignalOptionsActionableSignalSnapshot(
  signal: SignalOptionsSignalSnapshot,
) {
  if (!signal.fresh || !signal.signalAt || !signal.direction) {
    return false;
  }
  if (signal.actionEligible === true) {
    return true;
  }
  if (signal.actionEligible === false) {
    return false;
  }
  return isSignalOptionsSignalAgeActionable(signal.barsSinceSignal, {
    fresh: signal.fresh === true,
  });
}

function buildWorkerScanSummary(input: {
  states: SignalMonitorState[];
  universe: Set<string>;
  candidateCount: number;
  blockedCandidateCount: number;
  activePositionCount?: number;
  batch?: Record<string, unknown> | null;
  lastSignalScanAt?: string | null;
  heavyWorkDeferred?: boolean;
  activeScanPhase?: SignalOptionsRunMetadata["phase"] | null;
  resourcePressureLevel?: string | null;
}) {
  const states = input.states.filter((state) => {
    const symbol = normalizeSymbol(state.symbol).toUpperCase();
    return symbol && (input.universe.size === 0 || input.universe.has(symbol));
  });
  const latestSignalBarAt = latestIso(
    states.map((state) => state.latestBarAt ?? null),
  );
  const oldestSignalBarAt = (() => {
    const dates = states
      .map((state) => dateOrNull(state.latestBarAt))
      .filter((value): value is Date => Boolean(value));
    if (!dates.length) {
      return null;
    }
    return new Date(
      Math.min(...dates.map((value) => value.getTime())),
    ).toISOString();
  })();

  return {
    signalCount: states.length,
    freshSignalCount: states.filter((state) => state.fresh === true).length,
    staleSignalCount: states.filter(
      (state) => String(state.status ?? "").toLowerCase() === "stale",
    ).length,
    unavailableSignalCount: states.filter(
      (state) =>
        String(state.status ?? "").toLowerCase() === "unavailable" ||
        !dateOrNull(state.latestBarAt),
    ).length,
    latestSignalBarAt,
    oldestSignalBarAt,
    lastSignalScanAt: input.lastSignalScanAt ?? null,
    signalSourcePolicy: SIGNAL_OPTIONS_SIGNAL_SOURCE_POLICY,
    heavyWorkDeferred: input.heavyWorkDeferred === true,
    activeScanPhase: input.activeScanPhase ?? null,
    resourcePressureLevel: input.resourcePressureLevel ?? null,
    candidateCount: input.candidateCount,
    blockedCandidateCount: input.blockedCandidateCount,
    activePositionCount: input.activePositionCount ?? 0,
    batch: input.batch ?? null,
  };
}

async function loadSignalOptionsActivePositionCountForWorkerSummary(
  deploymentId: string,
) {
  const events = runtimeSignalOptionsEvents(
    await listDeploymentEvents(deploymentId, SIGNAL_OPTIONS_STATE_EVENT_LIMIT),
  );
  const activePositions = await reconcileActivePositionsWithShadowLedger({
    positions: deriveActivePositions(events),
    events,
  });
  return activePositions.length;
}

function latestFreshSignalAtFromStates(input: {
  states: SignalMonitorState[];
  universe: Set<string>;
}): Date | null {
  let latest: Date | null = null;
  for (const state of input.states) {
    const symbol = normalizeSymbol(state.symbol).toUpperCase();
    if (!symbol || (input.universe.size > 0 && !input.universe.has(symbol))) {
      continue;
    }
    if (
      !state.fresh ||
      !state.currentSignalDirection ||
      !state.currentSignalAt
    ) {
      continue;
    }
    latest = latestSignalDate(latest, toIsoString(state.currentSignalAt));
  }
  return latest;
}

function shouldDeferSignalOptionsHeavyWork() {
  const pressure = getApiResourcePressureSnapshot();
  const caps = pressure.caps.signalOptions;
  const hardPressureBlock = isApiResourcePressureHardBlock(pressure);
  return {
    pressure,
    defer:
      hardPressureBlock ||
      caps.positionMarksAllowed === false ||
      caps.actionScansAllowed === false,
  };
}

type SignalOptionsActionWorkBudget = {
  deadlineMs: number | null;
  itemLimit: number | null;
  processedItems: number;
};

function positiveActionBudget(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createSignalOptionsActionWorkBudget(input: {
  source: "manual" | "worker";
  actionWorkBudgetMs?: number | null;
  actionWorkItemLimit?: number | null;
  nowMs?: number;
}): SignalOptionsActionWorkBudget {
  if (input.source !== "worker") {
    return { deadlineMs: null, itemLimit: null, processedItems: 0 };
  }
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const budgetMs =
    input.actionWorkBudgetMs === null
      ? 0
      : positiveActionBudget(
          input.actionWorkBudgetMs,
          DEFAULT_SIGNAL_OPTIONS_WORKER_ACTION_BUDGET_MS,
        );
  const itemLimit =
    input.actionWorkItemLimit === null
      ? 0
      : positiveActionBudget(
          input.actionWorkItemLimit,
          DEFAULT_SIGNAL_OPTIONS_WORKER_ACTION_ITEM_LIMIT,
        );
  return {
    deadlineMs: budgetMs > 0 ? nowMs + budgetMs : null,
    itemLimit: itemLimit > 0 ? itemLimit : null,
    processedItems: 0,
  };
}

function createSignalOptionsSignalReserveBudget(input: {
  source: "manual" | "worker";
  nowMs?: number;
}): SignalOptionsActionWorkBudget {
  return createSignalOptionsActionWorkBudget({
    source: input.source,
    actionWorkBudgetMs: DEFAULT_SIGNAL_OPTIONS_WORKER_SIGNAL_RESERVE_BUDGET_MS,
    actionWorkItemLimit:
      DEFAULT_SIGNAL_OPTIONS_WORKER_SIGNAL_RESERVE_ITEM_LIMIT,
    nowMs: input.nowMs,
  });
}

function signalOptionsActionWorkExhausted(
  budget: SignalOptionsActionWorkBudget,
  nowMs = Date.now(),
): boolean {
  if (budget.itemLimit !== null && budget.processedItems >= budget.itemLimit) {
    return true;
  }
  return budget.deadlineMs !== null && nowMs >= budget.deadlineMs;
}

function recordSignalOptionsActionWorkItem(
  budget: SignalOptionsActionWorkBudget,
): void {
  budget.processedItems += 1;
}

function clampActionCursorIndex(value: unknown, length: number): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.min(parsed, Math.max(0, length));
}

function signalOptionsPositionActionSignature(
  positions: SignalOptionsPosition[],
): string {
  return positions
    .map((position) =>
      [
        position.id,
        normalizeSymbol(position.symbol).toUpperCase(),
        position.direction,
        position.quantity,
        position.openedAt,
        asRecord(position.selectedContract).providerContractId,
      ]
        .filter((part) => part != null && String(part).trim())
        .join(":"),
    )
    .join("|");
}

function signalOptionsStateActionSignature(input: {
  states: SignalMonitorState[];
  universe: Set<string>;
}): string {
  return input.states
    .map((state) => {
      const symbol = normalizeSymbol(state.symbol).toUpperCase();
      if (!symbol || (input.universe.size > 0 && !input.universe.has(symbol))) {
        return null;
      }
      return [
        symbol,
        state.currentSignalDirection ?? "",
        toIsoString(state.currentSignalAt) ?? "",
        state.barsSinceSignal ?? "",
        state.status ?? "",
        state.fresh === true ? "fresh" : "not-fresh",
      ].join(":");
    })
    .filter((value): value is string => Boolean(value))
    .join("|");
}

function hasPendingSignalOptionsActionableState(input: {
  states: SignalMonitorState[];
  universe: Set<string>;
  startIndex?: number;
}): boolean {
  const startIndex = clampActionCursorIndex(
    input.startIndex ?? 0,
    input.states.length,
  );
  for (let index = startIndex; index < input.states.length; index += 1) {
    const state = input.states[index];
    if (!state) {
      continue;
    }
    const symbol = normalizeSymbol(state.symbol).toUpperCase();
    if (!symbol || (input.universe.size > 0 && !input.universe.has(symbol))) {
      continue;
    }
    if (
      isSignalOptionsActionableSignalState(state) &&
      toIsoString(state.currentSignalAt)
    ) {
      return true;
    }
  }
  return false;
}

function hasUnseenSignalOptionsActionableState(input: {
  states: SignalMonitorState[];
  universe: Set<string>;
  seenSignals: Set<string>;
  startIndex?: number;
}): boolean {
  const startIndex = clampActionCursorIndex(
    input.startIndex ?? 0,
    input.states.length,
  );
  for (let index = startIndex; index < input.states.length; index += 1) {
    const state = input.states[index];
    if (!state) {
      continue;
    }
    const symbol = normalizeSymbol(state.symbol).toUpperCase();
    if (!symbol || (input.universe.size > 0 && !input.universe.has(symbol))) {
      continue;
    }
    const signalAt = toIsoString(state.currentSignalAt);
    if (!isSignalOptionsActionableSignalState(state) || !signalAt) {
      continue;
    }
    const signalKey = buildSignalKey(state, signalAt);
    if (!input.seenSignals.has(signalKey)) {
      return true;
    }
  }
  return false;
}

function orderSignalOptionsActionStates(input: {
  states: SignalMonitorState[];
  universe: Set<string>;
}): SignalMonitorState[] {
  return input.states
    .map((state, index) => {
      const symbol = normalizeSymbol(state.symbol).toUpperCase();
      const inUniverse =
        Boolean(symbol) &&
        (input.universe.size === 0 || input.universe.has(symbol));
      const signalAtMs = dateOrNull(state.currentSignalAt)?.getTime() ?? 0;
      const latestBarMs = dateOrNull(state.latestBarAt)?.getTime() ?? 0;
      const barsSinceSignal =
        typeof state.barsSinceSignal === "number" &&
        Number.isFinite(state.barsSinceSignal)
          ? state.barsSinceSignal
          : Number.POSITIVE_INFINITY;
      return {
        state,
        index,
        inUniverse,
        actionable:
          inUniverse &&
          isSignalOptionsActionableSignalState(state) &&
          Boolean(toIsoString(state.currentSignalAt)),
        signalAtMs,
        latestBarMs,
        barsSinceSignal,
      };
    })
    .filter((item) => item.inUniverse)
    .sort((left, right) => {
      if (left.actionable !== right.actionable) {
        return left.actionable ? -1 : 1;
      }
      if (left.signalAtMs !== right.signalAtMs) {
        return right.signalAtMs - left.signalAtMs;
      }
      if (left.barsSinceSignal !== right.barsSinceSignal) {
        return left.barsSinceSignal - right.barsSinceSignal;
      }
      if (left.latestBarMs !== right.latestBarMs) {
        return right.latestBarMs - left.latestBarMs;
      }
      return left.index - right.index;
    })
    .map((item) => item.state);
}

function actionCursorForDeployment(deploymentId: string) {
  return (
    signalOptionsActionCursors.get(deploymentId) ?? {
      phase: "positions" as const,
      positionSignature: "",
      positionIndex: 0,
      signalSignature: "",
      signalIndex: 0,
    }
  );
}

function rememberSignalOptionsActionCursor(input: {
  deploymentId: string;
  phase: "positions" | "signals";
  positionSignature: string;
  positionIndex: number;
  signalSignature: string;
  signalIndex: number;
}) {
  signalOptionsActionCursors.set(input.deploymentId, {
    phase: input.phase,
    positionSignature: input.positionSignature,
    positionIndex: Math.max(0, Math.floor(input.positionIndex)),
    signalSignature: input.signalSignature,
    signalIndex: Math.max(0, Math.floor(input.signalIndex)),
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

  return (
    expirations
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
            expiration && expiration.dte >= minDte && expiration.dte <= maxDte,
          ),
      )
      .sort((left, right) => {
        const targetDelta =
          Math.abs(left.dte - targetDte) - Math.abs(right.dte - targetDte);
        return targetDelta || left.dte - right.dte;
      })[0] ?? null
  );
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
  const selectedSlots = signalOptionsStrikeSlotsForRight(
    input.profile,
    input.optionRight,
  ).map((slot) => Math.min(5, Math.max(0, Math.floor(Number(slot)))));
  const preferredSlot = selectedSlots[0] ?? 3;
  const slots = [...selectedSlots];
  for (let step = 1; step <= SIGNAL_OPTIONS_FALLBACK_STRIKE_STEPS; step += 1) {
    const fallbackSlot =
      input.optionRight === "call"
        ? preferredSlot + step
        : preferredSlot - step;
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

  const spotPrice =
    input.signalPrice ?? strikes[Math.floor(strikes.length / 2)]!;
  const attemptedStrikes = new Set<number>();
  for (const slot of signalOptionsStrikeSlotsForRight(
    input.profile,
    optionRight,
  )) {
    const strike = strikes[resolveStrikeIndex({ strikes, spotPrice, slot })];
    if (strike == null || attemptedStrikes.has(strike)) {
      continue;
    }
    attemptedStrikes.add(strike);
    const quote =
      candidates.find(
        (item) => finiteNumber(asRecord(item.contract).strike) === strike,
      ) ?? null;
    if (quote) {
      return quote;
    }
  }
  return null;
}

type SignalOptionsLegacyContractAttempt = {
  slot: number;
  fallback: boolean;
  quote: SignalOptionsOptionQuote;
  orderPlan: ReturnType<typeof buildSignalOptionsShadowOrderPlan>;
  reason: string | null;
  greeks: null;
  score: null;
};

type SignalOptionsLegacyContractSelection = {
  ok: boolean;
  selectedBy: "legacy" | "fallback_legacy";
  selectedQuote: SignalOptionsOptionQuote | null;
  orderPlan: ReturnType<typeof buildSignalOptionsShadowOrderPlan> | null;
  selectedAttempt: null;
  attempts: SignalOptionsLegacyContractAttempt[];
  preferredSlot: number | null;
  selectedSlot: number | null;
  fallbackUsed: boolean;
  candidateCount: number;
  rejectedCount: number;
  fallbackReason: string | null;
  greekSelection?: SignalOptionsGreekContractSelection | null;
};

function selectSignalOptionsLegacyContractPlanFromChain(input: {
  contracts: SignalOptionsOptionQuote[];
  direction: SignalDirection;
  signalPrice: number | null;
  profile: SignalOptionsExecutionProfile;
}): SignalOptionsLegacyContractSelection {
  const optionRight = optionRightForSignal(input.direction);
  const candidates = input.contracts.filter(
    (quote) => asRecord(quote.contract).right === optionRight,
  );
  const attempts: SignalOptionsLegacyContractAttempt[] = [];
  if (!candidates.length) {
    return {
      ok: false,
      selectedBy: "legacy",
      selectedQuote: null,
      orderPlan: null,
      selectedAttempt: null,
      attempts,
      preferredSlot: null,
      selectedSlot: null,
      fallbackUsed: false,
      candidateCount: 0,
      rejectedCount: 0,
      fallbackReason: "legacy_no_candidates",
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
      selectedBy: "legacy",
      selectedQuote: null,
      orderPlan: null,
      selectedAttempt: null,
      attempts,
      preferredSlot: null,
      selectedSlot: null,
      fallbackUsed: false,
      candidateCount: candidates.length,
      rejectedCount: 0,
      fallbackReason: "legacy_no_strikes",
    };
  }

  const spotPrice =
    input.signalPrice ?? strikes[Math.floor(strikes.length / 2)]!;
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
      reason: orderPlan.ok
        ? null
        : String(orderPlan.reason || "liquidity_gate_failed"),
      greeks: null,
      score: null,
    };
    attempts.push(attempt);
    if (orderPlan.ok) {
      return {
        ok: true,
        selectedBy: "legacy",
        selectedQuote: quote,
        orderPlan,
        selectedAttempt: null,
        attempts,
        preferredSlot: slots[0] ?? null,
        selectedSlot: slot,
        fallbackUsed: attempt.fallback,
        candidateCount: candidates.length,
        rejectedCount: attempts.filter((item) => item.reason).length,
        fallbackReason: null,
      };
    }
  }

  const firstAttempt = attempts[0] ?? null;
  return {
    ok: false,
    selectedBy: "legacy",
    selectedQuote: firstAttempt?.quote ?? null,
    orderPlan: firstAttempt?.orderPlan ?? null,
    selectedAttempt: null,
    attempts,
    preferredSlot: slots[0] ?? null,
    selectedSlot: firstAttempt?.slot ?? null,
    fallbackUsed: false,
    candidateCount: candidates.length,
    rejectedCount: attempts.filter((item) => item.reason).length,
    fallbackReason: firstAttempt?.reason ?? "legacy_no_valid_contract",
  };
}

function isSignalOptionsGreekSelectorEnabled(input: {
  profile: SignalOptionsExecutionProfile;
  runtimeMode: SignalOptionsGreekSelectorRuntimeMode;
}) {
  const policy = input.profile.optionSelection.greekSelector;
  if (!policy.enabled || policy.mode === "off") {
    return false;
  }
  return policy.mode === "all" || policy.mode === input.runtimeMode;
}

function signalOptionsGreekCandidateQuotes(input: {
  contracts: SignalOptionsOptionQuote[];
  direction: SignalDirection;
  signalPrice: number | null;
  maxCandidates: number;
}) {
  const optionRight = optionRightForSignal(input.direction);
  const spot = input.signalPrice;
  return input.contracts
    .filter((quote) => asRecord(quote.contract).right === optionRight)
    .filter((quote) => finiteNumber(asRecord(quote.contract).strike) != null)
    .sort((left, right) => {
      const leftStrike = finiteNumber(asRecord(left.contract).strike) ?? 0;
      const rightStrike = finiteNumber(asRecord(right.contract).strike) ?? 0;
      const leftTicker = compactString(asRecord(left.contract).ticker) ?? "";
      const rightTicker = compactString(asRecord(right.contract).ticker) ?? "";
      if (spot != null) {
        return (
          Math.abs(leftStrike - spot) - Math.abs(rightStrike - spot) ||
          leftStrike - rightStrike ||
          leftTicker.localeCompare(rightTicker)
        );
      }
      return leftStrike - rightStrike || leftTicker.localeCompare(rightTicker);
    })
    .slice(0, input.maxCandidates);
}

function optionGreekSnapshotFromProviderQuote(input: {
  quote: SignalOptionsOptionQuote;
  entryPrice: number;
  at: Date;
}): OptionGreekSnapshot | null {
  const contract = asRecord(input.quote.contract);
  const expirationDate = dateOrNull(contract.expirationDate);
  if (!expirationDate) {
    return null;
  }
  const years = timeToExpirationYears({
    at: input.at,
    expirationDate,
  });
  const impliedVolatility = finiteNumber(input.quote.impliedVolatility);
  const delta = finiteNumber(input.quote.delta);
  const gamma = finiteNumber(input.quote.gamma);
  const theta = finiteNumber(input.quote.theta);
  const vega = finiteNumber(input.quote.vega);
  if (
    years <= 0 ||
    impliedVolatility == null ||
    impliedVolatility <= 0 ||
    delta == null ||
    gamma == null ||
    theta == null ||
    vega == null
  ) {
    return null;
  }
  return {
    price: input.entryPrice,
    delta,
    gamma,
    theta,
    vega,
    impliedVolatility,
    timeToExpirationYears: years,
  };
}

function optionGreekSnapshotForSelector(input: {
  quote: SignalOptionsOptionQuote;
  right: OptionRight;
  spot: number;
  strike: number;
  entryPrice: number;
  at: Date;
  requireLiveGreeks: boolean;
}): OptionGreekSnapshot | null {
  const providerGreeks = optionGreekSnapshotFromProviderQuote({
    quote: input.quote,
    entryPrice: input.entryPrice,
    at: input.at,
  });
  if (providerGreeks || input.requireLiveGreeks) {
    return providerGreeks;
  }
  const expirationDate = dateOrNull(asRecord(input.quote.contract).expirationDate);
  if (!expirationDate) {
    return null;
  }
  return computeOptionGreeksFromPrice({
    spot: input.spot,
    strike: input.strike,
    optionPrice: input.entryPrice,
    right: input.right,
    at: input.at,
    expirationDate,
    riskFreeRate: 0.05,
    dividendYield: 0,
  });
}

function greekSelectorFallbackReason(
  attempts: SignalOptionsGreekContractAttempt[],
  candidateCount: number,
) {
  if (candidateCount === 0) {
    return "greek_selector_no_candidates";
  }
  const reasons = attempts
    .map((attempt) => attempt.reason)
    .filter((reason): reason is string => Boolean(reason));
  if (!reasons.length) {
    return "greek_selector_no_candidates";
  }
  if (reasons.every((reason) => reason === "greek_selector_missing_greeks")) {
    return "greek_selector_missing_greeks";
  }
  if (reasons.every((reason) => reason === "greek_selector_below_min_score")) {
    return "greek_selector_below_min_score";
  }
  if (reasons.some((reason) => reason === "greek_selector_liquidity_failed")) {
    return "greek_selector_liquidity_failed";
  }
  return reasons[0] ?? "greek_selector_no_candidates";
}

function selectSignalOptionsGreekContractPlanFromChain(input: {
  contracts: SignalOptionsOptionQuote[];
  direction: SignalDirection;
  signalPrice: number | null;
  profile: SignalOptionsExecutionProfile;
  at?: Date;
}): SignalOptionsGreekContractSelection {
  const policy = input.profile.optionSelection.greekSelector;
  const at = input.at ?? new Date();
  const spot = input.signalPrice;
  if (spot == null) {
    return {
      ok: false,
      selectedBy: "greek",
      mode: policy.mode,
      selectedQuote: null,
      orderPlan: null,
      selectedAttempt: null,
      attempts: [],
      candidateCount: 0,
      rejectedCount: 0,
      fallbackReason: "greek_selector_no_candidates",
    };
  }
  const candidates = signalOptionsGreekCandidateQuotes({
    contracts: input.contracts,
    direction: input.direction,
    signalPrice: spot,
    maxCandidates: policy.maxCandidates,
  });
  const attempts: SignalOptionsGreekContractAttempt[] = [];
  const right = optionRightForSignal(input.direction);

  for (const quote of candidates) {
    const orderPlan = buildSignalOptionsShadowOrderPlan(quote, input.profile);
    if (!orderPlan.ok) {
      attempts.push({
        quote,
        orderPlan,
        greeks: null,
        score: null,
        reason: "greek_selector_liquidity_failed",
      });
      continue;
    }
    const strike = finiteNumber(asRecord(quote.contract).strike);
    const entryPrice = finiteNumber(orderPlan.simulatedFillPrice);
    if (strike == null || entryPrice == null || entryPrice <= 0) {
      attempts.push({
        quote,
        orderPlan,
        greeks: null,
        score: null,
        reason: "greek_selector_liquidity_failed",
      });
      continue;
    }
    const greeks = optionGreekSnapshotForSelector({
      quote,
      right,
      spot,
      strike,
      entryPrice,
      at,
      requireLiveGreeks: policy.requireLiveGreeks,
    });
    if (!greeks) {
      attempts.push({
        quote,
        orderPlan,
        greeks: null,
        score: null,
        reason: "greek_selector_missing_greeks",
      });
      continue;
    }
    const score = scoreOptionGreekCandidate({
      right,
      spot,
      strike,
      entryPrice,
      volume: finiteNumber(quote.volume),
      greeks,
    });
    if (score.total < policy.minScore) {
      attempts.push({
        quote,
        orderPlan,
        greeks,
        score,
        reason: "greek_selector_below_min_score",
      });
      continue;
    }
    attempts.push({
      quote,
      orderPlan,
      greeks,
      score,
      reason: null,
    });
  }

  const validAttempts = attempts
    .filter((attempt) => attempt.score && attempt.orderPlan.ok && !attempt.reason)
    .sort(
      (left, right) =>
        (right.score?.total ?? Number.NEGATIVE_INFINITY) -
          (left.score?.total ?? Number.NEGATIVE_INFINITY) ||
        (finiteNumber(asRecord(left.quote.contract).strike) ?? 0) -
          (finiteNumber(asRecord(right.quote.contract).strike) ?? 0),
    );
  const selectedAttempt = validAttempts[0] ?? null;
  return {
    ok: Boolean(selectedAttempt),
    selectedBy: "greek",
    mode: policy.mode,
    selectedQuote: selectedAttempt?.quote ?? null,
    orderPlan: selectedAttempt?.orderPlan ?? null,
    selectedAttempt,
    attempts,
    candidateCount: candidates.length,
    rejectedCount: attempts.filter((attempt) => attempt.reason).length,
    fallbackReason: selectedAttempt
      ? null
      : greekSelectorFallbackReason(attempts, candidates.length),
  };
}

function selectSignalOptionsContractPlanFromChain(input: {
  contracts: SignalOptionsOptionQuote[];
  direction: SignalDirection;
  signalPrice: number | null;
  profile: SignalOptionsExecutionProfile;
  at?: Date;
  runtimeMode?: SignalOptionsGreekSelectorRuntimeMode;
}): SignalOptionsLegacyContractSelection | SignalOptionsGreekContractSelection {
  if (
    isSignalOptionsGreekSelectorEnabled({
      profile: input.profile,
      runtimeMode: input.runtimeMode ?? "shadow",
    })
  ) {
    const greekSelection = selectSignalOptionsGreekContractPlanFromChain(input);
    if (greekSelection.ok) {
      return greekSelection;
    }
    if (!input.profile.optionSelection.greekSelector.fallbackToLegacy) {
      return greekSelection;
    }
    return {
      ...selectSignalOptionsLegacyContractPlanFromChain(input),
      selectedBy: "fallback_legacy",
      greekSelection,
      fallbackReason: greekSelection.fallbackReason,
    };
  }

  return selectSignalOptionsLegacyContractPlanFromChain(input);
}

function signalOptionsContractSelectionPayload(
  selection: ReturnType<typeof selectSignalOptionsContractPlanFromChain>,
  options?: {
    greekSelection?: SignalOptionsGreekContractSelection | null;
    selectedBy?: "greek" | "legacy" | "fallback_legacy";
  },
) {
  if (selection.selectedBy === "greek") {
    return {
      selectedBy: "greek",
      preferredSlot: null,
      selectedSlot: null,
      fallbackUsed: false,
      attempts: selection.attempts.map((attempt) => ({
        selectedContract: contractToPayload(attempt.quote),
        quote: quoteToPayload(attempt.quote),
        orderPlan: attempt.orderPlan,
        score: attempt.score,
        reason: attempt.reason,
      })),
      greekSelection: {
        mode: selection.mode,
        selectedBy: "greek",
        selectedScore: selection.selectedAttempt?.score?.total ?? null,
        selectedNotes: selection.selectedAttempt?.score?.notes ?? [],
        candidateCount: selection.candidateCount,
        rejectedCount: selection.rejectedCount,
        fallbackReason: selection.fallbackReason,
        topCandidates: selection.attempts
          .filter((attempt) => attempt.score)
          .sort(
            (left, right) =>
              (right.score?.total ?? Number.NEGATIVE_INFINITY) -
              (left.score?.total ?? Number.NEGATIVE_INFINITY),
          )
          .slice(0, 3)
          .map((attempt) => ({
            selectedContract: contractToPayload(attempt.quote),
            quote: quoteToPayload(attempt.quote),
            score: attempt.score,
            notes: attempt.score?.notes ?? [],
            reason: attempt.reason,
          })),
        attempts: selection.attempts.map((attempt) => ({
          selectedContract: contractToPayload(attempt.quote),
          quote: quoteToPayload(attempt.quote),
          score: attempt.score,
          reason: attempt.reason,
          orderPlan: attempt.orderPlan,
        })),
      },
    };
  }
  const payload: Record<string, unknown> = {
    selectedBy: options?.selectedBy ?? selection.selectedBy,
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
  const greekSelection = options?.greekSelection ?? selection.greekSelection ?? null;
  if (greekSelection) {
    const topCandidates = greekSelection.attempts
      .filter((attempt) => attempt.score)
      .sort(
        (left, right) =>
          (right.score?.total ?? Number.NEGATIVE_INFINITY) -
          (left.score?.total ?? Number.NEGATIVE_INFINITY),
      )
      .slice(0, 3);
    payload.greekSelection = {
      mode: greekSelection.mode,
      selectedBy:
        options?.selectedBy ?? (greekSelection.ok ? "greek" : "fallback_legacy"),
      selectedScore: greekSelection.selectedAttempt?.score?.total ?? null,
      selectedNotes: greekSelection.selectedAttempt?.score?.notes ?? [],
      candidateCount: greekSelection.candidateCount,
      rejectedCount: greekSelection.rejectedCount,
      fallbackReason: greekSelection.fallbackReason,
      topCandidates: topCandidates.map((attempt) => ({
        selectedContract: contractToPayload(attempt.quote),
        quote: quoteToPayload(attempt.quote),
        score: attempt.score,
        notes: attempt.score?.notes ?? [],
        reason: attempt.reason,
      })),
      attempts: greekSelection.attempts.map((attempt) => ({
        selectedContract: contractToPayload(attempt.quote),
        quote: quoteToPayload(attempt.quote),
        score: attempt.score,
        reason: attempt.reason,
        orderPlan: attempt.orderPlan,
      })),
    };
  }
  return payload;
}

function signalOptionsLiveQuoteDemandPayload(input: {
  owner: string;
  providerContractId: string;
  requiresGreeks: boolean;
  state: IbkrLiveDemandState;
  snapshotDebug?: unknown;
  hydrationAttempts?: number;
  hydrationWaitMs?: number;
}) {
  const matchedState =
    input.state.states.find(
      (item) => item.providerContractId === input.providerContractId,
    ) ?? null;
  return {
    owner: input.owner,
    underlying: input.state.underlying,
    providerContractId: input.providerContractId,
    requiresGreeks: input.requiresGreeks,
    status: matchedState?.status ?? "unavailable",
    reason: matchedState?.reason ?? "not_requested",
    cacheAgeMs: matchedState?.cacheAgeMs ?? null,
    hydrationAttempts:
      finiteNumber(input.hydrationAttempts) != null
        ? finiteNumber(input.hydrationAttempts)
        : null,
    hydrationWaitMs:
      finiteNumber(input.hydrationWaitMs) != null
        ? finiteNumber(input.hydrationWaitMs)
        : null,
    snapshotDebug: input.snapshotDebug ?? null,
    requestedProviderContractIds: input.state.states.map(
      (item) => item.providerContractId,
    ),
  };
}

function signalOptionsSelectedLiveQuoteNeedsRetry(input: {
  quote: SignalOptionsOptionQuote | null;
  orderPlan: ReturnType<typeof buildSignalOptionsShadowOrderPlan> | null;
}) {
  const freshness = normalizedQuoteStatus(input.quote?.quoteFreshness);
  if (
    !input.quote ||
    freshness === "metadata" ||
    freshness === "pending" ||
    freshness === "unavailable"
  ) {
    return true;
  }
  const reasons = asArray(asRecord(input.orderPlan?.liquidity).reasons).map(
    (reason) => compactString(reason) ?? "",
  );
  return reasons.some((reason) =>
    ["missing_bid_ask", "missing_mark", "quote_not_fresh"].includes(reason),
  );
}

function signalOptionsSelectedExpirationPayload(
  selectedExpiration: { expirationDate: Date; dte: number } | null,
) {
  if (!selectedExpiration) {
    return null;
  }
  return {
    expirationDate: selectedExpiration.expirationDate.toISOString(),
    dte: selectedExpiration.dte,
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
  const quoteFreshness = normalizedQuoteStatus(quote.quoteFreshness) ?? "";
  const blockedMarketDataMode = isBlockedLiveMarketDataMode(
    quote.marketDataMode,
  );
  const liquidityControls = profile.liquidityHaltControls;
  const quoteFresh =
    !blockedMarketDataMode &&
    (!profile.liquidityGate.requireFreshQuote ||
      liquidityControls.freshQuoteRequiredEnabled === false ||
      !["stale", "unavailable", "pending"].includes(quoteFreshness));
  const hasBidAsk =
    bid != null && ask != null && bid > 0 && ask > 0 && ask >= bid;
  const reasons: string[] = [];

  if (
    profile.liquidityGate.requireBidAsk &&
    liquidityControls.bidAskRequiredEnabled !== false &&
    !hasBidAsk
  ) {
    reasons.push("missing_bid_ask");
  }
  if (
    liquidityControls.minBidGateEnabled !== false &&
    bid != null &&
    bid < profile.liquidityGate.minBid
  ) {
    reasons.push("bid_below_minimum");
  }
  if (
    liquidityControls.spreadGateEnabled !== false &&
    spreadPctOfMid != null &&
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
    last,
    mark,
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
  const premiumQuantityCap =
    profile.riskHaltControls.premiumBudgetEnabled === false
      ? profile.riskCaps.maxContracts
      : Math.floor(
          profile.riskCaps.maxPremiumPerEntry / (simulatedFillPrice * 100),
        );
  const quantity = Math.min(profile.riskCaps.maxContracts, premiumQuantityCap);

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

function signalBarsSinceEntry(input: {
  openedAt: unknown;
  markAt: Date;
  timeframe: SignalMonitorTimeframe;
}) {
  const openedAt = dateOrNull(input.openedAt);
  if (!openedAt) {
    return null;
  }
  const timeframeMs = getSignalMonitorTimeframeMs(input.timeframe);
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    return null;
  }
  return Math.max(
    0,
    Math.floor((input.markAt.getTime() - openedAt.getTime()) / timeframeMs),
  );
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

function shouldRecordActivePositionMarkForScan(input: {
  position: Pick<SignalOptionsPosition, "lastMarkedAt">;
  markAt: Date;
}) {
  const lastMarkedAt = dateOrNull(input.position.lastMarkedAt);
  if (!lastMarkedAt) {
    return true;
  }
  return (
    input.markAt.getTime() - lastMarkedAt.getTime() >=
    SIGNAL_OPTIONS_POSITION_MARK_RECORD_INTERVAL_MS
  );
}

function signalOptionsExecutionBlocker(input: {
  dailyHaltActive: boolean;
  dailyPnl: number;
  profile: SignalOptionsExecutionProfile;
  openSymbols: number;
  positionMarkHaltActive?: boolean;
  degradedPositionSymbols?: string[];
}): SignalOptionsExecutionBlocker | null {
  if (
    input.profile.riskHaltControls.dailyLossHaltEnabled !== false &&
    input.dailyHaltActive
  ) {
    return {
      reason: "daily_loss_halt_active",
      detail: {
        dailyPnl: input.dailyPnl,
        maxDailyLoss: input.profile.riskCaps.maxDailyLoss,
      },
    };
  }
  if (
    input.profile.positionHaltControls.positionMarkFeedHaltEnabled !== false &&
    input.positionMarkHaltActive
  ) {
    const symbols = [...new Set(input.degradedPositionSymbols ?? [])].sort();
    return {
      reason: "position_mark_feed_degraded",
      detail: {
        symbols,
        count: symbols.length,
      },
    };
  }
  if (
    input.profile.riskHaltControls.openSymbolCapEnabled !== false &&
    input.openSymbols >= input.profile.riskCaps.maxOpenSymbols
  ) {
    return {
      reason: "max_open_symbols_reached",
      detail: {
        openSymbols: input.openSymbols,
        maxOpenSymbols: input.profile.riskCaps.maxOpenSymbols,
      },
    };
  }
  return null;
}

function signalOptionsGatewayExecutionBlocker(
  readiness: AlgoGatewayReadiness,
  profile?: SignalOptionsExecutionProfile,
): SignalOptionsExecutionBlocker | null {
  if (
    profile?.infrastructureHaltControls.gatewayReadinessBlockEnabled === false
  ) {
    return null;
  }
  if (readiness.ready) {
    return null;
  }
  return {
    reason: readiness.reason ?? SIGNAL_OPTIONS_GATEWAY_NOT_READY_REASON,
    detail: {
      readiness,
    },
  };
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

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number) {
  return Number(value.toFixed(1));
}

function mtfFrameCount(mtfDirections: number[]) {
  return Math.max(1, mtfDirections.length);
}

function requiredSignalOptionsMtfCount(
  value: unknown,
  mtfDirections: number[],
) {
  return Math.min(
    mtfFrameCount(mtfDirections),
    Math.max(1, Math.round(finiteNumber(value) ?? 2)),
  );
}

function signalOptionsMtfAlignmentScore(
  mtfDirections: number[],
  mtfMatches: number,
) {
  return mtfDirections.length
    ? (mtfMatches / mtfFrameCount(mtfDirections)) * 25
    : 8;
}

function signalOptionsMtfAlignmentReason(
  mtfDirections: number[],
  mtfMatches: number,
) {
  if (!mtfDirections.length) {
    return null;
  }
  if (mtfMatches === mtfDirections.length) {
    return "mtf_full_alignment";
  }
  if (mtfMatches >= Math.ceil(mtfDirections.length / 2)) {
    return "mtf_partial_alignment";
  }
  return null;
}

function signalOptionsMatrixDirectionSign(value: unknown): number | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bullish" || normalized === "buy") {
    return 1;
  }
  if (normalized === "bearish" || normalized === "sell") {
    return -1;
  }
  return null;
}

function signalOptionsMatrixMtfDirection(state: unknown): number {
  const record = asRecord(state);
  if (!Object.keys(record).length || record.active === false) {
    return 0;
  }
  const status = compactString(record.status) ?? "ok";
  if (status !== "ok") {
    return 0;
  }
  const indicator = asRecord(record.indicatorSnapshot);
  return (
    signalOptionsMatrixDirectionSign(indicator.trendDirection) ??
    signalOptionsMatrixDirectionSign(record.currentSignalDirection) ??
    0
  );
}

function buildSignalOptionsMatrixMtfDirections(
  matrixStatesByTimeframe: Map<string, Record<string, unknown>> | undefined,
) {
  if (!matrixStatesByTimeframe) {
    return null;
  }
  const mtfDirections = SIGNAL_OPTIONS_MATRIX_MTF_TIMEFRAMES.map((timeframe) =>
    signalOptionsMatrixMtfDirection(matrixStatesByTimeframe.get(timeframe)),
  );
  return mtfDirections.some((direction) => direction !== 0)
    ? mtfDirections
    : null;
}

function enrichSignalOptionsCandidateWithMatrixMtf(
  candidate: SignalOptionsCandidate,
  matrixBySymbol: Map<string, Map<string, Record<string, unknown>>>,
) {
  const symbol = normalizeSymbol(candidate.symbol).toUpperCase();
  const mtfDirections = buildSignalOptionsMatrixMtfDirections(
    matrixBySymbol.get(symbol),
  );
  if (!mtfDirections) {
    return candidate;
  }
  const signal = asRecord(candidate.signal);
  const filterState = asRecord(signal.filterState);
  const legacyMtfDirections = numericArray(filterState.mtfDirections);
  return {
    ...candidate,
    signal: {
      ...signal,
      filterState: {
        ...filterState,
        mtfDirections,
        mtfTimeframes: [...SIGNAL_OPTIONS_MATRIX_MTF_TIMEFRAMES],
        mtfSource: "signal_matrix",
        legacyMtfDirections,
      },
    },
  };
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
  const adx = finiteNumber(filterState.adx);
  const mtfDirections = numericArray(filterState.mtfDirections);
  const requiredMtfCount = requiredSignalOptionsMtfCount(
    mtfGate.requiredCount,
    mtfDirections,
  );
  const directionSign = signalDirectionSign(input.candidate.direction);
  const mtfMatches = mtfDirections.filter(
    (direction) => direction === directionSign,
  ).length;
  const entryControls = input.profile.entryHaltControls;
  const reasons: string[] = [];

  if (
    entryControls.mtfAlignmentEnabled !== false &&
    mtfGate.enabled &&
    mtfMatches < requiredMtfCount
  ) {
    reasons.push("mtf_not_aligned");
  }

  const blockedPutSymbols = new Set(
    (input.profile.entryGate.blockedPutSymbols ?? []).map((symbol) =>
      normalizeSymbol(symbol).toUpperCase(),
    ),
  );
  const symbol = normalizeSymbol(input.candidate.symbol).toUpperCase();
  if (
    entryControls.inversePutBlocklistEnabled !== false &&
    input.candidate.optionRight === "put" &&
    symbol &&
    blockedPutSymbols.has(symbol)
  ) {
    reasons.push("inverse_put_blocked");
  }

  const gate = input.profile.entryGate.bearishRegime;
  const fullyBullishMtf =
    mtfDirections.length > 0 &&
    mtfDirections.every((direction) => direction > 0);
  const bearishMtfCount = mtfDirections.filter(
    (direction) => direction < 0,
  ).length;
  const effectiveMinAdx =
    bearishMtfCount >= 2 ? Math.min(gate.minAdx, 22) : gate.minAdx;

  if (
    entryControls.bearishRegimeEnabled !== false &&
    gate.enabled &&
    input.candidate.optionRight === "put"
  ) {
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

function classifySignalOptionsEntryQuality(input: {
  candidate: SignalOptionsCandidate;
  orderPlan?: Record<string, unknown> | null;
}): SignalOptionsEntryQuality {
  const signal = asRecord(input.candidate.signal);
  const filterState = asRecord(signal.filterState);
  const mtfDirections = numericArray(filterState.mtfDirections);
  const directionSign = signalDirectionSign(input.candidate.direction);
  const mtfMatches = mtfDirections.filter(
    (direction) => direction === directionSign,
  ).length;
  const adx = finiteNumber(filterState.adx);
  const orderLiquidity = asRecord(input.orderPlan?.liquidity);
  const candidateLiquidity = asRecord(input.candidate.liquidity);
  const quote = asRecord(input.candidate.quote);
  const spreadPctOfMid = finiteNumber(
    orderLiquidity.spreadPctOfMid ??
      candidateLiquidity.spreadPctOfMid ??
      quote.spreadPctOfMid,
  );
  const barsSinceSignal = finiteNumber(signal.barsSinceSignal);
  const freshWindowBars = clampNumber(
    Math.round(finiteNumber(signal.freshWindowBars) ?? 3),
    1,
    20,
  );
  const signalFresh = signal.fresh !== false;
  const freshnessRatio =
    barsSinceSignal == null
      ? signalFresh
        ? 0.75
        : 0
      : clampNumber(1 - barsSinceSignal / freshWindowBars, 0, 1);
  const quoteFreshness = compactString(
    quote.quoteFreshness ?? quote.freshness ?? orderLiquidity.freshness,
  );
  const marketDataMode = compactString(
    quote.marketDataMode ?? orderLiquidity.marketDataMode,
  );
  const premiumAtRisk = finiteNumber(input.orderPlan?.premiumAtRisk);
  const bullishRegime =
    mtfDirections.length > 0 &&
    mtfDirections.every((direction) => direction > 0) &&
    (adx ?? 0) >= 25;
  const liquidityTier =
    spreadPctOfMid == null
      ? "standard"
      : spreadPctOfMid <= 15
        ? "strong"
        : spreadPctOfMid >= 30
          ? "weak"
          : "standard";
  const reasons: string[] = [];
  const mtfAlignmentScore = signalOptionsMtfAlignmentScore(
    mtfDirections,
    mtfMatches,
  );
  const freshnessScore = freshnessRatio * 20;
  const trendStrengthScore =
    adx == null ? 7.5 : clampNumber(adx / 25, 0, 1) * 15;
  const liquidityScore =
    liquidityTier === "strong" ? 20 : liquidityTier === "weak" ? 0 : 12;
  const riskFitScore = premiumAtRisk != null && premiumAtRisk > 0 ? 10 : 5;
  const dataQualityScore =
    quoteFreshness === "live" || marketDataMode === "live"
      ? 10
      : quoteFreshness || marketDataMode
        ? 7
        : input.candidate.status === "skipped"
          ? 3
          : 8;
  const components = {
    mtfAlignment: roundScore(mtfAlignmentScore),
    freshness: roundScore(freshnessScore),
    trendStrength: roundScore(trendStrengthScore),
    liquidity: roundScore(liquidityScore),
    riskFit: roundScore(riskFitScore),
    dataQuality: roundScore(dataQualityScore),
    total: 0,
  };
  const score = roundScore(
    mtfAlignmentScore +
      freshnessScore +
      trendStrengthScore +
      liquidityScore +
      riskFitScore +
      dataQualityScore,
  );
  components.total = score;

  const mtfAlignmentReason = signalOptionsMtfAlignmentReason(
    mtfDirections,
    mtfMatches,
  );
  if (mtfAlignmentReason) reasons.push(mtfAlignmentReason);
  if ((adx ?? 0) >= 25) reasons.push("adx_confirmed");
  if (freshnessRatio >= 0.67) reasons.push("fresh_signal");
  if (freshnessRatio <= 0.2) reasons.push("aging_signal");
  if (liquidityTier === "strong") reasons.push("strong_liquidity");
  if (liquidityTier === "weak") reasons.push("weak_liquidity");
  if (premiumAtRisk != null && premiumAtRisk > 0) reasons.push("risk_sized");

  const tier =
    score >= 75 && liquidityTier !== "weak"
      ? "high"
      : score < 50 || liquidityTier === "weak"
        ? "low"
        : "standard";

  return {
    tier,
    liquidityTier,
    score,
    reasons,
    components,
    raw: {
      barsSinceSignal,
      freshWindowBars,
      freshnessRatio: roundScore(freshnessRatio * 100),
      quoteFreshness,
      marketDataMode,
      premiumAtRisk,
    },
    adx: adx ?? null,
    mtfMatches,
    mtfDirections,
    spreadPctOfMid: spreadPctOfMid ?? null,
    bullishRegime,
  };
}

function buildCandidateFromSignal(input: {
  deployment: AlgoDeployment;
  state: SignalMonitorState;
  signalAt: string;
  signalKey?: string | null;
  freshWindowBars?: number | null;
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
    freshWindowBars: input.freshWindowBars,
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
    deploymentName: normalizeLegacyAlgoBrandText(input.deployment.name),
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
  if (!isSignalOptionsActionableSignalSnapshot(signal)) {
    return null;
  }
  const signalAt = signal.signalAt;
  const direction = signal.direction;
  if (!signalAt || !direction) {
    return null;
  }

  const symbol = normalizeSymbol(signal.symbol).toUpperCase();
  if (!symbol) {
    return null;
  }

  const action = buildSignalOptionsActionMapping(direction);
  return {
    id: buildCandidateId({
      deploymentId: input.deployment.id,
      symbol,
      direction,
      signalAt,
    }),
    deploymentId: input.deployment.id,
    deploymentName: normalizeLegacyAlgoBrandText(input.deployment.name),
    symbol,
    direction,
    optionRight: optionRightForSignal(direction),
    timeframe: signal.timeframe,
    signalAt,
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

function previewCandidateFromSignalSnapshot(input: {
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
    deploymentName: normalizeLegacyAlgoBrandText(input.deployment.name),
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
    reason: signal.actionBlocker ?? null,
    signal,
    action,
  };
}

function signalMonitorPollIntervalMs(profile: Record<string, unknown>) {
  const seconds = finiteNumber(profile.pollIntervalSeconds) ?? 60;
  return Math.min(3_600_000, Math.max(15_000, Math.round(seconds * 1000)));
}

function signalMonitorRefreshIntervalMs(profile: Record<string, unknown>) {
  const timeframe = resolveSignalMonitorTimeframe(profile.timeframe);
  return Math.max(
    signalMonitorPollIntervalMs(profile),
    getSignalMonitorTimeframeMs(timeframe),
  );
}

function stateMatchesSignalOptionsUniverse(
  state: Record<string, unknown>,
  universe: Set<string>,
) {
  const symbol = normalizeSymbol(String(state.symbol ?? "")).toUpperCase();
  return Boolean(symbol && (universe.size === 0 || universe.has(symbol)));
}

function normalizeSignalOptionsMonitorUniverseSymbols(universe: Set<string>) {
  return Array.from(
    new Set(
      Array.from(universe)
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
}

function resolveSignalOptionsMonitorFullRefresh(input: {
  universe: Set<string>;
}) {
  const symbols = normalizeSignalOptionsMonitorUniverseSymbols(input.universe);
  return {
    symbols,
    universeCount: symbols.length,
    batchSize: symbols.length,
    startIndex: 0,
    nextIndex: 0,
    capacity: symbols.length,
    fullUniverse: true,
  };
}

function resolveSignalOptionsMonitorBatch(input: {
  deploymentId: string;
  universe: Set<string>;
  profile: SignalMonitorProfileRow;
  capacity?: number;
}) {
  const uniqueSymbols = normalizeSignalOptionsMonitorUniverseSymbols(
    input.universe,
  );
  const capacity =
    input.capacity ??
    cappedSignalMonitorEvaluationProfile(input.profile).profile.maxSymbols;
  const configuredBatchSize = Math.min(
    DEFAULT_SIGNAL_OPTIONS_MONITOR_MAX_SYMBOLS,
    Math.max(0, capacity),
  );
  const batchSize = Math.min(configuredBatchSize, uniqueSymbols.length);
  const signature = uniqueSymbols.join("|");
  const cursorKey = input.deploymentId;
  const current = signalOptionsMonitorBatchCursors.get(cursorKey);
  const startIndex =
    current?.signature === signature && uniqueSymbols.length > 0
      ? current.nextIndex % uniqueSymbols.length
      : 0;

  if (!batchSize) {
    signalOptionsMonitorBatchCursors.set(cursorKey, {
      signature,
      nextIndex: startIndex,
    });
    return {
      symbols: [] as string[],
      universeCount: uniqueSymbols.length,
      batchSize: 0,
      startIndex,
      nextIndex: startIndex,
      capacity,
    };
  }

  const batch = Array.from({ length: batchSize }, (_, offset) => {
    const index = (startIndex + offset) % uniqueSymbols.length;
    return uniqueSymbols[index];
  });
  const nextIndex = (startIndex + batchSize) % uniqueSymbols.length;
  signalOptionsMonitorBatchCursors.set(cursorKey, {
    signature,
    nextIndex,
  });

  return {
    symbols: batch,
    universeCount: uniqueSymbols.length,
    batchSize,
    startIndex,
    nextIndex,
    capacity,
  };
}

function resolveSignalOptionsWorkerMonitorBatchCapacity(
  profile: SignalMonitorProfileRow,
): number {
  const profileCap = cappedSignalMonitorEvaluationProfile(profile).profile
    .maxSymbols;
  return Math.max(
    0,
    Math.min(profileCap, DEFAULT_SIGNAL_OPTIONS_WORKER_MONITOR_BATCH_SIZE),
  );
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
    .filter((state) =>
      stateMatchesSignalOptionsUniverse(state, input.universe),
    );

  if (!runtimeFallbackProfile) {
    if (!lastEvaluatedAt) {
      return true;
    }
    const maxAgeMs =
      signalMonitorRefreshIntervalMs(profile) +
      SIGNAL_OPTIONS_MONITOR_STALE_GRACE_MS;
    if (now.getTime() - lastEvaluatedAt.getTime() > maxAgeMs) {
      return true;
    }
  }

  if (input.universe.size > 0) {
    const stateSymbols = new Set(
      states
        .map((state) =>
          normalizeSymbol(String(state.symbol ?? "")).toUpperCase(),
        )
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
  source?: "manual" | "worker";
  readinessReason?: AlgoGatewayReadiness["reason"];
  signal?: AbortSignal;
}) {
  throwIfSignalOptionsScanAborted(input.signal);
  if (input.universe.size > 0) {
    const profile = await getSignalMonitorProfileRow({
      environment: input.deployment.mode,
      ensureWatchlist: true,
    });
    const hardPressureBlock = isApiResourcePressureHardBlock(
      getApiResourcePressureSnapshot(),
    );
    if (
      input.source === "worker" &&
      input.readinessReason === SIGNAL_OPTIONS_MARKET_SESSION_QUIET_REASON
    ) {
      const symbols = normalizeSignalOptionsMonitorUniverseSymbols(
        input.universe,
      );
      const evaluated = await getSignalMonitorStoredState({
        environment: input.deployment.mode,
        markNonCurrentStale: true,
      });
      throwIfSignalOptionsScanAborted(input.signal);
      return {
        ...evaluated,
        signalOptionsBatch: {
          symbols: [] as string[],
          universeCount: symbols.length,
          batchSize: 0,
          startIndex: null,
          nextIndex: null,
          capacity: resolveSignalOptionsWorkerMonitorBatchCapacity(profile),
          fullUniverse: false,
          forced: input.forceEvaluate === true,
          source: "stored_state",
          reason: SIGNAL_OPTIONS_MARKET_SESSION_QUIET_REASON,
        },
      };
    }
    const symbols = normalizeSignalOptionsMonitorUniverseSymbols(
      input.universe,
    );
    const stored = await getSignalMonitorStoredState({
      environment: input.deployment.mode,
      markNonCurrentStale: true,
    });
    throwIfSignalOptionsScanAborted(input.signal);
    if (
      input.forceEvaluate !== true &&
      !shouldRefreshSignalOptionsMonitorState({
        evaluated: stored,
        universe: input.universe,
      })
    ) {
      return {
        ...stored,
        signalOptionsBatch: {
          symbols: [] as string[],
          universeCount: symbols.length,
          batchSize: 0,
          startIndex: null,
          nextIndex: null,
          capacity: resolveSignalOptionsWorkerMonitorBatchCapacity(profile),
          fullUniverse: false,
          forced: false,
          source: "stored_state",
          reason: "current",
        },
      };
    }
    if (!hardPressureBlock) {
      const fullRefresh = resolveSignalOptionsMonitorFullRefresh({
        universe: input.universe,
      });
      const evaluated = await evaluateSignalMonitorProfileSymbols({
        profile,
        mode: "incremental",
        symbols: fullRefresh.symbols,
        maxSymbolsOverride: fullRefresh.symbols.length,
        pressureCapMode: "bypass-soft",
        evaluationConcurrencyOverride:
          SIGNAL_OPTIONS_MONITOR_FULL_REFRESH_CONCURRENCY,
        barSourcePolicy: SIGNAL_OPTIONS_MONITOR_BAR_SOURCE_POLICY,
        signal: input.signal,
      });

      return {
        ...evaluated,
        signalOptionsBatch: {
          ...fullRefresh,
          forced: input.forceEvaluate === true,
        },
      };
    }

    const batch = resolveSignalOptionsMonitorBatch({
      deploymentId: input.deployment.id,
      universe: input.universe,
      profile,
      capacity:
        input.source === "worker"
          ? resolveSignalOptionsWorkerMonitorBatchCapacity(profile)
          : undefined,
    });
    throwIfSignalOptionsScanAborted(input.signal);
    const evaluated = await evaluateSignalMonitorProfileSymbols({
      profile,
      mode: "incremental",
      symbols: batch.symbols,
      barSourcePolicy: SIGNAL_OPTIONS_MONITOR_BAR_SOURCE_POLICY,
      signal: input.signal,
    });
    const refreshedStored = await getSignalMonitorStoredState({
      environment: input.deployment.mode,
      markNonCurrentStale: true,
    }).catch((error) => {
      logger.warn?.(
        { err: error, deploymentId: input.deployment.id },
        "Failed to reload full signal monitor state after signal-options batch refresh",
      );
      return evaluated;
    });

    return {
      ...refreshedStored,
      signalOptionsBatch: {
        ...batch,
        forced: input.forceEvaluate === true,
      },
    };
  }

  return evaluateSignalMonitor({
    environment: input.deployment.mode,
    mode: "incremental",
    barSourcePolicy: SIGNAL_OPTIONS_MONITOR_BAR_SOURCE_POLICY,
  });
}

async function loadSignalOptionsMtfMatrixBySymbol(input: {
  deployment: AlgoDeployment;
  states: SignalMonitorState[];
  universe: Set<string>;
  source: "manual" | "worker";
}) {
  const symbols = [
    ...new Set(
      input.states
        .map((state) => normalizeSymbol(state.symbol).toUpperCase())
        .filter((symbol, index) => {
          if (!symbol || (input.universe.size > 0 && !input.universe.has(symbol))) {
            return false;
          }
          const state = input.states[index];
          return Boolean(state && isSignalOptionsActionableSignalState(state));
        }),
    ),
  ];
  if (!symbols.length) {
    return new Map<string, Map<string, Record<string, unknown>>>();
  }

  try {
    const matrix = await evaluateSignalMonitorMatrix({
      environment: input.deployment.mode,
      symbols,
      timeframes: [...SIGNAL_OPTIONS_MATRIX_MTF_TIMEFRAMES],
      clientRole: "manual",
      requestOrigin: input.source === "worker" ? "poll" : "manual",
    });
    const states = Array.isArray(asRecord(matrix).states)
      ? (asRecord(matrix).states as unknown[])
      : [];
    const validTimeframes = new Set<string>(SIGNAL_OPTIONS_MATRIX_MTF_TIMEFRAMES);
    const bySymbol = new Map<string, Map<string, Record<string, unknown>>>();

    states.forEach((state) => {
      const record = asRecord(state);
      const rawSymbol = compactString(record.symbol);
      const symbol = rawSymbol ? normalizeSymbol(rawSymbol).toUpperCase() : "";
      const timeframe = compactString(record.timeframe);
      if (!symbol || !timeframe || !validTimeframes.has(timeframe)) {
        return;
      }
      const symbolStates =
        bySymbol.get(symbol) ?? new Map<string, Record<string, unknown>>();
      symbolStates.set(timeframe, record);
      bySymbol.set(symbol, symbolStates);
    });

    return bySymbol;
  } catch (error) {
    logger.warn?.(
      { err: error, deploymentId: input.deployment.id, symbols },
      "Failed to load signal-options five-frame matrix MTF snapshot",
    );
    return new Map<string, Map<string, Record<string, unknown>>>();
  }
}

function candidateFromEvent(
  event: ExecutionEvent,
): SignalOptionsCandidate | null {
  const payload = asRecord(event.payload);
  const candidate = asRecord(
    Object.keys(asRecord(payload.candidate)).length
      ? payload.candidate
      : payload.automationCandidate,
  );
  const position = asRecord(payload.position);
  const hasCandidatePayload = Object.keys(candidate).length > 0;
  const payloadSelectedContract = asRecord(payload.selectedContract);
  const candidateSelectedContract = asRecord(candidate.selectedContract);
  const positionSelectedContract = asRecord(position.selectedContract);
  const signal = Object.keys(asRecord(candidate.signal)).length
    ? asRecord(candidate.signal)
    : asRecord(payload.signal);
  const action = Object.keys(asRecord(candidate.action)).length
    ? asRecord(candidate.action)
    : asRecord(payload.action);
  const signalQuality = asRecord(
    candidate.signalQuality ?? position.signalQuality,
  );
  const selectedExpiration = asRecord(payload.selectedExpiration);
  const contractSelection = asRecord(payload.contractSelection);
  const chainDebug = asRecord(payload.chainDebug);
  const expirationsDebug = asRecord(payload.expirationsDebug);
  const optionMarketDataBackoff = asRecord(payload.optionMarketDataBackoff);
  const liveQuoteDemand = asRecord(payload.liveQuoteDemand);
  const chainAttempts = Array.isArray(payload.chainAttempts)
    ? payload.chainAttempts
        .map((attempt) => asRecord(attempt))
        .filter((attempt) => Object.keys(attempt).length > 0)
    : [];
  const candidateId =
    compactString(candidate.id) ??
    compactString(payload.candidateId) ??
    compactString(position.candidateId);
  if (!candidateId && !event.symbol) {
    return null;
  }
  const direction =
    candidate.direction === "sell" || position.direction === "sell"
      ? "sell"
      : "buy";
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
  const reason = signalOptionsReadModelReason(payload);
  return normalizeLegacyAlgoBranding({
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
    timeframe: String(
      candidate.timeframe || position.timeframe || "15m",
    ) as SignalMonitorTimeframe,
    signalAt:
      toIsoString(candidate.signalAt) ??
      toIsoString(position.signalAt) ??
      toIsoString(event.occurredAt) ??
      new Date(0).toISOString(),
    signalPrice: finiteNumber(candidate.signalPrice ?? position.signalPrice),
    status,
    selectedContract: Object.keys(payloadSelectedContract).length
      ? payloadSelectedContract
      : Object.keys(candidateSelectedContract).length
        ? candidateSelectedContract
        : !hasCandidatePayload && Object.keys(positionSelectedContract).length
          ? positionSelectedContract
          : {},
    quote: asRecord(payload.quote),
    orderPlan: Object.keys(asRecord(payload.orderPlan)).length
      ? asRecord(payload.orderPlan)
      : asRecord(candidate.orderPlan),
    liquidity: asRecord(payload.liquidity),
    selectedExpiration: Object.keys(selectedExpiration).length
      ? selectedExpiration
      : null,
    contractSelection: Object.keys(contractSelection).length
      ? contractSelection
      : null,
    chainDebug: Object.keys(chainDebug).length ? chainDebug : null,
    chainAttempts,
    expirationsDebug: Object.keys(expirationsDebug).length
      ? expirationsDebug
      : null,
    optionMarketDataBackoff: Object.keys(optionMarketDataBackoff).length
      ? optionMarketDataBackoff
      : null,
    liveQuoteDemand: Object.keys(liveQuoteDemand).length
      ? liveQuoteDemand
      : null,
    reason:
      status === "skipped"
        ? reason
        : null,
    signalQuality: Object.keys(signalQuality).length
      ? (signalQuality as SignalOptionsEntryQuality)
      : null,
    signal: Object.keys(signal).length ? signal : null,
    action: Object.keys(action).length ? action : null,
  });
}

function mergeSignalOptionsCandidate(
  existing: SignalOptionsCandidate | undefined,
  candidate: SignalOptionsCandidate,
): SignalOptionsCandidate {
  const status =
    candidate.status === "candidate" &&
    existing?.status &&
    existing.status !== "candidate"
      ? existing.status
      : candidate.status;
  const reason =
    status === "skipped"
      ? candidate.reason === "candidate_resolution_timeout" &&
        existing?.reason &&
        existing.reason !== "candidate_resolution_timeout"
        ? existing.reason
        : (candidate.reason ?? existing?.reason ?? null)
      : null;
  return {
    ...(existing ?? {}),
    ...candidate,
    status,
    selectedContract: Object.keys(asRecord(candidate.selectedContract)).length
      ? candidate.selectedContract
      : (existing?.selectedContract ?? null),
    quote: Object.keys(asRecord(candidate.quote)).length
      ? candidate.quote
      : (existing?.quote ?? null),
    orderPlan: Object.keys(asRecord(candidate.orderPlan)).length
      ? candidate.orderPlan
      : (existing?.orderPlan ?? null),
    liquidity: Object.keys(asRecord(candidate.liquidity)).length
      ? candidate.liquidity
      : (existing?.liquidity ?? null),
    selectedExpiration: Object.keys(asRecord(candidate.selectedExpiration)).length
      ? candidate.selectedExpiration
      : (existing?.selectedExpiration ?? null),
    contractSelection: Object.keys(asRecord(candidate.contractSelection)).length
      ? candidate.contractSelection
      : (existing?.contractSelection ?? null),
    chainDebug: Object.keys(asRecord(candidate.chainDebug)).length
      ? candidate.chainDebug
      : (existing?.chainDebug ?? null),
    chainAttempts: candidate.chainAttempts?.length
      ? candidate.chainAttempts
      : (existing?.chainAttempts ?? []),
    expirationsDebug: Object.keys(asRecord(candidate.expirationsDebug)).length
      ? candidate.expirationsDebug
      : (existing?.expirationsDebug ?? null),
    optionMarketDataBackoff: Object.keys(
      asRecord(candidate.optionMarketDataBackoff),
    ).length
      ? candidate.optionMarketDataBackoff
      : (existing?.optionMarketDataBackoff ?? null),
    liveQuoteDemand: Object.keys(asRecord(candidate.liveQuoteDemand)).length
      ? candidate.liveQuoteDemand
      : (existing?.liveQuoteDemand ?? null),
    reason,
    signalQuality: candidate.signalQuality ?? existing?.signalQuality ?? null,
    signal: Object.keys(asRecord(candidate.signal)).length
      ? candidate.signal
      : (existing?.signal ?? null),
    action: Object.keys(asRecord(candidate.action)).length
      ? candidate.action
      : (existing?.action ?? null),
  };
}

function positionFromEntryPayload(
  event: ExecutionEvent,
): SignalOptionsPosition | null {
  const payload = asRecord(event.payload);
  const position = asRecord(payload.position);
  const candidate = asRecord(payload.candidate);
  const selectedContract = Object.keys(asRecord(payload.selectedContract))
    .length
    ? asRecord(payload.selectedContract)
    : asRecord(position.selectedContract);
  const entryPrice = finiteNumber(
    position.entryPrice ?? payload.simulatedFillPrice,
  );
  const quantity = finiteNumber(position.quantity ?? payload.quantity);
  const candidateId = String(candidate.id || position.candidateId || event.id);
  const direction =
    candidate.direction === "sell" || position.direction === "sell"
      ? "sell"
      : "buy";
  const signalAt =
    toIsoString(candidate.signalAt) ??
    toIsoString(position.signalAt) ??
    toIsoString(event.occurredAt);
  const signalQuality = asRecord(
    position.signalQuality ?? candidate.signalQuality,
  );
  const lastStop = asRecord(position.lastStop ?? payload.stop);
  const lastWireTrail = asRecord(position.lastWireTrail ?? lastStop.wireTrail);
  const entryGreeks =
    greekSnapshotFromQuote(asRecord(position.entryGreeks)) ??
    greekSnapshotFromQuote(asRecord(payload.quote)) ??
    greekSnapshotFromQuote(asRecord(candidate.quote));
  if (!event.symbol || entryPrice == null || quantity == null || !signalAt) {
    return null;
  }

  return {
    id: String(
      position.id || `${event.deploymentId ?? "deployment"}:${event.symbol}`,
    ),
    candidateId,
    symbol: event.symbol,
    direction,
    optionRight:
      candidate.optionRight === "put" ||
      position.optionRight === "put" ||
      selectedContract.right === "put"
        ? "put"
        : "call",
    timeframe: String(
      candidate.timeframe || position.timeframe || "15m",
    ) as SignalMonitorTimeframe,
    signalAt,
    openedAt:
      toIsoString(position.openedAt) ??
      toIsoString(event.occurredAt) ??
      signalAt,
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
    lastStop: Object.keys(lastStop).length ? lastStop : null,
    lastWireTrail: Object.keys(lastWireTrail).length ? lastWireTrail : null,
    signalQuality: Object.keys(signalQuality).length
      ? (signalQuality as SignalOptionsEntryQuality)
      : null,
    entryGreeks,
    greekBaselineSource:
      position.greekBaselineSource === "first_mark"
        ? "first_mark"
        : entryGreeks
          ? "entry"
          : null,
  };
}

function deriveActivePositions(events: ExecutionEvent[]) {
  const positions = new Map<string, SignalOptionsPosition>();
  const closedCandidateIds = new Set<string>();
  const closedPositionIds = new Set<string>();
  [...events]
    .sort(
      (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
    )
    .forEach((event) => {
      const symbol = normalizeSymbol(event.symbol ?? "").toUpperCase();
      if (!symbol) {
        return;
      }
      if (event.eventType === SIGNAL_OPTIONS_ENTRY_EVENT) {
        const position = positionFromEntryPayload(event);
        if (position) {
          closedCandidateIds.delete(position.candidateId);
          closedPositionIds.delete(position.id);
          positions.set(symbol, position);
        }
        return;
      }
      if (event.eventType === SIGNAL_OPTIONS_EXIT_EVENT) {
        if (!signalOptionsExitEventHasActionableOptionSession(event)) {
          return;
        }
        const payload = asRecord(event.payload);
        const position = asRecord(payload.position);
        const candidateId = positionCandidateIdFromPayload(payload);
        if (candidateId) {
          closedCandidateIds.add(candidateId);
        }
        const positionId = compactString(position.id);
        if (positionId) {
          closedPositionIds.add(positionId);
        }
        positions.delete(symbol);
        return;
      }
      const isPositionMarkSkip =
        event.eventType === SIGNAL_OPTIONS_SKIPPED_EVENT &&
        isSignalOptionsPositionMarkSkipReason(
          compactString(
            asRecord(event.payload).reason ??
              asRecord(event.payload).skipReason,
          ),
        );
      if (event.eventType === SIGNAL_OPTIONS_MARK_EVENT || isPositionMarkSkip) {
        const payload = asRecord(event.payload);
        const position = asRecord(payload.position);
        const current = positions.get(symbol);
        if (current && isPositionMarkSkip) {
          return;
        }
        if (current) {
          current.peakPrice =
            finiteNumber(position.peakPrice) ?? current.peakPrice;
          current.stopPrice =
            finiteNumber(position.stopPrice) ?? current.stopPrice;
          current.lastMarkPrice =
            finiteNumber(position.lastMarkPrice) ?? current.lastMarkPrice;
          current.lastMarkedAt =
            toIsoString(position.lastMarkedAt) ??
            toIsoString(event.occurredAt) ??
            current.lastMarkedAt;
          const lastStop = asRecord(position.lastStop ?? payload.stop);
          const lastWireTrail = asRecord(
            position.lastWireTrail ?? lastStop.wireTrail,
          );
          current.lastStop = Object.keys(lastStop).length
            ? lastStop
            : (current.lastStop ?? null);
          current.lastWireTrail = Object.keys(lastWireTrail).length
            ? lastWireTrail
            : (current.lastWireTrail ?? null);
          current.entryGreeks =
            greekSnapshotFromQuote(asRecord(position.entryGreeks)) ??
            current.entryGreeks ??
            greekSnapshotFromQuote(asRecord(payload.quote));
          current.greekBaselineSource =
            position.greekBaselineSource === "first_mark" ||
            position.greekBaselineSource === "entry"
              ? position.greekBaselineSource
              : current.greekBaselineSource;
          return;
        }

        if (isPositionMarkSkip) {
          return;
        }

        const recovered = positionFromEntryPayload(event);
        if (
          recovered &&
          !closedCandidateIds.has(recovered.candidateId) &&
          !closedPositionIds.has(recovered.id)
        ) {
          positions.set(symbol, recovered);
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

function isSignalOptionsReplayEvent(event: ExecutionEvent) {
  const payload = asRecord(event.payload);
  const metadata = asRecord(payload.metadata);
  const replay = asRecord(payload.replay);
  const backfill = asRecord(payload.backfill);
  return (
    compactString(metadata.sourceType) === SIGNAL_OPTIONS_REPLAY_SOURCE ||
    compactString(metadata.runSource) === SIGNAL_OPTIONS_REPLAY_SOURCE ||
    compactString(metadata.runMode) === "replay" ||
    compactString(replay.source) === SIGNAL_OPTIONS_REPLAY_SOURCE ||
    compactString(backfill.source) === SIGNAL_OPTIONS_REPLAY_SOURCE
  );
}

function runtimeSignalOptionsEvents(events: ExecutionEvent[]) {
  return signalOptionsEvents(events).filter(
    (event) => !isSignalOptionsReplayEvent(event),
  );
}

function positionCandidateIdFromPayload(payload: Record<string, unknown>) {
  const candidate = asRecord(payload.candidate);
  const position = asRecord(payload.position);
  return (
    compactString(candidate.id) ??
    compactString(payload.candidateId) ??
    compactString(position.candidateId)
  );
}

function filterOrphanPositionMarkEvents(
  events: ExecutionEvent[],
  activePositions: SignalOptionsPosition[],
) {
  const activeCandidateIds = new Set(
    activePositions
      .map((position) => compactString(position.candidateId))
      .filter((value): value is string => Boolean(value)),
  );
  const activeSymbols = new Set(
    activePositions
      .map((position) => normalizeSymbol(position.symbol).toUpperCase())
      .filter(Boolean),
  );

  return events.filter((event) => {
    if (event.eventType !== SIGNAL_OPTIONS_SKIPPED_EVENT) {
      return true;
    }
    const payload = asRecord(event.payload);
    const reason = compactString(payload.reason ?? payload.skipReason);
    if (!isSignalOptionsPositionMarkSkipReason(reason)) {
      return true;
    }
    const candidateId = positionCandidateIdFromPayload(payload);
    if (candidateId) {
      return activeCandidateIds.has(candidateId);
    }
    const symbol = normalizeSymbol(event.symbol ?? "").toUpperCase();
    return Boolean(symbol && activeSymbols.has(symbol));
  });
}

function stateSignalOptionsEvents(events: ExecutionEvent[]) {
  const runtimeEvents = runtimeSignalOptionsEvents(events);
  const activePositions = deriveActivePositions(runtimeEvents);
  return {
    signalEvents: filterOrphanPositionMarkEvents(
      runtimeEvents,
      activePositions,
    ),
    activePositions,
  };
}

const SIGNAL_OPTIONS_CONTROL_UPDATE_EVENT_TYPES = new Set([
  "signal_options_profile_updated",
  "deployment_strategy_settings_updated",
]);

function latestSignalOptionsControlUpdatedAt(events: ExecutionEvent[]) {
  return events.reduce<Date | null>((latest, event) => {
    if (!SIGNAL_OPTIONS_CONTROL_UPDATE_EVENT_TYPES.has(event.eventType)) {
      return latest;
    }
    if (!latest || event.occurredAt.getTime() > latest.getTime()) {
      return event.occurredAt;
    }
    return latest;
  }, null);
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
        isSameUtcDate(event.occurredAt, now) &&
        signalOptionsExitEventHasActionableOptionSession(event),
    )
    .reduce(
      (sum, event) => sum + (finiteNumber(asRecord(event.payload).pnl) ?? 0),
      0,
    );
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
      sum + (markPrice - position.entryPrice) * position.quantity * multiplier
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
    current.sourceType &&
    next.sourceType &&
    current.sourceType !== next.sourceType
      ? "mixed"
      : (current.sourceType ?? next.sourceType);
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
      sourceType === "mixed"
        ? "mixed"
        : (current.attributionStatus ?? next.attributionStatus),
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
    const sourceEventId = order.sourceEventId
      ? String(order.sourceEventId)
      : null;
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

function shadowLinkClosesPosition(
  shadowLink: SignalOptionsShadowLink | null | undefined,
) {
  const positionQuantity = finiteNumber(shadowLink?.positionQuantity);
  return positionQuantity != null && positionQuantity <= 0;
}

function positionOpenedInActionableOptionSession(
  position: SignalOptionsPosition,
) {
  const openedAt = dateOrNull(position.openedAt);
  return openedAt
    ? isLiveOptionTradingSession(openedAt, position.selectedContract)
    : true;
}

function reconcileActivePositionsWithShadowLinks(
  positions: SignalOptionsPosition[],
  shadowIndex: SignalOptionsShadowIndex,
) {
  return positions.filter((position) => {
    const candidateId = compactString(position.candidateId);
    if (!candidateId) {
      return positionOpenedInActionableOptionSession(position);
    }
    const shadowLink = shadowIndex.byCandidateId.get(candidateId);
    if (shadowLinkClosesPosition(shadowLink)) {
      return false;
    }
    if (!shadowLink && !positionOpenedInActionableOptionSession(position)) {
      return false;
    }
    return true;
  });
}

async function reconcileActivePositionsWithShadowLedger(input: {
  positions: SignalOptionsPosition[];
  events: ExecutionEvent[];
}) {
  if (!input.positions.length) {
    return input.positions;
  }
  const shadowIndex = await buildSignalOptionsShadowIndex(input.events);
  return reconcileActivePositionsWithShadowLinks(input.positions, shadowIndex);
}

const RETRYABLE_SIGNAL_OPTION_SKIP_REASONS = new Set([
  "candidate_resolution_failed",
  "candidate_resolution_timeout",
  "no_contract_for_strike_slot",
  "no_expiration_in_dte_window",
  "option_chain_backoff",
  "option_expiration_backoff",
]);

const FORCE_RETRYABLE_SIGNAL_OPTION_SKIP_REASONS = new Set([
  "after_hours_option_entry_blocked",
  "after_hours_option_exit_blocked",
  "candidate_resolution_failed",
  "candidate_resolution_timeout",
  "missing_bid_ask",
  "missing_mark",
  "no_contract_for_strike_slot",
  "no_expiration_in_dte_window",
  "option_chain_backoff",
  "option_expiration_backoff",
  "position_mark_failed",
  "position_mark_timeout",
  "position_mark_unavailable",
  "quote_not_fresh",
  "spread_too_wide",
]);

const EXECUTION_BLOCKER_SKIP_REASONS = new Set([
  "daily_loss_halt_active",
  "max_open_symbols_reached",
  "position_mark_feed_degraded",
]);

const GATEWAY_READINESS_SKIP_REASONS = new Set([
  SIGNAL_OPTIONS_GATEWAY_NOT_READY_REASON,
  SIGNAL_OPTIONS_MARKET_SESSION_QUIET_REASON,
  "accounts_unavailable",
  "bridge_health_unavailable",
  "bridge_unavailable",
  "gateway_login_required",
  "gateway_not_ready",
  "gateway_socket_disconnected",
  "ibkr_not_configured",
  "live_market_data_not_configured",
]);

type SignalOptionsChainAttempt = {
  source: "bounded";
  strikeCoverage: "standard";
  strikesAroundMoney: number;
  contractCount: number;
  selectedQuote: boolean;
  chainDebug: unknown;
};

type SignalOptionsContractQuoteHydration = "metadata" | "snapshot";

type SignalOptionsLiveQuoteDemandConfig = {
  owner: string;
  intent?: IbkrLiveDemandDeclaration["intent"];
  ttlMs?: IbkrLiveDemandDeclaration["ttlMs"];
  fallbackProvider?: IbkrLiveDemandDeclaration["fallbackProvider"];
  requiresGreeks?: boolean;
};

type SignalOptionsGreekSelectorRuntimeMode = "shadow" | "live";

type SignalOptionsGreekContractAttempt = {
  quote: SignalOptionsOptionQuote;
  orderPlan: ReturnType<typeof buildSignalOptionsShadowOrderPlan>;
  greeks: OptionGreekSnapshot | null;
  score: OptionGreekScore | null;
  reason: string | null;
};

type SignalOptionsGreekContractSelection = {
  ok: boolean;
  selectedBy: "greek";
  mode: SignalOptionsExecutionProfile["optionSelection"]["greekSelector"]["mode"];
  selectedQuote: SignalOptionsOptionQuote | null;
  orderPlan: ReturnType<typeof buildSignalOptionsShadowOrderPlan> | null;
  selectedAttempt: SignalOptionsGreekContractAttempt | null;
  attempts: SignalOptionsGreekContractAttempt[];
  candidateCount: number;
  rejectedCount: number;
  fallbackReason: string | null;
};

const RETRYABLE_OPTION_DEBUG_REASONS = new Set([
  "durable_option_chain_after_upstream_failure",
  "durable_option_expirations_after_upstream_failure",
  "option_expirations_degraded_empty",
  "options_backoff",
  "options_degraded_empty",
  "options_upstream_failure",
]);

function optionBackoffFromDebug(input: {
  debug: unknown;
  reason: SignalOptionsOptionBackoffReason;
  source: SignalOptionsOptionBackoff["source"];
}): SignalOptionsOptionBackoff | null {
  const debug = asRecord(input.debug);
  const debugReason = compactString(debug.reason);
  if (
    debugReason !== SIGNAL_OPTIONS_OPTION_BACKOFF_DEBUG_REASON &&
    !(debugReason && RETRYABLE_OPTION_DEBUG_REASONS.has(debugReason))
  ) {
    return null;
  }
  return {
    reason: input.reason,
    source: input.source,
    debugReason,
    backoffRemainingMs: optionalFiniteNumber(debug.backoffRemainingMs),
  };
}

function optionChainBackoffFromAttempts(
  attempts: Array<{
    contractCount: number;
    chainDebug: unknown;
  }>,
): SignalOptionsOptionBackoff | null {
  if (attempts.some((attempt) => attempt.contractCount > 0)) {
    return null;
  }
  const backoffs = attempts
    .map((attempt) =>
      optionBackoffFromDebug({
        debug: attempt.chainDebug,
        reason: "option_chain_backoff",
        source: "chain",
      }),
    )
    .filter((backoff): backoff is SignalOptionsOptionBackoff =>
      Boolean(backoff),
    );
  if (!backoffs.length) {
    return null;
  }
  return backoffs.reduce((selected, candidate) =>
    (candidate.backoffRemainingMs ?? 0) > (selected.backoffRemainingMs ?? 0)
      ? candidate
      : selected,
  );
}

function optionBackoffPayload(backoff: SignalOptionsOptionBackoff) {
  return {
    retryable: true,
    optionMarketDataBackoff: backoff,
  };
}

function signalOptionsPositionMatchesCandidate(input: {
  position: SignalOptionsPosition;
  candidate: Record<string, unknown>;
}) {
  const positionSymbol = normalizeSymbol(input.position.symbol).toUpperCase();
  const candidateSymbol = normalizeSymbol(
    String(input.candidate.symbol ?? ""),
  ).toUpperCase();
  const candidateDirection =
    input.candidate.direction === "sell" ? "sell" : "buy";
  return (
    positionSymbol === candidateSymbol &&
    input.position.direction === candidateDirection
  );
}

function skipPayloadHasSelectedContract(payload: Record<string, unknown>) {
  return (
    Object.keys(asRecord(payload.selectedContract)).length > 0 ||
    Object.keys(asRecord(asRecord(payload.candidate).selectedContract)).length >
      0
  );
}

function skipPayloadHasSignalMatrixMtf(payload: Record<string, unknown>) {
  const candidate = asRecord(payload.candidate);
  const candidateSignal = asRecord(candidate.signal);
  const signal = Object.keys(candidateSignal).length
    ? candidateSignal
    : asRecord(payload.signal);
  const filterState = asRecord(signal.filterState);
  return (
    compactString(filterState.mtfSource) === "signal_matrix" &&
    numericArray(filterState.mtfDirections).length >=
      SIGNAL_OPTIONS_MATRIX_MTF_TIMEFRAMES.length
  );
}

function skipReasonDisabledByProfile(
  reason: string,
  profile: SignalOptionsExecutionProfile,
) {
  return (
    reason === "daily_loss_halt_active" &&
    profile.riskHaltControls.dailyLossHaltEnabled === false
  );
}

function skipEventDisabledByProfile(
  event: ExecutionEvent,
  profile: SignalOptionsExecutionProfile,
) {
  if (event.eventType !== SIGNAL_OPTIONS_SKIPPED_EVENT) {
    return false;
  }
  const payload = asRecord(event.payload);
  const reason = compactString(payload.reason ?? payload.skipReason);
  return Boolean(reason && skipReasonDisabledByProfile(reason, profile));
}

function isRetryableSignalOptionsSkip(
  event: ExecutionEvent,
  options?: {
    activePositions?: SignalOptionsPosition[];
    currentPremiumCap?: number | null;
    dailyLossHaltEnabled?: boolean;
    premiumBudgetEnabled?: boolean;
    forceRetryMarketData?: boolean;
    gatewayReady?: boolean;
    gatewayReadinessBlockEnabled?: boolean;
    contractResolutionBackoffEnabled?: boolean;
    profileUpdatedAt?: Date | null;
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
  const occurredAt = dateOrNull(event.occurredAt);
  if (
    occurredAt &&
    options?.profileUpdatedAt &&
    occurredAt.getTime() <= options.profileUpdatedAt.getTime()
  ) {
    return true;
  }

  if (
    reason === "daily_loss_halt_active" &&
    options?.dailyLossHaltEnabled === false
  ) {
    return true;
  }

  if (
    payload.retryable === true &&
    FORCE_RETRYABLE_SIGNAL_OPTION_SKIP_REASONS.has(reason)
  ) {
    return true;
  }

  if (
    payload.preflight === true &&
    GATEWAY_READINESS_SKIP_REASONS.has(reason)
  ) {
    return (
      options?.gatewayReadinessBlockEnabled === false ||
      options?.gatewayReady === true
    );
  }

  if (EXECUTION_BLOCKER_SKIP_REASONS.has(reason)) {
    return !skipPayloadHasSelectedContract(payload);
  }

  if (GATEWAY_READINESS_SKIP_REASONS.has(reason)) {
    return (
      options?.gatewayReadinessBlockEnabled === false ||
      options?.gatewayReady === true ||
      !skipPayloadHasSelectedContract(payload)
    );
  }

  if (reason === "premium_budget_too_small") {
    if (options?.premiumBudgetEnabled === false) {
      return true;
    }
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

  if (
    options?.forceRetryMarketData &&
    (reason === "mtf_not_aligned" ||
      reason === "greek_selector_no_candidates") &&
    !skipPayloadHasSignalMatrixMtf(payload)
  ) {
    return true;
  }

  if (reason === "candidate_resolution_timeout") {
    return true;
  }

  if (
    options?.contractResolutionBackoffEnabled === false &&
    (reason === "option_chain_backoff" ||
      reason === "option_expiration_backoff")
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
    dailyLossHaltEnabled?: boolean;
    premiumBudgetEnabled?: boolean;
    forceRetryMarketData?: boolean;
    gatewayReady?: boolean;
    gatewayReadinessBlockEnabled?: boolean;
    contractResolutionBackoffEnabled?: boolean;
    profileUpdatedAt?: Date | null;
  },
) {
  return new Set(
    runtimeSignalOptionsEvents(events)
      .filter((event) => !isRetryableSignalOptionsSkip(event, options))
      .filter(
        (event) =>
          (event.eventType !== SIGNAL_OPTIONS_ENTRY_EVENT ||
            signalOptionsEntryEventHasActionableOptionSession(event)) &&
          (event.eventType !== SIGNAL_OPTIONS_EXIT_EVENT ||
            signalOptionsExitEventHasActionableOptionSession(event)),
      )
      .map((event) => asRecord(event.payload).signalKey)
      .filter(
        (signalKey): signalKey is string => typeof signalKey === "string",
      ),
  );
}

function mergeProfilePatch(
  current: SignalOptionsExecutionProfile,
  patch: Record<string, unknown>,
) {
  const patchOptionSelection = asRecord(patch.optionSelection);
  return resolveSignalOptionsExecutionProfile({
    ...current,
    ...patch,
    optionSelection: {
      ...current.optionSelection,
      ...patchOptionSelection,
      greekSelector: {
        ...current.optionSelection.greekSelector,
        ...asRecord(patchOptionSelection.greekSelector),
        ...asRecord(patch.greekSelector),
      },
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
    riskHaltControls: {
      ...current.riskHaltControls,
      ...asRecord(patch.riskHaltControls),
    },
    entryHaltControls: {
      ...current.entryHaltControls,
      ...asRecord(patch.entryHaltControls),
    },
    liquidityHaltControls: {
      ...current.liquidityHaltControls,
      ...asRecord(patch.liquidityHaltControls),
    },
    positionHaltControls: {
      ...current.positionHaltControls,
      ...asRecord(patch.positionHaltControls),
    },
    infrastructureHaltControls: {
      ...current.infrastructureHaltControls,
      ...asRecord(patch.infrastructureHaltControls),
    },
  });
}

function signalOptionsRawPayloadReason(payload: Record<string, unknown>) {
  return compactString(payload.reason) ?? compactString(payload.skipReason);
}

function signalOptionsNestedDebugReason(
  payload: Record<string, unknown>,
  key: "expirationsDebug" | "chainDebug",
) {
  const direct = compactString(asRecord(payload[key]).reason);
  if (direct) {
    return direct;
  }
  return compactString(asRecord(asRecord(payload.detail)[key]).reason);
}

function signalOptionsRetryableDebugReason(
  payload: Record<string, unknown>,
  key: "expirationsDebug" | "chainDebug",
) {
  const debugReason = signalOptionsNestedDebugReason(payload, key);
  return debugReason && RETRYABLE_OPTION_DEBUG_REASONS.has(debugReason)
    ? debugReason
    : null;
}

function signalOptionsReadModelReason(payload: Record<string, unknown>) {
  const reason = signalOptionsRawPayloadReason(payload);
  if (
    reason === "no_expiration_in_dte_window" &&
    signalOptionsRetryableDebugReason(payload, "expirationsDebug")
  ) {
    return "option_expiration_backoff";
  }
  if (
    reason === "no_contract_for_strike_slot" &&
    signalOptionsRetryableDebugReason(payload, "chainDebug")
  ) {
    return "option_chain_backoff";
  }
  return reason;
}

function signalOptionsReadModelSummary(input: {
  event: ExecutionEvent;
  reason: string | null;
}) {
  const payload = asRecord(input.event.payload);
  const rawReason = signalOptionsRawPayloadReason(payload);
  if (
    input.reason &&
    rawReason &&
    input.reason !== rawReason &&
    input.event.eventType === SIGNAL_OPTIONS_SKIPPED_EVENT
  ) {
    const symbol =
      normalizeSymbol(
        compactString(input.event.symbol) ??
          compactString(asRecord(payload.candidate).symbol) ??
          "",
      ).toUpperCase() || "Signal-options";
    return `${symbol} shadow candidate skipped: ${input.reason}`;
  }
  return normalizeLegacyAlgoBrandText(input.event.summary);
}

function eventTimelineItem(
  event: ExecutionEvent,
  shadowLink?: SignalOptionsShadowLink,
) {
  const payload = asRecord(event.payload);
  const reason = signalOptionsReadModelReason(payload);
  const changedFields = Array.isArray(payload.changedFields)
    ? payload.changedFields.filter(
        (field): field is string => typeof field === "string",
      )
    : [];
  return {
    id: event.id,
    source: "event",
    type: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    summary: signalOptionsReadModelSummary({ event, reason }),
    reason,
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
  const hasShadowFill = Boolean(
    input.shadowLink?.fillId || input.shadowLink?.orderId,
  );
  const plannedQuantity = finiteNumber(
    asRecord(input.candidate.orderPlan).quantity,
  );
  const positionQuantity = finiteNumber(input.shadowLink?.positionQuantity);

  if (hasExit) {
    return {
      actionStatus:
        positionQuantity != null && positionQuantity > 0
          ? "partial_shadow"
          : "closed",
      syncStatus: hasShadowFill ? "synced" : "event_only",
    };
  }
  if (
    hasEntry &&
    hasShadowFill &&
    positionQuantity != null &&
    positionQuantity <= 0
  ) {
    return { actionStatus: "closed", syncStatus: "synced" };
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
  if (hasSkip) {
    return { actionStatus: "blocked", syncStatus: "synced" };
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

function isMarketSessionQuietReadiness(readiness: AlgoGatewayReadiness): boolean {
  return readiness.reason === SIGNAL_OPTIONS_MARKET_SESSION_QUIET_REASON;
}

function formatSignalOptionsScanAge(ageMs: number | null): string | null {
  if (ageMs == null || !Number.isFinite(ageMs)) {
    return null;
  }
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`;
}

function markSignalOptionsScanActive(
  deploymentId: string,
  startedAt = new Date(),
) {
  activeScanDeploymentIds.add(deploymentId);
  activeScanStartedAtByDeploymentId.set(deploymentId, startedAt);
}

function clearSignalOptionsScanActive(deploymentId: string) {
  activeScanDeploymentIds.delete(deploymentId);
  activeScanStartedAtByDeploymentId.delete(deploymentId);
}

function signalOptionsActiveScanState(deploymentId: string, now = new Date()) {
  const activeRun = activeSignalOptionsRunMetadata.get(deploymentId) ?? null;
  const activeRunStartedAtMs = Date.parse(String(activeRun?.startedAt ?? ""));
  const startedAt =
    activeScanStartedAtByDeploymentId.get(deploymentId) ??
    (Number.isFinite(activeRunStartedAtMs)
      ? new Date(activeRunStartedAtMs)
      : null);
  const running = activeScanDeploymentIds.has(deploymentId);
  const ageMs =
    running && startedAt
      ? Math.max(0, now.getTime() - startedAt.getTime())
      : null;
  return {
    running,
    startedAt,
    ageMs,
    source: activeRun?.source ?? null,
    runId: activeRun?.runId ?? null,
    phase: activeRun?.phase ?? null,
    lastSignalScanAt: activeRun?.lastSignalScanAt ?? null,
    latestSignalBarAt: activeRun?.latestSignalBarAt ?? null,
    heavyWorkDeferred: activeRun?.heavyWorkDeferred === true,
  };
}

function signalOptionsScanAlreadyRunningResponse(input: {
  deploymentId: string;
  source?: "manual" | "worker";
}) {
  const scanState = signalOptionsActiveScanState(input.deploymentId);
  return {
    status: "already_running",
    skipped: true,
    reason: "signal_options_scan_running",
    message: "A signal-options scan is already running for this deployment.",
    requestedBy: input.source ?? "manual",
    activeScan: {
      running: scanState.running,
      startedAt: scanState.startedAt?.toISOString() ?? null,
      ageMs: scanState.ageMs,
      source: scanState.source,
      runId: scanState.runId,
      phase: scanState.phase,
      lastSignalScanAt: scanState.lastSignalScanAt,
      latestSignalBarAt: scanState.latestSignalBarAt,
      heavyWorkDeferred: scanState.heavyWorkDeferred,
    },
    signals: [],
    candidates: [],
    summary: {
      signalCount: 0,
      freshSignalCount: 0,
      staleSignalCount: 0,
      unavailableSignalCount: 0,
      latestSignalBarAt: null,
      oldestSignalBarAt: null,
      lastSignalScanAt: null,
      signalSourcePolicy: SIGNAL_OPTIONS_SIGNAL_SOURCE_POLICY,
      heavyWorkDeferred: scanState.heavyWorkDeferred,
      activeScanPhase: scanState.phase,
      candidateCount: 0,
      blockedCandidateCount: 0,
      batch: null,
    },
  };
}

function signalOptionsPressurePauseState(
  deploymentId: string,
  now = new Date(),
) {
  const deployment = getSignalOptionsWorkerSnapshot().deployments.find(
    (entry) => entry.deploymentId === deploymentId,
  );
  const record = asRecord(deployment);
  const paused =
    record.pressurePaused === true &&
    String(record.lastSkipReason ?? "") === "resource_pressure";
  const startedAtMs = paused
    ? Date.parse(
        String(record.pressurePauseStartedAt ?? record.lastSkippedAt ?? ""),
      )
    : Number.NaN;
  const startedAt = Number.isFinite(startedAtMs) ? new Date(startedAtMs) : null;
  const ageMs =
    paused && startedAt
      ? Math.max(0, now.getTime() - startedAt.getTime())
      : null;
  return {
    paused,
    startedAt,
    ageMs,
    reason: paused ? "resource_pressure" : null,
  };
}

function signalOptionsWorkerDeploymentState(
  deploymentId: string,
  now = new Date(),
) {
  const deployment = getSignalOptionsWorkerSnapshot().deployments.find(
    (entry) => entry.deploymentId === deploymentId,
  );
  const record = asRecord(deployment);
  const nextDueAt = dateOrNull(record.nextScanDueAt);
  const pollIntervalMs = finiteNumber(record.pollIntervalMs);
  const lastBatchSize = finiteNumber(record.lastBatchSize);
  const lastBatchUniverseCount = finiteNumber(record.lastBatchUniverseCount);
  const nextDueInMs =
    nextDueAt && !activeScanDeploymentIds.has(deploymentId)
      ? Math.max(0, nextDueAt.getTime() - now.getTime())
      : null;

  return {
    nextDueAt,
    nextDueInMs,
    pollIntervalMs,
    lastBatchSymbols: Array.isArray(record.lastBatchSymbols)
      ? record.lastBatchSymbols
          .map((symbol) => normalizeSymbol(String(symbol)).toUpperCase())
          .filter(Boolean)
      : [],
    lastBatchSize,
    lastBatchUniverseCount,
    lastBatchStartIndex: finiteNumber(record.lastBatchStartIndex),
    lastBatchNextIndex: finiteNumber(record.lastBatchNextIndex),
    lastBatchCapacity: finiteNumber(record.lastBatchCapacity),
    lastBatchFullUniverse: record.lastBatchFullUniverse === true,
    lastLatestSignalBarAt: compactString(record.lastLatestSignalBarAt),
    lastSignalScanAt: compactString(record.lastSignalScanAt),
    lastSignalSourcePolicy: compactString(record.lastSignalSourcePolicy),
    lastHeavyWorkDeferred: record.lastHeavyWorkDeferred === true,
    lastActiveScanPhase: compactString(record.lastActiveScanPhase),
    lastResourcePressureLevel: compactString(record.lastResourcePressureLevel),
    lastSkipReason:
      typeof record.lastSkipReason === "string" ? record.lastSkipReason : null,
  };
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

function isPositionMarkStale(
  position: SignalOptionsPosition,
  now = new Date(),
) {
  const markedAt = dateOrNull(position.lastMarkedAt);
  return Boolean(markedAt && now.getTime() - markedAt.getTime() > 15 * 60_000);
}

function candidateSkipCategory(candidate: { reason?: unknown }) {
  const reason = compactString(candidate.reason);
  return reason ? classifySignalOptionsSkipReason(reason) : "other";
}

function candidateMatchesSkipCategories(
  candidate: { reason?: unknown },
  categories: string[],
) {
  return categories.includes(candidateSkipCategory(candidate));
}

const COCKPIT_ACTIONABLE_BLOCKER_LOOKBACK_MS = 45 * 60_000;
const COCKPIT_ACTIONABLE_BLOCKER_FUTURE_SKEW_MS = 5 * 60_000;

function candidateIsBlocked(candidate: {
  actionStatus?: SignalOptionsActionStatus;
  status?: SignalOptionsRuntimeStatus;
}) {
  return candidate.actionStatus === "blocked" || candidate.status === "skipped";
}

function candidateIsCurrentCockpitBlocker(
  candidate: SignalOptionsCandidate & {
    actionStatus?: SignalOptionsActionStatus;
  },
  referenceAt: Date | null,
  profileUpdatedAt: Date | null,
) {
  if (!candidateIsBlocked(candidate)) {
    return false;
  }
  if (candidateSkipCategory(candidate) === "signal_policy") {
    return false;
  }
  const occurredAt = dateOrNull(candidateLatestActivityAt(candidate));
  if (
    occurredAt &&
    profileUpdatedAt &&
    occurredAt.getTime() <= profileUpdatedAt.getTime()
  ) {
    return false;
  }
  if (!occurredAt || !referenceAt) {
    return true;
  }
  const ageMs = referenceAt.getTime() - occurredAt.getTime();
  return (
    ageMs >= -COCKPIT_ACTIONABLE_BLOCKER_FUTURE_SKEW_MS &&
    ageMs <= COCKPIT_ACTIONABLE_BLOCKER_LOOKBACK_MS
  );
}

function candidateHasFreshPositionMark(
  candidate: SignalOptionsCandidate,
  activePositions: SignalOptionsPosition[],
  referenceAt: Date | null,
) {
  if (candidateSkipCategory(candidate) !== "marking") {
    return false;
  }
  const symbol = normalizeSymbol(candidate.symbol).toUpperCase();
  if (!symbol) {
    return false;
  }
  return activePositions.some(
    (position) =>
      normalizeSymbol(position.symbol).toUpperCase() === symbol &&
      !isPositionMarkStale(position, referenceAt ?? new Date()),
  );
}

function blockedCandidateStage(candidate: { reason?: unknown }) {
  const category = candidateSkipCategory(candidate);
  if (category === "gateway") return "scan_universe";
  if (category === "signal_policy") return "action_mapped";
  if (category === "contract_resolution") return "contract_selected";
  if (category === "marking") return "position_managed";
  if (category === "liquidity" || category === "risk") {
    return "liquidity_risk_gate";
  }
  return "action_mapped";
}

function blockedCandidateAction(candidate: { reason?: unknown }) {
  const stage = blockedCandidateStage(candidate);
  if (stage === "scan_universe") {
    return "Repair the broker bridge/data mode before scanning again.";
  }
  if (stage === "contract_selected") {
    return "Inspect expiration, strike slot, option chain coverage, and contract availability.";
  }
  if (stage === "position_managed") {
    return "Inspect option mark availability and quote freshness for the open position.";
  }
  if (stage === "liquidity_risk_gate") {
    return "Inspect quote freshness, bid/ask spread, premium budget, and risk caps.";
  }
  return "Inspect signal-policy filters such as MTF alignment, bearish regime, and open-position rules.";
}

function buildCockpitPipeline(input: {
  deployment: AlgoDeployment;
  readiness: AlgoGatewayReadiness;
  candidates: Array<
    SignalOptionsCandidate & {
      actionStatus?: SignalOptionsActionStatus;
      syncStatus?: SignalOptionsSyncStatus;
    }
  >;
  activePositions: SignalOptionsPosition[];
  risk: Record<string, unknown>;
  events: ExecutionEvent[];
  now?: Date;
}) {
  const selectedContracts = input.candidates.filter(
    (candidate) => Object.keys(asRecord(candidate.selectedContract)).length > 0,
  );
  const actionMapped = input.candidates.filter(
    (candidate) => Object.keys(asRecord(candidate.action)).length > 0,
  );
  const blockedCandidates = input.candidates.filter(candidateIsBlocked);
  const referenceAt = input.deployment.lastEvaluatedAt ?? null;
  const profileUpdatedAt = latestSignalOptionsControlUpdatedAt(input.events);
  const currentActionableBlockers = blockedCandidates.filter(
    (candidate) =>
      candidateIsCurrentCockpitBlocker(
        candidate,
        referenceAt,
        profileUpdatedAt,
      ) &&
      !candidateHasFreshPositionMark(
        candidate,
        input.activePositions,
        referenceAt,
      ),
  );
  const signalPolicyBlocked = blockedCandidates.filter((candidate) =>
    candidateMatchesSkipCategories(candidate, ["signal_policy"]),
  );
  const contractBlocked = currentActionableBlockers.filter((candidate) =>
    candidateMatchesSkipCategories(candidate, ["contract_resolution"]),
  );
  const preContractBlocked = actionMapped.filter(
    (candidate) =>
      candidateIsBlocked(candidate) &&
      candidateMatchesSkipCategories(candidate, [
        "signal_policy",
        "gateway",
        "other",
      ]),
  );
  const liquidityRiskBlocked = currentActionableBlockers.filter((candidate) =>
    candidateMatchesSkipCategories(candidate, ["liquidity", "risk"]),
  );
  const markingBlocked = currentActionableBlockers.filter((candidate) =>
    candidateMatchesSkipCategories(candidate, ["marking"]),
  );
  const shadowFilled = input.candidates.filter((candidate) =>
    ["shadow_filled", "partial_shadow", "closed"].includes(
      String(candidate.actionStatus ?? ""),
    ),
  );
  const mismatches = input.candidates.filter(
    (candidate) =>
      candidate.actionStatus === "mismatch" ||
      candidate.syncStatus === "mismatch",
  );
  const exitEvents = input.events.filter(
    (event) => event.eventType === SIGNAL_OPTIONS_EXIT_EVENT,
  );
  const latestGatewayBlocked = input.events.find(
    (event) => event.eventType === SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT,
  );
  const nearStopCount = input.activePositions.filter(isPositionNearStop).length;
  const dailyHaltActive = input.risk.dailyHaltActive === true;
  const scanState = signalOptionsActiveScanState(
    input.deployment.id,
    input.now,
  );
  const scanRunningAge = formatSignalOptionsScanAge(scanState.ageMs);
  const pressurePauseState = signalOptionsPressurePauseState(
    input.deployment.id,
    input.now,
  );
  const pressurePauseAge = formatSignalOptionsScanAge(pressurePauseState.ageMs);
  const workerState = signalOptionsWorkerDeploymentState(
    input.deployment.id,
    input.now,
  );
  const nextDueAge = formatSignalOptionsScanAge(workerState.nextDueInMs);
  const lastBatchDetail =
    workerState.lastBatchUniverseCount && workerState.lastBatchUniverseCount > 0
      ? `${workerState.lastBatchSize ?? 0}/${workerState.lastBatchUniverseCount} symbols`
      : null;
  const lastSignalScanAt =
    scanState.lastSignalScanAt ?? workerState.lastSignalScanAt ?? null;
  const lastHeavyWorkDeferred =
    scanState.heavyWorkDeferred || workerState.lastHeavyWorkDeferred;
  const activeScanPhase = scanState.phase ?? workerState.lastActiveScanPhase;
  const resourcePressureLevel = workerState.lastResourcePressureLevel;
  const heavyWorkDeferredByPressure =
    lastHeavyWorkDeferred &&
    resourcePressureLevel === "critical";
  const contractSelectionPendingUpstream =
    actionMapped.length > 0 &&
    selectedContracts.length === 0 &&
    contractBlocked.length === 0 &&
    !(
      preContractBlocked.length > 0 &&
      actionMapped.every((candidate) => candidateIsBlocked(candidate))
    );
  const contractSelectionBlockedBeforeWork =
    actionMapped.length > 0 &&
    selectedContracts.length === 0 &&
    contractBlocked.length === 0 &&
    preContractBlocked.length > 0 &&
    actionMapped.every((candidate) => candidateIsBlocked(candidate));
  const contractSelectionWaitingOnScan =
    contractSelectionPendingUpstream && scanState.running;
  const contractSelectionDeferred =
    contractSelectionPendingUpstream &&
    !contractSelectionWaitingOnScan &&
    lastHeavyWorkDeferred;
  const deferredScanDetail = heavyWorkDeferredByPressure
    ? "fresh signals updated; action work deferred by resource pressure"
    : contractSelectionBlockedBeforeWork
      ? `fresh signals updated; ${preContractBlocked.length} candidates blocked before contract selection`
      : contractSelectionPendingUpstream
      ? "fresh signals updated; action work deferred before contract selection"
      : selectedContracts.length
        ? `fresh signals updated; ${selectedContracts.length} ${
            selectedContracts.length === 1 ? "contract" : "contracts"
          } resolved; remaining action work deferred`
        : "fresh signals updated; action work deferred";

  return [
    {
      id: "scan_universe",
      label: "Signal Symbols",
      status: pressurePauseState.paused
        ? "attention"
        : stageStatus({
            blocked:
              !input.readiness.ready &&
              !isMarketSessionQuietReadiness(input.readiness) &&
              !scanState.running,
            attention:
              !input.readiness.ready &&
              isMarketSessionQuietReadiness(input.readiness) &&
              !scanState.running,
            running: scanState.running,
            count: input.deployment.lastEvaluatedAt ? 1 : 0,
          }),
      count: input.deployment.symbolUniverse.length,
      latestAt:
        lastSignalScanAt ??
        scanState.startedAt?.toISOString() ??
        pressurePauseState.startedAt?.toISOString() ??
        input.deployment.lastEvaluatedAt?.toISOString() ??
        latestGatewayBlocked?.occurredAt.toISOString() ??
        null,
      scanStartedAt: scanState.startedAt?.toISOString() ?? null,
      scanAgeMs: scanState.ageMs,
      activeScanSource: scanState.source,
      activeScanRunId: scanState.runId,
      activeScanPhase,
      lastSignalScanAt,
      latestSignalBarAt:
        scanState.latestSignalBarAt ??
        workerState.lastLatestSignalBarAt ??
        null,
      signalSourcePolicy:
        workerState.lastSignalSourcePolicy ??
        SIGNAL_OPTIONS_SIGNAL_SOURCE_POLICY,
      heavyWorkDeferred: lastHeavyWorkDeferred,
      resourcePressureLevel,
      pressurePaused: pressurePauseState.paused,
      pressurePauseStartedAt:
        pressurePauseState.startedAt?.toISOString() ?? null,
      pressurePauseAgeMs: pressurePauseState.ageMs,
      nextScanDueAt: workerState.nextDueAt?.toISOString() ?? null,
      nextScanDueInMs: workerState.nextDueInMs,
      pollIntervalMs: workerState.pollIntervalMs,
      lastBatchSymbols: workerState.lastBatchSymbols,
      lastBatchSize: workerState.lastBatchSize,
      lastBatchUniverseCount: workerState.lastBatchUniverseCount,
      lastBatchStartIndex: workerState.lastBatchStartIndex,
      lastBatchNextIndex: workerState.lastBatchNextIndex,
      lastBatchCapacity: workerState.lastBatchCapacity,
      lastBatchFullUniverse: workerState.lastBatchFullUniverse,
      pauseReason: pressurePauseState.reason,
      detail: pressurePauseState.paused
        ? pressurePauseAge
          ? `paused by resource pressure for ${pressurePauseAge}`
          : "paused by resource pressure"
        : lastHeavyWorkDeferred
          ? deferredScanDetail
          : scanState.running
            ? scanRunningAge
              ? `scan running for ${scanRunningAge}`
              : "scan running"
            : workerState.nextDueInMs !== null && workerState.nextDueInMs > 0
              ? `worker waiting ${nextDueAge ?? "for next interval"}${lastBatchDetail ? `; last batch ${lastBatchDetail}` : ""}`
              : input.readiness.ready
                ? lastBatchDetail
                  ? `${input.deployment.symbolUniverse.length} symbols ready; last batch ${lastBatchDetail}`
                  : `${input.deployment.symbolUniverse.length} symbols ready`
                : input.readiness.message,
    },
    {
      id: "signal_detected",
      label: "Signal Detected",
      status: stageStatus({ count: input.candidates.length }),
      count: input.candidates.length,
      latestAt: latestIso(
        input.candidates.map((candidate) => candidate.signalAt),
      ),
      detail: input.candidates.length
        ? `${input.candidates.length} recent signal candidates`
        : "awaiting fresh Pyrus Signals signal",
    },
    {
      id: "action_mapped",
      label: "Action Mapped",
      status: stageStatus({
        count: actionMapped.length,
      }),
      count: actionMapped.length,
      latestAt: latestIso(actionMapped.map((candidate) => candidate.signalAt)),
      detail: actionMapped.length
        ? signalPolicyBlocked.length
          ? `${actionMapped.length} signals mapped, ${signalPolicyBlocked.length} filtered by policy`
          : `${actionMapped.length} signals mapped to shadow option actions`
        : "waiting for buy-call or buy-put mapping",
    },
    {
      id: "contract_selected",
      label: "Contract Selected",
      status: stageStatus({
        running: contractSelectionWaitingOnScan,
        attention:
          contractBlocked.length > 0 ||
          contractSelectionDeferred ||
          contractSelectionBlockedBeforeWork,
        count: selectedContracts.length,
      }),
      count: selectedContracts.length,
      latestAt: latestIso(selectedContracts.map(candidateLatestTimelineAt)),
      detail: contractBlocked.length
        ? `${contractBlocked.length} candidates blocked at contract selection`
        : selectedContracts.length
          ? `${selectedContracts.length} contracts resolved`
          : contractSelectionBlockedBeforeWork
            ? `${preContractBlocked.length} candidates blocked before contract selection`
          : contractSelectionWaitingOnScan
            ? activeScanPhase === "signal_refresh"
              ? "waiting for signal refresh before contract selection"
              : activeScanPhase === "action_scan"
                ? "action scan running before contract selection"
                : "scan running before contract selection"
            : contractSelectionDeferred
              ? heavyWorkDeferredByPressure
                ? "action work deferred by resource pressure before contract selection"
                : "action work deferred before contract selection"
              : "no resolved contracts yet",
    },
    {
      id: "liquidity_risk_gate",
      label: "Liquidity/Risk Gate",
      status: stageStatus({
        blocked: dailyHaltActive,
        attention: liquidityRiskBlocked.length > 0,
        count: input.candidates.length - liquidityRiskBlocked.length,
      }),
      count: liquidityRiskBlocked.length,
      latestAt: latestIso(liquidityRiskBlocked.map(candidateLatestTimelineAt)),
      detail: dailyHaltActive
        ? "daily loss halt active"
        : liquidityRiskBlocked.length
          ? `${liquidityRiskBlocked.length} candidates blocked by liquidity/risk`
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
        attention: nearStopCount > 0 || markingBlocked.length > 0,
        count: input.activePositions.length,
      }),
      count: input.activePositions.length,
      latestAt: latestIso(
        input.activePositions.map((position) => position.lastMarkedAt),
      ),
      detail: markingBlocked.length
        ? `${markingBlocked.length} mark updates need attention`
        : nearStopCount
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
  candidates: Array<
    SignalOptionsCandidate & {
      actionStatus?: SignalOptionsActionStatus;
      syncStatus?: SignalOptionsSyncStatus;
      shadowLink?: SignalOptionsShadowLink | null;
    }
  >;
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
    const marketSessionQuiet = isMarketSessionQuietReadiness(input.readiness);
    items.push({
      id: "gateway-readiness",
      severity: marketSessionQuiet ? "warning" : "critical",
      stage: "scan_universe",
      symbol: null,
      summary: marketSessionQuiet
        ? "Market session is closed."
        : "Market data readiness is blocking scans.",
      detail: input.readiness.message,
      occurredAt: new Date().toISOString(),
      action: marketSessionQuiet
        ? "Signal-options scans will resume when the market session opens."
        : "Start or repair the IBKR bridge/data mode before running signal-options scans.",
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

  const referenceAt = input.deployment.lastEvaluatedAt ?? null;
  const profileUpdatedAt = latestSignalOptionsControlUpdatedAt(input.events);

  input.candidates
    .filter(
      (candidate) =>
        candidateIsCurrentCockpitBlocker(
          candidate,
          referenceAt,
          profileUpdatedAt,
        ) &&
        !candidateHasFreshPositionMark(
          candidate,
          input.activePositions,
          referenceAt,
        ),
    )
    .slice(0, 8)
    .forEach((candidate) => {
      items.push({
        id: `blocked-${candidate.id}`,
        severity: "warning",
        stage: blockedCandidateStage(candidate),
        symbol: candidate.symbol,
        summary: `${candidate.symbol} candidate blocked.`,
        detail: formatEnumReason(candidate.reason ?? "gate_failed"),
        occurredAt:
          candidateLatestTimelineAt(candidate) ?? candidate.signalAt ?? null,
        action: blockedCandidateAction(candidate),
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
        severity:
          candidate.actionStatus === "mismatch" ? "critical" : "warning",
        stage: "order_shadow",
        symbol: candidate.symbol,
        summary: `${candidate.symbol} shadow ledger attribution needs review.`,
        detail: shadowLinkStatus(candidate.shadowLink),
        occurredAt:
          candidateLatestTimelineAt(candidate) ?? candidate.signalAt ?? null,
        action:
          "Compare execution event, shadow order, fill, and position link.",
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
    if (isPositionMarkStale(position, referenceAt ?? new Date())) {
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
      "position_mark_timeout",
      "position_mark_feed_degraded",
      "invalid_position_mark",
    ].includes(reason)
  ) {
    return "marking";
  }
  if (
    [
      "no_contract_for_strike_slot",
      "no_expiration_in_dte_window",
      "option_chain_backoff",
      "option_expiration_backoff",
      "candidate_resolution_failed",
      "candidate_resolution_timeout",
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
  if (GATEWAY_READINESS_SKIP_REASONS.has(reason)) {
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

type SignalOptionsShadowExecutionSloStatus = "pass" | "fail" | "no_data";

function signalOptionsSloSectionStatus(input: {
  observed: number;
  breachCount: number;
}): SignalOptionsShadowExecutionSloStatus {
  if (input.breachCount > 0) {
    return "fail";
  }
  return input.observed > 0 ? "pass" : "no_data";
}

function signalOptionsAuditElapsedMs(
  start: unknown,
  end: unknown,
): number | null {
  const startDate = dateOrNull(start);
  const endDate = dateOrNull(end);
  if (!startDate || !endDate) {
    return null;
  }
  return Math.max(0, endDate.getTime() - startDate.getTime());
}

function addSignalOptionsAuditKey(
  keys: Set<string>,
  type: string,
  value: unknown,
) {
  const text = compactString(value);
  if (text) {
    keys.add(`${type}:${text.toUpperCase()}`);
  }
}

function signalOptionsAuditIdentityKeys(value: unknown): Set<string> {
  const record = asRecord(value);
  const nestedSignal = asRecord(record.signal);
  const keys = new Set<string>();
  addSignalOptionsAuditKey(
    keys,
    "signal",
    record.signalKey ?? nestedSignal.signalKey,
  );

  const symbol = compactString(record.symbol ?? nestedSignal.symbol);
  const timeframe = compactString(record.timeframe ?? nestedSignal.timeframe);
  const direction = compactString(record.direction ?? nestedSignal.direction);
  const signalAt = toIsoString(record.signalAt ?? nestedSignal.signalAt);
  if (symbol && timeframe && direction && signalAt) {
    addSignalOptionsAuditKey(
      keys,
      "row",
      [symbol, timeframe, direction, signalAt].join("|"),
    );
  }
  return keys;
}

function signalOptionsAuditKeysIntersect(
  left: Set<string>,
  right: Set<string>,
) {
  for (const key of left) {
    if (right.has(key)) {
      return true;
    }
  }
  return false;
}

function hasSignalOptionsSelectedContract(candidate: SignalOptionsCandidate) {
  return Object.keys(asRecord(candidate.selectedContract)).length > 0;
}

function buildSignalOptionsShadowExecutionSlo(input: {
  signals: SignalOptionsSignalSnapshot[];
  candidates: Array<
    SignalOptionsCandidate & {
      actionStatus?: SignalOptionsActionStatus;
    }
  >;
  activePositions: SignalOptionsPosition[];
  now: Date;
}) {
  const candidateIdentitySets = input.candidates.map((candidate) =>
    signalOptionsAuditIdentityKeys(candidate),
  );
  const actionableSignals = input.signals.filter(
    (signal) => signal.fresh && signal.actionEligible && signal.direction,
  );
  const signalPickupBreaches = actionableSignals
    .map((signal) => {
      const signalKeys = signalOptionsAuditIdentityKeys(signal);
      const pickedUp = candidateIdentitySets.some((candidateKeys) =>
        signalOptionsAuditKeysIntersect(signalKeys, candidateKeys),
      );
      if (pickedUp) {
        return null;
      }
      const ageMs = signalOptionsAuditElapsedMs(
        signal.signalAt ?? signal.latestBarAt,
        input.now,
      );
      if (
        ageMs == null ||
        ageMs <= SIGNAL_OPTIONS_SHADOW_EXECUTION_SLO_MS.signalPickup
      ) {
        return null;
      }
      return {
        symbol: signal.symbol,
        timeframe: signal.timeframe,
        direction: signal.direction,
        signalAt: signal.signalAt ?? signal.latestBarAt,
        ageMs,
        reason: "fresh_actionable_signal_not_picked_up",
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((left, right) => right.ageMs - left.ageMs);

  const contractDecisionBreaches = input.candidates
    .map((candidate) => {
      const decisionAt =
        candidateLatestActivityAt(candidate) ?? input.now.toISOString();
      const elapsedMs = signalOptionsAuditElapsedMs(
        candidate.signalAt,
        decisionAt,
      );
      if (
        elapsedMs == null ||
        elapsedMs <= SIGNAL_OPTIONS_SHADOW_EXECUTION_SLO_MS.contractDecision
      ) {
        return null;
      }
      const blocked =
        candidate.actionStatus === "blocked" || candidate.status === "skipped";
      const selected = hasSignalOptionsSelectedContract(candidate);
      return {
        candidateId: candidate.id,
        symbol: candidate.symbol,
        signalAt: candidate.signalAt,
        decisionAt,
        elapsedMs,
        reason: selected
          ? blocked
            ? "candidate_blocked_after_contract_selection"
            : "contract_selection_slow"
          : blocked
            ? "candidate_blocked_before_contract_selection"
            : "contract_not_selected",
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((left, right) => right.elapsedMs - left.elapsedMs);

  const positionMarkBreaches = input.activePositions
    .map((position) => {
      const ageMs = signalOptionsAuditElapsedMs(position.lastMarkedAt, input.now);
      if (ageMs == null) {
        return {
          positionId: position.id,
          candidateId: position.candidateId,
          symbol: position.symbol,
          lastMarkedAt: position.lastMarkedAt ?? null,
          ageMs: null,
          reason: "position_unmarked",
        };
      }
      if (ageMs <= SIGNAL_OPTIONS_SHADOW_EXECUTION_SLO_MS.positionMark) {
        return null;
      }
      return {
        positionId: position.id,
        candidateId: position.candidateId,
        symbol: position.symbol,
        lastMarkedAt: position.lastMarkedAt ?? null,
        ageMs,
        reason: "position_mark_stale",
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort(
      (left, right) => (right.ageMs ?? Infinity) - (left.ageMs ?? Infinity),
    );

  const breachCount =
    signalPickupBreaches.length +
    contractDecisionBreaches.length +
    positionMarkBreaches.length;

  return {
    status: breachCount > 0 ? "fail" : "pass",
    checkedAt: input.now.toISOString(),
    thresholdsMs: SIGNAL_OPTIONS_SHADOW_EXECUTION_SLO_MS,
    breachCount,
    signalPickup: {
      status: signalOptionsSloSectionStatus({
        observed: actionableSignals.length,
        breachCount: signalPickupBreaches.length,
      }),
      observedSignals: actionableSignals.length,
      pickedUpSignals: Math.max(
        0,
        actionableSignals.length - signalPickupBreaches.length,
      ),
      breaches: signalPickupBreaches.slice(0, 8),
    },
    contractDecision: {
      status: signalOptionsSloSectionStatus({
        observed: input.candidates.length,
        breachCount: contractDecisionBreaches.length,
      }),
      observedCandidates: input.candidates.length,
      contractsSelected: input.candidates.filter(hasSignalOptionsSelectedContract)
        .length,
      breaches: contractDecisionBreaches.slice(0, 8),
    },
    positionMonitoring: {
      status: signalOptionsSloSectionStatus({
        observed: input.activePositions.length,
        breachCount: positionMarkBreaches.length,
      }),
      activePositions: input.activePositions.length,
      breaches: positionMarkBreaches.slice(0, 8),
    },
  };
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
  candidates: Array<
    SignalOptionsCandidate & {
      actionStatus?: SignalOptionsActionStatus;
    }
  >;
  activePositions: SignalOptionsPosition[];
  events: ExecutionEvent[];
  profile?: SignalOptionsExecutionProfile;
  now?: Date;
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

  const diagnosticEvents = input.profile
    ? input.events.filter(
        (event) => !skipEventDisabledByProfile(event, input.profile!),
      )
    : input.events;

  for (const event of diagnosticEvents) {
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
  const now = input.now ?? new Date();
  const markFailureEvents = input.events.filter((event) => {
    const reason = compactString(asRecord(event.payload).reason);
    return (
      event.eventType === SIGNAL_OPTIONS_SKIPPED_EVENT &&
      isSignalOptionsPositionMarkSkipReason(reason)
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
      total: diagnosticEvents.length,
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
    shadowExecutionSlo: buildSignalOptionsShadowExecutionSlo({
      signals: input.signals,
      candidates: input.candidates,
      activePositions: input.activePositions,
      now,
    }),
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
    values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0),
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
  return daysBetweenUtc(
    new Date(openedAt),
    new Date(`${expirationDate}T00:00:00.000Z`),
  );
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
    fees: roundMetric(
      fees.reduce((sum, value) => sum + value, 0),
      2,
    ),
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
  const dailyLossHaltEnabled =
    input.profile.riskHaltControls.dailyLossHaltEnabled !== false;
  const dailyLossHaltSkipCount = dailyLossHaltEnabled
    ? skipCount("daily_loss_halt_active")
    : 0;
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
  const openSymbols =
    finiteNumber(input.risk.openSymbols) ?? input.activePositions.length;
  const unmarkedPositions = input.activePositions.filter(
    (position) => finiteNumber(position.lastMarkPrice) == null,
  ).length;
  const markProblemEvents = input.events.filter((event) => {
    const reason = eventReasonValue(event);
    return (
      event.eventType === SIGNAL_OPTIONS_SKIPPED_EVENT &&
      isSignalOptionsPositionMarkSkipReason(reason)
    );
  }).length;
  const positionMarkFeedBlocks = skipCount("position_mark_feed_degraded");

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
      violations: openSymbols > input.profile.riskCaps.maxOpenSymbols ? 1 : 0,
      detail: skipCount("max_open_symbols_reached")
        ? `${skipCount("max_open_symbols_reached")} candidates were blocked by the open-symbol cap; current exposure is ${openSymbols}/${input.profile.riskCaps.maxOpenSymbols}.`
        : `${openSymbols}/${input.profile.riskCaps.maxOpenSymbols} open symbols.`,
    }),
    rule({
      id: "daily_loss_halt",
      label: "Daily loss halt",
      status:
        dailyLossHaltEnabled &&
        (input.risk.dailyHaltActive === true || dailyLossHaltSkipCount)
          ? "warning"
          : "pass",
      observations: skippedEvents.length,
      violations: 0,
      detail: !dailyLossHaltEnabled
        ? "Daily loss halt is disabled."
        : input.risk.dailyHaltActive === true
          ? `Daily P&L ${input.risk.dailyPnl ?? 0} is at or below halt ${input.profile.riskCaps.maxDailyLoss}.`
          : dailyLossHaltSkipCount
            ? `${dailyLossHaltSkipCount} candidates were blocked by the daily halt.`
            : "Daily loss halt is clear.",
    }),
    rule({
      id: "position_marking",
      label: "Position marking",
      status:
        unmarkedPositions || markProblemEvents || positionMarkFeedBlocks
          ? "warning"
          : "pass",
      observations:
        markEvents.length +
        input.activePositions.length +
        positionMarkFeedBlocks,
      violations: markProblemEvents + positionMarkFeedBlocks,
      detail:
        unmarkedPositions || markProblemEvents || positionMarkFeedBlocks
          ? `${unmarkedPositions} open positions lack marks; ${markProblemEvents} mark events reported quote issues; ${positionMarkFeedBlocks} scans blocked new entries while marking was degraded.`
          : "Open positions have marks for current exposure.",
    }),
  ];
}

export function buildSignalOptionsPerformanceFromInputs(input: {
  deploymentId: string;
  profile: SignalOptionsExecutionProfile;
  state: Awaited<ReturnType<typeof buildStatePayload>>;
  events: ExecutionEvent[];
  shadowTradeDiagnostics: Record<string, unknown>;
}) {
  const roundTrips = Array.isArray(input.shadowTradeDiagnostics.roundTrips)
    ? input.shadowTradeDiagnostics.roundTrips.filter((trade) =>
        isSignalOptionsAutomationShadowRecord(trade, input.deploymentId),
      )
    : [];
  const openLots = Array.isArray(input.shadowTradeDiagnostics.openLots)
    ? input.shadowTradeDiagnostics.openLots.filter((lot) =>
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
    range:
      compactString(asRecord(input.shadowTradeDiagnostics.context).range) ??
      "1M",
    summary: {
      ...summarizeSignalOptionsRoundTrips(roundTrips),
      openLots: openLots.length,
      tradeEvents: Array.isArray(input.shadowTradeDiagnostics.tradeEvents)
        ? input.shadowTradeDiagnostics.tradeEvents.filter((event) =>
            isSignalOptionsAutomationShadowRecord(event, input.deploymentId),
          ).length
        : null,
    },
    openExposure: {
      openPositions: input.state.activePositions.length,
      openSymbols:
        input.state.risk.openSymbols ?? input.state.activePositions.length,
      maxOpenSymbols: input.profile.riskCaps.maxOpenSymbols,
      atOpenSymbolCapacity:
        Number(
          input.state.risk.openSymbols ?? input.state.activePositions.length,
        ) >= input.profile.riskCaps.maxOpenSymbols,
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
  cacheMode?: SignalOptionsDashboardCacheMode;
}) {
  const cached = readSignalOptionsCachedPayload(
    signalOptionsPerformanceCache,
    input.deploymentId,
    input.cacheMode ?? "normal",
  );
  if (cached) {
    return cached;
  }
  if (input.cacheMode === "cache-only") {
    throw new HttpError(503, "Signal-options performance cache unavailable.", {
      code: "signal_options_performance_cache_unavailable",
      detail:
        "API pressure requires a cached signal-options performance payload, but no usable payload is available yet.",
    });
  }
  const { deployment, profile, events, state } =
    await getSignalOptionsDashboardSnapshot({
      ...input,
      view: "full",
    });
  const shadowTradeDiagnostics = await computeShadowTradeDiagnostics({
    range: "1M",
  });

  const payload = buildSignalOptionsPerformanceFromInputs({
    deploymentId: deployment.id,
    profile,
    state,
    events: stateSignalOptionsEvents(events).signalEvents,
    shadowTradeDiagnostics,
  });
  writeSignalOptionsCachedPayload(
    signalOptionsPerformanceCache,
    deployment.id,
    payload,
  );
  if (deployment.id !== input.deploymentId) {
    writeSignalOptionsCachedPayload(
      signalOptionsPerformanceCache,
      input.deploymentId,
      payload,
    );
  }
  return payload;
}

function formatEnumReason(value: string) {
  return value.replace(/_/g, " ");
}

function formatNumberForPayload(value: number | null) {
  return value == null || !Number.isFinite(value)
    ? null
    : Number(value.toFixed(1));
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
    strategyName: normalizeLegacyAlgoBrandText(
      strategy?.name ?? deployment.name,
    ),
    sourceRunId: sourceRunId ?? null,
    sourceStudyId: sourceStudyId ?? run?.studyId ?? null,
    runName: run?.name ?? null,
    strategyVersion:
      compactString(config.strategyVersion) ?? run?.strategyVersion ?? null,
    metrics: (run?.metrics as Record<string, unknown> | null) ?? null,
    promotedAt:
      strategy?.createdAt?.toISOString?.() ??
      deployment.createdAt.toISOString(),
  };
}

async function buildStatePayload(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  events: ExecutionEvent[];
}) {
  const signalSnapshots = await listSignalOptionsSignalSnapshots(input.deployment);
  const signals = await attachSignalOptionsContractPreviews({
    deployment: input.deployment,
    profile: input.profile,
    signals: signalSnapshots,
  });
  const {
    signalEvents: stateSignalEvents,
    activePositions: eventActivePositions,
  } = stateSignalOptionsEvents(input.events);
  const activeSignalEventsBeforeReconciliation = stateSignalEvents.filter(
    (event) => !skipEventDisabledByProfile(event, input.profile),
  );
  const shadowIndex = await buildSignalOptionsShadowIndex(
    activeSignalEventsBeforeReconciliation,
  );
  const activePositions = reconcileActivePositionsWithShadowLinks(
    eventActivePositions,
    shadowIndex,
  );
  const activeSignalEvents = filterOrphanPositionMarkEvents(
    activeSignalEventsBeforeReconciliation,
    activePositions,
  );
  const signalEvents = filterOrphanPositionMarkEvents(
    stateSignalEvents,
    activePositions,
  );
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
  const currentCandidateIds = new Set(candidatesById.keys());

  for (const event of [...activeSignalEvents].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  )) {
    const candidate = candidateFromEvent(event);
    if (!candidate) {
      continue;
    }
    if (!currentCandidateIds.has(candidate.id)) {
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
      const signalQuality =
        candidate.signalQuality ??
        (Object.keys(asRecord(candidate.orderPlan)).length
          ? classifySignalOptionsEntryQuality({
              candidate,
              orderPlan: asRecord(candidate.orderPlan),
            })
          : null);
      return normalizeLegacyAlgoBranding({
        ...candidate,
        actionStatus,
        syncStatus,
        shadowLink,
        signalQuality,
        timeline: eventsForCandidate
          .slice()
          .sort(
            (left, right) =>
              left.occurredAt.getTime() - right.occurredAt.getTime(),
          )
          .map((event) =>
            eventTimelineItem(event, shadowIndex.byEventId.get(event.id)),
          ),
      });
    })
    .sort((left, right) => {
      const leftTime =
        dateOrNull(candidateLatestActivityAt(left))?.getTime() ?? 0;
      const rightTime =
        dateOrNull(candidateLatestActivityAt(right))?.getTime() ?? 0;
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
  const dailyLossBreached =
    dailyPnl <= -Math.abs(input.profile.riskCaps.maxDailyLoss);
  const dataQuality = buildSignalOptionsDataQualityReport({
    candidates,
    events: signalEvents,
  });

  return {
    deployment: deploymentToResponse(input.deployment),
    profile: input.profile,
    mode: "shadow",
    signals,
    candidates,
    dataQuality,
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
      dailyLossBreached,
      dailyHaltActive:
        input.profile.riskHaltControls.dailyLossHaltEnabled !== false &&
        dailyLossBreached,
    },
    events: signalEvents.slice(0, 75).map(eventToResponse),
  };
}

type SignalOptionsDashboardSnapshot = {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  events: ExecutionEvent[];
  state: Awaited<ReturnType<typeof buildStatePayload>>;
  cachedAt: string;
  expiresAt: number;
  staleExpiresAt: number;
};

type SignalOptionsCachedPayload<T> = {
  value: T;
  cachedAt: string;
  expiresAt: number;
  staleExpiresAt: number;
};

type SignalOptionsDashboardInFlight<T> = {
  promise: Promise<T>;
  startedAt: number;
};

const signalOptionsDashboardCache = new Map<
  string,
  SignalOptionsDashboardSnapshot
>();
const signalOptionsSummaryDashboardCache = new Map<
  string,
  SignalOptionsDashboardSnapshot
>();
const signalOptionsDashboardInFlight = new Map<
  string,
  SignalOptionsDashboardInFlight<SignalOptionsDashboardSnapshot>
>();
const signalOptionsSummaryDashboardInFlight = new Map<
  string,
  SignalOptionsDashboardInFlight<SignalOptionsDashboardSnapshot>
>();
const signalOptionsContractPreviewBackoff = new Map<string, number>();
const signalOptionsCockpitCache = new Map<
  string,
  SignalOptionsCachedPayload<
    Awaited<ReturnType<typeof buildAlgoDeploymentCockpitPayload>>
  >
>();
const signalOptionsCockpitSummaryCache = new Map<
  string,
  SignalOptionsCachedPayload<
    Awaited<ReturnType<typeof buildAlgoDeploymentCockpitPayload>>
  >
>();
const signalOptionsPerformanceCache = new Map<
  string,
  SignalOptionsCachedPayload<
    ReturnType<typeof buildSignalOptionsPerformanceFromInputs>
  >
>();

export function invalidateSignalOptionsDashboardCaches(deploymentId?: string) {
  if (!deploymentId) {
    signalOptionsDashboardCache.clear();
    signalOptionsSummaryDashboardCache.clear();
    signalOptionsDashboardInFlight.clear();
    signalOptionsSummaryDashboardInFlight.clear();
    signalOptionsCockpitCache.clear();
    signalOptionsCockpitSummaryCache.clear();
    signalOptionsPerformanceCache.clear();
    return;
  }
  signalOptionsDashboardCache.delete(deploymentId);
  signalOptionsSummaryDashboardCache.delete(deploymentId);
  signalOptionsDashboardInFlight.delete(deploymentId);
  signalOptionsSummaryDashboardInFlight.delete(deploymentId);
  signalOptionsCockpitCache.delete(deploymentId);
  signalOptionsCockpitSummaryCache.delete(deploymentId);
  signalOptionsPerformanceCache.delete(deploymentId);
}

function withSignalOptionsCacheMetadata<T>(
  value: T,
  input: {
    cachedAt: string;
    cacheStatus: "hit" | "stale";
    reason?: string;
  },
): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return {
    ...record,
    cachedAt: input.cachedAt,
    cacheStatus: input.cacheStatus,
    degraded: input.cacheStatus === "stale" ? true : record["degraded"],
    stale: input.cacheStatus === "stale" ? true : record["stale"],
    reason:
      input.cacheStatus === "stale"
        ? (input.reason ?? "signal_options_dashboard_stale_cache")
        : record["reason"],
  } as T;
}

function readSignalOptionsCachedPayload<T>(
  cache: Map<string, SignalOptionsCachedPayload<T>>,
  deploymentId: string,
  cacheMode: SignalOptionsDashboardCacheMode,
): T | null {
  const now = Date.now();
  const cached = cache.get(deploymentId);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt > now) {
    return withSignalOptionsCacheMetadata(cached.value, {
      cachedAt: cached.cachedAt,
      cacheStatus: "hit",
    });
  }
  if (cached.staleExpiresAt > now) {
    return withSignalOptionsCacheMetadata(cached.value, {
      cachedAt: cached.cachedAt,
      cacheStatus: "stale",
    });
  }
  cache.delete(deploymentId);
  return cacheMode === "cache-only" ? null : null;
}

function writeSignalOptionsCachedPayload<T>(
  cache: Map<string, SignalOptionsCachedPayload<T>>,
  deploymentId: string,
  value: T,
  input: {
    ttlMs?: number;
    staleTtlMs?: number;
  } = {},
) {
  const now = Date.now();
  cache.set(deploymentId, {
    value,
    cachedAt: new Date(now).toISOString(),
    expiresAt: now + (input.ttlMs ?? SIGNAL_OPTIONS_DASHBOARD_CACHE_TTL_MS),
    staleExpiresAt:
      now + (input.staleTtlMs ?? SIGNAL_OPTIONS_DASHBOARD_CACHE_STALE_TTL_MS),
  });
}

function readSignalOptionsDashboardInFlight<T>(
  cache: Map<string, SignalOptionsDashboardInFlight<T>>,
  deploymentId: string,
  maxAgeMs: number,
): Promise<T> | null {
  const inFlight = cache.get(deploymentId);
  if (!inFlight) {
    return null;
  }
  if (Date.now() - inFlight.startedAt <= maxAgeMs) {
    return inFlight.promise;
  }
  cache.delete(deploymentId);
  return null;
}

function withSignalOptionsDashboardBuildTimeout<T>(
  promise: Promise<T>,
  input: {
    timeoutMs: number;
    view: SignalOptionsDashboardView;
  },
): Promise<T> {
  promise.catch(() => {});
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new HttpError(504, "Signal-options dashboard build timed out.", {
          code: "signal_options_dashboard_build_timeout",
          detail: `The ${input.view} Signal Options dashboard build did not finish within ${input.timeoutMs}ms.`,
        }),
      );
    }, input.timeoutMs);
    timeout.unref?.();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function compactSignalOptionsEventResponse(
  event: Awaited<ReturnType<typeof buildStatePayload>>["events"][number],
) {
  return {
    ...event,
    payload: {},
  };
}

function compactSignalOptionsStatePayload(
  state: Awaited<ReturnType<typeof buildStatePayload>>,
): Awaited<ReturnType<typeof buildStatePayload>> {
  return {
    ...state,
    events: state.events
      .slice(0, SIGNAL_OPTIONS_SUMMARY_RESPONSE_EVENT_LIMIT)
      .map(compactSignalOptionsEventResponse),
  };
}

function writeSignalOptionsDashboardSnapshot(
  cache: Map<string, SignalOptionsDashboardSnapshot>,
  deploymentId: string,
  snapshot: SignalOptionsDashboardSnapshot,
) {
  cache.set(deploymentId, snapshot);
}

async function getSignalOptionsFullDashboardSnapshot(input: {
  deploymentId: string;
  cacheMode?: SignalOptionsDashboardCacheMode;
}): Promise<SignalOptionsDashboardSnapshot> {
  const cacheMode = input.cacheMode ?? "normal";
  const now = Date.now();
  const cached = signalOptionsDashboardCache.get(input.deploymentId);
  if (cached && cached.expiresAt > now) {
    return cached;
  }
  if (cached && cached.staleExpiresAt > now && cacheMode === "cache-only") {
    return {
      ...cached,
      state: withSignalOptionsCacheMetadata(cached.state, {
        cachedAt: cached.cachedAt,
        cacheStatus: "stale",
      }),
    };
  }
  if (cacheMode === "cache-only") {
    throw new HttpError(503, "Signal-options dashboard snapshot unavailable.", {
      code: "signal_options_dashboard_cache_unavailable",
      detail:
        "API pressure requires a cached signal-options dashboard snapshot, but no usable snapshot is available yet.",
    });
  }

  const inFlight = readSignalOptionsDashboardInFlight(
    signalOptionsDashboardInFlight,
    input.deploymentId,
    SIGNAL_OPTIONS_DASHBOARD_FULL_BUILD_TIMEOUT_MS,
  );
  if (inFlight) {
    return inFlight;
  }

  const work = (async () => {
    const deployment = await getDeploymentOrThrow(input.deploymentId);
    const profile = resolveDeploymentProfile(deployment);
    const events = await listDeploymentEvents(
      deployment.id,
      SIGNAL_OPTIONS_STATE_EVENT_LIMIT,
    );
    const state = await buildStatePayload({ deployment, profile, events });
    const cachedAt = new Date().toISOString();
    const snapshot = {
      deployment,
      profile,
      events,
      state,
      cachedAt,
      expiresAt: Date.now() + SIGNAL_OPTIONS_DASHBOARD_CACHE_TTL_MS,
      staleExpiresAt: Date.now() + SIGNAL_OPTIONS_DASHBOARD_CACHE_STALE_TTL_MS,
    };
    signalOptionsDashboardCache.set(deployment.id, snapshot);
    if (deployment.id !== input.deploymentId) {
      signalOptionsDashboardCache.set(input.deploymentId, snapshot);
    }
    return snapshot;
  })();
  const request = withSignalOptionsDashboardBuildTimeout(work, {
    timeoutMs: SIGNAL_OPTIONS_DASHBOARD_FULL_BUILD_TIMEOUT_MS,
    view: "full",
  }).finally(() => {
    signalOptionsDashboardInFlight.delete(input.deploymentId);
  });

  signalOptionsDashboardInFlight.set(input.deploymentId, {
    promise: request,
    startedAt: Date.now(),
  });
  return request;
}

async function getSignalOptionsSummaryDashboardSnapshot(input: {
  deploymentId: string;
  cacheMode?: SignalOptionsDashboardCacheMode;
}): Promise<SignalOptionsDashboardSnapshot> {
  const cacheMode = input.cacheMode ?? "normal";
  const now = Date.now();
  const cached = signalOptionsSummaryDashboardCache.get(input.deploymentId);
  if (cached && cached.expiresAt > now) {
    return cached;
  }
  if (cached && cached.staleExpiresAt > now && cacheMode === "cache-only") {
    return {
      ...cached,
      state: withSignalOptionsCacheMetadata(cached.state, {
        cachedAt: cached.cachedAt,
        cacheStatus: "stale",
      }),
    };
  }

  const fullCached = signalOptionsDashboardCache.get(input.deploymentId);
  if (fullCached && fullCached.staleExpiresAt > now) {
    const cachedAt = new Date(now).toISOString();
    const summarySnapshot = {
      deployment: fullCached.deployment,
      profile: fullCached.profile,
      events: fullCached.events.slice(0, SIGNAL_OPTIONS_SUMMARY_EVENT_LIMIT),
      state: compactSignalOptionsStatePayload(fullCached.state),
      cachedAt,
      expiresAt: now + SIGNAL_OPTIONS_SUMMARY_CACHE_TTL_MS,
      staleExpiresAt: now + SIGNAL_OPTIONS_SUMMARY_CACHE_STALE_TTL_MS,
    };
    writeSignalOptionsDashboardSnapshot(
      signalOptionsSummaryDashboardCache,
      fullCached.deployment.id,
      summarySnapshot,
    );
    if (fullCached.deployment.id !== input.deploymentId) {
      writeSignalOptionsDashboardSnapshot(
        signalOptionsSummaryDashboardCache,
        input.deploymentId,
        summarySnapshot,
      );
    }
    return summarySnapshot;
  }

  if (cacheMode === "cache-only") {
    throw new HttpError(503, "Signal-options summary snapshot unavailable.", {
      code: "signal_options_summary_cache_unavailable",
      detail:
        "API pressure requires a cached signal-options summary payload, but no usable payload is available yet.",
    });
  }

  const inFlight = readSignalOptionsDashboardInFlight(
    signalOptionsSummaryDashboardInFlight,
    input.deploymentId,
    SIGNAL_OPTIONS_DASHBOARD_SUMMARY_BUILD_TIMEOUT_MS,
  );
  if (inFlight) {
    return inFlight;
  }

  const work = (async () => {
    const deployment = await getDeploymentOrThrow(input.deploymentId);
    const profile = resolveDeploymentProfile(deployment);
    const events = await listDeploymentEvents(
      deployment.id,
      SIGNAL_OPTIONS_SUMMARY_EVENT_LIMIT,
    );
    const state = compactSignalOptionsStatePayload(
      await buildStatePayload({ deployment, profile, events }),
    );
    const cachedAt = new Date().toISOString();
    const snapshot = {
      deployment,
      profile,
      events,
      state,
      cachedAt,
      expiresAt: Date.now() + SIGNAL_OPTIONS_SUMMARY_CACHE_TTL_MS,
      staleExpiresAt: Date.now() + SIGNAL_OPTIONS_SUMMARY_CACHE_STALE_TTL_MS,
    };
    signalOptionsSummaryDashboardCache.set(deployment.id, snapshot);
    if (deployment.id !== input.deploymentId) {
      signalOptionsSummaryDashboardCache.set(input.deploymentId, snapshot);
    }
    return snapshot;
  })();
  const request = withSignalOptionsDashboardBuildTimeout(work, {
    timeoutMs: SIGNAL_OPTIONS_DASHBOARD_SUMMARY_BUILD_TIMEOUT_MS,
    view: "summary",
  }).finally(() => {
    signalOptionsSummaryDashboardInFlight.delete(input.deploymentId);
  });

  signalOptionsSummaryDashboardInFlight.set(input.deploymentId, {
    promise: request,
    startedAt: Date.now(),
  });
  return request;
}

async function getSignalOptionsDashboardSnapshot(input: {
  deploymentId: string;
  cacheMode?: SignalOptionsDashboardCacheMode;
  view?: SignalOptionsDashboardView;
}): Promise<SignalOptionsDashboardSnapshot> {
  return input.view === "full"
    ? getSignalOptionsFullDashboardSnapshot(input)
    : getSignalOptionsSummaryDashboardSnapshot(input);
}

export async function listSignalOptionsAutomationState(input: {
  deploymentId: string;
  cacheMode?: SignalOptionsDashboardCacheMode;
  view?: SignalOptionsDashboardView;
}) {
  const snapshot = await getSignalOptionsDashboardSnapshot(input);
  return snapshot.state;
}

async function buildAlgoDeploymentCockpitPayload(input: {
  deploymentId: string;
  view?: SignalOptionsDashboardView;
}) {
  const snapshot = await getSignalOptionsDashboardSnapshot({
    deploymentId: input.deploymentId,
    view: input.view,
  });
  const { deployment, profile, events, state } = snapshot;
  const [readiness, fleetRows] = await Promise.all([
    getAlgoGatewayReadiness(),
    db
      .select()
      .from(algoDeploymentsTable)
      .where(eq(algoDeploymentsTable.mode, deployment.mode))
      .orderBy(desc(algoDeploymentsTable.updatedAt)),
  ]);
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
    profile,
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

export async function getAlgoDeploymentCockpit(input: {
  deploymentId: string;
  cacheMode?: SignalOptionsDashboardCacheMode;
  view?: SignalOptionsDashboardView;
}) {
  const view = input.view ?? "summary";
  const cockpitCache =
    view === "full"
      ? signalOptionsCockpitCache
      : signalOptionsCockpitSummaryCache;
  const cached = readSignalOptionsCachedPayload(
    cockpitCache,
    input.deploymentId,
    input.cacheMode ?? "normal",
  );
  if (cached) {
    return cached;
  }
  if (input.cacheMode === "cache-only") {
    throw new HttpError(503, "Signal-options cockpit cache unavailable.", {
      code: "signal_options_cockpit_cache_unavailable",
      detail:
        "API pressure requires a cached signal-options cockpit payload, but no usable payload is available yet.",
    });
  }
  const payload = await buildAlgoDeploymentCockpitPayload({
    deploymentId: input.deploymentId,
    view,
  });
  writeSignalOptionsCachedPayload(
    cockpitCache,
    input.deploymentId,
    payload,
    view === "summary"
      ? {
          ttlMs: SIGNAL_OPTIONS_SUMMARY_CACHE_TTL_MS,
          staleTtlMs: SIGNAL_OPTIONS_SUMMARY_CACHE_STALE_TTL_MS,
        }
      : {},
  );
  const payloadDeploymentId =
    payload.deployment && typeof payload.deployment === "object"
      ? String((payload.deployment as Record<string, unknown>)["id"] ?? "")
      : "";
  if (payloadDeploymentId && payloadDeploymentId !== input.deploymentId) {
    writeSignalOptionsCachedPayload(
      cockpitCache,
      payloadDeploymentId,
      payload,
      view === "summary"
        ? {
            ttlMs: SIGNAL_OPTIONS_SUMMARY_CACHE_TTL_MS,
            staleTtlMs: SIGNAL_OPTIONS_SUMMARY_CACHE_STALE_TTL_MS,
          }
        : {},
    );
  }
  return payload;
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

export async function listSignalOptionsActivePositionsForDeployment(input: {
  deploymentId: string;
  limit?: number;
}): Promise<{
  positions: SignalOptionsPosition[];
  events: ExecutionEvent[];
}> {
  const events = runtimeSignalOptionsEvents(
    await listDeploymentEvents(
      input.deploymentId,
      input.limit ?? SIGNAL_OPTIONS_STATE_EVENT_LIMIT,
    ),
  );
  const positions = await reconcileActivePositionsWithShadowLedger({
    positions: deriveActivePositions(events),
    events,
  });
  return { positions, events };
}

export function isSignalOptionsPositionInLiveOptionSession(input: {
  position: SignalOptionsPosition;
  now?: Date;
}): boolean {
  return isLiveOptionTradingSession(
    input.now ?? new Date(),
    input.position.selectedContract,
  );
}

export type SignalOptionsActivePositionQuoteManageResult = {
  managed: boolean;
  reason?: string;
  usedShadowMarkFallback?: boolean;
  position?: SignalOptionsPosition;
  marked?: boolean;
  exited?: boolean;
  exitReason?: string | null;
};

async function refreshActivePosition(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  position: SignalOptionsPosition;
  quoteSnapshot?: (QuoteSnapshot & { source?: "ibkr" }) | null;
  quoteSource?: "provider_snapshot" | "provider_stream";
  enforcementSource?: "automation_scan" | "option_quote_tick";
  recordMarkWhenChanged?: boolean;
  now?: Date;
  pyrusSignalsSettings?: Record<string, unknown>;
  recentEvents?: ExecutionEvent[];
  signal?: AbortSignal;
}): Promise<{
  managed: boolean;
  reason?: string;
  usedShadowMarkFallback?: boolean;
  position?: SignalOptionsPosition;
  marked?: boolean;
  exited?: boolean;
  exitReason?: string | null;
}> {
  const contract = input.position.selectedContract;
  const expirationDate = dateOrNull(contract.expirationDate);
  const optionRight = contract.right === "put" ? "put" : "call";
  if (!expirationDate) {
    return { managed: false, reason: "invalid_expiration" };
  }
  const now = input.now ?? new Date();
  if (!isLiveOptionTradingSession(now, contract)) {
    return {
      managed: true,
      reason: SIGNAL_OPTIONS_MARKET_SESSION_QUIET_REASON,
      position: input.position,
    };
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
  const livePositionMarksAllowed =
    getApiResourcePressureSnapshot().caps.signalOptions.positionMarksAllowed;
  const pressureMarkBlockedReason = "resource_pressure_position_marks_blocked";
  const greekPositionManagement = asRecord(
    asRecord(input.profile.exitPolicy).greekPositionManagement,
  );
  const requiresGreekPositionMark =
    input.profile.exitPolicy.wireGreekTrail.enabled === true ||
    greekPositionManagement.enabled === true;
  const useQuote = (
    source: "provider_snapshot" | "provider_stream" | "chain_standard",
    candidateQuote: SignalOptionsOptionQuote | null,
    chainDebug?: unknown,
  ) => {
    const resolution = candidateQuote
      ? resolvePositionMarkQuote({
          quote: candidateQuote,
          profile: input.profile,
        })
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

  if (!livePositionMarksAllowed) {
    markAttempts.push(
      positionMarkAttemptPayload({
        source: providerContractId ? "provider_snapshot" : "chain_standard",
        quote: null,
        reason: pressureMarkBlockedReason,
      }),
    );
  } else if (providerContractId && input.quoteSnapshot) {
    const quoteProviderContractId =
      typeof input.quoteSnapshot.providerContractId === "string"
        ? input.quoteSnapshot.providerContractId.trim()
        : null;
    if (
      quoteProviderContractId &&
      quoteProviderContractId !== providerContractId
    ) {
      markAttempts.push(
        positionMarkAttemptPayload({
          source: input.quoteSource ?? "provider_stream",
          quote: null,
          reason: "provider_contract_mismatch",
        }),
      );
    } else {
      const snapshotQuote = quoteSnapshotToSignalOptionsQuote({
        contract,
        quote: input.quoteSnapshot,
      });
      if (snapshotQuote) {
        useQuote(input.quoteSource ?? "provider_stream", snapshotQuote);
      } else {
        markAttempts.push(
          positionMarkAttemptPayload({
            source: input.quoteSource ?? "provider_stream",
            quote: null,
            reason: "position_mark_unavailable",
          }),
        );
      }
    }
  } else if (providerContractId) {
    const owner = `signal-options-position-mark:${input.deployment.id}:${input.position.id}`;
    declareIbkrLiveDemand({
      underlying: input.position.symbol,
      providerContractIds: [providerContractId],
      owner,
      intent: "automation-live",
      ttlMs: SIGNAL_OPTIONS_LIVE_QUOTE_DEMAND_TTL_MS,
      fallbackProvider: "cache",
      requiresGreeks: requiresGreekPositionMark,
    });
    const demandState = readIbkrLiveDemandState({
      owner,
      underlying: input.position.symbol,
      providerContractIds: [providerContractId],
      requiresGreeks: requiresGreekPositionMark,
    });
    const matchedState =
      demandState.states.find(
        (item) => item.providerContractId?.trim() === providerContractId,
      ) ?? null;
    const matchedQuote = matchedState?.quote ?? null;
    const snapshotQuote = matchedQuote
      ? quoteSnapshotToSignalOptionsQuote({ contract, quote: matchedQuote })
      : null;
    if (snapshotQuote) {
      useQuote("provider_snapshot", snapshotQuote);
    } else {
      markAttempts.push(
        positionMarkAttemptPayload({
          source: "provider_snapshot",
          quote: null,
          reason: matchedState?.reason ?? "position_mark_unavailable",
        }),
      );
    }
  } else {
    const chain = await getOptionChainWithDebug({
      underlying: input.position.symbol,
      expirationDate,
      contractType: optionRight,
      strikesAroundMoney: 1,
      strikeCoverage: "standard",
      quoteHydration: "snapshot",
      signal: input.signal,
    });
    const chainQuote =
      findSignalOptionsQuoteForContract({
        contracts: chain.contracts as SignalOptionsOptionQuote[],
        selectedContract: contract,
      }) ?? null;
    useQuote("chain_standard", chainQuote, chain.debug);
  }

  const emitPositionMarkSkip = async (inputSkip: {
    summary: string;
    message: string;
    quote?: SignalOptionsOptionQuote | null;
    liquidity?: unknown;
    reason?: string;
    detail?: Record<string, unknown>;
  }) => {
    const occurredAt = new Date();
    const reason = inputSkip.reason ?? "position_mark_unavailable";
    if (
      !shouldRecordPositionMarkSkip({
        events: input.recentEvents ?? [],
        position: input.position,
        reason,
        now: occurredAt,
      })
    ) {
      return { managed: false, reason };
    }
    await insertSignalOptionsEvent({
      deployment: input.deployment,
      symbol: input.position.symbol,
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      summary: inputSkip.summary,
      occurredAt,
      payload: {
        reason,
        message: inputSkip.message,
        retryable: true,
        position: input.position,
        selectedContract: input.position.selectedContract,
        quote: inputSkip.quote ? quoteToPayload(inputSkip.quote) : null,
        liquidity: inputSkip.liquidity ?? null,
        markResolution: {
          attempts: markAttempts,
        },
        ...(inputSkip.detail ?? {}),
      },
    });
    return { managed: false, reason };
  };

  const shadowMarkFallback = await readShadowPositionMarkFallback(
    input.position,
  ).catch((error: unknown) => {
    logger.warn?.(
      {
        err: error,
        positionId: input.position.id,
        symbol: input.position.symbol,
      },
      "Failed to read signal-options Shadow position mark fallback",
    );
    return null;
  });
  const fallbackFresh = isFreshShadowPositionMarkFallback({
    fallback: shadowMarkFallback,
    now,
  });
  let quote = markState.quote;
  let markResolution = markState.resolution;
  let markSource = markAttempts.find((attempt) => attempt.ok)?.source ?? null;
  let usedShadowMarkFallback = false;

  if ((!quote || !markResolution?.ok) && fallbackFresh && shadowMarkFallback) {
    quote = quoteFromShadowPositionMarkFallback({
      position: input.position,
      fallback: shadowMarkFallback,
    });
    markResolution = resolvePositionMarkQuote({
      quote,
      profile: input.profile,
    });
    markAttempts.push(
      positionMarkAttemptPayload({
        source: "shadow_position_mark",
        quote,
        reason: markResolution.ok ? null : markResolution.reason,
      }),
    );
    markSource = "shadow_position_mark";
    usedShadowMarkFallback = true;
  }

  if (!quote) {
    return await emitPositionMarkSkip({
      summary: `${input.position.symbol} shadow mark skipped: option quote unavailable`,
      message: "No option quote was returned for the open shadow position.",
      reason: livePositionMarksAllowed
        ? "position_mark_unavailable"
        : pressureMarkBlockedReason,
    });
  }

  if (!markResolution?.ok || markResolution.markPrice == null) {
    return await emitPositionMarkSkip({
      summary: `${input.position.symbol} shadow mark skipped: option mark unavailable`,
      message:
        markResolution?.reason === "quote_not_fresh"
          ? "The option quote was stale or unavailable for the open shadow position."
          : "The option quote did not include a positive mark price.",
      quote,
      liquidity: markResolution?.liquidity ?? null,
      reason: "position_mark_unavailable",
    });
  }

  const liquidity = markResolution.liquidity;
  const markPrice = markResolution.markPrice;
  const currentGreeks = greekSnapshotFromQuote(quote);
  const entryGreeks =
    input.position.entryGreeks ??
    greekSnapshotFromQuote(input.position.selectedContract);
  await persistSignalOptionsQuoteSnapshot({
    contract,
    quote,
    source: `signal-options:${markSource ?? "mark"}`,
  }).catch((error: unknown) => {
    logger.debug?.(
      {
        err: error,
        positionId: input.position.id,
        symbol: input.position.symbol,
      },
      "Signal-options quote greek snapshot persistence skipped",
    );
  });
  const wireContext =
    input.profile.exitPolicy.wireGreekTrail.enabled &&
    input.pyrusSignalsSettings
      ? await loadSignalOptionsWireContextForPosition({
          position: input.position,
          evaluatedAt: now,
          pyrusSignalsSettings: input.pyrusSignalsSettings,
        }).catch((error: unknown) => {
          logger.debug?.(
            {
              err: error,
              positionId: input.position.id,
              symbol: input.position.symbol,
            },
            "Signal-options wire context unavailable for position",
          );
          return null;
        })
      : null;
  const peakPrice = Math.max(
    input.position.peakPrice,
    markPrice,
    shadowMarkFallback?.peakMarkPrice ?? 0,
  );
  const markAt = now;
  const stop = computePositionStop({
    entryPrice: input.position.entryPrice,
    peakPrice,
    markPrice,
    profile: input.profile,
    direction: input.position.direction,
    underlyingSpot: wireContext?.latestClose ?? null,
    wireContext,
    currentGreeks,
    entryGreeks,
    spreadPctOfMid: liquidity.spreadPctOfMid,
    signalQuality: input.position.signalQuality ?? null,
    barsSinceEntry: signalBarsSinceEntry({
      openedAt: input.position.openedAt,
      markAt,
      timeframe: input.position.timeframe,
    }),
  });
  const stopPayload = {
    ...stop,
    enforcementSource: input.enforcementSource ?? "automation_scan",
  };
  const overnight =
    !stop.exitReason && isLiveOvernightExitWindow(markAt)
      ? computeOvernightPositionExit({
          entryPrice: input.position.entryPrice,
          peakPrice,
          markPrice,
          profile: input.profile,
          signalQuality: input.position.signalQuality ?? null,
        })
      : null;
  const exitReason = stop.exitReason ?? overnight?.exitReason ?? null;
  const exitPrice =
    liquidity.bid != null && liquidity.mid != null
      ? Number(
          (liquidity.mid - (liquidity.mid - liquidity.bid) * 0.9).toFixed(2),
        )
      : Number(markPrice.toFixed(2));
  const positionPatch = {
    ...input.position,
    peakPrice,
    stopPrice: stop.stopPrice,
    lastMarkPrice: Number(markPrice.toFixed(2)),
    lastMarkedAt: markAt.toISOString(),
    lastStop: stopPayload as unknown as Record<string, unknown>,
    lastWireTrail: asRecord(stopPayload.wireTrail),
    entryGreeks: entryGreeks ?? currentGreeks ?? null,
    greekBaselineSource: input.position.entryGreeks
      ? (input.position.greekBaselineSource ?? "entry")
      : currentGreeks
        ? "first_mark"
        : (input.position.greekBaselineSource ?? null),
  };

  if (exitReason) {
    const exitQuoteEligible =
      isSignalOptionsLiveExitQuoteEligible({
        quote,
        markSource,
        usedShadowMarkFallback,
      }) ||
      isSignalOptionsShadowMarkFallbackExitEligible({
        deployment: input.deployment,
        fallback: shadowMarkFallback,
        markSource,
        now: markAt,
        position: input.position,
        usedShadowMarkFallback,
      });
    if (!exitQuoteEligible) {
      return await emitPositionMarkSkip({
        summary: `${input.position.symbol} shadow exit skipped: live option quote unavailable`,
        message:
          "The open shadow position crossed an exit threshold, but the mark came from a fallback or non-live option quote.",
        quote,
        liquidity,
        reason: "position_exit_quote_unavailable",
        detail: {
          exitReason,
          markPrice,
          markSource,
          usedShadowMarkFallback,
          position: positionPatch,
          stop: stopPayload,
          overnight,
          shadowPositionMarkFallback: shadowMarkFallback,
        },
      });
    }
    await insertSignalOptionsEvent({
      deployment: input.deployment,
      symbol: input.position.symbol,
      eventType: SIGNAL_OPTIONS_EXIT_EVENT,
      summary: `${input.position.symbol} shadow exit ${exitReason} at ${exitPrice.toFixed(2)}`,
      occurredAt: markAt,
      payload: {
        reason: exitReason,
        exitPrice,
        markPrice,
        pnl: Number(
          (
            (exitPrice - input.position.entryPrice) *
            input.position.quantity *
            100
          ).toFixed(2),
        ),
        position: positionPatch,
        selectedContract: input.position.selectedContract,
        quote: quoteToPayload(quote),
        liquidity,
        markResolution: {
          source: markSource,
          attempts: markAttempts,
          shadowPositionMarkFallback: shadowMarkFallback,
        },
        stop: stopPayload,
        overnight,
      },
    });
    return {
      managed: true,
      usedShadowMarkFallback,
      position: positionPatch,
      exited: true,
      exitReason,
    };
  }

  if (usedShadowMarkFallback) {
    return { managed: true, usedShadowMarkFallback, position: positionPatch };
  }

  const recordChangedTickMark =
    input.recordMarkWhenChanged === true &&
    (peakPrice > input.position.peakPrice ||
      stop.stopPrice !== input.position.stopPrice);
  let marked = false;
  if (
    recordChangedTickMark ||
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
          shadowPositionMarkFallback: shadowMarkFallback,
        },
        stop: stopPayload,
      },
    });
    marked = true;
  }
  return {
    managed: true,
    usedShadowMarkFallback,
    position: positionPatch,
    marked,
  };
}

export async function manageSignalOptionsActivePositionQuote(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  position: SignalOptionsPosition;
  quote: QuoteSnapshot & { source?: "ibkr" };
  pyrusSignalsSettings?: Record<string, unknown> | null;
  recentEvents?: ExecutionEvent[];
  signal?: AbortSignal;
  now?: Date;
}): Promise<SignalOptionsActivePositionQuoteManageResult> {
  return refreshActivePosition({
    deployment: input.deployment,
    profile: input.profile,
    position: input.position,
    quoteSnapshot: input.quote,
    quoteSource: "provider_stream",
    enforcementSource: "option_quote_tick",
    recordMarkWhenChanged: true,
    pyrusSignalsSettings: input.pyrusSignalsSettings ?? undefined,
    recentEvents: input.recentEvents,
    signal: input.signal,
    now: input.now,
  });
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

function candidateContractSelectionEventExists(input: {
  candidate: SignalOptionsCandidate;
  recentEvents?: ExecutionEvent[] | null;
}) {
  const candidateId = compactString(input.candidate.id);
  if (!candidateId || !input.recentEvents?.length) {
    return false;
  }
  return input.recentEvents.some((event) => {
    if (event.eventType !== SIGNAL_OPTIONS_CANDIDATE_EVENT) {
      return false;
    }
    const payload = asRecord(event.payload);
    const eventCandidate = asRecord(payload.candidate);
    return (
      compactString(eventCandidate.id) === candidateId ||
      compactString(payload.candidateId) === candidateId
    );
  });
}

async function emitCandidateContractSelected(input: {
  deployment: AlgoDeployment;
  candidate: SignalOptionsCandidate;
  signalKey: string;
  recentEvents?: ExecutionEvent[] | null;
  selectedExpiration: Record<string, unknown> | null;
  selectedContract: Record<string, unknown>;
  quote: Record<string, unknown> | null;
  orderPlan: Record<string, unknown> | null;
  liquidity: Record<string, unknown> | null;
  contractSelection: Record<string, unknown> | null;
  chainDebug: Record<string, unknown> | null;
  chainAttempts: SignalOptionsChainAttempt[];
  liveQuoteDemand?: Record<string, unknown> | null;
}) {
  if (candidateContractSelectionEventExists(input)) {
    return;
  }
  await insertSignalOptionsEvent({
    deployment: input.deployment,
    symbol: input.candidate.symbol,
    eventType: SIGNAL_OPTIONS_CANDIDATE_EVENT,
    summary: `${input.candidate.symbol} shadow contract selected: ${input.selectedContract.strike ?? "strike"} ${input.selectedContract.expirationDate ?? "expiry"}`,
    payload: {
      diagnosticSignalKey: input.signalKey,
      signal: input.candidate.signal ?? null,
      action: input.candidate.action ?? null,
      candidate: {
        ...input.candidate,
        status: "candidate",
        selectedContract: input.selectedContract,
        quote: input.quote,
        orderPlan: input.orderPlan,
        liquidity: input.liquidity,
      },
      selectedExpiration: input.selectedExpiration,
      selectedContract: input.selectedContract,
      quote: input.quote,
      orderPlan: input.orderPlan,
      liquidity: input.liquidity,
      contractSelection: input.contractSelection,
      chainDebug: input.chainDebug,
      chainAttempts: input.chainAttempts,
      liveQuoteDemand: input.liveQuoteDemand ?? null,
    },
  });
}

async function resolveSignalOptionsCandidateContract(input: {
  candidate: SignalOptionsCandidate;
  profile: SignalOptionsExecutionProfile;
  bypassBridgeBackoff?: boolean;
  quoteHydration?: SignalOptionsContractQuoteHydration;
  allowDelayedSnapshotHydration?: boolean;
  greekSelectorRuntimeMode?: SignalOptionsGreekSelectorRuntimeMode;
  liveQuoteDemand?: SignalOptionsLiveQuoteDemandConfig | null;
  onMetadataSelected?: (selection: {
    selectedExpiration: Record<string, unknown> | null;
    selectedContract: Record<string, unknown>;
    quote: Record<string, unknown> | null;
    orderPlan: Record<string, unknown> | null;
    liquidity: Record<string, unknown> | null;
    contractSelection: Record<string, unknown> | null;
    chainDebug: Record<string, unknown> | null;
    chainAttempts: SignalOptionsChainAttempt[];
  }) => Promise<void> | void;
  signal?: AbortSignal;
}) {
  const bypassBridgeBackoff = input.bypassBridgeBackoff ?? true;
  const greekSelectorRuntimeMode: SignalOptionsGreekSelectorRuntimeMode =
    input.greekSelectorRuntimeMode ??
    (input.liveQuoteDemand ? "live" : "shadow");
  const greekSelectorEnabled = isSignalOptionsGreekSelectorEnabled({
    profile: input.profile,
    runtimeMode: greekSelectorRuntimeMode,
  });
  const quoteHydration =
    greekSelectorEnabled &&
    input.profile.optionSelection.greekSelector.requireLiveGreeks
      ? "snapshot"
      : (input.quoteHydration ?? "snapshot");
  const expirations = await getOptionExpirationsWithDebug({
    underlying: input.candidate.symbol,
    recordBridgeFailure: false,
    bypassBridgeBackoff,
    signal: input.signal,
  });
  const selectedExpiration = selectSignalOptionsExpiration(
    expirations.expirations,
    input.profile,
  );
  if (!selectedExpiration) {
    const expirationBackoff = optionBackoffFromDebug({
      debug: expirations.debug,
      reason: "option_expiration_backoff",
      source: "expiration",
    });
    return {
      selectedExpiration: null,
      selectedQuote: null,
      selectedContract: null,
      quote: null,
      orderPlan: null,
      liquidity: null,
      entryGreeks: null,
      contractSelection: null,
      contractSelectionPayload: null,
      chainDebug: null,
      chainAttempts: [] as SignalOptionsChainAttempt[],
      reason: expirationBackoff?.reason ?? "no_expiration_in_dte_window",
      detail: {
        expirationsDebug: expirations.debug,
        ...(expirationBackoff ? optionBackoffPayload(expirationBackoff) : {}),
      },
      retryable: Boolean(expirationBackoff),
    };
  }

  const strikesAroundMoney = signalOptionsStrikesAroundMoney({
    profile: input.profile,
    optionRight: input.candidate.optionRight,
  });
  const chain = await getOptionChainWithDebug({
    underlying: input.candidate.symbol,
    expirationDate: selectedExpiration.expirationDate,
    contractType: input.candidate.optionRight,
    strikesAroundMoney,
    strikeCoverage: "standard",
    quoteHydration,
    allowDelayedSnapshotHydration: input.allowDelayedSnapshotHydration,
    recordBridgeFailure: false,
    bypassBridgeBackoff,
    signal: input.signal,
  });
  const contractSelection = selectSignalOptionsContractPlanFromChain({
    contracts: chain.contracts as SignalOptionsOptionQuote[],
    direction: input.candidate.direction,
    signalPrice: input.candidate.signalPrice,
    profile: input.profile,
    runtimeMode: greekSelectorRuntimeMode,
  });
  const chainAttempts: SignalOptionsChainAttempt[] = [
    {
      source: "bounded",
      strikeCoverage: "standard",
      strikesAroundMoney,
      contractCount: chain.contracts.length,
      selectedQuote: Boolean(contractSelection.selectedQuote),
      chainDebug: chain.debug,
    },
  ];

  const selectedExpirationPayload =
    signalOptionsSelectedExpirationPayload(selectedExpiration);
  const greekSelection = greekSelectorEnabled
    ? selectSignalOptionsGreekContractPlanFromChain({
        contracts: chain.contracts as SignalOptionsOptionQuote[],
        direction: input.candidate.direction,
        signalPrice: input.candidate.signalPrice,
        profile: input.profile,
      })
    : null;
  let selectedBy: "greek" | "legacy" | "fallback_legacy" = "legacy";
  let selectedQuote = contractSelection.selectedQuote;
  let orderPlan = contractSelection.orderPlan;
  if (greekSelection) {
    if (greekSelection.selectedQuote) {
      selectedBy = "greek";
      selectedQuote = greekSelection.selectedQuote;
      orderPlan = greekSelection.orderPlan;
    } else if (input.profile.optionSelection.greekSelector.fallbackToLegacy) {
      selectedBy = "fallback_legacy";
    } else {
      selectedBy = "greek";
      selectedQuote = null;
      orderPlan = null;
    }
  }
  if (!selectedQuote) {
    const contractSelectionPayload =
      signalOptionsContractSelectionPayload(contractSelection, {
        greekSelection,
        selectedBy,
      });
    const chainBackoff = optionChainBackoffFromAttempts(chainAttempts);
    return {
      selectedExpiration,
      selectedQuote: null,
      selectedContract: null,
      quote: null,
      orderPlan: null,
      liquidity: null,
      entryGreeks: null,
      contractSelection,
      contractSelectionPayload,
      chainDebug: chain.debug,
      chainAttempts,
      reason:
        greekSelection?.fallbackReason ??
        chainBackoff?.reason ??
        "no_contract_for_strike_slot",
      detail: {
        selectedExpiration: selectedExpirationPayload,
        chainDebug: chain.debug,
        chainAttempts,
        retryable: true,
        ...(chainBackoff ? optionBackoffPayload(chainBackoff) : {}),
        contractSelection: contractSelectionPayload,
      },
      retryable: true,
    };
  }

  let selectedContract = contractToPayload(selectedQuote);
  const contractSelectionPayload =
    signalOptionsContractSelectionPayload(contractSelection, {
      greekSelection,
      selectedBy,
    });
  if (input.onMetadataSelected) {
    await input.onMetadataSelected({
      selectedExpiration: selectedExpirationPayload,
      selectedContract,
      quote: quoteToPayload(selectedQuote),
      orderPlan,
      liquidity: orderPlan?.liquidity ?? null,
      contractSelection: Object.keys(asRecord(contractSelectionPayload)).length
        ? asRecord(contractSelectionPayload)
        : null,
      chainDebug: chain.debug,
      chainAttempts,
    });
  }
  let liveQuoteDemandPayload: ReturnType<
    typeof signalOptionsLiveQuoteDemandPayload
  > | null = null;
  const providerContractId = compactString(selectedContract.providerContractId);
  if (input.liveQuoteDemand && providerContractId) {
    const requiresGreeks = input.liveQuoteDemand.requiresGreeks ?? true;
    const liveQuoteTtlMs =
      input.liveQuoteDemand.ttlMs ?? SIGNAL_OPTIONS_LIVE_QUOTE_DEMAND_TTL_MS;
    const hydrationStartedAt = Date.now();
    let hydrationAttempts = 0;
    let snapshotDebug: unknown = null;
    declareIbkrLiveDemand({
      underlying: input.candidate.symbol,
      providerContractIds: [providerContractId],
      owner: input.liveQuoteDemand.owner,
      intent: input.liveQuoteDemand.intent ?? "automation-live",
      ttlMs: liveQuoteTtlMs,
      fallbackProvider: input.liveQuoteDemand.fallbackProvider ?? "cache",
      requiresGreeks,
    });
    while (true) {
      throwIfSignalOptionsScanAborted(input.signal);
      hydrationAttempts += 1;
      const snapshotPayload = await fetchBridgeOptionQuoteSnapshots({
        underlying: input.candidate.symbol,
        providerContractIds: [providerContractId],
        owner: input.liveQuoteDemand.owner,
        intent: input.liveQuoteDemand.intent ?? "automation-live",
        ttlMs: liveQuoteTtlMs,
        fallbackProvider: input.liveQuoteDemand.fallbackProvider ?? "cache",
        requiresGreeks,
        releaseLeasesOnComplete: false,
        signal: input.signal,
      });
      snapshotDebug = snapshotPayload.debug ?? null;
      const snapshotQuote =
        snapshotPayload.quotes.find(
          (item) =>
            item.providerContractId?.trim?.() === providerContractId,
        ) ?? null;
      const demandState = readIbkrLiveDemandState({
        owner: input.liveQuoteDemand.owner,
        underlying: input.candidate.symbol,
        providerContractIds: [providerContractId],
        requiresGreeks,
      });
      liveQuoteDemandPayload = signalOptionsLiveQuoteDemandPayload({
        owner: input.liveQuoteDemand.owner,
        providerContractId,
        requiresGreeks,
        state: demandState,
        snapshotDebug,
        hydrationAttempts,
        hydrationWaitMs: Date.now() - hydrationStartedAt,
      });
      const matchedState =
        demandState.states.find(
          (item) => item.providerContractId === providerContractId,
        ) ?? null;
      const liveQuote = snapshotQuote
        ? quoteSnapshotToSignalOptionsQuote({
            contract: selectedContract,
            quote: snapshotQuote,
          })
        : matchedState?.quote
          ? quoteSnapshotToSignalOptionsQuote({
              contract: selectedContract,
              quote: matchedState.quote,
            })
          : null;
      if (liveQuote) {
        const liveOrderPlan = buildSignalOptionsShadowOrderPlan(
          liveQuote,
          input.profile,
        );
        selectedQuote = liveQuote;
        orderPlan = liveOrderPlan;
        selectedContract = contractToPayload(selectedQuote);
      }
      if (
        !signalOptionsSelectedLiveQuoteNeedsRetry({
          quote: selectedQuote,
          orderPlan,
        })
      ) {
        break;
      }
      const elapsedMs = Date.now() - hydrationStartedAt;
      const remainingMs =
        SIGNAL_OPTIONS_SELECTED_LIVE_QUOTE_SETTLE_MS - elapsedMs;
      if (remainingMs <= 0) {
        break;
      }
      await waitForSignalOptionsDelay(
        Math.min(
          SIGNAL_OPTIONS_SELECTED_LIVE_QUOTE_RETRY_INTERVAL_MS,
          remainingMs,
        ),
        input.signal,
      );
    }
  }
  const quote = quoteToPayload(selectedQuote);
  const entryGreeks = greekSnapshotFromQuote(selectedQuote);
  return {
    selectedExpiration,
    selectedQuote,
    selectedContract,
    quote,
    orderPlan,
    liquidity: orderPlan?.liquidity ?? null,
    entryGreeks,
    contractSelection,
    contractSelectionPayload,
    chainDebug: chain.debug,
    chainAttempts,
    reason: null,
    detail: {
      selectedExpiration: selectedExpirationPayload,
      chainDebug: chain.debug,
      chainAttempts,
      contractSelection: contractSelectionPayload,
      ...(liveQuoteDemandPayload
        ? { liveQuoteDemand: liveQuoteDemandPayload }
        : {}),
    },
    retryable: false,
  };
}

function signalOptionsLiveQuoteDemandDetailFromResolution(
  detail: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const liveQuoteDemand = asRecord(detail).liveQuoteDemand;
  return liveQuoteDemand == null ? {} : { liveQuoteDemand };
}

function unavailableSignalOptionsContractPreview(input: {
  candidate: SignalOptionsCandidate | null;
  reason: string;
  detail?: Record<string, unknown> | null;
  generatedAt: string;
}): SignalOptionsContractPreview {
  return {
    status: "unavailable",
    source: "profile_contract_preview",
    action: input.candidate
      ? buildSignalOptionsActionMapping(input.candidate.direction)
      : null,
    basisPrice: input.candidate?.signalPrice ?? null,
    selectedContract: null,
    quote: null,
    liquidity: null,
    orderPlan: null,
    contractSelection: null,
    selectedExpiration: null,
    reason: input.reason,
    detail: input.detail ?? null,
    tradeReady: false,
    generatedAt: input.generatedAt,
  };
}

function signalOptionsContractPreviewFromResolution(input: {
  candidate: SignalOptionsCandidate;
  resolution: Awaited<ReturnType<typeof resolveSignalOptionsCandidateContract>>;
  generatedAt: string;
}): SignalOptionsContractPreview {
  const { candidate, resolution } = input;
  if (!resolution.selectedContract || !resolution.quote) {
    return unavailableSignalOptionsContractPreview({
      candidate,
      reason: resolution.reason ?? "contract_preview_unavailable",
      detail: resolution.detail,
      generatedAt: input.generatedAt,
    });
  }

  const orderPlan = asRecord(resolution.orderPlan);
  const tradeReady = orderPlan.ok === true;
  const reason = tradeReady
    ? null
    : compactString(orderPlan.reason) ??
      resolution.reason ??
      "liquidity_gate_failed";
  return {
    status: "resolved",
    source: "profile_contract_preview",
    action: buildSignalOptionsActionMapping(candidate.direction),
    basisPrice: candidate.signalPrice,
    selectedContract: resolution.selectedContract,
    quote: resolution.quote,
    liquidity: Object.keys(asRecord(resolution.liquidity)).length
      ? asRecord(resolution.liquidity)
      : null,
    orderPlan: Object.keys(orderPlan).length ? orderPlan : null,
    contractSelection: Object.keys(asRecord(resolution.contractSelectionPayload)).length
      ? asRecord(resolution.contractSelectionPayload)
      : null,
    selectedExpiration:
      signalOptionsSelectedExpirationPayload(resolution.selectedExpiration),
    reason,
    detail: resolution.detail,
    tradeReady,
    generatedAt: input.generatedAt,
  };
}

function signalOptionsContractPreviewBackoffKey(input: {
  deploymentId: string;
  signal: SignalOptionsSignalSnapshot;
}) {
  return [
    input.deploymentId,
    input.signal.signalKey ||
      `${input.signal.symbol}:${input.signal.direction ?? ""}:${input.signal.signalAt ?? ""}`,
  ].join(":");
}

function readSignalOptionsContractPreviewBackoff(key: string, now = Date.now()) {
  const retryAt = signalOptionsContractPreviewBackoff.get(key);
  if (!retryAt) {
    return null;
  }
  if (retryAt <= now) {
    signalOptionsContractPreviewBackoff.delete(key);
    return null;
  }
  return retryAt;
}

async function resolveSignalOptionsContractPreview(input: {
  candidate: SignalOptionsCandidate;
  profile: SignalOptionsExecutionProfile;
  generatedAt: string;
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(
    1,
    Math.min(
      input.timeoutMs ?? SIGNAL_OPTIONS_CONTRACT_PREVIEW_TIMEOUT_MS,
      SIGNAL_OPTIONS_CONTRACT_PREVIEW_TIMEOUT_MS,
    ),
  );
  const timeout = setTimeout(() => {
    controller.abort(new Error("contract_preview_timeout"));
  }, timeoutMs);
  timeout.unref?.();
  try {
    const resolution = await resolveSignalOptionsCandidateContract({
      candidate: input.candidate,
      profile: input.profile,
      bypassBridgeBackoff: false,
      signal: controller.signal,
    });
    return signalOptionsContractPreviewFromResolution({
      candidate: input.candidate,
      resolution,
      generatedAt: input.generatedAt,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return unavailableSignalOptionsContractPreview({
        candidate: input.candidate,
        reason: "contract_preview_timeout",
        detail: {
          timeoutMs,
        },
        generatedAt: input.generatedAt,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function attachSignalOptionsContractPreviews(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  signals: SignalOptionsSignalSnapshot[];
}) {
  const generatedAt = new Date().toISOString();
  const previewDeadlineMs =
    Date.now() + SIGNAL_OPTIONS_CONTRACT_PREVIEW_STATE_BUDGET_MS;
  let previewCount = 0;
  const enriched: SignalOptionsSignalSnapshot[] = [];
  for (const signal of input.signals) {
    const needsPreview =
      signal.actionEligible === false || Boolean(signal.actionBlocker);
    if (!needsPreview) {
      enriched.push({ ...signal, contractPreview: null });
      continue;
    }

    const backoffKey = signalOptionsContractPreviewBackoffKey({
      deploymentId: input.deployment.id,
      signal,
    });
    const previewRetryAt = readSignalOptionsContractPreviewBackoff(backoffKey);
    const candidate = previewCandidateFromSignalSnapshot({
      deployment: input.deployment,
      signal,
    });
    if (!candidate) {
      enriched.push({
        ...signal,
        contractPreview: unavailableSignalOptionsContractPreview({
          candidate,
          reason: "contract_preview_unavailable",
          generatedAt,
        }),
      });
      continue;
    }
    if (previewRetryAt) {
      enriched.push({
        ...signal,
        contractPreview: unavailableSignalOptionsContractPreview({
          candidate,
          reason: "contract_preview_backoff",
          detail: { retryAfterMs: Math.max(0, previewRetryAt - Date.now()) },
          generatedAt,
        }),
      });
      continue;
    }
    if (previewCount >= SIGNAL_OPTIONS_CONTRACT_PREVIEW_LIMIT) {
      enriched.push({
        ...signal,
        contractPreview: unavailableSignalOptionsContractPreview({
          candidate,
          reason: "contract_preview_limit_exceeded",
          generatedAt,
        }),
      });
      continue;
    }
    const remainingBudgetMs = previewDeadlineMs - Date.now();
    if (remainingBudgetMs <= 0) {
      signalOptionsContractPreviewBackoff.set(
        backoffKey,
        Date.now() + SIGNAL_OPTIONS_CONTRACT_PREVIEW_TIMEOUT_BACKOFF_MS,
      );
      enriched.push({
        ...signal,
        contractPreview: unavailableSignalOptionsContractPreview({
          candidate,
          reason: "contract_preview_timeout",
          detail: {
            timeoutMs: SIGNAL_OPTIONS_CONTRACT_PREVIEW_STATE_BUDGET_MS,
            scope: "state_payload",
          },
          generatedAt,
        }),
      });
      continue;
    }

    previewCount += 1;
    try {
      const preview = await resolveSignalOptionsContractPreview({
        candidate,
        profile: input.profile,
        generatedAt,
        timeoutMs: Math.min(
          SIGNAL_OPTIONS_CONTRACT_PREVIEW_TIMEOUT_MS,
          remainingBudgetMs,
        ),
      });
      if (preview.reason === "contract_preview_timeout") {
        signalOptionsContractPreviewBackoff.set(
          backoffKey,
          Date.now() + SIGNAL_OPTIONS_CONTRACT_PREVIEW_TIMEOUT_BACKOFF_MS,
        );
      }
      enriched.push({
        ...signal,
        contractPreview: preview,
      });
    } catch (error) {
      logger.debug?.(
        {
          err: error,
          deploymentId: input.deployment.id,
          symbol: candidate.symbol,
        },
        "Signal-options contract preview unavailable",
      );
      enriched.push({
        ...signal,
        contractPreview: unavailableSignalOptionsContractPreview({
          candidate,
          reason: "contract_preview_unavailable",
          detail: {
            message: error instanceof Error ? error.message : String(error),
          },
          generatedAt,
        }),
      });
    }
  }
  return enriched;
}

async function processEntryCandidate(input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  candidate: SignalOptionsCandidate;
  signalKey: string;
  executionBlocker?: SignalOptionsExecutionBlocker | null;
  recentEvents?: ExecutionEvent[] | null;
  signal?: AbortSignal;
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

  if (
    input.executionBlocker &&
    GATEWAY_READINESS_SKIP_REASONS.has(input.executionBlocker.reason)
  ) {
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason: input.executionBlocker.reason,
      detail: {
        ...(input.executionBlocker.detail ?? {}),
        preflight: true,
      },
    });
    return false;
  }

  let contractSelectedEventEmitted = false;
  const contractResolution = await resolveSignalOptionsCandidateContract({
    candidate: input.candidate,
    profile: input.profile,
    bypassBridgeBackoff: true,
    quoteHydration: "metadata",
    allowDelayedSnapshotHydration: false,
    greekSelectorRuntimeMode:
      input.deployment.providerAccountId === SHADOW_PROVIDER_ACCOUNT_ID
        ? "shadow"
        : "live",
    liveQuoteDemand: input.executionBlocker
      ? null
      : {
          owner: `signal-options-entry:${input.deployment.id}:${input.signalKey}`,
          intent: "automation-live",
          ttlMs: SIGNAL_OPTIONS_LIVE_QUOTE_DEMAND_TTL_MS,
          fallbackProvider: "cache",
          requiresGreeks: true,
        },
    onMetadataSelected: async (selection) => {
      if (contractSelectedEventEmitted) {
        return;
      }
      contractSelectedEventEmitted = true;
      await emitCandidateContractSelected({
        deployment: input.deployment,
        candidate: input.candidate,
        signalKey: input.signalKey,
        recentEvents: input.recentEvents,
        ...selection,
      }).catch((error: unknown) => {
        logger.warn?.(
          {
            err: error,
            deploymentId: input.deployment.id,
            candidateId: input.candidate.id,
          },
          "Failed to record signal-options candidate contract-selection diagnostics",
        );
      });
    },
    signal: input.signal,
  });
  const selectedExpiration = contractResolution.selectedExpiration;
  if (!selectedExpiration) {
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason: contractResolution.reason ?? "no_expiration_in_dte_window",
      detail: contractResolution.detail,
    });
    return false;
  }

  const selectedQuote = contractResolution.selectedQuote;
  const decisionSnapshot = await recordSignalOptionsDecisionSnapshots({
    deployment: input.deployment,
    candidate: input.candidate,
    selectedQuote,
    contractSelectionPayload: contractResolution.contractSelectionPayload,
  });
  if (!selectedQuote) {
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason: contractResolution.reason ?? "no_contract_for_strike_slot",
      detail: {
        ...asRecord(contractResolution.detail),
        decisionSnapshot,
      },
    });
    return false;
  }

  const orderPlan = contractResolution.orderPlan;
  const selectedContract = contractResolution.selectedContract;
  const quote = contractResolution.quote;
  const entryGreeks = contractResolution.entryGreeks;
  const contractSelection = contractResolution.contractSelection;
  const contractSelectionPayload = contractResolution.contractSelectionPayload;
  const selectedExpirationPayload =
    signalOptionsSelectedExpirationPayload(selectedExpiration);
  const chainDebug = contractResolution.chainDebug;
  const chainAttempts = contractResolution.chainAttempts;
  const entryNow = new Date();
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
        contractSelection: contractSelectionPayload,
        selectedExpiration: selectedExpirationPayload,
        chainDebug,
        chainAttempts,
        ...signalOptionsLiveQuoteDemandDetailFromResolution(
          contractResolution.detail,
        ),
        decisionSnapshot,
      },
    });
    return false;
  }

  if (!isLiveOptionTradingSession(entryNow, selectedContract)) {
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason: "after_hours_option_entry_blocked",
      detail: {
        retryable: true,
        selectedContract,
        quote,
        orderPlan,
        liquidity: orderPlan.liquidity,
        contractSelection: contractSelectionPayload,
        selectedExpiration: selectedExpirationPayload,
        chainDebug,
        chainAttempts,
        decisionSnapshot,
      },
    });
    return false;
  }

  if (input.executionBlocker) {
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason: input.executionBlocker.reason,
      detail: {
        ...(input.executionBlocker.detail ?? {}),
        selectedContract,
        quote,
        liquidity: orderPlan.liquidity,
        orderPlan,
        contractSelection: contractSelectionPayload,
        selectedExpiration: selectedExpirationPayload,
        chainDebug,
        chainAttempts,
        decisionSnapshot,
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
        decisionSnapshot,
      },
    });
    return false;
  }

  const stopPrice = buildInitialStopPrice(simulatedFillPrice, input.profile);
  const signalQuality = classifySignalOptionsEntryQuality({
    candidate: {
      ...input.candidate,
      selectedContract,
      quote,
      orderPlan,
      liquidity: orderPlan.liquidity,
    },
    orderPlan,
  });
  const position = {
    id: `${input.deployment.id}:${input.candidate.symbol}`,
    candidateId: input.candidate.id,
    symbol: input.candidate.symbol,
    direction: input.candidate.direction,
    optionRight: input.candidate.optionRight,
    timeframe: input.candidate.timeframe,
    signalAt: input.candidate.signalAt,
    openedAt: entryNow.toISOString(),
    entryPrice: simulatedFillPrice,
    quantity,
    peakPrice: simulatedFillPrice,
    stopPrice,
    premiumAtRisk,
    selectedContract,
    signalQuality,
    entryGreeks,
    greekBaselineSource: entryGreeks ? "entry" : null,
  };

  await persistSignalOptionsQuoteSnapshot({
    contract: selectedContract,
    quote: selectedQuote,
    source: "signal-options:entry",
  }).catch((error: unknown) => {
    logger.debug?.(
      { err: error, symbol: input.candidate.symbol },
      "Signal-options entry greek snapshot persistence skipped",
    );
  });

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
        signalQuality,
      },
      profile: input.profile,
      selectedExpiration: selectedExpirationPayload,
      selectedContract,
      quote,
      orderPlan,
      liquidity: orderPlan.liquidity,
      position,
      chainDebug,
      contractSelection: contractSelectionPayload,
      decisionSnapshot,
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
  const now = new Date();
  if (!isLiveOptionTradingSession(now, input.position.selectedContract)) {
    await emitSkippedCandidate({
      deployment: input.deployment,
      candidate: input.candidate,
      signalKey: input.signalKey,
      reason: "after_hours_option_exit_blocked",
      detail: {
        retryable: true,
        intendedExitReason: "opposite_signal",
        intendedExitPrice: exitPrice,
        position: input.position,
      },
    });
    return false;
  }
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
        (
          (exitPrice - input.position.entryPrice) *
          input.position.quantity *
          100
        ).toFixed(2),
      ),
      position: input.position,
      selectedContract: input.position.selectedContract,
      profile: input.profile,
    },
  });
  return true;
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
  const symbol = normalizeSymbol(
    String(input.deviation.symbol ?? ""),
  ).toUpperCase();
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
    signalQuality?: SignalOptionsEntryQuality | null;
    wireTrail?: Record<string, unknown> | null;
    greekManagement?: Record<string, unknown> | null;
    postExitOutcome?: {
      bars: number;
      highPrice: number | null;
      highAt: string | null;
      lowPrice: number | null;
      lowAt: string | null;
      lastClose: number | null;
      lastAt: string | null;
      highVsExitPct: number | null;
      lastVsExitPct: number | null;
      recoveredEntry: boolean;
      reachedTwentyFivePctGain: boolean;
      reachedFiftyPctGain: boolean;
      finalAboveExit: boolean;
      finalAboveEntry: boolean;
    } | null;
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

const PYRUS_SIGNALS_SETTINGS_PATCH_GROUPS: Readonly<
  Record<string, readonly string[]>
> = {
  marketStructure: [
    "timeHorizon",
    "bosConfirmation",
    "chochAtrBuffer",
    "atrBuffer",
    "chochBodyExpansionAtr",
    "bodyExpansionAtr",
    "bodyExpansion",
    "chochVolumeGate",
    "volumeGate",
  ],
  bands: ["basisLength", "atrLength", "atrSmoothing", "volatilityMultiplier"],
  overlays: ["shadowLength", "shadowStdDev"],
  confirmation: [
    "adxLength",
    "volumeMaLength",
    "mtf1",
    "mtf2",
    "mtf3",
    "signalFiltersEnabled",
    "filtersEnabled",
    "requireMtf1",
    "requireMtf2",
    "requireMtf3",
    "requireAdx",
    "adxMin",
    "requireVolScoreRange",
    "volScoreMin",
    "volScoreMax",
    "restrictToSelectedSessions",
    "sessions",
  ],
  appearance: ["waitForBarClose"],
  risk: ["signalOffsetAtr"],
};

function mergePyrusSignalsSettingsPatch(
  current: Record<string, unknown>,
  patchInput: unknown,
): Record<string, unknown> {
  const patch = asRecord(patchInput);
  const merged: Record<string, unknown> = {
    ...current,
    ...patch,
  };

  for (const [group, keys] of Object.entries(
    PYRUS_SIGNALS_SETTINGS_PATCH_GROUPS,
  )) {
    const currentGroup = asRecord(current[group]);
    const patchGroup = asRecord(patch[group]);
    const nextGroup: Record<string, unknown> = {
      ...currentGroup,
      ...patchGroup,
    };

    for (const key of keys) {
      if (Object.hasOwn(patch, key)) {
        nextGroup[key] = patch[key];
      }
    }

    if (Object.keys(nextGroup).length > 0) {
      merged[group] = nextGroup;
    }
  }

  return merged;
}

type HistoricalBackfillSignal = {
  symbol: string;
  signal: PyrusSignalsSignalEvent;
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
  structuralContexts: SignalOptionsWireContext[];
  nextBarIndex: number;
  nextStructuralIndex: number;
  currentWireContext: SignalOptionsWireContext | null;
};

export type SignalOptionsGreekSelectorSmokeCandidate = {
  ticker: string;
  expirationDate: string;
  dte: number;
  strike: number;
  right: OptionRight;
  entryAt: string;
  entryPrice: number;
  exitAt: string | null;
  exitPrice: number | null;
  quantity: number;
  pnl: number | null;
  volume: number | null;
  greeks: OptionGreekSnapshot;
  score: OptionGreekScore;
};

export type SignalOptionsGreekSelectorSmokeRow = {
  candidateId: string;
  symbol: string;
  direction: SignalDirection;
  signalAt: string;
  underlyingPrice: number | null;
  outcome: "closed_trade" | "end_of_window_mark" | "unmarked";
  legacy: {
    ticker: string | null;
    expirationDate: string | null;
    strike: number | null;
    right: string | null;
    entryPrice: number | null;
    exitPrice: number | null;
    quantity: number | null;
    pnl: number | null;
    closedAt: string | null;
  };
  selected: SignalOptionsGreekSelectorSmokeCandidate | null;
  candidatesScored: number;
  candidatesSkipped: number;
  skipReasons: Record<string, number>;
  topCandidates: SignalOptionsGreekSelectorSmokeCandidate[];
  pnlDelta: number | null;
  notes: string[];
};

export type SignalOptionsGreekSelectorSmokeResult = {
  generatedAt: string;
  date: string;
  deployment: {
    id: string;
    name: string;
    mode: AlgoDeployment["mode"];
  };
  window: Record<string, unknown>;
  timeframe: SignalMonitorTimeframe;
  config: {
    maxSignals: number | null;
    maxCandidatesPerSignal: number;
    riskFreeRate: number;
    dividendYield: number;
  };
  summary: {
    actionCandidates: number;
    reportedSignals: number;
    legacyClosedTrades: number;
    comparedSignals: number;
    changedSelections: number;
    totalLegacyPnl: number;
    totalSelectedPnl: number;
    totalPnlDelta: number;
    totalSelectedMarkedPnl: number;
    candidatesScored: number;
    candidatesSkipped: number;
    skipReasons: Record<string, number>;
    rowsWithSelection: number;
    rowsWithMarkedPnl: number;
    rowsWithoutSelection: number;
  };
  rows: SignalOptionsGreekSelectorSmokeRow[];
  errors: Array<{ symbol?: string | null; message: string }>;
};

const DEFAULT_SIGNAL_OPTIONS_BACKFILL_START = "2026-04-01";
const DEFAULT_SIGNAL_OPTIONS_STRATEGY_NAME = "Pyrus Signals Options Shadow";
const DEFAULT_SIGNAL_OPTIONS_DEPLOYMENT_NAME =
  "Pyrus Signals Options Shadow Paper";
const LEGACY_SIGNAL_OPTIONS_DEPLOYMENT_NAME = "Pyrus Signals Shadow Paper";
const SIGNAL_OPTIONS_BACKFILL_SOURCE = "signal_options_backfill";
const SIGNAL_OPTIONS_BACKFILL_VERSION = 1;
const SIGNAL_OPTIONS_OPTION_MARK_TIMEFRAME = "1m";
const BACKFILL_WARMUP_DAYS = 90;
const BACKFILL_OPTION_BAR_LIMIT = 5_000;
const BACKFILL_OPTION_TRADE_LIMIT = 50_000;
const HISTORICAL_OPTION_TRADE_FILL_MAX_DELAY_MS = 60_000;
const HISTORICAL_OPTION_ENTRY_BAR_MAX_DELAY_MS = 60_000;
const BACKFILL_EQUITY_BAR_MIN_LIMIT = Math.max(
  1_500,
  PYRUS_SIGNALS_SIGNAL_WARMUP_BARS + 500,
);
const BACKFILL_EQUITY_BAR_LIMIT_CUSHION = 500;
const REGULAR_MARKET_SESSION_MINUTES = 6.5 * 60;
const HISTORICAL_BACKFILL_SIGNALS_CACHE_MAX_ENTRIES = 24;
const HISTORICAL_OPTION_RESOLUTION_CACHE_MAX_ENTRIES = 10_000;
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
const historicalBackfillSignalsCache = new Map<
  string,
  Promise<{
    signals: HistoricalBackfillSignal[];
    errors: SignalOptionsBackfillSummary["errors"];
    structuralContextsBySymbol: Record<string, SignalOptionsWireContext[]>;
  }>
>();
const historicalOptionResolutionCache = new Map<
  string,
  Promise<HistoricalBackfillResolvedOption | null>
>();

function rememberBoundedCacheEntry<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  maxEntries: number,
) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function cacheJson(value: unknown) {
  return JSON.stringify(value);
}

function cloneHistoricalBackfillSignalsResult(input: {
  signals: HistoricalBackfillSignal[];
  errors: SignalOptionsBackfillSummary["errors"];
  structuralContextsBySymbol: Record<string, SignalOptionsWireContext[]>;
}) {
  return {
    signals: input.signals.map((signal) => ({
      ...signal,
      signalAt: new Date(signal.signalAt.getTime()),
    })),
    errors: input.errors.map((error) => ({ ...error })),
    structuralContextsBySymbol: Object.fromEntries(
      Object.entries(input.structuralContextsBySymbol).map(
        ([symbol, contexts]) => [
          symbol,
          contexts.map((context) => ({ ...context })),
        ],
      ),
    ),
  };
}

function cloneHistoricalResolvedOption(
  value: HistoricalBackfillResolvedOption | null,
): HistoricalBackfillResolvedOption | null {
  if (!value) return null;
  return {
    selectedContract: { ...value.selectedContract },
    optionBars: value.optionBars.map((bar) => ({ ...bar })),
    optionTrades: value.optionTrades.map((trade) => ({ ...trade })),
    entryBar: { ...value.entryBar },
    quote: { ...value.quote },
    liquidity: { ...value.liquidity },
    orderPlan: { ...value.orderPlan },
    selectedExpiration: {
      expirationDate: new Date(
        value.selectedExpiration.expirationDate.getTime(),
      ),
      dte: value.selectedExpiration.dte,
    },
  };
}

function parseBackfillDate(value: unknown, fallback: string): string {
  const raw =
    typeof value === "string" && value.trim() ? value.trim() : fallback;
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

function countBackfillWeekdaysInclusive(from: Date, to: Date) {
  let count = 0;
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
  );
  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function historicalBackfillEquityBarLimit(input: {
  timeframe: SignalMonitorTimeframe;
  window: SignalOptionsBackfillWindow;
}) {
  const timeframeMs = getSignalMonitorTimeframeMs(input.timeframe);
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    return BACKFILL_EQUITY_BAR_MIN_LIMIT;
  }

  const barsPerDay =
    input.window.session === "regular"
      ? Math.ceil((REGULAR_MARKET_SESSION_MINUTES * 60_000) / timeframeMs)
      : Math.ceil(86_400_000 / timeframeMs);
  const dayCount =
    input.window.session === "regular"
      ? countBackfillWeekdaysInclusive(input.window.warmupFrom, input.window.to)
      : Math.max(
          1,
          Math.ceil(
            (input.window.to.getTime() - input.window.warmupFrom.getTime()) /
              86_400_000,
          ) + 1,
        );

  return Math.max(
    BACKFILL_EQUITY_BAR_MIN_LIMIT,
    dayCount * Math.max(1, barsPerDay) + BACKFILL_EQUITY_BAR_LIMIT_CUSHION,
  );
}

function previousBackfillWeekdayOrSame(value: string) {
  let cursor = value;
  while (
    backfillDateWeekday(cursor) === 0 ||
    backfillDateWeekday(cursor) === 6
  ) {
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

function liveOptionSessionCloseMinute(
  contract?: Record<string, unknown> | null,
): number {
  const underlying = normalizeSymbol(
    String(contract?.underlying ?? contract?.ticker ?? ""),
  ).toUpperCase();
  return SIGNAL_OPTIONS_EXTENDED_CLOSE_UNDERLYINGS.has(underlying)
    ? 16 * 60 + 15
    : 16 * 60;
}

function isLiveOptionTradingSession(
  value: Date,
  contract?: Record<string, unknown> | null,
): boolean {
  const parts = marketParts(value);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }
  const minutes =
    Number.parseInt(parts.hour ?? "0", 10) * 60 +
    Number.parseInt(parts.minute ?? "0", 10);
  return (
    minutes >= 9 * 60 + 30 && minutes < liveOptionSessionCloseMinute(contract)
  );
}

function isLiveOvernightExitWindow(value: Date): boolean {
  const parts = marketParts(value);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }
  const minutes =
    Number.parseInt(parts.hour ?? "0", 10) * 60 +
    Number.parseInt(parts.minute ?? "0", 10);
  return minutes >= 15 * 60 + 45 && minutes < 16 * 60;
}

function isWithinBackfillWindow(
  value: Date,
  window: SignalOptionsBackfillWindow,
) {
  if (
    value.getTime() < window.from.getTime() ||
    value.getTime() > window.to.getTime()
  ) {
    return false;
  }
  return window.session === "all" || isRegularMarketSession(value);
}

function brokerBarsToPyrusSignalsBars(
  bars: BrokerBarSnapshot[],
): PyrusSignalsBar[] {
  return bars
    .map((bar): PyrusSignalsBar | null => {
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
    .filter((bar): bar is PyrusSignalsBar => Boolean(bar))
    .sort((left, right) => left.time - right.time);
}

function lastFiniteAtOrBefore(
  values: number[],
  index: number,
  predicate?: (candidateIndex: number) => boolean,
): number | null {
  for (
    let cursor = Math.min(index, values.length - 1);
    cursor >= 0;
    cursor -= 1
  ) {
    if (predicate && !predicate(cursor)) {
      continue;
    }
    const value = finiteNumber(values[cursor]);
    if (value != null) {
      return value;
    }
  }
  return null;
}

function buildSignalOptionsWireContext(input: {
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  chartBars: PyrusSignalsBar[];
  evaluation: PyrusSignalsEvaluation;
  index?: number;
}): SignalOptionsWireContext | null {
  const index = input.index ?? input.chartBars.length - 1;
  const latestBar = input.chartBars[index];
  if (!latestBar) {
    return null;
  }
  const regimeDirection = finiteNumber(input.evaluation.regimeDirection[index]);
  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    latestBarAt: new Date(latestBar.time * 1000).toISOString(),
    latestClose: latestBar.c,
    regimeDirection,
    previousRegimeDirection:
      index > 0
        ? finiteNumber(input.evaluation.regimeDirection[index - 1])
        : null,
    trendLine: finiteNumber(input.evaluation.trendLine[index]),
    upperBand: finiteNumber(input.evaluation.upperBand[index]),
    lowerBand: finiteNumber(input.evaluation.lowerBand[index]),
    bullWires: input.evaluation.bullWires.map((wire) =>
      finiteNumber(wire[index]),
    ),
    bearWires: input.evaluation.bearWires.map((wire) =>
      finiteNumber(wire[index]),
    ),
    lastBullTrendLine: lastFiniteAtOrBefore(
      input.evaluation.lowerBand,
      index,
      (candidateIndex) =>
        input.evaluation.regimeDirection[candidateIndex] === 1,
    ),
    lastBearTrendLine: lastFiniteAtOrBefore(
      input.evaluation.upperBand,
      index,
      (candidateIndex) =>
        input.evaluation.regimeDirection[candidateIndex] === -1,
    ),
  };
}

async function loadSignalOptionsWireContextForPosition(input: {
  position: SignalOptionsPosition;
  evaluatedAt: Date;
  pyrusSignalsSettings: Record<string, unknown>;
}): Promise<SignalOptionsWireContext | null> {
  const completedBars = await loadSignalMonitorCompletedBars({
    symbol: input.position.symbol,
    timeframe: input.position.timeframe,
    evaluatedAt: input.evaluatedAt,
    barSourcePolicy: SIGNAL_OPTIONS_MONITOR_BAR_SOURCE_POLICY,
  });
  const chartBars = brokerBarsToPyrusSignalsBars(
    completedBars.bars as BrokerBarSnapshot[],
  );
  if (!chartBars.length) {
    return null;
  }
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars,
    settings: resolvePyrusSignalsSignalSettings(input.pyrusSignalsSettings),
    includeProvisionalSignals: false,
  });
  return buildSignalOptionsWireContext({
    symbol: input.position.symbol,
    timeframe: input.position.timeframe,
    chartBars,
    evaluation,
  });
}

function signalDirection(signal: PyrusSignalsSignalEvent): SignalDirection {
  return signal.eventType === "sell_signal" ? "sell" : "buy";
}

function signalPrice(signal: PyrusSignalsSignalEvent): number | null {
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
  return positionAt
    ? marketDateKeyFromDate(positionAt)
    : input.fallbackMarketDate;
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
          source === SIGNAL_OPTIONS_REPLAY_SOURCE
            ? SIGNAL_OPTIONS_REPLAY_SOURCE
            : "automation",
      }).catch((error) => {
        logger.warn?.(
          {
            err: error,
            eventId: existing.id,
            backfillEventKey: input.backfillEventKey,
          },
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

function buildHistoricalMassiveOptionTicker(input: {
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

function computeBackfillPostExitOutcome(input: {
  position: HistoricalBackfillOpenPosition;
  exitAt: Date;
  exitPrice: number;
}) {
  const remainingBars = input.position.optionBars
    .slice(input.position.nextBarIndex)
    .map((bar) => ({ bar, at: dateOrNull(bar.timestamp) }))
    .filter((item): item is { bar: BrokerBarSnapshot; at: Date } =>
      Boolean(item.at && item.at.getTime() > input.exitAt.getTime()),
    );
  if (!remainingBars.length) {
    return {
      bars: 0,
      highPrice: null,
      highAt: null,
      lowPrice: null,
      lowAt: null,
      lastClose: null,
      lastAt: null,
      highVsExitPct: null,
      lastVsExitPct: null,
      recoveredEntry: false,
      reachedTwentyFivePctGain: false,
      reachedFiftyPctGain: false,
      finalAboveExit: false,
      finalAboveEntry: false,
    };
  }

  let highPrice: number | null = null;
  let highAt: Date | null = null;
  let lowPrice: number | null = null;
  let lowAt: Date | null = null;
  let lastClose: number | null = null;
  let lastAt: Date | null = null;

  for (const { bar, at } of remainingBars) {
    const barHigh = finiteNumber(bar.high) ?? backfillBarPrice(bar);
    const barLow = finiteNumber(bar.low) ?? backfillBarPrice(bar);
    const barClose = backfillBarPrice(bar);
    if (barHigh != null && (highPrice == null || barHigh > highPrice)) {
      highPrice = barHigh;
      highAt = at;
    }
    if (barLow != null && (lowPrice == null || barLow < lowPrice)) {
      lowPrice = barLow;
      lowAt = at;
    }
    if (barClose != null) {
      lastClose = barClose;
      lastAt = at;
    }
  }

  return {
    bars: remainingBars.length,
    highPrice: roundMetric(highPrice),
    highAt: highAt?.toISOString() ?? null,
    lowPrice: roundMetric(lowPrice),
    lowAt: lowAt?.toISOString() ?? null,
    lastClose: roundMetric(lastClose),
    lastAt: lastAt?.toISOString() ?? null,
    highVsExitPct:
      highPrice != null && input.exitPrice > 0
        ? roundMetric(
            ((highPrice - input.exitPrice) / input.exitPrice) * 100,
            1,
          )
        : null,
    lastVsExitPct:
      lastClose != null && input.exitPrice > 0
        ? roundMetric(
            ((lastClose - input.exitPrice) / input.exitPrice) * 100,
            1,
          )
        : null,
    recoveredEntry: highPrice != null && highPrice >= input.position.entryPrice,
    reachedTwentyFivePctGain:
      highPrice != null && highPrice >= input.position.entryPrice * 1.25,
    reachedFiftyPctGain:
      highPrice != null && highPrice >= input.position.entryPrice * 1.5,
    finalAboveExit: lastClose != null && lastClose > input.exitPrice,
    finalAboveEntry: lastClose != null && lastClose > input.position.entryPrice,
  };
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

function isHistoricalOptionEntryBarTimely(signalAt: Date, entryAt: Date) {
  const delayMs = entryAt.getTime() - signalAt.getTime();
  return delayMs >= 0 && delayMs <= HISTORICAL_OPTION_ENTRY_BAR_MAX_DELAY_MS;
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
    source: "massive-option-trade" | "massive-option-aggregates";
    trade?: OptionTradePrint | null;
    markPrice?: number | null;
  },
) {
  const simulatedFillPrice = Number(fillPrice.toFixed(2));
  const premiumQuantityCap =
    profile.riskHaltControls.premiumBudgetEnabled === false
      ? profile.riskCaps.maxContracts
      : Math.floor(
          profile.riskCaps.maxPremiumPerEntry / (simulatedFillPrice * 100),
        );
  const quantity = Math.min(profile.riskCaps.maxContracts, premiumQuantityCap);
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
        fill?.source === "massive-option-trade"
          ? "historical_option_trades"
          : "historical_option_bars",
      marketDataMode: "historical",
      trade: optionTradeSnapshot(fill?.trade ?? null),
      markPrice: fill?.markPrice ?? null,
    },
    historicalPricing: true,
    historicalFill: {
      source: fill?.source ?? "massive-option-aggregates",
      trade: optionTradeSnapshot(fill?.trade ?? null),
      markPrice: fill?.markPrice ?? null,
      maxDelayMs: HISTORICAL_OPTION_TRADE_FILL_MAX_DELAY_MS,
    },
  };
}

function historicalOptionResolutionCacheKey(input: {
  candidate: SignalOptionsCandidate;
  profile: SignalOptionsExecutionProfile;
  window: SignalOptionsBackfillWindow;
}) {
  return cacheJson({
    symbol: normalizeSymbol(input.candidate.symbol).toUpperCase(),
    direction: input.candidate.direction,
    optionRight: input.candidate.optionRight,
    signalAt: toIsoString(input.candidate.signalAt),
    signalPrice: input.candidate.signalPrice,
    optionSelection: input.profile.optionSelection,
    fillPolicy: input.profile.fillPolicy,
    riskCaps: {
      maxContracts: input.profile.riskCaps.maxContracts,
      maxPremiumPerEntry: input.profile.riskCaps.maxPremiumPerEntry,
    },
    riskHaltControls: {
      premiumBudgetEnabled: input.profile.riskHaltControls.premiumBudgetEnabled,
    },
    window: {
      from: input.window.from.toISOString(),
      to: input.window.to.toISOString(),
      session: input.window.session,
    },
  });
}

async function resolveHistoricalOptionForBackfill(input: {
  candidate: SignalOptionsCandidate;
  profile: SignalOptionsExecutionProfile;
  window: SignalOptionsBackfillWindow;
}): Promise<HistoricalBackfillResolvedOption | null> {
  const key = historicalOptionResolutionCacheKey(input);
  const cached = historicalOptionResolutionCache.get(key);
  if (cached) {
    return cloneHistoricalResolvedOption(await cached);
  }
  const request = resolveHistoricalOptionForBackfillUncached(input).catch(
    (error) => {
      historicalOptionResolutionCache.delete(key);
      throw error;
    },
  );
  rememberBoundedCacheEntry(
    historicalOptionResolutionCache,
    key,
    request,
    HISTORICAL_OPTION_RESOLUTION_CACHE_MAX_ENTRIES,
  );
  return cloneHistoricalResolvedOption(await request);
}

async function resolveHistoricalOptionForBackfillUncached(input: {
  candidate: SignalOptionsCandidate;
  profile: SignalOptionsExecutionProfile;
  window: SignalOptionsBackfillWindow;
}): Promise<HistoricalBackfillResolvedOption | null> {
  const signalAt = dateOrNull(input.candidate.signalAt);
  if (!signalAt) {
    return null;
  }
  const expirations = selectHistoricalExpirationCandidates(
    signalAt,
    input.profile,
  );
  const strikes = selectHistoricalStrikeCandidates({
    signalPrice: input.candidate.signalPrice,
    direction: input.candidate.direction,
    profile: input.profile,
  });
  for (const selectedExpiration of expirations) {
    for (const strike of strikes) {
      const optionTicker = buildHistoricalMassiveOptionTicker({
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
        from: new Date(
          Math.max(
            input.window.from.getTime(),
            signalAt.getTime() - 15 * 60_000,
          ),
        ),
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
          return Boolean(
            timestamp && timestamp.getTime() >= signalAt.getTime(),
          );
        }) ?? null;
      const entryAt = entryBar ? dateOrNull(entryBar.timestamp) : null;
      const fillPrice = entryBar ? backfillBarPrice(entryBar) : null;
      if (
        !entryBar ||
        !entryAt ||
        !isHistoricalOptionEntryBarTimely(signalAt, entryAt) ||
        fillPrice == null ||
        fillPrice <= 0
      ) {
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
      const orderPlan = buildHistoricalOrderPlan(
        entryFillPrice,
        input.profile,
        {
          source: entryTrade
            ? "massive-option-trade"
            : "massive-option-aggregates",
          trade: entryTrade,
          markPrice: fillPrice,
        },
      );
      if (!orderPlan.ok) {
        continue;
      }
      const selectedContract = {
        ticker: optionTicker,
        underlying: input.candidate.symbol,
        expirationDate: selectedExpiration.expirationDate
          .toISOString()
          .slice(0, 10),
        strike,
        right: input.candidate.optionRight,
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: result.providerContractId ?? null,
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

function readGreekSmokeInteger(
  value: unknown,
  fallback: number | null,
  min: number,
  max: number,
): number | null {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function readGreekSmokeNumber(value: unknown, fallback: number): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function greekSelectorCombos(input: {
  expirations: ReturnType<typeof selectHistoricalExpirationCandidates>;
  strikes: number[];
  maxCandidates: number;
}) {
  const combos: Array<{
    selectedExpiration: { expirationDate: Date; dte: number };
    strike: number;
  }> = [];
  for (const strike of input.strikes) {
    for (const selectedExpiration of input.expirations) {
      combos.push({ selectedExpiration, strike });
      if (combos.length >= input.maxCandidates) {
        return combos;
      }
    }
  }
  return combos;
}

function selectGreekSelectorExitBar(input: {
  optionBars: BrokerBarSnapshot[];
  exitAt: Date;
}) {
  const atOrAfter =
    input.optionBars.find((bar) => {
      const timestamp = dateOrNull(bar.timestamp);
      return Boolean(timestamp && timestamp.getTime() >= input.exitAt.getTime());
    }) ?? null;
  if (atOrAfter) return atOrAfter;
  return (
    input.optionBars
      .slice()
      .reverse()
      .find((bar) => {
        const timestamp = dateOrNull(bar.timestamp);
        return Boolean(timestamp && timestamp.getTime() <= input.exitAt.getTime());
      }) ?? null
  );
}

async function resolveSignalOptionsGreekSelectorCandidates(input: {
  candidate: SignalOptionsCandidate;
  profile: SignalOptionsExecutionProfile;
  window: SignalOptionsBackfillWindow;
  exitAt: Date;
  riskFreeRate: number;
  dividendYield: number;
  maxCandidates: number;
}): Promise<{
  candidates: SignalOptionsGreekSelectorSmokeCandidate[];
  skipped: number;
  skipReasons: Record<string, number>;
  notes: string[];
}> {
  const signalAt = dateOrNull(input.candidate.signalAt);
  if (!signalAt || input.candidate.signalPrice == null) {
    return {
      candidates: [],
      skipped: 0,
      skipReasons: { missing_signal_price: 1 },
      notes: ["missing_signal_price"],
    };
  }
  const expirations = selectHistoricalExpirationCandidates(signalAt, input.profile);
  const strikes = selectHistoricalStrikeCandidates({
    signalPrice: input.candidate.signalPrice,
    direction: input.candidate.direction,
    profile: input.profile,
  });
  const combos = greekSelectorCombos({
    expirations,
    strikes,
    maxCandidates: input.maxCandidates,
  });
  const candidates: SignalOptionsGreekSelectorSmokeCandidate[] = [];
  const notes: string[] = [];
  const skipReasons = new Map<string, number>();
  let skipped = 0;
  const skip = (reason: string) => {
    skipped += 1;
    skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
  };

  for (const { selectedExpiration, strike } of combos) {
    const optionTicker = buildHistoricalMassiveOptionTicker({
      underlying: input.candidate.symbol,
      expirationDate: selectedExpiration.expirationDate,
      strike,
      right: input.candidate.optionRight,
    });
    if (!optionTicker) {
      skip("missing_option_ticker");
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
      from: new Date(
        Math.max(input.window.from.getTime(), signalAt.getTime() - 15 * 60_000),
      ),
      to: input.window.to,
      limit: BACKFILL_OPTION_BAR_LIMIT,
      outsideRth: false,
    }).catch(() => null);
    const optionBars = (result?.bars ?? [])
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
    const entryAt = entryBar ? dateOrNull(entryBar.timestamp) : null;
    const markPrice = entryBar ? backfillBarPrice(entryBar) : null;
    if (
      !entryBar ||
      !entryAt ||
      !isHistoricalOptionEntryBarTimely(signalAt, entryAt) ||
      markPrice == null ||
      markPrice <= 0
    ) {
      skip("missing_entry_bar");
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
    const entryPrice = Number((entryTrade?.price ?? markPrice).toFixed(2));
    const orderPlan = buildHistoricalOrderPlan(entryPrice, input.profile, {
      source: entryTrade ? "massive-option-trade" : "massive-option-aggregates",
      trade: entryTrade,
      markPrice,
    });
    if (!orderPlan.ok) {
      skip(`order_plan_${String(orderPlan.reason || "failed")}`);
      continue;
    }
    const exitBar = selectGreekSelectorExitBar({ optionBars, exitAt: input.exitAt });
    const exitAt = exitBar ? dateOrNull(exitBar.timestamp) : null;
    const exitPrice = exitBar ? backfillBarPrice(exitBar) : null;
    const greeks = computeOptionGreeksFromPrice({
      spot: input.candidate.signalPrice,
      strike,
      optionPrice: entryPrice,
      right: input.candidate.optionRight,
      at: entryAt,
      expirationDate: selectedExpiration.expirationDate,
      riskFreeRate: input.riskFreeRate,
      dividendYield: input.dividendYield,
    });
    if (!greeks) {
      skip("invalid_greek_reconstruction");
      continue;
    }
    const volume = finiteNumber(entryBar.volume);
    const score = scoreOptionGreekCandidate({
      right: input.candidate.optionRight,
      spot: input.candidate.signalPrice,
      strike,
      entryPrice,
      volume,
      hasExitPrice: exitPrice != null,
      greeks,
    });
    const quantity = finiteNumber(orderPlan.quantity) ?? 0;
    const pnl =
      exitPrice != null && quantity > 0
        ? Number(((Number(exitPrice.toFixed(2)) - entryPrice) * quantity * 100).toFixed(2))
        : null;
    candidates.push({
      ticker: optionTicker,
      expirationDate: selectedExpiration.expirationDate.toISOString().slice(0, 10),
      dte: selectedExpiration.dte,
      strike,
      right: input.candidate.optionRight,
      entryAt: entryAt.toISOString(),
      entryPrice,
      exitAt: exitAt?.toISOString() ?? null,
      exitPrice: exitPrice == null ? null : Number(exitPrice.toFixed(2)),
      quantity,
      pnl,
      volume,
      greeks,
      score,
    });
  }

  if (combos.length >= input.maxCandidates) {
    notes.push(`candidate_cap_${input.maxCandidates}`);
  }
  return {
    candidates: candidates.sort(
      (left, right) =>
        right.score.total - left.score.total ||
        (right.pnl ?? Number.NEGATIVE_INFINITY) -
          (left.pnl ?? Number.NEGATIVE_INFINITY) ||
        left.ticker.localeCompare(right.ticker),
    ),
    skipped,
    skipReasons: Object.fromEntries(skipReasons),
    notes,
  };
}

function emptyGreekSelectorSmokeLegacy(): SignalOptionsGreekSelectorSmokeRow["legacy"] {
  return {
    ticker: null,
    expirationDate: null,
    strike: null,
    right: null,
    entryPrice: null,
    exitPrice: null,
    quantity: null,
    pnl: null,
    closedAt: null,
  };
}

function greekSelectorSmokeLegacyFromTrade(
  trade: Record<string, unknown>,
): SignalOptionsGreekSelectorSmokeRow["legacy"] {
  const selectedContract = asRecord(trade["selectedContract"]);
  return {
    ticker:
      typeof selectedContract["ticker"] === "string"
        ? selectedContract["ticker"]
        : null,
    expirationDate:
      typeof selectedContract["expirationDate"] === "string"
        ? selectedContract["expirationDate"]
        : null,
    strike: finiteNumber(selectedContract["strike"]),
    right:
      typeof selectedContract["right"] === "string"
        ? selectedContract["right"]
        : null,
    entryPrice: finiteNumber(trade["entryPrice"]),
    exitPrice: finiteNumber(trade["exitPrice"]),
    quantity: finiteNumber(trade["quantity"]),
    pnl: finiteNumber(trade["pnl"]),
    closedAt: dateOrNull(trade["closedAt"])?.toISOString() ?? null,
  };
}

function summarizeGreekSelectorSmokeRows(
  actionCandidates: number,
  legacyClosedTrades: number,
  rows: SignalOptionsGreekSelectorSmokeRow[],
) {
  const comparableRows = rows.filter((row) => row.pnlDelta != null);
  const markedRows = rows.filter((row) => row.selected?.pnl != null);
  const totalLegacyPnl = comparableRows.reduce(
    (sum, row) => sum + (row.legacy.pnl ?? 0),
    0,
  );
  const totalSelectedPnl = comparableRows.reduce(
    (sum, row) => sum + (row.selected?.pnl ?? 0),
    0,
  );
  const totalSelectedMarkedPnl = markedRows.reduce(
    (sum, row) => sum + (row.selected?.pnl ?? 0),
    0,
  );
  return {
    actionCandidates,
    reportedSignals: rows.length,
    legacyClosedTrades,
    comparedSignals: comparableRows.length,
    changedSelections: rows.filter((row) => {
      const legacyTicker = row.legacy.ticker;
      const selectedTicker = row.selected?.ticker ?? null;
      return Boolean(legacyTicker && selectedTicker && legacyTicker !== selectedTicker);
    }).length,
    totalLegacyPnl: Number(totalLegacyPnl.toFixed(2)),
    totalSelectedPnl: Number(totalSelectedPnl.toFixed(2)),
    totalPnlDelta: Number((totalSelectedPnl - totalLegacyPnl).toFixed(2)),
    totalSelectedMarkedPnl: Number(totalSelectedMarkedPnl.toFixed(2)),
    candidatesScored: rows.reduce((sum, row) => sum + row.candidatesScored, 0),
    candidatesSkipped: rows.reduce((sum, row) => sum + row.candidatesSkipped, 0),
    skipReasons: rows.reduce<Record<string, number>>((counts, row) => {
      for (const [reason, count] of Object.entries(row.skipReasons)) {
        counts[reason] = (counts[reason] ?? 0) + count;
      }
      return counts;
    }, {}),
    rowsWithSelection: rows.filter((row) => row.selected).length,
    rowsWithMarkedPnl: markedRows.length,
    rowsWithoutSelection: rows.filter((row) => !row.selected).length,
  };
}

export async function runSignalOptionsGreekSelectorSmoke(input: {
  deploymentId: string;
  date?: unknown;
  session?: unknown;
  signalTimeframe?: unknown;
  profilePatch?: unknown;
  pyrusSignalsSettingsPatch?: unknown;
  forceDeploymentUniverse?: boolean;
  symbolUniverseOverride?: string[];
  maxSignals?: unknown;
  maxCandidatesPerSignal?: unknown;
  riskFreeRate?: unknown;
  dividendYield?: unknown;
  progress?: boolean;
}): Promise<SignalOptionsGreekSelectorSmokeResult> {
  const date = parseBackfillDate(input.date, "2026-05-29");
  const maxCandidatesPerSignal =
    readGreekSmokeInteger(input.maxCandidatesPerSignal, 24, 1, 200) ?? 24;
  const maxSignals = readGreekSmokeInteger(input.maxSignals, null, 1, 1_000);
  const riskFreeRate = readGreekSmokeNumber(input.riskFreeRate, 0.05);
  const dividendYield = readGreekSmokeNumber(input.dividendYield, 0);
  const backfillInput = {
    deploymentId: input.deploymentId,
    start: date,
    end: date,
    session: input.session,
    commit: false,
    profilePatch: input.profilePatch,
    pyrusSignalsSettingsPatch: input.pyrusSignalsSettingsPatch,
    signalTimeframe: input.signalTimeframe,
    forceDeploymentUniverse: input.forceDeploymentUniverse,
    symbolUniverseOverride: input.symbolUniverseOverride,
    progress: input.progress,
  };
  const legacyResult = await runSignalOptionsShadowBackfill(backfillInput);
  let deployment = await getDeploymentOrThrow(input.deploymentId);
  deployment = await normalizeSignalOptionsDeploymentBranding(deployment);
  deployment = await normalizeSignalOptionsDeploymentAccount(deployment);
  const window = resolveSignalOptionsBackfillWindow(backfillInput);
  const baseProfile = resolveDeploymentProfile(deployment);
  const profilePatch = asRecord(input.profilePatch);
  const profile = Object.keys(profilePatch).length
    ? mergeProfilePatch(baseProfile, profilePatch)
    : baseProfile;
  const signalProfile = await getSignalMonitorProfileRow({
    environment: deployment.mode,
  });
  const signalUniverse = await resolveSignalMonitorProfileUniverse(signalProfile);
  const pyrusSignalsSettings = mergePyrusSignalsSettingsPatch(
    asRecord(signalProfile.pyrusSignalsSettings),
    input.pyrusSignalsSettingsPatch,
  );
  const backfillUniverse = buildSignalOptionsBackfillUniverse({
    deploymentSymbols: input.symbolUniverseOverride?.length
      ? input.symbolUniverseOverride
      : deployment.symbolUniverse,
    signalMonitorSymbols: input.forceDeploymentUniverse
      ? []
      : signalUniverse.symbols,
    watchlistId: signalUniverse.profile.watchlistId,
    skippedSymbols: input.forceDeploymentUniverse
      ? []
      : signalUniverse.skippedSymbols,
    truncated: input.forceDeploymentUniverse ? false : signalUniverse.truncated,
  });
  const timeframe = resolveSignalMonitorTimeframe(
    input.signalTimeframe,
    resolveSignalMonitorTimeframe(signalUniverse.profile.timeframe),
  );
  const loadedSignals = await loadHistoricalBackfillSignals({
    profileId: signalProfile.id,
    profileSettings: pyrusSignalsSettings,
    symbols: backfillUniverse.symbols,
    timeframe,
    window,
    progress: input.progress,
  });
  const candidatesById = new Map<string, SignalOptionsCandidate>();
  for (const historicalSignal of loadedSignals.signals) {
    const state = buildBackfillSignalSnapshot({
      profileId: signalProfile.id,
      symbol: historicalSignal.symbol,
      timeframe,
      signal: historicalSignal.signal,
    });
    const signalAt = historicalSignal.signalAt.toISOString();
    const candidate = buildCandidateFromSignal({
      deployment,
      state,
      signalAt,
      signalKey: buildSignalKey(state, signalAt),
      signalMetadata: {
        source: "pyrus-signals-backfill",
        filterState: asRecord(historicalSignal.signal.filterState),
      },
    });
    candidatesById.set(candidate.id, candidate);
  }

  const closedTrades = asArray(asRecord(legacyResult.summary)["closedTrades"]);
  const closedTradesByCandidateId = new Map<string, Record<string, unknown>>();
  for (const trade of closedTrades) {
    const record = asRecord(trade);
    const candidateId = String(record["candidateId"] ?? "");
    if (candidateId && !closedTradesByCandidateId.has(candidateId)) {
      closedTradesByCandidateId.set(candidateId, record);
    }
  }
  const actionCandidates = Array.from(candidatesById.values()).sort(
    (left, right) =>
      new Date(left.signalAt).getTime() - new Date(right.signalAt).getTime() ||
      left.symbol.localeCompare(right.symbol) ||
      left.id.localeCompare(right.id),
  );
  const selectedActionCandidates = maxSignals
    ? actionCandidates.slice(0, maxSignals)
    : actionCandidates;
  if (input.progress) {
    console.log(
      `[signal-options-greek-smoke] scoring ${selectedActionCandidates.length}/${actionCandidates.length} action candidates maxCandidates=${maxCandidatesPerSignal}`,
    );
  }
  const rows: SignalOptionsGreekSelectorSmokeRow[] = [];
  const errors = [
    ...asArray(asRecord(legacyResult.summary)["errors"]).map((error) => ({
      symbol:
        typeof asRecord(error)["symbol"] === "string"
          ? String(asRecord(error)["symbol"])
          : null,
      message: String(asRecord(error)["message"] ?? "Legacy backfill error."),
    })),
    ...loadedSignals.errors,
  ];

  for (let index = 0; index < selectedActionCandidates.length; index += 1) {
    const candidate = selectedActionCandidates[index];
    if (input.progress && (index === 0 || (index + 1) % 10 === 0)) {
      console.log(
        `[signal-options-greek-smoke] candidate ${index + 1}/${selectedActionCandidates.length} ${candidate.symbol} ${candidate.signalAt}`,
      );
    }
    const record = closedTradesByCandidateId.get(candidate.id) ?? null;
    const closedAt = record ? dateOrNull(record["closedAt"]) : null;
    const legacy = record
      ? greekSelectorSmokeLegacyFromTrade(record)
      : emptyGreekSelectorSmokeLegacy();
    const legacyPnl = legacy.pnl;
    const resolved = await resolveSignalOptionsGreekSelectorCandidates({
      candidate,
      profile,
      window,
      exitAt: closedAt ?? window.to,
      riskFreeRate,
      dividendYield,
      maxCandidates: maxCandidatesPerSignal,
    }).catch((error) => {
      errors.push({
        symbol: candidate.symbol,
        message:
          error instanceof Error && error.message
            ? error.message
            : "Greek selector candidate resolution failed.",
      });
      return {
        candidates: [],
        skipped: 0,
        skipReasons: { candidate_resolution_error: 1 },
        notes: ["candidate_resolution_error"],
      };
    });
    const selected = resolved.candidates[0] ?? null;
    const outcome: SignalOptionsGreekSelectorSmokeRow["outcome"] = closedAt
      ? "closed_trade"
      : selected?.pnl != null
        ? "end_of_window_mark"
        : "unmarked";
    rows.push({
      candidateId: candidate.id,
      symbol: candidate.symbol,
      direction: candidate.direction,
      signalAt: candidate.signalAt,
      underlyingPrice: candidate.signalPrice,
      outcome,
      legacy,
      selected,
      candidatesScored: resolved.candidates.length,
      candidatesSkipped: resolved.skipped,
      skipReasons: resolved.skipReasons,
      topCandidates: resolved.candidates.slice(0, 3),
      pnlDelta:
        selected?.pnl != null && legacyPnl != null
          ? Number((selected.pnl - legacyPnl).toFixed(2))
          : null,
      notes: closedAt
        ? resolved.notes
        : [
            ...resolved.notes,
            outcome === "end_of_window_mark"
              ? "marked_to_window_end"
              : "missing_exit_price",
          ],
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    date,
    deployment: {
      id: deployment.id,
      name: normalizeLegacyAlgoBrandText(deployment.name),
      mode: deployment.mode,
    },
    window: asRecord(legacyResult.window),
    timeframe,
    config: {
      maxSignals,
      maxCandidatesPerSignal,
      riskFreeRate,
      dividendYield,
    },
    summary: summarizeGreekSelectorSmokeRows(
      actionCandidates.length,
      closedTrades.length,
      rows,
    ),
    rows,
    errors,
  };
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
    backfillEventKey: backfillEventKey(
      [input.deployment.id, input.signalKey, "skip", input.reason],
      eventSource,
    ),
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
  signalQuality?: SignalOptionsEntryQuality | null;
  entryAt: Date;
  optionBars: BrokerBarSnapshot[];
  optionTrades: OptionTradePrint[];
  structuralContexts: SignalOptionsWireContext[];
  nextBarIndex: number;
  nextStructuralIndex: number;
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
    signalQuality: input.signalQuality ?? null,
    entryGreeks: null,
    greekBaselineSource: null,
    optionBars: input.optionBars,
    optionTrades: input.optionTrades,
    structuralContexts: input.structuralContexts,
    nextBarIndex: input.nextBarIndex,
    nextStructuralIndex: input.nextStructuralIndex,
    currentWireContext: null,
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
    lastStop: position.lastStop ?? null,
    lastWireTrail: position.lastWireTrail ?? null,
    signalQuality: position.signalQuality ?? null,
    entryGreeks: position.entryGreeks ?? null,
    greekBaselineSource: position.greekBaselineSource ?? null,
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

function isBackfillOvernightBoundary(input: {
  position: HistoricalBackfillOpenPosition;
  currentBarAt: Date;
  until: Date;
}) {
  const nextBar = input.position.optionBars[input.position.nextBarIndex];
  const nextBarAt = dateOrNull(nextBar?.timestamp);
  return Boolean(
    nextBarAt &&
      nextBarAt.getTime() <= input.until.getTime() &&
      marketDateKeyFromDate(nextBarAt) !==
        marketDateKeyFromDate(input.currentBarAt),
  );
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
    (
      (exitPrice - input.position.entryPrice) *
      input.position.quantity *
      100
    ).toFixed(2),
  );
  const dayKey = input.occurredAt.toISOString().slice(0, 10);
  input.realizedByDay.set(dayKey, (input.realizedByDay.get(dayKey) ?? 0) + pnl);
  const positionPatch = {
    ...backfillPositionPayload(input.position),
    lastMarkPrice: exitPrice,
    lastMarkedAt: input.occurredAt.toISOString(),
  };
  const postExitOutcome = computeBackfillPostExitOutcome({
    position: input.position,
    exitAt: input.occurredAt,
    exitPrice,
  });
  const eventSource = input.eventSource ?? SIGNAL_OPTIONS_BACKFILL_SOURCE;
  const write = await insertSignalOptionsBackfillEvent({
    deployment: input.deployment,
    symbol: input.position.symbol,
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    summary: `${input.position.symbol} shadow backfill exit ${input.reason} at ${exitPrice.toFixed(2)}`,
    occurredAt: input.occurredAt,
    backfillEventKey: backfillEventKey(
      [
        input.deployment.id,
        input.position.candidateId,
        "exit",
        input.reason,
        input.occurredAt.toISOString(),
      ],
      eventSource,
    ),
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
        source: exitTrade
          ? "massive-option-trade"
          : "massive-option-aggregates",
        trade: optionTradeSnapshot(exitTrade),
        markPrice: exitMarkPrice,
        maxDelayMs: HISTORICAL_OPTION_TRADE_FILL_MAX_DELAY_MS,
      },
      pnl,
      postExitOutcome,
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
    const greekManagement = asRecord(input.position.lastStop?.greekManagement);
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
      signalQuality: input.position.signalQuality ?? null,
      wireTrail: input.position.lastWireTrail ?? null,
      greekManagement: Object.keys(greekManagement).length
        ? greekManagement
        : null,
      postExitOutcome,
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
  for (const [symbol, position] of Array.from(
    input.positionsBySymbol.entries(),
  )) {
    while (position.nextBarIndex < position.optionBars.length) {
      const bar = position.optionBars[position.nextBarIndex];
      const barAt = dateOrNull(bar?.timestamp);
      if (!bar || !barAt || barAt.getTime() > input.until.getTime()) {
        break;
      }
      position.nextBarIndex += 1;
      while (
        position.nextStructuralIndex < position.structuralContexts.length
      ) {
        const context =
          position.structuralContexts[position.nextStructuralIndex];
        const contextAt = dateOrNull(context?.latestBarAt);
        if (!context || !contextAt || contextAt.getTime() > barAt.getTime()) {
          break;
        }
        position.currentWireContext = context;
        position.nextStructuralIndex += 1;
      }
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
        direction: position.direction,
        underlyingSpot: position.currentWireContext?.latestClose ?? null,
        wireContext: position.currentWireContext,
        currentGreeks: null,
        entryGreeks: null,
        spreadPctOfMid: null,
        signalQuality: position.signalQuality ?? null,
        barsSinceEntry: signalBarsSinceEntry({
          openedAt: position.openedAt,
          markAt: barAt,
          timeframe: position.timeframe,
        }),
      });
      position.peakPrice = peakPrice;
      position.stopPrice = stop.stopPrice;
      position.lastMarkPrice = Number(markPrice.toFixed(2));
      position.lastMarkedAt = barAt.toISOString();
      position.lastStop = stop as unknown as Record<string, unknown>;
      position.lastWireTrail = asRecord(stop.wireTrail);

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

      const overnight = isBackfillOvernightBoundary({
        position,
        currentBarAt: barAt,
        until: input.until,
      })
        ? computeOvernightPositionExit({
            entryPrice: position.entryPrice,
            peakPrice,
            markPrice,
            profile: input.profile,
            signalQuality: position.signalQuality ?? null,
          })
        : null;
      if (overnight?.exitReason) {
        const exitPrice = Number(markPrice.toFixed(2));
        await closeBackfillPosition({
          deployment: input.deployment,
          profile: input.profile,
          position,
          reason: overnight.exitReason,
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
        backfillEventKey: backfillEventKey(
          [
            input.deployment.id,
            position.candidateId,
            "mark",
            barAt.toISOString(),
          ],
          eventSource,
        ),
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
          overnight,
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
  signal: PyrusSignalsSignalEvent;
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

function historicalBackfillSignalsCacheKey(input: {
  profileId: string;
  profileSettings: Record<string, unknown>;
  symbols: string[];
  timeframe: SignalMonitorTimeframe;
  window: SignalOptionsBackfillWindow;
}) {
  return cacheJson({
    profileId: input.profileId,
    profileSettings: input.profileSettings,
    symbols: input.symbols.map((symbol) =>
      normalizeSymbol(symbol).toUpperCase(),
    ),
    timeframe: input.timeframe,
    window: {
      from: input.window.from.toISOString(),
      to: input.window.to.toISOString(),
      warmupFrom: input.window.warmupFrom.toISOString(),
      session: input.window.session,
    },
  });
}

async function loadHistoricalBackfillSignals(input: {
  profileId: string;
  profileSettings: Record<string, unknown>;
  symbols: string[];
  timeframe: SignalMonitorTimeframe;
  window: SignalOptionsBackfillWindow;
  progress?: boolean;
}) {
  const key = historicalBackfillSignalsCacheKey(input);
  const cached = historicalBackfillSignalsCache.get(key);
  if (cached) {
    if (input.progress) {
      console.log("[signal-options-backfill] loaded signals from cache");
    }
    return cloneHistoricalBackfillSignalsResult(await cached);
  }
  const request = loadHistoricalBackfillSignalsUncached(input).catch(
    (error) => {
      historicalBackfillSignalsCache.delete(key);
      throw error;
    },
  );
  rememberBoundedCacheEntry(
    historicalBackfillSignalsCache,
    key,
    request,
    HISTORICAL_BACKFILL_SIGNALS_CACHE_MAX_ENTRIES,
  );
  return cloneHistoricalBackfillSignalsResult(await request);
}

async function loadHistoricalBackfillSignalsUncached(input: {
  profileId: string;
  profileSettings: Record<string, unknown>;
  symbols: string[];
  timeframe: SignalMonitorTimeframe;
  window: SignalOptionsBackfillWindow;
  progress?: boolean;
}) {
  const signals: HistoricalBackfillSignal[] = [];
  const errors: SignalOptionsBackfillSummary["errors"] = [];
  const structuralContextsBySymbol: Record<string, SignalOptionsWireContext[]> =
    {};
  const settings = resolvePyrusSignalsSignalSettings(input.profileSettings);
  const equityBarLimit = historicalBackfillEquityBarLimit({
    timeframe: input.timeframe,
    window: input.window,
  });

  for (const symbol of input.symbols) {
    try {
      if (input.progress) {
        console.log(`[signal-options-backfill] loading signals ${symbol}`);
      }
      const bars = await getBars({
        symbol,
        timeframe: input.timeframe,
        limit: equityBarLimit,
        from: input.window.warmupFrom,
        to: input.window.to,
        assetClass: "equity",
        outsideRth: input.window.session === "all",
        source: "trades",
        allowHistoricalSynthesis: true,
      });
      const chartBars = brokerBarsToPyrusSignalsBars(bars.bars);
      const evaluation = evaluatePyrusSignalsSignals({
        chartBars,
        settings,
        includeProvisionalSignals: false,
      });
      const normalizedSymbol = normalizeSymbol(symbol).toUpperCase();
      structuralContextsBySymbol[normalizedSymbol] = chartBars
        .map((bar, index) => {
          const barAt = new Date(bar.time * 1000);
          if (!isWithinBackfillWindow(barAt, input.window)) {
            return null;
          }
          return buildSignalOptionsWireContext({
            symbol: normalizedSymbol,
            timeframe: input.timeframe,
            chartBars,
            evaluation,
            index,
          });
        })
        .filter(
          (context): context is SignalOptionsWireContext => context != null,
        );
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
      if (input.progress) {
        console.log(
          `[signal-options-backfill] loaded signals ${symbol} bars=${chartBars.length} totalSignals=${signals.length}`,
        );
      }
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
    structuralContextsBySymbol,
  };
}

async function resolveDefaultSignalOptionsSymbols() {
  const { watchlists } = await listWatchlists();
  const watchlist =
    watchlists.find((item) => item.name.toLowerCase() === "core") ??
    watchlists.find((item) => item.isDefault) ??
    watchlists[0] ??
    null;
  const preferredSymbols = watchlist?.items.map((item) => item.symbol) ?? [];
  const symbols = [
    ...preferredSymbols,
    ...watchlists.flatMap((item) =>
      item === watchlist
        ? []
        : item.items.map((watchlistItem) => watchlistItem.symbol),
    ),
  ]
    .map((symbol) => normalizeSymbol(symbol).toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(symbols));
}

function sameSymbolUniverse(
  left: readonly unknown[],
  right: readonly unknown[],
) {
  const normalize = (symbols: readonly unknown[]) =>
    normalizeSignalOptionsUniverseSymbols(symbols).join("\n");
  return normalize(left) === normalize(right);
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

export async function ensureDefaultSignalOptionsPaperDeployment(
  input: {
    enabled?: boolean;
    preserveExistingPaused?: boolean;
  } = {},
) {
  const symbols = await resolveDefaultSignalOptionsSymbols();
  if (!symbols.length) {
    throw new HttpError(
      409,
      "No symbols are available for the default signal-options deployment.",
      {
        code: "signal_options_default_universe_empty",
        expose: true,
      },
    );
  }
  const enabled = input.enabled !== false;
  const existingStrategies = await db
    .select()
    .from(algoStrategiesTable)
    .where(eq(algoStrategiesTable.mode, "paper"))
    .orderBy(desc(algoStrategiesTable.updatedAt));
  let strategy =
    existingStrategies.find((row) =>
      isDefaultSignalOptionsSeedConfig(row.config),
    ) ?? null;

  if (!strategy) {
    [strategy] = await db
      .insert(algoStrategiesTable)
      .values({
        name: DEFAULT_SIGNAL_OPTIONS_STRATEGY_NAME,
        mode: "paper",
        enabled: false,
        symbolUniverse: symbols,
        config: {
          source: "default_signal_options_seed",
          strategyId: "pyrus_signals",
          strategyVersion: "v1",
          parameters: {
            executionMode: "signal_options",
            signalTimeframe: tunedSignalOptionsStrategySettings.signalTimeframe,
            ...tunedSignalOptionsStrategySettings.pyrusSignalsSettings,
          },
          signalOptions: tunedSignalOptionsExecutionProfile,
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
    existingDeployments.find((row) => {
      const deploymentName = normalizeLegacyAlgoBrandText(row.name);
      return (
        row.strategyId === strategy.id ||
        deploymentName === DEFAULT_SIGNAL_OPTIONS_DEPLOYMENT_NAME ||
        deploymentName === LEGACY_SIGNAL_OPTIONS_DEPLOYMENT_NAME
      );
    }) ?? null;

  if (!deployment) {
    [deployment] = await db
      .insert(algoDeploymentsTable)
      .values({
        strategyId: strategy.id,
        name: DEFAULT_SIGNAL_OPTIONS_DEPLOYMENT_NAME,
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
      summary: `Created deployment ${normalizeLegacyAlgoBrandText(deployment.name)}`,
      payload: {
        strategyId: deployment.strategyId,
        mode: deployment.mode,
        symbolUniverse: deployment.symbolUniverse,
        source: "default_signal_options_seed",
      },
    });
  } else if (
    enabled &&
    !deployment.enabled &&
    input.preserveExistingPaused !== true
  ) {
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
      summary: `Enabled deployment ${normalizeLegacyAlgoBrandText(deployment.name)}`,
      payload: {
        enabled: true,
        source: "default_signal_options_seed",
      },
    });
  } else if (
    deployment.enabled &&
    !sameSymbolUniverse(deployment.symbolUniverse, symbols)
  ) {
    const [updated] = await db
      .update(algoDeploymentsTable)
      .set({
        symbolUniverse: symbols,
        updatedAt: new Date(),
        lastError: null,
      })
      .where(eq(algoDeploymentsTable.id, deployment.id))
      .returning();
    deployment = updated ?? deployment;
  }

  deployment = await normalizeSignalOptionsDeploymentBranding(deployment);
  deployment = await normalizeSignalOptionsDeploymentAccount(deployment);
  await normalizeDefaultSignalOptionsPaperSignalMonitorProfile();

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

async function normalizeDefaultSignalOptionsPaperSignalMonitorProfile() {
  const profile = await getSignalMonitorProfileRow({
    environment: "paper",
    ensureWatchlist: true,
  });
  const patch: {
    environment: "paper";
    maxSymbols?: number;
    evaluationConcurrency?: number;
    pollIntervalSeconds?: number;
    pyrusSignalsSettings?: Record<string, unknown>;
  } = { environment: "paper" };
  const pyrusSignalsSettings = asRecord(profile.pyrusSignalsSettings);
  const universeScope = String(
    pyrusSignalsSettings["__signalMonitorUniverseScope"] ??
      pyrusSignalsSettings["universeScope"] ??
      "",
  ).trim();

  if (profile.maxSymbols !== DEFAULT_SIGNAL_OPTIONS_MONITOR_MAX_SYMBOLS) {
    patch.maxSymbols = DEFAULT_SIGNAL_OPTIONS_MONITOR_MAX_SYMBOLS;
  }
  if (
    profile.evaluationConcurrency !== DEFAULT_SIGNAL_OPTIONS_MONITOR_CONCURRENCY
  ) {
    patch.evaluationConcurrency = DEFAULT_SIGNAL_OPTIONS_MONITOR_CONCURRENCY;
  }
  if (
    profile.pollIntervalSeconds !== DEFAULT_SIGNAL_OPTIONS_MONITOR_POLL_SECONDS
  ) {
    patch.pollIntervalSeconds = DEFAULT_SIGNAL_OPTIONS_MONITOR_POLL_SECONDS;
  }
  if (universeScope === "all_watchlists_plus_universe") {
    patch.pyrusSignalsSettings = withSignalMonitorUniverseScope(
      pyrusSignalsSettings,
      "all_watchlists",
    );
  }

  if (
    patch.maxSymbols === undefined &&
    patch.evaluationConcurrency === undefined &&
    patch.pollIntervalSeconds === undefined &&
    patch.pyrusSignalsSettings === undefined
  ) {
    return;
  }

  await updateSignalMonitorProfile(patch);
}

export async function runSignalOptionsShadowBackfill(input: {
  deploymentId: string;
  start?: unknown;
  end?: unknown;
  session?: unknown;
  commit?: boolean;
  profilePatch?: unknown;
  pyrusSignalsSettingsPatch?: unknown;
  signalTimeframe?: unknown;
  forceDeploymentUniverse?: boolean;
  symbolUniverseOverride?: string[];
  replay?: SignalOptionsReplayMetadata | boolean | null;
  replaceReplayRows?: boolean;
  progress?: boolean;
}) {
  if (activeScanDeploymentIds.has(input.deploymentId)) {
    throw new HttpError(409, "Signal-options scan is already running.", {
      code: "signal_options_scan_running",
      detail:
        "A worker, manual scan, or backfill is already active for this deployment.",
      expose: true,
    });
  }

  markSignalOptionsScanActive(input.deploymentId);
  try {
    const deployment = await getDeploymentOrThrow(input.deploymentId);
    const window = resolveSignalOptionsBackfillWindow(input);
    const replay =
      input.replay && typeof input.replay === "object"
        ? {
            ...input.replay,
            marketDate: input.replay.marketDate || window.startDate,
            deploymentId: input.replay.deploymentId || deployment.id,
            deploymentName: normalizeLegacyAlgoBrandText(
              input.replay.deploymentName || deployment.name,
            ),
          }
        : input.replay
          ? {
              runId: `manual-replay-${window.startDate}-through-${window.endDate}-${Date.now()}`,
              marketDate: window.startDate,
              deploymentId: deployment.id,
              deploymentName: normalizeLegacyAlgoBrandText(deployment.name),
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
    const pyrusSignalsProfileSettings = asRecord(
      signalProfile.pyrusSignalsSettings,
    );
    const pyrusSignalsSettings = mergePyrusSignalsSettingsPatch(
      pyrusSignalsProfileSettings,
      input.pyrusSignalsSettingsPatch,
    );
    const resolvedPyrusSignalsSettings =
      resolvePyrusSignalsSignalSettings(pyrusSignalsSettings);
    const backfillUniverse = buildSignalOptionsBackfillUniverse({
      deploymentSymbols: input.symbolUniverseOverride?.length
        ? input.symbolUniverseOverride
        : deployment.symbolUniverse,
      signalMonitorSymbols: input.forceDeploymentUniverse
        ? []
        : signalUniverse.symbols,
      watchlistId: signalUniverse.profile.watchlistId,
      skippedSymbols: input.forceDeploymentUniverse
        ? []
        : signalUniverse.skippedSymbols,
      truncated: input.forceDeploymentUniverse
        ? false
        : signalUniverse.truncated,
    });
    const signalProfileTimeframe = resolveSignalMonitorTimeframe(
      signalUniverse.profile.timeframe,
    );
    const timeframe = resolveSignalMonitorTimeframe(
      input.signalTimeframe,
      signalProfileTimeframe,
    );
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
    const initialEvents =
      replay || !commit
        ? []
        : await listDeploymentBackfillEvents(deployment.id);
    const seenSignals = seenSignalKeys(initialEvents, {
      currentPremiumCap: profile.riskCaps.maxPremiumPerEntry,
      dailyLossHaltEnabled: profile.riskHaltControls.dailyLossHaltEnabled,
      premiumBudgetEnabled: profile.riskHaltControls.premiumBudgetEnabled,
      gatewayReadinessBlockEnabled:
        profile.infrastructureHaltControls.gatewayReadinessBlockEnabled,
      contractResolutionBackoffEnabled:
        profile.infrastructureHaltControls.contractResolutionBackoffEnabled,
    });
    const existingBackfillEvents = buildBackfillEventIndexes(initialEvents);
    const positionsBySymbol = new Map<string, HistoricalBackfillOpenPosition>();
    const realizedByDay = new Map<string, number>();
    const { signals, errors, structuralContextsBySymbol } =
      await loadHistoricalBackfillSignals({
        profileId: signalProfile.id,
        profileSettings: pyrusSignalsSettings,
        symbols: backfillUniverse.symbols,
        timeframe,
        window,
        progress: input.progress,
      });
    summary.errors.push(...errors);
    summary.signalsEvaluated = signals.length;
    if (input.progress) {
      console.log(
        `[signal-options-backfill] loaded ${signals.length} signals errors=${errors.length}`,
      );
    }

    let lastSignalAt: Date | null = null;
    for (let signalIndex = 0; signalIndex < signals.length; signalIndex += 1) {
      const historicalSignal = signals[signalIndex];
      if (input.progress && signalIndex % 25 === 0) {
        console.log(
          `[signal-options-backfill] processing signal ${signalIndex + 1}/${signals.length} ${historicalSignal.symbol} ${historicalSignal.signalAt.toISOString()}`,
        );
      }
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
          source: "pyrus-signals-backfill",
          filterState: asRecord(historicalSignal.signal.filterState),
        },
      });
      const symbol = normalizeSymbol(candidate.symbol).toUpperCase();
      const currentPosition = positionsBySymbol.get(symbol);

      if (
        currentPosition &&
        currentPosition.direction === candidate.direction &&
        profile.positionHaltControls.sameDirectionPositionBlockEnabled !== false
      ) {
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

      if (
        currentPosition &&
        currentPosition.direction !== candidate.direction
      ) {
        if (
          !profile.exitPolicy.flipOnOppositeSignal &&
          profile.positionHaltControls.oppositeSignalFlipBlockEnabled !== false
        ) {
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
          finiteNumber(currentPosition.lastMarkPrice) ??
          currentPosition.entryPrice;
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
      if (
        profile.riskHaltControls.dailyLossHaltEnabled !== false &&
        dailyPnl <= -Math.abs(profile.riskCaps.maxDailyLoss)
      ) {
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

      if (
        profile.riskHaltControls.openSymbolCapEnabled !== false &&
        positionsBySymbol.size >= profile.riskCaps.maxOpenSymbols
      ) {
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

      if (input.progress) {
        console.log(
          `[signal-options-backfill] resolving option ${candidate.symbol} ${candidate.optionRight} ${historicalSignal.signalAt.toISOString()}`,
        );
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
      if (input.progress) {
        console.log(
          `[signal-options-backfill] resolved option ${candidate.symbol} ok=${Boolean(resolved)}`,
        );
      }
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

      const entryAt =
        dateOrNull(resolved.entryBar.timestamp) ?? historicalSignal.signalAt;
      const firstFutureBarIndex = resolved.optionBars.findIndex((bar) => {
        const barAt = dateOrNull(bar.timestamp);
        return Boolean(barAt && barAt.getTime() > entryAt.getTime());
      });
      const nextBarIndex =
        firstFutureBarIndex >= 0
          ? firstFutureBarIndex
          : resolved.optionBars.length;
      const structuralContexts =
        structuralContextsBySymbol[normalizeSymbol(symbol).toUpperCase()] ?? [];
      const firstFutureStructuralIndex = structuralContexts.findIndex(
        (context) => {
          const contextAt = dateOrNull(context.latestBarAt);
          return Boolean(contextAt && contextAt.getTime() > entryAt.getTime());
        },
      );
      const nextStructuralIndex =
        firstFutureStructuralIndex >= 0
          ? firstFutureStructuralIndex
          : structuralContexts.length;
      const signalQuality = classifySignalOptionsEntryQuality({
        candidate,
        orderPlan: resolved.orderPlan,
      });
      const position = buildBackfillPosition({
        deployment,
        candidate,
        selectedContract: resolved.selectedContract,
        orderPlan: resolved.orderPlan,
        signalQuality,
        entryAt,
        optionBars: resolved.optionBars,
        optionTrades: resolved.optionTrades,
        structuralContexts,
        nextBarIndex,
        nextStructuralIndex,
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
        backfillEventKey: backfillEventKey(
          [deployment.id, signalKey, "entry"],
          eventSource,
        ),
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
            expirationDate:
              resolved.selectedExpiration.expirationDate.toISOString(),
            dte: resolved.selectedExpiration.dte,
          },
          selectedContract: resolved.selectedContract,
          quote: resolved.quote,
          orderPlan: resolved.orderPlan,
          liquidity: resolved.liquidity,
          signalQuality,
          position: backfillPositionPayload(position),
          historicalPricing: {
            source: "massive-option-aggregates",
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
      pyrusSignalsSettings: resolvedPyrusSignalsSettings,
      pyrusSignalsSettingsPatch: asRecord(input.pyrusSignalsSettingsPatch),
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
    clearSignalOptionsScanActive(input.deploymentId);
    activeSignalOptionsRunMetadata.delete(input.deploymentId);
  }
}

export async function runSignalOptionsShadowScan(input: {
  deploymentId: string;
  forceEvaluate?: boolean;
  source?: "manual" | "worker";
  actionWorkBudgetMs?: number | null;
  actionWorkItemLimit?: number | null;
  signal?: AbortSignal;
}) {
  throwIfSignalOptionsScanAborted(input.signal);
  if (activeScanDeploymentIds.has(input.deploymentId)) {
    return signalOptionsScanAlreadyRunningResponse(input);
  }
  markSignalOptionsScanActive(input.deploymentId);
  try {
    return await runSignalOptionsShadowScanUnlocked(input);
  } finally {
    clearSignalOptionsScanActive(input.deploymentId);
    activeSignalOptionsRunMetadata.delete(input.deploymentId);
  }
}

async function runSignalOptionsShadowScanUnlocked(input: {
  deploymentId: string;
  forceEvaluate?: boolean;
  source?: "manual" | "worker";
  actionWorkBudgetMs?: number | null;
  actionWorkItemLimit?: number | null;
  signal?: AbortSignal;
}) {
  throwIfSignalOptionsScanAborted(input.signal);
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
  const profile = resolveDeploymentProfile(deployment);
  const readiness = await getAlgoGatewayReadiness();
  if (
    !readiness.ready &&
    !(source === "worker" && readiness.reason === SIGNAL_OPTIONS_MARKET_SESSION_QUIET_REASON) &&
    profile.infrastructureHaltControls.gatewayReadinessBlockEnabled !== false
  ) {
    await recordSignalOptionsGatewayBlocked({ deployment, readiness, source });
  }

  const universe = new Set(
    deployment.symbolUniverse
      .map((symbol) => normalizeSymbol(symbol).toUpperCase())
      .filter(Boolean),
  );
  updateSignalOptionsRunMetadata(deployment.id, {
    phase: "signal_refresh",
  });
  const evaluated = await loadSignalOptionsMonitorState({
    deployment,
    universe,
    forceEvaluate: input.forceEvaluate,
    source,
    readinessReason: readiness.reason,
    signal: input.signal,
  });
  throwIfSignalOptionsScanAborted(input.signal);
  const signalScanCompletedAt = new Date();
  const signalLastSignalAt = latestFreshSignalAtFromStates({
    states: evaluated.states as SignalMonitorState[],
    universe,
  });
  const signalSummary = buildWorkerScanSummary({
    states: evaluated.states as SignalMonitorState[],
    universe,
    candidateCount: 0,
    blockedCandidateCount: 0,
    batch: asRecord(asRecord(evaluated).signalOptionsBatch),
    lastSignalScanAt: signalScanCompletedAt.toISOString(),
    activeScanPhase: "signal_refresh",
  });
  updateSignalOptionsRunMetadata(deployment.id, {
    phase: "signal_refresh",
    lastSignalScanAt: signalScanCompletedAt.toISOString(),
    latestSignalBarAt: signalSummary.latestSignalBarAt,
  });
  await db
    .update(algoDeploymentsTable)
    .set({
      lastEvaluatedAt: signalScanCompletedAt,
      lastSignalAt: signalLastSignalAt ?? deployment.lastSignalAt,
      lastError: null,
      updatedAt: signalScanCompletedAt,
    })
    .where(eq(algoDeploymentsTable.id, deployment.id));
  throwIfSignalOptionsScanAborted(input.signal);

  const heavyWorkDecision = shouldDeferSignalOptionsHeavyWork();
  if (heavyWorkDecision.defer) {
    updateSignalOptionsRunMetadata(deployment.id, {
      phase: "deferred",
      heavyWorkDeferred: true,
    });
    const deferredActivePositionCount =
      source === "worker"
        ? await loadSignalOptionsActivePositionCountForWorkerSummary(deployment.id)
        : 0;
    throwIfSignalOptionsScanAborted(input.signal);
    const summary = buildWorkerScanSummary({
      states: evaluated.states as SignalMonitorState[],
      universe,
      candidateCount: 0,
      blockedCandidateCount: 0,
      activePositionCount: deferredActivePositionCount,
      batch: asRecord(asRecord(evaluated).signalOptionsBatch),
      lastSignalScanAt: signalScanCompletedAt.toISOString(),
      heavyWorkDeferred: true,
      activeScanPhase: "deferred",
      resourcePressureLevel: heavyWorkDecision.pressure.level,
    });
    if (source === "worker") {
      return {
        deployment: deploymentToResponse({
          ...deployment,
          lastEvaluatedAt: signalScanCompletedAt,
          lastSignalAt: signalLastSignalAt ?? deployment.lastSignalAt,
          lastError: null,
          updatedAt: signalScanCompletedAt,
        }),
        summary,
      };
    }
    return listSignalOptionsAutomationState({ deploymentId: deployment.id });
  }

  updateSignalOptionsRunMetadata(deployment.id, {
    phase: "action_scan",
    heavyWorkDeferred: false,
  });
  const actionWorkBudget = createSignalOptionsActionWorkBudget({
    source,
    actionWorkBudgetMs: input.actionWorkBudgetMs,
    actionWorkItemLimit: input.actionWorkItemLimit,
  });
  const actionCursor = actionCursorForDeployment(deployment.id);

  const initialEvents = await listDeploymentEvents(
    deployment.id,
    SIGNAL_OPTIONS_STATE_EVENT_LIMIT,
  );
  throwIfSignalOptionsScanAborted(input.signal);
  const initialSignalEvents = runtimeSignalOptionsEvents(initialEvents);
  const initialPositions = await reconcileActivePositionsWithShadowLedger({
    positions: deriveActivePositions(initialSignalEvents),
    events: initialSignalEvents,
  });
  const unmanagedPositionSymbols = new Set<string>();
  const evaluatedStates = evaluated.states as SignalMonitorState[];
  const signalActionStates = orderSignalOptionsActionStates({
    states: evaluatedStates,
    universe,
  });
  const evaluatedProfile = asRecord(asRecord(evaluated).profile);
  const evaluatedPyrusSignalsSettings = asRecord(
    evaluatedProfile.pyrusSignalsSettings,
  );
  const positionSignature =
    signalOptionsPositionActionSignature(initialPositions);
  const signalSignature = signalOptionsStateActionSignature({
    states: signalActionStates,
    universe,
  });
  const initialProfileUpdatedAt =
    latestSignalOptionsControlUpdatedAt(initialSignalEvents);
  const initialSeenSignals = seenSignalKeys(initialSignalEvents, {
    activePositions: initialPositions,
    currentPremiumCap: profile.riskCaps.maxPremiumPerEntry,
    dailyLossHaltEnabled: profile.riskHaltControls.dailyLossHaltEnabled,
    premiumBudgetEnabled: profile.riskHaltControls.premiumBudgetEnabled,
    forceRetryMarketData: input.forceEvaluate === true,
    gatewayReady: readiness.ready,
    gatewayReadinessBlockEnabled:
      profile.infrastructureHaltControls.gatewayReadinessBlockEnabled,
    contractResolutionBackoffEnabled:
      profile.infrastructureHaltControls.contractResolutionBackoffEnabled,
    profileUpdatedAt: initialProfileUpdatedAt,
  });
  const resumingSignalWork =
    source === "worker" &&
    actionCursor.phase === "signals" &&
    actionCursor.positionSignature === positionSignature;
  let nextPositionIndex =
    source === "worker" &&
    actionCursor.phase === "positions" &&
    actionCursor.positionSignature === positionSignature
      ? clampActionCursorIndex(
          actionCursor.positionIndex,
          initialPositions.length,
        )
      : 0;
  let nextSignalIndex =
    source === "worker" &&
      actionCursor.phase === "signals" &&
      actionCursor.positionSignature === positionSignature &&
      actionCursor.signalSignature === signalSignature
      ? clampActionCursorIndex(actionCursor.signalIndex, signalActionStates.length)
      : 0;
  let actionWorkDeferred = false;
  let positionWorkDeferred = false;

  if (resumingSignalWork) {
    nextPositionIndex = initialPositions.length;
  }

  const hasPendingActionableSignals = hasUnseenSignalOptionsActionableState({
    states: signalActionStates,
    universe,
    seenSignals: initialSeenSignals,
    startIndex: nextSignalIndex,
  });
  const signalFirstActionScan =
    source === "worker" &&
    !resumingSignalWork &&
    hasPendingActionableSignals;

  if (signalFirstActionScan) {
    positionWorkDeferred = initialPositions.length > 0;
    nextPositionIndex = 0;
  } else {
    for (
      let positionIndex = nextPositionIndex;
      positionIndex < initialPositions.length;
      positionIndex += 1
    ) {
      throwIfSignalOptionsScanAborted(input.signal);
      if (signalOptionsActionWorkExhausted(actionWorkBudget)) {
        positionWorkDeferred = true;
        nextPositionIndex = positionIndex;
        break;
      }
      const position = initialPositions[positionIndex];
      if (!position) {
        nextPositionIndex = positionIndex + 1;
        continue;
      }
      const refreshResult = await withSignalOptionsActionItemTimeout({
        reason: "position_mark_timeout",
        timeoutMs: SIGNAL_OPTIONS_POSITION_MARK_TIMEOUT_MS,
        signal: input.signal,
        task: (signal) =>
          refreshActivePosition({
            deployment,
            profile,
            position,
            pyrusSignalsSettings: evaluatedPyrusSignalsSettings,
            recentEvents: initialSignalEvents,
            signal,
          }),
      }).catch(async (error: unknown) => {
        throwIfSignalOptionsScanAborted(input.signal);
        const occurredAt = new Date();
        const reason = signalOptionsPositionMarkErrorReason(error);
        if (
          !shouldRecordPositionMarkSkip({
            events: initialSignalEvents,
            position,
            reason,
            now: occurredAt,
          })
        ) {
          return { managed: false, reason };
        }
        await insertSignalOptionsEvent({
          deployment,
          symbol: position.symbol,
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          summary: `${position.symbol} shadow mark skipped: ${reason}`,
          occurredAt,
          payload: {
            reason,
            ...signalOptionsPositionMarkErrorDetail(error, reason),
            position,
          },
        });
        return { managed: false, reason };
      });
      throwIfSignalOptionsScanAborted(input.signal);
      if (!refreshResult.managed) {
        unmanagedPositionSymbols.add(
          normalizeSymbol(position.symbol).toUpperCase(),
        );
      }
      recordSignalOptionsActionWorkItem(actionWorkBudget);
      nextPositionIndex = positionIndex + 1;
    }
  }

  const positionPhaseBudgetExhausted =
    source === "worker" &&
    (positionWorkDeferred ||
      (nextPositionIndex >= initialPositions.length &&
        signalOptionsActionWorkExhausted(actionWorkBudget)));
  let signalActionWorkBudget = actionWorkBudget;
  if (positionPhaseBudgetExhausted && hasPendingActionableSignals) {
    signalActionWorkBudget = createSignalOptionsSignalReserveBudget({ source });
  }

  if (
    source === "worker" &&
    positionPhaseBudgetExhausted &&
    !hasPendingActionableSignals
  ) {
    updateSignalOptionsRunMetadata(deployment.id, {
      heavyWorkDeferred: true,
    });
    rememberSignalOptionsActionCursor({
      deploymentId: deployment.id,
      phase: positionWorkDeferred ? "positions" : "signals",
      positionSignature,
      positionIndex: positionWorkDeferred
        ? nextPositionIndex >= initialPositions.length
          ? 0
          : nextPositionIndex
        : initialPositions.length,
      signalSignature,
      signalIndex: positionWorkDeferred ? 0 : nextSignalIndex,
    });
    return {
      deployment: deploymentToResponse({
        ...deployment,
        lastEvaluatedAt: signalScanCompletedAt,
        lastSignalAt: signalLastSignalAt ?? deployment.lastSignalAt,
        lastError: null,
        updatedAt: signalScanCompletedAt,
      }),
      summary: buildWorkerScanSummary({
        states: evaluatedStates,
        universe,
        candidateCount: 0,
        blockedCandidateCount: 0,
        activePositionCount: initialPositions.length,
        batch: asRecord(asRecord(evaluated).signalOptionsBatch),
        lastSignalScanAt: signalScanCompletedAt.toISOString(),
        heavyWorkDeferred: true,
        activeScanPhase: "action_scan",
        resourcePressureLevel: heavyWorkDecision.pressure.level,
      }),
    };
  }

  const deferredPositionSymbols =
    positionWorkDeferred && nextPositionIndex < initialPositions.length
      ? initialPositions
          .slice(nextPositionIndex)
          .map((position) => normalizeSymbol(position.symbol).toUpperCase())
          .filter(Boolean)
      : [];

  const eventsAfterMarks = await listDeploymentEvents(
    deployment.id,
    SIGNAL_OPTIONS_STATE_EVENT_LIMIT,
  );
  throwIfSignalOptionsScanAborted(input.signal);
  const eventsAfterMarksRuntime = runtimeSignalOptionsEvents(eventsAfterMarks);
  const activePositionsAfterMarks =
    await reconcileActivePositionsWithShadowLedger({
      positions: deriveActivePositions(eventsAfterMarksRuntime),
      events: eventsAfterMarksRuntime,
    });
  const profileUpdatedAt = latestSignalOptionsControlUpdatedAt(
    eventsAfterMarksRuntime,
  );
  const seenSignals = seenSignalKeys(eventsAfterMarksRuntime, {
    activePositions: activePositionsAfterMarks,
    currentPremiumCap: profile.riskCaps.maxPremiumPerEntry,
    dailyLossHaltEnabled: profile.riskHaltControls.dailyLossHaltEnabled,
    premiumBudgetEnabled: profile.riskHaltControls.premiumBudgetEnabled,
    forceRetryMarketData: input.forceEvaluate === true,
    gatewayReady: readiness.ready,
    gatewayReadinessBlockEnabled:
      profile.infrastructureHaltControls.gatewayReadinessBlockEnabled,
    contractResolutionBackoffEnabled:
      profile.infrastructureHaltControls.contractResolutionBackoffEnabled,
    profileUpdatedAt,
  });
  const dailyPnl = computeSignalOptionsDailyPnl(
    eventsAfterMarksRuntime,
    activePositionsAfterMarks,
  );
  const dailyLossBreached =
    dailyPnl <= -Math.abs(profile.riskCaps.maxDailyLoss);
  const dailyHaltActive =
    profile.riskHaltControls.dailyLossHaltEnabled !== false &&
    dailyLossBreached;
  const activePositionsBySymbol = new Map(
    activePositionsAfterMarks.map((position) => [
      normalizeSymbol(position.symbol).toUpperCase(),
      position,
    ]),
  );
  let lastSignalAt: Date | null = signalLastSignalAt;
  let openSymbols = activePositionsBySymbol.size;
  let candidateCount = 0;
  let blockedCandidateCount = 0;
  const degradedPositionSymbols = [
    ...unmanagedPositionSymbols,
    ...deferredPositionSymbols,
  ].filter(Boolean);
  const positionMarkHaltActive = degradedPositionSymbols.length > 0;
  const signalMtfMatrixBySymbol = hasPendingActionableSignals
    ? await loadSignalOptionsMtfMatrixBySymbol({
        deployment,
        states: signalActionStates,
        universe,
        source,
      })
    : new Map<string, Map<string, Record<string, unknown>>>();
  throwIfSignalOptionsScanAborted(input.signal);

  for (
    let stateIndex = nextSignalIndex;
    stateIndex < signalActionStates.length;
    stateIndex += 1
  ) {
    throwIfSignalOptionsScanAborted(input.signal);
    if (signalOptionsActionWorkExhausted(signalActionWorkBudget)) {
      actionWorkDeferred = true;
      nextSignalIndex = stateIndex;
      break;
    }
    const state = signalActionStates[stateIndex];
    if (!state) {
      nextSignalIndex = stateIndex + 1;
      continue;
    }
    const symbol = normalizeSymbol(state.symbol).toUpperCase();
    if (!symbol || (universe.size > 0 && !universe.has(symbol))) {
      continue;
    }
    if (!isSignalOptionsActionableSignalState(state)) {
      continue;
    }
    const signalAt = toIsoString(state.currentSignalAt);
    if (!signalAt) {
      continue;
    }
    const signalKey = buildSignalKey(state, signalAt);
    lastSignalAt = latestSignalDate(lastSignalAt, signalAt);
    if (seenSignals.has(signalKey)) {
      continue;
    }

    seenSignals.add(signalKey);
    const signalMetadata = await readSignalMonitorEventMetadata({
      state,
      signalAt,
    }).catch(() => null);
    throwIfSignalOptionsScanAborted(input.signal);
    const candidate = enrichSignalOptionsCandidateWithMatrixMtf(
      buildCandidateFromSignal({
        deployment,
        state,
        signalAt,
        signalKey,
        freshWindowBars: optionalFiniteNumber(evaluatedProfile.freshWindowBars),
        signalMetadata,
      }),
      signalMtfMatrixBySymbol,
    );
    candidateCount += 1;
    recordSignalOptionsActionWorkItem(signalActionWorkBudget);
    const currentPosition = activePositionsBySymbol.get(symbol);

    if (
      currentPosition &&
      currentPosition.direction === candidate.direction &&
      profile.positionHaltControls.sameDirectionPositionBlockEnabled !== false
    ) {
      blockedCandidateCount += 1;
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
      if (
        !profile.exitPolicy.flipOnOppositeSignal &&
        profile.positionHaltControls.oppositeSignalFlipBlockEnabled !== false
      ) {
        blockedCandidateCount += 1;
        await emitSkippedCandidate({
          deployment,
          candidate,
          signalKey,
          reason: "opposite_signal_flip_disabled",
          detail: { position: currentPosition },
        });
        continue;
      }
      const closed = await closePositionForOppositeSignal({
        deployment,
        profile,
        position: currentPosition,
        signalKey,
        candidate,
      });
      throwIfSignalOptionsScanAborted(input.signal);
      if (!closed) {
        blockedCandidateCount += 1;
        continue;
      }
      activePositionsBySymbol.delete(symbol);
      openSymbols = Math.max(0, openSymbols - 1);
    }

    const entryGate = evaluateSignalOptionsEntryGate({ candidate, profile });
    if (!entryGate.ok) {
      blockedCandidateCount += 1;
      await emitSkippedCandidate({
        deployment,
        candidate,
        signalKey,
        reason: entryGate.reason ?? "entry_gate_failed",
        detail: { entryGate },
      });
      continue;
    }

    const executionBlocker =
      signalOptionsExecutionBlocker({
        dailyHaltActive,
        dailyPnl,
        profile,
        openSymbols,
        positionMarkHaltActive,
        degradedPositionSymbols,
      }) ?? signalOptionsGatewayExecutionBlocker(readiness, profile);

    const opened = await withSignalOptionsActionItemTimeout({
      reason: "candidate_resolution_timeout",
      timeoutMs: SIGNAL_OPTIONS_CANDIDATE_RESOLUTION_TIMEOUT_MS,
      signal: input.signal,
      task: (signal) =>
        processEntryCandidate({
          deployment,
          profile,
          candidate,
          signalKey,
          executionBlocker,
          recentEvents: eventsAfterMarksRuntime,
          signal,
        }),
    }).catch(async (error: unknown) => {
      throwIfSignalOptionsScanAborted(input.signal);
      const reason = signalOptionsCandidateResolutionErrorReason(error);
      await emitSkippedCandidate({
        deployment,
        candidate,
        signalKey,
        reason,
        detail: signalOptionsCandidateResolutionErrorDetail(error, reason),
      });
      return false;
    });
    throwIfSignalOptionsScanAborted(input.signal);

    if (opened) {
      openSymbols += 1;
    } else {
      blockedCandidateCount += 1;
    }
    nextSignalIndex = stateIndex + 1;
  }

  if (source === "worker" && (actionWorkDeferred || positionWorkDeferred)) {
    updateSignalOptionsRunMetadata(deployment.id, {
      heavyWorkDeferred: true,
    });
    rememberSignalOptionsActionCursor({
      deploymentId: deployment.id,
      phase: actionWorkDeferred ? "signals" : "positions",
      positionSignature,
      positionIndex: actionWorkDeferred
        ? initialPositions.length
        : nextPositionIndex >= initialPositions.length
          ? 0
          : nextPositionIndex,
      signalSignature,
      signalIndex: actionWorkDeferred ? nextSignalIndex : 0,
    });
  } else {
    signalOptionsActionCursors.delete(deployment.id);
  }

  await db
    .update(algoDeploymentsTable)
    .set({
      lastEvaluatedAt: signalScanCompletedAt,
      lastSignalAt: lastSignalAt ?? deployment.lastSignalAt,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(algoDeploymentsTable.id, deployment.id));
  throwIfSignalOptionsScanAborted(input.signal);

  if (source === "worker") {
    return {
      deployment: deploymentToResponse({
        ...deployment,
        lastEvaluatedAt: signalScanCompletedAt,
        lastSignalAt: lastSignalAt ?? deployment.lastSignalAt,
        lastError: null,
        updatedAt: new Date(),
      }),
      summary: buildWorkerScanSummary({
        states: evaluatedStates,
        universe,
        candidateCount,
        blockedCandidateCount,
        activePositionCount: activePositionsBySymbol.size,
        batch: asRecord(asRecord(evaluated).signalOptionsBatch),
        lastSignalScanAt: signalScanCompletedAt.toISOString(),
        heavyWorkDeferred: actionWorkDeferred || positionWorkDeferred,
        activeScanPhase: "action_scan",
        resourcePressureLevel: heavyWorkDecision.pressure.level,
      }),
    };
  }

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
    summary: `Updated signal-options profile for ${normalizeLegacyAlgoBrandText(nextDeployment.name)}`,
    payload: {
      profile: nextProfile,
    },
  });

  return {
    deployment: deploymentToResponse(nextDeployment),
    profile: nextProfile,
  };
}

export const __signalOptionsAutomationInternalsForTests = {
  buildCandidateFromSignal,
  candidateFromSignalSnapshot,
  previewCandidateFromSignalSnapshot,
  buildCockpitAttention,
  buildCockpitDiagnostics,
  buildCockpitPipeline,
  clearSignalOptionsScanActive,
  signalOptionsPressurePauseState,
  shouldDeferSignalOptionsHeavyWork,
  buildWorkerScanSummary,
  buildSignalOptionsActionMapping,
  buildSignalOptionsSignalSnapshot,
  candidateFromEvent,
  eventTimelineItem,
  isSignalOptionsVisibleSignalState,
  isSignalOptionsActionableSignalState,
  isSignalOptionsSignalAgeActionable,
  classifySignalOptionsSkipReason,
  latestSignalDate,
  findSignalOptionsQuoteForContract,
  mergeSignalOptionsCandidate,
  markSignalOptionsScanActive,
  deriveCandidateActionStatus,
  deriveActivePositions,
  reconcileActivePositionsWithShadowLinks,
  isSignalOptionsReplayEvent,
  runtimeSignalOptionsEvents,
  stateSignalOptionsEvents,
  computeSignalOptionsDailyPnl,
  computeSignalOptionsDailyRealizedPnl,
  computeSignalOptionsOpenUnrealizedPnl,
  computeOvernightPositionExit,
  computePositionStop,
  isLiveOptionTradingSession,
  isLiveOvernightExitWindow,
  evaluateSignalOptionsEntryGate,
  enrichSignalOptionsCandidateWithMatrixMtf,
  signalOptionsExecutionBlocker,
  signalOptionsGatewayExecutionBlocker,
  classifySignalOptionsEntryQuality,
  quoteSnapshotToSignalOptionsQuote,
  resolvePositionMarkQuote,
  isSignalOptionsLiveExitQuoteEligible,
  isSignalOptionsShadowMarkFallbackExitEligible,
  signalOptionsEntryEventHasActionableOptionSession,
  signalOptionsExitEventHasActionableOptionSession,
  signalOptionsTradeEventHasActionableOptionSession,
  selectHistoricalOptionTradeFill,
  selectSignalOptionsLegacyContractPlanFromChain,
  selectSignalOptionsContractPlanFromChain,
  selectSignalOptionsGreekContractPlanFromChain,
  isSignalOptionsGreekSelectorEnabled,
  signalOptionsContractPreviewFromResolution,
  optionBackoffFromDebug,
  optionChainBackoffFromAttempts,
  seenSignalKeys,
  shouldRecordPositionMarkSkip,
  resolveSignalOptionsMonitorBatch,
  resolveSignalOptionsWorkerMonitorBatchCapacity,
  resolveSignalOptionsMonitorFullRefresh,
  shouldRefreshSignalOptionsMonitorState,
  hasPendingSignalOptionsActionableState,
  hasUnseenSignalOptionsActionableState,
  orderSignalOptionsActionStates,
  signalOptionsStrikesAroundMoney,
  signalOptionsLiveQuoteDemandDetailFromResolution,
  signalOptionsSelectedLiveQuoteNeedsRetry,
  signalOptionsDecisionSnapshotContracts,
  buildSignalOptionsDataQualityReport,
  shouldRecordActivePositionMark,
  shouldRecordActivePositionMarkForScan,
  SIGNAL_OPTIONS_OPTION_MARK_TIMEFRAME,
  buildHistoricalMassiveOptionTicker,
  buildHistoricalOrderPlan,
  buildSignalOptionsBackfillUniverse,
  mergePyrusSignalsSettingsPatch,
  backfillEventKey,
  historicalEventPayload,
  replayPositionKey,
  resolveSignalOptionsBackfillWindow,
  historicalBackfillEquityBarLimit,
  selectHistoricalExpirationCandidates,
  selectHistoricalStrikeCandidates,
  isHistoricalOptionEntryBarTimely,
  readGreekSmokeInteger,
  shouldCloseBackfillPositionAtExpiration,
};
