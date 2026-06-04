import { buildFailurePoint } from "./failurePointModel.js";

const SEVERITY_RANK = {
  info: 0,
  warning: 1,
  attention: 1,
  degraded: 1,
  critical: 2,
  error: 2,
};

const ERROR_STATUSES = new Set(["error", "failed", "fail", "blocked", "down"]);
const LOADING_STATUSES = new Set([
  "loading",
  "pending",
  "queued",
  "refreshing",
  "scanning",
  "starting",
  "connecting",
]);
const UNAVAILABLE_STATUSES = new Set([
  "unavailable",
  "empty",
  "missing",
  "not_configured",
  "unconfigured",
]);
const STALE_STATUSES = new Set(["stale", "stale_cache", "runtime-cache"]);
const DELAYED_MODES = new Set(["delayed", "frozen", "delayed_frozen"]);
const METADATA_ONLY_MODES = new Set(["metadata", "metadata_only"]);
const FALLBACK_TOKENS = ["fallback", "cache", "runtime-cache"];
const QUIET_REASON_PATTERN =
  /market[-_\s]?session[-_\s]?quiet|market closed|no subscribers|outside.*session/i;

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const cleanText = (value) => {
  const text = String(value ?? "").trim();
  return text || null;
};

const normalizeToken = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

const labelText = (value, fallback = "Data") => cleanText(value) || fallback;

const lowerFirst = (value) => {
  const text = labelText(value);
  return text.charAt(0).toLowerCase() + text.slice(1);
};

const metric = (label, value) => {
  const cleaned = cleanText(value);
  return cleaned ? [label, cleaned] : null;
};

const compactMetrics = (rows) => rows.filter(Boolean);

const includesAnyToken = (value, tokens) => {
  const normalized = normalizeToken(value);
  return Boolean(normalized && tokens.some((token) => normalized.includes(token)));
};

const reasonLooksQuiet = (...values) =>
  values.some((value) => QUIET_REASON_PATTERN.test(String(value || "")));

const normalizeSeverity = (severity) => {
  const normalized = normalizeToken(severity);
  if (normalized === "critical" || normalized === "error" || normalized === "down") {
    return "critical";
  }
  if (normalized === "warning" || normalized === "attention" || normalized === "degraded") {
    return "warning";
  }
  return "info";
};

const issueKey = (issue) =>
  [
    normalizeToken(issue?.title),
    normalizeToken(issue?.reason),
    normalizeToken(issue?.source),
  ].join(":");

export const sortDataIssues = (issues = []) =>
  [...(Array.isArray(issues) ? issues : [])].sort((left, right) => {
    const leftRank = SEVERITY_RANK[normalizeSeverity(left?.severity)] ?? 0;
    const rightRank = SEVERITY_RANK[normalizeSeverity(right?.severity)] ?? 0;
    return rightRank - leftRank;
  });

export const getPrimaryDataIssue = (issues = []) => sortDataIssues(issues)[0] || null;

export const buildDataIssue = ({
  severity = "warning",
  title,
  summary,
  source = "backend",
  reason,
  observedAt,
  metrics = [],
  topCauses = [],
  nextAction,
} = {}) =>
  buildFailurePoint({
    severity: normalizeSeverity(severity),
    title,
    summary,
    source,
    reason,
    observedAt,
    metrics,
    topCauses,
    nextAction:
      nextAction ||
      "Use this value with caution and check the related data source before acting on it.",
  });

const pushIssue = (issues, seen, issue) => {
  if (!issue) return;
  const key = issueKey(issue);
  if (seen.has(key)) return;
  seen.add(key);
  issues.push(issue);
};

