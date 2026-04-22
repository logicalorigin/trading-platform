import http from "node:http";
import https from "node:https";

import { buildOrderPreview } from "../services/orderValidation.js";
import { BrokerAdapter } from "./BrokerAdapter.js";

const REQUEST_TIMEOUT_MS = 7000;
const QUOTE_RETRY_DELAY_MS = 150;
const MAX_REPLY_CONFIRMATIONS = 6;
const IBKR_OPTION_SNAPSHOT_BATCH_SIZE = 60;
const CONID_CACHE = new Map();
const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const IBKR_MONTH_CODES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

export class IbkrAdapter extends BrokerAdapter {
  constructor(store) {
    super(store, "ibkr", {
      requiredCredentialKeys: ["IBKR_BASE_URL"],
      defaultCommission: 0.25,
      capabilities: {
        marketData: true,
        optionChain: true,
        optionLadder: true,
        orderSubmit: true,
        orderLifecycleRead: true,
        orderCancel: false,
        orderReplace: false,
        liveOptionExecution: true,
        syntheticOrderFill: true,
      },
    });
  }

  async connect(account, credentials = {}) {
    this.#applyTlsPreference(credentials);
    const baseUrl = normalizeBaseUrl(credentials.IBKR_BASE_URL);

    let accountCode = sanitizeAccountCode(credentials.IBKR_ACCOUNT_ID);
    if (!accountCode) {
      try {
        accountCode = await this.#discoverAccountCode(baseUrl);
        if (accountCode) {
          await this.#persistAccountCode(account, accountCode);
        }
      } catch {
        // Keep connect resilient when auth/session is not active yet.
      }
    }

    return {
      status: "connected",
      message: accountCode
        ? `IBKR gateway configured (${accountCode})`
        : "IBKR gateway configured (account code will auto-detect after login)",
    };
  }

