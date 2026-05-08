import {
  useCallback,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetNews,
  useGetResearchEarningsCalendar,
} from "@workspace/api-client-react";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import { useMarketAlertsSnapshot } from "../features/platform/marketAlertsStore";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  useMarketFlowSnapshotForStoreKey,
} from "../features/platform/marketFlowStore";
import { useSignalMonitorSnapshot } from "../features/platform/signalMonitorStore";
import { MultiChartGrid } from "../features/market/MultiChartGrid.jsx";
import { MarketActivityPanel } from "../features/market/MarketActivityPanel";
import {
  MACRO_TICKERS,
  RATES_PROXIES,
  SECTORS,
  buildRatesProxySummary,
  buildTrackedBreadthSummary,
} from "../features/market/marketReferenceData";
import { normalizeTickerSymbol } from "../features/platform/tickerIdentity";
import {
  Badge,
  Card,
  CardTitle,
  DataUnavailableState,
} from "../components/platform/primitives.jsx";
import { _initialState, persistState } from "../lib/workspaceState";
import {
  clampNumber,
  fmtCompactNumber,
  fmtM,
  formatCalendarMeta,
  formatIsoDate,
  formatRelativeTimeShort,
  formatSignedPercent,
  isFiniteNumber,
  mapNewsSentimentToScore,
} from "../lib/formatters";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  getCurrentTheme,
  sp,
} from "../lib/uiTokens";
import {
  joinMotionClasses,
  motionRowStyle,
} from "../lib/motion";
import { MarketIdentityInline } from "../features/platform/marketIdentity";
import { AppTooltip } from "@/components/ui/tooltip";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";


const MemoMultiChartGrid = memo(function MemoMultiChartGrid(props) {
  return <MultiChartGrid {...props} />;
});

const MARKET_PANEL_RETRY_DELAYS_MS = [750, 1_500, 3_000, 5_000, 8_000];

const TRADINGVIEW_HEATMAP_SCRIPT =
  "https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js";

const TradingViewStockHeatmapWidget = memo(function TradingViewStockHeatmapWidget() {
  const containerRef = useRef(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const colorTheme = getCurrentTheme() === "light" ? "light" : "dark";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    setLoadFailed(false);
    container.innerHTML = "";

    const widgetMount = document.createElement("div");
    widgetMount.className = "tradingview-widget-container__widget";
    widgetMount.style.height = "calc(100% - 16px)";
    widgetMount.style.width = "100%";

    const copyright = document.createElement("div");
    copyright.className = "tradingview-widget-copyright";
    copyright.style.cssText = [
      `color: ${T.textDim}`,
      `font: 700 ${fs(8)}px ${T.mono}`,
      "height: 16px",
      "line-height: 16px",
      "padding: 0 8px",
      "text-transform: uppercase",
    ].join(";");
    copyright.innerHTML =
      '<a href="https://www.tradingview.com/heatmap/stock/" rel="noopener nofollow" target="_blank" style="color: inherit; text-decoration: none;">Stock Heatmap</a> by TradingView';

    const script = document.createElement("script");
    script.src = TRADINGVIEW_HEATMAP_SCRIPT;
    script.type = "text/javascript";
    script.async = true;
    script.onerror = () => setLoadFailed(true);
    script.innerHTML = JSON.stringify({
      exchanges: [],
      dataSource: "SPX500",
      grouping: "sector",
      blockSize: "market_cap_basic",
      blockColor: "change",
      locale: "en",
      symbolUrl: "",
      colorTheme,
      hasTopBar: false,
      isDataSetEnabled: false,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      width: "100%",
      height: "100%",
    });

    container.appendChild(widgetMount);
    container.appendChild(copyright);
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [colorTheme]);

  return (
    <div
      style={{
        position: "relative",
        height: dim(236),
        minHeight: dim(220),
        background: T.bg0,
        overflow: "hidden",
      }}
    >
      <div
        ref={containerRef}
        className="tradingview-widget-container"
        style={{ height: "100%", width: "100%" }}
      />
      {loadFailed && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: sp(16),
            background: T.bg1,
          }}
        >
          <DataUnavailableState
            title="TradingView heatmap unavailable"
            detail="The external heatmap widget could not be loaded from TradingView."
          />
        </div>
      )}
    </div>
  );
});

