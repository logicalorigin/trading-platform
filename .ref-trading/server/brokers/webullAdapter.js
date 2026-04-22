import { BrokerAdapter } from "./BrokerAdapter.js";
import crypto from "node:crypto";
import mqtt from "mqtt";
import protobuf from "protobufjs";
import {
  refreshWebullConnectToken,
  resolveWebullConnectCredentials,
} from "../services/webullConnectOAuth.js";

const REQUEST_TIMEOUT_MS = 12000;
const TOKEN_CHECK_POLL_INTERVAL_MS = 2500;
const TOKEN_CHECK_TIMEOUT_MS = 15000;
const SESSION_CACHE_TTL_MS = 20000;
const HISTORY_PAGE_SIZE = 200;
const HISTORY_MAX_PAGES = 30;
const MARKET_MAX_BARS = 5000;
const MARKET_DEFAULT_BARS = 320;
const MARKET_DEFAULT_DEPTH_LEVELS = 10;
const MARKET_DEFAULT_TICK_LIMIT = 200;
const MARKET_DEFAULT_CATEGORY = "US_STOCK";
const WEBULL_STREAMING_URL = "wss://data-api.webull.com:8883/mqtt";
const STREAMING_CONNECT_TIMEOUT_MS = 12000;
const STREAMING_TTL_MS = 65000;
const STREAMING_TICK_BUFFER_SIZE = 1500;
const STREAMING_FAILURE_BACKOFF_MS = 30000;
const DEFAULT_REGION = "us";
const REGION_HOSTS = {
  us: "api.webull.com",
  hk: "api.webull.hk",
  jp: "api.webull.co.jp",
};
const WEBULL_TOKEN_STATUS_MAP = {
  0: "PENDING",
  1: "NORMAL",
  2: "INVALID",
  3: "EXPIRED",
};

export class WebullAdapter extends BrokerAdapter {
  constructor(store) {
    super(store, "webull", {
      requiredCredentialKeys: ["WEBULL_APP_KEY", "WEBULL_APP_SECRET"],
      defaultCommission: 0.0,
      capabilities: {
        marketData: true,
        optionChain: true,
        optionLadder: true,
        orderSubmit: true,
        orderLifecycleRead: true,
        orderCancel: false,
        orderReplace: false,
        liveOptionExecution: false,
        syntheticOrderFill: true,
      },
    });
    this.sessionCache = new Map();
    this.streamingSessions = new Map();
    this.streamingBackoffUntil = new Map();
    this.streamingProto = buildWebullStreamingProtoTypes();
  }

