import { MISSING_VALUE } from "../../lib/uiTokens";

export const safeScannerCount = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;

export const formatScannerCount = (value) => {
  const count = safeScannerCount(value);
  return count == null ? MISSING_VALUE : count.toLocaleString();
};

export const buildRecentScannerSymbols = (
  lastScannedAt = {},
  currentBatch = [],
  limit = 12,
) => {
  const active = new Set(currentBatch);
  return Object.entries(lastScannedAt || {})
    .filter(([symbol]) => !active.has(symbol))
    .map(([symbol, scannedAt]) => ({
      symbol,
      scannedAt: Number(scannedAt),
    }))
    .filter((entry) => entry.symbol && Number.isFinite(entry.scannedAt))
    .sort((left, right) => right.scannedAt - left.scannedAt)
    .slice(0, limit);
};

export const resolveFlowScannerSourceLabel = ({
  coverageModeLabel,
  coverageMode,
  scannerMode,
} = {}) => {
  const mode = String(coverageMode || scannerMode || coverageModeLabel || "")
    .trim()
    .toLowerCase();
  if (mode === "all_watchlists_plus_universe") return "Watchlists + universe";
  if (mode === "all_watchlists") return "All watchlists";
  if (mode === "active_watchlist") return "Active watchlist";
  if (mode === "market" || mode === "hybrid" || mode === "market-wide") {
    return "Market-wide";
  }
  if (mode === "watchlist") return "Watchlist";
  return coverageModeLabel || "Watchlist";
};

export const resolveFlowScannerScopeLabel = (scope) => {
  const normalized = String(scope || "").trim().toLowerCase();
  if (normalized === "all") return "All flow";
  if (normalized === "unusual") return "Unusual flow";
  return normalized ? normalized : null;
};

export const resolveFlowScannerProgress = ({
  coverage = {},
  coverageModeLabel = "watchlist",
  scannerConfig = {},
  scannedCoverageSymbols = 0,
  totalCoverageSymbols = 0,
  intendedCoverageSymbols = 0,
  selectedCoverageSymbols = 0,
} = {}) => {
  const currentBatch = Array.isArray(coverage.currentBatch)
    ? coverage.currentBatch.filter(Boolean)
    : [];
  const recentSymbols = buildRecentScannerSymbols(
    coverage.lastScannedAt,
    currentBatch,
  );
  const scannedCount = safeScannerCount(scannedCoverageSymbols) ?? 0;
  const totalCount =
    safeScannerCount(totalCoverageSymbols) ??
    safeScannerCount(coverage.activeTargetSize) ??
    safeScannerCount(coverage.totalSymbols) ??
    scannedCount;
  const intendedCount =
    safeScannerCount(intendedCoverageSymbols) ??
    safeScannerCount(coverage.targetSize) ??
    totalCount;
  const selectedCount =
    safeScannerCount(selectedCoverageSymbols) ??
    safeScannerCount(coverage.selectedSymbols) ??
    totalCount;
  const capCount =
    safeScannerCount(scannerConfig.maxSymbols) ??
    safeScannerCount(coverage.targetSize) ??
    intendedCount;
  const batchCount =
    safeScannerCount(scannerConfig.batchSize) ??
    safeScannerCount(coverage.batchSize);
  const concurrencyCount =
    safeScannerCount(scannerConfig.concurrency) ??
    safeScannerCount(coverage.concurrency);
  const pendingBasis = totalCount || selectedCount || intendedCount || scannedCount;
  const coveredCount = Math.max(
    currentBatch.length + recentSymbols.length,
    scannedCount,
  );
  const pendingCount = Math.max(0, pendingBasis - coveredCount);
  const sourceModeLabel = resolveFlowScannerSourceLabel({
    coverageModeLabel,
    coverageMode: coverage.mode,
    scannerMode: scannerConfig.mode,
  });
  const scopeLabel = resolveFlowScannerScopeLabel(
    coverage.scope || scannerConfig.scope,
  );
  const cycleLabel = `${formatScannerCount(scannedCount)}/${formatScannerCount(
    totalCount || scannedCount,
  )}`;
  const queueLabel =
    pendingCount > 0
      ? `${formatScannerCount(pendingCount)} queued`
      : coverage.isFetching
        ? "batch in flight"
        : "queue clear";
  const capLabel =
    capCount == null ? "cap --" : `cap ${formatScannerCount(capCount)}`;
  const batchLabel =
    batchCount != null && concurrencyCount != null
      ? `${formatScannerCount(batchCount)} batch / ${formatScannerCount(
          concurrencyCount,
        )} conc`
      : batchCount != null
        ? `${formatScannerCount(batchCount)} batch`
        : MISSING_VALUE;
  const selectedDetail =
    intendedCount > selectedCount
      ? `selected ${formatScannerCount(selectedCount)}/${formatScannerCount(
          intendedCount,
        )}`
      : coverage.isRotating
        ? `rotating ${formatScannerCount(batchCount || coverage.batchSize)}/cycle`
        : sourceModeLabel.toLowerCase();
  const progressText = [
    sourceModeLabel,
    scopeLabel,
    `${cycleLabel} scanned`,
    queueLabel,
    capLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    batchLabel,
    capCount,
    capLabel,
    currentBatch,
    cycleLabel,
    pendingCount,
    progressText,
    queueLabel,
    recentSymbols,
    scopeLabel,
    selectedDetail,
    sourceModeLabel,
    totalCount,
  };
};
