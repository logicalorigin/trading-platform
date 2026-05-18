import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import {
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "../accountUtils";
import { arrayValue } from "./patternsCommon";

const toneColor = (tone) =>
  tone === "green"
    ? "var(--ra-pnl-positive)"
    : tone === "red"
      ? "var(--ra-pnl-negative)"
      : tone === "amber"
        ? T.amber
        : tone === "cyan"
          ? T.cyan
          : tone === "pink"
            ? T.pink
            : T.textSec;

const AnalysisCard = ({ card, currency, maskValues, onActivate }) => {
  if (!card) return null;
  const color = toneColor(card.tone);
  const disabled = card.disabled || !card.tradeId;
  return (
    <button
      type="button"
      className="ra-interactive"
      disabled={disabled}
      onClick={() => onActivate?.(card)}
      style={{
        border: `1px solid ${color}55`,
        borderRadius: dim(RADII.sm),
        background: `${color}12`,
        padding: sp("6px 7px"),
        textAlign: "left",
        display: "grid",
        gap: sp(3),
        color: T.textSec,
        minWidth: 0,
        opacity: disabled ? 0.76 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: sp(6),
          alignItems: "center",
        }}
      >
        <span
          style={{
            color,
            fontFamily: T.sans,
            fontWeight: FONT_WEIGHTS.regular,
            fontSize: textSize("control"),
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {card.label}
        </span>
        <span style={{ color: toneForValue(card.value), fontFamily: T.data, fontWeight: FONT_WEIGHTS.regular }}>
          {formatAccountMoney(card.value, currency, true, maskValues)}
        </span>
      </div>
      <div style={{ fontSize: textSize("caption"), lineHeight: 1.3 }}>
        {card.symbol ? `${card.symbol} · ` : ""}
        {card.description}
      </div>
      {card.meta ? (
        <div style={{ color: T.textDim, fontFamily: T.data, fontSize: textSize("label") }}>
          {formatNumber(card.meta.count || 0, 0)} trades ·{" "}
          {formatAccountPercent(card.meta.winRatePercent, 0, maskValues)}
        </div>
      ) : disabled ? (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: textSize("label") }}>
          Waiting for ledger data
        </div>
      ) : null}
    </button>
  );
};

const readinessTone = (state) =>
  state === "ready" ? T.green : state === "waiting" ? T.amber : T.textDim;

const AnalysisReadinessStrip = ({ readiness = [] }) => {
  const rows = arrayValue(readiness);
  if (!rows.length) return null;
  return (
    <div
      className="ra-hide-scrollbar"
      style={{
        display: "flex",
        flexWrap: "nowrap",
        overflowX: "auto",
        border: `1px solid ${T.border}`,
        borderRadius: dim(RADII.xs),
        minWidth: 0,
      }}
    >
      {rows.map((row, index) => {
        const color = readinessTone(row.state);
        return (
          <div
            key={row.key}
            style={{
              flex: "1 1 auto",
              minWidth: dim(132),
              padding: sp("4px 8px"),
              borderLeft: index === 0 ? "none" : `1px solid ${T.border}`,
              background: `${color}0f`,
              display: "grid",
              gap: sp(1),
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(5),
                minWidth: 0,
              }}
            >
              <span style={{ ...mutedLabelStyle, color }}>{row.label}</span>
              <span style={{ color, fontFamily: T.data, fontSize: textSize("label"), fontWeight: FONT_WEIGHTS.regular }}>
                {formatNumber(row.value || 0, 0)}
              </span>
            </div>
            <div
              style={{
                color: T.textDim,
                fontFamily: T.sans,
                fontSize: textSize("label"),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.detail}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const PatternsInsights = ({
  analysis,
  currency,
  maskValues,
  onLensChange,
  onTradeSelect,
}) => {
  const representativeCards = arrayValue(analysis?.representativeTrades).slice(0, 4);
  const issueCards = arrayValue(analysis?.issueCards).slice(0, 5);
  const cards = [...representativeCards, ...issueCards];
  const readinessRows = arrayValue(analysis?.readiness);

  if (!cards.length && !readinessRows.length) return null;

  const activate = (card) => {
    if (card?.disabled) return;
    if (card?.lens?.kind) {
      onLensChange?.(card.lens.kind, card.lens.input || {});
    }
    if (card?.tradeId) {
      onTradeSelect?.(card.tradeId);
    }
  };

  return (
    <div style={{ display: "grid", gap: sp(5) }}>
      {cards.length ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fit, minmax(${dim(150)}px, 1fr))`,
            gap: sp(5),
          }}
        >
          {cards.map((card) => (
            <AnalysisCard
              key={card.key}
              card={card}
              currency={currency}
              maskValues={maskValues}
              onActivate={activate}
            />
          ))}
        </div>
      ) : null}
      <AnalysisReadinessStrip readiness={readinessRows} />
    </div>
  );
};

export default PatternsInsights;
