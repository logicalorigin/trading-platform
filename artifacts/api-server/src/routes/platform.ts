import { Router, type IRouter, type Request, type Response } from "express";
import { once } from "node:events";
import {
  GetBarsQueryParams,
  GetBarsResponse,
  GetNewsQueryParams,
  GetNewsResponse,
  GetOptionChainQueryParams,
  GetOptionChainResponse,
  GetOptionExpirationsQueryParams,
  GetOptionExpirationsResponse,
  ResolveOptionContractQueryParams,
  ResolveOptionContractResponse,
  GetOptionChartBarsQueryParams,
  GetOptionChartBarsResponse,
  GetOptionQuoteSnapshotsBody,
  GetOptionQuoteSnapshotsResponse,
  GetGexSnapshotsQueryParams,
  GetGexSnapshotsResponse,
  GetQuoteSnapshotsQueryParams,
  GetQuoteSnapshotsResponse,
  GetGexDashboardResponse,
  SearchUniverseTickersQueryParams,
  SearchUniverseTickersResponse,
  GetSessionResponse,
  GetFlexHealthResponse,
  ListAccountsQueryParams,
  ListAccountsResponse,
  ListBrokerConnectionsResponse,
  GetFlowPremiumDistributionQueryParams,
  GetFlowPremiumDistributionResponse,
  ListFlowEventsQueryParams,
  ListFlowEventsResponse,
  ListAggregateFlowEventsQueryParams,
  ListAggregateFlowEventsResponse,
  GetFlowUniverseResponse,
  ListOrdersQueryParams,
  ListOrdersResponse,
  ListPositionsQueryParams,
  ListPositionsResponse,
  PlaceOrderBody,
  ReplaceOrderBody,
  CancelAccountOrderBody,
  CancelOrderBody,
  BatchOptionChainsBody,
  BatchOptionChainsResponse,
} from "@workspace/api-zod";
import {
  cancelOrder,
  createWatchlist,
  deleteWatchlist,
  getBarsWithDebug,
  benchmarkOptionsFlowScannerTickerPass,
  batchOptionChains,
  getNews,
  getOptionChainWithDebug,
  getOptionExpirationsWithDebug,
  OPTION_EXPIRATION_PUBLIC_FOREGROUND_WAIT_MS,
  OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS,
  getOptionChartBarsWithDebug,
  resolveOptionContractWithDebug,
  getQuoteSnapshots,
  getRuntimeDiagnostics,
  getRuntimeDiagnosticsCompact,
  getFlowPremiumDistribution,
  getOptionsFlowUniverse,
  getSession,
  getUniverseLogos,
  listBrokerConnections,
  listExecutions,
  listAggregateFlowEvents,
  listFlowEvents,
  listOrders,
  listWatchlistsForCurrentUser,
  addWatchlistSymbol,
  placeOrder,
  previewOrder,
  removeWatchlistSymbol,
  reorderWatchlistSymbols,
  replaceOrder,
  searchUniverseTickers,
  submitRawOrders,
  updateWatchlist,
} from "../services/platform";
import type { FootprintSourcePreference } from "@workspace/ibkr-contracts";
import {
  buildGexDashboardHttpCacheMetadata,
  getCachedGexDashboardHttpCacheEntry,
  getGexDashboardData,
  getGexProjectionData,
  getGexSnapshots,
  getGexZeroGammaData,
} from "../services/gex";
import {
  fetchAccountSnapshotPayload,
  fetchExecutionSnapshotPayload,
  fetchOptionQuoteSnapshotPayload,
  fetchOrderSnapshotPayload,
  fetchQuoteSnapshotPayload,
  readOptionQuoteDemandSnapshotPayload,
  resolveQuoteStreamSource,
  subscribeAccountSnapshots,
  subscribeExecutionSnapshots,
  subscribeOptionChains,
  subscribeOptionQuoteSnapshots,
  subscribeOrderSnapshots,
  subscribeQuoteSnapshots,
} from "../services/bridge-streams";
import type { OptionQuoteSnapshotPayload } from "../services/bridge-option-quote-stream";
import {
  fetchShadowAccountSnapshotPayload,
  subscribeShadowAccountSnapshots,
} from "../services/shadow-account-streams";
import {
  ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS,
  ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS,
  fetchAccountPagePrimaryPayload,
  recordAccountPageStreamWrite,
  subscribeAccountPageSnapshots,
} from "../services/account-page-streams";
import { loadStoredMarketBarsBySymbol } from "../services/market-data-store";
import {
  readSignalMonitorLocalMemoryBars,
  type SignalMonitorLocalBarCacheTimeframe,
} from "../services/signal-monitor-local-bar-cache";
import { normalizeSymbol } from "../lib/values";
import {
  getCurrentStockMinuteAggregates,
  getRecentStockMinuteAggregateHistory,
  getStockAggregateStreamDiagnostics,
  isStockAggregateStreamingAvailable,
  subscribeMutableStockMinuteAggregates,
  type StockMinuteAggregateMessage,
} from "../services/stock-aggregate-stream";
import { getVolumeFootprints } from "../services/volume-footprints";
import {
  recordSseStreamClose,
  recordSseStreamOpen,
  serializeSseEventData,
  type SseStreamCloseReason,
} from "../services/sse-stream-diagnostics";
import {
  cancelAccountOrder,
  getAccountAllocation,
  getAccountCashActivity,
  getAccountClosedTrades,
  getAccountEquityHistory,
  getAccountOrders,
  getAccountPositions,
  getAccountPositionsAtDate,
  getAccountRisk,
  getAccountSummary,
  getFlexHealth,
  hasSnapTradeBackedAccounts,
  listAccounts,
  testFlexToken,
} from "../services/account";
import type { AccountRange } from "../services/account-ranges";
import { isHttpResourceNotModified } from "../lib/http-cache";
import { getProviderConfiguration, type RuntimeMode } from "../lib/runtime";
import {
  buildRealAccountUnavailableProblem,
  shouldAdmitAccountRoute,
} from "../services/account-route-admission";
import {
  placeShadowOrder,
  previewShadowOrder,
  resolveCurrentUserShadowAccountId,
  runShadowWatchlistBacktest,
  SHADOW_ACCOUNT_ID,
  withCallerShadowScope,
} from "../services/shadow-account";
import { runWithShadowAccountId } from "../services/shadow-account-context";
import { requireEntitlementCsrf, requireUser } from "./auth";

const router: IRouter = Router();
let nextOptionQuoteSseDemandId = 1;
const STOCK_AGGREGATE_STREAM_SNAPSHOT_HISTORY_LIMIT = 24;
// Yield to the event loop every N snapshot writes so a large multi-symbol
// stream-open burst doesn't monopolize the single loop (see
// writeSnapshotAggregates). Mirrors the signal-monitor eval-yield idiom.
const SSE_SNAPSHOT_YIELD_EVERY = 16;
type ParsedGexDashboardResponse = ReturnType<typeof GetGexDashboardResponse.parse>;
const parsedGexDashboardResponses = new WeakMap<object, ParsedGexDashboardResponse>();

const ibkrConfiguredForRealAccounts = () => getProviderConfiguration().ibkr;

const admitAccountRoute = async (
  res: Response,
  accountId?: unknown,
): Promise<boolean> => {
  const ibkrConfigured = ibkrConfiguredForRealAccounts();
  // Only pay the (cached) SnapTrade presence lookup when IBKR alone would
  // reject the route — connected SnapTrade accounts also admit real
  // account routes under the multi-broker model.
  const snapTradeAccountsPresent =
    !shouldAdmitAccountRoute({ accountId, ibkrConfigured }) &&
    (await hasSnapTradeBackedAccounts());
  if (
    shouldAdmitAccountRoute({
      accountId,
      ibkrConfigured,
      snapTradeAccountsPresent,
    })
  ) {
    return true;
  }

  res.status(503).type("application/problem+json").json(
    buildRealAccountUnavailableProblem(),
  );
  return false;
};
const stockAggregateStreamSessions = new Map<
  string,
  {
    token: symbol;
    setSymbols(symbols: string[]): Promise<void>;
  }
>();

type AccountPositionsRouteResponse = Awaited<
  ReturnType<typeof getAccountPositions>
>;
type AccountPositionsRouteRow = AccountPositionsRouteResponse["positions"][number];

function finiteRouteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function legacyPositionAssetClass(row: AccountPositionsRouteRow): "equity" | "option" {
  const label = String(row.assetClass || "").trim().toLowerCase();
  return row.optionContract || label.includes("option") ? "option" : "equity";
}

function legacyPositionsAccountId(accountId: string | undefined): string {
  return typeof accountId === "string" && accountId.trim()
    ? accountId.trim()
    : "combined";
}

function mapAccountPositionsToLegacyPositions(
  response: AccountPositionsRouteResponse,
) {
  return {
    positions: response.positions.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      symbol: row.symbol,
      assetClass: legacyPositionAssetClass(row),
      quantity: finiteRouteNumber(row.quantity),
      averagePrice: finiteRouteNumber(row.averageCost),
      marketPrice: finiteRouteNumber(row.mark),
      marketValue: finiteRouteNumber(row.marketValue),
      unrealizedPnl: finiteRouteNumber(row.unrealizedPnl),
      unrealizedPnlPercent: finiteRouteNumber(row.unrealizedPnlPercent),
      optionContract: row.optionContract ?? null,
      openedAt: row.openedAt ?? null,
      openedAtSource: row.openedAtSource ?? null,
      quote: row.quote ?? row.optionQuote ?? null,
    })),
  };
}

const LOGO_PROXY_ALLOWED_HOSTS = new Set([
  "s3-symbol-logo.tradingview.com",
  "api.massive.com",
  "storage.googleapis.com",
  "financialmodelingprep.com",
  "images.financialmodelingprep.com",
]);
const LOGO_PROXY_TIMEOUT_MS = 2_000;

function sameOriginLogoUrl(logoUrl: string | null): string | null {
  if (!logoUrl || logoUrl.startsWith("data:") || logoUrl.startsWith("/")) {
    return logoUrl;
  }
  try {
    const parsed = new URL(logoUrl);
    if (!LOGO_PROXY_ALLOWED_HOSTS.has(parsed.hostname)) {
      return null;
    }
    return `/api/universe/logo-proxy?url=${encodeURIComponent(logoUrl)}`;
  } catch {
    return null;
  }
}
function readFetchPriority(req: Request): number | undefined {
  const raw =
    req.get("x-pyrus-fetch-priority") ?? readQueryString(req, "fetchPriority");
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readRequestFamily(req: Request): string | undefined {
  const raw =
    req.get("x-pyrus-request-family") ??
    readQueryString(req, "requestFamily") ??
    readQueryString(req, "family");
  if (!raw?.trim()) {
    return undefined;
  }
  return raw.trim().slice(0, 64);
}

function readQueryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === "string");
    return first;
  }
  return undefined;
}

function normalizeStreamSymbols(rawSymbols: unknown): string[] {
  const values = Array.isArray(rawSymbols)
    ? rawSymbols
    : typeof rawSymbols === "string"
      ? rawSymbols.split(",")
      : [];
  return Array.from(
    new Set(
      values
        .map((symbol) => String(symbol).trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}
const IBKR_BRIDGE_PUBLIC_BASE_URL_ENV_NAMES = [
  "IBKR_BRIDGE_API_BASE_URL",
  "PYRUS_PUBLIC_API_BASE_URL",
  "PUBLIC_API_BASE_URL",
];
const REPLIT_PUBLIC_HOST_ENV_NAMES = [
  "REPLIT_DEV_DOMAIN",
  "REPLIT_DOMAINS",
];
const SSE_MAX_BUFFERED_CHUNKS = Math.max(
  1,
  Number.parseInt(process.env["IBKR_SSE_MAX_BUFFERED_CHUNKS"] ?? "256", 10) ||
    256,
);
// 15s (was 5s): under the event-loop saturation that freezes SSE delivery for
// 30-90s, a 5s drain window server-CLOSED otherwise-healthy price streams the
// instant the loop unblocked and found the client mid-catch-up, forcing a
// reconnect flap. A longer window lets a transient stall drain instead of
// dropping the connection. Override via IBKR_SSE_DRAIN_TIMEOUT_MS.
const SSE_DRAIN_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env["IBKR_SSE_DRAIN_TIMEOUT_MS"] ?? "15000", 10) ||
    15_000,
);
const QUOTE_STREAM_SNAPSHOT_REFRESH_MS = Math.max(
  10_000,
  Number.parseInt(
    process.env["QUOTE_STREAM_SNAPSHOT_REFRESH_MS"] ?? "60000",
    10,
  ) || 60_000,
);
const OPTION_CHART_BARS_ROUTE_CACHE_TTL_MS = Math.max(
  1_000,
  Number.parseInt(
    process.env["OPTION_CHART_BARS_ROUTE_CACHE_TTL_MS"] ?? "60000",
    10,
  ) || 60_000,
);
const OPTION_CHART_BARS_ROUTE_STALE_TTL_MS = Math.max(
  OPTION_CHART_BARS_ROUTE_CACHE_TTL_MS,
  Number.parseInt(
    process.env["OPTION_CHART_BARS_ROUTE_STALE_TTL_MS"] ?? "300000",
    10,
  ) || 300_000,
);
type OptionChartBarsRouteResult = Awaited<
  ReturnType<typeof getOptionChartBarsWithDebug>
>;
type OptionChartBarsRouteQuery = ReturnType<
  typeof GetOptionChartBarsQueryParams.parse
>;
const optionChartBarsRouteCache = new Map<
  string,
  {
    value: OptionChartBarsRouteResult;
    expiresAt: number;
    staleExpiresAt: number;
  }
>();
const optionChartBarsRouteInFlight = new Map<
  string,
  Promise<OptionChartBarsRouteResult>
>();

function isLoopbackHost(host: string): boolean {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    host.startsWith("[::1]")
  );
}

