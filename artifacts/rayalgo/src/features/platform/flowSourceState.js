const TRANSIENT_EMPTY_FLOW_SOURCE_PATTERNS = [
  "backoff",
  "degraded",
  "error",
  "failed",
  "line_budget",
  "queued",
  "quote_hydration",
  "refreshing",
  "saturated",
  "timed out",
  "timeout",
  "unavailable",
];

const PENDING_EMPTY_FLOW_SOURCE_PATTERNS = ["queued", "refreshing"];
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

const isRecentForVisibleDegradation = (
  value,
  {
    nowMs = Date.now(),
    maxAgeMs = VISIBLE_FLOW_DEGRADATION_MAX_AGE_MS,
  } = {},
) => {
  const timestampMs = parseTimestampMs(
    value?.fetchedAt || value?.scannedAt || value?.updatedAt || value?.at,
  );
  if (timestampMs === null) {
    return true;
  }
  return nowMs - timestampMs <= maxAgeMs;
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
      PENDING_EMPTY_FLOW_SOURCE_PATTERNS.some((pattern) =>
        normalized.includes(pattern),
      ),
  );
};

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
