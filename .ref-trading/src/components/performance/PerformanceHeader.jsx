import { useMemo, useState } from "react";
import { APP_THEME } from "../../lib/uiTheme.js";
import MetricFlowEquityChart from "./MetricFlowEquityChart.jsx";

const T = APP_THEME;

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "wtd", label: "WTD" },
  { id: "mtd", label: "MTD" },
  { id: "ytd", label: "YTD" },
  { id: "all_time", label: "All" },
];

export default function PerformanceHeader({
  title,
  subtitle,
  performance,
  accountId = "all",
  accountOptions = [],
  onAccountChange,
  period = "today",
  onPeriodChange,
  chartMode = "layered",
  onChartModeChange,
  benchmarkEnabled = false,
  onBenchmarkToggle,
  loading = false,
  refreshing = false,
  onReload,
  onBackfill,
  showTradeMarkers = false,
}) {
  const [showEntryMarkers, setShowEntryMarkers] = useState(true);
  const [showExitMarkers, setShowExitMarkers] = useState(true);
  const [chartAggregation, setChartAggregation] = useState("raw");
  const periodMetrics = performance?.periods?.[period] || null;
  const cash = performance?.cash || {};
  const chartHeight = 252;

  const singleSeries = useMemo(
    () => (Array.isArray(performance?.chart?.single) ? performance.chart.single : []),
    [performance],
  );
  const layeredSeries = useMemo(
    () => (Array.isArray(performance?.chart?.layered?.total) ? performance.chart.layered.total : []),
    [performance],
  );
  const benchmarkSeries = useMemo(
    () => (Array.isArray(performance?.chart?.benchmark?.series) ? performance.chart.benchmark.series : []),
    [performance],
  );
  const availability = performance?.availability || null;
  const periodStartMs = useMemo(
    () => (period === "all_time" ? NaN : toEpochMs(periodMetrics?.start)),
    [period, periodMetrics],
  );
  const periodEndMs = useMemo(
    () => toEpochMs(periodMetrics?.end || performance?.asOf),
    [periodMetrics, performance],
  );
  const visibleSingleSeries = useMemo(
    () => filterSeriesToWindow(singleSeries, periodStartMs, periodEndMs),
    [periodEndMs, periodStartMs, singleSeries],
  );
  const visibleLayeredSeries = useMemo(
    () => filterSeriesToWindow(layeredSeries, periodStartMs, periodEndMs),
    [layeredSeries, periodEndMs, periodStartMs],
  );
  const visibleBenchmarkSeries = useMemo(
    () => filterSeriesToWindow(benchmarkSeries, periodStartMs, periodEndMs),
    [benchmarkSeries, periodEndMs, periodStartMs],
  );

  const baseSeries = chartMode === "single" ? visibleSingleSeries : visibleLayeredSeries;
  const emptyMessage = !baseSeries.length && availability?.state === "unavailable"
    ? (availability?.message || "No verified equity history is available yet. Reconnect the broker, then run backfill.")
    : `No equity history for ${labelForPeriod(period)}.`;
  const tradeMarkers = useMemo(
    () => buildTradeMarkers(performance),
    [performance],
  );
  const windowedTradeMarkers = useMemo(
    () => filterMarkersToWindow(tradeMarkers, periodStartMs, periodEndMs),
    [periodEndMs, periodStartMs, tradeMarkers],
  );
  const visibleTradeMarkers = useMemo(
    () => windowedTradeMarkers.filter((marker) => (
      (marker.kind !== "entry" || showEntryMarkers)
      && (marker.kind !== "exit" || showExitMarkers)
    )),
    [showEntryMarkers, showExitMarkers, windowedTradeMarkers],
  );
  const entryMarkersCount = useMemo(
    () => windowedTradeMarkers.filter((marker) => marker.kind === "entry").length,
    [windowedTradeMarkers],
  );
  const exitMarkersCount = useMemo(
    () => windowedTradeMarkers.filter((marker) => marker.kind === "exit").length,
    [windowedTradeMarkers],
  );
  const periodRows = useMemo(
    () => ([
      {
        label: `${labelForPeriod(period)} Realized (Net)`,
        value: money(periodMetrics?.realizedNet),
        tone: toneForNumeric(periodMetrics?.realizedNet),
        confidence: periodMetrics?.confidence,
      },
      {
        label: `${labelForPeriod(period)} Unrealized`,
        value: money(periodMetrics?.unrealizedChange),
        tone: toneForNumeric(periodMetrics?.unrealizedChange),
        confidence: periodMetrics?.confidence,
      },
      {
        label: `${labelForPeriod(period)} Equity Delta`,
        value: money(periodMetrics?.equityChange),
        tone: toneForNumeric(periodMetrics?.equityChange),
        confidence: periodMetrics?.confidence,
      },
      {
        label: `${labelForPeriod(period)} Return`,
        value: formatPct(periodMetrics?.returnPct),
        tone: toneForNumeric(periodMetrics?.returnPct),
        confidence: periodMetrics?.confidence,
      },
    ]),
    [period, periodMetrics],
  );
  const cashRows = useMemo(
    () => ([
      { label: "Settled Cash", value: money(cash?.settledCash?.value), confidence: cash?.settledCash?.confidence },
      { label: "Unsettled Cash", value: money(cash?.unsettledCash?.value), confidence: cash?.unsettledCash?.confidence },
      { label: "Cash Avail. To Trade", value: money(cash?.cashAvailableToTrade?.value), confidence: cash?.cashAvailableToTrade?.confidence },
      { label: "Cash Avail. To Withdraw", value: money(cash?.cashAvailableToWithdraw?.value), confidence: cash?.cashAvailableToWithdraw?.confidence },
      { label: "Buying Power", value: money(cash?.buyingPower?.value), confidence: cash?.buyingPower?.confidence },
      { label: "Margin Available", value: money(cash?.marginAvailable?.value), confidence: cash?.marginAvailable?.confidence },
    ]),
    [cash],
  );
  const curveStartValue = Number(baseSeries[0]?.equity);
  const curveCurrentValue = Number(baseSeries[baseSeries.length - 1]?.equity);
  const curveDelta = Number.isFinite(curveStartValue) && Number.isFinite(curveCurrentValue)
    ? curveCurrentValue - curveStartValue
    : NaN;
  const curveDeltaPct = Number.isFinite(curveStartValue)
    && curveStartValue !== 0
    && Number.isFinite(curveCurrentValue)
    ? ((curveCurrentValue - curveStartValue) / Math.abs(curveStartValue)) * 100
    : NaN;

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 12, color: T.muted }}>{subtitle}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={accountId}
            onChange={(event) => onAccountChange?.(event.target.value)}
            style={selectStyle}
          >
            <option value="all">All Accounts</option>
            {(Array.isArray(accountOptions) ? accountOptions : []).map((account) => (
              <option key={account.accountId} value={account.accountId}>
                {account.label || account.accountId}
              </option>
            ))}
          </select>
          <button style={btnStyle("secondary")} onClick={onReload} disabled={loading}>
            {loading ? "Loading..." : "Reload"}
          </button>
          <button style={btnStyle("primary")} onClick={onBackfill} disabled={refreshing}>
            {refreshing ? "Backfilling..." : "Backfill"}
          </button>
        </div>
      </div>

      {availability?.message && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${availability.liveDataReady ? T.border : `${T.amber}55`}`,
            background: availability.liveDataReady ? T.cardAlt : `${T.amber}14`,
            color: availability.liveDataReady ? T.muted : "#8a5a00",
            fontSize: 12,
          }}
        >
          {availability.message}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(248px, 0.74fr) minmax(0, 1.76fr)", gap: 10, marginTop: 10 }}>
        <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PERIODS.map((row) => (
              <button
                key={row.id}
                style={chipStyle(period === row.id)}
                onClick={() => onPeriodChange?.(row.id)}
              >
                {row.label}
              </button>
            ))}
          </div>

          <CompactMetricSection
            title={`${labelForPeriod(period)} Snapshot`}
            rows={periodRows}
          />

          <CompactMetricSection
            title="Cash & Margin"
            rows={cashRows}
          />
        </div>

        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 9, background: T.cardAlt, minWidth: 0, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Equity Curve</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>
                Current {money(curveCurrentValue)} · Start {money(curveStartValue)} · {baseSeries.length} points
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <button
                style={chipStyle(chartMode === "layered")}
                onClick={() => onChartModeChange?.("layered")}
              >
                Layered
              </button>
              <button
                style={chipStyle(chartMode === "single")}
                onClick={() => onChartModeChange?.("single")}
              >
                Single
              </button>
              <select
                value={chartAggregation}
                onChange={(event) => setChartAggregation(event.target.value)}
                style={{ ...selectStyle, padding: "4px 8px", fontSize: 11 }}
              >
                <option value="raw">Raw</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 11, color: T.muted }}>
                <input
                  type="checkbox"
                  checked={benchmarkEnabled}
                  onChange={(event) => onBenchmarkToggle?.(event.target.checked)}
                />
                Benchmark
              </label>
              {showTradeMarkers && (
                <>
                  <button
                    style={chipStyle(showEntryMarkers)}
                    onClick={() => setShowEntryMarkers((prev) => !prev)}
                  >
                    Entries {entryMarkersCount}
                  </button>
                  <button
                    style={chipStyle(showExitMarkers)}
                    onClick={() => setShowExitMarkers((prev) => !prev)}
                  >
                    Exits {exitMarkersCount}
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(106px, 1fr))", gap: 6 }}>
            <ChartStatCell label="Curve Delta" value={money(curveDelta)} tone={toneForNumeric(curveDelta)} />
            <ChartStatCell label="Curve Return" value={formatPct(curveDeltaPct)} tone={toneForNumeric(curveDeltaPct)} />
            <ChartStatCell
              label="Benchmark"
              value={performance?.chart?.benchmark?.enabled ? (performance.chart.benchmark.symbol || "SPY") : "Off"}
            />
            <ChartStatCell label="Markers" value={showTradeMarkers ? String(visibleTradeMarkers.length) : "Off"} />
          </div>

          <MetricFlowEquityChart
            series={baseSeries}
            benchmarkSeries={benchmarkEnabled ? visibleBenchmarkSeries : []}
            markers={showTradeMarkers ? visibleTradeMarkers : []}
            stackedSeries={chartMode === "layered" ? visibleLayeredSeries : []}
            aggregation={chartAggregation}
            onAggregationChange={setChartAggregation}
            showHeader={false}
            height={chartHeight}
            title="Equity Curve"
            subtitle="Live broker equity stream"
            emptyMessage={emptyMessage}
            gradientId={`equity-curve-${chartMode}`}
          />
        </div>
      </div>
    </div>
  );
}

function CompactMetricSection({ title, rows = [] }) {
  return (
    <div style={compactSectionStyle}>
      <div style={compactSectionHeaderStyle}>{title}</div>
      <table style={compactTableStyle}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={compactLabelCellStyle}>{row.label}</td>
              <td style={{ ...compactValueCellStyle, color: toneColor(row.tone) }}>{row.value}</td>
              <td style={compactBadgeCellStyle}>
                <ConfidenceBadge confidence={row.confidence} compact />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartStatCell({ label, value, tone }) {
  return (
    <div style={chartStatCellStyle}>
      <div style={chartStatLabelStyle}>{label}</div>
      <div style={{ ...chartStatValueStyle, color: toneColor(tone) }}>{value}</div>
    </div>
  );
}

function ConfidenceBadge({ confidence, compact = false }) {
  const key = String(confidence || "unavailable").toLowerCase();
  const tone = key === "exact"
    ? { color: T.green, bg: `${T.green}1a`, border: `${T.green}55` }
    : key === "derived"
      ? { color: T.blue, bg: `${T.blue}18`, border: `${T.blue}55` }
      : { color: T.muted, bg: "#f8fafc", border: T.border };
  return (
    <span
      style={{
        border: `1px solid ${tone.border}`,
        color: tone.color,
        background: tone.bg,
        borderRadius: 999,
        padding: compact ? "1px 5px" : "1px 6px",
        fontSize: compact ? 9 : 10,
        textTransform: "uppercase",
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {key}
    </span>
  );
}

function labelForPeriod(period) {
  return PERIODS.find((row) => row.id === period)?.label || "Period";
}

function toneForNumeric(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric >= 0 ? "green" : "red";
}

function toneColor(tone) {
  if (tone === "green") {
    return T.green;
  }
  if (tone === "red") {
    return T.red;
  }
  return T.text;
}

function chipStyle(active) {
  return {
    border: `1px solid ${active ? `${T.accent}66` : T.border}`,
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 700,
    background: active ? `${T.accent}16` : "#ffffff",
    color: active ? T.accent : T.muted,
    cursor: "pointer",
  };
}

const selectStyle = {
  boxSizing: "border-box",
  background: "#ffffff",
  color: T.text,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  padding: "7px 8px",
  fontSize: 12,
};

function btnStyle(variant) {
  const base = {
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    padding: "7px 10px",
    cursor: "pointer",
  };
  if (variant === "primary") {
    return {
      ...base,
      border: `1px solid ${T.accent}60`,
      color: T.accent,
      background: `${T.accent}18`,
    };
  }
  return {
    ...base,
    border: `1px solid ${T.border}`,
    color: T.muted,
    background: "#ffffff",
  };
}

const compactSectionStyle = {
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  background: T.cardAlt,
  overflow: "hidden",
};

const compactSectionHeaderStyle = {
  padding: "7px 8px",
  borderBottom: `1px solid ${T.border}`,
  fontSize: 11,
  fontWeight: 700,
  color: T.text,
  background: "#ffffff",
};

const compactTableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 11.5,
};

const compactLabelCellStyle = {
  padding: "6px 8px",
  color: T.muted,
  borderBottom: `1px solid ${T.border}`,
  width: "100%",
};

const compactValueCellStyle = {
  padding: "6px 8px",
  textAlign: "right",
  fontWeight: 700,
  borderBottom: `1px solid ${T.border}`,
  whiteSpace: "nowrap",
};

const compactBadgeCellStyle = {
  padding: "6px 8px",
  textAlign: "right",
  borderBottom: `1px solid ${T.border}`,
  whiteSpace: "nowrap",
};

const chartStatCellStyle = {
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  background: "#ffffff",
  padding: "7px 8px",
  display: "grid",
  gap: 2,
  minWidth: 0,
};

const chartStatLabelStyle = {
  fontSize: 10,
  color: T.muted,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const chartStatValueStyle = {
  fontSize: 13,
  fontWeight: 700,
};

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

function formatPct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function buildTradeMarkers(performance) {
  const markers = [];
  const closedTrades = Array.isArray(performance?.ledgers?.closedTrades)
    ? performance.ledgers.closedTrades
    : [];
  const cashLedger = Array.isArray(performance?.ledgers?.cash)
    ? performance.ledgers.cash
    : [];

  for (const row of closedTrades) {
    const exitEpochMs = toEpochMs(row?.closedAt || row?.ts);
    if (Number.isFinite(exitEpochMs)) {
      markers.push({
        id: `exit:${row?.tradeId || row?.accountId || "trade"}:${Math.round(exitEpochMs)}`,
        kind: "exit",
        epochMs: Math.round(exitEpochMs),
        symbol: row?.symbol || "UNKNOWN",
        accountId: row?.accountId || null,
        realizedNet: Number.isFinite(Number(row?.realizedNet)) ? Number(row.realizedNet) : null,
        source: row?.source || null,
      });
    }

    const entryEpochMs = toEpochMs(row?.openedAt);
    if (Number.isFinite(entryEpochMs)) {
      markers.push({
        id: `entry:${row?.tradeId || row?.accountId || "trade"}:${Math.round(entryEpochMs)}`,
        kind: "entry",
        epochMs: Math.round(entryEpochMs),
        symbol: row?.symbol || "UNKNOWN",
        accountId: row?.accountId || null,
        realizedNet: null,
        source: row?.source || null,
      });
    }
  }

  if (!markers.some((marker) => marker.kind === "entry")) {
    for (const row of cashLedger) {
      const epochMs = toEpochMs(row?.ts || row?.epochMs);
      const amount = Number(row?.amount);
      const realizedNet = Number(row?.realizedNet);
      const source = String(row?.source || "").toLowerCase();
      if (!Number.isFinite(epochMs) || !Number.isFinite(amount) || amount >= 0) {
        continue;
      }
      if (Number.isFinite(realizedNet) && Math.abs(realizedNet) >= 0.005) {
        continue;
      }
      if (!source.includes("order")) {
        continue;
      }
      markers.push({
        id: `entry-ledger:${row?.id || row?.accountId || "cash"}:${Math.round(epochMs)}`,
        kind: "entry",
        epochMs: Math.round(epochMs),
        symbol: row?.symbol || "MULTI",
        accountId: row?.accountId || null,
        realizedNet: null,
        source: row?.source || null,
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const marker of markers.sort((a, b) => Number(a.epochMs) - Number(b.epochMs))) {
    const key = `${marker.kind}:${marker.epochMs}:${marker.symbol}:${marker.accountId || "all"}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(marker);
  }

  const byTypeLimited = [];
  const maxPerType = 160;
  for (const kind of ["entry", "exit"]) {
    const rows = deduped.filter((marker) => marker.kind === kind);
    const tail = rows.length > maxPerType ? rows.slice(rows.length - maxPerType) : rows;
    byTypeLimited.push(...tail);
  }
  return byTypeLimited.sort((a, b) => Number(a.epochMs) - Number(b.epochMs));
}