export const collectDataIssuesFromRecord = (recordValue, options = {}) => {
  const record = asRecord(recordValue);
  if (!Object.keys(record).length) return [];

  const valueLabel = labelText(options.valueLabel || options.label || record.label, "Data");
  const source = labelText(options.source || record.provider || record.source, "backend");
  const observedAt =
    options.observedAt ||
    record.observedAt ||
    record.updatedAt ||
    record.dataUpdatedAt ||
    record.quoteUpdatedAt ||
    record.lastEvaluatedAt ||
    record.fetchedAt ||
    null;
  const nextAction = options.nextAction;
  const status = normalizeToken(record.status);
  const sourceStatus = normalizeToken(record.sourceStatus || record.providerStatus);
  const freshness = normalizeToken(record.freshness || record.quoteFreshness);
  const marketDataMode = normalizeToken(record.marketDataMode || record.mode);
  const cacheStatus = normalizeToken(record.cacheStatus);
  const errorText = cleanText(record.errorMessage || record.lastError || record.error);
  const unavailableDetail = cleanText(record.unavailableDetail || record.detail);
  const reason =
    record.reason ||
    record.degradedReason ||
    record.unavailableCode ||
    record.emptyReason ||
    record.code ||
    unavailableDetail ||
    errorText;
  const quiet = reasonLooksQuiet(reason, errorText, record.reason, record.degradedReason);
  const pendingOnly =
    LOADING_STATUSES.has(status) &&
    !errorText &&
    !record.stale &&
    !record.fallbackUsed &&
    !record.unavailableCode;

  if (pendingOnly || quiet) return [];

  const issues = [];
  const seen = new Set();
  const baseMetrics = compactMetrics([
    metric("Status", status || sourceStatus),
    metric("Freshness", freshness),
    metric("Mode", marketDataMode),
    metric("Cache", cacheStatus),
    metric("Updated", observedAt),
  ]);
  const build = (patch) =>
    buildDataIssue({
      source,
      observedAt,
      metrics: baseMetrics,
      nextAction,
      ...patch,
    });

  if (errorText || ERROR_STATUSES.has(status) || ERROR_STATUSES.has(sourceStatus)) {
    pushIssue(
      issues,
      seen,
      build({
        severity: "critical",
        title: `${valueLabel} unavailable`,
        summary: errorText || `${valueLabel} failed in the backend.`,
        reason: reason || status || sourceStatus || "error",
        topCauses: [errorText, reason].filter(Boolean),
      }),
    );
  }

  if (
    record.unavailableCode ||
    UNAVAILABLE_STATUSES.has(status) ||
    UNAVAILABLE_STATUSES.has(sourceStatus) ||
    freshness === "unavailable"
  ) {
    pushIssue(
      issues,
      seen,
      build({
        severity: errorText ? "critical" : "warning",
        title: `${valueLabel} unavailable`,
        summary:
          unavailableDetail ||
          errorText ||
          `${valueLabel} is missing from the backend response.`,
        reason: reason || record.unavailableCode || status || freshness || "unavailable",
        topCauses: [unavailableDetail, errorText, record.unavailableCode].filter(Boolean),
      }),
    );
  }

  if (
    record.stale === true ||
    record.cacheStale === true ||
    STALE_STATUSES.has(status) ||
    STALE_STATUSES.has(sourceStatus) ||
    STALE_STATUSES.has(freshness) ||
    STALE_STATUSES.has(cacheStatus)
  ) {
    pushIssue(
      issues,
      seen,
      build({
        severity: "warning",
        title: `Stale ${lowerFirst(valueLabel)}`,
        summary: `${valueLabel} is from an older backend snapshot.`,
        reason: reason || freshness || cacheStatus || status || "stale",
      }),
    );
  }

  if (DELAYED_MODES.has(freshness) || DELAYED_MODES.has(marketDataMode) || record.delayed === true) {
    pushIssue(
      issues,
      seen,
      build({
        severity: "warning",
        title: `Delayed ${lowerFirst(valueLabel)}`,
        summary: `${valueLabel} is delayed or frozen, not a live value.`,
        reason: reason || marketDataMode || freshness || "delayed",
      }),
    );
  }

  if (METADATA_ONLY_MODES.has(freshness) || METADATA_ONLY_MODES.has(marketDataMode)) {
    pushIssue(
      issues,
      seen,
      build({
        severity: "warning",
        title: `${valueLabel} is metadata only`,
        summary: `${valueLabel} does not include a live price or complete market-data fields.`,
        reason: reason || marketDataMode || freshness || "metadata",
      }),
    );
  }

  if (
    record.fallbackUsed === true ||
    status === "fallback" ||
    includesAnyToken(record.dataSource, FALLBACK_TOKENS) ||
    includesAnyToken(record.resolutionSource, FALLBACK_TOKENS) ||
    includesAnyToken(record.source, ["fallback"]) ||
    cacheStatus === "runtime-cache"
  ) {
    pushIssue(
      issues,
      seen,
      build({
        severity: "warning",
        title: `${valueLabel} using fallback data`,
        summary: `${valueLabel} is being filled from fallback or cached data.`,
        reason: reason || record.dataSource || record.resolutionSource || cacheStatus || "fallback",
      }),
    );
  }

  if (
    status === "degraded" ||
    sourceStatus === "degraded" ||
    record.degraded === true ||
    record.coverageHealth === "lagging"
  ) {
    pushIssue(
      issues,
      seen,
      build({
        severity: "warning",
        title: `${valueLabel} degraded`,
        summary: record.degradedReason || `${valueLabel} is available but degraded.`,
        reason: reason || "degraded",
      }),
    );
  }

  return sortDataIssues(issues);
};

