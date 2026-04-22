import { useMemo, useRef, useState } from "react";

const T = {
  text: "#0f172a",
  muted: "#64748b",
  border: "#d6e0ea",
  grid: "#e2e8f0",
  accent: "#3b82f6",
  green: "#16a34a",
  red: "#dc2626",
  amber: "#f59e0b",
};

const DEFAULT_STACK_COLORS = [
  "#0284c7",
  "#0ea5e9",
  "#38bdf8",
  "#2563eb",
  "#0891b2",
  "#1d4ed8",
];

export default function MetricFlowEquityChart({
  series = [],
  benchmarkSeries = [],
  markers = [],
  stackedSeries = [],
  aggregation = "raw",
  onAggregationChange,
  showHeader = true,
  height = 220,
  compact = false,
  emptyMessage = "No equity history available yet.",
  title = "Equity Curve",
  subtitle = "Live account equity",
  gradientId = "metric-flow-equity-area",
}) {
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const width = 860;
  const safeHeight = Math.max(120, Number(height) || 220);
  const pad = compact
    ? { l: 46, r: 18, t: 14, b: 24 }
    : { l: 56, r: 20, t: 18, b: 34 };

  const primaryRaw = useMemo(
    () => normalizeSeries(series),
    [series],
  );
  const benchmarkRaw = useMemo(
    () => normalizeSeries(benchmarkSeries),
    [benchmarkSeries],
  );
  const aggregationMode = normalizeAggregationMode(aggregation);
  const primary = useMemo(
    () => annotateDisplayLabels(aggregateNormalizedSeries(primaryRaw, aggregationMode), aggregationMode),
    [aggregationMode, primaryRaw],
  );
  const benchmark = useMemo(
    () => annotateDisplayLabels(aggregateNormalizedSeries(benchmarkRaw, aggregationMode), aggregationMode),
    [aggregationMode, benchmarkRaw],
  );
  const aggregatedStackedSeries = useMemo(
    () => aggregateStackedSeries(stackedSeries, aggregationMode),
    [aggregationMode, stackedSeries],
  );
  const xDomain = useMemo(
    () => computeXDomain(primary, benchmark, aggregatedStackedSeries),
    [aggregatedStackedSeries, benchmark, primary],
  );
  const bounds = useMemo(
    () => computeBounds(primary, benchmark),
    [primary, benchmark],
  );
  const ticks = useMemo(
    () => buildYAxisTicks(bounds.min, bounds.max, compact ? 4 : 5),
    [bounds.max, bounds.min, compact],
  );
  const xLabels = useMemo(
    () => buildXAxisLabels(primary, compact ? 4 : 6),
    [primary, compact],
  );
  const linePath = useMemo(
    () => buildSmoothPath(primary, width, safeHeight, pad, bounds.min, bounds.max, xDomain),
    [bounds.max, bounds.min, pad, primary, safeHeight, xDomain],
  );
  const areaPath = useMemo(
    () => buildAreaPath(primary, width, safeHeight, pad, bounds.min, bounds.max, xDomain),
    [bounds.max, bounds.min, pad, primary, safeHeight, xDomain],
  );
  const benchmarkPath = useMemo(
    () => buildSmoothPath(benchmark, width, safeHeight, pad, bounds.min, bounds.max, xDomain),
    [benchmark, bounds.max, bounds.min, pad, safeHeight, xDomain],
  );
  const stackedAreas = useMemo(
    () => buildStackedAreaPaths(aggregatedStackedSeries, width, safeHeight, pad, bounds.min, bounds.max, xDomain),
    [aggregatedStackedSeries, bounds.max, bounds.min, pad, safeHeight, xDomain],
  );
  const markerPoints = useMemo(
    () => buildMarkerPoints(markers, primary, width, safeHeight, pad, bounds.min, bounds.max, xDomain),
    [bounds.max, bounds.min, markers, pad, primary, safeHeight, xDomain],
  );

  const startValue = Number(primary[0]?.value);
  const endValue = Number(primary[primary.length - 1]?.value);
  const delta = Number.isFinite(startValue) && Number.isFinite(endValue) ? endValue - startValue : NaN;
  const deltaPct = Number.isFinite(startValue) && startValue !== 0 && Number.isFinite(endValue)
    ? ((endValue - startValue) / Math.abs(startValue)) * 100
    : NaN;
  const deltaTone = Number.isFinite(delta) ? (delta >= 0 ? T.green : T.red) : T.muted;
  const totalCents = Number.isFinite(endValue) ? Math.abs(endValue).toFixed(2).split(".")[1] : "00";
  const baseText = Number.isFinite(endValue)
    ? `${endValue < 0 ? "-" : ""}$${Math.floor(Math.abs(endValue)).toLocaleString()}`
    : "--";

  const handleMouseMove = (event) => {
    if (!svgRef.current || primary.length === 0) {
      return;
    }
    const rect = svgRef.current.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const scaledX = (cursorX / Math.max(rect.width, 1)) * width;
    let nearest = null;
    let nearestDist = Infinity;
    for (let index = 0; index < primary.length; index += 1) {
      const point = primary[index];
      const x = toChartX(index, primary.length, width, pad, point?.epochMs, xDomain);
      const dist = Math.abs(x - scaledX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = { index, point, x };
      }
    }
    if (!nearest || nearestDist > 64) {
      setTooltip(null);
      return;
    }
    const y = toChartY(nearest.point.value, safeHeight, pad, bounds.min, bounds.max);
    setTooltip({
      index: nearest.index,
      x: nearest.x,
      y,
      value: nearest.point.value,
      label: nearest.point.tooltipLabel || nearest.point.label,
    });
  };

  return (
    <div style={{ display: "grid", gap: compact ? 6 : 8, fontFamily: "Inter, system-ui, sans-serif" }}>
      {showHeader && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
          <div>
            <div style={{ fontSize: compact ? 11 : 13, color: "#94a3b8", fontWeight: 500, marginBottom: 2 }}>{title}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: compact ? 26 : 36, fontWeight: 700, color: T.text, letterSpacing: "-0.03em" }}>
                {baseText}
                <span style={{ fontSize: compact ? 16 : 24, color: "#94a3b8", fontWeight: 400 }}>.{totalCents}</span>
              </span>
              <span
                style={{
                  borderRadius: 999,
                  padding: "3px 9px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: deltaTone,
                  background: delta >= 0 ? "#dcfce7" : "#fee2e2",
                }}
              >
                {Number.isFinite(deltaPct) ? `${deltaPct >= 0 ? "▲" : "▼"} ${Math.abs(deltaPct).toFixed(2)}%` : "--"}
              </span>
            </div>
            <div style={{ fontSize: compact ? 10 : 12, color: T.muted }}>
              {Number.isFinite(delta) ? `${delta >= 0 ? "+" : ""}${money(delta)} ${delta >= 0 ? "Increased" : "Decreased"}` : subtitle}
            </div>
          </div>
          {typeof onAggregationChange === "function" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                value={aggregationMode}
                onChange={(event) => onAggregationChange?.(event.target.value)}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "7px 12px",
                  background: "#fff",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#334155",
                  fontFamily: "inherit",
                }}
              >
                <option value="raw">Raw</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          )}
        </div>
      )}

      {primary.length === 0 ? (
        <div style={{ border: `1px dashed ${T.border}`, borderRadius: 8, padding: compact ? "8px 10px" : "12px 12px", fontSize: 12, color: T.muted }}>
          {emptyMessage}
        </div>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${safeHeight}`}
          style={{ width: "100%", height: safeHeight, display: "block", background: "#ffffff", borderRadius: 10, cursor: "crosshair" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={T.accent} stopOpacity="0.20" />
              <stop offset="100%" stopColor={T.accent} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {ticks.map((tick) => {
            const y = toChartY(tick, safeHeight, pad, bounds.min, bounds.max);
            return (
              <g key={`tick-${tick}`}>
                <line
                  x1={pad.l}
                  x2={width - pad.r}
                  y1={y}
                  y2={y}
                  stroke={T.grid}
                  strokeWidth="1"
                />
                <text
                  x={pad.l - 8}
                  y={y + 4}
                  textAnchor="end"
                  style={{ fontSize: 11, fill: "#94a3b8", fontFamily: "inherit" }}
                >
                  {formatAxisCurrency(tick)}
                </text>
              </g>
            );
          })}

          {stackedAreas.map((area) => (
            <path key={area.accountId} d={area.path} fill={area.color} opacity="0.14" />
          ))}
          <path d={areaPath} fill={`url(#${gradientId})`} />
          {benchmarkPath && (
            <path d={benchmarkPath} fill="none" stroke={T.amber} strokeWidth="1.8" strokeDasharray="5 4" />
          )}
          <path d={linePath} fill="none" stroke={T.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

          {xLabels.map((row) => (
            <text
              key={`xlabel-${row.index}`}
              x={toChartX(row.index, primary.length, width, pad, row.epochMs, xDomain)}
              y={safeHeight - 7}
              textAnchor="middle"
                  style={{ fontSize: 11, fill: "#94a3b8", fontFamily: "inherit" }}
                >
                  {row.label}
                </text>
          ))}

          {markerPoints.map((marker) => (
            marker.kind === "entry" ? (
              <path
                key={marker.id}
                d={`M ${marker.x.toFixed(2)} ${(marker.y - 5).toFixed(2)} L ${(marker.x - 4).toFixed(2)} ${(marker.y + 3).toFixed(2)} L ${(marker.x + 4).toFixed(2)} ${(marker.y + 3).toFixed(2)} Z`}
                fill={marker.fill}
                stroke={marker.stroke}
                strokeWidth="1"
              >
                <title>{marker.tooltip}</title>
              </path>
            ) : (
              <circle
                key={marker.id}
                cx={marker.x}
                cy={marker.y}
                r={3.6}
                fill={marker.fill}
                stroke={marker.stroke}
                strokeWidth="1"
              >
                <title>{marker.tooltip}</title>
              </circle>
            )
          ))}

          {tooltip && (
            <g>
              <line
                x1={tooltip.x}
                x2={tooltip.x}
                y1={pad.t}
                y2={safeHeight - pad.b}
                stroke="#cbd5e1"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
              <circle cx={tooltip.x} cy={tooltip.y} r={4.8} fill="#ffffff" stroke={T.accent} strokeWidth="2" />
              <g transform={`translate(${Math.min(tooltip.x + 8, width - 146)}, ${Math.max(tooltip.y - 40, pad.t)})`}>
                <rect width={136} height={35} rx={7} fill="#0f172a" opacity="0.90" />
                <text x={8} y={13} style={{ fontSize: 10, fill: "#94a3b8", fontFamily: "inherit" }}>{tooltip.label}</text>
                <text x={8} y={27} style={{ fontSize: 12, fill: "#ffffff", fontWeight: 700, fontFamily: "inherit" }}>
                  {money(tooltip.value)}
                </text>
              </g>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

function normalizeSeries(series) {
  const normalized = (Array.isArray(series) ? series : [])
    .map((row, index) => {
      const value = Number(row?.equity);
      if (!Number.isFinite(value)) {
        return null;
      }
      const epochMs = toEpochMs(row?.epochMs ?? row?.ts ?? row?.time);
      return {
        index,
        epochMs: Number.isFinite(epochMs) ? Math.round(epochMs) : index,
        value,
        label: null,
        tooltipLabel: null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.epochMs) - Number(b.epochMs) || Number(a.index) - Number(b.index));

  const deduped = [];
  for (const row of normalized) {
    const last = deduped[deduped.length - 1];
    if (last && Number(last.epochMs) === Number(row.epochMs)) {
      deduped[deduped.length - 1] = row;
      continue;
    }
    deduped.push(row);
  }

  return deduped.map((row, index) => ({
    ...row,
    index,
  }));
}

function normalizeAggregationMode(value) {
  const text = String(value || "raw").trim().toLowerCase();
  if (text === "weekly" || text === "monthly" || text === "yearly") {
    return text;
  }
  return "raw";
}

function aggregateNormalizedSeries(rows, mode) {
  const points = Array.isArray(rows) ? rows : [];
  if (!points.length || mode === "raw") {
    return points;
  }
  const groups = new Map();
  for (const point of points) {
    const epochMs = Number(point?.epochMs);
    const key = aggregationBucketKey(epochMs, mode);
    if (!key) {
      continue;
    }
    const existing = groups.get(key);
    if (!existing || Number(existing.epochMs) <= epochMs) {
      groups.set(key, point);
    }
  }
  const aggregated = [...groups.values()]
    .sort((a, b) => Number(a.epochMs) - Number(b.epochMs))
    .map((row, index) => ({
      ...row,
      index,
    }));
  return aggregated.length ? aggregated : points;
}

function annotateDisplayLabels(points, mode) {
  const list = Array.isArray(points) ? points : [];
  if (!list.length) {
    return [];
  }
  const startEpoch = Number(list[0]?.epochMs);
  const endEpoch = Number(list[list.length - 1]?.epochMs);
  const rangeMs = Number.isFinite(startEpoch) && Number.isFinite(endEpoch)
    ? Math.max(0, endEpoch - startEpoch)
    : 0;
  return list.map((row) => ({
    ...row,
    label: formatXAxisLabel(row?.epochMs, mode, rangeMs),
    tooltipLabel: formatTooltipLabel(row?.epochMs, mode, rangeMs),
  }));
}

function aggregateStackedSeries(rows, mode) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length || mode === "raw") {
    return list;
  }
  const groups = new Map();
  for (let index = 0; index < list.length; index += 1) {
    const row = list[index];
    const epochMs = toEpochMs(row?.epochMs ?? row?.ts ?? index);
    const key = aggregationBucketKey(epochMs, mode);
    if (!key) {
      continue;
    }
    const existing = groups.get(key);
    const previousEpoch = Number(existing?.epochMs ?? NaN);
    if (!existing || !Number.isFinite(previousEpoch) || previousEpoch <= epochMs) {
      groups.set(key, {
        ...(row && typeof row === "object" ? row : {}),
        epochMs: Number.isFinite(epochMs) ? Math.round(epochMs) : index,
      });
    }
  }
  const aggregated = [...groups.values()].sort((a, b) => Number(a.epochMs) - Number(b.epochMs));
  return aggregated.length ? aggregated : list;
}

function aggregationBucketKey(epochMs, mode) {
  if (!Number.isFinite(epochMs)) {
    return null;
  }
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (mode === "yearly") {
    return `${date.getUTCFullYear()}`;
  }
  if (mode === "monthly") {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (mode === "weekly") {
    const monday = startOfUtcWeek(epochMs);
    return `w-${monday}`;
  }
  return `${Math.round(epochMs)}`;
}

function aggregationBucketLabel(epochMs, mode) {
  if (!Number.isFinite(epochMs)) {
    return "--";
  }
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  if (mode === "yearly") {
    return `${date.getUTCFullYear()}`;
  }
  if (mode === "monthly") {
    return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  if (mode === "weekly") {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return formatXAxisLabel(epochMs, null);
}

function startOfUtcWeek(epochMs) {
  const date = new Date(epochMs);
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + diffToMonday,
  ));
  return monday.getTime();
}

function buildSmoothPath(points, width, height, pad, min, max, xDomain) {
  const mapped = mapPoints(points, width, height, pad, min, max, xDomain);
  if (!mapped.length) {
    return "";
  }
  if (mapped.length === 1) {
    return `M ${mapped[0].x.toFixed(2)} ${mapped[0].y.toFixed(2)}`;
  }
  if (mapped.length === 2) {
    return `M ${mapped[0].x.toFixed(2)} ${mapped[0].y.toFixed(2)} L ${mapped[1].x.toFixed(2)} ${mapped[1].y.toFixed(2)}`;
  }
  const tangents = computeMonotoneTangents(mapped);
  let path = `M ${mapped[0].x.toFixed(2)} ${mapped[0].y.toFixed(2)}`;
  for (let index = 1; index < mapped.length; index += 1) {
    const prev = mapped[index - 1];
    const point = mapped[index];
    const dx = point.x - prev.x;
    const c1x = prev.x + dx / 3;
    const c1y = prev.y + (tangents[index - 1] * dx) / 3;
    const c2x = point.x - dx / 3;
    const c2y = point.y - (tangents[index] * dx) / 3;
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }
  return path;
}

function buildAreaPath(points, width, height, pad, min, max, xDomain) {
  const linePath = buildSmoothPath(points, width, height, pad, min, max, xDomain);
  if (!linePath) {
    return "";
  }
  const mapped = mapPoints(points, width, height, pad, min, max, xDomain);
  const last = mapped[mapped.length - 1];
  const first = mapped[0];
  return `${linePath} L ${last.x.toFixed(2)} ${(height - pad.b).toFixed(2)} L ${first.x.toFixed(2)} ${(height - pad.b).toFixed(2)} Z`;
}

function mapPoints(points, width, height, pad, min, max, xDomain) {
  const span = Math.max(0.0001, Number(max) - Number(min));
  return (Array.isArray(points) ? points : []).map((point, index) => ({
    x: toChartX(index, points.length, width, pad, point?.epochMs, xDomain),
    y: toChartY(point.value, height, pad, min, min + span),
    value: point.value,
    epochMs: point.epochMs,
  }));
}

function computeMonotoneTangents(points) {
  const rows = Array.isArray(points) ? points : [];
  if (rows.length <= 1) {
    return rows.map(() => 0);
  }

  const slopes = [];
  for (let index = 0; index < rows.length - 1; index += 1) {
    const dx = rows[index + 1].x - rows[index].x;
    const dy = rows[index + 1].y - rows[index].y;
    slopes.push(dx !== 0 ? dy / dx : 0);
  }

  const tangents = new Array(rows.length).fill(0);
  tangents[0] = slopes[0];
  tangents[rows.length - 1] = slopes[slopes.length - 1];

  for (let index = 1; index < rows.length - 1; index += 1) {
    const left = slopes[index - 1];
    const right = slopes[index];
    tangents[index] = left * right <= 0 ? 0 : (left + right) / 2;
  }

  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index];
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = tangents[index] / slope;
    const b = tangents[index + 1] / slope;
    const norm = Math.hypot(a, b);
    if (norm > 3) {
      const scale = 3 / norm;
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }

  return tangents;
}

function buildStackedAreaPaths(series, width, height, pad, min, max, xDomain) {
  const rows = Array.isArray(series) ? series : [];
  if (!rows.length) {
    return [];
  }
  const accountIds = Object.keys(rows[0]?.accounts || {});
  if (!accountIds.length) {
    return [];
  }
  const span = Math.max(0.0001, Number(max) - Number(min));
  const areas = [];
  let lower = new Array(rows.length).fill(0);
  for (let idx = 0; idx < accountIds.length; idx += 1) {
    const accountId = accountIds[idx];
    const upper = rows.map((row, rowIndex) =>
      Number(lower[rowIndex]) + Number(row?.accounts?.[accountId] || 0));
    const upperPoints = upper.map((value, index) => {
      const x = toChartX(index, rows.length, width, pad, rows[index]?.epochMs, xDomain);
      const y = toChartY(value, height, pad, min, min + span);
      return `${x.toFixed(2)} ${y.toFixed(2)}`;
    });
    const lowerPoints = lower.map((value, index) => {
      const reversedIndex = lower.length - 1 - index;
      const x = toChartX(reversedIndex, rows.length, width, pad, rows[reversedIndex]?.epochMs, xDomain);
      const y = toChartY(value, height, pad, min, min + span);
      return `${x.toFixed(2)} ${y.toFixed(2)}`;
    });
    areas.push({
      accountId,
      path: `M ${upperPoints.join(" L ")} L ${lowerPoints.join(" L ")} Z`,
      color: DEFAULT_STACK_COLORS[idx % DEFAULT_STACK_COLORS.length],
    });
    lower = upper;
  }
  return areas;
}

function buildMarkerPoints(markers, points, width, height, pad, min, max, xDomain) {
  const primary = Array.isArray(points) ? points : [];
  const rows = Array.isArray(markers) ? markers : [];
  if (!primary.length || !rows.length) {
    return [];
  }
  const span = Math.max(0.0001, Number(max) - Number(min));
  return rows.map((marker, markerIndex) => {
    const nearest = nearestPointByEpoch(primary, Number(marker?.epochMs));
    const pointIndex = Number(nearest?.index || 0);
    const x = toChartX(pointIndex, primary.length, width, pad, Number(nearest?.epochMs), xDomain);
    const y = toChartY(Number(nearest?.value), height, pad, min, min + span);
    const isEntry = String(marker?.kind || "").toLowerCase() === "entry";
    const realizedNet = Number(marker?.realizedNet);
    const isWinningExit = !isEntry && Number.isFinite(realizedNet) && realizedNet >= 0;
    return {
      id: String(marker?.id || `${markerIndex}`),
      kind: isEntry ? "entry" : "exit",
      x,
      y,
      fill: isEntry ? "#10b981" : isWinningExit ? "#0284c7" : "#ef4444",
      stroke: isEntry ? "#047857" : isWinningExit ? "#0369a1" : "#b91c1c",
      tooltip: `${isEntry ? "Entry" : "Exit"} ${marker?.symbol || "UNKNOWN"} · ${formatMarkerTime(marker?.epochMs)}`,
    };
  });
}

function nearestPointByEpoch(points, epochMs) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }
  if (!Number.isFinite(epochMs)) {
    return points[0];
  }
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midEpoch = Number(points[mid]?.epochMs);
    if (midEpoch === epochMs) {
      return points[mid];
    }
    if (midEpoch < epochMs) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const left = points[Math.max(0, high)] || points[0];
  const right = points[Math.min(points.length - 1, low)] || points[points.length - 1];
  return Math.abs(Number(left?.epochMs) - epochMs) <= Math.abs(Number(right?.epochMs) - epochMs)
    ? left
    : right;
}

function computeBounds(primary, benchmark) {
  const values = [...primary, ...benchmark]
    .map((row) => Number(row?.value))
    .filter(Number.isFinite);
  if (!values.length) {
    return { min: 0, max: 1 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  if (span < 0.01) {
    const pad = Math.max(Math.abs(max || min) * 0.002, 1);
    return { min: min - pad, max: max + pad };
  }
  const midpoint = (min + max) / 2;
  const pad = Math.max(span * 0.12, Math.abs(midpoint) * 0.0015, 1);
  return {
    min: min - pad,
    max: max + pad,
  };
}

function buildYAxisTicks(min, max, count = 5) {
  const safeCount = Math.max(2, Number(count) || 5);
  const span = Math.max(0.0001, max - min);
  const rawStep = span / safeCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceStep = (
    normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 5
          ? 5
          : 10
  ) * magnitude;
  const start = Math.floor(min / niceStep) * niceStep;
  const end = Math.ceil(max / niceStep) * niceStep;
  const out = [];
  for (let value = start; value <= end + niceStep * 0.5; value += niceStep) {
    out.push(roundCurrency(value));
  }
  return out;
}

function buildXAxisLabels(points, maxLabels = 6) {
  const list = Array.isArray(points) ? points : [];
  if (!list.length) {
    return [];
  }
  if (list.length <= 14) {
    return list.map((row, index) => ({ index, label: row.label, epochMs: row.epochMs }));
  }
  const maxCount = Math.max(2, Number(maxLabels) || 6);
  const step = Math.max(1, Math.floor(list.length / maxCount));
  const labels = [];
  for (let index = 0; index < list.length; index += step) {
    labels.push({
      index,
      label: list[index].label,
      epochMs: list[index].epochMs,
    });
  }
  if (labels[labels.length - 1]?.index !== list.length - 1) {
    labels.push({
      index: list.length - 1,
      label: list[list.length - 1].label,
      epochMs: list[list.length - 1].epochMs,
    });
  }
  return labels;
}

function computeXDomain(primary, benchmark, stacked) {
  const values = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(benchmark) ? benchmark : []), ...(Array.isArray(stacked) ? stacked : [])]
    .map((row) => Number(row?.epochMs))
    .filter(Number.isFinite);
  if (values.length < 2) {
    return { min: 0, max: 1, useTime: false };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    min,
    max,
    useTime: max > min,
  };
}

function toChartX(index, total, width, pad, epochMs, xDomain) {
  const usable = Math.max(1, width - pad.l - pad.r);
  if (xDomain?.useTime && Number.isFinite(epochMs)) {
    const span = Math.max(1, Number(xDomain.max) - Number(xDomain.min));
    return pad.l + ((Number(epochMs) - Number(xDomain.min)) / span) * usable;
  }
  return pad.l + (index / Math.max((total || 0) - 1, 1)) * usable;
}

function toChartY(value, height, pad, min, max) {
  const span = Math.max(0.0001, Number(max) - Number(min));
  const usable = Math.max(1, height - pad.t - pad.b);
  return height - pad.b - ((Number(value) - Number(min)) / span) * usable;
}

function formatAxisCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  const abs = Math.abs(numeric);
  if (abs >= 1000000) {
    return `$${(numeric / 1000000).toFixed(1)}m`;
  }
  if (abs >= 1000) {
    return `$${(numeric / 1000).toFixed(abs < 10000 ? 1 : 0)}k`;
  }
  return `$${Math.round(numeric)}`;
}

function formatXAxisLabel(epochMs, mode, rangeMs = 0) {
  if (!Number.isFinite(epochMs)) {
    return "--";
  }
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  if (mode === "weekly" || mode === "monthly" || mode === "yearly") {
    return aggregationBucketLabel(epochMs, mode);
  }
  if (rangeMs <= 36 * 60 * 60 * 1000) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (rangeMs <= 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  if (rangeMs <= 180 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

function formatTooltipLabel(epochMs, mode, rangeMs = 0) {
  if (!Number.isFinite(epochMs)) {
    return "--";
  }
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  if (mode === "weekly") {
    return `Week of ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (mode === "monthly") {
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  if (mode === "yearly") {
    return `${date.getUTCFullYear()}`;
  }
  if (rangeMs <= 36 * 60 * 60 * 1000) {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleString();
}

function toEpochMs(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatMarkerTime(epochMs) {
  const value = toEpochMs(epochMs);
  if (!Number.isFinite(value)) {
    return "--";
  }
  return new Date(value).toLocaleString();
}

function money(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  const abs = Math.abs(numeric).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${numeric < 0 ? "-" : ""}$${abs}`;
}

function roundCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 100) / 100;
}
