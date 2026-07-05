import {
  CSS_COLOR,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { SEMANTIC_TONE } from "../platform/semanticToneModel.js";

const rgba = (color, alpha) => cssColorMix(color, alpha * 100);

export const OrderFlowDonut = ({ flow, size = 110, thickness = 18 }) => {
  const totalBuy = flow.buyXL + flow.buyL + flow.buyM + flow.buyS;
  const totalSell = flow.sellXL + flow.sellL + flow.sellM + flow.sellS;
  const total = totalBuy + totalSell || 1;
  const net = totalBuy - totalSell;
  const segs = [
    { value: flow.buyXL, color: rgba(SEMANTIC_TONE.directionBuy, 0.42) },
    { value: flow.buyL, color: rgba(SEMANTIC_TONE.directionBuy, 0.95) },
    { value: flow.buyM, color: rgba(SEMANTIC_TONE.directionBuy, 0.72) },
    { value: flow.buyS, color: rgba(SEMANTIC_TONE.directionBuy, 0.46) },
    { value: flow.sellS, color: rgba(CSS_COLOR.red, 0.38) },
    { value: flow.sellM, color: rgba(CSS_COLOR.red, 0.58) },
    { value: flow.sellL, color: rgba(CSS_COLOR.red, 0.78) },
    { value: flow.sellXL, color: rgba(CSS_COLOR.red, 0.94) },
  ];

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const innerR = r - thickness;

  let cumAngle = -Math.PI / 2;
  const paths = segs.map((seg, index) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    if (angle <= 0) return null;
    const startAngle = cumAngle;
    const endAngle = cumAngle + angle;
    cumAngle = endAngle;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const x3 = cx + innerR * Math.cos(endAngle);
    const y3 = cy + innerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(startAngle);
    const y4 = cy + innerR * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    return (
      <path
        key={index}
        d={d}
        fill={seg.color}
        stroke={CSS_COLOR.bg2}
        strokeWidth={1}
      />
    );
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Net order flow ${net >= 0 ? "+" : "-"}$${Math.abs(net).toFixed(0)}M, buy $${totalBuy.toFixed(0)}M versus sell $${totalSell.toFixed(0)}M`}
    >
      {paths}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize={fs(7)}
        fill={CSS_COLOR.textMuted}
        fontFamily={T.sans}
        letterSpacing="0.08em"
      >
        NET
      </text>
      <text
        x={cx}
        y={cy + fs(11)}
        textAnchor="middle"
        fontSize={fs(11)}
        fontWeight={400}
        fill={net >= 0 ? SEMANTIC_TONE.directionBuy : SEMANTIC_TONE.directionSell}
        fontFamily={T.sans}
      >
        {`${net >= 0 ? "+" : "-"}$${Math.abs(net).toFixed(0)}M`}
      </text>
    </svg>
  );
};

export const SizeBucketRow = ({ label, buy, sell, maxValue }) => {
  const safeMaxValue = maxValue || 1;
  const buyPct = (buy / safeMaxValue) * 100;
  const sellPct = (sell / safeMaxValue) * 100;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${dim(44)}px 1fr ${dim(22)}px 1fr ${dim(44)}px`,
        gap: sp(4),
        alignItems: "center",
        padding: sp("2px 0"),
        fontFamily: T.sans,
        fontSize: textSize("caption"),
      }}
    >
      <span style={{ color: SEMANTIC_TONE.directionBuy, fontWeight: FONT_WEIGHTS.regular, textAlign: "right" }}>
        {Number.isFinite(buy) ? `$${buy.toFixed(1)}M` : MISSING_VALUE}
      </span>
      <div
        aria-hidden="true"
        style={{ display: "flex", justifyContent: "flex-end", height: dim(8) }}
      >
        <div
          style={{
            width: `${buyPct}%`,
            height: "100%",
            background: SEMANTIC_TONE.directionBuy,
            opacity: 0.85,
            borderRadius: dim(RADII.xs),
          }}
        />
      </div>
      <span style={{ textAlign: "center", color: CSS_COLOR.textSec, fontWeight: FONT_WEIGHTS.regular }}>
        {label}
      </span>
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          justifyContent: "flex-start",
          height: dim(8),
        }}
      >
        <div
          style={{
            width: `${sellPct}%`,
            height: "100%",
            background: CSS_COLOR.red,
            opacity: 0.85,
            borderRadius: dim(RADII.xs),
          }}
        />
      </div>
      <span style={{ color: CSS_COLOR.red, fontWeight: FONT_WEIGHTS.regular }}>
        {Number.isFinite(sell) ? `$${sell.toFixed(1)}M` : MISSING_VALUE}
      </span>
    </div>
  );
};
