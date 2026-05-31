import { useEffect, useMemo, useSyncExternalStore } from "react";
import { normalizeTickerSymbol } from "./tickerIdentity";

const positionMarketDataOwners = new Map();
const positionMarketDataListeners = new Set();

let positionMarketDataSymbols = [];
let positionMarketDataKey = "";

export const normalizePositionMarketDataSymbols = (symbols) => {
  const seen = new Set();
  return (symbols || []).flatMap((symbol) => {
    const normalized = normalizeTickerSymbol(String(symbol ?? ""));
    if (!normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [normalized];
  });
};

const rebuildPositionMarketDataSymbols = () => {
  const seen = new Set();
  const symbols = [];
  positionMarketDataOwners.forEach((ownerSymbols) => {
    ownerSymbols.forEach((symbol) => {
      if (!symbol || seen.has(symbol)) {
        return;
      }
      seen.add(symbol);
      symbols.push(symbol);
    });
  });
  const nextKey = symbols.join(",");
  if (nextKey === positionMarketDataKey) {
    return false;
  }
  positionMarketDataSymbols = symbols;
  positionMarketDataKey = nextKey;
  return true;
};

const notifyPositionMarketDataListeners = () => {
  positionMarketDataListeners.forEach((listener) => listener());
};

export const registerPositionMarketDataSymbols = (ownerId, symbols) => {
  const ownerKey = String(ownerId ?? "").trim();
  if (!ownerKey) {
    return () => {};
  }
  const normalizedSymbols = normalizePositionMarketDataSymbols(symbols);
  positionMarketDataOwners.set(ownerKey, normalizedSymbols);
  if (rebuildPositionMarketDataSymbols()) {
    notifyPositionMarketDataListeners();
  }

  return () => {
    if (!positionMarketDataOwners.has(ownerKey)) {
      return;
    }
    positionMarketDataOwners.delete(ownerKey);
    if (rebuildPositionMarketDataSymbols()) {
      notifyPositionMarketDataListeners();
    }
  };
};

export const getPositionMarketDataSymbolsSnapshot = () =>
  positionMarketDataSymbols;

const getPositionMarketDataKeySnapshot = () => positionMarketDataKey;

const subscribeToPositionMarketDataSymbols = (listener) => {
  positionMarketDataListeners.add(listener);
  return () => {
    positionMarketDataListeners.delete(listener);
  };
};

export const usePositionMarketDataSymbols = () => {
  const key = useSyncExternalStore(
    subscribeToPositionMarketDataSymbols,
    getPositionMarketDataKeySnapshot,
    getPositionMarketDataKeySnapshot,
  );
  return useMemo(() => getPositionMarketDataSymbolsSnapshot(), [key]);
};

export const useRegisterPositionMarketDataSymbols = (
  ownerId,
  symbols,
  enabled = true,
) => {
  const normalizedSymbols = useMemo(
    () => normalizePositionMarketDataSymbols(symbols),
    [symbols],
  );
  const symbolsKey = normalizedSymbols.join(",");

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    return registerPositionMarketDataSymbols(ownerId, normalizedSymbols);
  }, [enabled, ownerId, symbolsKey]);
};

export const __positionMarketDataStoreTestHooks = {
  clear: () => {
    positionMarketDataOwners.clear();
    if (rebuildPositionMarketDataSymbols()) {
      notifyPositionMarketDataListeners();
    }
  },
  ownerCount: () => positionMarketDataOwners.size,
};