export const collectCoverageDataIssues = (coverageValue, options = {}) => {
  const coverage = asRecord(coverageValue);
  if (!Object.keys(coverage).length) return [];
  if (reasonLooksQuiet(coverage.reason, coverage.degradedReason)) return [];

  const valueLabel = labelText(options.valueLabel || coverage.label, "Coverage");
  const source = labelText(options.source || coverage.source || coverage.provider, "backend");
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.95;
  const numerator = Number(
    coverage.loadedCount ??
      coverage.scannedSymbols ??
      coverage.cycleScannedSymbols ??
      coverage.usableCount ??
      coverage.withGamma ??
      coverage.current,
  );
  const denominator = Number(
    coverage.returnedCount ??
      coverage.activeTargetSize ??
      coverage.selectedSymbols ??
      coverage.targetSize ??
      coverage.totalSymbols ??
      coverage.usable ??
      coverage.total,
  );
  const ratio = Number.isFinite(coverage.ratio)
    ? Number(coverage.ratio)
    : Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator
      : null;
  const mode = normalizeToken(coverage.coverage || coverage.mode || coverage.coverageMode);
  const health = normalizeToken(coverage.coverageHealth || coverage.health || coverage.status);
  const partialMode = mode && !["full", "live", "complete", "ok"].includes(mode);
  const partialRatio = ratio != null && ratio < threshold;
  const lagging = health === "lagging" || health === "degraded";

  if (!partialMode && !partialRatio && !lagging && coverage.stale !== true) {
    return [];
  }

  return [
    buildDataIssue({
      severity: "warning",
      title: `${valueLabel} is partial`,
      summary:
        coverage.degradedReason ||
        coverage.detail ||
        `${valueLabel} is incomplete, so this view is rendering from the available backend fields.`,
      source,
      reason: coverage.degradedReason || coverage.reason || health || mode || "partial_coverage",
      observedAt: coverage.updatedAt || coverage.scannedAt || coverage.newestScanAt,
      metrics: compactMetrics([
        metric("Loaded", Number.isFinite(numerator) && Number.isFinite(denominator) ? `${numerator}/${denominator}` : null),
        metric("Ratio", ratio != null ? `${Math.round(ratio * 100)}%` : null),
        metric("Health", health),
        metric("Mode", mode),
      ]),
      topCauses: [coverage.degradedReason, coverage.reason, coverage.detail].filter(Boolean),
      nextAction:
        options.nextAction ||
        "Treat the affected values as partial until the backend coverage returns to full.",
    }),
  ];
};

export const collectQuoteDataIssues = (record, options = {}) =>
  collectDataIssuesFromRecord(record, {
    valueLabel: "Quote",
    source: "market data",
    ...options,
  });

export const collectChartSourceDataIssues = (sourceState, options = {}) => {
  const record = asRecord(sourceState);
  return collectDataIssuesFromRecord(
    {
      ...record,
      status:
        record.state ||
        record.status ||
        (record.isDegraded ? "degraded" : record.isFallback ? "fallback" : undefined),
      freshness: record.freshness,
      marketDataMode: record.marketDataMode,
      stale: record.isStale === true || record.stale === true,
      delayed: record.isDelayed === true || record.delayed === true,
      fallbackUsed: record.isFallback === true || record.fallbackUsed === true,
      degraded: record.isDegraded === true || record.degraded === true,
      reason: record.detail || record.reason,
    },
    {
      valueLabel: "Chart data",
      source: "chart data",
      ...options,
    },
  );
};

export const combineDataIssues = (...issueGroups) =>
  sortDataIssues(issueGroups.flat().filter(Boolean));
