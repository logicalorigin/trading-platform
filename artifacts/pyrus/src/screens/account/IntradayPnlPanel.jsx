import {
  useMemo,
} from "react";
import { resolveUsEquityMarketStatus } from "@workspace/market-calendar";
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { EmptyState, formatAccountSignedMoney } from "./accountUtils";

const SVG_W = 320;
const SVG_H = 74;
const PAD = { l: 4, r: 4, t: 6, b: 6 };
const MARKET_TIME_ZONE = "America/New_York";
const marketTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const marketDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MARKET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const finite = (value) => {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
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

export const buildIntradaySeries = (queryData, marketCalendar = "nyse") => {
  const rawPoints = Array.isArray(queryData?.series)
    ? queryData.series
    : Array.isArray(queryData?.points)
      ? queryData.points
      : [];
  let baselineNav = null;
  const normalizedPoints = rawPoints
    .map((point) => {
      const ts = timestampMsForPoint(point);
      const nav = finite(point?.netLiquidation);
      if (ts == null || nav == null) return null;
      if (marketCalendar !== "continuous") {
        const marketStatus = resolveUsEquityMarketStatus(ts);
        const regularCloseMs = Date.parse(
          marketStatus.calendarDay?.regularCloseAt ?? "",
        );
        const isRegularSessionPoint =
          marketStatus.session.key === "rth" || regularCloseMs === ts;
        if (!isRegularSessionPoint) return null;
      }
      return {
        point,
        timestampMs: ts,
        marketDate: marketDateFormatter.format(new Date(ts)),
        nav,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const latestMarketDate = normalizedPoints[normalizedPoints.length - 1]?.marketDate;
  const sessionPoints = latestMarketDate
    ? normalizedPoints.filter((point) => point.marketDate === latestMarketDate)
    : normalizedPoints;
  const points = sessionPoints
    .map(({ point, timestampMs, nav }) => {
      if (baselineNav == null) baselineNav = nav;
      const pnl =
        finite(point?.cumulativePnl) ??
        (baselineNav != null ? nav - baselineNav : null);
      if (pnl == null) return null;
      return { timestampMs, pnl };
    })
    .filter(Boolean);
  return points;
};

export const formatIntradayMarketTime = (timestampMs) => {
  if (!Number.isFinite(timestampMs)) return "";
  return marketTimeFormatter.format(new Date(timestampMs));
};

export const intradayMarketSessionPctElapsed = (
  timestampMs,
  marketCalendar = "nyse",
) => {
  if (!Number.isFinite(timestampMs)) return 0;
  if (marketCalendar === "continuous") {
    const parts = marketTimeFormatter.formatToParts(new Date(timestampMs));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute)
      ? ((hour * 60 + minute) / 1_440) * 100
      : 0;
  }
  const { calendarDay } = resolveUsEquityMarketStatus(timestampMs);
  const openMs = Date.parse(calendarDay?.regularOpenAt ?? "");
  const closeMs = Date.parse(calendarDay?.regularCloseAt ?? "");
  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) || closeMs <= openMs) {
    return 0;
  }
  const elapsed = Math.max(0, Math.min(closeMs - openMs, timestampMs - openMs));
  return (elapsed / (closeMs - openMs)) * 100;
};

export const IntradayPnlContent = ({
  query,
  currency = "USD",
  maskValues = false,
  marketCalendar = "nyse",
}) => {
  const series = useMemo(
    () => buildIntradaySeries(query?.data, marketCalendar),
    [marketCalendar, query?.data],
  );

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
    return intradayMarketSessionPctElapsed(
      stats.last.timestampMs,
      marketCalendar,
    );
  })();

  if (!stats) {
    return (
      <EmptyState
        title="Intraday P&L unavailable"
        body="Today's session P&L appears once balance snapshots stream in."
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: sp(3) }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: sp(6) }}>
        <span
          style={{
            fontSize: fs(17),
            fontWeight: FONT_WEIGHTS.regular,
            fontFamily: T.sans,
            color: lineColor,
            letterSpacing: 0,
          }}
        >
          {formatAccountSignedMoney(stats.last.pnl, currency, false, maskValues)}
        </span>
        <span style={{ fontSize: textSize("caption"), fontFamily: T.sans, color: CSS_COLOR.textDim }}>
          {formatIntradayMarketTime(stats.last.timestampMs)} ET
        </span>
      </div>
      <svg
        aria-label={`Intraday account P&L chart with ${series.length} ${
          marketCalendar === "continuous" ? "continuous-market" : "regular-session"
        } samples`}
        role="img"
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
              stroke={CSS_COLOR.border}
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
              stroke={CSS_COLOR.bg1}
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
            fill={CSS_COLOR.textMuted}
          >
            Awaiting more samples
          </text>
        )}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: textSize("caption"),
          fontFamily: T.sans,
        }}
      >
        <span style={{ color: CSS_COLOR.textMuted }}>
          HIGH{" "}
          <span style={{ color: "var(--ra-pnl-positive)", fontWeight: FONT_WEIGHTS.regular }}>
            {formatAccountSignedMoney(stats.high, currency, false, maskValues)}
          </span>
        </span>
        <span style={{ color: CSS_COLOR.textMuted }}>
          SAMPLES{" "}
          <span style={{ color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.regular }}>{series.length}</span>
        </span>
        <span style={{ color: CSS_COLOR.textMuted }}>
          LOW{" "}
          <span style={{ color: "var(--ra-pnl-negative)", fontWeight: FONT_WEIGHTS.regular }}>
            {formatAccountSignedMoney(stats.low, currency, false, maskValues)}
          </span>
        </span>
      </div>
      <div
        style={{
          height: dim(3),
          background: CSS_COLOR.bg1,
          borderRadius: dim(RADII.pill),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${sessionPctElapsed}%`,
            height: "100%",
            background: CSS_COLOR.accent,
            opacity: 0.7,
          }}
        />
      </div>
    </div>
  );
};

export default IntradayPnlContent;