  async connect(account, credentials = {}) {
    const oauthFlow = this.#hasConnectOAuthClientCredentials(credentials);
    const appFlow = hasCredential(credentials.WEBULL_APP_KEY) && hasCredential(credentials.WEBULL_APP_SECRET);
    const loginFlow = hasCredential(credentials.WEBULL_EMAIL) && hasCredential(credentials.WEBULL_PASSWORD);

    if (!oauthFlow && !appFlow && !loginFlow) {
      throw new Error(
        "Webull requires Connect OAuth client credentials for trading or app key/secret for market data",
      );
    }

    if (oauthFlow) {
      let accountRef = null;
      try {
        accountRef = await this.#resolveAccountReference(account, {
          allowPending: true,
          forceRevalidate: false,
        });
      } catch {
        // Do not fail connect for credential-valid accounts when OAuth login has not been completed yet.
      }
      return {
        status: "connected",
        message: accountRef?.accountId
          ? `Webull Connect OAuth linked (${accountRef.accountId})`
          : "Webull Connect client credentials present (start OAuth to link brokerage trading)",
      };
    }

    if (appFlow) {
      let accountRef = null;
      let marketDataProbe = null;
      try {
        marketDataProbe = await this.#probeMarketDataAccess(account);
      } catch {
        // Keep connect resilient when market data entitlement checks fail.
      }
      try {
        await this.#ensureSession(account, {
          allowPending: true,
          allowCreateToken: false,
          allowRefreshToken: false,
        });
        accountRef = await this.#resolveAccountReference(account, {
          allowPending: true,
        });
      } catch {
        // Do not fail connect for credential-valid accounts when token provisioning is blocked.
      }
      const marketDataCredentials = marketDataProbe
        ? {
          WEBULL_MARKET_DATA_STATUS: String(marketDataProbe.state || ""),
          WEBULL_MARKET_DATA_MESSAGE: String(marketDataProbe.message || ""),
          WEBULL_MARKET_DATA_CHECKED_AT: new Date().toISOString(),
        }
        : {};
      return {
        status: "connected",
        message: accountRef?.accountId
          ? `Webull live account linked (${accountRef.accountId})`
          : (
            marketDataProbe?.state === "subscription_required"
              ? marketDataProbe.message
              : marketDataProbe?.state === "live"
                ? "Webull market data is live. Trading and portfolio sync still need brokerage auth."
                : "Webull app credentials present (run auth refresh to activate live data token)"
          ),
        credentials: marketDataCredentials,
      };
    }

    return {
      status: "connected",
      message: "Webull login credentials present (official app credentials required for live portfolio sync)",
    };
  }

  async getAuthStatus(account, options = {}) {
    const credentials = account?.credentials || {};
    const oauthFlow = this.#hasConnectOAuthClientCredentials(credentials);
    const appFlow = hasCredential(credentials.WEBULL_APP_KEY) && hasCredential(credentials.WEBULL_APP_SECRET);
    const loginFlow = hasCredential(credentials.WEBULL_EMAIL) && hasCredential(credentials.WEBULL_PASSWORD);
    const forceRevalidate = Boolean(options.forceRevalidate);

    if (!oauthFlow && !appFlow && !loginFlow) {
      return {
        broker: "webull",
        state: "missing_credentials",
        live: false,
        message: "Missing Webull Connect client credentials or Webull OpenAPI app key/secret",
        checkedAt: new Date().toISOString(),
      };
    }

    if (oauthFlow) {
      const hasAccessToken = hasCredential(credentials.WEBULL_OAUTH_ACCESS_TOKEN);
      const hasRefreshToken = hasCredential(credentials.WEBULL_OAUTH_REFRESH_TOKEN);
      if (!forceRevalidate && !hasAccessToken && !hasRefreshToken) {
        return {
          broker: "webull",
          state: "needs_login",
          live: false,
          message: "Webull Connect OAuth login required for brokerage access",
          checkedAt: new Date().toISOString(),
        };
      }

      try {
        const session = await this.#ensureConnectOAuthSession(account, {
          forceRefresh: forceRevalidate,
        });
        if (!hasCredential(session?.accessToken)) {
          return {
            broker: "webull",
            state: "needs_login",
            live: false,
            message: "Webull Connect OAuth login required for brokerage access",
            checkedAt: new Date().toISOString(),
          };
        }

        const accountRef = await this.#resolveAccountReference(account, {
          allowPending: false,
          forceRevalidate,
        });
        if (!accountRef?.accountId) {
          return {
            broker: "webull",
            state: "degraded",
            live: false,
            message: "Webull Connect authenticated, but no brokerage account was returned",
            checkedAt: new Date().toISOString(),
          };
        }

        return {
          broker: "webull",
          state: "authenticated",
          live: true,
          message: `Webull brokerage access linked (${accountRef.accountId})`,
          checkedAt: new Date().toISOString(),
        };
      } catch (error) {
        const authError = isWebullConnectAuthError(error);
        if (authError) {
          await this.#clearPersistedConnectOAuthCredentials(account).catch(() => {});
        }
        return {
          broker: "webull",
          state: authError ? "needs_login" : "degraded",
          live: false,
          message: authError
            ? normalizeWebullConnectAuthErrorMessage(error?.message)
            : (error?.message || "Webull Connect auth probe failed"),
          checkedAt: new Date().toISOString(),
        };
      }
    }

    if (!appFlow && loginFlow) {
      return {
        broker: "webull",
        state: "configured",
        live: false,
        message: "Webull login credentials configured; app key/secret required for live API sync",
        checkedAt: new Date().toISOString(),
      };
    }

    if (!forceRevalidate) {
      const cachedStatus = normalizeWebullTokenStatus(
        firstNonEmpty(
          credentials.WEBULL_TOKEN_STATUS,
          credentials.WEBULL_TOKEN_STATE,
        ),
      );
      const cachedToken = firstNonEmpty(credentials.WEBULL_ACCESS_TOKEN);
      const cachedAccountId = firstNonEmpty(
        credentials.WEBULL_ACCOUNT_ID,
        credentials.WEBULL_ACCOUNT,
        credentials.WEBULL_ACCOUNT_NO,
      );
      if (hasCredential(cachedToken) && cachedStatus === "NORMAL") {
        return {
          broker: "webull",
          state: cachedAccountId ? "authenticated" : "configured",
          live: Boolean(cachedAccountId),
          message: cachedAccountId
            ? `Webull token cached (${cachedAccountId}); run auth refresh to revalidate`
            : "Webull token cached; run auth refresh to resolve live account",
          checkedAt: new Date().toISOString(),
        };
      }
      if (hasCredential(cachedToken) && cachedStatus === "PENDING") {
        return {
          broker: "webull",
          state: "needs_token",
          live: false,
          message: "Webull token verification is still pending in OpenAPI",
          checkedAt: new Date().toISOString(),
        };
      }
      if (cachedStatus === "INVALID" || cachedStatus === "EXPIRED") {
        return {
          broker: "webull",
          state: "needs_token",
          live: false,
          message: `Webull token status is ${cachedStatus}. Run auth refresh to renegotiate token.`,
          checkedAt: new Date().toISOString(),
        };
      }
    }

    try {
      const session = await this.#ensureSession(account, {
        allowPending: true,
        forceRevalidate,
        allowCreateToken: forceRevalidate,
        allowRefreshToken: forceRevalidate,
      });
      if (session.status !== "NORMAL") {
        return {
          broker: "webull",
          state: "needs_token",
          live: false,
          message: `Webull token status is ${session.status}. Complete token verification in Webull OpenAPI before live sync.`,
          checkedAt: new Date().toISOString(),
        };
      }

      const accountRef = await this.#resolveAccountReference(account, { allowPending: false });
      if (!accountRef?.accountId) {
        return {
          broker: "webull",
          state: "degraded",
          live: false,
          message: "Webull authenticated, but no brokerage account was returned",
          checkedAt: new Date().toISOString(),
        };
      }

      return {
        broker: "webull",
        state: "authenticated",
        live: true,
        message: `Webull live API reachable (${accountRef.accountId})`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const authError = isWebullAuthError(error);
      if (authError) {
        await this.#clearPersistedSessionCredentials(account).catch(() => {});
      }
      return {
        broker: "webull",
        state: authError ? "needs_token" : "degraded",
        live: false,
        message: authError
          ? normalizeWebullAuthErrorMessage(error?.message)
          : (error?.message || "Webull auth probe failed"),
        checkedAt: new Date().toISOString(),
      };
    }

    // Unreachable fallback to keep response shape stable.
    return {
      broker: "webull",
      state: "configured",
      live: false,
      message: "Webull credentials configured",
      checkedAt: new Date().toISOString(),
    };
  }

  async refreshAuthSession(account) {
    if (this.#hasConnectOAuthClientCredentials(account?.credentials || {})) {
      return this.getAuthStatus(account, { forceRevalidate: true });
    }
    return this.getAuthStatus(account, { forceRevalidate: true });
  }

  async getPositions(account) {
    const isLiveMode = String(account?.mode || "live").toLowerCase() === "live";
    const authState = String(account?.authState || "").toLowerCase();
    try {
      const accountRef = await this.#resolveAccountReference(account, { allowPending: false });
      if (!accountRef?.accountId) {
        return [];
      }

      const payload = await this.#requestWebullTradingJson(account, {
        method: "GET",
        path: "/openapi/assets/positions",
        query: {
          account_id: accountRef.accountId,
        },
      });

      const rows = firstArray(payload, [
        "data.positions",
        "data.position_list",
        "data.positionList",
        "data.list",
        "positions",
        "position_list",
        "positionList",
        "list",
        "data",
      ]);
      const list = Array.isArray(rows) ? rows : [];
      const mapped = list
        .map((row, index) => mapWebullPosition(row, index))
        .filter(Boolean);

      return mapped;
    } catch {
      if (isLiveMode && authState === "authenticated") {
        return [];
      }
      return super.getPositions(account);
    }
  }

  async getAccountSummary(account) {
    try {
      const accountRef = await this.#resolveAccountReference(account, { allowPending: false });
      if (!accountRef?.accountId) {
        return super.getAccountSummary(account);
      }

      const payload = await this.#requestWebullTradingJson(account, {
        method: "GET",
        path: "/openapi/assets/balance",
        query: {
          account_id: accountRef.accountId,
        },
      });

      const positions = this.store.listPositions(account.accountId);
      const mapped = mapWebullBalanceSummary({
        payload,
        accountId: account.accountId,
        positionsCount: positions.length,
      });
      if (mapped) {
        return mapped;
      }
    } catch {
      // Fall through to cached summary when available.
    }

    const positions = this.store.listPositions(account.accountId);
    const latestPoint = this.store.getLatestAccountEquityPoint(account.accountId);
    const cached = mapCachedWebullSummary({
      point: latestPoint,
      accountId: account.accountId,
      positionsCount: positions.length,
    });
    if (cached) {
      return cached;
    }

    return super.getAccountSummary(account);
  }

  async getEquityHistory(account, request = {}) {
    try {
      const accountRef = await this.#resolveAccountReference(account, { allowPending: false });
      if (!accountRef?.accountId) {
        return [];
      }

      const endMs = toEpochMs(request.to) || Date.now();
      const requestedDays = clampNumber(request.days, 1, 3650, 3650);
      const startMs = toEpochMs(request.from) || (endMs - requestedDays * 24 * 60 * 60 * 1000);
      const maxPoints = clampNumber(request.maxPoints, 50, 10000, 5000);

      const balanceHistory = await this.#fetchBalanceHistoryPoints(account, accountRef.accountId, {
        startMs,
        endMs,
      });
      if (balanceHistory.length) {
        const currentSummary = await this.getAccountSummary(account).catch(() => null);
        const currentEquity = Number(currentSummary?.equity);
        if (Number.isFinite(currentEquity)) {
          balanceHistory.push({
            ts: new Date(endMs).toISOString(),
            epochMs: Math.round(endMs),
            equity: round2(currentEquity),
            source: "webull-live-summary",
            stale: false,
          });
        }
        const deduped = dedupeHistoryByTimestamp(balanceHistory);
        if (deduped.length > maxPoints) {
          return deduped.slice(deduped.length - maxPoints);
        }
        return deduped;
      }

      const fills = await this.#fetchOrderHistoryFills(account, accountRef.accountId, {
        startMs,
        endMs,
      });
      const currentSummary = await this.getAccountSummary(account).catch(() => null);
      const currentEquity = Number(currentSummary?.equity);

      const realizedCurve = buildWebullRealizedEquityCurve(fills, {
        endMs,
        endEquity: currentEquity,
      });
      if (!realizedCurve.length) {
        return [];
      }

      if (Number.isFinite(currentEquity)) {
        const last = realizedCurve[realizedCurve.length - 1];
        const nowPoint = {
          ts: new Date(endMs).toISOString(),
          epochMs: Math.round(endMs),
          equity: round2(currentEquity),
          source: "webull-live-summary",
          stale: false,
        };
        if (!last || Number(last.epochMs) !== nowPoint.epochMs) {
          realizedCurve.push(nowPoint);
        }
      }

      if (realizedCurve.length > maxPoints) {
        return realizedCurve.slice(realizedCurve.length - maxPoints);
      }
      return realizedCurve;
    } catch {
      return [];
    }
  }

  async getClosedTrades(account, request = {}) {
    try {
      const accountRef = await this.#resolveAccountReference(account, { allowPending: false });
      if (!accountRef?.accountId) {
        return [];
      }
      const { startMs, endMs } = resolveHistoryWindow(request, {
        defaultDays: 3650,
      });
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
        return [];
      }

      const rows = await this.#fetchOrderHistoryRows(account, accountRef.accountId, {
        startMs,
        endMs,
      });
      const trades = extractWebullClosedTrades(rows, {
        accountId: account.accountId,
      });
      const limit = clampNumber(request.limit, 20, 5000, 300);
      return trades.length > limit ? trades.slice(0, limit) : trades;
    } catch {
      return [];
    }
  }

  async getCashLedger(account, request = {}) {
    try {
      const accountRef = await this.#resolveAccountReference(account, { allowPending: false });
      if (!accountRef?.accountId) {
        return [];
      }
      const { startMs, endMs } = resolveHistoryWindow(request, {
        defaultDays: 3650,
      });
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
        return [];
      }

      const rows = await this.#fetchOrderHistoryRows(account, accountRef.accountId, {
        startMs,
        endMs,
      });
      const ledger = extractWebullCashLedger(rows, {
        accountId: account.accountId,
      });
      const limit = clampNumber(request.limit, 20, 5000, 500);
      return ledger.length > limit ? ledger.slice(0, limit) : ledger;
    } catch {
      return [];
    }
  }

  async #probeMarketDataAccess(account) {
    const symbol = "SPY";
    const category = resolveWebullMarketCategory(account, symbol);
    try {
      const payload = await this.#requestWebullMarketDataJson(account, {
        method: "GET",
        path: "/openapi/market-data/stock/snapshot",
        query: {
          symbols: symbol,
          category,
        },
      });
      const quote = mapWebullLiveQuotePayload(payload, symbol);
      if (quote) {
        return {
          state: "live",
          message: "Webull market data subscription is active.",
        };
      }
      return {
        state: "degraded",
        message: "Webull market data probe returned no quote payload.",
      };
    } catch (error) {
      const message = String(error?.message || "Webull market data probe failed");
      if (isWebullMarketDataPermissionError(message)) {
        return {
          state: "subscription_required",
          message: "Webull market data permission missing. Subscribe to stock quotes in Webull OpenAPI.",
        };
      }
      return {
        state: "degraded",
        message,
      };
    }
  }

  async getSpotQuote(account, symbol) {
    const normalizedSymbol = normalizeSymbol(symbol) || "SPY";
    if (this.#canAttemptStreaming(account)) {
      try {
        await this.#ensureMarketStreaming(account, {
          symbol: normalizedSymbol,
          levels: 5,
        });
        const streamingQuote = this.#readStreamingSpotQuote(account, normalizedSymbol);
        if (streamingQuote) {
          return {
            ...streamingQuote,
            symbol: normalizedSymbol,
            source: "webull-stream-spot",
            stale: false,
          };
        }
      } catch {
        // Continue to REST polling when streaming is unavailable.
      }
    }

    try {
      const live = await this.#fetchLiveStockSnapshot(account, normalizedSymbol);
      if (live) {
        return {
          ...live,
          symbol: normalizedSymbol,
          source: "webull-live-spot",
          stale: false,
        };
      }
    } catch (error) {
      return this.buildUnavailableSpotQuote(normalizedSymbol, {
        source: "webull-live-unavailable",
        error: error?.message || "Webull live quote unavailable",
      });
    }
  }

  async getBars(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol) || "SPY";
    const resolution = normalizeMarketResolution(request.resolution);
    try {
      const bars = await this.#fetchLiveStockBars(account, {
        symbol,
        resolution,
        from: request.from,
        to: request.to,
        countBack: request.countBack,
      });
      if (bars.length) {
        return {
          symbol,
          resolution,
          bars,
          source: "webull-live-bars",
          stale: false,
          dataQuality: "historical_native",
        };
      }
    } catch (error) {
      return this.buildUnavailableBars({ ...request, symbol, resolution }, {
        source: "webull-live-history-unavailable",
        error: error?.message || "Webull bars unavailable",
      });
    }
  }

  async getOptionChain(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol) || "SPY";
    const expiry = normalizeExpiry(request.expiry) || undefined;
    let underlyingPrice = null;
    try {
      const liveQuote = await this.#fetchLiveStockSnapshot(account, symbol);
      underlyingPrice = firstFiniteNumber(liveQuote?.last);
    } catch {
      // Keep chain lookup resilient when spot quote endpoint is unavailable.
    }

    try {
      const liveChain = await this.#fetchLiveOptionChain(account, {
        symbol,
        expiry,
      });
      const rows = Array.isArray(liveChain?.rows) ? liveChain.rows : [];
      const pricedRows = rows.filter(hasOptionQuoteValues);
      return {
        symbol,
        expiry: liveChain?.expiry || expiry,
        underlyingPrice: Number.isFinite(Number(liveChain?.underlyingPrice))
          ? round2(Number(liveChain.underlyingPrice))
          : Number.isFinite(Number(underlyingPrice))
            ? round2(Number(underlyingPrice))
            : null,
        rows,
        source: pricedRows.length > 0
          ? "webull-live-options"
          : "webull-live-options-contracts",
        stale: pricedRows.length === 0,
      };
    } catch (error) {
      return {
        symbol,
        expiry,
        underlyingPrice: Number.isFinite(Number(underlyingPrice))
          ? round2(Number(underlyingPrice))
          : null,
        rows: [],
        source: "webull-live-options-unavailable",
        stale: true,
        error: error?.message || null,
      };
    }
  }

  async getOptionLadder(account, request = {}) {
    const right = String(request.right || "call").toLowerCase() === "put" ? "put" : "call";
    const chain = await this.getOptionChain(account, request);
    const window = Number.isFinite(Number(request.window)) ? Number(request.window) : 7;
    const rows = [...(chain.rows || [])]
      .filter((row) => row.right === right)
      .sort((a, b) => Number(a.strike) - Number(b.strike));

    const atmIndex = nearestStrikeIndex(rows, Number(chain.underlyingPrice || 0));
    const start = Math.max(0, atmIndex - window);
    const end = Math.min(rows.length, atmIndex + window + 1);

    return {
      symbol: chain.symbol,
      expiry: chain.expiry,
      right,
      underlyingPrice: chain.underlyingPrice,
      rows: rows.slice(start, end),
      source: chain.source,
      stale: chain.stale,
    };
  }

  async getMarketDepth(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol) || "SPY";
    const levels = clampNumber(
      request.levels ?? request.depthLevels,
      1,
      50,
      MARKET_DEFAULT_DEPTH_LEVELS,
    );
    if (this.#canAttemptStreaming(account)) {
      try {
        await this.#ensureMarketStreaming(account, {
          symbol,
          levels,
        });
        const streamDepth = this.#readStreamingDepth(account, symbol, levels);
        if (streamDepth && (streamDepth.bids.length + streamDepth.asks.length) > 0) {
          return {
            ...streamDepth,
            symbol,
            levels,
            source: "webull-stream-depth",
            stale: false,
          };
        }
      } catch {
        // Continue to REST polling when streaming is unavailable.
      }
    }

    try {
      const live = await this.#fetchLiveStockDepth(account, { symbol, levels });
      if ((live.bids.length + live.asks.length) > 0) {
        return {
          ...live,
          symbol,
          levels,
          source: "webull-live-depth",
          stale: false,
        };
      }
    } catch (error) {
      return this.buildUnavailableMarketDepth({ symbol, levels }, {
        source: "webull-live-depth-unavailable",
        error: error?.message || "Webull market depth unavailable",
      });
    }
  }

  async getMarketTicks(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol) || "SPY";
    const limit = clampNumber(request.limit ?? request.tickLimit, 10, 1000, MARKET_DEFAULT_TICK_LIMIT);
    if (this.#canAttemptStreaming(account)) {
      try {
        await this.#ensureMarketStreaming(account, {
          symbol,
          levels: 5,
        });
        const streamTicks = this.#readStreamingTicks(account, symbol, limit);
        if (streamTicks && streamTicks.ticks.length > 0) {
          return {
            ...streamTicks,
            symbol,
            source: "webull-stream-ticks",
            stale: false,
          };
        }
      } catch {
        // Continue to REST polling when streaming is unavailable.
      }
    }

    try {
      const live = await this.#fetchLiveStockTicks(account, { symbol, limit });
      if (live.ticks.length > 0) {
        return {
          ...live,
          symbol,
          source: "webull-live-ticks",
          stale: false,
        };
      }
    } catch (error) {
      return this.buildUnavailableMarketTicks({ symbol, limit }, {
        source: "webull-live-ticks-unavailable",
        error: error?.message || "Webull market ticks unavailable",
      });
    }
  }

  async getMarketFootprint(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol) || "SPY";
    const resolution = normalizeMarketResolution(request.resolution);
    try {
      const live = await this.#fetchLiveStockFootprint(account, {
        symbol,
        resolution,
        from: request.from,
        to: request.to,
        countBack: request.countBack,
      });
      if (live.rows.length > 0) {
        return {
          ...live,
          symbol,
          resolution,
          source: "webull-live-footprint",
          stale: false,
        };
      }
    } catch (error) {
      return this.buildUnavailableMarketFootprint({ symbol, resolution }, {
        source: "webull-live-footprint-unavailable",
        error: error?.message || "Webull market footprint unavailable",
      });
    }
  }

  async getOrderFlow(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol) || "SPY";
    const resolution = normalizeMarketResolution(request.resolution);
    const [depth, ticks, footprint] = await Promise.all([
      this.getMarketDepth(account, {
        symbol,
        levels: request.levels ?? request.depthLevels,
      }),
      this.getMarketTicks(account, {
        symbol,
        limit: request.limit ?? request.tickLimit,
      }),
      this.getMarketFootprint(account, {
        symbol,
        resolution,
        from: request.from,
        to: request.to,
        countBack: request.countBack,
      }),
    ]);

    const bidLiquidity = (depth?.bids || []).reduce(
      (sum, row) => sum + Number(row?.price || 0) * Number(row?.size || 0),
      0,
    );
    const askLiquidity = (depth?.asks || []).reduce(
      (sum, row) => sum + Number(row?.price || 0) * Number(row?.size || 0),
      0,
    );
    const depthTotal = bidLiquidity + askLiquidity;
    const depthImbalance = depthTotal > 0 ? (bidLiquidity - askLiquidity) / depthTotal : 0;

    let buyVolume = 0;
    let sellVolume = 0;
    for (const tick of ticks?.ticks || []) {
      const size = Number(tick?.size || tick?.volume || 0);
      if (!Number.isFinite(size) || size <= 0) {
        continue;
      }
      const side = String(tick?.side || "").toLowerCase();
      if (side.startsWith("sell") || side === "s" || side === "2" || side === "ask") {
        sellVolume += size;
      } else {
        buyVolume += size;
      }
    }
    const aggressorTotal = buyVolume + sellVolume;
    const aggressorImbalance = aggressorTotal > 0 ? (buyVolume - sellVolume) / aggressorTotal : 0;

    const footprintRows = Array.isArray(footprint?.rows) ? footprint.rows : [];
    const footprintBuy = footprintRows.reduce((sum, row) => sum + Number(row?.buyVolume || 0), 0);
    const footprintSell = footprintRows.reduce((sum, row) => sum + Number(row?.sellVolume || 0), 0);
    const footprintTotal = footprintBuy + footprintSell;
    const footprintImbalance = footprintTotal > 0 ? (footprintBuy - footprintSell) / footprintTotal : 0;

    const score = clampOrderFlowScore(
      aggressorImbalance * 0.45
      + depthImbalance * 0.35
      + footprintImbalance * 0.2,
    );
    const live =
      String(depth?.source || "").startsWith("webull-live")
      || String(ticks?.source || "").startsWith("webull-live")
      || String(footprint?.source || "").startsWith("webull-live");

    return {
      symbol,
      resolution,
      score,
      classification: live ? classifyOrderFlow(score) : "unavailable",
      metrics: {
        aggressorBuyPct: ratioToPct(buyVolume, aggressorTotal),
        aggressorSellPct: ratioToPct(sellVolume, aggressorTotal),
        aggressorImbalance: round4(aggressorImbalance),
        depthBidPct: ratioToPct(bidLiquidity, depthTotal),
        depthAskPct: ratioToPct(askLiquidity, depthTotal),
        depthImbalance: round4(depthImbalance),
        footprintImbalance: round4(footprintImbalance),
        tickCount: (ticks?.ticks || []).length,
        footprintRows: footprintRows.length,
      },
      depth,
      ticks,
      footprint,
      source: live ? "webull-live-order-flow" : "webull-market-unavailable",
      stale: !live,
      timestamp: new Date().toISOString(),
    };
  }

  #canAttemptStreaming(account) {
    const accountId = String(account?.accountId || "").trim();
    if (!accountId) {
      return false;
    }
    const backoffUntil = Number(this.streamingBackoffUntil.get(accountId) || 0);
    if (backoffUntil > Date.now()) {
      return false;
    }
    const cachedSession = this.sessionCache.get(accountId);
    if (cachedSession?.status === "NORMAL" && hasCredential(cachedSession?.token)) {
      return true;
    }
    const credentials = account?.credentials || {};
    const credentialStatus = normalizeWebullTokenStatus(
      firstNonEmpty(
        credentials.WEBULL_TOKEN_STATUS,
        credentials.WEBULL_TOKEN_STATE,
      ),
    );
    const persistedToken = firstNonEmpty(
      credentials.WEBULL_ACCESS_TOKEN,
      cachedSession?.token,
    );
    if (credentialStatus === "INVALID" || credentialStatus === "EXPIRED") {
      return false;
    }
    return hasCredential(credentials.WEBULL_APP_KEY)
      && hasCredential(credentials.WEBULL_APP_SECRET)
      && hasCredential(persistedToken)
      && (credentialStatus === "NORMAL" || credentialStatus === "PENDING" || !credentialStatus);
  }

  async #ensureMarketStreaming(account, request = {}) {
    const accountId = String(account?.accountId || "").trim();
    const symbol = normalizeSymbol(request.symbol);
    if (!accountId || !symbol) {
      return null;
    }

    const backoffUntil = Number(this.streamingBackoffUntil.get(accountId) || 0);
    if (backoffUntil > Date.now()) {
      return null;
    }

    try {
      const session = await this.#ensureSession(account, {
        allowPending: false,
        allowCreateToken: false,
      });
      if (session.status !== "NORMAL" || !hasCredential(session?.context?.appKey)) {
        return null;
      }

      const streamUrl = firstNonEmpty(
        account?.credentials?.WEBULL_STREAMING_URL,
        account?.credentials?.WEBULL_STREAM_URL,
        WEBULL_STREAMING_URL,
      );
      const levels = clampNumber(request.levels, 1, 50, MARKET_DEFAULT_DEPTH_LEVELS);
      const category = resolveWebullMarketCategory(account, symbol);

      let stream = this.streamingSessions.get(accountId);
      const shouldRecreate = !stream
        || stream.appKey !== session.context.appKey
        || String(stream.url || "") !== String(streamUrl || "");
      if (shouldRecreate) {
        await this.#teardownMarketStreaming(stream);
        stream = this.#createMarketStreamingSession({
          accountId,
          appKey: session.context.appKey,
          url: String(streamUrl || WEBULL_STREAMING_URL),
        });
        this.streamingSessions.set(accountId, stream);
      }

      await this.#ensureStreamingConnected(stream);
      await this.#ensureStreamingSymbolSubscription(account, session, stream, {
        symbol,
        category,
        levels,
      });
      return stream;
    } catch (error) {
      this.streamingBackoffUntil.set(accountId, Date.now() + STREAMING_FAILURE_BACKOFF_MS);
      throw error;
    }
  }

  #createMarketStreamingSession({ accountId, appKey, url }) {
    return {
      accountId: String(accountId || ""),
      appKey: String(appKey || ""),
      url: String(url || WEBULL_STREAMING_URL),
      sessionId: createWebullStreamingSessionId(accountId),
      client: null,
      connected: false,
      connectPromise: null,
      requestedSymbols: new Map(),
      symbolCache: new Map(),
      notice: null,
      lastError: null,
      lastConnectedAt: 0,
      connectionEpoch: 0,
    };
  }

  async #teardownMarketStreaming(stream) {
    if (!stream) {
      return;
    }
    stream.requestedSymbols?.clear?.();
    stream.symbolCache?.clear?.();
    if (!stream.client) {
      return;
    }
    const client = stream.client;
    stream.client = null;
    stream.connected = false;
    stream.connectPromise = null;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      try {
        client.once("close", finish);
        client.end(true, finish);
      } catch {
        finish();
      }
      setTimeout(finish, 2000);
    });
  }

  async #ensureStreamingConnected(stream) {
    if (!stream) {
      return;
    }
    if (!stream.client) {
      const client = mqtt.connect(stream.url, {
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 2000,
        connectTimeout: STREAMING_CONNECT_TIMEOUT_MS,
        keepalive: 30,
        clientId: stream.sessionId,
        username: stream.appKey,
        password: "x",
      });
      stream.client = client;
      stream.connected = false;

      client.on("connect", () => {
        stream.connected = true;
        stream.lastConnectedAt = Date.now();
        stream.connectionEpoch = Number(stream.connectionEpoch || 0) + 1;
        this.#subscribeStreamingTopics(stream).catch(() => {});
      });
      client.on("reconnect", () => {
        stream.connected = false;
      });
      client.on("offline", () => {
        stream.connected = false;
      });
      client.on("close", () => {
        stream.connected = false;
      });
      client.on("error", (error) => {
        stream.lastError = error instanceof Error
          ? error
          : new Error(String(error || "Webull streaming error"));
      });
      client.on("message", (topic, payload) => {
        this.#handleStreamingMessage(stream, topic, payload);
      });
    }

    if (stream.connected || stream.client.connected) {
      stream.connected = true;
      return;
    }
    if (stream.connectPromise) {
      await stream.connectPromise;
      return;
    }

    const pendingPromise = new Promise((resolve, reject) => {
      const client = stream.client;
      if (!client) {
        reject(new Error("Webull streaming client unavailable"));
        return;
      }
      let settled = false;
      const finish = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        client.off("connect", onConnect);
        client.off("error", onError);
        clearTimeout(timeout);
        if (error) {
          reject(error);
        } else {
          stream.connected = true;
          resolve();
        }
      };
      const onConnect = () => finish(null);
      const onError = (error) => {
        finish(
          error instanceof Error
            ? error
            : new Error(String(error || "Webull streaming connection failed")),
        );
      };
      const timeout = setTimeout(
        () => finish(new Error("Webull streaming connect timed out")),
        STREAMING_CONNECT_TIMEOUT_MS,
      );

      client.on("connect", onConnect);
      client.on("error", onError);

      if (client.connected) {
        finish(null);
      }
    });

    stream.connectPromise = pendingPromise.finally(() => {
      stream.connectPromise = null;
    });
    await stream.connectPromise;
  }

  async #subscribeStreamingTopics(stream) {
    const topics = [
      "quote",
      "snapshot",
      "tick",
      "event-quote",
      "event-snapshot",
      "notice",
      "echo",
      "quote/#",
      "snapshot/#",
      "tick/#",
      "event-quote/#",
      "event-snapshot/#",
      "notice/#",
      "echo/#",
    ];
    await new Promise((resolve) => {
      if (!stream?.client) {
        resolve();
        return;
      }
      stream.client.subscribe(topics, { qos: 0 }, () => resolve());
    });
  }

  async #ensureStreamingSymbolSubscription(account, session, stream, request = {}) {
    const symbol = normalizeSymbol(request.symbol);
    if (!symbol) {
      return;
    }
    const levels = clampNumber(request.levels, 1, 50, MARKET_DEFAULT_DEPTH_LEVELS);
    const existing = stream.requestedSymbols.get(symbol);
    if (
      existing
      && Number(existing.epoch || 0) === Number(stream.connectionEpoch || 0)
      && Number(existing.depth || 0) >= levels
    ) {
      return;
    }

    const overnightRequired = normalizeBooleanQueryFlag(
      account?.credentials?.WEBULL_OVERNIGHT_REQUIRED,
      false,
    ) === "true";
    const grab = normalizeBooleanQueryFlag(
      account?.credentials?.WEBULL_STREAM_GRAB,
      true,
    );
    const subTypes = ["QUOTE", "SNAPSHOT", "TICK"];
    const categoryCandidates = [
      request.category,
      ...buildWebullMarketCategoryCandidates(account, symbol),
    ].filter(Boolean);
    const uniqueCategories = [...new Set(categoryCandidates.map((value) => String(value).toUpperCase()))];
    const bodies = [];
    for (const category of uniqueCategories) {
      bodies.push(
        {
          session_id: stream.sessionId,
          symbols: [symbol],
          category,
          sub_types: subTypes,
          grab,
          depth: levels,
          overnight_required: overnightRequired,
        },
        {
          session_id: stream.sessionId,
          symbol,
          category,
          sub_types: subTypes,
          grab,
          depth: levels,
          overnight_required: overnightRequired,
        },
        {
          token: stream.sessionId,
          symbols: [symbol],
          category,
          sub_types: subTypes,
        },
      );
    }

    let subscribed = false;
    let firstError = null;
    for (const body of bodies) {
      try {
        await this.#requestWebullJson(account, {
          method: "POST",
          path: "/openapi/market-data/streaming/subscribe",
          body,
          session,
        });
        subscribed = true;
        stream.requestedSymbols.set(symbol, {
          category: String(body.category || request.category || ""),
          depth: Math.max(levels, Number(existing?.depth || 0)),
          lastSubscribedAt: Date.now(),
          epoch: Number(stream.connectionEpoch || 0),
        });
        break;
      } catch (error) {
        if (!firstError) {
          firstError = error;
        }
      }
    }

    if (!subscribed && firstError) {
      throw firstError;
    }
  }

  #handleStreamingMessage(stream, topic, payload) {
    const topicType = normalizeWebullStreamingTopic(topic);
    if (!topicType) {
      return;
    }
    if (topicType === "echo") {
      return;
    }
    if (topicType === "notice") {
      try {
        stream.notice = parseJsonSafe(Buffer.from(payload || "").toString("utf8"));
      } catch {
        // Keep best-effort behavior for notice packets.
      }
      return;
    }

    const decoded = this.#decodeStreamingPayload(topicType, payload);
    if (!decoded || typeof decoded !== "object") {
      return;
    }
    const symbol = normalizeSymbol(firstNonEmpty(
      pathGet(decoded, "basic.symbol"),
      pathGet(decoded, "symbol"),
      inferWebullStreamingSymbolFromTopic(topic),
    ));
    if (!symbol) {
      return;
    }

    const now = Date.now();
    let symbolState = stream.symbolCache.get(symbol);
    if (!symbolState) {
      symbolState = {
        symbol,
        quote: null,
        depth: null,
        ticks: [],
        lastUpdateAt: 0,
      };
    }

    if (topicType === "quote" || topicType === "event-quote") {
      const bids = mapWebullStreamingBookRows(
        firstArray(decoded, ["bids", "yes_bids"]) || [],
        MARKET_DEFAULT_DEPTH_LEVELS,
      );
      const asks = mapWebullStreamingBookRows(
        firstArray(decoded, ["asks", "no_bids"]) || [],
        MARKET_DEFAULT_DEPTH_LEVELS,
      );
      if (bids.length || asks.length) {
        symbolState.depth = {
          bids,
          asks,
          timestampMs: now,
          brokerRaw: decoded,
        };
        const bestBid = firstFiniteNumber(bids[0]?.price);
        const bestAsk = firstFiniteNumber(asks[0]?.price);
        const midpoint = Number.isFinite(bestBid) && Number.isFinite(bestAsk)
          ? (bestBid + bestAsk) / 2
          : firstFiniteNumber(bestBid, bestAsk);
        if (Number.isFinite(midpoint)) {
          symbolState.quote = {
            ...(symbolState.quote || {}),
            last: round2(midpoint),
            bid: round2(firstFiniteNumber(bestBid, midpoint)),
            ask: round2(firstFiniteNumber(bestAsk, midpoint)),
            timestampMs: toEpochMs(firstNonEmpty(pathGet(decoded, "basic.timestamp"), now)),
            brokerRaw: decoded,
          };
        }
      }
    }

    if (topicType === "snapshot" || topicType === "event-snapshot") {
      const last = firstFiniteNumber(pathGet(decoded, "price"));
      const prevClose = firstFiniteNumber(
        pathGet(decoded, "pre_close"),
        pathGet(decoded, "prev_close"),
      );
      const bid = firstFiniteNumber(
        pathGet(decoded, "bid"),
        pathGet(decoded, "yes_bid"),
        symbolState.depth?.bids?.[0]?.price,
      );
      const ask = firstFiniteNumber(
        pathGet(decoded, "ask"),
        pathGet(decoded, "yes_ask"),
        symbolState.depth?.asks?.[0]?.price,
      );
      const change = firstFiniteNumber(
        pathGet(decoded, "change"),
        Number.isFinite(last) && Number.isFinite(prevClose) ? last - prevClose : null,
      );
      const changePct = firstFiniteNumber(
        pathGet(decoded, "change_ratio"),
        Number.isFinite(last) && Number.isFinite(prevClose) && prevClose !== 0
          ? ((last - prevClose) / prevClose) * 100
          : null,
      );
      const timestampMs = toEpochMs(firstNonEmpty(
        pathGet(decoded, "trade_time"),
        pathGet(decoded, "last_trade_time"),
        pathGet(decoded, "time"),
        pathGet(decoded, "basic.timestamp"),
        now,
      ));
      if (Number.isFinite(last) || Number.isFinite(bid) || Number.isFinite(ask)) {
        const safeLast = firstFiniteNumber(last, bid, ask, symbolState.quote?.last);
        if (Number.isFinite(safeLast)) {
          symbolState.quote = {
            ...(symbolState.quote || {}),
            last: round2(safeLast),
            bid: round2(firstFiniteNumber(bid, safeLast)),
            ask: round2(firstFiniteNumber(ask, safeLast)),
            prevClose: Number.isFinite(prevClose) ? round2(prevClose) : symbolState.quote?.prevClose,
            change: round2(firstFiniteNumber(change, symbolState.quote?.change, 0)),
            changePct: round2(firstFiniteNumber(changePct, symbolState.quote?.changePct, 0)),
            timestampMs: Number.isFinite(timestampMs) ? Math.round(timestampMs) : now,
            brokerRaw: decoded,
          };
        }
      }
    }

    if (topicType === "tick") {
      const price = firstFiniteNumber(pathGet(decoded, "price"));
      const size = firstFiniteNumber(pathGet(decoded, "volume"), pathGet(decoded, "size"));
      const timestampMs = toEpochMs(firstNonEmpty(
        pathGet(decoded, "time"),
        pathGet(decoded, "trade_time"),
        pathGet(decoded, "basic.timestamp"),
        now,
      ));
      if (Number.isFinite(price) && Number.isFinite(size) && size > 0) {
        const previousTickPrice = firstFiniteNumber(
          symbolState.ticks[symbolState.ticks.length - 1]?.price,
          symbolState.quote?.last,
        );
        const side = normalizeTickSide(pathGet(decoded, "side"), price, previousTickPrice);
        symbolState.ticks.push({
          time: new Date(Number.isFinite(timestampMs) ? Math.round(timestampMs) : now).toISOString(),
          price: round2(price),
          size: Math.max(1, Math.round(size)),
          volume: Math.max(1, Math.round(size)),
          side,
          brokerRaw: decoded,
        });
        if (symbolState.ticks.length > STREAMING_TICK_BUFFER_SIZE) {
          symbolState.ticks.splice(0, symbolState.ticks.length - STREAMING_TICK_BUFFER_SIZE);
        }
        symbolState.quote = {
          ...(symbolState.quote || {}),
          last: round2(price),
          bid: round2(firstFiniteNumber(symbolState.quote?.bid, symbolState.depth?.bids?.[0]?.price, price)),
          ask: round2(firstFiniteNumber(symbolState.quote?.ask, symbolState.depth?.asks?.[0]?.price, price)),
          timestampMs: Number.isFinite(timestampMs) ? Math.round(timestampMs) : now,
          brokerRaw: decoded,
        };
      }
    }

    symbolState.lastUpdateAt = now;
    stream.symbolCache.set(symbol, symbolState);
  }

  #decodeStreamingPayload(topicType, payload) {
    const bytes = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(payload || "");
    if (!bytes.length) {
      return null;
    }

    const type = topicType === "quote"
      ? this.streamingProto.quote
      : topicType === "snapshot"
        ? this.streamingProto.snapshot
        : topicType === "tick"
          ? this.streamingProto.tick
          : topicType === "event-quote"
            ? this.streamingProto.eventQuote
            : topicType === "event-snapshot"
              ? this.streamingProto.eventSnapshot
              : null;
    if (!type) {
      return null;
    }

    try {
      const decoded = type.decode(bytes);
      return type.toObject(decoded, {
        longs: String,
        enums: String,
        defaults: false,
        arrays: true,
        objects: true,
      });
    } catch {
      const textPayload = Buffer.from(bytes).toString("utf8");
      const parsed = parseJsonSafe(textPayload);
      return parsed && typeof parsed === "object" ? parsed : null;
    }
  }

  #getStreamingSymbolState(account, symbol) {
    const accountId = String(account?.accountId || "").trim();
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!accountId || !normalizedSymbol) {
      return null;
    }
    const stream = this.streamingSessions.get(accountId);
    if (!stream) {
      return null;
    }
    const state = stream.symbolCache.get(normalizedSymbol);
    if (!state) {
      return null;
    }
    if (Date.now() - Number(state.lastUpdateAt || 0) > STREAMING_TTL_MS) {
      stream.symbolCache.delete(normalizedSymbol);
      stream.requestedSymbols.delete(normalizedSymbol);
      return null;
    }
    return state;
  }

  #readStreamingSpotQuote(account, symbol) {
    const state = this.#getStreamingSymbolState(account, symbol);
    if (!state) {
      return null;
    }
    const last = firstFiniteNumber(
      state.quote?.last,
      state.ticks[state.ticks.length - 1]?.price,
    );
    if (!Number.isFinite(last)) {
      return null;
    }
    const bid = firstFiniteNumber(
      state.quote?.bid,
      state.depth?.bids?.[0]?.price,
      last,
    );
    const ask = firstFiniteNumber(
      state.quote?.ask,
      state.depth?.asks?.[0]?.price,
      last,
    );
    const prevClose = firstFiniteNumber(state.quote?.prevClose);
    const change = firstFiniteNumber(
      state.quote?.change,
      Number.isFinite(prevClose) ? last - prevClose : 0,
      0,
    );
    const changePct = firstFiniteNumber(
      state.quote?.changePct,
      Number.isFinite(prevClose) && prevClose !== 0 ? ((last - prevClose) / prevClose) * 100 : 0,
      0,
    );
    const timestampMs = firstFiniteNumber(state.quote?.timestampMs, state.lastUpdateAt, Date.now());

    return {
      symbol: normalizeSymbol(symbol),
      last: round2(last),
      bid: round2(firstFiniteNumber(bid, last)),
      ask: round2(firstFiniteNumber(ask, last)),
      change: round2(change),
      changePct: round2(changePct),
      timestamp: new Date(Math.round(timestampMs)).toISOString(),
      brokerRaw: state.quote?.brokerRaw || state.depth?.brokerRaw || null,
    };
  }

  #readStreamingDepth(account, symbol, levels = MARKET_DEFAULT_DEPTH_LEVELS) {
    const state = this.#getStreamingSymbolState(account, symbol);
    if (!state?.depth) {
      return null;
    }
    const clampedLevels = clampNumber(levels, 1, 50, MARKET_DEFAULT_DEPTH_LEVELS);
    const bids = (state.depth.bids || [])
      .slice(0, clampedLevels)
      .map((row) => ({
        price: round2(firstFiniteNumber(row?.price, 0)),
        size: Math.max(0, Math.round(firstFiniteNumber(row?.size, 0))),
      }))
      .filter((row) => row.price > 0 && row.size > 0);
    const asks = (state.depth.asks || [])
      .slice(0, clampedLevels)
      .map((row) => ({
        price: round2(firstFiniteNumber(row?.price, 0)),
        size: Math.max(0, Math.round(firstFiniteNumber(row?.size, 0))),
      }))
      .filter((row) => row.price > 0 && row.size > 0);
    if (!bids.length && !asks.length) {
      return null;
    }
    const timestampMs = firstFiniteNumber(state.depth.timestampMs, state.lastUpdateAt, Date.now());
    return {
      bids,
      asks,
      timestamp: new Date(Math.round(timestampMs)).toISOString(),
      brokerRaw: state.depth.brokerRaw || null,
    };
  }

  #readStreamingTicks(account, symbol, limit = MARKET_DEFAULT_TICK_LIMIT) {
    const state = this.#getStreamingSymbolState(account, symbol);
    if (!state) {
      return null;
    }
    const clampedLimit = clampNumber(limit, 10, 1000, MARKET_DEFAULT_TICK_LIMIT);
    const ticks = Array.isArray(state.ticks) ? state.ticks : [];
    if (!ticks.length) {
      return null;
    }
    const trimmed = ticks.length > clampedLimit
      ? ticks.slice(ticks.length - clampedLimit)
      : ticks.slice();
    return {
      ticks: trimmed,
      timestamp: new Date().toISOString(),
      brokerRaw: state.quote?.brokerRaw || state.depth?.brokerRaw || null,
    };
  }

  async #fetchLiveOptionChain(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol) || "SPY";
    const expiry = normalizeExpiry(request.expiry) || null;
    const categoryCandidates = buildWebullOptionCategoryCandidates(account, symbol);
    const queryCandidates = [];
    for (const category of categoryCandidates) {
      queryCandidates.push(
        {
          symbol,
          category,
          ...(expiry ? { expiry } : {}),
          include_quotes: "true",
          include_greeks: "true",
        },
        {
          symbols: symbol,
          category,
          ...(expiry ? { expiry } : {}),
          include_quotes: "true",
          include_greeks: "true",
        },
        {
          ticker: symbol,
          category,
          ...(expiry ? { expiration: expiry } : {}),
          include_quotes: "true",
        },
        {
          underlying: symbol,
          category,
          ...(expiry ? { expiration: expiry } : {}),
          include_quotes: "true",
        },
        {
          underlying_symbol: symbol,
          category,
          ...(expiry ? { expire_date: expiry } : {}),
        },
      );
    }
    queryCandidates.push(
      {
        symbol,
        ...(expiry ? { expiry } : {}),
      },
      {
        symbols: symbol,
        ...(expiry ? { expiry } : {}),
      },
      {
        ticker: symbol,
        ...(expiry ? { expiration: expiry } : {}),
      },
    );

    const pathCandidates = [
      "/openapi/market-data/option/chain",
      "/openapi/market-data/options/chain",
      "/openapi/market-data/option/list",
      "/openapi/market-data/options",
      "/openapi/market-data/option/quotes",
      "/openapi/options/chain",
      "/openapi/quote/option",
    ];

    for (const path of pathCandidates) {
      for (const query of queryCandidates) {
        try {
          const payload = await this.#requestWebullMarketDataJson(account, {
            method: "GET",
            path,
            query,
          });
          const chain = mapWebullLiveOptionChainPayload(payload, {
            symbol,
            expiry,
          });
          if (chain?.rows?.length) {
            return chain;
          }
        } catch (error) {
          if (isWebullAuthError(error)) {
            throw error;
          }
          // Try next endpoint/path variation.
        }
      }
    }

    throw new Error(`Webull live option chain unavailable for ${symbol}`);
  }

  async #fetchLiveStockSnapshot(account, symbol) {
    const categoryCandidates = buildWebullMarketCategoryCandidates(account, symbol);
    const extendHourRequired = normalizeBooleanQueryFlag(
      account?.credentials?.WEBULL_EXTEND_HOUR_REQUIRED,
      false,
    );
    const overnightRequired = normalizeBooleanQueryFlag(
      account?.credentials?.WEBULL_OVERNIGHT_REQUIRED,
      false,
    );
    const queryCandidates = [];
    for (const category of categoryCandidates) {
      queryCandidates.push(
        {
          symbols: symbol,
          category,
          extend_hour_required: extendHourRequired,
          overnight_required: overnightRequired,
        },
        {
          symbol,
          category,
          extend_hour_required: extendHourRequired,
          overnight_required: overnightRequired,
        },
        { symbols: symbol, category, overnight_required: overnightRequired },
        { symbol, category, overnight_required: overnightRequired },
        { symbols: symbol, category },
        { symbol, category },
      );
    }
    queryCandidates.push(
      { symbols: symbol },
      { symbol },
      { ticker: symbol },
    );
    const pathCandidates = [
      "/openapi/market-data/stock/snapshot",
      "/openapi/market-data/stock/quotes/snapshot",
      "/openapi/market-data/stock/quote/snapshot",
      "/openapi/quote/snapshot",
    ];

    for (const path of pathCandidates) {
      for (const query of queryCandidates) {
        try {
          const payload = await this.#requestWebullMarketDataJson(account, {
            method: "GET",
            path,
            query,
          });
          const quote = mapWebullLiveQuotePayload(payload, symbol);
          if (quote) {
            return quote;
          }
        } catch (error) {
          if (isWebullAuthError(error)) {
            throw error;
          }
          // Try next candidate.
        }
      }
    }

    throw new Error(`Webull live quote unavailable for ${symbol}`);
  }

  async #fetchLiveStockBars(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol) || "SPY";
    const resolution = normalizeMarketResolution(request.resolution);
    const intervalSec = resolutionToSeconds(resolution);
    const endSec = parseEpochSecondsOrNull(request.to) || Math.floor(Date.now() / 1000);
    let fromSec = parseEpochSecondsOrNull(request.from);
    const countBack = clampNumber(request.countBack, 1, MARKET_MAX_BARS, MARKET_DEFAULT_BARS);
    if (!Number.isFinite(fromSec)) {
      fromSec = endSec - intervalSec * countBack;
    }
    if (fromSec >= endSec) {
      fromSec = endSec - intervalSec * countBack;
    }

    const granularity = mapWebullGranularity(resolution);
    const timespan = mapWebullTimespan(resolution);
    const categoryCandidates = buildWebullMarketCategoryCandidates(account, symbol);
    const realTimeRequired = normalizeBooleanQueryFlag(request.real_time_required, true);
    const tradingSessions = normalizeWebullTradingSessions(
      firstNonEmpty(
        request.trading_sessions,
        request.tradingSessions,
        request.trading_session,
        request.tradingSession,
      ),
    );
    const queryCandidates = [];
    for (const category of categoryCandidates) {
      queryCandidates.push(
        {
          symbol,
          category,
          timespan,
          count: countBack,
          real_time_required: realTimeRequired,
          ...(tradingSessions ? { trading_sessions: tradingSessions } : {}),
        },
        {
          symbol,
          category,
          granularity,
          start_time: fromSec,
          end_time: endSec,
          count: countBack,
        },
        {
          symbol,
          category,
          interval: granularity,
          start_time: fromSec,
          end_time: endSec,
          count: countBack,
        },
        {
          symbol,
          category,
          bar: granularity,
          start_time: fromSec,
          end_time: endSec,
          limit: countBack,
        },
        {
          symbols: symbol,
          category,
          granularity,
          begin_time: fromSec,
          end_time: endSec,
          size: countBack,
        },
      );
    }
    queryCandidates.push({
      ticker: symbol,
      granularity,
      start_time: fromSec,
      end_time: endSec,
      limit: countBack,
    });
    const pathCandidates = [
      "/openapi/market-data/stock/bars",
      "/openapi/market-data/stock/history",
      "/openapi/market-data/stock/candles",
      "/openapi/market-data/stock/kline",
      "/openapi/quote/history",
    ];

    for (const path of pathCandidates) {
      for (const query of queryCandidates) {
        try {
          const payload = await this.#requestWebullMarketDataJson(account, {
            method: "GET",
            path,
            query,
          });
          const bars = mapWebullLiveBarsPayload(payload);
          if (bars.length) {
            let filtered = bars
              .filter((bar) => bar.time >= fromSec * 1000 && bar.time <= endSec * 1000)
              .sort((a, b) => a.time - b.time);
            if (filtered.length > countBack) {
              filtered = filtered.slice(filtered.length - countBack);
            }
            if (filtered.length) {
              return filtered;
            }
          }
        } catch (error) {
          if (isWebullAuthError(error)) {
            throw error;
          }
          // Try next candidate.
        }
      }
    }

    throw new Error(`Webull live bars unavailable for ${symbol}`);
  }

  async #fetchLiveStockDepth(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol) || "SPY";
    const levels = clampNumber(request.levels, 1, 50, MARKET_DEFAULT_DEPTH_LEVELS);
    const categoryCandidates = buildWebullMarketCategoryCandidates(account, symbol);
    const overnightRequired = normalizeBooleanQueryFlag(request.overnight_required, false);
    const queryCandidates = [];
    for (const category of categoryCandidates) {
      queryCandidates.push(
        {
          symbol,
          category,
          depth: levels,
          overnight_required: overnightRequired,
        },
        { symbol, category, depth: levels },
        { symbol, category, level: levels },
        { symbols: symbol, category, depth: levels },
        { symbols: symbol, category, level: levels },
        { ticker: symbol, category, level: levels },
        { symbol, category },
      );
    }
    queryCandidates.push({ symbol });
    const pathCandidates = [
      "/openapi/market-data/stock/quotes",
      "/openapi/market-data/stock/depth",
      "/openapi/market-data/stock/realtime",
    ];

    for (const path of pathCandidates) {
      for (const query of queryCandidates) {
        try {
          const payload = await this.#requestWebullMarketDataJson(account, {
            method: "GET",
            path,
            query,
          });
          const depth = mapWebullLiveDepthPayload(payload, levels);
          if (depth.bids.length || depth.asks.length) {
            return depth;
          }
        } catch (error) {
          if (isWebullAuthError(error)) {
            throw error;
          }
          // Try next candidate.
        }
      }
    }

    throw new Error(`Webull live depth unavailable for ${symbol}`);
  }

  async #fetchLiveStockTicks(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol) || "SPY";
    const limit = clampNumber(request.limit, 10, 1000, MARKET_DEFAULT_TICK_LIMIT);
    const categoryCandidates = buildWebullMarketCategoryCandidates(account, symbol);
    const queryCandidates = [];
    for (const category of categoryCandidates) {
      queryCandidates.push(
        { symbol, category, count: limit },
        { symbol, category, limit },
        { symbol, category, size: limit },
        { symbols: symbol, category, count: limit },
        { symbols: symbol, category, limit },
        { ticker: symbol, category, limit },
      );
    }
    queryCandidates.push({ symbol, count: limit }, { symbol, limit });
    const pathCandidates = [
      "/openapi/market-data/stock/tick",
      "/openapi/market-data/stock/realtime",
      "/openapi/market-data/stock/trades",
    ];

    for (const path of pathCandidates) {
      for (const query of queryCandidates) {
        try {
          const payload = await this.#requestWebullMarketDataJson(account, {
            method: "GET",
            path,
            query,
          });
          const ticks = mapWebullLiveTicksPayload(payload, limit);
          if (ticks.length) {
            return {
              ticks,
              timestamp: new Date().toISOString(),
            };
          }
        } catch (error) {
          if (isWebullAuthError(error)) {
            throw error;
          }
          // Try next candidate.
        }
      }
    }

    throw new Error(`Webull live ticks unavailable for ${symbol}`);
  }

  async #fetchLiveStockFootprint(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol) || "SPY";
    const resolution = normalizeMarketResolution(request.resolution);
    const intervalSec = resolutionToSeconds(resolution);
    const endSec = parseEpochSecondsOrNull(request.to) || Math.floor(Date.now() / 1000);
    const countBack = clampNumber(request.countBack, 1, MARKET_MAX_BARS, 40);
    const fromSec = parseEpochSecondsOrNull(request.from) || (endSec - intervalSec * countBack);
    const granularity = mapWebullGranularity(resolution);
    const timespan = mapWebullTimespan(resolution);
    const categoryCandidates = buildWebullMarketCategoryCandidates(account, symbol);
    const realTimeRequired = normalizeBooleanQueryFlag(request.real_time_required, true);
    const tradingSessions = normalizeWebullTradingSessions(
      firstNonEmpty(
        request.trading_sessions,
        request.tradingSessions,
        request.trading_session,
        request.tradingSession,
      ),
    );
    const queryCandidates = [];
    for (const category of categoryCandidates) {
      queryCandidates.push(
        {
          symbols: symbol,
          category,
          timespan,
          count: countBack,
          real_time_required: realTimeRequired,
          ...(tradingSessions ? { trading_sessions: tradingSessions } : {}),
        },
        {
          symbol,
          category,
          granularity,
          start_time: fromSec,
          end_time: endSec,
          count: countBack,
        },
        {
          symbol,
          category,
          interval: granularity,
          start_time: fromSec,
          end_time: endSec,
          size: countBack,
        },
        {
          symbols: symbol,
          category,
          granularity,
          begin_time: fromSec,
          end_time: endSec,
          limit: countBack,
        },
      );
    }
    queryCandidates.push({
      ticker: symbol,
      granularity,
      start_time: fromSec,
      end_time: endSec,
      limit: countBack,
    });
    const pathCandidates = [
      "/openapi/market-data/stock/footprint",
    ];

    for (const path of pathCandidates) {
      for (const query of queryCandidates) {
        try {
          const payload = await this.#requestWebullMarketDataJson(account, {
            method: "GET",
            path,
            query,
          });
          const rows = mapWebullLiveFootprintPayload(payload);
          if (rows.length) {
            return {
              resolution,
              rows,
              timestamp: new Date().toISOString(),
            };
          }
        } catch (error) {
          if (isWebullAuthError(error)) {
            throw error;
          }
          // Try next candidate.
        }
      }
    }

    const ticksPayload = await this.#fetchLiveStockTicks(account, {
      symbol,
      limit: Math.max(50, Math.min(1000, countBack * 8)),
    }).catch(() => null);
    const rows = aggregateTicksToFootprint(ticksPayload?.ticks || []);
    if (rows.length) {
      return {
        resolution,
        rows,
        timestamp: new Date().toISOString(),
      };
    }

    throw new Error(`Webull live footprint unavailable for ${symbol}`);
  }

  async #resolveAccountReference(account, options = {}) {
    const oauthFlow = this.#hasConnectOAuthClientCredentials(account?.credentials || {});
    let session = null;
    if (!oauthFlow) {
      session = await this.#ensureSession(account, {
        allowCreateToken: false,
        ...options,
      });
      if (session.status !== "NORMAL") {
        if (options.allowPending) {
          return null;
        }
        throw new Error(
          `Webull token status is ${session.status}. Complete token verification in Webull OpenAPI.`,
        );
      }
    }

    const cachedSession = this.sessionCache.get(account.accountId) || {};
    if (hasCredential(cachedSession.accountId)) {
      return {
        accountId: cachedSession.accountId,
      };
    }

    const preferredAccountId = firstNonEmpty(
      account?.credentials?.WEBULL_ACCOUNT_ID,
      account?.credentials?.WEBULL_ACCOUNT,
      account?.credentials?.WEBULL_ACCOUNT_NO,
    );

    const payload = await this.#requestWebullTradingJson(account, {
      method: "GET",
      path: "/openapi/account/list",
      session,
    });

    const rows = firstArray(payload, [
      "data.accounts",
      "data.account_list",
      "data.accountList",
      "data.list",
      "accounts",
      "account_list",
      "accountList",
      "list",
      "data",
    ]);
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      return null;
    }

    let selected = list[0];
    if (preferredAccountId) {
      const match = list.find((candidate) => {
        const accountId = firstNonEmpty(
          pathGet(candidate, "account_id"),
          pathGet(candidate, "accountId"),
          pathGet(candidate, "id"),
          pathGet(candidate, "account_no"),
          pathGet(candidate, "accountNo"),
        );
        return accountId && String(accountId) === String(preferredAccountId);
      });
      if (match) {
        selected = match;
      }
    } else {
      const ranked = [...list].sort((a, b) => rankWebullAccount(a) - rankWebullAccount(b));
      selected = ranked[0] || selected;
    }

    const resolvedAccountId = firstNonEmpty(
      pathGet(selected, "account_id"),
      pathGet(selected, "accountId"),
      pathGet(selected, "id"),
      pathGet(selected, "account_no"),
      pathGet(selected, "accountNo"),
    );
    if (!resolvedAccountId) {
      return null;
    }

    this.sessionCache.set(account.accountId, {
      ...(this.sessionCache.get(account.accountId) || {}),
      ...session,
      accountId: String(resolvedAccountId),
      checkedAt: Date.now(),
    });
    await this.#persistResolvedAccountId(account, String(resolvedAccountId));

    return {
      accountId: String(resolvedAccountId),
    };
  }

  async #ensureSession(account, options = {}) {
    const accountId = account?.accountId;
    const cached = accountId ? this.sessionCache.get(accountId) : null;
    const forceRevalidate = Boolean(options.forceRevalidate);
    const allowCreateToken = options.allowCreateToken !== false;
    const allowRefreshToken = options.allowRefreshToken !== false;
    if (cached?.token && cached?.status && Date.now() - Number(cached.checkedAt || 0) < SESSION_CACHE_TTL_MS) {
      if (cached.status === "NORMAL" || options.allowPending) {
        return cached;
      }
    }

    const context = buildWebullContext(account?.credentials || {});
    if (!context) {
      throw new Error("Missing Webull app key/secret credentials");
    }

    const persistedStatus = normalizeWebullTokenStatus(
      firstNonEmpty(
        account?.credentials?.WEBULL_TOKEN_STATUS,
        account?.credentials?.WEBULL_TOKEN_STATE,
        cached?.status,
      ),
    );
    const persistedToken = firstNonEmpty(
      account?.credentials?.WEBULL_ACCESS_TOKEN,
      cached?.token,
    );
    if (
      !forceRevalidate
      && hasCredential(persistedToken)
      && (
        persistedStatus === "NORMAL"
        || (options.allowPending && persistedStatus === "PENDING")
      )
    ) {
      const reusedSession = {
        ...(cached || {}),
        token: String(persistedToken).trim(),
        status: persistedStatus,
        expires: firstFiniteNumber(
          account?.credentials?.WEBULL_TOKEN_EXPIRES,
          cached?.expires,
        ),
        context,
        checkedAt: Date.now(),
      };
      if (accountId) {
        this.sessionCache.set(accountId, reusedSession);
      }
      return reusedSession;
    }

    const inputToken = firstNonEmpty(
      account?.credentials?.WEBULL_ACCESS_TOKEN,
      cached?.token,
    );
    let tokenState = null;

    if (hasCredential(inputToken)) {
      tokenState = await this.#checkToken(context, String(inputToken).trim()).catch(() => null);
    }

    if (!tokenState || !hasCredential(tokenState.token)) {
      if (!allowCreateToken) {
        throw new Error("Webull token unavailable. Run auth refresh to re-link OpenAPI token.");
      }
      tokenState = await this.#createToken(context);
    }

    if (tokenState.status === "PENDING") {
      tokenState = await this.#pollTokenStatus(context, tokenState, TOKEN_CHECK_TIMEOUT_MS);
    }

    if (tokenState.status === "INVALID" || tokenState.status === "EXPIRED") {
      if (hasCredential(inputToken) && allowRefreshToken) {
        tokenState = await this.#refreshToken(context, String(inputToken).trim()).catch(() => tokenState);
      }
      if (tokenState.status === "PENDING") {
        tokenState = await this.#pollTokenStatus(context, tokenState, TOKEN_CHECK_TIMEOUT_MS);
      }
    }

    if (tokenState.status === "INVALID" || tokenState.status === "EXPIRED") {
      if (!allowCreateToken) {
        throw new Error(`Webull token status is ${tokenState.status}. Run auth refresh to renegotiate token.`);
      }
      tokenState = await this.#createToken(context);
      if (tokenState.status === "PENDING") {
        tokenState = await this.#pollTokenStatus(context, tokenState, TOKEN_CHECK_TIMEOUT_MS);
      }
    }

    if (!hasCredential(tokenState.token)) {
      throw new Error("Webull token creation failed: missing token in response");
    }
    const allowPending = Boolean(options.allowPending);
    if (tokenState.status !== "NORMAL") {
      if (!(allowPending && tokenState.status === "PENDING")) {
        throw new Error(`Webull token status is ${tokenState.status}`);
      }
    }

    const nextSession = {
      ...tokenState,
      context,
      checkedAt: Date.now(),
    };
    await this.#persistSessionCredentials(account, nextSession);
    if (accountId) {
      this.sessionCache.set(accountId, {
        ...(this.sessionCache.get(accountId) || {}),
        ...nextSession,
      });
    }
    return nextSession;
  }

  async #createToken(context) {
    const payload = await this.#requestWebullJsonRaw({
      context,
      method: "POST",
      path: "/openapi/auth/token/create",
      includeAccessToken: false,
    });
    return parseWebullTokenPayload(payload, null);
  }

  async #checkToken(context, token) {
    const payload = await this.#requestWebullJsonRaw({
      context,
      method: "POST",
      path: "/openapi/auth/token/check",
      body: {
        token,
      },
      includeAccessToken: false,
    });
    return parseWebullTokenPayload(payload, token);
  }

  async #refreshToken(context, token) {
    if (!hasCredential(token)) {
      throw new Error("Webull token refresh requires an existing token");
    }
    const payload = await this.#requestWebullJsonRaw({
      context,
      method: "POST",
      path: "/openapi/auth/token/refresh",
      body: {
        token,
      },
      includeAccessToken: false,
    });
    return parseWebullTokenPayload(payload, token);
  }

  async #pollTokenStatus(context, seedToken, timeoutMs) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs || TOKEN_CHECK_TIMEOUT_MS));
    let current = { ...seedToken };
    while (Date.now() < deadline) {
      await sleep(TOKEN_CHECK_POLL_INTERVAL_MS);
      current = await this.#checkToken(context, current.token);
      if (current.status !== "PENDING") {
        break;
      }
    }
    return current;
  }

  #hasConnectOAuthClientCredentials(credentials = {}) {
    try {
      resolveWebullConnectCredentials(credentials);
      return true;
    } catch {
      return false;
    }
  }

  async #ensureConnectOAuthSession(account, options = {}) {
    const accountId = String(account?.accountId || "").trim();
    const cached = accountId ? this.sessionCache.get(accountId) : null;
    const credentials = account?.credentials || {};
    const context = resolveWebullConnectCredentials(credentials);
    const forceRefresh = Boolean(options.forceRefresh);
    const accessToken = firstNonEmpty(
      credentials.WEBULL_OAUTH_ACCESS_TOKEN,
      cached?.oauthAccessToken,
    );
    const refreshToken = firstNonEmpty(
      credentials.WEBULL_OAUTH_REFRESH_TOKEN,
      cached?.oauthRefreshToken,
    );
    const accessExpiresAt = firstNonEmpty(
      credentials.WEBULL_OAUTH_ACCESS_EXPIRES_AT,
      cached?.oauthAccessExpiresAt,
    );
    const refreshExpiresAt = firstNonEmpty(
      credentials.WEBULL_OAUTH_REFRESH_EXPIRES_AT,
      cached?.oauthRefreshExpiresAt,
    );

    if (!forceRefresh && hasCredential(accessToken) && !isLikelyExpiredAt(accessExpiresAt, 60_000)) {
      const session = {
        accessToken: String(accessToken).trim(),
        refreshToken: hasCredential(refreshToken) ? String(refreshToken).trim() : null,
        accessExpiresAt: accessExpiresAt || null,
        refreshExpiresAt: refreshExpiresAt || null,
        context,
        checkedAt: Date.now(),
      };
      if (accountId) {
        this.sessionCache.set(accountId, {
          ...(cached || {}),
          oauthAccessToken: session.accessToken,
          oauthRefreshToken: session.refreshToken,
          oauthAccessExpiresAt: session.accessExpiresAt,
          oauthRefreshExpiresAt: session.refreshExpiresAt,
          oauthContext: context,
          oauthCheckedAt: session.checkedAt,
        });
      }
      return session;
    }

    if (!hasCredential(refreshToken) || isLikelyExpiredAt(refreshExpiresAt, 0)) {
      throw new Error("Webull Connect OAuth login required for brokerage access");
    }

    const refreshed = await refreshWebullConnectToken({
      clientId: context.clientId,
      clientSecret: context.clientSecret,
      refreshToken: String(refreshToken).trim(),
      apiBaseUrl: context.apiBaseUrl,
    });
    const nextSession = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || String(refreshToken).trim(),
      accessExpiresAt: refreshed.accessExpiresAt || null,
      refreshExpiresAt: refreshed.refreshExpiresAt || refreshExpiresAt || null,
      context,
      checkedAt: Date.now(),
    };
    await this.#persistConnectOAuthCredentials(account, nextSession);
    if (accountId) {
      this.sessionCache.set(accountId, {
        ...(cached || {}),
        oauthAccessToken: nextSession.accessToken,
        oauthRefreshToken: nextSession.refreshToken,
        oauthAccessExpiresAt: nextSession.accessExpiresAt,
        oauthRefreshExpiresAt: nextSession.refreshExpiresAt,
        oauthContext: context,
        oauthCheckedAt: nextSession.checkedAt,
      });
    }
    return nextSession;
  }

  async #requestWebullTradingJson(account, options = {}) {
    if (!this.#hasConnectOAuthClientCredentials(account?.credentials || {})) {
      return this.#requestWebullJson(account, options);
    }

    let session = options.session;
    if (!session?.accessToken) {
      session = await this.#ensureConnectOAuthSession(account, options.sessionOptions || {});
    }
    try {
      return await this.#requestWebullConnectJsonRaw({
        context: session.context,
        accessToken: session.accessToken,
        method: options.method,
        path: normalizeWebullConnectTradingPath(options.path),
        query: options.query,
        body: options.body,
      });
    } catch (error) {
      if (Number(error?.status) === 401 && options.allowRefresh !== false) {
        const refreshed = await this.#ensureConnectOAuthSession(account, {
          forceRefresh: true,
        });
        return this.#requestWebullConnectJsonRaw({
          context: refreshed.context,
          accessToken: refreshed.accessToken,
          method: options.method,
          path: normalizeWebullConnectTradingPath(options.path),
          query: options.query,
          body: options.body,
        });
      }
      throw error;
    }
  }

  async #requestWebullMarketDataJson(account, options = {}) {
    const context = buildWebullContext(account?.credentials || {});
    if (!context) {
      throw new Error("Missing Webull app key/secret credentials");
    }

    return this.#requestWebullJsonRaw({
      context,
      method: options.method,
      path: options.path,
      query: options.query,
      body: options.body,
      accessToken: null,
      includeAccessToken: false,
    });
  }

  async #requestWebullJson(account, options = {}) {
    const session = options.session || await this.#ensureSession(account, {
      allowPending: false,
      allowCreateToken: false,
      ...(options.sessionOptions || {}),
    });
    if (session.status !== "NORMAL") {
      throw new Error(`Webull token status is ${session.status}`);
    }

    return this.#requestWebullJsonRaw({
      context: session.context,
      method: options.method,
      path: options.path,
      query: options.query,
      body: options.body,
      accessToken: session.token,
      includeAccessToken: true,
    });
  }

  async #requestWebullConnectJsonRaw({
    context,
    accessToken,
    method = "GET",
    path,
    query,
    body,
  }) {
    const safeMethod = String(method || "GET").toUpperCase();
    const normalizedPath = String(path || "").trim();
    if (!normalizedPath.startsWith("/")) {
      throw new Error(`Invalid Webull Connect path: ${normalizedPath}`);
    }

    const url = new URL(`${context.apiBaseUrl}${normalizedPath}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value == null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: safeMethod,
        headers: {
          Accept: "application/json, text/plain, */*",
          Authorization: `Bearer ${String(accessToken || "").trim()}`,
          ...(body == null ? {} : { "Content-Type": "application/json" }),
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = parseJsonSafe(text);
      if (!response.ok) {
        const error = new Error(
          extractWebullErrorMessage(payload, text)
            || `Webull Connect request failed (${response.status})`,
        );
        error.status = response.status;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async #requestWebullJsonRaw({
    context,
    method = "GET",
    path,
    query,
    body,
    accessToken,
    includeAccessToken,
  }) {
    const safeMethod = String(method || "GET").toUpperCase();
    const normalizedPath = String(path || "").trim();
    if (!normalizedPath.startsWith("/")) {
      throw new Error(`Invalid Webull path: ${normalizedPath}`);
    }

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
      if (value == null || value === "") {
        continue;
      }
      search.set(key, String(value));
    }
    const queryText = search.toString();
    const requestUrl = `${context.baseUrl}${normalizedPath}${queryText ? `?${queryText}` : ""}`;

    const headers = buildWebullRequestHeaders({
      appKey: context.appKey,
      appSecret: context.appSecret,
      host: context.host,
      method: safeMethod,
      path: normalizedPath,
      query: Object.fromEntries(search.entries()),
      body: body && typeof body === "object" ? body : undefined,
      accessToken: includeAccessToken ? accessToken : null,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(requestUrl, {
        method: safeMethod,
        headers,
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = parseJsonSafe(text);
      if (!response.ok) {
        const message = extractWebullErrorMessage(payload, text)
          || `Webull request failed (${response.status})`;
        throw new Error(message);
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async #persistConnectOAuthCredentials(account, session) {
    const accountId = String(account?.accountId || "").trim();
    if (!accountId || !hasCredential(session?.accessToken)) {
      return;
    }

    const current = this.store.getAccount(accountId);
    const currentCredentials = current?.credentials || account?.credentials || {};
    const nextCredentials = {
      WEBULL_OAUTH_ACCESS_TOKEN: String(session.accessToken || ""),
      WEBULL_OAUTH_REFRESH_TOKEN: hasCredential(session.refreshToken) ? String(session.refreshToken) : "",
      WEBULL_OAUTH_ACCESS_EXPIRES_AT: session.accessExpiresAt || "",
      WEBULL_OAUTH_REFRESH_EXPIRES_AT: session.refreshExpiresAt || "",
    };
    const changed = Object.entries(nextCredentials).some(
      ([key, value]) => String(currentCredentials[key] || "") !== String(value || ""),
    );
    if (!changed) {
      return;
    }

    await this.store.upsertAccount({
      accountId,
      broker: current?.broker || account?.broker || "webull",
      credentials: nextCredentials,
    });
  }

  async #persistSessionCredentials(account, session) {
    const accountId = account?.accountId;
    if (!accountId || !hasCredential(session?.token)) {
      return;
    }

    const current = this.store.getAccount(accountId);
    const currentCredentials = current?.credentials || account?.credentials || {};
    const nextCredentials = {
      WEBULL_ACCESS_TOKEN: String(session.token),
      WEBULL_TOKEN_STATUS: String(session.status || ""),
      WEBULL_TOKEN_EXPIRES: session.expires == null ? "" : String(session.expires),
    };
    const changed = Object.entries(nextCredentials).some(
      ([key, value]) => String(currentCredentials[key] || "") !== String(value || ""),
    );
    if (!changed) {
      return;
    }

    await this.store.upsertAccount({
      accountId,
      broker: current?.broker || account?.broker || "webull",
      credentials: nextCredentials,
    });
  }

  async #clearPersistedConnectOAuthCredentials(account) {
    const accountId = String(account?.accountId || "").trim();
    if (!accountId) {
      return;
    }

    const cached = this.sessionCache.get(accountId) || {};
    this.sessionCache.set(accountId, {
      ...cached,
      oauthAccessToken: "",
      oauthRefreshToken: "",
      oauthAccessExpiresAt: "",
      oauthRefreshExpiresAt: "",
      oauthCheckedAt: Date.now(),
    });

    const current = this.store.getAccount(accountId);
    const currentCredentials = current?.credentials || account?.credentials || {};
    const nextCredentials = {
      WEBULL_OAUTH_ACCESS_TOKEN: "",
      WEBULL_OAUTH_REFRESH_TOKEN: "",
      WEBULL_OAUTH_ACCESS_EXPIRES_AT: "",
      WEBULL_OAUTH_REFRESH_EXPIRES_AT: "",
      WEBULL_ACCOUNT_ID: "",
    };
    const changed = Object.entries(nextCredentials).some(
      ([key, value]) => String(currentCredentials[key] || "") !== String(value || ""),
    );
    if (!changed) {
      return;
    }

    await this.store.upsertAccount({
      accountId,
      broker: current?.broker || account?.broker || "webull",
      credentials: nextCredentials,
    });
  }

  async #clearPersistedSessionCredentials(account) {
    const accountId = account?.accountId;
    if (!accountId) {
      return;
    }

    const streaming = this.streamingSessions.get(accountId);
    await this.#teardownMarketStreaming(streaming).catch(() => {});
    this.streamingSessions.delete(accountId);
    this.streamingBackoffUntil.delete(accountId);
    this.sessionCache.delete(accountId);

    const current = this.store.getAccount(accountId);
    const currentCredentials = current?.credentials || account?.credentials || {};
    const nextCredentials = {
      WEBULL_ACCESS_TOKEN: "",
      WEBULL_TOKEN_STATUS: "",
      WEBULL_TOKEN_EXPIRES: "",
      WEBULL_ACCOUNT_ID: "",
    };
    const changed = Object.entries(nextCredentials).some(
      ([key, value]) => String(currentCredentials[key] || "") !== String(value || ""),
    );
    if (!changed) {
      return;
    }

    await this.store.upsertAccount({
      accountId,
      broker: current?.broker || account?.broker || "webull",
      credentials: nextCredentials,
    });
  }

  async #persistResolvedAccountId(account, resolvedAccountId) {
    const accountId = account?.accountId;
    if (!accountId || !hasCredential(resolvedAccountId)) {
      return;
    }

    const current = this.store.getAccount(accountId);
    const currentCredentials = current?.credentials || account?.credentials || {};
    if (String(currentCredentials.WEBULL_ACCOUNT_ID || "") === String(resolvedAccountId)) {
      return;
    }

    await this.store.upsertAccount({
      accountId,
      broker: current?.broker || account?.broker || "webull",
      credentials: {
        WEBULL_ACCOUNT_ID: String(resolvedAccountId),
      },
    });
  }

  async #fetchOrderHistoryRows(account, accountId, options = {}) {
    const startMs = Number(options.startMs);
    const endMs = Number(options.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      return [];
    }

    const startDate = toIsoDate(startMs);
    const endDate = toIsoDate(endMs);
    const queryBuilders = [
      {
        mode: "cursor",
        build: ({ cursor }) => ({
          account_id: accountId,
          start_date: startDate,
          end_date: endDate,
          page_size: HISTORY_PAGE_SIZE,
          ...(cursor ? { last_client_order_id: cursor } : {}),
        }),
      },
      {
        mode: "page",
        build: ({ page }) => ({
          account_id: accountId,
          start_time: Math.floor(startMs / 1000),
          end_time: Math.floor(endMs / 1000),
          page_index: page,
          page_size: HISTORY_PAGE_SIZE,
        }),
      },
      {
        mode: "page",
        build: ({ page }) => ({
          account_id: accountId,
          start_time: Math.floor(startMs / 1000),
          end_time: Math.floor(endMs / 1000),
          page: page,
          size: HISTORY_PAGE_SIZE,
        }),
      },
      {
        mode: "page",
        build: ({ page }) => ({
          account_id: accountId,
          start_time: Math.round(startMs),
          end_time: Math.round(endMs),
          page_index: page,
          page_size: HISTORY_PAGE_SIZE,
        }),
      },
    ];

    for (const candidate of queryBuilders) {
      const rows = [];
      let queryWorked = false;
      let cursor = null;

      for (let page = 1; page <= HISTORY_MAX_PAGES; page += 1) {
        let payload;
        try {
          payload = await this.#requestWebullTradingJson(account, {
            method: "GET",
            path: "/openapi/trade/order/history",
            query: candidate.build({ page, cursor }),
          });
        } catch {
          if (page === 1) {
            break;
          }
          queryWorked = true;
          break;
        }

        const pageRows = extractWebullOrderRows(payload);
        if (!pageRows.length) {
          queryWorked = true;
          break;
        }

        queryWorked = true;
        rows.push(...pageRows);

        if (candidate.mode === "cursor") {
          const nextCursor = extractWebullOrderCursor(pageRows);
          if (!nextCursor || nextCursor === cursor) {
            break;
          }
          cursor = nextCursor;
          if (pageRows.length < HISTORY_PAGE_SIZE) {
            break;
          }
          continue;
        }

        if (pageRows.length < HISTORY_PAGE_SIZE) {
          break;
        }
      }

      if (!queryWorked || !rows.length) {
        continue;
      }
      return dedupeWebullOrderRows(rows);
    }

    return [];
  }

  async #fetchOrderHistoryFills(account, accountId, options = {}) {
    const rows = await this.#fetchOrderHistoryRows(account, accountId, options);
    if (!rows.length) {
      return [];
    }
    return extractWebullFillEvents(rows);
  }

  async #fetchBalanceHistoryPoints(account, accountId, options = {}) {
    const startMs = Number(options.startMs);
    const endMs = Number(options.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      return [];
    }

    const pathCandidates = [
      "/openapi/assets/balance/history",
      "/openapi/assets/history",
      "/openapi/account/balance/history",
    ];
    const queryCandidates = [
      {
        account_id: accountId,
        start_time: Math.floor(startMs / 1000),
        end_time: Math.floor(endMs / 1000),
      },
      {
        account_id: accountId,
        start_time: Math.round(startMs),
        end_time: Math.round(endMs),
      },
      {
        account_id: accountId,
        begin_time: Math.floor(startMs / 1000),
        end_time: Math.floor(endMs / 1000),
      },
    ];

    for (const path of pathCandidates) {
      for (const query of queryCandidates) {
        let payload;
        try {
          payload = await this.#requestWebullTradingJson(account, {
            method: "GET",
            path,
            query,
          });
        } catch {
          continue;
        }

        const rows = extractWebullBalanceHistoryRows(payload);
        if (rows.length) {
          return rows;
        }
      }
    }

    return [];
  }
}

function hasCredential(value) {
  return value != null && String(value).trim() !== "";
}

function buildWebullContext(credentials = {}) {
  const appKey = hasCredential(credentials.WEBULL_APP_KEY)
    ? String(credentials.WEBULL_APP_KEY).trim()
    : null;
  const appSecret = hasCredential(credentials.WEBULL_APP_SECRET)
    ? String(credentials.WEBULL_APP_SECRET).trim()
    : null;
  if (!appKey || !appSecret) {
    return null;
  }

  const region = String(
    firstNonEmpty(
      credentials.WEBULL_REGION,
      credentials.WEBULL_REGION_ID,
      DEFAULT_REGION,
    ),
  ).trim().toLowerCase();
  const explicitBase = firstNonEmpty(
    credentials.WEBULL_API_BASE_URL,
    credentials.WEBULL_API_ENDPOINT,
  );
  const host = explicitBase
    ? new URL(String(explicitBase)).host
    : REGION_HOSTS[region] || REGION_HOSTS[DEFAULT_REGION];
  const baseUrl = explicitBase
    ? String(explicitBase).replace(/\/+$/, "")
    : `https://${host}`;

  return {
    appKey,
    appSecret,
    region,
    host,
    baseUrl,
  };
}

function buildWebullRequestHeaders({
  appKey,
  appSecret,
  host,
  method,
  path,
  query = {},
  body,
  accessToken,
}) {
  const timestamp = toIso8601Seconds(new Date());
  const nonce = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  const signatureAlgorithm = "HMAC-SHA1";
  const signatureVersion = "1.0";

  const signParams = {
    "x-app-key": appKey,
    "x-signature-algorithm": signatureAlgorithm,
    "x-signature-version": signatureVersion,
    "x-signature-nonce": nonce,
    "x-timestamp": timestamp,
    host,
  };

  for (const [key, value] of Object.entries(query || {})) {
    if (value == null) {
      continue;
    }
    const lowerKey = String(key).toLowerCase();
    const nextValue = String(value);
    if (signParams[lowerKey] != null) {
      signParams[lowerKey] = `${signParams[lowerKey]}&${nextValue}`;
    } else {
      signParams[lowerKey] = nextValue;
    }
  }

  const sortedEntries = Object.entries(signParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  let signString = `${path}&${sortedEntries.join("&")}`;
  if (body != null) {
    const compactBody = JSON.stringify(body);
    const bodyMd5 = crypto
      .createHash("md5")
      .update(compactBody, "utf8")
      .digest("hex")
      .toUpperCase();
    signString = `${signString}&${bodyMd5}`;
  }
  const encodedSignString = encodeStrict(signString);
  const signature = crypto
    .createHmac("sha1", `${appSecret}&`)
    .update(encodedSignString, "utf8")
    .digest("base64");

  const headers = {
    Accept: "application/json",
    "x-version": "v2",
    "x-app-key": appKey,
    "x-signature": signature,
    "x-signature-algorithm": signatureAlgorithm,
    "x-signature-version": signatureVersion,
    "x-signature-nonce": nonce,
    "x-timestamp": timestamp,
  };
  if (body != null) {
    headers["Content-Type"] = "application/json";
  }
  if (hasCredential(accessToken)) {
    headers["x-access-token"] = String(accessToken).trim();
  }
  return headers;
}

function parseWebullTokenPayload(payload, fallbackToken) {
  const data = payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
    ? payload.data
    : payload;
  const token = firstNonEmpty(
    pathGet(data, "token"),
    pathGet(data, "access_token"),
    pathGet(payload, "token"),
    pathGet(payload, "access_token"),
    fallbackToken,
  );
  const expires = firstFiniteNumber(
    pathGet(data, "expires"),
    pathGet(data, "expire_at"),
    pathGet(data, "expireAt"),
    pathGet(payload, "expires"),
    pathGet(payload, "expire_at"),
    pathGet(payload, "expireAt"),
  );

  const rawStatus = firstNonEmpty(
    pathGet(data, "status"),
    pathGet(data, "token_status"),
    pathGet(payload, "status"),
    pathGet(payload, "token_status"),
  );
  const status = normalizeWebullTokenStatus(rawStatus);

  return {
    token: token ? String(token).trim() : null,
    status,
    expires: Number.isFinite(expires) ? Number(expires) : null,
  };
}

function extractWebullOrderRows(payload) {
  const direct = firstArray(payload, [
    "data.orders",
    "data.order_list",
    "data.orderList",
    "data.list",
    "orders",
    "order_list",
    "orderList",
    "list",
    "data",
  ]);
  if (Array.isArray(direct)) {
    return direct;
  }

  const nested = firstArray(payload, [
    "data.items",
    "items",
  ]);
  if (Array.isArray(nested)) {
    return nested;
  }
  return [];
}

function extractWebullOrderCursor(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const row = list[index];
    const cursor = firstNonEmpty(
      pathGet(row, "client_order_id"),
      pathGet(row, "clientOrderId"),
      pathGet(row, "order_id"),
      pathGet(row, "orderId"),
      pathGet(row, "id"),
    );
    if (cursor) {
      return String(cursor);
    }
  }
  return null;
}

function dedupeWebullOrderRows(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const key = firstNonEmpty(
      pathGet(row, "client_order_id"),
      pathGet(row, "clientOrderId"),
      pathGet(row, "order_id"),
      pathGet(row, "orderId"),
      pathGet(row, "id"),
      `${pathGet(row, "symbol") || ""}:${pathGet(row, "filled_time_at") || pathGet(row, "updated_time") || pathGet(row, "created_time") || ""}`,
    );
    map.set(String(key), row);
  }
  return [...map.values()];
}

