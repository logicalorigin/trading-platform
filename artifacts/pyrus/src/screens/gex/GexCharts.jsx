// Gex chart components, split out of GexScreen so the recharts vendor chunk
// (~71 kB gzip) loads lazily with the charts instead of on GexScreen's cold
// path. GexScreen lazy-imports these (StrikeProfileChart / ExpiryChart / OiChart
// / IntradayCard) behind Suspense; the shared chart helpers (ChartShell,
// SectionTitle, formatters, tone constants) stay in GexScreen and are imported
// back here (the segmented toggle now comes from the shared primitive).
// GexScreen only ever imports this module
// dynamically, so there is no static import cycle.
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MeasuredChartFrame } from "../../features/charting/MeasuredChartFrame.jsx";
import {
  Card,
  ChartSkeleton,
  SegmentedControl,
} from "../../components/platform/primitives.jsx";
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
  aggregateDexMetrics,
  buildIntradaySnapshots,
  formatGexStrikePrice,
  gexByExpiry,
  ivSkewByStrike,
  ivTermStructure,
  oiByStrike,
  thetaDecayByExpiry,
  vexByStrike,
  volumeByStrike,
} from "../../features/gex/gexModel.js";
import {
  ChartShell,
  GEX_BEARISH_TONE,
  GEX_BULLISH_TONE,
  GEX_CALL_TONE,
  GEX_PUT_TONE,
  SectionTitle,
  fmtCurrency,
  fmtNumber,
  fmtPercent,
  toneForNetGex,
} from "../GexScreen.jsx";
import { useValueFlash } from "../../lib/motion.jsx";

// Item 13, D5 — ghost chart placeholder rendered while a MeasuredChartFrame
// measures its box. Fills the frame at its final height (absolute overlay, so
// no reflow on hydrate) with the frame's original copy centered on top.
const GexChartPlaceholder = ({ label }) => (
  <>
    <ChartSkeleton fill style={{ position: "absolute", inset: 0 }} />
    <span style={{ position: "relative" }}>{label}</span>
  </>
);

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
        <SegmentedControl
          ariaLabel="Strike range"
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
        placeholderLabel={<GexChartPlaceholder label="Preparing strike profile" />}
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
        placeholderLabel={<GexChartPlaceholder label="Preparing expiry chart" />}
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
        <SegmentedControl
          ariaLabel="Strike range"
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
        placeholderLabel={<GexChartPlaceholder label="Preparing OI strike profile" />}
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
  // Item 13, D4 — quick tick flash on the raw metric when it updates.
  const flash = useValueFlash(value, { enabled: value != null });
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
      <div
        className={flash ? `${flash} ra-value-flash--quick` : undefined}
        style={{ color: tone, fontSize: fs(16), fontWeight: FONT_WEIGHTS.emphasis }}
      >
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
            placeholderLabel={<GexChartPlaceholder label="Preparing intraday GEX" />}
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
          {snapshots.length} full-chain Massive snapshot{snapshots.length === 1 ? "" : "s"}
          {intraday.isSparse && hasSeries
            ? " · sparse — Δ Recent uses last 5 points"
            : ""}
        </div>
      </div>
    </Card>
  );
};

