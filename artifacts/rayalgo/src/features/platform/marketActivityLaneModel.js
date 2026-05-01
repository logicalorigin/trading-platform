export const SIGNAL_MONITOR_TIMEFRAMES = ["1m", "5m", "15m", "1h", "1d"];
export const MARKET_ACTIVITY_RECENT_SIGNAL_MS = 24 * 60 * 60 * 1000;

export const normalizeSignalMonitorTimeframe = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return SIGNAL_MONITOR_TIMEFRAMES.includes(normalized) ? normalized : "15m";
};

const normalizeSymbol = (value) =>
  String(value || "").trim().toUpperCase();

const normalizeDirection = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "buy" || normalized === "sell" ? normalized : "";
};

export const parseActivityTimeMs = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

const upsertSignalRow = (rowsByKey, row) => {
  if (!row?.key) return;
  const existing = rowsByKey.get(row.key);
  if (!existing) {
    rowsByKey.set(row.key, row);
    return;
  }

  const existingPriority = getSignalRowPriority(existing);
  const rowPriority = getSignalRowPriority(row);
  if (
    rowPriority < existingPriority ||
    (rowPriority === existingPriority && row.timeMs > existing.timeMs)
  ) {
    rowsByKey.set(row.key, row);
  }
};

const getSignalRowPriority = (row) => {
  if (row?.source === "state" && row?.fresh) return 0;
  if (row?.source === "state") return 1;
  return 2;
};

export const buildSignalLaneRows = (
  { states = [], events = [], selectedTimeframe = "15m" } = {},
  {
    nowMs = Date.now(),
    recentSignalMs = MARKET_ACTIVITY_RECENT_SIGNAL_MS,
    maxItems = 18,
  } = {},
) => {
  const timeframeFilter = normalizeSignalMonitorTimeframe(selectedTimeframe);
  const cutoffMs = nowMs - recentSignalMs;
  const rowsByKey = new Map();

  (states || []).forEach((state) => {
    const symbol = normalizeSymbol(state?.symbol);
    const direction = normalizeDirection(state?.currentSignalDirection);
    const timeframe = normalizeSignalMonitorTimeframe(state?.timeframe);
    if (
      !symbol ||
      !direction ||
      state?.active === false ||
      timeframe !== timeframeFilter
    ) {
      return;
    }

    const time = state?.currentSignalAt || state?.lastEvaluatedAt || "";
    const timeMs = parseActivityTimeMs(time);
    const key = [symbol, timeframe, direction, timeMs || state?.id || "current"].join(
      "|",
    );

    upsertSignalRow(rowsByKey, {
      id: `signal-state-${key}`,
      key,
      kind: "signal",
      source: "state",
      symbol,
      direction,
      directionLabel: direction.toUpperCase(),
      timeframe,
      price: state?.currentSignalPrice ?? null,
      time,
      timeMs,
      fresh: Boolean(state?.fresh),
      current: true,
      raw: state,
    });
  });

  (events || []).forEach((event) => {
    const symbol = normalizeSymbol(event?.symbol);
    const direction = normalizeDirection(event?.direction);
    const timeframe = normalizeSignalMonitorTimeframe(event?.timeframe);
    if (!symbol || !direction || timeframe !== timeframeFilter) return;

    const time = event?.signalAt || event?.emittedAt || "";
    const timeMs = parseActivityTimeMs(time);
    if (timeMs && timeMs < cutoffMs) return;

    const key = [symbol, timeframe, direction, timeMs || event?.id || "event"].join(
      "|",
    );

    upsertSignalRow(rowsByKey, {
      id: `signal-event-${event?.id || key}`,
      key,
      kind: "signal",
      source: "event",
      symbol,
      direction,
      directionLabel: direction.toUpperCase(),
      timeframe,
      price: event?.signalPrice ?? event?.close ?? null,
      time,
      timeMs,
      fresh: false,
      current: false,
      raw: event,
    });
  });

  return Array.from(rowsByKey.values())
    .sort((left, right) => {
      const priorityDelta = getSignalRowPriority(left) - getSignalRowPriority(right);
      if (priorityDelta !== 0) return priorityDelta;
      if (left.timeMs !== right.timeMs) return right.timeMs - left.timeMs;
      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, maxItems);
};

const getFlowEventSymbol = (event) =>
  normalizeSymbol(event?.ticker || event?.underlying || event?.symbol);

const getFlowEventTime = (event) =>
  event?.occurredAt || event?.time || event?.timestamp || "";

export const buildUnusualLaneRows = (
  events = [],
  { maxItems = 18 } = {},
) => {
  const rowsByKey = new Map();

  (events || []).forEach((event) => {
    if (!event?.isUnusual) return;
    const symbol = getFlowEventSymbol(event);
    if (!symbol) return;

    const time = getFlowEventTime(event);
    const timeMs = parseActivityTimeMs(time);
    const score = Number(event?.unusualScore ?? event?.score ?? 0);
    const premium = Number(event?.premium ?? 0);
    const contract =
      event?.contract ||
      [event?.strike, event?.cp || event?.right, event?.expirationDate || event?.exp]
        .filter(Boolean)
        .join(" ");
    const key =
      event?.id ||
      [symbol, contract || event?.optionTicker || "flow", timeMs || time].join("|");

    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        id: `unusual-${key}`,
        key,
        kind: "unusual",
        symbol,
        contract,
        side: event?.side || "",
        type: event?.type || event?.cp || event?.right || "",
        premium: Number.isFinite(premium) ? premium : 0,
        score: Number.isFinite(score) ? score : 0,
        time,
        timeMs,
        raw: event,
      });
    }
  });

  return Array.from(rowsByKey.values())
    .sort((left, right) => {
      if (left.timeMs !== right.timeMs) return right.timeMs - left.timeMs;
      if (left.score !== right.score) return right.score - left.score;
      if (left.premium !== right.premium) return right.premium - left.premium;
      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, maxItems);
};

