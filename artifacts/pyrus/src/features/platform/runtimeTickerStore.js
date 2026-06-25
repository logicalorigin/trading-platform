import { useMemo, useSyncExternalStore } from "react";
import { normalizeTickerSymbol } from "./tickerIdentity";

const hashSymbol = (symbol = "") =>
  symbol.split("").reduce((acc, char) => acc * 31 + char.charCodeAt(0), 7);

export const TRADE_TICKER_INFO = {
  SPY: {
    name: "SPDR S&P 500",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 100,
    chainSeed: 200,
    optSeed: 300,
  },
  QQQ: {
    name: "Invesco QQQ",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 101,
    chainSeed: 201,
    optSeed: 301,
  },
  NVDA: {
    name: "NVIDIA Corp",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 102,
    chainSeed: 202,
    optSeed: 302,
  },
  TSLA: {
    name: "Tesla Inc",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 103,
    chainSeed: 203,
    optSeed: 303,
  },
  AAPL: {
    name: "Apple Inc",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 104,
    chainSeed: 204,
    optSeed: 304,
  },
  META: {
    name: "Meta Platforms",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 105,
    chainSeed: 205,
    optSeed: 305,
  },
  AMZN: {
    name: "Amazon.com",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 106,
    chainSeed: 206,
    optSeed: 306,
  },
  MSFT: {
    name: "Microsoft Corp",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 107,
    chainSeed: 207,
    optSeed: 307,
  },
};

const PROTECTED_RUNTIME_TICKER_SYMBOLS = new Set(Object.keys(TRADE_TICKER_INFO));
const MAX_RUNTIME_TICKER_INFO_ENTRIES = 256;

const runtimeTickerSnapshotListeners = new Map();
const runtimeTickerSnapshotVersions = new Map();

const pruneRuntimeTickerInfoEntries = (exemptSymbol = null) => {
  const exempt = exemptSymbol?.toUpperCase?.() || null;
  const symbols = Object.keys(TRADE_TICKER_INFO);
  if (symbols.length <= MAX_RUNTIME_TICKER_INFO_ENTRIES) {
    return;
  }

  for (const symbol of symbols) {
    if (Object.keys(TRADE_TICKER_INFO).length <= MAX_RUNTIME_TICKER_INFO_ENTRIES) {
      break;
    }
    if (PROTECTED_RUNTIME_TICKER_SYMBOLS.has(symbol)) {
      continue;
    }
    if (symbol === exempt) {
      continue;
    }
    if ((runtimeTickerSnapshotListeners.get(symbol)?.size ?? 0) > 0) {
      continue;
    }
    delete TRADE_TICKER_INFO[symbol];
    runtimeTickerSnapshotVersions.delete(symbol);
  }
};

export const ensureTradeTickerInfo = (symbol, fallbackName = symbol) => {
  const normalized = symbol.toUpperCase();
  if (!TRADE_TICKER_INFO[normalized]) {
    const hash = hashSymbol(normalized);
    TRADE_TICKER_INFO[normalized] = {
      name: fallbackName,
      price: null,
      chg: null,
      pct: null,
      iv: null,
      barSeed: 400 + (hash % 200),
      chainSeed: 700 + (hash % 200),
      optSeed: 1000 + (hash % 200),
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: null,
      updatedAt: null,
      spark: [],
      sparkBars: [],
    };
    pruneRuntimeTickerInfoEntries(normalized);
  } else {
    if (
      fallbackName &&
      (!TRADE_TICKER_INFO[normalized].name ||
        TRADE_TICKER_INFO[normalized].name === normalized)
    ) {
      TRADE_TICKER_INFO[normalized].name = fallbackName;
    }
    if (!PROTECTED_RUNTIME_TICKER_SYMBOLS.has(normalized)) {
      const current = TRADE_TICKER_INFO[normalized];
      delete TRADE_TICKER_INFO[normalized];
      TRADE_TICKER_INFO[normalized] = current;
    }
  }

  if (!Array.isArray(TRADE_TICKER_INFO[normalized].spark)) {
    TRADE_TICKER_INFO[normalized].spark = [];
  }
  if (!Array.isArray(TRADE_TICKER_INFO[normalized].sparkBars)) {
    TRADE_TICKER_INFO[normalized].sparkBars = [];
  }

  return TRADE_TICKER_INFO[normalized];
};

