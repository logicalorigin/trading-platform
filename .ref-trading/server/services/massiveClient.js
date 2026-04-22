import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  buildResearchBarFromEpochMs,
  getEpochMsForMarketDateTime,
  getMarketTimePartsFromEpochMs,
  isRegularMarketSessionParts,
} from "../../src/research/market/time.js";
import { buildOptionTicker } from "../../src/research/options/optionTicker.js";
import {
  DEFAULT_STRIKE_SLOT,
  clampStrikeSlot,
  formatStrikeSlotLabel,
} from "../../src/research/options/strikeSelection.js";
import {
  getMassiveDbCacheStats,
  isMassiveDbCacheConfigured,
  readMassiveDbCache,
  readMassiveEquityDbCache,
  writeMassiveDbCache,
  writeMassiveEquityDbCache,
} from "./massiveDbCache.js";
import {
  isResearchOptionBarStoreEnabled,
  readResearchOptionBars,
  readResearchOptionBarsCoverage,
  writeResearchOptionBars,
} from "./massiveFlatFileStore.js";
import {
  MASSIVE_CONTRACT_CACHE_ROOT,
  MASSIVE_EQUITY_CACHE_ROOT,
  MASSIVE_OPTIONS_CACHE_ROOT,
} from "./runtimePaths.js";

const MASSIVE_API_BASE_URL = process.env.MASSIVE_API_BASE_URL || "https://api.massive.com";
const MASSIVE_CACHE_ROOT = MASSIVE_OPTIONS_CACHE_ROOT;
const DEFAULT_LIMIT = 50000;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REQUEST_TIMEOUT_MS = 180000;
const DEFAULT_DB_STATS_TIMEOUT_MS = 2500;
const DEFAULT_REPLAY_DATASET_CONCURRENCY = Math.max(
  1,
  Math.min(8, Math.round(Number(process.env.MASSIVE_REPLAY_DATASET_CONCURRENCY) || 2)),
);
const DIRECT_REPLAY_TICKER_RESOLUTION_ENABLED = !["0", "false", "no", "off"].includes(
  String(process.env.MASSIVE_DIRECT_REPLAY_TICKER_RESOLUTION || "true").trim().toLowerCase(),
);
const DIRECT_REPLAY_EXPIRY_PROBE_LIMIT = Math.max(
  3,
  Math.min(16, Math.round(Number(process.env.MASSIVE_DIRECT_REPLAY_EXPIRY_PROBE_LIMIT) || 8)),
);
const DIRECT_REPLAY_STRIKE_RADIUS = Math.max(
  3,
  Math.min(12, Math.round(Number(process.env.MASSIVE_DIRECT_REPLAY_STRIKE_RADIUS) || 5)),
);
const REPLAY_DATASET_HEARTBEAT_MS = Math.max(
  5000,
  Math.min(30000, Math.round(Number(process.env.MASSIVE_REPLAY_DATASET_HEARTBEAT_MS) || 15000)),
);
const DEFAULT_MASSIVE_RETRY_COUNT = Math.max(
  0,
  Math.min(2, Math.round(Number(process.env.MASSIVE_RETRY_COUNT) || 1)),
);
const DEFAULT_MASSIVE_RETRY_DELAY_MS = Math.max(
  0,
  Math.min(5000, Math.round(Number(process.env.MASSIVE_RETRY_DELAY_MS) || 750)),
);
const RETRYABLE_MASSIVE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export function resolveMassiveApiKey({ headerValue } = {}) {
  if (hasCredentialValue(headerValue)) {
    return String(headerValue).trim();
  }
  if (hasCredentialValue(process.env.MASSIVE_API_KEY)) {
    return String(process.env.MASSIVE_API_KEY).trim();
  }
  if (hasCredentialValue(process.env.POLYGON_API_KEY)) {
    return String(process.env.POLYGON_API_KEY).trim();
  }
  return "";
}

export async function getMassiveOptionsBarsWithCache(request = {}, options = {}) {
  const normalizedRequest = normalizeOptionsAggregateRequest(request);
  const refresh = options.refresh === true;
  const apiKey = String(options.apiKey || "").trim();

  const cacheKey = buildCacheKey(normalizedRequest);
  const cachePath = buildCachePath(normalizedRequest, cacheKey);
  const dbEnabled = isMassiveDbCacheConfigured();
  if (!refresh) {
    try {
      const cachedFromNormalizedStore = await readMassiveOptionsBarsFromNormalizedStore(normalizedRequest, {
        cacheKey,
        cachePath,
      });
      if (cachedFromNormalizedStore) {
        return cachedFromNormalizedStore;
      }
    } catch (error) {
      console.warn("[massive-cache] Failed to read normalized option bars:", error?.message || error);
    }

    if (dbEnabled) {
      try {
        const cachedFromDb = await readMassiveDbCache(cacheKey);
        if (cachedFromDb) {
          return {
            ...cachedFromDb,
            cache: {
              hit: true,
              refreshed: false,
              layer: "database",
              key: cacheKey,
              path: cachePath,
              fetchedAt: cachedFromDb?.fetchedAt || null,
            },
          };
        }
      } catch (error) {
        console.warn("[massive-cache] Failed to read database cache:", error?.message || error);
      }
    }

    const cached = await readCachedPayload(cachePath);
    if (cached) {
      return {
        ...cached,
        cache: {
          hit: true,
          refreshed: false,
          layer: "file",
          key: cacheKey,
          path: cachePath,
          fetchedAt: cached?.fetchedAt || null,
        },
      };
    }
  }

  if (!apiKey) {
    throw new Error("Massive API key is required");
  }

  const remote = await fetchMassiveOptionsAggregates(normalizedRequest, {
    apiKey,
    timeoutMs: options.timeoutMs,
  });
  const payload = {
    provider: "massive",
    optionTicker: normalizedRequest.optionTicker,
    multiplier: normalizedRequest.multiplier,
    timespan: normalizedRequest.timespan,
    from: normalizedRequest.from,
    to: normalizedRequest.to,
    adjusted: normalizedRequest.adjusted,
    sort: normalizedRequest.sort,
    limit: normalizedRequest.limit,
    source: "massive-options-history",
    dataQuality: "historical_vendor",
    requestId: remote.requestId || null,
    queryCount: remote.queryCount,
    resultsCount: remote.resultsCount,
    bars: remote.bars,
    fetchedAt: new Date().toISOString(),
  };

  let normalizedPersisted = false;
  let databasePersisted = false;
  let filePersisted = false;
  let normalizedError = null;
  let databaseError = null;
  let fileError = null;

  if (shouldUseNormalizedOptionBarStore(normalizedRequest)) {
    try {
      normalizedPersisted = Boolean((await writeResearchOptionBars({
        optionTicker: normalizedRequest.optionTicker,
        session: "regular",
        bars: remote.bars,
        source: payload.source,
        fetchedAt: payload.fetchedAt,
      }))?.ok);
    } catch (error) {
      normalizedError = error?.message || "Failed to persist normalized option bars";
      console.warn("[massive-cache] Failed to write normalized option bars:", error?.message || error);
    }
  }

  if (dbEnabled) {
    try {
      databasePersisted = await writeMassiveDbCache({
        cacheKey,
        request: normalizedRequest,
        payload,
      });
    } catch (error) {
      databaseError = error?.message || "Failed to persist Massive cache in database";
      console.warn("[massive-cache] Failed to write database cache:", error?.message || error);
    }
  }

  try {
    await writeCachedPayload(cachePath, payload);
    filePersisted = true;
  } catch (error) {
    fileError = error?.message || "Failed to persist Massive cache to file";
    console.warn("[massive-cache] Failed to write file cache:", error?.message || error);
  }

  return {
    ...payload,
    cache: {
      hit: false,
      refreshed: refresh,
      layer: "remote",
      key: cacheKey,
      path: cachePath,
      fetchedAt: payload.fetchedAt,
      persisted: {
        normalized: normalizedPersisted,
        database: databasePersisted,
        file: filePersisted,
      },
      ...(normalizedError || databaseError || fileError
        ? {
          errors: {
            ...(normalizedError ? { normalized: normalizedError } : {}),
            ...(databaseError ? { database: databaseError } : {}),
            ...(fileError ? { file: fileError } : {}),
          },
        }
        : {}),
    },
  };
}

