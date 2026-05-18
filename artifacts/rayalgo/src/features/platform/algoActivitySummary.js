const SIGNAL_KEY = (signal) =>
  `${signal?.symbol || ""}:${signal?.timeframe || ""}`;

const signalStateOf = (signal) => {
  if (!signal) return "unavailable";
  if (signal.status === "unavailable") return "unavailable";
  if (signal.status === "error") return "error";
  if (signal.fresh === true) return "fresh";
  if (signal.fresh === false) return "stale";
  return "unknown";
};

const indexSignals = (signals = []) => {
  const map = new Map();
  for (const signal of signals) {
    const key = SIGNAL_KEY(signal);
    if (!key.startsWith(":")) map.set(key, signal);
  }
  return map;
};

const directionGlyph = (direction) => {
  if (direction === "buy" || direction === "long") return "↑";
  if (direction === "sell" || direction === "short") return "↓";
  return "·";
};

const timeMs = (value) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatHm = (ms) => {
  if (!ms) return "";
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

const newlyFreshSignals = (prevSignals, nextSignals) => {
  const prevMap = indexSignals(prevSignals);
  const result = [];
  for (const next of nextSignals || []) {
    const key = SIGNAL_KEY(next);
    if (key.startsWith(":")) continue;
    const prev = prevMap.get(key);
    if (signalStateOf(next) !== "fresh") continue;
    const prevState = signalStateOf(prev);
    if (prevState === "fresh") continue;
    result.push({
      symbol: next.symbol,
      direction: next.direction,
    });
  }
  return result;
};

const EVENT_FILL = new Set(["signal_options_entry"]);
const EVENT_BLOCK = new Set([
  "signal_options_skipped",
  "signal_options_blocked",
  "signal_options_gateway_blocked",
]);
const EVENT_EXIT = new Set(["signal_options_exit"]);

const eventsBetween = (events, fromMs) =>
  (events || []).filter((event) => timeMs(event?.occurredAt) >= fromMs);

const summariseEventCounts = (events, fromMs) => {
  const window = eventsBetween(events, fromMs);
  const fills = window.filter((event) => EVENT_FILL.has(event.eventType));
  const blocks = window.filter((event) => EVENT_BLOCK.has(event.eventType));
  const exits = window.filter((event) => EVENT_EXIT.has(event.eventType));
  return { fills, blocks, exits };
};

const sampleSymbols = (items, limit = 3) => {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const symbol = String(item?.symbol || "").toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
};

const profitFactorDelta = (prevPerf, nextPerf) => {
  const prev = Number(prevPerf?.profitFactor);
  const next = Number(nextPerf?.profitFactor);
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return null;
  return next - prev;
};

const formatSignalList = (signals) =>
  signals
    .map((signal) => `${String(signal.symbol).toUpperCase()} ${directionGlyph(signal.direction)}`)
    .join(", ");

const formatBlockList = (events) =>
  events
    .map((event) => {
      const symbol = String(event.symbol || "").toUpperCase();
      const reason = String(event.summary || event.eventType || "")
        .split("—")
        .pop()
        .trim()
        .toLowerCase();
      const short =
        reason.includes("liquidity") || reason.includes("spread")
          ? "liquidity"
          : reason.includes("budget") || reason.includes("premium")
            ? "budget"
            : reason.includes("regime") || reason.includes("mtf")
              ? "regime"
              : null;
      return short ? `${symbol} — ${short}` : symbol;
    })
    .join(", ");

export const summarizeCockpitDelta = ({
  prevSnapshot = null,
  nextSnapshot = null,
  recentEvents = [],
  prevPerformance = null,
  nextPerformance = null,
  nowMs = Date.now(),
} = {}) => {
  const segments = [];
  const fromMs = timeMs(prevSnapshot?.evaluatedAt) || nowMs - 60_000;
  segments.push({
    kind: "prefix",
    tone: "muted",
    text: `Since ${formatHm(fromMs)}:`,
  });

  if (!prevSnapshot && nextSnapshot) {
    const totalFresh = (nextSnapshot.signals || []).filter(
      (signal) => signalStateOf(signal) === "fresh",
    ).length;
    segments.push({
      kind: "fresh",
      tone: "green",
      text: `tracking ${totalFresh} fresh signal${totalFresh === 1 ? "" : "s"}`,
    });
    return {
      asOfMs: nowMs,
      sentence: segments.map((segment) => segment.text).join(" "),
      segments,
    };
  }

  if (nextSnapshot) {
    const freshNew = newlyFreshSignals(
      prevSnapshot?.signals || [],
      nextSnapshot.signals || [],
    );
    if (freshNew.length > 0) {
      const sample = sampleSymbols(freshNew, 3);
      segments.push({
        kind: "freshSignals",
        tone: "green",
        count: freshNew.length,
        text: `${freshNew.length} new fresh signal${freshNew.length === 1 ? "" : "s"} (${formatSignalList(sample)})`,
      });
    }
  }

  const counts = summariseEventCounts(recentEvents, fromMs);
  if (counts.blocks.length > 0) {
    const sample = sampleSymbols(counts.blocks, 2);
    segments.push({
      kind: "blocked",
      tone: "amber",
      count: counts.blocks.length,
      text: `${counts.blocks.length} blocked (${formatBlockList(sample)})`,
    });
  }
  if (counts.fills.length > 0) {
    const sample = sampleSymbols(counts.fills, 3);
    segments.push({
      kind: "fills",
      tone: "green",
      count: counts.fills.length,
      text: `${counts.fills.length} fill${counts.fills.length === 1 ? "" : "s"} (${sample.map((event) => String(event.symbol || "").toUpperCase()).join(", ")})`,
    });
  }
  if (counts.exits.length > 0) {
    segments.push({
      kind: "exits",
      tone: "cyan",
      count: counts.exits.length,
      text: `${counts.exits.length} exit${counts.exits.length === 1 ? "" : "s"}`,
    });
  }

  const pfDelta = profitFactorDelta(prevPerformance, nextPerformance);
  if (pfDelta != null && Math.abs(pfDelta) >= 0.01) {
    const tone = pfDelta >= 0 ? "green" : "red";
    const sign = pfDelta >= 0 ? "up" : "down";
    segments.push({
      kind: "profitFactor",
      tone,
      delta: pfDelta,
      text: `profit factor ${sign} ${Math.abs(pfDelta).toFixed(2)}`,
    });
  }

  if (segments.length === 1) {
    segments.push({ kind: "noop", tone: "dim", text: "no change" });
  }

  return {
    asOfMs: nowMs,
    sentence: segments.map((segment) => segment.text).join(" · "),
    segments,
  };
};

export const __internalsForTests = {
  newlyFreshSignals,
  summariseEventCounts,
  profitFactorDelta,
  formatBlockList,
};
