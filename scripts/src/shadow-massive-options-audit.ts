import {
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { pool } from "@workspace/db";

type JsonRecord = Record<string, unknown>;

type LedgerFillRow = {
  fillId: string;
  orderId: string;
  accountId: string;
  orderSource: string;
  sourceEventId: string | null;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  grossAmount: string;
  fees: string;
  realizedPnl: string;
  cashDelta: string;
  occurredAt: Date;
  orderPlacedAt: Date | null;
  orderFilledAt: Date | null;
  optionTicker: string | null;
  optionContract: JsonRecord | null;
  payload: JsonRecord | null;
};

type InternalSummaryRow = {
  fills: number;
  orders: number;
  distinctFillOrders: number;
  ordersWithoutFills: number;
  symbols: number;
  optionTickers: number;
  buyFills: number;
  sellFills: number;
  realizedPnl: number;
  fees: number;
  cashDelta: number;
  firstFillAt: Date | null;
  lastFillAt: Date | null;
};

type PositionSummaryRow = {
  status: string;
  positions: number;
  netQuantity: number;
  realizedPnl: number;
  fees: number;
};

type SnapshotSummaryRow = {
  source: string;
  snapshots: number;
  minNetLiquidation: number | null;
  maxNetLiquidation: number | null;
  firstAsOf: Date | null;
  lastAsOf: Date | null;
};

type ProviderConfig = {
  name: "massive";
  baseUrl: string;
  apiKey: string;
};

type Provenance = {
  source: string | null;
  trade: JsonRecord | null;
  markPrice: number | null;
  maxDelayMs: number | null;
  raw: JsonRecord | null;
};

type ProviderTrade = {
  price: number | null;
  timestampMs: number | null;
  timestampIso: string | null;
  rawTimestamp: unknown;
};

type ProviderQuote = {
  bid: number;
  ask: number;
  timestampMs: number;
  timestampIso: string;
};

type RecordedQuote = {
  bid: number | null;
  ask: number | null;
  timestampMs: number | null;
  timestampIso: string | null;
};

type ProviderAggregate = {
  timestampMs: number;
  timestampIso: string;
  close: number | null;
};

type AuditStatus =
  | "matched"
  | "nearby_close_only"
  | "no_provider_bars_near_fill"
  | "no_provider_quotes_near_fill"
  | "no_exact_bar"
  | "exact_close_mismatch"
  | "fill_within_quote_spread"
  | "quote_snapshot_mismatch"
  | "quote_snapshot_timestamp_mismatch"
  | "missing_option_ticker"
  | "missing_provenance"
  | "provider_error"
  | "unsupported_source";

type AuditResult = {
  fillId: string;
  orderId: string;
  symbol: string;
  optionTicker: string | null;
  side: "buy" | "sell";
  quantity: number;
  fillPrice: number;
  occurredAt: string;
  orderSource: string;
  provenanceSource: string | null;
  status: AuditStatus;
  reason: string;
  providerResultCount: number;
  recordedTradeAt: string | null;
  recordedTradePrice: number | null;
  recordedMarkPrice: number | null;
  firstProviderTradeAt?: string | null;
  firstProviderTradePrice?: number | null;
  recordedPriceExistsInTradeWindow?: boolean;
  recordedTimestampWithin1ms?: boolean;
  exactAggregateAt?: string | null;
  exactAggregateClose?: number | null;
  nearbyAggregateAt?: string | null;
  nearbyAggregateClose?: number | null;
  recordedQuoteAt?: string | null;
  recordedBid?: number | null;
  recordedAsk?: number | null;
  matchedQuoteAt?: string | null;
  matchedBid?: number | null;
  matchedAsk?: number | null;
  fillInsideProviderSpread?: boolean;
  fillInsideLatestProviderSpread?: boolean;
  latestQuoteAtFill?: string | null;
  latestBidAtFill?: number | null;
  latestAskAtFill?: number | null;
  recordedSnapshotCurrentAtFill?: boolean | null;
  error?: string;
};

type AuditSummary = {
  generatedAt: string;
  accountId: string;
  auditWindow: {
    start: string | null;
    end: string | null;
  };
  provider: {
    name: ProviderConfig["name"];
    baseUrl: string;
  };
  reportDir: string;
  internal: {
    ledger: InternalSummaryRow;
    positions: PositionSummaryRow[];
    snapshots: SnapshotSummaryRow[];
  };
  external: {
    total: number;
    matched: number;
    unresolved: number;
    providerErrors: number;
    recordedSnapshotsSupersededBeforeFill: number;
    bySource: SummaryBucket[];
    bySideAndSource: SummaryBucket[];
  };
};

type SummaryBucket = {
  key: string;
  total: number;
  matched: number;
  nearbyCloseOnly: number;
  unresolved: number;
  providerErrors: number;
};

type AuditOutput = {
  summary: AuditSummary;
  results: AuditResult[];
};

const TRADE_SOURCE = "massive-option-trade";
const AGGREGATE_SOURCE = "massive-option-aggregates";
const QUOTE_CROSS_CHECK_SOURCE = "massive-option-quotes-cross-check";
const AGGREGATE_WINDOW_MS = 2 * 60_000;
const DEFAULT_MAX_DELAY_MS = 60_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
// ponytail: 16 MiB bounds untrusted provider JSON in memory. If measured
// responses reach it, paginate or stream required fields before raising it.
const MAX_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;
// ponytail: 1,000 characters keeps operator output bounded. If this hides
// useful diagnostics, add structured fields instead of raising the ceiling.
const MAX_OUTPUT_STRING_LENGTH = 1_000;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;

function safeText(value: unknown): string {
  const cleaned = stripVTControlCharacters(
    String(value ?? "")
      .replace(
        /([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu,
        "$1[redacted]@",
      )
      .replace(
        /([?&](?:api[_-]?key|access[_-]?token|token|key)=)[^&#\s]*/giu,
        "$1[redacted]",
      ),
  )
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length <= MAX_OUTPUT_STRING_LENGTH
    ? cleaned
    : `${cleaned.slice(0, MAX_OUTPUT_STRING_LENGTH - 1)}…`;
}

function errorMessage(error: unknown): string {
  return (
    safeText(error instanceof Error ? error.message : error) ||
    "Unknown audit error"
  );
}

function markdownText(value: unknown): string {
  return safeText(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/\\/gu, "\\\\")
    .replace(/([`*_[\]{}()|~])/gu, "\\$1");
}

function markdownRow(values: readonly unknown[]): string {
  return `| ${values.map(markdownText).join(" | ")} |`;
}

function jsonText(value: unknown, space?: number): string {
  return (
    JSON.stringify(
      value,
      (_key, current) =>
        typeof current === "string" ? safeText(current) : current,
      space,
    ) ?? "null"
  );
}

function slug(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function readOptionalDateEnv(
  env: NodeJS.ProcessEnv,
  name: string,
): string | null {
  const value = envValue(env, name);
  if (value === null) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${name} must use YYYY-MM-DD.`);
  }
  return value;
}

function readPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number | null,
  max = Number.MAX_SAFE_INTEGER,
): number | null {
  const raw = envValue(env, name);
  if (raw === null) return fallback;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new Error(`${name} must be at most ${max}.`);
  }
  return parsed;
}

function finiteNumber(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !value.trim())
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function childRecord(parent: JsonRecord | null, key: string): JsonRecord | null {
  return asRecord(parent?.[key]);
}

function iso(value: Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = typeof value === "number" ? new Date(value) : value;
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function readHttpBaseUrl(env: NodeJS.ProcessEnv): string {
  const raw =
    envValue(env, "MASSIVE_API_BASE_URL") ?? "https://api.massive.com";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MASSIVE_API_BASE_URL must be a valid HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MASSIVE_API_BASE_URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "MASSIVE_API_BASE_URL must not include credentials, a query, or a fragment.",
    );
  }
  return url.toString().replace(/\/$/u, "");
}

function readProviderConfig(env: NodeJS.ProcessEnv): ProviderConfig {
  const massiveKey =
    envValue(env, "MASSIVE_API_KEY") ??
    envValue(env, "MASSIVE_MARKET_DATA_API_KEY");
  if (massiveKey) {
    return {
      name: "massive",
      baseUrl: readHttpBaseUrl(env),
      apiKey: massiveKey,
    };
  }

  throw new Error(
    "Missing provider credentials. Set MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY.",
  );
}

function readConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  now = new Date(),
) {
  const start = readOptionalDateEnv(env, "SHADOW_MASSIVE_AUDIT_START");
  const end = readOptionalDateEnv(env, "SHADOW_MASSIVE_AUDIT_END");
  if (start !== null && end !== null && start > end) {
    throw new Error("Shadow Massive audit window start must not exceed end.");
  }
  const reportRoot =
    envValue(env, "SHADOW_MASSIVE_AUDIT_REPORT_DIR") ??
    path.join("reports", "shadow-massive-options-audit", slug(now));
  return {
    accountId: envValue(env, "SHADOW_MASSIVE_AUDIT_ACCOUNT_ID") ?? "shadow",
    concurrency: readPositiveIntegerEnv(
      env,
      "SHADOW_MASSIVE_AUDIT_CONCURRENCY",
      4,
      16,
    )!,
    maxRows: readPositiveIntegerEnv(
      env,
      "SHADOW_MASSIVE_AUDIT_MAX_ROWS",
      null,
    ),
    start,
    end,
    reportDir: path.resolve(cwd, reportRoot),
    provider: readProviderConfig(env),
  };
}

async function readResponseText(
  response: Response,
  maximumBytes = MAX_JSON_RESPONSE_BYTES,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(
      `Provider response exceeded the ${maximumBytes}-byte limit.`,
    );
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  const chunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(
          `Provider response exceeded the ${maximumBytes}-byte limit.`,
        );
      }
      try {
        chunks.push(decoder.decode(value, { stream: true }));
      } catch {
        throw new Error("Provider returned invalid UTF-8.");
      }
    }
    try {
      chunks.push(decoder.decode());
    } catch {
      throw new Error("Provider returned invalid UTF-8.");
    }
    return chunks.join("");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function fetchJson(
  url: URL,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<JsonRecord> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, {
      signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Provider returned HTTP ${response.status}.`);
    }
    const text = await readResponseText(response);
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error("Provider returned invalid JSON.");
    }
    const record = asRecord(body);
    if (!record) {
      throw new Error("Provider JSON object required at root.");
    }
    return record;
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Provider request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  }
}

function providerUrl(config: ProviderConfig, pathname: string): URL {
  const url = new URL(
    config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`,
  );
  const basePath = url.pathname.replace(/\/+$/u, "");
  url.pathname = `${basePath}/${pathname.replace(/^\/+/, "")}`.replace(
    /\/{2,}/gu,
    "/",
  );
  url.searchParams.set("apiKey", config.apiKey);
  return url;
}

