import { useMemo } from "react";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  EmptyState,
  Panel,
  formatAccountSignedMoney,
} from "./accountUtils";

const SVG_W = 320;
const SVG_H = 74;
const PAD = { l: 4, r: 4, t: 6, b: 6 };
const MARKET_TIME_ZONE = "America/New_York";
const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;
const marketTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const timestampMsForPoint = (point) => {
  const timestampMs = finite(point?.timestampMs);
  if (timestampMs != null) return timestampMs;
  if (!point?.timestamp) return null;
  const parsed = Date.parse(point.timestamp);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildIntradaySeries = (queryData) => {
  const rawPoints = Array.isArray(queryData?.series)
    ? queryData.series
    : Array.isArray(queryData?.points)
      ? queryData.points
      : [];
  let baselineNav = null;
  const points = rawPoints
    .map((point) => {
      const ts = timestampMsForPoint(point);
      const nav = finite(point?.netLiquidation);
      if (baselineNav == null && nav != null) baselineNav = nav;
      const pnl =
        finite(point?.cumulativePnl) ??
        (nav != null && baselineNav != null ? nav - baselineNav : null);
      if (ts == null || pnl == null) return null;
      return { timestampMs: ts, pnl };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  return points;
};

export const formatIntradayMarketTime = (timestampMs) => {
  if (!Number.isFinite(timestampMs)) return "";
  return marketTimeFormatter.format(new Date(timestampMs));
};

const marketMinutes = (timestampMs) => {
  if (!Number.isFinite(timestampMs)) return null;
  const parts = marketTimeFormatter.formatToParts(new Date(timestampMs));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
};

export const intradayMarketSessionPctElapsed = (timestampMs) => {
  const minutes = marketMinutes(timestampMs);
  if (minutes == null) return 0;
  const total = MARKET_CLOSE_MINUTES - MARKET_OPEN_MINUTES;
  const elapsed = Math.max(0, Math.min(total, minutes - MARKET_OPEN_MINUTES));
  return (elapsed / total) * 100;
};

export const IntradayPnlPanel = ({
  query,
  currency = "USD",
  maskValues = false,
}) => {
  const series = useMemo(() => buildIntradaySeries(query?.data), [query?.data]);

  const stats = useMemo(() => {
    if (!series.length) return null;
    let high = -Infinity;
    let low = Infinity;
    series.forEach((point) => {
      if (point.pnl > high) high = point.pnl;
      if (point.pnl < low) low = point.pnl;
    });
    const last = series[series.length - 1];
    return { high, low, last };
  }, [series]);

  const chart = useMemo(() => {
    if (series.length < 2 || !stats) return null;
    const max = Math.max(stats.high, 0);
    const min = Math.min(stats.low, 0);
    const range = max - min || 1;
    const chartW = SVG_W - PAD.l - PAD.r;
    const chartH = SVG_H - PAD.t - PAD.b;
    const xFor = (i) => PAD.l + (i / (series.length - 1)) * chartW;
    const yFor = (v) => PAD.t + chartH - ((v - min) / range) * chartH;
    const zeroY = yFor(0);
    const path = series
      .map((point, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(point.pnl).toFixed(1)}`)
      .join(" ");
    const areaPath = `${path} L${xFor(series.length - 1).toFixed(1)},${zeroY.toFixed(1)} L${PAD.l},${zeroY.toFixed(1)} Z`;
    return { path, areaPath, zeroY, xFor, yFor };
  }, [series, stats]);

  const positive = stats ? stats.last.pnl >= 0 : true;
  const lineColor = positive ? "var(--ra-pnl-positive)" : "var(--ra-pnl-negative)";
  const sessionPctElapsed = (() => {
    if (!stats) return 0;
    return intradayMarketSessionPctElapsed(stats.last.timestampMs);
  })();

  return (
    <Panel
      title="Intraday P&L"
      rightRail={
        stats ? (
          <span style={{ fontSize: fs(9), fontFamily: T.sans, color: T.textDim }}>
            {formatIntradayMarketTime(stats.last.timestampMs)} ET
          </span>
        ) : null
      }
      loading={query?.isLoading}
      error={query?.error}
      onRetry={query?.refetch}
      minHeight={170}
    >
      {!stats ? (
        <EmptyState
          title="Intraday P&L unavailable"
          body="Today's session P&L appears once balance snapshots stream in."
        />
      ) : (
        <div style={{ display: "grid", gap: sp(3) }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: sp(6) }}>
            <span
              style={{
                fontSize: fs(17),
                fontWeight: 400,
                fontFamily: T.sans,
                color: lineColor,
                letterSpacing: 0,
              }}
            >
              {formatAccountSignedMoney(stats.last.pnl, currency, false, maskValues)}
            </span>
          </div>
          <svg
            width="100%"
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            preserveAspectRatio="none"
            style={{ display: "block" }}
          >
            {chart ? (
              <>
                <defs>
                  <linearGradient
                    id="intradayPnlGradPos"
                    x1="0"
                    y1={chart.zeroY}
                    x2="0"
                    y2={PAD.t}
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" stopColor="var(--ra-pnl-positive)" stopOpacity="0" />
                    <stop offset="100%" stopColor="var(--ra-pnl-positive)" stopOpacity="0.35" />
                  </linearGradient>
                  <linearGradient
                    id="intradayPnlGradNeg"
                    x1="0"
                    y1={chart.zeroY}
                    x2="0"
                    y2={SVG_H - PAD.b}
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" stopColor="var(--ra-pnl-negative)" stopOpacity="0" />
                    <stop offset="100%" stopColor="var(--ra-pnl-negative)" stopOpacity="0.35" />
                  </linearGradient>
                </defs>
                <line
                  x1={PAD.l}
                  y1={chart.zeroY}
                  x2={SVG_W - PAD.r}
                  y2={chart.zeroY}
                  stroke={T.border}
                  strokeWidth={0.5}
                  strokeDasharray="2 2"
                />
                <path
                  d={chart.areaPath}
                  fill={positive ? "url(#intradayPnlGradPos)" : "url(#intradayPnlGradNeg)"}
                />
                <path d={chart.path} stroke={lineColor} strokeWidth={1.4} fill="none" />
                <circle
                  cx={chart.xFor(series.length - 1)}
                  cy={chart.yFor(stats.last.pnl)}
                  r={3}
                  fill={lineColor}
                  stroke={T.bg1}
                  strokeWidth={1}
                />
              </>
            ) : (
              <text
                x={SVG_W / 2}
                y={SVG_H / 2 + 4}
                textAnchor="middle"
                fontSize={10}
                fontFamily={T.mono}
                fill={T.textMuted}
              >
                Awaiting more samples
              </text>
            )}
          </svg>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: fs(9),
              fontFamily: T.sans,
            }}
          >
            <span style={{ color: T.textMuted }}>
              HIGH{" "}
              <span style={{ color: "var(--ra-pnl-positive)", fontWeight: 400 }}>
                {formatAccountSignedMoney(stats.high, currency, false, maskValues)}
              </span>
            </span>
            <span style={{ color: T.textMuted }}>
              SAMPLES{" "}
              <span style={{ color: T.text, fontWeight: 400 }}>{series.length}</span>
            </span>
            <span style={{ color: T.textMuted }}>
              LOW{" "}
              <span style={{ color: "var(--ra-pnl-negative)", fontWeight: 400 }}>
                {formatAccountSignedMoney(stats.low, currency, false, maskValues)}
              </span>
            </span>
          </div>
          <div
            style={{
              height: dim(3),
              background: T.bg3,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${sessionPctElapsed}%`,
                height: "100%",
                background: T.accent,
                opacity: 0.7,
              }}
            />
          </div>
        </div>
      )}
    </Panel>
  );
};

export default IntradayPnlPanel;
