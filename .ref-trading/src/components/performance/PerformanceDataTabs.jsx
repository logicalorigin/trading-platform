import { useEffect, useMemo, useState } from "react";

import { getMarketBars } from "../../lib/brokerClient.js";
import { useMassiveOptionTracking } from "../../hooks/useMassiveOptionTracking.js";
import { buildOptionTicker } from "../../research/options/optionTicker.js";
import { APP_THEME } from "../../lib/uiTheme.js";

const T = APP_THEME;
const SPARKLINE_RESOLUTION = "5";
const SPARKLINE_COUNT_BACK = 30;

const TABS = [
  { id: "open_positions", label: "Open Positions" },
  { id: "closed_trades", label: "Closed Trades" },
  { id: "cash_ledger", label: "Cash Ledger" },
  { id: "performance_stats", label: "Performance Stats" },
];

export default function PerformanceDataTabs({
  performance,
  positions = [],
  positionsAvailability = null,
  initialTab = "open_positions",
  trackingEnabled = true,
  onClosePosition,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [spotSeriesByKey, setSpotSeriesByKey] = useState({});
  const closedTrades = Array.isArray(performance?.ledgers?.closedTrades)
    ? performance.ledgers.closedTrades
    : [];
  const cashLedger = Array.isArray(performance?.ledgers?.cash)
    ? performance.ledgers.cash
    : [];
  const performanceAvailability = performance?.availability || null;
  const stats = performance?.stats || {};
  const confidence = performance?.confidence || {};

  const totalUnrealized = useMemo(
    () => (Array.isArray(positions) ? positions : []).reduce(
      (sum, row) => sum + Number(row?.unrealizedPnl || 0),
      0,
    ),
    [positions],
  );

  const optionTrackingRequests = useMemo(
    () => (Array.isArray(positions) ? positions : [])
      .map((row) => buildPositionTrackingRequest(row))
      .filter(Boolean),
    [positions],
  );

  const massiveTrackingRequests = useMemo(
    () => (trackingEnabled && activeTab === "open_positions" ? optionTrackingRequests : []),
    [activeTab, optionTrackingRequests, trackingEnabled],
  );

  const { snapshotsByTrackingId } = useMassiveOptionTracking(massiveTrackingRequests, {
    diagnosticsId: "positions.massive-options",
    diagnosticsSurface: "positions",
  });

  const sparklineRequests = useMemo(() => {
    const unique = new Map();
    for (const row of Array.isArray(positions) ? positions : []) {
      const accountId = String(row?.accountId || "").trim();
      const symbol = getUnderlyingSymbol(row);
      if (!accountId || !symbol) {
        continue;
      }
      const key = buildSpotSeriesKey(accountId, symbol);
      if (!unique.has(key)) {
        unique.set(key, { key, accountId, symbol });
      }
    }
    return Array.from(unique.values());
  }, [positions]);

  useEffect(() => {
    if (activeTab !== "open_positions" || !sparklineRequests.length) {
      return undefined;
    }

    const missing = sparklineRequests.filter((request) => spotSeriesByKey[request.key] == null);
    if (!missing.length) {
      return undefined;
    }

    let cancelled = false;

    setSpotSeriesByKey((prev) => {
      const next = { ...prev };
      for (const request of missing) {
        next[request.key] = { status: "loading", bars: [], symbol: request.symbol };
      }
      return next;
    });

    Promise.all(
      missing.map(async ({ key, accountId, symbol }) => {
        try {
          const response = await getMarketBars({
            accountId,
            symbol,
            resolution: SPARKLINE_RESOLUTION,
            countBack: SPARKLINE_COUNT_BACK,
          });
          return [
            key,
            {
              status: "ready",
              symbol,
              bars: normalizeSpotBars(response?.bars),
            },
          ];
        } catch (error) {
          return [
            key,
            {
              status: "error",
              symbol,
              bars: [],
              error: error?.message || "Spot history unavailable",
            },
          ];
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }
      setSpotSeriesByKey((prev) => ({
        ...prev,
        ...Object.fromEntries(entries),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, sparklineRequests, spotSeriesByKey]);

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            style={chipStyle(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "open_positions" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: T.muted }}>
              {(positions || []).length} positions · Unrealized {money(totalUnrealized)}
            </div>
            <div style={{ fontSize: 11, color: T.subtle }}>
              Underlying spot · {SPARKLINE_RESOLUTION}m · last {SPARKLINE_COUNT_BACK} bars
            </div>
          </div>
          {positionsAvailability?.state && positionsAvailability.state !== "live" && (positions || []).length > 0 && (
            <StatusNotice message={positionsAvailability.message || "Live positions are refreshing."} />
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {(positions || []).map((row) => {
              const symbol = getUnderlyingSymbol(row);
              const sparkKey = buildSpotSeriesKey(row.accountId, symbol);
              return (
                <PositionCard
                  key={row.positionId}
                  row={row}
                  spotSeries={spotSeriesByKey[sparkKey]}
                  liveOptionTracking={snapshotsByTrackingId[buildPositionTrackingId(row)] || null}
                  onClosePosition={onClosePosition}
                />
              );
            })}
            {(positions || []).length === 0 && (
              <div
                style={{
                  border: `1px dashed ${T.borderStrong}`,
                  borderRadius: 8,
                  padding: "12px 10px",
                  color: T.muted,
                  fontSize: 12,
                  background: T.cardAlt,
                }}
              >
                {positionsAvailability?.state === "unavailable"
                  ? (positionsAvailability.message || "Live positions are temporarily unavailable.")
                  : "No open positions."}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "closed_trades" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                {["Closed", "Account", "Symbol", "Net", "Fees", "Confidence", "Source"].map((header) => (
                  <th key={header} style={headCellStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {closedTrades.map((row) => (
                <tr key={row.tradeId} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={cellStyle}>{formatDateTime(row.closedAt)}</td>
                  <td style={cellStyle}>{row.accountId}</td>
                  <td style={cellStyle}>{row.symbol || "--"}</td>
                  <td style={{ ...cellStyle, color: Number(row.realizedNet) >= 0 ? T.green : T.red }}>
                    {money(row.realizedNet)}
                  </td>
                  <td style={cellStyle}>{money(row.fees)}</td>
                  <td style={cellStyle}>{String(row.confidence || "--")}</td>
                  <td style={cellStyle}>{row.source || "--"}</td>
                </tr>
              ))}
              {closedTrades.length === 0 && (
                <tr>
                  <td style={{ ...cellStyle, color: T.muted }} colSpan={7}>
                    {performanceAvailability?.state && performanceAvailability.state !== "live"
                      ? (performanceAvailability.message || "Broker-native closed trades are temporarily unavailable.")
                      : "No closed trades available yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "cash_ledger" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                {["Time", "Account", "Type", "Amount", "Realized", "Balance", "Confidence", "Source"].map((header) => (
                  <th key={header} style={headCellStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cashLedger.map((row) => (
                <tr key={row.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={cellStyle}>{formatDateTime(row.ts)}</td>
                  <td style={cellStyle}>{row.accountId}</td>
                  <td style={cellStyle}>{row.type}</td>
                  <td style={{ ...cellStyle, color: Number(row.amount) >= 0 ? T.green : T.red }}>
                    {money(row.amount)}
                  </td>
                  <td style={{ ...cellStyle, color: Number(row.realizedNet) >= 0 ? T.green : T.red }}>
                    {money(row.realizedNet)}
                  </td>
                  <td style={cellStyle}>{money(row.balance)}</td>
                  <td style={cellStyle}>{String(row.confidence || "--")}</td>
                  <td style={cellStyle}>{row.source || "--"}</td>
                </tr>
              ))}
              {cashLedger.length === 0 && (
                <tr>
                  <td style={{ ...cellStyle, color: T.muted }} colSpan={8}>
                    {performanceAvailability?.state && performanceAvailability.state !== "live"
                      ? (performanceAvailability.message || "Broker-native cash ledger rows are temporarily unavailable.")
                      : "No cash ledger rows available yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "performance_stats" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <StatCard label="Win Rate" value={formatPct(stats.winRate)} />
          <StatCard label="Profit Factor" value={formatNum(stats.profitFactor)} />
          <StatCard label="Max Drawdown" value={formatPct(stats.maxDrawdownPct)} />
          <StatCard label="All-time Return" value={formatPct(stats.allTimeReturnPct)} />
          <StatCard label="All-time Realized" value={money(stats.allTimeRealizedNet)} />
          <StatCard label="Rows" value={String(stats.points ?? "--")} />
          <StatCard label="Confidence Exact" value={String(confidence.exact ?? 0)} />
          <StatCard label="Confidence Derived" value={String(confidence.derived ?? 0)} />
          <StatCard label="Confidence Unavailable" value={String(confidence.unavailable ?? 0)} />
        </div>
      )}
    </div>
  );
}

function StatusNotice({ message }) {
  if (!message) {
    return null;
  }
  return (
    <div
      style={{
        marginBottom: 8,
        border: `1px solid ${T.borderStrong}`,
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 12,
        color: T.muted,
        background: T.cardAlt,
      }}
    >
      {message}
    </div>
  );
}

function PositionCard({ row, spotSeries, liveOptionTracking, onClosePosition }) {
  const spotSummary = summarizeSpotSeries(spotSeries?.bars);
  const pnlPositive = Number(row?.unrealizedPnl) >= 0;
  const sidePositive = String(row?.side || "").toLowerCase() === "long";
  const isOption = isOptionPosition(row);
  const liveTrackingLabel = formatLiveOptionTrackingLabel(liveOptionTracking, row);
  const liveTrackingTone = liveOptionTracking?.quoteStatus === "live"
    ? T.green
    : liveOptionTracking?.quoteStatus === "stale"
      ? T.amber
      : T.subtle;
  const spotColor = spotSummary.change == null
    ? T.subtle
    : spotSummary.change >= 0
      ? T.green
      : T.red;

  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 9,
        background: T.cardAlt,
        padding: "9px 10px",
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 220px", minWidth: 200, display: "grid", gap: 4 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
            {getUnderlyingSymbol(row)}
          </span>
          <Badge label={String(row?.assetType || "--")} tone="neutral" />
          <Badge label={String(row?.side || "--")} tone={sidePositive ? "positive" : "negative"} />
        </div>
        <div style={{ fontSize: 11.5, color: T.muted, minHeight: 16 }}>
          {formatPositionDescriptor(row)}
        </div>
        {isOption && (
          <div style={{ fontSize: 10.5, color: liveTrackingTone, minHeight: 14 }}>
            {liveTrackingLabel}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: T.subtle, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {row.accountId}
        </div>
      </div>

      <div style={{ flex: "0 1 190px", minWidth: 170, display: "grid", gap: 4 }}>
        <MetricLine label="Qty" value={formatQty(row.qty)} />
        <MetricLine label="Avg" value={money(row.averagePrice)} />
        <MetricLine label="Broker Mark" value={money(row.markPrice)} />
        {isOption && (
          <>
            <MetricLine label="Massive Mid" value={money(liveOptionTracking?.markPrice)} />
            <MetricLine label="Spread" value={money(liveOptionTracking?.spread)} />
          </>
        )}
      </div>

      <div style={{ flex: "1 1 170px", minWidth: 160, display: "grid", gap: 4 }}>
        <div style={{ fontSize: 10.5, color: T.subtle, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Underlying Spot
        </div>
        <PositionSparkline bars={spotSeries?.bars} status={spotSeries?.status} />
        <div style={{ fontSize: 11, color: spotColor }}>
          {spotSummary.label}
        </div>
      </div>

      <div style={{ flex: "0 1 140px", minWidth: 130, display: "grid", gap: 4 }}>
        <MetricLine label="Value" value={money(row.marketValue)} />
        <MetricLine
          label="UPNL"
          value={money(row.unrealizedPnl)}
          tone={pnlPositive ? "positive" : "negative"}
        />
      </div>

      <div style={{ flex: "0 0 auto", marginLeft: "auto" }}>
        <button
          style={btnStyle("danger")}
          onClick={() => onClosePosition?.(row)}
          disabled={!onClosePosition}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function PositionSparkline({ bars = [], status }) {
  const points = Array.isArray(bars) ? bars.map((bar) => Number(bar?.close)) : [];
  const validPoints = points.filter((point) => Number.isFinite(point));
  if (!validPoints.length) {
    return (
      <div
        style={{
          height: 34,
          borderRadius: 6,
          border: `1px dashed ${T.borderStrong}`,
          background: "#ffffff",
          color: T.subtle,
          fontSize: 10.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {status === "loading" ? "Loading spot..." : "Spot unavailable"}
      </div>
    );
  }

  const width = 132;
  const height = 34;
  const padding = 2;
  const min = Math.min(...validPoints);
  const max = Math.max(...validPoints);
  const range = Math.max(max - min, 0.01);
  const first = validPoints[0];
  const last = validPoints[validPoints.length - 1];
  const stroke = last >= first ? T.green : T.red;
  const path = validPoints.map((point, index) => {
    const x = padding + (index / Math.max(validPoints.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((point - min) / range) * (height - padding * 2);
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Underlying spot sparkline"
      style={{ width: "100%", height, display: "block" }}
    >
      <line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke={T.border} strokeWidth="1" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Badge({ label, tone = "neutral" }) {
  const colors = tone === "positive"
    ? { color: T.green, background: `${T.green}12`, border: `${T.green}33` }
    : tone === "negative"
      ? { color: T.red, background: `${T.red}12`, border: `${T.red}33` }
      : { color: T.muted, background: "#ffffff", border: T.border };

  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        borderRadius: 999,
        padding: "2px 6px",
        color: colors.color,
        background: colors.background,
        border: `1px solid ${colors.border}`,
      }}
    >
      {label}
    </span>
  );
}

function MetricLine({ label, value, tone = "neutral" }) {
  const color = tone === "positive" ? T.green : tone === "negative" ? T.red : T.text;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5 }}>
      <span style={{ color: T.subtle, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ color, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 9px", background: T.cardAlt }}>
      <div style={{ fontSize: 11, color: T.muted }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{value}</div>
    </div>
  );
}

function formatPositionDescriptor(row) {
  if (String(row?.assetType || "").toLowerCase() === "option") {
    return formatOptionContract(row?.option);
  }
  return `${String(row?.symbol || "--").toUpperCase()} equity position`;
}

function formatOptionContract(option) {
  if (!option || typeof option !== "object") {
    return "--";
  }
  const expiry = option.expiry || "n/a";
  const strike = Number(option.strike);
  const right = option.right || "n/a";
  const strikeText = Number.isFinite(strike) ? String(strike) : "n/a";
  return `${expiry} ${strikeText} ${right}`;
}

function formatDateTime(value) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString();
}

function formatNum(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return numeric.toFixed(2);
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

function formatPct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatQty(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function normalizeSpotBars(bars) {
  return (Array.isArray(bars) ? bars : [])
    .map((bar) => ({
      time: Number(bar?.time),
      close: Number(bar?.close),
    }))
    .filter((bar) => Number.isFinite(bar.close))
    .sort((left, right) => Number(left.time || 0) - Number(right.time || 0));
}

function summarizeSpotSeries(bars) {
  const normalized = normalizeSpotBars(bars);
  if (!normalized.length) {
    return {
      change: null,
      label: "Spot unavailable",
    };
  }
  const first = Number(normalized[0].close);
  const last = Number(normalized[normalized.length - 1].close);
  const change = last - first;
  const changePct = Math.abs(first) > 0.00001 ? (change / first) * 100 : 0;
  return {
    change,
    label: `${money(last)} ${change >= 0 ? "+" : ""}${changePct.toFixed(2)}%`,
  };
}

function getUnderlyingSymbol(row) {
  return String(
    row?.underlyingSymbol
      || row?.option?.symbol
      || row?.symbol
      || "",
  ).trim().toUpperCase();
}

function buildSpotSeriesKey(accountId, symbol) {
  return `${String(accountId || "").trim()}::${String(symbol || "").trim().toUpperCase()}`;
}

function isOptionPosition(row) {
  return String(row?.assetType || "").toLowerCase() === "option";
}

function buildPositionTrackingId(row) {
  const accountId = String(row?.accountId || "").trim();
  const positionId = String(row?.positionId || "").trim();
  if (!accountId || !positionId) {
    return "";
  }
  return ["position", accountId, positionId].join(":");
}

function buildPositionTrackingRequest(row) {
  if (!isOptionPosition(row)) {
    return null;
  }
  const trackingId = buildPositionTrackingId(row);
  const optionTicker = buildOptionTicker(row?.option || {}, getUnderlyingSymbol(row));
  if (!trackingId || !optionTicker) {
    return null;
  }
  return {
    trackingId,
    optionTicker,
    sourceType: "position",
    sourceId: String(row?.positionId || "").trim() || null,
    label: `${getUnderlyingSymbol(row)} ${formatOptionContract(row?.option)}`,
    openedAt: row?.openedAt || row?.updatedAt || null,
  };
}

function formatLiveOptionTrackingLabel(snapshot, row) {
  if (!isOptionPosition(row)) {
    return "";
  }
  if (!snapshot) {
    const optionTicker = buildOptionTicker(row?.option || {}, getUnderlyingSymbol(row));
    return optionTicker ? "Massive tracking pending..." : "Massive ticker unavailable";
  }
  if (snapshot.quoteStatus === "live") {
    return `Massive live${snapshot.lastQuoteAt ? ` · ${formatTimeOnly(snapshot.lastQuoteAt)}` : ""}`;
  }
  if (snapshot.quoteStatus === "stale") {
    return `Massive stale${snapshot.lastQuoteAt ? ` · ${formatTimeOnly(snapshot.lastQuoteAt)}` : ""}`;
  }
  if (snapshot.quoteStatus === "api_key_missing") {
    return "Massive API key missing";
  }
  if (snapshot.quoteStatus === "unavailable") {
    return snapshot?.service?.lastError || "Massive tracking unavailable";
  }
  return "Waiting for Massive quote...";
}

function formatTimeOnly(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

const headCellStyle = {
  textAlign: "left",
  color: T.muted,
  fontWeight: 700,
  padding: "6px 4px",
};

const cellStyle = {
  padding: "6px 4px",
  whiteSpace: "nowrap",
};

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

function btnStyle(variant) {
  const base = {
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    padding: "4px 8px",
    cursor: "pointer",
  };
  if (variant === "danger") {
    return {
      ...base,
      color: T.red,
      background: `${T.red}14`,
      border: `1px solid ${T.red}55`,
    };
  }
  return {
    ...base,
    color: T.muted,
    background: "#ffffff",
    border: `1px solid ${T.border}`,
  };
}