export async function getMassiveEquityBarsWithCache(request = {}, options = {}) {
  const normalizedRequest = normalizeEquityAggregateRequest(request);
  const refresh = options.refresh === true;
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey) {
    throw new Error("Massive API key is required");
  }

  const cacheKey = buildCacheKey({
    kind: "equity-bars",
    ...normalizedRequest,
  });
  const cachePath = buildEquityCachePath(normalizedRequest, cacheKey);
  const dbEnabled = isMassiveDbCacheConfigured();
  if (!refresh) {
    if (dbEnabled) {
      try {
        const cachedFromDb = await readMassiveEquityDbCache(cacheKey);
        if (cachedFromDb) {
          return {
            ...cachedFromDb,
            cache: {
              hit: true,
              refreshed: false,
              layer: "database",
              key: cacheKey,
              path: cachePath,
              fetchedAt: cachedFromDb?.fetchedAt || null,
            },
          };
        }
      } catch (error) {
        console.warn("[massive-cache] Failed to read equity database cache:", error?.message || error);
      }
    }

    const cached = await readCachedPayload(cachePath);
    if (cached) {
      return {
        ...cached,
        cache: {
          hit: true,
          refreshed: false,
          layer: "file",
          key: cacheKey,
          path: cachePath,
          fetchedAt: cached?.fetchedAt || null,
        },
      };
    }
  }

  const remote = await fetchMassiveEquityAggregates(normalizedRequest, {
    apiKey,
    timeoutMs: options.timeoutMs,
  });
  const payload = {
    provider: "massive",
    ticker: normalizedRequest.ticker,
    multiplier: normalizedRequest.multiplier,
    timespan: normalizedRequest.timespan,
    from: normalizedRequest.from,
    to: normalizedRequest.to,
    adjusted: normalizedRequest.adjusted,
    sort: normalizedRequest.sort,
    limit: normalizedRequest.limit,
    session: normalizedRequest.session,
    source: "massive-equity-history",
    dataQuality: "vendor_primary",
    requestId: remote.requestId || null,
    queryCount: remote.queryCount,
    resultsCount: remote.resultsCount,
    bars: remote.bars,
    fetchedAt: new Date().toISOString(),
  };

  let databasePersisted = false;
  let filePersisted = false;
  let databaseError = null;
  let fileError = null;

  if (dbEnabled) {
    try {
      databasePersisted = await writeMassiveEquityDbCache({
        cacheKey,
        request: normalizedRequest,
        payload,
      });
    } catch (error) {
      databaseError = error?.message || "Failed to persist Massive equity cache in database";
      console.warn("[massive-cache] Failed to write equity database cache:", error?.message || error);
    }
  }

  try {
    await writeCachedPayload(cachePath, payload);
    filePersisted = true;
  } catch (error) {
    fileError = error?.message || "Failed to persist Massive equity cache to file";
    console.warn("[massive-cache] Failed to write equity cache:", error?.message || error);
  }

  return {
    ...payload,
    cache: {
      hit: false,
      refreshed: refresh,
      layer: "remote",
      key: cacheKey,
      path: cachePath,
      fetchedAt: payload.fetchedAt,
      persisted: {
        database: databasePersisted,
        file: filePersisted,
      },
      ...(databaseError || fileError
        ? {
          errors: {
            ...(databaseError ? { database: databaseError } : {}),
            ...(fileError ? { file: fileError } : {}),
          },
        }
        : {}),
    },
  };
}

export async function probeMassiveApi(apiKey, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    return {
      ok: false,
      status: null,
      error: "Massive API key is not configured",
    };
  }
  const timeoutMs = clampNumber(options.timeoutMs, 1000, MAX_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const query = new URLSearchParams({
    limit: "1",
    apiKey: key,
  });
  const url = `${MASSIVE_API_BASE_URL}/v3/reference/options/contracts?${query.toString()}`;

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: "GET",
      timeoutMs,
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error?.message || "Massive probe request failed",
    };
  }

  const payload = await parseJsonBody(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.error || payload?.message || `Massive probe failed (${response.status})`,
      requestId: payload?.request_id || null,
    };
  }
  return {
    ok: true,
    status: response.status,
    requestId: payload?.request_id || null,
    resultsCount: Array.isArray(payload?.results) ? payload.results.length : 0,
  };
}

export async function searchMassiveOptionContracts(request = {}, options = {}) {
  const normalizedRequest = normalizeOptionContractsSearchRequest(request);
  const refresh = options.refresh === true;
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey) {
    throw new Error("Massive API key is required");
  }

  const cacheKey = buildCacheKey({
    kind: "options-contracts",
    ...normalizedRequest,
  });
  const cachePath = buildContractQueryCachePath(normalizedRequest, cacheKey);
  if (!refresh) {
    const cached = await readCachedPayload(cachePath);
    if (cached) {
      return {
        ...cached,
        cache: {
          hit: true,
          refreshed: false,
          layer: "file",
          key: cacheKey,
          path: cachePath,
          fetchedAt: cached?.fetchedAt || null,
        },
      };
    }
  }

  const remote = await fetchMassiveOptionContracts(normalizedRequest, {
    apiKey,
    timeoutMs: options.timeoutMs,
  });

  const payload = {
    provider: "massive",
    source: "massive-options-reference",
    underlyingTicker: normalizedRequest.underlyingTicker,
    contractType: normalizedRequest.contractType,
    expirationDate: normalizedRequest.expirationDate || null,
    expirationDateGte: normalizedRequest.expirationDateGte || null,
    expirationDateLte: normalizedRequest.expirationDateLte || null,
    asOf: normalizedRequest.asOf,
    targetStrike: normalizedRequest.targetStrike,
    queryCount: remote.queryCount,
    resultsCount: remote.resultsCount,
    contracts: rankMassiveContracts(remote.contracts, normalizedRequest.targetStrike),
    requestId: remote.requestId || null,
    fetchedAt: new Date().toISOString(),
  };

  try {
    await writeCachedPayload(cachePath, payload);
  } catch (error) {
    console.warn("[massive-cache] Failed to write contract cache:", error?.message || error);
  }

  return {
    ...payload,
    cache: {
      hit: false,
      refreshed: refresh,
      layer: "remote",
      key: cacheKey,
      path: cachePath,
      fetchedAt: payload.fetchedAt,
    },
  };
}

