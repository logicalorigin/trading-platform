const SOURCE_LABELS = {
  active_watchlist: "Active Watchlist Source",
  watchlist: "Active Watchlist Source",
  market: "Candidate Set",
  all_watchlists: "All Watchlist Sources",
  all_watchlists_plus_universe: "Watchlist Sources + Candidate Set",
};

const SCOPE_LABELS = {
  all: "All flow",
  unusual: "Unusual flow",
};

const safeCount = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

const formatCycleEstimate = (value) => {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms >= 60_000) return `~${Math.round(ms / 60_000)}m cycle`;
  return `~${Math.round(ms / 1_000)}s cycle`;
};

export const resolveFlowScannerSourceLabel = ({ coverageMode } = {}) =>
  SOURCE_LABELS[String(coverageMode || "").trim()] || "Active Watchlist Source";

const resolveScopeLabel = (scope) =>
  SCOPE_LABELS[String(scope || "").trim()] || SCOPE_LABELS.all;

export const resolveFlowScannerStatusDisplay = ({
  enabled = false,
  degraded = false,
  runtimeActive = false,
  loading = false,
  error = false,
} = {}) => {
  if (!enabled) {
    return { label: "Off", state: "off", active: false };
  }
  if (degraded) {
    return { label: "Degraded", state: "degraded", active: true };
  }
  if (runtimeActive) {
    return { label: "Scanning", state: "scanning", active: true };
  }
  if (loading) {
    return { label: "Syncing", state: "syncing", active: true };
  }
  if (error) {
    return { label: "Reconnecting", state: "reconnecting", active: false };
  }
  return { label: "Idle", state: "idle", active: false };
};

export const buildRecentScannerSymbols = (
  lastScannedAt = {},
  currentBatch = [],
  limit = 12,
) => {
  const active = new Set((currentBatch || []).map((symbol) => String(symbol)));
  return Object.entries(lastScannedAt || {})
    .filter(([symbol]) => !active.has(symbol))
    .map(([symbol, scannedAt]) => ({
      symbol,
      scannedAt: Number(scannedAt),
    }))
    .filter((entry) => Number.isFinite(entry.scannedAt))
    .sort((left, right) => right.scannedAt - left.scannedAt)
    .slice(0, safeCount(limit) || 12);
};

export const resolveFlowScannerProgress = ({
  coverage = {},
  scannerConfig = {},
  scannedCoverageSymbols = 0,
  totalCoverageSymbols = 0,
  intendedCoverageSymbols = totalCoverageSymbols,
  selectedCoverageSymbols = totalCoverageSymbols,
} = {}) => {
  const sourceModeLabel = resolveFlowScannerSourceLabel({
    coverageMode: coverage.mode,
  });
  const scopeLabel = resolveScopeLabel(coverage.scope);
  const scannedCount = safeCount(scannedCoverageSymbols);
  const totalCount = safeCount(totalCoverageSymbols || scannedCount);
  const queuedCount = Math.max(0, totalCount - scannedCount);
  const maxSymbols = safeCount(scannerConfig.maxSymbols);
  const batchSize = safeCount(coverage.batchSize ?? scannerConfig.batchSize);
  const concurrency =
    safeCount(coverage.concurrency ?? scannerConfig.concurrency ?? 1) || 1;
  const intendedCount = safeCount(intendedCoverageSymbols || totalCount);
  const selectedCount = safeCount(selectedCoverageSymbols || totalCount);
  const cycleEstimateLabel = formatCycleEstimate(coverage.estimatedCycleMs);

  const cycleLabel = `${scannedCount}/${totalCount}`;
  const queueLabel = queuedCount > 0 ? `${queuedCount} queued` : "queue clear";
  const limitLabel = `limit ${maxSymbols}`;
  const batchLabel = `${batchSize} batch / ${concurrency} conc`;
  const selectedDetail =
    intendedCount > selectedCount
      ? `selected ${selectedCount}/${intendedCount}`
      : coverage.isFetching
        ? batchLabel
        : cycleEstimateLabel || sourceModeLabel;

  return {
    sourceModeLabel,
    scopeLabel,
    cycleLabel,
    queueLabel,
    limitLabel,
    capLabel: limitLabel,
    batchLabel,
    cycleEstimateLabel,
    selectedDetail,
    progressText: `${sourceModeLabel} · ${scopeLabel} · ${cycleLabel} scanned · ${queueLabel} · ${limitLabel}`,
  };
};
