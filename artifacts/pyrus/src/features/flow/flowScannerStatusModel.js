const safeCount = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

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
