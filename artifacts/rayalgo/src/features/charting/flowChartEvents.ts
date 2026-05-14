import type { ChartEvent, ChartEventBias, ChartEventSeverity } from "./chartEvents";
import type { ChartBar, ChartBarRange } from "./types";

export type FlowChartBucket = {
  id: string;
  time: number;
  barIndex: number;
  sourceBasis: FlowChartSourceBasis;
  events: ChartEvent[];
  count: number;
  totalPremium: number;
  totalContracts: number;
  callPremium: number;
  putPremium: number;
  bullishPremium: number;
  bearishPremium: number;
  neutralPremium: number;
  bullishShare: number;
  bearishShare: number;
  neutralShare: number;
  bias: ChartEventBias;
  biasBasis: string;
  severity: ChartEventSeverity;
  topEvent: ChartEvent;
  topContractLabel: string;
  topPremium: number;
  tags: string[];
  volumeSegmentRatio: number;
};

export type FlowChartEventPlacement = {
  id: string;
  time: number;
  eventIso: string;
  eventDay: string;
  eventTimeMs: number;
  barIndex: number;
  sourceBasis: FlowChartSourceBasis;
  timeBasis: string;
  timeSourceField: string;
  event: ChartEvent;
  bucket: FlowChartBucket;
};

export type FlowTooltipModel = {
  title: string;
  summary: string;
  tone: ChartEventBias;
  premium: string;
  contracts: string;
  callPutMix: string;
  flowMix: string;
  callPercent: number;
  putPercent: number;
  bullishPercent: number;
  bearishPercent: number;
  neutralPercent: number;
  topContract: string;
  copyLabel: string;
  sourceLabel: string;
  timeBasis: string;
  side: string;
  price: string;
  bidAsk: string;
  openInterest: string;
  dte: string;
  iv: string;
  delta: string;
  unusualScore: string;
  moneyness: string;
  distance: string;
  tags: string[];
  sentiment: string;
  biasBasis: string;
  sideConfidence: string;
  intensity: string;
  eventCount: number;
  callPremiumLabel: string;
  putPremiumLabel: string;
  bullishPremiumLabel: string;
  bearishPremiumLabel: string;
  neutralPremiumLabel: string;
  markerPremiumLabel: string;
  topStrike: string;
  topExpiry: string;
  topRight: "C" | "P" | "";
};

type ChartBarModel = {
  chartBars: ChartBar[];
  chartBarRanges?: ChartBarRange[];
};

export type FlowChartBucketDiagnostics = {
  inputEventCount: number;
  flowEventCount: number;
  confirmedTradeFlowEventCount: number;
  snapshotActivityFlowEventCount: number;
  otherFlowEventCount: number;
  uniqueFlowEventCount: number;
  droppedDuplicateFlowEventCount: number;
  bucketedEventCount: number;
  bucketedConfirmedTradeEventCount: number;
  bucketedSnapshotActivityEventCount: number;
  bucketedOtherEventCount: number;
  markerEligibleEventCount: number;
  markerPlacementCount: number;
  markerSnapshotSkippedEventCount: number;
  markerOtherSkippedEventCount: number;
  droppedMarkerOutsideBarCount: number;
  droppedInvalidTimeCount: number;
  droppedOutsideBarCount: number;
};

export type FlowChartSourceBasis =
  | "confirmed_trade"
  | "snapshot_activity"
  | "other";

const flowChartSourceBasisOrder: Record<FlowChartSourceBasis, number> = {
  confirmed_trade: 0,
  snapshot_activity: 1,
  other: 2,
};

const severityRank: Record<ChartEventSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  extreme: 3,
};

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const compactCurrency = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
};

const formatStrike = (value: unknown): string => {
  const numeric = finiteNumber(value);
  if (numeric === null) return "n/a";
  return numeric % 1 === 0 ? numeric.toFixed(0) : numeric.toFixed(2);
};

const normalizeDateParts = (year: number, month: number, day: number): string => {
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : "";
};

const normalizeExpirationDateKey = (value: unknown): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return normalizeDateParts(
        Number(isoMatch[1]),
        Number(isoMatch[2]),
        Number(isoMatch[3]),
      );
    }
    const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactMatch) {
      return normalizeDateParts(
        Number(compactMatch[1]),
        Number(compactMatch[2]),
        Number(compactMatch[3]),
      );
    }
  }
  const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
};

const formatExpiryShort = (value: unknown): string => {
  const dateKey = normalizeExpirationDateKey(value);
  if (!dateKey) return "n/a";
  const date = new Date(`${dateKey}T00:00:00Z`);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
};

