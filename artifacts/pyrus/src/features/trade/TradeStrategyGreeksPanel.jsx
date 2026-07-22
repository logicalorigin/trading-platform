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
  MISSING_VALUE,
  RADII,
  T,
  cssColorAlpha,
  dim,
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

const resolveTradeStrategyGreeksState = ({
  chainRows = [],
  strike,
  cp = "C",
} = {}) => {
  const rows = Array.isArray(chainRows) ? chainRows : [];
  const normalizedStrike = Number(strike);
  const row = rows.find(
    (candidate) =>
      Number.isFinite(normalizedStrike) &&
      Number(candidate?.k) === normalizedStrike,
  );
  const prefix = cp === "P" ? "p" : "c";
  const readGreek = (key) => {
    const value = row?.[`${prefix}${key}`];
    return isFiniteNumber(value) ? value : null;
  };
  const values = {
    delta: readGreek("Delta"),
    gamma: readGreek("Gamma"),
    theta: readGreek("Theta"),
    vega: readGreek("Vega"),
  };
  const contractMultiplier = row?.[`${prefix}Contract`]?.multiplier;
  const multiplier =
    isFiniteNumber(contractMultiplier) && contractMultiplier > 0
      ? contractMultiplier
      : null;
  const availableCount = Object.values(values).filter(isFiniteNumber).length;

  return {
    kind:
      availableCount === 4
        ? "ready"
        : availableCount > 0
          ? "partial"
          : "unavailable",
    availableCount,
    values,
    multiplier,
    strategyAvailability: {
      C: rows.some((candidate) => isFiniteNumber(candidate?.cDelta)),
      P: rows.some((candidate) => isFiniteNumber(candidate?.pDelta)),
    },
  };
};

export const __tradeStrategyGreeksPanelInternalsForTests = {
  resolveTradeStrategyGreeksState,
};

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
  const greeksState = resolveTradeStrategyGreeksState({
    chainRows: resolvedChainRows,
    strike: slot.strike,
    cp: slot.cp,
  });
  const { delta, gamma, theta, vega } = greeksState.values;
  const { multiplier } = greeksState;
  const absDelta = Math.abs(delta || 0);
  const strategyPresetsReady =
    greeksState.strategyAvailability.C ||
    greeksState.strategyAvailability.P;

  const GreekBar = ({ label, value, color, max, desc }) => {
    const available = isFiniteNumber(value);
    const pct = available ? Math.min(1, Math.abs(value) / max) : 0;
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
          {available ? (
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
          ) : null}
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
                available && value < 0
                  ? `${Math.max(0, 50 - pct * 50 - 0.5)}%`
                  : `${Math.min(95, 50 + pct * 50 + 1)}%`,
              transform:
                available && value < 0 ? "translateX(-100%)" : "none",
              fontSize: textSize("body"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              color: CSS_COLOR.text,
              display: "flex",
              alignItems: "center",
              paddingLeft: available && value < 0 ? 0 : 3,
              paddingRight: available && value < 0 ? 3 : 0,
            }}
          >
            {available ? value.toFixed(3) : MISSING_VALUE}
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
          {available ? desc : "Unavailable"}
        </span>
      </div>
    );
  };

  return (
    <div
      data-testid="trade-strategy-greeks-content"
      data-greeks-state={greeksState.kind}
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
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(8),
          }}
        >
          <span>STRATEGY</span>
          <span
            style={{
              color: strategyPresetsReady
                ? CSS_COLOR.textDim
                : CSS_COLOR.amber,
              fontSize: textSize("caption"),
            }}
          >
            {strategyPresetsReady ? "CONTRACT PRESETS" : "WAITING FOR CHAIN"}
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: sp(3),
          }}
        >
          {TRADE_STRATEGIES.map((strategy) => {
            const available = Boolean(
              greeksState.strategyAvailability[strategy.cp] &&
                typeof onApplyStrategy === "function",
            );
            return (
              <button
                key={strategy.id}
                type="button"
                className="ra-touch-target-y"
                data-testid={`trade-strategy-${strategy.id}`}
                disabled={!available}
                title={
                  available
                    ? `Select the nearest ${strategy.desc} contract`
                    : "A live option-chain delta is required"
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onApplyStrategy(strategy);
                }}
                style={{
                  minWidth: 0,
                  padding: sp("6px 10px"),
                  background: cssColorAlpha(strategy.color, "1a"),
                  border: `1px solid ${cssColorAlpha(
                    strategy.color,
                    available ? "66" : "33",
                  )}`,
                  borderRadius: dim(RADII.sm),
                  color: CSS_COLOR.text,
                  fontSize: textSize("caption"),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.medium,
                  textAlign: "left",
                  cursor: available ? "pointer" : "not-allowed",
                  lineHeight: 1.2,
                  opacity: available ? 1 : 0.55,
                }}
              >
                <div
                  style={{
                    color: available ? strategy.color : CSS_COLOR.textDim,
                    fontWeight: FONT_WEIGHTS.regular,
                  }}
                >
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
            );
          })}
        </div>
        <div
          style={{
            color: CSS_COLOR.textMuted,
            fontSize: textSize("caption"),
            fontFamily: T.sans,
            marginTop: sp(4),
          }}
        >
          Selects the nearest live delta and expiration for ticket review. It
          does not submit.
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
          <span
            style={{
              fontSize: textSize("caption"),
              color:
                greeksState.kind === "partial"
                  ? CSS_COLOR.amber
                  : CSS_COLOR.textDim,
              fontWeight: FONT_WEIGHTS.regular,
            }}
          >
            {greeksState.availableCount
              ? `${greeksState.availableCount}/4 AVAILABLE`
              : "UNAVAILABLE"}
          </span>
        </div>
        {greeksState.kind === "unavailable" ? (
          <DataUnavailableState
            title="Greeks unavailable"
            detail="The selected contract has not returned delta, gamma, theta, or vega yet."
          />
        ) : (
          <>
            {greeksState.kind === "partial" ? (
              <div
                role="status"
                data-testid="trade-greeks-status"
                style={{
                  borderLeft: `2px solid ${CSS_COLOR.amber}`,
                  background: cssColorAlpha(CSS_COLOR.amber, "0d"),
                  color: CSS_COLOR.amber,
                  padding: sp("4px 8px"),
                  marginBottom: sp(4),
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                }}
              >
                Partial Greeks · {greeksState.availableCount} of 4 values
                available
              </div>
            ) : null}
            <GreekBar
              label="Δ"
              value={delta}
              color={CSS_COLOR.accent}
              max={1.0}
              desc={
                absDelta >= 0.5
                  ? "Strong"
                  : absDelta >= 0.3
                    ? "Moderate"
                    : "Weak"
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
              desc={
                isFiniteNumber(multiplier)
                  ? `$${Math.abs(theta * multiplier).toFixed(0)}/day`
                  : "Multiplier unavailable"
              }
            />
            <GreekBar
              label="V"
              value={vega}
              color={CSS_COLOR.cyan}
              max={0.2}
              desc={
                isFiniteNumber(multiplier)
                  ? `$${(vega * multiplier).toFixed(0)}/1% IV`
                  : "Multiplier unavailable"
              }
            />
          </>
        )}
      </div>
    </div>
  );
};