function getFirstHeaderValue(value: string | undefined): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function buildOptionChartBarsRouteCacheKey(
  query: OptionChartBarsRouteQuery,
): string {
  return JSON.stringify({
    underlying: query.underlying,
    expirationDate: query.expirationDate.toISOString(),
    strike: query.strike,
    right: query.right,
    optionTicker: query.optionTicker ?? null,
    providerContractId: query.providerContractId ?? null,
    timeframe: query.timeframe,
    limit: query.limit ?? null,
    from: query.from?.toISOString() ?? null,
    to: query.to?.toISOString() ?? null,
    historyCursor: query.historyCursor ?? null,
    preferCursor: Boolean(query.preferCursor),
    outsideRth: Boolean(query.outsideRth),
  });
}

function readCachedOptionChartBarsRouteResult(
  key: string,
  { allowStale = false }: { allowStale?: boolean } = {},
): OptionChartBarsRouteResult | null {
  const cached = optionChartBarsRouteCache.get(key);
  if (!cached) {
    return null;
  }

  const now = Date.now();
  if (cached.staleExpiresAt <= now) {
    optionChartBarsRouteCache.delete(key);
    return null;
  }
  if (cached.expiresAt <= now && !allowStale) {
    return null;
  }

  return cached.value;
}

function withCachedOptionChartBarsDebug(
  value: OptionChartBarsRouteResult,
  input: {
    stale: boolean;
    degraded?: boolean;
    reason?: string | null;
  },
): OptionChartBarsRouteResult {
  return {
    ...value,
    historyPage: value.historyPage
      ? {
          ...value.historyPage,
          cacheStatus: "hit",
          hydrationStatus: input.stale
            ? "warming"
            : value.historyPage.hydrationStatus,
        }
      : value.historyPage,
    debug: {
      ...value.debug,
      cacheStatus: "hit",
      stale: input.stale,
      degraded:
        input.degraded ?? value.debug.degraded ?? !value.bars.length,
      reason: input.reason ?? value.debug.reason ?? null,
    },
  };
}

async function getCachedOptionChartBarsRouteResult(
  query: OptionChartBarsRouteQuery,
): Promise<OptionChartBarsRouteResult> {
  const key = buildOptionChartBarsRouteCacheKey(query);
  const fresh = readCachedOptionChartBarsRouteResult(key);
  if (fresh) {
    return withCachedOptionChartBarsDebug(fresh, {
      stale: false,
      degraded: fresh.debug.degraded,
      reason: fresh.debug.reason ?? null,
    });
  }

  const existing = optionChartBarsRouteInFlight.get(key);
  if (existing) {
    return existing;
  }

  const stale = readCachedOptionChartBarsRouteResult(key, { allowStale: true });
  const promise = getOptionChartBarsWithDebug(query)
    .then((value) => {
      if (value.bars.length > 0) {
        optionChartBarsRouteCache.set(key, {
          value,
          expiresAt: Date.now() + OPTION_CHART_BARS_ROUTE_CACHE_TTL_MS,
          staleExpiresAt: Date.now() + OPTION_CHART_BARS_ROUTE_STALE_TTL_MS,
        });
        return value;
      }

      if (stale && value.debug.degraded) {
        return withCachedOptionChartBarsDebug(stale, {
          stale: true,
          degraded: true,
          reason: value.debug.reason ?? "option_chart_stale_fallback",
        });
      }

      return value;
    })
    .catch((error) => {
      if (stale) {
        return withCachedOptionChartBarsDebug(stale, {
          stale: true,
          degraded: true,
          reason: "option_chart_stale_fallback",
        });
      }
      throw error;
    })
    .finally(() => {
      optionChartBarsRouteInFlight.delete(key);
    });

  optionChartBarsRouteInFlight.set(key, promise);
  return promise;
}

function normalizeOrigin(rawOrigin: string): string | null {
  try {
    const originUrl = new URL(rawOrigin);
    originUrl.pathname = "";
    originUrl.search = "";
    originUrl.hash = "";
    return originUrl.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function getConfiguredBridgeBaseUrl(): string | null {
  for (const name of IBKR_BRIDGE_PUBLIC_BASE_URL_ENV_NAMES) {
    const value = process.env[name]?.trim();
    if (!value) {
      continue;
    }

    const normalized = normalizeOrigin(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function getReplitBridgeBaseUrl(): string | null {
  for (const name of REPLIT_PUBLIC_HOST_ENV_NAMES) {
    const value = process.env[name]?.split(",")[0]?.trim();
    if (!value) {
      continue;
    }

    const normalized = normalizeOrigin(
      value.startsWith("http") ? value : `https://${value}`,
    );
    if (normalized && !isLoopbackHost(new URL(normalized).host)) {
      return normalized;
    }
  }

  return null;
}

function getHostnameFromHost(host: string): string {
  const trimmed = host.trim();
  try {
    return new URL(`http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return trimmed.split(":")[0]?.toLowerCase() ?? "";
  }
}

function isReplitShellHost(host: string): boolean {
  const hostname = getHostnameFromHost(host);
  return hostname === "replit.com" || hostname.endsWith(".replit.com");
}

function buildOriginFromHost(
  proto: string | null,
  host: string,
  options: { preferHttpsForPublicHost?: boolean } = {},
): string {
  const normalizedHost = host.trim();
  const publicHost = !isLoopbackHost(normalizedHost);
  const normalizedProto =
    proto === "http" || proto === "https" ? proto : publicHost ? "https" : "http";

  return `${options.preferHttpsForPublicHost && publicHost ? "https" : normalizedProto}://${normalizedHost}`;
}

export function getIbkrBridgeRequestOrigin(
  req: Pick<Request, "get" | "protocol">,
): string {
  const configured = getConfiguredBridgeBaseUrl();
  if (configured) {
    return configured;
  }

  const forwardedProto = getFirstHeaderValue(req.get("x-forwarded-proto"));
  const forwardedHost = getFirstHeaderValue(req.get("x-forwarded-host"));
  const replitBaseUrl = getReplitBridgeBaseUrl();
  if (forwardedHost && !isLoopbackHost(forwardedHost)) {
    if (isReplitShellHost(forwardedHost) && replitBaseUrl) {
      return replitBaseUrl;
    }
    return buildOriginFromHost(forwardedProto, forwardedHost, {
      preferHttpsForPublicHost: true,
    });
  }

  const host = req.get("host")?.trim();
  const origin = req.get("origin");
  if (host && isLoopbackHost(host) && origin) {
    const normalizedOrigin = normalizeOrigin(origin);
    if (normalizedOrigin && !isLoopbackHost(new URL(normalizedOrigin).host)) {
      if (isReplitShellHost(new URL(normalizedOrigin).host) && replitBaseUrl) {
        return replitBaseUrl;
      }
      return normalizedOrigin;
    }
  }

  if ((host && isLoopbackHost(host)) || (forwardedHost && isLoopbackHost(forwardedHost))) {
    if (replitBaseUrl) {
      return replitBaseUrl;
    }
  }

  if (!host) {
    return "http://127.0.0.1";
  }

  return buildOriginFromHost(forwardedProto || req.protocol || "http", host);
}

function createRequestAbortSignal(req: Request, res: Response): AbortSignal {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const abortIfResponseDidNotFinish = () => {
    if (!res.writableEnded) {
      abort();
    }
  };

  if (req.aborted) {
    abort();
  } else {
    req.once("aborted", abort);
    res.once("close", abortIfResponseDidNotFinish);
  }

  return controller.signal;
}

function addVaryHeader(res: Response, value: string): void {
  const current = res.getHeader("Vary");
  if (!current) {
    res.setHeader("Vary", value);
    return;
  }
  const currentValue = Array.isArray(current) ? current.join(", ") : String(current);
  const hasValue = currentValue
    .split(",")
    .some((part) => part.trim().toLowerCase() === value.toLowerCase());
  if (!hasValue) {
    res.setHeader("Vary", `${currentValue}, ${value}`);
  }
}

function setGexDashboardHttpCacheHeaders(
  res: Response,
  metadata: {
    eTag: string;
  },
): void {
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate, no-transform");
  res.setHeader("ETag", metadata.eTag);
  addVaryHeader(res, "Accept-Encoding");
}

function parseGexDashboardResponseOnce(
  data: Awaited<ReturnType<typeof getGexDashboardData>>,
): ParsedGexDashboardResponse {
  const cached = parsedGexDashboardResponses.get(data);
  if (cached) return cached;
  const parsed = GetGexDashboardResponse.parse(data);
  parsedGexDashboardResponses.set(data, parsed);
  return parsed;
}

const BARS_REQUEST_MAX_WINDOW_DAYS: Record<string, number> = {
  "1s": 7,
  "5s": 7,
  "15s": 7,
  "30s": 7,
  "1m": 45,
  "2m": 45,
  "5m": 180,
  "15m": 365,
  "30m": 365,
  "1h": 365 * 3,
  "4h": 365 * 3,
  "1d": 365 * 15,
};
const BARS_BATCH_MAX_REQUESTS = 72;
const BARS_BATCH_CONCURRENCY = 6;
const BARS_BATCH_SPARKLINE_DEFAULT_POINT_LIMIT = 40;
const BARS_BATCH_SPARKLINE_MAX_POINT_LIMIT = 240;
const SPARKLINE_SEED_MAX_SYMBOLS = 600;
const SPARKLINE_SEED_DB_BATCH_SIZE = 64;
// Sparkline seeding is background hydration. Runtime evidence
// after the rebuild showed 31-32 symbol historical backfill chunks taking
// 10s+ under contention; letting client and server concurrency compose into
// multiple simultaneous chunks saturated the 12-slot DB pool. Keep the server
// default at one DB reader per seed request; the live edge comes from memory.
const SPARKLINE_SEED_DB_CONCURRENCY = Math.max(
  1,
  Number(process.env["SPARKLINE_SEED_DB_CONCURRENCY"]) || 1,
);
const SPARKLINE_SEED_DEFAULT_LIMIT = 120;
const SPARKLINE_SEED_MAX_LIMIT = 240;
const SPARKLINE_SEED_DEFAULT_POINT_LIMIT = 48;
const SPARKLINE_SEED_MAX_POINT_LIMIT = 120;
const SPARKLINE_SEED_TIMEFRAMES = new Set([
  "1m",
  "2m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
]);
const SPARKLINE_SEED_MEMORY_TIMEFRAMES = new Set<SignalMonitorLocalBarCacheTimeframe>([
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
]);
type BarsBatchResponseShape = "bars" | "sparkline";

function validateBarsRequestWindow(
  query: ReturnType<typeof GetBarsQueryParams.parse>,
  res: Response,
): boolean {
  if (!query.from || !query.to) {
    return true;
  }

  const maxDays = BARS_REQUEST_MAX_WINDOW_DAYS[query.timeframe];
  if (!maxDays) {
    return true;
  }

  const requestedDays =
    Math.max(0, query.to.getTime() - query.from.getTime()) / 86_400_000;
  if (requestedDays <= maxDays) {
    return true;
  }

  res.status(400).type("application/problem+json").json({
    type: "https://pyrus.local/problems/bars-request-too-large",
    title: "Bars request is too large",
    status: 400,
    detail: `${query.timeframe} bars are limited to ${maxDays} calendar days per request.`,
    code: "BARS_REQUEST_TOO_LARGE",
    maxWindowDays: maxDays,
    requestedWindowDays: Math.ceil(requestedDays),
  });
  return false;
}

function readOptionalString(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, maxLength);
}

function readBarsBatchResponseShape(value: unknown): BarsBatchResponseShape {
  return String(value || "").trim().toLowerCase() === "sparkline"
    ? "sparkline"
    : "bars";
}

function readBarsBatchSparklinePointLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return BARS_BATCH_SPARKLINE_DEFAULT_POINT_LIMIT;
  }
  return Math.max(
    2,
    Math.min(BARS_BATCH_SPARKLINE_MAX_POINT_LIMIT, Math.floor(numeric)),
  );
}

function readSparklineSeedPositiveInteger(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(2, Math.min(max, Math.floor(numeric)));
}

function readSparklineSeedSymbols(value: unknown): string[] {
  const rawSymbols = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return Array.from(
    new Set(
      rawSymbols
        .map((symbol) =>
          typeof symbol === "string" ? symbol.trim().toUpperCase() : "",
        )
        .filter(Boolean),
    ),
  ).slice(0, SPARKLINE_SEED_MAX_SYMBOLS);
}

function parseSparklineSeedBody(body: unknown) {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const timeframe = String(record.timeframe || "1m").trim();
  return {
    symbols: readSparklineSeedSymbols(record.symbols),
    timeframe: SPARKLINE_SEED_TIMEFRAMES.has(timeframe) ? timeframe : "1m",
    limit: readSparklineSeedPositiveInteger(
      record.limit,
      SPARKLINE_SEED_DEFAULT_LIMIT,
      SPARKLINE_SEED_MAX_LIMIT,
    ),
    pointLimit: readSparklineSeedPositiveInteger(
      record.pointLimit,
      SPARKLINE_SEED_DEFAULT_POINT_LIMIT,
      SPARKLINE_SEED_MAX_POINT_LIMIT,
    ),
  };
}

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    }),
  );

  return results;
}

