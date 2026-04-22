import { BrokerAdapter } from "./BrokerAdapter.js";
import { buildOAuth1Header } from "../services/oauth1.js";
import {
  etDateKey,
  isLikelyExpiredByEtDate,
  renewEtradeAccessToken,
  resolveEtradeConsumerCredentials,
} from "../services/etradeOAuth.js";

const PROD_BASE_URL = "https://api.etrade.com";
const SANDBOX_BASE_URL = "https://apisb.etrade.com";
const REQUEST_TIMEOUT_MS = 8000;
const TRANSACTION_PAGE_SIZE = 200;
const TRANSACTION_MAX_PAGES = 20;
const TRANSACTION_HISTORY_MAX_DAYS = 730;
const AUTH_STATUS_CACHE_TTL_MS = 60_000;
const ET_SESSION_DATE_KEY = "ETRADE_SESSION_ET_DATE";
const ET_ISSUED_DATE_KEY = "ETRADE_OAUTH_ISSUED_ET_DATE";

export class ETradeAdapter extends BrokerAdapter {
  constructor(store) {
    super(store, "etrade", {
      requiredCredentialKeys: ["ETRADE_PROD_KEY", "ETRADE_PROD_SECRET"],
      defaultCommission: 0.65,
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
    this.authStatusCache = new Map();
  }

  async connect(account, credentials = {}) {
    const prodReady = credentials.ETRADE_PROD_KEY && credentials.ETRADE_PROD_SECRET;
    const sandboxReady = credentials.ETRADE_SB_KEY && credentials.ETRADE_SB_SECRET;

    if (!prodReady && !sandboxReady) {
      throw new Error(
        "E*Trade requires production or sandbox key/secret credentials",
      );
    }

    return {
      status: "connected",
      message: prodReady
        ? "E*Trade production credentials present"
        : "E*Trade sandbox credentials present",
    };
  }

  async getAuthStatus(account) {
    const credentials = account?.credentials || {};
    const issuedEtDate = firstNonEmpty(
      credentials[ET_SESSION_DATE_KEY],
      credentials[ET_ISSUED_DATE_KEY],
    );
    const accountId = String(account?.accountId || "").trim();
    const cached = accountId ? this.authStatusCache.get(accountId) : null;
    if (
      cached
      && !isLikelyExpiredByEtDate(issuedEtDate)
      && Date.now() - Number(cached.cachedAt || 0) < AUTH_STATUS_CACHE_TTL_MS
      && cached.auth
    ) {
      return cached.auth;
    }

    const hasProdKeys = hasCredential(credentials.ETRADE_PROD_KEY) && hasCredential(credentials.ETRADE_PROD_SECRET);
    const hasSandboxKeys = hasCredential(credentials.ETRADE_SB_KEY) && hasCredential(credentials.ETRADE_SB_SECRET);
    const hasOAuthToken = hasCredential(credentials.ETRADE_ACCESS_TOKEN) && hasCredential(credentials.ETRADE_ACCESS_SECRET);

    if (!hasProdKeys && !hasSandboxKeys) {
      const auth = {
        broker: "etrade",
        state: "missing_credentials",
        live: false,
        message: "Missing E*Trade consumer key/secret credentials",
        checkedAt: new Date().toISOString(),
      };
      this.#cacheAuthStatus(account, auth);
      return auth;
    }

    if (!hasOAuthToken) {
      const auth = {
        broker: "etrade",
        state: "needs_token",
        live: false,
        message: "E*Trade OAuth access token/secret required for live API",
        checkedAt: new Date().toISOString(),
      };
      this.#cacheAuthStatus(account, auth);
      return auth;
    }

    if (isLikelyExpiredByEtDate(issuedEtDate)) {
      const auth = {
        broker: "etrade",
        state: "needs_token",
        live: false,
        message: "E*Trade OAuth session expired after the ET day rollover; log in again for a new token.",
        checkedAt: new Date().toISOString(),
      };
      this.#cacheAuthStatus(account, auth);
      return auth;
    }

    try {
      const probeQuote = await this.#fetchLiveSpotQuote(account, "SPY");
      if (probeQuote?.last) {
        const auth = {
          broker: "etrade",
          state: "authenticated",
          live: true,
          message: "E*Trade live quote API reachable",
          checkedAt: new Date().toISOString(),
        };
        this.#cacheAuthStatus(account, auth);
        return auth;
      }
    } catch (error) {
      const auth = {
        broker: "etrade",
        state: isEtradeUnauthorizedError(error) ? "needs_token" : "degraded",
        live: false,
        message: isEtradeUnauthorizedError(error)
          ? "E*Trade OAuth session was rejected by the API; log in again for a new token."
          : (error?.message || "E*Trade auth probe failed"),
        checkedAt: new Date().toISOString(),
      };
      this.#cacheAuthStatus(account, auth);
      return auth;
    }

    const auth = {
      broker: "etrade",
      state: "degraded",
      live: false,
      message: "E*Trade credentials configured but live quote probe returned no data",
      checkedAt: new Date().toISOString(),
    };
    this.#cacheAuthStatus(account, auth);
    return auth;
  }

  async refreshAuthSession(account) {
    const accountId = String(account?.accountId || "").trim();
    let effectiveCredentials = account?.credentials || {};
    try {
      const consumer = resolveEtradeConsumerCredentials(effectiveCredentials);
      const accessToken = effectiveCredentials.ETRADE_ACCESS_TOKEN;
      const accessSecret = effectiveCredentials.ETRADE_ACCESS_SECRET;
      const currentEtDate = etDateKey(new Date());
      const issuedEtDate = firstNonEmpty(
        effectiveCredentials[ET_SESSION_DATE_KEY],
        effectiveCredentials[ET_ISSUED_DATE_KEY],
      );

      if (isLikelyExpiredByEtDate(issuedEtDate)) {
        this.authStatusCache.delete(accountId);
        return this.getAuthStatus({
          ...(account || {}),
          credentials: effectiveCredentials,
        });
      }

      if (accessToken && accessSecret) {
        await renewEtradeAccessToken({
          consumerKey: consumer.consumerKey,
          consumerSecret: consumer.consumerSecret,
          useSandbox: consumer.useSandbox,
          accessToken,
          accessSecret,
        });

        if (accountId) {
          await this.store.upsertAccount({
            accountId,
            broker: account?.broker || "etrade",
            credentials: {
              [ET_SESSION_DATE_KEY]: currentEtDate,
            },
          });
        }
        effectiveCredentials = {
          ...effectiveCredentials,
          [ET_SESSION_DATE_KEY]: currentEtDate,
        };
      }
    } catch {
      // Keep auth refresh resilient and fall back to probing status.
    }
    this.authStatusCache.delete(accountId);
    return this.getAuthStatus({
      ...(account || {}),
      credentials: effectiveCredentials,
    });
  }

  #cacheAuthStatus(account, auth) {
    const accountId = String(account?.accountId || "").trim();
    if (!accountId || !auth) {
      return;
    }
    this.authStatusCache.set(accountId, {
      cachedAt: Date.now(),
      auth,
    });
  }

  async getPositions(account) {
    const isLiveMode = String(account?.mode || "live").toLowerCase() === "live";
    const authState = String(account?.authState || "").toLowerCase();
    try {
      const live = await this.#fetchLivePositions(account);
      if (Array.isArray(live)) {
        return live;
      }
    } catch {
      // Continue to strict-live guard below.
    }
    if (isLiveMode && authState === "authenticated") {
      return [];
    }
    return super.getPositions(account);
  }

  async getAccountSummary(account) {
    const fallback = await super.getAccountSummary(account);

    try {
      const auth = this.#buildAuthContext(account);
      if (!auth) {
        return fallback;
      }

      const accountIdKey = await this.#resolveAccountIdKey(account, auth);
      if (!accountIdKey) {
        return fallback;
      }

      const [balancePayload, positions] = await Promise.all([
        this.#requestJson(
          `${auth.baseUrl}/v1/accounts/${encodeURIComponent(accountIdKey)}/balance.json?instType=BROKERAGE&realTimeNAV=true`,
          auth,
        ).catch(() => null),
        this.#fetchLivePositions(account).catch(() => []),
      ]);

      const safePositions = Array.isArray(positions) ? positions : [];
      const marketValueFromPositions = safePositions.reduce(
        (sum, row) => sum + Number(row.marketValue || 0),
        0,
      );
      const unrealizedFromPositions = safePositions.reduce(
        (sum, row) => sum + Number(row.unrealizedPnl || 0),
        0,
      );

      const balanceRoot = balancePayload?.BalanceResponse || balancePayload?.balanceResponse || {};
      const computed = balanceRoot?.Computed || balanceRoot?.computed || {};
      const realtime = computed?.RealTimeValues || computed?.realTimeValues || {};
      const cashNode = balanceRoot?.Cash || balanceRoot?.cash || {};

      let marketValue = firstFiniteNumber(
        firstNumber(realtime, ["netMv", "netMvLong", "netMarketValue"]),
        marketValueFromPositions,
        fallback?.marketValue,
      );
      if (
        Number.isFinite(Number(marketValueFromPositions))
        && Number(marketValueFromPositions) > 0
        && Number.isFinite(Number(marketValue))
        && Number(marketValue) <= 0
      ) {
        marketValue = Number(marketValueFromPositions);
      }

      let equity = firstFiniteNumber(
        firstNumber(realtime, ["totalAccountValue", "totalAccountBalance"]),
        firstNumber(computed, ["accountBalance"]),
        Number(marketValue || 0) + Number(firstNumber(computed, ["cashBalance", "netCash"]) || 0),
        fallback?.equity,
      );
      const fallbackEquity = Number(fallback?.equity);
      if (
        Number.isFinite(fallbackEquity)
        && fallbackEquity > 0
        && Number.isFinite(Number(equity))
        && Number(equity) <= 0
      ) {
        equity = fallbackEquity;
      }

      let buyingPower = firstFiniteNumber(
        firstNumber(computed, [
          "cashBuyingPower",
          "marginBuyingPower",
          "cashAvailableForInvestment",
          "dtMarginBuyingPower",
          "dtCashBuyingPower",
        ]),
        fallback?.buyingPower,
      );
      const fallbackBuyingPower = Number(fallback?.buyingPower);
      if (
        Number.isFinite(fallbackBuyingPower)
        && fallbackBuyingPower > 0
        && Number.isFinite(Number(buyingPower))
        && Number(buyingPower) <= 0
      ) {
        buyingPower = fallbackBuyingPower;
      }

      let cash = firstFiniteNumber(
        firstNumber(computed, [
          "netCash",
          "cashAvailableForInvestment",
          "cashBalance",
          "cashAvailableForWithdrawal",
        ]),
        combineNumbers(
          firstNumber(computed, ["cashBalance"]),
          firstNumber(cashNode, ["moneyMktBalance"]),
        ),
        fallback?.cash,
        buyingPower,
      );
      const fallbackCash = Number(fallback?.cash);
      if (
        Number.isFinite(fallbackCash)
        && fallbackCash > 0
        && Number.isFinite(Number(cash))
        && Number(cash) <= 0
      ) {
        cash = fallbackCash;
      }
      const settledCash = firstFiniteNumber(
        firstNumber(computed, ["cashBalance", "netCash"]),
        firstNumber(cashNode, ["moneyMktBalance"]),
      );
      const unsettledCash = firstFiniteNumber(
        firstNumber(computed, ["unsettledCash"]),
        Number.isFinite(cash) && Number.isFinite(settledCash)
          ? Number(cash) - Number(settledCash)
          : null,
      );
      const cashAvailableToTrade = firstFiniteNumber(
        firstNumber(computed, ["cashBuyingPower", "cashAvailableForInvestment"]),
        buyingPower,
        cash,
      );
      const cashAvailableToWithdraw = firstFiniteNumber(
        firstNumber(computed, ["cashAvailableForWithdrawal", "cashAvailableForInvestment"]),
        settledCash,
        cash,
      );
      const marginAvailable = firstFiniteNumber(
        firstNumber(computed, ["marginBuyingPower", "dtMarginBuyingPower"]),
        Number.isFinite(buyingPower) && Number.isFinite(cashAvailableToTrade)
          ? Math.max(0, Number(buyingPower) - Number(cashAvailableToTrade))
          : null,
      );

      const looksTransientInvalidLiveSummary = (
        Number.isFinite(Number(fallbackEquity))
        && Number(fallbackEquity) > 0
        && Number.isFinite(Number(equity))
        && Number(equity) <= 0
      );
      if (looksTransientInvalidLiveSummary) {
        return {
          ...fallback,
          accountId: account.accountId,
          lastSync: new Date().toISOString(),
          source: "etrade-fallback-summary",
          stale: true,
        };
      }

      return {
        accountId: account.accountId,
        marketValue: round2(Number.isFinite(marketValue) ? marketValue : 0),
        unrealizedPnl: round2(Number.isFinite(unrealizedFromPositions) ? unrealizedFromPositions : 0),
        equity: round2(Number.isFinite(equity) ? equity : 0),
        buyingPower: round2(Math.max(0, Number.isFinite(buyingPower) ? buyingPower : 0)),
        cash: round2(Number.isFinite(cash) ? cash : 0),
        settledCash: Number.isFinite(settledCash) ? round2(settledCash) : null,
        unsettledCash: Number.isFinite(unsettledCash) ? round2(Math.max(0, unsettledCash)) : null,
        cashAvailableToTrade: Number.isFinite(cashAvailableToTrade) ? round2(cashAvailableToTrade) : null,
        cashAvailableToWithdraw: Number.isFinite(cashAvailableToWithdraw) ? round2(cashAvailableToWithdraw) : null,
        marginAvailable: Number.isFinite(marginAvailable) ? round2(marginAvailable) : null,
        positions: safePositions.length,
        lastSync: new Date().toISOString(),
        source: "etrade-live-summary",
        stale: false,
      };
    } catch {
      return fallback;
    }
  }

