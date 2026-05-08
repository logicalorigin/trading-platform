import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Snowflake,
  Target,
  Zap,
} from "lucide-react";
import {
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
  computeSignals,
  computeSqueeze,
  contractGex,
  expConcentration,
  gammaPriceProfile,
  gexByExpiry,
  isFiniteNumber,
  normalizeGexResponseOptions,
  normalizeGexTicker,
  oiByStrike,
} from "../features/gex/gexModel.js";
import { Card, DataUnavailableState } from "../components/platform/primitives.jsx";
import { T, dim, fs, sp, textSize } from "../lib/uiTokens.jsx";

const fetchGexData = async ({ ticker, signal }) => {
  const response = await fetch(`/api/gex/${encodeURIComponent(ticker)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    let message = `GEX request failed (${response.status})`;
    try {
      const payload = await response.json();
      message = payload?.message || payload?.error || message;
    } catch {
      // Leave the status-based message when the server did not return JSON.
    }
    throw new Error(message);
  }
  return response.json();
};

const fmtCurrency = (value) => {
  if (!isFiniteNumber(value)) return "----";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(2)}`;
};

const fmtNumber = (value) =>
  isFiniteNumber(value)
    ? Math.round(value).toLocaleString("en-US")
    : "----";

const fmtPrice = (value) =>
  isFiniteNumber(value) ? `$${value.toFixed(value >= 100 ? 2 : 3)}` : "----";

const fmtPercent = (value, digits = 1) =>
  isFiniteNumber(value)
    ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`
    : "----";

const pct = (numerator, denominator) =>
  denominator > 0 ? numerator / denominator : 0;

const fieldStyle = {
  background: T.bg0,
  border: `1px solid ${T.border}`,
  color: T.text,
  fontFamily: T.sans,
  fontSize: textSize("bodyStrong"),
  height: dim(30),
  outline: "none",
};

const SegmentControl = ({ value, options, onChange }) => (
  <div
    style={{
      display: "inline-flex",
      background: T.bg0,
      border: `1px solid ${T.border}`,
    }}
  >
    {options.map((option) => {
      const active = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          style={{
            padding: sp("6px 9px"),
            border: 0,
            borderRight: `1px solid ${T.border}`,
            background: active ? T.accentDim : "transparent",
            color: active ? T.text : T.textSec,
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
      padding: sp("8px 10px"),
      borderBottom: `1px solid ${T.border}`,
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
          width: dim(3),
          height: dim(13),
          background: T.accent,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: T.text,
          fontFamily: T.display,
          fontSize: textSize("body"),
          fontWeight: 700,
          letterSpacing: "0.03em",
          textTransform: "uppercase",
        }}
      >
        {children}
      </span>
    </div>
    {right}
  </div>
);

const MetricTile = ({ label, value, sub, color = T.text }) => (
  <div
    style={{
      minWidth: dim(112),
      flex: "1 1 112px",
      padding: sp("10px 8px"),
      borderRight: `1px solid ${T.border}`,
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
        color: T.textDim,
        fontFamily: T.display,
        fontSize: textSize("caption"),
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
    <span
      style={{
        color,
        fontFamily: T.display,
        fontSize: fs(16),
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {value}
    </span>
    <span
      style={{
        color: T.textMuted,
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
    <span style={{ color: T.textDim, fontSize: textSize("caption") }}>{label}</span>
    <span
      style={{
        color: T.text,
        fontFamily: T.display,
        fontSize: textSize("caption"),
        fontWeight: 700,
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
          color: T.text,
          fontFamily: T.display,
          fontSize: textSize("bodyStrong"),
          fontWeight: 700,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {details.name || data?.ticker || "----"}
      </div>
      <MetaLine label="Sector" value={details.sector || details.industry || "----"} />
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

const ChartShell = ({ title, subtitle, right, children, minHeight = 260 }) => (
  <Card noPad style={{ minHeight: dim(minHeight) }}>
    <SectionTitle right={right}>{title}</SectionTitle>
    {subtitle ? (
      <div
        style={{
          padding: sp("7px 10px 0"),
          color: T.textDim,
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
        color: T.text,
        fontFamily: T.display,
        fontSize: fs(15),
        fontWeight: 700,
        margin: 0,
      }}
    >
      {title}
    </h2>
    <span style={{ flex: 1, height: 1, background: T.border }} />
  </div>
);

const GexTooltip = ({ active, payload, spot }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.borderLight}`,
        padding: sp(8),
        color: T.text,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ color: T.text, fontWeight: 700, marginBottom: sp(5) }}>
        ${row.strike} · {fmtPercent((row.strike - spot) / spot)}
      </div>
      <div style={{ color: row.netGex >= 0 ? T.green : T.red }}>
        Net {fmtCurrency(row.netGex)}
      </div>
      <div style={{ color: T.green }}>Call {fmtCurrency(row.callGex)}</div>
      <div style={{ color: T.red }}>Put {fmtCurrency(row.putGex)}</div>
      <div style={{ color: T.textSec }}>Call OI {fmtNumber(row.callOi)}</div>
      <div style={{ color: T.textSec }}>Put OI {fmtNumber(row.putOi)}</div>
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
      <ResponsiveContainer width="100%" height={286}>
        <BarChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="strike"
            tick={{ fill: T.textDim, fontSize: 10, fontFamily: T.sans }}
            axisLine={{ stroke: T.border }}
            tickLine={{ stroke: T.border }}
            minTickGap={18}
          />
          <YAxis
            tickFormatter={(value) => `${(value / 1e6).toFixed(0)}M`}
            tick={{ fill: T.textDim, fontSize: 10, fontFamily: T.sans }}
            axisLine={{ stroke: T.border }}
            tickLine={{ stroke: T.border }}
          />
          <Tooltip cursor={{ fill: "rgba(148,163,184,0.08)" }} content={<GexTooltip spot={spot} />} />
          <ReferenceLine
            x={Math.round(spot)}
            stroke={T.cyan}
            strokeDasharray="4 4"
            label={{ value: "Spot", fill: T.cyan, fontSize: 10, position: "top" }}
          />
          {series === "net" ? (
            <Bar dataKey="netGex" isAnimationActive={false}>
              {data.map((row) => (
                <Cell
                  key={row.strike}
                  fill={row.netGex >= 0 ? T.green : T.red}
                  stroke={
                    row.strike === callWall || row.strike === putWall
                      ? T.text
                      : "transparent"
                  }
                  strokeWidth={row.strike === callWall || row.strike === putWall ? 2 : 0}
                />
              ))}
            </Bar>
          ) : (
            <>
              <Bar dataKey="callGex" fill={T.green} isAnimationActive={false} />
              <Bar dataKey="putGex" fill={T.red} isAnimationActive={false} />
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
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
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: T.textDim, fontSize: 10, fontFamily: T.sans }}
            axisLine={{ stroke: T.border }}
            tickLine={{ stroke: T.border }}
          />
          <YAxis
            tickFormatter={(value) => `${(value / 1e6).toFixed(0)}M`}
            tick={{ fill: T.textDim, fontSize: 10, fontFamily: T.sans }}
            axisLine={{ stroke: T.border }}
            tickLine={{ stroke: T.border }}
          />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.08)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload;
              return (
                <div style={tooltipBoxStyle}>
                  <b>{row.label}</b>
                  <div style={{ color: T.green }}>Call {fmtCurrency(row.callGex)}</div>
                  <div style={{ color: T.red }}>Put {fmtCurrency(row.putGex)}</div>
                  <div style={{ color: row.netGex >= 0 ? T.green : T.red }}>
                    Net {fmtCurrency(row.netGex)}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="callGex" fill={T.green} stackId="expiry" isAnimationActive={false} />
          <Bar dataKey="putGex" fill={T.red} stackId="expiry" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
};