export const getRuntimeTickerStoreEntryCount = () =>
  Object.keys(TRADE_TICKER_INFO).length;

export const getRuntimeTickerStoreCap = () => MAX_RUNTIME_TICKER_INFO_ENTRIES;

const RUNTIME_QUOTE_FIELDS = new Set([
  "price",
  "bid",
  "ask",
  "last",
  "mark",
  "chg",
  "change",
  "pct",
  "changePercent",
  "open",
  "high",
  "low",
  "prevClose",
  "extendedBaselinePrice",
  "extendedBaselineAt",
  "extendedBaselineSource",
  "volume",
  "updatedAt",
  "dataUpdatedAt",
  "freshness",
  "marketDataMode",
  "delayed",
  "source",
  "transport",
  "latency",
]);

const normalizeRuntimeTickerSymbols = (symbols) => (
  Array.from(
    new Set(
      (symbols || [])
        .map((symbol) => symbol?.trim?.().toUpperCase?.() || "")
        .filter(Boolean),
    ),
  ).sort()
);

const RUNTIME_TICKER_NOTIFY_DEBOUNCE_MS = 100;
const RUNTIME_QUOTE_FUTURE_TOLERANCE_MS = 2 * 60 * 1000;
const pendingRuntimeTickerSnapshotSymbols = new Set();
let runtimeTickerSnapshotFlushTimer = null;

const maxFiniteNumber = (...values) => {
  let max = null;
  values.forEach((value) => {
    if (!Number.isFinite(value)) {
      return;
    }
    max = max == null ? value : Math.max(max, value);
  });
  return max;
};

const readRuntimeNowMs = () => {
  if (typeof Date.now !== "function") {
    return null;
  }
  const timestamp = Date.now();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const flushRuntimeTickerSnapshotNotifications = () => {
  if (runtimeTickerSnapshotFlushTimer != null) {
    globalThis.clearTimeout?.(runtimeTickerSnapshotFlushTimer);
    runtimeTickerSnapshotFlushTimer = null;
  }

  const symbols = normalizeRuntimeTickerSymbols(
    Array.from(pendingRuntimeTickerSnapshotSymbols),
  );
  pendingRuntimeTickerSnapshotSymbols.clear();
  if (!symbols.length) {
    return;
  }

  const listenersToNotify = new Set();
  symbols.forEach((symbol) => {
    runtimeTickerSnapshotVersions.set(
      symbol,
      (runtimeTickerSnapshotVersions.get(symbol) ?? 0) + 1,
    );
    Array.from(runtimeTickerSnapshotListeners.get(symbol) || []).forEach(
      (listener) => {
        listenersToNotify.add(listener);
      },
    );
  });
  listenersToNotify.forEach((listener) => listener());
};

const scheduleRuntimeTickerSnapshotNotifications = () => {
  if (runtimeTickerSnapshotFlushTimer != null) {
    return;
  }
  if (typeof globalThis.setTimeout !== "function") {
    flushRuntimeTickerSnapshotNotifications();
    return;
  }

  runtimeTickerSnapshotFlushTimer = globalThis.setTimeout(() => {
    runtimeTickerSnapshotFlushTimer = null;
    flushRuntimeTickerSnapshotNotifications();
  }, RUNTIME_TICKER_NOTIFY_DEBOUNCE_MS);
};

const areDateValuesEqual = (left, right) => {
  if (left === right) {
    return true;
  }

  const leftMs = readRuntimeQuoteTimestampMs(left);
  const rightMs = readRuntimeQuoteTimestampMs(right);

  if (leftMs === null || rightMs === null) {
    return left == null && right == null;
  }

  return leftMs === rightMs;
};

const readRuntimeQuoteTimestampMs = (value) => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    const abs = Math.abs(value);
    if (abs >= 1e11) {
      return value;
    }
    if (abs >= 1e9) {
      return value * 1_000;
    }
    return value;
  }

  if (typeof value === "string") {
    const timestamp = Date.parse(String(value));
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return null;
};

