import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getChartTimeframeValues, normalizeChartTimeframe } from "../charting/timeframes";
import {
  useGexZeroGamma,
  useGexZeroGammaReferenceLine,
} from "../gex/useGexZeroGamma.js";
import { ensureTradeTickerInfo } from "../platform/runtimeTickerStore";
import { normalizeTickerSymbol } from "../platform/tickerIdentity";
import { WATCHLIST } from "./marketReferenceData";
import { MarketChartPremiumFlowIndicator } from "./MarketChartPremiumFlowIndicator.jsx";
import { CSS_COLOR, cssColorMix, RADII, T, dim, sp } from "../../lib/uiTokens.jsx";
import { lazyWithRetry, preloadDynamicImport } from "../../lib/dynamicImport";

const MARKET_CHART_TIMEFRAMES = getChartTimeframeValues("primary");

const loadTradeEquityPanelModule = () =>
  import("../trade/TradeEquityPanel.jsx").then((module) => ({
    default: module.TradeEquityPanel,
  }));

export const preloadMarketChartRuntime = () => {
  preloadDynamicImport(loadTradeEquityPanelModule, { label: "TradeEquityPanel" });
};

const LazyTradeEquityPanel = lazyWithRetry(
  loadTradeEquityPanelModule,
  { label: "TradeEquityPanel" },
);

const LazyMarketChartTickerSearch = lazyWithRetry(
  () =>
    import("../platform/tickerSearch/TickerSearch.jsx").then((module) => ({
      default: module.MarketChartTickerSearch,
    })),
  { label: "MarketChartTickerSearch" },
);

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
const isMarketChartShellControlTarget = (target) =>
  isMarketChartInteractiveTarget(target) && !isMarketChartPlotTarget(target);
const MARKET_CHART_CLICK_MOVE_TOLERANCE = 6;

const MarketChartPanelFallback = ({ dataTestId }) => (
  <div
    data-testid={dataTestId ? `${dataTestId}-surface` : undefined}
    data-chart-instance-create-count="0"
    style={{
      height: "100%",
      minHeight: 0,
      borderRadius: dim(RADII.xs),
      background: CSS_COLOR.bg1,
      display: "grid",
      gridTemplateRows: "auto 1fr",
      gap: sp(6),
      padding: sp(8),
      boxSizing: "border-box",
    }}
  >
    <div
      style={{
        height: dim(18),
        width: "42%",
        borderRadius: dim(RADII.xs),
        background: CSS_COLOR.bg3,
      }}
    />
    <div
      style={{
        minHeight: 0,
        borderRadius: dim(RADII.xs),
        background: cssColorMix(CSS_COLOR.text, 3),
      }}
    />
  </div>
);

const MarketChartTickerSearchFallback = () => (
  <div
    data-testid="ticker-search-popover-loading"
    style={{
      minHeight: dim(220),
      borderRadius: dim(RADII.xs),
      background: CSS_COLOR.bg1,
    }}
  />
);

