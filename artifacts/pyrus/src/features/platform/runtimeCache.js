import Dexie from "dexie";

const RUNTIME_CACHE_DB_NAME = "pyrus-runtime-cache";
const RUNTIME_CACHE_DB_VERSION = 3;
const RUNTIME_CACHE_SCHEMA_VERSION = 2;

const RUNTIME_CACHE_CLASS = {
  livePrimary: "live-primary",
  managementLive: "management-live",
  semiLive: "semi-live",
  historicalHeavy: "historical-heavy",
};

const RUNTIME_CACHE_TTL_MS = {
  chartBarsHistorical: 24 * 60 * 60 * 1000,
  chartBarsIntraday: 15 * 60 * 1000,
  flowEvents: 30 * 60 * 1000,
  optionChains: 10 * 60 * 1000,
};

const RUNTIME_CACHE_STALE_TTL_MS = {
  chartBarsHistorical: 7 * 24 * 60 * 60 * 1000,
  chartBarsIntraday: 60 * 60 * 1000,
  flowEvents: 2 * 60 * 60 * 1000,
  optionChains: 60 * 60 * 1000,
};

const RUNTIME_CACHE_POLICIES = {
  [RUNTIME_CACHE_CLASS.livePrimary]: {
    cacheClass: RUNTIME_CACHE_CLASS.livePrimary,
    ttlMs: 0,
    staleTtlMs: 0,
    persist: false,
    allowStaleRender: false,
    allowActionFromStale: false,
  },
  [RUNTIME_CACHE_CLASS.managementLive]: {
    cacheClass: RUNTIME_CACHE_CLASS.managementLive,
    ttlMs: 0,
    staleTtlMs: 0,
    persist: false,
    allowStaleRender: true,
    allowActionFromStale: false,
  },
  [RUNTIME_CACHE_CLASS.semiLive]: {
    cacheClass: RUNTIME_CACHE_CLASS.semiLive,
    ttlMs: 15_000,
    staleTtlMs: 2 * 60_000,
    persist: false,
    allowStaleRender: true,
    allowActionFromStale: false,
  },
  [RUNTIME_CACHE_CLASS.historicalHeavy]: {
    cacheClass: RUNTIME_CACHE_CLASS.historicalHeavy,
    ttlMs: RUNTIME_CACHE_TTL_MS.chartBarsIntraday,
    staleTtlMs: RUNTIME_CACHE_STALE_TTL_MS.chartBarsIntraday,
    persist: true,
    allowStaleRender: true,
    allowActionFromStale: false,
  },
};

let runtimeCacheDb = null;
let runtimeCacheUnavailable = false;
const RUNTIME_CACHE_MAX_ROWS = {
  chartBars: 240,
  flowEvents: 120,
  optionChains: 120,
};

const hasIndexedDb = () =>
  typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

const isRuntimeCacheAvailable = () =>
  !runtimeCacheUnavailable && hasIndexedDb();

