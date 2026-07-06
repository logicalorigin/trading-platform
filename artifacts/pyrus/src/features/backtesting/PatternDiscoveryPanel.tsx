import { Fragment, useMemo, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import {
  getListBacktestStudiesQueryKey,
  getGetPatternDiscoveryResultsQueryKey,
  getPatternDiscoveryResults,
  getGetPatternOccurrencesQueryKey,
  useCreatePatternDiscoveryStudy,
  useGetPatternDiscoveryResults,
  useGetPatternOccurrences,
  useListBacktestStudies,
} from "@workspace/api-client-react";
import type {
  BacktestStudyRecord,
  PatternDiscoveryResult,
  PatternDiscoveryResults,
  PatternDiscoveryStudyInput,
  PatternOccurrence,
  PatternOccurrenceSymbolAgg,
  PatternOccurrences,
} from "@workspace/api-client-react";
// `.jsx` design-system modules are imported directly into this `.tsx` file, the
// same proven pattern BacktestingPanels.tsx / ChartMobileSheets.tsx use: the
// modules carry no `.d.ts` shim, so each import is annotated with the same
// `@ts-expect-error` the existing code uses (they resolve as `any`).
// @ts-expect-error JSX module imported into TypeScript context
import { PatternVector } from "../../components/platform/signal-language/PatternVector.jsx";
// @ts-expect-error JSX module imported into TypeScript context
import { DenseVirtualTable } from "../../components/platform/DenseVirtualTable.jsx";
// @ts-expect-error JSX module imported into TypeScript context
import { Badge, CardTitle, DataUnavailableState, Select, StatusPill, surfaceStyle, TextField } from "../../components/platform/primitives.jsx";
import {
  cssColorAlpha,
  cssColorMix,
  CSS_COLOR,
  dim,
  FONT_WEIGHTS,
  fs,
  G,
  MISSING_VALUE,
  RADII,
  sp,
  T,
  // @ts-expect-error JSX module imported into TypeScript context
} from "../../lib/uiTokens.jsx";
import { chartTooltipContentStyle } from "../../lib/tooltipStyles";
// @ts-expect-error JS module imported into TypeScript context
import { toneForDirectionalIntent } from "../platform/semanticToneModel.js";
import {
  classifyPatternBiasAlignment,
  classifyPatternSetup,
  expectedBiasForPatternSetup,
  PATTERN_SETUP_FAMILIES,
  setupFamilyById,
  summarizePatternSetupFamilies,
  totalPossiblePatternCombinations,
  type PatternSetupFamilyId,
  type PatternSetupFamilySummary,
} from "./patternDiscoveryFamilies";

// ---------------------------------------------------------------------------
// Local style replicas.
//
// SectionCard / inputStyle / buttonStyle / fieldLabelStyle / StatusBadge /
// MetricCard live as MODULE-PRIVATE helpers inside BacktestingPanels.tsx and
// are not exported; they also depend on a private (theme, scale) runtime
// contract that does not exist outside that file. Per the brief, this panel
// stays self-contained, so the styles below are copied from those definitions
// (BacktestingPanels.tsx:934-1189) but rebound onto the public uiTokens proxy
// (T / CSS_COLOR / fs / sp / dim / cssColorAlpha) so they resolve identically.
// ---------------------------------------------------------------------------

const SANS = T.sans as string;
const MONO = T.mono as string;
const DISPLAY = T.display as string;

const inputStyle: CSSProperties = {
  width: "100%",
  padding: sp("8px 10px"),
  borderRadius: dim(RADII.xs),
  border: `1px solid ${CSS_COLOR.border}`,
  background: CSS_COLOR.bg0,
  color: CSS_COLOR.text,
  fontFamily: MONO,
  fontSize: fs(10),
};

const buttonStyle = (
  variant: "primary" | "secondary" | "ghost" = "secondary",
): CSSProperties => {
  const background =
    variant === "primary"
      ? CSS_COLOR.accent
      : variant === "ghost"
        ? "transparent"
        : CSS_COLOR.bg0;
  const color =
    variant === "secondary" || variant === "ghost"
      ? CSS_COLOR.textSec
      : CSS_COLOR.onAccent;
  return {
    border:
      variant === "secondary" || variant === "ghost"
        ? `1px solid ${CSS_COLOR.border}`
        : "none",
    background,
    color,
    borderRadius: dim(RADII.xs),
    padding: sp("6px 9px"),
    fontFamily: SANS,
    fontSize: fs(10),
    fontWeight: FONT_WEIGHTS.regular,
    cursor: "pointer",
  };
};

const fieldLabelStyle: CSSProperties = {
  fontSize: fs(9),
  fontWeight: FONT_WEIGHTS.regular,
  color: CSS_COLOR.textMuted,
  letterSpacing: "0.04em",
  marginBottom: sp(4),
  textTransform: "uppercase",
};

function SectionCard({
  title,
  right,
  children,
  style,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="ra-panel-enter"
      style={{ ...surfaceStyle({ radius: RADII.xs }), padding: sp("8px 10px"), ...style }}
    >
      <CardTitle right={right}>{title}</CardTitle>
      {children}
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return CSS_COLOR.green;
    case "running":
    case "preparing_data":
    case "aggregating":
      return CSS_COLOR.accent;
    case "cancel_requested":
      return CSS_COLOR.amber;
    case "failed":
    case "canceled":
      return CSS_COLOR.red;
    default:
      return CSS_COLOR.textDim;
  }
}

function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status);
  const activeStatus = [
    "running",
    "preparing_data",
    "aggregating",
    "queued",
    "pending",
  ].includes(status);
  return (
    <StatusPill color={color} glow={activeStatus}>
      {status.replaceAll("_", " ")}
    </StatusPill>
  );
}

// Bias chip modeled on ConfluenceChip.jsx (pill: border alpha 55, bg alpha
// 1A). Tone follows PatternVector's blue=bullish / red=bearish language.
function biasTone(bias: string): string {
  return bias === "long"
    ? CSS_COLOR.blue
    : bias === "short"
      ? CSS_COLOR.red
      : cssColorMix(CSS_COLOR.textDim, 58);
}

function BiasChip({ bias }: { bias: string }) {
  const tone = biasTone(bias);
  const label = bias === "long" ? "Long" : bias === "short" ? "Short" : "Neutral";
  return <Badge color={tone}>{label}</Badge>;
}

function familyTone(familyId: PatternSetupFamilyId): string {
  switch (familyId) {
    case "bull_confluence":
      return CSS_COLOR.blue;
    case "bear_confluence":
      return CSS_COLOR.red;
    case "fast_bullish_reversal":
      return toneForDirectionalIntent("bullish");
    case "fast_bearish_reversal":
      return toneForDirectionalIntent("bearish");
    case "mixed_divergence":
      return CSS_COLOR.purple;
    case "inactive":
    default:
      return cssColorMix(CSS_COLOR.textDim, 58);
  }
}

function FamilyChip({
  familyId,
  compact = false,
}: {
  familyId: PatternSetupFamilyId;
  compact?: boolean;
}) {
  const family = setupFamilyById(familyId);
  const tone = familyTone(familyId);
  return (
    <span
      title={family.description}
      style={{
        display: "inline-flex",
        alignItems: "center",
        maxWidth: "100%",
        height: dim(16),
        padding: sp("0 5px"),
        borderRadius: dim(RADII.pill),
        border: `1px solid ${cssColorAlpha(tone, "55")}`,
        background: cssColorAlpha(tone, "18"),
        color: tone,
        fontFamily: SANS,
        fontSize: fs(8),
        fontWeight: FONT_WEIGHTS.medium,
        lineHeight: 1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
      }}
    >
      {compact ? family.shortLabel : family.label}
    </span>
  );
}

function edgeTone(alignment: ReturnType<typeof classifyPatternBiasAlignment>): string {
  switch (alignment) {
    case "aligned":
      return CSS_COLOR.green;
    case "counter":
      return CSS_COLOR.red;
    case "neutral":
    default:
      return cssColorMix(CSS_COLOR.textDim, 58);
  }
}

