import { buildOrderPreview } from "../services/orderValidation.js";
import { buildOptionContractId } from "../services/optionContracts.js";

export class BrokerAdapter {
  constructor(store, brokerId, options = {}) {
    this.store = store;
    this.brokerId = brokerId;
    this.requiredCredentialKeys = options.requiredCredentialKeys || [];
    this.defaultCommission = options.defaultCommission || 0.65;
    this.capabilities = normalizeCapabilities(options.capabilities, {
      marketData: true,
      optionChain: true,
      optionLadder: true,
      orderSubmit: true,
      orderLifecycleRead: true,
      orderCancel: false,
      orderReplace: false,
      liveOptionExecution: false,
      syntheticOrderFill: true,
    });
  }

  getCapabilities(_account = null) {
    return {
      broker: this.brokerId,
      ...this.capabilities,
      nativeLiveExecution: this.supportsNativeLiveExecution(_account, null),
    };
  }

  supportsNativeLiveExecution(_account = null, _order = null) {
    return false;
  }

  async connect(account, credentials = {}) {
    const missing = this.requiredCredentialKeys.filter(
      (key) => !credentials[key] || !String(credentials[key]).trim(),
    );

    if (missing.length > 0) {
      throw new Error(
        `Missing required credentials: ${missing.join(", ")}`,
      );
    }

    return {
      status: "connected",
      message: `${account.label} connected (${this.brokerId})`,
    };
  }

