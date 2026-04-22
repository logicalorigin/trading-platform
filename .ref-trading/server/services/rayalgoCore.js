import { normalizeRayAlgoSettings } from "../../src/research/config/rayalgoSettings.js";
import { normalizeRayAlgoScoringConfig } from "../../src/research/engine/rayalgoScoring.js";
import {
  buildSignalOverlayTape,
  detectRegimes,
} from "../../src/research/engine/runtime.js";
import { buildResearchBarFromEpochMs } from "../../src/research/market/time.js";

const DEFAULT_MIN_CONVICTION = 0.4;
const DEFAULT_COOLDOWN_BARS = 1;

export const RAYALGO_EVENT_TYPE_SIGNAL = "signal";
export const RAYALGO_EVENT_TYPE_TREND_CHANGE = "trend_change";

const COMPONENT_KEYS = [
  "emaCross",
  "bosRecent",
  "chochRecent",
  "obDir",
  "sweepDir",
  "bandTrend",
  "bandRetest",
];

export function normalizeRayAlgoEventType(value, fallback = null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (
    normalized === "signal_fire"
    || normalized === "trend_change"
    || normalized === "trend-change"
    || normalized === "trendchange"
  ) {
    return RAYALGO_EVENT_TYPE_TREND_CHANGE;
  }
  if (normalized === "signal" || normalized === "trigger" || normalized === "flip") {
    return RAYALGO_EVENT_TYPE_SIGNAL;
  }
  if (normalized === "entry_long" || normalized === "entry_short" || normalized === "entry") {
    return "entry";
  }
  if (
    normalized === "exit"
    || normalized === "close"
    || normalized === "take_profit"
    || normalized === "stop_loss"
    || normalized === "tp"
    || normalized === "sl"
  ) {
    return "exit";
  }
  if (
    normalized === "heartbeat"
    || normalized === "status"
    || normalized === "debug"
    || normalized === "info"
  ) {
    return normalized;
  }
  return normalized;
}

export function normalizeRayAlgoSignalClass(value, fallback = null) {
  const normalizedEventType = normalizeRayAlgoEventType(value, null);
  if (normalizedEventType === RAYALGO_EVENT_TYPE_TREND_CHANGE) {
    return normalizedEventType;
  }
  return fallback;
}

export function generateRayAlgoSignals(options = {}) {
  const {
    bars = [],
    symbol = "SPY",
    timeframe = "5",
    source = "local",
    minConviction = DEFAULT_MIN_CONVICTION,
    cooldownBars = DEFAULT_COOLDOWN_BARS,
    startAfterMs = null,
    rayalgoSettings = null,
    rayalgoScoringConfig = null,
  } = options;

  const normalizedBars = normalizeBars(bars);
  if (normalizedBars.length < 30) {
    return [];
  }

  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedTimeframe = normalizeTimeframe(timeframe);
  const signalTimeframe = toSignalTimeframe(normalizedTimeframe);
  const tfMin = timeframeToTfMinutes(normalizedTimeframe);
  const regimes = detectRegimes(normalizedBars);
  const tape = buildSignalOverlayTape(normalizedBars, regimes, {
    strategy: "rayalgo",
    tfMin,
    executionBars: normalizedBars,
    signalTimeframe,
    rayalgoSettings: normalizeRayAlgoSettings(rayalgoSettings || {}),
    rayalgoScoringConfig: normalizeRayAlgoScoringConfig({
      activeTimeframe: signalTimeframe,
      marketSymbol: extractMarketSymbol(normalizedSymbol),
      ...(rayalgoScoringConfig || {}),
    }),
  });

  const barIndexByTs = new Map(
    normalizedBars.map((bar, index) => [String(bar?.ts || "").trim(), index]),
  );
  const barsByTs = new Map(
    normalizedBars.map((bar) => [String(bar?.ts || "").trim(), bar]),
  );
  const cooldown = Math.max(0, Math.round(Number(cooldownBars) || 0));
  const minimumConviction = Math.max(0, Math.min(1, Number(minConviction || DEFAULT_MIN_CONVICTION)));
  const lastSignalIndexByKey = new Map();

  return (Array.isArray(tape?.events) ? tape.events : [])
    .filter((event) => isRayAlgoSignalEvent(event))
    .slice()
    .sort((left, right) => normalizeTimestamp(left?.signalTs || left?.ts) - normalizeTimestamp(right?.signalTs || right?.ts))
    .map((event) => buildLocalSignalPayload({
      event,
      source,
      symbol: normalizedSymbol,
      timeframe: normalizedTimeframe,
      barIndexByTs,
      barsByTs,
    }))
    .filter(Boolean)
    .filter((signal) => {
      const signalTimeMs = normalizeTimestamp(signal.ts);
      if (Number.isFinite(startAfterMs) && signalTimeMs <= Number(startAfterMs)) {
        return false;
      }
      if (!Number.isFinite(Number(signal.conviction)) || Number(signal.conviction) < minimumConviction) {
        return false;
      }
      const signalClass = normalizeRayAlgoSignalClass(signal.signalClass || signal.eventType, RAYALGO_EVENT_TYPE_TREND_CHANGE);
      const cooldownKey = `${signalClass}:${signal.direction || "buy"}`;
      const currentBarIndex = Number(signal.meta?.barIndex);
      if (Number.isFinite(currentBarIndex)) {
        const lastBarIndex = lastSignalIndexByKey.get(cooldownKey);
        if (Number.isFinite(lastBarIndex) && currentBarIndex - lastBarIndex <= cooldown) {
          return false;
        }
        lastSignalIndexByKey.set(cooldownKey, currentBarIndex);
      }
      return true;
    });
}