const readRuntimeSnapshotTimestampMs = (value) =>
  readRuntimeQuoteTimestampMs(value?.dataUpdatedAt) ??
  readRuntimeQuoteTimestampMs(value?.updatedAt);

const readRuntimeWrapperTimestampMs = (value) =>
  readRuntimeQuoteTimestampMs(value?.updatedAt);

const readRuntimeReceivedAtMs = (value) => {
  const latency = value?.latency;
  return readRuntimeQuoteTimestampMs(
    latency && typeof latency === "object"
      ? latency.apiServerReceivedAt ?? latency.apiServerEmittedAt
      : null,
  );
};

const isRuntimeQuoteTimestampTooFarAhead = (timestampMs, referenceMs) =>
  timestampMs !== null &&
  referenceMs !== null &&
  timestampMs - referenceMs > RUNTIME_QUOTE_FUTURE_TOLERANCE_MS;

const areSparkPointsEqual = (left, right) => {
  if (left === right) {
    return true;
  }

  const leftPoints = Array.isArray(left) ? left : [];
  const rightPoints = Array.isArray(right) ? right : [];
  if (leftPoints.length !== rightPoints.length) {
    return false;
  }

  for (let index = 0; index < leftPoints.length; index += 1) {
    const current = leftPoints[index];
    const next = rightPoints[index];
    if (
      !current ||
      !next ||
      current.i !== next.i ||
      current.v !== next.v ||
      resolveRuntimeBarTimeMs(current) !== resolveRuntimeBarTimeMs(next)
    ) {
      return false;
    }
  }

  return true;
};