export async function resolveMassiveOptionReplayDataset(request = {}, options = {}) {
  const normalizedRequest = normalizeMassiveReplayDatasetRequest(request);
  const apiKey = String(options.apiKey || "").trim();
  const onProgress = typeof options.onProgress === "function"
    ? options.onProgress
    : null;
  const resolutionConcurrency = clampNumber(
    options.concurrency,
    1,
    12,
    DEFAULT_REPLAY_DATASET_CONCURRENCY,
  );
  if (!apiKey) {
    throw new Error("Massive API key is required");
  }

  const contractsByKey = {};
  const skippedByKey = {};
  const barsByTicker = {};
  const expiryCache = new Map();
  const chainCache = new Map();
  const barsCache = new Map();
  let processedCount = 0;
  let nextCandidateIndex = 0;
  let activeWorkerCount = 0;

  const emitProgress = (extra = {}) => {
    if (!onProgress) {
      return;
    }
    onProgress({
      processed: processedCount,
      candidates: normalizedRequest.candidates.length,
      resolved: Object.keys(contractsByKey).length,
      skipped: Object.keys(skippedByKey).length,
      uniqueContracts: Object.keys(barsByTicker).length,
      inFlight: Math.max(0, activeWorkerCount),
      ...extra,
    });
  };

  emitProgress();

  const processCandidate = async (candidate) => {
    try {
      const resolved = await resolveReplayCandidateContract(
        normalizedRequest,
        candidate,
        {
          apiKey,
          timeoutMs: options.timeoutMs,
          expiryCache,
          chainCache,
          barsCache,
        },
      );

      if (!resolved?.contract?.optionTicker) {
        skippedByKey[candidate.key] = {
          key: candidate.key,
          entryTs: candidate.entryTs,
          signalTs: candidate.signalTs,
          ...(resolved || {}),
          reason: resolved?.skipReason || resolved?.reason || "contract_not_found",
        };
        processedCount += 1;
        emitProgress({
          currentKey: candidate.key,
          currentStatus: "skipped",
          currentReason: skippedByKey[candidate.key].reason,
        });
        return;
      }

      const contract = resolved.contract;
      contractsByKey[candidate.key] = {
        optionTicker: contract.optionTicker,
        expiryDate: contract.expiry,
        strike: contract.strike,
        right: contract.right,
        actualDteAtEntry: businessDayDiff(candidate.entryDate, contract.expiry),
        targetDteAtEntry: Number.isFinite(Number(candidate?.optionSelectionSpec?.targetDte))
          ? Number(candidate.optionSelectionSpec.targetDte)
          : normalizedRequest.targetDte,
        dteSelectionMode: resolved.dteSelectionMode || candidate.dteSelectionMode || null,
        selectionStrikeSlot: Number.isFinite(Number(resolved.selectionStrikeSlot))
          ? Number(resolved.selectionStrikeSlot)
          : null,
        selectionStrikeLabel: resolved.selectionStrikeLabel || null,
        selectionMoneyness: resolved.selectionMoneyness || candidate?.optionSelectionSpec?.moneyness || normalizedRequest.moneyness || null,
        selectionSteps: Number.isFinite(Number(resolved.selectionSteps))
          ? Number(resolved.selectionSteps)
          : (candidate?.optionSelectionSpec?.strikeSteps ?? normalizedRequest.strikeSteps),
        spotPriceAtEntry: candidate.spotPrice,
      };
      barsByTicker[contract.optionTicker] = mergeReplayBars(
        barsByTicker[contract.optionTicker],
        resolved.bars || [],
      );
      processedCount += 1;
      emitProgress({
        currentKey: candidate.key,
        currentStatus: "resolved",
        currentTicker: contract.optionTicker,
      });
    } catch (error) {
      const errorMessage = String(error?.message || "lookup_failed").trim();
      skippedByKey[candidate.key] = {
        key: candidate.key,
        entryTs: candidate.entryTs,
        signalTs: candidate.signalTs,
        reason: errorMessage ? `lookup_failed:${errorMessage}` : "lookup_failed",
        error: errorMessage || null,
      };
      processedCount += 1;
      emitProgress({
        currentKey: candidate.key,
        currentStatus: "skipped",
        currentReason: skippedByKey[candidate.key].reason,
      });
    }
  };

  const runWorker = async () => {
    while (nextCandidateIndex < normalizedRequest.candidates.length) {
      const candidate = normalizedRequest.candidates[nextCandidateIndex];
      nextCandidateIndex += 1;
      if (!candidate) {
        continue;
      }
      activeWorkerCount += 1;
      try {
        await processCandidate(candidate);
      } finally {
        activeWorkerCount = Math.max(0, activeWorkerCount - 1);
      }
    }
  };

  const heartbeatId = onProgress
    ? globalThis.setInterval(() => {
      emitProgress({ heartbeat: true });
    }, REPLAY_DATASET_HEARTBEAT_MS)
    : null;

  try {
    await Promise.all(
      Array.from(
        { length: Math.min(resolutionConcurrency, Math.max(1, normalizedRequest.candidates.length)) },
        () => runWorker(),
      ),
    );
  } finally {
    if (heartbeatId != null) {
      globalThis.clearInterval(heartbeatId);
    }
  }

  const counts = {
    candidates: normalizedRequest.candidates.length,
    resolved: Object.keys(contractsByKey).length,
    skipped: Object.keys(skippedByKey).length,
    uniqueContracts: Object.keys(barsByTicker).length,
  };

  return {
    provider: "massive",
    source: "massive-options-replay-dataset",
    underlyingTicker: normalizedRequest.underlyingTicker,
    selectionSpec: {
      targetDte: normalizedRequest.targetDte,
      minDte: normalizedRequest.minDte,
      maxDte: normalizedRequest.maxDte,
      strikeSlot: normalizedRequest.strikeSlot,
      moneyness: normalizedRequest.moneyness,
      strikeSteps: normalizedRequest.strikeSteps,
    },
    replayEndDate: normalizedRequest.replayEndDate,
    contractsByKey,
    skippedByKey,
    barsByTicker,
    counts,
    firstResolvedContract: normalizedRequest.candidates
      .map((candidate) => contractsByKey[candidate.key] || null)
      .find(Boolean) || null,
    fetchedAt: new Date().toISOString(),
  };
}

async function getCachedAsync(cache, key, loader) {
  let pending = cache.get(key);
  if (!pending) {
    pending = Promise.resolve().then(loader);
    cache.set(key, pending);
  }
  try {
    return await pending;
  } catch (error) {
    if (cache.get(key) === pending) {
      cache.delete(key);
    }
    throw error;
  }
}

export async function getMassiveCacheStats(options = {}) {
  const includeDatabase = options?.includeDatabase === true;
  const configuredDbStatsTimeoutMs = Number(options?.databaseTimeoutMs);
  const databaseTimeoutMs = Number.isFinite(configuredDbStatsTimeoutMs) && configuredDbStatsTimeoutMs > 0
    ? configuredDbStatsTimeoutMs
    : DEFAULT_DB_STATS_TIMEOUT_MS;
  const stats = {
    root: MASSIVE_CACHE_ROOT,
    fileCount: 0,
    totalBytes: 0,
    lastUpdatedAt: null,
    database: {
      configured: false,
      ready: false,
      rowCount: 0,
      totalBytesEstimate: 0,
      lastUpdatedAt: null,
      error: null,
    },
  };

  try {
    await fs.mkdir(MASSIVE_CACHE_ROOT, { recursive: true });
    const files = await listJsonFiles(MASSIVE_CACHE_ROOT);
    for (const file of files) {
      try {
        const detail = await fs.stat(file);
        stats.fileCount += 1;
        stats.totalBytes += Number(detail.size || 0);
        const updatedAt = detail.mtime?.toISOString?.() || null;
        if (updatedAt && (!stats.lastUpdatedAt || updatedAt > stats.lastUpdatedAt)) {
          stats.lastUpdatedAt = updatedAt;
        }
      } catch {
        // Ignore transient file-stat errors.
      }
    }
  } catch (error) {
    stats.fileError = error?.message || "File cache stats unavailable";
  }

  if (!includeDatabase) {
    stats.database = {
      configured: isMassiveDbCacheConfigured(),
      ready: null,
      rowCount: 0,
      totalBytesEstimate: 0,
      lastUpdatedAt: null,
      error: "Database cache stats skipped by default. Pass includeDb=true to request them.",
    };
    return stats;
  }

  try {
    stats.database = await withTimeout(
      getMassiveDbCacheStats(),
      databaseTimeoutMs,
      `Massive database cache stats timed out after ${databaseTimeoutMs}ms`,
    );
  } catch (error) {
    stats.database = {
      configured: isMassiveDbCacheConfigured(),
      ready: false,
      rowCount: 0,
      totalBytesEstimate: 0,
      lastUpdatedAt: null,
      error: error?.message || "Database cache stats unavailable",
    };
  }

  return stats;
}

function normalizeOptionsAggregateRequest(request = {}) {
  const optionTicker = String(request.optionTicker || "").trim().toUpperCase();
  if (!optionTicker) {
    throw new Error("optionTicker is required");
  }
  const from = String(request.from || "").trim();
  if (!from) {
    throw new Error("from is required");
  }
  const to = String(request.to || "").trim();
  if (!to) {
    throw new Error("to is required");
  }

  return {
    optionTicker,
    multiplier: clampNumber(request.multiplier, 1, 1000, 1),
    timespan: normalizeTimespan(request.timespan),
    from,
    to,
    adjusted: parseBooleanDefaultTrue(request.adjusted),
    sort: normalizeSort(request.sort),
    limit: clampNumber(request.limit, 1, DEFAULT_LIMIT, DEFAULT_LIMIT),
  };
}

function normalizeOptionContractsSearchRequest(request = {}) {
  const underlyingTicker = String(request.underlyingTicker || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z.]/g, "");
  if (!underlyingTicker) {
    throw new Error("underlyingTicker is required");
  }

  const contractType = normalizeContractType(request.contractType);
  if (!contractType) {
    throw new Error("contractType is required");
  }

  const expirationDate = optionalDateText(request.expirationDate);
  const expirationDateGte = optionalDateText(request.expirationDateGte || request.expirationDateMin);
  const expirationDateLte = optionalDateText(request.expirationDateLte || request.expirationDateMax);
  if (!expirationDate && !expirationDateGte && !expirationDateLte) {
    throw new Error("expirationDate or expirationDateGte/expirationDateLte is required");
  }

  const strikePrice = toFiniteNumber(request.strikePrice, null);
  const strikePriceGte = toFiniteNumber(request.strikePriceGte, null);
  const strikePriceLte = toFiniteNumber(request.strikePriceLte, null);

  return {
    underlyingTicker,
    contractType,
    expirationDate,
    expirationDateGte,
    expirationDateLte,
    asOf: optionalDateText(request.asOf),
    targetStrike: toFiniteNumber(request.targetStrike, null),
    strikePrice: Number.isFinite(strikePrice) ? strikePrice : null,
    strikePriceGte: Number.isFinite(strikePriceGte) ? strikePriceGte : null,
    strikePriceLte: Number.isFinite(strikePriceLte) ? strikePriceLte : null,
    expired: request.expired == null ? null : parseBooleanDefaultTrue(request.expired),
    limit: clampNumber(request.limit, 1, 1000, 250),
    sort: normalizeContractSortField(request.sort),
    order: normalizeSort(request.order),
  };
}

