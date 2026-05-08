import Dexie from "dexie";

export const RUNTIME_CACHE_DB_NAME = "rayalgo-runtime-cache";
export const RUNTIME_CACHE_DB_VERSION = 1;

export const RUNTIME_CACHE_TTL_MS = {
  chartBarsHistorical: 24 * 60 * 60 * 1000,
  chartBarsIntraday: 15 * 60 * 1000,
  flowEvents: 30 * 60 * 1000,
  optionChains: 10 * 60 * 1000,
};

let runtimeCacheDb = null;
let runtimeCacheUnavailable = false;

const hasIndexedDb = () =>
  typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

export const isRuntimeCacheAvailable = () =>
  !runtimeCacheUnavailable && hasIndexedDb();

export const getRuntimeCacheDb = () => {
  if (!isRuntimeCacheAvailable()) {
    return null;
  }
  if (runtimeCacheDb) {
    return runtimeCacheDb;
  }

  runtimeCacheDb = new Dexie(RUNTIME_CACHE_DB_NAME);
  runtimeCacheDb.version(RUNTIME_CACHE_DB_VERSION).stores({
    chartBars: "&cacheKey, ticker, interval, session, source, updatedAt, expiresAt",
    flowEvents: "&cacheKey, ticker, provider, filterSignature, updatedAt, expiresAt",
    optionChains:
      "&cacheKey, underlying, expiration, coverage, marketDataMode, updatedAt, expiresAt",
    meta: "&key, updatedAt",
  });
  return runtimeCacheDb;
};

const normalizeKeyPart = (value) =>
  String(value ?? "__missing__")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[:|]/g, "_") || "__missing__";

const normalizeTicker = (value) => normalizeKeyPart(value).toUpperCase();

export const buildChartBarsCacheKey = ({
  symbol,
  timeframe,
  session = "regular",
  source = "trades",
  identity = "",
} = {}) =>
  [
    "bars",
    normalizeTicker(symbol),
    normalizeKeyPart(timeframe),
    normalizeKeyPart(session),
    normalizeKeyPart(source),
    normalizeKeyPart(identity),
  ].join(":");

export const buildFlowEventsCacheKey = ({
  ticker,
  provider = "flow",
  filterSignature = "default",
} = {}) =>
  [
    "flow",
    normalizeTicker(ticker || "ALL"),
    normalizeKeyPart(provider),
    normalizeKeyPart(filterSignature),
  ].join(":");

export const buildOptionChainSnapshotCacheKey = ({
  underlying,
  expiration = "all",
  coverage = "window",
  marketDataMode = "metadata",
} = {}) =>
  [
    "options",
    normalizeTicker(underlying),
    normalizeKeyPart(expiration),
    normalizeKeyPart(coverage),
    normalizeKeyPart(marketDataMode),
  ].join(":");

export const isRuntimeCacheEntryFresh = (entry, nowMs = Date.now()) =>
  Boolean(entry && Number.isFinite(entry.expiresAt) && entry.expiresAt > nowMs);

const readCacheEntry = async (tableName, cacheKey, nowMs = Date.now()) => {
  const db = getRuntimeCacheDb();
  if (!db || !cacheKey) return null;
  try {
    const entry = await db.table(tableName).get(cacheKey);
    if (!isRuntimeCacheEntryFresh(entry, nowMs)) {
      if (entry) {
        void db.table(tableName).delete(cacheKey);
      }
      return null;
    }
    return entry.payload ?? null;
  } catch (error) {
    runtimeCacheUnavailable = true;
    console.warn(`[rayalgo] runtime cache read failed for ${tableName}`, error);
    return null;
  }
};

const writeCacheEntry = async (tableName, record) => {
  const db = getRuntimeCacheDb();
  if (!db || !record?.cacheKey || record.payload == null) return false;
  try {
    await db.table(tableName).put(record);
    return true;
  } catch (error) {
    runtimeCacheUnavailable = true;
    console.warn(`[rayalgo] runtime cache write failed for ${tableName}`, error);
    return false;
  }
};

export const readCachedChartBars = (cacheKey) =>
  readCacheEntry("chartBars", cacheKey);

export const writeCachedChartBars = (
  cacheKey,
  payload,
  {
    ticker,
    interval,
    session = "regular",
    source = "trades",
    ttlMs = RUNTIME_CACHE_TTL_MS.chartBarsIntraday,
  } = {},
) =>
  writeCacheEntry("chartBars", {
    cacheKey,
    ticker: normalizeTicker(ticker),
    interval: normalizeKeyPart(interval),
    session: normalizeKeyPart(session),
    source: normalizeKeyPart(source),
    payload,
    updatedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });

export const readCachedFlowEvents = (cacheKey) =>
  readCacheEntry("flowEvents", cacheKey);

export const writeCachedFlowEvents = (
  cacheKey,
  payload,
  {
    ticker,
    provider = "flow",
    filterSignature = "default",
    ttlMs = RUNTIME_CACHE_TTL_MS.flowEvents,
  } = {},
) =>
  writeCacheEntry("flowEvents", {
    cacheKey,
    ticker: normalizeTicker(ticker || "ALL"),
    provider: normalizeKeyPart(provider),
    filterSignature: normalizeKeyPart(filterSignature),
    payload,
    updatedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });

export const readCachedOptionChainSnapshot = (cacheKey) =>
  readCacheEntry("optionChains", cacheKey);

export const writeCachedOptionChainSnapshot = (
  cacheKey,
  payload,
  {
    underlying,
    expiration = "all",
    coverage = "window",
    marketDataMode = "metadata",
    ttlMs = RUNTIME_CACHE_TTL_MS.optionChains,
  } = {},
) =>
  writeCacheEntry("optionChains", {
    cacheKey,
    underlying: normalizeTicker(underlying),
    expiration: normalizeKeyPart(expiration),
    coverage: normalizeKeyPart(coverage),
    marketDataMode: normalizeKeyPart(marketDataMode),
    payload,
    updatedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });

export const hydrateQueryFromRuntimeCache = async ({
  queryClient,
  queryKey,
  read,
  invalidate = true,
}) => {
  if (!queryClient || !queryKey || typeof read !== "function") {
    return false;
  }
  if (queryClient.getQueryData(queryKey)) {
    return false;
  }

  const payload = await read();
  if (!payload || queryClient.getQueryData(queryKey)) {
    return false;
  }

  queryClient.setQueryData(queryKey, payload);
  if (invalidate) {
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }
  return true;
};

export const getRuntimeCacheDiagnostics = async () => {
  const db = getRuntimeCacheDb();
  if (!db) {
    return {
      available: false,
      chartBars: 0,
      flowEvents: 0,
      optionChains: 0,
    };
  }
  const [chartBars, flowEvents, optionChains] = await Promise.all([
    db.chartBars.count(),
    db.flowEvents.count(),
    db.optionChains.count(),
  ]);
  return {
    available: true,
    chartBars,
    flowEvents,
    optionChains,
  };
};