function filterSeriesToWindow(rows, startMs, endMs) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return [];
  }
  const safeEndMs = Number.isFinite(endMs) ? endMs : Infinity;
  if (!Number.isFinite(startMs) && safeEndMs === Infinity) {
    return list;
  }

  let anchor = null;
  const visible = [];
  for (const row of list) {
    const epochMs = toEpochMs(row?.epochMs ?? row?.ts ?? row?.time);
    if (!Number.isFinite(epochMs)) {
      continue;
    }
    if (Number.isFinite(startMs) && epochMs < startMs) {
      anchor = row;
      continue;
    }
    if (epochMs > safeEndMs) {
      break;
    }
    visible.push(row);
  }

  if (Number.isFinite(startMs) && anchor && visible.length) {
    return [anchor, ...visible];
  }
  return visible;
}

function filterMarkersToWindow(rows, startMs, endMs) {
  const list = Array.isArray(rows) ? rows : [];
  const safeEndMs = Number.isFinite(endMs) ? endMs : Infinity;
  if (!Number.isFinite(startMs) && safeEndMs === Infinity) {
    return list;
  }
  return list.filter((row) => {
    const epochMs = toEpochMs(row?.epochMs ?? row?.ts ?? row?.time);
    if (!Number.isFinite(epochMs)) {
      return false;
    }
    if (Number.isFinite(startMs) && epochMs < startMs) {
      return false;
    }
    if (epochMs > safeEndMs) {
      return false;
    }
    return true;
  });
}

function toEpochMs(value) {
  if (value == null || value === "") {
    return NaN;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}