  async getAuthStatus(account) {
    this.#applyTlsPreference(account);
    return this.#probeAuthState(account, {
      attemptSsohInit: false,
      discoverAccount: true,
    });
  }

  async refreshAuthSession(account) {
    this.#applyTlsPreference(account);
    return this.#probeAuthState(account, {
      attemptSsohInit: true,
      discoverAccount: true,
    });
  }

  supportsNativeLiveExecution(_account = null, _order = null) {
    return true;
  }

  async getPositions(account) {
    this.#applyTlsPreference(account);
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
    this.#applyTlsPreference(account);
    const fallback = await super.getAccountSummary(account);

    try {
      const auth = await this.#probeAuthState(account, {
        attemptSsohInit: false,
        discoverAccount: true,
      });
      if (auth.state !== "authenticated") {
        return fallback;
      }

      const baseUrl = normalizeBaseUrl(account.credentials?.IBKR_BASE_URL);
      const accountCode = await this.#resolveAccountCode(account, {
        baseUrl,
        required: false,
      });
      if (!accountCode) {
        return fallback;
      }

      await this.#primeBrokerageSession(account, {
        baseUrl,
        accountCode,
      });

      const [summaryPayload, positions] = await Promise.all([
        this.#requestJson(
          `${baseUrl}/v1/api/portfolio/${encodeURIComponent(accountCode)}/summary`,
        ).catch(() => null),
        this.#fetchLivePositions(account).catch(() => []),
      ]);

      const safePositions = Array.isArray(positions) ? positions : [];
      const marketValue = safePositions.reduce(
        (total, row) => total + Number(row.marketValue || 0),
        0,
      );
      const unrealizedPnl = safePositions.reduce(
        (total, row) => total + Number(row.unrealizedPnl || 0),
        0,
      );
      const equity = firstFiniteNumber(
        readIbkrSummaryValue(summaryPayload, [
          "netliquidation",
          "equitywithloanvalue",
          "net_liquidation",
        ]),
        fallback?.equity,
        marketValue + readIbkrSummaryValue(summaryPayload, ["totalcashvalue", "cashbalance", "settledcash"]),
      );
      const buyingPower = firstFiniteNumber(
        readIbkrSummaryValue(summaryPayload, [
          "buyingpower",
          "availablefunds",
          "availablefunds-c",
          "cashavailableforwithdrawal",
        ]),
        fallback?.buyingPower,
      );
      const cash = firstFiniteNumber(
        readIbkrSummaryValue(summaryPayload, [
          "totalcashvalue",
          "cashbalance",
          "settledcash",
          "cash",
        ]),
        fallback?.cash,
        fallback?.buyingPower,
      );
      const settledCash = firstFiniteNumber(
        readIbkrSummaryValue(summaryPayload, ["settledcash"]),
        cash,
      );
      const unsettledCash = firstFiniteNumber(
        readIbkrSummaryValue(summaryPayload, ["unsettledcash"]),
        Number.isFinite(cash) && Number.isFinite(settledCash)
          ? Number(cash) - Number(settledCash)
          : null,
      );
      const cashAvailableToTrade = firstFiniteNumber(
        readIbkrSummaryValue(summaryPayload, [
          "availablefunds",
          "availablefunds-c",
          "cashavailablefortrading",
        ]),
        buyingPower,
        cash,
      );
      const cashAvailableToWithdraw = firstFiniteNumber(
        readIbkrSummaryValue(summaryPayload, [
          "cashavailableforwithdrawal",
          "availableforwithdrawal",
        ]),
        settledCash,
        cash,
      );
      const marginAvailable = firstFiniteNumber(
        readIbkrSummaryValue(summaryPayload, ["excessliquidity", "excessLiquidity"]),
        Number.isFinite(buyingPower) && Number.isFinite(cashAvailableToTrade)
          ? Math.max(0, Number(buyingPower) - Number(cashAvailableToTrade))
          : null,
      );

      return {
        accountId: account.accountId,
        marketValue: round2(marketValue),
        unrealizedPnl: round2(unrealizedPnl),
        equity: round2(Number.isFinite(equity) ? equity : 0),
        buyingPower: round2(Math.max(0, Number.isFinite(buyingPower) ? buyingPower : 0)),
        cash: round2(Math.max(0, Number.isFinite(cash) ? cash : 0)),
        settledCash: Number.isFinite(settledCash) ? round2(Math.max(0, settledCash)) : null,
        unsettledCash: Number.isFinite(unsettledCash) ? round2(Math.max(0, unsettledCash)) : null,
        cashAvailableToTrade: Number.isFinite(cashAvailableToTrade) ? round2(Math.max(0, cashAvailableToTrade)) : null,
        cashAvailableToWithdraw: Number.isFinite(cashAvailableToWithdraw) ? round2(Math.max(0, cashAvailableToWithdraw)) : null,
        marginAvailable: Number.isFinite(marginAvailable) ? round2(Math.max(0, marginAvailable)) : null,
        positions: safePositions.length,
        lastSync: new Date().toISOString(),
        source: "ibkr-live-summary",
        stale: false,
      };
    } catch {
      return fallback;
    }
  }

  async getSpotQuote(account, symbol) {
    this.#applyTlsPreference(account);
    try {
      const live = await this.#fetchLiveSpotQuote(account, symbol);
      if (live) {
        return {
          ...live,
          source: "ibkr-live",
          stale: false,
        };
      }
    } catch (error) {
      return this.buildUnavailableSpotQuote(symbol, {
        source: "ibkr-live-unavailable",
        error: error?.message || "IBKR live quote unavailable",
      });
    }
  }

  async getOptionChain(account, request = {}) {
    this.#applyTlsPreference(account);
    const symbol = String(request.symbol || "SPY").trim().toUpperCase();
    const expiry = normalizeExpiry(request.expiry);
    let liveQuote = null;

    try {
      liveQuote = await this.#fetchLiveSpotQuote(account, symbol);
    } catch {
      // Keep option-chain lookup resilient when underlying quote is unavailable.
    }

    try {
      const contracts = await this.#fetchLiveOptionContracts(account, {
        symbol,
        expiry,
      });
      if (!contracts.length) {
        return {
          symbol,
          expiry,
          underlyingPrice: Number.isFinite(Number(liveQuote?.last))
            ? round2(Number(liveQuote.last))
            : null,
          rows: [],
          source: "ibkr-live-options-unavailable",
          stale: true,
        };
      }

      const snapshotByConid = await this.#fetchLiveOptionSnapshots(
        account,
        contracts.map((row) => row?.conid).filter(Boolean),
      );
      const rowMap = new Map();
      for (const contract of contracts) {
        const mapped = mapIbkrOptionChainRow(
          contract,
          contract?.conid ? snapshotByConid.get(String(contract.conid)) : null,
        );
        if (!mapped) {
          continue;
        }
        rowMap.set(mapped.contractId, mapped);
      }
      const rows = [...rowMap.values()].sort(compareOptionRows);
      const pricedRows = rows.filter(hasOptionQuoteValues);
      const resolvedExpiry = rows[0]?.expiry || expiry;

      return {
        symbol,
        expiry: resolvedExpiry,
        underlyingPrice: Number.isFinite(Number(liveQuote?.last))
          ? round2(Number(liveQuote.last))
          : null,
        rows,
        source: pricedRows.length > 0
          ? "ibkr-live-options"
          : "ibkr-live-options-contracts",
        stale: pricedRows.length === 0,
      };
    } catch (error) {
      return {
        symbol,
        expiry,
        underlyingPrice: Number.isFinite(Number(liveQuote?.last))
          ? round2(Number(liveQuote.last))
          : null,
        rows: [],
        source: "ibkr-live-options-unavailable",
        stale: true,
        error: error?.message || null,
      };
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
    this.#applyTlsPreference(account);
    const symbol = String(request.symbol || "SPY").trim().toUpperCase();
    const resolution = normalizeResolution(request.resolution);

    try {
      const conid = await this.#resolveUnderlyingConid(account, symbol);
      if (!conid) {
        throw new Error(`IBKR conid not found for ${symbol}`);
      }

      const period = resolveIbkrPeriod({
        from: request.from,
        to: request.to,
        countBack: request.countBack,
        resolution,
      });
      const bar = mapIbkrBarSize(resolution);
      const endTime = formatIbkrDateTimeFromEpoch(request.to);
      const baseUrl = normalizeBaseUrl(account.credentials?.IBKR_BASE_URL);
      const query = new URLSearchParams({
        conid: String(conid),
        exchange: "SMART",
        period,
        bar,
        outsideRth: "true",
        source: "trades",
      });
      if (endTime) {
        query.set("startTime", endTime);
      }

      const url = `${baseUrl}/v1/api/iserver/marketdata/history?${query.toString()}`;
      const payload = await this.#requestJson(url);
      const rawBars = Array.isArray(payload?.data) ? payload.data : [];
      if (!rawBars.length) {
        throw new Error("IBKR history returned no bars");
      }

      const fromSec = parseEpochSeconds(request.from);
      const toSec = parseEpochSeconds(request.to);
      const countBackRaw = Number(request.countBack);
      const countBack = Number.isFinite(countBackRaw)
        ? Math.max(1, Math.min(5000, Math.round(countBackRaw)))
        : null;

      let bars = rawBars
        .map((row) => ({
          time: parseBarTimeMs(row?.t),
          open: round2(Number(row?.o)),
          high: round2(Number(row?.h)),
          low: round2(Number(row?.l)),
          close: round2(Number(row?.c)),
          volume: Math.max(0, Math.round(Number(row?.v || 0))),
        }))
        .filter(
          (bar) =>
            Number.isFinite(bar.time)
            && Number.isFinite(bar.open)
            && Number.isFinite(bar.high)
            && Number.isFinite(bar.low)
            && Number.isFinite(bar.close),
        )
        .sort((a, b) => a.time - b.time);

      if (Number.isFinite(fromSec)) {
        bars = bars.filter((bar) => bar.time >= fromSec * 1000);
      }
      if (Number.isFinite(toSec)) {
        bars = bars.filter((bar) => bar.time <= toSec * 1000);
      }
      if (countBack && bars.length > countBack) {
        bars = bars.slice(-countBack);
      }

      if (!bars.length) {
        throw new Error("IBKR bars filtered to empty result");
      }

      return {
        symbol,
        resolution,
        bars,
        source: "ibkr-live-history",
        stale: false,
        dataQuality: "historical_native",
      };
    } catch (error) {
      return this.buildUnavailableBars(request, {
        source: "ibkr-live-history-unavailable",
        error: error?.message || "IBKR bars unavailable",
      });
    }
  }

  async placeOrder(account, order) {
    this.#applyTlsPreference(account);
    if (String(order.executionMode || "live").toLowerCase() !== "live") {
      return super.placeOrder(account, order);
    }

    const baseUrl = normalizeBaseUrl(account.credentials?.IBKR_BASE_URL);
    const auth = await this.#probeAuthState(account, {
      attemptSsohInit: false,
      discoverAccount: true,
    });
    if (auth.state !== "authenticated") {
      throw new Error(auth.message || "IBKR session is not authenticated");
    }

    const accountCode = await this.#resolveAccountCode(account, {
      baseUrl,
      required: true,
    });

    await this.#primeBrokerageSession(account, {
      baseUrl,
      accountCode,
    });

    const conid = await this.#resolveOrderConid(account, order);
    if (!conid) {
      throw new Error(`IBKR conid not found for ${order.symbol}`);
    }

    const ibOrder = {
      acctId: accountCode,
      conid: Number(conid),
      orderType: order.orderType === "limit" ? "LMT" : "MKT",
      side: String(order.side || "BUY").toUpperCase(),
      tif: normalizeIbkrTif(order.timeInForce),
      quantity: Number(order.quantity),
      outsideRTH: false,
      cOID: `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      referrer: "workspace",
    };

    if (order.orderType === "limit") {
      ibOrder.price = round2(Number(order.limitPrice));
    }

    const submitPayload = await this.#requestJson(
      `${baseUrl}/v1/api/iserver/account/${encodeURIComponent(accountCode)}/orders`,
      {
        method: "POST",
        body: {
          orders: [ibOrder],
        },
      },
    );

    const resolvedPayload = await this.#resolveIbkrOrderFlow(baseUrl, submitPayload);
    const rows = extractIbkrOrderRows(resolvedPayload);
    const firstRow = rows[0] || {};

    const ibOrderId = String(
      firstRow.order_id
      || firstRow.orderId
      || firstRow.id
      || `ibkr-${Date.now()}`,
    );
    const status = normalizeIbkrOrderStatus(firstRow.order_status || firstRow.status || "submitted");
    const preview = buildOrderPreview(order, this.defaultCommission);

    const result = {
      orderId: `ibkr-${ibOrderId}`,
      accountId: account.accountId,
      broker: "ibkr",
      status,
      filledAt: status === "filled" ? new Date().toISOString() : null,
      executionMode: "live",
      order,
      fill: status === "filled"
        ? {
          price: order.orderType === "limit"
            ? round2(Number(order.limitPrice))
            : preview.unitPrice,
          quantity: order.quantity,
          estimatedFees: preview.estimatedFees,
        }
        : null,
      preview,
      ibkr: {
        accountCode,
        orderId: ibOrderId,
        status,
        message: extractIbkrMessage(firstRow) || extractIbkrMessage(resolvedPayload) || null,
      },
      updatedAt: new Date().toISOString(),
    };

    await this.store.recordOrder(result);

    try {
      const livePositions = await this.#fetchLivePositions(account);
      if (Array.isArray(livePositions)) {
        await this.store.setPositions(account.accountId, livePositions);
      }
    } catch {
      // Live order status remains available even when immediate position sync fails.
    }

    return result;
  }

  async #fetchLiveSpotQuote(account, symbol) {
    const normalized = String(symbol || "SPY").trim().toUpperCase();
    const conid = await this.#resolveUnderlyingConid(account, normalized);
    if (!conid) {
      return null;
    }

    const baseUrl = normalizeBaseUrl(account.credentials?.IBKR_BASE_URL);
    const fields = "31,84,86,7289";
    const url = `${baseUrl}/v1/api/iserver/marketdata/snapshot?conids=${encodeURIComponent(conid)}&fields=${encodeURIComponent(fields)}`;

    // IBKR snapshot often needs one request to open the stream before values populate.
    let payload = await this.#requestJson(url);
    let row = Array.isArray(payload) ? payload[0] : payload?.[0] || payload;
    let last = parseIbmNumber(row, ["31", "last", "last_price"]);

    if (!Number.isFinite(last)) {
      await delay(QUOTE_RETRY_DELAY_MS);
      payload = await this.#requestJson(url);
      row = Array.isArray(payload) ? payload[0] : payload?.[0] || payload;
      last = parseIbmNumber(row, ["31", "last", "last_price"]);
    }

    const bid = parseIbmNumber(row, ["84", "bid", "bid_price"]);
    const ask = parseIbmNumber(row, ["86", "ask", "ask_price"]);
    const changePct = parseIbmNumber(row, ["7289", "changePercent"]);

    if (!Number.isFinite(last)) {
      return null;
    }

    return {
      symbol: normalized,
      last: round2(last),
      bid: round2(Number.isFinite(bid) ? bid : last),
      ask: round2(Number.isFinite(ask) ? ask : last),
      change: round2(Number.isFinite(changePct) ? (changePct / 100) * last : 0),
      changePct: round2(Number.isFinite(changePct) ? changePct : 0),
      timestamp: new Date().toISOString(),
    };
  }

  async #fetchLiveOptionContracts(account, request = {}) {
    const symbol = String(request.symbol || "SPY").trim().toUpperCase();
    const expiry = normalizeExpiry(request.expiry);
    const targetExpiry = normalizeExpiryToken(expiry);
    const underlyingConid = await this.#resolveUnderlyingConid(account, symbol);
    if (!underlyingConid) {
      return [];
    }

    const month = formatIbkrMonthFromExpiry(expiry);
    const [callContracts, putContracts] = await Promise.all([
      this.#fetchSecdefInfoContracts(account, {
        underlyingConid,
        month,
        right: "C",
      }).catch(() => []),
      this.#fetchSecdefInfoContracts(account, {
        underlyingConid,
        month,
        right: "P",
      }).catch(() => []),
    ]);

    const contractMap = new Map();
    for (const row of [...callContracts, ...putContracts]) {
      const contract = mapIbkrOptionSecdefContractRow(row, { symbol, expiry });
      if (!contract) {
        continue;
      }
      if (targetExpiry && normalizeExpiryToken(contract.expiry) !== targetExpiry) {
        continue;
      }
      contractMap.set(contract.contractId, contract);
    }
    if (contractMap.size > 0) {
      return [...contractMap.values()].sort(compareOptionRows);
    }

    const strikeMap = await this.#fetchLiveOptionStrikeMap(account, symbol, expiry).catch(() => ({
      call: [],
      put: [],
    }));
    const fallback = [];
    for (const strike of strikeMap.call || []) {
      fallback.push(
        mapIbkrOptionSecdefContractRow(
          {
            symbol,
            strike,
            right: "C",
            expiry,
          },
          { symbol, expiry },
        ),
      );
    }
    for (const strike of strikeMap.put || []) {
      fallback.push(
        mapIbkrOptionSecdefContractRow(
          {
            symbol,
            strike,
            right: "P",
            expiry,
          },
          { symbol, expiry },
        ),
      );
    }

    return fallback.filter(Boolean).sort(compareOptionRows);
  }

  async #fetchSecdefInfoContracts(account, request = {}) {
    const baseUrl = normalizeBaseUrl(account.credentials?.IBKR_BASE_URL);
    const query = new URLSearchParams({
      conid: String(request.underlyingConid || ""),
      secType: "OPT",
      month: String(request.month || ""),
      right: String(request.right || "").toUpperCase(),
    });
    const payload = await this.#requestJson(
      `${baseUrl}/v1/api/iserver/secdef/info?${query.toString()}`,
    );
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload?.data)) {
      return payload.data;
    }
    return [];
  }

  async #fetchLiveOptionStrikeMap(account, symbol, expiry) {
    const conid = await this.#resolveUnderlyingConid(account, symbol);
    if (!conid) {
      return { call: [], put: [] };
    }

    const baseUrl = normalizeBaseUrl(account.credentials?.IBKR_BASE_URL);
    const month = formatIbkrMonthFromExpiry(expiry);
    const url = `${baseUrl}/v1/api/iserver/secdef/strikes?conid=${encodeURIComponent(conid)}&secType=OPT&month=${encodeURIComponent(month)}`;
    const payload = await this.#requestJson(url);

    const callStrikes = [
      ...(Array.isArray(payload?.call) ? payload.call : []),
      ...(Array.isArray(payload?.calls) ? payload.calls : []),
    ]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => round2(value));
    const putStrikes = [
      ...(Array.isArray(payload?.put) ? payload.put : []),
      ...(Array.isArray(payload?.puts) ? payload.puts : []),
    ]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => round2(value));

    return {
      call: [...new Set(callStrikes)].sort((a, b) => a - b),
      put: [...new Set(putStrikes)].sort((a, b) => a - b),
    };
  }

  async #fetchLiveOptionSnapshots(account, conids = []) {
    const uniqueConids = [...new Set(
      (Array.isArray(conids) ? conids : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    )];
    if (!uniqueConids.length) {
      return new Map();
    }
    const baseUrl = normalizeBaseUrl(account.credentials?.IBKR_BASE_URL);
    const fields = "31,84,86,85,88,87,7059,7085,7086,7087,7289,7308,7309,7310,7633,7762";
    const snapshotMap = new Map();

    const chunks = chunkArray(uniqueConids, IBKR_OPTION_SNAPSHOT_BATCH_SIZE);
    for (const chunk of chunks) {
      const query = new URLSearchParams({
        conids: chunk.join(","),
        fields,
      });
      const url = `${baseUrl}/v1/api/iserver/marketdata/snapshot?${query.toString()}`;
      const firstPayload = await this.#requestJson(url).catch(() => null);
      const firstRows = normalizeIbkrSnapshotRows(firstPayload);
      for (const row of firstRows) {
        const conid = firstNonEmptyValue(
          row?.conid,
          row?.conId,
          row?.contractId,
        );
        if (!conid) {
          continue;
        }
        snapshotMap.set(String(conid), row);
      }

      if (!firstRows.some(hasIbkrSnapshotQuoteFields)) {
        await delay(QUOTE_RETRY_DELAY_MS);
        const retryPayload = await this.#requestJson(url).catch(() => null);
        const retryRows = normalizeIbkrSnapshotRows(retryPayload);
        for (const row of retryRows) {
          const conid = firstNonEmptyValue(
            row?.conid,
            row?.conId,
            row?.contractId,
          );
          if (!conid) {
            continue;
          }
          snapshotMap.set(String(conid), row);
        }
      }
    }

    return snapshotMap;
  }

  async #fetchLivePositions(account) {
    const baseUrl = normalizeBaseUrl(account.credentials?.IBKR_BASE_URL);
    const accountCode = await this.#resolveAccountCode(account, {
      baseUrl,
      required: false,
    });
    if (!accountCode) {
      return null;
    }

    await this.#primeBrokerageSession(account, {
      baseUrl,
      accountCode,
    });

    const url = `${baseUrl}/v1/api/portfolio/${encodeURIComponent(accountCode)}/positions/0`;
    const payload = await this.#requestJson(url);
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.positions)
        ? payload.positions
        : [];

    return rows
      .map((row, index) => mapIbkrPositionRow(row, accountCode, index))
      .filter(Boolean);
  }

  async #resolveOrderConid(account, order) {
    if (order.assetType === "option") {
      return this.#resolveOptionConid(account, order);
    }
    return this.#resolveUnderlyingConid(account, order.symbol);
  }

  async #resolveOptionConid(account, order) {
    const option = order.option || {};
    const symbol = String(order.symbol || "").trim().toUpperCase();
    const expiry = normalizeExpiry(option.expiry);
    const strike = Number(option.strike);
    const right = String(option.right || "call").toLowerCase() === "put" ? "P" : "C";

    if (!symbol || !Number.isFinite(strike)) {
      return null;
    }

    const baseUrl = normalizeBaseUrl(account.credentials?.IBKR_BASE_URL);
    const underlyingConid = await this.#resolveUnderlyingConid(account, symbol);
    if (!underlyingConid) {
      return null;
    }

    const month = formatIbkrMonthFromExpiry(expiry);
    const query = new URLSearchParams({
      conid: String(underlyingConid),
      secType: "OPT",
      month,
      right,
      strike: String(strike),
    });

    const payload = await this.#requestJson(
      `${baseUrl}/v1/api/iserver/secdef/info?${query.toString()}`,
    );
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

    if (!rows.length) {
      return null;
    }

    const targetExpiry = normalizeExpiryToken(expiry);
    const exact = rows.find((row) => {
      const rowExpiry = normalizeExpiryToken(
        row?.maturityDate
          || row?.lastTradeDateOrContractMonth
          || row?.expiry
          || row?.expirationDate,
      );
      const rowRight = String(row?.right || row?.callPut || row?.putCall || "").toUpperCase();
      const rowStrike = parseIbmNumber(row, ["strike", "strikePrice"]);

      return (
        rowExpiry === targetExpiry
        && (!rowRight || rowRight === right)
        && Number.isFinite(rowStrike)
        && Math.abs(rowStrike - strike) < 0.001
      );
    });

    const candidate = exact || rows[0];
    return candidate?.conid ? String(candidate.conid) : null;
  }

  async #resolveUnderlyingConid(account, symbol) {
    const normalizedSymbol = String(symbol || "").trim().toUpperCase();
    const cacheKey = `${account.accountId}:${normalizedSymbol}`;
    if (CONID_CACHE.has(cacheKey)) {
      return CONID_CACHE.get(cacheKey);
    }

    const baseUrl = normalizeBaseUrl(account.credentials?.IBKR_BASE_URL);

    const searchUrl = `${baseUrl}/v1/api/iserver/secdef/search?symbol=${encodeURIComponent(normalizedSymbol)}`;
    const searchPayload = await this.#requestJson(searchUrl);
    const fromSearch = Array.isArray(searchPayload)
      ? searchPayload.find((row) => String(row?.symbol || "").toUpperCase() === normalizedSymbol)
      : null;

    if (fromSearch?.conid) {
      const conid = String(fromSearch.conid);
      CONID_CACHE.set(cacheKey, conid);
      return conid;
    }

    const trsrvUrl = `${baseUrl}/v1/api/trsrv/stocks?symbols=${encodeURIComponent(normalizedSymbol)}`;
    const trsrvPayload = await this.#requestJson(trsrvUrl);
    const candidates = trsrvPayload?.[normalizedSymbol] || trsrvPayload?.[normalizedSymbol.toUpperCase()] || [];
    const first = Array.isArray(candidates) ? candidates[0] : null;
    const contract = first?.contracts?.[0] || first;

    if (contract?.conid) {
      const conid = String(contract.conid);
      CONID_CACHE.set(cacheKey, conid);
      return conid;
    }

    return null;
  }

  async #resolveAccountCode(account, options = {}) {
    const configured = sanitizeAccountCode(account.credentials?.IBKR_ACCOUNT_ID);
    if (configured) {
      return configured;
    }

    const baseUrl = normalizeBaseUrl(options.baseUrl || account.credentials?.IBKR_BASE_URL);
    const discovered = await this.#discoverAccountCode(baseUrl);
    if (!discovered) {
      if (options.required) {
        throw new Error("IBKR account code not found. Set IBKR_ACCOUNT_ID or log in to Client Portal/Gateway first.");
      }
      return null;
    }

    await this.#persistAccountCode(account, discovered);
    return discovered;
  }

  async #persistAccountCode(account, accountCode) {
    const normalized = sanitizeAccountCode(accountCode);
    if (!normalized) {
      return;
    }

    if (account?.credentials) {
      account.credentials.IBKR_ACCOUNT_ID = normalized;
    }

    await this.store.upsertAccount({
      accountId: account.accountId,
      broker: "ibkr",
      credentials: {
        IBKR_ACCOUNT_ID: normalized,
      },
    });
  }

  async #discoverAccountCode(baseUrl) {
    const accountsPayload = await this.#requestJson(`${baseUrl}/v1/api/iserver/accounts`);
    const fromIsServer = extractAccountCode(accountsPayload);
    if (fromIsServer) {
      return fromIsServer;
    }

    const portfolioPayload = await this.#requestJson(`${baseUrl}/v1/api/portfolio/accounts`);
    return extractAccountCode(portfolioPayload);
  }

  async #primeBrokerageSession(account, options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl || account.credentials?.IBKR_BASE_URL);
    const accountsPayload = await this.#requestJson(`${baseUrl}/v1/api/iserver/accounts`);

    const accountCode = sanitizeAccountCode(options.accountCode)
      || sanitizeAccountCode(account.credentials?.IBKR_ACCOUNT_ID)
      || extractAccountCode(accountsPayload);

    if (!accountCode) {
      return null;
    }

    try {
      await this.#requestJson(`${baseUrl}/v1/api/iserver/account`, {
        method: "POST",
        body: {
          acctId: accountCode,
        },
      });
    } catch {
      // Account selection may fail when already selected; continue with detected account.
    }

    if (!sanitizeAccountCode(account.credentials?.IBKR_ACCOUNT_ID)) {
      await this.#persistAccountCode(account, accountCode);
    }

    return accountCode;
  }

  async #probeAuthState(account, options = {}) {
    const credentials = account?.credentials || {};
    if (!hasCredential(credentials.IBKR_BASE_URL)) {
      return {
        broker: "ibkr",
        state: "missing_credentials",
        live: false,
        message: "Missing IBKR_BASE_URL",
        checkedAt: new Date().toISOString(),
      };
    }

    const checkedAt = new Date().toISOString();
    let baseUrl = null;

    try {
      baseUrl = normalizeBaseUrl(credentials.IBKR_BASE_URL);
      let authPayload = await this.#requestJson(`${baseUrl}/v1/api/iserver/auth/status`, {
        method: "POST",
        body: {},
      });
      let authenticated = isIbkrAuthenticated(authPayload);

      if (!authenticated && options.attemptSsohInit) {
        try {
          await this.#requestJson(`${baseUrl}/v1/api/iserver/auth/ssodh/init`, {
            method: "POST",
            body: {
              publish: true,
              compete: true,
            },
          });
        } catch {
          // Some gateway versions do not expose this endpoint; continue to status probe.
        }

        authPayload = await this.#requestJson(`${baseUrl}/v1/api/iserver/auth/status`, {
          method: "POST",
          body: {},
        });
        authenticated = isIbkrAuthenticated(authPayload);
      }

      if (!authenticated) {
        return {
          broker: "ibkr",
          state: "needs_login",
          live: false,
          message:
            extractIbkrMessage(authPayload)
            || "IBKR gateway requires re-authentication in Client Portal/Gateway",
          checkedAt,
        };
      }

      try {
        await this.#requestJson(`${baseUrl}/v1/api/tickle`, {
          method: "POST",
          body: {},
        });
      } catch {
        // Non-fatal: auth status is still authoritative.
      }

      let accountCode = sanitizeAccountCode(credentials.IBKR_ACCOUNT_ID);
      if (options.discoverAccount) {
        accountCode = accountCode || await this.#resolveAccountCode(account, {
          baseUrl,
          required: false,
        });
      }

      return {
        broker: "ibkr",
        state: "authenticated",
        live: true,
        message: accountCode
          ? `IBKR gateway authenticated (${accountCode})`
          : "IBKR gateway authenticated",
        checkedAt,
      };
    } catch (error) {
      const baseUrlHint = baseUrl || String(credentials.IBKR_BASE_URL || "").trim();
      return {
        broker: "ibkr",
        state: "degraded",
        live: false,
        message: baseUrlHint
          ? `${error?.message || "IBKR auth probe failed"} (base URL: ${baseUrlHint})`
          : (error?.message || "IBKR auth probe failed"),
        checkedAt,
      };
    }
  }

  async #resolveIbkrOrderFlow(baseUrl, initialPayload) {
    let payload = initialPayload;

    for (let attempt = 0; attempt < MAX_REPLY_CONFIRMATIONS; attempt += 1) {
      const replyId = extractReplyId(payload);
      if (!replyId) {
        return payload;
      }

      payload = await this.#requestJson(
        `${baseUrl}/v1/api/iserver/reply/${encodeURIComponent(replyId)}`,
        {
          method: "POST",
          body: {
            confirmed: true,
          },
        },
      );
    }

    throw new Error("IBKR order confirmation loop exceeded retry limit");
  }

  async #requestJson(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
    };

    const body = options.body == null ? null : options.body;

    if (body != null && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const allowInsecureTls = options.allowInsecureTls ?? shouldAllowInsecureTls(url);

    return requestJsonOverHttp({
      url,
      method,
      headers,
      body,
      timeoutMs: REQUEST_TIMEOUT_MS,
      allowInsecureTls,
    });
  }

  #applyTlsPreference(source) {
    const raw = source?.credentials?.IBKR_ALLOW_INSECURE_TLS ?? source?.IBKR_ALLOW_INSECURE_TLS;
    if (!hasCredential(raw)) {
      return;
    }
    process.env.IBKR_ALLOW_INSECURE_TLS = String(raw).trim();
  }
}

function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) {
    throw new Error("IBKR_BASE_URL is required for live market data");
  }
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function sanitizeAccountCode(value) {
  if (!hasCredential(value)) {
    return null;
  }
  return String(value).trim();
}

function shouldAllowInsecureTls(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }

    const explicit = String(process.env.IBKR_ALLOW_INSECURE_TLS || "").trim().toLowerCase();
    if (explicit === "true" || explicit === "1" || explicit === "yes") {
      return true;
    }
    if (explicit === "false" || explicit === "0" || explicit === "no") {
      return false;
    }

    return LOCALHOST_NAMES.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function requestJsonOverHttp({
  url,
  method,
  headers,
  body,
  timeoutMs,
  allowInsecureTls,
}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`Invalid IBKR URL: ${url}`));
      return;
    }

    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;
    const payload = body == null ? null : JSON.stringify(body);
    const requestHeaders = {
      ...(headers || {}),
    };

    if (payload != null && requestHeaders["Content-Length"] == null) {
      requestHeaders["Content-Length"] = Buffer.byteLength(payload);
    }

    const request = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: requestHeaders,
        rejectUnauthorized: isHttps ? !allowInsecureTls : undefined,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const parsedBody = safeParseJson(text);
          const statusCode = Number(response.statusCode || 0);

          if (statusCode < 200 || statusCode >= 300) {
            const message =
              extractIbkrMessage(parsedBody)
              || extractIbkrMessage(text)
              || `IBKR request failed (${statusCode || "unknown"})`;
            reject(new Error(message));
            return;
          }

          resolve(parsedBody);
        });
      },
    );

    request.on("error", (error) => {
      reject(new Error(normalizeIbkrNetworkError(error)));
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("IBKR request timed out"));
    });

    if (payload != null) {
      request.write(payload);
    }

    request.end();
  });
}

function safeParseJson(value) {
  if (value == null || value === "") {
    return {};
  }

  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return {
      message: value,
      raw: value,
    };
  }
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

function normalizeExpiryToken(value) {
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  if (text.match(/^\d{8}$/)) {
    return text;
  }
  if (text.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return text.replace(/-/g, "");
  }
  if (text.match(/^\d{6}$/)) {
    return `20${text}`;
  }

  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const dt = new Date(parsed);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function formatIbkrMonthFromExpiry(expiry) {
  const iso = normalizeExpiry(expiry);
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed)) {
    return "";
  }

  const dt = new Date(parsed);
  const month = IBKR_MONTH_CODES[dt.getUTCMonth()] || "JAN";
  const year = String(dt.getUTCFullYear()).slice(-2);
  return `${month}${year}`;
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

function mapIbkrBarSize(resolution) {
  const normalized = normalizeResolution(resolution);
  if (normalized === "1D") {
    return "1d";
  }
  if (normalized === "1W") {
    return "1w";
  }
  const minutes = Math.max(1, Math.round(Number(normalized)));
  if (minutes >= 240) {
    return "4h";
  }
  if (minutes >= 120) {
    return "2h";
  }
  if (minutes >= 60) {
    return "1h";
  }
  if (minutes >= 30) {
    return "30min";
  }
  if (minutes >= 15) {
    return "15min";
  }
  if (minutes >= 5) {
    return "5min";
  }
  if (minutes >= 3) {
    return "3min";
  }
  return "1min";
}

function resolveIbkrPeriod({ from, to, countBack, resolution }) {
  const intervalSec = resolutionToSeconds(resolution);
  const toSec = parseEpochSeconds(to) || Math.floor(Date.now() / 1000);
  const countBackRaw = Number(countBack);
  const countBackBars = Number.isFinite(countBackRaw)
    ? Math.max(1, Math.min(5000, Math.round(countBackRaw)))
    : 320;

  let fromSec = parseEpochSeconds(from);
  if (!Number.isFinite(fromSec)) {
    fromSec = toSec - countBackBars * intervalSec;
  }

  const rangeSec = Math.max(intervalSec, Math.abs(toSec - fromSec));
  const minutes = Math.ceil(rangeSec / 60);
  if (minutes <= 30) {
    return `${Math.max(1, minutes)}min`;
  }

  const hours = Math.ceil(rangeSec / 3600);
  if (hours <= 8) {
    return `${Math.max(1, hours)}h`;
  }

  const days = Math.ceil(rangeSec / 86400);
  if (days <= 1000) {
    return `${Math.max(1, days)}d`;
  }

  const weeks = Math.ceil(days / 7);
  if (weeks <= 792) {
    return `${Math.max(1, weeks)}w`;
  }

  const months = Math.ceil(days / 30);
  if (months <= 182) {
    return `${Math.max(1, months)}m`;
  }

  const years = Math.ceil(days / 365);
  return `${Math.max(1, Math.min(15, years))}y`;
}

function resolutionToSeconds(value) {
  const resolution = normalizeResolution(value);
  if (resolution === "1D") {
    return 86400;
  }
  if (resolution === "1W") {
    return 7 * 86400;
  }
  const minutes = Number(resolution);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 5 * 60;
  }
  return Math.max(1, Math.round(minutes)) * 60;
}

function parseEpochSeconds(value) {
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

function parseBarTimeMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  if (numeric > 100000000000) {
    return Math.round(numeric);
  }
  return Math.round(numeric * 1000);
}

function formatIbkrDateTimeFromEpoch(epochValue) {
  const epoch = parseEpochSeconds(epochValue);
  if (!Number.isFinite(epoch)) {
    return null;
  }
  const dt = new Date(epoch * 1000);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const hh = String(dt.getUTCHours()).padStart(2, "0");
  const mi = String(dt.getUTCMinutes()).padStart(2, "0");
  const ss = String(dt.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}:${mi}:${ss}`;
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

function normalizeIbkrTif(value) {
  const normalized = String(value || "DAY").trim().toUpperCase();
  if (!normalized) {
    return "DAY";
  }
  if (["DAY", "GTC", "IOC", "FOK", "OPG"].includes(normalized)) {
    return normalized;
  }
  return "DAY";
}

function normalizeIbkrOrderStatus(value) {
  const normalized = String(value || "submitted").trim().toLowerCase();
  if (!normalized) {
    return "submitted";
  }
  if (normalized.includes("fill") || normalized === "executed") {
    return "filled";
  }
  if (normalized.includes("cancel")) {
    return "canceled";
  }
  if (normalized.includes("reject") || normalized.includes("inactive")) {
    return "rejected";
  }
  if (normalized.includes("submit") || normalized.includes("pend")) {
    return "submitted";
  }
  return normalized;
}

function extractReplyId(payload) {
  const rows = extractIbkrOrderRows(payload);
  for (const row of rows) {
    const id = row?.id || row?.replyId;
    if (!id) {
      continue;
    }

    const hasOrderId = hasCredential(row?.order_id) || hasCredential(row?.orderId);
    const hasStatus = hasCredential(row?.order_status) || hasCredential(row?.status);
    const requiresConfirmation =
      Array.isArray(row?.message)
      || hasCredential(row?.message)
      || row?.requires_confirmation === true;

    if (requiresConfirmation || (!hasOrderId && !hasStatus)) {
      return String(id);
    }
  }

  return null;
}

function extractIbkrOrderRows(payload) {
  if (Array.isArray(payload)) {
    return payload.filter((row) => row && typeof row === "object");
  }
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.orders)) {
      return payload.orders.filter((row) => row && typeof row === "object");
    }
    return [payload];
  }
  return [];
}