async function fetchMassiveOptionContracts(request, options = {}) {
  const timeoutMs = clampNumber(options.timeoutMs, 1000, MAX_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const exactPayload = Number.isFinite(request.targetStrike)
    ? await fetchMassiveOptionContractsPayload(
      request,
      {
        apiKey: options.apiKey,
        timeoutMs,
        includeTargetStrike: true,
      },
    )
    : null;
  const exactRows = Array.isArray(exactPayload?.results) ? exactPayload.results : [];
  const payload = exactRows.length
    ? exactPayload
    : await fetchMassiveOptionContractsPayload(
      {
        ...request,
        limit: Number.isFinite(request.targetStrike) ? Math.max(request.limit, 1000) : request.limit,
      },
      {
        apiKey: options.apiKey,
        timeoutMs,
        includeTargetStrike: false,
      },
    );
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  return {
    requestId: payload?.request_id || null,
    queryCount: toFiniteNumber(payload?.queryCount, rows.length),
    resultsCount: toFiniteNumber(payload?.resultsCount, rows.length),
    contracts: rows.map(normalizeMassiveContract).filter(Boolean),
  };
}

async function fetchMassiveOptionContractsPayload(request, options = {}) {
  const query = new URLSearchParams({
    underlying_ticker: request.underlyingTicker,
    contract_type: request.contractType,
    sort: request.sort,
    order: request.order,
    limit: String(request.limit),
    apiKey: String(options.apiKey || ""),
  });
  if (request.expirationDate) {
    query.set("expiration_date", request.expirationDate);
  }
  if (request.expirationDateGte) {
    query.set("expiration_date.gte", request.expirationDateGte);
  }
  if (request.expirationDateLte) {
    query.set("expiration_date.lte", request.expirationDateLte);
  }
  if (request.asOf) {
    query.set("as_of", request.asOf);
  }
  if (typeof request.expired === "boolean") {
    query.set("expired", request.expired ? "true" : "false");
  }
  if (Number.isFinite(request.strikePrice)) {
    query.set("strike_price", String(request.strikePrice));
  }
  if (Number.isFinite(request.strikePriceGte)) {
    query.set("strike_price.gte", String(request.strikePriceGte));
  }
  if (Number.isFinite(request.strikePriceLte)) {
    query.set("strike_price.lte", String(request.strikePriceLte));
  }
  if (options.includeTargetStrike && Number.isFinite(request.targetStrike)) {
    query.set("strike_price", String(request.targetStrike));
  }

  const url = `${MASSIVE_API_BASE_URL}/v3/reference/options/contracts?${query.toString()}`;
  const { payload } = await fetchMassiveJsonWithRetry(url, {
    method: "GET",
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    retryDelayMs: options.retryDelayMs,
  });
  return payload;
}

function normalizeMassiveReplayDatasetRequest(request = {}) {
  const underlyingTicker = String(request.underlyingTicker || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z.]/g, "");
  if (!underlyingTicker) {
    throw new Error("underlyingTicker is required");
  }
  const replayEndDate = optionalDateText(request.replayEndDate);
  if (!replayEndDate) {
    throw new Error("replayEndDate is required");
  }
  const rawMoneyness = String(request.moneyness || "").trim().toLowerCase();
  const moneyness = ["itm", "atm", "otm"].includes(rawMoneyness) ? normalizeMoneyness(rawMoneyness) : null;
  const hasLegacyStrikeSteps = Number.isFinite(Number(request.strikeSteps));
  const strikeSteps = hasLegacyStrikeSteps ? clampNumber(request.strikeSteps, 0, 25, 1) : null;
  const hasStrikeSlot = Number.isFinite(Number(request.strikeSlot));
  const strikeSlot = hasStrikeSlot ? clampStrikeSlot(request.strikeSlot) : null;
  const hasMinDte = Number.isFinite(Number(request.minDte));
  const hasMaxDte = Number.isFinite(Number(request.maxDte));
  const hasTargetDte = Number.isFinite(Number(request.targetDte));
  const targetDte = hasTargetDte ? clampNumber(request.targetDte, 0, 60, 5) : null;
  let minDte = hasMinDte ? clampNumber(request.minDte, 0, 60, 0) : null;
  let maxDte = hasMaxDte ? clampNumber(request.maxDte, 0, 60, 10) : null;
  if (minDte == null && maxDte == null && hasTargetDte) {
    minDte = targetDte;
    maxDte = targetDte;
  } else {
    if (minDte == null) {
      minDte = maxDte ?? 0;
    }
    if (maxDte == null) {
      maxDte = minDte ?? 10;
    }
  }
  const candidates = Array.isArray(request.candidates)
    ? request.candidates.map(normalizeReplayCandidate).filter(Boolean)
    : [];
  return {
    underlyingTicker,
    replayEndDate,
    strikeSlot,
    moneyness,
    strikeSteps,
    targetDte,
    minDte,
    maxDte: Math.max(minDte, maxDte),
    candidates,
  };
}

function normalizeReplayCandidate(candidate) {
  const key = String(candidate?.key || "").trim();
  const entryTs = String(candidate?.entryTs || "").trim();
  const entryDate = optionalDateText(candidate?.entryDate);
  const signalTs = String(candidate?.signalTs || "").trim() || entryTs;
  const direction = String(candidate?.direction || "").trim().toLowerCase();
  const spotPrice = toFiniteNumber(candidate?.spotPrice, null);
  const optionSelectionSpec = candidate?.optionSelectionSpec && typeof candidate.optionSelectionSpec === "object"
    ? candidate.optionSelectionSpec
    : {};
  const hasTargetDte = Number.isFinite(Number(optionSelectionSpec?.targetDte));
  const targetDte = hasTargetDte ? clampNumber(optionSelectionSpec?.targetDte, 0, 60, 5) : null;
  let minDte = Number.isFinite(Number(optionSelectionSpec?.minDte))
    ? clampNumber(optionSelectionSpec?.minDte, 0, 60, 0)
    : null;
  let maxDte = Number.isFinite(Number(optionSelectionSpec?.maxDte))
    ? clampNumber(optionSelectionSpec?.maxDte, 0, 60, 10)
    : null;
  if (minDte == null && maxDte == null && targetDte != null) {
    minDte = targetDte;
    maxDte = targetDte;
  } else {
    if (minDte == null) {
      minDte = maxDte ?? 0;
    }
    if (maxDte == null) {
      maxDte = minDte ?? 10;
    }
  }
  const rawMoneyness = String(optionSelectionSpec?.moneyness || "").trim().toLowerCase();
  const moneyness = ["itm", "atm", "otm"].includes(rawMoneyness) ? normalizeMoneyness(rawMoneyness) : null;
  const strikeSteps = Number.isFinite(Number(optionSelectionSpec?.strikeSteps))
    ? clampNumber(optionSelectionSpec?.strikeSteps, 0, 25, 1)
    : null;
  const strikeSlot = Number.isFinite(Number(optionSelectionSpec?.strikeSlot))
    ? clampStrikeSlot(optionSelectionSpec?.strikeSlot)
    : null;
  if (!key || !entryTs || !entryDate || !["long", "short"].includes(direction) || !Number.isFinite(spotPrice)) {
    return null;
  }
  return {
    key,
    entryTs,
    signalTs,
    entryDate,
    direction,
    spotPrice,
    optionSelectionSpec: {
      targetDte,
      minDte,
      maxDte: Math.max(minDte, maxDte),
      strikeSlot,
      moneyness,
      strikeSteps,
    },
    dteSelectionMode: String(candidate?.dteSelectionMode || "").trim().toLowerCase() || null,
  };
}

