import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  getMassiveOptionQuoteStreamDiagnostics,
  getCurrentMassiveOptionQuoteSnapshots,
  subscribeMassiveOptionQuoteSnapshots,
  type OptionQuoteSnapshotPayload,
} from "./massive-option-quote-stream";
import {
  getMarketDataAdmissionDiagnostics,
  getMarketDataLeasesSnapshot,
  type MarketDataFallbackProvider,
  type MarketDataIntent,
} from "./market-data-admission";

type OptionQuoteSource = "ibkr" | "massive";

export type OptionQuoteDemandStatus =
  | "live"
  | "stale"
  | "pending"
  | "unavailable"
  | "rejected";

export type OptionQuoteDemandDeclaration = {
  owner: string;
  intent: MarketDataIntent;
  underlying?: string | null;
  providerContractIds: string[];
  fallbackProvider?: MarketDataFallbackProvider;
  requiresGreeks?: boolean;
  ttlMs?: number | null;
  onSnapshot?: (payload: OptionQuoteSnapshotPayload) => void;
};

export type OptionQuoteDemandReadInput = {
  owner?: string | null;
  underlying?: string | null;
  providerContractIds: string[];
  requiresGreeks?: boolean;
};

export type OptionQuoteDemandQuoteState = {
  providerContractId: string;
  status: OptionQuoteDemandStatus;
  reason: string | null;
  quoteStatus: OptionQuoteDemandStatus;
  quoteReason: string | null;
  greeksStatus: OptionQuoteDemandStatus;
  greeksReason: string | null;
  quote: (QuoteSnapshot & { source?: OptionQuoteSource }) | null;
  cacheAgeMs: number | null;
};

