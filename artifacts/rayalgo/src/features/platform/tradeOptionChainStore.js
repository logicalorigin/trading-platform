import { useMemo, useSyncExternalStore } from "react";

const EMPTY_TRADE_OPTION_CHAIN_SNAPSHOT = Object.freeze({
  expirationOptions: Object.freeze([]),
  rowsByExpiration: Object.freeze({}),
  loadingExpirations: Object.freeze([]),
  statusByExpiration: Object.freeze({}),
  loadedExpirationCount: 0,
  completedExpirationCount: 0,
  emptyExpirationCount: 0,
  failedExpirationCount: 0,
  totalExpirationCount: 0,
  updatedAt: null,
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
      current?.chainKey !== next?.chainKey ||
      current?.isoDate !== next?.isoDate ||
      current?.label !== next?.label ||
      current?.dte !== next?.dte ||
      normalizeTimestamp(current?.actualDate) !== normalizeTimestamp(next?.actualDate)
    ) {
      return false;
    }
  }

  return true;
};

const areStringArraysEquivalent = (left = [], right = []) => {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
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

const areStatusMapsEquivalent = (left = {}, right = {}) => {
  if (left === right) return true;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
};

const normalizeExpirationKey = (expiration) =>
  expiration?.chainKey || expiration?.isoDate || expiration?.value || null;

const normalizeUpdatedAt = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return normalizeTimestamp(value);
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
        loadingExpirations: Array.isArray(nextSnapshot.loadingExpirations)
          ? [...nextSnapshot.loadingExpirations].sort()
          : EMPTY_TRADE_OPTION_CHAIN_SNAPSHOT.loadingExpirations,
        statusByExpiration:
          nextSnapshot.statusByExpiration ||
          EMPTY_TRADE_OPTION_CHAIN_SNAPSHOT.statusByExpiration,
        loadedExpirationCount:
          Number.isFinite(nextSnapshot.loadedExpirationCount)
            ? nextSnapshot.loadedExpirationCount
            : 0,
        completedExpirationCount:
          Number.isFinite(nextSnapshot.completedExpirationCount)
            ? nextSnapshot.completedExpirationCount
            : 0,
        emptyExpirationCount:
          Number.isFinite(nextSnapshot.emptyExpirationCount)
            ? nextSnapshot.emptyExpirationCount
            : 0,
        failedExpirationCount:
          Number.isFinite(nextSnapshot.failedExpirationCount)
            ? nextSnapshot.failedExpirationCount
            : 0,
        totalExpirationCount:
          Number.isFinite(nextSnapshot.totalExpirationCount)
            ? nextSnapshot.totalExpirationCount
            : 0,
        updatedAt: normalizeUpdatedAt(nextSnapshot.updatedAt),
        status: nextSnapshot.status || "empty",
      }
    : EMPTY_TRADE_OPTION_CHAIN_SNAPSHOT;

  if (
    entry.snapshot.status === normalizedSnapshot.status &&
    areExpirationOptionsEquivalent(
      entry.snapshot.expirationOptions,
      normalizedSnapshot.expirationOptions,
    ) &&
    areStringArraysEquivalent(
      entry.snapshot.loadingExpirations,
      normalizedSnapshot.loadingExpirations,
    ) &&
    areStatusMapsEquivalent(
      entry.snapshot.statusByExpiration,
      normalizedSnapshot.statusByExpiration,
    ) &&
    entry.snapshot.loadedExpirationCount ===
      normalizedSnapshot.loadedExpirationCount &&
    entry.snapshot.completedExpirationCount ===
      normalizedSnapshot.completedExpirationCount &&
    entry.snapshot.emptyExpirationCount ===
      normalizedSnapshot.emptyExpirationCount &&
    entry.snapshot.failedExpirationCount ===
      normalizedSnapshot.failedExpirationCount &&
    entry.snapshot.totalExpirationCount ===
      normalizedSnapshot.totalExpirationCount &&
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
    expirationOptions.find(
      (option) =>
        option.value === expirationValue ||
        option.chainKey === expirationValue ||
        option.isoDate === expirationValue,
    ) ||
    expirationOptions[0] ||
    null;
  const resolvedExpirationKey = normalizeExpirationKey(resolvedExpiration);
  const resolvedRows =
    (resolvedExpiration &&
      snapshot?.rowsByExpiration?.[resolvedExpirationKey]) ||
    (resolvedExpiration &&
      snapshot?.rowsByExpiration?.[resolvedExpiration.value]) ||
    (expirationValue && snapshot?.rowsByExpiration?.[expirationValue]) ||
    [];
  const loadingExpirations = snapshot?.loadingExpirations || [];
  const statusByExpiration = snapshot?.statusByExpiration || {};
  const resolvedExpirationStatus =
    (resolvedExpirationKey && statusByExpiration[resolvedExpirationKey]) ||
    (resolvedExpiration?.value && statusByExpiration[resolvedExpiration.value]) ||
    "empty";
  const isResolvedExpirationLoading = Boolean(
    resolvedExpirationKey &&
      (loadingExpirations.includes(resolvedExpirationKey) ||
        resolvedExpirationStatus === "loading") &&
      !resolvedRows.length,
  );

  return {
    expirationOptions,
    resolvedExpiration,
    resolvedExpirationKey,
    chainRows: resolvedRows,
    chainStatus: snapshot?.status || "empty",
    loadingExpirations,
    statusByExpiration,
    resolvedExpirationStatus,
    loadedExpirationCount: snapshot?.loadedExpirationCount || 0,
    completedExpirationCount: snapshot?.completedExpirationCount || 0,
    emptyExpirationCount: snapshot?.emptyExpirationCount || 0,
    failedExpirationCount: snapshot?.failedExpirationCount || 0,
    totalExpirationCount: snapshot?.totalExpirationCount || expirationOptions.length,
    updatedAt: snapshot?.updatedAt || null,
    isResolvedExpirationLoading,
  };
};