function parseProviderTrade(raw: unknown): ProviderTrade {
  const row = asRecord(raw);
  const rawTimestamp =
    row?.["sip_timestamp"] ??
    row?.["participant_timestamp"] ??
    row?.["trf_timestamp"] ??
    row?.["timestamp"] ??
    row?.["t"] ??
    null;
  const timestampNumber = finiteNumber(rawTimestamp);
  const candidateTimestampMs =
    timestampNumber === null
      ? null
      : Math.abs(timestampNumber) >= 100_000_000_000_000_000
        ? Math.floor(timestampNumber / 1_000_000)
        : Math.abs(timestampNumber) >= 100_000_000_000_000
          ? Math.floor(timestampNumber / 1_000)
          : Math.abs(timestampNumber) >= 100_000_000_000
            ? Math.floor(timestampNumber)
            : Math.floor(timestampNumber * 1_000);
  const timestampIso = iso(candidateTimestampMs);
  const timestampMs = timestampIso ? candidateTimestampMs : null;
  return {
    price: finiteNumber(row?.["price"] ?? row?.["p"]),
    timestampMs,
    timestampIso,
    rawTimestamp,
  };
}

function parseProviderAggregate(raw: unknown): ProviderAggregate | null {
  const row = asRecord(raw);
  const timestampMs = finiteNumber(row?.["t"] ?? row?.["timestamp"]);
  if (timestampMs === null) return null;
  const normalizedTimestampMs = Math.floor(timestampMs);
  const timestampIso = iso(normalizedTimestampMs);
  if (!timestampIso) return null;
  return {
    timestampMs: normalizedTimestampMs,
    timestampIso,
    close: finiteNumber(row?.["c"] ?? row?.["close"]),
  };
}