const compactNumber = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}K`;
  return `${Math.round(value)}`;
};

const compactPrice = (value: number): string => {
  if (Math.abs(value) >= 100) return value.toFixed(1);
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(2);
};

const roundPercentParts = (values: number[]): number[] => {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return values.map(() => 0);

  const raw = values.map((value) => (Math.max(0, value) / total) * 100);
  const floors = raw.map(Math.floor);
  let remaining = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((left, right) => right.remainder - left.remainder);

  for (const entry of order) {
    if (remaining <= 0) break;
    floors[entry.index] += 1;
    remaining -= 1;
  }

  return floors;
};

const formatOptionalPrice = (value: unknown): string => {
  const numeric = finiteNumber(value);
  return numeric === null ? "n/a" : compactPrice(numeric);
};

const formatOptionalPercent = (value: unknown): string => {
  const numeric = finiteNumber(value);
  if (numeric === null) return "n/a";
  const percent = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return `${percent.toFixed(Math.abs(percent) >= 10 ? 0 : 1)}%`;
};

const formatOptionalDelta = (value: unknown): string => {
  const numeric = finiteNumber(value);
  return numeric === null ? "n/a" : numeric.toFixed(2);
};

const formatOptionalRatio = (value: unknown, suffix = "x"): string => {
  const numeric = finiteNumber(value);
  if (numeric === null || numeric <= 0) return "n/a";
  return `${numeric.toFixed(numeric >= 10 ? 0 : 1)}${suffix}`;
};

const normalizeSideDisplay = (value: unknown): string => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "n/a";
  if (
    normalized === "buy" ||
    normalized === "bought" ||
    normalized === "ask" ||
    normalized === "at_ask" ||
    normalized === "above_ask" ||
    normalized === "lift" ||
    normalized === "lifted"
  ) {
    return "BUY";
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
    return "SELL";
  }
  if (normalized === "mid" || normalized === "middle" || normalized === "between") {
    return "MID";
  }
  return normalized.toUpperCase();
};

const formatSourceLabel = (event: ChartEvent): string => {
  const provider = String(event.metadata?.provider || event.source || "flow")
    .trim()
    .toUpperCase();
  const basis = String(event.metadata?.basis || "").trim().toUpperCase();
  return [provider, basis].filter(Boolean).join(" ") || "FLOW";
};

const formatTimeBasis = (event: ChartEvent): string => {
  const basis = String(event.metadata?.timeBasis || event.metadata?.sourceBasis || "")
    .trim()
    .toLowerCase();
  if (basis.includes("snapshot") || basis.includes("observed")) return "observed";
  if (basis.includes("confirmed") || basis.includes("reported") || basis.includes("trade")) {
    return "reported";
  }
  return isSnapshotActivityEvent(event) ? "observed" : "reported";
};

const formatBidAsk = (event: ChartEvent): string => {
  const bid = finiteNumber(event.metadata?.bid);
  const ask = finiteNumber(event.metadata?.ask);
  if (bid === null || ask === null) return "n/a";
  return `${compactPrice(bid)}/${compactPrice(ask)}`;
};

const formatDte = (event: ChartEvent): string => {
  const explicitDte = finiteNumber(event.metadata?.dte);
  if (explicitDte !== null) return `${Math.max(0, Math.round(explicitDte))}d`;

  const expiration = normalizeExpirationDateKey(event.metadata?.expirationDate);
  const eventMs = Date.parse(event.time);
  const expirationMs = Date.parse(`${expiration}T00:00:00Z`);
  if (!expiration || !Number.isFinite(eventMs) || !Number.isFinite(expirationMs)) {
    return "n/a";
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const eventDay = Math.floor(eventMs / dayMs);
  const expirationDay = Math.floor(expirationMs / dayMs);
  return `${Math.max(0, expirationDay - eventDay)}d`;
};

const formatMoneyness = (value: unknown): string => {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized && normalized !== "UNKNOWN" ? normalized : "n/a";
};

const formatDistance = (value: unknown): string => {
  const numeric = finiteNumber(value);
  if (numeric === null) return "n/a";
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(Math.abs(numeric) >= 10 ? 0 : 1)}%`;
};

const formatSideConfidence = (event: ChartEvent, biasBasis: string): string => {
  if (biasBasis.startsWith("Calls") || biasBasis.startsWith("Puts")) {
    return "Unclassified";
  }
  const sideBasis = String(event.metadata?.sideBasis || "")
    .trim()
    .toLowerCase();
  const confidence = String(event.metadata?.sideConfidence || "")
    .trim()
    .toLowerCase();
  if (sideBasis === "quote_match") return confidence ? `Quote ${confidence}` : "Quote";
  if (sideBasis === "tick_test") return confidence ? `Tick ${confidence}` : "Tick";
  return "n/a";
};

