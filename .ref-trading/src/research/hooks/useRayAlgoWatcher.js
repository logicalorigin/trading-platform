import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupportedSignalOverlayTimeframes } from "../chart/timeframeModel.js";
import { normalizeRayAlgoSettings } from "../config/rayalgoSettings.js";
import { normalizeResearchStrategy } from "../config/strategyPresets.js";
import {
  MIN_SIGNAL_BARS,
  createIdleWatcherState,
  evaluateRayAlgoWatcherCandidates,
} from "../watchers/rayalgoWatcherCore.js";

const WATCHER_DEBOUNCE_MS = 280;
const MIN_WATCHER_INPUT_BARS = 200;

function buildBarsFingerprint(bars = []) {
  if (!Array.isArray(bars) || !bars.length) {
    return "0";
  }
  const first = bars[0] || {};
  const last = bars[bars.length - 1] || {};
  return [
    bars.length,
    String(first.ts || first.time || first.date || ""),
    String(last.ts || last.time || last.date || ""),
  ].join(":");
}

function pickPreviousLeader(leader) {
  if (!leader) {
    return null;
  }
  return {
    signalTimeframe: leader.signalTimeframe,
    shadingTimeframe: leader.shadingTimeframe,
    rayalgoSettings: leader.rayalgoSettings,
    signature: leader.signature,
  };
}