const tooltipBoxStyle = {
  background: T.bg2,
  border: `1px solid ${T.borderLight}`,
  padding: sp(8),
  color: T.text,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
};

const GammaPriceChart = ({ rows, spot }) => {
  const data = useMemo(() => gammaPriceProfile(rows, spot), [rows, spot]);
  const zeroPrice = useMemo(() => {
    for (let index = 0; index < data.length - 1; index += 1) {
      const left = data[index];
      const right = data[index + 1];
      if (
        (left.netGex <= 0 && right.netGex >= 0) ||
        (left.netGex >= 0 && right.netGex <= 0)
      ) {
        const t = left.netGex / (left.netGex - right.netGex);
        return left.price + t * (right.price - left.price);
      }
    }
    return null;
  }, [data]);

  return (
    <ChartShell
      title="Gamma Price Profile"
      subtitle="Projected Net Gamma at different price levels. Assumes constant IV."
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="price"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value) => `$${value.toFixed(0)}`}
            tick={{ fill: T.textDim, fontSize: 10, fontFamily: T.sans }}
            axisLine={{ stroke: T.border }}
            tickLine={{ stroke: T.border }}
          />
          <YAxis
            tickFormatter={(value) => `${(value / 1e6).toFixed(0)}M`}
            tick={{ fill: T.textDim, fontSize: 10, fontFamily: T.sans }}
            axisLine={{ stroke: T.border }}
            tickLine={{ stroke: T.border }}
          />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.08)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload;
              return (
                <div style={tooltipBoxStyle}>
                  <b>{fmtPrice(row.price)}</b>
                  <div style={{ color: row.netGex >= 0 ? T.green : T.red }}>
                    Net {fmtCurrency(row.netGex)}
                  </div>
                </div>
              );
            }}
          />
          <ReferenceLine
            x={spot}
            stroke={T.cyan}
            strokeDasharray="4 4"
            label={{ value: "Spot", fill: T.cyan, fontSize: 10, position: "top" }}
          />
          {zeroPrice != null ? (
            <ReferenceLine
              x={zeroPrice}
              stroke={T.amber}
              strokeDasharray="2 4"
              label={{ value: "Zero", fill: T.amber, fontSize: 10, position: "top" }}
            />
          ) : null}
          <Bar dataKey="netGex" isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.price} fill={row.netGex >= 0 ? T.green : T.red} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
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
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="strike"
            tick={{ fill: T.textDim, fontSize: 10, fontFamily: T.sans }}
            axisLine={{ stroke: T.border }}
            tickLine={{ stroke: T.border }}
            minTickGap={18}
          />
          <YAxis
            tickFormatter={(value) => (value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : `${(value / 1e3).toFixed(0)}K`)}
            tick={{ fill: T.textDim, fontSize: 10, fontFamily: T.sans }}
            axisLine={{ stroke: T.border }}
            tickLine={{ stroke: T.border }}
          />
          <ReferenceLine x={Math.round(spot)} stroke={T.cyan} strokeDasharray="4 4" />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.08)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload;
              return (
                <div style={tooltipBoxStyle}>
                  <b>${row.strike}</b>
                  <div style={{ color: T.green }}>Call OI {fmtNumber(row.callOi)}</div>
                  <div style={{ color: T.red }}>Put OI {fmtNumber(row.putOi)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="callOi" fill={T.green} stackId="oi" isAnimationActive={false} />
          <Bar dataKey="putOi" fill={T.red} stackId="oi" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
};

const HeatmapCard = ({ rows, spot }) => {
  const [expanded, setExpanded] = useState(false);
  const model = useMemo(() => {
    const expirationMap = new Map();
    const cellMap = new Map();
    rows.forEach((row) => {
      const key = row.expirationDate;
      if (!key) return;
      if (!expirationMap.has(key)) {
        expirationMap.set(key, {
          key,
          label: key.slice(5),
        });
      }
      const strikeMap = cellMap.get(row.strike) || new Map();
      strikeMap.set(key, (strikeMap.get(key) || 0) + contractGex(row, spot));
      cellMap.set(row.strike, strikeMap);
    });
    let maxAbs = 0;
    cellMap.forEach((strikeMap) => {
      strikeMap.forEach((value) => {
        maxAbs = Math.max(maxAbs, Math.abs(value));
      });
    });
    return {
      expirations: Array.from(expirationMap.values()).sort((left, right) =>
        left.key.localeCompare(right.key),
      ),
      strikes: Array.from(cellMap.keys()).sort((left, right) => left - right),
      cellMap,
      maxAbs,
    };
  }, [rows, spot]);
  const visibleStrikes = useMemo(() => {
    if (expanded) return model.strikes;
    const spotIndex = model.strikes.findIndex((strike) => strike >= spot);
    const centerIndex = spotIndex === -1 ? model.strikes.length - 1 : spotIndex;
    const start = Math.max(0, centerIndex - 8);
    return model.strikes.slice(start, start + 17);
  }, [expanded, model.strikes, spot]);

  const cellColor = (value) => {
    if (!value || !model.maxAbs) return T.bg0;
    const alpha = Math.min(0.85, Math.max(0.08, Math.abs(value) / model.maxAbs));
    return value > 0
      ? `rgba(16,185,129,${alpha})`
      : `rgba(239,68,68,${alpha})`;
  };

  return (
    <ChartShell
      title="GEX Heatmap by Expiration"
      right={
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          style={{
            ...fieldStyle,
            height: dim(26),
            padding: sp("0 8px"),
            cursor: "pointer",
            color: T.textSec,
          }}
        >
          {expanded ? "Collapse" : `Expand (${model.strikes.length} strikes)`}
        </button>
      }
      minHeight={280}
    >
      <div style={{ overflow: "auto", maxHeight: expanded ? dim(440) : dim(260) }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: T.sans,
            fontSize: textSize("caption"),
          }}
        >
          <thead>
            <tr>
              <th style={heatmapHeaderStyle}>Strike</th>
              {model.expirations.map((expiration) => (
                <th key={expiration.key} style={heatmapHeaderStyle}>
                  {expiration.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleStrikes.map((strike) => (
              <tr key={strike}>
                <td
                  style={{
                    ...heatmapHeaderStyle,
                    color: Math.abs(strike - spot) < 0.5 ? T.cyan : T.textSec,
                  }}
                >
                  ${strike}
                </td>
                {model.expirations.map((expiration) => {
                  const value = model.cellMap.get(strike)?.get(expiration.key) || 0;
                  return (
                    <td
                      key={expiration.key}
                      title={`${strike} ${expiration.key} ${fmtCurrency(value)}`}
                      style={{
                        padding: sp("5px 6px"),
                        textAlign: "center",
                        borderBottom: `1px solid ${T.border}`,
                        background: cellColor(value),
                        color: Math.abs(value) > model.maxAbs * 0.5 ? T.text : T.textSec,
                      }}
                    >
                      {Math.abs(value) > model.maxAbs * 0.04
                        ? `${(value / 1e3).toFixed(0)}K`
                        : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartShell>
  );
};

const heatmapHeaderStyle = {
  padding: sp("5px 6px"),
  textAlign: "center",
  color: T.textDim,
  background: T.bg1,
  borderBottom: `1px solid ${T.border}`,
  whiteSpace: "nowrap",
};

const SignalsCard = ({ signals }) => (
  <Card noPad>
    <SectionTitle>Signals</SectionTitle>
    <div style={{ padding: sp(10), display: "grid", gap: sp(8) }}>
      {signals.length ? (
        signals.map((signal, index) => {
          const Icon = signal.kind === "Magnet" ? Target : signal.kind === "Support" ? ShieldCheck : AlertTriangle;
          const color = signal.severity === "STRONG" ? T.amber : T.cyan;
          return (
            <div
              key={`${signal.kind}-${index}`}
              style={{
                display: "grid",
                gap: sp(4),
                paddingBottom: sp(8),
                borderBottom: index < signals.length - 1 ? `1px solid ${T.border}` : 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: sp(7) }}>
                <Icon size={14} color={color} />
                <b style={{ color: T.text, fontSize: textSize("body"), fontFamily: T.display }}>
                  {signal.kind}
                </b>
                <span style={{ marginLeft: "auto", color, fontSize: textSize("caption") }}>
                  {signal.severity}
                </span>
              </div>
              <div style={{ color: T.textSec, fontSize: textSize("caption"), lineHeight: 1.4 }}>
                {signal.description}
              </div>
              <div style={{ color: T.textDim, fontSize: textSize("caption") }}>
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
    return "Squeeze scoring waits for Massive-derived flow context instead of using neutral placeholders.";
  }

  const rawCount = Number(source.flowEventCount || 0);
  const classifiedCount = Number(source.classifiedFlowEventCount || 0);
  if (rawCount <= 0) {
    return "No Massive option flow events were returned for the current GEX window.";
  }

  const coverage =
    Number.isFinite(source.flowClassificationCoverage) && source.flowClassificationCoverage >= 0
      ? source.flowClassificationCoverage
      : classifiedCount / rawCount;
  const basis = source.flowClassificationBasisCounts || {};
  return `${classifiedCount}/${rawCount} Massive flow events classified (${Math.round(
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
    ["Gamma", factors.gammaRegime],
    ["Wall", factors.wallProximity],
    ["Flow", factors.flowAlignment],
    ["Volume", factors.volumeConfirm],
    ["DEX", factors.dexBias],
  ];
  const color = squeeze.bias === "BULLISH" ? T.green : T.red;
  const displayedClassifiedFlowCount = Number(
    source?.classifiedFlowEventCount || squeeze.flowEventCount || 0,
  );
  const displayedRawFlowCount = Number(
    source?.flowEventCount || squeeze.flowEventCount || 0,
  );
  return (
    <Card noPad>
      <SectionTitle>Gamma Squeeze Screener</SectionTitle>
      <div style={{ padding: sp(10), display: "grid", gap: sp(10) }}>
        <div style={{ display: "flex", alignItems: "center", gap: sp(7) }}>
          <Zap size={15} color={T.amber} />
          <span style={{ color, fontSize: fs(18), fontWeight: 700 }}>
            {squeeze.score || 0}
          </span>
          <span style={{ color: T.textDim, fontSize: textSize("caption") }}>/100</span>
          <span style={{ marginLeft: "auto", color, fontSize: textSize("caption") }}>
            {squeeze.bias} · {squeeze.verdict}
          </span>
        </div>
        <div style={{ height: dim(7), background: T.bg0, border: `1px solid ${T.border}` }}>
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
              color: T.amber,
              background: T.amberBg,
              border: `1px solid ${T.amberDim}`,
              padding: sp(7),
              fontSize: textSize("caption"),
            }}
          >
            Flow factors are waiting for Massive-derived flow context.
          </div>
        ) : (
          <div style={{ color: T.textDim, fontSize: textSize("caption") }}>
            Massive flow events: {displayedClassifiedFlowCount}/{displayedRawFlowCount} classified
          </div>
        )}
        <div style={{ display: "grid", gap: sp(6) }}>
          {rows.map(([label, value]) => (
            <div key={label}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: T.textSec,
                  fontSize: textSize("caption"),
                }}
              >
                <span>{label}</span>
                <span>{Math.round(value || 0)}/25</span>
              </div>
              <div style={{ height: dim(4), background: T.bg0, marginTop: sp(3) }}>
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, ((value || 0) / 25) * 100))}%`,
                    height: "100%",
                    background: value >= 18 ? T.green : value >= 10 ? T.amber : T.red,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

const ProfileTable = ({ profile }) => (
  <ChartShell title="Strike Profile Table">
    <div style={{ maxHeight: dim(320), overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: textSize("caption") }}>
        <thead>
          <tr>
            {["Strike", "Net GEX", "Call GEX", "Put GEX", "Call OI", "Put OI"].map((heading) => (
              <th key={heading} style={tableHeaderStyle}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profile.map((row) => (
            <tr key={row.strike}>
              <td style={tableCellStyle}>${row.strike}</td>
              <td style={{ ...tableCellStyle, color: row.netGex >= 0 ? T.green : T.red }}>
                {fmtCurrency(row.netGex)}
              </td>
              <td style={{ ...tableCellStyle, color: T.green }}>{fmtCurrency(row.callGex)}</td>
              <td style={{ ...tableCellStyle, color: T.red }}>{fmtCurrency(row.putGex)}</td>
              <td style={tableCellStyle}>{fmtNumber(row.callOi)}</td>
              <td style={tableCellStyle}>{fmtNumber(row.putOi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </ChartShell>
);

const tableHeaderStyle = {
  padding: sp("5px 7px"),
  color: T.textDim,
  borderBottom: `1px solid ${T.border}`,
  textAlign: "right",
  fontFamily: T.display,
  fontWeight: 700,
};

const tableCellStyle = {
  padding: sp("5px 7px"),
  color: T.textSec,
  borderBottom: `1px solid ${T.border}`,
  textAlign: "right",
  fontFamily: T.sans,
};

export default function GexScreen({ sym = "SPY", isVisible = true, onSelectSymbol }) {
  const initialTicker = normalizeGexTicker(sym);
  const [ticker, setTicker] = useState(initialTicker);
  const [tickerDraft, setTickerDraft] = useState(initialTicker);
  const [series, setSeries] = useState("net");
  const [view, setView] = useState("graph");
  const [expirationFilter, setExpirationFilter] = useState("all");
  const [ivAdjustment, setIvAdjustment] = useState(0);
  const lastCommittedTickerRef = useRef(initialTicker);

  useEffect(() => {
    const normalized = normalizeGexTicker(sym);
    if (!normalized) return;
    if (!isVisible || ticker === lastCommittedTickerRef.current) {
      setTicker(normalized);
      setTickerDraft(normalized);
      lastCommittedTickerRef.current = normalized;
    }
  }, [isVisible, sym, ticker]);

  useEffect(() => {
    setExpirationFilter("all");
  }, [ticker]);

  const commitTicker = () => {
    const nextTicker = normalizeGexTicker(tickerDraft);
    setTicker(nextTicker);
    setTickerDraft(nextTicker);
    lastCommittedTickerRef.current = nextTicker;
    onSelectSymbol?.(nextTicker);
  };

  const gexQuery = useQuery({
    queryKey: ["gex-dashboard", ticker],
    queryFn: ({ signal }) => fetchGexData({ ticker, signal }),
    enabled: Boolean(isVisible && ticker),
    staleTime: 30_000,
    refetchInterval: isVisible ? 60_000 : false,
    refetchOnWindowFocus: false,
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
  const adjustedRows = useMemo(() => {
    if (ivAdjustment === 0) return filteredRows;
    const scale = 1 / Math.max(0.5, 1 + ivAdjustment);
    return filteredRows.map((row) => ({ ...row, gamma: row.gamma * scale }));
  }, [filteredRows, ivAdjustment]);
  const metrics = useMemo(
    () => (spot != null ? aggregateMetrics(adjustedRows, spot) : null),
    [adjustedRows, spot],
  );
  const concentration = useMemo(
    () =>
      spot != null
        ? expConcentration(rows, spot)
        : { zeroDTE: 0, weekly: 0, monthly: 0 },
    [rows, spot],
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

  const loading = gexQuery.isPending;
  const chainError = gexQuery.error;
  const noExpirations = !loading && expirationDates.length === 0;
  const backgroundLoading = gexQuery.isFetching && !gexQuery.isPending;
  const selectedExpirationCount =
    expirationFilter === "all" ? expirationDates.length : adjustedRows.length ? 1 : 0;
  const coverageRatio = pct(
    Math.min(coverage.withGamma, coverage.withOpenInterest),
    coverage.usable,
  );
  const dataReady = Boolean(metrics && spot != null && adjustedRows.length);

  return (
    <div
      data-testid="gex-screen"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: T.bg0,
        color: T.text,
        fontFamily: T.sans,
      }}
    >
      <div
        style={{
          display: "grid",
          gap: sp(10),
          padding: sp(10),
          maxWidth: dim(1680),
          margin: "0 auto",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(10),
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: sp(9) }}>
            <Snowflake size={19} color={T.cyan} />
            <div>
              <div
                style={{
                  fontFamily: T.display,
                  color: T.text,
                  fontSize: fs(18),
                  fontWeight: 700,
                }}
              >
                Gamma Exposure (GEX)
              </div>
              <div style={{ color: T.textDim, fontSize: textSize("caption") }}>
                {ticker} · {selectedExpirationCount || 0} expiration
                {selectedExpirationCount === 1 ? "" : "s"} ·{" "}
                {backgroundLoading ? "refreshing" : "Massive API"}
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(8),
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
                padding: sp("0 8px"),
                ...fieldStyle,
              }}
            >
              <Search size={14} color={T.textDim} />
              <input
                value={tickerDraft}
                onChange={(event) => setTickerDraft(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitTicker();
                }}
                onBlur={commitTicker}
                aria-label="GEX ticker"
                style={{
                  width: dim(82),
                  border: 0,
                  outline: 0,
                  background: "transparent",
                  color: T.text,
                  fontFamily: T.display,
                  fontWeight: 700,
                  fontSize: textSize("bodyStrong"),
                }}
              />
            </div>
            <select
              value={expirationFilter}
              onChange={(event) => setExpirationFilter(event.target.value)}
              style={{
                ...fieldStyle,
                minWidth: dim(156),
                padding: sp("0 8px"),
              }}
            >
              <option value="all">All loaded expirations</option>
              {expirationDates.map((date) => (
                <option key={date} value={date}>
                  {date}
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
          </div>
        </header>

        <Card
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
            gap: sp(10),
          }}
        >
          <div>
            <div style={{ color: T.textDim, fontSize: textSize("caption") }}>Spot</div>
            <div style={{ color: T.text, fontSize: fs(24), fontWeight: 700 }}>
              {fmtPrice(spot)}
            </div>
            <div
              style={{
                color:
                  quoteChange == null ? T.textDim : quoteChange >= 0 ? T.green : T.red,
                fontSize: textSize("caption"),
              }}
            >
              {quoteChange == null ? "----" : fmtCurrency(quoteChange)}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: sp(6),
            }}
          >
            <ConcentrationTile label="0DTE Exp" value={concentration.zeroDTE} color={T.amber} />
            <ConcentrationTile label="Weekly Exp" value={concentration.weekly} color={T.cyan} />
            <ConcentrationTile label="Monthly Exp" value={concentration.monthly} color={T.purple} />
          </div>
          <TickerMetaSummary data={gexData} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: sp(6), color: T.textSec }}>
              <SlidersHorizontal size={14} />
              <span style={{ fontSize: textSize("caption") }}>IV simulation</span>
              <span style={{ marginLeft: "auto", color: T.amber, fontWeight: 700 }}>
                {ivAdjustment >= 0 ? "+" : ""}
                {(ivAdjustment * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min={-50}
              max={50}
              step={1}
              value={ivAdjustment * 100}
              onChange={(event) => setIvAdjustment(Number(event.target.value) / 100)}
              style={{ width: "100%", accentColor: T.accent, marginTop: sp(8) }}
            />
            <div style={{ color: T.textDim, fontSize: textSize("caption") }}>
              Coverage {Math.round(coverageRatio * 100)}% · {coverage.usable} contracts
            </div>
          </div>
        </Card>

        {chainError ? (
          <DataUnavailableState
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
            detail="Waiting for quote, expiration, and option-chain metadata."
          />
        ) : spot == null ? (
          <DataUnavailableState
            title={`Spot unavailable for ${ticker}`}
            detail="GEX needs a current underlying price before it can scale gamma exposure."
          />
        ) : !adjustedRows.length ? (
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
              <MetricTile label="Net GEX" value={fmtCurrency(metrics.netGex)} sub={`Ratio ${Number.isFinite(metrics.ratio) ? metrics.ratio.toFixed(2) : "----"}`} color={metrics.netGex >= 0 ? T.green : T.red} />
              <MetricTile label="Call GEX" value={fmtCurrency(metrics.callGex)} sub={`${fmtNumber(metrics.callOi)} OI`} color={T.green} />
              <MetricTile label="Put GEX" value={fmtCurrency(metrics.putGex)} sub={`${fmtNumber(metrics.putOi)} OI`} color={T.red} />
              <MetricTile label="Total GEX" value={fmtCurrency(metrics.totalGex)} sub={`${fmtNumber(metrics.callOi + metrics.putOi)} OI`} color={T.cyan} />
              <MetricTile label="Call Wall" value={fmtPrice(metrics.callWall)} sub={fmtPercent((metrics.callWall - spot) / spot)} color={T.green} />
              <MetricTile label="Put Wall" value={fmtPrice(metrics.putWall)} sub={fmtPercent((metrics.putWall - spot) / spot)} color={T.red} />
              <MetricTile label="Zero Gamma" value={fmtPrice(metrics.zeroGamma)} sub={metrics.zeroGamma ? fmtPercent((metrics.zeroGamma - spot) / spot) : "----"} color={T.cyan} />
            </Card>

            {coverageRatio < 0.5 ? (
              <DataUnavailableState
                title="Greek/OI coverage is partial"
                detail={`${coverage.withGamma}/${coverage.usable} contracts have gamma and ${coverage.withOpenInterest}/${coverage.usable} have open interest. Charts render from available fields.`}
              />
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
                gap: sp(10),
                alignItems: "start",
              }}
            >
              <div style={{ display: "grid", gap: sp(10), minWidth: 0 }}>
                {view === "graph" ? (
                  <StrikeProfileChart
                    profile={metrics.profile}
                    spot={spot}
                    series={series}
                    callWall={metrics.callWall}
                    putWall={metrics.putWall}
                  />
                ) : (
                  <ProfileTable profile={metrics.profile} />
                )}
                <HeatmapCard rows={adjustedRows} spot={spot} />
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
                    gap: sp(10),
                  }}
                >
                  <ExpiryChart rows={adjustedRows} spot={spot} />
                  <GammaPriceChart rows={adjustedRows} spot={spot} />
                </div>
                <SectionHeading title="Open Interest Analysis" />
                <OiChart rows={adjustedRows} spot={spot} />
              </div>
              <div style={{ display: "grid", gap: sp(10), minWidth: 0 }}>
                <IntradayCard snapshots={snapshots} />
                <SignalsCard signals={signals} />
                <SqueezeCard squeeze={squeeze} source={gexData?.source} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const ConcentrationTile = ({ label, value, color }) => (
  <div style={{ background: T.bg0, border: `1px solid ${T.border}`, padding: sp(8) }}>
    <div style={{ color: T.textDim, fontSize: textSize("caption") }}>{label}</div>
    <div style={{ color, fontSize: fs(17), fontWeight: 700 }}>
      {(value * 100).toFixed(1)}%
    </div>
  </div>
);

const IntradayCard = ({ snapshots }) => {
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const delta = snapshots.length >= 2 && first && last ? last.netGex - first.netGex : null;
  return (
    <Card noPad>
      <SectionTitle>Intraday ΔGEX</SectionTitle>
      <div style={{ padding: sp(10), display: "grid", gap: sp(6) }}>
        <div
          style={{
            color: delta == null ? T.textDim : delta >= 0 ? T.green : T.red,
            fontSize: fs(20),
            fontWeight: 700,
          }}
        >
          {delta == null ? "----" : `${delta >= 0 ? "+" : ""}${fmtCurrency(delta)}`}
        </div>
        <div style={{ color: T.textDim, fontSize: textSize("caption") }}>
          {snapshots.length} API snapshot{snapshots.length === 1 ? "" : "s"}
        </div>
      </div>
    </Card>
  );
};
