// Gex chart components, split out of GexScreen so the recharts vendor chunk
// (~71 kB gzip) loads lazily with the charts instead of on GexScreen's cold
// path. GexScreen lazy-imports these (StrikeProfileChart / ExpiryChart / OiChart
// / IntradayCard) behind Suspense; the shared chart helpers (ChartShell,
// SegmentControl, SectionTitle, formatters, tone constants) stay in GexScreen
// and are imported back here. GexScreen only ever imports this module
// dynamically, so there is no static import cycle.
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MeasuredChartFrame } from "../../features/charting/MeasuredChartFrame.jsx";
import { Card } from "../../components/platform/primitives.jsx";
import {
  CSS_COLOR,
  cssColorMix,
  ELEVATION,
  FONT_WEIGHTS,
  T,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  buildIntradaySnapshots,
  formatGexStrikePrice,
  gexByExpiry,
  oiByStrike,
} from "../../features/gex/gexModel.js";
import {
  ChartShell,
  GEX_BEARISH_TONE,
  GEX_BULLISH_TONE,
  GEX_CALL_TONE,
  GEX_PUT_TONE,
  SectionTitle,
  SegmentControl,
  fmtCurrency,
  fmtNumber,
  fmtPercent,
  toneForNetGex,
} from "../GexScreen.jsx";

const GexTooltip = ({ active, payload, spot }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div
      style={{
        background: CSS_COLOR.bg1,
        border: `1px solid ${CSS_COLOR.borderLight}`,
        padding: sp(8),
        color: CSS_COLOR.text,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        boxShadow: ELEVATION.md,
      }}
    >
      <div style={{ color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.emphasis, marginBottom: sp(5) }}>
        {formatGexStrikePrice(row.strike)} · {fmtPercent((row.strike - spot) / spot)}
      </div>
      <div style={{ color: toneForNetGex(row.netGex) }}>
        Net {fmtCurrency(row.netGex)}
      </div>
      <div style={{ color: GEX_CALL_TONE }}>Call {fmtCurrency(row.callGex)}</div>
      <div style={{ color: GEX_PUT_TONE }}>Put {fmtCurrency(row.putGex)}</div>
      <div style={{ color: CSS_COLOR.textSec }}>Call OI {fmtNumber(row.callOi)}</div>
      <div style={{ color: CSS_COLOR.textSec }}>Put OI {fmtNumber(row.putOi)}</div>
    </div>
  );
};

