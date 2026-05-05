export const MARKET_CALENDAR_EVENT_TYPES = Object.freeze([
  "earnings",
  "revenue",
  "dividend",
  "split",
  "ipo",
  "economic",
  "conference",
  "other",
]);

export const MARKET_CALENDAR_FILTER_SCOPES = Object.freeze([
  "active_watchlist",
  "all_watchlists",
  "held_positions",
  "universe",
]);

export const MARKET_CALENDAR_TIMING_FILTERS = Object.freeze([
  "all",
  "bmo",
  "amc",
  "dmh",
  "scheduled",
  "unknown",
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMING_ORDER = Object.freeze({
  bmo: 0,
  dmh: 1,
  scheduled: 2,
  amc: 3,
  unknown: 4,
});

const EVENT_TYPE_LABELS = Object.freeze({
  earnings: "Earnings",
  revenue: "Revenue",
  dividend: "Dividend",
  split: "Split",
  ipo: "IPO",
  economic: "Economic",
  conference: "Conference",
  other: "Other",
});

const TIMING_LABELS = Object.freeze({
  bmo: "BMO",
  amc: "AMC",
  dmh: "DMH",
  scheduled: "Time",
  unknown: "Unknown",
});

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : "";

const uniqueNormalizedSymbols = (symbols = []) => [
  ...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map((symbol) => normalizeMarketCalendarSymbol(symbol))
      .filter(Boolean),
  ),
];

const normalizeDateKey = (value) => {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return isoDateKey(value);
  }
  const raw = normalizeString(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return "";
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
};

const isoDateKey = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

const parseDateKey = (value) => {
  const key = normalizeDateKey(value);
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const finiteNumberOrNull = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const normalizeMarketCalendarSymbol = (value) =>
  normalizeString(value).toUpperCase();

export const normalizeMarketCalendarEventType = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  return MARKET_CALENDAR_EVENT_TYPES.includes(normalized) ? normalized : "other";
};

export const normalizeMarketCalendarTiming = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "before market open" || normalized === "before open") {
    return "bmo";
  }
  if (normalized === "after market close" || normalized === "after close") {
    return "amc";
  }
  if (normalized === "during market hours" || normalized === "market hours") {
    return "dmh";
  }
  if (["bmo", "amc", "dmh"].includes(normalized)) {
    return normalized;
  }
  if (/^\d{1,2}:\d{2}/.test(normalized)) {
    return "scheduled";
  }
  return "unknown";
};

export const formatMarketCalendarTimingLabel = (value) =>
  TIMING_LABELS[normalizeMarketCalendarTiming(value)] || TIMING_LABELS.unknown;

export const formatMarketCalendarEventTypeLabel = (value) =>
  EVENT_TYPE_LABELS[normalizeMarketCalendarEventType(value)] || EVENT_TYPE_LABELS.other;

export const getMarketCalendarMonthWindow = (monthDate = new Date()) => {
  const parsed =
    monthDate instanceof Date ? monthDate : parseDateKey(monthDate) || new Date();
  const safe = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  const first = new Date(Date.UTC(safe.getUTCFullYear(), safe.getUTCMonth(), 1));
  const last = new Date(Date.UTC(safe.getUTCFullYear(), safe.getUTCMonth() + 1, 0));
  return {
    from: isoDateKey(first),
    to: isoDateKey(last),
    monthKey: isoDateKey(first).slice(0, 7),
    year: first.getUTCFullYear(),
    month: first.getUTCMonth(),
    label: new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(first),
  };
};

export const shiftMarketCalendarMonth = (monthDate = new Date(), delta = 0) => {
  const window = getMarketCalendarMonthWindow(monthDate);
  return new Date(Date.UTC(window.year, window.month + delta, 1));
};

export const compareMarketCalendarEvents = (left, right) => {
  const leftDate = left?.date || "";
  const rightDate = right?.date || "";
  if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
  const leftTiming = TIMING_ORDER[left?.timing] ?? TIMING_ORDER.unknown;
  const rightTiming = TIMING_ORDER[right?.timing] ?? TIMING_ORDER.unknown;
  if (leftTiming !== rightTiming) return leftTiming - rightTiming;
  const leftSymbol = left?.symbol || "";
  const rightSymbol = right?.symbol || "";
  return leftSymbol.localeCompare(rightSymbol);
};