// Per-symbol cache for sparkline seeding. The ~500-670 symbol signal universe is
// reseeded on every Signals/Algo mount, tab switch, and universe symbol-set
// change, across every open client -- each can cold-pass over bar_cache. Cache
// only the historical backfill; the live edge is read from the in-process signal
// local bar cache on every request so `/sparklines/seed` does not loop live
// websocket bars back through the hot 12M-row bar_cache table.
const SPARKLINE_SEED_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env["SPARKLINE_SEED_CACHE_TTL_MS"]) || 300_000,
);
const SPARKLINE_SEED_CACHE_MAX_ENTRIES = 16_000;
const SPARKLINE_SEED_IN_FLIGHT_MAX_ENTRIES = 128;
type SparklineSeedBarsBySymbol = Awaited<
  ReturnType<typeof loadStoredMarketBarsBySymbol>
>;
type SparklineSeedBars = SparklineSeedBarsBySymbol[string];
const sparklineSeedBarsCache = new Map<
  string,
  { bars: SparklineSeedBars; expiresAt: number }
>();
const sparklineSeedInFlight = new Map<
  string,
  Promise<Record<string, SparklineSeedBars>>
>();
const sparklineSeedHistoryWarmInFlight = new Map<string, Promise<void>>();
let sparklineSeedDbBackfillTail: Promise<void> = Promise.resolve();
const sparklineSeedCacheKey = (
  symbol: string,
  timeframe: string,
  limit: number,
) => `${normalizeSymbol(symbol)}|${timeframe}|${limit}`;
const sparklineSeedInFlightKey = (
  body: ReturnType<typeof parseSparklineSeedBody>,
) =>
  `${body.timeframe}|${body.limit}|${Array.from(
    new Set(body.symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  )
    .sort()
    .join(",")}`;

function pruneSparklineSeedInFlight(): void {
  while (sparklineSeedInFlight.size > SPARKLINE_SEED_IN_FLIGHT_MAX_ENTRIES) {
    const oldestKey = sparklineSeedInFlight.keys().next().value;
    if (!oldestKey) {
      return;
    }
    sparklineSeedInFlight.delete(oldestKey);
  }
  while (sparklineSeedHistoryWarmInFlight.size > SPARKLINE_SEED_IN_FLIGHT_MAX_ENTRIES) {
    const oldestKey = sparklineSeedHistoryWarmInFlight.keys().next().value;
    if (!oldestKey) {
      return;
    }
    sparklineSeedHistoryWarmInFlight.delete(oldestKey);
  }
}

async function runSparklineSeedDbBackfill<T>(task: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = sparklineSeedDbBackfillTail.catch(() => undefined);
  sparklineSeedDbBackfillTail = previous.then(() => turn);
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function isSparklineSeedMemoryTimeframe(
  timeframe: string,
): timeframe is SignalMonitorLocalBarCacheTimeframe {
  return SPARKLINE_SEED_MEMORY_TIMEFRAMES.has(
    timeframe as SignalMonitorLocalBarCacheTimeframe,
  );
}

function toSparklineSeedBars(
  bars: ReturnType<typeof readSignalMonitorLocalMemoryBars>,
): SparklineSeedBars {
  return bars
    .map((bar) => {
      const timestamp =
        bar.timestamp instanceof Date ? bar.timestamp : new Date(bar.timestamp);
      const close = Number(bar.close);
      return Number.isFinite(timestamp.getTime()) && Number.isFinite(close)
        ? { timestamp, close }
        : null;
    })
    .filter(
      (bar): bar is SparklineSeedBars[number] =>
        bar !== null,
    );
}

function readSparklineSeedMemoryBarsBySymbol(
  symbols: string[],
  body: ReturnType<typeof parseSparklineSeedBody>,
): Record<string, SparklineSeedBars> {
  if (!isSparklineSeedMemoryTimeframe(body.timeframe)) {
    return {};
  }
  const evaluatedAt = new Date();
  const barsBySymbol: Record<string, SparklineSeedBars> = {};
  for (const symbol of symbols) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) {
      continue;
    }
    const bars = toSparklineSeedBars(
      readSignalMonitorLocalMemoryBars({
        symbol,
        timeframe: body.timeframe,
        evaluatedAt,
        limit: body.limit,
      }),
    );
    if (bars.length) {
      barsBySymbol[normalized] = bars;
    }
  }
  return barsBySymbol;
}

// The watchlist sparkline must reflect the CURRENT session's price action so its
// signal-timeline coloring aligns with the exec-timeframe signal. Reading
// `massive-history` alone is stale for any symbol whose today pre-market history
// has not been backfilled yet (its newest history bar is the prior session), so
// the sparkline window predates today's signal and the colorer paints the
// inverted pre-signal stance (a fresh SELL renders blue). Merge the live
// `massive-websocket` bars (today, authoritative for recent minutes) over the
// `massive-history` deep backfill so the window always includes the live edge.
function mergeSparklineSeedBars(
  history: SparklineSeedBars,
  live: SparklineSeedBars,
  limit: number,
): SparklineSeedBars {
  if (!live.length) return history;
  if (!history.length) return live;
  const byMs = new Map<number, SparklineSeedBars[number]>();
  for (const bar of history) byMs.set(bar.timestamp.getTime(), bar);
  // Live wins on a same-minute collision: it is the freshest write for the edge.
  for (const bar of live) byMs.set(bar.timestamp.getTime(), bar);
  return Array.from(byMs.values())
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
    .slice(-Math.max(1, limit));
}

async function loadSparklineSeedBarsBySymbol(
  body: ReturnType<typeof parseSparklineSeedBody>,
) {
  const key = sparklineSeedInFlightKey(body);
  const existing = sparklineSeedInFlight.get(key);
  if (existing) {
    return existing;
  }

  const flight = loadSparklineSeedBarsBySymbolUncoalesced(body).finally(() => {
    sparklineSeedInFlight.delete(key);
  });
  sparklineSeedInFlight.set(key, flight);
  pruneSparklineSeedInFlight();
  return flight;
}

async function loadSparklineSeedBarsBySymbolUncoalesced(
  body: ReturnType<typeof parseSparklineSeedBody>,
) {
  const now = Date.now();
  const cacheEnabled = SPARKLINE_SEED_CACHE_TTL_MS > 0;
  const result: Record<string, SparklineSeedBars> = {};
  const misses: string[] = [];
  const seenMiss = new Set<string>();
  const liveBySymbol = readSparklineSeedMemoryBarsBySymbol(body.symbols, body);

  for (const symbol of body.symbols) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) {
      continue;
    }
    const liveBars = liveBySymbol[normalized] ?? [];
    if (cacheEnabled) {
      const cached = sparklineSeedBarsCache.get(
        sparklineSeedCacheKey(symbol, body.timeframe, body.limit),
      );
      if (cached && cached.expiresAt > now) {
        const merged = mergeSparklineSeedBars(
          cached.bars,
          liveBars,
          body.limit,
        );
        if (merged.length) {
          result[normalized] = merged;
        }
        continue;
      }
    }
    if (!seenMiss.has(normalized)) {
      seenMiss.add(normalized);
      misses.push(symbol);
    }
  }

  if (misses.length) {
    for (const symbol of misses) {
      const normalized = normalizeSymbol(symbol);
      const liveBars = normalized ? liveBySymbol[normalized] ?? [] : [];
      if (normalized && liveBars.length) {
        result[normalized] = liveBars;
      }
    }
    scheduleSparklineSeedHistoryWarm(body, misses, cacheEnabled);
  }

  return result;
}

function scheduleSparklineSeedHistoryWarm(
  body: ReturnType<typeof parseSparklineSeedBody>,
  misses: string[],
  cacheEnabled: boolean,
): void {
  if (!cacheEnabled || !misses.length) {
    return;
  }
  const key = sparklineSeedInFlightKey(body);
  if (sparklineSeedHistoryWarmInFlight.has(key)) {
    return;
  }

  const warm = (async () => {
    const chunks = chunkArray(misses, SPARKLINE_SEED_DB_BATCH_SIZE);
    const chunkResults = await mapWithConcurrency(
      chunks,
      SPARKLINE_SEED_DB_CONCURRENCY,
      async (symbols) => {
        const shared = {
          symbols,
          timeframe: body.timeframe as Parameters<
            typeof loadStoredMarketBarsBySymbol
          >[0]["timeframe"],
          limit: body.limit,
          outsideRth: true,
        };
        // Historical backfill is the only DB read here. The live edge is already
        // in memory from the stock aggregate stream, and reading
        // `massive-websocket` back out of bar_cache made `/sparklines/seed` the
        // dominant slow route during algo/signal page loads.
        return runSparklineSeedDbBackfill(() =>
          loadStoredMarketBarsBySymbol({
            ...shared,
            sourceName: "massive-history",
          }),
        );
      },
    );
    const loaded: Record<string, SparklineSeedBars> = Object.assign(
      {},
      ...chunkResults,
    );
    if (sparklineSeedBarsCache.size > SPARKLINE_SEED_CACHE_MAX_ENTRIES) {
      const now = Date.now();
      for (const [key, entry] of sparklineSeedBarsCache) {
        if (entry.expiresAt <= now) {
          sparklineSeedBarsCache.delete(key);
        }
      }
    }
    const expiresAt = Date.now() + SPARKLINE_SEED_CACHE_TTL_MS;
    for (const symbol of misses) {
      const normalized = normalizeSymbol(symbol);
      const historyBars = loaded[normalized] || [];
      // Cache negatives (empty bars) too: the universe has many symbols with no
      // stored history; without this they re-hit the DB on every seed. This
      // caches history only; live memory bars are merged per request above.
      if (normalized) {
        sparklineSeedBarsCache.set(
          sparklineSeedCacheKey(symbol, body.timeframe, body.limit),
          { bars: historyBars, expiresAt },
        );
      }
    }
  })()
    .catch(() => {})
    .finally(() => {
      sparklineSeedHistoryWarmInFlight.delete(key);
    });
  sparklineSeedHistoryWarmInFlight.set(key, warm);
  pruneSparklineSeedInFlight();
}

function readBatchBarCloseValue(bar: unknown): number | null {
  const record = bar && typeof bar === "object" ? (bar as Record<string, unknown>) : null;
  const close = Number(record?.close ?? record?.c);
  return Number.isFinite(close) ? close : null;
}

function compactBarsForBatchSparkline(
  bars: unknown[],
  pointLimit: number,
): Array<{ timestamp: unknown; close: number }> {
  const validBars = bars.filter((bar) => readBatchBarCloseValue(bar) != null);
  const sampledBars =
    validBars.length <= pointLimit
      ? validBars
      : Array.from({ length: pointLimit }, (_, index) => {
          const sourceIndex = Math.round(
            (index * (validBars.length - 1)) / (pointLimit - 1),
          );
          return validBars[sourceIndex];
        });

  const points: Array<{ timestamp: unknown; close: number }> = [];
  for (const bar of sampledBars) {
    const record =
      bar && typeof bar === "object" ? (bar as Record<string, unknown>) : null;
    const close = readBatchBarCloseValue(record);
    if (close == null) {
      continue;
    }
    points.push({
      timestamp: record?.timestamp ?? record?.time ?? record?.t ?? null,
      close,
    });
  }
  return points;
}

function sendBarsBatchProblem(
  res: Response,
  status: number,
  detail: string,
  code: string,
) {
  res.status(status).type("application/problem+json").json({
    type: "https://pyrus.local/problems/bars-batch-request-invalid",
    title: "Bars batch request is invalid",
    status,
    detail,
    code,
  });
}

function getBarsBatchRecords(body: unknown): Record<string, unknown>[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const requests = (body as { requests?: unknown }).requests;
  if (!Array.isArray(requests)) {
    return null;
  }
  if (
    requests.some(
      (request) => !request || typeof request !== "object" || Array.isArray(request),
    )
  ) {
    return null;
  }
  return requests as Record<string, unknown>[];
}

function parseBarsBatchRecord(record: Record<string, unknown>, index: number) {
  const query = GetBarsQueryParams.parse(
    coerceBooleanQueryFields(
      coerceDateQueryFields(record, ["from", "to"]),
      [
        "outsideRth",
        "allowHistoricalSynthesis",
        "requireFreshHistorical",
        "allowStudyFallback",
        "preferCursor",
      ],
    ),
  );
  const rawBrokerRecentWindowMinutes = Number(record.brokerRecentWindowMinutes);
  const brokerRecentWindowMinutes =
    Number.isFinite(rawBrokerRecentWindowMinutes)
      ? rawBrokerRecentWindowMinutes
      : null;
  const key =
    readOptionalString(record.key, 140) ||
    `${query.symbol}:${query.timeframe}:${index}`;
  const responseShape = readBarsBatchResponseShape(record.responseShape);
  return {
    key,
    query,
    brokerRecentWindowMinutes,
    responseShape,
    sparklinePointLimit: readBarsBatchSparklinePointLimit(
      record.sparklinePointLimit ?? record.pointLimit,
    ),
  };
}