function extractWebullBalanceHistoryRows(payload) {
  const rows = firstArray(payload, [
    "data.balances",
    "data.balance_list",
    "data.balanceList",
    "data.history",
    "data.history_list",
    "data.list",
    "balances",
    "history",
    "history_list",
    "list",
    "data",
  ]);
  const list = Array.isArray(rows) ? rows : [];
  const points = [];
  for (const row of list) {
    const epochMs = toEpochMs(
      firstNonEmpty(
        pathGet(row, "ts"),
        pathGet(row, "timestamp"),
        pathGet(row, "time"),
        pathGet(row, "date_time"),
        pathGet(row, "datetime"),
        pathGet(row, "created_at"),
      ),
    );
    const equity = firstFiniteNumber(
      pathGet(row, "equity"),
      pathGet(row, "net_liquidation"),
      pathGet(row, "netLiquidation"),
      pathGet(row, "total_asset"),
      pathGet(row, "total_assets"),
      pathGet(row, "totalAsset"),
      pathGet(row, "balance"),
      pathGet(row, "account_value"),
      pathGet(row, "accountValue"),
    );
    if (!Number.isFinite(epochMs) || !Number.isFinite(equity)) {
      continue;
    }
    points.push({
      ts: new Date(epochMs).toISOString(),
      epochMs: Math.round(epochMs),
      equity: round2(equity),
      source: "webull-balance-history",
      stale: false,
    });
  }

  return dedupeHistoryByTimestamp(points);
}