  async getAuthStatus(account) {
    const credentials = account?.credentials || {};
    const missing = this.requiredCredentialKeys.filter(
      (key) => !hasCredentialValue(credentials[key]),
    );

    if (missing.length > 0) {
      return {
        broker: this.brokerId,
        state: "missing_credentials",
        live: false,
        message: `Missing credentials: ${missing.join(", ")}`,
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      broker: this.brokerId,
      state: "configured",
      live: false,
      message: "Credentials configured",
      checkedAt: new Date().toISOString(),
    };
  }

  async refreshAuthSession(account) {
    return this.getAuthStatus(account);
  }

  async getPositions(account) {
    return this.store.listPositions(account.accountId);
  }

  async getAccountSummary(account) {
    return this.store.buildCachedAccountSummary(account.accountId);
  }

  async getEquityHistory(_account, _request = {}) {
    return [];
  }

  async getClosedTrades(_account, _request = {}) {
    return [];
  }

  async getCashLedger(_account, _request = {}) {
    return [];
  }

  buildUnavailableSpotQuote(symbol, options = {}) {
    const normalizedSymbol = normalizeSymbol(symbol);
    return {
      symbol: normalizedSymbol,
      last: null,
      bid: null,
      ask: null,
      open: null,
      high: null,
      low: null,
      change: null,
      changePct: null,
      spread: null,
      spreadPct: null,
      volume: null,
      timestamp: new Date().toISOString(),
      source: options.source || `${this.brokerId}-live-unavailable`,
      stale: true,
      unavailable: true,
      error: options.error || null,
    };
  }

  buildUnavailableBars(request = {}, options = {}) {
    return {
      symbol: normalizeSymbol(request.symbol),
      resolution: normalizeResolution(request.resolution),
      bars: [],
      source: options.source || `${this.brokerId}-live-history-unavailable`,
      stale: true,
      unavailable: true,
      dataQuality: "live_unavailable",
      error: options.error || null,
    };
  }

  buildUnavailableMarketDepth(request = {}, options = {}) {
    return {
      symbol: normalizeSymbol(request.symbol),
      levels: Number.isFinite(Number(request.levels ?? request.depthLevels))
        ? Math.max(1, Math.round(Number(request.levels ?? request.depthLevels)))
        : 1,
      bids: [],
      asks: [],
      source: options.source || `${this.brokerId}-live-depth-unavailable`,
      stale: true,
      unavailable: true,
      timestamp: new Date().toISOString(),
      error: options.error || null,
    };
  }

  buildUnavailableMarketTicks(request = {}, options = {}) {
    return {
      symbol: normalizeSymbol(request.symbol),
      ticks: [],
      source: options.source || `${this.brokerId}-live-ticks-unavailable`,
      stale: true,
      unavailable: true,
      timestamp: new Date().toISOString(),
      error: options.error || null,
    };
  }

  buildUnavailableMarketFootprint(request = {}, options = {}) {
    return {
      symbol: normalizeSymbol(request.symbol),
      resolution: normalizeResolution(request.resolution),
      rows: [],
      source: options.source || `${this.brokerId}-live-footprint-unavailable`,
      stale: true,
      unavailable: true,
      timestamp: new Date().toISOString(),
      error: options.error || null,
    };
  }

  buildUnavailableOrderFlow(request = {}, options = {}) {
    const depth = options.depth || this.buildUnavailableMarketDepth(request, options);
    const ticks = options.ticks || this.buildUnavailableMarketTicks(request, options);
    const footprint = options.footprint || this.buildUnavailableMarketFootprint(request, options);
    return {
      symbol: normalizeSymbol(request.symbol),
      resolution: normalizeResolution(request.resolution),
      score: null,
      classification: "unavailable",
      metrics: {
        aggressorBuyPct: null,
        aggressorSellPct: null,
        aggressorImbalance: null,
        depthBidPct: null,
        depthAskPct: null,
        depthImbalance: null,
        footprintImbalance: null,
        tickCount: 0,
      },
      depth,
      ticks,
      footprint,
      source: options.source || `${this.brokerId}-live-order-flow-unavailable`,
      stale: true,
      unavailable: true,
      timestamp: new Date().toISOString(),
      error: options.error || null,
    };
  }

  buildUnavailableOptionChain(request = {}, options = {}) {
    const normalizedSymbol = normalizeSymbol(request.symbol);
    const expiry = normalizeExpiry(request.expiry);
    const underlyingPrice = Number.isFinite(Number(options.underlyingPrice))
      ? round2(Number(options.underlyingPrice))
      : null;
    return {
      symbol: normalizedSymbol,
      expiry,
      underlyingPrice,
      rows: [],
      source: options.source || `${this.brokerId}-live-options-unavailable`,
      stale: true,
      unavailable: true,
      error: options.error || null,
    };
  }

  async getSpotQuote(account, symbol) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const last = estimateSpotPrice(normalizedSymbol);
    const change = round2(Math.sin(Date.now() / 3600000 + hashToUnit(normalizedSymbol)) * 1.8);
    const changePct = round2((change / Math.max(last - change, 0.01)) * 100);
    const spread = normalizedSymbol === "SPY" ? 0.02 : 0.04;

    return {
      symbol: normalizedSymbol,
      last,
      bid: round2(last - spread / 2),
      ask: round2(last + spread / 2),
      change,
      changePct,
      timestamp: new Date().toISOString(),
      source: `${this.brokerId}-synthetic`,
    };
  }

