import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getFlowUniverse as getFlowUniverseRequest,
  listAggregateFlowEvents as listAggregateFlowEventsRequest,
  listFlowEvents as listFlowEventsRequest,
} from "@workspace/api-client-react";
import { T } from "../../lib/uiTokens";
import { useUserPreferences } from "../preferences/useUserPreferences";
import { useRuntimeWorkloadFlag } from "./workloadStats";
import {
  FLOW_SCANNER_MODE,
  FLOW_SCANNER_MARKET_UNIVERSE_SYMBOLS,
  FLOW_SCANNER_SCOPE,
  buildFlowScannerMarketUniverseSymbols,
  buildFlowScannerSymbols,
  filterFlowScannerEvents,
  flowScannerModeUsesMarketUniverse,
  normalizeFlowScannerConfig,
  runFlowScannerBatch,
} from "./marketFlowScannerConfig";
import { mapFlowEventToUi } from "../flow/flowEventMapper";
import {
  buildDteBucketsFromEvents,
  buildFlowClockFromEvents,
  buildFlowTideFromEvents,
  buildMarketOrderFlowFromEvents,
  buildPutCallSummaryFromEvents,
  buildSectorFlowFromEvents,
  buildTickerFlowFromEvents,
} from "../flow/flowAnalytics";
import { ensureTradeTickerInfo } from "./runtimeTickerStore";
import {
  flowFailureLooksVisible,
  isVisibleFlowDegradationSource,
  shouldPreserveFlowEvents,
} from "./flowSourceState";

const FLOW_SCANNER_UNIVERSE_QUERY_KEY = ["/api/flow/universe"];
const FLOW_SCANNER_AGGREGATE_QUERY_KEY = ["/api/flow/events/aggregate"];

const normalizeFlowUniverseSymbols = (symbols = []) => [
  ...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map((symbol) => String(symbol || "").trim().toUpperCase())
      .filter(Boolean),
  ),
];

const normalizeTimestampMs = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
};

const normalizeScannedAtMap = (value = {}) => {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([symbol, scannedAt]) => [
        String(symbol || "").trim().toUpperCase(),
        normalizeTimestampMs(scannedAt),
      ])
      .filter(([symbol, scannedAt]) => symbol && Number.isFinite(scannedAt)),
  );
};

const fetchFlowScannerUniverse = async () => {
  const payload = await getFlowUniverseRequest();
  return {
    symbols: normalizeFlowUniverseSymbols(payload?.symbols),
    coverage: payload?.coverage || null,
  };
};

const fetchAggregateFlowEvents = async ({
  limit,
  scope,
  unusualThreshold,
  lineBudget,
  minPremium,
  maxDte,
}) => {
  return listAggregateFlowEventsRequest(
    {
      limit,
      scope,
      unusualThreshold,
      lineBudget,
      minPremium,
      maxDte,
    },
    { timeoutMs: 4_000 },
  );
};

let liveMarketFlowInstanceCounter = 0;

