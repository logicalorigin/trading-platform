import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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

type ProviderAggregate = {
  timestampMs: number;
  timestampIso: string;
  close: number | null;
};

type AuditStatus =
  | "matched"
  | "nearby_close_only"
  | "no_provider_bars_near_fill"
  | "no_exact_bar"
  | "exact_close_mismatch"
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
  error?: string;
};

type AuditSummary = {
  generatedAt: string;
  accountId: string;
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
const AGGREGATE_WINDOW_MS = 2 * 60_000;
const DEFAULT_MAX_DELAY_MS = 60_000;

function slug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readPositiveIntegerEnv(name: string, fallback: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function readOptionalPositiveIntegerEnv(name: string): number | null {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function finiteNumber(value: unknown): number | null {
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

function readProviderConfig(): ProviderConfig {
  const massiveKey =
    process.env["MASSIVE_API_KEY"] ?? process.env["MASSIVE_MARKET_DATA_API_KEY"];
  if (massiveKey?.trim()) {
    return {
      name: "massive",
      baseUrl: (process.env["MASSIVE_API_BASE_URL"] ?? "https://api.massive.com").replace(/\/$/, ""),
      apiKey: massiveKey.trim(),
    };
  }

  throw new Error(
    "Missing provider credentials. Set MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY.",
  );
}

function readConfig() {
  const reportRoot =
    process.env["SHADOW_MASSIVE_AUDIT_REPORT_DIR"] ??
    path.join("reports", "shadow-massive-options-audit", slug());
  return {
    accountId: process.env["SHADOW_MASSIVE_AUDIT_ACCOUNT_ID"] ?? "shadow",
    concurrency: readPositiveIntegerEnv("SHADOW_MASSIVE_AUDIT_CONCURRENCY", 4, 16),
    maxRows: readOptionalPositiveIntegerEnv("SHADOW_MASSIVE_AUDIT_MAX_ROWS"),
    reportDir: path.resolve(process.cwd(), reportRoot),
    provider: readProviderConfig(),
  };
}

async function fetchJson(url: URL): Promise<JsonRecord> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 240)}`);
  }
  const body = await response.json();
  return asRecord(body) ?? {};
}

function providerUrl(config: ProviderConfig, pathname: string): URL {
  const url = new URL(pathname, `${config.baseUrl}/`);
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
  const timestampMs =
    timestampNumber === null
      ? null
      : timestampNumber > 10_000_000_000_000
        ? Math.floor(timestampNumber / 1_000_000)
        : timestampNumber > 10_000_000_000
          ? Math.floor(timestampNumber / 1_000)
          : Math.floor(timestampNumber);
  return {
    price: finiteNumber(row?.["price"] ?? row?.["p"]),
    timestampMs,
    timestampIso: iso(timestampMs),
    rawTimestamp,
  };
}

function parseProviderAggregate(raw: unknown): ProviderAggregate | null {
  const row = asRecord(raw);
  const timestampMs = finiteNumber(row?.["t"] ?? row?.["timestamp"]);
  if (timestampMs === null) return null;
  return {
    timestampMs: Math.floor(timestampMs),
    timestampIso: new Date(Math.floor(timestampMs)).toISOString(),
    close: finiteNumber(row?.["c"] ?? row?.["close"]),
  };
}

function pricesEqual(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) < 0.000001;
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
    pricesEqual(trade.price, recordedPrice ?? fillPrice),
  );
  const recordedTimestampWithin1ms =
    recordedAtMs !== null &&
    trades.some((trade) =>
      trade.timestampMs !== null && Math.abs(trade.timestampMs - recordedAtMs) <= 1,
    );
  const firstProviderTradeMatches =
    first !== null && pricesEqual(first.price, fillPrice);
  const matched =
    firstProviderTradeMatches &&
    recordedPriceExistsInTradeWindow &&
    recordedTimestampWithin1ms;

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

async function auditFill(row: LedgerFillRow, provider: ProviderConfig): Promise<AuditResult> {
  const provenance = extractProvenance(row);
  if (!provenance.source) {
    return unsupportedResult(row, provenance, "missing_provenance", "fill has no historical provider provenance");
  }

  try {
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
      error: error instanceof Error ? error.message : String(error),
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

async function loadLedgerRows(accountId: string, maxRows: number | null): Promise<LedgerFillRow[]> {
  const limitSql = maxRows ? "limit $2" : "";
  const values: unknown[] = maxRows ? [accountId, maxRows] : [accountId];
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
      order by f.occurred_at asc, f.created_at asc
      ${limitSql}
    `,
    values,
  );
  return result.rows;
}