export const normalizeMarketCalendarEvent = (
  entry,
  {
    eventType = "earnings",
    provider = "research-calendar",
    providerState = "live",
    fetchedAt = null,
  } = {},
) => {
  const symbol = normalizeMarketCalendarSymbol(entry?.symbol);
  const date = normalizeDateKey(entry?.date);
  if (!symbol || !date) return null;

  const normalizedEventType = normalizeMarketCalendarEventType(
    entry?.eventType || eventType,
  );
  const timing = normalizeMarketCalendarTiming(entry?.time);
  const timingLabel = formatMarketCalendarTimingLabel(timing);
  const eventTypeLabel = formatMarketCalendarEventTypeLabel(normalizedEventType);

  return {
    id: [
      normalizedEventType,
      symbol,
      date,
      timing,
      normalizeDateKey(entry?.fiscalDateEnding) || "na",
    ].join(":"),
    symbol,
    date,
    time: normalizeString(entry?.time) || null,
    timing,
    timingLabel,
    eventType: normalizedEventType,
    eventTypeLabel,
    title: `${symbol} ${eventTypeLabel.toLowerCase()}`,
    provider,
    providerState,
    fetchedAt,
    epsEstimated: finiteNumberOrNull(entry?.epsEstimated),
    revenueEstimated: finiteNumberOrNull(entry?.revenueEstimated),
    fiscalDateEnding: normalizeDateKey(entry?.fiscalDateEnding) || null,
    metadata: { ...(entry || {}) },
  };
};

export const buildMarketCalendarEventsFromEarnings = (
  entries = [],
  options = {},
) =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) =>
      normalizeMarketCalendarEvent(entry, {
        eventType: "earnings",
        provider: options.provider || "fmp",
        providerState: options.providerState || "live",
        fetchedAt: options.fetchedAt || null,
      }),
    )
    .filter(Boolean)
    .sort(compareMarketCalendarEvents);

export const attachMarketCalendarRelations = (
  events = [],
  { activeWatchlistSymbols = [], allWatchlistSymbols = [], heldSymbols = [] } = {},
) => {
  const active = new Set(uniqueNormalizedSymbols(activeWatchlistSymbols));
  const allWatchlists = new Set(uniqueNormalizedSymbols(allWatchlistSymbols));
  const held = new Set(uniqueNormalizedSymbols(heldSymbols));

  return (Array.isArray(events) ? events : []).map((event) => {
    const symbol = normalizeMarketCalendarSymbol(event?.symbol);
    const inActiveWatchlist = active.has(symbol);
    const inAnyWatchlist = allWatchlists.has(symbol);
    const inHeldPositions = held.has(symbol);
    const relationLabel = inHeldPositions
      ? "Held"
      : inActiveWatchlist
        ? "Active WL"
        : inAnyWatchlist
          ? "Watchlist"
          : "Universe";

    return {
      ...event,
      inActiveWatchlist,
      inAnyWatchlist,
      inHeldPositions,
      relationLabel,
    };
  });
};

export const filterMarketCalendarEvents = (
  events = [],
  {
    scope = "universe",
    eventTypes = ["earnings"],
    timing = "all",
    from = null,
    to = null,
  } = {},
) => {
  const normalizedScope = MARKET_CALENDAR_FILTER_SCOPES.includes(scope)
    ? scope
    : "universe";
  const normalizedEventTypes = new Set(
    (Array.isArray(eventTypes) ? eventTypes : [eventTypes])
      .map((eventType) => normalizeMarketCalendarEventType(eventType))
      .filter(Boolean),
  );
  const normalizedTiming =
    MARKET_CALENDAR_TIMING_FILTERS.includes(timing) ? timing : "all";
  const fromKey = normalizeDateKey(from);
  const toKey = normalizeDateKey(to);

  return (Array.isArray(events) ? events : [])
    .filter((event) => {
      if (!event?.date) return false;
      if (fromKey && event.date < fromKey) return false;
      if (toKey && event.date > toKey) return false;
      if (normalizedEventTypes.size && !normalizedEventTypes.has(event.eventType)) {
        return false;
      }
      if (normalizedTiming !== "all" && event.timing !== normalizedTiming) {
        return false;
      }
      if (normalizedScope === "active_watchlist") {
        return Boolean(event.inActiveWatchlist);
      }
      if (normalizedScope === "all_watchlists") {
        return Boolean(event.inAnyWatchlist);
      }
      if (normalizedScope === "held_positions") {
        return Boolean(event.inHeldPositions);
      }
      return true;
    })
    .sort(compareMarketCalendarEvents);
};

