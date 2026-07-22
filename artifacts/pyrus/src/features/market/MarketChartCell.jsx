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
  GEX_ZERO_GAMMA_MODE_SNAPSHOT,
  useGexZeroGamma,
  useGexZeroGammaReferenceLine,
} from "../gex/useGexZeroGamma.js";
import { GEX_PROJECTION_MODE_SNAPSHOT } from "../gex/useGexProjection.js";
import { resolveMarketChartGexProjectionEnabled } from "../gex/gexProjectionCoverage.js";
import { ensureTradeTickerInfo } from "../platform/runtimeTickerStore";
import { normalizeTickerSymbol } from "../platform/tickerIdentity";
import { WATCHLIST } from "./marketReferenceData";
import {
  isMarketChartInteractiveTarget,
  isMarketChartPlotTarget,
} from "./chartInteractionSelectors.js";
import { MarketChartPremiumFlowIndicator } from "./MarketChartPremiumFlowIndicator.jsx";
import { CSS_COLOR, cssColorMix, RADII, T, dim, sp } from "../../lib/uiTokens.jsx";
import { Skeleton } from "../../components/platform/primitives.jsx";
import { TradeEquityPanel } from "../trade/TradeEquityPanel.jsx";
import {
  LazyMarketChartTickerSearch,
  preloadMarketChartTickerSearch,
  scheduleChartTickerSearchPreload,
} from "../platform/tickerSearch/chartTickerSearchLoader.js";

const MARKET_CHART_TIMEFRAMES = getChartTimeframeValues("primary");

export const preloadMarketChartRuntime = () => undefined;

const MARKET_CHART_CELL_CHROME_CSS = `
.market-chart-cell [data-chart-frame-placement^="market-compact"] [data-chart-toolbar-density],
.market-chart-cell [data-chart-frame-placement^="market-compact"] [data-chart-toolbar-density] > div,
.market-chart-cell [data-chart-frame-placement^="market-compact"] button {
  opacity: 0.68;
  filter: saturate(0.72);
}

.market-chart-cell [data-chart-frame-placement^="market-compact"] [data-chart-toolbar-density] svg,
.market-chart-cell [data-chart-frame-placement^="market-compact"] button svg {
  transform: scale(0.86);
  transform-origin: center;
}

.market-chart-cell [data-chart-frame-placement^="market-compact"]:hover [data-chart-toolbar-density],
.market-chart-cell [data-chart-frame-placement^="market-compact"]:focus-within [data-chart-toolbar-density],
.market-chart-cell [data-chart-frame-placement^="market-compact"] button:hover,
.market-chart-cell [data-chart-frame-placement^="market-compact"] button:focus-visible {
  opacity: 1;
  filter: none;
}
`;

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
    aria-live="polite"
    style={{
      minHeight: dim(220),
      borderRadius: dim(RADII.xs),
      background: CSS_COLOR.bg1,
      border: `1px solid ${CSS_COLOR.border}`,
      boxSizing: "border-box",
      padding: sp(12),
      display: "grid",
      gridTemplateRows: "auto 1fr",
      gap: sp(10),
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(8),
        color: CSS_COLOR.textMuted,
        fontFamily: T.sans,
        fontSize: dim(10),
        textTransform: "uppercase",
      }}
    >
      <span>Loading search</span>
      <Skeleton width={dim(76)} height={dim(9)} />
    </div>
    <div style={{ display: "grid", gap: sp(8), alignContent: "start" }}>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          style={{
            display: "grid",
            gridTemplateColumns: `${dim(32)}px 1fr ${dim(54)}px`,
            gap: sp(8),
            alignItems: "center",
            padding: sp("8px 0"),
          }}
        >
          <Skeleton width={dim(24)} height={dim(24)} radius={RADII.pill} />
          <span>
            <Skeleton
              width={`${68 - index * 8}%`}
              height={dim(10)}
              style={{ marginBottom: sp(6) }}
            />
            <Skeleton width={`${86 - index * 9}%`} height={dim(8)} />
          </span>
          <Skeleton width={dim(48)} height={dim(10)} />
        </div>
      ))}
    </div>
  </div>
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
  recentTickerRows = [],
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
  const chartGexProjectionEnabled = resolveMarketChartGexProjectionEnabled({
    ticker,
    historicalDataEnabled,
  });
  const gexZeroGamma = useGexZeroGamma(ticker, {
    enabled: chartGexOverlayEnabled,
    mode: GEX_ZERO_GAMMA_MODE_SNAPSHOT,
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

  useEffect(() => {
    if (!historicalDataEnabled) {
      return undefined;
    }
    return scheduleChartTickerSearchPreload(preloadMarketChartTickerSearch);
  }, [historicalDataEnabled]);

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
      className="market-chart-cell"
      data-active={isActive ? "true" : "false"}
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
      <style>{MARKET_CHART_CELL_CHROME_CSS}</style>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {historicalDataEnabled ? (
          <>
            <TradeEquityPanel
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
                    : "market-compact-active"
                  : dense
                    ? "market-compact-passive"
                    : "workspace-passive"
              }
              surfaceUiStateKey={`market-spot-chart:${slotId}:${timeframe}`}
              viewportLayoutKey={chartViewportLayoutKey}
              searchOpen={searchOpen}
              onSearchOpenChange={setSearchOpen}
              onSearchIntent={preloadMarketChartTickerSearch}
              searchContent={
                searchOpen ? (
                  <Suspense fallback={<MarketChartTickerSearchFallback />}>
                    <LazyMarketChartTickerSearch
                      open={searchOpen}
                      ticker={ticker}
                      recentTickerRows={recentTickerRows}
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
              gexProjectionMode={GEX_PROJECTION_MODE_SNAPSHOT}
              crosshairSyncGroupId={crosshairSyncGroupId}
              crosshairSyncInstanceId={crosshairSyncInstanceId}
            />
            <MarketChartReadyProbe onReady={onReady} readyKey={readyKey} />
          </>
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