function setRequestDebugHeaders(
  res: Response,
  debug:
    | {
        cacheStatus: "hit" | "miss" | "inflight";
        totalMs: number;
        upstreamMs: number | null;
        gapFilled?: boolean;
        stale?: boolean;
        ageMs?: number | null;
        degraded?: boolean;
        reason?: string | null;
        backoffRemainingMs?: number | null;
        family?: string | null;
        priority?: number | null;
        priorityBucket?: string | null;
        payloadClass?: string | null;
      }
    | undefined,
): void {
  if (!debug) {
    return;
  }

  const setDebugHeader = (suffix: string, value: string) => {
    res.setHeader(`X-Pyrus-${suffix}`, value);
  };

  setDebugHeader("Cache-Status", debug.cacheStatus);
  setDebugHeader("Request-Ms", String(debug.totalMs));

  if (debug.upstreamMs != null) {
    setDebugHeader("Upstream-Ms", String(debug.upstreamMs));
  }
  if (typeof debug.gapFilled === "boolean") {
    setDebugHeader("Gap-Filled", debug.gapFilled ? "1" : "0");
  }
  if (typeof debug.stale === "boolean") {
    setDebugHeader("Cache-Stale", debug.stale ? "1" : "0");
  }
  if (typeof debug.ageMs === "number") {
    setDebugHeader("Cache-Age-Ms", String(debug.ageMs));
  }
  if (typeof debug.degraded === "boolean") {
    setDebugHeader("Degraded", debug.degraded ? "1" : "0");
  }
  if (typeof debug.reason === "string" && debug.reason) {
    setDebugHeader("Degraded-Reason", debug.reason);
  }
  if (typeof debug.backoffRemainingMs === "number") {
    setDebugHeader(
      "Backoff-Remaining-Ms",
      String(Math.max(0, Math.round(debug.backoffRemainingMs))),
    );
  }
  if (typeof debug.family === "string" && debug.family) {
    setDebugHeader("Request-Family", debug.family);
  }
  if (typeof debug.priority === "number" && Number.isFinite(debug.priority)) {
    setDebugHeader("Fetch-Priority", String(debug.priority));
  }
  if (typeof debug.priorityBucket === "string" && debug.priorityBucket) {
    setDebugHeader("Priority-Bucket", debug.priorityBucket);
  }
  if (typeof debug.payloadClass === "string" && debug.payloadClass) {
    setDebugHeader("Payload-Class", debug.payloadClass);
  }
}

function parseWatchlistSymbolBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid watchlist symbol payload.");
  }

  const symbol = readOptionalString((body as Record<string, unknown>).symbol, 64);
  if (!symbol) {
    throw new Error("Symbol is required.");
  }

  return {
    symbol,
    name: readOptionalString((body as Record<string, unknown>).name, 160),
    market: readOptionalString((body as Record<string, unknown>).market, 32),
    normalizedExchangeMic: readOptionalString(
      (body as Record<string, unknown>).normalizedExchangeMic,
      32,
    ),
    exchangeDisplay: readOptionalString(
      (body as Record<string, unknown>).exchangeDisplay,
      80,
    ),
    countryCode: readOptionalString(
      (body as Record<string, unknown>).countryCode,
      8,
    ),
    exchangeCountryCode: readOptionalString(
      (body as Record<string, unknown>).exchangeCountryCode,
      8,
    ),
    sector: readOptionalString((body as Record<string, unknown>).sector, 80),
    industry: readOptionalString(
      (body as Record<string, unknown>).industry,
      120,
    ),
  };
}

function parseCreateWatchlistBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid watchlist payload.");
  }

  const payload = body as Record<string, unknown>;
  const name = readOptionalString(payload.name, 80);
  if (!name) {
    throw new Error("Watchlist name is required.");
  }

  return {
    name,
    isDefault: payload.isDefault === true,
    symbols: Array.isArray(payload.symbols)
      ? payload.symbols.map(parseWatchlistSymbolBody)
      : undefined,
  };
}

function parseUpdateWatchlistBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid watchlist payload.");
  }

  const payload = body as Record<string, unknown>;
  const name = readOptionalString(payload.name, 80);
  return {
    name,
    isDefault:
      typeof payload.isDefault === "boolean" ? payload.isDefault : undefined,
  };
}

function parseReorderWatchlistSymbolsBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid reorder payload.");
  }

  const payload = body as Record<string, unknown>;
  const rawItemIds = payload.itemIds;
  const itemIds = Array.isArray(rawItemIds)
    ? rawItemIds
        .map((itemId: unknown) => readOptionalString(itemId, 128))
        .filter((itemId): itemId is string => Boolean(itemId))
    : [];

  if (!itemIds.length) {
    throw new Error("itemIds are required.");
  }

  return { itemIds };
}

function coerceDateQueryFields<T extends Record<string, unknown>>(
  input: T,
  keys: string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input };

  keys.forEach((key) => {
    const value = output[key];

    if (typeof value === "string" && value.trim()) {
      output[key] = new Date(value);
    }
  });

  return output;
}

function coerceArrayQueryFields<T extends Record<string, unknown>>(
  input: T,
  keys: string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input };

  keys.forEach((key) => {
    const value = output[key];

    if (typeof value === "string") {
      output[key] = value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return;
    }

    if (Array.isArray(value)) {
      output[key] = value.flatMap((entry) =>
        typeof entry === "string"
          ? entry
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean)
          : [entry],
      );
    }
  });

  return output;
}

function coerceBooleanQueryFields<T extends Record<string, unknown>>(
  input: T,
  keys: string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input };

  keys.forEach((key) => {
    const value = output[key];

    if (typeof value !== "string") {
      return;
    }

    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      output[key] = true;
    } else if (["false", "0", "no"].includes(normalized)) {
      output[key] = false;
    }
  });

  return output;
}

async function startSse(
  req: Request,
  res: Response,
  streamName: string,
  setup: (controls: {
    writeEvent: (event: string, payload: unknown) => Promise<void>;
    writeSerializedEvent: (event: string, data: string) => Promise<void>;
    writeComment: (comment: string) => Promise<void>;
    lastEventId: string | null;
  }) => Promise<() => void> | (() => void),
) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let cleanedUp = false;
  let nextEventId = 1;
  let writeQueue = Promise.resolve();
  let pendingChunks = 0;
  let unsubscribe: () => void = () => {};
  let heartbeat: NodeJS.Timeout | null = null;
  let closeReason: SseStreamCloseReason = "server_cleanup";
  const lastEventId =
    typeof req.headers["last-event-id"] === "string" &&
    req.headers["last-event-id"].trim()
      ? req.headers["last-event-id"].trim()
      : null;
  recordSseStreamOpen(streamName);

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    unsubscribe();
    recordSseStreamClose(streamName, closeReason);
    if (!res.destroyed) {
      res.end();
    }
  };

  const enqueueChunk = (chunk: string): Promise<void> => {
    if (cleanedUp || res.destroyed || res.writableEnded) {
      return Promise.resolve();
    }

    if (pendingChunks >= SSE_MAX_BUFFERED_CHUNKS) {
      return Promise.resolve();
    }
    pendingChunks += 1;

    writeQueue = writeQueue
      .then(async () => {
        if (cleanedUp || res.destroyed || res.writableEnded) {
          return;
        }

        if (res.write(chunk)) {
          return;
        }

        let timeout: NodeJS.Timeout | null = null;
        try {
          await Promise.race([
            once(res, "drain"),
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(
                () => reject(new Error("SSE client did not drain in time.")),
                SSE_DRAIN_TIMEOUT_MS,
              );
              timeout.unref?.();
            }),
          ]);
        } finally {
          if (timeout) {
            clearTimeout(timeout);
          }
        }
      })
      .catch(() => {
        closeReason = "write_backpressure_timeout";
        cleanup();
      })
      .finally(() => {
        pendingChunks = Math.max(0, pendingChunks - 1);
      });

    return writeQueue;
  };

  const writeComment = (comment: string): Promise<void> =>
    enqueueChunk(`: ${comment.replace(/\r?\n/g, " ")}\n\n`);

  const writeHeartbeat = (at: string): Promise<void> =>
    enqueueChunk(
      `: ping ${at}\n` +
        "event: heartbeat\n" +
        `data: ${serializeSseEventData({ at, stream: streamName })}\n\n`,
    );

  const writeEvent = (event: string, payload: unknown): Promise<void> => {
    const eventId = String(nextEventId);
    nextEventId += 1;

    return enqueueChunk(
      `id: ${eventId}\n` +
        `event: ${event}\n` +
        `data: ${serializeSseEventData(payload)}\n\n`,
    );
  };

  // Like writeEvent, but takes an already-serialized `data` line so a fan-out
  // caller can JSON.stringify a payload ONCE and reuse the bytes across many
  // subscribers (serialize-once). The per-connection `id` stays per-write.
  const writeSerializedEvent = (
    event: string,
    data: string,
  ): Promise<void> => {
    const eventId = String(nextEventId);
    nextEventId += 1;

    return enqueueChunk(
      `id: ${eventId}\n` + `event: ${event}\n` + `data: ${data}\n\n`,
    );
  };

  await enqueueChunk("retry: 5000\n\n");

  heartbeat = setInterval(() => {
    void writeHeartbeat(new Date().toISOString());
  }, 15_000);

  res.on("close", () => {
    closeReason = "client_close";
    cleanup();
  });
  req.on("aborted", () => {
    closeReason = "request_aborted";
    cleanup();
  });

  try {
    const setupUnsubscribe =
      (await setup({
        writeEvent,
        writeSerializedEvent,
        writeComment,
        lastEventId,
      })) ?? (() => {});
    if (cleanedUp) {
      setupUnsubscribe();
      return;
    }
    unsubscribe = setupUnsubscribe;
  } catch (error) {
    closeReason = "setup_error";
    if (!res.headersSent) {
      res.status(500);
    }

    await writeEvent("error", {
      title: "Stream setup failed",
      status: 500,
      detail: error instanceof Error ? error.message : "Unknown stream error.",
    }).catch(() => {});
    cleanup();
  }
}

router.get("/session", async (_req, res) => {
  const session = await getSession();
  const data = GetSessionResponse.parse(session);

  // SessionIbkrRuntime is openapi `additionalProperties: true`, but the generated
  // zod validator strips keys it does not enumerate. The bridge-status UI depends
  // on runtime.ibkr health fields (brokerServerConnected, healthErrorCode,
  // streamState, strictReason, healthFresh, strictReady, bridgeReachable,
  // socketConnected, ...) that are not all enumerated, so re-merge the source
  // object to pass them through. Parsed (date-coerced) values win for enumerated
  // keys; extra keys fall through from the source.
  if (session.runtime?.ibkr && data.runtime?.ibkr) {
    data.runtime.ibkr = {
      ...session.runtime.ibkr,
      ...data.runtime.ibkr,
    };
  }

  res.json(data);
});

router.get("/diagnostics/runtime", async (req, res) => {
  const detail = String(
    req.query.detail ?? req.get("x-pyrus-diagnostics-detail") ?? "",
  ).toLowerCase();
  res.json(
    detail === "compact"
      ? await getRuntimeDiagnosticsCompact()
      : await getRuntimeDiagnostics(),
  );
});

router.get("/broker-connections", async (_req, res) => {
  const data = ListBrokerConnectionsResponse.parse(await listBrokerConnections());

  res.json(data);
});

router.get("/accounts", async (req, res) => {
  const { user } = await requireUser(req);
  if (!(await admitAccountRoute(res))) return;
  const query = ListAccountsQueryParams.parse(req.query);
  const data = ListAccountsResponse.parse(
    await listAccounts(query, { appUserId: user.id }),
  );

  res.json(data);
});

router.get("/accounts/flex/health", async (_req, res) => {
  res.json(GetFlexHealthResponse.parse(await getFlexHealth()));
});

router.post("/accounts/flex/test", async (_req, res) => {
  res.json(await testFlexToken());
});

router.get("/accounts/:accountId/summary", async (req, res) => {
  if (!(await admitAccountRoute(res, req.params.accountId))) return;
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "shadow" ? "shadow" : undefined;
  res.json(
    await withCallerShadowScope(req.params.accountId, () =>
      getAccountSummary({
        accountId: req.params.accountId,
        mode,
        source: readOptionalString(req.query.source, 80),
      }),
    ),
  );
});

router.get("/accounts/:accountId/equity-history", async (req, res) => {
  if (!(await admitAccountRoute(res, req.params.accountId))) return;
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "shadow" ? "shadow" : undefined;
  res.json(
    await withCallerShadowScope(req.params.accountId, () =>
      getAccountEquityHistory({
        accountId: req.params.accountId,
        range:
          typeof req.query.range === "string"
            ? (req.query.range as AccountRange)
            : undefined,
        benchmark:
          typeof req.query.benchmark === "string" ? req.query.benchmark : null,
        mode,
        source: readOptionalString(req.query.source, 80),
      }),
    ),
  );
});