const MarketChartReadyProbe = ({ onReady, readyKey }) => {
  useEffect(() => {
    if (!onReady) return undefined;
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      onReady();
      return undefined;
    }
    const frameId = window.requestAnimationFrame(() => {
      onReady();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [onReady, readyKey]);
  return null;
};

export const MarketChartCell = ({
  slot,
  premiumFlowSummary,
  premiumFlowStatus,
  premiumFlowProviderSummary,
  flowEvents = [],
  onFocus,
  onEnterSoloMode,
  onChangeTicker,
  onChangeTimeframe,
  recentTickers = [],
  recentTickerRows = [],
  watchlistSymbols = [],
  popularTickers = [],
  smartSuggestionSymbols = [],
  signalSuggestionSymbols = [],
  onRememberTicker,
  tickerSearchOpen = false,
  onTickerSearchOpenChange,
  isActive,
  dense = false,
  compactFlow = false,
  historicalDataEnabled = true,
  stockAggregateStreamingEnabled = false,
  dataTestId,
  slotId = dataTestId || "market-chart",
  chartViewportLayoutKey = null,
  crosshairSyncGroupId = null,
  crosshairSyncInstanceId = null,
  fullFrame = false,
  onReady,
  readyKey = "",
}) => {
  const ticker = normalizeTickerSymbol(slot?.ticker) || WATCHLIST[0]?.sym || "SPY";
  const hydratedTimeframe = normalizeChartTimeframe(slot?.tf);
  const timeframe = MARKET_CHART_TIMEFRAMES.includes(hydratedTimeframe)
    ? hydratedTimeframe
    : "5m";
  const chartGexOverlayEnabled = Boolean(ticker && historicalDataEnabled);
  const chartGexProjectionEnabled = Boolean(
    ticker && historicalDataEnabled && (isActive || fullFrame),
  );
  const gexZeroGamma = useGexZeroGamma(ticker, {
    enabled: chartGexOverlayEnabled,
  });
  const gexZeroGammaReferenceLine =
    useGexZeroGammaReferenceLine(gexZeroGamma);
  const gexOverlay = useMemo(
    () => ({
      zeroGammaLine: gexZeroGammaReferenceLine,
    }),
    [gexZeroGammaReferenceLine],
  );
  const [pendingTickerSelection, setPendingTickerSelection] = useState(null);
  const pendingPointerRef = useRef(null);
  const pendingMouseRef = useRef(null);
  const suppressNextClickRef = useRef(false);
  const suppressNextClickTimerRef = useRef(null);
  const pointerWindowCleanupRef = useRef(null);
  const mouseWindowCleanupRef = useRef(null);
  const searchOpen = Boolean(tickerSearchOpen);
  const setSearchOpen = useCallback(
    (open) => onTickerSearchOpenChange?.(Boolean(open)),
    [onTickerSearchOpenChange],
  );
  const rememberTicker = useCallback(
    (nextTickerOrRow) => {
      const normalized =
        typeof nextTickerOrRow === "string"
          ? normalizeTickerSymbol(nextTickerOrRow)
          : normalizeTickerSymbol(nextTickerOrRow?.ticker);
      if (!normalized) {
        return;
      }
      onRememberTicker?.(nextTickerOrRow);
    },
    [onRememberTicker],
  );

  useEffect(() => {
    if (!pendingTickerSelection) {
      return;
    }
    setSearchOpen(false);
    rememberTicker(pendingTickerSelection.result);
    onChangeTicker?.(pendingTickerSelection.ticker, pendingTickerSelection.result);
    setPendingTickerSelection(null);
  }, [onChangeTicker, pendingTickerSelection, rememberTicker, setSearchOpen]);

  const clearFrameClickSuppression = useCallback(() => {
    suppressNextClickRef.current = false;
    if (
      typeof window !== "undefined" &&
      suppressNextClickTimerRef.current != null
    ) {
      window.clearTimeout(suppressNextClickTimerRef.current);
    }
    suppressNextClickTimerRef.current = null;
  }, []);

  const armFrameClickSuppression = useCallback(() => {
    suppressNextClickRef.current = true;
    if (typeof window === "undefined") {
      return;
    }
    if (suppressNextClickTimerRef.current != null) {
      window.clearTimeout(suppressNextClickTimerRef.current);
    }
    suppressNextClickTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = false;
      suppressNextClickTimerRef.current = null;
    }, 250);
  }, []);

  const cleanupFramePointerWindowListeners = useCallback(() => {
    pointerWindowCleanupRef.current?.();
    pointerWindowCleanupRef.current = null;
  }, []);

  const cleanupFrameMouseWindowListeners = useCallback(() => {
    mouseWindowCleanupRef.current?.();
    mouseWindowCleanupRef.current = null;
  }, []);

  useEffect(
    () => () => {
      clearFrameClickSuppression();
      cleanupFramePointerWindowListeners();
      cleanupFrameMouseWindowListeners();
    },
    [
      cleanupFrameMouseWindowListeners,
      cleanupFramePointerWindowListeners,
      clearFrameClickSuppression,
    ],
  );

  const handleFramePointerDown = useCallback((event) => {
    if (event.button != null && event.button !== 0) {
      return;
    }
    if (isMarketChartShellControlTarget(event.target)) {
      return;
    }
    cleanupFramePointerWindowListeners();
    const pending = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedOnPlot: isMarketChartPlotTarget(event.target),
    };
    pendingPointerRef.current = pending;
    if (typeof window === "undefined") {
      return;
    }
    const pointerId = event.pointerId;
    const handleWindowPointerMove = (moveEvent) => {
      const current = pendingPointerRef.current;
      if (!current || current.pointerId !== pointerId) {
        return;
      }
      const distance = Math.hypot(
        moveEvent.clientX - current.x,
        moveEvent.clientY - current.y,
      );
      if (distance > MARKET_CHART_CLICK_MOVE_TOLERANCE) {
        current.dragged = true;
        armFrameClickSuppression();
      }
    };
    const handleWindowPointerEnd = (endEvent) => {
      const current = pendingPointerRef.current;
      if (current?.pointerId === pointerId) {
        const distance = Math.hypot(
          endEvent.clientX - current.x,
          endEvent.clientY - current.y,
        );
        if (current.dragged || distance > MARKET_CHART_CLICK_MOVE_TOLERANCE) {
          armFrameClickSuppression();
        } else if (
          !isActive &&
          typeof onFocus === "function" &&
          !isMarketChartShellControlTarget(endEvent.target)
        ) {
          armFrameClickSuppression();
          onFocus(ticker);
        }
      }
      pendingPointerRef.current = null;
      cleanupFramePointerWindowListeners();
    };
    window.addEventListener("pointermove", handleWindowPointerMove, true);
    window.addEventListener("pointerup", handleWindowPointerEnd, true);
    window.addEventListener("pointercancel", handleWindowPointerEnd, true);
    pointerWindowCleanupRef.current = () => {
      window.removeEventListener("pointermove", handleWindowPointerMove, true);
      window.removeEventListener("pointerup", handleWindowPointerEnd, true);
      window.removeEventListener("pointercancel", handleWindowPointerEnd, true);
    };
  }, [
    armFrameClickSuppression,
    cleanupFramePointerWindowListeners,
    isActive,
    onFocus,
    ticker,
  ]);
  const handleFramePointerMove = useCallback((event) => {
    const pending = pendingPointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) {
      return;
    }
    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (distance > MARKET_CHART_CLICK_MOVE_TOLERANCE) {
      armFrameClickSuppression();
    }
  }, [armFrameClickSuppression]);
  const handleFramePointerUp = useCallback((event) => {
    const pending = pendingPointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) {
      return;
    }
    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (distance > MARKET_CHART_CLICK_MOVE_TOLERANCE) {
      armFrameClickSuppression();
    } else if (
      !isActive &&
      typeof onFocus === "function" &&
      !pending.startedOnPlot &&
      !isMarketChartShellControlTarget(event.target)
    ) {
      armFrameClickSuppression();
      onFocus(ticker);
    }
    pendingPointerRef.current = null;
    cleanupFramePointerWindowListeners();
  }, [
    armFrameClickSuppression,
    cleanupFramePointerWindowListeners,
    isActive,
    onFocus,
    ticker,
  ]);
  const handleFramePointerCancel = useCallback(() => {
    pendingPointerRef.current = null;
    cleanupFramePointerWindowListeners();
    armFrameClickSuppression();
  }, [armFrameClickSuppression, cleanupFramePointerWindowListeners]);
  const handleFrameMouseDown = useCallback((event) => {
    if (event.button != null && event.button !== 0) {
      return;
    }
    if (isMarketChartShellControlTarget(event.target)) {
      return;
    }
    cleanupFrameMouseWindowListeners();
    const pending = {
      x: event.clientX,
      y: event.clientY,
      startedOnPlot: isMarketChartPlotTarget(event.target),
    };
    pendingMouseRef.current = pending;
    if (typeof window === "undefined") {
      return;
    }
    const handleWindowMouseMove = (moveEvent) => {
      const current = pendingMouseRef.current;
      if (!current) {
        return;
      }
      const distance = Math.hypot(
        moveEvent.clientX - current.x,
        moveEvent.clientY - current.y,
      );
      if (distance > MARKET_CHART_CLICK_MOVE_TOLERANCE) {
        current.dragged = true;
        armFrameClickSuppression();
      }
    };
    const handleWindowMouseEnd = (endEvent) => {
      const current = pendingMouseRef.current;
      if (current) {
        const distance = Math.hypot(
          endEvent.clientX - current.x,
          endEvent.clientY - current.y,
        );
        if (current.dragged || distance > MARKET_CHART_CLICK_MOVE_TOLERANCE) {
          armFrameClickSuppression();
        } else if (
          !isActive &&
          typeof onFocus === "function" &&
          !isMarketChartShellControlTarget(endEvent.target)
        ) {
          armFrameClickSuppression();
          onFocus(ticker);
        }
      }
      pendingMouseRef.current = null;
      cleanupFrameMouseWindowListeners();
    };
    window.addEventListener("mousemove", handleWindowMouseMove, true);
    window.addEventListener("mouseup", handleWindowMouseEnd, true);
    mouseWindowCleanupRef.current = () => {
      window.removeEventListener("mousemove", handleWindowMouseMove, true);
      window.removeEventListener("mouseup", handleWindowMouseEnd, true);
    };
  }, [
    armFrameClickSuppression,
    cleanupFrameMouseWindowListeners,
    isActive,
    onFocus,
    ticker,
  ]);
  const handleFrameMouseMove = useCallback((event) => {
    const pending = pendingMouseRef.current;
    if (!pending) {
      return;
    }
    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (distance > MARKET_CHART_CLICK_MOVE_TOLERANCE) {
      armFrameClickSuppression();
    }
  }, [armFrameClickSuppression]);
  const handleFrameMouseUp = useCallback((event) => {
    const pending = pendingMouseRef.current;
    if (!pending) {
      return;
    }
    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (distance > MARKET_CHART_CLICK_MOVE_TOLERANCE) {
      armFrameClickSuppression();
    }
    pendingMouseRef.current = null;
    cleanupFrameMouseWindowListeners();
  }, [armFrameClickSuppression, cleanupFrameMouseWindowListeners]);
  const handleFrameClick = useCallback(
    (event) => {
      if (suppressNextClickRef.current) {
        clearFrameClickSuppression();
        return;
      }
      if (isActive || typeof onFocus !== "function") {
        return;
      }
      if (isMarketChartShellControlTarget(event.target)) {
        return;
      }
      onFocus(ticker);
    },
    [clearFrameClickSuppression, isActive, onFocus, ticker],
  );
  const handleDoubleClick = useCallback(
    (event) => {
      if (isMarketChartShellControlTarget(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onEnterSoloMode?.(ticker);
    },
    [onEnterSoloMode, ticker],
  );
  const handleWorkspaceChartChange = useCallback(
    (nextChart) => {
      const nextTimeframe = normalizeChartTimeframe(nextChart?.timeframe);
      if (nextTimeframe && nextTimeframe !== timeframe) {
        onChangeTimeframe?.(nextTimeframe);
      }
    },
    [onChangeTimeframe, timeframe],
  );
  return (
    <div
      onPointerDownCapture={handleFramePointerDown}
      onPointerMoveCapture={handleFramePointerMove}
      onPointerUpCapture={handleFramePointerUp}
      onPointerCancelCapture={handleFramePointerCancel}
      onMouseDownCapture={handleFrameMouseDown}
      onMouseMoveCapture={handleFrameMouseMove}
      onMouseUpCapture={handleFrameMouseUp}
      onClick={handleFrameClick}
      onDoubleClick={handleDoubleClick}
      style={{
        position: "relative",
        height: "100%",
        boxSizing: "border-box",
        border: `1px solid ${isActive ? CSS_COLOR.accent : "transparent"}`,
        cursor: "default",
        transition: "border-color var(--ra-motion-fast), box-shadow var(--ra-motion-fast)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: isActive ? `0 0 0 1px ${cssColorMix(CSS_COLOR.accent, 20)}` : "none",
      }}
    >
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {historicalDataEnabled ? (
          <Suspense fallback={<MarketChartPanelFallback dataTestId={dataTestId} />}>
            <LazyTradeEquityPanel
              ticker={ticker}
              flowEvents={flowEvents}
              flowEventsSourceMode="provided"
              prewarmFavoriteTimeframesEnabled={false}
              historicalDataEnabled={historicalDataEnabled}
              stockAggregateStreamingEnabled={
                Boolean(historicalDataEnabled && stockAggregateStreamingEnabled)
              }
              dataTestId={dataTestId}
              compact={fullFrame ? dense : true}
              chartFramePlacement={
                isActive
                  ? fullFrame
                    ? "workspace"
                    : "compact-active"
                  : dense
                    ? "compact-passive"
                    : "workspace-passive"
              }
              surfaceUiStateKey={`market-spot-chart:${slotId}:${timeframe}`}
              viewportLayoutKey={chartViewportLayoutKey}
              searchOpen={searchOpen}
              onSearchOpenChange={setSearchOpen}
              searchContent={
                searchOpen ? (
                  <Suspense fallback={<MarketChartTickerSearchFallback />}>
                    <LazyMarketChartTickerSearch
                      open={searchOpen}
                      ticker={ticker}
                      recentTickerRows={recentTickerRows}
                      watchlistSymbols={watchlistSymbols}
                      popularTickers={popularTickers}
                      contextSymbols={recentTickers}
                      flowSuggestionSymbols={smartSuggestionSymbols}
                      signalSuggestionSymbols={signalSuggestionSymbols}
                      embedded
                      onClose={() => setSearchOpen(false)}
                      onSelectTicker={(result) => {
                        const nextTicker = normalizeTickerSymbol(result?.ticker);
                        if (!nextTicker) {
                          return;
                        }
                        ensureTradeTickerInfo(
                          nextTicker,
                          result?.name || nextTicker,
                        );
                        setPendingTickerSelection({ ticker: nextTicker, result });
                      }}
                    />
                  </Suspense>
                ) : (
                  <MarketChartTickerSearchFallback />
                )
              }
              workspaceChart={{ timeframe }}
              onWorkspaceChartChange={handleWorkspaceChartChange}
              gexOverlay={gexOverlay}
              gexProjectionEnabled={chartGexProjectionEnabled}
              crosshairSyncGroupId={crosshairSyncGroupId}
              crosshairSyncInstanceId={crosshairSyncInstanceId}
            />
            <MarketChartReadyProbe onReady={onReady} readyKey={readyKey} />
          </Suspense>
        ) : (
          <MarketChartPanelFallback dataTestId={dataTestId} />
        )}
      </div>
      <MarketChartPremiumFlowIndicator
        symbol={ticker}
        summary={premiumFlowSummary}
        flowStatus={premiumFlowStatus}
        providerSummary={premiumFlowProviderSummary}
        dense={dense}
        compact={compactFlow}
      />
    </div>
  );
};
