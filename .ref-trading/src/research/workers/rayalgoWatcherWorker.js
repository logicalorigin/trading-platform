import { evaluateRayAlgoWatcherCandidates } from "../watchers/rayalgoWatcherCore.js";

const aggregatedBarsCache = new Map();
const resultCache = new Map();
const MAX_RESULT_CACHE_ENTRIES = 12;
const MAX_AGGREGATE_CACHE_ENTRIES = 48;

function trimCache(cache, maxEntries) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

function setCachedResult(cacheKey, result) {
  if (!cacheKey) {
    return;
  }
  if (resultCache.has(cacheKey)) {
    resultCache.delete(cacheKey);
  }
  resultCache.set(cacheKey, result);
  trimCache(resultCache, MAX_RESULT_CACHE_ENTRIES);
}

self.onmessage = (event) => {
  const payload = event?.data || {};
  const requestId = Number(payload?.requestId) || 0;
  const cacheKey = String(payload?.cacheKey || "").trim();
  try {
    if (cacheKey && resultCache.has(cacheKey)) {
      self.postMessage({
        requestId,
        ok: true,
        result: resultCache.get(cacheKey),
      });
      return;
    }
    trimCache(aggregatedBarsCache, MAX_AGGREGATE_CACHE_ENTRIES);
    const result = evaluateRayAlgoWatcherCandidates({
      bars: payload.bars || [],
      capital: payload.capital,
      baseRunConfig: payload.baseRunConfig || {},
      tfMin: payload.tfMin,
      normalizedRayAlgoSettings: payload.normalizedRayAlgoSettings || {},
      currentSignalTimeframe: payload.currentSignalTimeframe,
      previousLeader: payload.previousLeader || null,
      mode: payload.mode,
      aggregatedBarsCache,
    });
    setCachedResult(cacheKey, result);
    self.postMessage({
      requestId,
      ok: true,
      result,
    });
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error?.message || "Failed to evaluate RayAlgo watcher candidates.",
    });
  }
};
