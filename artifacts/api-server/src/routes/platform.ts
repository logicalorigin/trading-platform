import { Router, type IRouter, type Request, type Response } from "express";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  GetQuoteSnapshotsQueryParams,
  GetQuoteSnapshotsResponse,
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
  GetFlowUniverseResponse,
  ListOrdersQueryParams,
  ListOrdersResponse,
  ListPositionsQueryParams,
  ListPositionsResponse,
  PlaceOrderBody,
  ReplaceOrderBody,
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
  getMarketDepth,
  getNews,
  getOptionChainWithDebug,
  getOptionExpirationsWithDebug,
  getOptionChartBarsWithDebug,
  resolveOptionContractWithDebug,
  getQuoteSnapshots,
  getRuntimeDiagnostics,
  getFlowPremiumDistribution,
  getOptionsFlowUniverse,
  getSession,
  getUniverseLogos,
  listBrokerConnections,
  listExecutions,
  listAggregateFlowEvents,
  listFlowEvents,
  listOrders,
  listPositions,
  listWatchlists,
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
import { getGexDashboardData } from "../services/gex";
import {
  fetchAccountSnapshotPayload,
  fetchExecutionSnapshotPayload,
  fetchMarketDepthSnapshotPayload,
  fetchOptionChainSnapshotPayload,
  fetchHistoricalBarSnapshotPayload,
  fetchOptionQuoteSnapshotPayload,
  fetchOrderSnapshotPayload,
  fetchQuoteSnapshotPayload,
  subscribeAccountSnapshots,
  subscribeExecutionSnapshots,
  subscribeMarketDepthSnapshots,
  subscribeOptionChains,
  subscribeHistoricalBarSnapshots,
  subscribeOptionQuoteSnapshots,
  subscribeOrderSnapshots,
  subscribeQuoteSnapshots,
} from "../services/bridge-streams";
import {
  fetchShadowAccountSnapshotPayload,
  subscribeShadowAccountSnapshots,
} from "../services/shadow-account-streams";
import {
  getCurrentStockMinuteAggregates,
  getStockAggregateStreamDiagnostics,
  isStockAggregateStreamingAvailable,
  subscribeMutableStockMinuteAggregates,
} from "../services/stock-aggregate-stream";
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
  listAccounts,
  testFlexToken,
} from "../services/account";
import type { AccountRange } from "../services/account-ranges";
import {
  getShadowTradingPatterns,
  placeShadowOrder,
  persistShadowTradingPatternsSnapshot,
  previewShadowOrder,
  runShadowWatchlistBacktest,
  SHADOW_ACCOUNT_ID,
} from "../services/shadow-account";
import {
  attachLegacyIbkrBridgeRuntime,
  attachIbkrBridgeRuntime,
  detachIbkrBridgeRuntime,
  getIbkrBridgeLauncher,
  recordLegacyIbkrBridgeActivationProgress,
} from "../services/ibkr-bridge-runtime";

const router: IRouter = Router();
const stockAggregateStreamSessions = new Map<
  string,
  {
    token: symbol;
    setSymbols(symbols: string[]): Promise<void>;
  }
