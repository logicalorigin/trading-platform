import {
  CSS_COLOR,
  cssColorMix,
  dim,
  FONT_WEIGHTS,
  RADII,
  sp,
  T,
  textSize,
} from "../../lib/uiTokens.jsx";

// A liquidity/threshold gate rendered as a distribution ladder: the live
// candidate values (histogram from the impact model) over an axis, the
// threshold line, pass/block zones, and the blocked count. Reads the impact
// entry that AlgoSettingsRegion already computes via buildAlgoTuningImpact.
//
//   direction "max" -> pass when value <= threshold (e.g. spread)
//   direction "min" -> pass when value >= threshold (e.g. min bid)
export function GateLadder({ label, threshold, direction = "max", fmt = (v) => `${v}`, impact }) {
  const hist = impact?.histogram;
  const count = impact?.count ?? 0;
  const samples = impact?.sampleSymbols ?? [];
  const buckets = hist?.buckets ?? [];
  const hasDist = buckets.length > 0 && Number(hist?.max) > Number(hist?.min);
  const tPos = hist?.thresholdPosition; // 0..1 or null
  const tLeft = tPos != null ? tPos * 100 : 50;
  const maxBucket = hasDist ? Math.max(...buckets) : 0;
  const clear = count === 0;
  const statusColor = clear ? CSS_COLOR.green : CSS_COLOR.red;

  const passColor = direction === "max" ? CSS_COLOR.green : CSS_COLOR.red;
  const overColor = direction === "max" ? CSS_COLOR.red : CSS_COLOR.green;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: dim(5), padding: sp("5px 0"), minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: sp(2) }}>
        <span style={{ fontFamily: T.sans, fontSize: textSize("caption"), color: CSS_COLOR.textSec, fontWeight: FONT_WEIGHTS.label }}>
          {label}
        </span>
        <span style={{ fontFamily: T.data, fontSize: textSize("caption"), color: CSS_COLOR.text }}>{fmt(threshold)}</span>
      </div>

      <div style={{ position: "relative", height: dim(26) }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: dim(RADII.xs), overflow: "hidden", background: CSS_COLOR.bg0 }}>
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${tLeft}%`, background: cssColorMix(passColor, 9) }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, left: `${tLeft}%`, right: 0, background: cssColorMix(overColor, 14) }} />
        </div>

        {hasDist ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: dim(1), padding: `0 ${dim(1)}px` }}>
            {buckets.map((b, i) => {
              const center = (i + 0.5) / buckets.length;
              const onBlock = direction === "max" ? center > (tPos ?? 1) : center < (tPos ?? 0);
              const h = maxBucket ? (b / maxBucket) * dim(24) : 0;
              return (
                <div
                  key={i}
                  style={{
                    flex: "1 1 0",
                    height: b === 0 ? 0 : Math.max(dim(2), h),
                    borderRadius: dim(1),
                    background: onBlock ? CSS_COLOR.red : CSS_COLOR.green,
                    opacity: b === 0 ? 0 : 0.8,
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: sp(2) }}>
            <span style={{ fontFamily: T.sans, fontSize: textSize("micro"), color: CSS_COLOR.textDim }}>no live candidates</span>
          </div>
        )}

        {tPos != null ? (
          <div style={{ position: "absolute", left: `${tLeft}%`, top: dim(-2), bottom: dim(-2), width: dim(2), transform: "translateX(-1px)", background: CSS_COLOR.text, borderRadius: dim(1) }} />
        ) : null}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: sp(2) }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: sp(2), minWidth: 0 }}>
          <span style={{ width: dim(6), height: dim(6), borderRadius: dim(RADII.pill), background: statusColor, flex: "0 0 auto" }} />
          <span style={{ fontFamily: T.sans, fontSize: textSize("micro"), color: CSS_COLOR.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {clear ? (
              "all clear"
            ) : (
              <>
                <span style={{ color: CSS_COLOR.red, fontWeight: FONT_WEIGHTS.label }}>{count} blocked</span>
                {samples.length ? ` · ${samples.join(", ")}` : ""}
              </>
            )}
          </span>
        </span>
        {hasDist ? (
          <span style={{ fontFamily: T.data, fontSize: textSize("micro"), color: CSS_COLOR.textDim, flex: "0 0 auto" }}>
            {fmt(hist.min)}–{fmt(hist.max)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default GateLadder;