const MarketActivityPanelContainer = memo(function MarketActivityPanelContainer({
  isVisible,
  highlightedUnusualFlow,
  newsItems,
  calendarItems,
  onSymClick,
  onSignalAction,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
  onChangeMonitorWatchlist,
  watchlists,
  unusualThreshold,
  onChangeUnusualThreshold,
  flowStatus,
  flowProviderSummary,
  flowSnapshotSource,
}) {
  const signalMonitorSnapshot = useSignalMonitorSnapshot({
    subscribeToUpdates: isVisible,
  });
  const marketAlertsSnapshot = useMarketAlertsSnapshot({
    subscribeToUpdates: isVisible,
  });

  return (
    <MarketActivityPanel
      notifications={marketAlertsSnapshot.items}
      highlightedUnusualFlow={highlightedUnusualFlow}
      signalEvents={signalMonitorSnapshot.events || []}
      signalStates={signalMonitorSnapshot.states || []}
      signalMonitorProfile={signalMonitorSnapshot.profile || null}
      signalMonitorPending={Boolean(signalMonitorSnapshot.pending)}
      signalMonitorDegraded={Boolean(signalMonitorSnapshot.degraded)}
      watchlists={watchlists}
      newsItems={newsItems}
      calendarItems={calendarItems}
      onSymClick={onSymClick}
      onSignalAction={onSignalAction}
      onScanNow={onScanNow}
      onToggleMonitor={onToggleMonitor}
      onChangeMonitorTimeframe={onChangeMonitorTimeframe}
      onChangeMonitorWatchlist={onChangeMonitorWatchlist}
      unusualThreshold={unusualThreshold}
      onChangeUnusualThreshold={onChangeUnusualThreshold}
      flowStatus={flowStatus}
      flowProviderSummary={flowProviderSummary}
      flowSnapshotSource={flowSnapshotSource}
      appliedUnusualThreshold={
        Number.isFinite(unusualThreshold) ? unusualThreshold : null
      }
      appliedUnusualThresholdConsistent
    />
  );
});