>();
const LOGO_PROXY_ALLOWED_HOSTS = new Set([
  "s3-symbol-logo.tradingview.com",
  "api.polygon.io",
  "storage.googleapis.com",
  "financialmodelingprep.com",
  "images.financialmodelingprep.com",
]);

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
const HISTORY_BAR_TIMEFRAMES = ["5s", "1m", "5m", "15m", "1h", "1d"] as const;
type RouteHistoryBarTimeframe = (typeof HISTORY_BAR_TIMEFRAMES)[number];
const isHistoryBarTimeframe = (
  value: string,
): value is RouteHistoryBarTimeframe =>
  HISTORY_BAR_TIMEFRAMES.includes(value as RouteHistoryBarTimeframe);

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
const ROUTE_DIR = dirname(fileURLToPath(import.meta.url));
const IBKR_BRIDGE_HELPER_SCRIPT_PATHS = [
  resolve(ROUTE_DIR, "../../../../scripts/windows/rayalgo-ibkr-helper.ps1"),
  resolve(ROUTE_DIR, "../../../scripts/windows/rayalgo-ibkr-helper.ps1"),
  resolve(process.cwd(), "../../scripts/windows/rayalgo-ibkr-helper.ps1"),
  resolve(process.cwd(), "scripts/windows/rayalgo-ibkr-helper.ps1"),
];
const IBKR_BRIDGE_BUNDLE_PATHS = [
  resolve(ROUTE_DIR, "../../../../artifacts/ibgateway-bridge-windows-current.tar.gz"),
  resolve(ROUTE_DIR, "../../../ibgateway-bridge-windows-current.tar.gz"),
  resolve(process.cwd(), "../../artifacts/ibgateway-bridge-windows-current.tar.gz"),
  resolve(process.cwd(), "artifacts/ibgateway-bridge-windows-current.tar.gz"),
];
const IBKR_BRIDGE_BUNDLE_URL_ENV_NAMES = [
  "IBKR_BRIDGE_BUNDLE_URL",
  "RAYALGO_IBKR_BRIDGE_BUNDLE_URL",
];
const IBKR_BRIDGE_PUBLIC_BASE_URL_ENV_NAMES = [
  "IBKR_BRIDGE_API_BASE_URL",
  "RAYALGO_PUBLIC_API_BASE_URL",
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
const SSE_DRAIN_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env["IBKR_SSE_DRAIN_TIMEOUT_MS"] ?? "5000", 10) ||
    5_000,
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

async function readIbkrBridgeHelperScript(): Promise<string> {
  let lastError: unknown = null;

  for (const candidate of IBKR_BRIDGE_HELPER_SCRIPT_PATHS) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("IB Gateway bridge protocol helper script was not found.");
}