function EdgeChip({ result }: { result: PatternDiscoveryResult }) {
  const family = classifyPatternSetup(result.patternKey);
  const expected = expectedBiasForPatternSetup(family.id);
  const alignment = classifyPatternBiasAlignment(result.patternKey, result.bias);
  const tone = edgeTone(alignment);
  const label =
    alignment === "aligned" ? "Aligned" : alignment === "counter" ? "Counter" : "Neutral";
  const title = expected
    ? `${family.label}: expected ${expected}, observed ${result.bias}.`
    : `${family.label}: no directional thesis.`;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        maxWidth: "100%",
        height: dim(16),
        padding: sp("0 5px"),
        borderRadius: dim(RADII.pill),
        border: `1px solid ${cssColorAlpha(tone, "55")}`,
        background: cssColorAlpha(tone, "18"),
        color: tone,
        fontFamily: SANS,
        fontSize: fs(8),
        fontWeight: FONT_WEIGHTS.medium,
        lineHeight: 1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Formatting + numeric helpers
// ---------------------------------------------------------------------------

const isNum = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

const fmtPct = (value: number | null | undefined, decimals = 2): string =>
  isNum(value) ? `${value >= 0 ? "" : ""}${value.toFixed(decimals)}%` : MISSING_VALUE;

const fmtSignedPct = (value: number | null | undefined, decimals = 2): string =>
  isNum(value)
    ? `${value > 0 ? "+" : value < 0 ? "" : ""}${value.toFixed(decimals)}%`
    : MISSING_VALUE;

const fmtNum = (value: number | null | undefined, decimals = 2): string =>
  isNum(value) ? value.toFixed(decimals) : MISSING_VALUE;

const signedColor = (value: number | null | undefined): string =>
  !isNum(value) || value === 0
    ? CSS_COLOR.textDim
    : value > 0
      ? CSS_COLOR.blue
      : CSS_COLOR.red;

const todayISO = (): string => new Date().toISOString().slice(0, 10);
const daysAgoISO = (days: number): string =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

// Parse a comma/whitespace list into a clean, upper-cased symbol array.
const parseSymbols = (raw: string): string[] =>
  raw
    .split(/[\s,]+/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);

const RUNNING_STATUSES = new Set([
  "running",
  "preparing_data",
  "aggregating",
  "queued",
  "pending",
]);

const DEFAULT_TIMEFRAMES = ["1m", "2m", "5m", "15m"];
const TIMEFRAME_CHOICES = ["1m", "2m", "5m", "15m", "30m", "1h"];

// ---------------------------------------------------------------------------
// Inline data-bar (Win%): a thin track filled to `pct`, accent tinted.
// ---------------------------------------------------------------------------

function WinRateBar({ pct }: { pct: number | null }) {
  const clamped = isNum(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(4),
        width: "100%",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: fs(10),
          color: CSS_COLOR.text,
          minWidth: dim(34),
          textAlign: "right",
        }}
      >
        {isNum(pct) ? `${pct.toFixed(1)}%` : MISSING_VALUE}
      </span>
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          flex: 1,
          minWidth: dim(24),
          height: dim(4),
          borderRadius: dim(RADII.pill),
          background: cssColorMix(CSS_COLOR.border, 60),
          overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            width: `${clamped}%`,
            background: G.dataBarPositive,
            borderRadius: dim(RADII.pill),
          }}
        />
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Significance tier for the t-stat cell (independent of low-n dimming).
// ---------------------------------------------------------------------------

const tStatStyle = (tStat: number | null): CSSProperties => {
  if (!isNum(tStat)) {
    return { color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.regular };
  }
  const magnitude = Math.abs(tStat);
  if (magnitude >= 2) {
    return { color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.emphasis };
  }
  if (magnitude >= 1.5) {
    return { color: CSS_COLOR.textSec, fontWeight: FONT_WEIGHTS.medium };
  }
  return { color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.regular };
};

// ---------------------------------------------------------------------------
// Return-distribution histogram (drill-in).
// ---------------------------------------------------------------------------

type HistBucket = {
  label: string;
  count: number;
  center: number;
};

function buildHistogram(occurrences: PatternOccurrence[]): {
  buckets: HistBucket[];
  mean: number | null;
  median: number | null;
} {
  const values = occurrences
    .map((occ) => occ.realizedReturnPct)
    .filter(isNum) as number[];
  if (values.length === 0) {
    return { buckets: [], mean: null, median: null };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max), 0.01);
  const binCount = Math.min(16, Math.max(6, Math.round(Math.sqrt(values.length))));
  const width = span / binCount || 0.01;
  const buckets: HistBucket[] = Array.from({ length: binCount }, (_, index) => {
    const lo = min + index * width;
    const center = lo + width / 2;
    return { label: center.toFixed(2), count: 0, center };
  });
  values.forEach((value) => {
    let index = Math.floor((value - min) / width);
    if (index < 0) index = 0;
    if (index >= binCount) index = binCount - 1;
    buckets[index].count += 1;
  });
  const sum = values.reduce((acc, value) => acc + value, 0);
  const mean = sum / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  return { buckets, mean, median };
}

