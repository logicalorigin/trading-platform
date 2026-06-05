import {
  IbkrBridgeClient,
  type BridgeLaneDiagnosticsSnapshot,
} from "../providers/ibkr/bridge-client";
import type {
  IbkrMarketDataDesiredGeneration,
  IbkrMarketDataGenerationStatus,
} from "@workspace/ibkr-contracts";
import { normalizeSymbol } from "../lib/values";
import {
  getBridgeGovernorConfigSnapshot,
  getBridgeGovernorSnapshot,
} from "./bridge-governor";
import { getBridgeOptionQuoteStreamDiagnostics } from "./bridge-option-quote-stream";
import { getBridgeQuoteStreamDiagnostics } from "./bridge-quote-stream";
import { getMassiveStockQuoteStreamDiagnostics } from "./massive-stock-quote-stream";
import { getSignalMonitorLocalBarCacheDiagnostics } from "./signal-monitor-local-bar-cache";
import {
  getMarketDataAdmissionDiagnostics,
  setMarketDataAdmissionBridgeLineBudget,
  type MarketDataLease,
} from "./market-data-admission";
import { getRuntimeMassiveProviderDiagnostics } from "./platform-market-data-diagnostics";
import { buildMarketDataWorkPlan } from "./market-data-work-planner";
import { buildIbkrSidecarDesiredGeneration } from "./ibkr-sidecar-generation";
import { getIbkrHistoricalAdmissionSnapshot } from "./ibkr-historical-admission";
import { ensureIbkrLaneRuntimeOverridesLoaded } from "./ibkr-lanes";
import {
  getOptionsFlowScannerDiagnostics,
} from "./platform";
import { getStockAggregateStreamDiagnostics } from "./stock-aggregate-stream";
import {
  IbkrAsyncSidecarClient,
  type IbkrAsyncSidecarMarketDataClient,
} from "./ibkr-async-sidecar-client";

type CachedBridgeLaneDiagnostics = {
  fetchedAt: number;
  value: BridgeLaneDiagnosticsSnapshot | null;
  error: string | null;
};

type BridgeLaneDiagnosticsClient = Pick<IbkrBridgeClient, "getLaneDiagnostics">;
type BridgeGenerationApplyClient = BridgeLaneDiagnosticsClient &
  Partial<Pick<IbkrBridgeClient, "applyMarketDataGeneration">>;
type AsyncSidecarGenerationApplyClient = Pick<
  IbkrAsyncSidecarMarketDataClient,
  "applyMarketDataGeneration"
>;
type GenerationApplyTarget = "disabled" | "tws-bridge" | "ib-async-sidecar";
type GenerationApplyResult = {
  status: IbkrMarketDataGenerationStatus | null;
  error: string | null;
  target: GenerationApplyTarget;
  enabled: boolean;
  pending: boolean;
  generationId: string | null;
  startedAt: string | null;
  completedAt: string | null;
};
type DriftGroup = {
  owner: string | null;
  intent: string | null;
  pool: string | null;
  assetClass: string | null;
  lineCount: number;
  leaseCount: number;
  lineSample: string[];
};

const BRIDGE_LANE_USAGE_CACHE_MS = 2_000;
const DEFAULT_BRIDGE_LANE_USAGE_TIMEOUT_MS = 1_500;
const PERSISTENT_BRIDGE_ONLY_OBSERVATION_COUNT = 2;
const PERSISTENT_BRIDGE_ONLY_GRACE_MS = 10_000;
const DEFAULT_MARKET_DATA_GENERATION_APPLY_TIMEOUT_MS = 30_000;
const MARKET_DATA_GENERATION_FAILED_APPLY_BACKOFF_MS = 30_000;
const DEFAULT_LINE_USAGE_GENERATION_COORDINATOR_INTERVAL_MS = 2_000;
type PersistentLineObservation = {
  lineId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  observedCount: number;
};
let cachedBridgeLaneDiagnostics: CachedBridgeLaneDiagnostics | null = null;
let bridgeLaneDiagnosticsPromise: Promise<CachedBridgeLaneDiagnostics> | null = null;
let bridgeLaneDiagnosticsStartedAt = 0;
let bridgeLaneDiagnosticsRequestId = 0;
let marketDataGenerationApplyInFlight:
  | {
      key: string;
      target: GenerationApplyTarget;
      generationId: string;
      startedAt: number;
      sequence: number;
      promise: Promise<GenerationApplyResult>;
    }
  | null = null;
let latestMarketDataGenerationApply: (GenerationApplyResult & {
  key: string;
  completedAtMs: number | null;
}) | null = null;
let marketDataGenerationApplySequence = 0;
let lineUsageGenerationCoordinatorTimer: ReturnType<typeof setInterval> | null =
  null;
let lineUsageGenerationCoordinatorInFlight: Promise<unknown> | null = null;
const bridgeOnlyLineObservations = new Map<string, PersistentLineObservation>();
const apiOnlyLineObservations = new Map<string, PersistentLineObservation>();
let bridgeLaneDiagnosticsClientFactory: () => BridgeLaneDiagnosticsClient = () =>
  new IbkrBridgeClient();
let asyncSidecarClientFactory: () => AsyncSidecarGenerationApplyClient = () =>
  new IbkrAsyncSidecarClient();

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readTruthyEnv(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function readFalseyEnv(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "0" || raw === "false" || raw === "no" || raw === "off";
}

function shouldApplyMarketDataGeneration(): boolean {
  return !readFalseyEnv("IBKR_MARKET_DATA_GENERATION_APPLY_ENABLED");
}

function shouldRouteMarketDataGenerationToAsyncSidecar(): boolean {
  return readTruthyEnv("IBKR_ASYNC_SIDECAR_ROUTING_ENABLED");
}

function bridgeLaneUsageTimeoutMs(): number {
  return readPositiveIntegerEnv(
    "IBKR_LINE_USAGE_BRIDGE_TIMEOUT_MS",
    DEFAULT_BRIDGE_LANE_USAGE_TIMEOUT_MS,
  );
}

function bridgeLaneUsageStaleInFlightMs(): number {
  return Math.max(30_000, bridgeLaneUsageTimeoutMs() * 4);
}

function marketDataGenerationApplyTimeoutMs(): number {
  return readPositiveIntegerEnv(
    "IBKR_MARKET_DATA_GENERATION_APPLY_TIMEOUT_MS",
    DEFAULT_MARKET_DATA_GENERATION_APPLY_TIMEOUT_MS,
  );
}

function lineUsageGenerationCoordinatorIntervalMs(): number {
  return readPositiveIntegerEnv(
    "IBKR_LINE_USAGE_GENERATION_COORDINATOR_INTERVAL_MS",
    DEFAULT_LINE_USAGE_GENERATION_COORDINATOR_INTERVAL_MS,
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "IBKR bridge line usage is unavailable.";
}

function timedOutBridgeLaneDiagnostics(
  timeoutMs: number,
): CachedBridgeLaneDiagnostics {
  const cached = cachedBridgeLaneDiagnostics;
  return {
    fetchedAt: Date.now(),
    value: cached?.value ?? null,
    error: cached?.value
      ? `IBKR bridge lane diagnostics timed out after ${timeoutMs}ms; using cached bridge lanes.`
      : `IBKR bridge lane diagnostics timed out after ${timeoutMs}ms.`,
  };
}

function resolveBridgeLaneDiagnosticsWithin(
  promise: Promise<CachedBridgeLaneDiagnostics>,
  timeoutMs: number,
): Promise<CachedBridgeLaneDiagnostics> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(timedOutBridgeLaneDiagnostics(timeoutMs));
    }, timeoutMs);
    timeout.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        resolve({
          fetchedAt: Date.now(),
          value: cachedBridgeLaneDiagnostics?.value ?? null,
          error: getErrorMessage(error),
        });
      },
    );
  });
}

