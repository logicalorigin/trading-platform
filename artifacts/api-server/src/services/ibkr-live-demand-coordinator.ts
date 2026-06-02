import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  getBridgeOptionQuoteStreamDiagnostics,
  getCurrentBridgeOptionQuoteSnapshots,
  subscribeBridgeOptionQuoteSnapshots,
  type OptionQuoteSnapshotPayload,
} from "./bridge-option-quote-stream";
import {
  getMarketDataAdmissionDiagnostics,
  getMarketDataLeasesSnapshot,
  type MarketDataFallbackProvider,
  type MarketDataIntent,
} from "./market-data-admission";

export type IbkrLiveDemandStatus =
  | "live"
  | "stale"
  | "pending"
  | "unavailable"
  | "rejected";

export type IbkrLiveDemandDeclaration = {
  owner: string;
  intent: MarketDataIntent;
  underlying?: string | null;
  providerContractIds: string[];
  fallbackProvider?: MarketDataFallbackProvider;
  requiresGreeks?: boolean;
  ttlMs?: number | null;
  onSnapshot?: (payload: OptionQuoteSnapshotPayload) => void;
};

export type IbkrLiveDemandReadInput = {
  owner?: string | null;
  underlying?: string | null;
  providerContractIds: string[];
  requiresGreeks?: boolean;
};

export type IbkrLiveDemandQuoteState = {
  providerContractId: string;
  status: IbkrLiveDemandStatus;
  reason: string | null;
  quote: (QuoteSnapshot & { source?: "ibkr" }) | null;
  cacheAgeMs: number | null;
};

export type IbkrLiveDemandState = {
  underlying: string | null;
  states: IbkrLiveDemandQuoteState[];
  diagnostics: ReturnType<typeof getIbkrLiveDemandDiagnostics>;
};

type ActiveDemand = {
  owner: string;
  intent: MarketDataIntent;
  underlying: string | null;
  providerContractIds: string[];
  fallbackProvider: MarketDataFallbackProvider;
  requiresGreeks: boolean;
  unsubscribe: () => void;
  expiresTimer: NodeJS.Timeout | null;
  lastPayload: OptionQuoteSnapshotPayload | null;
  signature: string;
  declaredAt: number;
};

const activeDemands = new Map<string, ActiveDemand>();

function normalizeOwner(owner: string): string {
  return owner.trim();
}

function normalizeUnderlying(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || null;
}