export const buildMarketCalendarMonthGrid = ({
  monthDate = new Date(),
  events = [],
} = {}) => {
  const window = getMarketCalendarMonthWindow(monthDate);
  const first = parseDateKey(window.from);
  const gridStart = new Date(first.getTime() - first.getUTCDay() * DAY_MS);
  const eventsByDate = new Map();

  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event?.date) return;
    const bucket = eventsByDate.get(event.date) || [];
    bucket.push(event);
    eventsByDate.set(event.date, bucket);
  });

  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getTime() + index * DAY_MS);
    const dateKey = isoDateKey(date);
    const dayEvents = (eventsByDate.get(dateKey) || []).sort(compareMarketCalendarEvents);
    return {
      date: dateKey,
      dayOfMonth: date.getUTCDate(),
      inMonth: dateKey >= window.from && dateKey <= window.to,
      isToday: dateKey === isoDateKey(new Date()),
      events: dayEvents,
    };
  });

  return {
    ...window,
    days,
    weeks: Array.from({ length: 6 }, (_, index) =>
      days.slice(index * 7, index * 7 + 7),
    ),
  };
};

export const paginateMarketCalendarUniverse = (
  events = [],
  { page = 0, pageSize = 24 } = {},
) => {
  const safePageSize = Math.max(1, Math.floor(pageSize) || 24);
  const bySymbol = new Map();

  (Array.isArray(events) ? events : []).forEach((event) => {
    const symbol = normalizeMarketCalendarSymbol(event?.symbol);
    if (!symbol) return;
    const current = bySymbol.get(symbol) || {
      symbol,
      count: 0,
      nextDate: event.date || null,
      eventTypes: new Set(),
      relationLabel: event.relationLabel || "Universe",
    };
    current.count += 1;
    if (event.date && (!current.nextDate || event.date < current.nextDate)) {
      current.nextDate = event.date;
    }
    current.eventTypes.add(event.eventType || "other");
    if (event.relationLabel && current.relationLabel === "Universe") {
      current.relationLabel = event.relationLabel;
    }
    bySymbol.set(symbol, current);
  });

  const rows = Array.from(bySymbol.values())
    .map((row) => ({
      ...row,
      eventTypes: Array.from(row.eventTypes).sort(),
    }))
    .sort((left, right) => {
      if (left.nextDate !== right.nextDate) {
        return (left.nextDate || "9999-99-99") < (right.nextDate || "9999-99-99")
          ? -1
          : 1;
      }
      return left.symbol.localeCompare(right.symbol);
    });
  const pageCount = Math.max(1, Math.ceil(rows.length / safePageSize));
  const safePage = Math.min(Math.max(0, Math.floor(page) || 0), pageCount - 1);

  return {
    rows: rows.slice(safePage * safePageSize, safePage * safePageSize + safePageSize),
    total: rows.length,
    page: safePage,
    pageSize: safePageSize,
    pageCount,
  };
};

export const resolveMarketCalendarProviderStatus = ({
  researchConfigured = false,
  isPending = false,
  isError = false,
  eventCount = 0,
} = {}) => {
  if (!researchConfigured) {
    return {
      status: "research_off",
      label: "research off",
      detail: "Research calendar access is not configured for this environment.",
    };
  }
  if (isError) {
    return {
      status: "degraded",
      label: "degraded",
      detail: "The earnings calendar provider returned an error.",
    };
  }
  if (isPending) {
    return {
      status: "loading",
      label: "loading",
      detail: "Fetching provider-backed earnings events.",
    };
  }
  if (eventCount > 0) {
    return {
      status: "live",
      label: "earnings live",
      detail: "Provider-backed earnings events are loaded.",
    };
  }
  return {
    status: "empty",
    label: "empty",
    detail: "No provider-backed events were returned for this calendar window.",
  };
};
