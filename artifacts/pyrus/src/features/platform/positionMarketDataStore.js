import { useEffect, useMemo, useSyncExternalStore } from "react";
import { normalizeTickerSymbol } from "./tickerIdentity";

const positionMarketDataOwners = new Map();
const positionMarketDataListeners = new Set();
const positionQuoteSnapshotsBySymbol = new Map();
const positionQuoteSnapshotListeners = new Set();

let positionMarketDataSymbols = [];
let positionMarketDataKey = "";
let positionMarketDataSymbolSet = new Set();
let positionQuoteSnapshotVersion = 0;

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
  positionMarketDataSymbolSet = seen;
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

const notifyPositionQuoteSnapshotListeners = () => {
  positionQuoteSnapshotVersion += 1;
  positionQuoteSnapshotListeners.forEach((listener) => listener());
};

const prunePositionQuoteSnapshots = () => {
  let changed = 0;
  positionQuoteSnapshotsBySymbol.forEach((_, symbol) => {
    if (!positionMarketDataSymbolSet.has(symbol)) {
      positionQuoteSnapshotsBySymbol.delete(symbol);
      changed += 1;
    }
  });
  if (changed > 0) {
    notifyPositionQuoteSnapshotListeners();
  }
  return changed;
};

const areShallowSnapshotsEqual = (left, right) => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!Object.is(left[key], right[key])) {
      return false;
    }
  }
  return true;
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
  prunePositionQuoteSnapshots();

  return () => {
    if (!positionMarketDataOwners.has(ownerKey)) {
      return;
    }
    positionMarketDataOwners.delete(ownerKey);
    if (rebuildPositionMarketDataSymbols()) {
      notifyPositionMarketDataListeners();
    }
    prunePositionQuoteSnapshots();
  };
};

export const getPositionMarketDataSymbolsSnapshot = () =>
  positionMarketDataSymbols;

const getPositionMarketDataKeySnapshot = () => positionMarketDataKey;

const getPositionQuoteSnapshotVersion = () => positionQuoteSnapshotVersion;

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

const subscribeToPositionQuoteSnapshots = (listener) => {
  positionQuoteSnapshotListeners.add(listener);
  return () => {
    positionQuoteSnapshotListeners.delete(listener);
  };
};

export const applyPositionQuoteSnapshots = (quotes = []) => {
  let changed = 0;
  (quotes || []).forEach((quote) => {
    const symbol = normalizeTickerSymbol(String(quote?.symbol ?? ""));
    if (!symbol) {
      return;
    }
    if (!positionMarketDataSymbolSet.has(symbol)) {
      return;
    }
    const next = {
      ...(positionQuoteSnapshotsBySymbol.get(symbol) || {}),
      ...quote,
      symbol,
    };
    if (areShallowSnapshotsEqual(positionQuoteSnapshotsBySymbol.get(symbol), next)) {
      return;
    }
    positionQuoteSnapshotsBySymbol.set(symbol, next);
    changed += 1;
  });
  if (changed > 0) {
    notifyPositionQuoteSnapshotListeners();
  }
  return changed;
};

export const getPositionQuoteSnapshot = (symbol) =>
  positionQuoteSnapshotsBySymbol.get(
    normalizeTickerSymbol(String(symbol ?? "")),
  ) || null;

export const usePositionQuoteSnapshots = (symbols = []) => {
  const normalizedSymbols = useMemo(
    () => normalizePositionMarketDataSymbols(symbols),
    [symbols],
  );
  const symbolsKey = normalizedSymbols.join(",");
  const version = useSyncExternalStore(
    subscribeToPositionQuoteSnapshots,
    getPositionQuoteSnapshotVersion,
    getPositionQuoteSnapshotVersion,
  );
  return useMemo(
    () =>
      Object.fromEntries(
        normalizedSymbols.flatMap((symbol) => {
          const snapshot = positionQuoteSnapshotsBySymbol.get(symbol);
          return snapshot ? [[symbol, snapshot]] : [];
        }),
      ),
    [symbolsKey, version],
  );
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
    positionQuoteSnapshotsBySymbol.clear();
    if (rebuildPositionMarketDataSymbols()) {
      notifyPositionMarketDataListeners();
    }
    notifyPositionQuoteSnapshotListeners();
  },
  ownerCount: () => positionMarketDataOwners.size,
  quoteCount: () => positionQuoteSnapshotsBySymbol.size,
};