function extractWebullFillEvents(rows) {
  const events = [];
  const stack = Array.isArray(rows) ? [...rows] : [];

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") {
      continue;
    }

    const timestamp = toEpochMs(
      firstNonEmpty(
        pathGet(node, "filled_time_at"),
        pathGet(node, "filled_time"),
        pathGet(node, "filledAt"),
        pathGet(node, "filled_at"),
        pathGet(node, "execution_time"),
        pathGet(node, "executed_time"),
        pathGet(node, "updated_time"),
        pathGet(node, "updatedAt"),
      ),
    );
    const realized = firstFiniteNumber(
      pathGet(node, "realized_pnl"),
      pathGet(node, "realizedPnL"),
      pathGet(node, "realized_profit_loss"),
      pathGet(node, "realizedProfitLoss"),
      pathGet(node, "profit_loss"),
      pathGet(node, "profitLoss"),
      pathGet(node, "closed_pnl"),
      pathGet(node, "closedPnL"),
      pathGet(node, "pnl"),
    );
    const sideRaw = String(firstNonEmpty(
      pathGet(node, "side"),
      pathGet(node, "order_side"),
      pathGet(node, "orderSide"),
      pathGet(node, "action"),
      "",
    )).trim().toLowerCase();
    const quantity = Math.abs(firstFiniteNumber(
      pathGet(node, "filled_quantity"),
      pathGet(node, "filled_qty"),
      pathGet(node, "total_quantity"),
      pathGet(node, "quantity"),
      pathGet(node, "qty"),
      0,
    ) || 0);
    const price = firstFiniteNumber(
      pathGet(node, "filled_price"),
      pathGet(node, "fill_price"),
      pathGet(node, "avg_price"),
      pathGet(node, "average_price"),
      pathGet(node, "price"),
      pathGet(node, "limit_price"),
    );
    const multiplier = inferWebullAssetType(node) === "option" ? 100 : 1;
    const signedNotional = Number.isFinite(price) && Number.isFinite(quantity) && quantity > 0
      ? (sideRaw.startsWith("sell") ? 1 : sideRaw.startsWith("buy") ? -1 : 0) * quantity * Number(price) * multiplier
      : NaN;

    if (Number.isFinite(timestamp) && Number.isFinite(realized)) {
      events.push({
        epochMs: Math.round(timestamp),
        deltaEquity: Number(realized),
        kind: "realized",
      });
    } else if (Number.isFinite(timestamp) && Number.isFinite(signedNotional) && signedNotional !== 0) {
      events.push({
        epochMs: Math.round(timestamp),
        deltaEquity: Number(signedNotional),
        kind: "cashflow",
      });
    }

    const childKeys = [
      "orders",
      "order_list",
      "orderList",
      "children",
      "items",
      "legs",
      "executions",
      "fills",
      "details",
      "sub_orders",
      "subOrders",
    ];
    for (const key of childKeys) {
      const value = pathGet(node, key);
      if (Array.isArray(value)) {
        stack.push(...value);
      }
    }
  }

  return events.sort((a, b) => Number(a.epochMs) - Number(b.epochMs));
}

