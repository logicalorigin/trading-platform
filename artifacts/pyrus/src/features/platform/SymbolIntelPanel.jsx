/**
 * SymbolIntelPanel — compact per-symbol data module (Workstream B2 pilot).
 *
 * One Card with unframed hairline-divided sections for a single symbol:
 * candle+volume chart with a timeframe switcher, key levels (prior close /
 * day high / day low / change%), signal-monitor state, an options-flow
 * rollup, an earnings context strip, and Trade / Research quick actions.
 *
 * Data is react-query fetch-on-open (the panel is lazy-mounted by
 * SymbolHoverCard), staleTime 30s, no polling. Every block renders
 * Skeleton / DataUnavailableState per the DESIGN.md state matrix, except
 * the earnings strip which renders nothing when gated or empty (pilot
 * decision — the strip is optional context, not a monitored surface).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineStyle,
  createChart,
} from "lightweight-charts";
import {
  useGetBars,
  useGetQuoteSnapshots,
  useGetResearchEarningsCalendar,
  useListFlowEvents,
} from "@workspace/api-client-react";
import {
  Card,
  ChartSkeleton,
  DataUnavailableState,
  SegmentedControl,
  Skeleton,
  StatusPill,
} from "../../components/platform/primitives.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { buildChartBarsFromApi } from "../charting/chartApiBars.js";
import {
  resolveCanvasAlphaColor,
  resolveCanvasColor,
} from "../charting/chartCanvasColors";
import {
  fmtM,
  formatCalendarMeta,
  formatIsoDate,
  formatQuotePrice,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters.js";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  T,
  THEMES,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  SEMANTIC_TONE,
  toneForDirectionalIntent,
  toneForFinancialDelta,
} from "./semanticToneModel.js";
import { useSignalMonitorStateForSymbol } from "./signalMonitorStore.js";
import {
  BARS_REQUEST_PRIORITY,
  buildBarsRequestOptions,
} from "./queryDefaults.js";

const TIMEFRAME_OPTIONS = [
  { value: "5m", label: "5M" },
  { value: "15m", label: "15M" },
  { value: "1h", label: "1H" },
  { value: "1d", label: "1D" },
];
const CHART_BAR_LIMIT = 120;
const CHART_HEIGHT = 150;
const FLOW_EVENT_LIMIT = 50;
const EARNINGS_WINDOW_DAYS = 30;

const isCallRight = (right) =>
  String(right || "")
    .toLowerCase()
    .startsWith("c");

// Minimal local rollup of the raw flow tape — net premium + call/put print
// counts only (pattern: buildTickerFlowFromEvents in flowAnalytics.js, kept
// local so the panel does not import a screen-sized module).
const summarizeSymbolFlow = (events) => {
  let callPremium = 0;
  let putPremium = 0;
  let callCount = 0;
  let putCount = 0;
  for (const event of events || []) {
    const premium = Number(event?.premium) || 0;
    if (isCallRight(event?.right)) {
      callPremium += premium;
      callCount += 1;
    } else {
      putPremium += premium;
      putCount += 1;
    }
  }
  return {
    callPremium,
    putPremium,
    net: callPremium - putPremium,
    callCount,
    putCount,
    total: callCount + putCount,
  };
};

const buildIntelChartOptions = () => ({
  autoSize: true,
  layout: {
    background: {
      type: ColorType.Solid,
      color: resolveCanvasColor(CSS_COLOR.bg1, THEMES.dark.bg1),
    },
    textColor: resolveCanvasColor(CSS_COLOR.textMuted, THEMES.dark.textMuted),
    fontFamily: T.sans,
    fontSize: textSize("caption"),
    attributionLogo: false,
  },
  grid: {
    vertLines: { visible: false },
    horzLines: {
      color: resolveCanvasColor(CSS_COLOR.borderLight, THEMES.dark.borderLight),
      style: LineStyle.Solid,
      visible: true,
    },
  },
  rightPriceScale: {
    borderVisible: false,
    ticksVisible: false,
    minimumWidth: 44,
    scaleMargins: { top: 0.08, bottom: 0.24 },
  },
  timeScale: {
    borderVisible: false,
    ticksVisible: false,
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 2,
  },
  handleScroll: false,
  handleScale: false,
});

/**
 * Candles + volume only, colors resolved through chartCanvasColors so theme
 * CSS vars survive the canvas boundary. Candle up/down stays on green/red —
 * the app-wide chart standard (financial outcome per bar), matching
 * ResearchChartSurface.
 */