router.get("/accounts/:accountId/allocation", async (req, res) => {
  if (!(await admitAccountRoute(res, req.params.accountId))) return;
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "shadow" ? "shadow" : undefined;
  res.json(
    await withCallerShadowScope(req.params.accountId, () =>
      getAccountAllocation({
        accountId: req.params.accountId,
        mode,
        source: readOptionalString(req.query.source, 80),
      }),
    ),
  );
});

router.get("/accounts/:accountId/positions", async (req, res) => {
  if (!(await admitAccountRoute(res, req.params.accountId))) return;
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "shadow" ? "shadow" : undefined;
  const liveQuotes =
    req.query.liveQuotes === "true"
      ? true
      : req.query.liveQuotes === "false"
        ? false
        : undefined;
  const detail = req.query.detail === "fast" ? "fast" : undefined;
  res.json(
    await withCallerShadowScope(req.params.accountId, () =>
      getAccountPositions({
        accountId: req.params.accountId,
        assetClass:
          typeof req.query.assetClass === "string" ? req.query.assetClass : null,
        mode,
        source: readOptionalString(req.query.source, 80),
        liveQuotes,
        detail,
      }),
    ),
  );
});

router.get("/accounts/:accountId/positions-at-date", async (req, res) => {
  if (!(await admitAccountRoute(res, req.params.accountId))) return;
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "shadow" ? "shadow" : undefined;
  res.json(
    await withCallerShadowScope(req.params.accountId, () =>
      getAccountPositionsAtDate({
        accountId: req.params.accountId,
        date:
          typeof req.query.date === "string" && req.query.date.trim()
            ? req.query.date
            : "",
        assetClass:
          typeof req.query.assetClass === "string" ? req.query.assetClass : null,
        mode,
        source: readOptionalString(req.query.source, 80),
      }),
    ),
  );
});

router.get("/accounts/:accountId/closed-trades", async (req, res) => {
  if (!(await admitAccountRoute(res, req.params.accountId))) return;
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "shadow" ? "shadow" : undefined;
  res.json(
    await withCallerShadowScope(req.params.accountId, () =>
      getAccountClosedTrades({
        accountId: req.params.accountId,
        from:
          typeof req.query.from === "string" && req.query.from.trim()
            ? new Date(req.query.from)
            : null,
        to:
          typeof req.query.to === "string" && req.query.to.trim()
            ? new Date(req.query.to)
            : null,
        symbol: typeof req.query.symbol === "string" ? req.query.symbol : null,
        assetClass:
          typeof req.query.assetClass === "string" ? req.query.assetClass : null,
        pnlSign: typeof req.query.pnlSign === "string" ? req.query.pnlSign : null,
        holdDuration:
          typeof req.query.holdDuration === "string"
            ? req.query.holdDuration
            : null,
        mode,
        source: readOptionalString(req.query.source, 80),
      }),
    ),
  );
});

router.get("/accounts/:accountId/orders", async (req, res) => {
  if (!(await admitAccountRoute(res, req.params.accountId))) return;
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "shadow" ? "shadow" : undefined;
  res.json(
    await withCallerShadowScope(req.params.accountId, () =>
      getAccountOrders({
        accountId: req.params.accountId,
        tab:
          req.query.tab === "history" || req.query.tab === "working"
            ? req.query.tab
            : undefined,
        mode,
        source: readOptionalString(req.query.source, 80),
      }),
    ),
  );
});

router.post("/accounts/:accountId/orders/:orderId/cancel", async (req, res) => {
  if (!(await admitAccountRoute(res, req.params.accountId))) return;
  const body = CancelAccountOrderBody.parse(req.body);
  res.json(
    await withCallerShadowScope(
      req.params.accountId,
      () =>
        cancelAccountOrder({
          accountId: req.params.accountId,
          orderId: req.params.orderId,
          mode: body.mode,
          confirm: body.confirm ?? false,
        }),
      { create: true },
    ),
  );
});

router.get("/accounts/:accountId/risk", async (req, res) => {
  if (!(await admitAccountRoute(res, req.params.accountId))) return;
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "shadow" ? "shadow" : undefined;
  const detail =
    req.query.detail === "fast" ? "fast" : req.query.detail === "full" ? "full" : undefined;
  res.json(
    await withCallerShadowScope(req.params.accountId, () =>
      getAccountRisk({
        accountId: req.params.accountId,
        mode,
        source: readOptionalString(req.query.source, 80),
        detail,
      }),
    ),
  );
});

router.get("/accounts/:accountId/cash-activity", async (req, res) => {
  if (!(await admitAccountRoute(res, req.params.accountId))) return;
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "shadow" ? "shadow" : undefined;
  res.json(
    await withCallerShadowScope(req.params.accountId, () =>
      getAccountCashActivity({
        accountId: req.params.accountId,
        from:
          typeof req.query.from === "string" && req.query.from.trim()
            ? new Date(req.query.from)
            : null,
        to:
          typeof req.query.to === "string" && req.query.to.trim()
            ? new Date(req.query.to)
            : null,
        mode,
        source: readOptionalString(req.query.source, 80),
      }),
    ),
  );
});

router.post("/accounts/shadow/watchlist-backtest/runs", async (req, res) => {
  res.status(201).json(
    await runShadowWatchlistBacktest({
      marketDate: typeof req.body?.marketDate === "string" ? req.body.marketDate : null,
      marketDateFrom:
        typeof req.body?.marketDateFrom === "string" ? req.body.marketDateFrom : null,
      marketDateTo:
        typeof req.body?.marketDateTo === "string" ? req.body.marketDateTo : null,
      range: typeof req.body?.range === "string" ? req.body.range : null,
      timeframe: typeof req.body?.timeframe === "string" ? req.body.timeframe : null,
      riskOverlay:
        req.body?.riskOverlay &&
        typeof req.body.riskOverlay === "object" &&
        !Array.isArray(req.body.riskOverlay)
          ? req.body.riskOverlay
          : null,
      sizingOverlay:
        req.body?.sizingOverlay &&
        typeof req.body.sizingOverlay === "object" &&
        !Array.isArray(req.body.sizingOverlay)
          ? req.body.sizingOverlay
          : null,
      selectionOverlay:
        req.body?.selectionOverlay &&
        typeof req.body.selectionOverlay === "object" &&
        !Array.isArray(req.body.selectionOverlay)
          ? req.body.selectionOverlay
          : null,
      entryGateOverlay:
        req.body?.entryGateOverlay &&
        typeof req.body.entryGateOverlay === "object" &&
        !Array.isArray(req.body.entryGateOverlay)
          ? req.body.entryGateOverlay
          : null,
      regimeOverlay:
        req.body?.regimeOverlay &&
        typeof req.body.regimeOverlay === "object" &&
        !Array.isArray(req.body.regimeOverlay)
          ? req.body.regimeOverlay
          : null,
      proxySymbols: Array.isArray(req.body?.proxySymbols) ? req.body.proxySymbols : null,
      excludedSymbols: Array.isArray(req.body?.excludedSymbols)
        ? req.body.excludedSymbols
        : null,
      persist: req.body?.persist,
      sweep: req.body?.sweep,
      exploratorySweep: req.body?.exploratorySweep,
      maxDrawdownLimitPercent: req.body?.maxDrawdownLimitPercent,
      targetOutperformanceMultiple: req.body?.targetOutperformanceMultiple,
    }),
  );
});

router.get("/watchlists", async (_req, res) => {
  res.json(await listWatchlistsForCurrentUser());
});

router.post("/watchlists", async (req, res) => {
  const body = parseCreateWatchlistBody(req.body);
  res.status(201).json(await createWatchlist(body));
});

router.patch("/watchlists/:watchlistId", async (req, res) => {
  const body = parseUpdateWatchlistBody(req.body);
  res.json(await updateWatchlist(req.params.watchlistId, body));
});

router.delete("/watchlists/:watchlistId", async (req, res) => {
  res.json(await deleteWatchlist(req.params.watchlistId));
});

router.post("/watchlists/:watchlistId/items", async (req, res) => {
  const body = parseWatchlistSymbolBody(req.body);
  res.status(201).json(await addWatchlistSymbol(req.params.watchlistId, body));
});

router.delete("/watchlists/:watchlistId/items/:itemId", async (req, res) => {
  res.json(
    await removeWatchlistSymbol(req.params.watchlistId, req.params.itemId),
  );
});

router.put("/watchlists/:watchlistId/items/reorder", async (req, res) => {
  const body = parseReorderWatchlistSymbolsBody(req.body);
  res.json(await reorderWatchlistSymbols(req.params.watchlistId, body.itemIds));
});

router.get("/positions", async (req, res) => {
  const query = ListPositionsQueryParams.parse(req.query);
  const data = ListPositionsResponse.parse(
    mapAccountPositionsToLegacyPositions(
      await withCallerShadowScope(legacyPositionsAccountId(query.accountId), () =>
        getAccountPositions({
          accountId: legacyPositionsAccountId(query.accountId),
          mode: query.mode,
          liveQuotes: false,
        }),
      ),
    ),
  );

  res.json(data);
});

router.get("/orders", async (req, res) => {
  const query = ListOrdersQueryParams.parse(req.query);
  const data = ListOrdersResponse.parse(await listOrders(query));

  res.json(data);
});

router.post("/shadow/orders/preview", async (req, res) => {
  const body = PlaceOrderBody.parse({
    ...req.body,
    accountId: SHADOW_ACCOUNT_ID,
    mode: "shadow",
  });

  res.json(
    await runWithShadowAccountId(
      await resolveCurrentUserShadowAccountId({ create: false }),
      () => previewShadowOrder(body),
    ),
  );
});

router.post("/shadow/orders", async (req, res) => {
  const body = PlaceOrderBody.parse({
    ...req.body,
    accountId: SHADOW_ACCOUNT_ID,
    mode: "shadow",
  });

  res.status(201).json(
    await runWithShadowAccountId(
      await resolveCurrentUserShadowAccountId({ create: true }),
      () => placeShadowOrder(body),
    ),
  );
});

router.post("/orders", async (req, res) => {
  await requireEntitlementCsrf("broker_connect")(req);
  const body = PlaceOrderBody.parse(req.body);
  res.status(201).json(await placeOrder(body));
});

router.post("/orders/preview", async (req, res) => {
  const body = PlaceOrderBody.parse(req.body);

  res.json(await previewOrder(body));
});

router.post("/orders/submit", async (req, res) => {
  await requireEntitlementCsrf("broker_connect")(req);
  if (Array.isArray(req.body?.ibkrOrders)) {
    res.status(201).json(await submitRawOrders({
      accountId:
        typeof req.body.accountId === "string"
          ? req.body.accountId
          : null,
      mode:
        req.body.mode === "live" || req.body.mode === "shadow"
          ? req.body.mode
          : null,
      confirm: req.body.confirm === true,
      parentOrderRequest:
        req.body.parentOrderRequest && typeof req.body.parentOrderRequest === "object"
          ? PlaceOrderBody.parse(req.body.parentOrderRequest)
          : null,
      taxPreflightToken:
        typeof req.body.taxPreflightToken === "string"
          ? req.body.taxPreflightToken
          : null,
      taxAcknowledgements: Array.isArray(req.body.taxAcknowledgements)
        ? req.body.taxAcknowledgements
            .map((entry: unknown) => String(entry || "").trim())
            .filter(Boolean)
        : null,
      ibkrOrders: req.body.ibkrOrders,
    }));
    return;
  }

  const body = PlaceOrderBody.parse(req.body);
  res.status(201).json(await placeOrder(body));
});

router.post("/orders/:orderId/replace", async (req, res) => {
  const body = ReplaceOrderBody.parse(req.body);
  res.json(await replaceOrder({
    accountId: body.accountId,
    orderId: req.params.orderId,
    order: body.order,
    mode: body.mode === "live" ? "live" : "shadow",
    confirm: body.confirm ?? false,
  }));
});

router.post("/orders/:orderId/cancel", async (req, res) => {
  const body = CancelOrderBody.parse(req.body);
  res.json(await cancelOrder({
    accountId: body.accountId,
    orderId: req.params.orderId,
    mode: body.mode,
    confirm: body.confirm ?? false,
    manualIndicator:
      typeof body.manualIndicator === "boolean"
        ? body.manualIndicator
        : null,
    extOperator:
      typeof body.extOperator === "string"
        ? body.extOperator
        : null,
  }));
});

router.get("/executions", async (req, res) => {
  const query = req.query as Record<string, unknown>;
  const mode =
    query.mode === "live" ? "live" : query.mode === "shadow" ? "shadow" : undefined;

  res.json(await listExecutions({
    accountId:
      typeof query.accountId === "string" ? query.accountId : undefined,
    mode,
    days:
      typeof query.days === "string" && query.days.trim()
        ? Number(query.days)
        : undefined,
    limit:
      typeof query.limit === "string" && query.limit.trim()
        ? Number(query.limit)
        : undefined,
    symbol: typeof query.symbol === "string" ? query.symbol : undefined,
    providerContractId:
      typeof query.providerContractId === "string" &&
      query.providerContractId.trim()
        ? query.providerContractId.trim()
        : null,
  }));
});