  async getBars(account, request = {}) {
    const symbol = normalizeSymbol(request.symbol);
    const resolution = normalizeResolution(request.resolution);
    const intervalMs = resolutionToMs(resolution);
    const toSec = parseEpochSeconds(request.to) || Math.floor(Date.now() / 1000);
    const fromSecInput = parseEpochSeconds(request.from);
    const countBackRaw = Number(request.countBack);
    const countBack = Number.isFinite(countBackRaw)
      ? Math.max(1, Math.min(5000, Math.round(countBackRaw)))
      : null;

    let fromSec = fromSecInput;
    if (!Number.isFinite(fromSec)) {
      fromSec = toSec - (countBack || 320) * Math.floor(intervalMs / 1000);
    }
    if (fromSec > toSec) {
      fromSec = toSec;
    }

    const startMsRaw = Math.floor(fromSec * 1000);
    const endMsRaw = Math.floor(toSec * 1000);
    const endMs = alignToInterval(endMsRaw, intervalMs);

    let barTarget = Math.floor((endMs - startMsRaw) / intervalMs) + 1;
    if (!Number.isFinite(barTarget) || barTarget < 1) {
      barTarget = countBack || 320;
    }
    barTarget = Math.max(1, Math.min(barTarget, 5000));

    const startMs = endMs - (barTarget - 1) * intervalMs;
    const quote = await this.getSpotQuote(account, symbol);
    const anchorPrice = Number.isFinite(Number(quote?.last))
      ? Number(quote.last)
      : estimateSpotPrice(symbol);

    const bars = [];
    let previousClose = anchorPrice;
    for (let index = 0; index < barTarget; index += 1) {
      const time = startMs + index * intervalMs;
      const smoothWave = Math.sin(time / 4800000 + hashToUnit(symbol) * Math.PI * 2);
      const driftWave = Math.cos(time / 21000000 + hashToUnit(`${symbol}:${resolution}`) * Math.PI * 2);
      const noise = (hashToUnit(`${symbol}:${resolution}:${time}`) - 0.5) * 0.0048 * anchorPrice;
      const closeSeed = anchorPrice + smoothWave * anchorPrice * 0.004 + driftWave * anchorPrice * 0.002 + noise;
      const close = round2(Math.max(0.01, closeSeed));
      const open = round2(index === 0 ? close : previousClose);
      const wickBase = Math.max(0.01, Math.abs(close - open));
      const wickScale = 1 + hashToUnit(`${symbol}:wick:${time}`) * 1.2;
      const high = round2(Math.max(open, close) + wickBase * wickScale);
      const low = round2(Math.max(0.01, Math.min(open, close) - wickBase * wickScale * 0.9));
      const volume = Math.max(
        1,
        Math.round(
          10000
            + hashToUnit(`${symbol}:vol:${resolution}:${time}`) * 90000
            + Math.abs(close - open) * 8000,
        ),
      );

      bars.push({
        time,
        open,
        high,
        low,
        close,
        volume,
      });

      previousClose = close;
    }

    return {
      symbol,
      resolution,
      bars,
      source: `-synthetic`,
      stale: true,
      dataQuality: "synthetic_fallback",
    };
  }

  async getMarketDepth(_account, request = {}) {
    return this.buildUnavailableMarketDepth(request);
  }

  async getMarketTicks(_account, request = {}) {
    return this.buildUnavailableMarketTicks(request);
  }

  async getMarketFootprint(_account, request = {}) {
    return this.buildUnavailableMarketFootprint(request);
  }

  async getOrderFlow(_account, request = {}) {
    return this.buildUnavailableOrderFlow(request);
  }

  async getOptionChain(account, request = {}) {
    const normalizedSymbol = normalizeSymbol(request.symbol);
    const expiry = normalizeExpiry(request.expiry);
    const quote = await this.getSpotQuote(account, normalizedSymbol);
    const rows = buildSyntheticOptionRows(normalizedSymbol, expiry, quote.last);

    return {
      symbol: normalizedSymbol,
      expiry,
      underlyingPrice: quote.last,
      rows,
      source: `${this.brokerId}-synthetic`,
      stale: false,
    };
  }

  async getOptionLadder(account, request = {}) {
    const normalizedRight = (request.right || "call").toLowerCase() === "put" ? "put" : "call";
    const chain = await this.getOptionChain(account, request);
    const windowSize = Number.isFinite(Number(request.window)) ? Number(request.window) : 7;
    const sorted = chain.rows
      .filter((row) => row.right === normalizedRight)
      .sort((a, b) => a.strike - b.strike);

    const atmIndex = findAtmIndex(sorted, chain.underlyingPrice);
    const start = Math.max(0, atmIndex - windowSize);
    const end = Math.min(sorted.length, atmIndex + windowSize + 1);
    const rows = sorted.slice(start, end);

    return {
      symbol: chain.symbol,
      expiry: chain.expiry,
      right: normalizedRight,
      underlyingPrice: chain.underlyingPrice,
      rows,
      source: chain.source,
      stale: chain.stale,
    };
  }

