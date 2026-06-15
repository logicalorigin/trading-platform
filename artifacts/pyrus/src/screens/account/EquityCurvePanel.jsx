import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, cssColorAlpha, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { formatAppDateTime } from "../../lib/timeZone";
import { SegmentedControl } from "../../components/platform/primitives.jsx";
import { AppTooltip } from "@/components/ui/tooltip";
import { ResilienceMarker } from "../../components/platform/ResilienceMarker.jsx";
import { collectWidgetIssues } from "../../features/platform/resilienceIssues.js";
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
  buildEquityCurvePointSummary,
  buildTransferAdjustedPnlSeries,
  equityRangeResponseMatches,
  joinBenchmarkPercentSeries,
  mapEquityEventsToPoints,
  normalizeEquityPointSeries,
  resolveStableEquityRangeResponse,
} from "./equityCurveData";
import EquityCurveChart from "./EquityCurveChart";
import EquityCurveEventRibbon, {
  equityEventColor,
  equityEventTitle,
} from "./EquityCurveEventRibbon";

const EQUITY_CHART_MODES = [
  { value: "nav", label: "NAV" },
  { value: "pnl", label: "P&L" },
];

const DEFAULT_VISIBLE_BENCHMARKS = {
  SPY: true,
  QQQ: false,
  DJIA: false,
};

const CHART_HEIGHT = 360;
const CHART_HEIGHT_COMPACT = 220;
const PIN_OVERLAY_FADE_MS = 200;

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const toneColor = (value) =>
  value == null || Number.isNaN(Number(value))
    ? CSS_COLOR.textDim
    : Number(value) >= 0
      ? CSS_COLOR.green
      : CSS_COLOR.red;

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

const inspectionDateFromPoint = (point) => {
  const timestampMs = finiteNumber(point?.timestampMs);
  if (timestampMs == null) return null;
  return new Date(timestampMs).toISOString().slice(0, 10);
};

const ToggleChip = ({ active, color = CSS_COLOR.accent, onClick, children, title }) => (
  <AppTooltip content={title}>
    <button
      type="button"
      onClick={onClick}
      className={active ? "ra-focus-rail ra-interactive" : "ra-interactive"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(2),
        height: dim(22),
        padding: sp("0 8px"),
        borderRadius: dim(RADII.pill),
        border: `1px solid ${active ? color : CSS_COLOR.border}`,
        background: active ? cssColorAlpha(color, "1f") : "transparent",
        color: active ? color : CSS_COLOR.textMuted,
        fontSize: textSize("label"),
        fontFamily: T.sans,
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: dim(6),
          height: dim(6),
          borderRadius: dim(RADII.pill),
          background: active ? color : CSS_COLOR.borderLight,
          flexShrink: 0,
        }}
      />
      {children}
    </button>
  </AppTooltip>
);

const PinOverlay = ({ chart, timestampMs, compact, visible = true }) => {
  const [position, setPosition] = useState(null);

  const reposition = useCallback(() => {
    if (!chart || timestampMs == null) {
      setPosition(null);
      return;
    }
    const timeScale = chart.timeScale();
    if (!timeScale) {
      setPosition(null);
      return;
    }
    const seconds = Math.floor(Number(timestampMs) / 1000);
    const coordinate = timeScale.timeToCoordinate(seconds);
    if (coordinate == null || !Number.isFinite(coordinate)) {
      setPosition(null);
      return;
    }
    setPosition(Number(coordinate));
  }, [chart, timestampMs]);

  useEffect(() => {
    reposition();
  }, [reposition]);

  useEffect(() => {
    if (!chart) return undefined;
    const timeScale = chart.timeScale();
    if (!timeScale?.subscribeVisibleLogicalRangeChange) return undefined;
    const handler = () => reposition();
    timeScale.subscribeVisibleLogicalRangeChange(handler);
    return () => {
      try {
        timeScale.unsubscribeVisibleLogicalRangeChange(handler);
      } catch (error) {
        // ignore
      }
    };
  }, [chart, reposition]);

  if (position == null) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        top: dim(compact ? 4 : 8),
        bottom: dim(compact ? 16 : 22),
        left: position,
        width: 1,
        background: CSS_COLOR.accent,
        opacity: visible ? 1 : 0,
        transition: "opacity var(--ra-motion-standard) ease-out",
        pointerEvents: "none",
        transform: "translateX(-0.5px)",
      }}
    />
  );
};