  async getEquityHistory(account, request = {}) {
    try {
      const auth = this.#buildAuthContext(account);
      if (!auth) {
        return [];
      }
      const accountIdKey = await this.#resolveAccountIdKey(account, auth);
      if (!accountIdKey) {
        return [];
      }

      const { startMs, endMs } = resolveHistoryWindow(request, {
        defaultDays: TRANSACTION_HISTORY_MAX_DAYS,
        maxDays: TRANSACTION_HISTORY_MAX_DAYS,
      });
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
        return [];
      }

      const maxPoints = clampNumber(request.maxPoints, 50, 12000, 5000);
      const transactions = await this.#fetchTransactionRows(account, {
        auth,
        accountIdKey,
        startMs,
        endMs,
        maxRows: Math.max(maxPoints * 2, 400),
      });
      const ledger = mapEtradeTransactionLedger(transactions, {
        accountId: account.accountId,
      });
      if (!ledger.length) {
        return [];
      }

      const summary = await this.getAccountSummary(account).catch(() => null);
      const endEquity = Number(summary?.equity);
      const points = buildEtradeEquityCurveFromLedger(ledger, {
        endMs,
        endEquity: Number.isFinite(endEquity) ? endEquity : null,
      });
      if (!points.length) {
        return [];
      }
      return points.length > maxPoints ? points.slice(points.length - maxPoints) : points;
    } catch {
      return [];
    }
  }

  async getClosedTrades(account, request = {}) {
    try {
      const auth = this.#buildAuthContext(account);
      if (!auth) {
        return [];
      }
      const accountIdKey = await this.#resolveAccountIdKey(account, auth);
      if (!accountIdKey) {
        return [];
      }

      const { startMs, endMs } = resolveHistoryWindow(request, {
        defaultDays: TRANSACTION_HISTORY_MAX_DAYS,
        maxDays: TRANSACTION_HISTORY_MAX_DAYS,
      });
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
        return [];
      }

      const limit = clampNumber(request.limit, 20, 5000, 800);
      const transactions = await this.#fetchTransactionRows(account, {
        auth,
        accountIdKey,
        startMs,
        endMs,
        maxRows: Math.max(limit * 2, 500),
      });
      const rows = mapEtradeTransactionClosedTrades(transactions, {
        accountId: account.accountId,
      });
      return rows.length > limit ? rows.slice(0, limit) : rows;
    } catch {
      return [];
    }
  }

  async getCashLedger(account, request = {}) {
    try {
      const auth = this.#buildAuthContext(account);
      if (!auth) {
        return [];
      }
      const accountIdKey = await this.#resolveAccountIdKey(account, auth);
      if (!accountIdKey) {
        return [];
      }

      const { startMs, endMs } = resolveHistoryWindow(request, {
        defaultDays: TRANSACTION_HISTORY_MAX_DAYS,
        maxDays: TRANSACTION_HISTORY_MAX_DAYS,
      });
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
        return [];
      }

      const limit = clampNumber(request.limit, 20, 6000, 1200);
      const transactions = await this.#fetchTransactionRows(account, {
        auth,
        accountIdKey,
        startMs,
        endMs,
        maxRows: Math.max(limit * 2, 600),
      });
      const rows = mapEtradeTransactionLedger(transactions, {
        accountId: account.accountId,
      });
      return rows.length > limit ? rows.slice(0, limit) : rows;
    } catch {
      return [];
    }
  }

  async getSpotQuote(account, symbol) {
    try {
      const live = await this.#fetchLiveSpotQuote(account, symbol);
      if (live) {
        return {
          ...live,
          source: "etrade-live",
          stale: false,
        };
      }
    } catch (error) {
      return this.buildUnavailableSpotQuote(symbol, {
        source: "etrade-live-unavailable",
        error: error?.message || "E*Trade live quote unavailable",
      });
    }
  }

  async getOptionChain(account, request = {}) {
    try {
      const live = await this.#fetchLiveOptionChain(account, request);
      if (live?.rows?.length) {
        return {
          ...live,
          source: "etrade-live",
          stale: false,
        };
      }
    } catch (error) {
      return this.buildUnavailableOptionChain(request, {
        source: "etrade-live-options-unavailable",
        error: error?.message || "E*Trade live option chain unavailable",
      });
    }
  }

  async getOptionLadder(account, request = {}) {
    const right = String(request.right || "call").toLowerCase() === "put" ? "put" : "call";
    const chain = await this.getOptionChain(account, request);
    const window = Number.isFinite(Number(request.window)) ? Number(request.window) : 7;
    const rows = [...chain.rows]
      .filter((row) => row.right === right)
      .sort((a, b) => a.strike - b.strike);

    const atmIndex = nearestStrikeIndex(rows, chain.underlyingPrice);
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

  async getBars(account, request = {}) {
    const symbol = String(request.symbol || "SPY").trim().toUpperCase();
    const resolution = normalizeResolution(request.resolution);

    try {
      const liveQuote = await this.#fetchLiveSpotQuote(account, symbol);
      if (!liveQuote?.last) {
        throw new Error("Live quote unavailable for E*Trade bars");
      }

      const anchored = await super.getBars(account, {
        ...request,
        symbol,
        resolution,
      });
      const bars = Array.isArray(anchored?.bars)
        ? anchored.bars.map((bar) => ({ ...bar }))
        : [];

      if (!bars.length) {
        throw new Error("Synthetic base bars unavailable");
      }

      const intervalMs = resolutionToMs(resolution);
      const bucketTime = alignToInterval(Date.now(), intervalMs);
      const currentOpen = Number.isFinite(liveQuote.open) ? round2(liveQuote.open) : round2(liveQuote.last);
      const currentHigh = Number.isFinite(liveQuote.high) ? round2(liveQuote.high) : round2(Math.max(currentOpen, liveQuote.last));
      const currentLow = Number.isFinite(liveQuote.low) ? round2(liveQuote.low) : round2(Math.min(currentOpen, liveQuote.last));
      const currentClose = round2(liveQuote.last);
      const currentVolume = Math.max(0, Math.round(Number(liveQuote.volume || 0)));

      let currentIndex = -1;
      for (let index = bars.length - 1; index >= 0; index -= 1) {
        if (bars[index].time <= bucketTime) {
          currentIndex = index;
          break;
        }
      }

      if (currentIndex === -1 || bars[currentIndex].time < bucketTime) {
        const previousClose = currentIndex >= 0
          ? Number(bars[currentIndex].close)
          : currentOpen;
        bars.push({
          time: bucketTime,
          open: round2(previousClose),
          high: round2(Math.max(previousClose, currentHigh, currentClose)),
          low: round2(Math.min(previousClose, currentLow, currentClose)),
          close: currentClose,
          volume: currentVolume,
        });
        currentIndex = bars.length - 1;
      } else {
        const current = bars[currentIndex];
        bars[currentIndex] = {
          ...current,
          open: round2(Number.isFinite(current.open) ? current.open : currentOpen),
          high: round2(Math.max(current.high, currentHigh, currentClose)),
          low: round2(Math.min(current.low, currentLow, currentClose)),
          close: currentClose,
          volume: Math.max(currentVolume, Math.round(Number(current.volume || 0))),
        };
      }

      if ((resolution === "1D" || resolution === "1W") && Number.isFinite(liveQuote.previousClose)) {
        const previousIndex = Math.max(0, currentIndex - 1);
        const previous = bars[previousIndex];
        const previousClose = round2(liveQuote.previousClose);
        bars[previousIndex] = {
          ...previous,
          close: previousClose,
          high: round2(Math.max(previous.high, previousClose)),
          low: round2(Math.min(previous.low, previousClose)),
        };
      }

      return {
        symbol,
        resolution,
        bars: bars.slice(-5000),
        source: "etrade-live-anchored",
        stale: false,
        dataQuality: "anchored_synthetic",
      };
    } catch (error) {
      return this.buildUnavailableBars(request, {
        source: "etrade-live-history-unavailable",
        error: error?.message || "E*Trade bars unavailable",
      });
    }
  }

  async #fetchTransactionRows(account, {
    auth,
    accountIdKey,
    startMs,
    endMs,
    maxRows = 1000,
  }) {
    const rows = [];
    const seenMarkers = new Set();
    let marker = null;

    for (let page = 0; page < TRANSACTION_MAX_PAGES; page += 1) {
      const count = Math.max(
        20,
        Math.min(TRANSACTION_PAGE_SIZE, maxRows - rows.length),
      );
      if (count <= 0) {
        break;
      }

      const queryVariants = [
        {
          startDate: formatDateIso(startMs),
          endDate: formatDateIso(endMs),
          sortOrder: "DESC",
          count: String(count),
        },
        {
          startDate: formatDateCompact(startMs),
          endDate: formatDateCompact(endMs),
          sortOrder: "DESC",
          count: String(count),
        },
      ];

      let payload = null;
      let lastError = null;
      for (const baseQuery of queryVariants) {
        const params = new URLSearchParams(baseQuery);
        if (marker != null) {
          params.set("marker", String(marker));
        }
        const url = `${auth.baseUrl}/v1/accounts/${encodeURIComponent(accountIdKey)}/transactions.json?${params.toString()}`;
        try {
          payload = await this.#requestJson(url, auth);
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!payload) {
        if (rows.length) {
          break;
        }
        throw lastError || new Error("E*Trade transaction history unavailable");
      }

      const root = payload?.TransactionListResponse || payload?.transactionListResponse || {};
      const pageRows = toArray(root?.Transaction || root?.transaction || root?.transactions || root?.items);
      if (!pageRows.length) {
        break;
      }
      rows.push(...pageRows);
      if (rows.length >= maxRows) {
        break;
      }

      const nextMarker = firstNonEmpty(
        root?.marker,
        root?.nextMarker,
        root?.nextmarker,
        root?.next,
        root?.pagination?.next,
      );
      if (!nextMarker || seenMarkers.has(String(nextMarker))) {
        break;
      }
      seenMarkers.add(String(nextMarker));
      marker = nextMarker;
    }

    return rows.slice(0, maxRows);
  }

  async #fetchLiveSpotQuote(account, symbol) {
    const auth = this.#buildAuthContext(account);
    if (!auth) {
      return null;
    }

    const normalizedSymbol = String(symbol || "SPY").trim().toUpperCase();
    const url = `${auth.baseUrl}/v1/market/quote/${encodeURIComponent(normalizedSymbol)}.json?detailFlag=ALL`;
    const payload = await this.#requestJson(url, auth);
    const quoteNode = payload?.QuoteResponse?.QuoteData?.[0] || payload?.quoteResponse?.quoteData?.[0];
    if (!quoteNode) {
      return null;
    }

    const all = quoteNode.All || quoteNode.all || quoteNode;
    const last = firstNumber(all, ["lastTrade", "lastPrice", "last"]);
    const bid = firstNumber(all, ["bid", "bidPrice", "bidPriceLate"]);
    const ask = firstNumber(all, ["ask", "askPrice", "askPriceLate"]);
    const change = firstNumber(all, ["changeClose", "netChange", "change"]);

    if (!Number.isFinite(last)) {
      return null;
    }

    return {
      symbol: normalizedSymbol,
      last: round2(last),
      bid: round2(Number.isFinite(bid) ? bid : last),
      ask: round2(Number.isFinite(ask) ? ask : last),
      open: round2(Number.isFinite(firstNumber(all, ["open", "openPrice"])) ? firstNumber(all, ["open", "openPrice"]) : last),
      high: round2(Number.isFinite(firstNumber(all, ["high", "highPrice"])) ? firstNumber(all, ["high", "highPrice"]) : Math.max(last, bid || last, ask || last)),
      low: round2(Number.isFinite(firstNumber(all, ["low", "lowPrice"])) ? firstNumber(all, ["low", "lowPrice"]) : Math.min(last, bid || last, ask || last)),
      volume: Math.max(0, Math.round(firstNumber(all, ["totalVolume", "volume"]) || 0)),
      previousClose: round2(Number.isFinite(firstNumber(all, ["previousClose", "prevClose"])) ? firstNumber(all, ["previousClose", "prevClose"]) : last - (Number.isFinite(change) ? change : 0)),
      change: round2(Number.isFinite(change) ? change : 0),
      changePct: round2(
        Number.isFinite(change)
          ? (change / Math.max(last - change, 0.01)) * 100
          : 0,
      ),
      timestamp: toIsoTimestamp(all?.dateTimeUTC || all?.dateTime || all?.quoteTimeInLong),
    };
  }

  async #fetchLiveOptionChain(account, request = {}) {
    const auth = this.#buildAuthContext(account);
    if (!auth) {
      return null;
    }

    const symbol = String(request.symbol || "SPY").trim().toUpperCase();
    const expiry = normalizeExpiry(request.expiry);
    const [year, month, day] = expiry.split("-");

    const url = `${auth.baseUrl}/v1/market/optionchains.json?symbol=${encodeURIComponent(symbol)}&expiryYear=${year}&expiryMonth=${Number(month)}&expiryDay=${Number(day)}&chainType=CALLPUT&skipAdjusted=true`;
    const payload = await this.#requestJson(url, auth);
    const root = payload?.OptionChainResponse || payload?.optionChainResponse;
    const optionPairs = root?.OptionPair || root?.optionPair || [];

    if (!Array.isArray(optionPairs) || optionPairs.length === 0) {
      return null;
    }

    const rows = [];
    for (const pair of optionPairs) {
      pushMappedOption(rows, pair?.Call || pair?.call, "call", symbol, expiry);
      pushMappedOption(rows, pair?.Put || pair?.put, "put", symbol, expiry);
    }

    if (!rows.length) {
      return null;
    }

    const quote = await this.#fetchLiveSpotQuote(account, symbol);
    const underlyingPrice = quote?.last || estimateUnderlying(rows);

    return {
      symbol,
      expiry,
      underlyingPrice: round2(underlyingPrice),
      rows: rows.sort((a, b) => {
        if (a.strike !== b.strike) {
          return a.strike - b.strike;
        }
        return a.right.localeCompare(b.right);
      }),
    };
  }

  async #fetchLivePositions(account) {
    const auth = this.#buildAuthContext(account);
    if (!auth) {
      return null;
    }

    const accountIdKey = await this.#resolveAccountIdKey(account, auth);
    if (!accountIdKey) {
      return [];
    }

    const url = `${auth.baseUrl}/v1/accounts/${encodeURIComponent(accountIdKey)}/portfolio.json?totalsRequired=true&count=200`;
    const payload = await this.#requestJson(url, auth);
    const root = payload?.PortfolioResponse || payload?.portfolioResponse || {};
    const accountPortfolio = root?.AccountPortfolio || root?.accountPortfolio || [];
    const portfolios = Array.isArray(accountPortfolio) ? accountPortfolio : [accountPortfolio];
    const positions = [];

    for (const portfolio of portfolios) {
      const rows = portfolio?.Position || portfolio?.position || [];
      const list = Array.isArray(rows) ? rows : [rows];
      for (const row of list) {
        const mapped = mapEtradePosition(row);
        if (mapped) {
          positions.push(mapped);
        }
      }
    }

    return positions;
  }

  async #resolveAccountIdKey(account, auth) {
    const preferred = String(
      account?.credentials?.ETRADE_ACCOUNT_ID_KEY
      || account?.credentials?.ETRADE_ACCOUNT_ID
      || "",
    ).trim();

    const url = `${auth.baseUrl}/v1/accounts/list.json`;
    const payload = await this.#requestJson(url, auth);
    const accountsRoot = payload?.AccountListResponse?.Accounts || payload?.accountListResponse?.accounts;
    const rows = accountsRoot?.Account || accountsRoot?.account || [];
    const list = Array.isArray(rows) ? rows : [rows];

    if (!list.length) {
      return null;
    }

    if (preferred) {
      const matched = list.find((item) =>
        String(item?.accountIdKey || "").trim() === preferred
        || String(item?.accountId || "").trim() === preferred,
      );
      if (matched?.accountIdKey) {
        return String(matched.accountIdKey).trim();
      }
    }

    const first = list.find((item) => item?.accountIdKey) || list[0];
    return first?.accountIdKey ? String(first.accountIdKey).trim() : null;
  }

  #buildAuthContext(account) {
    const credentials = account?.credentials || {};
    const consumerKey = credentials.ETRADE_PROD_KEY || credentials.ETRADE_SB_KEY;
    const consumerSecret = credentials.ETRADE_PROD_SECRET || credentials.ETRADE_SB_SECRET;
    const token = credentials.ETRADE_ACCESS_TOKEN;
    const tokenSecret = credentials.ETRADE_ACCESS_SECRET;

    if (!consumerKey || !consumerSecret || !token || !tokenSecret) {
      return null;
    }

    const usingProd = Boolean(credentials.ETRADE_PROD_KEY && credentials.ETRADE_PROD_SECRET);
    return {
      baseUrl: usingProd ? PROD_BASE_URL : SANDBOX_BASE_URL,
      consumerKey,
      consumerSecret,
      token,
      tokenSecret,
      accountId: String(account?.accountId || "").trim(),
      issuedEtDate: firstNonEmpty(
        credentials[ET_SESSION_DATE_KEY],
        credentials[ET_ISSUED_DATE_KEY],
      ),
    };
  }

  async #requestJson(url, auth, options = {}) {
    const oauthHeader = buildOAuth1Header({
      method: "GET",
      url,
      consumerKey: auth.consumerKey,
      consumerSecret: auth.consumerSecret,
      token: auth.token,
      tokenSecret: auth.tokenSecret,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: oauthHeader,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401 && options.allowRenew !== false) {
          const renewedAuth = await this.#renewAuthContext(auth);
          return this.#requestJson(url, renewedAuth, {
            ...options,
            allowRenew: false,
          });
        }
        throw new Error(`E*Trade request failed (${response.status})`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async #renewAuthContext(auth) {
    if (isLikelyExpiredByEtDate(auth?.issuedEtDate)) {
      throw new Error("E*Trade OAuth session expired after the ET day rollover; log in again for a new token.");
    }

    const result = await renewEtradeAccessToken({
      consumerKey: auth.consumerKey,
      consumerSecret: auth.consumerSecret,
      useSandbox: auth.baseUrl === SANDBOX_BASE_URL,
      accessToken: auth.token,
      accessSecret: auth.tokenSecret,
    });

    if (auth.accountId) {
      await this.store.upsertAccount({
        accountId: auth.accountId,
        broker: "etrade",
        credentials: {
          ETRADE_OAUTH_LAST_RENEWED_AT: result.renewedAt,
          [ET_SESSION_DATE_KEY]: result.etradeSessionDate,
          [ET_ISSUED_DATE_KEY]: result.etradeSessionDate,
        },
      });
      this.authStatusCache.delete(auth.accountId);
    }

    return {
      ...auth,
      issuedEtDate: result.etradeSessionDate,
    };
  }
}

