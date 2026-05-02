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
  } else if (
    fallbackName &&
    (!TRADE_TICKER_INFO[normalized].name ||
      TRADE_TICKER_INFO[normalized].name === normalized)
  ) {
    TRADE_TICKER_INFO[normalized].name = fallbackName;
  }

  if (!Array.isArray(TRADE_TICKER_INFO[normalized].spark)) {
    TRADE_TICKER_INFO[normalized].spark = [];
  }
  if (!Array.isArray(TRADE_TICKER_INFO[normalized].sparkBars)) {
    TRADE_TICKER_INFO[normalized].sparkBars = [];
  }

  return TRADE_TICKER_INFO[normalized];
};

const runtimeTickerSnapshotListeners = new Map();
const runtimeTickerSnapshotVersions = new Map();

const normalizeRuntimeTickerSymbols = (symbols) => (
  Array.from(
    new Set(
      (symbols || [])
        .map((symbol) => symbol?.trim?.().toUpperCase?.() || "")
        .filter(Boolean),
    ),
  ).sort()
);

const areDateValuesEqual = (left, right) => {
  if (left === right) {
    return true;
  }

  const leftMs =
    left instanceof Date
      ? left.getTime()
      : typeof left === "string" || typeof left === "number"
        ? Date.parse(String(left))
        : Number.NaN;
  const rightMs =
    right instanceof Date
      ? right.getTime()
      : typeof right === "string" || typeof right === "number"
        ? Date.parse(String(right))
        : Number.NaN;

  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return left == null && right == null;
  }

  return leftMs === rightMs;
};

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
    if (!current || !next || current.i !== next.i || current.v !== next.v) {
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

  Object.entries(patch).forEach(([field, nextValue]) => {
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
  normalizeRuntimeTickerSymbols(symbols).forEach((symbol) => {
    runtimeTickerSnapshotVersions.set(
      symbol,
      (runtimeTickerSnapshotVersions.get(symbol) ?? 0) + 1,
    );
    Array.from(runtimeTickerSnapshotListeners.get(symbol) || []).forEach((listener) =>
      listener(),
    );
  });
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
