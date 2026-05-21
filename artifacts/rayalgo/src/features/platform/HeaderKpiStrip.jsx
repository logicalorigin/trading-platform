import { memo, useMemo } from "react";
import { FONT_WEIGHTS, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  formatQuotePrice,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import { useNumberTick } from "../../lib/numberTick.js";
import { useRuntimeTickerSnapshot } from "./runtimeTickerStore";
import { buildFallbackWatchlistItem } from "./runtimeMarketDataModel";
import { AppTooltip } from "@/components/ui/tooltip";


const HEADER_KPI_CONFIG = [
  { symbol: "SPY", label: "S&P 500" },
  { symbol: "QQQ", label: "Nasdaq 100" },
  { symbol: "VIXY", label: "Volatility" },
  { symbol: "IEF", label: "Treasuries" },
  { symbol: "UUP", label: "Dollar" },
  { symbol: "GLD", label: "Gold" },
  { symbol: "USO", label: "Crude" },
];

export const HEADER_KPI_SYMBOLS = HEADER_KPI_CONFIG.map((item) => item.symbol);

const HeaderKpiStripItem = memo(({ symbol, label, index, onSelect, compact = false, dense = false, isFirst = false }) => {
  const isDense = dense && !compact;
  const fallback = useMemo(
    () => buildFallbackWatchlistItem(symbol, index, label),
    [index, label, symbol],
  );
  const snapshot = useRuntimeTickerSnapshot(symbol, fallback);
  const positive = isFiniteNumber(snapshot?.pct) ? snapshot.pct >= 0 : null;
  // 420ms tick — fast enough that streaming updates don't pile up, slow
  // enough that the human eye registers movement. Reduced-motion drops
  // straight to the target value (the hook handles that).
  const animatedPrice = useNumberTick(snapshot?.price, 420);
  const animatedPct = useNumberTick(snapshot?.pct, 420);
  const priceLabel = formatQuotePrice(animatedPrice ?? snapshot?.price);
  const percentLabel = formatSignedPercent(animatedPct ?? snapshot?.pct);
  const compactPercentLabel = percentLabel.replace(/(\.\d)\d(?=%)/, "$1");
  const displayPercentLabel = compact ? compactPercentLabel : percentLabel;
  const displayPriceLabel = compact
    ? priceLabel.replace(/(\.\d)\d$/, "$1")
    : priceLabel;

  return (
    <AppTooltip content={`${label} proxy · ${symbol} · ${priceLabel} · ${percentLabel}`}><button
      type="button"
      onClick={() => onSelect?.(symbol)}
      className="ra-header-kpi"
      style={{
        flex: "0 0 max-content",
        width: "max-content",
        minWidth: "max-content",
        minHeight: dim(isDense || compact ? 20 : 24),
        padding: sp(isDense ? "0px 3px" : compact ? "0px 2px" : "1px 4px"),
        boxSizing: "border-box",
        display: "inline-grid",
        gridTemplateColumns: "max-content max-content max-content",
        alignItems: "center",
        gap: sp(compact ? 2 : 4),
        background: "transparent",
        border: "none",
        borderLeft: isFirst ? "none" : `1px solid ${T.borderLight}`,
        color: T.text,
        cursor: "pointer",
        overflow: "visible",
        transition: "background 0.12s ease, color 0.12s ease",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = T.accentHoverBg;
        event.currentTarget.style.color = T.accent;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
        event.currentTarget.style.color = T.text;
      }}
    >
      <span
        style={{
          minWidth: "max-content",
          flex: "0 0 auto",
          textAlign: "left",
          display: "block",
          whiteSpace: "nowrap",
          overflow: "visible",
          fontSize: textSize("body"),
          fontWeight: FONT_WEIGHTS.medium,
          color: T.textSec,
          fontFamily: T.sans,
          lineHeight: 1.1,
          letterSpacing: 0,
        }}
      >
        {symbol}
      </span>
      <span
        style={{
          minWidth: "max-content",
          display: "block",
          fontSize: textSize("body"),
          fontWeight: FONT_WEIGHTS.medium,
          fontFamily: T.sans,
          color: T.text,
          lineHeight: 1.15,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {displayPriceLabel}
      </span>
      <span
        style={{
          minWidth: "max-content",
          display: "block",
          fontSize: textSize("body"),
          fontWeight: FONT_WEIGHTS.medium,
          fontFamily: T.sans,
          color:
            positive == null ? T.textDim : positive ? T.green : T.red,
          lineHeight: 1.15,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {displayPercentLabel}
      </span>
    </button></AppTooltip>
  );
});

export const HeaderKpiStrip = memo(({ onSelect, compact = false, dense = false, maxItems = null }) => {
  const items = Number.isFinite(maxItems)
    ? HEADER_KPI_CONFIG.slice(0, Math.max(1, maxItems))
    : HEADER_KPI_CONFIG;

  return (
    <div
      data-testid="platform-header-kpis"
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        justifyContent: "flex-start",
        gap: 0,
        flex: "0 0 max-content",
        width: "max-content",
        minWidth: "max-content",
        background: "transparent",
        border: "none",
        borderRadius: 0,
        overflow: "visible",
      }}
    >
      {items.map(({ symbol, label }, index) => (
        <HeaderKpiStripItem
          key={symbol}
          symbol={symbol}
          label={label}
          index={index}
          onSelect={onSelect}
          compact={compact}
          dense={dense}
          isFirst={index === 0}
        />
      ))}
    </div>
  );
});
