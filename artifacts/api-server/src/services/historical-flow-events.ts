import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import {
  db,
  flowEventHydrationSessionsTable,
  flowEventsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import type {
  FlowEvent as ProviderFlowEvent,
  HistoricalOptionFlowEventsResult,
} from "../providers/polygon/market-data";
import {
  filterFlowEventsForRequest,
  flowSource,
  type FlowEventsFilters,
  type FlowEventsResult,
} from "./flow-events-model";

type HistoricalFlowProviderClient = {
  getHistoricalOptionFlowEvents(input: {
    underlying: string;
    from: Date;
    to: Date;
    unusualThreshold?: number;
    maxDte?: number | null;
    tradeConcurrency?: number;
    contractPageLimit?: number;
    contractLimit?: number;
    tradePageLimit?: number;
    tradeLimit?: number;
    signal?: AbortSignal;
    onEvents?: (events: ProviderFlowEvent[]) => void | Promise<void>;
  }): Promise<HistoricalOptionFlowEventsResult | ProviderFlowEvent[]>;
  getDerivedFlowEvents?(input: {
    underlying: string;
    limit?: number;
    unusualThreshold?: number;
    from?: Date;
    to?: Date;
    snapshotPageLimit?: number;
    tradeConcurrency?: number;
    contractPageLimit?: number;
    contractLimit?: number;
    tradePageLimit?: number;
    tradeLimit?: number;
    signal?: AbortSignal;
  }): Promise<ProviderFlowEvent[]>;
};

export type HistoricalFlowProviderName = "polygon" | "massive";

type HistoricalFlowSession = {
  marketDate: string;
  windowFrom: Date;
  windowTo: Date;
};

const HISTORICAL_FLOW_STORE_BATCH_SIZE = 500;
const HISTORICAL_FLOW_WINDOW_ROW_LIMIT = 50_000;
const HISTORICAL_FLOW_DEFAULT_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1_000;
const HISTORICAL_FLOW_NONBLOCKING_STORE_READ_TIMEOUT_MS = 3_000;
const HISTORICAL_FLOW_STORE_DISABLE_COOLDOWN_MS = 5 * 60_000;
const HISTORICAL_FLOW_DIRECT_FALLBACK_CONTRACT_LIMIT = 40;
const HISTORICAL_FLOW_DIRECT_FALLBACK_SNAPSHOT_PAGE_LIMIT = 1;
const HISTORICAL_FLOW_DIRECT_FALLBACK_CONTRACT_PAGE_LIMIT = 1;
const HISTORICAL_FLOW_DIRECT_FALLBACK_TRADE_PAGE_LIMIT = 1;
const HISTORICAL_FLOW_DIRECT_FALLBACK_TRADE_LIMIT = 500;
const HISTORICAL_FLOW_DIRECT_FALLBACK_TRADE_CONCURRENCY = 4;
const HISTORICAL_FLOW_DIRECT_FALLBACK_MAX_DTE = 60;
const HISTORICAL_FLOW_DIRECT_FALLBACK_TIMEOUT_MS = 20_000;
const HISTORICAL_FLOW_SAMPLE_BASE_BUCKET_SECONDS = 5 * 60;
const HISTORICAL_FLOW_SAMPLE_MIN_BUCKET_SECONDS = 60;
const HISTORICAL_FLOW_SAMPLE_MAX_BUCKET_SECONDS = 60 * 60;
const FLOW_REGULAR_SESSION_OPEN_MINUTES = 9 * 60 + 30;
const FLOW_REGULAR_SESSION_CLOSE_MINUTES = 16 * 60;
const NEW_YORK_FLOW_SESSION_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

let historicalFlowStoreDisabled = false;
let historicalFlowStoreDisabledUntilMs = 0;
let historicalFlowStoreReadTimeoutMs =
  HISTORICAL_FLOW_NONBLOCKING_STORE_READ_TIMEOUT_MS;
let historicalFlowDirectFallbackTimeoutMs =
  HISTORICAL_FLOW_DIRECT_FALLBACK_TIMEOUT_MS;
const hydrationInFlight = new Map<string, Promise<HydrationTotals>>();

type HydrationTotals = {
  contractCount: number;
  contractsScanned: number;
  eventCount: number;
};

type NewYorkSessionParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
  minutes: number;
};

type StoreReadResult<T> = {
  value: T;
  timedOut: boolean;
};