// --- Delta Exposure (DEX) profile -----------------------------------------
const DexProfileChart = ({ rows, spot, callWall, putWall }) => {
  const [range, setRange] = useState("near");
  const { profile, zeroDex } = useMemo(
    () => aggregateDexMetrics(rows, spot),
    [rows, spot],
  );
  const data = useMemo(
    () =>
      range === "all"
        ? profile
        : profile.filter((row) => Math.abs((row.strike - spot) / spot) <= 0.05),
    [profile, range, spot],
  );

  return (
    <ChartShell
      title="Delta Exposure (DEX)"
      subtitle="Net dealer delta by strike — directional analog of GEX (Δ·OI·spot)"
      right={
        <SegmentedControl
          ariaLabel="Strike range"
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
        placeholderLabel={<GexChartPlaceholder label="Preparing delta exposure" />}
        testId="gex-dex-profile-frame"
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
            <Tooltip
              cursor={{ fill: `${cssColorMix(CSS_COLOR.textMuted, 8)}` }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload;
                return (
                  <div style={tooltipBoxStyle}>
                    <b>{formatGexStrikePrice(row.strike)}</b>
                    <div style={{ color: GEX_CALL_TONE }}>Call Δ {fmtCurrency(row.callDex)}</div>
                    <div style={{ color: GEX_PUT_TONE }}>Put Δ {fmtCurrency(row.putDex)}</div>
                    <div style={{ color: toneForNetGex(row.netDex) }}>
                      Net Δ {fmtCurrency(row.netDex)}
                    </div>
                  </div>
                );
              }}
            />
            <ReferenceLine
              x={Math.round(spot)}
              stroke={CSS_COLOR.cyan}
              strokeDasharray="4 4"
              label={{ value: "Spot", fill: CSS_COLOR.cyan, fontSize: fs(10), position: "top" }}
            />
            {zeroDex != null ? (
              <ReferenceLine
                x={Math.round(zeroDex)}
                stroke={CSS_COLOR.text}
                strokeDasharray="2 4"
                label={{ value: "0-DEX", fill: CSS_COLOR.text, fontSize: fs(10), position: "insideTopRight" }}
              />
            ) : null}
            <Bar dataKey="netDex" isAnimationActive={false}>
              {data.map((row) => (
                <Cell
                  key={row.strike}
                  fill={toneForNetGex(row.netDex)}
                  stroke={
                    row.strike === callWall || row.strike === putWall
                      ? CSS_COLOR.text
                      : "transparent"
                  }
                  strokeWidth={row.strike === callWall || row.strike === putWall ? 2 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </MeasuredChartFrame>
    </ChartShell>
  );
};

// --- Implied volatility skew (front-month smile) --------------------------
const IvSkewChart = ({ rows, spot }) => {
  const { data, expirationLabel } = useMemo(() => {
    // Default to the nearest expiration with IV coverage (the front-month smile).
    const expirations = Array.from(
      new Set(rows.map((row) => row.expirationDate).filter(Boolean)),
    ).sort();
    const nearest = expirations[0] || null;
    return {
      data: ivSkewByStrike(rows, nearest),
      expirationLabel: nearest || "—",
    };
  }, [rows]);

  return (
    <ChartShell
      title="IV Skew"
      subtitle={`Implied vol smile by strike · ${expirationLabel}`}
    >
      <MeasuredChartFrame
        height={220}
        minHeight={220}
        placeholderLabel={<GexChartPlaceholder label="Preparing IV skew" />}
        testId="gex-iv-skew-frame"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke={CSS_COLOR.borderLight} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="strike"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={formatGexStrikePrice}
              tick={{ fill: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: T.sans }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
              tick={{ fill: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: T.sans }}
              axisLine={false}
              tickLine={false}
              width={38}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload;
                return (
                  <div style={tooltipBoxStyle}>
                    <b>{formatGexStrikePrice(row.strike)}</b>
                    {row.callIv != null ? (
                      <div style={{ color: GEX_CALL_TONE }}>Call IV {(row.callIv * 100).toFixed(1)}%</div>
                    ) : null}
                    {row.putIv != null ? (
                      <div style={{ color: GEX_PUT_TONE }}>Put IV {(row.putIv * 100).toFixed(1)}%</div>
                    ) : null}
                  </div>
                );
              }}
            />
            {spot ? (
              <ReferenceLine x={Math.round(spot)} stroke={CSS_COLOR.cyan} strokeDasharray="4 4" />
            ) : null}
            <Line type="monotone" dataKey="callIv" stroke={GEX_CALL_TONE} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
            <Line type="monotone" dataKey="putIv" stroke={GEX_PUT_TONE} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </MeasuredChartFrame>
    </ChartShell>
  );
};

// --- Implied volatility term structure (ATM IV per expiry) ----------------
const IvTermChart = ({ rows, spot }) => {
  const data = useMemo(() => ivTermStructure(rows, spot), [rows, spot]);
  return (
    <ChartShell
      title="IV Term Structure"
      subtitle="ATM implied vol across expirations (contango / backwardation)"
    >
      <MeasuredChartFrame
        height={220}
        minHeight={220}
        placeholderLabel={<GexChartPlaceholder label="Preparing IV term structure" />}
        testId="gex-iv-term-frame"
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke={CSS_COLOR.borderLight} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: T.sans }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
              tick={{ fill: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: T.sans }}
              axisLine={false}
              tickLine={false}
              width={38}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload;
                return (
                  <div style={tooltipBoxStyle}>
                    <b>{row.label}</b>
                    <div>ATM IV {(row.atmIv * 100).toFixed(1)}%</div>
                    <div style={{ color: CSS_COLOR.textSec }}>
                      {formatGexStrikePrice(row.atmStrike)}
                    </div>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="atmIv"
              stroke={CSS_COLOR.accent}
              fill={CSS_COLOR.accent}
              fillOpacity={0.18}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </MeasuredChartFrame>
    </ChartShell>
  );
};

// --- Volume profile (today's traded volume by strike) ---------------------
const VolumeProfileChart = ({ rows, spot }) => {
  const [range, setRange] = useState("near");
  const allRows = useMemo(() => volumeByStrike(rows), [rows]);
  const data = useMemo(
    () =>
      range === "all"
        ? allRows
        : allRows.filter((row) => Math.abs((row.strike - spot) / spot) <= 0.05),
    [allRows, range, spot],
  );

  return (
    <ChartShell
      title="Volume Profile"
      subtitle="Today's traded contract volume by strike (not buy/sell flow)"
      right={
        <SegmentedControl
          ariaLabel="Strike range"
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
        placeholderLabel={<GexChartPlaceholder label="Preparing volume profile" />}
        testId="gex-volume-profile-frame"
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
                    <div style={{ color: GEX_CALL_TONE }}>Call Vol {fmtNumber(row.callVol)}</div>
                    <div style={{ color: GEX_PUT_TONE }}>Put Vol {fmtNumber(row.putVol)}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="callVol" fill={GEX_CALL_TONE} stackId="vol" isAnimationActive={false} />
            <Bar dataKey="putVol" fill={GEX_PUT_TONE} stackId="vol" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </MeasuredChartFrame>
    </ChartShell>
  );
};

// --- Vega Exposure (VEX) profile ------------------------------------------
const VexProfileChart = ({ rows, spot }) => {
  const [range, setRange] = useState("near");
  const allRows = useMemo(() => vexByStrike(rows), [rows]);
  const data = useMemo(
    () =>
      range === "all"
        ? allRows
        : allRows.filter((row) => Math.abs((row.strike - spot) / spot) <= 0.05),
    [allRows, range, spot],
  );

  return (
    <ChartShell
      title="Vega Exposure (VEX)"
      subtitle="Dealer vol sensitivity by strike — vega·OI (where vol-of-vol risk sits)"
      right={
        <SegmentedControl
          ariaLabel="Strike range"
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
        placeholderLabel={<GexChartPlaceholder label="Preparing vega exposure" />}
        testId="gex-vex-profile-frame"
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
              tickFormatter={(value) => `${(value / 1e6).toFixed(0)}M`}
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
                    <div style={{ color: GEX_CALL_TONE }}>Call VEX {fmtCurrency(row.callVex)}</div>
                    <div style={{ color: GEX_PUT_TONE }}>Put VEX {fmtCurrency(row.putVex)}</div>
                    <div style={{ color: CSS_COLOR.text }}>Total {fmtCurrency(row.totalVex)}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="callVex" fill={GEX_CALL_TONE} stackId="vex" isAnimationActive={false} />
            <Bar dataKey="putVex" fill={GEX_PUT_TONE} stackId="vex" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </MeasuredChartFrame>
    </ChartShell>
  );
};

// --- Theta decay by expiry ------------------------------------------------
const ThetaDecayChart = ({ rows }) => {
  const data = useMemo(() => thetaDecayByExpiry(rows), [rows]);
  return (
    <ChartShell
      title="Theta Decay"
      subtitle="Daily $ time decay by expiration — theta·OI (negative = decay)"
    >
      <MeasuredChartFrame
        height={220}
        minHeight={220}
        placeholderLabel={<GexChartPlaceholder label="Preparing theta decay" />}
        testId="gex-theta-decay-frame"
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
              tickFormatter={(value) => `${(value / 1e6).toFixed(1)}M`}
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
                    <div style={{ color: GEX_CALL_TONE }}>Call θ {fmtCurrency(row.callTheta)}</div>
                    <div style={{ color: GEX_PUT_TONE }}>Put θ {fmtCurrency(row.putTheta)}</div>
                    <div style={{ color: toneForNetGex(row.netTheta) }}>Net θ {fmtCurrency(row.netTheta)}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="netTheta" isAnimationActive={false}>
              {data.map((row) => (
                <Cell key={row.key} fill={row.netTheta < 0 ? GEX_PUT_TONE : GEX_CALL_TONE} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </MeasuredChartFrame>
    </ChartShell>
  );
};

export {
  StrikeProfileChart,
  ExpiryChart,
  OiChart,
  IntradayCard,
  DexProfileChart,
  IvSkewChart,
  IvTermChart,
  VolumeProfileChart,
  VexProfileChart,
  ThetaDecayChart,
};