  async listOpenOrders(account, request = {}) {
    const limit = Number.isFinite(Number(request.limit))
      ? Math.max(1, Math.min(2000, Math.round(Number(request.limit))))
      : 250;
    return this.store.listOrders({
      accountId: account?.accountId,
      openOnly: true,
      limit,
    });
  }

  async cancelOrder(_account, _orderId, _request = {}) {
    throw new Error(`${this.brokerId} adapter does not support order cancellation`);
  }

  async replaceOrder(_account, _orderId, _request = {}) {
    throw new Error(`${this.brokerId} adapter does not support order replacement`);
  }

  async placeOrder(account, order) {
    const preview = buildOrderPreview(order, this.defaultCommission);
    const fillPrice = preview.unitPrice;

    await this.#applyOrderToPositions(account.accountId, order, fillPrice);

    const orderResult = {
      orderId: `${account.accountId}-${Date.now()}`,
      accountId: account.accountId,
      broker: account.broker,
      status: "filled",
      filledAt: new Date().toISOString(),
      executionMode: order.executionMode,
      order,
      fill: {
        price: fillPrice,
        quantity: order.quantity,
        estimatedFees: preview.estimatedFees,
      },
      preview,
    };

    await this.store.recordOrder(orderResult);
    return orderResult;
  }

  async closePosition(account, positionId, closeRequest) {
    const position = this.store.getPosition(account.accountId, positionId);
    if (!position) {
      throw new Error("Position not found for account");
    }

    const quantity = closeRequest.quantity || position.qty;
    if (quantity > position.qty) {
      throw new Error("Close quantity exceeds open position quantity");
    }

    const closeSide = position.side === "long" ? "sell" : "buy";

    const closeOrder = {
      accountId: account.accountId,
      symbol: position.symbol,
      assetType: position.assetType,
      side: closeSide,
      quantity,
      orderType: closeRequest.limitPrice ? "limit" : "market",
      limitPrice: closeRequest.limitPrice,
      executionMode: closeRequest.executionMode,
      option: position.option || null,
      expiry: position.option?.expiry,
      strike: position.option?.strike,
      right: position.option?.right,
      // Preserve broker/native IDs when present so close operations target the exact row.
      targetPositionId: position.positionId,
    };

    return this.placeOrder(account, closeOrder);
  }

  async #applyOrderToPositions(accountId, order, fillPrice) {
    const current = this.store.listPositions(accountId);
    const key = positionKeyForOrder(order);

    const idx = current.findIndex((position) => position.positionId === key);
    const targetSide = order.side === "buy" ? "long" : "short";

    if (idx === -1) {
      current.push(
        buildPositionFromOrder({ accountId, positionId: key, order, fillPrice, side: targetSide }),
      );
      await this.store.setPositions(accountId, current);
      return;
    }

    const existing = current[idx];

    if (existing.side === targetSide) {
      const nextQty = existing.qty + order.quantity;
      const nextAverage =
        (existing.averagePrice * existing.qty + fillPrice * order.quantity) / nextQty;
      const markPrice = round2(fillPrice);

      current[idx] = {
        ...existing,
        qty: nextQty,
        averagePrice: round2(nextAverage),
        markPrice,
        marketValue: computeMarketValue(markPrice, nextQty, existing.assetType),
        unrealizedPnl: computeUnrealizedPnl(markPrice, round2(nextAverage), nextQty, existing.assetType, existing.side),
      };

      await this.store.setPositions(accountId, current);
      return;
    }

    const remaining = existing.qty - order.quantity;
    if (remaining > 0) {
      const markPrice = round2(fillPrice);
      current[idx] = {
        ...existing,
        qty: remaining,
        markPrice,
        marketValue: computeMarketValue(markPrice, remaining, existing.assetType),
        unrealizedPnl: computeUnrealizedPnl(markPrice, existing.averagePrice, remaining, existing.assetType, existing.side),
      };
      await this.store.setPositions(accountId, current);
      return;
    }

