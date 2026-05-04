import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBars as getBarsRequest,
  useGetQuoteSnapshots,
} from "@workspace/api-client-react";
import {
  DISPLAY_CHART_OUTSIDE_RTH,
  resolveDisplayChartPrice,
} from "../charting/displayChartSession";
import { RayReplicaSettingsMenu } from "../charting/RayReplicaSettingsMenu";
import { ResearchChartFrame } from "../charting/ResearchChartFrame";
import {
  ResearchChartWidgetFooter,
  ResearchChartWidgetHeader,
  ResearchChartWidgetSidebar,
} from "../charting/ResearchChartWidgetChrome";
import {
  expandLocalRollupLimit,
  resolveLocalRollupBaseTimeframe,
  rollupMarketBars,
} from "../charting/timeframeRollups";
import { flowEventsToChartEvents } from "../charting/chartEvents";
import {
  getChartBarLimit,
  getChartTimeframeValues,
  getInitialChartBarLimit,
  getMaxChartBarLimit,
  normalizeChartTimeframe,
} from "../charting/timeframes";
import { recordChartBarScopeState } from "../charting/chartHydrationStats";
import { resolveSpotChartFrameLayout } from "../charting/spotChartFrameLayout";
import {
  useBrokerStreamedBars,
  useHistoricalBarStream,
  usePrependableHistoricalBars,
} from "../charting/useMassiveStreamedStockBars";
import { useDrawingHistory } from "../charting/useDrawingHistory";
import { useIndicatorLibrary } from "../charting/pineScripts";
import {
  buildMiniChartBarsFromApi,
  describeBrokerChartSource,
  describeBrokerChartStatus,
  useDisplayChartPriceFallbackBars,
} from "../charting/chartApiBars";
import {
  buildChartBarScopeKey,
  measureChartBarsRequest,
  useDebouncedVisibleRangeExpansion,
  useMeasuredChartModel,
  useProgressiveChartBarLimit,
} from "../charting/chartHydrationRuntime";
import { useChartTimeframeFavorites } from "../charting/useChartTimeframeFavorites";
import {
  buildRayReplicaIndicatorSettings,
  isRayReplicaIndicatorSelected,
  mergeIndicatorSelections,
  normalizeIndicatorSelection,
  resolvePersistedIndicatorPreset,
  resolvePersistedRayReplicaSettings,
} from "../charting/chartIndicatorPersistence";
import {
  EMPTY_PREMIUM_FLOW_SUMMARY,
  buildPremiumFlowBySymbol,
  resolvePremiumFlowDisplayState,
} from "../platform/premiumFlowIndicator";
import { FLOW_SCANNER_SCOPE } from "../platform/marketFlowScannerConfig";
import {
  DEFAULT_WATCHLIST_BY_SYMBOL,
  WATCHLIST,
} from "./marketReferenceData";
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
import {
  buildMarketBarsPageQueryKey as buildBarsPageQueryKey,
  buildMarketGridViewportIdentity,
  buildMarketGridViewportRevisionIdentity,
  buildMarketGridVisibleRangeSignature,
  deleteMarketGridViewportSnapshots,
  normalizeMiniChartStudies,
} from "./marketGridChartState";
import {
  ensureTradeTickerInfo,
  useRuntimeTickerSnapshot,
} from "../platform/runtimeTickerStore";
import { useSignalMonitorStateForSymbol } from "../platform/signalMonitorStore";
import { useHydrationIntent } from "../platform/hydrationCoordinator";
import { useLiveMarketFlow } from "../platform/useLiveMarketFlow";
import { useIbkrQuoteSnapshotStream } from "../platform/live-streams";
import { USER_PREFERENCES_UPDATED_EVENT } from "../preferences/userPreferenceModel";
import {
  getTickerSearchRowStorageKey,
  normalizePersistedTickerSearchRows,
  normalizeTickerSearchResultForStorage,
} from "../platform/tickerSearch/TickerSearch.jsx";
import { MiniChartCell } from "./MiniChartCell.jsx";
import {
  normalizeChartBarsPagePayload,
  normalizeLatestChartBarsPayload,
} from "../charting/chartBarsPayloads";
import { BARS_QUERY_DEFAULTS, BARS_REQUEST_PRIORITY, buildBarsRequestOptions } from "../platform/queryDefaults";
import { normalizeTickerSymbol } from "../platform/tickerIdentity";
import { _initialState, persistState } from "../../lib/workspaceState";
import { fmtM, isFiniteNumber } from "../../lib/formatters";
import { T, dim, fs, getCurrentTheme, sp } from "../../lib/uiTokens";
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