function findIbkrBridgeBundlePath(): string | null {
  for (const candidate of IBKR_BRIDGE_BUNDLE_PATHS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

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

export function getIbkrBridgeBundleRedirectUrl(): string | null {
  for (const name of IBKR_BRIDGE_BUNDLE_URL_ENV_NAMES) {
    const value = process.env[name]?.trim();
    if (!value) {
      continue;
    }

    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.toString();
      }
    } catch {
      // Ignore invalid configuration and continue to the next supported name.
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
  if (forwardedHost && !isLoopbackHost(forwardedHost)) {
    return buildOriginFromHost(forwardedProto, forwardedHost, {
      preferHttpsForPublicHost: true,
    });
  }

  const host = req.get("host")?.trim();
  const origin = req.get("origin");
  if (host && isLoopbackHost(host) && origin) {
    const normalizedOrigin = normalizeOrigin(origin);
    if (normalizedOrigin && !isLoopbackHost(new URL(normalizedOrigin).host)) {
      return normalizedOrigin;
    }
  }

  if ((host && isLoopbackHost(host)) || (forwardedHost && isLoopbackHost(forwardedHost))) {
    const replitBaseUrl = getReplitBridgeBaseUrl();
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

const BARS_REQUEST_MAX_WINDOW_DAYS: Record<string, number> = {
  "1s": 7,
  "5s": 7,
  "15s": 7,
  "1m": 45,
  "5m": 180,
  "15m": 365,
  "1h": 365 * 3,
  "1d": 365 * 15,
};

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
    type: "https://rayalgo.local/problems/bars-request-too-large",
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
      }
    | undefined,
): void {
  if (!debug) {
    return;
  }

  res.setHeader("X-RayAlgo-Cache-Status", debug.cacheStatus);
  res.setHeader("X-RayAlgo-Request-Ms", String(debug.totalMs));

  if (debug.upstreamMs != null) {
    res.setHeader("X-RayAlgo-Upstream-Ms", String(debug.upstreamMs));
  }
  if (typeof debug.gapFilled === "boolean") {
    res.setHeader("X-RayAlgo-Gap-Filled", debug.gapFilled ? "1" : "0");
  }
  if (typeof debug.stale === "boolean") {
    res.setHeader("X-RayAlgo-Cache-Stale", debug.stale ? "1" : "0");
  }
  if (typeof debug.ageMs === "number") {
    res.setHeader("X-RayAlgo-Cache-Age-Ms", String(debug.ageMs));
  }
  if (typeof debug.degraded === "boolean") {
    res.setHeader("X-RayAlgo-Degraded", debug.degraded ? "1" : "0");
  }
  if (typeof debug.reason === "string" && debug.reason) {
    res.setHeader("X-RayAlgo-Degraded-Reason", debug.reason);
  }
  if (typeof debug.backoffRemainingMs === "number") {
    res.setHeader(
      "X-RayAlgo-Backoff-Remaining-Ms",
      String(Math.max(0, Math.round(debug.backoffRemainingMs))),
    );
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
  setup: (controls: {
    writeEvent: (event: string, payload: unknown) => Promise<void>;
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
  const lastEventId =
    typeof req.headers["last-event-id"] === "string" &&
    req.headers["last-event-id"].trim()
      ? req.headers["last-event-id"].trim()
      : null;

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
        cleanup();
      })
      .finally(() => {
        pendingChunks = Math.max(0, pendingChunks - 1);
      });

    return writeQueue;
  };

  const writeComment = (comment: string): Promise<void> =>
    enqueueChunk(`: ${comment.replace(/\r?\n/g, " ")}\n\n`);

  const writeEvent = (event: string, payload: unknown): Promise<void> => {
    const eventId = String(nextEventId);
    nextEventId += 1;

    return enqueueChunk(
      `id: ${eventId}\n` +
        `event: ${event}\n` +
        `data: ${JSON.stringify(payload)}\n\n`,
    );
  };

  await enqueueChunk("retry: 5000\n\n");

  heartbeat = setInterval(() => {
    void writeComment(`ping ${new Date().toISOString()}`);
  }, 15_000);

  res.on("close", cleanup);
  req.on("aborted", cleanup);

  try {
    unsubscribe =
      (await setup({
        writeEvent,
        writeComment,
        lastEventId,
      })) ?? (() => {});
  } catch (error) {
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
  const data = GetSessionResponse.parse(await getSession());

  res.json(data);
});

router.get("/diagnostics/runtime", async (_req, res) => {
  res.json(await getRuntimeDiagnostics());
});

router.get("/ibkr/bridge/launcher", async (req, res) => {
  const apiBaseUrl = getIbkrBridgeRequestOrigin(req);
  const bundleUrl =
    findIbkrBridgeBundlePath() || getIbkrBridgeBundleRedirectUrl()
      ? `${apiBaseUrl}/api/ibkr/bridge/bundle.tar.gz`
      : null;

  res.json(
    getIbkrBridgeLauncher({
      apiBaseUrl,
      bundleUrl,
    }),
  );
});

router.post("/ibkr/activation/:activationId/progress", async (req, res) => {
  res.json(
    recordLegacyIbkrBridgeActivationProgress(
      req.params.activationId,
      req.body,
    ),
  );
});

router.post("/ibkr/activation/:activationId/complete", async (req, res) => {
  res.json(await attachLegacyIbkrBridgeRuntime(req.params.activationId, req.body));
});

router.get("/ibkr/bridge/helper.ps1", async (_req, res) => {
  const script = await readIbkrBridgeHelperScript();

  res
    .type("text/plain; charset=utf-8")
    .setHeader("Cache-Control", "no-store");
  res.send(script);
});

router.get("/ibkr/bridge/bundle.tar.gz", async (_req, res) => {
  const bundlePath = findIbkrBridgeBundlePath();
  if (!bundlePath) {
    const redirectUrl = getIbkrBridgeBundleRedirectUrl();
    if (redirectUrl) {
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, redirectUrl);
      return;
    }

    res.status(404).json({
      error: "IB Gateway bridge bundle was not found.",
      detail:
        "Set IBKR_BRIDGE_BUNDLE_URL to an external artifact URL or provide a local bridge bundle.",
    });
    return;
  }

  res
    .type("application/gzip")
    .setHeader("Cache-Control", "no-store");
  res.sendFile(bundlePath);
});

router.post("/ibkr/bridge/attach", async (req, res) => {
  res.json(await attachIbkrBridgeRuntime(req.body));
});

router.post("/ibkr/bridge/detach", async (req, res) => {
  res.json(detachIbkrBridgeRuntime(req.body));
});

router.get("/broker-connections", async (_req, res) => {
  const data = ListBrokerConnectionsResponse.parse(await listBrokerConnections());

  res.json(data);
});

router.get("/accounts", async (req, res) => {
  const query = ListAccountsQueryParams.parse(req.query);
  const data = ListAccountsResponse.parse(await listAccounts(query));

  res.json(data);
});

router.get("/accounts/flex/health", async (_req, res) => {
  res.json(GetFlexHealthResponse.parse(await getFlexHealth()));
});

router.post("/accounts/flex/test", async (_req, res) => {
  res.json(await testFlexToken());
});

router.get("/accounts/:accountId/summary", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "paper" ? "paper" : undefined;
  res.json(await getAccountSummary({ accountId: req.params.accountId, mode }));
});

