export const EMPTY_SIGNAL_EVENTS = Object.freeze([]);

const DEFAULT_ACTIVE_SIGNAL_STATUSES = new Set([
  "active-fresh",
  "active-idle",
  "active-stale",
]);

export const defaultSignalSparklineColorForDirection = (direction) =>
  direction === "buy"
    ? "var(--ra-blue-500)"
    : direction === "sell"
      ? "var(--ra-red-500)"
      : null;

// Stroke for signal sparklines while signal state has not hydrated yet. At
// launch, quotes/spark bars stream in seconds before the signal matrix and
// signal events; during that window the color pipeline yields null and
// MicroSparkline would fall back to its financial green/red trend default —
// a fabricated signal reading on a signal-mapped surface. Muted says "signal
// unknown" honestly until real signal state arrives.
export const SIGNAL_SPARKLINE_PENDING_COLOR = "var(--ra-text-muted)";

export const resolveSignalSparklineFallbackColor = ({
  signalColor = null,
  signalStateHydrated = false,
}) =>
  signalColor ?? (signalStateHydrated ? null : SIGNAL_SPARKLINE_PENDING_COLOR);

export const isSignalSparklineDirection = (value) =>
  value === "buy" || value === "sell";

export const signalSparklineTimestampMs = (value) => {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    }
  }
  return null;
};

const normalizeSignalSparklineSymbol = (value) =>
  String(value || "").trim().toUpperCase();

export const buildSignalEventsBySymbol = (events = []) => {
  const bySymbol = new Map();
  (Array.isArray(events) ? events : []).forEach((event, order) => {
    const symbol = normalizeSignalSparklineSymbol(event?.symbol);
    const direction = String(event?.direction || "").toLowerCase();
    const ms = signalSparklineTimestampMs(event?.signalAt || event?.emittedAt);
    if (!symbol || !isSignalSparklineDirection(direction) || ms == null) {
      return;
    }
    const entries = bySymbol.get(symbol) || [];
    entries.push({
      direction,
      ms,
      timeframe: String(event?.timeframe || "").trim(),
      order,
    });
    bySymbol.set(symbol, entries);
  });
  bySymbol.forEach((entries) => {
    entries.sort((left, right) => left.ms - right.ms || left.order - right.order);
  });
  return bySymbol;
};

export const buildSignalSparklinePointColors = ({
  points,
  row,
  signalEvents = EMPTY_SIGNAL_EVENTS,
  activeStatuses = DEFAULT_ACTIVE_SIGNAL_STATUSES,
  signalColorForDirection = defaultSignalSparklineColorForDirection,
  colorTimeframe = null,
}) => {
  const sparklinePoints = Array.isArray(points) ? points : [];
  if (sparklinePoints.length < 2) {
    return null;
  }

  // When the caller passes the algo's traded execution timeframe, color by
  // THAT signal's transitions (unified across STA + watchlist); otherwise fall
  // back to the row's own timeframe (legacy per-row behavior).
  const rowTimeframe = String(row?.timeframe || row?.profileTimeframe || "").trim();
  const tradedTimeframe = String(colorTimeframe || "").trim();
  const filterTimeframe = tradedTimeframe || rowTimeframe;
  const transitions = (Array.isArray(signalEvents) ? signalEvents : [])
    .filter((event) => {
      if (!filterTimeframe || !event.timeframe) return true;
      return event.timeframe === filterTimeframe;
    })
    .map((event) => ({
      direction: event.direction,
      ms: event.ms,
      order: event.order,
    }));
  const rowSignalDirection = row?.direction;
  const rowSignalMs = signalSparklineTimestampMs(row?.currentSignalAt);
  // The row's latched signal only belongs on the timeline when it is the same
  // timeframe we're coloring by; otherwise it would inject a transition from a
  // different timeframe than the traded signal.
  const rowMatchesColorTimeframe =
    !tradedTimeframe || !rowTimeframe || rowTimeframe === tradedTimeframe;
  const rowSignalIsAuthoritative =
    rowMatchesColorTimeframe &&
    activeStatuses.has(row?.status) &&
    isSignalSparklineDirection(rowSignalDirection) &&
    rowSignalMs != null;
  if (rowSignalIsAuthoritative) {
    for (let index = transitions.length - 1; index >= 0; index -= 1) {
      const transition = transitions[index];
      if (
        transition.ms < rowSignalMs ||
        transition.direction !== rowSignalDirection
      ) {
        transitions.splice(index, 1);
      }
    }
    transitions.push({
      direction: rowSignalDirection,
      ms: rowSignalMs,
      order: Number.MAX_SAFE_INTEGER,
    });
  }

  if (!transitions.length) {
    return null;
  }
  transitions.sort((left, right) => left.ms - right.ms || left.order - right.order);
  // Sparklines are never neutral: every point is buy or sell. Before the first
  // known signal we show the opposite stance, so a lone signal still flips color
  // at the moment it fired (e.g. red→blue on a buy).
  const oppositeSignalDirection = (direction) =>
    direction === "buy" ? "sell" : direction === "sell" ? "buy" : direction;
  const preSignalColor = signalColorForDirection(
    oppositeSignalDirection(transitions[0]?.direction),
  );
  const latestSignalColor = signalColorForDirection(transitions.at(-1)?.direction);
  if (!sparklinePoints.some((point) => point.ms != null)) {
    return latestSignalColor
      ? sparklinePoints.map(() => latestSignalColor)
      : null;
  }

  let transitionIndex = -1;
  return sparklinePoints.map((point) => {
    if (point.ms == null) {
      return transitionIndex >= 0
        ? signalColorForDirection(transitions[transitionIndex]?.direction)
        : preSignalColor;
    }
    while (
      transitionIndex + 1 < transitions.length &&
      transitions[transitionIndex + 1].ms <= point.ms
    ) {
      transitionIndex += 1;
    }
    return transitionIndex >= 0
      ? signalColorForDirection(transitions[transitionIndex]?.direction)
      : preSignalColor;
  });
};
