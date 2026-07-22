const TRANSIENT_EMPTY_FLOW_SOURCE_PATTERNS = [
  "backoff",
  "degraded",
  "error",
  "failed",
  "line_budget",
  "market-session-quiet",
  "market_session_quiet",
  "queued",
  "quote_hydration",
  "refreshing",
  "saturated",
  "timed out",
  "timeout",
  "unavailable",
];

const PENDING_EMPTY_FLOW_SOURCE_PATTERNS = ["queued", "refreshing"];
const SCANNER_PENDING_EMPTY_FLOW_SOURCE_PATTERNS = [
  "market-session-quiet",
  "market_session_quiet",
  "no_cached_events",
  "option_activity_unavailable",
  "no cached",
  "snapshot_pending",
  "snapshot pending",
];
const VISIBLE_FLOW_DEGRADATION_MAX_AGE_MS = 120_000;

const parseTimestampMs = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "string" && value.trim()) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  return null;
};

export const resolveFlowSourceScannedAt = (
  source,
  receivedAtMs = Date.now(),
) => {
  const normalizedReceivedAt = parseTimestampMs(receivedAtMs) ?? Date.now();
  const fetchedAtMs = parseTimestampMs(source?.fetchedAt);
  return fetchedAtMs !== null && fetchedAtMs <= normalizedReceivedAt
    ? fetchedAtMs
    : normalizedReceivedAt;
};

const isRecentForVisibleDegradation = (
  value,
  {
    nowMs = Date.now(),
    maxAgeMs = VISIBLE_FLOW_DEGRADATION_MAX_AGE_MS,
  } = {},
) => {
  const timestampMs = parseTimestampMs(
    value?.errorAt ||
      value?.fetchedAt ||
      value?.scannedAt ||
      value?.updatedAt ||
      value?.at,
  );
  if (timestampMs === null) {
    return true;
  }
  const ageMs = nowMs - timestampMs;
  return ageMs >= 0 && ageMs <= maxAgeMs;
};

export const flowReasonLooksTransient = (reason) => {
  const normalized = String(reason || "").toLowerCase();
  return Boolean(
    normalized &&
      TRANSIENT_EMPTY_FLOW_SOURCE_PATTERNS.some((pattern) =>
        normalized.includes(pattern),
      ),
  );
};

export const flowReasonLooksPending = (reason) => {
  const normalized = String(reason || "").toLowerCase();
  return Boolean(
    normalized &&
      [...PENDING_EMPTY_FLOW_SOURCE_PATTERNS, ...SCANNER_PENDING_EMPTY_FLOW_SOURCE_PATTERNS]
        .some((pattern) => normalized.includes(pattern)),
  );
};

export const flowReasonLooksMarketSessionQuiet = (reason) =>
  /market[-_]session[-_]quiet/i.test(String(reason || ""));

export const isTransientEmptyFlowSource = (source) => {
  if (!source || typeof source !== "object") {
    return false;
  }

  const status = String(source.status || "").toLowerCase();
  const provider = String(source.provider || "").toLowerCase();
  const ibkrStatus = String(source.ibkrStatus || "").toLowerCase();
  const ibkrReason = String(source.ibkrReason || "").toLowerCase();

  if (status === "error" || Boolean(source.errorMessage)) {
    return true;
  }
  if (ibkrStatus === "degraded" || ibkrStatus === "error") {
    return true;
  }
  if (flowReasonLooksTransient(ibkrReason)) {
    return true;
  }

  return status === "empty" && provider !== "ibkr" && ibkrStatus !== "loaded";
};

const sourceReason = (source) =>
  source?.ibkrReason || source?.errorMessage || source?.reason || "";

export const providerSummaryHasMarketSessionQuiet = (providerSummary) =>
  Boolean(
    flowReasonLooksMarketSessionQuiet(providerSummary?.coverage?.degradedReason) ||
      Object.values(providerSummary?.sourcesBySymbol || {}).some((source) =>
        flowReasonLooksMarketSessionQuiet(sourceReason(source)),
      ),
  );