export function normalizeRayAlgoSignalPayload(payload, fallback = {}) {
  const source = normalizeSource(payload?.source || fallback.source || "local");
  const strategy = String(payload?.strategy || "rayalgo").toLowerCase();
  const symbol = normalizeSymbol(payload?.symbol || fallback.symbol || "SPY");
  const timeframe = normalizeTimeframe(payload?.timeframe || fallback.timeframe || "5");
  const direction = normalizeDirection(payload?.direction || payload?.action || payload?.side);
  const timestamp = normalizeTimestamp(
    payload?.ts || payload?.barTime || payload?.time || payload?.receivedAt,
  );
  if (!direction || !timestamp) {
    return null;
  }

  const rawEventType = normalizeRayAlgoEventType(
    payload?.eventType || payload?.type || payload?.meta?.eventType || fallback.eventType || null,
    null,
  );
  const signalClass = normalizeRayAlgoSignalClass(
    payload?.signalClass || payload?.meta?.signalClass || rawEventType || fallback.signalClass || null,
    null,
  );
  const eventType = rawEventType || signalClass || RAYALGO_EVENT_TYPE_SIGNAL;
  const components = payload?.components && typeof payload.components === "object"
    ? payload.components
    : {};
  const conviction = toFinite(payload?.conviction, null);

  return {
    signalId:
      nonEmptyString(payload?.signalId)
      || buildSignalId({
        source,
        symbol,
        timeframe,
        time: timestamp,
        direction,
        signalClass,
        eventType,
      }),
    source,
    strategy,
    symbol,
    timeframe,
    eventType,
    signalClass,
    ts: new Date(timestamp).toISOString(),
    barTime: new Date(timestamp).toISOString(),
    direction,
    price: toFinite(payload?.price, null),
    conviction: conviction != null ? round6(conviction) : null,
    regime: normalizeRegime(payload?.regime),
    components: Object.fromEntries(
      COMPONENT_KEYS.map((key) => [key, normalizeSigned(components[key])]),
    ),
    meta: payload?.meta && typeof payload.meta === "object" ? payload.meta : {},
  };
}

function normalizeBars(bars = []) {
  return (Array.isArray(bars) ? bars : [])
    .map((row) => {
      const time = normalizeTimestamp(row?.time ?? row?.ts ?? row?.t);
      const open = toFinite(row?.open ?? row?.o, null);
      const high = toFinite(row?.high ?? row?.h, null);
      const low = toFinite(row?.low ?? row?.l, null);
      const close = toFinite(row?.close ?? row?.c, null);
      if (
        !Number.isFinite(time)
        || !Number.isFinite(open)
        || !Number.isFinite(high)
        || !Number.isFinite(low)
        || !Number.isFinite(close)
      ) {
        return null;
      }
      const volume = Math.max(
        0,
        Math.round(toFinite(row?.volume ?? row?.v ?? row?.totalVolume, 0) || 0),
      );
      const vix = toFinite(row?.vix, 17.0);
      return buildResearchBarFromEpochMs(time, {
        o: open,
        h: high,
        l: low,
        c: close,
        v: volume,
        vix: Number.isFinite(vix) ? vix : 17.0,
      });
    })
    .filter(Boolean)
    .sort((left, right) => Number(left?.time || 0) - Number(right?.time || 0));
}

function isRayAlgoSignalEvent(event) {
  if (String(event?.strategy || "").trim().toLowerCase() !== "rayalgo") {
    return false;
  }
  const signalClass = normalizeRayAlgoSignalClass(event?.signalClass || event?.eventType || null, null);
  return signalClass === RAYALGO_EVENT_TYPE_TREND_CHANGE;
}

