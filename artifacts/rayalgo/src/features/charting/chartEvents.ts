export type ChartEventType = "unusual_flow" | "earnings";
export type ChartEventPlacement = "bar" | "timescale";
export type ChartEventSeverity = "low" | "medium" | "high" | "extreme";
export type ChartEventBias = "bullish" | "bearish" | "neutral";

export type ChartEventAction =
  | "open_flow"
  | "open_trade"
  | "copy_contract"
  | "add_alert";

export type ChartEvent = {
  id: string;
  symbol: string;
  eventType: ChartEventType;
  time: string;
  placement: ChartEventPlacement;
  severity: ChartEventSeverity;
  label: string;
  summary: string;
  source: string;
  confidence: number;
  bias: ChartEventBias;
  actions: ChartEventAction[];
  metadata: Record<string, unknown>;
};

export type ChartEventCluster = {
  id: string;
  symbol: string;
  time: string;
  eventType: ChartEventType;
  count: number;
  bias: ChartEventBias;
  severity: ChartEventSeverity;
  label: string;
  events: ChartEvent[];
};

type FlowEventBiasBasis =
  | "flow_bias"
  | "side"
  | "call_put_fallback"
  | "sentiment"
  | "neutral";

type FlowEventBiasDecision = {
  bias: ChartEventBias;
  basis: FlowEventBiasBasis;
};

export type FlowChartEventConversion = {
  events: ChartEvent[];
  rawInputCount: number;
  flowRecordCount: number;
  convertedEventCount: number;
  droppedInvalidTimeCount: number;
  droppedSymbolCount: number;
};

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const severityRank: Record<ChartEventSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  extreme: 3,
};

const maxSeverity = (events: ChartEvent[]): ChartEventSeverity =>
  events.reduce<ChartEventSeverity>(
    (best, event) =>
      severityRank[event.severity] > severityRank[best] ? event.severity : best,
    "low",
  );

export const resolveFlowSeverity = ({
  premium,
  unusualScore,
}: {
  premium?: number | null;
  unusualScore?: number | null;
}): ChartEventSeverity => {
  const resolvedPremium = finiteNumber(premium) ?? 0;
  const resolvedUnusualScore = finiteNumber(unusualScore) ?? 0;
  if (resolvedPremium >= 1_000_000 || resolvedUnusualScore >= 5) {
    return "extreme";
  }
  if (resolvedPremium >= 500_000 || resolvedUnusualScore >= 2.5) {
    return "high";
  }
  if (resolvedPremium >= 150_000 || resolvedUnusualScore >= 1) {
    return "medium";
  }
  return "low";
};

const compactPremium = (value: unknown): string => {
  const premium = finiteNumber(value) ?? 0;
  if (premium >= 1_000_000) return `$${(premium / 1_000_000).toFixed(1)}M`;
  if (premium >= 1_000) return `$${Math.round(premium / 1_000)}K`;
  return `$${Math.round(premium)}`;
};

const normalizeBiasValue = (value: unknown): ChartEventBias | null => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bullish" || normalized === "bull") return "bullish";
  if (normalized === "bearish" || normalized === "bear") return "bearish";
  if (normalized === "neutral" || normalized === "mixed") return "neutral";
  return null;
};

const normalizeSide = (value: unknown): "buy" | "sell" | "mid" | "" => {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "buy" ||
    normalized === "bought" ||
    normalized === "ask" ||
    normalized === "at_ask" ||
    normalized === "above_ask" ||
    normalized === "lift" ||
    normalized === "lifted"
  ) {
    return "buy";
  }
  if (
    normalized === "sell" ||
    normalized === "sold" ||
    normalized === "bid" ||
    normalized === "at_bid" ||
    normalized === "below_bid" ||
    normalized === "hit" ||
    normalized === "hit_bid"
  ) {
    return "sell";
  }
  if (normalized === "mid" || normalized === "middle" || normalized === "between") {
    return "mid";
  }
  return "";
};

