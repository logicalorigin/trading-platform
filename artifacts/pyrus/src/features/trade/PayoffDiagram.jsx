import { isFiniteNumber } from "../../lib/formatters";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";
import {
  CSS_COLOR,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens";

const resolvePayoffDiagramModel = ({
  optType,
  strike,
  premium,
  qty,
  multiplier,
  currentPrice,
  side,
} = {}) => {
  const normalizedType = String(optType || "").toUpperCase();
  const normalizedSide = String(side || "").toUpperCase();
  const normalizedStrike = Number(strike);
  const normalizedPremium = Number(premium);
  const normalizedQty = Number(qty);
  const normalizedMultiplier = Number(multiplier);
  if (
    !["C", "P"].includes(normalizedType) ||
    !["BUY", "SELL"].includes(normalizedSide) ||
    !isFiniteNumber(normalizedStrike) ||
    normalizedStrike <= 0 ||
    !isFiniteNumber(normalizedPremium) ||
    normalizedPremium <= 0 ||
    !isFiniteNumber(normalizedQty) ||
    normalizedQty <= 0 ||
    !isFiniteNumber(normalizedMultiplier) ||
    normalizedMultiplier <= 0
  ) {
    return { kind: "unavailable" };
  }

  const isCall = normalizedType === "C";
  const isLong = normalizedSide === "BUY";
  const positionMultiplier = normalizedQty * normalizedMultiplier;
  const premiumTotal = normalizedPremium * positionMultiplier;
  const putIntrinsicLimit =
    Math.max(0, normalizedStrike - normalizedPremium) * positionMultiplier;
  const resolvedCurrentPrice =
    isFiniteNumber(currentPrice) && currentPrice > 0 ? currentPrice : null;

  return {
    kind: "ready",
    isCall,
    isLong,
    strike: normalizedStrike,
    premium: normalizedPremium,
    qty: normalizedQty,
    multiplier: normalizedMultiplier,
    currentPrice: resolvedCurrentPrice,
    referencePrice: resolvedCurrentPrice || normalizedStrike,
    breakeven: isCall
      ? normalizedStrike + normalizedPremium
      : normalizedStrike - normalizedPremium,
    maxProfit: isLong
      ? isCall
        ? null
        : putIntrinsicLimit
      : premiumTotal,
    maxProfitUnlimited: Boolean(isLong && isCall),
    maxLoss: isLong
      ? -premiumTotal
      : isCall
        ? null
        : -putIntrinsicLimit,
    maxLossUnlimited: Boolean(!isLong && isCall),
  };
};

export const __payoffDiagramInternalsForTests = {
  resolvePayoffDiagramModel,
};

export const PayoffDiagram = (props) => {
  const payoff = resolvePayoffDiagramModel(props);
  if (payoff.kind === "unavailable") {
    return (
      <div
        style={{
          background: CSS_COLOR.bg1,
          border: `1px solid ${CSS_COLOR.border}`,
          borderRadius: dim(RADII.sm),
          padding: sp(8),
        }}
      >
        <DataUnavailableState
          title="Payoff unavailable"
          detail="Enter a valid option strike, premium, quantity, and contract multiplier to chart expiration P&L."
        />
      </div>
    );
  }

  const {
    isCall,
    isLong,
    strike,
    premium,
    qty,
    multiplier,
    currentPrice,
    referencePrice,
    breakeven,
    maxProfit,
    maxProfitUnlimited,
    maxLoss,
    maxLossUnlimited,
  } = payoff;

  // P&L at expiration for any underlying price S
  const pnl = (S) => {
    const intrinsic = isCall
      ? Math.max(0, S - strike)
      : Math.max(0, strike - S);
    const longPnl = (intrinsic - premium) * qty * multiplier;
    return isLong ? longPnl : -longPnl;
  };

  // X range: 25% above and below current price gives enough room for visible breakeven
  const xMin = referencePrice * 0.75;
  const xMax = referencePrice * 1.25;
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
  const fmtMoney = (value) => {
    const magnitude = Math.abs(value);
    return magnitude >= 1000
      ? `$${(magnitude / 1000).toFixed(1)}K`
      : `$${Math.round(magnitude)}`;
  };

  return (
    <div style={{ background: CSS_COLOR.bg1, border: `1px solid ${CSS_COLOR.border}`, borderRadius: dim(RADII.sm), padding: sp(8) }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: sp("0 4px 2px"),
          fontSize: fs(7),
          fontFamily: T.sans,
          color: CSS_COLOR.textMuted,
          letterSpacing: "0.04em",
        }}
      >
        <span>P&L AT EXPIRATION</span>
        <span style={{ display: "flex", gap: sp(6) }}>
          <span>
            <span style={{ color: CSS_COLOR.accent }}>━</span> now{" "}
            {isFiniteNumber(currentPrice)
              ? currentPrice.toFixed(2)
              : MISSING_VALUE}
          </span>
          <span>
            <span style={{ color: CSS_COLOR.amber }}>┃</span> strike {strike}
          </span>
        </span>
      </div>
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${isLong ? "Buy" : "Sell"} ${isCall ? "call" : "put"} option P&L at expiration. Strike ${strike}, breakeven ${breakeven.toFixed(2)}. Max profit ${maxProfitUnlimited ? "unlimited" : fmtMoney(maxProfit)}, max loss ${maxLossUnlimited ? "unlimited" : fmtMoney(maxLoss)}.`}
      >
        {/* Zero P&L line */}
        <line
          x1={padL}
          x2={padL + innerW}
          y1={y0}
          y2={y0}
          stroke={CSS_COLOR.textMuted}
          strokeWidth={0.5}
          strokeDasharray="2 2"
          opacity={0.5}
        />

        {/* Filled areas under each segment */}
        {segments.map((seg, i) => {
          if (seg.points.length < 2) return null;
          const fillColor = seg.sign === "+" ? CSS_COLOR.green : CSS_COLOR.red;
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
            stroke={CSS_COLOR.amber}
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
              stroke={CSS_COLOR.textDim}
              strokeWidth={0.6}
              strokeDasharray="3 2"
            />
            <text
              x={xOf(breakeven)}
              y={padT - 4}
              fontSize={fs(8)}
              fontFamily={T.sans}
              fill={CSS_COLOR.textDim}
              textAnchor="middle"
              fontWeight={400}
            >
              {`BE ${breakeven.toFixed(2)}`}
            </text>
          </>
        )}

        {/* Current price vertical line */}
        {isFiniteNumber(currentPrice) &&
          currentPrice >= xMin &&
          currentPrice <= xMax && (
            <line
              x1={xOf(currentPrice)}
              x2={xOf(currentPrice)}
              y1={padT}
              y2={padT + innerH}
              stroke={CSS_COLOR.accent}
              strokeWidth={1.2}
              opacity={0.9}
            />
          )}

        {/* Curve segments */}
        {segments.map((seg, i) => {
          if (seg.points.length < 2) return null;
          const lineColor = seg.sign === "+" ? CSS_COLOR.green : CSS_COLOR.red;
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
          fontFamily={T.sans}
          fill={CSS_COLOR.green}
          textAnchor="end"
          fontWeight={400}
        >
          {maxProfitUnlimited ? "Max +∞" : `Max +${fmtMoney(maxProfit)}`}
        </text>
        {/* Bottom right: max loss label */}
        <text
          x={W - padR - 2}
          y={H - 4}
          fontSize={fs(8)}
          fontFamily={T.sans}
          fill={CSS_COLOR.red}
          textAnchor="end"
          fontWeight={400}
        >
          {maxLossUnlimited ? "Max −∞" : `Max −${fmtMoney(maxLoss)}`}
        </text>

        {/* X axis baseline */}
        <line
          x1={padL}
          x2={padL + innerW}
          y1={padT + innerH}
          y2={padT + innerH}
          stroke={CSS_COLOR.border}
          strokeWidth={0.5}
        />
        {/* X axis ticks */}
        <text
          x={padL}
          y={H - 4}
          fontSize={fs(7)}
          fontFamily={T.sans}
          fill={CSS_COLOR.textMuted}
        >
          {xMin.toFixed(0)}
        </text>
        <text
          x={padL + innerW}
          y={H - 4}
          fontSize={fs(7)}
          fontFamily={T.sans}
          fill={CSS_COLOR.textMuted}
          textAnchor="end"
        >
          {xMax.toFixed(0)}
        </text>
      </svg>
    </div>
  );
};
