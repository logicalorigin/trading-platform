import { ChevronUp } from "lucide-react";
import { ensureTradeTickerInfo, useRuntimeTickerSnapshot } from "../platform/runtimeTickerStore";
import { toneForDirectionalIntent } from "../platform/semanticToneModel.js";
import { Icon } from "../../components/platform/primitives.jsx";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens.jsx";
import {
  formatOptionContractLabel,
  formatPriceValue,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import { useValueFlash } from "../../lib/motion";

const TRADE_BUY_TONE = toneForDirectionalIntent("buy");
const TRADE_SELL_TONE = toneForDirectionalIntent("sell");

const sidePillStyle = (tone) => ({
  appearance: "none",
  cursor: "pointer",
  minWidth: dim(56),
  minHeight: dim(44),
  padding: sp("0 12px"),
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: `1px solid ${tone}`,
  borderRadius: dim(RADII.sm),
  background: "transparent",
  color: tone,
  fontFamily: T.sans,
  fontSize: fs(12),
  fontWeight: FONT_WEIGHTS.label,
  letterSpacing: "0.06em",
});

/**
 * Collapsed summary shown in the docked order ticket bar. Tapping the summary
 * area expands the ticket; the BUY / SELL pills expand AND preselect the side.
 */
export const TradeTicketCollapsedBar = ({
  ticker,
  contract,
  expanded = false,
  onExpand,
  onPickSide,
}) => {
  const fallback = ensureTradeTickerInfo(ticker, ticker);
  const info = useRuntimeTickerSnapshot(ticker, fallback);
  const price = isFiniteNumber(info?.price) ? info.price : null;
  const pct = isFiniteNumber(info?.pct) ? info.pct : null;
  const priceFlash = useValueFlash(price);
  const pctTone =
    pct == null
      ? CSS_COLOR.textDim
      : pct >= 0
        ? CSS_COLOR.green
        : CSS_COLOR.red;
  const contractLabel = formatOptionContractLabel(contract, {
    includeSymbol: false,
    fallback: "",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(6),
        width: "100%",
        padding: sp("0 10px"),
      }}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse order ticket" : "Expand order ticket"}
        style={{
          appearance: "none",
          cursor: "pointer",
          flex: 1,
          minWidth: 0,
          minHeight: dim(48),
          display: "flex",
          alignItems: "center",
          gap: sp(8),
          padding: 0,
          background: "transparent",
          border: "none",
          color: CSS_COLOR.text,
          textAlign: "left",
        }}
      >
        <Icon
          as={ChevronUp}
          context="control"
          color={CSS_COLOR.textDim}
          style={{
            flexShrink: 0,
            transition: "transform 200ms ease",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
        <span
          style={{
            flexShrink: 0,
            fontFamily: T.sans,
            fontSize: fs(13),
            fontWeight: FONT_WEIGHTS.label,
            letterSpacing: "0.04em",
            color: CSS_COLOR.text,
          }}
        >
          {ticker}
        </span>
        {contractLabel ? (
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: T.sans,
              fontSize: fs(11),
              color: CSS_COLOR.textDim,
              letterSpacing: "0.02em",
            }}
          >
            {contractLabel}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <span
          className={priceFlash}
          style={{
            flexShrink: 0,
            fontFamily: T.mono,
            fontSize: fs(13),
            fontWeight: FONT_WEIGHTS.label,
            color: CSS_COLOR.text,
          }}
        >
          {price == null ? "—" : formatPriceValue(price)}
        </span>
        <span
          style={{
            flexShrink: 0,
            fontFamily: T.mono,
            fontSize: fs(11),
            color: pctTone,
          }}
        >
          {pct == null ? "" : `(${formatSignedPercent(pct)})`}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onPickSide?.("BUY")}
        style={sidePillStyle(TRADE_BUY_TONE)}
      >
        BUY
      </button>
      <button
        type="button"
        onClick={() => onPickSide?.("SELL")}
        style={sidePillStyle(TRADE_SELL_TONE)}
      >
        SELL
      </button>
    </div>
  );
};

export default TradeTicketCollapsedBar;