const normalizeBias = ({
  value,
  right,
  side,
}: {
  value: unknown;
  right: unknown;
  side: unknown;
}): ChartEventBias => {
  const explicit = normalizeBiasValue(value);
  if (explicit) return explicit;

  const normalizedRight = normalizeRight(right);
  const normalizedSide = normalizeSide(side);
  if (normalizedSide === "buy" && normalizedRight === "call") return "bullish";
  if (normalizedSide === "sell" && normalizedRight === "put") return "bullish";
  if (normalizedSide === "buy" && normalizedRight === "put") return "bearish";
  if (normalizedSide === "sell" && normalizedRight === "call") return "bearish";
  return "neutral";
};

const canTrustFlowEventSide = (sideBasis: unknown): boolean => {
  const normalized = String(sideBasis || "").trim().toLowerCase();
  return (
    !normalized ||
    normalized === "quote_match" ||
    normalized === "tick_test"
  );
};

const resolveRightBiasFallback = (right: unknown): ChartEventBias => {
  const normalizedRight = normalizeRight(right);
  if (normalizedRight === "call") return "bullish";
  if (normalizedRight === "put") return "bearish";
  return "neutral";
};

const resolveFlowEventBiasDecision = (
  event: Record<string, unknown>,
): FlowEventBiasDecision => {
  const explicitFlowBias = normalizeBiasValue(event.flowBias);
  if (explicitFlowBias && explicitFlowBias !== "neutral") {
    return { bias: explicitFlowBias, basis: "flow_bias" };
  }

  const sideBias = normalizeBias({
    value: null,
    right: event.cp || event.right,
    side: event.side,
  });
  if (canTrustFlowEventSide(event.sideBasis) && sideBias !== "neutral") {
    return { bias: sideBias, basis: "side" };
  }

  const rightBias = resolveRightBiasFallback(event.cp || event.right);
  if (rightBias !== "neutral") {
    return { bias: rightBias, basis: "call_put_fallback" };
  }

  const sentiment = normalizeBiasValue(event.sentiment);
  if (sentiment && sentiment !== "neutral") {
    return { bias: sentiment, basis: "sentiment" };
  }

  return { bias: explicitFlowBias || sentiment || "neutral", basis: "neutral" };
};

const readChartEventPremium = (event: ChartEvent): number =>
  Math.max(0, finiteNumber(event.metadata?.premium) ?? 0);

const isCallPutFallbackChartEvent = (event: ChartEvent): boolean =>
  String(event.metadata?.biasBasis || "").trim().toLowerCase() ===
  "call_put_fallback";

const resolveChartEventCollectionBias = (events: ChartEvent[]): ChartEventBias => {
  let bullishPremium = 0;
  let bearishPremium = 0;
  let callPremium = 0;
  let putPremium = 0;
  let bullishCount = 0;
  let bearishCount = 0;

  events.forEach((event) => {
    const premium = readChartEventPremium(event);
    const right = normalizeRight(event.metadata?.cp || event.metadata?.right);
    if (right === "call") callPremium += premium;
    if (right === "put") putPremium += premium;
    if (isCallPutFallbackChartEvent(event)) {
      return;
    }
    if (event.bias === "bullish") {
      bullishPremium += premium;
      bullishCount += 1;
    } else if (event.bias === "bearish") {
      bearishPremium += premium;
      bearishCount += 1;
    }
  });

  if (bullishPremium > bearishPremium) return "bullish";
  if (bearishPremium > bullishPremium) return "bearish";
  if (bullishCount > bearishCount) return "bullish";
  if (bearishCount > bullishCount) return "bearish";
  const callPutTotal = callPremium + putPremium;
  if (callPutTotal > 0) {
    if (callPremium / callPutTotal >= 0.7) return "bullish";
    if (putPremium / callPutTotal >= 0.7) return "bearish";
  }
  return "neutral";
};

const isFlowEventRecord = (event: unknown): event is Record<string, unknown> =>
  Boolean(event && typeof event === "object" && !Array.isArray(event));

const normalizeSymbol = (value: unknown): string =>
  String(value || "").trim().toUpperCase();

const normalizeProviderContractId = (value: unknown): string =>
  String(value || "").trim();

const normalizeOptionTicker = (value: unknown): string =>
  String(value || "").trim().toUpperCase();

const normalizeKeyPart = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase();

