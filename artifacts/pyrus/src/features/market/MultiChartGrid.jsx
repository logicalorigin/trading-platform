import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueries } from "@tanstack/react-query";
import { listFlowEvents as listFlowEventsRequest } from "@workspace/api-client-react";
import {
  getChartTimeframeDefinition,
  buildMtfTimeframeSequence,
  getChartTimeframeValues,
  normalizeChartTimeframe,
} from "../charting/timeframes";
import { useChartTimeframeFavorites } from "../charting/useChartTimeframeFavorites";
import { clearStoredChartViewportSnapshot } from "../charting/chartViewportStorage";
import { buildChartBarScopeKey } from "../charting/chartHydrationRuntime";
import {
  filterFlowEventsForChartLookbackWindow,
  filterFlowEventsForSymbol,
  getChartEventLookbackWindow,
  mergeFlowEventFeeds,
} from "../charting/chartEvents";
import { mapFlowEventToUi } from "../flow/flowEventMapper";
import { buildPremiumFlowBySymbol } from "../platform/premiumFlowIndicator";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  useMarketFlowSnapshotForStoreKey,
} from "../platform/marketFlowStore";
import {
  BARS_REQUEST_PRIORITY,
  buildBarsRequestOptions,
} from "../platform/queryDefaults";
import { useHydrationGate } from "../platform/hydrationCoordinator";
import { isTransientEmptyFlowSource } from "../platform/flowSourceState";
import { publishTradeFlowSnapshotsByTicker } from "../platform/tradeFlowStore";
import { FLOW_SCANNER_SCOPE } from "../platform/marketFlowScannerConfig";
import {
  filterFlowEventsForChartDisplay,
  useFlowTapeFilterState,
} from "../platform/flowFilterStore";
import { WATCHLIST } from "./marketReferenceData";
import {
  buildEqualTrackWeights,
  MARKET_GRID_TRACK_SESSION_KEY,
  buildMarketGridResizeHandleKey,
  normalizeMarketGridTrackLayoutState,
  normalizeMarketGridTrackPixels,
  normalizeMarketGridTrackWeights,
  readMarketGridTrackSession,
  resizeMarketGridRowPixels,
  resizeMarketGridTrackWeights,
  writeMarketGridTrackSession,
} from "./marketGridTrackState";
import { useLiveMarketFlow } from "../platform/useLiveMarketFlow";
import { getAnalyticsWorkerApi } from "../workers/analyticsClient";
import {
  USER_PREFERENCES_UPDATED_EVENT,
  readCachedUserPreferences,
} from "../preferences/userPreferenceModel";
import {
  getTickerSearchRowStorageKey,
  normalizePersistedTickerSearchRows,
  normalizeTickerSearchResultForStorage,
} from "../platform/tickerUniverseRows";
import {
  MarketChartCell,
  preloadMarketChartRuntime as preloadMarketChartCellRuntime,
} from "./MarketChartCell.jsx";
import { normalizeTickerSymbol } from "../platform/tickerIdentity";
import { _initialState, persistState } from "../../lib/workspaceState";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  PYRUS_WORKSPACE_SETTINGS_EVENT,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { Card } from "../../components/platform/primitives.jsx";
import { AppTooltip } from "@/components/ui/tooltip";


const MULTI_CHART_LAYOUTS = {
  "1x1": { cols: 1, rows: 1, count: 1 },
  "2x2": { cols: 2, rows: 2, count: 4 },
  "2x3": { cols: 3, rows: 2, count: 6 },
  "3x3": { cols: 3, rows: 3, count: 9 },
};

const MULTI_CHART_LAYOUT_CARD_WIDTH = {
  "1x1": 720,
  "2x2": 420,
  "2x3": 360,
  "3x3": 340,
};

const MARKET_CHART_SOLO_DEFAULT_HEIGHT = 560;
const MARKET_CHART_SOLO_LEGACY_DEFAULT_HEIGHT = 720;

const MULTI_CHART_LAYOUT_CARD_HEIGHT = {
  "1x1": MARKET_CHART_SOLO_DEFAULT_HEIGHT,
  "2x2": 410,
  "2x3": 380,
  "3x3": 340,
};

const MARKET_CHART_TIMEFRAMES = getChartTimeframeValues("primary");
const MAX_MULTI_CHART_SLOTS = Math.max(
  ...Object.values(MULTI_CHART_LAYOUTS).map((layout) => layout.count),
);
const MARKET_CHART_FLOW_LIMIT = 160;
const MARKET_CHART_FLOW_HISTORY_LIMIT = 1_000;
const MARKET_CHART_FLOW_LINE_BUDGET = 80;
const MARKET_CHART_FLOW_MAX_CONCURRENCY = 4;
const MARKET_CHART_FLOW_REQUEST_PRIORITY = BARS_REQUEST_PRIORITY.active;
const MARKET_CHART_FLOW_REFRESH_MS = 10_000;
const MARKET_CHART_FLOW_HISTORY_REFRESH_MS = 15_000;
const MARKET_CHART_FLOW_HISTORY_TRANSIENT_REFRESH_MS = 5_000;
// ponytail: 2s covers the measured 1.36s cold dev-worker startup; replace the
// race with cancellation if the Comlink request becomes abortable.
const MARKET_CHART_FLOW_WORKER_FALLBACK_MS = 2_000;
let marketChartFlowWorkerAvailable = true;
const MARKET_CHART_FLOW_MIN_HISTORY_BUCKET_SECONDS = 60;
const MARKET_CHART_FLOW_MAX_HISTORY_BUCKET_SECONDS = 3_600;
const MARKET_CHART_INITIAL_HYDRATION_SLOTS = 1;
const MARKET_CHART_HYDRATION_STAGGER_MS = 1_200;
const MARKET_CHART_BACKOFF_HYDRATION_STAGGER_MS = 2_500;
const MARKET_CHART_FLOW_HISTORY_TRANSIENT_REASONS = new Set([
  "options_flow_historical_provider_timeout",
  "options_flow_historical_refreshing",
]);

const migrateMarketGridTrackSessionDefaults = (state) => {
  const soloState = state?.["1x1"];
  const soloRowHeights = soloState?.rowHeights;
  if (
    !Array.isArray(soloRowHeights) ||
    soloRowHeights.length !== 1 ||
    Math.abs(soloRowHeights[0] - MARKET_CHART_SOLO_LEGACY_DEFAULT_HEIGHT) >= 1
  ) {
    return state;
  }

  return {
    ...(state || {}),
    "1x1": {
      ...soloState,
      rowHeights: [MARKET_CHART_SOLO_DEFAULT_HEIGHT],
    },
  };
};

const MARKET_CHART_FLOW_PENDING_SOURCE = {
  provider: "massive",
  status: "empty",
  ibkrStatus: "empty",
  ibkrReason: "options_flow_historical_refreshing",
};

export const preloadMarketChartRuntime = () => {
  preloadMarketChartCellRuntime();
};

const isHistoricalChartFlowTransientSource = (source) => {
  const reason = String(source?.ibkrReason || "").toLowerCase();
  return MARKET_CHART_FLOW_HISTORY_TRANSIENT_REASONS.has(reason);
};

export const mapMarketChartFlowEvents = async (
  events,
  userPreferences,
  getWorkerApi = getAnalyticsWorkerApi,
) => {
  const input = Array.isArray(events) ? events : [];
  if (!input.length) {
    return [];
  }

  const workerApi = marketChartFlowWorkerAvailable ? getWorkerApi() : null;
  if (workerApi) {
    let fallbackTimer = null;
    try {
      const mapped = await Promise.race([
        workerApi.mapFlowEventsToUi(input, userPreferences),
        new Promise((resolve) => {
          fallbackTimer = window.setTimeout(
            () => resolve(null),
            MARKET_CHART_FLOW_WORKER_FALLBACK_MS,
          );
        }),
      ]);
      if (Array.isArray(mapped)) {
        return mapped;
      }
      // Comlink requests cannot be cancelled. Stop issuing new work after a
      // timeout/invalid reply so a stalled worker cannot accumulate listeners.
      marketChartFlowWorkerAvailable = false;
    } catch (error) {
      marketChartFlowWorkerAvailable = false;
      console.warn("[pyrus] analytics worker flow mapping failed", error);
    } finally {
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
      }
    }
  }

  return input.map((event) => mapFlowEventToUi(event, userPreferences));
};

const getMarketChartFlowHistoryBucketSeconds = (timeframe) => {
  const definition = getChartTimeframeDefinition(timeframe);
  const stepSeconds = definition?.stepMs
    ? Math.round(definition.stepMs / 1000)
    : 5 * 60;
  return Math.max(
    MARKET_CHART_FLOW_MIN_HISTORY_BUCKET_SECONDS,
    Math.min(MARKET_CHART_FLOW_MAX_HISTORY_BUCKET_SECONDS, stepSeconds),
  );
};

const alignMarketChartFlowHistoryWindow = ({ from, to, bucketSeconds }) => {
  const bucketMs = Math.max(1, bucketSeconds) * 1000;
  return {
    from: new Date(Math.floor(from.getTime() / bucketMs) * bucketMs),
    to: new Date(Math.ceil(to.getTime() / bucketMs) * bucketMs),
  };
};

