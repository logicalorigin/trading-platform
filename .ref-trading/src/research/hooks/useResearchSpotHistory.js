import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBacktestSpotHistory } from "../../lib/brokerClient.js";
import { clearRuntimeActivity, upsertRuntimeActivity } from "../../lib/runtimeDiagnostics.js";

const DEFAULT_HISTORY_LOAD_MODE = "default";
const AUTO_EXPANDED_HISTORY_LOAD_MODE = "auto-expanded";
const USER_EXPANDED_HISTORY_LOAD_MODE = "user-expanded";
const DEFAULT_INITIAL_INTRADAY_DAYS = 45;
const SPOT_HISTORY_ACTIVITY_ID = "research.backtest.spot-history";

function hasUsableLiveBars(snapshot) {
  return Array.isArray(snapshot?.liveBars) && snapshot.liveBars.length > 0;
}

function normalizeHistoryLoadMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === AUTO_EXPANDED_HISTORY_LOAD_MODE || normalized === USER_EXPANDED_HISTORY_LOAD_MODE) {
    return normalized;
  }
  return DEFAULT_HISTORY_LOAD_MODE;
}

function isExpandedHistorySnapshot(snapshot) {
  return normalizeHistoryLoadMode(snapshot?.spotDataMeta?.hydration?.loadMode) !== DEFAULT_HISTORY_LOAD_MODE;
}

function shouldReuseSessionSnapshot(snapshot) {
  return Boolean(snapshot) && !isExpandedHistorySnapshot(snapshot);
}

function createEmptyHistorySnapshot() {
  return {
    liveBars: null,
    dailyBars: null,
    dataSource: "loading",
    dataError: null,
    liveQuote: null,
    spotDataMeta: null,
  };
}

function getHydrationMeta(snapshot) {
  return snapshot?.spotDataMeta?.hydration || null;
}

function mergeRefreshedIntradayBars(currentBars = [], refreshedBars = []) {
  if (!Array.isArray(currentBars) || !currentBars.length) {
    return Array.isArray(refreshedBars) ? refreshedBars : [];
  }
  if (!Array.isArray(refreshedBars) || !refreshedBars.length) {
    return currentBars;
  }

  const firstRefreshedTime = Number(refreshedBars[0]?.time);
  const lastRefreshedTime = Number(refreshedBars[refreshedBars.length - 1]?.time);
  if (!Number.isFinite(firstRefreshedTime) || !Number.isFinite(lastRefreshedTime)) {
    return refreshedBars;
  }

  const mergedBars = [];
  const seenTimes = new Set();
  const appendBar = (bar) => {
    const time = Number(bar?.time);
    if (!Number.isFinite(time) || seenTimes.has(time)) {
      return;
    }
    seenTimes.add(time);
    mergedBars.push(bar);
  };

  currentBars.forEach((bar) => {
    if (Number(bar?.time) < firstRefreshedTime) {
      appendBar(bar);
    }
  });
  refreshedBars.forEach(appendBar);
  currentBars.forEach((bar) => {
    if (Number(bar?.time) > lastRefreshedTime) {
      appendBar(bar);
    }
  });

  return mergedBars.length ? mergedBars : refreshedBars;
}

