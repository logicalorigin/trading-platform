import { ChevronUp } from "lucide-react";
import { useStoredOptionQuoteSnapshot } from "../platform/live-streams";
import {
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "../platform/tradeOptionChainStore";
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
  formatRelativeTimeShort,
  isFiniteNumber,
} from "../../lib/formatters";
import { useValueFlash } from "../../lib/motion";
import { resolveOptionQuoteMark } from "./optionChainRows";

const TRADE_BUY_TONE = toneForDirectionalIntent("buy");
const TRADE_SELL_TONE = toneForDirectionalIntent("sell");

export const resolveCollapsedTicketInstrument = ({
  ticker,
  contract,
  chainRows = [],
}) => {
  const side = contract?.cp === "P" ? "P" : contract?.cp === "C" ? "C" : null;
  if (
    !ticker ||
    !contract?.exp ||
    !side ||
    !isFiniteNumber(contract?.strike)
  ) {
    return null;
  }

  const row = chainRows.find((candidate) => candidate?.k === contract.strike);
  const resolvedContract = side === "P" ? row?.pContract : row?.cContract;
  const providerContractId =
    resolvedContract?.providerContractId || contract.providerContractId || null;
  if (!providerContractId) return null;

  const labelContract = {
    ...resolvedContract,
    exp: contract.exp,
    strike: contract.strike,
    cp: side,
  };
  return {
    label: formatOptionContractLabel(labelContract, {
      symbol: ticker,
      includeSymbol: true,
    }),
    shortLabel: `${ticker} ${formatOptionContractLabel(
      { strike: contract.strike, cp: side },
      { includeSymbol: false },
    )}`,
    providerContractId,
    rowFreshness: row?.[side === "P" ? "pFreshness" : "cFreshness"] || null,
  };
};

export const formatCollapsedTicketFreshness = (quote, fallback) => {
  const status = String(
    quote?.freshness || quote?.quoteFreshness || fallback || "unavailable",
  ).replaceAll("_", " ");
  const updatedAt = quote?.dataUpdatedAt ?? quote?.updatedAt;
  const age = updatedAt ? formatRelativeTimeShort(updatedAt) : null;
  return `${status} · ${age && age !== "—" ? age : "time unknown"}`;
};

export const resolveCollapsedTicketPrice = (quote) =>
  resolveOptionQuoteMark(quote?.bid, quote?.ask, quote?.price);

export const formatCollapsedTicketToggleLabel = ({
  ticker,
  expanded = false,
}) =>
  `${expanded ? "Collapse" : "Open"}${ticker ? ` ${ticker}` : ""} order ticket`;

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
  const chainSnapshot = useTradeOptionChainSnapshot(ticker);
  const { chainRows } = resolveTradeOptionChainSnapshot(
    chainSnapshot,
    contract?.exp,
  );
  const instrument = resolveCollapsedTicketInstrument({
    ticker,
    contract,
    chainRows,
  });
  const quote = useStoredOptionQuoteSnapshot(instrument?.providerContractId);
  const price = resolveCollapsedTicketPrice(quote);
  const priceFlash = useValueFlash(price);
  const freshnessLabel = instrument
    ? formatCollapsedTicketFreshness(quote, instrument.rowFreshness)
    : null;

  if (!instrument) {
    const toggleLabel = formatCollapsedTicketToggleLabel({
      ticker,
      expanded,
    });
    return (
      <button
        type="button"
        onClick={onExpand}
        aria-expanded={expanded}
        aria-label={toggleLabel}
        style={{
          appearance: "none",
          cursor: "pointer",
          width: "100%",
          minHeight: dim(48),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: sp(7),
          padding: sp("0 12px"),
          border: "none",
          background: "transparent",
          color: CSS_COLOR.text,
          fontFamily: T.sans,
          fontSize: fs(13),
          fontWeight: FONT_WEIGHTS.label,
        }}
      >
        <Icon
          as={ChevronUp}
          context="control"
          color={CSS_COLOR.textDim}
          style={{
            transition: "transform var(--ra-motion-standard) ease",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
        {toggleLabel}
      </button>
    );
  }

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
            transition: "transform var(--ra-motion-standard) ease",
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
          {instrument.label}
        </span>
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
          title={`Quote freshness: ${freshnessLabel}`}
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: T.sans,
            fontSize: fs(10),
            color: CSS_COLOR.textDim,
          }}
        >
          {freshnessLabel}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onPickSide?.("BUY")}
        aria-label={`Buy ${instrument.label}`}
        title={`Buy ${instrument.label}`}
        style={sidePillStyle(TRADE_BUY_TONE)}
      >
        Buy {instrument.shortLabel}
      </button>
      <button
        type="button"
        onClick={() => onPickSide?.("SELL")}
        aria-label={`Sell ${instrument.label}`}
        title={`Sell ${instrument.label}`}
        style={sidePillStyle(TRADE_SELL_TONE)}
      >
        Sell {instrument.shortLabel}
      </button>
    </div>
  );
};

export default TradeTicketCollapsedBar;