function extractWebullClosedTrades(rows, options = {}) {
  const accountId = String(options.accountId || "").trim();
  const events = extractWebullHistoryEvents(rows);
  const trades = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.kind !== "realized") {
      continue;
    }
    trades.push({
      tradeId: `${accountId || "webull"}:${event.orderId || event.epochMs}:${index}`,
      accountId: accountId || null,
      symbol: event.symbol || "UNKNOWN",
      side: normalizeTradeSide(event.sideRaw),
      qty: Number.isFinite(event.quantity) && event.quantity > 0 ? round4(event.quantity) : null,
      openedAt: null,
      closedAt: new Date(Number(event.epochMs)).toISOString(),
      realizedNet: round2(event.amount),
      fees: Number.isFinite(event.fees) ? round2(event.fees) : 0,
      confidence: "exact",
      source: "webull-order-history",
    });
  }

  trades.sort((a, b) => Date.parse(b.closedAt || 0) - Date.parse(a.closedAt || 0));
  return trades;
}

function extractWebullCashLedger(rows, options = {}) {
  const accountId = String(options.accountId || "").trim();
  const events = extractWebullHistoryEvents(rows);
  const ledger = events
    .filter((event) => Number.isFinite(event.amount) && Math.abs(Number(event.amount)) >= 0.005)
    .map((event, index) => ({
      id: `${accountId || "webull"}:${event.orderId || event.epochMs}:${event.kind}:${index}`,
      accountId: accountId || null,
      ts: new Date(Number(event.epochMs)).toISOString(),
      epochMs: Math.round(Number(event.epochMs)),
      amount: round2(event.amount),
      realizedNet: event.kind === "realized" ? round2(event.amount) : null,
      equityDelta: event.kind === "realized" ? round2(event.amount) : null,
      unrealizedDelta: null,
      balance: null,
      type: Number(event.amount) >= 0 ? "credit" : "debit",
      confidence: event.kind === "realized" ? "exact" : "derived",
      source: event.kind === "realized" ? "webull-order-history" : "webull-order-history-notional",
    }));

  ledger.sort((a, b) => Number(b.epochMs) - Number(a.epochMs));
  return ledger;
}

function extractWebullHistoryEvents(rows) {
  const events = [];
  const stack = Array.isArray(rows) ? [...rows] : [];

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") {
      continue;
    }

    const timestamp = toEpochMs(
      firstNonEmpty(
        pathGet(node, "filled_time_at"),
        pathGet(node, "filled_time"),
        pathGet(node, "filledAt"),
        pathGet(node, "filled_at"),
        pathGet(node, "execution_time"),
        pathGet(node, "executed_time"),
        pathGet(node, "updated_time"),
        pathGet(node, "updatedAt"),
      ),
    );
    if (!Number.isFinite(timestamp)) {
      continue;
    }

    const symbol = normalizeSymbol(firstNonEmpty(
      pathGet(node, "symbol"),
      pathGet(node, "ticker"),
      pathGet(node, "stock_symbol"),
      pathGet(node, "security.symbol"),
      pathGet(node, "instrument.symbol"),
      pathGet(node, "underlying_symbol"),
      pathGet(node, "underlyingSymbol"),
    )) || "UNKNOWN";
    const sideRaw = String(firstNonEmpty(
      pathGet(node, "side"),
      pathGet(node, "order_side"),
      pathGet(node, "orderSide"),
      pathGet(node, "action"),
      "",
    )).trim().toLowerCase();
    const quantity = Math.abs(firstFiniteNumber(
      pathGet(node, "filled_quantity"),
      pathGet(node, "filled_qty"),
      pathGet(node, "total_quantity"),
      pathGet(node, "quantity"),
      pathGet(node, "qty"),
      0,
    ) || 0);
    const price = firstFiniteNumber(
      pathGet(node, "filled_price"),
      pathGet(node, "fill_price"),
      pathGet(node, "avg_price"),
      pathGet(node, "average_price"),
      pathGet(node, "price"),
      pathGet(node, "limit_price"),
    );
    const realized = firstFiniteNumber(
      pathGet(node, "realized_pnl"),
      pathGet(node, "realizedPnL"),
      pathGet(node, "realized_profit_loss"),
      pathGet(node, "realizedProfitLoss"),
      pathGet(node, "profit_loss"),
      pathGet(node, "profitLoss"),
      pathGet(node, "closed_pnl"),
      pathGet(node, "closedPnL"),
      pathGet(node, "pnl"),
    );
    const fees = firstFiniteNumber(
      pathGet(node, "fees"),
      pathGet(node, "fee"),
      pathGet(node, "commission"),
      pathGet(node, "commission_fee"),
      pathGet(node, "commissionFee"),
      0,
    );
    const multiplier = inferWebullAssetType(node) === "option" ? 100 : 1;
    const signedNotional = Number.isFinite(price) && Number.isFinite(quantity) && quantity > 0
      ? (sideRaw.startsWith("sell") ? 1 : sideRaw.startsWith("buy") ? -1 : 0) * quantity * Number(price) * multiplier
      : NaN;
    const orderId = firstNonEmpty(
      pathGet(node, "order_id"),
      pathGet(node, "orderId"),
      pathGet(node, "id"),
      pathGet(node, "entrust_no"),
      pathGet(node, "entrustNo"),
      pathGet(node, "client_order_id"),
      pathGet(node, "clientOrderId"),
    );

    if (Number.isFinite(realized)) {
      events.push({
        kind: "realized",
        epochMs: Math.round(timestamp),
        amount: Number(realized),
        quantity,
        price,
        symbol,
        sideRaw,
        fees: Number.isFinite(fees) ? Number(fees) : 0,
        orderId: orderId ? String(orderId) : null,
      });
    } else if (Number.isFinite(signedNotional) && signedNotional !== 0) {
      events.push({
        kind: "cashflow",
        epochMs: Math.round(timestamp),
        amount: Number(signedNotional),
        quantity,
        price,
        symbol,
        sideRaw,
        fees: Number.isFinite(fees) ? Number(fees) : 0,
        orderId: orderId ? String(orderId) : null,
      });
    }

    const childKeys = [
      "orders",
      "order_list",
      "orderList",
      "children",
      "items",
      "legs",
      "executions",
      "fills",
      "details",
      "sub_orders",
      "subOrders",
    ];
    for (const key of childKeys) {
      const value = pathGet(node, key);
      if (Array.isArray(value)) {
        stack.push(...value);
      }
    }
  }

  events.sort((a, b) => Number(a.epochMs) - Number(b.epochMs));
  return events;
}