const resolveRuntimeBarTimeMs = (bar) => {
  if (!bar) {
    return null;
  }
  if (bar.timestamp instanceof Date) {
    return bar.timestamp.getTime();
  }
  if (typeof bar.timestamp === "string" || typeof bar.timestamp === "number") {
    const parsed = Date.parse(String(bar.timestamp));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (bar.time instanceof Date) {
    return bar.time.getTime();
  }
  if (typeof bar.time === "string" || typeof bar.time === "number") {
    const parsed = Date.parse(String(bar.time));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const areSparkBarsEqual = (left, right) => {
  if (left === right) {
    return true;
  }

  const leftBars = Array.isArray(left) ? left : [];
  const rightBars = Array.isArray(right) ? right : [];
  if (leftBars.length !== rightBars.length) {
    return false;
  }

  for (let index = 0; index < leftBars.length; index += 1) {
    const current = leftBars[index];
    const next = rightBars[index];
    if (
      resolveRuntimeBarTimeMs(current) !== resolveRuntimeBarTimeMs(next) ||
      (current?.close ?? current?.c ?? null) !== (next?.close ?? next?.c ?? null) ||
      (current?.volume ?? current?.v ?? null) !== (next?.volume ?? next?.v ?? null)
    ) {
      return false;
    }
  }

  return true;
};

const isRuntimeTickerFieldEqual = (field, currentValue, nextValue) => {
  if (field === "updatedAt") {
    return areDateValuesEqual(currentValue, nextValue);
  }
  if (field === "spark") {
    return areSparkPointsEqual(currentValue, nextValue);
  }
  if (field === "sparkBars") {
    return areSparkBarsEqual(currentValue, nextValue);
  }
  return Object.is(currentValue, nextValue);
};

export const applyRuntimeTickerInfoPatch = (symbol, fallbackName, patch) => {
  const tradeInfo = ensureTradeTickerInfo(symbol, fallbackName);
  let changed = false;
  const hasQuoteFields = Object.keys(patch || {}).some((field) =>
    RUNTIME_QUOTE_FIELDS.has(field),
  );
  const nowMs = readRuntimeNowMs();
  const currentReceivedAtMs = readRuntimeReceivedAtMs(tradeInfo);
  const incomingReceivedAtMs = readRuntimeReceivedAtMs(patch);
  const timestampReferenceMs = maxFiniteNumber(
    nowMs,
    currentReceivedAtMs,
    incomingReceivedAtMs,
  );
  const rawCurrentQuoteTimestampMs = readRuntimeSnapshotTimestampMs(tradeInfo);
  const rawIncomingQuoteTimestampMs = readRuntimeSnapshotTimestampMs(patch);
  const currentQuoteTimestampIsFuture = isRuntimeQuoteTimestampTooFarAhead(
    rawCurrentQuoteTimestampMs,
    timestampReferenceMs,
  );
  const incomingQuoteTimestampIsFuture = isRuntimeQuoteTimestampTooFarAhead(
    rawIncomingQuoteTimestampMs,
    timestampReferenceMs,
  );
  const currentQuoteTimestampMs = currentQuoteTimestampIsFuture
    ? null
    : rawCurrentQuoteTimestampMs;
  const incomingQuoteTimestampMs = incomingQuoteTimestampIsFuture
    ? null
    : rawIncomingQuoteTimestampMs;
  let quotePatchIsOlder =
    hasQuoteFields &&
    (incomingQuoteTimestampIsFuture ||
      (currentQuoteTimestampMs !== null &&
        (incomingQuoteTimestampMs === null ||
          incomingQuoteTimestampMs < currentQuoteTimestampMs)));
  let quotePatchHasSameTimestamp =
    hasQuoteFields &&
    currentQuoteTimestampMs !== null &&
    incomingQuoteTimestampMs !== null &&
    incomingQuoteTimestampMs === currentQuoteTimestampMs;

  if (quotePatchHasSameTimestamp) {
    const currentWrapperTimestampMs = readRuntimeWrapperTimestampMs(tradeInfo);
    const incomingWrapperTimestampMs = readRuntimeWrapperTimestampMs(patch);
    if (
      currentWrapperTimestampMs !== null &&
      incomingWrapperTimestampMs !== null &&
      incomingWrapperTimestampMs !== currentWrapperTimestampMs
    ) {
      quotePatchIsOlder = incomingWrapperTimestampMs < currentWrapperTimestampMs;
      quotePatchHasSameTimestamp = false;
    } else {
      const currentReceivedAtMs = readRuntimeReceivedAtMs(tradeInfo);
      const incomingReceivedAtMs = readRuntimeReceivedAtMs(patch);
      if (
        currentReceivedAtMs !== null &&
        incomingReceivedAtMs !== null &&
        incomingReceivedAtMs !== currentReceivedAtMs
      ) {
        quotePatchIsOlder = incomingReceivedAtMs < currentReceivedAtMs;
        quotePatchHasSameTimestamp = false;
      }
    }
  }

  Object.entries(patch).forEach(([field, nextValue]) => {
    if (quotePatchIsOlder && RUNTIME_QUOTE_FIELDS.has(field)) {
      return;
    }
    // Equal provider timestamps are common on batched live quote frames; after
    // the older-frame checks above, accept the arriving value and notify readers.
    if (isRuntimeTickerFieldEqual(field, tradeInfo[field], nextValue)) {
      return;
    }

    tradeInfo[field] = nextValue;
    changed = true;
  });

  return {
    tradeInfo,
    changed,
  };
};

export const notifyRuntimeTickerSnapshotSymbols = (symbols) => {
  const normalizedSymbols = normalizeRuntimeTickerSymbols(symbols);
  if (!normalizedSymbols.length) {
    return;
  }
  normalizedSymbols.forEach((symbol) => {
    pendingRuntimeTickerSnapshotSymbols.add(symbol);
  });
  scheduleRuntimeTickerSnapshotNotifications();
};

const subscribeToRuntimeTickerSnapshotSymbols = (symbols, listener) => {
  const normalizedSymbols = normalizeRuntimeTickerSymbols(symbols);
  normalizedSymbols.forEach((symbol) => {
    const listeners = runtimeTickerSnapshotListeners.get(symbol) || new Set();
    listeners.add(listener);
    runtimeTickerSnapshotListeners.set(symbol, listeners);
  });

  return () => {
    normalizedSymbols.forEach((symbol) => {
      const listeners = runtimeTickerSnapshotListeners.get(symbol);
      if (!listeners) {
        return;
      }
      listeners.delete(listener);
      if (listeners.size === 0) {
        runtimeTickerSnapshotListeners.delete(symbol);
      }
    });
  };
};

export const __runtimeTickerStoreTestHooks = {
  subscribeToRuntimeTickerSnapshotSymbols,
  flushRuntimeTickerSnapshotNotifications,
  clearPendingRuntimeTickerSnapshotNotifications: () => {
    if (runtimeTickerSnapshotFlushTimer != null) {
      globalThis.clearTimeout?.(runtimeTickerSnapshotFlushTimer);
      runtimeTickerSnapshotFlushTimer = null;
    }
    pendingRuntimeTickerSnapshotSymbols.clear();
  },
};

export const getRuntimeTickerSnapshot = (symbol, fallback = null) => {
  const info = TRADE_TICKER_INFO[symbol];
  if (info) return info;

  return fallback;
};

export const useRuntimeTickerSnapshot = (
  symbol,
  fallback = null,
  { subscribe = true } = {},
) => {
  const normalizedSymbol = useMemo(() => normalizeTickerSymbol(symbol), [symbol]);
  useSyncExternalStore(
    subscribe && normalizedSymbol
      ? (listener) =>
          subscribeToRuntimeTickerSnapshotSymbols([normalizedSymbol], listener)
      : () => () => {},
    subscribe && normalizedSymbol
      ? () => runtimeTickerSnapshotVersions.get(normalizedSymbol) ?? 0
      : () => 0,
    () => 0,
  );
  return getRuntimeTickerSnapshot(normalizedSymbol, fallback) || fallback;
};

export const useRuntimeTickerSnapshots = (symbols) => {
  const normalizedSymbols = useMemo(
    () => normalizeRuntimeTickerSymbols(symbols),
    [symbols],
  );
  const symbolsKey = useMemo(
    () => normalizedSymbols.join(","),
    [normalizedSymbols],
  );

  const version = useSyncExternalStore(
    (listener) => subscribeToRuntimeTickerSnapshotSymbols(normalizedSymbols, listener),
    () =>
      normalizedSymbols
        .map((symbol) => `${symbol}:${runtimeTickerSnapshotVersions.get(symbol) ?? 0}`)
        .join("|"),
    () => "",
  );

  return useMemo(
    () =>
      Object.fromEntries(
        normalizedSymbols.map((symbol) => [
          symbol,
          getRuntimeTickerSnapshot(symbol, null),
        ]),
      ),
    [normalizedSymbols, symbolsKey, version],
  );
};

export const publishRuntimeTickerSnapshot = (symbol, fallbackName, patch) => {
  const normalizedSymbol = normalizeTickerSymbol(symbol);
  if (!normalizedSymbol) {
    return null;
  }

  const result = applyRuntimeTickerInfoPatch(
    normalizedSymbol,
    fallbackName,
    patch,
  );
  if (result?.changed) {
    notifyRuntimeTickerSnapshotSymbols([normalizedSymbol]);
  }
  return result?.tradeInfo || null;
};