const StrikeProfileChart = ({ profile, spot, series, callWall, putWall }) => {
  const [range, setRange] = useState("near");
  const data = useMemo(
    () =>
      range === "all"
        ? profile
        : profile.filter((row) => Math.abs((row.strike - spot) / spot) <= 0.05),
    [profile, range, spot],
  );

  return (
    <ChartShell
      title="Strike Profile"
      right={
        <SegmentControl
          value={range}
          onChange={setRange}
          options={[
            { value: "near", label: "Near" },
            { value: "all", label: "All" },
          ]}
        />
      }
      minHeight={340}
    >
      <MeasuredChartFrame
        height={286}
        minHeight={286}
        placeholderLabel="Preparing strike profile"
        testId="gex-strike-profile-frame"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={CSS_COLOR.borderLight} strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="strike"
            tickFormatter={formatGexStrikePrice}
            tick={{ fill: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: T.sans }}
            axisLine={false}
            tickLine={false}
            minTickGap={18}
          />
          <YAxis
            tickFormatter={(value) => `${(value / 1e6).toFixed(0)}M`}
            tick={{ fill: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: T.sans }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={{ fill: `${cssColorMix(CSS_COLOR.textMuted, 8)}` }} content={<GexTooltip spot={spot} />} />
          <ReferenceLine
            x={Math.round(spot)}
            stroke={CSS_COLOR.cyan}
            strokeDasharray="4 4"
            label={{ value: "Spot", fill: CSS_COLOR.cyan, fontSize: fs(10), position: "top" }}
          />
          {series === "net" ? (
            <Bar dataKey="netGex" isAnimationActive={false}>
              {data.map((row) => (
                <Cell
                  key={row.strike}
                  fill={toneForNetGex(row.netGex)}
                  stroke={
                    row.strike === callWall || row.strike === putWall
                      ? CSS_COLOR.text
                      : "transparent"
                  }
                  strokeWidth={row.strike === callWall || row.strike === putWall ? 2 : 0}
                />
              ))}
            </Bar>
          ) : (
            <>
              <Bar dataKey="callGex" fill={GEX_CALL_TONE} isAnimationActive={false} />
              <Bar dataKey="putGex" fill={GEX_PUT_TONE} isAnimationActive={false} />
            </>
          )}
          </BarChart>
        </ResponsiveContainer>
      </MeasuredChartFrame>
    </ChartShell>
  );
};

const ExpiryChart = ({ rows, spot }) => {
  const data = useMemo(() => gexByExpiry(rows, spot), [rows, spot]);
  return (
    <ChartShell
      title="Gamma Exposure by Expiry"
      subtitle="Gamma exposure by expiration date (in millions)"
    >
      <MeasuredChartFrame
        height={220}
        minHeight={220}
        placeholderLabel="Preparing expiry chart"
        testId="gex-expiry-frame"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={CSS_COLOR.borderLight} strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: T.sans }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(value) => `${(value / 1e6).toFixed(0)}M`}
            tick={{ fill: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: T.sans }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: `${cssColorMix(CSS_COLOR.textMuted, 8)}` }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload;
              return (
                <div style={tooltipBoxStyle}>
                  <b>{row.label}</b>
                  <div style={{ color: GEX_CALL_TONE }}>Call {fmtCurrency(row.callGex)}</div>
                  <div style={{ color: GEX_PUT_TONE }}>Put {fmtCurrency(row.putGex)}</div>
                  <div style={{ color: toneForNetGex(row.netGex) }}>
                    Net {fmtCurrency(row.netGex)}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="callGex" fill={GEX_CALL_TONE} stackId="expiry" isAnimationActive={false} />
          <Bar dataKey="putGex" fill={GEX_PUT_TONE} stackId="expiry" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </MeasuredChartFrame>
    </ChartShell>
  );
};

const tooltipBoxStyle = {
  background: CSS_COLOR.bg1,
  border: `1px solid ${CSS_COLOR.borderLight}`,
  padding: sp(8),
  color: CSS_COLOR.text,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  boxShadow: ELEVATION.md,
};

