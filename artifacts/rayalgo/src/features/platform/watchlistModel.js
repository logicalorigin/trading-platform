export const WATCHLIST_ROW_SOURCE = Object.freeze({
  WATCHLIST: "watchlist",
  MONITOR: "monitor",
});

export const WATCHLIST_SORT_MODE = Object.freeze({
  MANUAL: "manual",
  SIGNAL: "signal",
  PERCENT: "pct",
  VOLUME: "volume",
  ALPHA: "alpha",
});

export const WATCHLIST_SIGNAL_TIMEFRAMES = Object.freeze(["2m", "5m", "15m"]);

export const normalizeWatchlistSymbol = (value) =>
  value?.trim?.().toUpperCase?.() || "";

const normalizeSymbolListInput = (symbols = []) =>
  Array.isArray(symbols) ? symbols : Array.from(symbols || []);

const uniqueNormalizedWatchlistSymbols = (symbols = []) => [
  ...new Set(
    normalizeSymbolListInput(symbols)
      .map((symbol) => normalizeWatchlistSymbol(symbol))
      .filter(Boolean),
  ),
];

const isSignalDirection = (value) => value === "buy" || value === "sell";
const normalizeSignalTimeframe = (value) =>
  WATCHLIST_SIGNAL_TIMEFRAMES.includes(String(value || "").trim())
    ? String(value || "").trim()
    : "";

const WATCHLIST_IDENTITY_EMPTY_FIELDS = Object.freeze({
  market: null,
  normalizedExchangeMic: null,
  exchangeDisplay: null,
  countryCode: null,
  exchangeCountryCode: null,
  sector: null,
  industry: null,
});

const readIdentityValue = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const buildWatchlistIdentityPayload = (source = {}) => {
  if (!source || typeof source !== "object") {
    return {};
  }

  const normalizedExchangeMic = readIdentityValue(
    source.normalizedExchangeMic || source.primaryExchange,
  );
  const exchangeDisplay = readIdentityValue(
    source.exchangeDisplay || source.primaryExchange || normalizedExchangeMic,
  );

  return Object.fromEntries(
    [
      ["market", readIdentityValue(source.market)],
      ["normalizedExchangeMic", normalizedExchangeMic],
      ["exchangeDisplay", exchangeDisplay],
      ["countryCode", readIdentityValue(source.countryCode)],
      ["exchangeCountryCode", readIdentityValue(source.exchangeCountryCode)],
      ["sector", readIdentityValue(source.sector)],
      ["industry", readIdentityValue(source.industry)],
    ].filter(([, value]) => Boolean(value)),
  );
};

const normalizeIdentityFields = (item) => ({
  market: readIdentityValue(item?.market),
  normalizedExchangeMic: readIdentityValue(item?.normalizedExchangeMic),
  exchangeDisplay: readIdentityValue(item?.exchangeDisplay),
  countryCode: readIdentityValue(item?.countryCode),
  exchangeCountryCode: readIdentityValue(item?.exchangeCountryCode),
  sector: readIdentityValue(item?.sector),
  industry: readIdentityValue(item?.industry),
});

export const getSignalSortBucket = (state) => {
  if (!state || !isSignalDirection(state.currentSignalDirection)) {
    return 2;
  }
  return state.fresh ? 0 : 1;
};

export const buildSignalMatrixBySymbol = (states = []) => {
  const bySymbol = {};
  (states || []).forEach((state) => {
    const symbol = normalizeWatchlistSymbol(state?.symbol);
    const timeframe = normalizeSignalTimeframe(state?.timeframe);
    if (!symbol || !timeframe) return;
    bySymbol[symbol] = {
      ...(bySymbol[symbol] || {}),
      [timeframe]: state,
    };
  });
  return bySymbol;
};

export const getBestWatchlistSignalState = (statesByTimeframe = {}, fallbackState = null) => {
  const matrixStates = WATCHLIST_SIGNAL_TIMEFRAMES.map(
    (timeframe) => statesByTimeframe?.[timeframe],
  ).filter((state) => isSignalDirection(state?.currentSignalDirection));
  const freshState = matrixStates.find((state) => state?.fresh);
  if (freshState) return freshState;
  const sorted = [...matrixStates].sort((left, right) => {
    const leftBars = Number.isFinite(left?.barsSinceSignal) ? left.barsSinceSignal : Infinity;
    const rightBars = Number.isFinite(right?.barsSinceSignal) ? right.barsSinceSignal : Infinity;
    if (leftBars !== rightBars) return leftBars - rightBars;
    return WATCHLIST_SIGNAL_TIMEFRAMES.indexOf(left?.timeframe) -
      WATCHLIST_SIGNAL_TIMEFRAMES.indexOf(right?.timeframe);
  });
  return sorted[0] || fallbackState || null;
};

