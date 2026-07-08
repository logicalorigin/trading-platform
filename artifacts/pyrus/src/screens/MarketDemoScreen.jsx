import { useEffect, useMemo, useState } from "react";
import { useGetNews, useListAggregateFlowEvents } from "@workspace/api-client-react";
import { MultiChartGrid } from "../features/market/MultiChartGrid.jsx";
import { MarketActivityPanel } from "../features/market/MarketActivityPanel.jsx";
import MarketInternalsRail from "../features/market/MarketInternalsRail.jsx";
import MarketUniverseTable from "../features/market/MarketUniverseTable.jsx";
import { useSignalMonitorSnapshot } from "../features/platform/signalMonitorStore.js";
import { useNotificationSnapshot } from "../features/platform/notificationStore.js";
import {
  Card,
  DataUnavailableState,
  MetricChip,
  RadialStrokeGauge,
  SegmentedControl,
  SurfacePanel,
  TextField,
} from "../components/platform/primitives.jsx";
import {
  fmtM,
  formatRelativeTimeShort,
  formatSignedPercent,
  isFiniteNumber,
  mapNewsSentimentToScore,
} from "../lib/formatters.js";
import {
  MACRO_TICKERS,
  buildTrackedBreadthSummary,
} from "../features/market/marketReferenceData.js";
import {
  toneForDirectionalIntent,
  toneForFinancialDelta,
} from "../features/platform/semanticToneModel.js";
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, sp, textSize } from "../lib/uiTokens.jsx";

const SORT_OPTIONS = [
  { value: "flow", label: "Flow" },
  { value: "pct", label: "%" },
  { value: "vol", label: "Vol" },
  { value: "alpha", label: "A–Z" },
];

const isCallRight = (right) => String(right || "").toLowerCase().startsWith("c");

// Roll the aggregate flow tape up to the few headline numbers the hero band shows.
// Uses the same query key as MarketUniverseTable, so react-query serves both from
// a single request.
const summarizeFlow = (events) => {
  let callPrem = 0;
  let putPrem = 0;
  for (const event of events) {
    const premium = Number(event?.premium) || 0;
    if (isCallRight(event?.right)) callPrem += premium;
    else putPrem += premium;
  }
  const total = callPrem + putPrem;
  return {
    callPrem,
    putPrem,
    total,
    net: callPrem - putPrem,
    bullShare: total > 0 ? callPrem / total : 0.5,
    putCall: callPrem > 0 ? putPrem / callPrem : null,
  };
};

const sentimentTone = (sentiment) =>
  toneForFinancialDelta(mapNewsSentimentToScore(sentiment));

const HeroBand = ({ flow, sortMode, onSortModeChange, filterText, onFilterChange }) => {
  const bullPct = Math.round(flow.bullShare * 100);
  const breadth = buildTrackedBreadthSummary();
  const advPct = isFiniteNumber(breadth.advancePct)
    ? Math.round(breadth.advancePct)
    : null;
  const volProxy = MACRO_TICKERS.find((item) => item.sym === "VIXY") || null;
  const volPct = isFiniteNumber(volProxy?.pct) ? volProxy.pct : null;
  return (
    <SurfacePanel
      compact
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
      }}
      bodyStyle={{
        display: "flex",
        alignItems: "center",
        gap: sp("16px"),
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: sp("12px") }}>
        <div
          style={{
            fontFamily: T.sans,
            fontSize: textSize("displaySmall"),
            fontWeight: FONT_WEIGHTS.emphasis,
            letterSpacing: 0.5,
            color: CSS_COLOR.text,
          }}
        >
          MARKET
        </div>
        <RadialStrokeGauge
          value={bullPct}
          max={100}
          size={56}
          label="Bull flow"
          valueLabel={`${bullPct}%`}
          ariaLabel={`Bull flow ${bullPct}%`}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: sp("6px"), flexWrap: "wrap" }}>
        <MetricChip
          label="Breadth"
          value={advPct != null ? `${advPct}%` : "—"}
          tone={advPct == null ? CSS_COLOR.textDim : toneForFinancialDelta(advPct - 50)}
          title="Share of tracked symbols advancing on the day"
        />
        <MetricChip
          label="P/C"
          value={flow.putCall != null ? flow.putCall.toFixed(2) : "—"}
          tone={
            flow.putCall == null
              ? CSS_COLOR.textDim
              : toneForDirectionalIntent(flow.putCall <= 1 ? "bullish" : "bearish")
          }
          title="Put premium / call premium across the flow tape (>1 = puts lead)"
        />
        <MetricChip
          label="VIXY"
          value={volPct != null ? formatSignedPercent(volPct) : "—"}
          tone={volPct == null ? CSS_COLOR.textDim : toneForFinancialDelta(-volPct)}
          title="Volatility proxy (VIXY) daily change — up = risk-off"
        />
        <MetricChip
          label="Net flow"
          value={fmtM(flow.net)}
          tone={toneForDirectionalIntent(flow.net >= 0 ? "bullish" : "bearish")}
          title="Net call−put premium across the flow tape"
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: sp("10px"), marginLeft: "auto" }}>
        <SegmentedControl
          options={SORT_OPTIONS}
          value={sortMode}
          onChange={onSortModeChange}
          ariaLabel="Universe sort"
          radioGroup
        />
        <TextField
          value={filterText}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Filter symbol…"
          size="sm"
          style={{ width: 150, minWidth: 0, maxWidth: "100%" }}
          inputProps={{ "aria-label": "Filter universe by symbol" }}
        />
      </div>
    </SurfacePanel>
  );
};