function resolveHistoryWindow(request = {}, options = {}) {
  const endMs = toEpochMs(request?.to) || Date.now();
  const maxDays = clampNumber(
    options?.maxDays,
    1,
    3650,
    3650,
  );
  const defaultDays = clampNumber(
    options?.defaultDays,
    1,
    maxDays,
    Math.min(3650, maxDays),
  );
  const requestedDays = clampNumber(request?.days, 1, maxDays, defaultDays);
  const startMs = toEpochMs(request?.from) || (endMs - requestedDays * 24 * 60 * 60 * 1000);
  const clampedStartMs = Math.max(startMs, endMs - maxDays * 24 * 60 * 60 * 1000);
  return {
    startMs: clampedStartMs,
    endMs,
  };
}

function mapEtradeTransactionLedger(rows, { accountId } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const ledger = safeRows
    .map((row, index) => {
      const epochMs = parseTransactionEpochMs(row);
      const amount = parseTransactionAmount(row);
      if (!Number.isFinite(epochMs) || !Number.isFinite(amount)) {
        return null;
      }
      const normalizedAccountId = String(
        firstNonEmpty(
          row?.accountId,
          row?.accountID,
          row?.accountNo,
          accountId,
          "etrade-account",
        ),
      );
      const transactionId = String(
        firstNonEmpty(
          row?.transactionId,
          row?.transactionID,
          row?.id,
          `${normalizedAccountId}:${Math.round(epochMs)}:${index}`,
        ),
      );
      const typeLabel = String(
        firstNonEmpty(
          row?.transactionType,
          row?.type,
          row?.description,
          row?.memo,
          "transaction",
        ),
      ).toLowerCase();
      const symbol = parseTransactionSymbol(row);
      return {
        id: `etrade-ledger-${transactionId}`,
        accountId: normalizedAccountId,
        ts: new Date(Math.round(epochMs)).toISOString(),
        epochMs: Math.round(epochMs),
        amount: round2(amount),
        realizedNet: round2(amount),
        equityDelta: round2(amount),
        unrealizedDelta: null,
        balance: null,
        type: amount >= 0 ? "credit" : "debit",
        category: typeLabel,
        symbol: symbol || "MULTI",
        confidence: "exact",
        source: "etrade-transactions",
      };
    })
    .filter(Boolean);
  ledger.sort((a, b) => Number(b.epochMs) - Number(a.epochMs));
  return ledger;
}