export const EquityCurvePanel = ({
  query,
  benchmarkQueries,
  visibleBenchmarks: controlledVisibleBenchmarks,
  onVisibleBenchmarksChange,
  range,
  onRangeChange,
  currency,
  accentColor = CSS_COLOR.accent,
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
  const [scrubPoint, setScrubPoint] = useState(null);
  const [chartApi, setChartApi] = useState(null);
  const [fadingPinnedInspectionTimestampMs, setFadingPinnedInspectionTimestampMs] =
    useState(null);
  const hoverRafRef = useRef(null);
  const lastHoverDateRef = useRef(null);
  const previousPinnedInspectionTimestampMsRef = useRef(null);

  const [internalVisibleBenchmarks, setInternalVisibleBenchmarks] = useState(
    DEFAULT_VISIBLE_BENCHMARKS,
  );
  const visibleBenchmarks = controlledVisibleBenchmarks || internalVisibleBenchmarks;
  const updateVisibleBenchmarks = useCallback(
    (updater) => {
      const next = typeof updater === "function" ? updater(visibleBenchmarks) : updater;
      if (onVisibleBenchmarksChange) {
        onVisibleBenchmarksChange(next);
      } else {
        setInternalVisibleBenchmarks(next);
      }
    },
    [onVisibleBenchmarksChange, visibleBenchmarks],
  );

  const selectedRangeReady = equityRangeResponseMatches(query.data, range);
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
        color: CSS_COLOR.accent,
        data: spyBenchmarkData,
      },
      {
        key: "QQQ",
        label: "QQQ",
        dataKey: "benchmarkQqqPercent",
        color: CSS_COLOR.purple,
        data: qqqBenchmarkData,
      },
      {
        key: "DJIA",
        label: "DJIA",
        dataKey: "benchmarkDjiaPercent",
        color: CSS_COLOR.amber,
        data: djiaBenchmarkData,
      },
    ],
    [djiaBenchmarkData, qqqBenchmarkData, spyBenchmarkData],
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
    [benchmarks, chartData?.points, displayRange, visibleBenchmarks],
  );

  const events = useMemo(
    () => mapEquityEventsToPoints(chartData?.events || [], data, displayRange),
    [chartData?.events, data, displayRange],
  );
  const chartSummary = useMemo(() => buildEquityCurvePointSummary(data), [data]);
  const {
    lastPoint,
    minNav,
    maxNav,
    minPnl,
    maxPnl,
    transferAdjustedPnl: delta,
  } = chartSummary;

  const latestChartTimestamp =
    chartData?.asOf ?? chartData?.latestSnapshotAt ?? lastPoint?.timestamp ?? null;
  const latestSnapshotTimestamp = chartData?.latestSnapshotAt ?? latestChartTimestamp;
  const chartPointCountLabel = `${data.length.toLocaleString()} pts`;
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
  const visibleAvailableBenchmarks = useMemo(
    () => availableBenchmarks.filter((benchmark) => visibleBenchmarks[benchmark.key]),
    [availableBenchmarks, visibleBenchmarks],
  );

  const emitHoverInspectionDate = useCallback(
    (point) => {
      setScrubPoint(point || null);
      if (!onHoverInspectionDate) return;
      const nextDate = inspectionDateFromPoint(point);
      if (nextDate === lastHoverDateRef.current) return;
      lastHoverDateRef.current = nextDate;
      if (hoverRafRef.current) cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = requestAnimationFrame(() => {
        onHoverInspectionDate(nextDate);
        hoverRafRef.current = null;
      });
    },
    [onHoverInspectionDate],
  );

  const handleClickPoint = useCallback(
    (point) => {
      const nextDate = inspectionDateFromPoint(point);
      if (nextDate) onPinInspectionDate?.(nextDate);
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

  const hasPoints = data.length > 0;

  const displayedPoint = scrubPoint || lastPoint;
  const headlineValue =
    chartMode === "pnl"
      ? displayedPoint?.cumulativePnl ?? delta
      : scrubPoint
        ? displayedPoint?.netLiquidation
        : headlineNetLiquidation;
  const displayedDeltaPercent =
    scrubPoint ? finiteNumber(displayedPoint?.returnPercent) : deltaPercent;
  const displayedDelta =
    scrubPoint ? finiteNumber(displayedPoint?.cumulativePnl) : delta;

  const activeInspectionTimestampMs = useMemo(() => {
    if (!activeInspectionDate || !data.length) return null;
    const match = data.find(
      (point) => inspectionDateFromPoint(point) === activeInspectionDate,
    );
    return match?.timestampMs ?? null;
  }, [activeInspectionDate, data]);
  const pinnedInspectionTimestampMs = useMemo(() => {
    if (!pinnedInspectionDate || !data.length) return null;
    const match = data.find(
      (point) => inspectionDateFromPoint(point) === pinnedInspectionDate,
    );
    return match?.timestampMs ?? null;
  }, [pinnedInspectionDate, data]);
  useEffect(() => {
    if (pinnedInspectionTimestampMs != null) {
      previousPinnedInspectionTimestampMsRef.current = pinnedInspectionTimestampMs;
      setFadingPinnedInspectionTimestampMs(null);
      return undefined;
    }
    const previousTimestampMs = previousPinnedInspectionTimestampMsRef.current;
    if (previousTimestampMs == null) {
      return undefined;
    }
    setFadingPinnedInspectionTimestampMs(previousTimestampMs);
    const timer = window.setTimeout(() => {
      if (previousPinnedInspectionTimestampMsRef.current === previousTimestampMs) {
        previousPinnedInspectionTimestampMsRef.current = null;
      }
      setFadingPinnedInspectionTimestampMs(null);
    }, PIN_OVERLAY_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [pinnedInspectionTimestampMs]);
  const visiblePinnedInspectionTimestampMs =
    pinnedInspectionTimestampMs ?? fadingPinnedInspectionTimestampMs;

  const baseRightRail =
    rightRail ?? (chartData?.flexConfigured ? "Flex + snapshots" : "Snapshots");
  const blockingError = hasPoints ? null : query.error;
  const equityLoading = Boolean(
    !hasPoints &&
      (query?.isFetching ||
        (query?.isPending && query?.fetchStatus !== "idle")),
  );
  const chartHeight = compact ? CHART_HEIGHT_COMPACT : CHART_HEIGHT;

  // Equity history is served stale (isStale/staleReason) when the snapshot/Flex
  // read is degraded. Map onto the shared collector's stale/reason shape.
  const equityIssues = useMemo(
    () =>
      collectWidgetIssues(
        { stale: query.data?.isStale === true, reason: query.data?.staleReason },
        { valueLabel: "Equity history", source: "account" },
      ),
    [query.data?.isStale, query.data?.staleReason],
  );

  const headerControls = (
    <div
      style={{
        display: "flex",
        gap: sp(3),
        alignItems: "center",
        flexWrap: "wrap",
        justifyContent: "flex-end",
      }}
    >
      <SegmentedControl
        options={EQUITY_CHART_MODES}
        value={chartMode}
        onChange={setChartMode}
        ariaLabel="Chart mode"
      />
      <SegmentedControl
        options={ACCOUNT_RANGES}
        value={range}
        onChange={onRangeChange}
        ariaLabel="Equity range"
      />
    </div>
  );

  return (
    <Panel
      title={
        equityIssues.length ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: sp(3) }}>
            Equity Curve
            <ResilienceMarker issues={equityIssues} />
          </span>
        ) : (
          "Equity Curve"
        )
      }
      rightRail={baseRightRail}
      loading={equityLoading}
      error={blockingError}
      onRetry={query.refetch}
      minHeight={compact ? 320 : 460}
      action={compact ? null : headerControls}
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
        <div style={{ display: "grid", gap: sp(compact ? 4 : 6) }}>
          {!chartData?.flexConfigured ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
              <Pill tone="amber">Flex not configured</Pill>
              <Pill tone="default">Showing recorded snapshots only</Pill>
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: sp(6),
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0, display: "grid", gap: sp(2) }}>
              <div
                style={{
                  color: CSS_COLOR.text,
                  fontSize: fs(compact ? 22 : 28),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.regular,
                  lineHeight: 1,
                  letterSpacing: "-0.01em",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {chartMode === "pnl"
                  ? formatAccountSignedMoney(headlineValue, currency, false, maskValues)
                  : formatAccountMoney(headlineValue, currency, false, maskValues)}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: sp("2px 6px"),
                  alignItems: "baseline",
                  color: toneColor(displayedDeltaPercent ?? displayedDelta),
                  fontSize: textSize(compact ? "label" : "caption"),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.medium,
                  lineHeight: 1.2,
                }}
              >
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatAccountSignedMoney(displayedDelta, currency, true, maskValues)}
                </span>
                <span style={{ color: CSS_COLOR.textMuted }}>·</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatAccountPercent(displayedDeltaPercent, 2, maskValues)}
                </span>
                {scrubPoint?.timestamp ? (
                  <>
                    <span style={{ color: CSS_COLOR.textMuted }}>·</span>
                    <span style={{ color: CSS_COLOR.textMuted }}>
                      {formatAppDateTime(scrubPoint.timestamp)}
                    </span>
                  </>
                ) : null}
              </div>
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
              <SegmentedControl
                options={ACCOUNT_RANGES}
                value={range}
                onChange={onRangeChange}
                ariaLabel="Equity range"
              />
              <div style={{ height: sp(3) }} />
              <SegmentedControl
                options={EQUITY_CHART_MODES}
                value={chartMode}
                onChange={setChartMode}
                ariaLabel="Chart mode"
              />
            </div>
          ) : null}

          <div style={{ position: "relative", width: "100%" }}>
            <EquityCurveChart
              data={data}
              chartMode={chartMode}
              benchmarks={benchmarks}
              visibleBenchmarks={visibleBenchmarks}
              availableBenchmarkKeys={availableBenchmarkKeys}
              accentColor={accentColor}
              currency={currency}
              maskValues={maskValues}
              compact={compact}
              height={chartHeight}
              onHoverPoint={emitHoverInspectionDate}
              onClickPoint={handleClickPoint}
              onChartReady={setChartApi}
            />
            {chartApi && visiblePinnedInspectionTimestampMs != null ? (
              <PinOverlay
                chart={chartApi}
                timestampMs={visiblePinnedInspectionTimestampMs}
                compact={compact}
                visible={pinnedInspectionTimestampMs != null}
              />
            ) : null}
            {chartApi &&
            activeInspectionTimestampMs != null &&
            activeInspectionTimestampMs !== visiblePinnedInspectionTimestampMs ? (
              <PinOverlay
                chart={chartApi}
                timestampMs={activeInspectionTimestampMs}
                compact={compact}
              />
            ) : null}
            {showEvents && chartApi && events.length ? (
              <EquityCurveEventRibbon
                chart={chartApi}
                events={events}
                onActiveEventChange={setActiveEvent}
                compact={compact}
              />
            ) : null}
          </div>

          <div
            aria-hidden={!activeEvent}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: sp("2px 8px"),
              alignItems: "center",
              minHeight: dim(compact ? 14 : 16),
              visibility: activeEvent ? "visible" : "hidden",
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize(compact ? "micro" : "label"),
              lineHeight: 1.25,
            }}
          >
            {activeEvent ? (
              <>
                <span style={{ color: equityEventColor(activeEvent), fontWeight: FONT_WEIGHTS.medium }}>
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
                  <span style={{ color: toneColor(activeEvent.realizedPnl), fontWeight: FONT_WEIGHTS.medium }}>
                    P&L{" "}
                    {formatAccountSignedMoney(activeEvent.realizedPnl, currency, true, maskValues)}
                  </span>
                ) : activeEvent.amount != null ? (
                  <span style={{ color: toneColor(activeEvent.amount), fontWeight: FONT_WEIGHTS.medium }}>
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
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(6),
              flexWrap: "wrap",
              borderTop: `1px solid ${CSS_COLOR.border}`,
              paddingTop: sp(4),
            }}
          >
            <div style={{ display: "flex", gap: sp(3), flexWrap: "wrap", alignItems: "center" }}>
              <ToggleChip
                active={showEvents}
                color={CSS_COLOR.green}
                onClick={() => setShowEvents((current) => !current)}
                title="Show deposits, withdrawals, dividends, cash events, and trade events on the chart"
              >
                Events
              </ToggleChip>
              {benchmarks.map((benchmark) => (
                <ToggleChip
                  key={benchmark.key}
                  active={Boolean(visibleBenchmarks[benchmark.key])}
                  color={benchmark.color}
                  onClick={() =>
                    updateVisibleBenchmarks((current) => ({
                      ...current,
                      [benchmark.key]: !current[benchmark.key],
                    }))
                  }
                >
                  {benchmark.label}
                </ToggleChip>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                gap: sp(4),
                flexWrap: "wrap",
                color: CSS_COLOR.textDim,
                fontSize: textSize(compact ? "micro" : "label"),
                fontFamily: T.sans,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.25,
                justifyContent: "flex-end",
              }}
            >
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
              <span>{chartPointCountLabel}</span>
              <span>
                {sourceLabel} · {formatAppDateTime(latestSnapshotTimestamp)}
              </span>
              <span>
                {visibleAvailableBenchmarks.length
                  ? `vs ${visibleAvailableBenchmarks.map((benchmark) => benchmark.label).join(" · ")}`
                  : "no benchmarks"}
              </span>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};

export default EquityCurvePanel;
