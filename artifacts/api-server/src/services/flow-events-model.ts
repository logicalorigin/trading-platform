import type { FlowUniverseCoverage } from "./flow-universe";

export type FlowDataProvider = "ibkr" | "polygon";
export type FlowSourceProvider = FlowDataProvider | "none";
export type FlowSourceStatus = "live" | "fallback" | "empty" | "error";

export type FlowEventsSource = {
  provider: FlowSourceProvider;
  status: FlowSourceStatus;
  fallbackUsed: boolean;
  attemptedProviders: FlowDataProvider[];
  errorMessage: string | null;
  fetchedAt: Date;
  unusualThreshold: number;
  ibkrStatus?: "loaded" | "empty" | "degraded" | "error";
  ibkrReason?: string | null;
  ibkrExpirationCount?: number;
  ibkrHydratedExpirationCount?: number;
  ibkrContractCount?: number;
  ibkrQualifiedContractCount?: number;
  ibkrCandidateExpirationCount?: number;
  ibkrMetadataContractCount?: number;
  ibkrLiveCandidateCount?: number;
  ibkrAcceptedQuoteCount?: number;
  ibkrRejectedQuoteCount?: number;
  ibkrReturnedQuoteCount?: number;
  ibkrMissingQuoteCount?: number;
  ibkrFilteredEventCount?: number;
  scannerCoverage?: FlowUniverseCoverage;
};

export type FlowEventsResult = {
  events: unknown[];
  source: FlowEventsSource;
};

export type FlowEventsScope = "all" | "unusual";

export type FlowEventsFilters = {
  scope: FlowEventsScope;
  minPremium: number;
  maxDte: number | null;
};

export type FlowSourceInput = {
  provider: FlowSourceProvider;
  status: FlowSourceStatus;
  fallbackUsed?: boolean;
  attemptedProviders?: FlowDataProvider[];
  errorMessage?: string | null;
  unusualThreshold?: number;
  ibkrStatus?: FlowEventsSource["ibkrStatus"];
  ibkrReason?: string | null;
  ibkrExpirationCount?: number;
  ibkrHydratedExpirationCount?: number;
  ibkrContractCount?: number;
  ibkrQualifiedContractCount?: number;
  ibkrCandidateExpirationCount?: number;
  ibkrMetadataContractCount?: number;
  ibkrLiveCandidateCount?: number;
  ibkrAcceptedQuoteCount?: number;
  ibkrRejectedQuoteCount?: number;
  ibkrReturnedQuoteCount?: number;
  ibkrMissingQuoteCount?: number;
  ibkrFilteredEventCount?: number;
  scannerCoverage?: FlowUniverseCoverage;
};

export type DeferredFlowEventsResultInput = {
  underlying: string;
  filters: FlowEventsFilters;
  limit: number;
  unusualThreshold?: number;
  reason: string;
  scannerCoverage?: FlowUniverseCoverage;
};

export function normalizeFlowEventsScope(value: unknown): FlowEventsScope {
  return value === "unusual" ? "unusual" : "all";
}

export function normalizeFlowEventsFilters(input: {
  scope?: unknown;
  minPremium?: unknown;
  maxDte?: unknown;
}): FlowEventsFilters {
  const minPremium =
    Number.isFinite(Number(input.minPremium)) && Number(input.minPremium) > 0
      ? Math.min(50_000_000, Math.max(0, Number(input.minPremium)))
      : 0;
  const maxDte =
    input.maxDte === undefined || input.maxDte === null || input.maxDte === ""
      ? null
      : Number.isFinite(Number(input.maxDte))
        ? Math.min(730, Math.max(0, Math.round(Number(input.maxDte))))
        : null;

  return {
    scope: normalizeFlowEventsScope(input.scope),
    minPremium,
    maxDte,
  };
}

export function getExpirationDte(
  expirationDate: Date,
  now = new Date(),
): number | null {
  if (
    !(expirationDate instanceof Date) ||
    Number.isNaN(expirationDate.getTime())
  ) {
    return null;
  }
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const expirationUtc = Date.UTC(
    expirationDate.getUTCFullYear(),
    expirationDate.getUTCMonth(),
    expirationDate.getUTCDate(),
  );
  return Math.max(0, Math.ceil((expirationUtc - todayUtc) / 86_400_000));
}

export function flowEventMatchesFilters(
  event: unknown,
  filters: FlowEventsFilters,
  unusualThreshold: number | undefined,
): boolean {
  const row = event as {
    isUnusual?: unknown;
    unusualScore?: unknown;
    premium?: unknown;
    expirationDate?: unknown;
    side?: unknown;
  };
  const premium = Number(row.premium ?? 0);
  const expirationDate =
    row.expirationDate instanceof Date
      ? row.expirationDate
      : new Date(String(row.expirationDate ?? ""));
  const dte = getExpirationDte(expirationDate);
  const side = String(row.side ?? "").toLowerCase();
  const matchesUnusualScope =
    Boolean(row.isUnusual) ||
    Number(row.unusualScore) >= (unusualThreshold ?? 1) ||
    premium >= 250_000 ||
    (side === "buy" && premium >= 100_000) ||
    (dte !== null && dte <= 1 && premium >= 50_000);
  if (filters.scope === "unusual" && !matchesUnusualScope) {
    return false;
  }
  if (filters.minPremium > 0 && premium < filters.minPremium) {
    return false;
  }
  if (filters.maxDte !== null) {
    if (dte === null || dte > filters.maxDte) {
      return false;
    }
  }
  return true;
}