export type OptionQuoteDemandState = {
  underlying: string | null;
  states: OptionQuoteDemandQuoteState[];
  diagnostics: ReturnType<typeof getOptionQuoteDemandDiagnostics>;
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
    releaseOptionQuoteDemand(demand.owner, "ttl_expired");
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
}): { status: OptionQuoteDemandStatus; reason: string } {
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
  if (
    demandUnavailableReason === "ibkr_bridge_not_configured" ||
    demandUnavailableReason === "ibkr_bridge_runtime_unattached"
  ) {
    return { status: "unavailable", reason: demandUnavailableReason };
  }

  if (demandIncludesProviderContractId(input.ownerDemand, input.providerContractId)) {
    return {
      status: "rejected",
      reason: demandUnavailableReason ?? "not_admitted",
    };
  }

  const streamDiagnostics = getMassiveOptionQuoteStreamDiagnostics();
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

function resolveQuoteFreshnessState(
  quote: QuoteSnapshot & { source?: OptionQuoteSource },
): { status: OptionQuoteDemandStatus; reason: string | null } {
  const freshness = String(quote.freshness ?? "").trim();
  if (freshness === "unavailable") {
    return { status: "unavailable", reason: "quote_unavailable" };
  }
  if (freshness === "pending" || freshness === "metadata") {
    return { status: "pending", reason: "quote_pending" };
  }
  if (freshness === "stale") {
    return { status: "stale", reason: "stale_quote" };
  }
  return { status: "live", reason: null };
}

function resolveGreeksState(input: {
  quote: QuoteSnapshot & { source?: OptionQuoteSource };
  requiresGreeks: boolean;
}): { status: OptionQuoteDemandStatus; reason: string | null } {
  const quoteState = resolveQuoteFreshnessState(input.quote);
  if (quoteHasAnyGreek(input.quote)) {
    return quoteState;
  }
  if (quoteState.status === "stale") {
    return { status: "stale", reason: "stale_greeks" };
  }
  if (quoteState.status === "unavailable") {
    return { status: "unavailable", reason: "greeks_unavailable" };
  }
  if (input.requiresGreeks) {
    return { status: "pending", reason: "awaiting_greeks" };
  }
  return { status: "unavailable", reason: "greeks_not_requested" };
}

function resolveQuoteState(input: {
  quote: QuoteSnapshot & { source?: OptionQuoteSource };
  requiresGreeks: boolean;
}): {
  status: OptionQuoteDemandStatus;
  reason: string | null;
  quoteStatus: OptionQuoteDemandStatus;
  quoteReason: string | null;
  greeksStatus: OptionQuoteDemandStatus;
  greeksReason: string | null;
} {
  const quoteState = resolveQuoteFreshnessState(input.quote);
  const greeksState = resolveGreeksState(input);
  const incompleteGreeks =
    input.requiresGreeks &&
    (greeksState.status === "pending" ||
      greeksState.status === "stale" ||
      greeksState.status === "unavailable");
  const overallState = incompleteGreeks ? greeksState : quoteState;
  return {
    status: overallState.status,
    reason: overallState.reason,
    quoteStatus: quoteState.status,
    quoteReason: quoteState.reason,
    greeksStatus: greeksState.status,
    greeksReason: greeksState.reason,
  };
}

export function declareOptionQuoteDemand(input: OptionQuoteDemandDeclaration): void {
  const owner = normalizeOwner(input.owner);
  if (!owner) {
    return;
  }
  const providerContractIds = normalizeProviderContractIds(input.providerContractIds);
  if (!providerContractIds.length) {
    releaseOptionQuoteDemand(owner, "empty_demand");
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
    releaseOptionQuoteDemand(owner, "replaced");
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
  demand.unsubscribe = subscribeMassiveOptionQuoteSnapshots(
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

export function subscribeOptionQuoteDemand(
  input: OptionQuoteDemandDeclaration,
  onSnapshot: (payload: OptionQuoteSnapshotPayload) => void,
): () => void {
  declareOptionQuoteDemand({ ...input, onSnapshot });
  return () => releaseOptionQuoteDemand(input.owner, "unsubscribe");
}

export function releaseOptionQuoteDemand(owner: string, _reason = "released"): void {
  const normalizedOwner = normalizeOwner(owner);
  const demand = activeDemands.get(normalizedOwner);
  if (!demand) {
    return;
  }
  activeDemands.delete(normalizedOwner);
  clearDemandTimer(demand);
  demand.unsubscribe();
}

export function readOptionQuoteDemandState(
  input: OptionQuoteDemandReadInput,
): OptionQuoteDemandState {
  const providerContractIds = normalizeProviderContractIds(input.providerContractIds);
  const underlying = normalizeUnderlying(input.underlying);
  const owner = input.owner ? normalizeOwner(input.owner) : null;
  const ownerDemand = owner ? activeDemands.get(owner) : undefined;
  const requiresGreeks = input.requiresGreeks ?? ownerDemand?.requiresGreeks ?? true;
  const quotesByProviderContractId = new Map(
    getCurrentMassiveOptionQuoteSnapshots({
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
          quoteStatus: state.quoteStatus,
          quoteReason: state.quoteReason,
          greeksStatus: state.greeksStatus,
          greeksReason: state.greeksReason,
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
        quoteStatus: missing.status,
        quoteReason: missing.reason,
        greeksStatus: missing.status,
        greeksReason: missing.reason,
        quote: null,
        cacheAgeMs: null,
      };
    }),
    diagnostics: getOptionQuoteDemandDiagnostics(),
  };
}

export function getOptionQuoteDemandDiagnostics() {
  const stream = getMassiveOptionQuoteStreamDiagnostics();
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
    desiredProviderContractIds: stream.desiredProviderContractIds,
    subscribedProviderContractIdCount: stream.unionProviderContractIdCount,
    cachedQuoteCount: stream.cachedQuoteCount,
    streamPressure: stream.pressure,
    streamStatus: stream.lastStreamStatus,
    admissionIntentUsage: admission.intentUsage,
    admissionPoolUsage: admission.poolUsage,
    leaseCount: admission.leaseCount,
  };
}

export function __resetOptionQuoteDemandCoordinatorForTests(): void {
  Array.from(activeDemands.keys()).forEach((owner) => {
    releaseOptionQuoteDemand(owner, "test_reset");
  });
  activeDemands.clear();
}

export {
  declareOptionQuoteDemand as declareIbkrLiveDemand,
  readOptionQuoteDemandState as readIbkrLiveDemandState,
  releaseOptionQuoteDemand as releaseIbkrLiveDemand,
  subscribeOptionQuoteDemand as subscribeIbkrLiveDemand,
};

export type {
  OptionQuoteDemandDeclaration as IbkrLiveDemandDeclaration,
  OptionQuoteDemandQuoteState as IbkrLiveDemandQuoteState,
  OptionQuoteDemandReadInput as IbkrLiveDemandReadInput,
  OptionQuoteDemandState as IbkrLiveDemandState,
  OptionQuoteDemandStatus as IbkrLiveDemandStatus,
};