const normalizeNumericKeyPart = (value: unknown): string => {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[$,%\s,]/g, ""))
        : Number.NaN;
  return Number.isFinite(numeric) ? String(Number(numeric.toFixed(4))) : "";
};

const normalizeExpirationIso = (value: unknown): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    if (/^\d{8}$/.test(trimmed)) {
      return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
    }
  }
  const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
};

const normalizeRight = (value: unknown): "call" | "put" | "" => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "C" || normalized === "CALL") return "call";
  if (normalized === "P" || normalized === "PUT") return "put";
  return "";
};

const NEW_YORK_EVENT_WINDOW_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const RTH_OPEN_MINUTES = 9 * 60 + 30;
const INTRADAY_FLOW_SESSION_COUNT = 3;

type NewYorkEventWindowParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
  minutes: number;
};

const readNewYorkEventWindowParts = (
  date: Date,
): NewYorkEventWindowParts | null => {
  const parts = NEW_YORK_EVENT_WINDOW_FORMATTER.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }
  return {
    year,
    month,
    day,
    weekday: read("weekday"),
    minutes: hour * 60 + minute,
  };
};

const isWeekendEventWindowDay = (
  parts: Pick<NewYorkEventWindowParts, "weekday">,
): boolean => parts.weekday === "Sat" || parts.weekday === "Sun";

const newYorkEventWallTimeToUtcDate = (
  parts: Pick<NewYorkEventWindowParts, "year" | "month" | "day">,
  minutes: number,
): Date => {
  const expectedWallTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0,
  );
  const guess = new Date(expectedWallTime);
  const guessParts = readNewYorkEventWindowParts(guess);
  if (!guessParts) {
    return guess;
  }
  const actualWallTime = Date.UTC(
    guessParts.year,
    guessParts.month - 1,
    guessParts.day,
    Math.floor(guessParts.minutes / 60),
    guessParts.minutes % 60,
    0,
    0,
  );
  return new Date(guess.getTime() - (actualWallTime - expectedWallTime));
};

