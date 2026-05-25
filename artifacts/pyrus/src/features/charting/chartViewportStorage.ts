export type ScaleMode = "linear" | "log" | "percentage" | "indexed";

export type VisibleLogicalRange = {
  from: number;
  to: number;
};

export type ChartViewportSnapshot = {
  identityKey: string;
  viewportLayoutKey?: string | null;
  visibleLogicalRange: VisibleLogicalRange | null;
  userTouched: boolean;
  realtimeFollow: boolean;
  scaleMode: ScaleMode;
  autoScale: boolean;
  invertScale: boolean;
  updatedAt: number;
};

const STORED_CHART_VIEWPORT_SNAPSHOT_LIMIT = 96;
const STORED_CHART_VIEWPORT_LAYOUT_SEPARATOR = "::viewport-layout::";
const storedChartViewportSnapshots = new Map<string, ChartViewportSnapshot>();

export const normalizeChartViewportLayoutKey = (
  value?: string | null,
): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const buildStoredChartViewportSnapshotKey = (
  identityKey: string,
  viewportLayoutKey?: string | null,
): string => {
  const normalizedLayoutKey = normalizeChartViewportLayoutKey(viewportLayoutKey);
  return normalizedLayoutKey
    ? `${identityKey}${STORED_CHART_VIEWPORT_LAYOUT_SEPARATOR}${normalizedLayoutKey}`
    : identityKey;
};

export const chartViewportSnapshotMatchesContext = (
  snapshot: ChartViewportSnapshot | null | undefined,
  identityKey: string | null,
  viewportLayoutKey?: string | null,
): snapshot is ChartViewportSnapshot => {
  if (!identityKey || snapshot?.identityKey !== identityKey) {
    return false;
  }

  const expectedLayoutKey = normalizeChartViewportLayoutKey(viewportLayoutKey);
  const snapshotLayoutKey = normalizeChartViewportLayoutKey(
    snapshot.viewportLayoutKey,
  );
  return expectedLayoutKey
    ? snapshotLayoutKey === expectedLayoutKey
    : snapshotLayoutKey === null;
};

export const readStoredChartViewportSnapshot = (
  identityKey?: string | null,
  viewportLayoutKey?: string | null,
): ChartViewportSnapshot | null => {
  if (!identityKey) {
    return null;
  }

  return (
    storedChartViewportSnapshots.get(
      buildStoredChartViewportSnapshotKey(identityKey, viewportLayoutKey),
    ) ?? null
  );
};

export const writeStoredChartViewportSnapshot = (
  snapshot: ChartViewportSnapshot | null | undefined,
): void => {
  if (!snapshot?.identityKey) {
    return;
  }

  const storageKey = buildStoredChartViewportSnapshotKey(
    snapshot.identityKey,
    snapshot.viewportLayoutKey,
  );
  storedChartViewportSnapshots.delete(storageKey);
  storedChartViewportSnapshots.set(storageKey, snapshot);

  while (storedChartViewportSnapshots.size > STORED_CHART_VIEWPORT_SNAPSHOT_LIMIT) {
    const oldestKey = storedChartViewportSnapshots.keys().next().value;
    if (!oldestKey) {
      break;
    }
    storedChartViewportSnapshots.delete(oldestKey);
  }
};

export const clearStoredChartViewportSnapshot = (
  identityKey?: string | null,
  viewportLayoutKey?: string | null,
): void => {
  if (!identityKey) {
    return;
  }

  const normalizedLayoutKey = normalizeChartViewportLayoutKey(viewportLayoutKey);
  if (normalizedLayoutKey) {
    storedChartViewportSnapshots.delete(
      buildStoredChartViewportSnapshotKey(identityKey, normalizedLayoutKey),
    );
    return;
  }

  storedChartViewportSnapshots.delete(identityKey);
  const prefix = `${identityKey}${STORED_CHART_VIEWPORT_LAYOUT_SEPARATOR}`;
  Array.from(storedChartViewportSnapshots.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      storedChartViewportSnapshots.delete(key);
    }
  });
};

export const resolveEffectiveChartViewportSnapshot = ({
  identityKey,
  viewportLayoutKey,
  viewportSnapshot,
  useStoredFallback,
}: {
  identityKey: string | null;
  viewportLayoutKey?: string | null;
  viewportSnapshot?: ChartViewportSnapshot | null;
  useStoredFallback: boolean;
}): ChartViewportSnapshot | null => {
  if (
    chartViewportSnapshotMatchesContext(
      viewportSnapshot,
      identityKey,
      viewportLayoutKey,
    )
  ) {
    return viewportSnapshot;
  }

  return useStoredFallback
    ? readStoredChartViewportSnapshot(identityKey, viewportLayoutKey)
    : null;
};