const IntelCandleChart = ({ bars, symbol }) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return undefined;
    const green = resolveCanvasColor(CSS_COLOR.green, THEMES.dark.green);
    const red = resolveCanvasColor(CSS_COLOR.red, THEMES.dark.red);
    const chart = createChart(containerRef.current, buildIntelChartOptions());
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: green,
      downColor: red,
      wickUpColor: green,
      wickDownColor: red,
      borderVisible: false,
      priceLineVisible: true,
      lastValueVisible: true,
    });
    volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: "",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volumeSeriesRef.current
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    // TODO(symbol-intel-pilot): indicator overlays attach here via
    // pyrusSignalsPineAdapter when the full B2 scope lands (deferred).
    chartRef.current = chart;
    return () => {
      try {
        chart.remove();
      } catch {
        // ignore disposal errors during HMR
      }
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    const upVolume = resolveCanvasAlphaColor(
      CSS_COLOR.green,
      "42",
      THEMES.dark.green,
    );
    const downVolume = resolveCanvasAlphaColor(
      CSS_COLOR.red,
      "42",
      THEMES.dark.red,
    );
    // Dedupe on the second boundary and sort ascending — lightweight-charts
    // rejects unordered/duplicate timestamps.
    const bySecond = new Map();
    for (const bar of bars || []) {
      if (
        !isFiniteNumber(bar?.time) ||
        !isFiniteNumber(bar?.o) ||
        !isFiniteNumber(bar?.h) ||
        !isFiniteNumber(bar?.l) ||
        !isFiniteNumber(bar?.c)
      ) {
        continue;
      }
      bySecond.set(Math.floor(bar.time / 1000), bar);
    }
    const ordered = [...bySecond.entries()].sort(
      (left, right) => left[0] - right[0],
    );
    candleSeriesRef.current.setData(
      ordered.map(([time, bar]) => ({
        time,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
      })),
    );
    volumeSeriesRef.current.setData(
      ordered.map(([time, bar]) => ({
        time,
        value: isFiniteNumber(bar.v) ? bar.v : 0,
        color: bar.c >= bar.o ? upVolume : downVolume,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`${symbol} candle chart`}
      data-testid="symbol-intel-chart"
      style={{ width: "100%", height: dim(CHART_HEIGHT), minHeight: 0 }}
    />
  );
};

const intelLabelStyle = {
  color: CSS_COLOR.textDim,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

// Uppercase micro-label over a mono tabular value — the era-3 stat idiom
// (reference: TopStat in MarketDemoScreen.jsx).
const IntelStat = ({ label, value, tone = CSS_COLOR.text }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: sp(2), minWidth: 0 }}>
    <span style={intelLabelStyle}>{label}</span>
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

const sectionStyle = {
  padding: sp("8px 10px"),
  borderTop: `1px solid ${CSS_COLOR.border}`,
};

export const SymbolIntelPanel = ({ symbol, onTrade, onResearch, style }) => {
  const normalizedSymbol = symbol?.trim?.().toUpperCase?.() || "";
  const enabled = Boolean(normalizedSymbol);
  const [timeframe, setTimeframe] = useState("15m");

  const barsQuery = useGetBars(
    { symbol: normalizedSymbol, timeframe, limit: CHART_BAR_LIMIT },
    {
      query: { enabled, staleTime: 30_000, refetchInterval: false },
      // Visible-chart hydration headers (same as chartApiBars.js) — without
      // them route admission classes this as shed-able deferred analytics.
      request: buildBarsRequestOptions(
        BARS_REQUEST_PRIORITY.visible,
        "chart-visible",
      ),
    },
  );
  const chartBars = useMemo(
    () => buildChartBarsFromApi(barsQuery.data?.bars),
    [barsQuery.data],
  );

  const quotesQuery = useGetQuoteSnapshots(
    { symbols: normalizedSymbol },
    { query: { enabled, staleTime: 30_000, refetchInterval: false } },
  );
  const quote =
    quotesQuery.data?.quotes?.find(
      (entry) => entry.symbol === normalizedSymbol,
    ) ||
    quotesQuery.data?.quotes?.[0] ||
    null;

  const flowQuery = useListFlowEvents(
    { underlying: normalizedSymbol, limit: FLOW_EVENT_LIMIT },
    { query: { enabled, staleTime: 30_000, refetchInterval: false } },
  );
  const flow = useMemo(
    () => summarizeSymbolFlow(flowQuery.data?.events),
    [flowQuery.data],
  );

  const earningsWindow = useMemo(() => {
    const from = new Date();
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + EARNINGS_WINDOW_DAYS);
    return { from: formatIsoDate(from), to: formatIsoDate(to) };
  }, []);
  const earningsQuery = useGetResearchEarningsCalendar(earningsWindow, {
    query: {
      enabled: Boolean(enabled && earningsWindow.from && earningsWindow.to),
      staleTime: 300_000,
      refetchInterval: false,
      retry: false,
    },
  });
  const earningsEntry = useMemo(() => {
    const entries = earningsQuery.data?.entries || [];
    return (
      entries
        .filter((entry) => entry.symbol === normalizedSymbol && entry.date)
        .sort((left, right) => String(left.date).localeCompare(String(right.date)))[0] ||
      null
    );
  }, [earningsQuery.data, normalizedSymbol]);

  const signalState = useSignalMonitorStateForSymbol(normalizedSymbol);
  const signalDirection = signalState?.currentSignalDirection;
  const hasSignal = signalDirection === "buy" || signalDirection === "sell";
  const signalFresh = Boolean(signalState?.fresh);
  const signalTone = hasSignal
    ? toneForDirectionalIntent(signalDirection, SEMANTIC_TONE.neutral)
    : CSS_COLOR.textMuted;

  const changeTone = toneForFinancialDelta(
    quote?.changePercent,
    CSS_COLOR.textMuted,
  );
  const netFlowTone =
    flow.total > 0
      ? toneForDirectionalIntent(flow.net >= 0 ? "bullish" : "bearish")
      : CSS_COLOR.textMuted;

  return (
    <Card
      noPad
      elevated
      data-testid="symbol-intel-panel"
      style={{ width: "100%", ...style }}
    >
      {/* Header: symbol + last price + signal state */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          padding: sp("8px 10px"),
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: sp(8),
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: CSS_COLOR.text,
              fontFamily: T.data,
              fontSize: textSize("displaySmall"),
              fontWeight: FONT_WEIGHTS.emphasis,
              letterSpacing: "0.02em",
              lineHeight: 1,
            }}
          >
            {normalizedSymbol}
          </span>
          {quotesQuery.isPending ? (
            <Skeleton width={dim(52)} height={dim(12)} />
          ) : (
            <span
              style={{
                color: CSS_COLOR.text,
                fontFamily: T.data,
                fontSize: textSize("paragraphMuted"),
                fontWeight: FONT_WEIGHTS.label,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {formatQuotePrice(quote?.price)}
            </span>
          )}
        </span>
        <StatusPill color={signalTone} glow={hasSignal && signalFresh}>
          {hasSignal
            ? [
                signalDirection.toUpperCase(),
                signalState?.timeframe || null,
                signalFresh ? "fresh" : "stale",
              ]
                .filter(Boolean)
                .join(" · ")
            : "No signal"}
        </StatusPill>
      </div>

      {/* Chart: timeframe switcher + candles/volume */}
      <div style={sectionStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(8),
            marginBottom: sp(6),
          }}
        >
          <span style={intelLabelStyle}>Chart</span>
          <SegmentedControl
            ariaLabel={`${normalizedSymbol} chart timeframe`}
            options={TIMEFRAME_OPTIONS}
            value={timeframe}
            onChange={setTimeframe}
            buttonTestId="symbol-intel-timeframe"
          />
        </div>
        {barsQuery.isPending ? (
          <ChartSkeleton height={CHART_HEIGHT} />
        ) : barsQuery.isError ? (
          <DataUnavailableState
            variant="error"
            minHeight={CHART_HEIGHT}
            title="Chart unavailable"
            detail={`No ${timeframe} bars were returned for ${normalizedSymbol}.`}
          />
        ) : chartBars.length === 0 ? (
          <DataUnavailableState
            minHeight={CHART_HEIGHT}
            title="No bars"
            detail={`The provider returned no ${timeframe} history for ${normalizedSymbol}.`}
          />
        ) : (
          <IntelCandleChart bars={chartBars} symbol={normalizedSymbol} />
        )}
      </div>

      {/* Key levels */}
      <div style={sectionStyle}>
        {quotesQuery.isPending ? (
          <Skeleton height={dim(26)} />
        ) : quotesQuery.isError || !quote ? (
          <DataUnavailableState
            minHeight={40}
            title="Quote unavailable"
            detail="No live quote snapshot was returned."
          />
        ) : (
          <div
            data-testid="symbol-intel-levels"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: sp(8),
            }}
          >
            <IntelStat
              label="Prev close"
              value={formatQuotePrice(quote.prevClose)}
            />
            <IntelStat label="Day high" value={formatQuotePrice(quote.high)} />
            <IntelStat label="Day low" value={formatQuotePrice(quote.low)} />
            <IntelStat
              label="Chg%"
              value={formatSignedPercent(quote.changePercent)}
              tone={changeTone}
            />
          </div>
        )}
      </div>

      {/* Options flow rollup */}
      <div style={sectionStyle}>
        <div style={{ ...intelLabelStyle, marginBottom: sp(4) }}>
          Options flow · last {FLOW_EVENT_LIMIT}
        </div>
        {flowQuery.isPending ? (
          <Skeleton height={dim(26)} />
        ) : flowQuery.isError ? (
          <DataUnavailableState
            minHeight={40}
            title="Flow unavailable"
            detail="The options-flow scan did not return."
          />
        ) : flow.total === 0 ? (
          <DataUnavailableState
            minHeight={40}
            title="No recent prints"
            detail={`No options flow events for ${normalizedSymbol} in the latest scan.`}
          />
        ) : (
          <div
            data-testid="symbol-intel-flow"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: sp(8),
            }}
          >
            <IntelStat
              label="Net prem"
              value={`${flow.net >= 0 ? "+" : "-"}${fmtM(Math.abs(flow.net))}`}
              tone={netFlowTone}
            />
            <IntelStat
              label="Calls"
              value={`${flow.callCount} · ${fmtM(flow.callPremium)}`}
              tone={SEMANTIC_TONE.directionBuy}
            />
            <IntelStat
              label="Puts"
              value={`${flow.putCount} · ${fmtM(flow.putPremium)}`}
              tone={SEMANTIC_TONE.directionSell}
            />
          </div>
        )}
      </div>

      {/* Context strip — earnings only in the pilot. Renders nothing while
          loading, on error (research provider may be unconfigured/gated), or
          when the symbol has no entry inside the window.
          TODO(symbol-intel-pilot): sector/rel-volume/halt context needs a
          lighter endpoint than the GEX dashboard call — skipped in the pilot. */}
      {earningsEntry ? (
        <div
          data-testid="symbol-intel-earnings"
          style={{
            ...sectionStyle,
            display: "flex",
            alignItems: "center",
            gap: sp(8),
          }}
        >
          <span style={intelLabelStyle}>Earnings</span>
          <span
            style={{
              color: CSS_COLOR.textSec,
              fontFamily: T.data,
              fontSize: textSize("body"),
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {formatCalendarMeta(earningsEntry.date, earningsEntry.time)}
          </span>
          {isFiniteNumber(earningsEntry.epsEstimated) ? (
            <span
              style={{
                color: CSS_COLOR.textMuted,
                fontFamily: T.data,
                fontSize: textSize("body"),
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              est EPS {earningsEntry.epsEstimated.toFixed(2)}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Quick actions */}
      <div
        style={{
          ...sectionStyle,
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: sp(8),
        }}
      >
        <Button
          variant="primary"
          size="sm"
          fullWidth
          disabled={!onTrade}
          dataTestId="symbol-intel-trade"
          onClick={() => onTrade?.(normalizedSymbol)}
        >
          Trade
        </Button>
        <Button
          variant="soft"
          size="sm"
          fullWidth
          disabled={!onResearch}
          dataTestId="symbol-intel-research"
          onClick={() => onResearch?.(normalizedSymbol)}
        >
          Research
        </Button>
      </div>
    </Card>
  );
};

export default SymbolIntelPanel;