const OiChart = ({ rows, spot }) => {
  const [range, setRange] = useState("near");
  const allRows = useMemo(() => oiByStrike(rows), [rows]);
  const data = useMemo(
    () =>
      range === "all"
        ? allRows
        : allRows.filter((row) => Math.abs((row.strike - spot) / spot) <= 0.05),
    [allRows, range, spot],
  );

  return (
    <ChartShell
      title="OI Strike Profile"
      subtitle="Open interest by strike price (in contracts)"
      right={
        <SegmentControl
          value={range}
          onChange={setRange}
          options={[
            { value: "near", label: "Near" },
            { value: "all", label: "All" },
          ]}
        />
      }
    >
      <MeasuredChartFrame
        height={220}
        minHeight={220}
        placeholderLabel="Preparing OI strike profile"
        testId="gex-oi-profile-frame"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={CSS_COLOR.borderLight} strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="strike"
            tickFormatter={formatGexStrikePrice}
            tick={{ fill: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: T.sans }}
            axisLine={false}
            tickLine={false}
            minTickGap={18}
          />
          <YAxis
            tickFormatter={(value) => (value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : `${(value / 1e3).toFixed(0)}K`)}
            tick={{ fill: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: T.sans }}
            axisLine={false}
            tickLine={false}
          />
          <ReferenceLine x={Math.round(spot)} stroke={CSS_COLOR.cyan} strokeDasharray="4 4" />
          <Tooltip
            cursor={{ fill: `${cssColorMix(CSS_COLOR.textMuted, 8)}` }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload;
              return (
                <div style={tooltipBoxStyle}>
                  <b>{formatGexStrikePrice(row.strike)}</b>
                  <div style={{ color: GEX_CALL_TONE }}>Call OI {fmtNumber(row.callOi)}</div>
                  <div style={{ color: GEX_PUT_TONE }}>Put OI {fmtNumber(row.putOi)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="callOi" fill={GEX_CALL_TONE} stackId="oi" isAnimationActive={false} />
          <Bar dataKey="putOi" fill={GEX_PUT_TONE} stackId="oi" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </MeasuredChartFrame>
    </ChartShell>
  );
};

const IntradayDeltaPill = ({ label, value, testId }) => {
  const tone =
    toneForNetGex(value);
  const formatted =
    value == null
      ? "—"
      : `${value >= 0 ? "+" : ""}${fmtCurrency(value)}`;
  return (
    <div
      data-testid={testId}
      style={{
        flex: 1,
        minWidth: 0,
        background: CSS_COLOR.bg0,
        border: "none",
        padding: sp(8),
        display: "grid",
        gap: sp(3),
      }}
    >
      <div
        style={{
          color: CSS_COLOR.textMuted,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ color: tone, fontSize: fs(16), fontWeight: FONT_WEIGHTS.emphasis }}>
        {formatted}
      </div>
    </div>
  );
};

const IntradayChartTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0].payload;
  const ts = Number.isFinite(point?.ts) ? new Date(point.ts) : null;
  return (
    <div
      style={{
        background: CSS_COLOR.bg0,
        border: "none",
        padding: sp(6),
        fontSize: textSize("caption"),
        fontFamily: T.sans,
      }}
    >
      <div style={{ color: CSS_COLOR.textDim }}>
        {ts ? ts.toLocaleTimeString() : "--"}
      </div>
      <div
        style={{
          color: toneForNetGex(point?.netGex),
          fontWeight: FONT_WEIGHTS.emphasis,
        }}
      >
        Net GEX: {fmtCurrency(point?.netGex)}
      </div>
    </div>
  );
};

const IntradayCard = ({ snapshots }) => {
  const intraday = buildIntradaySnapshots(snapshots);
  const hasSeries = intraday.series.length >= 2;
  const lastTone =
    intraday.series.length > 0 &&
    intraday.series[intraday.series.length - 1].netGex >= 0
      ? GEX_BULLISH_TONE
      : GEX_BEARISH_TONE;
  return (
    <Card noPad>
      <SectionTitle>Intraday ΔGEX</SectionTitle>
      <div style={{ padding: sp(10), display: "grid", gap: sp(8) }}>
        <div style={{ display: "flex", gap: sp(6), minWidth: 0 }}>
          <IntradayDeltaPill
            label="Δ Session"
            value={hasSeries ? intraday.deltaSession : null}
            testId="gex-intraday-delta-session"
          />
          <IntradayDeltaPill
            label="Δ Recent"
            value={hasSeries ? intraday.deltaRecent : null}
            testId="gex-intraday-delta-recent"
          />
        </div>
        {hasSeries ? (
          <MeasuredChartFrame
            height={96}
            minHeight={96}
            placeholderLabel="Preparing intraday GEX"
            testId="gex-intraday-chart"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={intraday.series}
                margin={{ top: 4, right: 6, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  stroke={CSS_COLOR.borderLight || CSS_COLOR.border}
                  strokeDasharray="0"
                  vertical={false}
                />
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  hide
                />
                <YAxis hide />
                <ReferenceLine y={0} stroke={CSS_COLOR.textDim} strokeDasharray="2 2" />
                <Tooltip content={<IntradayChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="netGex"
                  stroke={lastTone}
                  fill={lastTone}
                  fillOpacity={0.18}
                  strokeWidth={1.4}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </MeasuredChartFrame>
        ) : (
          <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>
            {intraday.series.length === 1
              ? "Awaiting a second snapshot to plot intraday change."
              : "No intraday snapshots yet for this session."}
          </div>
        )}
        <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>
          {snapshots.length} full-chain IBKR snapshot{snapshots.length === 1 ? "" : "s"}
          {intraday.isSparse && hasSeries
            ? " · sparse — Δ Recent uses last 5 points"
            : ""}
        </div>
      </div>
    </Card>
  );
};

export { StrikeProfileChart, ExpiryChart, OiChart, IntradayCard };