function normalizeTradeSide(sideRaw) {
  const text = String(sideRaw || "").trim().toLowerCase();
  if (text.startsWith("sell") || text.startsWith("short")) {
    return "sell";
  }
  if (text.startsWith("buy") || text.startsWith("long")) {
    return "buy";
  }
  return "unknown";
}

function buildWebullRealizedEquityCurve(fillEvents, options = {}) {
  const rows = Array.isArray(fillEvents) ? fillEvents : [];
  if (!rows.length) {
    return [];
  }
  const realizedRows = rows.filter((row) => row?.kind === "realized");
  const cashflowRows = rows.filter((row) => row?.kind === "cashflow");
  const selectedRows = realizedRows.length ? realizedRows : cashflowRows;
  if (!selectedRows.length) {
    return [];
  }

  let cumulativeRealized = 0;
  for (const row of selectedRows) {
    cumulativeRealized += Number(row.deltaEquity || 0);
  }

  const endEquity = Number(options.endEquity);
  if (!Number.isFinite(endEquity)) {
    return [];
  }

  const startEquity = endEquity - cumulativeRealized;
  const points = [];
  let running = startEquity;
  const source = realizedRows.length ? "webull-realized-history" : "webull-cashflow-history";

  for (const row of selectedRows) {
    running += Number(row.deltaEquity || 0);
    points.push({
      ts: new Date(Number(row.epochMs)).toISOString(),
      epochMs: Math.round(Number(row.epochMs)),
      equity: round2(running),
      source,
      stale: false,
    });
  }

  return points;
}

function dedupeHistoryByTimestamp(points) {
  const map = new Map();
  for (const row of Array.isArray(points) ? points : []) {
    const epochMs = Number(row?.epochMs);
    const equity = Number(row?.equity);
    if (!Number.isFinite(epochMs) || !Number.isFinite(equity)) {
      continue;
    }
    map.set(Math.round(epochMs), {
      ...row,
      epochMs: Math.round(epochMs),
      ts: new Date(Math.round(epochMs)).toISOString(),
      equity: round2(equity),
    });
  }
  return [...map.values()].sort((a, b) => Number(a.epochMs) - Number(b.epochMs));
}

function normalizeWebullTokenStatus(value) {
  if (value == null || value === "") {
    return "UNKNOWN";
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return WEBULL_TOKEN_STATUS_MAP[numeric] || "UNKNOWN";
  }
  const text = String(value).trim().toUpperCase();
  if (!text) {
    return "UNKNOWN";
  }
  if (text === "PENDING" || text === "NORMAL" || text === "INVALID" || text === "EXPIRED") {
    return text;
  }
  return "UNKNOWN";
}

function mapWebullPosition(row, index) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const symbol = normalizeSymbol(firstNonEmpty(
    pathGet(row, "symbol"),
    pathGet(row, "ticker"),
    pathGet(row, "stock_symbol"),
    pathGet(row, "security.symbol"),
    pathGet(row, "instrument.symbol"),
    pathGet(row, "underlying_symbol"),
    pathGet(row, "underlyingSymbol"),
  ));
  if (!symbol) {
    return null;
  }

  const quantitySigned = firstFiniteNumber(
    pathGet(row, "quantity"),
    pathGet(row, "qty"),
    pathGet(row, "position"),
    pathGet(row, "position_qty"),
    pathGet(row, "positionQty"),
    pathGet(row, "holding_qty"),
    pathGet(row, "holdingQty"),
    pathGet(row, "available_qty"),
    pathGet(row, "availableQty"),
  );
  const qty = Math.abs(Number(quantitySigned || 0));
  if (!Number.isFinite(qty) || qty <= 0) {
    return null;
  }

  const sideHint = String(firstNonEmpty(
    pathGet(row, "side"),
    pathGet(row, "position_side"),
    pathGet(row, "positionSide"),
    "",
  )).trim().toLowerCase();
  const side = sideHint === "short" || sideHint === "sell"
    ? "short"
    : sideHint === "long" || sideHint === "buy"
      ? "long"
      : Number(quantitySigned || 0) < 0
        ? "short"
        : "long";

  const assetType = inferWebullAssetType(row);
  const option = assetType === "option"
    ? mapWebullOptionPayload(row, symbol)
    : null;
  const multiplier = assetType === "option" ? 100 : 1;

  const averagePrice = firstFiniteNumber(
    pathGet(row, "average_price"),
    pathGet(row, "avg_price"),
    pathGet(row, "avgPrice"),
    pathGet(row, "cost_price"),
    pathGet(row, "avg_cost"),
    pathGet(row, "cost"),
    pathGet(row, "cost_price_per_share"),
    0,
  );
  const markPrice = firstFiniteNumber(
    pathGet(row, "mark_price"),
    pathGet(row, "market_price"),
    pathGet(row, "last_price"),
    pathGet(row, "current_price"),
    pathGet(row, "price"),
    averagePrice,
    0,
  );
  const marketValue = firstFiniteNumber(
    pathGet(row, "market_value"),
    pathGet(row, "marketValue"),
    pathGet(row, "position_value"),
    pathGet(row, "positionValue"),
    Number(markPrice || 0) * qty * multiplier,
    0,
  );
  const pnlFallback = (Number(markPrice || 0) - Number(averagePrice || 0)) * qty * multiplier;
  const unrealizedPnl = firstFiniteNumber(
    pathGet(row, "unrealized_pnl"),
    pathGet(row, "unrealizedPnL"),
    pathGet(row, "unrealized_profit_loss"),
    pathGet(row, "profit_loss"),
    pathGet(row, "pnl"),
    side === "short" ? -pnlFallback : pnlFallback,
    0,
  );

  const positionId = firstNonEmpty(
    pathGet(row, "position_id"),
    pathGet(row, "positionId"),
    pathGet(row, "id"),
    pathGet(row, "instrument_id"),
    pathGet(row, "instrumentId"),
  ) || `${symbol}-${assetType}-${index}`;

  return {
    positionId: String(positionId),
    symbol,
    assetType,
    side,
    qty: round6(qty),
    averagePrice: round2(averagePrice),
    markPrice: round2(markPrice),
    marketValue: round2(marketValue),
    unrealizedPnl: round2(unrealizedPnl),
    option,
    brokerRaw: row,
  };
}

function mapWebullOptionPayload(row, fallbackSymbol) {
  const expiry = normalizeExpiry(firstNonEmpty(
    pathGet(row, "option_expire_date"),
    pathGet(row, "expire_date"),
    pathGet(row, "expiration"),
    pathGet(row, "expiry"),
  ));
  const strike = firstFiniteNumber(
    pathGet(row, "strike_price"),
    pathGet(row, "strike"),
    pathGet(row, "option_strike_price"),
    pathGet(row, "option_exercise_price"),
  );
  const rightRaw = String(firstNonEmpty(
    pathGet(row, "option_type"),
    pathGet(row, "right"),
    pathGet(row, "call_put"),
    "",
  )).trim().toLowerCase();
  const right = rightRaw.startsWith("p") ? "put" : "call";

  return {
    symbol: fallbackSymbol,
    expiry,
    strike: Number.isFinite(strike) ? round4(strike) : null,
    right,
  };
}

function mapWebullBalanceSummary({ payload, accountId, positionsCount }) {
  const data = payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
    ? payload.data
    : payload;
  if (!data || typeof data !== "object") {
    return null;
  }

  const buyingPower = firstFiniteNumber(
    pathGet(data, "buying_power"),
    pathGet(data, "buyingPower"),
    pathGet(data, "cash_buying_power"),
    pathGet(data, "available_funds"),
    pathGet(data, "availableFunds"),
    pathGet(data, "account_currency_assets.0.buying_power"),
    pathGet(data, "account_currency_assets.0.buyingPower"),
  );
  const cash = firstFiniteNumber(
    pathGet(data, "cash_balance"),
    pathGet(data, "cash"),
    pathGet(data, "settled_cash"),
    pathGet(data, "available_cash"),
    pathGet(data, "availableCash"),
  );
  const settledCash = firstFiniteNumber(
    pathGet(data, "settled_cash"),
    pathGet(data, "settledCash"),
    pathGet(data, "cash_balance"),
  );
  const unsettledCash = firstFiniteNumber(
    pathGet(data, "unsettled_cash"),
    pathGet(data, "unsettledCash"),
    Number.isFinite(cash) && Number.isFinite(settledCash)
      ? Number(cash) - Number(settledCash)
      : null,
  );
  const cashAvailableToTrade = firstFiniteNumber(
    pathGet(data, "cash_buying_power"),
    pathGet(data, "available_cash"),
    pathGet(data, "availableCash"),
    buyingPower,
    cash,
  );
  const cashAvailableToWithdraw = firstFiniteNumber(
    pathGet(data, "withdrawable_cash"),
    pathGet(data, "withdrawableCash"),
    settledCash,
    cash,
  );
  const marginAvailable = firstFiniteNumber(
    pathGet(data, "margin_available"),
    pathGet(data, "marginAvailable"),
    Number.isFinite(buyingPower) && Number.isFinite(cashAvailableToTrade)
      ? Math.max(0, Number(buyingPower) - Number(cashAvailableToTrade))
      : null,
  );
  const marketValue = firstFiniteNumber(
    pathGet(data, "total_market_value"),
    pathGet(data, "totalMarketValue"),
    pathGet(data, "market_value"),
    pathGet(data, "marketValue"),
    pathGet(data, "position_market_value"),
    pathGet(data, "positionMarketValue"),
    pathGet(data, "securities_value"),
    pathGet(data, "securitiesValue"),
    pathGet(data, "account_currency_assets.0.market_value"),
    pathGet(data, "account_currency_assets.0.marketValue"),
  );
  const netLiquidation = firstFiniteNumber(
    pathGet(data, "net_liquidation"),
    pathGet(data, "netLiquidation"),
    pathGet(data, "total_asset"),
    pathGet(data, "total_assets"),
    pathGet(data, "totalAsset"),
    Number(cash || 0) + Number(marketValue || 0),
  );
  const unrealizedPnl = firstFiniteNumber(
    pathGet(data, "total_unrealized_profit_loss"),
    pathGet(data, "totalUnrealizedProfitLoss"),
    pathGet(data, "unrealized_pnl"),
    pathGet(data, "unrealizedPnL"),
    pathGet(data, "total_unrealized_pnl"),
    pathGet(data, "totalUnrealizedPnl"),
    pathGet(data, "position_unrealized_pnl"),
    pathGet(data, "positionUnrealizedPnl"),
    0,
  );

  if (
    !Number.isFinite(buyingPower)
    && !Number.isFinite(cash)
    && !Number.isFinite(netLiquidation)
    && !Number.isFinite(marketValue)
  ) {
    return null;
  }

  return {
    accountId,
    buyingPower: round2(firstFiniteNumber(buyingPower, cash, 0)),
    cash: round2(firstFiniteNumber(cash, buyingPower, 0)),
    settledCash: Number.isFinite(settledCash) ? round2(settledCash) : null,
    unsettledCash: Number.isFinite(unsettledCash) ? round2(Math.max(0, unsettledCash)) : null,
    cashAvailableToTrade: Number.isFinite(cashAvailableToTrade) ? round2(cashAvailableToTrade) : null,
    cashAvailableToWithdraw: Number.isFinite(cashAvailableToWithdraw) ? round2(cashAvailableToWithdraw) : null,
    marginAvailable: Number.isFinite(marginAvailable) ? round2(marginAvailable) : null,
    marketValue: round2(firstFiniteNumber(marketValue, 0)),
    unrealizedPnl: round2(firstFiniteNumber(unrealizedPnl, 0)),
    equity: round2(firstFiniteNumber(netLiquidation, cash, 0)),
    positions: Number.isFinite(Number(positionsCount)) ? Number(positionsCount) : 0,
    source: "webull-live",
    stale: false,
    lastSync: new Date().toISOString(),
  };
}

function mapCachedWebullSummary({ point, accountId, positionsCount }) {
  if (!point || typeof point !== "object") {
    return null;
  }
  const equity = Number(point.equity);
  if (!Number.isFinite(equity)) {
    return null;
  }
  const buyingPower = Number(point.buyingPower);
  const cash = Number(point.cash);
  const settledCash = Number(point.settledCash);
  const unsettledCash = Number(point.unsettledCash);
  const cashAvailableToTrade = Number(point.cashAvailableToTrade);
  const cashAvailableToWithdraw = Number(point.cashAvailableToWithdraw);
  const marginAvailable = Number(point.marginAvailable);
  const marketValue = Number(point.marketValue);
  const unrealizedPnl = Number(point.unrealizedPnl);

  return {
    accountId,
    buyingPower: round2(Number.isFinite(buyingPower) ? buyingPower : 0),
    cash: round2(Number.isFinite(cash) ? cash : (Number.isFinite(buyingPower) ? buyingPower : 0)),
    settledCash: Number.isFinite(settledCash) ? round2(settledCash) : null,
    unsettledCash: Number.isFinite(unsettledCash) ? round2(Math.max(0, unsettledCash)) : null,
    cashAvailableToTrade: round2(
      Number.isFinite(cashAvailableToTrade)
        ? cashAvailableToTrade
        : (Number.isFinite(cash) ? cash : buyingPower),
    ),
    cashAvailableToWithdraw: round2(
      Number.isFinite(cashAvailableToWithdraw)
        ? cashAvailableToWithdraw
        : (Number.isFinite(settledCash) ? settledCash : cash),
    ),
    marginAvailable: Number.isFinite(marginAvailable) ? round2(marginAvailable) : null,
    marketValue: round2(Number.isFinite(marketValue) ? marketValue : 0),
    unrealizedPnl: round2(Number.isFinite(unrealizedPnl) ? unrealizedPnl : 0),
    equity: round2(equity),
    positions: Number.isFinite(Number(positionsCount)) ? Number(positionsCount) : 0,
    source: "webull-cached",
    stale: true,
    lastSync: new Date().toISOString(),
  };
}

function inferWebullAssetType(row) {
  const type = String(firstNonEmpty(
    pathGet(row, "asset_type"),
    pathGet(row, "assetType"),
    pathGet(row, "instrument_type"),
    pathGet(row, "instrumentType"),
    pathGet(row, "security_type"),
    pathGet(row, "securityType"),
    "",
  )).trim().toLowerCase();
  if (type.includes("option")) {
    return "option";
  }
  return "equity";
}

function firstArray(source, paths = []) {
  if (Array.isArray(source)) {
    return source;
  }
  for (const path of paths) {
    const value = pathGet(source, path);
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function pathGet(source, path) {
  if (!source || typeof source !== "object" || !path) {
    return undefined;
  }
  const tokens = String(path).split(".");
  let cursor = source;
  for (const token of tokens) {
    if (cursor == null || typeof cursor !== "object" || !(token in cursor)) {
      return undefined;
    }
    cursor = cursor[token];
  }
  return cursor;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) {
      continue;
    }
    const text = String(value).trim();
    if (!text) {
      continue;
    }
    return text;
  }
  return null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function toEpochMs(value) {
  if (value == null || value === "") {
    return NaN;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function resolveHistoryWindow(request = {}, options = {}) {
  const endMs = toEpochMs(request.to) || Date.now();
  const defaultDays = clampNumber(options.defaultDays, 1, 3650, 3650);
  const days = clampNumber(request.days, 1, 3650, defaultDays);
  const startMs = toEpochMs(request.from) || (endMs - days * 24 * 60 * 60 * 1000);
  return {
    startMs,
    endMs,
  };
}

function normalizeSymbol(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim().toUpperCase();
}

function normalizeExpiry(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function extractWebullErrorMessage(payload, fallbackText) {
  const message = firstNonEmpty(
    pathGet(payload, "message"),
    pathGet(payload, "msg"),
    pathGet(payload, "error"),
    pathGet(payload, "error_message"),
    pathGet(payload, "errorMessage"),
  );
  if (message) {
    const code = firstNonEmpty(
      pathGet(payload, "error_code"),
      pathGet(payload, "errorCode"),
      pathGet(payload, "code"),
    );
    if (code) {
      return `${message} (code: ${code})`;
    }
    return message;
  }

  const text = String(fallbackText || "").trim();
  return text || null;
}

function isWebullAuthError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes("token status")
    || message.includes("auth refresh")
    || message.includes("many_too_token")
    || message.includes("too many token")
    || message.includes("too many tokens")
    || message.includes("token unavailable")
    || message.includes("token creation failed")
  );
}

function normalizeWebullAuthErrorMessage(message) {
  const text = String(message || "").trim();
  if (!text) {
    return "Webull auth refresh required. Re-link OpenAPI token and retry.";
  }
  const lower = text.toLowerCase();
  if (lower.includes("many_too_token") || lower.includes("too many token")) {
    return "Webull rejected token creation (too many active tokens). Revoke old tokens in Webull OpenAPI, then refresh auth.";
  }
  return text;
}

function isWebullMarketDataPermissionError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("insufficient permission")
    || text.includes("subscribe to stock quotes")
    || text.includes("please subscribe to stock quotes");
}

function isWebullConnectAuthError(error) {
  const status = Number(error?.status);
  const message = String(error?.message || "").toLowerCase();
  return status === 401
    || message.includes("invalid_grant")
    || message.includes("invalid_token")
    || message.includes("oauth login required")
    || message.includes("authorization code")
    || message.includes("refresh token")
    || message.includes("unauthorized");
}

function normalizeWebullConnectAuthErrorMessage(message) {
  const text = String(message || "").trim();
  if (!text) {
    return "Webull Connect OAuth login required for brokerage access.";
  }
  const lower = text.toLowerCase();
  if (
    lower.includes("invalid_grant")
    || lower.includes("invalid_token")
    || lower.includes("refresh token")
    || lower.includes("unauthorized")
  ) {
    return "Webull Connect OAuth session expired or was rejected. Start OAuth again to relink brokerage access.";
  }
  return text;
}

function normalizeWebullConnectTradingPath(path) {
  const normalized = String(path || "").trim();
  if (!normalized.startsWith("/")) {
    return normalized;
  }
  if (normalized.startsWith("/oauth-openapi/")) {
    return normalized;
  }
  if (normalized.startsWith("/openapi/")) {
    return normalized.replace(/^\/openapi\//, "/oauth-openapi/");
  }
  return normalized;
}

function isLikelyExpiredAt(value, skewMs = 0) {
  if (!hasCredential(value)) {
    return false;
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return parsed <= (Date.now() + Math.max(0, Number(skewMs || 0)));
}

function toIso8601Seconds(value) {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function encodeStrict(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function round2(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 100) / 100;
}

function round4(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 10000) / 10000;
}

function round6(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 1000000) / 1000000;
}

function normalizeMarketResolution(value) {
  const raw = String(value || "5").trim().toUpperCase();
  if (raw === "D" || raw === "1D") {
    return "1D";
  }
  if (raw === "W" || raw === "1W") {
    return "1W";
  }
  const minutes = Number(raw);
  if (Number.isFinite(minutes) && minutes > 0) {
    return String(Math.round(minutes));
  }
  return "5";
}

function resolutionToSeconds(value) {
  const normalized = normalizeMarketResolution(value);
  if (normalized === "1D") {
    return 86400;
  }
  if (normalized === "1W") {
    return 7 * 86400;
  }
  const minutes = Number(normalized);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 300;
  }
  return Math.max(1, Math.round(minutes)) * 60;
}

function mapWebullGranularity(value) {
  const normalized = normalizeMarketResolution(value);
  if (normalized === "1D") {
    return "d1";
  }
  if (normalized === "1W") {
    return "w1";
  }
  const minutes = Number(normalized);
  if (!Number.isFinite(minutes) || minutes <= 1) {
    return "m1";
  }
  if (minutes <= 3) {
    return "m3";
  }
  if (minutes <= 5) {
    return "m5";
  }
  if (minutes <= 15) {
    return "m15";
  }
  if (minutes <= 30) {
    return "m30";
  }
  if (minutes <= 60) {
    return "m60";
  }
  if (minutes <= 120) {
    return "m120";
  }
  if (minutes <= 240) {
    return "m240";
  }
  return "d1";
}

function mapWebullTimespan(value) {
  const normalized = normalizeMarketResolution(value);
  if (normalized === "1D") {
    return "D";
  }
  if (normalized === "1W") {
    return "W";
  }
  const minutes = Number(normalized);
  if (!Number.isFinite(minutes) || minutes <= 1) {
    return "M1";
  }
  if (minutes <= 3) {
    return "M1";
  }
  if (minutes <= 5) {
    return "M5";
  }
  if (minutes <= 15) {
    return "M15";
  }
  if (minutes <= 30) {
    return "M30";
  }
  if (minutes <= 60) {
    return "M60";
  }
  if (minutes <= 120) {
    return "M120";
  }
  if (minutes <= 240) {
    return "M240";
  }
  return "D";
}

function normalizeBooleanQueryFlag(value, fallback = false) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const text = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) {
    return "true";
  }
  if (["0", "false", "no", "n", "off"].includes(text)) {
    return "false";
  }
  return fallback ? "true" : "false";
}

