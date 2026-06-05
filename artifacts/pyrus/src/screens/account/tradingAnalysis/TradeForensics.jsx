import {
  useMemo,
} from "react";
import { useGetBars } from "@workspace/api-client-react";
import {
  BARS_REQUEST_PRIORITY,
  buildBarsRequestOptions,
} from "../../../features/platform/queryDefaults";
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import { formatAppDate, formatAppDateTime } from "../../../lib/timeZone";
import {
  formatAccountMoney,
  formatAccountPrice,
  mutedLabelStyle,
} from "../accountUtils";

const TRADE_CHART_HEIGHT = 110;

const pickBarsTimeframe = (holdMinutes) => {
  const minutes = Number(holdMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return "1h";
  if (minutes < 240) return "5m";
  if (minutes < 5 * 24 * 60) return "15m";
  if (minutes < 30 * 24 * 60) return "1h";
  return "1d";
};

export const TradePriceChart = ({ trade, currency, maskValues }) => {
  const symbol = String(trade?.symbol || "").trim();
  const rawOpenMs = trade?.openDate ? new Date(trade.openDate).getTime() : NaN;
  const rawCloseMs = trade?.closeDate ? new Date(trade.closeDate).getTime() : NaN;
  const holdMinutes = Number(trade?.holdDurationMinutes);
  let openMs = rawOpenMs;
  let closeMs = rawCloseMs;
  if (!Number.isFinite(openMs) && Number.isFinite(closeMs) && Number.isFinite(holdMinutes) && holdMinutes > 0) {
    openMs = closeMs - holdMinutes * 60_000;
  } else if (!Number.isFinite(closeMs) && Number.isFinite(openMs) && Number.isFinite(holdMinutes) && holdMinutes > 0) {
    closeMs = openMs + holdMinutes * 60_000;
  }
  const hasWindow = Number.isFinite(openMs) && Number.isFinite(closeMs) && closeMs > openMs;
  const timeframe = pickBarsTimeframe(holdMinutes);
  const padding = hasWindow ? Math.max(60_000, (closeMs - openMs) * 0.1) : 0;
  const enabled = Boolean(symbol && hasWindow);
  const barsQuery = useGetBars(
    enabled
      ? {
          symbol,
          timeframe,
          from: new Date(openMs - padding).toISOString(),
          to: new Date(closeMs + padding).toISOString(),
          limit: 500,
        }
      : { symbol: "", timeframe: "1m" },
    {
      query: {
        enabled,
        staleTime: 60_000,
        retry: false,
      },
      request: buildBarsRequestOptions(
        BARS_REQUEST_PRIORITY.active,
        "account-trade-forensics",
      ),
    },
  );
  const bars = useMemo(() => {
    if (!enabled) return [];
    return (barsQuery.data?.bars || [])
      .map((bar) => {
        const ts = bar?.timestamp ? new Date(bar.timestamp).getTime() : NaN;
        const close = Number(bar?.close);
        if (!Number.isFinite(ts) || !Number.isFinite(close)) return null;
        return { ts, close };
      })
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts);
  }, [enabled, barsQuery.data]);

  if (!enabled) {
    return <UnavailableForensicsMessage>Trade window unavailable — open or close timestamp missing.</UnavailableForensicsMessage>;
  }
  if (!barsQuery.isLoading && bars.length < 2) {
    return <UnavailableForensicsMessage>Bars unavailable for {symbol} during this trade window.</UnavailableForensicsMessage>;
  }

  const width = 600;
  const height = TRADE_CHART_HEIGHT;
  const padL = 40;
  const padR = 8;
  const padT = 6;
  const padB = 14;
  if (barsQuery.isLoading || !bars.length) {
    return (
      <div
        style={{
          height: dim(height),
          border: "none",
          borderRadius: dim(RADII.xs),
          background: CSS_COLOR.bg0,
          color: CSS_COLOR.textMuted,
          display: "grid",
          placeItems: "center",
          fontFamily: T.sans,
          fontSize: textSize("caption"),
        }}
      >
        Loading bars...
      </div>
    );
  }

  const tMin = Math.min(bars[0].ts, openMs);
  const tMax = Math.max(bars[bars.length - 1].ts, closeMs);
  const span = tMax - tMin || 1;
  const closes = bars.map((bar) => bar.close);
  const referencePrices = [Number(trade?.avgOpen), Number(trade?.avgClose)].filter(Number.isFinite);
  const yMin = Math.min(...closes, ...referencePrices);
  const yMax = Math.max(...closes, ...referencePrices);
  const yPad = (yMax - yMin) * 0.06 || 1;
  const yLow = yMin - yPad;
  const yHigh = yMax + yPad;
  const yRange = yHigh - yLow || 1;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const xFor = (ts) => padL + ((ts - tMin) / span) * chartW;
  const yFor = (value) => padT + chartH - ((value - yLow) / yRange) * chartH;
  const pathPoints = bars
    .map((bar) => ({
      x: xFor(bar.ts),
      y: yFor(bar.close),
      close: bar.close,
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.close));
  if (pathPoints.length < 2) {
    return <UnavailableForensicsMessage>Bars unavailable for {symbol} during this trade window.</UnavailableForensicsMessage>;
  }

  const linePath = pathPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
  const lastClose = pathPoints[pathPoints.length - 1].close;
  const firstClose = pathPoints[0].close;
  const tradeShortSide = /short|sell/i.test(trade?.side || "");
  const lineTone = tradeShortSide
    ? lastClose <= firstClose
      ? CSS_COLOR.green
      : CSS_COLOR.red
    : lastClose >= firstClose
      ? CSS_COLOR.green
      : CSS_COLOR.red;
  const areaPath = `${linePath} L${pathPoints[pathPoints.length - 1].x.toFixed(1)},${(padT + chartH).toFixed(1)} L${padL},${(padT + chartH).toFixed(1)} Z`;
  const entryPx = Number(trade?.avgOpen);
  const exitPx = Number(trade?.avgClose);
  const entryX = xFor(openMs);
  const exitX = xFor(closeMs);
  const gradientId = `tradeChartGrad-${symbol.replace(/[^a-z0-9_-]/gi, "_") || "trade"}`;

  return (
    <div style={{ display: "grid", gap: sp(2) }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: sp(4),
        }}
      >
        <div style={mutedLabelStyle}>
          {symbol} · {timeframe} BARS
        </div>
        <div style={{ fontSize: textSize("body"), fontFamily: T.data, color: CSS_COLOR.textDim }}>
          {bars.length} bars
        </div>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={lineTone} stopOpacity={0.18} />
            <stop offset="100%" stopColor={lineTone} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} stroke={lineTone} strokeWidth={1.2} fill="none" />
        {Number.isFinite(entryPx) ? (
          <TradeMarker
            label="ENTRY"
            x={entryX}
            y={yFor(entryPx)}
            lineTop={padT}
            lineBottom={padT + chartH}
            color={CSS_COLOR.green}
            title={`Entry · ${formatAccountPrice(entryPx, 2, maskValues)} · ${formatAppDateTime(openMs)}`}
          />
        ) : null}
        {Number.isFinite(exitPx) ? (
          <TradeMarker
            label="EXIT"
            x={exitX}
            y={yFor(exitPx)}
            lineTop={padT}
            lineBottom={padT + chartH}
            color={CSS_COLOR.red}
            title={`Exit · ${formatAccountPrice(exitPx, 2, maskValues)} · ${formatAppDateTime(closeMs)}`}
            align="end"
          />
        ) : null}
        <AxisLabel x={padL} y={padT + chartH + 11}>
          {formatAppDate(tMin)}
        </AxisLabel>
        <AxisLabel x={width - padR} y={padT + chartH + 11} anchor="end">
          {formatAppDate(tMax)}
        </AxisLabel>
        <AxisLabel x={padL - 4} y={padT + 4} anchor="end">
          {formatAccountPrice(yHigh, 2, maskValues)}
        </AxisLabel>
        <AxisLabel x={padL - 4} y={padT + chartH} anchor="end">
          {formatAccountPrice(yLow, 2, maskValues)}
        </AxisLabel>
      </svg>
    </div>
  );
};