export const MarketScreen = ({
  sym,
  marketSymPing,
  onSymClick,
  onChartFocus,
  symbols = [],
  signalSuggestionSymbols = [],
  isVisible = false,
  researchConfigured = false,
  stockAggregateStreamingEnabled = false,
  onSignalAction,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
  onChangeMonitorWatchlist,
  watchlists = [],
}) => {
  const queryClient = useQueryClient();
  const marketWorkspaceRef = useRef(null);
  const [marketWorkspaceWidth, setMarketWorkspaceWidth] = useState(0);
  const [activityPanelWidth, setActivityPanelWidth] = useState(() =>
    Number.isFinite(_initialState.marketActivityPanelWidth)
      ? clampNumber(_initialState.marketActivityPanelWidth, 320, 720)
      : 420,
  );
  const [unusualThreshold, setUnusualThreshold] = useState(() => {
    const stored = _initialState.marketUnusualThreshold;
    return Number.isFinite(stored) && stored > 0
      ? clampNumber(stored, 0.1, 100)
      : 1;
  });
  const [marketChartRetryRevision, setMarketChartRetryRevision] = useState(0);
  useEffect(() => {
    persistState({ marketActivityPanelWidth: activityPanelWidth });
  }, [activityPanelWidth]);
  useEffect(() => {
    persistState({ marketUnusualThreshold: unusualThreshold });
  }, [unusualThreshold]);
  useEffect(() => {
    const element = marketWorkspaceRef.current;
    if (!element) {
      return undefined;
    }

    let frame = 0;
    const measure = (width) => {
      const nextWidth = Math.round(
        Number.isFinite(width) ? width : element.clientWidth || 0,
      );
      setMarketWorkspaceWidth((current) =>
        current === nextWidth ? current : nextWidth,
      );
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => measure();
      window.addEventListener("resize", handleResize);
      return () => {
        window.removeEventListener("resize", handleResize);
      };
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        measure(entry?.contentRect?.width);
      });
    });

    observer.observe(element);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  const handleChangeUnusualThreshold = useCallback((next) => {
    if (!Number.isFinite(next) || next <= 0) return;
    setUnusualThreshold(clampNumber(next, 0.1, 100));
  }, []);
  const marketChartResetKey = useMemo(
    () => `${sym || ""}:${symbols.join(",")}:${isVisible ? "visible" : "hidden"}`,
    [isVisible, sym, symbols],
  );
  const handleMarketPanelRetry = useCallback(
    ({ label } = {}) => {
      if (label !== "chart-grid") {
        return;
      }
      setMarketChartRetryRevision((current) => current + 1);
      queryClient.invalidateQueries({ queryKey: ["market-mini-bars"] });
      queryClient.invalidateQueries({ queryKey: ["display-chart-price-bars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/snapshot"] });
      queryClient.refetchQueries({
        queryKey: ["market-mini-bars"],
        type: "active",
      });
      queryClient.refetchQueries({
        queryKey: ["/api/quotes/snapshot"],
        type: "active",
      });
    },
    [queryClient],
  );
  const handleStartActivityPanelResize = useCallback(
    (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = activityPanelWidth;
      const handlePointerMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        setActivityPanelWidth(clampNumber(startWidth - delta, 320, 720));
      };
      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [activityPanelWidth],
  );
  const flowSnapshot = useMarketFlowSnapshotForStoreKey(
    BROAD_MARKET_FLOW_STORE_KEY,
    {
      subscribe: isVisible,
    },
  );
  const {
    putCall,
    sectorFlow,
    flowStatus,
    flowEvents,
    providerSummary: flowProviderSummary,
  } = flowSnapshot;
  const popularTickers = useMemo(() => {
    const bySymbol = new Map();
    for (const event of flowEvents || []) {
      const symbol = (event?.ticker || event?.underlying)?.toUpperCase?.();
      if (!symbol) continue;
      const current = bySymbol.get(symbol) || { symbol, count: 0, premium: 0 };
      current.count += 1;
      current.premium += Number.isFinite(event?.premium) ? event.premium : 0;
      bySymbol.set(symbol, current);
    }
    return Array.from(bySymbol.values())
      .sort((left, right) => right.count - left.count || right.premium - left.premium)
      .map((entry) => entry.symbol)
      .slice(0, 5);
  }, [flowEvents]);
  const stablePopularTickers = useMemo(
    () => popularTickers,
    [popularTickers.join(",")],
  );
  const calendarWindow = useMemo(() => {
    const from = new Date();
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 14);

    return {
      from: formatIsoDate(from),
      to: formatIsoDate(to),
    };
  }, []);
  const newsQuery = useGetNews(
    { limit: 6 },
    {
      query: {
        enabled: isVisible,
        staleTime: 60_000,
        refetchInterval: isVisible ? 60_000 : false,
        retry: false,
      },
    },
  );
  const earningsQuery = useGetResearchEarningsCalendar(calendarWindow, {
    query: {
      enabled: Boolean(
        isVisible &&
          researchConfigured &&
          calendarWindow.from &&
          calendarWindow.to,
      ),
      staleTime: 300_000,
      refetchInterval: isVisible ? 300_000 : false,
      retry: false,
    },
  });
  useRuntimeWorkloadFlag("market:news", isVisible, {
    kind: "poll",
    label: "Market news",
    detail: "60s",
    priority: 6,
  });
  useRuntimeWorkloadFlag("market:earnings", isVisible && researchConfigured, {
    kind: "poll",
    label: "Market earnings",
    detail: "300s",
    priority: 7,
  });
  const breadth = buildTrackedBreadthSummary();
  const ratesSummary = buildRatesProxySummary();
  const volatilityProxy =
    MACRO_TICKERS.find((item) => item.sym === "VIXY") || MACRO_TICKERS[0];
  const putCallBullish = isFiniteNumber(putCall.total) ? putCall.total <= 1 : null;
  const upPct = isFiniteNumber(breadth.advancePct) ? breadth.advancePct : 0;
  const downPct = breadth.total ? 100 - upPct : 0;
  const stackActivityPanel =
    marketWorkspaceWidth > 0 &&
    marketWorkspaceWidth < activityPanelWidth + dim(760) + dim(24);
  const highlightedUnusualFlow = useMemo(
    () =>
      (Array.isArray(flowEvents) ? flowEvents : [])
        .filter((event) => {
          if (!event.isUnusual) {
            return false;
          }
          if (!Number.isFinite(unusualThreshold) || unusualThreshold <= 0) {
            return true;
          }
          return (event.unusualScore || 0) >= unusualThreshold;
        })
        .slice(0, 12),
    [flowEvents, unusualThreshold],
  );
  const chartFlowUnusualThreshold =
    Number.isFinite(unusualThreshold) && unusualThreshold > 0 && unusualThreshold !== 1
      ? unusualThreshold
      : undefined;
  const newsItems = useMemo(() => {
    const articles = newsQuery.data?.articles || [];
    return articles.map((article) => ({
      id: article.id,
      text: article.title,
      time: formatRelativeTimeShort(article.publishedAt),
      publishedAt: article.publishedAt,
      tag:
        article.tickers?.[0] ||
        article.publisher?.name?.slice(0, 8)?.toUpperCase() ||
        "NEWS",
      s: mapNewsSentimentToScore(article.sentiment),
      articleUrl: article.articleUrl,
      publisher: article.publisher?.name || null,
    }));
  }, [newsQuery.data]);
  const calendarItems = useMemo(() => {
    const entries = earningsQuery.data?.entries || [];

    if (!researchConfigured || !entries.length) {
      return [];
    }

    const deduped = [];
    const seen = new Set();

    entries
      .filter((entry) => entry?.symbol && entry?.date)
      .sort((left, right) => {
        const leftValue = left.date
          ? Date.parse(left.date)
          : Number.POSITIVE_INFINITY;
        const rightValue = right.date
          ? Date.parse(right.date)
          : Number.POSITIVE_INFINITY;
        return leftValue - rightValue;
      })
      .forEach((entry) => {
        const key = `${entry.symbol}_${entry.date}_${entry.time || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push({
          id: key,
          label: `${entry.symbol} earnings`,
          symbol: entry.symbol,
          date: formatCalendarMeta(entry.date, entry.time),
          dateTime: /^\d/.test(String(entry.time || ""))
            ? `${entry.date}T${entry.time}`
            : entry.date,
          type: "earnings",
        });
      });

    return deduped.slice(0, 7);
  }, [earningsQuery.data, researchConfigured]);
  const newsStatusLabel = newsQuery.data?.articles?.length
    ? "live · news"
    : newsQuery.isError
      ? "offline"
      : newsQuery.isPending
        ? "loading"
        : "empty";
  const calendarStatusLabel = researchConfigured
    ? earningsQuery.data?.entries?.length
      ? "earnings · live"
      : earningsQuery.isError
        ? "offline"
        : earningsQuery.isPending
          ? "loading"
      : "empty"
    : "research off";
  const marketModuleGridTemplate =
    marketWorkspaceWidth > 0 && marketWorkspaceWidth < dim(1060)
      ? "minmax(0, 1fr)"
      : "minmax(0, 1.35fr) minmax(300px, 0.8fr)";
  const marketDetailGridTemplate =
    marketWorkspaceWidth > 0 && marketWorkspaceWidth < dim(1180)
      ? "repeat(2, minmax(0, 1fr))"
      : "repeat(4, minmax(0, 1fr))";
  const marketMovers = (() => {
    const rows = [
      ...SECTORS.map((item) => ({ ...item, group: "Sector ETF" })),
      ...MACRO_TICKERS.map((item) => ({ ...item, group: item.label || "Macro" })),
      ...RATES_PROXIES.map((item) => ({ ...item, group: item.label || "Rates" })),
    ]
      .map((item) => ({
        sym: item.sym,
        group: item.group || item.name || item.label || "Market",
        change: item.pct ?? item.chg,
      }))
      .filter((item) => isFiniteNumber(item.change));

    return {
      leaders: [...rows].sort((left, right) => right.change - left.change).slice(0, 5),
      laggards: [...rows].sort((left, right) => left.change - right.change).slice(0, 5),
    };
  })();
  const strongestSectorFlow = sectorFlow.length
    ? [...sectorFlow]
        .map((sector) => ({ ...sector, net: sector.calls - sector.puts }))
        .sort((left, right) => Math.abs(right.net) - Math.abs(left.net))[0]
    : null;
  const marketPulseItems = [
    {
      label: "Breadth",
      value: breadth.total ? `${breadth.advancers}/${breadth.total}` : MISSING_VALUE,
      sub: isFiniteNumber(breadth.advancePct)
        ? `${breadth.advancePct.toFixed(0)}% advancing`
        : "quotes pending",
      tone: isFiniteNumber(breadth.advancePct)
        ? breadth.advancePct >= 55
          ? T.green
          : breadth.advancePct <= 45
            ? T.red
            : T.amber
        : T.textDim,
    },
    {
      label: "Put / Call",
      value: isFiniteNumber(putCall.total) ? putCall.total.toFixed(2) : MISSING_VALUE,
      sub: putCallBullish == null ? "neutral unavailable" : putCallBullish ? "call skew" : "put skew",
      tone: putCallBullish == null ? T.textDim : putCallBullish ? T.green : T.red,
    },
    {
      label: "Vol proxy",
      value: volatilityProxy?.sym || MISSING_VALUE,
      sub: formatSignedPercent(volatilityProxy?.pct),
      tone: !isFiniteNumber(volatilityProxy?.pct)
        ? T.textDim
        : volatilityProxy.pct <= 0
          ? T.green
          : T.amber,
    },
    {
      label: "Sector flow",
      value: strongestSectorFlow?.sector || MISSING_VALUE,
      sub: strongestSectorFlow ? `${strongestSectorFlow.net >= 0 ? "+" : "-"}${fmtM(Math.abs(strongestSectorFlow.net))}` : "flow pending",
      tone: !strongestSectorFlow ? T.textDim : strongestSectorFlow.net >= 0 ? T.green : T.red,
    },
  ];

  if (!isVisible) {
    return (
      <div
        data-testid="market-screen-suspended"
        style={{ display: "none" }}
      />
    );
  }

  return (
    <div
      className="ra-panel-enter"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: sp(8),
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {/* ── ROW 1: Chart workspace + activity feed ── */}
        <div
          ref={marketWorkspaceRef}
          data-testid="market-workspace"
          data-activity-layout={stackActivityPanel ? "stacked" : "side-by-side"}
          style={{
            display: "grid",
            gridTemplateColumns: stackActivityPanel
              ? "minmax(0, 1fr)"
              : `minmax(0, 1fr) 6px ${activityPanelWidth}px`,
            gap: 6,
            alignItems: "start",
          }}
        >
          {isVisible ? (
            <PlatformErrorBoundary
              label="Market chart grid"
              resetKeys={[marketChartResetKey]}
              onReset={() =>
                handleMarketPanelRetry({
                  label: "chart-grid",
                  automatic: false,
                })
              }
              autoResetDelaysMs={MARKET_PANEL_RETRY_DELAYS_MS}
              onAutoReset={({ attempt, error }) =>
                handleMarketPanelRetry({
                  label: "chart-grid",
                  attempt,
                  automatic: true,
                  error,
                })
              }
              minHeight={dim(340)}
            >
              <MemoMultiChartGrid
                key={`market-chart-grid-${marketChartResetKey}-${marketChartRetryRevision}`}
                activeSym={sym}
                externalSelection={marketSymPing}
                onSymClick={onChartFocus || onSymClick}
                watchlistSymbols={symbols}
                popularTickers={stablePopularTickers}
                signalSuggestionSymbols={signalSuggestionSymbols}
                stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
                isVisible={isVisible}
                unusualThreshold={chartFlowUnusualThreshold}
              />
            </PlatformErrorBoundary>
          ) : (
            <div style={{ minHeight: dim(340) }} />
          )}
          {!stackActivityPanel ? (
            <AppTooltip content="Drag to resize activity panel"><div
              role="separator"
              data-testid="market-activity-resize-separator"
              aria-label="Resize activity and notifications panel"
              tabIndex={0}
              className="ra-resize-handle"
              onPointerDown={handleStartActivityPanelResize}
              style={{
                alignSelf: "stretch",
                minHeight: dim(340),
                cursor: "col-resize",
                background: `linear-gradient(180deg, transparent, ${T.borderLight}, transparent)`,
                borderLeft: `1px solid ${T.border}55`,
                borderRight: `1px solid ${T.border}55`,
              }}
            /></AppTooltip>
          ) : null}
          <div
            data-testid="market-activity-panel"
            style={{
              minWidth: 0,
              minHeight: 0,
              height: "fit-content",
              maxHeight: stackActivityPanel ? undefined : "calc(100vh - 122px)",
              position: stackActivityPanel ? "relative" : "sticky",
              top: stackActivityPanel ? undefined : sp(8),
            }}
          >
            <PlatformErrorBoundary
              label="Market activity panel"
              resetKeys={[marketChartResetKey]}
              onReset={() =>
                handleMarketPanelRetry({
                  label: "activity-panel",
                  automatic: false,
                })
              }
              autoResetDelaysMs={MARKET_PANEL_RETRY_DELAYS_MS}
              onAutoReset={({ attempt, error }) =>
                handleMarketPanelRetry({
                  label: "activity-panel",
                  attempt,
                  automatic: true,
                  error,
                })
              }
              minHeight={dim(340)}
            >
              <MarketActivityPanelContainer
                isVisible={isVisible}
                highlightedUnusualFlow={highlightedUnusualFlow}
                newsItems={newsItems}
                calendarItems={calendarItems}
                onSymClick={onSymClick}
                onSignalAction={onSignalAction}
                onScanNow={onScanNow}
                onToggleMonitor={onToggleMonitor}
                onChangeMonitorTimeframe={onChangeMonitorTimeframe}
                onChangeMonitorWatchlist={onChangeMonitorWatchlist}
                watchlists={watchlists}
                unusualThreshold={unusualThreshold}
                onChangeUnusualThreshold={handleChangeUnusualThreshold}
                flowStatus={flowStatus}
                flowProviderSummary={flowProviderSummary}
                flowSnapshotSource="broad-scanner"
              />
            </PlatformErrorBoundary>
          </div>
        </div>

        {/* Market intelligence: TradingView heatmap, pulse, flow, leadership */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: marketModuleGridTemplate,
            gap: 6,
            alignItems: "start",
          }}
        >
          <Card className="ra-panel-enter" noPad data-testid="market-compact-heatmap">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: sp("6px 10px"),
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <CardTitle>Market Heat</CardTitle>
            </div>
            <TradingViewStockHeatmapWidget />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: sp(8),
                padding: sp("5px 10px 7px"),
                color: T.textDim,
                fontFamily: T.mono,
                fontSize: fs(8),
              }}
            >
              <span>TradingView SPX500 heatmap</span>
              <span>external widget</span>
            </div>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                minHeight: dim(18),
                color: T.textDim,
                fontFamily: T.mono,
                fontSize: fs(8),
                fontWeight: 400,
                textTransform: "uppercase",
              }}
            >
              <span>Market Pulse</span>
              <span>breadth · skew · vol · flow</span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: marketDetailGridTemplate,
                gap: 6,
              }}
            >
              {marketPulseItems.map((item) => (
                <Card key={item.label} style={{ padding: "6px 8px", minHeight: dim(56) }}>
                  <div
                    style={{
                      color: T.textDim,
                      fontFamily: T.mono,
                      fontSize: fs(8),
                      fontWeight: 400,
                      textTransform: "uppercase",
                    }}
                  >
                    {item.label}
                  </div>
                  <div
                    style={{
                      color: item.tone,
                      fontFamily: T.mono,
                      fontSize: fs(15),
                      fontWeight: 400,
                      marginTop: sp(4),
                    }}
                  >
                    {item.value}
                  </div>
                  <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), marginTop: sp(1) }}>
                    {item.sub}
                  </div>
                </Card>
              ))}
            </div>

            <Card className="ra-panel-enter" style={{ padding: "8px 10px" }}>
              <CardTitle
                right={
                  <span
                    style={{
                      color: flowStatus === "live" ? T.accent : T.textMuted,
                      fontFamily: T.mono,
                      fontSize: fs(8),
                    }}
                  >
                    {flowStatus === "live" ? "option premium" : `flow ${flowStatus}`}
                  </span>
                }
              >
                Sector Flow
              </CardTitle>
              {sectorFlow.length ? (
                (() => {
                  const absMax = Math.max(
                    1,
                    ...sectorFlow.map((sector) => Math.abs(sector.calls - sector.puts)),
                  );
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: sp(10) }}>
                      {[...sectorFlow]
                        .map((sector) => ({ ...sector, net: sector.calls - sector.puts }))
                        .sort((left, right) => Math.abs(right.net) - Math.abs(left.net))
                        .slice(0, 10)
                        .map((sector, index) => {
                          const widthPct = (Math.abs(sector.net) / absMax) * 50;
                          return (
                            <button
                              key={sector.sector}
                              type="button"
                              onClick={() => {
                                const match = SECTORS.find((item) =>
                                  item.name?.toLowerCase?.().includes(sector.sector.toLowerCase()),
                                );
                                if (match?.sym) onSymClick?.(match.sym);
                              }}
                              className="ra-row-enter ra-interactive"
                              style={{
                                ...motionRowStyle(index, 10, 100),
                                display: "grid",
                                gridTemplateColumns: "82px minmax(0, 1fr) 56px",
                                gap: sp(6),
                                alignItems: "center",
                                border: "none",
                                background: "transparent",
                                padding: sp("2px 0"),
                                cursor: "pointer",
                              }}
                            >
                              <span style={{ color: T.textSec, fontFamily: T.mono, fontSize: fs(8), fontWeight: 400, textAlign: "left" }}>
                                {sector.sector}
                              </span>
                              <span style={{ position: "relative", height: dim(8), background: T.bg3 }}>
                                <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: dim(1), background: T.borderLight }} />
                                <span
                                  style={{
                                    position: "absolute",
                                    top: 0,
                                    bottom: 0,
                                    left: sector.net >= 0 ? "50%" : undefined,
                                    right: sector.net < 0 ? "50%" : undefined,
                                    width: `${widthPct}%`,
                                    background: sector.net >= 0 ? T.green : T.red,
                                  }}
                                />
                              </span>
                              <span style={{ color: sector.net >= 0 ? T.green : T.red, fontFamily: T.mono, fontSize: fs(8), fontWeight: 400, textAlign: "right" }}>
                                {sector.net >= 0 ? "+" : "-"}
                                {fmtM(Math.abs(sector.net))}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  );
                })()
              ) : (
                <DataUnavailableState
                  title="No live sector flow"
                  detail={
                    flowStatus === "loading"
                      ? "Waiting on live options flow snapshots for the tracked market symbols."
                      : "Sector rotation is hidden until a live options flow provider returns current data."
                  }
                />
              )}
            </Card>

            <Card className="ra-panel-enter" style={{ padding: "8px 10px" }}>
              <CardTitle>Leadership / Weakness</CardTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(10) }}>
                {[
                  ["Leaders", marketMovers.leaders, T.green],
                  ["Laggards", marketMovers.laggards, T.red],
                ].map(([label, rows, color]) => (
                  <div key={label} style={{ minWidth: 0 }}>
                    <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), fontWeight: 400, marginBottom: sp(3) }}>
                      {label.toUpperCase()}
                    </div>
                    {rows.map((row, index) => (
                      <button
                        key={`${label}_${row.sym}_${index}`}
                        type="button"
                        onClick={() => onSymClick?.(row.sym)}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "58px minmax(0, 1fr) 48px",
                          gap: sp(5),
                          width: "100%",
                          border: "none",
                          borderTop: index ? `1px solid ${T.border}55` : "none",
                          background: "transparent",
                          padding: sp("4px 0"),
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span style={{ color, fontFamily: T.mono, fontSize: fs(9), fontWeight: 400 }}>{row.sym}</span>
                        <span style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.group}
                        </span>
                        <span style={{ color, fontFamily: T.mono, fontSize: fs(8), fontWeight: 400, textAlign: "right" }}>
                          {formatSignedPercent(row.change)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              marketWorkspaceWidth > 0 && marketWorkspaceWidth < dim(1080)
                ? "minmax(0, 1fr)"
                : "minmax(0, 1.2fr) minmax(260px, 0.7fr) minmax(300px, 0.9fr)",
            gap: 6,
          }}
        >
          <Card style={{ padding: "7px 10px" }}>
            <CardTitle>Rates Proxies</CardTitle>
            <div style={{ display: "grid", gap: sp(4) }}>
              {RATES_PROXIES.map((item, index) => {
                const pos = isFiniteNumber(item.pct) ? item.pct >= 0 : null;
                const width = isFiniteNumber(item.pct)
                  ? Math.max(6, Math.min(100, Math.abs(item.pct) * 48))
                  : 0;
                return (
                  <div
                    key={item.sym}
                    className="ra-row-enter"
                    style={{
                      ...motionRowStyle(index, 10, 90),
                      display: "grid",
                      gridTemplateColumns: "46px 72px minmax(0, 1fr) 44px",
                      alignItems: "center",
                      gap: sp(5),
                      fontSize: fs(8),
                      fontFamily: T.mono,
                    }}
                  >
                    <span style={{ color: T.textDim }}>{item.term}</span>
                    <MarketIdentityInline ticker={item.sym} size={12} showChips={false} />
                    <span style={{ height: dim(6), position: "relative", background: T.bg3 }}>
                      <span
                        className="ra-bar-fill"
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: 0,
                          width: `${width}%`,
                          background: pos == null ? T.textMuted : pos ? T.green : T.red,
                          opacity: 0.85,
                        }}
                      />
                    </span>
                    <span style={{ color: pos == null ? T.textDim : pos ? T.green : T.red, textAlign: "right", fontWeight: 400 }}>
                      {formatSignedPercent(item.pct)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card style={{ padding: "7px 10px" }}>
            <CardTitle>Breadth</CardTitle>
            <div style={{ display: "flex", alignItems: "center", gap: sp(6), marginBottom: sp(6) }}>
              <span style={{ color: T.green, fontFamily: T.mono, fontSize: fs(12), fontWeight: 400 }}>
                {breadth.total ? breadth.advancers : MISSING_VALUE}
              </span>
              <span style={{ flex: 1, display: "flex", height: dim(8), background: T.bg3, overflow: "hidden" }}>
                <span style={{ width: `${upPct}%`, background: T.green }} />
                <span style={{ width: `${downPct}%`, background: T.red }} />
              </span>
              <span style={{ color: T.red, fontFamily: T.mono, fontSize: fs(12), fontWeight: 400 }}>
                {breadth.total ? breadth.decliners : MISSING_VALUE}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(3), fontFamily: T.mono, fontSize: fs(8) }}>
              {[
                ["5D+", isFiniteNumber(breadth.positive5dPct) ? `${breadth.positive5dPct.toFixed(0)}%` : MISSING_VALUE],
                ["Sectors+", breadth.sectorCoverage ? `${breadth.positiveSectors}/${breadth.sectorCoverage}` : MISSING_VALUE],
                ["Lead", breadth.leader?.sym || MISSING_VALUE],
                ["Lag", breadth.laggard?.sym || MISSING_VALUE],
              ].map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", background: `${T.bg3}55`, padding: sp("3px 5px") }}>
                  <span style={{ color: T.textDim }}>{label}</span>
                  <span style={{ color: T.textSec, fontWeight: 400 }}>{value}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card
            className="ra-panel-enter"
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "6px 8px",
            }}
          >
            <CardTitle right={<Badge color={T.purple}>REGIME</Badge>}>
              Market Read
            </CardTitle>
            <div
              style={{
                fontSize: fs(10),
                fontFamily: T.sans,
                color: T.textSec,
                lineHeight: 1.45,
                padding: sp("6px 8px"),
                background: T.bg0,
                border: `1px solid ${T.border}`,
              }}
            >
              <span style={{ color: marketPulseItems[0].tone }}>▸</span>{" "}
              Breadth is {breadth.total ? `${breadth.advancers}/${breadth.total}` : "unavailable"} with{" "}
              {isFiniteNumber(breadth.positive5dPct) ? `${breadth.positive5dPct.toFixed(0)}%` : MISSING_VALUE} positive over five sessions.{"\n"}
              <span style={{ color: marketPulseItems[1].tone }}>▸</span>{" "}
              Put/call is {isFiniteNumber(putCall.total) ? putCall.total.toFixed(2) : MISSING_VALUE};{" "}
              {putCallBullish == null ? "skew unavailable" : putCallBullish ? "risk appetite is firmer" : "protection demand is elevated"}.{"\n"}
              <span style={{ color: marketPulseItems[2].tone }}>▸</span>{" "}
              Vol/rates proxies: {volatilityProxy?.sym || MISSING_VALUE} {formatSignedPercent(volatilityProxy?.pct)}, rates led by {ratesSummary.leader?.sym || MISSING_VALUE}.
            </div>
          </Card>
        </div>

        {/* ── ROW 5: News + Calendar + AI ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              marketWorkspaceWidth > 0 && marketWorkspaceWidth < dim(980)
                ? "minmax(0, 1fr)"
                : "minmax(0, 1.4fr) minmax(260px, 0.7fr)",
            gap: 6,
          }}
        >
          <Card className="ra-panel-enter" style={{ padding: "6px 10px" }}>
            <CardTitle
              right={
                <span
                  style={{
                    fontSize: fs(7),
                    color:
                      newsStatusLabel === "live · news"
                        ? T.accent
                        : T.textDim,
                    fontFamily: T.mono,
                  }}
                >
                  {newsStatusLabel}
                </span>
              }
            >
              News
            </CardTitle>
            {newsItems.length ? (
              newsItems.map((item, index) => (
                <AppTooltip key={item.id} content={item.publisher || undefined}><div
                  key={item.id}
                  className={joinMotionClasses(
                    "ra-row-enter",
                    item.articleUrl && "ra-interactive",
                  )}
                  style={{
                    ...motionRowStyle(index, 10, 120),
                    display: "flex",
                    gap: sp(5),
                    padding: sp("3px 0"),
                    alignItems: "flex-start",
                    borderBottom:
                      index < newsItems.length - 1
                        ? `1px solid ${T.border}06`
                        : "none",
                    cursor: item.articleUrl ? "pointer" : "default",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = T.bg3)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                  onClick={() => {
                    if (!item.articleUrl || typeof window === "undefined")
                      return;
                    window.open(
                      item.articleUrl,
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                >
                  <Badge color={T.accent}>{item.tag}</Badge>
                  <div
                    style={{
                      width: dim(4),
                      height: dim(4),
                      borderRadius: "50%",
                      background:
                        item.s === 1
                          ? T.green
                          : item.s === -1
                            ? T.red
                            : T.textDim,
                      marginTop: sp(4),
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontSize: fs(10),
                      color: T.textSec,
                      fontFamily: T.sans,
                      lineHeight: 1.4,
                    }}
                  >
                    {item.text}
                  </span>
                  <span
                    style={{
                      fontSize: fs(8),
                      color: T.textMuted,
                      fontFamily: T.mono,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.time}
                  </span>
                </div></AppTooltip>
              ))
            ) : (
              <DataUnavailableState
                title="No live news feed"
                detail={
                  newsStatusLabel === "loading"
                    ? "Waiting on the live news provider."
                    : "The news card only shows provider-backed headlines now; no authored fallback feed is rendered."
                }
              />
            )}
          </Card>
          <Card className="ra-panel-enter" style={{ padding: "6px 10px" }}>
            <CardTitle
              right={
                <span
                  style={{
                    fontSize: fs(7),
                    color:
                      calendarStatusLabel === "earnings · live"
                        ? T.accent
                        : T.textDim,
                    fontFamily: T.mono,
                  }}
                >
                  {calendarStatusLabel}
                </span>
              }
            >
              Calendar
            </CardTitle>
            {calendarItems.length ? (
              calendarItems.map((ev, i) => {
                const tc =
                  ev.type === "fomc" || ev.type === "cpi"
                    ? T.amber
                    : ev.type === "earnings"
                      ? T.green
                      : ev.type === "holiday"
                        ? T.red
                        : T.accent;
                return (
                  <div
                    key={ev.id}
                    className="ra-row-enter"
                    style={{
                      ...motionRowStyle(i, 10, 120),
                      display: "flex",
                      alignItems: "center",
                      gap: sp(4),
                      padding: sp("3px 0"),
                      borderBottom:
                        i < calendarItems.length - 1
                          ? `1px solid ${T.border}06`
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        width: dim(2),
                        height: dim(16),
                        borderRadius: dim(1),
                        background: tc,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: fs(10),
                          fontWeight: 400,
                          fontFamily: T.sans,
                          color: T.text,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ev.label}
                      </div>
                      <div
                        style={{
                          fontSize: fs(8),
                          color: T.textMuted,
                          fontFamily: T.mono,
                        }}
                      >
                        {ev.date}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <DataUnavailableState
                title="No live calendar data"
                detail={
                  calendarStatusLabel === "loading"
                    ? "Waiting on the earnings calendar provider."
                    : researchConfigured
                      ? "The calendar is empty because no live entries were returned for the current window."
                      : "Research calendar access is not configured for this environment."
                }
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default MarketScreen;