router.get("/accounts/:accountId/equity-history", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "paper" ? "paper" : undefined;
  res.json(
    await getAccountEquityHistory({
      accountId: req.params.accountId,
      range:
        typeof req.query.range === "string"
          ? (req.query.range as AccountRange)
          : undefined,
      benchmark:
        typeof req.query.benchmark === "string" ? req.query.benchmark : null,
      mode,
    }),
  );
});

router.get("/accounts/:accountId/trading-patterns", async (req, res) => {
  if (req.params.accountId !== SHADOW_ACCOUNT_ID) {
    res.status(400).json({
      code: "shadow_patterns_only",
      message: "Trading pattern analysis is currently available for the Shadow account only.",
    });
    return;
  }
  res.json(
    await getShadowTradingPatterns({
      range:
        typeof req.query.range === "string"
          ? (req.query.range as AccountRange)
          : undefined,
      snapshotId:
        typeof req.query.snapshotId === "string" ? req.query.snapshotId : "latest",
    }),
  );
});

router.post("/accounts/:accountId/trading-patterns/snapshots", async (req, res) => {
  if (req.params.accountId !== SHADOW_ACCOUNT_ID) {
    res.status(400).json({
      code: "shadow_patterns_only",
      message: "Trading pattern analysis snapshots are currently available for the Shadow account only.",
    });
    return;
  }
  res.status(201).json(
    await persistShadowTradingPatternsSnapshot({
      range:
        typeof req.body?.range === "string"
          ? (req.body.range as AccountRange)
          : typeof req.query.range === "string"
            ? (req.query.range as AccountRange)
            : undefined,
    }),
  );
});

router.get("/accounts/:accountId/allocation", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "paper" ? "paper" : undefined;
  res.json(await getAccountAllocation({ accountId: req.params.accountId, mode }));
});

router.get("/accounts/:accountId/positions", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "paper" ? "paper" : undefined;
  res.json(
    await getAccountPositions({
      accountId: req.params.accountId,
      assetClass:
        typeof req.query.assetClass === "string" ? req.query.assetClass : null,
      mode,
    }),
  );
});

router.get("/accounts/:accountId/positions-at-date", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "paper" ? "paper" : undefined;
  res.json(
    await getAccountPositionsAtDate({
      accountId: req.params.accountId,
      date:
        typeof req.query.date === "string" && req.query.date.trim()
          ? req.query.date
          : "",
      assetClass:
        typeof req.query.assetClass === "string" ? req.query.assetClass : null,
      mode,
    }),
  );
});