const intradayFlowLookbackStart = (now: Date): Date => {
  const currentParts = readNewYorkEventWindowParts(now);
  const cursor = currentParts
    ? new Date(
        Date.UTC(
          currentParts.year,
          currentParts.month - 1,
          currentParts.day,
          12,
          0,
          0,
          0,
        ),
      )
    : new Date(now);
  cursor.setUTCHours(12, 0, 0, 0);
  let oldest: NewYorkEventWindowParts | null = null;
  let sessions = 0;
  let guard = 0;

  while (sessions < INTRADAY_FLOW_SESSION_COUNT && guard < 14) {
    const parts = readNewYorkEventWindowParts(cursor);
    if (parts && !isWeekendEventWindowDay(parts)) {
      oldest = parts;
      sessions += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    guard += 1;
  }

  return oldest
    ? newYorkEventWallTimeToUtcDate(oldest, RTH_OPEN_MINUTES)
    : new Date(now.getTime() - 3 * 24 * 60 * 60 * 1_000);
};

const readFlowEventSymbol = (event: Record<string, unknown>): string =>
  normalizeSymbol(event.ticker || event.underlying || event.symbol);

export const isSnapshotFlowEvent = (event: Record<string, unknown>): boolean => {
  const sourceBasis = String(event.sourceBasis || event.confidence || "");
  return event.basis === "snapshot" || sourceBasis === "snapshot_activity";
};

const readDateCandidateIso = (candidate: unknown): string => {
  if (candidate instanceof Date && Number.isFinite(candidate.getTime())) {
    return candidate.toISOString();
  }
  if (typeof candidate === "number") {
    if (Number.isFinite(candidate) && candidate > 0) {
      const abs = Math.abs(candidate);
      const timestamp =
        abs >= 1e17
          ? candidate / 1e6
          : abs >= 1e14
            ? candidate / 1e3
            : abs >= 1e11
              ? candidate
              : candidate * 1000;
      const date = new Date(timestamp);
      if (Number.isFinite(date.getTime())) {
        return date.toISOString();
      }
    }
    return "";
  }
  if (typeof candidate !== "string") {
    return "";
  }
  const raw = String(candidate).trim();
  if (!raw) {
    return "";
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
};

const readFirstDateCandidateIso = (candidates: unknown[]): string => {
  for (const candidate of candidates) {
    const iso = readDateCandidateIso(candidate);
    if (iso) {
      return iso;
    }
  }
  return "";
};

const readFlowEventChartTime = (event: Record<string, unknown>): string => {
  const tradeTime = readFirstDateCandidateIso([
    event.occurredAt,
    event.sip_timestamp,
    event.participant_timestamp,
    event.trf_timestamp,
    event.exchange_timestamp,
    event.timestamp,
    event.dateTime,
    event.t,
  ]);
  if (tradeTime || !isSnapshotFlowEvent(event)) {
    return tradeTime;
  }

  return readFirstDateCandidateIso([
    event.updatedAt,
    event.createdAt,
    event.time,
  ]);
};

export const resolveFlowEventChartTimeMs = (
  event: Record<string, unknown>,
): number | null => {
  const parsed = Date.parse(readFlowEventChartTime(event));
  return Number.isFinite(parsed) ? parsed : null;
};

export const filterFlowEventsForChartLookbackWindow = (
  events: Array<Record<string, unknown>> = [],
  timeframe: string,
  {
    now = new Date(),
    keepNewest = 80,
  }: { now?: Date; keepNewest?: number } = {},
): Array<Record<string, unknown>> => {
  const input = Array.isArray(events) ? events : [];
  if (!input.length) {
    return [];
  }

  const window = getChartEventLookbackWindow(timeframe, now);
  const fromMs = window.from.getTime();
  const toMs = window.to.getTime();
  const timedEvents = input
    .map((event) => ({
      event,
      timeMs: resolveFlowEventChartTimeMs(event),
    }))
    .filter(
      (entry): entry is { event: Record<string, unknown>; timeMs: number } =>
        Number.isFinite(entry.timeMs),
    );
  const newestEvents = new Set(
    [...timedEvents]
      .sort((left, right) => right.timeMs - left.timeMs)
      .slice(0, Math.max(0, Math.floor(keepNewest)))
      .map((entry) => entry.event),
  );

  return timedEvents
    .filter(
      ({ event, timeMs }) =>
        (timeMs >= fromMs && timeMs <= toMs) || newestEvents.has(event),
    )
    .map((entry) => entry.event);
};

const getTradeFlowEventKey = (event: Record<string, unknown>): string =>
  String(
    event.id ||
      [
        readFlowEventSymbol(event),
        event.provider || "",
        event.basis || "",
        event.sourceBasis || "",
        event.providerContractId || event.optionTicker || "",
        event.strike ?? "",
        event.cp || event.right || "",
        event.expirationDate || event.exp || "",
        readFlowEventChartTime(event),
        event.side || "",
        event.price ?? "",
        event.size ?? event.vol ?? event.volume ?? "",
        event.premium ?? "",
      ].join("|"),
  );

const getTradeFlowPrintKey = (event: Record<string, unknown>): string => {
  if (isSnapshotFlowEvent(event)) return "";
  const symbol = readFlowEventSymbol(event);
  const occurredAt = readFlowEventChartTime(event);
  const optionTicker = normalizeOptionTicker(event.optionTicker);
  const expiration = normalizeExpirationIso(event.expirationDate || event.exp);
  const right = normalizeRight(event.cp || event.right);
  const strike = normalizeNumericKeyPart(event.strike);
  const contract =
    optionTicker ||
    [expiration, right, strike].filter(Boolean).join(":") ||
    normalizeProviderContractId(event.providerContractId) ||
    normalizeKeyPart(event.contract);
  if (!symbol || !occurredAt || !contract) return "";
  return [
    "print",
    symbol,
    contract,
    occurredAt,
    normalizeKeyPart(event.side),
    normalizeNumericKeyPart(event.price),
    normalizeNumericKeyPart(event.size ?? event.contracts ?? event.vol),
    normalizeNumericKeyPart(event.premium),
  ].join("|");
};

const sourceBasisRank = (event: Record<string, unknown>): number => {
  const basis = String(event.sourceBasis || event.confidence || "")
    .trim()
    .toLowerCase();
  if (basis === "confirmed_trade") return 3;
  if (basis === "snapshot_activity") return 2;
  if (basis === "fallback_estimate") return 1;
  return 0;
};

const getFlowEventBasisKey = (event: Record<string, unknown>): string => {
  if (isSnapshotFlowEvent(event)) return "snapshot_activity";
  const sourceBasis = String(event.sourceBasis || event.confidence || "")
    .trim()
    .toLowerCase();
  const basis = String(event.basis || "").trim().toLowerCase();
  if (sourceBasis === "confirmed_trade" || basis === "trade") {
    return "confirmed_trade";
  }
  if (sourceBasis === "fallback_estimate") return "fallback_estimate";
  return "other";
};

const getFlowEventMergeKeys = (event: Record<string, unknown>): string[] => {
  const stableKey = getStableFlowEventKey(event);
  const basis = getFlowEventBasisKey(event);
  const keys = [
    stableKey ? `${basis}|${stableKey}` : "",
    getTradeFlowPrintKey(event),
  ].filter(Boolean);
  return Array.from(new Set(keys));
};

const selectPreferredFlowEvent = (
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> => {
  if (isSnapshotFlowEvent(current) && isSnapshotFlowEvent(incoming)) {
    const currentTime = resolveFlowEventChartTimeMs(current) ?? 0;
    const incomingTime = resolveFlowEventChartTimeMs(incoming) ?? 0;
    return incomingTime >= currentTime ? incoming : current;
  }
  const currentRank = sourceBasisRank(current);
  const incomingRank = sourceBasisRank(incoming);
  return incomingRank > currentRank ? incoming : current;
};

export const getStableFlowEventKey = (event: Record<string, unknown>): string => {
  if (!isFlowEventRecord(event)) return "";
  if (!isSnapshotFlowEvent(event)) return getTradeFlowEventKey(event);

  const symbol = readFlowEventSymbol(event);
  const provider = normalizeKeyPart(event.provider || "flow");
  const observedDate = readFlowEventChartTime(event).slice(0, 10);
  const providerContractId = normalizeProviderContractId(event.providerContractId);
  const optionTicker = normalizeOptionTicker(event.optionTicker);
  const expiration = normalizeExpirationIso(event.expirationDate || event.exp);
  const right = normalizeRight(event.cp || event.right);
  const strike = normalizeNumericKeyPart(event.strike);

  let contractKey = "";
  if (providerContractId) {
    contractKey = `conid:${providerContractId}`;
  } else if (optionTicker) {
    contractKey = `ticker:${optionTicker}`;
  } else if (expiration && right && strike) {
    contractKey = `contract:${expiration}:${right}:${strike}`;
  } else if (event.id) {
    contractKey = `id:${normalizeKeyPart(event.id)}`;
  }

  return contractKey
    ? ["snapshot", provider, symbol, observedDate || "unknown-day", contractKey].join(
        "|",
      )
    : getTradeFlowEventKey(event);
};

export const mergeFlowEventFeeds = (
  ...feeds: Array<Array<Record<string, unknown>> | null | undefined>
): Array<Record<string, unknown>> => {
  const mergedEvents: Array<Record<string, unknown>> = [];
  const keyToIndex = new Map<string, number>();
  feeds.flat().forEach((event) => {
    if (!isFlowEventRecord(event)) return;
    const keys = getFlowEventMergeKeys(event);
    if (!keys.length) return;
    const existingIndex = keys
      .map((key) => keyToIndex.get(key))
      .find((index): index is number => typeof index === "number");
    if (existingIndex == null) {
      const nextIndex = mergedEvents.length;
      mergedEvents.push(event);
      keys.forEach((key) => keyToIndex.set(key, nextIndex));
      return;
    }
    const selected = selectPreferredFlowEvent(mergedEvents[existingIndex], event);
    mergedEvents[existingIndex] = selected;
    getFlowEventMergeKeys(selected).forEach((key) =>
      keyToIndex.set(key, existingIndex),
    );
    keys.forEach((key) => keyToIndex.set(key, existingIndex));
  });
  return mergedEvents;
};

export const filterFlowEventsForSymbol = (
  events: Array<Record<string, unknown>> = [],
  symbol?: string,
): Array<Record<string, unknown>> => {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return [];
  return (Array.isArray(events) ? events : []).filter(
    (event) => isFlowEventRecord(event) && readFlowEventSymbol(event) === normalizedSymbol,
  );
};

export const filterFlowEventsForOptionContract = (
  events: Array<Record<string, unknown>> = [],
  {
    symbol,
    providerContractId,
    optionTicker,
    expirationDate,
    right,
    strike,
  }: {
    symbol?: string | null;
    providerContractId?: string | null;
    optionTicker?: string | null;
    expirationDate?: string | Date | null;
    right?: string | null;
    strike?: number | null;
  } = {},
): Array<Record<string, unknown>> => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedProviderContractId = normalizeProviderContractId(providerContractId);
  const normalizedOptionTicker = String(optionTicker || "").trim().toUpperCase();
  const normalizedExpiration = normalizeExpirationIso(expirationDate);
  const normalizedRight = normalizeRight(right);
  const normalizedStrike = Number(strike);

  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!isFlowEventRecord(event)) return false;
    if (normalizedSymbol && readFlowEventSymbol(event) !== normalizedSymbol) {
      return false;
    }
    const eventProviderContractId = normalizeProviderContractId(
      event.providerContractId,
    );
    if (
      normalizedProviderContractId &&
      eventProviderContractId &&
      eventProviderContractId === normalizedProviderContractId
    ) {
      return true;
    }
    const eventOptionTicker = String(event.optionTicker || "").trim().toUpperCase();
    if (
      normalizedOptionTicker &&
      eventOptionTicker &&
      eventOptionTicker === normalizedOptionTicker
    ) {
      return true;
    }
    if (
      !normalizedExpiration ||
      !normalizedRight ||
      !Number.isFinite(normalizedStrike)
    ) {
      return false;
    }
    const eventExpiration = normalizeExpirationIso(event.expirationDate || event.exp);
    const eventRight = normalizeRight(event.cp || event.right);
    const eventStrike = finiteNumber(event.strike);
    return (
      eventExpiration === normalizedExpiration &&
      eventRight === normalizedRight &&
      eventStrike !== null &&
      Math.abs(eventStrike - normalizedStrike) <= 0.01
    );
  });
};

