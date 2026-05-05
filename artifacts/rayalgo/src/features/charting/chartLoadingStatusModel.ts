export type ChartLoadingStatusTone = "good" | "warn" | "bad" | "info" | "neutral";

export type ChartLoadingStatusState =
  | "loading"
  | "hydrating"
  | "backfilling"
  | "refreshing"
  | "streaming"
  | "loaded"
  | "empty"
  | "degraded";

export type ChartLoadingStatus = {
  active: boolean;
  detail: string;
  label: string;
  progressLabel: string;
  state: ChartLoadingStatusState;
  tone: ChartLoadingStatusTone;
};

const safeCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;

export const formatChartBarCount = (value: unknown): string => {
  const count = safeCount(value);
  if (count == null) return "--";
  if (count >= 1_000) {
    const compact = count / 1_000;
    return `${compact >= 10 ? compact.toFixed(0) : compact.toFixed(1)}K`;
  }
  return String(count);
};

const compactProviderLabel = (value: string | null | undefined): string => {
  const label = String(value || "").trim();
  if (!label) return "provider";
  return label.length > 30 ? `${label.slice(0, 27)}...` : label;
};

const compactReason = (value: string | null | undefined): string => {
  const reason = String(value || "").trim();
  if (!reason) return "No bars hydrated";
  return reason.replaceAll("_", " ").replaceAll("-", " ");
};

export const resolveChartLoadingStatus = ({
  symbol,
  timeframe,
  providerLabel,
  statusLabel,
  renderedBarCount = 0,
  hydratedBaseCount = 0,
  livePatchedBarCount = 0,
  requestedLimit = 0,
  targetLimit = 0,
  maxLimit = 0,
  isInitialLoading = false,
  isFetching = false,
  isHydratingFullWindow = false,
  isPrependingOlder = false,
  hasExhaustedOlderHistory = false,
  emptyReason = null,
}: {
  symbol?: string | null;
  timeframe?: string | null;
  providerLabel?: string | null;
  statusLabel?: string | null;
  renderedBarCount?: number | null;
  hydratedBaseCount?: number | null;
  livePatchedBarCount?: number | null;
  requestedLimit?: number | null;
  targetLimit?: number | null;
  maxLimit?: number | null;
  isInitialLoading?: boolean;
  isFetching?: boolean;
  isHydratingFullWindow?: boolean;
  isPrependingOlder?: boolean;
  hasExhaustedOlderHistory?: boolean;
  emptyReason?: string | null;
} = {}): ChartLoadingStatus => {
  const rendered = safeCount(renderedBarCount) ?? 0;
  const hydrated = safeCount(hydratedBaseCount) ?? rendered;
  const livePatched = safeCount(livePatchedBarCount) ?? 0;
  const requested = safeCount(requestedLimit) ?? 0;
  const target = safeCount(targetLimit) ?? requested;
  const max = safeCount(maxLimit) ?? target;
  const source = compactProviderLabel(providerLabel || statusLabel);
  const context = [symbol, timeframe].filter(Boolean).join(" ") || "chart";
  const targetText = target > 0 ? formatChartBarCount(target) : "--";
  const maxText = max > 0 ? formatChartBarCount(max) : targetText;
  const loadedText = formatChartBarCount(rendered);

  if (rendered <= 0) {
    if (isInitialLoading || isFetching) {
      return {
        active: true,
        detail: `${context} · ${source}`,
        label: "Fetching history",
        progressLabel: `0/${targetText} bars`,
        state: "loading",
        tone: "info",
      };
    }

    return {
      active: false,
      detail: `${context} · ${compactReason(emptyReason)}`,
      label: emptyReason ? "Degraded" : "No chart bars",
      progressLabel: "0 bars",
      state: emptyReason ? "degraded" : "empty",
      tone: emptyReason ? "bad" : "neutral",
    };
  }

  if (isPrependingOlder) {
    return {
      active: true,
      detail: `${context} · ${source}`,
      label: "Fetching older history",
      progressLabel: `${loadedText}/${maxText} bars`,
      state: "backfilling",
      tone: "warn",
    };
  }

  if (isHydratingFullWindow || (target > 0 && requested > 0 && requested < target)) {
    return {
      active: true,
      detail: `${context} · ${source}`,
      label: "Hydrating chart window",
      progressLabel: `${loadedText}/${targetText} bars`,
      state: "hydrating",
      tone: "info",
    };
  }

  if (isFetching) {
    return {
      active: true,
      detail: `${context} · ${source}`,
      label: "Refreshing live edge",
      progressLabel: `${loadedText} bars`,
      state: "refreshing",
      tone: "info",
    };
  }

  const streaming =
    livePatched > 0 || /live|open|stream|websocket|ibkr/i.test(statusLabel || "");
  const exhaustedSuffix = hasExhaustedOlderHistory ? " · history exhausted" : "";

  return {
    active: false,
    detail: `${context} · ${source}${exhaustedSuffix}`,
    label: streaming ? "Streaming" : "Loaded",
    progressLabel:
      hydrated > 0 && livePatched > 0
        ? `${formatChartBarCount(hydrated)} + ${formatChartBarCount(livePatched)} live`
        : `${loadedText} bars`,
    state: streaming ? "streaming" : "loaded",
    tone: streaming ? "good" : "neutral",
  };
};