router.get("/quotes/snapshot", async (req, res) => {
  const query = GetQuoteSnapshotsQueryParams.parse(req.query);
  const data = GetQuoteSnapshotsResponse.parse(await getQuoteSnapshots(query));

  res.json(data);
});

router.get("/gex-snapshots", async (req, res) => {
  const query = GetGexSnapshotsQueryParams.parse(req.query);
  const symbols = query.symbols
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);
  const data = GetGexSnapshotsResponse.parse(await getGexSnapshots({ symbols }));
  res.json(data);
});

router.get("/gex/:underlying", async (req, res) => {
  const cachedEntry = getCachedGexDashboardHttpCacheEntry(req.params.underlying);
  if (cachedEntry) {
    setGexDashboardHttpCacheHeaders(res, cachedEntry);
    if (
      parsedGexDashboardResponses.has(cachedEntry.data) &&
      isHttpResourceNotModified({
        etag: cachedEntry.eTag,
        ifNoneMatch: req.get("if-none-match"),
        ifModifiedSince: req.get("if-modified-since"),
      })
    ) {
      res.status(304).end();
      return;
    }
  }

  const rawData = await getGexDashboardData({
    underlying: req.params.underlying,
    signal: createRequestAbortSignal(req, res),
  });
  const data = parseGexDashboardResponseOnce(rawData);
  const responseEntry =
    cachedEntry ?? getCachedGexDashboardHttpCacheEntry(req.params.underlying);
  const responseMetadata =
    responseEntry ?? buildGexDashboardHttpCacheMetadata(rawData);
  setGexDashboardHttpCacheHeaders(res, responseMetadata);
  if (
    responseEntry?.data === rawData &&
    isHttpResourceNotModified({
      etag: responseMetadata.eTag,
      ifNoneMatch: req.get("if-none-match"),
      ifModifiedSince: req.get("if-modified-since"),
    })
  ) {
    res.status(304).end();
    return;
  }

  res.json(data);
});

router.get("/gex/:underlying/projection", async (req, res) => {
  const view = String(req.query.view || "").trim().toLowerCase();
  const mode = String(req.query.mode || "").trim().toLowerCase();
  const projection = await getGexProjectionData({
    underlying: req.params.underlying,
    signal: createRequestAbortSignal(req, res),
    scope: view === "chart" ? "chart" : "full",
    mode: view === "chart" && mode === "snapshot" ? "snapshot" : "active",
  });

  if (view === "chart") {
    res.json({
      ticker: projection.ticker,
      spot: projection.spot,
      asOf: projection.asOf,
      quality: projection.quality,
      overlayPoints: projection.overlayPoints,
    });
    return;
  }

  res.json(projection);
});

router.get("/gex/:underlying/zero-gamma", async (req, res) => {
  const mode = String(req.query.mode || "").trim().toLowerCase();
  res.json(
    await getGexZeroGammaData({
      underlying: req.params.underlying,
      signal: createRequestAbortSignal(req, res),
      mode: mode === "snapshot" ? "snapshot" : "active",
    }),
  );
});

router.post("/options/quotes", async (req, res) => {
  const body = GetOptionQuoteSnapshotsBody.parse(req.body);
  const data = GetOptionQuoteSnapshotsResponse.parse(
    await fetchOptionQuoteSnapshotPayload({
      underlying: body.underlying ?? null,
      providerContractIds: body.providerContractIds,
      owner: body.owner ?? undefined,
      intent: body.intent ?? undefined,
      requiresGreeks: body.requiresGreeks ?? undefined,
      signal: createRequestAbortSignal(req, res),
    }),
  );

  res.json(data);
});

router.get("/news", async (req, res) => {
  const query = GetNewsQueryParams.parse(req.query);
  const data = GetNewsResponse.parse(await getNews(query));

  res.json(data);
});

router.get("/universe/tickers", async (req, res) => {
  const query = SearchUniverseTickersQueryParams.parse(
    coerceArrayQueryFields(req.query as Record<string, unknown>, ["markets"]),
  );
  const data = SearchUniverseTickersResponse.parse(
    await searchUniverseTickers(query, { signal: createRequestAbortSignal(req, res) }),
  );

  res.json(data);
});

router.get("/universe/logos", async (req, res) => {
  const rawSymbols = req.query.symbols;
  const symbols =
    Array.isArray(rawSymbols)
      ? rawSymbols.flatMap((value) => String(value).split(","))
      : typeof rawSymbols === "string"
        ? rawSymbols.split(",")
        : [];
  const data = await getUniverseLogos(
    { symbols },
    { signal: createRequestAbortSignal(req, res) },
  );

  res.json({
    ...data,
    logos: data.logos.map((logo) => ({
      ...logo,
      logoUrl: sameOriginLogoUrl(logo.logoUrl),
    })),
  });
});

router.get("/universe/logo-proxy", async (req, res) => {
  const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid logo URL." });
    return;
  }
  if (!LOGO_PROXY_ALLOWED_HOSTS.has(parsed.hostname)) {
    res.status(403).json({ error: "Logo host is not allowed." });
    return;
  }
  const requestSignal = createRequestAbortSignal(req, res);
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort();
  }, LOGO_PROXY_TIMEOUT_MS);
  const abortForRequest = () => timeoutController.abort();
  if (requestSignal.aborted) {
    timeoutController.abort();
  } else {
    requestSignal.addEventListener("abort", abortForRequest, { once: true });
  }
  try {
    const upstream = await fetch(parsed, {
      headers: { Accept: "image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8" },
      signal: timeoutController.signal,
    });
    if (!upstream.ok || !upstream.body) {
      res.status(204).end();
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.type(upstream.headers.get("content-type") || "image/svg+xml");
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.send(bytes);
  } catch {
    if (!res.headersSent) {
      res.status(204).end();
    }
  } finally {
    clearTimeout(timeout);
    requestSignal.removeEventListener("abort", abortForRequest);
  }
});

router.get("/bars", async (req, res) => {
  const signal = createRequestAbortSignal(req, res);
  const query = GetBarsQueryParams.parse(
    coerceBooleanQueryFields(
      coerceDateQueryFields(req.query as Record<string, unknown>, ["from", "to"]),
      [
        "outsideRth",
        "allowHistoricalSynthesis",
        "requireFreshHistorical",
        "allowStudyFallback",
        "preferCursor",
      ],
    ),
  );
  if (!validateBarsRequestWindow(query, res)) {
    return;
  }
  const rawBrokerRecentWindowMinutes =
    typeof req.query.brokerRecentWindowMinutes === "string"
      ? Number(req.query.brokerRecentWindowMinutes)
      : null;
  const raw = await getBarsWithDebug({
    ...query,
    brokerRecentWindowMinutes:
      rawBrokerRecentWindowMinutes != null &&
      Number.isFinite(rawBrokerRecentWindowMinutes)
        ? rawBrokerRecentWindowMinutes
        : null,
  }, {
    signal,
    priority: readFetchPriority(req),
    family: readRequestFamily(req),
  });
  setRequestDebugHeaders(res, raw.debug);
  const data = GetBarsResponse.parse(raw);

  res.json(data);
});

router.post("/sparklines/seed", async (req, res) => {
  const body = parseSparklineSeedBody(req.body);
  if (!body.symbols.length) {
    res.status(400).type("application/problem+json").json({
      type: "https://pyrus.local/problems/sparkline-seed-invalid",
      title: "Sparkline seed request is invalid",
      status: 400,
      detail: "Body must include one or more symbols.",
      code: "SPARKLINE_SEED_SYMBOLS_REQUIRED",
    });
    return;
  }

  const barsBySymbol = await loadSparklineSeedBarsBySymbol(body);
  const items = body.symbols.map((symbol) => {
    const normalized = symbol.trim().toUpperCase();
    // The bars map is keyed by normalizeSymbol() (share-class dashes -> dots, e.g.
    // BRK-B -> BRK.B); look it up with the SAME normalization or dash tickers miss
    // and render a blank sparkline. Keep `symbol: normalized` so the client matches the row.
    const bars = barsBySymbol[normalizeSymbol(symbol)] || [];
    return {
      symbol: normalized,
      status: bars.length ? "fulfilled" : "empty",
      bars: compactBarsForBatchSparkline(bars, body.pointLimit),
      source: "bar_cache",
      historySource: "massive-history",
    };
  });

  res.json({
    timeframe: body.timeframe,
    source: "bar_cache",
    historySource: "massive-history",
    requestedSymbolCount: body.symbols.length,
    hydratedSymbolCount: items.filter((item) => item.bars.length >= 2).length,
    items,
  });
});

router.get("/options/chains", async (req, res) => {
  const query = GetOptionChainQueryParams.parse(
    coerceDateQueryFields(req.query as Record<string, unknown>, ["expirationDate"]),
  );
  // These public /options/* routes are user-facing (the Trade screen). The
  // bridge "options" backoff exists to throttle the broad flow scanner, which
  // calls these services internally WITHOUT bypass and stays throttled. A user
  // actively waiting on their option chain gets a priority attempt past a
  // scanner-induced backoff instead of a 45s silent-empty response.
  const raw = await getOptionChainWithDebug({
    ...query,
    bypassBridgeBackoff: true,
    allowDelayedSnapshotHydration: false,
    emptyRetryDelaysMs: [],
    timeoutMs: OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS,
  });
  setRequestDebugHeaders(res, raw.debug);
  const data = GetOptionChainResponse.parse(raw);

  res.json(data);
});

router.post("/options/chains/batch", async (req, res) => {
  const body = BatchOptionChainsBody.parse(req.body);
  // User-facing route — see note on GET /options/chains.
  const raw = await batchOptionChains({
    ...body,
    bypassBridgeBackoff: true,
    allowDelayedSnapshotHydration: false,
    emptyRetryDelaysMs: [],
    timeoutMs: OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS,
  });
  setRequestDebugHeaders(res, raw.debug);
  const data = BatchOptionChainsResponse.parse(raw);

  res.json(data);
});

router.get("/options/expirations", async (req, res) => {
  const query = GetOptionExpirationsQueryParams.parse(
    req.query as Record<string, unknown>,
  );
  // User-facing route — see note on GET /options/chains. Expirations are the
  // first thing the Trade chain loads; a scanner-induced options backoff here
  // is what leaves the chain stuck "waiting for expirations".
  const raw = await getOptionExpirationsWithDebug({
    ...query,
    foregroundWaitMs: OPTION_EXPIRATION_PUBLIC_FOREGROUND_WAIT_MS,
    bypassBridgeBackoff: true,
  });
  setRequestDebugHeaders(res, raw.debug);
  const data = GetOptionExpirationsResponse.parse(raw);

  res.json(data);
});

router.get("/options/resolve-contract", async (req, res) => {
  const query = ResolveOptionContractQueryParams.parse(
    req.query as Record<string, unknown>,
  );
  const raw = await resolveOptionContractWithDebug(query);
  setRequestDebugHeaders(res, raw.debug);
  const data = ResolveOptionContractResponse.parse(raw);

  res.json(data);
});

router.post("/bars/batch", async (req, res) => {
  const signal = createRequestAbortSignal(req, res);
  const records = getBarsBatchRecords(req.body);
  if (!records) {
    sendBarsBatchProblem(
      res,
      400,
      "Body must include a requests array of bar request objects.",
      "BARS_BATCH_REQUESTS_REQUIRED",
    );
    return;
  }
  if (records.length > BARS_BATCH_MAX_REQUESTS) {
    sendBarsBatchProblem(
      res,
      400,
      `Bars batch requests are limited to ${BARS_BATCH_MAX_REQUESTS} items.`,
      "BARS_BATCH_TOO_LARGE",
    );
    return;
  }

  let parsedRequests: ReturnType<typeof parseBarsBatchRecord>[];
  try {
    parsedRequests = records.map((record, index) =>
      parseBarsBatchRecord(record, index),
    );
  } catch (error) {
    sendBarsBatchProblem(
      res,
      400,
      error instanceof Error ? error.message : "One or more bar requests are invalid.",
      "BARS_BATCH_ITEM_INVALID",
    );
    return;
  }

  for (const item of parsedRequests) {
    if (!validateBarsRequestWindow(item.query, res)) {
      return;
    }
  }

  const items = new Array(parsedRequests.length);
  let nextIndex = 0;
  let fulfilledCount = 0;
  let rejectedCount = 0;
  const priority = readFetchPriority(req);
  const family = readRequestFamily(req) || "bars-batch";
  const workerCount = Math.max(
    1,
    Math.min(BARS_BATCH_CONCURRENCY, parsedRequests.length),
  );

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < parsedRequests.length && !signal.aborted) {
        const index = nextIndex;
        nextIndex += 1;
        const item = parsedRequests[index];
        try {
          const raw = await getBarsWithDebug(
            {
              ...item.query,
              brokerRecentWindowMinutes: item.brokerRecentWindowMinutes,
            },
            {
              signal,
              priority,
              family,
            },
          );
          const data = GetBarsResponse.parse(raw);
          const compactSparklineBars =
            item.responseShape === "sparkline"
              ? compactBarsForBatchSparkline(data.bars, item.sparklinePointLimit)
              : null;
          fulfilledCount += 1;
          items[index] = {
            key: item.key,
            status: "fulfilled",
            symbol: data.symbol,
            timeframe: data.timeframe,
            bars: compactSparklineBars ?? data.bars,
            barShape: item.responseShape,
            sourceBarCount:
              item.responseShape === "sparkline" ? data.bars.length : undefined,
            historySource: data.historySource,
            marketDataMode: data.marketDataMode,
            oldestBarAt: data.historyPage?.oldestBarAt ?? null,
            newestBarAt: data.historyPage?.newestBarAt ?? null,
          };
        } catch (error) {
          rejectedCount += 1;
          items[index] = {
            key: item.key,
            status: "rejected",
            symbol: item.query.symbol,
            timeframe: item.query.timeframe,
            bars: [],
            error:
              error instanceof Error
                ? error.message.slice(0, 240)
                : "Bars request failed.",
          };
        }
      }
    }),
  );

  res.json({
    requestedCount: parsedRequests.length,
    fulfilledCount,
    rejectedCount,
    items,
  });
});