const getNotificationTimeMs = (item) =>
  parseActivityTimeMs(
    item?.timeMs ||
      item?.publishedAt ||
      item?.occurredAt ||
      item?.updatedAt ||
      item?.createdAt ||
      item?.dateTime ||
      item?.date,
  );

export const buildNotificationLaneRows = (
  { alerts = [], news = [], calendar = [] } = {},
  { maxItems = 12 } = {},
) => {
  const rows = [
    ...(alerts || []).map((item) => ({
      id: `alert-${item?.id || item?.symbol || item?.label}`,
      kind: "alert",
      priority: 0,
      title: item?.label || "Portfolio alert",
      detail: item?.detail || "",
      meta: item?.tone === "profit" ? "Portfolio alert" : "Risk alert",
      symbol: normalizeSymbol(item?.symbol),
      tone: item?.tone || "risk",
      timeMs: getNotificationTimeMs(item),
      raw: item,
    })),
    ...(news || []).map((item) => ({
      id: `news-${item?.id || item?.articleUrl || item?.text}`,
      kind: "news",
      priority: 1,
      title: item?.text || "Market news",
      detail: item?.publisher || item?.tag || "",
      meta: item?.time || "",
      symbol: normalizeSymbol(item?.tag),
      articleUrl: item?.articleUrl || null,
      timeMs: getNotificationTimeMs(item),
      raw: item,
    })),
    ...(calendar || []).map((item) => ({
      id: `calendar-${item?.id || item?.label}`,
      kind: "calendar",
      priority: 1,
      title: item?.label || "Calendar event",
      detail: item?.date || "",
      meta: "Calendar",
      symbol: normalizeSymbol(item?.symbol || String(item?.label || "").split(" ")[0]),
      timeMs: getNotificationTimeMs(item),
      raw: item,
    })),
  ];

  return rows
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      if (left.timeMs !== right.timeMs) return right.timeMs - left.timeMs;
      return left.title.localeCompare(right.title);
    })
    .slice(0, maxItems);
};

export const buildMarketActivityLanes = (
  {
    notifications = [],
    highlightedUnusualFlow = [],
    signalEvents = [],
    signalStates = [],
    selectedTimeframe = "15m",
    newsItems = [],
    calendarItems = [],
  } = {},
  options = {},
) => ({
  signals: buildSignalLaneRows(
    {
      states: signalStates,
      events: signalEvents,
      selectedTimeframe,
    },
    options.signals,
  ),
  unusual: buildUnusualLaneRows(highlightedUnusualFlow, options.unusual),
  notifications: buildNotificationLaneRows(
    {
      alerts: notifications,
      news: newsItems,
      calendar: calendarItems,
    },
    options.notifications,
  ),
});