const MULTI_CHART_LAYOUT_CARD_HEIGHT = {
  "1x1": 720,
  "2x2": 410,
  "2x3": 380,
  "3x3": 340,
};

const MINI_CHART_TIMEFRAMES = getChartTimeframeValues("mini");
const MAX_MULTI_CHART_SLOTS = Math.max(
  ...Object.values(MULTI_CHART_LAYOUTS).map((layout) => layout.count),
);
const MARKET_GRID_INDICATOR_PRESET_VERSION = 2;
const MARKET_CHART_FLOW_LIMIT = 80;

const buildDefaultMiniChartSymbols = (
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

const hydrateMiniChartSlot = (
  slot,
  fallbackTicker,
  includeRayReplicaByDefault = false,
) => ({
  ticker:
    normalizeTickerSymbol(slot?.ticker) ||
    fallbackTicker ||
    WATCHLIST[0]?.sym ||
    "SPY",
  tf: MINI_CHART_TIMEFRAMES.includes(normalizeChartTimeframe(slot?.tf))
    ? normalizeChartTimeframe(slot?.tf)
    : "15m",
  studies: normalizeMiniChartStudies(
    slot?.studies,
    includeRayReplicaByDefault,
  ),
  rayReplicaSettings: resolvePersistedRayReplicaSettings(
    slot?.rayReplicaSettings,
  ),
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

const buildInitialMiniChartSlots = (activeSym) => {
  const persisted = Array.isArray(_initialState.marketGridSlots)
    ? _initialState.marketGridSlots
    : [];
  const defaults = buildDefaultMiniChartSymbols(
    activeSym,
    MAX_MULTI_CHART_SLOTS,
  );
  return defaults.map((fallbackTicker, index) =>
    hydrateMiniChartSlot(
      persisted[index],
      fallbackTicker,
      _initialState.marketGridIndicatorPresetVersion !==
        MARKET_GRID_INDICATOR_PRESET_VERSION,
    ),
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
}) => {
  const queryClient = useQueryClient();
  const gridBodyRef = useRef(null);
  const defaultSymbolsRef = useRef(
    buildDefaultMiniChartSymbols(activeSym, MAX_MULTI_CHART_SLOTS),
  );
  const [layout, setLayout] = useState(_initialState.marketGridLayout || "2x3");
  const [soloSlotIndex, setSoloSlotIndex] = useState(
    Number.isFinite(_initialState.marketGridSoloSlotIndex)
      ? Math.max(0, _initialState.marketGridSoloSlotIndex)
      : 0,
  );
  const {
    favoriteTimeframes: miniFavoriteTimeframes,
    toggleFavoriteTimeframe: toggleMiniFavoriteTimeframe,
  } = useChartTimeframeFavorites("mini");
  const [syncTimeframes, setSyncTimeframes] = useState(
    Boolean(_initialState.marketGridSyncTimeframes),
  );
  const [slots, setSlots] = useState(() =>
    buildInitialMiniChartSlots(activeSym),
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
    readMarketGridTrackSession(),
  );
  const [chartViewportSnapshots, setChartViewportSnapshots] = useState({});
  const [chartViewportResetRevision, setChartViewportResetRevision] = useState(0);
  const [gridResizeHoverHandle, setGridResizeHoverHandle] = useState(null);
  const [gridResizeActiveHandle, setGridResizeActiveHandle] = useState(null);
  const [openTickerSearchSlotIndex, setOpenTickerSearchSlotIndex] = useState(null);
  useEffect(() => {
    const handleWorkspaceSettings = (event) => {
      const nextLayout = event?.detail?.marketGridLayout;
      if (nextLayout && MULTI_CHART_LAYOUTS[nextLayout]) {
        setLayout((current) => (current === nextLayout ? current : nextLayout));
      }
    };
    window.addEventListener("rayalgo:workspace-settings-updated", handleWorkspaceSettings);
    window.addEventListener(USER_PREFERENCES_UPDATED_EVENT, handleWorkspaceSettings);
    return () => {
      window.removeEventListener(
        "rayalgo:workspace-settings-updated",
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
  const quoteSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          visibleSlotEntries
            .map((entry) => entry.slot?.ticker)
            .filter(Boolean),
        ),
      ).join(","),
    [visibleSlotEntries],
  );
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
  const {
    flowStatus: chartFlowStatus,
    providerSummary: chartFlowProviderSummary,
    flowEvents: chartFlowEvents,
  } = useLiveMarketFlow(streamedSymbols, {
    enabled: Boolean(isVisible && streamedSymbols.length),
    limit: MARKET_CHART_FLOW_LIMIT,
    maxSymbols: MAX_MULTI_CHART_SLOTS,
    batchSize: MAX_MULTI_CHART_SLOTS,
    intervalMs: 10_000,
    scope: FLOW_SCANNER_SCOPE.unusual,
    unusualThreshold,
    workloadLabel: "Chart unusual flow",
  });
  const premiumFlowBySymbol = useMemo(
    () => buildPremiumFlowBySymbol(chartFlowEvents, streamedSymbols),
    [chartFlowEvents, streamedSymbols],
  );
  const chartEventsBySymbol = useMemo(() => {
    const grouped = {};
    streamedSymbols.forEach((symbol) => {
      grouped[symbol] = flowEventsToChartEvents(chartFlowEvents, symbol);
    });
    return grouped;
  }, [chartFlowEvents, streamedSymbols]);
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
  const gridQuotesQuery = useGetQuoteSnapshots(
    quoteSymbols ? { symbols: quoteSymbols } : undefined,
    {
      query: {
        enabled: Boolean(quoteSymbols),
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  useIbkrQuoteSnapshotStream({
    symbols: streamedSymbols,
    enabled: Boolean(stockAggregateStreamingEnabled && streamedSymbols.length > 0),
  });
  const quotesBySymbol = useMemo(
    () =>
      Object.fromEntries(
        (gridQuotesQuery.data?.quotes || []).map((quote) => [
          normalizeTickerSymbol(quote.symbol),
          quote,
        ]),
      ),
    [gridQuotesQuery.data],
  );

  useEffect(() => {
    setSlots((current) => {
      let changed = current.length !== MAX_MULTI_CHART_SLOTS;
      const next = Array.from({ length: MAX_MULTI_CHART_SLOTS }, (_, index) => {
        const hydrated = hydrateMiniChartSlot(current[index], defaults[index]);
        const previous = current[index];
        if (
          !previous ||
          previous.ticker !== hydrated.ticker ||
          previous.tf !== hydrated.tf ||
          JSON.stringify(previous.studies || []) !==
            JSON.stringify(hydrated.studies || []) ||
          JSON.stringify(previous.rayReplicaSettings || {}) !==
            JSON.stringify(hydrated.rayReplicaSettings || {})
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
      marketGridIndicatorPresetVersion: MARKET_GRID_INDICATOR_PRESET_VERSION,
      marketGridSlots: slots,
      marketGridRecentTickers: recentTickers,
      marketGridRecentTickerRows: recentTickerRows,
    });
  }, [layout, recentTickerRows, recentTickers, soloSlotIndex, syncTimeframes, slots]);

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
  const baseCardMinWidth = dim(
    MULTI_CHART_LAYOUT_CARD_WIDTH[layout] ||
      MULTI_CHART_LAYOUT_CARD_WIDTH["2x3"],
  );
  const baseCellHeight = dim(
    MULTI_CHART_LAYOUT_CARD_HEIGHT[layout] ||
      MULTI_CHART_LAYOUT_CARD_HEIGHT["2x3"],
  );
  const renderedCols = layout === "1x1" ? 1 : cfg.cols;
  const renderedRows = layout === "1x1" ? 1 : cfg.rows;
  const hasVerticalResizeGap = renderedCols > 1;
  const hasHorizontalResizeGap = renderedRows > 1;
  const showGridResizeControl = hasVerticalResizeGap || hasHorizontalResizeGap;
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
  }, [baseCellHeight, renderedCols, renderedRows, setLayoutTrackState]);
  const resetGridChartViews = useCallback(() => {
    setChartViewportSnapshots({});
    setChartViewportResetRevision((revision) => revision + 1);
  }, []);
  const rememberViewportSnapshot = useCallback((identityKey, snapshot) => {
    if (!identityKey || !snapshot || snapshot.identityKey !== identityKey) {
      return;
    }
    setChartViewportSnapshots((current) => {
      const existing = current?.[identityKey];
      if (
        existing &&
        existing.userTouched === snapshot.userTouched &&
        existing.realtimeFollow === snapshot.realtimeFollow &&
        existing.scaleMode === snapshot.scaleMode &&
        existing.autoScale === snapshot.autoScale &&
        existing.invertScale === snapshot.invertScale &&
        buildMarketGridVisibleRangeSignature(existing.visibleLogicalRange) ===
          buildMarketGridVisibleRangeSignature(snapshot.visibleLogicalRange)
      ) {
        return current;
      }
      return {
        ...(current || {}),
        [identityKey]: snapshot,
      };
    });
  }, []);
  const clearViewportSnapshot = useCallback((identityKey) => {
    if (!identityKey) return;
    setChartViewportSnapshots((current) => {
      const next = { ...(current || {}) };
      if (!deleteMarketGridViewportSnapshots(next, identityKey)) return current;
      return next;
    });
  }, []);
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
      const handlePointerMove = (moveEvent) => {
        lastClientX = moveEvent.clientX;
        lastClientY = moveEvent.clientY;
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
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
    const currentSlot = slots[slotIndex];
    const nextSlot = hydrateMiniChartSlot(
      { ...currentSlot, ...patch },
      defaults[slotIndex],
    );
    const previousViewportIdentity = buildMarketGridViewportIdentity(
      slotIndex,
      currentSlot,
    );
    const nextViewportIdentity = buildMarketGridViewportIdentity(
      slotIndex,
      nextSlot,
    );
    if (previousViewportIdentity !== nextViewportIdentity) {
      clearViewportSnapshot(previousViewportIdentity);
    }
    setSlots((current) =>
      current.map((slot, index) =>
        index === slotIndex
          ? hydrateMiniChartSlot({ ...slot, ...patch }, defaults[index])
          : slot,
      ),
    );
  };
  const updateSlotTimeframe = (slotIndex, tf) => {
    setChartViewportSnapshots((current) => {
      const next = { ...(current || {}) };
      slots.forEach((slot, index) => {
        if (syncTimeframes || index === slotIndex) {
          deleteMarketGridViewportSnapshots(
            next,
            buildMarketGridViewportIdentity(index, slot),
          );
        }
      });
      return next;
    });
    setSlots((current) =>
      current.map((slot, index) =>
        syncTimeframes || index === slotIndex
          ? hydrateMiniChartSlot({ ...slot, tf }, defaults[index])
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

    clearViewportSnapshot(buildMarketGridViewportIdentity(targetIndex, currentSlot));
    if (forcePrimarySlot && sourceIndex >= 0 && sourceIndex !== targetIndex) {
      clearViewportSnapshot(buildMarketGridViewportIdentity(sourceIndex, slots[sourceIndex]));
    }
    rememberSearchRow(normalizedActiveSym);
    setSlots((current) => {
      const sourceSlot = sourceIndex >= 0 ? current[sourceIndex] : null;
      const targetSlot = current[targetIndex] || null;
      return current.map((slot, index) => {
        if (index === targetIndex) {
          return hydrateMiniChartSlot(
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
          return hydrateMiniChartSlot(targetSlot, defaults[index]);
        }
        return slot;
      });
    });
  }, [
    activeSym,
    clearViewportSnapshot,
    defaults,
    externalSelection?.n,
    externalSelection?.sym,
    layout,
    slots,
    soloSlotIndex,
    visibleSlotEntries,
  ]);
  const focusedLabel =
    layout === "1x1"
      ? visibleSlotEntries[0]?.slot?.ticker || activeSym
      : `${cfg.count} visible`;

  return (
    <Card
      noPad
      data-testid="market-chart-grid"
      style={{ flexShrink: 0, overflow: "visible" }}
    >
      <div
        style={{
          padding: sp(denseGrid ? "5px 8px" : "6px 10px"),
          borderBottom: `1px solid ${T.border}`,
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
              fontWeight: 700,
              fontFamily: T.display,
              color: T.textSec,
              letterSpacing: "0.04em",
            }}
          >
            CHARTS
          </span>
          <span
            style={{
              fontSize: fs(9),
              color: T.textMuted,
              fontFamily: T.mono,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {syncTimeframes ? "sync tf" : "independent"} · broker-backed bars ·{" "}
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
          <button
            type="button"
            onClick={resetGridCardScale}
            disabled={gridScaleResetDisabled}
            style={{
              padding: sp("3px 8px"),
              fontSize: fs(9),
              fontFamily: T.mono,
              fontWeight: 700,
              background: gridScaleResetDisabled ? T.bg3 : "rgba(255,255,255,0.08)",
              color: gridScaleResetDisabled ? T.textMuted : T.text,
              border: "none",
              borderRadius: 0,
              cursor: gridScaleResetDisabled ? "default" : "pointer",
              letterSpacing: "0.04em",
              opacity: gridScaleResetDisabled ? 0.55 : 1,
            }}
          >
            RESET SIZE
          </button>
          <button
            type="button"
            onClick={resetGridChartViews}
            data-testid="market-chart-reset-views"
            style={{
              padding: sp("3px 8px"),
              fontSize: fs(9),
              fontFamily: T.mono,
              fontWeight: 700,
              background: "rgba(255,255,255,0.08)",
              color: T.text,
              border: "none",
              borderRadius: 0,
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            RESET VIEWS
          </button>
          <button
            type="button"
            onClick={() => {
              setSyncTimeframes((current) => {
                const next = !current;
                if (next) {
                  const anchorTf = visibleSlotEntries[0]?.slot?.tf || "15m";
                  setChartViewportSnapshots({});
                  setSlots((slotList) =>
                    slotList.map((slot, index) =>
                      hydrateMiniChartSlot(
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
              fontSize: fs(9),
              fontFamily: T.mono,
              fontWeight: 700,
              background: syncTimeframes ? T.accent : T.bg3,
              color: syncTimeframes ? "#fff" : T.textDim,
              border: "none",
              borderRadius: 0,
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            SYNC TF
          </button>
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: sp(denseGrid ? 1 : 2),
              background: T.bg3,
              borderRadius: 0,
            }}
          >
            {Object.keys(MULTI_CHART_LAYOUTS).map((key) => (
              <AppTooltip key={key} content={`${MULTI_CHART_LAYOUTS[key].count} charts`}><button
                key={key}
                onClick={() => setLayout(key)}
                style={{
                  padding: sp("3px 8px"),
                  fontSize: fs(9),
                  fontFamily: T.mono,
                  fontWeight: 700,
                  background: layout === key ? T.accent : "transparent",
                  color: layout === key ? "#fff" : T.textDim,
                  border: "none",
                  borderRadius: 0,
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
          {visibleSlotEntries.map(({ slot, index }) => {
            const viewportIdentityKey = buildMarketGridViewportRevisionIdentity(
              index,
              slot,
              chartViewportResetRevision,
            );
            return (
              <MiniChartCell
                key={`market-chart-slot-${index}-${chartViewportResetRevision}`}
                dataTestId={`market-mini-chart-${index}`}
                slot={slot}
                quote={quotesBySymbol[slot.ticker]}
                premiumFlowSummary={premiumFlowBySymbol[normalizeTickerSymbol(slot.ticker)]}
                chartEvents={chartEventsBySymbol[normalizeTickerSymbol(slot.ticker)] || []}
                premiumFlowStatus={chartFlowStatus}
                premiumFlowProviderSummary={chartFlowProviderSummary}
                isActive={slot.ticker === activeSym}
                dense={denseGrid}
                compactFlow={compactPremiumFlow}
                stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
                chartViewportIdentityKey={viewportIdentityKey}
                viewportSnapshot={chartViewportSnapshots[viewportIdentityKey] || null}
                onViewportSnapshotChange={(snapshot) =>
                  rememberViewportSnapshot(viewportIdentityKey, snapshot)
                }
                onResetViewport={() => clearViewportSnapshot(viewportIdentityKey)}
                favoriteTimeframes={miniFavoriteTimeframes}
                onToggleFavoriteTimeframe={toggleMiniFavoriteTimeframe}
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
                onChangeStudies={(studies) => updateSlot(index, { studies })}
                onChangeRayReplicaSettings={(rayReplicaSettings) =>
                  updateSlot(index, { rayReplicaSettings })
                }
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
                ? T.accent
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
                        ? `0 0 0 1px ${T.bg}, 0 0 12px rgba(91,140,255,0.35)`
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
                ? T.accent
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
                        ? `0 0 0 1px ${T.bg}, 0 0 12px rgba(91,140,255,0.35)`
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
                      borderRadius: 999,
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
                        borderRadius: 999,
                        background: isActive
                          ? T.accent
                          : isHovered
                            ? gridResizeHoverColor
                            : "rgba(166, 174, 182, 0.48)",
                        boxShadow: isActive
                          ? `0 0 0 1px ${T.bg}, 0 0 14px rgba(91,140,255,0.4)`
                          : isHovered
                            ? `0 0 0 1px ${T.bg}`
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