const normalizeWatchlistItem = (item, index) => {
  if (typeof item === "string") {
    const symbol = normalizeWatchlistSymbol(item);
    return symbol
      ? {
          id: null,
          key: `legacy:${symbol}`,
          sym: symbol,
          name: symbol,
          source: WATCHLIST_ROW_SOURCE.WATCHLIST,
          monitoredOnly: false,
          sortOrder: index,
          addedAt: null,
          canReorder: false,
          canRemove: false,
          ...WATCHLIST_IDENTITY_EMPTY_FIELDS,
        }
      : null;
  }

  const symbol = normalizeWatchlistSymbol(item?.symbol || item?.sym);
  if (!symbol) {
    return null;
  }

  const id = typeof item?.id === "string" && item.id ? item.id : null;
  return {
    id,
    key: id || `legacy:${symbol}`,
    sym: symbol,
    name: item?.name || symbol,
    source: WATCHLIST_ROW_SOURCE.WATCHLIST,
    monitoredOnly: false,
    sortOrder: Number.isFinite(item?.sortOrder) ? item.sortOrder : index,
    addedAt: item?.addedAt || null,
    canReorder: Boolean(id),
    canRemove: Boolean(id),
    ...normalizeIdentityFields(item),
  };
};

export const getWatchlistSourceItems = (watchlist, fallbackSymbols = []) => {
  const items = Array.isArray(watchlist?.items) ? watchlist.items : [];
  if (items.length) {
    return items;
  }
  const symbols = Array.isArray(watchlist?.symbols) ? watchlist.symbols : [];
  if (symbols.length) {
    return symbols;
  }
  return fallbackSymbols;
};

const watchlistItemsToSymbols = (items = []) =>
  uniqueNormalizedWatchlistSymbols(
    (items || []).map((item) =>
      typeof item === "string" ? item : item?.symbol || item?.sym,
    ),
  );

export const activeWatchlistSymbols = (activeWatchlist, fallbackSymbols = []) =>
  watchlistItemsToSymbols(getWatchlistSourceItems(activeWatchlist, fallbackSymbols));

export const allWatchlistSymbols = (watchlists = [], fallbackSymbols = []) => {
  const sourceWatchlists = Array.isArray(watchlists) ? watchlists : [];
  if (!sourceWatchlists.length) {
    return activeWatchlistSymbols(null, fallbackSymbols);
  }
  return uniqueNormalizedWatchlistSymbols(
    sourceWatchlists.flatMap((watchlist) =>
      watchlistItemsToSymbols(getWatchlistSourceItems(watchlist)),
    ),
  );
};

export const widerUniverseSymbols = ({
  watchlists = [],
  fallbackSymbols = [],
  universeSymbols = [],
} = {}) =>
  uniqueNormalizedWatchlistSymbols([
    ...allWatchlistSymbols(watchlists, fallbackSymbols),
    ...universeSymbols,
  ]);

export const countWatchlistSymbols = (watchlist) =>
  getWatchlistSourceItems(watchlist).reduce(
    (count, item) =>
      normalizeWatchlistSymbol(typeof item === "string" ? item : item?.symbol || item?.sym)
        ? count + 1
        : count,
    0,
  );

export const buildWatchlistRows = ({
  activeWatchlist = null,
  fallbackSymbols = [],
  signalStates = [],
} = {}) => {
  const rows = [];
  const bySymbol = new Map();

  getWatchlistSourceItems(activeWatchlist, fallbackSymbols).forEach((item, index) => {
    const row = normalizeWatchlistItem(item, index);
    if (!row || bySymbol.has(row.sym)) {
      return;
    }
    bySymbol.set(row.sym, row);
    rows.push(row);
  });

  (signalStates || []).forEach((state, index) => {
    const symbol = normalizeWatchlistSymbol(state?.symbol);
    if (!symbol || bySymbol.has(symbol)) {
      return;
    }
    const row = {
      id: null,
      key: `monitor:${symbol}`,
      sym: symbol,
      name: symbol,
      source: WATCHLIST_ROW_SOURCE.MONITOR,
      monitoredOnly: true,
      sortOrder: rows.length + index,
      addedAt: null,
      canReorder: false,
      canRemove: false,
      ...WATCHLIST_IDENTITY_EMPTY_FIELDS,
    };
    bySymbol.set(symbol, row);
    rows.push(row);
  });

  return rows;
};

export const formatWatchlistSignalBars = (barsSinceSignal) => {
  const value =
    typeof barsSinceSignal === "string"
      ? Number(barsSinceSignal)
      : barsSinceSignal;
  if (!Number.isFinite(value) || value < 0) {
    return "-";
  }
  const whole = Math.floor(value);
  return whole > 99 ? "99+" : String(whole);
};

const normalizeBadgeSymbolSet = (symbols = []) =>
  new Set(uniqueNormalizedWatchlistSymbols(symbols));

