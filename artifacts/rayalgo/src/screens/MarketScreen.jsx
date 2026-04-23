import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useGetNews,
  useGetResearchEarningsCalendar,
} from "@workspace/api-client-react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Badge,
  Card,
  CardTitle,
  DataUnavailableState,
  MACRO_TICKERS,
  MISSING_VALUE,
  MarketActivityPanel,
  MultiChartGrid,
  RATES_PROXIES,
  SECTORS,
  SectorTreemap,
  T,
  TREEMAP_DATA,
  TreemapHeatmap,
  _initialState,
  buildFlowTideFromEvents,
  buildRatesProxySummary,
  buildTrackedBreadthSummary,
  clampNumber,
  dim,
  fmtCompactNumber,
  fmtM,
  formatCalendarMeta,
  formatIsoDate,
  formatQuotePrice,
  formatRelativeTimeShort,
  formatSignedPercent,
  fs,
  isFiniteNumber,
  mapNewsSentimentToScore,
  normalizeTickerSymbol,
  persistState,
  sp,
  useLiveMarketFlow,
} from "../RayAlgoPlatform";

export const MarketScreen = ({
  sym,
  onSymClick,
  symbols = [],
  researchConfigured = false,
  flowScannerEnabled = true,
  stockAggregateStreamingEnabled = false,
  marketNotifications = [],
  signalEvents = [],
  signalStates = [],
  signalMonitorProfile = null,
  signalMonitorPending = false,
  onSignalAction,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
}) => {
  const [sectorTf, setSectorTf] = useState(_initialState.marketSectorTf || "1d");
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
  useEffect(() => {
    persistState({ marketSectorTf: sectorTf });
  }, [sectorTf]);
  useEffect(() => {
    persistState({ marketActivityPanelWidth: activityPanelWidth });
  }, [activityPanelWidth]);
  useEffect(() => {
    persistState({ marketUnusualThreshold: unusualThreshold });
  }, [unusualThreshold]);
  const handleChangeUnusualThreshold = useCallback((next) => {
    if (!Number.isFinite(next) || next <= 0) return;
    setUnusualThreshold(clampNumber(next, 0.1, 100));
  }, []);
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
  const {
    putCall,
    sectorFlow,
    flowStatus,
    flowEvents,
    flowTide,
    providerSummary: flowProviderSummary,
  } = useLiveMarketFlow(symbols, {
    enabled: flowScannerEnabled,
    unusualThreshold,
  });
  const popularTickers = useMemo(() => {
    const bySymbol = new Map();
    for (const event of flowEvents || []) {
      const symbol = event?.underlying?.toUpperCase?.();
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
        staleTime: 60_000,
        refetchInterval: 60_000,
        retry: false,
      },
    },
  );
  const earningsQuery = useGetResearchEarningsCalendar(calendarWindow, {
    query: {
      enabled: Boolean(
        researchConfigured && calendarWindow.from && calendarWindow.to,
      ),
      staleTime: 300_000,
      refetchInterval: 300_000,
      retry: false,
    },
  });
  const breadth = buildTrackedBreadthSummary();
  const ratesSummary = buildRatesProxySummary();
  const volatilityProxy =
    MACRO_TICKERS.find((item) => item.sym === "VIXY") || MACRO_TICKERS[0];
  const putCallBullish = isFiniteNumber(putCall.total) ? putCall.total <= 1 : null;
  const putCallMarkerPct = isFiniteNumber(putCall.total)
    ? Math.max(8, Math.min(92, (putCall.total / 2) * 100))
    : 50;
  const upPct = isFiniteNumber(breadth.advancePct) ? breadth.advancePct : 0;
  const downPct = breadth.total ? 100 - upPct : 0;
  const analysisLeader = breadth.leader;
  const analysisLaggard = breadth.laggard;
  const selectedFlowEvents = useMemo(
    () =>
      flowEvents.filter(
        (event) => normalizeTickerSymbol(event.ticker) === normalizeTickerSymbol(sym),
      ),
    [flowEvents, sym],
  );
  const selectedFlowTide = useMemo(
    () =>
      selectedFlowEvents.length
        ? buildFlowTideFromEvents(selectedFlowEvents)
        : flowTide,
    [flowTide, selectedFlowEvents],
  );
  const selectedCallPremium = selectedFlowEvents.reduce(
    (sum, event) => sum + (event.cp === "C" ? event.premium : 0),
    0,
  );
  const selectedPutPremium = selectedFlowEvents.reduce(
    (sum, event) => sum + (event.cp === "P" ? event.premium : 0),
    0,
  );
  const highlightedUnusualFlow = useMemo(
    () => flowEvents.slice(0, 12),
    [flowEvents],
  );
  const newsItems = useMemo(() => {
    const articles = newsQuery.data?.articles || [];
    return articles.map((article) => ({
      id: article.id,
      text: article.title,
      time: formatRelativeTimeShort(article.publishedAt),
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
          date: formatCalendarMeta(entry.date, entry.time),
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

  return (
    <div
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
          style={{
            display: "grid",
            gridTemplateColumns: `minmax(0, 1fr) 6px ${activityPanelWidth}px`,
            gap: 6,
            alignItems: "start",
          }}
        >
          <MultiChartGrid
            activeSym={sym}
            onSymClick={onSymClick}
            watchlistSymbols={symbols}
            popularTickers={popularTickers}
            stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
          />
          <div
            role="separator"
            aria-label="Resize activity and notifications panel"
            onPointerDown={handleStartActivityPanelResize}
            title="Drag to resize activity panel"
            style={{
              alignSelf: "stretch",
              minHeight: dim(340),
              cursor: "col-resize",
              background: `linear-gradient(180deg, transparent, ${T.borderLight}, transparent)`,
              borderLeft: `1px solid ${T.border}55`,
              borderRight: `1px solid ${T.border}55`,
            }}
          />
          <MarketActivityPanel
            notifications={marketNotifications}
            highlightedUnusualFlow={highlightedUnusualFlow}
            signalEvents={signalEvents}
            signalStates={signalStates}
            signalMonitorProfile={signalMonitorProfile}
            signalMonitorPending={signalMonitorPending}
            newsItems={newsItems}
            calendarItems={calendarItems}
            onSymClick={onSymClick}
            onSignalAction={onSignalAction}
            onScanNow={onScanNow}
            onToggleMonitor={onToggleMonitor}
            onChangeMonitorTimeframe={onChangeMonitorTimeframe}
            unusualThreshold={unusualThreshold}
            onChangeUnusualThreshold={handleChangeUnusualThreshold}
            appliedUnusualThreshold={
              flowProviderSummary?.appliedUnusualThreshold ?? null
            }
            appliedUnusualThresholdConsistent={
              flowProviderSummary?.appliedUnusualThresholdConsistent ?? true
            }
          />
        </div>

        {/* ── ROW 2: Selected ticker premium tide ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 6,
          }}
        >
          <Card style={{ padding: "8px 10px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
                gap: sp(8),
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: fs(10),
                    fontWeight: 700,
                    fontFamily: T.display,
                    color: T.textSec,
                  }}
                >
                  Premium Tide · {sym}
                </div>
                <div
                  style={{
                    fontSize: fs(8),
                    color: T.textDim,
                    fontFamily: T.mono,
                    marginTop: 1,
                  }}
                >
                  Intraday premium flow follows the selected ticker
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: sp(8),
                  fontSize: fs(9),
                  fontFamily: T.mono,
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                <span style={{ color: T.green }}>
                  Calls {fmtM(selectedCallPremium)}
                </span>
                <span style={{ color: T.red }}>
                  Puts {fmtM(selectedPutPremium)}
                </span>
                <span style={{ color: T.accent, fontWeight: 700 }}>
                  Net{" "}
                  {selectedCallPremium - selectedPutPremium >= 0 ? "+" : ""}
                  {fmtM(Math.abs(selectedCallPremium - selectedPutPremium))}
                </span>
              </div>
            </div>
            {selectedFlowTide.length ? (
              <div style={{ height: dim(190), width: "100%" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={selectedFlowTide}>
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: fs(9), fill: T.textMuted }}
                    />
                    <YAxis
                      tick={{ fontSize: fs(9), fill: T.textMuted }}
                      tickFormatter={(value) => `${(value / 1e6).toFixed(1)}M`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: T.bg4,
                        border: `1px solid ${T.border}`,
                        borderRadius: 0,
                        fontSize: fs(10),
                        fontFamily: T.mono,
                      }}
                      formatter={(value) =>
                        `${value >= 0 ? "+" : ""}$${(value / 1e6).toFixed(2)}M`
                      }
                    />
                    <ReferenceLine
                      y={0}
                      stroke={T.textMuted}
                      strokeDasharray="2 2"
                    />
                    <Area
                      type="monotone"
                      dataKey="cumNet"
                      stroke={T.accent}
                      strokeWidth={2}
                      fill={T.accent}
                      fillOpacity={0.28}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <DataUnavailableState
                title={`No live flow for ${sym}`}
                detail="Select another ticker or wait for new options activity."
              />
            )}
          </Card>

          <Card style={{ display: "none" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
                gap: sp(8),
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: fs(10),
                    fontWeight: 700,
                    fontFamily: T.display,
                    color: T.textSec,
                  }}
                >
                  Unusual Options Activity
                </div>
                <div
                  style={{
                    fontSize: fs(8),
                    color: T.textDim,
                    fontFamily: T.mono,
                    marginTop: 1,
                  }}
                >
                  Highest premium options activity across the tracked universe
                </div>
              </div>
              <span
                style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}
              >
                {highlightedUnusualFlow.length} events
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
              {highlightedUnusualFlow.length ? (
                highlightedUnusualFlow.map((event) => {
                  const positive =
                    event.side === "BUY" ? event.cp === "C" : event.cp === "P";
                  const tone =
                    event.side === "BUY"
                      ? event.cp === "C"
                        ? T.green
                        : T.red
                      : T.textSec;
                  const selectedTicker = normalizeTickerSymbol(event.ticker) ===
                    normalizeTickerSymbol(sym);
                  return (
                    <button
                      key={`${event.ticker}-${event.contract}-${event.occurredAt}`}
                      type="button"
                      onClick={() => onSymClick?.(event.ticker)}
                      style={{
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: "52px 1fr auto",
                        gap: sp(8),
                        alignItems: "center",
                        padding: sp("7px 8px"),
                        background: selectedTicker ? T.bg3 : T.bg0,
                        border: `1px solid ${selectedTicker ? T.accent : T.border}`,
                        borderRadius: 0,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                      onMouseEnter={(event) => {
                        if (selectedTicker) return;
                        event.currentTarget.style.background = T.bg2;
                        event.currentTarget.style.borderColor = T.textMuted;
                      }}
                      onMouseLeave={(event) => {
                        if (selectedTicker) return;
                        event.currentTarget.style.background = T.bg0;
                        event.currentTarget.style.borderColor = T.border;
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            fontSize: fs(10),
                            fontWeight: 700,
                            fontFamily: T.mono,
                            color: T.text,
                          }}
                        >
                          {event.ticker}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: fs(8),
                            fontFamily: T.mono,
                            color: tone,
                            marginTop: 1,
                          }}
                        >
                          {event.type}
                        </span>
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: "flex",
                            gap: sp(4),
                            alignItems: "center",
                            fontSize: fs(9),
                            color: T.textSec,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              minWidth: 0,
                            }}
                          >
                            {event.contract}
                          </span>
                          {event.isUnusual ? (
                            <Badge color={T.amber}>
                              UNUSUAL{" "}
                              {event.unusualScore > 0
                                ? `${event.unusualScore.toFixed(
                                    event.unusualScore >= 10 ? 0 : 1,
                                  )}×`
                                : ""}
                            </Badge>
                          ) : null}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: fs(8),
                            color: T.textDim,
                            fontFamily: T.mono,
                            marginTop: 1,
                          }}
                        >
                          {formatRelativeTimeShort(event.occurredAt)} ·{" "}
                          {event.side}
                          {isFiniteNumber(event.oi) ? ` · OI ${fmtCompactNumber(event.oi)}` : ""}
                          {isFiniteNumber(event.vol) ? ` · Vol ${fmtCompactNumber(event.vol)}` : ""}
                        </span>
                      </span>
                      <span
                        style={{
                          textAlign: "right",
                          fontSize: fs(9),
                          fontWeight: 700,
                          fontFamily: T.mono,
                          color: positive ? T.green : T.red,
                        }}
                      >
                        {fmtM(event.premium)}
                      </span>
                    </button>
                  );
                })
              ) : (
                <DataUnavailableState
                  title="No unusual options activity"
                  detail="Live options flow is currently unavailable for the tracked universe."
                />
              )}
            </div>
          </Card>
        </div>

        {/* ── ROW 4: S&P 500 Equity Heatmap ── */}
        <Card noPad style={{ overflow: "visible", flexShrink: 0 }}>
          <div
            style={{
              padding: sp("6px 10px"),
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: `1px solid ${T.border}`,
            }}
          >
            <span
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
              }}
            >
              S&P 500 Heatmap
            </span>
            <div style={{ display: "flex", gap: 2 }}>
              {["1d", "5d"].map((v) => (
                <button
                  key={v}
                  onClick={() => setSectorTf(v)}
                  style={{
                    padding: sp("2px 7px"),
                    fontSize: fs(8),
                    fontFamily: T.mono,
                    fontWeight: 600,
                    background: sectorTf === v ? T.accentDim : "transparent",
                    border: `1px solid ${sectorTf === v ? T.accent : "transparent"}`,
                    borderRadius: 0,
                    color: sectorTf === v ? T.accent : T.textDim,
                    cursor: "pointer",
                  }}
                >
                  {v.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <TreemapHeatmap
            data={TREEMAP_DATA}
            period={sectorTf}
            onSymClick={onSymClick}
          />
        </Card>

        {/* Sector ETF Heatmap */}
        <SectorTreemap sectors={SECTORS} period={sectorTf} />

        {/* ── ROW 4: P/C + Yield Curve + Breadth ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 6,
          }}
        >
          <Card style={{ padding: "5px 10px" }}>
            <CardTitle>Put / Call</CardTitle>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: sp(4),
                marginBottom: 3,
              }}
            >
              <span
                style={{
                  fontSize: fs(18),
                  fontWeight: 800,
                  fontFamily: T.mono,
                  color: T.text,
                }}
              >
                {isFiniteNumber(putCall.total)
                  ? putCall.total.toFixed(2)
                  : MISSING_VALUE}
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  fontFamily: T.mono,
                  color:
                    putCallBullish == null
                      ? T.textDim
                      : putCallBullish
                        ? T.green
                        : T.red,
                }}
              >
                {isFiniteNumber(putCall.total)
                  ? `${putCallBullish ? "▼" : "▲"} ${Math.abs(putCall.total - 1).toFixed(2)}`
                  : MISSING_VALUE}
              </span>
              <span style={{ fontSize: fs(7), color: T.textMuted }}>
                neutral 1.00
              </span>
            </div>
            <div
              style={{
                display: "flex",
                height: dim(6),
                borderRadius: dim(3),
                overflow: "hidden",
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  flex: 1,
                  background: `linear-gradient(to right, ${T.red}, ${T.amber})`,
                }}
              />
              <div
                style={{
                  flex: 1,
                  background: `linear-gradient(to right, ${T.amber}, ${T.green})`,
                }}
              />
            </div>
            <div
              style={{ position: "relative", height: dim(5), marginTop: -3 }}
            >
              {isFiniteNumber(putCall.total) ? (
                <div
                  style={{
                    position: "absolute",
                    left: `${putCallMarkerPct}%`,
                    transform: "translateX(-50%)",
                    borderLeft: "3px solid transparent",
                    borderRight: "3px solid transparent",
                    borderBottom: `4px solid ${T.text}`,
                  }}
                />
              ) : null}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: sp(3),
                fontSize: fs(8),
                fontFamily: T.mono,
              }}
            >
              <span style={{ color: T.textMuted }}>
                Eq{" "}
                <span style={{ color: T.textSec }}>
                  {isFiniteNumber(putCall.equities)
                    ? putCall.equities.toFixed(2)
                    : MISSING_VALUE}
                </span>
              </span>
              <span style={{ color: T.textMuted }}>
                Idx{" "}
                <span style={{ color: T.textSec }}>
                  {isFiniteNumber(putCall.indices)
                    ? putCall.indices.toFixed(2)
                    : MISSING_VALUE}
                </span>
              </span>
              <span style={{ color: T.textMuted }}>
                Tot{" "}
                <span style={{ color: T.textSec }}>
                  {isFiniteNumber(putCall.total)
                    ? putCall.total.toFixed(2)
                    : MISSING_VALUE}
                </span>
              </span>
            </div>
          </Card>
          <Card style={{ padding: "5px 10px" }}>
            <CardTitle>Rates Proxies</CardTitle>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(3),
                minHeight: 72,
              }}
            >
              {RATES_PROXIES.map((item) => {
                const pos = isFiniteNumber(item.pct) ? item.pct >= 0 : null;
                const width = isFiniteNumber(item.pct)
                  ? Math.max(6, Math.min(100, Math.abs(item.pct) * 48))
                  : 0;
                return (
                  <div
                    key={item.sym}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "46px 40px 1fr 40px",
                      alignItems: "center",
                      gap: sp(4),
                      fontSize: fs(7),
                      fontFamily: T.mono,
                    }}
                  >
                    <span style={{ color: T.textDim }}>{item.term}</span>
                    <span style={{ color: T.textSec, fontWeight: 600 }}>
                      {item.sym}
                    </span>
                    <div
                      style={{
                        height: dim(6),
                        position: "relative",
                        background: T.bg3,
                        borderRadius: dim(3),
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: 0,
                          width: `${width}%`,
                          borderRadius: dim(3),
                          background:
                            pos == null ? T.textMuted : pos ? T.green : T.red,
                          opacity: 0.85,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        color:
                          pos == null ? T.textDim : pos ? T.green : T.red,
                        textAlign: "right",
                        fontWeight: 700,
                      }}
                    >
                      {formatSignedPercent(item.pct)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: fs(7),
                fontFamily: T.mono,
              }}
            >
              <span style={{ color: T.textMuted }}>
                Lead{" "}
                <span style={{ color: T.textSec }}>
                  {ratesSummary.leader?.sym || MISSING_VALUE}
                </span>
              </span>
              <span style={{ color: T.textMuted }}>
                Lag{" "}
                <span style={{ color: T.textSec }}>
                  {ratesSummary.laggard?.sym || MISSING_VALUE}
                </span>
              </span>
            </div>
          </Card>
          <Card style={{ padding: "5px 10px" }}>
            <CardTitle>Breadth</CardTitle>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(4),
                marginBottom: 3,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontFamily: T.mono,
                  fontWeight: 800,
                  color: T.green,
                }}
              >
                {breadth.total ? breadth.advancers : MISSING_VALUE}
              </span>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  height: dim(7),
                  borderRadius: dim(3),
                  overflow: "hidden",
                }}
              >
                <div style={{ width: `${upPct}%`, background: T.green }} />
                <div style={{ width: `${downPct}%`, background: T.red }} />
              </div>
              <span
                style={{
                  fontSize: fs(10),
                  fontFamily: T.mono,
                  fontWeight: 800,
                  color: T.red,
                }}
              >
                {breadth.total ? breadth.decliners : MISSING_VALUE}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: sp(1),
                fontSize: fs(7),
                fontFamily: T.mono,
              }}
            >
              {[
                [
                  "Up",
                  breadth.total ? `${upPct.toFixed(0)}%` : MISSING_VALUE,
                  breadth.total ? T.green : T.textDim,
                ],
                [
                  "5D+",
                  isFiniteNumber(breadth.positive5dPct)
                    ? `${breadth.positive5dPct.toFixed(0)}%`
                    : MISSING_VALUE,
                  isFiniteNumber(breadth.positive5dPct)
                    ? breadth.positive5dPct >= 50
                      ? T.green
                      : T.amber
                    : T.textDim,
                ],
                [
                  "Unchg",
                  breadth.total ? `${breadth.unchanged}` : MISSING_VALUE,
                  breadth.total ? T.text : T.textDim,
                ],
                [
                  "Sectors+",
                  breadth.sectorCoverage
                    ? `${breadth.positiveSectors}/${breadth.sectorCoverage}`
                    : MISSING_VALUE,
                  breadth.sectorCoverage
                    ? breadth.positiveSectors >=
                      Math.ceil(breadth.sectorCoverage / 2)
                      ? T.green
                      : T.amber
                    : T.textDim,
                ],
                [
                  "Lead",
                  breadth.leader?.sym || MISSING_VALUE,
                  isFiniteNumber(breadth.leader?.chg)
                    ? breadth.leader.chg >= 0
                      ? T.green
                      : T.red
                    : T.textDim,
                ],
                [
                  "Lag",
                  breadth.laggard?.sym || MISSING_VALUE,
                  isFiniteNumber(breadth.laggard?.chg)
                    ? breadth.laggard.chg >= 0
                      ? T.green
                      : T.red
                    : T.textDim,
                ],
              ].map(([l, v, c], i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: sp("1px 3px"),
                    background: i % 2 === 0 ? `${T.bg3}40` : "transparent",
                    borderRadius: 2,
                  }}
                >
                  <span style={{ color: T.textDim }}>{l}</span>
                  <span style={{ color: c, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ── ROW 4.5: Sector Flow (full width, horizontal layout) — sector rotation read ── */}
        <Card style={{ padding: "8px 12px", flexShrink: 0 }}>
          <CardTitle
            right={
              <span
                style={{
                  fontSize: fs(8),
                  color: flowStatus === "live" ? T.accent : T.textMuted,
                  fontFamily: T.mono,
                }}
              >
                {flowStatus === "live"
                  ? "live option premium · today · sector rotation"
                  : `flow ${flowStatus}`}
              </span>
            }
          >
            Sector Flow
          </CardTitle>
          {sectorFlow.length ? (
            (() => {
              const absMax = Math.max(
                1,
                ...sectorFlow.map((x) => Math.abs(x.calls - x.puts)),
              );
              // Sort by net flow magnitude — strongest signals first
              const sorted = [...sectorFlow]
                .map((s) => ({ ...s, net: s.calls - s.puts }))
                .sort((a, b) => b.net - a.net);
              const half = Math.ceil(sorted.length / 2);
              const left = sorted.slice(0, half);
              const right = sorted.slice(half);
              const renderBar = (s, i) => {
                const widthPct = (Math.abs(s.net) / absMax) * 50;
                const netStr = (s.net >= 0 ? "+" : "-") + fmtM(Math.abs(s.net));
                return (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "85px 1fr 56px",
                      alignItems: "center",
                      gap: sp(6),
                      marginBottom: sp(3),
                      fontSize: fs(10),
                      fontFamily: T.mono,
                    }}
                  >
                    <span style={{ color: T.textSec, fontWeight: 600 }}>
                      {s.sector}
                    </span>
                    <div
                      style={{
                        position: "relative",
                        height: dim(10),
                        background: T.bg3,
                        borderRadius: dim(2),
                      }}
                    >
                      {/* Center divider */}
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: "50%",
                          width: dim(1),
                          background: T.textMuted,
                          opacity: 0.4,
                        }}
                      />
                      {/* Direction bar */}
                      {s.net >= 0 ? (
                        <div
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: 0,
                            bottom: 0,
                            width: `${widthPct}%`,
                            background: T.green,
                            opacity: 0.85,
                            borderRadius: `0 ${dim(2)}px ${dim(2)}px 0`,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            position: "absolute",
                            right: "50%",
                            top: 0,
                            bottom: 0,
                            width: `${widthPct}%`,
                            background: T.red,
                            opacity: 0.85,
                            borderRadius: `${dim(2)}px 0 0 ${dim(2)}px`,
                          }}
                        />
                      )}
                    </div>
                    <span
                      style={{
                        color: s.net >= 0 ? T.green : T.red,
                        fontWeight: 700,
                        textAlign: "right",
                      }}
                    >
                      {netStr}
                    </span>
                  </div>
                );
              };
              return (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: sp(20),
                  }}
                >
                  <div>{left.map(renderBar)}</div>
                  <div>{right.map(renderBar)}</div>
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

        {/* ── ROW 5: News + Calendar + AI ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 0.7fr 1fr",
            gap: 6,
          }}
        >
          <Card style={{ padding: "6px 10px" }}>
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
                <div
                  key={item.id}
                  style={{
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
                  title={item.publisher || undefined}
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
                </div>
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
          <Card style={{ padding: "6px 10px" }}>
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
                    style={{
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
                          fontWeight: 600,
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
          <Card
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "6px 10px",
            }}
          >
            <CardTitle right={<Badge color={T.purple}>AI</Badge>}>
              Analysis
            </CardTitle>
            <div
              style={{
                flex: 1,
                fontSize: fs(10),
                fontFamily: T.sans,
                color: T.textSec,
                lineHeight: 1.5,
                padding: sp("5px 8px"),
                background: T.bg0,
                borderRadius: 0,
                border: `1px solid ${T.border}`,
              }}
            >
              <span
                style={{
                  color: !isFiniteNumber(volatilityProxy?.pct)
                    ? T.textDim
                    : volatilityProxy.pct <= 0
                      ? T.green
                      : T.amber,
                }}
              >
                ▸
              </span>{" "}
              {volatilityProxy?.label || "Volatility"} proxy{" "}
              {isFiniteNumber(volatilityProxy?.pct)
                ? volatilityProxy.pct >= 0
                  ? "firming"
                  : "easing"
                : "is unavailable"}{" "}
              at {formatQuotePrice(volatilityProxy?.price)}; flow is strongest
              in {analysisLeader?.sym || MISSING_VALUE} and weakest in{" "}
              {analysisLaggard?.sym || MISSING_VALUE}.{"\n\n"}
              <span
                style={{
                  color: !isFiniteNumber(breadth.advancePct)
                    ? T.textDim
                    : breadth.advancePct >= 55
                      ? T.green
                      : T.amber,
                }}
              >
                ▸
              </span>{" "}
              {breadth.total
                ? `Tracked breadth is ${breadth.advancers}/${breadth.total} green with ${isFiniteNumber(breadth.positive5dPct) ? breadth.positive5dPct.toFixed(0) : MISSING_VALUE}% of names positive over 5 sessions.`
                : "Tracked breadth is unavailable until broker quotes populate the equity heatmap universe."}
              {"\n\n"}
              <span style={{ color: T.accent }}>▸</span> Treasury proxies are
              led by {ratesSummary.leader?.sym || MISSING_VALUE} and lagged by{" "}
              {ratesSummary.laggard?.sym || MISSING_VALUE}; keep the tape read anchored to
              live ETF proxies until direct index and futures entitlements are
              enabled.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default MarketScreen;