function startBridgeLaneDiagnosticsRequest(
  now: number,
): Promise<CachedBridgeLaneDiagnostics> {
  const requestId = ++bridgeLaneDiagnosticsRequestId;
  bridgeLaneDiagnosticsStartedAt = now;
  const request = bridgeLaneDiagnosticsClientFactory()
    .getLaneDiagnostics()
    .then((value) => ({
      fetchedAt: Date.now(),
      value,
      error: null,
    }))
    .catch((error) => ({
      fetchedAt: Date.now(),
      value: null,
      error: getErrorMessage(error),
    }))
    .then((snapshot) => {
      if (bridgeLaneDiagnosticsRequestId === requestId) {
        cachedBridgeLaneDiagnostics = snapshot;
      }
      return snapshot;
    })
    .finally(() => {
      if (bridgeLaneDiagnosticsRequestId === requestId) {
        bridgeLaneDiagnosticsPromise = null;
      }
    });
  bridgeLaneDiagnosticsPromise = request;
  return request;
}

async function getCachedBridgeLaneDiagnostics(): Promise<CachedBridgeLaneDiagnostics> {
  const now = Date.now();
  const timeoutMs = bridgeLaneUsageTimeoutMs();
  if (
    cachedBridgeLaneDiagnostics &&
    now - cachedBridgeLaneDiagnostics.fetchedAt < BRIDGE_LANE_USAGE_CACHE_MS
  ) {
    return cachedBridgeLaneDiagnostics;
  }
  if (
    !bridgeLaneDiagnosticsPromise ||
    now - bridgeLaneDiagnosticsStartedAt > bridgeLaneUsageStaleInFlightMs()
  ) {
    startBridgeLaneDiagnosticsRequest(now);
  }
  const pending = bridgeLaneDiagnosticsPromise;
  if (!pending) {
    return timedOutBridgeLaneDiagnostics(timeoutMs);
  }

  return resolveBridgeLaneDiagnosticsWithin(
    pending,
    timeoutMs,
  );
}

function readNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function lineDriftSample(values: Set<string>): string[] {
  return Array.from(values).sort().slice(0, 20);
}

function lineAssetClass(lineId: string): string | null {
  if (lineId.startsWith("equity:")) {
    return "equity";
  }
  if (lineId.startsWith("option:")) {
    return "option";
  }
  return null;
}

function isSnapshotOnlyAdmissionLease(lease: MarketDataLease): boolean {
  void lease;
  return false;
}

function buildAdmissionLineIdSets(
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>,
): {
  all: Set<string>;
  comparable: Set<string>;
  snapshotOnly: Set<string>;
} {
  const all = new Set<string>();
  const comparable = new Set<string>();
  const snapshotOnly = new Set<string>();
  admission.leases.forEach((lease) => {
    lease.lineIds.forEach((lineId) => {
      all.add(lineId);
      if (isSnapshotOnlyAdmissionLease(lease)) {
        snapshotOnly.add(lineId);
      } else {
        comparable.add(lineId);
      }
    });
  });
  comparable.forEach((lineId) => snapshotOnly.delete(lineId));
  return { all, comparable, snapshotOnly };
}

function buildBridgeLineIds(subscriptions: Record<string, unknown>): Set<string> {
  const result = new Set<string>();
  readStringArray(subscriptions.activeEquitySymbols).forEach((symbol) => {
    const normalized = normalizeSymbol(symbol);
    if (normalized) {
      result.add(`equity:${normalized}`);
    }
  });
  readStringArray(subscriptions.activeOptionProviderContractIds).forEach(
    (providerContractId) => {
      const normalized = providerContractId.trim();
      if (normalized) {
        result.add(`option:${normalized}`);
      }
    },
  );
  return result;
}

function buildSubscriptionsFromGenerationStatus(input: {
  status: IbkrMarketDataGenerationStatus;
  fallback: Record<string, unknown>;
}): Record<string, unknown> {
  const activeLines = input.status.lines.filter(
    (line) => line.state === "live" || line.state === "subscribing",
  );
  const activeEquitySymbols = activeLines
    .filter((line) => line.assetClass === "equity" && line.contract.symbol)
    .map((line) => normalizeSymbol(line.contract.symbol ?? ""))
    .filter(Boolean)
    .sort();
  const activeOptionProviderContractIds = activeLines
    .filter(
      (line) =>
        line.assetClass === "option" && line.contract.providerContractId,
    )
    .map((line) => line.contract.providerContractId?.trim() ?? "")
    .filter(Boolean)
    .sort();

  return {
    ...input.fallback,
    activeQuoteSubscriptions: activeLines.length,
    activeEquitySubscriptions: activeEquitySymbols.length,
    activeOptionSubscriptions: activeOptionProviderContractIds.length,
    activeEquitySymbols,
    activeOptionProviderContractIds,
  };
}

function classifyLineDrift(input: {
  apiOnlyCount: number;
  bridgeOnlyCount: number;
  bridgeDiagnosticsAvailable: boolean;
}):
  | "matched"
  | "api_released_bridge_active"
  | "api_active_bridge_missing"
  | "mixed"
  | "unknown" {
  if (!input.bridgeDiagnosticsAvailable) {
    return "unknown";
  }
  if (input.apiOnlyCount > 0 && input.bridgeOnlyCount > 0) {
    return "mixed";
  }
  if (input.bridgeOnlyCount > 0) {
    return "api_released_bridge_active";
  }
  if (input.apiOnlyCount > 0) {
    return "api_active_bridge_missing";
  }
  return "matched";
}

