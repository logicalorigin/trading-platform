import { useEffect, useMemo, useState } from "react";
import {
  useGetNews,
  useGetResearchEarningsCalendar,
  useListAggregateFlowEvents,
} from "@workspace/api-client-react";
import { AppTooltip } from "@/components/ui/tooltip";
import { MultiChartGrid } from "../features/market/MultiChartGrid.jsx";
import MarketInternalsRail from "../features/market/MarketInternalsRail.jsx";
import { MarketUniverseScanner } from "../features/market/MarketUniverseTable.jsx";
import { UNUSUAL_THRESHOLD_OPTIONS } from "../features/market/MarketActivityPanel.jsx";
import {
  Card,
  DataUnavailableState,
  Select,
  SurfacePanel,
} from "../components/platform/primitives.jsx";
import {
  fmtM,
  formatCalendarMeta,
  formatIsoDate,
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
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, cssColorMix, dim, sp, textSize } from "../lib/uiTokens.jsx";
import { useViewport } from "../lib/responsive";

const isCallRight = (right) => String(right || "").toLowerCase().startsWith("c");

// Roll the aggregate flow tape up to the few headline numbers the top bar shows.
// Uses the same query key as the scanner, so react-query serves both from a
// single request.
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

// Derive a single regime verdict from the live inputs. Each available input
// contributes a bounded -1..+1 directional vote; the mean classifies the tape.
// When no live input has landed (the flow tape is the primary signal), degrade
// honestly to an amber THIN TAPE rather than a false RISK-ON.
const deriveRegime = ({ flow, advancePct, putCall, volPct }) => {
  const signals = [];
  if (flow.total > 0) {
    signals.push(Math.max(-1, Math.min(1, (flow.bullShare - 0.5) * 4)));
  }
  if (isFiniteNumber(putCall)) {
    signals.push(Math.max(-1, Math.min(1, (1 - putCall) * 1.5)));
  }
  if (isFiniteNumber(advancePct)) {
    signals.push(Math.max(-1, Math.min(1, (advancePct - 50) / 25)));
  }
  if (isFiniteNumber(volPct)) {
    signals.push(Math.max(-1, Math.min(1, -volPct / 3)));
  }
  if (!signals.length || !(flow.total > 0)) {
    return { label: "THIN TAPE", tone: CSS_COLOR.amber, thin: true };
  }
  const score = signals.reduce((sum, value) => sum + value, 0) / signals.length;
  if (score >= 0.18) {
    return { label: "RISK-ON", tone: toneForDirectionalIntent("bullish"), thin: false };
  }
  if (score <= -0.18) {
    return { label: "RISK-OFF", tone: toneForDirectionalIntent("bearish"), thin: false };
  }
  return { label: "MIXED", tone: CSS_COLOR.amber, thin: false };
};

const buildWhyClause = ({ regime, flow, advancePct }) => {
  if (regime.thin) return "flow tape still hydrating — waiting on live prints";
  const parts = [`${flow.bullShare >= 0.5 ? "call" : "put"} flow leading`];
  if (isFiniteNumber(advancePct)) {
    parts.push(advancePct >= 50 ? "breadth broadening" : "breadth narrowing");
  }
  parts.push(`net ${fmtM(flow.net)}`);
  return parts.join(" · ");
};