function parseProviderQuote(raw: unknown): ProviderQuote | null {
  const row = asRecord(raw);
  const bid = finiteNumber(
    row?.["bid_price"] ?? row?.["bidPrice"] ?? row?.["bp"] ?? row?.["bid"],
  );
  const ask = finiteNumber(
    row?.["ask_price"] ?? row?.["askPrice"] ?? row?.["ap"] ?? row?.["ask"],
  );
  const rawTimestamp =
    row?.["sip_timestamp"] ??
    row?.["participant_timestamp"] ??
    row?.["t"] ??
    row?.["timestamp"];
  const timestampNumber = finiteNumber(rawTimestamp);
  if (
    bid === null ||
    ask === null ||
    bid <= 0 ||
    ask < bid ||
    timestampNumber === null
  ) {
    return null;
  }
  const candidateTimestampMs =
    timestampNumber > 1e17
      ? Math.floor(timestampNumber / 1_000_000)
      : timestampNumber > 1e14
        ? Math.floor(timestampNumber / 1_000)
        : timestampNumber > 1e11
          ? Math.floor(timestampNumber)
          : Math.floor(timestampNumber * 1_000);
  const timestampIso = iso(candidateTimestampMs);
  return timestampIso
    ? { bid, ask, timestampMs: candidateTimestampMs, timestampIso }
    : null;
}

function quoteWindowEvidence(
  quotes: readonly ProviderQuote[],
  recorded: RecordedQuote,
  fillPrice: number,
  fillAtMs?: number | null,
) {
  const distance = (quote: ProviderQuote) =>
    recorded.timestampMs === null
      ? 0
      : Math.abs(quote.timestampMs - recorded.timestampMs);
  const exactSnapshot =
    recorded.bid !== null && recorded.ask !== null
      ? [...quotes]
          .filter(
            (quote) =>
              pricesEqual(quote.bid, recorded.bid) &&
              pricesEqual(quote.ask, recorded.ask),
          )
          .sort((left, right) => distance(left) - distance(right))[0] ?? null
      : null;
  const fillInsideSpread =
    [...quotes]
      .filter(
        (quote) =>
          fillPrice + 0.000001 >= quote.bid &&
          fillPrice - 0.000001 <= quote.ask,
      )
      .sort((left, right) => distance(left) - distance(right))[0] ?? null;
  const latestAtOrBeforeFill =
    fillAtMs == null
      ? null
      : [...quotes]
          .filter((quote) => quote.timestampMs <= fillAtMs + 1)
          .sort((left, right) => right.timestampMs - left.timestampMs)[0] ??
        null;
  const recordedSnapshotCurrentAtFill =
    latestAtOrBeforeFill === null ||
    recorded.bid === null ||
    recorded.ask === null
      ? null
      : pricesEqual(latestAtOrBeforeFill.bid, recorded.bid) &&
        pricesEqual(latestAtOrBeforeFill.ask, recorded.ask);
  return {
    exactSnapshot,
    exactTimestampMatch:
      recorded.timestampMs !== null &&
      exactSnapshot !== null &&
      Math.abs(exactSnapshot.timestampMs - recorded.timestampMs) <= 1,
    fillInsideSpread,
    latestAtOrBeforeFill,
    recordedSnapshotCurrentAtFill,
    fillInsideLatestSpread:
      latestAtOrBeforeFill !== null &&
      fillPrice + 0.000001 >= latestAtOrBeforeFill.bid &&
      fillPrice - 0.000001 <= latestAtOrBeforeFill.ask,
  };
}

function pricesEqual(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) < 0.000001;
}

function tradeWindowMatches(
  trades: readonly ProviderTrade[],
  fillPrice: number | null,
  recordedPrice: number | null,
  recordedAtMs: number | null,
): boolean {
  const first = trades[0] ?? null;
  return Boolean(
    first &&
      pricesEqual(first.price, fillPrice) &&
      recordedPrice !== null &&
      recordedAtMs !== null &&
      Number.isFinite(recordedAtMs) &&
      trades.some(
        (trade) =>
          pricesEqual(trade.price, recordedPrice) &&
          trade.timestampMs !== null &&
          Math.abs(trade.timestampMs - recordedAtMs) <= 1,
      ),
  );
}

function extractProvenance(row: LedgerFillRow): Provenance {
  const payload = asRecord(row.payload);
  const orderPlan = childRecord(payload, "orderPlan");
  const candidatePlan = childRecord(childRecord(payload, "candidate"), "orderPlan");
  const historicalFill =
    row.side === "sell"
      ? childRecord(payload, "exitFill")
      : childRecord(orderPlan, "historicalFill") ??
        childRecord(candidatePlan, "historicalFill");
  const trade = childRecord(historicalFill, "trade");
  const source =
    typeof historicalFill?.["source"] === "string"
      ? historicalFill["source"]
      : typeof childRecord(payload, "historicalPricing")?.["source"] === "string"
        ? (childRecord(payload, "historicalPricing")?.["source"] as string)
        : null;
  return {
    source,
    trade,
    markPrice: finiteNumber(historicalFill?.["markPrice"]),
    maxDelayMs: finiteNumber(historicalFill?.["maxDelayMs"]),
    raw: historicalFill,
  };
}

