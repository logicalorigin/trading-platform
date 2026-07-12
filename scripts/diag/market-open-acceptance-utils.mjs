export function assertStableApiPid(expectedPid, observedPid) {
  if (!Number.isFinite(expectedPid) || !Number.isFinite(observedPid)) {
    throw new Error(
      `API pid unavailable (expected=${expectedPid ?? "n-a"}, observed=${observedPid ?? "n-a"})`,
    );
  }
  if (observedPid !== expectedPid) {
    throw new Error(`API pid changed from ${expectedPid} to ${observedPid}`);
  }
}

export function acceptanceFailedStepKeys(steps, requiredKeys) {
  return requiredKeys.filter((key) => steps[key]?.ok !== true);
}

export function diffRuntimeCounters(before = {}, after = {}) {
  return Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])].map((key) => [
      key,
      finite(after[key]) != null && finite(before[key]) != null
        ? finite(after[key]) - finite(before[key])
        : null,
    ]),
  );
}

export function summarizeRuntimeSamples(samples) {
  const valid = samples.filter((sample) => sample?.snapshot);
  const first = valid[0]?.snapshot ?? null;
  const last = valid.at(-1)?.snapshot ?? null;
  return {
    sampleCount: valid.length,
    firstAt: valid[0]?.at ?? null,
    lastAt: valid.at(-1)?.at ?? null,
    peakEventLoopUtilization: maxValue(valid, (sample) => sample.snapshot.api.eventLoopUtilization),
    peakEventLoopDelayP95Ms: maxValue(valid, (sample) => sample.snapshot.api.eventLoopDelayP95Ms),
    peakHeapUsedMb: maxValue(valid, (sample) => sample.snapshot.api.heapUsedMb),
    peakRssMb: maxValue(valid, (sample) => sample.snapshot.api.rssMb),
    peakDbRawWaiting: maxValue(valid, (sample) => sample.snapshot.db.rawWaiting),
    peakDbAdmissionQueued: maxValue(valid, (sample) => sample.snapshot.db.admissionQueued),
    peakDbTotalWaiting: maxValue(valid, (sample) => sample.snapshot.db.totalWaiting),
    counterDelta:
      first && last ? diffRuntimeCounters(first.counters, last.counters) : {},
    first,
    last,
  };
}

