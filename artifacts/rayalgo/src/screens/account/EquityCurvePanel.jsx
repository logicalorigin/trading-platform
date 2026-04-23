import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  ACCOUNT_RANGES,
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
  formatMoney,
  formatPercent,
  formatSignedMoney,
} from "./accountUtils";

const ChartTooltip = ({ active, payload, label, currency, benchmarks }) => {
  if (!active || !payload?.length) return null;
  const nav = payload.find((item) => item.dataKey === "netLiquidation")?.value;
  const ret = payload.find((item) => item.dataKey === "returnPercent")?.value;
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
        border: `1px solid ${T.border}`,
        borderRadius: dim(5),
        padding: sp(8),
        color: T.text,
        fontSize: fs(10),
        fontFamily: T.sans,
      }}
    >
      <div style={{ color: T.textMuted }}>{new Date(label).toLocaleString()}</div>
      <div style={{ marginTop: sp(4), fontWeight: 900 }}>{formatMoney(nav, currency)}</div>
      <div style={{ marginTop: sp(2), color: toneColor(ret) }}>{formatPercent(ret)}</div>
      {benchmarkItems.map((benchmark) => (
        <div key={benchmark.label} style={{ marginTop: sp(2), color: benchmark.color }}>
          {benchmark.label} {formatPercent(benchmark.value)}
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

export const EquityCurvePanel = ({
  query,
  benchmarkQueries,
  range,
  onRangeChange,
  currency,
}) => {
  const [showEvents, setShowEvents] = useState(true);
  const [visibleBenchmarks, setVisibleBenchmarks] = useState({
    SPY: true,
    QQQ: false,
    DJIA: false,
  });
  const benchmarks = [
    {
      key: "SPY",
      label: "SPY",
      dataKey: "benchmarkSpyPercent",
      tone: "accent",
      color: T.accent,
      query: benchmarkQueries?.SPY,
    },
    {
      key: "QQQ",
      label: "QQQ",
      dataKey: "benchmarkQqqPercent",
      tone: "purple",
      color: T.purple,
      query: benchmarkQueries?.QQQ,
    },
    {
      key: "DJIA",
      label: "DJIA",
      dataKey: "benchmarkDjiaPercent",
      tone: "amber",
      color: T.amber,
      query: benchmarkQueries?.DJIA,
    },
  ];
  const benchmarkPointMaps = useMemo(
    () =>
      benchmarks.reduce((accumulator, benchmark) => {
        accumulator[benchmark.key] = new Map(
          (benchmark.query?.data?.points || []).map((point) => [
            point.timestamp,
            point.benchmarkPercent,
          ]),
        );
        return accumulator;
      }, {}),
    [
      benchmarkQueries?.DJIA?.data?.points,
      benchmarkQueries?.QQQ?.data?.points,
      benchmarkQueries?.SPY?.data?.points,
    ],
  );
  const data = useMemo(
    () =>
      (query.data?.points || []).map((point) => ({
        ...point,
        timestampMs: new Date(point.timestamp).getTime(),
        benchmarkSpyPercent: benchmarkPointMaps.SPY?.get(point.timestamp) ?? null,
        benchmarkQqqPercent: benchmarkPointMaps.QQQ?.get(point.timestamp) ?? null,
        benchmarkDjiaPercent: benchmarkPointMaps.DJIA?.get(point.timestamp) ?? null,
      })),
    [benchmarkPointMaps, query.data?.points],
  );
  const events = (query.data?.events || [])
    .map((event) => {
      const point = data.find((candidate) => candidate.timestamp === event.timestamp);
      return point
        ? {
            ...event,
            netLiquidation: point.netLiquidation,
          }
        : null;
    })
    .filter(Boolean)
    .slice(-12);
  const lastPoint = data[data.length - 1] || null;
  const firstPoint = data[0] || null;
  const minNav = data.length
    ? Math.min(...data.map((point) => point.netLiquidation))
    : null;
  const maxNav = data.length
    ? Math.max(...data.map((point) => point.netLiquidation))
    : null;
  const delta = useMemo(() => {
    if (!firstPoint || !lastPoint) return null;
    return lastPoint.netLiquidation - firstPoint.netLiquidation;
  }, [firstPoint, lastPoint]);
  const deltaPercent =
    delta != null && firstPoint?.netLiquidation
      ? (delta / firstPoint.netLiquidation) * 100
      : null;
  const availableBenchmarks = benchmarks.filter((benchmark) =>
    data.some((point) => point[benchmark.dataKey] != null),
  );
  const hasPoints = data.length > 0;

  return (
    <Panel
      title="Equity Curve"
      rightRail={query.data?.flexConfigured ? "Flex + snapshots" : "Snapshots"}
      loading={query.isPending && !hasPoints}
      error={query.error}
      onRetry={query.refetch}
      minHeight={340}
      action={<ToggleGroup options={ACCOUNT_RANGES} value={range} onChange={onRangeChange} />}
    >
      {!hasPoints && !query.data?.flexConfigured ? (
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
        <div style={{ display: "grid", gap: sp(8) }}>
          {!query.data?.flexConfigured ? (
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
              justifyContent: "space-between",
              alignItems: "center",
              gap: sp(8),
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  color: T.text,
                  fontSize: fs(17),
                  fontFamily: T.mono,
                  fontWeight: 900,
                  letterSpacing: "-0.02em",
                }}
              >
                {formatMoney(lastPoint?.netLiquidation, currency)}
              </div>
              <div
                style={{
                  marginTop: sp(2),
                  color: toneColor(delta),
                  fontSize: fs(9),
                  fontFamily: T.mono,
                  fontWeight: 800,
                }}
              >
                {formatSignedMoney(delta, currency, true)} · {formatPercent(deltaPercent)}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4), justifyContent: "flex-end" }}>
              <Pill tone={showEvents ? "green" : "default"}>
                <label style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={showEvents}
                    onChange={(event) => setShowEvents(event.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Events
                </label>
              </Pill>
              {benchmarks.map((benchmark) => {
                const available = availableBenchmarks.some(
                  (item) => item.key === benchmark.key,
                );
                return (
                  <Pill
                    key={benchmark.key}
                    tone={visibleBenchmarks[benchmark.key] && available ? benchmark.tone : "default"}
                  >
                    <label style={{ cursor: available ? "pointer" : "default" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(visibleBenchmarks[benchmark.key])}
                        disabled={!available}
                        onChange={() =>
                          setVisibleBenchmarks((current) => ({
                            ...current,
                            [benchmark.key]: !current[benchmark.key],
                          }))
                        }
                        style={{ marginRight: 6 }}
                      />
                      {benchmark.label}
                    </label>
                  </Pill>
                );
              })}
              <Pill tone="cyan">
                {lastPoint ? new Date(lastPoint.timestamp).toLocaleDateString() : "----"}
              </Pill>
            </div>
          </div>

          <div style={{ width: "100%", height: dim(222) }}>
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="accountEquityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={T.green} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={T.green} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  tick={{ fill: T.textMuted, fontSize: fs(9) }}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  }
                  minTickGap={28}
                  stroke={T.border}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: T.textMuted, fontSize: fs(9) }}
                  tickFormatter={(value) => formatMoney(value, currency, true)}
                  width={64}
                  stroke={T.border}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: T.textMuted, fontSize: fs(9) }}
                  tickFormatter={(value) => `${value.toFixed(0)}%`}
                  width={42}
                  stroke={T.border}
                />
                <Tooltip content={<ChartTooltip currency={currency} benchmarks={benchmarks} />} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="netLiquidation"
                  stroke={T.green}
                  fill="url(#accountEquityFill)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                {benchmarks.map((benchmark) =>
                  visibleBenchmarks[benchmark.key] &&
                  availableBenchmarks.some((item) => item.key === benchmark.key) ? (
                    <Line
                      key={benchmark.key}
                      yAxisId="right"
                      type="monotone"
                      dataKey={benchmark.dataKey}
                      stroke={benchmark.color}
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null,
                )}
                {showEvents
                  ? events.map((event) => (
                      <ReferenceDot
                        key={`${event.timestamp}:${event.type}`}
                        yAxisId="left"
                        x={event.timestamp}
                        y={event.netLiquidation}
                        r={3}
                        fill={
                          event.type === "withdrawal"
                            ? T.red
                            : event.type === "dividend"
                              ? T.accent
                              : T.green
                        }
                        stroke="none"
                      />
                    ))
                  : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: sp(10),
              flexWrap: "wrap",
              color: T.textDim,
              fontSize: fs(8),
              fontFamily: T.mono,
            }}
          >
            <span>
              {firstPoint ? new Date(firstPoint.timestamp).toLocaleDateString() : "----"}
              {" -> "}
              {lastPoint ? new Date(lastPoint.timestamp).toLocaleDateString() : "----"}
            </span>
            <span>H {formatMoney(maxNav, currency, true)} · L {formatMoney(minNav, currency, true)}</span>
            <span>
              Flex{" "}
              {query.data?.lastFlexRefreshAt
                ? new Date(query.data.lastFlexRefreshAt).toLocaleDateString()
                : "----"}
            </span>
            <span>
              Benchmarks{" "}
              {availableBenchmarks.length
                ? availableBenchmarks.map((benchmark) => benchmark.label).join(" · ")
                : "n/a"}
            </span>
          </div>

          {events.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
              {events.slice(-6).map((event) => (
                <Pill
                  key={`${event.timestamp}:${event.type}:pill`}
                  tone={
                    event.type === "withdrawal"
                      ? "red"
                      : event.type === "dividend"
                        ? "accent"
                        : "green"
                  }
                  title={new Date(event.timestamp).toLocaleString()}
                >
                  {event.type} {formatMoney(event.amount, event.currency || currency, true)}
                </Pill>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
};

export default EquityCurvePanel;