export const isVisibleFlowDegradationSource = (source, options) => {
  if (!source || typeof source !== "object") {
    return false;
  }

  const reason = sourceReason(source);
  if (flowReasonLooksPending(reason)) {
    return false;
  }
  if (!isRecentForVisibleDegradation(source, options)) {
    return false;
  }

  const status = String(source.status || "").toLowerCase();
  const provider = String(source.provider || "").toLowerCase();
  const ibkrStatus = String(source.ibkrStatus || "").toLowerCase();

  if (status === "error" || Boolean(source.errorMessage)) {
    return true;
  }
  if (ibkrStatus === "degraded" || ibkrStatus === "error") {
    return true;
  }
  if (flowReasonLooksTransient(reason)) {
    return true;
  }

  return status === "empty" && provider !== "ibkr" && ibkrStatus !== "loaded";
};

export const flowFailureLooksVisible = (failure, options) =>
  Boolean(failure && isRecentForVisibleDegradation(failure, options));

export const buildAggregateFlowResponse = ({
  snapshot = null,
  error = null,
  errorAt = null,
} = {}) => {
  const errorMessage =
    typeof error === "string"
      ? error
      : typeof error?.message === "string"
        ? error.message
        : error
          ? "Flow request failed"
          : null;
  if (!snapshot && !errorMessage) {
    return null;
  }

  return {
    symbol: "__aggregate",
    events: snapshot?.events || [],
    source: snapshot?.source || null,
    scannedAt: snapshot?.scannedAt || null,
    staleFlowEvents: Boolean(snapshot?.staleFlowEvents),
    error: errorMessage,
    errorAt: errorMessage ? errorAt : null,
  };
};

export const providerSummaryHasTransientFlowState = (providerSummary) => {
  if (!providerSummary || typeof providerSummary !== "object") {
    return false;
  }

  if (providerSummary.erroredSource || providerSummary.errorMessage) {
    return true;
  }
  if (Array.isArray(providerSummary.failures) && providerSummary.failures.length > 0) {
    return true;
  }
  if (flowReasonLooksTransient(providerSummary.coverage?.degradedReason)) {
    return true;
  }

  return Object.values(providerSummary.sourcesBySymbol || {}).some((source) =>
    isTransientEmptyFlowSource(source),
  );
};

export const providerSummaryHasVisibleFlowDegradation = (
  providerSummary,
  options,
) => {
  if (!providerSummary || typeof providerSummary !== "object") {
    return false;
  }

  if (
    providerSummary.erroredSource &&
    isVisibleFlowDegradationSource(providerSummary.erroredSource, options)
  ) {
    return true;
  }
  if (providerSummary.errorMessage) {
    return true;
  }
  if (
    Array.isArray(providerSummary.failures) &&
    providerSummary.failures.some((failure) =>
      flowFailureLooksVisible(failure, options),
    )
  ) {
    return true;
  }

  const degradedReason = providerSummary.coverage?.degradedReason;
  if (
    flowReasonLooksTransient(degradedReason) &&
    !flowReasonLooksPending(degradedReason)
  ) {
    return true;
  }

  return Object.values(providerSummary.sourcesBySymbol || {}).some((source) =>
    isVisibleFlowDegradationSource(source, options),
  );
};

export const shouldPreserveFlowEvents = (existing, next) =>
  Boolean(
    existing?.events?.length &&
      !next?.events?.length &&
      isTransientEmptyFlowSource(next?.source),
  );

export const mergeFlowEventsSnapshot = (existing, next) =>
  shouldPreserveFlowEvents(existing, next)
    ? {
        ...existing,
        source: next?.source || null,
        error: next?.error || null,
        errorAt: next?.errorAt || null,
        staleFlowEvents: true,
      }
    : next;
