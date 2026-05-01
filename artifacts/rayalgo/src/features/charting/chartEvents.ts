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

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

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

const normalizeBias = (value: unknown): ChartEventBias => {
  if (value === "bullish" || value === "bearish") return value;
  return "neutral";
};

export const flowEventsToChartEvents = (
  events: Array<Record<string, unknown>> = [],
  symbol?: string,
): ChartEvent[] => {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  return (Array.isArray(events) ? events : [])
    .filter((event) => Boolean(event?.isUnusual))
    .map((event) => {
      const eventSymbol = String(
        event.ticker || event.underlying || normalizedSymbol,
      )
        .trim()
        .toUpperCase();
      const right = String(event.cp || event.right || "").toUpperCase();
      const strike = finiteNumber(event.strike);
      const premium = finiteNumber(event.premium) ?? 0;
      const unusualScore = finiteNumber(event.unusualScore) ?? 0;
      const occurredAt = String(event.occurredAt || event.time || "");
      const contractLabel =
        String(event.contract || event.optionTicker || "").trim() ||
        [eventSymbol, strike ?? "", right].filter(Boolean).join(" ");

      return {
        id: String(event.id || `${eventSymbol}:${occurredAt}:${contractLabel}`),
        symbol: eventSymbol,
        eventType: "unusual_flow",
        time: occurredAt,
        placement: "bar",
        severity: resolveFlowSeverity({ premium, unusualScore }),
        label: `${right || "OPT"} ${compactPremium(premium)}`,
        summary: `${contractLabel} unusual flow ${compactPremium(premium)}`,
        source: String(event.provider || "flow"),
        confidence: Math.max(0, Math.min(1, unusualScore / 5)),
        bias: normalizeBias(event.flowBias || event.sentiment),
        actions: ["open_flow", "open_trade", "copy_contract", "add_alert"],
        metadata: { ...event, premium, unusualScore, contractLabel },
      } satisfies ChartEvent;
    })
    .filter((event) => !normalizedSymbol || event.symbol === normalizedSymbol);
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
  const from = new Date(now);
  const intraday = !normalized.endsWith("d") && !normalized.endsWith("w");
  from.setUTCDate(from.getUTCDate() - (intraday ? 2 : 90));
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
      const bullish = bucket.filter((event) => event.bias === "bullish").length;
      const bearish = bucket.filter((event) => event.bias === "bearish").length;
      const bias =
        bullish > bearish ? "bullish" : bearish > bullish ? "bearish" : "neutral";
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