const normalizeRight = (value: unknown): "C" | "P" | "" => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "CALL" || normalized === "C") return "C";
  if (normalized === "PUT" || normalized === "P") return "P";
  return "";
};

const normalizeKeyPart = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase();

const normalizeNumericKeyPart = (value: unknown): string => {
  const numeric = finiteNumber(value);
  return numeric === null ? "" : String(Number(numeric.toFixed(4)));
};

const normalizeExpirationKey = (value: unknown): string => {
  return normalizeExpirationDateKey(value);
};

const normalizeTag = (value: unknown): string | null => {
  const tag = String(value || "").trim().toLowerCase();
  if (!tag) return null;
  if (tag.includes("sweep")) return "sweep";
  if (tag.includes("block")) return "block";
  if (tag.includes("split")) return "split";
  if (tag.includes("golden")) return "golden";
  if (tag.includes("repeat")) return "repeat";
  return null;
};

const readPremium = (event: ChartEvent): number =>
  finiteNumber(event.metadata?.premium) ?? 0;

const readContracts = (event: ChartEvent): number =>
  finiteNumber(event.metadata?.contracts) ??
  finiteNumber(event.metadata?.size) ??
  finiteNumber(event.metadata?.vol) ??
  finiteNumber(event.metadata?.volume) ??
  0;

const readRight = (event: ChartEvent): "C" | "P" | "" =>
  normalizeRight(event.metadata?.cp ?? event.metadata?.right ?? event.metadata?.optionType);

const isCallPutFallbackEvent = (event: ChartEvent): boolean =>
  String(event.metadata?.biasBasis || "").trim().toLowerCase() ===
  "call_put_fallback";

const readContractLabel = (event: ChartEvent): string =>
  String(
    event.metadata?.contractLabel ||
      event.metadata?.contract ||
      event.metadata?.optionTicker ||
      event.label ||
      "",
  ).trim();

const normalizeFlowSourceBasisValue = (value: unknown): string =>
  String(value || "").trim().toLowerCase();

export const resolveFlowChartSourceBasis = (
  event: ChartEvent,
): FlowChartSourceBasis => {
  const sourceBasis = normalizeFlowSourceBasisValue(
    event.metadata?.sourceBasis || event.metadata?.confidence,
  );
  const basis = normalizeFlowSourceBasisValue(event.metadata?.basis);
  if (
    sourceBasis === "confirmed_trade" ||
    sourceBasis === "confirmed" ||
    sourceBasis === "reported" ||
    sourceBasis === "trade"
  ) {
    return "confirmed_trade";
  }
  if (
    sourceBasis === "snapshot_activity" ||
    sourceBasis === "snapshot" ||
    sourceBasis === "observed"
  ) {
    return "snapshot_activity";
  }
  if (
    basis === "trade" ||
    basis === "confirmed_trade" ||
    basis === "confirmed" ||
    basis === "reported"
  ) {
    return "confirmed_trade";
  }
  if (
    basis === "snapshot" ||
    basis === "snapshot_activity" ||
    basis === "observed"
  ) {
    return "snapshot_activity";
  }
  return "other";
};

const isSnapshotActivityEvent = (event: ChartEvent): boolean =>
  resolveFlowChartSourceBasis(event) === "snapshot_activity";

const isFlowChartMarkerEligibleEvent = (event: ChartEvent): boolean =>
  resolveFlowChartSourceBasis(event) === "confirmed_trade";

const readFlowChartEventTimeBasis = (event: ChartEvent): string =>
  String(event.metadata?.timeBasis || event.metadata?.chartTimeBasis || "")
    .trim()
    .toLowerCase();

const readFlowChartEventTimeSourceField = (event: ChartEvent): string =>
  String(
    event.metadata?.chartTimeSourceField ||
      event.metadata?.timeSourceField ||
      event.metadata?.sourceField ||
      "",
  ).trim();

const getChartFlowSnapshotKey = (event: ChartEvent): string => {
  if (!isSnapshotActivityEvent(event)) return "";
  const metadata = event.metadata || {};
  const observedDate = event.time.slice(0, 10);
  const optionTicker = String(metadata.optionTicker || "").trim().toUpperCase();
  const providerContractId = String(metadata.providerContractId || "").trim();
  const expiration = normalizeExpirationKey(metadata.expirationDate || metadata.exp);
  const right = normalizeRight(metadata.cp ?? metadata.right ?? metadata.optionType);
  const strike = normalizeNumericKeyPart(metadata.strike);
  const contract =
    providerContractId ||
    optionTicker ||
    [expiration, right, strike].filter(Boolean).join(":") ||
    normalizeKeyPart(
      metadata.contractLabel || metadata.contract || event.label || event.id,
    );
  if (!event.symbol || !observedDate || !contract) return "";
  return [
    "snapshot",
    normalizeKeyPart(metadata.provider || event.source || "flow"),
    event.symbol,
    observedDate,
    contract,
  ].join("|");
};