export const useLiveMarketFlow = (
  symbols = [],
  {
    activeSymbols = symbols,
    enabled = true,
    limit = 16,
    maxSymbols = 8,
    batchSize,
    unusualThreshold,
    lineBudget,
    minPremium,
    maxDte,
    blocking = true,
    mode = FLOW_SCANNER_MODE.activeWatchlist,
    scope = FLOW_SCANNER_SCOPE.all,
    concurrency,
    scannerConfig,
    intervalMs = 10_000,
    workloadLabel = null,
  } = {},
) => {
  const { preferences: userPreferences } = useUserPreferences();
  const instanceIdRef = useRef(null);
  if (instanceIdRef.current == null) {
    liveMarketFlowInstanceCounter += 1;
    instanceIdRef.current = liveMarketFlowInstanceCounter;
  }
  const effectiveScannerConfig = useMemo(
    () =>
      normalizeFlowScannerConfig({
        ...scannerConfig,
        mode: scannerConfig?.mode ?? mode,
        scope: scannerConfig?.scope ?? scope,
        maxSymbols: scannerConfig?.maxSymbols ?? maxSymbols,
        batchSize: scannerConfig?.batchSize ?? batchSize,
        intervalMs: scannerConfig?.intervalMs ?? intervalMs,
        concurrency: scannerConfig?.concurrency ?? concurrency,
        limit: scannerConfig?.limit ?? limit,
        unusualThreshold: scannerConfig?.unusualThreshold ?? unusualThreshold,
        minPremium: scannerConfig?.minPremium ?? minPremium,
        maxDte: scannerConfig?.maxDte ?? maxDte,
      }),
    [
      batchSize,
      concurrency,
      intervalMs,
      limit,
      lineBudget,
      maxDte,
      maxSymbols,
      minPremium,
      mode,
      scannerConfig,
      scope,
      unusualThreshold,
    ],
  );
  const usesBackendBroadScanner = flowScannerModeUsesMarketUniverse(
    effectiveScannerConfig.mode,
  );
  const shouldUseClientSymbolScanner = !usesBackendBroadScanner;
  const shouldPrioritizeRuntimeSignals =
    blocking === false && usesBackendBroadScanner;
  const shouldLoadMarketUniverse = enabled && usesBackendBroadScanner;
  const marketUniverseQuery = useQuery({
    queryKey: FLOW_SCANNER_UNIVERSE_QUERY_KEY,
    queryFn: fetchFlowScannerUniverse,
    enabled: shouldLoadMarketUniverse,
    staleTime: 60_000,
    refetchInterval: shouldLoadMarketUniverse ? 60_000 : false,
    refetchOnWindowFocus: false,
  });
  const backendMarketSymbols = marketUniverseQuery.data?.symbols || [];
  const marketUniverseCoverage = marketUniverseQuery.data?.coverage || null;
  const backendCurrentBatchSymbols = useMemo(
    () => normalizeFlowUniverseSymbols(marketUniverseCoverage?.currentBatch),
    [marketUniverseCoverage],
  );
  const marketSymbolsForScanner = useMemo(() => {
    if (!flowScannerModeUsesMarketUniverse(effectiveScannerConfig.mode)) {
      return undefined;
    }
    return buildFlowScannerMarketUniverseSymbols({
      backendSymbols: backendMarketSymbols,
      currentBatchSymbols: backendCurrentBatchSymbols,
      fallbackSymbols: FLOW_SCANNER_MARKET_UNIVERSE_SYMBOLS,
      prioritizeRuntimeSignals: shouldPrioritizeRuntimeSignals,
    });
  }, [
    backendCurrentBatchSymbols,
    backendMarketSymbols,
    effectiveScannerConfig.mode,
    shouldPrioritizeRuntimeSignals,
  ]);
  const liveSymbols = useMemo(
    () =>
      buildFlowScannerSymbols({
        activeWatchlistSymbols: activeSymbols,
        watchlistSymbols: symbols,
        marketSymbols: marketSymbolsForScanner,
        config: effectiveScannerConfig,
      }),
    [activeSymbols, symbols, marketSymbolsForScanner, effectiveScannerConfig],
  );
  const liveSymbolsKey = liveSymbols.join(",");
  const effectiveBatchSize = Math.max(
    1,
    Math.min(effectiveScannerConfig.batchSize, liveSymbols.length || 1),
  );
  const effectiveLimit = effectiveScannerConfig.limit;
  const effectiveLineBudget =
    Number.isFinite(lineBudget) && lineBudget > 0
      ? Math.max(1, Math.floor(lineBudget))
      : undefined;
  const effectiveIntervalMs = effectiveScannerConfig.intervalMs;
  const effectiveConcurrency = effectiveScannerConfig.concurrency;
  const normalizedThreshold = effectiveScannerConfig.unusualThreshold;
  const effectiveMinPremium =
    Number.isFinite(effectiveScannerConfig.minPremium) &&
    effectiveScannerConfig.minPremium > 0
      ? effectiveScannerConfig.minPremium
      : undefined;
  const effectiveMaxDte =
    Number.isFinite(effectiveScannerConfig.maxDte) &&
    effectiveScannerConfig.maxDte !== null
      ? effectiveScannerConfig.maxDte
      : undefined;
  useRuntimeWorkloadFlag(
    `market-flow:${instanceIdRef.current}`,
    Boolean(enabled && liveSymbols.length),
    {
      kind: "poll",
      label:
        workloadLabel ||
        (effectiveBatchSize >= 30
          ? "Flow unusual scanner"
          : "Flow watchlist base"),
      detail: `${effectiveScannerConfig.mode}:${liveSymbols.length}s/${effectiveBatchSize}b/${effectiveConcurrency}c`,
      priority: effectiveBatchSize >= 30 ? 4 : 3,
    },
  );

  // Rotate through the watchlist in batches so large lists eventually get
  // covered without slamming IBKR's snapshot rate limit on every poll.
  const offsetRef = useRef(0);
  const [scanState, setScanState] = useState({
    bySymbol: {},
    isFetching: false,
    isPending: true,
    cycle: 0,
    lastBatch: [],
    lastError: null,
  });
  const aggregateFlowQuery = useQuery({
    queryKey: [
      ...FLOW_SCANNER_AGGREGATE_QUERY_KEY,
      effectiveLimit,
      effectiveScannerConfig.scope,
      normalizedThreshold,
      effectiveLineBudget ?? null,
      effectiveMinPremium ?? null,
      effectiveMaxDte ?? null,
      shouldPrioritizeRuntimeSignals,
    ],
    queryFn: () =>
      fetchAggregateFlowEvents({
        limit: Math.max(effectiveLimit * 4, effectiveLimit),
        scope: effectiveScannerConfig.scope,
        unusualThreshold: normalizedThreshold,
        lineBudget: effectiveLineBudget,
        minPremium: effectiveMinPremium,
        maxDte: effectiveMaxDte,
      }),
    enabled: shouldLoadMarketUniverse,
    staleTime: 2_500,
    refetchInterval: shouldLoadMarketUniverse
      ? Math.max(2_500, Math.min(effectiveIntervalMs, 10_000))
      : false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [aggregateFlowSnapshot, setAggregateFlowSnapshot] = useState(null);

  useEffect(() => {
    if (!shouldLoadMarketUniverse) {
      setAggregateFlowSnapshot(null);
      return;
    }
    if (!aggregateFlowQuery.data) {
      return;
    }

    const next = {
      events: aggregateFlowQuery.data.events || [],
      source: aggregateFlowQuery.data.source || null,
      scannedAt: Date.now(),
      error: null,
    };
    setAggregateFlowSnapshot((prev) =>
      shouldPreserveFlowEvents(prev, next)
        ? {
            ...prev,
            source: next.source,
            scannedAt: next.scannedAt,
            error: null,
          }
        : next,
    );
  }, [aggregateFlowQuery.data, shouldLoadMarketUniverse]);

  // Reset rotation + cache when the symbol set changes; drop entries for
  // symbols that are no longer in the watchlist.
  useEffect(() => {
    offsetRef.current = 0;
    setScanState((prev) => {
      const allowed = new Set(liveSymbols);
      const bySymbol = {};
      if (shouldUseClientSymbolScanner) {
        for (const [symbol, value] of Object.entries(prev.bySymbol)) {
          if (allowed.has(symbol)) bySymbol[symbol] = value;
        }
      }
      return {
        bySymbol,
        isFetching: false,
        isPending: shouldUseClientSymbolScanner && liveSymbols.length > 0,
        cycle: 0,
        lastBatch: [],
        lastError: null,
      };
    });
  }, [liveSymbolsKey, shouldUseClientSymbolScanner]);

  useEffect(() => {
    if (!enabled || !liveSymbols.length || !shouldUseClientSymbolScanner) {
      return undefined;
    }
    let cancelled = false;
    let timer = null;

    const schedule = (delay) => {
      if (cancelled) return;
      const visibilityMultiplier =
        typeof document !== "undefined" && document.hidden ? 6 : 1;
      timer = setTimeout(runOnce, Math.max(250, delay * visibilityMultiplier));
    };

    const runOnce = async () => {
      timer = null;
      const total = liveSymbols.length;
      const size = Math.min(effectiveBatchSize, total);
      const start = offsetRef.current % total;
      const batch = [];
      for (let i = 0; i < size; i += 1) {
        batch.push(liveSymbols[(start + i) % total]);
      }
      // Advance the offset before awaiting so symbol-set changes don't replay
      // the same batch.
      offsetRef.current = (start + size) % Math.max(1, total);
      setScanState((prev) => ({ ...prev, isFetching: true, lastBatch: batch }));

      const commitSymbolResult = (symbol, result, scannedAt) => {
        setScanState((prev) => {
          const allowed = new Set(liveSymbols);
          if (!allowed.has(symbol)) return prev;

          const bySymbol = {};
          for (const [entrySymbol, value] of Object.entries(prev.bySymbol)) {
            if (allowed.has(entrySymbol)) bySymbol[entrySymbol] = value;
          }

          if (result.status === "fulfilled") {
            const next = {
              events: result.value.events || [],
              source: result.value.source || null,
              scannedAt,
              error: null,
            };
            bySymbol[symbol] = shouldPreserveFlowEvents(bySymbol[symbol], next)
              ? {
                  ...bySymbol[symbol],
                  source: next.source,
                  scannedAt,
                  error: null,
                }
              : next;
            return {
              ...prev,
              bySymbol,
              isPending: false,
              lastError: null,
            };
          }

          const message =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason ?? "Flow request failed");
          const existing = bySymbol[symbol] || { events: [], source: null };
          bySymbol[symbol] = {
            ...existing,
            scannedAt,
            error: message,
          };
          return {
            ...prev,
            bySymbol,
            isPending: false,
            lastError: message,
          };
        });
      };

      const startedAt = Date.now();
      const results = await runFlowScannerBatch(
        batch,
        effectiveConcurrency,
        async (symbol) => {
          try {
            const value = await listFlowEventsRequest({
              underlying: symbol,
              limit: effectiveLimit,
              scope: FLOW_SCANNER_SCOPE.all,
              ...(effectiveLineBudget !== undefined
                ? { lineBudget: effectiveLineBudget }
                : {}),
              ...(effectiveMinPremium !== undefined
                ? { minPremium: effectiveMinPremium }
                : {}),
              ...(effectiveMaxDte !== undefined
                ? { maxDte: effectiveMaxDte }
                : {}),
              blocking,
              queueRefresh: blocking,
            });
            if (!cancelled) {
              commitSymbolResult(symbol, { status: "fulfilled", value }, Date.now());
            }
            return value;
          } catch (reason) {
            if (!cancelled) {
              commitSymbolResult(symbol, { status: "rejected", reason }, Date.now());
            }
            throw reason;
          }
        },
      );
      if (cancelled) return;

      const batchHadError = results.some((result) => result.status === "rejected");
      setScanState((prev) => ({
        ...prev,
        isFetching: false,
        isPending: false,
        cycle: prev.cycle + 1,
        lastBatch: batch,
        lastError: batchHadError ? prev.lastError : null,
      }));

      // Schedule the next batch after this one completes; do not slow the
      // scanner because one symbol or quote batch failed.
      const elapsed = Date.now() - startedAt;
      const baseDelay = Math.max(0, effectiveIntervalMs - elapsed);
      schedule(baseDelay);
    };

    runOnce();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    effectiveBatchSize,
    effectiveConcurrency,
    effectiveIntervalMs,
    effectiveLimit,
    effectiveLineBudget,
    effectiveMaxDte,
    effectiveMinPremium,
    effectiveScannerConfig.scope,
    blocking,
    enabled,
    liveSymbolsKey,
    normalizedThreshold,
    shouldUseClientSymbolScanner,
  ]);

  const responses = useMemo(() => {
    const symbolResponses = Object.entries(scanState.bySymbol).map(
      ([symbol, value]) => ({
        symbol,
        events: value.events || [],
        source: value.source || null,
        scannedAt: value.scannedAt || null,
        error: value.error || null,
      }),
    );

    if (!aggregateFlowSnapshot) {
      return symbolResponses;
    }

    return [
      {
        symbol: "__aggregate",
        events: aggregateFlowSnapshot.events || [],
        source: aggregateFlowSnapshot.source || null,
        scannedAt: aggregateFlowSnapshot.scannedAt || null,
        error: aggregateFlowSnapshot.error || null,
      },
      ...symbolResponses,
    ];
  }, [aggregateFlowSnapshot, scanState.bySymbol]);
  const failures = useMemo(
    () =>
      responses
        .filter((response) => response.error)
        .map((response) => ({
          symbol: response.symbol,
          error: response.error,
          scannedAt: response.scannedAt,
        }))
        .filter((failure) => flowFailureLooksVisible(failure)),
    [responses],
  );
  const aggregatedEvents = useMemo(() => {
    const seen = new Set();
    return responses.flatMap((response) => response.events || []).filter((event) => {
      const key =
        event?.id ||
        [
          event?.underlying,
          event?.optionSymbol || event?.symbol,
          event?.expirationDate,
          event?.strike,
          event?.right,
          event?.side,
          event?.occurredAt || event?.updatedAt || event?.timestamp,
          event?.premium,
        ].join("|");
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [responses]);

  const flowEvents = useMemo(() => {
    if (!aggregatedEvents.length) return [];
    return filterFlowScannerEvents(
      aggregatedEvents
        .map((event) => mapFlowEventToUi(event, userPreferences))
        .sort((left, right) => {
          // Float volume-vs-OI "unusual" events to the top so the notifications
          // feed and unusual-options panel surface them ahead of routine high-
          // premium events, then fall back to premium for ranking within bands.
          if (left.isUnusual !== right.isUnusual) {
            return left.isUnusual ? -1 : 1;
          }
          if (
            left.isUnusual &&
            right.isUnusual &&
            left.unusualScore !== right.unusualScore
          ) {
            return right.unusualScore - left.unusualScore;
          }
          return right.premium - left.premium;
        }),
      effectiveScannerConfig,
    );
  }, [aggregatedEvents, effectiveScannerConfig, userPreferences]);
  const hasLiveFlow = flowEvents.length > 0;
  const flowStatus = hasLiveFlow
    ? "live"
    : aggregateFlowQuery.isLoading ||
        scanState.isPending ||
        (scanState.isFetching && scanState.cycle === 0)
      ? "loading"
      : failures.length > 0
        ? "offline"
        : "empty";
  const providerSummary = useMemo(() => {
    const events = aggregatedEvents;
    const providerSet = new Set(
      [
        ...events.map((event) => event.provider),
        ...responses.map((response) => response.source?.provider),
      ].filter((provider) => provider && provider !== "none"),
    );
    const fallbackUsed = responses.some((response) =>
      Boolean(response.source?.fallbackUsed),
    );
    const erroredSource =
      responses.find(
        (response) =>
          response.source?.status === "error" &&
          isVisibleFlowDegradationSource(response.source),
      )?.source ||
      null;
    const sourcesBySymbol = Object.fromEntries(
      responses.map((response) => [response.symbol, response.source]),
    );
    const appliedThresholds = responses
      .map((response) => response.source?.unusualThreshold)
      .filter((value) => Number.isFinite(value) && value > 0);
    const scannerCoverage =
      responses.find((response) => response.source?.scannerCoverage)?.source
        ?.scannerCoverage || null;
    const coverageSource = scannerCoverage || marketUniverseCoverage;
    const appliedThresholdCounts = new Map();
    appliedThresholds.forEach((value) => {
      appliedThresholdCounts.set(
        value,
        (appliedThresholdCounts.get(value) || 0) + 1,
      );
    });
    let appliedUnusualThreshold = null;
    let appliedUnusualThresholdConsistent = true;
    if (appliedThresholdCounts.size > 0) {
      let bestValue = null;
      let bestCount = -1;
      for (const [value, count] of appliedThresholdCounts) {
        if (count > bestCount) {
          bestValue = value;
          bestCount = count;
        }
      }
      appliedUnusualThreshold = bestValue;
      appliedUnusualThresholdConsistent = appliedThresholdCounts.size === 1;
    }

    let label = "No IBKR flow";
    let color = T.textMuted;
    if (scanState.isPending || (scanState.isFetching && scanState.cycle === 0)) {
      label = "Loading flow";
      color = T.accent;
    } else if (providerSet.has("ibkr") && providerSet.has("polygon")) {
      label = "Mixed sources";
      color = T.amber;
    } else if (providerSet.has("ibkr")) {
      label = "IBKR snapshot live";
      color = T.accent;
    } else if (providerSet.has("polygon")) {
      label = "Polygon trade fallback";
      color = T.cyan;
    } else if (failures.length || erroredSource) {
      label = "Flow source error";
      color = T.red;
    } else if (fallbackUsed) {
      label = "Fallback empty";
      color = T.textMuted;
    }

    const lastScannedAt = normalizeScannedAtMap(coverageSource?.lastScannedAt);
    for (const [symbol, value] of Object.entries(scanState.bySymbol)) {
      if (value.scannedAt) lastScannedAt[symbol] = value.scannedAt;
    }
    const scannedSymbols = Object.keys(lastScannedAt);
    const scannedAtValues = Object.values(lastScannedAt);
    const computedOldestScanAt = scannedAtValues.length
      ? Math.min(...scannedAtValues)
      : null;
    const computedNewestScanAt = scannedAtValues.length
      ? Math.max(...scannedAtValues)
      : null;
    const sourceOldestScanAt = normalizeTimestampMs(coverageSource?.oldestScanAt);
    const sourceNewestScanAt = normalizeTimestampMs(coverageSource?.newestScanAt);
    const coverageBatchSize = coverageSource?.batchSize ?? effectiveBatchSize;
    const coverageConcurrency =
      coverageSource?.concurrency ?? effectiveConcurrency;
    const selectedCoverageSymbols =
      coverageSource?.selectedSymbols || liveSymbols.length;
    const activeCoverageTarget =
      coverageSource?.activeTargetSize ||
      selectedCoverageSymbols ||
      coverageSource?.targetSize ||
      liveSymbols.length;
    const intendedCoverageTarget =
      coverageSource?.targetSize || activeCoverageTarget;
    const cycleScannedSymbols =
      coverageSource?.cycleScannedSymbols ??
      coverageSource?.scannedSymbols ??
      0;
    const coverage = {
      totalSymbols: activeCoverageTarget,
      scannedSymbols: Math.max(
        scannedSymbols.length,
        cycleScannedSymbols,
      ),
      cycleScannedSymbols: Math.max(scannedSymbols.length, cycleScannedSymbols),
      batchSize: coverageBatchSize,
      currentBatch: coverageSource?.currentBatch?.length
        ? coverageSource.currentBatch
        : scanState.lastBatch,
      cycle: scanState.cycle,
      isFetching: scanState.isFetching,
      lastScannedAt,
      isRotating: activeCoverageTarget > coverageBatchSize,
      mode: coverageSource?.mode || effectiveScannerConfig.mode,
      selectedSymbols: selectedCoverageSymbols,
      activeTargetSize: activeCoverageTarget,
      targetSize: intendedCoverageTarget,
      selectedShortfall:
        coverageSource?.selectedShortfall ??
        Math.max(0, intendedCoverageTarget - selectedCoverageSymbols),
      cooldownCount: coverageSource?.cooldownCount || 0,
      stale: Boolean(coverageSource?.stale),
      fallbackUsed: Boolean(coverageSource?.fallbackUsed),
      degradedReason: coverageSource?.degradedReason || null,
      rankedAt: coverageSource?.rankedAt || null,
      lastRefreshAt: coverageSource?.lastRefreshAt || null,
      lastGoodAt: coverageSource?.lastGoodAt || null,
      lastScanAt: coverageSource?.lastScanAt || null,
      oldestScanAt: sourceOldestScanAt ?? computedOldestScanAt,
      newestScanAt: sourceNewestScanAt ?? computedNewestScanAt,
      scope: effectiveScannerConfig.scope,
      minPremium: effectiveScannerConfig.minPremium,
      maxDte: effectiveScannerConfig.maxDte,
      concurrency: coverageConcurrency,
      lineBudget: coverageSource?.lineBudget ?? effectiveLineBudget ?? null,
      intervalMs: coverageSource?.intervalMs ?? effectiveIntervalMs,
      estimatedCycleMs: coverageSource?.estimatedCycleMs ?? null,
    };

    return {
      label,
      color,
      fallbackUsed,
      sourcesBySymbol,
      failures,
      erroredSource,
      providers: Array.from(providerSet),
      appliedUnusualThreshold,
      appliedUnusualThresholdConsistent,
      coverage,
    };
  }, [
    aggregatedEvents,
    responses,
    failures,
    scanState,
    liveSymbols.length,
    marketUniverseCoverage,
    effectiveBatchSize,
    effectiveConcurrency,
    effectiveIntervalMs,
    effectiveLineBudget,
    effectiveScannerConfig,
  ]);

  return {
    hasLiveFlow,
    flowStatus,
    providerSummary,
    flowEvents,
    flowTide: buildFlowTideFromEvents(flowEvents),
    tickerFlow: buildTickerFlowFromEvents(flowEvents, ensureTradeTickerInfo),
    flowClock: buildFlowClockFromEvents(flowEvents),
    sectorFlow: buildSectorFlowFromEvents(flowEvents),
    dteBuckets: buildDteBucketsFromEvents(flowEvents),
    marketOrderFlow: buildMarketOrderFlowFromEvents(flowEvents),
    putCall: buildPutCallSummaryFromEvents(flowEvents),
  };
};
