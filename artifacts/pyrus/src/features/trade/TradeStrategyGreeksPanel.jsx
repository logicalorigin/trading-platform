import {
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "../platform/tradeOptionChainStore";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";
import { toneForOptionSide } from "../platform/semanticToneModel";
import { isFiniteNumber } from "../../lib/formatters";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorAlpha,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";

// Strategy templates: delta target informs strike selection.
const TRADE_STRATEGIES = [
  {
    id: "long_call_atm",
    name: "Call ATM",
    desc: "Bullish, ~50Δ",
    cp: "C",
    deltaTarget: 0.5,
    qty: 3,
    dte: 7,
    color: toneForOptionSide("C"),
  },
  {
    id: "long_put_atm",
    name: "Put ATM",
    desc: "Bearish, ~50Δ",
    cp: "P",
    deltaTarget: 0.5,
    qty: 3,
    dte: 7,
    color: CSS_COLOR.red,
  },
  {
    id: "long_call_otm",
    name: "Call OTM",
    desc: "Aggressive, 30Δ",
    cp: "C",
    deltaTarget: 0.3,
    qty: 5,
    dte: 7,
    color: toneForOptionSide("C"),
  },
  {
    id: "0dte_lotto",
    name: "0DTE Lotto",
    desc: "High R/R · Δ20",
    cp: "C",
    deltaTarget: 0.2,
    qty: 10,
    dte: 0,
    color: CSS_COLOR.amber,
  },
  {
    id: "itm_call",
    name: "ITM Call",
    desc: "Conservative, 70Δ",
    cp: "C",
    deltaTarget: 0.7,
    qty: 2,
    dte: 14,
    color: toneForOptionSide("C"),
  },
  {
    id: "long_put_otm",
    name: "Put OTM",
    desc: "Hedge, 25Δ",
    cp: "P",
    deltaTarget: 0.25,
    qty: 5,
    dte: 7,
    color: CSS_COLOR.red,
  },
];

export const TradeStrategyGreeksPanel = ({
  slot,
  chainRows = [],
  onApplyStrategy,
}) => {
  const chainSnapshot = useTradeOptionChainSnapshot(slot.ticker);
  const { chainRows: snapshotChainRows } = resolveTradeOptionChainSnapshot(
    chainSnapshot,
    slot.exp,
  );
  const resolvedChainRows = chainRows.length ? chainRows : snapshotChainRows;
  const row = resolvedChainRows.find((candidate) => candidate.k === slot.strike);
  if (!row) {
    return (
      <div
        style={{
          background: CSS_COLOR.bg1,
          border: `1px solid ${CSS_COLOR.border}`,
          borderRadius: dim(RADII.sm),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.regular,
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            letterSpacing: "0.04em",
            borderBottom: `1px solid ${CSS_COLOR.border}`,
            paddingBottom: sp(4),
          }}
        >
          STRATEGY
        </div>
        <DataUnavailableState
          title="No live greeks"
          detail="Strategy presets stay available after the selected contract resolves to a live option chain row with greeks."
        />
      </div>
    );
  }
  const delta = slot.cp === "C" ? row.cDelta : row.pDelta;
  const gamma = slot.cp === "C" ? row.cGamma : row.pGamma;
  const theta = slot.cp === "C" ? row.cTheta : row.pTheta;
  const vega = slot.cp === "C" ? row.cVega : row.pVega;
  if (
    !isFiniteNumber(delta) ||
    !isFiniteNumber(gamma) ||
    !isFiniteNumber(theta) ||
    !isFiniteNumber(vega)
  ) {
    return (
      <div
        style={{
          background: CSS_COLOR.bg1,
          border: `1px solid ${CSS_COLOR.border}`,
          borderRadius: dim(RADII.sm),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.regular,
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            letterSpacing: "0.04em",
            borderBottom: `1px solid ${CSS_COLOR.border}`,
            paddingBottom: sp(4),
          }}
        >
          STRATEGY
        </div>
        <DataUnavailableState
          title="No live greeks"
          detail="Strategy presets stay hidden until the selected contract includes broker-backed delta, gamma, theta, and vega."
        />
      </div>
    );
  }
  const absDelta = Math.abs(delta);
  const qty = 3;

  const GreekBar = ({ label, value, color, max, desc }) => {
    const pct = Math.min(1, Math.abs(value) / max);
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${dim(32)}px 1fr ${dim(64)}px`,
          alignItems: "center",
          gap: sp(4),
          padding: sp("2px 0"),
        }}
      >
        <span
          style={{
            fontSize: textSize("caption"),
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontWeight: FONT_WEIGHTS.regular,
          }}
        >
          {label}
        </span>
        <div
          style={{
            position: "relative",
            height: dim(12),
            background: CSS_COLOR.bg1,
            borderRadius: dim(RADII.xs),
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: value < 0 ? `${50 - pct * 50}%` : "50%",
              width: `${pct * 50}%`,
              height: "100%",
              background: color,
              opacity: 0.85,
              borderRadius: dim(RADII.xs),
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              bottom: 0,
              width: dim(1),
              background: CSS_COLOR.border,
            }}
          />
          <span
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left:
                value < 0
                  ? `${Math.max(0, 50 - pct * 50 - 0.5)}%`
                  : `${Math.min(95, 50 + pct * 50 + 1)}%`,
              transform: value < 0 ? "translateX(-100%)" : "none",
              fontSize: textSize("body"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              color: CSS_COLOR.text,
              display: "flex",
              alignItems: "center",
              paddingLeft: value < 0 ? 0 : 3,
              paddingRight: value < 0 ? 3 : 0,
            }}
          >
            {value.toFixed(3)}
          </span>
        </div>
        <span
          style={{
            fontSize: textSize("caption"),
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontStyle: "italic",
            textAlign: "right",
          }}
        >
          {desc}
        </span>
      </div>
    );
  };

  return (
    <div
      style={{
        background: CSS_COLOR.bg1,
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(6),
        overflow: "hidden",
      }}
    >
      <div>
        <div
          style={{
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.regular,
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            letterSpacing: "0.04em",
            borderBottom: `1px solid ${CSS_COLOR.border}`,
            paddingBottom: sp(4),
            marginBottom: sp(5),
          }}
        >
          STRATEGY
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: sp(3),
          }}
        >
          {TRADE_STRATEGIES.map((strategy) => (
            <button
              key={strategy.id}
              onClick={(event) => {
                event.stopPropagation();
                onApplyStrategy(strategy);
              }}
              style={{
                padding: sp("6px 10px"),
                background: cssColorAlpha(strategy.color, "1a"),
                border: `1px solid ${cssColorAlpha(strategy.color, "66")}`,
                borderRadius: dim(RADII.sm),
                color: CSS_COLOR.text,
                fontSize: textSize("caption"),
                fontFamily: T.sans,
                fontWeight: FONT_WEIGHTS.medium,
                textAlign: "left",
                cursor: "pointer",
                lineHeight: 1.2,
              }}
            >
              <div style={{ color: strategy.color, fontWeight: FONT_WEIGHTS.regular }}>
                {strategy.name}
              </div>
              <div
                style={{
                  color: CSS_COLOR.textDim,
                  fontSize: textSize("body"),
                  marginTop: sp(1),
                  fontStyle: "italic",
                }}
              >
                {strategy.desc}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div
          style={{
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.regular,
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            letterSpacing: "0.04em",
            borderBottom: `1px solid ${CSS_COLOR.border}`,
            paddingBottom: sp(4),
            marginBottom: sp(5),
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>GREEKS</span>
          <span style={{ fontSize: textSize("caption"), color: CSS_COLOR.textDim, fontWeight: FONT_WEIGHTS.regular }}>
            PER CONTRACT
          </span>
        </div>
        <GreekBar
          label="Δ"
          value={delta}
          color={CSS_COLOR.accent}
          max={1.0}
          desc={
            absDelta >= 0.5 ? "Strong" : absDelta >= 0.3 ? "Moderate" : "Weak"
          }
        />
        <GreekBar
          label="Γ"
          value={gamma}
          color={CSS_COLOR.purple}
          max={0.1}
          desc={gamma > 0.05 ? "High γ-risk" : "Moderate γ"}
        />
        <GreekBar
          label="Θ"
          value={theta}
          color={CSS_COLOR.red}
          max={0.15}
          desc={`$${Math.abs(theta * 100).toFixed(0)}/day`}
        />
        <GreekBar
          label="V"
          value={vega}
          color={CSS_COLOR.cyan}
          max={0.2}
          desc={`$${(vega * 100).toFixed(0)}/1% IV`}
        />
      </div>
      <div
        style={{ padding: sp("4px 6px"), background: CSS_COLOR.bg1, borderRadius: RADII.xs }}
      >
        <div
          style={{
            fontSize: fs(6),
            color: CSS_COLOR.textMuted,
            letterSpacing: "0.04em",
            marginBottom: sp(2),
          }}
        >
          POSITION × {qty}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: sp(4),
            fontSize: textSize("caption"),
            fontFamily: T.sans,
          }}
        >
          <div>
            <span style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>Δ </span>
            <span style={{ color: CSS_COLOR.accent, fontWeight: FONT_WEIGHTS.regular }}>
              {(delta * qty).toFixed(2)}
            </span>
          </div>
          <div>
            <span style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>Γ </span>
            <span style={{ color: CSS_COLOR.purple, fontWeight: FONT_WEIGHTS.regular }}>
              {(gamma * qty).toFixed(2)}
            </span>
          </div>
          <div>
            <span style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>Θ </span>
            <span style={{ color: CSS_COLOR.red, fontWeight: FONT_WEIGHTS.regular }}>
              {(theta * qty).toFixed(2)}
            </span>
          </div>
          <div>
            <span style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>V </span>
            <span style={{ color: CSS_COLOR.cyan, fontWeight: FONT_WEIGHTS.regular }}>
              {(vega * qty).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