function buildLocalSignalPayload({ event, source, symbol, timeframe, barIndexByTs, barsByTs }) {
  const signalTs = String(event?.signalTs || event?.ts || "").trim();
  const signalTimeMs = normalizeTimestamp(signalTs);
  const signalClass = normalizeRayAlgoSignalClass(
    event?.signalClass || event?.eventType,
    RAYALGO_EVENT_TYPE_TREND_CHANGE,
  );
  if (!signalTs || !Number.isFinite(signalTimeMs)) {
    return null;
  }

  const direction = String(event?.direction || "").trim().toLowerCase() === "short"
    ? "sell"
    : "buy";
  const sourceBar = barsByTs?.get(signalTs) || null;
  const components = event?.meta?.components && typeof event.meta.components === "object"
    ? event.meta.components
    : {};

  return normalizeRayAlgoSignalPayload({
    signalId: buildSignalId({
      source,
      symbol,
      timeframe,
      time: signalTimeMs,
      direction,
      signalClass,
      eventType: signalClass,
    }),
    source,
    strategy: "rayalgo",
    symbol,
    timeframe,
    eventType: signalClass,
    signalClass,
    ts: signalTimeMs,
    barTime: signalTimeMs,
    direction,
    price: toFinite(event?.price, toFinite(sourceBar?.c, null)),
    conviction: toFinite(event?.conviction ?? event?.rawScore ?? event?.score, null),
    regime: event?.meta?.regime || null,
    components,
    meta: {
      ...(event?.meta && typeof event.meta === "object" ? event.meta : {}),
      barIndex: barIndexByTs.get(signalTs) ?? null,
      rawEventType: String(event?.eventType || "").trim() || null,
      signalClass,
      displayText: String(event?.displayText || "").trim() || null,
      rawScore: toFinite(event?.rawScore, null),
      score: toFinite(event?.score, null),
      effectiveScore: toFinite(event?.effectiveScore ?? event?.meta?.effectiveScore ?? event?.meta?.scoring?.effectiveScore, null),
      effectiveScoreMode: nonEmptyString(event?.effectiveScoreMode || event?.meta?.effectiveScoreMode || event?.meta?.scoring?.effectiveScoreMode),
      precursorBonus: toFinite(event?.precursorBonus, null),
      signalRole: nonEmptyString(event?.signalRole || event?.meta?.scoring?.signalRole),
      scoringVersion: nonEmptyString(event?.scoringVersion),
      executionProfile: nonEmptyString(event?.executionProfile),
    },
  });
}

function buildSignalId({ source, symbol, timeframe, time, direction, signalClass = null, eventType = null }) {
  const typeKey = normalizeRayAlgoSignalClass(signalClass || eventType || null, null)
    || normalizeRayAlgoEventType(eventType || null, RAYALGO_EVENT_TYPE_SIGNAL);
  return [
    normalizeSource(source),
    normalizeSymbol(symbol),
    normalizeTimeframe(timeframe),
    Number(time),
    normalizeDirection(direction) || "unknown",
    typeKey,
  ].join(":");
}

function normalizeTimestamp(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 100000000000 ? Math.trunc(value) : Math.trunc(value * 1000);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 100000000000 ? Math.trunc(numeric) : Math.trunc(numeric * 1000);
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  return null;
}

function normalizeSource(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "pine" || text === "local") {
    return text;
  }
  return "local";
}

function normalizeDirection(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.startsWith("b")) return "buy";
  if (text.startsWith("s")) return "sell";
  if (text === "long") return "buy";
  if (text === "short") return "sell";
  return null;
}

function normalizeRegime(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "bull" || text === "bear" || text === "range") {
    return text;
  }
  return "unknown";
}

function normalizeTimeframe(value) {
  const text = String(value || "5").trim().toUpperCase();
  if (text === "D" || text === "1D") return "1D";
  if (text === "W" || text === "1W") return "1W";
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return String(Math.round(numeric));
  }
  return "5";
}

function toSignalTimeframe(timeframe) {
  const normalized = normalizeTimeframe(timeframe);
  if (normalized === "1D") return "D";
  if (normalized === "1W") return "W";
  return `${normalized}m`;
}

function timeframeToTfMinutes(timeframe) {
  const normalized = normalizeTimeframe(timeframe);
  if (normalized === "1D") return 390;
  if (normalized === "1W") return 1950;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 5;
}

function normalizeSymbol(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) {
    return "AMEX:SPY";
  }
  if (raw.includes(":")) {
    return raw;
  }
  return `AMEX:${raw}`;
}

function extractMarketSymbol(value) {
  return normalizeSymbol(value).split(":").pop() || "SPY";
}

function normalizeSigned(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 0) return 1;
    if (numeric < 0) return -1;
    return 0;
  }
  const text = String(value || "").trim().toLowerCase();
  if (!text) return 0;
  if (text === "buy" || text === "long" || text === "bull" || text === "up" || text === "true") {
    return 1;
  }
  if (text === "sell" || text === "short" || text === "bear" || text === "down" || text === "false") {
    return -1;
  }
  return 0;
}

function round6(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function toFinite(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric;
}

function nonEmptyString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}