function extractRecordedQuote(row: LedgerFillRow): RecordedQuote {
  const payload = asRecord(row.payload);
  const quote = childRecord(payload, "quote");
  const liquidity =
    childRecord(payload, "liquidity") ??
    childRecord(childRecord(payload, "orderPlan"), "liquidity");
  const timestampValue =
    quote?.["updatedAt"] ??
    quote?.["quoteUpdatedAt"] ??
    quote?.["dataUpdatedAt"] ??
    null;
  const timestampMs =
    typeof timestampValue === "string" ? Date.parse(timestampValue) : Number.NaN;
  return {
    bid: finiteNumber(quote?.["bid"] ?? liquidity?.["bid"]),
    ask: finiteNumber(quote?.["ask"] ?? liquidity?.["ask"]),
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
    timestampIso: Number.isFinite(timestampMs)
      ? new Date(timestampMs).toISOString()
      : null,
  };
}

function recordedTradeAt(provenance: Provenance): string | null {
  const value = provenance.trade?.["occurredAt"];
  return typeof value === "string" && value ? value : null;
}

function recordedTradePrice(provenance: Provenance): number | null {
  return finiteNumber(provenance.trade?.["price"]);
}

async function fetchTrades(
  provider: ProviderConfig,
  ticker: string,
  fromMs: number,
  toMs: number,
): Promise<ProviderTrade[]> {
  const url = providerUrl(provider, `/v3/trades/${encodeURIComponent(ticker)}`);
  url.searchParams.set("timestamp.gte", String(BigInt(fromMs) * 1_000_000n));
  url.searchParams.set("timestamp.lte", String(BigInt(toMs) * 1_000_000n));
  url.searchParams.set("order", "asc");
  url.searchParams.set("sort", "timestamp");
  url.searchParams.set("limit", "50000");
  const body = await fetchJson(url);
  const results = Array.isArray(body["results"]) ? body["results"] : [];
  return results.map(parseProviderTrade);
}