export function buildDirectExpiryProbeDates(
  entryDate,
  {
    targetDte = null,
    minDte = 0,
    maxDte = 10,
    limit = DIRECT_REPLAY_EXPIRY_PROBE_LIMIT,
  } = {},
) {
  const normalizedEntryDate = optionalDateText(entryDate);
  if (!normalizedEntryDate) {
    return [];
  }

  const probeLimit = Math.max(1, Math.min(32, Math.round(Number(limit) || DIRECT_REPLAY_EXPIRY_PROBE_LIMIT)));
  const hasTargetDte = Number.isFinite(Number(targetDte));
  const normalizedTargetDte = hasTargetDte ? clampNumber(targetDte, 0, 60, 0) : null;
  const normalizedMinDte = clampNumber(minDte, 0, 60, 0);
  const normalizedMaxDte = clampNumber(maxDte, normalizedMinDte, 60, Math.max(normalizedMinDte, 10));

  const start = new Date(`${normalizedEntryDate}T12:00:00Z`);
  const candidates = [];
  const seenDates = new Set();
  let cursor = new Date(start);

  while (candidates.length < probeLimit) {
    const isoDate = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !seenDates.has(isoDate)) {
      const dte = businessDayDiff(normalizedEntryDate, isoDate);
      if (dte < normalizedMinDte) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        continue;
      }
      seenDates.add(isoDate);
      const outsideRangePenalty = dte < normalizedMinDte
        ? normalizedMinDte - dte
        : dte > normalizedMaxDte
          ? dte - normalizedMaxDte
          : 0;
      const targetPenalty = hasTargetDte ? Math.abs(dte - normalizedTargetDte) : 0;
      candidates.push({
        date: isoDate,
        dte,
        score: outsideRangePenalty * 10 + targetPenalty,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getTime() - start.getTime() > 45 * 86400000) {
      break;
    }
  }

  return candidates
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      if (left.dte !== right.dte) {
        return left.dte - right.dte;
      }
      return String(left.date).localeCompare(String(right.date));
    })
    .map((candidateDate) => candidateDate.date);
}

function normalizeStrikeIncrement(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.round(numeric * 1000) / 1000;
}

function roundStrikeToIncrement(strike, increment) {
  const normalizedStrike = Number(strike);
  const normalizedIncrement = normalizeStrikeIncrement(increment);
  if (!Number.isFinite(normalizedStrike) || !normalizedIncrement) {
    return null;
  }
  return Math.round(normalizedStrike / normalizedIncrement) * normalizedIncrement;
}

export function buildDirectStrikeProbeValues(
  spotPrice,
  {
    radius = DIRECT_REPLAY_STRIKE_RADIUS,
    increments = [1, 0.5, 2.5, 5],
  } = {},
) {
  const normalizedSpotPrice = Number(spotPrice);
  if (!Number.isFinite(normalizedSpotPrice) || normalizedSpotPrice <= 0) {
    return [];
  }
  const normalizedRadius = Math.max(2, Math.min(20, Math.round(Number(radius) || DIRECT_REPLAY_STRIKE_RADIUS)));
  const values = new Set();

  for (const rawIncrement of increments) {
    const increment = normalizeStrikeIncrement(rawIncrement);
    if (!increment) {
      continue;
    }
    const scaledSpot = normalizedSpotPrice / increment;
    const candidateCenters = new Set([
      roundStrikeToIncrement(normalizedSpotPrice, increment),
      Math.floor(scaledSpot) * increment,
      Math.ceil(scaledSpot) * increment,
    ].filter((value) => Number.isFinite(value)));
    if (!candidateCenters.size) {
      continue;
    }
    for (const centered of candidateCenters) {
      for (let offset = -normalizedRadius; offset <= normalizedRadius; offset += 1) {
        const strike = Math.round((centered + offset * increment) * 1000) / 1000;
        if (strike > 0) {
          values.add(strike.toFixed(3));
        }
      }
    }
  }

  return [...values]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
}

async function probeDirectReplayContractsForExpiry(request, candidate, expiryDate, options = {}) {
  const desiredRight = candidate.direction === "short" ? "put" : "call";
  const directStrikeValues = buildDirectStrikeProbeValues(candidate.spotPrice);
  if (!directStrikeValues.length) {
    return { contracts: [], barsByTicker: {} };
  }

  const windowTo = minDateText(expiryDate, request.replayEndDate);
  const probes = await Promise.all(
    directStrikeValues.map(async (strike) => {
      const optionTicker = buildOptionTicker(
        {
          symbol: request.underlyingTicker,
          expiry: expiryDate,
          strike,
          right: desiredRight,
        },
        request.underlyingTicker,
      );
      if (!optionTicker) {
        return null;
      }

      const barsCacheKey = JSON.stringify({
        optionTicker,
        from: candidate.entryDate,
        to: windowTo,
      });
      const bars = await getCachedAsync(options.barsCache, barsCacheKey, async () => {
        try {
          const payload = await getMassiveOptionsBarsWithCache(
            {
              optionTicker,
              from: candidate.entryDate,
              to: windowTo,
              multiplier: 1,
              timespan: "minute",
              adjusted: true,
              sort: "asc",
              limit: 50000,
            },
            {
              apiKey: options.apiKey,
              timeoutMs: options.timeoutMs,
            },
          );
          return Array.isArray(payload?.bars) ? payload.bars : [];
        } catch {
          return [];
        }
      });

      if (!bars.length) {
        return null;
      }

      return {
        contract: {
          optionTicker,
          underlyingTicker: request.underlyingTicker,
          expiry: expiryDate,
          strike,
          right: desiredRight,
        },
        bars,
      };
    }),
  );

  const contracts = [];
  const barsByTicker = {};
  for (const probe of probes) {
    if (!probe?.contract?.optionTicker || !Array.isArray(probe.bars) || !probe.bars.length) {
      continue;
    }
    contracts.push(probe.contract);
    barsByTicker[probe.contract.optionTicker] = probe.bars;
  }

  return {
    contracts,
    barsByTicker,
  };
}

async function resolveReplayCandidateContractDirect(request, candidate, options = {}) {
  const candidateSelection = candidate?.optionSelectionSpec && typeof candidate.optionSelectionSpec === "object"
    ? candidate.optionSelectionSpec
    : {};
  const hasTargetDte = Number.isFinite(Number(candidateSelection.targetDte ?? request.targetDte));
  const targetDte = hasTargetDte
    ? clampNumber(candidateSelection.targetDte ?? request.targetDte, 0, 60, 5)
    : null;
  const minDte = clampNumber(candidateSelection.minDte ?? request.minDte, 0, 60, 0);
  const maxDte = clampNumber(candidateSelection.maxDte ?? request.maxDte, minDte, 60);
  const strikeSlot = Number.isFinite(Number(candidateSelection.strikeSlot))
    ? clampStrikeSlot(candidateSelection.strikeSlot)
    : request.strikeSlot;
  const moneyness = candidateSelection.moneyness || request.moneyness;
  const strikeSteps = Number.isFinite(Number(candidateSelection.strikeSteps))
    ? clampNumber(candidateSelection.strikeSteps, 0, 25, 1)
    : request.strikeSteps;
  const expiryDates = buildDirectExpiryProbeDates(candidate.entryDate, {
    targetDte,
    minDte,
    maxDte,
  });

  for (const expiryDate of expiryDates) {
    const chainCacheKey = JSON.stringify({
      direct: true,
      underlyingTicker: request.underlyingTicker,
      expiryDate,
      entryDate: candidate.entryDate,
      direction: candidate.direction,
      spotPrice: Math.round(Number(candidate.spotPrice) * 100) / 100,
      targetDte,
      minDte,
      maxDte,
      strikeSlot,
      moneyness,
      strikeSteps,
    });
    const directChain = await getCachedAsync(options.chainCache, chainCacheKey, async () => probeDirectReplayContractsForExpiry(
      request,
      candidate,
      expiryDate,
      options,
    ));
    const contracts = Array.isArray(directChain?.contracts) ? directChain.contracts : [];
    if (!contracts.length) {
      continue;
    }

    const selection = selectContractFromChain({
      contracts,
      spotPrice: candidate.spotPrice,
      right: candidate.direction === "short" ? "put" : "call",
      strikeSlot,
      moneyness,
      strikeSteps,
    });
    const contract = selection?.contract || null;
    const bars = contract?.optionTicker
      ? (directChain?.barsByTicker?.[contract.optionTicker] || [])
      : [];
    if (!contract?.optionTicker || !bars.length) {
      continue;
    }

    return {
      contract,
      bars,
      selectionStrikeSlot: Number.isFinite(Number(selection.selectionStrikeSlot))
        ? Number(selection.selectionStrikeSlot)
        : null,
      selectionStrikeLabel: selection.selectionStrikeLabel || null,
      selectionMoneyness: selection.selectionMoneyness || null,
      selectionSteps: Number.isFinite(Number(selection.selectionSteps))
        ? Number(selection.selectionSteps)
        : null,
      dteSelectionMode: candidate.dteSelectionMode || null,
    };
  }

  return { skipReason: "bars_not_found" };
}