function ReturnHistogram({ occurrences }: { occurrences: PatternOccurrence[] }) {
  const { buckets, mean, median } = useMemo(
    () => buildHistogram(occurrences),
    [occurrences],
  );
  if (buckets.length === 0) {
    return (
      <div
        style={{
          height: dim(220),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: CSS_COLOR.textDim,
          fontSize: fs(10),
          fontFamily: SANS,
        }}
      >
        No realized-return samples to plot.
      </div>
    );
  }
  return (
    <div style={{ height: dim(220) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          role="img"
          aria-label="Forward return distribution histogram"
          data={buckets}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            stroke={CSS_COLOR.borderLight}
            strokeDasharray="0"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: CSS_COLOR.textMuted, fontSize: fs(8) }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            tick={{ fill: CSS_COLOR.textMuted, fontSize: fs(8) }}
          />
          <Tooltip
            contentStyle={chartTooltipContentStyle}
            formatter={(value: number) => [value, "count"]}
            labelFormatter={(label: string) => `${label}% return`}
          />
          <ReferenceLine x={0} stroke={CSS_COLOR.textMuted} strokeWidth={1} />
          {isNum(mean) ? (
            <ReferenceLine
              x={mean.toFixed(2)}
              stroke={CSS_COLOR.amber}
              strokeDasharray="4 3"
              label={{
                value: "mean",
                fill: CSS_COLOR.amber,
                fontSize: fs(8),
                position: "top",
              }}
            />
          ) : null}
          {isNum(median) ? (
            <ReferenceLine
              x={median.toFixed(2)}
              stroke={CSS_COLOR.cyan}
              strokeDasharray="2 3"
              label={{
                value: "med",
                fill: CSS_COLOR.cyan,
                fontSize: fs(8),
                position: "bottom",
              }}
            />
          ) : null}
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {buckets.map((bucket, index) => (
              <Cell
                key={index}
                fill={bucket.center >= 0 ? CSS_COLOR.blue : CSS_COLOR.red}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk shape: avgMae (downside) vs avgMfe (upside) opposing bars.
// ---------------------------------------------------------------------------

function RiskShape({ result }: { result: PatternDiscoveryResult }) {
  const mae = isNum(result.avgMaePct) ? Math.abs(result.avgMaePct) : 0;
  const mfe = isNum(result.avgMfePct) ? Math.abs(result.avgMfePct) : 0;
  const ceiling = Math.max(mae, mfe, 0.01);
  const bar = (
    label: string,
    value: number | null,
    magnitude: number,
    tone: string,
  ) => (
    <div style={{ display: "flex", alignItems: "center", gap: sp(6) }}>
      <span
        style={{
          width: dim(54),
          fontFamily: SANS,
          fontSize: fs(9),
          color: CSS_COLOR.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          position: "relative",
          flex: 1,
          height: dim(8),
          borderRadius: dim(RADII.pill),
          background: cssColorMix(CSS_COLOR.border, 50),
          overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            width: `${(magnitude / ceiling) * 100}%`,
            background: cssColorAlpha(tone, "B0"),
            borderRadius: dim(RADII.pill),
          }}
        />
      </span>
      <span
        style={{
          width: dim(52),
          textAlign: "right",
          fontFamily: MONO,
          fontSize: fs(10),
          color: tone,
        }}
      >
        {fmtSignedPct(value)}
      </span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sp(6) }}>
      {bar("Avg MFE", result.avgMfePct, mfe, CSS_COLOR.blue)}
      {bar("Avg MAE", result.avgMaePct, mae, CSS_COLOR.red)}
      <div
        style={{
          display: "flex",
          gap: sp(12),
          marginTop: sp(2),
          fontFamily: MONO,
          fontSize: fs(9),
          color: CSS_COLOR.textDim,
        }}
      >
        <span>win {fmtPct(result.winRatePct, 1)}</span>
        <span>med {fmtSignedPct(result.medianReturnPct, 3)}</span>
        <span>std {fmtPct(result.stdReturnPct, 3)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-symbol breakdown rows
// ---------------------------------------------------------------------------

function PerSymbolBreakdown({ rows }: { rows: PatternOccurrenceSymbolAgg[] }) {
  if (rows.length === 0) {
    return (
      <div style={{ color: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: SANS }}>
        No per-symbol aggregates.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto auto",
          gap: sp(8),
          fontFamily: SANS,
          fontSize: fs(8),
          color: CSS_COLOR.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          paddingBottom: sp(2),
          borderBottom: `1px solid ${CSS_COLOR.border}`,
        }}
      >
        <span>Symbol</span>
        <span style={{ textAlign: "right" }}>n</span>
        <span style={{ textAlign: "right" }}>Win%</span>
        <span style={{ textAlign: "right" }}>Mean%</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.symbol}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto auto",
            gap: sp(8),
            fontFamily: MONO,
            fontSize: fs(10),
            color: CSS_COLOR.textSec,
            padding: sp("2px 0"),
          }}
        >
          <span style={{ color: CSS_COLOR.text }}>{row.symbol}</span>
          <span style={{ textAlign: "right" }}>{row.count}</span>
          <span style={{ textAlign: "right" }}>{fmtPct(row.winRatePct, 1)}</span>
          <span style={{ textAlign: "right", color: signedColor(row.meanReturnPct) }}>
            {fmtSignedPct(row.meanReturnPct, 3)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Occurrence timeline: dots across time, blue/red by realized-return sign.
// ---------------------------------------------------------------------------

function OccurrenceTimeline({ occurrences }: { occurrences: PatternOccurrence[] }) {
  const points = useMemo(() => {
    const dated = occurrences
      .map((occ) => ({ ...occ, t: Date.parse(occ.occurredAt) }))
      .filter((occ) => Number.isFinite(occ.t))
      .sort((a, b) => a.t - b.t);
    if (dated.length === 0) return [];
    const min = dated[0].t;
    const max = dated[dated.length - 1].t;
    const span = max - min || 1;
    return dated.map((occ) => ({
      key: `${occ.symbol}-${occ.occurredAt}`,
      left: ((occ.t - min) / span) * 100,
      tone: signedColor(occ.realizedReturnPct),
      title: `${occ.symbol} | ${occ.occurredAt} | ${fmtSignedPct(occ.realizedReturnPct, 3)}`,
    }));
  }, [occurrences]);
  if (points.length === 0) {
    return (
      <div style={{ color: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: SANS }}>
        No dated occurrences.
      </div>
    );
  }
  return (
    <div
      style={{
        position: "relative",
        height: dim(22),
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg0,
        border: `1px solid ${CSS_COLOR.border}`,
        overflow: "hidden",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: sp(6),
          right: sp(6),
          top: "50%",
          height: 1,
          background: cssColorMix(CSS_COLOR.border, 70),
        }}
      />
      {points.map((point) => (
        <span
          key={point.key}
          title={point.title}
          style={{
            position: "absolute",
            top: "50%",
            left: `calc(${sp(6)}px + (100% - ${sp(12)}px) * ${point.left / 100})`,
            width: dim(6),
            height: dim(6),
            marginTop: -dim(3),
            marginLeft: -dim(3),
            borderRadius: "50%",
            background: point.tone,
            boxShadow: `0 0 0 1px ${cssColorAlpha(point.tone, "55")}`,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drill-in detail (rendered inside DenseVirtualTable.renderRowDetail)
// ---------------------------------------------------------------------------

const detailSubLabel: CSSProperties = {
  fontSize: fs(9),
  fontWeight: FONT_WEIGHTS.label,
  color: CSS_COLOR.textMuted,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: sp(6),
};

const detailPanel: CSSProperties = {
  background: CSS_COLOR.bg0,
  border: `1px solid ${CSS_COLOR.border}`,
  borderRadius: dim(RADII.sm),
  padding: sp("10px 12px"),
};

function PatternDetail({
  studyId,
  result,
  horizonBars,
}: {
  studyId: string;
  result: PatternDiscoveryResult;
  horizonBars: number;
}) {
  const occurrencesQuery = useGetPatternOccurrences(
    studyId,
    { patternKey: result.patternKey, horizonBars },
    {
      query: {
        queryKey: getGetPatternOccurrencesQueryKey(studyId, {
          patternKey: result.patternKey,
          horizonBars,
        }),
        enabled: Boolean(studyId),
      },
    },
  );
  const data: PatternOccurrences | undefined = occurrencesQuery.data;
  const loading = occurrencesQuery.isLoading;
  const errored = occurrencesQuery.isError;

  return (
    <div
      style={{
        padding: sp("12px 14px"),
        background: CSS_COLOR.bg1,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        display: "flex",
        flexDirection: "column",
        gap: sp(12),
        height: "100%",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(12),
          flexWrap: "wrap",
        }}
      >
        <PatternVector
          patternKey={result.patternKey}
          bias={result.bias}
          showLabels
        />
        <FamilyChip familyId={classifyPatternSetup(result.patternKey).id} />
        <BiasChip bias={result.bias} />
        <EdgeChip result={result} />
        <span
          style={{
            fontFamily: MONO,
            fontSize: fs(10),
            color: CSS_COLOR.textDim,
          }}
        >
          {result.sampleCount} samples | h={result.horizonBars} bars
        </span>
      </div>

      {errored ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            color: CSS_COLOR.red,
            fontSize: fs(10),
            fontFamily: SANS,
          }}
        >
          <AlertTriangle size={dim(14)} strokeWidth={2} />
          Failed to load occurrences for this pattern.
        </div>
      ) : loading || !data ? (
        <div style={{ color: CSS_COLOR.textDim, fontSize: fs(10), fontFamily: SANS }}>
          Loading occurrences...
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
            gap: sp(12),
            alignItems: "start",
          }}
        >
          <div style={detailPanel}>
            <div style={detailSubLabel}>Forward return distribution</div>
            <ReturnHistogram occurrences={data.occurrences} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: sp(12) }}>
            <div style={detailPanel}>
              <div style={detailSubLabel}>Risk shape</div>
              <RiskShape result={result} />
            </div>
            <div style={detailPanel}>
              <div style={detailSubLabel}>Per-symbol</div>
              <PerSymbolBreakdown rows={data.perSymbol} />
            </div>
          </div>
          <div style={{ ...detailPanel, gridColumn: "1 / -1" }}>
            <div style={detailSubLabel}>Occurrence timeline</div>
            <OccurrenceTimeline occurrences={data.occurrences} />
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          disabled
          title="wired in Phase 3"
          style={{
            ...buttonStyle("secondary"),
            opacity: 0.55,
            cursor: "not-allowed",
          }}
        >
          Promote pattern -&gt; algo gate
        </button>
      </div>
    </div>
  );
}

type FamilyFilter = "all" | PatternSetupFamilyId;

function PatternSetupAtlasStrip({
  summaries,
  activeFamily,
  onFamilyChange,
  observedCount,
  possibleCount,
  visibleCount,
}: {
  summaries: PatternSetupFamilySummary[];
  activeFamily: FamilyFilter;
  onFamilyChange: (family: FamilyFilter) => void;
  observedCount: number;
  possibleCount: number;
  visibleCount: number;
}) {
  const allActive = activeFamily === "all";
  const totalSamples = summaries.reduce((sum, summary) => sum + summary.sampleCount, 0);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(140px, 0.9fr) minmax(0, 2.4fr)",
        gap: sp(10),
        alignItems: "stretch",
        marginBottom: sp(10),
      }}
    >
      <button
        type="button"
        onClick={() => onFamilyChange("all")}
        style={{
          ...buttonStyle(allActive ? "primary" : "secondary"),
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          minHeight: dim(54),
          gap: sp(3),
          textAlign: "left",
        }}
      >
        <span style={{ fontFamily: SANS, fontSize: fs(9), textTransform: "uppercase" }}>
          All combinations
        </span>
        <span style={{ fontFamily: MONO, fontSize: fs(13), fontWeight: FONT_WEIGHTS.medium }}>
          {observedCount}/{possibleCount}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: fs(8),
            color: allActive ? CSS_COLOR.onAccent : CSS_COLOR.textMuted,
          }}
        >
          visible {visibleCount} | samples {totalSamples}
        </span>
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(126px, 1fr))",
          gap: sp(6),
        }}
      >
        {summaries.map((summary) => {
          const active = activeFamily === summary.id;
          const tone = familyTone(summary.id);
          return (
            <button
              key={summary.id}
              type="button"
              title={summary.description}
              onClick={() => onFamilyChange(active ? "all" : summary.id)}
              style={{
                border: `1px solid ${active ? cssColorAlpha(tone, "88") : CSS_COLOR.border}`,
                background: active ? cssColorAlpha(tone, "20") : CSS_COLOR.bg0,
                color: active ? tone : CSS_COLOR.textSec,
                borderRadius: dim(RADII.xs),
                padding: sp("6px 7px"),
                minHeight: dim(54),
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: sp(4),
                textAlign: "left",
              }}
            >
              <FamilyChip familyId={summary.id} compact />
              <span
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: sp(6),
                  width: "100%",
                  fontFamily: MONO,
                  fontSize: fs(9),
                  color: active ? tone : CSS_COLOR.textMuted,
                }}
              >
                <span>{summary.patternCount} patterns</span>
                <span>{summary.sampleCount} n</span>
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: sp(6),
                  width: "100%",
                  fontFamily: MONO,
                  fontSize: fs(9),
                }}
              >
                <span style={{ color: signedColor(summary.weightedMeanReturnPct) }}>
                  {fmtSignedPct(summary.weightedMeanReturnPct, 3)}
                </span>
                <span style={{ color: active ? tone : CSS_COLOR.textDim }}>
                  |t| {fmtNum(summary.bestAbsTStat, 2)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard column model
// ---------------------------------------------------------------------------

type SortColumnId =
  | "rank"
  | "sampleCount"
  | "winRatePct"
  | "meanReturnPct"
  | "tStat"
  | "avgMaePct"
  | "avgMfePct";

type LeaderboardColumn = {
  id: string;
  header: string;
  meta: {
    width: string;
    align?: "left" | "right" | "center";
    sortable?: boolean;
    sortKey?: SortColumnId;
    label: string;
  };
  cell: (row: PatternDiscoveryResult) => ReactNode;
};

// The DenseVirtualTable cell wires through `cell.getValue()` for accessor
// columns, but we use a display column whose `cell` receives the TanStack
// context. We adapt by reading `row.original` inside a thin wrapper.
type CellContext = { row: { original: PatternDiscoveryResult } };

type ComparisonColumn = {
  id: string;
  label: string;
  rows: PatternDiscoveryResult[];
  loading: boolean;
  errored: boolean;
};

function PatternSweepComparison({
  columns,
}: {
  columns: ComparisonColumn[];
}) {
  const activeColumns = columns.filter(
    (column) => column.rows.length > 0 || column.loading || column.errored,
  );
  if (activeColumns.length < 2) return null;

  const familyRows = PATTERN_SETUP_FAMILIES.map((family) => ({
    family,
    summaries: activeColumns.map((column) => ({
      column,
      summary: summarizePatternSetupFamilies(column.rows).find(
        (item) => item.id === family.id,
      ),
    })),
  }));
  const patternKeys = Array.from(
    new Set(
      activeColumns.flatMap((column) => column.rows.map((row) => row.patternKey)),
    ),
  ).sort((a, b) => {
    const familyOrder =
      PATTERN_SETUP_FAMILIES.findIndex(
        (family) => family.id === classifyPatternSetup(a).id,
      ) -
      PATTERN_SETUP_FAMILIES.findIndex(
        (family) => family.id === classifyPatternSetup(b).id,
      );
    return familyOrder || a.localeCompare(b);
  });
  const rowByColumn = new Map(
    activeColumns.map((column) => [
      column.id,
      new Map(column.rows.map((row) => [row.patternKey, row])),
    ]),
  );
  const cellBox: CSSProperties = {
    padding: sp("5px 6px"),
    borderBottom: `1px solid ${CSS_COLOR.border}`,
    minWidth: dim(118),
  };
  const headerCell: CSSProperties = {
    ...cellBox,
    position: "sticky",
    top: 0,
    zIndex: 1,
    background: CSS_COLOR.bg2,
    color: CSS_COLOR.textMuted,
    fontFamily: SANS,
    fontSize: fs(8),
    fontWeight: FONT_WEIGHTS.label,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  };
  const metricLine = (
    left: string,
    value: number | null | undefined,
    decimals = 3,
  ) => (
    <span
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: sp(6),
        fontFamily: MONO,
        fontSize: fs(9),
        color: signedColor(value),
      }}
    >
      <span style={{ color: CSS_COLOR.textDim }}>{left}</span>
      <span>{fmtSignedPct(value, decimals)}</span>
    </span>
  );

  return (
    <div
      style={{
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg0,
        overflow: "hidden",
        marginBottom: sp(10),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          padding: sp("8px 10px"),
          borderBottom: `1px solid ${CSS_COLOR.border}`,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: fs(11),
            color: CSS_COLOR.text,
          }}
        >
          Sweep Comparison
        </div>
        <div style={{ fontFamily: MONO, fontSize: fs(9), color: CSS_COLOR.textDim }}>
          {activeColumns.length} studies | {patternKeys.length} patterns
        </div>
      </div>
      <div style={{ overflowX: "auto", maxHeight: dim(360) }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `minmax(${dim(150)}px, 1.1fr) repeat(${activeColumns.length}, minmax(${dim(118)}px, 0.9fr))`,
            minWidth: dim(150 + activeColumns.length * 118),
          }}
        >
          <div style={headerCell}>Setup / Pattern</div>
          {activeColumns.map((column) => (
            <div key={column.id} style={headerCell} title={column.label}>
              {column.label}
            </div>
          ))}

          {familyRows.map(({ family, summaries }) => (
            <Fragment key={family.id}>
              <div
                style={{
                  ...cellBox,
                  background: cssColorAlpha(familyTone(family.id), "0D"),
                }}
              >
                <FamilyChip familyId={family.id} />
              </div>
              {summaries.map(({ column, summary }) => (
                <div
                  key={`${family.id}-${column.id}`}
                  style={{
                    ...cellBox,
                    background: cssColorAlpha(familyTone(family.id), "0A"),
                  }}
                >
                  {column.loading ? (
                    <span style={{ color: CSS_COLOR.textDim, fontSize: fs(9) }}>
                      Loading
                    </span>
                  ) : column.errored || !summary ? (
                    <span style={{ color: CSS_COLOR.red, fontSize: fs(9) }}>
                      Error
                    </span>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: fs(9),
                          color: CSS_COLOR.textMuted,
                        }}
                      >
                        n {summary.sampleCount} | {summary.patternCount} rows
                      </span>
                      {metricLine("mean", summary.weightedMeanReturnPct)}
                      <span
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: sp(6),
                          fontFamily: MONO,
                          fontSize: fs(9),
                          color: CSS_COLOR.textSec,
                        }}
                      >
                        <span style={{ color: CSS_COLOR.textDim }}>|t|</span>
                        <span>{fmtNum(summary.bestAbsTStat, 2)}</span>
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </Fragment>
          ))}

          {patternKeys.map((patternKey) => (
            <Fragment key={patternKey}>
              <div style={cellBox}>
                <div style={{ display: "flex", flexDirection: "column", gap: sp(3) }}>
                  <PatternVector patternKey={patternKey} bias="neutral" />
                  <FamilyChip familyId={classifyPatternSetup(patternKey).id} compact />
                </div>
              </div>
              {activeColumns.map((column) => {
                const row = rowByColumn.get(column.id)?.get(patternKey);
                return (
                  <div key={`${patternKey}-${column.id}`} style={cellBox}>
                    {column.loading ? (
                      <span style={{ color: CSS_COLOR.textDim, fontSize: fs(9) }}>
                        Loading
                      </span>
                    ) : column.errored ? (
                      <span style={{ color: CSS_COLOR.red, fontSize: fs(9) }}>
                        Error
                      </span>
                    ) : !row ? (
                      <span style={{ color: CSS_COLOR.textDim, fontSize: fs(9) }}>
                        {MISSING_VALUE}
                      </span>
                    ) : (
                      <div
                        style={{ display: "flex", flexDirection: "column", gap: sp(2) }}
                      >
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: fs(9),
                            color: CSS_COLOR.textMuted,
                          }}
                        >
                          n {row.sampleCount} | t {fmtNum(row.tStat, 2)}
                        </span>
                        {metricLine("mean", row.meanReturnPct)}
                        <span
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: sp(6),
                            fontFamily: MONO,
                            fontSize: fs(9),
                            color: CSS_COLOR.textSec,
                          }}
                        >
                          <span style={{ color: CSS_COLOR.textDim }}>win</span>
                          <span>{fmtPct(row.winRatePct, 1)}</span>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function PatternDiscoveryPanel() {
  // --- config form state ---
  const [name, setName] = useState("MTF Pattern Scan");
  const [symbolsRaw, setSymbolsRaw] = useState("SPY,QQQ");
  const [timeframeSet, setTimeframeSet] = useState<string[]>(DEFAULT_TIMEFRAMES);
  const [baseTimeframe, setBaseTimeframe] = useState("1m");
  const [horizonsRaw, setHorizonsRaw] = useState("3,6,12");
  const [startsAt, setStartsAt] = useState(daysAgoISO(30));
  const [endsAt, setEndsAt] = useState(todayISO());
  const [minSampleThreshold, setMinSampleThreshold] = useState(1);

  // --- study lifecycle ---
  const [studyId, setStudyId] = useState<string | null>(null);
  const [comparisonStudyIds, setComparisonStudyIds] = useState<string[]>([]);

  // --- explore controls ---
  const [horizonBars, setHorizonBars] = useState(3);
  const [sort, setSort] = useState<{ id: SortColumnId; direction: "asc" | "desc" }>(
    { id: "tStat", direction: "desc" },
  );
  const [nFloor, setNFloor] = useState(1);
  const [biasFilter, setBiasFilter] = useState<"all" | "long" | "short">("all");
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>("all");
  const [significantOnly, setSignificantOnly] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const createStudy = useCreatePatternDiscoveryStudy();
  const studiesQuery = useListBacktestStudies({
    query: {
      queryKey: getListBacktestStudiesQueryKey(),
      staleTime: 5_000,
      refetchInterval: 15_000,
    },
  });
  const patternStudies = useMemo(
    () =>
      (studiesQuery.data?.studies ?? []).filter(
        (study) => study.strategyId === "mtf_pattern_discovery",
      ),
    [studiesQuery.data?.studies],
  );
  const selectedStudy = useMemo(
    () => patternStudies.find((study) => study.id === studyId) ?? null,
    [patternStudies, studyId],
  );
  const activeSweepId = selectedStudy ? patternStudySweepId(selectedStudy) : null;
  const sweepPeerStudies = useMemo(
    () =>
      activeSweepId
        ? patternStudies.filter(
            (study) =>
              study.id !== studyId && patternStudySweepId(study) === activeSweepId,
          )
        : [],
    [activeSweepId, patternStudies, studyId],
  );

  const resultsQuery = useGetPatternDiscoveryResults(
    studyId ?? "",
    { horizonBars },
    {
      query: {
        queryKey: getGetPatternDiscoveryResultsQueryKey(studyId ?? "", {
          horizonBars,
        }),
        enabled: Boolean(studyId),
        refetchInterval: (query) => {
          const status = (query.state.data as PatternDiscoveryResults | undefined)
            ?.status;
          return status && status !== "completed" && status !== "failed"
            ? 5000
            : false;
        },
      },
    },
  );

  const resultsData: PatternDiscoveryResults | undefined = resultsQuery.data;
  const status = resultsData?.status ?? null;
  const progressPercent = resultsData?.progressPercent ?? 0;
  const allResults = useMemo(
    () => resultsData?.results ?? [],
    [resultsData],
  );
  const resultTimeframeSet = useMemo(
    () => resolveResultTimeframeSet(resultsData, timeframeSet),
    [resultsData, timeframeSet],
  );
  const possiblePatternCount = useMemo(
    () => totalPossiblePatternCombinations(resultTimeframeSet),
    [resultTimeframeSet],
  );
  const familySummaries = useMemo(
    () => summarizePatternSetupFamilies(allResults),
    [allResults],
  );
  const comparisonQueries = useQueries({
    queries: comparisonStudyIds.map((id) => ({
      queryKey: getGetPatternDiscoveryResultsQueryKey(id, { horizonBars }),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        getPatternDiscoveryResults(id, { horizonBars }, { signal }),
      enabled: Boolean(id),
      staleTime: 5_000,
    })),
  });
  const comparisonColumns = useMemo<ComparisonColumn[]>(() => {
    const active: ComparisonColumn[] =
      selectedStudy && resultsData
        ? [
            {
              id: selectedStudy.id,
              label: formatPatternStudyComparisonLabel(selectedStudy),
              rows: allResults,
              loading: resultsQuery.isLoading,
              errored: resultsQuery.isError,
            },
          ]
        : [];
    const compared = comparisonStudyIds.map((id, index) => {
      const study = patternStudies.find((item) => item.id === id);
      const query = comparisonQueries[index];
      return {
        id,
        label: study ? formatPatternStudyComparisonLabel(study) : id,
        rows: (query?.data as PatternDiscoveryResults | undefined)?.results ?? [],
        loading: Boolean(query?.isLoading),
        errored: Boolean(query?.isError),
      };
    });
    return [...active, ...compared];
  }, [
    allResults,
    comparisonQueries,
    comparisonStudyIds,
    patternStudies,
    resultsData,
    resultsQuery.isError,
    resultsQuery.isLoading,
    selectedStudy,
  ]);

  const horizonChoices = useMemo(() => parseHorizons(horizonsRaw), [horizonsRaw]);

  const handleRun = () => {
    const symbols = parseSymbols(symbolsRaw);
    const forwardHorizonsBars = parseHorizons(horizonsRaw);
    if (symbols.length === 0 || timeframeSet.length === 0) return;
    const input: PatternDiscoveryStudyInput = {
      name: name.trim() || "Pattern Scan",
      symbols,
      timeframeSet,
      baseTimeframe,
      forwardHorizonsBars,
      minSampleThreshold,
      startsAt: new Date(`${startsAt}T00:00:00Z`).toISOString(),
      endsAt: new Date(`${endsAt}T23:59:59Z`).toISOString(),
      persistOccurrences: true,
    };
    createStudy.mutate(
      { data: input },
      {
        onSuccess: (created) => {
          setStudyId(created.studyId);
          setComparisonStudyIds([]);
          setNFloor(minSampleThreshold);
          setFamilyFilter("all");
          setExpandedKey(null);
          void studiesQuery.refetch();
          if (forwardHorizonsBars.length > 0) {
            setHorizonBars(forwardHorizonsBars[0]);
          }
        },
      },
    );
  };

  // --- derived: filtered + sorted leaderboard rows ---
  const qualifyingCount = useMemo(
    () => allResults.filter((row) => row.sampleCount >= minSampleThreshold).length,
    [allResults, minSampleThreshold],
  );

  const visibleRows = useMemo(() => {
    const filtered = allResults.filter((row) => {
      if (row.sampleCount < nFloor) return false;
      if (biasFilter !== "all" && row.bias !== biasFilter) return false;
      if (
        familyFilter !== "all" &&
        classifyPatternSetup(row.patternKey).id !== familyFilter
      ) {
        return false;
      }
      if (significantOnly && !(isNum(row.tStat) && Math.abs(row.tStat) >= 1.5)) {
        return false;
      }
      return true;
    });
    const dir = sort.direction === "asc" ? 1 : -1;
    const value = (row: PatternDiscoveryResult): number => {
      if (sort.id === "rank") return isNum(row.rank) ? row.rank : Number.MAX_SAFE_INTEGER;
      if (sort.id === "tStat") return isNum(row.tStat) ? Math.abs(row.tStat) : -Infinity;
      const raw = row[sort.id];
      return isNum(raw) ? raw : -Infinity;
    };
    return [...filtered].sort((a, b) => (value(a) - value(b)) * dir);
  }, [allResults, nFloor, biasFilter, familyFilter, significantOnly, sort]);

  const allLowN = allResults.length > 0 && qualifyingCount === 0;

  const columns = useMemo<LeaderboardColumn[]>(
    () => [
      {
        id: "rank",
        header: "#",
        meta: { width: dim(38) + "px", align: "right", sortable: true, sortKey: "rank", label: "#" },
        cell: (row) => (
          <span style={{ fontFamily: MONO, fontSize: fs(10), color: CSS_COLOR.textMuted }}>
            {isNum(row.rank) ? row.rank : MISSING_VALUE}
          </span>
        ),
      },
      {
        id: "pattern",
        header: "Pattern",
        meta: { width: "minmax(132px, 1.2fr)", align: "left", label: "Pattern" },
        cell: (row) => (
          <PatternVector patternKey={row.patternKey} bias={row.bias} />
        ),
      },
      {
        id: "family",
        header: "Family",
        meta: { width: "minmax(104px, 0.9fr)", align: "left", label: "Family" },
        cell: (row) => <FamilyChip familyId={classifyPatternSetup(row.patternKey).id} compact />,
      },
      {
        id: "bias",
        header: "Bias",
        meta: { width: dim(70) + "px", align: "left", label: "Bias" },
        cell: (row) => <BiasChip bias={row.bias} />,
      },
      {
        id: "edge",
        header: "Edge",
        meta: { width: dim(76) + "px", align: "left", label: "Edge" },
        cell: (row) => <EdgeChip result={row} />,
      },
      {
        id: "sampleCount",
        header: "n",
        meta: { width: dim(58) + "px", align: "right", sortable: true, sortKey: "sampleCount", label: "n" },
        cell: (row) => {
          const low = row.sampleCount < minSampleThreshold;
          return (
            <span
              style={{
                fontFamily: MONO,
                fontSize: fs(10),
                color: low ? CSS_COLOR.amber : CSS_COLOR.text,
                opacity: low ? 0.55 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: sp(2),
              }}
            >
              {low ? <AlertTriangle size={dim(11)} strokeWidth={2} /> : null}
              {row.sampleCount}
            </span>
          );
        },
      },
      {
        id: "winRatePct",
        header: "Win%",
        meta: { width: "minmax(78px, 0.9fr)", align: "left", sortable: true, sortKey: "winRatePct", label: "Win%" },
        cell: (row) => <WinRateBar pct={row.winRatePct} />,
      },
      {
        id: "meanReturnPct",
        header: "Mean%",
        meta: { width: dim(72) + "px", align: "right", sortable: true, sortKey: "meanReturnPct", label: "Mean%" },
        cell: (row) => (
          <span
            style={{ fontFamily: MONO, fontSize: fs(10), color: signedColor(row.meanReturnPct) }}
          >
            {fmtSignedPct(row.meanReturnPct, 3)}
          </span>
        ),
      },
      {
        id: "tStat",
        header: "t-stat",
        meta: { width: dim(64) + "px", align: "right", sortable: true, sortKey: "tStat", label: "t-stat" },
        cell: (row) => (
          <span style={{ fontFamily: MONO, fontSize: fs(10), ...tStatStyle(row.tStat) }}>
            {fmtNum(row.tStat, 2)}
          </span>
        ),
      },
      {
        id: "avgMaePct",
        header: "MAE%",
        meta: { width: dim(64) + "px", align: "right", sortable: true, sortKey: "avgMaePct", label: "MAE%" },
        cell: (row) => (
          <span style={{ fontFamily: MONO, fontSize: fs(10), color: CSS_COLOR.red }}>
            {fmtSignedPct(row.avgMaePct, 3)}
          </span>
        ),
      },
      {
        id: "avgMfePct",
        header: "MFE%",
        meta: { width: dim(64) + "px", align: "right", sortable: true, sortKey: "avgMfePct", label: "MFE%" },
        cell: (row) => (
          <span style={{ fontFamily: MONO, fontSize: fs(10), color: CSS_COLOR.blue }}>
            {fmtSignedPct(row.avgMfePct, 3)}
          </span>
        ),
      },
      {
        id: "expand",
        header: "",
        meta: { width: dim(30) + "px", align: "center", label: "" },
        cell: (row) => {
          const open = expandedKey === row.id;
          const Icon = open ? ChevronDown : ChevronRight;
          return (
            <Icon
              size={dim(14)}
              strokeWidth={2}
              color={CSS_COLOR.textMuted}
              aria-hidden="true"
            />
          );
        },
      },
    ],
    [minSampleThreshold, expandedKey],
  );

  // Adapt our `(row) => ReactNode` cell fns into the TanStack cell signature
  // that DenseVirtualTable expects (`cell.getContext()` -> `{ row.original }`).
  const tableColumns = useMemo(
    () =>
      columns.map((column) => ({
        id: column.id,
        header: column.header,
        meta: column.meta,
        cell: (ctx: CellContext) => column.cell(ctx.row.original),
      })),
    [columns],
  );

  const handleSortChange = (sortKey: string) => {
    setSort((prev) => {
      const nextId = sortKey as SortColumnId;
      if (prev.id === nextId) {
        return { id: nextId, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { id: nextId, direction: "desc" };
    });
  };

  const isExploring = status === "completed" || allResults.length > 0;
  const isRunningState = status != null && RUNNING_STATUSES.has(status);
  const isFailed = status === "failed" || status === "canceled";

  const handleLoadStudy = (nextStudyId: string) => {
    setStudyId(nextStudyId || null);
    setFamilyFilter("all");
    setExpandedKey(null);
    const study = patternStudies.find((item) => item.id === nextStudyId);
    setComparisonStudyIds(defaultComparisonStudyIds(study, patternStudies));
    if (!study) return;
    applyPatternStudyDefaults(study, {
      setName,
      setSymbolsRaw,
      setTimeframeSet,
      setBaseTimeframe,
      setHorizonsRaw,
      setHorizonBars,
      setStartsAt,
      setEndsAt,
      setMinSampleThreshold,
      setNFloor,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sp(12) }}>
      {/* ---------------- 1. Config ---------------- */}
      <SectionCard
        title="Discovery Setup"
        right={
          createStudy.isPending ? <StatusBadge status="queued" /> : undefined
        }
      >
        <div style={{ marginBottom: sp(10) }}>
          <Field label="Saved pattern study">
            <Select
              value={studyId ?? ""}
              onChange={(next: string) => handleLoadStudy(next)}
              options={[
                {
                  value: "",
                  label:
                    patternStudies.length > 0
                      ? "New discovery study"
                      : "No saved pattern studies",
                },
                ...patternStudies.map((study) => ({
                  value: study.id,
                  label: formatPatternStudyOption(study),
                })),
              ]}
              style={{ width: "100%" }}
            />
          </Field>
          {activeSweepId && sweepPeerStudies.length > 0 ? (
            <div style={{ marginTop: sp(10) }}>
              <Field label="Compare sweep studies">
                <select
                  multiple
                  value={comparisonStudyIds}
                  onChange={(event) =>
                    setComparisonStudyIds(
                      Array.from(event.currentTarget.selectedOptions).map(
                        (option) => option.value,
                      ),
                    )
                  }
                  style={{ ...inputStyle, minHeight: dim(92) }}
                >
                  {sweepPeerStudies.map((study) => (
                    <option key={study.id} value={study.id}>
                      {formatPatternStudyComparisonLabel(study)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: sp(10),
          }}
        >
          <Field label="Study name">
            <TextField
              value={name}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
              style={{ width: "100%" }}
            />
          </Field>
          <Field label="Symbols">
            <TextField
              value={symbolsRaw}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSymbolsRaw(event.target.value)}
              placeholder="SPY,QQQ"
              style={{ width: "100%" }}
            />
          </Field>
          <Field label="Base timeframe">
            <Select
              value={baseTimeframe}
              onChange={(next: string) => setBaseTimeframe(next)}
              options={TIMEFRAME_CHOICES.map((tf) => ({ value: tf, label: tf }))}
              style={{ width: "100%" }}
            />
          </Field>
          <Field label="Forward horizons (bars)">
            <TextField
              value={horizonsRaw}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setHorizonsRaw(event.target.value)}
              placeholder="3,6,12"
              style={{ width: "100%" }}
            />
          </Field>
          <Field label="Start">
            <TextField
              type="date"
              value={startsAt}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setStartsAt(event.target.value)}
              style={{ width: "100%" }}
            />
          </Field>
          <Field label="End">
            <TextField
              type="date"
              value={endsAt}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setEndsAt(event.target.value)}
              style={{ width: "100%" }}
            />
          </Field>
          <Field label="Min sample threshold">
            <TextField
              type="number"
              value={minSampleThreshold}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setMinSampleThreshold(Math.max(1, Number(event.target.value) || 1))
              }
              inputProps={{ min: 1 }}
              style={{ width: "100%" }}
            />
          </Field>
        </div>

        <div style={{ marginTop: sp(10) }}>
          <div style={fieldLabelStyle}>Timeframe set</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
            {TIMEFRAME_CHOICES.map((tf) => {
              const active = timeframeSet.includes(tf);
              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() =>
                    setTimeframeSet((prev) =>
                      prev.includes(tf)
                        ? prev.filter((value) => value !== tf)
                        : [...prev, tf],
                    )
                  }
                  style={{
                    ...chipStyle(active),
                  }}
                >
                  {tf}
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(10),
            marginTop: sp(12),
          }}
        >
          <button
            type="button"
            onClick={handleRun}
            disabled={createStudy.isPending}
            style={{
              ...buttonStyle("primary"),
              opacity: createStudy.isPending ? 0.6 : 1,
              cursor: createStudy.isPending ? "wait" : "pointer",
            }}
          >
            {createStudy.isPending ? "Submitting..." : "Run Discovery"}
          </button>
          {createStudy.isError ? (
            <span style={{ color: CSS_COLOR.red, fontSize: fs(10), fontFamily: SANS }}>
              Failed to start discovery study.
            </span>
          ) : null}
        </div>
      </SectionCard>

      {/* ---------------- 2. Run state ---------------- */}
      {studyId && (isRunningState || isFailed) ? (
        <SectionCard
          title="Discovery Run"
          right={status ? <StatusBadge status={status} /> : undefined}
        >
          {isFailed ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(8),
                color: CSS_COLOR.red,
                fontSize: fs(11),
                fontFamily: SANS,
              }}
            >
              <AlertTriangle size={dim(16)} strokeWidth={2} />
              Discovery {status} before producing results.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: sp(8) }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: fs(10),
                  fontFamily: SANS,
                  color: CSS_COLOR.textSec,
                }}
              >
                <span>Scanning...</span>
                <span style={{ fontFamily: MONO, color: CSS_COLOR.textMuted }}>
                  {Math.round(progressPercent)}%
                </span>
              </div>
              <div
                style={{
                  height: dim(4),
                  borderRadius: dim(RADII.pill),
                  background: cssColorMix(CSS_COLOR.border, 60),
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(2, Math.min(100, progressPercent))}%`,
                    background: CSS_COLOR.accent,
                    borderRadius: dim(RADII.pill),
                    transition: "width var(--ra-motion-medium) ease-out",
                  }}
                />
              </div>
            </div>
          )}
        </SectionCard>
      ) : null}

      {/* ---------------- 3 + 4. Explore ---------------- */}
      {!studyId ? (
        <EmptyState
          title="Configure a discovery run..."
          detail="Set symbols, timeframe set, and a date range above, then Run Discovery to scan for recurring MTF patterns."
        />
      ) : isExploring ? (
        <SectionCard
          title="Pattern Leaderboard"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: sp(6) }}>
              {horizonChoices.map((horizon) => {
                const active = horizon === horizonBars;
                return (
                  <button
                    key={horizon}
                    type="button"
                    onClick={() => {
                      setHorizonBars(horizon);
                      setExpandedKey(null);
                    }}
                    style={chipStyle(active)}
                  >
                    {horizon}
                  </button>
                );
              })}
            </div>
          }
        >
          <PatternSetupAtlasStrip
            summaries={familySummaries}
            activeFamily={familyFilter}
            onFamilyChange={(nextFamily) => {
              setFamilyFilter(nextFamily);
              setExpandedKey(null);
            }}
            observedCount={allResults.length}
            possibleCount={possiblePatternCount}
            visibleCount={visibleRows.length}
          />
          <PatternSweepComparison columns={comparisonColumns} />

          {/* Filters strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              flexWrap: "wrap",
              gap: sp(12),
              marginBottom: sp(8),
            }}
          >
            <label style={filterLabel}>
              n &gt;=
              <TextField
                type="number"
                value={nFloor}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setNFloor(Math.max(0, Number(event.target.value) || 0))}
                inputProps={{ min: 0 }}
                style={{ width: dim(56) }}
              />
            </label>
            <label style={filterLabel}>
              bias
              <Select
                value={biasFilter}
                onChange={(next: string) =>
                  setBiasFilter(next as "all" | "long" | "short")
                }
                options={[
                  { value: "all", label: "all" },
                  { value: "long", label: "long" },
                  { value: "short", label: "short" },
                ]}
                style={{ width: dim(78) }}
              />
            </label>
            <label style={{ ...filterLabel, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={significantOnly}
                onChange={(event) => setSignificantOnly(event.target.checked)}
              />
              significant only
            </label>
          </div>

          {allResults.length === 0 ? (
            <DataUnavailableState
              title="No patterns yet"
              detail="No patterns returned for this study yet."
            />
          ) : qualifyingCount === 0 ? (
            <>
              {allLowN ? (
                <CautionBanner detail="Every pattern is below the sample threshold; results shown are dimmed and statistically thin." />
              ) : null}
              <DataUnavailableState
                title="Below sample threshold"
                detail={`No patterns met the threshold (n >= ${minSampleThreshold}). Lower the threshold or widen the date range.`}
              />
            </>
          ) : visibleRows.length === 0 ? (
            <DataUnavailableState
              title="No matches"
              detail="No patterns match the current filters."
            />
          ) : (
            <>
              {allLowN ? (
                <CautionBanner detail="All qualifying patterns are statistically thin; interpret with caution." />
              ) : null}
              <DenseVirtualTableHost
                columns={tableColumns}
                data={visibleRows}
                sort={sort}
                onSortChange={handleSortChange}
                expandedKey={expandedKey}
                onToggleRow={(row) =>
                  setExpandedKey((prev) => (prev === row.id ? null : row.id))
                }
                renderDetail={(row) => (
                  <PatternDetail
                    studyId={studyId}
                    result={row}
                    horizonBars={horizonBars}
                  />
                )}
              />
            </>
          )}
        </SectionCard>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DenseVirtualTable host keeps the table props in one place. The component is
// a `.jsx` module (typed as `any`), mirroring SignalsScreen's usage.
// ---------------------------------------------------------------------------

function DenseVirtualTableHost({
  columns,
  data,
  sort,
  onSortChange,
  expandedKey,
  onToggleRow,
  renderDetail,
}: {
  columns: unknown[];
  data: PatternDiscoveryResult[];
  sort: { id: SortColumnId; direction: "asc" | "desc" };
  onSortChange: (sortKey: string) => void;
  expandedKey: string | null;
  onToggleRow: (row: PatternDiscoveryResult) => void;
  renderDetail: (row: PatternDiscoveryResult) => ReactNode;
}) {
  return (
    <div style={{ height: dim(440), minWidth: 0 }}>
      <DenseVirtualTable
        columns={columns}
        data={data}
        getRowId={(row: PatternDiscoveryResult) => row.id}
        rowHeight={dim(36)}
        rowDetailHeight={dim(560)}
        sortState={{ id: sort.id, direction: sort.direction }}
        onSortChange={onSortChange}
        isRowExpanded={(row: PatternDiscoveryResult) => row.id === expandedKey}
        renderRowDetail={(row: PatternDiscoveryResult) => renderDetail(row)}
        rowTestId="pattern-discovery-row"
        rowDetailTestId="pattern-discovery-row-detail"
        headerStyle={{
          alignItems: "center",
          minHeight: dim(30),
          padding: sp("0 4px"),
          columnGap: sp(2),
          borderBottom: `1px solid ${CSS_COLOR.border}`,
          background: CSS_COLOR.bg2,
          color: CSS_COLOR.textMuted,
          fontSize: fs(9),
          fontWeight: FONT_WEIGHTS.label,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
        getRowProps={(row: PatternDiscoveryResult) => {
          // Low-n dimming lives on the `n` cell (0.55 opacity) per the spec,
          // not the whole row; keep the row at full opacity here.
          const expanded = row.id === expandedKey;
          return {
            role: "button",
            tabIndex: 0,
            onClick: () => onToggleRow(row),
            "aria-expanded": expanded ? "true" : "false",
            style: {
              alignItems: "center",
              columnGap: sp(2),
              padding: sp("0 4px"),
              cursor: "pointer",
              borderBottom: `1px solid ${
                expanded ? cssColorMix(CSS_COLOR.accent, 42) : CSS_COLOR.border
              }`,
              background: expanded ? cssColorMix(CSS_COLOR.accent, 10) : "transparent",
              transition:
                "background-color var(--ra-motion-fast) ease-out, border-color var(--ra-motion-fast) ease-out",
            },
          };
        }}
        getCellProps={() => ({
          style: { padding: sp("0 4px"), fontSize: fs(10) },
        })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const filterLabel: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: sp(4),
  fontFamily: SANS,
  fontSize: fs(9),
  color: CSS_COLOR.textMuted,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

function chipStyle(active: boolean): CSSProperties {
  return {
    padding: sp("3px 9px"),
    borderRadius: dim(RADII.pill),
    border: `1px solid ${active ? cssColorAlpha(CSS_COLOR.accent, "66") : CSS_COLOR.border}`,
    background: active ? cssColorAlpha(CSS_COLOR.accent, "1F") : CSS_COLOR.bg0,
    color: active ? CSS_COLOR.accent : CSS_COLOR.textSec,
    fontFamily: SANS,
    fontSize: fs(9),
    fontWeight: active ? FONT_WEIGHTS.label : FONT_WEIGHTS.regular,
    cursor: "pointer",
    transition: "background-color var(--ra-motion-fast) ease-out, color var(--ra-motion-fast) ease-out",
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={fieldLabelStyle}>{label}</div>
      {children}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        border: `1px dashed ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.md),
        background: CSS_COLOR.bg0,
        padding: sp("28px 20px"),
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: fs(12),
          fontFamily: DISPLAY,
          color: CSS_COLOR.text,
          marginBottom: sp(6),
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: fs(10),
          fontFamily: SANS,
          color: CSS_COLOR.textDim,
          maxWidth: dim(420),
          margin: "0 auto",
          lineHeight: 1.5,
        }}
      >
        {detail}
      </div>
    </div>
  );
}

function CautionBanner({ detail }: { detail: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(8),
        border: `1px solid ${cssColorAlpha(CSS_COLOR.amber, "44")}`,
        background: cssColorAlpha(CSS_COLOR.amber, "14"),
        borderRadius: dim(RADII.sm),
        padding: sp("8px 10px"),
        marginBottom: sp(8),
        color: CSS_COLOR.amber,
        fontSize: fs(10),
        fontFamily: SANS,
      }}
    >
      <AlertTriangle size={dim(14)} strokeWidth={2} />
      {detail}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parsing helpers (declared after use; function declarations hoist)
// ---------------------------------------------------------------------------

function resolveResultTimeframeSet(
  resultsData: PatternDiscoveryResults | undefined,
  fallback: string[],
): string[] {
  const parameters = resultsData?.parameters as Record<string, unknown> | undefined;
  const raw = parameters?.timeframeSet;
  if (!Array.isArray(raw)) return fallback;
  const parsed = raw.filter((value): value is string => typeof value === "string");
  return parsed.length > 0 ? parsed : fallback;
}

function dateInputFromIso(value: string): string {
  return value.slice(0, 10);
}

function patternStudyParameters(study: BacktestStudyRecord): Record<string, unknown> {
  return study.parameters as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function formatPatternStudyOption(study: BacktestStudyRecord): string {
  const parameters = patternStudyParameters(study);
  const frames = stringArray(parameters.timeframeSet);
  const horizons = numberArray(parameters.forwardHorizonsBars);
  const symbolPreview = study.symbols.slice(0, 3).join(",");
  const symbolSuffix = study.symbols.length > 3 ? `+${study.symbols.length - 3}` : "";
  return `${study.name} | ${symbolPreview}${symbolSuffix} | ${frames.join("/")} | h ${horizons.join("/")}`;
}

function patternStudySweepId(study: BacktestStudyRecord): string | null {
  const sweep = patternStudyParameters(study).sweep;
  return typeof sweep === "string" && sweep.length > 0 ? sweep : null;
}

function formatPatternStudyComparisonLabel(study: BacktestStudyRecord): string {
  const parameters = patternStudyParameters(study);
  const variantLabel =
    typeof parameters.variantLabel === "string" && parameters.variantLabel.length > 0
      ? parameters.variantLabel
      : study.name;
  const sweepKind =
    typeof parameters.sweepKind === "string" && parameters.sweepKind.length > 0
      ? parameters.sweepKind
      : typeof parameters.sweep === "string"
        ? parameters.sweep
        : "study";
  return `${variantLabel} | ${sweepKind}`;
}

function defaultComparisonStudyIds(
  study: BacktestStudyRecord | undefined,
  studies: BacktestStudyRecord[],
): string[] {
  if (!study) return [];
  const sweep = patternStudySweepId(study);
  if (!sweep) return [];
  return studies
    .filter((item) => item.id !== study.id && patternStudySweepId(item) === sweep)
    .slice(0, 4)
    .map((item) => item.id);
}

function applyPatternStudyDefaults(
  study: BacktestStudyRecord,
  setters: {
    setName: (value: string) => void;
    setSymbolsRaw: (value: string) => void;
    setTimeframeSet: (value: string[]) => void;
    setBaseTimeframe: (value: string) => void;
    setHorizonsRaw: (value: string) => void;
    setHorizonBars: (value: number) => void;
    setStartsAt: (value: string) => void;
    setEndsAt: (value: string) => void;
    setMinSampleThreshold: (value: number) => void;
    setNFloor: (value: number) => void;
  },
): void {
  const parameters = patternStudyParameters(study);
  const frames = stringArray(parameters.timeframeSet);
  const horizons = numberArray(parameters.forwardHorizonsBars);
  const minSampleThreshold =
    typeof parameters.minSampleThreshold === "number" &&
    Number.isFinite(parameters.minSampleThreshold)
      ? Math.max(1, Math.floor(parameters.minSampleThreshold))
      : 1;
  setters.setName(study.name);
  setters.setSymbolsRaw(study.symbols.join(","));
  if (frames.length > 0) {
    setters.setTimeframeSet(frames);
  }
  setters.setBaseTimeframe(
    typeof parameters.baseTimeframe === "string"
      ? parameters.baseTimeframe
      : study.timeframe,
  );
  if (horizons.length > 0) {
    setters.setHorizonsRaw(horizons.join(","));
    setters.setHorizonBars(horizons[0]);
  }
  setters.setStartsAt(dateInputFromIso(study.startsAt));
  setters.setEndsAt(dateInputFromIso(study.endsAt));
  setters.setMinSampleThreshold(minSampleThreshold);
  setters.setNFloor(minSampleThreshold);
}

function parseHorizons(raw: string): number[] {
  const parsed = raw
    .split(/[\s,]+/)
    .map((token) => Number.parseInt(token.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  return parsed.length > 0 ? Array.from(new Set(parsed)) : [3, 6, 12];
}

export default PatternDiscoveryPanel;