const settleHistoricalFlowStoreRead = async <T>(
  operation: string,
  read: () => Promise<T>,
  fallback: T,
  options: { onTimeout?: () => void; timeoutMs?: number } = {},
): Promise<StoreReadResult<T>> => {
  const timeoutMs = Math.max(
    1,
    Math.floor(options.timeoutMs ?? historicalFlowStoreReadTimeoutMs),
  );
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const readPromise = read();
  const guardedRead = readPromise.then(
    (value) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      settled = true;
      return { value, timedOut: false };
    },
    (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      settled = true;
      logger.debug(
        { err: error, operation },
        "historical flow store read failed for nonblocking caller",
      );
      return { value: fallback, timedOut: false };
    },
  );

  const timeoutPromise = new Promise<StoreReadResult<T>>((resolve) => {
    timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      logger.debug(
        { operation, timeoutMs },
        "historical flow store read timed out for nonblocking caller",
      );
      options.onTimeout?.();
      resolve({ value: fallback, timedOut: true });
    }, timeoutMs);
    timeout.unref?.();
  });

  const result = await Promise.race([guardedRead, timeoutPromise]);
  if (result.timedOut) {
    readPromise.catch(() => {});
  }
  return result;
};

const numberFromDb = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const dateFromDbExpiration = (value: unknown): Date => {
  const raw = String(value || "").slice(0, 10);
  const parsed = raw ? new Date(`${raw}T00:00:00.000Z`) : new Date(0);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
};

const normalizeProviderName = (value: string): HistoricalFlowProviderName =>
  value.toLowerCase().includes("massive") ? "massive" : "polygon";