export function useResearchSpotHistory({
  marketSymbol,
  isActive = true,
  initialIntradayDays = null,
  preferredIntradayTf = "5m",
  apiKey = "",
} = {}) {
  const [liveBars, setLiveBars] = useState(null);
  const [dailyBars, setDailyBars] = useState(null);
  const [dataSource, setDataSource] = useState("loading");
  const [spotDataMeta, setSpotDataMeta] = useState(null);
  const [liveQuote, setLiveQuote] = useState(null);
  const [dataError, setDataError] = useState(null);
  const loadRequestIdRef = useRef(0);
  const olderHistoryCursorInFlightRef = useRef(null);
  const latestSnapshotRef = useRef(createEmptyHistorySnapshot());

  const commitHistorySnapshot = useCallback((snapshot) => {
    if (!snapshot) {
      return;
    }
    latestSnapshotRef.current = {
      liveBars: snapshot.liveBars || null,
      dailyBars: snapshot.dailyBars || null,
      dataSource: snapshot.dataSource || "market",
      dataError: snapshot.dataError || null,
      liveQuote: snapshot.liveQuote || null,
      spotDataMeta: snapshot.spotDataMeta || null,
    };
    setLiveBars(snapshot.liveBars || null);
    setDailyBars(snapshot.dailyBars || null);
    setSpotDataMeta(snapshot.spotDataMeta || null);
    setDataSource(snapshot.dataSource || "market");
    setDataError(snapshot.dataError || null);
    setLiveQuote(snapshot.liveQuote || null);
  }, []);

  const mergeOlderIntradayBars = useCallback((currentBars = [], olderBars = []) => {
    if (!Array.isArray(currentBars) || !currentBars.length) {
      return Array.isArray(olderBars) ? olderBars : [];
    }
    if (!Array.isArray(olderBars) || !olderBars.length) {
      return currentBars;
    }
    const firstCurrentTime = Number(currentBars[0]?.time);
    if (!Number.isFinite(firstCurrentTime)) {
      return [...olderBars, ...currentBars];
    }
    const nextOlderBars = olderBars.filter((bar) => Number(bar?.time) < firstCurrentTime);
    if (!nextOlderBars.length) {
      return currentBars;
    }
    return [...nextOlderBars, ...currentBars];
  }, []);

  const buildHydrationMeta = useCallback((baseMeta, overrides = {}) => ({
    ...(baseMeta || {}),
    hydration: {
      isHydrating: Boolean(overrides?.isHydrating),
      loadedChunkCount: Number(overrides?.loadedChunkCount) || 0,
      hasMoreIntraday: Boolean(overrides?.hasMoreIntraday),
      nextBefore: overrides?.nextBefore || null,
      loadMode: normalizeHistoryLoadMode(overrides?.loadMode),
    },
  }), []);
  const requestedInitialIntradayDays = useMemo(() => {
    const numeric = Math.round(Number(initialIntradayDays));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    return Math.max(DEFAULT_INITIAL_INTRADAY_DAYS, numeric);
  }, [initialIntradayDays]);
  const normalizedPreferredIntradayTf = useMemo(() => {
    const normalized = String(preferredIntradayTf || "").trim().toLowerCase();
    return normalized || "5m";
  }, [preferredIntradayTf]);

  useEffect(() => {
    latestSnapshotRef.current = {
      liveBars,
      dailyBars,
      dataSource,
      dataError,
      liveQuote,
      spotDataMeta,
    };
  }, [dailyBars, dataError, dataSource, liveBars, liveQuote, spotDataMeta]);

  const reloadSpotBars = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    olderHistoryCursorInFlightRef.current = null;
    const startedAt = Date.now();
    upsertRuntimeActivity(SPOT_HISTORY_ACTIVITY_ID, {
      kind: "research-load",
      label: "Research spot history",
      surface: "research-backtest",
      meta: {
        phase: "initial-load",
        symbol: marketSymbol,
        requestId,
        preferredIntradayTf: normalizedPreferredIntradayTf,
        initialIntradayDays: requestedInitialIntradayDays,
      },
    });
    const currentSnapshot = latestSnapshotRef.current;
    const reusableSessionSnapshot = shouldReuseSessionSnapshot(currentSnapshot) ? currentSnapshot : null;
    if (reusableSessionSnapshot?.liveBars?.length) {
      commitHistorySnapshot({
        ...reusableSessionSnapshot,
        dataSource: reusableSessionSnapshot.dataSource || "massive",
        dataError: null,
        spotDataMeta: buildHydrationMeta(reusableSessionSnapshot.spotDataMeta || null, {
          isHydrating: false,
          loadedChunkCount: Number(reusableSessionSnapshot?.spotDataMeta?.hydration?.loadedChunkCount) || 0,
          hasMoreIntraday: Boolean(reusableSessionSnapshot?.spotDataMeta?.hydration?.hasMoreIntraday),
          nextBefore: reusableSessionSnapshot?.spotDataMeta?.hydration?.nextBefore || null,
          loadMode: reusableSessionSnapshot?.spotDataMeta?.hydration?.loadMode || DEFAULT_HISTORY_LOAD_MODE,
        }),
      });
    } else {
      setDataSource("loading");
      setDataError(null);
      setSpotDataMeta(null);
    }

    try {
      const payload = await getBacktestSpotHistory({
        symbol: marketSymbol,
        mode: "initial",
        initialDays: requestedInitialIntradayDays,
        preferredTf: normalizedPreferredIntradayTf,
        apiKey,
      });
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      const intradayBars = Array.isArray(payload?.intradayBars) ? payload.intradayBars : [];
      const nextDailyBars = Array.isArray(payload?.dailyBars) ? payload.dailyBars : [];

      if (payload?.status !== "ready" || intradayBars.length < 50) {
        throw new Error(payload?.error || `Spot history unavailable for ${marketSymbol}`);
      }

      const currentHydration = getHydrationMeta(currentSnapshot);
      const shouldPreserveExpandedHistory = isExpandedHistorySnapshot(currentSnapshot)
        && Array.isArray(currentSnapshot?.liveBars)
        && currentSnapshot.liveBars.length > intradayBars.length
        && Number(currentSnapshot?.liveBars?.[0]?.time) < Number(intradayBars[0]?.time);
      const nextLiveBars = shouldPreserveExpandedHistory
        ? mergeRefreshedIntradayBars(currentSnapshot?.liveBars || [], intradayBars)
        : intradayBars;
      const last = nextLiveBars[nextLiveBars.length - 1];
      const prevClose = nextLiveBars.length > 78 ? nextLiveBars[nextLiveBars.length - 79]?.c : nextLiveBars[0]?.c;
      const nextLiveQuote = {
        c: last.c,
        dp: prevClose > 0 ? ((last.c - prevClose) / prevClose * 100) : 0,
        t: Date.now(),
      };
      const initialHasMore = Boolean(payload?.meta?.hasMoreIntraday);
      const initialNextBefore = payload?.meta?.nextBefore || null;
      commitHistorySnapshot({
        liveBars: nextLiveBars,
        dailyBars: nextDailyBars.length ? nextDailyBars : null,
        dataSource: payload?.dataSource || "market",
        dataError: null,
        liveQuote: nextLiveQuote,
        spotDataMeta: buildHydrationMeta({
          ...(payload?.meta || null),
          coverage: {
            ...(payload?.meta?.coverage || {}),
            intradayStart: nextLiveBars[0]?.date || payload?.meta?.coverage?.intradayStart || null,
            intradayEnd: nextLiveBars[nextLiveBars.length - 1]?.date || payload?.meta?.coverage?.intradayEnd || null,
          },
        }, {
          isHydrating: false,
          loadedChunkCount: shouldPreserveExpandedHistory
            ? (Number(currentHydration?.loadedChunkCount) || 0)
            : 0,
          hasMoreIntraday: shouldPreserveExpandedHistory
            ? (currentHydration?.hasMoreIntraday == null ? initialHasMore : Boolean(currentHydration.hasMoreIntraday))
            : initialHasMore,
          nextBefore: shouldPreserveExpandedHistory
            ? (currentHydration?.nextBefore || initialNextBefore)
            : initialNextBefore,
          loadMode: shouldPreserveExpandedHistory
            ? USER_EXPANDED_HISTORY_LOAD_MODE
            : DEFAULT_HISTORY_LOAD_MODE,
        }),
      });
      upsertRuntimeActivity(SPOT_HISTORY_ACTIVITY_ID, {
        kind: "research-load",
        label: "Research spot history",
        surface: "research-backtest",
        meta: {
          phase: "ready",
          symbol: marketSymbol,
          requestId,
          durationMs: Date.now() - startedAt,
          intradayBars: nextLiveBars.length,
          dailyBars: nextDailyBars.length,
          source: payload?.dataSource || payload?.source || null,
        },
      });
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      upsertRuntimeActivity(SPOT_HISTORY_ACTIVITY_ID, {
        kind: "research-load",
        label: "Research spot history",
        surface: "research-backtest",
        meta: {
          phase: "error",
          symbol: marketSymbol,
          requestId,
          durationMs: Date.now() - startedAt,
          error: error?.message || "Failed to load spot history.",
        },
      });
      const previousSnapshot = latestSnapshotRef.current;
      if (hasUsableLiveBars(previousSnapshot)) {
        commitHistorySnapshot({
          ...previousSnapshot,
          dataError: error?.message || "Failed to load spot history.",
          spotDataMeta: buildHydrationMeta(previousSnapshot?.spotDataMeta || null, {
            isHydrating: false,
            loadedChunkCount: Number(previousSnapshot?.spotDataMeta?.hydration?.loadedChunkCount) || 0,
            hasMoreIntraday: Boolean(previousSnapshot?.spotDataMeta?.hydration?.hasMoreIntraday),
            nextBefore: previousSnapshot?.spotDataMeta?.hydration?.nextBefore || null,
            loadMode: previousSnapshot?.spotDataMeta?.hydration?.loadMode || DEFAULT_HISTORY_LOAD_MODE,
          }),
        });
        return;
      }
      setDataSource("error");
      setDataError(error?.message || "Failed to load spot history.");
      setLiveBars(null);
      setDailyBars(null);
      setSpotDataMeta(null);
    }
  }, [
    buildHydrationMeta,
    commitHistorySnapshot,
    marketSymbol,
    normalizedPreferredIntradayTf,
    apiKey,
    requestedInitialIntradayDays,
  ]);

  useEffect(() => () => clearRuntimeActivity(SPOT_HISTORY_ACTIVITY_ID), []);

  const loadOlderHistory = useCallback(async (options = {}) => {
    const requestId = loadRequestIdRef.current;
    const currentSnapshot = latestSnapshotRef.current;
    const hydration = getHydrationMeta(currentSnapshot);
    const nextBefore = hydration?.nextBefore || null;
    const requestedLoadMode = normalizeHistoryLoadMode(options?.loadMode);
    if (!nextBefore || hydration?.isHydrating) {
      return null;
    }
    if (olderHistoryCursorInFlightRef.current === nextBefore) {
      return null;
    }

    olderHistoryCursorInFlightRef.current = nextBefore;
    const loadedChunkCount = Number(hydration?.loadedChunkCount) || 0;
    commitHistorySnapshot({
      ...currentSnapshot,
      dataError: null,
      spotDataMeta: buildHydrationMeta(currentSnapshot?.spotDataMeta || null, {
        isHydrating: true,
        loadedChunkCount,
        hasMoreIntraday: Boolean(hydration?.hasMoreIntraday),
        nextBefore,
        loadMode: requestedLoadMode === DEFAULT_HISTORY_LOAD_MODE
          ? (hydration?.loadMode || DEFAULT_HISTORY_LOAD_MODE)
          : requestedLoadMode,
      }),
    });

    try {
      const chunkPayload = await getBacktestSpotHistory({
        symbol: marketSymbol,
        mode: "chunk",
        before: nextBefore,
        preferredTf: normalizedPreferredIntradayTf,
        apiKey,
      });
      if (requestId !== loadRequestIdRef.current) {
        return null;
      }

      const chunkBars = Array.isArray(chunkPayload?.intradayBars) ? chunkPayload.intradayBars : [];
      const mergedBars = mergeOlderIntradayBars(currentSnapshot?.liveBars || [], chunkBars);
      const hasMoreIntraday = Boolean(chunkPayload?.meta?.hasMoreIntraday);
      const nextChunkBefore = chunkPayload?.meta?.nextBefore || null;
      const nextLoadedChunkCount = chunkBars.length ? loadedChunkCount + 1 : loadedChunkCount;

      commitHistorySnapshot({
        liveBars: mergedBars,
        dailyBars: currentSnapshot?.dailyBars || null,
        dataSource: currentSnapshot?.dataSource || "market",
        dataError: null,
        liveQuote: currentSnapshot?.liveQuote || null,
        spotDataMeta: buildHydrationMeta({
          ...(currentSnapshot?.spotDataMeta || {}),
          ...(chunkPayload?.meta || {}),
          coverage: {
            ...(currentSnapshot?.spotDataMeta?.coverage || {}),
            ...(chunkPayload?.meta?.coverage || {}),
            intradayStart: mergedBars[0]?.date || currentSnapshot?.spotDataMeta?.coverage?.intradayStart || null,
            intradayEnd: mergedBars[mergedBars.length - 1]?.date || currentSnapshot?.spotDataMeta?.coverage?.intradayEnd || null,
          },
        }, {
          isHydrating: false,
          loadedChunkCount: nextLoadedChunkCount,
          hasMoreIntraday,
          nextBefore: chunkBars.length ? nextChunkBefore : null,
          loadMode: requestedLoadMode === DEFAULT_HISTORY_LOAD_MODE ? USER_EXPANDED_HISTORY_LOAD_MODE : requestedLoadMode,
        }),
      });
      return chunkBars.length;
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) {
        return null;
      }
      commitHistorySnapshot({
        ...currentSnapshot,
        spotDataMeta: buildHydrationMeta(currentSnapshot?.spotDataMeta || null, {
          isHydrating: false,
          loadedChunkCount,
          hasMoreIntraday: Boolean(hydration?.hasMoreIntraday),
          nextBefore,
          loadMode: requestedLoadMode === DEFAULT_HISTORY_LOAD_MODE
            ? (hydration?.loadMode || DEFAULT_HISTORY_LOAD_MODE)
            : requestedLoadMode,
        }),
      });
      throw error;
    } finally {
      if (olderHistoryCursorInFlightRef.current === nextBefore) {
        olderHistoryCursorInFlightRef.current = null;
      }
    }
  }, [
    buildHydrationMeta,
    commitHistorySnapshot,
    marketSymbol,
    mergeOlderIntradayBars,
    normalizedPreferredIntradayTf,
    apiKey,
  ]);

  const refreshSpotQuote = useCallback(async () => {
    const lastBar = Array.isArray(liveBars) ? liveBars[liveBars.length - 1] : null;
    if (!lastBar) {
      return;
    }
    const prevClose = liveBars.length > 78 ? liveBars[liveBars.length - 79]?.c : liveBars[0]?.c;
    setLiveQuote({
      c: lastBar.c,
      dp: prevClose > 0 ? ((lastBar.c - prevClose) / prevClose * 100) : 0,
      t: Date.now(),
    });
  }, [liveBars]);

  useEffect(() => {
    commitHistorySnapshot(createEmptyHistorySnapshot());
    loadRequestIdRef.current += 1;
    olderHistoryCursorInFlightRef.current = null;
  }, [commitHistorySnapshot, marketSymbol]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    reloadSpotBars().catch(() => {});
  }, [isActive, marketSymbol, normalizedPreferredIntradayTf, apiKey, reloadSpotBars]);


  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      refreshSpotQuote().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [isActive, refreshSpotQuote]);

  const hasLoadedSpotHistory = useMemo(
    () => Array.isArray(liveBars) && liveBars.length > 0,
    [liveBars],
  );
  const historyHydration = spotDataMeta?.hydration || null;

  return {
    liveBars,
    dailyBars,
    dataSource,
    spotDataMeta,
    liveQuote,
    dataError,
    hasLoadedSpotHistory,
    hasOlderHistory: Boolean(historyHydration?.hasMoreIntraday),
    isLoadingOlderHistory: Boolean(historyHydration?.isHydrating),
    historyLoadMode: String(historyHydration?.loadMode || DEFAULT_HISTORY_LOAD_MODE),
    reloadSpotBars,
    loadOlderSpotBars: loadOlderHistory,
    loadOlderHistory,
  };
}
