import {
  useCallback,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetNews,
  useGetResearchEarningsCalendar,
} from "@workspace/api-client-react";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  useMarketFlowSnapshotForStoreKey,
} from "../features/platform/marketFlowStore";
import {
  MACRO_TICKERS,
  RATES_PROXIES,
  SECTORS,
  WATCHLIST,
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
import {
  fmtM,
  formatCalendarMeta,
  formatIsoDate,
  formatRelativeTimeShort,
  formatSignedPercent,
  isFiniteNumber,
  mapNewsSentimentToScore,
} from "../lib/formatters";
import {
  CSS_COLOR,
  cssColorMix,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../lib/uiTokens.jsx";
import { responsiveFlags, useViewportSize } from "../lib/responsive";
import {
  joinMotionClasses,
  motionRowStyle,
} from "../lib/motion";
import { MarketIdentityInline } from "../features/platform/marketIdentity";
import { AppTooltip } from "@/components/ui/tooltip";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";
import { lazyWithRetry, preloadDynamicImport } from "../lib/dynamicImport";


const MARKET_PANEL_RETRY_DELAYS_MS = [750, 1_500, 3_000, 5_000, 8_000];

const loadRawMultiChartGridModule = () =>
  import("../features/market/MultiChartGrid.jsx");

const loadMultiChartGridModule = () =>
  loadRawMultiChartGridModule().then((module) => ({
    default: module.MultiChartGrid,
  }));

let marketChartModulesPreloadStarted = false;

export const preloadMarketChartModules = () => {
  if (marketChartModulesPreloadStarted) {
    return;
  }
  marketChartModulesPreloadStarted = true;
  preloadDynamicImport(loadMultiChartGridModule, { label: "MultiChartGrid" });
  void loadRawMultiChartGridModule()
    .then((module) => module.preloadMarketChartRuntime?.())
    .catch(() => {});
};

const LazyMultiChartGrid = lazyWithRetry(
  loadMultiChartGridModule,
  { label: "MultiChartGrid" },
);

const MemoMultiChartGrid = memo(function MemoMultiChartGrid(props) {
  return <LazyMultiChartGrid {...props} />;
});

if (typeof window !== "undefined") {
  preloadMarketChartModules();
}

const buildMarketChartFallbackSymbols = (symbols = []) => {
  const requestedSymbols = symbols
    .map((symbol) => normalizeTickerSymbol(symbol))
    .filter(Boolean);
  const fallbackSymbols = WATCHLIST.map((item) => normalizeTickerSymbol(item.sym))
    .filter(Boolean);
  return Array.from(new Set([...requestedSymbols, ...fallbackSymbols])).slice(0, 4);
};

const MarketChartGridFallback = ({ symbols = [], isPhone = false }) => {
  const fallbackSymbols = buildMarketChartFallbackSymbols(symbols);
  return (
    <Card
      data-testid="market-chart-grid-shell"
      style={{
        minHeight: dim(340),
        display: "grid",
        gridTemplateColumns: isPhone ? "1fr" : "repeat(2, minmax(0, 1fr))",
        gridAutoRows: "minmax(150px, 1fr)",
        gap: sp(6),
        padding: sp(6),
        overflow: "hidden",
      }}
    >
      {fallbackSymbols.map((symbol, index) => (
        <div
          key={`${symbol}-${index}`}
          data-testid="market-chart-grid-shell-cell"
          style={{
            minWidth: 0,
            minHeight: dim(150),
            display: "grid",
            gridTemplateRows: "auto 1fr",
            gap: sp(6),
            padding: sp(8),
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.sm),
            background: cssColorMix(CSS_COLOR.bg1, 88),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(6),
              minHeight: dim(18),
            }}
          >
            <span
              style={{
                color: CSS_COLOR.text,
                fontFamily: T.mono,
                fontSize: textSize("body"),
                fontWeight: FONT_WEIGHTS.medium,
              }}
            >
              {symbol}
            </span>
            <span
              style={{
                width: dim(46),
                height: dim(5),
                borderRadius: dim(RADII.pill),
                background: cssColorMix(CSS_COLOR.textMuted, 18),
              }}
            />
          </div>
          <div
            aria-hidden="true"
            style={{
              alignSelf: "stretch",
              display: "grid",
              alignItems: "end",
              gridTemplateColumns: "repeat(10, minmax(0, 1fr))",
              gap: sp(3),
              paddingTop: sp(12),
            }}
          >
            {Array.from({ length: 10 }).map((_, barIndex) => (
              <span
                key={barIndex}
                style={{
                  minHeight: dim(18 + ((barIndex * 17 + index * 11) % 72)),
                  borderRadius: dim(RADII.xs),
                  background:
                    barIndex % 3 === 0
                      ? cssColorMix(CSS_COLOR.accent, 18)
                      : cssColorMix(CSS_COLOR.textMuted, 12),
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
};

const MarketScreenInner = ({
  sym,
  marketSymPing,
  onSymClick,
  onChartFocus,
  symbols = [],
  signalSuggestionSymbols = [],
  isVisible = false,
  researchConfigured = false,
  stockAggregateStreamingEnabled = false,
  unusualThreshold = 1,
  onReadinessChange,
}) => {
  const queryClient = useQueryClient();
  const viewportSize = useViewportSize();
  const marketWorkspaceRef = useRef(null);
  const [marketWorkspaceWidth, setMarketWorkspaceWidth] = useState(0);
  const [marketChartRetryRevision, setMarketChartRetryRevision] = useState(0);
  const [chartGridReady, setChartGridReady] = useState(false);
  useEffect(() => {
    if (!isVisible) {
      setChartGridReady(false);
    }
  }, [isVisible]);
  useEffect(() => {
    onReadinessChange?.({
      criticalReady: Boolean(isVisible),
      derivedReady: Boolean(isVisible && chartGridReady),
      backgroundAllowed: Boolean(isVisible && chartGridReady),
    });
  }, [chartGridReady, isVisible, onReadinessChange]);
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
  const handleMarketChartGridReady = useCallback(() => {
    setChartGridReady(true);
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
      queryClient.invalidateQueries({ queryKey: ["market-chart-bars"] });
      queryClient.invalidateQueries({ queryKey: ["display-chart-price-bars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/snapshot"] });
      queryClient.refetchQueries({
        queryKey: ["market-chart-bars"],
        type: "active",
      });
      queryClient.refetchQueries({
        queryKey: ["/api/quotes/snapshot"],
        type: "active",
      });
    },
    [queryClient],
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
        enabled: Boolean(isVisible),
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
  useRuntimeWorkloadFlag("market:news", Boolean(isVisible), {
    kind: "poll",
    label: "Market news",
    detail: "60s",
    priority: 6,
  });
  useRuntimeWorkloadFlag("market:earnings", Boolean(isVisible && researchConfigured), {
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
  const marketLayoutFlags = responsiveFlags(marketWorkspaceWidth || viewportSize.width);
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
          ? CSS_COLOR.green
          : breadth.advancePct <= 45
            ? CSS_COLOR.red
            : CSS_COLOR.amber
        : CSS_COLOR.textDim,
    },
    {
      label: "Put / Call",
      value: isFiniteNumber(putCall.total) ? putCall.total.toFixed(2) : MISSING_VALUE,
      sub: putCallBullish == null ? "neutral unavailable" : putCallBullish ? "call skew" : "put skew",
      tone: putCallBullish == null ? CSS_COLOR.textDim : putCallBullish ? CSS_COLOR.green : CSS_COLOR.red,
    },
    {
      label: "Vol proxy",
      value: volatilityProxy?.sym || MISSING_VALUE,
      sub: formatSignedPercent(volatilityProxy?.pct),
      tone: !isFiniteNumber(volatilityProxy?.pct)
        ? CSS_COLOR.textDim
        : volatilityProxy.pct <= 0
          ? CSS_COLOR.green
          : CSS_COLOR.amber,
    },
    {
      label: "Sector flow",
      value: strongestSectorFlow?.sector || MISSING_VALUE,
      sub: strongestSectorFlow ? `${strongestSectorFlow.net >= 0 ? "+" : "-"}${fmtM(Math.abs(strongestSectorFlow.net))}` : "flow pending",
      tone: !strongestSectorFlow ? CSS_COLOR.textDim : strongestSectorFlow.net >= 0 ? CSS_COLOR.green : CSS_COLOR.red,
    },
  ];

  return (
    <div
      className="ra-panel-enter"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: CSS_COLOR.bg0,
      }}
    >
      <div
        className="ra-scroll-fade-y"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: sp(marketLayoutFlags.isPhone ? "8px 8px 18px" : "12px 20px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(marketLayoutFlags.isPhone ? 6 : 8),
          WebkitOverflowScrolling: marketLayoutFlags.isPhone ? "touch" : undefined,
        }}
      >
        {/* ── ROW 1: Chart workspace ── */}
        <div
          ref={marketWorkspaceRef}
          data-testid="market-workspace"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: sp(6),
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
              <Suspense
                fallback={
                  <MarketChartGridFallback
                    symbols={symbols}
                    isPhone={marketLayoutFlags.isPhone}
                  />
                }
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
                  onReady={handleMarketChartGridReady}
                />
              </Suspense>
            </PlatformErrorBoundary>
          ) : (
            <div style={{ minHeight: dim(340) }} />
          )}
        </div>

        {/* Market intelligence: pulse, flow, leadership */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                minHeight: dim(18),
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: textSize("body"),
                fontWeight: FONT_WEIGHTS.regular,
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
                gap: sp(6),
              }}
            >
              {marketPulseItems.map((item) => (
                <Card key={item.label} style={{ padding: sp("6px 8px"), minHeight: dim(48) }}>
                  <div
                    style={{
                      color: CSS_COLOR.textDim,
                      fontFamily: T.sans,
                      fontSize: textSize("body"),
                      fontWeight: FONT_WEIGHTS.regular,
                      textTransform: "uppercase",
                    }}
                  >
                    {item.label}
                  </div>
                  <div
                    style={{
                      color: item.tone,
                      fontFamily: T.sans,
                      fontSize: fs(15),
                      fontWeight: FONT_WEIGHTS.regular,
                      marginTop: sp(4),
                    }}
                  >
                    {item.value}
                  </div>
                  <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("body"), marginTop: sp(1) }}>
                    {item.sub}
                  </div>
                </Card>
              ))}
            </div>

            <Card className="ra-panel-enter" style={{ padding: sp("8px 10px") }}>
              <CardTitle
                right={
                  <span
                    style={{
                      color: flowStatus === "live" ? CSS_COLOR.accent : CSS_COLOR.textMuted,
                      fontFamily: T.sans,
                      fontSize: textSize("body"),
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
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: sp(6) }}>
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
                                gridTemplateColumns: `${dim(82)}px minmax(0, 1fr) ${dim(56)}px`,
                                gap: sp(6),
                                alignItems: "center",
                                border: "none",
                                background: "transparent",
                                padding: sp("2px 0"),
                                cursor: "pointer",
                              }}
                            >
                              <span style={{ color: CSS_COLOR.textSec, fontFamily: T.sans, fontSize: textSize("body"), fontWeight: FONT_WEIGHTS.regular, textAlign: "left" }}>
                                {sector.sector}
                              </span>
                              <span style={{ position: "relative", height: dim(8), background: `${cssColorMix(CSS_COLOR.textMuted, 12)}`, borderRadius: dim(RADII.pill) }}>
                                <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: dim(1), background: CSS_COLOR.borderLight }} />
                                <span
                                  style={{
                                    position: "absolute",
                                    top: 0,
                                    bottom: 0,
                                    left: sector.net >= 0 ? "50%" : undefined,
                                    right: sector.net < 0 ? "50%" : undefined,
                                    width: `${widthPct}%`,
                                    background: sector.net >= 0 ? CSS_COLOR.green : CSS_COLOR.red,
                                  }}
                                />
                              </span>
                              <span style={{ color: sector.net >= 0 ? CSS_COLOR.green : CSS_COLOR.red, fontFamily: T.sans, fontSize: textSize("body"), fontWeight: FONT_WEIGHTS.regular, textAlign: "right" }}>
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

            <Card className="ra-panel-enter" style={{ padding: sp("8px 10px") }}>
              <CardTitle>Leadership / Weakness</CardTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(8) }}>
                {[
                  ["Leaders", marketMovers.leaders, CSS_COLOR.green],
                  ["Laggards", marketMovers.laggards, CSS_COLOR.red],
                ].map(([label, rows, color]) => (
                  <div key={label} style={{ minWidth: 0 }}>
                    <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("body"), fontWeight: FONT_WEIGHTS.regular, marginBottom: sp(3) }}>
                      {label.toUpperCase()}
                    </div>
                    {rows.map((row, index) => (
                      <button
                        key={`${label}_${row.sym}_${index}`}
                        type="button"
                        onClick={() => onSymClick?.(row.sym)}
                        style={{
                          display: "grid",
                          gridTemplateColumns: `${dim(58)}px minmax(0, 1fr) ${dim(48)}px`,
                          gap: sp(5),
                          width: "100%",
                          border: "none",
                          borderTop: index ? `1px solid ${cssColorMix(CSS_COLOR.border, 33)}` : "none",
                          background: "transparent",
                          padding: sp("2px 0"),
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span style={{ color, fontFamily: T.sans, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.regular }}>{row.sym}</span>
                        <span style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("body"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.group}
                        </span>
                        <span style={{ color, fontFamily: T.sans, fontSize: textSize("body"), fontWeight: FONT_WEIGHTS.regular, textAlign: "right" }}>
                          {formatSignedPercent(row.change)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              marketWorkspaceWidth > 0 && marketWorkspaceWidth < dim(1080)
                ? "minmax(0, 1fr)"
                : "minmax(0, 1.2fr) minmax(260px, 0.7fr) minmax(300px, 0.9fr)",
            gap: sp(6),
          }}
        >
          <Card style={{ padding: sp("7px 10px") }}>
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
                      gridTemplateColumns: `${dim(46)}px ${dim(72)}px minmax(0, 1fr) ${dim(44)}px`,
                      alignItems: "center",
                      gap: sp(5),
                      fontSize: textSize("body"),
                      fontFamily: T.sans,
                    }}
                  >
                    <span style={{ color: CSS_COLOR.textDim }}>{item.term}</span>
                    <MarketIdentityInline ticker={item.sym} size={12} showChips={false} />
                    <span style={{ height: dim(6), position: "relative", background: `${cssColorMix(CSS_COLOR.textMuted, 12)}`, borderRadius: dim(RADII.pill) }}>
                      <span
                        className="ra-bar-fill"
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: 0,
                          width: `${width}%`,
                          background: pos == null ? CSS_COLOR.textMuted : pos ? CSS_COLOR.green : CSS_COLOR.red,
                          opacity: 0.85,
                        }}
                      />
                    </span>
                    <span style={{ color: pos == null ? CSS_COLOR.textDim : pos ? CSS_COLOR.green : CSS_COLOR.red, textAlign: "right", fontWeight: FONT_WEIGHTS.regular }}>
                      {formatSignedPercent(item.pct)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card style={{ padding: sp("7px 10px") }}>
            <CardTitle>Breadth</CardTitle>
            <div style={{ display: "flex", alignItems: "center", gap: sp(6), marginBottom: sp(6) }}>
              <span style={{ color: CSS_COLOR.green, fontFamily: T.sans, fontSize: fs(12), fontWeight: FONT_WEIGHTS.regular }}>
                {breadth.total ? breadth.advancers : MISSING_VALUE}
              </span>
              <span style={{ flex: 1, display: "flex", height: dim(8), background: CSS_COLOR.bg1, overflow: "hidden" }}>
                <span style={{ width: `${upPct}%`, background: CSS_COLOR.green }} />
                <span style={{ width: `${downPct}%`, background: CSS_COLOR.red }} />
              </span>
              <span style={{ color: CSS_COLOR.red, fontFamily: T.sans, fontSize: fs(12), fontWeight: FONT_WEIGHTS.regular }}>
                {breadth.total ? breadth.decliners : MISSING_VALUE}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(3), fontFamily: T.sans, fontSize: textSize("body") }}>
              {[
                ["5D+", isFiniteNumber(breadth.positive5dPct) ? `${breadth.positive5dPct.toFixed(0)}%` : MISSING_VALUE],
                ["Sectors+", breadth.sectorCoverage ? `${breadth.positiveSectors}/${breadth.sectorCoverage}` : MISSING_VALUE],
                ["Lead", breadth.leader?.sym || MISSING_VALUE],
                ["Lag", breadth.laggard?.sym || MISSING_VALUE],
              ].map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", background: `${cssColorMix(CSS_COLOR.bg3, 33)}`, padding: sp("3px 5px") }}>
                  <span style={{ color: CSS_COLOR.textDim }}>{label}</span>
                  <span style={{ color: CSS_COLOR.textSec, fontWeight: FONT_WEIGHTS.regular }}>{value}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card
            className="ra-panel-enter"
            style={{
              display: "flex",
              flexDirection: "column",
              padding: sp("6px 8px"),
            }}
          >
            <CardTitle right={<Badge color={CSS_COLOR.purple}>Regime</Badge>}>
              Market Read
            </CardTitle>
            <div
              style={{
                fontSize: fs(10),
                fontFamily: T.sans,
                color: CSS_COLOR.textSec,
                lineHeight: 1.45,
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
            gap: sp(6),
          }}
        >
          <Card className="ra-panel-enter" style={{ padding: sp("6px 10px") }}>
            <CardTitle
              right={
                <span
                  style={{
                    fontSize: textSize("caption"),
                    color:
                      newsStatusLabel === "live · news"
                        ? CSS_COLOR.accent
                        : CSS_COLOR.textDim,
                    fontFamily: T.sans,
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
                        ? `1px solid ${cssColorMix(CSS_COLOR.border, 2)}`
                        : "none",
                    cursor: item.articleUrl ? "pointer" : "default",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = CSS_COLOR.accentHoverBg)
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
                  <Badge color={CSS_COLOR.accent}>{item.tag}</Badge>
                  <div
                    style={{
                      width: dim(4),
                      height: dim(4),
                      borderRadius: dim(RADII.pill),
                      background:
                        item.s === 1
                          ? CSS_COLOR.green
                          : item.s === -1
                            ? CSS_COLOR.red
                            : CSS_COLOR.textDim,
                      marginTop: sp(4),
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontSize: fs(10),
                      color: CSS_COLOR.textSec,
                      fontFamily: T.sans,
                      lineHeight: 1.4,
                    }}
                  >
                    {item.text}
                  </span>
                  <span
                    style={{
                      fontSize: textSize("body"),
                      color: CSS_COLOR.textMuted,
                      fontFamily: T.sans,
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
          <Card className="ra-panel-enter" style={{ padding: sp("6px 10px") }}>
            <CardTitle
              right={
                <span
                  style={{
                    fontSize: textSize("caption"),
                    color:
                      calendarStatusLabel === "earnings · live"
                        ? CSS_COLOR.accent
                        : CSS_COLOR.textDim,
                    fontFamily: T.sans,
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
                    ? CSS_COLOR.amber
                    : ev.type === "earnings"
                      ? CSS_COLOR.green
                      : ev.type === "holiday"
                        ? CSS_COLOR.red
                        : CSS_COLOR.accent;
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
                          ? `1px solid ${cssColorMix(CSS_COLOR.border, 2)}`
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
                          fontWeight: FONT_WEIGHTS.regular,
                          fontFamily: T.sans,
                          color: CSS_COLOR.text,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ev.label}
                      </div>
                      <div
                        style={{
                          fontSize: textSize("body"),
                          color: CSS_COLOR.textMuted,
                          fontFamily: T.sans,
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

export const MarketScreen = (props) => {
  const { isVisible = false, onReadinessChange } = props;

  useEffect(() => {
    if (!isVisible) {
      onReadinessChange?.({
        criticalReady: false,
        derivedReady: false,
        backgroundAllowed: false,
      });
      return undefined;
    }
    preloadMarketChartModules();
    return undefined;
  }, [isVisible, onReadinessChange]);

  return <MarketScreenInner {...props} />;
};

export default MarketScreen;