const UnavailableForensicsMessage = ({ children }) => (
  <div
    style={{
      border: `1px dashed ${CSS_COLOR.border}`,
      borderRadius: dim(RADII.xs),
      background: CSS_COLOR.bg0,
      color: CSS_COLOR.textMuted,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      padding: sp("6px 8px"),
      textAlign: "center",
    }}
  >
    {children}
  </div>
);

const AxisLabel = ({ x, y, anchor = "start", children }) => (
  <text
    x={x}
    y={y}
    fill={CSS_COLOR.textMuted}
    fontFamily={T.data}
    fontSize={9}
    textAnchor={anchor}
  >
    {children}
  </text>
);

const TradeMarker = ({
  label,
  x,
  y,
  lineTop,
  lineBottom,
  color,
  title,
  align = "start",
}) => (
  <g>
    <title>{title}</title>
    <line
      x1={x}
      x2={x}
      y1={lineTop}
      y2={lineBottom}
      stroke={color}
      strokeWidth={0.6}
      strokeDasharray="2 2"
      opacity={0.6}
    />
    <circle cx={x} cy={y} r={4} fill={color} stroke={CSS_COLOR.bg1} strokeWidth={1} />
    <text
      x={align === "end" ? x - 4 : x + 4}
      y={y - 6}
      fill={color}
      fontFamily={T.data}
      fontSize={9}
      fontWeight={400}
      textAnchor={align}
    >
      {label}
    </text>
  </g>
);