async function fetchAggregates(
  provider: ProviderConfig,
  ticker: string,
  fromMs: number,
  toMs: number,
): Promise<ProviderAggregate[]> {
  const url = providerUrl(
    provider,
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${fromMs}/${toMs}`,
  );
  url.searchParams.set("adjusted", "true");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", "10");
  const body = await fetchJson(url);
  const results = Array.isArray(body["results"]) ? body["results"] : [];
  return results.flatMap((raw) => {
    const parsed = parseProviderAggregate(raw);
    return parsed ? [parsed] : [];
  });
}

async function fetchQuotes(
  provider: ProviderConfig,
  ticker: string,
  fromMs: number,
  toMs: number,
): Promise<ProviderQuote[]> {
  const url = providerUrl(provider, `/v3/quotes/${encodeURIComponent(ticker)}`);
  url.searchParams.set("timestamp.gte", String(BigInt(fromMs) * 1_000_000n));
  url.searchParams.set("timestamp.lte", String(BigInt(toMs) * 1_000_000n));
  url.searchParams.set("order", "asc");
  url.searchParams.set("sort", "timestamp");
  url.searchParams.set("limit", "50000");
  const body = await fetchJson(url);
  const results = Array.isArray(body["results"]) ? body["results"] : [];
  return results.flatMap((raw) => {
    const parsed = parseProviderQuote(raw);
    return parsed ? [parsed] : [];
  });
}

async function fetchLatestQuoteAtOrBefore(
  provider: ProviderConfig,
  ticker: string,
  atMs: number,
): Promise<ProviderQuote | null> {
  const url = providerUrl(provider, `/v3/quotes/${encodeURIComponent(ticker)}`);
  url.searchParams.set("timestamp.lte", String(BigInt(atMs) * 1_000_000n));
  url.searchParams.set("order", "desc");
  url.searchParams.set("sort", "timestamp");
  url.searchParams.set("limit", "1");
  const body = await fetchJson(url);
  const first = Array.isArray(body["results"]) ? body["results"][0] : null;
  return parseProviderQuote(first);
}

function unsupportedResult(row: LedgerFillRow, provenance: Provenance, status: AuditStatus, reason: string): AuditResult {
  return {
    fillId: row.fillId,
    orderId: row.orderId,
    symbol: row.symbol,
    optionTicker: row.optionTicker,
    side: row.side,
    quantity: finiteNumber(row.quantity) ?? 0,
    fillPrice: finiteNumber(row.price) ?? 0,
    occurredAt: row.occurredAt.toISOString(),
    orderSource: row.orderSource,
    provenanceSource: provenance.source,
    status,
    reason,
    providerResultCount: 0,
    recordedTradeAt: recordedTradeAt(provenance),
    recordedTradePrice: recordedTradePrice(provenance),
    recordedMarkPrice: provenance.markPrice,
  };
}

async function auditTradeFill(
  row: LedgerFillRow,
  provenance: Provenance,
  provider: ProviderConfig,
): Promise<AuditResult> {
  if (!row.optionTicker) {
    return unsupportedResult(row, provenance, "missing_option_ticker", "fill has no option ticker");
  }

  const fillPrice = finiteNumber(row.price);
  const fromMs = row.occurredAt.getTime();
  const toMs = fromMs + (provenance.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const trades = await fetchTrades(provider, row.optionTicker, fromMs, toMs);
  const first = trades[0] ?? null;
  const recordedAt = recordedTradeAt(provenance);
  const recordedAtMs = recordedAt ? Date.parse(recordedAt) : null;
  const recordedPrice = recordedTradePrice(provenance);
  const recordedPriceExistsInTradeWindow = trades.some((trade) =>
    pricesEqual(trade.price, recordedPrice),
  );
  const recordedTimestampWithin1ms =
    recordedAtMs !== null &&
    Number.isFinite(recordedAtMs) &&
    trades.some(
      (trade) =>
        trade.timestampMs !== null &&
        Math.abs(trade.timestampMs - recordedAtMs) <= 1,
    );
  const matched = tradeWindowMatches(
    trades,
    fillPrice,
    recordedPrice,
    recordedAtMs,
  );

  return {
    fillId: row.fillId,
    orderId: row.orderId,
    symbol: row.symbol,
    optionTicker: row.optionTicker,
    side: row.side,
    quantity: finiteNumber(row.quantity) ?? 0,
    fillPrice: fillPrice ?? 0,
    occurredAt: row.occurredAt.toISOString(),
    orderSource: row.orderSource,
    provenanceSource: provenance.source,
    status: matched ? "matched" : "exact_close_mismatch",
    reason: matched
      ? "first provider trade, recorded price, and recorded timestamp match"
      : "trade window did not reproduce recorded fill",
    providerResultCount: trades.length,
    recordedTradeAt: recordedAt,
    recordedTradePrice: recordedPrice,
    recordedMarkPrice: provenance.markPrice,
    firstProviderTradeAt: first?.timestampIso ?? null,
    firstProviderTradePrice: first?.price ?? null,
    recordedPriceExistsInTradeWindow,
    recordedTimestampWithin1ms,
  };
}

async function auditAggregateFill(
  row: LedgerFillRow,
  provenance: Provenance,
  provider: ProviderConfig,
): Promise<AuditResult> {
  if (!row.optionTicker) {
    return unsupportedResult(row, provenance, "missing_option_ticker", "fill has no option ticker");
  }

  const fillPrice = finiteNumber(row.price);
  const fillMs = row.occurredAt.getTime();
  const aggregates = await fetchAggregates(
    provider,
    row.optionTicker,
    fillMs - AGGREGATE_WINDOW_MS,
    fillMs + AGGREGATE_WINDOW_MS,
  );
  const exact = aggregates.find((bar) => bar.timestampMs === fillMs) ?? null;
  const nearby =
    aggregates.find((bar) => Math.abs(bar.timestampMs - fillMs) <= AGGREGATE_WINDOW_MS && pricesEqual(bar.close, fillPrice)) ??
    null;
  let status: AuditStatus = "matched";
  let reason = "exact 1-minute aggregate close matches fill price";
  if (!exact && !aggregates.length) {
    status = "no_provider_bars_near_fill";
    reason = "provider returned no 1-minute aggregate bars within +/-2 minutes";
  } else if (!exact && nearby) {
    status = "nearby_close_only";
    reason = "no exact-minute bar, but a nearby 1-minute close matches fill price";
  } else if (!exact) {
    status = "no_exact_bar";
    reason = "provider returned nearby bars but no bar at the fill minute";
  } else if (!pricesEqual(exact.close, fillPrice)) {
    status = "exact_close_mismatch";
    reason = "exact-minute aggregate close does not match fill price";
  }

  return {
    fillId: row.fillId,
    orderId: row.orderId,
    symbol: row.symbol,
    optionTicker: row.optionTicker,
    side: row.side,
    quantity: finiteNumber(row.quantity) ?? 0,
    fillPrice: fillPrice ?? 0,
    occurredAt: row.occurredAt.toISOString(),
    orderSource: row.orderSource,
    provenanceSource: provenance.source,
    status,
    reason,
    providerResultCount: aggregates.length,
    recordedTradeAt: recordedTradeAt(provenance),
    recordedTradePrice: recordedTradePrice(provenance),
    recordedMarkPrice: provenance.markPrice,
    exactAggregateAt: exact?.timestampIso ?? null,
    exactAggregateClose: exact?.close ?? null,
    nearbyAggregateAt: nearby?.timestampIso ?? null,
    nearbyAggregateClose: nearby?.close ?? null,
  };
}

async function auditQuoteFill(
  row: LedgerFillRow,
  provider: ProviderConfig,
): Promise<AuditResult> {
  const provenance: Provenance = {
    source: QUOTE_CROSS_CHECK_SOURCE,
    trade: null,
    markPrice: null,
    maxDelayMs: null,
    raw: null,
  };
  if (!row.optionTicker) {
    return unsupportedResult(
      row,
      provenance,
      "missing_option_ticker",
      "fill has no option ticker",
    );
  }
  const fillPrice = finiteNumber(row.price) ?? 0;
  const recorded = extractRecordedQuote(row);
  const centerMs = recorded.timestampMs ?? row.occurredAt.getTime();
  const radiusMs = recorded.timestampMs === null ? 120_000 : 2_000;
  const quotes = await fetchQuotes(
    provider,
    row.optionTicker,
    centerMs - radiusMs,
    centerMs + radiusMs,
  );
  const latestQuoteAtFill = await fetchLatestQuoteAtOrBefore(
    provider,
    row.optionTicker,
    row.occurredAt.getTime(),
  );
  const evidence = quoteWindowEvidence(
    latestQuoteAtFill ? [...quotes, latestQuoteAtFill] : quotes,
    recorded,
    fillPrice,
    row.occurredAt.getTime(),
  );
  const matchedQuote =
    evidence.exactSnapshot ??
    evidence.latestAtOrBeforeFill ??
    evidence.fillInsideSpread;
  let status: AuditStatus;
  let reason: string;
  if (
    evidence.exactSnapshot &&
    (recorded.timestampMs === null || evidence.exactTimestampMatch)
  ) {
    status = "matched";
    reason =
      evidence.recordedSnapshotCurrentAtFill === false
        ? "recorded bid/ask snapshot exactly matches Massive; a newer quote existed before the ledger timestamp"
        : "recorded bid/ask snapshot exactly matches Massive and remained current through the ledger timestamp";
  } else if (evidence.exactSnapshot) {
    status = "quote_snapshot_timestamp_mismatch";
    reason = "recorded bid/ask exists nearby but not at the recorded timestamp";
  } else if (evidence.fillInsideLatestSpread) {
    status = "fill_within_quote_spread";
    reason = "fill price is inside a nearby Massive quote spread";
  } else if (!quotes.length) {
    status = "no_provider_quotes_near_fill";
    reason = "Massive returned no quote ticks in the comparison window";
  } else {
    status = "quote_snapshot_mismatch";
    reason = "Massive quote ticks do not reproduce the recorded bid/ask or fill range";
  }
  return {
    fillId: row.fillId,
    orderId: row.orderId,
    symbol: row.symbol,
    optionTicker: row.optionTicker,
    side: row.side,
    quantity: finiteNumber(row.quantity) ?? 0,
    fillPrice,
    occurredAt: row.occurredAt.toISOString(),
    orderSource: row.orderSource,
    provenanceSource: provenance.source,
    status,
    reason,
    providerResultCount: quotes.length + (latestQuoteAtFill ? 1 : 0),
    recordedTradeAt: null,
    recordedTradePrice: null,
    recordedMarkPrice: null,
    recordedQuoteAt: recorded.timestampIso,
    recordedBid: recorded.bid,
    recordedAsk: recorded.ask,
    matchedQuoteAt: matchedQuote?.timestampIso ?? null,
    matchedBid: matchedQuote?.bid ?? null,
    matchedAsk: matchedQuote?.ask ?? null,
    fillInsideProviderSpread: evidence.fillInsideSpread !== null,
    fillInsideLatestProviderSpread: evidence.fillInsideLatestSpread,
    latestQuoteAtFill: evidence.latestAtOrBeforeFill?.timestampIso ?? null,
    latestBidAtFill: evidence.latestAtOrBeforeFill?.bid ?? null,
    latestAskAtFill: evidence.latestAtOrBeforeFill?.ask ?? null,
    recordedSnapshotCurrentAtFill:
      evidence.recordedSnapshotCurrentAtFill,
  };
}

async function auditFill(row: LedgerFillRow, provider: ProviderConfig): Promise<AuditResult> {
  const provenance = extractProvenance(row);
  try {
    if (!provenance.source) {
      return await auditQuoteFill(row, provider);
    }
    if (provenance.source === TRADE_SOURCE) {
      return await auditTradeFill(row, provenance, provider);
    }
    if (provenance.source === AGGREGATE_SOURCE) {
      return await auditAggregateFill(row, provenance, provider);
    }
    return unsupportedResult(
      row,
      provenance,
      "unsupported_source",
      `unsupported provenance source ${provenance.source}`,
    );
  } catch (error) {
    return {
      ...unsupportedResult(
        row,
        provenance,
        "provider_error",
        "provider request failed",
      ),
      error: errorMessage(error),
    };
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index]!, index);
      if ((index + 1) % 100 === 0) {
        console.log(`audited=${index + 1}/${values.length}`);
      }
      await delay(25);
    }
  });
  await Promise.all(workers);
  return results;
}

async function loadLedgerRows(
  accountId: string,
  maxRows: number | null,
  start: string | null,
  end: string | null,
): Promise<LedgerFillRow[]> {
  const result = await pool.query<LedgerFillRow>(
    `
      select
        f.id::text as "fillId",
        f.order_id::text as "orderId",
        f.account_id as "accountId",
        o.source as "orderSource",
        f.source_event_id::text as "sourceEventId",
        f.symbol,
        f.side::text as side,
        f.quantity::text as quantity,
        f.price::text as price,
        f.gross_amount::text as "grossAmount",
        f.fees::text as fees,
        f.realized_pnl::text as "realizedPnl",
        f.cash_delta::text as "cashDelta",
        f.occurred_at as "occurredAt",
        o.placed_at as "orderPlacedAt",
        o.filled_at as "orderFilledAt",
        coalesce(f.option_contract->>'ticker', o.option_contract->>'ticker') as "optionTicker",
        coalesce(f.option_contract, o.option_contract) as "optionContract",
        o.payload as payload
      from shadow_fills f
      join shadow_orders o on o.id = f.order_id
      where f.account_id = $1
        and f.asset_class = 'option'
        and lower(coalesce(o.payload->>'forwardTest', 'false')) <> 'true'
        and ($2::date is null or f.occurred_at >= $2::date)
        and ($3::date is null or f.occurred_at < $3::date + interval '1 day')
      order by f.occurred_at asc, f.created_at asc
      limit $4
    `,
    [accountId, start, end, maxRows],
  );
  return result.rows;
}

function internalLedgerSummaryQuery(
  accountId: string,
  start: string | null,
  end: string | null,
) {
  return {
    text: `
      with eligible_orders as (
        select *
        from shadow_orders
        where account_id = $1
          and asset_class = 'option'
          and lower(coalesce(payload->>'forwardTest', 'false')) <> 'true'
      ), active_fills as (
        select f.*
        from shadow_fills f
        join eligible_orders o on o.id = f.order_id
        where f.asset_class = 'option'
          and ($2::date is null or f.occurred_at >= $2::date)
          and ($3::date is null or f.occurred_at < $3::date + interval '1 day')
      ), active_orders as (
        select o.*
        from eligible_orders o
        where exists (select 1 from active_fills f where f.order_id = o.id)
          or (
            not exists (select 1 from shadow_fills f where f.order_id = o.id)
            and ($2::date is null or o.placed_at >= $2::date)
            and ($3::date is null or o.placed_at < $3::date + interval '1 day')
          )
      )
      select
        (select count(*)::int from active_fills) as fills,
        (select count(*)::int from active_orders) as orders,
        (select count(distinct order_id)::int from active_fills) as "distinctFillOrders",
        (
          select count(*)::int
          from active_orders o
          where not exists (select 1 from shadow_fills f where f.order_id = o.id)
        ) as "ordersWithoutFills",
        count(distinct f.symbol)::int as symbols,
        count(distinct f.option_contract->>'ticker')::int as "optionTickers",
        count(*) filter (where f.side = 'buy')::int as "buyFills",
        count(*) filter (where f.side = 'sell')::int as "sellFills",
        coalesce(sum(f.realized_pnl), 0)::float8 as "realizedPnl",
        coalesce(sum(f.fees), 0)::float8 as fees,
        coalesce(sum(f.cash_delta), 0)::float8 as "cashDelta",
        min(f.occurred_at) as "firstFillAt",
        max(f.occurred_at) as "lastFillAt"
      from active_fills f
    `,
    values: [accountId, start, end],
  };
}

async function loadInternalSummary(
  accountId: string,
  start: string | null,
  end: string | null,
): Promise<{
  ledger: InternalSummaryRow;
  positions: PositionSummaryRow[];
  snapshots: SnapshotSummaryRow[];
}> {
  const [ledgerResult, positionResult, snapshotResult] = await Promise.all([
    pool.query<InternalSummaryRow>(
      internalLedgerSummaryQuery(accountId, start, end),
    ),
    pool.query<PositionSummaryRow>(
      `
        select
          status,
          count(*)::int as positions,
          coalesce(sum(quantity), 0)::float8 as "netQuantity",
          coalesce(sum(realized_pnl), 0)::float8 as "realizedPnl",
          coalesce(sum(fees), 0)::float8 as fees
        from shadow_positions
        where account_id = $1
          and asset_class = 'option'
          and position_key not like 'shadow_equity_forward:%'
        group by status
        order by status
      `,
      [accountId],
    ),
    pool.query<SnapshotSummaryRow>(
      `
        select
          source,
          count(*)::int as snapshots,
          min(net_liquidation)::float8 as "minNetLiquidation",
          max(net_liquidation)::float8 as "maxNetLiquidation",
          min(as_of) as "firstAsOf",
          max(as_of) as "lastAsOf"
        from shadow_balance_snapshots
        where account_id = $1
        group by source
        order by source
      `,
      [accountId],
    ),
  ]);
  return {
    ledger: ledgerResult.rows[0]!,
    positions: positionResult.rows,
    snapshots: snapshotResult.rows,
  };
}

function bucket(results: readonly AuditResult[], keyOf: (result: AuditResult) => string): SummaryBucket[] {
  const buckets = new Map<string, SummaryBucket>();
  for (const result of results) {
    const key = keyOf(result);
    const current =
      buckets.get(key) ??
      {
        key,
        total: 0,
        matched: 0,
        nearbyCloseOnly: 0,
        unresolved: 0,
        providerErrors: 0,
      };
    current.total += 1;
    if (result.status === "matched") current.matched += 1;
    if (result.status === "nearby_close_only") current.nearbyCloseOnly += 1;
    if (result.status === "provider_error") current.providerErrors += 1;
    if (!["matched", "nearby_close_only"].includes(result.status)) {
      current.unresolved += 1;
    }
    buckets.set(key, current);
  }
  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function buildSummary(input: {
  generatedAt: string;
  accountId: string;
  auditWindow: AuditSummary["auditWindow"];
  provider: ProviderConfig;
  reportDir: string;
  internal: AuditSummary["internal"];
  results: AuditResult[];
}): AuditSummary {
  const matched = input.results.filter((result) => result.status === "matched").length;
  const providerErrors = input.results.filter((result) => result.status === "provider_error").length;
  const recordedSnapshotsSupersededBeforeFill = input.results.filter(
    (result) => result.recordedSnapshotCurrentAtFill === false,
  ).length;
  const unresolved = input.results.filter(
    (result) => !["matched", "nearby_close_only"].includes(result.status),
  ).length;
  return {
    generatedAt: input.generatedAt,
    accountId: input.accountId,
    auditWindow: input.auditWindow,
    provider: {
      name: input.provider.name,
      baseUrl: input.provider.baseUrl,
    },
    reportDir: input.reportDir,
    internal: input.internal,
    external: {
      total: input.results.length,
      matched,
      unresolved,
      providerErrors,
      recordedSnapshotsSupersededBeforeFill,
      bySource: bucket(input.results, (result) => result.provenanceSource ?? "missing"),
      bySideAndSource: bucket(
        input.results,
        (result) => `${result.side}:${result.provenanceSource ?? "missing"}`,
      ),
    },
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const text =
    typeof value === "string" && /^\s*[=+\-@]/u.test(raw)
      ? `'${raw}`
      : raw;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function resultToCsv(results: readonly AuditResult[]): string {
  const columns: (keyof AuditResult)[] = [
    "status",
    "reason",
    "symbol",
    "optionTicker",
    "side",
    "fillPrice",
    "occurredAt",
    "provenanceSource",
    "providerResultCount",
    "recordedTradeAt",
    "recordedTradePrice",
    "recordedMarkPrice",
    "firstProviderTradeAt",
    "firstProviderTradePrice",
    "recordedPriceExistsInTradeWindow",
    "recordedTimestampWithin1ms",
    "exactAggregateAt",
    "exactAggregateClose",
    "nearbyAggregateAt",
    "nearbyAggregateClose",
    "recordedQuoteAt",
    "recordedBid",
    "recordedAsk",
    "matchedQuoteAt",
    "matchedBid",
    "matchedAsk",
    "fillInsideProviderSpread",
    "fillInsideLatestProviderSpread",
    "latestQuoteAtFill",
    "latestBidAtFill",
    "latestAskAtFill",
    "recordedSnapshotCurrentAtFill",
    "fillId",
    "orderId",
    "error",
  ];
  return [
    columns.join(","),
    ...results.map((result) => columns.map((column) => csvCell(result[column])).join(",")),
  ].join("\n");
}

function markdownTable(rows: readonly SummaryBucket[]): string {
  return [
    "| Bucket | Total | Matched | Nearby close only | Unresolved | Provider errors |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) =>
      markdownRow([
        row.key,
        row.total,
        row.matched,
        row.nearbyCloseOnly,
        row.unresolved,
        row.providerErrors,
      ]),
    ),
  ].join("\n");
}

function buildMarkdown(output: AuditOutput): string {
  const { summary } = output;
  const unresolved = output.results.filter(
    (result) => !["matched", "nearby_close_only"].includes(result.status),
  );
  const samples = unresolved.slice(0, 25);
  return [
    "# Shadow Massive Options Audit",
    "",
    `- Generated: ${markdownText(summary.generatedAt)}`,
    `- Account: ${markdownText(summary.accountId)}`,
    `- Audited fill window (UTC): ${markdownText(
      summary.auditWindow.start ?? "all history",
    )} through ${markdownText(summary.auditWindow.end ?? "present")}`,
    `- Provider: ${markdownText(summary.provider.name)} (${markdownText(
      summary.provider.baseUrl,
    )})`,
    `- Report directory: ${markdownText(summary.reportDir)}`,
    "",
    "## Ledger Summary",
    "",
    `- Option fills: ${summary.internal.ledger.fills}`,
    `- Option orders: ${summary.internal.ledger.orders}`,
    `- Distinct fill order IDs: ${summary.internal.ledger.distinctFillOrders}`,
    `- Orders without fills: ${summary.internal.ledger.ordersWithoutFills}`,
    `- Buy fills: ${summary.internal.ledger.buyFills}`,
    `- Sell fills: ${summary.internal.ledger.sellFills}`,
    `- Symbols: ${summary.internal.ledger.symbols}`,
    `- Option tickers: ${summary.internal.ledger.optionTickers}`,
    `- Fill window: ${markdownText(
      iso(summary.internal.ledger.firstFillAt),
    )} to ${markdownText(iso(summary.internal.ledger.lastFillAt))}`,
    `- Realized P&L: ${summary.internal.ledger.realizedPnl.toFixed(2)}`,
    `- Fees: ${summary.internal.ledger.fees.toFixed(2)}`,
    `- Cash delta: ${summary.internal.ledger.cashDelta.toFixed(2)}`,
    "",
    "## External Accuracy Summary",
    "",
    `- Audited fills: ${summary.external.total}`,
    `- Exact matches: ${summary.external.matched}`,
    `- Unresolved strict mismatches: ${summary.external.unresolved}`,
    `- Provider errors: ${summary.external.providerErrors}`,
    `- Exact recorded snapshots superseded before ledger timestamp: ${summary.external.recordedSnapshotsSupersededBeforeFill}`,
    "",
    "### By Source",
    "",
    markdownTable(summary.external.bySource),
    "",
    "### By Side And Source",
    "",
    markdownTable(summary.external.bySideAndSource),
    "",
    "## Position Summary (All-History Context)",
    "",
    "- Context: not restricted to the audited fill window.",
    "",
    "| Status | Positions | Net quantity | Realized P&L | Fees |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...summary.internal.positions.map((row) =>
      markdownRow([
        row.status,
        row.positions,
        row.netQuantity,
        row.realizedPnl.toFixed(2),
        row.fees.toFixed(2),
      ]),
    ),
    "",
    "## Balance Snapshots (All-History Context)",
    "",
    "- Context: not restricted to the audited fill window.",
    "",
    "| Source | Snapshots | Min NAV | Max NAV | First | Last |",
    "| --- | ---: | ---: | ---: | --- | --- |",
    ...summary.internal.snapshots.map((row) =>
      markdownRow([
        row.source,
        row.snapshots,
        row.minNetLiquidation?.toFixed(2) ?? "",
        row.maxNetLiquidation?.toFixed(2) ?? "",
        iso(row.firstAsOf),
        iso(row.lastAsOf),
      ]),
    ),
    "",
    "## Unresolved Strict Samples",
    "",
    samples.length
      ? [
          "| Status | Symbol | Ticker | Side | Fill At | Fill Price | Reason |",
          "| --- | --- | --- | --- | --- | ---: | --- |",
          ...samples.map((result) =>
            markdownRow([
              result.status,
              result.symbol,
              result.optionTicker ?? "",
              result.side,
              result.occurredAt,
              result.fillPrice,
              result.reason,
            ]),
          ),
        ].join("\n")
      : "No unresolved strict mismatches.",
    "",
    "Full row-level details are in `results.csv` and `results.json`.",
    "",
  ].join("\n");
}