export function pickRuntimeAcceptanceSnapshot(runtime) {
  const streams = getPath(runtime, ["ibkr", "streams"]) ?? {};
  const localBars = streams.signalMonitorLocalBars ?? {};
  const storedBarsCache = localBars.storedBarsCache ?? {};
  const storedBarsDelta = localBars.storedBarsDelta ?? {};
  const completedBarsCache =
    streams.signalMonitorResidentBars?.completedBarsCache ?? {};
  const incremental = streams.signalMonitorIncrementalEval ?? {};
  const admissionLanes = Array.isArray(runtime?.dbPoolAdmission?.lanes)
    ? runtime.dbPoolAdmission.lanes.map((lane) =>
        pick(lane, [
          "lane",
          "queued",
          "inFlight",
          "admitted",
          "maxWaitMs",
          "p95WaitMs",
        ]),
      )
    : [];
  const rawWaiting = finite(runtime?.api?.resourcePressure?.inputs?.dbPoolWaiting) ?? 0;
  const admissionQueued = admissionLanes.reduce(
    (sum, lane) => sum + (finite(lane.queued) ?? 0),
    0,
  );
  const marketDataAdmission = streams.marketDataAdmission ?? {};
  const scannerCoverage = marketDataAdmission.optionsFlowScanner?.coverage ?? {};
  const signalMatrix = streams.signalMatrix ?? {};

  return {
    api: {
      eventLoopUtilization: finite(runtime?.api?.eventLoopUtilization),
      eventLoopDelayP95Ms: finite(runtime?.api?.eventLoopDelayMs?.p95),
      heapUsedMb: finite(runtime?.api?.memoryMb?.heapUsed),
      rssMb: finite(runtime?.api?.memoryMb?.rss),
      resourceLevel:
        runtime?.api?.resourcePressure?.resourceLevel ??
        runtime?.api?.resourcePressure?.level ??
        null,
    },
    db: {
      active: finite(runtime?.api?.resourcePressure?.inputs?.dbPoolActive),
      max: finite(runtime?.api?.resourcePressure?.inputs?.dbPoolMax),
      rawWaiting,
      admissionQueued,
      totalWaiting: rawWaiting + admissionQueued,
      admissionLanes,
    },
    counters: {
      storedBarsHitCount: finite(storedBarsCache.hitCount),
      storedBarsMissCount: finite(storedBarsCache.missCount),
      storedBarsFullReadCount: finite(storedBarsCache.fullReadCount),
      storedBarsDeltaReadCount: finite(storedBarsCache.deltaReadCount),
      storedBarsInvalidationFullCount: finite(storedBarsCache.invalidationFullCount),
      storedBarsInvalidationTruncateCount: finite(
        storedBarsCache.invalidationTruncateCount,
      ),
      storedBarsDeltaReads: finite(storedBarsDelta.deltaReads),
      storedBarsDeltaGapFallbacks: finite(storedBarsDelta.gapFallbacks),
      storedBarsDeltaShadowMismatches: finite(storedBarsDelta.shadowMismatches),
      incrementalSeeds: finite(incremental.seeds),
      incrementalAppends: finite(incremental.appends),
      incrementalFormingReplays: finite(incremental.formingReplays),
      incrementalShadowMismatches: finite(incremental.shadowMismatches),
      matrixServeMismatchCount: finite(incremental.matrixServeMismatchCount),
      stockQuoteReconnectCount: finite(streams.massiveStockQuotes?.reconnectCount),
      stockAggregateReconnectCount: finite(
        streams.stockAggregates?.massiveDelayedWebSocket?.reconnectCount,
      ),
      matrixEventCount: finite(signalMatrix.eventCount),
    },
    diagnostics: {
      storedBarsCache: pick(storedBarsCache, [
        "maxCells",
        "cellCount",
        "barCount",
        "compactBarCount",
        "objectBarCount",
        "compactBytes",
      ]),
      storedBarsDelta: pick(storedBarsDelta, ["mode"]),
      completedBarsCache: pick(completedBarsCache, ["entries", "bars"]),
      incremental: pick(incremental, [
        "mode",
        "lastMatrixServeMismatchAt",
        "lastMatrixServeMismatchCellKey",
        "matrixServeMismatchByField",
      ]),
      signalMatrix: pick(signalMatrix, [
        "state",
        "source",
        "activeProvider",
        "activeScopeSymbols",
        "activeScopeCells",
        "lastEventAt",
        "lastEventAgeMs",
        "sourceState",
      ]),
      scannerCoverage: pick(scannerCoverage, [
        "targetSize",
        "activeTargetSize",
        "selectedSymbols",
        "cycleScannedSymbols",
        "scannedSymbols",
        "currentBatch",
        "estimatedCycleMs",
        "coverageHealth",
        "marketSessionQuiet",
      ]),
      retainedDemand: {
        ownerClasses: pick(marketDataAdmission.ownerClasses, [
          "retiredOwnerCount",
          "unknownOwnerCount",
          "warnings",
          "summaries",
        ]),
        lineOwnership: pick(marketDataAdmission.lineOwnership, [
          "lineCount",
          "duplicateLineCount",
          "scannerOverlapLineCount",
        ]),
      },
    },
  };
}

function maxValue(values, selector) {
  const numbers = values.map(selector).map(finite).filter((value) => value != null);
  return numbers.length ? Math.max(...numbers) : null;
}

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getPath(value, keys) {
  return keys.reduce((current, key) => current?.[key], value);
}

function pick(value, keys) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]));
}
