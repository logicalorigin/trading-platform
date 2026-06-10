import {
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
  getChartTimeframeValues,
  normalizeChartTimeframe,
} from "../charting/timeframes";
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
import { USER_PREFERENCES_UPDATED_EVENT } from "../preferences/userPreferenceModel";
import {
  getTickerSearchRowStorageKey,
  normalizePersistedTickerSearchRows,
  normalizeTickerSearchResultForStorage,
} from "../platform/tickerSearch/model";
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

const MARKET_CHART_INTERACTIVE_TARGET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='switch']",
  "[data-chart-control-root]",
  "[data-grid-resize-handle]",
  "[data-radix-popper-content-wrapper]",
  "[data-testid='ticker-search-popover']",
].join(",");

const isMarketChartInteractiveTarget = (target) =>
  typeof Element !== "undefined" &&
  target instanceof Element &&
  Boolean(target.closest(MARKET_CHART_INTERACTIVE_TARGET_SELECTOR));

const isMarketChartPlotTarget = (target) =>
  typeof Element !== "undefined" &&
  target instanceof Element &&
  Boolean(target.closest("[data-chart-plot-root]"));
const MARKET_CHART_PLOT_FOCUS_MOVE_TOLERANCE = 6;

export const MultiChartGrid = ({
  activeSym,
  externalSelection = null,
  onSymClick,
  watchlistSymbols = [],
  popularTickers = [],
  signalSuggestionSymbols = [],
  stockAggregateStreamingEnabled = false,
  isVisible = false,
  unusualThreshold,
  onChartFlowSnapshotChange,
  onReady,
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
  const [slots, setSlots] = useState(() =>
    buildInitialMarketChartSlots(activeSym),
  );
  const [recentTickers, setRecentTickers] = useState(() =>
    Array.isArray(_initialState.marketGridRecentTickers)
      ? _initialState.marketGridRecentTickers
          .map((symbol) => normalizeTickerSymbol(symbol))
          .filter(Boolean)
          .slice(0, 10)
      : [],
  );
  const [recentTickerRows, setRecentTickerRows] = useState(() =>
    normalizePersistedTickerSearchRows(_initialState.marketGridRecentTickerRows, 10),
  );
  const [gridBodyWidth, setGridBodyWidth] = useState(0);
  const [marketGridTrackState, setMarketGridTrackState] = useState(() =>
    migrateMarketGridTrackSessionDefaults(readMarketGridTrackSession()),
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
    window.addEventListener(
      PYRUS_WORKSPACE_SETTINGS_EVENT,
      handleWorkspaceSettings,
    );
    window.addEventListener(USER_PREFERENCES_UPDATED_EVENT, handleWorkspaceSettings);
    return () => {
      window.removeEventListener(
        PYRUS_WORKSPACE_SETTINGS_EVENT,
        handleWorkspaceSettings,
      );
      window.removeEventListener(
        PYRUS_WORKSPACE_SETTINGS_EVENT,
        handleWorkspaceSettings,
      );
      window.removeEventListener(USER_PREFERENCES_UPDATED_EVENT, handleWorkspaceSettings);
    };
  }, []);
  const cfg = MULTI_CHART_LAYOUTS[layout] || MULTI_CHART_LAYOUTS["2x3"];
  const defaults = defaultSymbolsRef.current;
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
  useEffect(() => {
    setOpenTickerSearchSlotIndex((current) =>
      current == null ||
      visibleSlotEntries.some((entry) => entry.index === current)
        ? current
        : null,
    );
  }, [visibleSlotEntries]);
  const streamedSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          visibleSlotEntries
            .map((entry) => normalizeTickerSymbol(entry.slot?.ticker))
            .filter(Boolean),
        ),
      ),
    [visibleSlotEntries],
  );
  const streamedSymbolsKey = streamedSymbols.join(",");
  const initialHydrationSlotLimit = chartHydrationGate.enabled
    ? Math.min(
        visibleSlotEntries.length,
        layout === "1x1" ? 1 : MARKET_CHART_INITIAL_HYDRATION_SLOTS,
      )
    : 0;
  const effectiveHydrationSlotLimit = chartHydrationGate.enabled
    ? Math.min(
        visibleSlotEntries.length,
        Math.max(initialHydrationSlotLimit, hydrationSlotLimit),
      )
    : 0;
  const chartReadySignalKey = `${streamedSymbolsKey}:${initialHydrationSlotLimit}`;
  useEffect(() => {
    setHydrationSlotLimit(initialHydrationSlotLimit);
    readySignaledRef.current = false;
    setFirstChartReady(false);
  }, [initialHydrationSlotLimit, streamedSymbolsKey]);
  useEffect(() => {
    if (
      !isVisible ||
      !allowProgressiveChartHydration ||
      visibleSlotEntries.length <= initialHydrationSlotLimit
    ) {
      return undefined;
    }

    let cancelled = false;
    const timers = [];
    for (
      let nextSlotLimit = initialHydrationSlotLimit + 1;
      nextSlotLimit <= visibleSlotEntries.length;
      nextSlotLimit += 1
    ) {
      const step = nextSlotLimit - initialHydrationSlotLimit;
      timers.push(
        window.setTimeout(() => {
          if (cancelled) {
            return;
          }
          setHydrationSlotLimit((current) =>
            Math.max(current, nextSlotLimit),
          );
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
    streamedSymbolsKey,
    visibleSlotEntries.length,
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
    visibleSlotEntries.forEach((entry) => {
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
  }, [visibleSlotEntries]);
  const historicalChartFlowRetainedRef = useRef(new Map());
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
      queryFn: () =>
        listFlowEventsRequest(
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
        ),
      enabled: Boolean(historicalChartFlowEnabled && request.symbol),
      staleTime: MARKET_CHART_FLOW_HISTORY_REFRESH_MS,
      refetchInterval: historicalChartFlowEnabled
        ? (query) =>
            isHistoricalChartFlowTransientSource(query.state.data?.source)
              ? MARKET_CHART_FLOW_HISTORY_TRANSIENT_REFRESH_MS
              : MARKET_CHART_FLOW_HISTORY_REFRESH_MS
        : false,
      placeholderData: (previousData) => previousData,
      retry: false,
    })),
  });
  const historicalChartFlowEvents = useMemo(() => {
    const activeKeys = new Set();
    const retained = historicalChartFlowRetainedRef.current;

    const events = historicalChartFlowQueries.flatMap((query, index) => {
      const request = historicalChartFlowRequests[index];
      if (!request?.symbol) {
        return [];
      }

      const key = `${request.symbol}:${request.timeframe}:${request.from}:${request.to}:${request.historicalBucketSeconds}`;
      activeKeys.add(key);
      const incomingEvents = (query.data?.events || []).map((event) =>
        mapFlowEventToUi(event),
      );
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
    visibleSlotEntries.forEach(({ slot, index }) => {
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
  }, [chartDisplayFlowEvents, streamedSymbols, visibleSlotEntries]);
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
  const chartFlowSuggestionSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          (chartFlowEvents || [])
            .map((event) => normalizeTickerSymbol(event?.ticker || event?.underlying))
            .filter(Boolean),
        ),
      ).slice(0, 12),
    [chartFlowEvents],
  );
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
      marketGridSyncTimeframes: syncTimeframes,
      marketGridSyncCrosshair: syncCrosshair,
      marketGridSlots: slots,
      marketGridRecentTickers: recentTickers,
      marketGridRecentTickerRows: recentTickerRows,
    });
  }, [layout, recentTickerRows, recentTickers, soloSlotIndex, syncCrosshair, syncTimeframes, slots]);

  useEffect(() => {
    writeMarketGridTrackSession(marketGridTrackState);
  }, [marketGridTrackState]);

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
  const phoneGrid = gridBodyWidth > 0 && gridBodyWidth < 768;
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
  const renderedSlotEntries = phoneGrid
    ? visibleSlotEntries.slice(0, 1)
    : visibleSlotEntries;
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
  const gridResizeIdleColor = "rgba(166, 174, 182, 0.38)";
  const gridResizeHoverColor = "rgba(196, 203, 210, 0.74)";
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
      const timeframe = normalizeChartTimeframe(slot?.tf) || "5m";
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
      ? `${renderedSlotEntries[0]?.slot?.ticker || activeSym} focused · ${cfg.count}-chart desktop preset`
    : layout === "1x1"
      ? visibleSlotEntries[0]?.slot?.ticker || activeSym
      : `${cfg.count} visible`;

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
            CHARTS
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
            {syncTimeframes ? "sync tf" : "independent"}
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
                background: gridScaleResetDisabled ? CSS_COLOR.bg3 : "rgba(255,255,255,0.08)",
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
            style={{
              padding: sp("3px 8px"),
              fontSize: textSize("caption"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              background: "rgba(255,255,255,0.08)",
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
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                }}
              >
                SYNC TF
              </button>
              <button
                type="button"
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
            </>
          ) : null}
          <div
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
                content={
                  phoneGrid
                    ? `${MULTI_CHART_LAYOUTS[key].count}-chart desktop preset; phone shows one focused chart`
                    : `${MULTI_CHART_LAYOUTS[key].count} charts`
                }
              ><button
                key={key}
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
                isActive={slot.ticker === activeSym}
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
                onFocus={onSymClick}
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
                recentTickers={recentTickers}
                recentTickerRows={recentTickerRows}
                watchlistSymbols={watchlistSymbols}
                popularTickers={popularTickers}
                smartSuggestionSymbols={chartFlowSuggestionSymbols}
                signalSuggestionSymbols={signalSuggestionSymbols}
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
                        ? `0 0 0 1px ${CSS_COLOR.bg0}, 0 0 12px rgba(91,140,255,0.35)`
                        : isHovered
                          ? `0 0 0 1px rgba(0,0,0,0.18)`
                          : "none",
                      opacity: isActive ? 1 : isHovered ? 0.92 : 0.78,
                      transition:
                        "opacity 120ms ease, background 120ms ease, box-shadow 120ms ease",
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
                        ? `0 0 0 1px ${CSS_COLOR.bg0}, 0 0 12px rgba(91,140,255,0.35)`
                        : isHovered
                          ? `0 0 0 1px rgba(0,0,0,0.18)`
                          : "none",
                      opacity: isActive ? 1 : isHovered ? 0.92 : 0.78,
                      transition:
                        "opacity 120ms ease, background 120ms ease, box-shadow 120ms ease",
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
                            : "rgba(166, 174, 182, 0.48)",
                        boxShadow: isActive
                          ? `0 0 0 1px ${CSS_COLOR.bg0}, 0 0 14px rgba(91,140,255,0.4)`
                          : isHovered
                            ? `0 0 0 1px ${CSS_COLOR.bg0}`
                            : `0 0 0 1px rgba(0,0,0,0.28)`,
                        opacity: isActive ? 1 : isHovered ? 0.92 : 0.8,
                        transition:
                          "opacity 120ms ease, background 120ms ease, box-shadow 120ms ease",
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