const hasQuoteData = (snapshot) =>
  Number.isFinite(snapshot?.price) ||
  Number.isFinite(snapshot?.chg) ||
  Number.isFinite(snapshot?.pct) ||
  Number.isFinite(snapshot?.volume);

const readFlowSummary = (flowBySymbol, symbol) => {
  if (!flowBySymbol || !symbol) return null;
  if (flowBySymbol instanceof Map) {
    return flowBySymbol.get(symbol) || null;
  }
  return flowBySymbol[symbol] || null;
};

const parseTimeMs = (value) => {
  if (!value) return NaN;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
};

const getFlowEventSymbol = (event) =>
  normalizeWatchlistSymbol(
    event?.ticker ||
      event?.underlying ||
      event?.underlyingSymbol ||
      event?.symbol ||
      "",
  );

export const buildWatchlistFlowBySymbol = (
  flowEvents = [],
  {
    minPremium = 250_000,
    minUnusualScore = 1,
    maxAgeMs = 45 * 60_000,
    nowMs = Date.now(),
  } = {},
) => {
  const bySymbol = {};
  (Array.isArray(flowEvents) ? flowEvents : []).forEach((event) => {
    const symbol = getFlowEventSymbol(event);
    if (!symbol) return;

    const premium = Number(event?.premium || 0);
    const unusualScore = Number(event?.unusualScore || 0);
    const occurredAtMs = parseTimeMs(
      event?.occurredAt || event?.timestamp || event?.updatedAt || event?.createdAt,
    );
    if (
      Number.isFinite(occurredAtMs) &&
      Number.isFinite(nowMs) &&
      maxAgeMs > 0 &&
      nowMs - occurredAtMs > maxAgeMs
    ) {
      return;
    }

    const isFlowSpike =
      Boolean(event?.isUnusual) ||
      (Number.isFinite(unusualScore) && unusualScore >= minUnusualScore) ||
      (Number.isFinite(premium) && premium >= minPremium);
    if (!isFlowSpike) return;

    const current = bySymbol[symbol] || {
      symbol,
      count: 0,
      premium: 0,
      maxUnusualScore: null,
      latestAt: null,
    };
    current.count += 1;
    if (Number.isFinite(premium)) {
      current.premium += premium;
    }
    if (Number.isFinite(unusualScore)) {
      current.maxUnusualScore =
        current.maxUnusualScore == null
          ? unusualScore
          : Math.max(current.maxUnusualScore, unusualScore);
    }
    if (
      Number.isFinite(occurredAtMs) &&
      (!current.latestAt || occurredAtMs > parseTimeMs(current.latestAt))
    ) {
      current.latestAt = new Date(occurredAtMs).toISOString();
    }
    bySymbol[symbol] = current;
  });
  return bySymbol;
};

export const buildWatchlistPositionSymbols = (positions = []) =>
  uniqueNormalizedWatchlistSymbols(
    (Array.isArray(positions) ? positions : []).flatMap((position) => {
      const underlying =
        position?.optionContract?.underlying ||
        position?.underlying ||
        position?.underlyingSymbol;
      return [underlying || position?.symbol];
    }),
  );

export const buildWatchlistEarningsSymbols = (
  entries = [],
  { nowMs = Date.now(), horizonDays = 14 } = {},
) => {
  const today = new Date(nowMs);
  const startKey = Number.isFinite(today.getTime())
    ? today.toISOString().slice(0, 10)
    : "";
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + horizonDays);
  const endKey = Number.isFinite(horizon.getTime())
    ? horizon.toISOString().slice(0, 10)
    : "";

  return uniqueNormalizedWatchlistSymbols(
    (Array.isArray(entries) ? entries : []).flatMap((entry) => {
      const symbol = normalizeWatchlistSymbol(entry?.symbol);
      const dateKey = String(entry?.date || "").slice(0, 10);
      if (!symbol || !dateKey) return [];
      if (startKey && dateKey < startKey) return [];
      if (endKey && dateKey > endKey) return [];
      return [symbol];
    }),
  );
};