export function filterFlowEventsForRequest(
  events: unknown[],
  filters: FlowEventsFilters,
  unusualThreshold: number | undefined,
  limit: number,
): unknown[] {
  return (events || [])
    .filter((event) => flowEventMatchesFilters(event, filters, unusualThreshold))
    .slice(0, limit);
}

export function flowEventsFilterCacheKey(filters: FlowEventsFilters): string {
  return [
    filters.scope,
    filters.minPremium || 0,
    filters.maxDte ?? "any",
  ].join(":");
}

export function hasNarrowFlowFilters(filters: FlowEventsFilters): boolean {
  return filters.scope !== "all" || filters.minPremium > 0 || filters.maxDte !== null;
}

export function flowEventsSourceUsesPolygonFallback(source: unknown): boolean {
  const candidate = source as Partial<FlowEventsSource> | null | undefined;
  return candidate?.provider === "polygon" || candidate?.fallbackUsed === true;
}

const TRANSIENT_EMPTY_FLOW_SOURCE_PATTERNS = [
  "backoff",
  "degraded",
  "error",
  "line_budget",
  "queued",
  "refreshing",
  "saturated",
  "unavailable",
];

export function isTransientEmptyFlowSource(source: unknown): boolean {
  const candidate = source as Partial<FlowEventsSource> | null | undefined;
  if (!candidate) {
    return false;
  }

  const status = String(candidate.status || "").toLowerCase();
  const provider = String(candidate.provider || "").toLowerCase();
  const ibkrStatus = String(candidate.ibkrStatus || "").toLowerCase();
  const ibkrReason = String(candidate.ibkrReason || "").toLowerCase();

  if (status === "error" || Boolean(candidate.errorMessage)) {
    return true;
  }
  if (ibkrStatus === "degraded" || ibkrStatus === "error") {
    return true;
  }
  if (
    TRANSIENT_EMPTY_FLOW_SOURCE_PATTERNS.some((pattern) =>
      ibkrReason.includes(pattern),
    )
  ) {
    return true;
  }

  return status === "empty" && provider !== "ibkr" && ibkrStatus !== "loaded";
}

export function shouldPreserveCachedFlowEvents(
  cached: { value: FlowEventsResult; staleExpiresAt: number } | undefined,
  next: FlowEventsResult,
  currentMs: number,
): boolean {
  return Boolean(
    cached &&
      cached.value.events.length > 0 &&
      cached.staleExpiresAt > currentMs &&
      next.events.length === 0 &&
      isTransientEmptyFlowSource(next.source),
  );
}

export function isCacheableFlowEventsResult(value: FlowEventsResult): boolean {
  return value.events.length > 0 || !isTransientEmptyFlowSource(value.source);
}

export function isFlowScannerSnapshotAllowedForFallbackPolicy(
  snapshot: { source?: unknown } | null,
  allowPolygonFallback: boolean,
): boolean {
  return Boolean(
    snapshot &&
      (allowPolygonFallback ||
        !flowEventsSourceUsesPolygonFallback(snapshot.source)),
  );
}

export function flowSource(input: FlowSourceInput): FlowEventsSource {
  return {
    provider: input.provider,
    status: input.status,
    fallbackUsed: Boolean(input.fallbackUsed),
    attemptedProviders: input.attemptedProviders ?? [],
    errorMessage: input.errorMessage ?? null,
    fetchedAt: new Date(),
    unusualThreshold:
      Number.isFinite(input.unusualThreshold) &&
      (input.unusualThreshold as number) > 0
        ? (input.unusualThreshold as number)
        : 1,
    ibkrStatus: input.ibkrStatus,
    ibkrReason: input.ibkrReason,
    ibkrExpirationCount: input.ibkrExpirationCount,
    ibkrHydratedExpirationCount: input.ibkrHydratedExpirationCount,
    ibkrContractCount: input.ibkrContractCount,
    ibkrQualifiedContractCount: input.ibkrQualifiedContractCount,
    ibkrCandidateExpirationCount: input.ibkrCandidateExpirationCount,
    ibkrMetadataContractCount: input.ibkrMetadataContractCount,
    ibkrLiveCandidateCount: input.ibkrLiveCandidateCount,
    ibkrAcceptedQuoteCount: input.ibkrAcceptedQuoteCount,
    ibkrRejectedQuoteCount: input.ibkrRejectedQuoteCount,
    ibkrReturnedQuoteCount: input.ibkrReturnedQuoteCount,
    ibkrMissingQuoteCount: input.ibkrMissingQuoteCount,
    ibkrFilteredEventCount: input.ibkrFilteredEventCount,
    scannerCoverage: input.scannerCoverage,
  };
}

export function deferredFlowEventsResult(
  input: DeferredFlowEventsResultInput,
): FlowEventsResult {
  return {
    events: [],
    source: flowSource({
      provider: "ibkr",
      status: "empty",
      attemptedProviders: ["ibkr"],
      unusualThreshold: input.unusualThreshold ?? 1,
      ibkrStatus: "empty",
      ibkrReason: input.reason,
      ibkrExpirationCount: 0,
      ibkrHydratedExpirationCount: 0,
      ibkrContractCount: 0,
      ibkrQualifiedContractCount: 0,
      scannerCoverage: input.scannerCoverage,
    }),
  };
}