function normalizeProviderContractIds(providerContractIds: string[]): string[] {
  return Array.from(
    new Set(
      providerContractIds
        .map((providerContractId) => providerContractId.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function demandSignature(input: {
  intent: MarketDataIntent;
  underlying: string | null;
  providerContractIds: string[];
  fallbackProvider: MarketDataFallbackProvider;
  requiresGreeks: boolean;
}): string {
  return JSON.stringify({
    intent: input.intent,
    underlying: input.underlying,
    providerContractIds: input.providerContractIds,
    fallbackProvider: input.fallbackProvider,
    requiresGreeks: input.requiresGreeks,
  });
}

function clearDemandTimer(demand: ActiveDemand): void {
  if (!demand.expiresTimer) {
    return;
  }
  clearTimeout(demand.expiresTimer);
  demand.expiresTimer = null;
}

function installDemandTimer(demand: ActiveDemand, ttlMs: number | null | undefined): void {
  clearDemandTimer(demand);
  if (ttlMs == null) {
    return;
  }
  const normalizedTtlMs = Math.floor(Number(ttlMs));
  if (!Number.isFinite(normalizedTtlMs) || normalizedTtlMs <= 0) {
    return;
  }
  demand.expiresTimer = setTimeout(() => {
    releaseIbkrLiveDemand(demand.owner, "ttl_expired");
  }, normalizedTtlMs);
  demand.expiresTimer.unref?.();
}

function quoteHasAnyGreek(quote: QuoteSnapshot | undefined | null): boolean {
  return Boolean(
    quote &&
      [quote.delta, quote.gamma, quote.theta, quote.vega].some(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
  );
}

function quoteCacheAgeMs(quote: QuoteSnapshot | undefined | null): number | null {
  if (!quote) {
    return null;
  }
  const explicitAge =
    typeof quote.cacheAgeMs === "number" && Number.isFinite(quote.cacheAgeMs)
      ? quote.cacheAgeMs
      : typeof quote.ageMs === "number" && Number.isFinite(quote.ageMs)
        ? quote.ageMs
        : null;
  if (explicitAge !== null) {
    return Math.max(0, explicitAge);
  }
  const receivedAt = quote.latency?.apiServerReceivedAt;
  const timestamp =
    receivedAt instanceof Date
      ? receivedAt.getTime()
      : receivedAt
        ? new Date(receivedAt).getTime()
        : null;
  return timestamp !== null && Number.isFinite(timestamp)
    ? Math.max(0, Date.now() - timestamp)
    : null;
}

function demandIncludesProviderContractId(
  demand: ActiveDemand | undefined,
  providerContractId: string,
): boolean {
  return Boolean(demand?.providerContractIds.includes(providerContractId));
}

function activeLeaseExists(input: {
  owner?: string | null;
  providerContractId: string;
}): boolean {
  const leases = getMarketDataLeasesSnapshot();
  return leases.some(
    (lease) =>
      lease.providerContractId === input.providerContractId &&
      (!input.owner || lease.owner === input.owner),
  );
}

function resolveMissingQuoteState(input: {
  owner?: string | null;
  providerContractId: string;
  ownerDemand?: ActiveDemand;
}): { status: IbkrLiveDemandStatus; reason: string } {
  if (
    activeLeaseExists({
      owner: input.owner,
      providerContractId: input.providerContractId,
    })
  ) {
    return { status: "pending", reason: "awaiting_quote" };
  }

  const demandDebug = input.ownerDemand?.lastPayload?.debug;
  const demandUnavailableReason =
    typeof demandDebug?.errorCode === "string" && demandDebug.errorCode.trim()
      ? demandDebug.errorCode.trim()
      : typeof demandDebug?.blockedReason === "string" &&
          demandDebug.blockedReason.trim()
        ? demandDebug.blockedReason.trim()
        : null;
  if (demandUnavailableReason === "ibkr_bridge_not_configured") {
    return { status: "unavailable", reason: demandUnavailableReason };
  }

  if (demandIncludesProviderContractId(input.ownerDemand, input.providerContractId)) {
    return {
      status: "rejected",
      reason: demandUnavailableReason ?? "not_admitted",
    };
  }

  const streamDiagnostics = getBridgeOptionQuoteStreamDiagnostics();
  const streamStatus = streamDiagnostics.lastStreamStatus as
    | { reason?: unknown; state?: unknown }
    | null
    | undefined;
  const streamReason =
    typeof streamStatus?.reason === "string" && streamStatus.reason.trim()
      ? streamStatus.reason.trim()
      : null;
  if (streamReason) {
    return { status: "unavailable", reason: streamReason };
  }

  return { status: "unavailable", reason: "not_requested" };
}

function resolveQuoteState(input: {
  quote: QuoteSnapshot & { source?: "ibkr" };
  requiresGreeks: boolean;
}): { status: IbkrLiveDemandStatus; reason: string | null } {
  const freshness = String(input.quote.freshness ?? "").trim();
  if (freshness === "unavailable") {
    return { status: "unavailable", reason: "quote_unavailable" };
  }
  if (freshness === "pending" || freshness === "metadata") {
    return { status: "pending", reason: "quote_pending" };
  }
  if (input.requiresGreeks && !quoteHasAnyGreek(input.quote)) {
    return { status: "pending", reason: "awaiting_greeks" };
  }
  if (freshness === "stale") {
    return { status: "stale", reason: "stale_quote" };
  }
  return { status: "live", reason: null };
}

export function declareIbkrLiveDemand(input: IbkrLiveDemandDeclaration): void {
  const owner = normalizeOwner(input.owner);
  if (!owner) {
    return;
  }
  const providerContractIds = normalizeProviderContractIds(input.providerContractIds);
  if (!providerContractIds.length) {
    releaseIbkrLiveDemand(owner, "empty_demand");
    return;
  }

  const underlying = normalizeUnderlying(input.underlying);
  const fallbackProvider = input.fallbackProvider ?? "cache";
  const requiresGreeks = input.requiresGreeks ?? true;
  const signature = demandSignature({
    intent: input.intent,
    underlying,
    providerContractIds,
    fallbackProvider,
    requiresGreeks,
  });
  const existing = activeDemands.get(owner);
  if (existing?.signature === signature) {
    installDemandTimer(existing, input.ttlMs);
    return;
  }
  if (existing) {
    releaseIbkrLiveDemand(owner, "replaced");
  }

  const demand: ActiveDemand = {
    owner,
    intent: input.intent,
    underlying,
    providerContractIds,
    fallbackProvider,
    requiresGreeks,
    unsubscribe: () => {},
    expiresTimer: null,
    lastPayload: null,
    signature,
    declaredAt: Date.now(),
  };
  activeDemands.set(owner, demand);
  demand.unsubscribe = subscribeBridgeOptionQuoteSnapshots(
    {
      owner,
      intent: input.intent,
      underlying,
      providerContractIds,
      fallbackProvider,
      requiresGreeks,
    },
    (payload) => {
      demand.lastPayload = payload;
      input.onSnapshot?.(payload);
    },
  );
  installDemandTimer(demand, input.ttlMs);
}

export function subscribeIbkrLiveDemand(
  input: IbkrLiveDemandDeclaration,
  onSnapshot: (payload: OptionQuoteSnapshotPayload) => void,
): () => void {
  declareIbkrLiveDemand({ ...input, onSnapshot });
  return () => releaseIbkrLiveDemand(input.owner, "unsubscribe");
}

export function releaseIbkrLiveDemand(owner: string, _reason = "released"): void {
  const normalizedOwner = normalizeOwner(owner);
  const demand = activeDemands.get(normalizedOwner);
  if (!demand) {
    return;
  }
  activeDemands.delete(normalizedOwner);
  clearDemandTimer(demand);
  demand.unsubscribe();
}

export function readIbkrLiveDemandState(
  input: IbkrLiveDemandReadInput,
): IbkrLiveDemandState {
  const providerContractIds = normalizeProviderContractIds(input.providerContractIds);
  const underlying = normalizeUnderlying(input.underlying);
  const owner = input.owner ? normalizeOwner(input.owner) : null;
  const ownerDemand = owner ? activeDemands.get(owner) : undefined;
  const requiresGreeks = input.requiresGreeks ?? ownerDemand?.requiresGreeks ?? true;
  const quotesByProviderContractId = new Map(
    getCurrentBridgeOptionQuoteSnapshots({
      underlying,
      providerContractIds,
    }).map((quote) => [quote.providerContractId?.trim?.() || "", quote] as const),
  );

  return {
    underlying,
    states: providerContractIds.map((providerContractId) => {
      const quote = quotesByProviderContractId.get(providerContractId) ?? null;
      if (quote) {
        const state = resolveQuoteState({ quote, requiresGreeks });
        return {
          providerContractId,
          status: state.status,
          reason: state.reason,
          quote,
          cacheAgeMs: quoteCacheAgeMs(quote),
        };
      }
      const missing = resolveMissingQuoteState({
        owner,
        providerContractId,
        ownerDemand,
      });
      return {
        providerContractId,
        status: missing.status,
        reason: missing.reason,
        quote: null,
        cacheAgeMs: null,
      };
    }),
    diagnostics: getIbkrLiveDemandDiagnostics(),
  };
}

export function getIbkrLiveDemandDiagnostics() {
  const bridge = getBridgeOptionQuoteStreamDiagnostics();
  const admission = getMarketDataAdmissionDiagnostics();
  const requestedProviderContractIds = normalizeProviderContractIds(
    Array.from(activeDemands.values()).flatMap(
      (demand) => demand.providerContractIds,
    ),
  );

  return {
    activeDemandCount: activeDemands.size,
    requestedProviderContractIdCount: requestedProviderContractIds.length,
    requestedProviderContractIds: requestedProviderContractIds.slice(0, 100),
    desiredProviderContractIds: bridge.desiredProviderContractIds,
    subscribedProviderContractIdCount: bridge.unionProviderContractIdCount,
    cachedQuoteCount: bridge.cachedQuoteCount,
    streamPressure: bridge.pressure,
    streamStatus: bridge.lastStreamStatus,
    admissionIntentUsage: admission.intentUsage,
    admissionPoolUsage: admission.poolUsage,
    leaseCount: admission.leaseCount,
  };
}

export function __resetIbkrLiveDemandCoordinatorForTests(): void {
  Array.from(activeDemands.keys()).forEach((owner) => {
    releaseIbkrLiveDemand(owner, "test_reset");
  });
  activeDemands.clear();
}
