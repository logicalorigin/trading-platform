import path from "node:path";

export function currentGuestBootMarkerIdentity(recorderDir, procStat) {
  const match = String(procStat).match(/^btime\s+(\d+)$/mu);
  const btime = Number(match?.[1]);
  if (!Number.isSafeInteger(btime) || btime <= 0) {
    throw new Error("current guest boot time is unavailable");
  }
  return {
    bootId: `btime:${btime}`,
    markerPath: path.join(recorderDir, "boot-markers", `btime-${btime}.json`),
  };
}

export function assertCurrentGuestBootMarker(marker, bootId) {
  if (marker && marker?.boot?.bootId !== bootId) {
    throw new Error("supervisor marker does not belong to the current guest");
  }
}

export function assertStableApiPid(expectedPid, observedPid) {
  if (!Number.isSafeInteger(expectedPid) || expectedPid <= 0) {
    throw new Error(
      `expected API pid must be a positive safe integer: ${expectedPid ?? "n-a"}`,
    );
  }
  if (!Number.isSafeInteger(observedPid) || observedPid <= 0) {
    throw new Error(
      `observed API pid must be a positive safe integer: ${observedPid ?? "n-a"}`,
    );
  }
  if (observedPid !== expectedPid) {
    throw new Error(`API pid changed from ${expectedPid} to ${observedPid}`);
  }
}

export function assertApiDescendsFromSupervisor(apiAncestry, supervisorPid) {
  if (!apiAncestry.some((entry) => entry?.pid === supervisorPid)) {
    throw new Error(
      `recorded API pid is not descended from supervisor ${supervisorPid ?? "n-a"}`,
    );
  }
}

export function parseProcCmdline(raw) {
  if (typeof raw !== "string" || !raw.endsWith("\0")) return null;
  const argv = raw.slice(0, -1).split("\0");
  return argv.length > 0 && argv.every((value) => value.length > 0)
    ? argv
    : null;
}

export function assertApiProcessRole(identity, expectedCwd, entrypoint) {
  const argv = parseProcCmdline(identity?.cmdlineRaw) ?? [];
  const actualEntrypoint = argv[2]
    ? path.resolve(identity?.cwd ?? "", argv[2])
    : null;
  const expectedEntrypoint = path.resolve(expectedCwd, entrypoint);
  if (
    identity?.cwd !== expectedCwd ||
    !/(?:^|\/)node$/.test(argv[0] ?? "") ||
    argv.length !== 3 ||
    argv[1] !== "--enable-source-maps" ||
    actualEntrypoint !== expectedEntrypoint
  ) {
    throw new Error("recorded process does not match the API role");
  }
}

export function assertFreshApiHeartbeat(updatedAt, nowMs, maxAgeMs) {
  const updatedAtMs = Date.parse(updatedAt);
  const ageMs = nowMs - updatedAtMs;
  if (
    !Number.isFinite(updatedAtMs) ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs <= 0 ||
    ageMs < 0 ||
    ageMs > maxAgeMs
  ) {
    throw new Error("API heartbeat is stale or invalid");
  }
}

export function assertSameProcessIdentity(expected, observed) {
  const keys = ["pid", "startTimeTicks", "cmdlineRaw", "cwd"];
  if (
    !expected ||
    !observed ||
    keys.some((key) => expected[key] == null || expected[key] !== observed[key])
  ) {
    throw new Error("recorded API process identity changed before profiling");
  }
}

export function assertRuntimeSamplesComplete(samples, coverage = null) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("no runtime interval samples were captured");
  }
  const failedCount = samples.filter((sample) => !sample?.snapshot).length;
  if (failedCount > 0) {
    throw new Error(
      `runtime interval sampling failed for ${failedCount} sample(s)`,
    );
  }
  if (coverage) {
    const times = [
      coverage.windowStart,
      ...samples.map((sample) => sample.at),
      coverage.windowEnd,
    ].map((value) => Date.parse(value));
    if (
      !Number.isFinite(coverage.maxGapMs) ||
      coverage.maxGapMs <= 0 ||
      times.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("runtime sample coverage bounds are invalid");
    }
    for (let index = 1; index < times.length; index += 1) {
      const gapMs = times[index] - times[index - 1];
      if (gapMs < 0) throw new Error("runtime samples are out of order");
      if (gapMs > coverage.maxGapMs) {
        throw new Error(
          `runtime sample gap ${gapMs}ms exceeds ${coverage.maxGapMs}ms`,
        );
      }
    }
  }
}