type ReportFiles = Record<"results.json" | "results.csv" | "report.md", string>;

async function assertReportDestinationAvailable(reportDir: string): Promise<void> {
  try {
    await lstat(reportDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Report destination already exists: ${reportDir}`);
}

async function publishReportFiles(reportDir: string, files: ReportFiles): Promise<void> {
  const parent = path.dirname(reportDir);
  await mkdir(parent, { recursive: true });
  const temporaryDir = await mkdtemp(
    path.join(parent, `.${path.basename(reportDir)}.tmp-`),
  );
  try {
    await Promise.all(
      Object.entries(files).map(([name, contents]) =>
        writeFile(path.join(temporaryDir, name), contents),
      ),
    );
    await rename(temporaryDir, reportDir);
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function writeReport(output: AuditOutput): Promise<void> {
  await publishReportFiles(output.summary.reportDir, {
    "results.json": `${JSON.stringify(output, null, 2)}\n`,
    "results.csv": `${resultToCsv(output.results)}\n`,
    "report.md": `${buildMarkdown(output)}\n`,
  });
}

async function main(): Promise<void> {
  const config = readConfig();
  await assertReportDestinationAvailable(config.reportDir);
  const generatedAt = new Date().toISOString();
  const internal = await loadInternalSummary(
    config.accountId,
    config.start,
    config.end,
  );
  const rows = await loadLedgerRows(
    config.accountId,
    config.maxRows,
    config.start,
    config.end,
  );
  console.log(
    jsonText({
      accountId: config.accountId,
      fills: rows.length,
      provider: config.provider.name,
      reportDir: config.reportDir,
      concurrency: config.concurrency,
    }),
  );
  const results = await mapWithConcurrency(rows, config.concurrency, (row) =>
    auditFill(row, config.provider),
  );
  const summary = buildSummary({
    generatedAt,
    accountId: config.accountId,
    auditWindow: { start: config.start, end: config.end },
    provider: config.provider,
    reportDir: config.reportDir,
    internal,
    results,
  });
  const output = { summary, results };
  await writeReport(output);
  console.log(
    jsonText(
      {
        reportDir: summary.reportDir,
        total: summary.external.total,
        matched: summary.external.matched,
        unresolved: summary.external.unresolved,
        providerErrors: summary.external.providerErrors,
        bySource: summary.external.bySource,
        bySideAndSource: summary.external.bySideAndSource,
      },
      2,
    ),
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

export const __shadowMassiveOptionsAuditInternalsForTests = {
  assertReportDestinationAvailable,
  buildMarkdown,
  csvCell,
  errorMessage,
  fetchJson,
  finiteNumber,
  jsonText,
  internalLedgerSummaryQuery,
  parseProviderAggregate,
  parseProviderQuote,
  parseProviderTrade,
  providerUrl,
  publishReportFiles,
  readConfig,
  readResponseText,
  quoteWindowEvidence,
  tradeWindowMatches,
};

if (import.meta.url === invokedPath) {
  main()
    .catch((error) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