const buildMarketChartViewportLayoutKey = ({
  layout,
  slotIndex,
  renderedCols,
  renderedRows,
  revision,
}) =>
  [
    "market-grid",
    layout,
    `slot-${slotIndex}`,
    `${renderedCols}x${renderedRows}`,
    `rev-${revision}`,
  ].join(":");

const buildDefaultMarketChartSymbols = (
  activeSym,
  count = MAX_MULTI_CHART_SLOTS,
) => {
  const seed = normalizeTickerSymbol(activeSym) || WATCHLIST[0]?.sym || "SPY";
  const watchlistSymbols = WATCHLIST.map((item) =>
    normalizeTickerSymbol(item.sym),
  ).filter(Boolean);
  const ordered = [
    seed,
    ...watchlistSymbols.filter((symbol) => symbol !== seed),
  ];

  return Array.from(
    { length: count },
    (_, index) => ordered[index] || ordered[index % ordered.length] || seed,
  );
};

const hydrateMarketChartSlot = (slot, fallbackTicker) => ({
  ticker:
    normalizeTickerSymbol(slot?.ticker) ||
    fallbackTicker ||
    WATCHLIST[0]?.sym ||
    "SPY",
  tf: MARKET_CHART_TIMEFRAMES.includes(normalizeChartTimeframe(slot?.tf))
    ? normalizeChartTimeframe(slot?.tf)
    : "15m",
  market: slot?.market || "stocks",
  provider: slot?.provider || null,
  providers: Array.isArray(slot?.providers) ? slot.providers.filter(Boolean) : [],
  tradeProvider: slot?.tradeProvider || null,
  dataProviderPreference: slot?.dataProviderPreference || null,
  providerContractId: slot?.providerContractId || null,
  exchange:
    slot?.exchange ||
    slot?.exchangeDisplay ||
    slot?.normalizedExchangeMic ||
    slot?.primaryExchange ||
    null,
  searchResult: normalizeTickerSearchResultForStorage(slot?.searchResult) || null,
});

const buildInitialMarketChartSlots = (activeSym) => {
  const persisted = Array.isArray(_initialState.marketGridSlots)
    ? _initialState.marketGridSlots
    : [];
  const defaults = buildDefaultMarketChartSymbols(
    activeSym,
    MAX_MULTI_CHART_SLOTS,
  );
  return defaults.map((fallbackTicker, index) =>
    hydrateMarketChartSlot(persisted[index], fallbackTicker),
  );
};

