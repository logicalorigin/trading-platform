const STATUS_COPY = {
  empty: {
    label: "Scanner universe is empty",
    text: "EMPTY",
    tone: "quiet",
  },
  error: {
    label: "Scanner unavailable",
    text: "ERROR",
    tone: "error",
  },
  filtered: {
    label: "Scanner filter has no matches",
    text: "FILTERED",
    tone: "quiet",
  },
  live: {
    label: "Scanner data live",
    text: "LIVE",
    tone: "live",
  },
  loading: {
    label: "Scanner data loading",
    text: "LOADING",
    tone: "loading",
  },
  partial: {
    label: "Scanner data partial; some quote or flow values are unavailable",
    text: "PARTIAL",
    tone: "degraded",
  },
  stale: {
    label: "Scanner data stale; retry available",
    text: "STALE",
    tone: "stale",
  },
};

const buildState = ({
  body,
  canRetry,
  flowSettled,
  quotesSettled,
  status,
}) => ({
  body,
  canRetry,
  flowSettled,
  quotesSettled,
  status,
  statusLabel: STATUS_COPY[status].label,
  statusText: STATUS_COPY[status].text,
  statusTone: STATUS_COPY[status].tone,
});

export const resolveMarketScannerState = ({
  filterText = "",
  flowError = false,
  flowHasData = false,
  quotesError = false,
  quotesHasData = false,
  totalUniverse = 0,
  universeError = false,
  universeHasData = false,
  universePending = false,
  visibleRows = 0,
} = {}) => {
  const flowSettled = Boolean(flowHasData || flowError);
  const quotesSettled = Boolean(quotesHasData || quotesError);
  const shared = { flowSettled, quotesSettled };

  if (!universeHasData && universeError) {
    return buildState({
      ...shared,
      body: "error",
      canRetry: true,
      status: "error",
    });
  }

  if (!universeHasData || universePending) {
    return buildState({
      ...shared,
      body: "loading",
      canRetry: false,
      status: "loading",
    });
  }

  if (visibleRows <= 0) {
    const filtered = filterText.trim().length > 0 && totalUniverse > 0;
    return buildState({
      ...shared,
      body: filtered ? "filtered-empty" : "empty",
      canRetry: false,
      status: filtered ? "filtered" : "empty",
    });
  }

  const stale =
    universeError ||
    (quotesError && quotesHasData) ||
    (flowError && flowHasData);
  if (stale) {
    return buildState({
      ...shared,
      body: "rows",
      canRetry: true,
      status: "stale",
    });
  }

  if (quotesError || flowError) {
    return buildState({
      ...shared,
      body: "rows",
      canRetry: true,
      status: "partial",
    });
  }

  if (!quotesSettled || !flowSettled) {
    return buildState({
      ...shared,
      body: "rows",
      canRetry: false,
      status: "loading",
    });
  }

  return buildState({
    ...shared,
    body: "rows",
    canRetry: false,
    status: "live",
  });
};