const getChartFlowPrintKey = (event: ChartEvent): string => {
  if (isSnapshotActivityEvent(event)) return "";
  const metadata = event.metadata || {};
  const optionTicker = String(metadata.optionTicker || "").trim().toUpperCase();
  const expiration = normalizeExpirationKey(metadata.expirationDate || metadata.exp);
  const right = normalizeRight(metadata.cp ?? metadata.right ?? metadata.optionType);
  const strike = normalizeNumericKeyPart(metadata.strike);
  const contract =
    optionTicker ||
    [expiration, right, strike].filter(Boolean).join(":") ||
    normalizeKeyPart(
      metadata.contractLabel || metadata.contract || event.label || event.id,
    );
  if (!event.symbol || !event.time || !contract) return "";
  return [
    "print",
    event.symbol,
    contract,
    event.time,
    normalizeKeyPart(metadata.side),
    normalizeNumericKeyPart(metadata.price),
    normalizeNumericKeyPart(
      metadata.size ?? metadata.contracts ?? metadata.vol,
    ),
    normalizeNumericKeyPart(metadata.premium),
  ].join("|");
};

const getChartFlowDedupeKeys = (event: ChartEvent): string[] => {
  const idKey = normalizeKeyPart(event.id);
  const basis = resolveFlowChartSourceBasis(event);
  const keys = [
    idKey ? `${basis}|id:${idKey}` : "",
    getChartFlowSnapshotKey(event),
    getChartFlowPrintKey(event),
  ].filter(Boolean);
  return Array.from(new Set(keys));
};

const selectPreferredChartFlowEvent = (
  current: ChartEvent,
  incoming: ChartEvent,
): ChartEvent => {
  if (isSnapshotActivityEvent(current) && isSnapshotActivityEvent(incoming)) {
    const currentTime = Date.parse(current.time);
    const incomingTime = Date.parse(incoming.time);
    if (Number.isFinite(incomingTime) && Number.isFinite(currentTime)) {
      return incomingTime >= currentTime ? incoming : current;
    }
  }
  return current;
};

const normalizeFlowChartEvents = (
  events: ChartEvent[],
): { events: ChartEvent[]; droppedDuplicateCount: number } => {
  const normalized: ChartEvent[] = [];
  const keyToIndex = new Map<string, number>();
  events.forEach((event) => {
    if (event.eventType !== "unusual_flow") return;
    const keys = getChartFlowDedupeKeys(event);
    if (!keys.length) return;
    const existingIndex = keys
      .map((key) => keyToIndex.get(key))
      .find((index): index is number => typeof index === "number");
    if (existingIndex == null) {
      const nextIndex = normalized.length;
      normalized.push(event);
      keys.forEach((key) => keyToIndex.set(key, nextIndex));
      return;
    }
    const selected = selectPreferredChartFlowEvent(normalized[existingIndex], event);
    normalized[existingIndex] = selected;
    getChartFlowDedupeKeys(selected).forEach((key) =>
      keyToIndex.set(key, existingIndex),
    );
    keys.forEach((key) => keyToIndex.set(key, existingIndex));
  });

  return {
    events: normalized,
    droppedDuplicateCount:
      events.filter((event) => event.eventType === "unusual_flow").length -
      normalized.length,
  };
};

const readTags = (event: ChartEvent): string[] => {
  const tags = new Set<string>();
  const rawType = normalizeTag(event.metadata?.type ?? event.metadata?.tradeType);
  if (rawType) tags.add(rawType);
  if (event.metadata?.isSweep === true || event.metadata?.sweep === true) tags.add("sweep");
  if (event.metadata?.isBlock === true || event.metadata?.block === true) tags.add("block");
  if (event.metadata?.golden === true || event.metadata?.isGolden === true) tags.add("golden");
  if (event.metadata?.repeat === true || event.metadata?.isRepeat === true) tags.add("repeat");
  return Array.from(tags);
};

const maxSeverity = (events: ChartEvent[]): ChartEventSeverity =>
  events.reduce<ChartEventSeverity>(
    (best, event) =>
      severityRank[event.severity] > severityRank[best] ? event.severity : best,
    "low",
  );

