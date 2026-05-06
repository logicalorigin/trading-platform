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

const isFlowEventRecord = (event: unknown): event is Record<string, unknown> =>
  Boolean(event && typeof event === "object" && !Array.isArray(event));

const normalizeSymbol = (value: unknown): string =>
  String(value || "").trim().toUpperCase();

const normalizeProviderContractId = (value: unknown): string =>
  String(value || "").trim();

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

const readFlowEventSymbol = (event: Record<string, unknown>): string =>
  normalizeSymbol(event.ticker || event.underlying || event.symbol);

const readFlowEventChartTime = (event: Record<string, unknown>): string => {
  const candidates = [
    event.occurredAt,
    event.timestamp,
    event.dateTime,
    event.createdAt,
    event.updatedAt,
    event.time,
  ];
  for (const candidate of candidates) {
    if (candidate instanceof Date && Number.isFinite(candidate.getTime())) {
      return candidate.toISOString();
    }
    if (typeof candidate === "number") {
      if (Number.isFinite(candidate) && candidate > 0) {
        const timestamp = candidate > 10_000_000_000 ? candidate : candidate * 1000;
        return new Date(timestamp).toISOString();
      }
      continue;
    }
    if (typeof candidate !== "string") {
      continue;
    }
    const raw = String(candidate).trim();
    if (!raw) {
      continue;
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return "";
};

const getMergedFlowEventKey = (event: Record<string, unknown>): string =>
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

export const mergeFlowEventFeeds = (
  ...feeds: Array<Array<Record<string, unknown>> | null | undefined>
): Array<Record<string, unknown>> => {
  const mergedByKey = new Map<string, Record<string, unknown>>();
  feeds.flat().forEach((event) => {
    if (!isFlowEventRecord(event)) return;
    const key = getMergedFlowEventKey(event);
    if (!mergedByKey.has(key)) mergedByKey.set(key, event);
  });
  return Array.from(mergedByKey.values());
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

export const flowEventsToChartEvents = (
  events: Array<Record<string, unknown>> = [],
  symbol?: string,
): ChartEvent[] => {
  const normalizedSymbol = normalizeSymbol(symbol);
  return (Array.isArray(events) ? events : [])
    .filter(isFlowEventRecord)
    .map((event) => {
      const eventSymbol = String(
        event.ticker || event.underlying || event.symbol || normalizedSymbol,
      )
        .trim()
        .toUpperCase();
      const right = String(event.cp || event.right || "").toUpperCase();
      const strike = finiteNumber(event.strike);
      const premium = finiteNumber(event.premium) ?? 0;
      const unusualScore = finiteNumber(event.unusualScore) ?? 0;
      const occurredAt = readFlowEventChartTime(event);
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

      return {
        id: String(event.id || `${eventSymbol}:${occurredAt}:${contractLabel}`),
        symbol: eventSymbol,
        eventType: "unusual_flow",
        time: occurredAt,
        placement: "bar",
        severity: resolveFlowSeverity({ premium, unusualScore }),
        label: `${right || "OPT"} ${compactPremium(premium)}`,
        summary: `${contractLabel} ${flowKind} ${compactPremium(premium)}`,
        source: String(event.provider || "flow"),
        confidence: Math.max(0, Math.min(1, unusualScore / 5)),
        bias: normalizeBias(event.flowBias || event.sentiment),
        actions: ["open_flow", "open_trade", "copy_contract", "add_alert"],
        metadata: {
          ...event,
          premium,
          unusualScore,
          isUnusual: Boolean(event.isUnusual),
          sourceBasis: sourceBasis || undefined,
          timeBasis: snapshotDerived ? "snapshot_observed" : "trade_reported",
          contractLabel,
        },
      } satisfies ChartEvent;
    })
    .filter(
      (event) =>
        event.time && (!normalizedSymbol || event.symbol === normalizedSymbol),
    );
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