function extractAccountCode(payload) {
  const candidates = [];

  if (typeof payload === "string") {
    candidates.push(payload);
  }

  if (Array.isArray(payload)) {
    for (const row of payload) {
      if (typeof row === "string") {
        candidates.push(row);
        continue;
      }
      if (row && typeof row === "object") {
        candidates.push(row.accountId, row.acctId, row.id, row.account, row.accountCode);
      }
    }
  } else if (payload && typeof payload === "object") {
    candidates.push(
      payload.selectedAccount,
      payload.selectedAccountId,
      payload.accountId,
      payload.acctId,
    );

    if (Array.isArray(payload.accounts)) {
      for (const row of payload.accounts) {
        if (typeof row === "string") {
          candidates.push(row);
          continue;
        }
        if (row && typeof row === "object") {
          candidates.push(row.accountId, row.acctId, row.id, row.account, row.accountCode);
        }
      }
    }
  }

  for (const candidate of candidates) {
    if (!hasCredential(candidate)) {
      continue;
    }
    return String(candidate).trim();
  }

  return null;
}

function parseIbmNumber(source, keys) {
  for (const key of keys) {
    const raw = source?.[key];
    if (raw == null) {
      continue;
    }
    const cleaned = typeof raw === "string" ? raw.replace(/,/g, "") : raw;
    const numeric = Number(cleaned);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function readIbkrSummaryValue(summary, keys) {
  if (!summary || typeof summary !== "object") {
    return null;
  }

  const normalizedKeys = new Set(
    (keys || []).map((key) => normalizeSummaryKey(key)).filter(Boolean),
  );

  for (const key of keys || []) {
    const direct = parseSummaryValue(summary[key]);
    if (Number.isFinite(direct)) {
      return direct;
    }

    const lower = parseSummaryValue(summary[String(key).toLowerCase()]);
    if (Number.isFinite(lower)) {
      return lower;
    }

    const upper = parseSummaryValue(summary[String(key).toUpperCase()]);
    if (Number.isFinite(upper)) {
      return upper;
    }
  }

  for (const [key, value] of Object.entries(summary)) {
    if (!normalizedKeys.has(normalizeSummaryKey(key))) {
      continue;
    }
    const numeric = parseSummaryValue(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function normalizeSummaryKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseSummaryValue(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const numeric = Number(value.replace(/,/g, ""));
    return Number.isFinite(numeric) ? numeric : null;
  }

  if (Array.isArray(value)) {
    for (const row of value) {
      const numeric = parseSummaryValue(row);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    return null;
  }

  if (typeof value === "object") {
    return firstFiniteNumber(
      value.amount,
      value.value,
      value.rawValue,
      value.current,
      value.total,
      value.base,
      value.usd,
    );
  }

  return null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const candidate = typeof value === "string" ? value.replace(/,/g, "") : value;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function extractIbkrMessage(payload) {
  if (payload == null) {
    return null;
  }

  if (typeof payload === "string") {
    const text = payload.trim();
    return text || null;
  }

  if (Array.isArray(payload)) {
    for (const row of payload) {
      const message = extractIbkrMessage(row);
      if (message) {
        return message;
      }
    }
    return null;
  }

  if (typeof payload === "object") {
    const direct = [
      payload.message,
      payload.error,
      payload.errorMessage,
      payload.reason,
      payload.statusDescription,
    ];

    for (const candidate of direct) {
      const message = extractIbkrMessage(candidate);
      if (message) {
        return message;
      }
    }

    for (const [key, value] of Object.entries(payload)) {
      if (!["messages", "details", "warnings", "data"].includes(key)) {
        continue;
      }
      const message = extractIbkrMessage(value);
      if (message) {
        return message;
      }
    }
  }

  return null;
}

function normalizeIbkrNetworkError(error) {
  const message = String(error?.message || "IBKR request failed");
  const lower = message.toLowerCase();

  if (lower.includes("packet length too long")) {
    return "IBKR protocol mismatch. If gateway is HTTP, set IBKR_BASE_URL to http://... instead of https://...";
  }
  if (lower.includes("self signed certificate")) {
    return "IBKR TLS certificate is self-signed. Set IBKR_ALLOW_INSECURE_TLS=true for local gateway usage.";
  }
  if (lower.includes("econnrefused")) {
    return "IBKR gateway connection refused. Ensure Client Portal Gateway is running and IBKR_BASE_URL is correct.";
  }
  if (lower.includes("enotfound")) {
    return "IBKR gateway host not found. Check IBKR_BASE_URL hostname.";
  }

  return message;
}

function isIbkrAuthenticated(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (payload.authenticated === true) {
    return true;
  }

  if (payload?.iserver?.authStatus?.authenticated === true) {
    return true;
  }

  const status = String(payload.status || payload?.iserver?.authStatus?.status || "")
    .trim()
    .toLowerCase();
  return status === "authenticated" || status === "ok";
}

function mapIbkrPositionRow(row, accountCode, index) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const quantityRaw = parseIbmNumber(row, [
    "position",
    "qty",
    "quantity",
    "size",
  ]);
  if (!Number.isFinite(quantityRaw) || quantityRaw === 0) {
    return null;
  }

  const qty = Math.abs(Number(quantityRaw));
  const side = quantityRaw < 0 ? "short" : "long";
  const secType = String(row.secType || row.assetClass || row.assetType || "").toUpperCase();
  const optionFromSymbol = parseIbkrOptionFromLocalSymbol(
    row.localSymbol || row.contractDesc || row.description,
  );
  const isOption = secType.includes("OPT") || Boolean(optionFromSymbol);
  const multiplier = isOption ? 100 : 1;

  const symbol = String(
    row.ticker
      || row.symbol
      || optionFromSymbol?.symbol
      || "",
  ).trim().toUpperCase();
  if (!symbol) {
    return null;
  }

  const avgCostRaw = parseIbmNumber(row, ["avgCost", "avgPrice", "averagePrice", "cost"]);
  const costBasisRaw = parseIbmNumber(row, ["costBasis"]);
  const averagePrice = Number.isFinite(avgCostRaw)
    ? Number(avgCostRaw)
    : Number.isFinite(costBasisRaw)
      ? costBasisRaw / Math.max(qty * multiplier, 1)
      : 0;

  const markPrice = parseIbmNumber(row, [
    "mktPrice",
    "marketPrice",
    "markPrice",
    "last",
    "lastPrice",
  ]) ?? averagePrice;

  const marketValue = parseIbmNumber(row, [
    "mktValue",
    "marketValue",
    "marketValueBase",
  ]) ?? (markPrice * qty * multiplier);

  const spreadPnl = (markPrice - averagePrice) * qty * multiplier * (side === "long" ? 1 : -1);
  const unrealizedPnl = parseIbmNumber(row, [
    "unrealizedPnl",
    "unrealizedPNL",
    "unrealized",
    "dailyPnL",
  ]) ?? spreadPnl;

  const conid = row.conid || row.conId || row.contractId;
  const positionId = String(conid || `${accountCode}-${symbol}-${index}`);

  return {
    positionId: `ibkr-${positionId}`,
    symbol,
    assetType: isOption ? "option" : "equity",
    side,
    qty,
    averagePrice: round2(averagePrice),
    markPrice: round2(markPrice),
    marketValue: round2(marketValue),
    unrealizedPnl: round2(unrealizedPnl),
    currency: String(row.currency || "USD").toUpperCase(),
    option: optionFromSymbol
      ? {
        expiry: optionFromSymbol.expiry,
        strike: round2(optionFromSymbol.strike),
        right: optionFromSymbol.right,
      }
      : null,
  };
}

function parseIbkrOptionFromLocalSymbol(value) {
  if (!value) {
    return null;
  }
  const compact = String(value).replace(/\s+/g, "").toUpperCase();
  const match = compact.match(/^([A-Z.]+)(\d{6})([CP])(\d{8})$/);
  if (!match) {
    return null;
  }

  const symbol = match[1];
  const yymmdd = match[2];
  const right = match[3] === "C" ? "call" : "put";
  const strike = Number(match[4]) / 1000;
  const year = `20${yymmdd.slice(0, 2)}`;
  const month = yymmdd.slice(2, 4);
  const day = yymmdd.slice(4, 6);

  if (!Number.isFinite(strike)) {
    return null;
  }

  return {
    symbol,
    expiry: `${year}-${month}-${day}`,
    strike,
    right,
  };
}

function compareOptionRows(a, b) {
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
  const rightA = String(a?.right || "").toLowerCase();
  const rightB = String(b?.right || "").toLowerCase();
  if (rightA !== rightB) {
    return rightA.localeCompare(rightB);
  }
  return String(a?.contractId || "").localeCompare(String(b?.contractId || ""));
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

function hasIbkrSnapshotQuoteFields(row) {
  return Number.isFinite(parseIbmNumber(row, ["31", "last", "last_price"]))
    || Number.isFinite(parseIbmNumber(row, ["84", "bid", "bid_price"]))
    || Number.isFinite(parseIbmNumber(row, ["86", "ask", "ask_price"]));
}

function normalizeIbkrSnapshotRows(payload) {
  if (Array.isArray(payload)) {
    return payload.filter((row) => row && typeof row === "object");
  }
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.data)) {
      return payload.data.filter((row) => row && typeof row === "object");
    }
    return [payload];
  }
  return [];
}

function mapIbkrOptionSecdefContractRow(row, defaults = {}) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const symbol = String(
    row.symbol
    || row.underlyingSymbol
    || row.underlying
    || defaults.symbol
    || "",
  ).trim().toUpperCase();
  const expiry = normalizeOptionExpiryValue(firstNonEmptyValue(
    row.maturityDate,
    row.lastTradeDateOrContractMonth,
    row.expiry,
    row.expirationDate,
    row.expDate,
    defaults.expiry,
  ));
  const strike = parseIbmNumber(row, [
    "strike",
    "strikePrice",
    "exercisePrice",
  ]);
  const right = normalizeIbkrOptionRight(firstNonEmptyValue(
    row.right,
    row.callPut,
    row.putCall,
    row.optionType,
    defaults.right,
  ));
  if (!symbol || !expiry || !Number.isFinite(strike) || strike <= 0 || !right) {
    return null;
  }
  const normalizedStrike = round2(strike);
  const conid = firstNonEmptyValue(
    row.conid,
    row.conId,
    row.contractId,
    row.id,
  );

  return {
    contractId: buildCanonicalOptionContractId(symbol, expiry, normalizedStrike, right),
    symbol,
    expiry,
    strike: normalizedStrike,
    right,
    conid: conid ? String(conid) : null,
    nativeSymbol: firstNonEmptyValue(
      row.localSymbol,
      row.contractDesc,
      row.description,
    ) || null,
    brokerRaw: row,
  };
}

function mapIbkrOptionChainRow(contract, snapshotRow = null) {
  if (!contract || typeof contract !== "object") {
    return null;
  }

  const bid = parseIbmNumber(snapshotRow, ["84", "bid", "bid_price"]);
  const ask = parseIbmNumber(snapshotRow, ["86", "ask", "ask_price"]);
  const last = parseIbmNumber(snapshotRow, ["31", "last", "last_price"]);
  const mark = firstFiniteNumber(
    parseIbmNumber(snapshotRow, ["7059", "mark", "mark_price", "mid", "mid_price"]),
    Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : null,
    last,
  );
  const change = parseIbmNumber(snapshotRow, ["82", "change", "chg", "priceChange"]);
  const changePct = parseIbmNumber(snapshotRow, [
    "7289",
    "changePercent",
    "changePct",
    "pctChange",
  ]);
  const volume = parseIbmNumber(snapshotRow, [
    "7762",
    "7308",
    "volume",
    "vol",
  ]);
  const oi = parseIbmNumber(snapshotRow, [
    "7085",
    "openInterest",
    "open_interest",
    "oi",
    "7309",
    "7310",
  ]);
  const bidSize = parseIbmNumber(snapshotRow, [
    "88",
    "bidSize",
    "bid_size",
    "bidSz",
    "bid_qty",
  ]);
  const askSize = parseIbmNumber(snapshotRow, [
    "85",
    "87",
    "askSize",
    "ask_size",
    "askSz",
    "ask_qty",
  ]);
  const iv = normalizeIbkrOptionIv(parseIbmNumber(snapshotRow, [
    "7633",
    "iv",
    "impliedVolatility",
    "implied_volatility",
  ]));
  const delta = parseIbmNumber(snapshotRow, ["delta"]);
  const gamma = parseIbmNumber(snapshotRow, ["gamma"]);
  const theta = parseIbmNumber(snapshotRow, ["theta"]);
  const vega = parseIbmNumber(snapshotRow, ["vega"]);

  return {
    contractId: String(
      contract.contractId
      || buildCanonicalOptionContractId(contract.symbol, contract.expiry, contract.strike, contract.right),
    ),
    nativeContractId: contract.conid ? String(contract.conid) : null,
    symbol: contract.symbol,
    expiry: contract.expiry,
    strike: round2(contract.strike),
    right: contract.right,
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
    updatedAt: normalizeIbkrOptionTimestamp(snapshotRow),
    brokerRaw: snapshotRow || contract.brokerRaw || null,
  };
}

function normalizeIbkrOptionTimestamp(row) {
  const raw = firstFiniteNumber(
    row?._updated,
    row?.updatedAt,
    row?.timestamp,
    row?.ts,
    row?.time,
  );
  if (!Number.isFinite(raw)) {
    return new Date().toISOString();
  }
  const ms = raw > 100000000000 ? raw : raw * 1000;
  return new Date(Math.round(ms)).toISOString();
}

function normalizeIbkrOptionRight(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (text.startsWith("c")) {
    return "call";
  }
  if (text.startsWith("p")) {
    return "put";
  }
  return null;
}

function normalizeOptionExpiryValue(value) {
  if (value == null || value === "") {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  if (/^\d{6}$/.test(text)) {
    const firstFour = Number(text.slice(0, 4));
    const monthTail = Number(text.slice(4, 6));
    if (
      Number.isFinite(firstFour)
      && firstFour >= 1900
      && firstFour <= 2200
      && Number.isFinite(monthTail)
      && monthTail >= 1
      && monthTail <= 12
    ) {
      return `${text.slice(0, 4)}-${text.slice(4, 6)}-01`;
    }
    const mm = Number(text.slice(2, 4));
    const dd = Number(text.slice(4, 6));
    if (Number.isFinite(mm) && mm >= 1 && mm <= 12 && Number.isFinite(dd) && dd >= 1 && dd <= 31) {
      return `20${text.slice(0, 2)}-${text.slice(2, 4)}-${text.slice(4, 6)}`;
    }
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeIbkrOptionIv(value) {
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
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const normalizedExpiry = normalizeOptionExpiryValue(expiry);
  const normalizedStrike = Number(strike);
  const normalizedRight = normalizeIbkrOptionRight(right);
  if (
    !normalizedSymbol
    || !normalizedExpiry
    || !Number.isFinite(normalizedStrike)
    || normalizedStrike <= 0
    || !normalizedRight
  ) {
    return null;
  }
  return `${normalizedSymbol}-${normalizedExpiry}-${stripTrailingZeros(normalizedStrike)}-${normalizedRight}`;
}

function stripTrailingZeros(value) {
  return Number(value).toString();
}

function firstNonEmptyValue(...values) {
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

function chunkArray(values, size) {
  const out = [];
  const list = Array.isArray(values) ? values : [];
  const step = Math.max(1, Math.floor(Number(size) || 1));
  for (let index = 0; index < list.length; index += step) {
    out.push(list.slice(index, index + step));
  }
  return out;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function hasCredential(value) {
  return value != null && String(value).trim() !== "";
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