const resolveBucketIndex = (
  eventMs: number,
  bars: ChartBar[],
  ranges: ChartBarRange[] = [],
): number => {
  if (!bars.length) {
    return -1;
  }

  const rangeIndex = ranges.findIndex(
    (range) => eventMs >= range.startMs && eventMs < range.endMs,
  );
  if (rangeIndex >= 0 && rangeIndex < bars.length) {
    return rangeIndex;
  }

  const eventSeconds = Math.floor(eventMs / 1000);
  const exactIndex = bars.findIndex((bar) => bar.time === eventSeconds);
  if (exactIndex >= 0) {
    return exactIndex;
  }
  if (ranges.length > 0) {
    return -1;
  }

  const firstLoadedMs = ranges[0]?.startMs ?? bars[0].time * 1000;
  const lastRange = ranges.length
    ? ranges[Math.min(ranges.length, bars.length) - 1]
    : undefined;
  const lastBarMs = bars[bars.length - 1].time * 1000;
  const inferredStepMs =
    bars.length > 1
      ? Math.max(1, (bars[bars.length - 1].time - bars[bars.length - 2].time) * 1000)
      : 60_000;
  const lastLoadedEndMs = lastRange?.endMs ?? lastBarMs + inferredStepMs;
  if (eventMs < firstLoadedMs || eventMs >= lastLoadedEndMs) {
    return -1;
  }

  let bestIndex = -1;
  for (let index = 0; index < bars.length; index += 1) {
    if (bars[index].time <= eventSeconds) {
      bestIndex = index;
    } else {
      break;
    }
  }
  return bestIndex;
};

const FLOW_RIGHT_BIAS_FALLBACK_DOMINANCE = 0.7;

const resolveCallPutFallbackBias = ({
  callPremium,
  putPremium,
}: {
  callPremium: number;
  putPremium: number;
}): { bias: ChartEventBias; basis: string } => {
  const total = callPremium + putPremium;
  if (total <= 0) return { bias: "neutral", basis: "Neutral" };
  const callShare = callPremium / total;
  const putShare = putPremium / total;
  if (callShare >= FLOW_RIGHT_BIAS_FALLBACK_DOMINANCE) {
    return { bias: "bullish", basis: `Calls ${Math.round(callShare * 100)}%` };
  }
  if (putShare >= FLOW_RIGHT_BIAS_FALLBACK_DOMINANCE) {
    return { bias: "bearish", basis: `Puts ${Math.round(putShare * 100)}%` };
  }
  return { bias: "neutral", basis: "Mixed C/P" };
};

const resolveBias = ({
  bullishPremium,
  bearishPremium,
  callPremium,
  putPremium,
  events,
}: {
  bullishPremium: number;
  bearishPremium: number;
  callPremium: number;
  putPremium: number;
  events: ChartEvent[];
}): { bias: ChartEventBias; basis: string } => {
  if (bullishPremium > bearishPremium) {
    return { bias: "bullish", basis: "Side premium" };
  }
  if (bearishPremium > bullishPremium) {
    return { bias: "bearish", basis: "Side premium" };
  }
  const directionalEvents = events.filter((event) => !isCallPutFallbackEvent(event));
  const bullishCount = directionalEvents.filter(
    (event) => event.bias === "bullish",
  ).length;
  const bearishCount = directionalEvents.filter(
    (event) => event.bias === "bearish",
  ).length;
  if (bullishCount > bearishCount) return { bias: "bullish", basis: "Side count" };
  if (bearishCount > bullishCount) return { bias: "bearish", basis: "Side count" };
  return resolveCallPutFallbackBias({ callPremium, putPremium });
};

const resolveSentimentShares = ({
  bullishPremium,
  bearishPremium,
  neutralPremium,
}: {
  bullishPremium: number;
  bearishPremium: number;
  neutralPremium: number;
}): {
  bullishShare: number;
  bearishShare: number;
  neutralShare: number;
} => {
  const total = bullishPremium + bearishPremium + neutralPremium;
  if (total <= 0) {
    return { bullishShare: 0, bearishShare: 0, neutralShare: 1 };
  }
  return {
    bullishShare: bullishPremium / total,
    bearishShare: bearishPremium / total,
    neutralShare: neutralPremium / total,
  };
};