export const flowEventsToChartEventConversion = (
  events: Array<Record<string, unknown>> = [],
  symbol?: string,
): FlowChartEventConversion => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const input = Array.isArray(events) ? events : [];
  const chartEvents: ChartEvent[] = [];
  let flowRecordCount = 0;
  let droppedInvalidTimeCount = 0;
  let droppedSymbolCount = 0;

  input.forEach((event) => {
    if (!isFlowEventRecord(event)) {
      return;
    }
    flowRecordCount += 1;

    const eventSymbol = String(
      event.ticker || event.underlying || event.symbol || normalizedSymbol,
    )
      .trim()
      .toUpperCase();
    const occurredAt = readFlowEventChartTime(event);
    if (!occurredAt) {
      droppedInvalidTimeCount += 1;
      return;
    }
    if (normalizedSymbol && eventSymbol !== normalizedSymbol) {
      droppedSymbolCount += 1;
      return;
    }

    const right = String(event.cp || event.right || "").toUpperCase();
    const strike = finiteNumber(event.strike);
    const premium = finiteNumber(event.premium) ?? 0;
    const unusualScore = finiteNumber(event.unusualScore) ?? 0;
    const contractLabel =
      String(event.contract || event.optionTicker || "").trim() ||
      [eventSymbol, strike ?? "", right].filter(Boolean).join(" ");
    const sourceBasis = String(event.sourceBasis || event.confidence || "");
    const snapshotDerived =
      event.basis === "snapshot" || sourceBasis === "snapshot_activity";
    const flowKind = snapshotDerived
      ? "snapshot activity"
      : event.isUnusual
        ? "unusual flow"
        : "options flow";
    const fallbackId = `${eventSymbol}:${occurredAt}:${contractLabel}`;
    const chartEventId = snapshotDerived
      ? getStableFlowEventKey(event) || fallbackId
      : String(event.id || fallbackId);
    const biasDecision = resolveFlowEventBiasDecision(event);

    chartEvents.push({
      id: chartEventId,
      symbol: eventSymbol,
      eventType: "unusual_flow",
      time: occurredAt,
      placement: "bar",
      severity: resolveFlowSeverity({ premium, unusualScore }),
      label: `${right || "OPT"} ${compactPremium(premium)}`,
      summary: `${contractLabel} ${flowKind} ${compactPremium(premium)}`,
      source: String(event.provider || "flow"),
      confidence: Math.max(0, Math.min(1, unusualScore / 5)),
      bias: biasDecision.bias,
      actions: ["open_flow", "open_trade", "copy_contract", "add_alert"],
      metadata: {
        ...event,
        biasBasis: biasDecision.basis,
        premium,
        unusualScore,
        isUnusual: Boolean(event.isUnusual),
        sourceBasis: sourceBasis || undefined,
        timeBasis: snapshotDerived ? "snapshot_observed" : "trade_reported",
        contractLabel,
      },
    } satisfies ChartEvent);
  });

  return {
    events: chartEvents,
    rawInputCount: input.length,
    flowRecordCount,
    convertedEventCount: chartEvents.length,
    droppedInvalidTimeCount,
    droppedSymbolCount,
  };
};