const getRuntimeCacheDb = () => {
  if (!isRuntimeCacheAvailable()) {
    return null;
  }
  if (runtimeCacheDb) {
    return runtimeCacheDb;
  }

  runtimeCacheDb = new Dexie(RUNTIME_CACHE_DB_NAME);
  runtimeCacheDb.version(1).stores({
    chartBars: "&cacheKey, ticker, interval, session, source, updatedAt, expiresAt",
    flowEvents: "&cacheKey, ticker, provider, filterSignature, updatedAt, expiresAt",
    optionChains:
      "&cacheKey, underlying, expiration, coverage, marketDataMode, updatedAt, expiresAt",
    meta: "&key, updatedAt",
  });
  runtimeCacheDb.version(2).stores({
    chartBars:
      "&cacheKey, ticker, interval, session, source, cacheClass, updatedAt, expiresAt, staleExpiresAt, schemaVersion",
    flowEvents:
      "&cacheKey, ticker, provider, filterSignature, source, cacheClass, updatedAt, expiresAt, staleExpiresAt, schemaVersion",
    optionChains:
      "&cacheKey, underlying, expiration, coverage, marketDataMode, source, cacheClass, updatedAt, expiresAt, staleExpiresAt, schemaVersion",
    accountHistory:
      "&cacheKey, accountId, mode, range, source, cacheClass, updatedAt, expiresAt, staleExpiresAt, schemaVersion",
    reference:
      "&cacheKey, namespace, source, cacheClass, updatedAt, expiresAt, staleExpiresAt, schemaVersion",
    meta: "&key, updatedAt",
  });
  runtimeCacheDb.version(RUNTIME_CACHE_DB_VERSION).stores({
    accountHistory: null,
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
  provider = "unknown",
} = {}) =>
  [
    "options",
    normalizeTicker(underlying),
    normalizeKeyPart(expiration),
    normalizeKeyPart(coverage),
    normalizeKeyPart(marketDataMode),
    normalizeKeyPart(provider),
  ].join(":");

const isRuntimeCacheEntryFresh = (entry, nowMs = Date.now()) =>
  Boolean(entry && Number.isFinite(entry.expiresAt) && entry.expiresAt > nowMs);

const isRuntimeCacheEntryUsable = (entry, nowMs = Date.now()) =>
  Boolean(
    entry &&
      Number.isFinite(entry.staleExpiresAt) &&
      entry.staleExpiresAt > nowMs,
  );

const normalizeCacheClass = (cacheClass) =>
  Object.values(RUNTIME_CACHE_CLASS).includes(cacheClass)
    ? cacheClass
    : RUNTIME_CACHE_CLASS.historicalHeavy;

const runtimeCachePolicyFor = (cacheClass) =>
  RUNTIME_CACHE_POLICIES[normalizeCacheClass(cacheClass)] ??
  RUNTIME_CACHE_POLICIES[RUNTIME_CACHE_CLASS.historicalHeavy];

const parseTimestampMs = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const firstText = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const extractPayloadStale = (payload) =>
  Boolean(
    payload?.stale === true ||
      payload?.isStale === true ||
      (payload?.degraded === true &&
        String(payload?.reason || "").includes("stale")) ||
      payload?.debug?.stale === true ||
      payload?.source?.stale === true ||
      payload?.source?.status === "stale" ||
      payload?.freshness === "stale",
  );

const extractPayloadAgeMs = (payload) =>
  firstFiniteNumber(
    payload?.cacheAgeMs,
    payload?.ageMs,
    payload?.debug?.cacheAgeMs,
    payload?.debug?.ageMs,
    payload?.source?.cacheAgeMs,
    payload?.source?.ageMs,
  );

const extractPayloadUpdatedAt = (payload, nowMs = Date.now()) => {
  const direct = [
    payload?.updatedAt,
    payload?.asOf,
    payload?.dataUpdatedAt,
    payload?.debug?.updatedAt,
    payload?.debug?.asOf,
    payload?.source?.updatedAt,
    payload?.source?.asOf,
    payload?.source?.observedAt,
  ];
  for (const value of direct) {
    const parsed = parseTimestampMs(value);
    if (parsed !== null) return parsed;
  }
  const ageMs = extractPayloadAgeMs(payload);
  if (ageMs !== null) return Math.max(0, nowMs - ageMs);
  return nowMs;
};

const extractPayloadSource = (payload, fallback = null) =>
  firstText(
    fallback,
    payload?.source?.provider,
    payload?.source?.source,
    payload?.source?.name,
    payload?.quoteSource,
    payload?.marketDataProvider,
    payload?.provider,
    payload?.debug?.source,
  );

const extractPayloadProvider = (payload, fallback = null) =>
  firstText(
    fallback,
    payload?.marketDataProvider,
    payload?.quoteSource,
    payload?.provider,
    payload?.source?.provider,
    payload?.source?.source,
    payload?.debug?.provider,
  );

const runtimeCacheMetaFromEntry = (entry, nowMs = Date.now()) => {
  if (!entry) {
    return {
      cacheStatus: "miss",
      cacheAgeMs: null,
      stale: false,
      updatedAt: null,
      source: null,
      provider: null,
    };
  }
  const cacheAgeMs = Number.isFinite(entry.updatedAt)
    ? Math.max(0, nowMs - entry.updatedAt)
    : null;
  const stale =
    !isRuntimeCacheEntryFresh(entry, nowMs) ||
    entry.payloadStale === true ||
    entry.stale === true;
  return {
    cacheStatus: stale ? "stale" : "hit",
    cacheAgeMs,
    stale,
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : null,
    source: entry.source ?? null,
    provider: entry.provider ?? entry.safetyScope?.provider ?? null,
  };
};

const stripRuntimeCacheMeta = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const { runtimeCache: _runtimeCache, ...rest } = payload;
  return rest;
};

const withRuntimeCacheMeta = (payload, meta) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  return {
    ...payload,
    runtimeCache: meta,
  };
};

const readCacheEntry = async (tableName, cacheKey, nowMs = Date.now()) => {
  const db = getRuntimeCacheDb();
  if (!db || !cacheKey) {
    return null;
  }
  try {
    const entry = await db.table(tableName).get(cacheKey);
    if (!entry) {
      return null;
    }
    if (entry.schemaVersion !== RUNTIME_CACHE_SCHEMA_VERSION) {
      void db.table(tableName).delete(cacheKey);
      return null;
    }
    if (!isRuntimeCacheEntryUsable(entry, nowMs)) {
      if (entry) {
        void db.table(tableName).delete(cacheKey);
      }
      return null;
    }
    const meta = runtimeCacheMetaFromEntry(entry, nowMs);
    return {
      payload: entry.payload ?? null,
      meta,
      record: entry,
    };
  } catch (error) {
    runtimeCacheUnavailable = true;
    console.warn(`[pyrus] runtime cache read failed for ${tableName}`, error);
    return null;
  }
};