const buildRawFlowChartBucket = ({
  id,
  barIndex,
  sourceBasis,
  bucketEvents,
  model,
}: {
  id: string;
  barIndex: number;
  sourceBasis: FlowChartSourceBasis;
  bucketEvents: ChartEvent[];
  model: ChartBarModel;
}): FlowChartBucket => {
  const totals = bucketEvents.reduce(
    (acc, event) => {
      const premium = readPremium(event);
      const contracts = readContracts(event);
      const right = readRight(event);
      acc.totalPremium += premium;
      acc.totalContracts += contracts;
      if (right === "C") acc.callPremium += premium;
      if (right === "P") acc.putPremium += premium;
      if (isCallPutFallbackEvent(event)) {
        acc.neutralPremium += premium;
        return acc;
      }
      if (event.bias === "bullish") {
        acc.bullishPremium += premium;
      } else if (event.bias === "bearish") {
        acc.bearishPremium += premium;
      } else {
        acc.neutralPremium += premium;
      }
      return acc;
    },
    {
      totalPremium: 0,
      totalContracts: 0,
      callPremium: 0,
      putPremium: 0,
      bullishPremium: 0,
      bearishPremium: 0,
      neutralPremium: 0,
    },
  );
  const topEvent =
    bucketEvents
      .slice()
      .sort((left, right) => readPremium(right) - readPremium(left))[0] ||
    bucketEvents[0];
  const tags = Array.from(new Set(bucketEvents.flatMap(readTags))).slice(0, 4);
  const biasDecision = resolveBias({ ...totals, events: bucketEvents });
  const shares = resolveSentimentShares(totals);
  const topPremium = readPremium(topEvent);

  return {
    id,
    time: model.chartBars[barIndex].time,
    barIndex,
    sourceBasis,
    events: bucketEvents,
    count: bucketEvents.length,
    ...totals,
    ...shares,
    bias: biasDecision.bias,
    biasBasis: biasDecision.basis,
    severity: maxSeverity(bucketEvents),
    topEvent,
    topContractLabel: readContractLabel(topEvent),
    topPremium,
    tags,
    volumeSegmentRatio: 0,
  };
};

const applyFlowBucketIntensity = <T extends { bucket?: FlowChartBucket }>(
  values: T[],
): T[] => {
  const buckets = values.flatMap((value) => (value.bucket ? [value.bucket] : []));
  const maxPremium = Math.max(...buckets.map((bucket) => bucket.totalPremium), 0);
  return values.map((value) => {
    if (!value.bucket) return value;
    return {
      ...value,
      bucket: {
        ...value.bucket,
        volumeSegmentRatio:
          maxPremium > 0
            ? clamp(value.bucket.totalPremium / maxPremium, 0.08, 0.55)
            : 0.08,
      },
    };
  });
};

export const summarizeFlowChartBucketPlacement = (
  events: ChartEvent[],
  model: ChartBarModel,
): FlowChartBucketDiagnostics => {
  const diagnostics: FlowChartBucketDiagnostics = {
    inputEventCount: Array.isArray(events) ? events.length : 0,
    flowEventCount: 0,
    confirmedTradeFlowEventCount: 0,
    snapshotActivityFlowEventCount: 0,
    otherFlowEventCount: 0,
    uniqueFlowEventCount: 0,
    droppedDuplicateFlowEventCount: 0,
    bucketedEventCount: 0,
    bucketedConfirmedTradeEventCount: 0,
    bucketedSnapshotActivityEventCount: 0,
    bucketedOtherEventCount: 0,
    markerEligibleEventCount: 0,
    markerPlacementCount: 0,
    markerSnapshotSkippedEventCount: 0,
    markerOtherSkippedEventCount: 0,
    droppedMarkerOutsideBarCount: 0,
    droppedInvalidTimeCount: 0,
    droppedOutsideBarCount: 0,
  };

  if (!Array.isArray(events) || !events.length || !model.chartBars.length) {
    return diagnostics;
  }

  const flowEvents = events.filter((event) => event.eventType === "unusual_flow");
  const normalized = normalizeFlowChartEvents(flowEvents);
  diagnostics.flowEventCount = flowEvents.length;
  diagnostics.uniqueFlowEventCount = normalized.events.length;
  diagnostics.droppedDuplicateFlowEventCount = normalized.droppedDuplicateCount;

  normalized.events.forEach((event) => {
    const sourceBasis = resolveFlowChartSourceBasis(event);
    if (sourceBasis === "confirmed_trade") {
      diagnostics.confirmedTradeFlowEventCount += 1;
      diagnostics.markerEligibleEventCount += 1;
    } else if (sourceBasis === "snapshot_activity") {
      diagnostics.snapshotActivityFlowEventCount += 1;
      diagnostics.markerSnapshotSkippedEventCount += 1;
    } else {
      diagnostics.otherFlowEventCount += 1;
      diagnostics.markerOtherSkippedEventCount += 1;
    }

    const parsed = Date.parse(event.time);
    if (!Number.isFinite(parsed)) {
      diagnostics.droppedInvalidTimeCount += 1;
      return;
    }
    const barIndex = resolveBucketIndex(parsed, model.chartBars, model.chartBarRanges);
    if (barIndex < 0) {
      diagnostics.droppedOutsideBarCount += 1;
      if (sourceBasis === "confirmed_trade") {
        diagnostics.droppedMarkerOutsideBarCount += 1;
      }
      return;
    }
    diagnostics.bucketedEventCount += 1;
    if (sourceBasis === "confirmed_trade") {
      diagnostics.bucketedConfirmedTradeEventCount += 1;
      diagnostics.markerPlacementCount += 1;
    } else if (sourceBasis === "snapshot_activity") {
      diagnostics.bucketedSnapshotActivityEventCount += 1;
    } else {
      diagnostics.bucketedOtherEventCount += 1;
    }
  });

  return diagnostics;
};

