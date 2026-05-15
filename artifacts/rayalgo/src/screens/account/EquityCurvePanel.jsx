import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RADII, T, dim, fs, sp } from "../../lib/uiTokens";
import { formatAppDate, formatAppDateTime, formatAppTime } from "../../lib/timeZone";
import {
  ACCOUNT_RANGES,
  EmptyState,
  Panel,
  Pill,
  formatAccountMoney,
  formatAccountPercent,
  formatAccountPrice,
  formatAccountSignedMoney,
} from "./accountUtils";
import {
  buildAnchoredValueDomain,
  buildPaddedValueDomain,
  buildTransferAdjustedPnlSeries,
  buildEquityCurvePointSummary,
  equityRangeResponseMatches,
  joinBenchmarkPercentSeries,
  mapEquityEventsToPoints,
  normalizeEquityPointSeries,
  resolveStableEquityRangeResponse,
} from "./equityCurveData";
import { AppTooltip } from "@/components/ui/tooltip";


const EQUITY_CHART_MODES = [
  { value: "nav", label: "NAV" },
  { value: "pnl", label: "P&L" },
];

const DEFAULT_VISIBLE_BENCHMARKS = {
  SPY: true,
  QQQ: false,
  DJIA: false,
};

const useStableEquityRangeResponse = (
  response,
  range,
  { allowMismatchedFallback = false, acceptResponse = true, resetKey = "" } = {},
) => {
  const fallbackRef = useRef(null);
  const resetKeyRef = useRef(resetKey);
  if (resetKeyRef.current !== resetKey) {
    resetKeyRef.current = resetKey;
    fallbackRef.current = null;
  }
  const matchesRange = equityRangeResponseMatches(response, range);
  if (matchesRange && acceptResponse) {
    fallbackRef.current = response;
  }
  const fallback =
    allowMismatchedFallback || equityRangeResponseMatches(fallbackRef.current, range)
      ? fallbackRef.current
      : null;
  return resolveStableEquityRangeResponse({
    response,
    fallback,
    range,
    acceptResponse,
  });
};

const benchmarkRangeReady = (benchmarkQuery, range) => {
  if (equityRangeResponseMatches(benchmarkQuery?.data, range)) return true;
  return Boolean(benchmarkQuery?.isError || benchmarkQuery?.error);
};

const FlatToggle = ({ options, value, onChange, compact = false }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: sp(1),
      padding: sp(1),
      border: "none",
      borderRadius: dim(RADII.xs),
      background: T.bg0,
      minWidth: 0,
      overflow: "hidden",
    }}
  >
    {options.map((option) => {
      const item = typeof option === "string" ? { value: option, label: option } : option;
      const active = item.value === value;
      return (
        <button
          key={item.value}
          type="button"
          className={active ? "ra-focus-rail ra-interactive" : "ra-interactive"}
          onClick={() => onChange(item.value)}
          style={{
            border: "none",
            borderRadius: dim(3),
            background: active ? T.accent : "transparent",
            color: active ? "#ffffff" : T.textMuted,
            height: dim(compact ? 18 : 20),
            minWidth: dim(compact ? 25 : 30),
            padding: sp(compact ? "0 5px" : "0 7px"),
            fontSize: fs(compact ? 7 : 8),
            fontFamily: T.sans,
            fontWeight: 400,
            cursor: "pointer",
            letterSpacing: 0,
            whiteSpace: "nowrap",
          }}
        >
          {item.label}
        </button>
      );
    })}
  </div>
);