export function calculateCounterRate(first, second) {
  const firstTotal = finite(first?.total);
  const secondTotal = finite(second?.total);
  const firstAtMs = finite(first?.atMs);
  const secondAtMs = finite(second?.atMs);
  if (
    [firstTotal, secondTotal, firstAtMs, secondAtMs].some(
      (value) => value == null,
    )
  ) {
    throw new Error(
      "counter samples must contain finite totals and timestamps",
    );
  }
  const elapsedMs = secondAtMs - firstAtMs;
  if (elapsedMs <= 0) throw new Error("counter elapsed time must be positive");
  const deltaRows = secondTotal - firstTotal;
  if (deltaRows < 0)
    throw new Error("counter decreased during the capture window");
  return {
    elapsedMs,
    deltaRows,
    rowsPerMin: (deltaRows * 60_000) / elapsedMs,
  };
}

export async function cleanupHeapProfiler(inspector, samplingStarted) {
  if (samplingStarted) {
    try {
      await inspector.send("HeapProfiler.stopSampling");
    } catch {
      // Best-effort cleanup continues with disabling the profiler domain.
    }
  }
  try {
    await inspector.send("HeapProfiler.disable");
  } catch {
    // The caller still closes the inspector connection.
  }
}

export function psqlEnvironment(databaseUrl, env = process.env) {
  const connection = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(connection.protocol)) {
    throw new Error(
      `unsupported PostgreSQL URL protocol: ${connection.protocol}`,
    );
  }
  const childEnv = { ...env };
  delete childEnv.DATABASE_URL;
  for (const key of [
    "PGDATABASE",
    "PGHOST",
    "PGHOSTADDR",
    "PGPASSWORD",
    "PGPORT",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGSSLMODE",
    "PGUSER",
  ]) {
    delete childEnv[key];
  }
  childEnv.PGDATABASE = decodeURIComponent(connection.pathname.slice(1));
  childEnv.PGHOST = connection.hostname;
  childEnv.PGPORT = connection.port || "5432";
  if (connection.username) {
    childEnv.PGUSER = decodeURIComponent(connection.username);
  }
  if (connection.password) {
    childEnv.PGPASSWORD = decodeURIComponent(connection.password);
  }
  const sslMode = connection.searchParams.get("sslmode");
  if (sslMode) {
    childEnv.PGSSLMODE = sslMode;
  }
  return childEnv;
}

export function terminateChildWithFallback(child, graceMs, onForceKill = null) {
  child.kill("SIGTERM");
  return setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } finally {
      onForceKill?.();
    }
  }, graceMs);
}

export function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function isWithinAcceptanceWindow(timeMs, startMs, endMs) {
  return (
    Number.isFinite(timeMs) &&
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    timeMs >= startMs &&
    timeMs <= endMs
  );
}

export function isRunDevSupervisorProcess(cmdlineRaw, cwd, expectedCwd) {
  const argv = parseProcCmdline(cmdlineRaw) ?? [];
  const normalizedCwd = String(expectedCwd ?? "").replace(/\/+$/, "");
  return (
    argv.length === 2 &&
    /(?:^|\/)node$/.test(argv[0] ?? "") &&
    ((cwd === normalizedCwd && argv[1] === "./scripts/runDevApp.mjs") ||
      argv[1] === `${normalizedCwd}/scripts/runDevApp.mjs`)
  );
}

export function createSingleFlightRunner(task) {
  let pending = null;
  return {
    run() {
      if (!pending) {
        pending = Promise.resolve()
          .then(task)
          .finally(() => {
            pending = null;
          });
      }
      return pending;
    },
    wait() {
      return pending ?? Promise.resolve();
    },
  };
}

export function acceptanceFailedStepKeys(steps, requiredKeys) {
  return requiredKeys.filter((key) => steps[key]?.ok !== true);
}