export const flowEventsToChartEvents = (
  events: Array<Record<string, unknown>> = [],
  symbol?: string,
): ChartEvent[] => {
  return flowEventsToChartEventConversion(events, symbol).events;
};

export const earningsCalendarToChartEvents = (
  entries: Array<Record<string, unknown>> = [],
  symbol?: string,
): ChartEvent[] => {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const eventSymbol = String(entry.symbol || normalizedSymbol)
        .trim()
        .toUpperCase();
      const date = String(entry.date || "");
      const timing = String(entry.time || "").trim();
      return {
        id: `earnings:${eventSymbol}:${date}:${timing || "unknown"}`,
        symbol: eventSymbol,
        eventType: "earnings",
        time: date,
        placement: "timescale",
        severity: "medium",
        label: "E",
        summary: `${eventSymbol} earnings${timing ? ` ${timing}` : ""}`,
        source: "research-calendar",
        confidence: 1,
        bias: "neutral",
        actions: ["add_alert"],
        metadata: { ...entry },
      } satisfies ChartEvent;
    })
    .filter(
      (event) => event.time && (!normalizedSymbol || event.symbol === normalizedSymbol),
    );
};

export const getChartEventLookbackWindow = (
  timeframe: string,
  now = new Date(),
): { from: Date; to: Date } => {
  const normalized = String(timeframe || "").toLowerCase();
  const to = new Date(now);
  const intraday = !normalized.endsWith("d") && !normalized.endsWith("w");
  if (intraday) {
    return { from: intradayFlowLookbackStart(now), to };
  }
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 90);
  return { from, to };
};