export const MultiChartGrid = ({
  activeSym,
  externalSelection = null,
  onSymClick,
  watchlistSymbols = [],
  stockAggregateStreamingEnabled = false,
  isVisible = false,
  unusualThreshold,
  onChartFlowSnapshotChange,
  onReady,
  // Session-storage key for persisted column/row resize sizing. Defaults to the
  // canonical Market-page key; pass a distinct key (e.g. on the demo page) to keep
  // a second grid instance from sharing/clobbering the real page's saved sizing.
  trackStateKey = MARKET_GRID_TRACK_SESSION_KEY,
}) => {
  const gridBodyRef = useRef(null);
  const defaultSymbolsRef = useRef(
    buildDefaultMarketChartSymbols(activeSym, MAX_MULTI_CHART_SLOTS),
  );
  const [layout, setLayout] = useState(_initialState.marketGridLayout || "2x3");
  const [soloSlotIndex, setSoloSlotIndex] = useState(
    Number.isFinite(_initialState.marketGridSoloSlotIndex)
      ? Math.max(0, _initialState.marketGridSoloSlotIndex)
      : 0,
  );
  const [syncTimeframes, setSyncTimeframes] = useState(
    Boolean(_initialState.marketGridSyncTimeframes),
  );
  const [syncCrosshair, setSyncCrosshair] = useState(
    Boolean(_initialState.marketGridSyncCrosshair),
  );
  // MTF View: an ephemeral overlay that shows the selected ticker across the
  // grid at a multi-timeframe ladder. It snapshots the real multi-symbol layout
  // on enable and restores it on disable; it is NOT persisted (see persist
  // effect below, which writes the snapshot, not the MTF slots).
  const [mtfView, setMtfView] = useState(false);
  const mtfRestoreRef = useRef(null);
  const mtfAnchorTimeframeRef = useRef(null);
  const { favoriteTimeframes: mtfFavoriteTimeframes } =
    useChartTimeframeFavorites("primary");
  // Stable string key for the MTF effect dependency. useChartTimeframeFavorites
  // re-resolves to a NEW array (same values) on every PYRUS_WORKSPACE_SETTINGS_EVENT
  // — which this grid's own persistState dispatches — so depending on the array
  // identity would retrigger the MTF effect on every persist and spin into
  // "Maximum update depth exceeded". A value-equal string key has stable identity.
  const mtfFavoritesKey = mtfFavoriteTimeframes.join(",");
  const [slots, setSlots] = useState(() =>
    buildInitialMarketChartSlots(activeSym),
  );
  const [recentTickers, setRecentTickers] = useState(() =>
    Array.isArray(_initialState.marketGridRecentTickers)
      ? Array.from(
          new Set(
            _initialState.marketGridRecentTickers
              .map((symbol) => normalizeTickerSymbol(symbol))
              .filter(Boolean),
          ),
        ).slice(0, 10)
      : [],
  );
  const [recentTickerRows, setRecentTickerRows] = useState(() =>
    normalizePersistedTickerSearchRows(_initialState.marketGridRecentTickerRows, 10),
  );
  const [gridBodyWidth, setGridBodyWidth] = useState(0);
  const [marketGridTrackState, setMarketGridTrackState] = useState(() =>
    migrateMarketGridTrackSessionDefaults(readMarketGridTrackSession(trackStateKey)),
  );
  const [chartViewportLayoutRevision, setChartViewportLayoutRevision] =
    useState(0);
  const [chartViewportResetRevision, setChartViewportResetRevision] = useState(0);
  const [gridResizeHoverHandle, setGridResizeHoverHandle] = useState(null);
  const [gridResizeActiveHandle, setGridResizeActiveHandle] = useState(null);
  const [openTickerSearchSlotIndex, setOpenTickerSearchSlotIndex] = useState(null);
  const [hydrationSlotLimit, setHydrationSlotLimit] = useState(
    MARKET_CHART_INITIAL_HYDRATION_SLOTS,
  );
  const chartHydrationGate = useHydrationGate({
    enabled: isVisible,
    priority: BARS_REQUEST_PRIORITY.visible,
    family: "chart-bars",
  });
  const chartFlowHydrationGate = useHydrationGate({
    enabled: isVisible,
    priority: BARS_REQUEST_PRIORITY.favoritePrewarm,
    family: "chart-flow",
  });
  const allowProgressiveChartHydration = Boolean(chartHydrationGate.enabled);
  const [firstChartReady, setFirstChartReady] = useState(false);
  const readySignaledRef = useRef(false);
  const effectiveHydrationStaggerMs =
    chartHydrationGate.pressure === "backoff" ||
    chartHydrationGate.pressure === "stalled"
      ? MARKET_CHART_BACKOFF_HYDRATION_STAGGER_MS
      : MARKET_CHART_HYDRATION_STAGGER_MS;
  useEffect(() => {
    if (!isVisible) {
      readySignaledRef.current = false;
      setFirstChartReady(false);
    }
  }, [isVisible]);
  const handleFirstVisibleChartReady = useCallback(() => {
    if (!isVisible || readySignaledRef.current) {
      return;
    }
    readySignaledRef.current = true;
    setFirstChartReady(true);
    onReady?.();
  }, [isVisible, onReady]);
  useEffect(() => {
    const handleWorkspaceSettings = (event) => {
      const nextLayout = event?.detail?.marketGridLayout;
      if (nextLayout && MULTI_CHART_LAYOUTS[nextLayout]) {
        setLayout((current) => (current === nextLayout ? current : nextLayout));
      }
    };
    window.addEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, handleWorkspaceSettings);
    window.addEventListener(USER_PREFERENCES_UPDATED_EVENT, handleWorkspaceSettings);
    return () => {
      window.removeEventListener(
        PYRUS_WORKSPACE_SETTINGS_EVENT,
        handleWorkspaceSettings,
      );
      window.removeEventListener(USER_PREFERENCES_UPDATED_EVENT, handleWorkspaceSettings);
    };
  }, []);
  const cfg = MULTI_CHART_LAYOUTS[layout] || MULTI_CHART_LAYOUTS["2x3"];
  const defaults = defaultSymbolsRef.current;

  const toggleMtfView = () => {
    setMtfView((current) => {
      const next = !current;
      if (next) {
        // Snapshot the real multi-symbol layout so we can restore it on exit,
        // and pin chart 1's current timeframe as the MTF ladder anchor.
        mtfRestoreRef.current = { slots, syncTimeframes };
        mtfAnchorTimeframeRef.current =
          slots[soloSlotIndex]?.tf || slots[0]?.tf || "15m";
        setSyncTimeframes(false);
      } else {
        const restore = mtfRestoreRef.current;
        mtfRestoreRef.current = null;
        mtfAnchorTimeframeRef.current = null;
        if (restore) {
          setSyncTimeframes(Boolean(restore.syncTimeframes));
          setSlots(restore.slots);
        }
      }
      return next;
    });
  };

  // While MTF View is on, drive every slot to the selected ticker at the
  // computed timeframe ladder. Re-applies when the selected ticker or the
  // user's favorite timeframes change, so the view tracks the selection.
  useEffect(() => {
    if (!mtfView) {
      return;
    }
    const ticker =
      normalizeTickerSymbol(activeSym) || defaultSymbolsRef.current[0] || "SPY";
    const sequence = buildMtfTimeframeSequence({
      current: mtfAnchorTimeframeRef.current || "15m",
      favorites: mtfFavoriteTimeframes,
      available: MARKET_CHART_TIMEFRAMES,
      count: MAX_MULTI_CHART_SLOTS,
      role: "primary",
    });
    if (!sequence.length) {
      return;
    }
    setSlots((current) => {
      let changed = false;
      const next = current.map((slot, index) => {
        const tf = sequence[index] || sequence[sequence.length - 1];
        if (slot.ticker === ticker && slot.tf === tf) {
          return slot;
        }
        changed = true;
        return hydrateMarketChartSlot(
          { ...slot, ticker, tf },
          defaultSymbolsRef.current[index],
        );
      });
      // No-op when slots already match: returning `current` keeps the array
      // identity so React bails — the persist effect does not fire, so the
      // persist -> settings-event -> favorites-refresh path cannot loop.
      return changed ? next : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mtfView, activeSym, mtfFavoritesKey]);
  const layoutTrackState = useMemo(
    () =>
      normalizeMarketGridTrackLayoutState(
        marketGridTrackState?.[layout],
        cfg.cols,
        cfg.rows,
      ),
    [cfg.cols, cfg.rows, layout, marketGridTrackState],
  );
  const setLayoutTrackState = useCallback(
    (updater) => {
      setMarketGridTrackState((current) => {
        const currentLayoutState = normalizeMarketGridTrackLayoutState(
          current?.[layout],
          cfg.cols,
          cfg.rows,
        );
        const proposedLayoutState =
          typeof updater === "function" ? updater(currentLayoutState) : updater;
        const nextLayoutState = normalizeMarketGridTrackLayoutState(
          proposedLayoutState,
          cfg.cols,
          cfg.rows,
        );
        if (
          JSON.stringify(currentLayoutState) === JSON.stringify(nextLayoutState)
        ) {
          return current;
        }
        return {
          ...(current || {}),
          [layout]: nextLayoutState,
        };
      });
    },
    [cfg.cols, cfg.rows, layout],
  );
  const visibleSlotEntries = useMemo(() => {
    if (!slots.length) {
      return [];
    }
    if (layout === "1x1") {
      const clampedIndex = Math.max(
        0,
        Math.min(slots.length - 1, soloSlotIndex || 0),
      );
      return slots[clampedIndex]
        ? [{ slot: slots[clampedIndex], index: clampedIndex }]
        : [];
    }

    return slots
      .slice(0, cfg.count)
      .map((slot, index) => ({ slot, index }));
  }, [cfg.count, layout, slots, soloSlotIndex]);
  const phoneGrid = gridBodyWidth < 768;
  const workloadSlotEntries = phoneGrid
    ? visibleSlotEntries.slice(0, 1)
    : visibleSlotEntries;
  useEffect(() => {
    setOpenTickerSearchSlotIndex((current) =>
      current == null ||
      workloadSlotEntries.some((entry) => entry.index === current)
        ? current
        : null,
    );
  }, [workloadSlotEntries]);
  const visibleChartHydrationKey = workloadSlotEntries
    .map((entry, visibleIndex) => {
      const symbol = normalizeTickerSymbol(entry.slot?.ticker) || "";
      const timeframe = normalizeChartTimeframe(entry.slot?.tf) || "";
      return `${visibleIndex}:${entry.index}:${symbol}:${timeframe}`;
    })
    .join("|");
  const initialHydrationSlotLimit = chartHydrationGate.enabled
    ? Math.min(
        workloadSlotEntries.length,
        mtfView || layout === "1x1"
          ? workloadSlotEntries.length
          : MARKET_CHART_INITIAL_HYDRATION_SLOTS,
      )
    : 0;
  const effectiveHydrationSlotLimit = chartHydrationGate.enabled
    ? Math.min(
        workloadSlotEntries.length,
        Math.max(initialHydrationSlotLimit, hydrationSlotLimit),
      )
    : 0;
  const streamedSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          workloadSlotEntries
            .slice(0, effectiveHydrationSlotLimit)
            .map((entry) => normalizeTickerSymbol(entry.slot?.ticker))
            .filter(Boolean),
        ),
      ),
    [effectiveHydrationSlotLimit, workloadSlotEntries],
  );
  const streamedSymbolsKey = streamedSymbols.join(",");
  const chartReadySignalKey = `${visibleChartHydrationKey}:${initialHydrationSlotLimit}`;
  useEffect(() => {
    setHydrationSlotLimit(initialHydrationSlotLimit);
    readySignaledRef.current = false;
    setFirstChartReady(false);
  }, [initialHydrationSlotLimit, visibleChartHydrationKey]);
  useEffect(() => {
    if (
      !isVisible ||
      !allowProgressiveChartHydration ||
      workloadSlotEntries.length <= initialHydrationSlotLimit
    ) {
      return undefined;
    }

    let cancelled = false;
    const timers = [];
    for (
      let nextSlotLimit = initialHydrationSlotLimit + 1;
      nextSlotLimit <= workloadSlotEntries.length;
      nextSlotLimit += 1
    ) {
      const step = nextSlotLimit - initialHydrationSlotLimit;
      timers.push(
        window.setTimeout(() => {
          if (cancelled) {
            return;
          }
          startTransition(() => {
            setHydrationSlotLimit((current) =>
              Math.max(current, nextSlotLimit),
            );
          });
        }, effectiveHydrationStaggerMs * step),
      );
    }

    return () => {
      cancelled = true;
      timers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [
    initialHydrationSlotLimit,
    allowProgressiveChartHydration,
    effectiveHydrationStaggerMs,
    isVisible,
    visibleChartHydrationKey,
    workloadSlotEntries.length,
  ]);
  const historicalChartFlowEnabled = Boolean(
    isVisible && streamedSymbols.length && chartFlowHydrationGate.enabled,
  );
  const chartFlowHydrationReady =
    firstChartReady && chartFlowHydrationGate.enabled;
  const chartFlowEnabled = Boolean(
    isVisible && streamedSymbols.length && chartFlowHydrationReady,
  );
  const marketChartFlowConcurrency = Math.max(
    1,
    Math.min(MARKET_CHART_FLOW_MAX_CONCURRENCY, streamedSymbols.length || 1),
  );
  const marketChartFlowBatchSize = Math.max(1, streamedSymbols.length || 1);
  const historicalChartFlowRequests = useMemo(() => {
    const requestsByKey = new Map();
    workloadSlotEntries
      .slice(0, effectiveHydrationSlotLimit)
      .forEach((entry) => {
        const symbol = normalizeTickerSymbol(entry.slot?.ticker);
        if (!symbol) return;
        const hydratedTimeframe = normalizeChartTimeframe(entry.slot?.tf);
        const timeframe = MARKET_CHART_TIMEFRAMES.includes(hydratedTimeframe)
          ? hydratedTimeframe
          : "15m";
        const window = getChartEventLookbackWindow(timeframe);
        const historicalBucketSeconds =
          getMarketChartFlowHistoryBucketSeconds(timeframe);
        const alignedWindow = alignMarketChartFlowHistoryWindow({
          from: window.from,
          to: window.to,
          bucketSeconds: historicalBucketSeconds,
        });
        const request = {
          symbol,
          timeframe,
          from: alignedWindow.from.toISOString(),
          to: alignedWindow.to.toISOString(),
          historicalBucketSeconds,
        };
        requestsByKey.set(
          `${request.symbol}:${request.timeframe}:${request.historicalBucketSeconds}`,
          request,
        );
      });
    return Array.from(requestsByKey.values());
  }, [effectiveHydrationSlotLimit, workloadSlotEntries]);
  const historicalChartFlowRetainedRef = useRef(new Map());
  const historicalChartFlowMappedRef = useRef(new WeakMap());
  const historicalChartFlowQueries = useQueries({
    queries: historicalChartFlowRequests.map((request) => ({
      queryKey: [
        "market-chart-flow-history",
        request.symbol,
        request.timeframe,
        request.from,
        request.to,
        request.historicalBucketSeconds,
      ],
      queryFn: async () => {
        const response = await listFlowEventsRequest(
          {
            underlying: request.symbol,
            limit: MARKET_CHART_FLOW_HISTORY_LIMIT,
            scope: FLOW_SCANNER_SCOPE.all,
            from: request.from,
            to: request.to,
            historicalBucketSeconds: request.historicalBucketSeconds,
            blocking: false,
          },
          buildBarsRequestOptions(
            MARKET_CHART_FLOW_REQUEST_PRIORITY,
            "chart-flow",
          ),
        );
        const rawEvents = Array.isArray(response?.events)
          ? response.events
          : [];
        const userPreferences = readCachedUserPreferences();
        return {
          ...response,
          mappedEvents: await mapMarketChartFlowEvents(rawEvents, userPreferences),
          mappedPreferenceTimeKey: JSON.stringify(userPreferences.time),
        };
      },
      enabled: Boolean(historicalChartFlowEnabled && request.symbol),
      staleTime: MARKET_CHART_FLOW_HISTORY_REFRESH_MS,
      refetchInterval: historicalChartFlowEnabled
        ? (query) =>
            isHistoricalChartFlowTransientSource(query.state.data?.source)
              ? MARKET_CHART_FLOW_HISTORY_TRANSIENT_REFRESH_MS
              : MARKET_CHART_FLOW_HISTORY_REFRESH_MS
        : false,
      retry: false,
    })),
  });
  const historicalChartFlowEvents = useMemo(() => {
    const activeKeys = new Set();
    const retained = historicalChartFlowRetainedRef.current;
    const userPreferences = readCachedUserPreferences();
    const preferenceTimeKey = JSON.stringify(userPreferences.time);

    const events = historicalChartFlowQueries.flatMap((query, index) => {
      const request = historicalChartFlowRequests[index];
      if (!request?.symbol) {
        return [];
      }

      const key = `${request.symbol}:${request.timeframe}:${request.from}:${request.to}:${request.historicalBucketSeconds}`;
      activeKeys.add(key);
      const rawEvents = Array.isArray(query.data?.events)
        ? query.data.events
        : [];
      const workerMappedEvents =
        query.data?.mappedPreferenceTimeKey === preferenceTimeKey
          ? query.data?.mappedEvents
          : null;
      const cachedMapping = historicalChartFlowMappedRef.current.get(rawEvents);
      const incomingEvents =
        Array.isArray(workerMappedEvents)
          ? workerMappedEvents
          : cachedMapping?.preferenceTimeKey === preferenceTimeKey
          ? cachedMapping.events
          : rawEvents.map((event) => mapFlowEventToUi(event, userPreferences));
      if (
        !Array.isArray(workerMappedEvents) &&
        cachedMapping?.preferenceTimeKey !== preferenceTimeKey
      ) {
        historicalChartFlowMappedRef.current.set(rawEvents, {
          preferenceTimeKey,
          events: incomingEvents,
        });
      }
      const transientEmpty =
        query.isPending ||
        query.isError ||
        isTransientEmptyFlowSource(query.data?.source);

      if (incomingEvents.length > 0 || (!transientEmpty && query.data)) {
        const retainedEvents = retained.get(key)?.events || [];
        const nextEvents =
          transientEmpty && retainedEvents.length
            ? mergeFlowEventFeeds(retainedEvents, incomingEvents)
            : incomingEvents;
        retained.set(key, {
          events: nextEvents,
          source: query.data?.source || null,
        });
        return nextEvents;
      }

      return retained.get(key)?.events || [];
    });

    Array.from(retained.keys()).forEach((key) => {
      if (!activeKeys.has(key)) {
        retained.delete(key);
      }
    });

    return events;
  }, [historicalChartFlowQueries, historicalChartFlowRequests]);
  const historicalChartFlowPending = historicalChartFlowQueries.some(
    (query) => query.isPending,
  );
  const historicalChartFlowSourceBySymbol = useMemo(() => {
    const sources = {};
    historicalChartFlowQueries.forEach((query, index) => {
      const request = historicalChartFlowRequests[index];
      const symbol = request?.symbol;
      if (!symbol) {
        return;
      }
      if (query.data?.source) {
        sources[symbol] = query.data.source;
      } else if (query.isPending || query.fetchStatus === "fetching") {
        const key = `${request.symbol}:${request.timeframe}:${request.from}:${request.to}:${request.historicalBucketSeconds}`;
        sources[symbol] =
          historicalChartFlowRetainedRef.current.get(key)?.source ||
          MARKET_CHART_FLOW_PENDING_SOURCE;
      }
    });
    return sources;
  }, [historicalChartFlowQueries, historicalChartFlowRequests]);
  const chartFlowSnapshot = useLiveMarketFlow(streamedSymbols, {
    enabled: chartFlowEnabled,
    limit: MARKET_CHART_FLOW_LIMIT,
    maxSymbols: MAX_MULTI_CHART_SLOTS,
    batchSize: marketChartFlowBatchSize,
    concurrency: marketChartFlowConcurrency,
    lineBudget: MARKET_CHART_FLOW_LINE_BUDGET,
    intervalMs: MARKET_CHART_FLOW_REFRESH_MS,
    scope: FLOW_SCANNER_SCOPE.all,
    blocking: false,
    unusualThreshold,
    workloadLabel: "Chart flow",
    includeAnalytics: false,
  });
  const {
    flowStatus: chartFlowStatus,
    providerSummary: chartFlowProviderSummary,
    flowEvents: localChartFlowEvents,
  } = chartFlowSnapshot;
  const flowTapeFilters = useFlowTapeFilterState({ subscribe: isVisible });
  const broadFlowSnapshot = useMarketFlowSnapshotForStoreKey(
    BROAD_MARKET_FLOW_STORE_KEY,
    { subscribe: isVisible },
  );
  const chartFlowSourceBySymbol = useMemo(() => {
    const sources = {};
    streamedSymbols.forEach((symbol) => {
      sources[symbol] =
        historicalChartFlowSourceBySymbol[symbol] ||
        chartFlowProviderSummary?.sourcesBySymbol?.[symbol] ||
        (historicalChartFlowPending ? MARKET_CHART_FLOW_PENDING_SOURCE : null);
    });
    return sources;
  }, [
    chartFlowProviderSummary,
    historicalChartFlowPending,
    historicalChartFlowSourceBySymbol,
    streamedSymbols,
  ]);
  const chartFlowEvents = useMemo(
    () =>
      mergeFlowEventFeeds(
        historicalChartFlowEvents || [],
        localChartFlowEvents || [],
        streamedSymbols.flatMap((symbol) =>
          filterFlowEventsForSymbol(broadFlowSnapshot.flowEvents || [], symbol),
        ),
      ),
    [
      broadFlowSnapshot.flowEvents,
      historicalChartFlowEvents,
      localChartFlowEvents,
      streamedSymbols,
    ],
  );
  const effectiveChartFlowStatus = chartFlowEvents.length
    ? "live"
    : historicalChartFlowPending
      ? "loading"
      : chartFlowStatus;
  const effectiveChartFlowSnapshot = useMemo(
    () => ({
      ...chartFlowSnapshot,
      flowStatus: effectiveChartFlowStatus,
      hasLiveFlow: chartFlowEvents.length > 0 || chartFlowSnapshot.hasLiveFlow,
      flowEvents: chartFlowEvents,
    }),
    [chartFlowEvents, chartFlowSnapshot, effectiveChartFlowStatus],
  );
  const chartDisplayFlowEvents = useMemo(
    () => filterFlowEventsForChartDisplay(chartFlowEvents, flowTapeFilters),
    [chartFlowEvents, flowTapeFilters],
  );
  const chartFlowSnapshotSignature = useMemo(() => {
    const coverage = chartFlowProviderSummary?.coverage || {};
    return [
      streamedSymbolsKey,
      effectiveChartFlowStatus,
      chartFlowProviderSummary?.label || "",
      (chartFlowProviderSummary?.providers || []).join(","),
      chartFlowProviderSummary?.fallbackUsed ? "fallback" : "primary",
      coverage.cycle ?? 0,
      coverage.scannedSymbols ?? 0,
      coverage.isFetching ? "fetching" : "idle",
      coverage.newestScanAt ?? "",
      (chartFlowEvents || [])
        .map((event) => event?.id || `${event?.ticker || event?.underlying || ""}:${event?.occurredAt || ""}`)
        .join(","),
    ].join("|");
  }, [
    chartFlowEvents,
    chartFlowProviderSummary,
    effectiveChartFlowStatus,
    streamedSymbolsKey,
  ]);
  useEffect(() => {
    if (typeof onChartFlowSnapshotChange !== "function") {
      return;
    }
    if (!isVisible || !streamedSymbols.length) {
      onChartFlowSnapshotChange(null);
      return;
    }
    onChartFlowSnapshotChange({
      signature: chartFlowSnapshotSignature,
      symbols: streamedSymbols,
      snapshot: effectiveChartFlowSnapshot,
    });
  }, [
    chartFlowSnapshotSignature,
    isVisible,
    onChartFlowSnapshotChange,
    effectiveChartFlowSnapshot,
    streamedSymbolsKey,
  ]);
  useEffect(
    () => () => {
      if (typeof onChartFlowSnapshotChange === "function") {
        onChartFlowSnapshotChange(null);
      }
    },
    [onChartFlowSnapshotChange],
  );
  const premiumFlowBySymbol = useMemo(
    () => buildPremiumFlowBySymbol(chartDisplayFlowEvents, streamedSymbols),
    [chartDisplayFlowEvents, streamedSymbols],
  );
  const flowEventsBySlotIndex = useMemo(() => {
    const grouped = {};
    streamedSymbols.forEach((symbol) => {
      grouped[symbol] = [];
    });
    (chartDisplayFlowEvents || []).forEach((event) => {
      const symbol = normalizeTickerSymbol(
        event?.ticker || event?.underlying || event?.symbol,
      );
      if (!symbol || !Object.prototype.hasOwnProperty.call(grouped, symbol)) {
        return;
      }
      grouped[symbol].push(event);
    });

    const bySlot = {};
    workloadSlotEntries.forEach(({ slot, index }) => {
      const symbol = normalizeTickerSymbol(slot?.ticker);
      const hydratedTimeframe = normalizeChartTimeframe(slot?.tf);
      const timeframe = MARKET_CHART_TIMEFRAMES.includes(hydratedTimeframe)
        ? hydratedTimeframe
        : "15m";
      bySlot[index] = symbol
        ? filterFlowEventsForChartLookbackWindow(grouped[symbol] || [], timeframe)
        : [];
    });
    return bySlot;
  }, [chartDisplayFlowEvents, streamedSymbols, workloadSlotEntries]);
  useEffect(() => {
    if (!isVisible || !streamedSymbols.length) {
      return;
    }
    publishTradeFlowSnapshotsByTicker({
      symbols: streamedSymbols,
      events: chartFlowEvents,
      status: effectiveChartFlowStatus,
      source: chartFlowProviderSummary?.erroredSource || null,
      sourceBySymbol: chartFlowSourceBySymbol,
      includeEmpty: true,
      preserveExistingOnEmpty: true,
    });
  }, [
    chartFlowEvents,
    chartFlowProviderSummary?.erroredSource,
    chartFlowSourceBySymbol,
    effectiveChartFlowStatus,
    isVisible,
    streamedSymbols,
  ]);
  useEffect(() => {
    setSlots((current) => {
      let changed = current.length !== MAX_MULTI_CHART_SLOTS;
      const next = Array.from({ length: MAX_MULTI_CHART_SLOTS }, (_, index) => {
        const hydrated = hydrateMarketChartSlot(current[index], defaults[index]);
        const previous = current[index];
        if (
          !previous ||
          previous.ticker !== hydrated.ticker ||
          previous.tf !== hydrated.tf
        ) {
          changed = true;
        }
        return hydrated;
      });
      return changed ? next : current;
    });
  }, [defaults]);

  useEffect(() => {
    persistState({
      marketGridLayout: layout,
      marketGridSoloSlotIndex: soloSlotIndex,
      // While MTF View is active, persist the user's REAL (pre-MTF) Sync TF
      // setting, not the `false` that enabling MTF forced — otherwise a reload
      // while MTF is on corrupts it. Mirrors the marketGridSlots snapshot below.
      marketGridSyncTimeframes:
        mtfView && mtfRestoreRef.current
          ? mtfRestoreRef.current.syncTimeframes
          : syncTimeframes,
      marketGridSyncCrosshair: syncCrosshair,
      // MTF View is ephemeral: persist the snapshot of the real multi-symbol
      // layout, never the transient MTF slots, so a reload restores the layout.
      marketGridSlots:
        mtfView && mtfRestoreRef.current ? mtfRestoreRef.current.slots : slots,
      marketGridRecentTickers: recentTickers,
      marketGridRecentTickerRows: recentTickerRows,
    });
  }, [layout, recentTickerRows, recentTickers, soloSlotIndex, syncCrosshair, syncTimeframes, slots, mtfView]);

  useEffect(() => {
    writeMarketGridTrackSession(marketGridTrackState, trackStateKey);
  }, [marketGridTrackState, trackStateKey]);

  useEffect(() => {
    if (!gridBodyRef.current || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const element = gridBodyRef.current;
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = Math.round(entry?.contentRect?.width || 0);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setGridBodyWidth((current) =>
          current === nextWidth ? current : nextWidth,
        );
      });
    });

    observer.observe(element);
    setGridBodyWidth(Math.round(element.clientWidth || 0));

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const denseGrid = cfg.count > 4;
  const gridGap = sp(denseGrid ? 4 : 6);
  const gridPadding = sp(denseGrid ? 4 : 6);
  const baseCardMinWidth = dim(
    MULTI_CHART_LAYOUT_CARD_WIDTH[layout] ||
      MULTI_CHART_LAYOUT_CARD_WIDTH["2x3"],
  );
  const baseCellHeight = dim(
    phoneGrid
      ? 360
      : MULTI_CHART_LAYOUT_CARD_HEIGHT[layout] ||
        MULTI_CHART_LAYOUT_CARD_HEIGHT["2x3"],
  );
  const renderedSlotEntries = !isVisible
    ? []
    : workloadSlotEntries;
  const renderedCols = phoneGrid ? 1 : layout === "1x1" ? 1 : cfg.cols;
  const renderedRows = phoneGrid
    ? renderedSlotEntries.length
    : layout === "1x1"
      ? 1
      : cfg.rows;
  const hasVerticalResizeGap = !phoneGrid && renderedCols > 1;
  const hasHorizontalResizeGap = !phoneGrid && renderedRows > 1;
  const showGridResizeControl =
    !phoneGrid && (hasVerticalResizeGap || hasHorizontalResizeGap);
  const effectiveGridWidth = Math.max(0, (gridBodyWidth || 0) - gridPadding * 2);
  const trackAreaWidth = Math.max(
    0,
    effectiveGridWidth - Math.max(0, renderedCols - 1) * gridGap,
  );
  const columnWeights = normalizeMarketGridTrackWeights(
    layoutTrackState.cols,
    renderedCols,
  );
  const minRowHeight = Math.max(dim(denseGrid ? 150 : 180), baseCellHeight * 0.46);
  const rowHeights = normalizeMarketGridTrackPixels(
    layoutTrackState.rowHeights,
    renderedRows,
    baseCellHeight,
    minRowHeight,
  );
  const trackAreaHeight = rowHeights.reduce((sum, height) => sum + height, 0);
  const columnWidths = columnWeights.map((weight) => weight * trackAreaWidth);
  const minRenderedColumnWidth = columnWidths.length
    ? Math.min(...columnWidths)
    : 0;
  const compactPremiumFlow = minRenderedColumnWidth > 0 && minRenderedColumnWidth < dim(240);
  const gridRenderedHeight =
    trackAreaHeight + Math.max(0, renderedRows - 1) * gridGap;
  const verticalDividerOffsets = hasVerticalResizeGap
    ? Array.from({ length: renderedCols - 1 }, (_, index) => {
        const dividerIndex = index + 1;
        const leftTrackWidth = columnWidths
          .slice(0, dividerIndex)
          .reduce((sum, value) => sum + value, 0);
        return {
          dividerIndex,
          offset:
            gridPadding +
            leftTrackWidth +
            index * gridGap +
            gridGap / 2,
        };
      })
    : [];
  const horizontalDividerOffsets = hasHorizontalResizeGap
    ? Array.from({ length: renderedRows - 1 }, (_, index) => {
        const dividerIndex = index + 1;
        const topTrackHeight = rowHeights
          .slice(0, dividerIndex)
          .reduce((sum, value) => sum + value, 0);
        return {
          dividerIndex,
          offset:
            gridPadding +
            topTrackHeight +
            index * gridGap +
            gridGap / 2,
        };
      })
    : [];
  const verticalDividerHitThickness = dim(denseGrid ? 14 : 16);
  const horizontalDividerHitThickness = dim(denseGrid ? 14 : 16);
  const intersectionHandleSize = dim(denseGrid ? 12 : 14);
  const crosshairStroke = 2;
  const gridResizeIdleColor = cssColorMix(CSS_COLOR.textMuted, 38);
  const gridResizeHoverColor = cssColorMix(CSS_COLOR.textMuted, 74);
  const gridScaleResetDisabled = useMemo(() => {
    const defaultColumnWeights = buildEqualTrackWeights(renderedCols);
    const defaultRowHeights = Array.from({ length: renderedRows }, () => baseCellHeight);
    const columnsMatch =
      columnWeights.length === defaultColumnWeights.length &&
      columnWeights.every(
        (value, index) => Math.abs(value - defaultColumnWeights[index]) < 0.001,
      );
    const rowsMatch =
      rowHeights.length === defaultRowHeights.length &&
      rowHeights.every((value, index) => Math.abs(value - defaultRowHeights[index]) < 1);
    return columnsMatch && rowsMatch;
  }, [baseCellHeight, columnWeights, renderedCols, renderedRows, rowHeights]);
  const resetGridCardScale = useCallback(() => {
    setLayoutTrackState({
      cols: buildEqualTrackWeights(renderedCols),
      rows: buildEqualTrackWeights(renderedRows),
      rowHeights: Array.from({ length: renderedRows }, () => baseCellHeight),
    });
    setChartViewportLayoutRevision((revision) => revision + 1);
  }, [baseCellHeight, renderedCols, renderedRows, setLayoutTrackState]);
  const resetGridChartViews = useCallback(() => {
    visibleSlotEntries.forEach(({ slot }) => {
      const ticker = normalizeTickerSymbol(slot?.ticker) || "SPY";
      const timeframe = normalizeChartTimeframe(slot?.tf) || "15m";
      clearStoredChartViewportSnapshot(
        buildChartBarScopeKey("trade-equity-chart", "primary", ticker, timeframe),
      );
    });
    setChartViewportResetRevision((revision) => revision + 1);
  }, [visibleSlotEntries]);
  const startGridResize = useCallback(
    ({ mode, colGapIndex = null, rowGapIndex = null, handleKey }, event) => {
      event.preventDefault();
      event.stopPropagation();
      const handleElement = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const startColumnWeights = [...columnWeights];
      const startRowHeights = [...rowHeights];
      const minColumnWidth = Math.max(dim(denseGrid ? 140 : 170), baseCardMinWidth * 0.36);
      let lastClientX = startX;
      let lastClientY = startY;
      let resizeMoved = false;
      const handlePointerMove = (moveEvent) => {
        lastClientX = moveEvent.clientX;
        lastClientY = moveEvent.clientY;
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        if (Math.abs(deltaX) > 0 || Math.abs(deltaY) > 0) {
          resizeMoved = true;
        }
        const nextLayoutState = {
          cols: startColumnWeights,
          rows: buildEqualTrackWeights(renderedRows),
          rowHeights: startRowHeights,
        };

        if (
          (mode === "x" || mode === "xy") &&
          Number.isFinite(colGapIndex) &&
          trackAreaWidth > 0
        ) {
          nextLayoutState.cols = resizeMarketGridTrackWeights(
            startColumnWeights,
            colGapIndex,
            deltaX,
            trackAreaWidth,
            minColumnWidth,
          );
        }

        if (
          (mode === "y" || mode === "xy") &&
          Number.isFinite(rowGapIndex) &&
          trackAreaHeight > 0
        ) {
          nextLayoutState.rowHeights = resizeMarketGridRowPixels(
            startRowHeights,
            rowGapIndex,
            deltaY,
            minRowHeight,
          );
        }

        setLayoutTrackState(nextLayoutState);
      };
      const finishResize = () => {
        const hoveredHandle =
          typeof document !== "undefined"
            ? document
                .elementFromPoint(lastClientX, lastClientY)
                ?.closest?.("[data-grid-resize-handle]")
                ?.getAttribute?.("data-grid-resize-handle")
            : null;
        setGridResizeActiveHandle(null);
        setGridResizeHoverHandle(hoveredHandle || null);
        if (resizeMoved) {
          setChartViewportLayoutRevision((revision) => revision + 1);
        }
        handleElement?.releasePointerCapture?.(pointerId);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishResize);
        window.removeEventListener("pointercancel", finishResize);
      };

      setGridResizeActiveHandle(handleKey);
      setGridResizeHoverHandle(handleKey);
      handleElement.setPointerCapture?.(pointerId);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", finishResize);
      window.addEventListener("pointercancel", finishResize);
    },
    [
      baseCardMinWidth,
      baseCellHeight,
      columnWeights,
      renderedRows,
      rowHeights,
      denseGrid,
      minRowHeight,
      setLayoutTrackState,
      trackAreaHeight,
      trackAreaWidth,
    ],
  );
  const resizeGridWithKeyboard = useCallback(
    ({ mode, colGapIndex = null, rowGapIndex = null }, event) => {
      const step = event.shiftKey ? 48 : 12;
      const deltaX =
        mode === "x" || mode === "xy"
          ? event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0
          : 0;
      const deltaY =
        mode === "y" || mode === "xy"
          ? event.key === "ArrowUp"
            ? -step
            : event.key === "ArrowDown"
              ? step
              : 0
          : 0;
      if (!deltaX && !deltaY) return;

      event.preventDefault();
      event.stopPropagation();
      const minColumnWidth = Math.max(
        dim(denseGrid ? 140 : 170),
        baseCardMinWidth * 0.36,
      );
      setLayoutTrackState({
        cols:
          deltaX && Number.isFinite(colGapIndex) && trackAreaWidth > 0
            ? resizeMarketGridTrackWeights(
                columnWeights,
                colGapIndex,
                deltaX,
                trackAreaWidth,
                minColumnWidth,
              )
            : columnWeights,
        rows: buildEqualTrackWeights(renderedRows),
        rowHeights:
          deltaY && Number.isFinite(rowGapIndex) && trackAreaHeight > 0
            ? resizeMarketGridRowPixels(
                rowHeights,
                rowGapIndex,
                deltaY,
                minRowHeight,
              )
            : rowHeights,
      });
      setChartViewportLayoutRevision((revision) => revision + 1);
    },
    [
      baseCardMinWidth,
      columnWeights,
      denseGrid,
      minRowHeight,
      renderedRows,
      rowHeights,
      setLayoutTrackState,
      trackAreaHeight,
      trackAreaWidth,
    ],
  );
  const rememberSearchRow = (tickerOrRow) => {
    const normalizedTicker =
      typeof tickerOrRow === "string"
        ? normalizeTickerSymbol(tickerOrRow)
        : normalizeTickerSymbol(tickerOrRow?.ticker);
    if (!normalizedTicker) return;

    setRecentTickers((current) =>
      [normalizedTicker, ...current.filter((value) => value !== normalizedTicker)].slice(
        0,
        10,
      ),
    );

    const normalizedRow = normalizeTickerSearchResultForStorage(tickerOrRow);
    if (normalizedRow) {
      const key = getTickerSearchRowStorageKey(normalizedRow);
      setRecentTickerRows((current) =>
        [
          normalizedRow,
          ...current.filter((row) => getTickerSearchRowStorageKey(row) !== key),
        ].slice(0, 10),
      );
    }
  };

  const updateSlot = (slotIndex, patch) => {
    if (patch?.ticker) {
      rememberSearchRow(patch.searchResult || patch);
    }
    setSlots((current) =>
      current.map((slot, index) =>
        index === slotIndex
          ? hydrateMarketChartSlot({ ...slot, ...patch }, defaults[index])
          : slot,
      ),
    );
  };
  const updateSlotTimeframe = (slotIndex, tf) => {
    setSlots((current) =>
      current.map((slot, index) =>
        syncTimeframes || index === slotIndex
          ? hydrateMarketChartSlot({ ...slot, tf }, defaults[index])
          : slot,
      ),
    );
  };
  useEffect(() => {
    const normalizedExternalSym =
      externalSelection?.n > 0
        ? normalizeTickerSymbol(externalSelection?.sym)
        : "";
    const normalizedActiveSym =
      normalizedExternalSym || normalizeTickerSymbol(activeSym);
    if (!normalizedActiveSym || !visibleSlotEntries.length) {
      return;
    }
    const forcePrimarySlot = Boolean(
      normalizedExternalSym &&
        normalizedExternalSym === normalizedActiveSym,
    );

    const visibleHasActiveSymbol = visibleSlotEntries.some(
      ({ slot }) => normalizeTickerSymbol(slot?.ticker) === normalizedActiveSym,
    );
    if (visibleHasActiveSymbol && !forcePrimarySlot) {
      return;
    }

    const targetIndex =
      layout === "1x1"
        ? visibleSlotEntries[0]?.index ?? soloSlotIndex ?? 0
        : visibleSlotEntries[0]?.index ?? 0;
    const sourceIndex =
      visibleSlotEntries.find(
        ({ slot }) => normalizeTickerSymbol(slot?.ticker) === normalizedActiveSym,
      )?.index ?? -1;
    const currentSlot = slots[targetIndex];
    if (normalizeTickerSymbol(currentSlot?.ticker) === normalizedActiveSym) {
      return;
    }

    rememberSearchRow(normalizedActiveSym);
    setSlots((current) => {
      const sourceSlot = sourceIndex >= 0 ? current[sourceIndex] : null;
      const targetSlot = current[targetIndex] || null;
      return current.map((slot, index) => {
        if (index === targetIndex) {
          return hydrateMarketChartSlot(
            {
              ...(sourceSlot || slot),
              ticker: normalizedActiveSym,
              market: sourceSlot?.market || "stocks",
              provider: sourceSlot?.provider || null,
              providers: Array.isArray(sourceSlot?.providers)
                ? sourceSlot.providers
                : [],
              tradeProvider: sourceSlot?.tradeProvider || null,
              dataProviderPreference: sourceSlot?.dataProviderPreference || null,
              providerContractId: sourceSlot?.providerContractId || null,
              exchange: sourceSlot?.exchange || null,
              searchResult: sourceSlot?.searchResult || null,
            },
            defaults[index],
          );
        }
        if (
          forcePrimarySlot &&
          sourceIndex >= 0 &&
          sourceIndex !== targetIndex &&
          index === sourceIndex
        ) {
          return hydrateMarketChartSlot(targetSlot, defaults[index]);
        }
        return slot;
      });
    });
  }, [
    activeSym,
    defaults,
    externalSelection?.n,
    externalSelection?.sym,
    layout,
    slots,
    soloSlotIndex,
    visibleSlotEntries,
  ]);
  const focusedLabel =
    phoneGrid
      ? `${renderedSlotEntries[0]?.slot?.ticker || activeSym} focused`
    : layout === "1x1"
      ? visibleSlotEntries[0]?.slot?.ticker || activeSym
      : `${cfg.count} charts · ${visibleSlotEntries.length} hydrated`;

  return (
    <Card
      noPad
      data-testid="market-chart-grid"
      data-chart-hydration-pressure={chartHydrationGate.pressure}
      data-chart-hydration-slot-limit={effectiveHydrationSlotLimit}
      data-chart-visible-slot-count={renderedSlotEntries.length}
      style={{ flexShrink: 0, overflow: "visible" }}
    >
      <div
        style={{
          padding: sp(denseGrid ? "5px 8px" : "6px 10px"),
          borderBottom: `1px solid ${CSS_COLOR.border}`,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(6),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(8),
            minWidth: 0,
            flex: "1 1 220px",
          }}
        >
          <span
            style={{
              fontSize: fs(10),
              fontWeight: FONT_WEIGHTS.regular,
              fontFamily: T.sans,
              color: CSS_COLOR.textSec,
              letterSpacing: "0.04em",
            }}
          >
            {phoneGrid ? "CHART" : "CHARTS"}
          </span>
          <span
            style={{
              fontSize: textSize("caption"),
              color: CSS_COLOR.textMuted,
              fontFamily: T.sans,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {mtfView ? "mtf view" : syncTimeframes ? "sync tf" : "independent"}
            {syncCrosshair ? " · sync x" : ""} · broker-backed bars ·{" "}
            {focusedLabel}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            flex: "0 1 auto",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {!phoneGrid ? (
            <button
              type="button"
              onClick={resetGridCardScale}
              disabled={gridScaleResetDisabled}
              style={{
                padding: sp("3px 8px"),
                fontSize: textSize("caption"),
                fontFamily: T.sans,
                fontWeight: FONT_WEIGHTS.regular,
                background: gridScaleResetDisabled ? CSS_COLOR.bg3 : cssColorMix(CSS_COLOR.text, 8),
                color: gridScaleResetDisabled ? CSS_COLOR.textMuted : CSS_COLOR.text,
                border: "none",
                borderRadius: dim(RADII.xs),
                cursor: gridScaleResetDisabled ? "default" : "pointer",
                letterSpacing: "0.04em",
                opacity: gridScaleResetDisabled ? 0.55 : 1,
              }}
            >
              RESET SIZE
            </button>
          ) : null}
          <button
            type="button"
            onClick={resetGridChartViews}
            data-testid="market-chart-reset-views"
            className="ra-touch-target-y"
            style={{
              padding: sp("3px 8px"),
              fontSize: textSize("caption"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              background: cssColorMix(CSS_COLOR.text, 8),
              color: CSS_COLOR.text,
              border: "none",
              borderRadius: dim(RADII.xs),
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            RESET VIEWS
          </button>
          {!phoneGrid ? (
            <>
              <button
                type="button"
                aria-pressed={syncTimeframes}
                disabled={mtfView}
                title={
                  mtfView
                    ? "Disabled while MTF View is on (MTF sets each chart's timeframe)"
                    : undefined
                }
                onClick={() => {
                  setSyncTimeframes((current) => {
                    const next = !current;
                    if (next) {
                      const anchorTf = visibleSlotEntries[0]?.slot?.tf || "15m";
                      setSlots((slotList) =>
                        slotList.map((slot, index) =>
                          hydrateMarketChartSlot(
                            {
                              ...slot,
                              tf: anchorTf,
                            },
                            defaults[index],
                          ),
                        ),
                      );
                    }
                    return next;
                  });
                }}
                style={{
                  padding: sp("3px 8px"),
                  fontSize: textSize("caption"),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.regular,
                  background: syncTimeframes ? CSS_COLOR.accent : CSS_COLOR.bg3,
                  color: syncTimeframes ? CSS_COLOR.onAccent : CSS_COLOR.textDim,
                  border: "none",
                  borderRadius: dim(RADII.xs),
                  cursor: mtfView ? "default" : "pointer",
                  opacity: mtfView ? 0.5 : 1,
                  letterSpacing: "0.04em",
                }}
              >
                SYNC TF
              </button>
              <button
                type="button"
                aria-pressed={syncCrosshair}
                onClick={() => setSyncCrosshair((current) => !current)}
                data-testid="market-chart-sync-crosshair"
                style={{
                  padding: sp("3px 8px"),
                  fontSize: textSize("caption"),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.regular,
                  background: syncCrosshair ? CSS_COLOR.accent : CSS_COLOR.bg3,
                  color: syncCrosshair ? CSS_COLOR.onAccent : CSS_COLOR.textDim,
                  border: "none",
                  borderRadius: dim(RADII.xs),
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                }}
              >
                SYNC X
              </button>
              <button
                type="button"
                aria-pressed={mtfView}
                onClick={toggleMtfView}
                data-testid="market-chart-mtf-view"
                title="MTF View: show the selected ticker across multiple timeframes (chart 1 keeps the current timeframe; the rest step up your favorite, then longer, timeframes)"
                style={{
                  padding: sp("3px 8px"),
                  fontSize: textSize("caption"),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.regular,
                  background: mtfView ? CSS_COLOR.accent : CSS_COLOR.bg3,
                  color: mtfView ? CSS_COLOR.onAccent : CSS_COLOR.textDim,
                  border: "none",
                  borderRadius: dim(RADII.xs),
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                }}
              >
                MTF VIEW
              </button>
            </>
          ) : null}
          {!phoneGrid ? (
            <div
              role="group"
              aria-label="Chart layout"
              style={{
                display: "flex",
                gap: sp(2),
                padding: sp(denseGrid ? 1 : 2),
                background: CSS_COLOR.bg1,
                borderRadius: dim(RADII.xs),
              }}
            >
              {Object.keys(MULTI_CHART_LAYOUTS).map((key) => (
                <AppTooltip
                  key={key}
                  content={`${MULTI_CHART_LAYOUTS[key].count} charts`}
                ><button
                  key={key}
                  type="button"
                  aria-pressed={layout === key}
                  onClick={() => setLayout(key)}
                  style={{
                    padding: sp("3px 8px"),
                    fontSize: textSize("caption"),
                    fontFamily: T.sans,
                    fontWeight: FONT_WEIGHTS.regular,
                    background: layout === key ? CSS_COLOR.accent : "transparent",
                    color: layout === key ? CSS_COLOR.onAccent : CSS_COLOR.textDim,
                    border: "none",
                    borderRadius: dim(RADII.xs),
                    cursor: "pointer",
                    letterSpacing: "0.04em",
                  }}
                >
                  {key}
                </button></AppTooltip>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {/* Grid */}
      <div
        ref={gridBodyRef}
        style={{
          position: "relative",
          padding: gridPadding,
          overflow: "visible",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: columnWidths
              .map((width) => `${Math.max(width, 0)}px`)
              .join(" "),
            gridTemplateRows: rowHeights
              .map((height) => `${Math.max(height, 0)}px`)
              .join(" "),
            gap: gridGap,
            width: `${effectiveGridWidth}px`,
            height: `${gridRenderedHeight}px`,
          }}
        >
          {renderedSlotEntries.map(({ slot, index }, visibleIndex) => {
            const chartHydrationEnabled =
              visibleIndex < effectiveHydrationSlotLimit;
            const chartViewportLayoutKey = buildMarketChartViewportLayoutKey({
              layout,
              slotIndex: index,
              renderedCols,
              renderedRows,
              revision: chartViewportLayoutRevision,
            });
            return (
              <MarketChartCell
                key={`market-chart-slot-${index}-${layout}-${chartViewportLayoutRevision}-${chartViewportResetRevision}`}
                dataTestId={`market-chart-${index}`}
                slotId={`slot-${index}`}
                slot={slot}
                chartViewportLayoutKey={chartViewportLayoutKey}
                crosshairSyncGroupId={syncCrosshair ? "markets-grid" : null}
                crosshairSyncInstanceId={syncCrosshair ? `markets-grid-slot-${index}` : null}
                premiumFlowSummary={premiumFlowBySymbol[normalizeTickerSymbol(slot.ticker)]}
                flowEvents={flowEventsBySlotIndex[index] || []}
                premiumFlowStatus={effectiveChartFlowStatus}
                premiumFlowProviderSummary={chartFlowProviderSummary}
                isActive={index === soloSlotIndex}
                dense={denseGrid}
                compactFlow={compactPremiumFlow}
                fullFrame={layout === "1x1"}
                historicalDataEnabled={chartHydrationEnabled}
                stockAggregateStreamingEnabled={
                  stockAggregateStreamingEnabled && chartHydrationEnabled
                }
                onReady={
                  visibleIndex === 0 && chartHydrationEnabled
                    ? handleFirstVisibleChartReady
                    : undefined
                }
                readyKey={chartReadySignalKey}
                onFocus={(ticker) => {
                  setSoloSlotIndex(index);
                  onSymClick?.(ticker);
                }}
                onEnterSoloMode={() => {
                  setSoloSlotIndex(index);
                  setLayout("1x1");
                  onSymClick?.(slot.ticker);
                }}
                onChangeTicker={(ticker, result) => {
                  updateSlot(index, {
                    ticker,
                    market: result?.market || "stocks",
                    provider: result?.provider || result?.tradeProvider || null,
                    providers: Array.isArray(result?.providers) ? result.providers : [],
                    tradeProvider: result?.tradeProvider || null,
                    dataProviderPreference: result?.dataProviderPreference || null,
                    providerContractId: result?.providerContractId || null,
                    exchange:
                      result?.exchangeDisplay ||
                      result?.normalizedExchangeMic ||
                      result?.primaryExchange ||
                      null,
                    searchResult: result || null,
                  });
                  onSymClick?.(ticker);
                }}
                onChangeTimeframe={(tf) => updateSlotTimeframe(index, tf)}
                recentTickerRows={recentTickerRows}
                onRememberTicker={rememberSearchRow}
                tickerSearchOpen={openTickerSearchSlotIndex === index}
                onTickerSearchOpenChange={(open) => {
                  const nextOpenSlotIndex = open
                    ? index
                    : openTickerSearchSlotIndex === index
                      ? null
                      : openTickerSearchSlotIndex;
                  if (nextOpenSlotIndex === openTickerSearchSlotIndex) {
                    return;
                  }
                  setOpenTickerSearchSlotIndex(nextOpenSlotIndex);
                }}
              />
            );
          })}
        </div>
        {showGridResizeControl ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 20,
            }}
          >
            {verticalDividerOffsets.map(({ dividerIndex, offset }) => {
              const handleKey = buildMarketGridResizeHandleKey(
                "x",
                dividerIndex,
                null,
              );
              const isActive = gridResizeActiveHandle === handleKey;
              const isHovered = gridResizeHoverHandle === handleKey;
              const dividerColor = isActive
                ? CSS_COLOR.accent
                : isHovered
                  ? gridResizeHoverColor
                  : gridResizeIdleColor;
              return (
                <AppTooltip key={handleKey} content="Drag to resize chart columns"><button
                  key={handleKey}
                  type="button"
                  data-grid-resize-handle={handleKey}
                  aria-label={`Resize market chart columns ${dividerIndex} and ${
                    dividerIndex + 1
                  }`}
                  onPointerDown={(event) =>
                    startGridResize(
                      {
                        mode: "x",
                        colGapIndex: dividerIndex,
                        handleKey,
                      },
                      event,
                    )
                  }
                  onKeyDown={(event) =>
                    resizeGridWithKeyboard(
                      { mode: "x", colGapIndex: dividerIndex },
                      event,
                    )
                  }
                  onPointerEnter={() => {
                    if (!gridResizeActiveHandle) {
                      setGridResizeHoverHandle(handleKey);
                    }
                  }}
                  onPointerLeave={() => {
                    if (!gridResizeActiveHandle) {
                      setGridResizeHoverHandle(null);
                    }
                  }}
                  style={{
                    position: "absolute",
                    left: offset - verticalDividerHitThickness / 2,
                    top: gridPadding,
                    width: verticalDividerHitThickness,
                    height: gridRenderedHeight,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "col-resize",
                    pointerEvents: "auto",
                    touchAction: "none",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left:
                        (verticalDividerHitThickness - crosshairStroke) / 2,
                      top: 0,
                      width: crosshairStroke,
                      height: "100%",
                      background: dividerColor,
                      boxShadow: isActive
                        ? `0 0 0 1px ${CSS_COLOR.bg0}, 0 0 12px ${cssColorMix(CSS_COLOR.accent, 35)}`
                        : isHovered
                          ? `0 0 0 1px ${cssColorMix(CSS_COLOR.border, 60)}`
                          : "none",
                      opacity: isActive ? 1 : isHovered ? 0.92 : 0.78,
                      transition:
                        "opacity var(--ra-motion-fast) ease, background var(--ra-motion-fast) ease, box-shadow var(--ra-motion-fast) ease",
                    }}
                  />
                </button></AppTooltip>
              );
            })}
            {horizontalDividerOffsets.map(({ dividerIndex, offset }) => {
              const handleKey = buildMarketGridResizeHandleKey(
                "y",
                null,
                dividerIndex,
              );
              const isActive = gridResizeActiveHandle === handleKey;
              const isHovered = gridResizeHoverHandle === handleKey;
              const dividerColor = isActive
                ? CSS_COLOR.accent
                : isHovered
                  ? gridResizeHoverColor
                  : gridResizeIdleColor;
              return (
                <AppTooltip key={handleKey} content="Drag to resize chart rows"><button
                  key={handleKey}
                  type="button"
                  data-grid-resize-handle={handleKey}
                  aria-label={`Resize market chart rows ${dividerIndex} and ${
                    dividerIndex + 1
                  }`}
                  onPointerDown={(event) =>
                    startGridResize(
                      {
                        mode: "y",
                        rowGapIndex: dividerIndex,
                        handleKey,
                      },
                      event,
                    )
                  }
                  onKeyDown={(event) =>
                    resizeGridWithKeyboard(
                      { mode: "y", rowGapIndex: dividerIndex },
                      event,
                    )
                  }
                  onPointerEnter={() => {
                    if (!gridResizeActiveHandle) {
                      setGridResizeHoverHandle(handleKey);
                    }
                  }}
                  onPointerLeave={() => {
                    if (!gridResizeActiveHandle) {
                      setGridResizeHoverHandle(null);
                    }
                  }}
                  style={{
                    position: "absolute",
                    left: gridPadding,
                    top: offset - horizontalDividerHitThickness / 2,
                    width: effectiveGridWidth,
                    height: horizontalDividerHitThickness,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "row-resize",
                    pointerEvents: "auto",
                    touchAction: "none",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left: 0,
                      top:
                        (horizontalDividerHitThickness - crosshairStroke) / 2,
                      width: "100%",
                      height: crosshairStroke,
                      background: dividerColor,
                      boxShadow: isActive
                        ? `0 0 0 1px ${CSS_COLOR.bg0}, 0 0 12px ${cssColorMix(CSS_COLOR.accent, 35)}`
                        : isHovered
                          ? `0 0 0 1px ${cssColorMix(CSS_COLOR.border, 60)}`
                          : "none",
                      opacity: isActive ? 1 : isHovered ? 0.92 : 0.78,
                      transition:
                        "opacity var(--ra-motion-fast) ease, background var(--ra-motion-fast) ease, box-shadow var(--ra-motion-fast) ease",
                    }}
                  />
                </button></AppTooltip>
              );
            })}
            {verticalDividerOffsets.flatMap((verticalDivider) =>
              horizontalDividerOffsets.map((horizontalDivider) => {
                const handleKey = buildMarketGridResizeHandleKey(
                  "xy",
                  verticalDivider.dividerIndex,
                  horizontalDivider.dividerIndex,
                );
                const isActive = gridResizeActiveHandle === handleKey;
                const isHovered = gridResizeHoverHandle === handleKey;
                return (
                  <AppTooltip key={handleKey} content="Drag diagonally to resize chart rows and columns"><button
                    key={handleKey}
                    type="button"
                    data-grid-resize-handle={handleKey}
                    aria-label={`Resize market chart rows and columns at divider ${verticalDivider.dividerIndex}-${horizontalDivider.dividerIndex}`}
                    onPointerDown={(event) =>
                      startGridResize(
                        {
                          mode: "xy",
                          colGapIndex: verticalDivider.dividerIndex,
                          rowGapIndex: horizontalDivider.dividerIndex,
                          handleKey,
                        },
                        event,
                      )
                    }
                    onKeyDown={(event) =>
                      resizeGridWithKeyboard(
                        {
                          mode: "xy",
                          colGapIndex: verticalDivider.dividerIndex,
                          rowGapIndex: horizontalDivider.dividerIndex,
                        },
                        event,
                      )
                    }
                    onPointerEnter={() => {
                      if (!gridResizeActiveHandle) {
                        setGridResizeHoverHandle(handleKey);
                      }
                    }}
                    onPointerLeave={() => {
                      if (!gridResizeActiveHandle) {
                        setGridResizeHoverHandle(null);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left:
                        verticalDivider.offset - intersectionHandleSize / 2,
                      top:
                        horizontalDivider.offset - intersectionHandleSize / 2,
                      width: intersectionHandleSize,
                      height: intersectionHandleSize,
                      padding: 0,
                      border: "none",
                      borderRadius: RADII.pill,
                      background: "transparent",
                      cursor: "nwse-resize",
                      pointerEvents: "auto",
                      touchAction: "none",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: RADII.pill,
                        background: isActive
                          ? CSS_COLOR.accent
                          : isHovered
                            ? gridResizeHoverColor
                            : cssColorMix(CSS_COLOR.textMuted, 48),
                        boxShadow: isActive
                          ? `0 0 0 1px ${CSS_COLOR.bg0}, 0 0 14px ${cssColorMix(CSS_COLOR.accent, 40)}`
                          : isHovered
                            ? `0 0 0 1px ${CSS_COLOR.bg0}`
                            : `0 0 0 1px ${cssColorMix(CSS_COLOR.border, 80)}`,
                        opacity: isActive ? 1 : isHovered ? 0.92 : 0.8,
                        transition:
                          "opacity var(--ra-motion-fast) ease, background var(--ra-motion-fast) ease, box-shadow var(--ra-motion-fast) ease",
                      }}
                    />
                  </button></AppTooltip>
                );
              }),
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
};

// ─── Trade tab sub-components ───
