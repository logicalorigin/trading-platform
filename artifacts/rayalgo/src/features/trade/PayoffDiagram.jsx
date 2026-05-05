import { isFiniteNumber } from "../../lib/formatters";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens";

export const PayoffDiagram = ({
  optType,
  strike,
  premium,
  qty,
  currentPrice,
  side,
}) => {
  const isCall = optType === "C";
  const isLong = side === "BUY";
  const debit = premium * qty * 100;
  const resolvedCurrentPrice = isFiniteNumber(currentPrice)
    ? currentPrice
    : isFiniteNumber(strike)
      ? strike
      : 1;

  // P&L at expiration for any underlying price S
  const pnl = (S) => {
    const intrinsic = isCall
      ? Math.max(0, S - strike)
      : Math.max(0, strike - S);
    const longPnl = (intrinsic - premium) * qty * 100;
    return isLong ? longPnl : -longPnl;
  };

  // X range: 25% above and below current price gives enough room for visible breakeven
  const xMin = resolvedCurrentPrice * 0.75;
  const xMax = resolvedCurrentPrice * 1.25;
  const STEPS = 80;
  const points = [];
  for (let i = 0; i <= STEPS; i++) {
    const S = xMin + (xMax - xMin) * (i / STEPS);
    points.push({ s: S, p: pnl(S) });
  }

  // Y range
  const yMax = Math.max(...points.map((p) => p.p));
  const yMin = Math.min(...points.map((p) => p.p));
  const yRange = Math.max(yMax - yMin, 1);
  const yPad = yRange * 0.18;
  const yTop = yMax + yPad;
  const yBot = yMin - yPad;

  // Breakeven price
  const breakeven = isCall ? strike + premium : strike - premium;

  // Determine if max profit/loss is theoretically capped or unlimited
  // BUY CALL: max loss = debit (capped), max profit = ∞
  // BUY PUT:  max loss = debit (capped), max profit = (strike - prem) * qty * 100 (capped)
  // SELL CALL: max profit = credit (capped), max loss = ∞
  // SELL PUT:  max profit = credit (capped), max loss = (strike - prem) * qty * 100 (capped)
  const maxProfitUnlimited =
    (isLong && isCall) || (!isLong && !isCall && false); // selling put has capped loss but profit is the credit
  const maxLossUnlimited = !isLong && isCall; // selling naked call

  const visibleMaxProfit = Math.max(...points.map((p) => p.p));
  const visibleMaxLoss = Math.min(...points.map((p) => p.p));

  // SVG dimensions
  const W = 280,
    H = 120;
  const padL = 6,
    padR = 6,
    padT = 18,
    padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xOf = (s) => padL + ((s - xMin) / (xMax - xMin)) * innerW;
  const yOf = (p) => padT + ((yTop - p) / (yTop - yBot)) * innerH;
  const y0 = yOf(0);

  // Split curve into segments at zero crossings, color each by sign
  const segments = [];
  let currentSeg = [];
  let currentSign = null;
  points.forEach((p) => {
    const sign = p.p >= 0 ? "+" : "-";
    if (currentSign === null) {
      currentSign = sign;
      currentSeg.push(p);
    } else if (sign === currentSign) {
      currentSeg.push(p);
    } else {
      const prev = currentSeg[currentSeg.length - 1];
      // Linear interpolation to find zero crossing
      const t = -prev.p / (p.p - prev.p);
      const crossX = prev.s + t * (p.s - prev.s);
      const crossPoint = { s: crossX, p: 0 };
      currentSeg.push(crossPoint);
      segments.push({ sign: currentSign, points: currentSeg });
      currentSeg = [crossPoint, p];
      currentSign = sign;
    }
  });
  if (currentSeg.length > 0)
    segments.push({ sign: currentSign, points: currentSeg });

  // Tick prices for the x-axis: just current and strike (those are the anchors that matter)
  const fmtMoney = (v) =>
    v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`;

  return (
    <div style={{ background: T.bg3, borderRadius: dim(3), padding: sp(4) }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: sp("0 4px 2px"),
          fontSize: fs(7),
          fontFamily: T.mono,
          color: T.textMuted,
          letterSpacing: "0.06em",
        }}
      >
        <span>P&L AT EXPIRATION</span>
        <span style={{ display: "flex", gap: sp(6) }}>
          <span>
            <span style={{ color: T.accent }}>━</span> now $
            {isFiniteNumber(currentPrice)
              ? currentPrice.toFixed(2)
              : MISSING_VALUE}
          </span>
          <span>
            <span style={{ color: T.amber }}>┃</span> strike ${strike}
          </span>
        </span>
      </div>
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
      >
        {/* Zero P&L line */}
        <line
          x1={padL}
          x2={padL + innerW}
          y1={y0}
          y2={y0}
          stroke={T.textMuted}
          strokeWidth={0.5}
          strokeDasharray="2 2"
          opacity={0.5}
        />

        {/* Filled areas under each segment */}
        {segments.map((seg, i) => {
          if (seg.points.length < 2) return null;
          const fillColor = seg.sign === "+" ? T.green : T.red;
          const linePath = seg.points
            .map((p) => `${xOf(p.s).toFixed(1)},${yOf(p.p).toFixed(1)}`)
            .join(" L ");
          const firstX = xOf(seg.points[0].s).toFixed(1);
          const lastX = xOf(seg.points[seg.points.length - 1].s).toFixed(1);
          const fillD = `M ${firstX},${y0} L ${linePath} L ${lastX},${y0} Z`;
          return (
            <path
              key={`fill-${i}`}
              d={fillD}
              fill={fillColor}
              fillOpacity={0.13}
            />
          );
        })}

        {/* Strike vertical line */}
        {strike >= xMin && strike <= xMax && (
          <line
            x1={xOf(strike)}
            x2={xOf(strike)}
            y1={padT}
            y2={padT + innerH}
            stroke={T.amber}
            strokeWidth={0.8}
            strokeDasharray="2 2"
            opacity={0.7}
          />
        )}

        {/* Breakeven vertical line */}
        {breakeven >= xMin && breakeven <= xMax && (
          <>
            <line
              x1={xOf(breakeven)}
              x2={xOf(breakeven)}
              y1={padT}
              y2={padT + innerH}
              stroke={T.textDim}
              strokeWidth={0.6}
              strokeDasharray="3 2"
            />
            <text
              x={xOf(breakeven)}
              y={padT - 4}
              fontSize={fs(8)}
              fontFamily={T.mono}
              fill={T.textDim}
              textAnchor="middle"
              fontWeight={600}
            >
              BE ${breakeven.toFixed(2)}
            </text>
          </>
        )}

        {/* Current price vertical line */}
        {currentPrice >= xMin && currentPrice <= xMax && (
          <line
            x1={xOf(currentPrice)}
            x2={xOf(currentPrice)}
            y1={padT}
            y2={padT + innerH}
            stroke={T.accent}
            strokeWidth={1.2}
            opacity={0.9}
          />
        )}

        {/* Curve segments */}
        {segments.map((seg, i) => {
          if (seg.points.length < 2) return null;
          const lineColor = seg.sign === "+" ? T.green : T.red;
          const lineD =
            "M " +
            seg.points
              .map((p) => `${xOf(p.s).toFixed(1)},${yOf(p.p).toFixed(1)}`)
              .join(" L ");
          return (
            <path
              key={`line-${i}`}
              d={lineD}
              fill="none"
              stroke={lineColor}
              strokeWidth={1.8}
              strokeLinejoin="round"
            />
          );
        })}

        {/* Top right: max profit label */}
        <text
          x={W - padR - 2}
          y={padT - 2}
          fontSize={fs(8)}
          fontFamily={T.mono}
          fill={T.green}
          textAnchor="end"
          fontWeight={700}
        >
          {maxProfitUnlimited ? "Max +∞" : `Max +${fmtMoney(visibleMaxProfit)}`}
        </text>
        {/* Bottom right: max loss label */}
        <text
          x={W - padR - 2}
          y={H - 4}
          fontSize={fs(8)}
          fontFamily={T.mono}
          fill={T.red}
          textAnchor="end"
          fontWeight={700}
        >
          {maxLossUnlimited ? "Max −∞" : `Max ${fmtMoney(visibleMaxLoss)}`}
        </text>

        {/* X axis baseline */}
        <line
          x1={padL}
          x2={padL + innerW}
          y1={padT + innerH}
          y2={padT + innerH}
          stroke={T.border}
          strokeWidth={0.5}
        />
        {/* X axis ticks */}
        <text
          x={padL}
          y={H - 4}
          fontSize={fs(7)}
          fontFamily={T.mono}
          fill={T.textMuted}
        >
          ${xMin.toFixed(0)}
        </text>
        <text
          x={padL + innerW}
          y={H - 4}
          fontSize={fs(7)}
          fontFamily={T.mono}
          fill={T.textMuted}
          textAnchor="end"
        >
          ${xMax.toFixed(0)}
        </text>
      </svg>
    </div>
  );
};
