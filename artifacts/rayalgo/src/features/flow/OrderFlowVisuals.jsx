import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens";

export const OrderFlowDonut = ({ flow, size = 110, thickness = 18 }) => {
  const totalBuy = flow.buyXL + flow.buyL + flow.buyM + flow.buyS;
  const totalSell = flow.sellXL + flow.sellL + flow.sellM + flow.sellS;
  const total = totalBuy + totalSell || 1;
  const net = totalBuy - totalSell;
  const segs = [
    { value: flow.buyXL, color: "#047857" },
    { value: flow.buyL, color: "#10b981" },
    { value: flow.buyM, color: "#34d399" },
    { value: flow.buyS, color: "#6ee7b7" },
    { value: flow.sellS, color: "#fca5a5" },
    { value: flow.sellM, color: "#f87171" },
    { value: flow.sellL, color: "#ef4444" },
    { value: flow.sellXL, color: "#b91c1c" },
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
        stroke={T.bg2}
        strokeWidth={1}
      />
    );
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize={fs(7)}
        fill={T.textMuted}
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
        fill={net >= 0 ? T.green : T.red}
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
        fontSize: fs(9),
      }}
    >
      <span style={{ color: T.green, fontWeight: 400, textAlign: "right" }}>
        {Number.isFinite(buy) ? `$${buy.toFixed(1)}M` : MISSING_VALUE}
      </span>
      <div
        style={{ display: "flex", justifyContent: "flex-end", height: dim(8) }}
      >
        <div
          style={{
            width: `${buyPct}%`,
            height: "100%",
            background: T.green,
            opacity: 0.85,
            borderRadius: dim(1),
          }}
        />
      </div>
      <span style={{ textAlign: "center", color: T.textSec, fontWeight: 400 }}>
        {label}
      </span>
      <div
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
            background: T.red,
            opacity: 0.85,
            borderRadius: dim(1),
          }}
        />
      </div>
      <span style={{ color: T.red, fontWeight: 400 }}>
        {Number.isFinite(sell) ? `$${sell.toFixed(1)}M` : MISSING_VALUE}
      </span>
    </div>
  );
};