export const clusterChartEvents = (
  events: ChartEvent[],
  {
    bucketMs = 5 * 60 * 1000,
    maxEventsPerCluster = 12,
  }: { bucketMs?: number; maxEventsPerCluster?: number } = {},
): ChartEventCluster[] => {
  const buckets = new Map<string, ChartEvent[]>();
  events.forEach((event) => {
    const parsed = Date.parse(event.time);
    const timeBucket = Number.isFinite(parsed)
      ? Math.floor(parsed / Math.max(1, bucketMs))
      : event.time;
    const key = `${event.symbol}:${event.eventType}:${timeBucket}`;
    const bucket = buckets.get(key) || [];
    if (bucket.length < maxEventsPerCluster) {
      bucket.push(event);
    }
    buckets.set(key, bucket);
  });

  return Array.from(buckets.values())
    .map((bucket) => {
      const bias = resolveChartEventCollectionBias(bucket);
      const first = bucket[0];
      return {
        id: `cluster:${first.symbol}:${first.eventType}:${first.time}:${bucket.length}`,
        symbol: first.symbol,
        time: first.time,
        eventType: first.eventType,
        count: bucket.length,
        bias,
        severity: maxSeverity(bucket),
        label: bucket.length > 1 ? `${bucket.length} ${bias}` : first.label,
        events: bucket,
      } satisfies ChartEventCluster;
    })
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
};