function mapEtradeTransactionClosedTrades(rows, { accountId } = {}) {
  const ledger = mapEtradeTransactionLedger(rows, { accountId });
  const trades = ledger
    .filter((row) => isLikelyTradeTransaction(row?.category))
    .filter((row) => Math.abs(Number(row?.realizedNet || 0)) >= 0.01)
    .map((row, index) => ({
      tradeId: `etrade-trade-${row.id}-${index}`,
      accountId: row.accountId,
      symbol: row.symbol || "MULTI",
      side: Number(row.realizedNet) >= 0 ? "credit" : "debit",
      qty: null,
      openedAt: null,
      closedAt: row.ts,
      realizedNet: row.realizedNet,
      fees: 0,
      confidence: "derived",
      source: "etrade-transactions",
    }));
  trades.sort((a, b) => Date.parse(b.closedAt || 0) - Date.parse(a.closedAt || 0));
  return trades;
}

function buildEtradeEquityCurveFromLedger(ledgerRows, {
  endMs,
  endEquity,
} = {}) {
  const rows = (Array.isArray(ledgerRows) ? ledgerRows : [])
    .filter((row) => Number.isFinite(Number(row?.epochMs)) && Number.isFinite(Number(row?.amount)))
    .sort((a, b) => Number(a.epochMs) - Number(b.epochMs));

  if (!rows.length) {
    return [];
  }

  const netAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const baseline = Number.isFinite(Number(endEquity))
    ? Number(endEquity) - netAmount
    : 0;

  const points = [];
  let equity = baseline;
  for (const row of rows) {
    equity += Number(row.amount || 0);
    points.push({
      ts: new Date(Math.round(row.epochMs)).toISOString(),
      epochMs: Math.round(Number(row.epochMs)),
      equity: round2(equity),
      source: "etrade-transactions",
      stale: false,
    });
  }

  if (Number.isFinite(Number(endEquity))) {
    const nowMs = Number.isFinite(Number(endMs)) ? Math.round(Number(endMs)) : Date.now();
    const tail = points[points.length - 1];
    if (!tail || Number(tail.epochMs) !== nowMs) {
      points.push({
        ts: new Date(nowMs).toISOString(),
        epochMs: nowMs,
        equity: round2(Number(endEquity)),
        source: "etrade-live-summary",
        stale: false,
      });
    } else {
      tail.equity = round2(Number(endEquity));
      tail.source = "etrade-live-summary";
      tail.stale = false;
    }
  }

  return dedupeHistoryByEpoch(points);
}