export const buildWatchlistBadges = ({
  symbol,
  selectedSymbol = null,
  snapshot = null,
  signalState = null,
  earningsSymbols = [],
  flowBySymbol = {},
  positionSymbols = [],
  nowMs = Date.now(),
} = {}) => {
  const normalizedSymbol = normalizeWatchlistSymbol(symbol);
  if (!normalizedSymbol) return [];

  const badges = [];
  const earningsSet = normalizeBadgeSymbolSet(earningsSymbols);
  const positionSet = normalizeBadgeSymbolSet(positionSymbols);
  const selected = normalizeWatchlistSymbol(selectedSymbol);
  const flow = readFlowSummary(flowBySymbol, normalizedSymbol);
  const quoteTimestamp = snapshot?.updatedAt
    ? new Date(snapshot.updatedAt).getTime()
    : NaN;
  const quoteAgeMs = Number.isFinite(quoteTimestamp)
    ? Math.max(0, nowMs - quoteTimestamp)
    : null;

  if (selected && selected === normalizedSymbol) {
    badges.push({
      id: "linked",
      label: "LINK",
      tone: "linked",
      detail: "Linked workspace target",
    });
  }
  if (earningsSet.has(normalizedSymbol)) {
    badges.push({
      id: "earnings",
      label: "EARN",
      tone: "earnings",
      detail: "Earnings soon",
    });
  }
  if (signalState?.currentSignalDirection === "buy" || signalState?.currentSignalDirection === "sell") {
    badges.push({
      id: "signal",
      label: signalState.currentSignalDirection === "buy" ? "BUY" : "SELL",
      tone: signalState.currentSignalDirection,
      detail: `${signalState.fresh ? "Fresh" : "Stale"} ${signalState.currentSignalDirection} signal`,
    });
  }
  if (flow && (Number(flow.premium) > 0 || Number(flow.count) > 0)) {
    badges.push({
      id: "flow",
      label: Number(flow.premium) >= 250_000 ? "FLOW+" : "FLOW",
      tone: "flow",
      detail: `${Number(flow.count || 0)} flow print${Number(flow.count || 0) === 1 ? "" : "s"}`,
    });
  }
  if (positionSet.has(normalizedSymbol)) {
    badges.push({
      id: "position",
      label: "POS",
      tone: "position",
      detail: "Open position",
    });
  }
  if (!hasQuoteData(snapshot)) {
    badges.push({
      id: "no-data",
      label: "NO DATA",
      tone: "stale",
      detail: "No quote data",
    });
  } else if (quoteAgeMs != null && quoteAgeMs > 15 * 60_000) {
    badges.push({
      id: "stale",
      label: "STALE",
      tone: "stale",
      detail: "Quote is older than 15 minutes",
    });
  }

  return badges;
};

const compareDefinedNumber = (left, right, direction) => {
  const leftValid = Number.isFinite(left);
  const rightValid = Number.isFinite(right);
  if (leftValid && rightValid) {
    return direction === "asc" ? left - right : right - left;
  }
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
};

export const sortWatchlistRows = (
  rows,
  {
    mode = WATCHLIST_SORT_MODE.MANUAL,
    direction = "desc",
    snapshotsBySymbol = {},
    signalStatesBySymbol = {},
    signalMatrixBySymbol = {},
  } = {},
) => {
  const indexed = (rows || []).map((row, index) => ({ row, index }));
  if (mode === WATCHLIST_SORT_MODE.MANUAL) {
    return indexed
      .sort(
        (left, right) =>
          left.row.monitoredOnly - right.row.monitoredOnly ||
          (left.row.sortOrder ?? left.index) - (right.row.sortOrder ?? right.index) ||
          left.index - right.index,
      )
      .map((entry) => entry.row);
  }

  indexed.sort((left, right) => {
    if (mode === WATCHLIST_SORT_MODE.SIGNAL) {
      const leftState = getBestWatchlistSignalState(
        signalMatrixBySymbol[left.row.sym],
        signalStatesBySymbol[left.row.sym],
      );
      const rightState = getBestWatchlistSignalState(
        signalMatrixBySymbol[right.row.sym],
        signalStatesBySymbol[right.row.sym],
      );
      const bucketDelta =
        getSignalSortBucket(leftState) - getSignalSortBucket(rightState);
      if (bucketDelta) return bucketDelta;
      const barsDelta = compareDefinedNumber(
        leftState?.barsSinceSignal,
        rightState?.barsSinceSignal,
        "asc",
      );
      if (barsDelta) return barsDelta;
      return left.row.sym.localeCompare(right.row.sym);
    }

    if (mode === WATCHLIST_SORT_MODE.PERCENT) {
      const delta = compareDefinedNumber(
        snapshotsBySymbol[left.row.sym]?.pct,
        snapshotsBySymbol[right.row.sym]?.pct,
        direction,
      );
      if (delta) return delta;
      return left.row.sym.localeCompare(right.row.sym);
    }

    if (mode === WATCHLIST_SORT_MODE.VOLUME) {
      const delta = compareDefinedNumber(
        snapshotsBySymbol[left.row.sym]?.volume,
        snapshotsBySymbol[right.row.sym]?.volume,
        direction,
      );
      if (delta) return delta;
      return left.row.sym.localeCompare(right.row.sym);
    }

    if (mode === WATCHLIST_SORT_MODE.ALPHA) {
      const delta = left.row.sym.localeCompare(right.row.sym);
      return direction === "asc" ? delta : -delta;
    }

    return left.index - right.index;
  });

  return indexed.map((entry) => entry.row);
};