async function resolveReplayCandidateContractFromReference(request, candidate, options = {}) {
  const desiredRight = candidate.direction === "short" ? "put" : "call";
  const candidateSelection = candidate?.optionSelectionSpec && typeof candidate.optionSelectionSpec === "object"
    ? candidate.optionSelectionSpec
    : {};
  const hasTargetDte = Number.isFinite(Number(candidateSelection.targetDte ?? request.targetDte));
  const targetDte = hasTargetDte
    ? clampNumber(candidateSelection.targetDte ?? request.targetDte, 0, 60, 5)
    : null;
  const minDte = clampNumber(candidateSelection.minDte ?? request.minDte, 0, 60, 0);
  const maxDte = clampNumber(candidateSelection.maxDte ?? request.maxDte, minDte, 60);
  const strikeSlot = Number.isFinite(Number(candidateSelection.strikeSlot))
    ? clampStrikeSlot(candidateSelection.strikeSlot)
    : request.strikeSlot;
  const moneyness = candidateSelection.moneyness || request.moneyness;
  const strikeSteps = Number.isFinite(Number(candidateSelection.strikeSteps))
    ? clampNumber(candidateSelection.strikeSteps, 0, 25, 1)
    : request.strikeSteps;
  const minExpiryDate = addBusinessDays(
    candidate.entryDate,
    hasTargetDte ? 0 : minDte,
  );
  const maxExpiryDate = addBusinessDays(
    candidate.entryDate,
    hasTargetDte ? 60 : maxDte,
  );
  const expiryCacheKey = JSON.stringify({
    underlyingTicker: request.underlyingTicker,
    contractType: desiredRight,
    asOf: candidate.entryDate,
    targetDte,
    minExpiryDate,
    maxExpiryDate,
  });
  const expiries = await getCachedAsync(options.expiryCache, expiryCacheKey, async () => {
    const expirySearch = await searchMassiveOptionContracts(
      {
        underlyingTicker: request.underlyingTicker,
        contractType: desiredRight,
        asOf: candidate.entryDate,
        expirationDateGte: minExpiryDate,
        expirationDateLte: maxExpiryDate,
        expired: false,
        limit: 1000,
        sort: "expiration_date",
        order: "asc",
      },
      {
        apiKey: options.apiKey,
        timeoutMs: options.timeoutMs,
      },
    );
    return [...new Set((expirySearch.contracts || []).map((contract) => contract.expiry).filter(Boolean))].sort();
  });

  if (!expiries.length) {
    return { skipReason: "contract_not_found" };
  }

  const orderedExpiries = hasTargetDte
    ? [...expiries].sort((left, right) => {
      const leftDte = businessDayDiff(candidate.entryDate, left);
      const rightDte = businessDayDiff(candidate.entryDate, right);
      const leftDelta = Math.abs(leftDte - targetDte);
      const rightDelta = Math.abs(rightDte - targetDte);
      if (leftDelta !== rightDelta) {
        return leftDelta - rightDelta;
      }
      if (leftDte !== rightDte) {
        return leftDte - rightDte;
      }
      return String(left).localeCompare(String(right));
    })
    : expiries;

  let sawInvalidChain = false;
  for (const selectedExpiry of orderedExpiries) {
    const chainCacheKey = JSON.stringify({
      underlyingTicker: request.underlyingTicker,
      contractType: desiredRight,
      expiry: selectedExpiry,
      asOf: candidate.entryDate,
    });
    const contracts = await getCachedAsync(options.chainCache, chainCacheKey, async () => {
      const chainSearch = await searchMassiveOptionContracts(
        {
          underlyingTicker: request.underlyingTicker,
          contractType: desiredRight,
          expirationDate: selectedExpiry,
          asOf: candidate.entryDate,
          expired: false,
          limit: 1000,
          sort: "strike_price",
          order: "asc",
        },
        {
          apiKey: options.apiKey,
          timeoutMs: options.timeoutMs,
        },
      );
      return Array.isArray(chainSearch?.contracts) ? chainSearch.contracts : [];
    });

    if (!contracts.length) {
      sawInvalidChain = true;
      continue;
    }

    const selection = selectContractFromChain({
      contracts,
      spotPrice: candidate.spotPrice,
      right: desiredRight,
      strikeSlot,
      moneyness,
      strikeSteps,
    });
    if (!selection?.contract) {
      sawInvalidChain = true;
      continue;
    }

    const contract = selection.contract;
    const windowTo = minDateText(contract.expiry, request.replayEndDate);
    const barsCacheKey = JSON.stringify({
      optionTicker: contract.optionTicker,
      from: candidate.entryDate,
      to: windowTo,
    });
    const bars = await getCachedAsync(options.barsCache, barsCacheKey, async () => {
      try {
        const payload = await getMassiveOptionsBarsWithCache(
          {
            optionTicker: contract.optionTicker,
            from: candidate.entryDate,
            to: windowTo,
            multiplier: 1,
            timespan: "minute",
            adjusted: true,
            sort: "asc",
            limit: 50000,
          },
          {
            apiKey: options.apiKey,
            timeoutMs: options.timeoutMs,
          },
        );
        return Array.isArray(payload?.bars) ? payload.bars : [];
      } catch {
        return [];
      }
    });

    if (!bars.length) {
      continue;
    }

    return {
      contract,
      bars,
      selectionStrikeSlot: Number.isFinite(Number(selection.selectionStrikeSlot))
        ? Number(selection.selectionStrikeSlot)
        : null,
      selectionStrikeLabel: selection.selectionStrikeLabel || null,
      selectionMoneyness: selection.selectionMoneyness || null,
      selectionSteps: Number.isFinite(Number(selection.selectionSteps))
        ? Number(selection.selectionSteps)
        : null,
      dteSelectionMode: candidate.dteSelectionMode || null,
    };
  }

  return {
    skipReason: sawInvalidChain ? "invalid_chain" : "bars_not_found",
  };
}

async function resolveReplayCandidateContract(request, candidate, options = {}) {
  if (DIRECT_REPLAY_TICKER_RESOLUTION_ENABLED) {
    return resolveReplayCandidateContractDirect(request, candidate, options);
  }

  return resolveReplayCandidateContractFromReference(request, candidate, options);
}

function buildStrikeSlotContracts(filtered, spotPrice) {
  const below = [];
  const above = [];

  for (const contract of filtered) {
    const strike = Number(contract?.strike);
    if (!Number.isFinite(strike)) {
      continue;
    }
    if (strike < spotPrice) {
      below.push(contract);
    } else {
      above.push(contract);
    }
  }

  below.sort((left, rightContract) => Number(rightContract?.strike) - Number(left?.strike));
  above.sort((left, rightContract) => Number(left?.strike) - Number(rightContract?.strike));

  return [
    below[2] || null,
    below[1] || null,
    below[0] || null,
    above[0] || null,
    above[1] || null,
    above[2] || null,
  ];
}

function resolveAutoStrikeSlot(slotContracts, spotPrice) {
  const belowContract = slotContracts[2] || null;
  const aboveContract = slotContracts[3] || null;
  if (belowContract && aboveContract) {
    const belowDelta = Math.abs(Number(belowContract.strike) - spotPrice);
    const aboveDelta = Math.abs(Number(aboveContract.strike) - spotPrice);
    return aboveDelta <= belowDelta ? 3 : 2;
  }
  if (aboveContract) {
    return 3;
  }
  if (belowContract) {
    return 2;
  }
  return DEFAULT_STRIKE_SLOT;
}

function selectContractFromLegacySelection(filtered, spotPrice, right, moneyness, strikeSteps) {
  let atmIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < filtered.length; index += 1) {
    const delta = Math.abs(Number(filtered[index].strike) - spotPrice);
    if (delta < bestDelta) {
      bestDelta = delta;
      atmIndex = index;
    }
  }

  const normalizedSteps = Number.isFinite(Number(strikeSteps)) ? Number(strikeSteps) : 1;
  let offset = 0;
  if (moneyness === "otm") {
    offset = right === "call" ? normalizedSteps : -normalizedSteps;
  } else if (moneyness === "itm") {
    offset = right === "call" ? -normalizedSteps : normalizedSteps;
  }

  const selectedIndex = atmIndex + offset;
  if (selectedIndex < 0 || selectedIndex >= filtered.length) {
    return {
      contract: null,
      selectionStrikeSlot: null,
      selectionStrikeLabel: null,
      selectionMoneyness: moneyness || null,
      selectionSteps: normalizedSteps,
    };
  }

  return {
    contract: filtered[selectedIndex],
    selectionStrikeSlot: null,
    selectionStrikeLabel: null,
    selectionMoneyness: moneyness || null,
    selectionSteps: normalizedSteps,
  };
}

