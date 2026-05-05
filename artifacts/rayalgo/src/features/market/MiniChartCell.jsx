import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getChartTimeframeValues, normalizeChartTimeframe } from "../charting/timeframes";
import { TradeEquityPanel } from "../trade/TradeEquityPanel.jsx";
import { ensureTradeTickerInfo } from "../platform/runtimeTickerStore";
import { useSignalMonitorStateForSymbol } from "../platform/signalMonitorStore";
import { MarketIdentityMark } from "../platform/marketIdentity";
import { MiniChartTickerSearch } from "../platform/tickerSearch/TickerSearch.jsx";
import { normalizeTickerSymbol } from "../platform/tickerIdentity";
import { DEFAULT_WATCHLIST_BY_SYMBOL, WATCHLIST } from "./marketReferenceData";
import { MiniChartPremiumFlowIndicator } from "./MiniChartPremiumFlowIndicator.jsx";
import { T } from "../../lib/uiTokens";

const MARKET_CHART_TIMEFRAMES = getChartTimeframeValues("primary");

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

export const MiniChartCell = ({
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
  stockAggregateStreamingEnabled = false,
  dataTestId,
  linkChip = null,
}) => {
  const ticker = normalizeTickerSymbol(slot?.ticker) || WATCHLIST[0]?.sym || "SPY";
  const hydratedTimeframe = normalizeChartTimeframe(slot?.tf);
  const timeframe = MARKET_CHART_TIMEFRAMES.includes(hydratedTimeframe)
    ? hydratedTimeframe
    : "5m";
  const signalState = useSignalMonitorStateForSymbol(ticker);
  const fallbackInfo =
    DEFAULT_WATCHLIST_BY_SYMBOL[ticker] ||
    WATCHLIST.find((item) => item.sym === ticker) ||
    WATCHLIST[0];
  const [pendingTickerSelection, setPendingTickerSelection] = useState(null);
  const pendingPointerRef = useRef(null);
  const suppressNextClickRef = useRef(false);
  const searchOpen = Boolean(tickerSearchOpen);
  const setSearchOpen = useCallback(
    (open) => onTickerSearchOpenChange?.(Boolean(open)),
    [onTickerSearchOpenChange],
  );
  const chartIdentityItem = useMemo(
    () => ({
      ...(slot?.searchResult || {}),
      ticker,
      name: slot?.searchResult?.name || fallbackInfo?.name || ticker,
      market: slot?.market || "stocks",
      exchangeDisplay:
        slot?.exchange ||
        slot?.searchResult?.exchangeDisplay ||
        slot?.searchResult?.primaryExchange,
      normalizedExchangeMic:
        slot?.searchResult?.normalizedExchangeMic || slot?.exchange || null,
      logoUrl: slot?.searchResult?.logoUrl || null,
      countryCode: slot?.searchResult?.countryCode || null,
      exchangeCountryCode: slot?.searchResult?.exchangeCountryCode || null,
      sector: slot?.searchResult?.sector || null,
      industry: slot?.searchResult?.industry || null,
    }),
    [fallbackInfo?.name, slot, ticker],
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

  const handleFramePointerDown = useCallback((event) => {
    if (event.button != null && event.button !== 0) {
      return;
    }
    if (isMarketChartShellControlTarget(event.target)) {
      return;
    }
    pendingPointerRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }, []);
  const handleFramePointerMove = useCallback((event) => {
    const pending = pendingPointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) {
      return;
    }
    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (distance > MARKET_CHART_CLICK_MOVE_TOLERANCE) {
      suppressNextClickRef.current = true;
    }
  }, []);
  const handleFramePointerUp = useCallback((event) => {
    const pending = pendingPointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) {
      return;
    }
    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (distance > MARKET_CHART_CLICK_MOVE_TOLERANCE) {
      suppressNextClickRef.current = true;
    } else if (
      !isActive &&
      typeof onFocus === "function" &&
      !isMarketChartShellControlTarget(event.target)
    ) {
      suppressNextClickRef.current = true;
      onFocus(ticker, { timeframe });
    }
    pendingPointerRef.current = null;
  }, [isActive, onFocus, ticker, timeframe]);
  const handleFramePointerCancel = useCallback(() => {
    pendingPointerRef.current = null;
    suppressNextClickRef.current = true;
  }, []);
  const handleFrameClick = useCallback(
    (event) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      if (isActive || typeof onFocus !== "function") {
        return;
      }
      if (isMarketChartShellControlTarget(event.target)) {
        return;
      }
      onFocus(ticker, { timeframe });
    },
    [isActive, onFocus, ticker, timeframe],
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
  const signalDirection = signalState?.currentSignalDirection;
  const hasSignalBorder =
    signalState?.fresh &&
    signalState?.status === "ok" &&
    (signalDirection === "buy" || signalDirection === "sell");
  const signalBorderColor =
    signalDirection === "buy" ? T.green : signalDirection === "sell" ? T.red : T.border;

  return (
    <div
      onPointerDownCapture={handleFramePointerDown}
      onPointerMoveCapture={handleFramePointerMove}
      onPointerUpCapture={handleFramePointerUp}
      onPointerCancelCapture={handleFramePointerCancel}
      onClick={handleFrameClick}
      onDoubleClick={handleDoubleClick}
      style={{
        position: "relative",
        height: "100%",
        boxSizing: "border-box",
        border: `1px solid ${hasSignalBorder ? signalBorderColor : isActive ? T.accent : "transparent"}`,
        cursor: "default",
        transition: "border-color 0.15s, box-shadow 0.15s",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: hasSignalBorder
          ? `0 0 0 1px ${signalBorderColor}55, 0 0 18px ${signalBorderColor}30`
          : isActive
            ? `0 0 0 1px ${T.accent}33`
            : "none",
      }}
    >
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div
          data-chart-control-root
          style={{
            position: "absolute",
            top: dense ? 6 : 8,
            right: dense ? 6 : 8,
            zIndex: 30,
            pointerEvents: "auto",
          }}
        >
          <MarketIdentityMark
            item={chartIdentityItem}
            size={dense ? 16 : 20}
            showMarketIcon
            style={{ borderColor: isActive ? T.accent : T.border }}
          />
        </div>
        <TradeEquityPanel
          ticker={ticker}
          flowEvents={flowEvents}
          historicalDataEnabled
          stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
          dataTestId={dataTestId}
          compact={dense}
          surfaceUiStateKey="market-spot-chart"
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
          searchContent={
            <MiniChartTickerSearch
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
                ensureTradeTickerInfo(nextTicker, result?.name || nextTicker);
                setPendingTickerSelection({ ticker: nextTicker, result });
              }}
            />
          }
          workspaceChart={{ timeframe }}
          onWorkspaceChartChange={handleWorkspaceChartChange}
          linkChip={linkChip}
        />
      </div>
      <MiniChartPremiumFlowIndicator
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