function buildApiOnlyLineGroups(input: {
  lineIds: Set<string>;
  leases: MarketDataLease[];
}): DriftGroup[] {
  const groups = new Map<
    string,
    DriftGroup & { lines: Set<string>; leases: Set<string> }
  >();
  input.leases.forEach((lease) => {
    const matchingLineIds = lease.lineIds.filter((lineId) =>
      input.lineIds.has(lineId),
    );
    if (matchingLineIds.length === 0) {
      return;
    }
    const key = `${lease.owner}\u0000${lease.intent}\u0000${lease.pool}`;
    const group =
      groups.get(key) ??
      {
        owner: lease.owner,
        intent: lease.intent,
        pool: lease.pool,
        assetClass: null,
        lineCount: 0,
        leaseCount: 0,
        lineSample: [],
        lines: new Set<string>(),
        leases: new Set<string>(),
      };
    matchingLineIds.forEach((lineId) => group.lines.add(lineId));
    group.leases.add(lease.id);
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .map((group) => ({
      owner: group.owner,
      intent: group.intent,
      pool: group.pool,
      assetClass: group.assetClass,
      lineCount: group.lines.size,
      leaseCount: group.leases.size,
      lineSample: lineDriftSample(group.lines),
    }))
    .sort(
      (left, right) =>
        right.lineCount - left.lineCount ||
        String(left.owner).localeCompare(String(right.owner)),
    )
    .slice(0, 20);
}

function buildBridgeOnlyLineGroups(lineIds: Set<string>): DriftGroup[] {
  const groups = new Map<string, Set<string>>();
  lineIds.forEach((lineId) => {
    const assetClass = lineAssetClass(lineId) ?? "unknown";
    const group = groups.get(assetClass) ?? new Set<string>();
    group.add(lineId);
    groups.set(assetClass, group);
  });

  return Array.from(groups.entries())
    .map(([assetClass, lines]) => ({
      owner: null,
      intent: null,
      pool: null,
      assetClass,
      lineCount: lines.size,
      leaseCount: 0,
      lineSample: lineDriftSample(lines),
    }))
    .sort(
      (left, right) =>
        right.lineCount - left.lineCount ||
        String(left.assetClass).localeCompare(String(right.assetClass)),
    );
}

function updatePersistentLineObservations(
  observations: Map<string, PersistentLineObservation>,
  lineIds: Set<string>,
) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  Array.from(observations.keys()).forEach((lineId) => {
    if (!lineIds.has(lineId)) {
      observations.delete(lineId);
    }
  });
  lineIds.forEach((lineId) => {
    const existing = observations.get(lineId);
    observations.set(lineId, {
      lineId,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      observedCount: (existing?.observedCount ?? 0) + 1,
    });
  });
  return Array.from(observations.values())
    .filter(
      (entry) =>
        lineIds.has(entry.lineId) &&
        entry.observedCount >= PERSISTENT_BRIDGE_ONLY_OBSERVATION_COUNT &&
        nowMs - Date.parse(entry.firstSeenAt) >= PERSISTENT_BRIDGE_ONLY_GRACE_MS,
    )
    .sort((left, right) => left.lineId.localeCompare(right.lineId));
}

function updateBridgeOnlyLineObservations(lineIds: Set<string>) {
  return updatePersistentLineObservations(bridgeOnlyLineObservations, lineIds);
}

function updateApiOnlyLineObservations(lineIds: Set<string>) {
  return updatePersistentLineObservations(apiOnlyLineObservations, lineIds);
}

function leaseForLine(
  lineId: string,
  leases: MarketDataLease[],
): MarketDataLease | null {
  return leases.find((lease) => lease.lineIds.includes(lineId)) ?? null;
}

function buildLineStateSample(input: {
  matchedLineIds: Set<string>;
  apiOnlyLineIds: Set<string>;
  bridgeOnlyLineIds: Set<string>;
  snapshotOnlyLineIds: Set<string>;
  leases: MarketDataLease[];
  persistentApiOnlyLineIds: Set<string>;
  persistentBridgeOnlyLineIds: Set<string>;
}) {
  const rows: Array<{
    lineId: string;
    state: "live" | "planned" | "stale" | "releasing" | "unexpected";
    owner: string | null;
    intent: string | null;
    pool: string | null;
    assetClass: string | null;
    reason: string;
  }> = [];
  const append = (
    lineIds: Set<string>,
    stateForLine: (lineId: string) => {
      state: "live" | "planned" | "stale" | "releasing" | "unexpected";
      reason: string;
    },
    limit: number,
  ) => {
    lineDriftSample(lineIds)
      .slice(0, limit)
      .forEach((lineId) => {
        const lease = leaseForLine(lineId, input.leases);
        const { state, reason } = stateForLine(lineId);
        rows.push({
          lineId,
          state,
          owner: lease?.owner ?? null,
          intent: lease?.intent ?? null,
          pool: lease?.pool ?? null,
          assetClass: lineAssetClass(lineId),
          reason,
        });
      });
  };

  append(
    input.apiOnlyLineIds,
    (lineId) =>
      input.persistentApiOnlyLineIds.has(lineId)
        ? {
            state: "stale",
            reason: "API admission persistently owns this line, but bridge diagnostics do not show it live.",
          }
        : {
            state: "planned",
            reason: "API admission owns this line and is waiting for bridge activation.",
          },
    20,
  );
  append(
    input.bridgeOnlyLineIds,
    (lineId) =>
      input.persistentBridgeOnlyLineIds.has(lineId)
        ? {
            state: "unexpected",
            reason: "Bridge persistently has this line without an API admission owner.",
          }
        : {
            state: "releasing",
            reason: "Bridge has this line after API admission released it.",
          },
    20,
  );
  append(
    input.snapshotOnlyLineIds,
    () => ({
      state: "planned",
      reason: "API admission marked this line as snapshot-only.",
    }),
    10,
  );
  append(
    input.matchedLineIds,
    () => ({
      state: "live",
      reason: "API admission and bridge diagnostics both show this line live.",
    }),
    Math.max(0, 40 - rows.length),
  );
  return rows.slice(0, 40);
}

function buildLineDriftReconciliation(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  subscriptions: Record<string, unknown>;
  bridgeDiagnosticsAvailable: boolean;
}) {
  const apiLineSets = buildAdmissionLineIdSets(input.admission);
  const apiLineIds = apiLineSets.comparable;
  const bridgeLineIds = input.bridgeDiagnosticsAvailable
    ? buildBridgeLineIds(input.subscriptions)
    : new Set<string>();
  const apiOnlyLineIds = new Set(
    Array.from(apiLineIds).filter((lineId) => !bridgeLineIds.has(lineId)),
  );
  const bridgeOnlyLineIds = new Set(
    Array.from(bridgeLineIds).filter((lineId) => !apiLineIds.has(lineId)),
  );
  const matchedLineIds = new Set(
    Array.from(apiLineIds).filter((lineId) => bridgeLineIds.has(lineId)),
  );
  const persistentBridgeOnlyLines = input.bridgeDiagnosticsAvailable
    ? updateBridgeOnlyLineObservations(bridgeOnlyLineIds)
    : [];
  const persistentApiOnlyLines = input.bridgeDiagnosticsAvailable
    ? updateApiOnlyLineObservations(apiOnlyLineIds)
    : [];
  const persistentBridgeOnlyLineIds = new Set(
    persistentBridgeOnlyLines.map((entry) => entry.lineId),
  );
  const persistentApiOnlyLineIds = new Set(
    persistentApiOnlyLines.map((entry) => entry.lineId),
  );

  return {
    status: classifyLineDrift({
      apiOnlyCount: apiOnlyLineIds.size,
      bridgeOnlyCount: bridgeOnlyLineIds.size,
      bridgeDiagnosticsAvailable: input.bridgeDiagnosticsAvailable,
    }),
    apiLineCount: apiLineIds.size,
    totalApiLineCount: apiLineSets.all.size,
    snapshotOnlyApiLineCount: apiLineSets.snapshotOnly.size,
    bridgeLineCount: bridgeLineIds.size,
    matchedLineCount: matchedLineIds.size,
    apiOnlyLineCount: apiOnlyLineIds.size,
    bridgeOnlyLineCount: bridgeOnlyLineIds.size,
    snapshotOnlyApiLineSample: lineDriftSample(apiLineSets.snapshotOnly),
    apiOnlyLineSample: lineDriftSample(apiOnlyLineIds),
    bridgeOnlyLineSample: lineDriftSample(bridgeOnlyLineIds),
    snapshotOnlyApiGroups: buildApiOnlyLineGroups({
      lineIds: apiLineSets.snapshotOnly,
      leases: input.admission.leases,
    }),
    apiOnlyGroups: buildApiOnlyLineGroups({
      lineIds: apiOnlyLineIds,
      leases: input.admission.leases,
    }),
    bridgeOnlyGroups: buildBridgeOnlyLineGroups(bridgeOnlyLineIds),
    persistentBridgeOnlyGraceMs: PERSISTENT_BRIDGE_ONLY_GRACE_MS,
    persistentBridgeOnlyLineCount: persistentBridgeOnlyLines.length,
    persistentBridgeOnlyLineSample: persistentBridgeOnlyLines
      .map((entry) => entry.lineId)
      .slice(0, 20),
    persistentBridgeOnlyLines: persistentBridgeOnlyLines.slice(0, 20),
    persistentApiOnlyGraceMs: PERSISTENT_BRIDGE_ONLY_GRACE_MS,
    persistentApiOnlyLineCount: persistentApiOnlyLines.length,
    persistentApiOnlyLineSample: persistentApiOnlyLines
      .map((entry) => entry.lineId)
      .slice(0, 20),
    persistentApiOnlyLines: persistentApiOnlyLines.slice(0, 20),
    lineStates: buildLineStateSample({
      matchedLineIds,
      apiOnlyLineIds,
      bridgeOnlyLineIds,
      snapshotOnlyLineIds: apiLineSets.snapshotOnly,
      leases: input.admission.leases,
      persistentApiOnlyLineIds,
      persistentBridgeOnlyLineIds,
    }),
  };
}

