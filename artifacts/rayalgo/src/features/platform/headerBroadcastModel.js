export const HEADER_SIGNAL_MAX_ITEMS = 24;
export const HEADER_UNUSUAL_MAX_ITEMS = 28;
export const HEADER_RECENT_SIGNAL_MS = 2 * 24 * 60 * 60 * 1000;
export const DEFAULT_HEADER_BROADCAST_SPEED_PRESET = "slow";
export const HEADER_BROADCAST_SPEED_PRESETS = {
  slow: {
    label: "Slow",
    signalDurationSeconds: 64,
    unusualDurationSeconds: 84,
  },
  normal: {
    label: "Normal",
    signalDurationSeconds: 48,
    unusualDurationSeconds: 64,
  },
  fast: {
    label: "Fast",
    signalDurationSeconds: 32,
    unusualDurationSeconds: 42,
  },
};

export const resolveHeaderBroadcastSpeedPreset = (value) =>
  HEADER_BROADCAST_SPEED_PRESETS[value]
    ? value
    : DEFAULT_HEADER_BROADCAST_SPEED_PRESET;

export const getHeaderBroadcastSpeedDurations = (value) => {
  const preset = resolveHeaderBroadcastSpeedPreset(value);
  return HEADER_BROADCAST_SPEED_PRESETS[preset];
};

const normalizeSymbol = (symbol) => symbol?.trim?.().toUpperCase?.() || "";

const parseTimeMs = (value) => {
  if (!value) return 0;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

const normalizeDirection = (direction) => {
  const normalized = String(direction || "").trim().toLowerCase();
  return normalized === "buy" || normalized === "sell" ? normalized : "";
};

const upsertByKey = (itemsByKey, item) => {
  if (!item?.key) return;
  const existing = itemsByKey.get(item.key);
  if (!existing) {
    itemsByKey.set(item.key, item);
    return;
  }

  const existingPriority = existing.source === "state" ? 2 : 1;
  const itemPriority = item.source === "state" ? 2 : 1;
  if (
    itemPriority > existingPriority ||
    (itemPriority === existingPriority && item.timeMs > existing.timeMs)
  ) {
    itemsByKey.set(item.key, item);
  }
};

export const buildHeaderSignalTapeItems = (
  snapshot,
  {
    nowMs = Date.now(),
    maxItems = HEADER_SIGNAL_MAX_ITEMS,
    recentSignalMs = HEADER_RECENT_SIGNAL_MS,
  } = {},
) => {
  const itemsByKey = new Map();
  const cutoffMs = nowMs - recentSignalMs;

  (snapshot?.states || []).forEach((state) => {
    const symbol = normalizeSymbol(state?.symbol);
    const direction = normalizeDirection(state?.currentSignalDirection);
    if (!symbol || !direction || state?.active === false) return;

    const timeframe = state?.timeframe || "";
    const time = state?.currentSignalAt || state?.lastEvaluatedAt || "";
    const timeMs = parseTimeMs(time);
    if (timeMs && timeMs < cutoffMs) return;

    const key = [
      symbol,
      timeframe,
      direction,
      timeMs || state?.id || "current",
    ].join("|");

    upsertByKey(itemsByKey, {
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
      raw: state,
    });
  });

  (snapshot?.events || []).forEach((event) => {
    const symbol = normalizeSymbol(event?.symbol);
    const direction = normalizeDirection(event?.direction);
    if (!symbol || !direction) return;

    const time = event?.signalAt || event?.emittedAt || "";
    const timeMs = parseTimeMs(time);
    if (timeMs && timeMs < cutoffMs) return;

    const timeframe = event?.timeframe || "";
    const key = [
      symbol,
      timeframe,
      direction,
      timeMs || event?.id || "event",
    ].join("|");

    upsertByKey(itemsByKey, {
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
      raw: event,
    });
  });

  return Array.from(itemsByKey.values())
    .sort((left, right) => {
      if (left.timeMs !== right.timeMs) return right.timeMs - left.timeMs;
      if (left.fresh !== right.fresh) return left.fresh ? -1 : 1;
      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, maxItems);
};

const getFlowEventTime = (event) =>
  event?.occurredAt || event?.time || event?.timestamp || "";

const getFlowEventSymbol = (event) =>
  normalizeSymbol(event?.ticker || event?.underlying || event?.symbol);

const getFlowEventRight = (event) => {
  const right = String(event?.cp || event?.right || "").trim().toUpperCase();
  if (right === "C" || right === "CALL") return "C";
  if (right === "P" || right === "PUT") return "P";
  return right;
};

export const buildHeaderUnusualTapeItems = (
  events = [],
  { maxItems = HEADER_UNUSUAL_MAX_ITEMS } = {},
) => {
  const itemsByKey = new Map();

  (events || []).forEach((event) => {
    const symbol = getFlowEventSymbol(event);
    if (!symbol) return;

    const score = Number(event?.unusualScore ?? event?.score ?? 0);

    const time = getFlowEventTime(event);
    const timeMs = parseTimeMs(time);
    const right = getFlowEventRight(event);
    const optionKey =
      event?.optionTicker ||
      [event?.strike, right, event?.expirationDate || event?.exp].join("-");
    const key =
      event?.id ||
      [symbol, optionKey, timeMs || time || "flow", event?.premium || ""].join("|");
    const premium = Number(event?.premium ?? 0);

    if (!itemsByKey.has(key)) {
      itemsByKey.set(key, {
        id: `unusual-${key}`,
        key,
        kind: "unusual",
        symbol,
        right,
        side: event?.side || "",
        sentiment: event?.sentiment || "",
        contract: event?.contract || "",
        strike: event?.strike ?? null,
        expirationDate: event?.expirationDate || event?.exp || "",
        premium: Number.isFinite(premium) ? premium : 0,
        size: event?.vol ?? event?.size ?? null,
        openInterest: event?.oi ?? event?.openInterest ?? null,
        dte: event?.dte ?? null,
        score: Number.isFinite(score) ? score : 0,
        time,
        timeMs,
        raw: event,
      });
    }
  });

  return Array.from(itemsByKey.values())
    .sort((left, right) => {
      if (left.timeMs !== right.timeMs) return right.timeMs - left.timeMs;
      if (left.score !== right.score) return right.score - left.score;
      if (left.premium !== right.premium) return right.premium - left.premium;
      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, maxItems);
};