const FlatChip = ({
  active,
  disabled = false,
  color = T.accent,
  children,
  onClick,
  title,
}) => (
  <AppTooltip content={title}><button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={active ? "ra-focus-rail ra-interactive" : "ra-interactive"}
    style={{
      height: dim(20),
      justifyContent: "center",
      borderRadius: dim(RADII.xs),
      border: `1px solid ${active ? color : T.border}`,
      background: active ? `${color}1f` : "transparent",
      color: disabled ? T.textDim : active ? color : T.textMuted,
      minWidth: dim(24),
      padding: sp("0 6px"),
      fontSize: fs(8),
      fontFamily: T.sans,
      fontWeight: 400,
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.45 : 1,
      letterSpacing: 0,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </button></AppTooltip>
);

const ChartTooltip = ({
  active,
  payload,
  label,
  currency,
  benchmarks,
  maskValues = false,
  range,
  chartMode,
}) => {
  if (!active || !payload?.length) return null;
  const activePoint = payload.find((item) => item?.payload?.timestampMs != null)?.payload;
  const nav =
    payload.find((item) => item.dataKey === "netLiquidation")?.value ??
    activePoint?.netLiquidation;
  const pnl =
    payload.find((item) => item.dataKey === "cumulativePnl")?.value ??
    activePoint?.cumulativePnl;
  const ret =
    payload.find((item) => item.dataKey === "returnPercent")?.value ??
    activePoint?.returnPercent;
  const tooltipTimestamp = activePoint?.timestampMs ?? label;
  const benchmarkItems = benchmarks
    .map((benchmark) => {
      const item = payload.find((entry) => entry.dataKey === benchmark.dataKey);
      return item?.value != null
        ? {
            label: benchmark.label,
            color: benchmark.color,
            value: item.value,
          }
        : null;
    })
    .filter(Boolean);
  return (
    <div
      style={{
        background: T.bg0,
        border: "none",
        borderRadius: dim(RADII.sm),
        padding: sp(8),
        color: T.text,
        fontSize: fs(10),
        fontFamily: T.sans,
      }}
    >
      <div style={{ color: T.textMuted }}>
        {range === "1D"
          ? formatAxisTick(tooltipTimestamp, range)
          : formatAppDateTime(tooltipTimestamp)}
      </div>
      <div style={{ marginTop: sp(4), fontWeight: 400 }}>
        {chartMode === "pnl"
          ? formatAccountSignedMoney(pnl, currency, false, maskValues)
          : formatAccountMoney(nav, currency, false, maskValues)}
      </div>
      <div style={{ marginTop: sp(2), color: toneColor(ret) }}>
        {chartMode === "pnl"
          ? `NAV ${formatAccountMoney(nav, currency, true, maskValues)}`
          : formatAccountPercent(ret, 2, maskValues)}
      </div>
      {benchmarkItems.map((benchmark) => (
        <div key={benchmark.label} style={{ marginTop: sp(2), color: benchmark.color }}>
          {benchmark.label} {formatAccountPercent(benchmark.value, 2, maskValues)}
        </div>
      ))}
    </div>
  );
};

const toneColor = (value) =>
  value == null || Number.isNaN(Number(value))
    ? T.textDim
    : Number(value) >= 0
      ? T.green
      : T.red;

const equityEventColor = (event) => {
  if (event?.type === "withdrawal") return T.red;
  if (event?.type === "dividend") return T.accent;
  if (event?.type === "trade_buy") return T.cyan;
  if (event?.type === "trade_sell") return toneColor(event?.realizedPnl ?? event?.amount);
  return T.green;
};

const equityEventRadius = (event, compact) =>
  event?.type === "trade_buy" || event?.type === "trade_sell"
    ? compact
      ? 2.15
      : 2.55
    : compact
      ? 2.6
      : 3;

const equityEventTitle = (event) => {
  if (!event) return "Event";
  if (event.symbol && event.side) {
    return `${event.symbol} ${String(event.side).toUpperCase()}`;
  }
  return String(event.type || "event").replace(/_/g, " ").toUpperCase();
};

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatAxisTick = (value, range) =>
  range === "1D"
    ? formatAppTime(value, {
        hour: "numeric",
        minute: "2-digit",
      })
    : formatAppDate(value, {
        month: "short",
        day: "numeric",
      });

const inspectionDateFromPoint = (point) => {
  const timestampMs = finiteNumber(point?.timestampMs);
  if (timestampMs == null) return null;
  return new Date(timestampMs).toISOString().slice(0, 10);
};

const EquityCurveChartSurface = memo(({
  data,
  compact,
  emitHoverInspectionDate,
  clearHoverInspectionDate,
  pinInspectionDate,
  equityFillId,
  accentColor,
  leftAxisDomain,
  rightAxisDomain,
  chartMode,
  chartDataKey,
  currency,
  maskValues,
  displayRange,
  benchmarks,
  visibleBenchmarks,
  availableBenchmarkKeys,
  showEvents,
  events,
  activeInspectionPoint,
  pinnedInspectionDate,
  setActiveEvent,
}) => (
  <div style={{ width: "100%", height: dim(compact ? 148 : 158) }}>
    <ResponsiveContainer>
      <ComposedChart
        data={data}
        onMouseMove={(state) => {
          emitHoverInspectionDate(state?.activePayload?.[0]?.payload);
        }}
        onMouseLeave={clearHoverInspectionDate}
        onClick={(state) => {
          pinInspectionDate(state?.activePayload?.[0]?.payload);
        }}
        margin={{
          top: compact ? 2 : 8,
          right: compact ? 2 : 12,
          bottom: 0,
          left: compact ? -8 : 0,
        }}
      >
        <defs>
          <linearGradient id={equityFillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor} stopOpacity={0.16} />
            <stop offset="100%" stopColor={accentColor} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke={T.borderLight}
          strokeDasharray="0"
          vertical={false}
        />
        <XAxis
          dataKey="timestampMs"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tick={{ fill: T.textMuted, fontSize: fs(compact ? 8 : 9) }}
          tickFormatter={(value) => formatAxisTick(value, displayRange)}
          minTickGap={compact ? 42 : 28}
          stroke="none"
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="left"
          domain={leftAxisDomain}
          tick={{ fill: T.textMuted, fontSize: fs(compact ? 8 : 9) }}
          tickFormatter={(value) =>
            chartMode === "pnl"
              ? formatAccountSignedMoney(value, currency, true, maskValues)
              : formatAccountMoney(value, currency, true, maskValues)
          }
          width={compact ? 48 : 64}
          stroke="none"
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={rightAxisDomain}
          tick={{ fill: T.textMuted, fontSize: fs(compact ? 8 : 9) }}
          tickFormatter={(value) => `${value.toFixed(0)}%`}
          width={compact ? 28 : 42}
          stroke="none"
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={
            <ChartTooltip
              currency={currency}
              benchmarks={benchmarks}
              maskValues={maskValues}
              range={displayRange}
              chartMode={chartMode}
            />
          }
        />
        {activeInspectionPoint ? (
          <ReferenceLine
            yAxisId="left"
            x={activeInspectionPoint.timestampMs}
            stroke={pinnedInspectionDate ? T.accent : T.textMuted}
            strokeDasharray={pinnedInspectionDate ? "2 0" : "3 3"}
            ifOverflow="extendDomain"
          />
        ) : null}
        <Area
          yAxisId="left"
          type="monotone"
          dataKey={chartDataKey}
          stroke={accentColor}
          fill={`url(#${equityFillId})`}
          strokeWidth={compact ? 1.5 : 1.25}
          dot={false}
          isAnimationActive={false}
        />
        {benchmarks.map((benchmark) =>
          visibleBenchmarks[benchmark.key] &&
          availableBenchmarkKeys.has(benchmark.key) ? (
            <Line
              key={benchmark.key}
              yAxisId="right"
              type="monotone"
              dataKey={benchmark.dataKey}
              stroke={benchmark.color}
              strokeWidth={compact ? 1.25 : 1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ) : null,
        )}
        {showEvents
          ? events.map((event, index) => (
              (chartMode !== "pnl" || event.cumulativePnl != null) ? (
                <ReferenceDot
                  key={`${event.timestamp}:${event.type}:${event.symbol || "cash"}:${index}`}
                  yAxisId="left"
                  x={event.timestampMs}
                  y={chartMode === "pnl" ? event.cumulativePnl : event.netLiquidation}
                  r={equityEventRadius(event, compact)}
                  fill={equityEventColor(event)}
                  stroke="none"
                  onMouseEnter={() => setActiveEvent(event)}
                  onMouseLeave={() => setActiveEvent(null)}
                />
              ) : null
            ))
          : null}
      </ComposedChart>
    </ResponsiveContainer>
  </div>
));

EquityCurveChartSurface.displayName = "EquityCurveChartSurface";

export const EquityCurvePanel = ({
  query,
  benchmarkQueries,
  visibleBenchmarks: controlledVisibleBenchmarks,
  onVisibleBenchmarksChange,
  range,
  onRangeChange,
  currency,
  accentColor = T.green,
  rightRail,
  sourceLabel = "Flex",
  maskValues = false,
  currentNetLiquidation = null,
  activeInspectionDate = null,
  pinnedInspectionDate = null,
  onHoverInspectionDate,
  onPinInspectionDate,
  dataScopeKey = "",
  compact = false,
}) => {
  const [showEvents, setShowEvents] = useState(true);
  const [chartMode, setChartMode] = useState("nav");
  const [activeEvent, setActiveEvent] = useState(null);
  const hoverRafRef = useRef(null);
  const lastHoverDateRef = useRef(null);
  const [internalVisibleBenchmarks, setInternalVisibleBenchmarks] = useState(
    DEFAULT_VISIBLE_BENCHMARKS,
  );
  const visibleBenchmarks = controlledVisibleBenchmarks || internalVisibleBenchmarks;
  const updateVisibleBenchmarks = useCallback(
    (updater) => {
      const nextVisibleBenchmarks =
        typeof updater === "function" ? updater(visibleBenchmarks) : updater;
      if (onVisibleBenchmarksChange) {
        onVisibleBenchmarksChange(nextVisibleBenchmarks);
      } else {
        setInternalVisibleBenchmarks(nextVisibleBenchmarks);
      }
    },
    [onVisibleBenchmarksChange, visibleBenchmarks],
  );
  const rangeReadyForVisibleBenchmarks =
    (!visibleBenchmarks.SPY || benchmarkRangeReady(benchmarkQueries?.SPY, range)) &&
    (!visibleBenchmarks.QQQ || benchmarkRangeReady(benchmarkQueries?.QQQ, range)) &&
    (!visibleBenchmarks.DJIA || benchmarkRangeReady(benchmarkQueries?.DJIA, range));
  const selectedRangeReady =
    equityRangeResponseMatches(query.data, range) && rangeReadyForVisibleBenchmarks;
  const chartData = useStableEquityRangeResponse(query.data, range, {
    allowMismatchedFallback: true,
    acceptResponse: selectedRangeReady,
    resetKey: dataScopeKey,
  });
  const displayRange = chartData?.range || range;
  const spyBenchmarkData = useStableEquityRangeResponse(
    benchmarkQueries?.SPY?.data,
    displayRange,
    { resetKey: dataScopeKey },
  );
  const qqqBenchmarkData = useStableEquityRangeResponse(
    benchmarkQueries?.QQQ?.data,
    displayRange,
    { resetKey: dataScopeKey },
  );
  const djiaBenchmarkData = useStableEquityRangeResponse(
    benchmarkQueries?.DJIA?.data,
    displayRange,
    { resetKey: dataScopeKey },
  );
  const benchmarks = useMemo(
    () => [
      {
        key: "SPY",
        label: "SPY",
        dataKey: "benchmarkSpyPercent",
        tone: "accent",
        color: T.accent,
        data: spyBenchmarkData,
      },
      {
        key: "QQQ",
        label: "QQQ",
        dataKey: "benchmarkQqqPercent",
        tone: "purple",
        color: T.purple,
        data: qqqBenchmarkData,
      },
      {
        key: "DJIA",
        label: "DJIA",
        dataKey: "benchmarkDjiaPercent",
        tone: "amber",
        color: T.amber,
        data: djiaBenchmarkData,
      },
    ],
    [djiaBenchmarkData, qqqBenchmarkData, spyBenchmarkData],
  );
  const emitHoverInspectionDate = useCallback(
    (point) => {
      if (!onHoverInspectionDate) return;
      const nextDate = inspectionDateFromPoint(point);
      if (nextDate === lastHoverDateRef.current) return;
      lastHoverDateRef.current = nextDate;
      if (hoverRafRef.current) {
        cancelAnimationFrame(hoverRafRef.current);
      }
      hoverRafRef.current = requestAnimationFrame(() => {
        onHoverInspectionDate(nextDate);
        hoverRafRef.current = null;
      });
    },
    [onHoverInspectionDate],
  );
  const clearHoverInspectionDate = useCallback(() => {
    if (hoverRafRef.current) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    lastHoverDateRef.current = null;
    onHoverInspectionDate?.(null);
  }, [onHoverInspectionDate]);
  const pinInspectionDate = useCallback(
    (point) => {
      const nextDate = inspectionDateFromPoint(point);
      if (nextDate) {
        onPinInspectionDate?.(nextDate);
      }
    },
    [onPinInspectionDate],
  );
  useEffect(
    () => () => {
      if (hoverRafRef.current) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
    },
    [],
  );
  const data = useMemo(
    () => {
      const equityPoints = normalizeEquityPointSeries(chartData?.points || []);
      const pnlValues = buildTransferAdjustedPnlSeries(equityPoints);
      const benchmarkValues = benchmarks
        .filter((benchmark) => visibleBenchmarks[benchmark.key])
        .reduce((accumulator, benchmark) => {
          accumulator[benchmark.key] = joinBenchmarkPercentSeries(
            equityPoints,
            equityRangeResponseMatches(benchmark.data, displayRange)
              ? benchmark.data?.points || []
              : [],
            displayRange,
          );
          return accumulator;
        }, {});
      return equityPoints.map((point, index) => ({
        ...point,
        cumulativePnl: pnlValues[index] ?? null,
        benchmarkSpyPercent: benchmarkValues.SPY?.[index] ?? null,
        benchmarkQqqPercent: benchmarkValues.QQQ?.[index] ?? null,
        benchmarkDjiaPercent: benchmarkValues.DJIA?.[index] ?? null,
      }));
    },
    [
      benchmarks,
      chartData?.points,
      displayRange,
      visibleBenchmarks,
    ],
  );
  const events = useMemo(
    () => mapEquityEventsToPoints(chartData?.events || [], data, displayRange),
    [chartData?.events, data, displayRange],
  );
  const chartSummary = useMemo(() => buildEquityCurvePointSummary(data), [data]);
  const {
    firstPoint,
    lastPoint,
    minNav,
    maxNav,
    minPnl,
    maxPnl,
    transferAdjustedPnl: delta,
  } = chartSummary;
  const deltaPercent = finiteNumber(lastPoint?.returnPercent);
  const headlineNetLiquidation =
    currentNetLiquidation != null && Number.isFinite(Number(currentNetLiquidation))
      ? Number(currentNetLiquidation)
      : lastPoint?.netLiquidation;
  const availableBenchmarks = useMemo(
    () =>
      benchmarks.filter(
        (benchmark) =>
          equityRangeResponseMatches(benchmark.data, displayRange) &&
          Boolean(benchmark.data?.points?.length),
      ),
    [benchmarks, displayRange],
  );
  const availableBenchmarkKeys = useMemo(
    () => new Set(availableBenchmarks.map((benchmark) => benchmark.key)),
    [availableBenchmarks],
  );
  const hasPoints = data.length > 0;
  const chartDataKey = chartMode === "pnl" ? "cumulativePnl" : "netLiquidation";
  const leftAxisDomain = useMemo(
    () =>
      buildPaddedValueDomain(
        data.map((point) => point[chartDataKey]),
        {
          paddingRatio: 0.08,
          minPadding: chartMode === "pnl" ? 1 : 5,
          floor: chartMode === "pnl" ? null : 0,
        },
      ),
    [chartDataKey, chartMode, data],
  );
  const benchmarkAnchorRatio = useMemo(() => {
    const leftMin = Number(leftAxisDomain?.[0]);
    const leftMax = Number(leftAxisDomain?.[1]);
    const leftAnchor =
      chartMode === "pnl"
        ? finiteNumber(firstPoint?.cumulativePnl)
        : finiteNumber(firstPoint?.netLiquidation);
    if (
      !Number.isFinite(leftMin) ||
      !Number.isFinite(leftMax) ||
      !Number.isFinite(leftAnchor) ||
      leftMax === leftMin
    ) {
      return null;
    }
    return Math.min(0.999, Math.max(0.001, (leftMax - leftAnchor) / (leftMax - leftMin)));
  }, [chartMode, firstPoint?.cumulativePnl, firstPoint?.netLiquidation, leftAxisDomain]);
  const visibleBenchmarkDataKeys = useMemo(
    () =>
      benchmarks
        .filter((benchmark) => visibleBenchmarks[benchmark.key])
        .map((benchmark) => benchmark.dataKey),
    [benchmarks, visibleBenchmarks],
  );
  const rightAxisDomain = useMemo(
    () =>
      buildAnchoredValueDomain(
        data.flatMap((point) =>
          visibleBenchmarkDataKeys.map((dataKey) => point[dataKey]),
        ),
        {
          anchorValue: 0,
          anchorRatio: benchmarkAnchorRatio ?? 0.5,
          paddingRatio: 0.12,
          minPadding: 1,
        },
      ),
    [benchmarkAnchorRatio, data, visibleBenchmarkDataKeys],
  );
  const headlineValue =
    chartMode === "pnl" ? delta : headlineNetLiquidation;
  const equityFillId = useMemo(
    () => `accountEquityFill-${String(accentColor).replace(/[^a-z0-9]/gi, "")}`,
    [accentColor],
  );
  const activeInspectionPoint = useMemo(
    () =>
      activeInspectionDate
        ? data.find((point) => inspectionDateFromPoint(point) === activeInspectionDate) || null
        : null,
    [activeInspectionDate, data],
  );
  const baseRightRail =
    rightRail ?? (chartData?.flexConfigured ? "Flex + snapshots" : "Snapshots");
  const blockingError = hasPoints ? null : query.error;

  return (
    <Panel
      title="Equity Curve"
      rightRail={baseRightRail}
      loading={(query.isPending || query.isLoading) && !hasPoints}
      error={blockingError}
      onRetry={query.refetch}
      minHeight={compact ? 246 : 256}
      action={
        compact ? null : (
          <FlatToggle options={ACCOUNT_RANGES} value={range} onChange={onRangeChange} />
        )
      }
    >
      {!hasPoints && !chartData?.flexConfigured ? (
        <EmptyState
          title="No equity history yet"
          body="Recorded account snapshots have not populated yet. Flex is only required for full lifetime NAV, deposits, withdrawals, dividends, fees, and trade history."
        />
      ) : !hasPoints ? (
        <EmptyState
          title="No equity history yet"
          body="The Flex job is configured, but no NAV rows or recorded snapshots were returned yet. Run Test Flex Token, confirm account snapshots are recording, or wait for the next refresh."
        />
      ) : (
        <div style={{ display: "grid", gap: sp(compact ? 3 : 5) }}>
          {!chartData?.flexConfigured ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
              <Pill tone="amber">
                Flex not configured
              </Pill>
              <Pill tone="default">
                Showing recorded snapshots only
              </Pill>
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: sp(compact ? 4 : 6),
              alignItems: "center",
              justifyContent: "space-between",
              minWidth: 0,
            }}
          >
            <div
              style={{
                minWidth: 0,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "baseline",
                gap: sp("2px 6px"),
              }}
            >
              <div
                style={{
                  color: T.text,
                  fontSize: fs(compact ? 16 : 15),
                  fontFamily: T.sans,
                  fontWeight: 400,
                  letterSpacing: 0,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {chartMode === "pnl"
                  ? formatAccountSignedMoney(headlineValue, currency, false, maskValues)
                  : formatAccountMoney(headlineValue, currency, false, maskValues)}
              </div>
              <div
                style={{
                  color: toneColor(deltaPercent ?? delta),
                  fontSize: fs(compact ? 8 : 9),
                  fontFamily: T.sans,
                  fontWeight: 400,
                  lineHeight: 1.25,
                  whiteSpace: "nowrap",
                }}
              >
                {chartMode === "pnl" ? (
                  <>
                    NAV {formatAccountMoney(headlineNetLiquidation, currency, true, maskValues)} ·{" "}
                    {formatAccountPercent(deltaPercent, 2, maskValues)}
                  </>
                ) : (
                  <>
                    {formatAccountSignedMoney(delta, currency, true, maskValues)} ·{" "}
                    {formatAccountPercent(deltaPercent, 2, maskValues)}
                  </>
                )}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: sp(3),
                justifyContent: compact ? "flex-start" : "flex-end",
                alignItems: "center",
              }}
            >
              <FlatToggle
                options={EQUITY_CHART_MODES}
                value={chartMode}
                onChange={setChartMode}
                compact={compact}
              />
              <FlatChip
                active={showEvents}
                color={T.green}
                onClick={() => setShowEvents((current) => !current)}
                title="Show deposits, withdrawals, dividends, cash events, and trade events on the chart"
              >
                Events
              </FlatChip>
              {benchmarks.map((benchmark) => {
                return (
                  <FlatChip
                    key={benchmark.key}
                    active={Boolean(visibleBenchmarks[benchmark.key])}
                    color={benchmark.color}
                    onClick={() => {
                      updateVisibleBenchmarks((current) => ({
                        ...current,
                        [benchmark.key]: !current[benchmark.key],
                      }));
                    }}
                  >
                    {benchmark.label}
                  </FlatChip>
                );
              })}
            </div>
          </div>

          {compact ? (
            <div
              style={{
                minWidth: 0,
                overflowX: "auto",
                paddingBottom: sp(1),
              }}
              className="ra-hide-scrollbar"
            >
              <FlatToggle
                options={ACCOUNT_RANGES}
                value={range}
                onChange={onRangeChange}
                compact
              />
            </div>
          ) : null}

          <EquityCurveChartSurface
            data={data}
            compact={compact}
            emitHoverInspectionDate={emitHoverInspectionDate}
            clearHoverInspectionDate={clearHoverInspectionDate}
            pinInspectionDate={pinInspectionDate}
            equityFillId={equityFillId}
            accentColor={accentColor}
            leftAxisDomain={leftAxisDomain}
            rightAxisDomain={rightAxisDomain}
            chartMode={chartMode}
            chartDataKey={chartDataKey}
            currency={currency}
            maskValues={maskValues}
            displayRange={displayRange}
            benchmarks={benchmarks}
            visibleBenchmarks={visibleBenchmarks}
            availableBenchmarkKeys={availableBenchmarkKeys}
            showEvents={showEvents}
            events={events}
            activeInspectionPoint={activeInspectionPoint}
            pinnedInspectionDate={pinnedInspectionDate}
            setActiveEvent={setActiveEvent}
          />

          <div
            aria-hidden={!activeEvent}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: sp("2px 8px"),
              alignItems: "center",
              minHeight: dim(compact ? 14 : 16),
              visibility: activeEvent ? "visible" : "hidden",
              color: T.textSec,
              fontFamily: T.sans,
              fontSize: fs(compact ? 7 : 8),
              lineHeight: 1.25,
              borderTop: `1px solid ${T.border}`,
              paddingTop: sp(3),
            }}
          >
            {activeEvent ? (
              <>
                <span style={{ color: equityEventColor(activeEvent), fontWeight: 400 }}>
                  {equityEventTitle(activeEvent)}
                </span>
                <span>{formatAppDateTime(activeEvent.timestamp)}</span>
                {activeEvent.quantity != null ? (
                  <span>{Number(activeEvent.quantity).toLocaleString()} sh</span>
                ) : null}
                {activeEvent.price != null ? (
                  <span>@ {formatAccountPrice(activeEvent.price, 2, maskValues)}</span>
                ) : null}
                {activeEvent.realizedPnl != null ? (
                  <span style={{ color: toneColor(activeEvent.realizedPnl), fontWeight: 400 }}>
                    P&L{" "}
                    {formatAccountSignedMoney(
                      activeEvent.realizedPnl,
                      currency,
                      true,
                      maskValues,
                    )}
                  </span>
                ) : activeEvent.amount != null ? (
                  <span style={{ color: toneColor(activeEvent.amount), fontWeight: 400 }}>
                    {formatAccountSignedMoney(activeEvent.amount, currency, true, maskValues)}
                  </span>
                ) : null}
                {activeEvent.source ? <span>{activeEvent.source}</span> : null}
              </>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: sp(compact ? 3 : 6),
              flexWrap: "wrap",
              color: T.textDim,
              fontSize: fs(compact ? 7 : 8),
              fontFamily: T.sans,
              lineHeight: 1.25,
            }}
          >
            <span>
              {formatAppDate(firstPoint?.timestamp)}
              {" -> "}
              {formatAppDate(lastPoint?.timestamp)}
            </span>
            <span>
              {chartMode === "pnl" ? (
                <>
                  H {formatAccountSignedMoney(maxPnl, currency, true, maskValues)} · L{" "}
                  {formatAccountSignedMoney(minPnl, currency, true, maskValues)}
                </>
              ) : (
                <>
                  H {formatAccountMoney(maxNav, currency, true, maskValues)} · L{" "}
                  {formatAccountMoney(minNav, currency, true, maskValues)}
                </>
              )}
            </span>
            <span>
              {sourceLabel}{" "}
              {chartData?.lastFlexRefreshAt
                ? formatAppDate(chartData.lastFlexRefreshAt)
                : "----"}
            </span>
            <span>
              Benchmarks{" "}
              {availableBenchmarks.length
                ? availableBenchmarks.map((benchmark) => benchmark.label).join(" · ")
                : "n/a"}
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
};

export default EquityCurvePanel;