function liveSurfaceForLease(
  lease: MarketDataLease,
): "account" | "visible" | null {
  if (lease.intent === "account-monitor-live") {
    return "account";
  }
  if (lease.intent === "visible-live") {
    return "visible";
  }
  return null;
}

function lineSymbol(lineId: string): string {
  if (lineId.startsWith("equity:")) {
    return lineId.slice("equity:".length);
  }
  if (lineId.startsWith("option:")) {
    return lineId.slice("option:".length);
  }
  return lineId;
}

function buildWarmupCoverage(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  subscriptions: Record<string, unknown>;
  bridgeDiagnosticsAvailable: boolean;
}) {
  const bridgeLineIds = input.bridgeDiagnosticsAvailable
    ? buildBridgeLineIds(input.subscriptions)
    : new Set<string>();
  const targetLineIds = new Set<string>();
  const accountLineIds = new Set<string>();
  const visibleLineIds = new Set<string>();
  const targetSymbols = new Set<string>();

  input.admission.leases.forEach((lease) => {
    const surface = liveSurfaceForLease(lease);
    if (!surface) {
      return;
    }
    lease.lineIds.forEach((lineId) => {
      targetLineIds.add(lineId);
      if (surface === "account") {
        accountLineIds.add(lineId);
      } else {
        visibleLineIds.add(lineId);
      }
      targetSymbols.add(lineSymbol(lineId));
    });
  });

  const pendingLineIds = new Set(
    Array.from(targetLineIds).filter((lineId) => !bridgeLineIds.has(lineId)),
  );
  const activeLineIds = new Set(
    Array.from(targetLineIds).filter((lineId) => bridgeLineIds.has(lineId)),
  );
  const accountPendingLineIds = new Set(
    Array.from(accountLineIds).filter((lineId) => !bridgeLineIds.has(lineId)),
  );
  const visiblePendingLineIds = new Set(
    Array.from(visibleLineIds).filter((lineId) => !bridgeLineIds.has(lineId)),
  );
  const coverageRatio =
    targetLineIds.size > 0 ? activeLineIds.size / targetLineIds.size : null;

  return {
    state: !input.bridgeDiagnosticsAvailable
      ? "unknown"
      : targetLineIds.size === 0
        ? "idle"
        : pendingLineIds.size > 0
          ? "pending"
          : "covered",
    targetLineCount: targetLineIds.size,
    activeBridgeLineCount: activeLineIds.size,
    pendingLineCount: pendingLineIds.size,
    accountTargetLineCount: accountLineIds.size,
    accountPendingLineCount: accountPendingLineIds.size,
    visibleTargetLineCount: visibleLineIds.size,
    visiblePendingLineCount: visiblePendingLineIds.size,
    coverageRatio,
    targetSymbolCount: targetSymbols.size,
    pendingLineSample: lineDriftSample(pendingLineIds),
    accountPendingLineSample: lineDriftSample(accountPendingLineIds),
    visiblePendingLineSample: lineDriftSample(visiblePendingLineIds),
  };
}

function buildSidecarGenerationComparison(input: {
  desiredGeneration: IbkrMarketDataDesiredGeneration;
  bridgeGenerationStatus: IbkrMarketDataGenerationStatus | null;
}) {
  if (!input.bridgeGenerationStatus) {
    return {
      status: "unknown" as const,
      desiredLineCount: input.desiredGeneration.summary.desiredLineCount,
      bridgeLineCount: null,
      matchedLineCount: null,
      desiredOnlyLineCount: null,
      bridgeOnlyLineCount: null,
      desiredOnlyLineSample: [],
      bridgeOnlyLineSample: [],
      reason: "bridge_generation_status_unavailable",
    };
  }

  const desiredLineIds = new Set(
    input.desiredGeneration.desiredLines.map((line) => line.lineKey),
  );
  const bridgeLineIds = new Set(
    input.bridgeGenerationStatus.lines
      .filter((line) => line.state === "live" || line.state === "subscribing")
      .map((line) => line.lineKey),
  );
  const matchedLineIds = new Set(
    Array.from(desiredLineIds).filter((lineId) => bridgeLineIds.has(lineId)),
  );
  const desiredOnlyLineIds = new Set(
    Array.from(desiredLineIds).filter((lineId) => !bridgeLineIds.has(lineId)),
  );
  const bridgeOnlyLineIds = new Set(
    Array.from(bridgeLineIds).filter((lineId) => !desiredLineIds.has(lineId)),
  );
  const status =
    desiredOnlyLineIds.size > 0 && bridgeOnlyLineIds.size > 0
      ? "mixed"
      : desiredOnlyLineIds.size > 0
        ? "desired_missing"
        : bridgeOnlyLineIds.size > 0
          ? "bridge_extra"
          : "matched";

  return {
    status,
    desiredLineCount: desiredLineIds.size,
    bridgeLineCount: bridgeLineIds.size,
    matchedLineCount: matchedLineIds.size,
    desiredOnlyLineCount: desiredOnlyLineIds.size,
    bridgeOnlyLineCount: bridgeOnlyLineIds.size,
    desiredOnlyLineSample: lineDriftSample(desiredOnlyLineIds),
    bridgeOnlyLineSample: lineDriftSample(bridgeOnlyLineIds),
    reason:
      status === "matched"
        ? "desired_generation_matches_bridge_live_lines"
        : "desired_generation_differs_from_bridge_live_lines",
  };
}

async function applyBridgeMarketDataGeneration(input: {
  desiredGeneration: IbkrMarketDataDesiredGeneration;
}): Promise<{
  status: IbkrMarketDataGenerationStatus | null;
  error: string | null;
  target: GenerationApplyTarget;
}> {
  const client = bridgeLaneDiagnosticsClientFactory() as BridgeGenerationApplyClient;
  if (typeof client.applyMarketDataGeneration !== "function") {
    return { status: null, error: null, target: "tws-bridge" };
  }

  try {
    return {
      status: await resolveMarketDataGenerationApplyWithin(
        client.applyMarketDataGeneration(input.desiredGeneration),
        marketDataGenerationApplyTimeoutMs(),
        "tws-bridge",
      ),
      error: null,
      target: "tws-bridge",
    };
  } catch (error) {
    return {
      status: null,
      error: getErrorMessage(error),
      target: "tws-bridge",
    };
  }
}

async function applyAsyncSidecarMarketDataGeneration(input: {
  desiredGeneration: IbkrMarketDataDesiredGeneration;
}): Promise<{
  status: IbkrMarketDataGenerationStatus | null;
  error: string | null;
  target: GenerationApplyTarget;
}> {
  try {
    return {
      status: await resolveMarketDataGenerationApplyWithin(
        asyncSidecarClientFactory().applyMarketDataGeneration(
          input.desiredGeneration,
        ),
        marketDataGenerationApplyTimeoutMs(),
        "ib-async-sidecar",
      ),
      error: null,
      target: "ib-async-sidecar",
    };
  } catch (error) {
    return {
      status: null,
      error: getErrorMessage(error),
      target: "ib-async-sidecar",
    };
  }
}

function resolveMarketDataGenerationApplyWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
  target: GenerationApplyTarget,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `IBKR market-data generation apply to ${target} timed out after ${timeoutMs}ms.`,
        ),
      );
    }, timeoutMs);
    timeout.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function applyMarketDataGeneration(input: {
  desiredGeneration: IbkrMarketDataDesiredGeneration;
  routeToAsyncSidecar: boolean;
}): Promise<GenerationApplyResult> {
  const startedAt = new Date().toISOString();
  const generationId = input.desiredGeneration.generationId;
  if (!shouldApplyMarketDataGeneration()) {
    return {
      status: null,
      error: null,
      target: "disabled",
      enabled: false,
      pending: false,
      generationId,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const result = input.routeToAsyncSidecar
    ? await applyAsyncSidecarMarketDataGeneration(input)
    : await applyBridgeMarketDataGeneration(input);
  if (input.routeToAsyncSidecar && result.error) {
    const fallback = await applyBridgeMarketDataGeneration(input);
    return {
      ...fallback,
      error:
        fallback.error && result.error
          ? `Async sidecar apply failed: ${result.error}; bridge fallback failed: ${fallback.error}`
          : fallback.error,
      enabled: true,
      pending: false,
      generationId,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
  return {
    ...result,
    enabled: true,
    pending: false,
    generationId,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

function marketDataGenerationApplyKey(input: {
  desiredGeneration: IbkrMarketDataDesiredGeneration;
  routeToAsyncSidecar: boolean;
}): {
  key: string;
  target: GenerationApplyTarget;
} {
  const target = input.routeToAsyncSidecar ? "ib-async-sidecar" : "tws-bridge";
  return {
    key: `${target}:${input.desiredGeneration.generationId}`,
    target,
  };
}

function scheduleMarketDataGenerationApply(input: {
  desiredGeneration: IbkrMarketDataDesiredGeneration;
  routeToAsyncSidecar: boolean;
}): GenerationApplyResult {
  if (!shouldApplyMarketDataGeneration()) {
    return {
      status: null,
      error: null,
      target: "disabled",
      enabled: false,
      pending: false,
      generationId: input.desiredGeneration.generationId,
      startedAt: null,
      completedAt: null,
    };
  }

  const now = Date.now();
  const { key, target } = marketDataGenerationApplyKey(input);
  if (
    latestMarketDataGenerationApply?.error &&
    latestMarketDataGenerationApply.target === target &&
    latestMarketDataGenerationApply.completedAtMs !== null &&
    now - latestMarketDataGenerationApply.completedAtMs <
      MARKET_DATA_GENERATION_FAILED_APPLY_BACKOFF_MS
  ) {
    return latestMarketDataGenerationApply;
  }
  if (latestMarketDataGenerationApply?.key === key) {
    const retryAfterError =
      Boolean(latestMarketDataGenerationApply.error) &&
      latestMarketDataGenerationApply.completedAtMs !== null &&
      now - latestMarketDataGenerationApply.completedAtMs >=
        MARKET_DATA_GENERATION_FAILED_APPLY_BACKOFF_MS;
    if (!retryAfterError) {
      return latestMarketDataGenerationApply;
    }
  }

  if (marketDataGenerationApplyInFlight) {
    return {
      status: latestMarketDataGenerationApply?.key ===
        marketDataGenerationApplyInFlight.key
        ? latestMarketDataGenerationApply.status
        : null,
      error: null,
      target: marketDataGenerationApplyInFlight.target,
      enabled: true,
      pending: true,
      generationId: marketDataGenerationApplyInFlight.generationId,
      startedAt: new Date(marketDataGenerationApplyInFlight.startedAt).toISOString(),
      completedAt: null,
    };
  }

  const startedAt = now;
  const sequence = (marketDataGenerationApplySequence += 1);
  const promise = applyMarketDataGeneration(input).then((result) => {
    if (sequence === marketDataGenerationApplySequence) {
      latestMarketDataGenerationApply = {
        ...result,
        key,
        completedAtMs: Date.now(),
      };
    }
    return result;
  });
  marketDataGenerationApplyInFlight = {
    key,
    target,
    generationId: input.desiredGeneration.generationId,
    startedAt,
    sequence,
    promise,
  };
  void promise.finally(() => {
    if (
      marketDataGenerationApplyInFlight?.key === key &&
      marketDataGenerationApplyInFlight.sequence === sequence
    ) {
      marketDataGenerationApplyInFlight = null;
    }
  });

  return {
    status: latestMarketDataGenerationApply?.key === key
      ? latestMarketDataGenerationApply.status
      : null,
    error: null,
    target,
    enabled: true,
    pending: true,
    generationId: input.desiredGeneration.generationId,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: null,
  };
}

function readMarketDataGenerationApplyState(input: {
  desiredGeneration: IbkrMarketDataDesiredGeneration;
  routeToAsyncSidecar: boolean;
}): GenerationApplyResult {
  if (!shouldApplyMarketDataGeneration()) {
    return {
      status: null,
      error: null,
      target: "disabled",
      enabled: false,
      pending: false,
      generationId: input.desiredGeneration.generationId,
      startedAt: null,
      completedAt: null,
    };
  }

  const now = Date.now();
  const { key, target } = marketDataGenerationApplyKey(input);
  if (marketDataGenerationApplyInFlight) {
    return {
      status:
        latestMarketDataGenerationApply?.key ===
        marketDataGenerationApplyInFlight.key
          ? latestMarketDataGenerationApply.status
          : null,
      error: null,
      target: marketDataGenerationApplyInFlight.target,
      enabled: true,
      pending: true,
      generationId: marketDataGenerationApplyInFlight.generationId,
      startedAt: new Date(
        marketDataGenerationApplyInFlight.startedAt,
      ).toISOString(),
      completedAt: null,
    };
  }

  if (
    latestMarketDataGenerationApply?.error &&
    latestMarketDataGenerationApply.target === target &&
    latestMarketDataGenerationApply.completedAtMs !== null &&
    now - latestMarketDataGenerationApply.completedAtMs <
      MARKET_DATA_GENERATION_FAILED_APPLY_BACKOFF_MS
  ) {
    return latestMarketDataGenerationApply;
  }

  if (latestMarketDataGenerationApply?.key === key) {
    return latestMarketDataGenerationApply;
  }

  return {
    status: null,
    error: null,
    target,
    enabled: true,
    pending: false,
    generationId: input.desiredGeneration.generationId,
    startedAt: null,
    completedAt: null,
  };
}

function buildLineUsagePolicy(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  bridgeLineBudget: number | null;
}) {
  const budget = input.admission.budget;
  return {
    policy: input.admission.pressure.policy,
    maxLines: budget.maxLines,
    reserveLines: budget.reserveLines,
    usableLines: budget.usableLines,
    targetFillLines: budget.targetFillLines,
    configuredMaxLines: budget.configuredMaxLines,
    bridgeLineBudget: input.bridgeLineBudget ?? budget.bridgeLineBudget,
    bridgeLineBudgetObservedAt: budget.bridgeLineBudgetObservedAt,
    budgetSource: budget.budgetSource,
    executionLineCap: budget.poolLineCaps.execution,
    accountMonitorLineCap: budget.accountMonitorLineCap,
    accountMonitorDynamic: true,
    automationLineCap: budget.automationLineCap,
    scannerStaticLineCap: budget.flowScannerLineCap,
    scannerDynamicLineCap: input.admission.pressure.scannerDynamicLineCap,
    optionReserveLineCount: input.admission.pressure.optionReserveLineCount,
    nonScannerOptionLineCount: input.admission.pressure.nonScannerOptionLineCount,
  };
}

function buildLineAllocation(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  bridgeActiveLineCount: number | null;
  bridgeLineBudget: number | null;
}) {
  const admission = input.admission;
  const pressure = admission.pressure;
  const lineAllocation = admission.lineAllocation;
  const portfolio = admission.portfolio;
  const scannerLineUtilization = (
    admission as ReturnType<typeof getMarketDataAdmissionDiagnostics> & {
      optionsFlowScanner?: ReturnType<typeof getOptionsFlowScannerDiagnostics>;
    }
  ).optionsFlowScanner?.lineUtilization;
  const targetFillLines = readNumber(admission.budget.targetFillLines);
  const activeLineCount = readNumber(admission.activeLineCount);
  const shadowAccount = admission.shadowAccount ?? null;
  const scannerSchedulableLineCap = readNumber(
    scannerLineUtilization?.schedulablePoolCap,
  );
  const scannerActiveLineCount = readNumber(pressure.scannerActiveLineCount);
  const scannerSchedulableRemainingLineCount =
    scannerSchedulableLineCap === null || scannerActiveLineCount === null
      ? null
      : Math.max(0, scannerSchedulableLineCap - scannerActiveLineCount);
  const remainingToTargetLineCount =
    targetFillLines === null || activeLineCount === null
      ? null
      : Math.max(0, targetFillLines - activeLineCount);

  return {
    activeLineCount,
    activeEquityLineCount: readNumber(admission.activeEquityLineCount),
    routineEquityLineCount: readNumber(admission.routineEquityLineCount),
    optionSupportEquityLineCount: readNumber(
      admission.optionSupportEquityLineCount,
    ),
    manualDepthEquityLineCount: readNumber(admission.manualDepthEquityLineCount),
    targetFillLines,
    remainingToTargetLineCount,
    utilizationLevel:
      typeof pressure.utilizationLevel === "string"
        ? pressure.utilizationLevel
        : null,
    utilizationPercent: readNumber(pressure.utilizationPercent),
    usableRemainingLineCount: readNumber(admission.usableRemainingLineCount),
    protectedLineCount: readNumber(
      lineAllocation.protectedLineCount,
      pressure.protectedLineCount,
    ),
    visibleLineCount: readNumber(pressure.visibleLineCount),
    scannerActiveLineCount,
    scannerEffectiveLineCap: readNumber(pressure.scannerEffectiveLineCap),
    scannerSchedulableLineCap,
    scannerRemainingLineCount: readNumber(pressure.scannerRemainingLineCount),
    scannerSchedulableRemainingLineCount,
    scannerConstrainedByActiveDemand: Boolean(
      pressure.scannerConstrainedByActiveDemand,
    ),
    scannerDynamicLineCap: readNumber(pressure.scannerDynamicLineCap),
    optionBudgetLineCount: readNumber(pressure.optionBudgetLineCount),
    nonScannerOptionLineCount: readNumber(pressure.nonScannerOptionLineCount),
    optionReserveLineCount: readNumber(pressure.optionReserveLineCount),
    bridgeActiveLineCount: input.bridgeActiveLineCount,
    bridgeLineBudget: input.bridgeLineBudget,
    portfolioPolicy:
      typeof portfolio?.policy === "string" ? portfolio.policy : null,
    pinnedLineCount: readNumber(portfolio?.pinned?.activeLineCount),
    priorityLineCount: readNumber(portfolio?.priority?.activeLineCount),
    shadowAccountLineCount: readNumber(shadowAccount?.activeLineCount),
    shadowAccountCacheFallbackLineCount: readNumber(
      shadowAccount?.activeFallbackProviderLineCounts?.cache,
    ),
    shadowAccountMassiveFallbackLineCount: readNumber(
      shadowAccount?.activeFallbackProviderLineCounts?.massive,
    ),
    scannerRotatingLineCount: readNumber(
      portfolio?.scannerRotating?.activeLineCount,
    ),
    rotatingReclaimableLineCount: readNumber(
      portfolio?.rotatingReclaimableLineCount,
    ),
  };
}

function buildLineUtilizationAudit(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics> & {
    optionsFlowScanner: ReturnType<typeof getOptionsFlowScannerDiagnostics>;
  };
  allocation: ReturnType<typeof buildLineAllocation>;
  bridgeActiveLineCount: number | null;
  bridgeLineBudget: number | null;
  driftReconciliation: ReturnType<typeof buildLineDriftReconciliation>;
}) {
  const admission = input.admission;
  const scannerUtilization = admission.optionsFlowScanner.lineUtilization;
  const idleToTargetLineCount = readNumber(
    input.allocation.remainingToTargetLineCount,
  );
  const bridgeRemainingLineCount =
    input.bridgeLineBudget === null || input.bridgeActiveLineCount === null
      ? null
      : Math.max(0, input.bridgeLineBudget - input.bridgeActiveLineCount);
  const scannerUnusedPoolLineCount = readNumber(
    scannerUtilization.unusedPoolLines,
  );
  const scannerActiveLineCount = readNumber(admission.flowScannerLineCount) ?? 0;
  const deepScanner = admission.optionsFlowScanner.deepScanner;
  const scannerPlannedHorizonCount =
    readNumber(admission.optionsFlowScanner.plannedHorizon?.symbolCount) ??
    readNumber(admission.optionsFlowScanner.coverage?.activeTargetSize) ??
    readNumber(admission.optionsFlowScanner.coverage?.selectedSymbols) ??
    0;
  const scannerSchedulablePoolCap = readNumber(
    scannerUtilization.schedulablePoolCap,
  );
  const scannerSchedulableRemainingLineCount = readNumber(
    input.allocation.scannerSchedulableRemainingLineCount,
  );
  const scannerEffectiveConcurrency = readNumber(
    scannerUtilization.effectiveConcurrency,
  );
  const activeDeepScanCount = deepScanner.activeCount;
  const explicitQueuedDeepScanCount = deepScanner.queuedCount;
  const drainingDeepScanCount =
    readNumber(deepScanner.drainingCount) ??
    (deepScanner.draining ? activeDeepScanCount : 0);
  const pendingDrainingDeepScanCount = Math.max(
    0,
    drainingDeepScanCount - activeDeepScanCount,
  );
  const queuedDeepScanCount =
    explicitQueuedDeepScanCount + pendingDrainingDeepScanCount;
  const scheduledDeepScanCount = activeDeepScanCount + queuedDeepScanCount;
  const scannerEnabled = admission.optionsFlowScanner.enabled !== false;
  const scannerStarted = admission.optionsFlowScanner.started !== false;
  const scannerBlockedReason =
    !scannerEnabled
      ? "scanner-disabled"
      : !scannerStarted
        ? "scanner-not-started"
        : admission.optionsFlowScanner.backgroundBlockedReason ?? null;
  const scannerEligibleForSlack =
    scannerEnabled &&
    scannerStarted &&
    scannerBlockedReason === null &&
    scannerPlannedHorizonCount > 0 &&
    (scannerEffectiveConcurrency ?? 0) > 0;
  const idleLineCount = Math.max(0, idleToTargetLineCount ?? 0);
  const bridgeEligibleRemainingLineCount =
    bridgeRemainingLineCount === null
      ? idleLineCount
      : Math.min(idleLineCount, bridgeRemainingLineCount);
  const scannerWantedLineCount = scannerEligibleForSlack
    ? Math.max(
        0,
        Math.min(
          scannerSchedulablePoolCap ?? admission.budget.targetFillLines,
          readNumber(scannerUtilization.scannerLineBudget) ??
            admission.budget.targetFillLines,
        ),
      )
    : 0;
  const idleButEligibleLineCount = scannerEligibleForSlack
    ? Math.max(
        0,
        Math.min(
          idleLineCount,
          bridgeEligibleRemainingLineCount,
          scannerSchedulableRemainingLineCount ?? idleLineCount,
          Math.max(0, scannerWantedLineCount - scannerActiveLineCount),
        ),
      )
    : 0;
  const scannerWorkActive =
    scannerActiveLineCount > 0 ||
    Boolean(deepScanner.draining) ||
    scheduledDeepScanCount > 0;
  const scannerWaitingForLiveLines =
    scannerWorkActive &&
    scannerActiveLineCount === 0 &&
    (idleToTargetLineCount ?? 0) > 0 &&
    (bridgeRemainingLineCount === null || bridgeRemainingLineCount > 0);
  const scannerReclaimableLineCount =
    readNumber(admission.portfolio?.rotatingReclaimableLineCount) ?? 0;
  const scannerThrottledHighPressure =
    Boolean(admission.optionsFlowScanner.scannerPressure?.throttled) &&
    Number(admission.optionsFlowScanner.lineUtilization?.effectiveConcurrency) <= 1 &&
    scannerWorkActive;
  const admissionVsBridgeLineDelta =
    input.driftReconciliation.status === "unknown"
      ? input.bridgeActiveLineCount === null
        ? null
        : admission.activeLineCount - input.bridgeActiveLineCount
      : input.driftReconciliation.apiLineCount -
        input.driftReconciliation.bridgeLineCount;
  const topLimitingReason =
    admission.optionsFlowScanner.backgroundBlockedReason === "resource-pressure"
      ? "api-pressure-gate"
      : scannerThrottledHighPressure
        ? "scanner-throttled-high-pressure"
        : idleToTargetLineCount === 0 && scannerReclaimableLineCount > 0
          ? "scanner-filling-unused-capacity"
          : idleToTargetLineCount === 0
            ? "target-filled"
      : bridgeRemainingLineCount === 0
        ? "bridge-budget-full"
        : input.driftReconciliation.status === "unknown"
          ? "bridge-diagnostics-unavailable"
          : input.driftReconciliation.status !== "matched"
            ? "line-drift"
          : idleButEligibleLineCount > 0 && scannerWorkActive
            ? "scanner-filling-unused-capacity"
          : idleButEligibleLineCount > 0
            ? "scanner-idle-with-eligible-work"
          : scannerWaitingForLiveLines
            ? "scanner-waiting-for-live-lines"
          : scannerWorkActive
            ? "scanner-active"
          : admission.optionsFlowScanner.backgroundBlockedReason
            ? `scanner-${admission.optionsFlowScanner.backgroundBlockedReason}`
            : "active-demand-satisfied";

  return {
    targetLineCount: admission.budget.targetFillLines,
    admissionActiveLineCount: admission.activeLineCount,
    idleToTargetLineCount,
    bridgeActiveLineCount: input.bridgeActiveLineCount,
    bridgeLineBudget: input.bridgeLineBudget,
    bridgeRemainingLineCount,
    idleButEligibleLineCount,
    admissionVsBridgeLineDelta,
    driftStatus: input.driftReconciliation.status,
    topLimitingReason,
    scanner: {
      activeLineCount: scannerActiveLineCount,
      staticLineCap: admission.budget.flowScannerLineCap,
      effectiveLineCap: scannerUtilization.effectivePoolCap,
      schedulablePoolCap: scannerSchedulablePoolCap,
      schedulableRemainingLineCount: scannerSchedulableRemainingLineCount,
      configuredConcurrency: scannerUtilization.configuredConcurrency,
      effectiveConcurrency: scannerEffectiveConcurrency,
      scannerLineBudget: scannerUtilization.scannerLineBudget,
      wantedLineCount: scannerWantedLineCount,
      idleButEligibleLineCount,
      plannedHorizonCount: scannerPlannedHorizonCount,
      maxDeepScanLines: scannerUtilization.maxDeepScanLines,
      unusedPoolLineCount: scannerUnusedPoolLineCount,
      blockedReason: scannerBlockedReason,
      backgroundBlockedReason:
        admission.optionsFlowScanner.backgroundBlockedReason,
      scannerFillMode: admission.optionsFlowScanner.scannerFillMode,
      limitingReason: admission.optionsFlowScanner.limitingReason,
      activeDeepScanCount,
      queuedDeepScanCount,
      scheduledDeepScanCount,
      draining: deepScanner.draining,
      recentRotatedCount:
        admission.flowScannerActivity?.recentRotatedCount ?? 0,
      recentRejectedCount:
        admission.flowScannerActivity?.recentRejectedCount ?? 0,
      reclaimableLineCount: scannerReclaimableLineCount,
    },
  };
}

function buildAccountMonitorLineUsage(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  warmup: ReturnType<typeof buildWarmupCoverage>;
}) {
  const admissionAccount = input.admission.accountMonitor;
  return {
    dynamic: Boolean(admissionAccount.dynamic),
    lineCap: admissionAccount.lineCap,
    neededLineCount: admissionAccount.neededLineCount,
    coveredLineCount: admissionAccount.coveredLineCount,
    deferredLineCount: admissionAccount.deferredLineCount,
    availableExpansionLineCount: admissionAccount.availableExpansionLineCount,
    activeLineCount: admissionAccount.activeLineCount,
    remainingLineCount: admissionAccount.remainingLineCount,
    leaseCount: admissionAccount.leaseCount,
    ownerCount: admissionAccount.ownerCount,
    activeLineSample: admissionAccount.activeLineSample,
    activeSymbolSample: admissionAccount.activeSymbolSample,
    recentRejectedCount: admissionAccount.recentRejectedCount,
    recentRejectedLineSample: admissionAccount.recentRejectedLineSample,
    pendingLineCount: input.warmup.accountPendingLineCount,
    pendingLineSample: input.warmup.accountPendingLineSample,
    targetLineCount: input.warmup.accountTargetLineCount,
  };
}

async function buildIbkrLineUsageSnapshot(options: {
  scheduleGenerationApply: boolean;
}) {
  ensureIbkrLaneRuntimeOverridesLoaded();
  const bridge = await getCachedBridgeLaneDiagnostics();
  let subscriptions =
    bridge.value && typeof bridge.value.subscriptions === "object"
      ? (bridge.value.subscriptions as Record<string, unknown>)
      : {};
  let bridgeActiveLines = readNumber(subscriptions.activeQuoteSubscriptions);
  let bridgeLineBudget = readNumber(subscriptions.marketDataLineBudget);
  if (bridgeLineBudget !== null) {
    setMarketDataAdmissionBridgeLineBudget(bridgeLineBudget, bridge.fetchedAt);
  }
  const optionsFlowScanner = getOptionsFlowScannerDiagnostics();
  const admission = {
    ...getMarketDataAdmissionDiagnostics(),
    optionsFlowScanner,
  };
  const quoteStreams = getBridgeQuoteStreamDiagnostics();
  const optionQuoteStreams = getBridgeOptionQuoteStreamDiagnostics();
  const massiveStockQuotes = getMassiveStockQuoteStreamDiagnostics();
  const signalMonitorLocalBars = getSignalMonitorLocalBarCacheDiagnostics();
  const stockAggregates = getStockAggregateStreamDiagnostics();
  const massiveProvider = getRuntimeMassiveProviderDiagnostics({
    streams: {
      massiveStockQuotes,
      signalMonitorLocalBars,
      stockAggregates,
    },
  });
  const initialDriftReconciliation = buildLineDriftReconciliation({
    admission,
    subscriptions,
    bridgeDiagnosticsAvailable: Boolean(bridge.value),
  });
  const initialMarketDataWorkPlan = buildMarketDataWorkPlan({
    admission,
    optionsFlowScanner: admission.optionsFlowScanner,
    bridge: {
      diagnosticsAvailable: Boolean(bridge.value),
      activeLineCount: bridgeActiveLines,
      lineBudget: bridgeLineBudget,
    },
    drift: initialDriftReconciliation,
    stockAggregates,
  });
  const sidecarDesiredGeneration = buildIbkrSidecarDesiredGeneration({
    admission,
    generatedAt: initialMarketDataWorkPlan.generatedAt,
  });
  const routeToAsyncSidecar = shouldRouteMarketDataGenerationToAsyncSidecar();
  const generationApply = options.scheduleGenerationApply
    ? scheduleMarketDataGenerationApply({
        desiredGeneration: sidecarDesiredGeneration,
        routeToAsyncSidecar,
      })
    : readMarketDataGenerationApplyState({
        desiredGeneration: sidecarDesiredGeneration,
        routeToAsyncSidecar,
      });
  const bridgeGenerationStatus =
    generationApply.status ??
    bridge.value?.marketDataGeneration ??
    null;
  if (bridgeGenerationStatus) {
    subscriptions = buildSubscriptionsFromGenerationStatus({
      status: bridgeGenerationStatus,
      fallback: subscriptions,
    });
    bridgeActiveLines = readNumber(subscriptions.activeQuoteSubscriptions);
    bridgeLineBudget = readNumber(subscriptions.marketDataLineBudget);
    if (
      bridge.value &&
      generationApply.target === "tws-bridge" &&
      generationApply.status
    ) {
      bridge.value.marketDataGeneration = generationApply.status;
      bridge.value.subscriptions = subscriptions;
    }
  }
  const warmup = buildWarmupCoverage({
    admission,
    subscriptions,
    bridgeDiagnosticsAvailable: Boolean(bridge.value),
  });
  const driftReconciliation = buildLineDriftReconciliation({
    admission,
    subscriptions,
    bridgeDiagnosticsAvailable: Boolean(bridge.value),
  });
  const allocation = buildLineAllocation({
    admission,
    bridgeActiveLineCount: bridgeActiveLines,
    bridgeLineBudget,
  });
  const lineUtilizationAudit = buildLineUtilizationAudit({
    admission,
    allocation,
    bridgeActiveLineCount: bridgeActiveLines,
    bridgeLineBudget,
    driftReconciliation,
  });
  const marketDataWorkPlan = buildMarketDataWorkPlan({
    admission,
    optionsFlowScanner: admission.optionsFlowScanner,
    bridge: {
      diagnosticsAvailable: Boolean(bridge.value),
      activeLineCount: bridgeActiveLines,
      lineBudget: bridgeLineBudget,
    },
    drift: driftReconciliation,
    stockAggregates,
  });

  return {
    updatedAt: new Date().toISOString(),
    admission,
    historicalWork: {
      admission: getIbkrHistoricalAdmissionSnapshot(),
      bridge:
        bridge.value &&
        typeof bridge.value.scheduler === "object" &&
        bridge.value.scheduler &&
        "historical" in bridge.value.scheduler
          ? (bridge.value.scheduler as Record<string, unknown>).historical ?? null
          : null,
    },
    policy: buildLineUsagePolicy({
      admission,
      bridgeLineBudget,
    }),
    allocation,
    lineUtilizationAudit,
    bridge: {
      diagnostics: bridge.value,
      error: bridge.error,
      activeLineCount: bridgeActiveLines,
      lineBudget: bridgeLineBudget,
      remainingLineCount:
        bridgeLineBudget === null || bridgeActiveLines === null
          ? null
          : Math.max(0, bridgeLineBudget - bridgeActiveLines),
    },
    governor: getBridgeGovernorSnapshot(),
    governorConfig: getBridgeGovernorConfigSnapshot(),
    streams: {
      quoteStreams,
      optionQuoteStreams,
      massiveStockQuotes,
      stockAggregates,
    },
    providers: {
      massive: massiveProvider,
    },
    warmup,
    accountMonitor: buildAccountMonitorLineUsage({ admission, warmup }),
    ownerClasses: admission.ownerClasses,
    signalOptions: admission.signalOptions,
    shadowAccount: admission.shadowAccount,
    drift: {
      admissionVsBridgeLineDelta:
        driftReconciliation.status === "unknown" || bridgeActiveLines === null
          ? null
          : driftReconciliation.apiLineCount - driftReconciliation.bridgeLineCount,
      reconciliation: driftReconciliation,
    },
    marketDataWorkPlan,
    sidecar: {
      diagnosticsOnly: !routeToAsyncSidecar,
      routingEnabled: routeToAsyncSidecar,
      applyEnabled: generationApply.enabled,
      applyTarget: generationApply.target,
      applyError: generationApply.error,
      applyPending: generationApply.pending,
      applyGenerationId: generationApply.generationId,
      applyStartedAt: generationApply.startedAt,
      applyCompletedAt: generationApply.completedAt,
      desiredGeneration: sidecarDesiredGeneration,
      bridgeGenerationStatus,
      comparison: buildSidecarGenerationComparison({
        desiredGeneration: sidecarDesiredGeneration,
        bridgeGenerationStatus,
      }),
    },
  };
}

export async function getIbkrLineUsageSnapshot() {
  return buildIbkrLineUsageSnapshot({ scheduleGenerationApply: false });
}

export async function runIbkrLineUsageGenerationCoordinatorOnce() {
  return buildIbkrLineUsageSnapshot({ scheduleGenerationApply: true });
}

export function startIbkrLineUsageGenerationCoordinator(): () => void {
  if (lineUsageGenerationCoordinatorTimer) {
    return stopIbkrLineUsageGenerationCoordinator;
  }

  const run = () => {
    if (lineUsageGenerationCoordinatorInFlight) {
      return;
    }
    const task = runIbkrLineUsageGenerationCoordinatorOnce()
      .catch(() => null)
      .finally(() => {
        if (lineUsageGenerationCoordinatorInFlight === task) {
          lineUsageGenerationCoordinatorInFlight = null;
        }
      });
    lineUsageGenerationCoordinatorInFlight = task;
  };

  run();
  lineUsageGenerationCoordinatorTimer = setInterval(
    run,
    lineUsageGenerationCoordinatorIntervalMs(),
  );
  lineUsageGenerationCoordinatorTimer.unref?.();
  return stopIbkrLineUsageGenerationCoordinator;
}

export function stopIbkrLineUsageGenerationCoordinator(): void {
  if (lineUsageGenerationCoordinatorTimer) {
    clearInterval(lineUsageGenerationCoordinatorTimer);
    lineUsageGenerationCoordinatorTimer = null;
  }
  lineUsageGenerationCoordinatorInFlight = null;
}

export function __setIbkrLineUsageBridgeClientFactoryForTests(
  factory: (() => BridgeLaneDiagnosticsClient) | null,
): void {
  bridgeLaneDiagnosticsClientFactory = factory ?? (() => new IbkrBridgeClient());
  __resetIbkrLineUsageForTests();
}

export function __setIbkrLineUsageAsyncSidecarClientFactoryForTests(
  factory: (() => AsyncSidecarGenerationApplyClient) | null,
): void {
  asyncSidecarClientFactory =
    factory ?? (() => new IbkrAsyncSidecarClient());
  __resetIbkrLineUsageForTests();
}

export function __resetIbkrLineUsageForTests(): void {
  stopIbkrLineUsageGenerationCoordinator();
  marketDataGenerationApplySequence += 1;
  cachedBridgeLaneDiagnostics = null;
  bridgeLaneDiagnosticsPromise = null;
  bridgeLaneDiagnosticsStartedAt = 0;
  bridgeLaneDiagnosticsRequestId += 1;
  marketDataGenerationApplyInFlight = null;
  latestMarketDataGenerationApply = null;
  bridgeOnlyLineObservations.clear();
  apiOnlyLineObservations.clear();
}