function parseTransactionEpochMs(row) {
  return toEpochMs(
    firstNonEmpty(
      row?.transactionDate,
      row?.settlementDate,
      row?.postDate,
      row?.date,
      row?.transactionTime,
      row?.time,
      row?.timestamp,
    ),
  );
}

function parseTransactionAmount(row) {
  const brokerage = row?.brokerage || row?.Brokerage || {};
  return firstFiniteNumber(
    firstNumber(row, [
      "amount",
      "netAmount",
      "transactionAmount",
      "cashAmount",
      "displayAmount",
      "totalAmount",
      "total",
    ]),
    firstNumber(brokerage, [
      "amount",
      "netAmount",
      "transactionAmount",
      "cashAmount",
      "totalAmount",
    ]),
  );
}

function parseTransactionSymbol(row) {
  const brokerage = row?.brokerage || row?.Brokerage || {};
  const product = brokerage?.product || brokerage?.Product || {};
  const symbol = normalizeEtradeSymbol(firstNonEmpty(
    row?.symbol,
    row?.displaySymbol,
    row?.security?.symbol,
    product?.symbol,
    product?.displaySymbol,
    "",
  ));
  return symbol || null;
}

function isLikelyTradeTransaction(value) {
  const text = String(value || "").toLowerCase();
  if (!text) {
    return false;
  }
  return (
    text.includes("trade")
    || text.includes("buy")
    || text.includes("sell")
    || text.includes("option")
    || text.includes("exercise")
    || text.includes("assignment")
    || text.includes("expire")
    || text.includes("realized")
  );
}