router.get("/accounts/:accountId/closed-trades", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "paper" ? "paper" : undefined;
  res.json(
    await getAccountClosedTrades({
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
    }),
  );
});

router.get("/accounts/:accountId/orders", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "paper" ? "paper" : undefined;
  res.json(
    await getAccountOrders({
      accountId: req.params.accountId,
      tab:
        req.query.tab === "history" || req.query.tab === "working"
          ? req.query.tab
          : undefined,
      mode,
    }),
  );
});

router.post("/accounts/:accountId/orders/:orderId/cancel", async (req, res) => {
  res.json(
    await cancelAccountOrder({
      accountId: req.params.accountId,
      orderId: req.params.orderId,
      confirm: req.body?.confirm === true,
    }),
  );
});

router.get("/accounts/:accountId/risk", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "paper" ? "paper" : undefined;
  res.json(await getAccountRisk({ accountId: req.params.accountId, mode }));
});

router.get("/accounts/:accountId/cash-activity", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "paper" ? "paper" : undefined;
  res.json(
    await getAccountCashActivity({
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
    }),
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
  res.json(await listWatchlists());
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
  const data = ListPositionsResponse.parse(await listPositions(query));

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
    mode: "paper",
  });

  res.json(await previewShadowOrder(body));
});

router.post("/shadow/orders", async (req, res) => {
  const body = PlaceOrderBody.parse({
    ...req.body,
    accountId: SHADOW_ACCOUNT_ID,
    mode: "paper",
  });

  res.status(201).json(await placeShadowOrder(body));
});

router.post("/orders", async (req, res) => {
  const body = PlaceOrderBody.parse(req.body);
  res.status(201).json(await placeOrder(body));
});

router.post("/orders/preview", async (req, res) => {
  const body = PlaceOrderBody.parse(req.body);

  res.json(await previewOrder(body));
});