    if (remaining === 0) {
      current.splice(idx, 1);
      await this.store.setPositions(accountId, current);
      return;
    }

    const flippedQty = Math.abs(remaining);
    const flipped = buildPositionFromOrder({
      accountId,
      positionId: key,
      order: { ...order, quantity: flippedQty },
      fillPrice,
      side: targetSide,
    });

    current[idx] = flipped;
    await this.store.setPositions(accountId, current);
  }
}

function buildPositionFromOrder({ accountId, positionId, order, fillPrice, side }) {
  const markPrice = round2(fillPrice);
  return {
    positionId,
    accountId,
    symbol: order.symbol,
    assetType: order.assetType,
    side,
    qty: order.quantity,
    averagePrice: markPrice,
    markPrice,
    marketValue: computeMarketValue(markPrice, order.quantity, order.assetType),
    unrealizedPnl: 0,
    currency: "USD",
    option: order.option || null,
    updatedAt: new Date().toISOString(),
  };
}

function positionKeyForOrder(order) {
  if (order.targetPositionId) {
    return String(order.targetPositionId);
  }

  if (order.assetType === "equity") {
    return `${order.accountId}-${order.symbol}-equity`;
  }

  const option = order.option || {
    expiry: order.expiry,
    strike: order.strike,
    right: order.right,
  };

  return `${order.accountId}-${order.symbol}-${option.expiry}-${option.strike}-${option.right}`;
}

function buildSyntheticOptionRows(symbol, expiry, underlyingPrice) {
  const increment = symbol === "SPY" ? 1 : 5;
  const centerStrike = Math.round(underlyingPrice / increment) * increment;
  const strikeSpan = symbol === "SPY" ? 60 : 30;
  const strikes = [];
  for (let offset = -strikeSpan; offset <= strikeSpan; offset += 1) {
    strikes.push(round2(centerStrike + offset * increment));
  }

  const dte = daysToExpiry(expiry);
  const nowBias = Math.sin(Date.now() / 1800000) * 0.08;
  const rows = [];

  for (const strike of strikes) {
    rows.push(
      buildOptionRow({
        symbol,
        expiry,
        right: "call",
        strike,
        underlyingPrice,
        dte,
        nowBias,
      }),
    );
    rows.push(
      buildOptionRow({
        symbol,
        expiry,
        right: "put",
        strike,
        underlyingPrice,
        dte,
        nowBias,
      }),
    );
  }

  return rows;
}

function buildOptionRow({ symbol, expiry, right, strike, underlyingPrice, dte, nowBias }) {
  const distance = Math.abs(strike - underlyingPrice);
  const distancePct = Math.min(0.45, distance / Math.max(underlyingPrice, 1));
  const iv = round4(0.14 + distancePct * 0.6 + Math.max(0, 0.11 - dte / 365) + nowBias);
  const timeValue = Math.max(0.06, underlyingPrice * iv * Math.sqrt(Math.max(dte, 1) / 365) * 0.038);
  const intrinsic =
    right === "call"
      ? Math.max(underlyingPrice - strike, 0)
      : Math.max(strike - underlyingPrice, 0);
  const mid = Math.max(0.05, intrinsic + timeValue);
  const spread = Math.max(0.01, Math.min(mid * 0.06, 0.35));
  const bid = round2(Math.max(0.01, mid - spread / 2));
  const ask = round2(Math.max(bid + 0.01, mid + spread / 2));
  const mark = round2((bid + ask) / 2);
  const delta = optionDelta(right, strike, underlyingPrice, dte, iv);
  const gamma = round4(Math.max(0.001, (1 - Math.abs(delta)) * 0.085 * Math.exp(-dte / 70)));
  const theta = round4(-(mark / Math.max(dte, 1)) * 0.92);
  const vega = round4(Math.max(0.004, mark * 0.075));
  const oi = Math.max(10, Math.round(1800 * Math.exp(-distancePct * 5) + hashToUnit(`${symbol}-${expiry}-${strike}-${right}`) * 150));
  const volume = Math.max(1, Math.round(oi * (0.02 + hashToUnit(`${right}-${strike}-${symbol}`) * 0.06)));
  const moneyness = round4((underlyingPrice - strike) / Math.max(underlyingPrice, 1));

  return {
    contractId: buildOptionContractId({
      symbol,
      expiry,
      strike,
      right,
    }),
    symbol,
    expiry,
    strike,
    right,
    bid,
    ask,
    last: mark,
    mark,
    iv,
    delta,
    gamma,
    theta,
    vega,
    oi,
    volume,
    moneyness,
    updatedAt: new Date().toISOString(),
  };
}