router.get("/options/chart-bars", async (req, res) => {
  const dateCoercedQuery = coerceDateQueryFields(
    req.query as Record<string, unknown>,
    ["expirationDate", "from", "to"],
  );
  const query = GetOptionChartBarsQueryParams.parse(
    coerceBooleanQueryFields(dateCoercedQuery, ["outsideRth", "preferCursor"]),
  );
  const raw = await getCachedOptionChartBarsRouteResult(query);
  setRequestDebugHeaders(res, raw.debug);
  const data = GetOptionChartBarsResponse.parse(raw);

  res.json(data);
});

function readDateQuery(value: unknown): Date | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function readNumberQuery(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readFootprintSourcePreference(
  value: unknown,
): FootprintSourcePreference {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "ibkr_first" || raw === "massive_only") {
    return raw;
  }
  return "massive_first";
}

function buildFootprintsInput(req: Request) {
  const query = req.query as Record<string, unknown>;
  const symbol =
    typeof query.symbol === "string" && query.symbol.trim()
      ? query.symbol.trim().toUpperCase()
      : "";
  const timeframe =
    typeof query.timeframe === "string" && query.timeframe.trim()
      ? query.timeframe.trim()
      : "";
  return {
    symbol,
    timeframe,
    assetClass:
      query.assetClass === "option"
        ? "option" as const
        : "equity" as const,
    from: readDateQuery(query.from),
    to: readDateQuery(query.to),
    providerContractId:
      typeof query.providerContractId === "string" &&
      query.providerContractId.trim()
        ? query.providerContractId.trim()
        : null,
    optionTicker:
      typeof query.optionTicker === "string" && query.optionTicker.trim()
        ? query.optionTicker.trim()
        : null,
    outsideRth: readBooleanQueryFlag(query.outsideRth),
    ticksPerRow: readNumberQuery(query.ticksPerRow),
    imbalancePercent: readNumberQuery(query.imbalancePercent),
    maxBars: readNumberQuery(query.maxBars),
    sourcePreference: readFootprintSourcePreference(query.sourcePreference),
  };
}

router.get("/footprints", async (req, res) => {
  const input = buildFootprintsInput(req);
  if (!input.symbol || !input.timeframe) {
    res.status(400).type("application/problem+json").json({
      type: "https://pyrus.local/problems/invalid-request",
      title: "Missing footprint input",
      status: 400,
      detail: "Provide symbol and timeframe query parameters.",
    });
    return;
  }

  res.json(await getVolumeFootprints({
    ...input,
    signal: createRequestAbortSignal(req, res),
  }));
});

function readBooleanQueryFlag(value: unknown): boolean | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

router.get("/flow/events", async (req, res) => {
  const query = ListFlowEventsQueryParams.parse(
    coerceDateQueryFields(req.query as Record<string, unknown>, ["from", "to"]),
  );
  const blocking = readBooleanQueryFlag(req.query.blocking) ?? false;
  const queueRefresh = readBooleanQueryFlag(req.query.queueRefresh) ?? true;
  const data = ListFlowEventsResponse.parse(
    await listFlowEvents({ ...query, blocking, queueRefresh }),
  );

  res.json(data);
});

router.get("/flow/events/aggregate", async (req, res) => {
  const query = ListAggregateFlowEventsQueryParams.parse(
    req.query as Record<string, unknown>,
  );
  const data = ListAggregateFlowEventsResponse.parse(
    await listAggregateFlowEvents(query),
  );

  res.json(data);
});

router.get("/flow/premium-distribution", async (req, res) => {
  const query = GetFlowPremiumDistributionQueryParams.parse(req.query);
  const data = GetFlowPremiumDistributionResponse.parse(
    await getFlowPremiumDistribution(query),
  );

  res.json(data);
});

router.get("/flow/universe", async (_req, res) => {
  const data = GetFlowUniverseResponse.parse(getOptionsFlowUniverse());
  res.json(data);
});

router.post("/flow/scanner/benchmark", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const underlying =
    typeof body.underlying === "string" ? body.underlying.trim() : "";
  if (!underlying) {
    res.status(400).type("application/problem+json").json({
      type: "https://pyrus.local/problems/invalid-request",
      title: "Missing underlying",
      status: 400,
      detail: "underlying is required.",
    });
    return;
  }

  const rawLineBudgets = Array.isArray(body.lineBudgets)
    ? body.lineBudgets
    : typeof body.lineBudgets === "string"
      ? body.lineBudgets.split(",")
      : undefined;
  const lineBudgets = rawLineBudgets
    ?.map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const strikeCoverage =
    body.strikeCoverage === "fast" ||
    body.strikeCoverage === "standard" ||
    body.strikeCoverage === "full"
      ? body.strikeCoverage
      : undefined;
  const maxDte =
    body.maxDte === null
      ? null
      : Number.isFinite(Number(body.maxDte))
        ? Number(body.maxDte)
        : undefined;
  const expirationScanCount =
    body.expirationScanCount === null || body.expirationScanCount === undefined
      ? undefined
      : Number.isFinite(Number(body.expirationScanCount)) &&
          Number(body.expirationScanCount) >= 0
        ? Number(body.expirationScanCount)
        : undefined;

  res.json(
    await benchmarkOptionsFlowScannerTickerPass({
      underlying,
      lineBudgets,
      maxDte,
      expirationScanCount,
      strikeCoverage,
    }),
  );
});

router.get("/streams/quotes", async (req, res) => {
  const rawSymbols = Array.isArray(req.query.symbols)
    ? req.query.symbols.join(",")
    : typeof req.query.symbols === "string"
      ? req.query.symbols
      : "";
  const symbols = rawSymbols
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (!symbols.length) {
    res.status(400).type("application/problem+json").json({
      type: "https://pyrus.local/problems/invalid-request",
      title: "Missing symbols",
      status: 400,
      detail: "Provide one or more comma-separated stock symbols in the symbols query parameter.",
    });
    return;
  }

  await startSse(req, res, "quotes", async ({ writeEvent, writeSerializedEvent }) => {
    await writeEvent("ready", {
      symbols,
      source: resolveQuoteStreamSource(),
    });

    let active = true;
    let snapshotRefreshInFlight = false;
    let lastQuotePayloadAt = 0;
    let snapshotRefreshTimer: NodeJS.Timeout | null = null;
    const writeQuotePayload = (payload: Awaited<ReturnType<typeof fetchQuoteSnapshotPayload>>) => {
      lastQuotePayloadAt = Date.now();
      return writeEvent("quotes", payload);
    };
    const refreshSnapshot = (title: string) => {
      if (!active || snapshotRefreshInFlight) {
        return;
      }
      snapshotRefreshInFlight = true;
      void fetchQuoteSnapshotPayload(symbols)
        .then((payload) => {
          if (!active) {
            return undefined;
          }
          return writeQuotePayload(payload);
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }
          void writeEvent("error", {
            title,
            status: 502,
            detail:
              error instanceof Error
                ? error.message
                : "Unknown quote snapshot error.",
          });
        })
        .finally(() => {
          snapshotRefreshInFlight = false;
        });
    };
    const unsubscribe = subscribeQuoteSnapshots(symbols, (payload, serializeEvent) => {
      // Live fan-out supplies a shared serialize-once thunk: stringify the
      // payload a single time per matched subset and reuse it across subscribers.
      lastQuotePayloadAt = Date.now();
      if (serializeEvent) {
        void writeSerializedEvent("quotes", serializeEvent());
        return;
      }
      void writeEvent("quotes", payload);
    });

    refreshSnapshot("Initial quote snapshot failed");
    snapshotRefreshTimer = setInterval(() => {
      if (!active) {
        return;
      }
      const payloadAgeMs = lastQuotePayloadAt
        ? Date.now() - lastQuotePayloadAt
        : Number.POSITIVE_INFINITY;
      if (payloadAgeMs < QUOTE_STREAM_SNAPSHOT_REFRESH_MS) {
        return;
      }
      refreshSnapshot("Quote snapshot refresh failed");
    }, QUOTE_STREAM_SNAPSHOT_REFRESH_MS);
    snapshotRefreshTimer.unref?.();

    return () => {
      active = false;
      if (snapshotRefreshTimer) {
        clearInterval(snapshotRefreshTimer);
        snapshotRefreshTimer = null;
      }
      unsubscribe();
    };
  });
});

router.get("/streams/options/chains", async (req, res) => {
  const rawUnderlyings = Array.isArray(req.query.underlyings)
    ? req.query.underlyings.join(",")
    : typeof req.query.underlyings === "string"
      ? req.query.underlyings
      : typeof req.query.underlying === "string"
        ? req.query.underlying
        : "";
  const underlyings = rawUnderlyings
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (!underlyings.length) {
    res.status(400).type("application/problem+json").json({
      type: "https://pyrus.local/problems/invalid-request",
      title: "Missing underlyings",
      status: 400,
      detail: "Provide one or more comma-separated underlying symbols in the underlyings query parameter.",
    });
    return;
  }

  await startSse(req, res, "option-chains", async ({ writeEvent }) => {
    await writeEvent("ready", {
      underlyings,
      source: "ibkr-bridge",
    });

    return subscribeOptionChains(underlyings, (payload) => {
      writeEvent("chains", payload);
    });
  });
});

