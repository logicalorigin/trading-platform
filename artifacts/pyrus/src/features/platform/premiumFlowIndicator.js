export const EMPTY_PREMIUM_FLOW_SUMMARY = Object.freeze({
  symbol: "",
  events: Object.freeze([]),
  calls: 0,
  puts: 0,
  totalPremium: 0,
  netPremium: 0,
  eventCount: 0,
  unusualCount: 0,
  latestOccurredAt: null,
  direction: "neutral",
  callShare: 0,
  putShare: 0,
  timeline: Object.freeze([]),
});

export const normalizePremiumFlowSymbol = (value) =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const toFinitePremium = (value) =>
  Number.isFinite(value) && value > 0 ? value : 0;

const toEventTime = (event) => {
  const value = Date.parse(event?.occurredAt);
  return Number.isFinite(value) ? value : 0;
};

const getEventSymbol = (event) =>
  normalizePremiumFlowSymbol(event?.ticker || event?.underlying || event?.symbol);

export const buildPremiumFlowTimeline = (events = []) => {
  let cumulative = 0;
  return [...(Array.isArray(events) ? events : [])]
    .filter((event) => {
      const side = event?.cp === "C" || event?.cp === "P" ? event.cp : null;
      return side && toFinitePremium(event?.premium) > 0;
    })
    .sort((left, right) => toEventTime(left) - toEventTime(right))
    .map((event, index) => {
      const premium = toFinitePremium(event.premium);
      const delta = event.cp === "P" ? -premium : premium;
      cumulative += delta;
      return {
        index,
        occurredAt: event.occurredAt || null,
        value: cumulative,
      };
    });
};

const buildPremiumFlowSummaryFromEvents = (normalizedSymbol, matchingEvents) => {
  if (!normalizedSymbol) {
    return EMPTY_PREMIUM_FLOW_SUMMARY;
  }

  let calls = 0;
  let puts = 0;
  let unusualCount = 0;
  let latestOccurredAt = null;
  let latestTime = -Infinity;

  matchingEvents.forEach((event) => {
    const premium = toFinitePremium(event?.premium);
    if (event?.cp === "P") {
      puts += premium;
    } else if (event?.cp === "C") {
      calls += premium;
    }
    if (event?.isUnusual) {
      unusualCount += 1;
    }
    const eventTime = toEventTime(event);
    if (eventTime >= latestTime) {
      latestTime = eventTime;
      latestOccurredAt = event?.occurredAt || null;
    }
  });

  const totalPremium = calls + puts;
  const netPremium = calls - puts;
  const direction =
    netPremium > 0 ? "call" : netPremium < 0 ? "put" : "neutral";

  return {
    symbol: normalizedSymbol,
    events: matchingEvents,
    calls,
    puts,
    totalPremium,
    netPremium,
    eventCount: matchingEvents.length,
    unusualCount,
    latestOccurredAt,
    direction,
    callShare: totalPremium > 0 ? calls / totalPremium : 0,
    putShare: totalPremium > 0 ? puts / totalPremium : 0,
    timeline: buildPremiumFlowTimeline(matchingEvents),
  };
};

export const buildPremiumFlowSummary = (symbol, events = []) => {
  const normalizedSymbol = normalizePremiumFlowSymbol(symbol);
  if (!normalizedSymbol) {
    return EMPTY_PREMIUM_FLOW_SUMMARY;
  }

  const matchingEvents = (Array.isArray(events) ? events : []).filter(
    (event) => getEventSymbol(event) === normalizedSymbol,
  );

  return buildPremiumFlowSummaryFromEvents(normalizedSymbol, matchingEvents);
};