const lifecycleToneColor = (tone) =>
  tone === "green" ? CSS_COLOR.green : tone === "red" ? CSS_COLOR.red : CSS_COLOR.cyan;

export const LifecycleTimeline = ({ rows = [], currency, maskValues }) => {
  if (!rows.length) return null;
  const priceEventKeys = new Set(["entry", "order", "exit"]);
  const formatLifecycleValue = (row, compact = false) => {
    if (row?.value == null) return null;
    if (typeof row.value !== "number") return row.value;
    return priceEventKeys.has(row.key)
      ? formatAccountPrice(row.value, 2, maskValues)
      : formatAccountMoney(row.value, currency, compact, maskValues);
  };
  const events = rows
    .map((row) => {
      const ts = row?.at ? new Date(row.at).getTime() : NaN;
      return Number.isFinite(ts) ? { ...row, ts } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
  const tSpan =
    events.length >= 2 ? events[events.length - 1].ts - events[0].ts : 0;
  if (events.length < 2 || tSpan < 60_000) {
    return (
      <div style={{ display: "grid", gap: sp(3) }}>
        <div style={mutedLabelStyle}>TRADE LIFECYCLE</div>
        {rows.map((row) => (
          <div
            key={row.key}
            style={{
              display: "grid",
              gridTemplateColumns: "auto minmax(0, 1fr) auto",
              gap: sp(5),
              border: "none",
              borderRadius: dim(RADII.xs),
              background: CSS_COLOR.bg0,
              padding: sp("4px 5px"),
              alignItems: "center",
              fontFamily: T.sans,
              fontSize: textSize("body"),
            }}
          >
            <span style={{ color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.regular }}>{row.label}</span>
            <span style={{ color: CSS_COLOR.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.detail}
            </span>
            <span style={{ color: lifecycleToneColor(row.tone), fontFamily: T.data, fontWeight: FONT_WEIGHTS.regular }}>
              {row.value == null
                ? row.at
                  ? formatAppDate(row.at)
                  : ""
                : formatLifecycleValue(row, true)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const tMin = events[0].ts;
  const tMax = events[events.length - 1].ts;
  const width = 600;
  const height = 64;
  const padX = 40;
  const padTop = 16;
  const padBottom = 18;
  const trackY = padTop + (height - padTop - padBottom) / 2;
  const xFor = (ts) => padX + ((ts - tMin) / (tMax - tMin)) * (width - padX * 2);
  const placements = events.map((event, index) => {
    const baseX = xFor(event.ts);
    let stack = 0;
    for (let i = 0; i < index; i += 1) {
      if (Math.abs(xFor(events[i].ts) - baseX) < 16) stack += 1;
    }
    return { ...event, x: baseX, stack };
  });

  return (
    <div style={{ display: "grid", gap: sp(3) }}>
      <div style={mutedLabelStyle}>TRADE LIFECYCLE</div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <line
          x1={padX}
          x2={width - padX}
          y1={trackY}
          y2={trackY}
          stroke={CSS_COLOR.border}
          strokeWidth={1}
        />
        <AxisLabel x={padX} y={height - 4}>
          {formatAppDate(events[0].ts)}
        </AxisLabel>
        <AxisLabel x={width - padX} y={height - 4} anchor="end">
          {formatAppDate(events[events.length - 1].ts)}
        </AxisLabel>
        {placements.map((event) => {
          const color = lifecycleToneColor(event.tone);
          const cy = trackY - event.stack * 10;
          return (
            <g key={event.key}>
              <title>
                {`${event.label} · ${event.detail}${
                  event.value == null
                    ? ""
                    : ` · ${formatLifecycleValue(event, true)}`
                } · ${formatAppDateTime(event.ts)}`}
              </title>
              <line
                x1={event.x}
                x2={event.x}
                y1={cy}
                y2={trackY}
                stroke={color}
                strokeWidth={0.6}
                opacity={0.6}
              />
              <circle cx={event.x} cy={cy} r={4} fill={color} stroke={CSS_COLOR.bg1} strokeWidth={1} />
              <text
                x={event.x}
                y={cy - 7}
                fill={color}
                fontFamily={T.data}
                fontSize={9}
                fontWeight={400}
                textAnchor="middle"
              >
                {event.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