router.post("/orders/submit", async (req, res) => {
  if (Array.isArray(req.body?.ibkrOrders)) {
    res.status(201).json(await submitRawOrders({
      accountId:
        typeof req.body.accountId === "string"
          ? req.body.accountId
          : null,
      mode:
        req.body.mode === "live" || req.body.mode === "paper"
          ? req.body.mode
          : null,
      confirm: req.body.confirm === true,
      parentOrderRequest:
        req.body.parentOrderRequest && typeof req.body.parentOrderRequest === "object"
          ? PlaceOrderBody.parse(req.body.parentOrderRequest)
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
    mode: body.mode === "live" ? "live" : "paper",
    confirm: body.confirm ?? false,
  }));
});

router.post("/orders/:orderId/cancel", async (req, res) => {
  const body = CancelOrderBody.parse(req.body);
  res.json(await cancelOrder({
    accountId: body.accountId,
    orderId: req.params.orderId,
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

  res.json(await listExecutions({
    accountId:
      typeof query.accountId === "string" ? query.accountId : undefined,
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

router.get("/gex/:underlying", async (req, res) => {
  const data = await getGexDashboardData({
    underlying: req.params.underlying,
    signal: createRequestAbortSignal(req, res),
  });

  res.json(data);
});

router.post("/options/quotes", async (req, res) => {
  const body = GetOptionQuoteSnapshotsBody.parse(req.body);
  const data = GetOptionQuoteSnapshotsResponse.parse(
    await fetchOptionQuoteSnapshotPayload({
      underlying: body.underlying ?? null,
      providerContractIds: body.providerContractIds,
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
  const upstream = await fetch(parsed, {
    headers: { Accept: "image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8" },
    signal: createRequestAbortSignal(req, res),
  });
  if (!upstream.ok || !upstream.body) {
    res.status(upstream.status || 502).end();
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.type(upstream.headers.get("content-type") || "image/svg+xml");
  const bytes = Buffer.from(await upstream.arrayBuffer());
  res.send(bytes);
});

router.get("/bars", async (req, res) => {
  const signal = createRequestAbortSignal(req, res);
  const query = GetBarsQueryParams.parse(
    coerceBooleanQueryFields(
      coerceDateQueryFields(req.query as Record<string, unknown>, ["from", "to"]),
      [
        "outsideRth",
        "allowHistoricalSynthesis",
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
  }, { signal });
  setRequestDebugHeaders(res, raw.debug);
  const data = GetBarsResponse.parse(raw);

  res.json(data);
});

router.get("/options/chains", async (req, res) => {
  const query = GetOptionChainQueryParams.parse(
    coerceDateQueryFields(req.query as Record<string, unknown>, ["expirationDate"]),
  );
  const raw = await getOptionChainWithDebug(query);
  setRequestDebugHeaders(res, raw.debug);
  const data = GetOptionChainResponse.parse(raw);

  res.json(data);
});

router.post("/options/chains/batch", async (req, res) => {
  const body = BatchOptionChainsBody.parse(req.body);
  const raw = await batchOptionChains(body);
  setRequestDebugHeaders(res, raw.debug);
  const data = BatchOptionChainsResponse.parse(raw);

  res.json(data);
});

router.get("/options/expirations", async (req, res) => {
  const query = GetOptionExpirationsQueryParams.parse(
    req.query as Record<string, unknown>,
  );
  const raw = await getOptionExpirationsWithDebug(query);
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

router.get("/market-depth", async (req, res) => {
  const query = req.query as Record<string, unknown>;

  if (typeof query.symbol !== "string" || !query.symbol.trim()) {
    res.status(400).json({
      title: "Invalid request",
      status: 400,
      detail: "symbol query parameter is required.",
    });
    return;
  }

  res.json(await getMarketDepth({
    accountId:
      typeof query.accountId === "string" ? query.accountId : undefined,
    symbol: query.symbol,
    assetClass:
      query.assetClass === "option"
        ? "option"
        : query.assetClass === "equity"
          ? "equity"
          : undefined,
    providerContractId:
      typeof query.providerContractId === "string" &&
      query.providerContractId.trim()
        ? query.providerContractId.trim()
        : null,
    exchange:
      typeof query.exchange === "string" && query.exchange.trim()
        ? query.exchange.trim()
        : null,
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
  const query = ListFlowEventsQueryParams.parse(req.query);
  const blocking = readBooleanQueryFlag(req.query.blocking) ?? false;
  const queueRefresh = readBooleanQueryFlag(req.query.queueRefresh) ?? true;
  const data = ListFlowEventsResponse.parse(
    await listFlowEvents({ ...query, blocking, queueRefresh }),
  );

  res.json(data);
});

router.get("/flow/events/aggregate", async (req, res) => {
  const query = ListFlowEventsQueryParams.parse(req.query);
  const data = ListFlowEventsResponse.parse(await listAggregateFlowEvents(query));

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
      type: "https://rayalgo.local/problems/invalid-request",
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
      type: "https://rayalgo.local/problems/invalid-request",
      title: "Missing symbols",
      status: 400,
      detail: "Provide one or more comma-separated stock symbols in the symbols query parameter.",
    });
    return;
  }

  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent("quotes", await fetchQuoteSnapshotPayload(symbols));
    await writeEvent("ready", {
      symbols,
      source: "ibkr-bridge",
    });

    return subscribeQuoteSnapshots(symbols, (payload) => {
      writeEvent("quotes", payload);
    });
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
      type: "https://rayalgo.local/problems/invalid-request",
      title: "Missing underlyings",
      status: 400,
      detail: "Provide one or more comma-separated underlying symbols in the underlyings query parameter.",
    });
    return;
  }

  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent(
      "chains",
      await fetchOptionChainSnapshotPayload(underlyings),
    );
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
      type: "https://rayalgo.local/problems/invalid-request",
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

  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent(
      "quotes",
      await fetchOptionQuoteSnapshotPayload({
        underlying,
        providerContractIds,
      }),
    );
    await writeEvent("ready", {
      underlying,
      providerContractIds,
      source: "ibkr-bridge",
    });

    return subscribeOptionQuoteSnapshots(
      {
        underlying,
        providerContractIds,
      },
      (payload) => {
        writeEvent("quotes", payload);
      },
    );
  });
});

router.get("/streams/bars", async (req, res) => {
  const symbol =
    typeof req.query.symbol === "string" && req.query.symbol.trim()
      ? req.query.symbol.trim().toUpperCase()
      : "";
  const timeframe =
    typeof req.query.timeframe === "string" ? req.query.timeframe : "";

  if (!symbol || !isHistoryBarTimeframe(timeframe)) {
    res.status(400).type("application/problem+json").json({
      type: "https://rayalgo.local/problems/invalid-request",
      title: "Missing bar stream input",
      status: 400,
      detail: "Provide symbol and timeframe query parameters for the historical bar stream.",
    });
    return;
  }

  const providerContractId =
    typeof req.query.providerContractId === "string" &&
    req.query.providerContractId.trim()
      ? req.query.providerContractId.trim()
      : null;

  await startSse(req, res, async ({ writeEvent }) => {
    let lastBarSignature: string | null = null;
    const buildBarSignature = (
      bar: {
        timestamp: Date | string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      } | null,
    ): string | null => {
      if (!bar) {
        return null;
      }

      const timestamp =
        bar.timestamp instanceof Date ? bar.timestamp.toISOString() : String(bar.timestamp);
      return JSON.stringify({
        timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    };
    const writeBarPayload = async (payload: Awaited<
      ReturnType<typeof fetchHistoricalBarSnapshotPayload>
    >) => {
      const signature = buildBarSignature(payload.bar);
      if (!payload.bar || !signature || signature === lastBarSignature) {
        return;
      }

      lastBarSignature = signature;
      await writeEvent("bar", payload);
    };

    await writeBarPayload(
      await fetchHistoricalBarSnapshotPayload({
        symbol,
        timeframe,
        assetClass:
          req.query.assetClass === "option"
            ? "option"
            : req.query.assetClass === "equity"
              ? "equity"
              : undefined,
        providerContractId,
        outsideRth:
          typeof req.query.outsideRth === "string"
            ? req.query.outsideRth === "true"
            : undefined,
        source:
          req.query.source === "midpoint" || req.query.source === "bid_ask"
            ? req.query.source
            : req.query.source === "trades"
              ? "trades"
              : undefined,
      }),
    );
    await writeEvent("ready", {
      symbol,
      timeframe,
      providerContractId,
      source: "ibkr-bridge",
    });
    const heartbeat = setInterval(() => {
      void writeEvent("heartbeat", { at: new Date().toISOString() });
    }, 15_000);
    heartbeat.unref?.();

    try {
      const unsubscribeBars = subscribeHistoricalBarSnapshots(
        {
          symbol,
          timeframe,
          assetClass:
            req.query.assetClass === "option"
              ? "option"
              : req.query.assetClass === "equity"
                ? "equity"
                : undefined,
          providerContractId,
          outsideRth:
            typeof req.query.outsideRth === "string"
              ? req.query.outsideRth === "true"
              : undefined,
          source:
            req.query.source === "midpoint" || req.query.source === "bid_ask"
              ? req.query.source
              : req.query.source === "trades"
                ? "trades"
                : undefined,
        },
        (payload) => {
          void writeBarPayload(payload);
        },
        (error) => {
          void writeEvent("stream-error", {
            title: "Historical bar stream interrupted",
            detail: error instanceof Error ? error.message : "Unknown stream error.",
          });
        },
      );
      return () => {
        clearInterval(heartbeat);
        unsubscribeBars();
      };
    } catch (error) {
      clearInterval(heartbeat);
      throw error;
    }
  });
});

router.get("/streams/orders", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "paper";
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status as Parameters<typeof subscribeOrderSnapshots>[0]["status"] : undefined;

  await startSse(req, res, async ({ writeEvent }) => {
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

  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent(
      "executions",
      await fetchExecutionSnapshotPayload({
        accountId,
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

router.get("/streams/market-depth", async (req, res) => {
  if (typeof req.query.symbol !== "string" || !req.query.symbol.trim()) {
    res.status(400).type("application/problem+json").json({
      type: "https://rayalgo.local/problems/invalid-request",
      title: "Missing symbol",
      status: 400,
      detail: "Provide a symbol query parameter.",
    });
    return;
  }

  const accountId =
    typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const assetClass =
    req.query.assetClass === "option"
      ? "option"
      : req.query.assetClass === "equity"
        ? "equity"
        : undefined;
  const providerContractId =
    typeof req.query.providerContractId === "string" &&
    req.query.providerContractId.trim()
      ? req.query.providerContractId.trim()
      : null;
  const exchange =
    typeof req.query.exchange === "string" && req.query.exchange.trim()
      ? req.query.exchange.trim()
      : null;
  const symbol = req.query.symbol.trim().toUpperCase();

  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent(
      "depth",
      await fetchMarketDepthSnapshotPayload({
        accountId,
        symbol,
        assetClass,
        providerContractId,
        exchange,
      }),
    );
    await writeEvent("ready", {
      accountId: accountId ?? null,
      symbol,
      providerContractId,
      source: "ibkr-bridge",
    });

    return subscribeMarketDepthSnapshots(
      {
        accountId,
        symbol,
        assetClass,
        providerContractId,
        exchange,
      },
      (payload) => {
        writeEvent("depth", payload);
      },
    );
  });
});

router.get("/streams/accounts", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "paper";
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;

  await startSse(req, res, async ({ writeEvent }) => {
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
  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent("accounts", await fetchShadowAccountSnapshotPayload());
    await writeEvent("ready", {
      accountId: SHADOW_ACCOUNT_ID,
      mode: "paper",
      source: "shadow-ledger",
    });

    return subscribeShadowAccountSnapshots((payload) => {
      writeEvent("accounts", payload);
    });
  });
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
      type: "https://rayalgo.local/problems/invalid-request",
      title: "Missing symbols",
      status: 400,
      detail: "Provide one or more comma-separated stock symbols in the symbols query parameter.",
    });
    return;
  }

  if (!isStockAggregateStreamingAvailable()) {
    res.status(503).type("application/problem+json").json({
      type: "https://rayalgo.local/problems/upstream",
      title: "Stock aggregate streaming is not configured.",
      status: 503,
      detail: "Set IBKR bridge configuration or Polygon market-data credentials before using stock aggregate streams.",
      code: "stock_aggregate_stream_unavailable",
    });
    return;
  }

  await startSse(req, res, async ({ writeEvent }) => {
    const writeSnapshotAggregates = async (nextSymbols: string[]) => {
      const snapshotAggregates = getCurrentStockMinuteAggregates(nextSymbols);
      for (const aggregate of snapshotAggregates) {
        await writeEvent("aggregate", {
          ...aggregate,
          latency: {
            ...(aggregate.latency ?? {}),
            apiServerEmittedAt: new Date(),
          },
        });
      }
    };

    await writeSnapshotAggregates(symbols);
    const writeReady = async (nextSymbols: string[]) => {
      const streamDiagnostics = getStockAggregateStreamDiagnostics();
      const streamSource =
        streamDiagnostics.provider === "none"
          ? "ibkr-websocket-derived"
          : streamDiagnostics.provider;
      await writeEvent("ready", {
        symbols: nextSymbols,
        delayed: streamSource === "polygon-delayed-websocket",
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

    const aggregateSubscription = subscribeMutableStockMinuteAggregates(symbols, (message) => {
      writeEvent("aggregate", {
        ...message,
        latency: {
          ...(message.latency ?? {}),
          apiServerEmittedAt: new Date(),
        },
      });
    });

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
      type: "https://rayalgo.local/problems/not-found",
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
      type: "https://rayalgo.local/problems/invalid-request",
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