const readNewYorkSessionParts = (date: Date): NewYorkSessionParts | null => {
  const parts = NEW_YORK_FLOW_SESSION_FORMATTER.formatToParts(date);
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

const marketDateKey = (parts: Pick<NewYorkSessionParts, "year" | "month" | "day">) =>
  `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;

const isWeekendSession = (parts: Pick<NewYorkSessionParts, "weekday">): boolean =>
  parts.weekday === "Sat" || parts.weekday === "Sun";

const newYorkWallTimeToUtcDate = (
  parts: Pick<NewYorkSessionParts, "year" | "month" | "day">,
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
  const guessParts = readNewYorkSessionParts(guess);
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

export function resolveHistoricalFlowSessions(input: {
  from: Date;
  to: Date;
}): HistoricalFlowSession[] {
  const sessions = new Map<string, HistoricalFlowSession>();
  const cursor = new Date(input.from);
  cursor.setUTCHours(12, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  const last = new Date(input.to);
  last.setUTCHours(12, 0, 0, 0);
  last.setUTCDate(last.getUTCDate() + 1);

  while (cursor.getTime() <= last.getTime()) {
    const parts = readNewYorkSessionParts(cursor);
    if (parts && !isWeekendSession(parts)) {
      const marketDate = marketDateKey(parts);
      const windowFrom = newYorkWallTimeToUtcDate(
        parts,
        FLOW_REGULAR_SESSION_OPEN_MINUTES,
      );
      const windowTo = newYorkWallTimeToUtcDate(
        parts,
        FLOW_REGULAR_SESSION_CLOSE_MINUTES,
      );
      if (
        windowTo.getTime() >= input.from.getTime() &&
        windowFrom.getTime() <= input.to.getTime()
      ) {
        sessions.set(marketDate, { marketDate, windowFrom, windowTo });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return [...sessions.values()].sort(
    (left, right) => left.windowFrom.getTime() - right.windowFrom.getTime(),
  );
}

const disableHistoricalFlowStoreAfterError = (
  error: unknown,
  operation: string,
): void => {
  historicalFlowStoreDisabled = true;
  historicalFlowStoreDisabledUntilMs =
    Date.now() + HISTORICAL_FLOW_STORE_DISABLE_COOLDOWN_MS;
  logger.debug(
    { err: error, operation },
    "durable historical flow store disabled after database error",
  );
};

const isHistoricalFlowStoreDisabled = (): boolean => {
  if (!historicalFlowStoreDisabled) {
    return false;
  }
  if (
    Number.isFinite(historicalFlowStoreDisabledUntilMs) &&
    historicalFlowStoreDisabledUntilMs > 0 &&
    Date.now() >= historicalFlowStoreDisabledUntilMs
  ) {
    historicalFlowStoreDisabled = false;
    historicalFlowStoreDisabledUntilMs = 0;
    return false;
  }
  return true;
};

const providerEventKeyFor = (event: ProviderFlowEvent): string =>
  String(
    event.id ||
      [
        event.optionTicker,
        event.occurredAt.getTime(),
        event.price,
        event.size,
        event.exchange,
      ].join(":"),
  );

const toRawPayload = (event: ProviderFlowEvent): Record<string, unknown> =>
  JSON.parse(JSON.stringify(event)) as Record<string, unknown>;

export const normalizeHistoricalFlowSampleBucketSeconds = (
  value: unknown,
): number | undefined => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.max(
    HISTORICAL_FLOW_SAMPLE_MIN_BUCKET_SECONDS,
    Math.min(HISTORICAL_FLOW_SAMPLE_MAX_BUCKET_SECONDS, Math.floor(parsed)),
  );
};

function storedRowToFlowEvent(
  row: typeof flowEventsTable.$inferSelect,
): ProviderFlowEvent {
  const raw = (row.rawProviderPayload ?? {}) as Partial<ProviderFlowEvent> & {
    id?: string;
  };
  return {
    ...raw,
    id: raw.id || row.providerEventKey || row.id,
    underlying: row.underlyingSymbol,
    provider: "polygon" as const,
    basis: "trade",
    optionTicker: row.optionTicker,
    providerContractId: raw.providerContractId ?? null,
    strike: numberFromDb(row.strike),
    expirationDate: dateFromDbExpiration(row.expirationDate),
    right: row.right,
    price: numberFromDb(row.price),
    size: numberFromDb(row.size),
    premium: numberFromDb(row.premium),
    openInterest: numberFromDb(raw.openInterest),
    impliedVolatility:
      typeof raw.impliedVolatility === "number" ? raw.impliedVolatility : null,
    exchange: row.exchange,
    side: row.side,
    sentiment: row.sentiment,
    tradeConditions: Array.isArray(row.tradeConditions)
      ? row.tradeConditions
      : [],
    occurredAt: row.occurredAt,
    unusualScore: numberFromDb(raw.unusualScore),
    isUnusual: Boolean(raw.isUnusual),
    bid: typeof raw.bid === "number" ? raw.bid : null,
    ask: typeof raw.ask === "number" ? raw.ask : null,
    mark: typeof raw.mark === "number" ? raw.mark : null,
    delta: typeof raw.delta === "number" ? raw.delta : null,
    gamma: typeof raw.gamma === "number" ? raw.gamma : null,
    theta: typeof raw.theta === "number" ? raw.theta : null,
    vega: typeof raw.vega === "number" ? raw.vega : null,
    underlyingPrice:
      typeof raw.underlyingPrice === "number" ? raw.underlyingPrice : null,
    moneyness: raw.moneyness ?? null,
    distancePercent:
      typeof raw.distancePercent === "number" ? raw.distancePercent : null,
    confidence: "confirmed_trade",
    sourceBasis: "confirmed_trade",
  };
}

const countHistoricalFlowSampleBuckets = (
  sessions: HistoricalFlowSession[],
  bucketSeconds: number,
  from: Date,
  to: Date,
): number =>
  sessions.reduce((count, session) => {
    const startMs = Math.max(session.windowFrom.getTime(), from.getTime());
    const endMs = Math.min(session.windowTo.getTime(), to.getTime());
    if (endMs <= startMs) {
      return count;
    }
    return count + Math.max(1, Math.ceil((endMs - startMs) / (bucketSeconds * 1000)));
  }, 0);

const resolveHistoricalFlowSampleWindows = (input: {
  sessions: HistoricalFlowSession[];
  bucketSeconds: number;
  from: Date;
  to: Date;
}): Array<{ from: Date; to: Date }> => {
  const bucketMs = input.bucketSeconds * 1000;
  const windows: Array<{ from: Date; to: Date }> = [];
  for (const session of input.sessions) {
    const sessionStartMs = Math.max(
      session.windowFrom.getTime(),
      input.from.getTime(),
    );
    const sessionEndMs = Math.min(session.windowTo.getTime(), input.to.getTime());
    if (sessionEndMs <= sessionStartMs) {
      continue;
    }
    for (
      let startMs = sessionStartMs;
      startMs < sessionEndMs;
      startMs += bucketMs
    ) {
      windows.push({
        from: new Date(startMs),
        to: new Date(Math.min(startMs + bucketMs, sessionEndMs)),
      });
    }
  }
  return windows;
};

const historicalFlowEventTimeMs = (event: ProviderFlowEvent): number | null => {
  const occurredAt = event.occurredAt;
  if (occurredAt instanceof Date) {
    return Number.isNaN(occurredAt.getTime()) ? null : occurredAt.getTime();
  }
  const parsed = new Date(String(occurredAt ?? ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const sampleHistoricalFlowEventsForWindow = (input: {
  events: ProviderFlowEvent[];
  from: Date;
  to: Date;
  limit: number;
  bucketSeconds?: number;
}): ProviderFlowEvent[] => {
  if (input.events.length <= 1) {
    return input.events;
  }
  const sample = resolveHistoricalFlowSamplePlan({
    from: input.from,
    to: input.to,
    limit: input.limit,
    bucketSeconds: input.bucketSeconds,
  });
  const windows = resolveHistoricalFlowSampleWindows({
    sessions: resolveHistoricalFlowSessions({ from: input.from, to: input.to }),
    bucketSeconds: sample.bucketSeconds,
    from: input.from,
    to: input.to,
  });
  const selected: ProviderFlowEvent[] = [];

  for (const window of windows) {
    if (selected.length >= sample.rowLimit) {
      break;
    }
    const startMs = window.from.getTime();
    const endMs = window.to.getTime();
    const bucketEvents = input.events
      .filter((event) => {
        const timeMs = historicalFlowEventTimeMs(event);
        return timeMs !== null && timeMs >= startMs && timeMs < endMs;
      })
      .sort((left, right) => {
        const premiumDelta = Number(right.premium ?? 0) - Number(left.premium ?? 0);
        if (premiumDelta !== 0) {
          return premiumDelta;
        }
        return (
          (historicalFlowEventTimeMs(left) ?? 0) -
          (historicalFlowEventTimeMs(right) ?? 0)
        );
      })
      .slice(0, Math.min(sample.perBucketLimit, sample.rowLimit - selected.length));
    selected.push(...bucketEvents);
  }

  return selected.sort((left, right) => {
    const timeDelta =
      (historicalFlowEventTimeMs(left) ?? 0) -
      (historicalFlowEventTimeMs(right) ?? 0);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return Number(right.premium ?? 0) - Number(left.premium ?? 0);
  });
};

export function resolveHistoricalFlowSamplePlan(input: {
  from: Date;
  to: Date;
  limit: number;
  bucketSeconds?: number;
}): {
  bucketSeconds: number;
  bucketCount: number;
  perBucketLimit: number;
  rowLimit: number;
} {
  const requestedLimit = Math.max(
    1,
    Math.min(Math.floor(input.limit || 1), HISTORICAL_FLOW_WINDOW_ROW_LIMIT),
  );
  const sessions = resolveHistoricalFlowSessions(input);
  let bucketSeconds =
    normalizeHistoricalFlowSampleBucketSeconds(input.bucketSeconds) ??
    HISTORICAL_FLOW_SAMPLE_BASE_BUCKET_SECONDS;
  let bucketCount = countHistoricalFlowSampleBuckets(
    sessions,
    bucketSeconds,
    input.from,
    input.to,
  );

  while (
    bucketCount > requestedLimit &&
    bucketSeconds < HISTORICAL_FLOW_SAMPLE_MAX_BUCKET_SECONDS
  ) {
    bucketSeconds = Math.min(
      bucketSeconds * 2,
      HISTORICAL_FLOW_SAMPLE_MAX_BUCKET_SECONDS,
    );
    bucketCount = countHistoricalFlowSampleBuckets(
      sessions,
      bucketSeconds,
      input.from,
      input.to,
    );
  }

  const effectiveBucketCount = Math.max(1, bucketCount);
  const rowLimit = Math.min(HISTORICAL_FLOW_WINDOW_ROW_LIMIT, requestedLimit);
  return {
    bucketSeconds,
    bucketCount: effectiveBucketCount,
    perBucketLimit: Math.max(1, Math.ceil(rowLimit / effectiveBucketCount)),
    rowLimit,
  };
}

async function loadStoredHistoricalFlowEvents(input: {
  underlying: string;
  provider: HistoricalFlowProviderName;
  from: Date;
  to: Date;
  limit: number;
  bucketSeconds?: number;
}): Promise<ProviderFlowEvent[]> {
  if (isHistoricalFlowStoreDisabled()) {
    return [];
  }

  try {
    const sample = resolveHistoricalFlowSamplePlan({
      from: input.from,
      to: input.to,
      limit: input.limit,
      bucketSeconds: input.bucketSeconds,
    });
    const windows = resolveHistoricalFlowSampleWindows({
      sessions: resolveHistoricalFlowSessions({ from: input.from, to: input.to }),
      bucketSeconds: sample.bucketSeconds,
      from: input.from,
      to: input.to,
    });
    const rows: Array<typeof flowEventsTable.$inferSelect> = [];
    for (const window of windows) {
      if (rows.length >= sample.rowLimit) {
        break;
      }
      const bucketRows = await db
        .select()
        .from(flowEventsTable)
        .where(
          and(
            eq(flowEventsTable.underlyingSymbol, input.underlying),
            eq(flowEventsTable.provider, input.provider),
            gte(flowEventsTable.occurredAt, window.from),
            lt(flowEventsTable.occurredAt, window.to),
          ),
        )
        .orderBy(asc(flowEventsTable.occurredAt))
        .limit(Math.min(sample.perBucketLimit, sample.rowLimit - rows.length));
      rows.push(...bucketRows);
    }

    return rows.map(storedRowToFlowEvent);
  } catch (error) {
    disableHistoricalFlowStoreAfterError(error, "loadStoredHistoricalFlowEvents");
    return [];
  }
}

async function persistHistoricalFlowEvents(input: {
  underlying: string;
  provider: HistoricalFlowProviderName;
  events: ProviderFlowEvent[];
}): Promise<void> {
  if (isHistoricalFlowStoreDisabled() || input.events.length === 0) {
    return;
  }

  try {
    const now = new Date();
    for (
      let offset = 0;
      offset < input.events.length;
      offset += HISTORICAL_FLOW_STORE_BATCH_SIZE
    ) {
      const batch = input.events.slice(
        offset,
        offset + HISTORICAL_FLOW_STORE_BATCH_SIZE,
      );
      await db
        .insert(flowEventsTable)
        .values(
          batch.map((event) => ({
            provider: input.provider,
            providerEventKey: providerEventKeyFor(event),
            sourceBasis: event.sourceBasis ?? "confirmed_trade",
            underlyingSymbol: input.underlying,
            optionTicker: event.optionTicker,
            strike: String(event.strike),
            expirationDate:
              event.expirationDate instanceof Date
                ? event.expirationDate.toISOString().slice(0, 10)
                : String(event.expirationDate).slice(0, 10),
            right: event.right,
            price: String(event.price),
            size: String(event.size),
            premium: String(event.premium),
            exchange: event.exchange || "unknown",
            side: event.side || "unknown",
            sentiment: event.sentiment,
            tradeConditions: event.tradeConditions ?? [],
            occurredAt: event.occurredAt,
            rawProviderPayload: toRawPayload(event),
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [
            flowEventsTable.provider,
            flowEventsTable.providerEventKey,
          ],
          set: {
            sourceBasis: sql`excluded.source_basis`,
            price: sql`excluded.price`,
            size: sql`excluded.size`,
            premium: sql`excluded.premium`,
            exchange: sql`excluded.exchange`,
            side: sql`excluded.side`,
            sentiment: sql`excluded.sentiment`,
            tradeConditions: sql`excluded.trade_conditions`,
            rawProviderPayload: sql`excluded.raw_provider_payload`,
            updatedAt: now,
          },
        });
    }
  } catch (error) {
    disableHistoricalFlowStoreAfterError(error, "persistHistoricalFlowEvents");
  }
}

async function loadIncompleteSessions(input: {
  underlying: string;
  provider: HistoricalFlowProviderName;
  sessions: HistoricalFlowSession[];
}): Promise<HistoricalFlowSession[]> {
  if (isHistoricalFlowStoreDisabled() || input.sessions.length === 0) {
    return input.sessions;
  }

  try {
    const emptySessions: HistoricalFlowSession[] = [];
    const partialSessions: HistoricalFlowSession[] = [];
    for (const session of input.sessions) {
      const [row] = await db
        .select({
          status: flowEventHydrationSessionsTable.status,
        })
        .from(flowEventHydrationSessionsTable)
        .where(
          and(
            eq(flowEventHydrationSessionsTable.underlyingSymbol, input.underlying),
            eq(flowEventHydrationSessionsTable.provider, input.provider),
            eq(flowEventHydrationSessionsTable.marketDate, session.marketDate),
          ),
        )
        .limit(1);
      if (row?.status !== "complete") {
        const [storedRow] = await db
          .select({ id: flowEventsTable.id })
          .from(flowEventsTable)
          .where(
            and(
              eq(flowEventsTable.underlyingSymbol, input.underlying),
              eq(flowEventsTable.provider, input.provider),
              gte(flowEventsTable.occurredAt, session.windowFrom),
              lt(flowEventsTable.occurredAt, session.windowTo),
            ),
          )
          .limit(1);
        if (storedRow) {
          partialSessions.push(session);
        } else {
          emptySessions.push(session);
        }
      }
    }
    return [...emptySessions, ...partialSessions];
  } catch (error) {
    disableHistoricalFlowStoreAfterError(error, "loadIncompleteSessions");
    return input.sessions;
  }
}

async function markHydrationSession(input: {
  underlying: string;
  provider: HistoricalFlowProviderName;
  session: HistoricalFlowSession;
  status: "refreshing" | "complete" | "failed";
  contractCount?: number;
  contractsScanned?: number;
  eventCount?: number;
  errorMessage?: string | null;
}): Promise<void> {
  if (isHistoricalFlowStoreDisabled()) {
    return;
  }

  try {
    const now = new Date();
    await db
      .insert(flowEventHydrationSessionsTable)
      .values({
        underlyingSymbol: input.underlying,
        provider: input.provider,
        marketDate: input.session.marketDate,
        windowFrom: input.session.windowFrom,
        windowTo: input.session.windowTo,
        status: input.status,
        contractCount: input.contractCount ?? 0,
        contractsScanned: input.contractsScanned ?? 0,
        eventCount: input.eventCount ?? 0,
        errorMessage: input.errorMessage ?? null,
        startedAt: input.status === "refreshing" ? now : undefined,
        completedAt: input.status === "complete" ? now : undefined,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          flowEventHydrationSessionsTable.underlyingSymbol,
          flowEventHydrationSessionsTable.provider,
          flowEventHydrationSessionsTable.marketDate,
        ],
        set: {
          windowFrom: input.session.windowFrom,
          windowTo: input.session.windowTo,
          status: input.status,
          contractCount: input.contractCount ?? 0,
          contractsScanned: input.contractsScanned ?? 0,
          eventCount: input.eventCount ?? 0,
          errorMessage: input.errorMessage ?? null,
          completedAt: input.status === "complete" ? now : null,
          updatedAt: now,
        },
      });
  } catch (error) {
    disableHistoricalFlowStoreAfterError(error, "markHydrationSession");
  }
}

async function hydrateHistoricalFlowSessions(input: {
  underlying: string;
  provider: HistoricalFlowProviderName;
  client: HistoricalFlowProviderClient;
  sessions: HistoricalFlowSession[];
  unusualThreshold?: number;
  maxDte?: number | null;
}): Promise<HydrationTotals> {
  const key = [
    input.provider,
    input.underlying,
    input.sessions.map((session) => session.marketDate).join(","),
    input.unusualThreshold ?? "default",
    input.maxDte ?? "any",
  ].join(":");
  const existing = hydrationInFlight.get(key);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    const totals: HydrationTotals = {
      contractCount: 0,
      contractsScanned: 0,
      eventCount: 0,
    };
    for (const session of input.sessions) {
      await markHydrationSession({
        underlying: input.underlying,
        provider: input.provider,
        session,
        status: "refreshing",
      });
      try {
        const result = await input.client.getHistoricalOptionFlowEvents({
          underlying: input.underlying,
          from: session.windowFrom,
          to: session.windowTo,
          unusualThreshold: input.unusualThreshold,
          maxDte: input.maxDte,
          onEvents: async (events) => {
            await persistHistoricalFlowEvents({
              underlying: input.underlying,
              provider: input.provider,
              events,
            });
          },
        });
        const events = Array.isArray(result) ? result : result.events;
        const contractCount = Array.isArray(result) ? 0 : result.contractCount;
        const contractsScanned = Array.isArray(result)
          ? 0
          : result.contractsScanned;
        await persistHistoricalFlowEvents({
          underlying: input.underlying,
          provider: input.provider,
          events,
        });
        totals.contractCount += contractCount;
        totals.contractsScanned += contractsScanned;
        totals.eventCount += events.length;
        await markHydrationSession({
          underlying: input.underlying,
          provider: input.provider,
          session,
          status: "complete",
          contractCount,
          contractsScanned,
          eventCount: events.length,
        });
      } catch (error) {
        await markHydrationSession({
          underlying: input.underlying,
          provider: input.provider,
          session,
          status: "failed",
          errorMessage:
            error instanceof Error && error.message ? error.message : String(error),
        });
        throw error;
      }
    }
    return totals;
  })().finally(() => {
    hydrationInFlight.delete(key);
  });

  hydrationInFlight.set(key, task);
  return task;
}

async function loadDirectHistoricalFlowEvents(input: {
  underlying: string;
  client: HistoricalFlowProviderClient;
  from: Date;
  to: Date;
  limit?: number;
  unusualThreshold?: number;
  maxDte?: number | null;
  fallbackMaxDte?: number;
  preferDerived?: boolean;
  tradeConcurrency?: number;
  snapshotPageLimit?: number;
  contractPageLimit?: number;
  contractLimit?: number;
  tradePageLimit?: number;
  tradeLimit?: number;
  signal?: AbortSignal;
}): Promise<ProviderFlowEvent[]> {
  if (input.preferDerived && input.client.getDerivedFlowEvents) {
    try {
      return await input.client.getDerivedFlowEvents({
        underlying: input.underlying,
        from: input.from,
        to: input.to,
        limit: Math.max(1, Math.min(input.limit ?? 250, 250)),
        unusualThreshold: input.unusualThreshold,
        snapshotPageLimit: input.snapshotPageLimit,
        tradeConcurrency: input.tradeConcurrency,
        contractPageLimit: input.contractPageLimit,
        contractLimit: input.contractLimit,
        tradePageLimit: input.tradePageLimit,
        tradeLimit: input.tradeLimit,
        signal: input.signal,
      });
    } catch (error) {
      logger.debug(
        { err: error, underlying: input.underlying },
        "historical flow derived direct fallback failed; trying trade scan",
      );
    }
  }

  const maxDte =
    typeof input.maxDte === "number" && Number.isFinite(input.maxDte)
      ? input.maxDte
      : input.fallbackMaxDte;
  const result = await input.client.getHistoricalOptionFlowEvents({
    underlying: input.underlying,
    from: input.from,
    to: input.to,
    unusualThreshold: input.unusualThreshold,
    maxDte,
    tradeConcurrency: input.tradeConcurrency,
    contractPageLimit: input.contractPageLimit,
    contractLimit: input.contractLimit,
    tradePageLimit: input.tradePageLimit,
    tradeLimit: input.tradeLimit,
    signal: input.signal,
  });
  return Array.isArray(result) ? result : result.events;
}

export async function listHistoricalFlowEvents(input: {
  underlying: string;
  providerName: string;
  client: HistoricalFlowProviderClient;
  limit: number;
  filters: FlowEventsFilters;
  unusualThreshold?: number;
  from?: Date;
  to?: Date;
  blocking?: boolean;
  historicalBucketSeconds?: number;
}): Promise<FlowEventsResult> {
  const underlying = normalizeSymbol(input.underlying);
  const provider = normalizeProviderName(input.providerName);
  const to = input.to ?? new Date();
  const from =
    input.from ?? new Date(to.getTime() - HISTORICAL_FLOW_DEFAULT_LOOKBACK_MS);
  const attemptedProviders = ["polygon" as const];

  if (
    !underlying ||
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from.getTime() > to.getTime()
  ) {
    return {
      events: [],
      source: flowSource({
        provider: "none",
        status: "empty",
        attemptedProviders,
        unusualThreshold: input.unusualThreshold ?? 1,
        ibkrStatus: "empty",
        ibkrReason: "options_flow_historical_invalid_window",
      }),
    };
  }

  const sessions = resolveHistoricalFlowSessions({ from, to });
  let storedEvents: ProviderFlowEvent[] = [];
  let incompleteSessions: HistoricalFlowSession[] = sessions;

  if (input.blocking === false) {
    const storedRead = await settleHistoricalFlowStoreRead(
      "loadStoredHistoricalFlowEvents",
      () =>
        loadStoredHistoricalFlowEvents({
          underlying,
          provider,
          from,
          to,
          limit: input.limit,
          bucketSeconds: input.historicalBucketSeconds,
        }),
      [],
    );
    storedEvents = storedRead.value;

    if (storedRead.timedOut) {
      disableHistoricalFlowStoreAfterError(
        new Error("historical flow store read timed out"),
        "loadStoredHistoricalFlowEvents",
      );
    } else {
      const incompleteRead = await settleHistoricalFlowStoreRead(
        "loadIncompleteSessions",
        () =>
          loadIncompleteSessions({
            underlying,
            provider,
            sessions,
          }),
        sessions,
      );
      incompleteSessions = incompleteRead.value;

      if (incompleteRead.timedOut) {
        disableHistoricalFlowStoreAfterError(
          new Error("historical flow incomplete-session read timed out"),
          "loadIncompleteSessions",
        );
      }
    }
  } else {
    storedEvents = await loadStoredHistoricalFlowEvents({
      underlying,
      provider,
      from,
      to,
      limit: input.limit,
      bucketSeconds: input.historicalBucketSeconds,
    });
    incompleteSessions = await loadIncompleteSessions({
      underlying,
      provider,
      sessions,
    });
  }

  if (isHistoricalFlowStoreDisabled()) {
    if (input.blocking === false) {
      const controller = new AbortController();
      const directRead = await settleHistoricalFlowStoreRead(
        "loadDirectHistoricalFlowEvents",
        () =>
          loadDirectHistoricalFlowEvents({
            underlying,
            client: input.client,
            from,
            to,
            limit: input.limit,
            unusualThreshold: input.unusualThreshold,
            maxDte: input.filters.maxDte,
            fallbackMaxDte: HISTORICAL_FLOW_DIRECT_FALLBACK_MAX_DTE,
            preferDerived: true,
            snapshotPageLimit: HISTORICAL_FLOW_DIRECT_FALLBACK_SNAPSHOT_PAGE_LIMIT,
            contractPageLimit: HISTORICAL_FLOW_DIRECT_FALLBACK_CONTRACT_PAGE_LIMIT,
            contractLimit: HISTORICAL_FLOW_DIRECT_FALLBACK_CONTRACT_LIMIT,
            tradePageLimit: HISTORICAL_FLOW_DIRECT_FALLBACK_TRADE_PAGE_LIMIT,
            tradeLimit: HISTORICAL_FLOW_DIRECT_FALLBACK_TRADE_LIMIT,
            tradeConcurrency: HISTORICAL_FLOW_DIRECT_FALLBACK_TRADE_CONCURRENCY,
            signal: controller.signal,
          }),
        [],
        {
          timeoutMs: historicalFlowDirectFallbackTimeoutMs,
          onTimeout: () => {
            controller.abort();
          },
        },
      );
      const filteredCandidates = filterFlowEventsForRequest(
        directRead.value,
        input.filters,
        input.unusualThreshold,
        HISTORICAL_FLOW_WINDOW_ROW_LIMIT,
      ) as ProviderFlowEvent[];
      const filteredEvents = sampleHistoricalFlowEventsForWindow({
        events: filteredCandidates,
        from,
        to,
        limit: input.limit,
        bucketSeconds: input.historicalBucketSeconds,
      });
      return {
        events: filteredEvents,
        source: flowSource({
          provider: "polygon",
          status: filteredEvents.length ? "fallback" : "empty",
          attemptedProviders,
          unusualThreshold: input.unusualThreshold ?? 1,
          ibkrStatus: "empty",
          ibkrReason: filteredEvents.length
            ? "options_flow_historical_direct"
            : directRead.timedOut
              ? "options_flow_historical_provider_timeout"
              : "options_flow_historical_store_unavailable",
        }),
      };
    }

    try {
      storedEvents = await loadDirectHistoricalFlowEvents({
        underlying,
        client: input.client,
        from,
        to,
        unusualThreshold: input.unusualThreshold,
        maxDte: input.filters.maxDte,
      });
    } catch (error) {
      return {
        events: [],
        source: flowSource({
          provider: "polygon",
          status: "error",
          attemptedProviders,
          errorMessage:
            error instanceof Error && error.message ? error.message : String(error),
          unusualThreshold: input.unusualThreshold ?? 1,
          ibkrStatus: "empty",
          ibkrReason: "options_flow_historical_provider_error",
        }),
      };
    }
  } else if (incompleteSessions.length > 0) {
    const hydrate = hydrateHistoricalFlowSessions({
      underlying,
      provider,
      client: input.client,
      sessions: incompleteSessions,
      unusualThreshold: input.unusualThreshold,
      maxDte: input.filters.maxDte,
    });
    if (input.blocking === false) {
      hydrate.catch(() => {});
    } else {
      try {
        await hydrate;
        storedEvents = isHistoricalFlowStoreDisabled()
          ? await loadDirectHistoricalFlowEvents({
              underlying,
              client: input.client,
              from,
              to,
              unusualThreshold: input.unusualThreshold,
              maxDte: input.filters.maxDte,
            })
          : await loadStoredHistoricalFlowEvents({
              underlying,
              provider,
              from,
              to,
              limit: input.limit,
              bucketSeconds: input.historicalBucketSeconds,
            });
      } catch (error) {
        if (storedEvents.length === 0 || isHistoricalFlowStoreDisabled()) {
          try {
            storedEvents = await loadDirectHistoricalFlowEvents({
              underlying,
              client: input.client,
              from,
              to,
              unusualThreshold: input.unusualThreshold,
              maxDte: input.filters.maxDte,
            });
          } catch (directError) {
            return {
              events: [],
              source: flowSource({
                provider: "polygon",
                status: "error",
                attemptedProviders,
                errorMessage:
                  directError instanceof Error && directError.message
                    ? directError.message
                    : String(directError),
                unusualThreshold: input.unusualThreshold ?? 1,
                ibkrStatus: "empty",
                ibkrReason: "options_flow_historical_provider_error",
              }),
            };
          }
        } else {
          logger.debug(
            { err: error, underlying },
            "historical flow hydration failed; serving stored partial events",
          );
        }
      }
    }
  }

  const filteredEvents = filterFlowEventsForRequest(
    storedEvents,
    input.filters,
    input.unusualThreshold,
    input.limit,
  );
  const refreshing = incompleteSessions.length > 0 && input.blocking === false;

  return {
    events: filteredEvents,
    source: flowSource({
      provider: "polygon",
      status: filteredEvents.length ? "fallback" : "empty",
      attemptedProviders,
      unusualThreshold: input.unusualThreshold ?? 1,
      ibkrStatus: "empty",
      ibkrReason: filteredEvents.length
        ? refreshing
          ? "options_flow_historical_partial_refreshing"
          : "options_flow_historical_persisted"
        : refreshing
          ? "options_flow_historical_refreshing"
          : "options_flow_historical_empty",
    }),
  };
}

export function __resetHistoricalFlowEventsForTests(): void {
  historicalFlowStoreDisabled = false;
  historicalFlowStoreDisabledUntilMs = 0;
  historicalFlowStoreReadTimeoutMs =
    HISTORICAL_FLOW_NONBLOCKING_STORE_READ_TIMEOUT_MS;
  historicalFlowDirectFallbackTimeoutMs =
    HISTORICAL_FLOW_DIRECT_FALLBACK_TIMEOUT_MS;
  hydrationInFlight.clear();
}

export function __setHistoricalFlowStoreDisabledForTests(disabled: boolean): void {
  historicalFlowStoreDisabled = disabled;
  historicalFlowStoreDisabledUntilMs = disabled ? Number.POSITIVE_INFINITY : 0;
}

export function __setHistoricalFlowStoreReadTimeoutMsForTests(
  timeoutMs: number,
): void {
  historicalFlowStoreReadTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.floor(timeoutMs))
    : HISTORICAL_FLOW_NONBLOCKING_STORE_READ_TIMEOUT_MS;
}

export function __setHistoricalFlowDirectFallbackTimeoutMsForTests(
  timeoutMs: number,
): void {
  historicalFlowDirectFallbackTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.floor(timeoutMs))
    : HISTORICAL_FLOW_DIRECT_FALLBACK_TIMEOUT_MS;
}