export const buildFlowChartBuckets = (
  events: ChartEvent[],
  model: ChartBarModel,
): FlowChartBucket[] => {
  if (!events.length || !model.chartBars.length) {
    return [];
  }

  const grouped = new Map<string, { barIndex: number; sourceBasis: FlowChartSourceBasis; events: ChartEvent[] }>();
  const normalized = normalizeFlowChartEvents(events).events;
  normalized.forEach((event) => {
    const parsed = Date.parse(event.time);
    if (!Number.isFinite(parsed)) return;
    const barIndex = resolveBucketIndex(parsed, model.chartBars, model.chartBarRanges);
    if (barIndex < 0) return;
    const sourceBasis = resolveFlowChartSourceBasis(event);
    const key = `${barIndex}:${sourceBasis}`;
    const bucket = grouped.get(key) || { barIndex, sourceBasis, events: [] };
    bucket.events.push(event);
    grouped.set(key, bucket);
  });

  const rawBuckets = Array.from(grouped.values())
    .sort(
      (left, right) =>
        left.barIndex - right.barIndex ||
        flowChartSourceBasisOrder[left.sourceBasis] -
          flowChartSourceBasisOrder[right.sourceBasis],
    )
    .map(({ barIndex, sourceBasis, events: bucketEvents }) =>
      buildRawFlowChartBucket({
        id: `flow:${sourceBasis}:${model.chartBars[barIndex].time}:${bucketEvents.length}`,
        barIndex,
        sourceBasis,
        bucketEvents,
        model,
      }),
    );

  const maxPremium = Math.max(...rawBuckets.map((bucket) => bucket.totalPremium), 0);
  return rawBuckets.map((bucket) => ({
    ...bucket,
    volumeSegmentRatio:
      maxPremium > 0 ? clamp(bucket.totalPremium / maxPremium, 0.08, 0.55) : 0.08,
  }));
};

export const buildFlowChartVolumeBuckets = (
  events: ChartEvent[],
  model: ChartBarModel,
): FlowChartBucket[] =>
  buildFlowChartBuckets(
    events.filter(
      (event) =>
        event.eventType === "unusual_flow" &&
        resolveFlowChartSourceBasis(event) === "confirmed_trade",
    ),
    model,
  );

export const buildFlowChartEventPlacements = (
  events: ChartEvent[],
  model: ChartBarModel,
): FlowChartEventPlacement[] => {
  if (!events.length || !model.chartBars.length) {
    return [];
  }

  const normalized = normalizeFlowChartEvents(events).events;
  const placements = normalized.flatMap((event, index): FlowChartEventPlacement[] => {
    const parsed = Date.parse(event.time);
    if (!Number.isFinite(parsed)) return [];
    const barIndex = resolveBucketIndex(parsed, model.chartBars, model.chartBarRanges);
    if (barIndex < 0) return [];
    const sourceBasis = resolveFlowChartSourceBasis(event);
    if (!isFlowChartMarkerEligibleEvent(event)) return [];
    const idPart = normalizeKeyPart(event.id) || `${parsed}:${index}`;
    const bucket = buildRawFlowChartBucket({
      id: `flow-event-bucket:${sourceBasis}:${model.chartBars[barIndex].time}:${idPart}`,
      barIndex,
      sourceBasis,
      bucketEvents: [event],
      model,
    });
    return [
      {
        id: `flow-event:${sourceBasis}:${model.chartBars[barIndex].time}:${idPart}`,
        time: model.chartBars[barIndex].time,
        eventIso: new Date(parsed).toISOString(),
        eventDay: new Date(parsed).toISOString().slice(0, 10),
        eventTimeMs: parsed,
        barIndex,
        sourceBasis,
        timeBasis: readFlowChartEventTimeBasis(event),
        timeSourceField: readFlowChartEventTimeSourceField(event),
        event,
        bucket,
      },
    ];
  });

  return applyFlowBucketIntensity(placements).sort(
    (left, right) =>
      left.barIndex - right.barIndex ||
      left.eventTimeMs - right.eventTimeMs ||
      flowChartSourceBasisOrder[left.sourceBasis] -
        flowChartSourceBasisOrder[right.sourceBasis],
  );
};