function dedupeHistoryByEpoch(rows) {
  const latestByEpoch = new Map();
  for (const row of rows || []) {
    const epochMs = Number(row?.epochMs);
    if (!Number.isFinite(epochMs)) {
      continue;
    }
    latestByEpoch.set(Math.round(epochMs), {
      ...(row || {}),
      epochMs: Math.round(epochMs),
      ts: row?.ts ? String(row.ts) : new Date(Math.round(epochMs)).toISOString(),
    });
  }
  const out = [...latestByEpoch.values()].sort((a, b) => Number(a.epochMs) - Number(b.epochMs));
  return out;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value == null ? [] : [value];
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
    return null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 100000000000 ? Math.round(numeric) : Math.round(numeric * 1000);
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.getTime();
}

function formatDateIso(value) {
  const epochMs = toEpochMs(value);
  if (!Number.isFinite(epochMs)) {
    return "";
  }
  return new Date(epochMs).toISOString().slice(0, 10);
}

function formatDateCompact(value) {
  const epochMs = toEpochMs(value);
  if (!Number.isFinite(epochMs)) {
    return "";
  }
  const iso = new Date(epochMs).toISOString().slice(0, 10);
  const [year, month, day] = iso.split("-");
  return `${month}${day}${year}`;
}

function normalizeExpiry(expiry) {
  const value = String(expiry || "").trim();
  if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return value;
  }

  const fallback = new Date();
  fallback.setUTCDate(fallback.getUTCDate() + 30);
  return fallback.toISOString().slice(0, 10);
}