export const buildPremiumFlowBySymbol = (events = [], symbols = []) => {
  const normalizedSymbols = Array.from(
    new Set(
      (symbols || [])
        .map((symbol) => normalizePremiumFlowSymbol(symbol))
        .filter(Boolean),
    ),
  );
  const symbolSet = new Set(normalizedSymbols);
  const result = {};
  const eventsBySymbol = new Map();

  normalizedSymbols.forEach((symbol) => {
    eventsBySymbol.set(symbol, []);
  });

  (Array.isArray(events) ? events : []).forEach((event) => {
    const symbol = getEventSymbol(event);
    if (!symbol || (symbolSet.size && !symbolSet.has(symbol))) {
      return;
    }
    if (!eventsBySymbol.has(symbol)) {
      eventsBySymbol.set(symbol, []);
    }
    eventsBySymbol.get(symbol).push(event);
  });

  for (const [symbol, symbolEvents] of eventsBySymbol) {
    result[symbol] = buildPremiumFlowSummaryFromEvents(symbol, symbolEvents);
  }

  return result;
};

const symbolMatches = (candidate, symbol) =>
  normalizePremiumFlowSymbol(candidate) === symbol;

export const resolvePremiumFlowDisplayState = ({
  symbol,
  summary,
  flowStatus,
  providerSummary,
} = {}) => {
  const normalizedSymbol = normalizePremiumFlowSymbol(symbol);
  const resolvedSummary = summary || EMPTY_PREMIUM_FLOW_SUMMARY;
  const hasFlow = resolvedSummary.eventCount > 0;
  const coverage = providerSummary?.coverage || {};
  const isInCurrentBatch = Array.isArray(coverage.currentBatch)
    ? coverage.currentBatch.some((candidate) =>
        symbolMatches(candidate, normalizedSymbol),
      )
    : false;
  const isScanning = Boolean(coverage.isFetching && isInCurrentBatch);
  const failure = Array.isArray(providerSummary?.failures)
    ? providerSummary.failures.find((entry) =>
        symbolMatches(entry?.symbol, normalizedSymbol),
      )
    : null;
  const source = providerSummary?.sourcesBySymbol?.[normalizedSymbol] || null;
  const errorMessage = failure?.error || source?.errorMessage || null;
  const sourceProvider = normalizePremiumFlowSymbol(source?.provider);
  const sourceStatus = String(source?.status || "").toLowerCase();
  const isLiveSource =
    sourceProvider === "IBKR" &&
    !source?.fallbackUsed &&
    sourceStatus !== "error";

  if (failure && hasFlow) {
    return {
      label: "Stale flow",
      kind: "stale",
      isScanning: false,
      isQueued: false,
      isError: false,
      isStale: true,
      isLiveSource: false,
      sourceProvider,
      sourceStatus,
      errorMessage,
    };
  }

  if (failure || source?.status === "error") {
    return {
      label: "Flow error",
      kind: "error",
      isScanning: false,
      isQueued: false,
      isError: true,
      isStale: false,
      isLiveSource: false,
      sourceProvider,
      sourceStatus,
      errorMessage,
    };
  }

  if (hasFlow) {
    const sourceLabel = resolvedSummary.events[0]?.sourceLabel;
    return {
      label:
        sourceLabel ||
        (resolvedSummary.events[0]?.basis === "snapshot"
          ? "Snapshot prem"
          : "Premium flow"),
      kind: isScanning ? "refreshing" : "live",
      isScanning,
      isQueued: false,
      isError: false,
      isStale: false,
      isLiveSource,
      sourceProvider,
      sourceStatus,
      errorMessage: null,
    };
  }

  if (isScanning) {
    return {
      label: "Scanning",
      kind: "scanning",
      isScanning: true,
      isQueued: false,
      isError: false,
      isStale: false,
      isLiveSource,
      sourceProvider,
      sourceStatus,
      errorMessage: null,
    };
  }

  if (coverage.lastScannedAt?.[normalizedSymbol]) {
    return {
      label: "No options flow",
      kind: "empty",
      isScanning: false,
      isQueued: false,
      isError: false,
      isStale: false,
      isLiveSource,
      sourceProvider,
      sourceStatus,
      errorMessage: null,
    };
  }

  return {
    label: "Queued flow",
    kind: flowStatus === "loading" ? "loading" : "queued",
    isScanning: false,
    isQueued: true,
    isError: false,
    isStale: false,
    isLiveSource,
    sourceProvider,
    sourceStatus,
    errorMessage: null,
  };
};