function selectContractFromChain({
  contracts = [],
  spotPrice,
  right,
  strikeSlot,
  moneyness,
  strikeSteps,
}) {
  const filtered = (Array.isArray(contracts) ? contracts : [])
    .filter((contract) => String(contract?.right || "").trim().toLowerCase() === right)
    .sort((left, rightContract) => Number(left?.strike) - Number(rightContract?.strike));
  if (!filtered.length) {
    return null;
  }

  const hasExplicitStrikeSlot = Number.isFinite(Number(strikeSlot));
  if (hasExplicitStrikeSlot || !moneyness) {
    const slotContracts = buildStrikeSlotContracts(filtered, spotPrice);
    const resolvedStrikeSlot = hasExplicitStrikeSlot
      ? clampStrikeSlot(strikeSlot)
      : resolveAutoStrikeSlot(slotContracts, spotPrice);
    return {
      contract: slotContracts[resolvedStrikeSlot] || null,
      selectionStrikeSlot: resolvedStrikeSlot,
      selectionStrikeLabel: formatStrikeSlotLabel(resolvedStrikeSlot),
      selectionMoneyness: null,
      selectionSteps: null,
    };
  }

  return selectContractFromLegacySelection(filtered, spotPrice, right, moneyness, strikeSteps);
}

function addBusinessDays(dateText, days) {
  if (!days) {
    return dateText;
  }
  const date = new Date(`${dateText}T12:00:00Z`);
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  return date.toISOString().slice(0, 10);
}

function businessDayDiff(fromDate, toDate) {
  const from = optionalDateText(fromDate);
  const to = optionalDateText(toDate);
  if (!from || !to) {
    return null;
  }
  if (from >= to) {
    return 0;
  }

  const cursor = new Date(`${from}T12:00:00Z`);
  const limit = new Date(`${to}T12:00:00Z`);
  let businessDays = 0;
  while (cursor < limit) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      businessDays += 1;
    }
  }
  return businessDays;
}

function calendarDayDiff(fromDate, toDate) {
  const from = optionalDateText(fromDate);
  const to = optionalDateText(toDate);
  if (!from || !to) {
    return null;
  }
  const fromMs = Date.parse(`${from}T12:00:00Z`);
  const toMs = Date.parse(`${to}T12:00:00Z`);
  return Math.max(0, Math.round((toMs - fromMs) / 86400000));
}

function minDateText(left, right) {
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
}