export function validateRuntimeAcceptanceSnapshot(snapshot) {
  const required = {
    "api.eventLoopUtilization": snapshot?.api?.eventLoopUtilization,
    "api.eventLoopDelayP95Ms": snapshot?.api?.eventLoopDelayP95Ms,
    "api.heapUsedMb": snapshot?.api?.heapUsedMb,
    "api.rssMb": snapshot?.api?.rssMb,
    "db.rawWaiting": snapshot?.db?.rawWaiting,
    "db.admissionQueued": snapshot?.db?.admissionQueued,
    "db.totalWaiting": snapshot?.db?.totalWaiting,
    "db.max": snapshot?.db?.max,
    "counters.storedBarsHitCount": snapshot?.counters?.storedBarsHitCount,
    "counters.storedBarsDeltaReadCount":
      snapshot?.counters?.storedBarsDeltaReadCount,
    "counters.storedBarsDeltaReads": snapshot?.counters?.storedBarsDeltaReads,
    "counters.storedBarsDeltaGapFallbacks":
      snapshot?.counters?.storedBarsDeltaGapFallbacks,
    "counters.incrementalShadowMismatches":
      snapshot?.counters?.incrementalShadowMismatches,
    "counters.matrixServeMismatchCount":
      snapshot?.counters?.matrixServeMismatchCount,
    "counters.matrixEventCount": snapshot?.counters?.matrixEventCount,
    "diagnostics.storedBarsCache.barCount":
      snapshot?.diagnostics?.storedBarsCache?.barCount,
    "diagnostics.storedBarsCache.compactBarCount":
      snapshot?.diagnostics?.storedBarsCache?.compactBarCount,
    "diagnostics.storedBarsCache.objectBarCount":
      snapshot?.diagnostics?.storedBarsCache?.objectBarCount,
    "diagnostics.scannerCoverage.selectedSymbols":
      snapshot?.diagnostics?.scannerCoverage?.selectedSymbols,
    "diagnostics.scannerCoverage.cycleScannedSymbols":
      snapshot?.diagnostics?.scannerCoverage?.cycleScannedSymbols,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !Number.isFinite(value))
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`missing required runtime metrics: ${missing.join(", ")}`);
  }
  return snapshot;
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

export function classifyIncrementalAcceptanceCounters(counterDelta = {}) {
  return {
    parityVerdict:
      counterDelta.incrementalShadowMismatches === 0 ? "PASS" : "FAIL",
    storedStateChurnVerdict: "OBSERVE",
  };
}

export function summarizeRuntimeSamples(samples) {
  const valid = samples.filter((sample) => sample?.snapshot);
  const first = valid[0]?.snapshot ?? null;
  const last = valid.at(-1)?.snapshot ?? null;
  return {
    sampleCount: valid.length,
    firstAt: valid[0]?.at ?? null,
    lastAt: valid.at(-1)?.at ?? null,
    peakEventLoopUtilization: maxValue(
      valid,
      (sample) => sample.snapshot.api.eventLoopUtilization,
    ),
    peakEventLoopDelayP95Ms: maxValue(
      valid,
      (sample) => sample.snapshot.api.eventLoopDelayP95Ms,
    ),
    peakHeapUsedMb: maxValue(valid, (sample) => sample.snapshot.api.heapUsedMb),
    peakRssMb: maxValue(valid, (sample) => sample.snapshot.api.rssMb),
    peakDbRawWaiting: maxValue(
      valid,
      (sample) => sample.snapshot.db.rawWaiting,
    ),
    peakDbAdmissionQueued: maxValue(
      valid,
      (sample) => sample.snapshot.db.admissionQueued,
    ),
    peakDbTotalWaiting: maxValue(
      valid,
      (sample) => sample.snapshot.db.totalWaiting,
    ),
    peakRuntimeFetchMs: maxValue(valid, (sample) => sample.fetchDurationMs),
    averageRuntimeFetchMs: averageValue(
      valid,
      (sample) => sample.fetchDurationMs,
    ),
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
  const hasAdmissionLanes = Array.isArray(runtime?.dbPoolAdmission?.lanes);
  const admissionLanes = hasAdmissionLanes
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
  const rawWaiting = finite(
    runtime?.api?.resourcePressure?.inputs?.dbPoolWaiting,
  );
  const admissionQueued = hasAdmissionLanes
    ? admissionLanes.reduce((sum, lane) => sum + (finite(lane.queued) ?? 0), 0)
    : null;
  const marketDataAdmission = streams.marketDataAdmission ?? {};
  const scannerCoverage =
    marketDataAdmission.optionsFlowScanner?.coverage ?? {};
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
      totalWaiting:
        rawWaiting != null && admissionQueued != null
          ? rawWaiting + admissionQueued
          : null,
      admissionLanes,
    },
    counters: {
      storedBarsHitCount: finite(storedBarsCache.hitCount),
      storedBarsMissCount: finite(storedBarsCache.missCount),
      storedBarsFullReadCount: finite(storedBarsCache.fullReadCount),
      storedBarsDeltaReadCount: finite(storedBarsCache.deltaReadCount),
      storedBarsInvalidationFullCount: finite(
        storedBarsCache.invalidationFullCount,
      ),
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
      stockQuoteReconnectCount: finite(
        streams.massiveStockQuotes?.reconnectCount,
      ),
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
  const numbers = values
    .map(selector)
    .map(finite)
    .filter((value) => value != null);
  return numbers.length ? Math.max(...numbers) : null;
}

function averageValue(values, selector) {
  const numbers = values
    .map(selector)
    .map(finite)
    .filter((value) => value != null);
  return numbers.length
    ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    : null;
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
  return Object.fromEntries(
    keys.filter((key) => key in value).map((key) => [key, value[key]]),
  );
}