function normalizeResolution(value) {
  const raw = String(value || "5").trim().toUpperCase();
  if (raw === "D" || raw === "1D") {
    return "1D";
  }
  if (raw === "W" || raw === "1W") {
    return "1W";
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return String(Math.round(numeric));
  }
  return "5";
}

function resolutionToMs(resolution) {
  if (resolution === "1D") {
    return 86400000;
  }
  if (resolution === "1W") {
    return 7 * 86400000;
  }
  const minutes = Number(resolution);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 5 * 60000;
  }
  return Math.max(1, Math.round(minutes)) * 60000;
}

function alignToInterval(timestampMs, intervalMs) {
  return Math.floor(timestampMs / intervalMs) * intervalMs;
}

function toIsoTimestamp(value) {
  if (value == null || value === "") {
    return new Date().toISOString();
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const ms = numeric > 100000000000 ? numeric : numeric * 1000;
    return new Date(ms).toISOString();
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return new Date().toISOString();
}

function pushMappedOption(target, node, right, symbol, expiry) {
  if (!node || typeof node !== "object") {
    return;
  }

  const strike = firstNumber(node, ["strikePrice", "strike"]);
  if (!Number.isFinite(strike)) {
    return;
  }

  const bid = firstNumber(node, ["bid", "bidPrice"]);
  const ask = firstNumber(node, ["ask", "askPrice"]);
  const last = firstNumber(node, ["lastPrice", "last"]) || average2(bid, ask) || 0;
  const greeks = node.OptionGreeks || node.optionGreeks || {};

  target.push({
    contractId: `${symbol}-${expiry}-${stripZeros(strike)}-${right}`,
    symbol,
    expiry,
    strike: round2(strike),
    right,
    bid: round2(Number.isFinite(bid) ? bid : last),
    ask: round2(Number.isFinite(ask) ? ask : last),
    last: round2(last),
    mark: round2(average2(bid, ask) || last),
    iv: round4(firstNumber(greeks, ["iv", "impliedVolatility", "currentValue"]) || 0.2),
    delta: round4(firstNumber(greeks, ["delta"]) || 0),
    gamma: round4(firstNumber(greeks, ["gamma"]) || 0),
    theta: round4(firstNumber(greeks, ["theta"]) || 0),
    vega: round4(firstNumber(greeks, ["vega"]) || 0),
    oi: Math.max(0, Math.round(firstNumber(node, ["openInterest", "oi"]) || 0)),
    volume: Math.max(0, Math.round(firstNumber(node, ["volume", "totalVolume"]) || 0)),
    moneyness: 0,
    updatedAt: new Date().toISOString(),
  });
}

function mapEtradePosition(node) {
  if (!node || typeof node !== "object") {
    return null;
  }

  const product = node.Product || node.product || {};
  const quantityRaw = firstNumber(node, [
    "quantity",
    "qty",
    "positionQuantity",
    "positionQty",
  ]);
  if (!Number.isFinite(quantityRaw) || quantityRaw === 0) {
    return null;
  }

  const securityType = String(product?.securityType || node?.securityType || "").toLowerCase();
  const side = quantityRaw < 0 ? "short" : "long";
  const qty = Math.abs(Number(quantityRaw));
  const symbol = normalizeEtradeSymbol(
    product?.symbol
      || node?.symbol
      || node?.symbolDescription
      || node?.description
      || "",
  );
  if (!symbol) {
    return null;
  }
  const parsedOption = mapEtradeOptionNode(node, product, symbol);
  const isOption = securityType.includes("opt") || Boolean(parsedOption);
  const multiplier = isOption ? 100 : 1;

  const avgFromCostBasis = firstNumber(node, ["costBasis", "costBasisMoney"]);
  const averagePrice = firstNumber(node, [
    "pricePaid",
    "averagePrice",
    "avgPrice",
    "costPerShare",
  ]) ?? (
    Number.isFinite(avgFromCostBasis)
      ? avgFromCostBasis / Math.max(qty * multiplier, 1)
      : 0
  );

  const markPrice = firstNumber(node, [
    "marketPrice",
    "currentPrice",
    "lastPrice",
    "lastTrade",
    "bid",
    "ask",
  ]) ?? averagePrice;

  const marketValue = firstNumber(node, [
    "marketValue",
    "marketValueBase",
    "marketValueDollars",
  ]) ?? (markPrice * qty * multiplier);

  const impliedPnl = (markPrice - averagePrice) * qty * multiplier * (side === "long" ? 1 : -1);
  const unrealizedPnl = firstNumber(node, [
    "totalGain",
    "gain",
    "unrealizedPnl",
    "unrealizedGain",
  ]) ?? impliedPnl;

  const option = isOption ? parsedOption : null;
  const positionId = String(
    node.positionId
      || node.positionID
      || node.id
      || `${symbol}-${option?.expiry || "na"}-${option?.strike || "na"}-${option?.right || side}`,
  );

  return {
    positionId: `etrade-${positionId}`,
    symbol,
    assetType: isOption ? "option" : "equity",
    side,
    qty,
    averagePrice: round2(averagePrice),
    markPrice: round2(markPrice),
    marketValue: round2(marketValue),
    unrealizedPnl: round2(unrealizedPnl),
    currency: String(node.currency || "USD").toUpperCase(),
    option,
  };
}

function mapEtradeOptionNode(node, product, fallbackSymbol) {
  const source = node?.option || product || node;
  const parsedFromText = parseEtradeOptionFromText(
    firstNonEmpty(
      source?.symbolDescription,
      node?.symbolDescription,
      source?.description,
      node?.description,
      source?.osiKey,
      source?.optionRootSymbol,
    ),
  );

  const strike = firstFiniteNumber(
    firstNumber(source, ["strikePrice", "strike"]),
    parsedFromText?.strike,
  );
  const year = firstFiniteNumber(
    firstNumber(source, ["expiryYear", "expirationYear"]),
    parsedFromText?.year,
  );
  const month = firstFiniteNumber(
    firstNumber(source, ["expiryMonth", "expirationMonth"]),
    parsedFromText?.month,
  );
  const day = firstFiniteNumber(
    firstNumber(source, ["expiryDay", "expirationDay"]),
    parsedFromText?.day,
  );
  const rightRaw = String(firstNonEmpty(
    source?.callPut
      || source?.putCall
      || source?.optionType,
    parsedFromText?.right,
    "",
  )).toLowerCase();
  const right = rightRaw.startsWith("c")
    ? "call"
    : rightRaw.startsWith("p")
      ? "put"
      : null;
  const expiry = year && month && day
    ? `${Math.round(year)}-${String(Math.round(month)).padStart(2, "0")}-${String(Math.round(day)).padStart(2, "0")}`
    : null;

  if (!Number.isFinite(strike) || !right || !expiry) {
    return null;
  }

  return {
    symbol: normalizeEtradeSymbol(
      source?.symbol
      || parsedFromText?.symbol
      || fallbackSymbol
      || "",
    ),
    expiry,
    strike: round2(strike),
    right,
  };
}

function parseEtradeOptionFromText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const primary = text.match(
    /^([A-Z.]+)\s+([A-Z]{3})\s+(\d{1,2})\s+'?(\d{2,4})\s+\$?(\d+(?:\.\d+)?)\s+(CALL|PUT)\b/i,
  );
  if (!primary) {
    return null;
  }

  const symbol = primary[1].toUpperCase();
  const monthToken = primary[2].toUpperCase();
  const month = monthFromName(monthToken);
  const day = Number(primary[3]);
  let year = Number(primary[4]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (year < 100) {
    year += 2000;
  }
  const strike = Number(primary[5]);
  const right = primary[6].toLowerCase();
  if (!Number.isFinite(strike)) {
    return null;
  }

  return {
    symbol,
    year,
    month,
    day,
    strike,
    right,
  };
}

function monthFromName(value) {
  const text = String(value || "").slice(0, 3).toUpperCase();
  const months = {
    JAN: 1,
    FEB: 2,
    MAR: 3,
    APR: 4,
    MAY: 5,
    JUN: 6,
    JUL: 7,
    AUG: 8,
    SEP: 9,
    OCT: 10,
    NOV: 11,
    DEC: 12,
  };
  return months[text] || NaN;
}

function normalizeEtradeSymbol(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) {
    return "";
  }
  const token = text.split(/\s+/)[0] || "";
  return token.replace(/[^A-Z0-9.]/g, "");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) {
      continue;
    }
    const text = String(value).trim();
    if (text) {
      return text;
    }
  }
  return null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function combineNumbers(a, b) {
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return Number(a) + Number(b);
  }
  return null;
}

function nearestStrikeIndex(rows, underlyingPrice) {
  if (!rows.length) {
    return 0;
  }

  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < rows.length; index += 1) {
    const distance = Math.abs(rows[index].strike - underlyingPrice);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function estimateUnderlying(rows) {
  const calls = rows.filter((row) => row.right === "call");
  if (!calls.length) {
    return rows[0]?.strike || 100;
  }

  return calls.reduce((sum, row) => sum + row.strike, 0) / calls.length;
}

function firstNumber(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function average2(a, b) {
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return (a + b) / 2;
  }
  if (Number.isFinite(a)) {
    return a;
  }
  if (Number.isFinite(b)) {
    return b;
  }
  return null;
}

function stripZeros(value) {
  return Number(value).toString();
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function isEtradeUnauthorizedError(error) {
  const message = String(error?.message || "").toLowerCase();
  return Number(error?.status) === 401
    || /\(401\)/.test(message)
    || message.includes("http status 401")
    || message.includes("unauthorized")
    || message.includes("oauth_problem=token_rejected");
}

function hasCredential(value) {
  return value != null && String(value).trim() !== "";
}