const NewsRail = ({ isVisible, safeQaMode }) => {
  const newsQuery = useGetNews(
    { limit: 6 },
    { query: { enabled: isVisible && !safeQaMode, refetchInterval: 60_000 } },
  );
  const articles = newsQuery.data?.articles || [];
  return (
    <SurfacePanel title="News" compact>
      {articles.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: sp("6px") }}>
          {articles.map((article) => (
            <a
              key={article.id}
              href={article.articleUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: sp("8px"),
                textDecoration: "none",
                color: CSS_COLOR.text,
                fontFamily: T.sans,
                fontSize: textSize("metric"),
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: RADII.pill,
                  background: sentimentTone(article.sentiment),
                  flex: "0 0 auto",
                  alignSelf: "center",
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {article.title}
              </span>
              <span style={{ color: CSS_COLOR.textDim, flex: "0 0 auto" }}>
                {formatRelativeTimeShort(article.publishedAt)}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <DataUnavailableState
          variant="neutral"
          loading={newsQuery.isPending && newsQuery.fetchStatus !== "idle"}
          title="No headlines"
          detail="Provider-backed headlines appear here during market hours."
        />
      )}
    </SurfacePanel>
  );
};

/**
 * MarketDemoScreen — hidden redesign of the Market overview page.
 *
 * Reachable only via `?screen=market-demo` (intentionally absent from the nav).
 * The existing MarketScreen is untouched. Layout: a sticky universe-overview hero
 * (flow gauge + P/C + net flow + sort/filter), the flow-ranked universe table,
 * the multi-chart grid kept first-class directly under the hero (a row click loads
 * that symbol into the grid), and a compact News rail.
 *
 * See docs/plans/market-screen-redesign-2026-06-26.md.
 */
export default function MarketDemoScreen({
  sym = "SPY",
  marketSymPing,
  onSymClick,
  symbols,
  isVisible = false,
  safeQaMode = false,
  stockAggregateStreamingEnabled = false,
  unusualThreshold,
  watchlists = [],
  onSignalAction,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
  onChangeMonitorWatchlist,
}) {
  const [selectedSym, setSelectedSym] = useState(sym || "SPY");
  const [sortMode, setSortMode] = useState("flow");
  const [filterText, setFilterText] = useState("");
  // The unusual-flow threshold select lives in MarketActivityPanel; it needs a
  // setter to be more than a no-op. Seed from the app-level prop, then drive it
  // locally so the control actually changes the chart's unusual-flow overlay.
  const [unusualThresholdValue, setUnusualThreshold] = useState(
    unusualThreshold ?? 1,
  );

  // Keep the local chart selection in step with the app-wide symbol when the
  // parent changes it (e.g. a deep-link ping), without overriding in-screen picks.
  useEffect(() => {
    if (sym) setSelectedSym(sym);
  }, [sym]);

  const flowQuery = useListAggregateFlowEvents(
    { limit: 1000, scope: "all" },
    { query: { enabled: isVisible, refetchInterval: 15_000 } },
  );
  const flowSummary = useMemo(
    () => summarizeFlow(flowQuery.data?.events ?? []),
    [flowQuery.data],
  );

  // Live signal-monitor + notification state for the activity panel. Both are
  // app-wide stores (populated by the platform runtime), so the demo reads the
  // same data the rest of the platform sees.
  const signalMonitor = useSignalMonitorSnapshot();
  const notifications = useNotificationSnapshot();

  const handleSelectSymbol = (nextSymbol) => {
    if (!nextSymbol) return;
    setSelectedSym(nextSymbol);
    onSymClick?.(nextSymbol);
  };

  return (
    <div
      data-testid="market-demo-screen"
      style={{
        height: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        color: CSS_COLOR.text,
        fontFamily: T.sans,
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: sp("10px"),
          padding: sp("12px"),
        }}
      >
      <HeroBand
        flow={flowSummary}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        filterText={filterText}
        onFilterChange={setFilterText}
      />

      <Card style={{ maxHeight: "44vh", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <MarketUniverseTable
          isVisible={isVisible}
          activeSym={selectedSym}
          sortMode={sortMode}
          filterText={filterText}
          onSortModeChange={setSortMode}
          onSelectSymbol={handleSelectSymbol}
        />
      </Card>

      <div style={{ flex: "1 1 auto", minHeight: 360, display: "flex", flexDirection: "column" }}>
        <MultiChartGrid
          activeSym={selectedSym}
          externalSelection={marketSymPing}
          onSymClick={handleSelectSymbol}
          watchlistSymbols={symbols}
          stockAggregateStreamingEnabled={stockAggregateStreamingEnabled && !safeQaMode}
          isVisible={isVisible}
          unusualThreshold={unusualThresholdValue}
          trackStateKey="pyrus:market-grid-track-sizes:demo"
        />
      </div>

      <MarketActivityPanel
        signalStates={signalMonitor.states}
        signalEvents={signalMonitor.events}
        signalMonitorProfile={signalMonitor.profile}
        signalMonitorPending={signalMonitor.pending}
        signalMonitorDegraded={signalMonitor.degraded}
        notifications={notifications.toasts}
        watchlists={watchlists}
        unusualThreshold={unusualThresholdValue}
        onChangeUnusualThreshold={setUnusualThreshold}
        onSymClick={handleSelectSymbol}
        onSignalAction={onSignalAction}
        onScanNow={onScanNow}
        onToggleMonitor={onToggleMonitor}
        onChangeMonitorTimeframe={onChangeMonitorTimeframe}
        onChangeMonitorWatchlist={onChangeMonitorWatchlist}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: sp("10px"),
        }}
      >
        <MarketInternalsRail isVisible={isVisible} onSelectSymbol={handleSelectSymbol} />
        <NewsRail isVisible={isVisible} safeQaMode={safeQaMode} />
      </div>
      </div>
    </div>
  );
}