function normalizeWebullTradingSessions(value) {
  if (value == null || value === "") {
    return null;
  }
  const rawItems = Array.isArray(value)
    ? value
    : String(value).split(",");
  const normalized = rawItems
    .map((item) => String(item || "").trim().toUpperCase())
    .filter(Boolean)
    .map((item) => (item === "REGULAR" ? "RTH" : item))
    .filter((item) => ["PRE", "RTH", "ATH", "OVN"].includes(item));
  if (!normalized.length) {
    return null;
  }
  return [...new Set(normalized)].join(",");
}

function toIsoDate(value) {
  const epoch = Number(value);
  if (!Number.isFinite(epoch)) {
    return null;
  }
  return new Date(Math.round(epoch)).toISOString().slice(0, 10);
}

function parseEpochSecondsOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric > 100000000000) {
    return Math.floor(numeric / 1000);
  }
  return Math.floor(numeric);
}

function mapWebullLiveQuotePayload(payload, fallbackSymbol) {
  const rows = firstArray(payload, [
    "data.quotes",
    "data.quote_list",
    "data.quoteList",
    "data.snapshots",
    "data.snapshot_list",
    "data.snapshotList",
    "data.list",
    "quotes",
    "quote_list",
    "quoteList",
    "snapshots",
    "snapshot_list",
    "snapshotList",
    "list",
    "data",
  ]);

  const objectRows = Array.isArray(rows)
    ? rows
    : [firstObject(payload, [
      "data.quote",
      "data.snapshot",
      "data.result",
      "quote",
      "snapshot",
      "result",
    ]) || payload];
  const quote = objectRows.find((row) => row && typeof row === "object" && !Array.isArray(row));
  if (!quote || typeof quote !== "object" || Array.isArray(quote)) {
    return null;
  }

  const symbol = normalizeSymbol(firstNonEmpty(
    pathGet(quote, "symbol"),
    pathGet(quote, "ticker"),
    pathGet(quote, "stock"),
    pathGet(quote, "sec_code"),
    fallbackSymbol,
  ));
  if (!symbol) {
    return null;
  }

  const last = firstFiniteNumber(
    pathGet(quote, "last_price"),
    pathGet(quote, "lastPrice"),
    pathGet(quote, "price"),
    pathGet(quote, "close"),
    pathGet(quote, "latest_price"),
    pathGet(quote, "latestPrice"),
    pathGet(quote, "trade_price"),
  );
  const bid = firstFiniteNumber(
    pathGet(quote, "bid_price"),
    pathGet(quote, "bidPrice"),
    pathGet(quote, "bid"),
    pathGet(quote, "bp1"),
  );
  const ask = firstFiniteNumber(
    pathGet(quote, "ask_price"),
    pathGet(quote, "askPrice"),
    pathGet(quote, "ask"),
    pathGet(quote, "ap1"),
  );
  const prevClose = firstFiniteNumber(
    pathGet(quote, "prev_close"),
    pathGet(quote, "prevClose"),
    pathGet(quote, "previous_close"),
    pathGet(quote, "pre_close"),
    pathGet(quote, "yesterday_close"),
  );
  if (!Number.isFinite(last)) {
    return null;
  }

  const change = firstFiniteNumber(
    pathGet(quote, "change"),
    pathGet(quote, "price_change"),
    pathGet(quote, "priceChange"),
    Number.isFinite(prevClose) ? Number(last) - Number(prevClose) : null,
  );
  const changePct = firstFiniteNumber(
    pathGet(quote, "change_ratio"),
    pathGet(quote, "changePercent"),
    pathGet(quote, "change_percent"),
    Number.isFinite(prevClose) && Number(prevClose) !== 0
      ? ((Number(last) - Number(prevClose)) / Number(prevClose)) * 100
      : null,
  );
  const timestamp = toEpochMs(
    firstNonEmpty(
      pathGet(quote, "timestamp"),
      pathGet(quote, "ts"),
      pathGet(quote, "time"),
      pathGet(quote, "trade_time"),
      pathGet(quote, "tradeTime"),
      Date.now(),
    ),
  );

  return {
    symbol,
    last: round2(last),
    bid: round2(firstFiniteNumber(bid, last)),
    ask: round2(firstFiniteNumber(ask, last)),
    change: round2(firstFiniteNumber(change, 0)),
    changePct: round2(firstFiniteNumber(changePct, 0)),
    timestamp: Number.isFinite(timestamp)
      ? new Date(Math.round(timestamp)).toISOString()
      : new Date().toISOString(),
    brokerRaw: quote,
  };
}

function mapWebullLiveOptionChainPayload(payload, fallback = {}) {
  const requestedSymbol = normalizeSymbol(fallback.symbol);
  const requestedExpiry = normalizeExpiry(fallback.expiry);
  const rowMap = new Map();
  const visited = new Set();
  const underlyingPrice = firstFiniteNumber(
    pathGet(payload, "data.underlying_price"),
    pathGet(payload, "data.underlyingPrice"),
    pathGet(payload, "data.underlying.last_price"),
    pathGet(payload, "data.underlying.lastPrice"),
    pathGet(payload, "underlying_price"),
    pathGet(payload, "underlyingPrice"),
    pathGet(payload, "underlying.last_price"),
    pathGet(payload, "underlying.lastPrice"),
  );

  const pushRow = (node, context = {}) => {
    const mapped = mapWebullOptionChainRow(node, context);
    if (!mapped) {
      return;
    }
    if (requestedSymbol && mapped.symbol !== requestedSymbol) {
      return;
    }
    const key = mapped.contractId
      || `${mapped.symbol}-${mapped.expiry}-${mapped.strike}-${mapped.right}`;
    const existing = rowMap.get(key);
    rowMap.set(key, existing ? mergeWebullOptionRows(existing, mapped) : mapped);
  };

  const visitNode = (node, context = {}, depth = 0) => {
    if (node == null || depth > 6) {
      return;
    }
    if (typeof node !== "object") {
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visited.add(node);

    if (Array.isArray(node)) {
      for (const row of node) {
        visitNode(row, context, depth + 1);
      }
      return;
    }

    const symbol = normalizeSymbol(firstNonEmpty(
      context.symbol,
      pathGet(node, "symbol"),
      pathGet(node, "underlying"),
      pathGet(node, "underlying_symbol"),
      pathGet(node, "underlyingSymbol"),
      pathGet(node, "ticker"),
      requestedSymbol,
    ));
    const expiry = normalizeExpiry(firstNonEmpty(
      context.expiry,
      pathGet(node, "expiry"),
      pathGet(node, "expiration"),
      pathGet(node, "expiration_date"),
      pathGet(node, "expire_date"),
      pathGet(node, "expDate"),
      pathGet(node, "maturityDate"),
      pathGet(node, "lastTradeDateOrContractMonth"),
      pathGet(node, "option_expire_date"),
      requestedExpiry,
    ));
    const strike = firstFiniteNumber(
      context.strike,
      pathGet(node, "strike"),
      pathGet(node, "strike_price"),
      pathGet(node, "option_strike_price"),
      pathGet(node, "exercise_price"),
      pathGet(node, "exercisePrice"),
    );
    const right = normalizeOptionRightToken(firstNonEmpty(
      context.right,
      pathGet(node, "right"),
      pathGet(node, "option_type"),
      pathGet(node, "call_put"),
      pathGet(node, "put_call"),
      pathGet(node, "cp"),
      pathGet(node, "side"),
      pathGet(node, "direction"),
      pathGet(node, "optionType"),
    ));

    const nextContext = {
      symbol: symbol || context.symbol || requestedSymbol,
      expiry: expiry || context.expiry || requestedExpiry,
      strike: Number.isFinite(strike) ? strike : context.strike,
      right: right || context.right || null,
    };

    const callNode = firstObject(node, [
      "call",
      "call_option",
      "callOption",
      "call_quote",
      "callQuote",
      "c",
    ]);
    if (callNode) {
      const callContext = { ...nextContext, right: "call" };
      pushRow(callNode, callContext);
      visitNode(callNode, callContext, depth + 1);
    }
    const putNode = firstObject(node, [
      "put",
      "put_option",
      "putOption",
      "put_quote",
      "putQuote",
      "p",
    ]);
    if (putNode) {
      const putContext = { ...nextContext, right: "put" };
      pushRow(putNode, putContext);
      visitNode(putNode, putContext, depth + 1);
    }
    pushRow(node, nextContext);

    const childKeys = [
      "data",
      "rows",
      "list",
      "items",
      "chain",
      "option_chain",
      "optionChain",
      "options",
      "option_list",
      "optionList",
      "contracts",
      "calls",
      "puts",
      "call_list",
      "put_list",
      "callList",
      "putList",
      "strikes",
      "strike_list",
      "strikeList",
      "expirations",
      "expiration_list",
      "expirationList",
    ];
    for (const key of childKeys) {
      const child = pathGet(node, key);
      if (child == null) {
        continue;
      }
      const childContext = { ...nextContext };
      const lowered = String(key).toLowerCase();
      if (lowered.includes("call")) {
        childContext.right = "call";
      } else if (lowered.includes("put")) {
        childContext.right = "put";
      }
      visitNode(child, childContext, depth + 1);
    }
  };

  visitNode(payload, {
    symbol: requestedSymbol,
    expiry: requestedExpiry,
  }, 0);

  let rows = [...rowMap.values()];
  if (requestedExpiry) {
    const exact = rows.filter((row) => row.expiry === requestedExpiry);
    if (exact.length > 0) {
      rows = exact;
    }
  }

  const dominantExpiry = requestedExpiry || selectDominantOptionExpiry(rows);
  if (!requestedExpiry && dominantExpiry) {
    const filtered = rows.filter((row) => row.expiry === dominantExpiry);
    if (filtered.length > 0) {
      rows = filtered;
    }
  }
  rows = rows.sort(compareOptionContractRows);
  if (!rows.length) {
    return null;
  }

  return {
    symbol: requestedSymbol || rows[0].symbol,
    expiry: dominantExpiry || rows[0].expiry || requestedExpiry || null,
    underlyingPrice: Number.isFinite(underlyingPrice)
      ? round2(underlyingPrice)
      : null,
    rows,
  };
}

function mapWebullOptionChainRow(node, context = {}) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return null;
  }

  const symbol = normalizeSymbol(firstNonEmpty(
    context.symbol,
    pathGet(node, "symbol"),
    pathGet(node, "underlying"),
    pathGet(node, "underlying_symbol"),
    pathGet(node, "underlyingSymbol"),
    pathGet(node, "ticker"),
  ));
  const expiry = normalizeExpiry(firstNonEmpty(
    context.expiry,
    pathGet(node, "expiry"),
    pathGet(node, "expiration"),
    pathGet(node, "expiration_date"),
    pathGet(node, "expire_date"),
    pathGet(node, "expDate"),
    pathGet(node, "maturityDate"),
    pathGet(node, "lastTradeDateOrContractMonth"),
    pathGet(node, "option_expire_date"),
  ));
  const strike = firstFiniteNumber(
    context.strike,
    pathGet(node, "strike"),
    pathGet(node, "strike_price"),
    pathGet(node, "option_strike_price"),
    pathGet(node, "exercise_price"),
    pathGet(node, "exercisePrice"),
  );
  const right = normalizeOptionRightToken(firstNonEmpty(
    context.right,
    pathGet(node, "right"),
    pathGet(node, "option_type"),
    pathGet(node, "call_put"),
    pathGet(node, "put_call"),
    pathGet(node, "cp"),
    pathGet(node, "side"),
    pathGet(node, "direction"),
    pathGet(node, "optionType"),
  ));
  if (!symbol || !expiry || !Number.isFinite(strike) || strike <= 0 || !right) {
    return null;
  }

  const bid = firstFiniteNumber(
    pathGet(node, "bid"),
    pathGet(node, "bid_price"),
    pathGet(node, "bidPrice"),
    pathGet(node, "bp1"),
    pathGet(node, "best_bid"),
    pathGet(node, "bestBid"),
  );
  const ask = firstFiniteNumber(
    pathGet(node, "ask"),
    pathGet(node, "ask_price"),
    pathGet(node, "askPrice"),
    pathGet(node, "ap1"),
    pathGet(node, "best_ask"),
    pathGet(node, "bestAsk"),
  );
  const last = firstFiniteNumber(
    pathGet(node, "last"),
    pathGet(node, "last_price"),
    pathGet(node, "lastPrice"),
    pathGet(node, "trade_price"),
    pathGet(node, "price"),
    pathGet(node, "close"),
  );
  const mark = firstFiniteNumber(
    pathGet(node, "mark"),
    pathGet(node, "mark_price"),
    pathGet(node, "markPrice"),
    pathGet(node, "mid"),
    pathGet(node, "mid_price"),
    pathGet(node, "midPrice"),
    Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : null,
    last,
  );
  const change = firstFiniteNumber(
    pathGet(node, "change"),
    pathGet(node, "chg"),
    pathGet(node, "price_change"),
    pathGet(node, "priceChange"),
  );
  const changePct = firstFiniteNumber(
    pathGet(node, "change_percent"),
    pathGet(node, "changePercent"),
    pathGet(node, "change_pct"),
    pathGet(node, "pctChange"),
    pathGet(node, "change_ratio"),
  );
  const iv = normalizeOptionIv(firstFiniteNumber(
    pathGet(node, "iv"),
    pathGet(node, "implied_volatility"),
    pathGet(node, "impliedVolatility"),
    pathGet(node, "impVol"),
    pathGet(node, "iv_ratio"),
  ));
  const volume = firstFiniteNumber(
    pathGet(node, "volume"),
    pathGet(node, "vol"),
    pathGet(node, "total_volume"),
    pathGet(node, "totalVolume"),
    pathGet(node, "trade_volume"),
    pathGet(node, "tradeVolume"),
  );
  const oi = firstFiniteNumber(
    pathGet(node, "open_interest"),
    pathGet(node, "openInterest"),
    pathGet(node, "oi"),
    pathGet(node, "openInt"),
  );
  const bidSize = firstFiniteNumber(
    pathGet(node, "bid_size"),
    pathGet(node, "bidSize"),
    pathGet(node, "bid_qty"),
    pathGet(node, "bidQuantity"),
    pathGet(node, "bid_volume"),
    pathGet(node, "bidVolume"),
  );
  const askSize = firstFiniteNumber(
    pathGet(node, "ask_size"),
    pathGet(node, "askSize"),
    pathGet(node, "ask_qty"),
    pathGet(node, "askQuantity"),
    pathGet(node, "ask_volume"),
    pathGet(node, "askVolume"),
  );
  const delta = firstFiniteNumber(pathGet(node, "delta"));
  const gamma = firstFiniteNumber(pathGet(node, "gamma"));
  const theta = firstFiniteNumber(pathGet(node, "theta"));
  const vega = firstFiniteNumber(pathGet(node, "vega"));
  const normalizedStrike = round2(strike);

  return {
    contractId: buildCanonicalOptionContractId(symbol, expiry, normalizedStrike, right),
    nativeContractId: firstNonEmpty(
      pathGet(node, "contract_id"),
      pathGet(node, "contractId"),
      pathGet(node, "option_id"),
      pathGet(node, "optionId"),
      pathGet(node, "id"),
      pathGet(node, "conid"),
      pathGet(node, "conId"),
    ) || null,
    symbol,
    expiry,
    strike: normalizedStrike,
    right,
    bid: Number.isFinite(bid) ? round2(bid) : null,
    ask: Number.isFinite(ask) ? round2(ask) : null,
    last: Number.isFinite(last) ? round2(last) : null,
    mark: Number.isFinite(mark) ? round2(mark) : null,
    change: Number.isFinite(change) ? round2(change) : null,
    changePct: Number.isFinite(changePct) ? round2(changePct) : null,
    iv: Number.isFinite(iv) ? round4(iv) : null,
    volume: Number.isFinite(volume) ? Math.max(0, Math.round(volume)) : null,
    oi: Number.isFinite(oi) ? Math.max(0, Math.round(oi)) : null,
    bidSize: Number.isFinite(bidSize) ? Math.max(0, Math.round(bidSize)) : null,
    askSize: Number.isFinite(askSize) ? Math.max(0, Math.round(askSize)) : null,
    delta: Number.isFinite(delta) ? round4(delta) : null,
    gamma: Number.isFinite(gamma) ? round4(gamma) : null,
    theta: Number.isFinite(theta) ? round4(theta) : null,
    vega: Number.isFinite(vega) ? round4(vega) : null,
    updatedAt: optionRowTimestampIso(node),
    brokerRaw: node,
  };
}

function mergeWebullOptionRows(existing, incoming) {
  const merged = {
    ...existing,
  };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value == null || value === "") {
      continue;
    }
    merged[key] = value;
  }
  if (!merged.updatedAt) {
    merged.updatedAt = existing?.updatedAt || incoming?.updatedAt || new Date().toISOString();
  }
  if (!merged.brokerRaw) {
    merged.brokerRaw = incoming?.brokerRaw || existing?.brokerRaw || null;
  }
  return merged;
}

function hasOptionQuoteValues(row) {
  if (!row || typeof row !== "object") {
    return false;
  }
  return Number.isFinite(Number(row.bid))
    || Number.isFinite(Number(row.ask))
    || Number.isFinite(Number(row.last))
    || Number.isFinite(Number(row.mark));
}

function compareOptionContractRows(a, b) {
  const expiryA = String(a?.expiry || "");
  const expiryB = String(b?.expiry || "");
  if (expiryA !== expiryB) {
    return expiryA.localeCompare(expiryB);
  }
  const strikeA = Number(a?.strike);
  const strikeB = Number(b?.strike);
  if (Number.isFinite(strikeA) && Number.isFinite(strikeB) && strikeA !== strikeB) {
    return strikeA - strikeB;
  }
  const rightA = String(a?.right || "");
  const rightB = String(b?.right || "");
  if (rightA !== rightB) {
    return rightA.localeCompare(rightB);
  }
  return String(a?.contractId || "").localeCompare(String(b?.contractId || ""));
}

function selectDominantOptionExpiry(rows) {
  const counts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const expiry = String(row?.expiry || "").trim();
    if (!expiry) {
      continue;
    }
    counts.set(expiry, Number(counts.get(expiry) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });
  return ranked[0]?.[0] || null;
}

function normalizeOptionRightToken(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (text.startsWith("c") || text === "1") {
    return "call";
  }
  if (text.startsWith("p") || text === "2") {
    return "put";
  }
  return null;
}

function normalizeOptionIv(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (numeric > 5) {
    return numeric / 100;
  }
  return numeric;
}

