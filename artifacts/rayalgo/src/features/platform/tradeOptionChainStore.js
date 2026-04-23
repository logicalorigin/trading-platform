import { useMemo, useSyncExternalStore } from "react";

const EMPTY_TRADE_OPTION_CHAIN_SNAPSHOT = Object.freeze({
  expirationOptions: Object.freeze([]),
  rowsByExpiration: Object.freeze({}),
  status: "empty",
});

const storeEntries = new Map();

const normalizeTicker = (ticker) => ticker?.trim?.().toUpperCase?.() || "";

const normalizeTimestamp = (value) => {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const ensureEntry = (ticker) => {
  const normalizedTicker = normalizeTicker(ticker) || "__empty__";
  if (!storeEntries.has(normalizedTicker)) {
    storeEntries.set(normalizedTicker, {
      version: 0,
      snapshot: EMPTY_TRADE_OPTION_CHAIN_SNAPSHOT,
      listeners: new Set(),
    });
  }
  return storeEntries.get(normalizedTicker);
};

const areExpirationOptionsEquivalent = (left = [], right = []) => {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (
      current?.value !== next?.value ||
      current?.label !== next?.label ||
      current?.dte !== next?.dte ||
      normalizeTimestamp(current?.actualDate) !== normalizeTimestamp(next?.actualDate)
    ) {
      return false;
    }
  }

  return true;
};

const areChainRowsEquivalent = (left = [], right = []) => {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (
      current?.k !== next?.k ||
      current?.cContract?.providerContractId !== next?.cContract?.providerContractId ||
      current?.pContract?.providerContractId !== next?.pContract?.providerContractId ||
      current?.cPrem !== next?.cPrem ||
      current?.cBid !== next?.cBid ||
      current?.cAsk !== next?.cAsk ||
      current?.cVol !== next?.cVol ||
      current?.cOi !== next?.cOi ||
      current?.cIv !== next?.cIv ||
      current?.cDelta !== next?.cDelta ||
      current?.cGamma !== next?.cGamma ||
      current?.cTheta !== next?.cTheta ||
      current?.cVega !== next?.cVega ||
      current?.pPrem !== next?.pPrem ||
      current?.pBid !== next?.pBid ||
      current?.pAsk !== next?.pAsk ||
      current?.pVol !== next?.pVol ||
      current?.pOi !== next?.pOi ||
      current?.pIv !== next?.pIv ||
      current?.pDelta !== next?.pDelta ||
      current?.pGamma !== next?.pGamma ||
      current?.pTheta !== next?.pTheta ||
      current?.pVega !== next?.pVega
    ) {
      return false;
    }
  }

  return true;
};

const areRowsByExpirationEquivalent = (left = {}, right = {}) => {
  if (left === right) return true;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!rightKeys.includes(key)) {
      return false;
    }
    if (!areChainRowsEquivalent(left[key], right[key])) {
      return false;
    }
  }

  return true;
};

export const publishTradeOptionChainSnapshot = (ticker, nextSnapshot) => {
  const entry = ensureEntry(ticker);
  const normalizedSnapshot = nextSnapshot
    ? {
        expirationOptions:
          nextSnapshot.expirationOptions ||
          EMPTY_TRADE_OPTION_CHAIN_SNAPSHOT.expirationOptions,
        rowsByExpiration:
          nextSnapshot.rowsByExpiration ||
          EMPTY_TRADE_OPTION_CHAIN_SNAPSHOT.rowsByExpiration,
        status: nextSnapshot.status || "empty",
      }
    : EMPTY_TRADE_OPTION_CHAIN_SNAPSHOT;

  if (
    entry.snapshot.status === normalizedSnapshot.status &&
    areExpirationOptionsEquivalent(
      entry.snapshot.expirationOptions,
      normalizedSnapshot.expirationOptions,
    ) &&
    areRowsByExpirationEquivalent(
      entry.snapshot.rowsByExpiration,
      normalizedSnapshot.rowsByExpiration,
    )
  ) {
    return;
  }

  entry.snapshot = normalizedSnapshot;
  entry.version += 1;
  entry.listeners.forEach((listener) => listener());
};

export const getTradeOptionChainSnapshot = (ticker) =>
  ensureEntry(ticker).snapshot || EMPTY_TRADE_OPTION_CHAIN_SNAPSHOT;

const subscribeToTradeOptionChainSnapshot = (ticker, listener) => {
  const entry = ensureEntry(ticker);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
};

const getTradeOptionChainSnapshotVersion = (ticker) => ensureEntry(ticker).version;

export const useTradeOptionChainSnapshot = (
  ticker,
  { subscribe = true } = {},
) => {
  const normalizedTicker = useMemo(() => normalizeTicker(ticker), [ticker]);

  useSyncExternalStore(
    subscribe && normalizedTicker
      ? (listener) => subscribeToTradeOptionChainSnapshot(normalizedTicker, listener)
      : () => () => {},
    subscribe && normalizedTicker
      ? () => getTradeOptionChainSnapshotVersion(normalizedTicker)
      : () => 0,
    () => 0,
  );

  return getTradeOptionChainSnapshot(normalizedTicker);
};

export const resolveTradeOptionChainSnapshot = (
  snapshot,
  expirationValue,
) => {
  const expirationOptions = snapshot?.expirationOptions || [];
  const resolvedExpiration =
    expirationOptions.find((option) => option.value === expirationValue) ||
    expirationOptions[0] ||
    null;
  const resolvedRows =
    (resolvedExpiration &&
      snapshot?.rowsByExpiration?.[resolvedExpiration.value]) ||
    (expirationValue && snapshot?.rowsByExpiration?.[expirationValue]) ||
    [];

  return {
    expirationOptions,
    resolvedExpiration,
    chainRows: resolvedRows,
    chainStatus: snapshot?.status || "empty",
  };
};