function optionDelta(right, strike, underlyingPrice, dte, iv) {
  const t = Math.max(dte / 365, 1 / 365);
  const vol = Math.max(iv, 0.05);
  const x = (underlyingPrice - strike) / (underlyingPrice * vol * Math.sqrt(t));
  const logistic = 1 / (1 + Math.exp(-x * 1.6));
  const rawCall = Math.min(0.99, Math.max(0.01, logistic));
  return round4(right === "call" ? rawCall : rawCall - 1);
}

function findAtmIndex(rows, underlyingPrice) {
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

function estimateSpotPrice(symbol) {
  const base =
    symbol === "SPY" ? 600
      : symbol === "QQQ" ? 520
        : symbol === "IWM" ? 220
          : 100;
  const hash = hashToUnit(symbol);
  const wave = Math.sin(Date.now() / 900000 + hash * Math.PI * 2) * (base * 0.0025);
  const drift = Math.cos(Date.now() / 3600000 + hash * 13) * (base * 0.0013);
  return round2(base + wave + drift);
}

function normalizeSymbol(symbol) {
  const value = String(symbol || "").trim().toUpperCase();
  return value || "SPY";
}

function normalizeExpiry(expiry) {
  const value = String(expiry || "").trim();
  if (value) {
    return value;
  }
  const fallback = new Date();
  fallback.setUTCDate(fallback.getUTCDate() + 30);
  return fallback.toISOString().slice(0, 10);
}

function normalizeResolution(value) {
  const raw = String(value || "5").trim().toUpperCase();
  if (!raw) {
    return "5";
  }
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

function alignToInterval(timestampMs, intervalMs) {
  return Math.floor(timestampMs / intervalMs) * intervalMs;
}

function daysToExpiry(expiry) {
  const target = new Date(`${expiry}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(target)) {
    return 30;
  }
  const now = Date.now();
  return Math.max(1, Math.round((target - now) / 86400000));
}

function hashToUnit(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 10000) / 10000;
}

function normalizeCapabilities(input, defaults = {}) {
  const source = input && typeof input === "object" ? input : {};
  const base = defaults && typeof defaults === "object" ? defaults : {};
  const out = {};
  for (const [key, value] of Object.entries(base)) {
    out[key] = Boolean(value);
  }
  for (const [key, value] of Object.entries(source)) {
    out[key] = Boolean(value);
  }
  return out;
}

function hasCredentialValue(value) {
  return value != null && String(value).trim() !== "";
}

function computeMarketValue(price, quantity, assetType) {
  const multiplier = assetType === "option" ? 100 : 1;
  return round2(price * quantity * multiplier);
}

function computeUnrealizedPnl(markPrice, avgPrice, quantity, assetType, side) {
  const multiplier = assetType === "option" ? 100 : 1;
  const raw = (markPrice - avgPrice) * quantity * multiplier;
  return round2(side === "long" ? raw : -raw);
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
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
  if (!Number.isFinite(Number(score))) {
    return "neutral";
  }
  if (score >= 0.4) return "strong_buy_pressure";
  if (score >= 0.15) return "buy_pressure";
  if (score <= -0.4) return "strong_sell_pressure";
  if (score <= -0.15) return "sell_pressure";
  return "neutral";
}