router.get("/streams/options/quotes", async (req, res) => {
  const rawProviderContractIds = Array.isArray(req.query.contracts)
    ? req.query.contracts.join(",")
    : typeof req.query.contracts === "string"
      ? req.query.contracts
      : Array.isArray(req.query.providerContractIds)
        ? req.query.providerContractIds.join(",")
        : typeof req.query.providerContractIds === "string"
          ? req.query.providerContractIds
          : "";
  const providerContractIds = Array.from(
    new Set(
      rawProviderContractIds
        .split(",")
        .map((providerContractId) => providerContractId.trim())
        .filter(Boolean),
    ),
  );

  if (!providerContractIds.length) {
    res.status(400).type("application/problem+json").json({
      type: "https://pyrus.local/problems/invalid-request",
      title: "Missing contracts",
      status: 400,
      detail: "Provide one or more comma-separated option provider contract ids in the contracts query parameter.",
    });
    return;
  }

  const underlying =
    typeof req.query.underlying === "string" && req.query.underlying.trim()
      ? req.query.underlying.trim().toUpperCase()
      : null;

  const owner = `platform-option-quotes-sse:${nextOptionQuoteSseDemandId++}`;

  await startSse(req, res, "option-quotes", async ({ writeEvent }) => {
    let active = true;
    let ready = false;
    const queuedPayloads: OptionQuoteSnapshotPayload[] = [];
    const unsubscribe = subscribeOptionQuoteSnapshots(
      {
        underlying,
        providerContractIds,
        owner,
        intent: "visible-live",
        fallbackProvider: "cache",
      },
      (payload) => {
        if (!active) {
          return;
        }
        if (!ready) {
          queuedPayloads.push(payload);
          return;
        }
        void writeEvent("quotes", payload);
      },
    );

    await writeEvent("ready", {
      underlying,
      providerContractIds,
      source: "ibkr-bridge",
    });
    ready = true;

    await writeEvent(
      "quotes",
      readOptionQuoteDemandSnapshotPayload({
        underlying,
        providerContractIds,
        owner,
      }),
    );

    queuedPayloads.forEach((payload) => {
      void writeEvent("quotes", payload);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  });
});

router.get("/streams/orders", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "shadow";
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status as Parameters<typeof subscribeOrderSnapshots>[0]["status"] : undefined;

  await startSse(req, res, "orders", async ({ writeEvent }) => {
    await writeEvent(
      "orders",
      await fetchOrderSnapshotPayload({ accountId, mode, status }),
    );
    await writeEvent("ready", {
      accountId: accountId ?? null,
      mode,
      source: "ibkr-bridge",
    });

    return subscribeOrderSnapshots(
      { accountId, mode, status },
      (payload) => {
        writeEvent("orders", payload);
      },
      {
        onPollSuccess: ({ changed }) =>
          writeEvent("freshness", {
            stream: "orders",
            accountId: accountId ?? null,
            mode,
            changed,
            at: new Date().toISOString(),
          }),
      },
    );
  });
});

router.get("/streams/executions", async (req, res) => {
  const mode =
    req.query.mode === "live"
      ? "live"
      : req.query.mode === "shadow"
        ? "shadow"
        : undefined;
  const accountId =
    typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const days =
    typeof req.query.days === "string" && req.query.days.trim()
      ? Number(req.query.days)
      : undefined;
  const limit =
    typeof req.query.limit === "string" && req.query.limit.trim()
      ? Number(req.query.limit)
      : undefined;
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
  const providerContractId =
    typeof req.query.providerContractId === "string" &&
    req.query.providerContractId.trim()
      ? req.query.providerContractId.trim()
      : null;

  await startSse(req, res, "executions", async ({ writeEvent }) => {
    await writeEvent(
      "executions",
      await fetchExecutionSnapshotPayload({
        accountId,
        mode,
        days,
        limit,
        symbol,
        providerContractId,
      }),
    );
    await writeEvent("ready", {
      accountId: accountId ?? null,
      symbol: symbol ?? null,
      providerContractId,
      source: "ibkr-bridge",
    });

    return subscribeExecutionSnapshots(
      {
        accountId,
        mode,
        days,
        limit,
        symbol,
        providerContractId,
      },
      (payload) => {
        writeEvent("executions", payload);
      },
    );
  });
});

router.get("/streams/footprints", async (req, res) => {
  const input = buildFootprintsInput(req);
  if (!input.symbol || !input.timeframe) {
    res.status(400).type("application/problem+json").json({
      type: "https://pyrus.local/problems/invalid-request",
      title: "Missing footprint stream input",
      status: 400,
      detail: "Provide symbol and timeframe query parameters.",
    });
    return;
  }

  await startSse(req, res, "footprints", async ({ writeEvent }) => {
    let stopped = false;
    let lastSignature: string | null = null;
    const writeFootprints = async () => {
      const payload = await getVolumeFootprints(input);
      const signature = JSON.stringify({
        from: payload.from,
        to: payload.to,
        candles: payload.candles.map((candle) => [
          candle.time,
          candle.volume,
          candle.delta,
          candle.tradeCount,
        ]),
        partialReason: payload.partialReason,
      });
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;
      await writeEvent("footprints", payload);
    };

    await writeFootprints();
    await writeEvent("ready", {
      symbol: input.symbol,
      timeframe: input.timeframe,
      assetClass: input.assetClass,
      sourcePreference: input.sourcePreference,
    });

    const poll = setInterval(() => {
      if (stopped) {
        return;
      }
      void writeFootprints().catch((error) => {
        void writeEvent("stream-error", {
          title: "Footprint stream interrupted",
          detail:
            error instanceof Error ? error.message : "Unknown stream error.",
        });
      });
    }, 2_500);
    poll.unref?.();

    return () => {
      stopped = true;
      clearInterval(poll);
    };
  });
});

router.get("/streams/accounts/page", async (req, res) => {
  const mode: RuntimeMode = req.query.mode === "live" ? "live" : "shadow";
  const accountId =
    typeof req.query.accountId === "string" && req.query.accountId.trim()
      ? req.query.accountId.trim()
      : "combined";
  if (!(await admitAccountRoute(res, accountId))) return;
  const input = {
    accountId,
    mode,
    range:
      typeof req.query.range === "string"
        ? (req.query.range as AccountRange)
        : undefined,
    orderTab: req.query.orderTab === "history" ? "history" as const : "working" as const,
    assetClass:
      typeof req.query.assetClass === "string" && req.query.assetClass.trim()
        ? req.query.assetClass.trim()
        : null,
    from:
      typeof req.query.from === "string" && req.query.from.trim()
        ? new Date(req.query.from)
        : null,
    to:
      typeof req.query.to === "string" && req.query.to.trim()
        ? new Date(req.query.to)
        : null,
    symbol:
      typeof req.query.symbol === "string" && req.query.symbol.trim()
        ? req.query.symbol.trim()
        : null,
    tradeAssetClass:
      typeof req.query.tradeAssetClass === "string" &&
      req.query.tradeAssetClass.trim()
        ? req.query.tradeAssetClass.trim()
        : null,
    pnlSign:
      typeof req.query.pnlSign === "string" && req.query.pnlSign.trim()
        ? req.query.pnlSign.trim()
        : null,
    holdDuration:
      typeof req.query.holdDuration === "string" && req.query.holdDuration.trim()
        ? req.query.holdDuration.trim()
        : null,
    performanceCalendarFrom:
      typeof req.query.performanceCalendarFrom === "string" &&
      req.query.performanceCalendarFrom.trim()
        ? new Date(req.query.performanceCalendarFrom)
        : null,
  };

  // Slice 5.5: bind the caller's shadow scope for the whole connection (shadow mode).
  // ALS propagates into the per-connection poll timers created inside subscribe*.
  await startSse(req, res, "account-page", async ({ writeEvent }) =>
    withCallerShadowScope(accountId, async () => {
    const streamStartedAt = Date.now();
    const initialPrimaryPayload = await fetchAccountPagePrimaryPayload(input);
    await writeEvent("primary", initialPrimaryPayload);
    recordAccountPageStreamWrite("primary", streamStartedAt);
    await writeEvent("ready", {
      accountId,
      mode,
      source: accountId === SHADOW_ACCOUNT_ID ? "shadow-ledger" : "account-page",
    });

    return subscribeAccountPageSnapshots(
      input,
      (payload) => {
        writeEvent("live", payload);
      },
      (payload) => {
        const writeStartedAt = Date.now();
        void writeEvent("derived", payload).then(() => {
          recordAccountPageStreamWrite("derived", writeStartedAt);
        });
      },
      {
        initialPrimaryPayload,
        initialLiveDelayMs: ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS,
        initialDerivedDelayMs: ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS,
        onPollSuccess: ({ changed, kind }) =>
          writeEvent("freshness", {
            stream: "account-page",
            kind,
            accountId,
            mode,
            changed,
            at: new Date().toISOString(),
          }),
      },
    );
  }));
});

router.get("/streams/accounts", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "shadow";
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  if (!(await admitAccountRoute(res, accountId))) return;

  await startSse(req, res, "accounts", async ({ writeEvent }) => {
    await writeEvent(
      "accounts",
      await fetchAccountSnapshotPayload({ accountId, mode }),
    );
    await writeEvent("ready", {
      accountId: accountId ?? null,
      mode,
      source: "ibkr-bridge",
    });

    return subscribeAccountSnapshots(
      { accountId, mode },
      (payload) => {
        writeEvent("accounts", payload);
      },
      {
        onPollSuccess: ({ changed }) =>
          writeEvent("freshness", {
            stream: "accounts",
            accountId: accountId ?? null,
            mode,
            changed,
            at: new Date().toISOString(),
          }),
      },
    );
  });
});

router.get("/streams/accounts/shadow", async (req, res) => {
  // Slice 5.5: bind the caller's shadow scope for the whole connection.
  await startSse(req, res, "shadow-accounts", async ({ writeEvent }) =>
    withCallerShadowScope(SHADOW_ACCOUNT_ID, async () => {
    await writeEvent("accounts", await fetchShadowAccountSnapshotPayload());
    await writeEvent("ready", {
      accountId: SHADOW_ACCOUNT_ID,
      mode: "shadow",
      source: "shadow-ledger",
    });

    return subscribeShadowAccountSnapshots(
      (payload) => {
        writeEvent("accounts", payload);
      },
      {
        onPollSuccess: ({ changed }) =>
          writeEvent("freshness", {
            stream: "shadow-accounts",
            accountId: SHADOW_ACCOUNT_ID,
            mode: "shadow",
            changed,
            at: new Date().toISOString(),
          }),
      },
    );
  }));
});

router.get("/streams/stocks/aggregates", async (req, res) => {
  const rawSymbols = Array.isArray(req.query.symbols)
    ? req.query.symbols.join(",")
    : typeof req.query.symbols === "string"
      ? req.query.symbols
      : "";
  let symbols = normalizeStreamSymbols(rawSymbols);
  const sessionId =
    typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
  const sessionToken = Symbol(sessionId || "stock-aggregate-stream");

  if (!symbols.length) {
    res.status(400).type("application/problem+json").json({
      type: "https://pyrus.local/problems/invalid-request",
      title: "Missing symbols",
      status: 400,
      detail: "Provide one or more comma-separated stock symbols in the symbols query parameter.",
    });
    return;
  }

  if (!isStockAggregateStreamingAvailable()) {
    res.status(503).type("application/problem+json").json({
      type: "https://pyrus.local/problems/upstream",
      title: "Stock aggregate streaming is not configured.",
      status: 503,
      detail: "Set Massive market-data credentials before using stock aggregate streams.",
      code: "stock_aggregate_stream_unavailable",
    });
    return;
  }

  await startSse(req, res, "stock-aggregates", async ({ writeEvent, writeSerializedEvent }) => {
    const writeSnapshotAggregates = async (nextSymbols: string[]) => {
      const snapshotBySymbolMinute = new Map<
        string,
        StockMinuteAggregateMessage
      >();
      nextSymbols.forEach((symbol) => {
        getRecentStockMinuteAggregateHistory({
          symbol,
          limit: STOCK_AGGREGATE_STREAM_SNAPSHOT_HISTORY_LIMIT,
        }).forEach((aggregate) => {
          snapshotBySymbolMinute.set(
            `${aggregate.symbol}:${aggregate.startMs}`,
            aggregate,
          );
        });
      });
      getCurrentStockMinuteAggregates(nextSymbols).forEach((aggregate) => {
        snapshotBySymbolMinute.set(
          `${aggregate.symbol}:${aggregate.startMs}`,
          aggregate,
        );
      });
      const snapshotAggregates = Array.from(snapshotBySymbolMinute.values()).sort(
        (left, right) =>
          String(left.symbol).localeCompare(String(right.symbol)) ||
          Number(left.startMs) - Number(right.startMs),
      );
      let snapshotWritesSinceYield = 0;
      for (const aggregate of snapshotAggregates) {
        await writeEvent("aggregate", {
          ...aggregate,
          latency: {
            ...(aggregate.latency ?? {}),
            apiServerEmittedAt: new Date(),
          },
        });
        // A multi-symbol subscribe front-loads up to symbols x (history + current)
        // aggregates (~24/symbol => thousands of synchronous writes). Writing them
        // in one burst monopolizes the event loop and queues every other request
        // behind it during the market-open subscribe storm. Yield periodically so
        // requests interleave instead of stalling.
        if (++snapshotWritesSinceYield % SSE_SNAPSHOT_YIELD_EVERY === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    };

    await writeSnapshotAggregates(symbols);
    const writeReady = async (nextSymbols: string[]) => {
      const streamSource = getStockAggregateStreamDiagnostics().provider;
      await writeEvent("ready", {
        symbols: nextSymbols,
        delayed: streamSource === "massive-delayed-websocket",
        source: streamSource,
      });
    };

    await writeReady(symbols);
    const statusTimer = setInterval(() => {
      void writeEvent("stream-status", {
        state: "open",
        ...getStockAggregateStreamDiagnostics(),
      });
    }, 5_000);
    statusTimer.unref?.();

    const aggregateSubscription = subscribeMutableStockMinuteAggregates(
      symbols,
      (message, serializeEvent) => {
        // Live fan-out hands a shared serialize-once thunk: stringify the payload
        // a single time per broadcast and reuse the bytes across every subscriber.
        if (serializeEvent) {
          void writeSerializedEvent("aggregate", serializeEvent());
          return;
        }
        // Defensive fallback (no thunk supplied): serialize locally.
        void writeEvent("aggregate", {
          ...message,
          latency: {
            ...(message.latency ?? {}),
            apiServerEmittedAt: new Date(),
          },
        });
      },
    );

    if (sessionId) {
      stockAggregateStreamSessions.set(sessionId, {
        token: sessionToken,
        async setSymbols(nextSymbols: string[]) {
          symbols = normalizeStreamSymbols(nextSymbols);
          if (!symbols.length) {
            return;
          }
          aggregateSubscription.setSymbols(symbols);
          await writeSnapshotAggregates(symbols);
          await writeReady(symbols);
        },
      });
    }

    return () => {
      clearInterval(statusTimer);
      if (
        sessionId &&
        stockAggregateStreamSessions.get(sessionId)?.token === sessionToken
      ) {
        stockAggregateStreamSessions.delete(sessionId);
      }
      aggregateSubscription.unsubscribe();
    };
  });
});

router.post("/streams/stocks/aggregates/sessions/:sessionId/symbols", async (req, res) => {
  const sessionId = req.params.sessionId?.trim() || "";
  const session = sessionId ? stockAggregateStreamSessions.get(sessionId) : null;
  if (!session) {
    res.status(404).type("application/problem+json").json({
      type: "https://pyrus.local/problems/not-found",
      title: "Stock aggregate stream session not found",
      status: 404,
      detail: "Open a stock aggregate stream before updating its symbols.",
      code: "stock_aggregate_stream_session_not_found",
    });
    return;
  }

  const symbols = normalizeStreamSymbols(
    (req.body as { symbols?: unknown } | undefined)?.symbols,
  );
  if (!symbols.length) {
    res.status(400).type("application/problem+json").json({
      type: "https://pyrus.local/problems/invalid-request",
      title: "Missing symbols",
      status: 400,
      detail: "Provide one or more stock symbols in the symbols body field.",
    });
    return;
  }

  await session.setSymbols(symbols);
  res.json({
    sessionId,
    symbols,
    diagnostics: getStockAggregateStreamDiagnostics(),
    updatedAt: new Date().toISOString(),
  });
});

export default router;