export const buildFlowTooltipModel = (bucket: FlowChartBucket): FlowTooltipModel => {
  const callPutTotal = bucket.callPremium + bucket.putPremium;
  const [callPercent, putPercent] =
    callPutTotal > 0
      ? roundPercentParts([bucket.callPremium, bucket.putPremium])
      : [0, 0];
  const [bullishPercent, bearishPercent, neutralPercent] = roundPercentParts([
    bucket.bullishShare,
    bucket.bearishShare,
    bucket.neutralShare,
  ]);
  const sentiment =
    bucket.bias === "bullish"
      ? "Bullish"
      : bucket.bias === "bearish"
        ? "Bearish"
        : "Mixed";
  const snapshotOnly = bucket.events.every(isSnapshotActivityEvent);
  const title =
    bucket.count > 1
      ? snapshotOnly
        ? `${bucket.count} active contracts`
        : `${bucket.count} flow events`
      : snapshotOnly
        ? "Active contract flow"
        : "Flow event";
  const topEvent = bucket.topEvent;
  const topMetadata = topEvent.metadata || {};
  const topContract = bucket.topContractLabel || topEvent.label;
  const openInterest =
    finiteNumber(topMetadata.openInterest) ?? finiteNumber(topMetadata.oi);

  return {
    title,
    summary: `${compactCurrency(bucket.totalPremium)} premium · ${sentiment}`,
    tone: bucket.bias,
    premium: compactCurrency(bucket.totalPremium),
    contracts: bucket.totalContracts > 0 ? compactNumber(bucket.totalContracts) : "n/a",
    callPutMix: callPutTotal > 0 ? `${callPercent}% C / ${putPercent}% P` : "n/a",
    flowMix: `${bullishPercent}% bull / ${bearishPercent}% bear / ${neutralPercent}% mix`,
    callPercent,
    putPercent,
    bullishPercent,
    bearishPercent,
    neutralPercent,
    topContract,
    copyLabel: topContract,
    sourceLabel: formatSourceLabel(topEvent),
    timeBasis: formatTimeBasis(topEvent),
    side: normalizeSideDisplay(topMetadata.side),
    price: formatOptionalPrice(topMetadata.premiumPrice ?? topMetadata.price ?? topMetadata.mark ?? topMetadata.last),
    bidAsk: formatBidAsk(topEvent),
    openInterest: openInterest === null ? "n/a" : compactNumber(openInterest),
    dte: formatDte(topEvent),
    iv: formatOptionalPercent(topMetadata.iv ?? topMetadata.impliedVolatility),
    delta: formatOptionalDelta(topMetadata.delta),
    unusualScore: formatOptionalRatio(topMetadata.unusualScore, "x"),
    moneyness: formatMoneyness(topMetadata.moneyness),
    distance: formatDistance(topMetadata.distancePercent),
    tags: bucket.tags,
    sentiment,
    biasBasis: bucket.biasBasis,
    sideConfidence: formatSideConfidence(topEvent, bucket.biasBasis),
    intensity: `${Math.round(bucket.volumeSegmentRatio * 100)}% flow intensity`,
    eventCount: bucket.count,
    callPremiumLabel: bucket.callPremium > 0 ? compactCurrency(bucket.callPremium) : "n/a",
    putPremiumLabel: bucket.putPremium > 0 ? compactCurrency(bucket.putPremium) : "n/a",
    bullishPremiumLabel:
      bucket.bullishPremium > 0 ? compactCurrency(bucket.bullishPremium) : "n/a",
    bearishPremiumLabel:
      bucket.bearishPremium > 0 ? compactCurrency(bucket.bearishPremium) : "n/a",
    neutralPremiumLabel:
      bucket.neutralPremium > 0 ? compactCurrency(bucket.neutralPremium) : "n/a",
    markerPremiumLabel: compactCurrency(bucket.totalPremium),
    topStrike: formatStrike(topMetadata.strike),
    topExpiry: formatExpiryShort(topMetadata.expirationDate ?? topMetadata.exp),
    topRight: normalizeRight(
      topMetadata.cp ?? topMetadata.right ?? topMetadata.optionType,
    ),
  };
};