export function useRayAlgoWatcher({
  marketSymbol = "SPY",
  isActive = true,
  strategy = "rayalgo",
  bars = [],
  tfMin = 5,
  capital,
  executionFidelity = "bar_close",
  dte,
  iv,
  slPct,
  tpPct,
  trailStartPct,
  trailPct,
  zombieBars,
  minConviction,
  allowShorts,
  kellyFrac,
  regimeFilter,
  maxPos,
  sessionBlocks,
  tradeDays,
  regimeAdapt,
  commPerContract,
  slipBps,
  rayalgoSettings = null,
  currentSignalTimeframe = "5m",
  backtestV2RuntimeBridge = null,
} = {}) {
  const [state, setState] = useState(() => createIdleWatcherState());
  const workerRef = useRef(null);
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const activeJobRef = useRef(null);
  const pendingJobRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const lastCompletedCacheKeyRef = useRef(null);
  const leaderRef = useRef(null);
  const previousSymbolRef = useRef(null);
  const previousBarsFingerprintRef = useRef(null);
  const previousSettingsSignatureRef = useRef(null);
  const normalizedStrategy = useMemo(() => normalizeResearchStrategy(strategy), [strategy]);
  const supportedSignalTimeframes = useMemo(
    () => getSupportedSignalOverlayTimeframes(tfMin).slice(0, 4),
    [tfMin],
  );
  const normalizedRayAlgoSettings = useMemo(
    () => normalizeRayAlgoSettings(rayalgoSettings || {}),
    [rayalgoSettings],
  );
  const barsFingerprint = useMemo(() => buildBarsFingerprint(bars), [bars]);
  const baseRunConfig = useMemo(() => ({
    strategy: normalizedStrategy,
    dte,
    iv,
    slPct,
    tpPct,
    trailStartPct,
    trailPct,
    zombieBars,
    minConviction,
    allowShorts,
    kellyFrac,
    regimeFilter,
    maxPositions: maxPos,
    capital,
    sessionBlocks,
    regimeAdapt,
    commPerContract,
    slipBps,
    tradeDays,
    executionFidelity,
    backtestV2RuntimeBridge,
  }), [
    allowShorts,
    backtestV2RuntimeBridge,
    capital,
    commPerContract,
    dte,
    executionFidelity,
    iv,
    kellyFrac,
    maxPos,
    minConviction,
    normalizedStrategy,
    regimeAdapt,
    regimeFilter,
    sessionBlocks,
    slPct,
    slipBps,
    tpPct,
    tradeDays,
    trailPct,
    trailStartPct,
    zombieBars,
  ]);
  const watcherSettingsSignature = useMemo(() => JSON.stringify({
    baseRunConfig,
    normalizedRayAlgoSettings,
    currentSignalTimeframe,
    supportedSignalTimeframes,
  }), [baseRunConfig, currentSignalTimeframe, normalizedRayAlgoSettings, supportedSignalTimeframes]);

  useEffect(() => {
    leaderRef.current = state.leader || null;
  }, [state.leader]);

  const handleJobSuccess = useCallback((job, result) => {
    if (job?.cacheKey) {
      lastCompletedCacheKeyRef.current = job.cacheKey;
    }
    setState({
      ...createIdleWatcherState(result || {}),
      status: "ready",
      error: null,
      freshnessLabel: "Fresh",
    });
  }, []);

  const handleJobError = useCallback((job, error) => {
    if (job?.cacheKey) {
      lastCompletedCacheKeyRef.current = job.cacheKey;
    }
    setState((previous) => ({
      ...previous,
      status: "error",
      error: error?.message || "Failed to evaluate RayAlgo watcher candidates.",
      freshnessLabel: previous.leader ? "Stale" : "Error",
    }));
  }, []);

  const dispatchJob = useCallback((job) => {
    if (!job || inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    activeJobRef.current = job;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setState((previous) => ({
      ...previous,
      status: previous.leader ? "refreshing" : "loading",
      error: null,
      freshnessLabel: previous.leader ? "Updating" : "Scanning",
    }));

    if (workerRef.current) {
      workerRef.current.postMessage({
        requestId,
        ...job.payload,
      });
      return;
    }

    setTimeout(() => {
      try {
        const result = evaluateRayAlgoWatcherCandidates(job.payload);
        if (activeJobRef.current?.cacheKey !== job.cacheKey) {
          return;
        }
        activeJobRef.current = null;
        inFlightRef.current = false;
        handleJobSuccess(job, result);
      } catch (error) {
        if (activeJobRef.current?.cacheKey !== job.cacheKey) {
          return;
        }
        activeJobRef.current = null;
        inFlightRef.current = false;
        handleJobError(job, error);
      }
      if (pendingJobRef.current) {
        const nextJob = pendingJobRef.current;
        pendingJobRef.current = null;
        dispatchJob(nextJob);
      }
    }, 0);
  }, [handleJobError, handleJobSuccess]);

  const drainQueue = useCallback(() => {
    if (inFlightRef.current) {
      return;
    }
    const nextJob = pendingJobRef.current;
    if (!nextJob) {
      return;
    }
    pendingJobRef.current = null;
    dispatchJob(nextJob);
  }, [dispatchJob]);

  const enqueueJob = useCallback((options = {}) => {
    if (
      !isActive
      || normalizedStrategy !== "rayalgo"
      || !Array.isArray(bars)
      || bars.length < Math.max(MIN_WATCHER_INPUT_BARS, MIN_SIGNAL_BARS)
      || !supportedSignalTimeframes.length
    ) {
      return;
    }
    const mode = String(options.mode || "incremental").trim().toLowerCase() === "full"
      ? "full"
      : "incremental";
    const forceToken = options.force ? Date.now() : null;
    const cacheKey = JSON.stringify({
      marketSymbol,
      barsFingerprint,
      watcherSettingsSignature,
      leaderSignature: leaderRef.current?.signature || null,
      mode,
      forceToken,
    });
    if (!options.force) {
      if (cacheKey === lastCompletedCacheKeyRef.current) {
        return;
      }
      if (cacheKey === pendingJobRef.current?.cacheKey) {
        return;
      }
      if (cacheKey === activeJobRef.current?.cacheKey) {
        return;
      }
    }

    pendingJobRef.current = {
      cacheKey,
      payload: {
        cacheKey,
        mode,
        bars,
        capital,
        baseRunConfig,
        tfMin,
        normalizedRayAlgoSettings,
        currentSignalTimeframe,
        previousLeader: pickPreviousLeader(leaderRef.current),
      },
    };

    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (options.immediate) {
      drainQueue();
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      drainQueue();
    }, WATCHER_DEBOUNCE_MS);
  }, [
    bars,
    barsFingerprint,
    baseRunConfig,
    capital,
    currentSignalTimeframe,
    drainQueue,
    isActive,
    marketSymbol,
    normalizedRayAlgoSettings,
    normalizedStrategy,
    supportedSignalTimeframes,
    tfMin,
    watcherSettingsSignature,
  ]);

  useEffect(() => {
    if (typeof Worker === "undefined") {
      workerRef.current = null;
      return undefined;
    }
    const worker = new Worker(new URL("../workers/rayalgoWatcherWorker.js", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const payload = event?.data || {};
      const activeJob = activeJobRef.current;
      if (!activeJob || Number(payload?.requestId) !== requestIdRef.current) {
        return;
      }
      activeJobRef.current = null;
      inFlightRef.current = false;
      if (payload?.ok) {
        handleJobSuccess(activeJob, payload.result || {});
      } else {
        handleJobError(activeJob, new Error(payload?.error || "Failed to evaluate RayAlgo watcher candidates."));
      }
      drainQueue();
    };
    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, [drainQueue, handleJobError, handleJobSuccess]);

  useEffect(() => () => {
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingJobRef.current = null;
    activeJobRef.current = null;
    inFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (
      !isActive
      || normalizedStrategy !== "rayalgo"
      || !Array.isArray(bars)
      || bars.length < Math.max(MIN_WATCHER_INPUT_BARS, MIN_SIGNAL_BARS)
      || !supportedSignalTimeframes.length
    ) {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingJobRef.current = null;
      activeJobRef.current = null;
      inFlightRef.current = false;
      setState((previous) => createIdleWatcherState({
        leader: previous.leader,
        runnerUp: previous.runnerUp,
        candidateCount: previous.candidateCount,
        lastRunAt: previous.lastRunAt,
        lastDurationMs: previous.lastDurationMs,
        freshnessLabel: previous.leader ? "Stale" : "Idle",
      }));
      previousSymbolRef.current = marketSymbol;
      previousBarsFingerprintRef.current = barsFingerprint;
      previousSettingsSignatureRef.current = watcherSettingsSignature;
      return;
    }

    const coldStart = previousSymbolRef.current == null || state.lastRunAt == null;
    const symbolChanged = previousSymbolRef.current != null && previousSymbolRef.current !== marketSymbol;
    const barsChanged = previousBarsFingerprintRef.current != null && previousBarsFingerprintRef.current !== barsFingerprint;
    const settingsChanged = previousSettingsSignatureRef.current != null && previousSettingsSignatureRef.current !== watcherSettingsSignature;

    previousSymbolRef.current = marketSymbol;
    previousBarsFingerprintRef.current = barsFingerprint;
    previousSettingsSignatureRef.current = watcherSettingsSignature;

    if (coldStart || symbolChanged) {
      enqueueJob({ mode: "full", immediate: true, force: true });
      return;
    }
    if (barsChanged || settingsChanged) {
      enqueueJob({ mode: "incremental" });
    }
  }, [
    bars,
    barsFingerprint,
    enqueueJob,
    isActive,
    marketSymbol,
    normalizedStrategy,
    state.lastRunAt,
    supportedSignalTimeframes.length,
    watcherSettingsSignature,
  ]);

  const runNow = useCallback(() => {
    enqueueJob({ mode: "full", immediate: true, force: true });
  }, [enqueueJob]);

  return {
    ...state,
    supportedSignalTimeframes,
    runNow,
  };
}