function maxDateText(left, right) {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

function mergeReplayBars(existingBars = [], nextBars = []) {
  const byTime = new Map();
  for (const bar of [...(Array.isArray(existingBars) ? existingBars : []), ...(Array.isArray(nextBars) ? nextBars : [])]) {
    const time = Number(bar?.time);
    if (!Number.isFinite(time)) {
      continue;
    }
    byTime.set(time, bar);
  }
  return [...byTime.values()].sort((left, right) => Number(left?.time) - Number(right?.time));
}

async function fetchMassiveOptionsAggregates(request, options = {}) {
  const timeoutMs = clampNumber(options.timeoutMs, 1000, MAX_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const query = new URLSearchParams({
    adjusted: request.adjusted ? "true" : "false",
    sort: request.sort,
    limit: String(request.limit),
    apiKey: String(options.apiKey || ""),
  });
  const url = `${MASSIVE_API_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(
    request.optionTicker,
  )}/range/${request.multiplier}/${request.timespan}/${request.from}/${request.to}?${query.toString()}`;

  const { payload } = await fetchMassiveJsonWithRetry(url, {
    method: "GET",
    timeoutMs,
  });

  const rows = Array.isArray(payload?.results) ? payload.results : [];
  return {
    requestId: payload?.request_id || null,
    queryCount: toFiniteNumber(payload?.queryCount, rows.length),
    resultsCount: toFiniteNumber(payload?.resultsCount, rows.length),
    bars: normalizeMassiveBars(rows),
  };
}

function normalizeMassiveContract(row) {
  const optionTicker = String(row?.ticker || "").trim().toUpperCase();
  const underlyingTicker = String(row?.underlying_ticker || "").trim().toUpperCase();
  const expirationDate = optionalDateText(row?.expiration_date);
  const strike = toFiniteNumber(row?.strike_price, null);
  const contractType = normalizeContractType(row?.contract_type);
  if (!optionTicker || !underlyingTicker || !expirationDate || !Number.isFinite(strike) || !contractType) {
    return null;
  }

  return {
    optionTicker,
    underlyingTicker,
    expiry: expirationDate,
    strike,
    right: contractType,
    sharesPerContract: toFiniteNumber(row?.shares_per_contract, null),
    primaryExchange: optionalString(row?.primary_exchange, null),
    exerciseStyle: optionalString(row?.exercise_style, null),
    correction: toFiniteNumber(row?.correction, null),
    cfi: optionalString(row?.cfi, null),
    additionalUnderlyings: Array.isArray(row?.additional_underlyings)
      ? row.additional_underlyings
      : [],
  };
}

function rankMassiveContracts(contracts = [], targetStrike = null) {
  const normalizedTargetStrike = toFiniteNumber(targetStrike, null);
  return [...(Array.isArray(contracts) ? contracts : [])].sort((left, right) => {
    if (Number.isFinite(normalizedTargetStrike)) {
      const leftDelta = Math.abs(Number(left?.strike) - normalizedTargetStrike);
      const rightDelta = Math.abs(Number(right?.strike) - normalizedTargetStrike);
      if (leftDelta !== rightDelta) {
        return leftDelta - rightDelta;
      }
    }
    const strikeDiff = Number(left?.strike) - Number(right?.strike);
    if (Number.isFinite(strikeDiff) && strikeDiff !== 0) {
      return strikeDiff;
    }
    return String(left?.optionTicker || "").localeCompare(String(right?.optionTicker || ""));
  });
}

function normalizeMassiveBars(rows = []) {
  return rows
    .map((row) => {
      const time = Number(row?.t);
      if (!Number.isFinite(time)) {
        return null;
      }
      const open = Number(row?.o);
      const high = Number(row?.h);
      const low = Number(row?.l);
      const close = Number(row?.c);
      if (![open, high, low, close].every(Number.isFinite)) {
        return null;
      }
      const dt = new Date(Math.round(time));
      const iso = dt.toISOString();
      return {
        time: Math.round(time),
        ts: `${iso.slice(0, 10)} ${iso.slice(11, 16)}`,
        date: iso.slice(0, 10),
        o: round2(open),
        h: round2(high),
        l: round2(low),
        c: round2(close),
        v: Math.max(0, Math.round(Number(row?.v) || 0)),
        n: Math.max(0, Math.round(Number(row?.n) || 0)),
        vw: Number.isFinite(Number(row?.vw)) ? round4(Number(row.vw)) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

function normalizeMassiveEquityBars(rows = [], request = {}) {
  const isDaily = String(request?.timespan || "").trim().toLowerCase() === "day";
  const sessionMode = String(request?.session || "regular").trim().toLowerCase();

  return rows
    .map((row) => {
      const time = Number(row?.t);
      const open = Number(row?.o);
      const high = Number(row?.h);
      const low = Number(row?.l);
      const close = Number(row?.c);
      if (![time, open, high, low, close].every(Number.isFinite)) {
        return null;
      }

      const epochMs = Math.round(time);
      const marketTime = getMarketTimePartsFromEpochMs(epochMs);
      if (!isDaily && sessionMode === "regular" && !isRegularMarketSessionParts(marketTime)) {
        return null;
      }

      if (isDaily) {
        return {
          time: getEpochMsForMarketDateTime(marketTime.date, 9, 30),
          ts: marketTime.date,
          date: marketTime.date,
          hour: 9,
          min: 30,
          o: round2(open),
          h: round2(high),
          l: round2(low),
          c: round2(close),
          v: Math.max(0, Math.round(Number(row?.v) || 0)),
          n: Math.max(0, Math.round(Number(row?.n) || 0)),
          vw: Number.isFinite(Number(row?.vw)) ? round4(Number(row.vw)) : null,
        };
      }

      return buildResearchBarFromEpochMs(epochMs, {
        o: round2(open),
        h: round2(high),
        l: round2(low),
        c: round2(close),
        v: Math.max(0, Math.round(Number(row?.v) || 0)),
        n: Math.max(0, Math.round(Number(row?.n) || 0)),
        vw: Number.isFinite(Number(row?.vw)) ? round4(Number(row.vw)) : null,
      });
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

function buildCacheKey(request) {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(request))
    .digest("hex");
}

function buildCachePath(request, cacheKey = buildCacheKey(request)) {
  const safeTicker = String(request.optionTicker || "")
    .replace(/[^A-Z0-9:_-]+/gi, "_")
    .slice(0, 120) || "unknown";
  return path.join(MASSIVE_CACHE_ROOT, safeTicker, `${cacheKey}.json`);
}

function buildEquityCachePath(request, cacheKey = buildCacheKey(request)) {
  const safeTicker = String(request.ticker || "")
    .replace(/[^A-Z0-9._-]+/gi, "_")
    .slice(0, 40) || "unknown";
  return path.join(MASSIVE_EQUITY_CACHE_ROOT, safeTicker, `${cacheKey}.json`);
}

function buildContractQueryCachePath(request, cacheKey = buildCacheKey(request)) {
  const safeUnderlying = String(request.underlyingTicker || "")
    .replace(/[^A-Z0-9._-]+/gi, "_")
    .slice(0, 40) || "unknown";
  return path.join(MASSIVE_CONTRACT_CACHE_ROOT, safeUnderlying, `${cacheKey}.json`);
}

async function readCachedPayload(cachePath) {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeCachedPayload(cachePath, payload) {
  const dir = path.dirname(cachePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), "utf8");
}

async function listJsonFiles(rootDir) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return out;
    }
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listJsonFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      out.push(fullPath);
    }
  }
  return out;
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = clampNumber(options.timeoutMs, 1000, MAX_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    return await fetch(url, {
      ...options,
      signal: controller?.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Massive request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeoutId != null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

function createMassiveHttpError(response, payload = {}) {
  const error = new Error(payload?.error || payload?.message || `Massive request failed (${response.status})`);
  error.status = response.status;
  error.payload = payload;
  return error;
}

export function isRetryableMassiveError(error = null) {
  const status = Number(error?.status);
  if (Number.isFinite(status) && RETRYABLE_MASSIVE_STATUS_CODES.has(status)) {
    return true;
  }
  const message = String(error?.message || "").trim().toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes("timed out")
    || message.includes("network request failed")
    || message.includes("fetch failed")
    || message.includes("socket hang up")
    || message.includes("econnreset")
    || message.includes("econnrefused")
    || message.includes("enotfound")
  );
}

function resolveMassiveRetryDelayMs(attempt = 0, overrideDelayMs = null) {
  const baseDelayMs = overrideDelayMs == null
    ? DEFAULT_MASSIVE_RETRY_DELAY_MS
    : clampNumber(overrideDelayMs, 0, 10000, DEFAULT_MASSIVE_RETRY_DELAY_MS);
  return Math.min(10000, baseDelayMs * Math.max(1, attempt + 1));
}

function waitForDelay(delayMs) {
  if (!(delayMs > 0)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

export async function fetchMassiveJsonWithRetry(url, options = {}) {
  const {
    retries = DEFAULT_MASSIVE_RETRY_COUNT,
    retryDelayMs = null,
    ...fetchOptions
  } = options || {};
  const maxRetries = clampNumber(retries, 0, 3, DEFAULT_MASSIVE_RETRY_COUNT);

  let attempt = 0;
  while (true) {
    try {
      const response = await fetchWithTimeout(url, fetchOptions);
      const payload = await parseJsonBody(response);
      if (!response.ok) {
        throw createMassiveHttpError(response, payload);
      }
      return { response, payload, attempts: attempt + 1 };
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableMassiveError(error)) {
        throw error;
      }
      await waitForDelay(resolveMassiveRetryDelayMs(attempt, retryDelayMs));
      attempt += 1;
    }
  }
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timerId = globalThis.setTimeout(() => {
        reject(new Error(message || `Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      promise.finally(() => {
        globalThis.clearTimeout(timerId);
      }).catch(() => {});
    }),
  ]);
}

async function fetchMassiveEquityAggregates(request, options = {}) {
  const timeoutMs = clampNumber(options.timeoutMs, 1000, MAX_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const query = new URLSearchParams({
    adjusted: request.adjusted ? "true" : "false",
    sort: request.sort,
    limit: String(request.limit),
    apiKey: String(options.apiKey || ""),
  });
  const url = `${MASSIVE_API_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(
    request.ticker,
  )}/range/${request.multiplier}/${request.timespan}/${request.from}/${request.to}?${query.toString()}`;

  const { payload } = await fetchMassiveJsonWithRetry(url, {
    method: "GET",
    timeoutMs,
  });

  const rows = Array.isArray(payload?.results) ? payload.results : [];
  return {
    requestId: payload?.request_id || null,
    queryCount: toFiniteNumber(payload?.queryCount, rows.length),
    resultsCount: toFiniteNumber(payload?.resultsCount, rows.length),
    bars: normalizeMassiveEquityBars(rows, request),
  };
}

async function parseJsonBody(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseBooleanDefaultTrue(value) {
  if (value == null || value === "") {
    return true;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value > 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "n") {
      return false;
    }
  }
  return true;
}

function normalizeSort(value) {
  const normalized = String(value || "asc").trim().toLowerCase();
  return normalized === "desc" ? "desc" : "asc";
}

async function readMassiveOptionsBarsFromNormalizedStore(request, { cacheKey, cachePath } = {}) {
  if (!shouldUseNormalizedOptionBarStore(request)) {
    return null;
  }

  const fromDate = normalizeAggregateRangeDate(request?.from);
  const toDate = normalizeAggregateRangeDate(request?.to);
  if (!fromDate || !toDate) {
    return null;
  }

  const coverage = await readResearchOptionBarsCoverage({
    optionTicker: request.optionTicker,
    session: "regular",
    timeframe: "1m",
  });
  if (!coverage?.coverageStart || !coverage?.coverageEnd) {
    return null;
  }
  if (coverage.coverageStart > fromDate || coverage.coverageEnd < toDate) {
    return null;
  }

  const bars = await readResearchOptionBars({
    optionTicker: request.optionTicker,
    session: "regular",
    from: fromDate,
    to: toDate,
    limit: request.limit,
    sort: request.sort,
  });
  if (!Array.isArray(bars) || !bars.length) {
    return null;
  }

  const fetchedAt = coverage.fetchedAt || new Date().toISOString();
  return {
    provider: "massive",
    optionTicker: request.optionTicker,
    multiplier: request.multiplier,
    timespan: request.timespan,
    from: request.from,
    to: request.to,
    adjusted: request.adjusted,
    sort: request.sort,
    limit: request.limit,
    source: coverage.source || "massive-options-history",
    dataQuality: "historical_vendor",
    requestId: null,
    queryCount: bars.length,
    resultsCount: bars.length,
    bars,
    fetchedAt,
    cache: {
      hit: true,
      refreshed: false,
      layer: "normalized-database",
      key: cacheKey,
      path: cachePath,
      fetchedAt,
    },
  };
}

function shouldUseNormalizedOptionBarStore(request = {}) {
  if (!isResearchOptionBarStoreEnabled()) {
    return false;
  }
  return Number(request?.multiplier) === 1
    && String(request?.timespan || "").trim().toLowerCase() === "minute";
}

function normalizeAggregateRangeDate(value) {
  const direct = optionalDateText(value);
  if (direct) {
    return direct;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return getMarketTimePartsFromEpochMs(Math.round(numeric)).date;
  }
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return getMarketTimePartsFromEpochMs(parsed).date;
}

function normalizeTimespan(value) {
  const normalized = String(value || "minute").trim().toLowerCase();
  if (!normalized) {
    return "minute";
  }
  if (!/^[a-z]+$/.test(normalized)) {
    throw new Error("timespan must contain only letters");
  }
  return normalized;
}

function normalizeContractType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "call" || normalized === "put") {
    return normalized;
  }
  return null;
}

function normalizeMoneyness(value) {
  const normalized = String(value || "atm").trim().toLowerCase();
  if (normalized === "itm" || normalized === "otm") {
    return normalized;
  }
  return "atm";
}

function normalizeContractSortField(value) {
  const normalized = String(value || "strike_price").trim().toLowerCase();
  return /^[a-z_]+$/.test(normalized) ? normalized : "strike_price";
}

function optionalDateText(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeEquityAggregateRequest(request = {}) {
  const ticker = String(request?.ticker || request?.symbol || "").trim().toUpperCase();
  if (!ticker) {
    throw new Error("ticker is required");
  }

  const timespan = optionalString(request?.timespan, "minute").toLowerCase();
  if (!["minute", "day"].includes(timespan)) {
    throw new Error("timespan must be minute or day");
  }

  const from = optionalDateText(request?.from);
  const to = optionalDateText(request?.to);
  if (!from || !to) {
    throw new Error("from and to dates are required");
  }

  return {
    ticker,
    multiplier: clampNumber(request?.multiplier, 1, 1000, 1),
    timespan,
    from,
    to,
    adjusted: request?.adjusted == null ? true : Boolean(request.adjusted),
    sort: normalizeSort(request?.sort),
    limit: clampNumber(request?.limit, 1, 50000, DEFAULT_LIMIT),
    session: optionalString(request?.session, "regular").toLowerCase() === "all" ? "all" : "regular",
  };
}

function optionalString(value, fallback = null) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function hasCredentialValue(value) {
  if (value == null) {
    return false;
  }
  return String(value).trim() !== "";
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return fallback;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}