async function loadInternalSummary(accountId: string): Promise<{
  ledger: InternalSummaryRow;
  positions: PositionSummaryRow[];
  snapshots: SnapshotSummaryRow[];
}> {
  const [ledgerResult, positionResult, snapshotResult] = await Promise.all([
    pool.query<InternalSummaryRow>(
      `
        select
          (select count(*)::int from shadow_fills where account_id = $1 and asset_class = 'option') as fills,
          (select count(*)::int from shadow_orders where account_id = $1 and asset_class = 'option') as orders,
          (select count(distinct order_id)::int from shadow_fills where account_id = $1 and asset_class = 'option') as "distinctFillOrders",
          (
            select count(*)::int
            from shadow_orders o
            where o.account_id = $1
              and o.asset_class = 'option'
              and not exists (select 1 from shadow_fills f where f.order_id = o.id)
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
        from shadow_fills f
        where f.account_id = $1
          and f.asset_class = 'option'
      `,
      [accountId],
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
  provider: ProviderConfig;
  reportDir: string;
  internal: AuditSummary["internal"];
  results: AuditResult[];
}): AuditSummary {
  const matched = input.results.filter((result) => result.status === "matched").length;
  const providerErrors = input.results.filter((result) => result.status === "provider_error").length;
  const unresolved = input.results.filter(
    (result) => !["matched", "nearby_close_only"].includes(result.status),
  ).length;
  return {
    generatedAt: input.generatedAt,
    accountId: input.accountId,
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
  const text = String(value);
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
      `| ${[
        row.key,
        row.total,
        row.matched,
        row.nearbyCloseOnly,
        row.unresolved,
        row.providerErrors,
      ].join(" | ")} |`,
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
    `- Generated: ${summary.generatedAt}`,
    `- Account: ${summary.accountId}`,
    `- Provider: ${summary.provider.name} (${summary.provider.baseUrl})`,
    `- Report directory: ${summary.reportDir}`,
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
    `- Fill window: ${iso(summary.internal.ledger.firstFillAt)} to ${iso(summary.internal.ledger.lastFillAt)}`,
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
    "",
    "### By Source",
    "",
    markdownTable(summary.external.bySource),
    "",
    "### By Side And Source",
    "",
    markdownTable(summary.external.bySideAndSource),
    "",
    "## Position Summary",
    "",
    "| Status | Positions | Net quantity | Realized P&L | Fees |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...summary.internal.positions.map((row) =>
      `| ${[
        row.status,
        row.positions,
        row.netQuantity,
        row.realizedPnl.toFixed(2),
        row.fees.toFixed(2),
      ].join(" | ")} |`,
    ),
    "",
    "## Balance Snapshots",
    "",
    "| Source | Snapshots | Min NAV | Max NAV | First | Last |",
    "| --- | ---: | ---: | ---: | --- | --- |",
    ...summary.internal.snapshots.map((row) =>
      `| ${[
        row.source,
        row.snapshots,
        row.minNetLiquidation?.toFixed(2) ?? "",
        row.maxNetLiquidation?.toFixed(2) ?? "",
        iso(row.firstAsOf),
        iso(row.lastAsOf),
      ].join(" | ")} |`,
    ),
    "",
    "## Unresolved Strict Samples",
    "",
    samples.length
      ? [
          "| Status | Symbol | Ticker | Side | Fill At | Fill Price | Reason |",
          "| --- | --- | --- | --- | --- | ---: | --- |",
          ...samples.map((result) =>
            `| ${[
              result.status,
              result.symbol,
              result.optionTicker ?? "",
              result.side,
              result.occurredAt,
              result.fillPrice,
              result.reason,
            ].join(" | ")} |`,
          ),
        ].join("\n")
      : "No unresolved strict mismatches.",
    "",
    "Full row-level details are in `results.csv` and `results.json`.",
    "",
  ].join("\n");
}

async function writeReport(output: AuditOutput): Promise<void> {
  await mkdir(output.summary.reportDir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(output.summary.reportDir, "results.json"),
      `${JSON.stringify(output, null, 2)}\n`,
    ),
    writeFile(path.join(output.summary.reportDir, "results.csv"), `${resultToCsv(output.results)}\n`),
    writeFile(path.join(output.summary.reportDir, "report.md"), `${buildMarkdown(output)}\n`),
  ]);
}

async function main(): Promise<void> {
  const config = readConfig();
  const generatedAt = new Date().toISOString();
  const internal = await loadInternalSummary(config.accountId);
  const rows = await loadLedgerRows(config.accountId, config.maxRows);
  console.log(
    JSON.stringify({
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
    provider: config.provider,
    reportDir: config.reportDir,
    internal,
    results,
  });
  const output = { summary, results };
  await writeReport(output);
  console.log(
    JSON.stringify(
      {
        reportDir: summary.reportDir,
        total: summary.external.total,
        matched: summary.external.matched,
        unresolved: summary.external.unresolved,
        providerErrors: summary.external.providerErrors,
        bySource: summary.external.bySource,
        bySideAndSource: summary.external.bySideAndSource,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
