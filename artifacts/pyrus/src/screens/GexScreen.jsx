import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { getGexDashboard as getGexDashboardRequest } from "@workspace/api-client-react";
import { AppTooltip } from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Zap,
} from "lucide-react";
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
import {
  aggregateMetrics,
  buildIntradaySnapshots,
  computeSignals,
  computeSqueeze,
  expConcentration,
  formatGexStrikePrice,
  gexByExpiry,
  isFiniteNumber,
  normalizeGexResponseOptions,
  normalizeGexTicker,
  oiByStrike,
  resolveSqueezeNarrative,
} from "../features/gex/gexModel.js";
import {
  buildGexHeatmapCellTitle,
  buildGexHeatmapModel,
  formatHeatmapCellValue,
  formatHeatmapStrikeLabel,
  getGexHeatmapCellStats,
  getGexHeatmapCellValue,
  hasGexHeatmapCellValue,
} from "../features/gex/gexHeatmapModel.js";
import { Card, DataUnavailableState } from "../components/platform/primitives.jsx";
import {
  SortableColumnHeaderCell,
  TableHeaderDndContext,
} from "../components/platform/InteractiveColumnHeader.jsx";
import {
  normalizeColumnOrder,
  orderColumnsById,
  reorderColumnOrder,
} from "../components/platform/tableColumnInteractions.js";
import { InfoTooltipIcon } from "../components/platform/InfoTooltipIcon.jsx";
import { FailurePointTooltip } from "../components/platform/FailurePointTooltip.jsx";
import { DataIssueInlineIcon } from "../components/platform/DataIssueInlineIcon.jsx";
import { getGexGlossaryEntry } from "../features/gex/gexGlossary.js";
import { HeatmapColorLegend } from "../features/gex/HeatmapColorLegend.jsx";
import {
  GEX_DASHBOARD_QUERY_REFETCH_MS,
  GEX_DASHBOARD_QUERY_STALE_MS,
} from "../features/gex/useGexZeroGamma.js";
import { MeasuredChartFrame } from "../features/charting/MeasuredChartFrame.jsx";
import { buildFailurePoint } from "../features/platform/failurePointModel.js";
import { collectCoverageDataIssues } from "../features/platform/dataIssueModel.js";
import {
  toneForDirectionalIntent,
  toneForFinancialDelta,
  toneForOptionSide,
} from "../features/platform/semanticToneModel.js";
import { BottomSheet } from "../components/platform/BottomSheet.jsx";
import { responsiveFlags, useElementSize } from "../lib/responsive";
import { useDebouncedTextCommit } from "../lib/useDebouncedTextCommit";
import {
  CSS_COLOR,
  cssColorMix,
  ELEVATION,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../lib/uiTokens.jsx";
import { Button } from "../components/ui/Button.jsx";
import { _initialState, persistState } from "../lib/workspaceState";

const GEX_CALL_TONE = toneForOptionSide("call");
const GEX_PUT_TONE = toneForOptionSide("put");
const GEX_BULLISH_TONE = toneForDirectionalIntent("bullish");
const GEX_BEARISH_TONE = toneForDirectionalIntent("bearish");
const toneForNetGex = (value) =>
  value == null ? CSS_COLOR.textDim : value >= 0 ? GEX_BULLISH_TONE : GEX_BEARISH_TONE;

const fetchGexData = async ({ ticker, signal }) => {
  return getGexDashboardRequest(encodeURIComponent(ticker), { signal });
};

const GexTickerInput = ({ value, onCommit, isPhone }) => {
  const { inputProps } = useDebouncedTextCommit({
    value,
    onCommit,
    autoCommit: false,
    transformInput: (nextValue) => nextValue.toUpperCase(),
  });

  return (
    <input
      {...inputProps}
      aria-label="GEX ticker"
      style={{
        width: dim(isPhone ? 68 : 82),
        border: 0,
        outline: 0,
        background: "transparent",
        color: CSS_COLOR.text,
        fontFamily: T.sans,
        fontWeight: FONT_WEIGHTS.emphasis,
        fontSize: textSize("bodyStrong"),
      }}
    />
  );
};

const fmtCurrency = (value) => {
  if (!isFiniteNumber(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(2)}`;
};

const fmtNumber = (value) =>
  isFiniteNumber(value)
    ? Math.round(value).toLocaleString("en-US")
    : "—";

const fmtPrice = (value) =>
  isFiniteNumber(value) ? `$${value.toFixed(value >= 100 ? 2 : 3)}` : "—";

const fmtPercent = (value, digits = 1) =>
  isFiniteNumber(value)
    ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`
    : "—";

const pct = (numerator, denominator) =>
  denominator > 0 ? numerator / denominator : 0;

const parseTimestampMs = (value) => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const fmtTimestamp = (value) => {
  const ms = parseTimestampMs(value);
  if (ms == null) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
};

const resolveSourceUpdatedAt = (source) => {
  const candidates = [source?.quoteUpdatedAt, source?.chainUpdatedAt]
    .map((value) => ({ value, ms: parseTimestampMs(value) }))
    .filter((entry) => entry.ms != null)
    .sort((left, right) => right.ms - left.ms);
  return candidates[0]?.value || null;
};

const buildSourceCoverageWarnings = ({ data, sourceCoverageRatio }) => {
  const source = data?.source || null;
  const expirationCoverage = source?.expirationCoverage || null;
  const warnings = [];

  if (data?.isStale) warnings.push("Stale snapshot");
  if (source?.status === "partial") warnings.push("Partial source");
  if (expirationCoverage?.capped) warnings.push("Expiration list capped");
  if (expirationCoverage && !expirationCoverage.complete) {
    warnings.push("Expiration coverage incomplete");
  }
  if ((expirationCoverage?.failedCount || 0) > 0) {
    warnings.push(`${expirationCoverage.failedCount} expiration batch failed`);
  }
  if (source?.optionCount > 0 && sourceCoverageRatio < 0.5) {
    warnings.push("Low contract coverage");
  }

  return Array.from(new Set(warnings));
};

const rgba = (color, alpha) => cssColorMix(color, alpha * 100);

const fieldStyle = {
  background: CSS_COLOR.bg0,
  border: "none",
  color: CSS_COLOR.text,
  fontFamily: T.sans,
  fontSize: textSize("bodyStrong"),
  height: dim(30),
  outline: "none",
};

const SegmentControl = ({ value, options, onChange }) => (
  <div
    style={{
      display: "inline-flex",
      background: CSS_COLOR.bg0,
      border: "none",
    }}
  >
    {options.map((option) => {
      const active = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          className="ra-touch-target"
          onClick={() => onChange(option.value)}
          style={{
            padding: sp("6px 9px"),
            border: 0,
            borderRight: `1px solid ${CSS_COLOR.border}`,
            background: active ? CSS_COLOR.accentDim : "transparent",
            color: active ? CSS_COLOR.text : CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            cursor: "pointer",
          }}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

const SectionTitle = ({ children, right }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(8),
      padding: sp("6px 10px 4px"),
      borderBottom: `1px solid ${CSS_COLOR.borderLight || CSS_COLOR.border}`,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(7),
        minWidth: 0,
      }}
    >
      <span
        style={{
          color: CSS_COLOR.text,
          fontFamily: T.sans,
          fontSize: textSize("bodyStrong"),
          fontWeight: FONT_WEIGHTS.label,
          letterSpacing: 0,
        }}
      >
        {children}
      </span>
    </div>
    {right}
  </div>
);

const MetricTile = ({ label, value, sub, color = CSS_COLOR.text, glossaryKey }) => (
  <div
    style={{
      minWidth: dim(112),
      flex: "1 1 112px",
      padding: sp("10px 8px"),
      borderRight: `1px solid ${CSS_COLOR.border}`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      gap: sp(3),
    }}
  >
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(3),
        color: CSS_COLOR.textDim,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {label}
      {glossaryKey ? (
        <InfoTooltipIcon entry={getGexGlossaryEntry(glossaryKey)} />
      ) : null}
    </span>
    <span
      style={{
        color,
        fontFamily: T.sans,
        fontSize: fs(16),
        fontWeight: FONT_WEIGHTS.emphasis,
        lineHeight: 1,
      }}
    >
      {value}
    </span>
    <span
      style={{
        color: CSS_COLOR.textMuted,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
      }}
    >
      {sub}
    </span>
  </div>
);

const MetaLine = ({ label, value }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: sp(8) }}>
    <span style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>{label}</span>
    <span
      style={{
        color: CSS_COLOR.text,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.emphasis,
        textAlign: "right",
      }}
    >
      {value}
    </span>
  </div>
);

const TickerMetaSummary = ({ data }) => {
  const details = data?.tickerDetails || {};
  const profile = data?.profile || {};
  return (
    <div style={{ display: "grid", gap: sp(5), minWidth: 0 }}>
      <div
        style={{
          color: CSS_COLOR.text,
          fontFamily: T.sans,
          fontSize: textSize("bodyStrong"),
          fontWeight: FONT_WEIGHTS.emphasis,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {details.name || data?.ticker || "—"}
      </div>
      <MetaLine label="Sector" value={details.sector || details.industry || "—"} />
      <MetaLine label="Mkt Cap" value={fmtCurrency(profile.mktCap)} />
      <MetaLine
        label="Day Range"
        value={`${fmtPrice(profile.dayLow)} - ${fmtPrice(profile.dayHigh)}`}
      />
      <MetaLine
        label="Year Range"
        value={`${fmtPrice(profile.yearLow)} - ${fmtPrice(profile.yearHigh)}`}
      />
    </div>
  );
};

const SourceCoverageBanner = ({ data, warnings, lastUpdatedLabel }) => {
  if (!warnings.length) return null;
  const coverage = data?.source?.expirationCoverage || null;
  const source = data?.source || {};
  const loaded =
    coverage && Number.isFinite(Number(coverage.loadedCount))
      ? `${coverage.loadedCount}/${coverage.returnedCount} expirations loaded`
      : `${source.usableOptionCount || 0}/${source.optionCount || 0} contracts usable`;
  const failurePoint = buildFailurePoint({
    severity: "warning",
    title: "GEX source coverage",
    summary: warnings.join(" · "),
    source: "gex",
    reason: warnings[0],
    metrics: [
      ["Loaded", loaded],
      ["Updated", lastUpdatedLabel],
    ],
    topCauses: warnings,
    nextAction:
      "Inspect source coverage before relying on the current GEX heatmap or strike table.",
  });
  const coverageIssues = collectCoverageDataIssues(
    {
      ...coverage,
      loadedCount: coverage?.loadedCount ?? source.usableOptionCount,
      returnedCount: coverage?.returnedCount ?? source.optionCount,
      coverageHealth: "lagging",
      degradedReason: warnings[0],
      updatedAt: lastUpdatedLabel,
    },
    {
      valueLabel: "GEX source coverage",
      source: "gex",
      nextAction:
        "Inspect source coverage before relying on the current GEX heatmap or strike table.",
    },
  );

  return (
    <FailurePointTooltip
      point={failurePoint}
      side="bottom"
      align="start"
      compact
    >
      <div
        data-testid="gex-source-coverage-banner"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: sp(8),
          padding: sp("9px 10px"),
          border: `1px solid ${cssColorMix(CSS_COLOR.amber, 32)}`,
          background: cssColorMix(CSS_COLOR.amber, 7),
          color: CSS_COLOR.text,
          cursor: "help",
          minWidth: 0,
        }}
      >
        <DataIssueInlineIcon
          issues={coverageIssues.length ? coverageIssues : [failurePoint]}
          side="bottom"
          align="start"
          size={13}
        />
        <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
          <div
            style={{
              color: CSS_COLOR.text,
              fontSize: textSize("bodyStrong"),
              fontWeight: FONT_WEIGHTS.emphasis,
            }}
          >
            Source coverage
          </div>
          <div
            style={{
              color: CSS_COLOR.textSec,
              fontSize: textSize("caption"),
              lineHeight: 1.35,
            }}
          >
            {warnings.join(" · ")} · {loaded} · Updated {lastUpdatedLabel}
          </div>
        </div>
      </div>
    </FailurePointTooltip>
  );
};

const ChartShell = ({ title, subtitle, right, children, minHeight = 260 }) => (
  <Card noPad style={{ minHeight: dim(minHeight) }}>
    <SectionTitle right={right}>{title}</SectionTitle>
    {subtitle ? (
      <div
        style={{
          padding: sp("7px 10px 0"),
          color: CSS_COLOR.textDim,
          fontSize: textSize("caption"),
        }}
      >
        {subtitle}
      </div>
    ) : null}
    <div style={{ padding: sp(10) }}>{children}</div>
  </Card>
);

const SectionHeading = ({ title }) => (
  <div style={{ display: "flex", alignItems: "center", gap: sp(8), padding: sp("2px 2px") }}>
    <h2
      style={{
        color: CSS_COLOR.text,
        fontFamily: T.sans,
        fontSize: fs(15),
        fontWeight: FONT_WEIGHTS.emphasis,
        margin: 0,
      }}
    >
      {title}
    </h2>
    <span style={{ flex: 1, height: 1, background: CSS_COLOR.border }} />
  </div>
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

const HeatmapCard = ({ rows, spot }) => {
  const [expanded, setExpanded] = useState(false);
  const model = useMemo(() => buildGexHeatmapModel(rows, spot), [rows, spot]);
  const displayStrikes = useMemo(
    () => [...model.strikes].sort((left, right) => right - left),
    [model.strikes],
  );
  const focusedStrikes = useMemo(() => {
    const spotIndex = displayStrikes.findIndex((strike) => strike <= spot);
    const centerIndex = spotIndex === -1 ? displayStrikes.length - 1 : spotIndex;
    const start = Math.max(0, centerIndex - 8);
    return displayStrikes.slice(start, start + 17);
  }, [displayStrikes, spot]);
  const visibleStrikes = expanded ? displayStrikes : focusedStrikes;
  const visibleStrikeCount = visibleStrikes.length;

  const cellColor = (value) => {
    if (!value || !model.maxAbs) return CSS_COLOR.bg0;
    const alpha = Math.min(
      0.85,
      Math.max(0.08, Math.abs(value) / model.maxAbs),
    );
    return value > 0
      ? rgba(GEX_BULLISH_TONE, alpha)
      : rgba(GEX_BEARISH_TONE, alpha);
  };

  return (
    <ChartShell
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: sp(4) }}>
          GEX Heatmap by Expiration
          <InfoTooltipIcon entry={getGexGlossaryEntry("heatmapColors")} />
        </span>
      }
      right={
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(10),
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <HeatmapColorLegend compact />
          <button
            type="button"
            className="ra-touch-target"
            onClick={() => setExpanded((value) => !value)}
            style={{
              ...fieldStyle,
              height: dim(26),
              padding: sp("0 8px"),
              cursor: "pointer",
              color: CSS_COLOR.textSec,
            }}
          >
            {expanded ? "Collapse" : `Expand (${displayStrikes.length} strikes)`}
          </button>
        </div>
      }
      minHeight={280}
    >
      <div style={{ display: "grid", gap: sp(6) }}>
        <div
          style={{
            overflow: "auto",
            maxHeight: expanded ? dim(560) : dim(264),
            border: `1px solid ${CSS_COLOR.border}`,
            background: CSS_COLOR.bg0,
          }}
        >
          <table
            style={{
              width: "100%",
              minWidth: dim(Math.max(520, 92 + model.expirations.length * 74)),
              borderCollapse: "separate",
              borderSpacing: 0,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
            }}
          >
            <thead>
              <tr>
                <th scope="col" style={heatmapCornerHeaderStyle}>
                  Strike
                </th>
                {model.expirations.map((expiration) => (
                  <th key={expiration.key} scope="col" style={heatmapHeaderStyle}>
                    <span style={heatmapExpirationHeaderStyle}>
                      <span>{expiration.dateLabel || expiration.label}</span>
                      <span style={heatmapExpirationDteStyle}>{expiration.dteLabel}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleStrikes.map((strike) => (
                <tr key={strike}>
                  <td
                    style={{
                      ...heatmapStrikeCellStyle,
                      fontVariantNumeric: "tabular-nums",
                      color: Math.abs(strike - spot) < 0.5 ? CSS_COLOR.cyan : CSS_COLOR.textSec,
                    }}
                  >
                    {formatHeatmapStrikeLabel(strike)}
                  </td>
                  {model.expirations.map((expiration) => {
                    const hasValue = hasGexHeatmapCellValue(
                      model,
                      strike,
                      expiration.key,
                    );
                    const value = getGexHeatmapCellValue(
                      model,
                      strike,
                      expiration.key,
                    );
                    const stats = getGexHeatmapCellStats(
                      model,
                      strike,
                      expiration.key,
                    );
                    const valueLabel = hasValue ? formatHeatmapCellValue(value) : "";
                    return (
                      <AppTooltip
                        key={expiration.key}
                        content={
                          hasValue
                            ? buildGexHeatmapCellTitle({
                                strike,
                                expiration,
                                value,
                                valueLabel,
                                stats,
                              })
                            : undefined
                        }
                      >
                        <td
                          style={{
                            minWidth: dim(74),
                            padding: sp("6px 7px"),
                            textAlign: "center",
                            borderBottom: `1px solid ${CSS_COLOR.border}`,
                            borderRight: `1px solid ${cssColorMix(CSS_COLOR.border, 55)}`,
                            background: hasValue ? cellColor(value) : CSS_COLOR.bg0,
                            color:
                              hasValue &&
                              Math.abs(value) > model.maxAbs * 0.5
                                ? CSS_COLOR.text
                                : CSS_COLOR.textSec,
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {valueLabel}
                        </td>
                      </AppTooltip>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!expanded && displayStrikes.length > visibleStrikeCount ? (
          <div style={heatmapFootnoteStyle}>
            <span>
              Showing {visibleStrikeCount} of {displayStrikes.length} strikes around spot
            </span>
            <button
              type="button"
              className="ra-touch-target"
              onClick={() => setExpanded(true)}
              style={heatmapInlineButtonStyle}
            >
              view all
            </button>
          </div>
        ) : null}
      </div>
    </ChartShell>
  );
};

const heatmapHeaderStyle = {
  minWidth: dim(74),
  padding: sp("6px 7px"),
  textAlign: "center",
  color: CSS_COLOR.textDim,
  background: CSS_COLOR.bg1,
  borderBottom: `1px solid ${CSS_COLOR.border}`,
  borderRight: `1px solid ${cssColorMix(CSS_COLOR.border, 55)}`,
  whiteSpace: "nowrap",
  fontWeight: FONT_WEIGHTS.label,
  position: "sticky",
  top: 0,
  zIndex: 2,
};

const heatmapCornerHeaderStyle = {
  ...heatmapHeaderStyle,
  minWidth: dim(92),
  left: 0,
  zIndex: 4,
  borderRight: `1px solid ${CSS_COLOR.border}`,
};

const heatmapStrikeCellStyle = {
  minWidth: dim(92),
  padding: sp("6px 7px"),
  textAlign: "right",
  color: CSS_COLOR.textDim,
  background: CSS_COLOR.bg1,
  borderBottom: `1px solid ${CSS_COLOR.border}`,
  borderRight: `1px solid ${CSS_COLOR.border}`,
  whiteSpace: "nowrap",
  fontWeight: FONT_WEIGHTS.label,
  position: "sticky",
  left: 0,
  zIndex: 1,
};

const heatmapExpirationHeaderStyle = {
  display: "inline-grid",
  gap: sp(1),
  justifyItems: "center",
  lineHeight: 1.05,
};

const heatmapExpirationDteStyle = {
  color: CSS_COLOR.textMuted,
  fontSize: textSize("micro"),
  fontWeight: FONT_WEIGHTS.regular,
};

const heatmapFootnoteStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: sp(4),
  color: CSS_COLOR.textDim,
  fontSize: textSize("caption"),
};

const heatmapInlineButtonStyle = {
  background: "transparent",
  border: "none",
  color: CSS_COLOR.accent,
  cursor: "pointer",
  font: "inherit",
  padding: 0,
};

const signalGlossaryKey = (kind) => {
  if (kind === "Magnet") return "signalMagnet";
  if (kind === "Support") return "signalSupport";
  return "signalVolatility";
};

const SignalsCard = ({ signals }) => (
  <Card noPad>
    <SectionTitle>Signals</SectionTitle>
    <div style={{ padding: sp(10), display: "grid", gap: sp(8) }}>
      {signals.length ? (
        signals.map((signal, index) => {
          const Icon = signal.kind === "Magnet" ? Target : signal.kind === "Support" ? ShieldCheck : AlertTriangle;
          const color = signal.severity === "STRONG" ? CSS_COLOR.amber : CSS_COLOR.cyan;
          return (
            <div
              key={`${signal.kind}-${index}`}
              style={{
                display: "grid",
                gap: sp(4),
                paddingBottom: sp(8),
                borderBottom: index < signals.length - 1 ? `1px solid ${CSS_COLOR.border}` : 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: sp(7) }}>
                <Icon size={14} color={color} />
                <b style={{ color: CSS_COLOR.text, fontSize: textSize("body"), fontFamily: T.display }}>
                  {signal.kind}
                </b>
                <InfoTooltipIcon
                  entry={getGexGlossaryEntry(signalGlossaryKey(signal.kind))}
                />
                <span style={{ marginLeft: "auto", color, fontSize: textSize("caption") }}>
                  {signal.severity}
                </span>
              </div>
              <div style={{ color: CSS_COLOR.textSec, fontSize: textSize("caption"), lineHeight: 1.4 }}>
                {signal.description}
              </div>
              <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>
                @ {fmtPrice(signal.level)} · {fmtPercent(signal.delta)}
              </div>
            </div>
          );
        })
      ) : (
        <DataUnavailableState
          title="No active signals"
          detail="Current gamma levels do not trigger a dashboard signal."
        />
      )}
    </div>
  </Card>
);

const formatFlowClassificationDetail = (source) => {
  if (!source) {
    return "Squeeze scoring waits for IBKR-backed flow context instead of using neutral placeholders.";
  }

  const rawCount = Number(source.flowEventCount || 0);
  const classifiedCount = Number(source.classifiedFlowEventCount || 0);
  if (rawCount <= 0) {
    return "No IBKR-backed option flow context is available for the current GEX window.";
  }

  const coverage =
    Number.isFinite(source.flowClassificationCoverage) && source.flowClassificationCoverage >= 0
      ? source.flowClassificationCoverage
      : classifiedCount / rawCount;
  const basis = source.flowClassificationBasisCounts || {};
  return `${classifiedCount}/${rawCount} IBKR-backed flow events classified (${Math.round(
    coverage * 100,
  )}%). Quote-match ${Number(basis.quoteMatch || 0)}, tick-test ${Number(
    basis.tickTest || 0,
  )}, unclassified ${Number(basis.none || 0)}.`;
};

const SqueezeCard = ({ squeeze, source }) => {
  if (!squeeze) {
    return (
      <Card noPad>
        <SectionTitle>Gamma Squeeze Screener</SectionTitle>
        <div style={{ padding: sp(10) }}>
          <DataUnavailableState
            title="Flow context unavailable"
            detail={formatFlowClassificationDetail(source)}
          />
        </div>
      </Card>
    );
  }

  const factors = squeeze.factors || {};
  const rows = [
    ["Gamma", factors.gammaRegime, "factorGamma"],
    ["Wall", factors.wallProximity, "factorWall"],
    ["Flow", factors.flowAlignment, "factorFlow"],
    ["Volume", factors.volumeConfirm, "factorVolume"],
    ["DEX", factors.dexBias, "factorDex"],
  ];
  const color = squeeze.bias === "BULLISH" ? GEX_BULLISH_TONE : GEX_BEARISH_TONE;
  const displayedClassifiedFlowCount = Number(
    source?.classifiedFlowEventCount || squeeze.flowEventCount || 0,
  );
  const displayedRawFlowCount = Number(
    source?.flowEventCount || squeeze.flowEventCount || 0,
  );
  const narrative = resolveSqueezeNarrative(squeeze);
  const directionLabel = squeeze.bias === "BULLISH" ? "Bullish" : "Bearish";
  const verdictLabel = (squeeze.verdict || "").toLowerCase();
  return (
    <Card noPad>
      <SectionTitle>Gamma Squeeze Screener</SectionTitle>
      <div style={{ padding: sp(10), display: "grid", gap: sp(10) }}>
        <div
          data-testid="gex-squeeze-headline"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(3),
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: sp(5) }}>
            <span style={{ color, fontSize: fs(14), fontWeight: FONT_WEIGHTS.medium, fontFamily: T.display }}>
              {directionLabel} Squeeze:
            </span>
            <span style={{ color, fontSize: fs(14), fontWeight: FONT_WEIGHTS.medium, fontFamily: T.display }}>
              {verdictLabel || "—"}
            </span>
            <span style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>
              ({squeeze.score || 0}/100)
            </span>
            <InfoTooltipIcon entry={getGexGlossaryEntry("squeezeProbability")} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: sp(7) }}>
          <Zap size={15} color={CSS_COLOR.amber} aria-hidden="true" />
          <span style={{ color, fontSize: fs(18), fontWeight: FONT_WEIGHTS.emphasis }}>
            {squeeze.score || 0}
          </span>
          <span style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>/100</span>
          <span style={{ marginLeft: "auto", color, fontSize: textSize("caption") }}>
            {squeeze.bias} · {squeeze.verdict}
          </span>
        </div>
        <div style={{ height: dim(7), background: CSS_COLOR.bg0, border: `1px solid ${CSS_COLOR.border}` }}>
          <div
            style={{
              width: `${Math.max(0, Math.min(100, squeeze.score || 0))}%`,
              height: "100%",
              background: color,
            }}
          />
        </div>
        {squeeze.flowPending ? (
          <div
            style={{
              color: CSS_COLOR.amber,
              background: CSS_COLOR.amberBg,
              border: `1px solid ${CSS_COLOR.amberDim}`,
              padding: sp(7),
              fontSize: textSize("caption"),
            }}
          >
            Flow factors are waiting for IBKR-backed flow context.
          </div>
        ) : (
          <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>
            IBKR-backed flow events: {displayedClassifiedFlowCount}/{displayedRawFlowCount} classified
          </div>
        )}
        <div style={{ display: "grid", gap: sp(6) }}>
          {rows.map(([label, value, glossaryKey]) => (
            <div key={label}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: CSS_COLOR.textSec,
                  fontSize: textSize("caption"),
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: sp(3) }}>
                  {label}
                  <InfoTooltipIcon entry={getGexGlossaryEntry(glossaryKey)} />
                </span>
                <span>{Math.round(value || 0)}/25</span>
              </div>
              <div style={{ height: dim(4), background: CSS_COLOR.bg0, marginTop: sp(3) }}>
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, ((value || 0) / 25) * 100))}%`,
                    height: "100%",
                    background: value >= 18 ? CSS_COLOR.green : value >= 10 ? CSS_COLOR.amber : CSS_COLOR.red,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        {narrative.stronger.length ? (
          <div data-testid="gex-squeeze-stronger" style={{ display: "grid", gap: sp(4) }}>
            <div
              style={{
                color: CSS_COLOR.textDim,
                fontSize: textSize("caption"),
                fontFamily: T.sans,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              For Stronger Setup
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: sp(14),
                color: CSS_COLOR.textSec,
                fontSize: textSize("caption"),
                lineHeight: 1.4,
                display: "grid",
                gap: sp(3),
              }}
            >
              {narrative.stronger.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {narrative.implication ? (
          <div
            data-testid="gex-squeeze-implication"
            style={{
              borderTop: `1px solid ${CSS_COLOR.border}`,
              paddingTop: sp(7),
              color: CSS_COLOR.text,
              fontSize: textSize("caption"),
              lineHeight: 1.5,
            }}
          >
            <div
              style={{
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                marginBottom: sp(3),
              }}
            >
              Trading Implication
            </div>
            {narrative.implication}
          </div>
        ) : null}
      </div>
    </Card>
  );
};

const SORTABLE_PROFILE_COLUMNS = [
  { key: "strike", label: "Strike" },
  { key: "netGex", label: "Net GEX" },
  { key: "callGex", label: "Call GEX" },
  { key: "putGex", label: "Put GEX" },
  { key: "callOi", label: "Call OI" },
  { key: "putOi", label: "Put OI" },
  { key: "totalOi", label: "Total OI" },
];
const PROFILE_COLUMNS = [
  SORTABLE_PROFILE_COLUMNS[0],
  { key: "putGammaBar", label: "Put Γ" },
  { key: "callGammaBar", label: "Call Γ" },
  ...SORTABLE_PROFILE_COLUMNS.slice(1),
];
const PROFILE_COLUMN_IDS = PROFILE_COLUMNS.map((column) => column.key);

const ProfileGammaBarCell = ({ value, maxAbs, color, align = "left" }) => {
  const magnitude = Math.abs(value || 0);
  const width = maxAbs > 0 ? Math.max(4, Math.min(100, (magnitude / maxAbs) * 100)) : 0;
  return (
    <td style={{ ...tableCellStyle, minWidth: dim(86) }}>
      <AppTooltip content={formatHeatmapCellValue(value)}>
        <div
          style={{
            height: dim(8),
            width: "100%",
            background: CSS_COLOR.bg0,
            border: `1px solid ${cssColorMix(CSS_COLOR.border, 55)}`,
            display: "flex",
            justifyContent: align === "right" ? "flex-end" : "flex-start",
          }}
        >
          {width > 0 ? (
            <span
              style={{
                display: "block",
                width: `${width}%`,
                background: cssColorMix(color, 68),
              }}
            />
          ) : null}
        </div>
      </AppTooltip>
    </td>
  );
};

const ProfileTable = ({ profile, spot }) => {
  const [sort, setSort] = useState({ key: "strike", direction: "desc" });
  const [columnOrder, setColumnOrder] = useState(() =>
    normalizeColumnOrder(_initialState.gexProfileColumnOrder, PROFILE_COLUMN_IDS),
  );
  const columns = useMemo(
    () => orderColumnsById(PROFILE_COLUMNS, columnOrder, (column) => column.key),
    [columnOrder],
  );
  const maxCallGex = profile.reduce(
    (max, row) => Math.max(max, Math.abs(row.callGex || 0)),
    0,
  );
  const maxPutGex = profile.reduce(
    (max, row) => Math.max(max, Math.abs(row.putGex || 0)),
    0,
  );
  const rows = useMemo(() => {
    const withTotals = profile.map((row) => ({
      ...row,
      totalOi: row.callOi + row.putOi,
    }));
    return withTotals.sort((left, right) => {
      const leftValue = left[sort.key] ?? 0;
      const rightValue = right[sort.key] ?? 0;
      const direction = sort.direction === "asc" ? 1 : -1;
      if (leftValue === rightValue) return right.strike - left.strike;
      return leftValue > rightValue ? direction : -direction;
    });
  }, [profile, sort]);
  const toggleSort = (key) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "strike" ? "desc" : "desc" },
    );
  };
  useEffect(() => {
    persistState({
      gexProfileColumnOrder: normalizeColumnOrder(columnOrder, PROFILE_COLUMN_IDS),
    });
  }, [columnOrder]);
  const reorderProfileColumn = (activeColumnId, overColumnId) => {
    setColumnOrder((current) =>
      reorderColumnOrder(
        current,
        activeColumnId,
        overColumnId,
        {
          fallbackColumnIds: PROFILE_COLUMN_IDS,
          validColumnIds: PROFILE_COLUMN_IDS,
        },
      ),
    );
  };
  const renderProfileCell = (column, row) => {
    if (column.key === "strike") {
      return (
        <td
          key={column.key}
          style={{ ...tableCellStyle, textAlign: "left", color: CSS_COLOR.text }}
        >
          <div style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatGexStrikePrice(row.strike)}
          </div>
          <div style={profileStrikeDeltaStyle}>
            Spot {fmtPercent((row.strike - spot) / spot)}
          </div>
        </td>
      );
    }
    if (column.key === "putGammaBar") {
      return (
        <ProfileGammaBarCell
          key={column.key}
          value={row.putGex}
          maxAbs={maxPutGex}
          color={CSS_COLOR.red}
          align="right"
        />
      );
    }
    if (column.key === "callGammaBar") {
      return (
        <ProfileGammaBarCell
          key={column.key}
          value={row.callGex}
          maxAbs={maxCallGex}
          color={GEX_CALL_TONE}
        />
      );
    }
    if (column.key === "netGex") {
      return (
        <td
          key={column.key}
          style={{
            ...tableCellStyle,
            color: toneForNetGex(row.netGex),
          }}
        >
          {fmtCurrency(row.netGex)}
        </td>
      );
    }
    if (column.key === "callGex") {
      return (
        <td key={column.key} style={{ ...tableCellStyle, color: GEX_CALL_TONE }}>
          {fmtCurrency(row.callGex)}
        </td>
      );
    }
    if (column.key === "putGex") {
      return (
        <td key={column.key} style={{ ...tableCellStyle, color: CSS_COLOR.red }}>
          {fmtCurrency(row.putGex)}
        </td>
      );
    }
    return (
      <td key={column.key} style={tableCellStyle}>
        {fmtNumber(row[column.key])}
      </td>
    );
  };

  return (
    <ChartShell title="Strike Profile">
      <div style={{ display: "grid", gap: sp(4) }}>
        <div style={{ maxHeight: dim(440), overflow: "auto", border: `1px solid ${CSS_COLOR.border}` }}>
          <table
            style={{
              width: "100%",
              minWidth: dim(760),
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: textSize("caption"),
            }}
          >
            <thead>
              <TableHeaderDndContext
                columnIds={columns.map((column) => column.key)}
                onReorder={reorderProfileColumn}
              >
                <tr>
                  {columns.map((column) => {
                    const sortable = SORTABLE_PROFILE_COLUMNS.some(
                      (item) => item.key === column.key,
                    );
                    return (
                      <SortableColumnHeaderCell
                        key={column.key}
                        as="th"
                        id={column.key}
                        scope="col"
                        active={sort.key === column.key}
                        align={column.key === "strike" ? "left" : "right"}
                        label={column.label}
                        onSort={sortable ? () => toggleSort(column.key) : undefined}
                        sortDirection={sort.key === column.key ? sort.direction : null}
                        sortable={sortable}
                        sortTitle={`Sort by ${column.label}`}
                        style={{
                          ...tableHeaderStyle,
                          textAlign: column.key === "strike" ? "left" : "right",
                        }}
                      />
                    );
                  })}
                </tr>
              </TableHeaderDndContext>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.strike}>
                  {columns.map((column) => renderProfileCell(column, row))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ChartShell>
  );
};

const tableHeaderStyle = {
  padding: sp("5px 7px"),
  color: CSS_COLOR.textDim,
  borderBottom: `1px solid ${CSS_COLOR.border}`,
  borderRight: `1px solid ${cssColorMix(CSS_COLOR.border, 55)}`,
  background: CSS_COLOR.bg1,
  textAlign: "right",
  fontFamily: T.sans,
  fontWeight: FONT_WEIGHTS.emphasis,
  position: "sticky",
  top: 0,
  zIndex: 1,
  whiteSpace: "nowrap",
};

const tableCellStyle = {
  padding: sp("5px 7px"),
  color: CSS_COLOR.textSec,
  borderBottom: `1px solid ${CSS_COLOR.border}`,
  borderRight: `1px solid ${cssColorMix(CSS_COLOR.border, 45)}`,
  textAlign: "right",
  fontFamily: T.sans,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const profileStrikeDeltaStyle = {
  marginTop: sp(1),
  color: CSS_COLOR.textDim,
  fontSize: textSize("micro"),
  lineHeight: 1.1,
};

export default function GexScreen({
  sym = "SPY",
  isVisible = true,
  onSelectSymbol,
  onReadinessChange,
}) {
  const initialTicker = normalizeGexTicker(sym);
  const [ticker, setTicker] = useState(initialTicker);
  const [series, setSeries] = useState("net");
  const [view, setView] = useState("graph");
  const [expirationFilter, setExpirationFilter] = useState("all");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [gexRootRef, gexRootSize] = useElementSize();
  const { isPhone, isNarrow } = responsiveFlags(gexRootSize.width);
  const lastCommittedTickerRef = useRef(initialTicker);

  useEffect(() => {
    const normalized = normalizeGexTicker(sym);
    if (!normalized) return;
    if (!isVisible || ticker === lastCommittedTickerRef.current) {
      setTicker(normalized);
      lastCommittedTickerRef.current = normalized;
    }
  }, [isVisible, sym, ticker]);

  useEffect(() => {
    setExpirationFilter("all");
  }, [ticker]);

  useEffect(() => {
    if (!isPhone) {
      setMobileFiltersOpen(false);
    }
  }, [isPhone]);

  const commitTicker = useCallback((nextDraft) => {
    const nextTicker = normalizeGexTicker(nextDraft);
    setTicker(nextTicker);
    lastCommittedTickerRef.current = nextTicker;
    onSelectSymbol?.(nextTicker);
  }, [onSelectSymbol]);

  const gexQuery = useQuery({
    queryKey: ["gex-dashboard", ticker],
    queryFn: ({ signal }) => fetchGexData({ ticker, signal }),
    enabled: Boolean(isVisible && ticker),
    staleTime: GEX_DASHBOARD_QUERY_STALE_MS,
    refetchInterval: isVisible ? GEX_DASHBOARD_QUERY_REFETCH_MS : false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) =>
      normalizeGexTicker(previousData?.ticker, "") === ticker
        ? previousData
        : undefined,
    retry: 1,
  });
  const gexData = gexQuery.data || null;
  const spot = isFiniteNumber(gexData?.spot) ? gexData.spot : null;
  const quoteChange = isFiniteNumber(gexData?.profile?.changes)
    ? gexData.profile.changes
    : null;
  const expirationDates = useMemo(
    () =>
      Array.from(
        new Set(
          (gexData?.options || [])
            .map((option) => {
              if (
                !option?.expireYear ||
                !option?.expireMonth ||
                !option?.expireDay
              ) {
                return "";
              }
              return `${String(option.expireYear).padStart(4, "0")}-${String(
                option.expireMonth,
              ).padStart(2, "0")}-${String(option.expireDay).padStart(2, "0")}`;
            })
            .filter(Boolean),
        ),
      ).sort(),
    [gexData?.options],
  );

  useEffect(() => {
    if (
      expirationFilter !== "all" &&
      expirationDates.length &&
      !expirationDates.includes(expirationFilter)
    ) {
      setExpirationFilter("all");
    }
  }, [expirationDates, expirationFilter]);

  const { rows, coverage } = useMemo(
    () => normalizeGexResponseOptions(gexData?.options || []),
    [gexData?.options],
  );
  const filteredRows = useMemo(() => {
    if (expirationFilter === "all") return rows;
    return rows.filter((row) => row.expirationDate === expirationFilter);
  }, [expirationFilter, rows]);
  const metrics = useMemo(
    () => (spot != null ? aggregateMetrics(filteredRows, spot) : null),
    [filteredRows, spot],
  );
  const concentration = useMemo(
    () =>
      spot != null
        ? expConcentration(filteredRows, spot)
        : { zeroDTE: 0, weekly: 0, monthly: 0 },
    [filteredRows, spot],
  );
  const flowContext =
    gexData?.flowContextStatus === "ok" ? gexData.flowContext : null;
  const signals = useMemo(
    () => (metrics && spot != null ? computeSignals(metrics, spot) : []),
    [metrics, spot],
  );
  const squeeze = useMemo(
    () =>
      metrics && spot != null && flowContext
        ? computeSqueeze(metrics, spot, flowContext)
        : null,
    [flowContext, metrics, spot],
  );
  const snapshots = gexData?.snapshots || [];

  const loading =
    gexQuery.isPending && gexQuery.fetchStatus !== "idle" && !gexData;
  const chainError = gexQuery.error;
  const noExpirations = !loading && expirationDates.length === 0;
  const backgroundLoading = gexQuery.isFetching && !gexQuery.isPending;
  const selectedExpirationCount =
    expirationFilter === "all" ? expirationDates.length : filteredRows.length ? 1 : 0;
  const coverageRatio = pct(
    Math.min(coverage.withGamma, coverage.withOpenInterest),
    coverage.usable,
  );
  const sourceCoverageRatio = pct(
    gexData?.source?.usableOptionCount ?? coverage.usable,
    gexData?.source?.optionCount ?? coverage.total,
  );
  const sourceLastUpdatedAt = resolveSourceUpdatedAt(gexData?.source);
  const sourceLastUpdatedLabel = fmtTimestamp(sourceLastUpdatedAt);
  const sourceCoverageWarnings = useMemo(
    () =>
      buildSourceCoverageWarnings({
        data: gexData,
        sourceCoverageRatio,
      }),
    [gexData, sourceCoverageRatio],
  );
  const providerIvCount = filteredRows.filter(
    (row) => isFiniteNumber(row.impliedVol) && row.impliedVol > 0,
  ).length;
  const dataReady = Boolean(metrics && spot != null && filteredRows.length);
  const routeDataSettled = Boolean(
    dataReady ||
      chainError ||
      noExpirations ||
      (gexQuery.isFetched && !gexQuery.isFetching),
  );

  useEffect(() => {
    onReadinessChange?.({
      contentReady: Boolean(isVisible),
      primaryReady: Boolean(isVisible),
      derivedReady: Boolean(isVisible && routeDataSettled),
      backgroundAllowed: Boolean(isVisible && routeDataSettled),
    });
  }, [isVisible, onReadinessChange, routeDataSettled]);

  const expirationOptions = useMemo(
    () => [
      {
        value: "all",
        label:
          gexData?.source?.expirationCoverage?.complete === true &&
          (gexData.source.expirationCoverage.failedCount || 0) === 0 &&
          gexData.source.expirationCoverage.capped !== true
            ? "All expirations"
            : "All loaded expirations",
      },
      ...expirationDates.map((date) => ({ value: date, label: date })),
    ],
    [expirationDates, gexData?.source?.expirationCoverage],
  );
  const visibleMobileExpirationOptions = expirationOptions.slice(0, 9);
  const hiddenMobileExpirationCount = Math.max(
    0,
    expirationOptions.length - visibleMobileExpirationOptions.length,
  );
  const hiddenMobileExpirationSelected =
    hiddenMobileExpirationCount > 0 &&
    !visibleMobileExpirationOptions.some((option) => option.value === expirationFilter);
  const tickerSearchControl = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(6),
        padding: sp("0 8px"),
        ...fieldStyle,
      }}
    >
      <Search size={14} color={CSS_COLOR.textDim} />
      <GexTickerInput
        value={ticker}
        onCommit={commitTicker}
        isPhone={isPhone}
      />
    </div>
  );
  const filtersControl = (
    <>
      <select
        value={expirationFilter}
        onChange={(event) => setExpirationFilter(event.target.value)}
        style={{
          ...fieldStyle,
          minWidth: dim(156),
          padding: sp("0 8px"),
        }}
      >
        {expirationOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <SegmentControl
        value={series}
        onChange={setSeries}
        options={[
          { value: "net", label: "Net GEX" },
          { value: "callput", label: "Call/Put" },
        ]}
      />
      <SegmentControl
        value={view}
        onChange={setView}
        options={[
          { value: "graph", label: "Graph" },
          { value: "table", label: "Table" },
        ]}
      />
    </>
  );

  return (
    <div
      ref={gexRootRef}
      data-testid="gex-screen"
      data-layout={isPhone ? "phone" : isNarrow ? "tablet" : "desktop"}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: CSS_COLOR.bg0,
        color: CSS_COLOR.text,
        fontFamily: T.sans,
        WebkitOverflowScrolling: isPhone ? "touch" : undefined,
      }}
    >
      <div
        style={{
          display: "grid",
          gap: sp(isPhone ? 12 : 18),
          padding: sp(isPhone ? "8px 10px 18px" : "20px 28px 28px"),
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: sp(8),
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          {tickerSearchControl}
          {isPhone ? (
            <Button
              dataTestId="gex-mobile-filter-trigger"
              variant="secondary"
              size="md"
              leftIcon={SlidersHorizontal}
              onClick={() => setMobileFiltersOpen(true)}
            >
              Filters
            </Button>
          ) : (
            filtersControl
          )}
        </div>

        {isPhone ? (
          <>
            <div
              data-testid="gex-mobile-expiration-chips"
              className="ra-hide-scrollbar"
              style={{
                display: "flex",
                gap: sp(4),
                overflowX: "auto",
                paddingBottom: sp(1),
              }}
            >
              {visibleMobileExpirationOptions.map((option) => {
                const active = option.value === expirationFilter;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setExpirationFilter(option.value)}
                    style={{
                      flex: "0 0 auto",
                      minHeight: dim(36),
                      padding: sp("0 10px"),
                      border: `1px solid ${active ? CSS_COLOR.accent : CSS_COLOR.border}`,
                      borderRadius: dim(RADII.xs),
                      background: active ? `${cssColorMix(CSS_COLOR.accent, 9)}` : CSS_COLOR.bg1,
                      color: active ? CSS_COLOR.text : CSS_COLOR.textSec,
                      fontFamily: T.sans,
                      fontSize: textSize("caption"),
                      cursor: "pointer",
                    }}
                  >
                    {option.value === "all" ? "All" : option.label.slice(5)}
                  </button>
                );
              })}
              {hiddenMobileExpirationCount > 0 ? (
                <button
                  type="button"
                  data-testid="gex-mobile-expiration-more"
                  onClick={() => setMobileFiltersOpen(true)}
                  style={{
                    flex: "0 0 auto",
                    minHeight: dim(36),
                    padding: sp("0 10px"),
                    border: `1px solid ${
                      hiddenMobileExpirationSelected ? CSS_COLOR.accent : CSS_COLOR.border
                    }`,
                    borderRadius: dim(RADII.xs),
                    background: hiddenMobileExpirationSelected
                      ? `${cssColorMix(CSS_COLOR.accent, 9)}`
                      : CSS_COLOR.bg1,
                    color: hiddenMobileExpirationSelected ? CSS_COLOR.text : CSS_COLOR.textSec,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    cursor: "pointer",
                  }}
                >
                  +{hiddenMobileExpirationCount} more
                </button>
              ) : null}
            </div>
            <BottomSheet
              open={mobileFiltersOpen}
              onClose={() => setMobileFiltersOpen(false)}
              title="GEX Filters"
              testId="gex-mobile-filter-sheet"
            >
              <div
                style={{
                  display: "grid",
                  gap: sp(10),
                  padding: sp(10),
                }}
              >
                {filtersControl}
              </div>
            </BottomSheet>
          </>
        ) : null}

        <Card
          style={{
            display: "grid",
            gridTemplateColumns: isPhone
              ? "minmax(0, 1fr)"
              : "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
            gap: sp(isPhone ? 7 : 10),
            padding: isPhone ? sp("8px 10px") : undefined,
          }}
        >
          <div
            style={{
              display: isPhone ? "flex" : "block",
              alignItems: isPhone ? "baseline" : undefined,
              justifyContent: isPhone ? "space-between" : undefined,
              gap: sp(8),
              minWidth: 0,
            }}
          >
            <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>Spot</div>
            <div style={{ color: CSS_COLOR.text, fontSize: fs(isPhone ? 20 : 24), fontWeight: FONT_WEIGHTS.emphasis }}>
              {fmtPrice(spot)}
            </div>
            <div
              style={{
                color:
                  toneForFinancialDelta(quoteChange),
                fontSize: textSize("caption"),
              }}
            >
              {quoteChange == null ? "—" : fmtCurrency(quoteChange)}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: sp(6),
            }}
          >
            <ConcentrationTile
              label="0DTE Exp"
              value={concentration.zeroDTE}
              color={CSS_COLOR.amber}
              glossaryKey="concentration0dte"
            />
            <ConcentrationTile
              label="Weekly Exp"
              value={concentration.weekly}
              color={CSS_COLOR.cyan}
              glossaryKey="concentrationWeekly"
            />
            <ConcentrationTile
              label="Monthly Exp"
              value={concentration.monthly}
              color={CSS_COLOR.purple}
              glossaryKey="concentrationMonthly"
            />
          </div>
          <TickerMetaSummary data={gexData} />
          <div>
            <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>
              Sourced strikes {filteredRows.length.toLocaleString("en-US")} · Provider IV {providerIvCount}/{filteredRows.length} · GEX uses provider gamma
            </div>
            <div
              data-testid="gex-source-last-updated"
              style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}
            >
              Updated {sourceLastUpdatedLabel}
            </div>
          </div>
        </Card>

        <SourceCoverageBanner
          data={gexData}
          warnings={sourceCoverageWarnings}
          lastUpdatedLabel={sourceLastUpdatedLabel}
        />

        {chainError ? (
          <DataUnavailableState
            variant="error"
            title="GEX chain unavailable"
            detail={chainError?.message || "Option chain hydration failed."}
          />
        ) : noExpirations ? (
          <DataUnavailableState
            title={`No option expirations for ${ticker}`}
            detail="The option chain provider did not return expirations for this symbol."
          />
        ) : loading ? (
          <DataUnavailableState
            loading
            title={`Loading GEX for ${ticker}`}
            detail="Waiting for quote, expiration, and IBKR option-chain snapshots."
            loadingWaitItems={[
              {
                id: "gex-chain",
                label: `${ticker} GEX inputs`,
                status: "loading",
                detail: "quote, expiration, and option-chain snapshots",
                endpoint: "/api/gex",
              },
            ]}
            minHeight={isPhone ? 92 : 72}
          />
        ) : spot == null ? (
          <DataUnavailableState
            title={`Spot unavailable for ${ticker}`}
            detail="GEX needs a current underlying price before it can scale gamma exposure."
          />
        ) : !filteredRows.length ? (
          <DataUnavailableState
            title={`No GEX contracts for ${ticker}`}
            detail="The loaded option chains did not contain usable call or put contracts."
          />
        ) : !dataReady ? (
          <DataUnavailableState
            title={`GEX unavailable for ${ticker}`}
            detail="The loaded option chain could not produce a gamma exposure profile."
          />
        ) : (
          <>
            <Card noPad style={{ display: "flex", flexWrap: "wrap" }}>
              <MetricTile
                label="Net GEX"
                value={fmtCurrency(metrics.netGex)}
                sub={`Ratio ${Number.isFinite(metrics.ratio) ? metrics.ratio.toFixed(2) : "—"}`}
                color={toneForNetGex(metrics.netGex)}
                glossaryKey="netGex"
              />
              <MetricTile
                label="Call GEX"
                value={fmtCurrency(metrics.callGex)}
                sub={`${fmtNumber(metrics.callOi)} OI`}
                color={GEX_CALL_TONE}
                glossaryKey="callGex"
              />
              <MetricTile
                label="Put GEX"
                value={fmtCurrency(metrics.putGex)}
                sub={`${fmtNumber(metrics.putOi)} OI`}
                color={CSS_COLOR.red}
                glossaryKey="putGex"
              />
              <MetricTile
                label="Total GEX"
                value={fmtCurrency(metrics.totalGex)}
                sub={`${fmtNumber(metrics.callOi + metrics.putOi)} OI`}
                color={CSS_COLOR.cyan}
                glossaryKey="totalGex"
              />
              <MetricTile
                label="Call Wall"
                value={formatGexStrikePrice(metrics.callWall)}
                sub={fmtPercent((metrics.callWall - spot) / spot)}
                color={GEX_CALL_TONE}
                glossaryKey="callWall"
              />
              <MetricTile
                label="Put Wall"
                value={formatGexStrikePrice(metrics.putWall)}
                sub={fmtPercent((metrics.putWall - spot) / spot)}
                color={CSS_COLOR.red}
                glossaryKey="putWall"
              />
              <MetricTile
                label="Zero Gamma"
                value={fmtPrice(metrics.zeroGamma)}
                sub={metrics.zeroGamma ? fmtPercent((metrics.zeroGamma - spot) / spot) : "—"}
                color={CSS_COLOR.cyan}
                glossaryKey="zeroGamma"
              />
            </Card>

            {coverageRatio < 0.5 ? (
              <DataUnavailableState
                title="Greek/OI coverage is partial"
                detail={`${coverage.withGamma}/${coverage.usable} IBKR contracts have gamma and ${coverage.withOpenInterest}/${coverage.usable} have open interest. Charts render from available fields.`}
              />
            ) : null}

            {view === "table" ? (
              <ProfileTable profile={metrics.profile} spot={spot} />
            ) : null}

            {view === "graph" ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${dim(360)}px), 1fr))`,
                  gap: sp(10),
                  alignItems: "start",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <StrikeProfileChart
                    profile={metrics.profile}
                    spot={spot}
                    series={series}
                    callWall={metrics.callWall}
                    putWall={metrics.putWall}
                  />
                </div>
                <div style={{ display: "grid", gap: sp(10), minWidth: 0 }}>
                  <IntradayCard snapshots={snapshots} />
                  <SignalsCard signals={signals} />
                  <SqueezeCard squeeze={squeeze} source={gexData?.source} />
                </div>
              </div>
            ) : null}

            <HeatmapCard rows={filteredRows} spot={spot} />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${dim(360)}px), 1fr))`,
                gap: sp(10),
                alignItems: "start",
              }}
            >
              <div style={{ display: "grid", gap: sp(10), minWidth: 0 }}>
                <ExpiryChart rows={filteredRows} spot={spot} />
                <SectionHeading title="Open Interest Analysis" />
                <OiChart rows={filteredRows} spot={spot} />
              </div>
              {view === "table" ? (
                <div style={{ display: "grid", gap: sp(10), minWidth: 0 }}>
                  <IntradayCard snapshots={snapshots} />
                  <SignalsCard signals={signals} />
                  <SqueezeCard squeeze={squeeze} source={gexData?.source} />
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const ConcentrationTile = ({ label, value, color, glossaryKey }) => (
  <div style={{ background: CSS_COLOR.bg0, border: "none", padding: sp(8) }}>
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(3),
        color: CSS_COLOR.textDim,
        fontSize: textSize("caption"),
      }}
    >
      {label}
      {glossaryKey ? (
        <InfoTooltipIcon entry={getGexGlossaryEntry(glossaryKey)} />
      ) : null}
    </div>
    <div style={{ color, fontSize: fs(17), fontWeight: FONT_WEIGHTS.emphasis }}>
      {(value * 100).toFixed(1)}%
    </div>
  </div>
);

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