const writeCacheEntry = async (tableName, record) => {
  const db = getRuntimeCacheDb();
  const cacheClass = normalizeCacheClass(record?.cacheClass);
  const policy = runtimeCachePolicyFor(cacheClass);
  if (!policy.persist) return false;
  if (!db || !record?.cacheKey || record.payload == null) return false;
  try {
    const nowMs = Date.now();
    const payload = stripRuntimeCacheMeta(record.payload);
    const upstreamStale = extractPayloadStale(payload) || record.stale === true;
    const updatedAt = Math.max(
      0,
      Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : extractPayloadUpdatedAt(payload, nowMs),
    );
    const ttlMs = Math.max(0, record.ttlMs ?? policy.ttlMs);
    const staleTtlMs = Math.max(ttlMs, record.staleTtlMs ?? policy.staleTtlMs);
    const freshExpiresAt = updatedAt + ttlMs;
    const staleExpiresAt = updatedAt + staleTtlMs;
    if (staleExpiresAt <= nowMs) {
      return false;
    }
    await db.table(tableName).put({
      ...record,
      payload,
      cacheClass,
      source: extractPayloadSource(payload, record.source),
      provider: extractPayloadProvider(payload, record.provider),
      safetyScope: record.safetyScope ?? {},
      schemaVersion: RUNTIME_CACHE_SCHEMA_VERSION,
      updatedAt,
      expiresAt: upstreamStale
        ? Math.min(freshExpiresAt, nowMs - 1)
        : freshExpiresAt,
      staleExpiresAt,
      payloadStale: upstreamStale,
    });
    void pruneRuntimeCacheTable(db, tableName, nowMs);
    return true;
  } catch (error) {
    runtimeCacheUnavailable = true;
    console.warn(`[pyrus] runtime cache write failed for ${tableName}`, error);
    return false;
  }
};

const pruneRuntimeCacheTable = async (db, tableName, nowMs = Date.now()) => {
  const maxRows = RUNTIME_CACHE_MAX_ROWS[tableName];
  if (!maxRows) return;
  try {
    const table = db.table(tableName);
    await table.where("staleExpiresAt").belowOrEqual(nowMs).delete();
    const count = await table.count();
    if (count <= maxRows) return;
    const deleteCount = count - maxRows;
    const keys = await table.orderBy("updatedAt").limit(deleteCount).primaryKeys();
    if (keys.length) {
      await table.bulkDelete(keys);
    }
  } catch (error) {
    console.warn(`[pyrus] runtime cache prune failed for ${tableName}`, error);
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
    staleTtlMs = RUNTIME_CACHE_STALE_TTL_MS.chartBarsIntraday,
    provider = "unknown",
    marketDataMode = "unknown",
  } = {},
) =>
  writeCacheEntry("chartBars", {
    cacheKey,
    ticker: normalizeTicker(ticker),
    interval: normalizeKeyPart(interval),
    session: normalizeKeyPart(session),
    source: normalizeKeyPart(source),
    payload,
    cacheClass: RUNTIME_CACHE_CLASS.historicalHeavy,
    ttlMs,
    staleTtlMs,
    provider,
    marketDataMode,
    safetyScope: {
      ticker: normalizeTicker(ticker),
      interval: normalizeKeyPart(interval),
      session: normalizeKeyPart(session),
      source: normalizeKeyPart(source),
      provider: normalizeKeyPart(provider),
      marketDataMode: normalizeKeyPart(marketDataMode),
    },
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
    staleTtlMs = RUNTIME_CACHE_STALE_TTL_MS.flowEvents,
    source = provider,
  } = {},
) =>
  writeCacheEntry("flowEvents", {
    cacheKey,
    ticker: normalizeTicker(ticker || "ALL"),
    provider: normalizeKeyPart(provider),
    filterSignature: normalizeKeyPart(filterSignature),
    payload,
    cacheClass: RUNTIME_CACHE_CLASS.historicalHeavy,
    ttlMs,
    staleTtlMs,
    source,
    safetyScope: {
      ticker: normalizeTicker(ticker || "ALL"),
      provider: normalizeKeyPart(provider),
      source: normalizeKeyPart(source),
      filterSignature: normalizeKeyPart(filterSignature),
    },
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
    staleTtlMs = RUNTIME_CACHE_STALE_TTL_MS.optionChains,
    provider = "unknown",
  } = {},
) =>
  writeCacheEntry("optionChains", {
    cacheKey,
    underlying: normalizeTicker(underlying),
    expiration: normalizeKeyPart(expiration),
    coverage: normalizeKeyPart(coverage),
    marketDataMode: normalizeKeyPart(marketDataMode),
    payload,
    cacheClass: RUNTIME_CACHE_CLASS.historicalHeavy,
    ttlMs,
    staleTtlMs,
    provider,
    source: provider,
    safetyScope: {
      underlying: normalizeTicker(underlying),
      expiration: normalizeKeyPart(expiration),
      coverage: normalizeKeyPart(coverage),
      marketDataMode: normalizeKeyPart(marketDataMode),
      provider: normalizeKeyPart(provider),
    },
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

  const cached = await read();
  const payload = cached?.payload ?? null;
  if (!payload || queryClient.getQueryData(queryKey)) {
    return false;
  }

  queryClient.setQueryData(
    queryKey,
    withRuntimeCacheMeta(payload, cached.meta ?? null),
  );
  if (invalidate) {
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }
  return true;
};