const RegimePill = ({ regime, why }) => (
  <div
    role="status"
    aria-label={`Regime ${regime.label}. ${why}`}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: sp(8),
      padding: sp("5px 12px"),
      borderRadius: RADII.pill,
      background: cssColorMix(regime.tone, 13),
      border: `1px solid ${cssColorMix(regime.tone, 38)}`,
      minWidth: 0,
    }}
  >
    <span
      aria-hidden="true"
      style={{ width: 6, height: 6, borderRadius: RADII.pill, background: regime.tone, flex: "0 0 auto" }}
    />
    <span
      style={{
        color: regime.tone,
        fontFamily: T.sans,
        fontWeight: FONT_WEIGHTS.emphasis,
        fontSize: textSize("bodyStrong"),
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {regime.label}
    </span>
    <span
      style={{
        color: CSS_COLOR.textSec,
        fontFamily: T.sans,
        fontSize: textSize("body"),
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {why}
    </span>
  </div>
);

const TopStat = ({ label, value, tone = CSS_COLOR.textSec, title }) => (
  <div title={title} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
    <span
      style={{
        color: CSS_COLOR.textDim,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: tone,
        fontFamily: T.data,
        fontSize: textSize("paragraphMuted"),
        fontWeight: FONT_WEIGHTS.label,
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  </div>
);

// Local New York clock — a low-key liveness cue. Frozen under safe-QA so
// screenshots stay deterministic.
const Clock = ({ live = true }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [live]);
  const label = now.toLocaleTimeString("en-US", {
    hour12: false,
    timeZone: "America/New_York",
  });
  return (
    <span style={{ fontFamily: T.data, fontSize: textSize("body"), color: CSS_COLOR.textDim, whiteSpace: "nowrap" }}>
      {label} ET
    </span>
  );
};

// Top bar — the screen's one primary read: a derived regime verdict + why
// clause, then a right-aligned stat row. Breadth / P/C / VIX / Net flow / Adv-Dec
// live only here; the internals card reads the same inputs so the two never
// diverge.
const RegimeTopBar = ({ flow, breadth, volPct, live }) => {
  const advancePct = isFiniteNumber(breadth.advancePct) ? breadth.advancePct : null;
  const hasBreadth = advancePct != null && breadth.total > 0;
  const regime = deriveRegime({ flow, advancePct, putCall: flow.putCall, volPct });
  const why = buildWhyClause({ regime, flow, advancePct });

  const breadthTone =
    advancePct == null
      ? CSS_COLOR.textDim
      : toneForDirectionalIntent(advancePct >= 50 ? "bullish" : "bearish");
  const putCallTone =
    flow.putCall == null
      ? CSS_COLOR.textDim
      : toneForDirectionalIntent(flow.putCall <= 1 ? "bullish" : "bearish");
  const volTone =
    volPct == null
      ? CSS_COLOR.textDim
      : toneForDirectionalIntent(volPct <= 0 ? "bullish" : "bearish");

  return (
    <Card
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(14),
        flexWrap: "wrap",
        padding: sp("8px 12px"),
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: T.sans,
          fontSize: textSize("bodyStrong"),
          fontWeight: FONT_WEIGHTS.emphasis,
          letterSpacing: "0.08em",
          color: CSS_COLOR.text,
        }}
      >
        MARKET
      </span>
      <RegimePill regime={regime} why={why} />
      <div style={{ display: "flex", alignItems: "center", gap: sp(20), marginLeft: "auto", flexWrap: "wrap" }}>
        <TopStat
          label="Breadth"
          value={advancePct != null ? `${Math.round(advancePct)}%` : "—"}
          tone={breadthTone}
          title="Share of tracked symbols advancing on the day"
        />
        <TopStat
          label="P/C"
          value={flow.putCall != null ? flow.putCall.toFixed(2) : "—"}
          tone={putCallTone}
          title="Put premium / call premium across the flow tape (>1 = puts lead)"
        />
        <TopStat
          label="VIX"
          value={volPct != null ? formatSignedPercent(volPct) : "—"}
          tone={volTone}
          title="Volatility proxy (VIXY) daily change — down = risk-on"
        />
        <TopStat
          label="Net flow"
          value={fmtM(flow.net)}
          tone={toneForDirectionalIntent(flow.net >= 0 ? "bullish" : "bearish")}
          title="Net call−put premium across the flow tape"
        />
        <TopStat
          label="Adv/Dec"
          value={hasBreadth ? `${breadth.advancers} / ${breadth.decliners}` : "—"}
          title="Advancing vs declining tracked symbols"
        />
        <Clock live={live} />
      </div>
    </Card>
  );
};

const CONTEXT_NEWS_LIMIT = 6;

const ContextSectionLabel = ({ children }) => (
  <div
    style={{
      color: CSS_COLOR.textDim,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      letterSpacing: "0.12em",
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

// Context — News + Calendar folded into one symbol-aware card. With a symbol
// selected it shows that symbol's sentiment-dot headlines and its next earnings;
// otherwise market-wide headlines and the next catalysts. One shared empty
// state, never two stacked blank cards. A catalyst row click loads its symbol.
const MarketContextCard = ({ isVisible, safeQaMode, researchConfigured, selectedSym, onSelectSymbol }) => {
  const scoped = Boolean(selectedSym);
  const newsQuery = useGetNews(
    scoped ? { ticker: selectedSym, limit: CONTEXT_NEWS_LIMIT } : { limit: CONTEXT_NEWS_LIMIT },
    { query: { enabled: isVisible && !safeQaMode, refetchInterval: 60_000 } },
  );
  const calendarWindow = useMemo(() => {
    const from = new Date();
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 14);
    return { from: formatIsoDate(from), to: formatIsoDate(to) };
  }, []);
  const earningsQuery = useGetResearchEarningsCalendar(calendarWindow, {
    query: {
      enabled: Boolean(isVisible && !safeQaMode && researchConfigured),
      staleTime: 300_000,
      refetchInterval: isVisible && !safeQaMode ? 300_000 : false,
      retry: false,
    },
  });
  const catalysts = useMemo(() => {
    const entries = earningsQuery.data?.entries || [];
    if (!researchConfigured || !entries.length) return [];
    const needle = scoped ? selectedSym.toUpperCase() : null;
    const seen = new Set();
    return entries
      .filter((entry) => entry?.symbol && entry?.date)
      .filter((entry) => !needle || entry.symbol.toUpperCase() === needle)
      .sort(
        (left, right) =>
          (left.date ? Date.parse(left.date) : Infinity) -
          (right.date ? Date.parse(right.date) : Infinity),
      )
      .reduce((acc, entry) => {
        const key = `${entry.symbol}_${entry.date}_${entry.time || ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          acc.push({
            id: key,
            symbol: entry.symbol,
            label: `${entry.symbol} earnings`,
            date: formatCalendarMeta(entry.date, entry.time),
          });
        }
        return acc;
      }, [])
      .slice(0, scoped ? 3 : 6);
  }, [earningsQuery.data, researchConfigured, scoped, selectedSym]);

  const articles = newsQuery.data?.articles || [];
  const hasNews = articles.length > 0;
  const hasCatalysts = catalysts.length > 0;
  const loading =
    (newsQuery.isPending && newsQuery.fetchStatus !== "idle") ||
    (researchConfigured && earningsQuery.isPending && earningsQuery.fetchStatus !== "idle");

  const action = (
    <span
      style={{
        color: scoped ? CSS_COLOR.accent : CSS_COLOR.textDim,
        fontFamily: T.data,
        fontSize: textSize("caption"),
        letterSpacing: "0.04em",
      }}
    >
      {scoped ? selectedSym : "Market-wide"}
    </span>
  );

  return (
    <SurfacePanel title="Context" compact style={{ alignSelf: "stretch" }} action={action}>
      {!hasNews && !hasCatalysts ? (
        <DataUnavailableState
          variant="neutral"
          loading={loading}
          title={scoped ? `No ${selectedSym} context yet` : "No market context yet"}
          detail={
            scoped
              ? "Headlines and the next earnings date for this symbol appear here during market hours."
              : "Market headlines and upcoming catalysts appear here during market hours."
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: sp("10px") }}>
          {hasNews ? (
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
          ) : null}
          {hasCatalysts ? (
            <div style={{ display: "flex", flexDirection: "column", gap: sp("6px") }}>
              <ContextSectionLabel>Next catalysts</ContextSectionLabel>
              {catalysts.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="ra-interactive"
                  onClick={() => onSelectSymbol?.(event.symbol)}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: sp("8px"),
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    textAlign: "left",
                    color: CSS_COLOR.text,
                    fontFamily: T.sans,
                    fontSize: textSize("metric"),
                  }}
                >
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {event.label}
                  </span>
                  <span style={{ color: CSS_COLOR.textDim, flex: "0 0 auto", fontFamily: T.data }}>
                    {event.date}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </SurfacePanel>
  );
};

/**
 * MarketDemoScreen — the Market overview page (redesign, promoted to the
 * `"market"` route via screenRegistry). A dashboard-first command center: a
 * top-bar regime read, a compact flow-ranked Scanner (left), the MultiChartGrid
 * dropped into the dominant center slot, and Market internals + Context on the
 * right. A scanner / calendar row click → handleSelectSymbol loads that symbol
 * into the chart grid (+ onSymClick) — the core interaction contract.
 *
 * See docs/design/market-dashboard-v3-mockup.html for the approved layout.
 */
export default function MarketDemoScreen({
  sym = "SPY",
  marketSymPing,
  onSymClick,
  symbols,
  isVisible = false,
  safeQaMode = false,
  researchConfigured = false,
  stockAggregateStreamingEnabled = false,
  unusualThreshold,
}) {
  const [selectedSym, setSelectedSym] = useState(sym || "SPY");
  // The unusual-flow threshold select now lives in the chart slot header; it
  // seeds from the app-level prop then drives the grid's unusual-flow overlay.
  const [unusualThresholdValue, setUnusualThreshold] = useState(unusualThreshold ?? 1);

  const { flags } = useViewport();
  const isDesktop = flags.isDesktop;

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

  // Shared market-read inputs — computed once so the top bar and the internals
  // card read identical Breadth / P/C / VIX values (single source of truth).
  const breadth = useMemo(() => buildTrackedBreadthSummary(), []);
  const volPct = useMemo(() => {
    const proxy = MACRO_TICKERS.find((item) => item.sym === "VIXY") || null;
    return isFiniteNumber(proxy?.pct) ? proxy.pct : null;
  }, []);

  const handleSelectSymbol = (nextSymbol) => {
    if (!nextSymbol) return;
    setSelectedSym(nextSymbol);
    onSymClick?.(nextSymbol);
  };

  const chartSlot = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp("8px"),
        minHeight: 0,
        minWidth: 0,
        overflowY: isDesktop ? "auto" : "visible",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: sp("10px"), flexShrink: 0, padding: sp("0 2px") }}>
        <span style={{ color: CSS_COLOR.text, fontFamily: T.sans, fontSize: textSize("bodyStrong"), fontWeight: FONT_WEIGHTS.label }}>
          Charts
        </span>
        <span style={{ color: CSS_COLOR.textDim, fontFamily: T.data, fontSize: textSize("body") }}>
          · {selectedSym} selected
        </span>
        <div style={{ marginLeft: "auto" }}>
          <AppTooltip content="Volume / open interest ratio at which a print is flagged as unusual.">
            <Select
              value={String(unusualThresholdValue)}
              onChange={(next) => setUnusualThreshold(Number(next))}
              ariaLabel="Unusual flow threshold"
              options={UNUSUAL_THRESHOLD_OPTIONS}
              style={{ width: dim(92) }}
              selectProps={{ "data-testid": "market-flow-threshold-select" }}
            />
          </AppTooltip>
        </div>
      </div>
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
  );

  const rightColumn = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp("12px"),
        minHeight: 0,
        minWidth: 0,
        overflowY: isDesktop ? "auto" : "visible",
      }}
    >
      <MarketInternalsRail breadth={breadth} putCall={flowSummary.putCall} volPct={volPct} />
      <MarketContextCard
        isVisible={isVisible}
        safeQaMode={safeQaMode}
        researchConfigured={researchConfigured}
        selectedSym={selectedSym}
        onSelectSymbol={handleSelectSymbol}
      />
    </div>
  );

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
          display: "flex",
          flexDirection: "column",
          gap: sp("10px"),
          padding: sp("12px"),
        }}
      >
        <RegimeTopBar flow={flowSummary} breadth={breadth} volPct={volPct} live={!safeQaMode} />

        <div
          style={
            isDesktop
              ? {
                  display: "grid",
                  gridTemplateColumns: "272px minmax(0, 1fr) 328px",
                  gridTemplateRows: "minmax(0, 1fr)",
                  gap: sp("12px"),
                  flex: 1,
                  minHeight: 0,
                }
              : {
                  display: "flex",
                  flexDirection: "column",
                  gap: sp("12px"),
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                }
          }
        >
          <Card
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              minWidth: 0,
              overflow: "hidden",
              height: isDesktop ? "100%" : "min(60vh, 520px)",
            }}
          >
            <MarketUniverseScanner
              isVisible={isVisible}
              activeSym={selectedSym}
              onSelectSymbol={handleSelectSymbol}
            />
          </Card>

          {chartSlot}

          {rightColumn}
        </div>
      </div>
    </div>
  );
}