function buildCanonicalOptionContractId(symbol, expiry, strike, right) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedExpiry = normalizeExpiry(expiry);
  const normalizedRight = normalizeOptionRightToken(right);
  const normalizedStrike = Number(strike);
  if (
    !normalizedSymbol
    || !normalizedExpiry
    || !normalizedRight
    || !Number.isFinite(normalizedStrike)
    || normalizedStrike <= 0
  ) {
    return null;
  }
  return `${normalizedSymbol}-${normalizedExpiry}-${Number(normalizedStrike).toString()}-${normalizedRight}`;
}

function optionRowTimestampIso(row) {
  const epoch = toEpochMs(firstNonEmpty(
    pathGet(row, "timestamp"),
    pathGet(row, "ts"),
    pathGet(row, "time"),
    pathGet(row, "trade_time"),
    pathGet(row, "tradeTime"),
    pathGet(row, "quote_time"),
    pathGet(row, "quoteTime"),
    pathGet(row, "updated_at"),
    pathGet(row, "updatedAt"),
  ));
  if (Number.isFinite(epoch)) {
    return new Date(Math.round(epoch)).toISOString();
  }
  return new Date().toISOString();
}

function mapWebullLiveBarsPayload(payload) {
  const rows = firstArray(payload, [
    "data.bars",
    "data.history",
    "data.history_list",
    "data.kline",
    "data.klines",
    "data.candles",
    "data.list",
    "bars",
    "history",
    "history_list",
    "kline",
    "klines",
    "candles",
    "list",
    "data",
  ]);
  const list = Array.isArray(rows) ? rows : [];
  const bars = [];

  for (const row of list) {
    if (Array.isArray(row)) {
      const parsed = parseArrayBar(row);
      if (parsed) {
        bars.push(parsed);
      }
      continue;
    }
    if (!row || typeof row !== "object") {
      continue;
    }

    const time = toEpochMs(firstNonEmpty(
      pathGet(row, "time"),
      pathGet(row, "timestamp"),
      pathGet(row, "ts"),
      pathGet(row, "date_time"),
      pathGet(row, "datetime"),
      pathGet(row, "t"),
    ));
    const open = firstFiniteNumber(pathGet(row, "open"), pathGet(row, "o"));
    const high = firstFiniteNumber(pathGet(row, "high"), pathGet(row, "h"));
    const low = firstFiniteNumber(pathGet(row, "low"), pathGet(row, "l"));
    const close = firstFiniteNumber(pathGet(row, "close"), pathGet(row, "c"));
    const volume = firstFiniteNumber(
      pathGet(row, "volume"),
      pathGet(row, "vol"),
      pathGet(row, "v"),
      0,
    );
    if (
      !Number.isFinite(time)
      || !Number.isFinite(open)
      || !Number.isFinite(high)
      || !Number.isFinite(low)
      || !Number.isFinite(close)
    ) {
      continue;
    }
    bars.push({
      time: Math.round(time),
      open: round2(open),
      high: round2(Math.max(high, open, close)),
      low: round2(Math.min(low, open, close)),
      close: round2(close),
      volume: Math.max(0, Math.round(volume)),
    });
  }

  return dedupeBarsByTime(bars);
}

function parseArrayBar(row) {
  const time = toEpochMs(row[0]);
  if (!Number.isFinite(time)) {
    return null;
  }

  const v1 = Number(row[1]);
  const v2 = Number(row[2]);
  const v3 = Number(row[3]);
  const v4 = Number(row[4]);
  if (![v1, v2, v3, v4].every(Number.isFinite)) {
    return null;
  }

  let open = v1;
  let high = v2;
  let low = v3;
  let close = v4;
  if (high < Math.max(open, close) || low > Math.min(open, close)) {
    // Some feeds emit O,C,H,L order.
    open = v1;
    close = v2;
    high = Math.max(v3, open, close);
    low = Math.min(v4, open, close);
  }
  const volume = firstFiniteNumber(row[5], row[6], 0);

  return {
    time: Math.round(time),
    open: round2(open),
    high: round2(high),
    low: round2(low),
    close: round2(close),
    volume: Math.max(0, Math.round(volume)),
  };
}

function dedupeBarsByTime(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const time = Number(row?.time);
    if (!Number.isFinite(time)) {
      continue;
    }
    map.set(Math.round(time), {
      ...row,
      time: Math.round(time),
    });
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function mapWebullLiveDepthPayload(payload, levels = MARKET_DEFAULT_DEPTH_LEVELS) {
  const depthObj = firstObject(payload, [
    "data.depth",
    "data.order_book",
    "data.orderBook",
    "data.quote",
    "data.snapshot",
    "depth",
    "order_book",
    "orderBook",
    "quote",
    "snapshot",
    "data",
  ]) || payload;

  const bids = parseWebullBookSide(
    firstArray(depthObj, [
      "bids",
      "bid_list",
      "bidList",
      "bid",
      "bp",
      "buy",
    ]) || [],
    levels,
  );
  const asks = parseWebullBookSide(
    firstArray(depthObj, [
      "asks",
      "ask_list",
      "askList",
      "ask",
      "ap",
      "sell",
    ]) || [],
    levels,
  );
  const timestamp = toEpochMs(firstNonEmpty(
    pathGet(depthObj, "timestamp"),
    pathGet(depthObj, "ts"),
    pathGet(depthObj, "time"),
    Date.now(),
  ));

  return {
    bids,
    asks,
    timestamp: Number.isFinite(timestamp)
      ? new Date(Math.round(timestamp)).toISOString()
      : new Date().toISOString(),
    brokerRaw: depthObj,
  };
}

function parseWebullBookSide(rows, levels) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    let price;
    let size;
    if (Array.isArray(row)) {
      price = firstFiniteNumber(row[0], row[1]);
      size = firstFiniteNumber(row[1], row[2], row[3], 0);
    } else if (row && typeof row === "object") {
      price = firstFiniteNumber(
        pathGet(row, "price"),
        pathGet(row, "p"),
        pathGet(row, "bid_price"),
        pathGet(row, "ask_price"),
      );
      size = firstFiniteNumber(
        pathGet(row, "size"),
        pathGet(row, "volume"),
        pathGet(row, "qty"),
        pathGet(row, "quantity"),
        0,
      );
    }
    if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) {
      continue;
    }
    out.push({
      price: round2(price),
      size: Math.max(0, Math.round(size)),
    });
    if (out.length >= levels) {
      break;
    }
  }
  return out;
}

function mapWebullLiveTicksPayload(payload, limit = MARKET_DEFAULT_TICK_LIMIT) {
  const rows = firstArray(payload, [
    "data.ticks",
    "data.tick_list",
    "data.tickList",
    "data.trades",
    "data.trade_list",
    "data.tradeList",
    "data.list",
    "ticks",
    "tick_list",
    "tickList",
    "trades",
    "trade_list",
    "tradeList",
    "list",
    "data",
  ]);
  const list = Array.isArray(rows) ? rows : [];
  const ticks = [];
  let lastPrice = NaN;
  for (const row of list) {
    if (!row) {
      continue;
    }
    const time = toEpochMs(firstNonEmpty(
      pathGet(row, "time"),
      pathGet(row, "timestamp"),
      pathGet(row, "ts"),
      pathGet(row, "trade_time"),
      pathGet(row, "tradeTime"),
      Array.isArray(row) ? row[0] : null,
    ));
    const price = firstFiniteNumber(
      pathGet(row, "price"),
      pathGet(row, "trade_price"),
      pathGet(row, "last_price"),
      Array.isArray(row) ? row[1] : null,
    );
    const size = firstFiniteNumber(
      pathGet(row, "size"),
      pathGet(row, "volume"),
      pathGet(row, "qty"),
      pathGet(row, "quantity"),
      Array.isArray(row) ? row[2] : null,
      0,
    );
    if (!Number.isFinite(time) || !Number.isFinite(price) || !Number.isFinite(size) || size <= 0) {
      continue;
    }
    const side = normalizeTickSide(
      firstNonEmpty(
        pathGet(row, "side"),
        pathGet(row, "trade_side"),
        pathGet(row, "tradeSide"),
        pathGet(row, "direction"),
        pathGet(row, "bs"),
        Array.isArray(row) ? row[3] : null,
      ),
      price,
      lastPrice,
    );
    ticks.push({
      time: new Date(Math.round(time)).toISOString(),
      price: round2(price),
      size: Math.max(0, Math.round(size)),
      volume: Math.max(0, Math.round(size)),
      side,
      brokerRaw: row,
    });
    lastPrice = price;
  }
  const sorted = ticks.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (sorted.length > limit) {
    return sorted.slice(sorted.length - limit);
  }
  return sorted;
}

function normalizeTickSide(raw, price, previousPrice) {
  const text = String(raw || "").trim().toLowerCase();
  if (["buy", "b", "bid", "1"].includes(text)) {
    return "buy";
  }
  if (["sell", "s", "ask", "2"].includes(text)) {
    return "sell";
  }
  if (Number.isFinite(previousPrice) && Number.isFinite(price)) {
    if (price < previousPrice) {
      return "sell";
    }
    if (price > previousPrice) {
      return "buy";
    }
  }
  return "buy";
}

function mapWebullLiveFootprintPayload(payload) {
  const rows = firstArray(payload, [
    "data.rows",
    "data.footprint",
    "data.footprint_rows",
    "data.footprintRows",
    "data.list",
    "rows",
    "footprint",
    "footprint_rows",
    "footprintRows",
    "list",
    "data",
  ]);
  const list = Array.isArray(rows) ? rows : [];
  const out = [];

  for (const row of list) {
    if (!row) {
      continue;
    }
    const price = firstFiniteNumber(
      pathGet(row, "price"),
      pathGet(row, "level"),
      pathGet(row, "p"),
      Array.isArray(row) ? row[0] : null,
    );
    const buyVolume = firstFiniteNumber(
      pathGet(row, "buy_volume"),
      pathGet(row, "buyVolume"),
      pathGet(row, "bid_volume"),
      pathGet(row, "bidVolume"),
      Array.isArray(row) ? row[1] : null,
      0,
    );
    const sellVolume = firstFiniteNumber(
      pathGet(row, "sell_volume"),
      pathGet(row, "sellVolume"),
      pathGet(row, "ask_volume"),
      pathGet(row, "askVolume"),
      Array.isArray(row) ? row[2] : null,
      0,
    );
    const totalVolume = firstFiniteNumber(
      pathGet(row, "total_volume"),
      pathGet(row, "totalVolume"),
      pathGet(row, "volume"),
      Array.isArray(row) ? row[3] : null,
      buyVolume + sellVolume,
    );
    if (
      !Number.isFinite(price)
      || (!Number.isFinite(buyVolume) && !Number.isFinite(sellVolume) && !Number.isFinite(totalVolume))
    ) {
      continue;
    }

    const safeBuy = Math.max(0, Number(buyVolume || 0));
    const safeSell = Math.max(0, Number(sellVolume || 0));
    const safeTotal = Math.max(0, Number.isFinite(totalVolume) ? Number(totalVolume) : safeBuy + safeSell);
    out.push({
      price: round2(price),
      buyVolume: Math.round(safeBuy),
      sellVolume: Math.round(safeSell),
      totalVolume: Math.round(safeTotal),
      delta: round2(safeBuy - safeSell),
      brokerRaw: row,
    });
  }

  return out.sort((a, b) => a.price - b.price);
}

function aggregateTicksToFootprint(ticks) {
  const map = new Map();
  for (const tick of Array.isArray(ticks) ? ticks : []) {
    const price = Number(tick?.price);
    const size = Number(tick?.size || tick?.volume || 0);
    if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) {
      continue;
    }
    const priceKey = round2(price);
    let row = map.get(priceKey);
    if (!row) {
      row = {
        price: priceKey,
        buyVolume: 0,
        sellVolume: 0,
        totalVolume: 0,
      };
      map.set(priceKey, row);
    }
    const side = String(tick?.side || "").toLowerCase();
    if (side.startsWith("sell")) {
      row.sellVolume += size;
    } else {
      row.buyVolume += size;
    }
    row.totalVolume += size;
  }
  const rows = [...map.values()];
  for (const row of rows) {
    row.buyVolume = Math.round(row.buyVolume);
    row.sellVolume = Math.round(row.sellVolume);
    row.totalVolume = Math.round(row.totalVolume);
    row.delta = round2(row.buyVolume - row.sellVolume);
  }
  return rows.sort((a, b) => a.price - b.price);
}

function resolveWebullMarketCategory(account, symbol) {
  const explicit = firstNonEmpty(
    account?.credentials?.WEBULL_MARKET_CATEGORY,
    account?.credentials?.WEBULL_SYMBOL_CATEGORY,
  );
  if (explicit) {
    return String(explicit).trim().toUpperCase();
  }
  const normalized = normalizeSymbol(symbol);
  if (normalized.includes(".HK")) return "HK_STOCK";
  if (normalized.includes(".JP")) return "JP_STOCK";
  return MARKET_DEFAULT_CATEGORY;
}

function buildWebullMarketCategoryCandidates(account, symbol) {
  const explicit = firstNonEmpty(
    account?.credentials?.WEBULL_MARKET_CATEGORY,
    account?.credentials?.WEBULL_SYMBOL_CATEGORY,
  );
  if (explicit) {
    return [String(explicit).trim().toUpperCase()];
  }

  const primary = resolveWebullMarketCategory(account, symbol);
  if (primary === "US_STOCK") {
    return ["US_STOCK", "US_ETF"];
  }
  if (primary === "US_ETF") {
    return ["US_ETF", "US_STOCK"];
  }
  return [primary];
}

function buildWebullOptionCategoryCandidates(account, symbol) {
  const explicit = firstNonEmpty(
    account?.credentials?.WEBULL_OPTION_CATEGORY,
    account?.credentials?.WEBULL_OPTIONS_CATEGORY,
    account?.credentials?.WEBULL_MARKET_OPTION_CATEGORY,
  );
  if (explicit) {
    return [String(explicit).trim().toUpperCase()];
  }
  const stockCategories = buildWebullMarketCategoryCandidates(account, symbol);
  const out = new Set(["US_OPTION", "OPTION", "US_OPTIONS"]);
  for (const category of stockCategories) {
    const normalized = String(category || "").trim().toUpperCase();
    if (!normalized) {
      continue;
    }
    if (normalized.includes("US")) {
      out.add("US_OPTION");
      out.add("US_OPTIONS");
      out.add("US_STOCK_OPTION");
    }
    if (normalized.includes("HK")) {
      out.add("HK_OPTION");
    }
    if (normalized.includes("JP")) {
      out.add("JP_OPTION");
    }
  }
  return [...out];
}

function firstObject(source, paths = []) {
  for (const path of paths) {
    const value = pathGet(source, path);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function nearestStrikeIndex(rows, underlyingPrice) {
  if (!Array.isArray(rows) || !rows.length) {
    return 0;
  }
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < rows.length; index += 1) {
    const distance = Math.abs(Number(rows[index]?.strike || 0) - Number(underlyingPrice || 0));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function ratioToPct(part, total) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) {
    return 0;
  }
  return round2((p / t) * 100);
}

function clampOrderFlowScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return round4(Math.max(-1, Math.min(1, numeric)));
}

function classifyOrderFlow(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) {
    return "neutral";
  }
  if (numeric >= 0.4) return "strong_buy_pressure";
  if (numeric >= 0.15) return "buy_pressure";
  if (numeric <= -0.4) return "strong_sell_pressure";
  if (numeric <= -0.15) return "sell_pressure";
  return "neutral";
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(durationMs || 0))));
}

function rankWebullAccount(account) {
  const accountClass = String(
    firstNonEmpty(
      pathGet(account, "account_class"),
      pathGet(account, "accountClass"),
      "",
    ),
  ).toUpperCase();
  const label = String(
    firstNonEmpty(
      pathGet(account, "account_label"),
      pathGet(account, "accountLabel"),
      "",
    ),
  ).toUpperCase();

  if (accountClass.includes("INDIVIDUAL_MARGIN")) return 0;
  if (accountClass.includes("INDIVIDUAL_CASH")) return 1;
  if (accountClass.includes("MARGIN")) return 2;
  if (accountClass.includes("CASH") && !accountClass.includes("EVENT")) return 3;
  if (label.includes("INDIVIDUAL")) return 4;
  if (accountClass.includes("CRYPTO")) return 7;
  if (accountClass.includes("FUTURES")) return 8;
  if (accountClass.includes("EVENT")) return 9;
  return 5;
}

function createWebullStreamingSessionId(accountId) {
  const base = String(accountId || "webull").replace(/[^a-zA-Z0-9_-]+/g, "");
  const randomPart = crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "")
    : crypto.randomBytes(12).toString("hex");
  const composed = `${base}-${Date.now()}-${randomPart}`;
  return composed.slice(0, 63);
}

function normalizeWebullStreamingTopic(topic) {
  const text = String(topic || "").trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (text.includes("event-snapshot")) return "event-snapshot";
  if (text.includes("event-quote")) return "event-quote";
  if (text.includes("snapshot")) return "snapshot";
  if (text.includes("quote")) return "quote";
  if (text.includes("tick")) return "tick";
  if (text.includes("notice")) return "notice";
  if (text.includes("echo")) return "echo";
  return null;
}

function inferWebullStreamingSymbolFromTopic(topic) {
  const text = String(topic || "").trim();
  if (!text) {
    return "";
  }
  const parts = text
    .split(/[/:|]/)
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const token = normalizeSymbol(parts[index]);
    if (/^[A-Z0-9._-]{1,24}$/.test(token) && !["QUOTE", "SNAPSHOT", "TICK", "NOTICE", "ECHO"].includes(token)) {
      return token;
    }
  }
  return "";
}

function mapWebullStreamingBookRows(rows, levels = MARKET_DEFAULT_DEPTH_LEVELS) {
  const clampedLevels = clampNumber(levels, 1, 50, MARKET_DEFAULT_DEPTH_LEVELS);
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const price = firstFiniteNumber(
      pathGet(row, "price"),
      pathGet(row, "p"),
      Array.isArray(row) ? row[0] : null,
    );
    const size = firstFiniteNumber(
      pathGet(row, "size"),
      pathGet(row, "volume"),
      pathGet(row, "qty"),
      Array.isArray(row) ? row[1] : null,
    );
    if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) {
      continue;
    }
    out.push({
      price: round2(price),
      size: Math.max(0, Math.round(size)),
    });
    if (out.length >= clampedLevels) {
      break;
    }
  }
  return out;
}

function buildWebullStreamingProtoTypes() {
  const schema = `
    syntax = "proto3";
    package webull.streaming;

    message Basic {
      string symbol = 1;
      string instrument_id = 2;
      string timestamp = 3;
    }

    message Order {
      string mpid = 1;
      string size = 2;
    }

    message Broker {
      string bid = 1;
      string name = 2;
    }

    message AskBid {
      string price = 1;
      string size = 2;
      repeated Order order = 3;
      repeated Broker broker = 4;
    }

    message Quote {
      Basic basic = 1;
      repeated AskBid asks = 2;
      repeated AskBid bids = 3;
    }

    message Snapshot {
      Basic basic = 1;
      string price = 2;
      string volume = 3;
      string trade_time = 4;
      string open_interest = 5;
      string pre_close = 6;
      string open = 7;
      string high = 8;
      string low = 9;
      string change = 10;
      string change_ratio = 11;
    }

    message Tick {
      Basic basic = 1;
      string time = 2;
      string price = 3;
      string volume = 4;
      string side = 5;
    }

    message EventAskBid {
      string price = 1;
      string size = 2;
    }

    message EventQuote {
      Basic basic = 1;
      repeated EventAskBid yes_bids = 2;
      repeated EventAskBid no_bids = 3;
    }

    message EventSnapshot {
      Basic basic = 1;
      string price = 2;
      string volume = 3;
      string last_trade_time = 4;
      string open_interest = 5;
      string yes_ask = 6;
      string yes_bid = 7;
      string yes_ask_size = 8;
      string yes_bid_size = 9;
      string no_ask = 10;
      string no_bid = 11;
      string no_ask_size = 12;
      string no_bid_size = 13;
    }
  `;
  const parsed = protobuf.parse(schema);
  const root = parsed.root;
  return {
    quote: root.lookupType("webull.streaming.Quote"),
    snapshot: root.lookupType("webull.streaming.Snapshot"),
    tick: root.lookupType("webull.streaming.Tick"),
    eventQuote: root.lookupType("webull.streaming.EventQuote"),
    eventSnapshot: root.lookupType("webull.streaming.EventSnapshot"),
  };
}
