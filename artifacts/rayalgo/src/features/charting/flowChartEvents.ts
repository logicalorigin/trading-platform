import type { ChartEvent, ChartEventBias, ChartEventSeverity } from "./chartEvents";
import type { ChartBar, ChartBarRange } from "./types";

export type FlowChartBucket = {
  id: string;
  time: number;
  barIndex: number;
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
  severity: ChartEventSeverity;
  topEvent: ChartEvent;
  topContractLabel: string;
  topPremium: number;
  tags: string[];
  volumeSegmentRatio: number;
};

export type FlowTooltipModel = {
  title: string;
  summary: string;
  premium: string;
  contracts: string;
  callPutMix: string;
  flowMix: string;
  topContract: string;
  tags: string[];
  sentiment: string;
  intensity: string;
  eventCount: number;
};

type ChartBarModel = {
  chartBars: ChartBar[];
  chartBarRanges?: ChartBarRange[];
};

export type FlowChartBucketDiagnostics = {
  inputEventCount: number;
  flowEventCount: number;
  bucketedEventCount: number;
  droppedInvalidTimeCount: number;
  droppedOutsideBarCount: number;
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

const compactCurrency = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
};

const compactNumber = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}K`;
  return `${Math.round(value)}`;
};

const normalizeRight = (value: unknown): "C" | "P" | "" => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "CALL" || normalized === "C") return "C";
  if (normalized === "PUT" || normalized === "P") return "P";
  return "";
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

const readContractLabel = (event: ChartEvent): string =>
  String(
    event.metadata?.contractLabel ||
      event.metadata?.contract ||
      event.metadata?.optionTicker ||
      event.label ||
      "",
  ).trim();

const isSnapshotActivityEvent = (event: ChartEvent): boolean =>
  event.metadata?.basis === "snapshot" ||
  event.metadata?.sourceBasis === "snapshot_activity" ||
  event.metadata?.confidence === "snapshot_activity";

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

const resolveBias = ({
  bullishPremium,
  bearishPremium,
  events,
}: {
  bullishPremium: number;
  bearishPremium: number;
  events: ChartEvent[];
}): ChartEventBias => {
  if (bullishPremium > bearishPremium) return "bullish";
  if (bearishPremium > bullishPremium) return "bearish";
  const bullishCount = events.filter((event) => event.bias === "bullish").length;
  const bearishCount = events.filter((event) => event.bias === "bearish").length;
  if (bullishCount > bearishCount) return "bullish";
  if (bearishCount > bullishCount) return "bearish";
  return "neutral";
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

export const summarizeFlowChartBucketPlacement = (
  events: ChartEvent[],
  model: ChartBarModel,
): FlowChartBucketDiagnostics => {
  const diagnostics: FlowChartBucketDiagnostics = {
    inputEventCount: Array.isArray(events) ? events.length : 0,
    flowEventCount: 0,
    bucketedEventCount: 0,
    droppedInvalidTimeCount: 0,
    droppedOutsideBarCount: 0,
  };

  if (!Array.isArray(events) || !events.length || !model.chartBars.length) {
    return diagnostics;
  }

  events.forEach((event) => {
    if (event.eventType !== "unusual_flow") return;
    diagnostics.flowEventCount += 1;
    const parsed = Date.parse(event.time);
    if (!Number.isFinite(parsed)) {
      diagnostics.droppedInvalidTimeCount += 1;
      return;
    }
    const barIndex = resolveBucketIndex(parsed, model.chartBars, model.chartBarRanges);
    if (barIndex < 0) {
      diagnostics.droppedOutsideBarCount += 1;
      return;
    }
    diagnostics.bucketedEventCount += 1;
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

  const grouped = new Map<number, ChartEvent[]>();
  events.forEach((event) => {
    if (event.eventType !== "unusual_flow") return;
    const parsed = Date.parse(event.time);
    if (!Number.isFinite(parsed)) return;
    const barIndex = resolveBucketIndex(parsed, model.chartBars, model.chartBarRanges);
    if (barIndex < 0) return;
    const bucket = grouped.get(barIndex) || [];
    bucket.push(event);
    grouped.set(barIndex, bucket);
  });

  const rawBuckets = Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .map(([barIndex, bucketEvents]) => {
      const totals = bucketEvents.reduce(
        (acc, event) => {
          const premium = readPremium(event);
          const contracts = readContracts(event);
          const right = readRight(event);
          acc.totalPremium += premium;
          acc.totalContracts += contracts;
          if (right === "C") acc.callPremium += premium;
          if (right === "P") acc.putPremium += premium;
          if (event.bias === "bullish") {
            acc.bullishPremium += premium || 1;
          } else if (event.bias === "bearish") {
            acc.bearishPremium += premium || 1;
          } else {
            acc.neutralPremium += premium || 1;
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
      const bias = resolveBias({ ...totals, events: bucketEvents });
      const shares = resolveSentimentShares(totals);
      const topPremium = readPremium(topEvent);

      return {
        id: `flow:${model.chartBars[barIndex].time}:${bucketEvents.length}`,
        time: model.chartBars[barIndex].time,
        barIndex,
        events: bucketEvents,
        count: bucketEvents.length,
        ...totals,
        ...shares,
        bias,
        severity: maxSeverity(bucketEvents),
        topEvent,
        topContractLabel: readContractLabel(topEvent),
        topPremium,
        tags,
        volumeSegmentRatio: 0,
      } satisfies FlowChartBucket;
    });

  const maxPremium = Math.max(...rawBuckets.map((bucket) => bucket.totalPremium), 0);
  return rawBuckets.map((bucket) => ({
    ...bucket,
    volumeSegmentRatio:
      maxPremium > 0 ? clamp(bucket.totalPremium / maxPremium, 0.08, 0.55) : 0.08,
  }));
};

export const buildFlowTooltipModel = (bucket: FlowChartBucket): FlowTooltipModel => {
  const callPutTotal = bucket.callPremium + bucket.putPremium;
  const callPercent =
    callPutTotal > 0 ? Math.round((bucket.callPremium / callPutTotal) * 100) : 0;
  const putPercent =
    callPutTotal > 0 ? Math.round((bucket.putPremium / callPutTotal) * 100) : 0;
  const bullishPercent = Math.round(bucket.bullishShare * 100);
  const bearishPercent = Math.round(bucket.bearishShare * 100);
  const neutralPercent = Math.round(bucket.neutralShare * 100);
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

  return {
    title,
    summary: `${compactCurrency(bucket.totalPremium)} premium · ${sentiment}`,
    premium: compactCurrency(bucket.totalPremium),
    contracts: bucket.totalContracts > 0 ? compactNumber(bucket.totalContracts) : "n/a",
    callPutMix: callPutTotal > 0 ? `${callPercent}% C / ${putPercent}% P` : "n/a",
    flowMix: `${bullishPercent}% bull / ${bearishPercent}% bear / ${neutralPercent}% mix`,
    topContract: bucket.topContractLabel || bucket.topEvent.label,
    tags: bucket.tags,
    sentiment,
    intensity: `${Math.round(bucket.volumeSegmentRatio * 100)}% flow intensity`,
    eventCount: bucket.count,
  };
};
